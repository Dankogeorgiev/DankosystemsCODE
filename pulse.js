/* Данко Системс — „Пулс" (табло на собственика).
   Един екран с най-важното в момента: производство днес, заявки, закъснели,
   незавършено производство по цех, материали под минимум. Достъп само за
   PULSE_EMAILS (pulseAllowed). Ползва erpSelectAll/escapeHtml/erpNum от другите файлове. */

function pulseToday() { return new Date().toISOString().slice(0, 10); }

async function openPulse() {
  if (typeof pulseAllowed === "function" && !pulseAllowed()) { alert("Нямаш достъп до Пулс."); return; }
  const m = document.getElementById("pulse-modal");
  if (!m) return;
  m.hidden = false;
  await renderPulse();
}
function closePulse() { const m = document.getElementById("pulse-modal"); if (m) m.hidden = true; }

/* Пулсът има два под-таба: „⚡ Днес" (класическото табло) и „📅 Месечни резултати". */
let PULSE_TAB = "today";
async function renderPulse() {
  const view = document.getElementById("pulse-view");
  if (!view) return;
  view.innerHTML = `
    <div class="pr-row" style="margin-bottom:8px">
      <button class="btn btn-small ${PULSE_TAB === "today" ? "btn-primary" : ""}" id="pu-nav-t">⚡ Днес</button>
      <button class="btn btn-small ${PULSE_TAB === "monthly" ? "btn-primary" : ""}" id="pu-nav-m">📅 Месечни резултати</button>
    </div><div id="pulse-body"><p class="erp-loading">Зареждане на пулса…</p></div>`;
  view.querySelector("#pu-nav-t").addEventListener("click", () => { PULSE_TAB = "today"; renderPulse(); });
  view.querySelector("#pu-nav-m").addEventListener("click", () => { PULSE_TAB = "monthly"; renderPulse(); });
  const body = view.querySelector("#pulse-body");
  if (PULSE_TAB === "monthly") await pulseMonthly(body);
  else await pulseRenderToday(body);
}

async function pulseRenderToday(v) {
  if (!v) return;
  v.innerHTML = `<p class="erp-loading">Зареждане на пулса…</p>`;
  const today = pulseToday();
  let orders = [], tasks = [], lowMat = [], sales = [], invoices = [], purchases = [], recvList = [], payList = [];
  try {
    const [co, tk, mat, sl, inv, pu, cfg] = await Promise.all([
      erpSelectAll("customer_orders", "data"),
      erpSelectAll("tasks", "data,done"),
      erpSelectAll("v_material_stock", "code,name,stock,min_stock,below_min", "below_min", true),
      erpSelectAll("sales", "data").catch(() => ({ data: [] })),
      erpSelectAll("invoices", "data,posted,kind").catch(() => ({ data: [] })),
      erpSelectAll("purchases", "data").catch(() => ({ data: [] })),
      sb.from("app_config").select("id,data").in("id", ["receivables", "payables"]).then(r => r).catch(() => ({ data: [] })),
    ]);
    orders = (co.data || []).map(r => r.data || {});
    tasks = tk.data || [];
    lowMat = mat.data || [];
    sales = (sl && sl.data || []).map(r => r.data || {});
    invoices = (inv && inv.data || []).map(r => ({ posted: r.posted, kind: r.kind, ...(r.data || {}) }));
    purchases = (pu && pu.data || []).map(r => r.data || {});
    const cfgRows = (cfg && cfg.data) || [];
    recvList = ((cfgRows.find(r => r.id === "receivables") || {}).data || {}).list || [];
    payList = ((cfgRows.find(r => r.id === "payables") || {}).data || {}).list || [];
  } catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Грешка при зареждане</h3><p>${escapeHtml(e.message || String(e))}</p></div>`;
    return;
  }

  // Заявки
  const activeOrders = orders.filter(o => (o.status || "нова") !== "завършена");
  const inProd = activeOrders.filter(o => o.production || o.status === "в производство");
  const overdue = activeOrders.filter(o => o.deadline && o.deadline < today)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));

  // Производство днес + незавършено (WIP) по цех
  let todayQty = 0, todayEntries = 0;
  const workersToday = new Set();
  const wipByWs = {};
  tasks.forEach(r => {
    const t = r.data || {};
    const isExtra = t.source && t.source.kind === "extra";
    (t.logs || []).forEach(l => {
      if (l.date === today) {
        todayQty += Number(l.qty) || 0; todayEntries++;
        if (l.worker) workersToday.add(l.worker);
      }
    });
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    const isDone = r.done || (qty > 0 && prod >= qty);
    if (!isDone && !isExtra && t.workshop) wipByWs[t.workshop] = (wipByWs[t.workshop] || 0) + 1;
  });
  const wipRows = Object.entries(wipByWs).sort((a, b) => b[1] - a[1]);
  const totalWip = wipRows.reduce((s, [, n]) => s + n, 0);

  // Пари: стойност на всички заявки + продажби за месеца (без ДДС), по валута.
  const num = v => (typeof erpToNum === "function") ? erpToNum(v) : (Number(v) || 0);
  const lineNet = arr => (arr || []).reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0);
  const money = (n, cur) => Math.round(n).toLocaleString("bg-BG") + " " + (cur === "BGN" ? "лв" : cur === "EUR" ? "€" : (cur || "€"));
  // Заявки: колко пари ОСТАВАТ за изпълнение (поръчано − вече доставено), само
  // по активните. Цялата стойност е подвеждаща — част от нея вече е изпратена.
  const lineLeft = arr => (arr || []).reduce((a, l) => {
    const q = num(l.qty);
    const d = Math.min(Math.max(0, Number(l.delivered) || 0), q);
    return a + (q - d) * num(l.unitPrice);
  }, 0);
  const ordersValue = activeOrders.reduce((s, o) => s + lineNet(o.lines), 0);
  const ordersLeft = activeOrders.reduce((s, o) => s + lineLeft(o.lines), 0);
  const ordersDone = Math.max(0, ordersValue - ordersLeft);
  const month = today.slice(0, 7);
  // (картата „продажби месец" е премахната — фактурираното е меродавното)

  // Финанси: приходи (издадени фактури този месец), разходи (покупки този месец),
  // вземания от клиенти и задължения към доставчици. Всичко в EUR (BGN → /1.95583).
  const toEur = (n, cur) => cur === "BGN" ? n / 1.95583 : n;
  let invMonth = 0, invToday = 0, invTodayVat = 0, invTodayN = 0;
  invoices.forEach(o => {
    if (!o.posted || o.kind === "proforma") return;
    const d = String(o.issueDate || "").slice(0, 10);
    if (d.slice(0, 7) !== month && d !== today) return;
    const sign = o.kind === "credit" ? -1 : 1;
    const net = sign * toEur(lineNet(o.lines), o.currency || "EUR");
    if (d.slice(0, 7) === month) invMonth += net;
    if (d === today) {
      const rate = Number(o.vatRate != null ? o.vatRate : 20);
      invToday += net; invTodayVat += net * (1 + rate / 100); invTodayN++;
    }
  });
  let purchMonth = 0;
  purchases.forEach(o => {
    if (String(o.date || "").slice(0, 7) !== month) return;
    if (o.docType === "goods") return;   // стоковата разписка не е разход — парите идват с покриващата фактура
    const pSign = o.docType === "credit" ? -1 : 1;   // кредитно известие: намалява разхода
    purchMonth += pSign * toEur(lineNet(o.lines), o.currency || "BGN");
  });
  // Платени заплати за месеца (Заплати седмично): От банка + CODE 005.
  let salMonth = 0;
  try {
    const { data: pr } = await sb.from("app_config").select("data").eq("id", "payroll_m_" + month).maybeSingle();
    const entries = (pr && pr.data && pr.data.entries) || {};
    if (typeof payFridays === "function" && typeof payFriNormalize === "function") {
      const [pY, pM] = month.split("-").map(Number);
      const fridays = payFridays(pY, pM);
      Object.values(entries).forEach(r => {
        const map = payFriNormalize(r || {}, fridays);
        Object.values(map).forEach(x => { salMonth += (Number(x.b) || 0) + (Number(x.c) || 0); });
      });
    }
  } catch (e) { /* без заплати, ако модулът/записът липсва */ }

  // ДДС за месеца: начислено по издадените фактури − ДДС по покупките.
  let vatOut = 0, vatIn = 0;
  invoices.forEach(o => {
    if (!o.posted || o.kind === "proforma") return;
    if (String(o.issueDate || "").slice(0, 7) !== month) return;
    const sign = o.kind === "credit" ? -1 : 1;
    const rate = Number(o.vatRate != null ? o.vatRate : 20);
    vatOut += sign * toEur(lineNet(o.lines) * rate / 100, o.currency || "EUR");
  });
  purchases.forEach(o => {
    if (String(o.date || "").slice(0, 7) !== month) return;
    if (o.docType === "goods") return;   // ДДС кредитът идва с покриващата фактура, не със стоковата
    // Смесени ставки по редове (напр. Идънред/Йетел) — броим точно, ред по ред.
    if (typeof erpPuTotals === "function") { vatIn += toEur(erpPuTotals(o).vat, o.currency || "BGN"); return; }
    const rate = Number(o.vatRate != null ? o.vatRate : 20);
    vatIn += (o.docType === "credit" ? -1 : 1) * toEur(lineNet(o.lines) * rate / 100, o.currency || "BGN");
  });
  const vatDue = vatOut - vatIn;   // >0 → за внасяне; <0 → за възстановяване

  const recvUnpaid = recvList.filter(p => !p.paid);
  // Остатък = сума − частичните плащания (p.payments).
  const recvRest = p => (num(p.amount) || 0) - (p.payments || []).reduce((s, x) => s + (num(x.amount) || 0), 0);
  const recvSum = recvUnpaid.reduce((s, p) => s + recvRest(p), 0);
  const recvOver = recvUnpaid.filter(p => p.dueDate && p.dueDate < today)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const recvOverSum = recvOver.reduce((s, p) => s + recvRest(p), 0);
  const payUnpaid = payList.filter(p => !p.paid);
  // Остатък по фактура = с ДДС − платеното до момента (частичните плащания) —
  // същата сметка като в екрана „Задължения", иначе Пулсът показваше пълните
  // суми и се разминаваше с него.
  const payRest = p => Math.max(0, (num(p.amountVat) || 0) - (num(p.paidAmount) || 0));
  const paySum = payUnpaid.reduce((s, p) => s + payRest(p), 0);
  // Дължимо до края на месеца (с ДДС): неплатени фактури със срок до последния
  // ден на текущия месец — включително вече просрочените.
  const eomD = new Date(); const eom = `${eomD.getFullYear()}-${String(eomD.getMonth() + 1).padStart(2, "0")}-${String(new Date(eomD.getFullYear(), eomD.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const payMonthItems = payUnpaid.filter(p => p.dueDate && p.dueDate <= eom);
  const payMonthSum = payMonthItems.reduce((s, p) => s + payRest(p), 0);
  // Задължения СЛЕДВАЩ месец (с ДДС): падеж след края на този месец, до края на следващия.
  const nmEndD = new Date(eomD.getFullYear(), eomD.getMonth() + 2, 0);
  const nmEom = `${nmEndD.getFullYear()}-${String(nmEndD.getMonth() + 1).padStart(2, "0")}-${String(nmEndD.getDate()).padStart(2, "0")}`;
  const payNextItems = payUnpaid.filter(p => p.dueDate && p.dueDate > eom && p.dueDate <= nmEom);
  const payNextSum = payNextItems.reduce((s, p) => s + payRest(p), 0);

  // Всяка карта е ВРАТА към модула, от който идват числата ѝ (go = ЕРП раздел
  // или "tasks" за Цехове) — клик = отиваш там.
  const card = (label, value, cls, go) => `<div class="pulse-card ${cls || ""}${go ? " pulse-go" : ""}"${go ? ` data-go="${go}" title="Отвори: ${escapeHtml(pulseGoLabel(go))}"` : ""}><div class="pulse-val">${value}</div><div class="pulse-lbl">${label}</div></div>`;

  v.innerHTML = `
    <div class="pulse-cards">
      ${card(`фактурирано ДНЕС (без ДДС) · ${invTodayN} бр. · с ДДС ${money(invTodayVat, "EUR")}`, money(invToday, "EUR"), invTodayN ? "money" : "", "invoices")}
      ${card("фактурирано месец (без ДДС)", money(invMonth, "EUR"), "money", "invoices")}
      ${card("разходи месец (без ДДС)", money(purchMonth, "EUR"), "money", "purchases")}
      ${card("вземания от клиенти (с ДДС)", money(recvSum, "EUR"), recvOver.length ? "warn" : "money", "receivables")}
      ${card("от тях просрочени", money(recvOverSum, "EUR") + " · " + recvOver.length + " бр.", recvOver.length ? "danger" : "", "receivables")}
      ${card("общо задължения (с ДДС)", money(paySum, "EUR"), "", "payables")}
      ${card("дължимо до края на месеца (с ДДС)", money(payMonthSum, "EUR") + " · " + payMonthItems.length + " бр.", payMonthItems.length ? "warn" : "", "payables")}
      ${card("задължения следващ месец (с ДДС)", money(payNextSum, "EUR") + " · " + payNextItems.length + " бр.", payNextItems.length ? "info" : "", "payables")}
      ${card(`оставащи заявки · поръчани ${money(ordersValue, "EUR")}, доставени ${money(ordersDone, "EUR")}`, money(ordersLeft, "EUR"), "money", "customer")}
      ${card("платени заплати месец (банка + 005)", money(salMonth, "EUR"), "money", "finance")}
      ${card(vatDue >= 0 ? "ДДС за внасяне (месец)" : "ДДС за възстановяване (месец)", money(Math.abs(vatDue), "EUR"), vatDue >= 0 ? "warn" : "ok", "invoices")}
      ${card("произведено днес (бр.)", erpNum(todayQty), "ok", "tasks")}
      ${card("работници днес", workersToday.size, "", "tasks")}
      ${card("активни заявки", activeOrders.length, "", "customer")}
      ${card("в производство", inProd.length, "info", "customer")}
      ${card("закъснели заявки", overdue.length, overdue.length ? "danger" : "", "customer")}
      ${card("незавършени задачи", totalWip, "", "tasks")}
      ${card("материали под минимум", lowMat.length, lowMat.length ? "warn" : "", "materials")}
    </div>
    <div class="pulse-grid">
      <div class="pulse-panel">
        <h4>🏭 Незавършено производство по цех</h4>
        ${wipRows.length
          ? `<table class="report-table"><tbody>${wipRows.map(([w, n]) => `<tr><td>${escapeHtml(w)}</td><td class="num"><b>${n}</b> задачи</td></tr>`).join("")}</tbody></table>`
          : `<p class="erp-muted">Няма незавършени задачи.</p>`}
      </div>
      <div class="pulse-panel">
        <h4>💵 Просрочени вземания (${recvOver.length})</h4>
        ${recvOver.length
          ? `<table class="report-table"><thead><tr><th>Клиент</th><th>Фактура</th><th>Падеж</th><th class="num">EUR</th></tr></thead><tbody>${recvOver.slice(0, 15).map(p => `<tr><td>${escapeHtml(p.client || "")}</td><td>${escapeHtml(p.invoiceNo || "")}</td><td class="pulse-danger">${erpDMY(p.dueDate)}</td><td class="num">${money(num(p.amount) || 0, "EUR")}</td></tr>`).join("")}</tbody></table>${recvOver.length > 15 ? `<p class="erp-muted">…и още ${recvOver.length - 15}</p>` : ""}`
          : `<p class="erp-muted">Няма просрочени вземания. 🎉</p>`}
      </div>
      <div class="pulse-panel">
        <h4>⏰ Закъснели заявки (${overdue.length})</h4>
        ${overdue.length
          ? `<table class="report-table"><thead><tr><th>№</th><th>Клиент</th><th>Срок</th></tr></thead><tbody>${overdue.slice(0, 25).map(o => `<tr><td>${escapeHtml(o.ourNo || "—")}</td><td>${escapeHtml(o.clientName || "")}</td><td class="pulse-danger">${erpDMY(o.deadline)}</td></tr>`).join("")}</tbody></table>${overdue.length > 25 ? `<p class="erp-muted">…и още ${overdue.length - 25}</p>` : ""}`
          : `<p class="erp-muted">Няма закъснели заявки. 🎉</p>`}
      </div>
      <div class="pulse-panel">
        <h4>🧱 Материали под минимум (${lowMat.length})</h4>
        ${lowMat.length
          ? `<table class="report-table"><thead><tr><th>Код</th><th>Материал</th><th class="num">Налично</th><th class="num">Мин.</th></tr></thead><tbody>${lowMat.slice(0, 40).map(m => `<tr><td>${escapeHtml(m.code || "")}</td><td>${escapeHtml(m.name || "")}</td><td class="num pulse-warn">${erpNum(m.stock)}</td><td class="num">${erpNum(m.min_stock)}</td></tr>`).join("")}</tbody></table>${lowMat.length > 40 ? `<p class="erp-muted">…и още ${lowMat.length - 40}</p>` : ""}`
          : `<p class="erp-muted">Всичко е над минимума. 👍</p>`}
      </div>
    </div>
    <p class="erp-muted pulse-ts">Днес: ${today} · ${todayEntries} записа · обновено ${new Date().toLocaleTimeString("bg-BG")}</p>`;

  v.querySelectorAll(".pulse-go").forEach(c => c.addEventListener("click", () => pulseGoto(c.dataset.go)));
}

/* Клик върху карта → модулът-източник. "tasks" отваря Цехове; всичко друго
   е ЕРП раздел (erpSetTab имената от erpDispatchTab). */
const PULSE_GO_LABELS = {
  invoices: "Фактуриране", purchases: "Покупки", receivables: "Вземания",
  payables: "Задължения", customer: "Заявки", finance: "Финанси",
  materials: "Склад материали", tasks: "Производство · Цехове",
};
function pulseGoLabel(go) { return PULSE_GO_LABELS[go] || go; }
function pulseGoto(go) {
  if (!go) return;
  closePulse();
  if (go === "tasks") {
    if (typeof openTasks === "function") openTasks();
    return;
  }
  if (typeof openErp === "function") {
    if (typeof ERP !== "undefined") ERP.tab = go;
    openErp();
  }
}

function pulseInit() {
  const btn = document.getElementById("btn-pulse");
  if (btn) btn.addEventListener("click", openPulse);
  const btn2 = document.getElementById("erp-pulse-btn");   // бутонът в Склад/ЕРП (синята група)
  if (btn2) btn2.addEventListener("click", openPulse);
  const c = document.getElementById("pulse-close"); if (c) c.addEventListener("click", closePulse);
  const r = document.getElementById("pulse-refresh"); if (r) r.addEventListener("click", renderPulse);
}
document.addEventListener("DOMContentLoaded", pulseInit);

/* ---------- 📅 Месечни резултати ----------
   Ред за всеки месец (последните 12):
   • Фактури без ДДС — АВТОМАТИЧНО от издадените фактури (+ДИ, −КИ, без проформи);
   • Стокови разписки и 005 — РЪЧНО (продажби без фактура), влизат в Общо продажби;
   • Заплати — АВТОМАТИЧНО: „ОБЩО получено" от Месечния отчет (Заплати седмично);
   • Осигуровки — АВТОМАТИЧНО от Ведомостта (payroll_osig_<месец>, вкл. „извън
     списъка"); ако за месеца няма ведомост — поле за РЪЧНО въвеждане;
   • Кредити — РЪЧНО;
   • Резултат = Общо продажби − Заплати − Осигуровки − Кредити.
   Ръчните стойности се пазят в app_config „pulse_monthly". */

async function pulseMonthlyLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "pulse_monthly").maybeSingle(); return (data && data.data && data.data.months) || {}; }
  catch (e) { return {}; }
}
/* Регистър „Стокови/005" (продажби без фактура): list = записите (клиент,
   сума, неплатено), deleted = натрупаните суми на ИЗТРИТИ записи по месец —
   така месечният сбор не пада, дори записът да се разчисти от списъка. */
async function pulseC005Load() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "pulse_c005").maybeSingle(); const d = (data && data.data) || {}; return { list: d.list || [], deleted: d.deleted || {} }; }
  catch (e) { return { list: [], deleted: {} }; }
}
async function pulseC005Save(store) {
  const { error } = await sb.from("app_config").upsert({ id: "pulse_c005", data: store, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
async function pulseMonthlySave(months) {
  const { error } = await sb.from("app_config").upsert({ id: "pulse_monthly", data: { months }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

async function pulseMonthly(v) {
  v.innerHTML = `<p class="erp-loading">Смятам месеците…</p>`;
  const toEur = (n, cur) => cur === "BGN" ? n / 1.95583 : n;
  const num = x => (typeof erpToNum === "function") ? erpToNum(x) : (Number(x) || 0);
  const lineNet = arr => (arr || []).reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0);
  const eur = n => (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

  // Месеците от юли 2026 (началото на пълните данни) до текущия, най-новият отгоре.
  const PULSE_M_START = "2026-07";
  const months = [];
  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (m < PULSE_M_START) break;
    months.push(m);
  }

  let manual = {}, invoices = [], purchases = [], payRows = [], c005Store = { list: [], deleted: {} };
  try {
    const [man, inv, pu, pr, c5] = await Promise.all([
      pulseMonthlyLoad(),
      erpSelectAll("invoices", "data,posted,kind").catch(() => ({ data: [] })),
      erpSelectAll("purchases", "data").catch(() => ({ data: [] })),
      sb.from("app_config").select("id,data").like("id", "payroll%").then(r => r).catch(() => ({ data: [] })),
      pulseC005Load(),
    ]);
    manual = man || {};
    invoices = ((inv && inv.data) || []).map(r => ({ posted: r.posted, kind: r.kind, ...(r.data || {}) }));
    purchases = ((pu && pu.data) || []).map(r => r.data || {});
    payRows = (pr && pr.data) || [];
    c005Store = c5 || { list: [], deleted: {} };
  } catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Грешка при зареждане</h3><p>${escapeHtml(e.message || String(e))}</p></div>`;
    return;
  }

  // Фактурирано без ДДС по месеци (посочени, без проформи; КИ с минус) + ДДС продажби.
  const invByMonth = {}, vatOutByMonth = {};
  invoices.forEach(o => {
    if (!o.posted || o.kind === "proforma") return;
    const m = String(o.issueDate || "").slice(0, 7);
    if (!m) return;
    const sign = o.kind === "credit" ? -1 : 1;
    const net = sign * toEur(lineNet(o.lines), o.currency || "EUR");
    invByMonth[m] = (invByMonth[m] || 0) + net;
    const rate = Number(o.vatRate != null ? o.vatRate : 20);
    vatOutByMonth[m] = (vatOutByMonth[m] || 0) + net * rate / 100;
  });

  // Разходи: всички Покупки за месеца без ДДС (стоковата разписка не е разход,
  // кредитното известие е с минус) + ДДС покупки (точно, ред по ред при смесени ставки).
  const purByMonth = {}, vatInByMonth = {};
  purchases.forEach(o => {
    const m = String(o.date || "").slice(0, 7);
    if (!m) return;
    if (o.docType === "goods") return;
    const pSign = o.docType === "credit" ? -1 : 1;
    purByMonth[m] = (purByMonth[m] || 0) + pSign * toEur(lineNet(o.lines), o.currency || "BGN");
    if (typeof erpPuTotals === "function") vatInByMonth[m] = (vatInByMonth[m] || 0) + toEur(erpPuTotals(o).vat, o.currency || "BGN");
    else {
      const rate = Number(o.vatRate != null ? o.vatRate : 20);
      vatInByMonth[m] = (vatInByMonth[m] || 0) + pSign * toEur(lineNet(o.lines) * rate / 100, o.currency || "BGN");
    }
  });

  // Заплати („ОБЩО получено" като в Месечния отчет) и осигуровки (ведомостта) по месеци.
  const salByMonth = {}, osigByMonth = {};
  const weekRows = payRows.filter(r => /^payroll_\d{4}-\d{2}-\d{2}$/.test(String(r.id || "")));
  const friRows = payRows.filter(r => /^payroll_m_\d{4}-\d{2}$/.test(String(r.id || "")));
  const osigRows = payRows.filter(r => /^payroll_osig_\d{4}-\d{2}$/.test(String(r.id || "")));
  weekRows.forEach(r => {
    const mon = (r.data && r.data.monday) || String(r.id).replace("payroll_", "");
    const m = String(mon).slice(0, 7);
    Object.values((r.data && r.data.entries) || {}).forEach(e => {
      ["bank", "cash", "nadnik", "overtime", "bonus"].forEach(k => { salByMonth[m] = (salByMonth[m] || 0) + (Number(e[k]) || 0); });
    });
  });
  friRows.forEach(r => {
    const m = String(r.id).replace("payroll_m_", "");
    const [fY, fM] = m.split("-").map(Number);
    const fridays = (typeof payFridays === "function") ? payFridays(fY, fM) : [];
    Object.values((r.data && r.data.entries) || {}).forEach(e => {
      if (typeof payFriNormalize === "function") {
        const map = payFriNormalize(e || {}, fridays);
        Object.values(map).forEach(x => { salByMonth[m] = (salByMonth[m] || 0) + (Number(x.b) || 0) + (Number(x.c) || 0) + (Number(x.o) || 0); });
      }
      salByMonth[m] = (salByMonth[m] || 0) + (Number((e && e.rz || {}).sum) || 0);
    });
  });
  osigRows.forEach(r => {
    const m = String(r.id).replace("payroll_osig_", "");
    const d = r.data || {};
    let s = 0;
    Object.values(d.byName || {}).forEach(x => { s += Number(x) || 0; });
    (d.extra || []).forEach(x => { s += Number(x.osig) || 0; });
    if (s) osigByMonth[m] = s;
  });

  // 005 по месеци: активните записи + натрупаното от изтритите (+ старо ръчно c005, ако е имало).
  const c005ByMonth = {};
  (c005Store.list || []).forEach(r => { const m = String(r.date || "").slice(0, 7); if (m) c005ByMonth[m] = (c005ByMonth[m] || 0) + (Number(r.amount) || 0); });
  Object.keys(c005Store.deleted || {}).forEach(m => { c005ByMonth[m] = (c005ByMonth[m] || 0) + (Number(c005Store.deleted[m]) || 0); });
  const unpaidSum = (c005Store.list || []).filter(r => r.unpaid).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const MONTH_BG = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
  const mLabel = m => { const [y, mm] = m.split("-").map(Number); return MONTH_BG[mm - 1] + " " + y; };
  const dash = n => Number(n) ? `<b>${eur(n)}</b>` : `<span class="erp-muted">—</span>`;
  const inp = (m, k, val, title) => `<input type="number" step="any" class="pum-in" data-m="${m}" data-k="${k}" value="${val ? val : ""}" placeholder="0" title="${title || ""}" style="width:96px;text-align:right" />`;

  const rows = months.map(m => {
    const man = manual[m] || {};
    const inv = invByMonth[m] || 0;
    const c005 = (c005ByMonth[m] || 0) + (Number(man.c005) || 0);
    const salesT = inv + c005;
    const pur = purByMonth[m] || 0;
    const sal = salByMonth[m] || 0;
    const osigAuto = osigByMonth[m] || 0;
    const osig = osigAuto || Number(man.osig) || 0;
    const credits = Number(man.credits) || 0;
    const other = Number(man.other) || 0;
    // ДДС резултат на месеца: >0 → за внасяне (вади се), <0 → за възстановяване (добавя се).
    const vatDue = (vatOutByMonth[m] || 0) - (vatInByMonth[m] || 0);
    const result = salesT - pur - sal - osig - credits - other - vatDue;
    return `<tr>
      <td><b>${mLabel(m)}</b></td>
      <td class="num">${dash(inv)}</td>
      <td class="num" title="Сборът от регистъра „Стокови/005" отдолу (включително изтрити записи)">${dash(c005)}</td>
      <td class="num" style="background:#f0f9ff"><b>${eur(salesT)}</b></td>
      <td class="num">${dash(pur)}</td>
      <td class="num">${dash(sal)}</td>
      <td class="num">${osigAuto ? `${dash(osigAuto)} <span class="erp-muted" title="От Ведомостта (Месечен отчет)">🤖</span>` : inp(m, "osig", man.osig, "Няма ведомост за месеца — въведи осигуровките на ръка, €")}</td>
      <td class="num">${inp(m, "credits", man.credits, "Вноски по кредити за месеца, €")}</td>
      <td class="num">${inp(m, "other", man.other, "Други разходи за месеца (извън Покупките), €")}</td>
      <td class="num" title="${vatDue >= 0 ? "ДДС за внасяне — вади се от резултата" : "ДДС за възстановяване — добавя се към резултата"}">${(vatOutByMonth[m] || vatInByMonth[m]) ? `<b style="color:${vatDue >= 0 ? "#b91c1c" : "#166534"}">${vatDue >= 0 ? "−" : "+"}${eur(Math.abs(vatDue))}</b>` : `<span class="erp-muted">—</span>`}</td>
      <td class="num" style="background:${result >= 0 ? "#f0fdf4" : "#fef2f2"}"><b style="color:${result >= 0 ? "#166534" : "#b91c1c"}">${eur(result)}</b></td>
      <td><input type="text" class="pum-note" data-m="${m}" value="${escapeAttr(man.note || "")}" placeholder="бележка…" style="width:200px" /></td>
    </tr>`;
  }).join("");

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">📅 Месечни резултати — всичко в EUR без ДДС</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pum-save">💾 Запази ръчните</button>
      <span class="save-status" id="pum-status"></span>
    </div>
    <div style="overflow:auto"><table class="report-table erp-table">
      <thead><tr>
        <th>Месец</th><th class="num" title="Издадени фактури без ДДС (+ДИ, −КИ, без проформи)">Фактури (авто)</th>
        <th class="num">005</th>
        <th class="num">ОБЩО продажби</th>
        <th class="num" title="Всички Покупки за месеца без ДДС (КИ с минус; стоковите разписки не са разход)">Разходи (авто)</th>
        <th class="num" title="„ОБЩО получено“ от Месечния отчет — банка+005+надник+извънреден+бонус+различни">Заплати (авто)</th>
        <th class="num" title="От Ведомостта; ако липсва — ръчно">Осигуровки</th>
        <th class="num">Кредити</th>
        <th class="num" title="Разходи извън Покупките — ръчно">Други разходи</th>
        <th class="num" title="ДДС продажби − ДДС покупки: за внасяне (−) или за възстановяване (+)">ДДС ±</th>
        <th class="num">Резултат</th>
        <th>Бележки</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint"><b>Фактури, Разходи, Заплати и ДДС</b> се смятат сами: фактурите без ДДС (КИ с минус, без проформи); разходите = всички Покупки без ДДС; заплатите = „ОБЩО получено" от Месечния отчет; ДДС ± = ДДС продажби − ДДС покупки (червено − за внасяне, зелено + за възстановяване). <b>Осигуровки</b> идват от Ведомостта (🤖); без ведомост — ръчно поле. <b>005</b> идва от регистъра отдолу; <b>Кредити / Други разходи / Бележки</b> са ръчни. <b>Резултат = ОБЩО продажби − Разходи − Заплати − Осигуровки − Кредити − Други разходи ± ДДС.</b> Влизат само документите, въведени в Системата.</p>

    <h4 class="erp-group-head" style="margin-top:14px">🧾 Стокови / 005 — продажби без фактура</h4>
    <div class="erp-toolbar">
      <input type="date" id="p5-date" value="${new Date().toISOString().slice(0, 10)}" />
      <input type="text" id="p5-client" placeholder="Клиент" style="width:220px" />
      <input type="number" id="p5-amt" step="any" placeholder="Сума €" style="width:110px" />
      <label class="erp-inline"><input type="checkbox" id="p5-unpaid" /> неплатено</label>
      <button class="btn btn-small btn-primary" id="p5-add">+ Добави</button>
      <span class="spacer"></span>
      ${unpaidSum ? `<span class="erp-count" style="color:#b91c1c"><b>Неплатени: ${eur(unpaidSum)}</b></span>` : ""}
    </div>
    <table class="report-table erp-table" style="max-width:780px">
      <thead><tr><th>Дата</th><th>Клиент</th><th class="num">Сума</th><th>Неплатено</th><th></th></tr></thead>
      <tbody>${(c005Store.list || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).map(r => `
        <tr style="${r.unpaid ? "background:#fef2f2" : ""}">
          <td>${escapeHtml(String(r.date || "").split("-").reverse().join("."))}</td>
          <td><b>${escapeHtml(r.client || "")}</b></td>
          <td class="num"><b>${eur(r.amount)}</b></td>
          <td><label class="erp-inline"><input type="checkbox" class="p5-up" data-id="${r.id}" ${r.unpaid ? "checked" : ""} /> ${r.unpaid ? `<b style="color:#b91c1c">не е платил</b>` : "платено"}</label></td>
          <td><button class="btn btn-small p5-del" data-id="${r.id}" title="Маха записа от списъка — сумата ОСТАВА в месечния сбор">×</button></td>
        </tr>`).join("") || `<tr><td colspan="5" class="report-empty">Няма записи — добави първия отгоре.</td></tr>`}
      </tbody>
    </table>
    <p class="hint">Сборът за месеца влиза АВТОМАТИЧНО в колоната „005" горе. „×" чисти записа от списъка, но сумата му ОСТАВА в месечния сбор (продажбата се е случила). Отметката „неплатено" е за следене кой още дължи.</p>`;

  const collect = () => {
    v.querySelectorAll(".pum-in").forEach(i => {
      const m = i.dataset.m, k = i.dataset.k;
      const val = Number(String(i.value).replace(",", ".")) || 0;
      manual[m] = manual[m] || {};
      if (val) manual[m][k] = val; else delete manual[m][k];
    });
    v.querySelectorAll(".pum-note").forEach(i => {
      const m = i.dataset.m, val = i.value.trim();
      manual[m] = manual[m] || {};
      if (val) manual[m].note = val; else delete manual[m].note;
    });
  };
  v.querySelector("#pum-save").addEventListener("click", async () => {
    const st = v.querySelector("#pum-status"); st.textContent = "Записва…";
    collect();
    const ok = await pulseMonthlySave(manual);
    st.textContent = ok ? "✓ Записано" : "";
    if (ok) setTimeout(() => pulseMonthly(v), 600);
  });
  // Enter в поле = запази направо.
  v.querySelectorAll(".pum-in, .pum-note").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") v.querySelector("#pum-save").click(); }));

  // 🧾 Регистърът Стокови/005.
  v.querySelector("#p5-add").addEventListener("click", async () => {
    const date = v.querySelector("#p5-date").value;
    const client = v.querySelector("#p5-client").value.trim();
    const amount = Number(String(v.querySelector("#p5-amt").value).replace(",", ".")) || 0;
    if (!client || !amount) { alert("Попълни клиент и сума."); return; }
    if (!date) { alert("Избери дата."); return; }
    c005Store.list.push({ id: String(Date.now()), date, client, amount, unpaid: v.querySelector("#p5-unpaid").checked });
    if (await pulseC005Save(c005Store)) pulseMonthly(v);
  });
  v.querySelectorAll(".p5-up").forEach(c => c.addEventListener("change", async () => {
    const r = c005Store.list.find(x => String(x.id) === c.dataset.id);
    if (r) { r.unpaid = c.checked; await pulseC005Save(c005Store); pulseMonthly(v); }
  }));
  v.querySelectorAll(".p5-del").forEach(b => b.addEventListener("click", async () => {
    const i = c005Store.list.findIndex(x => String(x.id) === b.dataset.id);
    if (i < 0) return;
    const r = c005Store.list[i];
    if (!confirm(`Махам записа „${r.client} — ${(Number(r.amount) || 0).toFixed(2)} €" от списъка.\nСумата ОСТАВА в месечния сбор 005. Продължавам?`)) return;
    const m = String(r.date || "").slice(0, 7);
    c005Store.deleted[m] = (Number(c005Store.deleted[m]) || 0) + (Number(r.amount) || 0);
    c005Store.list.splice(i, 1);
    if (await pulseC005Save(c005Store)) pulseMonthly(v);
  }));
}
