/* Данко Системс — Модул „Склад · Рецепти · Себестойност" (MRP-lite).
   Ядро: отваряне на модала, табове, зареждане на данните от Supabase и
   споделени помощници. Отделните екрани са в erp-*.js файловете.
   Ползва глобалния Supabase клиент (sb) и MY_ACCESS / escapeHtml от app.js. */

// Общо състояние на модула (кеш от базата).
const ERP = {
  tab: "customer",
  loaded: false,
  materials: [],       // ред от materials + stock/below_min от v_material_stock
  products: [],        // ред от v_product_cost (+ owner_client)
  lines: [],           // recipe_lines с прикачени material/operation/child
  linesByProduct: {},  // product_id -> [ред от рецептата]
  operations: [],
  costById: {},        // product_id -> себестойност (EUR)
  matById: {},         // material_id -> материал
  prodById: {},        // product_id -> продукт
  opById: {},          // operation_id -> операция
  opUsage: {},         // operation_id -> брой редове, които я ползват
  opRoutingSaved: {},  // { <op_code>: {primary, alt:[...]} } — запазена маршрутизация
  opRouting: {},       // работно копие в екрана „Операции → Цех"
  detailRouting: {},   // { "<код на детайл>¦<операция>": "<цех>" } — ръчно прехвърляне по детайл
  manualCost: {},      // product_id -> ръчно зададена себестойност (EUR), замества изчислената
  lineCost: {},        // recipe_line_id -> ръчна цена за 1 бр. САМО за този ред (операции)
};

/* ---------- Помощници ---------- */
// Парола за опасните бутони (Изчисти всичко / Изтегли импорта) — защита от
// случайно масово изтриване. Връща true само при вярна парола.
function erpDangerPass() {
  const p = prompt("⚠ Защита от случайно изтриване.\nВъведи паролата, за да продължиш:");
  if (p === null) return false;
  if (p.trim() !== "danko1") { alert("Грешна парола — нищо не е изтрито."); return false; }
  return true;
}
// Форматиране на пари в евро (напр. 12,3456 → „12,35 €").
function erpEur(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
// Форматиране на количество (до 3 знака, без излишни нули).
function erpNum(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("bg-BG", { maximumFractionDigits: 3 });
}
// Разчита число, което може да е с десетична запетая или интервали.
function erpToNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\s+/g, "").replace(",", ".").replace(/[^\d.\-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
// Следващ пореден код по логиката на Bizzio — една обща числова редица
// за продукти, материали и операции (следващ = най-големият код + 1).
function erpNextCode() {
  let max = 0;
  const scan = arr => (arr || []).forEach(x => {
    const c = String((x && x.code) || "").trim();
    if (/^\d+$/.test(c)) { const n = parseInt(c, 10); if (n > max) max = n; }
  });
  scan(ERP.materials); scan(ERP.products); scan(ERP.operations);
  return max ? String(max + 1) : "";
}

// Тегли ВСИЧКИ редове (Supabase връща макс 1000/заявка) чрез странициране.
// Страниците след първата се теглят ПАРАЛЕЛНО (по BATCH наведнъж) — при голяма
// таблица (рецепти, продукти, наличности) последователното теглене правеше
// десетки заявки една след друга и отварянето на екраните се влачеше.
async function erpSelectAllOnce(table, cols, eqCol, eqVal) {
  const PAGE = 1000, BATCH = 6;
  const getPage = n => {
    let q = sb.from(table).select(cols);
    if (eqCol !== undefined) q = q.eq(eqCol, eqVal);
    return q.order("id", { ascending: true }).range(n * PAGE, n * PAGE + PAGE - 1);
  };
  const first = await getPage(0);
  if (first.error) return { data: [], error: first.error };
  let out = (first.data || []).slice();
  if (out.length < PAGE) return { data: out, error: null };
  for (let next = 1; ;) {
    const nums = [];
    for (let i = 0; i < BATCH; i++) nums.push(next + i);
    const res = await Promise.all(nums.map(getPage));
    const bad = res.find(r => r && r.error);
    if (bad) return { data: out, error: bad.error };
    let last = false;
    for (const r of res) {
      const rows = (r && r.data) || [];
      out = out.concat(rows);
      if (rows.length < PAGE) { last = true; break; }   // край на данните
    }
    if (last) break;
    next += BATCH;
  }
  return { data: out, error: null };
}

// Броят редове в базата (без да тегли самите редове) — за проверка, че сме
// изтеглили ВСИЧКО. Връща null, ако броенето не е възможно.
async function erpCountRows(table, eqCol, eqVal) {
  try {
    let q = sb.from(table).select("id", { count: "exact", head: true });
    if (eqCol !== undefined) q = q.eq(eqCol, eqVal);
    const { count, error } = await q;
    return error ? null : (typeof count === "number" ? count : null);
  } catch (e) { return null; }
}

/* КОНТРОЛА „нищо да не липсва": едновременно с първата страница питаме базата
   КОЛКО реда има. Ако изтегленото е по-малко (прекъсната мрежа, отрязана
   страница), опитваме ВТОРИ път; ако пак не достига, връщаме резултата с
   белег truncated — екранът показва предупреждение, вместо тихо да работи с
   непълни данни. Точно това криеше задачи преди. */
async function erpSelectAll(table, cols, eqCol, eqVal) {
  // ИЗГЛЕДИТЕ (v_*) се прескачат от сверката: count върху изглед кара базата
  // да преизчисли ЦЕЛИЯ изглед втори път (напр. v_product_stock сумира всички
  // движения) — двойна работа при всяко отваряне на екран. Сверката пази
  // срещу отрязване на ГОЛЕМИ таблици; изгледите са с размера на номенклатурата.
  if (/^v_/.test(String(table))) return erpSelectAllOnce(table, cols, eqCol, eqVal);
  const [res, cnt] = await Promise.all([
    erpSelectAllOnce(table, cols, eqCol, eqVal),
    erpCountRows(table, eqCol, eqVal),
  ]);
  if (res.error) return res;
  if (cnt == null || res.data.length >= cnt) return res;
  // Втори опит със свежо преброяване (данните може да са се променили).
  const [res2, cnt2] = await Promise.all([
    erpSelectAllOnce(table, cols, eqCol, eqVal),
    erpCountRows(table, eqCol, eqVal),
  ]);
  const best = (!res2.error && res2.data.length > res.data.length) ? res2 : res;
  const expect = (cnt2 == null) ? cnt : cnt2;
  if (best.data.length >= expect) return { data: best.data, error: null };
  console.warn(`erpSelectAll(${table}): изтеглени ${best.data.length} от ${expect} реда!`);
  return { data: best.data, error: null, truncated: true, expected: expect, got: best.data.length };
}

// Връща контейнера на АКТИВНИЯ раздел (всеки отворен таб живее в собствен „pane",
// който само се показва/скрива — така състоянието (форми, филтри) се пази при
// превключване). Преди да има активен pane връща самия #erp-view (напр. „Зареждане…").
function erpView() {
  const host = document.getElementById("erp-view");
  if (!host) return host;
  if (ERP.tab) { const p = host.querySelector('.erp-pane[data-pane="' + ERP.tab + '"]'); if (p) return p; }
  return host;
}
function erpAmWorker() { return typeof MY_ACCESS !== "undefined" && MY_ACCESS && !MY_ACCESS.isAdmin; }

/* ---------- Отваряне / затваряне ---------- */
async function openErp() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  if (erpAmWorker()) { alert("Този модул е достъпен само за офиса."); return; }
  document.getElementById("erp-modal").hidden = false;
  // Финансите се отварят само през бутона на началната страница (не като таб в ЕРП)
  // и само от оторизираните.
  const finOk = (typeof financeAllowed !== "function") || financeAllowed();
  if (ERP.tab === "finance" && !finOk) ERP.tab = "customer";
  if (!ERP.loaded) {
    erpView().innerHTML = `<p class="erp-loading">Зареждане…</p>`;
    await erpLoadAll();
    ERP.loaded = true;
  }
  erpSetTab(ERP.tab || "materials");
  if (typeof erpUpdateMissingBadge === "function") erpUpdateMissingBadge();   // осветяване на таба при липса
}

function closeErp() { document.getElementById("erp-modal").hidden = true; }

// Гарантира, че ЕРП данните са заредени (ползва се и извън модала — напр. в поръчките).
async function erpEnsureLoaded() {
  if (!ERP.loaded) { await erpLoadAll(); ERP.loaded = true; }
}

// Клиент-собственик на продуктите — зарежда се веднъж, само когато потрябва
// (таб Продукти). Връща true, ако колоната съществува в базата.
async function erpEnsureOwnerClients() {
  if (ERP.hasOwnerClient !== null && ERP.hasOwnerClient !== undefined) return ERP.hasOwnerClient;
  try {
    const oc = await erpSelectAll("products", "id,owner_client");
    if (oc.error) { ERP.hasOwnerClient = false; return false; }
    const m = {}; (oc.data || []).forEach(r => { m[r.id] = r.owner_client || ""; });
    (ERP.products || []).forEach(p => { p.owner_client = m[p.id] || ""; });
    ERP.hasOwnerClient = true;
  } catch (e) { ERP.hasOwnerClient = false; }
  return ERP.hasOwnerClient;
}

// Презарежда данните от базата и пре-рендира текущия таб. Останалите отворени
// раздели се маркират за опресняване при следващо показване (да не са със стари данни).
async function erpReload() {
  await erpLoadAll();
  document.querySelectorAll("#erp-view .erp-pane").forEach(p => { if (p.dataset.pane !== ERP.tab) p.dataset.stale = "1"; });
  erpSetTab(ERP.tab, true);
  // Ако Цеховете са отворени (в друг таб на приложението), опресни ги — така
  // индикаторът „⏳ чака материал" се маха ВЕДНАГА след заприходяване на
  // материал, без да е нужно повторно отваряне на Цеховете. Наличностите на
  // материалите вече са пресни (erpLoadAll обнови ERP.matById.stock).
  try {
    const tm = document.getElementById("tasks-modal");
    if (tm && !tm.hidden && typeof renderTasks === "function") renderTasks();
    if (typeof erpUpdateMissingBadge === "function") erpUpdateMissingBadge();
  } catch (e) { /* тихо */ }
}

/* ---------- Зареждане на данните ----------
   КАРТА НА ИЗТОЧНИЦИТЕ — какво се пълни, от коя таблица/изглед и с кои колони.
   Всичко минава през erpLoadAll() (виж и erpReload / erpEnsureLoaded).

   ERP.products       ← изглед v_product_cost
                        (id, code, name, is_semifinished, group_name, needs_recipe, cost_eur).
                        Подредени по name. След зареждането на всеки ред се закача p.stock.
   ERP.prodById       ← индекс product_id → реда от ERP.products (същия изглед v_product_cost).
   ERP.costById       ← product_id → Number(cost_eur) от v_product_cost.
                        cost_eur се смята рекурсивно от SQL функцията product_cost(id)
                        върху recipe_lines + materials.avg_cost + operations.unit_cost
                        (многостепенно, child_product_id се обхожда рекурсивно).
   p.stock            ← изглед v_product_stock (колони id, stock), закачен на всеки p.
                        v_product_stock.stock = coalesce(sum(product_movements.quantity),0).
                        Ако изгледът липсва (детайл-складът erp-detail-stock.sql не е пуснат)
                        → p.stock = 0 за всички (работим без нето по детайли).
   ERP.prodStock      ← product_id → Number(stock) от v_product_stock (междинен кеш за p.stock).
   ERP.linesByProduct ← таблица recipe_lines, групирана по product_id, сортирана по position.
                        Ред: (id, product_id, position, quantity, unit, line_cost,
                              material_id, child_product_id, operation_id).
                        Всеки ред сочи ТОЧНО едно от material_id / child_product_id / operation_id.

   ВАЖНО: v_product_cost и v_product_stock са ОБИКНОВЕНИ изгледи (не материализирани) —
   стойностите им се преизчисляват при всяка SQL заявка. Затова след запис в базата
   тези клиентски кешове (ERP.products/prodById/costById/prodStock/p.stock/linesByProduct)
   се опресняват само чрез повторно викане на erpLoadAll() (или erpReload()).
*/
// Опреснява само наличностите на материалите (за индикатора „чака материал" и
// списъка „необходими материали") — без да презарежда цялото ЕРП.
async function erpRefreshMatStock() {
  if (typeof ERP === "undefined" || !ERP.matById) return;
  try {
    const { data, error } = await sb.from("v_material_stock").select("id,stock,below_min");
    if (error) return;
    (data || []).forEach(r => {
      const m = ERP.matById[r.id];
      if (m) { m.stock = Number(r.stock) || 0; m.below_min = !!r.below_min; }
    });
  } catch (e) { /* тихо — оставяме старите наличности */ }
}

async function erpLoadAll() {
  try {
    // Без PostgREST „embed" — резолвваме материал/операция/дете от заредените карти
    // (recipe_lines има две връзки към products, така избягваме двусмислието).
    const [matsRaw, stock, prods, ops, lines, routing, detailRoute, matKg] = await Promise.all([
      erpSelectAll("materials", "id,code,name,group_name,unit,avg_cost,min_stock,is_purchased"),
      erpSelectAll("v_material_stock", "id,stock,below_min"),
      erpSelectAll("v_product_cost", "id,code,name,is_semifinished,group_name,needs_recipe,cost_eur"),
      erpSelectAll("operations", "id,code,name,workshop,unit_cost,rate_per_min"),
      erpSelectAll("recipe_lines", "id,product_id,position,quantity,unit,line_cost,material_id,child_product_id,operation_id"),
      sb.from("app_config").select("data").eq("id", "erp_op_routing").maybeSingle(),
      sb.from("app_config").select("data").eq("id", "erp_detail_routing").maybeSingle(),
      sb.from("app_config").select("data").eq("id", "material_kg").maybeSingle(),
    ]);

    const firstErr = matsRaw.error || stock.error || prods.error || ops.error || lines.error;
    if (firstErr) throw firstErr;
    ERP.opRoutingSaved = (routing && routing.data && routing.data.data && routing.data.data.byCode) || {};
    ERP.detailRouting = (detailRoute && detailRoute.data && detailRoute.data.data && detailRoute.data.data.byKey) || {};
    // Тегло на 1 мярка (кг) за материали, които НЕ са в кг — за наличности в килограми.
    ERP.matKg = (matKg && matKg.data && matKg.data.data && matKg.data.data.perUnit) || {};

    // Наличности по материал.
    const stockById = {};
    (stock.data || []).forEach(r => { stockById[r.id] = r; });
    ERP.materials = (matsRaw.data || []).map(m => ({
      ...m,
      stock: stockById[m.id] ? Number(stockById[m.id].stock) : 0,
      below_min: stockById[m.id] ? !!stockById[m.id].below_min : (0 < Number(m.min_stock || 0)),
    }));
    ERP.matById = {};
    ERP.materials.forEach(m => { ERP.matById[m.id] = m; });

    ERP.products = prods.data || [];
    ERP.costById = {}; ERP.prodById = {};
    ERP.products.forEach(p => { ERP.costById[p.id] = Number(p.cost_eur) || 0; ERP.prodById[p.id] = p; });

    // Наличност на детайли/полуфабрикати (ако е пуснат erp-detail-stock.sql).
    ERP.prodStock = {};
    try {
      const ps = await erpSelectAll("v_product_stock", "id,stock");
      if (!ps.error) { (ps.data || []).forEach(r => { ERP.prodStock[r.id] = Number(r.stock) || 0; }); ERP._stockAt = Date.now(); }
    } catch (e) { /* складът за детайли още не е създаден — работим без нето */ }
    ERP.products.forEach(p => { p.stock = Number(ERP.prodStock[p.id]) || 0; });

    // Клиент-собственик: чете се ЛЕНИВО (само за таб Продукти) — това е втори
    // пълен обход на products и бавеше всяко отваряне на ЕРП.
    ERP.hasOwnerClient = null;   // null = още не е проверено

    ERP.operations = ops.data || [];
    ERP.opById = {};
    ERP.operations.forEach(o => { ERP.opById[o.id] = o; });

    ERP.lines = lines.data || [];
    ERP.linesByProduct = {};
    ERP.opUsage = {};
    ERP.childIds = new Set();   // всички product_id, ползвани като вложен детайл/възел
    ERP.lines.forEach(l => {
      (ERP.linesByProduct[l.product_id] = ERP.linesByProduct[l.product_id] || []).push(l);
      if (l.operation_id) ERP.opUsage[l.operation_id] = (ERP.opUsage[l.operation_id] || 0) + 1;
      if (l.child_product_id) ERP.childIds.add(Number(l.child_product_id));
    });
    Object.values(ERP.linesByProduct).forEach(arr =>
      arr.sort((a, b) => (a.position || 0) - (b.position || 0)));

    // Ръчни себестойности (app_config "manual_costs") — където има зададена,
    // тя ЗАМЕСТВА изчислената от рецептата (вкл. когато възелът се влага нагоре).
    ERP.manualCost = {};
    try {
      const mc = await sb.from("app_config").select("data").eq("id", "manual_costs").maybeSingle();
      ERP.manualCost = (mc.data && mc.data.data) || {};
    } catch (e) { /* още няма ръчни цени — работим с изчислените */ }
    // Ръчни цени ПО РЕД от рецептата (различна цена за една и съща операция
    // в различни рецепти) — app_config "line_costs": { recipe_line_id: EUR }.
    ERP.lineCost = {};
    try {
      const lc = await sb.from("app_config").select("data").eq("id", "line_costs").maybeSingle();
      ERP.lineCost = (lc.data && lc.data.data) || {};
    } catch (e) { /* няма редови цени */ }
    erpRecalcCosts();

    // Опаковки — зареждат се тук, за да са налични за придружаващите документи
    // (Packing List/Стокова разписка/Палет опис), дори табът „Опаковки" да не е отварян.
    try { if (typeof erpPackLoad === "function") await erpPackLoad(); } catch (e) { /* тихо */ }

    // Клиент-собственик: дозарежда се НА ЗАДЕН ФОН (не бави отварянето), за да
    // е налично за таб Продукти и за разпознаването на артикули по клиент.
    try { erpEnsureOwnerClients(); } catch (e) { /* тихо */ }
  } catch (e) {
    const msg = (e && e.message) || String(e);
    erpView().innerHTML =
      `<div class="erp-error"><h3>Грешка при зареждане от облака</h3><p>${escapeHtml(msg)}</p>` +
      `<p class="hint">Провери дали е пуснат <code>erp-setup.sql</code> в Supabase.</p></div>`;
    throw e;
  }
}

/* ---------- Ръчни себестойности ----------
   Имаме много изделия със стари/нереални изчислени цени. Ръчната цена (екран
   „Рецепта" → ✎ Цена) замества изчислената НАВСЯКЪДЕ (ERP.costById, списъци,
   маржове, влагане като възел в по-горна рецепта). Пази се в app_config
   "manual_costs": { productId: EUR }. Без ръчни цени важат тези от базата. */

// Ръчната цена на продукт (число) или null, ако няма зададена.
function erpManualCostOf(pid) {
  const v = ERP.manualCost ? ERP.manualCost[pid] : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Ръчната цена НА РЕД от рецептата (за 1 бр.) или null.
function erpLineCostOf(lineId) {
  const v = ERP.lineCost ? ERP.lineCost[lineId] : null;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Ефективната цена на операционен ред: редовата ръчна цена или общата ставка.
function erpOpLinePrice(l) {
  const lc = erpLineCostOf(l.id);
  if (lc !== null) return lc;
  return Number((ERP.opById[l.operation_id] || {}).unit_cost) || 0;
}

// Себестойност ИЗЧИСЛЕНА от рецептата на pid (без собствената му ръчна цена),
// но зачитаща ръчните цени на вложените възли. За сравнение в диалога „✎ Цена".
function erpComputedCost(pid, _depth, _stack) {
  _depth = _depth || 0; _stack = _stack || new Set();
  if (_depth > 25 || _stack.has(pid)) return 0;
  _stack.add(pid);
  let sum = 0;
  (ERP.linesByProduct[pid] || []).forEach(l => {
    const q = Number(l.quantity) || 0;
    if (l.material_id) sum += q * (Number((ERP.matById[l.material_id] || {}).avg_cost) || 0);
    else if (l.operation_id) sum += q * erpOpLinePrice(l);
    else if (l.child_product_id) {
      const man = erpManualCostOf(l.child_product_id);
      sum += q * (man !== null ? man : erpComputedCost(l.child_product_id, _depth + 1, _stack));
    }
  });
  _stack.delete(pid);
  return sum;
}

// Преизчислява ERP.costById (и p.cost_eur) с отчитане на ръчните цени.
// Без нито една ръчна цена не пипа нищо — важат стойностите от v_product_cost.
function erpRecalcCosts(force) {
  const hasManual = ERP.manualCost && Object.keys(ERP.manualCost).length;
  const hasLine = ERP.lineCost && Object.keys(ERP.lineCost).length;
  if (!force && !hasManual && !hasLine) return;
  const memo = {};
  const calc = (pid, depth, stack) => {
    const man = erpManualCostOf(pid);
    if (man !== null) return man;
    if (memo[pid] !== undefined) return memo[pid];
    if (depth > 25 || stack.has(pid)) return 0;
    stack.add(pid);
    let sum = 0;
    (ERP.linesByProduct[pid] || []).forEach(l => {
      const q = Number(l.quantity) || 0;
      if (l.material_id) sum += q * (Number((ERP.matById[l.material_id] || {}).avg_cost) || 0);
      else if (l.operation_id) sum += q * erpOpLinePrice(l);
      else if (l.child_product_id) sum += q * calc(l.child_product_id, depth + 1, stack);
    });
    stack.delete(pid);
    memo[pid] = sum;
    return sum;
  };
  (ERP.products || []).forEach(p => {
    const c = calc(p.id, 0, new Set());
    ERP.costById[p.id] = c;
    p.cost_eur = c;
  });
}

// Записва/маха ръчна цена ЗА РЕД от рецептата (val=null → маха) и преизчислява.
async function erpLineCostSave(lineId, val) {
  ERP.lineCost = ERP.lineCost || {};
  if (val === null) delete ERP.lineCost[lineId];
  else ERP.lineCost[lineId] = Number(val);
  const { error } = await sb.from("app_config").upsert(
    { id: "line_costs", data: ERP.lineCost, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис на цената: " + error.message); return false; }
  erpRecalcCosts(true);
  return true;
}

// Записва/маха ръчна цена (val=null → маха) и преизчислява всичко в кеша.
async function erpManualCostSave(pid, val) {
  ERP.manualCost = ERP.manualCost || {};
  if (val === null) delete ERP.manualCost[pid];
  else ERP.manualCost[pid] = Number(val);
  const { error } = await sb.from("app_config").upsert(
    { id: "manual_costs", data: ERP.manualCost, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис на ръчната цена: " + error.message); return false; }
  // Преизчисляваме всичко (и при махане на последната ръчна цена).
  erpRecalcCosts(true);
  return true;
}

/* ---------- Табове ----------
   Всеки отворен раздел живее в собствен „pane" вътре в #erp-view. Превключването
   само показва/скрива pane-а → състоянието (форми, филтри, скрол) се пази.
   erpSetTab(tab, force): рисува pane-а, само ако е нов, ако е поискано изрично
   (force) или ако е маркиран за опресняване (data-stale след промяна в данните). */
function erpEnsurePane(tab) {
  const host = document.getElementById("erp-view");
  let pane = host.querySelector('.erp-pane[data-pane="' + tab + '"]');
  let created = false;
  if (!pane) {
    // Махни всичко, което не е pane (напр. текста „Зареждане…").
    Array.from(host.childNodes).forEach(n => {
      if (!(n.nodeType === 1 && n.classList && n.classList.contains("erp-pane"))) host.removeChild(n);
    });
    pane = document.createElement("div");
    pane.className = "erp-pane";
    pane.dataset.pane = tab;
    host.appendChild(pane);
    created = true;
  }
  return { pane, created };
}
function erpSetTab(tab, force) {
  if (!tab) tab = "materials";
  // Производствен достъп: без финансовите модули.
  if (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production
      && ["sales", "pricelists", "purchases", "finance", "invoices", "payables", "receivables"].includes(tab)) tab = "customer";
  ERP.tab = tab;
  // „Отворени раздели" (като табове на документи) — добавяме отворения, ако още го няма.
  ERP.openTabs = ERP.openTabs || [];
  if (!ERP.openTabs.includes(tab)) ERP.openTabs.push(tab);
  document.querySelectorAll(".erp-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  const { pane, created } = erpEnsurePane(tab);
  const stale = pane.dataset.stale === "1";
  document.querySelectorAll("#erp-view .erp-pane").forEach(p =>
    p.classList.toggle("active", p.dataset.pane === tab));
  erpRenderOpenTabs();
  if (created || force || stale) { delete pane.dataset.stale; erpDispatchTab(tab); }
}
// Рисува съдържанието на раздела в активния pane (erpView()).
function erpDispatchTab(tab) {
  switch (tab) {
    case "materials":    erpRenderMaterials(); break;
    case "missmat":      erpRenderMissingMaterials(); break;
    case "packaging":    erpRenderPackaging(); break;
    case "matreq":       erpRenderMatRequests(); break;
    case "rfq":          erpRenderRfq(); break;
    case "detailstock":  erpRenderDetailStock(); break;
    case "products":     erpRenderProducts(); break;
    case "needs":        erpRenderNeeds(); break;
    case "requirements": erpRenderRequirements(); break;
    case "operations":   erpRenderOperations(); break;
    case "customer":     erpRenderCustomerOrders(); break;
    case "archive":      erpRenderArchive(); break;
    case "pricelists":   erpRenderPriceLists(); break;
    case "sales":        erpRenderSales(); break;
    case "invoices":     erpRenderInvoices(); break;
    case "finance":
      if (typeof financeAllowed === "function" && !financeAllowed()) {
        erpView().innerHTML = `<div class="erp-error"><h3>Няма достъп</h3><p>Модул „Финанси" е достъпен само за оторизирани потребители.</p></div>`;
      } else erpRenderFinance();
      break;
    case "purchases":    erpRenderPurchases(); break;
    case "payables":     erpRenderPayables(); break;
    case "receivables":  erpRenderReceivables(); break;
    case "partners":     erpRenderPartners(); break;
    case "import":       erpRenderImport(); break;
    default:             erpRenderMaterials();
  }
}

/* ---------- Отворени раздели (табове като на документи) ----------
   Всеки отворен модул стои като таб горе с ✕. Клик върху таб → превключва;
   ✕ → затваря. Всичко в един прозорец, без нови прозорци на браузъра. */
function erpTabLabel(tab) {
  const b = document.querySelector('.erp-tab[data-tab="' + tab + '"]');
  return b ? b.textContent.trim() : tab;
}
function erpRenderOpenTabs() {
  const strip = document.getElementById("erp-open-tabs"); if (!strip) return;
  const list = ERP.openTabs || [];
  if (list.length < 1) { strip.hidden = true; strip.innerHTML = ""; return; }
  strip.hidden = false;
  strip.innerHTML = list.map(t => {
    const active = t === ERP.tab;
    return `<span class="erp-otab${active ? " active" : ""}" data-goto="${escapeAttr(t)}" title="${escapeAttr(erpTabLabel(t))}">
      <span class="erp-otab-lbl">${escapeHtml(erpTabLabel(t))}</span>
      <button class="erp-otab-x" data-close="${escapeAttr(t)}" title="Затвори раздела" aria-label="Затвори">✕</button></span>`;
  }).join("");
  strip.querySelectorAll(".erp-otab").forEach(el => el.addEventListener("click", e => {
    if (e.target.closest(".erp-otab-x")) return;   // ✕ се обработва отделно
    erpSetTab(el.dataset.goto);
  }));
  strip.querySelectorAll(".erp-otab-x").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpCloseTab(b.dataset.close); }));
}
function erpCloseTab(tab) {
  ERP.openTabs = (ERP.openTabs || []).filter(t => t !== tab);
  // Махни pane-а от паметта (със състоянието му) — затворен раздел се рисува наново.
  const host = document.getElementById("erp-view");
  const pane = host && host.querySelector('.erp-pane[data-pane="' + tab + '"]');
  if (pane) pane.remove();
  if (ERP.tab === tab) {
    const next = ERP.openTabs[ERP.openTabs.length - 1];
    if (next) { erpSetTab(next); return; }
    // Няма повече отворени раздели.
    ERP.tab = null;
    document.querySelectorAll(".erp-tab").forEach(b => b.classList.remove("active"));
    erpRenderOpenTabs();
    host.innerHTML = `<p class="erp-empty-tabs">Няма отворени раздели. Избери от лентата с бутони горе, за да отвориш раздел.</p>`;
    return;
  }
  erpRenderOpenTabs();
}

/* ---------- Инициализация ---------- */
function erpInit() {
  const btn = document.getElementById("btn-erp");
  if (btn) btn.addEventListener("click", () => { if (ERP.tab === "finance") ERP.tab = "customer"; openErp(); });
  const finBtn = document.getElementById("btn-finance");
  if (finBtn) finBtn.addEventListener("click", () => { ERP.tab = "finance"; openErp(); });
  const closeBtn = document.getElementById("erp-close");
  if (closeBtn) closeBtn.addEventListener("click", closeErp);
  document.querySelectorAll(".erp-tab").forEach(b =>
    b.addEventListener("click", () => {
      // Повторен клик върху вече активния модул = опресни го; иначе отвори/превключи (пази състоянието).
      const t = b.dataset.tab;
      erpSetTab(t, ERP.tab === t && (ERP.openTabs || []).includes(t));
    }));
}
document.addEventListener("DOMContentLoaded", erpInit);
