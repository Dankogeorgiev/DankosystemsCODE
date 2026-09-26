/* Данко Системс — ЕРП „Работна карта" за продукт (за печат).
   Съставя A4 лист: продукт, материали (сумарно за бройката), производствен
   маршрут по цехове, външни услуги, чертеж и полета за подпис.
   Ползва ERP данните + erpBuildTasks (erp-orders.js) за маршрута. */

// Клиентско разбиване на суровините (сума по материал) за дадена бройка.
function erpExplodeMaterials(pid, qty) {
  const acc = {};
  (function rec(id, mult, anc) {
    (ERP.linesByProduct[id] || []).forEach(l => {
      if (l.material_id) {
        const m = ERP.matById[l.material_id] || {};
        acc[l.material_id] = acc[l.material_id] || { code: m.code || "", name: m.name || "", unit: m.unit || "", qty: 0 };
        acc[l.material_id].qty += mult * (Number(l.quantity) || 1);
      } else if (l.child_product_id && !anc.has(l.child_product_id)) {
        rec(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]));
      }
    });
  })(pid, qty, new Set([pid]));
  return Object.values(acc);
}

function erpWorkCardHtml(p, qty) {
  const mats = erpExplodeMaterials(p.id, qty);
  const built = (typeof erpBuildTasks === "function")
    ? erpBuildTasks({ id: "wc", type: "order", clientName: "", deadline: "", erpProductId: p.id, erpQty: qty })
    : { tasks: [], external: [] };
  const dateStr = new Date().toLocaleDateString("bg-BG");
  const firstImg = (p.drawings || []).find(f => (f.type || "").startsWith("image/"));

  const matRows = mats.length ? mats.map((m, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(m.code)}</td><td>${escapeHtml(m.name)}</td>
        <td class="r">${(Math.round(m.qty * 1000) / 1000).toLocaleString("bg-BG")}</td><td>${escapeHtml(m.unit)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="c muted">— няма материали в рецептата —</td></tr>`;

  const opRows = built.tasks.length ? built.tasks.map((t, i) => `
    <tr><td>${i + 1}</td><td>${escapeHtml(t.operation)}</td><td>${escapeHtml(t.workshop)}</td>
        <td>${escapeHtml(t.product)}</td><td class="r">${(Math.round(t.qty * 1000) / 1000).toLocaleString("bg-BG")}</td>
        <td class="sign"></td></tr>`).join("")
    : `<tr><td colspan="6" class="c muted">— няма операции в рецептата —</td></tr>`;

  const extRows = built.external.length ? `
    <h3>Външни услуги (подизпълнител)</h3>
    <table><thead><tr><th>Операция</th><th>За</th></tr></thead>
      <tbody>${built.external.map(e => `<tr><td>${escapeHtml(e.op)}</td><td>${escapeHtml(e.product)}</td></tr>`).join("")}</tbody></table>` : "";

  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Работна карта ${escapeHtml(p.code || "")}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, "DejaVu Sans", sans-serif; color: #111; font-size: 12px; margin: 16px 20px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f766e; padding-bottom: 8px; margin-bottom: 10px; }
    .head h1 { font-size: 20px; margin: 0; color: #0f766e; }
    .brand { font-weight: 700; color: #0f766e; }
    .meta { text-align: right; font-size: 12px; color: #444; }
    .prod { display: flex; justify-content: space-between; gap: 16px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
    .prod .big { font-size: 15px; font-weight: 700; }
    .qtybox { text-align: center; border-left: 1px solid #99f6e4; padding-left: 16px; }
    .qtybox .n { font-size: 26px; font-weight: 800; color: #0f766e; }
    h3 { font-size: 13px; margin: 14px 0 4px; color: #0f766e; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; font-size: 11.5px; }
    th { background: #ecfdf5; color: #065f46; }
    td.r { text-align: right; } td.c { text-align: center; } .muted { color: #777; }
    td.sign { width: 90px; }
    .drawing { margin: 8px 0; text-align: center; }
    .drawing img { max-width: 100%; max-height: 220px; border: 1px solid #cbd5e1; border-radius: 6px; }
    .signs { display: flex; gap: 30px; margin-top: 26px; }
    .signs div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 11px; color: #444; text-align: center; }
    @media print { body { margin: 8mm; } .noprint { display: none; } }
    .noprint { text-align: center; margin: 14px 0; }
    .btnp { background: #0f766e; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <div class="head">
      <div><div class="brand">ДАНКО СИСТЕМС</div><h1>РАБОТНА КАРТА</h1></div>
      <div class="meta">Дата: <b>${dateStr}</b><br>Карта №: ________</div>
    </div>
    <div class="prod">
      <div>
        <div class="big">${escapeHtml(p.code || "")} · ${escapeHtml(p.name || "")}</div>
        <div>${p.is_semifinished ? "Полуфабрикат / възел" : "Артикул"}</div>
      </div>
      <div class="qtybox"><div>Количество</div><div class="n">${(Math.round(qty * 1000) / 1000).toLocaleString("bg-BG")}</div><div>бр.</div></div>
    </div>

    ${firstImg ? `<div class="drawing"><img src="${escapeAttr(firstImg.url)}" alt="чертеж"></div>` : ""}

    <h3>Необходими материали (за ${(Math.round(qty * 1000) / 1000).toLocaleString("bg-BG")} бр.)</h3>
    <table><thead><tr><th>№</th><th>Код</th><th>Материал</th><th>Количество</th><th>Мярка</th></tr></thead>
      <tbody>${matRows}</tbody></table>

    <h3>Производствен маршрут</h3>
    <table><thead><tr><th>№</th><th>Операция</th><th>Цех</th><th>За (изделие/възел)</th><th>Кол-во</th><th>Изпълнил</th></tr></thead>
      <tbody>${opRows}</tbody></table>

    ${extRows}

    <div class="signs">
      <div>Изготвил</div><div>Приел производство</div><div>Дата на завършване</div>
    </div>
  </body></html>`;
}

function erpPrintWorkCard(productId, qty) {
  const p = ERP.prodById[productId];
  if (!p) { alert("Продуктът не е намерен."); return; }
  const n = erpToNum(qty) || 1;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(erpWorkCardHtml(p, n));
  w.document.close();
  w.focus();
}
