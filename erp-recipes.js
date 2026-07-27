/* Данко Системс — ЕРП екран „Рецепта" (многостепенно дърво).
   Разгъва продукт → съставки; полуфабрикатите се разгъват надолу по нивата.
   До всеки ред: количество, мярка, себестойност. Цветово по вид. */

function erpRenderRecipe(productId) {
  const p = ERP.prodById[productId];
  const v = erpView();
  if (!p) { v.innerHTML = `<p class="report-empty">Продуктът не е намерен.</p>`; return; }
  ERP._recipeTop = productId;   // отвореният отгоре продукт (за пре-рисуване след корекции по вложени редове)

  // Готова ли е технологията за производство? (има поне една операция с цех в дървото)
  const prodReady = (function () {
    const seen = new Set();
    return (function walk(pid) {
      if (seen.has(pid)) return false; seen.add(pid);
      for (const l of (ERP.linesByProduct[pid] || [])) {
        if (l.operation_id) {
          const op = ERP.opById[l.operation_id];
          const ws = op && typeof erpEffectiveRoute === "function" ? erpEffectiveRoute(op).primary : (op && op.workshop);
          if (ws && ws !== "Външна услуга") return true;
        }
        if (l.child_product_id && walk(l.child_product_id)) return true;
      }
      return false;
    })(productId);
  })();
  const readyBadge = prodReady
    ? `<span class="erp-ready-ok" title="Има операции с цех — може да се пуска в производство">✅ готова за производство</span>`
    : `<span class="erp-ready-no" title="Добави поне една операция с цех">⏳ добави операция с цех</span>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="erp-recipe-back">← Назад към продуктите</button>
      <label class="erp-inline">Бройка <input type="number" id="erp-wc-qty" min="1" step="any" value="1" style="width:70px" /></label>
      <button class="btn btn-small" id="erp-wc-print">🖨 Работна карта</button>
      <button class="btn btn-small" id="erp-recipe-test" title="Симулира пускането в производство — проверява дали ще върви правилно">🧪 Тест рецепта</button>
      <button class="btn btn-small" id="erp-recipe-stock" title="Дървото на изделието с наличностите: кой възел/материал колко е на склад и колко липсва за желана бройка">📦 Наличности</button>
      <button class="btn btn-small" id="erp-recipe-dl" title="Сваля цялата рецепта (дървото с възли, материали, операции, количества и цени) като Excel файл">⤓ Свали (Excel)</button>
      <button class="btn btn-small btn-primary" id="erp-rl-add">+ Добави ред</button>
      ${typeof erpRecipeAutoMenu === "function" ? '<button class="btn btn-small" id="erp-rl-auto" title="Копирай от подобен · От чертеж (AI) · Шаблони">🪄 Бързо съставяне</button>' : ""}
      <button class="btn btn-small" id="erp-rl-fix" title="Материали/възли най-отпред, операциите в реда на добавяне">↕ Подреди правилно</button>
      ${readyBadge}
      <span class="spacer"></span>
      <span class="erp-count erp-total-cost">Обща себестойност:
        <strong>${erpManualCostOf(productId) !== null ? erpEur(ERP.costById[productId]) : (p.needs_recipe ? "чака рецепта" : erpEur(ERP.costById[productId]))}</strong>
        ${erpManualCostOf(productId) !== null ? '<span class="erp-tag erp-tag-manual" title="Ръчно зададена цена — не се смята от рецептата">✋ ръчна</span>' : ""}
        <button class="btn btn-small" id="erp-cost-edit" title="Задай реалната себестойност ръчно (за изделия със стари/нереални цени)">✎ Цена</button>
      </span>
    </div>
    <div class="erp-recipe">
      <div class="erp-node erp-node-product">
        <span class="erp-node-main"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}</span>
        <span class="erp-node-tag">${p.is_semifinished ? "полуфабрикат" : "артикул"}</span>
      </div>
      <ul class="erp-tree">${erpRecipeChildren(productId, 0, new Set([productId]))}</ul>
    </div>
    <div class="erp-recipe-add">
      <button class="btn btn-small btn-primary" id="erp-rl-add2">➕ Добави ред към технологията</button>
      ${!prodReady ? '<span class="erp-muted">Добави <b>операции с цех</b> (напр. Лазер→Лазери, Заваряване→Заваръчно), материали и възли. Щом има поне една операция с цех, технологията е готова за производство.</span>' : ""}
    </div>
    <div class="erp-legend">
      <span class="erp-tag erp-tag-semi">полуфабрикат / възел</span>
      <span class="erp-tag erp-tag-mat">материал</span>
      <span class="erp-tag erp-tag-op">операция</span>
    </div>
    <div id="erp-prod-drawings" class="erp-prod-drawings"></div>`;

  document.getElementById("erp-recipe-back").addEventListener("click", () => erpSetTab("products", true));
  const costBtn = document.getElementById("erp-cost-edit");
  if (costBtn) costBtn.addEventListener("click", () => erpEditManualCost(productId));
  document.getElementById("erp-wc-print").addEventListener("click", () =>
    erpPrintWorkCard(productId, document.getElementById("erp-wc-qty").value));
  const testBtn = document.getElementById("erp-recipe-test");
  if (testBtn) testBtn.addEventListener("click", () => {
    if (typeof erpTestRecipe === "function") erpTestRecipe(productId, document.getElementById("erp-wc-qty").value, true);
  });
  const stockBtn = document.getElementById("erp-recipe-stock");
  if (stockBtn) stockBtn.addEventListener("click", () => erpStockTree(productId));
  const dlBtn = document.getElementById("erp-recipe-dl");
  if (dlBtn) dlBtn.addEventListener("click", () => erpRecipeDownload(productId));
  document.getElementById("erp-rl-add").addEventListener("click", () => erpAddRecipeLine(productId));
  const autoBtn = document.getElementById("erp-rl-auto");
  if (autoBtn) autoBtn.addEventListener("click", () => erpRecipeAutoMenu(productId));
  const fixBtn = document.getElementById("erp-rl-fix");
  if (fixBtn) fixBtn.addEventListener("click", () => { if (typeof erpFixRecipeOrder === "function") erpFixRecipeOrder(productId); });
  const add2 = document.getElementById("erp-rl-add2");
  if (add2) add2.addEventListener("click", () => erpAddRecipeLine(productId));
  const lparent = b => Number(b.dataset.parent) || productId;
  v.querySelectorAll(".erp-rl-x").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpRemoveRecipeLine(Number(b.dataset.line), lparent(b)); }));
  v.querySelectorAll(".erp-rl-up").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpMoveRecipeLine(Number(b.dataset.line), lparent(b), -1); }));
  v.querySelectorAll(".erp-rl-down").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpMoveRecipeLine(Number(b.dataset.line), lparent(b), 1); }));
  v.querySelectorAll(".erp-rl-edit").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpEditRecipeLine(Number(b.dataset.line), lparent(b)); }));
  v.querySelectorAll(".erp-rl-repl").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpReplaceRecipeLine(Number(b.dataset.line), lparent(b)); }));
  v.querySelectorAll(".erp-rl-insb").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpInsertRecipeLine(lparent(b), Number(b.dataset.line), "before"); }));
  v.querySelectorAll(".erp-rl-insa").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpInsertRecipeLine(lparent(b), Number(b.dataset.line), "after"); }));
  v.querySelectorAll(".erp-node-draw-btn").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpNodeDrawings(Number(b.dataset.pid)); }));
  v.querySelectorAll(".erp-cost-edit").forEach(b =>
    b.addEventListener("click", e => {
      e.stopPropagation();
      if (b.dataset.ct === "opline") erpEditLineOpCost(Number(b.dataset.cid), Number(b.dataset.op));
      else erpEditComponentCost(b.dataset.ct, Number(b.dataset.cid));
    }));
  erpRenderProductDrawings(productId);
  // Разгъване/свиване на възлите.
  v.querySelectorAll(".erp-toggle").forEach(t =>
    t.addEventListener("click", () => {
      const li = t.closest("li");
      const sub = li.querySelector(":scope > ul");
      if (!sub) return;
      const hidden = sub.hidden = !sub.hidden;
      t.textContent = hidden ? "▸" : "▾";
    }));
}

/* ---------- Сваляне на рецептата (Excel) ----------
   Цялото дърво на изделието като редове с отстъп по нива: възли/детайли,
   материали и операции, с количества за 1 родител и единични цени. Колоната
   „Стойност у 1 краен" е количеството по веригата × ед. цена — за възлите тя
   включва и подредовете им (не се сумира сляпо, за да няма двойно броене). */
function erpRecipeDownload(productId) {
  if (typeof reportExportXls !== "function") { alert("Експортният модул не е зареден. Презареди страницата."); return; }
  const p = ERP.prodById[productId] || {};
  const rows = [];
  (function walk(pid, depth, mult, anc) {
    const ind = "    ".repeat(depth);
    (ERP.linesByProduct[pid] || []).forEach(l => {
      const qty = Number(l.quantity) || 1;
      if (l.material_id) {
        const m = ERP.matById[l.material_id] || {};
        const unitCost = Number(m.avg_cost) || 0;
        rows.push([ind + "материал", m.code || "", m.name || "", erpNum(qty), l.unit || m.unit || "", unitCost.toFixed(4), (unitCost * qty * mult).toFixed(4)]);
      } else if (l.operation_id) {
        const op = ERP.opById[l.operation_id] || {};
        const price = (typeof erpOpLinePrice === "function") ? erpOpLinePrice(l) : (Number(op.unit_cost) || 0);
        rows.push([ind + "операция", op.code || "", (op.name || "") + (op.workshop ? " · " + op.workshop : ""), erpNum(qty), "бр.", Number(price || 0).toFixed(4), (Number(price || 0) * qty * mult).toFixed(4)]);
      } else if (l.child_product_id) {
        const cp = ERP.prodById[l.child_product_id] || {};
        const cost = Number(ERP.costById[l.child_product_id]) || 0;
        rows.push([ind + (cp.is_semifinished ? "възел" : "детайл"), cp.code || "", cp.name || "", erpNum(qty), l.unit || cp.unit || "бр.", cost.toFixed(4), (cost * qty * mult).toFixed(4)]);
        if (!anc.has(l.child_product_id)) walk(l.child_product_id, depth + 1, mult * qty, new Set([...anc, l.child_product_id]));
      }
    });
  })(productId, 0, 1, new Set([productId]));
  const man = (typeof erpManualCostOf === "function") ? erpManualCostOf(productId) : null;
  const total = Number(ERP.costById[productId]) || 0;
  reportExportXls(
    "recepta-" + String(p.code || productId).replace(/[^\w\-]+/g, "_"),
    `Рецепта · ${p.code || ""} ${p.name || ""} — себестойност ${total.toFixed(2)} €${man !== null ? " (ръчна)" : ""}`,
    [{
      headers: [
        { label: "Тип (с нивото)" }, { label: "Код" }, { label: "Име" },
        { label: "К-во за 1 родител", num: true }, { label: "Мярка" },
        { label: "Ед. цена €", num: true }, { label: "Стойност у 1 краен €", num: true },
      ],
      rows,
    }]
  );
}

/* ---------- Ръчна себестойност (✎ Цена) ----------
   За изделия със стари/нереални изчислени цени: задаваш реалната цена ръчно и
   тя важи навсякъде (списъци, маржове, влагане като възел). Махаш я → връща се
   изчислената от рецептата. */
function erpEditManualCost(productId) {
  const p = ERP.prodById[productId] || {};
  const man = erpManualCostOf(productId);
  const computed = erpComputedCost(productId);
  const { wrap, close } = erpDialog(`
    <h3>Себестойност — ръчна корекция</h3>
    <p class="erp-muted" style="margin:-6px 0 10px"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}</p>
    <p>Изчислена от рецептата: <b>${erpEur(computed)}</b>${p.needs_recipe ? ' <span class="erp-warn">(чака рецепта — вероятно непълна)</span>' : ""}</p>
    ${man !== null ? `<p>Сега важи ръчната цена: <b>${erpEur(man)}</b></p>` : ""}
    <label>Реална цена (EUR за 1 бр.)
      <input type="number" id="mcost-val" min="0" step="any" value="${man !== null ? escapeAttr(String(man)) : ""}" placeholder="напр. 12,50" /></label>
    <p class="hint">Ръчната цена <b>замества</b> изчислената навсякъде — в списъка с продукти, в маржовете и когато този детайл се влага като възел в друго изделие. Когато оправиш рецептата и искаш пак да се смята автоматично — махни я оттук.</p>
    <div class="erp-dialog-actions">
      ${man !== null ? '<button class="btn" id="mcost-clear">✖ Махни ръчната (върни изчислената)</button>' : ""}
      <span class="spacer"></span>
      <button class="btn" id="mcost-cancel">Отказ</button>
      <button class="btn btn-primary" id="mcost-save">Запази</button>
    </div>
    <p class="save-status" id="mcost-status"></p>`);
  const status = wrap.querySelector("#mcost-status");
  wrap.querySelector("#mcost-cancel").addEventListener("click", close);
  const done = () => { close(); erpMarkStale && erpMarkStale(); erpRenderRecipe(ERP._recipeTop || productId); };
  wrap.querySelector("#mcost-save").addEventListener("click", async () => {
    const val = erpToNum(wrap.querySelector("#mcost-val").value);
    if (!(val > 0)) { status.textContent = "Въведи цена, по-голяма от 0."; return; }
    status.textContent = "Записва…";
    if (await erpManualCostSave(productId, val)) done();
  });
  const clearBtn = wrap.querySelector("#mcost-clear");
  if (clearBtn) clearBtn.addEventListener("click", async () => {
    status.textContent = "Записва…";
    if (await erpManualCostSave(productId, null)) done();
  });
}

/* Редакция на цена на СЪСТАВНА ЧАСТ от рецептата (бутончето ✎€ на реда):
   материал → сменя цената на материала (за 1 мярка) — важи за ВСИЧКИ рецепти;
   операция → сменя ставката на операцията — важи за всички рецепти с нея;
   възел → ръчна цена на възела (същото като ✎ Цена в неговата рецепта). */
function erpEditComponentCost(type, id) {
  if (type === "node") { erpEditManualCost(id); return; }
  const isMat = type === "mat";
  const x = isMat ? (ERP.matById[id] || {}) : (ERP.opById[id] || {});
  const cur = isMat ? (Number(x.avg_cost) || 0) : (Number(x.unit_cost) || 0);
  const unit = isMat ? (x.unit || "мярка") : "операция";
  const { wrap, close } = erpDialog(`
    <h3>${isMat ? "Цена на материал" : "Ставка на операция"}</h3>
    <p class="erp-muted" style="margin:-6px 0 10px"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml(x.name || "")}</p>
    <p>Сегашна цена: <b>${erpEur(cur)}</b> за 1 ${escapeHtml(unit)}</p>
    <label>Нова цена (EUR за 1 ${escapeHtml(unit)})
      <input type="number" id="cc-val" min="0" step="any" value="${cur ? escapeAttr(String(cur)) : ""}" /></label>
    <p class="hint">⚠ Промяната важи <b>навсякъде</b> — ${isMat ? "във всички рецепти с този материал и като средна цена в склада" : "във всички рецепти с тази операция"}. Себестойностите се преизчисляват веднага.</p>
    <div class="erp-dialog-actions">
      <button class="btn" id="cc-cancel">Отказ</button>
      <button class="btn btn-primary" id="cc-save">Запази</button>
    </div>
    <p class="save-status" id="cc-status"></p>`);
  wrap.querySelector("#cc-cancel").addEventListener("click", close);
  wrap.querySelector("#cc-save").addEventListener("click", async () => {
    const status = wrap.querySelector("#cc-status");
    const val = erpToNum(wrap.querySelector("#cc-val").value);
    if (!(val >= 0)) { status.textContent = "Въведи цена."; return; }
    status.textContent = "Записва…";
    const { error } = isMat
      ? await sb.from("materials").update({ avg_cost: val }).eq("id", id)
      : await sb.from("operations").update({ unit_cost: val }).eq("id", id);
    if (error) { status.textContent = "⚠ " + error.message; return; }
    if (isMat) x.avg_cost = val; else x.unit_cost = val;
    erpRecalcCosts(true);
    erpMarkStale();
    close();
    erpRenderRecipe(ERP._recipeTop || 0);
  });
}

/* Цена на операция САМО за конкретния ред в рецептата (line_costs).
   Общата ставка на операцията НЕ се пипа — една и съща операция (напр.
   Заваряване) може да струва 0,10 € на един детайл и 2 € на друг. */
function erpEditLineOpCost(lineId, opId) {
  const o = ERP.opById[opId] || {};
  const global = Number(o.unit_cost) || 0;
  const cur = erpLineCostOf(lineId);
  const { wrap, close } = erpDialog(`
    <h3>Цена на операцията — само за този ред</h3>
    <p class="erp-muted" style="margin:-6px 0 10px"><b>${escapeHtml(o.code || "")}</b> ${escapeHtml(o.name || "")}</p>
    <p>Обща ставка на операцията: <b>${erpEur(global)}</b> за 1 бр. <span class="erp-muted">(не се променя от тук)</span></p>
    ${cur !== null ? `<p>Сега този ред ползва ръчна цена: <b>${erpEur(cur)}</b> за 1 бр.</p>` : ""}
    <label>Цена за 1 бр. САМО в тази рецепта (EUR)
      <input type="number" id="lc-val" min="0" step="any" value="${cur !== null ? escapeAttr(String(cur)) : ""}" placeholder="напр. 0,35" /></label>
    <p class="hint">Важи само за този ред. Другите рецепти със същата операция си остават на общата ставка. Себестойността се преизчислява веднага.</p>
    <div class="erp-dialog-actions">
      ${cur !== null ? `<button class="btn" id="lc-clear">✖ Махни ръчната (върни ${erpEur(global)})</button>` : ""}
      <span class="spacer"></span>
      <button class="btn" id="lc-cancel">Отказ</button>
      <button class="btn btn-primary" id="lc-save">Запази</button>
    </div>
    <p class="save-status" id="lc-status"></p>`);
  const status = wrap.querySelector("#lc-status");
  wrap.querySelector("#lc-cancel").addEventListener("click", close);
  const done = () => { close(); erpMarkStale(); erpRenderRecipe(ERP._recipeTop || 0); };
  wrap.querySelector("#lc-save").addEventListener("click", async () => {
    const val = erpToNum(wrap.querySelector("#lc-val").value);
    if (!(val >= 0) || wrap.querySelector("#lc-val").value.trim() === "") { status.textContent = "Въведи цена (може и 0)."; return; }
    status.textContent = "Записва…";
    if (await erpLineCostSave(lineId, val)) done();
  });
  const clearBtn = wrap.querySelector("#lc-clear");
  if (clearBtn) clearBtn.addEventListener("click", async () => {
    status.textContent = "Записва…";
    if (await erpLineCostSave(lineId, null)) done();
  });
}

// Маркира другите панели за опресняване (цените се сменят навсякъде).
function erpMarkStale() {
  document.querySelectorAll("#erp-view .erp-pane").forEach(pn => {
    if (pn.dataset.pane !== ERP.tab) pn.dataset.stale = "1";
  });
}

// Връща <li> редовете за съставките на даден продукт.
function erpRecipeChildren(productId, depth, ancestors) {
  const lines = ERP.linesByProduct[productId] || [];
  if (!lines.length) {
    const p = ERP.prodById[productId];
    if (p && p.needs_recipe) return `<li class="erp-leaf erp-warn">— чака рецепта —</li>`;
    return `<li class="erp-leaf erp-muted">— няма съставки —</li>`;
  }
  if (depth > 25) return `<li class="erp-leaf erp-warn">— достигната максимална дълбочина —</li>`;

  return lines.map(l => {
    const qty = Number(l.quantity) || 0;
    const unit = l.unit || "";
    // Контроли на ВСЕКИ ред (на всяко ниво). data-parent = продуктът, чиято рецепта
    // съдържа този ред (за вложените е възелът-родител, не откритото отгоре изделие).
    const rmBtn = `<span class="erp-rl-ctrls">
      <button class="erp-rl-up" data-line="${l.id}" data-parent="${productId}" title="Премести нагоре">↑</button>
      <button class="erp-rl-down" data-line="${l.id}" data-parent="${productId}" title="Премести надолу">↓</button>
      <button class="erp-rl-edit" data-line="${l.id}" data-parent="${productId}" title="Редактирай (количество/цех)">✎</button>
      <button class="erp-rl-repl" data-line="${l.id}" data-parent="${productId}" title="Замени с друг детайл/операция/материал">⇄</button>
      <button class="erp-rl-insb" data-line="${l.id}" data-parent="${productId}" title="Вмъкни нов ред ПРЕДИ този">＋↑</button>
      <button class="erp-rl-insa" data-line="${l.id}" data-parent="${productId}" title="Вмъкни нов ред СЛЕД този">＋↓</button>
      <button class="erp-rl-x" data-line="${l.id}" data-parent="${productId}" title="Премахни от рецептата">×</button>
    </span>`;
    if (l.material_id) {
      const m = ERP.matById[l.material_id] || {};
      const cost = qty * (Number(m.avg_cost) || 0);
      return `<li class="erp-leaf">
        <span class="erp-tw"></span>
        <span class="erp-node erp-node-material">
          <span class="erp-node-main"><span class="erp-tag erp-tag-mat">мат.</span> ${escapeHtml(m.code || "")} ${escapeHtml(m.name || "")}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span><button class="erp-cost-edit" data-ct="mat" data-cid="${l.material_id}" title="Промени цената на материала (важи за всички рецепти и за склада)">✎€</button>${rmBtn}
        </span></li>`;
    }
    if (l.operation_id) {
      const o = ERP.opById[l.operation_id] || {};
      const lc = erpLineCostOf(l.id);                  // ръчна цена САМО за този ред
      const per = lc !== null ? lc : (Number(o.unit_cost) || 0);
      const cost = qty * per;
      return `<li class="erp-leaf">
        <span class="erp-tw"></span>
        <span class="erp-node erp-node-operation">
          <span class="erp-node-main"><span class="erp-tag erp-tag-op">опер.</span> ${escapeHtml(o.code || "")} ${escapeHtml(o.name || "")}${lc !== null ? ` <span class="erp-tag erp-tag-manual" title="Ръчна цена само за този ред: ${erpEur(lc)} за 1 бр. (общата ставка е ${erpEur(o.unit_cost)})">✋ ${erpEur(lc)}/бр.</span>` : ""}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span><button class="erp-cost-edit" data-ct="opline" data-cid="${l.id}" data-op="${l.operation_id}" title="Цена на тази операция САМО в тази рецепта (не пипа общата ставка)">✎€</button>${rmBtn}
        </span></li>`;
    }
    if (l.child_product_id) {
      const c = ERP.prodById[l.child_product_id] || {};
      const unitCost = Number(ERP.costById[l.child_product_id]) || 0;
      const cost = qty * unitCost;
      const cycle = ancestors.has(l.child_product_id);
      const sub = cycle ? "" : erpRecipeChildren(l.child_product_id, depth + 1, new Set([...ancestors, l.child_product_id]));
      const hasKids = !cycle && (ERP.linesByProduct[l.child_product_id] || []).length > 0;
      const drawBtn = `<button class="erp-node-draw-btn" data-pid="${l.child_product_id}" title="Чертежи на този възел">📎 чертеж</button>`;
      return `<li class="erp-branch">
        <span class="erp-tw">${hasKids ? '<button class="erp-toggle">▾</button>' : ""}</span>
        <span class="erp-node erp-node-semi">
          <span class="erp-node-main"><span class="erp-tag erp-tag-semi">възел</span> ${escapeHtml(c.code || "")} ${escapeHtml(c.name || "")}${cycle ? ' <span class="erp-warn">(цикъл)</span>' : ""}${c.needs_recipe ? ' <span class="erp-warn">(чака рецепта)</span>' : ""}${erpManualCostOf(l.child_product_id) !== null ? ' <span class="erp-tag erp-tag-manual" title="Възелът е с ръчно зададена цена">✋ ръчна цена</span>' : ""}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span><button class="erp-cost-edit" data-ct="node" data-cid="${l.child_product_id}" title="Ръчна цена на възела (замества изчислената навсякъде)">✎€</button>${drawBtn}${rmBtn}
        </span>
        ${sub ? `<ul class="erp-tree">${sub}</ul>` : ""}
      </li>`;
    }
    return "";
  }).join("");
}

/* ---------- Чертежи (на крайното изделие или на отделен възел) ---------- */
// Мързеливо зарежда чертежите на продукт/възел (пазят се в products.drawings).
async function erpLoadDrawings(productId) {
  const p = ERP.prodById[productId];
  if (p && p.drawings === undefined) {
    const { data } = await sb.from("products").select("drawings").eq("id", productId).maybeSingle();
    p.drawings = (data && data.drawings) || [];
  }
  return (p && p.drawings) || [];
}

// Рисува управлението на чертежи в подаден контейнер (продукт или възел).
async function erpRenderDrawingsInto(host, productId, opts) {
  opts = opts || {};
  if (!host) return;
  const title = opts.title || "Чертежи на продукта";
  host.innerHTML = `<h4 class="erp-group-head">${escapeHtml(title)}</h4><p class="erp-loading">Зареждане…</p>`;
  const drawings = await erpLoadDrawings(productId);
  const uid = "erp-draw-file-" + productId;
  host.innerHTML = `
    <h4 class="erp-group-head">${escapeHtml(title)}</h4>
    <label class="btn btn-small" for="${uid}">+ Прикачи чертеж</label>
    <input type="file" id="${uid}" multiple hidden />
    <ul class="files-list erp-draw-list">
      ${(drawings || []).map((f, i) => {
        const isImg = (f.type || "").startsWith("image/");
        const prev = isImg ? `<img src="${escapeAttr(f.url)}" alt="${escapeAttr(f.name)}" />` : `<span class="pdf-icon">📄</span>`;
        return `<li>
          <a href="${escapeAttr(f.url)}" target="_blank" download="${escapeAttr(f.name)}">${prev}</a>
          <div class="file-name">${escapeHtml(f.name)}</div>
          <button type="button" class="remove-file" data-i="${i}" title="Премахни">×</button>
        </li>`;
      }).join("") || `<li class="erp-muted">Няма прикачени чертежи.</li>`}
    </ul>`;

  const refresh = () => erpRenderDrawingsInto(host, productId, opts);
  const input = host.querySelector("#" + uid);
  if (input) input.addEventListener("change", e => { erpAttachProductDrawing(productId, [...e.target.files], refresh); e.target.value = ""; });
  host.querySelectorAll(".remove-file").forEach(b =>
    b.addEventListener("click", () => erpRemoveProductDrawing(productId, Number(b.dataset.i), refresh)));
}

// Чертежите на крайното изделие (секцията под дървото).
function erpRenderProductDrawings(productId) {
  return erpRenderDrawingsInto(document.getElementById("erp-prod-drawings"), productId, { title: "Чертежи на крайното изделие" });
}

// Диалог за чертежите на отделен възел от рецептата.
async function erpNodeDrawings(productId) {
  const c = ERP.prodById[productId] || {};
  const { wrap, close } = erpDialog(`
    <h3>Чертежи на възел</h3>
    <p class="erp-muted" style="margin:-6px 0 10px"><b>${escapeHtml(c.code || "")}</b> ${escapeHtml(c.name || "")}</p>
    <div id="erp-node-draw"></div>
    <div class="erp-dialog-actions"><button class="btn btn-primary" id="nd-close">Готово</button></div>`);
  wrap.querySelector("#nd-close").addEventListener("click", close);
  await erpRenderDrawingsInto(wrap.querySelector("#erp-node-draw"), productId, { title: "Чертежи на възела" });
}

async function erpAttachProductDrawing(productId, files, refresh) {
  const p = ERP.prodById[productId]; if (!p) return;
  p.drawings = p.drawings || [];
  for (const file of files) {
    const path = `products/${productId}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    p.drawings.push({ name: file.name, type: file.type, path, url: data.publicUrl });
  }
  const { error } = await sb.from("products").update({ drawings: p.drawings }).eq("id", productId);
  if (error) alert("Грешка при запис на чертежите: " + error.message +
    "\n\nАко пише за липсваща колона drawings — пусни обновения erp-setup.sql в Supabase.");
  (refresh || (() => erpRenderProductDrawings(productId)))();
}

async function erpRemoveProductDrawing(productId, i, refresh) {
  const p = ERP.prodById[productId]; if (!p || !p.drawings) return;
  const f = p.drawings[i];
  if (f && f.path) await sb.storage.from(BUCKET).remove([f.path]);
  p.drawings.splice(i, 1);
  const { error } = await sb.from("products").update({ drawings: p.drawings }).eq("id", productId);
  if (error) alert("Грешка при запис: " + error.message);
  (refresh || (() => erpRenderProductDrawings(productId)))();
}

/* ---------- „Наличности по структурата" (📦 в рецептата) ----------
   Дървото на изделието с наличности: възли (Склад детайли) и материали
   (Склад материали). Въвеждаш желана бройка N → за всеки ред: нужно,
   налично, ЛИПСВА — с нетване: наличен възел покрива нуждата и НЕ иска
   частите си за покритото количество (както при пускане в производство). */
function erpStockTreeData(pid, mult, depth, ancestors) {
  const rows = [];
  (ERP.linesByProduct[pid] || []).forEach(l => {
    const q = Number(l.quantity) || 0;
    if (l.operation_id || !q) return;
    if (l.material_id) {
      const m = ERP.matById[l.material_id] || {};
      const need = q * mult;
      const have = Number(m.stock) || 0;
      rows.push({ depth, kind: "mat", mid: l.material_id, code: m.code || "", name: m.name || "", unit: m.unit || "", have, need, miss: Math.max(0, need - have) });
      return;
    }
    if (l.child_product_id) {
      const c = ERP.prodById[l.child_product_id] || {};
      const have = Number(c.stock) || 0;
      const need = q * mult;
      const net = Math.max(0, need - have);
      const cycle = ancestors.has(l.child_product_id);
      rows.push({ depth, kind: "node", pid: l.child_product_id, code: c.code || "", name: c.name || "", unit: "бр.", have, need, miss: net, cycle, covered: need > 0 && net === 0 });
      if (!cycle && depth < 25)
        rows.push(...erpStockTreeData(l.child_product_id, net, depth + 1, new Set([...ancestors, l.child_product_id])));
    }
  });
  return rows;
}

/* Бърза корекция на наличност направо от дървото: задаваш НОВАТА наличност,
   Системата записва корекция с разликата (материал → stock_movements,
   възел/детайл → product_movements) и обновява екрана. */
function erpStockQuickFix(kind, id, after) {
  const isMat = kind === "mat";
  const x = isMat ? (ERP.matById[id] || {}) : (ERP.prodById[id] || {});
  const cur = Number(x.stock) || 0;
  const unit = isMat ? (x.unit || "") : "бр.";
  const { wrap, close } = erpDialog(`
    <h3>± Поправи наличността</h3>
    <p><b>${escapeHtml(x.code || "")}</b> ${escapeHtml(x.name || "")} — сега: <b>${erpNum(cur)} ${escapeHtml(unit)}</b> <span class="erp-muted">(${isMat ? "Склад материали" : "Склад детайли"})</span></p>
    <label>Нова наличност (${escapeHtml(unit)})
      <input type="number" id="qf-val" step="any" value="${escapeAttr(String(cur))}" autofocus /></label>
    <label>Бележка (по избор)<input type="text" id="qf-note" placeholder="напр. преброено на рафта" /></label>
    <p class="hint">Записва се <b>корекция</b> с разликата — историята на движенията се пази.</p>
    <div class="erp-dialog-actions">
      <button class="btn" id="qf-cancel">Отказ</button>
      <button class="btn btn-primary" id="qf-save">Запиши</button>
    </div>
    <p class="save-status" id="qf-status"></p>`);
  wrap.querySelector("#qf-cancel").addEventListener("click", close);
  wrap.querySelector("#qf-save").addEventListener("click", async () => {
    const status = wrap.querySelector("#qf-status");
    const val = erpToNum(wrap.querySelector("#qf-val").value);
    const note = (wrap.querySelector("#qf-note").value || "").trim() || "Корекция (Наличности по структурата)";
    const delta = val - cur;
    if (!delta) { close(); return; }
    status.textContent = "Записва…";
    const who = (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || null;
    const { error } = isMat
      ? await sb.from("stock_movements").insert({ material_id: id, kind: "корекция", quantity: delta, note, created_by: who })
      : await sb.from("product_movements").insert({ product_id: id, kind: "корекция", quantity: delta, note });
    if (error) { status.textContent = "⚠ " + error.message; return; }
    x.stock = val;
    if (!isMat && ERP.prodStock) ERP.prodStock[id] = val;
    if (typeof erpMarkStale === "function") erpMarkStale();   // другите табове да се опреснят
    close();
    if (after) after();
  });
}

async function erpStockTree(productId) {
  const p = ERP.prodById[productId]; if (!p) return;
  let qty = 1;
  const { wrap, close } = erpDialog(`
    <h3>📦 Наличности по структурата</h3>
    <p class="erp-muted" style="margin:-6px 0 8px"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} · готови на склад: <b id="st-topstock">${erpNum(Number(p.stock) || 0)} бр.</b> <button class="erp-cost-edit" id="st-topfix" title="Поправи наличността на готовото изделие">±</button></p>
    <div class="erp-toolbar" style="margin-bottom:8px">
      <label class="erp-inline">Искам да сглобя <input type="number" id="st-qty" min="1" step="1" value="1" style="width:80px" /> бр.</label>
      <span id="st-buildable" class="erp-count"></span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="st-refresh" title="Презарежда наличностите от склада">↻ Обнови наличностите</button>
    </div>
    <p class="hint">За всеки ред: <b>Нужно</b> за въведената бройка, <b>Налично</b> в склада и <b>Липсва</b>. Наличен възел <b>покрива</b> нуждата надолу — частите му се искат само за непокритото количество (редовете „покрито" са сиви). Материалът се гледа в Склад материали, възлите/детайлите — в Склад детайли.</p>
    <div id="st-table" class="erp-scroll"></div>
    <div class="erp-dialog-actions"><button class="btn btn-primary" id="st-close">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-full");
  wrap.querySelector("#st-close").addEventListener("click", close);

  const render = () => {
    const rows = erpStockTreeData(productId, qty, 0, new Set([productId]));
    // До колко броя стигат наличните съставки (двоично търсене по липсите).
    const anyMiss = n => erpStockTreeData(productId, n, 0, new Set([productId])).some(r => r.miss > 0);
    let buildTxt;
    if (anyMiss(1)) buildTxt = "0";
    else {
      let lo = 1, hi = 2;
      while (hi <= 500000 && !anyMiss(hi)) { lo = hi; hi *= 2; }
      if (hi > 500000) buildTxt = "500000+";
      else { while (lo < hi - 1) { const mid = Math.floor((lo + hi) / 2); if (anyMiss(mid)) hi = mid; else lo = mid; } buildTxt = String(lo); }
    }
    wrap.querySelector("#st-buildable").innerHTML = `От наличните съставки можеш да сглобиш до <b>${buildTxt} бр.</b>${(Number(p.stock) || 0) > 0 ? ` (+ ${erpNum(p.stock)} готови на склад)` : ""}`;
    wrap.querySelector("#st-table").innerHTML = `
      <table class="report-table erp-table">
        <thead><tr><th>Съставка</th><th>Код</th><th class="num">Нужно</th><th class="num">Налично</th><th class="num">Липсва</th></tr></thead>
        <tbody>${rows.map(r => {
          const grey = r.need === 0;
          const missCell = grey ? '<span class="erp-muted">— покрито</span>'
            : r.miss > 0 ? `<span class="erp-warn">${erpNum(r.miss)} ${escapeHtml(r.unit)} ⚠</span>`
            : '<span style="color:#15803d;font-weight:700">✓ стига</span>';
          return `<tr${grey ? ' style="opacity:.55"' : ""}>
            <td style="padding-left:${10 + r.depth * 22}px">${r.kind === "node" ? '<span class="erp-tag erp-tag-semi">възел</span>' : '<span class="erp-tag erp-tag-mat">мат.</span>'} ${escapeHtml(r.name)}${r.cycle ? ' <span class="erp-warn">(цикъл)</span>' : ""}</td>
            <td><b>${escapeHtml(r.code)}</b></td>
            <td class="num">${grey ? '<span class="erp-muted">0</span>' : erpNum(r.need) + " " + escapeHtml(r.unit)}</td>
            <td class="num">${erpNum(r.have)} ${escapeHtml(r.unit)} <button class="erp-cost-edit" data-fix="${r.kind}¦${r.kind === "mat" ? r.mid : r.pid}" title="Поправи наличността (корекция)">±</button></td>
            <td class="num">${missCell}</td>
          </tr>`;
        }).join("") || '<tr><td colspan="5" class="report-empty">Рецептата няма съставки.</td></tr>'}</tbody>
      </table>`;
    // ± корекция на наличност по ред (материал или възел/детайл).
    wrap.querySelectorAll("[data-fix]").forEach(b => b.addEventListener("click", () => {
      const [kind, id] = String(b.dataset.fix).split("¦");
      erpStockQuickFix(kind, Number(id), render);
    }));
  };
  render();
  const topFix = wrap.querySelector("#st-topfix");
  if (topFix) topFix.addEventListener("click", () => erpStockQuickFix("node", productId, () => {
    const el = wrap.querySelector("#st-topstock");
    if (el) el.textContent = erpNum(Number(p.stock) || 0) + " бр.";
    render();
  }));
  wrap.querySelector("#st-qty").addEventListener("input", e => { qty = Math.max(1, Math.floor(erpToNum(e.target.value) || 1)); render(); });
  wrap.querySelector("#st-refresh").addEventListener("click", async () => {
    wrap.querySelector("#st-table").innerHTML = '<p class="erp-loading">Презареждам наличностите…</p>';
    try { await erpLoadAll(); } catch (e) {}
    render();
  });
}
