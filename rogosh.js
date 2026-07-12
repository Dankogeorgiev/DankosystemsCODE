/* Данко Системс — „ЦЕХ РОГОШ" (сериен монтаж). НЕ получава задачи от потока —
   всеки служител в края на деня записва какво е сглобил по операции (дневен отчет).
   Данните се пазят в app_config id="rogosh_reports":
     { records: { "<служител>|<дата>": { worker, date, ops:{op:qty}, note, at } } }
   Ползва глобалния sb и MY_ACCESS/amWorker/escapeHtml/escapeAttr. */

const ROGOSH_WORKERS = ["Илияна Колева", "Лилия Атанасова", "Румяна Сулакова"];
const ROGOSH_OPS = [
  "Зачистване от боя",
  "Малък бял заготовка", "Малък бял затваряне",
  "Италия заготовка", "Италия затваряне (нож)",
  "45 градуса заготовка", "45 градуса затваряне",
  "Потащящ заготовка",
];

let ROGOSH = { records: {} };
let ROGOSH_LOADED = false;
let rogWorker = "";     // избран служител (за цеховия вход — „кой си ти")
let rogDate = "";
let rogView = "entry";  // entry | summary

function rogToday() { return new Date().toISOString().slice(0, 10); }
function rogKey(w, d) { return w + "|" + d; }
function rogNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
function rogFmtDate(s) { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; }
function rogNowHM() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); }

async function rogLoad() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "rogosh_reports").maybeSingle();
    ROGOSH = (data && data.data && typeof data.data === "object") ? data.data : { records: {} };
    ROGOSH.records = ROGOSH.records || {};
  } catch (e) { ROGOSH = { records: {} }; }
}
async function rogSave() {
  const { error } = await sb.from("app_config").upsert({ id: "rogosh_reports", data: ROGOSH, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

async function openRogosh() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("rogosh-modal").hidden = false;
  const isW = rogIsWorker();
  const lo = document.getElementById("rogosh-logout"); if (lo) lo.hidden = !isW;   // цехов вход → Изход
  const cl = document.getElementById("rogosh-close"); if (cl) cl.hidden = isW;     // админ → Затвори
  if (!ROGOSH_LOADED) { await rogLoad(); ROGOSH_LOADED = true; }
  if (!rogDate) rogDate = rogToday();
  rogRender();
}
function closeRogosh() { document.getElementById("rogosh-modal").hidden = true; }

function rogIsWorker() { return (typeof amWorker === "function") && amWorker(); }

function rogRender() {
  const v = document.getElementById("rogosh-view");
  if (!v) return;
  // Цехов вход и още не е избран „кой си ти" → показваме избор на служител.
  if (rogIsWorker() && !rogWorker) { rogRenderPicker(v); return; }
  if (rogView === "summary" && !rogIsWorker()) { rogRenderSummary(v); return; }
  rogRenderEntry(v);
}

/* „Кой си ти" — за цеховия акаунт rogosh@danko.local */
function rogRenderPicker(v) {
  v.innerHTML = `
    <div class="rog-picker">
      <h3>Кой си ти?</h3>
      <div class="rog-picker-list">
        ${ROGOSH_WORKERS.map(n => `<button class="rog-id-btn" data-w="${escapeAttr(n)}"><span class="rog-av">${escapeHtml((n.trim()[0] || "?").toUpperCase())}</span>${escapeHtml(n)}</button>`).join("")}
      </div>
    </div>`;
  v.querySelectorAll(".rog-id-btn").forEach(b => b.addEventListener("click", () => { rogWorker = b.dataset.w; rogRender(); }));
}

/* Дневен отчет: попълва брой по операции за избрания служител и дата. */
function rogRenderEntry(v) {
  const isW = rogIsWorker();
  const worker = rogWorker || ROGOSH_WORKERS[0];
  if (!rogWorker) rogWorker = worker;
  const rec = ROGOSH.records[rogKey(worker, rogDate)] || { ops: {}, note: "" };

  const workerCtrl = isW
    ? `<span class="rog-who">👷 <b>${escapeHtml(worker)}</b> <button class="btn btn-small" id="rog-switch">смени</button></span>`
    : `<label class="erp-inline">Служител <select id="rog-worker">${ROGOSH_WORKERS.map(n => `<option ${n === worker ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select></label>`;

  v.innerHTML = `
    <div class="rog-toolbar">
      ${workerCtrl}
      <label class="erp-inline">Дата <input type="date" id="rog-date" value="${escapeAttr(rogDate)}" /></label>
      ${!isW ? `<button class="btn btn-small" id="rog-summary">📊 Обобщение за деня</button>` : ""}
      <span class="spacer" style="flex:1"></span>
      <span class="rog-status" id="rog-status"></span>
    </div>
    <p class="hint">Запиши колко <b>сглоби днес</b> по всяка операция. Празно/0 = нищо по нея.</p>
    <table class="report-table rog-table">
      <thead><tr><th>Операция</th><th class="num">Брой сглобени</th></tr></thead>
      <tbody>
        ${ROGOSH_OPS.map(op => `
          <tr>
            <td data-label="Операция">${escapeHtml(op)}</td>
            <td class="num" data-label="Брой"><input type="number" class="rog-q" data-op="${escapeAttr(op)}" min="0" step="any" inputmode="decimal" value="${rec.ops[op] != null && rec.ops[op] !== "" ? escapeAttr(String(rec.ops[op])) : ""}" placeholder="0" /></td>
          </tr>`).join("")}
      </tbody>
      <tfoot><tr class="rog-total"><td>ОБЩО за деня</td><td class="num"><b id="rog-tot">0</b></td></tr></tfoot>
    </table>
    <label class="rog-note-lbl">Забележка <input type="text" id="rog-note" value="${escapeAttr(rec.note || "")}" placeholder="по желание" /></label>
    <div class="rog-actions"><button class="btn btn-primary" id="rog-save">💾 Запиши деня</button></div>`;

  const recalc = () => {
    let t = 0; v.querySelectorAll(".rog-q").forEach(i => t += rogNum(i.value));
    const el = v.querySelector("#rog-tot"); if (el) el.textContent = String(Math.round(t * 100) / 100);
  };
  v.querySelectorAll(".rog-q").forEach(i => i.addEventListener("input", recalc));
  recalc();

  const dateEl = v.querySelector("#rog-date");
  if (dateEl) dateEl.addEventListener("change", () => { rogDate = dateEl.value || rogToday(); rogRender(); });
  const wsel = v.querySelector("#rog-worker");
  if (wsel) wsel.addEventListener("change", () => { rogWorker = wsel.value; rogRender(); });
  const sw = v.querySelector("#rog-switch");
  if (sw) sw.addEventListener("click", () => { rogWorker = ""; rogRender(); });
  const sum = v.querySelector("#rog-summary");
  if (sum) sum.addEventListener("click", () => { rogView = "summary"; rogRender(); });

  v.querySelector("#rog-save").addEventListener("click", async () => {
    const ops = {};
    v.querySelectorAll(".rog-q").forEach(i => { const q = rogNum(i.value); if (q > 0) ops[i.dataset.op] = q; });
    const note = (v.querySelector("#rog-note").value || "").trim();
    const btn = v.querySelector("#rog-save"); btn.disabled = true; btn.textContent = "Записва…";
    const key = rogKey(worker, rogDate);
    if (!Object.keys(ops).length && !note) delete ROGOSH.records[key];
    else ROGOSH.records[key] = { worker, date: rogDate, ops, note, at: new Date().toISOString() };
    const ok = await rogSave();
    btn.disabled = false; btn.textContent = "💾 Запиши деня";
    const st = v.querySelector("#rog-status"); if (st) st.textContent = ok ? "✓ Записано " + rogNowHM() : "⚠ грешка";
  });
}

/* Обобщение за деня (само админ) — всички служители × операции. */
function rogRenderSummary(v) {
  const recs = ROGOSH_WORKERS.map(w => ROGOSH.records[rogKey(w, rogDate)] || { worker: w, ops: {} });
  const opTotal = op => recs.reduce((s, r) => s + rogNum(r.ops[op]), 0);
  const workerTotal = r => ROGOSH_OPS.reduce((s, op) => s + rogNum(r.ops[op]), 0);
  const grand = ROGOSH_OPS.reduce((s, op) => s + opTotal(op), 0);

  v.innerHTML = `
    <div class="rog-toolbar">
      <button class="btn btn-small" id="rog-back">← Отчет</button>
      <label class="erp-inline">Дата <input type="date" id="rog-date2" value="${escapeAttr(rogDate)}" /></label>
      <span class="rog-who">📊 Обобщение за ${rogFmtDate(rogDate)}</span>
    </div>
    <table class="report-table rog-table">
      <thead><tr><th>Операция</th>${ROGOSH_WORKERS.map(w => `<th class="num">${escapeHtml(w.split(" ")[0])}</th>`).join("")}<th class="num">Общо</th></tr></thead>
      <tbody>
        ${ROGOSH_OPS.map(op => `<tr>
          <td>${escapeHtml(op)}</td>
          ${recs.map(r => `<td class="num">${rogNum(r.ops[op]) || "—"}</td>`).join("")}
          <td class="num"><b>${opTotal(op) || "—"}</b></td>
        </tr>`).join("")}
      </tbody>
      <tfoot><tr class="rog-total">
        <td>ОБЩО</td>${recs.map(r => `<td class="num"><b>${workerTotal(r) || "—"}</b></td>`).join("")}<td class="num"><b>${grand || "—"}</b></td>
      </tr></tfoot>
    </table>`;
  v.querySelector("#rog-back").addEventListener("click", () => { rogView = "entry"; rogRender(); });
  const d2 = v.querySelector("#rog-date2");
  if (d2) d2.addEventListener("change", () => { rogDate = d2.value || rogToday(); rogRender(); });
}

/* ---------- Инициализация ---------- */
function rogInit() {
  const wire = (id, fn) => { const el = document.getElementById(id); if (el && !el._rogWired) { el._rogWired = true; el.addEventListener("click", fn); } };
  wire("tasks-rogosh", openRogosh);
  wire("rogosh-close", closeRogosh);
  const lo = document.getElementById("rogosh-logout");
  if (lo && !lo._rogWired) { lo._rogWired = true; lo.addEventListener("click", () => { if (typeof sb !== "undefined" && sb) sb.auth.signOut(); }); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", rogInit);
else rogInit();
