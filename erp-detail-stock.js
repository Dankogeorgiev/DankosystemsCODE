/* Данко Системс — Склад за детайли/полуфабрикати.
   Наличност на готовите детайли/възли (не суровини). При пускане в производство
   системата приспада наличното и праща в цех само недостига (виж erpFlowApply).
   Наличност = сбор от движенията (начално / заприходяване / изписване / корекция).
   Ползва erp-detail-stock.sql (таблица product_movements + изглед v_product_stock). */

let DS_TERM = "";
let DS_ONLY_STOCK = false;
let DS_HAS_DRAW = new Set();   // id-та на продукти с поне един чертеж (за оцветяване на бутона)

// Чете ВСИЧКИ продукти (със странициране — Supabase връща макс. 1000 наведнъж).
async function dsFetchAllProducts(cols) {
  const out = []; const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb.from("products").select(cols).range(from, from + CHUNK - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  return out;
}
// Зарежда наведнъж кои продукти имат чертежи (products.drawings непразно).
async function dsLoadHasDrawings() {
  DS_HAS_DRAW = new Set();
  try {
    const rows = await dsFetchAllProducts("id,drawings");
    rows.forEach(r => { if (Array.isArray(r.drawings) && r.drawings.length) DS_HAS_DRAW.add(Number(r.id)); });
  } catch (e) { /* при грешка бутоните остават неоцветени */ }
}
// Има ли продуктът чертеж? Зареденото в паметта има превес (за да отразява промени).
function dsHasDrawing(p) {
  if (Array.isArray(p.drawings)) return p.drawings.length > 0;
  return DS_HAS_DRAW.has(Number(p.id));
}

// Кои продукти са „детайли/възли" (не крайни артикули без рецепта-предназначение):
// показваме полуфабрикатите + всичко, което участва в рецепта на друг продукт.
function dsIsDetail(p) {
  if (p.is_semifinished) return true;
  const g = (p.group_name || "").toLowerCase();
  if (g.includes("детайл") || g.includes("възл") || g.includes("полуфабрикат") || g.includes("заготов")) return true;
  return false;
}
// В списъка показваме и всичко, което реално има наличност/движения (готова
// продукция от заявки), за да не „изчезва", ако още не е класифицирано.
function dsShowInStock(p) {
  return dsIsDetail(p) || (Number(p.stock) || 0) !== 0;
}

// Опреснява наличностите на продуктите от v_product_stock (готовото, заприходено
// от производствената дъска, не минава през ERP кеша — затова презареждаме тук).
async function dsRefreshStock() {
  try {
    const { data, error } = await erpSelectAll("v_product_stock", "id,stock");
    if (error) return;
    const byId = {}; (data || []).forEach(r => { byId[r.id] = Number(r.stock) || 0; });
    (ERP.products || []).forEach(p => { p.stock = byId[p.id] != null ? byId[p.id] : 0; });
  } catch (e) { /* при грешка оставаме на кешираните стойности */ }
}

async function erpRenderDetailStock() {
  try { await erpEnsureLoaded(); }
  catch (e) { erpView().innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  await dsRefreshStock();   // винаги свежи наличности (готовото от цеха се вижда веднага)

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
      <button type="button" class="btn btn-small" id="ds-draw-check" title="Сверява записаните чертежи с реалните файлове в облака">🔎 Провери чертежите</button>
      <button type="button" class="btn btn-small" id="ds-fixcls" title="Намира продукти, ползвани като части в рецепти, но маркирани като артикул — и ги оправя, за да влязат тук">🔧 Провери класификацията</button>
      <button type="button" class="btn btn-small" id="ds-dedup" title="Открива продукти с еднакъв код, заведени два пъти (наличността на единия, рецептата на другия) — и ги обединява">🔗 Дублирани по код</button>
      <button type="button" class="btn btn-small btn-danger" id="ds-reset" title="За тестване: връща склада ТОЧНО до внесената база — трие движенията от пускане/производство/продажба и поточните задачи. Внесените наличности НЕ се пипат.">🧪 Нулирай тестови движения</button>
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
  const dc = document.getElementById("ds-draw-check");
  if (dc) dc.addEventListener("click", dsCheckDrawings);
  const fc = document.getElementById("ds-fixcls");
  if (fc) fc.addEventListener("click", dsFixClassification);
  const dd = document.getElementById("ds-dedup");
  if (dd) dd.addEventListener("click", dsFindDuplicates);
  const rs = document.getElementById("ds-reset");
  if (rs) rs.addEventListener("click", dsResetTestMovements);
  dsFillRows();
  if (q) q.focus();
  // Зареждаме кои имат чертежи и оцветяваме бутоните (без да чакаме за самата таблица).
  dsLoadHasDrawings().then(() => dsFillRows());
}

// Пълни само редовете на таблицата според текущото търсене/филтър (без да
// пипа търсачката) — така фокусът остава и се пише плавно.
function dsFillRows() {
  const tbody = document.getElementById("ds-tbody");
  if (!tbody) return;
  let list = ERP.products.filter(dsShowInStock);
  if (DS_TERM) { const q = DS_TERM.toLowerCase().trim(); list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q)); }
  if (DS_ONLY_STOCK) list = list.filter(p => (Number(p.stock) || 0) > 0);
  list.sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0) || (a.name || "").localeCompare(b.name || "", "bg"));

  const shown = list.slice(0, 300);
  tbody.innerHTML = shown.map(p => `
    <tr>
      <td data-label="Код"><b>${escapeHtml(p.code || "")}</b></td>
      <td data-label="Детайл">${escapeHtml(p.name || "")} <span class="erp-muted">#${p.id}</span>${p.is_semifinished ? ` <span class="erp-muted">възел</span>` : ""}</td>
      <td class="num" data-label="Наличност"><b class="${(Number(p.stock) || 0) > 0 ? "" : "erp-muted"}">${erpNum(Number(p.stock) || 0)}</b> ${escapeHtml(p.unit || "бр.")}</td>
      <td data-label="Движение">
        <button type="button" class="btn btn-small btn-primary ds-prod" data-id="${p.id}" title="Пусни по цеховете; готовото влиза тук">🏭 произведи</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="заприходяване">＋ заприходи</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="изписване">− изпиши</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="корекция">✎ наличност</button>
        <button type="button" class="btn btn-small ds-draw${dsHasDrawing(p) ? " ds-draw-has" : ""}" data-id="${p.id}" title="${dsHasDrawing(p) ? "Има прикачен чертеж" : "Няма чертеж"}">📎 чертежи</button>
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

/* ---------- Нулиране на тестовите движения (връща склада до внесената база) ----------
   Всичко, което цикълът (пускане→производство→продажба) записва, е с ЕТИКЕТ:
     product_movements:  order: / prod: / sale: / orderdone:
     stock_movements:     order: / sale:
   Внесената начална наличност е „корекция" БЕЗ етикет и покупките имат друг етикет,
   затова триенето по тези етикети връща склада точно до внесеното, без да пипа базата.
   За тестване: пусни заявка на живо → провери целия цикъл → нулирай → почни чисто. */
async function dsResetTestMovements() {
  const msg = "⚠ НУЛИРАНЕ НА ТЕСТОВИТЕ ДВИЖЕНИЯ\n\n"
    + "Връща склада ТОЧНО до внесената база.\n\n"
    + "ЩЕ СЕ ИЗТРИЯТ:\n"
    + "• движенията от пускане/производство/продажба\n"
    + "   (етикети order: / prod: / sale: / orderdone:)\n"
    + "• всички поточни задачи по цеховете\n"
    + "• флагът „в производство“ на заявките (стават чакащи)\n\n"
    + "ЩЕ ОСТАНАТ НЕПОКЪТНАТИ:\n"
    + "• внесените начални наличности (корекции без етикет)\n"
    + "• материалният склад от покупки\n"
    + "• рецепти, продукти, заявки (само флагът се маха)\n\n"
    + "Продължавам?";
  if (!confirm(msg)) return;
  const typed = prompt("За потвърждение напиши с ГЛАВНИ букви:  НУЛИРАЙ");
  if ((typed || "").trim() !== "НУЛИРАЙ") { alert("Отказано — текстът не съвпадна."); return; }

  const log = [];
  try {
    // 1) Движения в Склад детайли (готово, нетване, продажби, ръчно заприходено).
    for (const pfx of ["order:", "prod:", "sale:", "orderdone:"]) {
      const { error } = await sb.from("product_movements").delete().like("ref", pfx + "%");
      if (error) throw new Error("детайлни движения (" + pfx + "): " + error.message);
    }
    // 2) Материални движения от пускане и от продажби (покупките имат друг етикет).
    for (const pfx of ["order:", "sale:"]) {
      const { error } = await sb.from("stock_movements").delete().like("ref", pfx + "%");
      if (error) throw new Error("материални движения (" + pfx + "): " + error.message);
    }
    // 3) Поточни задачи по цеховете.
    const { error: tErr } = await sb.from("tasks").delete().eq("data->source->>flow", "true");
    if (tErr) throw new Error("поточни задачи: " + tErr.message);
    // 4) Флаг „в производство“ по заявките — за да станат отново чакащи.
    for (const tbl of ["samples", "customer_orders"]) {
      let rows = [];
      try {
        const { data, error } = await sb.from(tbl).select("id,data").not("data->production", "is", null);
        if (error) throw error;
        rows = data || [];
      } catch (e) {
        // Резервен вариант: изтегли всички и филтрирай локално.
        const { data } = await sb.from(tbl).select("id,data");
        rows = (data || []).filter(r => r && r.data && r.data.production);
      }
      for (const r of rows) {
        const d = r.data || {}; delete d.production;
        const { error } = await sb.from(tbl).update({ data: d, updated_at: new Date().toISOString() }).eq("id", r.id);
        if (error) throw new Error(tbl + " флаг: " + error.message);
      }
      log.push(tbl + ": " + rows.length + " заявки върнати в чакащи");
    }
  } catch (e) {
    alert("Грешка при нулиране: " + (e.message || e) + "\n\nНякои неща може да са изтрити частично — може да натиснеш нулиране пак.");
    return;
  }

  try { await erpLoadAll(); } catch (e) {}
  if (typeof erpRenderDetailStock === "function") erpRenderDetailStock();
  alert("✅ Нулирано — складът е върнат до внесената база.\n" + log.join("\n")
    + "\n\nПрезареди страницата (Ctrl+F5), за да се опреснят списъците със заявки.");
}

/* ---------- Поправка на класификацията (детайл/възел ↔ артикул) ----------
   Импортът налучква is_semifinished по името на групата, затова много части
   остават като „артикул" и не влизат в Склад детайли. Тук ползваме сигурния
   сигнал: продукт, ползван като част (child_product_id) в нечия рецепта, е
   детайл/възел → маркираме го като полуфабрикат, за да се следи тук. */
async function dsFixClassification() {
  const usedAsChild = new Set();
  (ERP.lines || []).forEach(l => { if (l.child_product_id) usedAsChild.add(Number(l.child_product_id)); });
  // Ползват се като части, но са маркирани „артикул" → трябва да станат възли.
  const toSemi = ERP.products.filter(p => usedAsChild.has(Number(p.id)) && !p.is_semifinished)
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", "bg"));
  // Само за сведение: маркирани „възел", но никъде не се ползват и нямат рецепта.
  const orphanSemi = ERP.products.filter(p => p.is_semifinished && !usedAsChild.has(Number(p.id)) && !((ERP.linesByProduct[p.id] || []).length));

  const { wrap, close } = erpDialog(`
    <h3>🔧 Проверка на класификацията</h3>
    <p class="hint">Правило: продукт, който се ползва като <b>част в рецептата на друг продукт</b>, е <b>детайл/възел</b> и трябва да се следи в Склад детайли. Импортът често ги е оставил като „артикул".</p>
    <p><b>${toSemi.length}</b> продукта се ползват като части, но са маркирани „артикул" — затова не влизат в Склад детайли.</p>
    ${toSemi.length ? `<div class="dc-list" style="max-height:320px;overflow:auto"><table class="report-table erp-table"><thead><tr><th>Код</th><th>Име</th><th>Сега</th></tr></thead><tbody>${
      toSemi.slice(0, 500).map(p => `<tr><td><b>${escapeHtml(p.code || "")}</b></td><td>${escapeHtml(p.name || "")}</td><td class="erp-muted">артикул</td></tr>`).join("")
    }</tbody></table>${toSemi.length > 500 ? `<p class="erp-muted">…и още ${toSemi.length - 500}</p>` : ""}</div>` : `<p class="erp-ready-ok">Няма продукти за поправка 👍</p>`}
    ${orphanSemi.length ? `<p class="hint erp-muted">ℹ Има и ${orphanSemi.length} продукта, маркирани „възел", които никъде не се ползват и нямат рецепта — <b>не ги пипам</b> (само за сведение).</p>` : ""}
    <div class="erp-dialog-actions">
      <button class="btn" id="dfc-cancel">Затвори</button>
      ${toSemi.length ? `<button class="btn btn-primary" id="dfc-go">✔ Маркирай ${toSemi.length} като детайл/възел</button>` : ""}
    </div>
    <p class="save-status" id="dfc-status"></p>`);
  wrap.querySelector("#dfc-cancel").addEventListener("click", close);
  const go = wrap.querySelector("#dfc-go");
  if (go) go.addEventListener("click", async () => {
    go.disabled = true;
    const st = wrap.querySelector("#dfc-status"); st.textContent = "Записва…";
    const ids = toSemi.map(p => Number(p.id));
    let done = 0, err = null;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await sb.from("products").update({ is_semifinished: true }).in("id", chunk);
      if (error) { err = error; break; }
      done += chunk.length;
      st.textContent = `Записани ${done}/${ids.length}…`;
    }
    if (err) { st.textContent = "⚠ Грешка: " + err.message; go.disabled = false; return; }
    await erpLoadAll();
    close();
    erpRenderDetailStock();
    alert(`Готово! ${done} продукта са маркирани като детайл/възел и вече ще се следят в Склад детайли.`);
  });
}

/* ---------- Обединяване на дублирани продукти по код ----------
   Понякога един и същ детайл е заведен два пъти (напр. единият дошъл от импорта на
   рецептата, другият създаден ръчно със склад). Тъй като всичко се свързва по вътрешен
   id (не по код), наличността „виси" на единия, а рецептата ползва другия → нетването
   при пускане в производство не ги засича. Тук ги обединяваме в един запис. */
function dsCodeKey(p) { return String((p && p.code) || "").trim().toLowerCase(); }
function dsNameKey(p) { return String((p && p.name) || "").trim().toLowerCase(); }
// Ползва ли се продуктът като вложен детайл (child) и има ли собствена рецепта (parent)?
function dsProductUsage(pid) {
  let asChild = 0;
  (ERP.lines || []).forEach(l => { if (String(l.child_product_id) === String(pid)) asChild++; });
  const asParent = (ERP.linesByProduct[pid] || []).length;
  return { asChild, asParent };
}
// Групи дубликати по КОД и по ИМЕ (понякога дублирането е на името, не на кода).
function dsDuplicateGroups() {
  const out = [], seen = new Set();
  const collect = (keyFn, by) => {
    const map = {};
    (ERP.products || []).forEach(p => { const k = keyFn(p); if (!k) return; (map[k] = map[k] || []).push(p); });
    Object.values(map).forEach(arr => {
      if (arr.length < 2) return;
      const sig = arr.map(p => p.id).sort((a, b) => a - b).join(",");
      if (seen.has(sig)) return;   // не показвай един и същ набор два пъти
      seen.add(sig);
      out.push({ by, items: arr });
    });
  };
  collect(dsCodeKey, "код");
  collect(dsNameKey, "име");
  return out;
}

function dsFindDuplicates() {
  const groups = dsDuplicateGroups();
  const groupHtml = (g, gi) => {
    const arr = g.items;
    const rows = arr.map(p => {
      const u = dsProductUsage(p.id);
      const score = u.asChild * 2 + u.asParent * 2 + ((Number(p.stock) || 0) > 0 ? 1 : 0);
      return { p, u, score };
    }).sort((a, b) => b.score - a.score);
    const keeperId = rows[0].p.id;   // по подразбиране най-свързаният с рецепти
    const bothRecipes = rows.filter(r => r.u.asParent > 0).length > 1;
    const body = rows.map(r => `<tr>
      <td><input type="radio" name="keep-${gi}" value="${r.p.id}" ${r.p.id === keeperId ? "checked" : ""} /></td>
      <td>${escapeHtml(r.p.code || "")}</td>
      <td>${escapeHtml(r.p.name || "")} <span class="erp-muted">#${r.p.id}</span></td>
      <td class="num">${erpNum(Number(r.p.stock) || 0)}</td>
      <td>${r.p.is_semifinished ? "възел" : "артикул"}</td>
      <td class="num">${r.u.asChild}</td>
      <td>${r.u.asParent ? "да" : "—"}</td>
    </tr>`).join("");
    const title = g.by === "код" ? `Код <b>${escapeHtml(arr[0].code || "")}</b>` : `Име <b>${escapeHtml(arr[0].name || "")}</b>`;
    return `<div class="ds-dupgroup">
      <h4 style="margin:6px 0">${title} — ${arr.length} записа <span class="erp-muted">(дублиран ${g.by})</span></h4>
      <table class="report-table erp-table"><thead><tr><th>Запази</th><th>Код</th><th>Име</th><th class="num">Наличност</th><th>Тип</th><th class="num">Като детайл</th><th>Рецепта</th></tr></thead><tbody>${body}</tbody></table>
      ${bothRecipes ? `<p class="erp-warn">⚠ Повече от един запис има собствена рецепта — обединяването ще ги слее. Провери внимателно преди да продължиш.</p>` : ""}
      <div style="text-align:right;margin:4px 0 2px"><button class="btn btn-small btn-primary ds-merge" data-gi="${gi}">🔗 Обедини в избрания</button></div>
    </div>`;
  };
  const { wrap, close } = erpDialog(`
    <h3>🔗 Дублирани продукти по код или име</h3>
    <p class="hint">Продукти, заведени повече от веднъж с <b>еднакъв код ИЛИ еднакво име</b> (напр. наличността на единия, рецептата на другия — затова нетването не ги засича). Избери кой запис да <b>остане</b> (по подразбиране — най-свързаният с рецепти) и натисни „Обедини". Наличността, рецептите и връзките на другия се <b>прехвърлят</b> към него. По подразбиране дубликатът <b>НЕ се трие</b> — само остава празен (нищо не се губи). Може по избор да го изтриеш.</p>
    <label class="erp-check" style="margin:0 0 8px"><input type="checkbox" id="dd-delete" /> 🗑 Изтрий празния дубликат след обединяване (по избор)</label>
    <div class="ds-manual" style="border:1px dashed var(--line,#cbd5e1);border-radius:10px;padding:10px;margin:0 0 10px;background:#f8fafc">
      <b>✋ Ръчно обединяване</b> <span class="erp-muted">— когато кодовете И имената са различни (напр. след преименуване). Търси и избери двата записа от списъка.</span>
      <datalist id="dm-products">${(ERP.products || []).map(p => `<option value="${escapeAttr((p.code || "") + " · " + (p.name || "") + " · #" + p.id)}"></option>`).join("")}</datalist>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:6px">
        <label class="erp-inline" style="flex-direction:column;align-items:flex-start">Запази (остава)<input list="dm-products" id="dm-keep" placeholder="търси код/име" style="min-width:240px" /></label>
        <label class="erp-inline" style="flex-direction:column;align-items:flex-start">Обедини в него (трие се)<input list="dm-products" id="dm-dup" placeholder="търси код/име" style="min-width:240px" /></label>
        <button class="btn btn-small btn-primary" id="dm-merge">🔗 Обедини ръчно</button>
      </div>
    </div>
    <div class="ds-dup-list" style="max-height:50vh;overflow:auto">${groups.length ? groups.map(groupHtml).join("<hr/>") : `<p class="erp-ready-ok">Няма автоматично открити дубликати. Ако знаеш два записа за едно нещо — ползвай „Ръчно обединяване" горе.</p>`}</div>
    <div class="erp-dialog-actions"><button class="btn" id="dd-close">Затвори</button></div>
    <p class="save-status" id="dd-status"></p>`);
  wrap.querySelector("#dd-close").addEventListener("click", close);
  const dmMerge = wrap.querySelector("#dm-merge");
  if (dmMerge) dmMerge.addEventListener("click", async () => {
    const pid = s => { const m = /#(\d+)\s*$/.exec(String(s || "")); return m ? Number(m[1]) : null; };
    const keeperId = pid(wrap.querySelector("#dm-keep").value);
    const dupId = pid(wrap.querySelector("#dm-dup").value);
    if (!keeperId || !dupId) { alert("Избери и двата продукта от падащия списък (да съдържат #номер)."); return; }
    if (keeperId === dupId) { alert("Избери два различни записа."); return; }
    const keeper = ERP.prodById[keeperId], dup = ERP.prodById[dupId];
    if (!keeper || !dup) { alert("Един от продуктите не е намерен. Избери от списъка."); return; }
    const deleteDup = !!(wrap.querySelector("#dd-delete") || {}).checked;
    if (!confirm(`Да обединя ли „${dup.code || ""} ${dup.name || ""}" (#${dupId}) в „${keeper.code || ""} ${keeper.name || ""}" (#${keeperId})?\n\nНаличността, рецептите и връзките минават към записа, който остава.\n${deleteDup ? "Дубликатът ще бъде изтрит." : "Дубликатът остава празен (не се трие)."}`)) return;
    dmMerge.disabled = true;
    const st = wrap.querySelector("#dd-status"); if (st) st.textContent = "Обединявам…";
    const res = await dsMergeInto(keeperId, [dupId], { deleteDup });
    if (res.error) { if (st) st.textContent = "⚠ " + res.error; dmMerge.disabled = false; return; }
    await erpLoadAll();
    close();
    erpRenderDetailStock();
    alert(`Готово! Прехвърлен запис #${dupId} в #${keeperId}.`
      + (res.jsonFixed ? `\nПренасочени ${res.jsonFixed} връзки (мостри/заявки/продажби/цени).` : "")
      + (res.deleteDup ? `\nДубликатът е изтрит.` : `\nДубликатът остана празен (не е изтрит).`));
  });
  wrap.querySelectorAll(".ds-merge").forEach(b => b.addEventListener("click", async () => {
    const gi = Number(b.dataset.gi);
    const grp = (groups[gi] && groups[gi].items) || [];
    const sel = wrap.querySelector(`input[name="keep-${gi}"]:checked`);
    if (!sel) { alert("Избери кой запис да остане."); return; }
    const keeperId = Number(sel.value);
    const dupIds = grp.filter(p => Number(p.id) !== keeperId).map(p => Number(p.id));
    const keeper = grp.find(p => Number(p.id) === keeperId) || {};
    const deleteDup = !!(wrap.querySelector("#dd-delete") || {}).checked;
    if (!confirm(`Да обединя ли ${dupIds.length} дубликат(а) в „${keeper.code || ""} ${keeper.name || ""}" (#${keeperId})?\n\nНаличността и рецептите им се прехвърлят към този запис.\n${deleteDup ? "Дубликатите ще бъдат изтрити." : "Дубликатите остават празни (не се трият)."}`)) return;
    b.disabled = true;
    const st = wrap.querySelector("#dd-status"); if (st) st.textContent = "Обединявам…";
    const res = await dsMergeInto(keeperId, dupIds, { deleteDup });
    if (res.error) { if (st) st.textContent = "⚠ " + res.error; b.disabled = false; return; }
    await erpLoadAll();
    close();
    erpRenderDetailStock();
    alert(`Готово! Прехвърлени ${res.consolidated} записа в #${keeperId}.`
      + (res.jsonFixed ? `\nПренасочени ${res.jsonFixed} връзки в мостри/заявки/продажби/ценови листи.` : "")
      + (res.deleteDup ? `\nИзтрити ${res.deleted} дубликата.` : `\nДубликатите останаха празни (не са изтрити).`)
      + (res.notDeleted ? `\n(${res.notDeleted} не можаха да се изтрият — безобидни, празни.)` : ""));
  }));
}

// Прехвърля ВСИЧКИ референции от дубликатите към keeper.
// 1) DB таблици с FK (пренасочваме ПРЕДИ евентуално триене).
// 2) JSONB референции без FK (мостри/заявки/продажби/ценови листи) — тихо чупене, затова и тях.
// 3) Дубликатът се трие САМО ако opts.deleteDup === true; иначе остава празен (безобиден).
async function dsMergeInto(keeperId, dupIds, opts) {
  const K = Number(keeperId);
  const deleteDup = !!(opts && opts.deleteDup);
  const dupSet = new Set(dupIds.map(Number));
  const isDup = v => v != null && dupSet.has(Number(v));
  let deleted = 0, notDeleted = 0, jsonFixed = 0;

  // 1) DB таблици с FK
  for (const D of dupIds) {
    let r = await sb.from("product_movements").update({ product_id: K }).eq("product_id", D);
    if (r.error) return { error: "движения: " + r.error.message };
    r = await sb.from("recipe_lines").update({ child_product_id: K }).eq("child_product_id", D);
    if (r.error) return { error: "рецепти (вложен): " + r.error.message };
    r = await sb.from("recipe_lines").update({ product_id: K }).eq("product_id", D);
    if (r.error) return { error: "рецепти (родител): " + r.error.message };
  }

  // 2) JSONB референции (без FK — пренасочваме ръчно, за да не се счупи тихо)
  try {
    const { data } = await erpSelectAll("samples", "id,data");
    for (const row of (data || [])) { const d = row.data || {}; if (isDup(d.erpProductId)) { d.erpProductId = K; await sb.from("samples").update({ data: d }).eq("id", row.id); jsonFixed++; } }
  } catch (e) { /* таблицата може да липсва */ }
  try {
    const { data } = await erpSelectAll("customer_orders", "id,data");
    for (const row of (data || [])) { const d = row.data || {}; let ch = false; (d.lines || []).forEach(l => { if (isDup(l.productId)) { l.productId = K; ch = true; } }); if (ch) { await sb.from("customer_orders").update({ data: d, updated_at: new Date().toISOString() }).eq("id", row.id); jsonFixed++; } }
  } catch (e) {}
  try {
    const { data } = await erpSelectAll("sales", "id,data,posted");
    for (const row of (data || [])) { const d = row.data || {}; let ch = false; (d.lines || []).forEach(l => { if (l.itemKind === "product" && isDup(l.refId)) { l.refId = K; ch = true; } }); if (ch) { await sb.from("sales").update({ data: d, posted: !!row.posted, updated_at: new Date().toISOString() }).eq("id", row.id); jsonFixed++; } }
  } catch (e) {}
  try {
    const { data } = await sb.from("app_config").select("id,data").like("id", "pricelist_%");
    for (const row of (data || [])) { const d = row.data || {}, ent = d.entries || {}; let ch = false; dupIds.forEach(D => { if (ent[D] != null) { if (ent[K] == null) ent[K] = ent[D]; delete ent[D]; ch = true; } }); if (ch) { d.entries = ent; await sb.from("app_config").update({ data: d, updated_at: new Date().toISOString() }).eq("id", row.id); jsonFixed++; } }
  } catch (e) {}

  // 3) Триене — само по изричен избор. Иначе дубликатът остава празен (0 наличност, без рецепта).
  if (deleteDup) {
    for (const D of dupIds) {
      const del = await sb.from("products").delete().eq("id", D);
      if (del.error) notDeleted++; else deleted++;
    }
  }
  return { consolidated: dupIds.length, deleted, notDeleted, jsonFixed, deleteDup };
}

// Индекс по код (веднъж), сортиран по дължина — за бързо и точно разпознаване.
function dsBuildCodeIndex(products) {
  const byCode = {}; const list = [];
  (products || []).forEach(p => { const c = String(p.code || "").trim().toLowerCase(); if (c) { byCode[c] = p; list.push({ p, c }); } });
  list.sort((a, b) => b.c.length - a.c.length);
  return { byCode, list };
}
// Намира продукт по името на файла — кодът може да е НАВСЯКЪДЕ в името
// (като отделна „дума" или ограден от небуквено-цифрови знаци), не само отпред.
function dsMatchProductByFilename(base, idx) {
  const b = String(base || "").trim().toLowerCase();
  if (!b) return null;
  const { byCode, list } = idx;
  // 1) Кодът като отделна „дума" някъде в името (дължина >= 3, за да не хване „3мм").
  const tokens = b.split(/[\s._\-–—()\[\]]+/).filter(t => t.length >= 3);
  for (const t of tokens) { if (byCode[t]) return byCode[t]; }
  // 2) Най-дългият код, с който името започва на граница (кодове със знаци/тирета).
  for (const o of list) {
    if (b.startsWith(o.c) && (b.length === o.c.length || /[^a-z0-9]/i.test(b[o.c.length]))) return o.p;
  }
  // 3) Кодът се съдържа някъде в името, ограден от небуквено-цифрови граници.
  for (const o of list) {
    if (o.c.length < 3) continue;
    const i = b.indexOf(o.c);
    if (i < 0) continue;
    const before = i === 0 ? "" : b[i - 1];
    const after = b[i + o.c.length] || "";
    if ((before === "" || /[^a-z0-9]/i.test(before)) && (after === "" || /[^a-z0-9]/i.test(after))) return o.p;
  }
  return null;
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

// Стъпка 1: разпознаване + ПРЕГЛЕД (какво е разпознато и какво не) преди качване.
async function dsBulkDrawings(rawFiles) {
  const files = await dsExpandFiles(rawFiles || []);
  if (!files.length) { alert("Няма чертежи за качване (архивът е празен или няма разпознати файлове)."); return; }
  const idx = dsBuildCodeIndex(ERP.products || []);
  const groups = new Map();        // pid -> { p, files: [] }
  const unmatched = [];
  files.forEach(f => {
    const base = f.name.replace(/\.[^.]+$/, "");
    const p = dsMatchProductByFilename(base, idx);
    if (!p) { unmatched.push(f.name); return; }
    if (!groups.has(p.id)) groups.set(p.id, { p, files: [] });
    groups.get(p.id).files.push(f);
  });
  dsBulkPreview(groups, unmatched, files.length);
}

// Прегледен диалог: показва разпознати/неразпознати и чак тогава качва.
function dsBulkPreview(groups, unmatched, total) {
  const matchedCount = [...groups.values()].reduce((s, g) => s + g.files.length, 0);
  const gList = [...groups.values()].sort((a, b) => b.files.length - a.files.length);
  const { wrap, close } = erpDialog(`
    <h3>Преглед на чертежите за качване</h3>
    <p>Избрани файла: <b>${total}</b> · разпознати: <b>${matchedCount}</b> за <b>${groups.size}</b> детайла · <b class="${unmatched.length ? "erp-warn" : ""}">ненамерени: ${unmatched.length}</b></p>
    ${unmatched.length ? `<p class="hint">Ненамерените нямат разпознаваем код в името. Свали списъка, преименувай ги (кодът да е в името) и качи пак само тях.</p>` : ""}
    <div class="dc-cols">
      <div class="dc-col"><h4 class="erp-group-head">✅ Разпознати (${groups.size} детайла)</h4>
        <div class="dc-list">${gList.length ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Детайл</th><th class="num">Файла</th></tr></thead><tbody>${
          gList.map(g => `<tr><td>${escapeHtml(g.p.code || "")}</td><td>${escapeHtml(g.p.name || "")}</td><td class="num">${g.files.length}</td></tr>`).join("")
        }</tbody></table>` : `<p class="erp-muted">Нищо разпознато.</p>`}</div>
      </div>
      <div class="dc-col"><h4 class="erp-group-head">❌ Ненамерени (${unmatched.length})</h4>
        <div class="dc-list">${unmatched.length ? `<ul class="dc-un">${unmatched.slice(0, 400).map(n => `<li>${escapeHtml(n)}</li>`).join("")}${unmatched.length > 400 ? `<li class="erp-muted">…и още ${unmatched.length - 400}</li>` : ""}</ul>` : `<p class="erp-ready-ok">Всичко е разпознато 👍</p>`}</div>
      </div>
    </div>
    <div class="erp-dialog-actions">
      ${unmatched.length ? `<button class="btn btn-small" id="dbp-export">⤓ Свали ненамерените</button>` : ""}
      <span class="spacer"></span>
      <button class="btn" id="dbp-cancel">Отказ</button>
      <button class="btn btn-primary" id="dbp-go" ${groups.size ? "" : "disabled"}>Качи разпознатите (${matchedCount})</button>
    </div>
    <div id="dbp-prog"></div>`);
  wrap.querySelector("#dbp-cancel").addEventListener("click", close);
  const exp = wrap.querySelector("#dbp-export");
  if (exp) exp.addEventListener("click", () => {
    const blob = new Blob(["﻿" + "Ненамерени файлове (нямат разпознат код в името)\n" + unmatched.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "nenameren-chertezhi.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  wrap.querySelector("#dbp-go").addEventListener("click", () => dsBulkUpload(groups, wrap, close));
}

// Стъпка 2: реалното качване (с прогрес и без дублиране на вече качени файлове).
async function dsBulkUpload(groups, wrap, close) {
  const prog = wrap.querySelector("#dbp-prog");
  const go = wrap.querySelector("#dbp-go"); if (go) go.disabled = true;
  const total = [...groups.values()].reduce((s, g) => s + g.files.length, 0);
  let ok = 0, dup = 0, failed = 0, saveErr = 0, idx = 0, doneFiles = 0;
  const failedNames = [];
  prog.innerHTML = `<div class="dc-prog"><div class="dc-bar"><span id="dbp-fill"></span></div><span id="dbp-pct">0%</span></div>`;
  const tick = () => { doneFiles++; const pct = Math.round(doneFiles / total * 100); const f = wrap.querySelector("#dbp-fill"); if (f) f.style.width = pct + "%"; const t = wrap.querySelector("#dbp-pct"); if (t) t.textContent = pct + "%"; };

  for (const g of groups.values()) {
    const p = g.p;
    // Актуалните чертежи от базата (не от кеша) — за да не презапишем/дублираме.
    let list = [];
    try {
      const { data: cur } = await sb.from("products").select("drawings").eq("id", p.id).maybeSingle();
      list = (cur && Array.isArray(cur.drawings)) ? cur.drawings.slice() : [];
    } catch (e) { list = Array.isArray(p.drawings) ? p.drawings.slice() : []; }
    const have = new Set(list.map(d => String((d && d.name) || "").toLowerCase()));
    let changed = false;
    for (const file of g.files) {
      if (have.has(file.name.toLowerCase())) { dup++; tick(); continue; }   // вече качен — прескачаме
      const path = `products/${p.id}/${Date.now()}-${idx++}-${safeName(file.name)}`;
      const up = await sb.storage.from(BUCKET).upload(path, file);
      if (up.error) { failed++; failedNames.push(file.name); tick(); continue; }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      list.push({ name: file.name, type: file.type, path, url: data.publicUrl });
      have.add(file.name.toLowerCase());
      ok++; changed = true; tick();
    }
    if (changed) {
      const { error } = await sb.from("products").update({ drawings: list }).eq("id", p.id);
      if (error) { saveErr++; }
      else if (ERP.prodById[p.id]) ERP.prodById[p.id].drawings = list;
    }
  }
  if (close) close();
  if (document.getElementById("ds-tbody")) dsFillRows();   // пре-оцветяваме бутоните
  alert(`Готово!\n✅ Качени нови: ${ok}`
    + (dup ? `\n↩ Вече качени (прескочени): ${dup}` : "")
    + (failed ? `\n⚠ Неуспешни качвания (файл): ${failed}\n` + failedNames.slice(0, 15).join("\n") : "")
    + (saveErr ? `\n⚠ Детайли с грешка при запис в базата: ${saveErr}` : "")
    + `\n\n💡 Натисни „🔎 Провери чертежите", за да сверим общо колко са записани.`);
}

/* ---------- Проверка на чертежите (запис в базата ↔ файл в облака) ---------- */
async function dsCheckDrawings() {
  const { wrap, close } = erpDialog(`
    <h3>🔎 Проверка на чертежите</h3>
    <div id="dc-body"><p class="erp-loading">Чета от базата…</p></div>
    <div class="erp-dialog-actions"><button class="btn" id="dc-close">Затвори</button></div>`);
  wrap.querySelector("#dc-close").addEventListener("click", close);
  const body = wrap.querySelector("#dc-body");

  let prods;
  try {
    prods = await dsFetchAllProducts("id,code,name,drawings");   // със странициране (над 1000)
  } catch (e) { body.innerHTML = `<p class="erp-error">Грешка при четене: ${escapeHtml(e.message || String(e))}</p>`; return; }

  const withDraw = prods.filter(p => Array.isArray(p.drawings) && p.drawings.length);
  const totalRecords = withDraw.reduce((s, p) => s + p.drawings.length, 0);
  const noPath = [];
  withDraw.forEach(p => p.drawings.forEach(d => { if (!d || !d.path) noPath.push({ p, d, base: "(без път)" }); }));

  body.innerHTML = `
    <p>📦 <b>${withDraw.length}</b> детайла с чертежи · общо <b>${totalRecords}</b> записа.</p>
    <p>Проверявам дали файловете реално съществуват в облака…</p>
    <div class="dc-prog"><div class="dc-bar"><span id="dc-fill"></span></div><span id="dc-pct">0%</span></div>`;

  const broken = [];
  let done = 0;
  for (const p of withDraw) {
    let names = new Set();
    try {
      const { data: files } = await sb.storage.from(BUCKET).list(`products/${p.id}`, { limit: 1000 });
      names = new Set((files || []).map(f => f.name));
    } catch (e) { /* ако листването гръмне, прескачаме проверката за този детайл */ names = null; }
    if (names) p.drawings.forEach(d => {
      if (!d || !d.path) return;
      const base = String(d.path).split("/").pop();
      if (base && !names.has(base)) broken.push({ p, d, base });
    });
    done++;
    const pct = Math.round(done / withDraw.length * 100);
    const fill = wrap.querySelector("#dc-fill"); if (fill) fill.style.width = pct + "%";
    const pctEl = wrap.querySelector("#dc-pct"); if (pctEl) pctEl.textContent = pct + "%";
  }

  const bad = broken.concat(noPath);
  const okCount = totalRecords - bad.length;
  let html = `
    <p>📦 <b>${withDraw.length}</b> детайла с чертежи · общо <b>${totalRecords}</b> записа.</p>
    <ul class="dc-sum">
      <li>✅ Изправни (файлът съществува): <b>${okCount}</b></li>
      <li>❌ Счупени (записът сочи липсващ файл): <b>${broken.length}</b></li>
      ${noPath.length ? `<li>⚠ Без път/url: <b>${noPath.length}</b></li>` : ""}
    </ul>`;
  if (bad.length) {
    html += `<div class="dc-list"><table class="report-table erp-table"><thead><tr><th>Код</th><th>Детайл</th><th>Файл</th></tr></thead><tbody>${
      bad.slice(0, 300).map(b => `<tr><td>${escapeHtml(b.p.code || "")}</td><td>${escapeHtml(b.p.name || "")}</td><td>${escapeHtml((b.d && b.d.name) || b.base || "?")}</td></tr>`).join("")
    }</tbody></table>${bad.length > 300 ? `<p class="erp-muted">…и още ${bad.length - 300}</p>` : ""}</div>
    <p class="hint">Тези записи показват „липсва чертеж", защото файлът не е в облака (напр. качването е прекъснало). Премахни ги и качи файловете наново.</p>
    <button class="btn btn-small btn-danger" id="dc-clean">🧹 Премахни счупените записи (${bad.length})</button>`;
  } else {
    html += `<p class="erp-ready-ok">🎉 Всичко е наред — всеки записан чертеж има реален файл в облака.</p>`;
  }
  body.innerHTML = html;

  const keyOf = d => (d && d.path) ? d.path : "noname:" + ((d && d.name) || "");
  const cleanBtn = wrap.querySelector("#dc-clean");
  if (cleanBtn) cleanBtn.addEventListener("click", async () => {
    if (!confirm(`Ще премахна ${bad.length} счупени записа (без реален файл). Файловете и без това липсват — това само чисти списъка. Продължавам?`)) return;
    const byProd = new Map();
    bad.forEach(b => { const a = byProd.get(b.p.id) || []; a.push(b); byProd.set(b.p.id, a); });
    let cleaned = 0, errs = 0;
    for (const [pid, items] of byProd) {
      const p = withDraw.find(x => x.id === pid);
      const badKeys = new Set(items.map(i => keyOf(i.d)));
      const kept = (p.drawings || []).filter(d => !badKeys.has(keyOf(d)));
      const { error } = await sb.from("products").update({ drawings: kept }).eq("id", pid);
      if (error) { errs++; continue; }
      cleaned += (p.drawings.length - kept.length);
      if (ERP.prodById[pid]) ERP.prodById[pid].drawings = kept;
    }
    alert(`Премахнати ${cleaned} счупени записа.` + (errs ? `\n${errs} детайла с грешка при запис.` : ""));
    close();
  });
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
