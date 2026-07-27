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

let erpProdClient = "";   // филтър по клиент-собственик („" = всички, „__none" = без собственик)

// Различните клиенти-собственици (за падащия филтър).
function erpProdOwners() {
  return [...new Set((ERP.products || []).map(p => (p.owner_client || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "bg"));
}

// Кой клиент е поръчвал/купувал даден продукт (от историята на заявките и
// продажбите) → ERP._prodHist[productId] = [имена на клиенти]. Ползва се за
// авто-попълване на собственика и за маркера „споделен / поръчван и от".
async function erpLoadProdHist() {
  const map = {};
  const add = (pid, cn) => { pid = Number(pid); cn = (cn || "").trim(); if (!pid || !cn) return; (map[pid] = map[pid] || new Set()).add(cn); };
  try { if (typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(o => (o.lines || []).forEach(l => add(l.productId, o.clientName)));
  try { if (typeof erpLoadSales === "function") await erpLoadSales(); } catch (e) {}
  ((typeof erpSales !== "undefined" && erpSales) || []).forEach(s => (s.lines || []).forEach(l => { if ((l.itemKind || "product") === "product") add(l.refId, s.clientName); }));
  ERP._prodHist = {}; Object.keys(map).forEach(k => { ERP._prodHist[k] = [...map[k]]; });
  return ERP._prodHist;
}

// Клетка „Клиент" за списъка: показва собственика; ако няма — предложение от
// историята (един клиент) или „споделен" (няколко). Собственикът е само етикет —
// НЕ ограничава кой може да поръча продукта.
function erpOwnerCell(p) {
  const owner = (p.owner_client || "").trim();
  const hist = (ERP._prodHist && ERP._prodHist[p.id]) || [];
  if (owner) {
    const others = hist.filter(c => c !== owner);
    const extra = others.length ? ` <span class="erp-owner-extra" title="Поръчван и от: ${escapeAttr(others.join(", "))}">+${others.length}</span>` : "";
    return `<b>${escapeHtml(owner)}</b>${extra}`;
  }
  if (hist.length === 1) return `<span class="erp-owner-sugg" title="Предложение от историята — потвърди с ✎">${escapeHtml(hist[0])} <span class="erp-muted">(?)</span></span>`;
  if (hist.length > 1) return `<span class="erp-owner-shared" title="Поръчван от: ${escapeAttr(hist.join(", "))}">споделен (${hist.length})</span>`;
  return `<span class="erp-muted">—</span>`;
}

// Авто-попълване на собственика от историята: продукт, поръчван от ТОЧНО един
// клиент → собственик = той (само ако още няма собственик). Поръчван от няколко →
// остава „споделен" (не гадаем). Продуктите се пипат само там, където е сигурно.
async function erpFillProductClients() {
  if (ERP.hasOwnerClient === false) { alert(`Полето „клиент-собственик" още не е налично в базата.\nПусни веднъж в Supabase (SQL Editor):\n\nalter table products add column if not exists owner_client text;`); return; }
  await erpLoadProdHist();
  const toSet = [];
  (ERP.products || []).forEach(p => {
    if ((p.owner_client || "").trim()) return;
    const hist = ERP._prodHist[p.id] || [];
    if (hist.length === 1) toSet.push({ id: p.id, client: hist[0] });
  });
  const shared = (ERP.products || []).filter(p => !(p.owner_client || "").trim() && (ERP._prodHist[p.id] || []).length > 1).length;
  if (!toSet.length) { alert(`Няма какво да попълня автоматично.${shared ? "\n" + shared + " продукта са поръчвани от няколко клиента — остават споделени (задай собственик ръчно)." : ""}`); erpRenderProducts(); return; }
  if (!confirm(`Ще задам клиент-собственик на ${toSet.length} продукта (поръчвани от точно ЕДИН клиент).\n${shared} продукта са поръчвани от няколко клиента — остават без собственик („споделени").\nВече зададените собственици не се пипат.\n\nПродължавам?`)) { erpRenderProducts(); return; }
  let ok = 0;
  for (const it of toSet) {
    const { error } = await sb.from("products").update({ owner_client: it.client }).eq("id", it.id);
    if (!error) { ok++; const p = ERP.prodById[it.id]; if (p) p.owner_client = it.client; }
  }
  alert(`Готово. Попълнени ${ok} от ${toSet.length}.` + (shared ? `\n${shared} „споделени" (няколко клиента) — задай ги ръчно при нужда.` : ""));
  erpRenderProducts();
}

// Филтрираните редове според търсенето и филтрите (сортирани по име).
function erpProdRows() {
  const q = erpProdSearch.trim().toLowerCase();
  let rows = ERP.products.slice();
  if (erpProdFilter === "top") rows = rows.filter(erpIsTopProduct);
  if (erpProdFilter === "article") rows = rows.filter(p => !p.is_semifinished);
  if (erpProdFilter === "semi") rows = rows.filter(p => p.is_semifinished);
  if (erpProdClient === "__none") rows = rows.filter(p => !(p.owner_client || "").trim());
  else if (erpProdClient) rows = rows.filter(p => (p.owner_client || "").trim() === erpProdClient);
  if (q) rows = rows.filter(p =>
    (p.code || "").toLowerCase().includes(q) ||
    (p.name || "").toLowerCase().includes(q) ||
    (p.group_name || "").toLowerCase().includes(q) ||
    (p.owner_client || "").toLowerCase().includes(q));
  rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  return rows;
}

// Пълни само редовете (до 300) — търсенето не пре-рисува целия екран и не губи
// фокуса. При хиляди продукти пълното рисуване правеше таба много бавен.
function erpProdFillRows() {
  const tbody = document.getElementById("erp-prod-tbody");
  if (!tbody) return;
  const rows = erpProdRows();
  const shown = rows.slice(0, 300);
  tbody.innerHTML = shown.map(p => `
          <tr class="erp-clickable ${erpIsTopProduct(p) ? "erp-top-product" : ""} ${p.needs_recipe ? "erp-needs" : ""}" data-prod="${p.id}">
            <td data-label="Код">${erpIsTopProduct(p) ? '<span class="erp-top-flag" title="Краен продукт — този код влиза във фактурата">🧾</span> ' : ''}${escapeHtml(p.code || "—")}</td>
            <td data-label="Име">${escapeHtml(p.name || "")}</td>
            <td data-label="Клиент" class="erp-owner-cell">${erpOwnerCell(p)}</td>
            <td data-label="Тип">${p.is_semifinished ? '<span class="erp-tag erp-tag-semi">полуфабрикат</span>' : '<span class="erp-tag erp-tag-art">артикул</span>'}</td>
            <td data-label="Група">${escapeHtml(p.group_name || "")}</td>
            <td class="num cost-cell" data-label="Себестойност">${erpManualCostOf(p.id) !== null ? erpEur(p.cost_eur) + ' <span class="erp-tag erp-tag-manual" title="Ръчно зададена цена (екран Рецепта → ✎ Цена)">✋</span>' : (p.needs_recipe ? '<span class="erp-warn">чака рецепта</span>' : erpEur(p.cost_eur))}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-editp="${p.id}" title="Редактирай име/група/тип/клиент">✎</button><button class="btn btn-small" data-stree="${p.id}" title="Наличности по структурата (възли, материали, липси)">📦</button><button class="btn btn-small" data-open="${p.id}">Рецепта →</button></td>
          </tr>`).join("") ||
    `<tr><td colspan="7" class="report-empty">Няма продукти по този филтър.</td></tr>`;
  const cnt = document.getElementById("erp-prod-count");
  if (cnt) cnt.textContent = rows.length > 300 ? `показани 300 от ${rows.length} — потърси, за да стесниш` : `${rows.length} продукта`;
}

function erpRenderProducts() {
  const v = erpView();
  // Историята на клиентите (за собственик/споделен) — зарежда се веднъж лениво.
  if (ERP._prodHist === undefined) { ERP._prodHist = null; erpLoadProdHist().then(() => { if (ERP.tab === "products") erpProdFillRows(); }).catch(() => {}); }

  v.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="erp-prod-search" placeholder="Търси код, име, група…" value="${escapeAttr(erpProdSearch)}" />
      <select id="erp-prod-filter">
        <option value="all" ${erpProdFilter === "all" ? "selected" : ""}>Всички</option>
        <option value="top" ${erpProdFilter === "top" ? "selected" : ""}>🧾 Само крайни (за фактура)</option>
        <option value="article" ${erpProdFilter === "article" ? "selected" : ""}>Само артикули</option>
        <option value="semi" ${erpProdFilter === "semi" ? "selected" : ""}>Само полуфабрикати</option>
      </select>
      <select id="erp-prod-client" title="Филтър по клиент-собственик">
        <option value="" ${erpProdClient === "" ? "selected" : ""}>Всички клиенти</option>
        <option value="__none" ${erpProdClient === "__none" ? "selected" : ""}>— без собственик —</option>
        ${erpProdOwners().map(c => `<option value="${escapeAttr(c)}" ${erpProdClient === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
      <button class="btn btn-small" id="erp-prod-fillclients" title="Задай клиент-собственик автоматично от историята на заявките/продажбите (само където е поръчван от точно един клиент)">👥 Попълни клиентите</button>
      <span class="spacer"></span>
      <span class="erp-count" id="erp-prod-count"></span>
      <button class="btn btn-primary" id="erp-prod-add">🛠 Създай технология</button>
    </div>
    <p class="erp-prod-legend"><span class="erp-legend-top">🧾 Оцветените са крайни продукти</span> — кодът, който реално вкарваме във фактурата (главното от сглобката). Неоцветените се влагат като детайл/възел в друга рецепта.</p>
    ${ERP.hasOwnerClient === false ? `<p class="erp-warn" style="margin:4px 0">⚠ Колоната „клиент-собственик" липсва в базата. Пусни веднъж в Supabase: <code>alter table products add column if not exists owner_client text;</code></p>` : ""}
    <table class="report-table erp-table">
      <thead>
        <tr><th>Код</th><th>Име</th><th>Клиент</th><th>Тип</th><th>Група</th><th class="num cost-cell">Себестойност</th><th></th></tr>
      </thead>
      <tbody id="erp-prod-tbody"></tbody>
    </table>`;

  document.getElementById("erp-prod-search").addEventListener("input", e => {
    erpProdSearch = e.target.value; erpProdFillRows();
  });
  document.getElementById("erp-prod-filter").addEventListener("change", e => {
    erpProdFilter = e.target.value; erpProdFillRows();
  });
  const clientSel = document.getElementById("erp-prod-client");
  if (clientSel) clientSel.addEventListener("change", e => { erpProdClient = e.target.value; erpProdFillRows(); });
  const fillBtn = document.getElementById("erp-prod-fillclients");
  if (fillBtn) fillBtn.addEventListener("click", erpFillProductClients);
  document.getElementById("erp-prod-add").addEventListener("click", erpNewProduct);

  // Един слушател за цялата таблица (вместо по 4 на ред — хиляди при много продукти).
  const tbody = document.getElementById("erp-prod-tbody");
  tbody.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b && b.dataset.editp) { e.stopPropagation(); erpEditProduct(Number(b.dataset.editp)); return; }
    if (b && b.dataset.stree) { e.stopPropagation(); if (typeof erpStockTree === "function") erpStockTree(Number(b.dataset.stree)); return; }
    if (b && b.dataset.open) { e.stopPropagation(); erpRenderRecipe(Number(b.dataset.open)); return; }
    const tr = e.target.closest("tr[data-prod]");
    if (tr) erpRenderRecipe(Number(tr.dataset.prod));
  });
  erpProdFillRows();
}

// Редакция на продукт/детайл/възел: име, група, мярка, тип (кодът не се променя,
// за да не се къса връзката с рецептите/задачите).
async function erpEditProduct(id) {
  const p = ERP.prodById[id];
  if (!p) return;
  let clients = [];
  try { if (typeof erpLoadClients === "function") clients = await erpLoadClients(); } catch (e) {}
  const hist = (ERP._prodHist && ERP._prodHist[id]) || [];
  const histHint = hist.length ? `<span class="erp-muted" style="font-size:12px">Поръчван от: ${escapeHtml(hist.join(", "))}</span>` : "";
  const { wrap, close } = erpDialog(`
    <h3>Редакция на продукт <span class="erp-muted">${escapeHtml(p.code || "")}</span></h3>
    <label>Име<input type="text" id="ep-name" value="${escapeAttr(p.name || "")}" /></label>
    <label>Клиент / собственик <span class="erp-muted">(по избор — само етикет, не ограничава поръчките)</span>
      <input type="text" id="ep-client" list="ep-clients" value="${escapeAttr(p.owner_client || "")}" placeholder="за кой клиент е този продукт" />
      <datalist id="ep-clients">${clients.map(c => `<option value="${escapeAttr(c.company || "")}"></option>`).join("")}</datalist>
      ${histHint}</label>
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
      owner_client: wrap.querySelector("#ep-client").value.trim() || null,
    };
    status.textContent = "Записва…";
    const { error } = await sb.from("products").update(payload).eq("id", id);
    if (error) {
      status.textContent = "⚠ " + error.message + (/owner_client/.test(error.message || "") ? " · Пусни: alter table products add column if not exists owner_client text;" : "");
      return;
    }
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
