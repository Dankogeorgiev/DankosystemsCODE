/* Данко Системс — „ОТЧЕТИ" (анализ на времената и на изработеното).
   Тук се събират всички отчети — целта е яснота: кой какво е направил и за колко.
   - обобщение по служител и по цех (компактно, натисни за филтър);
   - анализ по операция: средно/най-бързо/най-бавно време за 1 брой (за ценообразуване);
   - подробни записи (скрити по подразбиране — излизат при избран филтър);
   - филтри по служител/цех/операция/машина и период (от–до);
   - експорт в Excel (CSV) и PDF.
   Ползва collectTimeRows/fmtSecDur/fmtLogDate/logNotes от tasks.js. */

let timesRpt = { workshop: "", operation: "", machine: "", worker: "", from: "", to: "" };
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

function timesRptRows() {
  const all = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const f = timesRpt;
  return all.filter(r => {
    if (f.workshop && r.workshop !== f.workshop) return false;
    if (f.operation && r.operation !== f.operation) return false;
    if (f.machine && r.machine !== f.machine) return false;
    if (f.worker && r.worker !== f.worker) return false;
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

/* ---------- Изглед ---------- */
function renderTimesReport() {
  showSub("times");
  const v = document.getElementById("times-view");
  const all = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const uniq = key => [...new Set(all.map(r => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "bg"));
  const f = timesRpt;
  const sel = (id, cur, list, label) => `<label>${label} <select id="${id}"><option value="">Всички</option>${list.map(x => `<option ${x === cur ? "selected" : ""}>${escapeHtml(x)}</option>`).join("")}</select></label>`;

  const rows = timesRptRows();
  const analysis = timesAnalysisMode === "detail" ? timesByDetail(rows) : timesByOperation(rows);
  const byWorker = timesGroupBy(rows, "worker");
  const byShop = timesGroupBy(rows, "workshop");
  const trend = timesTrend(rows, timesTrendMode);
  const detailed = rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const hasFilter = !!(f.worker || f.workshop || f.operation || f.machine);
  const showDetail = hasFilter || timesShowDetail;

  const emptyRow = n => `<tr><td colspan="${n}" class="report-empty">Няма данни за този филтър.</td></tr>`;
  const flabel = [f.worker, f.workshop, f.operation, f.machine].filter(Boolean).join(" · ");

  v.innerHTML = `
    <div class="workers-head"><h3>📋 ОТЧЕТИ — какво е направено и за колко време</h3>
      <button id="tr-back" class="btn btn-small">← Назад</button></div>
    <div class="times-filters">
      ${sel("tr-w", f.worker, uniq("worker"), "👤 Служител")}
      ${sel("tr-ws", f.workshop, uniq("workshop"), "🏭 Цех")}
      ${sel("tr-op", f.operation, uniq("operation"), "Операция")}
      ${sel("tr-m", f.machine, uniq("machine"), "Машина")}
      <label>От <input type="date" id="tr-from" value="${escapeAttr(f.from)}" /></label>
      <label>До <input type="date" id="tr-to" value="${escapeAttr(f.to)}" /></label>
      ${hasFilter ? `<button id="tr-clear" class="btn btn-small">✕ Изчисти филтъра</button>` : ""}
      <span class="spacer"></span>
      <span class="muted times-count">${detailed.length} записа</span>
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

    ${showDetail ? `
      <div class="times-detail-head">
        <h4 style="margin:18px 0 4px">Подробни записи${flabel ? ` — <span class="times-flabel">${escapeHtml(flabel)}</span>` : ""} <span class="muted">(${detailed.length})</span></h4>
        ${!hasFilter ? `<button id="tr-hidedetail" class="btn btn-small">Скрий подробните</button>` : ""}
      </div>
      <table class="report-table times-table">
        <thead><tr><th>Дата</th><th>Цех</th><th>Машина</th><th>Клиент</th><th>Продукт</th><th>Операция</th><th>Служител</th>
          <th class="num">Брой</th><th class="num">За 1 брой</th><th>1 лист/прът</th><th>Кол-во/поръчка</th><th>Настройка</th><th>Бележки</th></tr></thead>
        <tbody>${detailed.map(r => `<tr>
          <td>${escapeHtml(fmtLogDate(r.date))}</td><td>${escapeHtml(r.workshop) || "—"}</td><td>${escapeHtml(r.machine) || "—"}</td>
          <td>${r.client ? escapeHtml(r.client) : `<span class="serie">СЕРИЯ</span>`}</td>
          <td>${escapeHtml(r.product) || "—"}${r.code ? `<div class="t-code">${escapeHtml(r.code)}</div>` : ""}</td>
          <td>${escapeHtml(r.operation) || "—"}</td><td>${escapeHtml(r.worker) || "—"}</td>
          <td class="num">${r.qty}</td><td class="num">${timesDur(timesPerPiece(r))}</td>
          <td>${escapeHtml(fmtSecDur(r.tSheet))}</td><td>${escapeHtml(fmtSecDur(r.tOrder))}</td><td>${escapeHtml(fmtSecDur(r.tSetup))}</td>
          <td class="times-cons">${r.notes ? escapeHtml(r.notes) : "—"}</td>
        </tr>`).join("") || `<tr><td colspan="13" class="report-empty">Няма записи за този филтър.</td></tr>`}</tbody>
      </table>
    ` : `
      <div class="times-detail-hint">
        <p class="muted">Има <b>${detailed.length}</b> подробни записа. Изберете <b>служител</b> или <b>цех</b> отгоре (или натиснете ред в таблиците), за да видите точно техните записи.</p>
        <button id="tr-showdetail" class="btn btn-small">Покажи всички подробни записи</button>
      </div>
    `}`;

  v.querySelector("#tr-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  const bind = (id, key) => { const el = v.querySelector("#" + id); if (el) el.addEventListener("change", e => { timesRpt[key] = e.target.value; renderTimesReport(); }); };
  bind("tr-ws", "workshop"); bind("tr-op", "operation"); bind("tr-m", "machine"); bind("tr-w", "worker"); bind("tr-from", "from"); bind("tr-to", "to");
  v.querySelectorAll(".times-click").forEach(tr => tr.addEventListener("click", () => {
    if (tr.dataset.w != null) timesRpt.worker = tr.dataset.w;
    if (tr.dataset.shop != null) timesRpt.workshop = tr.dataset.shop;
    renderTimesReport();
  }));
  const clr = v.querySelector("#tr-clear");
  if (clr) clr.addEventListener("click", () => { timesRpt.worker = timesRpt.workshop = timesRpt.operation = timesRpt.machine = ""; timesShowDetail = false; renderTimesReport(); });
  const sd = v.querySelector("#tr-showdetail");
  if (sd) sd.addEventListener("click", () => { timesShowDetail = true; renderTimesReport(); });
  const hd = v.querySelector("#tr-hidedetail");
  if (hd) hd.addEventListener("click", () => { timesShowDetail = false; renderTimesReport(); });
  v.querySelectorAll("[data-period]").forEach(b => b.addEventListener("click", () => { timesSetPeriod(b.dataset.period); renderTimesReport(); }));
  v.querySelectorAll("[data-trend]").forEach(b => b.addEventListener("click", () => { timesTrendMode = b.dataset.trend; renderTimesReport(); }));
  v.querySelectorAll("[data-anal]").forEach(b => b.addEventListener("click", () => { timesAnalysisMode = b.dataset.anal; renderTimesReport(); }));
  v.querySelector("#tr-csv").addEventListener("click", () => timesExportCsv(analysis, detailed, timesAnalysisMode));
  v.querySelector("#tr-pdf").addEventListener("click", () => timesExportPdf(analysis, detailed, timesAnalysisMode));
}

/* ---------- Експорт ---------- */
function timesExportCsv(ops, detailed, mode) {
  const esc = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const secTxt = sec => sec == null ? "" : Math.round(sec);
  const byDetail = mode === "detail";
  const lines = [];
  lines.push([esc(byDetail ? "Анализ по детайл" : "Анализ по операция")].join(","));
  lines.push([...(byDetail ? ["Детайл", "Операция"] : ["Операция"]), "Цех", "Вписвания", "Общо бройки", "Средно/брой (сек)", "Най-бързо/брой (сек)", "Най-бавно/брой (сек)"].map(esc).join(","));
  ops.forEach(g => lines.push([...(byDetail ? [g.detail, g.operation] : [g.operation]), g.workshop, g.entries, g.pieces, secTxt(g.avg), secTxt(g.min), secTxt(g.max)].map(esc).join(",")));
  lines.push("");
  lines.push([esc("Подробни записи")].join(","));
  lines.push(["Дата", "Цех", "Машина", "Клиент", "Продукт", "Код", "Операция", "Служител", "Брой", "За 1 брой (сек)", "1 лист (сек)", "Кол-во/поръчка (сек)", "Настройка (сек)", "Бележки"].map(esc).join(","));
  detailed.forEach(r => lines.push([
    fmtLogDate(r.date), r.workshop, r.machine, r.client, r.product, r.code, r.operation, r.worker, r.qty,
    secTxt(timesPerPiece(r)), (r.tSheet && r.tSheet.sec) || "", (r.tOrder && r.tOrder.sec) || "", (r.tSetup && r.tSetup.sec) || "", r.notes || "",
  ].map(esc).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "otcheti-analiz.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function timesExportPdf(ops, detailed, mode) {
  const esc = s => escapeHtml(String(s == null ? "" : s));
  const dur = sec => sec == null ? "—" : fmtSecDur({ sec: Math.round(sec) });
  const byDetail = mode === "detail";
  const opCols = byDetail ? 8 : 7;
  const opRows = ops.map(g => `<tr>${byDetail ? `<td>${esc(g.detail)}</td><td>${esc(g.operation) || "—"}</td>` : `<td>${esc(g.operation)}</td>`}<td>${esc(g.workshop) || "—"}</td><td class="r">${g.entries}</td><td class="r">${g.pieces}</td><td class="r">${dur(g.avg)}</td><td class="r">${dur(g.min)}</td><td class="r">${dur(g.max)}</td></tr>`).join("") || `<tr><td colspan="${opCols}" class="c">няма данни</td></tr>`;
  const detRows = detailed.map(r => `<tr><td>${esc(fmtLogDate(r.date))}</td><td>${esc(r.workshop) || "—"}</td><td>${esc(r.machine) || "—"}</td><td>${esc(r.product) || "—"}${r.code ? " (" + esc(r.code) + ")" : ""}</td><td>${esc(r.operation) || "—"}</td><td>${esc(r.worker) || "—"}</td><td class="r">${r.qty}</td><td class="r">${dur(timesPerPiece(r))}</td></tr>`).join("") || `<tr><td colspan="8" class="c">няма данни</td></tr>`;
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Отчети — анализ</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 20px}
    .head{border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:10px}.head h1{font-size:20px;margin:0;color:#0f766e}
    h3{font-size:13px;margin:16px 0 4px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}
    th,td{border:1px solid #cbd5e1;padding:4px 7px;font-size:11px;text-align:left}
    th{background:#ecfdf5;color:#065f46}td.r,th.r{text-align:right}td.c{text-align:center;color:#777}
    @media print{body{margin:8mm}.noprint{display:none}}
    .noprint{text-align:center;margin:12px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат / Запази като PDF</button></div>
    <div class="head"><h1>ОТЧЕТИ — анализ на операциите</h1></div>
    <h3>${byDetail ? "Анализ по детайл" : "Анализ по операция"} (за ценообразуване)</h3>
    <table><thead><tr>${byDetail ? `<th>Детайл (продукт)</th><th>Операция</th>` : `<th>Операция</th>`}<th>Цех</th><th class="r">Вписвания</th><th class="r">Общо бройки</th><th class="r">Средно/брой</th><th class="r">Най-бързо</th><th class="r">Най-бавно</th></tr></thead><tbody>${opRows}</tbody></table>
    <h3>Подробни записи</h3>
    <table><thead><tr><th>Дата</th><th>Цех</th><th>Машина</th><th>Продукт</th><th>Операция</th><th>Служител</th><th class="r">Брой</th><th class="r">За 1 брой</th></tr></thead><tbody>${detRows}</tbody></table>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
