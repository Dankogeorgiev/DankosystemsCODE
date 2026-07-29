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
   бройки по таблицата на Данко (28.07.2026). per = бройки в 1 килограм.
   ⚠ Таблицата му има ДВА комплекта коефициенти — тук е първият; при друг
   тип нит коригирай бройката на ръка или кажи на Клод да добави втори ред. */
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
    if (/^\s*(кг|kg)\.?\s*$/i.test(unit)) {
      const matName = (m.materialId && ERP.matById && ERP.matById[m.materialId]) ? (ERP.matById[m.materialId].name || "") : "";
      if (/нит|rivet/i.test(desc + " " + matName)) {
        const per = PU_NIT_PER_KG[puNitKey(desc + " " + matName)];
        if (per) {
          conv = { kg: qty, per };
          qty = Math.round(qty * per);
          if (unitPrice !== "") unitPrice = Math.round((unitPrice / per) * 10000) / 10000;
          unit = "бр.";
        }
      }
    }
    return { i, desc, supplierCode: l.client_code || "", qty, unit, unitPrice, conv,
      materialId: m.materialId || null, code: m.code || "", article: m.article || desc, groupName: m.groupName || "", confidence: m.confidence, suggestions: m.suggestions || [] };
  });
  PAI = { parsed, fileInfo, usage, suppliers, supId: ctx.supId, supName: ctx.supName, invoiceNo: parsed.order_no || "", date: parsed.order_date || new Date().toISOString().slice(0, 10), currency: /eur|евро|€/i.test(parsed.currency || "") ? "EUR" : "BGN", rows };
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
        </div>
        <p class="ai-legend"><span class="ai-c-high">●</span> висока (авто) · <span class="ai-c-mid">●</span> средна · <span class="ai-c-none">●</span> няма. Свържи всеки ред с наш материал (за склад) или го остави като разход с група/артикул. Плащането се въвежда на следващата стъпка.</p>
        <div id="pai-rows">${s.rows.map(erpPuAIRowHtml).join("")}</div>
        <p class="save-status" id="pai-cstatus"></p>
      </div>
    </div>`;
  document.getElementById("pai-back").addEventListener("click", () => { if (confirm("Да се откажа? Черновата още не е създадена.")) erpRenderPurchases(); });
  document.getElementById("pai-confirm").addEventListener("click", erpPuAIConfirm);
  document.getElementById("pai-sup").addEventListener("input", e => { s.supName = e.target.value; const m = s.suppliers.find(x => x.name === e.target.value); s.supId = m ? m.id : null; });
  document.getElementById("pai-no").addEventListener("input", e => s.invoiceNo = e.target.value);
  document.getElementById("pai-date").addEventListener("input", e => s.date = e.target.value);
  document.getElementById("pai-cur").addEventListener("change", e => s.currency = e.target.value);
  if (typeof erpAISetupViewer === "function") erpAISetupViewer();
  erpPuAIWireRows();
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
    <div class="ai-row-top"><span class="ai-dot ai-c-${r.confidence}">●</span><span class="ai-cn">${escapeHtml(r.desc || "")}</span>${r.supplierCode ? `<span class="ai-cc">${escapeHtml(r.supplierCode)}</span>` : ""}${r.conv ? `<span class="ai-cc" title="фактурата е в килограми — превърнато в бройки">⚖ ${escapeHtml(String(r.conv.kg))} кг × ${r.conv.per} бр/кг</span>` : ""}</div>
    <div class="ai-row-map"><div class="ai-prod" id="pai-map-${r.i}">${erpPuAIMatLabel(r)}</div><button type="button" class="btn btn-small pai-pick" data-i="${r.i}">🔎 Материал</button></div>
    ${sugg}
    <div class="ai-row-fields">
      <label>Група <input type="text" class="pai-grp" data-i="${r.i}" list="pu-groups" value="${escapeAttr(r.groupName)}" style="width:110px" /></label>
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
  box.querySelectorAll(".pai-grp").forEach(el => el.addEventListener("input", () => rowOf(el).groupName = el.value));
  box.querySelectorAll(".pai-art").forEach(el => el.addEventListener("input", () => rowOf(el).article = el.value));
  box.querySelectorAll(".pai-qty").forEach(el => el.addEventListener("input", () => rowOf(el).qty = erpToNum(el.value)));
  box.querySelectorAll(".pai-price").forEach(el => el.addEventListener("input", () => rowOf(el).unitPrice = erpToNum(el.value)));
  box.querySelectorAll(".pai-pick").forEach(el => el.addEventListener("click", () => erpPuAIPick(rowOf(el))));
  box.querySelectorAll(".ai-sugg-btn").forEach(el => el.addEventListener("click", () => { const r = PAI.rows.find(x => x.i === Number(el.dataset.i)); const m = ERP.matById[Number(el.dataset.mid)]; if (m) { r.materialId = m.id; r.code = m.code; r.article = m.name; r.groupName = m.group_name || r.groupName; r.confidence = "high"; erpPuAIRedrawRow(r); } }));
  box.querySelectorAll(".pai-rm").forEach(el => el.addEventListener("click", () => { const i = Number(el.dataset.i); PAI.rows = PAI.rows.filter(r => r.i !== i); const n = box.querySelector(`.ai-row[data-i="${i}"]`); if (n) n.remove(); }));
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
  const btn = document.getElementById("pai-confirm"); if (btn) { btn.disabled = true; btn.textContent = "Създавам…"; }
  try {
    const purchase = {
      type: "фактура", supplierName: s.supName || "", supplierId: s.supId || null,
      invoiceNo: s.invoiceNo || "", date: s.date || new Date().toISOString().slice(0, 10),
      paymentMethod: "Банка", termDays: 0, dueDate: "", paid: false, paidDate: "",
      currency: s.currency || "BGN", vatRate: 20, note: "", files: [s.fileInfo], aiParsed: s.parsed, posted: false,
      lines: s.rows.map(r => {
        const base = { groupName: r.groupName || "", article: r.article || r.desc || "", code: r.code || "", qty: erpToNum(r.qty) || 1, unit: r.unit || "бр.", unitPrice: erpToNum(r.unitPrice) || "" };
        if (r.materialId && ERP.matById[r.materialId]) { const m = ERP.matById[r.materialId]; base.materialId = m.id; base.name = m.name; base.code = m.code; }
        return base;
      }),
    };
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
