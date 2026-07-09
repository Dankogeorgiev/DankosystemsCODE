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
  if (typeof erpPLEnsureCache === "function") { try { await erpPLEnsureCache(); } catch (e) {} }   // клиентски ценови листи
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

// Бърз „+ Нов клиент" направо от прозореца на заявката — записва в partners
// (kind=customer) и веднага го избира в заявката.
function erpCOAddClient(o) {
  const { wrap, close } = erpDialog(`
    <h3>Нов клиент</h3>
    <label>Име / Фирма<input type="text" id="nc-name" placeholder="Фирма ООД" /></label>
    <label>Лице за контакт<input type="text" id="nc-person" /></label>
    <label>Телефон<input type="text" id="nc-phone" /></label>
    <label>Имейл<input type="text" id="nc-email" /></label>
    <label>Град<input type="text" id="nc-city" /></label>
    <label>ДДС №<input type="text" id="nc-vat" /></label>
    <div class="erp-dialog-actions"><button class="btn" id="nc-cancel">Отказ</button><button class="btn btn-primary" id="nc-save">Добави</button></div>
    <p class="save-status" id="nc-status"></p>`);
  wrap.querySelector("#nc-cancel").addEventListener("click", close);
  wrap.querySelector("#nc-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#nc-name").value.trim();
    const status = wrap.querySelector("#nc-status");
    if (!name) { status.textContent = "Въведи име."; return; }
    const val = id => { const el = wrap.querySelector("#nc-" + id); const v = el ? el.value.trim() : ""; return v || null; };
    const payload = { kind: "customer", name, person: val("person"), phone: val("phone"), email: val("email"), city: val("city"), vat: val("vat") };
    status.textContent = "Записва…";
    const { data, error } = await sb.from("partners").insert(payload).select("id").single();
    if (error) { status.textContent = "⚠ " + error.message; return; }
    o.clientName = name; o.clientId = data.id;
    erpClientsCache = null;                                     // клиентите да се презаредят
    if (typeof erpPartners !== "undefined") erpPartners = null; // и екранът Клиенти/Доставчици
    close();
    erpRenderCOForm(o);                                        // пре-рисуваме с новия клиент избран
  });
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
      <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Дата</th><th>Срок</th><th class="num">Продукти</th><th class="num sell-cell">Стойност</th><th>Статус</th><th></th></tr></thead>
      <tbody>
        ${rows.map(o => `
          <tr class="erp-clickable" data-id="${o.id}">
            <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
            <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
            <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
            <td data-label="Дата">${escapeHtml(o.date || "")}</td>
            <td data-label="Срок">${escapeHtml(o.deadline || "")}</td>
            <td class="num" data-label="Продукти">${(o.lines || []).length}</td>
            <td class="num sell-cell" data-label="Стойност">${erpEur((o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0))}</td>
            <td data-label="Статус"><span class="erp-co-status s-${escapeAttr(o.status || "нова")}">${escapeHtml(o.status || "нова")}</span></td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
          </tr>`).join("") ||
          `<tr><td colspan="9" class="report-empty">Още няма заявки. Натисни „+ Нова заявка".</td></tr>`}
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
  if (!o.posted && (o.clientId || o.clientName)) erpCOFillPrices(o);   // авто-цени при отваряне
  const canDelete = (typeof isOwnerAdmin === "function") && isOwnerAdmin() && o.id;
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="co-back">← Назад към заявките</button>
      <span class="spacer"></span>
      ${canDelete ? '<button class="btn btn-small btn-danger" id="co-del">🗑 Изтрий заявката</button>' : ""}
      <button class="btn btn-small btn-primary" id="co-save">💾 Запази</button>
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Наш № <input type="text" id="co-ourno" value="${escapeAttr(o.ourNo || "")}" /></label>
        <label>Клиентски № (референция) <input type="text" id="co-clientno" value="${escapeAttr(o.clientNo || "")}" placeholder="номер на заявката от клиента" /></label>
        <label>Клиент
          <span class="co-client-row">
            <input type="text" id="co-client" list="co-clients" value="${escapeAttr(o.clientName || "")}" placeholder="избери или въведи" />
            <button type="button" class="btn btn-small" id="co-add-client" title="Добави нов клиент в директорията">+ Нов клиент</button>
          </span>
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
        <thead><tr><th>Код</th><th>Продукт</th><th class="num">Бройка</th><th class="num sell-cell">Прод. цена (€)</th><th class="num sell-cell">Сума</th><th></th></tr></thead>
        <tbody>${erpCOLinesHtml(o)}</tbody>
      </table>
      <div class="erp-co-linebar"><button class="btn btn-small" id="co-add-prod">+ Добави продукт</button><span class="spacer"></span><span class="erp-count sell-cell" id="co-total"></span></div>

      <div class="erp-co-actions">
        <button class="btn btn-small" id="co-materials">🧮 Разбивка на материалите</button>
        <button class="btn btn-small btn-primary" id="co-produce">🏭 Пусни в производство</button>
        ${o.production ? '<button class="btn btn-small btn-danger" id="co-withdraw">⬅ Изтегли от производство</button>' : ""}
        <button class="btn btn-small" id="co-email" title="Отваря готово писмо до клиента, че поръчката е готова">✉ Съобщи на клиента (готова)</button>
        <button class="btn btn-small" id="co-sale">🧾 Създай продажба</button>
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
    if (m && erpCOFillPrices(o)) erpCORefreshLines(o);   // авто-цени за клиента
  });
  document.getElementById("co-status").addEventListener("change", e => { o.status = e.target.value; });
  const addClientBtn = document.getElementById("co-add-client");
  if (addClientBtn) addClientBtn.addEventListener("click", () => erpCOAddClient(o));

  document.getElementById("co-back").addEventListener("click", erpRenderCustomerOrders);
  document.getElementById("co-save").addEventListener("click", () => erpCOSaveClick(o));
  const delBtn = document.getElementById("co-del");
  if (delBtn) delBtn.addEventListener("click", () => erpCODelete(o));
  document.getElementById("co-add-prod").addEventListener("click", () => erpCOAddProduct(o));
  document.getElementById("co-materials").addEventListener("click", () => erpCOMaterials(o));
  document.getElementById("co-produce").addEventListener("click", () => erpCOProduce(o));
  const wBtn = document.getElementById("co-withdraw");
  if (wBtn) wBtn.addEventListener("click", () => erpCOWithdraw(o));
  const emBtn = document.getElementById("co-email");
  if (emBtn) emBtn.addEventListener("click", () => { if (typeof erpEmailOrderReady === "function") erpEmailOrderReady(o); });
  const saleBtn = document.getElementById("co-sale");
  if (saleBtn) saleBtn.addEventListener("click", () => {
    if (!(o.lines || []).length) { alert("Добави поне един продукт."); return; }
    if (typeof erpNewSaleFromOrder === "function") erpNewSaleFromOrder(o);
    else alert("Модул Продажби още не е зареден.");
  });
  erpCOWireLines(o);
  if (o.production) erpCOTracking(o);
}

function erpCOLinesHtml(o) {
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Код">${escapeHtml(l.code || "")}</td>
      <td data-label="Продукт">${escapeHtml(l.name || "")}</td>
      <td class="num" data-label="Бройка"><input type="number" class="co-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || 1))}" style="width:70px" /></td>
      <td class="num sell-cell" data-label="Прод. цена"><input type="number" class="co-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:90px" placeholder="0.00" /></td>
      <td class="num sell-cell" data-label="Сума">${erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0))}</td>
      <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-rm="${i}">×</button></td>
    </tr>`).join("") || `<tr><td colspan="6" class="report-empty">Няма добавени продукти.</td></tr>`;
}
function erpCOWireLines(o) {
  const body = document.querySelector("#co-lines tbody");
  if (!body) return;
  body.querySelectorAll(".co-qty").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].qty = erpToNum(inp.value); erpCOLineSums(o); }));
  body.querySelectorAll(".co-price").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].unitPrice = erpToNum(inp.value); erpCOLineSums(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpCORefreshLines(o); }));
  erpCOTotal(o);
}
function erpCOLineSums(o) {  // обновява сумите по редове + общата, без загуба на фокус
  const body = document.querySelector("#co-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => {
    const l = (o.lines || [])[i]; if (!l) return;
    const sum = tr.querySelector('td[data-label="Сума"]');
    if (sum) sum.textContent = erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0));
  });
  erpCOTotal(o);
}
function erpCOTotal(o) {
  const el = document.getElementById("co-total"); if (!el) return;
  const t = (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  el.textContent = "Стойност на заявката: " + erpEur(t);
}
function erpCORefreshLines(o) {
  const body = document.querySelector("#co-lines tbody");
  if (body) { body.innerHTML = erpCOLinesHtml(o); erpCOWireLines(o); }
}

// Самообучение на цените: последната продажна цена за този клиент+продукт
// (от предишни заявки и продажби). Ползва се за авто-попълване „до второ нареждане".
function erpCOClientPrice(o, productId) {
  const byId = o && o.clientId;
  const name = ((o && o.clientName) || "").trim().toLowerCase();
  if (!byId && !name) return null;
  // 1) Изрична ценова листа за клиента (има превес над наученото).
  if (typeof erpPriceListEntry === "function") {
    const e = erpPriceListEntry(o.clientId, o.clientName, productId);
    if (e && erpToNum(e.price) > 0) return erpToNum(e.price);
  }
  const hits = [];
  (erpCOList || []).forEach(x => {
    if (o && x.id === o.id) return;
    const same = byId ? (x.clientId === byId) : ((x.clientName || "").trim().toLowerCase() === name);
    if (!same) return;
    (x.lines || []).forEach(l => {
      if (String(l.productId) === String(productId) && erpToNum(l.unitPrice) > 0)
        hits.push({ price: erpToNum(l.unitPrice), date: x.date || "" });
    });
  });
  if (typeof erpLastPriceFor === "function") {
    try { const s = erpLastPriceFor({ clientId: o.clientId, clientName: o.clientName, currency: "EUR" }, "product", productId); if (s) hits.push({ price: s.price, date: s.date || "" }); } catch (e) {}
  }
  if (!hits.length) return null;
  hits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return hits[0].price;
}
function erpCOFillPrices(o) {
  let filled = 0;
  (o.lines || []).forEach(l => {
    if (erpToNum(l.unitPrice) > 0) return;
    const p = erpCOClientPrice(o, l.productId);
    if (p) { l.unitPrice = p; filled++; }
  });
  return filled;
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
      const last = erpCOClientPrice(o, p.id);   // авто-цена по клиент (листа → научено)
      const ple = (typeof erpPriceListEntry === "function") ? erpPriceListEntry(o.clientId, o.clientName, p.id) : null;
      const dispName = (ple && ple.cname) ? ple.cname : p.name;   // клиентско име, ако има в листата
      o.lines.push({ productId: p.id, code: p.code, name: dispName, ourName: p.name, qty: 1, unitPrice: last || "" });
      close(); erpCORefreshLines(o);
    }));
  };
  render("");
  wrap.querySelector("#co-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#co-pp-cancel").addEventListener("click", close);
}

// Изтрива заявката + всичките ѝ задачи по цеховете (само за собственика).
async function erpCODelete(o) {
  if (!o.id) return;
  if (typeof isOwnerAdmin === "function" && !isOwnerAdmin()) { alert("Само собственикът може да трие заявки."); return; }
  if (!confirm(`Да изтрия ли заявка №${o.ourNo || ""}${o.clientName ? " (" + o.clientName + ")" : ""} и всичките ѝ задачи по цеховете?\nТова е необратимо.`)) return;
  try {
    if (typeof erpFlowRemoveOrder === "function") await erpFlowRemoveOrder(o.id);
    else await sb.from("tasks").delete().eq("data->source->>sampleId", String(o.id));
  } catch (e) { alert("Грешка при изтриване на задачите: " + (e.message || e)); return; }
  const delO = await sb.from("customer_orders").delete().eq("id", o.id);
  if (delO.error) { alert("Грешка при изтриване на заявката: " + delO.error.message); return; }
  alert("Заявката и задачите ѝ по цеховете са изтрити.");
  erpRenderCustomerOrders();
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

/* ---------- Пускане в производство (поточно, серии между поръчки) ---------- */
async function erpCOProduce(o) {
  if (!(o.lines || []).length) { alert("Добави поне един продукт."); return; }
  // Първо запазваме, за да има № и id за връзката към задачите.
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

  const lines = (o.lines || []).map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
  let totalSteps = 0, external = [];
  const missMap = {};
  lines.forEach(l => {
    const r = (typeof erpFlowSteps === "function") ? erpFlowSteps({ erpProductId: l.productId, erpQty: l.qty }) : { steps: [], external: [], missing: [] };
    totalSteps += r.steps.length; external = external.concat(r.external);
    (r.missing || []).forEach(m => { const k = m.code || m.name; const c = missMap[k] || (missMap[k] = { code: m.code, name: m.name, qty: 0 }); c.qty += Number(m.qty) || 0; });
  });
  const missList = Object.values(missMap);
  const missTxt = missList.length
    ? `\n\n⚠ ЛИПСВАЩИ ДЕТАЙЛИ (нямат рецепта с операции и не са на склад):\n`
      + missList.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужни ${erpNum(m.qty)} бр.`).join("\n")
      + `\n\nСглобяването на тези изделия НЯМА да се пусне, докато детайлите нямат рецепта или наличност.`
    : "";
  if (!totalSteps) {
    alert(missList.length
      ? `Не мога да пусна — детайлите нямат рецепта с операции и не са на склад.${missTxt}`
      : "Няма операции за пускане (продуктите нямат рецепта с операции).");
    return;
  }

  const already = o.production && o.production.count;
  let msg = `Ще пусна ПОТОЧНО производство за заявка №${o.ourNo} (${lines.length} продукта).\n\n`
    + `Еднакви детайли от различни поръчки се обединяват в СЕРИЯ; всяка операция приема детайлите постепенно, колкото са отчетени в предната.`;
  if (external.length) msg += `\n\n${external.length} външни операции (напр. поцинковане) са за подизпълнител.`;
  msg += missTxt;
  msg += `\n\n📦 Материалите за производството ще се изпишат от склада.`;
  if (already) msg += `\n\n⚠ Вече има пуснато производство. Ще обновя дела на заявката.`;
  if (!confirm(msg)) return;

  const res = await erpFlowApply({
    clientName: o.clientName || "", deadline: o.deadline || "", sampleId: o.id,
    sampleType: "customer_order", orderNo: o.ourNo || "",
  }, lines);
  if (res.error) { alert("Грешка при създаване на задачи: " + (res.error.message || res.error)); return; }

  const fs = res.fromStock || [];
  o.production = { at: new Date().toISOString(), count: res.seriesCount || totalSteps, flow: true, external: external.length, fromStock: fs.length };
  o.status = "в производство";
  // Записваме статуса надеждно (не го гълтаме тихо) — заявката трябва да остане
  // „в производство" без ръчна намеса.
  try { await erpSaveCO(o); }
  catch (e) { alert("⚠ Производството е пуснато, но статусът не се записа: " + (e.message || e) + "\nОтвори заявката пак и натисни 💾 Запази."); }
  try { await erpLoadCustomerOrders(); } catch {}
  const st = document.getElementById("co-status"); if (st) st.value = "в производство";
  const miss = res.missing || [];
  const matShort = res.materialsShort || [];
  alert(`Готово! Пуснах поточно производство.\n`
    + `Всяка операция приема детайлите постепенно, колкото са отчетени в предната.`
    + (fs.length ? `\n\n📦 Взети от склад (не се пускат в цех):\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.`).join("\n") : "")
    + (matShort.length ? `\n\n⚠ НЕДОСТИГ НА МАТЕРИАЛИ (изписани, складът е на минус):\n` + matShort.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужно ${erpNum(m.need)}, налично ${erpNum(m.have)} ${m.unit || ""}`).join("\n") : "")
    + (miss.length ? `\n\n⚠ Сглобяване НЕ е пуснато — липсват детайли без рецепта/наличност:\n` + miss.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: ${erpNum(m.qty)} бр.`).join("\n") : "")
    + (external.length ? `\n\n(${external.length} външни операции са за подизпълнител.)` : ""));
  // Пре-рисуваме цялата форма, за да се появи бутонът „⬅ Изтегли от производство"
  // и проследяването (иначе остават скрити до повторно отваряне на заявката).
  erpRenderCOForm(o);
}

// Изтегля заявката от производство: маха задачите ѝ по цеховете (и връща взетите
// от склад детайли), а заявката става отново „чакаща" (нова). Полезно при тестване.
async function erpCOWithdraw(o) {
  if (!o.id) return;
  if (!confirm(`Да изтегля ли заявка №${o.ourNo || ""} от производство?\n\nЗадачите ѝ по цеховете ще се премахнат и заявката ще стане отново „чакаща". Взетите от склад детайли се връщат.\n\n(Заявката НЕ се трие — остава като чакаща.)`)) return;
  try {
    if (typeof erpFlowRemoveOrder === "function") await erpFlowRemoveOrder(o.id);
    else await sb.from("tasks").delete().eq("data->source->>sampleId", String(o.id));
  } catch (e) { alert("Грешка при изтегляне: " + (e.message || e)); return; }
  o.production = null;
  o.status = "нова";
  try { await erpSaveCO(o); await erpLoadCustomerOrders(); } catch {}
  alert("Заявката е изтеглена от производство и е отново чакаща.");
  erpRenderCOForm(o);
}

/* ---------- Проследяване ---------- */
async function erpCOTracking(o) {
  const box = document.getElementById("co-extra");
  if (!box || !o.id) return;
  box.innerHTML = `<p class="erp-muted">Производство: зареждане на напредъка…</p>`;
  const { rows, error } = (typeof erpFlowTasksFor === "function")
    ? await erpFlowTasksFor(o.id)
    : { rows: [], error: { message: "Липсва поточният модул." } };
  if (error) { box.innerHTML = `<p class="erp-warn">${escapeHtml(error.message || String(error))}</p>`; return; }
  const planned = rows.length;
  const done = rows.filter(r => r.done).length;
  const active = rows.filter(r => !r.done).map(r => r.data || {});
  const pct = planned ? Math.round(done / planned * 100) : 0;
  const activeHtml = active.length
    ? `<div class="erp-prod-active">${active.map(a => `↳ <b>${escapeHtml(a.product || "")}</b> — ${escapeHtml(a.operation || "")} (цех ${escapeHtml(a.workshop || "")}): ${Number(a.produced) || 0}/${Number(a.qty) || 0}${(a.source && a.source.orderIds && a.source.orderIds.length >= 2) ? " · СЕРИЯ" : ""}`).join("<br>")}</div>`
    : (done ? `<div class="erp-prod-active">✓ всички операции са готови</div>` : "");
  box.innerHTML = planned
    ? `<div class="erp-prod-line"><b>Поточно производство:</b> ${done} / ${planned} операции готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button class="btn btn-small" id="co-refresh">↻</button></div>${activeHtml}`
    : `<p class="erp-muted">Няма задачи за тази заявка.</p>`;
  const rb = document.getElementById("co-refresh"); if (rb) rb.addEventListener("click", () => erpCOTracking(o));
}
