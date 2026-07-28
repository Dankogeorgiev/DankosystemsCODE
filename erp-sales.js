/* Данко Системс — ЕРП „Продажби" (фактуриране).
   Пълни данни като за фактура (клиент с ДДС/адрес, № продажба, дати, ДДС,
   начин на плащане, редове продукти/материали с продажни цени), но засега
   БЕЗ да пише „Фактура" — реалната фактура още се пуска от старото ЕРП.
   При „Осчетоводи" се създават движения „изписване" → наличностите се чистят:
   - ред „материал" → маха директно от този материал;
   - ред „продукт"  → разбива рецептата (bom_requirements) и маха материалите.
   Продажбата се пази в sales.data (JSON). Ползва ERP/erpDialog/erpToNum… */

// Данни на продавача за печатния документ. Попълни реалните (ЕИК, ДДС №, адрес,
// IBAN), за да излизат на документа „Продажба".
const ERP_SELLER = {
  name: "Данко Системс ООД",
  eik: "115789385",        // ЕИК / Булстат
  vat: "BG115789385",      // ДДС №
  city: "4000 Пловдив",
  address: "ул. Кукленско шосе — разклона с. Куклен - с. Брани поле",
  iban: "BG77UBBS81551085471718",
  bic: "UBBSBGSF",
  bank: "Обединена Българска Банка АД",
  phone: "00359 877 612 915",
  email: "office@dankosystems.com",
  mol: "Евгени Георгиев",  // МОЛ
};

let erpSales = null;
let erpSaQuery = "";   // 🔎 търсене в списъка (в паметта)

async function erpLoadSales() {
  const { data, error } = await erpSelectAll("sales", "*");
  if (!error) (data || []).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  if (error) throw error;
  erpSales = (data || []).map(r => ({ id: r.id, posted: r.posted, ...(r.data || {}) }));
}
async function erpSaveSale(o) {
  const data = { ...o }; delete data.id; delete data.posted;
  if (o.id) {
    const { error } = await sb.from("sales").update({ data, posted: !!o.posted, updated_at: new Date().toISOString() }).eq("id", o.id);
    if (error) throw error;
  } else {
    const { data: ins, error } = await sb.from("sales").insert({ data, posted: !!o.posted }).select("id").single();
    if (error) throw error;
    o.id = ins.id;
  }
}
async function erpLoadSaleClients() {
  try {
    const { data } = await erpSelectAll("partners", "id,name,vat,city,street,country", "kind", "customer");
    return (data || []).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  } catch { return []; }
}

/* ---------- Помощници за пари/суми ---------- */
function erpSaleCur(o) { return (o && o.currency === "BGN") ? "лв." : "€"; }
function erpSaleMoney(n, cur) {
  const v = Number(n) || 0;
  return v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (cur || "€");
}
function erpSaleTotals(o) {
  const base = (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const rate = erpToNum(o.vatRate);
  const vat = base * rate / 100;
  return { base, vat, total: base + vat, rate };
}
function erpNextSaleNo() {
  let max = 0;
  (erpSales || []).forEach(o => {
    const c = String(o.saleNo || "").trim();
    if (/^\d+$/.test(c)) { const n = parseInt(c, 10); if (n > max) max = n; }
  });
  return String(max + 1);
}

// Последната продажна цена на даден продукт/материал за конкретен клиент —
// така един и същ продукт се предлага автоматично на различни клиенти на
// различни цени (учи се от историята в erpSales). Връща {price,date,saleNo,currency} или null.
function erpLastPriceFor(o, itemKind, refId) {
  const byId = o && o.clientId;
  const name = ((o && o.clientName) || "").trim().toLowerCase();
  if (!byId && !name) return null;
  const cur = (o && o.currency) || "EUR";
  const hits = [];
  (erpSales || []).forEach(s => {
    if (o && o.id && s.id === o.id) return;                 // не броим текущата продажба
    const sameClient = byId ? (s.clientId === byId) : ((s.clientName || "").trim().toLowerCase() === name);
    if (!sameClient) return;
    (s.lines || []).forEach(l => {
      if (l.itemKind !== itemKind || String(l.refId) !== String(refId)) return;
      const p = erpToNum(l.unitPrice);
      if (p > 0) hits.push({ price: p, date: s.date || "", saleNo: s.saleNo || "", currency: s.currency || "EUR" });
    });
  });
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const ca = a.currency === cur ? 1 : 0, cb = b.currency === cur ? 1 : 0;
    if (ca !== cb) return cb - ca;                          // първо със същата валута
    return String(b.date).localeCompare(String(a.date));    // после най-скорошната
  });
  return hits[0];
}

// Попълва празните цени по редовете: първо от ценовата листа на клиента, после
// от последната цена в историята.
function erpFillClientPrices(o) {
  let filled = 0;
  (o.lines || []).forEach(l => {
    if (erpToNum(l.unitPrice) > 0) return;
    let price = null;
    if (l.itemKind === "product" && typeof erpPriceListEntry === "function") {
      const e = erpPriceListEntry(o.clientId, o.clientName, l.refId);
      if (e && erpToNum(e.price) > 0) price = erpToNum(e.price);
    }
    if (price == null) { const last = erpLastPriceFor(o, l.itemKind, l.refId); if (last) price = last.price; }
    if (price != null) { l.unitPrice = price; filled++; }
  });
  return filled;
}

/* ---------- Списък ---------- */
async function erpRenderSales() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpEnsureLoaded(); await erpLoadSales(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя продажбите</h3><p>${escapeHtml(e.message || String(e))}</p>` +
      `<p class="hint">Пусни обновения <code>erp-setup.sql</code> (таблица sales) в Supabase.</p></div>`;
    return;
  }
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count" id="sa-count"></span>
      <input type="search" id="sa-q" placeholder="🔎 № / клиент / код / продукт…" value="${escapeAttr(erpSaQuery || "")}" style="min-width:220px" autocomplete="off" />
      <span class="spacer"></span>
      <label class="btn btn-small co-attach-btn" title="Импорт на продажби от GenCloud (xlsx) — регистър/архив. При съвпадащ № фактура импортът ПРЕЗАПИСВА записа в Системата (тестовете се заместват).">⤓ Импорт (GenCloud)<input type="file" id="sa-import" accept=".xlsx,.xls" hidden /></label>
      ${(erpSales || []).some(o => o.imported) ? '<button class="btn btn-small btn-danger" id="sa-clear-import" title="Изтрий импортираните продажби (ръчните/тестовете остават)">🗑 Изтегли импорта</button>' : ""}
      <button class="btn btn-small btn-primary" id="erp-sa-new">+ Нова продажба</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>№ Продажба</th><th>Дата</th><th>Клиент</th><th class="num">Редове</th><th class="num">Сума</th><th>Статус</th><th></th></tr></thead>
      <tbody id="sa-tbody"></tbody>
    </table>`;
  document.getElementById("erp-sa-new").addEventListener("click", erpNewSale);
  const qEl = document.getElementById("sa-q");
  if (qEl) qEl.addEventListener("input", e => { erpSaQuery = e.target.value; erpSaFillRows(); });
  const imEl = document.getElementById("sa-import");
  if (imEl) imEl.addEventListener("change", e => { erpSaImport(e.target.files[0]); e.target.value = ""; });
  const ciEl = document.getElementById("sa-clear-import");
  if (ciEl) ciEl.addEventListener("click", erpSaClearImport);
  erpSaFillRows();
}
// Търсенето филтрира В ПАМЕТТА (само тялото на таблицата) — без нова заявка към базата.
function erpSaFillRows() {
  const tb = document.getElementById("sa-tbody"); if (!tb) return;
  const q = (erpSaQuery || "").toLowerCase().trim();
  const rows = (erpSales || []).filter(o => !q ||
    (`${o.saleNo || ""} ${o.clientName || ""} ${o.date || ""}`.toLowerCase().includes(q) ||
     (o.lines || []).some(l => `${l.code || ""} ${l.name || ""} ${l.clientCode || ""}`.toLowerCase().includes(q))));
  const cnt = document.getElementById("sa-count"); if (cnt) cnt.textContent = rows.length + " продажби";
  tb.innerHTML = rows.map(o => {
    const t = erpSaleTotals(o);
    return `
    <tr class="erp-clickable" data-id="${o.id}">
      <td data-label="№ Продажба"><b>${escapeHtml(o.saleNo || "—")}</b></td>
      <td data-label="Дата">${escapeHtml(o.date || "")}</td>
      <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
      <td class="num" data-label="Редове">${(o.lines || []).length}</td>
      <td class="num" data-label="Сума">${erpSaleMoney(t.total, erpSaleCur(o))}</td>
      <td data-label="Статус">${o.imported ? '<span class="erp-co-status" style="background:#f1f5f9;color:#475569" title="Импорт от GenCloud — само регистър, не пипа склада">импорт</span>' : o.posted ? '<span class="erp-co-status" style="background:#dcfce7;color:#166534">осчетоводена</span>' : '<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">чернова</span>'}</td>
      <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
    </tr>`; }).join("") ||
    `<tr><td colspan="7" class="report-empty">${q ? "Няма продажби за това търсене." : "Още няма продажби. Натисни бутона + Нова продажба."}</td></tr>`;
  tb.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenSale(b.dataset.open); }));
  tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenSale(tr.dataset.id)));
}

function erpNewSale() {
  const today = new Date().toISOString().slice(0, 10);
  erpRenderSaleForm({
    saleNo: erpNextSaleNo(), clientName: "", clientId: null, clientVat: "", clientCity: "", clientStreet: "", clientCountry: "BG",
    date: today, taxDate: today, paymentMethod: "По банков път", currency: "EUR", vatRate: 20, note: "", posted: false, lines: [],
  });
}
function erpOpenSale(id) {
  const o = (erpSales || []).find(x => x.id === id);
  if (o) erpRenderSaleForm(JSON.parse(JSON.stringify(o)));
}

// Създава чернова продажба от завършена заявка от клиенти (готовите продукти).
function erpNewSaleFromOrder(order) {
  const today = new Date().toISOString().slice(0, 10);
  // По подразбиране продаваме ОСТАТЪКА (поръчано минус вече доставено) и
  // прескачаме напълно доставените редове — за частично фактуриране.
  const lines = (order.lines || []).map(l => {
    const remaining = Math.max(0, (erpToNum(l.qty) || 0) - (Number(l.delivered) || 0));
    const ple = (typeof erpPriceListEntry === "function") ? erpPriceListEntry(order.clientId, order.clientName, l.productId) : null;
    const name = (ple && ple.cname) ? ple.cname : (l.name || "");   // име при клиента за фактурата
    // Цената идва от ПОРЪЧКАТА (въведената „Прод. цена" на реда) — не се въвежда
    // пак. Ако редът няма цена, падаме към клиентската ценова листа; иначе празно
    // (erpFillClientPrices допълва от историята).
    const orderPrice = erpToNum(l.unitPrice) || 0;
    const plePrice = (ple && erpToNum(ple.price) > 0) ? erpToNum(ple.price) : 0;
    // Покупен материал за препродажба (болтове и др.): изписва се от склад
    // Материали при осчетоводяването, не влиза в производство.
    if (l.materialId) return {
      itemKind: "material", refId: l.materialId, code: l.code || "", name, ourName: l.ourName || l.name || "",
      clientCode: l.clientCode || "", clientName: l.clientName || "",
      unit: l.unit || "бр.", qty: remaining, unitPrice: orderPrice > 0 ? orderPrice : "",
    };
    return {
      // Готовото изделие е в Склад детайли (заприходено при производството) —
      // изписва се оттам, а НЕ по рецепта (иначе двойно броене на суровините).
      itemKind: "product", writeoffKind: "detail", refId: l.productId, code: l.code || "", name, ourName: l.ourName || l.name || "",
      clientCode: l.clientCode || "", clientName: l.clientName || "",
      unit: "бр.", qty: remaining, unitPrice: orderPrice > 0 ? orderPrice : (plePrice > 0 ? plePrice : ""),
    };
  }).filter(l => (erpToNum(l.qty) || 0) > 0);
  erpRenderSaleForm({
    saleNo: erpNextSaleNo(), clientName: order.clientName || "", clientId: order.clientId || null,
    clientVat: "", clientCity: "", clientStreet: "", clientCountry: "BG",
    date: today, taxDate: today, paymentMethod: "По банков път", currency: "EUR", vatRate: 20,
    note: order.ourNo ? ("По заявка №" + order.ourNo + (order.clientNo ? " / клиентски № " + order.clientNo : "")) : "",
    posted: false, lines, fromOrderId: order.id,
  });
}

/* ---------- Форма ---------- */
async function erpRenderSaleForm(o) {
  const v = erpView();
  const clients = await erpLoadSaleClients();
  if (!erpSales) { try { await erpLoadSales(); } catch (e) {} }   // за авто-цените (история)
  if (typeof erpPLEnsureCache === "function") { try { await erpPLEnsureCache(); } catch (e) {} }   // клиентски ценови листи
  const locked = !!o.posted;
  // Авто-цени: попълни празните цени с последната за този клиент.
  if (!locked && (o.clientId || o.clientName)) erpFillClientPrices(o);
  const cur = erpSaleCur(o);
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="sa-back">← Назад към продажбите</button>
      <span class="spacer"></span>
      <button class="btn btn-small" id="sa-print">🖨 Печат</button>
      ${o.invoiceNo ? `<span class="erp-count" title="Фактурирана">📄 ф-ра № ${escapeHtml(o.invoiceNo)}</span>` : (typeof erpInvFromSale === "function" && o.posted && !o.imported ? '<button class="btn btn-small" id="sa-invoice" title="Създава фактура от тази продажба (документът; складът остава от продажбата)">📄 Създай фактура</button>' : "")}
      ${locked ? '<span class="erp-count">✓ Осчетоводена — само за преглед</span> <button class="btn btn-small btn-danger" id="sa-unpost" title="Връща движенията в склада, за да осчетоводиш продажбата пак">↩ Отмени осчетоводяване</button>'
        : '<button class="btn btn-small" id="sa-save">💾 Запази</button><button class="btn btn-small btn-primary" id="sa-post">📤 Осчетоводи (изпиши от склада)</button>'}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>№ Продажба <input type="text" id="sa-no" value="${escapeAttr(o.saleNo || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Клиент <input type="text" id="sa-client" list="sa-clients" value="${escapeAttr(o.clientName || "")}" ${locked ? "disabled" : ""} placeholder="избери или въведи" />
          <datalist id="sa-clients">${clients.map(c => `<option value="${escapeAttr(c.name || "")}"></option>`).join("")}</datalist></label>
        <label>ДДС № на клиента <input type="text" id="sa-cvat" value="${escapeAttr(o.clientVat || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Град <input type="text" id="sa-ccity" value="${escapeAttr(o.clientCity || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Адрес <input type="text" id="sa-cstreet" value="${escapeAttr(o.clientStreet || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Дата на издаване <input type="date" id="sa-date" value="${escapeAttr(o.date || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Дата на данъчно събитие <input type="date" id="sa-taxdate" value="${escapeAttr(o.taxDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Начин на плащане
          <select id="sa-pay" ${locked ? "disabled" : ""}>
            ${["По банков път", "В брой", "С карта", "Наложен платеж"].map(s => `<option ${s === (o.paymentMethod || "По банков път") ? "selected" : ""}>${s}</option>`).join("")}
          </select></label>
        <label>Валута
          <select id="sa-cur" ${locked ? "disabled" : ""}>
            ${["EUR", "BGN"].map(s => `<option value="${s}" ${s === (o.currency || "EUR") ? "selected" : ""}>${s === "EUR" ? "Евро (€)" : "Лева (лв.)"}</option>`).join("")}
          </select></label>
        <label>ДДС ставка
          <select id="sa-vat" ${locked ? "disabled" : ""}>
            ${["20", "9", "0"].map(s => `<option value="${s}" ${Number(s) === Number(o.vatRate) ? "selected" : ""}>${s}%</option>`).join("")}
          </select></label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="sa-note" rows="2" ${locked ? "disabled" : ""}>${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">Редове (продукти / материали)</h4>
      <table class="report-table erp-table" id="sa-lines">
        <thead><tr><th>Вид</th><th>Код</th><th>Наименование</th><th class="num">Кол.</th><th>Мярка</th><th class="num">Ед. цена</th><th class="num">Стойност</th><th></th></tr></thead>
        <tbody>${erpSaLinesHtml(o, locked)}</tbody>
      </table>
      ${locked ? "" : '<div class="erp-co-actions"><button class="btn btn-small" id="sa-add-prod">+ Продукт</button><button class="btn btn-small" id="sa-add-mat">+ Материал</button></div>'}

      <div class="erp-sale-totals" id="sa-totals"></div>
      <p class="hint">Всеки продукт има избор „<b>Вид</b>": <b>🏭 готов детайл</b> = изписва готовото изделие от <b>Склад детайли</b> (по подразбиране — за вече произведените изделия); <b>📦 по рецепта</b> = разбива рецептата и изписва суровините от склад материали (за продажба без предварително производство). Материалните редове се изписват директно. Средните цени не се променят.</p>
    </div>`;

  if (!locked) {
    const bind = (id, k) => { const el = document.getElementById(id); el.addEventListener("input", () => { o[k] = el.value; }); };
    bind("sa-no", "saleNo"); bind("sa-cvat", "clientVat"); bind("sa-ccity", "clientCity");
    bind("sa-cstreet", "clientStreet"); bind("sa-date", "date"); bind("sa-taxdate", "taxDate"); bind("sa-note", "note");
    document.getElementById("sa-client").addEventListener("input", e => {
      o.clientName = e.target.value;
      const m = clients.find(c => (c.name || "") === e.target.value);
      if (m) { o.clientId = m.id; o.clientVat = m.vat || o.clientVat; o.clientCity = m.city || o.clientCity; o.clientStreet = m.street || o.clientStreet; o.clientCountry = m.country || o.clientCountry;
        // опресни попълнените полета
        const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        set("sa-cvat", o.clientVat); set("sa-ccity", o.clientCity); set("sa-cstreet", o.clientStreet);
        // авто-цени за този клиент (само празните редове)
        if (erpFillClientPrices(o)) erpSaRefreshFull(o);
      } else { o.clientId = null; }
    });
    document.getElementById("sa-pay").addEventListener("change", e => { o.paymentMethod = e.target.value; });
    document.getElementById("sa-cur").addEventListener("change", e => { o.currency = e.target.value; erpSaRefreshFull(o); });
    document.getElementById("sa-vat").addEventListener("change", e => { o.vatRate = erpToNum(e.target.value); erpSaTotals(o); });
    document.getElementById("sa-save").addEventListener("click", () => erpSaSaveClick(o));
    document.getElementById("sa-post").addEventListener("click", () => erpPostSale(o));
    document.getElementById("sa-add-prod").addEventListener("click", () => erpSaAddLine(o, "product"));
    document.getElementById("sa-add-mat").addEventListener("click", () => erpSaAddLine(o, "material"));
  }
  document.getElementById("sa-back").addEventListener("click", erpRenderSales);
  document.getElementById("sa-print").addEventListener("click", () => erpPrintSale(o));
  const invBtn = document.getElementById("sa-invoice");
  if (invBtn) invBtn.addEventListener("click", () => { if (typeof erpInvFromSale === "function") erpInvFromSale(o); });
  const upBtn = document.getElementById("sa-unpost");
  if (upBtn) upBtn.addEventListener("click", () => erpUnpostSale(o));
  erpSaWireLines(o, locked);
  erpSaTotals(o);
}

// Отменя осчетоводяване: връща движенията (материали + детайли) в склада по ref,
// сваля „осчетоводена", за да може продажбата да се направи пак (напр. с правилен
// „Вид" на редовете — готов детайл вместо суровини).
/* ---------- Импорт на продажби от GenCloud (xlsx) ----------
   Регистър/архив: редовете се групират по № фактура + клиент + дата.
   ИМПОРТЪТ Е МЕРОДАВЕН: при съвпадащ № (нормализиран) записът в Системата се
   ПРЕЗАПИСВА с данните от файла (тестовете се заместват). Осчетоводена тестова
   продажба първо връща движенията си, за да не остане боклук в склада.
   Импортираните продажби НЕ пипат склада и не могат да се осчетоводяват. */
async function erpSaImport(file) {
  if (!file) return;
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!raw.length) { alert("Файлът е празен."); return; }
    const pick = (row, ...names) => { for (const n of names) { for (const k of Object.keys(row)) { if (String(k).trim().toLowerCase() === n.toLowerCase()) return row[k]; } } return ""; };
    const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
    const pDate = s => {
      s = String(s || "").trim(); if (!s) return "";
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
      return "";
    };
    await erpLoadSales();

    // Групиране по фактура (№ + клиент + дата).
    const groups = new Map();
    raw.forEach(r => {
      const invoiceNo = String(pick(r, "№:", "№", "Док.№", "Док.No", "No", "Номер") || "").trim();
      const client = String(pick(r, "Партньор", "Клиент", "Контрагент") || "").trim();
      const date = pDate(pick(r, "Дата", "Док.дата", "Дата на док."));
      if (!invoiceNo && !client) return;
      const key = invoiceNo + "|" + client + "|" + date;
      if (!groups.has(key)) groups.set(key, {
        invoiceNo, client, date,
        currency: String(pick(r, "Пр.цена (мярка)", "Кр.цена (мярка)", "Валута") || "").trim().toUpperCase() || "EUR",
        net: 0, vat: 0, lines: [],
      });
      const g = groups.get(key);
      const qty = num(pick(r, "Кол.", "Количество")) || 1;
      const rowNet = Math.abs(num(pick(r, "Пр.цена", "Кр.цена", "Стойност", "Сума без ДДС", "Сума")));
      const rowVat = Math.abs(num(pick(r, "ДДС сума", "ДДС")));
      g.net += rowNet; g.vat += rowVat;
      g.lines.push({
        code: String(pick(r, "Код") || "").trim(), name: String(pick(r, "Артикул", "Описание") || "").trim() || "продажба",
        qty, unit: "бр.", unitPrice: qty ? Math.round((rowNet / qty) * 100) / 100 : rowNet,
        itemKind: "import",
      });
    });
    if (!groups.size) { alert("Не намерих редове с фактура/клиент в файла."); return; }

    const norm = s => String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
    const byNo = new Map();
    (erpSales || []).forEach(o => {
      [o.invoiceNo, o.saleNo].forEach(x => { const k = norm(x); if (k && !byNo.has(k)) byNo.set(k, o); });
    });
    let added = 0, replaced = 0;
    for (const g of groups.values()) {
      const rate = g.net > 0 ? g.vat / g.net * 100 : 20;
      const vatRate = [20, 9, 0].reduce((b, r) => Math.abs(r - rate) < Math.abs(b - rate) ? r : b, 20);
      const fields = {
        saleNo: g.invoiceNo, invoiceNo: g.invoiceNo, date: g.date,
        clientName: g.client, clientId: null,
        currency: g.currency === "BGN" ? "BGN" : "EUR", vatRate,
        lines: g.lines, imported: true, posted: false,
        note: "Импорт от GenCloud",
      };
      const k = norm(g.invoiceNo);
      const ex = k ? byNo.get(k) : null;
      if (ex) {
        // Тестова осчетоводена продажба → първо връщаме движенията ѝ от склада.
        if (ex.posted) {
          const ref = `Продажба ${ex.saleNo || "—"} · ${ex.clientName || ""}`.trim();
          try { await sb.from("stock_movements").delete().eq("ref", ref); } catch (e) {}
          try { await sb.from("product_movements").delete().eq("ref", ref); } catch (e) {}
        }
        const rec = { id: ex.id, ...fields };
        try { await erpSaveSale(rec); replaced++; } catch (e) {}
      } else {
        const rec = { ...fields };
        try { await erpSaveSale(rec); if (k) byNo.set(k, rec); added++; } catch (e) {}
      }
    }
    await erpLoadSales();
    erpRenderSales();
    alert(`Импорт готов: ${added} добавени, ${replaced} презаписани (импортът е меродавен — старите/тестовите са заместени).\nИмпортираните продажби са само регистър — НЕ пипат склада.`);
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}
// Изтегля (изтрива) импортираните продажби — ръчните остават.
async function erpSaClearImport() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpLoadSales();
  const imp = (erpSales || []).filter(o => o.imported);
  if (!imp.length) { alert("Няма импортирани продажби."); return; }
  if (!confirm(`Да изтрия ли ${imp.length} импортирани продажби?\nРъчно въведените остават.`)) return;
  let del = 0;
  for (const o of imp) { try { const { error } = await sb.from("sales").delete().eq("id", o.id); if (!error) del++; } catch (e) {} }
  await erpLoadSales();
  erpRenderSales();
  alert(`Изтрити ${del} импортирани продажби.`);
}

async function erpUnpostSale(o) {
  if (!o.posted) { alert("Продажбата не е осчетоводена."); return; }
  if (!confirm(`Да отменя ли осчетоводяването на продажба №${o.saleNo || ""}?\n\nВсички движения от тази продажба ще се върнат (изписаните материали/детайли се възстановяват в склада), за да можеш да я осчетоводиш пак — напр. с Вид = готов детайл.`)) return;
  const ref = `Продажба ${o.saleNo || "—"} · ${o.clientName || ""}`.trim();
  const e1 = await sb.from("stock_movements").delete().eq("ref", ref);
  if (e1.error) { alert("Грешка при връщане на материалите: " + e1.error.message); return; }
  const e2 = await sb.from("product_movements").delete().eq("ref", ref);
  if (e2.error) { alert("Грешка при връщане на детайлите: " + e2.error.message); return; }
  o.posted = false; o.postedAt = null;
  try { await erpSaveSale(o); } catch (e) { alert("⚠ Движенията са върнати, но статусът не се записа: " + (e.message || e)); }
  if (typeof erpRecvRemoveForSales === "function") { try { await erpRecvRemoveForSales([o.id]); } catch (e) {} }
  try { await erpLoadAll(); } catch {}
  try { await erpLoadSales(); } catch {}
  alert("Осчетоводяването е отменено и складът е възстановен.\n\nСега смени Вид на реда на „готов детайл“ и натисни Осчетоводи пак.");
  erpRenderSaleForm(o);
}

function erpSaLinesHtml(o, locked) {
  const cur = erpSaleCur(o);
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Вид">${l.itemKind === "material" ? "🧱 материал"
        : locked ? (l.writeoffKind === "detail" ? "🏭 готов детайл" : "📦 по рецепта")
        : `<select class="sa-wok" data-i="${i}" title="Откъде да се изпише при продажба">
             <option value="detail" ${l.writeoffKind === "detail" ? "selected" : ""}>🏭 готов детайл</option>
             <option value="recipe" ${l.writeoffKind !== "detail" ? "selected" : ""}>📦 по рецепта</option>
           </select>`}</td>
      <td data-label="Код">${escapeHtml(l.code || "")}${l.clientCode ? `<div class="erp-co-ccode" title="Код на клиента">клиент: ${escapeHtml(l.clientCode)}</div>` : ""}</td>
      <td data-label="Наименование">${locked ? escapeHtml(l.name || "") : `<input type="text" class="sa-name" data-i="${i}" value="${escapeAttr(l.name || "")}" style="width:100%;min-width:150px" title="Име за фактурата (напр. името при клиента)" />`}${l.clientName && l.clientName !== l.name ? `<div class="erp-co-cname" title="Име при клиента">${escapeHtml(l.clientName)}</div>` : ""}</td>
      <td class="num" data-label="Кол.">${locked ? erpNum(l.qty) : `<input type="number" class="sa-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:80px" />`}</td>
      <td data-label="Мярка">${escapeHtml(l.unit || "")}</td>
      <td class="num" data-label="Ед. цена">${locked ? erpSaleMoney(l.unitPrice, cur) : `<input type="number" class="sa-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:100px" placeholder="0.00" />`}</td>
      <td class="num" data-label="Стойност">${erpSaleMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), cur)}</td>
      <td class="erp-row-actions" data-label="">${locked ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Няма добавени редове.</td></tr>`;
}
function erpSaWireLines(o, locked) {
  if (locked) return;
  const body = document.querySelector("#sa-lines tbody"); if (!body) return;
  body.querySelectorAll(".sa-name").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].name = inp.value; }));
  body.querySelectorAll(".sa-qty").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].qty = erpToNum(inp.value); erpSaRefresh(o); }));
  body.querySelectorAll(".sa-price").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].unitPrice = erpToNum(inp.value); erpSaRefresh(o); }));
  body.querySelectorAll(".sa-wok").forEach(sel => sel.addEventListener("change", () => {
    const l = o.lines[Number(sel.dataset.i)];
    if (sel.value === "detail") l.writeoffKind = "detail"; else delete l.writeoffKind;
  }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpSaRefreshFull(o); }));
}
function erpSaRefresh(o) { // само сумите, без загуба на фокус
  const cur = erpSaleCur(o);
  const body = document.querySelector("#sa-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => {
    const l = (o.lines || [])[i]; if (!l) return;
    const sum = tr.querySelector('td[data-label="Стойност"]');
    if (sum) sum.textContent = erpSaleMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), cur);
  });
  erpSaTotals(o);
}
function erpSaRefreshFull(o) {
  const body = document.querySelector("#sa-lines tbody"); if (body) { body.innerHTML = erpSaLinesHtml(o, false); erpSaWireLines(o, false); }
  erpSaTotals(o);
}
function erpSaTotals(o) {
  const box = document.getElementById("sa-totals"); if (!box) return;
  const cur = erpSaleCur(o); const t = erpSaleTotals(o);
  box.innerHTML = `
    <table class="erp-sale-sum">
      <tr><td>Данъчна основа</td><td class="num">${erpSaleMoney(t.base, cur)}</td></tr>
      <tr><td>ДДС ${t.rate}%</td><td class="num">${erpSaleMoney(t.vat, cur)}</td></tr>
      <tr class="grand"><td><b>Сума за плащане</b></td><td class="num"><b>${erpSaleMoney(t.total, cur)}</b></td></tr>
    </table>`;
}

function erpSaAddLine(o, kind) {
  const isMat = kind === "material";
  const { wrap, close } = erpDialog(`
    <h3>Добави ${isMat ? "материал" : "продукт"}</h3>
    <input type="search" id="sa-pp-q" placeholder="търси код или име…" />
    <div id="sa-pp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="sa-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#sa-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = (isMat ? ERP.materials : ERP.products).slice();
    if (q) list = list.filter(x => ((x.code || "") + " " + (x.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(x => {
      const hint = isMat ? (x.unit || "") : (x.is_semifinished ? "полуфабрикат" : "артикул");
      const cost = isMat ? (Number(x.avg_cost) || 0) : (Number(ERP.costById[x.id]) || 0);
      const last = erpLastPriceFor(o, kind, x.id);
      const lastHint = last ? ` · <b>посл. за клиента: ${erpSaleMoney(last.price, erpSaleCur(o))}</b>` : "";
      return `<button type="button" class="erp-lp-item" data-id="${x.id}"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml(x.name || "")} <span class="erp-muted">${escapeHtml(hint)}${cost ? " · себест. " + erpEur(cost) : ""}${lastHint}</span></button>`;
    }).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const id = Number(b.dataset.id);
      const x = isMat ? ERP.matById[id] : ERP.prodById[id];
      o.lines = o.lines || [];
      const last = erpLastPriceFor(o, kind, x.id);
      const ple = (!isMat && typeof erpPriceListEntry === "function") ? erpPriceListEntry(o.clientId, o.clientName, x.id) : null;
      const dispName = (ple && ple.cname) ? ple.cname : (x.name || "");   // име при клиента за фактурата
      const plPrice = (ple && erpToNum(ple.price) > 0) ? erpToNum(ple.price) : null;
      const unitPrice = plPrice != null ? plPrice : (last ? last.price : "");
      const line = { itemKind: kind, refId: x.id, code: x.code || "", name: dispName, ourName: x.name || "", unit: isMat ? (x.unit || "") : "бр.", qty: 1, unitPrice };
      // Продуктите по подразбиране се изписват като ГОТОВ ДЕТАЙЛ от Склад детайли
      // (готовите изделия са там); за поръчкови без наличност се превключва на „по рецепта".
      if (kind === "product") line.writeoffKind = "detail";
      o.lines.push(line);
      close(); erpSaRefreshFull(o);
    }));
  };
  render("");
  wrap.querySelector("#sa-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#sa-pp-cancel").addEventListener("click", close);
}

async function erpSaSaveClick(o) {
  const btn = document.getElementById("sa-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  try { await erpSaveSale(o); await erpLoadSales(); if (btn) { btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) { btn.textContent = "💾 Запази"; btn.disabled = false; } }, 1500); } }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; } alert("Грешка при запис: " + (e.message || e)); }
}

/* ---------- Осчетоводяване (изписване от склада) ---------- */
async function erpPostSale(o) {
  if (o.imported) { alert("Това е ИМПОРТИРАНА продажба (регистър от GenCloud) — не се осчетоводява и не пипа склада.\nСкладът за нея е бил обслужен в стария процес."); return; }
  if (o.posted) { alert("Вече е осчетоводена."); return; }
  if (!(o.lines || []).length) { alert("Добави поне един ред."); return; }
  try { await erpSaveSale(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }
  if (typeof dsRefreshStock === "function") await dsRefreshStock(true);   // свежи наличности на детайлите преди проверката „на минус"

  // Събираме нужното за изписване:
  //  • редове „готов детайл" (writeoffKind:"detail") — изписват СЕ директно от Склад
  //    детайли (заявката вече е минала през производство, материалите са изписани там);
  //  • продуктовите редове — през рецептата → суровини от склад материали;
  //  • материалните редове — директно от склад материали.
  const need = {};   // material_id -> количество за изписване
  const detailNeed = {};   // product_id -> готови детайли за изписване от Склад детайли
  const addNeed = (mid, qty) => { if (!mid || !(qty > 0)) return; need[mid] = (need[mid] || 0) + qty; };
  const addDetail = (pid, qty) => { if (!pid || !(qty > 0)) return; detailNeed[pid] = (detailNeed[pid] || 0) + qty; };
  for (const l of (o.lines || [])) {
    const qty = erpToNum(l.qty) || 0; if (qty <= 0) continue;
    if (l.writeoffKind === "detail") {
      addDetail(l.refId, qty);
      // Нит-комплект (складът му се води от Занитване): АКСЕСОАРИТЕ (спирачки,
      // пружини, болтове, ухо…) не са изписани при сглобяването — слагат се на
      // палета преди експедиция. Заминават с продажбата, по рецептата на
      // комплекта (същия ref → отмяната ги връща). Търсенето е РЕКУРСИВНО:
      // ухото напр. е в рецептата на заготовката, две нива под комплекта.
      const dp = ERP.prodById[l.refId];
      if (dp && typeof erpNitManagedCode === "function" && erpNitManagedCode(dp.code)
          && typeof NIT_ACCESSORY_CODES !== "undefined") {
        const walkAcc = (pid, mult, seen) => {
          if (seen.has(pid)) return;
          seen.add(pid);
          ((ERP.linesByProduct && ERP.linesByProduct[pid]) || []).forEach(rl => {
            const per = (Number(rl.quantity) || 1) * mult;
            if (rl.child_product_id) {
              const c = ERP.prodById[rl.child_product_id];
              if (c && NIT_ACCESSORY_CODES.has(String(c.code || "").trim())) addDetail(rl.child_product_id, qty * per);
              else walkAcc(rl.child_product_id, per, seen);
            } else if (rl.material_id) {
              const m = ERP.matById[rl.material_id];
              if (m && NIT_ACCESSORY_MAT_CODES.has(String(m.code || "").trim())) addNeed(rl.material_id, qty * per);
            }
          });
        };
        walkAcc(l.refId, 1, new Set());
      }
      continue;
    }
    if (l.itemKind === "material") { addNeed(l.refId, qty); continue; }
    const { data, error } = await sb.rpc("bom_requirements", { p_id: l.refId, p_qty: qty });
    if (error) { alert("Грешка при разбивката на продукт " + (l.name || "") + ": " + error.message); return; }
    (data || []).forEach(r => addNeed(r.material_id, Number(r.required) || 0));
  }
  const mids = Object.keys(need);
  const dids = Object.keys(detailNeed);
  if (!mids.length && !dids.length) { alert("Няма нищо за изписване (продуктите нямат рецепта, а няма и материални/детайлни редове)."); return; }

  // Проверка за отрицателни наличности след изписването (материали + детайли).
  const stockById = {};
  ERP.materials.forEach(m => { stockById[m.id] = Number(m.stock) || 0; });
  const negatives = mids.filter(mid => (stockById[mid] || 0) - need[mid] < 0)
    .map(mid => { const m = ERP.matById[mid] || {}; return `${m.code || ""} ${m.name || ""}: налично ${erpNum(stockById[mid] || 0)}, нужно ${erpNum(need[mid])}`; });
  const dNegatives = dids.filter(pid => ((Number((ERP.prodById[pid] || {}).stock) || 0)) - detailNeed[pid] < 0)
    .map(pid => { const p = ERP.prodById[pid] || {}; return `${p.code || ""} ${p.name || ""}: наличност ${erpNum(Number(p.stock) || 0)}, нужно ${erpNum(detailNeed[pid])}`; });

  let msg = `Да осчетоводя ли продажба №${o.saleNo}?`;
  if (dids.length) msg += `\n\nЩе се изпишат ${dids.length} готови детайла от Склад детайли (движения „изписване").`;
  if (mids.length) {
    msg += `\n\nЩе се изпишат ${mids.length} материала от склад материали (движения „изписване").`;
    msg += `\n⚠ Ако тази заявка вече е минала през „Пусни в производство", материалите СА ИЗПИСАНИ там — не потвърждавай материалните редове тук, за да не се броят двойно.`;
  }
  if (negatives.length) msg += `\n\n⚠ Материали на минус:\n` + negatives.slice(0, 12).join("\n") + (negatives.length > 12 ? `\n…и още ${negatives.length - 12}` : "");
  if (dNegatives.length) {
    msg += `\n\n⚠ Детайли на минус:\n` + dNegatives.slice(0, 12).join("\n") + (dNegatives.length > 12 ? `\n…и още ${dNegatives.length - 12}` : "");
    msg += `\n🧩 Недостигащите готови артикули ще опитам първо да сглобя от наличните им части („опаковка" по рецептата).`;
  }
  msg += `\n\nДействието се прави веднъж.`;
  if (!confirm(msg)) return;

  const ref = `Продажба ${o.saleNo || "—"} · ${o.clientName || ""}`.trim();
  const by = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || null;

  // „Опаковка": готов артикул без финална операция никога не се събира от
  // производството — частите му са на склад, а самият той не. Ако не достига,
  // сглобяваме липсата от частите по рецептата (изписва части, заприходява готов),
  // за да не отиде артикулът на минус при изписването по-долу.
  const asmNotes = [];
  if (dids.length && typeof erpAssembleFromParts === "function") {
    for (const pid of dids) {
      const have = Number((ERP.prodById[pid] || {}).stock) || 0;
      const short = detailNeed[pid] - have;
      if (short > 0) {
        const res = await erpAssembleFromParts(pid, short, "сглоб:прод " + (o.saleNo || ""));
        if (res && res.made > 0) {
          const p = ERP.prodById[pid] || {};
          asmNotes.push(`🧩 Сглобени ${erpNum(res.made)} бр. ${(p.code ? p.code + " " : "") + (p.name || "")} от наличните части (опаковка).`);
        }
      }
    }
  }

  if (mids.length) {
    const moves = mids.map(mid => ({ material_id: Number(mid), kind: "изписване", quantity: -Math.abs(need[mid]), ref, created_by: by }));
    const ins = await sb.from("stock_movements").insert(moves);
    if (ins.error) { alert("Грешка при движенията на материали: " + ins.error.message); return; }
  }
  if (dids.length) {
    const dMoves = dids.map(pid => ({ product_id: Number(pid), kind: "изписване", quantity: -Math.abs(detailNeed[pid]), ref, note: "Продажба" }));
    const dIns = await sb.from("product_movements").insert(dMoves);
    if (dIns.error) { alert("Грешка при движенията на детайли: " + dIns.error.message); return; }
  }

  o.posted = true; o.postedAt = new Date().toISOString();
  try { await erpSaveSale(o); } catch {}
  // Продажба без фактура (само стокова): клиентът пак дължи — влиза във Вземания
  // с тип „Стокова". При последващо фактуриране се заменя от фактурното вземане.
  if (!o.invoiceNo && typeof erpRecvSyncFromSale === "function") { try { await erpRecvSyncFromSale(o); } catch (e) {} }
  // Заявката, от която е продажбата: добавяме доставеното; приключва само при
  // пълна доставка, иначе остава отворена с остатъка.
  let closedNote = "";
  if (o.fromOrderId) { try { closedNote = await erpMarkOrderDone(o.fromOrderId, o.lines); } catch (e) {} }
  await erpLoadAll();       // опреснява наличности в кеша
  await erpLoadSales();
  alert(`Готово! Осчетоводена продажба №${o.saleNo}.`
    + (dids.length ? `\nИзписани ${dids.length} готови детайла от Склад детайли.` : "")
    + (asmNotes.length ? `\n` + asmNotes.join("\n") : "")
    + (mids.length ? `\nИзписани ${mids.length} материала от склад материали.` : "")
    + closedNote);
  erpRenderSaleForm(o);
}

// Отразява доставеното по заявката от продажбата. Клиентска заявка: добавя
// доставените бройки по продукт (line.delivered); приключва („завършена") само
// при ПЪЛНА доставка, иначе остава „в производство" с остатъка. Мостра/поръчка:
// засега пълно приключване. Обратимо (статусът се сменя ръчно).
async function erpMarkOrderDone(orderId, saleLines) {
  if (!orderId) return "";
  try {
    const co = await sb.from("customer_orders").select("id,data").eq("id", orderId).maybeSingle();
    if (co && co.data) {
      const d = co.data.data || {};
      const lines = d.lines || [];
      // Добавяме доставеното по продукт (по refId на продажбата = productId на реда).
      (saleLines || []).forEach(sl => {
        const pid = sl && sl.refId; const q = erpToNum(sl && sl.qty) || 0;
        if (!pid || q <= 0) return;
        const line = lines.find(l => String(l.productId) === String(pid));
        if (line) line.delivered = (Number(line.delivered) || 0) + q;
      });
      const allDone = lines.length > 0 && lines.every(l => (Number(l.delivered) || 0) >= (erpToNum(l.qty) || 0) - 1e-9);
      d.status = allDone ? "завършена" : "в производство";
      if (allDone) d.closedAt = new Date().toISOString(); else delete d.closedAt;
      await sb.from("customer_orders").update({ data: d, updated_at: new Date().toISOString() }).eq("id", orderId);
      // Приключена заявка → освобождаваме резервираната ѝ наличност (кръстосано
      // нетване), за да не застоява и да блокира нетването на бъдещи заявки.
      if (allDone && typeof erpReleaseNetting === "function") { try { await erpReleaseNetting(orderId); } catch (e) {} }
      if (typeof erpCOList !== "undefined" && Array.isArray(erpCOList)) { const it = erpCOList.find(x => String(x.id) === String(orderId)); if (it) { it.status = d.status; it.lines = lines; } }
      if (allDone) return `\n\n✅ Заявка №${d.ourNo || ""} е доставена НАПЪЛНО и приключена.`;
      const rem = lines.filter(l => (Number(l.delivered) || 0) < (erpToNum(l.qty) || 0))
        .map(l => `• ${l.code ? l.code + " " : ""}${l.ourName || l.name || ""}: остават ${erpNum((erpToNum(l.qty) || 0) - (Number(l.delivered) || 0))} бр.`);
      return `\n\n📦 Заявка №${d.ourNo || ""} — частична доставка. Остава да се издължи:\n` + rem.join("\n");
    }
  } catch (e) {}
  try {
    const sm = await sb.from("samples").select("id,data").eq("id", orderId).maybeSingle();
    if (sm && sm.data) {
      const d = sm.data.data || {}; d.completed = true;
      await sb.from("samples").update({ data: d, completed: true, updated_at: new Date().toISOString() }).eq("id", orderId);
      if (typeof erpReleaseNetting === "function") { try { await erpReleaseNetting(orderId); } catch (e) {} }
      return `\n\n✅ Поръчката е отбелязана като завършена.`;
    }
  } catch (e) {}
  return "";
}

/* ---------- Печат на документа „Продажба" ---------- */
function erpPrintSale(o) {
  const cur = erpSaleCur(o); const t = erpSaleTotals(o);
  const rows = (o.lines || []).map((l, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(l.code || "")}${l.clientCode ? `<br><small style="color:#555">клиент: ${escapeHtml(l.clientCode)}</small>` : ""}</td><td>${escapeHtml(l.name || "")}${l.clientName && l.clientName !== l.name ? `<br><small style="color:#555">${escapeHtml(l.clientName)}</small>` : ""}</td>
      <td class="r">${erpNum(l.qty)}</td><td>${escapeHtml(l.unit || "")}</td>
      <td class="r">${erpSaleMoney(l.unitPrice, cur)}</td>
      <td class="r">${erpSaleMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), cur)}</td></tr>`).join("")
    || `<tr><td colspan="7" class="c muted">— няма редове —</td></tr>`;
  const s = ERP_SELLER;
  const sellerLines = [
    s.eik ? "ЕИК: " + escapeHtml(s.eik) : "",
    s.vat ? "ДДС №: " + escapeHtml(s.vat) : "",
    (s.city || s.address) ? escapeHtml([s.city, s.address].filter(Boolean).join(", ")) : "",
    s.iban ? "IBAN: " + escapeHtml(s.iban) + (s.bank ? " (" + escapeHtml(s.bank) + ")" : "") : "",
    s.mol ? "МОЛ: " + escapeHtml(s.mol) : "",
  ].filter(Boolean).join("<br>");
  const clientLines = [
    escapeHtml(o.clientName || ""),
    o.clientVat ? "ДДС №: " + escapeHtml(o.clientVat) : "",
    [o.clientCity, o.clientStreet].filter(Boolean).map(escapeHtml).join(", "),
  ].filter(Boolean).join("<br>");

  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Продажба ${escapeHtml(o.saleNo || "")}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 22px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}
    .head h1{font-size:22px;margin:0;color:#0f766e;letter-spacing:1px}
    .meta{text-align:right;font-size:12px;color:#333}
    .parties{display:flex;gap:16px;margin-bottom:14px}
    .party{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px}
    .party h3{margin:0 0 4px;font-size:12px;color:#0f766e}
    table.items{width:100%;border-collapse:collapse;margin-bottom:8px}
    table.items th,table.items td{border:1px solid #cbd5e1;padding:5px 7px;font-size:11.5px;text-align:left}
    table.items th{background:#ecfdf5;color:#065f46}
    td.r{text-align:right}td.c{text-align:center}.muted{color:#777}
    .sum{width:280px;margin-left:auto;border-collapse:collapse}
    .sum td{padding:4px 8px;font-size:12px}.sum tr.g td{border-top:2px solid #0f766e;font-size:14px}
    .foot{display:flex;justify-content:space-between;margin-top:26px;font-size:11px;color:#444}
    .foot div{flex:1;border-top:1px solid #333;padding-top:4px;margin:0 12px;text-align:center}
    .pay{margin:6px 0 12px;font-size:12px}
    @media print{body{margin:8mm}.noprint{display:none}}
    .noprint{text-align:center;margin:14px 0}
    .btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <div class="head">
      <div><h1>ПРОДАЖБА</h1><div>№ <b>${escapeHtml(o.saleNo || "____")}</b></div></div>
      <div class="meta">Дата на издаване: <b>${escapeHtml(o.date || "")}</b><br>Дата на данъчно събитие: <b>${escapeHtml(o.taxDate || o.date || "")}</b></div>
    </div>
    <div class="parties">
      <div class="party"><h3>Продавач</h3><b>${escapeHtml(s.name || "")}</b><br>${sellerLines || '<span class="muted">— попълни данните на фирмата —</span>'}</div>
      <div class="party"><h3>Купувач</h3>${clientLines || '<span class="muted">—</span>'}</div>
    </div>
    <table class="items">
      <thead><tr><th>№</th><th>Код</th><th>Наименование</th><th>Кол.</th><th>Мярка</th><th>Ед. цена</th><th>Стойност</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="sum">
      <tr><td>Данъчна основа</td><td class="r">${erpSaleMoney(t.base, cur)}</td></tr>
      <tr><td>ДДС ${t.rate}%</td><td class="r">${erpSaleMoney(t.vat, cur)}</td></tr>
      <tr class="g"><td><b>Сума за плащане</b></td><td class="r"><b>${erpSaleMoney(t.total, cur)}</b></td></tr>
    </table>
    <div class="pay">Начин на плащане: <b>${escapeHtml(o.paymentMethod || "")}</b></div>
    ${o.note ? `<div class="pay">Забележка: ${escapeHtml(o.note)}</div>` : ""}
    <div class="foot"><div>Съставил</div><div>Получил</div></div>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
