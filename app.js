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

// Категории материали за нестандартни поръчки (фиксирани редове).
const ORDER_MATERIAL_CATEGORIES = ["Профили", "Ламарини", "Крепежи", "Цвят по RAL", "Други покупни"];

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
  if (s.type === undefined) s.type = "sample";
  if (s.type === "claim") { ensureClaimDefaults(s); return s; }
  if (s.deadline === undefined) s.deadline = "";
  if (s.completed === undefined) s.completed = !!row.completed;
  if (s.packaging === undefined) s.packaging = "";
  if (s.shippingMethod === undefined) s.shippingMethod = "";
  if (s.shippingAddress === undefined) s.shippingAddress = "";
  s.materials = s.materials || [];
  s.materials.forEach(m => {
    if (m.status === undefined) m.status = "not-ordered";
    if (m.note === undefined) m.note = "";
  });
  s.drawings = s.drawings || [];
  s.analysisFiles = s.analysisFiles || [];
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
  ["save-status", "claim-save-status"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = txt; el.style.color = isErr ? "#dc2626" : ""; }
  });
}
function clearStatusIf(txt) {
  ["save-status", "claim-save-status"].forEach(id => {
    const el = document.getElementById(id);
    if (el && el.textContent === txt) el.textContent = "";
  });
}

/* ---------- Създаване / изтриване ---------- */
function blankSample(type = "sample") {
  const s = {
    type,                  // "sample" (мостра) или "order" (нестандартна поръчка)
    createdAt: new Date().toISOString(),
    clientName: "", clientInfo: "", sampleInfo: "",
    deadline: "", completed: false,
    drawings: [], materials: [],
    analysisFiles: [],
    packaging: "", shippingMethod: "", shippingAddress: "",
    process: {}, analysis: "",
  };
  OPERATIONS.forEach(op => { s.process[op.key] = { done: false, responsible: "" }; });
  return s;
}

async function newSample(type = "sample") {
  const draft = blankSample(type);
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
  const paths = [...(s.drawings || []), ...(s.analysisFiles || [])]
    .map(d => d.path).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  const { error } = await sb.from("samples").delete().eq("id", s.id);
  if (error) { alert("Грешка при изтриване: " + error.message); return; }
  samples = samples.filter(x => x.id !== s.id);
  currentId = null;
  renderList();
  renderForm();
}

/* ---------- Списък ---------- */
function searchText(s) {
  if (s.type === "claim") {
    const items = (s.items || []).map(it => `${it.name} ${it.description}`).join(" ");
    return `${s.client?.company || ""} ${s.regNo || ""} ${items}`.toLowerCase();
  }
  return (s.clientName + " " + s.sampleInfo).toLowerCase();
}

function renderList() {
  const ul = document.getElementById("sample-list");
  const term = document.getElementById("search").value.trim().toLowerCase();
  ul.innerHTML = "";

  const tf = document.getElementById("type-filter").value;
  const filtered = samples.filter(s => {
    if (tf !== "all" && (s.type || "sample") !== tf) return false;
    return !term || searchText(s).includes(term);
  });

  document.getElementById("empty-list").style.display = filtered.length ? "none" : "block";

  filtered.forEach(s => {
    const li = document.createElement("li");
    if (s.id === currentId) li.classList.add("active");
    if (s.completed) li.classList.add("completed");
    if (s.type === "claim") {
      const badge = s.completed ? `<span class="badge badge-done">Приключена</span>` : "";
      const subj = (s.items || []).map(it => it.description || it.name).filter(Boolean)[0] || "Без описание";
      const dl = s.deadline ? ` · ⏱ ${formatDate(s.deadline)}` : "";
      li.innerHTML = `
        <div class="s-type"><span class="badge badge-claim">Рекламация №${escapeHtml(String(s.regNo || "—"))}</span> ${badge}</div>
        <div class="s-name">${escapeHtml(s.client?.company) || "(без клиент)"}</div>
        <div class="s-sub">${escapeHtml(firstLine(subj))}</div>
        <div class="s-progress">${s.date ? formatDate(s.date) : ""}${dl}</div>`;
    } else {
      const done = OPERATIONS.filter(op => s.process[op.key]?.done).length;
      const badge = s.completed ? `<span class="badge badge-done">Завършена</span>` : "";
      const dl = s.deadline ? ` · ⏱ ${formatDate(s.deadline)}` : "";
      li.innerHTML = `
        <div class="s-type">${typeBadge(s)}</div>
        <div class="s-name">${escapeHtml(s.clientName) || "(без име на клиент)"} ${badge}</div>
        <div class="s-sub">${escapeHtml(firstLine(s.sampleInfo)) || "Без описание"}</div>
        <div class="s-progress">${done}/${OPERATIONS.length} операции${dl}</div>`;
    }
    li.addEventListener("click", () => { currentId = s.id; renderList(); renderForm(); });
    ul.appendChild(li);
  });
}

/* ---------- Форма ---------- */
function renderForm() {
  const sForm = document.getElementById("sample-form");
  const cForm = document.getElementById("claim-form");
  const welcome = document.getElementById("welcome");
  document.getElementById("report").hidden = true;
  document.getElementById("claim-report").hidden = true;
  const s = getCurrent();

  if (!s) { sForm.hidden = true; cForm.hidden = true; welcome.hidden = false; return; }
  welcome.hidden = true;
  if (s.type === "claim") { sForm.hidden = true; renderClaimForm(s); return; }
  cForm.hidden = true;
  renderSampleForm(s);
}

function renderSampleForm(s) {
  const form = document.getElementById("sample-form");
  form.hidden = false;

  document.getElementById("section3-label").textContent =
    s.type === "order" ? "Информация за поръчката" : "Информация за мострата";
  document.getElementById("clientName").value = s.clientName;
  document.getElementById("clientInfo").value = s.clientInfo;
  document.getElementById("sampleInfo").value = s.sampleInfo;
  document.getElementById("deadline").value = s.deadline || "";
  document.getElementById("completed").checked = !!s.completed;
  document.getElementById("packaging").value = s.packaging || "";
  document.getElementById("shippingMethod").value = s.shippingMethod || "";
  document.getElementById("shippingAddress").value = s.shippingAddress || "";
  document.getElementById("analysis").value = s.analysis;

  renderDrawings(s);
  renderMaterials(s);
  renderProcess(s);
  renderAnalysisFiles(s);
  updateProgress(s);
  setStatus("");
}

function drawingsListId(s) {
  return s.type === "claim" ? "claim-drawings-list" : "drawings-list";
}

function renderDrawings(s) {
  const ul = document.getElementById(drawingsListId(s));
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

/* Файлове с коментар (точка 9 — Анализ и коментари) */
function renderAnalysisFiles(s) {
  const wrap = document.getElementById("analysis-files");
  wrap.innerHTML = "";
  (s.analysisFiles || []).forEach((f, i) => {
    const src = f.url || f.dataUrl || "";
    const item = document.createElement("div");
    item.className = "afile";
    const preview = f.type && f.type.startsWith("image/")
      ? `<img src="${src}" alt="${escapeHtml(f.name)}" />`
      : `<span class="pdf-icon">📄</span>`;
    item.innerHTML = `
      <a class="afile-prev" href="${src}" target="_blank">${preview}</a>
      <div class="afile-main">
        <div class="afile-name"><a href="${src}" target="_blank" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a></div>
        <textarea class="afile-comment" rows="2" placeholder="Коментар към файла...">${escapeHtml(f.comment || "")}</textarea>
      </div>
      <button type="button" class="remove-file afile-x" title="Премахни">×</button>`;
    item.querySelector(".afile-comment").addEventListener("input", e => { f.comment = e.target.value; touch(s); });
    item.querySelector(".afile-x").addEventListener("click", () => removeAnalysisFile(s, i));
    wrap.appendChild(item);
  });
}

async function handleAnalysisFiles(files) {
  const s = getCurrent(); if (!s) return;
  s.analysisFiles = s.analysisFiles || [];
  for (const file of files) {
    const path = `${s.id}/analysis-${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    s.analysisFiles.push({ name: file.name, type: file.type, path, url: data.publicUrl, comment: "" });
    renderAnalysisFiles(s);
    touch(s);
  }
}

async function removeAnalysisFile(s, i) {
  const f = s.analysisFiles[i];
  if (f && f.path) await sb.storage.from(BUCKET).remove([f.path]);
  s.analysisFiles.splice(i, 1);
  touch(s);
  renderAnalysisFiles(s);
}

// Прехвърля по-стари поръчки към новия модел (категория + отделни редове).
function migrateOrderMaterials(s) {
  (s.materials || []).forEach(m => {
    if (!m.category) {
      if (ORDER_MATERIAL_CATEGORIES.includes(m.name)) { m.category = m.name; m.name = ""; }
      else { m.category = "Други покупни"; }
    }
  });
}

// Създава един ред с полета (материал, количество, статус, забележка, изтриване).
function buildMaterialRow(s, m, i) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="mat-name" value="${escapeAttr(m.name)}" placeholder="Материал" /></td>
    <td><input type="text" class="mat-qty" value="${escapeAttr(m.qty)}" placeholder="бр. / кг / м" /></td>
    <td><select class="mat-status ${m.status === "ordered" ? "is-ordered" : "is-not"}">
      <option value="not-ordered"${m.status === "ordered" ? "" : " selected"}>Непоръчан</option>
      <option value="ordered"${m.status === "ordered" ? " selected" : ""}>Поръчан</option>
    </select></td>
    <td><input type="text" class="mat-note" value="${escapeAttr(m.note)}" placeholder="Доставчик, кога ще дойде..." /></td>
    <td><button type="button" class="remove-row" title="Изтрий реда">×</button></td>`;
  const name = tr.querySelector(".mat-name");
  const q = tr.querySelector(".mat-qty");
  const note = tr.querySelector(".mat-note");
  const statusSel = tr.querySelector(".mat-status");
  name.addEventListener("input", () => { m.name = name.value; touch(s); });
  q.addEventListener("input", () => { m.qty = q.value; touch(s); });
  note.addEventListener("input", () => { m.note = note.value; touch(s); });
  statusSel.addEventListener("change", () => {
    m.status = statusSel.value;
    statusSel.classList.toggle("is-ordered", m.status === "ordered");
    statusSel.classList.toggle("is-not", m.status !== "ordered");
    touch(s);
  });
  tr.querySelector(".remove-row").addEventListener("click", () => {
    s.materials.splice(i, 1); touch(s); renderMaterials(s);
  });
  return tr;
}

function renderMaterials(s) {
  const tbody = document.getElementById("materials-body");
  const addBtn = document.getElementById("btn-add-material");
  tbody.innerHTML = "";
  addBtn.style.display = "none";
  migrateOrderMaterials(s);
  ORDER_MATERIAL_CATEGORIES.forEach(cat => {
    const header = document.createElement("tr");
    header.className = "mat-cat-header";
    header.innerHTML = `<td colspan="5">${escapeHtml(cat)}</td>`;
    tbody.appendChild(header);

    s.materials.forEach((m, i) => {
      if (m.category === cat) tbody.appendChild(buildMaterialRow(s, m, i));
    });

    const addRow = document.createElement("tr");
    addRow.className = "mat-add-row";
    addRow.innerHTML = `<td colspan="5"><button type="button" class="btn btn-small mat-add">+ Добави</button></td>`;
    addRow.querySelector(".mat-add").addEventListener("click", () => {
      s.materials.push({ category: cat, name: "", qty: "", status: "not-ordered", note: "" });
      touch(s); renderMaterials(s);
    });
    tbody.appendChild(addRow);
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
function typeBadge(s) {
  return s.type === "order"
    ? `<span class="badge badge-order">Поръчка</span>`
    : `<span class="badge badge-sample">Мостра</span>`;
}
function materialsSummary(s) {
  const mats = s.materials || [];
  if (!mats.length) return "—";
  const ordered = mats.filter(m => m.status === "ordered").length;
  return `${ordered}/${mats.length} поръчани`;
}

function renderReport() {
  document.getElementById("welcome").hidden = true;
  document.getElementById("sample-form").hidden = true;
  document.getElementById("claim-form").hidden = true;
  document.getElementById("claim-report").hidden = true;
  document.getElementById("report").hidden = false;
  currentId = null;
  renderList();

  const prod = samples.filter(s => s.type !== "claim");
  const total = prod.length;
  const completed = prod.filter(s => s.completed).length;
  const inProgress = total - completed;
  const overdue = prod.filter(isOverdue).length;
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
  prod.forEach(s => {
    const done = OPERATIONS.filter(op => s.process[op.key]?.done).length;
    const pct = Math.round((done / OPERATIONS.length) * 100);
    const overdueCls = isOverdue(s) ? "cell-overdue" : "";
    const statusBadge = s.completed
      ? `<span class="badge badge-done">Завършена</span>`
      : `<span class="badge badge-progress">В процес</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${typeBadge(s)} ${escapeHtml(s.clientName) || "—"}</td>
      <td>${escapeHtml(firstLine(s.sampleInfo)) || "—"}</td>
      <td class="${overdueCls}">${s.deadline ? formatDate(s.deadline) : "—"}</td>
      <td>${materialsSummary(s)}</td>
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

/* ===================== РЕКЛАМАЦИИ ===================== */
const CLAIM_DEMANDS = {
  acceptWithReserve: "приема с резерви", returned: "отказан и върнат",
  personal: "персонално решение", rework: "преработка от производителя",
  refund: "възстановяване на сума", other: "друго",
};

function getByPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setByPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let o = obj;
  keys.forEach(k => { if (typeof o[k] !== "object" || o[k] === null) o[k] = {}; o = o[k]; });
  o[last] = value;
}

function blankClaim(regNo) {
  return {
    type: "claim",
    createdAt: new Date().toISOString(),
    regNo,
    date: "", deadline: "", completedDate: "",
    client: { company: "", person: "", contacts: "", ref: "" },
    orderNo: "", totalQty: "", drawingNo: "", loadingDate: "",
    acceptedBy: "",
    items: [],
    drawings: [],
    claimsClient: { acceptWithReserve: false, returned: false, personal: false, rework: false, refund: false, other: false },
    otherText: "", clientComment: "",
    problem: { what: "", why: "", where: "", when: "", who: "", how: "", extra: "" },
    rootCause: "",
    causes: { man: false, machine: false, material: false, method: false, external: false, transport: false },
    actions: [
      { person: "Стефан", action: "", date: "" },
      { person: "Деян", action: "", date: "" },
      { person: "Таня", action: "", date: "" },
      { person: "Данко", action: "", date: "" },
    ],
    resolution: "", value: "", completed: false,
  };
}

function ensureClaimDefaults(s) {
  const d = blankClaim(s.regNo || 0);
  // плитко сливане на липсващи ключове
  for (const k in d) if (s[k] === undefined) s[k] = d[k];
  s.client = Object.assign({}, d.client, s.client);
  s.claimsClient = Object.assign({}, d.claimsClient, s.claimsClient);
  s.problem = Object.assign({}, d.problem, s.problem);
  s.causes = Object.assign({}, d.causes, s.causes);
  s.items = s.items || [];
  s.actions = s.actions || d.actions;
  s.drawings = s.drawings || [];
}

async function newClaim() {
  const maxNo = samples.filter(s => s.type === "claim")
    .reduce((m, s) => Math.max(m, Number(s.regNo) || 0), 0);
  const draft = blankClaim(maxNo + 1);
  const { data, error } = await sb.from("samples")
    .insert({ data: draft, completed: false }).select().single();
  if (error) { alert("Грешка при създаване: " + error.message); return; }
  const s = rowToSample(data);
  samples.unshift(s);
  currentId = s.id;
  renderList();
  renderForm();
}

function renderClaimForm(s) {
  const form = document.getElementById("claim-form");
  form.hidden = false;
  document.getElementById("claim-regno").textContent = s.regNo || "—";

  form.querySelectorAll("[data-field]").forEach(el => {
    const val = getByPath(s, el.dataset.field);
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val == null ? "" : val;
  });

  renderClaimItems(s);
  renderClaimActions(s);
  renderDrawings(s);
  setStatus("");
}

function renderClaimItems(s) {
  const tbody = document.getElementById("claim-items-body");
  tbody.innerHTML = "";
  s.items.forEach((it, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" value="${escapeAttr(it.articleNo)}" placeholder="Арт. №" /></td>
      <td><input type="text" value="${escapeAttr(it.name)}" placeholder="Наименование" /></td>
      <td><input type="text" value="${escapeAttr(it.description)}" placeholder="Описание на проблема" /></td>
      <td><input type="text" value="${escapeAttr(it.qty)}" placeholder="бр." /></td>
      <td><input type="text" value="${escapeAttr(it.value)}" placeholder="стойност" /></td>
      <td><button type="button" class="remove-row" title="Изтрий">×</button></td>`;
    const [a, n, d, q, v] = tr.querySelectorAll("input");
    a.addEventListener("input", () => { it.articleNo = a.value; touch(s); });
    n.addEventListener("input", () => { it.name = n.value; touch(s); });
    d.addEventListener("input", () => { it.description = d.value; touch(s); });
    q.addEventListener("input", () => { it.qty = q.value; touch(s); });
    v.addEventListener("input", () => { it.value = v.value; touch(s); });
    tr.querySelector(".remove-row").addEventListener("click", () => {
      s.items.splice(i, 1); touch(s); renderClaimItems(s);
    });
    tbody.appendChild(tr);
  });
}

function renderClaimActions(s) {
  const tbody = document.getElementById("claim-actions-body");
  tbody.innerHTML = "";
  s.actions.forEach((ac, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" value="${escapeAttr(ac.person)}" placeholder="Име" /></td>
      <td><input type="text" value="${escapeAttr(ac.action)}" placeholder="Предприети действия" /></td>
      <td><input type="date" value="${escapeAttr(ac.date)}" /></td>
      <td><button type="button" class="remove-row" title="Изтрий">×</button></td>`;
    const [p, a, dt] = tr.querySelectorAll("input");
    p.addEventListener("input", () => { ac.person = p.value; touch(s); });
    a.addEventListener("input", () => { ac.action = a.value; touch(s); });
    dt.addEventListener("input", () => { ac.date = dt.value; touch(s); });
    tr.querySelector(".remove-row").addEventListener("click", () => {
      s.actions.splice(i, 1); touch(s); renderClaimActions(s);
    });
    tbody.appendChild(tr);
  });
}

function claimDemandsText(s) {
  const picked = Object.keys(CLAIM_DEMANDS).filter(k => s.claimsClient?.[k]).map(k => CLAIM_DEMANDS[k]);
  return picked.join(", ") || "—";
}

function renderClaimRegister() {
  document.getElementById("welcome").hidden = true;
  document.getElementById("sample-form").hidden = true;
  document.getElementById("claim-form").hidden = true;
  document.getElementById("report").hidden = true;
  document.getElementById("claim-report").hidden = false;
  currentId = null;
  renderList();

  const body = document.getElementById("claim-report-body");
  const claims = samples.filter(s => s.type === "claim").sort((a, b) => (a.regNo || 0) - (b.regNo || 0));
  body.innerHTML = "";
  if (!claims.length) {
    body.innerHTML = `<tr><td colspan="9" class="report-empty">Няма въведени рекламации.</td></tr>`;
    return;
  }
  claims.forEach(s => {
    const subj = (s.items || []).map(it => it.description || it.name).filter(Boolean).join("; ") || "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(String(s.regNo || "—"))}</td>
      <td>${s.date ? formatDate(s.date) : "—"}</td>
      <td>${escapeHtml(s.client?.company) || "—"}</td>
      <td>${escapeHtml(subj)}</td>
      <td>${escapeHtml(claimDemandsText(s))}</td>
      <td>${escapeHtml(s.acceptedBy) || "—"}</td>
      <td>${escapeHtml(firstLine(s.resolution)) || "—"}</td>
      <td>${s.completedDate ? formatDate(s.completedDate) : "—"}</td>
      <td>${escapeHtml(s.value) || "—"}</td>`;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => { currentId = s.id; renderList(); renderForm(); });
    body.appendChild(tr);
  });
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
  let res;
  try {
    res = await sb.auth.signInWithPassword({ email, password });
  } catch (ex) {
    btn.disabled = false; btn.textContent = "Вход";
    setLoginError("Проблем с връзката. Опитай отново.");
    return;
  }
  btn.disabled = false; btn.textContent = "Вход";
  if (res.error) {
    setLoginError(translateAuthError(res.error.message));
  } else if (res.data && res.data.session) {
    await onSignedIn(res.data.session);
  }
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
}

async function onSignedIn(s) {
  if (appStarted) return;
  appStarted = true;
  session = s;
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

  document.getElementById("btn-new").addEventListener("click", () => newSample("sample"));
  document.getElementById("btn-new-order").addEventListener("click", () => newSample("order"));
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
  document.getElementById("type-filter").addEventListener("change", renderList);
  document.getElementById("btn-print").addEventListener("click", () => window.print());
  document.getElementById("btn-delete").addEventListener("click", deleteSample);

  bindSimpleField("clientName", (s, v) => s.clientName = v);
  bindSimpleField("clientInfo", (s, v) => s.clientInfo = v);
  bindSimpleField("sampleInfo", (s, v) => s.sampleInfo = v);
  bindSimpleField("deadline", (s, v) => s.deadline = v);
  bindSimpleField("packaging", (s, v) => s.packaging = v);
  bindSimpleField("shippingMethod", (s, v) => s.shippingMethod = v);
  bindSimpleField("shippingAddress", (s, v) => s.shippingAddress = v);
  bindSimpleField("analysis", (s, v) => s.analysis = v);
  document.getElementById("completed").addEventListener("change", () => {
    const s = getCurrent(); if (!s) return;
    s.completed = document.getElementById("completed").checked;
    touch(s); renderList();
  });
  document.getElementById("btn-add-material").addEventListener("click", () => {
    const s = getCurrent(); if (!s) return;
    s.materials.push({ name: "", qty: "", status: "not-ordered", note: "" });
    touch(s); renderMaterials(s);
  });
  document.getElementById("drawings-file").addEventListener("change", e => {
    handleDrawingFiles([...e.target.files]);
    e.target.value = "";
  });
  document.getElementById("analysis-file").addEventListener("change", e => {
    handleAnalysisFiles([...e.target.files]);
    e.target.value = "";
  });

  /* --- Рекламации --- */
  document.getElementById("btn-new-claim").addEventListener("click", newClaim);
  document.getElementById("btn-claim-report").addEventListener("click", renderClaimRegister);
  document.getElementById("btn-claim-report-close").addEventListener("click", () => {
    document.getElementById("claim-report").hidden = true; renderForm();
  });
  document.getElementById("btn-claim-report-print").addEventListener("click", () => window.print());
  document.getElementById("btn-claim-print").addEventListener("click", () => window.print());
  document.getElementById("btn-claim-delete").addEventListener("click", deleteSample);
  document.getElementById("btn-add-claim-item").addEventListener("click", () => {
    const s = getCurrent(); if (!s) return;
    s.items.push({ articleNo: "", name: "", description: "", qty: "", value: "" });
    touch(s); renderClaimItems(s);
  });
  document.getElementById("btn-add-claim-action").addEventListener("click", () => {
    const s = getCurrent(); if (!s) return;
    s.actions.push({ person: "", action: "", date: "" });
    touch(s); renderClaimActions(s);
  });
  document.getElementById("claim-drawings-file").addEventListener("change", e => {
    handleDrawingFiles([...e.target.files]);
    e.target.value = "";
  });
  // Едно слушане за всички полета на бланката (data-field).
  const claimFieldHandler = e => {
    const el = e.target.closest("[data-field]");
    if (!el) return;
    const s = getCurrent(); if (!s) return;
    const val = el.type === "checkbox" ? el.checked : el.value;
    setByPath(s, el.dataset.field, val);
    touch(s);
    if (el.dataset.field === "completed") renderList();
  };
  document.getElementById("claim-form").addEventListener("input", claimFieldHandler);
  document.getElementById("claim-form").addEventListener("change", claimFieldHandler);
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

  // Само за изход. Входът се обработва директно в handleLogin/init,
  // за да се избегне известно "заключване" при тежки заявки в това събитие.
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && appStarted) onSignedOut();
  });
}

document.addEventListener("DOMContentLoaded", init);
