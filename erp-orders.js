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
          <button type="button" class="btn btn-small" id="erp-op-test" title="Провери маршрута — дали рецептата ще върви правилно, преди да пуснеш">🧪 Тест рецепта</button>
          <button type="button" class="btn btn-small" id="erp-op-sim" title="Паралелна реалност — прекарва заявката през цеховете с текущите наличности и показва докъде стига и къде спира">🔬 Симулирай производството</button>
          ${(typeof produceAllowed !== "function" || produceAllowed()) ? `<button type="button" class="btn btn-small btn-primary" id="erp-op-produce">🏭 Пусни в производство</button>` : ""}
          ${s.production ? '<button type="button" class="btn btn-small" id="erp-op-livestatus" title="Жив статус — докъде е стигнало, къде е спряло и какво чака">📊 Статус на поръчката</button>' : ""}
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
  const testBtn = host.querySelector("#erp-op-test");
  if (testBtn) testBtn.addEventListener("click", () => {
    if (!s.erpProductId) { alert("Първо свържи продукт от ЕРП."); return; }
    if (typeof erpTestRecipe === "function") erpTestRecipe(s.erpProductId, s.erpQty || 1, true);
  });
  const simBtn = host.querySelector("#erp-op-sim");
  if (simBtn) simBtn.addEventListener("click", () => {
    if (!s.erpProductId) { alert("Първо свържи продукт от ЕРП."); return; }
    if (typeof erpSimulateProduction === "function")
      erpSimulateProduction([{ productId: s.erpProductId, qty: s.erpQty || 1 }], { title: (s.erpProductCode || "") + " " + (s.erpProductName || ""), stockTop: true });
  });
  const prodBtn = host.querySelector("#erp-op-produce");
  if (prodBtn) prodBtn.addEventListener("click", () => erpProduce(s));
  const statusBtn = host.querySelector("#erp-op-livestatus");
  if (statusBtn) statusBtn.addEventListener("click", () => {
    if (typeof erpOrderStatus === "function") erpOrderStatus(s.id, (s.erpProductCode || "") + " " + (s.erpProductName || ""), {
      productLines: [{ pid: s.erpProductId, qty: erpToNum(s.erpQty) || 1 }],
      stockCover: (s.production && s.production.stockCover) || [],
    });
  });
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
        // Бройката за цеха = броят ДЕТАЙЛИ (mult). l.quantity (напр. 2 огъвки
        // на 1 детайл) е технологичен множител за цена/време, НЕ за бройки —
        // иначе абкантът вижда 20 бр. при 10 реални детайла.
        const perUnit = Number(l.quantity) || 1;
        if (!ws || ws === "Външна услуга") { external.push({ op: op.name || "", product: p.name || "" }); return; }
        steps.push({ product: p.name || "", code: p.code || "", operation: op.name || "", workshop: ws, qty: mult, opsPerUnit: perUnit });
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
    operation: step.operation, workshop: step.workshop, qty: step.qty, opsPerUnit: step.opsPerUnit || 1, produced: 0,
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
    qty: step.qty, opsPerUnit: step.opsPerUnit || 1, produced: 0, due: meta.deadline || "", thickness: "", files: [], logs: [],
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

/* ---------- 🎨 АВТО-БОЯДИСВАНЕ ----------
   Цех Бояджийно не се отчита (по думите на Данко, 29.07.2026) — изделията
   „потъват" там и всичко се бута ръчно. Затова: щом до Бояджийно стигнат
   детайли (поточно: наличното от предната операция; верижно: пусната стъпка),
   задачата му се отчита АВТОМАТИЧНО (запис „авто-боя" в дневника) и потокът
   продължава. Складовите последствия са същите като при ръчен отчет.
   ИЗКЛЮЧВАНЕ (когато цехът започне да се отчита реално): ред в app_config
   id="paint_auto" с data {"on": false} — без нов деплой. */
const PAINT_AUTO_WS = "Бояджийно";
let erpPaintAutoOn = null;
async function erpPaintAutoEnabled() {
  if (erpPaintAutoOn != null) return erpPaintAutoOn;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "paint_auto").maybeSingle();
    erpPaintAutoOn = !(data && data.data && data.data.on === false);
  } catch (e) { erpPaintAutoOn = true; }
  return erpPaintAutoOn;
}
async function erpAutoPaintSweep() {
  const list = (typeof TASKS !== "undefined" && TASKS) || [];
  const map = erpSeriesProduced(list);
  let done = 0;
  for (const t of list) {
    if ((t.workshop || "") !== PAINT_AUTO_WS) continue;
    const src = t.source || {};
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    let add = 0;
    if (src.seq) add = Math.max(0, qty - prod);                    // верига: стъпката е пусната → готова
    else if (src.flow) add = erpFlowAvailable(t, map);             // поток: колкото е дала предната операция
    else continue;                                                 // ръчните задачи не се пипат
    if (add <= 0) continue;
    t.produced = prod + add;
    t.logs = t.logs || [];
    const entry = { date: new Date().toISOString().slice(0, 10), worker: "авто-боя", qty: add, notes: "автоматично (Бояджийно не се отчита)" };
    if (typeof prodLogId === "function") entry.lid = prodLogId();
    t.logs.push(entry);
    await tSaveTask(t);
    try { if (typeof prodLogWrite === "function") await prodLogWrite(t, entry); } catch (e) {}
    try { await erpAdvanceSeq(t); } catch (e) {}
    try { await erpFlowStockIn(t); } catch (e) {}
    try { await erpFlowConsume(t); } catch (e) {}
    try { await erpFlowMaterialConsume(t); } catch (e) {}
    if (src.flow && src.seriesKey && map[src.seriesKey]) map[src.seriesKey].produced += add;   // храни следващите гейтове
    done++;
  }
  return done;
}
async function erpAutoPaint() {
  if (!(await erpPaintAutoEnabled())) return 0;
  let total = 0;
  // Няколко прохода: advanceSeq може да пусне НОВА Бояджийно стъпка,
  // която следващият проход веднага да отчете.
  for (let i = 0; i < 4; i++) {
    let c = 0;
    try { c = await erpAutoPaintSweep(); } catch (e) { console.warn("авто-боя", e); break; }
    total += c;
    if (!c) break;
    try { if (typeof tLoadTasks === "function") await tLoadTasks(); } catch (e) { break; }
  }
  return total;
}

/* ---------- 🔧 Пускане на заседнали вериги ----------
   Отчети от масите/роботите ПРЕДИ поправката (версия 524) завършваха
   стъпката, но не пускаха следващата операция — веригата „засядаше".
   Този инструмент (бутон в Цехове, само за админи) намира всички такива:
   последна налична стъпка ГОТОВА (произведено ≥ количество), а следващата
   задача ЛИПСВА → чисти флага и я пуска през erpAdvanceSeq (с неговата
   дубъл-проверка). Проверява и финалните сглобявания. Идемпотентен —
   може да се пуска колкото пъти трябва. */
async function erpFixStuckChains() {
  if (!confirm("Да потърся ли заседнали вериги (готова стъпка без пусната следваща операция) и да ги пусна?")) return;
  let rows = [];
  try {
    const { data, error } = await erpSelectAll("tasks", "id,data,done");
    if (error) throw error;
    rows = (data || []).filter(r => r.data && r.data.source && r.data.source.seq);
  } catch (e) { alert("Грешка при четене на задачите: " + (e.message || e)); return; }
  const byChain = {};
  rows.forEach(r => {
    const s = r.data.source;
    const k = String(s.sampleId) + "|" + String(s.chainId);
    (byChain[k] = byChain[k] || []).push(r);
  });
  let launched = 0, finals = 0, scanned = 0;
  const names = [];
  for (const k of Object.keys(byChain)) {
    const chain = byChain[k].sort((a, b) => (Number(a.data.source.step) || 0) - (Number(b.data.source.step) || 0));
    const lastRow = chain[chain.length - 1];
    const t = { ...lastRow.data, id: lastRow.id };
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    if (!(qty > 0 && prod >= qty)) continue;   // последната налична стъпка не е готова — не е заседнала
    const src = t.source; const steps = src.steps || [];
    const nextStep = (Number(src.step) || 0) + 1;
    scanned++;
    if (nextStep < steps.length) {
      if (chain.some(r => (Number(r.data.source.step) || 0) === nextStep)) continue;   // следващата си я има
      delete src.advanced;   // флагът е вдигнат, но задачата липсва → пусни наново
      try {
        await erpAdvanceSeq(t);
        launched++;
        names.push(`${t.code || t.product || "?"} → ${(steps[nextStep] || {}).operation || "следваща"} (${(steps[nextStep] || {}).workshop || "?"})`);
      } catch (e) { console.warn("fix chain", e); }
    } else if (src.role === "part" && src.finalChainId && (src.finalSteps || []).length) {
      const before = rows.some(r => String(r.data.source.chainId) === String(src.finalChainId));
      if (before) continue;
      try { await erpAdvanceSeq(t); finals++; } catch (e) { console.warn("fix final", e); }
    }
  }
  try { if (typeof tLoadTasks === "function") { await tLoadTasks(); if (typeof renderTasks === "function") renderTasks(); } } catch (e) {}
  // Авто-боята веднага поема новопуснатите Бояджийно стъпки и бута нататък.
  let painted = 0;
  try { painted = await erpAutoPaint(); if (painted && typeof renderTasks === "function") renderTasks(); } catch (e) {}
  alert(`🔧 Проверени готови вериги: ${scanned}.\nПуснати следващи операции: ${launched}${names.length ? "\n• " + names.slice(0, 12).join("\n• ") + (names.length > 12 ? `\n…и още ${names.length - 12}` : "") : ""}\nПроверени финални сглобявания: ${finals}.${painted ? `\n🎨 Авто-отчетени в Бояджийно: ${painted}.` : ""}\n\n${launched || finals || painted ? "Новите задачи са в цеховете си." : "Няма заседнали вериги — всичко е пуснато."}`);
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

// Пряко вложените части на един възел, които СЕ ЗАПРИХОЖДАТ в Склад детайли
// (имат собствена операция) — с бройка за 1 бр. родител. Прозрачните възли
// (без своя операция) се „пробиват" до реалните детайли под тях. Ползва се при
// сглобяване, за да се изпишат вложените части от Склад детайли.
function erpDirectStockComponents(pid, anc) {
  anc = anc || new Set([pid]);
  const out = [];
  (ERP.linesByProduct[pid] || []).forEach(l => {
    if (!l.child_product_id || anc.has(l.child_product_id)) return;
    const per = Number(l.quantity) || 1;
    const childHasOp = (ERP.linesByProduct[l.child_product_id] || []).some(x => x.operation_id);
    if (childHasOp) {
      out.push({ pid: l.child_product_id, per });
    } else {
      erpDirectStockComponents(l.child_product_id, new Set([...anc, l.child_product_id]))
        .forEach(g => out.push({ pid: g.pid, per: (Number(g.per) || 0) * per }));
    }
  });
  const byPid = {};
  out.forEach(g => { byPid[g.pid] = (byPid[g.pid] || 0) + (Number(g.per) || 0); });
  return Object.keys(byPid).map(k => ({ pid: Number(k), per: byPid[k] }));
}

/* ---------- „Опаковка" — сглобяване на готов артикул от налични части ----------
   Изделие без собствена операция (напр. липсва „Опаковане" в рецептата) никога
   не се събира от производството: частите му влизат в Склад детайли, а самият
   артикул — не. Тук го сглобяваме без цех: изписваме директните складируеми
   части по рецептата (през прозрачните възли) и заприходяваме готовия. Ако
   част не достига, първо опитваме да сглобим НЕЯ от нейните части (рекурсивно,
   до 5 нива). Никога не изписваме повече от наличното — сглобява се толкова,
   колкото частите стигат. ref „сглоб:…" не се трие от „Нулирай тестови
   движения" (реална складова трансформация, като нит-сглоб).
   Връща { made, missing:[{pid,code,name,short}], error? }. */
async function erpAssembleFromParts(pid, qty, refLbl, _depth) {
  qty = Math.floor(Number(qty) || 0);
  const out = { made: 0, missing: [] };
  if (!(qty > 0)) return out;
  const depth = _depth || 0;
  let comps = erpDirectStockComponents(pid);
  // АКСЕСОАРИТЕ (спирачки, пружини, уши…) не се влагат при опаковката — те се
  // изписват при осчетоводяването на продажбата (erp-sales.js), иначе излизат
  // двойно. Опаковката сглобява само конструктивните части (половините).
  if (typeof NIT_ACCESSORY_CODES !== "undefined" && ERP.prodById)
    comps = comps.filter(c => { const p = ERP.prodById[c.pid]; return !(p && NIT_ACCESSORY_CODES.has(String(p.code || "").trim())); });
  if (!comps.length) return out;   // няма части по рецепта — няма какво да сглобим
  const stock = {};
  try {
    const { data, error } = await sb.from("v_product_stock").select("id,stock").in("id", comps.map(c => c.pid));
    if (error) { out.error = error.message; return out; }
    (data || []).forEach(r => { stock[r.id] = Number(r.stock) || 0; });
  } catch (e) { out.error = String(e && e.message || e); return out; }
  // Недостигащи части: първо опитваме да ги сглобим от техните части.
  if (depth < 5) {
    for (const c of comps) {
      const needQ = Math.ceil((Number(c.per) || 0) * qty);
      const have = Math.max(0, stock[c.pid] || 0);
      if (have < needQ) {
        const sub = await erpAssembleFromParts(c.pid, needQ - have, refLbl, depth + 1);
        if (sub.made > 0) stock[c.pid] = have + sub.made;
      }
    }
  }
  let can = qty;
  comps.forEach(c => {
    const per = Number(c.per) || 0;
    if (per <= 0) return;
    can = Math.min(can, Math.floor(Math.max(0, stock[c.pid] || 0) / per));
  });
  if (can > 0) {
    const p = (ERP.prodById && ERP.prodById[pid]) || {};
    const nm = ((p.code ? p.code + " " : "") + (p.name || "")).trim() || String(pid);
    const rows = comps
      .map(c => ({ product_id: Number(c.pid), kind: "изписване", quantity: -((Number(c.per) || 0) * can), ref: refLbl || "сглоб:", note: "Вложен в " + nm + " (опаковка)" }))
      .filter(r => r.quantity < 0);
    rows.push({ product_id: Number(pid), kind: "заприходяване", quantity: can, ref: refLbl || "сглоб:", note: "Опаковка — сглобен от налични части" });
    const { error } = await sb.from("product_movements").insert(rows);
    if (error) { out.error = error.message; return out; }
    out.made = can;
    // Опресняваме кеша, за да са верни следващите проверки без презареждане.
    if (ERP.prodById) {
      if (ERP.prodById[pid]) ERP.prodById[pid].stock = (Number(ERP.prodById[pid].stock) || 0) + can;
      comps.forEach(c => { const cp = ERP.prodById[c.pid]; if (cp) cp.stock = (Number(cp.stock) || 0) - (Number(c.per) || 0) * can; });
    }
  }
  if (can < qty) {
    comps.forEach(c => {
      const per = Number(c.per) || 0;
      if (per <= 0) return;
      const have0 = Math.max(0, stock[c.pid] || 0);
      if (Math.floor(have0 / per) < qty) {
        const cp = (ERP.prodById && ERP.prodById[c.pid]) || {};
        out.missing.push({ pid: c.pid, code: cp.code || "", name: cp.name || "", short: Math.max(0, per * qty - have0) });
      }
    });
  }
  return out;
}

function erpFlowSteps(s, opts) {
  const qty = erpToNum(s.erpQty) || 1;
  const steps = [], external = [], missing = [], materials = {};   // materials: material_id -> нужно к-во
  const stock = (opts && opts.stock) || null;
  const consumed = (opts && opts.consumed) || null;
  const route = op => (typeof erpEffectiveRoute === "function") ? erpEffectiveRoute(op) : { primary: op.workshop || "", alt: [] };
  // Суфикс на ключовете (за да не се смесва „производство за склад" с поръчковите серии).
  const sfx = (opts && opts.keySuffix) || "";
  const toStockTop = !!(opts && opts.toStockTop);   // готовият връх влиза в Склад детайли
  // Дали да НЕ нетваме върха срещу склада. Само при „производство ЗА склад"
  // (натрупваме нарочно). За ПОРЪЧКА върхът СЕ нетва — ако имаме готова/импортирана
  // наличност, тя се използва, вместо да произвеждаме наново.
  const noNetTop = !!(opts && opts.noNetTop);
  const nodes = [];      // { key, product, code, ops:[{operation,workshop,qty}], isTop }
  const nodeGate = {};   // node.key -> [seriesKey на директните части] — първата операция ги чака
  // walk връща { hasOps, make, outKeys }: outKeys = ключовете, чието завършване
  // означава „този подрод е готов за родителя" (за ЙЕРАРХИЧНО гейтване — всеки
  // възел чака своите директни части, не само финалът).
  (function walk(pid, mult, anc, depth) {
    // Нетна потребност: колко от този детайл има на склад -> толкова не се прави.
    // Върхът (depth 0) НЕ се нетва само при „производство ЗА склад" (noNetTop).
    // При ПОРЪЧКА върхът се нетва като всичко друго — използваме готовата наличност.
    let make = mult;
    let usedStock = 0;                       // колко от този детайл идват от готова наличност
    if (stock && !(depth === 0 && noNetTop)) {
      const have = Math.max(0, Number(stock[pid]) || 0);
      const use = Math.min(have, mult);
      if (use > 0) {
        stock[pid] = have - use;
        if (consumed) consumed[pid] = (consumed[pid] || 0) + use;
        make = mult - use;
        usedStock = use;
      }
    }
    if (make <= 0) return { hasOps: false, make: 0, outKeys: [] };   // целият детайл е от склада
    const p = ERP.prodById[pid] || {};
    const key = (p.code || p.name || String(pid));
    const ops = [];
    let childHasOps = false;
    const childOutKeys = [];   // изходите на директните деца (родителят ги чака)
    const nodeMats = {};       // material_id -> бройка за 1 бр. от този детайл (per)
    (ERP.linesByProduct[pid] || []).forEach(l => {
      if (l.operation_id) {
        const op = ERP.opById[l.operation_id] || {};
        let ws = (route(op).primary) || "";
        // Ръчно прехвърляне по детайл+операция (постоянно) — има превес над всичко.
        const dovr = (ERP.detailRouting || {})[erpDetailRouteKey(p.code, p.name, op.name)];
        if (dovr) ws = dovr;
        // Бройка за цеха = брой ДЕТАЙЛИ (make); l.quantity (2 огъвки/брой) е
        // само технологичен множител (цена/време), не умножава детайлите.
        const perUnit = Number(l.quantity) || 1;
        if (!ws || ws === "Външна услуга") { external.push({ op: op.name || "", product: p.name || "" }); return; }
        ops.push({ operation: op.name || "", workshop: ws, qty: make, opsPerUnit: perUnit });
      } else if (l.material_id) {
        // Смяна на материал САМО за тази поръчка (напр. Щрипс → Шина): рецептата
        // не се пипа, но изписването тегли заместителя от склада.
        const mid = (opts && opts.matSubs && opts.matSubs[l.material_id]) ? Number(opts.matSubs[l.material_id]) : l.material_id;
        const per = Number(l.quantity) || 1;
        materials[mid] = (materials[mid] || 0) + make * per;
        nodeMats[mid] = (nodeMats[mid] || 0) + per;   // за 1 бр. детайл
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
        // outKeys носят и НУЖНОТО количество за ТОЗИ възел (не сумата на серията),
        // за да не чака заваряването споделен детайл да се произведе за други изделия.
        (res.outKeys || []).forEach(o => childOutKeys.push(o));
      }
    });
    if (ops.length) {
      const mats = Object.keys(nodeMats).map(mid => ({ mid: Number(mid), per: nodeMats[mid] }));
      nodes.push({ pid, key, product: p.name || "", code: p.code || "", ops, isTop: depth === 0, mats, make });
      // Първата операция на този възел чака директните му части (с нужните бройки).
      // Носим и „stock" = колко от частта идват от готова наличност — за да може
      // сглобяването да тръгне веднага за наличните, без да чака рязането им.
      if (childOutKeys.length) {
        const byKey = {}, byStock = {};
        childOutKeys.forEach(o => {
          byKey[o.key] = (byKey[o.key] || 0) + (Number(o.need) || 0);
          byStock[o.key] = (byStock[o.key] || 0) + (Number(o.stock) || 0);
        });
        // per = части за 1 възел (КОНСТАНТА, не зависи от количеството) = (нужно+
        // от склад) / брой възли. Пази съотношението при обединяване на серии от
        // няколко заявки, където количеството расте, а нуждата се преизчислява.
        nodeGate[key] = Object.keys(byKey).map(k => {
          const need = byKey[k], stk = byStock[k] || 0;
          return { key: k, need, stock: stk, per: make > 0 ? (need + stk) / make : (need + stk) };
        });
      }
      // Изходът на този възел за родителя = последната му операция; нужното = make,
      // а stock = колко от този възел са от готова наличност.
      return { hasOps: true, make, outKeys: [{ key: key + "¦" + ops[ops.length - 1].operation + sfx, need: make, stock: usedStock }] };
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
    // Вложените части, които се ЗАПРИХОЖДАТ в склада (включително изцяло от склад,
    // затова е от рецептата, не от gate) — изписват се от Склад детайли на
    // сглобяващата операция (или на последната, ако няма явна сглобяваща).
    const stockComps = erpDirectStockComponents(n.pid);
    let consumeIdx = -1;
    if (stockComps.length) {
      consumeIdx = n.ops.findIndex(o => erpIsAssemblyOp(o.operation));
      if (consumeIdx < 0) consumeIdx = lastIdx;
    }
    n.ops.forEach((op, i) => {
      steps.push({
        product: n.product, code: n.code, operation: op.operation, workshop: op.workshop, qty: op.qty,
        opsPerUnit: op.opsPerUnit || 1,
        seriesKey: n.key + "¦" + op.operation + sfx,
        prevKey: i > 0 ? (n.key + "¦" + n.ops[i - 1].operation + sfx) : null,
        gate: (i === gateIdx && gate && gate.length) ? gate.slice() : null,
        consumes: (i === consumeIdx && stockComps.length) ? stockComps.slice() : null,
        materials: (i === 0 && n.mats && n.mats.length) ? n.mats.slice() : null,   // материалът се влага на първата операция (рязане)
        step: i, role: n.isTop ? "final" : "part", make: n.make,
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
    // Наличностите идват от изгледа v_product_stock (базата ги сумира) — преди
    // четяхме ВСИЧКИ движения по 1000 реда, което ставаше все по-бавно с растежа
    // на таблицата. Собствените стари order: изписвания на тази поръчка (стар
    // модел) се изключват, за да е идемпотентно повторното пускане.
    const { data: stockRows, error: sErr } = await erpSelectAll("v_product_stock", "id,stock");
    if (!sErr) {
      stockOn = true;
      (stockRows || []).forEach(r => { avail[r.id] = Number(r.stock) || 0; });
      try {
        const { data: ownMoves } = await sb.from("product_movements").select("product_id,quantity").eq("ref", ref);
        (ownMoves || []).forEach(m => { avail[m.product_id] = (Number(avail[m.product_id]) || 0) - (Number(m.quantity) || 0); });
      } catch (e) {}
      Object.keys(avail).forEach(k => { if (avail[k] < 0) avail[k] = 0; });
    }
  }

  // 0б) КРЪСТОСАНО нетване между заявки: една и съща наличност НЕ бива да се
  //     приспада на всяка заявка поотделно. Пазим колко е нетнала всяка заявка
  //     (по детайл) в app_config → flow_netting и намаляваме avail с вече заетото
  //     от ДРУГИТЕ заявки. Иначе 3 заявки за 500 при 100 налични биха пуснали
  //     1200 вместо 1400 (нетват едни и същи 100 три пъти).
  let flowNet = {};
  if (stockOn) {
    try {
      const { data } = await sb.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
      flowNet = (data && data.data && data.data.byOrder) || {};
    } catch (e) { flowNet = {}; }
    // Резервациите на ПРИКЛЮЧИЛИ заявки (завършена / готова за продажба) са
    // изтекли — взетото им от склад е вече консумирано в производството. Ако
    // останат, блокират наличност за новите заявки завинаги. Чистим ги тук
    // (записът по-долу така или иначе презаписва целия обект).
    try {
      const oids = Object.keys(flowNet).filter(k => String(k) !== sid);
      if (oids.length) {
        const { data: cos } = await sb.from("customer_orders").select("id,data").in("id", oids);
        (cos || []).forEach(r => {
          const st = (r.data && r.data.status) || "";
          if (st === "завършена" || st === "готова за продажба") delete flowNet[String(r.id)];
        });
      }
    } catch (e) { /* при грешка оставаме консервативни — не чистим */ }
    const reserved = {};
    Object.keys(flowNet).forEach(oid => {
      if (String(oid) === sid) return;                       // нашата стара резервация не се брои срещу нас
      const perPid = flowNet[oid] || {};
      Object.keys(perPid).forEach(pid => { reserved[pid] = (reserved[pid] || 0) + (Number(perPid[pid]) || 0); });
    });
    Object.keys(reserved).forEach(pid => { avail[pid] = Math.max(0, (Number(avail[pid]) || 0) - reserved[pid]); });
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
      ? { keySuffix: sfx, toStockTop: true, noNetTop: true, matSubs: meta.matSubs || null }   // за склад: върхът НЕ се нетва (натрупваме)
      : (stockOn ? { stock: avail, consumed, toStockTop: !!meta.stockTop, noNetTop: !!meta.noNetTop, matSubs: meta.matSubs || null }   // поръчка: върхът СЕ нетва, освен ако готовото е пазено за друга заявка (noNetTop)
                 : { toStockTop: !!meta.stockTop, noNetTop: !!meta.noNetTop, matSubs: meta.matSubs || null });
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
  // Запазваме нетването на ТАЗИ заявка (по детайл) в app_config → flow_netting,
  // за да не се приспада същата наличност пак от следваща заявка (кръстосано
  // нетване). Освобождава се при „Изтегли от производство" (erpFlowRemoveOrder).
  if (stockOn) {
    const mineNet = {};
    Object.keys(consumed).forEach(pid => { const u = Number(consumed[pid]) || 0; if (u > 0) mineNet[pid] = u; });
    if (Object.keys(mineNet).length) flowNet[sid] = mineNet; else delete flowNet[sid];
    try { await sb.from("app_config").upsert({ id: "flow_netting", data: { byOrder: flowNet }, updated_at: new Date().toISOString() }); } catch (e) {}
  }
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

  // 1б) Наличните детайли НЕ се пускат в цех (само намаляват производството).
  //     ВЕЧЕ НЕ ги изписваме тук — изписването става при СГЛОБЯВАНЕ на родителя
  //     (erpFlowConsume), за да не се брои двойно. Тук само чистим стари order:
  //     движения (от предишния модел) и градим списъка „взето от склад" за съобщение.
  const fromStock = [];
  if (stockOn) {
    try { await sb.from("product_movements").delete().eq("ref", ref); } catch (e) {}   // стар модел — чистим
    Object.keys(consumed).forEach(pid => {
      const qtyUsed = Number(consumed[pid]) || 0;
      if (qtyUsed <= 0) return;
      const p = ERP.prodById[pid] || {};
      fromStock.push({ pid: Number(pid), code: p.code || "", name: p.name || "", qty: qtyUsed });
    });
  }

  // 1в) МАТЕРИАЛИТЕ ВЕЧЕ НЕ се изписват при пускане — излизат при РЯЗАНЕ (първата
  //     операция), точно колкото е нарязано (erpFlowMaterialConsume). Тук само
  //     чистим стари order: движения (от предишния модел) и смятаме недостига за
  //     информационно съобщение „ще ти липсва материал".
  const materialsShort = [];
  {
    try { await sb.from("stock_movements").delete().eq("ref", ref); } catch (e) {}   // стар модел — чистим
    Object.keys(matNeed).forEach(mid => {
      const q = Number(matNeed[mid]) || 0;
      if (q <= 0) return;
      const m = (ERP.matById && ERP.matById[mid]) || {};
      const have = Number(m.stock) || 0;
      if (q > have) materialsShort.push({ code: m.code || "", name: m.name || "", unit: m.unit || "", need: q, have });
    });
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
    // _touched: пипната от ТАЗИ поръчка → само тя се записва после. Останалите
    // серии не се презаписват (преди се пренаписваха ВСИЧКИ задачи в системата —
    // все по-бавно с растежа им и с риск да върнат назад междувременен цехов отчет).
    bySeries[src.seriesKey] = { id: r.id, data: d, _touched: idx >= 0 };
  });

  // 3б) АРХИВ на изцяло готовите серии: нова заявка за същия детайл НЕ бива да
  // се обединява със стара, ВЕЧЕ ИЗПЪЛНЕНА — числата се сливаха (напр. „250/400"
  // при нови 150) и изпълнени задачи се събуждаха. Ако серията, в която ще
  // добавяме, е готова (произведено ≥ количество) И всички свързани с нея серии
  // (по prevKey/gate — цялата верига) също са готови, преименуваме ключовете на
  // цялата верига (¦арх:…) и новата заявка тръгва на чисто от 0. Ако някоя част
  // от старата верига още тече, НЕ архивираме (кумулативният модел си остава верен).
  {
    const doneT = r => { const d = r.data || {}; const q = Number(d.qty) || 0; return q > 0 && (Number(d.produced) || 0) >= q; };
    const linkKeys = src => {
      const out = [];
      if (src.prevKey) out.push(src.prevKey);
      if (Array.isArray(src.gate)) src.gate.forEach(g => { const k = (typeof g === "string") ? g : (g && g.key); if (k) out.push(k); });
      return out;
    };
    const adj = {};
    Object.keys(bySeries).forEach(k => {
      const src = bySeries[k].data.source || {};
      linkKeys(src).forEach(pk => {
        if (!bySeries[pk]) return;
        (adj[k] = adj[k] || new Set()).add(pk);
        (adj[pk] = adj[pk] || new Set()).add(k);
      });
    });
    const toArchive = new Set();
    myKeys.forEach(k => {
      const r0 = bySeries[k];
      if (!r0 || toArchive.has(k) || !doneT(r0)) return;
      const comp = new Set([k]); const queue = [k];
      while (queue.length) { const c = queue.pop(); [...(adj[c] || [])].forEach(n => { if (!comp.has(n)) { comp.add(n); queue.push(n); } }); }
      if ([...comp].every(c => doneT(bySeries[c]))) comp.forEach(c => toArchive.add(c));
    });
    if (toArchive.size) {
      const tag = "¦арх:" + Date.now().toString(36);
      for (const k of toArchive) {
        const r0 = bySeries[k];
        const src = r0.data.source || {};
        src.seriesKey = k + tag;
        if (src.prevKey && toArchive.has(src.prevKey)) src.prevKey = src.prevKey + tag;
        if (Array.isArray(src.gate)) src.gate = src.gate.map(g => (typeof g === "string")
          ? (toArchive.has(g) ? g + tag : g)
          : (g && g.key && toArchive.has(g.key) ? { ...g, key: g.key + tag } : g));
        try { await sb.from("tasks").update({ data: r0.data, updated_at: new Date().toISOString() }).eq("id", r0.id); } catch (e) { /* при грешка старото сливане остава */ }
        delete bySeries[k];   // стъпка 4 ще създаде ЧИСТА нова серия на стандартния ключ
      }
    }
  }

  // 4) Добавяме новите приноси (нова серия или обединяване към съществуваща).
  myKeys.forEach(k => {
    const add = mine[k], st = add.st;
    let r = bySeries[k];
    if (!r) {
      r = { id: null, _new: true, data: {
        client: "", product: st.product, code: st.code, operation: st.operation, workshop: st.workshop,
        qty: 0, opsPerUnit: st.opsPerUnit || 1, produced: 0, due: "", thickness: "", files: [], logs: [],
        source: {
          kind: "series", flow: true, seriesKey: k, prevKey: st.prevKey || null, gate: st.gate || null,
          consumes: st.consumes || null, materials: st.materials || null,
          step: st.step, role: st.role || "part", code: st.code, product: st.product,
          orders: [], orderIds: [], sampleType: meta.sampleType || "order",
          pid: st.pid, last: !!st.last, toStock: !!st.toStock, stock: toStock, stocked: 0, consumedUnits: 0, matConsumed: 0,
        },
      } };
      bySeries[k] = r;
    }
    const src = r.data.source;
    r._touched = true;
    // Обновяваме метаданните на потока според ТЕКУЩАТА рецепта (при повторно
    // пускане след промяна) — така новодобавени операции и ново изчакване се
    // отразяват, а произведеното/логовете/цехът се запазват.
    src.prevKey = st.prevKey || null;
    src.consumes = st.consumes || null;
    src.materials = st.materials || null;
    r.data.opsPerUnit = st.opsPerUnit || 1;
    src.step = st.step;
    src.role = st.role || src.role || "part";
    src.last = !!st.last;
    src.toStock = !!st.toStock;
    src.pid = st.pid;
    src.orders = src.orders || [];
    // Gate при СПОДЕЛЕНА серия: per (части за 1 възел) е константа и се презаписва
    // безопасно; stock (части от готова наличност) се НАТРУПВА по заявки — пазим
    // приноса на всяка заявка в order.gateStock, за да е коректно и при повторно
    // пускане/изтегляне. Иначе gate на едната заявка се презаписваше, а
    // количеството растеше → грешно съотношение и отрицателен склад детайли.
    const myGateStock = {};
    if (Array.isArray(st.gate)) st.gate.forEach(g => { if (g && g.key != null) myGateStock[g.key] = Number(g.stock) || 0; });
    src.orders.push({ id: meta.sampleId, no: meta.orderNo || "", client: meta.clientName || "", due: meta.deadline || "", qty: add.qty, gateStock: Object.keys(myGateStock).length ? myGateStock : undefined });
    src.orderIds = src.orders.map(o => String(o.id));
    r.data.qty = (Number(r.data.qty) || 0) + add.qty;
    if (Array.isArray(st.gate) && st.gate.length) {
      src.gate = st.gate.map(g => ({
        key: g.key,
        per: (g.per != null) ? Number(g.per) : null,
        stock: src.orders.reduce((s, o) => s + ((o.gateStock && Number(o.gateStock[g.key])) || 0), 0),
      }));
    } else {
      src.gate = null;
    }
    // Закачаме чертежите от рецептата на детайла (без дублиране).
    const dr = drawingsByPid[st.pid] || [];
    if (dr.length) {
      r.data.files = r.data.files || [];
      dr.forEach(f => { if (f && f.path && !r.data.files.some(g => g.path === f.path)) r.data.files.push({ name: f.name, type: f.type, path: f.path, url: f.url }); });
    }
  });

  // 5) Клиент/срок според броя поръчки; трием изпразнените серии. Записват се
  //    САМО пипнатите от тази поръчка серии (_new/_touched) — и то на партиди
  //    паралелно, не една по една.
  const toInsert = [], toUpdate = [];
  for (const k of Object.keys(bySeries)) {
    const r = bySeries[k], src = r.data.source || {}, orders = src.orders || [];
    if (!orders.length) {
      if (r.id) {
        await sb.from("tasks").delete().eq("id", r.id);
        // Чистим и породените движения — иначе остават „фантомни" готови детайли/
        // материали и повторното пускане ги удвоява (както в erpFlowRemoveOrder).
        try { await sb.from("product_movements").delete().in("ref", ["prod:" + r.id, "consume:" + r.id]); } catch (e) {}
        try { await sb.from("stock_movements").delete().eq("ref", "matprod:" + r.id); } catch (e) {}
      }
      continue;
    }
    if (!r._new && !r._touched) continue;   // чужда серия — не я пипаме
    // Серия (2+ поръчки) няма клиент/срок в колоните — показва „СЕРИЯ".
    r.data.client = orders.length >= 2 ? "" : (orders[0].client || "");
    r.data.due = orders.length >= 2 ? "" : (orders[0].due || "");
    if (r._new) { toInsert.push(r.data); continue; }
    toUpdate.push(r);
  }
  const UP_CHUNK = 10;
  for (let i = 0; i < toUpdate.length; i += UP_CHUNK) {
    const part = toUpdate.slice(i, i + UP_CHUNK);
    const results = await Promise.all(part.map(r => {
      const qty = Number(r.data.qty) || 0, prod = Number(r.data.produced) || 0;
      return sb.from("tasks").update({ data: r.data, done: qty > 0 && prod >= qty, updated_at: new Date().toISOString() }).eq("id", r.id);
    }));
    const bad = results.find(x => x && x.error);
    if (bad) return { error: bad.error };
  }
  if (toInsert.length) {
    const { error } = await sb.from("tasks").insert(toInsert.map(d => ({ data: d })));
    if (error) return { error };
  }
  return { external: externalAll, seriesCount: myKeys.length, fromStock, missing: missingList, materialsShort, error: null };
}

// Освобождава резервираната от заявка наличност (кръстосано нетване), за да я
// ползват другите заявки. Вика се при изтегляне И при приключване/продажба на
// заявката — тогава наличността вече е реално изписана и резервацията трябва да
// падне, иначе застоява и блокира нетването на бъдещи заявки.
async function erpReleaseNetting(sampleId) {
  const sid = String(sampleId);
  try {
    const { data: cfg } = await sb.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
    const byOrder = (cfg && cfg.data && cfg.data.byOrder) || {};
    if (byOrder[sid]) { delete byOrder[sid]; await sb.from("app_config").upsert({ id: "flow_netting", data: { byOrder }, updated_at: new Date().toISOString() }); }
  } catch (e) {}
}

// Маха поръчка от поточните серии (при триене на заявка). Изпразнените серии
// се трият; частично споделените се обновяват (количество/клиент/срок).
async function erpFlowRemoveOrder(sampleId) {
  const sid = String(sampleId);
  await sb.from("tasks").delete().eq("data->source->>sampleId", sid);   // стари непоточни
  try { await sb.from("product_movements").delete().eq("ref", "order:" + sid); } catch (e) {}  // връщаме взетото от склад
  try { await sb.from("stock_movements").delete().eq("ref", "order:" + sid); } catch (e) {}    // връщаме вложените материали
  await erpReleaseNetting(sid);
  const { data } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
  for (const r of (data || [])) {
    const d = r.data || {}, src = d.source || {};
    if (src.kind !== "series") continue;
    const orders = (src.orders || []).slice();
    const idx = orders.findIndex(o => String(o.id) === sid);
    if (idx < 0) continue;
    d.qty = Math.max(0, (Number(d.qty) || 0) - (Number(orders[idx].qty) || 0));
    orders.splice(idx, 1);
    if (!orders.length) {
      await sb.from("tasks").delete().eq("id", r.id);
      // Изтриваме и движенията, породени от тази задача — иначе остават „фантомни"
      // готови детайли/материали и повторното пускане ги удвоява.
      try { await sb.from("product_movements").delete().in("ref", ["prod:" + r.id, "consume:" + r.id]); } catch (e) {}
      try { await sb.from("stock_movements").delete().eq("ref", "matprod:" + r.id); } catch (e) {}
      continue;
    }
    src.orders = orders; src.orderIds = orders.map(o => String(o.id));
    d.client = orders.length >= 2 ? "" : (orders[0].client || "");
    d.due = orders.length >= 2 ? "" : (orders[0].due || "");
    // Gate: per остава, stock (части от склад) се преизчислява от останалите заявки.
    if (Array.isArray(src.gate) && src.gate.some(g => g && g.per != null)) {
      src.gate = src.gate.map(g => ({
        key: g.key, per: g.per,
        stock: orders.reduce((s, o) => s + ((o.gateStock && Number(o.gateStock[g.key])) || 0), 0),
      }));
    }
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
  // Гейт (сглобяване/заваряване): ВЕЧЕ НЕ е „всичко или нищо". Позволяваме
  // ЧАСТИЧНО сглобяване — колкото родители стигат готовите части. Пример: за
  // 100 бр. е нарязана само 30 части → може да се заварят 30, а останалите 70
  // изчакват частите. gateLimit = най-малкият брой родители, който всяка гейтна
  // част покрива. Липсваща серия (изцяло от склад) не ограничава.
  let gateLimit = Infinity;
  if (Array.isArray(src.gate) && src.gate.length) {
    src.gate.forEach(entry => {
      const k = (typeof entry === "string") ? entry : (entry && entry.key);
      // fromStock = колко части са ПОКРИТИ ОТ ГОТОВА НАЛИЧНОСТ (налични веднага,
      // не чакат рязане). Натрупано по всички заявки в серията.
      const fromStock = (typeof entry === "string") ? 0 : (Number(entry && entry.stock) || 0);
      const per = (typeof entry === "object" && entry && entry.per != null) ? Number(entry.per) : null;
      const g = map[k];
      if (!g) return;                        // няма серия (изцяло от склад) → не ограничава
      const produced = Number(g.produced) || 0;
      if (per != null) {
        // НОВ формат: per = части за 1 възел (константа, независима от заявките).
        // Налични части сега = от склад + произведени; толкова възела могат да се
        // сглобят. Пази коректност при обединени серии от няколко заявки.
        const have = fromStock + produced;
        const covers = per > 0 ? Math.floor(have / per) : (have > 0 ? qty : 0);
        gateLimit = Math.min(gateLimit, covers);
        return;
      }
      // СТАР формат: {key, need(, stock)} или низ (за серии, пуснати преди фикса).
      const need = (typeof entry === "string") ? null : (Number(entry && entry.need) || 0);
      if (need == null || need <= 0) {
        if (produced < (Number(g.qty) || 0)) gateLimit = 0;
        return;
      }
      const total = need + fromStock;
      const perL = qty > 0 ? total / qty : total;
      const have = fromStock + produced;
      const covers = perL > 0 ? Math.floor(have / perL) : (have >= total ? qty : 0);
      gateLimit = Math.min(gateLimit, covers);
    });
  }
  let avail;
  if (src.prevKey) {
    // Брак при настройка на ТАЗИ операция „изяжда" толкова детайла от входа —
    // затова ги вадим от наличното (те са бракувани, не могат да се обработят).
    // Допълнителните бройки за тях се нарязват наново от първата операция.
    const brak = Number(t.brak) || 0;
    const up = map[src.prevKey];
    avail = Math.max(0, (up ? up.produced : 0) - prod - brak);
  } else {
    avail = Math.max(0, qty - prod);
  }
  // Гейтът ограничава ОБЩИЯ брой сглобени (gateLimit); вадим вече сглобеното.
  if (gateLimit !== Infinity) avail = Math.min(avail, Math.max(0, gateLimit - prod));
  return avail;
}

// Кои гейтни части реално още не са готови (за ясно съобщение „чака: …").
function erpFlowGatePending(t, map) {
  const src = t && t.source;
  if (!src || !Array.isArray(src.gate)) return [];
  const out = [];
  const tqty = Number(t && t.qty) || 0;
  src.gate.forEach(entry => {
    const k = (typeof entry === "string") ? entry : (entry && entry.key);
    const fromStock = (typeof entry === "string") ? 0 : (Number(entry && entry.stock) || 0);
    const per = (typeof entry === "object" && entry && entry.per != null) ? Number(entry.per) : null;
    const g = map[k];
    if (!g) return;
    const producedNow = Number(g.produced) || 0;
    const p = String(k).split("¦");
    if (per != null) {
      // Нужни части общо = per × брой възли; налични = склад + произведени.
      const totalParts = per * tqty;
      const haveParts = fromStock + producedNow;
      if (totalParts > 1e-9 && haveParts < totalParts - 1e-9) {
        out.push({ code: p[0] || "", operation: p[1] || "", produced: haveParts, qty: totalParts });
      }
      return;
    }
    // Стар формат.
    const need = (typeof entry === "string") ? null : (Number(entry && entry.need) || 0);
    const target = (need != null && need > 0) ? Math.min(need, Number(g.qty) || 0) : (Number(g.qty) || 0);
    if (target > 0 && producedNow < target) {
      out.push({ code: p[0] || "", operation: p[1] || "", produced: producedNow + fromStock, qty: target + fromStock });
    }
  });
  return out;
}

// Кодовете, чийто склад се води от екрана „Занитване" (nit.js): поточните им
// задачи движат САМО прогреса на заявката — заприходяването, влагането на
// части и материалите ги прави нит-отчетът (иначе става двойно: веднъж от
// жените в Занитване, втори път от Цехове/Мастер отчитане).
function erpNitManagedCode(code) {
  if (typeof NIT_STOCK_MAP === "undefined" || !code) return false;
  if (!erpNitManagedCode._set) {
    const s = new Set();
    Object.values(NIT_STOCK_MAP).forEach(m => { if (m && m.d) s.add(String(m.d)); if (m && m.l) s.add(String(m.l)); });
    if (typeof NIT_COMBINE !== "undefined") NIT_COMBINE.forEach(c => { if (c) { s.add(String(c.a)); s.add(String(c.b)); s.add(String(c.to)); } });
    // Операциите с избор на изделие (крака, крайни механизми) — също нит-управлявани.
    if (typeof NIT_PICK_RULES !== "undefined") Object.values(NIT_PICK_RULES).forEach(rules => Object.keys(rules || {}).forEach(c => s.add(String(c))));
    // Голите BOM-крака: нямат складов живот — потокът не бива да ги заприходява.
    if (typeof NIT_LEG_BOM_CODES !== "undefined") NIT_LEG_BOM_CODES.forEach(c => s.add(String(c)));
    erpNitManagedCode._set = s;
  }
  return erpNitManagedCode._set.has(String(code).trim());
}

// Заприходява готови детайли в Склад детайли (движение „заприходяване").
async function erpStockCredit(pid, qty, note, ref) {
  if (!pid || !(qty > 0)) return;
  try {
    await sb.from("product_movements").insert({ product_id: Number(pid), kind: "заприходяване", quantity: qty, ref: ref || "", note: note || "" });
  } catch (e) { console.error("stock credit", e); }
}

// След отчитане на ПОСЛЕДНАТА операция на детайл/възел — вкарва ВСИЧКОТО
// произведено в Склад детайли (не се заключва към заявка). Изписва се после при
// сглобяване на родителя (erpFlowConsume) или при Продажба. Идемпотентно чрез
// source.stocked (заприходяваме само новата разлика).
async function erpFlowStockIn(t) {
  const src = t && t.source;
  if (!src || !src.flow || !src.last || !src.pid) return;
  if (erpNitManagedCode(t.code)) return;   // складът на този код се води от Занитване
  const produced = Number(t.produced) || 0;
  const stocked = Number(src.stocked) || 0;
  const delta = produced - stocked;
  if (delta <= 0) return;
  await erpStockCredit(src.pid, delta, "Производство · " + (t.code || t.product || ""), "prod:" + t.id);
  src.stocked = produced;
  if (typeof tSaveTask === "function") await tSaveTask(t);
}

// При отчитане на СГЛОБЯВАЩАТА операция — изписва вложените части от Склад
// детайли (толкова, колкото сглобени бройки × бройка за 1 родител). Така
// произведените части не се трупат: влизат при производство, излизат при
// сглобяване. Идемпотентно чрез source.consumedUnits (изписваме само делтата).
async function erpFlowConsume(t) {
  const src = t && t.source;
  if (!src || !src.flow || !Array.isArray(src.consumes) || !src.consumes.length) return;
  if (erpNitManagedCode(t.code)) return;   // влагането на частите го прави нит-отчетът
  const produced = Number(t.produced) || 0;
  const done = Number(src.consumedUnits) || 0;
  const delta = produced - done;
  if (delta <= 0) return;
  const rows = [];
  src.consumes.forEach(c => {
    const pid = Number(c && c.pid) || 0;
    const use = (Number(c && c.per) || 0) * delta;
    if (pid && use > 0) rows.push({ product_id: pid, kind: "изписване", quantity: -use, ref: "consume:" + t.id, note: "Вложен в " + (t.code || t.product || "") });
  });
  if (rows.length) { try { await sb.from("product_movements").insert(rows); } catch (e) { console.error("consume", e); } }
  src.consumedUnits = produced;
  if (typeof tSaveTask === "function") await tSaveTask(t);
}

// При отчитане на РЯЗАНЕТО (първата операция) — изписва материала от склад
// материали (нарязани бройки × материал за 1 бр.). Материалът вече не излиза при
// пускане, а точно колкото е нарязано. Идемпотентно чрез source.matConsumed.
async function erpFlowMaterialConsume(t) {
  const src = t && t.source;
  if (!src || !src.flow || !Array.isArray(src.materials) || !src.materials.length) return;
  if (erpNitManagedCode(t.code)) return;   // нитовете/шайбите ги изписва нит-отчетът
  const produced = Number(t.produced) || 0;
  const done = Number(src.matConsumed) || 0;
  const delta = produced - done;
  if (delta <= 0) return;
  const rows = [];
  src.materials.forEach(m => {
    const mid = Number(m && m.mid) || 0;
    const use = (Number(m && m.per) || 0) * delta;
    if (mid && use > 0) rows.push({ material_id: mid, kind: "изписване", quantity: -use, ref: "matprod:" + t.id, note: "Вложен в " + (t.code || t.product || "") });
  });
  if (rows.length) { try { await sb.from("stock_movements").insert(rows); } catch (e) { console.error("mat consume", e); } }
  src.matConsumed = produced;
  if (typeof tSaveTask === "function") await tSaveTask(t);
}

// Жив списък „необходими материали" — сумира оставащата нужда за материал по
// ВСИЧКИ активни поточни задачи (за 1-ва операция) и вади наличното. Показва
// колко трябва да се купи. rows от erpFlowMatNeeded(TASKS).
function erpFlowMatNeeded(tasks) {
  const need = {};   // material_id -> оставаща нужда
  (tasks || []).forEach(t => {
    const src = t && t.source;
    if (!src || !src.flow || !Array.isArray(src.materials) || !src.materials.length) return;
    const remaining = Math.max(0, (Number(t.qty) || 0) - (Number(t.produced) || 0));
    if (remaining <= 0) return;
    src.materials.forEach(m => {
      const mid = Number(m && m.mid) || 0;
      if (!mid) return;
      need[mid] = (need[mid] || 0) + (Number(m && m.per) || 0) * remaining;
    });
  });
  return Object.keys(need).map(mid => {
    const m = (ERP.matById && ERP.matById[mid]) || {};
    const q = need[mid], have = Math.max(0, Number(m.stock) || 0);
    return { mid: Number(mid), code: m.code || "", name: m.name || "", unit: m.unit || "", need: q, have, buy: Math.max(0, q - have) };
  }).sort((a, b) => b.buy - a.buy || String(a.name).localeCompare(String(b.name), "bg"));
}

// Пуска детайл за производство ЗА СКЛАД (без заявка). Минава по цеховете и щом
// последната операция се отчете, готовите бройки влизат в Склад детайли.
async function erpProduceToStock(productId, qty) {
  if (typeof produceAllowed === "function" && !produceAllowed()) { alert("Пускането в производство към момента е позволено само на Данко и Григор."); return { error: true }; }
  try { await erpEnsureLoaded(); } catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return { error: true }; }
  const p = ERP.prodById[productId] || {};
  const q = erpToNum(qty) || 0;
  if (!(q > 0)) { alert("Въведи брой по-голям от 0."); return { error: true }; }
  const pre = erpFlowSteps({ erpProductId: productId, erpQty: q }, { toStockTop: true, noNetTop: true });
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
  if (typeof produceAllowed === "function" && !produceAllowed()) { alert("Пускането в производство към момента е позволено само на Данко и Григор."); return; }
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
  s.production = { at: new Date().toISOString(), count: res.seriesCount, flow: true, external: external.length, fromStock: fs.length, stockCover: fs };
  touch(s);
  erpRenderOrderPanel(s);
  const miss = res.missing || [];
  const matShort = res.materialsShort || [];
  // Всичко е налично от склада — няма какво да се произвежда.
  if (res.seriesCount === 0 && !miss.length) {
    alert(`✅ Всичко е налично в Склад детайли — няма какво да се произвежда.\n`
      + (fs.length ? `\n📦 Покрито от склад:\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.` ).join("\n") + `\n` : "")
      + `\nПоръчката е готова за продажба — натисни „🧾 Създай продажба".`);
    return;
  }
  alert(`Готово! Пуснах поточно производство (${res.seriesCount} операции).\n`
    + `Всяка следваща операция приема детайлите постепенно, колкото са отчетени в предната.`
    + `\n\n📥 Като се отчете последната операция, готовите детайли влизат в Склад детайли. После натисни „🧾 Създай продажба", за да ги изпишеш с продажба.`
    + (fs.length ? `\n\n📦 Взети от склад (не се пускат в цех):\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.`).join("\n") : "")
    + (matShort.length ? `\n\n⚠ НЯМА ДА СТИГНЕ МАТЕРИАЛ (виж таб „⚠ Липсващи материали"):\n` + matShort.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужно ${erpNum(m.need)}, налично ${erpNum(m.have)} ${m.unit || ""}`).join("\n") : "")
    + (miss.length ? `\n\n⚠ Сглобяването НЕ е пуснато — липсват детайли без рецепта/наличност:\n` + miss.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: ${erpNum(m.qty)} бр.`).join("\n") : "")
    + (external.length ? `\n\n(${external.length} външни операции са за подизпълнител.)` : ""));
  if (typeof erpUpdateMissingBadge === "function") erpUpdateMissingBadge();   // осветяваме таба, ако липсва материал
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
  // Всичко е било налично от склада — 0 операции, но производството Е пуснато.
  const allFromStock = !planned && s.production && Number(s.production.count) === 0;
  box.innerHTML = planned
    ? `<div class="erp-prod-line"><b>Поточно производство:</b> ${done} / ${planned} операции готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button type="button" class="btn btn-small" id="erp-op-refresh">↻</button></div>
       <div class="erp-prod-active">${activeHtml}</div>`
    : (allFromStock
        ? `<div class="erp-prod-active" style="color:#047857"><b>✅ Всичко е налично в Склад детайли</b> — няма какво да се произвежда. Готово за продажба (🧾 Създай продажба).</div>`
        : `<span class="erp-muted">Няма задачи за тази поръчка (възможно е да са изчистени от цеха).</span>`);
  const rb = document.getElementById("erp-op-refresh");
  if (rb) rb.addEventListener("click", () => erpShowProduction(s));
}
