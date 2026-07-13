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
  city: "Пловдив",
  address: "Кукленско шосе, разклона",
  iban: "",                // (по желание — за плащане по банков път)
  bank: "",
  mol: "Евгени Георгиев",  // МОЛ
};

let erpSales = null;

async function erpLoadSales() {
  const { data, error } = await sb.from("sales").select("*").order("updated_at", { ascending: false });
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
  const rows = erpSales;
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} продажби</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="erp-sa-new">+ Нова продажба</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>№ Продажба</th><th>Дата</th><th>Клиент</th><th class="num">Редове</th><th class="num">Сума</th><th>Статус</th><th></th></tr></thead>
      <tbody>
        ${rows.map(o => {
          const t = erpSaleTotals(o);
          return `
          <tr class="erp-clickable" data-id="${o.id}">
            <td data-label="№ Продажба"><b>${escapeHtml(o.saleNo || "—")}</b></td>
            <td data-label="Дата">${escapeHtml(o.date || "")}</td>
            <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
            <td class="num" data-label="Редове">${(o.lines || []).length}</td>
            <td class="num" data-label="Сума">${erpSaleMoney(t.total, erpSaleCur(o))}</td>
            <td data-label="Статус">${o.posted ? '<span class="erp-co-status" style="background:#dcfce7;color:#166534">осчетоводена</span>' : '<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">чернова</span>'}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
          </tr>`; }).join("") ||
          `<tr><td colspan="7" class="report-empty">Още няма продажби. Натисни „+ Нова продажба".</td></tr>`}
      </tbody>
    </table>`;
  document.getElementById("erp-sa-new").addEventListener("click", erpNewSale);
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenSale(b.dataset.open); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenSale(tr.dataset.id)));
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
  const lines = (order.lines || []).map(l => {
    const ple = (typeof erpPriceListEntry === "function") ? erpPriceListEntry(order.clientId, order.clientName, l.productId) : null;
    const name = (ple && ple.cname) ? ple.cname : (l.name || "");   // име при клиента за фактурата
    return {
      itemKind: "product", refId: l.productId, code: l.code || "", name, ourName: l.ourName || l.name || "",
      unit: "бр.", qty: erpToNum(l.qty) || 1, unitPrice: "",
    };
  });
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
      ${locked ? '<span class="erp-count">✓ Осчетоводена — само за преглед</span>'
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
  erpSaWireLines(o, locked);
  erpSaTotals(o);
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
      <td data-label="Код">${escapeHtml(l.code || "")}</td>
      <td data-label="Наименование">${locked ? escapeHtml(l.name || "") : `<input type="text" class="sa-name" data-i="${i}" value="${escapeAttr(l.name || "")}" style="width:100%;min-width:150px" title="Име за фактурата (напр. името при клиента)" />`}</td>
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
  if (o.posted) { alert("Вече е осчетоводена."); return; }
  if (!(o.lines || []).length) { alert("Добави поне един ред."); return; }
  try { await erpSaveSale(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

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
    if (l.writeoffKind === "detail") { addDetail(l.refId, qty); continue; }
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
  if (dNegatives.length) msg += `\n\n⚠ Детайли на минус:\n` + dNegatives.slice(0, 12).join("\n") + (dNegatives.length > 12 ? `\n…и още ${dNegatives.length - 12}` : "");
  msg += `\n\nДействието се прави веднъж.`;
  if (!confirm(msg)) return;

  const ref = `Продажба ${o.saleNo || "—"} · ${o.clientName || ""}`.trim();
  const by = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || null;

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
  await erpLoadAll();       // опреснява наличности в кеша
  await erpLoadSales();
  alert(`Готово! Осчетоводена продажба №${o.saleNo}.`
    + (dids.length ? `\nИзписани ${dids.length} готови детайла от Склад детайли.` : "")
    + (mids.length ? `\nИзписани ${mids.length} материала от склад материали.` : ""));
  erpRenderSaleForm(o);
}

/* ---------- Печат на документа „Продажба" ---------- */
function erpPrintSale(o) {
  const cur = erpSaleCur(o); const t = erpSaleTotals(o);
  const rows = (o.lines || []).map((l, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(l.code || "")}</td><td>${escapeHtml(l.name || "")}</td>
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
