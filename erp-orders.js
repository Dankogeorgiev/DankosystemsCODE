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

async function erpProduce(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  if (!s.erpProductId) { alert("Първо свържи продукт от ЕРП."); return; }

  const plan = erpPlanProduction(s.erpProductId, erpToNum(s.erpQty) || 1, {
    clientName: s.clientName || "", deadline: s.deadline || "", kind: "order",
    sampleId: s.id, sampleType: s.type || "order", group: String(s.id),
  });
  if (!plan.totalSteps) {
    alert("Няма операции за пускане. Проверете дали продуктът има рецепта с операции и дали операциите са насочени към цех (таб Операции → Цех).");
    return;
  }
  const already = s.production && s.production.count;
  let msg = `Ще пусна производството за „${s.erpProductName}" × ${erpNum(erpToNum(s.erpQty) || 1)} бр.\n\n`
    + `Стартират НАВЕДНЪЖ първите операции на ${plan.chainCount} възела/детайла. Всеки възел после върви последователно през своите операции.`;
  if (plan.hasFinal) msg += `\n\nФиналното сглобяване на целия продукт тръгва след като всички възли са готови.`;
  if (plan.external.length) msg += `\n\n${plan.external.length} външни операции (напр. поцинковане) са за подизпълнител.`;
  if (already) msg += `\n\n⚠ Вече има пуснато производство. Ще го заменя с ново.`;
  if (!confirm(msg)) return;

  // Идемпотентност: махаме старите задачи за тази поръчка, после пускаме първите операции.
  const del = await sb.from("tasks").delete().eq("data->source->>sampleId", String(s.id));
  if (del.error) { alert("Грешка при изчистване на старите задачи: " + del.error.message); return; }
  const { error } = await sb.from("tasks").insert(plan.firstTasks.map(t => ({ data: t })));
  if (error) { alert("Грешка при създаване на задачи: " + error.message); return; }

  s.production = { at: new Date().toISOString(), count: plan.totalSteps, chains: plan.chainCount, external: plan.external.length, seq: true, hasFinal: plan.hasFinal };
  touch(s);
  erpRenderOrderPanel(s);
  alert(`Готово! Стартирах първите операции на ${plan.chainCount} възела наведнъж.\n`
    + `Всеки възел ще върви последователно; следващите операции тръгват автоматично след отчитане.`
    + (plan.hasFinal ? `\nФиналното сглобяване ще тръгне след като всички възли са готови.` : "")
    + (plan.external.length ? `\n(${plan.external.length} външни операции са за подизпълнител.)` : ""));
}

/* ---------- Проследяване на напредъка ---------- */
async function erpShowProduction(s) {
  const box = document.getElementById("erp-op-status");
  if (!box) return;
  box.innerHTML = `<span class="erp-muted">Производство: зареждане на напредъка…</span>`;
  const { data, error } = await sb.from("tasks").select("data,done").eq("data->source->>sampleId", String(s.id));
  if (error) { box.innerHTML = `<span class="erp-warn">Не мога да заредя напредъка: ${escapeHtml(error.message)}</span>`; return; }
  const rows = data || [];
  const planned = (s.production && s.production.count) || rows.length;
  const done = rows.filter(r => r.done).length;
  const active = rows.filter(r => !r.done).map(r => r.data || {});
  const pct = planned ? Math.round(done / planned * 100) : 0;
  const activeHtml = active.length
    ? active.map(a => `↳ сега в цех <b>${escapeHtml(a.workshop || "")}</b>: ${escapeHtml(a.operation || "")}`).join("<br>")
    : (done ? "✓ всички операции са готови" : "");
  box.innerHTML = rows.length
    ? `<div class="erp-prod-line"><b>Производство (последователно):</b> ${done} / ${planned} операции готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button type="button" class="btn btn-small" id="erp-op-refresh">↻</button></div>
       <div class="erp-prod-active">${activeHtml}</div>`
    : `<span class="erp-muted">Няма задачи за тази поръчка (възможно е да са изчистени от цеха).</span>`;
  const rb = document.getElementById("erp-op-refresh");
  if (rb) rb.addEventListener("click", () => erpShowProduction(s));
}
