/* Данко Системс — Следене на мостри
   Всичко се пази локално в браузъра (localStorage).
   Без сървър, без външни библиотеки. */

const STORAGE_KEY = "danko_samples_v1";

// Операциите от производствения процес (точка 7) в искания ред.
const OPERATIONS = [
  { key: "laser",      label: "Лазерно рязане" },
  { key: "bending",    label: "Огъване" },
  { key: "welding",    label: "Заварване" },
  { key: "additional", label: "Допълнителни операции" },
  { key: "painting",   label: "Боядисване" },
  { key: "assembly",   label: "Сглобяване" },
];

let samples = [];
let currentId = null;
let saveTimer = null;

/* ---------- Съхранение ---------- */
function load() {
  try {
    samples = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    samples = [];
  }
  // Допълване на липсващи полета за по-стари записи.
  samples.forEach(s => {
    if (s.deadline === undefined) s.deadline = "";
    if (s.completed === undefined) s.completed = false;
    s.order = s.order || {};
    if (s.order.date === undefined) s.order.date = "";
    if (s.order.eta === undefined) s.order.eta = "";
  });
}
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
  } catch (e) {
    alert("Грешка при запис. Възможно е паметта на браузъра да е препълнена (твърде големи чертежи). Опитай да премахнеш някои файлове.");
  }
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function getCurrent() {
  return samples.find(s => s.id === currentId);
}

/* ---------- Създаване на нова мостра ---------- */
function newSample() {
  const s = {
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clientName: "",
    clientInfo: "",
    sampleInfo: "",
    deadline: "",          // краен срок на мострата (YYYY-MM-DD)
    completed: false,      // статус „Завършена“
    drawings: [],          // {name, type, dataUrl}
    materials: [],         // {name, qty, note}
    order: { status: "", supplier: "", date: "", eta: "", note: "" },
    process: {},           // key -> {done, responsible}
    analysis: "",
  };
  OPERATIONS.forEach(op => { s.process[op.key] = { done: false, responsible: "" }; });
  samples.unshift(s);
  persist();
  currentId = s.id;
  renderList();
  renderForm();
}

/* ---------- Списък ---------- */
function renderList() {
  const ul = document.getElementById("sample-list");
  const term = document.getElementById("search").value.trim().toLowerCase();
  ul.innerHTML = "";

  const filtered = samples.filter(s => {
    if (!term) return true;
    return (s.clientName + " " + s.sampleInfo).toLowerCase().includes(term);
  });

  document.getElementById("empty-list").style.display = filtered.length ? "none" : "block";

  filtered.forEach(s => {
    const li = document.createElement("li");
    if (s.id === currentId) li.classList.add("active");
    if (s.completed) li.classList.add("completed");
    const done = OPERATIONS.filter(op => s.process[op.key]?.done).length;
    const badge = s.completed
      ? `<span class="badge badge-done">Завършена</span>`
      : "";
    const dl = s.deadline ? ` · ⏱ ${formatDate(s.deadline)}` : "";
    li.innerHTML = `
      <div class="s-name">${escapeHtml(s.clientName) || "(без име на клиент)"} ${badge}</div>
      <div class="s-sub">${escapeHtml(firstLine(s.sampleInfo)) || "Без описание на мострата"}</div>
      <div class="s-progress">${done}/${OPERATIONS.length} операции${dl}</div>`;
    li.addEventListener("click", () => { currentId = s.id; renderList(); renderForm(); });
    ul.appendChild(li);
  });
}

/* ---------- Форма ---------- */
function renderForm() {
  const form = document.getElementById("sample-form");
  const welcome = document.getElementById("welcome");
  document.getElementById("report").hidden = true;
  const s = getCurrent();

  if (!s) {
    form.hidden = true;
    welcome.hidden = false;
    return;
  }
  welcome.hidden = true;
  form.hidden = false;

  document.getElementById("clientName").value = s.clientName;
  document.getElementById("clientInfo").value = s.clientInfo;
  document.getElementById("sampleInfo").value = s.sampleInfo;
  document.getElementById("deadline").value = s.deadline || "";
  document.getElementById("completed").checked = !!s.completed;
  document.getElementById("orderStatus").value = s.order.status;
  document.getElementById("orderSupplier").value = s.order.supplier;
  document.getElementById("orderDate").value = s.order.date || "";
  document.getElementById("orderEta").value = s.order.eta || "";
  document.getElementById("orderNote").value = s.order.note;
  document.getElementById("analysis").value = s.analysis;

  renderDrawings(s);
  renderMaterials(s);
  renderProcess(s);
  updateProgress(s);
  document.getElementById("save-status").textContent = "";
}

function renderDrawings(s) {
  const ul = document.getElementById("drawings-list");
  ul.innerHTML = "";
  s.drawings.forEach((f, i) => {
    const li = document.createElement("li");
    const preview = f.type && f.type.startsWith("image/")
      ? `<img src="${f.dataUrl}" alt="${escapeHtml(f.name)}" />`
      : `<span class="pdf-icon">📄</span>`;
    li.innerHTML = `
      <a href="${f.dataUrl}" target="_blank" download="${escapeHtml(f.name)}">${preview}</a>
      <div class="file-name">${escapeHtml(f.name)}</div>
      <button type="button" class="remove-file" title="Премахни">×</button>`;
    li.querySelector(".remove-file").addEventListener("click", () => {
      s.drawings.splice(i, 1);
      touch(s); renderDrawings(s);
    });
    ul.appendChild(li);
  });
}

function renderMaterials(s) {
  const tbody = document.getElementById("materials-body");
  tbody.innerHTML = "";
  s.materials.forEach((m, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" value="${escapeAttr(m.name)}" placeholder="Материал" /></td>
      <td><input type="text" value="${escapeAttr(m.qty)}" placeholder="бр. / кг / м" /></td>
      <td><input type="text" value="${escapeAttr(m.note)}" placeholder="Забележка" /></td>
      <td><button type="button" class="remove-row" title="Изтрий реда">×</button></td>`;
    const [n, q, note] = tr.querySelectorAll("input");
    n.addEventListener("input", () => { m.name = n.value; touch(s); });
    q.addEventListener("input", () => { m.qty = q.value; touch(s); });
    note.addEventListener("input", () => { m.note = note.value; touch(s); });
    tr.querySelector(".remove-row").addEventListener("click", () => {
      s.materials.splice(i, 1); touch(s); renderMaterials(s);
    });
    tbody.appendChild(tr);
  });
}

function renderProcess(s) {
  const wrap = document.getElementById("process-list");
  wrap.innerHTML = "";
  OPERATIONS.forEach(op => {
    const st = s.process[op.key];
    const div = document.createElement("div");
    div.className = "process-item" + (st.done ? " done" : "");
    div.innerHTML = `
      <input type="checkbox" ${st.done ? "checked" : ""} />
      <span class="op-name">${op.label}</span>
      <span class="resp"><span>Отговорник:</span>
        <input type="text" value="${escapeAttr(st.responsible)}" placeholder="Име" /></span>`;
    const checkbox = div.querySelector('input[type="checkbox"]');
    const respInput = div.querySelector('.resp input');
    checkbox.addEventListener("change", () => {
      st.done = checkbox.checked;
      div.classList.toggle("done", st.done);
      touch(s); updateProgress(s); renderList();
    });
    respInput.addEventListener("input", () => { st.responsible = respInput.value; touch(s); });
    wrap.appendChild(div);
  });
}

function updateProgress(s) {
  const done = OPERATIONS.filter(op => s.process[op.key]?.done).length;
  const pct = Math.round((done / OPERATIONS.length) * 100);
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-text").textContent = `${done} / ${OPERATIONS.length} операции`;
}

/* ---------- Записване при промяна ---------- */
function touch(s) {
  s.updatedAt = new Date().toISOString();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persist();
    const st = document.getElementById("save-status");
    st.textContent = "✓ Запазено";
    setTimeout(() => { if (st.textContent === "✓ Запазено") st.textContent = ""; }, 1500);
    renderList();
  }, 300);
}

function bindSimpleField(id, apply) {
  document.getElementById(id).addEventListener("input", () => {
    const s = getCurrent(); if (!s) return;
    apply(s, document.getElementById(id).value); touch(s);
  });
}

/* ---------- Обща справка ---------- */
const ORDER_LABELS = {
  "": "—",
  "not-ordered": "Непоръчани",
  "ordered": "Поръчани",
  "received": "Получени",
};

function renderReport() {
  document.getElementById("welcome").hidden = true;
  document.getElementById("sample-form").hidden = true;
  document.getElementById("report").hidden = false;
  currentId = null;
  renderList();

  const total = samples.length;
  const completed = samples.filter(s => s.completed).length;
  const inProgress = total - completed;
  const overdue = samples.filter(s => isOverdue(s)).length;
  document.getElementById("report-summary").innerHTML = `
    <div class="stat"><span class="stat-num">${total}</span> мостри общо</div>
    <div class="stat"><span class="stat-num">${inProgress}</span> в процес</div>
    <div class="stat"><span class="stat-num">${completed}</span> завършени</div>
    <div class="stat ${overdue ? "stat-warn" : ""}"><span class="stat-num">${overdue}</span> просрочени</div>`;

  const body = document.getElementById("report-body");
  body.innerHTML = "";
  if (!total) {
    body.innerHTML = `<tr><td colspan="6" class="report-empty">Няма въведени мостри.</td></tr>`;
    return;
  }
  samples.forEach(s => {
    const done = OPERATIONS.filter(op => s.process[op.key]?.done).length;
    const pct = Math.round((done / OPERATIONS.length) * 100);
    const overdueCls = isOverdue(s) ? "cell-overdue" : "";
    const statusBadge = s.completed
      ? `<span class="badge badge-done">Завършена</span>`
      : `<span class="badge badge-progress">В процес</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.clientName) || "—"}</td>
      <td>${escapeHtml(firstLine(s.sampleInfo)) || "—"}</td>
      <td class="${overdueCls}">${s.deadline ? formatDate(s.deadline) : "—"}</td>
      <td>${ORDER_LABELS[s.order.status] ?? "—"}</td>
      <td>
        <div class="mini-bar"><span style="width:${pct}%"></span></div>
        <span class="mini-num">${done}/${OPERATIONS.length}</span>
      </td>
      <td>${statusBadge}</td>`;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => { currentId = s.id; renderList(); renderForm(); });
    body.appendChild(tr);
  });
}

function isOverdue(s) {
  if (s.completed || !s.deadline) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(s.deadline) < today;
}

/* ---------- Експорт / Импорт ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(samples, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `danko-mostri-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("невалиден формат");
      if (!confirm(`Импорт на ${data.length} мостри? Това ще ЗАМЕНИ текущите данни.`)) return;
      samples = data;
      persist();
      currentId = null;
      renderList();
      renderForm();
    } catch {
      alert("Файлът не може да бъде прочетен. Очаква се JSON, експортиран от това приложение.");
    }
  };
  reader.readAsText(file);
}

/* ---------- Помощни ---------- */
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str = "") { return escapeHtml(str); }
function firstLine(str = "") { return String(str).split("\n")[0]; }
function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString("bg-BG"); } catch { return ""; }
}

/* ---------- Инициализация ---------- */
function init() {
  load();
  renderList();
  renderForm();

  document.getElementById("btn-new").addEventListener("click", newSample);
  document.getElementById("btn-report").addEventListener("click", renderReport);
  document.getElementById("btn-report-close").addEventListener("click", () => {
    document.getElementById("report").hidden = true;
    renderForm();
  });
  document.getElementById("btn-report-print").addEventListener("click", () => window.print());
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("import-file").addEventListener("change", e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("search").addEventListener("input", renderList);
  document.getElementById("btn-print").addEventListener("click", () => window.print());

  document.getElementById("btn-delete").addEventListener("click", () => {
    const s = getCurrent(); if (!s) return;
    if (!confirm("Сигурен ли си, че искаш да изтриеш тази мостра?")) return;
    samples = samples.filter(x => x.id !== s.id);
    persist();
    currentId = null;
    renderList();
    renderForm();
  });

  // Прости полета
  bindSimpleField("clientName", (s, v) => s.clientName = v);
  bindSimpleField("clientInfo", (s, v) => s.clientInfo = v);
  bindSimpleField("sampleInfo", (s, v) => s.sampleInfo = v);
  bindSimpleField("deadline", (s, v) => s.deadline = v);
  bindSimpleField("orderSupplier", (s, v) => s.order.supplier = v);
  bindSimpleField("orderDate", (s, v) => s.order.date = v);
  bindSimpleField("orderEta", (s, v) => s.order.eta = v);
  bindSimpleField("orderNote", (s, v) => s.order.note = v);
  bindSimpleField("analysis", (s, v) => s.analysis = v);
  document.getElementById("orderStatus").addEventListener("change", () => {
    const s = getCurrent(); if (s) { s.order.status = document.getElementById("orderStatus").value; touch(s); }
  });
  document.getElementById("completed").addEventListener("change", () => {
    const s = getCurrent(); if (!s) return;
    s.completed = document.getElementById("completed").checked;
    touch(s); renderList();
  });

  // Материали
  document.getElementById("btn-add-material").addEventListener("click", () => {
    const s = getCurrent(); if (!s) return;
    s.materials.push({ name: "", qty: "", note: "" });
    touch(s); renderMaterials(s);
  });

  // Чертежи
  document.getElementById("drawings-file").addEventListener("change", e => {
    const s = getCurrent(); if (!s) return;
    [...e.target.files].forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        s.drawings.push({ name: file.name, type: file.type, dataUrl: reader.result });
        touch(s); renderDrawings(s);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  });
}

document.addEventListener("DOMContentLoaded", init);
