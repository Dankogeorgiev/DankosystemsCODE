/* Данко Системс — ЕРП „Задължения (за плащане)".
   Импорт на текущите задължения от GenCloud (xlsx, същите колони), табличен
   изглед. Кристина избира кои да се платят днес → сумата с ДДС отдолу; маркира
   „Платено" → фактурата отива в Архив. Филтри: тази седмица / до края на месеца /
   общо. Пази се в app_config id="payables": { list:[ {...} ] }.
   Ползва ERP/erpView/erpDialog/escapeHtml, глобалния sb и XLSX (SheetJS). */

let PAYABLES = null;
let pybFilter = "all";           // all | week | month | paid
let pybQuery = "";               // 🔎 търсене (доставчик / № / артикул)
let paySelected = new Set();     // избрани id за „плащане днес"
let pybPurchTried = false;       // покупките се теглят веднъж (за покритите стокови)
let pybSort = "due";             // подредба на списъка (виж PYB_SORTS)
let pybSupplier = "";            // филтър по доставчик

function payNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function pybIso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function payToday() { return pybIso(new Date()); }
// „17-07-2026" или „2026-07-17" → ISO „2026-07-17"
function payParseDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return "";
}
function pybFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }
function payMoney(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function payEndOfWeek() { const d = new Date(); const off = (7 - d.getDay()) % 7; d.setDate(d.getDate() + off); return pybIso(d); }   // идваща неделя
function payEndOfMonth() { const d = new Date(); return pybIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function payEndOfNextMonth() { const d = new Date(); return pybIso(new Date(d.getFullYear(), d.getMonth() + 2, 0)); }
function payDaysLeft(due) { if (!due) return null; const a = new Date(due + "T00:00:00"), b = new Date(payToday() + "T00:00:00"); return Math.round((a - b) / 864e5); }
function payNorm(s) { return String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase(); }

/* ---------- Частично плащане ----------
   Задължението пази платеното до момента (paidAmount) и историята (payments).
   „Остава" = сума с ДДС − платено; щом стигне 0, фактурата се затваря. */
function payPaidSoFar(p) { return Math.round(payNum(p && p.paidAmount) * 100) / 100; }
function payLeft(p) {
  if (!p) return 0;
  if (p.paid) return 0;
  return Math.max(0, Math.round((payNum(p.amountVat) - payPaidSoFar(p)) * 100) / 100);
}
function payPartialTitle(p) {
  const list = (p && p.payments) || [];
  if (!list.length) return "";
  return "Плащания: " + list.map(x => `${pybFmt(x.date)} — ${payMoney(x.amount)}`).join("; ");
}

async function erpPayLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "payables").maybeSingle(); PAYABLES = (data && data.data && data.data.list) || []; }
  catch (e) { PAYABLES = []; }
}
async function erpPaySave() {
  const { error } = await sb.from("app_config").upsert({ id: "payables", data: { list: PAYABLES || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message + (/row-level security|violates/i.test(error.message || "") ? "\n\nПусни app-config-rls-fix.sql в Supabase." : "")); return false; }
  return true;
}
function payNextId() { let m = 0; (PAYABLES || []).forEach(p => { const n = Number(p.id) || 0; if (n > m) m = n; }); return m + 1; }

/* ---------- Подредба ----------
   „По подразбиране" пази досегашното поведение: маркираните „за днес" отгоре,
   после по падеж. Останалите са изричен избор на потребителя. */
const PYB_SORTS = [
  ["due", "Падеж (най-скорошен отгоре)"],
  ["dueDesc", "Падеж (най-далечен отгоре)"],
  ["supplier", "Доставчик (А→Я)"],
  ["doc", "Дата на документа (нови отгоре)"],
  ["amount", "Сума (голяма отгоре)"],
  ["invoice", "№ на фактурата"],
];
function pybSortRows(rows) {
  const S = String;
  const byDue = (a, b) => S(a.dueDate || "9999").localeCompare(S(b.dueDate || "9999"));
  const sec = (a, b) => (S(a.supplier || "").localeCompare(S(b.supplier || ""), "bg") || byDue(a, b));
  const cmp = {
    due: (a, b) => {
      if (pybFilter === "paid") return S(b.paidDate || "").localeCompare(S(a.paidDate || ""));
      const af = a.forToday ? 0 : 1, bf = b.forToday ? 0 : 1;   // „за днес" отгоре
      if (af !== bf) return af - bf;
      return byDue(a, b);
    },
    dueDesc: (a, b) => S(b.dueDate || "").localeCompare(S(a.dueDate || "")),
    supplier: (a, b) => sec(a, b),
    doc: (a, b) => S(b.docDate || "").localeCompare(S(a.docDate || "")) || sec(a, b),
    amount: (a, b) => (payLeft(b) || payNum(b.amountVat)) - (payLeft(a) || payNum(a.amountVat)) || sec(a, b),
    invoice: (a, b) => S(a.invoiceNo || "").localeCompare(S(b.invoiceNo || ""), "bg", { numeric: true }),
  }[pybSort] || (() => 0);
  return rows.slice().sort(cmp);
}

/* ---------- Стокови разписки, покрити от фактура ----------
   Стоковата вдига склада, но НЕ е плащане — парите идват с фактурата, която я
   покрива. Ако и двете стоят в „Задължения", сумата се брои два пъти. */
function pybCoveredGoods(rows) {
  const pur = (typeof erpPurchases !== "undefined" && erpPurchases) || [];
  if (!pur.length) return [];
  const ids = new Set(), nos = new Set();
  pur.forEach(g => {
    if (g.docType !== "goods") return;
    if (!g.coveredById && !g.coveredByNo) return;
    ids.add(String(g.id));
    if (g.invoiceNo) nos.add(payNorm(g.invoiceNo));
  });
  if (!ids.size) return [];
  return (rows || []).filter(p =>
    (p.srcPurchaseId && ids.has(String(p.srcPurchaseId))) ||
    (p.invoiceNo && nos.has(payNorm(p.invoiceNo))));
}
async function pybRemoveCovered() {
  const rows = pybCoveredGoods((PAYABLES || []).filter(p => !p.paid));
  if (!rows.length) { alert("Няма такива задължения."); return; }
  const txt = rows.slice(0, 12).map(p => `• № ${p.invoiceNo || "—"} ${p.supplier || ""} — ${payMoney(p.amountVat)}`).join("\n");
  if (!confirm(`Да махна ли ${rows.length} задължения по стокови разписки, които вече са покрити от фактура?\n\n${txt}${rows.length > 12 ? "\n…" : ""}\n\nПлаща се фактурата, не стоковите.`)) return;
  const kill = new Set(rows.map(p => p.id));
  PAYABLES = (PAYABLES || []).filter(p => !kill.has(p.id));
  paySelected.clear();
  if (await erpPaySave()) erpRenderPayables();
}

/* ---------- Списък ---------- */
async function erpRenderPayables() {
  const v = erpView();
  if (!PAYABLES) { v.innerHTML = `<p class="erp-loading">Зареждане…</p>`; await erpPayLoad(); }
  const eow = payEndOfWeek(), eom = payEndOfMonth(), eonm = payEndOfNextMonth();
  const unpaid = (PAYABLES || []).filter(p => !p.paid);
  const sum = arr => arr.reduce((s, p) => s + payLeft(p), 0);
  // Покупките трябват само за проверката „стокова, покрита от фактура" — теглят се
  // веднъж фоново и екранът се пре-рисува.
  if (!pybPurchTried && typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) {
    pybPurchTried = true;
    erpLoadPurchases().then(() => { if (document.querySelector(".pay-table")) erpRenderPayables(); }).catch(() => {});
  }
  const coveredRows = pybCoveredGoods(unpaid);
  const weekItems = unpaid.filter(p => p.dueDate && p.dueDate <= eow);
  const monthItems = unpaid.filter(p => p.dueDate && p.dueDate <= eom);
  // Следващ месец: падеж СЛЕД края на този и до края на следващия.
  const nextItems = unpaid.filter(p => p.dueDate && p.dueDate > eom && p.dueDate <= eonm);

  let rows;
  if (pybFilter === "paid") rows = (PAYABLES || []).filter(p => p.paid);
  else if (pybFilter === "today") rows = unpaid.filter(p => p.forToday);
  else if (pybFilter === "week") rows = weekItems;
  else if (pybFilter === "month") rows = monthItems;
  else if (pybFilter === "next") rows = nextItems;
  else rows = unpaid;
  // 🔎 Търсене (в паметта): доставчик / № фактура / артикул. Картите горе остават общи.
  const pq = (pybQuery || "").toLowerCase().trim();
  if (pq) rows = rows.filter(p => `${p.supplier || ""} ${p.invoiceNo || ""} ${p.article || ""}`.toLowerCase().includes(pq));
  if (pybSupplier) rows = rows.filter(p => String(p.supplier || "").trim() === pybSupplier);
  const supplierOpts = [...new Set((PAYABLES || []).map(p => String(p.supplier || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "bg"));
  rows = pybSortRows(rows);

  const card = (label, arr, hl) => `<div class="pay-card ${hl || ""}"><div class="pay-card-l">${label}</div><div class="pay-card-v">${payMoney(sum(arr))} EUR</div><div class="pay-card-n">${arr.length} фактури</div></div>`;
  const tab = (key, label) => `<button class="btn btn-small ${pybFilter === key ? "btn-primary" : ""}" data-pf="${key}">${label}</button>`;
  const today = payToday();

  v.innerHTML = `
    <div class="erp-toolbar">
      ${tab("all", "⏳ Всички за плащане")}
      ${tab("today", `☀ За днес (${unpaid.filter(p => p.forToday).length})`)}
      ${tab("week", "📅 Тази седмица")}
      ${tab("month", "📅 До края на месеца")}
      ${tab("next", `📅 Следващ месец (${nextItems.length})`)}
      ${tab("paid", "✓ Платени (архив)")}
      <input type="search" id="pyb-q" placeholder="🔎 доставчик / № / артикул…" value="${escapeAttr(pybQuery)}" style="min-width:190px" autocomplete="off" />
      <label class="erp-inline">Доставчик
        <select id="pyb-supplier"><option value="">Всички</option>${supplierOpts.map(s => `<option ${s === pybSupplier ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}</select></label>
      <label class="erp-inline">Подреди по
        <select id="pyb-sort">${PYB_SORTS.map(([k, l]) => `<option value="${k}" ${k === pybSort ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${pybSupplier ? '<button class="btn btn-small" id="pyb-clearf">✕ Изчисти филтъра</button>' : ""}
      <span class="spacer"></span>
      <span class="erp-count">${rows.length} ${rows.length === 1 ? "фактура" : "фактури"} · ${payMoney(rows.reduce((s, p) => s + (pybFilter === "paid" ? payNum(p.amountVat) : payLeft(p)), 0))} EUR</span>
      <button class="btn btn-small" id="pyb-xls" title="Сваля точно това, което се вижда — със същия филтър и подредба">⬇ Excel</button>
    </div>
    <div class="pay-cards">
      ${card("📅 Тази седмица", weekItems, "pay-card-week")}
      ${card("📅 До края на месеца", monthItems)}
      ${card("📅 Следващ месец", nextItems)}
      ${card("Σ Общо за плащане", unpaid, "pay-card-total")}
    </div>
    ${coveredRows.length && pybFilter !== "paid" ? `<div class="pay-covered">
      <span>⚠ <b>${coveredRows.length}</b> ${coveredRows.length === 1 ? "задължение е" : "задължения са"} по <b>стокови разписки</b>, вече покрити от фактура
        (${payMoney(coveredRows.reduce((s, p) => s + payLeft(p), 0))} EUR). Плаща се фактурата — стоковите не са отделно плащане.</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pyb-rmcov">🧹 Махни ги</button>
    </div>` : ""}
    <div class="pay-scroll"><table class="report-table erp-table pay-table">
      <thead><tr>
        ${pybFilter === "paid" ? "" : '<th class="pay-chk"></th><th class="pay-flag" title="Отбележи за плащане — Кристина ги вижда в „☀ За днес“">💰</th>'}
        <th>Падеж</th><th class="num">Дни</th><th>№ Фактура</th><th>Дата док.</th><th>Доставчик</th><th>Артикул</th>
        <th class="num">Сума</th><th class="num">С ДДС</th><th>Плащане</th>${pybFilter === "paid" ? "<th>Платена на</th>" : "<th></th>"}
      </tr></thead>
      <tbody>${rows.map(p => {
        const dl = payDaysLeft(p.dueDate);
        const overdue = !p.paid && dl != null && dl < 0;
        const soon = !p.paid && dl != null && dl >= 0 && dl <= 3;
        return `<tr class="${overdue ? "pay-overdue" : soon ? "pay-soon" : ""}${p.forToday ? " pay-today" : ""}" data-id="${p.id}">
          ${pybFilter === "paid" ? "" : `<td class="pay-chk"><input type="checkbox" class="pay-sel" data-id="${p.id}" ${paySelected.has(p.id) ? "checked" : ""} /></td>
          <td class="pay-flag"><button type="button" class="pay-flag-btn${p.forToday ? " on" : ""}" data-today="${p.id}" title="${p.forToday ? "Отбелязана за плащане — Кристина я вижда в „☀ За днес“. Клик = маха отметката." : "Отбележи за плащане — излиза при Кристина в „☀ За днес“"}">${p.forToday ? "💰" : "○"}</button></td>`}
          <td><b>${pybFmt(p.dueDate)}</b></td>
          <td class="num">${dl == null ? "" : (dl < 0 ? `<span class="pay-neg">${dl}</span>` : dl)}</td>
          <td>${escapeHtml(p.invoiceNo || "")}</td>
          <td>${pybFmt(p.docDate)}</td>
          <td>${escapeHtml(p.supplier || "")}</td>
          <td>${escapeHtml(p.article || "")}</td>
          <td class="num">${payMoney(p.amount)}</td>
          <td class="num" title="${escapeAttr(payPartialTitle(p))}"><b>${payMoney(p.paid ? p.amountVat : payLeft(p))}</b>${
            !p.paid && payPaidSoFar(p) > 0
              ? `<div class="pay-part">от ${payMoney(p.amountVat)} · платени ${payMoney(payPaidSoFar(p))}</div>` : ""}</td>
          <td>${escapeHtml(p.payMethod || "Банка")}</td>
          ${pybFilter === "paid"
            ? `<td>${pybFmt(p.paidDate)} <button class="btn btn-small" data-unpay="${p.id}" title="Върни като неплатена">↩</button></td>`
            : `<td class="erp-row-actions"><button class="btn btn-small" data-part="${p.id}" title="Частично плащане — въвеждаш колко се плаща сега, остатъкът остава в списъка">€ Частично</button></td>`}
        </tr>`; }).join("") || `<tr><td colspan="12" class="report-empty">${pybFilter === "paid" ? "Няма платени фактури." : "Няма задължения. Импортирай от GenCloud."}</td></tr>`}
      </tbody>
    </table></div>
    ${pybFilter !== "paid" ? `<div class="pay-paybar" id="pay-paybar"></div>` : ""}`;

  v.querySelectorAll("[data-pf]").forEach(b => b.addEventListener("click", () => { pybFilter = b.dataset.pf; paySelected.clear(); erpRenderPayables(); }));
  const pqEl = document.getElementById("pyb-q");
  if (pqEl) pqEl.addEventListener("input", e => {
    pybQuery = e.target.value;
    erpRenderPayables();
    const el = document.getElementById("pyb-q");
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
  const fi = document.getElementById("pay-file"); if (fi) fi.addEventListener("change", e => erpPayImport(e.target.files[0]));
  const ci = document.getElementById("pay-clear-import"); if (ci) ci.addEventListener("click", erpPayClearImport);
  const ca = document.getElementById("pay-clear-all"); if (ca) ca.addEventListener("click", erpPayClearAll);
  v.querySelectorAll(".pay-sel").forEach(c => c.addEventListener("change", () => { const id = Number(c.dataset.id); if (c.checked) paySelected.add(id); else paySelected.delete(id); erpPayBar(); }));
  v.querySelectorAll("[data-today]").forEach(b => b.addEventListener("click", () => erpPayToggleToday(Number(b.dataset.today))));
  v.querySelectorAll("[data-part]").forEach(b => b.addEventListener("click", () => erpPayPartial(Number(b.dataset.part))));
  const sSel = document.getElementById("pyb-sort");
  if (sSel) sSel.addEventListener("change", e => { pybSort = e.target.value; erpRenderPayables(); });
  const supSel = document.getElementById("pyb-supplier");
  if (supSel) supSel.addEventListener("change", e => { pybSupplier = e.target.value; paySelected.clear(); erpRenderPayables(); });
  const clrF = document.getElementById("pyb-clearf");
  if (clrF) clrF.addEventListener("click", () => { pybSupplier = ""; erpRenderPayables(); });
  const xls = document.getElementById("pyb-xls");
  if (xls) xls.addEventListener("click", () => erpPayExportXls(rows));
  const rmc = document.getElementById("pyb-rmcov"); if (rmc) rmc.addEventListener("click", pybRemoveCovered);
  v.querySelectorAll("[data-unpay]").forEach(b => b.addEventListener("click", () => erpPayUnpay(Number(b.dataset.unpay))));
  erpPayBar();
}

// Лентата „Плати избраните" — сумата с ДДС на избраните.
function erpPayBar() {
  const bar = document.getElementById("pay-paybar"); if (!bar) return;
  const sel = (PAYABLES || []).filter(p => paySelected.has(p.id) && !p.paid);
  const tot = sel.reduce((s, p) => s + payLeft(p), 0);
  if (!sel.length) { bar.innerHTML = `<span class="erp-muted">Избери фактури с отметка, за да видиш сумата за плащане днес.</span>`; return; }
  bar.innerHTML = `
    <span class="pay-sel-info">Избрани: <b>${sel.length}</b> · за плащане: <b>${payMoney(tot)} EUR</b> (с ДДС)</span>
    <span class="spacer"></span>
    <button class="btn btn-small" id="pay-print">🖨 Списък за Крис</button>
    <button class="btn btn-small" id="pay-xls" title="Същият списък, но в Excel">⬇ Excel (избраните)</button>
    <button class="btn btn-small btn-primary" id="pay-paysel">✓ Отбележи избраните като платени</button>`;
  document.getElementById("pay-paysel").addEventListener("click", () => erpPayMarkPaid([...paySelected]));
  document.getElementById("pay-print").addEventListener("click", () => erpPayPrint(sel));
  document.getElementById("pay-xls").addEventListener("click", () => erpPayExportXls(pybSortRows(sel), "избрани за плащане"));
}

/* ---------- Платено / върни ---------- */
async function erpPayMarkPaid(ids) {
  ids = ids.filter(Boolean); if (!ids.length) return;
  const today = payToday();
  const d = prompt(`Дата на плащане за ${ids.length} фактур${ids.length === 1 ? "а" : "и"} (ГГГГ-ММ-ДД):`, today);
  if (d === null) return;
  const date = (d || today).trim();
  (PAYABLES || []).forEach(p => {
    if (!ids.includes(p.id)) return;
    const left = payLeft(p);
    if (left > 0) p.payments = (p.payments || []).concat([{ date, amount: left }]);
    p.paidAmount = Math.round(payNum(p.amountVat) * 100) / 100;
    p.paid = true; p.paidDate = date; p.forToday = false;
  });
  paySelected.clear();
  if (await erpPaySave()) erpRenderPayables();
}
/* Частично плащане: въвежда се платената сега сума; остатъкът остава да се дължи. */
async function erpPayPartial(id) {
  const p = (PAYABLES || []).find(x => x.id === id); if (!p) return;
  const left = payLeft(p);
  if (!(left > 0)) { alert("По тази фактура няма остатък за плащане."); return; }
  const s = prompt(`Частично плащане — фактура № ${p.invoiceNo || "—"} (${p.supplier || ""}).\n`
    + `Сума с ДДС: ${payMoney(p.amountVat)} EUR`
    + (payPaidSoFar(p) > 0 ? `\nПлатени до момента: ${payMoney(payPaidSoFar(p))} EUR` : "")
    + `\nОстават: ${payMoney(left)} EUR\n\nКолко се плаща сега?`, String(left).replace(".", ","));
  if (s === null) return;
  const amt = Math.round(payNum(s) * 100) / 100;
  if (!(amt > 0)) { alert("Въведи сума, по-голяма от 0."); return; }
  if (amt > left + 0.005 && !confirm(`Сумата (${payMoney(amt)}) е по-голяма от оставащата (${payMoney(left)}).\nДа я запиша ли така?`)) return;
  const d = prompt("Дата на плащането (ГГГГ-ММ-ДД):", payToday());
  if (d === null) return;
  const date = (d || payToday()).trim();
  p.payments = (p.payments || []).concat([{ date, amount: amt }]);
  p.paidAmount = Math.round((payPaidSoFar(p) + amt) * 100) / 100;
  if (payLeft(p) <= 0.005) { p.paid = true; p.paidDate = date; p.forToday = false; }
  if (await erpPaySave()) {
    erpRenderPayables();
    if (!p.paid) alert(`Записано. Остават ${payMoney(payLeft(p))} EUR по фактура № ${p.invoiceNo || "—"}.`);
  }
}
async function erpPayUnpay(id) {
  const p = (PAYABLES || []).find(x => x.id === id); if (!p) return;
  p.paid = false; p.paidDate = "";
  p.paidAmount = 0; p.payments = [];   // връща се цялата сума като дължима
  if (await erpPaySave()) erpRenderPayables();
}
// „За днес" — флаг за Крис (кои да плати днес). Не е плащане.
async function erpPayToggleToday(id) {
  const p = (PAYABLES || []).find(x => x.id === id); if (!p) return;
  p.forToday = !p.forToday;
  if (await erpPaySave()) erpRenderPayables();
}

/* ---------- Импорт от GenCloud (xlsx) ---------- */
async function erpPayImport(file) {
  if (!file) return;
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!raw.length) { alert("Файлът е празен."); return; }
    // Разпознаване на колоните по заглавия (толерантно).
    const pick = (row, ...names) => { for (const n of names) { for (const k of Object.keys(row)) { if (k.trim().toLowerCase() === n.toLowerCase()) return row[k]; } } return ""; };
    await erpPayLoad();
    const pybNorm = s => String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
    let added = 0, updated = 0;
    const review = [];
    raw.forEach(r => {
      const invoiceNo = String(pick(r, "№:", "№", "No", "Номер") || "").trim();
      const supplier = String(pick(r, "Партньор", "Доставчик") || "").trim();
      if (!invoiceNo && !supplier) return;
      const rec = {
        dueDate: payParseDate(pick(r, "Дата на падеж", "Падеж")),
        termDays: payNum(pick(r, "Плащане до дни")),
        invoiceNo, docDate: payParseDate(pick(r, "Дата на док.", "Дата на документ", "Дата")),
        supplier, article: String(pick(r, "Артикул", "Описание") || "").trim(),
        amount: payNum(pick(r, "Непл.сума", "Сума")),
        amountVat: payNum(pick(r, "Непл.сума с ДДС", "Сума с ДДС")),
        currency: String(pick(r, "Непл.сума (мярка)", "Валута") || "EUR").trim() || "EUR",
        payMethod: String(pick(r, "Авоар", "Плащане") || "Банка").trim() || "Банка",
      };
      // „Само липсващите": по НОМЕРА на фактурата (нормализиран), независимо
      // как е изписан доставчикът. Съществуващите (вкл. ръчните) НЕ се пипат.
      const k = pybNorm(invoiceNo);
      const ex = k
        ? (PAYABLES || []).find(p => pybNorm(p.invoiceNo) === k)
        : (PAYABLES || []).find(p => !p.paid && (p.supplier || "") === supplier && Math.abs(payNum(p.amount) - rec.amount) < 0.005);
      if (ex) {
        updated++;
        if (!ex.paid && Math.abs(payNum(ex.amount) - rec.amount) > 0.005)
          review.push(`№${invoiceNo} ${supplier}: в Системата ${(payNum(ex.amount)).toFixed(2)}, във файла ${rec.amount.toFixed(2)}`);
        return;
      }
      PAYABLES.push({ id: payNextId(), paid: false, paidDate: "", imported: true, ...rec });
      added++;
    });
    if (await erpPaySave()) {
      pybFilter = "all"; erpRenderPayables();
      let msg = `Импорт готов: ${added} добавени, ${updated} прескочени (вече ги има — не са пипани).`;
      if (review.length) msg += `\n\n⚠ РАЗЛИКА В СУМАТА (провери ръчно):\n` + review.slice(0, 15).join("\n") + (review.length > 15 ? `\n… и още ${review.length - 15}` : "");
      alert(msg);
    }
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}

// Изтегля (изтрива) импортираните от GenCloud задължения. Тези, дошли автоматично
// от въведена фактура-разход (имат srcPurchaseId), остават непокътнати.
async function erpPayClearImport() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpPayLoad();
  const imported = (PAYABLES || []).filter(p => !p.srcPurchaseId);
  if (!imported.length) { alert("Няма импортирани задължения за изтегляне."); return; }
  if (!confirm(`Да изтегля (изтрия) ли ${imported.length} импортирани задължения?\nТези, дошли от въведена фактура-разход, остават.`)) return;
  PAYABLES = (PAYABLES || []).filter(p => p.srcPurchaseId);
  paySelected.clear();
  if (await erpPaySave()) { pybFilter = "all"; erpRenderPayables(); alert("Готово. Можеш да импортираш наново."); }
}

// Пълно изчистване — трие ВСИЧКИ задължения (включително архива с платените).
async function erpPayClearAll() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpPayLoad();
  const n = (PAYABLES || []).length;
  if (!n) { alert("Задълженията вече са празни."); return; }
  if (!confirm(`Да изтрия ли ВСИЧКИ ${n} задължения (включително архива с платените)?\nТова не може да се върне.`)) return;
  PAYABLES = [];
  paySelected.clear();
  if (await erpPaySave()) { pybFilter = "all"; erpRenderPayables(); alert("Готово. Задълженията са изчистени."); }
}

/* ---------- Връзка с Покупки: покупка Банка+срок → задължение ---------- */
// Извиква се при запис/плащане на покупка. Ако е Банка + срок>0 + неплатена →
// създава/обновява задължение (свързано по srcPurchaseId). Иначе го маха или
// маркира като платено. Сумите се водят в EUR (BGN се превръща).
async function erpPaySyncFromPurchase(o) {
  if (!o || !o.id) return;
  await erpPayLoad();
  // Стоковата разписка НЕ е плащане — парите идват с фактурата, която я покрива.
  if (o.docType === "goods") {
    const i = (PAYABLES || []).findIndex(p => p.srcPurchaseId === o.id && !p.paid);
    if (i >= 0) { PAYABLES.splice(i, 1); await erpPaySave(); }
    return;
  }
  const rate = (o.currency === "BGN") ? 1.95583 : 1;
  const t = (typeof erpPuTotals === "function") ? erpPuTotals(o) : { base: 0, total: 0 };
  // Отложено (разсрочено) плащане, още неплатено → задължение. Ново поле payStatus
  // има приоритет; старите записи падат към paymentMethod/termDays.
  const qualifies = !o.paid && (o.payStatus === "deferred" ||
    (!o.payStatus && o.paymentMethod === "Банка" && Number(o.termDays) > 0));
  const idx = (PAYABLES || []).findIndex(p => p.srcPurchaseId === o.id);
  if (qualifies) {
    const fields = {
      dueDate: o.dueDate || (typeof erpPuDueDate === "function" ? erpPuDueDate(o) : ""),
      termDays: Number(o.termDays) || 0,
      invoiceNo: o.invoiceNo || "",
      docDate: o.date || "",
      supplier: o.supplierName || "",
      article: (o.lines || []).map(l => l.article || l.name).filter(Boolean).slice(0, 2).join(", ") || o.note || "",
      amount: Math.round((t.base / rate) * 100) / 100,
      amountVat: Math.round((t.total / rate) * 100) / 100,
      currency: "EUR", payMethod: "Банка", srcPurchaseId: o.id,
    };
    if (idx >= 0) {
      if (!PAYABLES[idx].paid) Object.assign(PAYABLES[idx], fields);
    } else PAYABLES.push({ id: payNextId(), paid: false, paidDate: "", forToday: false, ...fields });
    await erpPaySave();
  } else if (idx >= 0 && !PAYABLES[idx].paid) {
    const pb = PAYABLES[idx];
    if (o.paid) {
      const left = payLeft(pb);
      if (left > 0) pb.payments = (pb.payments || []).concat([{ date: o.paidDate || payToday(), amount: left }]);
      pb.paidAmount = Math.round(payNum(pb.amountVat) * 100) / 100;
      pb.paid = true; pb.paidDate = o.paidDate || payToday(); pb.forToday = false;
    } else PAYABLES.splice(idx, 1);   // Каса/веднага → не е задължение
    await erpPaySave();
  }
  // Покриваща фактура: махаме задълженията по покритите стокови — плаща се само тя.
  if ((o.coversIds || []).length) await erpPayDropCovered(o);
}
/* Маха от „Задължения" стоковите разписки, покрити от тази фактура. */
async function erpPayDropCovered(o) {
  const ids = new Set((o.coversIds || []).map(String));
  if (!ids.size) return;
  const nos = new Set();
  try {
    if ((typeof erpPurchases === "undefined" || !erpPurchases) && typeof erpLoadPurchases === "function") await erpLoadPurchases();
    ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(g => {
      if (ids.has(String(g.id)) && g.invoiceNo) nos.add(payNorm(g.invoiceNo));
    });
  } catch (e) {}
  const before = (PAYABLES || []).length;
  PAYABLES = (PAYABLES || []).filter(p => {
    if (p.paid) return true;
    if (p.srcPurchaseId && ids.has(String(p.srcPurchaseId))) return false;
    if (p.invoiceNo && nos.has(payNorm(p.invoiceNo))) return false;
    return true;
  });
  if (PAYABLES.length !== before) await erpPaySave();
}

/* ---------- ⬇ Excel (за Кристина) ----------
   Сваля ТОЧНО показаното: същия филтър, същото търсене, същата подредба.
   Отдолу има ред с общите суми. */
function erpPayExportXls(rows, whatOverride) {
  if (typeof reportExportXls !== "function") { alert("Модулът за експорт не е зареден."); return; }
  if (!rows || !rows.length) { alert("Няма редове за сваляне."); return; }
  const paidView = pybFilter === "paid";
  const headers = [
    { label: "Падеж" }, { label: "Дни", num: true }, { label: "№ Фактура" }, { label: "Дата док." },
    { label: "Доставчик" }, { label: "Артикул" },
    { label: "Сума без ДДС", num: true }, { label: "Сума с ДДС", num: true },
    { label: "Платено", num: true }, { label: "Остава", num: true },
    { label: "Плащане" }, { label: paidView ? "Платена на" : "Статус" },
  ];
  const body = rows.map(p => {
    const dl = payDaysLeft(p.dueDate);
    const st = p.paid ? "платена" : (payPaidSoFar(p) > 0 ? "частично платена" : (dl != null && dl < 0 ? "ПРОСРОЧЕНА" : "за плащане"));
    return [
      pybFmt(p.dueDate), (dl == null ? "" : dl), p.invoiceNo || "", pybFmt(p.docDate),
      p.supplier || "", p.article || "",
      payMoney(p.amount), payMoney(p.amountVat),
      payPaidSoFar(p) ? payMoney(payPaidSoFar(p)) : "", payMoney(payLeft(p)),
      p.payMethod || "Банка", paidView ? pybFmt(p.paidDate) : st,
    ];
  });
  const tVat = rows.reduce((s, p) => s + payNum(p.amountVat), 0);
  const tPaid = rows.reduce((s, p) => s + payPaidSoFar(p), 0);
  const tLeft = rows.reduce((s, p) => s + payLeft(p), 0);
  body.push(["", "", "", "", "ОБЩО (EUR)", `${rows.length} фактури`, "", payMoney(tVat), payMoney(tPaid), payMoney(tLeft), "", ""]);
  const what = whatOverride
    || { all: "всички за плащане", today: "за днес", week: "тази седмица", month: "до края на месеца", next: "следващ месец", paid: "платени (архив)" }[pybFilter]
    || pybFilter;
  const sortLbl = (PYB_SORTS.find(x => x[0] === pybSort) || ["", ""])[1];
  const title = `Задължения — ${what} · ${pybFmt(payToday())}`
    + (whatOverride ? "" : `${pybSupplier ? " · " + pybSupplier : ""}${pybQuery ? " · търсене: " + pybQuery : ""} · подредба: ${sortLbl}`);
  reportExportXls(`zadalzheniya-${payToday()}`, title, [{ headers, rows: body }]);
}

/* ---------- Печат на списък за плащане (за Крис) ---------- */
function erpPayPrint(items) {
  const tot = items.reduce((s, p) => s + payLeft(p), 0);
  const rows = items.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.invoiceNo || "")}</td><td>${escapeHtml(p.supplier || "")}</td><td>${pybFmt(p.dueDate)}</td><td class="r">${payMoney(payLeft(p))}${payPaidSoFar(p) > 0 ? `<br><small>частично: от ${payMoney(p.amountVat)}</small>` : ""}</td></tr>`).join("");
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>За плащане</title>
    <style>body{font-family:Arial,"DejaVu Sans",sans-serif;margin:18px;color:#111}h1{font-size:18px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}th{background:#ecfdf5}
    td.r{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #0f766e}
    @media print{.noprint{display:none}}.noprint{margin:10px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}</style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <h1>Фактури за плащане — ${pybFmt(payToday())}</h1>
    <table><thead><tr><th>№</th><th>Фактура</th><th>Доставчик</th><th>Падеж</th><th>Сума с ДДС (EUR)</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" class="r">ОБЩО с ДДС</td><td class="r">${payMoney(tot)} EUR</td></tr></tfoot></table></body></html>`;
  const w = window.open("", "_blank"); if (!w) { alert("Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
