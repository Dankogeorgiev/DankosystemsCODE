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

  let list = ERP.products.filter(dsIsDetail);
  if (DS_TERM) { const q = DS_TERM.toLowerCase(); list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q)); }
  if (DS_ONLY_STOCK) list = list.filter(p => (Number(p.stock) || 0) > 0);
  list.sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0) || (a.name || "").localeCompare(b.name || "", "bg"));

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
      <input type="search" id="ds-q" placeholder="Търси код или име…" value="${escapeAttr(DS_TERM)}" />
      <label class="erp-inline"><input type="checkbox" id="ds-only" ${DS_ONLY_STOCK ? "checked" : ""} /> само с наличност</label>
      <span class="spacer"></span>
      <button type="button" class="btn btn-small" id="ds-export">⤓ Свали шаблон (Excel)</button>
      <label class="btn btn-small btn-primary" for="ds-import-file">⤴ Импортирай наличности</label>
      <input type="file" id="ds-import-file" accept=".xlsx,.xls,.csv" hidden />
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Детайл/възел</th><th class="num">Наличност</th><th>Движение</th></tr></thead>
      <tbody>${list.slice(0, 300).map(p => `
        <tr>
          <td data-label="Код"><b>${escapeHtml(p.code || "")}</b></td>
          <td data-label="Детайл">${escapeHtml(p.name || "")}${p.is_semifinished ? ` <span class="erp-muted">възел</span>` : ""}</td>
          <td class="num" data-label="Наличност"><b class="${(Number(p.stock) || 0) > 0 ? "" : "erp-muted"}">${erpNum(Number(p.stock) || 0)}</b> ${escapeHtml(p.unit || "бр.")}</td>
          <td data-label="Движение">
            <button type="button" class="btn btn-small btn-primary ds-prod" data-id="${p.id}" title="Пусни по цеховете; готовото влиза тук">🏭 произведи</button>
            <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="заприходяване">＋ заприходи</button>
            <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="изписване">− изпиши</button>
            <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="корекция">✎ наличност</button>
            <button type="button" class="btn btn-small ds-log" data-id="${p.id}">история</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="4" class="report-empty">Няма детайли по този филтър.</td></tr>`}
      </tbody>
    </table>
    ${list.length > 300 ? `<p class="hint">Показани първите 300. Уточни търсенето.</p>` : ""}`;

  const q = document.getElementById("ds-q");
  if (q) q.addEventListener("input", e => { DS_TERM = e.target.value; erpRenderDetailStock(); });
  const only = document.getElementById("ds-only");
  if (only) only.addEventListener("change", e => { DS_ONLY_STOCK = e.target.checked; erpRenderDetailStock(); });
  const exp = document.getElementById("ds-export");
  if (exp) exp.addEventListener("click", dsExportTemplate);
  const imp = document.getElementById("ds-import-file");
  if (imp) imp.addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) dsImportFill(f); });
  erpView().querySelectorAll(".ds-mv").forEach(b => b.addEventListener("click", () => dsMoveDialog(Number(b.dataset.id), b.dataset.k)));
  erpView().querySelectorAll(".ds-log").forEach(b => b.addEventListener("click", () => dsHistory(Number(b.dataset.id))));
  erpView().querySelectorAll(".ds-prod").forEach(b => b.addEventListener("click", () => dsProduce(Number(b.dataset.id))));
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
