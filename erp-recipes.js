/* Данко Системс — ЕРП екран „Рецепта" (многостепенно дърво).
   Разгъва продукт → съставки; полуфабрикатите се разгъват надолу по нивата.
   До всеки ред: количество, мярка, себестойност. Цветово по вид. */

function erpRenderRecipe(productId) {
  const p = ERP.prodById[productId];
  const v = erpView();
  if (!p) { v.innerHTML = `<p class="report-empty">Продуктът не е намерен.</p>`; return; }

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
      <button class="btn btn-small btn-primary" id="erp-rl-add">+ Добави ред</button>
      <button class="btn btn-small" id="erp-rl-fix" title="Материали/възли най-отпред, операциите в реда на добавяне">↕ Подреди правилно</button>
      ${readyBadge}
      <span class="spacer"></span>
      <span class="erp-count erp-total-cost">Обща себестойност: <strong>${p.needs_recipe ? "чака рецепта" : erpEur(ERP.costById[productId])}</strong></span>
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

  document.getElementById("erp-recipe-back").addEventListener("click", () => erpSetTab("products"));
  document.getElementById("erp-wc-print").addEventListener("click", () =>
    erpPrintWorkCard(productId, document.getElementById("erp-wc-qty").value));
  document.getElementById("erp-rl-add").addEventListener("click", () => erpAddRecipeLine(productId));
  const fixBtn = document.getElementById("erp-rl-fix");
  if (fixBtn) fixBtn.addEventListener("click", () => { if (typeof erpFixRecipeOrder === "function") erpFixRecipeOrder(productId); });
  const add2 = document.getElementById("erp-rl-add2");
  if (add2) add2.addEventListener("click", () => erpAddRecipeLine(productId));
  v.querySelectorAll(".erp-rl-x").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpRemoveRecipeLine(Number(b.dataset.line), productId); }));
  v.querySelectorAll(".erp-node-draw-btn").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); erpNodeDrawings(Number(b.dataset.pid)); }));
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
    const rmBtn = depth === 0 ? `<button class="erp-rl-x" data-line="${l.id}" title="Премахни от рецептата">×</button>` : "";
    if (l.material_id) {
      const m = ERP.matById[l.material_id] || {};
      const cost = qty * (Number(m.avg_cost) || 0);
      return `<li class="erp-leaf">
        <span class="erp-tw"></span>
        <span class="erp-node erp-node-material">
          <span class="erp-node-main"><span class="erp-tag erp-tag-mat">мат.</span> ${escapeHtml(m.code || "")} ${escapeHtml(m.name || "")}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span>${rmBtn}
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
          <span class="erp-node-cost">${erpEur(cost)}</span>${rmBtn}
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
          <span class="erp-node-main"><span class="erp-tag erp-tag-semi">възел</span> ${escapeHtml(c.code || "")} ${escapeHtml(c.name || "")}${cycle ? ' <span class="erp-warn">(цикъл)</span>' : ""}${c.needs_recipe ? ' <span class="erp-warn">(чака рецепта)</span>' : ""}</span>
          <span class="erp-node-qty">${erpNum(qty)} ${escapeHtml(unit)}</span>
          <span class="erp-node-cost">${erpEur(cost)}</span>${drawBtn}${rmBtn}
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
