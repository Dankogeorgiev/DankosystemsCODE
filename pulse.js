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

async function renderPulse() {
  const v = document.getElementById("pulse-view");
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
  const ordersValue = orders.reduce((s, o) => s + lineNet(o.lines), 0);
  const month = today.slice(0, 7);
  // (картата „продажби месец" е премахната — фактурираното е меродавното)

  // Финанси: приходи (издадени фактури този месец), разходи (покупки този месец),
  // вземания от клиенти и задължения към доставчици. Всичко в EUR (BGN → /1.95583).
  const toEur = (n, cur) => cur === "BGN" ? n / 1.95583 : n;
  let invMonth = 0;
  invoices.forEach(o => {
    if (!o.posted || o.kind === "proforma") return;
    if (String(o.issueDate || "").slice(0, 7) !== month) return;
    const sign = o.kind === "credit" ? -1 : 1;
    invMonth += sign * toEur(lineNet(o.lines), o.currency || "EUR");
  });
  let purchMonth = 0;
  purchases.forEach(o => {
    if (String(o.date || "").slice(0, 7) !== month) return;
    if (o.docType === "goods") return;   // стоковата разписка не е разход — парите идват с покриващата фактура
    purchMonth += toEur(lineNet(o.lines), o.currency || "BGN");
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
    vatIn += toEur(lineNet(o.lines) * rate / 100, o.currency || "BGN");
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
  const paySum = payUnpaid.reduce((s, p) => s + (num(p.amountVat) || 0), 0);
  // Дължимо до края на месеца (с ДДС): неплатени фактури със срок до последния
  // ден на текущия месец — включително вече просрочените.
  const eomD = new Date(); const eom = `${eomD.getFullYear()}-${String(eomD.getMonth() + 1).padStart(2, "0")}-${String(new Date(eomD.getFullYear(), eomD.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const payMonthItems = payUnpaid.filter(p => p.dueDate && p.dueDate <= eom);
  const payMonthSum = payMonthItems.reduce((s, p) => s + (num(p.amountVat) || 0), 0);
  // Задължения СЛЕДВАЩ месец (с ДДС): падеж след края на този месец, до края на следващия.
  const nmEndD = new Date(eomD.getFullYear(), eomD.getMonth() + 2, 0);
  const nmEom = `${nmEndD.getFullYear()}-${String(nmEndD.getMonth() + 1).padStart(2, "0")}-${String(nmEndD.getDate()).padStart(2, "0")}`;
  const payNextItems = payUnpaid.filter(p => p.dueDate && p.dueDate > eom && p.dueDate <= nmEom);
  const payNextSum = payNextItems.reduce((s, p) => s + (num(p.amountVat) || 0), 0);

  // Всяка карта е ВРАТА към модула, от който идват числата ѝ (go = ЕРП раздел
  // или "tasks" за Цехове) — клик = отиваш там.
  const card = (label, value, cls, go) => `<div class="pulse-card ${cls || ""}${go ? " pulse-go" : ""}"${go ? ` data-go="${go}" title="Отвори: ${escapeHtml(pulseGoLabel(go))}"` : ""}><div class="pulse-val">${value}</div><div class="pulse-lbl">${label}</div></div>`;

  v.innerHTML = `
    <div class="pulse-cards">
      ${card("фактурирано месец (без ДДС)", money(invMonth, "EUR"), "money", "invoices")}
      ${card("разходи месец (без ДДС)", money(purchMonth, "EUR"), "money", "purchases")}
      ${card("вземания от клиенти (с ДДС)", money(recvSum, "EUR"), recvOver.length ? "warn" : "money", "receivables")}
      ${card("от тях просрочени", money(recvOverSum, "EUR") + " · " + recvOver.length + " бр.", recvOver.length ? "danger" : "", "receivables")}
      ${card("общо задължения (с ДДС)", money(paySum, "EUR"), "", "payables")}
      ${card("дължимо до края на месеца (с ДДС)", money(payMonthSum, "EUR") + " · " + payMonthItems.length + " бр.", payMonthItems.length ? "warn" : "", "payables")}
      ${card("задължения следващ месец (с ДДС)", money(payNextSum, "EUR") + " · " + payNextItems.length + " бр.", payNextItems.length ? "info" : "", "payables")}
      ${card("общо заявки (стойност)", money(ordersValue, "EUR"), "money", "customer")}
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
