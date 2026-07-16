/* Данко Системс — ЕРП „Заявки от клиенти".
   Стандартни поръчки за продукти от каталога: наш № + клиентски №, забележка,
   няколко продукта, разбивка на материалите, пускане в производство (всички
   редове наведнъж) и проследяване. Заявката се пази в customer_orders.data (JSON).
   Ползва ERP/erpDialog/erpBuildTasks/erpToNum/erpNum/erpEur от другите erp-*.js. */

let erpCOList = null;       // заредени заявки
let erpCOSort = "deadline"; // подредба на списъка
let erpCOQuery = "";        // търсене в списъка
let erpCOHideDone = true;   // скрий завършените (по подразбиране)
let erpCOStatusFilter = ""; // филтър по статус
let erpCOClientFilter = ""; // филтър по клиент

// Подрежда/филтрира заявките за списъка.
function erpCOSortRows(rows) {
  const q = (erpCOQuery || "").toLowerCase().trim();
  let out = rows.filter(o => !q || `${o.ourNo || ""} ${o.clientNo || ""} ${o.clientName || ""} ${o.status || ""}`.toLowerCase().includes(q));
  if (erpCOStatusFilter) out = out.filter(o => (o.status || "нова") === erpCOStatusFilter);
  if (erpCOClientFilter) out = out.filter(o => (o.clientName || "") === erpCOClientFilter);
  // Завършените се крият по подразбиране (освен при търсене или изрично избран статус).
  if (erpCOHideDone && !q && !erpCOStatusFilter) out = out.filter(o => (o.status || "нова") !== "завършена");
  const val = o => (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const S = String;
  const cmp = {
    deadline: (a, b) => S(a.deadline || "9999-99-99").localeCompare(S(b.deadline || "9999-99-99")),   // най-скорошен срок отгоре
    client: (a, b) => (a.clientName || "").localeCompare(b.clientName || "", "bg"),
    date: (a, b) => S(b.date || "").localeCompare(S(a.date || "")),                                    // най-нови отгоре
    ourNo: (a, b) => S(a.ourNo || "").localeCompare(S(b.ourNo || ""), "bg", { numeric: true }),
    status: (a, b) => (a.status || "").localeCompare(b.status || "", "bg"),
    value: (a, b) => val(b) - val(a),                                                                   // най-голяма стойност отгоре
  }[erpCOSort] || (() => 0);
  return out.sort(cmp);
}
let erpClientsCache = null; // клиенти от Контакти (за избор)

async function erpLoadCustomerOrders() {
  const { data, error } = await sb.from("customer_orders").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  erpCOList = (data || []).map(r => ({ id: r.id, ...(r.data || {}) }));
  if (typeof erpPLEnsureCache === "function") { try { await erpPLEnsureCache(); } catch (e) {} }   // клиентски ценови листи
}

// Ако цялото производство на заявката е готово → статус „готова за продажба".
// Ползва се и от Мастер отчитане (за да не остане „в производство" след докарване).
async function erpMarkOrderReadyIfDone(orderId) {
  if (!orderId) return false;
  try {
    const co = await sb.from("customer_orders").select("id,data").eq("id", orderId).maybeSingle();
    if (!co || !co.data) return false;   // не е клиентска заявка (мостра/за склад)
    const d = co.data.data || {};
    if (d.status !== "в производство") return false;
    const { rows } = (typeof erpFlowTasksFor === "function") ? await erpFlowTasksFor(orderId) : { rows: [] };
    if (!rows.length) return false;
    const allDone = rows.every(r => { const dd = r.data || {}; const q = Number(dd.qty) || 0, p = Number(dd.produced) || 0; return q > 0 && p >= q; });
    if (!allDone) return false;
    d.status = "готова за продажба";
    await sb.from("customer_orders").update({ data: d, updated_at: new Date().toISOString() }).eq("id", orderId);
    if (typeof erpCOList !== "undefined" && Array.isArray(erpCOList)) { const it = erpCOList.find(x => String(x.id) === String(orderId)); if (it) it.status = d.status; }
    return true;
  } catch (e) { return false; }
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

/* ---------- Файл на заявката (сканирана заявка/PDF/снимка) ---------- */
// Списъкът с прикачени файлове в формата (с връзка за отваряне и бутон за махане).
function erpCOFilesHtml(o) {
  const files = (o && o.files) || [];
  if (!files.length) return `<p class="erp-muted" style="margin:0 0 6px">Няма прикачен файл. Прикачи сканираната заявка (PDF/снимка).</p>`;
  return `<ul class="co-file-ul">${files.map((f, i) => `
    <li><a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener">📄 ${escapeHtml(f.name || "файл")}</a>
      <button type="button" class="btn btn-small btn-danger co-file-rm" data-cofrm="${i}" title="Махни файла">×</button></li>`).join("")}</ul>`;
}

// Клетка за списъка: 📎 връзка към прикачения файл (или „—").
function erpCOFileCell(o) {
  const files = (o && o.files) || [];
  if (!files.length) return "—";
  const f = files[0];
  return `<a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener" class="co-file-link" title="Отвори прикачения файл на заявката">📎${files.length > 1 ? " " + files.length : ""}</a>`;
}

// Качва файл(ове) към заявката. За нова заявка първо я записваме (за да има id).
async function erpCOAttachFiles(o, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const st = document.getElementById("co-file-status");
  if (!o.id) {
    if (st) st.textContent = "Записвам заявката…";
    try { await erpSaveCO(o); } catch (e) { alert("Първо запази заявката (грешка: " + (e.message || e) + ")."); if (st) st.textContent = ""; return; }
  }
  o.files = o.files || [];
  for (const file of files) {
    if (st) st.textContent = "Качвам „" + file.name + "“…";
    const path = `orders/${o.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    o.files.push({ name: file.name, type: file.type, path, url: data.publicUrl });
  }
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис на заявката: " + (e.message || e)); }
  try { await erpLoadCustomerOrders(); } catch (e) {}
  if (st) st.textContent = "";
  const list = document.getElementById("co-files-list");
  if (list) list.innerHTML = erpCOFilesHtml(o);
  const inp = document.getElementById("co-file-input"); if (inp) inp.value = "";
}

// Маха прикачен файл (от склада за файлове и от заявката).
async function erpCORemoveFile(o, i) {
  const f = (o.files || [])[i]; if (!f) return;
  if (!confirm(`Да махна ли файла „${f.name || ""}"?`)) return;
  if (f.path) { try { await sb.storage.from(BUCKET).remove([f.path]); } catch (e) {} }
  o.files.splice(i, 1);
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); }
  try { await erpLoadCustomerOrders(); } catch (e) {}
  const list = document.getElementById("co-files-list");
  if (list) list.innerHTML = erpCOFilesHtml(o);
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
  const rows = erpCOSortRows(erpCOList.slice());
  const sortOpts = [
    ["deadline", "Срок на доставка"], ["client", "Клиент (А→Я)"], ["date", "Дата (нови отгоре)"],
    ["ourNo", "Наш №"], ["status", "Статус"], ["value", "Стойност (голяма отгоре)"],
  ];
  const statusOpts = ["нова", "в производство", "готова за продажба", "завършена"];
  const clientOpts = [...new Set((erpCOList || []).map(o => o.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} заявки</span>
      <input type="search" id="erp-co-q" placeholder="🔎 търси № / клиент / статус…" value="${escapeAttr(erpCOQuery)}" autocomplete="off" style="min-width:190px" />
      <label class="erp-inline">Статус
        <select id="erp-co-fstatus"><option value="">Всички</option>${statusOpts.map(s => `<option ${s === erpCOStatusFilter ? "selected" : ""}>${s}</option>`).join("")}</select>
      </label>
      <label class="erp-inline">Клиент
        <select id="erp-co-fclient"><option value="">Всички</option>${clientOpts.map(c => `<option ${c === erpCOClientFilter ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
      </label>
      <label class="erp-inline">Подреди по
        <select id="erp-co-sort">${sortOpts.map(([k, l]) => `<option value="${k}" ${k === erpCOSort ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="erp-inline" title="Скрива завършените заявки, за да не пълнят списъка"><input type="checkbox" id="erp-co-hidedone" ${erpCOHideDone ? "checked" : ""} /> Скрий завършените${(function () { const n = erpCOList.filter(o => (o.status || "нова") === "завършена").length; return n ? ` (${n})` : ""; })()}</label>
      ${(erpCOStatusFilter || erpCOClientFilter) ? `<button class="btn btn-small" id="erp-co-clearf">✕ Изчисти филтрите</button>` : ""}
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="erp-co-new">+ Нова заявка</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Дата</th><th>Срок</th><th class="num">Продукти</th><th class="num sell-cell">Стойност</th><th>Статус</th><th>Файл</th><th></th></tr></thead>
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
            <td data-label="Файл">${erpCOFileCell(o)}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
          </tr>`).join("") ||
          `<tr><td colspan="10" class="report-empty">Още няма заявки. Натисни „+ Нова заявка".</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("erp-co-new").addEventListener("click", erpNewCO);
  const sortSel = document.getElementById("erp-co-sort");
  if (sortSel) sortSel.addEventListener("change", e => { erpCOSort = e.target.value; erpRenderCustomerOrders(); });
  const fStatus = document.getElementById("erp-co-fstatus");
  if (fStatus) fStatus.addEventListener("change", e => { erpCOStatusFilter = e.target.value; erpRenderCustomerOrders(); });
  const fClient = document.getElementById("erp-co-fclient");
  if (fClient) fClient.addEventListener("change", e => { erpCOClientFilter = e.target.value; erpRenderCustomerOrders(); });
  const clearF = document.getElementById("erp-co-clearf");
  if (clearF) clearF.addEventListener("click", () => { erpCOStatusFilter = ""; erpCOClientFilter = ""; erpRenderCustomerOrders(); });
  const hideDoneEl = document.getElementById("erp-co-hidedone");
  if (hideDoneEl) hideDoneEl.addEventListener("change", e => { erpCOHideDone = e.target.checked; erpRenderCustomerOrders(); });
  const qEl = document.getElementById("erp-co-q");
  if (qEl) qEl.addEventListener("input", e => {
    erpCOQuery = e.target.value;
    // пре-рисуваме само таблицата, за да не губим фокуса на търсачката
    const tb = v.querySelector("table.erp-table tbody");
    if (!tb) { erpRenderCustomerOrders(); return; }
    const list = erpCOSortRows(erpCOList.slice());
    tb.innerHTML = list.map(o => `
      <tr class="erp-clickable" data-id="${o.id}">
        <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
        <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
        <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
        <td data-label="Дата">${escapeHtml(o.date || "")}</td>
        <td data-label="Срок">${escapeHtml(o.deadline || "")}</td>
        <td class="num" data-label="Продукти">${(o.lines || []).length}</td>
        <td class="num sell-cell" data-label="Стойност">${erpEur((o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0))}</td>
        <td data-label="Статус"><span class="erp-co-status s-${escapeAttr(o.status || "нова")}">${escapeHtml(o.status || "нова")}</span></td>
        <td data-label="Файл">${erpCOFileCell(o)}</td>
        <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
      </tr>`).join("") || `<tr><td colspan="10" class="report-empty">Няма съвпадения.</td></tr>`;
    tb.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); erpOpenCO(b.dataset.open); }));
    tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", ev => { if (ev.target.closest("a")) return; erpOpenCO(tr.dataset.id); }));
  });
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenCO(b.dataset.open); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", ev => { if (ev.target.closest("a")) return; erpOpenCO(tr.dataset.id); }));
}

/* ---------- 📚 Архив (изпълнени заявки) ----------
   Тук отиват приключените заявки (продажбата им е осчетоводена). Всяка е
   свързана със своята продажба — която в бъдеще ще стане фактура (счетоводен
   модул). Така заявката и продажбата се пазят на едно място. */
let erpArchiveQuery = "";
async function erpRenderArchive() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpLoadCustomerOrders(); }
  catch (e) { v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя архива</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  const prod = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production);   // без цени/продажби за производство
  let sales = [];
  if (!prod) { try { if (typeof erpLoadSales === "function") await erpLoadSales(); sales = (typeof erpSales !== "undefined" && erpSales) ? erpSales : []; } catch (e) {} }
  const saleByOrder = {};
  sales.forEach(s => { if (s && s.fromOrderId) (saleByOrder[String(s.fromOrderId)] = saleByOrder[String(s.fromOrderId)] || []).push(s); });

  const q = (erpArchiveQuery || "").toLowerCase().trim();
  let done = (erpCOList || []).filter(o => (o.status || "") === "завършена");
  if (q) done = done.filter(o => `${o.ourNo || ""} ${o.clientNo || ""} ${o.clientName || ""}`.toLowerCase().includes(q));
  done.sort((a, b) => String(b.closedAt || b.date || "").localeCompare(String(a.closedAt || a.date || "")));
  const val = o => (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">📚 Архив — ${done.length} изпълнени заявки</span>
      <input type="search" id="erp-arch-q" placeholder="🔎 търси № / клиент…" value="${escapeAttr(erpArchiveQuery)}" style="min-width:210px" autocomplete="off" />
    </div>
    <p class="hint">Тук отиват заявките, чиято продажба е осчетоводена. Продажбите се пазят и ще станат фактури, когато свържем счетоводния модул.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Приключена</th><th class="num">Продукти</th>${prod ? "" : `<th class="num sell-cell">Стойност</th><th>Продажба</th>`}<th></th></tr></thead>
      <tbody>${done.map(o => {
        const ss = saleByOrder[String(o.id)] || [];
        const saleCell = ss.length ? ss.map(s => `<button class="btn btn-small erp-arch-sale" data-sale="${s.id}" title="Отвори продажбата">🧾 №${escapeHtml(s.saleNo || "")}${s.posted ? " ✓" : ""}</button>`).join(" ") : `<span class="erp-muted">няма</span>`;
        return `<tr class="erp-clickable" data-id="${o.id}">
          <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
          <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
          <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
          <td data-label="Приключена">${escapeHtml((o.closedAt || "").slice(0, 10) || o.date || "")}</td>
          <td class="num" data-label="Продукти">${(o.lines || []).length}</td>
          ${prod ? "" : `<td class="num sell-cell" data-label="Стойност">${erpEur(val(o))}</td><td data-label="Продажба">${saleCell}</td>`}
          <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="${prod ? 6 : 8}" class="report-empty">Още няма изпълнени заявки. Появяват се тук, щом осчетоводиш продажбата им.</td></tr>`}</tbody>
    </table>`;

  const qEl = document.getElementById("erp-arch-q");
  if (qEl) qEl.addEventListener("input", e => { erpArchiveQuery = e.target.value; erpRenderArchive(); const el = document.getElementById("erp-arch-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenCO(b.dataset.open); }));
  v.querySelectorAll(".erp-arch-sale").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); if (typeof erpOpenSale === "function") erpOpenSale(b.dataset.sale); }));
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
            ${["нова", "в производство", "готова за продажба", "завършена"].map(s => `<option ${s === (o.status || "нова") ? "selected" : ""}>${s}</option>`).join("")}
          </select></label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="co-note" rows="3" placeholder="специфични изисквания, договорки…">${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">📎 Файл на заявката</h4>
      <div class="erp-co-files">
        <div id="co-files-list">${erpCOFilesHtml(o)}</div>
        <label class="btn btn-small co-attach-btn">⬆ Прикачи файл<input type="file" id="co-file-input" multiple hidden /></label>
        <span class="erp-muted" id="co-file-status"></span>
      </div>

      <h4 class="erp-group-head">Продукти в заявката</h4>
      <table class="report-table erp-table" id="co-lines">
        <thead><tr><th>Код</th><th>Продукт</th><th class="num">Бройка</th><th class="num sell-cell">Прод. цена (€)</th><th class="num sell-cell">Сума</th><th></th></tr></thead>
        <tbody>${erpCOLinesHtml(o)}</tbody>
      </table>
      <div class="erp-co-linebar"><button class="btn btn-small" id="co-add-prod">+ Добави продукт</button><span class="spacer"></span><span class="erp-count sell-cell" id="co-total"></span></div>

      <div class="erp-co-actions">
        <button class="btn btn-small" id="co-materials">🧮 Разбивка на материалите</button>
        <button class="btn btn-small" id="co-test" title="Провери маршрута — дали рецептите ще вървят правилно, преди да пуснеш">🧪 Тест рецепта</button>
        <button class="btn btn-small" id="co-sim" title="Паралелна реалност — прекарва заявката през цеховете с текущите наличности и показва докъде стига и къде спира">🔬 Симулирай производството</button>
        <button class="btn btn-small btn-primary" id="co-produce">🏭 Пусни в производство</button>
        ${o.production ? '<button class="btn btn-small" id="co-live-status" title="Жив статус — докъде е стигнало, къде е спряло и какво чака">📊 Статус на поръчката</button>' : ""}
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
  const fileInput = document.getElementById("co-file-input");
  if (fileInput) fileInput.addEventListener("change", e => erpCOAttachFiles(o, e.target.files));
  const filesList = document.getElementById("co-files-list");
  if (filesList) filesList.addEventListener("click", e => {
    const rm = e.target.closest("[data-cofrm]");
    if (rm) { e.preventDefault(); erpCORemoveFile(o, Number(rm.dataset.cofrm)); }
  });
  document.getElementById("co-add-prod").addEventListener("click", () => erpCOAddProduct(o));
  document.getElementById("co-materials").addEventListener("click", () => erpCOMaterials(o));
  const coTest = document.getElementById("co-test");
  if (coTest) coTest.addEventListener("click", () => {
    const items = (o.lines || []).filter(l => l.productId).map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
    if (!items.length) { alert("Добави поне един продукт от каталога, за да тестваш рецептата."); return; }
    if (typeof erpTestRecipeMulti === "function") erpTestRecipeMulti(items, true, o.ourNo ? ("заявка №" + o.ourNo) : "");
  });
  const coSim = document.getElementById("co-sim");
  if (coSim) coSim.addEventListener("click", () => {
    const items = (o.lines || []).filter(l => l.productId).map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
    if (!items.length) { alert("Добави поне един продукт от каталога, за да симулираш."); return; }
    if (typeof erpSimulateProduction === "function") erpSimulateProduction(items, { title: o.ourNo ? ("заявка №" + o.ourNo) : "", stockTop: true });
  });
  document.getElementById("co-produce").addEventListener("click", () => erpCOProduce(o));
  const stBtn = document.getElementById("co-live-status");
  if (stBtn) stBtn.addEventListener("click", () => {
    if (typeof erpOrderStatus === "function") erpOrderStatus(o.id, o.ourNo ? ("заявка №" + o.ourNo) : (o.clientName || ""), {
      productLines: (o.lines || []).filter(l => l.productId).map(l => ({ pid: l.productId, qty: erpToNum(l.qty) || 1 })),
      stockCover: (o.production && o.production.stockCover) || [],
    });
  });
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
      <td data-label="Продукт">${escapeHtml(l.name || "")}${(function () {
        const del = Number(l.delivered) || 0; if (del <= 0) return "";
        const rem = Math.max(0, (erpToNum(l.qty) || 0) - del);
        return rem > 0
          ? `<div class="erp-co-deliv" title="Доставено при частично фактуриране">📦 доставени ${erpNum(del)} · остават <b>${erpNum(rem)}</b></div>`
          : `<div class="erp-co-deliv erp-co-deliv-full" title="Напълно доставено">✅ доставени ${erpNum(del)} (напълно)</div>`;
      })()}</td>
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
  msg += `\n✅ Щом мине последната операция, готовото изделие влиза в Склад детайли (после се изписва с Продажба).`;
  if (already) msg += `\n\n⚠ Вече има пуснато производство. Ще обновя дела на заявката.`;
  if (!confirm(msg)) return;

  const res = await erpFlowApply({
    clientName: o.clientName || "", deadline: o.deadline || "", sampleId: o.id,
    sampleType: "customer_order", orderNo: o.ourNo || "",
    stockTop: true,   // готовото изделие влиза в Склад детайли при завършване (после се изписва с Продажба)
  }, lines);
  if (res.error) { alert("Грешка при създаване на задачи: " + (res.error.message || res.error)); return; }

  const fs = res.fromStock || [];
  o.production = { at: new Date().toISOString(), count: (res.seriesCount != null ? res.seriesCount : totalSteps), flow: true, external: external.length, fromStock: fs.length, stockCover: fs };
  // Ако всичко е налично от склада (0 операции) — заявката е готова за продажба;
  // иначе е „в производство".
  const readyNow = (res.seriesCount === 0) && !(res.missing || []).length;
  o.status = readyNow ? "готова за продажба" : "в производство";
  // Записваме статуса надеждно (не го гълтаме тихо).
  try { await erpSaveCO(o); }
  catch (e) { alert("⚠ Производството е пуснато, но статусът не се записа: " + (e.message || e) + "\nОтвори заявката пак и натисни 💾 Запази."); }
  try { await erpLoadCustomerOrders(); } catch {}
  const st = document.getElementById("co-status"); if (st) st.value = o.status;
  const miss = res.missing || [];
  const matShort = res.materialsShort || [];
  if ((res.seriesCount === 0) && !miss.length) {
    alert(`✅ Всичко е налично в Склад детайли — няма какво да се произвежда.\n`
      + (fs.length ? `\n📦 Покрито от склад:\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.`).join("\n") + `\n` : "")
      + `\nЗаявката е готова за продажба — натисни „🧾 Създай продажба".`);
    if (typeof erpRenderCOForm === "function") erpRenderCOForm(o);
    return;
  }
  alert(`Готово! Пуснах поточно производство.\n`
    + `Всяка операция приема детайлите постепенно, колкото са отчетени в предната.`
    + (fs.length ? `\n\n📦 Взети от склад (не се пускат в цех):\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.`).join("\n") : "")
    + (matShort.length ? `\n\n⚠ НЯМА ДА СТИГНЕ МАТЕРИАЛ (виж таб „⚠ Липсващи материали"):\n` + matShort.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужно ${erpNum(m.need)}, налично ${erpNum(m.have)} ${m.unit || ""}`).join("\n") : "")
    + (miss.length ? `\n\n⚠ Сглобяване НЕ е пуснато — липсват детайли без рецепта/наличност:\n` + miss.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: ${erpNum(m.qty)} бр.`).join("\n") : "")
    + (external.length ? `\n\n(${external.length} външни операции са за подизпълнител.)` : ""));
  if (typeof erpUpdateMissingBadge === "function") erpUpdateMissingBadge();   // осветяваме таба, ако липсва материал
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
  const allDone = planned > 0 && done === planned;
  const allFromStock = !planned && o.production && Number(o.production.count) === 0;
  // Производството е приключило (или всичко е от склад) → „готова за продажба".
  if ((allDone || allFromStock) && o.status === "в производство") {
    o.status = "готова за продажба";
    try { await erpSaveCO(o); const st = document.getElementById("co-status"); if (st) st.value = o.status; if (typeof erpCOList !== "undefined" && Array.isArray(erpCOList)) { const it = erpCOList.find(x => String(x.id) === String(o.id)); if (it) it.status = o.status; } } catch (e) {}
  }
  box.innerHTML = planned
    ? `<div class="erp-prod-line"><b>Поточно производство:</b> ${done} / ${planned} операции готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button class="btn btn-small" id="co-refresh">↻</button></div>${activeHtml}`
       + (allDone ? `<div class="erp-prod-active" style="color:#047857">✅ Готовото е в Склад детайли (заприходява се автоматично при последната операция). Изпиши го с „🧾 Създай продажба".</div>` : "")
    : (allFromStock
        ? `<div class="erp-prod-active" style="color:#047857"><b>✅ Всичко е налично в Склад детайли</b> — няма какво да се произвежда. Готово за продажба (🧾 Създай продажба).</div>`
        : `<p class="erp-muted">Няма задачи за тази заявка.</p>`);
  const rb = document.getElementById("co-refresh"); if (rb) rb.addEventListener("click", () => erpCOTracking(o));
}
