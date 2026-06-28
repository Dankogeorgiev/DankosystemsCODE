/* Данко Системс — Модул „Цехове / Производствени задачи“
   Използва глобалния Supabase клиент (sb) и помощните функции от app.js.
   Данните се пазят в таблица `tasks`, служителите — в `app_config`. */

const TASK_DEFAULT_WORKSHOPS = ["Лазери", "CNC цех", "Преси", "Абкант", "Заваръчно", "Занитване", "Бояджийно"];

// Машини по цехове (за задължителното записване на време при изработка)
const MACHINES_BY_WORKSHOP = {
  "Лазери": ["DURMA 6kw", "DURMA 3kw", "Gweike 3kw", "Gweike combi", "Gweike Tube"],
  "CNC цех": ["Swiss Type 1", "Swiss Type 2", "VMC 600", "VMC966", "Traub Turning"],
};
// Полета за време по цех (key, етикет, мерна единица по подразбиране)
const TIME_FIELDS_BY_WORKSHOP = {
  "Лазери": [
    { key: "tPiece", label: "Време за 1 брой", unit: "sec" },
    { key: "tSheet", label: "Време за 1 лист", unit: "min" },
    { key: "tOrder", label: "Време за цялата нарязана част", unit: "min" },
  ],
  "CNC цех": [
    { key: "tPiece", label: "Време за 1 брой", unit: "sec" },
    { key: "tOrder", label: "Време за произведеното количество", unit: "min" },
  ],
};
// Допълнителни (текстови) полета по цех — напр. изразходени консумативи
const EXTRA_FIELDS_BY_WORKSHOP = {
  "CNC цех": [
    { key: "consumables", label: "Изразходени консумативи (опиши — напр. счупени фрези)", required: false },
  ],
};
// Цехове, за които при „Запиши“ изскача Отчетният прозорец (по подразбиране)
const WORKSHOPS_WITH_TIME = ["Лазери", "CNC цех"];

// Персонален „Отчетен прозорец“ по СЛУЖИТЕЛ (има предимство пред цеха).
// Ключ = точното име на служителя. Може да задаваш само това, което се различава
// (machines / timeFields / extraFields). Празните полета падат към настройката на цеха.
// Пример:
//   "Иво Бончев": {
//     machines: ["Преса 1", "Преса 2"],
//     timeFields: [{ key:"tPiece", label:"Време за 1 брой", unit:"sec" }],
//     extraFields: [{ key:"consumables", label:"Изразходени консумативи", required:false }],
//   },
const FIELDS_BY_WORKER = {
  "Иво Бончев": {
    byWorkshop: {
      "Преси": {
        machines: ["Автоматична Преса 1", "Автоматична Преса 2"],
        timeFields: [
          { key: "tPiece", label: "Време за 1 брой", unit: "sec" },
          { key: "tOrder", label: "Време за произведеното количество", unit: "min" },
          { key: "tSetup", label: "Време за настройка (спомагателно)", unit: "min" },
        ],
      },
      "Сглобяване": {
        machines: false,        // няма машина
        timeFields: [],         // без времена — само бройка + кратко описание (в „Специфична работа“)
      },
      // CNC цех — ползва стандартните CNC машини/полета
    },
  },
};

// Свързване на старите имена (от ERP/предишни версии) към текущите цехове.
const WORKSHOP_RENAME = {
  "Лазер": "Лазери", "Заварки": "Заваръчно", "Боядисване": "Бояджийно",
};
// Имена на ERP листове -> цех.
const SHEET_TO_WORKSHOP = {
  "лазер": "Лазери", "заварки": "Заваръчно", "занитване": "Занитване",
  "абкант": "Абкант", "боядисване": "Бояджийно", "сглобяване": "Сглобяване",
};
// Разпознава цеха по началото на името на листа (вкл. съкращения: зан, абк, зав...).
function mapSheetToWorkshop(name) {
  const k = (name || "").trim().toLowerCase();
  if (k.startsWith("лаз")) return "Лазери";
  if (k.startsWith("cnc") || k.startsWith("цнц") || k.startsWith("чпу")) return "CNC цех";
  if (k.startsWith("прес")) return "Преси";
  if (k.startsWith("абк")) return "Абкант";
  if (k.startsWith("зав")) return "Заваръчно";
  if (k.startsWith("зан")) return "Занитване";
  if (k.startsWith("бо") || k.startsWith("боя")) return "Бояджийно";
  if (k.startsWith("сгл")) return "Сглобяване";
  return SHEET_TO_WORKSHOP[k] || (name.charAt(0).toUpperCase() + name.slice(1));
}
// Служители по цехове (зареждат се еднократно).
const DEFAULT_EMPLOYEES = {
  "Лазери": ["Кръстьо Средев", "Димитър Павлов", "Костадин Алтаванов"],
  "Преси": ["Васил Иванов", "Захари Маджаров", "Симеон Танев"],
  "Абкант": ["Светлозар Попов", "Шеиб Джибиров", "Атанас Клисаров", "Янко Матев"],
  "Заваръчно": ["Николай Караиванов", "Панайот Петров", "Красимир Камовски", "Веселин Иванов", "Димитър Димитров"],
  "Занитване": ["Богданка Камжалова", "Нели Кехайова", "Величка Мотова"],
  "Бояджийно": ["Атанас Натов", "Алим Тирозов", "Димитър Пиронков", "Райчо Чолаков", "Иван Москов", "Борислав Ангелов"],
};

let TASKS = [];
let WORKERS = {};            // { "Лазери": ["Иван", ...], ... }
let ROLES = { admins: [], byEmail: {} };   // имейл за вход -> { workshop }
let MY_WORKER = null;        // избран служител при цехов достъп
let taskFileTarget = null;   // задача, към която се качва чертеж
let selectedTasks = new Set();   // избрани задачи за групово възлагане
let sortState = { key: null, dir: 1 };
let workersSeededV1 = false;
let MESSAGES = [];               // вътрешни съобщения служител↔админ
let messagesSubscribed = false;
let msgFilterTask = null;        // показвай само съобщения за тази задача
let msgView = "active";   // регистър: "active" | "done" | "all"
let msgType = "question"; // раздел: "question" | "supply" (поръчки за снабдяване)
let msgNotifyState = { replyCounts: {}, ids: [] };   // за известия при нов отговор/въпрос
let timesFilter = { workshop: "", machine: "", worker: "" };   // филтри в „Времена“

function dueSortVal(due) {
  const m = String(due || "").match(/(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (!m) return 99999999;
  let [, d, mo, y] = m; if (y.length === 2) y = "20" + y;
  return Number(y) * 10000 + Number(mo) * 100 + Number(d);
}
// Приоритет на задачите: 0 = нормален, 1 = висок, 2 = спешно
const TASK_PRIORITIES = [
  { v: 0, icon: "☆", badge: "", label: "Нормален", cls: "" },
  { v: 1, icon: "🟠", badge: "🟠", label: "Висок", cls: "prio-high" },
  { v: 2, icon: "🔴", badge: "🔴", label: "Спешно", cls: "prio-urgent" },
];
function priLevel(t) { const n = Number(t && t.priority) || 0; return n < 0 ? 0 : (n > 2 ? 2 : n); }
function priInfo(t) { return TASK_PRIORITIES[priLevel(t)] || TASK_PRIORITIES[0]; }
async function cyclePriority(t) {
  if (amWorker()) return;
  t.priority = (priLevel(t) + 1) % 3;   // Нормален → Висок → Спешно → Нормален
  await tSaveTask(t);
  renderTasks();
}

const SORT_KEYS = {
  priority: t => priLevel(t),
  client: t => (t.client || "").toLowerCase(),
  product: t => (t.product || "").toLowerCase(),
  files: t => (t.files || []).length,
  operation: t => (t.operation || "").toLowerCase(),
  qty: t => Number(t.qty) || 0,
  produced: t => Number(t.produced) || 0,
  remaining: t => Math.max((Number(t.qty) || 0) - (Number(t.produced) || 0), 0),
  due: t => dueSortVal(t.due),
  assignee: t => (t.assignee || "").toLowerCase(),
};
function updateSortIndicators() {
  document.querySelectorAll('.tasks-table thead th[data-sort]').forEach(th => {
    const active = th.dataset.sort === sortState.key;
    th.classList.toggle("sort-active", active);
    let ind = th.querySelector(".sort-ind");
    if (!ind) { ind = document.createElement("span"); ind.className = "sort-ind"; th.appendChild(ind); }
    ind.textContent = active ? (sortState.dir > 0 ? " ▲" : " ▼") : "";
  });
}
let tasksLoaded = false;
let tasksSubscribed = false;

function amWorker() { return typeof MY_ACCESS !== "undefined" && MY_ACCESS && !MY_ACCESS.isAdmin; }

async function tLoadRoles() {
  const { data } = await sb.from("app_config").select("*").eq("id", "roles").maybeSingle();
  ROLES = (data && data.data) || { admins: [], byEmail: {} };
  ROLES.byEmail = ROLES.byEmail || {};
}
async function tSaveRoles() {
  const { error } = await sb.from("app_config")
    .upsert({ id: "roles", data: ROLES, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на достъпа: " + error.message);
}
function emailForWorkshop(ws) {
  const hit = Object.entries(ROLES.byEmail || {}).find(([, v]) => v && v.workshop === ws);
  return hit ? hit[0] : "";
}
async function setWorkshopEmail(ws, email) {
  ROLES.byEmail = ROLES.byEmail || {};
  // махаме стария имейл за този цех
  Object.keys(ROLES.byEmail).forEach(e => { if (ROLES.byEmail[e].workshop === ws) delete ROLES.byEmail[e]; });
  const e = (email || "").toLowerCase();
  if (e) ROLES.byEmail[e] = { workshop: ws };
  await tSaveRoles();
}
function slugWs(ws) {
  const map = { "Лазери": "laseri", "CNC цех": "cnc", "Преси": "presi", "Абкант": "abkant", "Заваръчно": "zavarka", "Занитване": "zanitvane", "Бояджийно": "boyadjiino" };
  return map[ws] || "cex";
}

/* ---------- Зареждане / запис ---------- */
async function tLoadWorkers() {
  const { data } = await sb.from("app_config").select("*").eq("id", "workers").maybeSingle();
  const cfg = (data && data.data) || {};
  WORKERS = cfg.workshops || {};
  workersSeededV1 = !!cfg.seeded_v1;

  if (!workersSeededV1) {
    // Свързване на старите имена на цехове към новите
    for (const [oldN, newN] of Object.entries(WORKSHOP_RENAME)) {
      if (WORKERS[oldN]) {
        WORKERS[newN] = WORKERS[newN] || [];
        WORKERS[oldN].forEach(n => { if (!WORKERS[newN].includes(n)) WORKERS[newN].push(n); });
        delete WORKERS[oldN];
      }
    }
    // Еднократно въвеждане на служителите по цехове
    for (const [ws, names] of Object.entries(DEFAULT_EMPLOYEES)) {
      WORKERS[ws] = WORKERS[ws] || [];
      names.forEach(n => { if (!WORKERS[ws].includes(n)) WORKERS[ws].push(n); });
    }
    // Премахване на празни стари цехове, които не са в списъка
    Object.keys(WORKERS).forEach(w => {
      if (!TASK_DEFAULT_WORKSHOPS.includes(w) && (WORKERS[w] || []).length === 0) delete WORKERS[w];
    });
    workersSeededV1 = true;
    await tSaveWorkers();
  }
  TASK_DEFAULT_WORKSHOPS.forEach(w => { if (!WORKERS[w]) WORKERS[w] = []; });

  // Почистване на грешно добавени „служители“, които са само числа
  let cleaned = false;
  Object.keys(WORKERS).forEach(w => {
    const before = (WORKERS[w] || []).length;
    WORKERS[w] = (WORKERS[w] || []).filter(n => !/^\s*\d+([.,]\d+)?\s*$/.test(String(n)));
    if (WORKERS[w].length !== before) cleaned = true;
  });
  if (cleaned) await tSaveWorkers();
}
async function tSaveWorkers() {
  const { error } = await sb.from("app_config")
    .upsert({ id: "workers", data: { workshops: WORKERS, seeded_v1: workersSeededV1 }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на служителите: " + error.message);
}
async function tLoadTasks() {
  const { data, error } = await sb.from("tasks").select("*").order("updated_at", { ascending: false });
  if (error) { alert("Грешка при зареждане на задачите: " + error.message); return; }
  TASKS = (data || []).map(r => {
    const t = { ...r.data, id: r.id };
    if (WORKSHOP_RENAME[t.workshop]) t.workshop = WORKSHOP_RENAME[t.workshop];
    t.files = t.files || [];
    t.logs = t.logs || [];
    return t;
  });
}
async function tSaveTask(t) {
  t.updatedAt = new Date().toISOString();
  const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
  const done = qty > 0 && prod >= qty;
  const { error } = await sb.from("tasks").update({ data: t, done, updated_at: t.updatedAt }).eq("id", t.id);
  if (error) console.error("save task", error);
}

function workshopList() {
  const extra = Object.keys(WORKERS).filter(w => !TASK_DEFAULT_WORKSHOPS.includes(w));
  return [...TASK_DEFAULT_WORKSHOPS, ...extra];
}
function taskStatus(t) {
  const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
  if (qty > 0 && prod >= qty) return "done";
  if (prod > 0) return "progress";
  return "todo";
}

/* ---------- Отваряне / изгледи ---------- */
async function openTasks() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("tasks-modal").hidden = false;
  showSub("tasks");
  if (!tasksLoaded) { await tLoadWorkers(); await tLoadRoles(); await tLoadTasks(); await mLoad(); tasksLoaded = true; subscribeTasks(); subscribeMessages(); }
  msgNotifyState = snapshotNotify();
  requestNotifyPermission();
  applyTasksAccess();
  renderWorkshopSelect();
  renderWorkerFilter();
  mUpdateBadge();
  renderTasks();
}

function applyTasksAccess() {
  const w = amWorker();
  ["btn-add-task", "btn-times", "btn-workers", "btn-task-report", "btn-clear-workshop", "tasks-close"].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = w ? "none" : "";
  });
  const lo = document.getElementById("tasks-logout"); if (lo) lo.hidden = !w;
  const erp = document.querySelector('label[for="erp-file"]'); if (erp) erp.style.display = w ? "none" : "";
  // при цехов достъп крием филтъра/лентата със служители (заместени от „кой си ти“)
  document.getElementById("task-worker-filter").style.display = w ? "none" : "";
  document.getElementById("task-search").style.display = w ? "none" : "";
  document.getElementById("worker-bar").style.display = w ? "none" : "";
  document.querySelector(".tasks-head h2").textContent = w
    ? "🏭 " + (MY_ACCESS.workshop || "Цех") : "🏭 Производство по цехове";
}

function renderIdentityPicker() {
  document.getElementById("tasks-daily").hidden = true;
  document.querySelector(".tasks-table").style.display = "none";
  document.getElementById("tasks-empty").hidden = true;
  const box = document.getElementById("identity-picker");
  box.hidden = false;
  const names = WORKERS[MY_ACCESS.workshop] || [];
  box.innerHTML = `<h3>Кой си ти?</h3>
    <div class="identity-list">${names.map(n =>
      `<button class="identity-btn" data-name="${escapeAttr(n)}"><span class="wav">${escapeHtml((n.trim()[0] || "?").toUpperCase())}</span>${escapeHtml(n)}</button>`
    ).join("") || "<em>Няма въведени служители за този цех.</em>"}</div>`;
  box.querySelectorAll(".identity-btn").forEach(b => b.addEventListener("click", () => {
    MY_WORKER = b.dataset.name;
    box.hidden = true;
    document.querySelector(".tasks-table").style.display = "";
    msgNotifyState = snapshotNotify();   // вече знаем кой е служителят — нулираме базата за известия
    mUpdateBadge();
    renderTasks();
  }));
}
function showSub(which) {
  document.getElementById("tasks-view").hidden = which !== "tasks";
  document.getElementById("workers-view").hidden = which !== "workers";
  document.getElementById("report-view").hidden = which !== "report";
  const mv = document.getElementById("messages-view"); if (mv) mv.hidden = which !== "messages";
  const tv = document.getElementById("times-view"); if (tv) tv.hidden = which !== "times";
}

/* ---------- Падащи менюта ---------- */
function currentWorkshop() {
  const el = document.getElementById("task-workshop");
  return el.value || "__all";
}
function renderWorkshopSelect() {
  const sel = document.getElementById("task-workshop");
  if (amWorker()) {
    sel.innerHTML = `<option>${escapeHtml(MY_ACCESS.workshop)}</option>`;
    sel.value = MY_ACCESS.workshop;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const cur = sel.value;
  sel.innerHTML = `<option value="__all">Всички цехове</option>` +
    workshopList().map(w => `<option value="${escapeAttr(w)}">${escapeHtml(w)}</option>`).join("");
  sel.value = cur || workshopList()[0] || "__all";
}
function renderWorkerFilter() {
  const sel = document.getElementById("task-worker-filter");
  const cur = sel.value;
  const ws = currentWorkshop();
  const names = ws === "__all" ? [...new Set(Object.values(WORKERS).flat())] : (WORKERS[ws] || []);
  sel.innerHTML = `<option value="">Всички служители</option>` +
    names.map(n => `<option>${escapeHtml(n)}</option>`).join("");
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : "";
}

/* ---------- Лента с служители (икони) ---------- */
function renderWorkerBar() {
  const bar = document.getElementById("worker-bar");
  if (!bar) return;
  const ws = currentWorkshop();
  const names = ws === "__all" ? [...new Set(Object.values(WORKERS).flat())] : (WORKERS[ws] || []);
  const active = document.getElementById("task-worker-filter").value;
  if (!names.length) { bar.innerHTML = `<span class="wbar-hint">Добави служители от бутона „👤 Служители“</span>`; return; }
  bar.innerHTML = `<button class="wchip wchip-all ${!active ? "active" : ""}" data-name="">Всички</button>` +
    names.map(n => {
      const init = (n.trim()[0] || "?").toUpperCase();
      return `<button class="wchip ${n === active ? "active" : ""}" data-name="${escapeAttr(n)}"><span class="wav">${escapeHtml(init)}</span>${escapeHtml(n)}</button>`;
    }).join("");
  bar.querySelectorAll(".wchip").forEach(b => b.addEventListener("click", () => {
    const filter = document.getElementById("task-worker-filter");
    filter.value = (filter.value === b.dataset.name) ? "" : b.dataset.name;
    renderTasks();
  }));
}

/* ---------- Списък със задачи ---------- */
function renderTasks() {
  showSub("tasks");

  // Цехов достъп: първо избор „кой си ти“
  if (amWorker() && !MY_WORKER) { renderIdentityPicker(); return; }
  document.getElementById("identity-picker").hidden = true;

  renderWorkerBar();
  const tbody = document.getElementById("tasks-body");
  const ws = currentWorkshop();
  const isW = amWorker();
  const worker = isW ? MY_WORKER : document.getElementById("task-worker-filter").value;
  const term = (document.getElementById("task-search").value || "").trim().toLowerCase();
  tbody.innerHTML = "";

  const rows = TASKS.filter(t => {
    if (ws !== "__all" && t.workshop !== ws) return false;
    if (isW) {
      // моите + незаетите задачи; чуждите се скриват
      if (t.assignee && t.assignee !== MY_WORKER) return false;
    } else if (worker && t.assignee !== worker) {
      return false;
    }
    if (term && !(`${t.client} ${t.product} ${t.code} ${t.operation}`.toLowerCase().includes(term))) return false;
    return true;
  });

  // Приоритетните задачи винаги изплуват най-горе; в рамките на еднакъв приоритет —
  // по избраната колона (по подразбиране по срок).
  const selKey = (sortState.key && SORT_KEYS[sortState.key]) ? sortState.key : "due";
  const f = SORT_KEYS[selKey];
  rows.sort((a, b) => {
    if (selKey !== "priority") {
      const pa = priLevel(a), pb = priLevel(b);
      if (pa !== pb) return pb - pa;
    }
    const va = f(a), vb = f(b);
    if (va < vb) return -1 * sortState.dir;
    if (va > vb) return 1 * sortState.dir;
    return 0;
  });
  updateSortIndicators();

  document.getElementById("tasks-empty").hidden = rows.length > 0;

  // Дневно обобщение, когато е избран конкретен служител
  const daily = document.getElementById("tasks-daily");
  if (worker) {
    const today = todayStr();
    let total = 0, cnt = 0;
    rows.forEach(t => (t.logs || []).forEach(l => {
      if (l.date === today && l.worker === worker) { total += Number(l.qty) || 0; cnt++; }
    }));
    daily.hidden = false;
    const change = isW ? ` <button id="who-change" class="btn btn-small">Смени служител</button>` : "";
    const lbl = isW ? "Ти си" : "👷";
    daily.innerHTML = `${lbl} <strong>${escapeHtml(worker)}</strong> — днес произведено: <strong>${total}</strong> бр. (${cnt} вписвания)${change}`;
    const cb = daily.querySelector("#who-change");
    if (cb) cb.addEventListener("click", () => { MY_WORKER = null; renderTasks(); });
  } else {
    daily.hidden = true;
  }

  rows.forEach(t => {
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    const rem = Math.max(qty - prod, 0);
    const st = taskStatus(t);
    const today = todayStr();
    const todayQty = (t.logs || []).filter(l => l.date === today).reduce((a, l) => a + (Number(l.qty) || 0), 0);
    const wsWorkers = WORKERS[t.workshop] || [];
    const opts = [`<option value="">— отговорник —</option>`]
      .concat(wsWorkers.map(n => `<option ${n === t.assignee ? "selected" : ""}>${escapeHtml(n)}</option>`));
    if (t.assignee && !wsWorkers.includes(t.assignee)) opts.push(`<option selected>${escapeHtml(t.assignee)}</option>`);

    const pi = priInfo(t);
    const prioCell = amWorker()
      ? `<td class="t-prio-cell ${pi.cls}" data-label="Приоритет">${pi.badge ? `<span class="t-prio-badge" title="${pi.label}">${pi.badge}</span>` : ""}</td>`
      : `<td class="t-prio-cell ${pi.cls}" data-label="Приоритет"><button type="button" class="t-prio" title="Приоритет: ${pi.label} (натисни за смяна)">${pi.icon}</button></td>`;

    const tr = document.createElement("tr");
    tr.className = "task-" + st + (pi.cls ? " " + pi.cls : "");
    tr.innerHTML = `
      ${prioCell}
      <td data-label="Клиент">${amWorker() ? "" : `<input type="checkbox" class="t-sel" ${selectedTasks.has(t.id) ? "checked" : ""} /> `}${t.client ? escapeHtml(t.client) : `<span class="serie">СЕРИЯ</span>`}</td>
      <td data-label="Продукт">${escapeHtml(t.product) || "—"}<div class="t-code">${escapeHtml(t.code || "")}</div></td>
      <td class="t-files" data-label="Чертеж">${taskFilesCell(t)}</td>
      <td data-label="Операция">${escapeHtml(t.operation) || (ws === "__all" ? escapeHtml(t.workshop) : "—")}</td>
      <td class="num" data-label="Количество">${qty || "—"}</td>
      <td class="num" data-label="Произведено"><strong>${prod}</strong>${todayQty ? `<div class="t-today-info">днес +${todayQty}</div>` : ""}</td>
      <td class="num ${rem === 0 && qty > 0 ? "rem-done" : ""}" data-label="Остатък">${rem}</td>
      <td data-label="Срок">${t.due ? escapeHtml(t.due) : `<span class="serie">СЕРИЯ</span>`}</td>
      ${amWorker()
        ? `<td class="t-assignee-ro" data-label="Отговорник">${escapeHtml(t.assignee) || "—"}</td>`
        : `<td data-label="Отговорник"><select class="t-assignee">${opts.join("")}</select></td>`}
      <td class="t-q" data-label="Въпрос">${taskQuestionCell(t)}</td>
      <td class="t-actions" data-label="">
        <input type="number" class="t-today" min="0" placeholder="днес" />
        <button type="button" class="btn btn-small btn-primary t-add">Запиши</button>
        ${amWorker() ? "" : `<button type="button" class="btn btn-small t-edit" title="Редакция">✎</button>
        <button type="button" class="remove-row t-del" title="Изтрий">×</button>`}
      </td>`;
    const filesCell = tr.querySelector(".t-files");
    const addBtn = filesCell.querySelector(".tf-add");
    if (addBtn) addBtn.addEventListener("click", () => {
      taskFileTarget = t;
      document.getElementById("task-file").click();
    });
    filesCell.querySelectorAll(".tf-x").forEach(b =>
      b.addEventListener("click", () => removeTaskFile(t, Number(b.dataset.i))));
    const asg = tr.querySelector("select.t-assignee");
    if (asg) asg.addEventListener("change", () => { if (amWorker()) return; t.assignee = asg.value; tSaveTask(t); });
    const sel = tr.querySelector(".t-sel");
    if (sel) sel.addEventListener("change", () => {
      if (sel.checked) selectedTasks.add(t.id); else selectedTasks.delete(t.id);
      const c = document.getElementById("bulk-count"); if (c) c.textContent = selectedTasks.size;
    });
    const input = tr.querySelector(".t-today");
    const whoNow = MY_WORKER || t.assignee || "";
    const submit = () => {
      if (WORKSHOPS_WITH_TIME.includes(t.workshop) || (FIELDS_BY_WORKER && FIELDS_BY_WORKER[whoNow]))
        openProductionDialog(t, input.value);
      else logProduction(t, input.value);
    };
    tr.querySelector(".t-add").addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    const edit = tr.querySelector(".t-edit"); if (edit) edit.addEventListener("click", () => editTask(t));
    const del = tr.querySelector(".t-del"); if (del) del.addEventListener("click", () => deleteTask(t));
    const ask = tr.querySelector(".t-ask"); if (ask) ask.addEventListener("click", () => askTaskQuestion(t));
    const qv = tr.querySelector(".t-qview"); if (qv) qv.addEventListener("click", () => { msgFilterTask = t.id; renderMessages(); markMessagesSeen(); });
    const prio = tr.querySelector(".t-prio"); if (prio) prio.addEventListener("click", () => cyclePriority(t));
    tbody.appendChild(tr);
  });

  renderBulkBar(rows, ws);
}

function renderBulkBar(rows, ws) {
  const bulk = document.getElementById("task-bulk");
  if (amWorker()) { bulk.hidden = true; return; }
  bulk.hidden = false;
  const wsNames = ws === "__all" ? [...new Set(Object.values(WORKERS).flat())] : (WORKERS[ws] || []);
  bulk.innerHTML = `Маркирани: <strong id="bulk-count">${selectedTasks.size}</strong> ·
    Възложи на: <select id="bulk-worker"><option value="">— избери —</option>${wsNames.map(n => `<option>${escapeHtml(n)}</option>`).join("")}</select>
    <button id="bulk-assign" class="btn btn-small btn-primary">Възложи избраните</button>
    <button id="bulk-selvis" class="btn btn-small">Маркирай показаните (${rows.length})</button>
    <button id="bulk-clear" class="btn btn-small">Изчисти</button>`;
  bulk.querySelector("#bulk-selvis").addEventListener("click", () => { rows.forEach(t => selectedTasks.add(t.id)); renderTasks(); });
  bulk.querySelector("#bulk-clear").addEventListener("click", () => { selectedTasks.clear(); renderTasks(); });
  bulk.querySelector("#bulk-assign").addEventListener("click", () => assignBulk(bulk.querySelector("#bulk-worker").value));
}

async function assignBulk(worker) {
  if (amWorker()) return;
  if (!selectedTasks.size) { alert("Първо маркирай задачи с тикчетата отляво."); return; }
  if (!worker) { alert("Избери служител от менюто „Възложи на“."); return; }
  const ids = [...selectedTasks];
  for (const id of ids) {
    const t = TASKS.find(x => x.id === id);
    if (t) { t.assignee = worker; await tSaveTask(t); }
  }
  selectedTasks.clear();
  renderTasks();
  alert(`Възложени ${ids.length} задачи на „${worker}“.`);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

/* ---------- Чертежи към задача ---------- */
function taskFilesCell(t) {
  const files = t.files || [];
  const links = files.map((f, i) => {
    const x = amWorker() ? "" : `<button class="tf-x" data-i="${i}" title="Премахни">×</button>`;
    return `<span class="tf"><a href="${f.url}" target="_blank" title="${escapeAttr(f.name)}">📎</a>${x}</span>`;
  }).join("");
  const add = amWorker() ? "" : `<button type="button" class="btn btn-small tf-add">${files.length ? "+" : "Прикачи"}</button>`;
  return (links || (amWorker() ? "—" : "")) + add;
}
async function handleTaskFiles(t, files) {
  if (amWorker()) return;
  t.files = t.files || [];
  for (const file of files) {
    const path = `tasks/${t.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    t.files.push({ name: file.name, type: file.type, path, url: data.publicUrl });
  }
  await tSaveTask(t);
  renderTasks();
}
async function removeTaskFile(t, i) {
  if (amWorker()) return;
  const f = (t.files || [])[i];
  if (f && f.path) await sb.storage.from(BUCKET).remove([f.path]);
  t.files.splice(i, 1);
  await tSaveTask(t);
  renderTasks();
}

async function logProduction(t, qtyVal, extra) {
  const add = Number(String(qtyVal == null ? "" : qtyVal).replace(",", "."));
  if (!add || add <= 0) { alert("Въведи брой в полето „днес“."); return; }
  let worker;
  if (amWorker()) {
    worker = MY_WORKER;
    if (!t.assignee) t.assignee = MY_WORKER;   // поемаме незаета задача
  } else {
    worker = t.assignee || document.getElementById("task-worker-filter").value;
    if (!worker) worker = prompt("Кой служител?", "") || "";
  }
  t.produced = (Number(t.produced) || 0) + add;
  t.logs = t.logs || [];
  const entry = { date: todayStr(), worker, qty: add };
  if (extra) Object.assign(entry, extra);   // machine, tPiece, tSheet, tOrder, consumables...
  t.logs.push(entry);
  await tSaveTask(t);
  renderTasks();
}

// Задължителен прозорец за машина + времена (за цеховете в WORKSHOPS_WITH_TIME)
function openProductionDialog(t, qtyPrefill) {
  // Персонален Отчетен прозорец (по служител) има предимство пред настройката на цеха.
  const wname = MY_WORKER || t.assignee || "";
  let wcfg = (FIELDS_BY_WORKER && FIELDS_BY_WORKER[wname]) || {};
  if (wcfg.byWorkshop) wcfg = wcfg.byWorkshop[t.workshop] || wcfg.byWorkshop["*"] || {};

  // Машини: масив → избор; false/[] → без поле за машина; иначе по цеха (или текст).
  const machines = ("machines" in wcfg) ? wcfg.machines : (MACHINES_BY_WORKSHOP[t.workshop] || null);
  const hasMachineSelect = Array.isArray(machines) && machines.length > 0;
  const noMachine = machines === false || (Array.isArray(machines) && machines.length === 0);
  const machineField = hasMachineSelect
    ? `<select id="pd-machine"><option value="">— избери машина —</option>${machines.map(m => `<option>${escapeHtml(m)}</option>`).join("")}</select>`
    : (noMachine ? "" : `<input id="pd-machine" type="text" placeholder="На коя машина работи?" />`);

  const fields = wcfg.timeFields || TIME_FIELDS_BY_WORKSHOP[t.workshop] || [
    { key: "tPiece", label: "Време за 1 брой", unit: "sec" },
    { key: "tOrder", label: "Време за цялата поръчка", unit: "min" },
  ];
  const extraFields = (wcfg.extraFields || EXTRA_FIELDS_BY_WORKSHOP[t.workshop] || []).slice();
  // „Специфична работа“ — поле за всеки служител (за гъвкавост при местене между цехове)
  if (!extraFields.some(f => f.key === "specific")) {
    extraFields.push({ key: "specific", label: "Специфична работа (накратко — ако е различна от обичайното)", required: false });
  }
  const timeRow = (f) => `
    <label>${escapeHtml(f.label)}
      <span class="pd-time">
        <input id="pd-${f.key}-v" type="number" min="0" step="any" inputmode="decimal" placeholder="0" />
        <select id="pd-${f.key}-u">
          <option value="sec" ${f.unit === "sec" ? "selected" : ""}>сек</option>
          <option value="min" ${f.unit === "min" ? "selected" : ""}>мин</option>
          <option value="hour" ${f.unit === "hour" ? "selected" : ""}>час</option>
        </select>
      </span>
    </label>`;
  const textRow = (f) => `
    <label>${escapeHtml(f.label)}${f.required ? " *" : ""}
      <textarea id="pd-x-${f.key}" rows="2" placeholder="${f.required ? "" : "по желание"}"></textarea>
    </label>`;
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box pd-box">
      <h3>⏱ Записване на изработката</h3>
      <div class="pd-task">
        <div><b>Клиент:</b> ${escapeHtml(t.client || "СЕРИЯ")}</div>
        <div><b>Продукт:</b> ${escapeHtml(t.product || "—")}${t.code ? ` <span class="muted">(${escapeHtml(t.code)})</span>` : ""}</div>
        ${t.operation ? `<div><b>Операция:</b> ${escapeHtml(t.operation)}</div>` : ""}
      </div>
      ${machineField ? `<label>Машина *${machineField}</label>` : ""}
      <label>Брой произведени сега *<input id="pd-qty" type="number" min="0" step="any" inputmode="decimal" value="${escapeAttr(String(qtyPrefill || ""))}" /></label>
      ${fields.length ? `<p class="pd-hint">⏱ Попълни поне едно от времената (другите може да оставиш празни):</p>` : ""}
      ${fields.map(timeRow).join("")}
      ${extraFields.map(textRow).join("")}
      <div class="ask-actions">
        <button id="pd-save" class="btn btn-primary">Запиши изработката</button>
        <button id="pd-cancel" class="btn">Отказ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#pd-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#pd-save").addEventListener("click", async () => {
    const mEl = wrap.querySelector("#pd-machine");
    const machine = (mEl && mEl.value || "").trim();
    const qty = Number(String(wrap.querySelector("#pd-qty").value).replace(",", "."));
    if (mEl && !machine) { alert("Избери машина."); return; }
    if (!qty || qty <= 0) { alert("Въведи брой произведени."); return; }
    const extra = {};
    if (machine) extra.machine = machine;
    // Времената: попълва се поне едно; празните се пропускат (0 е позволено = празно).
    let timeCount = 0;
    for (const f of fields) {
      const v = Number(String(wrap.querySelector("#pd-" + f.key + "-v").value).replace(",", "."));
      const unit = wrap.querySelector("#pd-" + f.key + "-u").value;
      const mult = unit === "hour" ? 3600 : (unit === "min" ? 60 : 1);
      const sec = v > 0 ? Math.round(v * mult) : 0;
      if (sec) { extra[f.key] = { v, unit, sec }; timeCount++; }
    }
    if (fields.length && timeCount === 0) { alert("Попълни поне едно от полетата за време."); return; }
    for (const f of extraFields) {
      const el = wrap.querySelector("#pd-x-" + f.key);
      const val = (el && el.value || "").trim();
      if (f.required && !val) { alert("Попълни „" + f.label + "“."); return; }
      if (val) extra[f.key] = val;
    }
    close();
    await logProduction(t, qty, extra);
  });
  setTimeout(() => { const m = wrap.querySelector("#pd-machine"); if (m) m.focus(); }, 50);
}

async function editTask(t) {
  if (amWorker()) return;
  t.client = prompt("Клиент:", t.client || "") ?? t.client;
  t.product = prompt("Продукт:", t.product || "") ?? t.product;
  t.operation = prompt("Операция:", t.operation || "") ?? t.operation;
  const q = prompt("Количество:", t.qty || "");
  if (q !== null) t.qty = q;
  t.due = prompt("Срок (текст):", t.due || "") ?? t.due;
  await tSaveTask(t);
  renderTasks();
}

async function deleteTask(t) {
  if (amWorker()) return;
  if (!confirm("Изтриване на задачата?")) return;
  const { error } = await sb.from("tasks").delete().eq("id", t.id);
  if (error) { alert("Грешка: " + error.message); return; }
  TASKS = TASKS.filter(x => x.id !== t.id);
  renderTasks();
}

async function deleteWorkshop(ws) {
  if (amWorker()) return;
  const ids = TASKS.filter(t => t.workshop === ws).map(t => t.id);
  if (!confirm(`Да изтрия цех „${ws}“ и неговите ${ids.length} задачи?`)) return;
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from("tasks").delete().in("id", ids.slice(i, i + 100));
    if (error) { alert("Грешка: " + error.message); return; }
  }
  delete WORKERS[ws];
  await tSaveWorkers();
  let rolesChanged = false;
  Object.keys(ROLES.byEmail || {}).forEach(e => {
    if (ROLES.byEmail[e].workshop === ws) { delete ROLES.byEmail[e]; rolesChanged = true; }
  });
  if (rolesChanged) await tSaveRoles();
  await tLoadTasks();
  renderWorkshopSelect(); renderWorkerFilter(); renderWorkers();
  alert(`Цех „${ws}“ е изтрит.`);
}

async function clearWorkshopTasks() {
  if (amWorker()) return;
  const ws = currentWorkshop();
  if (ws === "__all") { alert("Първо избери конкретен цех от менюто горе."); return; }
  const list = TASKS.filter(t => t.workshop === ws);
  if (!list.length) { alert("Няма задачи за цех „" + ws + "“."); return; }
  if (!confirm(`Да изтрия ВСИЧКИ ${list.length} задачи за цех „${ws}“?\n(Вписаното производство за тях също се изтрива.)`)) return;
  const ids = list.map(t => t.id);
  const paths = list.flatMap(t => (t.files || []).map(f => f.path)).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from("tasks").delete().in("id", ids.slice(i, i + 100));
    if (error) { alert("Грешка при изтриване: " + error.message); break; }
  }
  await tLoadTasks();
  renderTasks();
  alert(`Готово — изтрити ${ids.length} задачи за „${ws}“.`);
}

async function addTaskManual() {
  if (amWorker()) return;
  let ws = currentWorkshop();
  if (ws === "__all") ws = workshopList()[0];
  const t = {
    workshop: ws, client: "", product: "", code: "", operation: "",
    qty: "", produced: 0, due: "", assignee: "", logs: [], createdAt: new Date().toISOString(),
  };
  const { data, error } = await sb.from("tasks").insert({ data: t }).select().single();
  if (error) { alert("Грешка: " + error.message); return; }
  const nt = { ...data.data, id: data.id };
  TASKS.unshift(nt);
  renderTasks();
  editTask(nt);
}

/* ---------- Импорт от ERP (Excel) ---------- */
async function importERP(file) {
  if (amWorker()) return;
  if (typeof XLSX === "undefined") { alert("Библиотеката за Excel не се зареди. Опресни и опитай пак."); return; }
  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: "array" });
  } catch (e) { alert("Не може да се прочете файлът: " + e.message); return; }

  const newTasks = [];
  let skipped = 0;
  wb.SheetNames.forEach(sheetName => {
    const ws = mapSheetToWorkshop(sheetName);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const header = (rows[0] || []).map(h => String(h || "").toLowerCase().trim());
    const find = (re, not) => header.findIndex(h => re.test(h) && !(not && not.test(h)));

    const ci = find(/клиент/);
    let pi = header.findIndex(h => h === "продукт");
    if (pi < 0) pi = find(/продукт|изделие|деталий|детайл/, /код/);
    const codei = find(/код|артикулен/);
    const opi = find(/операц|артикул/, /код|артикулен/);
    const qi = find(/количество|^кол/);
    const prodi = find(/произвед|изработен/);
    const duei = find(/срок|спедиц/);
    const ai = find(/служ|отговор/);

    // Лист без разпознати колони (клиент/продукт) — пропускаме (напр. „Bizzio Export“)
    if (ci < 0 && pi < 0) { skipped++; return; }

    const val = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "");
    rows.slice(1).forEach(r => {
      const client = val(r, ci);
      const product = val(r, pi);
      const operation = val(r, opi);
      const qty = qi >= 0 && r[qi] !== "" ? Number(r[qi]) || 0 : "";
      const produced = prodi >= 0 && r[prodi] !== "" ? Number(r[prodi]) || 0 : 0;
      const due = val(r, duei);
      const code = val(r, codei);
      const assignee = val(r, ai);
      if (!product && !client && !qty) return; // празен ред
      newTasks.push({
        workshop: ws, client, product, code, operation,
        qty, produced, due, assignee, logs: [], files: [], createdAt: new Date().toISOString(),
      });
      if (assignee && !/^\d+([.,]\d+)?$/.test(assignee) &&
          !(WORKERS[ws] || []).some(n => n.toLowerCase() === assignee.toLowerCase())) {
        WORKERS[ws] = WORKERS[ws] || [];
        WORKERS[ws].push(assignee);
      }
    });
    if (!WORKERS[ws]) WORKERS[ws] = [];
  });

  if (!newTasks.length) { alert("Във файла няма редове за импорт."); return; }

  const shopsInFile = [...new Set(newTasks.map(t => t.workshop))];
  if (!confirm(
    `Намерени са ${newTasks.length} задачи за ${shopsInFile.length} цех(а):\n${shopsInFile.join(", ")}.\n\n` +
    `Старите задачи за ТЕЗИ цехове ще се ЗАМЕНЯТ с новите. Другите цехове остават непроменени.\n\nПродължи?`)) return;

  // изтриваме старите задачи само за цеховете, които са във файла
  const toDelete = TASKS.filter(t => shopsInFile.includes(t.workshop)).map(t => t.id);
  for (let i = 0; i < toDelete.length; i += 100) {
    const { error } = await sb.from("tasks").delete().in("id", toDelete.slice(i, i + 100));
    if (error) { alert("Грешка при изчистване: " + error.message); return; }
  }
  // вмъкване на партиди по 200
  for (let i = 0; i < newTasks.length; i += 200) {
    const chunk = newTasks.slice(i, i + 200).map(t => ({ data: t }));
    const { error } = await sb.from("tasks").insert(chunk);
    if (error) { alert("Грешка при импорт: " + error.message); break; }
  }
  await tSaveWorkers();
  await tLoadTasks();
  renderWorkshopSelect(); renderWorkerFilter(); renderTasks();
  alert(`Готово! Заредени ${newTasks.length} задачи.`);
}

/* ---------- Служители ---------- */
function toggleWorkers() {
  const v = document.getElementById("workers-view");
  if (!v.hidden) { showSub("tasks"); renderTasks(); return; }
  renderWorkers();
}
function renderWorkers() {
  showSub("workers");
  const v = document.getElementById("workers-view");
  v.innerHTML = `<div class="workers-head"><h3>Служители по цехове</h3>
    <button id="w-add-shop" class="btn btn-small">+ Нов цех</button>
    <button id="w-back" class="btn btn-small">← Назад</button></div>
    <p class="msg-hint">💡 След като добавиш нов служител, кажи на Клод да му направи <strong>Отчетен прозорец</strong> (машини и полета за отчитане).</p>
    <div id="workers-list"></div>`;
  v.querySelector("#w-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  v.querySelector("#w-add-shop").addEventListener("click", async () => {
    const name = prompt("Име на нов цех:", "");
    if (!name) return;
    if (!WORKERS[name]) WORKERS[name] = [];
    await tSaveWorkers(); renderWorkers(); renderWorkshopSelect();
  });

  const list = v.querySelector("#workers-list");
  workshopList().forEach(ws => {
    const box = document.createElement("div");
    box.className = "worker-shop";
    const names = WORKERS[ws] || [];
    const wsEmail = emailForWorkshop(ws);
    const isDefault = TASK_DEFAULT_WORKSHOPS.includes(ws);
    box.innerHTML = `<h4>${escapeHtml(ws)} ${isDefault ? "" : `<button class="btn btn-small btn-danger del-shop">🗑 Изтрий цеха</button>`}</h4>
      <div class="worker-chips">${names.map((n, i) =>
        `<span class="chip">${escapeHtml(n)} <button data-i="${i}" class="chip-x">×</button></span>`).join("") || "<em>няма</em>"}</div>
      <div class="worker-add"><input type="text" placeholder="Име на служител" /><button class="btn btn-small">+ Добави</button></div>
      <div class="ws-access">🔐 Имейл за вход (цех): <input type="text" class="ws-email" value="${escapeAttr(wsEmail)}" placeholder="напр. ${slugWs(ws)}@danko.local" /></div>`;
    const delShop = box.querySelector(".del-shop");
    if (delShop) delShop.addEventListener("click", () => deleteWorkshop(ws));
    const emailInp = box.querySelector(".ws-email");
    emailInp.addEventListener("change", async () => {
      await setWorkshopEmail(ws, emailInp.value.trim());
    });
    box.querySelectorAll(".chip-x").forEach(btn => btn.addEventListener("click", async () => {
      WORKERS[ws].splice(Number(btn.dataset.i), 1); await tSaveWorkers(); renderWorkers();
    }));
    const inp = box.querySelector(".worker-add input");
    const addFn = async () => {
      const n = inp.value.trim(); if (!n) return;
      if ((WORKERS[ws] || []).some(x => x.toLowerCase() === n.toLowerCase())) {
        alert("„" + n + "“ вече е в този цех."); inp.value = ""; return;
      }
      WORKERS[ws].push(n); await tSaveWorkers(); renderWorkers();
    };
    box.querySelector(".worker-add button").addEventListener("click", addFn);
    inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addFn(); } });
    list.appendChild(box);
  });
}

/* ---------- Отчет ---------- */
function toggleReport() {
  const v = document.getElementById("report-view");
  if (!v.hidden) { showSub("tasks"); renderTasks(); return; }
  renderReportUI();
}
function renderReportUI() {
  showSub("report");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const v = document.getElementById("report-view");
  v.innerHTML = `<div class="workers-head"><h3>Отчет за произведеното</h3>
    <button id="r-back" class="btn btn-small">← Назад</button></div>
    <div class="report-filters">
      От <input type="date" id="r-from" value="${monthAgo}" />
      до <input type="date" id="r-to" value="${today}" />
      <button id="r-go" class="btn btn-small btn-primary">Покажи</button>
    </div>
    <div id="report-out"></div>`;
  v.querySelector("#r-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  v.querySelector("#r-go").addEventListener("click", computeReport);
  computeReport();
}
function computeReport() {
  const from = document.getElementById("r-from").value;
  const to = document.getElementById("r-to").value;
  const byWorker = {}, byShop = {};
  TASKS.forEach(t => {
    (t.logs || []).forEach(l => {
      if (from && l.date < from) return;
      if (to && l.date > to) return;
      const w = l.worker || "(без име)";
      byWorker[w] = byWorker[w] || { qty: 0, shop: t.workshop };
      byWorker[w].qty += Number(l.qty) || 0;
      byShop[t.workshop] = (byShop[t.workshop] || 0) + (Number(l.qty) || 0);
    });
  });
  const out = document.getElementById("report-out");
  const wRows = Object.entries(byWorker).sort((a, b) => b[1].qty - a[1].qty);
  const sRows = Object.entries(byShop).sort((a, b) => b[1] - a[1]);
  out.innerHTML = `
    <h4>По служител</h4>
    <table class="report-table"><thead><tr><th>Служител</th><th>Цех</th><th class="num">Произведено</th></tr></thead>
    <tbody>${wRows.map(([w, d]) => `<tr><td>${escapeHtml(w)}</td><td>${escapeHtml(d.shop)}</td><td class="num">${d.qty}</td></tr>`).join("") || `<tr><td colspan="3" class="report-empty">Няма данни за периода.</td></tr>`}</tbody></table>
    <h4 style="margin-top:18px">По цех</h4>
    <table class="report-table"><thead><tr><th>Цех</th><th class="num">Произведено</th></tr></thead>
    <tbody>${sRows.map(([s, q]) => `<tr><td>${escapeHtml(s)}</td><td class="num">${q}</td></tr>`).join("") || `<tr><td colspan="2" class="report-empty">Няма данни за периода.</td></tr>`}</tbody></table>`;
}

/* ---------- Realtime ---------- */
function subscribeTasks() {
  if (tasksSubscribed) return;
  tasksSubscribed = true;
  sb.channel("tasks-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, async () => {
      if (document.getElementById("tasks-modal").hidden) return;
      await tLoadTasks();
      if (!document.getElementById("tasks-view").hidden) renderTasks();
    })
    .subscribe();
}

/* ---------- Вътрешни съобщения (служител ↔ админ) ---------- */
function msgMyName() {
  if (amWorker()) return MY_WORKER || (MY_ACCESS && MY_ACCESS.workshop) || "Служител";
  if (typeof authorName === "function") { const a = authorName(); if (a) return a; }
  return (MY_ACCESS && MY_ACCESS.email) || "Администратор";
}
function msgMyEmail() { return (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || ""; }
function isOwnerAdmin() {
  return (typeof MY_ACCESS !== "undefined" && MY_ACCESS && (MY_ACCESS.email || "").toLowerCase()) === "dankog@gmail.com";
}
// Всички админи виждат всички съобщения (пълна прозрачност); служителят — само своите.
// При въпрос „→ Име“ се вижда за кого е основно, но всеки админ може да го отвори/отговори.
function msgVisibleToMe(m) {
  if (amWorker()) return m.fromName === MY_WORKER;
  return true;
}
function msgFmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return iso;
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function taskRefText(t) {
  return `${t.client || "СЕРИЯ"}${t.product ? " · " + t.product : ""}${t.code ? " (" + t.code + ")" : ""}${t.operation ? " — " + t.operation : ""}`;
}

async function mLoad() {
  const { data, error } = await sb.from("messages").select("*").order("created_at", { ascending: false });
  if (error) { console.error("messages load", error.message); MESSAGES = []; return; }
  MESSAGES = (data || []).map(r => ({ ...r.data, id: r.id }));
}
async function mInsert(m) {
  const { data, error } = await sb.from("messages").insert({ data: m }).select().single();
  if (error) {
    alert("Грешка при изпращане на съобщението: " + error.message +
      "\n(Ако таблицата „messages“ още не е създадена, кажи на Данко да пусне SQL-а messages-setup.sql в Supabase.)");
    return null;
  }
  const rec = { ...data.data, id: data.id };
  MESSAGES.unshift(rec);
  return rec;
}
async function mUpdate(m) {
  m.updatedAt = new Date().toISOString();
  const { error } = await sb.from("messages").update({ data: m }).eq("id", m.id);
  if (error) { alert("Грешка при запис: " + error.message); }
}
// Съобщенията между служители и админи НЕ могат да се трият — пазят се завинаги.
async function mDelete() {
  alert("Съобщенията не могат да се изтриват — те се пазят като архив на комуникацията.");
}

function taskQuestionCell(t) {
  const mine = MESSAGES.filter(m => m.taskId === t.id && msgVisibleToMe(m));
  const openCount = mine.filter(m => m.status !== "closed").length;
  const askBtn = amWorker() ? `<button type="button" class="btn btn-small t-ask" title="Задай въпрос към технолог/организатор">❓ Питай</button>` : "";
  const viewBtn = mine.length
    ? `<button type="button" class="btn btn-small t-qview ${openCount ? "q-open" : ""}" title="Виж съобщенията">💬 ${mine.length}</button>`
    : (amWorker() ? "" : "—");
  return askBtn + (askBtn && viewBtn ? " " : "") + viewBtn;
}

function msgIsSupply(m) { return (m.type || "question") === "supply"; }
// Брои отделно въпросите (q) и поръчките за снабдяване (s), които изискват внимание
function msgCounts() {
  const isW = amWorker();
  let q = 0, s = 0;
  MESSAGES.forEach(m => {
    if (!msgVisibleToMe(m)) return;
    const supply = msgIsSupply(m);
    if (isW) {
      if (m.fromName !== MY_WORKER) return;
      if (m.seenByWorker === false) { if (supply) s++; else q++; }
    } else if (supply) {
      if (m.status !== "closed" && !m.acceptedBy) s++;   // поръчки, които чакат приемане
    } else {
      if (m.seenByAdmin === false && m.status !== "closed") q++;
    }
  });
  return { q, s };
}
// Фирмено броене — всички админи виждат еднакво, независимо до кого е съобщението.
// Въпрос „чака внимание“ = отворен и още без отговор от админ; поръчка = отворена и неприета.
function companyOpenCount() {
  let q = 0, s = 0;
  MESSAGES.forEach(m => {
    if (m.status === "closed") return;
    if (msgIsSupply(m)) { if (!m.acceptedBy) s++; }
    else {
      const reps = m.replies || [];
      const lastAdmin = reps.length && reps[reps.length - 1].by === "admin";
      if (!lastAdmin) q++;
    }
  });
  return { q, s, total: q + s };
}
function mUpdateBadge() {
  const { q, s } = msgCounts();
  const isAdmin = typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.isAdmin;
  const mb = document.getElementById("msg-badge"); if (mb) { mb.textContent = q; mb.hidden = q === 0; }
  const sb2 = document.getElementById("supply-badge"); if (sb2) { sb2.textContent = s; sb2.hidden = s === 0; }

  const co = companyOpenCount();
  const mbm = document.getElementById("msg-badge-main");
  if (mbm) { const n = isAdmin ? co.total : q; mbm.textContent = n; mbm.hidden = n === 0; }

  const alert = document.getElementById("msg-alert");
  if (alert) {
    if (isAdmin && co.total > 0) {
      const parts = [];
      if (co.q) parts.push(`<b>${co.q}</b> ${co.q === 1 ? "нов въпрос" : "нови въпроса"}`);
      if (co.s) parts.push(`<b>${co.s}</b> ${co.s === 1 ? "поръчка за снабдяване" : "поръчки за снабдяване"}`);
      alert.innerHTML = `🔔 Има ${parts.join(" и ")} в Цехове — натисни, за да видиш.`;
      alert.hidden = false;
    } else {
      alert.hidden = true;
    }
  }
}
async function openMessagesFromBanner() {
  await openTasks();
  const co = companyOpenCount();
  msgType = (co.q > 0 || co.s === 0) ? "question" : "supply";
  msgFilterTask = null; msgView = "active";
  renderMessages();
  markMessagesSeen();
}
// Зарежда съобщенията и пуска реалтайм, за да работи балончето на основния екран (за админи)
async function ensureMessagesBadge() {
  if (typeof sb === "undefined" || !sb) return;
  try {
    if (!tasksLoaded) await mLoad();
    msgNotifyState = snapshotNotify();
    requestNotifyPermission();
    subscribeMessages();
    mUpdateBadge();
  } catch (e) { console.error("messages badge init", e); }
}
// Отваря модула направо на изгледа „Съобщения“ (от бутона на основния екран)
async function openMessagesFromMain() {
  await openTasks();
  msgType = "question"; msgFilterTask = null; msgView = "active";
  renderMessages();
  markMessagesSeen();
}
async function markMessagesSeen() {
  const toMark = MESSAGES.filter(m => {
    if (!msgVisibleToMe(m)) return false;
    if (msgIsSupply(m) !== (msgType === "supply")) return false;   // само текущия раздел
    if (amWorker()) return m.fromName === MY_WORKER && m.seenByWorker === false;
    return m.seenByAdmin === false;
  });
  for (const m of toMark) {
    if (amWorker()) m.seenByWorker = true; else m.seenByAdmin = true;
    await mUpdate(m);
  }
  mUpdateBadge();
}

// Списък с админи (име + имейл) — от AUTHOR_BY_EMAIL в contacts.js, иначе резервен списък
function adminDirectory() {
  if (typeof AUTHOR_BY_EMAIL === "object" && AUTHOR_BY_EMAIL) {
    const arr = Object.entries(AUTHOR_BY_EMAIL).map(([email, name]) => ({ email, name }));
    if (arr.length) return arr;
  }
  return [
    { email: "danko.orders@gmail.com", name: "Таня Илиева" },
    { email: "office@dankosystems.com", name: "Кристина Дончева" },
    { email: "dankog@gmail.com", name: "Данко Георгиев" },
  ];
}
function askTaskQuestion(t) {
  if (!amWorker()) return;
  openAskDialog({ taskId: t.id, taskRef: taskRefText(t), workshop: (MY_ACCESS && MY_ACCESS.workshop) || t.workshop || "" });
}
function askGeneralQuestion() {
  openAskDialog({ taskId: null, taskRef: "", workshop: (MY_ACCESS && MY_ACCESS.workshop) || "" });
}
function openAskDialog(ctx) {
  const admins = adminDirectory();
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box">
      <h3>❓ Нов въпрос</h3>
      ${ctx.taskRef ? `<div class="msg-task">📋 ${escapeHtml(ctx.taskRef)}</div>` : ""}
      <label>До кого е въпросът
        <select id="ask-to">
          ${admins.map(a => `<option value="${escapeAttr(a.email)}">${escapeHtml(a.name)}</option>`).join("")}
        </select>
      </label>
      <label>Въпрос
        <textarea id="ask-text" rows="4" placeholder="Напиши въпроса си към технолог / организатор производство..."></textarea>
      </label>
      <div class="ask-actions">
        <button id="ask-send" class="btn btn-primary">Изпрати</button>
        <button id="ask-cancel" class="btn">Отказ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#ask-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#ask-send").addEventListener("click", async () => {
    const text = wrap.querySelector("#ask-text").value.trim();
    if (!text) { alert("Напиши въпрос."); return; }
    const sel = wrap.querySelector("#ask-to");
    const toEmail = sel.value;
    const toName = (admins.find(a => a.email === toEmail) || {}).name || "";
    close();
    await sendWorkerQuestion({ ...ctx, text, toEmail, toName });
  });
  setTimeout(() => { const ta = wrap.querySelector("#ask-text"); if (ta) ta.focus(); }, 50);
}
async function sendWorkerQuestion(ctx) {
  const now = new Date().toISOString();
  const m = {
    from: "worker", fromName: msgMyName(), fromEmail: msgMyEmail(),
    workshop: ctx.workshop || "",
    taskId: ctx.taskId || null, taskRef: ctx.taskRef || "",
    toEmail: ctx.toEmail || "", toName: ctx.toName || "",
    text: ctx.text.trim(), status: "open", replies: [],
    seenByAdmin: false, seenByWorker: true,
    createdAt: now, updatedAt: now,
  };
  const rec = await mInsert(m);
  if (rec) {
    msgNotifyState = snapshotNotify();   // да не отброи собствения въпрос като „ново“
    alert("Въпросът е изпратен" + (ctx.toName ? " до " + ctx.toName : "") + ". ✅");
    mUpdateBadge();
    if (!document.getElementById("messages-view").hidden) renderMessages(); else renderTasks();
  }
}
async function mReply(m, text) {
  if (!text || !text.trim()) return;
  m.replies = m.replies || [];
  m.replies.push({ by: amWorker() ? "worker" : "admin", name: msgMyName(), email: msgMyEmail(), text: text.trim(), at: new Date().toISOString() });
  if (amWorker()) m.seenByAdmin = false; else m.seenByWorker = false;
  await mUpdate(m);
  mUpdateBadge(); renderMessages();
}
async function mResolve(m, close) {
  m.status = close ? "closed" : "open";
  if (close) m.seenByWorker = false;   // служителят вижда, че е решено
  await mUpdate(m);
  mUpdateBadge(); renderMessages();
}

function openMessages() {
  const v = document.getElementById("messages-view");
  if (!v.hidden && msgType === "question") { showSub("tasks"); renderTasks(); return; }
  msgType = "question"; msgFilterTask = null; msgView = "active";
  renderMessages();
  markMessagesSeen();
}
function openSupply() {
  const v = document.getElementById("messages-view");
  if (!v.hidden && msgType === "supply") { showSub("tasks"); renderTasks(); return; }
  msgType = "supply"; msgFilterTask = null; msgView = "active";
  renderMessages();
  markMessagesSeen();
}
async function mAccept(m) {
  if (amWorker()) return;
  m.acceptedBy = { name: msgMyName(), email: msgMyEmail(), at: new Date().toISOString() };
  m.seenByWorker = false;   // служителят вижда, че е приета
  await mUpdate(m);
  mUpdateBadge(); renderMessages();
}
function openSupplyForm() {
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box">
      <h3>📦 Нова поръчка за снабдяване</h3>
      <p class="muted" style="margin:2px 0 8px">Опиши какви консумативи или материали са нужни. Поръчката отива до администраторите.</p>
      <label>Какво е необходимо *<textarea id="sp-text" rows="5" placeholder="Напр.: 10 бр. фрези Ø6 за CNC; 2 листа ламарина 2 мм; ..."></textarea></label>
      <div class="ask-actions">
        <button id="sp-send" class="btn btn-primary">Изпрати поръчката</button>
        <button id="sp-cancel" class="btn">Отказ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#sp-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#sp-send").addEventListener("click", async () => {
    const text = (wrap.querySelector("#sp-text").value || "").trim();
    if (!text) { alert("Опиши какво ти трябва."); return; }
    close();
    const now = new Date().toISOString();
    const m = {
      type: "supply", from: "worker", fromName: msgMyName(), fromEmail: msgMyEmail(),
      workshop: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.workshop) || "",
      taskId: null, taskRef: "", text, status: "open", acceptedBy: null, replies: [],
      seenByAdmin: false, seenByWorker: true, createdAt: now, updatedAt: now,
    };
    const rec = await mInsert(m);
    if (rec) {
      msgNotifyState = snapshotNotify();
      alert("Поръчката за снабдяване е изпратена до администраторите. ✅");
      msgType = "supply"; mUpdateBadge();
      if (!document.getElementById("messages-view").hidden) renderMessages();
    }
  });
  setTimeout(() => { const ta = wrap.querySelector("#sp-text"); if (ta) ta.focus(); }, 50);
}
function msgRepliesHtml(m) {
  return (m.replies || []).map(r =>
    `<div class="msg-reply ${r.by === "admin" ? "from-admin" : "from-worker"}">
       <div class="msg-meta"><strong>${escapeHtml(r.name || "")}</strong> · ${escapeHtml(msgFmtTime(r.at))}</div>
       <div class="msg-text">${escapeHtml(r.text || "").replace(/\n/g, "<br>")}</div>
     </div>`).join("");
}
function supplyCardHtml(m) {
  const closed = m.status === "closed";
  const isAdmin = !amWorker();
  const acc = m.acceptedBy;
  const replies = msgRepliesHtml(m);
  return `<div class="msg-card supply ${closed ? "closed" : (acc ? "accepted" : "unaccepted")}" data-id="${m.id}">
    <div class="msg-head">
      <div class="msg-who"><span class="msg-from">${escapeHtml(m.fromName || "")}</span>${m.workshop ? ` <span class="msg-ws">${escapeHtml(m.workshop)}</span>` : ""}</div>
      <div class="msg-date">${escapeHtml(msgFmtTime(m.createdAt))}${closed ? ' · <span class="msg-done">изпълнена ✓</span>' : ""}</div>
    </div>
    <div class="msg-q">${escapeHtml(m.text || "").replace(/\n/g, "<br>")}</div>
    ${acc
      ? `<div class="supply-acc">✅ Приета от <b>${escapeHtml(acc.name || "")}</b> · ${escapeHtml(msgFmtTime(acc.at))}</div>`
      : `<div class="supply-wait">⏳ Чака приемане</div>`}
    ${replies ? `<div class="msg-replies">${replies}</div>` : ""}
    ${closed
      ? (isAdmin ? `<div class="msg-actions-row"><button class="btn btn-small msg-reopen">↻ Отвори пак</button></div>` : "")
      : `<div class="msg-actions">
           ${isAdmin && !acc ? `<button class="btn btn-small btn-primary msg-accept">✅ Приеми (поемам отговорност)</button>` : ""}
           <textarea class="msg-reply-in" rows="2" placeholder="Коментар..."></textarea>
           <div class="msg-actions-row">
             <button class="btn btn-small msg-send">Коментар</button>
             ${isAdmin ? '<button class="btn btn-small msg-resolve">✓ Изпълнена</button>' : ""}
           </div>
         </div>`}
  </div>`;
}
function msgCardHtml(m) {
  if (msgIsSupply(m)) return supplyCardHtml(m);
  const replies = (m.replies || []).map(r =>
    `<div class="msg-reply ${r.by === "admin" ? "from-admin" : "from-worker"}">
       <div class="msg-meta"><strong>${escapeHtml(r.name || "")}</strong> · ${escapeHtml(msgFmtTime(r.at))}</div>
       <div class="msg-text">${escapeHtml(r.text || "").replace(/\n/g, "<br>")}</div>
     </div>`).join("");
  const closed = m.status === "closed";
  const isAdmin = !amWorker();
  return `<div class="msg-card ${closed ? "closed" : ""}" data-id="${m.id}">
    <div class="msg-head">
      <div class="msg-who"><span class="msg-from">${escapeHtml(m.fromName || "")}</span>${m.workshop ? ` <span class="msg-ws">${escapeHtml(m.workshop)}</span>` : ""}${m.toName ? ` <span class="msg-to">→ ${escapeHtml(m.toName)}</span>` : ""}</div>
      <div class="msg-date">${escapeHtml(msgFmtTime(m.createdAt))}${closed ? ' · <span class="msg-done">решено ✓</span>' : ""}</div>
    </div>
    ${m.taskRef ? `<div class="msg-task">📋 ${escapeHtml(m.taskRef)}</div>` : ""}
    <div class="msg-q">${escapeHtml(m.text || "").replace(/\n/g, "<br>")}</div>
    ${replies ? `<div class="msg-replies">${replies}</div>` : ""}
    ${closed
      ? (isAdmin ? `<div class="msg-actions-row"><button class="btn btn-small msg-reopen">↻ Отвори пак</button></div>` : "")
      : `<div class="msg-actions">
           <textarea class="msg-reply-in" rows="2" placeholder="${isAdmin ? "Отговор към служителя..." : "Допълнение / отговор..."}"></textarea>
           <div class="msg-actions-row">
             <button class="btn btn-small btn-primary msg-send">Отговори</button>
             ${isAdmin ? '<button class="btn btn-small msg-resolve">✓ Изпълнено</button>' : ""}
           </div>
         </div>`}
  </div>`;
}
function renderMessages() {
  showSub("messages");
  const v = document.getElementById("messages-view");
  const isW = amWorker();
  const supplyMode = msgType === "supply";
  const visible = MESSAGES.filter(msgVisibleToMe);
  const cntQ = visible.filter(m => !msgIsSupply(m) && m.status !== "closed").length;
  const cntS = visible.filter(m => msgIsSupply(m) && m.status !== "closed").length;

  let base = visible.filter(m => msgIsSupply(m) === supplyMode);
  if (!supplyMode && msgFilterTask) base = base.filter(m => m.taskId === msgFilterTask);
  const nActive = base.filter(m => m.status !== "closed").length;
  const nDone = base.filter(m => m.status === "closed").length;
  let list = base.slice();
  if (msgView === "active") list = list.filter(m => m.status !== "closed");
  else if (msgView === "done") list = list.filter(m => m.status === "closed");
  list.sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));

  const tab = (key, label, n) => `<button class="msg-tab ${msgView === key ? "active" : ""}" data-view="${key}">${label} (${n})</button>`;
  const ttab = (ty, label, n) => `<button class="msg-ttab ${msgType === ty ? "active" : ""}" data-type="${ty}">${label}${n ? ` <span class="ttab-n">${n}</span>` : ""}</button>`;
  const emptyText = supplyMode
    ? (msgView === "done" ? "Няма изпълнени поръчки." : "Няма поръчки за снабдяване.")
    : (msgView === "done" ? "Все още няма приключени съобщения." : "Няма съобщения.");
  const newBtn = supplyMode
    ? '<button id="msg-new" class="btn btn-small btn-primary">+ Нова поръчка</button>'
    : (isW ? '<button id="msg-new" class="btn btn-small btn-primary">+ Нов въпрос</button>' : "");

  v.innerHTML = `
    <div class="workers-head">
      <h3>${supplyMode ? "📦 Поръчки за снабдяване" : "📨 Регистър на съобщенията"}${(!supplyMode && msgFilterTask) ? " · по задача" : ""}</h3>
      ${(!supplyMode && msgFilterTask) ? '<button id="msg-clear-filter" class="btn btn-small">Всички задачи</button>' : ""}
      ${newBtn}
      <button id="msg-back" class="btn btn-small">← Назад</button>
    </div>
    <div class="msg-typetabs">
      ${ttab("question", "❓ Въпроси", cntQ)}
      ${ttab("supply", "📦 Поръчки за снабдяване", cntS)}
    </div>
    <div class="msg-tabs">
      ${tab("active", supplyMode ? "Чакащи" : "Активни", nActive)}
      ${tab("done", "✓ Изпълнени", nDone)}
      ${tab("all", "Всички", nActive + nDone)}
    </div>
    ${(supplyMode && msgView === "active") ? '<p class="msg-hint">Поръчката стои отворена, докато някой админ я приеме. Който я приеме — носи отговорността.</p>' : ""}
    ${(msgView === "done") ? '<p class="msg-hint">История — целият разговор се пази.</p>' : ""}
    <div class="msg-list">${list.map(msgCardHtml).join("") || `<p class="report-empty">${emptyText}</p>`}</div>`;

  v.querySelector("#msg-back").addEventListener("click", () => { msgFilterTask = null; showSub("tasks"); renderTasks(); });
  const cf = v.querySelector("#msg-clear-filter"); if (cf) cf.addEventListener("click", () => { msgFilterTask = null; renderMessages(); });
  v.querySelectorAll(".msg-tab").forEach(b => b.addEventListener("click", () => { msgView = b.dataset.view; renderMessages(); }));
  v.querySelectorAll(".msg-ttab").forEach(b => b.addEventListener("click", () => { msgType = b.dataset.type; msgView = "active"; msgFilterTask = null; renderMessages(); markMessagesSeen(); }));
  const nw = v.querySelector("#msg-new"); if (nw) nw.addEventListener("click", supplyMode ? openSupplyForm : askGeneralQuestion);

  v.querySelectorAll(".msg-card").forEach(card => {
    const m = MESSAGES.find(x => x.id === card.dataset.id); if (!m) return;
    const send = card.querySelector(".msg-send");
    if (send) send.addEventListener("click", () => { const ta = card.querySelector(".msg-reply-in"); mReply(m, ta.value); });
    const res = card.querySelector(".msg-resolve"); if (res) res.addEventListener("click", () => mResolve(m, true));
    const reo = card.querySelector(".msg-reopen"); if (reo) reo.addEventListener("click", () => mResolve(m, false));
    const acc = card.querySelector(".msg-accept"); if (acc) acc.addEventListener("click", () => mAccept(m));
  });
}
/* ---------- Известия (notifications) ---------- */
function snapshotNotify() {
  const replyCounts = {}; const ids = [];
  MESSAGES.forEach(m => {
    if (!msgVisibleToMe(m)) return;
    ids.push(m.id);
    replyCounts[m.id] = (m.replies || []).length;
  });
  return { replyCounts, ids };
}
function requestNotifyPermission() {
  try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) {}
}
function fireBrowserNotification(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      const n = new Notification(title, { body, icon: "logo.png" });
      n.onclick = () => { try { window.focus(); } catch (e) {} openMessagesFromNotify(); n.close(); };
    }
  } catch (e) {}
}
function showToast(text) {
  let t = document.getElementById("danko-toast");
  if (!t) { t = document.createElement("div"); t.id = "danko-toast"; t.className = "danko-toast"; document.body.appendChild(t); }
  t.textContent = text;
  t.onclick = () => { t.classList.remove("show"); openMessagesFromNotify(); };
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 7000);
}
function openMessagesFromNotify() {
  if (document.getElementById("tasks-modal").hidden) { openMessagesFromMain(); return; }
  msgFilterTask = null;
  renderMessages();
  markMessagesSeen();
}
function detectAndNotify(before) {
  if (amWorker()) {
    // нов отговор от админ към мой въпрос
    MESSAGES.forEach(m => {
      if (m.fromName !== MY_WORKER) return;
      const prev = before.replyCounts[m.id] || 0;
      const now = (m.replies || []).length;
      if (now > prev) {
        const last = m.replies[now - 1];
        if (last && last.by === "admin") {
          const title = "📨 Нов отговор от " + (last.name || "администратор");
          fireBrowserNotification(title, (m.taskRef ? m.taskRef + "\n" : "") + (last.text || ""));
          showToast(title + " — натисни тук, за да видиш.");
        }
      }
    });
  } else {
    // нов въпрос от служител, адресиран до мен
    const had = new Set(before.ids);
    MESSAGES.forEach(m => {
      if (!msgVisibleToMe(m)) return;
      if (m.from === "worker" && !had.has(m.id)) {
        const title = (msgIsSupply(m) ? "📦 Нова поръчка за снабдяване от " : "📨 Нов въпрос от ") + (m.fromName || "служител");
        fireBrowserNotification(title, (m.taskRef ? m.taskRef + "\n" : "") + (m.text || ""));
        showToast(title + " — натисни тук, за да видиш.");
      }
    });
  }
}

function subscribeMessages() {
  if (messagesSubscribed) return;
  messagesSubscribed = true;
  sb.channel("messages-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async () => {
      const before = msgNotifyState;
      await mLoad();
      detectAndNotify(before);
      msgNotifyState = snapshotNotify();
      mUpdateBadge();
      if (document.getElementById("tasks-modal").hidden) return;   // балончето/известията работят и без отворен модул
      if (!document.getElementById("messages-view").hidden) renderMessages();
      else if (!document.getElementById("tasks-view").hidden) renderTasks();
    })
    .subscribe();
}

/* ---------- Времена за изработка (само админи) ---------- */
function fmtSecDur(obj) {
  const s = obj && obj.sec;
  if (!s) return "—";
  if (s < 60) return s + " сек";
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m} мин ${r} сек` : `${m} мин`; }
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
  return mm ? `${h} ч ${mm} мин` : `${h} ч`;
}
function fmtLogDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (d || "");
}
function logNotes(l) {
  const parts = [];
  if (l.consumables) parts.push("Консумативи: " + l.consumables);
  if (l.assemblyNote) parts.push("Сглобено: " + l.assemblyNote);
  if (l.specific) parts.push("Специфично: " + l.specific);
  return parts.join(" · ");
}
function collectTimeRows() {
  const rows = [];
  TASKS.forEach(t => (t.logs || []).forEach(l => {
    // включваме всяко вписване, направено през Отчетния прозорец (с машина, време или бележка)
    if (!l.machine && !l.tPiece && !l.tSheet && !l.tOrder && !l.consumables && !l.specific && !l.assemblyNote) return;
    rows.push({
      date: l.date || "", workshop: t.workshop || "", machine: l.machine || "",
      client: t.client || "", product: t.product || "", code: t.code || "", operation: t.operation || "",
      worker: l.worker || "", qty: Number(l.qty) || 0,
      tPiece: l.tPiece, tSheet: l.tSheet, tOrder: l.tOrder, tSetup: l.tSetup,
      notes: logNotes(l),
    });
  }));
  return rows;
}
function toggleTimes() {
  const v = document.getElementById("times-view");
  if (!v.hidden) { showSub("tasks"); renderTasks(); return; }
  renderTimes();
}
function renderTimes() {
  showSub("times");
  const v = document.getElementById("times-view");
  const all = collectTimeRows();
  const uniq = key => [...new Set(all.map(r => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const workshops = uniq("workshop"), machines = uniq("machine"), workers = uniq("worker");
  const f = timesFilter;
  const rows = all
    .filter(r => (!f.workshop || r.workshop === f.workshop) && (!f.machine || r.machine === f.machine) && (!f.worker || r.worker === f.worker))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const opt = (val, sel) => `<option ${val === sel ? "selected" : ""}>${escapeHtml(val)}</option>`;
  v.innerHTML = `
    <div class="workers-head"><h3>⏱ Времена за изработка</h3>
      <button id="times-back" class="btn btn-small">← Назад</button></div>
    <div class="times-filters">
      <label>Цех <select id="tf-ws"><option value="">Всички</option>${workshops.map(w => opt(w, f.workshop)).join("")}</select></label>
      <label>Машина <select id="tf-m"><option value="">Всички</option>${machines.map(m => opt(m, f.machine)).join("")}</select></label>
      <label>Служител <select id="tf-w"><option value="">Всички</option>${workers.map(w => opt(w, f.worker)).join("")}</select></label>
      <span class="muted times-count">${rows.length} записа</span>
      <button id="times-csv" class="btn btn-small">⤓ Експорт (Excel)</button>
    </div>
    <table class="report-table times-table">
      <thead><tr>
        <th>Дата</th><th>Цех</th><th>Машина</th><th>Клиент</th><th>Продукт</th><th>Операция</th><th>Служител</th>
        <th class="num">Брой</th><th>1 брой</th><th>1 лист</th><th>Кол-во/поръчка</th><th>Настройка</th><th>Бележки</th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${escapeHtml(fmtLogDate(r.date))}</td>
        <td>${escapeHtml(r.workshop) || "—"}</td>
        <td>${escapeHtml(r.machine) || "—"}</td>
        <td>${r.client ? escapeHtml(r.client) : `<span class="serie">СЕРИЯ</span>`}</td>
        <td>${escapeHtml(r.product) || "—"}${r.code ? `<div class="t-code">${escapeHtml(r.code)}</div>` : ""}</td>
        <td>${escapeHtml(r.operation) || "—"}</td>
        <td>${escapeHtml(r.worker) || "—"}</td>
        <td class="num">${r.qty}</td>
        <td>${escapeHtml(fmtSecDur(r.tPiece))}</td>
        <td>${escapeHtml(fmtSecDur(r.tSheet))}</td>
        <td>${escapeHtml(fmtSecDur(r.tOrder))}</td>
        <td>${escapeHtml(fmtSecDur(r.tSetup))}</td>
        <td class="times-cons">${r.notes ? escapeHtml(r.notes) : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="13" class="report-empty">Няма записани времена за този филтър.</td></tr>`}</tbody>
    </table>`;
  v.querySelector("#times-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  v.querySelector("#tf-ws").addEventListener("change", e => { timesFilter.workshop = e.target.value; renderTimes(); });
  v.querySelector("#tf-m").addEventListener("change", e => { timesFilter.machine = e.target.value; renderTimes(); });
  v.querySelector("#tf-w").addEventListener("change", e => { timesFilter.worker = e.target.value; renderTimes(); });
  v.querySelector("#times-csv").addEventListener("click", () => exportTimesCsv(rows));
}
function exportTimesCsv(rows) {
  const head = ["Дата", "Цех", "Машина", "Клиент", "Продукт", "Код", "Операция", "Служител", "Брой", "Време 1 брой (сек)", "Време 1 лист (сек)", "Време кол-во/поръчка (сек)", "Настройка (сек)", "Бележки"];
  const esc = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const lines = [head.map(esc).join(",")];
  rows.forEach(r => lines.push([
    fmtLogDate(r.date), r.workshop, r.machine, r.client, r.product, r.code, r.operation, r.worker, r.qty,
    (r.tPiece && r.tPiece.sec) || "", (r.tSheet && r.tSheet.sec) || "", (r.tOrder && r.tOrder.sec) || "", (r.tSetup && r.tSetup.sec) || "", r.notes || "",
  ].map(esc).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vremena.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Инициализация ---------- */
function tInit() {
  const btn = document.getElementById("btn-tasks");
  if (!btn) return;
  btn.addEventListener("click", openTasks);
  document.getElementById("tasks-close").addEventListener("click", () => {
    document.getElementById("tasks-modal").hidden = true;
  });
  document.getElementById("tasks-logout").addEventListener("click", () => {
    MY_WORKER = null;
    if (typeof sb !== "undefined" && sb) sb.auth.signOut();
  });
  document.getElementById("task-workshop").addEventListener("change", () => { selectedTasks.clear(); renderWorkerFilter(); renderTasks(); });
  document.getElementById("task-worker-filter").addEventListener("change", renderTasks);
  document.getElementById("task-search").addEventListener("input", renderTasks);
  const thead = document.querySelector(".tasks-table thead");
  if (thead) thead.addEventListener("click", e => {
    const th = e.target.closest("th[data-sort]"); if (!th) return;
    const key = th.dataset.sort;
    if (sortState.key === key) sortState.dir *= -1;
    else { sortState.key = key; sortState.dir = 1; }
    renderTasks();
  });
  document.getElementById("btn-add-task").addEventListener("click", addTaskManual);
  document.getElementById("erp-file").addEventListener("change", e => {
    if (e.target.files[0]) importERP(e.target.files[0]); e.target.value = "";
  });
  document.getElementById("task-file").addEventListener("change", e => {
    if (taskFileTarget && e.target.files.length) handleTaskFiles(taskFileTarget, [...e.target.files]);
    e.target.value = ""; taskFileTarget = null;
  });
  document.getElementById("btn-workers").addEventListener("click", toggleWorkers);
  document.getElementById("btn-clear-workshop").addEventListener("click", clearWorkshopTasks);
  document.getElementById("btn-task-report").addEventListener("click", toggleReport);
  const bt = document.getElementById("btn-times"); if (bt) bt.addEventListener("click", toggleTimes);
  const bm = document.getElementById("btn-messages"); if (bm) bm.addEventListener("click", openMessages);
  const bsup = document.getElementById("btn-supply"); if (bsup) bsup.addEventListener("click", openSupply);
  const balert = document.getElementById("msg-alert"); if (balert) balert.addEventListener("click", openMessagesFromBanner);
  const bmm = document.getElementById("btn-main-messages"); if (bmm) bmm.addEventListener("click", openMessagesFromMain);
}
document.addEventListener("DOMContentLoaded", tInit);
