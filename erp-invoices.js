/* Данко Системс — ЕРП „Фактуриране".
   Издава 4 типа документи по ЗДДС: Проформа, Фактура, Кредитно и Дебитно
   известие. Три серии номера (настройваеми): 1 = БГ пазар, 2 = износ (EN),
   3 = месечни. Печат 1:1 като реалната фактура (BG и EN). Известията носят
   задължителната връзка към оригиналната фактура (чл. 115 ЗДДС).

   Данните са в invoices.data (JSON); номерът е отделна колона (уникален индекс).
   Складови движения НЯМА тук — те остават в Продажби (Етап 2 ще свърже двете).
   Ползва ERP/erpDialog/erpToNum/erpNum/escapeHtml/erpLoadSaleClients/ERP_SELLER. */

const INV_KINDS = {
  invoice:  { label: "Фактура",           bg: "ФАКТУРА",           en: "INVOICE" },
  proforma: { label: "Проформа фактура",  bg: "ПРОФОРМА ФАКТУРА",  en: "PROFORMA INVOICE" },
  credit:   { label: "Кредитно известие", bg: "КРЕДИТНО ИЗВЕСТИЕ", en: "CREDIT NOTE" },
  debit:    { label: "Дебитно известие",  bg: "ДЕБИТНО ИЗВЕСТИЕ",  en: "DEBIT NOTE" },
};
const INV_EUR_BGN = 1.95583;

let erpInvoices = null;
let erpInvSeries = null;
let erpInvKindFilter = "", erpInvQuery = "", erpInvStatusFilter = "";

/* ---------- Зареждане / запис ---------- */
async function erpLoadInvoices() {
  const { data, error } = await sb.from("invoices").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  erpInvoices = (data || []).map(r => ({ id: r.id, docNo: r.doc_no, posted: r.posted, ...(r.data || {}) }));
}
async function erpSaveInvoice(o) {
  const data = { ...o }; delete data.id; delete data.posted; delete data.docNo;
  const row = { doc_no: o.docNo || null, kind: o.kind || "invoice", posted: !!o.posted, data, updated_at: new Date().toISOString() };
  if (o.id) { const { error } = await sb.from("invoices").update(row).eq("id", o.id); if (error) throw error; }
  else { const { data: ins, error } = await sb.from("invoices").insert(row).select("id").single(); if (error) throw error; o.id = ins.id; }
}

/* ---------- Серии / номерация ---------- */
async function erpInvLoadSeries() {
  if (erpInvSeries) return erpInvSeries;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "invoice_series").maybeSingle();
    erpInvSeries = (data && data.data && data.data.series) || null;
  } catch (e) { erpInvSeries = null; }
  if (!erpInvSeries) erpInvSeries = {
    "1": { label: "Български пазар", lang: "bg", next: 10000000 },
    "2": { label: "Износ (English)", lang: "en", next: 20000000 },
    "3": { label: "Месечни (край на месец)", lang: "bg", next: 300000000 },
  };
  return erpInvSeries;
}
async function erpInvSaveSeries() {
  const { error } = await sb.from("app_config").upsert({ id: "invoice_series", data: { series: erpInvSeries }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис на сериите: " + error.message + (/row-level security|violates/i.test(error.message || "") ? "\n\nПусни веднъж app-config-rls-fix.sql в Supabase." : "")); throw error; }
}

/* ---------- Числа с думи (Словом) ---------- */
function invBgWords(n) {
  n = Math.floor(Math.abs(Number(n)) || 0);
  if (n === 0) return "нула";
  const ones = ["", "един", "два", "три", "четири", "пет", "шест", "седем", "осем", "девет"];
  const onesFem = ["", "една", "две", "три", "четири", "пет", "шест", "седем", "осем", "девет"];
  const teens = ["десет", "единадесет", "дванадесет", "тринадесет", "четиринадесет", "петнадесет", "шестнадесет", "седемнадесет", "осемнадесет", "деветнадесет"];
  const tens = ["", "", "двадесет", "тридесет", "четиридесет", "петдесет", "шестдесет", "седемдесет", "осемдесет", "деветдесет"];
  const hundreds = ["", "сто", "двеста", "триста", "четиристотин", "петстотин", "шестстотин", "седемстотин", "осемстотин", "деветстотин"];
  const triple = (num, fem) => {
    const parts = [], h = Math.floor(num / 100), t = Math.floor((num % 100) / 10), o = num % 10;
    if (h) parts.push(hundreds[h]);
    if (t === 1) parts.push(teens[o]);
    else { if (t >= 2) parts.push(tens[t]); if (o) parts.push((fem ? onesFem : ones)[o]); }
    return parts;
  };
  const joinI = parts => parts.length <= 1 ? parts.join(" ") : parts.slice(0, -1).join(" ") + " и " + parts[parts.length - 1];
  const mil = Math.floor(n / 1000000), th = Math.floor((n % 1000000) / 1000), un = n % 1000;
  const segs = [];
  if (mil) segs.push({ text: joinI(triple(mil, false)) + " " + (mil === 1 ? "милион" : "милиона"), small: false });
  if (th) segs.push({ text: joinI(triple(th, true)) + " " + (th === 1 ? "хиляда" : "хиляди"), small: false });
  if (un) segs.push({ text: joinI(triple(un, false)), small: un < 100 });
  if (segs.length === 1) return segs[0].text;
  const last = segs.pop();
  return segs.map(s => s.text).join(" ") + (last.small ? " и " : " ") + last.text;
}
function invEnWords(n) {
  n = Math.floor(Math.abs(Number(n)) || 0);
  if (n === 0) return "zero";
  const a = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const b = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const tri = num => {
    let s = "";
    const h = Math.floor(num / 100), r = num % 100;
    if (h) s += a[h] + " hundred" + (r ? " " : "");
    if (r < 20) s += a[r];
    else s += b[Math.floor(r / 10)] + (r % 10 ? "-" + a[r % 10] : "");
    return s.trim();
  };
  const mil = Math.floor(n / 1000000), th = Math.floor((n % 1000000) / 1000), un = n % 1000;
  const out = [];
  if (mil) out.push(tri(mil) + " million");
  if (th) out.push(tri(th) + " thousand");
  if (un) out.push(tri(un));
  return out.join(" ").trim();
}
function invAmountWords(total, currency, lang) {
  const whole = Math.floor(Math.abs(total));
  const cents = Math.round((Math.abs(total) - whole) * 100);
  if (lang === "en") {
    const cur = currency === "BGN" ? "BGN" : "EUR";
    return invEnWords(whole) + " " + cur + (cents ? " and " + cents + " cents" : "");
  }
  const cur = currency === "BGN" ? "лева" : "EUR";
  const cw = currency === "BGN" ? "стотинки" : "цента";
  return invBgWords(whole) + " " + cur + (cents ? " и " + cents + " " + cw : "");
}

/* ---------- Пари ---------- */
function erpInvTotals(o) {
  const base = (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const rate = Number(o.vatRate != null ? o.vatRate : 20);
  const sign = o.kind === "credit" ? -1 : 1;   // кредитното намалява (показва се със знак)
  const vat = base * rate / 100;
  return { base: base * sign, vat: vat * sign, total: (base + vat) * sign, rate };
}
function erpInvMoney(n, cur) {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (cur || "EUR");
}
function erpInvCur(o) { return o.currency || "EUR"; }

/* ---------- Тегло от рецептата (кг) ---------- */
// Тегло на 1 БРОЙ продукт: разбива рецептата до материали и сумира
// (материал в кг → 1; иначе от ръчно въведеното тегло на мярката).
function erpProductWeightKg(pid) {
  if (!pid || typeof ERP === "undefined" || !ERP.linesByProduct) return 0;
  let kg = 0;
  const rec = (id, mult, anc) => {
    (ERP.linesByProduct[id] || []).forEach(l => {
      const q = mult * (Number(l.quantity) || 1);
      if (l.material_id) {
        const m = ERP.matById[l.material_id];
        const f = m ? (typeof erpMatKgPerUnit === "function" ? erpMatKgPerUnit(m) : null) : null;
        if (f) kg += q * f;
      } else if (l.child_product_id && !anc.has(l.child_product_id)) {
        rec(l.child_product_id, q, new Set([...anc, l.child_product_id]));
      }
    });
  };
  rec(pid, 1, new Set([pid]));
  return kg;
}
// Тегло на цял ред (кг) = бройка × тегло на 1 продукт (0, ако редът не е продукт с рецепта).
function erpInvLineKg(l) {
  const w = erpProductWeightKg(l && (l.productId || l.refId));
  return w > 0 ? Math.round((erpToNum(l.qty) || 0) * w * 1000) / 1000 : 0;
}

/* ---------- Списък ---------- */
async function erpRenderInvoices() {
  const v = erpView();
  if (!erpInvoices) { v.innerHTML = `<p class="erp-loading">Зареждане…</p>`; try { await erpLoadInvoices(); await erpInvLoadSeries(); } catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя фактурите</h3><p>${escapeHtml(e.message || String(e))}</p><p class="hint">Пусни <code>invoices-setup.sql</code> в Supabase.</p></div>`; return; } }
  const q = (erpInvQuery || "").toLowerCase().trim();
  let rows = (erpInvoices || []).filter(o =>
    (!erpInvKindFilter || o.kind === erpInvKindFilter) &&
    (!erpInvStatusFilter || (o.status || (o.posted ? "издадена" : "чернова")) === erpInvStatusFilter) &&
    (!q || `${o.docNo || ""} ${o.client && o.client.name || ""} ${INV_KINDS[o.kind] && INV_KINDS[o.kind].label || ""}`.toLowerCase().includes(q)));
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} документа</span>
      <input type="search" id="inv-q" placeholder="🔎 № / клиент…" value="${escapeAttr(erpInvQuery)}" style="min-width:170px" />
      <label class="erp-inline">Тип
        <select id="inv-fkind"><option value="">Всички</option>${Object.entries(INV_KINDS).map(([k, x]) => `<option value="${k}" ${k === erpInvKindFilter ? "selected" : ""}>${x.label}</option>`).join("")}</select></label>
      <label class="erp-inline">Статус
        <select id="inv-fstatus"><option value="">Всички</option>${["чернова", "издадена", "платена", "сторнирана"].map(s => `<option ${s === erpInvStatusFilter ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <span class="spacer"></span>
      <button class="btn btn-small" id="inv-series">⚙ Серии/номера</button>
      <button class="btn btn-small btn-primary" id="inv-new-proforma">+ Проформа</button>
      <button class="btn btn-small btn-primary" id="inv-new-invoice">+ Фактура</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>№</th><th>Тип</th><th>Клиент</th><th>Дата</th><th class="num">Сума</th><th>Вал.</th><th>Статус</th><th></th></tr></thead>
      <tbody>${rows.map(o => {
        const t = erpInvTotals(o); const k = INV_KINDS[o.kind] || {};
        const status = o.status || (o.posted ? "издадена" : "чернова");
        return `<tr class="erp-clickable" data-id="${o.id}">
          <td data-label="№"><b>${escapeHtml(o.docNo || "—")}</b></td>
          <td data-label="Тип">${escapeHtml(k.label || o.kind)}</td>
          <td data-label="Клиент">${escapeHtml((o.client && o.client.name) || "")}</td>
          <td data-label="Дата">${escapeHtml(o.issueDate || "")}</td>
          <td class="num" data-label="Сума">${erpInvMoney(t.total, erpInvCur(o))}</td>
          <td data-label="Вал.">${escapeHtml(erpInvCur(o))}</td>
          <td data-label="Статус"><span class="erp-co-status s-${escapeAttr(status)}">${escapeHtml(status)}</span></td>
          <td class="erp-row-actions"><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
        </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">Още няма документи. Натисни „+ Фактура".</td></tr>`}
      </tbody>
    </table>
    <p class="hint">Складът се движи от <b>Продажби</b> (не оттук). Фактурата е документът. Етап 2 ще свърже двете за тест.</p>`;

  const qEl = document.getElementById("inv-q");
  if (qEl) qEl.addEventListener("input", e => { erpInvQuery = e.target.value; erpRenderInvoices(); });
  document.getElementById("inv-fkind").addEventListener("change", e => { erpInvKindFilter = e.target.value; erpRenderInvoices(); });
  document.getElementById("inv-fstatus").addEventListener("change", e => { erpInvStatusFilter = e.target.value; erpRenderInvoices(); });
  document.getElementById("inv-series").addEventListener("click", erpInvSeriesDialog);
  document.getElementById("inv-new-proforma").addEventListener("click", () => erpNewInvoice("proforma"));
  document.getElementById("inv-new-invoice").addEventListener("click", () => erpNewInvoice("invoice"));
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenInvoice(Number(b.dataset.open)); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenInvoice(Number(tr.dataset.id))));
}

function erpOpenInvoice(id) {
  const o = (erpInvoices || []).find(x => x.id === id);
  if (o) erpInvForm(JSON.parse(JSON.stringify(o)));
}
function erpNewInvoice(kind) {
  const today = new Date().toISOString().slice(0, 10);
  erpInvForm({
    kind, seriesKey: kind === "proforma" ? "1" : "1",
    issueDate: today, taxDate: today, orderRef: "",
    client: { name: "", eik: "", vat: "", city: "", street: "", country: "България", person: "" }, clientId: null,
    currency: "EUR", vatRate: 20, vatBasis: "", paymentMethod: "по банка", termDays: 0, dueDate: "", note: "",
    refInvoice: null, refReason: "", lines: [], status: "чернова", posted: false,
    compiledBy: (ERP_SELLER && ERP_SELLER.mol) || "",
  });
}

/* ---------- Настройка на серии ---------- */
async function erpInvSeriesDialog() {
  await erpInvLoadSeries();
  const s = erpInvSeries;
  const { wrap, close } = erpDialog(`
    <h3>⚙ Серии и номера</h3>
    <p class="hint" style="margin:0 0 8px">Задай „следващ номер" за всяка серия. При издаване системата взима номера и увеличава с 1. <b>Внимание:</b> ако издавате фактури и от друг софтуер — номерата ще се бият. Тук трябва да е официалният издател.</p>
    ${Object.entries(s).map(([k, x]) => `
      <div class="inv-series-row">
        <b>Серия ${escapeHtml(k)}</b>
        <label>Име <input type="text" id="invs-label-${k}" value="${escapeAttr(x.label || "")}" /></label>
        <label>Език <select id="invs-lang-${k}"><option value="bg" ${x.lang === "bg" ? "selected" : ""}>BG</option><option value="en" ${x.lang === "en" ? "selected" : ""}>EN</option></select></label>
        <label>Следващ № <input type="number" id="invs-next-${k}" value="${escapeAttr(String(x.next || 0))}" /></label>
      </div>`).join("")}
    <div class="erp-dialog-actions"><button class="btn" id="invs-cancel">Отказ</button><button class="btn btn-primary" id="invs-save">Запази</button></div>`);
  wrap.querySelector("#invs-cancel").addEventListener("click", close);
  wrap.querySelector("#invs-save").addEventListener("click", async () => {
    Object.keys(s).forEach(k => {
      s[k].label = wrap.querySelector("#invs-label-" + k).value.trim() || s[k].label;
      s[k].lang = wrap.querySelector("#invs-lang-" + k).value;
      s[k].next = Math.floor(Number(wrap.querySelector("#invs-next-" + k).value) || s[k].next);
    });
    await erpInvSaveSeries(); close(); erpRenderInvoices();
  });
}

/* ---------- Форма ---------- */
async function erpInvForm(o) {
  const v = erpView();
  await erpInvLoadSeries();
  const clients = await erpLoadSaleClients();
  const locked = !!o.posted;
  const k = INV_KINDS[o.kind] || {};
  const isNote = o.kind === "credit" || o.kind === "debit";
  const cur = erpInvCur(o);
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="inv-back">← Назад</button>
      <span class="erp-count">${escapeHtml(k.label || o.kind)}${o.docNo ? " № " + escapeHtml(o.docNo) : " (чернова)"}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="inv-print">🖨 Печат</button>
      ${locked ? '<span class="erp-count">✓ Издадена — само преглед</span>'
        : '<button class="btn btn-small" id="inv-save">💾 Запази</button><button class="btn btn-small btn-primary" id="inv-issue">📤 Издай (вземи номер)</button>'}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Серия
          <select id="inv-series" ${locked ? "disabled" : ""}>${Object.entries(erpInvSeries).map(([sk, x]) => `<option value="${sk}" ${sk === o.seriesKey ? "selected" : ""}>${escapeHtml(sk + " · " + x.label + " (сл. № " + x.next + ")")}</option>`).join("")}</select></label>
        <label>Тип
          <select id="inv-kind" ${locked ? "disabled" : ""}>${Object.entries(INV_KINDS).map(([kk, x]) => `<option value="${kk}" ${kk === o.kind ? "selected" : ""}>${x.label}</option>`).join("")}</select></label>
        <label>Дата на издаване <input type="date" id="inv-date" value="${escapeAttr(o.issueDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Дата на данъчно събитие <input type="date" id="inv-taxdate" value="${escapeAttr(o.taxDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>№/дата на поръчка <input type="text" id="inv-orderref" value="${escapeAttr(o.orderRef || "")}" ${locked ? "disabled" : ""} placeholder="реф. към заявката" /></label>
        <label>Начин на плащане <input type="text" id="inv-pay" value="${escapeAttr(o.paymentMethod || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Разсрочено — срок (дни) <input type="number" id="inv-term" min="0" value="${escapeAttr(String(o.termDays || 0))}" ${locked ? "disabled" : ""} placeholder="0 = веднага" /></label>
        <label>Падеж (дата за плащане) <input type="date" id="inv-due" value="${escapeAttr(o.dueDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Валута <select id="inv-cur" ${locked ? "disabled" : ""}>${["EUR", "BGN"].map(c => `<option ${c === cur ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label>ДДС ставка % <select id="inv-vat" ${locked ? "disabled" : ""}>${["20", "9", "0"].map(r => `<option value="${r}" ${Number(r) === Number(o.vatRate) ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
      </div>
      ${isNote ? `<div class="inv-note-ref">
        <b>Връзка към фактура (чл. 115 — задължително):</b>
        <label>Фактура № <input type="text" id="inv-refno" value="${escapeAttr((o.refInvoice && o.refInvoice.docNo) || "")}" ${locked ? "disabled" : ""} placeholder="номер на оригиналната фактура" /></label>
        <label>Дата <input type="date" id="inv-refdate" value="${escapeAttr((o.refInvoice && o.refInvoice.date) || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Основание <input type="text" id="inv-refreason" value="${escapeAttr(o.refReason || "")}" ${locked ? "disabled" : ""} placeholder="напр. връщане на стока / корекция" /></label>
      </div>` : ""}
      ${o.vatRate == 0 ? `<label class="erp-co-note">Основание за 0% ДДС <input type="text" id="inv-vatbasis" value="${escapeAttr(o.vatBasis || "")}" ${locked ? "disabled" : ""} placeholder="напр. чл. 28 ЗДДС (износ) / чл. 53 (ВОД)" /></label>` : ""}

      <h4 class="erp-group-head">Купувач</h4>
      <div class="erp-co-grid">
        <label>Клиент <input type="text" id="inv-cname" list="inv-clients" value="${escapeAttr(o.client.name || "")}" ${locked ? "disabled" : ""} />
          <datalist id="inv-clients">${clients.map(c => `<option value="${escapeAttr(c.name || "")}"></option>`).join("")}</datalist></label>
        <label>ЕИК <input type="text" id="inv-ceik" value="${escapeAttr(o.client.eik || "")}" ${locked ? "disabled" : ""} /></label>
        <label>ДДС № <input type="text" id="inv-cvat" value="${escapeAttr(o.client.vat || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Град <input type="text" id="inv-ccity" value="${escapeAttr(o.client.city || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Адрес <input type="text" id="inv-cstreet" value="${escapeAttr(o.client.street || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Държава <input type="text" id="inv-ccountry" value="${escapeAttr(o.client.country || "")}" ${locked ? "disabled" : ""} /></label>
      </div>

      <h4 class="erp-group-head">Редове</h4>
      <table class="report-table erp-table" id="inv-lines">
        <thead><tr><th>Код</th><th>Наименование</th><th class="num">Кол.</th><th>МЕ</th><th class="num">Ед. цена</th><th class="num">Стойност</th><th></th></tr></thead>
        <tbody>${erpInvLinesHtml(o, locked)}</tbody>
      </table>
      ${locked ? "" : '<div class="erp-co-actions"><button class="btn btn-small" id="inv-add-prod">+ Продукт</button><button class="btn btn-small" id="inv-add-free">+ Свободен ред</button></div>'}
      <div class="erp-sale-totals" id="inv-totals"></div>
      <label class="erp-co-note">Забележка <textarea id="inv-note" rows="2" ${locked ? "disabled" : ""}>${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">Придружаващи документи</h4>
      <div class="erp-co-actions">
        <button class="btn btn-small" id="inv-doc-goods">📦 Стокова разписка</button>
        <button class="btn btn-small" id="inv-doc-packing">📦 Packing List</button>
        <button class="btn btn-small" id="inv-doc-cmr">🚚 ЧМР (CMR)</button>
        <button class="btn btn-small" id="inv-doc-pallets">🧱 Палет опис</button>
        <span class="spacer"></span>
        <button class="btn btn-small" id="inv-edit-transport" ${locked ? "disabled" : ""}>✎ Транспорт</button>
        <button class="btn btn-small" id="inv-edit-pallets" ${locked ? "disabled" : ""}>✎ Палети (${(o.pallets || []).length})</button>
      </div>
      <p class="hint">Стоковата разписка е за БГ доставки; Packing List + ЧМР — за износ; Палет описът — за всички. „Транспорт" и „Палети" попълват данните за тези документи.</p>
    </div>`;

  const bindClient = () => {
    const m = clients.find(c => (c.name || "") === document.getElementById("inv-cname").value);
    if (m) { o.client.name = m.name; o.client.eik = m.eik || o.client.eik; o.client.vat = m.vat || o.client.vat; o.client.city = m.city || o.client.city; o.client.street = m.street || o.client.street; o.client.country = m.country || o.client.country; o.clientId = m.id; erpInvForm(o); }
  };
  document.getElementById("inv-back").addEventListener("click", erpRenderInvoices);
  const g = (id, cb) => { const el = document.getElementById(id); if (el) el.addEventListener(locked ? "change" : "input", cb); };
  g("inv-series", e => o.seriesKey = e.target.value);
  g("inv-kind", e => { o.kind = e.target.value; erpInvForm(o); });
  g("inv-date", e => o.issueDate = e.target.value);
  g("inv-taxdate", e => o.taxDate = e.target.value);
  g("inv-orderref", e => o.orderRef = e.target.value);
  g("inv-pay", e => o.paymentMethod = e.target.value);
  g("inv-term", e => { o.termDays = Number(e.target.value) || 0; if (Number(o.termDays) > 0 && !o.dueDate && o.issueDate) { const el = document.getElementById("inv-due"); const d = new Date(o.issueDate + "T00:00:00"); if (!isNaN(d.getTime())) { d.setDate(d.getDate() + o.termDays); if (el) el.value = d.toISOString().slice(0, 10); o.dueDate = el ? el.value : o.dueDate; } } });
  g("inv-due", e => o.dueDate = e.target.value);
  g("inv-cur", e => { o.currency = e.target.value; erpInvTotalsBox(o); });
  g("inv-vat", e => { o.vatRate = Number(e.target.value); erpInvForm(o); });
  g("inv-vatbasis", e => o.vatBasis = e.target.value);
  g("inv-refno", e => { o.refInvoice = o.refInvoice || {}; o.refInvoice.docNo = e.target.value; });
  g("inv-refdate", e => { o.refInvoice = o.refInvoice || {}; o.refInvoice.date = e.target.value; });
  g("inv-refreason", e => o.refReason = e.target.value);
  g("inv-cname", e => o.client.name = e.target.value);
  const cn = document.getElementById("inv-cname"); if (cn && !locked) cn.addEventListener("change", bindClient);
  g("inv-ceik", e => o.client.eik = e.target.value);
  g("inv-cvat", e => o.client.vat = e.target.value);
  g("inv-ccity", e => o.client.city = e.target.value);
  g("inv-cstreet", e => o.client.street = e.target.value);
  g("inv-ccountry", e => o.client.country = e.target.value);
  g("inv-note", e => o.note = e.target.value);
  const pr = document.getElementById("inv-print"); if (pr) pr.addEventListener("click", () => erpInvPrint(o));
  const sv = document.getElementById("inv-save"); if (sv) sv.addEventListener("click", () => erpInvSaveClick(o));
  const iss = document.getElementById("inv-issue"); if (iss) iss.addEventListener("click", () => erpInvIssue(o));
  const ap = document.getElementById("inv-add-prod"); if (ap) ap.addEventListener("click", () => erpInvAddProduct(o));
  const af = document.getElementById("inv-add-free"); if (af) af.addEventListener("click", () => { o.lines.push({ code: "", name: "", clientCode: "", unit: "бр.", qty: 1, unitPrice: "" }); erpInvLinesRefresh(o); });
  const dg = document.getElementById("inv-doc-goods"); if (dg) dg.addEventListener("click", () => erpInvPrintGoodsNote(o));
  const dp = document.getElementById("inv-doc-packing"); if (dp) dp.addEventListener("click", () => erpInvPrintPacking(o));
  const dc = document.getElementById("inv-doc-cmr"); if (dc) dc.addEventListener("click", () => erpInvPrintCMR(o));
  const dl = document.getElementById("inv-doc-pallets"); if (dl) dl.addEventListener("click", () => erpInvPrintPallets(o));
  const et = document.getElementById("inv-edit-transport"); if (et) et.addEventListener("click", () => erpInvTransportDialog(o));
  const ep = document.getElementById("inv-edit-pallets"); if (ep) ep.addEventListener("click", () => erpInvPalletsDialog(o));
  erpInvWireLines(o, locked);
  erpInvTotalsBox(o);
}

function erpInvLinesHtml(o, locked) {
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Код">${locked ? escapeHtml(l.code || "") : `<input type="text" class="inv-code" data-i="${i}" value="${escapeAttr(l.code || "")}" style="width:80px" />`}${l.clientCode ? `<div class="erp-co-ccode">клиент: ${escapeHtml(l.clientCode)}</div>` : ""}</td>
      <td data-label="Наименование">${locked ? escapeHtml(l.name || "") : `<input type="text" class="inv-name" data-i="${i}" value="${escapeAttr(l.name || "")}" style="width:100%;min-width:160px" />`}</td>
      <td class="num" data-label="Кол.">${locked ? erpNum(l.qty) : `<input type="number" class="inv-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:80px" />`}</td>
      <td data-label="МЕ">${locked ? escapeHtml(l.unit || "") : `<input type="text" class="inv-unit" data-i="${i}" value="${escapeAttr(l.unit || "бр.")}" style="width:56px" />`}</td>
      <td class="num" data-label="Ед. цена">${locked ? erpNum(l.unitPrice) : `<input type="number" class="inv-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:100px" placeholder="0.00" />`}</td>
      <td class="num" data-label="Стойност">${erpInvMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpInvCur(o))}</td>
      <td class="erp-row-actions">${locked ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="report-empty">Няма редове.</td></tr>`;
}
function erpInvWireLines(o, locked) {
  if (locked) return;
  const body = document.querySelector("#inv-lines tbody"); if (!body) return;
  const line = el => o.lines[Number(el.dataset.i)];
  body.querySelectorAll(".inv-code").forEach(el => el.addEventListener("input", () => line(el).code = el.value));
  body.querySelectorAll(".inv-name").forEach(el => el.addEventListener("input", () => line(el).name = el.value));
  body.querySelectorAll(".inv-unit").forEach(el => el.addEventListener("input", () => line(el).unit = el.value));
  body.querySelectorAll(".inv-qty").forEach(el => el.addEventListener("input", () => { line(el).qty = erpToNum(el.value); erpInvLineSums(o); }));
  body.querySelectorAll(".inv-price").forEach(el => el.addEventListener("input", () => { line(el).unitPrice = erpToNum(el.value); erpInvLineSums(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpInvLinesRefresh(o); }));
}
function erpInvLineSums(o) {
  const body = document.querySelector("#inv-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => {
    const l = (o.lines || [])[i]; if (!l) return;
    const c = tr.querySelector('td[data-label="Стойност"]');
    if (c) c.textContent = erpInvMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpInvCur(o));
  });
  erpInvTotalsBox(o);
}
function erpInvLinesRefresh(o) {
  const body = document.querySelector("#inv-lines tbody");
  if (body) { body.innerHTML = erpInvLinesHtml(o, false); erpInvWireLines(o, false); }
  erpInvTotalsBox(o);
}
function erpInvTotalsBox(o) {
  const box = document.getElementById("inv-totals"); if (!box) return;
  const t = erpInvTotals(o); const cur = erpInvCur(o);
  const bgn = cur === "EUR" ? ` <span class="erp-muted">= ${erpInvMoney(t.total * INV_EUR_BGN, "BGN")}</span>` : "";
  box.innerHTML = `<table class="erp-sale-sum">
    <tr><td>Данъчна основа</td><td class="num">${erpInvMoney(t.base, cur)}</td></tr>
    <tr><td>ДДС ${t.rate}%</td><td class="num">${erpInvMoney(t.vat, cur)}</td></tr>
    <tr class="grand"><td><b>Сума за плащане</b></td><td class="num"><b>${erpInvMoney(t.total, cur)}${bgn}</b></td></tr></table>
    <p class="erp-muted" style="margin:4px 0 0">Словом: ${escapeHtml(invAmountWords(t.total, cur, "bg"))}</p>`;
}

function erpInvAddProduct(o) {
  const { wrap, close } = erpDialog(`
    <h3>Добави продукт</h3>
    <input type="search" id="invp-q" placeholder="търси код или име…" />
    <div id="invp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="invp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#invp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.slice();
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(p => `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}</button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const p = ERP.prodById[Number(b.dataset.id)];
      o.lines.push({ productId: p.id, code: p.code || "", name: p.name || "", clientCode: "", unit: "бр.", qty: 1, unitPrice: "" });
      close(); erpInvLinesRefresh(o);
    }));
  };
  render(""); wrap.querySelector("#invp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#invp-cancel").addEventListener("click", close);
}

async function erpInvSaveClick(o) {
  const btn = document.getElementById("inv-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  try { await erpSaveInvoice(o); await erpLoadInvoices(); if (btn) { btn.disabled = false; btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) btn.textContent = "💾 Запази"; }, 1400); } }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; } alert("Грешка при запис: " + (e.message || e)); }
}

async function erpInvIssue(o) {
  if (o.posted) return;
  if (!(o.lines || []).length) { alert("Добави поне един ред."); return; }
  if (!o.client.name) { alert("Въведи клиент."); return; }
  if ((o.kind === "credit" || o.kind === "debit") && !(o.refInvoice && o.refInvoice.docNo)) {
    alert("Известието задължително се връзва към фактура (чл. 115): въведи номер на оригиналната фактура."); return;
  }
  if (!confirm("Да издам ли документа и да взема номер от серията? След това не може да се редактира.")) return;
  const btn = document.getElementById("inv-issue");
  if (btn) { btn.disabled = true; btn.textContent = "Издавам…"; }
  try {
    await erpInvLoadSeries();
    const ser = erpInvSeries[o.seriesKey] || erpInvSeries["1"];
    o.docNo = String(ser.next);
    o.posted = true; o.status = "издадена";
    await erpSaveInvoice(o);              // уникалният индекс ще хване евентуален дублат
    ser.next = Math.floor(Number(ser.next) || 0) + 1;
    await erpInvSaveSeries();
    await erpLoadInvoices();
    // Издадената фактура става вземане от клиента (проформата не влиза).
    try { if (typeof erpRecvSyncFromInvoice === "function") await erpRecvSyncFromInvoice(o); } catch (e) {}
    erpInvForm(JSON.parse(JSON.stringify((erpInvoices || []).find(x => x.id === o.id) || o)));
  } catch (e) {
    o.posted = false; o.status = "чернова"; o.docNo = null;
    if (btn) { btn.disabled = false; btn.textContent = "📤 Издай (вземи номер)"; }
    alert("Грешка при издаване: " + (e.message || e) + "\n(Ако номерът вече съществува — смени следващия номер в Серии.)");
  }
}

/* ---------- Печат (BG / EN, 1:1 като реалната фактура) ---------- */
function erpInvPrint(o) {
  const ser = (erpInvSeries && erpInvSeries[o.seriesKey]) || { lang: "bg" };
  const en = ser.lang === "en";
  const k = INV_KINDS[o.kind] || {};
  const title = en ? (k.en || "INVOICE") : (k.bg || "ФАКТУРА");
  const t = erpInvTotals(o); const cur = erpInvCur(o);
  const s = ERP_SELLER || {};
  const L = en ? {
    orig: "ORIGINAL", no: "No", date: "Date", order: "Order No/date", recipient: "Recipient", supplier: "Supplier",
    eik: "UIC", vat: "VAT No", nn: "No", name: "Description", code: "Code", qty: "Qty/UoM", price: "Unit price", amount: "Amount",
    words: "In words", pay: "Payment", due: "Due date", base: "Tax base", vatL: "VAT", total: "Total", compiled: "Issued by", received: "Received by",
    ref: "To invoice No/date", reason: "Reason",
  } : {
    orig: "ОРИГИНАЛ", no: "№", date: "Дата", order: "Номер и дата на поръчка", recipient: "Получател", supplier: "Доставчик",
    eik: "ЕИК", vat: "ДДС №", nn: "№", name: "Наименование на стоките и услугите", code: "Код", qty: "Кол./МЕ", price: "Ед. цена", amount: "Стойност",
    words: "Словом", pay: "Начин на плащане", due: "Падеж", base: "Данъчна основа", vatL: "ДДС", total: "Обща стойност", compiled: "Съставил", received: "Получил",
    ref: "Към фактура №/дата", reason: "Основание",
  };
  const rows = (o.lines || []).map((l, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(l.code || "")}${l.clientCode ? `<br><small>клиент: ${escapeHtml(l.clientCode)}</small>` : ""}</td>
      <td>${escapeHtml(l.name || "")}</td>
      <td class="r">${erpNum(l.qty)} ${escapeHtml(l.unit || "")}</td>
      <td class="r">${erpNum(l.unitPrice)}</td>
      <td class="r">${erpInvMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), cur)}</td></tr>`).join("")
    || `<tr><td colspan="6" class="c muted">—</td></tr>`;
  const sellerLines = [
    (en ? "UIC: " : "ЕИК: ") + escapeHtml(s.eik || ""),
    (en ? "VAT: " : "ДДС №: ") + escapeHtml(s.vat || ""),
    escapeHtml([s.address, s.city].filter(Boolean).join(", ")),
    s.iban ? "IBAN: " + escapeHtml(s.iban) + (s.bic ? " · " + escapeHtml(s.bic) : "") : "",
    s.bank ? (en ? "Bank: " : "Банка: ") + escapeHtml(s.bank) : "",
    s.phone ? (en ? "Tel: " : "тел: ") + escapeHtml(s.phone) : "",
    s.email ? "e-mail: " + escapeHtml(s.email) : "",
  ].filter(Boolean).join("<br>");
  const clientLines = [
    (en ? "UIC: " : "ЕИК: ") + escapeHtml(o.client.eik || ""),
    (en ? "VAT: " : "ДДС №: ") + escapeHtml(o.client.vat || ""),
    escapeHtml([o.client.street, o.client.city, o.client.country].filter(Boolean).join(", ")),
    o.client.person ? escapeHtml(o.client.person) : "",
  ].filter(Boolean).join("<br>");
  const noteRef = (o.kind === "credit" || o.kind === "debit") && o.refInvoice
    ? `<div class="pay"><b>${L.ref}:</b> ${escapeHtml(o.refInvoice.docNo || "")} / ${escapeHtml(o.refInvoice.date || "")}${o.refReason ? ` · ${L.reason}: ${escapeHtml(o.refReason)}` : ""}</div>` : "";
  const vatBasis = (Number(o.vatRate) === 0 && o.vatBasis) ? `<div class="pay">${escapeHtml(o.vatBasis)}</div>` : "";
  const bgn = cur === "EUR" ? `<tr><td></td><td class="r">= ${erpInvMoney(t.total * INV_EUR_BGN, "BGN")}</td></tr>` : "";

  const html = `<!doctype html><html lang="${en ? "en" : "bg"}"><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(o.docNo || "")}</title>
  <style>*{box-sizing:border-box}body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 22px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}
    .head h1{font-size:22px;margin:0;color:#0f766e;letter-spacing:1px}.sub{font-size:11px;color:#666}
    .meta{text-align:right;font-size:12px}.parties{display:flex;gap:16px;margin-bottom:14px}
    .party{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px}.party h3{margin:0 0 4px;font-size:12px;color:#0f766e}
    table.items{width:100%;border-collapse:collapse;margin-bottom:8px}table.items th,table.items td{border:1px solid #cbd5e1;padding:5px 7px;font-size:11.5px;text-align:left}
    table.items th{background:#ecfdf5;color:#065f46}td.r{text-align:right}td.c{text-align:center}.muted{color:#777}small{color:#555}
    .sum{width:300px;margin-left:auto;border-collapse:collapse}.sum td{padding:4px 8px}.sum tr.g td{border-top:2px solid #0f766e;font-size:14px}
    .pay{margin:5px 0;font-size:12px}.words{font-style:italic;margin:6px 0}
    .foot{display:flex;justify-content:space-between;margin-top:28px;font-size:11px}.foot div{flex:1;border-top:1px solid #333;padding-top:4px;margin:0 12px;text-align:center}
    @media print{body{margin:8mm}.noprint{display:none}}.noprint{text-align:center;margin:14px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 ${en ? "Print" : "Печат"}</button></div>
    <div class="head">
      <div><h1>${escapeHtml(title)}</h1><div>${L.orig}</div></div>
      <div class="meta"><b>${escapeHtml(s.name || "")}</b><br>${L.no} <b>${escapeHtml(o.docNo || "____")}</b><br>${L.date}: <b>${escapeHtml(o.issueDate || "")}</b>${o.orderRef ? `<br>${L.order}: ${escapeHtml(o.orderRef)}` : ""}</div>
    </div>
    <div class="parties">
      <div class="party"><h3>${L.recipient}</h3><b>${escapeHtml(o.client.name || "")}</b><br>${clientLines || '<span class="muted">—</span>'}</div>
      <div class="party"><h3>${L.supplier}</h3><b>${escapeHtml(s.name || "")}</b><br>${sellerLines}</div>
    </div>
    ${noteRef}${vatBasis}
    <table class="items">
      <thead><tr><th>${L.nn}</th><th>${L.code}</th><th>${L.name}</th><th>${L.qty}</th><th>${L.price} ${cur}</th><th>${L.amount} ${cur}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="words">${L.words}: <b>${escapeHtml(invAmountWords(t.total, cur, en ? "en" : "bg"))}</b></div>
    <table class="sum">
      <tr><td>${L.base}</td><td class="r">${erpInvMoney(t.base, cur)}</td></tr>
      <tr><td>${L.vatL} ${t.rate}%</td><td class="r">${erpInvMoney(t.vat, cur)}</td></tr>
      <tr class="g"><td><b>${L.total}</b></td><td class="r"><b>${erpInvMoney(t.total, cur)}</b></td></tr>
      ${bgn}
    </table>
    <div class="pay">${L.pay}: <b>${escapeHtml(o.paymentMethod || "")}</b>${(o.dueDate || Number(o.termDays) > 0) ? ` · ${L.due}: <b>${escapeHtml(o.dueDate || "")}</b>${Number(o.termDays) > 0 ? ` (${o.termDays} ${en ? "days" : "дни"})` : ""}` : ""}</div>
    ${o.note ? `<div class="pay">${escapeHtml(o.note)}</div>` : ""}
    <div class="foot"><div>${L.compiled}${o.compiledBy ? ": " + escapeHtml(o.compiledBy) : ""}</div><div>${L.received}</div></div>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

/* ---------- Етап 2: фактура от продажба ---------- */
function erpInvFromSale(sale) {
  const today = new Date().toISOString().slice(0, 10);
  const country = (sale.clientCountry || "").trim();
  const isExport = !!country && !/^(bg|бг|българия|bulgaria)$/i.test(country);
  const lines = (sale.lines || []).map(l => ({
    productId: l.refId || l.productId, code: l.code || "", name: l.name || "", clientCode: l.clientCode || "",
    unit: l.unit || "бр.", qty: erpToNum(l.qty) || 0, unitPrice: erpToNum(l.unitPrice) || "",
  })).filter(l => (erpToNum(l.qty) || 0) > 0);
  if (!lines.length) { alert("Продажбата няма редове с количество."); return; }
  erpInvForm({
    kind: "invoice", seriesKey: isExport ? "2" : "1",
    issueDate: today, taxDate: sale.taxDate || today,
    orderRef: sale.note || "",
    client: { name: sale.clientName || "", eik: "", vat: sale.clientVat || "", city: sale.clientCity || "", street: sale.clientStreet || "", country: country || "България", person: "" },
    clientId: sale.clientId || null,
    currency: sale.currency || "EUR", vatRate: sale.vatRate != null ? sale.vatRate : 20, vatBasis: "",
    paymentMethod: sale.paymentMethod || "по банка", termDays: sale.termDays || 0, dueDate: sale.dueDate || "", note: "",
    refInvoice: null, refReason: "", lines, status: "чернова", posted: false,
    saleId: sale.id, compiledBy: (ERP_SELLER && ERP_SELLER.mol) || "",
    transport: {}, pallets: [],
  });
}

/* ---------- Етап 3: данни за транспорт / палети ---------- */
function erpInvTransportDialog(o, onDone) {
  const tr = o.transport = o.transport || {};
  const f = (id, label, val, ph) => `<label>${label} <input type="text" id="tr-${id}" value="${escapeAttr(val || "")}" ${ph ? `placeholder="${escapeAttr(ph)}"` : ""} /></label>`;
  const { wrap, close } = erpDialog(`
    <h3>Данни за транспорт (ЧМР / Packing List)</h3>
    <div class="inv-tr-grid">
      ${f("carrier", "Превозвач", tr.carrier)}
      ${f("vehicle", "Рег. № на МПС", tr.vehicleReg)}
      ${f("driver", "Шофьор", tr.driver)}
      ${f("loadPlace", "Място на товарене", tr.loadPlace, "град, държава")}
      ${f("unloadPlace", "Място на разтоварване", tr.unloadPlace, "град, държава")}
      ${f("loadDate", "Дата на товарене", tr.loadDate)}
      ${f("incoterms", "Условие на доставка (Incoterms)", tr.incoterms, "напр. FCA Пловдив")}
      ${f("packages", "Брой пакети/палети", tr.totalPackages)}
      ${f("weight", "Общо бруто тегло (кг)", tr.totalWeightKg)}
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="tr-cancel">Отказ</button><button class="btn btn-primary" id="tr-save">Запази</button></div>`);
  wrap.querySelector("#tr-cancel").addEventListener("click", close);
  wrap.querySelector("#tr-save").addEventListener("click", () => {
    const g = id => (wrap.querySelector("#tr-" + id).value || "").trim();
    o.transport = { carrier: g("carrier"), vehicleReg: g("vehicle"), driver: g("driver"), loadPlace: g("loadPlace"), unloadPlace: g("unloadPlace"), loadDate: g("loadDate"), incoterms: g("incoterms"), totalPackages: g("packages"), totalWeightKg: g("weight") };
    close();
    if (typeof onDone === "function") onDone();
  });
}

function erpInvPalletsDialog(o, onDone) {
  o.pallets = o.pallets || [];
  const finish = () => (typeof onDone === "function" ? onDone() : erpInvForm(o));
  const render = () => `${(o.pallets || []).map((p, i) => `
    <div class="inv-pal-row" data-i="${i}">
      <input type="text" class="pal-no" data-i="${i}" value="${escapeAttr(p.no || String(i + 1))}" placeholder="№" style="width:50px" />
      <input type="text" class="pal-desc" data-i="${i}" value="${escapeAttr(p.desc || "")}" placeholder="съдържание (код/наименование)" />
      <input type="number" class="pal-qty" data-i="${i}" value="${escapeAttr(String(p.qty || ""))}" placeholder="бр." style="width:80px" />
      <input type="number" class="pal-w" data-i="${i}" value="${escapeAttr(String(p.weightKg || ""))}" placeholder="кг" style="width:80px" />
      <button type="button" class="btn btn-small btn-danger pal-rm" data-i="${i}">×</button>
    </div>`).join("") || `<p class="report-empty">Няма палети. Добави или „Попълни от редовете".</p>`}`;
  const { wrap, close } = erpDialog(`
    <h3>Палети (за Палет опис / Packing List)</h3>
    <div id="pal-list">${render()}</div>
    <div class="erp-dialog-actions" style="justify-content:flex-start">
      <button class="btn btn-small" id="pal-add">+ Палет</button>
      <button class="btn btn-small" id="pal-fill" title="По един палет на ред; килограмите се смятат от рецептата (може да се коригират ръчно)">↻ Попълни от редовете (+ кг от рецепта)</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="pal-cancel">Затвори</button>
      <button class="btn btn-primary" id="pal-save">Запази</button>
    </div>`);
  const listEl = wrap.querySelector("#pal-list");
  const readBack = () => {
    listEl.querySelectorAll(".inv-pal-row").forEach(row => {
      const i = Number(row.dataset.i); const p = o.pallets[i]; if (!p) return;
      p.no = row.querySelector(".pal-no").value; p.desc = row.querySelector(".pal-desc").value;
      p.qty = erpToNum(row.querySelector(".pal-qty").value); p.weightKg = erpToNum(row.querySelector(".pal-w").value);
    });
  };
  const redraw = () => { listEl.innerHTML = render(); wire(); };
  const wire = () => {
    listEl.querySelectorAll(".pal-rm").forEach(b => b.addEventListener("click", () => { readBack(); o.pallets.splice(Number(b.dataset.i), 1); redraw(); }));
  };
  wire();
  wrap.querySelector("#pal-add").addEventListener("click", () => { readBack(); o.pallets.push({ no: String(o.pallets.length + 1), desc: "", qty: "", weightKg: "" }); redraw(); });
  wrap.querySelector("#pal-fill").addEventListener("click", () => {
    o.pallets = (o.lines || []).map((l, i) => { const kg = erpInvLineKg(l); return { no: String(i + 1), desc: ((l.code ? l.code + " " : "") + (l.name || "")).trim(), qty: erpToNum(l.qty) || "", weightKg: kg > 0 ? kg : "" }; });
    redraw();
  });
  wrap.querySelector("#pal-cancel").addEventListener("click", () => { readBack(); close(); finish(); });
  wrap.querySelector("#pal-save").addEventListener("click", () => { readBack(); close(); finish(); });
}

/* ---------- Печат: общ прозорец ---------- */
function invPrintWindow(titleText, bodyHtml, lang) {
  const css = `*{box-sizing:border-box}body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 22px}
    h1{font-size:20px;color:#0f766e;margin:0 0 2px;letter-spacing:1px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}
    .parties{display:flex;gap:16px;margin-bottom:14px}.party{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px}.party h3{margin:0 0 4px;font-size:12px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #cbd5e1;padding:5px 7px;font-size:11.5px;text-align:left}th{background:#ecfdf5;color:#065f46}
    td.r{text-align:right}td.c{text-align:center}.muted{color:#777}.kv{margin:2px 0}
    .foot{display:flex;justify-content:space-between;margin-top:26px;font-size:11px}.foot div{flex:1;border-top:1px solid #333;padding-top:4px;margin:0 12px;text-align:center}
    .cmr{border:1px solid #333}.cmr td{vertical-align:top;height:auto}.cmr .lbl{font-size:9px;color:#555;display:block}
    @media print{body{margin:8mm}.noprint{display:none}}.noprint{text-align:center;margin:14px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  w.document.write(`<!doctype html><html lang="${lang || "bg"}"><head><meta charset="utf-8"><title>${escapeHtml(titleText)}</title><style>${css}</style></head><body><div class="noprint"><button class="btnp" onclick="window.print()">🖨</button></div>${bodyHtml}</body></html>`);
  w.document.close(); w.focus();
}
function invSellerBlock() {
  const s = ERP_SELLER || {};
  return `<b>${escapeHtml(s.name || "")}</b><br>ЕИК ${escapeHtml(s.eik || "")} · ДДС ${escapeHtml(s.vat || "")}<br>${escapeHtml([s.address, s.city].filter(Boolean).join(", "))}`;
}
function invClientBlock(o) {
  const c = o.client || {};
  return `<b>${escapeHtml(c.name || "")}</b><br>${c.eik ? "ЕИК " + escapeHtml(c.eik) + " · " : ""}${c.vat ? "ДДС " + escapeHtml(c.vat) : ""}<br>${escapeHtml([c.street, c.city, c.country].filter(Boolean).join(", "))}`;
}
function invDocRef(o) { return (o.docNo ? "фактура № " + o.docNo : "чернова") + (o.issueDate ? " / " + o.issueDate : ""); }

/* ---------- Стокова разписка (БГ) ---------- */
function erpInvPrintGoodsNote(o) {
  let totKg = 0;
  const rows = (o.lines || []).map((l, i) => {
    const kg = erpInvLineKg(l); totKg += kg || 0;
    return `<tr><td>${i + 1}</td><td>${escapeHtml(l.code || "")}</td><td>${escapeHtml(l.name || "")}</td><td class="r">${erpNum(l.qty)}</td><td>${escapeHtml(l.unit || "")}</td><td class="r">${kg ? erpNum(kg) : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="c muted">—</td></tr>`;
  const grossKg = (o.transport && erpToNum(o.transport.totalWeightKg) > 0) ? erpToNum(o.transport.totalWeightKg) : totKg;
  const body = `
    <div class="head"><div><h1>СТОКОВА РАЗПИСКА</h1><div>към ${escapeHtml(o.__ref || invDocRef(o))}</div></div><div style="text-align:right">Дата: <b>${escapeHtml(o.issueDate || o.date || "")}</b></div></div>
    <div class="parties"><div class="party"><h3>Получател</h3>${invClientBlock(o)}</div><div class="party"><h3>Предал (Доставчик)</h3>${invSellerBlock()}</div></div>
    <table><thead><tr><th>№</th><th>Код</th><th>Наименование</th><th>Кол.</th><th>МЕ</th><th>Тегло (кг)</th></tr></thead><tbody>${rows}</tbody>
      ${grossKg ? `<tfoot><tr><td colspan="5" class="r"><b>Общо тегло</b></td><td class="r"><b>${erpNum(grossKg)} кг</b></td></tr></tfoot>` : ""}</table>
    ${o.transport && o.transport.totalPackages ? `<div class="kv">Брой пакети/палети: <b>${escapeHtml(o.transport.totalPackages)}</b></div>` : ""}
    <div class="foot"><div>Предал</div><div>Приел</div></div>`;
  invPrintWindow("Стокова разписка", body, "bg");
}

/* ---------- Packing List (EN) ---------- */
function erpInvPrintPacking(o) {
  const pal = (o.pallets && o.pallets.length) ? o.pallets : (o.lines || []).map((l, i) => { const kg = erpInvLineKg(l); return { no: i + 1, desc: ((l.code ? l.code + " " : "") + (l.name || "")).trim(), qty: l.qty, weightKg: kg > 0 ? kg : "" }; });
  const totW = pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  const rows = pal.map((p, i) => `<tr><td>${escapeHtml(String(p.no || i + 1))}</td><td>${escapeHtml(p.desc || "")}</td><td class="r">${erpNum(p.qty)}</td><td class="r">${p.weightKg ? erpNum(p.weightKg) : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="c muted">—</td></tr>`;
  const tr = o.transport || {};
  const body = `
    <div class="head"><div><h1>PACKING LIST</h1><div>ref. ${escapeHtml(o.__ref || invDocRef(o))}</div></div><div style="text-align:right">Date: <b>${escapeHtml(o.issueDate || o.date || "")}</b></div></div>
    <div class="parties"><div class="party"><h3>Consignee</h3>${invClientBlock(o)}</div><div class="party"><h3>Shipper</h3>${invSellerBlock()}</div></div>
    <table><thead><tr><th>Pallet/Pkg</th><th>Contents</th><th>Qty</th><th>Weight (kg)</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" class="r"><b>Total gross weight</b></td><td class="r"><b>${erpNum(totW || tr.totalWeightKg || 0)}</b></td></tr></tfoot></table>
    ${tr.incoterms ? `<div class="kv">Incoterms: <b>${escapeHtml(tr.incoterms)}</b></div>` : ""}
    <div class="foot"><div>Prepared by</div><div>Received by</div></div>`;
  invPrintWindow("Packing List", body, "en");
}

/* ---------- Палет опис (BG+EN) ---------- */
function erpInvPrintPallets(o) {
  const pal = (o.pallets && o.pallets.length) ? o.pallets : (o.lines || []).map((l, i) => { const kg = erpInvLineKg(l); return { no: i + 1, desc: ((l.code ? l.code + " " : "") + (l.name || "")).trim(), qty: l.qty, weightKg: kg > 0 ? kg : "" }; });
  const totQ = pal.reduce((s, p) => s + (erpToNum(p.qty) || 0), 0);
  const totW = pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  const rows = pal.map((p, i) => `<tr><td>${escapeHtml(String(p.no || i + 1))}</td><td>${escapeHtml(p.desc || "")}</td><td class="r">${erpNum(p.qty)}</td><td class="r">${p.weightKg ? erpNum(p.weightKg) : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="c muted">—</td></tr>`;
  const body = `
    <div class="head"><div><h1>ПАЛЕТ ОПИС / PALLET LIST</h1><div>към ${escapeHtml(o.__ref || invDocRef(o))}</div></div><div style="text-align:right">Дата: <b>${escapeHtml(o.issueDate || o.date || "")}</b></div></div>
    <div class="parties"><div class="party"><h3>Получател / Consignee</h3>${invClientBlock(o)}</div><div class="party"><h3>Доставчик / Shipper</h3>${invSellerBlock()}</div></div>
    <table><thead><tr><th>Палет №</th><th>Съдържание / Contents</th><th>Кол. / Qty</th><th>Тегло / Weight (kg)</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td class="r"><b>Общо / Total</b></td><td></td><td class="r"><b>${erpNum(totQ)}</b></td><td class="r"><b>${erpNum(totW)}</b></td></tr></tfoot></table>
    <div class="foot"><div>Съставил / Prepared</div><div>Получил / Received</div></div>`;
  invPrintWindow("Палет опис", body, "bg");
}

/* ---------- ЧМР / CMR (опростен международен формуляр) ---------- */
function erpInvPrintCMR(o) {
  const s = ERP_SELLER || {}; const c = o.client || {}; const tr = o.transport || {};
  const recipeKg = (o.lines || []).reduce((sum, l) => sum + (erpInvLineKg(l) || 0), 0);
  const grossKg = erpToNum(tr.totalWeightKg) > 0 ? erpToNum(tr.totalWeightKg) : recipeKg;
  const goods = (o.lines || []).map(l => `${erpNum(l.qty)} ${escapeHtml(l.unit || "")} · ${escapeHtml((l.code ? l.code + " " : "") + (l.name || ""))}`).join("<br>") || "—";
  const cell = (label, val) => `<td><span class="lbl">${label}</span>${val || ""}</td>`;
  const body = `
    <div class="head"><div><h1>ЧМР · CMR</h1><div class="muted">Международна товарителница / International consignment note</div></div><div style="text-align:right">${escapeHtml(invDocRef(o))}</div></div>
    <table class="cmr">
      <tr>${cell("1 Изпращач / Sender", invSellerBlock())}${cell("2 Получател / Consignee", invClientBlock(o))}</tr>
      <tr>${cell("3 Място на разтоварване / Place of delivery", escapeHtml(tr.unloadPlace || [c.city, c.country].filter(Boolean).join(", ")))}${cell("4 Място и дата на товарене / Place & date of taking over", escapeHtml([tr.loadPlace || s.city, tr.loadDate].filter(Boolean).join(" · ")))}</tr>
      <tr>${cell("5 Приложени документи / Documents attached", escapeHtml(invDocRef(o)) + (tr.incoterms ? " · " + escapeHtml(tr.incoterms) : ""))}</tr>
      <tr>${cell("6-9 Маркировка, брой, вид, стока / Marks, packages, nature of goods", goods)}</tr>
      <tr>${cell("11 Бруто тегло / Gross weight (kg)", grossKg ? erpNum(grossKg) : "")}${cell("Брой пакети / Packages", escapeHtml(tr.totalPackages || ""))}</tr>
      <tr>${cell("16 Превозвач / Carrier", escapeHtml(tr.carrier || ""))}${cell("МПС / Vehicle · Шофьор / Driver", escapeHtml([tr.vehicleReg, tr.driver].filter(Boolean).join(" · ")))}</tr>
      <tr>${cell("22 Изпращач (подпис) / Sender", "")}${cell("23 Превозвач (подпис) / Carrier", "")}</tr>
      <tr>${cell("24 Получена стока / Goods received — подпис, дата", "")}<td></td></tr>
    </table>`;
  invPrintWindow("ЧМР / CMR", body, "bg");
}
