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
};

/* ---------- Помощници ---------- */
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
async function erpSelectAll(table, cols, eqCol, eqVal) {
  const PAGE = 1000;
  let from = 0, out = [];
  for (;;) {
    let q = sb.from(table).select(cols);
    if (eqCol !== undefined) q = q.eq(eqCol, eqVal);
    q = q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) return { data: out, error };
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return { data: out, error: null };
}

function erpView() { return document.getElementById("erp-view"); }
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

// Презарежда данните от базата и пре-рендира текущия таб.
async function erpReload() {
  await erpLoadAll();
  erpSetTab(ERP.tab);
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
      if (!ps.error) (ps.data || []).forEach(r => { ERP.prodStock[r.id] = Number(r.stock) || 0; });
    } catch (e) { /* складът за детайли още не е създаден — работим без нето */ }
    ERP.products.forEach(p => { p.stock = Number(ERP.prodStock[p.id]) || 0; });

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
  } catch (e) {
    const msg = (e && e.message) || String(e);
    erpView().innerHTML =
      `<div class="erp-error"><h3>Грешка при зареждане от облака</h3><p>${escapeHtml(msg)}</p>` +
      `<p class="hint">Провери дали е пуснат <code>erp-setup.sql</code> в Supabase.</p></div>`;
    throw e;
  }
}

/* ---------- Табове ---------- */
function erpSetTab(tab) {
  // Производствен достъп: без финансовите модули.
  if (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production
      && ["sales", "pricelists", "purchases", "finance"].includes(tab)) tab = "customer";
  ERP.tab = tab;
  document.querySelectorAll(".erp-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  switch (tab) {
    case "materials":    erpRenderMaterials(); break;
    case "missmat":      erpRenderMissingMaterials(); break;
    case "detailstock":  erpRenderDetailStock(); break;
    case "products":     erpRenderProducts(); break;
    case "needs":        erpRenderNeeds(); break;
    case "requirements": erpRenderRequirements(); break;
    case "operations":   erpRenderOperations(); break;
    case "customer":     erpRenderCustomerOrders(); break;
    case "archive":      erpRenderArchive(); break;
    case "pricelists":   erpRenderPriceLists(); break;
    case "sales":        erpRenderSales(); break;
    case "finance":
      if (typeof financeAllowed === "function" && !financeAllowed()) {
        erpView().innerHTML = `<div class="erp-error"><h3>Няма достъп</h3><p>Модул „Финанси" е достъпен само за оторизирани потребители.</p></div>`;
      } else erpRenderFinance();
      break;
    case "purchases":    erpRenderPurchases(); break;
    case "partners":     erpRenderPartners(); break;
    case "import":       erpRenderImport(); break;
    default:             erpRenderMaterials();
  }
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
    b.addEventListener("click", () => erpSetTab(b.dataset.tab)));
}
document.addEventListener("DOMContentLoaded", erpInit);
