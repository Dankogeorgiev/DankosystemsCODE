/* Данко Системс — ЕРП екран „Рецепта" (многостепенно дърво).
   Разгъва продукт → съставки; полуфабрикатите се разгъват надолу по нивата.
   До всеки ред: количество, мярка, себестойност. Цветово по вид. */

function erpRenderRecipe(productId) {
  const p = ERP.prodById[productId];
  const v = erpView();
  if (!p) { v.innerHTML = `<p class="report-empty">Продуктът не е намерен.</p>`; return; }

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="erp-recipe-back">← Назад към продуктите</button>
      <span class="spacer"></span>
      <span class="erp-count">Обща себестойност: <strong>${p.needs_recipe ? "чака рецепта" : erpEur(ERP.costById[productId])}</strong></span>
    </div>
    <div class="erp-recipe">
      <div class="erp-node erp-node-product">
        <span class="erp-node-main"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}</span>
        <span class="erp-node-tag">${p.is_semifinished ? "полуфабрикат" : "артикул"}</span>
      </div>
      <ul class="erp-tree">${erpRecipeChildren(productId, 0, new Set([productId]))}</ul>
    </div>
    <div class="erp-legend">
      <span class="erp-tag erp-tag-semi">полуфабрикат / възел</span>
      <span class="erp-tag erp-tag-mat">материал</span>
      <span class="erp-tag erp-tag-op">операция</span>
    </div>`;

  document.getElementById("erp-recipe-back").addEventListener("click", () => erpSetTab("products"));
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
    if (l.material_id) {
      const m = ERP.matById[l.material_id] || {};
      const cost = qty * (Number(m.avg_cost) || 0);
      return `<li class="erp-leaf">
        <span class="erp-tw"></span>
        <span class="erp-node erp-node-material">
          <span class="erp-node-main"><span class="erp-tag erp-tag-mat">мат.</span> ${escapeHtml(m.code || "")} ${escapeHtml(m.name || "")}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span>
        </span></li>`;
    }
    if (l.operation_id) {
      const o = ERP.opById[l.operation_id] || {};
      const cost = qty * (Number(o.unit_cost) || 0);
      return `<li class="erp-leaf">
        <span class="erp-tw"></span>
        <span class="erp-node erp-node-operation">
          <span class="erp-node-main"><span class="erp-tag erp-tag-op">опер.</span> ${escapeHtml(o.code || "")} ${escapeHtml(o.name || "")}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span>
        </span></li>`;
    }
    if (l.child_product_id) {
      const c = ERP.prodById[l.child_product_id] || {};
      const unitCost = Number(ERP.costById[l.child_product_id]) || 0;
      const cost = qty * unitCost;
      const cycle = ancestors.has(l.child_product_id);
      const sub = cycle ? "" : erpRecipeChildren(l.child_product_id, depth + 1, new Set([...ancestors, l.child_product_id]));
      const hasKids = !cycle && (ERP.linesByProduct[l.child_product_id] || []).length > 0;
      return `<li class="erp-branch">
        <span class="erp-tw">${hasKids ? '<button class="erp-toggle">▾</button>' : ""}</span>
        <span class="erp-node erp-node-semi">
          <span class="erp-node-main"><span class="erp-tag erp-tag-semi">възел</span> ${escapeHtml(c.code || "")} ${escapeHtml(c.name || "")}${cycle ? ' <span class="erp-warn">(цикъл)</span>' : ""}${c.needs_recipe ? ' <span class="erp-warn">(чака рецепта)</span>' : ""}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span>
        </span>
        ${sub ? `<ul class="erp-tree">${sub}</ul>` : ""}
      </li>`;
    }
    return "";
  }).join("");
}
