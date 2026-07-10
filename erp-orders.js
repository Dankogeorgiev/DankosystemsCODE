/* Данко Системс — Връзка Мостра/Поръчка ↔ ЕРП.
   - обвързване на поръчката с продукт от каталога;
   - „Вземи материалите от рецептата" (bom_requirements → раздел 5, с наличности);
   - „Пусни в производство" → задачи в „Цехове" по маршрутизацията (Операции → Цех);
   - проследяване на напредъка от цеховете обратно в поръчката.
   Ползва глобалните getCurrent/touch/renderMaterials (app.js), ERP/erpEnsureLoaded
   (erp.js), erpEffectiveRoute (erp-operations.js), erpDialog (erp-materials.js). */

// Мапва ЕРП материал към една от съществуващите категории в раздел 5.
function erpMatCategory(m) {
  const s = (((m && m.group_name) || "") + " " + ((m && m.name) || "")).toLowerCase();
  if (s.includes("ламарин")) return "Ламарини";
  if (s.includes("ral") || s.includes("цвят") || s.includes("боя")) return "Цвят по RAL";
  if (s.includes("болт") || s.includes("гайк") || s.includes("крепеж") || s.includes("винт") || s.includes("нит") || s.includes("шайб") || s.includes("резба")) return "Крепежи";
  if (s.includes("профил") || s.includes("винкел") || s.includes("тръб") || s.includes("шина") || s.includes("лента") || s.includes("квадрат") || s.includes("кръг") || s.includes("тел")) return "Профили";
  return "Други покупни";
}

/* ---------- Панел в поръчката ---------- */
function erpRenderOrderPanel(s) {
  const host = document.getElementById("erp-order-panel");
  if (!host) return;
  if (!s || s.type === "claim") { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;

  const linked = !!s.erpProductId;
  host.innerHTML = `
    <fieldset class="card erp-order-card">
      <legend>🏭 Производство (ЕРП)</legend>
      ${linked ? `
        <div class="erp-linked">
          <span>Свързан продукт: <b>${escapeHtml(s.erpProductCode || "")} ${escapeHtml(s.erpProductName || "")}</b></span>
          <button type="button" class="btn btn-small" id="erp-op-link">Смени</button>
        </div>
        <div class="erp-order-actions">
          <label class="erp-inline">Бройка
            <input type="number" id="erp-op-qty" min="1" step="any" value="${escapeAttr(String(s.erpQty || 1))}" style="width:90px" />
          </label>
          <button type="button" class="btn btn-small" id="erp-op-fill">↧ Вземи материалите от рецептата</button>
          <button type="button" class="btn btn-small btn-primary" id="erp-op-produce">🏭 Пусни в производство</button>
          ${s.production ? '<button type="button" class="btn btn-small" id="erp-op-sale">🧾 Създай продажба</button>' : ""}
          ${s.production ? '<button type="button" class="btn btn-small btn-danger" id="erp-op-withdraw">⬅ Изтегли от производство</button>' : ""}
        </div>
        <div id="erp-op-status" class="erp-prod-status"></div>
      ` : `
        <p class="hint">Свържи поръчката с продукт от каталога, за да вземеш материалите от рецептата и да пуснеш задачи към цеховете.</p>
        <button type="button" class="btn btn-small btn-primary" id="erp-op-link">🔗 Свържи с ЕРП продукт</button>
      `}
    </fieldset>`;

  const linkBtn = host.querySelector("#erp-op-link");
  if (linkBtn) linkBtn.addEventListener("click", () => erpLinkProduct(s));
  const qtyEl = host.querySelector("#erp-op-qty");
  if (qtyEl) qtyEl.addEventListener("change", () => { s.erpQty = erpToNum(qtyEl.value) || 1; touch(s); });
  const fillBtn = host.querySelector("#erp-op-fill");
  if (fillBtn) fillBtn.addEventListener("click", () => erpFillMaterials(s));
  const prodBtn = host.querySelector("#erp-op-produce");
  if (prodBtn) prodBtn.addEventListener("click", () => erpProduce(s));
  const saleBtn = host.querySelector("#erp-op-sale");
  if (saleBtn) saleBtn.addEventListener("click", () => erpSaleFromProduction(s));
  const wBtn = host.querySelector("#erp-op-withdraw");
  if (wBtn) wBtn.addEventListener("click", () => erpWithdrawProduction(s));

  if (linked && s.production) erpShowProduction(s);
}

/* ---------- Избор на продукт ---------- */
async function erpLinkProduct(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Не мога да заредя ЕРП данните. Пуснат ли е erp-setup.sql?\n" + (e.message || e)); return; }

  const { wrap, close } = erpDialog(`
    <h3>Свържи с ЕРП продукт</h3>
    <input type="search" id="erp-lp-q" placeholder="Търси код или име…" />
    <div id="erp-lp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="erp-lp-cancel">Отказ</button></div>`);

  const listEl = wrap.querySelector("#erp-lp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.slice();
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    const shown = list.slice(0, 80);
    listEl.innerHTML = shown.map(p =>
      `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} <span class="erp-muted">${p.is_semifinished ? "полуфабрикат" : "артикул"}${p.needs_recipe ? " · чака рецепта" : ""}</span></button>`
    ).join("") + (list.length > 80 ? `<p class="hint">Показани първите 80 от ${list.length}. Уточни търсенето.</p>` : "")
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b =>
      b.addEventListener("click", () => {
        const p = ERP.prodById[Number(b.dataset.id)];
        s.erpProductId = p.id; s.erpProductCode = p.code; s.erpProductName = p.name;
        if (!s.erpQty) s.erpQty = 1;
        touch(s); close(); erpRenderOrderPanel(s);
      }));
  };
  render("");
  wrap.querySelector("#erp-lp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#erp-lp-cancel").addEventListener("click", close);
}

/* ---------- Вземане на материалите от рецептата ---------- */
async function erpFillMaterials(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  const qty = erpToNum(s.erpQty) || 1;
  const { data, error } = await sb.rpc("bom_requirements", { p_id: s.erpProductId, p_qty: qty });
  if (error) { alert("Грешка при разбивката: " + error.message); return; }
  if (!data || !data.length) { alert("Този продукт няма суровини в рецептата (или няма рецепта)."); return; }

  s.materials = (s.materials || []).filter(m => !m.fromErp);
  data.forEach(r => {
    const m = ERP.matById[r.material_id] || {};
    const stock = Number(m.stock) || 0;
    const required = Number(r.required) || 0;
    const shortage = Math.max(0, required - stock);
    const unit = r.unit || m.unit || "";
    s.materials.push({
      category: erpMatCategory(m),
      name: (m.code ? m.code + " · " : "") + (r.name || m.name || ""),
      qty: erpNum(required) + (unit ? " " + unit : ""),
      status: "not-ordered",
      note: `Склад: ${erpNum(stock)} ${unit}` + (shortage > 0 ? ` · недостиг ${erpNum(shortage)} ⚠` : " · достатъчно ✓"),
      fromErp: true, matId: r.material_id,
    });
  });
  touch(s);
  renderMaterials(s);
  erpRenderOrderPanel(s);
  const short = data.filter(r => (Number(r.required) || 0) > (Number((ERP.matById[r.material_id] || {}).stock) || 0)).length;
  alert(`Заредени ${data.length} материала от рецептата за ${erpNum(qty)} бр.` + (short ? `\n${short} от тях са с недостиг (виж раздел 5).` : ""));
}

/* ---------- Пускане в производство (последователно, паралелно по възли) ---------- */
// Обхожда рецептата и връща по ЕДНА верига за ВСЕКИ детайл/възел (продуктов
// възел със свои операции), + външните услуги. Всеки възел си върви
// последователно през своите операции, но различните възли се стартират
// наведнъж. Веригата на самия краен продукт е маркирана с isTop (финално
// сглобяване/опаковане — тя тръгва след като всички възли са готови).
function erpBuildChains(s) {
  const qty = erpToNum(s.erpQty) || 1;
  const chains = [], external = [];
  const route = op => (typeof erpEffectiveRoute === "function") ? erpEffectiveRoute(op) : { primary: op.workshop || "", alt: [] };
  (function walk(pid, mult, anc, depth) {
    const p = ERP.prodById[pid] || {};
    const steps = [];
    (ERP.linesByProduct[pid] || []).forEach(l => {
      if (l.operation_id) {
        const op = ERP.opById[l.operation_id] || {};
        const ws = (route(op).primary) || "";
        const cnt = mult * (Number(l.quantity) || 1);
        if (!ws || ws === "Външна услуга") { external.push({ op: op.name || "", product: p.name || "" }); return; }
        steps.push({ product: p.name || "", code: p.code || "", operation: op.name || "", workshop: ws, qty: cnt });
      } else if (l.child_product_id && !anc.has(l.child_product_id)) {
        walk(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]), depth + 1);
      }
    });
    if (steps.length) chains.push({ product: p.name || "", code: p.code || "", steps, isTop: depth === 0 });
  })(s.erpProductId, qty, new Set([s.erpProductId]), 0);
  return { chains, external };
}

// Съвместимост: плосък списък със задачи (ползва се от Работната карта за
// показване на целия маршрут). Групиран по възел (детайлите първо, финалът накрая).
function erpBuildTasks(s) {
  const { chains, external } = erpBuildChains(s);
  const tasks = [];
  chains.forEach(c => c.steps.forEach(step => tasks.push({
    client: s.clientName || "", product: step.product, code: step.code,
    operation: step.operation, workshop: step.workshop, qty: step.qty, produced: 0,
    due: s.deadline || "", thickness: "", files: [], logs: [],
    source: { kind: "order", sampleId: s.id, sampleType: s.type || "order" },
  })));
  return { tasks, external };
}

// Създава task-обект за конкретна стъпка от верига.
function erpSeqTask(step, i, meta) {
  const src = {
    kind: meta.kind || "order", sampleId: meta.sampleId, sampleType: meta.sampleType || "order",
    seq: true, group: meta.group, chainId: meta.chainId, step: i, total: meta.steps.length, steps: meta.steps,
    role: meta.role || "part",
  };
  if (meta.finalChainId) { src.finalChainId = meta.finalChainId; src.finalSteps = meta.finalSteps; }
  return {
    client: meta.clientName || "", product: step.product || "", code: step.code || "",
    operation: step.operation || "", workshop: step.workshop || "",
    qty: step.qty, produced: 0, due: meta.deadline || "", thickness: "", files: [], logs: [],
    source: src,
  };
}

// Планира пускането на един продукт: първите задачи (по една за всеки възел),
// общ брой стъпки, и дали има изчакващо финално сглобяване.
function erpPlanProduction(productId, qty, meta) {
  const { chains, external } = erpBuildChains({ erpProductId: productId, erpQty: qty });
  const partChains = chains.filter(c => !c.isTop);
  const finalChain = chains.find(c => c.isTop) || null;
  // Ако има възли — стартираме тях, а финалът чака. Ако няма възли (прост
  // продукт от един детайл) — стартираме директно веригата на продукта.
  const launch = partChains.length ? partChains : (finalChain ? [finalChain] : []);
  const gatedFinal = (partChains.length && finalChain) ? finalChain : null;
  const totalSteps = chains.reduce((n, c) => n + c.steps.length, 0);
  const finalChainId = gatedFinal ? (meta.group + ":final") : null;
  const firstTasks = launch.map((c, ci) => erpSeqTask(c.steps[0], 0, {
    clientName: meta.clientName || "", deadline: meta.deadline || "", kind: meta.kind, sampleId: meta.sampleId,
    sampleType: meta.sampleType, group: meta.group, chainId: meta.group + ":" + ci, steps: c.steps,
    role: "part", finalChainId, finalSteps: gatedFinal ? gatedFinal.steps : null,
  }));
  return { firstTasks, totalSteps, chainCount: launch.length, external, hasFinal: !!gatedFinal };
}

// Ако задачата е част от последователна верига и е готова — пуска следващата
// операция на СЪЩИЯ възел; а ако възелът приключи — проверява дали всички възли
// са готови, за да пусне финалното сглобяване. Ползва се от tasks.js.
async function erpAdvanceSeq(t) {
  const src = t && t.source;
  if (!src || !src.seq) return;
  const steps = src.steps || [];
  const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
  if (!(qty > 0 && prod >= qty)) return;             // още не е готова
  const next = (Number(src.step) || 0) + 1;

  // 1) Следваща операция на същия възел.
  if (next < steps.length) {
    if (src.advanced) return;
    src.advanced = true;
    if (typeof tSaveTask === "function") await tSaveTask(t);
    try {
      const { data } = await sb.from("tasks").select("data").eq("data->source->>sampleId", String(src.sampleId));
      const exists = (data || []).some(r => {
        const s2 = r.data && r.data.source;
        return s2 && String(s2.chainId) === String(src.chainId) && (Number(s2.step) || 0) === next;
      });
      if (exists) return;
    } catch (e) { /* по-добре дубъл, отколкото спряна верига */ }
    const nt = erpSeqTask(steps[next], next, {
      clientName: t.client || "", deadline: t.due || "", kind: src.kind, sampleId: src.sampleId,
      sampleType: src.sampleType, group: src.group, chainId: src.chainId, steps,
      role: src.role, finalChainId: src.finalChainId, finalSteps: src.finalSteps,
    });
    const { error } = await sb.from("tasks").insert({ data: nt });
    if (error) console.error("seq advance", error);
    return;
  }

  // 2) Възелът приключи. Ако има изчакващо финално сглобяване — проверяваме
  //    дали ВСИЧКИ възли (от същата група) са готови и го пускаме.
  if (src.role === "part" && src.finalChainId && (src.finalSteps || []).length) {
    await erpMaybeStartFinal(t, src);
  }
}

// Пуска финалната верига (сглобяване/опаковане на целия продукт), когато всички
// възли от групата са завършили.
async function erpMaybeStartFinal(t, src) {
  let rows = [];
  try {
    const { data } = await sb.from("tasks").select("data,done").eq("data->source->>sampleId", String(src.sampleId));
    rows = data || [];
  } catch (e) { return; }
  // Вече пуснат ли е финалът?
  if (rows.some(r => { const s = r.data && r.data.source; return s && String(s.chainId) === String(src.finalChainId); })) return;
  // Всички възли от групата готови ли са? (последната стъпка на всяка верига е отчетена)
  const parts = {};
  rows.forEach(r => {
    const s = r.data && r.data.source;
    if (!s || s.role !== "part" || String(s.group) !== String(src.group)) return;
    const g = parts[s.chainId] || (parts[s.chainId] = { done: false });
    const stepN = Number(s.step) || 0, len = (s.steps || []).length;
    if (stepN === len - 1) g.done = !!r.done;
  });
  const ids = Object.keys(parts);
  if (!ids.length || !ids.every(id => parts[id].done)) return;
  const nt = erpSeqTask(src.finalSteps[0], 0, {
    clientName: t.client || "", deadline: t.due || "", kind: src.kind, sampleId: src.sampleId,
    sampleType: src.sampleType, group: src.group, chainId: src.finalChainId, steps: src.finalSteps, role: "final",
  });
  const { error } = await sb.from("tasks").insert({ data: nt });
  if (error) console.error("seq final", error);
}

/* ---------- Поточно производство (стандарт за всички продукти) ----------
   Всеки детайл минава през своите операции ПОТОЧНО: колкото са отчетени като
   произведени на една операция, толкова стават налични за следващата. Всички
   операции се създават наведнъж (задачи в цеховете), а поточното изчакване е
   ограничение при отчитането (виж erpFlowAvailable в tasks.js).
   Еднакви детайли (по код) от няколко поръчки се обединяват в ЕДНА СЕРИЯ с общо
   количество; финалното сглобяване (isTop) чака всички възли да са готови. */
// opts (по избор): { stock: {product_id: наличен_брой} (мутира се при приспадане),
//   consumed: {product_id: взети_от_склад} (изход) } — за нетна потребност: ако
//   даден детайл го има на склад, не се произвежда (и децата му също не се правят).
// Ключ за ръчно прехвърляне: „<код на детайл>¦<операция>" (код, иначе име).
function erpDetailRouteKey(code, product, operation) {
  return String(code || product || "") + "¦" + String(operation || "");
}
// Сглобяваща операция (там се консумират частите): заваряване, занитване,
// сглобяване, монтаж, залепване… На нея се изчакват частите, НЕ на рязането.
function erpIsAssemblyOp(name) {
  const s = (name || "").toLowerCase();
  return /заваряв|занитв|нитов|сглоб|монтаж|залеп|скрепя|болтов|асембл/.test(s);
}
// Записва/маха постоянно прехвърляне на операция на детайл към цех (app_config).
async function erpSaveDetailRoute(detailKey, workshop) {
  let byKey = {};
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "erp_detail_routing").maybeSingle();
    byKey = (data && data.data && data.data.byKey) || {};
  } catch (e) {}
  if (workshop) byKey[detailKey] = workshop; else delete byKey[detailKey];
  const { error } = await sb.from("app_config").upsert({ id: "erp_detail_routing", data: { byKey }, updated_at: new Date().toISOString() });
  if (!error && typeof ERP !== "undefined") ERP.detailRouting = byKey;
  return error;
}

function erpFlowSteps(s, opts) {
  const qty = erpToNum(s.erpQty) || 1;
  const steps = [], external = [], missing = [], materials = {};   // materials: material_id -> нужно к-во
  const stock = (opts && opts.stock) || null;
  const consumed = (opts && opts.consumed) || null;
  const route = op => (typeof erpEffectiveRoute === "function") ? erpEffectiveRoute(op) : { primary: op.workshop || "", alt: [] };
  // Суфикс на ключовете (за да не се смесва „производство за склад" с поръчковите серии).
  const sfx = (opts && opts.keySuffix) || "";
  const toStockTop = !!(opts && opts.toStockTop);
  const nodes = [];      // { key, product, code, ops:[{operation,workshop,qty}], isTop }
  const nodeGate = {};   // node.key -> [seriesKey на директните части] — първата операция ги чака
  // walk връща { hasOps, make, outKeys }: outKeys = ключовете, чието завършване
  // означава „този подрод е готов за родителя" (за ЙЕРАРХИЧНО гейтване — всеки
  // възел чака своите директни части, не само финалът).
  (function walk(pid, mult, anc, depth) {
    // Нетна потребност: колко от този детайл има на склад -> толкова не се прави.
    // При „краен детайл за склад" (toStockTop) НЕ нетваме самия краен детайл (depth 0)
    // спрямо склада — правим го наново за поръчката; иначе повторно пускане би се
    // нетнало срещу собствената си предишна продукция. Подчастите (depth>0) се нетват.
    let make = mult;
    if (stock && !(depth === 0 && toStockTop)) {
      const have = Math.max(0, Number(stock[pid]) || 0);
      const use = Math.min(have, mult);
      if (use > 0) {
        stock[pid] = have - use;
        if (consumed) consumed[pid] = (consumed[pid] || 0) + use;
        make = mult - use;
      }
    }
    if (make <= 0) return { hasOps: false, make: 0, outKeys: [] };   // целият детайл е от склада
    const p = ERP.prodById[pid] || {};
    const key = (p.code || p.name || String(pid));
    const ops = [];
    let childHasOps = false;
    const childOutKeys = [];   // изходите на директните деца (родителят ги чака)
    (ERP.linesByProduct[pid] || []).forEach(l => {
      if (l.operation_id) {
        const op = ERP.opById[l.operation_id] || {};
        let ws = (route(op).primary) || "";
        // Ръчно прехвърляне по детайл+операция (постоянно) — има превес над всичко.
        const dovr = (ERP.detailRouting || {})[erpDetailRouteKey(p.code, p.name, op.name)];
        if (dovr) ws = dovr;
        const cnt = make * (Number(l.quantity) || 1);
        if (!ws || ws === "Външна услуга") { external.push({ op: op.name || "", product: p.name || "" }); return; }
        ops.push({ operation: op.name || "", workshop: ws, qty: cnt });
      } else if (l.material_id) {
        materials[l.material_id] = (materials[l.material_id] || 0) + make * (Number(l.quantity) || 1);
      } else if (l.child_product_id && !anc.has(l.child_product_id)) {
        const need = make * (Number(l.quantity) || 1);
        const res = walk(l.child_product_id, need, new Set([...anc, l.child_product_id]), depth + 1);
        if (res.hasOps) childHasOps = true;
        else if (res.make > 0) {
          // Дете-детайл без нито една операция в целия си подрод и не е на склад:
          // не може да се произведе (липсва рецепта) — записваме го като липсващ.
          const cp = ERP.prodById[l.child_product_id] || {};
          missing.push({ code: cp.code || "", name: cp.name || "", qty: res.make });
        }
        (res.outKeys || []).forEach(k => childOutKeys.push(k));
      }
    });
    if (ops.length) {
      nodes.push({ pid, key, product: p.name || "", code: p.code || "", ops, isTop: depth === 0 });
      // Първата операция на този възел чака директните му части да са готови.
      if (childOutKeys.length) nodeGate[key] = [...new Set(childOutKeys)];
      // Изходът на този възел за родителя = последната му операция.
      return { hasOps: true, make, outKeys: [key + "¦" + ops[ops.length - 1].operation + sfx] };
    }
    // Възел без свои операции: изходите му са изходите на децата (pass-through).
    return { hasOps: childHasOps, make, outKeys: childOutKeys };
  })(s.erpProductId, qty, new Set([s.erpProductId]), 0);

  // Ако има липсващи детайли (без рецепта и не на склад) — НЕ пускаме финалното
  // сглобяване (не може да се сглоби без частите). Детайлите с рецепта пак
  // тръгват по цеховете, а сглобяването чака да се уредят липсващите.
  const blockFinal = missing.length > 0;

  nodes.forEach(n => {
    if (n.isTop && blockFinal) return;   // не създаваме сглобяването при липсващи детайли
    const lastIdx = n.ops.length - 1;
    const gate = nodeGate[n.key];   // директните части на този възел (ако има)
    // Частите се изчакват на СГЛОБЯВАЩАТА операция (заваряване/занитване…), а не
    // на първата (рязане/огъване текат свободно и паралелно с частите). Ако няма
    // явна сглобяваща операция — на последната.
    let gateIdx = -1;
    if (gate && gate.length) {
      gateIdx = n.ops.findIndex(o => erpIsAssemblyOp(o.operation));
      if (gateIdx < 0) gateIdx = lastIdx;
    }
    n.ops.forEach((op, i) => {
      steps.push({
        product: n.product, code: n.code, operation: op.operation, workshop: op.workshop, qty: op.qty,
        seriesKey: n.key + "¦" + op.operation + sfx,
        prevKey: i > 0 ? (n.key + "¦" + n.ops[i - 1].operation + sfx) : null,
        gate: (i === gateIdx && gate && gate.length) ? gate.slice() : null,
        step: i, role: n.isTop ? "final" : "part",
        pid: n.pid, last: i === lastIdx, toStock: n.isTop && toStockTop,
      });
    });
  });
  return { steps, external, missing, materials };
}

// Прилага поточно производство за поръчка (една или няколко продуктови линии):
// групира операциите в серии между ВСИЧКИ поръчки. Идемпотентно — първо маха
// приноса на тази поръчка от съществуващите серии, после го добавя наново.
// productLines: [{ productId, qty }]; meta: { clientName, deadline, sampleId, sampleType, orderNo }
async function erpFlowApply(meta, productLines) {
  const sid = String(meta.sampleId);
  const ref = "order:" + sid;
  const toStock = !!meta.toStock;                 // производство ЗА СКЛАД (без заявка)
  const sfx = toStock ? ("¦склад:" + sid) : "";

  // 0) Нетна потребност спрямо СКЛАДА за детайли. Наличността, която е на склад,
  //    не се пуска към цех (детайлът е готов). Изключваме собствените стари
  //    изписвания на тази поръчка, за да е идемпотентно повторното пускане.
  //    При „производство за склад" НЕ приспадаме — целта е да напълним склада.
  const avail = {};                // product_id -> наличен брой (за нетване)
  let stockOn = false;
  if (!toStock) {
    const { data: moves, error: mErr } = await erpSelectAll("product_movements", "id,product_id,quantity,ref");
    if (!mErr) {
      stockOn = true;
      (moves || []).forEach(m => { if (m.ref === ref) return; avail[m.product_id] = (Number(avail[m.product_id]) || 0) + (Number(m.quantity) || 0); });
      Object.keys(avail).forEach(k => { if (avail[k] < 0) avail[k] = 0; });
    }
  }

  // 1) Нови приноси на тази поръчка, групирани по серия (код+операция).
  //    При обхождането приспадаме от avail (мутира се) и записваме взетото от склад.
  const mine = {};                 // seriesKey -> { qty, st }
  const externalAll = [];
  const consumed = {};             // product_id -> взети от склад (за цялата поръчка)
  const missingMap = {};           // code -> { code, name, qty } (липсващи детайли без рецепта)
  const matNeed = {};              // material_id -> нужно к-во за реалното (нето) производство
  (productLines || []).forEach(line => {
    const q = erpToNum(line.qty) || 0;
    if (!q) return;
    // stockTop: при обикновена заявка готовият краен детайл влиза в Склад детайли
    // (после се изписва с Продажба) — без да сменяме поръчковия режим на „за склад".
    const stepsOpts = toStock
      ? { keySuffix: sfx, toStockTop: true }
      : (stockOn ? { stock: avail, consumed, toStockTop: !!meta.stockTop }
                 : (meta.stockTop ? { toStockTop: true } : undefined));
    const { steps, external, missing, materials } = erpFlowSteps({ erpProductId: line.productId, erpQty: q }, stepsOpts);
    Object.keys(materials || {}).forEach(mid => { matNeed[mid] = (Number(matNeed[mid]) || 0) + Number(materials[mid] || 0); });
    external.forEach(e => externalAll.push(e));
    (missing || []).forEach(m => {
      const k = m.code || m.name;
      const cur = missingMap[k] || (missingMap[k] = { code: m.code, name: m.name, qty: 0 });
      cur.qty += Number(m.qty) || 0;
    });
    steps.forEach(st => {
      const cur = mine[st.seriesKey] || (mine[st.seriesKey] = { qty: 0, st });
      cur.qty += st.qty;
    });
  });
  const myKeys = Object.keys(mine);
  const missingList = Object.values(missingMap);

  // Чертежи от рецептата (продукта) — закачат се на задачите, за да пътуват по
  // потока (напр. чертежът на детайла върви от Лазер към Абкант и нататък).
  const drawingsByPid = {};
  const pids = [...new Set(myKeys.map(k => mine[k].st.pid).filter(Boolean))];
  if (pids.length) {
    try {
      const { data } = await sb.from("products").select("id,drawings").in("id", pids);
      (data || []).forEach(p => { drawingsByPid[p.id] = Array.isArray(p.drawings) ? p.drawings : []; });
    } catch (e) { /* без чертежи, ако колоната липсва */ }
  }

  // 1б) Записваме изписването от склада за взетите детайли (идемпотентно по ref).
  const fromStock = [];
  if (stockOn) {
    await sb.from("product_movements").delete().eq("ref", ref);
    const rows = [];
    Object.keys(consumed).forEach(pid => {
      const qtyUsed = Number(consumed[pid]) || 0;
      if (qtyUsed <= 0) return;
      const p = ERP.prodById[pid] || {};
      fromStock.push({ code: p.code || "", name: p.name || "", qty: qtyUsed });
      rows.push({ product_id: Number(pid), kind: "изписване", quantity: -qtyUsed, ref, note: "Взето от склад за заявка №" + (meta.orderNo || sid) });
    });
    if (rows.length) { const { error } = await sb.from("product_movements").insert(rows); if (error) return { error }; }
  }

  // 1в) Изписване на МАТЕРИАЛИТЕ, вложени в реалното (нето) производство.
  //     Идемпотентно по ref (при повторно пускане/изтегляне се преизчислява).
  const materialsShort = [];
  {
    try { await sb.from("stock_movements").delete().eq("ref", ref); } catch (e) {}
    const matRows = [];
    Object.keys(matNeed).forEach(mid => {
      const q = Number(matNeed[mid]) || 0;
      if (q <= 0) return;
      const m = (ERP.matById && ERP.matById[mid]) || {};
      const have = Number(m.stock) || 0;
      if (q > have) materialsShort.push({ code: m.code || "", name: m.name || "", unit: m.unit || "", need: q, have });
      matRows.push({ material_id: Number(mid), kind: "изписване", quantity: -q, ref, note: "Вложен в производство №" + (meta.orderNo || sid) });
    });
    if (matRows.length) { try { await sb.from("stock_movements").insert(matRows); } catch (e) {} }
  }

  // 2) Изчистваме стари НЕпоточни задачи на тази поръчка (стар последователен режим).
  await sb.from("tasks").delete().eq("data->source->>sampleId", sid).is("data->source->>flow", null);

  // 3) Съществуващите поточни серии.
  const { data: exRows, error: exErr } = await erpSelectAll("tasks", "id,data,done", "data->source->>flow", "true");
  if (exErr) return { error: exErr };
  const bySeries = {};
  (exRows || []).forEach(r => {
    const d = r.data || {}, src = d.source || {};
    if (src.kind !== "series") return;
    // Махаме приноса на тази поръчка (ако вече е бил пускан).
    const orders = (src.orders || []).slice();
    const idx = orders.findIndex(o => String(o.id) === sid);
    if (idx >= 0) {
      d.qty = Math.max(0, (Number(d.qty) || 0) - (Number(orders[idx].qty) || 0));
      orders.splice(idx, 1);
      src.orders = orders; src.orderIds = orders.map(o => String(o.id));
    }
    bySeries[src.seriesKey] = { id: r.id, data: d };
  });

  // 4) Добавяме новите приноси (нова серия или обединяване към съществуваща).
  myKeys.forEach(k => {
    const add = mine[k], st = add.st;
    let r = bySeries[k];
    if (!r) {
      r = { id: null, _new: true, data: {
        client: "", product: st.product, code: st.code, operation: st.operation, workshop: st.workshop,
        qty: 0, produced: 0, due: "", thickness: "", files: [], logs: [],
        source: {
          kind: "series", flow: true, seriesKey: k, prevKey: st.prevKey || null, gate: st.gate || null,
          step: st.step, role: st.role || "part", code: st.code, product: st.product,
          orders: [], orderIds: [], sampleType: meta.sampleType || "order",
          pid: st.pid, last: !!st.last, toStock: !!st.toStock, stock: toStock, stocked: 0,
        },
      } };
      bySeries[k] = r;
    }
    const src = r.data.source;
    // Обновяваме метаданните на потока според ТЕКУЩАТА рецепта (при повторно
    // пускане след промяна) — така новодобавени операции и ново изчакване се
    // отразяват, а произведеното/логовете/цехът се запазват.
    src.prevKey = st.prevKey || null;
    src.gate = st.gate || null;
    src.step = st.step;
    src.role = st.role || src.role || "part";
    src.last = !!st.last;
    src.toStock = !!st.toStock;
    src.pid = st.pid;
    src.orders = src.orders || [];
    src.orders.push({ id: meta.sampleId, no: meta.orderNo || "", client: meta.clientName || "", due: meta.deadline || "", qty: add.qty });
    src.orderIds = src.orders.map(o => String(o.id));
    r.data.qty = (Number(r.data.qty) || 0) + add.qty;
    // Закачаме чертежите от рецептата на детайла (без дублиране).
    const dr = drawingsByPid[st.pid] || [];
    if (dr.length) {
      r.data.files = r.data.files || [];
      dr.forEach(f => { if (f && f.path && !r.data.files.some(g => g.path === f.path)) r.data.files.push({ name: f.name, type: f.type, path: f.path, url: f.url }); });
    }
  });

  // 5) Клиент/срок според броя поръчки; трием изпразнените серии.
  const toInsert = [];
  for (const k of Object.keys(bySeries)) {
    const r = bySeries[k], src = r.data.source || {}, orders = src.orders || [];
    if (!orders.length) { if (r.id) await sb.from("tasks").delete().eq("id", r.id); continue; }
    // Серия (2+ поръчки) няма клиент/срок в колоните — показва „СЕРИЯ".
    r.data.client = orders.length >= 2 ? "" : (orders[0].client || "");
    r.data.due = orders.length >= 2 ? "" : (orders[0].due || "");
    if (r._new) { toInsert.push(r.data); continue; }
    const qty = Number(r.data.qty) || 0, prod = Number(r.data.produced) || 0;
    const { error } = await sb.from("tasks").update({ data: r.data, done: qty > 0 && prod >= qty, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return { error };
  }
  if (toInsert.length) {
    const { error } = await sb.from("tasks").insert(toInsert.map(d => ({ data: d })));
    if (error) return { error };
  }
  return { external: externalAll, seriesCount: myKeys.length, fromStock, missing: missingList, materialsShort, error: null };
}

// Маха поръчка от поточните серии (при триене на заявка). Изпразнените серии
// се трият; частично споделените се обновяват (количество/клиент/срок).
async function erpFlowRemoveOrder(sampleId) {
  const sid = String(sampleId);
  await sb.from("tasks").delete().eq("data->source->>sampleId", sid);   // стари непоточни
  try { await sb.from("product_movements").delete().eq("ref", "order:" + sid); } catch (e) {}  // връщаме взетото от склад
  try { await sb.from("stock_movements").delete().eq("ref", "order:" + sid); } catch (e) {}    // връщаме вложените материали
  const { data } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
  for (const r of (data || [])) {
    const d = r.data || {}, src = d.source || {};
    if (src.kind !== "series") continue;
    const orders = (src.orders || []).slice();
    const idx = orders.findIndex(o => String(o.id) === sid);
    if (idx < 0) continue;
    d.qty = Math.max(0, (Number(d.qty) || 0) - (Number(orders[idx].qty) || 0));
    orders.splice(idx, 1);
    if (!orders.length) { await sb.from("tasks").delete().eq("id", r.id); continue; }
    src.orders = orders; src.orderIds = orders.map(o => String(o.id));
    d.client = orders.length >= 2 ? "" : (orders[0].client || "");
    d.due = orders.length >= 2 ? "" : (orders[0].due || "");
    const qty = Number(d.qty) || 0, prod = Number(d.produced) || 0;
    await sb.from("tasks").update({ data: d, done: qty > 0 && prod >= qty, updated_at: new Date().toISOString() }).eq("id", r.id);
  }
}

// Карта на произведеното по серии (ключ код+операция) от текущите задачи.
function erpSeriesProduced(tasks) {
  const map = {};
  (tasks || []).forEach(t => {
    const src = t && t.source;
    if (!src || !src.flow || !src.seriesKey) return;
    const m = map[src.seriesKey] || (map[src.seriesKey] = { produced: 0, qty: 0 });
    m.produced += Number(t.produced) || 0;
    m.qty += Number(t.qty) || 0;
  });
  return map;
}

// Колко детайла реално могат да се отчетат сега на тази операция: толкова,
// колкото са произведени в предната операция (поточно), минус вече отчетените
// тук. Първата операция е ограничена само от общото количество. Финалното
// сглобяване чака всички възли (gate) да са напълно готови.
function erpFlowAvailable(t, map) {
  const src = t && t.source;
  const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
  if (!src || !src.flow) return Math.max(0, qty - prod);
  if (Array.isArray(src.gate) && src.gate.length) {
    const done = src.gate.every(k => { const g = map[k]; return g && g.qty > 0 && g.produced >= g.qty; });
    if (!done) return 0;
  }
  if (src.prevKey) {
    // Брак при настройка на ТАЗИ операция „изяжда" толкова детайла от входа —
    // затова ги вадим от наличното (те са бракувани, не могат да се обработят).
    // Допълнителните бройки за тях се нарязват наново от първата операция.
    const brak = Number(t.brak) || 0;
    const up = map[src.prevKey];
    return Math.max(0, (up ? up.produced : 0) - prod - brak);
  }
  return Math.max(0, qty - prod);
}

// Заприходява готови детайли в Склад детайли (движение „заприходяване").
async function erpStockCredit(pid, qty, note, ref) {
  if (!pid || !(qty > 0)) return;
  try {
    await sb.from("product_movements").insert({ product_id: Number(pid), kind: "заприходяване", quantity: qty, ref: ref || "", note: note || "" });
  } catch (e) { console.error("stock credit", e); }
}

// След отчитане на последната операция на детайл — вкарва готовите бройки в
// Склад детайли. При „производство за склад" влиза всичкото произведено; при
// поръчка — само свръхпроизводството (над нужното). Идемпотентно чрез
// source.stocked (заприходяваме само новата разлика).
async function erpFlowStockIn(t) {
  const src = t && t.source;
  if (!src || !src.flow || !src.last || !src.pid) return;
  const produced = Number(t.produced) || 0, qty = Number(t.qty) || 0;
  const desired = src.toStock ? produced : Math.max(0, produced - qty);
  const stocked = Number(src.stocked) || 0;
  const delta = desired - stocked;
  if (delta <= 0) return;
  await erpStockCredit(src.pid, delta, (src.toStock ? "Производство за склад" : "Свръхпроизводство") + " · " + (t.code || t.product || ""), "prod:" + t.id);
  src.stocked = desired;
  if (typeof tSaveTask === "function") await tSaveTask(t);
}

// Пуска детайл за производство ЗА СКЛАД (без заявка). Минава по цеховете и щом
// последната операция се отчете, готовите бройки влизат в Склад детайли.
async function erpProduceToStock(productId, qty) {
  try { await erpEnsureLoaded(); } catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return { error: true }; }
  const p = ERP.prodById[productId] || {};
  const q = erpToNum(qty) || 0;
  if (!(q > 0)) { alert("Въведи брой по-голям от 0."); return { error: true }; }
  const pre = erpFlowSteps({ erpProductId: productId, erpQty: q }, { toStockTop: true });
  if (!pre.steps.length) {
    alert((pre.missing && pre.missing.length)
      ? `Не мога да го пусна — липсват детайли без рецепта:\n` + pre.missing.map(m => `• ${m.code ? m.code + " " : ""}${m.name}`).join("\n")
      : "Този детайл няма рецепта с операции — не може да се пусне.");
    return { error: true };
  }
  const sid = "stock-" + productId + "-" + Date.now();
  const res = await erpFlowApply({
    clientName: "ЗА СКЛАД", deadline: "", sampleId: sid, sampleType: "stock",
    orderNo: (p.code || "") + " за склад", toStock: true,
  }, [{ productId, qty: q }]);
  return res;
}

// Изтегля мострата/поръчката от производство: маха задачите ѝ по цеховете
// (връща взетите от склад детайли); остава като чакаща (без production).
async function erpWithdrawProduction(s) {
  if (!s || !s.id) return;
  if (!confirm(`Да изтегля ли „${s.erpProductName || s.clientName || ""}" от производство?\nЗадачите по цеховете ще се премахнат; взетите от склад детайли се връщат.`)) return;
  try {
    if (typeof erpFlowRemoveOrder === "function") await erpFlowRemoveOrder(s.id);
    else await sb.from("tasks").delete().eq("data->source->>sampleId", String(s.id));
  } catch (e) { alert("Грешка при изтегляне: " + (e.message || e)); return; }
  s.production = null;
  touch(s);
  erpRenderOrderPanel(s);
  alert("Изтеглено от производство.");
}

async function erpProduce(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  if (!s.erpProductId) { alert("Първо свържи продукт от ЕРП."); return; }

  const qty = erpToNum(s.erpQty) || 1;
  const { steps, external, missing } = erpFlowSteps({ erpProductId: s.erpProductId, erpQty: qty });
  const missTxt = (missing && missing.length)
    ? `\n\n⚠ ЛИПСВАЩИ ДЕТАЙЛИ (нямат рецепта с операции и не са на склад):\n`
      + missing.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужни ${erpNum(m.qty)} бр.`).join("\n")
      + `\n\nСглобяването НЯМА да се пусне, докато тези детайли нямат рецепта или наличност в склада.`
    : "";
  if (!steps.length) {
    alert((missing && missing.length)
      ? `Не мога да пусна това изделие — детайлите му нямат рецепта с операции и не са на склад.${missTxt}`
      : "Няма операции за пускане. Проверете дали продуктът има рецепта с операции и дали операциите са насочени към цех (таб Операции → Цех).");
    return;
  }
  const already = s.production && s.production.count;
  let msg = `Ще пусна ПОТОЧНО производство за „${s.erpProductName}" × ${erpNum(qty)} бр.\n\n`
    + `Всяка операция получава детайлите постепенно — колкото са отчетени в предния цех, толкова минават нататък. Еднакви детайли от няколко поръчки се обединяват в СЕРИЯ.`;
  if (external.length) msg += `\n\n${external.length} външни операции (напр. поцинковане) са за подизпълнител.`;
  msg += missTxt;
  msg += `\n\n📦 Материалите за производството ще се изпишат от склад материали.`;
  msg += `\n📥 Готовите детайли ще се заприходят в Склад детайли (после ги изписваш с „Създай продажба").`;
  if (already) msg += `\n\n⚠ Вече има пуснато производство за тази поръчка. Ще обновя дела ѝ.`;
  if (!confirm(msg)) return;

  const res = await erpFlowApply({
    clientName: s.clientName || "", deadline: s.deadline || "", sampleId: s.id,
    sampleType: s.type || "order", orderNo: s.ourNo || s.no || "", stockTop: true,
  }, [{ productId: s.erpProductId, qty }]);
  if (res.error) { alert("Грешка при пускане: " + (res.error.message || res.error)); return; }

  const fs = res.fromStock || [];
  s.production = { at: new Date().toISOString(), count: res.seriesCount, flow: true, external: external.length, fromStock: fs.length };
  touch(s);
  erpRenderOrderPanel(s);
  const miss = res.missing || [];
  const matShort = res.materialsShort || [];
  alert(`Готово! Пуснах поточно производство (${res.seriesCount} операции).\n`
    + `Всяка следваща операция приема детайлите постепенно, колкото са отчетени в предната.`
    + `\n\n📥 Като се отчете последната операция, готовите детайли влизат в Склад детайли. После натисни „🧾 Създай продажба", за да ги изпишеш с продажба.`
    + (fs.length ? `\n\n📦 Взети от склад (не се пускат в цех):\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.`).join("\n") : "")
    + (matShort.length ? `\n\n⚠ НЕДОСТИГ НА МАТЕРИАЛИ (изписани, складът е на минус):\n` + matShort.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужно ${erpNum(m.need)}, налично ${erpNum(m.have)} ${m.unit || ""}`).join("\n") : "")
    + (miss.length ? `\n\n⚠ Сглобяването НЕ е пуснато — липсват детайли без рецепта/наличност:\n` + miss.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: ${erpNum(m.qty)} бр.`).join("\n") : "")
    + (external.length ? `\n\n(${external.length} външни операции са за подизпълнител.)` : ""));
}

// Създава чернова Продажба от произведена нестандартна поръчка. Готовият детайл
// (вече заприходен в Склад детайли) се ИЗПИСВА с продажбата (writeoffKind:"detail"),
// без да се разбива рецептата — материалите вече са изписани при производството.
async function erpSaleFromProduction(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  if (!s.erpProductId) { alert("Първо свържи продукт от ЕРП."); return; }
  if (typeof erpRenderSaleForm !== "function") { alert("Модулът Продажби не е зареден."); return; }

  const qty = erpToNum(s.erpQty) || 1;
  const today = new Date().toISOString().slice(0, 10);
  const p = ERP.prodById[s.erpProductId] || {};
  const ple = (typeof erpPriceListEntry === "function") ? erpPriceListEntry(s.clientId, s.clientName, s.erpProductId) : null;
  const name = (ple && ple.cname) ? ple.cname : (s.erpProductName || p.name || "");
  const unitPrice = (ple && erpToNum(ple.price) > 0) ? erpToNum(ple.price) : "";
  const orderNo = s.ourNo || s.no || "";
  erpRenderSaleForm({
    saleNo: (typeof erpNextSaleNo === "function") ? erpNextSaleNo() : "",
    clientName: s.clientName || "", clientId: s.clientId || null,
    clientVat: "", clientCity: "", clientStreet: "", clientCountry: "BG",
    date: today, taxDate: today, paymentMethod: "По банков път", currency: "EUR", vatRate: 20,
    note: orderNo ? ("По нестандартна поръчка №" + orderNo) : "",
    posted: false, fromOrderId: s.id,
    lines: [{
      itemKind: "product", writeoffKind: "detail", refId: s.erpProductId,
      code: s.erpProductCode || p.code || "", name, ourName: p.name || s.erpProductName || "",
      unit: "бр.", qty, unitPrice,
    }],
  });
}

/* ---------- Проследяване на напредъка ---------- */
// Извлича поточните серии, в които участва дадена поръчка (по orderIds).
async function erpFlowTasksFor(sampleId) {
  const sid = String(sampleId);
  const { data, error } = await erpSelectAll("tasks", "id,data,done", "data->source->>flow", "true");
  if (error) return { rows: [], error };
  const rows = (data || []).filter(r => {
    const src = r.data && r.data.source;
    return src && src.kind === "series" && (src.orderIds || []).map(String).includes(sid);
  });
  return { rows, error: null };
}

async function erpShowProduction(s) {
  const box = document.getElementById("erp-op-status");
  if (!box) return;
  box.innerHTML = `<span class="erp-muted">Производство: зареждане на напредъка…</span>`;
  const { rows, error } = await erpFlowTasksFor(s.id);
  if (error) { box.innerHTML = `<span class="erp-warn">Не мога да заредя напредъка: ${escapeHtml(error.message || String(error))}</span>`; return; }
  const planned = rows.length;
  const done = rows.filter(r => r.done).length;
  const active = rows.filter(r => !r.done).map(r => r.data || {});
  const pct = planned ? Math.round(done / planned * 100) : 0;
  const activeHtml = active.length
    ? active.map(a => `↳ <b>${escapeHtml(a.operation || "")}</b> (цех ${escapeHtml(a.workshop || "")}): ${Number(a.produced) || 0}/${Number(a.qty) || 0}${(a.source && a.source.orderIds && a.source.orderIds.length >= 2) ? " · СЕРИЯ" : ""}`).join("<br>")
    : (done ? "✓ всички операции са готови" : "");
  box.innerHTML = planned
    ? `<div class="erp-prod-line"><b>Поточно производство:</b> ${done} / ${planned} операции готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button type="button" class="btn btn-small" id="erp-op-refresh">↻</button></div>
       <div class="erp-prod-active">${activeHtml}</div>`
    : `<span class="erp-muted">Няма задачи за тази поръчка (възможно е да са изчистени от цеха).</span>`;
  const rb = document.getElementById("erp-op-refresh");
  if (rb) rb.addEventListener("click", () => erpShowProduction(s));
}
