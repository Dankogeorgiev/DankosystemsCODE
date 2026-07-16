/* Данко Системс — ЕРП „AI разчитане на заявки".
   Качваш сканирана клиентска заявка (PDF/снимка) → Edge функцията parse-document
   я разчита с Claude → тук съпоставяме клиентския код с НАШИЯ продукт (научени
   псевдоними) → човек потвърждава → ражда се нормална заявка (customer_orders).

   ЖЕЛЕЗНИ ПРАВИЛА:
   • AI само чете. Съпоставянето и всичко числово е детерминистичен код тук.
   • Нищо не влиза в базата без човешко потвърждение.
   • Оригиналът се пази в Storage (bucket „drawings"), вързан за заявката.
   • API ключът е само в Edge функцията, не тук.

   Псевдонимите (наученото „техен код → наш код") се пазят в app_config:
   id „product_aliases" (за продукти) — структура:
     { byClient: { [clientKey]: { [normCode]: {productId, clientName, at, by} } } }
   Същият механизъм ще обслужи и материалите (id „material_aliases") във фаза 2. */

let AI_ALIASES = null;      // кеш на product_aliases.byClient

/* ---------- Помощни ---------- */
// Нормализира код за съпоставяне: главни букви, без интервали/тирета/точки.
function aiNorm(s) { return String(s || "").toUpperCase().replace(/[\s.\-_/]+/g, "").trim(); }
// Нормализира име за грубо сравнение.
function aiNormName(s) { return String(s || "").toLowerCase().replace(/[^a-zа-я0-9]+/gi, " ").replace(/\s+/g, " ").trim(); }
// Ключ на клиента за псевдонимите: id-то, ако има; иначе нормализирано име.
function aiClientKey(clientId, clientName) {
  if (clientId) return "id:" + clientId;
  const n = aiNormName(clientName);
  return n ? "nm:" + n : "";
}

async function erpAILoadAliases(force) {
  if (AI_ALIASES && !force) return AI_ALIASES;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "product_aliases").maybeSingle();
    AI_ALIASES = (data && data.data && data.data.byClient) || {};
  } catch (e) { AI_ALIASES = {}; }
  return AI_ALIASES;
}
async function erpAISaveAliases() {
  const { error } = await sb.from("app_config").upsert({ id: "product_aliases", data: { byClient: AI_ALIASES || {} }, updated_at: new Date().toISOString() });
  if (error) console.warn("Псевдоними: грешка при запис:", error.message);
}
// Търси научен псевдоним → productId или null.
function erpAIAliasFind(clientId, clientName, code) {
  if (!AI_ALIASES) return null;
  const nc = aiNorm(code);
  if (!nc) return null;
  const keys = [aiClientKey(clientId, clientName), aiClientKey(null, clientName)].filter(Boolean);
  for (const k of keys) {
    const bucket = AI_ALIASES[k];
    if (bucket && bucket[nc] && bucket[nc].productId) return Number(bucket[nc].productId);
  }
  return null;
}
// Записва нови псевдоними (само тези, които още ги няма).
async function erpAILearnAliases(clientId, clientName, pairs) {
  await erpAILoadAliases();
  const k = aiClientKey(clientId, clientName);
  if (!k) return;
  const bucket = AI_ALIASES[k] = AI_ALIASES[k] || {};
  let added = 0;
  const by = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "";
  const stamp = new Date().toISOString();
  (pairs || []).forEach(p => {
    const nc = aiNorm(p.code);
    if (!nc || !p.productId) return;
    if (bucket[nc] && Number(bucket[nc].productId) === Number(p.productId)) return;  // вече е научено
    bucket[nc] = { productId: Number(p.productId), clientName: p.clientName || "", at: stamp, by };
    added++;
  });
  if (added) await erpAISaveAliases();
  return added;
}

/* ---------- Съпоставяне (matching) — три нива ---------- */
// Връща { productId, confidence:'high'|'mid'|'none', suggestions:[{id,code,name,score}] }.
function erpAIMatchLine(line, ctx) {
  const code = line.client_code || "";
  const name = line.client_name || "";
  // Ниво 1а — научен псевдоним (клиент + код).
  const aliased = erpAIAliasFind(ctx.clientId, ctx.clientName, code);
  if (aliased && ERP.prodById[aliased]) return { productId: aliased, confidence: "high", suggestions: [] };
  // Ниво 1б — клиентският код съвпада точно с НАШ код (еднозначно).
  const nc = aiNorm(code);
  if (nc) {
    const exact = ERP.products.filter(p => aiNorm(p.code) === nc);
    if (exact.length === 1) return { productId: exact[0].id, confidence: "high", suggestions: [] };
  }
  // Ниво 2 — стеснено търсене (по клиент-собственик, иначе всички) по име/код.
  const owner = (ctx.clientName || "").trim().toLowerCase();
  const pool = (ERP.hasOwnerClient && owner)
    ? ERP.products.filter(p => (p.owner_client || "").trim().toLowerCase() === owner)
    : ERP.products;
  const scope = pool.length ? pool : ERP.products;
  const nn = aiNormName(name);
  const nnTokens = nn.split(" ").filter(t => t.length >= 3);
  const scored = scope.map(p => {
    let s = 0;
    const pc = aiNorm(p.code), pn = aiNormName(p.name);
    if (nc && pc && (pc.includes(nc) || nc.includes(pc))) s += 6;
    if (nn && pn && pn === nn) s += 8;
    else if (nn && pn && (pn.includes(nn) || nn.includes(pn))) s += 4;
    nnTokens.forEach(t => { if (pn.includes(t)) s += 1; });
    return { id: p.id, code: p.code, name: p.name, score: s };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  if (scored.length && scored[0].score >= 6) return { productId: null, confidence: "mid", suggestions: scored };
  if (scored.length) return { productId: null, confidence: "none", suggestions: scored };
  return { productId: null, confidence: "none", suggestions: [] };
}

/* ---------- Вход: качване + разчитане ---------- */
function erpAIStart() {
  const { wrap, close } = erpDialog(`
    <h3>🤖 Разчети заявка (AI)</h3>
    <p class="hint" style="margin:0 0 8px">Качи сканираната клиентска заявка (PDF или снимка). Claude ще я разчете, а ти ще потвърдиш преди да стане заявка.</p>
    <label class="btn co-attach-btn" style="display:inline-block">⬆ Избери файл<input type="file" id="ai-file" accept="application/pdf,image/*" hidden /></label>
    <span id="ai-fname" class="erp-muted"></span>
    <p class="save-status" id="ai-status"></p>
    <div class="erp-dialog-actions">
      <button class="btn" id="ai-cancel">Отказ</button>
      <button class="btn btn-primary" id="ai-go" disabled>Разчети</button>
    </div>`);
  let chosen = null;
  const st = wrap.querySelector("#ai-status");
  const inp = wrap.querySelector("#ai-file");
  const go = wrap.querySelector("#ai-go");
  inp.addEventListener("change", () => {
    chosen = inp.files && inp.files[0];
    wrap.querySelector("#ai-fname").textContent = chosen ? "  " + chosen.name : "";
    go.disabled = !chosen;
  });
  wrap.querySelector("#ai-cancel").addEventListener("click", close);
  go.addEventListener("click", async () => {
    if (!chosen) return;
    go.disabled = true; inp.disabled = true;
    try {
      await erpAIUploadAndParse(chosen, st);
      close();
    } catch (e) {
      st.textContent = "⚠ " + (e.message || e);
      go.disabled = false; inp.disabled = false;
    }
  });
}

async function erpAIUploadAndParse(file, st) {
  await erpEnsureLoaded();
  await erpAILoadAliases();
  // 1) Качи оригинала в Storage (същия bucket като заявките).
  if (st) st.textContent = "Качвам файла…";
  const path = `orders/ai/${Date.now()}-${safeName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file);
  if (up.error) throw new Error("Качване: " + up.error.message);
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const fileInfo = { name: file.name, type: file.type, path, url: pub.publicUrl };
  // 2) Разчети през Edge функцията.
  if (st) st.textContent = "Claude разчита документа… (може да отнеме няколко секунди)";
  const cfg = window.DANKO_CONFIG || {};
  let token = cfg.SUPABASE_ANON_KEY;
  try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
  const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/parse-document", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
    body: JSON.stringify({ file_url: fileInfo.url, media_type: file.type, doc_type: "заявка" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ("HTTP " + res.status) + ". Ако функцията още не е качена — виж AI-PARSING-SETUP.md.");
  erpAIRenderReview(j.parsed || {}, fileInfo, j.usage);
}

/* ---------- Екран за потвърждение (двупанелен) ---------- */
let AI_STATE = null;   // { parsed, fileInfo, clientId, clientName, rows[] }

async function erpAIRenderReview(parsed, fileInfo, usage) {
  const clients = await erpLoadClients();
  // Опит за автоматично познаване на клиента по име.
  const pn = aiNormName(parsed.client_name);
  const cm = pn ? clients.find(c => aiNormName(c.company) === pn) || clients.find(c => aiNormName(c.company).includes(pn) || pn.includes(aiNormName(c.company))) : null;
  const rows = (parsed.lines || []).map((l, i) => {
    const m = erpAIMatchLine(l, { clientId: cm ? cm.id : null, clientName: parsed.client_name || "" });
    return {
      i, client_code: l.client_code || "", client_name: l.client_name || "",
      qty: l.quantity != null ? l.quantity : 1,
      unit: l.unit || "бр.",
      unit_price: l.unit_price != null ? l.unit_price : "",
      drawing_rev: l.drawing_rev || "", note: l.note || "",
      productId: m.productId || null, confidence: m.confidence, suggestions: m.suggestions, revOk: false,
    };
  });
  AI_STATE = { parsed, fileInfo, usage, clientId: cm ? cm.id : null, clientName: parsed.client_name || "", clients, rows };
  erpAIDraw();
}

function erpAIDraw() {
  const v = erpView();
  const s = AI_STATE;
  const isPdf = (s.fileInfo.type || "").includes("pdf") || /\.pdf(\?|$)/i.test(s.fileInfo.url);
  const preview = isPdf
    ? `<iframe src="${escapeAttr(s.fileInfo.url)}" class="ai-doc-frame" title="документ"></iframe>`
    : `<img src="${escapeAttr(s.fileInfo.url)}" class="ai-doc-img" alt="документ" />`;
  const u = s.usage ? ` · токени: ${(s.usage.input_tokens || 0) + (s.usage.output_tokens || 0)}` : "";
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="ai-back">← Назад към заявките</button>
      <span class="erp-count">🤖 Разчетена заявка — прегледай и потвърди${u}</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="ai-confirm">✓ Потвърди и създай заявка</button>
    </div>
    <div class="ai-review">
      <div class="ai-doc-pane">${preview}</div>
      <div class="ai-rows-pane">
        <div class="ai-head-grid">
          <label>Клиент
            <input type="text" id="ai-client" list="ai-clients" value="${escapeAttr(s.clientName)}" placeholder="избери / въведи" />
            <datalist id="ai-clients">${s.clients.map(c => `<option value="${escapeAttr(c.company || "")}"></option>`).join("")}</datalist>
          </label>
          <label>Клиентски № <input type="text" id="ai-orderno" value="${escapeAttr(s.parsed.order_no || "")}" /></label>
          <label>Дата <input type="date" id="ai-date" value="${escapeAttr(s.parsed.order_date || "")}" /></label>
          <label>Срок <input type="date" id="ai-due" value="${escapeAttr(s.parsed.due_date || "")}" /></label>
        </div>
        <p class="ai-legend"><span class="ai-c-high">●</span> висока (авто) · <span class="ai-c-mid">●</span> средна (предложение) · <span class="ai-c-none">●</span> няма (избери ръчно). Всеки ред трябва да е вързан с наш продукт и с отметната ревизия.</p>
        <label class="ai-allrev"><input type="checkbox" id="ai-allrev" /> ✓ Отметни всички ревизии наведнъж</label>
        <div id="ai-rows">${s.rows.map(erpAIRowHtml).join("")}</div>
        ${s.rows.length ? "" : `<div class="ai-diag"><p class="erp-warn">⚠ Claude не върна редове. Ето суровия отговор (за диагностика):</p><pre class="ai-diag-pre">${escapeHtml(JSON.stringify(s.parsed || {}, null, 2))}</pre><p class="erp-muted">Токени: ${s.usage ? JSON.stringify(s.usage) : "—"}</p></div>`}
        <p class="save-status" id="ai-confirm-status"></p>
      </div>
    </div>`;
  document.getElementById("ai-back").addEventListener("click", () => { if (confirm("Да се откажа от разчитането? Създадената заявка още не е записана.")) erpRenderCustomerOrders(); });
  document.getElementById("ai-confirm").addEventListener("click", erpAIConfirm);
  const cl = document.getElementById("ai-client");
  cl.addEventListener("input", e => {
    s.clientName = e.target.value;
    const m = s.clients.find(c => (c.company || "") === e.target.value);
    s.clientId = m ? m.id : null;
    erpAIRematch();
  });
  document.getElementById("ai-orderno").addEventListener("input", e => s.parsed.order_no = e.target.value);
  document.getElementById("ai-date").addEventListener("input", e => s.parsed.order_date = e.target.value);
  document.getElementById("ai-due").addEventListener("input", e => s.parsed.due_date = e.target.value);
  const allRev = document.getElementById("ai-allrev");
  if (allRev) allRev.addEventListener("change", e => {
    const on = e.target.checked;
    AI_STATE.rows.forEach(r => { r.revOk = on; });
    document.querySelectorAll("#ai-rows .ai-revchk").forEach(chk => { chk.checked = on; });
  });
  erpAIWireRows();
}

function erpAIProdLabel(pid) {
  const p = pid ? ERP.prodById[pid] : null;
  return p ? `<b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}` : `<span class="ai-c-none">— избери продукт —</span>`;
}
function erpAIRowHtml(r) {
  const cls = "ai-c-" + r.confidence;
  const sugg = (!r.productId && r.suggestions.length)
    ? `<div class="ai-sugg">Предложения: ${r.suggestions.map(x => `<button type="button" class="ai-sugg-btn" data-i="${r.i}" data-pid="${x.id}" title="${escapeAttr(x.name)}"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml((x.name || "").slice(0, 28))}</button>`).join("")}</div>`
    : "";
  return `
    <div class="ai-row" data-i="${r.i}">
      <div class="ai-row-top">
        <span class="ai-dot ${cls}" title="увереност">●</span>
        <span class="ai-cc">${escapeHtml(r.client_code || "—")}</span>
        <span class="ai-cn">${escapeHtml(r.client_name || "")}</span>
      </div>
      <div class="ai-row-map">
        <div class="ai-prod" id="ai-prod-${r.i}">${erpAIProdLabel(r.productId)}</div>
        <button type="button" class="btn btn-small ai-pick" data-i="${r.i}">🔎 Продукт</button>
      </div>
      ${sugg}
      <div class="ai-row-fields">
        <label>Бр. <input type="number" class="ai-qty" data-i="${r.i}" min="0" step="any" value="${escapeAttr(String(r.qty))}" /></label>
        <label>Цена € <input type="number" class="ai-price" data-i="${r.i}" min="0" step="any" value="${escapeAttr(String(r.unit_price))}" placeholder="0.00" /></label>
        <label>Ревизия <input type="text" class="ai-rev" data-i="${r.i}" value="${escapeAttr(r.drawing_rev)}" style="width:70px" /></label>
        <label class="ai-revok" title="Потвърждавам ревизията на чертежа"><input type="checkbox" class="ai-revchk" data-i="${r.i}" ${r.revOk ? "checked" : ""} /> рев. ✓</label>
        <button type="button" class="btn btn-small btn-danger ai-rm" data-i="${r.i}">×</button>
      </div>
    </div>`;
}
function erpAIWireRows() {
  const box = document.getElementById("ai-rows");
  const rowOf = el => AI_STATE.rows.find(r => r.i === Number(el.dataset.i));
  box.querySelectorAll(".ai-qty").forEach(el => el.addEventListener("input", () => rowOf(el).qty = erpToNum(el.value)));
  box.querySelectorAll(".ai-price").forEach(el => el.addEventListener("input", () => rowOf(el).unit_price = erpToNum(el.value)));
  box.querySelectorAll(".ai-rev").forEach(el => el.addEventListener("input", () => rowOf(el).drawing_rev = el.value));
  box.querySelectorAll(".ai-revchk").forEach(el => el.addEventListener("change", () => rowOf(el).revOk = el.checked));
  box.querySelectorAll(".ai-pick").forEach(el => el.addEventListener("click", () => erpAIPickProduct(rowOf(el))));
  box.querySelectorAll(".ai-sugg-btn").forEach(el => el.addEventListener("click", () => {
    const r = AI_STATE.rows.find(x => x.i === Number(el.dataset.i));
    r.productId = Number(el.dataset.pid); r.confidence = "high"; r.userPicked = true;
    erpAIRedrawRow(r);
  }));
  box.querySelectorAll(".ai-rm").forEach(el => el.addEventListener("click", () => {
    const i = Number(el.dataset.i);
    AI_STATE.rows = AI_STATE.rows.filter(r => r.i !== i);
    const node = box.querySelector(`.ai-row[data-i="${i}"]`); if (node) node.remove();
  }));
}
function erpAIRedrawRow(r) {
  const node = document.querySelector(`#ai-rows .ai-row[data-i="${r.i}"]`);
  if (!node) return;
  const tmp = document.createElement("div"); tmp.innerHTML = erpAIRowHtml(r);
  node.replaceWith(tmp.firstElementChild);
  erpAIWireRows();
}
// Пресмята наново съпоставянето при смяна на клиента (пази ръчните избори? — не,
// клиентът е основата; но пазим редовете, които човек вече е избрал ръчно).
function erpAIRematch() {
  AI_STATE.rows.forEach(r => {
    if (r.userPicked) return;
    const m = erpAIMatchLine({ client_code: r.client_code, client_name: r.client_name }, { clientId: AI_STATE.clientId, clientName: AI_STATE.clientName });
    r.productId = m.productId; r.confidence = m.confidence; r.suggestions = m.suggestions;
  });
  const box = document.getElementById("ai-rows");
  if (box) { box.innerHTML = AI_STATE.rows.map(erpAIRowHtml).join(""); erpAIWireRows(); }
}
function erpAIPickProduct(r) {
  const { wrap, close } = erpDialog(`
    <h3>Избери наш продукт за реда</h3>
    <p class="hint" style="margin:0 0 6px">${escapeHtml(r.client_code || "")} ${escapeHtml(r.client_name || "")}</p>
    <input type="search" id="aip-q" placeholder="търси код или име…" />
    <div id="aip-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="aip-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#aip-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.slice();
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(p =>
      `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}</button>`).join("")
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      r.productId = Number(b.dataset.id); r.confidence = "high"; r.userPicked = true;
      close(); erpAIRedrawRow(r);
    }));
  };
  const q0 = (r.client_name || "").split(/\s+/).slice(0, 2).join(" ");
  render(q0); wrap.querySelector("#aip-q").value = q0;
  wrap.querySelector("#aip-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#aip-cancel").addEventListener("click", close);
}

/* ---------- Потвърждение → нова заявка + научени псевдоними ---------- */
async function erpAIConfirm() {
  const s = AI_STATE;
  const st = document.getElementById("ai-confirm-status");
  const block = (msg, bad) => {
    if (st) st.textContent = "⚠ " + msg;
    if (bad && bad.length) {
      const node = document.querySelector(`#ai-rows .ai-row[data-i="${bad[0].i}"]`);
      if (node) { node.scrollIntoView({ behavior: "smooth", block: "center" }); node.classList.add("ai-row-bad"); setTimeout(() => { node.classList.remove("ai-row-bad"); }, 2600); }
    }
    alert("Не мога да създам заявката:\n\n" + msg);
  };
  if (!s.rows.length) { block("Няма редове."); return; }
  const noProd = s.rows.filter(r => !r.productId);
  if (noProd.length) { block(`${noProd.length} реда без наш продукт. Всеки ред трябва да е вързан с продукт (натисни „🔎 Продукт" на червения ред).`, noProd); return; }
  const badQty = s.rows.filter(r => !(erpToNum(r.qty) > 0));
  if (badQty.length) { block(`${badQty.length} реда с количество ≤ 0.`, badQty); return; }
  const noRev = s.rows.filter(r => !r.revOk);
  if (noRev.length) { block(`${noRev.length} реда без потвърдена ревизия на чертежа. Отметни „рев. ✓" на всеки ред — или „Отметни всички ревизии" горе.`, noRev); return; }

  const btn = document.getElementById("ai-confirm");
  if (btn) { btn.disabled = true; btn.textContent = "Създавам…"; }
  try {
    const o = {
      ourNo: (typeof erpNextOrderNo === "function") ? erpNextOrderNo() : "",
      clientNo: s.parsed.order_no || "",
      clientName: s.clientName || "", clientId: s.clientId || null,
      date: s.parsed.order_date || (new Date().toISOString().slice(0, 10)),
      deadline: s.parsed.due_date || "",
      status: "нова",
      note: "",
      aiParsed: s.parsed,                 // одитна следа: суровият отговор
      files: [s.fileInfo],                // оригиналът, вързан за заявката
      lines: s.rows.map(r => {
        const p = ERP.prodById[r.productId] || {};
        return {
          productId: r.productId, code: p.code || "", name: p.name || "", ourName: p.name || "",
          clientCode: r.client_code || "", clientName: r.client_name || "",
          drawingRev: r.drawing_rev || "",
          qty: erpToNum(r.qty) || 1, unitPrice: erpToNum(r.unit_price) || "",
        };
      }),
    };
    await erpSaveCO(o);
    // Научи псевдонимите за редовете с код (само новите).
    const pairs = s.rows.filter(r => r.client_code && r.productId).map(r => ({ code: r.client_code, clientName: r.client_name, productId: r.productId }));
    try { await erpAILearnAliases(s.clientId, s.clientName, pairs); } catch (e) { console.warn(e); }
    await erpLoadCustomerOrders();
    AI_STATE = null;
    if (typeof erpOpenCO === "function") erpOpenCO(o.id); else erpRenderCustomerOrders();
  } catch (e) {
    st.textContent = "⚠ Грешка: " + (e.message || e);
    if (btn) { btn.disabled = false; btn.textContent = "✓ Потвърди и създай заявка"; }
  }
}
