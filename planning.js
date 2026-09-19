/* Данко Системс — „Планиране на производството" (само за офиса/админ).
   Обзор над всичко пуснато в цеховете, от два ъгъла:
   - По поръчки: всяка поръчка с напредък, срок/товарене (петък), риск и
     приоритет на ниво поръчка (пренася се на всичките ѝ задачи).
   - По цехове: натовареност на всеки цех (оставащи бройки + прибл. време от
     „Времена") — за да се вижда тясното място.
   Ползва TASKS, tSaveTask, workshopList, priInfo/priLevel/TASK_PRIORITIES,
   collectTimeRows, fmtSecDur, showSub, renderTasks, escapeHtml от tasks.js. */

let planTab = "orders";   // orders | shops

// Стандартен срок за серийните продукти ~3 седмици; товарене само в петък.
const PLAN_LEAD_DAYS = 21;    // до 21 дни → „пусни сега"
const PLAN_TIGHT_DAYS = 14;   // под 14 → стегнат срок
const PLAN_URGENT_DAYS = 7;   // под 7 → спешно

function planParseDue(due) {
  const s = String(due || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const dt = new Date(+m[1], +m[2] - 1, +m[3]); dt.setHours(0, 0, 0, 0); return isNaN(dt.getTime()) ? null : dt; }
  m = s.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (m) { let y = m[3]; if (y.length === 2) y = "20" + y; const dt = new Date(+y, +m[2] - 1, +m[1]); dt.setHours(0, 0, 0, 0); return isNaN(dt.getTime()) ? null : dt; }
  return null;
}
// Последният петък на/преди датата — реалният ден на товарене.
function planShipFriday(d) {
  const x = new Date(d); const off = (x.getDay() - 5 + 7) % 7; x.setDate(x.getDate() - off); x.setHours(0, 0, 0, 0); return x;
}
function planFmtDate(d) {
  if (!d) return "—";
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function planRisk(dueDate) {
  if (!dueDate) return { level: 0, label: "", cls: "", days: null, ship: null };
  const ship = planShipFriday(dueDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((ship - today) / 864e5);
  if (days < 0) return { level: 4, label: "Просрочена", cls: "plan-r-over", days, ship };
  if (days <= PLAN_URGENT_DAYS) return { level: 3, label: "Спешно", cls: "plan-r-urgent", days, ship };
  if (days <= PLAN_TIGHT_DAYS) return { level: 2, label: "Стегнат срок", cls: "plan-r-tight", days, ship };
  if (days <= PLAN_LEAD_DAYS) return { level: 1, label: "Пусни сега", cls: "plan-r-warn", days, ship };
  return { level: 0, label: "В срок", cls: "plan-r-ok", days, ship };
}

// Средно време за 1 брой по операция (от отчетените времена) — за оценка на натоварването.
function planAvgSecByOp() {
  const rows = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const m = {};
  rows.forEach(r => {
    let pp = null;
    if (r.tPiece && r.tPiece.sec) pp = r.tPiece.sec;
    else if (r.tOrder && r.tOrder.sec && (Number(r.qty) || 0) > 0) pp = r.tOrder.sec / Number(r.qty);
    if (pp == null) return;
    const k = r.operation || "";
    const g = m[k] || (m[k] = { sum: 0, q: 0 });
    const q = Number(r.qty) || 1; g.sum += pp * q; g.q += q;
  });
  const out = {};
  Object.keys(m).forEach(k => { if (m[k].q > 0) out[k] = m[k].sum / m[k].q; });
  return out;
}

// Ключ за групиране по поръчка.
function planOrderKey(t) {
  const s = t.source;
  if (s && s.sampleId) return (s.sampleType || "order") + ":" + s.sampleId;
  return "manual:" + (t.client || "Серия");
}

// Събиране на поръчките и на натовареността по цехове.
function planCollect() {
  const avg = planAvgSecByOp();
  const orders = {};
  const shops = {};
  (TASKS || []).forEach(t => {
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    const rem = Math.max(qty - prod, 0);
    const isDone = qty > 0 && prod >= qty;
    // --- поръчки ---
    const k = planOrderKey(t);
    const o = orders[k] || (orders[k] = { key: k, client: t.client || "", products: {}, due: "", dueDate: null, tasks: [], total: 0, done: 0, byShop: {} });
    o.tasks.push(t); o.total++; if (isDone) o.done++;
    if (t.client && !o.client) o.client = t.client;
    if (t.product || t.code) o.products[(t.code || "") + "¦" + (t.product || "")] = { code: t.code || "", name: t.product || "" };
    const dd = planParseDue(t.due);
    if (dd && (!o.dueDate || dd < o.dueDate)) { o.dueDate = dd; o.due = t.due; }
    if (!isDone && rem > 0) o.byShop[t.workshop] = (o.byShop[t.workshop] || 0) + rem;
    // --- цехове (само чакащото) ---
    if (!isDone) {
      const g = shops[t.workshop] || (shops[t.workshop] = { workshop: t.workshop, tasks: 0, pieces: 0, sec: 0, hasTime: false });
      g.tasks++; g.pieces += rem;
      const a = avg[t.operation || ""];
      if (a) { g.sec += rem * a; g.hasTime = true; }
    }
  });
  const orderList = Object.values(orders).map(o => {
    o.priority = o.tasks.reduce((mx, t) => Math.max(mx, (typeof priLevel === "function" ? priLevel(t) : 0)), 0);
    o.risk = planRisk(o.dueDate);
    o.productList = Object.values(o.products);
    return o;
  });
  // Сортиране: най-напред по риск, после по най-близък срок, после по приоритет.
  orderList.sort((a, b) =>
    (b.risk.level - a.risk.level) ||
    ((a.risk.days == null ? 1e9 : a.risk.days) - (b.risk.days == null ? 1e9 : b.risk.days)) ||
    (b.priority - a.priority));
  const shopList = Object.values(shops).sort((a, b) => (b.sec - a.sec) || (b.pieces - a.pieces));
  return { orderList, shopList };
}

/* ---------- Изглед ---------- */
function togglePlanning() {
  const v = document.getElementById("planning-view");
  if (v && !v.hidden) { showSub("tasks"); renderTasks(); return; }
  renderPlanning();
}
function renderPlanning() {
  showSub("planning");
  const v = document.getElementById("planning-view");
  if (!v) return;
  const { orderList, shopList } = planCollect();
  const openOrders = orderList.filter(o => o.done < o.total);
  const atRisk = openOrders.filter(o => o.risk.level >= 2).length;
  const tabBtn = (t, lbl) => `<button class="btn btn-small ${planTab === t ? "btn-primary" : ""}" data-ptab="${t}">${lbl}</button>`;

  v.innerHTML = `
    <div class="workers-head"><h3>📅 Планиране на производството</h3>
      <button id="plan-back" class="btn btn-small">← Назад</button></div>
    <div class="plan-summary">${openOrders.length} активни поръчки · <b class="${atRisk ? "plan-warn" : ""}">${atRisk} с рисков срок</b> · ${shopList.length} цеха с работа</div>
    <div class="pr-row" style="margin:8px 0">${tabBtn("orders", "📋 По поръчки")}${tabBtn("shops", "🏭 По цехове")}</div>
    <div id="plan-out"></div>`;

  v.querySelector("#plan-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  v.querySelectorAll("[data-ptab]").forEach(b => b.addEventListener("click", () => { planTab = b.dataset.ptab; renderPlanning(); }));

  if (planTab === "orders") planRenderOrders(orderList);
  else planRenderShops(shopList);
}

function planRenderOrders(orderList) {
  const out = document.getElementById("plan-out");
  const rows = orderList.map(o => {
    const pi = (typeof priInfo === "function") ? priInfo({ priority: o.priority }) : { icon: "☆", cls: "" };
    const pct = o.total ? Math.round(o.done / o.total * 100) : 0;
    const prods = o.productList.slice(0, 3).map(p => escapeHtml((p.code ? p.code + " " : "") + p.name)).join("<br>") + (o.productList.length > 3 ? `<br><span class="muted">+${o.productList.length - 3} още</span>` : "");
    const shopChips = Object.entries(o.byShop).sort((a, b) => b[1] - a[1]).map(([w, n]) => `<span class="plan-chip">${escapeHtml(w)} <b>${n}</b></span>`).join(" ") || '<span class="muted">— готово —</span>';
    const shipTxt = o.risk.ship ? `${planFmtDate(o.risk.ship)}${o.risk.days != null ? ` <span class="muted">(${o.risk.days >= 0 ? "след " + o.risk.days + " дни" : "преди " + (-o.risk.days) + " дни"})</span>` : ""}` : "—";
    const riskBadge = o.risk.label ? `<span class="plan-risk ${o.risk.cls}">${o.risk.label}</span>` : "—";
    return `<tr class="${o.done >= o.total ? "plan-done" : ""}">
      <td data-label="Приоритет"><button class="btn-plan-prio ${pi.cls}" data-prio="${escapeAttr(o.key)}" title="Приоритет на цялата поръчка">${pi.icon}</button></td>
      <td data-label="Клиент">${o.client ? escapeHtml(o.client) : '<span class="serie">СЕРИЯ</span>'}</td>
      <td data-label="Продукти">${prods || "—"}</td>
      <td data-label="Срок">${planFmtDate(o.dueDate)}</td>
      <td data-label="Товарене (петък)">${shipTxt}</td>
      <td data-label="Риск">${riskBadge}</td>
      <td data-label="Напредък"><div class="plan-prog"><span style="width:${pct}%"></span></div><span class="muted">${o.done}/${o.total} (${pct}%)</span></td>
      <td data-label="Цехове">${shopChips}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="report-empty">Няма пуснати поръчки в производство.</td></tr>`;

  out.innerHTML = `<table class="report-table erp-table plan-table">
    <thead><tr><th>Пр.</th><th>Клиент</th><th>Продукти</th><th>Срок</th><th>Товарене (петък)</th><th>Риск</th><th>Напредък</th><th>По цехове (остатък)</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="hint">Срокът се смята спрямо деня на товарене (петък). До ${PLAN_LEAD_DAYS} дни → „пусни сега"; под ${PLAN_TIGHT_DAYS} → стегнат; под ${PLAN_URGENT_DAYS} → спешно.</p>`;

  const { orderList: fresh } = planCollect();
  const byKey = {}; fresh.forEach(o => byKey[o.key] = o);
  out.querySelectorAll("[data-prio]").forEach(b => b.addEventListener("click", () => planCyclePriority(byKey[b.dataset.prio])));
}

async function planCyclePriority(order) {
  if (!order || !order.tasks) return;
  const next = ((order.priority || 0) + 1) % 3;   // Нормален → Висок → Спешно → …
  for (const t of order.tasks) { t.priority = next; if (typeof tSaveTask === "function") await tSaveTask(t); }
  renderPlanning();
}

function planRenderShops(shopList) {
  const out = document.getElementById("plan-out");
  const maxSec = Math.max(1, ...shopList.map(s => s.sec));
  const maxPc = Math.max(1, ...shopList.map(s => s.pieces));
  const rows = shopList.map((s, i) => {
    const w = s.hasTime ? Math.round(s.sec / maxSec * 100) : Math.round(s.pieces / maxPc * 100);
    const timeTxt = s.hasTime ? (typeof fmtSecDur === "function" ? fmtSecDur({ sec: Math.round(s.sec) }) : Math.round(s.sec / 60) + " мин") : '<span class="muted">няма данни</span>';
    return `<tr>
      <td data-label="Цех"><b>${escapeHtml(s.workshop)}</b>${i === 0 && s.sec > 0 ? ' <span class="plan-risk plan-r-tight">тясно място</span>' : ""}</td>
      <td class="num" data-label="Чакащи задачи">${s.tasks}</td>
      <td class="num" data-label="Оставащи бройки">${s.pieces}</td>
      <td data-label="Прибл. време">${timeTxt}</td>
      <td data-label="Натовареност"><div class="plan-load"><span class="${s.hasTime ? "" : "nodata"}" style="width:${w}%"></span></div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" class="report-empty">Няма чакаща работа в цеховете.</td></tr>`;

  out.innerHTML = `<table class="report-table erp-table plan-table">
    <thead><tr><th>Цех</th><th class="num">Чакащи задачи</th><th class="num">Оставащи бройки</th><th>Прибл. време</th><th>Натовареност</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="hint">Времето е приблизително — от средните времена за операциите в „Времена". Цеховете са подредени по натовареност (най-натовареният отгоре).</p>`;
}
