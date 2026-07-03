/* Данко Системс — ЕРП „Заявки от клиенти".
   Стандартни поръчки за продукти от каталога: наш № + клиентски №, забележка,
   няколко продукта, разбивка на материалите, пускане в производство (всички
   редове наведнъж) и проследяване. Заявката се пази в customer_orders.data (JSON).
   Ползва ERP/erpDialog/erpBuildTasks/erpToNum/erpNum/erpEur от другите erp-*.js. */

let erpCOList = null;       // заредени заявки
let erpClientsCache = null; // клиенти от Контакти (за избор)

async function erpLoadCustomerOrders() {
  const { data, error } = await sb.from("customer_orders").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  erpCOList = (data || []).map(r => ({ id: r.id, ...(r.data || {}) }));
}

async function erpLoadClients() {
  if (erpClientsCache) return erpClientsCache;
  try {
    // Клиентите идват от новата ЕРП директория (таблица partners, kind=customer).
    const { data } = await erpSelectAll("partners", "id,name", "kind", "customer");
    erpClientsCache = (data || []).map(r => ({ id: r.id, company: r.name }))
      .sort((a, b) => (a.company || "").localeCompare(b.company || "", "bg"));
  } catch { erpClientsCache = []; }
  return erpClientsCache;
}

function erpNextOrderNo() {
  let max = 0;
  (erpCOList || []).forEach(o => {
    const c = String(o.ourNo || "").trim();
    if (/^\d+$/.test(c)) { const n = parseInt(c, 10); if (n > max) max = n; }
  });
  return String(max + 1);
}

async function erpSaveCO(o) {
  const data = { ...o }; delete data.id;
  if (o.id) {
    const { error } = await sb.from("customer_orders").update({ data, updated_at: new Date().toISOString() }).eq("id", o.id);
    if (error) throw error;
  } else {
    const { data: ins, error } = await sb.from("customer_orders").insert({ data }).select("id").single();
    if (error) throw error;
    o.id = ins.id;
  }
}

/* ---------- Списък ---------- */
async function erpRenderCustomerOrders() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpLoadCustomerOrders(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя заявките</h3><p>${escapeHtml(e.message || String(e))}</p>` +
      `<p class="hint">Пусни обновения <code>erp-setup.sql</code> (таблица customer_orders) в Supabase.</p></div>`;
    return;
  }
  const rows = erpCOList.slice();
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} заявки</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="erp-co-new">+ Нова заявка</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Дата</th><th>Срок</th><th class="num">Продукти</th><th>Статус</th><th></th></tr></thead>
      <tbody>
        ${rows.map(o => `
          <tr class="erp-clickable" data-id="${o.id}">
            <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
            <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
            <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
            <td data-label="Дата">${escapeHtml(o.date || "")}</td>
            <td data-label="Срок">${escapeHtml(o.deadline || "")}</td>
            <td class="num" data-label="Продукти">${(o.lines || []).length}</td>
            <td data-label="Статус"><span class="erp-co-status s-${escapeAttr(o.status || "нова")}">${escapeHtml(o.status || "нова")}</span></td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
          </tr>`).join("") ||
          `<tr><td colspan="8" class="report-empty">Още няма заявки. Натисни „+ Нова заявка".</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("erp-co-new").addEventListener("click", erpNewCO);
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenCO(b.dataset.open); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenCO(tr.dataset.id)));
}

function erpNewCO() {
  const today = new Date().toISOString().slice(0, 10);
  erpRenderCOForm({ ourNo: erpNextOrderNo(), clientNo: "", clientName: "", clientId: null, date: today, deadline: "", note: "", status: "нова", lines: [] });
}
function erpOpenCO(id) {
  const o = (erpCOList || []).find(x => x.id === id);
  if (o) erpRenderCOForm(JSON.parse(JSON.stringify(o)));
}

/* ---------- Форма / детайл ---------- */
async function erpRenderCOForm(o) {
  const v = erpView();
  const clients = await erpLoadClients();
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="co-back">← Назад към заявките</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="co-save">💾 Запази</button>
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Наш № <input type="text" id="co-ourno" value="${escapeAttr(o.ourNo || "")}" /></label>
        <label>Клиентски № (референция) <input type="text" id="co-clientno" value="${escapeAttr(o.clientNo || "")}" placeholder="номер на заявката от клиента" /></label>
        <label>Клиент <input type="text" id="co-client" list="co-clients" value="${escapeAttr(o.clientName || "")}" placeholder="избери или въведи" />
          <datalist id="co-clients">${clients.map(c => `<option value="${escapeAttr(c.company || "")}"></option>`).join("")}</datalist></label>
        <label>Дата <input type="date" id="co-date" value="${escapeAttr(o.date || "")}" /></label>
        <label>Срок <input type="date" id="co-deadline" value="${escapeAttr(o.deadline || "")}" /></label>
        <label>Статус
          <select id="co-status">
            ${["нова", "в производство", "завършена"].map(s => `<option ${s === (o.status || "нова") ? "selected" : ""}>${s}</option>`).join("")}
          </select></label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="co-note" rows="3" placeholder="специфични изисквания, договорки…">${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">Продукти в заявката</h4>
      <table class="report-table erp-table" id="co-lines">
        <thead><tr><th>Код</th><th>Продукт</th><th class="num">Бройка</th><th></th></tr></thead>
        <tbody>${erpCOLinesHtml(o)}</tbody>
      </table>
      <button class="btn btn-small" id="co-add-prod">+ Добави продукт</button>

      <div class="erp-co-actions">
        <button class="btn btn-small" id="co-materials">🧮 Разбивка на материалите</button>
        <button class="btn btn-small btn-primary" id="co-produce">🏭 Пусни в производство</button>
      </div>
      <div id="co-extra"></div>
    </div>`;

  const bind = (id, key) => { const el = document.getElementById(id); el.addEventListener("input", () => { o[key] = el.value; }); };
  bind("co-ourno", "ourNo"); bind("co-clientno", "clientNo"); bind("co-date", "date");
  bind("co-deadline", "deadline"); bind("co-note", "note");
  document.getElementById("co-client").addEventListener("input", e => {
    o.clientName = e.target.value;
    const m = clients.find(c => (c.company || "") === e.target.value);
    o.clientId = m ? m.id : null;
  });
  document.getElementById("co-status").addEventListener("change", e => { o.status = e.target.value; });

  document.getElementById("co-back").addEventListener("click", erpRenderCustomerOrders);
  document.getElementById("co-save").addEventListener("click", () => erpCOSaveClick(o));
  document.getElementById("co-add-prod").addEventListener("click", () => erpCOAddProduct(o));
  document.getElementById("co-materials").addEventListener("click", () => erpCOMaterials(o));
  document.getElementById("co-produce").addEventListener("click", () => erpCOProduce(o));
  erpCOWireLines(o);
  if (o.production) erpCOTracking(o);
}

function erpCOLinesHtml(o) {
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Код">${escapeHtml(l.code || "")}</td>
      <td data-label="Продукт">${escapeHtml(l.name || "")}</td>
      <td class="num" data-label="Бройка"><input type="number" class="co-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || 1))}" style="width:80px" /></td>
      <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-rm="${i}">×</button></td>
    </tr>`).join("") || `<tr><td colspan="4" class="report-empty">Няма добавени продукти.</td></tr>`;
}
function erpCOWireLines(o) {
  const body = document.querySelector("#co-lines tbody");
  if (!body) return;
  body.querySelectorAll(".co-qty").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].qty = erpToNum(inp.value); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpCORefreshLines(o); }));
}
function erpCORefreshLines(o) {
  const body = document.querySelector("#co-lines tbody");
  if (body) { body.innerHTML = erpCOLinesHtml(o); erpCOWireLines(o); }
}

function erpCOAddProduct(o) {
  const { wrap, close } = erpDialog(`
    <h3>Добави продукт</h3>
    <input type="search" id="co-pp-q" placeholder="търси код или име…" />
    <div id="co-pp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="co-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#co-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.filter(p => !p.is_semifinished || true);
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(p =>
      `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} <span class="erp-muted">${p.is_semifinished ? "полуфабрикат" : "артикул"}</span></button>`).join("")
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const p = ERP.prodById[Number(b.dataset.id)];
      o.lines = o.lines || [];
      o.lines.push({ productId: p.id, code: p.code, name: p.name, qty: 1 });
      close(); erpCORefreshLines(o);
    }));
  };
  render("");
  wrap.querySelector("#co-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#co-pp-cancel").addEventListener("click", close);
}

async function erpCOSaveClick(o) {
  const btn = document.getElementById("co-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  try {
    await erpSaveCO(o);
    await erpLoadCustomerOrders();
    if (btn) { btn.disabled = false; btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) btn.textContent = "💾 Запази"; }, 1500); }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; }
    alert("Грешка при запис: " + (e.message || e));
  }
}

/* ---------- Разбивка на материалите за цялата заявка ---------- */
function erpCOExplode(o) {
  const acc = {};
  const rec = (pid, mult, anc) => {
    (ERP.linesByProduct[pid] || []).forEach(l => {
      if (l.material_id) acc[l.material_id] = (acc[l.material_id] || 0) + mult * (Number(l.quantity) || 1);
      else if (l.child_product_id && !anc.has(l.child_product_id)) rec(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]));
    });
  };
  (o.lines || []).forEach(l => rec(l.productId, erpToNum(l.qty) || 0, new Set([l.productId])));
  return Object.entries(acc).map(([mid, qty]) => {
    const m = ERP.matById[mid] || {};
    const stock = Number(m.stock) || 0;
    return { name: m.name || "", unit: m.unit || "", required: qty, stock, shortage: Math.max(0, qty - stock) };
  }).sort((a, b) => b.shortage - a.shortage || a.name.localeCompare(b.name, "bg"));
}
function erpCOMaterials(o) {
  const box = document.getElementById("co-extra");
  const rows = erpCOExplode(o);
  if (!rows.length) { box.innerHTML = `<p class="report-empty">Няма материали (добави продукти с рецепта).</p>`; return; }
  const short = rows.filter(r => r.shortage > 0).length;
  box.innerHTML = `
    <h4 class="erp-group-head">Необходими материали за заявката${short ? ` · <span class="erp-warn">${short} за поръчка</span>` : ""}</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Суровина</th><th>Мярка</th><th class="num">Нужно</th><th class="num">Налично</th><th class="num">Недостиг</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${r.shortage > 0 ? "erp-below" : ""}">
          <td data-label="Суровина">${escapeHtml(r.name)}</td>
          <td data-label="Мярка">${escapeHtml(r.unit)}</td>
          <td class="num" data-label="Нужно">${erpNum(r.required)}</td>
          <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
          <td class="num" data-label="Недостиг">${r.shortage > 0 ? `<span class="erp-warn">${erpNum(r.shortage)} ⚠</span>` : "0"}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

/* ---------- Пускане в производство (всички редове) ---------- */
async function erpCOProduce(o) {
  if (!(o.lines || []).length) { alert("Добави поне един продукт."); return; }
  // Първо запазваме, за да има № и id за връзката към задачите.
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

  let tasks = [], external = [];
  (o.lines || []).forEach(l => {
    const b = erpBuildTasks({ id: o.id, type: "customer_order", clientName: o.clientName || "", deadline: o.deadline || "", erpProductId: l.productId, erpQty: erpToNum(l.qty) || 1 });
    tasks = tasks.concat(b.tasks); external = external.concat(b.external);
  });
  if (!tasks.length) { alert("Няма операции за пускане (продуктите нямат рецепта с операции)."); return; }

  const already = o.production && o.production.count;
  let msg = `Ще създам ${tasks.length} задачи в цеховете за заявка №${o.ourNo} (${(o.lines || []).length} продукта).`;
  if (external.length) msg += `\n\n${external.length} външни операции (напр. поцинковане) са за подизпълнител.`;
  if (already) msg += `\n\n⚠ Вече има пуснато производство (${o.production.count} задачи). Ще ги заменя.`;
  if (!confirm(msg)) return;

  const del = await sb.from("tasks").delete().eq("data->source->>sampleId", String(o.id));
  if (del.error) { alert("Грешка при изчистване: " + del.error.message); return; }
  const { error } = await sb.from("tasks").insert(tasks.map(t => ({ data: t })));
  if (error) { alert("Грешка при създаване на задачи: " + error.message); return; }

  o.production = { at: new Date().toISOString(), count: tasks.length, external: external.length };
  o.status = "в производство";
  try { await erpSaveCO(o); await erpLoadCustomerOrders(); } catch {}
  const st = document.getElementById("co-status"); if (st) st.value = "в производство";
  alert(`Готово! Създадени ${tasks.length} задачи в цеховете.` + (external.length ? `\n(${external.length} външни операции.)` : ""));
  erpCOTracking(o);
}

/* ---------- Проследяване ---------- */
async function erpCOTracking(o) {
  const box = document.getElementById("co-extra");
  if (!box || !o.id) return;
  box.innerHTML = `<p class="erp-muted">Производство: зареждане на напредъка…</p>`;
  const { data, error } = await sb.from("tasks").select("done").eq("data->source->>sampleId", String(o.id));
  if (error) { box.innerHTML = `<p class="erp-warn">${escapeHtml(error.message)}</p>`; return; }
  const total = (data || []).length, done = (data || []).filter(r => r.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  box.innerHTML = total
    ? `<div class="erp-prod-line"><b>Производство:</b> ${done} / ${total} задачи готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button class="btn btn-small" id="co-refresh">↻</button></div>`
    : `<p class="erp-muted">Няма задачи за тази заявка.</p>`;
  const rb = document.getElementById("co-refresh"); if (rb) rb.addEventListener("click", () => erpCOTracking(o));
}
