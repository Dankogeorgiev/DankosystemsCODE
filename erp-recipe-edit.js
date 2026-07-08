/* Данко Системс — ЕРП: създаване на продукт и ръчно редактиране на рецептата.
   Ползва ERP/erpDialog/erpLoadAll/erpRenderRecipe/erpToNum от другите erp-*.js. */

// Презарежда данните и отваря рецептата на продукта (след промяна).
async function erpReloadRecipe(productId) {
  await erpLoadAll();
  erpRenderRecipe(productId);
}

/* ---------- 🛠 Създай технология (нов продукт + рецепта) ---------- */
function erpNewProduct() {
  const { wrap, close } = erpDialog(`
    <h3>🛠 Създай технология</h3>
    <p class="hint">Създай нов продукт, после му състави технологията (операции с цех, материали и възли).
      Щом сложиш операции с цех, технологията работи като всички останали — може да се пуска в производство.</p>
    <label>Код <span class="erp-muted">(предложен пореден)</span><input type="text" id="np-code" value="${escapeAttr(erpNextCode())}" placeholder="код" /></label>
    <label>Име<input type="text" id="np-name" placeholder="Наименование на изделието/детайла" /></label>
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
      <button class="btn btn-primary" id="np-save">Създай и състави технологията →</button>
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

// Записва цеха на една операция в маршрутизацията (app_config), за да отива
// задачата в правилния цех при „Пусни в производство" (както при импортираните).
async function erpSaveOpRoute(code, primary) {
  if (!code) return null;
  const byCode = Object.assign({}, ERP.opRoutingSaved || {});
  byCode[code] = { primary: primary || "", alt: (byCode[code] && byCode[code].alt) || [] };
  const { error } = await sb.from("app_config").upsert({ id: "erp_op_routing", data: { byCode }, updated_at: new Date().toISOString() });
  if (!error) ERP.opRoutingSaved = byCode;
  return error;
}

/* ---------- + Ред към рецептата ---------- */
function erpAddRecipeLine(productId) {
  const p = ERP.prodById[productId];
  const mats = ERP.materials.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  const ops = ERP.operations.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  const prods = ERP.products.filter(x => x.id !== productId).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  const workshops = (typeof erpWorkshops === "function") ? erpWorkshops() : ["Лазери", "CNC цех", "Преси", "Абкант", "Заваръчно", "Занитване", "Бояджийно", "Заготовки", "Сглобяване", "Опаковане/Експедиция", "Външна услуга"];

  const opt = (id, label) => `<option value="${id}">${escapeHtml(label)}</option>`;
  const matOpts = mats.map(m => opt(m.id, (m.code ? m.code + " · " : "") + m.name)).join("");
  const opOpts = ops.map(o => opt(o.id, (o.code ? o.code + " · " : "") + o.name)).join("");
  const prodOpts = prods.map(x => opt(x.id, (x.code ? x.code + " · " : "") + x.name)).join("");

  const { wrap, close } = erpDialog(`
    <h3>Добави ред към технологията</h3>
    <p class="hint">За: <b>${escapeHtml(p ? (p.code || "") + " " + p.name : "")}</b></p>
    <p class="hint">📋 Не се тревожи за реда — системата слага <b>материалите/възлите най-отпред</b>, а <b>операциите — в реда, в който ги добавяш</b>. Затова добавяй операциите в производствената последователност (напр. Лазер → Абкант → Заваряване).</p>
    <label>Тип съставка
      <select id="rl-type">
        <option value="operation">Операция (в цех)</option>
        <option value="material">Материал / стока</option>
        <option value="child">Полуфабрикат / възел</option>
      </select>
    </label>
    <label id="rl-pick-wrap">Избери
      <input type="search" id="rl-search" placeholder="търси…" />
      <select id="rl-item" size="1"></select>
    </label>
    <div id="rl-op-extra" hidden>
      <label class="erp-check"><input type="checkbox" id="rl-op-new" /> ➕ Създай нова операция</label>
      <label id="rl-op-name-wrap" hidden>Име на операцията<input type="text" id="rl-op-name" placeholder="напр. Заваряване ръчно" /></label>
      <label>Цех (къде се изпълнява — за производство)
        <select id="rl-op-ws">
          <option value="">— избери цех —</option>
          ${workshops.map(w => `<option>${escapeHtml(w)}</option>`).join("")}
        </select>
      </label>
    </div>
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
  const pickWrap = wrap.querySelector("#rl-pick-wrap");
  const opExtra = wrap.querySelector("#rl-op-extra");
  const opNew = wrap.querySelector("#rl-op-new");
  const opNameWrap = wrap.querySelector("#rl-op-name-wrap");
  const opWs = wrap.querySelector("#rl-op-ws");

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
    else if (typeSel.value === "operation") { unitEl.value = "бр."; syncOpWs(); }
    else { const x = ERP.prodById[id]; unitEl.value = (x && x.unit) || "бр."; }
  }
  // При избор на съществуваща операция — показваме нейния текущ цех.
  function syncOpWs() {
    if (opNew.checked) return;
    const op = ERP.opById[Number(itemSel.value)];
    if (op && typeof erpEffectiveRoute === "function") opWs.value = erpEffectiveRoute(op).primary || "";
  }
  function refreshType() {
    const isOp = typeSel.value === "operation";
    opExtra.hidden = !isOp;
    // при „нова операция" скриваме избора от списъка
    const newMode = isOp && opNew.checked;
    pickWrap.hidden = newMode;
    opNameWrap.hidden = !newMode;
    if (isOp) syncOpWs();
  }
  typeSel.addEventListener("change", () => { searchEl.value = ""; fillItems(""); refreshType(); });
  opNew.addEventListener("change", () => { if (opNew.checked) opWs.value = ""; refreshType(); });
  searchEl.addEventListener("input", () => fillItems(searchEl.value));
  itemSel.addEventListener("change", syncUnit);
  fillItems("");
  refreshType();

  wrap.querySelector("#rl-cancel").addEventListener("click", close);
  wrap.querySelector("#rl-save").addEventListener("click", async () => {
    const status = wrap.querySelector("#rl-status");
    const qty = erpToNum(wrap.querySelector("#rl-qty").value) || 1;
    const unit = wrap.querySelector("#rl-unit").value.trim() || null;
    const row = { product_id: productId, quantity: qty, unit };

    if (typeSel.value === "operation") {
      const ws = opWs.value;
      let opId, opCode;
      if (opNew.checked) {
        const opName = wrap.querySelector("#rl-op-name").value.trim();
        if (!opName) { status.textContent = "Въведи име на операцията."; return; }
        if (!ws && !confirm("Без цех операцията няма да отива в производство. Да я създам ли без цех?")) return;
        status.textContent = "Създава операцията…";
        opCode = erpNextCode();
        const { data, error } = await sb.from("operations").insert({ code: opCode || null, name: opName, workshop: ws || null }).select("id,code").single();
        if (error) { status.textContent = /duplicate|unique/i.test(error.message) ? "⚠ Вече има операция с този код." : "⚠ " + error.message; return; }
        opId = data.id; opCode = data.code || opCode;
      } else {
        opId = Number(itemSel.value);
        if (!opId) { status.textContent = "Избери операция."; return; }
        const op = ERP.opById[opId] || {};
        opCode = op.code;
        if (!ws && !confirm("Без цех операцията няма да отива в производство. Да продължа ли?")) return;
      }
      // Записваме цеха в маршрутизацията (за да работи в производство).
      if (ws && opCode) { const e = await erpSaveOpRoute(opCode, ws); if (e) { status.textContent = "⚠ Цех: " + e.message; return; } }
      row.operation_id = opId;
    } else if (typeSel.value === "material") {
      const id = Number(itemSel.value);
      if (!id) { status.textContent = "Избери материал."; return; }
      row.material_id = id;
    } else {
      const id = Number(itemSel.value);
      if (!id) { status.textContent = "Избери възел."; return; }
      if (id === productId) { status.textContent = "Продукт не може да съдържа себе си."; return; }
      row.child_product_id = id;
    }

    status.textContent = "Добавя…";
    // Нова позиция — временно най-отзад; после подреждаме канонично.
    const cur = ERP.linesByProduct[productId] || [];
    row.position = cur.reduce((m, l) => Math.max(m, Number(l.position) || 0), 0) + 1;
    const { error } = await sb.from("recipe_lines").insert(row);
    if (error) { status.textContent = "⚠ " + error.message; return; }
    await erpReorderRecipeLines(productId);   // материали/възли отпред, операциите по реда на добавяне
    close();
    await erpReloadRecipe(productId);
  });
}

/* ---------- Подреждане на рецептата в правилен ред ----------
   Входове (материали/възли) най-отпред, после операциите — в реда, в който са
   добавени (това е производствената последователност: напр. Лазер → Абкант). */
async function erpReorderRecipeLines(productId) {
  try {
    const { data } = await sb.from("recipe_lines").select("id,position,operation_id").eq("product_id", productId);
    const lines = data || [];
    const grp = l => l.operation_id ? 1 : 0;   // 0 = материал/възел (вход), 1 = операция
    lines.sort((a, b) => grp(a) - grp(b) || (Number(a.position) || 0) - (Number(b.position) || 0) || a.id - b.id);
    for (let i = 0; i < lines.length; i++) {
      if ((Number(lines[i].position) || 0) !== i) await sb.from("recipe_lines").update({ position: i }).eq("id", lines[i].id);
    }
  } catch (e) { console.error("reorder recipe", e); }
}

// Бутон „Подреди правилно" от екрана Рецепта — оправя вече създадени технологии.
async function erpFixRecipeOrder(productId) {
  await erpReorderRecipeLines(productId);
  await erpReloadRecipe(productId);
}

/* ---------- Премахване на ред от рецептата ---------- */
async function erpRemoveRecipeLine(lineId, productId) {
  if (!confirm("Да премахна ли този ред от рецептата?")) return;
  const { error } = await sb.from("recipe_lines").delete().eq("id", lineId);
  if (error) { alert("Грешка: " + error.message); return; }
  await erpReloadRecipe(productId);
}
