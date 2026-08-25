/* Данко Системс — ЕРП „Покупки / Фактури-разходи".
   Въвежда ВСИЧКИ входящи фактури: материали за склад, покупни, услуги, транспорт,
   всякакви разходи. Всяка фактура носи:
   • класификация на редовете: артикулна група · артикул · наш код (+ материал);
   • начин на плащане (Банка/Каса) и срок в дни → дата за плащане;
   • файл (сканът), архив и търсене по артикул/код (сверка на цени, кога е купено).
   Две независими оси:
   1) ПЛАЩАНЕ — Банка+срок → „За плащане" → „Плати" (с дата) → архив „Платена";
      Каса/веднага → директно платена.
   2) ЗАПРИХОДЯВАНЕ — само материалните редове вдигат склад + средна цена
      (BGN се превръща в EUR за средната цена). Услуги/транспорт не пипат склада.
   Пази се в purchases.data (JSON). Ползва ERP/erpDialog/erpToNum/erpNum/erpEur… */

const PU_EUR_BGN = 1.95583;
/* Видове разход (по счетоводната класификация на фирмата). mat:true =
   материален разход — стоката трябва да влезе в склад Материали/Детайли
   (фактурата се заприходява), останалите са чисти разходи. */
const PU_EXPENSE_TYPES = [
  { k: "Метали", mat: true },
  { k: "Бои и цинк", mat: true },
  { k: "Крепежи", mat: true },
  { k: "Технически газове" },
  { k: "Заваръчно" },
  { k: "Пластмаси", mat: true },
  { k: "Опаковки", mat: true },
  { k: "Поддръжка машини" },
  { k: "Инвестиции" },
  { k: "Транспорт износ" },
  { k: "Транспорт вътрешен" },
  { k: "Ток" },
  { k: "Други услуги" },
  { k: "Други разходи" },
];
function erpPuTypeIsMat(t) { const x = PU_EXPENSE_TYPES.find(e => e.k === t); return !!(x && x.mat); }
// Нормализира № на фактура / име на доставчик за сравнение (интервали, водещи нули, регистър).
function erpPuEq(s) { return String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase(); }
// Други ЗАПИСИ със същия № на фактура (двойно въвеждане на една и съща фактура).
function erpPuDupsOf(o) {
  if (!o.invoiceNo) return [];
  return (erpPurchases || []).filter(p => String(p.id) !== String(o.id) && erpPuEq(p.invoiceNo) === erpPuEq(o.invoiceNo));
}
let erpPurchases = null;
let erpPuFolder = "payable";   // payable | paid | all
let erpPuQuery = "";

async function erpLoadPurchases() {
  const { data, error } = await erpSelectAll("purchases", "*");
  if (!error) (data || []).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  if (error) throw error;
  erpPurchases = (data || []).map(r => ({ id: r.id, posted: r.posted, ...(r.data || {}) }));
}
async function erpSavePurchase(o) {
  const data = { ...o }; delete data.id; delete data.posted;
  if (o.id) {
    const { error } = await sb.from("purchases").update({ data, posted: !!o.posted, updated_at: new Date().toISOString() }).eq("id", o.id);
    if (error) throw error;
  } else {
    const { data: ins, error } = await sb.from("purchases").insert({ data, posted: !!o.posted }).select("id").single();
    if (error) throw error;
    o.id = ins.id;
  }
}
async function erpLoadSuppliers() {
  try {
    const { data } = await erpSelectAll("partners", "id,name", "kind", "supplier");
    return (data || []).map(r => ({ id: r.id, name: r.name })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  } catch { return []; }
}

/* ---------- Плащане / статуси ---------- */
function erpPuAddDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00"); if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}
// Валутата по подразбиране е ЕВРО. BGN остава избираемо (стари документи).
function erpPuCur(o) { return o.currency || "EUR"; }
function erpPuMoney(n, cur) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (cur || "EUR"); }

/* Статус на плащане (4 избора):
   deferred — Отложено по банка (разсрочено) → неплатена, отива в „Задължения";
   cash — Платена в брой; card — Платена с кредитна карта; bank — Платена по банка.
   Каноничните полета (paymentMethod/termDays/paid) се държат в синхрон, за да работят
   склад, дата за плащане и връзката към „Задължения" без промяна. */
const PU_PAY_OPTS = [
  { k: "deferred", label: "Отложено по банка (разсрочено)" },
  { k: "cash", label: "Платена — в брой" },
  { k: "card", label: "Платена — с кредитна карта" },
  { k: "bank", label: "Платена — по банка" },
];
function erpPuPayStatus(o) {
  if (o.payStatus) return o.payStatus;
  if (o.paid) return o.paymentMethod === "Каса" ? "cash" : "bank";
  if (o.paymentMethod === "Банка" && Number(o.termDays) > 0) return "deferred";
  return "bank";
}
// Прилага каноничните полета според избрания статус.
function erpPuApplyPay(o) {
  const st = erpPuPayStatus(o); o.payStatus = st;
  const today = new Date().toISOString().slice(0, 10);
  if (st === "deferred") {
    o.paymentMethod = "Банка"; o.paid = false; o.paidDate = ""; o.paidMethod = "";
    o.termDays = Number(o.termDays) || 0;
  } else {
    o.paid = true; o.termDays = 0; o.dueDate = "";
    o.paymentMethod = st === "cash" ? "Каса" : "Банка";
    o.paidMethod = st === "cash" ? "В брой" : st === "card" ? "Кредитна карта" : "Банка";
    if (!o.paidDate) o.paidDate = o.date || today;
  }
}
function erpPuPayLabel(o) {
  const st = erpPuPayStatus(o);
  if (st === "deferred") return "Отложено · банка" + (Number(o.termDays) ? " · " + o.termDays + " дни" : "");
  return "Платена · " + (st === "cash" ? "в брой" : st === "card" ? "карта" : "банка");
}
// Дата за плащане: ръчно зададена или авто (дата + срок), само за отложено плащане.
function erpPuDueDate(o) {
  if (o.dueDate) return o.dueDate;
  if (erpPuPayStatus(o) === "deferred" && Number(o.termDays) > 0) return erpPuAddDays(o.date, o.termDays);
  return "";
}
// „За плащане" = отложено, срок>0, още неплатена.
function erpPuIsPayable(o) { return !o.paid && erpPuPayStatus(o) === "deferred" && Number(o.termDays) > 0; }
function erpPuStatus(o) { return o.paid ? "платена" : (erpPuIsPayable(o) ? "за плащане" : "платена"); }
/* Тотал на покупките за избрания месец (без ДДС / ДДС / с ДДС), в EUR.
   BGN фактурите се превръщат по фиксинга 1.95583. */
let erpPuMonth = "";
function erpPuMonthCards() {
  const host = document.getElementById("pu-month-cards"); if (!host) return;
  const m = erpPuMonth || new Date().toISOString().slice(0, 7);
  const RATE = 1.95583;
  let net = 0, vat = 0, n = 0;
  (erpPurchases || []).forEach(o => {
    if (String(o.date || "").slice(0, 7) !== m) return;
    if (o.docType === "goods") return;   // стоковата не е разход — парите идват с фактурата
    const t = erpPuTotals(o);
    const k = (o.currency === "BGN") ? 1 / RATE : 1;
    net += t.base * k; vat += t.vat * k; n++;
  });
  const money = v => (Math.round(v * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lbl = m.split("-")[1] + "." + m.split("-")[0];
  host.innerHTML = `
    <div class="pay-card"><div class="pay-card-l">🧾 Покупки БЕЗ ДДС · ${lbl}</div><div class="pay-card-v">${money(net)} EUR</div><div class="pay-card-n">${n} фактури</div></div>
    <div class="pay-card"><div class="pay-card-l">➕ ДДС · ${lbl}</div><div class="pay-card-v">${money(vat)} EUR</div><div class="pay-card-n">&nbsp;</div></div>
    <div class="pay-card pay-card-total"><div class="pay-card-l">Σ Покупки С ДДС · ${lbl}</div><div class="pay-card-v">${money(net + vat)} EUR</div><div class="pay-card-n">&nbsp;</div></div>`;
}

/* ДДС ставка НА РЕДА: празно = ставката на документа. Така една фактура може
   да носи ред с ДДС и ред без (Идънред, Йетел). */
function erpPuLineVat(o, l) {
  const v = (l && l.vatRate !== undefined && l.vatRate !== null && l.vatRate !== "") ? Number(l.vatRate) : Number(o.vatRate != null ? o.vatRate : 20);
  return isNaN(v) ? 0 : v;
}
function erpPuTotals(o) {
  let base = 0, vat = 0;
  const byRate = {};
  (o.lines || []).forEach(l => {
    const amt = (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0);
    const r = erpPuLineVat(o, l);
    base += amt; vat += amt * r / 100;
    byRate[r] = (byRate[r] || 0) + amt;
  });
  const rates = Object.keys(byRate).map(Number).sort((a, b) => b - a);
  const rate = rates.length === 1 ? rates[0] : Number(o.vatRate != null ? o.vatRate : 20);
  return { base, vat, total: base + vat, rate, byRate, rates, mixed: rates.length > 1 };
}

/* ---------- Списък (папки + търсене) ----------
   Зарежда от базата само при вход в таба; търсенето филтрира В ПАМЕТТА (обновява
   само тялото на таблицата) — без нова заявка към Supabase и без трепване/загуба
   на фокус при всеки натиснат клавиш. */
async function erpRenderPurchases() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpLoadPurchases(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя покупките</h3><p>${escapeHtml(e.message || String(e))}</p><p class="hint">Пусни обновения <code>erp-setup.sql</code> (таблица purchases) в Supabase.</p></div>`;
    return;
  }
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count" id="pu-count"></span>
      <input type="search" id="pu-q" placeholder="🔎 № / доставчик / артикул / код…" value="${escapeAttr(erpPuQuery)}" style="min-width:210px" />
      <span class="spacer"></span>
      <button class="btn btn-small" id="pu-types" title="Разходите за месеца по вид (Метали, Ток, Транспорт…) + експорт за счетоводството">📊 Разходи по вид</button>
      <button class="btn btn-small" id="pu-code-hist" title="История на цените по код на артикул">💹 Цени по код</button>
      <button class="btn btn-small" id="pu-dups" title="Намира фактури, въведени два пъти (един и същ номер) и позволява да изтриеш излишната">🔁 Дубликати</button>
      <button class="btn btn-small" id="pu-bgn" title="Проверка: кои документи са записани в лева">💱 В лева</button>
      ${typeof erpPuAIStart === "function" ? '<button class="btn btn-small" id="pu-ai" title="Качи сканирана фактура — Claude я разчита">🤖 Разчети фактура (AI)</button>' : ""}
      <button class="btn btn-small btn-primary" id="erp-pu-new">+ Нова фактура</button>
    </div>
    <div class="erp-toolbar" style="margin:0 0 6px">
      <label class="erp-inline">📅 Месец <input type="month" id="pu-month" value="${erpPuMonth || new Date().toISOString().slice(0, 7)}" /></label>
    </div>
    <div class="pay-cards" id="pu-month-cards"></div>
    <p class="hint">Тук се въвеждат входящите фактури (класификация, склад). Плащането им се води в таб <b>💳 Задължения</b> (банковите с отложен срок отиват там автоматично).</p>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№ Фактура</th><th>Доставчик</th><th>Класификация</th><th class="num">Сума (с ДДС)</th><th>Плащане</th><th>Статус</th><th></th></tr></thead>
      <tbody id="pu-tbody"></tbody>
    </table>`;
  const qEl = document.getElementById("pu-q");
  if (qEl) qEl.addEventListener("input", e => { erpPuQuery = e.target.value; erpPuFillRows(); });
  const mEl = document.getElementById("pu-month");
  if (mEl) mEl.addEventListener("change", e => { erpPuMonth = e.target.value; erpPuMonthCards(); });
  erpPuMonthCards();
  document.getElementById("erp-pu-new").addEventListener("click", erpNewPurchase);
  document.getElementById("pu-code-hist").addEventListener("click", () => erpPuCodeHistory(""));
  document.getElementById("pu-dups").addEventListener("click", erpPuDupsReport);
  document.getElementById("pu-bgn").addEventListener("click", erpPuBgnReport);
  document.getElementById("pu-types").addEventListener("click", erpPuTypesReport);
  const aiBtn = document.getElementById("pu-ai");
  if (aiBtn) aiBtn.addEventListener("click", erpPuAIStart);
  const impEl = document.getElementById("pu-import");
  if (impEl) impEl.addEventListener("change", e => { erpPuImport(e.target.files[0]); e.target.value = ""; });
  const clrEl = document.getElementById("pu-clear-import");
  if (clrEl) clrEl.addEventListener("click", erpPuClearImport);
  const clrAll = document.getElementById("pu-clear-all");
  if (clrAll) clrAll.addEventListener("click", erpPuClearAll);
  erpPuFillRows();
}
// Пълни само тялото на таблицата от паметта (за търсене — без заявка към базата).
function erpPuFillRows() {
  const tb = document.getElementById("pu-tbody"); if (!tb) return;
  const q = (erpPuQuery || "").toLowerCase().trim();
  const matchQ = o => !q || (`${o.invoiceNo || ""} ${o.supplierName || ""}`.toLowerCase().includes(q) ||
    (o.lines || []).some(l => `${l.code || ""} ${l.article || ""} ${l.groupName || ""} ${l.name || ""}`.toLowerCase().includes(q)));
  const rows = (erpPurchases || []).filter(matchQ).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const cnt = document.getElementById("pu-count"); if (cnt) cnt.textContent = rows.length + " фактури";
  tb.innerHTML = rows.map(o => {
    const t = erpPuTotals(o);
    const cls = [...new Set((o.lines || []).map(l => l.groupName).filter(Boolean))].slice(0, 2).join(", ");
    return `<tr class="erp-clickable" data-id="${o.id}">
      <td data-label="Дата">${erpDMY(o.date)}</td>
      <td data-label="№ Фактура"><b>${escapeHtml(o.invoiceNo || "—")}</b>${o.docType === "goods" ? ` <span class="erp-co-status" style="background:#fef3c7;color:#92400e">СР${o.coveredByNo ? " ✓ф. " + escapeHtml(o.coveredByNo) : ""}</span>` : ((o.coversIds || []).length ? ` <span class="erp-co-status" style="background:#e0e7ff;color:#3730a3">покрива ${(o.coversIds || []).length} СР</span>` : "")}</td>
      <td data-label="Доставчик">${escapeHtml(o.supplierName || "")}</td>
      <td data-label="Класификация">${o.expenseType ? `<b>${erpPuTypeIsMat(o.expenseType) ? "🧱 " : ""}${escapeHtml(o.expenseType)}</b>${cls ? " · " : ""}` : ""}${escapeHtml(cls || (o.expenseType ? "" : "—"))}</td>
      <td class="num" data-label="Сума">${erpPuMoney(t.total, erpPuCur(o))}</td>
      <td data-label="Плащане">${escapeHtml(erpPuPayLabel(o))}</td>
      <td data-label="Статус">${o.posted ? '<span class="erp-co-status" style="background:#dcfce7;color:#166534">заприходена</span>' : '<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">въведена</span>'}</td>
      <td class="erp-row-actions"><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
    </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">Няма фактури. Натисни „+ Нова фактура".</td></tr>`;
  tb.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenPurchase(b.dataset.open); }));
  tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenPurchase(tr.dataset.id)));
}

/* Нова фактура-разход. По подразбиране е в ЕВРО (BGN остава за избор при
   стари/чуждестранни документи). Ако е подаден образец (seed) — пренася
   доставчика и настройките от предишната, за да се въвеждат бързо една след
   друга; номерът, редовете и файловете НЕ се пренасят. */
function erpNewPurchase(seed) {
  const today = new Date().toISOString().slice(0, 10);
  const s = seed || {};
  erpRenderPurchaseForm({
    type: "фактура", docType: s.docType || "invoice",
    supplierName: s.supplierName || "", supplierId: s.supplierId || null,
    invoiceNo: "", date: s.date || today,
    payStatus: s.payStatus || "deferred", paymentMethod: s.paymentMethod || "Банка",
    termDays: s.termDays || 0, dueDate: "", paid: false, paidDate: "", paidMethod: "",
    currency: s.currency || "EUR", vatRate: s.vatRate != null ? s.vatRate : 20,
    expenseType: s.expenseType || "", note: "", files: [], posted: false, lines: [],
  });
}
function erpOpenPurchase(id) {
  const o = (erpPurchases || []).find(x => String(x.id) === String(id));
  if (o) erpRenderPurchaseForm(JSON.parse(JSON.stringify(o)));
}

/* ---------- Плати ---------- */
async function erpPuMarkPaid(o) {
  const today = new Date().toISOString().slice(0, 10);
  const d = prompt("Дата на плащане (ГГГГ-ММ-ДД):", o.paidDate || today);
  if (d === null) return;
  o.paid = true; o.paidDate = (d || today).trim();
  try { await erpSavePurchase(o); await erpLoadPurchases(); } catch (e) { alert("Грешка: " + (e.message || e)); return; }
  try { if (typeof erpPaySyncFromPurchase === "function") await erpPaySyncFromPurchase(o); } catch (e) {}
  erpRenderPurchases();
}

/* ---------- Форма ---------- */
async function erpRenderPurchaseForm(o) {
  const v = erpView();
  const suppliers = await erpLoadSuppliers();
  const locked = !!o.posted;   // заключва само редовете за склад (заприходените)
  const articles = [...new Set((erpPurchases || []).flatMap(p => (p.lines || []).map(l => l.article)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const hasType = !!o.expenseType;                 // видът разход определя редовете
  const matType = erpPuTypeIsMat(o.expenseType);
  const due = erpPuDueDate(o);
  const st = erpPuPayStatus(o);
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="pu-back">← Назад</button>
      <span class="erp-count">${escapeHtml((o.docType === "goods" ? "Стокова разписка № " : "Фактура № ") + (o.invoiceNo || "")) || "Нов документ"}${o.docType !== "goods" && st === "deferred" && Number(o.termDays) > 0 ? ' · <span class="erp-muted">плащането → Задължения</span>' : ""}${(o.coversIds || []).length ? ` · <span class="erp-muted">покрива ${(o.coversIds || []).length} стокови</span>` : ""}</span>
      ${erpPuStateBadge(o)}
      <span class="spacer"></span>
      <button class="btn btn-small" id="pu-next" title="Записва тази и отваря нова празна фактура със същия доставчик и настройки">➕ Следваща фактура</button>
      <button class="btn btn-small btn-primary" id="pu-save" title="Записва фактурата; ако има редове за склад — веднага ги и заприходява (пита за потвърждение)">${erpPuSaveLabel(o)}</button>
      ${locked
        ? '<button class="btn btn-small btn-danger" id="pu-unpost" title="Връща складовите движения и средните цени, отключва фактурата за поправка. После я заприходи наново.">↩ Върни за редакция</button>'
        : ""}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Доставчик <input type="text" id="pu-supplier" list="pu-suppliers" value="${escapeAttr(o.supplierName || "")}" placeholder="избери или въведи" />
          <datalist id="pu-suppliers">${suppliers.map(s => `<option value="${escapeAttr(s.name)}"></option>`).join("")}</datalist></label>
        <label>Документ <select id="pu-doctype">
          <option value="invoice" ${o.docType !== "goods" ? "selected" : ""}>Фактура</option>
          <option value="goods" ${o.docType === "goods" ? "selected" : ""}>Стокова разписка (доставка)</option>
        </select></label>
        <label>№ ${o.docType === "goods" ? "Стокова" : "Фактура"} <input type="text" id="pu-invoice" value="${escapeAttr(o.invoiceNo || "")}" /></label>
        <label>Дата <input type="date" id="pu-date" value="${escapeAttr(o.date || "")}" /></label>
        <label>Плащане <select id="pu-pay">${PU_PAY_OPTS.map(p => `<option value="${p.k}" ${st === p.k ? "selected" : ""}>${p.label}</option>`).join("")}</select></label>
        <label id="pu-term-wrap" ${st !== "deferred" ? 'style="display:none"' : ""}>Срок (дни) <input type="number" id="pu-term" min="0" value="${escapeAttr(String(o.termDays || 0))}" placeholder="напр. 30" /></label>
        <label id="pu-due-wrap" ${st !== "deferred" ? 'style="display:none"' : ""}>Дата за плащане <input type="date" id="pu-due" value="${escapeAttr(due)}" /></label>
        <label id="pu-paid-wrap" ${st === "deferred" ? 'style="display:none"' : ""}>Платена на <input type="date" id="pu-paiddate" value="${escapeAttr(o.paidDate || "")}" /></label>
        <label>Валута ${erpPuCur(o) === "BGN"
          ? `<span class="pu-cur-old">BGN (стар документ)</span>
             <button type="button" class="btn btn-small" id="pu-cur-eur" title="Разделя цените по редовете на 1.95583 и сменя валутата на EUR">⇄ Превърни в EUR</button>`
          : `<select id="pu-cur" disabled title="Всички покупки се водят в евро"><option selected>EUR</option></select>`}</label>
        <label>ДДС ставка % <select id="pu-vat">${["20", "9", "0"].map(r => `<option value="${r}" ${Number(r) === Number(o.vatRate) ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
        <label>Вид разход <select id="pu-etype"><option value="">— избери —</option>${PU_EXPENSE_TYPES.map(t => `<option value="${escapeAttr(t.k)}" ${t.k === o.expenseType ? "selected" : ""}>${t.mat ? "🧱 " : ""}${escapeHtml(t.k)}</option>`).join("")}</select></label>
      </div>
      ${o.docType === "goods"
        ? '<p class="hint" style="margin:4px 0">📦 <b>Стокова разписка:</b> заприходява склада ВЕДНАГА, но НЕ влиза в разходите и плащанията — парите идват с месечната фактура, която я покрива.</p>'
        : `<div class="erp-co-actions" style="margin:4px 0"><button class="btn btn-small" id="pu-covers" title="Фактура в края на месеца, покриваща доставени със стокови разписки количества: складът НЕ се пипа втори път — само сумата за плащане">🧾 Покрива стокови… ${(o.coversIds || []).length ? "(" + (o.coversIds || []).length + ")" : ""}</button>${(o.coversIds || []).length ? '<span class="erp-muted">складът е вдигнат от стоковите — тази фактура носи само парите</span>' : ""}</div>`}
      <label class="erp-co-note">Забележка <textarea id="pu-note" rows="2">${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">📎 Файл на фактурата</h4>
      <div class="erp-co-files"><div id="pu-files-list">${erpPuFilesHtml(o)}</div>
        <label class="btn btn-small co-attach-btn">⬆ Прикачи файл<input type="file" id="pu-file-input" multiple hidden /></label>
        <span class="erp-muted" id="pu-file-status"></span></div>

      <h4 class="erp-group-head">Редове${hasType ? ` <span class="erp-muted">— ${matType ? "🧱 " : ""}${escapeHtml(o.expenseType)}</span>` : ""}</h4>
      ${hasType ? "" : '<p class="hint">⬆ Добре е да избереш <b>Вид разход</b> (класификацията за счетоводството): 🧱 материален вид → редове с нашите кодове от склада (заприходяват се); останалите → редове разход/услуга. Може и без него — просто добави ред.</p>'}
      ${true ? `<table class="report-table erp-table" id="pu-lines">
        <thead><tr><th>Артикул</th><th>Код</th><th class="num">Кол.</th><th>МЕ</th><th class="num">Ед. цена</th><th title="ДДС на реда — за фактури със смесени ставки">ДДС %</th><th class="num">Сума</th><th></th></tr></thead>
        <tbody>${erpPuLinesHtml(o, locked)}</tbody>
      </table>` : ""}
      <div class="erp-co-actions">
        ${matType
          ? '<button class="btn btn-small btn-primary" id="pu-add-mat">+ Материал — наш код (склад)</button><button class="btn btn-small" id="pu-add-exp" title="Ред от фактурата, който не влиза в склада (услуга, транспорт по нея и т.н.)">+ Добави ред (без склад)</button>'
          : '<button class="btn btn-small btn-primary" id="pu-add-exp">+ Добави ред (разход/услуга)</button><button class="btn btn-small" id="pu-add-mat" title="Ако фактурата носи и стока за склада">+ Материал (склад)</button>'}
      </div>
      ${erpPuProfileChipsHtml(o)}
      <datalist id="pu-articles">${articles.map(a => `<option value="${escapeAttr(a)}"></option>`).join("")}</datalist>
      <div class="erp-sale-totals" id="pu-totals"></div>
      <p class="hint">„Материал (склад)" се брои при заприходяване (вдига наличност + средна цена). „Разход/услуга" се класифицира и плаща, но не влиза в склада. Средните цени се водят в EUR — BGN се превръща авт.</p>
    </div>`;

  const dtSel = document.getElementById("pu-doctype");
  if (dtSel) dtSel.addEventListener("change", () => { o.docType = dtSel.value === "goods" ? "goods" : "invoice"; erpRenderPurchaseForm(o); });
  const cvBtn = document.getElementById("pu-covers");
  if (cvBtn) cvBtn.addEventListener("click", () => erpPuCoversDialog(o));
  const bind = (id, k, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("input", () => { o[k] = el.value; if (fn) fn(); }); };
  bind("pu-invoice", "invoiceNo"); bind("pu-date", "date", () => erpPuSyncDue(o)); bind("pu-note", "note");
  bind("pu-term", "termDays", () => erpPuSyncDue(o)); bind("pu-due", "dueDate");
  const pd = document.getElementById("pu-paiddate"); if (pd) pd.addEventListener("input", () => o.paidDate = pd.value);
  document.getElementById("pu-supplier").addEventListener("input", e => { o.supplierName = e.target.value; const m = suppliers.find(s => s.name === e.target.value); o.supplierId = m ? m.id : null; });
  // Самообучение: при избор на познат доставчик — попълва плащане/валута/ДДС от историята + показва честите артикули.
  document.getElementById("pu-supplier").addEventListener("change", e => {
    const prof = erpPuSupplierProfile(e.target.value);
    if (prof && erpPuApplyProfile(o, prof)) erpRenderPurchaseForm(o);
  });
  document.getElementById("pu-pay").addEventListener("change", e => { o.payStatus = e.target.value; erpPuApplyPay(o); erpRenderPurchaseForm(o); });
  const curEur = document.getElementById("pu-cur-eur");
  if (curEur) curEur.addEventListener("click", () => {
    if (!confirm(`Да превърна ли документа в ЕВРО?\n\nВсяка цена по редовете се дели на ${PU_EUR_BGN} (официалният курс), а валутата става EUR.\nПравѝ го само ако сумите в него са в лева.`)) return;
    (o.lines || []).forEach(l => {
      const p = erpToNum(l.unitPrice);
      if (p) l.unitPrice = Math.round((p / PU_EUR_BGN) * 10000) / 10000;
    });
    o.currency = "EUR";
    erpRenderPurchaseForm(o);
  });
  document.getElementById("pu-vat").addEventListener("change", e => { o.vatRate = Number(e.target.value); erpPuTotalsBox(o); });
  document.getElementById("pu-etype").addEventListener("change", e => {
    const old = o.expenseType; o.expenseType = e.target.value;
    // Класификацията на нематериалните редове следва вида разход.
    (o.lines || []).forEach(l => { if (!l.materialId && (!l.groupName || l.groupName === old)) l.groupName = o.expenseType; });
    erpRenderPurchaseForm(o);   // редовете/бутоните се пренареждат според вида
  });
  document.getElementById("pu-back").addEventListener("click", erpRenderPurchases);
  document.getElementById("pu-save").addEventListener("click", () => erpPuSaveClick(o));
  document.getElementById("pu-next").addEventListener("click", () => erpPuSaveClick(o, { next: true }));
  const unpostBtn = document.getElementById("pu-unpost"); if (unpostBtn) unpostBtn.addEventListener("click", () => erpUnpostPurchase(o));
  const addMat = document.getElementById("pu-add-mat"); if (addMat) addMat.addEventListener("click", () => erpPuAddMaterial(o));
  const addExp = document.getElementById("pu-add-exp"); if (addExp) addExp.addEventListener("click", () => { o.lines.push({ groupName: o.expenseType || "", article: "", code: "", batch: "", qty: 1, unit: "бр.", unitPrice: "" }); erpPuRefreshFull(o); });
  const fi = document.getElementById("pu-file-input"); if (fi) fi.addEventListener("change", e => erpPuAttachFiles(o, e.target.files));
  const fl = document.getElementById("pu-files-list"); if (fl) fl.addEventListener("click", e => { const rm = e.target.closest("[data-pufrm]"); if (rm) { e.preventDefault(); erpPuRemoveFile(o, Number(rm.dataset.pufrm)); } });
  erpPuWireLines(o, locked);
  erpPuWireProfileChips(o);
  erpPuTotalsBox(o);
}
function erpPuSyncDue(o) {
  o.dueDate = "";   // изчисти ръчната, за да се преизчисли авто
  const el = document.getElementById("pu-due"); if (el) el.value = erpPuDueDate(o);
}

function erpPuLinesHtml(o, locked) {
  return (o.lines || []).map((l, i) => {
    const isMat = !!l.materialId;
    const ro = locked && isMat;   // заприходените материални редове са заключени
    return `<tr>
      <td data-label="Артикул">${ro ? escapeHtml(l.article || l.name || "") : `<input type="text" class="pu-art" data-i="${i}" list="pu-articles" value="${escapeAttr(l.article || l.name || "")}" style="width:150px" />`}</td>
      <td data-label="Код">${escapeHtml(l.code || "")}${isMat ? ' <span class="erp-muted">склад</span>' : ""}</td>
      <td class="num" data-label="Кол.">${ro ? erpNum(l.qty) : `<input type="number" class="pu-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:80px" />`}</td>
      <td data-label="МЕ">${ro ? escapeHtml(l.unit || "") : `<input type="text" class="pu-unit" data-i="${i}" value="${escapeAttr(l.unit || "бр.")}" style="width:52px" />`}</td>
      <td class="num" data-label="Ед. цена">${ro ? erpNum(l.unitPrice) : `<input type="number" class="pu-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:90px" placeholder="—" />`}</td>
      <td data-label="ДДС %">${ro ? erpPuLineVat(o, l) + "%" : `<select class="pu-lvat" data-i="${i}" title="ДДС за ТОЗИ ред. „по документа" = общата ставка. Така една фактура може да има ред с ДДС и ред без.">
        <option value="" ${(l.vatRate === undefined || l.vatRate === null || l.vatRate === "") ? "selected" : ""}>по док. (${Number(o.vatRate != null ? o.vatRate : 20)}%)</option>
        ${["20", "9", "0"].map(r => `<option value="${r}" ${String(l.vatRate) === r ? "selected" : ""}>${r}%</option>`).join("")}
      </select>`}</td>
      <td class="num" data-label="Сума">${erpPuMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpPuCur(o))}</td>
      <td class="erp-row-actions">${ro ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">Няма редове. Добави материал или разход.</td></tr>`;
}
function erpPuWireLines(o, locked) {
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  const line = el => o.lines[Number(el.dataset.i)];
  body.querySelectorAll(".pu-art").forEach(el => el.addEventListener("input", () => line(el).article = el.value));
  body.querySelectorAll(".pu-unit").forEach(el => el.addEventListener("input", () => line(el).unit = el.value));
  body.querySelectorAll(".pu-qty").forEach(el => el.addEventListener("input", () => { line(el).qty = erpToNum(el.value); erpPuLineSums(o); }));
  body.querySelectorAll(".pu-price").forEach(el => el.addEventListener("input", () => { line(el).unitPrice = erpToNum(el.value); erpPuLineSums(o); }));
  body.querySelectorAll(".pu-lvat").forEach(el => el.addEventListener("change", () => { const l = line(el); if (el.value === "") delete l.vatRate; else l.vatRate = Number(el.value); erpPuTotalsBox(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpPuRefreshFull(o); }));
}
function erpPuLineSums(o) {
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => { const l = (o.lines || [])[i]; if (!l) return; const c = tr.querySelector('td[data-label="Сума"]'); if (c) c.textContent = erpPuMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpPuCur(o)); });
  erpPuTotalsBox(o);
}
function erpPuRefreshFull(o) { const body = document.querySelector("#pu-lines tbody"); if (body) { body.innerHTML = erpPuLinesHtml(o, !!o.posted); erpPuWireLines(o, !!o.posted); } erpPuTotalsBox(o); const sbtn = document.getElementById("pu-save"); if (sbtn && !sbtn.disabled) sbtn.textContent = erpPuSaveLabel(o); }
function erpPuTotalsBox(o) {
  const box = document.getElementById("pu-totals"); if (!box) return;
  const t = erpPuTotals(o); const cur = erpPuCur(o);
  const eur = cur === "BGN" ? ` <span class="erp-muted">≈ ${erpPuMoney(t.total / PU_EUR_BGN, "EUR")}</span>` : "";
  const vatRows = t.mixed
    ? (t.rates || []).map(r => `<tr><td>ДДС ${r}% <span class="erp-muted">(основа ${erpPuMoney(t.byRate[r], cur)})</span></td><td class="num">${erpPuMoney((t.byRate[r] || 0) * r / 100, cur)}</td></tr>`).join("")
    : `<tr><td>ДДС ${t.rate}%</td><td class="num">${erpPuMoney(t.vat, cur)}</td></tr>`;
  box.innerHTML = `<table class="erp-sale-sum">
    <tr><td>Данъчна основа</td><td class="num">${erpPuMoney(t.base, cur)}</td></tr>
    ${vatRows}
    ${t.mixed ? `<tr><td class="erp-muted">Σ ДДС (смесени ставки)</td><td class="num">${erpPuMoney(t.vat, cur)}</td></tr>` : ""}
    <tr class="grand"><td><b>Общо с ДДС</b></td><td class="num"><b>${erpPuMoney(t.total, cur)}${eur}</b></td></tr></table>`;
}

/* ---------- Самообучение от историята ----------
   Системата чете вече въведените покупки на доставчика и вади „профил":
   как обичайно се плаща (отложено/в брой/карта, колко дни), валута, ДДС и
   кои артикули купуваме най-често от него (с последна цена). Няма отделна
   база — всяка нова фактура автоматично „дообучава", защото влиза в историята. */
function erpPuSupplierProfile(name) {
  const nm = String(name || "").trim().toLowerCase();
  if (!nm) return null;
  const mine = (erpPurchases || []).filter(p => String(p.supplierName || "").trim().toLowerCase() === nm)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  if (!mine.length) return null;
  const last = mine[0];
  // Най-чести артикули (с последната им цена и класификация).
  const arts = {};
  mine.forEach(p => (p.lines || []).forEach(l => {
    const key = (l.article || l.name || "").trim(); if (!key) return;
    const a = arts[key] || (arts[key] = { article: key, group: l.groupName || "", unit: l.unit || "бр.", code: l.code || "", materialId: l.materialId || null, price: 0, n: 0, lastDate: "" });
    a.n++;
    if (String(p.date || "") >= a.lastDate) { a.lastDate = p.date || ""; if (erpToNum(l.unitPrice)) a.price = erpToNum(l.unitPrice); if (l.groupName) a.group = l.groupName; }
  }));
  const topArticles = Object.values(arts).sort((a, b) => b.n - a.n).slice(0, 8);
  return {
    count: mine.length,
    payStatus: erpPuPayStatus(last), termDays: Number(last.termDays) || 0,
    currency: last.currency || "EUR", vatRate: last.vatRate != null ? last.vatRate : 20,
    expenseType: (mine.find(p => p.expenseType) || {}).expenseType || "",
    topArticles,
  };
}
// Прилага профила върху НОВА фактура (не пипа отворена стара) и казва какво е попълнил.
function erpPuApplyProfile(o, prof) {
  if (!prof || o.id) return false;
  o.payStatus = prof.payStatus; o.termDays = prof.termDays;
  o.currency = prof.currency; o.vatRate = prof.vatRate;
  if (!o.expenseType && prof.expenseType) o.expenseType = prof.expenseType;   // видът разход от историята
  erpPuApplyPay(o);
  return true;
}
function erpPuProfileChipsHtml(o) {
  const prof = erpPuSupplierProfile(o.supplierName);
  if (!prof || !prof.topArticles.length) return "";
  return `<div class="pu-learn" id="pu-learn-box">
    <span class="pu-learn-lbl" title="От ${prof.count} предишни фактури на този доставчик">🧠 Често купуваме от ${escapeHtml(o.supplierName)}:</span>
    ${prof.topArticles.map((a, i) => `<button type="button" class="btn btn-small pu-learn-chip" data-chip="${i}" title="${a.n}× досега${a.price ? " · последна цена " + erpNum(a.price) : ""}${a.group ? " · " + escapeAttr(a.group) : ""}">+ ${escapeHtml(a.article)}${a.price ? ` <span class="erp-muted">${erpNum(a.price)}</span>` : ""}</button>`).join("")}
  </div>`;
}
function erpPuWireProfileChips(o) {
  const box = document.getElementById("pu-learn-box"); if (!box) return;
  const prof = erpPuSupplierProfile(o.supplierName); if (!prof) return;
  box.querySelectorAll("[data-chip]").forEach(b => b.addEventListener("click", () => {
    const a = prof.topArticles[Number(b.dataset.chip)]; if (!a) return;
    o.lines.push({ materialId: a.materialId || undefined, groupName: a.group, article: a.article, name: a.article, code: a.code, qty: 1, unit: a.unit, unitPrice: a.price || "" });
    erpPuRefreshFull(o);
  }));
}

function erpPuAddMaterial(o) {
  const { wrap, close } = erpDialog(`
    <h3>Добави материал (влиза в склада)</h3>
    <input type="search" id="pu-pp-q" placeholder="търси код или име…" />
    <div id="pu-pp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="pu-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#pu-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.materials.slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(m => `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">${escapeHtml(m.unit || "")}${m.avg_cost ? " · " + erpEur(m.avg_cost) : ""}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const m = ERP.matById[Number(b.dataset.id)];
      o.lines.push({ materialId: m.id, code: m.code, name: m.name, article: m.name, groupName: m.group_name || o.expenseType || "", unit: m.unit, qty: 1, unitPrice: "" });
      close(); erpPuRefreshFull(o);
    }));
  };
  render(""); wrap.querySelector("#pu-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#pu-pp-cancel").addEventListener("click", close);
}

/* ---------- Файлове ---------- */
function erpPuFilesHtml(o) {
  const files = (o && o.files) || [];
  if (!files.length) return `<p class="erp-muted" style="margin:0 0 6px">Няма прикачен файл. Прикачи сканираната фактура (PDF/снимка).</p>`;
  return `<ul class="co-file-ul">${files.map((f, i) => `<li><a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener">📄 ${escapeHtml(f.name || "файл")}</a> <button type="button" class="btn btn-small btn-danger" data-pufrm="${i}">×</button></li>`).join("")}</ul>`;
}
async function erpPuAttachFiles(o, fileList) {
  const files = Array.from(fileList || []); if (!files.length) return;
  const st = document.getElementById("pu-file-status");
  if (!o.id) { if (st) st.textContent = "Записвам…"; try { await erpSavePurchase(o); } catch (e) { alert("Първо запази фактурата: " + (e.message || e)); return; } }
  o.files = o.files || [];
  for (const file of files) {
    if (st) st.textContent = "Качвам „" + file.name + "“…";
    const path = `purchases/${o.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    o.files.push({ name: file.name, type: file.type, path, url: data.publicUrl });
  }
  try { await erpSavePurchase(o); } catch (e) {}
  if (st) st.textContent = "";
  const list = document.getElementById("pu-files-list"); if (list) list.innerHTML = erpPuFilesHtml(o);
  const inp = document.getElementById("pu-file-input"); if (inp) inp.value = "";
}
async function erpPuRemoveFile(o, i) {
  const f = (o.files || [])[i]; if (!f) return;
  if (!confirm(`Да махна ли „${f.name || ""}"?`)) return;
  if (f.path) { try { await sb.storage.from(BUCKET).remove([f.path]); } catch (e) {} }
  o.files.splice(i, 1);
  try { await erpSavePurchase(o); } catch (e) {}
  const list = document.getElementById("pu-files-list"); if (list) list.innerHTML = erpPuFilesHtml(o);
}

/* Един бутон за запис и заприходяване: има ли редове за склад (или покривани
   стокови) — записът продължава направо със заприходяването; иначе само пише. */
function erpPuNeedsPost(o) {
  if (o.posted) return false;
  if (o.docType !== "goods" && (o.coversIds || []).length) return true;   // покриваща фактура (само парите)
  return (o.lines || []).some(l => l.materialId && (erpToNum(l.qty) || 0) > 0);
}
function erpPuSaveLabel(o) { return erpPuNeedsPost(o) ? "💾 Запази и заприходи" : "💾 Запази"; }
/* Ясно на един поглед докъде е документът: нов / записан / заприходен. */
function erpPuStateBadge(o) {
  if (o.posted) {
    const d = o.postedAt ? " · " + erpDMY(String(o.postedAt).slice(0, 10)) : "";
    return `<span class="pu-state ok" title="Материалните редове са вдигнати в Склад материали и средните цени са обновени">✅ ЗАПРИХОДЕНА в склада${d}</span>`;
  }
  if (!o.id) return `<span class="pu-state new">🆕 нова — още не е записана</span>`;
  return erpPuNeedsPost(o)
    ? `<span class="pu-state warn" title="Записана е, но материалните ѝ редове още не са влезли в склада">💾 записана · ⏳ НЕ е заприходена</span>`
    : `<span class="pu-state" title="Само разход — няма материални редове за склада">💾 записана</span>`;
}
/* Какво следва след успешен запис: остава, тръгва към следваща или към списъка.
   Казва ЯСНО дали е само записана, или е и заприходена в склада. */
function erpPuAfterSave(o, posted) {
  const money = erpPuMoney(erpPuTotals(o).total, erpPuCur(o));
  const { wrap, close } = erpDialog(`
    <h3>${posted ? "✅ Заприходена в склада" : "💾 Записана"}</h3>
    <p class="hint">${posted
      ? "Материалните редове са вдигнати в Склад материали и средните цени са обновени."
      : (erpPuNeedsPost(o)
        ? `⏳ Документът е записан, но материалните му редове ОЩЕ НЕ са в склада. Натисни бутона „💾 Запази и заприходи“, когато си готов.`
        : "Документът е записан. Няма материални редове — складът не се пипа.")}</p>
    <p><b>${escapeHtml((o.docType === "goods" ? "Стокова № " : "Фактура № ") + (o.invoiceNo || "—"))}</b> · ${escapeHtml(o.supplierName || "")} · ${escapeHtml(erpDMY(o.date) || "")} · <b>${money}</b></p>
    ${(typeof suppHasProfile === "function" && o.supplierName && !suppHasProfile(o.supplierName))
      ? `<div class="supp-newbar" style="margin:8px 0 0">🆕 <b>${escapeHtml(o.supplierName)}</b> няма попълнен паспорт за счетоводството.
           <span class="spacer" style="flex:1"></span>
           <button class="btn btn-small" id="pu-as-later" title="Оставя го като напомняне — стои като брояч на таб „🏷 Паспорти доставчици“, докато не се попълни">🔔 Напомни ми</button>
           <button class="btn btn-small btn-primary" id="pu-as-supp">🏷 Попълни го сега</button></div>`
      : ""}
    <div class="erp-dialog-actions">
      <button class="btn" id="pu-as-stay">✎ Остани в тази</button>
      <button class="btn" id="pu-as-list">← Към списъка</button>
      <button class="btn btn-primary" id="pu-as-next">➕ Въведи следваща</button>
    </div>`);
  const supBtn = wrap.querySelector("#pu-as-supp");
  if (supBtn) supBtn.addEventListener("click", () => { close(); if (typeof suppForm === "function") suppForm(o.supplierName); });
  const laterBtn = wrap.querySelector("#pu-as-later");
  if (laterBtn) laterBtn.addEventListener("click", () => {
    close();
    if (typeof suppUpdateBadge === "function") suppUpdateBadge();
    alert(`🔔 Записано.\n\n„${o.supplierName}" стои като напомняне на таб „🏷 Паспорти доставчици" — броячът свети, докато паспортът не се попълни.`);
  });
  wrap.querySelector("#pu-as-stay").addEventListener("click", close);
  wrap.querySelector("#pu-as-list").addEventListener("click", () => { close(); erpRenderPurchases(); });
  wrap.querySelector("#pu-as-next").addEventListener("click", () => { close(); erpNewPurchase(o); });
}

async function erpPuSaveClick(o, opts) {
  const btn = document.getElementById("pu-save");
  // Дубликат по № на фактурата — предупреждение още при записа.
  if (!o.posted && o.invoiceNo) {
    const dup = erpPuDupsOf(o).find(p => erpPuEq(p.supplierName) === erpPuEq(o.supplierName)) || erpPuDupsOf(o)[0];
    if (dup && !confirm(`⚠ Фактура № ${o.invoiceNo} ВЕЧЕ е въведена: ${dup.supplierName || "?"} · ${erpDMY(dup.date) || "?"} · ${dup.posted ? "ЗАПРИХОДЕНА" : "чернова"}.\nАко това е СЪЩАТА фактура — спри и провери в списъка.\nДа запиша ли въпреки това ВТОРИ запис?`)) return;
  }
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  // Паспортите на доставчиците — за подсещането „нов доставчик без картон".
  try { if (typeof suppEnsureLoaded === "function") await suppEnsureLoaded(); } catch (e) {}
  erpPuApplyPay(o);   // синхронизира paid/срок/дата според избрания статус на плащане
  try {
    await erpSavePurchase(o); await erpLoadPurchases();
    try { if (typeof erpPaySyncFromPurchase === "function") await erpPaySyncFromPurchase(o); } catch (e) {}   // Банка+срок → Задължения
    if (erpPuNeedsPost(o)) {
      await erpPostPurchase(o, { silent: true });   // пита за потвърждение; при успех пре-рендира формата
      const b2 = document.getElementById("pu-save");
      if (b2) { b2.disabled = false; b2.textContent = erpPuSaveLabel(o); }
      if (typeof suppUpdateBadge === "function") suppUpdateBadge();
      if (opts && opts.next) erpNewPurchase(o); else erpPuAfterSave(o, !!o.posted);
      return;
    }
    if (btn) { btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) { btn.textContent = erpPuSaveLabel(o); btn.disabled = false; } }, 1400); }
    if (typeof suppUpdateBadge === "function") suppUpdateBadge();
    if (opts && opts.next) erpNewPurchase(o); else erpPuAfterSave(o, false);
  }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = erpPuSaveLabel(o); } alert("Грешка при запис: " + (e.message || e)); }
}

/* ---------- Импорт на разходи от GenCloud (xlsx) ----------
   Сумите в експорта са отрицателни (разход) → вкарват се положителни.
   Колони: №: · Дата · Артикул · Партньор · Кол. · Кр.цена · Кр.цена (мярка=валута) ·
   Кр.цена с ДДС · ДДС сума · Плащане (веднага / N дни / дата на падеж).
   Редовете се групират в една фактура по № + партньор + дата; всеки ред → клас. ред.
   „Плащане" определя статуса: веднага/в брой → платена; N дни/дата → отложено → Задължения. */
function puXlsNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function puXlsAbs(v) { return Math.abs(puXlsNum(v)); }
function puXlsDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && typeof XLSX !== "undefined" && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return "";
}
// Разчита колоната „Плащане": веднага/в брой/карта → платена; N дни или дата → отложено.
function puParsePay(s, docDate) {
  s = String(s || "").trim().toLowerCase();
  if (!s || /веднага|в\s*брой|кеш|платен|плати\s*се/.test(s)) {
    if (/брой|кеш/.test(s)) return { payStatus: "cash", termDays: 0, dueDate: "" };
    if (/карт/.test(s)) return { payStatus: "card", termDays: 0, dueDate: "" };
    return { payStatus: "bank", termDays: 0, dueDate: "" };
  }
  let m = s.match(/(\d+)\s*дн/); if (m) return { payStatus: "deferred", termDays: Number(m[1]), dueDate: "" };
  const due = puXlsDate(s);
  if (due) { const t = docDate ? Math.round((new Date(due + "T00:00:00") - new Date(docDate + "T00:00:00")) / 864e5) : 0; return { payStatus: "deferred", termDays: t > 0 ? t : 0, dueDate: due }; }
  m = s.match(/^\d+$/); if (m) return { payStatus: "deferred", termDays: Number(s), dueDate: "" };
  return { payStatus: "deferred", termDays: 0, dueDate: "" };
}
async function erpPuImport(file) {
  if (!file) return;
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!raw.length) { alert("Файлът е празен."); return; }
    const pick = (row, ...names) => { for (const n of names) { for (const k of Object.keys(row)) { if (String(k).trim().toLowerCase() === n.toLowerCase()) return row[k]; } } return ""; };
    await erpLoadPurchases();

    // Групиране по фактура: № + партньор + дата.
    const groups = new Map();
    raw.forEach(r => {
      const invoiceNo = String(pick(r, "№:", "№", "No", "Номер") || "").trim();
      const supplier = String(pick(r, "Партньор", "Доставчик", "Контрагент") || "").trim();
      const date = puXlsDate(pick(r, "Дата", "Дата на док.", "Дата на документ"));
      if (!invoiceNo && !supplier) return;
      const key = invoiceNo + "|" + supplier + "|" + date;
      if (!groups.has(key)) groups.set(key, {
        invoiceNo, supplier, date,
        pay: String(pick(r, "Плащане") || "").trim(),
        currency: String(pick(r, "Кр.цена (мярка)", "Валута") || "").trim().toUpperCase() || "EUR",
        note: String(pick(r, "Бележка към док.", "Бележка") || "").trim(),
        net: 0, vat: 0, lines: [],
      });
      const g = groups.get(key);
      if (!g.pay) g.pay = String(pick(r, "Плащане") || "").trim();
      const qty = puXlsNum(pick(r, "Кол.", "Количество")) || 1;
      const rowNet = puXlsAbs(pick(r, "Кр.цена"));
      const rowVat = puXlsAbs(pick(r, "ДДС сума"));
      g.net += rowNet; g.vat += rowVat;
      g.lines.push({
        groupName: "", code: "",
        article: String(pick(r, "Артикул", "Описание") || "").trim() || "разход",
        qty, unit: "бр.", unitPrice: qty ? Math.round((rowNet / qty) * 100) / 100 : rowNet,
      });
    });
    if (!groups.size) { alert("Не намерих редове с фактура/партньор в файла."); return; }

    // Дедуп „само липсващите": първо по НОМЕРА на фактурата (нормализиран —
    // хваща и ръчно въведените с другояче изписан доставчик), после по № + доставчик.
    const puNorm = s => String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
    const existingNo = new Set();
    const existing = new Set();
    (erpPurchases || []).forEach(p => {
      const k = puNorm(p.invoiceNo);
      if (k) existingNo.add(k);
      existing.add(`${(p.invoiceNo || "").trim()}|${(p.supplierName || "").trim()}`);
    });
    let added = 0, skipped = 0;
    for (const g of groups.values()) {
      const gk = puNorm(g.invoiceNo);
      if ((gk && existingNo.has(gk)) || existing.has(`${g.invoiceNo}|${g.supplier}`)) { skipped++; continue; }
      const rate = g.net > 0 ? g.vat / g.net * 100 : 20;
      const vatRate = [20, 9, 0].reduce((b, r) => Math.abs(r - rate) < Math.abs(b - rate) ? r : b, 20);
      const pp = puParsePay(g.pay, g.date);
      const o = {
        type: "фактура", supplierName: g.supplier, supplierId: null, invoiceNo: g.invoiceNo,
        date: g.date, currency: g.currency === "BGN" ? "BGN" : "EUR", vatRate,
        note: g.note, files: [], posted: false, lines: g.lines,
        payStatus: pp.payStatus, termDays: pp.termDays, dueDate: pp.dueDate,
        paid: false, paidDate: "", paidMethod: "", imported: true,
      };
      erpPuApplyPay(o);
      // NB: импортираните разходи са само регистър/архив — НЕ ги пращаме в „Задължения"
      // (те вече са отразени там през отделния GenCloud импорт на задълженията).
      try {
        await erpSavePurchase(o);
        existing.add(`${g.invoiceNo}|${g.supplier}`);
        if (gk) existingNo.add(gk);
        added++;
      } catch (e) { /* пропусни проблемния запис */ }
    }
    await erpLoadPurchases();
    erpRenderPurchases();
    alert(`Импорт готов: ${added} нови фактури${skipped ? `, ${skipped} пропуснати (вече въведени)` : ""}.\nСлужат само за регистър/архив — не се дублират в „Задължения".`);
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}
// Пълно изчистване на Покупки — трие ВСИЧКИ фактури (и ръчните, и импортите).
async function erpPuClearAll() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpLoadPurchases();
  const n = (erpPurchases || []).length;
  if (!n) { alert("Няма фактури за изтриване."); return; }
  const posted = (erpPurchases || []).filter(p => p.posted).length;
  if (!confirm(`Да изтрия ли ВСИЧКИ ${n} фактури от Покупки — и ръчно въведените, и импортираните?` +
    (posted ? `\n\n⚠ ВНИМАНИЕ: ${posted} от тях са ОСЧЕТОВОДЕНИ. Изтриването на записа НЕ връща заприходения материал от склада! Ако складът трябва да се коригира, първо ползвай „↩ Върни за редакция" на съответните фактури.` : "") +
    `\n\nТова не може да се върне.`)) return;
  if (!confirm("Последно потвърждение: изтривам ВСИЧКО от Покупки?")) return;
  const { error } = await sb.from("purchases").delete().gte("id", 0);
  if (error) { alert("Грешка при изтриване: " + error.message); return; }
  await erpLoadPurchases();
  erpRenderPurchases();
  alert("Готово. Покупките са изчистени — можеш да качиш наново.");
}

// Изтегля (изтрива) всички импортирани фактури — ръчно въведените остават.
async function erpPuClearImport() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  const imp = (erpPurchases || []).filter(p => p.imported);
  if (!imp.length) { alert("Няма импортирани фактури за изтегляне."); return; }
  if (!confirm(`Да изтегля (изтрия) ли ${imp.length} импортирани фактури?\nРъчно въведените остават непокътнати.`)) return;
  let del = 0;
  for (const p of imp) {
    try { const { error } = await sb.from("purchases").delete().eq("id", p.id); if (!error) del++; } catch (e) {}
  }
  await erpLoadPurchases();
  erpRenderPurchases();
  alert(`Изтеглени ${del} импортирани фактури. Можеш да импортираш наново.`);
}

/* ---------- История на цените по код ---------- */
function erpPuCodeHistory(preCode) {
  const rows = [];
  (erpPurchases || []).forEach(o => (o.lines || []).forEach(l => { if (l.code) rows.push({ code: l.code, article: l.article || l.name || "", date: o.date || "", supplier: o.supplierName || "", qty: erpToNum(l.qty) || 0, price: erpToNum(l.unitPrice) || 0, cur: erpPuCur(o), inv: o.invoiceNo || "" }); }));
  const { wrap, close } = erpDialog(`
    <h3>💹 История на цените по артикул</h3>
    <input type="search" id="puh-q" value="${escapeAttr(preCode || "")}" placeholder="код или име на артикул…" />
    <div id="puh-list" style="max-height:60vh;overflow:auto;margin-top:8px"></div>
    <div class="erp-dialog-actions"><button class="btn" id="puh-close">Затвори</button></div>`);
  const listEl = wrap.querySelector("#puh-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let r = rows.filter(x => !q || (`${x.code} ${x.article}`.toLowerCase().includes(q)));
    r.sort((a, b) => a.code.localeCompare(b.code) || String(b.date).localeCompare(String(a.date)));
    listEl.innerHTML = r.length ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Артикул</th><th>Дата</th><th>Доставчик</th><th class="num">Кол.</th><th class="num">Ед. цена</th><th>№</th></tr></thead>
      <tbody>${r.slice(0, 200).map(x => `<tr><td><b>${escapeHtml(x.code)}</b></td><td>${escapeHtml(x.article)}</td><td>${erpDMY(x.date)}</td><td>${escapeHtml(x.supplier)}</td><td class="num">${erpNum(x.qty)}</td><td class="num">${erpPuMoney(x.price, x.cur)}</td><td>${escapeHtml(x.inv)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="report-empty">Няма съвпадения.</p>`;
  };
  render(preCode || ""); wrap.querySelector("#puh-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#puh-close").addEventListener("click", close);
}

/* ---------- Разходи по вид (месечен преглед + експорт за счетоводството) ---------- */
let puTypesMonth = null;   // "YYYY-MM"
function erpPuTypesReport() {
  if (!puTypesMonth) puTypesMonth = new Date().toISOString().slice(0, 7);
  const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
  const label = ym => { const [y, m] = ym.split("-").map(Number); return MONTHS[m - 1] + " " + y; };
  const shift = (ym, d) => { const [y, m] = ym.split("-").map(Number); const dt = new Date(y, m - 1 + d, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`; };
  const eur = n => (Math.round(n * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const monthRows = ym => (erpPurchases || []).filter(p => String(p.date || "").slice(0, 7) === ym);
  const calc = ym => {
    const byType = {};
    let tBase = 0, tVat = 0, tTotal = 0;
    monthRows(ym).forEach(p => {
      const t = erpPuTotals(p);
      const rate = erpPuCur(p) === "BGN" ? PU_EUR_BGN : 1;
      const key = p.expenseType || "— без вид —";
      const g = byType[key] || (byType[key] = { type: key, n: 0, base: 0, vat: 0, total: 0 });
      g.n++; g.base += t.base / rate; g.vat += t.vat / rate; g.total += t.total / rate;
      tBase += t.base / rate; tVat += t.vat / rate; tTotal += t.total / rate;
    });
    // Подреждане: по реда на официалния списък, „без вид" накрая.
    const order = PU_EXPENSE_TYPES.map(t => t.k);
    const rows = Object.values(byType).sort((a, b) => {
      const ia = order.indexOf(a.type), ib = order.indexOf(b.type);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return { rows, tBase, tVat, tTotal, count: monthRows(ym).length };
  };

  const { wrap, close } = erpDialog(`
    <h3>📊 Разходи по вид</h3>
    <div class="erp-toolbar" style="margin-bottom:6px">
      <button class="btn btn-small" id="pt-prev">‹</button>
      <b id="pt-title" style="min-width:150px;text-align:center"></b>
      <button class="btn btn-small" id="pt-next">›</button>
      <span class="spacer"></span>
      <button class="btn btn-small" id="pt-xls-types">⤓ По видове (Excel)</button>
      <button class="btn btn-small btn-primary" id="pt-xls-inv">⤓ Всички фактури (Excel)</button>
    </div>
    <div id="pt-body" style="max-height:60vh;overflow:auto"></div>
    <p class="hint" style="margin:6px 0 0">🧱 = материален разход (влиза в склада при заприходяване). Сумите са в EUR (BGN по 1.95583). Експортът „Всички фактури" е за счетоводството — ред за всяка фактура.</p>
    <div class="erp-dialog-actions"><button class="btn" id="pt-close">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  const render = () => {
    wrap.querySelector("#pt-title").textContent = label(puTypesMonth);
    const c = calc(puTypesMonth);
    wrap.querySelector("#pt-body").innerHTML = `
      <table class="report-table erp-table">
        <thead><tr><th>Вид разход</th><th class="num">Фактури</th><th class="num">Основа (EUR)</th><th class="num">ДДС (EUR)</th><th class="num">С ДДС (EUR)</th></tr></thead>
        <tbody>${c.rows.map(g => `<tr>
          <td>${erpPuTypeIsMat(g.type) ? "🧱 " : ""}<b>${escapeHtml(g.type)}</b></td>
          <td class="num">${g.n}</td>
          <td class="num">${eur(g.base)}</td>
          <td class="num">${eur(g.vat)}</td>
          <td class="num"><b>${eur(g.total)}</b></td>
        </tr>`).join("") || `<tr><td colspan="5" class="report-empty">Няма фактури за ${escapeHtml(label(puTypesMonth))}.</td></tr>`}
        ${c.rows.length ? `<tr class="pr-total"><td><b>ОБЩО (${c.count} фактури)</b></td><td></td><td class="num"><b>${eur(c.tBase)}</b></td><td class="num"><b>${eur(c.tVat)}</b></td><td class="num"><b>${eur(c.tTotal)}</b></td></tr>` : ""}
        </tbody>
      </table>`;
  };
  wrap.querySelector("#pt-prev").addEventListener("click", () => { puTypesMonth = shift(puTypesMonth, -1); render(); });
  wrap.querySelector("#pt-next").addEventListener("click", () => { puTypesMonth = shift(puTypesMonth, 1); render(); });
  wrap.querySelector("#pt-close").addEventListener("click", close);
  // Експорт за счетоводството: ред за всяка фактура от месеца.
  wrap.querySelector("#pt-xls-inv").addEventListener("click", () => {
    const rows = monthRows(puTypesMonth).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    if (!rows.length) { alert("Няма фактури за този месец."); return; }
    reportExportXls("razhodi-fakturi-" + puTypesMonth, "Разходни фактури · " + label(puTypesMonth), [{
      title: "Всички фактури",
      headers: [{ label: "Дата" }, { label: "№ Фактура" }, { label: "Доставчик" }, { label: "Вид разход" },
        { label: "Основа", num: true }, { label: "ДДС", num: true }, { label: "С ДДС", num: true },
        { label: "Валута" }, { label: "Плащане" }, { label: "Статус" }],
      rows: rows.map(p => { const t = erpPuTotals(p); return [
        erpDMY(p.date), p.invoiceNo || "", p.supplierName || "", (erpPuTypeIsMat(p.expenseType) ? "[М] " : "") + (p.expenseType || ""),
        Math.round(t.base * 100) / 100, Math.round(t.vat * 100) / 100, Math.round(t.total * 100) / 100,
        erpPuCur(p), erpPuPayLabel(p), p.posted ? "заприходена" : "въведена",
      ]; }),
    }]);
  });
  // Експорт на обобщението по видове.
  wrap.querySelector("#pt-xls-types").addEventListener("click", () => {
    const c = calc(puTypesMonth);
    if (!c.rows.length) { alert("Няма данни за този месец."); return; }
    reportExportXls("razhodi-po-vid-" + puTypesMonth, "Разходи по вид · " + label(puTypesMonth), [{
      title: "По видове (EUR)",
      headers: [{ label: "Вид разход" }, { label: "Фактури", num: true }, { label: "Основа", num: true }, { label: "ДДС", num: true }, { label: "С ДДС", num: true }],
      rows: c.rows.map(g => [(erpPuTypeIsMat(g.type) ? "[М] " : "") + g.type, g.n, Math.round(g.base * 100) / 100, Math.round(g.vat * 100) / 100, Math.round(g.total * 100) / 100])
        .concat([["ОБЩО", c.count, Math.round(c.tBase * 100) / 100, Math.round(c.tVat * 100) / 100, Math.round(c.tTotal * 100) / 100]]),
    }]);
  });
  render();
}

/* 🔁 ДУБЛИКАТИ — фактури с един и същ номер (двойно въвеждане).
   Показва ги групирани, с дата/доставчик/сума/статус, за да се изтрие
   излишната. Заприходена фактура се връща първо („↩ Върни за редакция"),
   за да не остане склад от нея. */
/* ---------- 💱 Проверка: документи в ЛЕВА ----------
   Всички покупки се водят в евро. Тук се вижда кои записи са останали с
   валута BGN — за да се провери дали не е грешка при въвеждане. */
function erpPuBgnReport() {
  const rows = (erpPurchases || []).filter(p => String(p.currency || "").toUpperCase() === "BGN")
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const tot = rows.reduce((s, p) => s + erpPuTotals(p).total, 0);
  const body = rows.map(p => {
    const t = erpPuTotals(p);
    return `<tr>
      <td>${escapeHtml(erpDMY(p.date) || "")}</td>
      <td><b>${escapeHtml(p.invoiceNo || "—")}</b>${p.docType === "goods" ? ' <span class="erp-muted">стокова</span>' : ""}</td>
      <td>${escapeHtml(p.supplierName || "")}</td>
      <td class="num">${erpPuMoney(t.total, "BGN")}</td>
      <td class="num erp-muted">${erpPuMoney(t.total / PU_EUR_BGN, "EUR")}</td>
      <td>${p.posted ? "✓ заприходена" : "чернова"}</td>
      <td class="erp-row-actions"><button class="btn btn-small" data-bopen="${escapeAttr(String(p.id))}">Отвори</button></td>
    </tr>`;
  }).join("");
  const { wrap, close } = erpDialog(`
    <h3>💱 Документи, записани в ЛЕВА (${rows.length})</h3>
    <p class="hint">Всички покупки се водят в евро. Ако някой от тези е въведен по погрешка в лева, отвори го и натисни „⇄ Превърни в EUR" — цените по редовете се делят на ${PU_EUR_BGN}. Ако документът наистина е в лева (стар), остави го както си е.</p>
    ${rows.length ? `<div style="max-height:58vh;overflow:auto"><table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№</th><th>Доставчик</th><th class="num">Сума (BGN)</th><th class="num">≈ EUR</th><th>Статус</th><th></th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="3"><b>ОБЩО</b></td><td class="num"><b>${erpPuMoney(tot, "BGN")}</b></td><td class="num">${erpPuMoney(tot / PU_EUR_BGN, "EUR")}</td><td colspan="2"></td></tr></tfoot>
    </table></div>` : `<p class="hint">✅ Няма нито един документ в лева — всичко е в евро.</p>`}
    <div class="erp-dialog-actions"><span class="spacer" style="flex:1"></span><button class="btn" id="pu-bgn-close">Затвори</button></div>`);
  wrap.querySelector("#pu-bgn-close").addEventListener("click", close);
  wrap.querySelectorAll("[data-bopen]").forEach(b => b.addEventListener("click", () => { close(); erpOpenPurchase(b.dataset.bopen); }));
}

function erpPuDupsReport() {
  const groups = {};
  (erpPurchases || []).forEach(p => {
    const k = erpPuEq(p.invoiceNo);
    if (!k) return;
    (groups[k] = groups[k] || []).push(p);
  });
  const dups = Object.values(groups).filter(g => g.length > 1)
    .sort((a, b) => String(b[0].date || "").localeCompare(String(a[0].date || "")));
  const body = dups.map(g => `
    <div class="erp-lp-group" style="border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-bottom:8px">
      <div><b>№ ${escapeHtml(g[0].invoiceNo || "")}</b> — ${g.length} записа</div>
      <table class="report-table erp-table" style="margin:6px 0 0">
        <thead><tr><th>Дата</th><th>Доставчик</th><th class="num">Сума</th><th>Статус</th><th></th></tr></thead>
        <tbody>${g.map(p => {
          const t = erpPuTotals(p);
          return `<tr>
            <td>${escapeHtml(erpDMY(p.date) || "")}</td>
            <td>${escapeHtml(p.supplierName || "")}</td>
            <td class="num">${erpPuMoney(t.total, erpPuCur(p))}</td>
            <td>${p.posted ? "✓ заприходена" : "чернова"}${p.docType === "goods" ? " · стокова" : ""}</td>
            <td class="erp-row-actions">
              <button class="btn btn-small" data-dopen="${escapeAttr(String(p.id))}">Отвори</button>
              <button class="btn btn-small btn-danger" data-ddel="${escapeAttr(String(p.id))}" ${p.posted ? 'title="Заприходена — първо я върни за редакция"' : ""}>🗑 Изтрий</button>
            </td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>`).join("");
  const { wrap, close } = erpDialog(`
    <h3>🔁 Дублирани фактури</h3>
    <p class="hint">Групи с еднакъв номер (без значение интервали, водещи нули и регистър). Провери коя е излишната и я изтрий. <b>Заприходена</b> фактура първо се връща за редакция (от самата фактура), за да падне складът ѝ.</p>
    <div style="max-height:60vh;overflow:auto">${body || '<p class="report-empty">✅ Няма дублирани номера.</p>'}</div>
    <div class="erp-dialog-actions"><button class="btn btn-primary" id="pud-x">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#pud-x").addEventListener("click", close);
  wrap.querySelectorAll("[data-dopen]").forEach(b => b.addEventListener("click", () => { close(); erpOpenPurchase(b.dataset.dopen); }));
  wrap.querySelectorAll("[data-ddel]").forEach(b => b.addEventListener("click", async () => {
    const p = (erpPurchases || []).find(x => String(x.id) === String(b.dataset.ddel));
    if (!p) return;
    if (p.posted) { alert(`Тази фактура е ЗАПРИХОДЕНА.\nОтвори я и натисни „↩ Върни за редакция" (складът се връща), после я изтрий.`); return; }
    if (!confirm(`Да изтрия ли фактура № ${p.invoiceNo || "—"} · ${p.supplierName || ""} · ${erpDMY(p.date) || ""}?\n\nТова е необратимо.`)) return;
    const { error } = await sb.from("purchases").delete().eq("id", p.id);
    if (error) { alert("Грешка при изтриване: " + error.message); return; }
    try { await erpLoadPurchases(); } catch (e) {}
    close(); erpPuDupsReport();
  }));
}

/* ---------- Заприходяване (само материалните редове; BGN→EUR за средната цена) ---------- */
/* ---------- Фактура ↔ стокови разписки (месечно фактуриране на доставчик) ---------- */
// Избор кои осчетоводени стокови покрива тази фактура (същия доставчик).
function erpPuCoversDialog(o) {
  const sup = (o.supplierName || "").trim().toLowerCase();
  if (!sup) { alert("Първо въведи доставчика — стоковите се търсят по него."); return; }
  const cand = (erpPurchases || []).filter(g =>
    g.docType === "goods" && g.posted
    && (g.supplierName || "").trim().toLowerCase() === sup
    && (!g.coveredByNo || (o.coversIds || []).map(String).includes(String(g.id))));
  if (!cand.length) { alert("Няма осчетоводени стокови разписки от доставчика без покриваща фактура."); return; }
  const sel = new Set((o.coversIds || []).map(String));
  const rows = cand.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .map(g => { const t = erpPuTotals(g); return `<label class="inv-fs-row"><input type="checkbox" class="pu-cv-chk" data-id="${escapeAttr(String(g.id))}" ${sel.has(String(g.id)) ? "checked" : ""} />
      <b>СР № ${escapeHtml(g.invoiceNo || "—")}</b> · ${escapeHtml(g.date || "")} · ${erpPuMoney(t.total, erpPuCur(g))}</label>`; }).join("");
  const { wrap, close } = erpDialog(`
    <h3>🧾 Кои стокови покрива фактурата?</h3>
    <p class="hint">Осчетоводени стокови разписки от <b>${escapeHtml(o.supplierName)}</b> без покриваща фактура. Складът е вдигнат от тях — фактурата носи само сумата за плащане. <b>Важно:</b> фактурата трябва да има и СВОИ редове със сумата, иначе тя влиза с 0 в разходите. Бутонът долу ги попълва от избраните стокови.</p>
    <div style="max-height:40vh;overflow:auto;margin:8px 0">${rows}</div>
    <div class="erp-inline" id="pu-cv-sum" style="margin:6px 0;font-weight:700"></div>
    <div class="erp-dialog-actions">
      <button class="btn" id="pu-cv-cancel">Отказ</button>
      <button class="btn" id="pu-cv-fill" title="Добавя по един ред на стокова разписка със сумата ѝ — така фактурата има стойност и сумите се равняват">⇩ Попълни редовете от избраните</button>
      <button class="btn btn-primary" id="pu-cv-ok">✔ Запиши избора</button>
    </div>`);
  const eurOf = x => { const t = erpPuTotals(x); return (erpPuCur(x) === "BGN" ? t.total / PU_EUR_BGN : t.total); };
  const chosen = () => [...wrap.querySelectorAll(".pu-cv-chk:checked")]
    .map(c => cand.find(g => String(g.id) === String(c.dataset.id))).filter(Boolean);
  const refreshSum = () => {
    const list = chosen();
    const sumG = list.reduce((a, g) => a + eurOf(g), 0);
    const sumI = eurOf(o);
    const d = Math.round((sumI - sumG) * 100) / 100;
    const el = wrap.querySelector("#pu-cv-sum");
    el.innerHTML = `Σ избрани стокови: ${erpPuMoney(Math.round(sumG * 100) / 100, "EUR")} · Σ тази фактура: ${erpPuMoney(Math.round(sumI * 100) / 100, "EUR")}`
      + (Math.abs(d) > 0.02 ? ` · <span class="pay-neg">разлика ${erpPuMoney(d, "EUR")}</span>` : ` · <span class="pay-ok">равни ✓</span>`);
  };
  wrap.querySelectorAll(".pu-cv-chk").forEach(c => c.addEventListener("change", refreshSum));
  refreshSum();
  wrap.querySelector("#pu-cv-cancel").addEventListener("click", close);
  wrap.querySelector("#pu-cv-fill").addEventListener("click", () => {
    const list = chosen();
    if (!list.length) { alert("Първо отметни стоковите."); return; }
    const cur = erpPuCur(o);
    const conv = g => {
      const t = erpPuTotals(g);
      const gc = erpPuCur(g);
      if (gc === cur) return t.base;
      return gc === "BGN" ? t.base / PU_EUR_BGN : t.base * PU_EUR_BGN;   // основата в валутата на фактурата
    };
    o.lines = (o.lines || []).filter(l => !l.fromGoodsId);   // без старите авто-редове
    list.forEach(g => {
      const t = erpPuTotals(g);
      o.lines.push({
        groupName: o.expenseType || g.expenseType || "", article: `СР № ${g.invoiceNo || "—"} от ${erpDMY(g.date) || ""}`,
        code: "", qty: 1, unit: "бр.", unitPrice: Math.round(conv(g) * 100) / 100,
        vatRate: t.mixed ? undefined : t.rate, fromGoodsId: g.id,
      });
    });
    o.coversIds = list.map(g => String(g.id));
    close();
    erpRenderPurchaseForm(o);
    alert(`✓ Добавени ${list.length} реда със сумите на стоковите.\nПровери ги и запази фактурата.`);
  });
  wrap.querySelector("#pu-cv-ok").addEventListener("click", async () => {
    o.coversIds = [...wrap.querySelectorAll(".pu-cv-chk:checked")].map(c => c.dataset.id);
    try { await erpSavePurchase(o); } catch (e) {}
    close();
    erpRenderPurchaseForm(o);
  });
}
// Осчетоводяване на покриваща фактура: БЕЗ складови движения — само парите.
async function erpPostCoveringInvoice(o) {
  const RATE = PU_EUR_BGN;
  const eur = x => { const t = erpPuTotals(x); return (erpPuCur(x) === "BGN" ? t.total / RATE : t.total); };
  const goods = (o.coversIds || []).map(cid => (erpPurchases || []).find(x => String(x.id) === String(cid))).filter(Boolean);
  const sumGoods = goods.reduce((s, g) => s + eur(g), 0);
  const sumInv = eur(o);
  const diff = Math.round((sumInv - sumGoods) * 100) / 100;
  let msg = `Фактура № ${o.invoiceNo || "—"} покрива ${goods.length} стокови разписки.\n`
    + `Σ стокови (с ДДС): ${erpPuMoney(Math.round(sumGoods * 100) / 100, "EUR")}\n`
    + `Σ фактура (с ДДС): ${erpPuMoney(Math.round(sumInv * 100) / 100, "EUR")}\n`;
  msg += Math.abs(diff) > 0.02 ? `\n⚠ РАЗЛИКА: ${erpPuMoney(diff, "EUR")} — провери преди да продължиш!\n` : `\n✓ Сумите съвпадат.\n`;
  const matCount = (o.lines || []).filter(l => l.materialId).length;
  if (matCount) msg += `\n(Фактурата има ${matCount} материални реда — те НЯМА да пипат склада: заприходен е от стоковите.)\n`;
  if (!(sumInv > 0)) {
    alert(`⚠ Фактура № ${o.invoiceNo || "—"} е с нулева стойност — няма редове.\n\n`
      + `Тогава тя влиза с 0 лв. в разходите и сумите се разминават.\n`
      + `Отвори „🧾 Покрива стокови…" и натисни „⇩ Попълни редовете от избраните" (или въведи редовете на ръка).`);
    return;
  }
  msg += `\nОсчетоводявам само сумата (разход + плащане). Продължавам?`;
  if (!confirm(msg)) return;
  try { await erpSavePurchase(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }
  for (const g of goods) {
    g.coveredByNo = o.invoiceNo || "—"; g.coveredById = o.id;
    try { await erpSavePurchase(g); } catch (e) {}
  }
  o.posted = true; o.postedAt = new Date().toISOString();
  try { await erpSavePurchase(o); } catch (e) {}
  await erpLoadPurchases();
  alert(`Готово! Фактурата е осчетоводена (само парите).\nПокрити стокови: ${goods.map(g => "№ " + (g.invoiceNo || "—")).join(", ")}.`);
  erpRenderPurchaseForm(o);
}

async function erpPostPurchase(o, opts) {
  if (o.posted) { alert("Вече е заприходена."); return; }
  // Фактура, ПОКРИВАЩА стокови разписки: складът е вдигнат от стоковите —
  // тук се осчетоводяват само парите (сумата отива в разходите/плащането).
  if (o.docType !== "goods" && (o.coversIds || []).length) { await erpPostCoveringInvoice(o); return; }
  const matLines = (o.lines || []).filter(l => l.materialId && (erpToNum(l.qty) || 0) > 0);
  if (!matLines.length) { alert("Няма материални редове за заприходяване. Само редове, добавени с бутона Материал (склад), влизат в склада."); return; }
  if (!confirm(`Да заприходя ли ${matLines.length} материала в склада? Наличностите се вдигат и средните цени се обновяват (веднъж).`)) return;
  // Предпазители срещу ДВОЙНО заприходяване: бутонът се заключва веднага
  // (бърз двоен клик), а по-долу проверяваме и базата (втора отворена сесия).
  const postBtn = document.getElementById("pu-save");
  if (postBtn) { postBtn.disabled = true; postBtn.textContent = "Заприходява…"; }
  const fail = msg => { if (postBtn) { postBtn.disabled = false; postBtn.textContent = erpPuSaveLabel(o); } if (msg) alert(msg); };
  try { await erpSavePurchase(o); } catch (e) { fail("Грешка при запис: " + (e.message || e)); return; }
  // Втора сесия/таб може да е заприходила междувременно — четем свежия статус.
  try {
    const { data: fresh } = await sb.from("purchases").select("posted").eq("id", o.id).maybeSingle();
    if (fresh && fresh.posted) {
      o.posted = true;
      fail("Тази фактура ВЕЧЕ е заприходена (от друга сесия/прозорец). Складът НЕ е пипнат втори път.");
      erpRenderPurchaseForm(o);
      return;
    }
  } catch (e) { /* при мрежова грешка продължаваме — ref-проверката е втората мрежа */ }
  if (o.invoiceNo) {
    // Друг ЗАПИС със същия № на фактура, вече заприходен → двойно въведена фактура.
    const dups = erpPuDupsOf(o).filter(p => p.posted);
    const sameSup = dups.find(p => erpPuEq(p.supplierName) === erpPuEq(o.supplierName));
    if (sameSup) {
      fail(`⚠ Фактура № ${o.invoiceNo} от ${sameSup.supplierName || "?"} ВЕЧЕ е заприходена (запис от ${erpDMY(sameSup.date) || "?"}).\nТова е ДУБЛИКАТ — не заприходявам втори път.\nАко другият запис е грешният: отвори го и ползвай „↩ Върни за редакция".`);
      return;
    }
    if (dups.length && !confirm(`⚠ Вече има ЗАПРИХОДЕНА фактура № ${o.invoiceNo} (доставчик: ${dups[0].supplierName || "?"}, ${erpDMY(dups[0].date) || "?"}).\nАко е СЪЩАТА фактура с другояче изписан доставчик — спри!\nПродължавам само ако е СЛУЧАЙНО съвпадение на номера при друг доставчик. Да продължа ли?`)) { fail(); return; }
    // Складови движения по същия № (хваща и различно изписан доставчик в ref-а).
    try {
      const { data: mv } = await sb.from("stock_movements").select("ref").like("ref", `Фактура ${o.invoiceNo} ·%`).limit(200);
      const refs = [...new Set((mv || []).map(x => x.ref))];
      if (refs.length && !confirm(`⚠ По фактура № ${o.invoiceNo} ВЕЧЕ има складови движения:\n${refs.slice(0, 3).join("\n")}\nТова обикновено значи ДВОЙНО заприходяване. Наистина ли да продължа?`)) { fail(); return; }
    } catch (e) {}
  }

  const [stk, mat] = await Promise.all([sb.from("v_material_stock").select("id,stock"), sb.from("materials").select("id,avg_cost")]);
  if (stk.error || mat.error) { fail("Грешка: " + ((stk.error || mat.error).message)); return; }
  const stockById = {}, avgById = {};
  (stk.data || []).forEach(r => stockById[r.id] = Number(r.stock) || 0);
  (mat.data || []).forEach(r => avgById[r.id] = Number(r.avg_cost) || 0);
  const rate = erpPuCur(o) === "BGN" ? PU_EUR_BGN : 1;   // средните цени са в EUR

  const ref = `Фактура ${o.invoiceNo || "—"} · ${o.supplierName || ""}`.trim();
  const moves = [], avgUpdates = [];
  for (const l of matLines) {
    const qty = erpToNum(l.qty) || 0;
    const priceEur = (erpToNum(l.unitPrice) || 0) / rate;
    moves.push({ material_id: l.materialId, kind: "входящ", quantity: qty, ref, created_by: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || null });
    if (priceEur > 0) {
      const base = Math.max(0, stockById[l.materialId] || 0), avg = avgById[l.materialId] || 0;
      const newAvg = (base + qty) > 0 ? (base * avg + qty * priceEur) / (base + qty) : priceEur;
      avgById[l.materialId] = newAvg; avgUpdates.push({ id: l.materialId, avg: newAvg });
    }
    stockById[l.materialId] = (stockById[l.materialId] || 0) + qty;
  }
  const ins = await sb.from("stock_movements").insert(moves);
  if (ins.error) { fail("Грешка при движенията: " + ins.error.message); return; }
  for (const u of avgUpdates) { const { error } = await sb.from("materials").update({ avg_cost: u.avg }).eq("id", u.id); if (error) { alert("Движенията са заприходени, но една средна цена не се обнови: " + error.message); break; } }

  o.posted = true; o.postedAt = new Date().toISOString();
  try { await erpSavePurchase(o); } catch {}
  await erpLoadAll(); await erpLoadPurchases();
  if (!(opts && opts.silent)) alert(`Готово! Заприходени ${moves.length} материала. Средните цени (EUR) са обновени.`);
  erpRenderPurchaseForm(o);
}

/* ---------- Връщане за редакция (отзаприходяване) ----------
   При грешка в заприходена фактура: маха складовите движения на тази фактура,
   връща средните цени по обратната формула и отключва всичко за поправка.
   После фактурата се заприходява наново с верните данни. */
async function erpUnpostPurchase(o) {
  if (!o.posted) return;
  if (o.docType !== "goods" && (o.coversIds || []).length) {
    if (!confirm("Да върна ли покриващата фактура за редакция? Складът не се пипа (вдигнат е от стоковите); маркировките по стоковите се махат.")) return;
    for (const cid of o.coversIds) {
      const g = (erpPurchases || []).find(x => String(x.id) === String(cid));
      if (g) { delete g.coveredByNo; delete g.coveredById; try { await erpSavePurchase(g); } catch (e) {} }
    }
    o.posted = false; o.postedAt = null;
    try { await erpSavePurchase(o); } catch (e) {}
    await erpLoadPurchases();
    erpRenderPurchaseForm(o);
    return;
  }
  // Обръщането ползва ЗАПИСАНАТА версия (точно каквото е било заприходено),
  // не евентуално току-що променените стойности на екрана.
  const saved = (erpPurchases || []).find(x => String(x.id) === String(o.id)) || o;
  const matLines = (saved.lines || []).filter(l => l.materialId && (erpToNum(l.qty) || 0) > 0);
  if (!confirm(`Да върна ли фактурата за редакция?\nСкладът ще се намали с ${matLines.length} заприходени материала и средните цени ще се върнат. След поправката я заприходи наново.`)) return;
  const ref = `Фактура ${saved.invoiceNo || "—"} · ${saved.supplierName || ""}`.trim();
  const [stk, mat] = await Promise.all([sb.from("v_material_stock").select("id,stock"), sb.from("materials").select("id,avg_cost")]);
  if (stk.error || mat.error) { alert("Грешка: " + ((stk.error || mat.error).message)); return; }
  const stockById = {}, avgById = {};
  (stk.data || []).forEach(r => stockById[r.id] = Number(r.stock) || 0);
  (mat.data || []).forEach(r => avgById[r.id] = Number(r.avg_cost) || 0);
  const rate = erpPuCur(saved) === "BGN" ? PU_EUR_BGN : 1;

  // Обратна средна цена: сваляме приноса на тази фактура (с включени предпазни граници).
  for (const l of matLines) {
    const qty = erpToNum(l.qty) || 0;
    const priceEur = (erpToNum(l.unitPrice) || 0) / rate;
    if (!(priceEur > 0)) continue;
    const now = stockById[l.materialId] || 0, avg = avgById[l.materialId] || 0;
    const base = now - qty;
    if (base > 0) {
      const rev = (now * avg - qty * priceEur) / base;
      const newAvg = Math.max(0, Math.round(rev * 10000) / 10000);
      const { error } = await sb.from("materials").update({ avg_cost: newAvg }).eq("id", l.materialId);
      if (error) { alert("Грешка при връщане на цена: " + error.message); return; }
      avgById[l.materialId] = newAvg;
    }
    stockById[l.materialId] = base;
  }
  // Махаме входящите движения на точно тази фактура (складът се преизчислява от изгледа).
  const del = await sb.from("stock_movements").delete().eq("ref", ref).eq("kind", "входящ");
  if (del.error) { alert("Грешка при движенията: " + del.error.message); return; }

  o.posted = false; delete o.postedAt;
  try { await erpSavePurchase(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }
  await erpLoadAll(); await erpLoadPurchases();
  alert("Фактурата е върната за редакция. Поправи каквото трябва, запази и я заприходи наново.");
  erpRenderPurchaseForm(o);
}
