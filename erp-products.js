/* Данко Системс — ЕРП екрани „Продукти" (себестойност) и „Чака рецепта".
   Таблица от v_product_cost; клик върху продукт → рецепта-дърво (erp-recipes.js). */

let erpProdSearch = "";
let erpProdFilter = "all"; // all | top | article | semi

// „Краен продукт" (кодът, който реално вкарваме във фактурата) = продукт, който
// НЕ се влага като детайл/възел в ничия друга рецепта — т.е. коренът на сглобката.
// Това е структурният, надежден сигнал (за разлика от is_semifinished, който е
// импортна догадка). ERP.childIds се сглобява веднъж в erpLoadAll.
function erpIsTopProduct(p) {
  return !!(p && !(ERP.childIds && ERP.childIds.has(Number(p.id))));
}

function erpRenderProducts() {
  const v = erpView();
  const q = erpProdSearch.trim().toLowerCase();
  let rows = ERP.products.slice();
  if (erpProdFilter === "top") rows = rows.filter(erpIsTopProduct);
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
        <option value="top" ${erpProdFilter === "top" ? "selected" : ""}>🧾 Само крайни (за фактура)</option>
        <option value="article" ${erpProdFilter === "article" ? "selected" : ""}>Само артикули</option>
        <option value="semi" ${erpProdFilter === "semi" ? "selected" : ""}>Само полуфабрикати</option>
      </select>
      <span class="spacer"></span>
      <span class="erp-count">${rows.length} продукта</span>
      <button class="btn btn-primary" id="erp-prod-add">🛠 Създай технология</button>
    </div>
    <p class="erp-prod-legend"><span class="erp-legend-top">🧾 Оцветените са крайни продукти</span> — кодът, който реално вкарваме във фактурата (главното от сглобката). Неоцветените се влагат като детайл/възел в друга рецепта.</p>
    <table class="report-table erp-table">
      <thead>
        <tr><th>Код</th><th>Име</th><th>Тип</th><th>Група</th><th class="num cost-cell">Себестойност</th><th></th></tr>
      </thead>
      <tbody>
        ${rows.map(p => `
          <tr class="erp-clickable ${erpIsTopProduct(p) ? "erp-top-product" : ""} ${p.needs_recipe ? "erp-needs" : ""}" data-prod="${p.id}">
            <td data-label="Код">${erpIsTopProduct(p) ? '<span class="erp-top-flag" title="Краен продукт — този код влиза във фактурата">🧾</span> ' : ''}${escapeHtml(p.code || "—")}</td>
            <td data-label="Име">${escapeHtml(p.name || "")}</td>
            <td data-label="Тип">${p.is_semifinished ? '<span class="erp-tag erp-tag-semi">полуфабрикат</span>' : '<span class="erp-tag erp-tag-art">артикул</span>'}</td>
            <td data-label="Група">${escapeHtml(p.group_name || "")}</td>
            <td class="num cost-cell" data-label="Себестойност">${p.needs_recipe ? '<span class="erp-warn">чака рецепта</span>' : erpEur(p.cost_eur)}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-editp="${p.id}" title="Редактирай име/група/тип">✎</button><button class="btn btn-small" data-open="${p.id}">Рецепта →</button></td>
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
  document.getElementById("erp-prod-add").addEventListener("click", erpNewProduct);
  v.querySelectorAll("[data-editp]").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpEditProduct(Number(b.dataset.editp)); }));
  v.querySelectorAll("[data-open]").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpRenderRecipe(Number(b.dataset.open)); }));
  v.querySelectorAll("tr[data-prod]").forEach(tr =>
    tr.addEventListener("click", () => erpRenderRecipe(Number(tr.dataset.prod))));
}

// Редакция на продукт/детайл/възел: име, група, мярка, тип (кодът не се променя,
// за да не се къса връзката с рецептите/задачите).
function erpEditProduct(id) {
  const p = ERP.prodById[id];
  if (!p) return;
  const { wrap, close } = erpDialog(`
    <h3>Редакция на продукт <span class="erp-muted">${escapeHtml(p.code || "")}</span></h3>
    <label>Име<input type="text" id="ep-name" value="${escapeAttr(p.name || "")}" /></label>
    <label>Група<input type="text" id="ep-group" value="${escapeAttr(p.group_name || "")}" /></label>
    <label>Мярка<input type="text" id="ep-unit" value="${escapeAttr(p.unit || "бр.")}" /></label>
    <label>Тип
      <select id="ep-type">
        <option value="art" ${!p.is_semifinished ? "selected" : ""}>Артикул (готово изделие)</option>
        <option value="semi" ${p.is_semifinished ? "selected" : ""}>Полуфабрикат / възел / детайл</option>
      </select></label>
    <div class="erp-dialog-actions"><button class="btn" id="ep-cancel">Отказ</button><button class="btn btn-primary" id="ep-save">Запази</button></div>
    <p class="save-status" id="ep-status"></p>`);
  wrap.querySelector("#ep-cancel").addEventListener("click", close);
  wrap.querySelector("#ep-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#ep-name").value.trim();
    const status = wrap.querySelector("#ep-status");
    if (!name) { status.textContent = "Въведи име."; return; }
    const payload = {
      name,
      group_name: wrap.querySelector("#ep-group").value.trim() || null,
      unit: wrap.querySelector("#ep-unit").value.trim() || "бр.",
      is_semifinished: wrap.querySelector("#ep-type").value === "semi",
    };
    status.textContent = "Записва…";
    const { error } = await sb.from("products").update(payload).eq("id", id);
    if (error) { status.textContent = "⚠ " + error.message; return; }
    close();
    await erpReload();
  });
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
