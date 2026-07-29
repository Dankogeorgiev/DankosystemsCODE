/* Данко Системс — ЕРП „AI разчитане на фактури от доставчик".
   Качваш сканирана входяща фактура (PDF/снимка) → Edge функцията parse-document
   я разчита → съпоставяме описанието на доставчика с НАШ код/материал (научени
   псевдоними) → човек потвърждава → ражда се чернова покупка (payment се въвежда
   ръчно). Ползва erpAISetupViewer/erpDialog/erpToNum/ERP/BUCKET и модула Покупки.

   Псевдонимите се пазят в app_config id „material_aliases":
     { byClient: { [supplierKey]: { [normОписание]: {materialId?, code, article, groupName} } } } */

let MAT_ALIASES = null;

async function erpMatLoadAliases(force) {
  if (MAT_ALIASES && !force) return MAT_ALIASES;
  try { const { data } = await sb.from("app_config").select("data").eq("id", "material_aliases").maybeSingle(); MAT_ALIASES = (data && data.data && data.data.byClient) || {}; }
  catch (e) { MAT_ALIASES = {}; }
  return MAT_ALIASES;
}
async function erpMatSaveAliases() {
  const { error } = await sb.from("app_config").upsert({ id: "material_aliases", data: { byClient: MAT_ALIASES || {} }, updated_at: new Date().toISOString() });
  if (error) console.warn("material_aliases:", error.message);
}
function erpMatAliasFind(supId, supName, desc) {
  if (!MAT_ALIASES) return null;
  const nd = aiNormName(desc); if (!nd) return null;
  const keys = [aiClientKey(supId, supName), aiClientKey(null, supName)].filter(Boolean);
  for (const k of keys) { const b = MAT_ALIASES[k]; if (b && b[nd]) return b[nd]; }
  return null;
}
async function erpMatLearnAliases(supId, supName, pairs) {
  await erpMatLoadAliases();
  const k = aiClientKey(supId, supName); if (!k) return 0;
  const b = MAT_ALIASES[k] = MAT_ALIASES[k] || {};
  let added = 0;
  (pairs || []).forEach(p => {
    const nd = aiNormName(p.desc); if (!nd || !(p.code || p.materialId)) return;
    b[nd] = { materialId: p.materialId || null, code: p.code || "", article: p.article || "", groupName: p.groupName || "" };
    added++;
  });
  if (added) await erpMatSaveAliases();
  return added;
}

/* ---------- Съпоставяне ---------- */
function erpPuAIMatch(desc, ctx) {
  const al = erpMatAliasFind(ctx.supId, ctx.supName, desc);
  if (al && (al.materialId ? ERP.matById[al.materialId] : al.code)) return { ...al, confidence: "high", suggestions: [] };
  const nn = aiNormName(desc);
  const toks = nn.split(" ").filter(t => t.length >= 3);
  const scored = (ERP.materials || []).map(m => {
    let s = 0; const mn = aiNormName(m.name), mc = aiNormName(m.code);
    if (nn && mn && (mn === nn)) s += 8; else if (nn && mn && (mn.includes(nn) || nn.includes(mn))) s += 4;
    if (mc && nn.includes(mc)) s += 5;
    toks.forEach(t => { if (mn.includes(t)) s += 1; });
    return { materialId: m.id, code: m.code, name: m.name, groupName: m.group_name || "", score: s };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  if (scored.length && scored[0].score >= 6) return { materialId: null, code: "", article: "", groupName: "", confidence: "mid", suggestions: scored };
  return { materialId: null, code: "", article: "", groupName: "", confidence: "none", suggestions: scored };
}

/* ---------- Вход ---------- */
function erpPuAIStart() {
  const { wrap, close } = erpDialog(`
    <h3>🤖 Разчети фактура (AI)</h3>
    <p class="hint" style="margin:0 0 8px">Качи сканираната входяща фактура (PDF/снимка). Claude я разчита, ти потвърждаваш и въвеждаш плащането.</p>
    <label class="btn co-attach-btn" style="display:inline-block">⬆ Избери файл<input type="file" id="pai-file" accept="application/pdf,image/*" hidden /></label>
    <span id="pai-fname" class="erp-muted"></span>
    <p class="save-status" id="pai-status"></p>
    <div class="erp-dialog-actions"><button class="btn" id="pai-cancel">Отказ</button><button class="btn btn-primary" id="pai-go" disabled>Разчети</button></div>`);
  let chosen = null;
  const st = wrap.querySelector("#pai-status"), inp = wrap.querySelector("#pai-file"), go = wrap.querySelector("#pai-go");
  inp.addEventListener("change", () => { chosen = inp.files && inp.files[0]; wrap.querySelector("#pai-fname").textContent = chosen ? "  " + chosen.name : ""; go.disabled = !chosen; });
  wrap.querySelector("#pai-cancel").addEventListener("click", close);
  go.addEventListener("click", async () => { if (!chosen) return; go.disabled = true; inp.disabled = true; try { await erpPuAIUploadParse(chosen, st); close(); } catch (e) { st.textContent = "⚠ " + (e.message || e); go.disabled = false; inp.disabled = false; } });
}

async function erpPuAIUploadParse(file, st) {
  await erpEnsureLoaded();
  await erpMatLoadAliases();
  if (st) st.textContent = "Качвам файла…";
  const path = `purchases/ai/${Date.now()}-${safeName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file);
  if (up.error) throw new Error("Качване: " + up.error.message);
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const fileInfo = { name: file.name, type: file.type, path, url: pub.publicUrl };
  if (st) st.textContent = "Claude разчита фактурата…";
  const cfg = window.DANKO_CONFIG || {};
  let token = cfg.SUPABASE_ANON_KEY;
  try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
  const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/parse-document", {
    method: "POST", headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
    body: JSON.stringify({ file_url: fileInfo.url, media_type: file.type, doc_type: "фактура_доставчик" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ("HTTP " + res.status));
  await erpPuAIRender(j.parsed || {}, fileInfo, j.usage);
}

/* ---------- Преглед ---------- */
let PAI = null;

/* Нитовете от „Крепежи България трейдинг" идват НА КИЛОГРАМ — конверсия към
   бройки по таблицата на Данко (потвърдена 29.07.2026: важи само първият
   блок коефициенти). per = бройки в 1 килограм. */
const PU_NIT_PER_KG = {
  "6 х 10": 198, "6 х 12": 192, "8 х 10": 149, "8 х 12": 131,
  "8 х 13": 129, "8 х 26": 78, "8 х 21": 93,
};
function puNitKey(text) {
  const m = String(text || "").match(/(\d+)\s*[xх×]\s*(\d+)/i);
  return m ? `${m[1]} х ${m[2]}` : "";
}

async function erpPuAIRender(parsed, fileInfo, usage) {
  const suppliers = (typeof erpLoadSuppliers === "function") ? await erpLoadSuppliers() : [];
  // Фактурата от доставчик носи ДВЕ фирми: издател (доставчикът) и получател
  // (НИЕ). Ако AI върне нас като „клиент" — чистим полето, за да не се пише
  // Данко Системс за доставчик; истинският се избира от списъка.
  if (/данко\s*системс|danko\s*systems/i.test(parsed.client_name || "") || /115789385/.test(parsed.client_name || "")) parsed.client_name = "";
  const sn = aiNormName(parsed.client_name);
  const sm = sn ? suppliers.find(s => aiNormName(s.name) === sn) || suppliers.find(s => aiNormName(s.name).includes(sn) || sn.includes(aiNormName(s.name))) : null;
  const ctx = { supId: sm ? sm.id : null, supName: parsed.client_name || "" };
  const rows = (parsed.lines || []).map((l, i) => {
    const desc = l.client_name || "";
    const m = erpPuAIMatch(desc, ctx);
    // ⚖ Нит на килограм → бройки (Крепежи България): к-вото и цената се
    // превръщат по бр/кг от таблицата; в реда остава бадж с конверсията.
    let qty = l.quantity != null ? l.quantity : 1;
    let unit = l.unit || "бр.";
    let unitPrice = l.unit_price != null ? l.unit_price : "";
    let conv = null;
    // ⚖ МЕТАЛИ (Тисен и др.): редът има и БРОЙ, и КИЛОГРАМИ, а цената често е
    // за 1000 кг. Складът на металите е в кг → заприходяваме КИЛОГРАМИТЕ,
    // с цена на кг, сметната от стойността на реда (тя е меродавна).
    if (erpToNum(l.quantity_kg) > 0) {
      const kg = erpToNum(l.quantity_kg);
      const per = erpToNum(l.price_per) || 1;
      const lineTotal = l.total != null ? Number(l.total)
        : Math.round(kg * ((erpToNum(unitPrice) || 0) / per) * 100) / 100;
      conv = { kgMode: true, pcs: qty, pcsUnit: unit, kg, kgTotal: lineTotal };
      qty = kg; unit = "кг";
      unitPrice = kg ? Math.round((lineTotal / kg) * 1e8) / 1e8 : 0;
    } else if (erpToNum(l.price_per) > 1 && unitPrice !== "") {
      // Цена „за 1000" без второ количество → свеждаме я до цена за 1 единица.
      unitPrice = Math.round((erpToNum(unitPrice) / erpToNum(l.price_per)) * 1e8) / 1e8;
    }
    if (!conv && /^\s*(кг|kg)\.?\s*$/i.test(unit)) {
      const matName = (m.materialId && ERP.matById && ERP.matById[m.materialId]) ? (ERP.matById[m.materialId].name || "") : "";
      if (/нит|rivet/i.test(desc + " " + matName)) {
        const per = PU_NIT_PER_KG[puNitKey(desc + " " + matName)];
        if (per) {
          // Меродавна е СТОЙНОСТТА на реда по фактурата (кг × цена/кг, 2 знака) —
          // цената на брой се смята от нея, за да няма разлика при заприходяване.
          const kgTotal = l.total != null ? Number(l.total)
            : Math.round((erpToNum(qty) || 0) * (erpToNum(unitPrice) || 0) * 100) / 100;
          conv = { kg: qty, per, kgPrice: unitPrice, kgTotal };
          qty = Math.round(qty * per);
          if (unitPrice !== "" && qty) unitPrice = Math.round((kgTotal / qty) * 1e8) / 1e8;
          unit = "бр.";
        }
      }
    }
    return { i, desc, supplierCode: l.client_code || "", qty, unit, unitPrice, conv,
      materialId: m.materialId || null, code: m.code || "", article: m.article || desc, groupName: m.groupName || "", confidence: m.confidence, suggestions: m.suggestions || [] };
  });
  // Вид разход: от историята на доставчика или от групите на разпознатите материали.
  let etype = "";
  const prof = (typeof erpPuSupplierProfile === "function") ? erpPuSupplierProfile(ctx.supName) : null;
  if (prof && prof.expenseType) etype = prof.expenseType;
  if (!etype) {
    const cnt = {};
    rows.forEach(r => { const g = r.groupName; if (g && PU_EXPENSE_TYPES.some(t => t.k === g)) cnt[g] = (cnt[g] || 0) + 1; });
    etype = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || "";
  }
  // Плащане: по подразбиране отложено по банка. Срокът (дни) идва от падежа
  // на самата фактура (падеж − дата) или от историята на доставчика.
  let termDays = 0, dueDate = "";
  if (parsed.due_date && parsed.order_date) {
    const dd = Math.round((new Date(parsed.due_date) - new Date(parsed.order_date)) / 86400000);
    if (dd > 0 && dd <= 180) { termDays = dd; dueDate = parsed.due_date; }
  }
  if (!termDays && prof && prof.payStatus === "deferred" && prof.termDays) termDays = prof.termDays;
  const payStatus = (!termDays && prof && prof.payStatus) ? prof.payStatus : "deferred";
  PAI = { parsed, fileInfo, usage, suppliers, supId: ctx.supId, supName: ctx.supName, invoiceNo: parsed.order_no || "", date: parsed.order_date || new Date().toISOString().slice(0, 10), currency: /eur|евро|€/i.test(parsed.currency || "") ? "EUR" : "BGN", expenseType: etype, payStatus, termDays, dueDate, rows };
  erpPuAIDraw();
}

function erpPuAIDraw() {
  const v = erpView(); const s = PAI;
  const isPdf = (s.fileInfo.type || "").includes("pdf") || /\.pdf(\?|$)/i.test(s.fileInfo.url);
  const content = isPdf
    ? `<iframe src="${escapeAttr(s.fileInfo.url + "#navpanes=0&toolbar=0&view=Fit")}" class="ai-doc-content" title="фактура"></iframe>`
    : `<img src="${escapeAttr(s.fileInfo.url)}" class="ai-doc-content" alt="фактура" />`;
  const u = s.usage ? ` · токени: ${(s.usage.input_tokens || 0) + (s.usage.output_tokens || 0)}` : "";
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="pai-back">← Назад</button>
      <span class="erp-count">🤖 Разчетена фактура — прегледай и потвърди${u}</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pai-confirm">✓ Потвърди → чернова покупка</button>
    </div>
    <div class="ai-review">
      <div class="ai-doc-pane">
        <div class="ai-doc-controls">
          <button type="button" class="btn btn-small" id="ai-zout">−</button>
          <button type="button" class="btn btn-small" id="ai-zin">＋</button>
          <button type="button" class="btn btn-small" id="ai-zfit">⤢ Побери</button>
          <a class="btn btn-small" href="${escapeAttr(s.fileInfo.url)}" target="_blank" rel="noopener">⛶ Нов таб</a>
          <span class="erp-muted">✋ хвани и влачи</span>
        </div>
        <div class="ai-doc-viewport" id="ai-vp"><div class="ai-doc-stage" id="ai-stage">${content}</div></div>
      </div>
      <div class="ai-rows-pane">
        <div class="ai-head-grid">
          <label>Доставчик <input type="text" id="pai-sup" list="pai-sups" value="${escapeAttr(s.supName)}" />
            <datalist id="pai-sups">${s.suppliers.map(x => `<option value="${escapeAttr(x.name)}"></option>`).join("")}</datalist></label>
          <label>№ Фактура <input type="text" id="pai-no" value="${escapeAttr(s.invoiceNo)}" /></label>
          <label>Дата <input type="date" id="pai-date" value="${escapeAttr(s.date)}" /></label>
          <label>Валута <select id="pai-cur"><option ${s.currency === "BGN" ? "selected" : ""}>BGN</option><option ${s.currency === "EUR" ? "selected" : ""}>EUR</option></select></label>
          <label>Вид разход <select id="pai-etype"><option value="">— избери —</option>${PU_EXPENSE_TYPES.map(t => `<option value="${escapeAttr(t.k)}" ${t.k === s.expenseType ? "selected" : ""}>${t.mat ? "🧱 " : ""}${escapeHtml(t.k)}</option>`).join("")}</select></label>
          <label>Плащане <select id="pai-pay">${PU_PAY_OPTS.map(p => `<option value="${p.k}" ${s.payStatus === p.k ? "selected" : ""}>${p.label}</option>`).join("")}</select></label>
          <label id="pai-term-wrap" ${s.payStatus !== "deferred" ? 'style="display:none"' : ""}>Срок (дни) <input type="number" id="pai-term" min="0" value="${s.termDays ? escapeAttr(String(s.termDays)) : ""}" placeholder="напр. 30" />${s.dueDate ? `<span class="erp-muted" title="падеж от фактурата">→ ${erpDMY(s.dueDate)}</span>` : ""}</label>
        </div>
        <p class="ai-legend"><span class="ai-c-high">●</span> висока (авто) · <span class="ai-c-mid">●</span> средна · <span class="ai-c-none">●</span> няма. Свържи всеки ред с наш материал (за склад) или го остави като разход. Класификацията идва от избрания Вид разход. Плащането се въвежда на следващата стъпка.</p>
        <div id="pai-rows">${s.rows.map(erpPuAIRowHtml).join("")}</div>
        <div class="erp-sale-totals" id="pai-totals"></div>
        <p class="save-status" id="pai-cstatus"></p>
      </div>
    </div>`;
  document.getElementById("pai-back").addEventListener("click", () => { if (confirm("Да се откажа? Черновата още не е създадена.")) erpRenderPurchases(); });
  document.getElementById("pai-confirm").addEventListener("click", erpPuAIConfirm);
  document.getElementById("pai-sup").addEventListener("input", e => {
    s.supName = e.target.value; const m = s.suppliers.find(x => x.name === e.target.value); s.supId = m ? m.id : null;
    // Познат доставчик → предложи вида разход от историята му (ако още не е избран).
    if (m && !s.expenseType && typeof erpPuSupplierProfile === "function") {
      const p = erpPuSupplierProfile(m.name);
      if (p && p.expenseType) { s.expenseType = p.expenseType; const el = document.getElementById("pai-etype"); if (el) el.value = p.expenseType; }
    }
  });
  document.getElementById("pai-no").addEventListener("input", e => s.invoiceNo = e.target.value);
  document.getElementById("pai-date").addEventListener("input", e => s.date = e.target.value);
  document.getElementById("pai-cur").addEventListener("change", e => s.currency = e.target.value);
  document.getElementById("pai-etype").addEventListener("change", e => s.expenseType = e.target.value);
  document.getElementById("pai-pay").addEventListener("change", e => { s.payStatus = e.target.value; const w = document.getElementById("pai-term-wrap"); if (w) w.style.display = s.payStatus === "deferred" ? "" : "none"; });
  document.getElementById("pai-term").addEventListener("input", e => s.termDays = Number(e.target.value) || 0);
  if (typeof erpAISetupViewer === "function") erpAISetupViewer();
  erpPuAIWireRows();
  erpPuAITotalsBox();
}

/* Сверка на сумите: сборът на редовете срещу тоталите, ПРОЧЕТЕНИ от документа.
   Пази от заприходяване на фактура с по-малка/по-голяма стойност. */
function erpPuAITotalsBox() {
  const box = document.getElementById("pai-totals"); if (!box || !PAI) return;
  const s = PAI, p = s.parsed || {};
  const base = Math.round(s.rows.reduce((t, r) => t + (erpToNum(r.qty) || 0) * (erpToNum(r.unitPrice) || 0), 0) * 100) / 100;
  const doc = p.net_total != null ? Math.round(Number(p.net_total) * 100) / 100 : null;
  const diff = doc != null ? Math.round((base - doc) * 100) / 100 : null;
  const cur = s.currency || "BGN";
  const ok = diff != null && Math.abs(diff) <= 0.02;
  box.innerHTML = `<table class="erp-sale-sum">
    <tr><td>Сбор на редовете (основа)</td><td class="num">${erpNum(base)} ${cur}</td></tr>
    ${doc != null ? `<tr><td>Основа по документа</td><td class="num">${erpNum(doc)} ${cur}</td></tr>
    <tr class="grand"><td><b>${ok ? "✓ Сумите съвпадат" : "⚠ РАЗЛИКА"}</b></td><td class="num"><b>${ok ? "" : (diff > 0 ? "+" : "") + erpNum(diff) + " " + cur}</b></td></tr>` : `<tr><td colspan="2"><span class="erp-muted">Документът няма прочетени тотали за сверка (стар разчитач) — провери сумата на ръка.</span></td></tr>`}
    ${p.grand_total != null ? `<tr><td>Общо с ДДС по документа</td><td class="num">${erpNum(p.grand_total)} ${cur}</td></tr>` : ""}</table>`;
}
function erpPuAIMatLabel(r) {
  if (r.materialId && ERP.matById[r.materialId]) { const m = ERP.matById[r.materialId]; return `<b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">склад</span>`; }
  if (r.code) return `<b>${escapeHtml(r.code)}</b> ${escapeHtml(r.article || "")} <span class="erp-muted">разход</span>`;
  return `<span class="ai-c-none">— свържи / въведи —</span>`;
}
function erpPuAIRowHtml(r) {
  const sugg = (!r.materialId && r.suggestions.length)
    ? `<div class="ai-sugg">Предложения: ${r.suggestions.map(x => `<button type="button" class="ai-sugg-btn" data-i="${r.i}" data-mid="${x.materialId}"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml((x.name || "").slice(0, 26))}</button>`).join("")}</div>` : "";
  return `<div class="ai-row" data-i="${r.i}">
    <div class="ai-row-top"><span class="ai-dot ai-c-${r.confidence}">●</span><span class="ai-cn">${escapeHtml(r.desc || "")}</span>${r.supplierCode ? `<span class="ai-cc">${escapeHtml(r.supplierCode)}</span>` : ""}${r.conv ? (r.conv.kgMode
      ? `<span class="ai-cc" title="металът се заприходява в КИЛОГРАМИ; цената на кг е сметната от стойността на реда">⚖ ${escapeHtml(String(r.conv.pcs))} ${escapeHtml(r.conv.pcsUnit || "бр.")} → ${escapeHtml(String(r.conv.kg))} кг = ${erpNum(r.conv.kgTotal)}</span>`
      : `<span class="ai-cc" title="фактурата е в килограми — превърнато в бройки; цената на брой е сметната от стойността на реда">⚖ ${escapeHtml(String(r.conv.kg))} кг × ${r.conv.per} бр/кг = ${erpNum(r.conv.kgTotal)}</span>`) : ""}</div>
    <div class="ai-row-map"><div class="ai-prod" id="pai-map-${r.i}">${erpPuAIMatLabel(r)}</div><button type="button" class="btn btn-small pai-pick" data-i="${r.i}">🔎 Материал</button></div>
    ${sugg}
    <div class="ai-row-fields">
      <label>Артикул <input type="text" class="pai-art" data-i="${r.i}" value="${escapeAttr(r.article)}" style="width:140px" /></label>
      <label>Бр. <input type="number" class="pai-qty" data-i="${r.i}" min="0" step="any" value="${escapeAttr(String(r.qty))}" /></label>
      <label>Ед. цена <input type="number" class="pai-price" data-i="${r.i}" min="0" step="any" value="${escapeAttr(String(r.unitPrice))}" placeholder="0.00" /></label>
      <button type="button" class="btn btn-small btn-danger pai-rm" data-i="${r.i}">×</button>
    </div>
  </div>`;
}
function erpPuAIWireRows() {
  const box = document.getElementById("pai-rows");
  const rowOf = el => PAI.rows.find(r => r.i === Number(el.dataset.i));
  box.querySelectorAll(".pai-art").forEach(el => el.addEventListener("input", () => rowOf(el).article = el.value));
  box.querySelectorAll(".pai-qty").forEach(el => el.addEventListener("input", () => { rowOf(el).qty = erpToNum(el.value); erpPuAITotalsBox(); }));
  box.querySelectorAll(".pai-price").forEach(el => el.addEventListener("input", () => { rowOf(el).unitPrice = erpToNum(el.value); erpPuAITotalsBox(); }));
  box.querySelectorAll(".pai-pick").forEach(el => el.addEventListener("click", () => erpPuAIPick(rowOf(el))));
  box.querySelectorAll(".ai-sugg-btn").forEach(el => el.addEventListener("click", () => { const r = PAI.rows.find(x => x.i === Number(el.dataset.i)); const m = ERP.matById[Number(el.dataset.mid)]; if (m) { r.materialId = m.id; r.code = m.code; r.article = m.name; r.groupName = m.group_name || r.groupName; r.confidence = "high"; erpPuAIRedrawRow(r); } }));
  box.querySelectorAll(".pai-rm").forEach(el => el.addEventListener("click", () => { const i = Number(el.dataset.i); PAI.rows = PAI.rows.filter(r => r.i !== i); const n = box.querySelector(`.ai-row[data-i="${i}"]`); if (n) n.remove(); erpPuAITotalsBox(); }));
}
function erpPuAIRedrawRow(r) {
  const node = document.querySelector(`#pai-rows .ai-row[data-i="${r.i}"]`); if (!node) return;
  const tmp = document.createElement("div"); tmp.innerHTML = erpPuAIRowHtml(r); node.replaceWith(tmp.firstElementChild); erpPuAIWireRows();
}
function erpPuAIPick(r) {
  const { wrap, close } = erpDialog(`
    <h3>Свържи с материал (за склад)</h3>
    <p class="hint" style="margin:0 0 6px">${escapeHtml(r.desc || "")}</p>
    <input type="search" id="paip-q" placeholder="търси код или име…" />
    <div id="paip-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="paip-clear">Само разход (без материал)</button><button class="btn" id="paip-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#paip-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = (ERP.materials || []).slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(m => `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">${escapeHtml(m.unit || "")}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => { const m = ERP.matById[Number(b.dataset.id)]; r.materialId = m.id; r.code = m.code; r.article = m.name; r.groupName = m.group_name || r.groupName; r.unit = m.unit || r.unit; r.confidence = "high"; r.userPicked = true; close(); erpPuAIRedrawRow(r); }));
  };
  const q0 = (r.desc || "").split(/\s+/).slice(0, 2).join(" ");
  render(q0); wrap.querySelector("#paip-q").value = q0;
  wrap.querySelector("#paip-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#paip-clear").addEventListener("click", () => { r.materialId = null; r.confidence = "none"; close(); erpPuAIRedrawRow(r); });
  wrap.querySelector("#paip-cancel").addEventListener("click", close);
}

async function erpPuAIConfirm() {
  const s = PAI; const st = document.getElementById("pai-cstatus");
  if (!s.rows.length) { st.textContent = "⚠ Няма редове."; return; }
  const bad = s.rows.filter(r => !(erpToNum(r.qty) > 0));
  if (bad.length) { alert("Има редове с количество ≤ 0."); return; }
  if (!s.expenseType && !confirm("Не е избран Вид разход. Да създам черновата без него? (може да се добави и после във формата)")) return;
  // Дубликат: същият № на фактура вече въведен (напр. сканирана два пъти).
  if (s.invoiceNo && typeof erpPuEq === "function") {
    const dup = ((typeof erpPurchases !== "undefined" && erpPurchases) || []).find(p => erpPuEq(p.invoiceNo) === erpPuEq(s.invoiceNo));
    if (dup && !confirm(`⚠ Фактура № ${s.invoiceNo} ВЕЧЕ е въведена: ${dup.supplierName || "?"} · ${dup.posted ? "ЗАПРИХОДЕНА" : "чернова"}.\nАко е същата фактура — спри (има я в списъка).\nДа създам ли въпреки това ВТОРИ запис?`)) return;
  }
  // Сверка на сумите срещу документа — да не се заприходи с грешна стойност.
  const p0 = s.parsed || {};
  if (p0.net_total != null) {
    const base = Math.round(s.rows.reduce((t, r) => t + (erpToNum(r.qty) || 0) * (erpToNum(r.unitPrice) || 0), 0) * 100) / 100;
    const dif = Math.round((base - Number(p0.net_total)) * 100) / 100;
    if (Math.abs(dif) > 0.02 && !confirm(`⚠ Сборът на редовете (${erpNum(base)}) се РАЗЛИЧАВА от основата по документа (${erpNum(p0.net_total)}) с ${erpNum(dif)}.\nПровери количествата и цените. Да продължа въпреки разликата?`)) return;
  }
  const btn = document.getElementById("pai-confirm"); if (btn) { btn.disabled = true; btn.textContent = "Създавам…"; }
  try {
    const purchase = {
      type: "фактура", supplierName: s.supName || "", supplierId: s.supId || null, expenseType: s.expenseType || "",
      invoiceNo: s.invoiceNo || "", date: s.date || new Date().toISOString().slice(0, 10),
      payStatus: s.payStatus || "deferred", termDays: Number(s.termDays) || 0, dueDate: s.dueDate || "", paid: false, paidDate: "",
      currency: s.currency || "BGN", vatRate: 20, note: "", files: [s.fileInfo], aiParsed: s.parsed, posted: false,
      lines: s.rows.map(r => {
        const base = { groupName: r.groupName || s.expenseType || "", article: r.article || r.desc || "", code: r.code || "", qty: erpToNum(r.qty) || 1, unit: r.unit || "бр.", unitPrice: erpToNum(r.unitPrice) || "" };
        if (r.materialId && ERP.matById[r.materialId]) { const m = ERP.matById[r.materialId]; base.materialId = m.id; base.name = m.name; base.code = m.code; }
        return base;
      }),
    };
    if (typeof erpPuApplyPay === "function") erpPuApplyPay(purchase);   // канонични полета по статуса
    await erpSavePurchase(purchase);
    const pairs = s.rows.filter(r => r.desc && (r.materialId || r.code)).map(r => ({ desc: r.desc, materialId: r.materialId, code: r.code, article: r.article, groupName: r.groupName }));
    try { await erpMatLearnAliases(s.supId, s.supName, pairs); } catch (e) { console.warn(e); }
    await erpLoadPurchases();
    PAI = null;
    const fresh = (erpPurchases || []).find(x => String(x.id) === String(purchase.id)) || purchase;
    erpRenderPurchaseForm(JSON.parse(JSON.stringify(fresh)));
  } catch (e) {
    st.textContent = "⚠ Грешка: " + (e.message || e);
    if (btn) { btn.disabled = false; btn.textContent = "✓ Потвърди → чернова покупка"; }
  }
}
