/* Данко Системс — „⚙ Обработване на заявка“ (по Данко, 31.10.2026).
   Събира в ЕДИН редактируем работен доклад всичко за подготовката на
   заявка: А резюме · Б изделията срещу Склад детайли · В материалите по
   рецептите с недостига · Г списък за купуване · Д разкроя на тръбите
   (+ 🏷 Етикети и 📄 Чертежи) · Е палетния опис · Ж пакинг листа.
   Числата са детерминистични (разбивка/склад/рецепти/разкрой/опаковки) —
   нищо не чака AI. Докладът се пази В заявката (o.processing), редактира
   се на място (contenteditable), печата се целият или избрани секции;
   печатният прозорец носи име „Клиент-№“ → „Запази като PDF“.
   Ползва: erpReqBuildOrder (erp-requirements), ERP.prodById/matById,
   cutCollect/cutPrintLabels/cutDrawings (erp-cutlist), erpPackDocRows/
   packBodyPacking/packBodyPallets (erp-packaging), erpDialog,
   invPrintWindow (erp-invoice-docs), erpSaveCO (erp-customer-orders). */

let OPREP_CUT = { rows: [], prodIds: [] };   // последният разчет на разкроя (за Етикети/Чертежи)

function oprepLeft(l) { const q = erpToNum(l.qty) || 0; return Math.max(0, q - Math.min(Math.max(0, Number(l.delivered) || 0), q)); }

async function erpOrderPrepBuild(o) {
  const esc = s => escapeHtml(String(s == null ? "" : s));
  const secs = [];
  // А · Резюме
  secs.push({
    key: "sum", title: "А · Резюме", html: `
    <p><b>${esc(o.clientName || "—")}</b> · заявка <b>№ ${esc(o.ourNo || "—")}</b>${o.clientNo ? ` · клиентски № ${esc(o.clientNo)}` : ""}</p>
    <p>Дата: <b>${erpDMY(o.date) || "—"}</b> · срок: <b>${erpDMY(o.deadline) || "—"}</b> · статус: ${esc(o.status || "нова")}</p>
    <p>${(o.lines || []).map(l => `${esc(l.code || "")} ${esc(l.name || "")} × ${erpNum(erpToNum(l.qty) || 0)}${(Number(l.delivered) || 0) > 0 ? ` (доставени ${erpNum(Number(l.delivered) || 0)})` : ""}`).join("<br>") || "—"}</p>
    ${o.note ? `<p>📝 ${esc(o.note)}</p>` : ""}`,
  });
  // Б · Изделията срещу Склад детайли
  const bRows = (o.lines || []).filter(l => l.productId).map(l => {
    const p = (typeof ERP !== "undefined" && ERP.prodById && ERP.prodById[l.productId]) || {};
    const left = oprepLeft(l);
    const have = Math.max(0, Number(p.stock) || 0);
    const take = Math.min(have, left);
    return { code: p.code || l.code || "", name: p.name || l.name || "", left, have, take, make: Math.max(0, left - have) };
  });
  secs.push({
    key: "stock", title: "Б · 🏭 Изделия: склад и производство", html: bRows.length ? `
    <table class="oprep-t"><thead><tr><th>Код</th><th>Изделие</th><th>Остатък</th><th>В Склад детайли</th><th>От склада</th><th>ЗА ПРОИЗВОДСТВО</th></tr></thead>
    <tbody>${bRows.map(r => `<tr${r.make > 0 ? "" : ' style="color:#166534"'}><td><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td>${erpNum(r.left)}</td><td>${erpNum(r.have)}</td><td>${erpNum(r.take)}</td><td><b>${r.make > 0 ? erpNum(r.make) : "— покрито"}</b></td></tr>`).join("")}</tbody></table>
    <p class="hint">Складовите бройки са ориентир — реалното нетиране става при „🏭 Пусни в производство“.</p>` : "<p>Няма редове с изделия от номенклатурата.</p>",
  });
  // В · Материалите по рецептите (разбивката, за остатъка) + Г · За купуване
  let mats = [];
  if (typeof erpReqBuildOrder === "function") {
    const r = erpReqBuildOrder(o);
    mats = (r.rows || []).map(x => {
      const m = (typeof ERP !== "undefined" && ERP.matById && (ERP.matById[x.material_id] || ERP.matById[String(x.material_id)])) || {};
      const have = Math.max(0, Number(m.stock) || 0);
      return { ...x, have, buy: Math.max(0, Math.round((x.required - have) * 1000) / 1000) };
    }).sort((a, b) => b.buy - a.buy || a.name.localeCompare(b.name, "bg"));
    secs.push({
      key: "mats", title: "В · 🧱 Материали по рецептите", html: (r.head || "") + (mats.length ? `
      <table class="oprep-t"><thead><tr><th>Материал</th><th>Нужно</th><th>Налично</th><th>НЕДОСТИГ</th></tr></thead>
      <tbody>${mats.map(x => `<tr${x.buy > 0 ? ' style="background:#fef2f2"' : ""}><td>${esc(x.name)}</td><td>${erpNum(x.required)} ${esc(x.unit)}</td><td>${erpNum(x.have)}</td><td>${x.buy > 0 ? `<b style="color:#b91c1c">${erpNum(x.buy)} ${esc(x.unit)}</b>` : "—"}</td></tr>`).join("")}</tbody></table>` : "<p>Няма материали по рецептите.</p>"),
    });
  } else secs.push({ key: "mats", title: "В · 🧱 Материали по рецептите", html: "<p>Модулът Разбивка на нуждите не е зареден.</p>" });
  const buy = mats.filter(x => x.buy > 0);
  secs.push({
    key: "buy", title: "Г · 🛒 За купуване", html: buy.length ? `
    <table class="oprep-t"><thead><tr><th>Материал</th><th>ЗА КУПУВАНЕ</th></tr></thead>
    <tbody>${buy.map(x => `<tr><td>${esc(x.name)}</td><td><b>${erpNum(x.buy)} ${esc(x.unit)}</b></td></tr>`).join("")}</tbody></table>
    <p class="hint">Недостигът по разбивката — наличното в склад Материали е извадено.</p>` : `<p style="color:#166534"><b>✅ Всичко необходимо е налично — няма какво да се купува.</b></p>`,
  });
  // Д · Разкроят на тръбите (Подготовка за производство)
  let cutHtml = "<p>Модулът Подготовка за производство не е зареден.</p>";
  OPREP_CUT = { rows: [], prodIds: [] };
  if (typeof cutCollect === "function") {
    const c = cutCollect([o]);
    OPREP_CUT = { rows: c.rows || [], prodIds: c.prodIds || [] };
    cutHtml = (c.rows || []).length ? `
      <table class="oprep-t"><thead><tr><th>Тръба</th><th>L (мм)</th><th>Брой разрези</th><th>Бележка</th></tr></thead>
      <tbody>${c.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.lenMm ? erpNum(r.lenMm) : "—"}</td><td><b>${erpNum(r.cuts)}</b></td><td>${esc(r.note || "")}</td></tr>`).join("")}</tbody></table>`
      : "<p>Няма тръби за разкрой в рецептите на тази заявка.</p>";
    if ((c.problems || []).length) cutHtml += `<p class="erp-warn">⚠ ${c.problems.map(esc).join("<br>⚠ ")}</p>`;
  }
  secs.push({ key: "cut", title: "Д · 🪚 Разкрой на тръбите", html: cutHtml, tools: "cut" });
  // Е · Палетен опис и Ж · Пакинг лист (от ОПАКОВКИ)
  try {
    if (typeof erpPackDocRows === "function" && typeof packBodyPallets === "function" && typeof packBodyPacking === "function") {
      const rows = await erpPackDocRows(o);
      const P = o.packing || { rows: {}, palletKg: 20 };
      const filled = rows.some(r => r.boxes > 0);
      const warn = "<p>⚠ Опаковката на заявката не е попълнена — Палет описът и Пакинг листът черпят кашоните и теглата от ОПАКОВКИ. Попълни я (бутона 🎁 в заявката/Опаковки) и натисни „↻ Преизчисли“.</p>";
      secs.push({ key: "pallets", title: "Е · 🧱 Палетен опис", html: filled ? packBodyPallets(o, rows, P).body : warn });
      secs.push({ key: "packing", title: "Ж · 📦 Пакинг лист", html: filled ? packBodyPacking(o, rows, P) : warn });
    } else {
      secs.push({ key: "pallets", title: "Е · 🧱 Палетен опис", html: "<p>Модулът Опаковки не е зареден.</p>" });
      secs.push({ key: "packing", title: "Ж · 📦 Пакинг лист", html: "<p>Модулът Опаковки не е зареден.</p>" });
    }
  } catch (e) {
    secs.push({ key: "pallets", title: "Е · 🧱 Палетен опис", html: `<p>Грешка при опаковките: ${esc(e.message || e)}</p>` });
    secs.push({ key: "packing", title: "Ж · 📦 Пакинг лист", html: `<p>Грешка при опаковките: ${esc(e.message || e)}</p>` });
  }
  return secs;
}

async function erpOrderProcess(o) {
  if (!o) return;
  const saved = (o.processing && Array.isArray(o.processing.sections) && o.processing.sections.length) ? o.processing : null;
  if (saved) { erpOrderPrepDialog(o, saved.sections.map(s => ({ ...s })), true); return; }
  const secs = await erpOrderPrepBuild(o);
  erpOrderPrepDialog(o, secs, false);
}

function erpOrderPrepDialog(o, secs, fromSaved) {
  const title = `${o.clientName || "—"} — № ${o.ourNo || "—"}`;
  const savedLine = fromSaved
    ? `запазен ${erpDMY(String((o.processing || {}).updatedAt || "").slice(0, 10)) || ""}${(o.processing || {}).updatedBy ? " от " + escapeHtml(o.processing.updatedBy) : ""} — „↻ Преизчисли“ прави свеж разчет`
    : "нов разчет — „💾 Запази“ го оставя по заявката за всички";
  const { wrap, close } = erpDialog(`
    <h3 style="margin:0 0 2px">⚙ Работен доклад — ${escapeHtml(title)}</h3>
    <p class="erp-muted" style="margin:0;font-size:12px">${savedLine}</p>
    <div class="erp-toolbar" style="margin:8px 0">
      <button class="btn btn-small btn-primary" id="op-save">💾 Запази</button>
      <button class="btn btn-small" id="op-print" title="Печат само на отметнатите секции — от прозореца „Запази като PDF“ дава файл с името на клиента и номера">🖨 Печат / PDF</button>
      <button class="btn btn-small" id="op-rebuild" title="Свеж разчет от склада, рецептите и опаковките — редакциите В ПРОЗОРЕЦА се губят (запазеното остава до Запази)">↻ Преизчисли</button>
      <span class="save-status" id="op-status"></span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="op-close">✕ Затвори</button>
    </div>
    <p class="hint" style="margin:0 0 8px">Пиши направо в секциите — текстът се редактира. Отметката „в печата“ решава кои секции влизат в Печат/PDF.</p>
    <div class="oprep-secs">${secs.map((s, i) => `
      <div class="oprep-sec" data-k="${escapeAttr(s.key)}">
        <div class="oprep-sec-head">
          <h4>${escapeHtml(s.title)}</h4>
          <label class="erp-inline" style="font-size:12px" title="Да влезе ли секцията в Печат/PDF"><input type="checkbox" class="op-inc" ${s.inc === false ? "" : "checked"} /> в печата</label>
          ${s.tools === "cut" ? '<span class="spacer"></span><button type="button" class="btn btn-small op-labels" title="Палетните етикети на разкроя — печат">🏷 Етикети</button><button type="button" class="btn btn-small op-draws" title="Чертежите на изделията и възлите от разкроя">📄 Чертежи</button>' : ""}
        </div>
        <div class="oprep-body" contenteditable="true" data-i="${i}">${s.html}</div>
      </div>`).join("")}</div>`);
  const box = wrap.querySelector(".erp-dialog-box");
  if (box) box.classList.add("oprep-box");
  const collect = () => [...wrap.querySelectorAll(".oprep-sec")].map((el, i) => ({
    key: el.dataset.k, title: secs[i].title, tools: secs[i].tools || undefined,
    html: el.querySelector(".oprep-body").innerHTML,
    inc: el.querySelector(".op-inc").checked,
  }));
  wrap.querySelector("#op-close").addEventListener("click", close);
  wrap.querySelector("#op-save").addEventListener("click", async () => {
    const st = wrap.querySelector("#op-status"), b = wrap.querySelector("#op-save");
    b.disabled = true;
    o.processing = { sections: collect(), updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "" };
    try {
      if (typeof erpSaveCO !== "function") throw new Error("модулът Заявки не е зареден");
      await erpSaveCO(o);
      if (st) st.textContent = "✓ Записано в заявката";
    } catch (e) { alert("Грешка при запис: " + (e.message || e)); }
    b.disabled = false;
    setTimeout(() => { if (st) st.textContent = ""; }, 2500);
  });
  wrap.querySelector("#op-print").addEventListener("click", () => {
    const inc = collect().filter(s => s.inc !== false && s.inc);
    if (!inc.length) { alert("Отметни поне една секция „в печата“."); return; }
    const body = inc.map(s => `<h2 style="margin:14px 0 6px;border-bottom:2px solid #000;padding-bottom:3px">${escapeHtml(s.title)}</h2>${s.html}
      <style>.oprep-t{width:100%;border-collapse:collapse;margin:6px 0}.oprep-t th,.oprep-t td{border:1.2px solid #000;padding:4px 7px;font-size:11.5px;text-align:left}.oprep-t th{background:#efefef}</style>`).join("");
    const fname = `${o.clientName || "клиент"}-${o.ourNo || ""}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    if (typeof invPrintWindow === "function") invPrintWindow(fname, body, "bg");
    else {
      const w = window.open("", "_blank");
      if (!w) { alert("Браузърът блокира прозореца за печат."); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(fname)}</title></head><body>${body}</body></html>`);
      w.document.close();
    }
  });
  wrap.querySelector("#op-rebuild").addEventListener("click", async () => {
    if (!confirm("Свеж разчет от склада, рецептите и опаковките?\nРъчните редакции В ПРОЗОРЕЦА се губят (запазеното в заявката остава, докато не натиснеш „💾 Запази“).")) return;
    close();
    const fresh = await erpOrderPrepBuild(o);
    erpOrderPrepDialog(o, fresh, false);
  });
  const ensureCut = () => {
    if (!(OPREP_CUT.rows || []).length && typeof cutCollect === "function") {
      const c = cutCollect([o]);
      OPREP_CUT = { rows: c.rows || [], prodIds: c.prodIds || [] };
    }
  };
  const lb = wrap.querySelector(".op-labels");
  if (lb) lb.addEventListener("click", () => {
    ensureCut();
    if (typeof cutPrintLabels === "function") cutPrintLabels(OPREP_CUT.rows);
    else alert("Модулът Подготовка за производство не е зареден.");
  });
  const db = wrap.querySelector(".op-draws");
  if (db) db.addEventListener("click", async () => {
    ensureCut();
    if (typeof cutDrawings !== "function") { alert("Модулът с чертежите не е зареден."); return; }
    db.disabled = true;
    const draws = await cutDrawings(OPREP_CUT.prodIds || []);
    db.disabled = false;
    if (!draws.length) { alert("Изделията от разкроя нямат качени чертежи.\nЧертежи се качват на продукта в Склад детайли."); return; }
    const d2 = erpDialog(`<h3>📄 Чертежи по заявката</h3>
      <ul class="co-file-ul">${draws.map(d => `<li><a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">📄 <b>${escapeHtml(d.pcode)}</b> ${escapeHtml(d.pname)} — ${escapeHtml(d.fname)}</a></li>`).join("")}</ul>
      <div class="erp-dialog-actions"><button class="btn" id="opd-close">Затвори</button></div>`);
    d2.wrap.querySelector("#opd-close").addEventListener("click", d2.close);
  });
}
