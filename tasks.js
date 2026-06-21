/* Данко Системс — Модул „Цехове / Производствени задачи“
   Използва глобалния Supabase клиент (sb) и помощните функции от app.js.
   Данните се пазят в таблица `tasks`, работниците — в `app_config`. */

const TASK_DEFAULT_WORKSHOPS = ["Лазер", "Заварки", "Занитване", "Абкант", "Боядисване", "Сглобяване"];
let TASKS = [];
let WORKERS = {};            // { "Лазер": ["Иван", ...], ... }
let tasksLoaded = false;
let tasksSubscribed = false;

/* ---------- Зареждане / запис ---------- */
async function tLoadWorkers() {
  const { data, error } = await sb.from("app_config").select("*").eq("id", "workers").maybeSingle();
  WORKERS = (!error && data && data.data && data.data.workshops) ? data.data.workshops : {};
  TASK_DEFAULT_WORKSHOPS.forEach(w => { if (!WORKERS[w]) WORKERS[w] = []; });
}
async function tSaveWorkers() {
  const { error } = await sb.from("app_config")
    .upsert({ id: "workers", data: { workshops: WORKERS }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на работниците: " + error.message);
}
async function tLoadTasks() {
  const { data, error } = await sb.from("tasks").select("*").order("updated_at", { ascending: false });
  if (error) { alert("Грешка при зареждане на задачите: " + error.message); return; }
  TASKS = (data || []).map(r => ({ ...r.data, id: r.id }));
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
  if (!tasksLoaded) { await tLoadWorkers(); await tLoadTasks(); tasksLoaded = true; subscribeTasks(); }
  renderWorkshopSelect();
  renderWorkerFilter();
  renderTasks();
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
  sel.innerHTML = `<option value="">Всички работници</option>` +
    names.map(n => `<option>${escapeHtml(n)}</option>`).join("");
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : "";
}

/* ---------- Лента с работници (икони) ---------- */
function renderWorkerBar() {
  const bar = document.getElementById("worker-bar");
  if (!bar) return;
  const ws = currentWorkshop();
  const names = ws === "__all" ? [...new Set(Object.values(WORKERS).flat())] : (WORKERS[ws] || []);
  const active = document.getElementById("task-worker-filter").value;
  if (!names.length) { bar.innerHTML = `<span class="wbar-hint">Добави работници от бутона „👤 Работници“</span>`; return; }
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
  renderWorkerBar();
  const tbody = document.getElementById("tasks-body");
  const ws = currentWorkshop();
  const worker = document.getElementById("task-worker-filter").value;
  const term = (document.getElementById("task-search").value || "").trim().toLowerCase();
  tbody.innerHTML = "";

  const rows = TASKS.filter(t => {
    if (ws !== "__all" && t.workshop !== ws) return false;
    if (worker && t.assignee !== worker) return false;
    if (term && !(`${t.client} ${t.product} ${t.code} ${t.operation}`.toLowerCase().includes(term))) return false;
    return true;
  });

  document.getElementById("tasks-empty").hidden = rows.length > 0;

  // Дневно обобщение, когато е избран конкретен работник
  const daily = document.getElementById("tasks-daily");
  if (worker) {
    const today = todayStr();
    let total = 0, cnt = 0;
    rows.forEach(t => (t.logs || []).forEach(l => {
      if (l.date === today && l.worker === worker) { total += Number(l.qty) || 0; cnt++; }
    }));
    daily.hidden = false;
    daily.innerHTML = `👷 <strong>${escapeHtml(worker)}</strong> — днес произведено: <strong>${total}</strong> бр. (${cnt} вписвания)`;
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
      <td>${escapeHtml(t.client) || "—"}</td>
      <td>${escapeHtml(t.product) || "—"}<div class="t-code">${escapeHtml(t.code || "")}</div></td>
      <td>${escapeHtml(t.operation) || (ws === "__all" ? escapeHtml(t.workshop) : "—")}</td>
      <td class="num">${qty || "—"}</td>
      <td class="num"><strong>${prod}</strong>${todayQty ? `<div class="t-today-info">днес +${todayQty}</div>` : ""}</td>
      <td class="num ${rem === 0 && qty > 0 ? "rem-done" : ""}">${rem}</td>
      <td>${escapeHtml(t.due) || "—"}</td>
      <td><select class="t-assignee">${opts.join("")}</select></td>
      <td class="t-actions">
        <input type="number" class="t-today" min="0" placeholder="днес" />
        <button type="button" class="btn btn-small btn-primary t-add">Запиши</button>
        <button type="button" class="btn btn-small t-edit" title="Редакция">✎</button>
        <button type="button" class="remove-row t-del" title="Изтрий">×</button>
      </td>`;
    tr.querySelector(".t-assignee").addEventListener("change", e => { t.assignee = e.target.value; tSaveTask(t); });
    const input = tr.querySelector(".t-today");
    const submit = () => logProduction(t, input.value);
    tr.querySelector(".t-add").addEventListener("click", submit);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    tr.querySelector(".t-edit").addEventListener("click", () => editTask(t));
    tr.querySelector(".t-del").addEventListener("click", () => deleteTask(t));
    tbody.appendChild(tr);
  });
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

async function logProduction(t, qtyVal) {
  const add = Number(String(qtyVal == null ? "" : qtyVal).replace(",", "."));
  if (!add || add <= 0) { alert("Въведи брой в полето „днес“."); return; }
  let worker = t.assignee || document.getElementById("task-worker-filter").value;
  if (!worker) worker = prompt("Кой работник?", "") || "";
  t.produced = (Number(t.produced) || 0) + add;
  t.logs = t.logs || [];
  t.logs.push({ date: todayStr(), worker, qty: add });
  await tSaveTask(t);
  renderTasks();
}

async function editTask(t) {
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
  if (!confirm("Изтриване на задачата?")) return;
  const { error } = await sb.from("tasks").delete().eq("id", t.id);
  if (error) { alert("Грешка: " + error.message); return; }
  TASKS = TASKS.filter(x => x.id !== t.id);
  renderTasks();
}

async function addTaskManual() {
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
  if (typeof XLSX === "undefined") { alert("Библиотеката за Excel не се зареди. Опресни и опитай пак."); return; }
  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: "array" });
  } catch (e) { alert("Не може да се прочете файлът: " + e.message); return; }

  const newTasks = [];
  wb.SheetNames.forEach(sheetName => {
    const ws = sheetName.charAt(0).toUpperCase() + sheetName.slice(1);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    rows.slice(1).forEach(r => {
      const client = (r[0] || "").toString().trim();
      const product = (r[1] || "").toString().trim();
      const code = (r[2] || "").toString().trim();
      const operation = (r[5] || "").toString().trim();
      const qty = r[6] === "" ? "" : Number(r[6]) || 0;
      const produced = r[7] === "" ? 0 : Number(r[7]) || 0;
      const due = (r[9] || "").toString().trim();
      if (!product && !client && !qty) return; // празен ред
      newTasks.push({
        workshop: ws, client, product, code, operation,
        qty, produced, due, assignee: "", logs: [], createdAt: new Date().toISOString(),
      });
    });
    if (!WORKERS[ws]) WORKERS[ws] = [];
  });

  if (!newTasks.length) { alert("Във файла няма редове за импорт."); return; }

  const replace = confirm(
    `Намерени са ${newTasks.length} задачи в ${wb.SheetNames.length} цеха.\n\n` +
    `OK = ИЗТРИЙ старите задачи и зареди новите (препоръчано при нов експорт)\n` +
    `Cancel = ДОБАВИ новите към съществуващите`);

  if (replace) {
    const { error: delErr } = await sb.from("tasks").delete().gte("created_at", "1900-01-01");
    if (delErr) { alert("Грешка при изчистване: " + delErr.message); return; }
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

/* ---------- Работници ---------- */
function toggleWorkers() {
  const v = document.getElementById("workers-view");
  if (!v.hidden) { showSub("tasks"); renderTasks(); return; }
  renderWorkers();
}
function renderWorkers() {
  showSub("workers");
  const v = document.getElementById("workers-view");
  v.innerHTML = `<div class="workers-head"><h3>Работници по цехове</h3>
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
    box.innerHTML = `<h4>${escapeHtml(ws)}</h4>
      <div class="worker-chips">${names.map((n, i) =>
        `<span class="chip">${escapeHtml(n)} <button data-i="${i}" class="chip-x">×</button></span>`).join("") || "<em>няма</em>"}</div>
      <div class="worker-add"><input type="text" placeholder="Име на работник" /><button class="btn btn-small">+ Добави</button></div>`;
    box.querySelectorAll(".chip-x").forEach(btn => btn.addEventListener("click", async () => {
      WORKERS[ws].splice(Number(btn.dataset.i), 1); await tSaveWorkers(); renderWorkers();
    }));
    const inp = box.querySelector(".worker-add input");
    const addFn = async () => {
      const n = inp.value.trim(); if (!n) return;
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
    <h4>По работник</h4>
    <table class="report-table"><thead><tr><th>Работник</th><th>Цех</th><th class="num">Произведено</th></tr></thead>
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
  document.getElementById("task-workshop").addEventListener("change", () => { renderWorkerFilter(); renderTasks(); });
  document.getElementById("task-worker-filter").addEventListener("change", renderTasks);
  document.getElementById("task-search").addEventListener("input", renderTasks);
  document.getElementById("btn-add-task").addEventListener("click", addTaskManual);
  document.getElementById("erp-file").addEventListener("change", e => {
    if (e.target.files[0]) importERP(e.target.files[0]); e.target.value = "";
  });
  document.getElementById("btn-workers").addEventListener("click", toggleWorkers);
  document.getElementById("btn-task-report").addEventListener("click", toggleReport);
}
document.addEventListener("DOMContentLoaded", tInit);
