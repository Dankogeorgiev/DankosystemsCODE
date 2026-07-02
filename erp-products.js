/* Данко Системс — ЕРП екрани „Продукти" (себестойност) и „Чака рецепта".
   Таблица от v_product_cost; клик върху продукт → рецепта-дърво (erp-recipes.js). */

let erpProdSearch = "";
let erpProdFilter = "all"; // all | article | semi

function erpRenderProducts() {
  const v = erpView();
  const q = erpProdSearch.trim().toLowerCase();
  let rows = ERP.products.slice();
  if (erpProdFilter === "article") rows = rows.filter(p => !p.is_semifinished);
  if (erpProdFilter === "semi") rows = rows.filter(p => p.is_semifinished);
  if (q) rows = rows.filter(p =>
    (p.code || "").toLowerCase().includes(q) ||
    (p.name || "").toLowerCase().includes(q) ||
    (p.group_name || "").toLowerCase().includes(q));
  rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));

  v.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="erp-prod-search" placeholder="Търси код, име, група…" value="${escapeAttr(erpProdSearch)}" />
      <select id="erp-prod-filter">
        <option value="all" ${erpProdFilter === "all" ? "selected" : ""}>Всички</option>
        <option value="article" ${erpProdFilter === "article" ? "selected" : ""}>Само артикули</option>
        <option value="semi" ${erpProdFilter === "semi" ? "selected" : ""}>Само полуфабрикати</option>
      </select>
      <span class="spacer"></span>
      <span class="erp-count">${rows.length} продукта</span>
    </div>
    <table class="report-table erp-table">
      <thead>
        <tr><th>Код</th><th>Име</th><th>Тип</th><th>Група</th><th class="num">Себестойност</th><th></th></tr>
      </thead>
      <tbody>
        ${rows.map(p => `
          <tr class="erp-clickable ${p.needs_recipe ? "erp-needs" : ""}" data-prod="${p.id}">
            <td data-label="Код">${escapeHtml(p.code || "—")}</td>
            <td data-label="Име">${escapeHtml(p.name || "")}</td>
            <td data-label="Тип">${p.is_semifinished ? '<span class="erp-tag erp-tag-semi">полуфабрикат</span>' : '<span class="erp-tag erp-tag-art">артикул</span>'}</td>
            <td data-label="Група">${escapeHtml(p.group_name || "")}</td>
            <td class="num" data-label="Себестойност">${p.needs_recipe ? '<span class="erp-warn">чака рецепта</span>' : erpEur(p.cost_eur)}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${p.id}">Рецепта →</button></td>
          </tr>`).join("") ||
          `<tr><td colspan="6" class="report-empty">Няма продукти. Импортирай рецепти от таба „Импорт".</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("erp-prod-search").addEventListener("input", e => {
    erpProdSearch = e.target.value; erpRenderProducts();
    const el = document.getElementById("erp-prod-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
  document.getElementById("erp-prod-filter").addEventListener("change", e => {
    erpProdFilter = e.target.value; erpRenderProducts();
  });
  v.querySelectorAll("[data-open]").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpRenderRecipe(Number(b.dataset.open)); }));
  v.querySelectorAll("tr[data-prod]").forEach(tr =>
    tr.addEventListener("click", () => erpRenderRecipe(Number(tr.dataset.prod))));
}

/* ---------- „Чака рецепта" ---------- */
function erpRenderNeeds() {
  const v = erpView();
  const rows = ERP.products.filter(p => p.needs_recipe)
    .sort((a, b) => (a.group_name || "").localeCompare(b.group_name || "", "bg") || (a.name || "").localeCompare(b.name || "", "bg"));

  // Групиране по група за по-лесен чеклист.
  const byGroup = {};
  rows.forEach(p => { (byGroup[p.group_name || "—"] = byGroup[p.group_name || "—"] || []).push(p); });

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} заготовки чакат рецепта</span>
    </div>
    ${rows.length ? Object.entries(byGroup).map(([g, list]) => `
      <h4 class="erp-group-head">${escapeHtml(g)} <span class="erp-muted">(${list.length})</span></h4>
      <table class="report-table erp-table">
        <thead><tr><th>Код</th><th>Име</th><th></th></tr></thead>
        <tbody>${list.map(p => `
          <tr class="erp-clickable" data-prod="${p.id}">
            <td data-label="Код">${escapeHtml(p.code || "—")}</td>
            <td data-label="Име">${escapeHtml(p.name || "")}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${p.id}">Отвори →</button></td>
          </tr>`).join("")}</tbody>
      </table>`).join("")
    : `<p class="report-empty">Няма заготовки, които чакат рецепта. 🎉</p>`}`;

  v.querySelectorAll("[data-open]").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpRenderRecipe(Number(b.dataset.open)); }));
  v.querySelectorAll("tr[data-prod]").forEach(tr =>
    tr.addEventListener("click", () => erpRenderRecipe(Number(tr.dataset.prod))));
}
