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

/* ---------- 2) Шаблони по семейство (параметрични) ----------
   Шаблон = многократна рецепта, чиито количества може да са формули с параметри
   (напр. дължина). Пази се в app_config id="recipe_templates":
     { list: [ { id, name, params:[{key,label}], lines:[{type,refId,code,name,unit,qty}] } ] }
   qty е текст: число ("4") или формула ("duljina*2+3"). */
let RA_TEMPLATES = null;

async function raLoadTemplates() {
  if (RA_TEMPLATES) return RA_TEMPLATES;
  try { const { data } = await sb.from("app_config").select("data").eq("id", "recipe_templates").maybeSingle(); RA_TEMPLATES = (data && data.data && data.data.list) || []; }
  catch (e) { RA_TEMPLATES = []; }
  return RA_TEMPLATES;
}
async function raSaveTemplates() {
  const { error } = await sb.from("app_config").upsert({ id: "recipe_templates", data: { list: RA_TEMPLATES || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис на шаблона: " + error.message); return false; }
  return true;
}
function raNewId() { let m = 0; (RA_TEMPLATES || []).forEach(t => { const n = Number(t.id) || 0; if (n > m) m = n; }); return m + 1; }

// Безопасно пресмятане на формула с параметри (само числа/оператори остават).
function raEvalFormula(expr, params) {
  if (expr == null || expr === "") return 0;
  let s = String(expr).trim();
  if (/^-?\d*\.?\d+$/.test(s)) return parseFloat(s);
  s = s.replace(/,/g, ".");
  Object.keys(params || {}).sort((a, b) => b.length - a.length).forEach(k => {
    s = s.replace(new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "g"), "(" + (Number(params[k]) || 0) + ")");
  });
  if (!/^[0-9+\-*/(). ]+$/.test(s)) return NaN;
  try { const val = Function('"use strict";return (' + s + ")")(); return (typeof val === "number" && isFinite(val)) ? val : NaN; } catch (e) { return NaN; }
}
function raRefLabel(l) {
  if (l.type === "material") return "🧱 " + (l.code || "") + " " + (l.name || "");
  if (l.type === "operation") return "⚙️ " + (l.code || "") + " " + (l.name || "");
  return "🔩 " + (l.code || "") + " " + (l.name || "");
}

/* Комбиниран избор: материал / операция / възел → cb({type,refId,code,name,unit}) */
function raPickRef(cb) {
  const { wrap, close } = erpDialog(`
    <h3>Избери съставка</h3>
    <div class="pr-row" style="margin-bottom:6px"><button class="btn btn-small btn-primary" id="rp-m">🧱 Материал</button><button class="btn btn-small" id="rp-o">⚙️ Операция</button><button class="btn btn-small" id="rp-c">🔩 Възел</button></div>
    <input type="search" id="rp-q" placeholder="търси…" />
    <div id="rp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="rp-cancel">Затвори</button></div>`);
  let mode = "material";
  const listEl = wrap.querySelector("#rp-list");
  const src = () => mode === "material" ? (ERP.materials || []) : mode === "operation" ? (ERP.operations || []) : (ERP.products || []);
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = src().slice();
    if (q) list = list.filter(x => ((x.code || "") + " " + (x.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(x => `<button type="button" class="erp-lp-item" data-id="${x.id}"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml(x.name || "")}</button>`).join("") || `<p class="report-empty">Няма.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const x = (mode === "material" ? ERP.matById : mode === "operation" ? ERP.opById : ERP.prodById)[Number(b.dataset.id)];
      cb({ type: mode, refId: x.id, code: x.code, name: x.name, unit: x.unit || "бр." });
      close();
    }));
  };
  const setMode = m => { mode = m; ["m", "o", "c"].forEach(k => wrap.querySelector("#rp-" + k).classList.remove("btn-primary")); wrap.querySelector("#rp-" + (m === "material" ? "m" : m === "operation" ? "o" : "c")).classList.add("btn-primary"); render(wrap.querySelector("#rp-q").value); };
  wrap.querySelector("#rp-m").addEventListener("click", () => setMode("material"));
  wrap.querySelector("#rp-o").addEventListener("click", () => setMode("operation"));
  wrap.querySelector("#rp-c").addEventListener("click", () => setMode("child"));
  render(""); wrap.querySelector("#rp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#rp-cancel").addEventListener("click", close);
}

/* Мениджър на шаблони (от рецептата) */
async function erpRecipeTemplates(productId) {
  await raLoadTemplates();
  const { wrap, close } = erpDialog(`
    <h3>🧩 Шаблони за рецепти</h3>
    <div class="pr-row" style="margin-bottom:8px">
      <button class="btn btn-small" id="tpl-new">+ Нов празен шаблон</button>
      <button class="btn btn-small" id="tpl-fromcur">💾 Запази текущата рецепта като шаблон</button>
    </div>
    <div id="tpl-list" style="max-height:56vh;overflow:auto"></div>
    <div class="erp-dialog-actions"><button class="btn" id="tpl-close">Затвори</button></div>`);
  const listEl = wrap.querySelector("#tpl-list");
  const draw = () => {
    listEl.innerHTML = (RA_TEMPLATES || []).length ? (RA_TEMPLATES.map(t => `
      <div class="tpl-item">
        <div class="tpl-item-main"><b>${escapeHtml(t.name || "шаблон")}</b> <span class="erp-muted">${(t.lines || []).length} реда · ${(t.params || []).length} параметъра</span></div>
        <div class="tpl-item-act"><button class="btn btn-small btn-primary" data-apply="${t.id}">Приложи</button><button class="btn btn-small" data-edit="${t.id}">✎</button><button class="btn btn-small btn-danger" data-del="${t.id}">🗑</button></div>
      </div>`).join("")) : `<p class="report-empty">Още няма шаблони. Създай нов или запази текуща рецепта.</p>`;
    listEl.querySelectorAll("[data-apply]").forEach(b => b.addEventListener("click", () => { close(); erpApplyTemplate(productId, RA_TEMPLATES.find(t => String(t.id) === b.dataset.apply)); }));
    listEl.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => { close(); erpEditTemplate(productId, RA_TEMPLATES.find(t => String(t.id) === b.dataset.edit)); }));
    listEl.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => { if (!confirm("Да изтрия ли шаблона?")) return; RA_TEMPLATES = RA_TEMPLATES.filter(t => String(t.id) !== b.dataset.del); await raSaveTemplates(); draw(); }));
  };
  draw();
  wrap.querySelector("#tpl-close").addEventListener("click", close);
  wrap.querySelector("#tpl-new").addEventListener("click", () => { close(); erpEditTemplate(productId, { id: raNewId(), name: "", params: [], lines: [] }); });
  wrap.querySelector("#tpl-fromcur").addEventListener("click", async () => {
    const cur = (ERP.linesByProduct[productId] || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    if (!cur.length) { alert("Текущата рецепта е празна."); return; }
    const name = prompt("Име на шаблона:", (ERP.prodById[productId] || {}).name || "");
    if (!name) return;
    const lines = cur.map(l => {
      if (l.material_id) { const m = ERP.matById[l.material_id] || {}; return { type: "material", refId: l.material_id, code: m.code, name: m.name, unit: l.unit || m.unit || "бр.", qty: String(l.quantity != null ? l.quantity : 1) }; }
      if (l.operation_id) { const o = ERP.opById[l.operation_id] || {}; return { type: "operation", refId: l.operation_id, code: o.code, name: o.name, unit: l.unit || "бр.", qty: String(l.quantity != null ? l.quantity : 1) }; }
      const c = ERP.prodById[l.child_product_id] || {}; return { type: "child", refId: l.child_product_id, code: c.code, name: c.name, unit: l.unit || "бр.", qty: String(l.quantity != null ? l.quantity : 1) };
    });
    RA_TEMPLATES.push({ id: raNewId(), name: name.trim(), params: [], lines });
    await raSaveTemplates(); close(); alert("Записано като шаблон. Отвори го (✎), за да направиш количествата параметрични.");
  });
}

/* Редактор на шаблон */
function erpEditTemplate(productId, tpl) {
  tpl.params = tpl.params || []; tpl.lines = tpl.lines || [];
  const { wrap, close } = erpDialog(`
    <h3>Шаблон</h3>
    <label>Име <input type="text" id="te-name" value="${escapeAttr(tpl.name || "")}" placeholder="напр. Тръба квадратна (параметрична)" /></label>
    <h4 class="erp-group-head">Параметри <span class="erp-muted">(ключ без интервали, ползва се във формулите)</span></h4>
    <div id="te-params"></div>
    <button class="btn btn-small" id="te-addparam">+ Параметър</button>
    <h4 class="erp-group-head">Редове <span class="erp-muted">(количество = число или формула с параметрите)</span></h4>
    <div id="te-lines"></div>
    <button class="btn btn-small" id="te-addline">+ Ред</button>
    <div class="erp-dialog-actions"><button class="btn" id="te-cancel">Отказ</button><button class="btn btn-primary" id="te-save">Запази шаблона</button></div>`);
  const pWrap = wrap.querySelector("#te-params"), lWrap = wrap.querySelector("#te-lines");
  const drawParams = () => {
    pWrap.innerHTML = tpl.params.map((p, i) => `<div class="tpl-prow"><input type="text" class="te-pkey" data-i="${i}" value="${escapeAttr(p.key || "")}" placeholder="ключ (напр. duljina)" style="width:150px" /><input type="text" class="te-plabel" data-i="${i}" value="${escapeAttr(p.label || "")}" placeholder="описание" /><button class="btn btn-small btn-danger te-prm" data-i="${i}">×</button></div>`).join("");
    pWrap.querySelectorAll(".te-pkey").forEach(el => el.addEventListener("input", () => tpl.params[Number(el.dataset.i)].key = el.value.trim()));
    pWrap.querySelectorAll(".te-plabel").forEach(el => el.addEventListener("input", () => tpl.params[Number(el.dataset.i)].label = el.value));
    pWrap.querySelectorAll(".te-prm").forEach(b => b.addEventListener("click", () => { tpl.params.splice(Number(b.dataset.i), 1); drawParams(); }));
  };
  const drawLines = () => {
    lWrap.innerHTML = tpl.lines.map((l, i) => `<div class="tpl-lrow"><span class="tpl-lref">${escapeHtml(raRefLabel(l))}</span><input type="text" class="te-lqty" data-i="${i}" value="${escapeAttr(String(l.qty != null ? l.qty : ""))}" placeholder="кол. / формула" style="width:140px" /><button class="btn btn-small btn-danger te-lrm" data-i="${i}">×</button></div>`).join("") || `<p class="report-empty">Няма редове.</p>`;
    lWrap.querySelectorAll(".te-lqty").forEach(el => el.addEventListener("input", () => tpl.lines[Number(el.dataset.i)].qty = el.value));
    lWrap.querySelectorAll(".te-lrm").forEach(b => b.addEventListener("click", () => { tpl.lines.splice(Number(b.dataset.i), 1); drawLines(); }));
  };
  drawParams(); drawLines();
  wrap.querySelector("#te-addparam").addEventListener("click", () => { tpl.params.push({ key: "", label: "" }); drawParams(); });
  wrap.querySelector("#te-addline").addEventListener("click", () => raPickRef(ref => { tpl.lines.push({ ...ref, qty: "1" }); drawLines(); }));
  wrap.querySelector("#te-cancel").addEventListener("click", close);
  wrap.querySelector("#te-save").addEventListener("click", async () => {
    tpl.name = wrap.querySelector("#te-name").value.trim() || tpl.name || "шаблон";
    await raLoadTemplates();
    const idx = RA_TEMPLATES.findIndex(t => String(t.id) === String(tpl.id));
    if (idx >= 0) RA_TEMPLATES[idx] = tpl; else RA_TEMPLATES.push(tpl);
    if (await raSaveTemplates()) { close(); erpRecipeTemplates(productId); }
  });
}

/* Прилагане на шаблон: въвеждаш параметрите → преглед → добавя в рецептата */
function erpApplyTemplate(productId, tpl) {
  if (!tpl) return;
  const { wrap, close } = erpDialog(`
    <h3>Приложи „${escapeHtml(tpl.name || "шаблон")}"</h3>
    ${(tpl.params || []).length ? `<h4 class="erp-group-head">Параметри</h4><div id="ap-params">${tpl.params.map(p => `<label class="erp-inline">${escapeHtml(p.label || p.key)} <input type="number" step="any" class="ap-p" data-key="${escapeAttr(p.key)}" value="" placeholder="${escapeAttr(p.key)}" /></label>`).join("")}</div>` : `<p class="hint">Този шаблон няма параметри — количествата са фиксирани.</p>`}
    <div id="ap-preview" style="margin-top:8px"></div>
    <label class="erp-inline"><input type="checkbox" id="ap-replace" /> Замести текущата рецепта</label>
    <div class="erp-dialog-actions"><button class="btn" id="ap-cancel">Отказ</button><button class="btn btn-primary" id="ap-apply">Добави в рецептата</button></div>`);
  const readParams = () => { const pr = {}; wrap.querySelectorAll(".ap-p").forEach(el => pr[el.dataset.key] = Number(el.value) || 0); return pr; };
  const compute = () => (tpl.lines || []).map(l => ({ l, q: raEvalFormula(l.qty, readParams()) }));
  const preview = () => {
    const rows = compute();
    wrap.querySelector("#ap-preview").innerHTML = `<table class="report-table erp-table"><thead><tr><th>Съставка</th><th class="num">Количество</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(raRefLabel(r.l))}</td><td class="num">${isNaN(r.q) ? '<span class="erp-warn">формула?</span>' : (Math.round(r.q * 1000) / 1000)}</td></tr>`).join("")}</tbody></table>`;
  };
  preview(); wrap.querySelectorAll(".ap-p").forEach(el => el.addEventListener("input", preview));
  wrap.querySelector("#ap-cancel").addEventListener("click", close);
  wrap.querySelector("#ap-apply").addEventListener("click", async () => {
    const rows = compute().filter(r => !isNaN(r.q) && r.q > 0);
    if (!rows.length) { alert("Няма валидни редове (провери формулите/параметрите)."); return; }
    const replace = wrap.querySelector("#ap-replace").checked;
    try {
      if (replace) { const del = await sb.from("recipe_lines").delete().eq("product_id", productId); if (del.error) throw del.error; }
      const start = replace ? 0 : raRecipeLineCount(productId);
      const ins = await sb.from("recipe_lines").insert(rows.map((r, i) => ({
        product_id: productId, position: start + i, quantity: r.q, unit: r.l.unit || "бр.",
        material_id: r.l.type === "material" ? r.l.refId : null,
        operation_id: r.l.type === "operation" ? r.l.refId : null,
        child_product_id: r.l.type === "child" ? (Number(r.l.refId) === Number(productId) ? null : r.l.refId) : null,
      })));
      if (ins.error) throw ins.error;
      try { const p = ERP.prodById[productId]; if (p && p.needs_recipe) await sb.from("products").update({ needs_recipe: false }).eq("id", productId); } catch (e) {}
      close(); await erpReloadRecipe(productId);
      alert(`Готово! Добавени ${rows.length} реда от шаблона.`);
    } catch (e) { alert("Грешка: " + (e.message || e)); }
  });
}

/* ---------- Меню „Бързо съставяне" (събира трите инструмента) ---------- */
function erpRecipeAutoMenu(productId) {
  const { wrap, close } = erpDialog(`
    <h3>🪄 Бързо съставяне на рецепта</h3>
    <p class="hint" style="margin:0 0 10px">Три начина да съставиш технологията по-бързо. Всичко се преглежда, преди да влезе.</p>
    <div class="ra-menu">
      <button type="button" class="ra-menu-btn" id="ram-copy"><span class="ram-ic">📋</span><span class="ram-tx"><b>Копирай от подобен</b><small>Взима готова рецепта на близък продукт → донагласяш количествата.</small></span></button>
      <button type="button" class="ra-menu-btn" id="ram-ai"><span class="ram-ic">🤖</span><span class="ram-tx"><b>От чертеж (AI)</b><small>Claude чете чертежа и вади частите → свързваш ги с наши материали/възли.</small></span></button>
      <button type="button" class="ra-menu-btn" id="ram-tpl"><span class="ram-ic">🧩</span><span class="ram-tx"><b>Шаблони</b><small>Параметрични шаблони по семейство — количества по формула (напр. дължина).</small></span></button>
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="ram-cancel">Затвори</button></div>`);
  wrap.querySelector("#ram-copy").addEventListener("click", () => { close(); erpCopyRecipeFrom(productId); });
  wrap.querySelector("#ram-ai").addEventListener("click", () => { close(); erpRecipeAIStart(productId); });
  wrap.querySelector("#ram-tpl").addEventListener("click", () => { close(); erpRecipeTemplates(productId); });
  wrap.querySelector("#ram-cancel").addEventListener("click", close);
}
