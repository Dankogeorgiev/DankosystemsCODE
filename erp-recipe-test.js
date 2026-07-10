/* Данко Системс — „🧪 Тест рецепта".
   Симулира какво ще стане при „Пусни в производство" за дадена рецепта, БЕЗ да
   пуска нищо: кои операции отиват в кой цех, кои детайли се вземат от склад, кои
   операции нямат цех, кои детайли блокират сглобяването, какви материали трябват
   и обща присъда дали ще върви правилно. Позволява бърза корекция на маршрута
   (операция → цех) на място и повторно тестване. Ползва глобалните ERP,
   erpEffectiveRoute, erpIsAssemblyOp, erpDetailRouteKey, erpSaveOpRoute, erpDialog,
   erpToNum, erpNum, escapeHtml/escapeAttr, erpRenderRecipe (erp-recipes.js). */

// Обхожда рецептата като при производство и връща дърво с маршрута.
function erpRTWalk(pid, mult, anc, depth, ignoreStock) {
  const p = ERP.prodById[pid] || {};
  const stock = Math.max(0, Number(p.stock) || 0);
  const netFromStock = ignoreStock ? 0 : Math.min(stock, mult);
  const makeCount = mult - netFromStock;
  const node = {
    pid, code: p.code || "", name: p.name || "", depth, mult,
    stock, netFromStock, makeCount, fullyStocked: makeCount <= 0,
    ops: [], materials: [], children: [],
  };
  if (node.fullyStocked) { node.hasRouteInSubtree = false; return node; }
  (ERP.linesByProduct[pid] || []).forEach(l => {
    if (l.operation_id) {
      const op = ERP.opById[l.operation_id] || {};
      let ws = (typeof erpEffectiveRoute === "function") ? (erpEffectiveRoute(op).primary || "") : (op.workshop || "");
      const dkey = (typeof erpDetailRouteKey === "function") ? erpDetailRouteKey(p.code, p.name, op.name) : "";
      const dovr = (ERP.detailRouting || {})[dkey];
      if (dovr) ws = dovr;
      node.ops.push({
        opId: op.id, opCode: op.code, name: op.name || "", ws,
        external: !ws || ws === "Външна услуга", noWs: !ws,
        assembly: typeof erpIsAssemblyOp === "function" && erpIsAssemblyOp(op.name || ""),
      });
    } else if (l.material_id) {
      const m = ERP.matById[l.material_id] || {};
      const per = Number(l.quantity) || 1;
      const need = node.makeCount * per;
      const mstock = Number(m.stock) || 0;
      node.materials.push({ id: m.id, code: m.code || "", name: m.name || "", unit: m.unit || "", need, stock: mstock, short: Math.max(0, need - mstock) });
    } else if (l.child_product_id && !anc.has(l.child_product_id)) {
      const per = Number(l.quantity) || 1;
      node.children.push(erpRTWalk(l.child_product_id, node.makeCount * per, new Set([...anc, l.child_product_id]), depth + 1, ignoreStock));
    }
  });
  const internalOps = node.ops.filter(o => !o.external);
  node.childrenProduce = node.children.some(c => c.hasRouteInSubtree && !c.fullyStocked);
  node.hasRouteInSubtree = internalOps.length > 0 || node.children.some(c => c.hasRouteInSubtree || c.fullyStocked);
  // Детайл, който трябва да се произведе, но няма нито една операция с цех в целия
  // си подрод и не е на склад — блокира сглобяването на родителя.
  node.blocked = node.makeCount > 0 && !node.hasRouteInSubtree;
  return node;
}

// Събира проблеми/информация от дървото (рекурсивно).
function erpRTCollect(node, acc) {
  node.ops.forEach(o => {
    if (o.noWs) acc.noWs.push({ node, op: o });
    else if (o.ws === "Външна услуга") acc.ext.push({ node, op: o });
  });
  node.materials.forEach(m => { if (m.short > 0) acc.matShort.push(m); });
  if (node.depth > 0 && node.blocked) acc.blocked.push(node);
  if (node.netFromStock > 0) acc.stocked.push(node);
  node.children.forEach(c => erpRTCollect(c, acc));
  return acc;
}

function erpRTNodeHtml(node) {
  const isAssembly = node.ops.some(o => o.assembly);
  const icon = node.children.length ? "📦" : "🔩";
  const pad = `style="margin-left:${node.depth * 18}px"`;
  if (node.fullyStocked) {
    return `<div class="rt-node rt-stocked" ${pad}>
      <div class="rt-head">${icon} <b>${escapeHtml(node.code)}</b> ${escapeHtml(node.name)}
        <span class="rt-badge rt-badge-stock">✔ изцяло от склад (наличност ${erpNum(node.stock)})</span></div></div>`;
  }
  const head = `<div class="rt-head">${icon} <b>${escapeHtml(node.code)}</b> ${escapeHtml(node.name)}
    <span class="rt-qty">× ${erpNum(node.makeCount)}</span>
    ${node.netFromStock > 0 ? `<span class="rt-badge rt-badge-stock">↧ ${erpNum(node.netFromStock)} от склад</span>` : ""}
    ${node.blocked ? `<span class="rt-badge rt-badge-bad">🚫 няма цех/рецепта — блокира сглобяването</span>
      <button type="button" class="btn btn-small rt-open" data-pid="${node.pid}">✎ рецепта</button>` : ""}</div>`;

  const opsHtml = node.ops.map(o => {
    if (o.noWs) {
      const sel = `<select class="rt-route" data-opcode="${escapeAttr(o.opCode || "")}">
        <option value="">— избери цех —</option>
        ${(typeof erpWorkshops === "function" ? erpWorkshops() : []).map(w => `<option value="${escapeAttr(w)}">${escapeHtml(w)}</option>`).join("")}
      </select>`;
      return `<div class="rt-op rt-op-bad">❌ ${escapeHtml(o.name)} <span class="rt-arrow">→ няма цех</span> ${sel}</div>`;
    }
    if (o.ws === "Външна услуга") {
      return `<div class="rt-op rt-op-ext">🔵 ${escapeHtml(o.name)} <span class="rt-arrow">→ Външна услуга (подизпълнител)</span></div>`;
    }
    const gate = (o.assembly && node.childrenProduce) ? ` <span class="rt-gate">⏳ чака частите</span>` : "";
    return `<div class="rt-op rt-op-ok">✅ ${escapeHtml(o.name)} <span class="rt-arrow">→ ${escapeHtml(o.ws)}</span>${gate}</div>`;
  }).join("");

  const matHtml = node.materials.map(m =>
    `<div class="rt-mat">🧱 ${escapeHtml((m.code ? m.code + " · " : "") + m.name)} × ${erpNum(m.need)} ${escapeHtml(m.unit)}
      <span class="rt-muted">склад ${erpNum(m.stock)}${m.short > 0 ? ` · <b class="rt-bad-txt">недостиг ${erpNum(m.short)} ⚠</b>` : " ✓"}</span></div>`).join("");

  const childHtml = node.children.map(erpRTNodeHtml).join("");
  return `<div class="rt-node" ${pad}>${head}${opsHtml}${matHtml}</div>${childHtml}`;
}

// Тест на една рецепта (по продукт + бройка).
function erpTestRecipe(productId, qty, ignoreStock) {
  const p = ERP.prodById[productId];
  if (!p) { alert("Продуктът не е намерен."); return; }
  erpTestRecipeMulti([{ productId, qty: erpToNum(qty) || 1 }], ignoreStock);
}

// Тест на цяла заявка (няколко продукта наведнъж) преди пускане в производство.
// items: [{ productId, qty }]; title: незадължителен надпис (напр. „заявка №…").
function erpTestRecipeMulti(items, ignoreStock, title) {
  ignoreStock = ignoreStock !== false;   // по подразбиране игнорираме склада (чист тест на маршрута)
  items = (items || []).filter(it => it && it.productId && ERP.prodById[it.productId])
    .map(it => ({ productId: it.productId, qty: erpToNum(it.qty) || 1 }));
  if (!items.length) { alert("Няма продукти с рецепта за тестване. Добави поне един ред и го свържи с продукт от каталога."); return; }
  const single = items.length === 1;

  const trees = items.map(it => erpRTWalk(it.productId, it.qty, new Set([it.productId]), 0, ignoreStock));
  const acc = { noWs: [], ext: [], matShort: [], blocked: [], stocked: [] };
  trees.forEach(t => erpRTCollect(t, acc));
  const okOps = trees.reduce((s, t) => s + countOk(t), 0);
  const topDead = trees.some(t => t.blocked || (!t.hasRouteInSubtree && t.makeCount > 0));

  let verdict, vcls;
  if (topDead || acc.blocked.length) {
    verdict = "❌ НЯМА да върви правилно — има детайли без цех/рецепта, които блокират сглобяването.";
    vcls = "rt-verdict-bad";
  } else if (acc.noWs.length) {
    verdict = `⚠ Ще тръгне, но ${acc.noWs.length} операц${acc.noWs.length === 1 ? "ия няма" : "ии нямат"} цех — няма да влязат в цех (третират се като външни). Насочи ги към цех по-долу.`;
    vcls = "rt-verdict-warn";
  } else {
    verdict = single
      ? "✅ Рецептата ще върви правилно — всички операции имат цех и всеки детайл има маршрут."
      : "✅ Заявката ще върви правилно — всички продукти имат цялостен маршрут по цеховете.";
    vcls = "rt-verdict-ok";
  }

  const heading = single
    ? `🧪 Тест на рецептата — ${escapeHtml((trees[0].code || "") + " " + (trees[0].name || ""))}`
    : `🧪 Тест на заявката${title ? " — " + escapeHtml(title) : ""} (${items.length} продукта)`;

  const summary = `
    <div class="rt-verdict ${vcls}">${verdict}</div>
    <div class="rt-stats">
      <span>Операции с цех: <b>${okOps}</b></span>
      <span class="${acc.noWs.length ? "rt-bad-txt" : ""}">Без цех: <b>${acc.noWs.length}</b></span>
      <span>Външни услуги: <b>${acc.ext.length}</b></span>
      <span class="${acc.blocked.length ? "rt-bad-txt" : ""}">Блокиращи детайли: <b>${acc.blocked.length}</b></span>
      ${!ignoreStock && acc.stocked.length ? `<span>От склад: <b>${acc.stocked.length}</b></span>` : ""}
      <span class="${acc.matShort.length ? "rt-bad-txt" : ""}">Недостиг материали: <b>${acc.matShort.length}</b></span>
    </div>`;

  const treeHtml = trees.map(t => {
    const hdr = single ? "" : `<div class="rt-top-hdr">📋 <b>${escapeHtml(t.code || "")}</b> ${escapeHtml(t.name || "")} × ${erpNum(t.mult)}
      <button type="button" class="btn btn-small rt-open" data-pid="${t.pid}">✎ рецепта</button></div>`;
    return hdr + erpRTNodeHtml(t);
  }).join(`<hr class="rt-sep">`);

  const html = `
    <div class="rt-dialog">
      <h3>${heading}</h3>
      <div class="rt-controls">
        ${single ? `<label class="erp-inline">Бройка <input type="number" id="rt-qty" min="1" step="any" value="${escapeAttr(String(items[0].qty))}" style="width:80px" /></label>` : ""}
        <label class="erp-inline"><input type="checkbox" id="rt-ignore" ${ignoreStock ? "checked" : ""} /> игнорирай склада (чист тест на маршрута)</label>
        <button type="button" class="btn btn-small btn-primary" id="rt-run">↻ Тествай пак</button>
      </div>
      ${summary}
      <div class="rt-tree">${treeHtml}</div>
      <p class="hint">💡 „Без цех" операции: избери им цех от падащото меню — записва се веднага и важи за всички рецепти с тази операция. „Блокиращ детайл" = няма нито една операция с цех и не е на склад; отвори му рецептата и му добави операции с цех.</p>
      <div class="erp-dialog-actions">
        <button class="btn" id="rt-close">Затвори</button>
        ${single ? '<button class="btn btn-primary" id="rt-edit">✎ Отвори редактора на рецептата</button>' : ""}
      </div>
    </div>`;

  const { wrap, close } = erpDialog(html);
  const rerun = () => {
    const ig = wrap.querySelector("#rt-ignore").checked;
    const its = items.slice();
    if (single) { const qEl = wrap.querySelector("#rt-qty"); if (qEl) its[0] = { productId: items[0].productId, qty: erpToNum(qEl.value) || 1 }; }
    close();
    erpTestRecipeMulti(its, ig, title);
  };
  wrap.querySelector("#rt-run").addEventListener("click", rerun);
  wrap.querySelector("#rt-close").addEventListener("click", close);
  const editBtn = wrap.querySelector("#rt-edit");
  if (editBtn) editBtn.addEventListener("click", () => { close(); if (typeof erpRenderRecipe === "function") erpRenderRecipe(items[0].productId); });
  wrap.querySelectorAll(".rt-open").forEach(b =>
    b.addEventListener("click", () => { close(); if (typeof erpRenderRecipe === "function") erpRenderRecipe(Number(b.dataset.pid)); }));
  // Бърза корекция: операция → цех (записва и тества пак).
  wrap.querySelectorAll(".rt-route").forEach(sel =>
    sel.addEventListener("change", async () => {
      const code = sel.dataset.opcode, ws = sel.value;
      if (!code || !ws) return;
      sel.disabled = true;
      const err = (typeof erpSaveOpRoute === "function") ? await erpSaveOpRoute(code, ws) : "няма функция";
      if (err) { alert("Грешка при записа на маршрута: " + (err.message || err)); sel.disabled = false; return; }
      rerun();
    }));
}

// Брой операции с цех в цялото дърво (за статистиката).
function countOk(node) {
  let n = node.ops.filter(o => !o.external).length;
  node.children.forEach(c => { n += countOk(c); });
  return n;
}
