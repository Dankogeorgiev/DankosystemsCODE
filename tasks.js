/* Данко Системс — Модул „Цехове / Производствени задачи“
   Използва глобалния Supabase клиент (sb) и помощните функции от app.js.
   Данните се пазят в таблица `tasks`, служителите — в `app_config`. */

const TASK_DEFAULT_WORKSHOPS = ["Лазери", "Преси", "Абкант", "Заваръчно", "Занитване", "Бояджийно"];

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
let sortState = { key: null, dir: 1 };
let workersSeededV1 = false;

function dueSortVal(due) {
  const m = String(due || "").match(/(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (!m) return 99999999;
  let [, d, mo, y] = m; if (y.length === 2) y = "20" + y;
  return Number(y) * 10000 + Number(mo) * 100 + Number(d);
}
const SORT_KEYS = {
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
  const map = { "Лазери": "laseri", "Преси": "presi", "Абкант": "abkant", "Заваръчно": "zavarka", "Занитване": "zanitvane", "Бояджийно": "boyadjiino" };
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
  if (!tasksLoaded) { await tLoadWorkers(); await tLoadRoles(); await tLoadTasks(); tasksLoaded = true; subscribeTasks(); }
  applyTasksAccess();
  renderWorkshopSelect();
  renderWorkerFilter();
  renderTasks();
}

function applyTasksAccess() {
  const w = amWorker();
  ["btn-add-task", "btn-workers", "btn-task-report", "btn-clear-workshop", "tasks-close"].forEach(id => {
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
    renderTasks();
  }));
}
function showSub(which) {
  document.getElementById("tasks-view").hidden = which !== "tasks";
  document.getElementById("workers-view").hidden = which !== "workers";
  document.getElementById("report-view").hidden = which !== "report";
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

  if (sortState.key && SORT_KEYS[sortState.key]) {
    const f = SORT_KEYS[sortState.key];
    rows.sort((a, b) => {
      const va = f(a), vb = f(b);
      if (va < vb) return -1 * sortState.dir;
      if (va > vb) return 1 * sortState.dir;
      return 0;
    });
  }
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

    const tr = document.createElement("tr");
    tr.className = "task-" + st;
    tr.innerHTML = `
      <td>${t.client ? escapeHtml(t.client) : `<span class="serie">СЕРИЯ</span>`}</td>
      <td>${escapeHtml(t.product) || "—"}<div class="t-code">${escapeHtml(t.code || "")}</div></td>
      <td class="t-files">${taskFilesCell(t)}</td>
      <td>${escapeHtml(t.operation) || (ws === "__all" ? escapeHtml(t.workshop) : "—")}</td>
      <td class="num">${qty || "—"}</td>
      <td class="num"><strong>${prod}</strong>${todayQty ? `<div class="t-today-info">днес +${todayQty}</div>` : ""}</td>
      <td class="num ${rem === 0 && qty > 0 ? "rem-done" : ""}">${rem}</td>
      <td>${t.due ? escapeHtml(t.due) : `<span class="serie">СЕРИЯ</span>`}</td>
      ${amWorker()
        ? `<td class="t-assignee-ro">${escapeHtml(t.assignee) || "—"}</td>`
        : `<td><select class="t-assignee">${opts.join("")}</select></td>`}
      <td class="t-actions">
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
    const input = tr.querySelector(".t-today");
    const submit = () => logProduction(t, input.value);
    tr.querySelector(".t-add").addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    const edit = tr.querySelector(".t-edit"); if (edit) edit.addEventListener("click", () => editTask(t));
    const del = tr.querySelector(".t-del"); if (del) del.addEventListener("click", () => deleteTask(t));
    tbody.appendChild(tr);
  });
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

async function logProduction(t, qtyVal) {
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
  t.logs.push({ date: todayStr(), worker, qty: add });
  await tSaveTask(t);
  renderTasks();
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
  document.getElementById("task-workshop").addEventListener("change", () => { renderWorkerFilter(); renderTasks(); });
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
}
document.addEventListener("DOMContentLoaded", tInit);
