/* Данко Системс — „ОТЧЕТИ" (анализ на времената и на изработеното).
   Тук се събират всички отчети — целта е яснота: кой какво е направил и за колко.
   - обобщение по служител и по цех (компактно, натисни за филтър);
   - анализ по операция: средно/най-бързо/най-бавно време за 1 брой (за ценообразуване);
   - подробни записи (скрити по подразбиране — излизат при избран филтър);
   - филтри по служител/цех/операция/машина и период (от–до);
   - експорт в Excel (CSV) и PDF.
   Ползва collectTimeRows/fmtSecDur/fmtLogDate/logNotes от tasks.js. */

let timesRpt = { workshop: "", operation: "", machine: "", worker: "", client: "", orderNo: "", code: "", from: "", to: "" };
let timesShowDetail = false;   // подробните записи са скрити, докато не се поиска изрично
let timesTrendMode = "week";   // тенденция по седмица / по месец
let timesAnalysisMode = "detail";   // анализ по детайл (продукт) / по операция

// Секунди за 1 брой от едно вписване (директно tPiece, или tOrder/бройка).
function timesPerPiece(r) {
  if (r.tPiece && r.tPiece.sec) return r.tPiece.sec;
  if (r.tOrder && r.tOrder.sec && (Number(r.qty) || 0) > 0) return r.tOrder.sec / Number(r.qty);
  return null;
}

// Общо работно време за едно вписване (за обобщенията).
function timesTotalSec(r) {
  if (r.tOrder && r.tOrder.sec) return r.tOrder.sec;
  if (r.tPiece && r.tPiece.sec) return r.tPiece.sec * (Number(r.qty) || 1);
  return null;
}

function timesRptRows(allPre) {
  const all = allPre || ((typeof collectTimeRows === "function") ? collectTimeRows() : []);
  const f = timesRpt;
  return all.filter(r => {
    if (f.workshop && r.workshop !== f.workshop) return false;
    if (f.operation && r.operation !== f.operation) return false;
    if (f.machine && r.machine !== f.machine) return false;
    if (f.worker && r.worker !== f.worker) return false;
    if (f.client && r.client !== f.client) return false;
    // Заявка: едно вписване може да носи няколко номера (споделена серия) —
    // съвпадение, ако търсеният номер е сред тях.
    if (f.orderNo && !String(r.orderNo || "").split(",").map(s => s.trim()).includes(f.orderNo)) return false;
    // 🔎 Търсене по НАШИЯ код на изделието (или име на продукта).
    if (f.code) {
      const q = f.code.toLowerCase().trim();
      if (!(`${r.code || ""} ${r.product || ""}`.toLowerCase().includes(q))) return false;
    }
    const d = (r.date || "").slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  });
}

// Обобщение по служител или по цех (компактно).
function timesGroupBy(rows, key) {
  const map = {};
  rows.forEach(r => {
    const k = r[key] || "(без)";
    const g = map[k] || (map[k] = { name: k, entries: 0, pieces: 0, sec: 0 });
    g.entries++;
    g.pieces += Number(r.qty) || 0;
    const t = timesTotalSec(r);
    if (t != null) g.sec += t;
  });
  return Object.values(map).sort((a, b) => b.pieces - a.pieces);
}

// Обобщение по операция (за ценообразуване).
function timesByOperation(rows) {
  const map = {};
  rows.forEach(r => {
    const key = (r.operation || "(без операция)") + "¦" + (r.workshop || "");
    const g = map[key] || (map[key] = { operation: r.operation || "(без операция)", workshop: r.workshop || "", entries: 0, pieces: 0, sumWeighted: 0, wq: 0, min: Infinity, max: 0 });
    g.entries++;
    g.pieces += Number(r.qty) || 0;
    const pp = timesPerPiece(r);
    if (pp != null) {
      const q = Number(r.qty) || 1;
      g.sumWeighted += pp * q; g.wq += q;
      if (pp < g.min) g.min = pp;
      if (pp > g.max) g.max = pp;
    }
  });
  return Object.values(map).map(g => ({
    ...g,
    avg: g.wq > 0 ? g.sumWeighted / g.wq : null,
    min: g.min === Infinity ? null : g.min,
    max: g.max || null,
  })).sort((a, b) => (b.avg || 0) - (a.avg || 0));
}

// Обобщение по детайл (продукт) в рамките на операция — защото един
// детайл е бавен, друг бърз (Лазерно рязане, Заваръчно и т.н.). Средното
// по цял цех подвежда; тук всеки детайл има собствено време.
function timesByDetail(rows) {
  const map = {};
  rows.forEach(r => {
    const detail = (r.product || "(без продукт)") + (r.code ? " · " + r.code : "");
    const key = detail + "¦" + (r.operation || "") + "¦" + (r.workshop || "");
    const g = map[key] || (map[key] = { detail, operation: r.operation || "", workshop: r.workshop || "", entries: 0, pieces: 0, sumWeighted: 0, wq: 0, min: Infinity, max: 0 });
    g.entries++;
    g.pieces += Number(r.qty) || 0;
    const pp = timesPerPiece(r);
    if (pp != null) {
      const q = Number(r.qty) || 1;
      g.sumWeighted += pp * q; g.wq += q;
      if (pp < g.min) g.min = pp;
      if (pp > g.max) g.max = pp;
    }
  });
  return Object.values(map).map(g => ({
    ...g,
    avg: g.wq > 0 ? g.sumWeighted / g.wq : null,
    min: g.min === Infinity ? null : g.min,
    max: g.max || null,
  })).sort((a, b) => (b.avg || 0) - (a.avg || 0));
}

function timesDur(sec) {
  return (sec == null) ? "—" : fmtSecDur({ sec: Math.round(sec) });
}

// ISO номер на седмица за дата (обект {year, week}).
function timesIsoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week };
}

// Тенденция по седмица или месец (за да се вижда дали работим по-бързо/по-бавно).
function timesTrend(rows, mode) {
  const map = {};
  rows.forEach(r => {
    const ds = (r.date || "").slice(0, 10);
    if (!ds) return;
    let key, label;
    if (mode === "month") { key = ds.slice(0, 7); label = key; }
    else { const w = timesIsoWeek(new Date(ds + "T00:00:00")); key = w.year + "-W" + String(w.week).padStart(2, "0"); label = "седм. " + w.week + " / " + w.year; }
    const g = map[key] || (map[key] = { key, label, entries: 0, pieces: 0, sec: 0, sumWeighted: 0, wq: 0 });
    g.entries++;
    g.pieces += Number(r.qty) || 0;
    const t = timesTotalSec(r); if (t != null) g.sec += t;
    const pp = timesPerPiece(r); if (pp != null) { const q = Number(r.qty) || 1; g.sumWeighted += pp * q; g.wq += q; }
  });
  return Object.values(map).map(g => ({ ...g, avg: g.wq > 0 ? g.sumWeighted / g.wq : null }))
    .sort((a, b) => a.key < b.key ? 1 : -1);
}

// Бърз период — задава from/to спрямо днешната дата.
function timesSetPeriod(kind) {
  const iso = d => d.toISOString().slice(0, 10);
  const now = new Date();
  if (kind === "all") { timesRpt.from = ""; timesRpt.to = ""; return; }
  if (kind === "month") { timesRpt.from = iso(new Date(now.getFullYear(), now.getMonth(), 1)); timesRpt.to = iso(now); return; }
  if (kind === "prev") { timesRpt.from = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)); timesRpt.to = iso(new Date(now.getFullYear(), now.getMonth(), 0)); return; }
  if (kind === "90") { const f = new Date(now); f.setDate(f.getDate() - 89); timesRpt.from = iso(f); timesRpt.to = iso(now); return; }
  if (kind === "week") { const day = (now.getDay() + 6) % 7; const f = new Date(now); f.setDate(f.getDate() - day); timesRpt.from = iso(f); timesRpt.to = iso(now); return; }
}

/* ---------- Сглобени комплекти / опаковки ----------
   Движенията с ref „нит-сглоб:" (авто-сглобяване от Занитване) и „сглоб:"
   (опаковка — ръчно от Склад детайли или автоматично при продажба) се събират
   тук като партиди: какво е сглобено (+) и какви части е вложило (−). */
let TIMES_ASM = [];
async function loadAsmLog() {
  const out = [];
  try {
    let rows = [];
    for (const pat of ["нит-сглоб:%", "сглоб:%"]) {
      const { data } = await sb.from("product_movements")
        .select("product_id,kind,quantity,ref,note,created_at")
        .like("ref", pat).order("created_at", { ascending: false }).limit(3000);
      rows = rows.concat(data || []);
    }
    const pids = [...new Set(rows.map(r => r.product_id))];
    const names = {};
    if (pids.length) {
      const { data: ps } = await sb.from("products").select("id,code,name").in("id", pids);
      (ps || []).forEach(p => { names[p.id] = { code: p.code || "", name: p.name || "" }; });
    }
    // Партида = ref + момент на запис (един ref „сглоб:ръчно" се ползва многократно).
    const map = {};
    rows.forEach(r => {
      const key = (r.ref || "") + "¦" + String(r.created_at || "").slice(0, 19);
      const g = map[key] || (map[key] = { at: r.created_at || "", ref: r.ref || "", made: [], used: [] });
      const nm = names[r.product_id] || { code: "#" + r.product_id, name: "" };
      const q = Number(r.quantity) || 0;
      if (q > 0) g.made.push({ code: nm.code, name: nm.name, qty: q });
      else if (q < 0) g.used.push({ code: nm.code, name: nm.name, qty: -q });
    });
    out.push(...Object.values(map));
    out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  } catch (e) { /* без секцията, ако четенето пропадне */ }
  TIMES_ASM = out;
}
function asmSourceLabel(ref) {
  const r = String(ref || "");
  if (r.startsWith("нит-сглоб:")) return "Занитване (авто)";
  if (r.startsWith("сглоб:прод")) return "Продажба " + r.slice("сглоб:прод".length).trim();
  if (r === "сглоб:ръчно") return "Склад детайли (ръчно)";
  if (r.startsWith("сглоб:")) return "Опаковка";
  return r;
}
// Партидите според текущия филтър на ОТЧЕТИ (период + търсене по код).
function timesAsmRows() {
  const f = timesRpt;
  return (TIMES_ASM || []).filter(g => {
    const d = String(g.at || "").slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (f.code) {
      const q = f.code.toLowerCase().trim();
      const inList = list => list.some(x => (`${x.code} ${x.name}`).toLowerCase().includes(q));
      if (!inList(g.made) && !inList(g.used)) return false;
    }
    return true;
  });
}

/* ---------- Изглед ---------- */
function renderTimesReport() {
  showSub("times");
  const v = document.getElementById("times-view");
  const all = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const uniq = key => [...new Set(all.map(r => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "bg"));
  // Номерата на заявки идват слепени (споделена серия „1, 2") — разделяме ги.
  const uniqOrders = () => [...new Set(all.flatMap(r => String(r.orderNo || "").split(",").map(s => s.trim()).filter(Boolean)))]
    .sort((a, b) => String(a).localeCompare(String(b), "bg", { numeric: true }));
  const f = timesRpt;
  const sel = (id, cur, list, label) => `<label>${label} <select id="${id}"><option value="">Всички</option>${list.map(x => `<option ${x === cur ? "selected" : ""}>${escapeHtml(x)}</option>`).join("")}</select></label>`;

  const rows = timesRptRows(all);
  const analysis = timesAnalysisMode === "detail" ? timesByDetail(rows) : timesByOperation(rows);
  const byWorker = timesGroupBy(rows, "worker");
  const byShop = timesGroupBy(rows, "workshop");
  const trend = timesTrend(rows, timesTrendMode);
  const detailed = rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const hasFilter = !!(f.worker || f.workshop || f.operation || f.machine || f.client || f.orderNo || f.code);
  const showDetail = hasFilter || timesShowDetail;

  const emptyRow = n => `<tr><td colspan="${n}" class="report-empty">Няма данни за този филтър.</td></tr>`;
  const flabel = [f.worker, f.workshop, f.operation, f.machine, f.client, f.orderNo ? "заявка №" + f.orderNo : "", f.code ? "код " + f.code : ""].filter(Boolean).join(" · ");

  v.innerHTML = `
    <div class="workers-head"><h3>📋 ОТЧЕТИ — какво е направено и за колко време</h3>
      <button id="tr-back" class="btn btn-small">← Назад</button></div>
    <div class="times-filters">
      ${sel("tr-w", f.worker, uniq("worker"), "👤 Служител")}
      ${sel("tr-ws", f.workshop, uniq("workshop"), "🏭 Цех")}
      ${sel("tr-op", f.operation, uniq("operation"), "Операция")}
      ${sel("tr-m", f.machine, uniq("machine"), "Машина")}
      ${sel("tr-cl", f.client, uniq("client"), "🤝 Клиент")}
      ${sel("tr-ord", f.orderNo, uniqOrders(), "📋 Заявка №")}
      <label>🔎 Код <input type="search" id="tr-code" value="${escapeAttr(f.code)}" placeholder="напр. 30245" style="min-width:130px" autocomplete="off" /></label>
      <label>От <input type="date" id="tr-from" value="${escapeAttr(f.from)}" /></label>
      <label>До <input type="date" id="tr-to" value="${escapeAttr(f.to)}" /></label>
      ${hasFilter ? `<button id="tr-clear" class="btn btn-small">✕ Изчисти филтъра</button>` : ""}
      <span class="spacer"></span>
      <span class="muted times-count">${detailed.length} записа</span>
      <button id="tr-all" class="btn btn-small btn-primary" title="Един файл: днес (детайлно), тази седмица и този месец (обобщено), със стойност на труда по цеховите ставки">⤓ Общ отчет (ден·седмица·месец)</button>
      <button id="tr-csv" class="btn btn-small">⤓ Excel</button>
      <button id="tr-pdf" class="btn btn-small">🖨 PDF</button>
    </div>
    <div class="times-periods">
      <span class="muted">Период:</span>
      <button class="btn btn-small" data-period="all">Всичко</button>
      <button class="btn btn-small" data-period="week">Тази седмица</button>
      <button class="btn btn-small" data-period="month">Този месец</button>
      <button class="btn btn-small" data-period="prev">Миналия месец</button>
      <button class="btn btn-small" data-period="90">Последни 90 дни</button>
    </div>

    <div class="times-summary-grid">
      <div class="times-sumcard">
        <h4>👤 По служители <span class="muted">— натисни ред за филтър</span></h4>
        <table class="report-table times-table">
          <thead><tr><th>Служител</th><th class="num">Вписвания</th><th class="num">Бройки</th><th class="num">Общо време</th></tr></thead>
          <tbody>${byWorker.map(g => `<tr class="times-click" data-w="${escapeAttr(g.name)}">
            <td>${escapeHtml(g.name)}</td><td class="num">${g.entries}</td><td class="num">${g.pieces}</td><td class="num">${timesDur(g.sec || null)}</td>
          </tr>`).join("") || emptyRow(4)}</tbody>
        </table>
      </div>
      <div class="times-sumcard">
        <h4>🏭 По цехове <span class="muted">— натисни ред за филтър</span></h4>
        <table class="report-table times-table">
          <thead><tr><th>Цех</th><th class="num">Вписвания</th><th class="num">Бройки</th><th class="num">Общо време</th></tr></thead>
          <tbody>${byShop.map(g => `<tr class="times-click" data-shop="${escapeAttr(g.name)}">
            <td>${escapeHtml(g.name)}</td><td class="num">${g.entries}</td><td class="num">${g.pieces}</td><td class="num">${timesDur(g.sec || null)}</td>
          </tr>`).join("") || emptyRow(4)}</tbody>
        </table>
      </div>
    </div>

    <div class="times-detail-head" style="margin-top:16px">
      <h4 style="margin:0 0 4px">Анализ <span class="muted">— средно време за 1 брой (за ценообразуване)</span></h4>
      <span class="times-trend-toggle">
        <button class="btn btn-small ${timesAnalysisMode === "detail" ? "on" : ""}" data-anal="detail">По детайл</button>
        <button class="btn btn-small ${timesAnalysisMode === "op" ? "on" : ""}" data-anal="op">По операция</button>
      </span>
    </div>
    ${timesAnalysisMode === "detail" ? `<p class="hint" style="margin:0 0 8px">Всеки детайл има собствено време — бавните и бързите не се смесват (важно за Лазерно рязане, Заваръчно и др.).</p>` : ""}
    <table class="report-table times-table">
      <thead><tr>${timesAnalysisMode === "detail" ? `<th>Детайл (продукт)</th>` : ""}<th>Операция</th><th>Цех</th><th class="num">Вписвания</th><th class="num">Общо бройки</th><th class="num">Средно/брой</th><th class="num">Най-бързо/брой</th><th class="num">Най-бавно/брой</th></tr></thead>
      <tbody>${analysis.map(g => `<tr>
        ${timesAnalysisMode === "detail" ? `<td><b>${escapeHtml(g.detail)}</b></td><td>${escapeHtml(g.operation) || "—"}</td>` : `<td><b>${escapeHtml(g.operation)}</b></td>`}<td>${escapeHtml(g.workshop) || "—"}</td>
        <td class="num">${g.entries}</td><td class="num">${g.pieces}</td>
        <td class="num">${timesDur(g.avg)}</td><td class="num">${timesDur(g.min)}</td><td class="num">${timesDur(g.max)}</td>
      </tr>`).join("") || `<tr><td colspan="${timesAnalysisMode === "detail" ? 8 : 7}" class="report-empty">Няма времена за този филтър.</td></tr>`}</tbody>
    </table>

    <div class="times-detail-head" style="margin-top:16px">
      <h4 style="margin:0 0 4px">Тенденция <span class="muted">— по-бързо ли работим, или по-бавно?</span></h4>
      <span class="times-trend-toggle">
        <button class="btn btn-small ${timesTrendMode === "week" ? "on" : ""}" data-trend="week">По седмица</button>
        <button class="btn btn-small ${timesTrendMode === "month" ? "on" : ""}" data-trend="month">По месец</button>
      </span>
    </div>
    <table class="report-table times-table">
      <thead><tr><th>Период</th><th class="num">Вписвания</th><th class="num">Бройки</th><th class="num">Общо време</th><th class="num">Средно/брой</th></tr></thead>
      <tbody>${trend.map((g, i) => {
        const prev = trend[i + 1];   // по-старият период (масивът е от нов към стар)
        let cls = "", arrow = "";
        if (prev && g.avg != null && prev.avg != null) {
          const diff = (g.avg - prev.avg) / prev.avg;
          if (diff <= -0.03) { cls = "times-good"; arrow = " ▼"; }        // по-бързо
          else if (diff >= 0.03) { cls = "times-bad"; arrow = " ▲"; }     // по-бавно
        }
        return `<tr>
        <td><b>${escapeHtml(g.label)}</b></td><td class="num">${g.entries}</td><td class="num">${g.pieces}</td>
        <td class="num">${timesDur(g.sec || null)}</td><td class="num ${cls}">${timesDur(g.avg)}${arrow}</td>
      </tr>`; }).join("") || `<tr><td colspan="5" class="report-empty">Няма данни за този филтър.</td></tr>`}</tbody>
    </table>

    ${(() => {
      const asm = timesAsmRows();
      const totalMade = asm.reduce((s, g) => s + g.made.reduce((x, m) => x + m.qty, 0), 0);
      const fmtList = (list, bold) => list.map(x => `${bold ? "<b>" : ""}${escapeHtml(x.code)}${bold ? "</b>" : ""} ${escapeHtml(x.name)} <span class="muted">× ${x.qty}</span>`).join("<br>");
      return `
    <div class="times-detail-head" style="margin-top:16px">
      <h4 style="margin:0 0 4px">🧩 Сглобени комплекти / опаковки <span class="muted">— ${asm.length} партиди · общо ${totalMade} бр. (спазва периода и „🔎 Код")</span></h4>
    </div>
    <p class="hint" style="margin:0 0 8px">Тук излиза всяко сглобяване без цехова операция: авто-сглобяването от Занитване (две половини → цял/к-т), „🧩 сглоби" от Склад детайли и автоматичната опаковка при продажба. Показва се какво е заприходено и кои части са изписани.</p>
    <table class="report-table times-table">
      <thead><tr><th>Дата</th><th>Сглобено (+)</th><th>Вложени части (−)</th><th>Източник</th></tr></thead>
      <tbody>${asm.slice(0, 200).map(g => `<tr>
        <td>${escapeHtml(fmtLogDate(String(g.at || "").slice(0, 10)))} <span class="muted">${escapeHtml(String(g.at || "").slice(11, 16))}</span></td>
        <td>${fmtList(g.made, true) || "—"}</td>
        <td class="times-cons">${fmtList(g.used, false) || "—"}</td>
        <td>${escapeHtml(asmSourceLabel(g.ref))}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="report-empty">Няма сглобявания за този период.</td></tr>`}</tbody>
    </table>
    ${asm.length > 200 ? `<p class="muted">Показани са последните 200 партиди от ${asm.length}. Стесни периода за останалите.</p>` : ""}`;
    })()}

    ${showDetail ? `
      <div class="times-detail-head">
        <h4 style="margin:18px 0 4px">Подробни записи${flabel ? ` — <span class="times-flabel">${escapeHtml(flabel)}</span>` : ""} <span class="muted">(${detailed.length})</span></h4>
        ${!hasFilter ? `<button id="tr-hidedetail" class="btn btn-small">Скрий подробните</button>` : ""}
      </div>
      <table class="report-table times-table">
        <thead><tr><th>Дата</th><th>Цех</th><th>Машина</th><th>Заявка №</th><th>Клиент</th><th>Продукт</th><th>Операция</th><th>Служител</th>
          <th class="num">Брой</th><th class="num">За 1 брой</th><th>1 лист/прът</th><th>Кол-во/поръчка</th><th>Настройка</th><th>Бележки</th></tr></thead>
        <tbody>${detailed.map(r => `<tr>
          <td>${escapeHtml(fmtLogDate(r.date))}</td><td>${escapeHtml(r.workshop) || "—"}</td><td>${escapeHtml(r.machine) || "—"}</td>
          <td>${r.orderNo ? escapeHtml(r.orderNo) : "—"}</td>
          <td>${r.client ? escapeHtml(r.client) : `<span class="serie">СЕРИЯ</span>`}</td>
          <td>${escapeHtml(r.product) || "—"}${r.code ? `<div class="t-code">${escapeHtml(r.code)}</div>` : ""}</td>
          <td>${escapeHtml(r.operation) || "—"}</td><td>${escapeHtml(r.worker) || "—"}</td>
          <td class="num">${r.qty}</td><td class="num">${timesDur(timesPerPiece(r))}</td>
          <td>${escapeHtml(fmtSecDur(r.tSheet))}</td><td>${escapeHtml(fmtSecDur(r.tOrder))}</td><td>${escapeHtml(fmtSecDur(r.tSetup))}</td>
          <td class="times-cons">${r.notes ? escapeHtml(r.notes) : "—"}</td>
        </tr>`).join("") || `<tr><td colspan="14" class="report-empty">Няма записи за този филтър.</td></tr>`}</tbody>
      </table>
    ` : `
      <div class="times-detail-hint">
        <p class="muted">Има <b>${detailed.length}</b> подробни записа. Изберете <b>служител</b> или <b>цех</b> отгоре (или натиснете ред в таблиците), за да видите точно техните записи.</p>
        <button id="tr-showdetail" class="btn btn-small">Покажи всички подробни записи</button>
      </div>
    `}`;

  v.querySelector("#tr-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  const bind = (id, key) => { const el = v.querySelector("#" + id); if (el) el.addEventListener("change", e => { timesRpt[key] = e.target.value; renderTimesReport(); }); };
  bind("tr-ws", "workshop"); bind("tr-op", "operation"); bind("tr-m", "machine"); bind("tr-w", "worker"); bind("tr-cl", "client"); bind("tr-ord", "orderNo"); bind("tr-from", "from"); bind("tr-to", "to");
  // Търсене по код — на живо; след пре-рендера връщаме фокуса в полето.
  const codeEl = v.querySelector("#tr-code");
  if (codeEl) codeEl.addEventListener("input", uiDebounce(e => {
    timesRpt.code = e.target.value;
    renderTimesReport();
    const el = document.getElementById("tr-code");
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 220));
  v.querySelectorAll(".times-click").forEach(tr => tr.addEventListener("click", () => {
    if (tr.dataset.w != null) timesRpt.worker = tr.dataset.w;
    if (tr.dataset.shop != null) timesRpt.workshop = tr.dataset.shop;
    renderTimesReport();
  }));
  const clr = v.querySelector("#tr-clear");
  if (clr) clr.addEventListener("click", () => { timesRpt.worker = timesRpt.workshop = timesRpt.operation = timesRpt.machine = timesRpt.client = timesRpt.orderNo = timesRpt.code = ""; timesShowDetail = false; renderTimesReport(); });
  const sd = v.querySelector("#tr-showdetail");
  if (sd) sd.addEventListener("click", () => { timesShowDetail = true; renderTimesReport(); });
  const hd = v.querySelector("#tr-hidedetail");
  if (hd) hd.addEventListener("click", () => { timesShowDetail = false; renderTimesReport(); });
  v.querySelectorAll("[data-period]").forEach(b => b.addEventListener("click", () => { timesSetPeriod(b.dataset.period); renderTimesReport(); }));
  v.querySelectorAll("[data-trend]").forEach(b => b.addEventListener("click", () => { timesTrendMode = b.dataset.trend; renderTimesReport(); }));
  v.querySelectorAll("[data-anal]").forEach(b => b.addEventListener("click", () => { timesAnalysisMode = b.dataset.anal; renderTimesReport(); }));
  v.querySelector("#tr-csv").addEventListener("click", () => timesExportCsv(analysis, detailed, timesAnalysisMode));
  const trAll = v.querySelector("#tr-all"); if (trAll) trAll.addEventListener("click", timesUnifiedExport);
  v.querySelector("#tr-pdf").addEventListener("click", () => timesExportPdf(analysis, detailed, timesAnalysisMode));
}

/* ---------- Експорт (обща красива таблица — виж report-export.js) ---------- */
function timesSections(ops, detailed, mode) {
  const byDetail = mode === "detail";
  const dur = sec => sec == null ? "—" : fmtSecDur({ sec: Math.round(sec) });
  const opHeaders = [
    ...(byDetail ? [{ label: "Детайл (продукт)" }, { label: "Операция" }] : [{ label: "Операция" }]),
    { label: "Цех" }, { label: "Вписвания", num: true }, { label: "Общо бройки", num: true },
    { label: "Средно/брой", num: true }, { label: "Най-бързо", num: true }, { label: "Най-бавно", num: true },
  ];
  const opRows = ops.map(g => [
    ...(byDetail ? [g.detail, g.operation || "—"] : [g.operation]),
    g.workshop || "—", g.entries, g.pieces, dur(g.avg), dur(g.min), dur(g.max),
  ]);
  const detHeaders = [
    { label: "Дата" }, { label: "Цех" }, { label: "Машина" }, { label: "Заявка №" }, { label: "Клиент" }, { label: "Продукт" }, { label: "Код" },
    { label: "Операция" }, { label: "Служител" }, { label: "Брой", num: true }, { label: "За 1 брой", num: true },
    { label: "1 лист/прът", num: true }, { label: "Кол-во/поръчка", num: true }, { label: "Настройка", num: true }, { label: "Бележки" },
  ];
  const detRows = detailed.map(r => [
    fmtLogDate(r.date), r.workshop || "—", r.machine || "—", r.orderNo || "—", r.client || "СЕРИЯ", r.product || "—", r.code || "",
    r.operation || "—", r.worker || "—", r.qty, dur(timesPerPiece(r)),
    fmtSecDur(r.tSheet), fmtSecDur(r.tOrder), fmtSecDur(r.tSetup), r.notes || "",
  ]);
  return [
    { title: byDetail ? "Анализ по детайл (за ценообразуване)" : "Анализ по операция (за ценообразуване)", headers: opHeaders, rows: opRows },
    { title: "Подробни записи", headers: detHeaders, rows: detRows },
  ];
}
function timesExportCsv(ops, detailed, mode) {
  reportExportXls("otcheti-analiz", "ОТЧЕТИ — анализ на операциите", timesSections(ops, detailed, mode));
}
function timesExportPdf(ops, detailed, mode) {
  reportOpenView("ОТЧЕТИ — анализ на операциите", timesSections(ops, detailed, mode));
}


/* ---------- ⤓ Общ отчет: ден (детайлно) + седмица + месец (обобщено) ----------
   Един Excel файл с три секции. Ако модулът „Разходи и ставки" е зареден,
   добавя „Труд (ч)" и „Стойност труд (EUR)" = часове × пълната ставка на цеха
   (труд+машина+режийни) — връзката отчети ↔ себестойност. */
async function timesUnifiedExport() {
  const all = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  let R = null;
  try { if (typeof erpLoadCostCfg === "function" && typeof erpCostRates === "function") { await erpLoadCostCfg(); R = erpCostRates(); } } catch (e) { R = null; }
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const today = iso(new Date());
  const mon = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); })();
  const month = today.slice(0, 7);
  // Реално време на един запис: за поръчката (или 1 брой × бройката) + настройка.
  const secOf = r => ((r.tOrder && r.tOrder.sec) || ((r.tPiece && r.tPiece.sec) || 0) * (Number(r.qty) || 0)) + ((r.tSetup && r.tSetup.sec) || 0);
  const hFmt = sec => Math.round(sec / 36) / 100;                                  // часове, 2 знака
  const valOf = (sec, ws) => (R && R.rate && R.rate[ws]) ? Math.round(sec / 3600 * R.rate[ws].full * 100) / 100 : "";
  const n2 = x => x === "" ? "" : (Math.round(Number(x) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const dayRows = all.filter(r => r.date === today);
  const weekRows = all.filter(r => r.date >= mon && r.date <= today);
  const monthRows = all.filter(r => String(r.date).slice(0, 7) === month);
  const agg = (rows, keyFn, labelFns) => {
    const m = new Map();
    rows.forEach(r => {
      const k = keyFn(r);
      const cur = m.get(k) || { qty: 0, sec: 0, val: 0, cnt: 0, r };
      cur.qty += Number(r.qty) || 0; const sc = secOf(r); cur.sec += sc;
      const v = valOf(sc, r.workshop); if (v !== "") cur.val += v;
      cur.cnt++; m.set(k, cur);
    });
    return [...m.entries()].sort((a, b) => b[1].qty - a[1].qty)
      .map(([k, d]) => [...labelFns.map(f => f(d.r, k)), d.cnt, d.qty, hFmt(d.sec), R ? n2(d.val) : ""]);
  };
  const headAgg = extra => [...extra, { label: "Записи", num: true }, { label: "Бройки", num: true }, { label: "Труд (ч)", num: true }, { label: "Стойност труд EUR", num: true }];
  const sections = [
    {
      title: `ДНЕС ${today.slice(8, 10)}.${today.slice(5, 7)}.${today.slice(0, 4)} — детайлно`,
      headers: [{ label: "Цех" }, { label: "Служител" }, { label: "Клиент" }, { label: "Код" }, { label: "Продукт" }, { label: "Операция" }, { label: "Машина" }, { label: "Бройки", num: true }, { label: "Труд (ч)", num: true }, { label: "Стойност труд EUR", num: true }],
      rows: dayRows.map(r => [r.workshop, r.worker, r.client, r.code, r.product, r.operation, r.machine, r.qty, hFmt(secOf(r)), R ? n2(valOf(secOf(r), r.workshop)) : ""]),
    },
    {
      title: "ТАЗИ СЕДМИЦА — по служител",
      headers: headAgg([{ label: "Служител" }, { label: "Цех" }]),
      rows: agg(weekRows, r => (r.worker || "—") + "¦" + (r.workshop || ""), [r => r.worker || "—", r => r.workshop || ""]),
    },
    {
      title: "ТАЗИ СЕДМИЦА — по цех",
      headers: headAgg([{ label: "Цех" }]),
      rows: agg(weekRows, r => r.workshop || "—", [r => r.workshop || "—"]),
    },
    {
      title: `ТОЗИ МЕСЕЦ (${month}) — по служител`,
      headers: headAgg([{ label: "Служител" }, { label: "Цех" }]),
      rows: agg(monthRows, r => (r.worker || "—") + "¦" + (r.workshop || ""), [r => r.worker || "—", r => r.workshop || ""]),
    },
    {
      title: `ТОЗИ МЕСЕЦ (${month}) — по цех`,
      headers: headAgg([{ label: "Цех" }]),
      rows: agg(monthRows, r => r.workshop || "—", [r => r.workshop || "—"]),
    },
  ];
  if (!R) sections.forEach(sec => { sec.rows.forEach(row => row.pop()); sec.headers.pop(); });   // без ставки — без колоната
  reportExportXls("obsht-otchet", "Общ производствен отчет", sections);
}
