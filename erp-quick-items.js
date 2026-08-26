/* Данко Системс — ЕРП „⚡ Бързи изделия" (нестандартни поръчки по клиентски код).
   За клиенти с много подобни изделия в малки бройки: едно прозорче създава
   продукт + мини-рецепта (маршрут по цехове + материали от склад Материали)
   за 30 секунди, БЕЗ обикаляне из Продукти/Рецепти. Кодът е ЧИСТИЯТ клиентски
   номер (за да работи сканирането на баркода) или наш свободен текст.
   Всичко надолу по веригата е СТАНДАРТНОТО: пускане с нетване, задачи по
   цеховете, план за седмицата, Склад детайли, продажба, фактура, себестойност.

   Данни (app_config, без нов SQL):
   • quick_items:  { byId: { productId: { code, client, clientId, price, files:[{name,url,path}], createdAt, by } } }
   • quick_routes: { list: [{ id, name, ops:[operationId,…] }] }   — шаблони „Лазер → Абкант → …" */

const QUICK_EMAILS = ["dankog@gmail.com", "grigor.baykov@dankosystems.com", "miroslav.pilev@dankosystems.com"];
function quickAllowed() {
  const e = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && (MY_ACCESS.email || "").toLowerCase()) || "";
  return QUICK_EMAILS.includes(e);
}

let QUICK = null;          // { byId: {...} }
let QUICK_ROUTES = null;   // { list: [...] }

async function quickLoad(force) {
  if (QUICK && !force) return QUICK;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "quick_items").maybeSingle();
    QUICK = { byId: (data && data.data && data.data.byId) || {} };
  } catch (e) { QUICK = { byId: {} }; }
  return QUICK;
}
async function quickSave() {
  const { error } = await sb.from("app_config").upsert({ id: "quick_items", data: { byId: (QUICK && QUICK.byId) || {} }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис на бързите изделия: " + error.message); return false; }
  return true;
}
async function quickRoutesLoad(force) {
  if (QUICK_ROUTES && !force) return QUICK_ROUTES;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "quick_routes").maybeSingle();
    QUICK_ROUTES = { list: (data && data.data && data.data.list) || [] };
  } catch (e) { QUICK_ROUTES = { list: [] }; }
  return QUICK_ROUTES;
}
async function quickRoutesSave() {
  const { error } = await sb.from("app_config").upsert({ id: "quick_routes", data: { list: (QUICK_ROUTES && QUICK_ROUTES.list) || [] }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на шаблона: " + error.message);
}

// Бързо ли е изделието (за скриване от общите списъци в Продукти).
function erpQuickIs(pid) { return !!(QUICK && QUICK.byId && QUICK.byId[String(pid)]); }
function erpQuickEntry(pid) { return (QUICK && QUICK.byId && QUICK.byId[String(pid)]) || null; }

/* ---------- Домът: таб „📦 Нестандартни поръчки" в Заявки от клиенти ---------- */
let quickHomeQ = "";
async function erpQuickHome() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpEnsureLoaded(); await quickLoad(true); await quickRoutesLoad(); } catch (e) {}
  const items = Object.entries(QUICK.byId).map(([pid, e]) => {
    const p = ERP.prodById[Number(pid)] || {};
    return { pid: Number(pid), e, p };
  }).filter(x => x.p.id);
  items.sort((a, b) => String(b.e.createdAt || "").localeCompare(String(a.e.createdAt || "")));

  const routeOf = pid => (ERP.linesByProduct[pid] || [])
    .filter(l => l.operation_id).map(l => (ERP.opById[l.operation_id] || {}).name || "?").join(" → ");
  const matsOf = pid => (ERP.linesByProduct[pid] || [])
    .filter(l => l.material_id).map(l => { const m = ERP.matById[l.material_id] || {}; return `${m.code || ""} ×${erpNum(l.quantity)}`; }).join(", ");

  const rowsHtml = list => list.map(x => `
    <tr data-qpid="${x.pid}" class="erp-clickable">
      <td data-label="Клиент">${escapeHtml(x.e.client || "")}</td>
      <td data-label="Код"><b>${escapeHtml(x.p.code || "")}</b></td>
      <td data-label="Име">${escapeHtml(x.p.name || "")}${(x.e.files || []).length ? ` <a href="${escapeAttr(x.e.files[0].url)}" target="_blank" rel="noopener" title="Чертеж" onclick="event.stopPropagation()">📄</a>` : ""}</td>
      <td data-label="Маршрут" class="erp-muted">${escapeHtml(routeOf(x.pid) || "—")}</td>
      <td data-label="Материал" class="erp-muted">${escapeHtml(matsOf(x.pid) || "—")}</td>
      <td class="num" data-label="Цена">${x.e.price ? erpEur(x.e.price) : "—"}</td>
      <td class="num" data-label="В склада">${erpNum(x.p.stock || 0)}</td>
      <td class="erp-row-actions">
        ${quickAllowed() ? `<button class="btn btn-small" data-qedit="${x.pid}" title="Редакция">✎</button>` : ""}
        <button class="btn btn-small" data-qrec="${x.pid}" title="Отвори пълната рецепта">Рецепта →</button>
        ${quickAllowed() ? `<button class="btn btn-small btn-danger" data-qdel="${x.pid}" title="Изтрива изделието и мини-рецептата (само ако не е ползвано)">✕</button>` : ""}
      </td>
    </tr>`).join("");

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="q-back">← Назад към заявките</button>
      <span class="erp-count">📦 Нестандартни поръчки · ${items.length} ${items.length === 1 ? "изделие" : "изделия"}</span>
      <input type="search" id="q-find" placeholder="🔎 код / име / клиент…" value="${escapeAttr(quickHomeQ)}" style="min-width:200px" />
      <span class="spacer"></span>
      ${quickAllowed() ? `<button class="btn btn-small btn-primary" id="q-new">⚡ Ново бързо изделие</button>` : ""}
    </div>
    <p class="hint" style="margin:4px 0 8px">Изделия по <b>клиентски код</b> с мини-рецепта (маршрут по цехове + материал от склада). Добавят се в заявка от прозореца на заявката („+ Продукт" → „⚡ Ново бързо изделие") или оттук се преглеждат. Скрити са от общия каталог Продукти (има превключвател там). Повтори ли клиентът номера — изделието е готово, пускането е две цъквания.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Клиент</th><th>Код (клиентски)</th><th>Име</th><th>Маршрут</th><th>Материал/1 бр.</th><th class="num">Цена</th><th class="num">В склада</th><th></th></tr></thead>
      <tbody id="q-tbody">${rowsHtml(items) || `<tr><td colspan="8" class="report-empty">Още няма бързи изделия. ${quickAllowed() ? "Създай първото с бутона горе." : ""}</td></tr>`}</tbody>
    </table>`;

  const wire = () => {
    v.querySelectorAll("[data-qedit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpQuickWizard({ pid: Number(b.dataset.qedit), onDone: erpQuickHome }); }));
    v.querySelectorAll("[data-qrec]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); if (typeof erpRenderRecipe === "function") { ERP.tab = "recipes"; erpSetTab && erpSetTab("recipes", true); erpRenderRecipe(Number(b.dataset.qrec)); } }));
    v.querySelectorAll("[data-qdel]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpQuickDelete(Number(b.dataset.qdel)); }));
    v.querySelectorAll("tr[data-qpid]").forEach(tr => tr.addEventListener("click", () => { if (quickAllowed()) erpQuickWizard({ pid: Number(tr.dataset.qpid), onDone: erpQuickHome }); }));
  };
  wire();
  v.querySelector("#q-back").addEventListener("click", () => erpRenderCustomerOrders());
  const nb = v.querySelector("#q-new");
  if (nb) nb.addEventListener("click", () => erpQuickWizard({ onDone: erpQuickHome }));
  v.querySelector("#q-find").addEventListener("input", uiDebounce(e => {
    quickHomeQ = e.target.value;
    const toks = puMatNorm(quickHomeQ).split(" ").filter(Boolean);
    const list = !toks.length ? items : items.filter(x => {
      const hay = puMatNorm(`${x.p.code} ${x.p.name} ${x.e.client}`);
      return toks.every(t => hay.includes(t));
    });
    const tb = v.querySelector("#q-tbody");
    tb.innerHTML = rowsHtml(list) || `<tr><td colspan="8" class="report-empty">Няма съвпадения.</td></tr>`;
    wire();
  }, 200));
}

async function erpQuickDelete(pid) {
  const p = ERP.prodById[pid]; if (!p) return;
  if (!confirm(`Да изтрия ли „${p.code || ""} ${p.name || ""}" с мини-рецептата му?\n\nАко вече е пускано в производство или има складови движения, базата ще откаже изтриването — тогава изделието остава.`)) return;
  try {
    await sb.from("recipe_lines").delete().eq("product_id", pid);
    const { error } = await sb.from("products").delete().eq("id", pid);
    if (error) { alert("Базата отказа изтриването (изделието е ползвано): " + error.message); return; }
    delete QUICK.byId[String(pid)];
    await quickSave();
    await erpLoadAll();
    erpQuickHome();
  } catch (e) { alert("Грешка: " + (e.message || e)); }
}

/* ---------- Прозорецът „⚡ Ново бързо изделие" ----------
   opts: { pid?  — редакция на съществуващо;
           preset? { client, clientId, code, name, price } — предварително попълване;
           onDone?(product) — вика се след запис (напр. добавя ред в заявка). */
async function erpQuickWizard(opts) {
  opts = opts || {};
  if (!quickAllowed()) { alert("Нямаш права за бързи изделия (Данко, Григор, Миро)."); return; }
  try { await erpEnsureLoaded(); await quickLoad(); await quickRoutesLoad(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  const clients = (typeof erpLoadClients === "function") ? await erpLoadClients() : [];

  const editing = opts.pid ? ERP.prodById[opts.pid] : null;
  const entry = opts.pid ? (erpQuickEntry(opts.pid) || {}) : {};
  const preset = opts.preset || {};

  // Състояние на прозореца.
  const st = {
    client: entry.client || preset.client || "",
    clientId: entry.clientId || preset.clientId || null,
    code: (editing && editing.code) || preset.code || "",
    name: (editing && editing.name) || preset.name || "",
    price: entry.price || preset.price || "",
    ops: [],                    // [operationId] по ред на изпълнение
    mats: [],                   // [{materialId, qty}]
    files: (entry.files || []).slice(),
    newFiles: [],               // File обекти — качват се при запис
  };
  if (editing) {
    (ERP.linesByProduct[editing.id] || []).forEach(l => {
      if (l.operation_id) st.ops.push(l.operation_id);
      else if (l.material_id) st.mats.push({ materialId: l.material_id, qty: Number(l.quantity) || 1 });
    });
  }

  const opsSorted = ERP.operations.slice().sort((a, b) => bgCmp(a.name, b.name));
  const opLabel = id => { const o = ERP.opById[id] || {}; return `${o.name || "?"}${o.workshop ? " · " + o.workshop : ""}`; };
  const codeTrim = s => String(s || "").trim();

  const { wrap, close } = erpDialog(`
    <h3>${editing ? "✎ Бързо изделие" : "⚡ Ново бързо изделие"}</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label>Клиент <input type="text" id="qw-client" list="qw-clients" value="${escapeAttr(st.client)}" placeholder="име на клиента" />
        <datalist id="qw-clients">${clients.map(c => `<option value="${escapeAttr(c.company)}"></option>`).join("")}</datalist></label>
      <label>Код (клиентският номер) <input type="text" id="qw-code" value="${escapeAttr(st.code)}" placeholder="точно както е на чертежа/баркода" /></label>
    </div>
    <label>Име / описание <input type="text" id="qw-name" value="${escapeAttr(st.name)}" placeholder="напр. Конзола Г-образна 3 мм" style="width:100%" /></label>
    <p class="save-status" id="qw-codewarn" style="margin:2px 0"></p>

    <fieldset class="card" style="margin:8px 0;padding:8px 10px">
      <legend>Маршрут по цехове (по ред на изпълнение)</legend>
      <div class="erp-toolbar" style="margin:0 0 6px">
        <label class="erp-inline">Шаблон
          <select id="qw-route-tpl"><option value="">— избери —</option>${QUICK_ROUTES.list.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join("")}</select>
        </label>
        <label class="erp-inline">+ операция
          <select id="qw-op-add"><option value="">— добави —</option>${opsSorted.map(o => `<option value="${o.id}">${escapeHtml(opLabel(o.id))}</option>`).join("")}</select>
        </label>
        <span class="spacer"></span>
        <button type="button" class="btn btn-small" id="qw-route-save" title="Запазва текущия маршрут като шаблон за следващи изделия">💾 Като шаблон</button>
      </div>
      <div id="qw-ops" style="display:flex;flex-wrap:wrap;gap:6px"></div>
    </fieldset>

    <fieldset class="card" style="margin:8px 0;padding:8px 10px">
      <legend>Материал от склад Материали (за 1 брой)</legend>
      <div id="qw-mats"></div>
      <button type="button" class="btn btn-small" id="qw-mat-add">+ материал</button>
      <span class="hint">По желание — без материал изделието върви само по операции (напр. клиентски материал).</span>
    </fieldset>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <label>Цена за клиента (EUR, по желание) <input type="number" id="qw-price" min="0" step="any" value="${escapeAttr(String(st.price || ""))}" placeholder="слиза в заявката/фактурата" /></label>
      <label>Чертеж (PDF/снимка) <input type="file" id="qw-file" accept="application/pdf,image/*" multiple /></label>
    </div>
    <div id="qw-files"></div>
    <p class="save-status" id="qw-status"></p>
    <div class="erp-dialog-actions">
      <button class="btn" id="qw-cancel">Отказ</button>
      <button class="btn btn-primary" id="qw-save">${editing ? "💾 Запази промените" : "⚡ Създай изделието"}</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  const $ = s => wrap.querySelector(s);

  // --- маршрут (чипове с ✕ и ◀ за местене наляво) ---
  const drawOps = () => {
    $("#qw-ops").innerHTML = st.ops.map((id, i) => `
      <span class="erp-tag" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px">
        <b>${i + 1}.</b> ${escapeHtml(opLabel(id))}
        ${i > 0 ? `<button type="button" class="btn btn-small" data-opup="${i}" title="Премести по-рано">◀</button>` : ""}
        <button type="button" class="btn btn-small" data-oprm="${i}" title="Махни">✕</button>
      </span>`).join("") || `<span class="erp-muted">Още няма операции — избери шаблон или добавяй една по една.</span>`;
    $("#qw-ops").querySelectorAll("[data-oprm]").forEach(b => b.addEventListener("click", () => { st.ops.splice(Number(b.dataset.oprm), 1); drawOps(); }));
    $("#qw-ops").querySelectorAll("[data-opup]").forEach(b => b.addEventListener("click", () => {
      const i = Number(b.dataset.opup); const t = st.ops[i - 1]; st.ops[i - 1] = st.ops[i]; st.ops[i] = t; drawOps();
    }));
  };
  drawOps();
  $("#qw-route-tpl").addEventListener("change", e => {
    const t = QUICK_ROUTES.list[Number(e.target.value)];
    if (t) { st.ops = (t.ops || []).filter(id => ERP.opById[id]); drawOps(); }
  });
  $("#qw-op-add").addEventListener("change", e => {
    const id = Number(e.target.value);
    if (id) { st.ops.push(id); drawOps(); }
    e.target.value = "";
  });
  $("#qw-route-save").addEventListener("click", async () => {
    if (!st.ops.length) { alert("Първо добави операции."); return; }
    const name = prompt(`Име на шаблона (напр. „Лазер + Абкант + Боя“):`);
    if (!name) return;
    QUICK_ROUTES.list.push({ id: Date.now(), name: name.trim(), ops: st.ops.slice() });
    await quickRoutesSave();
    $("#qw-route-tpl").innerHTML = `<option value="">— избери —</option>` + QUICK_ROUTES.list.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join("");
  });

  // --- материали ---
  const drawMats = () => {
    $("#qw-mats").innerHTML = st.mats.map((r, i) => {
      const m = ERP.matById[r.materialId] || {};
      return `<div class="erp-toolbar" style="margin:0 0 4px">
        <span><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">нал. ${erpNum(m.stock)} ${escapeHtml(m.unit || "")}</span></span>
        <label class="erp-inline">за 1 бр. <input type="number" min="0" step="any" value="${escapeAttr(String(r.qty))}" data-matq="${i}" style="width:90px" /> ${escapeHtml(m.unit || "")}</label>
        <button type="button" class="btn btn-small btn-danger" data-matrm="${i}">✕</button>
      </div>`;
    }).join("");
    $("#qw-mats").querySelectorAll("[data-matq]").forEach(inp => inp.addEventListener("input", () => { st.mats[Number(inp.dataset.matq)].qty = erpToNum(inp.value) || 0; }));
    $("#qw-mats").querySelectorAll("[data-matrm]").forEach(b => b.addEventListener("click", () => { st.mats.splice(Number(b.dataset.matrm), 1); drawMats(); }));
  };
  drawMats();
  $("#qw-mat-add").addEventListener("click", () => {
    const { wrap: mw, close: mclose } = erpDialog(`
      <h3>Материал от склада</h3>
      <input type="search" id="qwm-q" placeholder="търси код или име…" />
      <div id="qwm-list" class="erp-lp-list"></div>
      <div class="erp-dialog-actions"><button class="btn" id="qwm-cancel">Затвори</button></div>`);
    const listEl = mw.querySelector("#qwm-list");
    const render = q => {
      const list = puMatFilter(ERP.materials, q);
      listEl.innerHTML = list.slice(0, 80).map(m => `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">нал. ${erpNum(m.stock)} ${escapeHtml(m.unit || "")}${m.avg_cost ? " · " + erpEur(m.avg_cost) : ""}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
      listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
        st.mats.push({ materialId: Number(b.dataset.id), qty: 1 });
        mclose(); drawMats();
      }));
    };
    render("");
    mw.querySelector("#qwm-q").addEventListener("input", uiDebounce(e => render(e.target.value), 150));
    mw.querySelector("#qwm-cancel").addEventListener("click", mclose);
    setTimeout(() => mw.querySelector("#qwm-q").focus(), 50);
  });

  // --- файлове ---
  const drawFiles = () => {
    $("#qw-files").innerHTML = st.files.map((f, i) => `<span class="erp-tag">📄 <a href="${escapeAttr(f.url)}" target="_blank" rel="noopener">${escapeHtml(f.name)}</a> <button type="button" class="btn btn-small" data-frm="${i}">✕</button></span>`).join(" ")
      + st.newFiles.map(f => ` <span class="erp-tag">📄 ${escapeHtml(f.name)} <span class="erp-muted">(ще се качи)</span></span>`).join(" ");
    $("#qw-files").querySelectorAll("[data-frm]").forEach(b => b.addEventListener("click", () => { st.files.splice(Number(b.dataset.frm), 1); drawFiles(); }));
  };
  drawFiles();
  $("#qw-file").addEventListener("change", e => { st.newFiles.push(...Array.from(e.target.files || [])); e.target.value = ""; drawFiles(); });

  // --- проверка на кода: зает ли е (на живо) ---
  const codeCheck = () => {
    const c = codeTrim($("#qw-code").value);
    const warn = $("#qw-codewarn");
    if (!c) { warn.textContent = ""; return null; }
    const ex = ERP.products.find(p => codeTrim(p.code) === c && (!editing || p.id !== editing.id));
    if (!ex) { warn.textContent = ""; return null; }
    const exEntry = erpQuickEntry(ex.id);
    if (exEntry && String(exEntry.client || "").trim().toLowerCase() === $("#qw-client").value.trim().toLowerCase()) {
      warn.innerHTML = `✅ Кодът <b>${escapeHtml(c)}</b> ВЕЧЕ съществува за този клиент („${escapeHtml(ex.name || "")}") — рецептата е готова. Ползвай готовото изделие, не създавай второ.`;
    } else {
      warn.innerHTML = `⚠ Кодът <b>${escapeHtml(c)}</b> е зает (${escapeHtml(ex.name || "")}${exEntry ? " · клиент " + escapeHtml(exEntry.client || "") : " · от каталога"}). Добави префикс, напр. <b>${escapeHtml(($("#qw-client").value.trim().slice(0, 3).toUpperCase() || "КЛ") + "-" + c)}</b>.`;
    }
    return ex;
  };
  $("#qw-code").addEventListener("input", uiDebounce(codeCheck, 250));
  $("#qw-client").addEventListener("input", uiDebounce(codeCheck, 250));

  $("#qw-cancel").addEventListener("click", close);

  // --- запис ---
  $("#qw-save").addEventListener("click", async () => {
    const status = $("#qw-status");
    st.client = $("#qw-client").value.trim();
    st.code = codeTrim($("#qw-code").value);
    st.name = $("#qw-name").value.trim();
    st.price = erpToNum($("#qw-price").value) || "";
    const cm = clients.find(c => c.company === st.client);
    st.clientId = cm ? cm.id : null;

    if (!st.client) { status.textContent = "⚠ Въведи клиент."; return; }
    if (!st.code) { status.textContent = "⚠ Въведи код (клиентския номер)."; return; }
    if (!st.name) { status.textContent = "⚠ Въведи име/описание."; return; }
    if (!st.ops.length) { status.textContent = "⚠ Маршрутът е празен — добави поне една операция."; return; }
    const ex = codeCheck();
    if (ex) {
      const exEntry = erpQuickEntry(ex.id);
      if (exEntry && String(exEntry.client || "").trim().toLowerCase() === st.client.toLowerCase()) {
        // Същият клиент, същият код → предлагаме готовото вместо дубликат.
        if (confirm(`„${st.code}" вече съществува за ${st.client} — рецептата е готова.\nДа ползвам ГОТОВОТО изделие?`)) {
          close(); if (opts.onDone) opts.onDone(ex);
          return;
        }
        return;
      }
      status.textContent = "⚠ Кодът е зает — смени го (виж предупреждението горе).";
      return;
    }

    const btn = $("#qw-save"); btn.disabled = true; status.textContent = "Записва…";
    try {
      // 1) Продуктът (при редакция — обновяване).
      let pid = editing ? editing.id : null;
      const payload = { code: st.code, name: st.name, group_name: st.client, unit: "бр.", is_semifinished: false, needs_recipe: false };
      if (typeof ERP !== "undefined" && ERP.hasOwnerClient !== false) payload.owner_client = st.client;
      if (editing) {
        const { error } = await sb.from("products").update(payload).eq("id", pid);
        if (error) throw error;
      } else {
        let ins = await sb.from("products").insert(payload).select("id").single();
        if (ins.error && /owner_client/.test(ins.error.message || "")) {
          delete payload.owner_client;
          ins = await sb.from("products").insert(payload).select("id").single();
        }
        if (ins.error) throw ins.error;
        pid = ins.data.id;
      }

      // 2) Мини-рецептата: материалите първи, после операциите по реда на маршрута.
      if (editing) await sb.from("recipe_lines").delete().eq("product_id", pid);
      const rows = [];
      let pos = 0;
      st.mats.filter(r => r.materialId && r.qty > 0).forEach(r => {
        const m = ERP.matById[r.materialId] || {};
        rows.push({ product_id: pid, material_id: r.materialId, quantity: r.qty, unit: m.unit || "бр.", position: pos++ });
      });
      st.ops.forEach(id => rows.push({ product_id: pid, operation_id: id, quantity: 1, unit: "бр.", position: pos++ }));
      if (rows.length) {
        const { error } = await sb.from("recipe_lines").insert(rows);
        if (error) throw error;
      }

      // 3) Чертежите.
      status.textContent = st.newFiles.length ? "Качва чертежите…" : "Записва…";
      for (const f of st.newFiles) {
        const path = `quick/${Date.now()}-${safeName(f.name)}`;
        const { error } = await sb.storage.from(BUCKET).upload(path, f);
        if (error) { alert(`Чертежът „${f.name}“ не се качи: ` + error.message); continue; }
        const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
        st.files.push({ name: f.name, path, url: data.publicUrl });
      }

      // 4) Записът в бързите изделия (code влиза и тук — Цеховете показват чертежа по код).
      QUICK.byId[String(pid)] = {
        code: st.code, client: st.client, clientId: st.clientId, price: st.price || "",
        files: st.files, createdAt: (entry.createdAt || new Date().toISOString()),
        by: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "",
      };
      await quickSave();
      await erpLoadAll();
      const p = ERP.prodById[pid];
      close();
      if (opts.onDone) opts.onDone(p);
    } catch (e) {
      btn.disabled = false;
      status.textContent = "⚠ " + (/duplicate|unique/i.test(e.message || "") ? "Вече има продукт с този код." : (e.message || e));
    }
  });
  setTimeout(() => $(st.client ? "#qw-code" : "#qw-client").focus(), 50);
}
