/* Данко Системс — 📋 РЪЧЕН палетен опис към заявка (Данко, 14.11.2026).
   Автоматичните описи от Опаковки не хващат всички специфики, затова Данко
   си прави описа НА РЪКА: от формата на заявката, бутон „📋 Палетен опис".
   Правила:
   • пише се красивата бланка от Опаковки, но с ЕДНО лого (не две);
   • „ПАЛЕТ № 1", „№ 2"… — БЕЗ „/ общо" (до последно не се знае броят);
   • Данко въвежда КОД и БРОЙКИ → името и килограмите излизат сами
     (кг/брой от Опаковки-спецификацията или от рецептата × бройките),
     но и името, и килограмите могат да се променят на ръка;
   • описът се пази НА заявката (o.palletManual) — отваряш пак и продължаваш.
   Отваря се В ЕКРАНА (без изскачащ прозорец), с „← Назад" към заявката. */

let PM_ORDER = null;          // заявката, по която работим
let PM_DATA = null;           // { pallets: [{ type, palletKg, rows: [{code,name,qty,kg,kgAuto,boxes}] }] }
let PM_PRODUCTS = null;       // код → { id, name } за автопопълване

function pmNum(x) { const n = parseFloat(String(x == null ? "" : x).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function pmR1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

async function pmEnsureLookups() {
  // Опаковките (кг/брой при клиента) + каталогът продукти (име по код).
  try { if (typeof PACKAGING !== "undefined" && !PACKAGING && typeof erpPackLoad === "function") await erpPackLoad(); } catch (e) {}
  if (!PM_PRODUCTS) {
    PM_PRODUCTS = new Map();
    try {
      const { data } = await erpSelectAll("products", "id,code,name");
      (data || []).forEach(p => { if (p.code) PM_PRODUCTS.set(String(p.code).trim().toLowerCase(), { id: p.id, name: p.name || "" }); });
    } catch (e) {}
    // Бързите (нестандартни) изделия също се познават по код.
    try {
      if (typeof quickLoad === "function") await quickLoad();
      const by = (typeof QUICK !== "undefined" && QUICK && QUICK.byId) || {};
      Object.values(by).forEach(q => {
        const k = String((q && q.code) || "").trim().toLowerCase();
        if (k && !PM_PRODUCTS.has(k)) PM_PRODUCTS.set(k, { id: null, name: (q && q.name) || "" });
      });
    } catch (e) {}
  }
}

/* Име + кг/брой по код: 1) името при клиента от Опаковки; 2) каталога;
   3) редът на самата заявка (ако кодът е от нея). */
function pmLookup(code) {
  const key = String(code || "").trim().toLowerCase();
  if (!key) return { name: "", kgPer: 0 };
  const hit = PM_PRODUCTS && PM_PRODUCTS.get(key);
  const spec = (typeof erpPackFind === "function") ? erpPackFind(code, PM_ORDER && PM_ORDER.clientName) : null;
  let name = (spec && spec.clientProductName) || (hit && hit.name) || "";
  if (!name && PM_ORDER) {
    const l = (PM_ORDER.lines || []).find(x => String(x.code || "").trim().toLowerCase() === key);
    if (l) name = l.name || "";
  }
  // Износ: името на английски, ако Опаковки знаят превода (може да се пренапише).
  if (name && typeof packIsExport === "function" && packIsExport(PM_ORDER) && typeof packEnRowName === "function") {
    try { const en = packEnRowName({ code, name }); if (en) name = en; } catch (e) {}
  }
  let kgPer = 0;
  if (typeof packKgFor === "function") kgPer = packKgFor(code, PM_ORDER && PM_ORDER.clientName, hit && hit.id) || 0;
  return { name, kgPer };
}

async function pmOpen(o) {
  PM_ORDER = o;
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане на описа…</p>`;
  await pmEnsureLookups();
  // Кг от рецептите иска пълното ERP зареждане — опитваме тихо (не е фатално).
  try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); } catch (e) {}
  PM_DATA = (o.palletManual && Array.isArray(o.palletManual.pallets))
    ? JSON.parse(JSON.stringify(o.palletManual))
    : { pallets: [{ type: "EUR 120×80", palletKg: 20, rows: [] }] };
  pmRender();
}

function pmPalletHtml(p, pi) {
  const rows = (p.rows || []).map((r, ri) => `
    <tr data-pi="${pi}" data-ri="${ri}">
      <td data-label="Код"><input class="pm-code" value="${escapeAttr(r.code || "")}" placeholder="код…" style="width:110px;font-weight:700" /></td>
      <td class="pum-nt" data-label="Наименование"><input class="pm-name" value="${escapeAttr(r.name || "")}" placeholder="излиза само̀ по кода" style="width:100%;min-width:220px" /></td>
      <td data-label="Кашони/бележка"><input class="pm-boxes" value="${escapeAttr(r.boxes || "")}" placeholder="напр. 4 кашона" style="width:140px" /></td>
      <td class="num" data-label="Бройка"><input type="text" inputmode="numeric" class="pm-qty" value="${escapeAttr(String(r.qty != null && r.qty !== "" ? r.qty : ""))}" style="width:84px;text-align:right" /></td>
      <td class="num" data-label="Нето кг"><input type="text" inputmode="decimal" class="pm-kg" value="${escapeAttr(String(r.kg != null && r.kg !== "" ? r.kg : ""))}" title="Смята се само̀: кг/брой × бройката. Напишеш ли число на ръка — то остава (изчисти полето, за да се върне на автоматичното)." style="width:92px;text-align:right${r.kgManual ? ";border-color:#f59e0b;font-weight:700" : ""}" /></td>
      <td class="erp-row-actions"><button class="btn btn-small btn-danger pm-delrow" title="Махни реда">✕</button></td>
    </tr>`).join("");
  const net = pmR1((p.rows || []).reduce((s, r) => s + pmNum(r.kg), 0));
  const palKg = pmNum(p.palletKg) || 20;
  return `
  <div class="card" style="margin:10px 0;padding:12px 14px" data-pal="${pi}">
    <div class="erp-toolbar" style="margin:0 0 6px">
      <span class="erp-count" style="font-size:17px"><b>ПАЛЕТ № ${pi + 1}</b></span>
      <label class="erp-inline">Вид <select class="pm-type" data-pi="${pi}">${["EUR 120×80", "60×80", "Друг"].map(t => `<option ${t === (p.type || "EUR 120×80") ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="erp-inline">Тегло на палета <input type="text" inputmode="decimal" class="pm-palkg" data-pi="${pi}" value="${escapeAttr(String(palKg))}" style="width:64px;text-align:right" /> кг</label>
      <span class="spacer"></span>
      <span class="erp-muted">Нето <b>${net}</b> кг · Бруто <b>${pmR1(net + palKg)}</b> кг</span>
      <button class="btn btn-small btn-danger pm-delpal" data-pi="${pi}" title="Махни целия палет (следващите се преномерират)">🗑 Палет</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Наименование</th><th>Кашони</th><th class="num">Бройка</th><th class="num">Нето кг</th><th></th></tr></thead>
      <tbody>${rows || ""}</tbody>
    </table>
    <button class="btn btn-small pm-addrow" data-pi="${pi}" style="margin-top:6px">+ Ред (код + бройка)</button>
  </div>`;
}

function pmRender() {
  const v = erpView();
  const o = PM_ORDER;
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="pm-back">← Назад към заявката</button>
      <span class="erp-count"><b>📋 Палетен опис (ръчен)</b> — заявка № ${escapeHtml(o.ourNo || "—")} · ${escapeHtml(o.clientName || "")}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="pm-print" title="Печат на бланката: всеки палет на отделен лист, едно лого, „ПАЛЕТ № 1, 2, 3…“ без общ брой">🖨 Печат</button>
      <button class="btn btn-small btn-primary" id="pm-save">💾 Запази</button>
      <span class="save-status" id="pm-status"></span>
    </div>
    <p class="hint" style="margin:4px 0 8px">Пишеш <b>код</b> и <b>бройка</b> — името и килограмите излизат сами (кг/брой от Опаковки или от рецептата). И двете можеш да пренапишеш: ръчно написаните килограми светят жълто; изчистиш ли го, връща се на автоматичното. Описът се пази на заявката.</p>
    <div id="pm-pallets">${PM_DATA.pallets.map((p, i) => pmPalletHtml(p, i)).join("")}</div>
    <button class="btn" id="pm-addpal" style="margin-top:4px">➕ Нов палет</button>`;

  v.querySelector("#pm-back").addEventListener("click", async () => { await pmSave(true); erpOpenCO(o.id); });
  v.querySelector("#pm-addpal").addEventListener("click", () => { PM_DATA.pallets.push({ type: "EUR 120×80", palletKg: 20, rows: [] }); pmRender(); });
  v.querySelector("#pm-save").addEventListener("click", () => pmSave(false));
  v.querySelector("#pm-print").addEventListener("click", pmPrint);

  v.querySelectorAll(".pm-addrow").forEach(b => b.addEventListener("click", () => {
    PM_DATA.pallets[Number(b.dataset.pi)].rows.push({ code: "", name: "", boxes: "", qty: "", kg: "", kgManual: false });
    pmRender();
    // Курсорът отива в кода на новия ред.
    const pal = v.querySelector(`[data-pal="${b.dataset.pi}"]`);
    const inputs = pal ? pal.querySelectorAll(".pm-code") : [];
    if (inputs.length) inputs[inputs.length - 1].focus();
  }));
  v.querySelectorAll(".pm-delpal").forEach(b => b.addEventListener("click", () => {
    if (!confirm(`Махам ПАЛЕТ № ${Number(b.dataset.pi) + 1} с всичките му редове?`)) return;
    PM_DATA.pallets.splice(Number(b.dataset.pi), 1);
    if (!PM_DATA.pallets.length) PM_DATA.pallets.push({ type: "EUR 120×80", palletKg: 20, rows: [] });
    pmRender();
  }));
  v.querySelectorAll(".pm-delrow").forEach(b => b.addEventListener("click", () => {
    const tr = b.closest("tr");
    PM_DATA.pallets[Number(tr.dataset.pi)].rows.splice(Number(tr.dataset.ri), 1);
    pmRender();
  }));
  v.querySelectorAll(".pm-type").forEach(s => s.addEventListener("change", () => {
    const p = PM_DATA.pallets[Number(s.dataset.pi)];
    p.type = s.value;
    p.palletKg = s.value === "60×80" ? 10 : 20;   // подсказка; може да се пренапише
    pmRender();
  }));
  v.querySelectorAll(".pm-palkg").forEach(i => i.addEventListener("change", () => {
    PM_DATA.pallets[Number(i.dataset.pi)].palletKg = pmNum(i.value) || 20;
    pmRender();
  }));

  const rowOf = el => { const tr = el.closest("tr"); return PM_DATA.pallets[Number(tr.dataset.pi)].rows[Number(tr.dataset.ri)]; };
  const recalc = r => { if (!r.kgManual) r.kg = r.code && pmNum(r.qty) ? pmR1(pmLookup(r.code).kgPer * pmNum(r.qty)) || "" : r.kg; };
  v.querySelectorAll(".pm-code").forEach(i => i.addEventListener("change", () => {
    const r = rowOf(i);
    r.code = i.value.trim();
    const lk = pmLookup(r.code);
    if (lk.name) r.name = lk.name;        // името излиза само̀ (после може да се пренапише)
    recalc(r);
    pmRender();
  }));
  v.querySelectorAll(".pm-name").forEach(i => i.addEventListener("change", () => { rowOf(i).name = i.value; }));
  v.querySelectorAll(".pm-boxes").forEach(i => i.addEventListener("change", () => { rowOf(i).boxes = i.value; }));
  v.querySelectorAll(".pm-qty").forEach(i => i.addEventListener("change", () => {
    const r = rowOf(i);
    r.qty = i.value.trim();
    recalc(r);
    pmRender();
  }));
  v.querySelectorAll(".pm-kg").forEach(i => i.addEventListener("change", () => {
    const r = rowOf(i);
    const val = i.value.trim();
    if (val === "") { r.kgManual = false; recalc(r); }   // празно = връщане на автоматичното
    else { r.kg = val.replace(",", "."); r.kgManual = true; }
    pmRender();
  }));
}

async function pmSave(silent) {
  const st = document.getElementById("pm-status");
  if (st && !silent) st.textContent = "Записва…";
  PM_ORDER.palletManual = JSON.parse(JSON.stringify({ ...PM_DATA, updatedAt: new Date().toISOString() }));
  try { await erpSaveCO(PM_ORDER); if (st && !silent) st.textContent = "✓ Записано"; }
  catch (e) { if (!silent) alert("Грешка при запис: " + (e.message || e)); return false; }
  if (st && !silent) setTimeout(() => { if (st) st.textContent = ""; }, 1500);
  return true;
}

/* Печатът: бланката от Опаковки, но ЕДНО лого и „ПАЛЕТ № N" без „/ общо". */
function pmPrint() {
  const o = PM_ORDER;
  const en = (typeof packIsExport === "function") && packIsExport(o);
  const L = en
    ? { title: "PALLET LIST", pal: "PALLET No", net: "Net weight", plt: "Pallet", gr: "Gross weight", code: "Code", name: "Description", boxes: "Boxes", qty: "Qty", kg: "Net kg", ord: "Order No", win: "Pallet List — order " }
    : { title: "ПАЛЕТ ОПИС", pal: "ПАЛЕТ №", net: "Нето", plt: "Палет", gr: "Бруто", code: "Код", name: "Наименование", boxes: "Кашони", qty: "Бройка", kg: "Нето кг", ord: "Поръчка №", win: "Палет опис — заявка " };
  const kgU = en ? "kg" : "кг";
  let base = ""; try { base = new URL(".", location.href).href; } catch (e) {}   // about:blank в тестовете
  const clientNm = String(o.clientName || "").trim();
  const nmSize = clientNm.length <= 10 ? 120 : clientNm.length <= 18 ? 92 : clientNm.length <= 28 ? 66 : 48;
  const pageCss = `<style>
    .palpage{font-size:17px;min-height:250mm;display:flex;flex-direction:column}
    .palpage .pal-client{margin-top:auto;padding-top:26px;text-align:center;font-weight:900;text-transform:uppercase;line-height:1.04;word-break:break-word;letter-spacing:2px;font-size:${nmSize}px}
    .palpage h1{font-size:28px}
    .palpage .head > div{font-size:21px;line-height:1.45}
    .palpage table th,.palpage table td{font-size:17px;padding:8px 10px}
    .palpage .kv{font-size:18px;margin:8px 0}
  </style>`;
  const pallets = PM_DATA.pallets.filter(p => (p.rows || []).some(r => r.code || r.name));
  if (!pallets.length) { alert("Описът е празен — добави поне един ред."); return; }
  const body = pageCss + pallets.map((p, idx) => {
    const net = pmR1((p.rows || []).reduce((s, r) => s + pmNum(r.kg), 0));
    const palKg = pmNum(p.palletKg) || 20;
    return `<div class="palpage" style="${idx < pallets.length - 1 ? "page-break-after:always" : ""}">
      <div class="lg"><img src="${base}welcome.svg?v=144" alt="DankoSystems" /></div>
      ${packDocHead(o, L.title, en)}
      <h2 style="margin:12px 0 6px;font-size:34px;letter-spacing:1px">${L.pal} ${idx + 1} <span style="font-weight:400;font-size:21px;color:#555">· ${escapeHtml(p.type || "EUR 120×80")}</span></h2>
      <div class="kv" style="font-size:22px"><b>${L.ord}:</b> ${escapeHtml(o.clientNo || "—")}</div>
      <table><thead><tr><th>${L.code}</th><th>${L.name}</th><th class="c">${L.boxes}</th><th class="c">${L.qty}</th><th class="c">${L.kg}</th></tr></thead>
      <tbody>${(p.rows || []).filter(r => r.code || r.name).map(r => `<tr>
        <td><b>${escapeHtml(r.code || "")}</b></td>
        <td>${escapeHtml(r.name || "")}</td>
        <td class="r">${escapeHtml(r.boxes || "")}</td>
        <td class="r">${erpNum(pmNum(r.qty))}</td>
        <td class="r">${pmNum(r.kg) ? pmR1(pmNum(r.kg)) : ""}</td>
      </tr>`).join("")}</tbody></table>
      <div class="kv"><b>${L.net}:</b> ${net} ${kgU} · <b>${L.plt}:</b> ${palKg} ${kgU} · <b>${L.gr}:</b> ${pmR1(net + palKg)} ${kgU}</div>
      <div class="pal-client">${escapeHtml(clientNm)}</div>
    </div>`;
  }).join("");
  invPrintWindow(L.win + (o.ourNo || ""), body, en ? "en" : "bg", { noLogo: true, noMade: true });
}
