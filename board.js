/* Данко Системс — „Табло за цеха" (голям Kanban за таблет/телевизор) и
   автоматични известия за потока (пристигнали детайли от предната операция).
   Ползва TASKS, currentWorkshop, taskStatus, priInfo, erpSeriesProduced,
   erpFlowAvailable, showSub, renderTasks, todayStr, escapeHtml от tasks.js. */

let boardTimer = null;

function stopBoardTimer() { if (boardTimer) { clearInterval(boardTimer); boardTimer = null; } }

function toggleBoard() {
  const v = document.getElementById("board-view");
  if (v && !v.hidden) { stopBoardTimer(); showSub("tasks"); renderTasks(); return; }
  renderBoard();
}

// Задачи в цеха, които са ГОТОВИ за започване (детайлите са пристигнали от
// предната операция, но тук още не е започнато). = „пристигнали".
function boardArrivals(ws) {
  const flowMap = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
  const out = [];
  (TASKS || []).forEach(t => {
    if (t.source && t.source.kind === "extra") return;
    if (ws !== "__all" && t.workshop !== ws) return;
    const gated = t.source && t.source.flow && (t.source.prevKey || (Array.isArray(t.source.gate) && t.source.gate.length));
    if (!gated || typeof erpFlowAvailable !== "function") return;
    const avail = erpFlowAvailable(t, flowMap) || 0;
    if (avail > 0 && (Number(t.produced) || 0) === 0) out.push({ t, avail });
  });
  return out;
}

// Банер „пристигнаха детайли" над списъка на цеха (известие за потока).
function renderFlowArrivals(ws) {
  const host = document.getElementById("flow-arrivals");
  if (!host) return;
  if (!ws || ws === "__all") { host.hidden = true; host.innerHTML = ""; return; }
  const arr = boardArrivals(ws);
  if (!arr.length) { host.hidden = true; host.innerHTML = ""; return; }
  const total = arr.reduce((s, a) => s + a.avail, 0);
  const chips = arr.slice(0, 8).map(a =>
    `<span class="fa-chip">${escapeHtml((a.t.code ? a.t.code + " " : "") + (a.t.product || ""))} <b>${a.avail}</b></span>`).join(" ");
  host.hidden = false;
  host.innerHTML = `<span class="fa-bell">🔔</span> <b>Пристигнаха детайли за започване</b> — ${arr.length} позиции, общо <b>${total}</b> бр.: ${chips}`
    + (arr.length > 8 ? ` <span class="muted">+${arr.length - 8} още</span>` : "");
}

function boardCard(t, flowMap) {
  const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
  const pct = qty > 0 ? Math.round(prod / qty * 100) : 0;
  const pi = (typeof priInfo === "function") ? priInfo(t) : { icon: "", cls: "" };
  const gated = t.source && t.source.flow && (t.source.prevKey || (Array.isArray(t.source.gate) && t.source.gate.length));
  const avail = (gated && typeof erpFlowAvailable === "function") ? (erpFlowAvailable(t, flowMap) || 0) : null;
  const due = t.due ? `<span class="bc-due">⏱ ${escapeHtml(t.due)}</span>` : "";
  const who = t.assignee ? `<span class="bc-asg">👷 ${escapeHtml(t.assignee)}</span>` : `<span class="bc-asg bc-free">незает</span>`;
  const nos = (typeof taskOrderNos === "function") ? taskOrderNos(t) : [];
  const noHtml = nos.length ? `<span class="bc-orderno">📋 № ${escapeHtml(nos.join(", "))}</span>` : (t.client ? `<span class="bc-client">${escapeHtml(t.client)}</span>` : "");
  return `<div class="board-card ${pi.cls || ""}">
    <div class="bc-top"><span class="bc-prio">${pi.icon || ""}</span><b>${escapeHtml(t.product || "—")}</b> <span class="bc-code">${escapeHtml(t.code || "")}</span></div>
    ${t.operation ? `<div class="bc-op">${escapeHtml(t.operation)}</div>` : ""}
    <div class="bc-meta">${noHtml}${who}${due}</div>
    <div class="bc-qty">${prod}/${qty || "—"} бр.${avail != null && avail > 0 ? ` · <span class="bc-avail">↧ ${avail} готови</span>` : ""}</div>
    ${(Number(t.brakNeed) || 0) > 0 ? `<div class="bc-brak">🔴 спешно +${Number(t.brakNeed)} (брак настройка)</div>` : ""}
    <div class="bc-bar"><span style="width:${pct}%"></span></div>
  </div>`;
}

function renderBoard() {
  showSub("board");
  const v = document.getElementById("board-view");
  if (!v) return;
  const ws = (typeof currentWorkshop === "function") ? currentWorkshop() : "__all";

  if (ws === "__all") {
    v.innerHTML = `<div class="board-head"><h3>📺 Табло за цеха</h3><span class="spacer" style="flex:1"></span><button id="board-back" class="btn btn-small">← Назад</button></div>
      <p class="report-empty">Избери конкретен цех от менюто „Цех" горе вляво, за да видиш неговото табло.</p>`;
    v.querySelector("#board-back").addEventListener("click", () => { stopBoardTimer(); showSub("tasks"); renderTasks(); });
    return;
  }

  const flowMap = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
  const today = (typeof todayStr === "function") ? todayStr() : new Date().toISOString().slice(0, 10);
  const cols = { todo: [], progress: [], done: [] };
  (TASKS || []).forEach(t => {
    if (t.source && t.source.kind === "extra") return;
    if (t.workshop !== ws) return;
    const st = (typeof taskStatus === "function") ? taskStatus(t) : ((Number(t.produced) || 0) >= (Number(t.qty) || 0) && (Number(t.qty) || 0) > 0 ? "done" : (Number(t.produced) || 0) > 0 ? "progress" : "todo");
    if (st === "done") {
      if ((t.logs || []).some(l => l.date === today && (Number(l.qty) || 0) > 0)) cols.done.push(t);   // само готовите ДНЕС
    } else if (st === "progress") cols.progress.push(t);
    else cols.todo.push(t);
  });
  // приоритетните най-отгоре
  const byPrio = (a, b) => ((typeof priLevel === "function" ? priLevel(b) : 0) - (typeof priLevel === "function" ? priLevel(a) : 0));
  cols.todo.sort(byPrio); cols.progress.sort(byPrio);

  const colHtml = (title, arr, cls) => `<div class="board-col ${cls}">
    <div class="board-col-head">${title} <span class="board-col-n">${arr.length}</span></div>
    <div class="board-col-body">${arr.map(t => boardCard(t, flowMap)).join("") || `<p class="board-empty">—</p>`}</div>
  </div>`;

  const arrN = boardArrivals(ws).length;
  v.innerHTML = `
    <div class="board-head">
      <h3>📺 Табло — ${escapeHtml(ws)}</h3>
      ${arrN ? `<span class="board-arr">🔔 ${arrN} пристигнали</span>` : ""}
      <span class="muted board-ts">обновено ${new Date().toLocaleTimeString("bg-BG")}</span>
      <span class="spacer" style="flex:1"></span>
      <button id="board-refresh" class="btn btn-small">↻ Обнови</button>
      <button id="board-back" class="btn btn-small">← Назад</button>
    </div>
    <div class="board-cols">
      ${colHtml("🕓 Чака", cols.todo, "col-todo")}
      ${colHtml("⚙️ В процес", cols.progress, "col-prog")}
      ${colHtml("✅ Готово днес", cols.done, "col-done")}
    </div>`;
  v.querySelector("#board-back").addEventListener("click", () => { stopBoardTimer(); showSub("tasks"); renderTasks(); });
  v.querySelector("#board-refresh").addEventListener("click", renderBoard);

  // Авто-обновяване, докато таблото е отворено (за таблет/телевизор).
  stopBoardTimer();
  boardTimer = setInterval(() => {
    const bv = document.getElementById("board-view");
    if (!bv || bv.hidden) { stopBoardTimer(); return; }
    renderBoard();
  }, 20000);
}
