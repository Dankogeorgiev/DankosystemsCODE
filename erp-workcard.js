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

/* ---------- 🖨 Рецепта + чертежи (Данко, 24.11.2026) ----------
   Печатен лист: цялото дърво на технологията (възли, материали, операции
   с количества) + ПРИЛОЖЕНИЕ с чертежите на всеки възел — изображенията
   се визуализират директно, PDF чертежите се изброяват (печатат се отделно). */

// Всички възли в дървото на продукта (без повторения, защита от цикли).
function erpRecipeNodeIds(pid) {
  const ids = [];
  (function rec(id, anc) {
    (ERP.linesByProduct[id] || []).forEach(l => {
      if (l.child_product_id && !anc.has(l.child_product_id)) {
        if (!ids.includes(l.child_product_id)) ids.push(l.child_product_id);
        rec(l.child_product_id, new Set([...anc, l.child_product_id]));
      }
    });
  })(pid, new Set([pid]));
  return ids;
}

function erpRecipeDrawingsHtml(p) {
  const qn = x => (Math.round((Number(x) || 0) * 1000) / 1000).toLocaleString("bg-BG");
  const row = (tag, bg, code, name, qty, unit, pad, bold) =>
    `<tr><td style="padding-left:${8 + pad}px"><span class="tag" style="background:${bg}">${tag}</span> ${bold ? "<b>" : ""}${escapeHtml(code || "")} ${escapeHtml(name || "")}${bold ? "</b>" : ""}</td>
     <td class="r">${qn(qty)} ${escapeHtml(unit || "")}</td></tr>`;
  const treeRows = (function walk(id, depth, anc) {
    return (ERP.linesByProduct[id] || []).map(l => {
      const pad = depth * 20;
      if (l.material_id) { const m = ERP.matById[l.material_id] || {}; return row("мат.", "#dcfce7", m.code, m.name, l.quantity, l.unit || m.unit, pad); }
      if (l.operation_id) { const op = ERP.opById[l.operation_id] || {}; return row("опер.", "#fef9c3", op.code, op.name, l.quantity, l.unit || "бр.", pad); }
      if (l.child_product_id) {
        const c = ERP.prodById[l.child_product_id] || {};
        const sub = anc.has(l.child_product_id) ? "" : walk(l.child_product_id, depth + 1, new Set([...anc, l.child_product_id]));
        return row("възел", "#e0e7ff", c.code, c.name, l.quantity, l.unit || "бр.", pad, true) + sub;
      }
      return "";
    }).join("");
  })(p.id, 0, new Set([p.id]));

  // Приложението: чертежите на изделието + на всеки възел (по реда на дървото).
  const nodeIds = erpRecipeNodeIds(p.id);
  const noDraw = [];
  const drawSection = [p.id, ...nodeIds].map(id => {
    const c = ERP.prodById[id] || {};
    const list = c.drawings || [];
    if (!list.length) { if (id !== p.id) noDraw.push(`${c.code || ""} ${c.name || ""}`.trim()); return ""; }
    const imgs = list.filter(f => (f.type || "").startsWith("image/"));
    // PDF чертежите се разгъват на страници-изображения в самия лист (pdf.js),
    // за да се печата ВСИЧКО ЗАЕДНО — Данко, 24.11.2026.
    const pdfs = list.filter(f => !(f.type || "").startsWith("image/"));
    return `<div class="node-draw">
      <h3>${id === p.id ? "Чертежи на изделието" : "Възел"} <b>${escapeHtml(c.code || "")}</b> ${escapeHtml(c.name || "")}</h3>
      ${imgs.map(f => `<div class="dimg"><img src="${escapeAttr(f.url)}" alt="${escapeAttr(f.name)}"><div class="dcap">${escapeHtml(f.name)}</div></div>`).join("")}
      ${pdfs.map(f => `<div class="pdfdraw" data-url="${escapeAttr(f.url)}" data-name="${escapeAttr(f.name)}"><p class="muted">⏳ Зареждам PDF чертежа ${escapeHtml(f.name)}…</p></div>`).join("")}
    </div>`;
  }).join("");

  const dateStr = new Date().toLocaleDateString("bg-BG");
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Рецепта ${escapeHtml(p.code || "")}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, "DejaVu Sans", sans-serif; color: #111; font-size: 12px; margin: 16px 20px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 10px; }
    .head h1 { font-size: 20px; margin: 0; color: #1d4ed8; }
    .brand { font-weight: 700; color: #1d4ed8; }
    .meta { text-align: right; font-size: 12px; color: #444; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
    td { border: 1px solid #cbd5e1; padding: 4px 7px; font-size: 11.5px; }
    td.r { text-align: right; white-space: nowrap; width: 110px; }
    .tag { font-size: 10px; font-weight: 700; border-radius: 4px; padding: 1px 5px; color: #334155; }
    .muted { color: #777; font-size: 11px; }
    h2 { font-size: 15px; color: #1d4ed8; margin: 18px 0 4px; page-break-before: always; }
    h3 { font-size: 13px; margin: 12px 0 4px; }
    .node-draw { page-break-inside: avoid; margin-bottom: 10px; }
    .dimg { text-align: center; page-break-inside: avoid; margin: 6px 0; }
    .dimg img { max-width: 100%; max-height: 740px; border: 1px solid #cbd5e1; border-radius: 6px; }
    .dcap { font-size: 10.5px; color: #666; margin-top: 2px; }
    @media print { body { margin: 8mm; } .noprint { display: none; } }
    .noprint { text-align: center; margin: 14px 0; }
    .btnp { background: #1d4ed8; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  </style></head><body>
    <div class="noprint"><button class="btnp" id="printbtn" onclick="window.print()">🖨 Печат</button> <span id="pdfstat" class="muted"></span></div>
    <div class="head">
      <div><div class="brand">ДАНКО СИСТЕМС</div><h1>РЕЦЕПТА / ТЕХНОЛОГИЯ</h1></div>
      <div class="meta">Дата: <b>${dateStr}</b></div>
    </div>
    <p style="font-size:15px;margin:4px 0"><b>${escapeHtml(p.code || "")}</b> · ${escapeHtml(p.name || "")} <span class="muted">(${p.is_semifinished ? "полуфабрикат / възел" : "артикул"})</span></p>
    <table><tbody>${treeRows || `<tr><td class="muted">— рецептата е празна —</td></tr>`}</tbody></table>
    <h2>Приложение — чертежи по възли</h2>
    ${drawSection || `<p class="muted">Няма прикачени чертежи по възлите.</p>`}
    ${noDraw.length ? `<p class="muted">Без чертеж: ${noDraw.map(escapeHtml).join(" · ")}</p>` : ""}
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
    <script>
    /* PDF чертежите се рендерират като изображения в листа, за да се печатат
       заедно с всичко останало. Докато вървят, бутонът за печат чака. */
    (async function () {
      var boxes = Array.prototype.slice.call(document.querySelectorAll(".pdfdraw"));
      var stat = document.getElementById("pdfstat"), btn = document.getElementById("printbtn");
      if (!boxes.length) return;
      if (typeof pdfjsLib === "undefined") {
        boxes.forEach(function (b) { b.innerHTML = "<p class=\\"muted\\">⚠ " + b.dataset.name + " — четецът на PDF не се зареди (няма интернет?). Отвори чертежа отделно.</p>"; });
        return;
      }
      btn.disabled = true; stat.textContent = "⏳ Зареждам PDF чертежите — изчакай преди печат…";
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      var bad = 0;
      for (var k = 0; k < boxes.length; k++) {
        var box = boxes[k];
        try {
          var pdf = await pdfjsLib.getDocument({ url: box.dataset.url }).promise;
          var n = Math.min(pdf.numPages, 10);
          box.innerHTML = "";
          for (var i = 1; i <= n; i++) {
            var page = await pdf.getPage(i);
            var vp = page.getViewport({ scale: 2 });
            var c = document.createElement("canvas");
            c.width = vp.width; c.height = vp.height;
            await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
            var d = document.createElement("div"); d.className = "dimg";
            var img = document.createElement("img"); img.src = c.toDataURL("image/png");
            var cap = document.createElement("div"); cap.className = "dcap";
            cap.textContent = box.dataset.name + (pdf.numPages > 1 ? " — стр. " + i + " от " + pdf.numPages : "");
            d.appendChild(img); d.appendChild(cap); box.appendChild(d);
          }
          if (pdf.numPages > n) {
            var more = document.createElement("p"); more.className = "muted";
            more.textContent = "… PDF файлът има още " + (pdf.numPages - n) + " страници (печатат се първите " + n + ").";
            box.appendChild(more);
          }
        } catch (e) {
          bad++;
          box.innerHTML = "";
          var warn = document.createElement("p"); warn.className = "muted";
          warn.textContent = "⚠ " + box.dataset.name + " — не можа да се зареди за печат. Отвори чертежа отделно.";
          box.appendChild(warn);
        }
      }
      btn.disabled = false;
      stat.textContent = bad ? "⚠ " + bad + " PDF чертеж(а) не се заредиха — останалото е готово за печат." : "✓ Всички чертежи са на листа — печатай.";
    })();
    <\/script>
  </body></html>`;
}

async function erpPrintRecipeWithDrawings(productId) {
  const p = ERP.prodById[productId];
  if (!p) { alert("Продуктът не е намерен."); return; }
  // Чертежите се пазят мързеливо — зареждаме ги за изделието и ВСИЧКИ възли.
  const ids = [productId, ...erpRecipeNodeIds(productId)];
  try { await Promise.all(ids.map(id => erpLoadDrawings(id))); } catch (e) {}
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(erpRecipeDrawingsHtml(p));
  w.document.close();
  w.focus();
}
