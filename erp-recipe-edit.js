/* Данко Системс — ЕРП: създаване на продукт и ръчно редактиране на рецептата.
   Ползва ERP/erpDialog/erpLoadAll/erpRenderRecipe/erpToNum от другите erp-*.js. */

// Презарежда данните и отваря рецептата на продукта (след промяна).
async function erpReloadRecipe(productId) {
  await erpLoadAll();
  erpRenderRecipe(productId);
}

/* ---------- + Нов продукт ---------- */
function erpNewProduct() {
  const { wrap, close } = erpDialog(`
    <h3>Нов продукт</h3>
    <label>Код<input type="text" id="np-code" placeholder="напр. 200001" /></label>
    <label>Име<input type="text" id="np-name" placeholder="Наименование" /></label>
    <label>Тип
      <select id="np-type">
        <option value="art">Артикул (готово изделие)</option>
        <option value="semi">Полуфабрикат / възел / детайл</option>
      </select>
    </label>
    <label>Група<input type="text" id="np-group" placeholder="напр. Артикули / Възли / Детайли" /></label>
    <label>Мярка<input type="text" id="np-unit" value="бр." /></label>
    <div class="erp-dialog-actions">
      <button class="btn" id="np-cancel">Отказ</button>
      <button class="btn btn-primary" id="np-save">Създай</button>
    </div>
    <p class="save-status" id="np-status"></p>`);
  wrap.querySelector("#np-cancel").addEventListener("click", close);
  wrap.querySelector("#np-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#np-name").value.trim();
    if (!name) { wrap.querySelector("#np-status").textContent = "Въведи име."; return; }
    const payload = {
      code: wrap.querySelector("#np-code").value.trim() || null,
      name,
      is_semifinished: wrap.querySelector("#np-type").value === "semi",
      group_name: wrap.querySelector("#np-group").value.trim() || null,
      unit: wrap.querySelector("#np-unit").value.trim() || "бр.",
      needs_recipe: false,
    };
    wrap.querySelector("#np-status").textContent = "Създава…";
    const { data, error } = await sb.from("products").insert(payload).select("id").single();
    if (error) {
      wrap.querySelector("#np-status").textContent = /duplicate|unique/i.test(error.message)
        ? "⚠ Вече има продукт с този код." : "⚠ " + error.message;
      return;
    }
    close();
    await erpLoadAll();
    erpRenderRecipe(data.id); // отваряме новия продукт, за да му съставим рецептата
  });
}

/* ---------- + Ред към рецептата ---------- */
function erpAddRecipeLine(productId) {
  const p = ERP.prodById[productId];
  const mats = ERP.materials.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  const ops = ERP.operations.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  const prods = ERP.products.filter(x => x.id !== productId).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));

  const opt = (id, label) => `<option value="${id}">${escapeHtml(label)}</option>`;
  const matOpts = mats.map(m => opt(m.id, (m.code ? m.code + " · " : "") + m.name)).join("");
  const opOpts = ops.map(o => opt(o.id, (o.code ? o.code + " · " : "") + o.name)).join("");
  const prodOpts = prods.map(x => opt(x.id, (x.code ? x.code + " · " : "") + x.name)).join("");

  const { wrap, close } = erpDialog(`
    <h3>Добави ред към рецептата</h3>
    <p class="hint">За: <b>${escapeHtml(p ? (p.code || "") + " " + p.name : "")}</b></p>
    <label>Тип съставка
      <select id="rl-type">
        <option value="material">Материал / стока</option>
        <option value="operation">Операция (услуга)</option>
        <option value="child">Полуфабрикат / възел</option>
      </select>
    </label>
    <label>Избери
      <input type="search" id="rl-search" placeholder="търси…" />
      <select id="rl-item" size="1"></select>
    </label>
    <label>Количество<input type="number" id="rl-qty" min="0" step="any" value="1" /></label>
    <label>Мярка<input type="text" id="rl-unit" /></label>
    <div class="erp-dialog-actions">
      <button class="btn" id="rl-cancel">Отказ</button>
      <button class="btn btn-primary" id="rl-save">Добави</button>
    </div>
    <p class="save-status" id="rl-status"></p>`);

  const typeSel = wrap.querySelector("#rl-type");
  const itemSel = wrap.querySelector("#rl-item");
  const searchEl = wrap.querySelector("#rl-search");
  const unitEl = wrap.querySelector("#rl-unit");

  const dataFor = () => typeSel.value === "material" ? mats : typeSel.value === "operation" ? ops : prods;
  const optsFor = () => typeSel.value === "material" ? matOpts : typeSel.value === "operation" ? opOpts : prodOpts;

  function fillItems(filter) {
    const f = (filter || "").toLowerCase().trim();
    if (!f) { itemSel.innerHTML = optsFor(); }
    else {
      const list = dataFor().filter(x => ((x.code || "") + " " + (x.name || "")).toLowerCase().includes(f));
      itemSel.innerHTML = list.map(x => opt(x.id, (x.code ? x.code + " · " : "") + x.name)).join("");
    }
    syncUnit();
  }
  function syncUnit() {
    const id = Number(itemSel.value);
    if (typeSel.value === "material") { const m = ERP.matById[id]; unitEl.value = (m && m.unit) || ""; }
    else if (typeSel.value === "operation") { unitEl.value = "бр."; }
    else { const x = ERP.prodById[id]; unitEl.value = (x && x.unit) || "бр."; }
  }
  typeSel.addEventListener("change", () => { searchEl.value = ""; fillItems(""); });
  searchEl.addEventListener("input", () => fillItems(searchEl.value));
  itemSel.addEventListener("change", syncUnit);
  fillItems("");

  wrap.querySelector("#rl-cancel").addEventListener("click", close);
  wrap.querySelector("#rl-save").addEventListener("click", async () => {
    const id = Number(itemSel.value);
    if (!id) { wrap.querySelector("#rl-status").textContent = "Избери съставка."; return; }
    const qty = erpToNum(wrap.querySelector("#rl-qty").value) || 1;
    const row = { product_id: productId, quantity: qty, unit: wrap.querySelector("#rl-unit").value.trim() || null };
    if (typeSel.value === "material") row.material_id = id;
    else if (typeSel.value === "operation") row.operation_id = id;
    else {
      if (id === productId) { wrap.querySelector("#rl-status").textContent = "Продукт не може да съдържа себе си."; return; }
      row.child_product_id = id;
    }
    wrap.querySelector("#rl-status").textContent = "Добавя…";
    const { error } = await sb.from("recipe_lines").insert(row);
    if (error) { wrap.querySelector("#rl-status").textContent = "⚠ " + error.message; return; }
    close();
    await erpReloadRecipe(productId);
  });
}

/* ---------- Премахване на ред от рецептата ---------- */
async function erpRemoveRecipeLine(lineId, productId) {
  if (!confirm("Да премахна ли този ред от рецептата?")) return;
  const { error } = await sb.from("recipe_lines").delete().eq("id", lineId);
  if (error) { alert("Грешка: " + error.message); return; }
  await erpReloadRecipe(productId);
}
