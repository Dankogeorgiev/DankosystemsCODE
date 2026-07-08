/* Данко Системс — Склад за детайли/полуфабрикати.
   Наличност на готовите детайли/възли (не суровини). При пускане в производство
   системата приспада наличното и праща в цех само недостига (виж erpFlowApply).
   Наличност = сбор от движенията (начално / заприходяване / изписване / корекция).
   Ползва erp-detail-stock.sql (таблица product_movements + изглед v_product_stock). */

let DS_TERM = "";
let DS_ONLY_STOCK = false;

// Кои продукти са „детайли/възли" (не крайни артикули без рецепта-предназначение):
// показваме полуфабрикатите + всичко, което участва в рецепта на друг продукт.
function dsIsDetail(p) {
  if (p.is_semifinished) return true;
  const g = (p.group_name || "").toLowerCase();
  if (g.includes("детайл") || g.includes("възл") || g.includes("полуфабрикат") || g.includes("заготов")) return true;
  return false;
}

async function erpRenderDetailStock() {
  try { await erpEnsureLoaded(); }
  catch (e) { erpView().innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }

  // Проверка дали складът за детайли е създаден.
  const probe = await sb.from("product_movements").select("id").limit(1);
  if (probe.error) {
    erpView().innerHTML = `
      <div class="erp-error">
        <h3>📦 Склад за детайли — още не е включен</h3>
        <p>За да следим наличности и на детайлите/възлите (не само суровините), пусни веднъж
        файла <code>erp-detail-stock.sql</code> в Supabase → SQL Editor.</p>
        <p><a href="https://supabase.com/dashboard/project/hwbblteomrrahfrsyuow/sql/new" target="_blank" class="btn btn-small btn-primary">Отвори SQL Editor</a></p>
        <p class="hint">След това презареди страницата и се върни тук.</p>
      </div>`;
    return;
  }

  const totalWith = ERP.products.filter(dsIsDetail).filter(p => (Number(p.stock) || 0) > 0).length;
  erpView().innerHTML = `
    <div class="erp-head-row">
      <h3 class="erp-h">📦 Склад за детайли/полуфабрикати</h3>
      <span class="erp-muted">${totalWith} детайла с наличност</span>
    </div>
    <p class="hint">Тук въвеждаш реалната наличност на готовите детайли/възли. При пускане на заявка системата
      автоматично приспада наличното и праща в цех само недостига.
      За наливане наведнъж: <b>свали шаблона</b>, попълни колоната „Налична бройка (попълни)" и го <b>импортирай</b>.</p>
    <div class="erp-toolbar">
      <input type="search" id="ds-q" placeholder="Търси код или име…" value="${escapeAttr(DS_TERM)}" autocomplete="off" />
      <label class="erp-inline"><input type="checkbox" id="ds-only" ${DS_ONLY_STOCK ? "checked" : ""} /> само с наличност</label>
      <span id="ds-count" class="erp-muted"></span>
      <span class="spacer"></span>
      <button type="button" class="btn btn-small" id="ds-export">⤓ Свали шаблон (Excel)</button>
      <label class="btn btn-small btn-primary" for="ds-import-file">⤴ Импортирай наличности</label>
      <input type="file" id="ds-import-file" accept=".xlsx,.xls,.csv" hidden />
      <label class="btn btn-small" for="ds-draw-bulk" title="Избери много чертежи или ZIP архив — разпределят се по кода в началото на името">📎 Качи чертежи наведнъж</label>
      <input type="file" id="ds-draw-bulk" accept="image/*,.pdf,application/pdf,.zip,application/zip" multiple hidden />
    </div>
    <p class="hint">💡 За масово качване на чертежи: кръсти всеки файл да <b>започва с кода</b> на детайла, напр.
      <code>100526_Нож-Николети_3мм.pdf</code>. Дебелината (напр. <code>3мм</code>) я слагай в името за твое удобство — системата разпознава детайла по кода отпред.
      Може да качиш и <b>ZIP архив</b> — системата сама го разпакова и разпределя чертежите.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Детайл/възел</th><th class="num">Наличност</th><th>Движение</th></tr></thead>
      <tbody id="ds-tbody"></tbody>
    </table>`;

  const q = document.getElementById("ds-q");
  // Търсене „на живо" без пре-рисуване на целия изглед (за да не губи фокус полето).
  if (q) q.addEventListener("input", e => { DS_TERM = e.target.value; dsFillRows(); });
  const only = document.getElementById("ds-only");
  if (only) only.addEventListener("change", e => { DS_ONLY_STOCK = e.target.checked; dsFillRows(); });
  const exp = document.getElementById("ds-export");
  if (exp) exp.addEventListener("click", dsExportTemplate);
  const imp = document.getElementById("ds-import-file");
  if (imp) imp.addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) dsImportFill(f); });
  const db = document.getElementById("ds-draw-bulk");
  if (db) db.addEventListener("change", e => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) dsBulkDrawings(fs); });
  dsFillRows();
  if (q) q.focus();
}

// Пълни само редовете на таблицата според текущото търсене/филтър (без да
// пипа търсачката) — така фокусът остава и се пише плавно.
function dsFillRows() {
  const tbody = document.getElementById("ds-tbody");
  if (!tbody) return;
  let list = ERP.products.filter(dsIsDetail);
  if (DS_TERM) { const q = DS_TERM.toLowerCase().trim(); list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q)); }
  if (DS_ONLY_STOCK) list = list.filter(p => (Number(p.stock) || 0) > 0);
  list.sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0) || (a.name || "").localeCompare(b.name || "", "bg"));

  const shown = list.slice(0, 300);
  tbody.innerHTML = shown.map(p => `
    <tr>
      <td data-label="Код"><b>${escapeHtml(p.code || "")}</b></td>
      <td data-label="Детайл">${escapeHtml(p.name || "")}${p.is_semifinished ? ` <span class="erp-muted">възел</span>` : ""}</td>
      <td class="num" data-label="Наличност"><b class="${(Number(p.stock) || 0) > 0 ? "" : "erp-muted"}">${erpNum(Number(p.stock) || 0)}</b> ${escapeHtml(p.unit || "бр.")}</td>
      <td data-label="Движение">
        <button type="button" class="btn btn-small btn-primary ds-prod" data-id="${p.id}" title="Пусни по цеховете; готовото влиза тук">🏭 произведи</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="заприходяване">＋ заприходи</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="изписване">− изпиши</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="корекция">✎ наличност</button>
        <button type="button" class="btn btn-small ds-draw" data-id="${p.id}">📎 чертежи</button>
        <button type="button" class="btn btn-small ds-log" data-id="${p.id}">история</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="4" class="report-empty">Няма детайли по този филтър.</td></tr>`;

  const cnt = document.getElementById("ds-count");
  if (cnt) cnt.textContent = list.length > 300 ? `показани 300 от ${list.length}` : `${list.length} детайла`;
  tbody.querySelectorAll(".ds-mv").forEach(b => b.addEventListener("click", () => dsMoveDialog(Number(b.dataset.id), b.dataset.k)));
  tbody.querySelectorAll(".ds-log").forEach(b => b.addEventListener("click", () => dsHistory(Number(b.dataset.id))));
  tbody.querySelectorAll(".ds-prod").forEach(b => b.addEventListener("click", () => dsProduce(Number(b.dataset.id))));
  tbody.querySelectorAll(".ds-draw").forEach(b => b.addEventListener("click", () => {
    if (typeof erpNodeDrawings === "function") erpNodeDrawings(Number(b.dataset.id));
    else alert("Модулът за чертежи не е зареден. Презареди страницата.");
  }));
}

// Пуска детайл за производство ЗА СКЛАД (без заявка) — минава по цеховете и
// готовото се заприходява тук автоматично след последната операция.
async function dsProduce(pid) {
  const p = ERP.prodById[pid] || {};
  if (typeof erpProduceToStock !== "function") { alert("Модулът за производство не е зареден."); return; }
  const v = prompt(`Колко броя „${p.code ? p.code + " " : ""}${p.name}" да пусна за производство (влизат в Склад детайли, щом минат цеховете)?`, "");
  if (v === null) return;
  const q = erpToNum(v);
  if (!(q > 0)) { if (v.trim() !== "") alert("Въведи брой по-голям от 0."); return; }
  const res = await erpProduceToStock(pid, q);
  if (!res || res.error) return;
  const miss = (res.missing || []);
  alert(`Пуснах ${erpNum(q)} бр. „${p.name}" по цеховете.\n`
    + `Щом минат последната операция, ще влязат автоматично в Склад детайли.`
    + (miss.length ? `\n\n⚠ Липсват детайли: ` + miss.map(m => m.code || m.name).join(", ") : ""));
}

// Намира продукт по името на файла — по кода в началото (напр. „100526_...").
function dsMatchProductByFilename(base, products) {
  const b = String(base || "").trim().toLowerCase();
  if (!b) return null;
  const sep = /[\s._\-–—]+/;
  const token = b.split(sep)[0];
  let p = products.find(x => String(x.code || "").trim().toLowerCase() === token);
  if (p) return p;
  // Резервно: най-дългият код, с който името започва на граница (за кодове със знаци).
  const cands = products.filter(x => x.code)
    .map(x => ({ x, c: String(x.code).trim().toLowerCase() }))
    .filter(o => o.c && b.startsWith(o.c) && (b.length === o.c.length || /[\s._\-–—]/.test(b[o.c.length])))
    .sort((a, c) => c.c.length - a.c.length);
  return cands.length ? cands[0].x : null;
}

// Предполага MIME по разширението (за файлове извадени от архив).
function dsGuessMime(name) {
  const e = String(name).toLowerCase().split(".").pop();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml" })[e] || "";
}
const DS_DRAW_EXT = /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?|svg)$/i;

// Разгъва избраните файлове: ZIP архивите се разпакова́т на отделни чертежи.
async function dsExpandFiles(files) {
  const out = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      if (typeof JSZip === "undefined") { alert("Библиотеката за архиви не е заредена. Презареди страницата и опитай пак."); continue; }
      try {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        for (const name of Object.keys(zip.files)) {
          const entry = zip.files[name];
          if (entry.dir) continue;
          if (/(^|\/)__MACOSX\//.test(name) || /(^|\/)\./.test(name)) continue;   // системни/скрити
          const bn = name.split("/").pop();
          if (!bn || !DS_DRAW_EXT.test(bn)) continue;
          const blob = await entry.async("blob");
          out.push(new File([blob], bn, { type: blob.type || dsGuessMime(bn) }));
        }
      } catch (e) { alert("Не мога да разчета архива „" + f.name + "“: " + (e.message || e)); }
    } else {
      out.push(f);
    }
  }
  return out;
}

// Качва много чертежи наведнъж — разпределя ги по детайлите според кода в името.
async function dsBulkDrawings(rawFiles) {
  const files = await dsExpandFiles(rawFiles || []);
  if (!files.length) { alert("Няма чертежи за качване (архивът е празен или няма разпознати файлове)."); return; }
  const products = ERP.products || [];
  const groups = new Map();        // pid -> { p, files: [] }
  const unmatched = [];
  files.forEach(f => {
    const base = f.name.replace(/\.[^.]+$/, "");
    const p = dsMatchProductByFilename(base, products);
    if (!p) { unmatched.push(f.name); return; }
    if (!groups.has(p.id)) groups.set(p.id, { p, files: [] });
    groups.get(p.id).files.push(f);
  });
  if (!groups.size) {
    alert("Нито един файл не съвпадна по код с детайл.\n\nИмената трябва да ЗАПОЧВАТ с кода на детайла, напр. 100526_....pdf"
      + (unmatched.length ? "\n\nНенамерени:\n" + unmatched.slice(0, 20).join("\n") : ""));
    return;
  }
  const summary = [...groups.values()].map(g => `${g.p.code || "?"} ${g.p.name || ""} — ${g.files.length} чертеж(а)`).join("\n");
  if (!confirm(`Ще кача чертежи за ${groups.size} детайла:\n\n${summary}`
    + (unmatched.length ? `\n\n⚠ Ненамерени по код (ще се прескочат): ${unmatched.length}` : "")
    + `\n\nПродължавам?`)) return;

  let ok = 0, failed = 0, idx = 0;
  for (const g of groups.values()) {
    const p = g.p;
    if (typeof erpLoadDrawings === "function") await erpLoadDrawings(p.id);
    p.drawings = p.drawings || [];
    for (const file of g.files) {
      const path = `products/${p.id}/${Date.now()}-${idx++}-${safeName(file.name)}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, file);
      if (error) { failed++; continue; }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      p.drawings.push({ name: file.name, type: file.type, path, url: data.publicUrl });
      ok++;
    }
    const { error } = await sb.from("products").update({ drawings: p.drawings }).eq("id", p.id);
    if (error) alert("Грешка при запис за „" + (p.code || p.name) + "“: " + error.message);
  }
  alert(`Готово! Качени ${ok} чертежа за ${groups.size} детайла.`
    + (failed ? `\nНеуспешни качвания: ${failed}` : "")
    + (unmatched.length ? `\n\nНенамерени по код (${unmatched.length}):\n` + unmatched.slice(0, 30).join("\n") : ""));
}

// Сваля Excel-шаблон с всички детайли/възли за попълване на наличности.
function dsExportTemplate() {
  if (typeof XLSX === "undefined") { alert("Excel библиотеката не е заредена. Опитай пак след презареждане."); return; }
  const HEAD = ["Код", "Детайл/възел", "Мярка", "Налично сега (система)", "Налична бройка (попълни)"];
  const list = ERP.products.filter(dsIsDetail).slice()
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", "bg") || (a.name || "").localeCompare(b.name || "", "bg"));
  const rows = list.map(p => ({
    "Код": p.code || "",
    "Детайл/възел": p.name || "",
    "Мярка": p.unit || "бр.",
    "Налично сега (система)": Number(p.stock) || 0,
    "Налична бройка (попълни)": "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEAD });
  ws["!cols"] = [{ wch: 14 }, { wch: 42 }, { wch: 8 }, { wch: 20 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Склад детайли");
  XLSX.writeFile(wb, "Склад-детайли-шаблон.xlsx");
}

// Импортира попълнения шаблон: задава наличността на всеки детайл на въведената
// бройка (чрез движение „корекция" = разлика спрямо текущото). Празни редове се
// прескачат. Съвпадение по Код, а при липса — по име.
async function dsImportFill(file) {
  if (typeof XLSX === "undefined") { alert("Excel библиотеката не е заредена."); return; }
  let rows;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch (e) { alert("Не мога да прочета файла: " + (e.message || e)); return; }
  if (!rows.length) { alert("Файлът е празен."); return; }

  const keys = Object.keys(rows[0]);
  const findKey = subs => keys.find(k => subs.some(s => k.toLowerCase().includes(s)));
  const codeKey = findKey(["код"]);
  const nameKey = findKey(["детайл", "възел", "име", "продукт", "name"]);
  let qtyKey = findKey(["попълни", "налична бройка", "готова"]);
  if (!qtyKey) { alert("Не намирам колоната за попълване (Налична бройка).\nПолзвай сваления шаблон и не преименувай колоните."); return; }

  // Чест случай: бройките са попълнени в грешната колона („Налично сега (система)"),
  // а колоната за попълване е останала празна. Тогава ползваме нея.
  const isEmpty = v => v === "" || v === null || v === undefined;
  if (rows.every(r => isEmpty(r[qtyKey]))) {
    const sysKey = keys.find(k => /налично сега|система/i.test(k))
      || keys.find(k => k !== qtyKey && k.toLowerCase().includes("налично"));
    if (sysKey && rows.some(r => !isEmpty(r[sysKey]) && erpToNum(r[sysKey]) !== 0)) qtyKey = sysKey;
  }

  const byCode = {}, byName = {};
  ERP.products.filter(dsIsDetail).forEach(p => {
    if (p.code) byCode[String(p.code).trim().toLowerCase()] = p;
    if (p.name) byName[String(p.name).trim().toLowerCase()] = p;
  });

  const moves = [];
  let skipped = 0; const unknown = [];
  rows.forEach(r => {
    const raw = r[qtyKey];
    if (raw === "" || raw === null || raw === undefined) { skipped++; return; }
    const val = erpToNum(raw);
    const code = codeKey ? String(r[codeKey] || "").trim().toLowerCase() : "";
    const name = nameKey ? String(r[nameKey] || "").trim().toLowerCase() : "";
    const p = (code && byCode[code]) || (name && byName[name]);
    if (!p) { if (code || name) unknown.push(r[codeKey] || r[nameKey] || "?"); return; }
    const cur = Number(p.stock) || 0;
    const delta = val - cur;
    if (!delta) { skipped++; return; }
    moves.push({ product_id: p.id, kind: "корекция", quantity: delta, note: "Импорт наличности (готова продукция)" });
  });

  if (!moves.length) {
    alert(`Няма промени за запис.\nПропуснати (празни или без промяна): ${skipped}` + (unknown.length ? `\nНенамерени по код/име: ${unknown.length}` : ""));
    return;
  }
  if (!confirm(`Ще задам наличността на ${moves.length} детайла според файла.`
    + (skipped ? `\nПропуснати (празни/без промяна): ${skipped}` : "")
    + (unknown.length ? `\nНенамерени по код/име (ще се прескочат): ${unknown.length}` : "")
    + `\n\nПродължавам?`)) return;

  const { error } = await sb.from("product_movements").insert(moves);
  if (error) { alert("Грешка при запис: " + error.message); return; }
  await erpLoadAll();
  erpRenderDetailStock();
  alert(`Готово! Обновени ${moves.length} детайла.` + (unknown.length ? `\n${unknown.length} реда не бяха намерени по код/име.` : ""));
}

function dsMoveDialog(pid, kind) {
  const p = ERP.prodById[pid] || {};
  const cur = Number(p.stock) || 0;
  const isCorr = kind === "корекция";
  const title = kind === "заприходяване" ? "Заприходи в склада" : kind === "изписване" ? "Изпиши от склада" : "Задай точна наличност";
  const { wrap, close } = erpDialog(`
    <h3>${title}</h3>
    <p><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} — сега на склад: <b>${erpNum(cur)}</b> ${escapeHtml(p.unit || "бр.")}</p>
    <label class="erp-inline">${isCorr ? "Нова наличност" : "Брой"}
      <input type="number" id="ds-qty" min="0" step="any" value="${isCorr ? cur : ""}" style="width:120px" autofocus />
    </label>
    <label>Бележка (по избор)<input type="text" id="ds-note" placeholder="напр. партида, дата, причина" /></label>
    <div class="erp-dialog-actions">
      <button class="btn" id="ds-cancel">Отказ</button>
      <button class="btn btn-primary" id="ds-ok">Запиши</button>
    </div>`);
  wrap.querySelector("#ds-cancel").addEventListener("click", close);
  wrap.querySelector("#ds-ok").addEventListener("click", async () => {
    const val = erpToNum(wrap.querySelector("#ds-qty").value);
    const note = (wrap.querySelector("#ds-note").value || "").trim();
    if (isCorr) {
      const delta = val - cur;
      if (!delta) { close(); return; }
      const { error } = await sb.from("product_movements").insert({ product_id: pid, kind: "корекция", quantity: delta, note: note || "Корекция на наличност" });
      if (error) { alert("Грешка: " + error.message); return; }
    } else {
      if (!(val > 0)) { alert("Въведи брой по-голям от 0."); return; }
      const signed = kind === "изписване" ? -val : val;
      const { error } = await sb.from("product_movements").insert({ product_id: pid, kind, quantity: signed, note });
      if (error) { alert("Грешка: " + error.message); return; }
    }
    close();
    await erpLoadAll();
    erpRenderDetailStock();
  });
}

async function dsHistory(pid) {
  const p = ERP.prodById[pid] || {};
  const { data, error } = await sb.from("product_movements").select("kind,quantity,ref,note,created_at").eq("product_id", pid).order("created_at", { ascending: false }).limit(100);
  const rows = error ? [] : (data || []);
  const { wrap, close } = erpDialog(`
    <h3>История · ${escapeHtml(p.code || "")} ${escapeHtml(p.name || "")}</h3>
    <div class="erp-lp-list">
      ${rows.length ? `<table class="report-table erp-table"><thead><tr><th>Дата</th><th>Тип</th><th class="num">Кол.</th><th>Бележка</th></tr></thead>
        <tbody>${rows.map(m => `<tr>
          <td>${escapeHtml((m.created_at || "").slice(0, 10))}</td>
          <td>${escapeHtml(m.kind || "")}</td>
          <td class="num ${Number(m.quantity) < 0 ? "erp-warn" : ""}">${Number(m.quantity) > 0 ? "+" : ""}${erpNum(Number(m.quantity) || 0)}</td>
          <td>${escapeHtml(m.note || m.ref || "")}</td>
        </tr>`).join("")}</tbody></table>` : `<p class="report-empty">Няма движения.</p>`}
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="ds-h-close">Затвори</button></div>`);
  wrap.querySelector("#ds-h-close").addEventListener("click", close);
}
