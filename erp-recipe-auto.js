/* Данко Системс — ЕРП „Автоматизиране на рецепти".
   Три инструмента за по-бързо съставяне на технология:
   1) Копирай рецепта от подобен продукт (клониране + донагласяне) — тук.
   2) Шаблони по семейство (параметрични) — в erp-recipe-templates частта.
   3) AI чернова от чертеж — reuse на parse-document.
   Ползва ERP/erpDialog/erpReloadRecipe/erpToNum/escapeHtml/sb. */

/* ---------- Общи помощни ---------- */
function raNorm(s) { return String(s || "").toLowerCase().replace(/[^a-zа-я0-9]+/gi, " ").replace(/\s+/g, " ").trim(); }
function raTokens(s) { return raNorm(s).split(" ").filter(t => t.length >= 3); }
// Има ли findId някъде в дървото на rootId (за пазене от цикъл при копиране)?
function raRecipeContains(rootId, findId, seen) {
  seen = seen || new Set();
  if (seen.has(rootId)) return false; seen.add(rootId);
  for (const l of (ERP.linesByProduct[rootId] || [])) {
    if (l.child_product_id) {
      if (Number(l.child_product_id) === Number(findId)) return true;
      if (raRecipeContains(l.child_product_id, findId, seen)) return true;
    }
  }
  return false;
}
function raRecipeLineCount(pid) { return (ERP.linesByProduct[pid] || []).length; }

/* ---------- 1) Копирай рецепта от подобен продукт ---------- */
function erpCopyRecipeFrom(targetId) {
  const target = ERP.prodById[targetId];
  if (!target) return;
  const tTok = raTokens(target.name);
  const tGroup = raNorm(target.group_name);
  // Кандидати: продукти С рецепта, различни от целта.
  const cands = (ERP.products || []).filter(p => p.id !== targetId && raRecipeLineCount(p.id) > 0).map(p => {
    const pTok = raTokens(p.name);
    const shared = pTok.filter(t => tTok.includes(t)).length;
    const groupBonus = (tGroup && raNorm(p.group_name) === tGroup) ? 2 : 0;
    return { p, score: shared * 2 + groupBonus, lines: raRecipeLineCount(p.id) };
  });
  cands.sort((a, b) => b.score - a.score || (a.p.name || "").localeCompare(b.p.name || "", "bg"));

  const { wrap, close } = erpDialog(`
    <h3>📋 Копирай рецепта от подобен продукт</h3>
    <p class="hint" style="margin:0 0 6px">За: <b>${escapeHtml(target.code || "")}</b> ${escapeHtml(target.name || "")}. Избери продукт с готова рецепта — тя се копира тук, после донагласяш.</p>
    <input type="search" id="ra-q" placeholder="търси код или име…" />
    <div id="ra-list" class="erp-lp-list" style="max-height:52vh;overflow:auto"></div>
    <label class="erp-inline" style="margin-top:6px"><input type="checkbox" id="ra-replace" ${raRecipeLineCount(targetId) ? "checked" : ""} /> Замести текущата рецепта (иначе добавя най-отдолу)</label>
    <div class="erp-dialog-actions"><button class="btn" id="ra-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#ra-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = cands;
    if (q) list = cands.filter(c => ((c.p.code || "") + " " + (c.p.name || "")).toLowerCase().includes(q));
    listEl.innerHTML = list.slice(0, 60).map(c =>
      `<button type="button" class="erp-lp-item" data-id="${c.p.id}"><b>${escapeHtml(c.p.code || "")}</b> ${escapeHtml(c.p.name || "")} <span class="erp-muted">${c.lines} реда${c.score > 0 && !q ? " · подобен" : ""}</span></button>`).join("")
      || `<p class="report-empty">Няма продукти с рецепта.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", async () => {
      const sourceId = Number(b.dataset.id);
      const replace = wrap.querySelector("#ra-replace").checked;
      const src = ERP.prodById[sourceId];
      if (!confirm(`Да копирам ли рецептата на „${src.code || ""} ${src.name || ""}" (${raRecipeLineCount(sourceId)} реда)${replace ? " и да заместя текущата" : ""}?`)) return;
      close();
      await erpDoCopyRecipe(targetId, sourceId, replace);
    }));
  };
  render(""); wrap.querySelector("#ra-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#ra-cancel").addEventListener("click", close);
}

async function erpDoCopyRecipe(targetId, sourceId, replace) {
  const src = (ERP.linesByProduct[sourceId] || []).slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  if (!src.length) { alert("Изворният продукт няма рецепта."); return; }
  if (raRecipeContains(sourceId, targetId)) { alert("Не може — това създава цикъл (изворът съдържа този продукт като възел)."); return; }
  try {
    if (replace) { const del = await sb.from("recipe_lines").delete().eq("product_id", targetId); if (del.error) throw del.error; }
    const start = replace ? 0 : raRecipeLineCount(targetId);
    const rows = src.map((l, i) => ({
      product_id: targetId, position: start + i, quantity: l.quantity, unit: l.unit,
      material_id: l.material_id || null,
      child_product_id: (Number(l.child_product_id) === Number(targetId)) ? null : (l.child_product_id || null),
      operation_id: l.operation_id || null,
    })).filter(r => r.material_id || r.child_product_id || r.operation_id);
    const ins = await sb.from("recipe_lines").insert(rows);
    if (ins.error) throw ins.error;
    // Ако продуктът беше маркиран „чака рецепта" — вече има.
    try { const p = ERP.prodById[targetId]; if (p && p.needs_recipe) await sb.from("products").update({ needs_recipe: false }).eq("id", targetId); } catch (e) {}
    await erpReloadRecipe(targetId);
    alert(`Готово! Копирани ${rows.length} реда. Прегледай и донагласи количествата/възлите.`);
  } catch (e) { alert("Грешка при копиране: " + (e.message || e)); }
}

/* ---------- 3) AI чернова от чертеж ---------- */
// Разчита чертеж (PDF/снимка) → изважда спецификацията (части + брой) → съпоставя
// с наш материал / възел → създава редове на рецептата. AI чете, ти потвърждаваш.
let RAI = null;

function erpRecipeAIStart(productId) {
  const { wrap, close } = erpDialog(`
    <h3>🤖 Рецепта от чертеж (AI)</h3>
    <p class="hint" style="margin:0 0 8px">Качи чертеж със спецификация (PDF/снимка). Claude изважда частите и броя; ти ги свързваш с наши материали/възли. Операциите добавяш после.</p>
    <label class="btn co-attach-btn" style="display:inline-block">⬆ Избери файл<input type="file" id="rai-file" accept="application/pdf,image/*" hidden /></label>
    <span id="rai-fname" class="erp-muted"></span>
    <p class="save-status" id="rai-status"></p>
    <div class="erp-dialog-actions"><button class="btn" id="rai-cancel">Отказ</button><button class="btn btn-primary" id="rai-go" disabled>Разчети</button></div>`);
  let chosen = null;
  const st = wrap.querySelector("#rai-status"), inp = wrap.querySelector("#rai-file"), go = wrap.querySelector("#rai-go");
  inp.addEventListener("change", () => { chosen = inp.files && inp.files[0]; wrap.querySelector("#rai-fname").textContent = chosen ? "  " + chosen.name : ""; go.disabled = !chosen; });
  wrap.querySelector("#rai-cancel").addEventListener("click", close);
  go.addEventListener("click", async () => { if (!chosen) return; go.disabled = true; inp.disabled = true; try { await erpRecipeAIUploadParse(productId, chosen, st); close(); } catch (e) { st.textContent = "⚠ " + (e.message || e); go.disabled = false; inp.disabled = false; } });
}

async function erpRecipeAIUploadParse(productId, file, st) {
  if (st) st.textContent = "Качвам файла…";
  const path = `recipes/ai/${Date.now()}-${safeName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, file);
  if (up.error) throw new Error("Качване: " + up.error.message);
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const fileInfo = { name: file.name, type: file.type, path, url: pub.publicUrl };
  if (st) st.textContent = "Claude разчита чертежа…";
  const cfg = window.DANKO_CONFIG || {};
  let token = cfg.SUPABASE_ANON_KEY;
  try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
  const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/parse-document", {
    method: "POST", headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
    body: JSON.stringify({ file_url: fileInfo.url, media_type: file.type, doc_type: "чертеж" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ("HTTP " + res.status));
  erpRecipeAIRender(productId, j.parsed || {}, fileInfo, j.usage);
}

// Съпоставяне на част от чертежа с наш материал ИЛИ възел (продукт).
function raMatchPart(desc) {
  const nn = raNorm(desc), toks = raTokens(desc);
  const score = (name, code) => {
    let s = 0; const mn = raNorm(name), mc = raNorm(code);
    if (nn && mn && mn === nn) s += 8; else if (nn && mn && (mn.includes(nn) || nn.includes(mn))) s += 4;
    if (mc && nn.includes(mc)) s += 5;
    toks.forEach(t => { if (mn.includes(t)) s += 1; });
    return s;
  };
  const mats = (ERP.materials || []).map(m => ({ kind: "material", refId: m.id, code: m.code, name: m.name, score: score(m.name, m.code) })).filter(x => x.score > 0);
  const prods = (ERP.products || []).map(p => ({ kind: "child", refId: p.id, code: p.code, name: p.name, score: score(p.name, p.code) })).filter(x => x.score > 0);
  const all = mats.concat(prods).sort((a, b) => b.score - a.score).slice(0, 6);
  return { suggestions: all, best: all[0] || null };
}

function erpRecipeAIRender(productId, parsed, fileInfo, usage) {
  const rows = (parsed.lines || []).map((l, i) => {
    const desc = l.client_name || "";
    const m = raMatchPart(desc);
    const best = (m.best && m.best.score >= 6) ? m.best : null;
    return { i, desc, code: l.client_code || "", qty: l.quantity != null ? l.quantity : 1, unit: l.unit || "бр.",
      kind: best ? best.kind : null, refId: best ? best.refId : null, refCode: best ? best.code : "", refName: best ? best.name : "",
      confidence: best ? "mid" : "none", suggestions: m.suggestions };
  });
  RAI = { productId, parsed, fileInfo, usage, rows };
  erpRecipeAIDraw();
}

function erpRecipeAIDraw() {
  const v = erpView(); const s = RAI; const p = ERP.prodById[s.productId] || {};
  const isPdf = (s.fileInfo.type || "").includes("pdf") || /\.pdf(\?|$)/i.test(s.fileInfo.url);
  const content = isPdf
    ? `<iframe src="${escapeAttr(s.fileInfo.url + "#navpanes=0&toolbar=0&view=Fit")}" class="ai-doc-content" title="чертеж"></iframe>`
    : `<img src="${escapeAttr(s.fileInfo.url)}" class="ai-doc-content" alt="чертеж" />`;
  const u = s.usage ? ` · токени: ${(s.usage.input_tokens || 0) + (s.usage.output_tokens || 0)}` : "";
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="rai-back">← Назад към рецептата</button>
      <span class="erp-count">🤖 ${escapeHtml(p.code || "")} ${escapeHtml(p.name || "")} — части от чертежа${u}</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="rai-confirm">✓ Добави свързаните към рецептата</button>
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
        <p class="ai-legend">Всяка част → свържи с наш <b>материал</b> или <b>възел</b> (продукт) и въведи брой на 1 изделие. Несвързаните се пропускат. Операциите добавяш после в рецептата.</p>
        <div id="rai-rows">${s.rows.map(erpRecipeAIRowHtml).join("")}</div>
        <p class="save-status" id="rai-cstatus"></p>
      </div>
    </div>`;
  document.getElementById("rai-back").addEventListener("click", () => { if (confirm("Да се откажа? Нищо не е добавено още.")) erpRenderRecipe(s.productId); });
  document.getElementById("rai-confirm").addEventListener("click", erpRecipeAIConfirm);
  if (typeof erpAISetupViewer === "function") erpAISetupViewer();
  erpRecipeAIWireRows();
}

function erpRecipeAIMapLabel(r) {
  if (r.kind === "material") return `🧱 <b>${escapeHtml(r.refCode || "")}</b> ${escapeHtml(r.refName || "")} <span class="erp-muted">материал</span>`;
  if (r.kind === "child") return `🔩 <b>${escapeHtml(r.refCode || "")}</b> ${escapeHtml(r.refName || "")} <span class="erp-muted">възел</span>`;
  return `<span class="ai-c-none">— свържи —</span>`;
}
function erpRecipeAIRowHtml(r) {
  const sugg = (!r.refId && r.suggestions.length)
    ? `<div class="ai-sugg">Предложения: ${r.suggestions.map(x => `<button type="button" class="ai-sugg-btn" data-i="${r.i}" data-kind="${x.kind}" data-ref="${x.refId}">${x.kind === "material" ? "🧱" : "🔩"} <b>${escapeHtml(x.code || "")}</b> ${escapeHtml((x.name || "").slice(0, 22))}</button>`).join("")}</div>` : "";
  return `<div class="ai-row" data-i="${r.i}">
    <div class="ai-row-top"><span class="ai-dot ai-c-${r.confidence}">●</span><span class="ai-cn">${escapeHtml(r.desc || "")}</span>${r.code ? `<span class="ai-cc">${escapeHtml(r.code)}</span>` : ""}</div>
    <div class="ai-row-map"><div class="ai-prod" id="rai-map-${r.i}">${erpRecipeAIMapLabel(r)}</div><button type="button" class="btn btn-small rai-pick" data-i="${r.i}">🔎 Свържи</button></div>
    ${sugg}
    <div class="ai-row-fields">
      <label>Брой на 1 изделие <input type="number" class="rai-qty" data-i="${r.i}" min="0" step="any" value="${escapeAttr(String(r.qty))}" /></label>
      <button type="button" class="btn btn-small btn-danger rai-rm" data-i="${r.i}">×</button>
    </div>
  </div>`;
}
function erpRecipeAIWireRows() {
  const box = document.getElementById("rai-rows");
  const rowOf = el => RAI.rows.find(r => r.i === Number(el.dataset.i));
  box.querySelectorAll(".rai-qty").forEach(el => el.addEventListener("input", () => rowOf(el).qty = erpToNum(el.value)));
  box.querySelectorAll(".rai-pick").forEach(el => el.addEventListener("click", () => erpRecipeAIPick(rowOf(el))));
  box.querySelectorAll(".ai-sugg-btn").forEach(el => el.addEventListener("click", () => {
    const r = RAI.rows.find(x => x.i === Number(el.dataset.i));
    const kind = el.dataset.kind, ref = Number(el.dataset.ref);
    const obj = kind === "material" ? ERP.matById[ref] : ERP.prodById[ref];
    if (obj) { r.kind = kind; r.refId = ref; r.refCode = obj.code; r.refName = obj.name; r.confidence = "high"; erpRecipeAIRedrawRow(r); }
  }));
  box.querySelectorAll(".rai-rm").forEach(el => el.addEventListener("click", () => { const i = Number(el.dataset.i); RAI.rows = RAI.rows.filter(r => r.i !== i); const n = box.querySelector(`.ai-row[data-i="${i}"]`); if (n) n.remove(); }));
}
function erpRecipeAIRedrawRow(r) { const n = document.querySelector(`#rai-rows .ai-row[data-i="${r.i}"]`); if (!n) return; const t = document.createElement("div"); t.innerHTML = erpRecipeAIRowHtml(r); n.replaceWith(t.firstElementChild); erpRecipeAIWireRows(); }
function erpRecipeAIPick(r) {
  const { wrap, close } = erpDialog(`
    <h3>Свържи част с наш материал / възел</h3>
    <p class="hint" style="margin:0 0 6px">${escapeHtml(r.desc || "")}</p>
    <div class="pr-row" style="margin-bottom:6px"><button class="btn btn-small btn-primary" id="raip-mat">🧱 Материал</button><button class="btn btn-small" id="raip-prod">🔩 Възел (продукт)</button></div>
    <input type="search" id="raip-q" placeholder="търси код или име…" />
    <div id="raip-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="raip-cancel">Затвори</button></div>`);
  let mode = "material";
  const listEl = wrap.querySelector("#raip-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    const src = mode === "material" ? (ERP.materials || []) : (ERP.products || []);
    let list = src.slice();
    if (q) list = list.filter(x => ((x.code || "") + " " + (x.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(x => `<button type="button" class="erp-lp-item" data-id="${x.id}"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml(x.name || "")}</button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const obj = mode === "material" ? ERP.matById[Number(b.dataset.id)] : ERP.prodById[Number(b.dataset.id)];
      r.kind = mode === "material" ? "material" : "child"; r.refId = obj.id; r.refCode = obj.code; r.refName = obj.name; r.confidence = "high";
      close(); erpRecipeAIRedrawRow(r);
    }));
  };
  const setMode = m => { mode = m; wrap.querySelector("#raip-mat").classList.toggle("btn-primary", m === "material"); wrap.querySelector("#raip-prod").classList.toggle("btn-primary", m === "child"); render(wrap.querySelector("#raip-q").value); };
  wrap.querySelector("#raip-mat").addEventListener("click", () => setMode("material"));
  wrap.querySelector("#raip-prod").addEventListener("click", () => setMode("child"));
  const q0 = (r.desc || "").split(/\s+/).slice(0, 2).join(" ");
  render(q0); wrap.querySelector("#raip-q").value = q0;
  wrap.querySelector("#raip-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#raip-cancel").addEventListener("click", close);
}

async function erpRecipeAIConfirm() {
  const s = RAI; const st = document.getElementById("rai-cstatus");
  const mapped = s.rows.filter(r => r.refId && (erpToNum(r.qty) > 0));
  if (!mapped.length) { alert("Няма свързани части. Свържи поне една с материал/възел."); return; }
  if (!confirm(`Да добавя ли ${mapped.length} реда към рецептата на този продукт? (несвързаните се пропускат)`)) return;
  const btn = document.getElementById("rai-confirm"); if (btn) { btn.disabled = true; btn.textContent = "Добавям…"; }
  try {
    const start = raRecipeLineCount(s.productId);
    const rows = mapped.map((r, i) => ({
      product_id: s.productId, position: start + i, quantity: erpToNum(r.qty) || 1, unit: r.unit || "бр.",
      material_id: r.kind === "material" ? r.refId : null,
      child_product_id: r.kind === "child" ? (Number(r.refId) === Number(s.productId) ? null : r.refId) : null,
      operation_id: null,
    })).filter(x => x.material_id || x.child_product_id);
    const ins = await sb.from("recipe_lines").insert(rows);
    if (ins.error) throw ins.error;
    try { const p = ERP.prodById[s.productId]; if (p && p.needs_recipe) await sb.from("products").update({ needs_recipe: false }).eq("id", s.productId); } catch (e) {}
    const pid = s.productId; RAI = null;
    await erpReloadRecipe(pid);
    alert(`Добавени ${rows.length} реда. Сега добави операциите (лазер/заваряване/боя) и провери количествата.`);
  } catch (e) { st.textContent = "⚠ Грешка: " + (e.message || e); if (btn) { btn.disabled = false; btn.textContent = "✓ Добави свързаните към рецептата"; } }
}
