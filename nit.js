/* Данко Системс — „ЗАНИТВАНЕ" (сглобяване). Като ЦЕХ РОГОШ, но с два слоя:
   14 механизма → операции. Служителят избира механизъм, вижда операциите и
   записва брой. БРОЯТ НИТОВЕ е скрит от служителя — ползва се само в отчета
   (колко и какви механизми е сглобявал + колко нита е занитил).
   Данните: app_config id="nit_reports":
     { records: { "<служител>|<дата>": { worker, date, ops:{ "<операция>": qty }, at } } }
   Ползва глобалния sb и amWorker/escapeHtml/escapeAttr. */

const NIT_WORKERS = ["Богдана Камжалова", "Нели Кехайова", "Валентин Мирчев", "Мария Костова", "Иван Мералов"];

// Механизми → операции. r = брой нитове (скрит), t = вид нит.
const NIT_MECHANISMS = [
  { name: "ИТАЛИЯ", ops: [
    { n: "Италия 2ка 3ка", r: 2, t: "обикн" },
    { n: "Италия нож на заготовка", r: 2, t: "обикн" },
    { n: "Италия 2ка 3ка и Нож", r: 4, t: "обикн" },
    { n: "Италия само нож", r: 2, t: "обикн" },
    { n: "Италия затваряне на крак", r: 2, t: "големи" },
    { n: "Крак колела", r: 1, t: "колела" },
  ] },
  { name: "ПОТАПЯЩ", ops: [
    { n: "Потапящ заготовка", r: 2, t: "обикн" },
    { n: "Потапящ затваряне", r: 2, t: "обикн" },
    { n: "Потапящ цял", r: 4, t: "обикн" },
  ] },
  { name: "Малък бял", ops: [
    { n: "Малък бял заготовка", r: 2, t: "обикн" },
    { n: "Малък бял затваряне", r: 2, t: "обикн" },
    { n: "Малък бял цял", r: 4, t: "обикн" },
  ] },
  { name: "МПК", ops: [
    { n: "МПК заготовка", r: 2, t: "обикн" },
    { n: "МПК затваряне с крак", r: 2, t: "обикн" },
    { n: "МПК колело на крак", r: 1, t: "колела" },
  ] },
  { name: "КОЛЕЛА", ops: [
    { n: "Колело ос+колело", r: 1, t: "колела" },
  ] },
  { name: "МАРКО", ops: [
    { n: "Марко пишльок", r: 1, t: "ос" },
    { n: "Марко заготовка", r: 2, t: "обикн" },
    { n: "Марко затваряне", r: 2, t: "обикн" },
  ] },
  { name: "45 градуса", ops: [
    { n: "45 градуса заготовка", r: 2, t: "обикн" },
    { n: "45 градуса затваряне", r: 2, t: "обикн" },
    { n: "45 градуса цял", r: 4, t: "обикн" },
  ] },
  { name: "ШИКОЗЕН 45 градуса", ops: [
    { n: "Шикозен 45 заготовка", r: 2, t: "обикн" },
    { n: "Шикозен 45 затваряне", r: 2, t: "обикн" },
    { n: "Шикозен 45 цял", r: 4, t: "обикн" },
  ] },
  { name: "45 градуса ГОЛЯМ БЯЛ", ops: [
    { n: "45 градуса Г.Б. заготовка", r: 2, t: "обикн" },
    { n: "45 градуса Г.Б. затваряне", r: 2, t: "обикн" },
    { n: "45 градуса Г.Б. цял", r: 4, t: "обикн" },
  ] },
  { name: "НИКОЛЕТИ", ops: [
    { n: "Николети 2ка 3ка", r: 2, t: "обикн" },
    { n: "Николети нож на заготовка", r: 2, t: "обикн" },
    { n: "Николети 2ка 3ка и нож", r: 4, t: "обикн" },
    { n: "Николети само нож", r: 2, t: "обикн" },
  ] },
  { name: "ММ03", ops: [
    { n: "ММ03 заготовка", r: 2, t: "обикн" },
    { n: "ММ03 затваряне", r: 2, t: "обикн" },
    { n: "ММ03 цял", r: 4, t: "обикн" },
  ] },
  { name: "ММ02", ops: [
    { n: "ММ02 заготовка", r: 2, t: "обикн" },
    { n: "ММ02 затваряне", r: 2, t: "обикн" },
    { n: "ММ02 цял", r: 4, t: "обикн" },
  ] },
  { name: "ЛАЗ. РЯЗАНЕ", ops: [
    { n: "Лаз.ряз осичка б", r: 1, t: "ос" },
    { n: "Лаз.ряз 2 нит", r: 2, t: "обикн" },
    { n: "Лаз.ряз 4 нит", r: 4, t: "обикн" },
  ] },
  { name: "ЗАНИТВАНЕ", ops: [
    { n: "Занитване 1 нит", r: 1, t: "обикн" },
    { n: "Занитване 2 нита", r: 2, t: "обикн" },
  ] },
];
// Индекс: име на операция → { mech, r, t }
const NIT_OP_INDEX = (() => { const m = {}; NIT_MECHANISMS.forEach(me => me.ops.forEach(o => { m[o.n] = { mech: me.name, r: o.r, t: o.t }; })); return m; })();
const NIT_RIVET_TYPES = [["обикн", "обикновени"], ["големи", "големи"], ["колела", "колела"], ["ос", "ос"]];

let NIT = { records: {} };
let NIT_LOADED = false;
let nitWorker = "", nitDate = "", nitMech = null, nitView = "entry", nitPeriod = "week";

function nitToday() { return new Date().toISOString().slice(0, 10); }
function nitKey(w, d) { return w + "|" + d; }
function nitNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
function nitFmtDate(s) { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; }
function nitNowHM() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); }

async function nitLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "nit_reports").maybeSingle(); NIT = (data && data.data && typeof data.data === "object") ? data.data : { records: {} }; NIT.records = NIT.records || {}; }
  catch (e) { NIT = { records: {} }; }
}
async function nitSave() {
  const { error } = await sb.from("app_config").upsert({ id: "nit_reports", data: NIT, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

async function openNit() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("nit-modal").hidden = false;
  const isW = nitIsWorker();
  const lo = document.getElementById("nit-logout"); if (lo) lo.hidden = !isW;
  const cl = document.getElementById("nit-close"); if (cl) cl.hidden = isW;
  const h = document.querySelector("#nit-modal .mini-head h3");
  if (h) h.textContent = isW ? "🔩 ЗАНИТВАНЕ — дневен запис" : "🔩 ЗАНИТВАНЕ — сглобяване (отчет)";
  if (!NIT_LOADED) { await nitLoad(); NIT_LOADED = true; }
  if (!nitDate) nitDate = nitToday();
  nitRender();
}
function closeNit() { document.getElementById("nit-modal").hidden = true; }
function nitIsWorker() { return (typeof amWorker === "function") && amWorker(); }

function nitRender() {
  const v = document.getElementById("nit-view"); if (!v) return;
  if (nitIsWorker() && !nitWorker) { nitRenderPicker(v); return; }
  if (nitView === "summary" && !nitIsWorker()) { nitRenderSummary(v); return; }
  if (nitMech != null) { nitRenderOps(v); return; }
  nitRenderMechanisms(v);
}

/* „Кой си ти" */
function nitRenderPicker(v) {
  v.innerHTML = `
    <div class="rog-picker">
      <h3>Здравей, аз съм Системата!<br>Кой си ти?</h3>
      <div class="rog-picker-list">
        ${NIT_WORKERS.map(n => `<button class="rog-id-btn" data-w="${escapeAttr(n)}"><span class="rog-av">${escapeHtml((n.trim()[0] || "?").toUpperCase())}</span>${escapeHtml(n)}</button>`).join("")}
      </div>
    </div>`;
  v.querySelectorAll(".rog-id-btn").forEach(b => b.addEventListener("click", () => { nitWorker = b.dataset.w; nitRender(); }));
}

/* Механизми (голяма мрежа от бутони) */
function nitRenderMechanisms(v) {
  const isW = nitIsWorker();
  const worker = nitWorker || NIT_WORKERS[0];
  if (!nitWorker) nitWorker = worker;
  const rec = NIT.records[nitKey(worker, nitDate)] || { ops: {} };
  const mechQty = me => me.ops.reduce((s, o) => s + nitNum(rec.ops ? rec.ops[o.n] : 0), 0);

  const workerCtrl = isW
    ? `<span class="rog-who">👷 <b>${escapeHtml(worker)}</b></span><button class="btn btn-small rog-switch-btn" id="nit-switch">🔄 Смени служител</button>`
    : `<label class="erp-inline">Служител <select id="nit-worker">${NIT_WORKERS.map(n => `<option ${n === worker ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select></label>`;

  v.innerHTML = `
    <div class="rog-toolbar">
      ${workerCtrl}
      <label class="erp-inline">Дата <input type="date" id="nit-date" value="${escapeAttr(nitDate)}" /></label>
      ${!isW ? `<button class="btn btn-small" id="nit-summary">📊 Обобщение (седмица/месец)</button>` : ""}
    </div>
    <p class="hint">Избери <b>механизъм</b>, после въведи колко си сглобил по всяка операция.</p>
    <div class="nit-mech-grid">
      ${NIT_MECHANISMS.map((me, i) => { const q = mechQty(me); return `<button class="nit-mech-btn" data-i="${i}">${escapeHtml(me.name)}${q ? `<span class="nit-mech-badge">${q}</span>` : ""}</button>`; }).join("")}
    </div>`;

  const dateEl = v.querySelector("#nit-date");
  if (dateEl) dateEl.addEventListener("change", () => { nitDate = dateEl.value || nitToday(); nitRender(); });
  const wsel = v.querySelector("#nit-worker");
  if (wsel) wsel.addEventListener("change", () => { nitWorker = wsel.value; nitRender(); });
  const sw = v.querySelector("#nit-switch");
  if (sw) sw.addEventListener("click", () => { nitWorker = ""; nitRender(); });
  const sum = v.querySelector("#nit-summary");
  if (sum) sum.addEventListener("click", () => { nitView = "summary"; nitRender(); });
  v.querySelectorAll(".nit-mech-btn").forEach(b => b.addEventListener("click", () => { nitMech = Number(b.dataset.i); nitRender(); }));
}

/* Операции на избрания механизъм (нитовете НЕ се показват) */
function nitRenderOps(v) {
  const worker = nitWorker || NIT_WORKERS[0];
  const me = NIT_MECHANISMS[nitMech]; if (!me) { nitMech = null; nitRender(); return; }
  const rec = NIT.records[nitKey(worker, nitDate)] || { ops: {} };
  v.innerHTML = `
    <div class="rog-toolbar">
      <button class="btn btn-small" id="nit-back">← Механизми</button>
      <span class="rog-who">🔩 <b>${escapeHtml(me.name)}</b> · 👷 ${escapeHtml(worker)} · ${nitFmtDate(nitDate)}</span>
    </div>
    <div class="rog-rows">
      <div class="rog-row rog-head"><div class="rog-op">Операция</div><div class="rog-inputs"><span class="rog-hq">брой</span></div></div>
      ${me.ops.map(o => `<div class="rog-row">
        <div class="rog-op">${escapeHtml(o.n)}</div>
        <div class="rog-inputs"><input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" min="0" step="any" inputmode="decimal" value="${rec.ops && rec.ops[o.n] != null ? escapeAttr(String(rec.ops[o.n])) : ""}" placeholder="брой" /></div>
      </div>`).join("")}
    </div>
    <div class="rog-tot-line" id="nit-tot"></div>
    <div class="rog-actions">
      <span class="rog-status" id="nit-status"></span>
      <button class="btn btn-primary rog-save-btn" id="nit-save">💾 Запиши</button>
    </div>`;

  const recalc = () => { let t = 0; v.querySelectorAll(".nit-q").forEach(i => t += nitNum(i.value)); const el = v.querySelector("#nit-tot"); if (el) el.innerHTML = `Общо за механизма: <b>${Math.round(t * 100) / 100}</b>`; };
  v.querySelectorAll(".nit-q").forEach(i => i.addEventListener("input", recalc));
  recalc();
  v.querySelector("#nit-back").addEventListener("click", () => { nitMech = null; nitRender(); });
  v.querySelector("#nit-save").addEventListener("click", async () => {
    const key = nitKey(worker, nitDate);
    const r = NIT.records[key] || { worker, date: nitDate, ops: {} };
    r.worker = worker; r.date = nitDate; r.ops = r.ops || {};
    v.querySelectorAll(".nit-q").forEach(inp => { const op = inp.dataset.op; const q = nitNum(inp.value); if (q > 0) r.ops[op] = q; else delete r.ops[op]; });
    r.at = new Date().toISOString();
    if (Object.keys(r.ops).length) NIT.records[key] = r; else delete NIT.records[key];
    const btn = v.querySelector("#nit-save"); btn.disabled = true; btn.textContent = "Записва…";
    const ok = await nitSave();
    btn.disabled = false; btn.textContent = "💾 Запиши";
    const st = v.querySelector("#nit-status"); if (st) st.textContent = ok ? "✓ Записано " + nitNowHM() : "⚠ грешка";
    if (ok) setTimeout(() => { nitMech = null; nitRender(); }, 500);
  });
}

/* ---------- Период ---------- */
function nitIso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function nitWeekNo(dateStr) {
  const d = new Date(dateStr + "T00:00:00"); if (isNaN(d.getTime())) return "";
  const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const NIT_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
function nitPeriodRange(dateStr, period) {
  const d = new Date((dateStr || nitToday()) + "T00:00:00");
  if (period === "day") return { from: nitIso(d), to: nitIso(d), label: nitFmtDate(dateStr) };
  if (period === "month") { const f = new Date(d.getFullYear(), d.getMonth(), 1), l = new Date(d.getFullYear(), d.getMonth() + 1, 0); return { from: nitIso(f), to: nitIso(l), label: NIT_MONTHS[d.getMonth()] + " " + d.getFullYear() }; }
  const off = (d.getDay() + 6) % 7; const mon = new Date(d); mon.setDate(d.getDate() - off); const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: nitIso(mon), to: nitIso(sun), label: `седмица ${nitWeekNo(nitIso(mon))} · ${nitFmtDate(nitIso(mon))} – ${nitFmtDate(nitIso(sun))}` };
}
function nitShiftDate(dateStr, period, dir) { const d = new Date((dateStr || nitToday()) + "T00:00:00"); if (period === "day") d.setDate(d.getDate() + dir); else if (period === "week") d.setDate(d.getDate() + 7 * dir); else d.setMonth(d.getMonth() + dir); return nitIso(d); }

function nitSummaryData(from, to) {
  const opAgg = {}, mechAgg = {}, riv = {};
  NIT_WORKERS.forEach(w => { opAgg[w] = {}; mechAgg[w] = {}; riv[w] = { обикн: 0, големи: 0, колела: 0, ос: 0, total: 0, pieces: 0, days: new Set() }; });
  Object.values(NIT.records || {}).forEach(r => {
    if (!r || !r.date || r.date < from || r.date > to) return;
    const w = r.worker; if (!opAgg[w]) return;
    let any = false;
    Object.entries(r.ops || {}).forEach(([op, qv]) => {
      const q = nitNum(qv); if (!q) return; any = true;
      const info = NIT_OP_INDEX[op]; if (!info) return;
      opAgg[w][op] = (opAgg[w][op] || 0) + q;
      mechAgg[w][info.mech] = (mechAgg[w][info.mech] || 0) + q;
      riv[w][info.t] = (riv[w][info.t] || 0) + q * info.r;
      riv[w].total += q * info.r; riv[w].pieces += q;
    });
    if (any) riv[w].days.add(r.date);
  });
  return { opAgg, mechAgg, riv };
}

/* Обобщение (админ): ден/седмица/месец — механизми + нитове по служител */
function nitRenderSummary(v) {
  const range = nitPeriodRange(nitDate, nitPeriod);
  const { opAgg, mechAgg, riv } = nitSummaryData(range.from, range.to);
  const grandPieces = NIT_WORKERS.reduce((s, w) => s + riv[w].pieces, 0);
  const grandRivets = NIT_WORKERS.reduce((s, w) => s + riv[w].total, 0);
  const pBtn = (key, label) => `<button class="btn btn-small ${nitPeriod === key ? "btn-primary" : ""}" data-period="${key}">${label}</button>`;

  const cards = NIT_WORKERS.map(w => { const a = riv[w]; return `<div class="rog-card">
    <div class="rog-card-name">${escapeHtml(w)}</div>
    <div class="rog-card-tot">${a.pieces || 0}</div>
    <div class="rog-card-sub">сглобени · <b>${a.total || 0}</b> нита</div>
    <div class="rog-card-days">${NIT_RIVET_TYPES.filter(([k]) => a[k]).map(([k, l]) => `${l}: ${a[k]}`).join(" · ") || "—"}</div>
    <div class="rog-card-days">${a.days.size} ${a.days.size === 1 ? "работен ден" : "работни дни"}</div>
  </div>`; }).join("") + `<div class="rog-card rog-card-grand"><div class="rog-card-name">ВСИЧКИ</div><div class="rog-card-tot">${grandPieces}</div><div class="rog-card-sub">сглобени · <b>${grandRivets}</b> нита</div></div>`;

  // Таблица: механизми (редове) × служители
  const mechTotal = me => NIT_WORKERS.reduce((s, w) => s + (mechAgg[w][me.name] || 0), 0);
  const mechRows = NIT_MECHANISMS.map(me => mechTotal(me) ? `<tr>
    <td>${escapeHtml(me.name)}</td>
    ${NIT_WORKERS.map(w => `<td class="num">${mechAgg[w][me.name] || "—"}</td>`).join("")}
    <td class="num"><b>${mechTotal(me)}</b></td></tr>` : "").join("") || `<tr><td colspan="${NIT_WORKERS.length + 2}" class="report-empty">Няма записи за периода.</td></tr>`;

  v.innerHTML = `
    <div class="rog-toolbar">
      <button class="btn btn-small" id="nit-back">← Отчет</button>
      <span class="rog-period-btns">${pBtn("day", "Ден")}${pBtn("week", "Седмица")}${pBtn("month", "Месец")}</span>
      <button class="btn btn-small" id="nit-prev">‹</button>
      <input type="date" id="nit-date2" value="${escapeAttr(nitDate)}" />
      <button class="btn btn-small" id="nit-next">›</button>
      <span class="rog-who">📊 <b>${escapeHtml(range.label)}</b></span>
    </div>
    <div class="rog-cards">${cards}</div>
    <h4 class="erp-group-head">Сглобени по механизъм</h4>
    <div class="rog-table-wrap"><table class="report-table rog-sum-table">
      <thead><tr><th>Механизъм</th>${NIT_WORKERS.map(w => `<th class="num">${escapeHtml(w.split(" ")[0])}</th>`).join("")}<th class="num">Общо</th></tr></thead>
      <tbody>${mechRows}</tbody>
    </table></div>`;
  v.querySelector("#nit-back").addEventListener("click", () => { nitView = "entry"; nitRender(); });
  v.querySelectorAll("[data-period]").forEach(b => b.addEventListener("click", () => { nitPeriod = b.dataset.period; nitRender(); }));
  const d2 = v.querySelector("#nit-date2"); if (d2) d2.addEventListener("change", () => { nitDate = d2.value || nitToday(); nitRender(); });
  const prev = v.querySelector("#nit-prev"); if (prev) prev.addEventListener("click", () => { nitDate = nitShiftDate(nitDate, nitPeriod, -1); nitRender(); });
  const next = v.querySelector("#nit-next"); if (next) next.addEventListener("click", () => { nitDate = nitShiftDate(nitDate, nitPeriod, 1); nitRender(); });
}

/* ---------- Инициализация ---------- */
function nitInit() {
  const wire = (id, fn) => { const el = document.getElementById(id); if (el && !el._nitWired) { el._nitWired = true; el.addEventListener("click", fn); } };
  wire("tasks-nit", openNit);
  wire("nit-close", closeNit);
  const lo = document.getElementById("nit-logout");
  if (lo && !lo._nitWired) { lo._nitWired = true; lo.addEventListener("click", () => { if (typeof sb !== "undefined" && sb) sb.auth.signOut(); }); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", nitInit);
else nitInit();
