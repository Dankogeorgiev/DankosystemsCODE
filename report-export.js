/* Данко Системс — общ красив експорт на репорти.
   Цветна таблица, без кавички. Ползва се от ВСИЧКИ репорти.
   sections: [{ title?, headers: [{label, num?}], rows: [[cell, ...], ...] }]
   • reportExportXls(filename, title, sections) → сваля .xls, отваря се ЦВЕТНО в Excel
   • reportOpenView(title, sections)          → нов таб за преглед и печат/PDF */
(function () {
  function esc(s) { return (typeof escapeHtml === "function") ? escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  // Таблиците за .xls (Excel чете HTML): цветовете и подравняването са inline,
  // за да ги зачете Excel. Текстовите клетки са форматирани като текст, за да не
  // разваля Excel дълги кодове/размери (напр. „40 х 40" или „103379").
  function xlsTables(sections) {
    return (sections || []).map(sec => {
      const H = sec.headers || [];
      const thead = `<tr>${H.map(h => `<th style="background:#0f766e;color:#ffffff;border:1px solid #0b5c55;padding:6px 10px;text-align:${h.num ? "right" : "left"};font-weight:bold">${esc(h.label)}</th>`).join("")}</tr>`;
      const body = (sec.rows || []).map((r, i) => {
        const bg = i % 2 ? "#eafaf6" : "#ffffff";
        return `<tr>${r.map((c, j) => {
          const num = H[j] && H[j].num;
          const fmt = num ? "" : "mso-number-format:'\\@';";
          return `<td style="background:${bg};border:1px solid #cbd5e1;padding:5px 10px;text-align:${num ? "right" : "left"};${fmt}">${esc(c)}</td>`;
        }).join("")}</tr>`;
      }).join("") || `<tr><td colspan="${H.length || 1}" style="border:1px solid #cbd5e1;padding:6px;text-align:center;color:#777">няма данни</td></tr>`;
      return `${sec.title ? `<h3 style="font-family:Arial;color:#0f766e;margin:14px 0 6px">${esc(sec.title)}</h3>` : ""}<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-family:Arial;font-size:12px">${thead}${body}</table><br/>`;
    }).join("");
  }

  window.reportExportXls = function (filename, title, sections) {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body>`
      + (title ? `<h2 style="font-family:Arial;color:#0f766e;margin:0 0 8px">${esc(title)}</h2>` : "")
      + xlsTables(sections) + `</body></html>`;
    const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = /\.xls$/i.test(filename) ? filename : filename + ".xls";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  function screenTables(sections) {
    return (sections || []).map(sec => {
      const H = sec.headers || [];
      const thead = `<tr>${H.map(h => `<th class="${h.num ? "num" : ""}">${esc(h.label)}</th>`).join("")}</tr>`;
      const body = (sec.rows || []).map(r => `<tr>${r.map((c, j) => `<td class="${(H[j] && H[j].num) ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")
        || `<tr><td colspan="${H.length || 1}" class="empty">няма данни</td></tr>`;
      return `${sec.title ? `<h3>${esc(sec.title)}</h3>` : ""}<div class="tw"><table><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
    }).join("");
  }

  window.reportOpenView = function (title, sections) {
    const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>${esc(title || "Репорт")}</title>
<style>
  *{box-sizing:border-box}body{font-family:Arial,"DejaVu Sans",sans-serif;margin:16px 20px;color:#111;font-size:12px}
  h1{color:#0f766e;font-size:20px;margin:0 0 10px;border-bottom:2px solid #0f766e;padding-bottom:6px}
  h3{color:#0f766e;font-size:14px;margin:16px 0 6px}
  .tw{overflow-x:auto}
  table{border-collapse:collapse;width:100%;margin-bottom:6px}
  th{background:#0f766e;color:#fff;padding:7px 10px;text-align:left;font-size:12px;border:1px solid #0b5c55;white-space:nowrap}
  td{padding:6px 10px;border:1px solid #cbd5e1;font-size:12px}
  tbody tr:nth-child(even) td{background:#eafaf6}
  th.num,td.num{text-align:right;white-space:nowrap}
  .empty{text-align:center;color:#777}
  @media print{body{margin:8mm}.noprint{display:none}}
  .noprint{margin:0 0 12px}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
</style></head><body>
  <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат / Запази като PDF</button></div>
  <h1>${esc(title || "Репорт")}</h1>
  ${screenTables(sections)}
</body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
    w.document.write(html); w.document.close(); w.focus();
  };
})();
