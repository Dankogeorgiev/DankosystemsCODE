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
  const { data, error } = await erpSelectAll("invoices", "*");
  if (!error) (data || []).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  if (error) throw error;
  erpInvoices = (data || []).map(r => ({ id: r.id, docNo: r.doc_no, posted: r.posted, ...(r.data || {}) }));
}
async function erpSaveInvoice(o) {
  const data = { ...o }; delete data.id; delete data.posted; delete data.docNo; delete data.__editUnlocked;
  const row = { doc_no: o.docNo || null, kind: o.kind || "invoice", posted: !!o.posted, data, updated_at: new Date().toISOString() };
  if (o.id) { const { error } = await sb.from("invoices").update(row).eq("id", o.id); if (error) throw error; }
  else { const { data: ins, error } = await sb.from("invoices").insert(row).select("id").single(); if (error) throw error; o.id = ins.id; }
}

/* ---------- Проформа: СОБСТВЕНА номерация ----------
   Проформата НЕ е данъчен документ и не бива да яде фактурни номера.
   Всяка серия си има свой брояч (pfNext) и префикс (pfPrefix), за да се
   различава от фактурите на пръв поглед. */
function invPfPrefix(ser) {
  if (ser && ser.pfPrefix != null) return String(ser.pfPrefix);
  return (ser && ser.lang === "en") ? "PF-" : "ПФ-";
}
function invPfNext(ser) { return Math.max(1, Math.floor(Number(ser && ser.pfNext) || 1)); }
function invPfNo(ser) { return invPfPrefix(ser) + String(invPfNext(ser)).padStart(6, "0"); }
// Номерът, който ще вземе ТОЗИ документ (за полето „Следващ номер").
function invNextNoFor(o) {
  const ser = (erpInvSeries || {})[o && o.seriesKey] || (erpInvSeries || {})["2"] || {};
  return (o && o.kind === "proforma") ? invPfNo(ser) : String(ser.next || "");
}

/* ---------- Серии / номерация ---------- */
async function erpInvLoadSeries() {
  if (erpInvSeries) return erpInvSeries;
  let fixed = false;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "invoice_series").maybeSingle();
    erpInvSeries = (data && data.data && data.data.series) || null;
    fixed = !!(data && data.data && data.data.fix2026);
  } catch (e) { erpInvSeries = null; }
  // ЕДНОКРАТНА корекция (07.2026, по Данко): серия 1 = ИЗНОС (беше сбъркано
  // „Български пазар"), серия 2 = вътрешен пазар, серия 3 = месечни +
  // стартовите номера от GenCloud. Изпълнява се веднъж (маркер fix2026).
  if (!fixed) {
    erpInvSeries = {
      "1": { label: "Износ (външен пазар, English)", lang: "en", next: 1000003036 },
      "2": { label: "Вътрешен пазар (България)", lang: "bg", next: 2000005409 },
      "3": { label: "Месечни (край на месец)", lang: "bg", next: 3000000049 },
    };
    try { await erpInvSaveSeries(); } catch (e) { /* ще се запише при първата редакция */ }
  }
  if (!erpInvSeries) erpInvSeries = {
    "1": { label: "Износ (външен пазар, English)", lang: "en", next: 1000003036 },
    "2": { label: "Вътрешен пазар (България)", lang: "bg", next: 2000005409 },
    "3": { label: "Месечни (край на месец)", lang: "bg", next: 3000000049 },
  };
  return erpInvSeries;
}
async function erpInvSaveSeries() {
  const { error } = await sb.from("app_config").upsert({ id: "invoice_series", data: { series: erpInvSeries, fix2026: true }, updated_at: new Date().toISOString() });
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
// Покупен материал за препродажба: теглото идва от мерната единица на материала.
function erpInvLineKg(l) {
  if (l && l.materialId && typeof ERP !== "undefined" && ERP.matById) {
    const m = ERP.matById[l.materialId];
    const f = m && typeof erpMatKgPerUnit === "function" ? erpMatKgPerUnit(m) : null;
    return f ? Math.round((erpToNum(l.qty) || 0) * f * 1000) / 1000 : 0;
  }
  const w = erpProductWeightKg(l && (l.productId || l.refId));
  return w > 0 ? Math.round((erpToNum(l.qty) || 0) * w * 1000) / 1000 : 0;
}

/* ---------- Придружаващи документи: черпят от „Опаковки" (наш код + клиент) ----------
   Ако има опаковка за реда → теглото е кг/брой × бройка и се смятат кашони/палети;
   иначе се пада към теглото от рецептата (erpInvLineKg). */
function erpDocPackFind(o, l) {
  return (typeof erpPackFind === "function") ? erpPackFind(l && l.code, o && o.client && o.client.name) : null;
}
function erpDocLineKg(o, l) {
  const sp = erpDocPackFind(o, l);
  if (sp && Number(sp.kgPerPiece) > 0) return Math.round((erpToNum(l.qty) || 0) * Number(sp.kgPerPiece) * 1000) / 1000;
  return erpInvLineKg(l);
}
// Пресмята кашони/палети за ред по опаковката (или null, ако няма опаковка).
function erpDocPackCalc(o, l) {
  const sp = erpDocPackFind(o, l); if (!sp) return null;
  const qty = erpToNum(l.qty) || 0;
  const kgP = Number(sp.kgPerPiece) || 0, kgB = Number(sp.kgPerBox) || 0, bpp = Number(sp.boxesPerPallet) || 0;
  const perBox = (kgP > 0 && kgB > 0) ? Math.max(1, Math.round(kgB / kgP)) : 0;
  const boxes = perBox > 0 ? Math.ceil(qty / perBox) : 0;
  const pallets = (boxes > 0 && bpp > 0) ? Math.ceil(boxes / bpp) : 0;
  return { sp, qty, perBox, boxes, pallets, accessories: sp.accessories || "" };
}
// Ред-по-ред данни за палет/опаковъчните документи (описанието включва кашони/палети/аксесоари).
function erpDocAutoRows(o) {
  return (o.lines || []).map((l, i) => {
    const kg = erpDocLineKg(o, l);
    const c = erpDocPackCalc(o, l);
    let desc = ((l.code ? l.code + " " : "") + (l.name || "")).trim();
    if (c) {
      const bits = [];
      if (c.boxes) { const bx = [c.sp.boxType, c.sp.boxSize].filter(Boolean).join(", "); bits.push(c.boxes + " каш." + (bx ? " (" + bx + ")" : "")); }
      if (c.pallets) bits.push(c.pallets + " пал.");
      if (c.accessories) bits.push(c.accessories);
      if (bits.length) desc += " · " + bits.join(" · ");
    }
    return { no: i + 1, desc, qty: l.qty, weightKg: kg > 0 ? kg : "" };
  });
}

/* ---------- Списък ---------- */
/* Фактурирано за избрания месец (без ДДС / ДДС / с ДДС), в EUR.
   Броят се ИЗДАДЕНИТЕ фактури/дебитни минус кредитните (по датата на
   издаване); проформите и сторнираните НЕ влизат. BGN → по фиксинг. */
let erpInvMonth = "";
function erpInvMonthCards() {
  const host = document.getElementById("inv-month-cards"); if (!host) return;
  const m = erpInvMonth || new Date().toISOString().slice(0, 7);
  const RATE = 1.95583;
  let net = 0, vat = 0, n = 0;
  (erpInvoices || []).forEach(o => {
    if (o.kind === "proforma") return;
    const status = o.status || (o.posted ? "издадена" : "чернова");
    if (!o.posted || status === "чернова" || status === "сторнирана") return;
    if (String(o.issueDate || "").slice(0, 7) !== m) return;
    const t = erpInvTotals(o);   // кредитните са с минус
    const k = (o.currency === "BGN") ? 1 / RATE : 1;
    net += t.base * k; vat += t.vat * k; n++;
  });
  const money = v => (Math.round(v * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lbl = m.split("-")[1] + "." + m.split("-")[0];
  host.innerHTML = `
    <div class="pay-card"><div class="pay-card-l">🧾 Фактурирано БЕЗ ДДС · ${lbl}</div><div class="pay-card-v">${money(net)} EUR</div><div class="pay-card-n">${n} документа</div></div>
    <div class="pay-card"><div class="pay-card-l">➕ ДДС · ${lbl}</div><div class="pay-card-v">${money(vat)} EUR</div><div class="pay-card-n">&nbsp;</div></div>
    <div class="pay-card pay-card-total"><div class="pay-card-l">Σ Фактурирано С ДДС · ${lbl}</div><div class="pay-card-v">${money(net + vat)} EUR</div><div class="pay-card-n">&nbsp;</div></div>`;
}

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
        <select id="inv-fstatus"><option value="">Всички</option>${["чернова", "издадена", "платена", "анулирана", "сторнирана"].map(s => `<option ${s === erpInvStatusFilter ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <span class="spacer"></span>
      ${typeof erpMailDiag === "function" ? '<button class="btn btn-small" id="inv-mail-test" title="Тест на имейл настройката (Brevo)">✉ Тест имейл</button>' : ""}
      <button class="btn btn-small" id="inv-report" title="Справка за период: вътрешни, външни и покупни фактури — с експорт">📊 Справка</button>
      <button class="btn btn-small" id="inv-series">⚙ Серии/номера</button>
      <button class="btn btn-small" id="inv-from-sales" title="Една фактура от една или няколко осчетоводени продажби (складът е изписан от тях)">📑 От продажби…</button>
      <button class="btn btn-small btn-primary" id="inv-new-proforma">+ Проформа</button>
      <button class="btn btn-small btn-primary" id="inv-new-invoice">+ Фактура</button>
    </div>
    <div class="erp-toolbar" style="margin:0 0 6px">
      <label class="erp-inline">📅 Месец <input type="month" id="inv-month" value="${erpInvMonth || new Date().toISOString().slice(0, 7)}" /></label>
    </div>
    <div class="pay-cards" id="inv-month-cards"></div>
    <table class="report-table erp-table">
      <thead><tr><th>№</th><th>Тип</th><th>Клиент</th><th>Дата</th><th class="num">Сума</th><th>Вал.</th><th>Статус</th><th></th></tr></thead>
      <tbody>${rows.map(o => {
        const t = erpInvTotals(o); const k = INV_KINDS[o.kind] || {};
        const status = o.status || (o.posted ? "издадена" : "чернова");
        return `<tr class="erp-clickable" data-id="${o.id}">
          <td data-label="№"><b>${escapeHtml(o.docNo || (o.cancelledNo ? "🚫 " + o.cancelledNo : "—"))}</b></td>
          <td data-label="Тип">${escapeHtml(k.label || o.kind)}</td>
          <td data-label="Клиент">${escapeHtml((o.client && o.client.name) || "")}</td>
          <td data-label="Дата">${erpDMY(o.issueDate)}</td>
          <td class="num" data-label="Сума">${erpInvMoney(t.total, erpInvCur(o))}</td>
          <td data-label="Вал.">${escapeHtml(erpInvCur(o))}</td>
          <td data-label="Статус"><span class="erp-co-status s-${escapeAttr(status)}">${escapeHtml(status)}</span></td>
          <td class="erp-row-actions"><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
        </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">Още няма документи. Натисни „+ Фактура".</td></tr>`}
      </tbody>
    </table>
    <p class="hint">Складът се движи от <b>Продажби</b> (не оттук). Фактурата е документът. Етап 2 ще свърже двете за тест.</p>`;

  const qEl = document.getElementById("inv-q");
  if (qEl) qEl.addEventListener("input", uiDebounce(e => {
    erpInvQuery = e.target.value;
    erpRenderInvoices();
    const el = document.getElementById("inv-q");   // пре-рисуването сменя елемента — връщаме курсора
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 220));
  const mEl = document.getElementById("inv-month");
  if (mEl) mEl.addEventListener("change", e => { erpInvMonth = e.target.value; erpInvMonthCards(); });
  erpInvMonthCards();
  document.getElementById("inv-fkind").addEventListener("change", e => { erpInvKindFilter = e.target.value; erpRenderInvoices(); });
  document.getElementById("inv-fstatus").addEventListener("change", e => { erpInvStatusFilter = e.target.value; erpRenderInvoices(); });
  document.getElementById("inv-series").addEventListener("click", erpInvSeriesDialog);
  document.getElementById("inv-report").addEventListener("click", erpInvReport);
  const mt = document.getElementById("inv-mail-test"); if (mt) mt.addEventListener("click", erpMailDiag);
  const imEl = document.getElementById("inv-import");
  if (imEl) imEl.addEventListener("change", e => { erpInvImport(e.target.files[0]); e.target.value = ""; });
  const ciEl = document.getElementById("inv-clear-import");
  if (ciEl) ciEl.addEventListener("click", erpInvClearImport);
  const caEl = document.getElementById("inv-clear-all");
  if (caEl) caEl.addEventListener("click", erpInvClearAll);
  document.getElementById("inv-new-proforma").addEventListener("click", () => erpNewInvoice("proforma"));
  document.getElementById("inv-new-invoice").addEventListener("click", () => erpNewInvoice("invoice"));
  const fsBtn = document.getElementById("inv-from-sales");
  if (fsBtn) fsBtn.addEventListener("click", erpInvFromSalesDialog);
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
    kind, seriesKey: "2",   // по подразбиране: вътрешен пазар (серия 2)
    issueDate: today, taxDate: today, orderRef: "",
    client: { name: "", eik: "", vat: "", city: "", street: "", country: "България", person: "" }, clientId: null,
    currency: "EUR", vatRate: 20, vatBasis: "", paymentMethod: "по банка", termDays: 0, dueDate: "", note: "",
    refInvoice: null, refReason: "", lines: [], status: "чернова", posted: false,
    compiledBy: "",   // изготвилият се попълва във формата (поле „Изготвил фактурата")
  });
}

/* ---------- Фактура от продажба(и) ----------
   Складът НЕ се пипа тук — изписан е при осчетоводяването на Продажбата.
   Фактурата носи документа и парите. При ИЗДАВАНЕ продажбите се маркират
   с номера ѝ (не могат да се фактурират втори път), а стоковите им
   вземания се заменят от фактурното (erpRecvSyncFromInvoice). */
async function erpInvFromSale(sale, kind) {
  if (!sale) return;
  // Проформата може и ПРЕДИ осчетоводяване — тя не е данъчен документ.
  if (!sale.posted && kind !== "proforma") { alert("Първо осчетоводи продажбата (складът се изписва от нея), после пусни фактурата.\n(Проформа може да създадеш и преди това — с бутона Създай проформа.)"); return; }
  if (sale.imported) { alert("Импортирана продажба (регистър от GenCloud) — фактурата ѝ е издадена в стария процес."); return; }
  if (sale.invoiceNo) { alert("Тази продажба вече е фактурирана с № " + sale.invoiceNo + "."); return; }
  await erpInvOpenFromSales([sale], kind);
}

// Строи чернова на фактура от 1+ продажби и я отваря в таб Фактуриране.
async function erpInvOpenFromSales(salesArr, kindOverride) {
  const s0 = salesArr[0];
  let cl = { name: s0.clientName || "", eik: "", vat: "", city: "", street: "", country: "България", person: "" };
  try {
    const clients = await erpLoadSaleClients();
    const hit = clients.find(c => (s0.clientId && c.id === s0.clientId)
      || (c.name || "").trim().toLowerCase() === (s0.clientName || "").trim().toLowerCase());
    if (hit) cl = { name: hit.name || cl.name, eik: hit.eik || "", vat: hit.vat || "", city: hit.city || "", street: hit.street || "", country: hit.country || "България", person: hit.mol || hit.person || "" };
  } catch (e) {}
  const today = new Date().toISOString().slice(0, 10);
  const isExport = Number(s0.vatRate) === 0 || (cl.country && !/бълг|bulgaria|^bg$/i.test(String(cl.country).trim()));
  // Order No/Date: номерът на ПОРЪЧКАТА НА КЛИЕНТА (от заявката), не на
  // продажбата. Взима се от заявките, от които идват продажбите.
  // Всяка продажба носи СВОЯТА поръчка — редовете ѝ получават нея, а не
  // всички поръчки на фактурата (искане на Кристина: детайлът върви със
  // своята поръчка). Полето на документа остава сборът за заглавието.
  const orderRefs = [];
  const refBySale = {};
  for (const s of salesArr) {
    if (!s.fromOrderId) continue;
    try {
      const { data } = await sb.from("customer_orders").select("id,data").eq("id", s.fromOrderId).maybeSingle();
      const d = (data && data.data) || {};
      const no = d.clientNo || d.ourNo;
      if (no) { const ref = `${no}${d.date ? " " + d.date : ""}`; orderRefs.push(ref); refBySale[String(s.id)] = ref; }
    } catch (e) {}
  }
  const lines = [];
  salesArr.forEach(s => (s.lines || []).forEach(l => lines.push({
    code: l.code || "", clientCode: l.clientCode || "", name: l.name || "",
    qty: l.qty, unit: l.unit || "бр.", unitPrice: l.unitPrice,
    orderRef: l.orderRef || refBySale[String(s.id)] || "",
  })));
  const o = {
    kind: kindOverride || "invoice", seriesKey: isExport ? "1" : "2",
    issueDate: today, taxDate: today,
    orderRef: [...new Set(orderRefs)].join(", ") || ("Продажба № " + salesArr.map(s => s.saleNo || "—").join(", ")),
    client: cl, clientId: s0.clientId || null,
    currency: s0.currency || "EUR",
    vatRate: (s0.vatRate != null && s0.vatRate !== "") ? Number(s0.vatRate) : (isExport ? 0 : 20),
    vatBasis: (isExport && typeof INV_VAT_EXEMPT_EU !== "undefined") ? INV_VAT_EXEMPT_EU : "",
    paymentMethod: isExport ? "Bank transfer" : "по банка", termDays: 0, dueDate: "", note: "",
    refInvoice: null, refReason: "", lines, status: "чернова", posted: false,
    compiledBy: "",
    fromSaleIds: salesArr.map(s => s.id).filter(Boolean),
    fromSaleNos: salesArr.map(s => s.saleNo || "—"),
    __applyProfile: s0.clientName || "",
  };
  if (typeof erpSetTab === "function") erpSetTab("invoices");
  erpInvForm(o);
}

// При ИЗДАВАНЕ: маркира продажбите с номера на фактурата (двупосочна връзка).
async function erpInvMarkSalesInvoiced(o) {
  for (const sid of (o.fromSaleIds || [])) {
    try {
      const { data } = await sb.from("sales").select("id,data,posted").eq("id", sid).maybeSingle();
      if (!data) continue;
      const d = data.data || {};
      d.invoiceNo = o.docNo; d.invoiceId = o.id;
      await sb.from("sales").update({ data: d, posted: !!data.posted, updated_at: new Date().toISOString() }).eq("id", sid);
      const local = (typeof erpSales !== "undefined" && erpSales || []).find(x => x.id === sid);
      if (local) { local.invoiceNo = o.docNo; local.invoiceId = o.id; }
    } catch (e) { console.warn("маркиране на продажба", sid, e); }
  }
}

// „От продажби…": една фактура от НЯКОЛКО осчетоводени продажби на един клиент.
async function erpInvFromSalesDialog() {
  try { if (typeof erpLoadSales === "function" && (typeof erpSales === "undefined" || !erpSales)) await erpLoadSales(); } catch (e) {}
  const cand = ((typeof erpSales !== "undefined" && erpSales) || [])
    .filter(s => s.posted && !s.imported && !s.invoiceNo);
  if (!cand.length) { alert("Няма осчетоводени продажби без фактура.\n(Фактура се пуска само по осчетоводена продажба — складът върви с продажбата.)"); return; }
  const clients = [...new Set(cand.map(s => (s.clientName || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const listFor = cn => cand.filter(s => (s.clientName || "").trim() === cn)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const rowsHtml = cn => listFor(cn).map(s => {
    const t = (typeof erpSaleTotals === "function") ? erpSaleTotals(s) : { total: 0 };
    return `<label class="inv-fs-row"><input type="checkbox" class="inv-fs-chk" data-id="${escapeAttr(String(s.id))}" checked />
      <b>№ ${escapeHtml(s.saleNo || "—")}</b> · ${escapeHtml(s.date || "")} · ${erpNum(Math.round(t.total * 100) / 100)} ${escapeHtml(erpSaleCur(s))}
      <span class="erp-muted">(${(s.lines || []).length} реда)</span></label>`;
  }).join("");
  const { wrap, close } = erpDialog(`
    <h3>📑 Една фактура от няколко продажби</h3>
    <p class="hint">Показват се само осчетоводени продажби БЕЗ фактура. Редовете на избраните се обединяват в една фактура; продажбите се маркират с номера ѝ при издаване.</p>
    <label>Клиент <select id="inv-fs-client">${clients.map(c => `<option>${escapeHtml(c)}</option>`).join("")}</select></label>
    <div id="inv-fs-list" style="max-height:44vh;overflow:auto;margin:8px 0">${rowsHtml(clients[0])}</div>
    <div class="erp-dialog-actions">
      <button class="btn" id="inv-fs-cancel">Отказ</button>
      <button class="btn btn-primary" id="inv-fs-go">📄 Създай фактура от избраните</button>
    </div>`);
  wrap.querySelector("#inv-fs-cancel").addEventListener("click", close);
  const sel = wrap.querySelector("#inv-fs-client");
  sel.addEventListener("change", () => { wrap.querySelector("#inv-fs-list").innerHTML = rowsHtml(sel.value); });
  wrap.querySelector("#inv-fs-go").addEventListener("click", async () => {
    const ids = [...wrap.querySelectorAll(".inv-fs-chk:checked")].map(c => c.dataset.id);
    const chosen = listFor(sel.value).filter(s => ids.includes(String(s.id)));
    if (!chosen.length) { alert("Избери поне една продажба."); return; }
    close();
    await erpInvOpenFromSales(chosen);
  });
}

/* ---------- Настройка на серии ---------- */
async function erpInvSeriesDialog() {
  await erpInvLoadSeries();
  const s = erpInvSeries;
  const { wrap, close } = erpDialog(`
    <h3>⚙ Серии и номера</h3>
    <p class="hint" style="margin:0 0 8px">Задай „следващ номер" за всяка серия. При издаване системата взима номера и увеличава с 1. <b>Внимание:</b> ако издавате фактури и от друг софтуер — номерата ще се бият. Тук трябва да е официалният издател.</p>
    <p class="hint" style="margin:0 0 8px">🧾 <b>Проформите имат отделен брояч</b> — те не са данъчен документ и не изяждат фактурен номер. Смени префикса/номера, ако искаш друг вид номерация.</p>
    ${Object.entries(s).map(([k, x]) => `
      <div class="inv-series-row">
        <b>Серия ${escapeHtml(k)}</b>
        <label>Име <input type="text" id="invs-label-${k}" value="${escapeAttr(x.label || "")}" /></label>
        <label>Език <select id="invs-lang-${k}"><option value="bg" ${x.lang === "bg" ? "selected" : ""}>BG</option><option value="en" ${x.lang === "en" ? "selected" : ""}>EN</option></select></label>
        <label>Следващ № <input type="number" id="invs-next-${k}" value="${escapeAttr(String(x.next || 0))}" /></label>
        <label title="Проформата не е данъчен документ — има собствен брояч, за да не яде фактурни номера">Проформа: префикс
          <input type="text" id="invs-pfx-${k}" style="width:70px" value="${escapeAttr(invPfPrefix(x))}" /></label>
        <label>Проформа: следващ № <input type="number" id="invs-pfnext-${k}" value="${escapeAttr(String(invPfNext(x)))}" /></label>
        <div class="erp-muted" style="flex:1 0 100%;font-size:12px">Следваща проформа от тази серия: <b>${escapeHtml(invPfNo(x))}</b></div>
        ${(x.freed || []).length ? `<div class="erp-muted" style="flex:1 0 100%">♻ Освободени номера (от анулирани): <b>${(x.freed || []).map(escapeHtml).join(", ")}</b> — предлагат се при следващото издаване. <button class="btn btn-small" data-freeclr="${escapeAttr(k)}" title="Изчиства списъка — номерата няма да се предлагат повече">Изчисти</button></div>` : ""}
      </div>`).join("")}
    <div class="erp-dialog-actions"><button class="btn" id="invs-cancel">Отказ</button><button class="btn btn-primary" id="invs-save">Запази</button></div>`);
  wrap.querySelector("#invs-cancel").addEventListener("click", close);
  wrap.querySelectorAll("[data-freeclr]").forEach(b => b.addEventListener("click", async () => {
    const k = b.dataset.freeclr;
    if (!confirm(`Да изчистя ли освободените номера на серия ${k}? Няма да се предлагат повече.`)) return;
    delete s[k].freed; await erpInvSaveSeries(); close(); erpInvSeriesDialog();
  }));
  wrap.querySelector("#invs-save").addEventListener("click", async () => {
    Object.keys(s).forEach(k => {
      s[k].label = wrap.querySelector("#invs-label-" + k).value.trim() || s[k].label;
      s[k].lang = wrap.querySelector("#invs-lang-" + k).value;
      s[k].next = Math.floor(Number(wrap.querySelector("#invs-next-" + k).value) || s[k].next);
      s[k].pfPrefix = wrap.querySelector("#invs-pfx-" + k).value;
      s[k].pfNext = Math.max(1, Math.floor(Number(wrap.querySelector("#invs-pfnext-" + k).value) || 1));
    });
    await erpInvSaveSeries(); close(); erpRenderInvoices();
  });
}

/* ---------- Самообучение: профил на клиента от издадените фактури ----------
   Чете историята (последната издадена фактура на клиента) и вади навиците му:
   срок на разсрочено плащане, начин на плащане, валута, ДДС, серия. Всяка нова
   фактура автоматично „дообучава" — тя става последната в историята. */
/* Серията на ЕДНА фактура. Ако записът няма seriesKey (стар/импортиран), се
   разпознава по първата цифра на номера — 1…=износ, 2…=вътрешен, 3…=месечни. */
function invSeriesOfInvoice(o) {
  if (o && o.seriesKey && (erpInvSeries || {})[o.seriesKey]) return String(o.seriesKey);
  const first = String((o && (o.docNo || o.cancelledNo)) || "").trim().charAt(0);
  return ((erpInvSeries || {})[first]) ? first : "2";
}
function invFindByNo(no) {
  const n = String(no || "").trim();
  if (!n) return null;
  return (erpInvoices || []).find(x => String(x.docNo || "").trim() === n) || null;
}

function erpInvClientProfile(name) {
  const nm = String(name || "").trim().toLowerCase();
  if (!nm) return null;
  const mine = (erpInvoices || []).filter(x => x.posted && x.client && String(x.client.name || "").trim().toLowerCase() === nm)
    .sort((a, b) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")));
  if (!mine.length) return null;
  const last = mine[0];
  return {
    count: mine.length,
    termDays: Number(last.termDays) || 0,
    paymentMethod: last.paymentMethod || "",
    currency: last.currency || "EUR",
    vatRate: last.vatRate != null ? last.vatRate : 20,
    seriesKey: last.seriesKey || "2",
    vatBasis: last.vatBasis || "",
  };
}
// Прилага навиците на клиента върху ЧЕРНОВА (не пипа издадени).
function erpInvApplyClientProfile(o, prof) {
  if (!prof || o.posted) return false;
  o.termDays = prof.termDays;
  if (Number(prof.termDays) > 0 && o.issueDate) {
    const d = new Date(o.issueDate + "T00:00:00");
    if (!isNaN(d.getTime())) { d.setDate(d.getDate() + Number(prof.termDays)); o.dueDate = d.toISOString().slice(0, 10); }
  } else o.dueDate = "";
  if (prof.paymentMethod) o.paymentMethod = prof.paymentMethod;
  // Известието следва ОРИГИНАЛНАТА фактура, а не навиците на клиента —
  // иначе кредитно към износна фактура вземаше номер от вътрешната серия.
  const isNoteDoc = (o.kind === "credit" || o.kind === "debit");
  if (isNoteDoc) return true;
  o.currency = prof.currency; o.vatRate = prof.vatRate; o.seriesKey = prof.seriesKey;
  if (Number(prof.vatRate) === 0 && prof.vatBasis && !o.vatBasis) o.vatBasis = prof.vatBasis;
  return true;
}

/* ---------- Форма ---------- */
async function erpInvForm(o) {
  const v = erpView();
  await erpInvLoadSeries();
  if (!erpInvoices) { try { await erpLoadInvoices(); } catch (e) {} }   // за профила на клиента (самообучение)
  // Еднократно прилагане на клиентския профил (напр. фактура от продажба без свой срок).
  if (o.__applyProfile && !o.posted) { erpInvApplyClientProfile(o, erpInvClientProfile(o.__applyProfile)); delete o.__applyProfile; }
  const clients = await erpLoadSaleClients();
  const locked = !!o.posted && !o.__editUnlocked;
  const k = INV_KINDS[o.kind] || {};
  const isNote = o.kind === "credit" || o.kind === "debit";
  const cur = erpInvCur(o);
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="inv-back">← Назад</button>
      <span class="erp-count">${escapeHtml(k.label || o.kind)}${o.docNo ? " № " + escapeHtml(o.docNo) : " (чернова)"}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="inv-print">🖨 Печат</button>
      <button class="btn btn-small" id="inv-fix" title="Отваря документа за ръчна поправка ПРЕДИ печат (номерът и статусът се запазват)">✎ Ръчна корекция</button>
      ${o.posted && o.status !== "анулирана" ? '<button class="btn btn-small btn-danger" id="inv-cancel" title="Анулира документа: вземането пада, продажбите се отвързват, а НОМЕРЪТ се освобождава и може да се даде на друг клиент">🚫 Анулирай</button>' : ""}
      ${o.status === "анулирана" ? `<span class="erp-count erp-warn">🚫 АНУЛИРАНА${o.cancelledNo ? " (беше № " + escapeHtml(o.cancelledNo) + ")" : ""}</span>` : ""}
      ${typeof erpMailInvoice === "function" ? '<button class="btn btn-small" id="inv-mail" title="Изпраща фактурата по имейл на клиента (през Brevo)">✉ Изпрати на клиента</button>' : ""}
      ${o.posted && o.kind === "invoice" ? '<button class="btn btn-small" id="inv-make-credit" title="Ново кредитно известие по тази фактура (връщане/намаление)">➖ Кредитно</button><button class="btn btn-small" id="inv-make-debit" title="Ново дебитно известие по тази фактура (увеличение/допращане)">➕ Дебитно</button>' : ""}
      ${locked ? '<span class="erp-count">✓ Издадена — само преглед</span><button class="btn btn-small" id="inv-unlock" title="Отключва издадената фактура за ръчна поправка (номерът се запазва)">✎ Ръчна редакция</button>'
        : (o.posted
          ? '<span class="erp-count erp-warn">⚠ Редакция на ИЗДАДЕНА — номерът се запазва</span><button class="btn btn-small btn-primary" id="inv-save">💾 Запази промените</button>'
          : '<button class="btn btn-small" id="inv-save">💾 Запази</button><button class="btn btn-small btn-primary" id="inv-issue">📤 Издай (вземи номер)</button>')}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Серия
          <select id="inv-series" ${locked ? "disabled" : ""}>${Object.entries(erpInvSeries).map(([sk, x]) => `<option value="${sk}" ${sk === o.seriesKey ? "selected" : ""}>${escapeHtml(sk + ". " + x.label)}</option>`).join("")}</select></label>
        <label>${o.posted ? "№ на документа" : "№ (който ще получи)"}
          <input type="text" id="inv-nextno" class="inv-nextno" readonly value="${escapeAttr(o.posted ? (o.docNo || "") : invNextNoFor(o))}" />
          ${!o.posted && o.kind === "proforma" ? '<span class="erp-muted" style="font-size:11px">Проформата има собствена номерация — не взима фактурен номер.</span>' : ""}</label>
        <label>Тип
          <select id="inv-kind" ${locked ? "disabled" : ""}>${Object.entries(INV_KINDS).map(([kk, x]) => `<option value="${kk}" ${kk === o.kind ? "selected" : ""}>${x.label}</option>`).join("")}</select></label>
        <label>Дата на издаване <input type="date" id="inv-date" value="${escapeAttr(o.issueDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Дата на данъчно събитие <input type="date" id="inv-taxdate" value="${escapeAttr(o.taxDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>№/дата на ПОРЪЧКАТА на клиента <input type="text" id="inv-orderref" value="${escapeAttr(o.orderRef || "")}" ${locked ? "disabled" : ""} placeholder="напр. 10.436 17-04-2026" /></label>
        <label>Начин на плащане <input type="text" id="inv-pay" value="${escapeAttr(o.paymentMethod || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Условия на плащане (износ)
          <select id="inv-paycond" ${locked ? "disabled" : ""}>
            <option value="">—</option>
            ${(typeof INV_PAY_CONDITIONS !== "undefined" ? INV_PAY_CONDITIONS : []).map(pc => `<option value="${escapeAttr(pc.key)}" ${o.payCond === pc.key ? "selected" : ""}>${escapeHtml(pc.key)}</option>`).join("")}
          </select></label>
        <label>Тарифен код (износ) <input type="text" id="inv-tariff" value="${escapeAttr(o.tariffCode || "")}" ${locked ? "disabled" : ""} placeholder="напр. 83024200" /></label>
        <label>Разсрочено — срок (дни) <input type="number" id="inv-term" min="0" value="${escapeAttr(String(o.termDays || 0))}" ${locked ? "disabled" : ""} placeholder="0 = веднага" /></label>
        <label>Падеж (дата за плащане) <input type="date" id="inv-due" value="${escapeAttr(o.dueDate || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Валута <select id="inv-cur" ${locked ? "disabled" : ""}>${["EUR", "BGN"].map(c => `<option ${c === cur ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label>ДДС ставка % <select id="inv-vat" ${locked ? "disabled" : ""}>${["20", "9", "0"].map(r => `<option value="${r}" ${Number(r) === Number(o.vatRate) ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
        <label>Изготвил фактурата <input type="text" id="inv-compiled" list="inv-compiled-list" value="${escapeAttr(o.compiledBy || "")}" ${locked ? "disabled" : ""} placeholder="име на изготвилия" />
          <datalist id="inv-compiled-list"><option value="Кристина Дончева"></option><option value="Данко Георгиев"></option><option value="Евгени Георгиев"></option><option value="Таня Илиева"></option></datalist></label>
      </div>
      ${isNote ? `<div class="inv-note-ref">
        <b>Връзка към фактура (чл. 115 — задължително):</b>
        ${locked ? "" : `<label>Избери фактурата <select id="inv-refpick" title="Избери оригиналната фактура — известието наследява нейната СЕРИЯ (износ/вътрешен), клиент, валута и ДДС">
          <option value="">— избери издадена фактура —</option>
          ${(erpInvoices || []).filter(x => x.posted && x.kind === "invoice" && x.docNo)
            .sort((a, b) => String(b.issueDate || "").localeCompare(String(a.issueDate || "")))
            .slice(0, 400)
            .map(x => `<option value="${escapeAttr(String(x.id))}" ${((o.refInvoice || {}).docNo || "") === String(x.docNo) ? "selected" : ""}>№ ${escapeHtml(String(x.docNo))} · ${escapeHtml((x.client && x.client.name) || "")} · ${escapeHtml(erpDMY(x.issueDate) || "")} · серия ${escapeHtml(invSeriesOfInvoice(x))}</option>`).join("")}
        </select></label>`}
        <label>Фактура № <input type="text" id="inv-refno" value="${escapeAttr((o.refInvoice && o.refInvoice.docNo) || "")}" ${locked ? "disabled" : ""} placeholder="номер на оригиналната фактура" /></label>
        <label>Дата <input type="date" id="inv-refdate" value="${escapeAttr((o.refInvoice && o.refInvoice.date) || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Основание <input type="text" id="inv-refreason" value="${escapeAttr(o.refReason || "")}" ${locked ? "disabled" : ""} placeholder="напр. връщане на стока / корекция" /></label>
        <label class="erp-inline"><input type="checkbox" id="inv-retstock" ${o.returnStock ? "checked" : ""} ${locked ? "disabled" : ""} />
          ${o.kind === "credit" ? "🔄 При издаване ВЪРНИ артикулите в Склад детайли (клиентът ги връща)" : "🔄 При издаване ИЗПИШИ артикулите от Склад детайли (пращаме стока)"}</label>
        ${(function () {
          const src0 = invFindByNo((o.refInvoice || {}).docNo);
          const sk = src0 ? invSeriesOfInvoice(src0) : o.seriesKey;
          const lb = (erpInvSeries[sk] || {}).label || "";
          const bad = src0 && sk !== o.seriesKey;
          return `<div class="hint" style="margin:6px 0 0${bad ? ";color:#b45309;font-weight:700" : ""}">${bad ? "⚠ " : ""}Известието взима номер от серия <b>${escapeHtml(sk)}. ${escapeHtml(lb)}</b>${bad ? ` — оригиналната фактура е от нея, а сега е избрана серия ${escapeHtml(o.seriesKey)}. Ще ти предложа да я сменя при издаване.` : " — същата като на оригиналната фактура."}</div>`;
        })()}
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
        <label>МОЛ <input type="text" id="inv-cmol" value="${escapeAttr(o.client.person || "")}" ${locked ? "disabled" : ""} /></label>
      </div>

      <h4 class="erp-group-head">Получател на стоката (CONSIGNEE — за износ, ако е различен от купувача)</h4>
      <div class="erp-co-grid">
        ${(() => {
          // Запазените получатели на ТОЗИ клиент от предишни фактури — падащ списък.
          const seen = new Set(); const outc = [];
          (erpInvoices || []).slice().reverse().forEach(x => {
            const cs = x.consignee;
            if (!cs || !(cs.name || cs.street || cs.city)) return;
            if (((x.client && x.client.name) || "") !== (o.client.name || "")) return;
            const k = [cs.name, cs.street, cs.city, cs.country].join("¦").toLowerCase();
            if (seen.has(k)) return; seen.add(k);
            outc.push(cs);
          });
          window.__invConsSaved = outc.slice(0, 25);
          return window.__invConsSaved.length ? `<label>Запазени адреси <select id="inv-gpick" ${locked ? "disabled" : ""}><option value="">— избери запазен получател —</option>${window.__invConsSaved.map((cx, i) => `<option value="${i}">${escapeHtml([cx.name, cx.city, cx.street].filter(Boolean).join(" · "))}</option>`).join("")}</select></label>` : "";
        })()}
        <label>Име <input type="text" id="inv-gname" value="${escapeAttr((o.consignee || {}).name || "")}" ${locked ? "disabled" : ""} placeholder="празно = купувача" /></label>
        <label>Адрес <input type="text" id="inv-gstreet" list="inv-cons-addr" value="${escapeAttr((o.consignee || {}).street || "")}" ${locked ? "disabled" : ""} />
          <datalist id="inv-cons-addr">${[...new Set((erpInvoices || []).filter(x => x.consignee && x.consignee.street && x.client && (x.client.name || "") === (o.client.name || "")).map(x => x.consignee.street))].map(a => `<option value="${escapeAttr(a)}"></option>`).join("")}</datalist></label>
        <label>Град <input type="text" id="inv-gcity" value="${escapeAttr((o.consignee || {}).city || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Държава <input type="text" id="inv-gcountry" value="${escapeAttr((o.consignee || {}).country || "")}" ${locked ? "disabled" : ""} /></label>
        <label>ДДС № <input type="text" id="inv-gvat" value="${escapeAttr((o.consignee || {}).vat || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Лице за контакт <input type="text" id="inv-gperson" value="${escapeAttr((o.consignee || {}).person || "")}" ${locked ? "disabled" : ""} /></label>
      </div>
      ${locked ? "" : '<div class="erp-co-actions"><button class="btn btn-small" id="inv-cons-copy" title="Копира данните на купувача в получателя">⇒ като купувача</button></div>'}

      <h4 class="erp-group-head">Редове</h4>
      <table class="report-table erp-table inv-lines-tbl" id="inv-lines">
        <thead><tr><th>Код</th><th>Наименование</th><th title="Поръчката на клиента за ТОЗИ ред — тя влиза в колоната Поръчка на печата">Поръчка</th><th class="num">Кол.</th><th>МЕ</th><th class="num">Ед. цена</th><th class="num">Стойност</th><th></th></tr></thead>
        <tbody>${erpInvLinesHtml(o, locked)}</tbody>
      </table>
      ${locked ? "" : '<div class="erp-co-actions"><button class="btn btn-small" id="inv-add-prod">+ Продукт</button><button class="btn btn-small" id="inv-add-free">+ Свободен ред</button></div>'}
      <div class="erp-sale-totals" id="inv-totals"></div>
      <label class="erp-co-note">Забележка <textarea id="inv-note" rows="2" ${locked ? "disabled" : ""}>${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">Придружаващи документи</h4>
      <div class="erp-co-actions doc-src doc-src-pack">
        <span class="doc-src-lbl">📦 От ОПАКОВКИ (заявката по Order No):</span>
        <button class="btn btn-small" id="inv-doc-goods">📦 Стокова разписка</button>
        <button class="btn btn-small" id="inv-doc-packing">📦 Packing List</button>
        <button class="btn btn-small" id="inv-doc-pallets">🧱 Палет опис</button>
      </div>
      <div class="erp-co-actions doc-src doc-src-inv">
        <span class="doc-src-lbl">🧾 От ФАКТУРАТА:</span>
        <button class="btn btn-small" id="inv-doc-cmr">🚚 ЧМР (CMR)</button>
        <button class="btn btn-small" id="inv-doc-desc" title="Description of goods — митница, камион, маршрут и опис на детайлите">📄 Description of goods</button>
        <button class="btn btn-small" id="inv-doc-decl-bg" title="Декларация за произход (български) — номерът на фактурата и камионът се попълват сами">📜 Декларация произход</button>
        <button class="btn btn-small" id="inv-doc-decl-en" title="Declaration by the exporter (English)">📜 Declaration (EN)</button>
      </div>
      <div class="erp-co-actions">
        ${typeof erpMailTransportInquiry === "function" ? '<button class="btn btn-small" id="inv-mail-transport" title="Запитване за транспорт до превозвач (маршрут/палети/тегло се попълват сами)">🚚 Запитване за транспорт</button>' : ""}
        <button class="btn btn-small" id="inv-edit-transport" ${locked ? "disabled" : ""}>✎ Транспорт</button>
        <button class="btn btn-small" id="inv-edit-pallets" ${locked ? "disabled" : ""}>✎ Палети (${(o.pallets || []).length})</button>
      </div>
      <p class="hint">Зелените се пълнят от <b>Опаковки</b> — Системата намира заявката по „Поръчка на клиента (Order No)" и взема кашоните, теглата и палетния план оттам. Сините се пълнят от <b>тази фактура</b> (+ „✎ Транспорт" за камиона и маршрута).</p>

      ${((o.fromSaleNos || []).length || (o.refInvoice && o.refInvoice.docNo) || o.orderRef) ? `
      <h4 class="erp-group-head">🔗 Свързани документи (история)</h4>
      <div class="erp-co-actions">
        ${(o.fromSaleNos || []).map(n => `<button class="btn btn-small" data-goto-sale="${escapeAttr(String(n))}" title="Отвори Продажби с търсене по този номер">🧾 Продажба № ${escapeHtml(String(n))}</button>`).join("")}
        ${o.refInvoice && o.refInvoice.docNo ? `<span class="erp-count">📄 към фактура № ${escapeHtml(o.refInvoice.docNo)} / ${escapeHtml(o.refInvoice.date || "")}</span>` : ""}
        ${o.orderRef ? `<span class="erp-count">📦 поръчка на клиента: ${escapeHtml(o.orderRef)}</span>` : ""}
      </div>` : ""}
    </div>`;

  const bindClient = () => {
    const m = clients.find(c => (c.name || "") === document.getElementById("inv-cname").value);
    if (m) {
      o.client.name = m.name; o.client.eik = m.eik || o.client.eik; o.client.vat = m.vat || o.client.vat; o.client.city = m.city || o.client.city; o.client.street = m.street || o.client.street; o.client.country = m.country || o.client.country; o.client.person = m.mol || m.person || o.client.person; o.clientId = m.id;
      // Самообучение: навиците на клиента от предишните му фактури (срок, плащане, валута, серия).
      erpInvApplyClientProfile(o, erpInvClientProfile(m.name));
      erpInvForm(o);
    }
  };
  document.getElementById("inv-back").addEventListener("click", erpRenderInvoices);
  const g = (id, cb) => { const el = document.getElementById(id); if (el) el.addEventListener(locked ? "change" : "input", cb); };
  g("inv-series", e => {
    o.seriesKey = e.target.value;
    // Обновява квадратчето с номера, който документът ще получи от тази серия.
    const nn = document.getElementById("inv-nextno");
    if (nn && !o.posted) nn.value = invNextNoFor(o);
  });
  g("inv-kind", e => { o.kind = e.target.value; erpInvForm(o); });
  g("inv-date", e => o.issueDate = e.target.value);
  g("inv-taxdate", e => o.taxDate = e.target.value);
  g("inv-orderref", e => o.orderRef = e.target.value);
  g("inv-pay", e => o.paymentMethod = e.target.value);
  // Условия на плащане (износ): изборът смята срока и падежа автоматично
  // (30 days EOM = 30 дни, после до края на месеца; advanced = веднага).
  const pcSel = document.getElementById("inv-paycond");
  if (pcSel && !locked) pcSel.addEventListener("change", () => {
    o.payCond = pcSel.value;
    const pc = (typeof INV_PAY_CONDITIONS !== "undefined" ? INV_PAY_CONDITIONS : []).find(x => x.key === o.payCond);
    if (pc && o.issueDate) {
      o.termDays = pc.days;
      const d = new Date(o.issueDate + "T00:00:00");
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + pc.days);
        if (pc.eom) d.setMonth(d.getMonth() + 1, 0);   // края на месеца след срока
        o.dueDate = d.toISOString().slice(0, 10);
      }
      const te = document.getElementById("inv-term"); if (te) te.value = String(o.termDays);
      const de = document.getElementById("inv-due"); if (de) de.value = o.dueDate;
    }
  });
  g("inv-tariff", e => o.tariffCode = e.target.value);
  const gc = (id, key) => g(id, e => { o.consignee = o.consignee || {}; o.consignee[key] = e.target.value; });
  gc("inv-gname", "name"); gc("inv-gstreet", "street"); gc("inv-gcity", "city");
  gc("inv-gcountry", "country"); gc("inv-gvat", "vat"); gc("inv-gperson", "person");
  const ccp = document.getElementById("inv-cons-copy");
  if (ccp) ccp.addEventListener("click", () => {
    o.consignee = { name: o.client.name || "", street: o.client.street || "", city: o.client.city || "", country: o.client.country || "", vat: o.client.vat || "", person: (o.consignee || {}).person || "" };
    erpInvForm(o);
  });
  g("inv-term", e => { o.termDays = Number(e.target.value) || 0; if (Number(o.termDays) > 0 && !o.dueDate && o.issueDate) { const el = document.getElementById("inv-due"); const d = new Date(o.issueDate + "T00:00:00"); if (!isNaN(d.getTime())) { d.setDate(d.getDate() + o.termDays); if (el) el.value = d.toISOString().slice(0, 10); o.dueDate = el ? el.value : o.dueDate; } } });
  g("inv-due", e => o.dueDate = e.target.value);
  g("inv-cur", e => { o.currency = e.target.value; erpInvTotalsBox(o); });
  g("inv-vat", e => { o.vatRate = Number(e.target.value); erpInvForm(o); });
  g("inv-compiled", e => o.compiledBy = e.target.value);
  g("inv-vatbasis", e => o.vatBasis = e.target.value);
  const rst = document.getElementById("inv-retstock");
  if (rst && !locked) rst.addEventListener("change", () => { o.returnStock = rst.checked; });
  const mkc = document.getElementById("inv-make-credit"); if (mkc) mkc.addEventListener("click", () => erpInvNoteFrom(o, "credit"));
  const mkd = document.getElementById("inv-make-debit"); if (mkd) mkd.addEventListener("click", () => erpInvNoteFrom(o, "debit"));
  v.querySelectorAll("[data-goto-sale]").forEach(b => b.addEventListener("click", () => {
    try { erpSaQuery = b.dataset.gotoSale || ""; } catch (e) {}
    if (typeof erpSetTab === "function") erpSetTab("sales", true);
  }));
  g("inv-refno", e => { o.refInvoice = o.refInvoice || {}; o.refInvoice.docNo = e.target.value; });
  // Ръчно въведен номер: щом го разпознаем, известието поема СЕРИЯТА на оригинала.
  const rno = document.getElementById("inv-refno");
  if (rno && !locked) rno.addEventListener("change", () => {
    const src = invFindByNo(rno.value);
    if (!src) return;
    o.refInvoice = { docNo: String(src.docNo || ""), date: src.issueDate || (o.refInvoice || {}).date || "" };
    o.seriesKey = invSeriesOfInvoice(src);
    if (src.currency) o.currency = src.currency;
    if (src.vatRate != null) o.vatRate = src.vatRate;
    if (src.vatBasis) o.vatBasis = src.vatBasis;
    erpInvForm(o);
  });
  // Избор от списъка: пренася серия, клиент, получател, валута, ДДС и поръчка.
  const rpick = document.getElementById("inv-refpick");
  if (rpick && !locked) rpick.addEventListener("change", () => {
    const src = (erpInvoices || []).find(x => String(x.id) === String(rpick.value));
    if (!src) return;
    o.refInvoice = { docNo: String(src.docNo || ""), date: src.issueDate || "" };
    o.seriesKey = invSeriesOfInvoice(src);
    o.currency = src.currency || o.currency;
    if (src.vatRate != null) o.vatRate = src.vatRate;
    if (src.vatBasis) o.vatBasis = src.vatBasis;
    o.client = JSON.parse(JSON.stringify(src.client || o.client || {}));
    o.clientId = src.clientId || o.clientId || null;
    if (src.consignee) o.consignee = JSON.parse(JSON.stringify(src.consignee));
    o.orderRef = src.orderRef || o.orderRef || "";
    o.payCond = src.payCond || o.payCond || "";
    o.tariffCode = src.tariffCode || o.tariffCode || "";
    if (!(o.lines || []).length) o.lines = (src.lines || []).map(l => ({ ...l }));
    erpInvForm(o);
  });
  g("inv-refdate", e => { o.refInvoice = o.refInvoice || {}; o.refInvoice.date = e.target.value; });
  g("inv-refreason", e => o.refReason = e.target.value);
  g("inv-cname", e => o.client.name = e.target.value);
  const cn = document.getElementById("inv-cname"); if (cn && !locked) cn.addEventListener("change", bindClient);
  g("inv-ceik", e => o.client.eik = e.target.value);
  g("inv-cvat", e => o.client.vat = e.target.value);
  g("inv-cmol", e => o.client.person = e.target.value);
  const gpick = document.getElementById("inv-gpick");
  if (gpick && !locked) gpick.addEventListener("change", () => {
    const cs = (window.__invConsSaved || [])[Number(gpick.value)];
    if (cs) { o.consignee = { ...cs }; erpInvForm(o); }
  });
  g("inv-ccity", e => o.client.city = e.target.value);
  g("inv-cstreet", e => o.client.street = e.target.value);
  g("inv-ccountry", e => o.client.country = e.target.value);
  g("inv-note", e => o.note = e.target.value);
  const pr = document.getElementById("inv-print"); if (pr) pr.addEventListener("click", () => erpInvPrint(o));
  const fx = document.getElementById("inv-fix");
  if (fx) fx.addEventListener("click", () => {
    if (locked) {
      if (!confirm("Отварям документа за РЪЧНА корекция преди печат.\nНомерът и статусът се запазват; промените важат за печата и за вземането.\nПродължавам?")) return;
      o.__editUnlocked = true; erpInvForm(o); return;
    }
    const first = document.querySelector("#inv-lines tbody input");
    if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); first.focus(); }
    else alert("Документът е отворен за редакция — поправи го и натисни Печат.");
  });
  const cnl = document.getElementById("inv-cancel"); if (cnl) cnl.addEventListener("click", () => erpInvCancel(o));
  const ml = document.getElementById("inv-mail"); if (ml) ml.addEventListener("click", () => erpMailInvoice(o));
  const sv = document.getElementById("inv-save"); if (sv) sv.addEventListener("click", () => erpInvSaveClick(o));
  const iss = document.getElementById("inv-issue"); if (iss) iss.addEventListener("click", () => erpInvIssue(o));
  const unl = document.getElementById("inv-unlock"); if (unl) unl.addEventListener("click", () => { if (!confirm("Отключвам издадената фактура за РЪЧНА редакция.\nНомерът и статусът се запазват; промените важат за печата и за вземането.\nПродължавам?")) return; o.__editUnlocked = true; erpInvForm(o); });
  const ap = document.getElementById("inv-add-prod"); if (ap) ap.addEventListener("click", () => erpInvAddProduct(o));
  const af = document.getElementById("inv-add-free"); if (af) af.addEventListener("click", () => { o.lines.push({ code: "", name: "", clientCode: "", unit: "бр.", qty: 1, unitPrice: "" }); erpInvLinesRefresh(o); });
  // Зелените (Стокова/Packing/Палет опис) черпят от ОПАКОВКИ — заявката по Order No.
  const packDoc = kind => async () => {
    const co = (typeof erpPackOrderForInvoice === "function") ? await erpPackOrderForInvoice(o) : null;
    if (co && typeof erpPackPrintFor === "function") { erpPackPrintFor(co, kind); return; }
    const ask = "Не намерих заявка по Order No “" + (o.orderRef || "—") + "” — тези документи черпят от ОПАКОВКИ (заявката).\nПопълни полето Поръчка на клиента (Order No) на фактурата с номера на заявката.\n\nДа отпечатам ли ПО СТАРИЯ начин — от редовете на фактурата?";
    if (!confirm(ask)) return;
    if (kind === "goods") erpInvPrintGoodsNote(o);
    else if (kind === "packing") (typeof erpInvPrintPackingEx === "function" ? erpInvPrintPackingEx(o) : erpInvPrintPacking(o));
    else erpInvPrintPallets(o);
  };
  const dg = document.getElementById("inv-doc-goods"); if (dg) dg.addEventListener("click", packDoc("goods"));
  const dp = document.getElementById("inv-doc-packing"); if (dp) dp.addEventListener("click", packDoc("packing"));
  const dc = document.getElementById("inv-doc-cmr"); if (dc) dc.addEventListener("click", () => (typeof erpInvPrintCMREx === "function" ? erpInvPrintCMREx(o) : erpInvPrintCMR(o)));
  const dl = document.getElementById("inv-doc-pallets"); if (dl) dl.addEventListener("click", packDoc("pallets"));
  const dd = document.getElementById("inv-doc-desc"); if (dd) dd.addEventListener("click", () => erpInvPrintDescGoods(o));
  const db1 = document.getElementById("inv-doc-decl-bg"); if (db1) db1.addEventListener("click", () => erpInvPrintDeclaration(o, "bg"));
  const db2 = document.getElementById("inv-doc-decl-en"); if (db2) db2.addEventListener("click", () => erpInvPrintDeclaration(o, "en"));
  const et = document.getElementById("inv-edit-transport"); if (et) et.addEventListener("click", () => erpInvTransportDialog(o));
  const mt = document.getElementById("inv-mail-transport"); if (mt) mt.addEventListener("click", () => erpMailTransportInquiry(o));
  const ep = document.getElementById("inv-edit-pallets"); if (ep) ep.addEventListener("click", () => erpInvPalletsDialog(o));
  erpInvWireLines(o, locked);
  erpInvTotalsBox(o);
}

function erpInvLinesHtml(o, locked) {
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Код">${locked ? escapeHtml(l.code || "") : `<input type="text" class="inv-code" data-i="${i}" value="${escapeAttr(l.code || "")}" style="width:80px" />`}${l.clientCode ? `<div class="erp-co-ccode">клиент: ${escapeHtml(l.clientCode)}</div>` : ""}</td>
      <td data-label="Наименование">${locked ? escapeHtml(l.name || "") : `<input type="text" class="inv-name" data-i="${i}" value="${escapeAttr(l.name || "")}" style="width:100%;min-width:160px" />`}</td>
      <td data-label="Поръчка">${locked ? escapeHtml(l.orderRef || "") : `<input type="text" class="inv-ordref" data-i="${i}" value="${escapeAttr(l.orderRef || "")}" style="width:110px" placeholder="${escapeAttr(o.orderRef || "поръчка")}" title="Поръчката на клиента ЗА ТОЗИ ред. Празно = общата поръчка на фактурата." />`}</td>
      <td class="num" data-label="Кол.">${locked ? erpNum(l.qty) : `<input type="number" class="inv-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:80px" />`}</td>
      <td data-label="МЕ">${locked ? escapeHtml(l.unit || "") : `<input type="text" class="inv-unit" data-i="${i}" value="${escapeAttr(l.unit || "бр.")}" style="width:56px" />`}</td>
      <td class="num" data-label="Ед. цена">${locked ? erpNum(l.unitPrice) : `<input type="number" class="inv-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:100px" placeholder="0.00" />`}</td>
      <td class="num" data-label="Стойност">${erpInvMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpInvCur(o))}</td>
      <td class="erp-row-actions">${locked ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Няма редове.</td></tr>`;
}
function erpInvWireLines(o, locked) {
  if (locked) return;
  const body = document.querySelector("#inv-lines tbody"); if (!body) return;
  const line = el => o.lines[Number(el.dataset.i)];
  body.querySelectorAll(".inv-code").forEach(el => el.addEventListener("input", () => line(el).code = el.value));
  body.querySelectorAll(".inv-name").forEach(el => el.addEventListener("input", () => line(el).name = el.value));
  body.querySelectorAll(".inv-ordref").forEach(el => el.addEventListener("input", () => line(el).orderRef = el.value));
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
  try {
    await erpSaveInvoice(o);
    // Редакция на издадена → опресняваме и вземането от тази фактура (ако не е платено).
    if (o.posted && o.kind !== "proforma" && typeof erpRecvSyncFromInvoice === "function") { try { await erpRecvSyncFromInvoice(o); } catch (e) {} }
    await erpLoadInvoices();
    if (btn) { btn.disabled = false; btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) btn.textContent = "💾 Запази"; }, 1400); }
  }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; } alert("Грешка при запис: " + (e.message || e)); }
}

async function erpInvIssue(o) {
  if (o.posted) return;
  if (!(o.lines || []).length) { alert("Добави поне един ред."); return; }
  if (!o.client.name) { alert("Въведи клиент."); return; }
  if ((o.kind === "credit" || o.kind === "debit") && !(o.refInvoice && o.refInvoice.docNo)) {
    alert("Известието задължително се връзва към фактура (чл. 115): въведи номер на оригиналната фактура."); return;
  }
  // Известието трябва да е от СЕРИЯТА на оригиналната фактура (износ ≠ вътрешен).
  if (o.kind === "credit" || o.kind === "debit") {
    const src = invFindByNo((o.refInvoice || {}).docNo);
    if (src) {
      const sk = invSeriesOfInvoice(src);
      if (sk !== String(o.seriesKey)) {
        const a = (erpInvSeries[sk] || {}).label || "", b = (erpInvSeries[o.seriesKey] || {}).label || "";
        if (confirm(`Оригиналната фактура № ${src.docNo} е от серия ${sk} (${a}),\nа известието сега е на серия ${o.seriesKey} (${b}).\n\nОК = издавам от серия ${sk} (както е фактурата)\nОтказ = оставям серия ${o.seriesKey}`)) {
          o.seriesKey = sk;
          const selEl = document.getElementById("inv-series"); if (selEl) selEl.value = sk;
        }
      }
    }
  }
  if (!confirm("Да издам ли документа и да взема номер от серията? След това не може да се редактира.")) return;
  const btn = document.getElementById("inv-issue");
  if (btn) { btn.disabled = true; btn.textContent = "Издавам…"; }
  try {
    await erpInvLoadSeries();
    const ser = erpInvSeries[o.seriesKey] || erpInvSeries["2"];
    const isPf = o.kind === "proforma";
    let useNo = "";
    if (isPf) {
      // Проформата взима номер от собствения си брояч — фактурните не се пипат.
      o.docNo = invPfNo(ser);
    } else {
      // Освободени номера от АНУЛИРАНИ фактури — предлагат се преди новия номер,
      // за да не остават дупки в номерацията (може за друг клиент).
      const freed = (ser.freed || []).slice().sort((a, b) => Number(a) - Number(b));
      if (freed.length) {
        useNo = confirm(`♻ Има освободен номер от анулирана фактура: ${freed[0]}.\n\nОК = ползвам ${freed[0]}\nОтказ = нов номер ${ser.next}`) ? String(freed[0]) : "";
      }
      o.docNo = useNo || String(ser.next);
    }
    o.posted = true; o.status = "издадена";
    await erpSaveInvoice(o);              // уникалният индекс ще хване евентуален дублат
    if (isPf) ser.pfNext = invPfNext(ser) + 1;
    else if (useNo) ser.freed = (ser.freed || []).filter(x => String(x) !== useNo);
    else ser.next = Math.floor(Number(ser.next) || 0) + 1;
    await erpInvSaveSeries();
    await erpLoadInvoices();
    // Издадената фактура става вземане от клиента (проформата не влиза).
    try { if (typeof erpRecvSyncFromInvoice === "function") await erpRecvSyncFromInvoice(o); } catch (e) {}
    // Цените от фактурата попълват ценовата листа на клиента (авто).
    try { if (typeof erpPLApplyInvoice === "function") await erpPLApplyInvoice(o); } catch (e) {}
    // Фактура от продажби: маркираме ги с номера (не се фактурират втори път).
    if ((o.fromSaleIds || []).length) { try { await erpInvMarkSalesInvoiced(o); } catch (e) {} }
    // Известие с движение на стока: кредитно ВРЪЩА артикулите в Склад детайли
    // (клиентът ги връща), дебитно ги ИЗПИСВА (пращаме стока).
    if ((o.kind === "credit" || o.kind === "debit") && o.returnStock) { try { await erpInvNoteStockMoves(o); } catch (e) { alert("Складовите движения по известието не минаха: " + (e.message || e)); } }
    erpInvForm(JSON.parse(JSON.stringify((erpInvoices || []).find(x => x.id === o.id) || o)));
    // Автоматично предлага изпращане на фактурата по имейл (готово писмо, 1 клик).
    try { if (typeof erpMailInvoice === "function") erpMailInvoice(o); } catch (e) {}
  } catch (e) {
    o.posted = false; o.status = "чернова"; o.docNo = null;
    if (btn) { btn.disabled = false; btn.textContent = "📤 Издай (вземи номер)"; }
    alert("Грешка при издаване: " + (e.message || e) + "\n(Ако номерът вече съществува — смени следващия номер в Серии.)");
  }
}

/* ---------- 🚫 Анулиране на документ ----------
   Документът остава в системата (следа), но: вземането пада, продажбите се
   отвързват (може да се фактурират наново), а НОМЕРЪТ се освобождава — влиза
   в списъка с освободени номера на серията и се предлага при следващото
   издаване (може за друг клиент). */
async function erpInvCancel(o) {
  if (!o.posted) { alert("Черновата не се анулира — просто я промени или изтрий."); return; }
  if (o.status === "анулирана") { alert("Документът вече е анулиран."); return; }
  const no = o.docNo || "";
  const isPf = o.kind === "proforma";
  if (!confirm(`🚫 Да анулирам ли ${(INV_KINDS[o.kind] || {}).label || "документа"} № ${no}?\n\n`
    + `• Вземането от клиента отпада\n`
    + `• Продажбите се отвързват (може да се фактурират наново)\n`
    + (isPf ? `• Проформеният номер не се връща в оборот (не е данъчен документ)\n`
            : `• Номер ${no} се ОСВОБОЖДАВА и ще се предложи при следващото издаване\n`)
    + `\nДокументът остава в списъка със статус „анулирана".`)) return;
  const reason = prompt("Основание за анулиране (влиза в документа):", o.cancelReason || "") || "";
  try {
    await erpInvLoadSeries();
    const ser = erpInvSeries[o.seriesKey] || erpInvSeries["2"];
    if (no && !isPf) {           // проформените номера не влизат в оборот
      const freed = (ser.freed || []).map(String);
      if (!freed.includes(String(no))) freed.push(String(no));
      ser.freed = freed.sort((a, b) => Number(a) - Number(b));
      await erpInvSaveSeries();
    }
    o.cancelledNo = no;
    o.docNo = null;                       // освобождава уникалния индекс doc_no
    o.status = "анулирана";
    o.cancelledAt = new Date().toISOString();
    o.cancelReason = reason;
    await erpSaveInvoice(o);
    // Вземането по фактурата отпада.
    try { if (typeof erpRecvRemoveForInvoice === "function") await erpRecvRemoveForInvoice(o.id); } catch (e) {}
    // Продажбите се отвързват — да могат да се фактурират наново.
    for (const sid of (o.fromSaleIds || [])) {
      try {
        const { data } = await sb.from("sales").select("id,data,posted").eq("id", sid).maybeSingle();
        if (!data) continue;
        const d = data.data || {};
        delete d.invoiceNo; delete d.invoiceId;
        await sb.from("sales").update({ data: d, posted: !!data.posted, updated_at: new Date().toISOString() }).eq("id", sid);
        const local = ((typeof erpSales !== "undefined" && erpSales) || []).find(x => x.id === sid);
        if (local) { delete local.invoiceNo; delete local.invoiceId; }
      } catch (e) {}
    }
    await erpLoadInvoices();
    alert(isPf
      ? `✓ Проформата е анулирана.\nФактурните номера не са пипани.`
      : `✓ Документът е анулиран.\nНомер ${no} е освободен — ще ти се предложи при следващото издаване от серия ${o.seriesKey}.`);
    erpRenderInvoices();
  } catch (e) {
    alert("Грешка при анулиране: " + (e.message || e));
  }
}

/* ---------- Известие → складови движения (връщане/изпращане на артикули) ---------- */
async function erpInvNoteStockMoves(o) {
  try { await erpEnsureLoaded(); } catch (e) {}
  const credit = o.kind === "credit";
  const rows = [], miss = [];
  (o.lines || []).forEach(l => {
    const q = erpToNum(l.qty) || 0; if (!(q > 0)) return;
    const code = String(l.code || "").trim();
    const p = code ? (ERP.products || []).find(x => String(x.code || "").trim() === code) : null;
    if (!p) { miss.push(code || l.name || "?"); return; }
    rows.push({
      product_id: p.id, kind: credit ? "заприходяване" : "изписване",
      quantity: credit ? q : -q, ref: "известие:" + (o.docNo || ""),
      note: credit ? `Върнати от клиента — кредитно известие № ${o.docNo || ""}` : `Изпратени с дебитно известие № ${o.docNo || ""}`,
    });
  });
  if (rows.length) {
    const r = await sb.from("product_movements").insert(rows);
    if (r.error) { alert("Известието е издадено, но СКЛАДЪТ не се обнови: " + r.error.message); return; }
  }
  let msg = rows.length ? `Складът е обновен: ${rows.length} артикула ${credit ? "върнати в" : "изписани от"} Склад детайли.` : "";
  if (miss.length) msg += `\n⚠ Без складово движение (няма продукт с такъв код): ${miss.join(", ")}`;
  if (msg) alert(msg);
}

// Ново кредитно/дебитно известие ПО издадена фактура — пренася клиента,
// редовете, валутата и връзката (чл. 115); редовете се коригират на ръка.
function erpInvNoteFrom(src, kind) {
  const today = new Date().toISOString().slice(0, 10);
  const o = {
    kind, seriesKey: invSeriesOfInvoice(src), issueDate: today, taxDate: today,
    orderRef: src.orderRef || "", client: JSON.parse(JSON.stringify(src.client || {})),
    consignee: src.consignee ? JSON.parse(JSON.stringify(src.consignee)) : null,
    clientId: src.clientId || null, currency: src.currency || "EUR",
    vatRate: src.vatRate != null ? src.vatRate : 20, vatBasis: src.vatBasis || "",
    paymentMethod: src.paymentMethod || "", termDays: 0, dueDate: "", note: "",
    refInvoice: { docNo: src.docNo || "", date: src.issueDate || "" },
    refReason: "", lines: (src.lines || []).map(l => ({ ...l })),
    status: "чернова", posted: false, compiledBy: src.compiledBy || "",
    tariffCode: src.tariffCode || "", payCond: src.payCond || "",
    returnStock: kind === "credit",   // кредитното най-често връща стока
  };
  erpInvForm(o);
}

/* ---------- Печат (BG / EN, 1:1 като реалната фактура) ---------- */
function erpInvPrintHTML(o, single) {
  const ser = (erpInvSeries && erpInvSeries[o.seriesKey]) || { lang: "bg" };
  const en = ser.lang === "en";
  // Износна серия (EN): новият печат по образеца — само ORIGINAL, всичко на
  // английски, CONSIGNEE + BUYER/IMPORTER, транспортен блок, Art. 138(1).
  if (en && typeof erpInvPrintExport === "function") { erpInvPrintExport(o); return; }
  const k = INV_KINDS[o.kind] || {};
  const title = en ? (k.en || "INVOICE") : (k.bg || "ФАКТУРА");
  const t = erpInvTotals(o); const cur = erpInvCur(o);
  const s = ERP_SELLER || {};
  const L = en ? {
    orig: "ORIGINAL", no: "No", date: "Date", order: "Order No and date", tel: "tel.", recipient: "Recipient", supplier: "Supplier",
    nn: "No", name: "Description of goods and services", ordCol: "Order No/ date", code: "Code", qty: "Qty / UoM", price: "Unit price", amount: "Amount",
    totalQty: "Total qty", words: "In words", pay: "Payment", due: "Due date", base: "Tax base", vatL: "VAT", total: "Total",
    bankL: "Bank", ibanL: "IBAN", bicL: "BIC/SWIFT", received: "Recipient", suppSign: "Supplier", ref: "To invoice No/date", reason: "Reason", eik: "UIC",
  } : {
    orig: "ОРИГИНАЛ", no: "№", date: "Дата", order: "Номер и дата на поръчка", tel: "тел.", recipient: "Получател", supplier: "Доставчик",
    nn: "№", name: "Наименование на стоките и услугите", ordCol: "№ и дата на Поръчка", code: "Код", qty: "Кол. / МЕ", price: "Ед. цена", amount: "Стойност",
    totalQty: "Общо кол.", words: "Словом", pay: "Начин на плащане", due: "Падеж", base: "Данъчна основа", vatL: "ДДС", total: "Обща стойност",
    bankL: "Банка", ibanL: "IBAN", bicL: "BIC/SWIFT", received: "Получател", suppSign: "Доставчик", ref: "Към фактура №/дата", reason: "Основание", eik: "ЕИК",
  };
  const fm = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtD = d => { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (d || ""); };
  const base = new URL(".", location.href).href;
  let totQty = 0;
  const rows = (o.lines || []).map((l, i) => {
    totQty += erpToNum(l.qty) || 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${escapeHtml(l.name || "")}</b>${l.clientCode ? `<br><small>${en ? "client code" : "клиент"}: ${escapeHtml(l.clientCode)}</small>` : ""}</td>
      <td class="c">${escapeHtml(l.orderRef || o.orderRef || "- /")}</td>
      <td class="c">${escapeHtml(l.code || "")}</td>
      <td class="r">${erpNum(l.qty)} ${escapeHtml(l.unit || "")}</td>
      <td class="r">${fm(l.unitPrice)}</td>
      <td class="r">${fm((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0))}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="c muted">—</td></tr>`;

  const noteRef = (o.kind === "credit" || o.kind === "debit") && o.refInvoice
    ? `<div class="inl"><b>${L.ref}:</b> ${escapeHtml(o.refInvoice.docNo || "")} / ${fmtD(o.refInvoice.date || "")}${o.refReason ? ` · ${L.reason}: ${escapeHtml(o.refReason)}` : ""}</div>` : "";
  const vatBasis = (Number(o.vatRate) === 0 && o.vatBasis) ? `<div class="inl">${escapeHtml(o.vatBasis)}</div>` : "";
  const bgnLine = cur === "EUR" ? `<div class="tot-bgn">= ${fm(t.total * INV_EUR_BGN)} BGN</div>` : "";
  const c = o.client || {};

  // Една страница от документа (lbl = ОРИГИНАЛ / КОПИЕ)
  const invPage = lbl => `
    <div class="lg"><img src="${base}welcome.svg?v=144" alt="DankoSystems" /></div>
    <hr class="thin" />
    <div class="trow"><span style="width:80px"></span><h1>${escapeHtml(title)}</h1><span class="orig">${lbl}</span></div>
    <hr class="thin" />
    <div class="meta">
      <div class="ml">${escapeHtml(en ? (((INV_KINDS[o.kind] || {}).en || "Invoice").charAt(0) + ((INV_KINDS[o.kind] || {}).en || "Invoice").slice(1).toLowerCase()) : ((INV_KINDS[o.kind] || {}).label || "Фактура"))} ${L.no}: <b>${escapeHtml(o.docNo || "____")}</b><br>${L.date}: <b>${fmtD(o.issueDate)}</b><br><span class="lab">${L.order}:</span> <b>${escapeHtml(o.orderRef || "/")}</b></div>
      <div class="mr">
        ${s.phone ? `<div><span class="lab">${L.tel}:</span> ${escapeHtml(s.phone)}</div>` : ""}
        ${s.email ? `<div><span class="lab">e-mail:</span> ${escapeHtml(s.email)}</div>` : ""}
      </div>
    </div>
    ${noteRef}${vatBasis}
    <div class="parties">
      <div class="party"><div class="ph">${L.recipient}:</div><div class="pb">
        <b>${escapeHtml((c.name || "").toUpperCase())}</b><br><br>
        ${c.eik ? `<b>${L.eik} ${escapeHtml(c.eik)}</b><br>` : ""}
        ${c.vat ? `<b>${escapeHtml(c.vat)}</b><br>` : ""}
        ${[c.street, c.city, c.country].filter(Boolean).map(x => escapeHtml(x)).join("<br>")}
        <span class="mol">${escapeHtml((c.person || "").toUpperCase())}</span>
      </div></div>
      <div class="party"><div class="ph">${L.supplier}:</div><div class="pb">
        <b>${escapeHtml((s.name || "").toUpperCase())}</b><br><br>
        <b>${L.eik} ${escapeHtml(s.eik || "")}</b><br>
        <b>${escapeHtml(s.vat || "")}</b><br>
        ${escapeHtml((s.address || "").toUpperCase())}<br>
        ${escapeHtml((s.city || "").toUpperCase())}<br>
        ${en ? "Bulgaria" : "България"}
        <span class="mol">${escapeHtml(s.mol || "")}</span>
      </div></div>
    </div>
    <table class="items">
      <thead><tr>
        <th class="c" style="width:26px">${L.nn}</th>
        <th>${L.name}</th>
        <th class="c" style="width:82px">${L.ordCol}</th>
        <th class="c" style="width:70px">${L.code}</th>
        <th class="c" style="width:78px">${L.qty}</th>
        <th class="c" style="width:70px">${L.price}<br>${cur}</th>
        <th class="c" style="width:84px">${L.amount}<br>${cur}</th>
      </tr></thead>
      <tbody>${rows}
        <tr><td></td><td class="r" colspan="3"><b>${L.totalQty}:</b></td><td class="r">${erpNum(totQty)}</td><td></td><td></td></tr>
      </tbody>
    </table>
    <div class="totbox">
      <div class="tl">
        <div><b>${L.words}:</b> ${escapeHtml(invAmountWords(t.total, cur, en ? "en" : "bg"))}</div>
        <div>${L.pay}: ${escapeHtml(o.paymentMethod || "")}</div>
        ${(o.dueDate || Number(o.termDays) > 0) ? `<div>${L.due}: <b>${fmtD(o.dueDate)}</b>${Number(o.termDays) > 0 ? ` (${o.termDays} ${en ? "days" : "дни"})` : ""}</div>` : ""}
      </div>
      <div class="tr2">
        <div class="trow2"><span>${L.base}:</span><span class="v">${fm(t.base)} ${cur}</span></div>
        <div class="trow2"><span>${L.vatL} ${t.rate}%:</span><span class="v">${fm(t.vat)} ${cur}</span></div>
        <div class="trow2"><span><b>${L.total}:</b></span><span class="v" style="font-size:13px">${fm(t.total)} ${cur}</span></div>
        ${bgnLine}
      </div>
    </div>
    ${o.note ? `<div class="inl">${escapeHtml(o.note)}</div>` : ""}
    <div class="bankbox">
      <div class="bankrow">
        <div class="bl">
          <div><b>${L.ibanL}:</b> ${escapeHtml(s.iban || "")}</div>
          <div><b>${L.bicL}:</b> ${escapeHtml(s.bic || "")}</div>
          <div><b>${L.bankL}:</b> ${escapeHtml((s.bank || "").toUpperCase())}</div>
        </div>
        <div class="br">
          <div><b>${L.date}:</b> ${fmtD(o.issueDate)}</div>
          <div><b>${L.suppSign}:</b> ${escapeHtml((s.name || "").toUpperCase())}</div>
        </div>
      </div>
      <div class="signs">
        <div class="sg">${L.received}:................................</div>
        <div class="sg" style="text-align:right">${en ? "Issued by" : "Изготвил фактурата"}:..............................<br><span style="margin-right:30px">${escapeHtml(o.compiledBy || "")}</span></div>
      </div>
    </div>
    <div class="isobox"><img src="${base}iso-cert.png" alt="ISO 9001:2015" /></div>
    <div class="made">The Systems</div>`;
  const html = `<!doctype html><html lang="${en ? "en" : "bg"}"><head><meta charset="utf-8"><title>${escapeHtml(title)} ${escapeHtml(o.docNo || "")}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 26px;max-width:840px}
    hr.thin{border:none;border-top:1.4px solid #000;margin:6px 0}
    .lg img{height:56px;display:block}
    .trow{display:flex;align-items:baseline;justify-content:space-between}
    .trow h1{flex:1;text-align:center;font-size:17px;letter-spacing:1px;margin:2px 0}
    .trow .orig{font-weight:700;font-size:13px}
    .meta{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin:6px 0 10px}
    .meta .ml{border:1.6px solid #000;padding:6px 10px;width:calc(50% - 9px);box-sizing:border-box;line-height:1.55}
    .meta .mr{text-align:right;font-size:11.5px}
    .meta .mr .lab{color:#333}
    .parties{display:flex;gap:18px;margin-bottom:12px}
    .party{flex:1;border:1.6px solid #000}
    .party .ph{font-weight:700;padding:3px 8px;border-bottom:1.4px solid #000;background:#e9edf2;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .party .pb{padding:8px 10px 6px 26px;min-height:128px;display:flex;flex-direction:column}
    .party .pb .mol{margin-top:auto;padding-top:10px}
    table.items{width:100%;border-collapse:collapse;margin-bottom:10px}
    table.items th,table.items td{border:1.2px solid #000;padding:4px 6px;font-size:11.5px;text-align:left;vertical-align:top}
    table.items th{background:#e9edf2;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    table.items{page-break-inside:auto}
    table.items tr{page-break-inside:avoid;page-break-after:auto}
    table.items thead{display:table-header-group}
    .totals,.bankbox,.signs{page-break-inside:avoid}
    td.r{text-align:right}td.c,th.c{text-align:center}.muted{color:#777}small{color:#555}
    .totbox{border:1.6px solid #000;display:flex;gap:10px;padding:8px 10px;margin-bottom:10px}
    .totbox .tl{flex:1;align-self:center}
    .totbox .tr2{min-width:300px}
    .totbox .trow2{display:flex;justify-content:space-between;gap:14px;padding:1px 0}
    .totbox .trow2 .v{font-weight:700;min-width:110px;text-align:right}
    .tot-bgn{text-align:right;font-size:11px}
    .bankbox{border:1.6px solid #000;padding:8px 10px;margin-top:12px}
    .bankrow{display:flex;justify-content:space-between}
    .bankrow .bl b{display:inline-block;min-width:76px}
    .signs{display:flex;justify-content:space-between;margin-top:16px}
    .signs .sg{width:46%}
    .isobox{text-align:center;margin-top:26px}
    .isobox img{height:92px}
    .made{ text-align:center;font-size:9.5px;color:#666;margin-top:6px}
    @page{size:A4 portrait;margin:8mm}
    @media print{
      body{margin:0;max-width:none;font-size:11px}
      .noprint{display:none}
      .lg img{height:46px}
      .party .pb{min-height:104px}
      table.items th,table.items td{padding:3px 5px;font-size:10.5px}
      .isobox{margin-top:14px}
      .isobox img{height:72px}
      .bankbox{margin-top:8px}
      .signs{margin-top:10px}
    }
    .inv-page{break-after:page;page-break-after:always}
    @media screen{.inv-page{border-bottom:2px dashed #cbd5e1;margin-bottom:26px;padding-bottom:26px}}
    .noprint{text-align:center;margin:10px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
    ${single ? "" : `<div class="noprint"><button class="btnp" onclick="window.print()">🖨 ${en ? "Print" : "Печат"}</button></div>`}
    ${single ? `<div>${invPage(L.orig)}</div>` : `<div class="inv-page">${invPage(L.orig)}</div>
    <div>${invPage(en ? "COPY" : "КОПИЕ")}</div>`}
  </body></html>`;
  return html;
}
function erpInvPrint(o) {
  const html = erpInvPrintHTML(o);
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
function erpInvPrintGoodsNote(o) {
  let totKg = 0;
  const rows = (o.lines || []).map((l, i) => {
    const kg = erpDocLineKg(o, l); totKg += kg || 0;
    return `<tr><td>${i + 1}</td><td>${escapeHtml(l.code || "")}</td><td>${escapeHtml(l.name || "")}</td><td class="r">${erpNum(l.qty)}</td><td>${escapeHtml(l.unit || "")}</td><td class="r">${kg ? erpNum(kg) : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="c muted">—</td></tr>`;
  const grossKg = (o.transport && erpToNum(o.transport.totalWeightKg) > 0) ? erpToNum(o.transport.totalWeightKg) : totKg;
  const body = `
    <div class="head"><div><h1>СТОКОВА РАЗПИСКА</h1><div>към ${escapeHtml(o.__ref || invDocRef(o))}</div>${o.orderRef ? `<div>Поръчка на клиента: <b>${escapeHtml(o.orderRef)}</b></div>` : ""}</div><div style="text-align:right">Дата: <b>${erpDMY(o.issueDate || o.date)}</b></div></div>
    <div class="parties"><div class="party"><h3>Получател</h3>${invClientBlock(o)}</div><div class="party"><h3>Предал (Доставчик)</h3>${invSellerBlock()}</div></div>
    <table><thead><tr><th>№</th><th>Код</th><th>Наименование</th><th>Кол.</th><th>МЕ</th><th>Тегло (кг)</th></tr></thead><tbody>${rows}</tbody>
      ${grossKg ? `<tfoot><tr><td colspan="5" class="r"><b>Общо тегло</b></td><td class="r"><b>${erpNum(grossKg)} кг</b></td></tr></tfoot>` : ""}</table>
    ${o.transport && o.transport.totalPackages ? `<div class="kv">Брой пакети/палети: <b>${escapeHtml(o.transport.totalPackages)}</b></div>` : ""}
    <div class="foot"><div>Предал</div><div>Приел</div></div>`;
  invPrintWindow("Стокова разписка", body, "bg");
}

/* ---------- Packing List (EN) ---------- */
function erpInvPrintPacking(o) {
  const pal = (o.pallets && o.pallets.length) ? o.pallets : erpDocAutoRows(o);
  const totW = pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  const rows = pal.map((p, i) => `<tr><td>${escapeHtml(String(p.no || i + 1))}</td><td>${escapeHtml(p.desc || "")}</td><td class="r">${erpNum(p.qty)}</td><td class="r">${p.weightKg ? erpNum(p.weightKg) : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="c muted">—</td></tr>`;
  const tr = o.transport || {};
  const body = `
    <div class="head"><div><h1>PACKING LIST</h1><div>ref. ${escapeHtml(o.__ref || invDocRef(o))}</div>${o.orderRef ? `<div>Order No.: <b>${escapeHtml(o.orderRef)}</b></div>` : ""}</div><div style="text-align:right">Date: <b>${erpDMY(o.issueDate || o.date)}</b></div></div>
    <div class="parties"><div class="party"><h3>Consignee</h3>${invClientBlock(o)}</div><div class="party"><h3>Shipper</h3>${invSellerBlock()}</div></div>
    <table><thead><tr><th>Pallet/Pkg</th><th>Contents</th><th>Qty</th><th>Weight (kg)</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" class="r"><b>Total gross weight</b></td><td class="r"><b>${erpNum(totW || tr.totalWeightKg || 0)}</b></td></tr></tfoot></table>
    ${tr.incoterms ? `<div class="kv">Incoterms: <b>${escapeHtml(tr.incoterms)}</b></div>` : ""}
    <div class="foot"><div>Prepared by</div><div>Received by</div></div>`;
  invPrintWindow("Packing List", body, "en");
}

/* ---------- Палет опис (BG+EN) ---------- */
function erpInvPrintPallets(o) {
  const pal = (o.pallets && o.pallets.length) ? o.pallets : erpDocAutoRows(o);
  const totQ = pal.reduce((s, p) => s + (erpToNum(p.qty) || 0), 0);
  const totW = pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  const rows = pal.map((p, i) => `<tr><td>${escapeHtml(String(p.no || i + 1))}</td><td>${escapeHtml(p.desc || "")}</td><td class="r">${erpNum(p.qty)}</td><td class="r">${p.weightKg ? erpNum(p.weightKg) : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="c muted">—</td></tr>`;
  const body = `
    <div class="head"><div><h1>ПАЛЕТ ОПИС / PALLET LIST</h1><div>към ${escapeHtml(o.__ref || invDocRef(o))}</div>${o.orderRef ? `<div>Поръчка / Order: <b>${escapeHtml(o.orderRef)}</b></div>` : ""}</div><div style="text-align:right">Дата: <b>${erpDMY(o.issueDate || o.date)}</b></div></div>
    <div class="parties"><div class="party"><h3>Получател / Consignee</h3>${invClientBlock(o)}</div><div class="party"><h3>Доставчик / Shipper</h3>${invSellerBlock()}</div></div>
    <table><thead><tr><th>Палет №</th><th>Съдържание / Contents</th><th>Кол. / Qty</th><th>Тегло / Weight (kg)</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td class="r"><b>Общо / Total</b></td><td></td><td class="r"><b>${erpNum(totQ)}</b></td><td class="r"><b>${erpNum(totW)}</b></td></tr></tfoot></table>
    <div class="foot"><div>Съставил / Prepared</div><div>Получил / Received</div></div>`;
  invPrintWindow("Палет опис", body, "bg");
}

/* ---------- ЧМР / CMR (опростен международен формуляр) ---------- */
function erpInvPrintCMR(o) {
  const s = ERP_SELLER || {}; const c = o.client || {}; const tr = o.transport || {};
  const recipeKg = (o.lines || []).reduce((sum, l) => sum + (erpDocLineKg(o, l) || 0), 0);
  const grossKg = erpToNum(tr.totalWeightKg) > 0 ? erpToNum(tr.totalWeightKg) : recipeKg;
  const goods = (o.lines || []).map(l => `${erpNum(l.qty)} ${escapeHtml(l.unit || "")} · ${escapeHtml((l.code ? l.code + " " : "") + (l.name || ""))}`).join("<br>") || "—";
  const cell = (label, val) => `<td><span class="lbl">${label}</span>${val || ""}</td>`;
  const body = `
    <div class="head"><div><h1>ЧМР · CMR</h1><div class="muted">Международна товарителница / International consignment note</div></div><div style="text-align:right">${escapeHtml(invDocRef(o))}</div></div>
    <table class="cmr">
      <tr>${cell("1 Изпращач / Sender", invSellerBlock())}${cell("2 Получател / Consignee", invClientBlock(o))}</tr>
      <tr>${cell("3 Място на разтоварване / Place of delivery", escapeHtml(tr.unloadPlace || [c.city, c.country].filter(Boolean).join(", ")))}${cell("4 Място и дата на товарене / Place & date of taking over", escapeHtml([tr.loadPlace || s.city, erpDMY(tr.loadDate)].filter(Boolean).join(" · ")))}</tr>
      <tr>${cell("5 Приложени документи / Documents attached", escapeHtml(invDocRef(o)) + (o.orderRef ? " · Поръчка/Order: " + escapeHtml(o.orderRef) : "") + (tr.incoterms ? " · " + escapeHtml(tr.incoterms) : ""))}</tr>
      <tr>${cell("6-9 Маркировка, брой, вид, стока / Marks, packages, nature of goods", goods)}</tr>
      <tr>${cell("11 Бруто тегло / Gross weight (kg)", grossKg ? erpNum(grossKg) : "")}${cell("Брой пакети / Packages", escapeHtml(tr.totalPackages || ""))}</tr>
      <tr>${cell("16 Превозвач / Carrier", escapeHtml(tr.carrier || ""))}${cell("МПС / Vehicle · Шофьор / Driver", escapeHtml([tr.vehicleReg, tr.driver].filter(Boolean).join(" · ")))}</tr>
      <tr>${cell("22 Изпращач (подпис) / Sender", "")}${cell("23 Превозвач (подпис) / Carrier", "")}</tr>
      <tr>${cell("24 Получена стока / Goods received — подпис, дата", "")}<td></td></tr>
    </table>`;
  invPrintWindow("ЧМР / CMR", body, "bg");
}

/* ---------- Импорт на издадени фактури от GenCloud (xlsx) ----------
   Регистър на вече издадените документи. Групира редовете по № + клиент +
   дата. ИМПОРТЪТ Е МЕРОДАВЕН: при съвпадащ № (нормализиран) записът се
   ПРЕЗАПИСВА (тестовите фактури се заместват). Импортираните са със статус
   „издадена", НЕ създават вземания (вземанията идват от техния си импорт)
   и не пипат склада. */
async function erpInvImport(file) {
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
    await erpLoadInvoices();

    const groups = new Map();
    raw.forEach(r => {
      const docNo = String(pick(r, "№:", "№", "Док.№", "Док.No", "No", "Номер") || "").trim();
      const client = String(pick(r, "Партньор", "Клиент", "Контрагент") || "").trim();
      const date = pDate(pick(r, "Дата", "Док.дата", "Дата на док."));
      if (!docNo && !client) return;
      const key = docNo + "|" + client + "|" + date;
      if (!groups.has(key)) groups.set(key, {
        docNo, client, date,
        docType: String(pick(r, "Док.тип", "Тип документ", "Тип") || "").trim(),
        currency: String(pick(r, "Пр.цена (мярка)", "Кр.цена (мярка)", "Валута") || "").trim().toUpperCase() || "EUR",
        net: 0, vat: 0, lines: [],
      });
      const g = groups.get(key);
      const qty = num(pick(r, "Кол.", "Количество")) || 1;
      const rowNet = Math.abs(num(pick(r, "Пр.цена", "Кр.цена", "Стойност", "Сума без ДДС", "Сума")));
      const rowVat = Math.abs(num(pick(r, "ДДС сума", "ДДС")));
      g.net += rowNet; g.vat += rowVat;
      g.lines.push({
        code: String(pick(r, "Код") || "").trim(),
        name: String(pick(r, "Артикул", "Описание") || "").trim() || "услуга/стока",
        qty, unit: "бр.", unitPrice: qty ? Math.round((rowNet / qty) * 100) / 100 : rowNet,
      });
    });
    if (!groups.size) { alert("Не намерих редове с № фактура/клиент в файла."); return; }

    const norm = s => String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
    const byNo = new Map();
    (erpInvoices || []).forEach(o => { const k = norm(o.docNo); if (k && !byNo.has(k)) byNo.set(k, o); });
    let added = 0, replaced = 0;
    for (const g of groups.values()) {
      const rate = g.net > 0 ? g.vat / g.net * 100 : 20;
      const vatRate = [20, 9, 0].reduce((b, r) => Math.abs(r - rate) < Math.abs(b - rate) ? r : b, 20);
      const kind = /кредит/i.test(g.docType) ? "credit" : /дебит/i.test(g.docType) ? "debit" : /проформа/i.test(g.docType) ? "proforma" : "invoice";
      const fields = {
        docNo: g.docNo, kind, issueDate: g.date, taxDate: g.date,
        client: { name: g.client, eik: "", vat: "", city: "", street: "", country: "България", person: "" }, clientId: null,
        currency: g.currency === "BGN" ? "BGN" : "EUR", vatRate, vatBasis: "",
        paymentMethod: "по банка", termDays: 0, dueDate: "", refInvoice: null, refReason: "",
        lines: g.lines, status: "издадена", posted: true, imported: true,
        note: "Импорт от GenCloud", compiledBy: (typeof ERP_SELLER !== "undefined" && ERP_SELLER.mol) || "",
      };
      const k = norm(g.docNo);
      const ex = k ? byNo.get(k) : null;
      if (ex) {
        const rec = { id: ex.id, ...fields };
        try { await erpSaveInvoice(rec); replaced++; } catch (e) {}
      } else {
        const rec = { ...fields };
        try { await erpSaveInvoice(rec); if (k) byNo.set(k, rec); added++; } catch (e) {}
      }
    }
    await erpLoadInvoices();
    erpRenderInvoices();
    alert(`Импорт готов: ${added} добавени, ${replaced} презаписани (импортът е меродавен).` +
      `\n\nВажно: импортираните НЕ създават вземания (те идват от импорта във Вземания) и не пипат склада.` +
      `\nПровери ⚙ Серии/номера — броячът да продължава СЛЕД последния импортиран номер.`);
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}

// Изтегля (изтрива) импортираните фактури — ръчно създадените остават.
async function erpInvClearImport() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpLoadInvoices();
  const imp = (erpInvoices || []).filter(o => o.imported);
  if (!imp.length) { alert("Няма импортирани фактури."); return; }
  if (!confirm(`Да изтрия ли ${imp.length} импортирани фактури?\nСъздадените в Системата остават.`)) return;
  let del = 0;
  for (const o of imp) { try { const { error } = await sb.from("invoices").delete().eq("id", o.id); if (!error) del++; } catch (e) {} }
  await erpLoadInvoices();
  erpRenderInvoices();
  alert(`Изтрити ${del} импортирани фактури.`);
}

// Пълно изчистване на Фактуриране — трие ВСИЧКИ документи.
async function erpInvClearAll() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpLoadInvoices();
  const n = (erpInvoices || []).length;
  if (!n) { alert("Няма документи за изтриване."); return; }
  if (!confirm(`Да изтрия ли ВСИЧКИ ${n} документа от Фактуриране (фактури, проформи, кредитни)?` +
    `\n\nВнимание: вземанията, създадени от тези фактури, остават в таб Вземания — ако трябва, изчисти ги и там.` +
    `\n\nТова не може да се върне.`)) return;
  if (!confirm("Последно потвърждение: изтривам ВСИЧКО от Фактуриране?")) return;
  const { error } = await sb.from("invoices").delete().gte("id", 0);
  if (error) { alert("Грешка при изтриване: " + error.message); return; }
  await erpLoadInvoices();
  erpRenderInvoices();
  alert("Готово. Фактурирането е изчистено.");
}

/* ---------- 📊 СПРАВКА ФАКТУРИ (вътрешни / външни / покупни) ----------
   Период от дата до дата, три раздела и сваляне като файл (Excel) или
   преглед/печат. Вътрешни/външни се различават по езика на серията
   (BG серия = вътрешен пазар, EN серия = износ). Покупните идват от таб
   Покупки. Всички суми се дават и в EUR за сравнимост. */
function invRepEur(total, cur) { return (String(cur) === "BGN") ? (Number(total) || 0) / INV_EUR_BGN : (Number(total) || 0); }
function invRepMoney(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function erpInvReport() {
  await erpInvLoadSeries();
  if (!erpInvoices) { try { await erpLoadInvoices(); } catch (e) {} }
  if (typeof erpPurchases !== "undefined" && !erpPurchases && typeof erpLoadPurchases === "function") {
    try { await erpLoadPurchases(); } catch (e) {}
  }
  const today = new Date().toISOString().slice(0, 10);
  const m0 = today.slice(0, 8) + "01";
  const { wrap, close } = erpDialog(`
    <h3>📊 Справка фактури</h3>
    <div class="erp-toolbar" style="margin:0 0 8px">
      <label class="erp-inline">От <input type="date" id="ir-from" value="${m0}" /></label>
      <label class="erp-inline">До <input type="date" id="ir-to" value="${today}" /></label>
      <label class="erp-inline"><input type="checkbox" id="ir-in" checked /> Вътрешни</label>
      <label class="erp-inline"><input type="checkbox" id="ir-out" checked /> Външни (износ)</label>
      <label class="erp-inline"><input type="checkbox" id="ir-pu" checked /> Покупни</label>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small" id="ir-xls">⬇ Свали (Excel)</button>
      <button class="btn btn-small" id="ir-view">🖨 Преглед / печат</button>
    </div>
    <div id="ir-body" style="max-height:60vh;overflow:auto"></div>
    <div class="erp-dialog-actions"><button class="btn btn-primary" id="ir-x">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#ir-x").addEventListener("click", close);

  const build = () => {
    const from = wrap.querySelector("#ir-from").value || "0000-01-01";
    const to = wrap.querySelector("#ir-to").value || "9999-12-31";
    const inOn = wrap.querySelector("#ir-in").checked;
    const outOn = wrap.querySelector("#ir-out").checked;
    const puOn = wrap.querySelector("#ir-pu").checked;
    const inRange = d => { const x = String(d || "").slice(0, 10); return x && x >= from && x <= to; };

    const sales = (erpInvoices || []).filter(o => inRange(o.issueDate));
    const isEn = o => (((erpInvSeries || {})[o.seriesKey] || {}).lang === "en");
    const salesSec = (list, title) => {
      let sBase = 0, sVat = 0, sTot = 0;
      const rows = list.sort((a, b) => String(a.issueDate || "").localeCompare(String(b.issueDate || ""))).map(o => {
        const t = erpInvTotals(o); const cur = erpInvCur(o);
        const status = o.status || (o.posted ? "издадена" : "чернова");
        const eur = invRepEur(t.total, cur);
        if (status !== "анулирана") { sBase += invRepEur(t.base, cur); sVat += invRepEur(t.vat, cur); sTot += eur; }
        return [
          o.docNo || (o.cancelledNo ? "(анул.) " + o.cancelledNo : "—"),
          erpDMY(o.issueDate) || "", (o.client && o.client.name) || "",
          (INV_KINDS[o.kind] || {}).label || o.kind, o.orderRef || "",
          cur, invRepMoney(t.base), invRepMoney(t.vat), invRepMoney(t.total), invRepMoney(eur), status,
        ];
      });
      rows.push(["", "", "", "", "", "ОБЩО EUR", invRepMoney(sBase), invRepMoney(sVat), "", invRepMoney(sTot), `${list.length} документа`]);
      return {
        title, headers: [
          { label: "№" }, { label: "Дата" }, { label: "Клиент" }, { label: "Тип" }, { label: "Поръчка" },
          { label: "Вал." }, { label: "Основа", num: true }, { label: "ДДС", num: true },
          { label: "Общо", num: true }, { label: "Общо EUR", num: true }, { label: "Статус" },
        ], rows,
      };
    };

    const secs = [];
    if (inOn) secs.push(salesSec(sales.filter(o => !isEn(o)), "🇧🇬 Вътрешни фактури (български пазар)"));
    if (outOn) secs.push(salesSec(sales.filter(o => isEn(o)), "🌍 Външни фактури (износ)"));
    if (puOn) {
      const pu = ((typeof erpPurchases !== "undefined" && erpPurchases) || []).filter(p => inRange(p.date));
      let pBase = 0, pVat = 0, pTot = 0;
      const rows = pu.sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))).map(p => {
        const t = (typeof erpPuTotals === "function") ? erpPuTotals(p) : { base: 0, vat: 0, total: 0 };
        const cur = (typeof erpPuCur === "function") ? erpPuCur(p) : (p.currency || "BGN");
        const eur = invRepEur(t.total, cur);
        pBase += invRepEur(t.base, cur); pVat += invRepEur(t.vat, cur); pTot += eur;
        return [
          p.invoiceNo || "—", erpDMY(p.date) || "", p.supplierName || "",
          p.docType === "goods" ? "Стокова разписка" : "Фактура", p.expenseType || "",
          cur, invRepMoney(t.base), invRepMoney(t.vat), invRepMoney(t.total), invRepMoney(eur),
          p.paid ? "платена" : "за плащане",
        ];
      });
      rows.push(["", "", "", "", "", "ОБЩО EUR", invRepMoney(pBase), invRepMoney(pVat), "", invRepMoney(pTot), `${pu.length} документа`]);
      secs.push({
        title: "🧾 Покупни фактури", headers: [
          { label: "№" }, { label: "Дата" }, { label: "Доставчик" }, { label: "Документ" }, { label: "Вид разход" },
          { label: "Вал." }, { label: "Основа", num: true }, { label: "ДДС", num: true },
          { label: "Общо", num: true }, { label: "Общо EUR", num: true }, { label: "Статус" },
        ], rows,
      });
    }
    return { secs, from, to };
  };

  const draw = () => {
    const { secs } = build();
    wrap.querySelector("#ir-body").innerHTML = secs.map(sec => `
      <h4 class="erp-group-head">${escapeHtml(sec.title)}</h4>
      <table class="report-table erp-table">
        <thead><tr>${sec.headers.map(h => `<th class="${h.num ? "num" : ""}">${escapeHtml(h.label)}</th>`).join("")}</tr></thead>
        <tbody>${sec.rows.map((r, i) => `<tr${i === sec.rows.length - 1 ? ' style="font-weight:700;background:#f1f5f9"' : ""}>${r.map((c, j) => `<td class="${sec.headers[j] && sec.headers[j].num ? "num" : ""}">${escapeHtml(String(c))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`).join("") || `<p class="report-empty">Избери поне един вид документи.</p>`;
  };
  ["#ir-from", "#ir-to", "#ir-in", "#ir-out", "#ir-pu"].forEach(sel => wrap.querySelector(sel).addEventListener("change", draw));
  wrap.querySelector("#ir-xls").addEventListener("click", () => {
    const { secs, from, to } = build();
    if (typeof reportExportXls !== "function") { alert("Експортният модул не е зареден. Презареди страницата."); return; }
    reportExportXls(`spravka-fakturi-${from}_${to}`, `Справка фактури ${erpDMY(from)} — ${erpDMY(to)}`, secs);
  });
  wrap.querySelector("#ir-view").addEventListener("click", () => {
    const { secs, from, to } = build();
    if (typeof reportOpenView !== "function") { alert("Модулът за преглед не е зареден."); return; }
    reportOpenView(`Справка фактури ${erpDMY(from)} — ${erpDMY(to)}`, secs);
  });
  draw();
}
