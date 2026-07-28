/* Данко Системс — „ЦЕХ РОГОШ" (сериен монтаж). НЕ получава задачи от потока —
   всеки служител в края на деня записва какво е сглобил по операции (дневен отчет).
   Данните се пазят в app_config id="rogosh_reports":
     { records: { "<служител>|<дата>": { worker, date, ops:{op:qty}, note, at } } }
   Ползва глобалния sb и MY_ACCESS/amWorker/escapeHtml/escapeAttr. */

const ROGOSH_WORKERS = ["Илияна Колева", "Лилия Атанасова", "Румяна Сулакова"];
/* Операциите са ТОЧНО нит-операциите (имената от NIT_STOCK_MAP) — складовата
   връзка е същата като в Занитване (nitSyncStock): заприходяване по разликата,
   влагане на частите/материалите, авто-комплект, прогрес по заявките.
   В Рогош се правят заготовки/половини на трите механизма (28.07.2026, Данко):
   „Зачистване от боя" и „Потапящ заготовка" са махнати по негово искане. */
const ROGOSH_OPS = [
  "Италия 2ка 3ка", "Италия само нож", "Италия нож на готова заготовка",
  "Малък бял заготовка", "Малък бял затваряне", "Малък бял цял",
  "45 градуса заготовка", "45 градуса затваряне", "45 градуса цял",
];

let ROGOSH = { records: {} };
let ROGOSH_LOADED = false;
let rogWorker = "";     // избран служител (за цеховия вход — „кой си ти")
let rogDate = "";
let rogView = "entry";  // entry | summary
let rogPeriod = "week"; // day | week | month (за обобщението)

function rogToday() { return new Date().toISOString().slice(0, 10); }
function rogKey(w, d) { return w + "|" + d; }
function rogNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
function rogFmtDate(s) { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; }
function rogNowHM() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); }
/* Стойност за операция → {l, d}. Съвместимост със СТАРИЯ формат:
   {q, v: "леви"|"десни"|"комплект"} (комплект = ляв + десен) или голо число. */
function rogLD(c) {
  if (c == null) return { l: 0, d: 0 };
  if (typeof c === "object" && (c.l != null || c.d != null)) return { l: rogNum(c.l), d: rogNum(c.d) };
  const q = rogNum(typeof c === "object" ? c.q : c);
  const v = (typeof c === "object" && c.v) || "комплект";
  if (v === "леви") return { l: q, d: 0 };
  if (v === "десни") return { l: 0, d: q };
  return { l: q, d: q };   // комплект = ляв + десен
}

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

/* Дневен отчет: Л/Д полета като в Занитване — пишат се само НОВИТЕ бройки
   (добавят се към днешните; минус вади). Складът върви през nitSyncStock. */
function rogRenderEntry(v) {
  const isW = rogIsWorker();
  const worker = rogWorker || ROGOSH_WORKERS[0];
  if (!rogWorker) rogWorker = worker;
  const rec = ROGOSH.records[rogKey(worker, rogDate)] || { ops: {}, note: "" };

  const workerCtrl = isW
    ? `<span class="rog-who">👷 <b>${escapeHtml(worker)}</b></span><button class="btn btn-small rog-switch-btn" id="rog-switch">🔄 Смени служител</button>`
    : `<label class="erp-inline">Служител <select id="rog-worker">${ROGOSH_WORKERS.map(n => `<option ${n === worker ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select></label>`;

  const rowHtml = op => {
    const map = (typeof NIT_STOCK_MAP !== "undefined" && NIT_STOCK_MAP[op]) || null;
    const ld = rogLD((rec.ops || {})[op]);
    return `<div class="rog-row">
      <div class="rog-op">${escapeHtml(op)}
        ${map ? `<div class="nit-opcodes">код: Л <b>${escapeHtml(map.l || "—")}</b> · Д <b>${escapeHtml(map.d || "—")}</b></div>` : `<div class="nit-opcodes nit-opcodes-none">без складов код</div>`}
        ${(ld.l || ld.d) ? `<div class="nit-today">днес: Л <b>${ld.l}</b> · Д <b>${ld.d}</b></div>` : ""}
      </div>
      <div class="rog-inputs rog-ld">
        <label class="nit-ldl">Л <input type="number" class="rog-q" data-op="${escapeAttr(op)}" data-side="l" step="any" inputmode="decimal" value="" placeholder="${map && map.l ? "ляв → " + escapeAttr(map.l) : "ляв"}" /></label>
        <label class="nit-ldl">Д <input type="number" class="rog-q" data-op="${escapeAttr(op)}" data-side="d" step="any" inputmode="decimal" value="" placeholder="${map && map.d ? "десен → " + escapeAttr(map.d) : "десен"}" /></label>
      </div>
    </div>`;
  };

  v.innerHTML = `
    <div class="rog-toolbar">
      ${workerCtrl}
      <label class="erp-inline">Дата <input type="date" id="rog-date" value="${escapeAttr(rogDate)}" /></label>
      ${!isW ? `<button class="btn btn-small" id="rog-summary">📊 Обобщение (седмица/месец)</button>` : ""}
    </div>
    <p class="hint">Пишеш само <b>НОВИТЕ бройки</b> — добавят се към днешните. Сгрешено? Въведи с минус (напр. -50).
      Складът се обновява сам, точно както в Занитване.</p>
    <div class="rog-rows">
      <div class="rog-row rog-head"><div class="rog-op">Операция</div><div class="rog-inputs"><span class="rog-hq">НОВИ бройки · Л = ляв, Д = десен</span></div></div>
      ${ROGOSH_OPS.map(rowHtml).join("")}
    </div>
    <div class="rog-tot-line" id="rog-tot"></div>
    <label class="rog-note-lbl">Забележка <input type="text" id="rog-note" value="${escapeAttr(rec.note || "")}" placeholder="по желание" /></label>
    <div class="rog-actions">
      <span class="rog-status" id="rog-status"></span>
      <button class="btn btn-primary rog-save-btn" id="rog-save">💾 Запиши</button>
    </div>`;

  const dayTot = ROGOSH_OPS.reduce((s, op) => { const ld = rogLD((rec.ops || {})[op]); return s + ld.l + ld.d; }, 0);
  const recalc = () => {
    let t = 0; v.querySelectorAll(".rog-q").forEach(i => t += rogNum(i.value));
    const el = v.querySelector("#rog-tot");
    if (el) el.innerHTML = `Добавяш сега: <b>${Math.round(t * 100) / 100}</b> · вече записани днес: <b>${Math.round(dayTot * 100) / 100}</b>`;
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
    // Свеж документ преди записа — да не стъпчем запис от друга сесия.
    try { await rogLoad(); } catch (e) {}
    const key = rogKey(worker, rogDate);
    const r = ROGOSH.records[key] || { worker, date: rogDate, ops: {}, note: "" };
    r.worker = worker; r.date = rogDate; r.ops = r.ops || {};
    // СТАР запис (формат {q,v} отпреди складовата връзка): конвертираме към
    // {l,d} и ЗАМРАЗЯВАМЕ вече записаното (stocked = текущото) — старите
    // бройки не се заприходяват със задна дата, само новите делти.
    if (!r.v2) {
      const conv = {};
      Object.keys(r.ops).forEach(op => { conv[op] = rogLD(r.ops[op]); });
      r.ops = conv; r.stocked = r.stocked || {};
      Object.keys(conv).forEach(op => {
        if (r.stocked[op + "¦Л"] == null) r.stocked[op + "¦Л"] = conv[op].l;
        if (r.stocked[op + "¦Д"] == null) r.stocked[op + "¦Д"] = conv[op].d;
      });
      r.v2 = true;
    }
    // Добавяме новите бройки към днешните (и нулираме полетата веднага —
    // повторно „Запиши" след паднала връзка да не ги удвои).
    v.querySelectorAll(".rog-q").forEach(inp => {
      const op = inp.dataset.op, sk = inp.dataset.side;
      const q = rogNum(inp.value); if (!q) return;
      const cur = rogLD(r.ops[op]);
      cur[sk] = Math.max(0, cur[sk] + q);
      if (cur.l > 0 || cur.d > 0) r.ops[op] = { l: cur.l, d: cur.d }; else delete r.ops[op];
    });
    v.querySelectorAll(".rog-q").forEach(inp => { inp.value = ""; });
    recalc();
    r.note = (v.querySelector("#rog-note").value || "").trim();
    r.at = new Date().toISOString();
    const btn = v.querySelector("#rog-save"); btn.disabled = true; btn.textContent = "Записва…";
    // Складова връзка — СЪЩАТА като в Занитване (nitSyncStock работи по
    // NIT_STOCK_MAP/NIT_CONSUME; бележките казват „Рогош").
    if (typeof nitSyncStock === "function") {
      r.__ws = "Рогош";
      try { await nitSyncStock(r); } catch (e) { console.warn("Рогош→склад:", e); }
      delete r.__ws;
      try { if (typeof nitCombineStock === "function") await nitCombineStock(); } catch (e) {}
    }
    const hasAny = Object.keys(r.ops).length || r.note || (r.stocked && Object.values(r.stocked).some(x => Number(x) > 0));
    if (hasAny) ROGOSH.records[key] = r; else delete ROGOSH.records[key];
    const ok = await rogSave();
    btn.disabled = false; btn.textContent = "💾 Запиши";
    const st = v.querySelector("#rog-status"); if (st) st.textContent = ok ? "✓ Записано " + rogNowHM() : "⚠ грешка";
    if (ok) rogRender();
  });
}

/* ---------- Период (ден/седмица/месец) ---------- */
function rogIso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function rogWeekNo(dateStr) {
  const d = new Date(dateStr + "T00:00:00"); if (isNaN(d.getTime())) return "";
  const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const ROG_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
function rogPeriodRange(dateStr, period) {
  const d = new Date((dateStr || rogToday()) + "T00:00:00");
  if (period === "day") return { from: rogIso(d), to: rogIso(d), label: rogFmtDate(dateStr) };
  if (period === "month") {
    const first = new Date(d.getFullYear(), d.getMonth(), 1), last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: rogIso(first), to: rogIso(last), label: ROG_MONTHS[d.getMonth()] + " " + d.getFullYear() };
  }
  // седмица (пн–нд)
  const off = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - off);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: rogIso(mon), to: rogIso(sun), label: `седмица ${rogWeekNo(rogIso(mon))} · ${rogFmtDate(rogIso(mon))} – ${rogFmtDate(rogIso(sun))}` };
}
function rogShiftDate(dateStr, period, dir) {
  const d = new Date((dateStr || rogToday()) + "T00:00:00");
  if (period === "day") d.setDate(d.getDate() + dir);
  else if (period === "week") d.setDate(d.getDate() + 7 * dir);
  else d.setMonth(d.getMonth() + dir);
  return rogIso(d);
}
// Сумиране за периода: по операция за всяка жена + по вид (Л/Д/К) + работни дни.
function rogSummaryData(from, to) {
  const opAgg = {}, vAgg = {};
  ROGOSH_WORKERS.forEach(w => { opAgg[w] = {}; vAgg[w] = { "леви": 0, "десни": 0, "комплект": 0, total: 0, days: new Set() }; });
  Object.values(ROGOSH.records || {}).forEach(r => {
    if (!r || !r.date || r.date < from || r.date > to) return;
    const w = r.worker; if (!opAgg[w]) return;
    let any = false;
    Object.entries(r.ops || {}).forEach(([op, c]) => {
      const ld = rogLD(c);   // старият „комплект" се брои като ляв + десен
      const q = ld.l + ld.d; if (!q) return; any = true;
      opAgg[w][op] = (opAgg[w][op] || 0) + q;
      vAgg[w]["леви"] += ld.l; vAgg[w]["десни"] += ld.d; vAgg[w].total += q;
    });
    if (any) vAgg[w].days.add(r.date);
  });
  return { opAgg, vAgg };
}

/* Обобщение (само админ) — ден / седмица / месец: общо за всяка жена + за всички. */
function rogRenderSummary(v) {
  const range = rogPeriodRange(rogDate, rogPeriod);
  const { opAgg, vAgg } = rogSummaryData(range.from, range.to);
  const opTotal = op => ROGOSH_WORKERS.reduce((s, w) => s + (opAgg[w][op] || 0), 0);
  const grand = ROGOSH_WORKERS.reduce((s, w) => s + vAgg[w].total, 0);
  const pBtn = (key, label) => `<button class="btn btn-small ${rogPeriod === key ? "btn-primary" : ""}" data-period="${key}">${label}</button>`;

  const cards = ROGOSH_WORKERS.map(w => {
    const a = vAgg[w];
    return `<div class="rog-card">
      <div class="rog-card-name">${escapeHtml(w)}</div>
      <div class="rog-card-tot">${a.total || 0}</div>
      <div class="rog-card-sub">Л ${a["леви"] || 0} · Д ${a["десни"] || 0}</div>
      <div class="rog-card-days">${a.days.size} ${a.days.size === 1 ? "работен ден" : "работни дни"}</div>
    </div>`;
  }).join("") + `<div class="rog-card rog-card-grand"><div class="rog-card-name">ВСИЧКИ</div><div class="rog-card-tot">${grand || 0}</div><div class="rog-card-sub">общо за периода</div></div>`;

  v.innerHTML = `
    <div class="rog-toolbar">
      <button class="btn btn-small" id="rog-back">← Отчет</button>
      <span class="rog-period-btns">${pBtn("day", "Ден")}${pBtn("week", "Седмица")}${pBtn("month", "Месец")}</span>
      <button class="btn btn-small" id="rog-prev">‹</button>
      <input type="date" id="rog-date2" value="${escapeAttr(rogDate)}" />
      <button class="btn btn-small" id="rog-next">›</button>
      <span class="rog-who">📊 <b>${escapeHtml(range.label)}</b></span>
    </div>
    <div class="rog-cards">${cards}</div>
    <h4 class="erp-group-head">Разбивка по операции</h4>
    <div class="rog-table-wrap"><table class="report-table rog-sum-table">
      <thead><tr><th>Операция</th>${ROGOSH_WORKERS.map(w => `<th class="num">${escapeHtml(w.split(" ")[0])}</th>`).join("")}<th class="num">Общо</th></tr></thead>
      <tbody>
        ${[...new Set([...ROGOSH_OPS, ...ROGOSH_WORKERS.flatMap(w => Object.keys(opAgg[w]))])].map(op => `<tr>
          <td>${escapeHtml(op)}${ROGOSH_OPS.includes(op) ? "" : ' <span class="erp-muted">(архивна)</span>'}</td>
          ${ROGOSH_WORKERS.map(w => `<td class="num">${opAgg[w][op] || "—"}</td>`).join("")}
          <td class="num"><b>${opTotal(op) || "—"}</b></td>
        </tr>`).join("")}
      </tbody>
      <tfoot><tr class="rog-total">
        <td>ОБЩО</td>${ROGOSH_WORKERS.map(w => `<td class="num"><b>${vAgg[w].total || "—"}</b></td>`).join("")}<td class="num"><b>${grand || "—"}</b></td>
      </tr></tfoot>
    </table></div>`;
  v.querySelector("#rog-back").addEventListener("click", () => { rogView = "entry"; rogRender(); });
  v.querySelectorAll("[data-period]").forEach(b => b.addEventListener("click", () => { rogPeriod = b.dataset.period; rogRender(); }));
  const d2 = v.querySelector("#rog-date2");
  if (d2) d2.addEventListener("change", () => { rogDate = d2.value || rogToday(); rogRender(); });
  const prev = v.querySelector("#rog-prev"); if (prev) prev.addEventListener("click", () => { rogDate = rogShiftDate(rogDate, rogPeriod, -1); rogRender(); });
  const next = v.querySelector("#rog-next"); if (next) next.addEventListener("click", () => { rogDate = rogShiftDate(rogDate, rogPeriod, 1); rogRender(); });
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
