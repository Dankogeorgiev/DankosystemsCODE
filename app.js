/* Данко Системс — Следене на мостри (споделена облачна версия)
   Данните се пазят в Supabase (облак) и се споделят между всички влезли
   потребители. Чертежите се качват в Supabase Storage.
   Настройките за връзка са в config.js. */

const OPERATIONS = [
  { key: "laser",      label: "Лазерно рязане" },
  { key: "bending",    label: "Огъване" },
  { key: "welding",    label: "Заварване" },
  { key: "additional", label: "Допълнителни операции" },
  { key: "painting",   label: "Боядисване" },
  { key: "assembly",   label: "Сглобяване" },
];

const BUCKET = "drawings";

let sb = null;            // Supabase клиент
let session = null;
let appStarted = false;

let samples = [];
let currentId = null;
let saveTimer = null;
const pending = new Map(); // id -> sample (изчакват запис)

function getCurrent() { return samples.find(s => s.id === currentId); }

/* ---------- Връзка с базата ---------- */
function rowToSample(row) {
  const s = row.data || {};
  s.id = row.id;
  s.updatedAt = row.updated_at;
  // Допълване на липсващи полета (за по-стари записи).
  if (s.deadline === undefined) s.deadline = "";
  if (s.completed === undefined) s.completed = !!row.completed;
  s.order = s.order || {};
  ["status", "supplier", "date", "eta", "note"].forEach(k => { if (s.order[k] === undefined) s.order[k] = ""; });
  s.materials = s.materials || [];
  s.drawings = s.drawings || [];
  s.process = s.process || {};
  OPERATIONS.forEach(op => { if (!s.process[op.key]) s.process[op.key] = { done: false, responsible: "" }; });
  return s;
}

async function loadSamples() {
  const { data, error } = await sb.from("samples")
    .select("*").order("updated_at", { ascending: false });
  if (error) { alert("Грешка при зареждане от облака: " + error.message); return; }
  samples = (data || []).map(rowToSample);
}

async function saveSample(s) {
  const { error } = await sb.from("samples")
    .update({ data: s, completed: !!s.completed, updated_at: s.updatedAt })
    .eq("id", s.id);
  if (error) setStatus("⚠ Грешка при запис", true);
}

/* ---------- Записване при промяна (с изчакване) ---------- */
function touch(s) {
  s.updatedAt = new Date().toISOString();
  pending.set(s.id, s);
  setStatus("Запазва…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 600);
}
async function flushSaves() {
  const items = [...pending.values()];
  pending.clear();
  for (const s of items) await saveSample(s);
  setStatus("✓ Запазено в облака");
  setTimeout(() => clearStatusIf("✓ Запазено в облака"), 1500);
  renderList();
}
function setStatus(txt, isErr) {
  const el = document.getElementById("save-status");
  el.textContent = txt;
  el.style.color = isErr ? "#dc2626" : "";
}
function clearStatusIf(txt) {
  const el = document.getElementById("save-status");
  if (el.textContent === txt) el.textContent = "";
}

/* ---------- Създаване / изтриване ---------- */
function blankSample() {
  const s = {
    createdAt: new Date().toISOString(),
    clientName: "", clientInfo: "", sampleInfo: "",
    deadline: "", completed: false,
    drawings: [], materials: [],
    order: { status: "", supplier: "", date: "", eta: "", note: "" },
    process: {}, analysis: "",
  };
  OPERATIONS.forEach(op => { s.process[op.key] = { done: false, responsible: "" }; });
  return s;
}

async function newSample() {
  const draft = blankSample();
  const { data, error } = await sb.from("samples")
    .insert({ data: draft, completed: false }).select().single();
  if (error) { alert("Грешка при създаване: " + error.message); return; }
  const s = rowToSample(data);
  samples.unshift(s);
  currentId = s.id;
  renderList();
  renderForm();
}

async function deleteSample() {
  const s = getCurrent(); if (!s) return;
  if (!confirm("Сигурен ли си, че искаш да изтриеш тази мостра? Действието е за всички.")) return;
  const paths = (s.drawings || []).map(d => d.path).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  const { error } = await sb.from("samples").delete().eq("id", s.id);
  if (error) { alert("Грешка при изтриване: " + error.message); return; }
  samples = samples.filter(x => x.id !== s.id);
  currentId = null;
  renderList();
  renderForm();
}

/* ---------- Списък ---------- */
function renderList() {
  const ul = document.getElementById("sample-list");
  const term = document.getElementById("search").value.trim().toLowerCase();
  ul.innerHTML = "";

  const filtered = samples.filter(s =>
    !term || (s.clientName + " " + s.sampleInfo).toLowerCase().includes(term));

  document.getElementById("empty-list").style.display = filtered.length ? "none" : "block";

  filtered.forEach(s => {
    const li = document.createElement("li");
    if (s.id === currentId) li.classList.add("active");
    if (s.completed) li.classList.add("completed");
    const done = OPERATIONS.filter(op => s.process[op.key]?.done).length;
    const badge = s.completed ? `<span class="badge badge-done">Завършена</span>` : "";
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

  if (!s) { form.hidden = true; welcome.hidden = false; return; }
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
  setStatus("");
}

function renderDrawings(s) {
  const ul = document.getElementById("drawings-list");
  ul.innerHTML = "";
  s.drawings.forEach((f, i) => {
    const src = f.url || f.dataUrl || "";
    const li = document.createElement("li");
    const preview = f.type && f.type.startsWith("image/")
      ? `<img src="${src}" alt="${escapeHtml(f.name)}" />`
      : `<span class="pdf-icon">📄</span>`;
    li.innerHTML = `
      <a href="${src}" target="_blank" download="${escapeHtml(f.name)}">${preview}</a>
      <div class="file-name">${escapeHtml(f.name)}</div>
      <button type="button" class="remove-file" title="Премахни">×</button>`;
    li.querySelector(".remove-file").addEventListener("click", () => removeDrawing(s, i));
    ul.appendChild(li);
  });
}

async function removeDrawing(s, i) {
  const f = s.drawings[i];
  if (f && f.path) await sb.storage.from(BUCKET).remove([f.path]);
  s.drawings.splice(i, 1);
  touch(s);
  renderDrawings(s);
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

function bindSimpleField(id, apply) {
  document.getElementById(id).addEventListener("input", () => {
    const s = getCurrent(); if (!s) return;
    apply(s, document.getElementById(id).value); touch(s);
  });
}

/* ---------- Обща справка ---------- */
const ORDER_LABELS = { "": "—", "not-ordered": "Непоръчани", "ordered": "Поръчани", "received": "Получени" };

function renderReport() {
  document.getElementById("welcome").hidden = true;
  document.getElementById("sample-form").hidden = true;
  document.getElementById("report").hidden = false;
  currentId = null;
  renderList();

  const total = samples.length;
  const completed = samples.filter(s => s.completed).length;
  const inProgress = total - completed;
  const overdue = samples.filter(isOverdue).length;
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
      <td><div class="mini-bar"><span style="width:${pct}%"></span></div>
          <span class="mini-num">${done}/${OPERATIONS.length}</span></td>
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
  a.download = `danko-mostri-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let arr;
    try {
      arr = JSON.parse(reader.result);
      if (!Array.isArray(arr)) throw new Error();
    } catch {
      alert("Файлът не може да бъде прочетен. Очаква се JSON, експортиран от това приложение.");
      return;
    }
    if (!confirm(`Импорт на ${arr.length} мостри в облака? Те ще се ДОБАВЯТ към съществуващите.`)) return;
    const rows = arr.map(s => { delete s.id; return { data: s, completed: !!s.completed }; });
    const { error } = await sb.from("samples").insert(rows);
    if (error) { alert("Грешка при импорт: " + error.message); return; }
    await loadSamples();
    currentId = null;
    renderList();
    renderForm();
  };
  reader.readAsText(file);
}

/* ---------- Качване на чертежи ---------- */
async function handleDrawingFiles(files) {
  const s = getCurrent(); if (!s) return;
  for (const file of files) {
    const path = `${s.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    s.drawings.push({ name: file.name, type: file.type, path, url: data.publicUrl });
    renderDrawings(s);
    touch(s);
  }
}

/* ---------- Realtime (промени на живо) ---------- */
function subscribeRealtime() {
  sb.channel("samples-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "samples" }, payload => {
      if (payload.eventType === "DELETE") {
        const id = payload.old.id;
        samples = samples.filter(x => x.id !== id);
        if (currentId === id) { currentId = null; renderForm(); }
        renderList();
        return;
      }
      const row = payload.new;
      // Не пипаме мострата, която е отворена в момента (за да не прекъсваме писане).
      if (row.id === currentId) return;
      const incoming = rowToSample(row);
      const idx = samples.findIndex(x => x.id === row.id);
      if (idx === -1) samples.unshift(incoming); else samples[idx] = incoming;
      renderList();
    })
    .subscribe();
}

/* ---------- Помощни ---------- */
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str = "") { return escapeHtml(str); }
function firstLine(str = "") { return String(str).split("\n")[0]; }
function formatDate(iso) { try { return new Date(iso).toLocaleDateString("bg-BG"); } catch { return ""; } }
function safeName(name = "file") {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
}

/* ---------- Вход / изход ---------- */
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = document.getElementById("login-submit");
  setLoginError("");
  btn.disabled = true; btn.textContent = "Влизане…";
  let error;
  try {
    ({ error } = await sb.auth.signInWithPassword({ email, password }));
  } catch (ex) {
    error = ex;
  }
  btn.disabled = false; btn.textContent = "Вход";
  if (error) {
    const raw = error.message || String(error);
    setLoginError("⚠ " + raw);
  }
  // При успех onAuthStateChange ще стартира приложението.
}
function setLoginError(txt) { document.getElementById("login-error").textContent = txt; }
function translateAuthError(msg = "") {
  if (/invalid login credentials/i.test(msg)) return "Грешен имейл или парола.";
  if (/email not confirmed/i.test(msg)) return "Имейлът не е потвърден. Свържи се с администратора.";
  return "Грешка при вход: " + msg;
}

function showLogin() {
  document.getElementById("login").hidden = false;
  document.querySelectorAll(".app-chrome").forEach(el => el.hidden = true);
  // Временно: автоматично попълване за тест (ще го махнем, щом входът тръгне).
  document.getElementById("login-email").value = "dankog@gmail.com";
  document.getElementById("login-password").value = "danko123456";
}

async function onSignedIn(s) {
  session = s;
  appStarted = true;
  document.getElementById("login").hidden = true;
  document.getElementById("config-error").hidden = true;
  document.querySelectorAll(".app-chrome").forEach(el => el.hidden = false);
  document.getElementById("user-email").textContent = s.user?.email || "";
  await loadSamples();
  await offerLocalImport();
  subscribeRealtime();
  renderList();
  renderForm();
}

function onSignedOut() {
  appStarted = false;
  session = null;
  samples = [];
  currentId = null;
  showLogin();
}

async function offerLocalImport() {
  let local = [];
  try { local = JSON.parse(localStorage.getItem("danko_samples_v1")) || []; } catch {}
  if (local.length && samples.length === 0) {
    if (confirm(`Открити са ${local.length} мостри, запазени само на този компютър (от по-старата версия). Да ги кача ли в облака, за да са споделени?`)) {
      const rows = local.map(s => { delete s.id; return { data: s, completed: !!s.completed }; });
      const { error } = await sb.from("samples").insert(rows);
      if (error) { alert("Грешка при качване на локалните данни: " + error.message); return; }
      localStorage.removeItem("danko_samples_v1");
      await loadSamples();
    }
  }
}

/* ---------- Инициализация ---------- */
function wireHandlers() {
  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("btn-logout").addEventListener("click", () => sb.auth.signOut());

  document.getElementById("btn-new").addEventListener("click", newSample);
  document.getElementById("btn-report").addEventListener("click", renderReport);
  document.getElementById("btn-report-close").addEventListener("click", () => {
    document.getElementById("report").hidden = true; renderForm();
  });
  document.getElementById("btn-report-print").addEventListener("click", () => window.print());
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("import-file").addEventListener("change", e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("search").addEventListener("input", renderList);
  document.getElementById("btn-print").addEventListener("click", () => window.print());
  document.getElementById("btn-delete").addEventListener("click", deleteSample);

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
  document.getElementById("btn-add-material").addEventListener("click", () => {
    const s = getCurrent(); if (!s) return;
    s.materials.push({ name: "", qty: "", note: "" });
    touch(s); renderMaterials(s);
  });
  document.getElementById("drawings-file").addEventListener("change", e => {
    handleDrawingFiles([...e.target.files]);
    e.target.value = "";
  });
}

async function init() {
  wireHandlers();

  const cfg = window.DANKO_CONFIG || {};
  const notSet = v => !v || /ПОПЪЛНИ/.test(v);
  if (notSet(cfg.SUPABASE_URL) || notSet(cfg.SUPABASE_ANON_KEY)) {
    document.getElementById("config-error").hidden = false;
    return;
  }
  if (!window.supabase) {
    document.getElementById("config-error").hidden = false;
    document.querySelector("#config-error p").textContent =
      "Библиотеката Supabase не се зареди. Провери връзката с интернет и опресни страницата.";
    return;
  }

  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const { data: { session: s } } = await sb.auth.getSession();
  if (s) await onSignedIn(s); else showLogin();

  sb.auth.onAuthStateChange((_event, s2) => {
    if (s2 && !appStarted) onSignedIn(s2);
    else if (!s2 && appStarted) onSignedOut();
  });
}

document.addEventListener("DOMContentLoaded", init);
