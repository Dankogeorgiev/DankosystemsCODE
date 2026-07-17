/* Данко Системс — ЕРП „Задължения (за плащане)".
   Импорт на текущите задължения от GenCloud (xlsx, същите колони), табличен
   изглед. Кристина избира кои да се платят днес → сумата с ДДС отдолу; маркира
   „Платено" → фактурата отива в Архив. Филтри: тази седмица / до края на месеца /
   общо. Пази се в app_config id="payables": { list:[ {...} ] }.
   Ползва ERP/erpView/erpDialog/escapeHtml, глобалния sb и XLSX (SheetJS). */

let PAYABLES = null;
let payFilter = "all";           // all | week | month | paid
let paySelected = new Set();     // избрани id за „плащане днес"

function payNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function payIso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function payToday() { return payIso(new Date()); }
// „17-07-2026" или „2026-07-17" → ISO „2026-07-17"
function payParseDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return "";
}
function payFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }
function payMoney(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function payEndOfWeek() { const d = new Date(); const off = (7 - d.getDay()) % 7; d.setDate(d.getDate() + off); return payIso(d); }   // идваща неделя
function payEndOfMonth() { const d = new Date(); return payIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function payDaysLeft(due) { if (!due) return null; const a = new Date(due + "T00:00:00"), b = new Date(payToday() + "T00:00:00"); return Math.round((a - b) / 864e5); }

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

/* ---------- Списък ---------- */
async function erpRenderPayables() {
  const v = erpView();
  if (!PAYABLES) { v.innerHTML = `<p class="erp-loading">Зареждане…</p>`; await erpPayLoad(); }
  const eow = payEndOfWeek(), eom = payEndOfMonth();
  const unpaid = (PAYABLES || []).filter(p => !p.paid);
  const sum = arr => arr.reduce((s, p) => s + payNum(p.amountVat), 0);
  const weekItems = unpaid.filter(p => p.dueDate && p.dueDate <= eow);
  const monthItems = unpaid.filter(p => p.dueDate && p.dueDate <= eom);

  let rows;
  if (payFilter === "paid") rows = (PAYABLES || []).filter(p => p.paid);
  else if (payFilter === "today") rows = unpaid.filter(p => p.forToday);
  else if (payFilter === "week") rows = weekItems;
  else if (payFilter === "month") rows = monthItems;
  else rows = unpaid;
  rows = rows.slice().sort((a, b) => {
    if (payFilter === "paid") return String(b.paidDate || "").localeCompare(a.paidDate || "");
    const af = a.forToday ? 0 : 1, bf = b.forToday ? 0 : 1;   // „за днес" отгоре
    if (af !== bf) return af - bf;
    return String(a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  });

  const card = (label, arr, hl) => `<div class="pay-card ${hl || ""}"><div class="pay-card-l">${label}</div><div class="pay-card-v">${payMoney(sum(arr))} EUR</div><div class="pay-card-n">${arr.length} фактури</div></div>`;
  const tab = (key, label) => `<button class="btn btn-small ${payFilter === key ? "btn-primary" : ""}" data-pf="${key}">${label}</button>`;
  const today = payToday();

  v.innerHTML = `
    <div class="erp-toolbar">
      ${tab("all", "⏳ Всички за плащане")}
      ${tab("today", `☀ За днес (${unpaid.filter(p => p.forToday).length})`)}
      ${tab("week", "📅 Тази седмица")}
      ${tab("month", "📅 До края на месеца")}
      ${tab("paid", "✓ Платени (архив)")}
      <span class="spacer"></span>
      <label class="btn btn-small co-attach-btn">⤓ Импорт (GenCloud)<input type="file" id="pay-file" accept=".xlsx,.xls" hidden /></label>
    </div>
    <div class="pay-cards">
      ${card("📅 Тази седмица", weekItems, "pay-card-week")}
      ${card("📅 До края на месеца", monthItems)}
      ${card("Σ Общо за плащане", unpaid, "pay-card-total")}
    </div>
    <div class="pay-scroll"><table class="report-table erp-table pay-table">
      <thead><tr>
        ${payFilter === "paid" ? "" : '<th class="pay-chk"></th>'}
        <th>Падеж</th><th class="num">Дни</th><th>№ Фактура</th><th>Дата док.</th><th>Доставчик</th><th>Артикул</th>
        <th class="num">Сума</th><th class="num">С ДДС</th><th>Плащане</th>${payFilter === "paid" ? "<th>Платена на</th>" : "<th></th>"}
      </tr></thead>
      <tbody>${rows.map(p => {
        const dl = payDaysLeft(p.dueDate);
        const overdue = !p.paid && dl != null && dl < 0;
        const soon = !p.paid && dl != null && dl >= 0 && dl <= 3;
        return `<tr class="${overdue ? "pay-overdue" : soon ? "pay-soon" : ""}${p.forToday ? " pay-today" : ""}" data-id="${p.id}">
          ${payFilter === "paid" ? "" : `<td class="pay-chk"><input type="checkbox" class="pay-sel" data-id="${p.id}" ${paySelected.has(p.id) ? "checked" : ""} /></td>`}
          <td><b>${payFmt(p.dueDate)}</b></td>
          <td class="num">${dl == null ? "" : (dl < 0 ? `<span class="pay-neg">${dl}</span>` : dl)}</td>
          <td>${escapeHtml(p.invoiceNo || "")}</td>
          <td>${payFmt(p.docDate)}</td>
          <td>${escapeHtml(p.supplier || "")}</td>
          <td>${escapeHtml(p.article || "")}</td>
          <td class="num">${payMoney(p.amount)}</td>
          <td class="num"><b>${payMoney(p.amountVat)}</b></td>
          <td>${escapeHtml(p.payMethod || "Банка")}</td>
          ${payFilter === "paid"
            ? `<td>${payFmt(p.paidDate)} <button class="btn btn-small" data-unpay="${p.id}" title="Върни като неплатена">↩</button></td>`
            : `<td class="erp-row-actions"><button class="btn btn-small ${p.forToday ? "pay-today-on" : ""}" data-today="${p.id}" title="Маркирай за плащане ДНЕС (за Крис)">☀ За днес${p.forToday ? " ✓" : ""}</button></td>`}
        </tr>`; }).join("") || `<tr><td colspan="12" class="report-empty">${payFilter === "paid" ? "Няма платени фактури." : "Няма задължения. Импортирай от GenCloud."}</td></tr>`}
      </tbody>
    </table></div>
    ${payFilter !== "paid" ? `<div class="pay-paybar" id="pay-paybar"></div>` : ""}`;

  v.querySelectorAll("[data-pf]").forEach(b => b.addEventListener("click", () => { payFilter = b.dataset.pf; paySelected.clear(); erpRenderPayables(); }));
  const fi = document.getElementById("pay-file"); if (fi) fi.addEventListener("change", e => erpPayImport(e.target.files[0]));
  v.querySelectorAll(".pay-sel").forEach(c => c.addEventListener("change", () => { const id = Number(c.dataset.id); if (c.checked) paySelected.add(id); else paySelected.delete(id); erpPayBar(); }));
  v.querySelectorAll("[data-today]").forEach(b => b.addEventListener("click", () => erpPayToggleToday(Number(b.dataset.today))));
  v.querySelectorAll("[data-unpay]").forEach(b => b.addEventListener("click", () => erpPayUnpay(Number(b.dataset.unpay))));
  erpPayBar();
}

// Лентата „Плати избраните" — сумата с ДДС на избраните.
function erpPayBar() {
  const bar = document.getElementById("pay-paybar"); if (!bar) return;
  const sel = (PAYABLES || []).filter(p => paySelected.has(p.id) && !p.paid);
  const tot = sel.reduce((s, p) => s + payNum(p.amountVat), 0);
  if (!sel.length) { bar.innerHTML = `<span class="erp-muted">Избери фактури с отметка, за да видиш сумата за плащане днес.</span>`; return; }
  bar.innerHTML = `
    <span class="pay-sel-info">Избрани: <b>${sel.length}</b> · за плащане: <b>${payMoney(tot)} EUR</b> (с ДДС)</span>
    <span class="spacer"></span>
    <button class="btn btn-small" id="pay-print">🖨 Списък за Крис</button>
    <button class="btn btn-small btn-primary" id="pay-paysel">✓ Отбележи избраните като платени</button>`;
  document.getElementById("pay-paysel").addEventListener("click", () => erpPayMarkPaid([...paySelected]));
  document.getElementById("pay-print").addEventListener("click", () => erpPayPrint(sel));
}

/* ---------- Платено / върни ---------- */
async function erpPayMarkPaid(ids) {
  ids = ids.filter(Boolean); if (!ids.length) return;
  const today = payToday();
  const d = prompt(`Дата на плащане за ${ids.length} фактур${ids.length === 1 ? "а" : "и"} (ГГГГ-ММ-ДД):`, today);
  if (d === null) return;
  const date = (d || today).trim();
  (PAYABLES || []).forEach(p => { if (ids.includes(p.id)) { p.paid = true; p.paidDate = date; p.forToday = false; } });
  paySelected.clear();
  if (await erpPaySave()) erpRenderPayables();
}
async function erpPayUnpay(id) {
  const p = (PAYABLES || []).find(x => x.id === id); if (!p) return;
  p.paid = false; p.paidDate = "";
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
    let added = 0, updated = 0;
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
      // Дедуп по № + доставчик; обновяваме неплатените, добавяме новите.
      const ex = (PAYABLES || []).find(p => !p.paid && String(p.invoiceNo) === invoiceNo && (p.supplier || "") === supplier);
      if (ex) { Object.assign(ex, rec); updated++; }
      else { PAYABLES.push({ id: payNextId(), paid: false, paidDate: "", ...rec }); added++; }
    });
    if (await erpPaySave()) { payFilter = "all"; erpRenderPayables(); alert(`Импорт готов: ${added} нови, ${updated} обновени.`); }
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}

/* ---------- Връзка с Покупки: покупка Банка+срок → задължение ---------- */
// Извиква се при запис/плащане на покупка. Ако е Банка + срок>0 + неплатена →
// създава/обновява задължение (свързано по srcPurchaseId). Иначе го маха или
// маркира като платено. Сумите се водят в EUR (BGN се превръща).
async function erpPaySyncFromPurchase(o) {
  if (!o || !o.id) return;
  await erpPayLoad();
  const rate = (o.currency === "BGN") ? 1.95583 : 1;
  const t = (typeof erpPuTotals === "function") ? erpPuTotals(o) : { base: 0, total: 0 };
  const qualifies = o.paymentMethod === "Банка" && Number(o.termDays) > 0 && !o.paid;
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
    if (idx >= 0) { if (PAYABLES[idx].paid) return; Object.assign(PAYABLES[idx], fields); }
    else PAYABLES.push({ id: payNextId(), paid: false, paidDate: "", forToday: false, ...fields });
    await erpPaySave();
  } else if (idx >= 0 && !PAYABLES[idx].paid) {
    if (o.paid) { PAYABLES[idx].paid = true; PAYABLES[idx].paidDate = o.paidDate || payToday(); PAYABLES[idx].forToday = false; }
    else PAYABLES.splice(idx, 1);   // Каса/веднага → не е задължение
    await erpPaySave();
  }
}

/* ---------- Печат на списък за плащане (за Крис) ---------- */
function erpPayPrint(items) {
  const tot = items.reduce((s, p) => s + payNum(p.amountVat), 0);
  const rows = items.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.invoiceNo || "")}</td><td>${escapeHtml(p.supplier || "")}</td><td>${payFmt(p.dueDate)}</td><td class="r">${payMoney(p.amountVat)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>За плащане</title>
    <style>body{font-family:Arial,"DejaVu Sans",sans-serif;margin:18px;color:#111}h1{font-size:18px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}th{background:#ecfdf5}
    td.r{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #0f766e}
    @media print{.noprint{display:none}}.noprint{margin:10px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}</style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <h1>Фактури за плащане — ${payFmt(payToday())}</h1>
    <table><thead><tr><th>№</th><th>Фактура</th><th>Доставчик</th><th>Падеж</th><th>Сума с ДДС (EUR)</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" class="r">ОБЩО с ДДС</td><td class="r">${payMoney(tot)} EUR</td></tr></tfoot></table></body></html>`;
  const w = window.open("", "_blank"); if (!w) { alert("Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
