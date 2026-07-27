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
let erpPurchases = null;
let erpPuFolder = "payable";   // payable | paid | all
let erpPuQuery = "";

async function erpLoadPurchases() {
  const { data, error } = await sb.from("purchases").select("*").order("updated_at", { ascending: false });
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
function erpPuCur(o) { return o.currency || "BGN"; }
function erpPuMoney(n, cur) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (cur || "BGN"); }

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

function erpPuTotals(o) {
  const base = (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const rate = Number(o.vatRate != null ? o.vatRate : 20);
  const vat = base * rate / 100;
  return { base, vat, total: base + vat, rate };
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
      <label class="btn btn-small co-attach-btn" title="Импорт на разходи от GenCloud (xlsx) — сумите се вкарват положителни">⤓ Импорт (GenCloud)<input type="file" id="pu-import" accept=".xlsx,.xls" hidden /></label>
      ${(erpPurchases || []).some(p => p.imported) ? '<button class="btn btn-small btn-danger" id="pu-clear-import" title="Изтрий всички импортирани фактури (ръчно въведените остават)">🗑 Изтегли импорта</button>' : ""}
      ${(erpPurchases || []).length ? '<button class="btn btn-small btn-danger" id="pu-clear-all" title="Изтрий ВСИЧКИ фактури от Покупки (и ръчните, и импортираните)">🗑 Изчисти всичко</button>' : ""}
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
      <td data-label="Дата">${escapeHtml(o.date || "")}</td>
      <td data-label="№ Фактура"><b>${escapeHtml(o.invoiceNo || "—")}</b></td>
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

function erpNewPurchase() {
  const today = new Date().toISOString().slice(0, 10);
  erpRenderPurchaseForm({ type: "фактура", supplierName: "", supplierId: null, invoiceNo: "", date: today, payStatus: "deferred", paymentMethod: "Банка", termDays: 0, dueDate: "", paid: false, paidDate: "", paidMethod: "", currency: "BGN", vatRate: 20, note: "", files: [], posted: false, lines: [] });
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
  const groups = [...new Set((erpPurchases || []).flatMap(p => (p.lines || []).map(l => l.groupName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const articles = [...new Set((erpPurchases || []).flatMap(p => (p.lines || []).map(l => l.article)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const due = erpPuDueDate(o);
  const st = erpPuPayStatus(o);
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="pu-back">← Назад</button>
      <span class="erp-count">${escapeHtml(o.invoiceNo ? "Фактура № " + o.invoiceNo : "Нова фактура")}${st === "deferred" && Number(o.termDays) > 0 ? ' · <span class="erp-muted">плащането → Задължения</span>' : ""}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="pu-save">💾 Запази</button>
      ${locked
        ? '<span class="erp-count">✓ Заприходена</span> <button class="btn btn-small btn-danger" id="pu-unpost" title="Връща складовите движения и средните цени, отключва фактурата за поправка. После я заприходи наново.">↩ Върни за редакция</button>'
        : '<button class="btn btn-small" id="pu-post" title="Само материалните редове вдигат склад + средна цена">📥 Заприходи материалите</button>'}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Доставчик <input type="text" id="pu-supplier" list="pu-suppliers" value="${escapeAttr(o.supplierName || "")}" placeholder="избери или въведи" />
          <datalist id="pu-suppliers">${suppliers.map(s => `<option value="${escapeAttr(s.name)}"></option>`).join("")}</datalist></label>
        <label>№ Фактура <input type="text" id="pu-invoice" value="${escapeAttr(o.invoiceNo || "")}" /></label>
        <label>Дата <input type="date" id="pu-date" value="${escapeAttr(o.date || "")}" /></label>
        <label>Плащане <select id="pu-pay">${PU_PAY_OPTS.map(p => `<option value="${p.k}" ${st === p.k ? "selected" : ""}>${p.label}</option>`).join("")}</select></label>
        <label id="pu-term-wrap" ${st !== "deferred" ? 'style="display:none"' : ""}>Срок (дни) <input type="number" id="pu-term" min="0" value="${escapeAttr(String(o.termDays || 0))}" placeholder="напр. 30" /></label>
        <label id="pu-due-wrap" ${st !== "deferred" ? 'style="display:none"' : ""}>Дата за плащане <input type="date" id="pu-due" value="${escapeAttr(due)}" /></label>
        <label id="pu-paid-wrap" ${st === "deferred" ? 'style="display:none"' : ""}>Платена на <input type="date" id="pu-paiddate" value="${escapeAttr(o.paidDate || "")}" /></label>
        <label>Валута <select id="pu-cur"><option ${erpPuCur(o) === "BGN" ? "selected" : ""}>BGN</option><option ${erpPuCur(o) === "EUR" ? "selected" : ""}>EUR</option></select></label>
        <label>ДДС ставка % <select id="pu-vat">${["20", "9", "0"].map(r => `<option value="${r}" ${Number(r) === Number(o.vatRate) ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
        <label>Вид разход <select id="pu-etype"><option value="">— избери —</option>${PU_EXPENSE_TYPES.map(t => `<option value="${escapeAttr(t.k)}" ${t.k === o.expenseType ? "selected" : ""}>${t.mat ? "🧱 " : ""}${escapeHtml(t.k)}</option>`).join("")}</select></label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="pu-note" rows="2">${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">📎 Файл на фактурата</h4>
      <div class="erp-co-files"><div id="pu-files-list">${erpPuFilesHtml(o)}</div>
        <label class="btn btn-small co-attach-btn">⬆ Прикачи файл<input type="file" id="pu-file-input" multiple hidden /></label>
        <span class="erp-muted" id="pu-file-status"></span></div>

      <h4 class="erp-group-head">Редове (класификация)</h4>
      <table class="report-table erp-table" id="pu-lines">
        <thead><tr><th>Група</th><th>Артикул</th><th>Код</th><th class="num">Кол.</th><th>МЕ</th><th class="num">Ед. цена</th><th class="num">Сума</th><th></th></tr></thead>
        <tbody>${erpPuLinesHtml(o, locked)}</tbody>
      </table>
      <div class="erp-co-actions">
        <button class="btn btn-small" id="pu-add-mat">+ Материал (склад)</button>
        <button class="btn btn-small" id="pu-add-exp">+ Разход / услуга</button>
      </div>
      ${erpPuProfileChipsHtml(o)}
      <datalist id="pu-groups">${groups.map(g => `<option value="${escapeAttr(g)}"></option>`).join("")}</datalist>
      <datalist id="pu-articles">${articles.map(a => `<option value="${escapeAttr(a)}"></option>`).join("")}</datalist>
      <div class="erp-sale-totals" id="pu-totals"></div>
      <p class="hint">„Материал (склад)" се брои при заприходяване (вдига наличност + средна цена). „Разход/услуга" се класифицира и плаща, но не влиза в склада. Средните цени се водят в EUR — BGN се превръща авт.</p>
    </div>`;

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
  document.getElementById("pu-cur").addEventListener("change", e => { o.currency = e.target.value; erpPuTotalsBox(o); });
  document.getElementById("pu-vat").addEventListener("change", e => { o.vatRate = Number(e.target.value); erpPuTotalsBox(o); });
  document.getElementById("pu-etype").addEventListener("change", e => {
    o.expenseType = e.target.value;
    // Материален вид без материални редове → подсказка (да не се забрави заприходяването).
    if (erpPuTypeIsMat(o.expenseType) && !(o.lines || []).some(l => l.materialId))
      alert("🧱 " + o.expenseType + " е материален разход — добави редовете с бутона + Материал (склад), за да влязат в склада при заприходяване.");
  });
  document.getElementById("pu-back").addEventListener("click", erpRenderPurchases);
  document.getElementById("pu-save").addEventListener("click", () => erpPuSaveClick(o));
  const postBtn = document.getElementById("pu-post"); if (postBtn) postBtn.addEventListener("click", () => erpPostPurchase(o));
  const unpostBtn = document.getElementById("pu-unpost"); if (unpostBtn) unpostBtn.addEventListener("click", () => erpUnpostPurchase(o));
  document.getElementById("pu-add-mat").addEventListener("click", () => erpPuAddMaterial(o));
  document.getElementById("pu-add-exp").addEventListener("click", () => { o.lines.push({ groupName: "", article: "", code: "", batch: "", qty: 1, unit: "бр.", unitPrice: "" }); erpPuRefreshFull(o); });
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
      <td data-label="Група">${ro ? escapeHtml(l.groupName || "") : `<input type="text" class="pu-grp" data-i="${i}" list="pu-groups" value="${escapeAttr(l.groupName || "")}" style="width:120px" />`}</td>
      <td data-label="Артикул">${ro ? escapeHtml(l.article || l.name || "") : `<input type="text" class="pu-art" data-i="${i}" list="pu-articles" value="${escapeAttr(l.article || l.name || "")}" style="width:150px" />`}</td>
      <td data-label="Код">${escapeHtml(l.code || "")}${isMat ? ' <span class="erp-muted">склад</span>' : ""}</td>
      <td class="num" data-label="Кол.">${ro ? erpNum(l.qty) : `<input type="number" class="pu-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:80px" />`}</td>
      <td data-label="МЕ">${ro ? escapeHtml(l.unit || "") : `<input type="text" class="pu-unit" data-i="${i}" value="${escapeAttr(l.unit || "бр.")}" style="width:52px" />`}</td>
      <td class="num" data-label="Ед. цена">${ro ? erpNum(l.unitPrice) : `<input type="number" class="pu-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:90px" placeholder="—" />`}</td>
      <td class="num" data-label="Сума">${erpPuMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpPuCur(o))}</td>
      <td class="erp-row-actions">${ro ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">Няма редове. Добави материал или разход.</td></tr>`;
}
function erpPuWireLines(o, locked) {
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  const line = el => o.lines[Number(el.dataset.i)];
  body.querySelectorAll(".pu-grp").forEach(el => el.addEventListener("input", () => line(el).groupName = el.value));
  body.querySelectorAll(".pu-art").forEach(el => el.addEventListener("input", () => line(el).article = el.value));
  body.querySelectorAll(".pu-unit").forEach(el => el.addEventListener("input", () => line(el).unit = el.value));
  body.querySelectorAll(".pu-qty").forEach(el => el.addEventListener("input", () => { line(el).qty = erpToNum(el.value); erpPuLineSums(o); }));
  body.querySelectorAll(".pu-price").forEach(el => el.addEventListener("input", () => { line(el).unitPrice = erpToNum(el.value); erpPuLineSums(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpPuRefreshFull(o); }));
}
function erpPuLineSums(o) {
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => { const l = (o.lines || [])[i]; if (!l) return; const c = tr.querySelector('td[data-label="Сума"]'); if (c) c.textContent = erpPuMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpPuCur(o)); });
  erpPuTotalsBox(o);
}
function erpPuRefreshFull(o) { const body = document.querySelector("#pu-lines tbody"); if (body) { body.innerHTML = erpPuLinesHtml(o, !!o.posted); erpPuWireLines(o, !!o.posted); } erpPuTotalsBox(o); }
function erpPuTotalsBox(o) {
  const box = document.getElementById("pu-totals"); if (!box) return;
  const t = erpPuTotals(o); const cur = erpPuCur(o);
  const eur = cur === "BGN" ? ` <span class="erp-muted">≈ ${erpPuMoney(t.total / PU_EUR_BGN, "EUR")}</span>` : "";
  box.innerHTML = `<table class="erp-sale-sum">
    <tr><td>Данъчна основа</td><td class="num">${erpPuMoney(t.base, cur)}</td></tr>
    <tr><td>ДДС ${t.rate}%</td><td class="num">${erpPuMoney(t.vat, cur)}</td></tr>
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
    currency: last.currency || "BGN", vatRate: last.vatRate != null ? last.vatRate : 20,
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
      o.lines.push({ materialId: m.id, code: m.code, name: m.name, article: m.name, groupName: m.group_name || "", unit: m.unit, qty: 1, unitPrice: "" });
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

async function erpPuSaveClick(o) {
  const btn = document.getElementById("pu-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  erpPuApplyPay(o);   // синхронизира paid/срок/дата според избрания статус на плащане
  try {
    await erpSavePurchase(o); await erpLoadPurchases();
    try { if (typeof erpPaySyncFromPurchase === "function") await erpPaySyncFromPurchase(o); } catch (e) {}   // Банка+срок → Задължения
    if (btn) { btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) { btn.textContent = "💾 Запази"; btn.disabled = false; } }, 1400); }
  }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; } alert("Грешка при запис: " + (e.message || e)); }
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
      <tbody>${r.slice(0, 200).map(x => `<tr><td><b>${escapeHtml(x.code)}</b></td><td>${escapeHtml(x.article)}</td><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.supplier)}</td><td class="num">${erpNum(x.qty)}</td><td class="num">${erpPuMoney(x.price, x.cur)}</td><td>${escapeHtml(x.inv)}</td></tr>`).join("")}</tbody></table>`
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
        p.date || "", p.invoiceNo || "", p.supplierName || "", (erpPuTypeIsMat(p.expenseType) ? "[М] " : "") + (p.expenseType || ""),
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

/* ---------- Заприходяване (само материалните редове; BGN→EUR за средната цена) ---------- */
async function erpPostPurchase(o) {
  if (o.posted) { alert("Вече е заприходена."); return; }
  const matLines = (o.lines || []).filter(l => l.materialId && (erpToNum(l.qty) || 0) > 0);
  if (!matLines.length) { alert("Няма материални редове за заприходяване. Само редове, добавени с бутона Материал (склад), влизат в склада."); return; }
  if (!confirm(`Да заприходя ли ${matLines.length} материала в склада? Наличностите се вдигат и средните цени се обновяват (веднъж).`)) return;
  try { await erpSavePurchase(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

  const [stk, mat] = await Promise.all([sb.from("v_material_stock").select("id,stock"), sb.from("materials").select("id,avg_cost")]);
  if (stk.error || mat.error) { alert("Грешка: " + ((stk.error || mat.error).message)); return; }
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
  if (ins.error) { alert("Грешка при движенията: " + ins.error.message); return; }
  for (const u of avgUpdates) { const { error } = await sb.from("materials").update({ avg_cost: u.avg }).eq("id", u.id); if (error) { alert("Грешка при цена: " + error.message); return; } }

  o.posted = true; o.postedAt = new Date().toISOString();
  try { await erpSavePurchase(o); } catch {}
  await erpLoadAll(); await erpLoadPurchases();
  alert(`Готово! Заприходени ${moves.length} материала. Средните цени (EUR) са обновени.`);
  erpRenderPurchaseForm(o);
}

/* ---------- Връщане за редакция (отзаприходяване) ----------
   При грешка в заприходена фактура: маха складовите движения на тази фактура,
   връща средните цени по обратната формула и отключва всичко за поправка.
   После фактурата се заприходява наново с верните данни. */
async function erpUnpostPurchase(o) {
  if (!o.posted) return;
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
