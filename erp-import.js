/* Данко Системс — ЕРП импортер на рецепти от Bizzio (xlsx) + екран „Импорт".
   Чистата логика (erpRowsToStaging) не докосва Supabase/SheetJS — тества се отделно.
   Прилагането (erpApplyImport) прави идемпотентен upsert и пресъздава рецептите. */

/* ==================== ЧИСТА ЛОГИКА (тестваема) ==================== */

function erpNormKey(s) { return String(s).toLowerCase().replace(/\s+/g, " ").trim(); }
function erpMakeGetter(row) {
  const map = {};
  for (const k in row) map[erpNormKey(k)] = row[k];
  return cands => {
    for (const c of cands) {
      const v = map[erpNormKey(c)];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return "";
  };
}
function erpStr(v) { return v === null || v === undefined ? "" : String(v).trim(); }

// Колони (кандидати — първата съвпадаща печели, без значение за интервали/регистър).
// Забележка: SheetJS суфиксира повтарящите се заглавия с „_1" (не „.1").
// Затова реалните колони за съставката са „Кол._1", „Продукт_1", „#_1" и т.н.
// Държим и „.1" вариантите като резервни (различни експорт-инструменти).
const ERP_COL = {
  VID:         ["Вид"],
  PARENT_CODE: ["Продукт (код)", "Продукт код"],
  PARENT_NAME: ["Продукт_1", "Продукт.1", "Продукт .1"],
  TYPE:        ["Тип"],
  GROUP:       ["Група"],
  ART_NAME:    ["Артикул"],
  CODE:        ["Код"],
  QTY:         ["Кол._1", "Кол..1", "Кол. .1"],
  UNIT:        ["Кол. (мярка)_1", "Кол. (мярка).1", "Кол.(мярка).1", "Мярка"],
  UPRICE:      ["Ед.цена", "Ед. цена"],
  LCOST:       ["Кр.цена", "Кр. цена"],
  POS:         ["#_1", "#.1", "#"],
};

function erpVidIsTitle(v) { return erpNormKey(v).startsWith("продукт"); }
function erpIsArticleGroup(g) { return erpNormKey(g) === "артикули"; }
function erpNormType(v) {
  const s = erpNormKey(v);
  if (s.startsWith("материал")) return "material";
  if (s.startsWith("стока")) return "goods";
  if (s.startsWith("полуфабрикат")) return "semi";
  if (s.startsWith("услуга")) return "service";
  return "";
}
function erpMapWorkshop(group, name) {
  const s = ((group || "") + " " + (name || "")).toLowerCase();
  if (s.includes("лазер")) return "Лазери";
  if (s.includes("огъв") || s.includes("абкант")) return "Абкант";
  if (s.includes("преса") || s.includes("щанц")) return "Преси";
  if (s.includes("завар")) return "Заваръчно";
  if (s.includes("бояд") || s.includes("прах")) return "Бояджийно";
  if (s.includes("поцинк") || s.includes("галван") || s.includes("гълван")) return "Външна услуга";
  if (s.includes("струг") || s.includes("cnc") || s.includes("фрез")) return "CNC цех";
  return "";
}
function erpMatKey(code, name) { return code ? "c:" + code : "n:" + erpNormKey(name); }
function erpOpKey(code, name) { return code ? "c:" + code : "n:" + erpNormKey(name); }

// Превръща сурови редове (от всички файлове) в „staging" — какво да се upsert-не
// и какви редове от рецепта да се създадат. Кодовете още не са резолвнати в id.
function erpRowsToStaging(rows) {
  const titleProducts = new Map();  // code -> {code,name,group_name,is_semifinished,needs_recipe}
  const childRefs = new Map();      // code -> {code,name,group_name}
  const materials = new Map();      // key -> {code,name,group_name,is_purchased,avg_cost,unit}
  const operations = new Map();     // key -> {code,name,workshop,unit_cost}
  const lineDrafts = [];            // {parentCode,position,quantity,unit,line_cost, compKind, matKey/opKey/childCode}
  const skipped = [];

  for (const row of rows) {
    const get = erpMakeGetter(row);
    const vid = erpStr(get(ERP_COL.VID));
    const parentCode = erpStr(get(ERP_COL.PARENT_CODE));

    if (!vid && !parentCode) continue; // празен ред

    if (erpVidIsTitle(vid)) {
      const code = parentCode || erpStr(get(ERP_COL.CODE));
      if (!code) { skipped.push({ reason: "продукт без код", row }); continue; }
      const group = erpStr(get(ERP_COL.GROUP));
      titleProducts.set(code, {
        code,
        name: erpStr(get(ERP_COL.PARENT_NAME)) || erpStr(get(ERP_COL.ART_NAME)) || code,
        group_name: group || null,
        is_semifinished: !erpIsArticleGroup(group),
        needs_recipe: false,
      });
      continue;
    }

    // ---- съставка ----
    if (!parentCode) { skipped.push({ reason: "съставка без родител", row }); continue; }
    const type = erpNormType(get(ERP_COL.TYPE));
    const compCode = erpStr(get(ERP_COL.CODE));
    const compName = erpStr(get(ERP_COL.ART_NAME));
    const group = erpStr(get(ERP_COL.GROUP));
    let qty = erpToNum(get(ERP_COL.QTY)); if (!qty) qty = 1;
    const unit = erpStr(get(ERP_COL.UNIT));
    const uprice = erpToNum(get(ERP_COL.UPRICE));
    const lcostRaw = get(ERP_COL.LCOST);
    const line_cost = lcostRaw === "" ? null : erpToNum(lcostRaw);
    const posRaw = get(ERP_COL.POS);
    const position = posRaw === "" ? null : Math.round(erpToNum(posRaw));

    const draft = { parentCode, position, quantity: qty, unit: unit || null, line_cost };

    if (type === "material" || type === "goods") {
      const key = erpMatKey(compCode, compName);
      materials.set(key, {
        code: compCode || null,
        name: compName || key,
        group_name: group || null,
        is_purchased: type === "goods",
        avg_cost: uprice,
        unit: unit || (type === "goods" ? "бр." : "кг"),
      });
      draft.compKind = "material"; draft.matKey = key;
    } else if (type === "service") {
      const key = erpOpKey(compCode, compName);
      operations.set(key, {
        code: compCode || null,
        name: compName || key,
        workshop: erpMapWorkshop(group, compName),
        unit_cost: uprice,
      });
      draft.compKind = "operation"; draft.opKey = key;
    } else if (type === "semi") {
      if (!compCode) { skipped.push({ reason: "полуфабрикат без код", row }); continue; }
      if (!childRefs.has(compCode))
        childRefs.set(compCode, { code: compCode, name: compName || compCode, group_name: group || null });
      draft.compKind = "child"; draft.childCode = compCode;
    } else {
      skipped.push({ reason: "непознат Тип: " + erpStr(get(ERP_COL.TYPE)), row });
      continue;
    }
    lineDrafts.push(draft);
  }

  // Осигуряваме, че всеки родител с редове съществува като продукт (дори без заглавен ред).
  for (const d of lineDrafts) {
    if (!titleProducts.has(d.parentCode)) {
      titleProducts.set(d.parentCode, {
        code: d.parentCode, name: d.parentCode, group_name: null,
        is_semifinished: true, needs_recipe: false, synthetic: true,
      });
    }
  }

  return { titleProducts, childRefs, materials, operations, lineDrafts, skipped };
}

/* ==================== ПРИЛАГАНЕ КЪМ БАЗАТА ==================== */

async function erpFetchIndex() {
  const [p, m, o] = await Promise.all([
    sb.from("products").select("id,code,name,needs_recipe"),
    sb.from("materials").select("id,code,name"),
    sb.from("operations").select("id,code,name"),
  ]);
  if (p.error) throw p.error; if (m.error) throw m.error; if (o.error) throw o.error;
  const idx = {
    prodByCode: {}, matByCode: {}, matByName: {}, opByCode: {}, opByName: {},
  };
  (p.data || []).forEach(r => { if (r.code) idx.prodByCode[r.code] = r.id; });
  (m.data || []).forEach(r => { if (r.code) idx.matByCode[r.code] = r.id; if (r.name) idx.matByName[erpNormKey(r.name)] = r.id; });
  (o.data || []).forEach(r => { if (r.code) idx.opByCode[r.code] = r.id; if (r.name) idx.opByName[erpNormKey(r.name)] = r.id; });
  return idx;
}

async function erpChunkInsert(table, rows, opts) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    let q = sb.from(table);
    const { error } = opts && opts.upsert
      ? await q.upsert(chunk, opts.upsert)
      : await q.insert(chunk);
    if (error) throw error;
  }
}

// Прилага staging-а: upsert на продукти/материали/операции, после пресъздава рецептите.
async function erpApplyImport(staging, progress) {
  const log = msg => { if (progress) progress(msg); };
  const before = await erpFetchIndex();

  // 1) Заглавни продукти (артикули + полуфабрикати с рецепта) — needs_recipe=false.
  const titles = [...staging.titleProducts.values()];
  const newTitles = titles.filter(t => !before.prodByCode[t.code]);
  log("Записване на продукти…");
  await erpChunkInsert("products",
    titles.map(t => ({ code: t.code, name: t.name, group_name: t.group_name, is_semifinished: t.is_semifinished, needs_recipe: false })),
    { upsert: { onConflict: "code" } });

  // 2) Заготовки (референции без рецепта) — само нови, без да газим съществуващи.
  const zagotovki = [...staging.childRefs.values()].filter(c =>
    !staging.titleProducts.has(c.code) && !before.prodByCode[c.code]);
  if (zagotovki.length) {
    log("Създаване на заготовки…");
    await erpChunkInsert("products",
      zagotovki.map(c => ({ code: c.code, name: c.name, group_name: c.group_name, is_semifinished: true, needs_recipe: true })),
      { upsert: { onConflict: "code", ignoreDuplicates: true } });
  }

  // 3) Материали (upsert по код; безкодовите — по име, само новите).
  const mats = [...staging.materials.values()];
  const matsCoded = mats.filter(m => m.code);
  const matsCodeless = mats.filter(m => !m.code);
  const newMats = mats.filter(m => (m.code ? !before.matByCode[m.code] : !before.matByName[erpNormKey(m.name)]));
  log("Записване на материали…");
  if (matsCoded.length) await erpChunkInsert("materials", matsCoded, { upsert: { onConflict: "code" } });
  const matsCodelessNew = matsCodeless.filter(m => !before.matByName[erpNormKey(m.name)]);
  if (matsCodelessNew.length) await erpChunkInsert("materials", matsCodelessNew);

  // 4) Операции (upsert по код; безкодовите — по име, само новите).
  const ops = [...staging.operations.values()];
  const opsCoded = ops.filter(o => o.code);
  const opsCodeless = ops.filter(o => !o.code);
  const newOps = ops.filter(o => (o.code ? !before.opByCode[o.code] : !before.opByName[erpNormKey(o.name)]));
  log("Записване на операции…");
  if (opsCoded.length) await erpChunkInsert("operations", opsCoded, { upsert: { onConflict: "code" } });
  const opsCodelessNew = opsCodeless.filter(o => !before.opByName[erpNormKey(o.name)]);
  if (opsCodelessNew.length) await erpChunkInsert("operations", opsCodelessNew);

  // 5) Пресвежаваме индекса (вече с id-та).
  const after = await erpFetchIndex();

  // 6) Изтриваме старите редове на всички засегнати заглавни продукти (идемпотентност).
  const titleIds = titles.map(t => after.prodByCode[t.code]).filter(Boolean);
  log("Пресъздаване на рецептите…");
  for (let i = 0; i < titleIds.length; i += 100) {
    const { error } = await sb.from("recipe_lines").delete().in("product_id", titleIds.slice(i, i + 100));
    if (error) throw error;
  }

  // 7) Строим новите redove на рецептите.
  const lineRows = [];
  let unresolved = 0;
  const docSet = new Set();
  for (const d of staging.lineDrafts) {
    const parentId = after.prodByCode[d.parentCode];
    if (!parentId) { unresolved++; continue; }
    const row = { product_id: parentId, position: d.position, quantity: d.quantity, unit: d.unit, line_cost: d.line_cost };
    if (d.compKind === "material") {
      const m = staging.materials.get(d.matKey);
      const id = (m && m.code && after.matByCode[m.code]) || (m && after.matByName[erpNormKey(m.name)]);
      if (!id) { unresolved++; continue; }
      row.material_id = id;
    } else if (d.compKind === "operation") {
      const o = staging.operations.get(d.opKey);
      const id = (o && o.code && after.opByCode[o.code]) || (o && after.opByName[erpNormKey(o.name)]);
      if (!id) { unresolved++; continue; }
      row.operation_id = id;
    } else if (d.compKind === "child") {
      const id = after.prodByCode[d.childCode];
      if (!id || id === parentId) { unresolved++; continue; } // пази no_self_reference
      row.child_product_id = id;
    } else continue;
    lineRows.push(row);
    docSet.add(parentId);
  }
  if (lineRows.length) await erpChunkInsert("recipe_lines", lineRows);

  // 8) Списък „Чака рецепта" (актуален от базата).
  const { data: needsData } = await sb.from("products")
    .select("code,name,group_name").eq("needs_recipe", true).order("group_name");
  const needs = needsData || [];
  const needsByGroup = {};
  needs.forEach(n => { const g = n.group_name || "—"; needsByGroup[g] = (needsByGroup[g] || 0) + 1; });

  return {
    products: { total: titles.length, new: newTitles.length, updated: titles.length - newTitles.length },
    zagotovki: zagotovki.length,
    materials: { total: mats.length, new: newMats.length },
    operations: { total: ops.length, new: newOps.length },
    recipes: { documents: docSet.size, lines: lineRows.length, unresolved },
    needs: { total: needs.length, byGroup: needsByGroup, list: needs },
    skipped: staging.skipped.length,
  };
}

/* ==================== ЕКРАН „ИМПОРТ" ==================== */

let erpImportFiles = [];   // [{name, rows:[...]}]
let erpImportBusy = false;

function erpRenderImport() {
  const v = erpView();
  const totalRows = erpImportFiles.reduce((s, f) => s + f.rows.length, 0);
  v.innerHTML = `
    <div class="erp-import">
      <p class="hint">Качи един или няколко Bizzio експорта (.xlsx). Импортът е идемпотентен —
        повторно качване на същия файл не създава дубли.</p>
      <div class="erp-toolbar">
        <label class="btn btn-small btn-primary" for="erp-xlsx">⤓ Избери файлове (.xlsx)</label>
        <input type="file" id="erp-xlsx" accept=".xlsx,.xls" multiple hidden />
        <button class="btn btn-small" id="erp-import-clear" ${erpImportFiles.length ? "" : "disabled"}>Изчисти</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="erp-import-run" ${erpImportFiles.length ? "" : "disabled"}>Стартирай импорт</button>
      </div>
      ${erpImportFiles.length ? `
        <p class="erp-count">${erpImportFiles.length} файл(а), общо ${totalRows} реда:</p>
        <ul class="erp-file-list">${erpImportFiles.map(f => `<li>📄 ${escapeHtml(f.name)} — ${f.rows.length} реда</li>`).join("")}</ul>
        ${erpImportPreview(erpImportFiles[0].rows)}
      ` : ""}
      <div id="erp-import-report"></div>
    </div>`;

  document.getElementById("erp-xlsx").addEventListener("change", erpOnFilesChosen);
  document.getElementById("erp-import-clear").addEventListener("click", () => { erpImportFiles = []; erpRenderImport(); });
  document.getElementById("erp-import-run").addEventListener("click", erpRunImport);
}

function erpImportPreview(rows) {
  const sample = rows.slice(0, 6);
  const cols = ["Вид", "Продукт (код)", "Тип", "Група", "Артикул", "Код", "Кол..1", "Кол. (мярка).1", "Ед.цена"];
  return `
    <h4 class="erp-group-head">Преглед (първи редове)</h4>
    <div class="erp-scroll"><table class="report-table erp-table erp-preview">
      <thead><tr>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${sample.map(r => { const g = erpMakeGetter(r);
        return `<tr>${cols.map(c => `<td>${escapeHtml(erpStr(g([c])))}</td>`).join("")}</tr>`; }).join("")}</tbody>
    </table></div>`;
}

async function erpOnFilesChosen(e) {
  const files = [...e.target.files];
  e.target.value = "";
  const report = document.getElementById("erp-import-report");
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      erpImportFiles.push({ name: file.name, rows });
    } catch (err) {
      if (report) report.innerHTML = `<p class="erp-warn">Проблем с „${escapeHtml(file.name)}": ${escapeHtml(err.message || String(err))}</p>`;
    }
  }
  erpRenderImport();
}

async function erpRunImport() {
  if (erpImportBusy || !erpImportFiles.length) return;
  erpImportBusy = true;
  const report = document.getElementById("erp-import-report");
  const runBtn = document.getElementById("erp-import-run");
  if (runBtn) runBtn.disabled = true;
  report.innerHTML = `<p class="erp-loading">Импортиране…</p>`;
  try {
    const allRows = erpImportFiles.reduce((acc, f) => acc.concat(f.rows), []);
    const staging = erpRowsToStaging(allRows);
    const rep = await erpApplyImport(staging, msg => { report.innerHTML = `<p class="erp-loading">${escapeHtml(msg)}</p>`; });
    report.innerHTML = erpImportReportHtml(rep);
    erpImportFiles = [];
    await erpLoadAll(); // опресняваме кешовете за другите екрани
  } catch (err) {
    report.innerHTML = `<div class="erp-error"><h3>Грешка при импорт</h3><p>${escapeHtml(err.message || String(err))}</p>` +
      `<p class="hint">Провери дали е пуснат <code>erp-setup.sql</code> в Supabase.</p></div>`;
  } finally {
    erpImportBusy = false;
  }
}

function erpImportReportHtml(r) {
  const groups = Object.entries(r.needs.byGroup)
    .map(([g, n]) => `${escapeHtml(g)}: <strong>${n}</strong>`).join(" · ");
  return `
    <div class="erp-report-box">
      <h3>✅ Импортът приключи</h3>
      <ul class="erp-report-list">
        <li>Продукти: <strong>${r.products.total}</strong> (нови ${r.products.new}, обновени ${r.products.updated})</li>
        <li>Заготовки (нови, чакащи рецепта): <strong>${r.zagotovki}</strong></li>
        <li>Материали: <strong>${r.materials.total}</strong> (нови ${r.materials.new})</li>
        <li>Операции: <strong>${r.operations.total}</strong> (нови ${r.operations.new})</li>
        <li>Рецепти: <strong>${r.recipes.documents}</strong> документа, ${r.recipes.lines} реда${r.recipes.unresolved ? ` · <span class="erp-warn">${r.recipes.unresolved} нерезолвнати</span>` : ""}</li>
        ${r.skipped ? `<li class="erp-warn">Прескочени редове: ${r.skipped}</li>` : ""}
      </ul>
      <h4 class="erp-group-head">Чака рецепта: ${r.needs.total}</h4>
      <p class="erp-muted">${groups || "—"}</p>
      <p class="hint">Виж пълния списък в таба „Чака рецепта".</p>
    </div>`;
}

// Изнасяме чистите функции за тестване извън браузъра (Node).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { erpRowsToStaging, erpNormType, erpVidIsTitle, erpIsArticleGroup, erpMapWorkshop, erpNormKey, erpMakeGetter };
}
