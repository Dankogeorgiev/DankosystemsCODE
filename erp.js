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

function erpView() { return document.getElementById("erp-view"); }
function erpAmWorker() { return typeof MY_ACCESS !== "undefined" && MY_ACCESS && !MY_ACCESS.isAdmin; }

/* ---------- Отваряне / затваряне ---------- */
async function openErp() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  if (erpAmWorker()) { alert("Този модул е достъпен само за офиса."); return; }
  document.getElementById("erp-modal").hidden = false;
  if (!ERP.loaded) {
    erpView().innerHTML = `<p class="erp-loading">Зареждане…</p>`;
    await erpLoadAll();
    ERP.loaded = true;
  }
  erpSetTab(ERP.tab || "materials");
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
}

/* ---------- Зареждане на данните ---------- */
async function erpLoadAll() {
  try {
    // Без PostgREST „embed" — резолвваме материал/операция/дете от заредените карти
    // (recipe_lines има две връзки към products, така избягваме двусмислието).
    const [matsRaw, stock, prods, ops, lines, routing] = await Promise.all([
      sb.from("materials").select("id,code,name,group_name,unit,avg_cost,min_stock,is_purchased"),
      sb.from("v_material_stock").select("id,stock,below_min"),
      sb.from("v_product_cost").select("id,code,name,is_semifinished,group_name,needs_recipe,cost_eur"),
      sb.from("operations").select("id,code,name,workshop,unit_cost,rate_per_min"),
      sb.from("recipe_lines").select("id,product_id,position,quantity,unit,line_cost,material_id,child_product_id,operation_id"),
      sb.from("app_config").select("data").eq("id", "erp_op_routing").maybeSingle(),
    ]);

    const firstErr = matsRaw.error || stock.error || prods.error || ops.error || lines.error;
    if (firstErr) throw firstErr;
    ERP.opRoutingSaved = (routing && routing.data && routing.data.data && routing.data.data.byCode) || {};

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

    ERP.operations = ops.data || [];
    ERP.opById = {};
    ERP.operations.forEach(o => { ERP.opById[o.id] = o; });

    ERP.lines = lines.data || [];
    ERP.linesByProduct = {};
    ERP.opUsage = {};
    ERP.lines.forEach(l => {
      (ERP.linesByProduct[l.product_id] = ERP.linesByProduct[l.product_id] || []).push(l);
      if (l.operation_id) ERP.opUsage[l.operation_id] = (ERP.opUsage[l.operation_id] || 0) + 1;
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
  ERP.tab = tab;
  document.querySelectorAll(".erp-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));
  switch (tab) {
    case "materials":    erpRenderMaterials(); break;
    case "products":     erpRenderProducts(); break;
    case "needs":        erpRenderNeeds(); break;
    case "requirements": erpRenderRequirements(); break;
    case "operations":   erpRenderOperations(); break;
    case "customer":     erpRenderCustomerOrders(); break;
    case "partners":     erpRenderPartners(); break;
    case "import":       erpRenderImport(); break;
    default:             erpRenderMaterials();
  }
}

/* ---------- Инициализация ---------- */
function erpInit() {
  const btn = document.getElementById("btn-erp");
  if (btn) btn.addEventListener("click", openErp);
  const closeBtn = document.getElementById("erp-close");
  if (closeBtn) closeBtn.addEventListener("click", closeErp);
  document.querySelectorAll(".erp-tab").forEach(b =>
    b.addEventListener("click", () => erpSetTab(b.dataset.tab)));
}
document.addEventListener("DOMContentLoaded", erpInit);
