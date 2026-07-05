/* Данко Системс — „Производствен отчет".
   Обобщава произведеното по цехове от вписванията в задачите (task.logs).
   - бутон за всеки цех + „Общ отчет" (всички цехове за деня/периода);
   - период: Ден / Седмица / Месец, с избор на дата;
   - разбивка по служител и по изделие; при седмица/месец и по дни;
   - експорт в Excel (CSV) и PDF (през прозорец за печат).
   Ползва глобалните TASKS, workshopList, showSub, renderTasks, escapeHtml,
   fmtLogDate, loadPaintingReports от tasks.js/app.js. */

let prodRptMode = "day";     // day | week | month
let prodRptDate = "";        // избрана дата (ISO); празно = днес
let prodRptShop = "__all";   // __all | име на цех
let prodRptWorker = "";      // филтър по служител (празно = всички)

const PROD_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];

function prodIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prodToday() { return prodIso(new Date()); }

// Диапазон (from,to) + етикет според режима и датата.
function prodPeriodRange(mode, dateStr) {
  const base = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  if (mode === "week") {
    const dow = (base.getDay() + 6) % 7; // 0 = понеделник
    const mon = new Date(base); mon.setDate(base.getDate() - dow);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: prodIso(mon), to: prodIso(sun), label: `Седмица: ${fmtLogDate(prodIso(mon))} – ${fmtLogDate(prodIso(sun))}` };
  }
  if (mode === "month") {
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { from: prodIso(first), to: prodIso(last), label: `${PROD_MONTHS[base.getMonth()]} ${base.getFullYear()}` };
  }
  return { from: prodIso(base), to: prodIso(base), label: fmtLogDate(prodIso(base)) };
}

// Събиране на произведеното в периода (по избрания цех/служител).
function prodAggregate(from, to, shop, worker) {
  const byWorker = {}, byShop = {}, byItem = {}, byDay = {};
  let total = 0, entries = 0;
  (TASKS || []).forEach(t => {
    if (shop !== "__all" && t.workshop !== shop) return;
    (t.logs || []).forEach(l => {
      const d = (l.date || "").slice(0, 10);
      if (from && d < from) return;
      if (to && d > to) return;
      const w = l.worker || "(без име)";
      if (worker && w !== worker) return;
      const q = Number(l.qty) || 0;
      total += q; entries++;
      byWorker[w] = byWorker[w] || { qty: 0, cnt: 0, shop: t.workshop };
      byWorker[w].qty += q; byWorker[w].cnt++;
      byShop[t.workshop] = (byShop[t.workshop] || 0) + q;
      const key = [t.workshop, t.client || "", t.product || "", t.code || "", t.operation || ""].join("¦");
      byItem[key] = byItem[key] || { workshop: t.workshop, client: t.client || "", product: t.product || "", code: t.code || "", operation: t.operation || "", qty: 0 };
      byItem[key].qty += q;
      byDay[d] = (byDay[d] || 0) + q;
    });
  });
  return { byWorker, byShop, byItem, byDay, total, entries };
}

function prodPct(part, whole) { return whole > 0 ? Math.round(part / whole * 100) : 0; }

// Секунди за 1 брой от едно вписване (директно tPiece или tOrder/бройка).
function prodPerPiece(l) {
  if (l.tPiece && l.tPiece.sec) return l.tPiece.sec;
  if (l.tOrder && l.tOrder.sec && (Number(l.qty) || 0) > 0) return l.tOrder.sec / Number(l.qty);
  return null;
}
function prodDur(sec) { return sec == null ? "—" : (typeof fmtSecDur === "function" ? fmtSecDur({ sec: Math.round(sec) }) : Math.round(sec) + " сек"); }

// Подробните вписвания на един служител за периода (какво точно е произвел).
function prodWorkerEntries(from, to, shop, worker) {
  const out = [];
  (TASKS || []).forEach(t => {
    if (shop !== "__all" && t.workshop !== shop) return;
    (t.logs || []).forEach(l => {
      const d = (l.date || "").slice(0, 10);
      if (from && d < from) return;
      if (to && d > to) return;
      if ((l.worker || "(без име)") !== worker) return;
      out.push({ date: d, client: t.client || "", product: t.product || "", code: t.code || "", operation: t.operation || "", workshop: t.workshop || "", qty: Number(l.qty) || 0, machine: l.machine || "", perPiece: prodPerPiece(l) });
    });
  });
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return out;
}

/* ---------- Изглед ---------- */
function renderProdReport() {
  showSub("report");
  if (!prodRptDate) prodRptDate = prodToday();
  const v = document.getElementById("report-view");
  const shops = (typeof workshopList === "function") ? workshopList() : [];
  const modeBtn = (m, lbl) => `<button class="btn btn-small ${prodRptMode === m ? "btn-primary" : ""}" data-mode="${m}">${lbl}</button>`;
  const shopChip = (val, lbl) => `<button class="btn btn-small ${prodRptShop === val ? "btn-primary" : ""}" data-shop="${escapeAttr(val)}">${escapeHtml(lbl)}</button>`;
  // Служители за филтъра (от всички цехове или от избрания).
  const workerNames = prodRptShop === "__all"
    ? [...new Set(Object.values(WORKERS || {}).flat())].sort((a, b) => a.localeCompare(b, "bg"))
    : ((WORKERS && WORKERS[prodRptShop]) || []).slice().sort((a, b) => a.localeCompare(b, "bg"));

  v.innerHTML = `
    <div class="workers-head"><h3>📊 Производствен отчет</h3>
      <button id="pr-back" class="btn btn-small">← Назад</button></div>
    <div class="pr-controls">
      <div class="pr-row"><span class="pr-lbl">Период:</span>${modeBtn("day", "Ден")}${modeBtn("week", "Седмица")}${modeBtn("month", "Месец")}
        <input type="date" id="pr-date" value="${escapeAttr(prodRptDate)}" />
        <span class="spacer"></span>
        <button id="pr-csv" class="btn btn-small">⤓ Excel</button>
        <button id="pr-pdf" class="btn btn-small">🖨 PDF</button>
      </div>
      <div class="pr-row pr-shops"><span class="pr-lbl">Цех:</span>${shopChip("__all", "🏭 Общ отчет")}${shops.map(s => shopChip(s, s)).join("")}</div>
      <div class="pr-row"><span class="pr-lbl">Служител:</span>
        <select id="pr-worker"><option value="">Всички</option>${workerNames.map(n => `<option ${n === prodRptWorker ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select></div>
    </div>
    <div id="pr-out"></div>
    <div id="painting-reports"></div>`;

  v.querySelector("#pr-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  v.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { prodRptMode = b.dataset.mode; renderProdReport(); }));
  v.querySelectorAll("[data-shop]").forEach(b => b.addEventListener("click", () => { prodRptShop = b.dataset.shop; prodRptWorker = ""; renderProdReport(); }));
  v.querySelector("#pr-date").addEventListener("change", e => { prodRptDate = e.target.value || prodToday(); renderProdReport(); });
  v.querySelector("#pr-worker").addEventListener("change", e => { prodRptWorker = e.target.value; prodComputeAndRender(); });
  v.querySelector("#pr-csv").addEventListener("click", prodExportCsv);
  v.querySelector("#pr-pdf").addEventListener("click", prodExportPdf);
  prodComputeAndRender();
  if (typeof loadPaintingReports === "function") loadPaintingReports();
}

function prodComputeAndRender() {
  const { from, to, label } = prodPeriodRange(prodRptMode, prodRptDate);
  const agg = prodAggregate(from, to, prodRptShop, prodRptWorker);
  const out = document.getElementById("pr-out");
  if (!out) return;
  const scope = prodRptShop === "__all" ? "Всички цехове" : "Цех " + prodRptShop;
  const head = `<div class="pr-summary"><b>${escapeHtml(scope)}</b> · ${escapeHtml(label)} ·
      Общо произведено: <b>${agg.total}</b> бр. <span class="muted">(${agg.entries} вписвания)</span>${prodRptWorker ? ` · служител: <b>${escapeHtml(prodRptWorker)}</b>` : ""}</div>`;

  const multiDay = prodRptMode !== "day";
  let html = head;

  if (prodRptShop === "__all") {
    // По цехове
    const sRows = Object.entries(agg.byShop).sort((a, b) => b[1] - a[1]);
    html += `<h4>По цехове</h4>
      <table class="report-table pr-table"><thead><tr><th>Цех</th><th class="num">Произведено</th><th class="num">Дял</th></tr></thead>
      <tbody>${sRows.map(([s, q]) => `<tr><td>${escapeHtml(s)}</td><td class="num">${q}</td><td class="num">${prodPct(q, agg.total)}%</td></tr>`).join("")
        || `<tr><td colspan="3" class="report-empty">Няма данни за периода.</td></tr>`}
      ${sRows.length ? `<tr class="pr-total"><td><b>Всичко</b></td><td class="num"><b>${agg.total}</b></td><td class="num">100%</td></tr>` : ""}</tbody></table>`;
  }

  // По служител (кликаемо → детайли какво е произвел)
  const wRows = Object.entries(agg.byWorker).sort((a, b) => b[1].qty - a[1].qty);
  html += `<h4>По служител <span class="pr-hint">(натисни име за детайли)</span></h4>
    <table class="report-table pr-table"><thead><tr><th>Служител</th><th>Цех</th><th class="num">Произведено</th><th class="num">Вписвания</th><th class="num">Дял</th></tr></thead>
    <tbody>${wRows.map(([w, d]) => `<tr class="pr-clickable ${w === prodRptWorker ? "pr-sel" : ""}" data-worker="${escapeAttr(w)}" title="Виж какво е произвел"><td><b>${escapeHtml(w)}</b></td><td>${escapeHtml(d.shop)}</td><td class="num">${d.qty}</td><td class="num">${d.cnt}</td><td class="num">${prodPct(d.qty, agg.total)}%</td></tr>`).join("")
      || `<tr><td colspan="5" class="report-empty">Няма данни за периода.</td></tr>`}</tbody></table>`;

  // По изделие
  const iRows = Object.values(agg.byItem).sort((a, b) => b.qty - a.qty);
  html += `<h4>По изделие</h4>
    <table class="report-table pr-table"><thead><tr>${prodRptShop === "__all" ? "<th>Цех</th>" : ""}<th>Клиент</th><th>Продукт</th><th>Код</th><th>Операция</th><th class="num">Произведено</th></tr></thead>
    <tbody>${iRows.map(r => `<tr>${prodRptShop === "__all" ? `<td>${escapeHtml(r.workshop)}</td>` : ""}<td>${r.client ? escapeHtml(r.client) : '<span class="serie">СЕРИЯ</span>'}</td><td>${escapeHtml(r.product) || "—"}</td><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.operation) || "—"}</td><td class="num">${r.qty}</td></tr>`).join("")
      || `<tr><td colspan="${prodRptShop === "__all" ? 6 : 5}" class="report-empty">Няма данни за периода.</td></tr>`}</tbody></table>`;

  // По дни (само за седмица/месец)
  if (multiDay) {
    const dRows = Object.entries(agg.byDay).sort((a, b) => a[0].localeCompare(b[0]));
    html += `<h4>По дни</h4>
      <table class="report-table pr-table"><thead><tr><th>Дата</th><th class="num">Произведено</th></tr></thead>
      <tbody>${dRows.map(([d, q]) => `<tr><td>${escapeHtml(fmtLogDate(d))}</td><td class="num">${q}</td></tr>`).join("")
        || `<tr><td colspan="2" class="report-empty">Няма данни за периода.</td></tr>`}</tbody></table>`;
  }

  // Подробно за избрания служител — какво точно е произвел.
  if (prodRptWorker) {
    const entries = prodWorkerEntries(from, to, prodRptShop, prodRptWorker);
    const eTotal = entries.reduce((s, e) => s + e.qty, 0);
    html += `<div class="pr-row" style="margin:12px 0 0"><button class="btn btn-small" id="pr-all-workers">← Всички служители</button></div>
      <h4>🔍 Подробно — ${escapeHtml(prodRptWorker)} · ${eTotal} бр. (${entries.length} вписвания)</h4>
      <table class="report-table pr-table"><thead><tr><th>Дата</th><th>Клиент</th><th>Продукт</th><th>Код</th><th>Операция</th><th>Цех</th><th class="num">Брой</th><th>Машина</th><th class="num">Време/бр.</th></tr></thead>
      <tbody>${entries.map(e => `<tr>
        <td>${escapeHtml(fmtLogDate(e.date))}</td>
        <td>${e.client ? escapeHtml(e.client) : '<span class="serie">СЕРИЯ</span>'}</td>
        <td>${escapeHtml(e.product) || "—"}</td><td>${escapeHtml(e.code)}</td>
        <td>${escapeHtml(e.operation) || "—"}</td><td>${escapeHtml(e.workshop)}</td>
        <td class="num">${e.qty}</td><td>${escapeHtml(e.machine) || "—"}</td><td class="num">${prodDur(e.perPiece)}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="report-empty">Няма вписвания за периода.</td></tr>`}</tbody></table>`;
  }

  out.innerHTML = html;
  out.querySelectorAll("[data-worker]").forEach(el => el.addEventListener("click", () => { prodRptWorker = el.dataset.worker; renderProdReport(); }));
  const allW = out.querySelector("#pr-all-workers");
  if (allW) allW.addEventListener("click", () => { prodRptWorker = ""; renderProdReport(); });
}

/* ---------- Експорт ---------- */
function prodExportCsv() {
  const { from, to, label } = prodPeriodRange(prodRptMode, prodRptDate);
  const agg = prodAggregate(from, to, prodRptShop, prodRptWorker);
  const esc = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const lines = [];
  lines.push([esc("Производствен отчет"), esc(prodRptShop === "__all" ? "Всички цехове" : prodRptShop), esc(label)].join(","));
  lines.push("");
  if (prodRptShop === "__all") {
    lines.push([esc("По цехове"), esc("Произведено"), esc("Дял %")].join(","));
    Object.entries(agg.byShop).sort((a, b) => b[1] - a[1]).forEach(([s, q]) => lines.push([esc(s), esc(q), esc(prodPct(q, agg.total))].join(",")));
    lines.push([esc("Всичко"), esc(agg.total), esc(100)].join(","));
    lines.push("");
  }
  lines.push([esc("Служител"), esc("Цех"), esc("Произведено"), esc("Вписвания"), esc("Дял %")].join(","));
  Object.entries(agg.byWorker).sort((a, b) => b[1].qty - a[1].qty).forEach(([w, d]) => lines.push([esc(w), esc(d.shop), esc(d.qty), esc(d.cnt), esc(prodPct(d.qty, agg.total))].join(",")));
  lines.push("");
  lines.push([esc("Цех"), esc("Клиент"), esc("Продукт"), esc("Код"), esc("Операция"), esc("Произведено")].join(","));
  Object.values(agg.byItem).sort((a, b) => b.qty - a.qty).forEach(r => lines.push([esc(r.workshop), esc(r.client), esc(r.product), esc(r.code), esc(r.operation), esc(r.qty)].join(",")));

  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `proizvodstven-otchet-${from}${from !== to ? "_" + to : ""}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function prodExportPdf() {
  const { from, to, label } = prodPeriodRange(prodRptMode, prodRptDate);
  const agg = prodAggregate(from, to, prodRptShop, prodRptWorker);
  const scope = prodRptShop === "__all" ? "Всички цехове" : "Цех " + prodRptShop;
  const esc = s => escapeHtml(String(s == null ? "" : s));
  const sSection = prodRptShop === "__all" ? `
    <h3>По цехове</h3>
    <table><thead><tr><th>Цех</th><th class="r">Произведено</th><th class="r">Дял</th></tr></thead><tbody>
    ${Object.entries(agg.byShop).sort((a, b) => b[1] - a[1]).map(([s, q]) => `<tr><td>${esc(s)}</td><td class="r">${q}</td><td class="r">${prodPct(q, agg.total)}%</td></tr>`).join("")}
    <tr class="tot"><td><b>Всичко</b></td><td class="r"><b>${agg.total}</b></td><td class="r">100%</td></tr>
    </tbody></table>` : "";
  const wSection = `
    <h3>По служител</h3>
    <table><thead><tr><th>Служител</th><th>Цех</th><th class="r">Произведено</th><th class="r">Вписвания</th></tr></thead><tbody>
    ${Object.entries(agg.byWorker).sort((a, b) => b[1].qty - a[1].qty).map(([w, d]) => `<tr><td>${esc(w)}</td><td>${esc(d.shop)}</td><td class="r">${d.qty}</td><td class="r">${d.cnt}</td></tr>`).join("") || `<tr><td colspan="4" class="c">няма данни</td></tr>`}
    </tbody></table>`;
  const iSection = `
    <h3>По изделие</h3>
    <table><thead><tr><th>Цех</th><th>Клиент</th><th>Продукт</th><th>Код</th><th>Операция</th><th class="r">Произведено</th></tr></thead><tbody>
    ${Object.values(agg.byItem).sort((a, b) => b.qty - a.qty).map(r => `<tr><td>${esc(r.workshop)}</td><td>${esc(r.client) || "СЕРИЯ"}</td><td>${esc(r.product) || "—"}</td><td>${esc(r.code)}</td><td>${esc(r.operation) || "—"}</td><td class="r">${r.qty}</td></tr>`).join("") || `<tr><td colspan="6" class="c">няма данни</td></tr>`}
    </tbody></table>`;
  const dSection = prodRptMode !== "day" ? `
    <h3>По дни</h3>
    <table><thead><tr><th>Дата</th><th class="r">Произведено</th></tr></thead><tbody>
    ${Object.entries(agg.byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([d, q]) => `<tr><td>${esc(fmtLogDate(d))}</td><td class="r">${q}</td></tr>`).join("")}
    </tbody></table>` : "";

  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Производствен отчет — ${esc(label)}</title>
  <style>
    *{box-sizing:border-box}body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 20px}
    .head{border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:10px}
    .head h1{font-size:20px;margin:0;color:#0f766e}.head .sub{color:#444;margin-top:3px}
    h3{font-size:13px;margin:16px 0 4px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}
    th,td{border:1px solid #cbd5e1;padding:4px 7px;font-size:11.5px;text-align:left}
    th{background:#ecfdf5;color:#065f46}td.r,th.r{text-align:right}td.c{text-align:center;color:#777}
    tr.tot td{background:#f0fdfa;font-weight:bold}
    @media print{body{margin:8mm}.noprint{display:none}}
    .noprint{text-align:center;margin:12px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат / Запази като PDF</button></div>
    <div class="head"><h1>ПРОИЗВОДСТВЕН ОТЧЕТ</h1>
      <div class="sub"><b>${esc(scope)}</b> · ${esc(label)} · Общо: <b>${agg.total}</b> бр. (${agg.entries} вписвания)${prodRptWorker ? " · служител: " + esc(prodRptWorker) : ""}</div></div>
    ${sSection}${wSection}${iSection}${dSection}
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
