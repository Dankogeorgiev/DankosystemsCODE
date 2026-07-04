/* Данко Системс — „Времена" (анализ на времената за операциите).
   Целта е ценообразуване: коя операция за колко време се извършва.
   - анализ по операция: средно/най-бързо/най-бавно време за 1 брой, общо бройки;
   - подробни записи (всяко отчитане с машина/време);
   - филтри по цех/операция/машина/служител и период (от–до);
   - експорт в Excel (CSV) и PDF.
   Ползва collectTimeRows/fmtSecDur/fmtLogDate/logNotes от tasks.js. */

let timesRpt = { workshop: "", operation: "", machine: "", worker: "", from: "", to: "" };

// Секунди за 1 брой от едно вписване (директно tPiece, или tOrder/бройка).
function timesPerPiece(r) {
  if (r.tPiece && r.tPiece.sec) return r.tPiece.sec;
  if (r.tOrder && r.tOrder.sec && (Number(r.qty) || 0) > 0) return r.tOrder.sec / Number(r.qty);
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

function timesDur(sec) {
  return (sec == null) ? "—" : fmtSecDur({ sec: Math.round(sec) });
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
  const ops = timesByOperation(rows);
  const detailed = rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  v.innerHTML = `
    <div class="workers-head"><h3>⏱ Времена — анализ за ценообразуване</h3>
      <button id="tr-back" class="btn btn-small">← Назад</button></div>
    <div class="times-filters">
      ${sel("tr-ws", f.workshop, uniq("workshop"), "Цех")}
      ${sel("tr-op", f.operation, uniq("operation"), "Операция")}
      ${sel("tr-m", f.machine, uniq("machine"), "Машина")}
      ${sel("tr-w", f.worker, uniq("worker"), "Служител")}
      <label>От <input type="date" id="tr-from" value="${escapeAttr(f.from)}" /></label>
      <label>До <input type="date" id="tr-to" value="${escapeAttr(f.to)}" /></label>
      <span class="spacer"></span>
      <span class="muted times-count">${detailed.length} записа</span>
      <button id="tr-csv" class="btn btn-small">⤓ Excel</button>
      <button id="tr-pdf" class="btn btn-small">🖨 PDF</button>
    </div>

    <h4>Анализ по операция</h4>
    <table class="report-table times-table">
      <thead><tr><th>Операция</th><th>Цех</th><th class="num">Вписвания</th><th class="num">Общо бройки</th><th class="num">Средно/брой</th><th class="num">Най-бързо/брой</th><th class="num">Най-бавно/брой</th></tr></thead>
      <tbody>${ops.map(g => `<tr>
        <td><b>${escapeHtml(g.operation)}</b></td><td>${escapeHtml(g.workshop) || "—"}</td>
        <td class="num">${g.entries}</td><td class="num">${g.pieces}</td>
        <td class="num">${timesDur(g.avg)}</td><td class="num">${timesDur(g.min)}</td><td class="num">${timesDur(g.max)}</td>
      </tr>`).join("") || `<tr><td colspan="7" class="report-empty">Няма времена за този филтър.</td></tr>`}</tbody>
    </table>

    <h4 style="margin-top:18px">Подробни записи</h4>
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
    </table>`;

  v.querySelector("#tr-back").addEventListener("click", () => { showSub("tasks"); renderTasks(); });
  const bind = (id, key) => { const el = v.querySelector("#" + id); if (el) el.addEventListener("change", e => { timesRpt[key] = e.target.value; renderTimesReport(); }); };
  bind("tr-ws", "workshop"); bind("tr-op", "operation"); bind("tr-m", "machine"); bind("tr-w", "worker"); bind("tr-from", "from"); bind("tr-to", "to");
  v.querySelector("#tr-csv").addEventListener("click", () => timesExportCsv(ops, detailed));
  v.querySelector("#tr-pdf").addEventListener("click", () => timesExportPdf(ops, detailed));
}

/* ---------- Експорт ---------- */
function timesExportCsv(ops, detailed) {
  const esc = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const secTxt = sec => sec == null ? "" : Math.round(sec);
  const lines = [];
  lines.push([esc("Анализ по операция")].join(","));
  lines.push(["Операция", "Цех", "Вписвания", "Общо бройки", "Средно/брой (сек)", "Най-бързо/брой (сек)", "Най-бавно/брой (сек)"].map(esc).join(","));
  ops.forEach(g => lines.push([g.operation, g.workshop, g.entries, g.pieces, secTxt(g.avg), secTxt(g.min), secTxt(g.max)].map(esc).join(",")));
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
  a.download = "vremena-analiz.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function timesExportPdf(ops, detailed) {
  const esc = s => escapeHtml(String(s == null ? "" : s));
  const dur = sec => sec == null ? "—" : fmtSecDur({ sec: Math.round(sec) });
  const opRows = ops.map(g => `<tr><td>${esc(g.operation)}</td><td>${esc(g.workshop) || "—"}</td><td class="r">${g.entries}</td><td class="r">${g.pieces}</td><td class="r">${dur(g.avg)}</td><td class="r">${dur(g.min)}</td><td class="r">${dur(g.max)}</td></tr>`).join("") || `<tr><td colspan="7" class="c">няма данни</td></tr>`;
  const detRows = detailed.map(r => `<tr><td>${esc(fmtLogDate(r.date))}</td><td>${esc(r.workshop) || "—"}</td><td>${esc(r.machine) || "—"}</td><td>${esc(r.product) || "—"}${r.code ? " (" + esc(r.code) + ")" : ""}</td><td>${esc(r.operation) || "—"}</td><td>${esc(r.worker) || "—"}</td><td class="r">${r.qty}</td><td class="r">${dur(timesPerPiece(r))}</td></tr>`).join("") || `<tr><td colspan="8" class="c">няма данни</td></tr>`;
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Времена — анализ</title>
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
    <div class="head"><h1>ВРЕМЕНА — анализ на операциите</h1></div>
    <h3>Анализ по операция (за ценообразуване)</h3>
    <table><thead><tr><th>Операция</th><th>Цех</th><th class="r">Вписвания</th><th class="r">Общо бройки</th><th class="r">Средно/брой</th><th class="r">Най-бързо</th><th class="r">Най-бавно</th></tr></thead><tbody>${opRows}</tbody></table>
    <h3>Подробни записи</h3>
    <table><thead><tr><th>Дата</th><th>Цех</th><th>Машина</th><th>Продукт</th><th>Операция</th><th>Служител</th><th class="r">Брой</th><th class="r">За 1 брой</th></tr></thead><tbody>${detRows}</tbody></table>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
