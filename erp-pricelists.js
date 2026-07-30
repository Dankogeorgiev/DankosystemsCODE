/* Данко Системс — Ценови листи по клиенти.
   Всеки клиент има собствена листа: наш продукт -> как го нарича клиентът + цена.
   Пази се в app_config (id=pricelist_<clientId>), без нов SQL.
   Ползва се за авто-цена и клиентско име при „Заявки от клиенти". */

let PL_CLIENT = null;     // { id, company } — избраният клиент
let PL_ENTRIES = null;    // { [productId]: { cname, price, currency } }
let PL_CACHE = null;      // clientId -> data (за интеграция в заявките)
let PL_TERM = "";

/* ---------- Съхранение ---------- */
async function erpPLLoad(clientId) {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "pricelist_" + clientId).maybeSingle(); return (data && data.data) || null; }
  catch (e) { return null; }
}
async function erpPLSave(clientId, clientName, entries) {
  const { error } = await sb.from("app_config").upsert({ id: "pricelist_" + clientId, data: { clientId, clientName, entries }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  PL_CACHE = null;   // да се презареди кешът при следваща заявка
  return true;
}
async function erpPLAllRows() {
  try { const { data } = await sb.from("app_config").select("id,data").like("id", "pricelist_%"); return data || []; }
  catch (e) { return []; }
}
async function erpPLEnsureCache() {
  if (PL_CACHE) return PL_CACHE;
  PL_CACHE = {};
  const rows = await erpPLAllRows();
  rows.forEach(r => { const d = r.data || {}; if (d.clientId != null) PL_CACHE[String(d.clientId)] = d; });
  return PL_CACHE;
}
// Интеграция: намира записа за клиент+продукт (по id, после по име).
function erpPriceListEntry(clientId, clientName, productId) {
  if (!PL_CACHE) return null;
  let d = (clientId != null) ? PL_CACHE[String(clientId)] : null;
  if (!d && clientName) { const n = String(clientName).trim().toLowerCase(); d = Object.values(PL_CACHE).find(x => String(x.clientName || "").trim().toLowerCase() === n); }
  if (!d || !d.entries) return null;
  return d.entries[String(productId)] || d.entries[productId] || null;
}

/* ---------- Авто-попълване от издадените фактури ----------
   Всяка ИЗДАДЕНА фактура (обикновена/дебитно; проформите и кредитните не)
   обновява ценовата листа на клиента: продукт → последната фактурирана цена
   (+ клиентският код от реда, ако листата няма клиентско име). Ръчно
   въведените клиентски имена НЕ се пипат — само цената се опреснява. */
function erpPLLineProductId(l) {
  if (l && l.productId) return String(l.productId);
  if (l && l.code && typeof ERP !== "undefined" && (ERP.products || []).length) {
    const p = ERP.products.find(x => String(x.code || "") === String(l.code).trim());
    if (p) return String(p.id);
  }
  return null;
}
// Слива редовете на една фактура в entries; връща броя реални промени.
function erpPLMergeInvoice(entries, o) {
  let changed = 0;
  const cur = o.currency || "EUR";
  (o.lines || []).forEach(l => {
    const price = erpToNum(l.unitPrice) || 0;
    if (!(price > 0)) return;
    const pid = erpPLLineProductId(l);
    if (!pid) return;
    const e = entries[pid] || {};
    const ne = { cname: e.cname || l.clientCode || "", price, currency: cur };
    if (!entries[pid] || Number(e.price) !== price || (e.currency || "EUR") !== cur || (e.cname || "") !== ne.cname) changed++;
    entries[pid] = ne;
  });
  return changed;
}
function erpPLInvClient(o, clients) {
  if (o.clientId != null) { const c = clients.find(x => String(x.id) === String(o.clientId)); if (c) return c; }
  const nm = String((o.client && o.client.name) || "").trim().toLowerCase();
  return nm ? clients.find(x => String(x.company || "").trim().toLowerCase() === nm) || null : null;
}
// Кука при издаване на фактура (вика се от erpInvIssue).
async function erpPLApplyInvoice(o) {
  if (!o || !o.docNo || o.kind === "proforma" || o.kind === "credit" || !(o.lines || []).length) return;
  const clients = await erpLoadClients();
  const c = erpPLInvClient(o, clients);
  if (!c) return;
  const d = await erpPLLoad(c.id);
  const entries = (d && d.entries) || {};
  if (erpPLMergeInvoice(entries, o) > 0) await erpPLSave(c.id, c.company, entries);
}
/* Първоначално зареждане: минава ВСИЧКИ вече издадени фактури хронологично
   (по-новата цена печели) и попълва листите. Идемпотентно — може да се пуска
   многократно; пуска се само веднъж автоматично (маркер pricelist_backfill). */
async function erpPLBackfillFromInvoices(statusEl) {
  const say = t => { if (statusEl) statusEl.textContent = t; };
  try { await erpEnsureLoaded(); } catch (e) {}
  if (typeof erpInvoices === "undefined" || !erpInvoices) { try { await erpLoadInvoices(); } catch (e) { return null; } }
  const clients = await erpLoadClients();
  const inv = (erpInvoices || [])
    .filter(o => o.docNo && o.kind !== "proforma" && o.kind !== "credit" && (o.lines || []).length)
    .sort((a, b) => String(a.issueDate || a.date || "").localeCompare(String(b.issueDate || b.date || "")));
  const byClient = {};
  inv.forEach(o => { const c = erpPLInvClient(o, clients); if (c) (byClient[c.id] = byClient[c.id] || { c, list: [] }).list.push(o); });
  let clientsTouched = 0, entriesSet = 0, invUsed = 0;
  const keys = Object.keys(byClient);
  for (let i = 0; i < keys.length; i++) {
    const { c, list } = byClient[keys[i]];
    say(`Зареждам цените от фактурите… ${i + 1}/${keys.length} (${c.company})`);
    const d = await erpPLLoad(c.id);
    const entries = (d && d.entries) || {};
    let changed = 0;
    list.forEach(o => { changed += erpPLMergeInvoice(entries, o); invUsed++; });
    if (changed) { const ok = await erpPLSave(c.id, c.company, entries); if (ok) { clientsTouched++; entriesSet += changed; } }
  }
  return { clientsTouched, entriesSet, invUsed, clientsAll: keys.length };
}

/* ---------- Екран ---------- */
async function erpRenderPriceLists() {
  try { await erpEnsureLoaded(); }
  catch (e) { erpView().innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  const clients = await erpLoadClients();
  const v = erpView();
  v.innerHTML = `
    <div class="erp-head-row"><h3 class="erp-h">💲 Ценови листи по клиенти</h3></div>
    <p class="hint">Всеки клиент има своя листа: за всеки наш продукт — <b>как го нарича клиентът</b> и <b>на каква цена</b>.
      Използва се автоматично при „Заявки от клиенти" (попълва цена и клиентско име).</p>
    <div class="erp-toolbar">
      <label class="erp-inline">Клиент
        <input type="text" id="pl-client" list="pl-clients" placeholder="избери клиент" value="${escapeAttr(PL_CLIENT ? PL_CLIENT.company : "")}" autocomplete="off" />
        <datalist id="pl-clients">${clients.map(c => `<option value="${escapeAttr(c.company || "")}"></option>`).join("")}</datalist>
      </label>
      <button class="btn btn-small" id="pl-frominv" title="Минава всички издадени фактури и опреснява цените по клиенти (по-новата фактура печели). Клиентските имена не се пипат.">⟳ Обнови от фактурите</button>
      <span id="pl-status" class="erp-muted"></span>
    </div>
    <div id="pl-clientlist" class="hint" style="line-height:2"></div>
    <div id="pl-body"></div>`;
  const ci = v.querySelector("#pl-client");
  ci.addEventListener("change", () => erpPLPickClient(ci.value, clients));
  ci.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); erpPLPickClient(ci.value, clients); } });
  // Списъкът на клиентите, за които ВЕЧЕ има цени — клик отваря листата им.
  const renderClientList = async () => {
    const host = v.querySelector("#pl-clientlist"); if (!host) return;
    const rows = await erpPLAllRows();
    const items = rows.map(r => (r.data || {}))
      .map(d => ({ name: d.clientName || "", n: Object.keys(d.entries || {}).length }))
      .filter(x => x.name && x.n > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "bg"));
    host.innerHTML = items.length
      ? `📋 <b>Клиенти с готови цени (${items.length}):</b> ` + items.map(x => `<button type="button" class="btn btn-small" data-plc="${escapeAttr(x.name)}" title="${x.n} продукта с цена — клик отваря листата">${escapeHtml(x.name)} <span class="erp-muted">(${x.n})</span></button>`).join(" ")
      : `<span class="erp-muted">Още няма клиенти с попълнени цени — натисни „⟳ Обнови от фактурите".</span>`;
    host.querySelectorAll("[data-plc]").forEach(b => b.addEventListener("click", () => {
      ci.value = b.dataset.plc;
      erpPLPickClient(b.dataset.plc, clients);
    }));
  };
  renderClientList();
  const runBackfill = async () => {
    const st = document.getElementById("pl-status");
    const btn = document.getElementById("pl-frominv"); if (btn) btn.disabled = true;
    const r = await erpPLBackfillFromInvoices(st);
    if (btn) btn.disabled = false;
    if (st) st.textContent = r ? `✓ От ${r.invUsed} фактури: ${r.entriesSet} цени обновени при ${r.clientsTouched} клиенти.` : "⚠ Фактурите не се заредиха.";
    if (PL_CLIENT) { const d = await erpPLLoad(PL_CLIENT.id); PL_ENTRIES = (d && d.entries) || {}; erpPLRenderGrid(); }
    renderClientList();
    return r;
  };
  v.querySelector("#pl-frominv").addEventListener("click", runBackfill);
  if (PL_CLIENT && PL_ENTRIES) erpPLRenderGrid();
  else v.querySelector("#pl-body").innerHTML = `<p class="report-empty">Избери клиент, за да видиш/съставиш неговата ценова листа.</p>`;
  // ЕДНОКРАТНО: първото отваряне зарежда листите от вече издадените фактури.
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "pricelist_backfill").maybeSingle();
    if (!(data && data.data && data.data.done)) {
      const r = await runBackfill();
      if (r) await sb.from("app_config").upsert({ id: "pricelist_backfill", data: { done: true, at: new Date().toISOString(), ...r }, updated_at: new Date().toISOString() });
    }
  } catch (e) { /* при грешка ще опита при следващо отваряне */ }
}

async function erpPLPickClient(name, clients) {
  clients = clients || await erpLoadClients();
  const c = (clients || []).find(x => (x.company || "") === name);
  const st = document.getElementById("pl-status");
  if (!c) { if (st) st.textContent = name ? "Няма такъв клиент в Клиенти/Доставчици." : ""; return; }
  if (st) st.textContent = "Зареждане…";
  PL_CLIENT = c;
  const d = await erpPLLoad(c.id);
  PL_ENTRIES = (d && d.entries) || {};
  if (st) st.textContent = "";
  erpPLRenderGrid();
}

// Прочита текущите редакции от таблицата в PL_ENTRIES (за да не се губят при пре-рисуване).
function erpPLCollect() {
  const host = document.getElementById("pl-body");
  if (!host || !PL_ENTRIES) return;
  host.querySelectorAll("tr[data-pid]").forEach(tr => {
    const pid = tr.getAttribute("data-pid");
    const cname = tr.querySelector(".pl-cn").value.trim();
    const price = erpToNum(tr.querySelector(".pl-pr").value) || 0;
    const currency = tr.querySelector(".pl-cur").value;
    PL_ENTRIES[pid] = { cname, price, currency };
  });
}

function erpPLRenderGrid() {
  const host = document.getElementById("pl-body");
  if (!host || !PL_CLIENT) return;
  const all = Object.keys(PL_ENTRIES).map(pid => {
    const p = ERP.prodById[pid] || ERP.prodById[Number(pid)] || {};
    const e = PL_ENTRIES[pid] || {};
    return { pid, code: p.code || "", ourName: p.name || ("#" + pid), cname: e.cname || "", price: e.price || "", currency: e.currency || "EUR" };
  });
  let list = all;
  if (PL_TERM) { const q = PL_TERM.toLowerCase(); list = all.filter(r => (r.code + " " + r.ourName + " " + r.cname).toLowerCase().includes(q)); }
  list.sort((a, b) => (a.ourName || "").localeCompare(b.ourName || "", "bg"));

  host.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="pl-q" placeholder="търси в листата…" value="${escapeAttr(PL_TERM)}" autocomplete="off" />
      <button class="btn btn-small" id="pl-add">+ Добави продукт</button>
      <span class="erp-count">${all.length} продукта за <b>${escapeHtml(PL_CLIENT.company || "")}</b></span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="pl-export">⤓ Excel</button>
      <label class="btn btn-small" for="pl-import">⤴ Импортирай</label>
      <input type="file" id="pl-import" accept=".xlsx,.xls,.csv" hidden />
      <button class="btn btn-small btn-primary" id="pl-save">💾 Запази листата</button>
      <span class="save-status" id="pl-save-st"></span>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Наш продукт</th><th>Име при клиента</th><th class="num">Цена</th><th>Валута</th><th></th></tr></thead>
      <tbody>${list.map(r => `
        <tr data-pid="${escapeAttr(r.pid)}">
          <td data-label="Код"><b>${escapeHtml(r.code)}</b></td>
          <td data-label="Наш продукт">${escapeHtml(r.ourName)}</td>
          <td data-label="Име при клиента"><input type="text" class="pl-cn" value="${escapeAttr(r.cname)}" placeholder="как го нарича клиентът" /></td>
          <td class="num" data-label="Цена"><input type="number" class="pl-pr" step="any" min="0" value="${r.price !== "" ? escapeAttr(String(r.price)) : ""}" style="width:100px" /></td>
          <td data-label="Валута"><select class="pl-cur"><option ${r.currency === "EUR" ? "selected" : ""}>EUR</option><option ${r.currency === "BGN" ? "selected" : ""}>BGN</option></select></td>
          <td><button class="btn btn-small pl-rm" title="Махни от листата">×</button></td>
        </tr>`).join("") || `<tr><td colspan="6" class="report-empty">Няма продукти в листата. Добави с „+ Добави продукт" или импортирай Excel.</td></tr>`}
      </tbody>
    </table>
    <p class="hint">За наливане наведнъж: свали Excel, попълни „Име при клиента" и „Цена", после импортирай (съвпадение по Код).</p>`;

  host.querySelector("#pl-q").addEventListener("input", e => { erpPLCollect(); PL_TERM = e.target.value; erpPLRenderGrid(); const q = document.getElementById("pl-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } });
  host.querySelector("#pl-add").addEventListener("click", () => { erpPLCollect(); erpPLAddProduct(); });
  host.querySelectorAll(".pl-rm").forEach(b => b.addEventListener("click", () => {
    erpPLCollect();
    const pid = b.closest("tr").getAttribute("data-pid");
    delete PL_ENTRIES[pid];
    erpPLRenderGrid();
  }));
  host.querySelector("#pl-export").addEventListener("click", erpPLExport);
  host.querySelector("#pl-import").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) erpPLImport(f); });
  host.querySelector("#pl-save").addEventListener("click", async () => {
    erpPLCollect();
    const st = document.getElementById("pl-save-st"); if (st) st.textContent = "Записва…";
    const ok = await erpPLSave(PL_CLIENT.id, PL_CLIENT.company, PL_ENTRIES);
    if (st) { st.textContent = ok ? "✓ Записано" : ""; setTimeout(() => { if (st) st.textContent = ""; }, 1500); }
  });
}

function erpPLAddProduct() {
  const { wrap, close } = erpDialog(`
    <h3>Добави продукт в листата</h3>
    <input type="search" id="pl-pp-q" placeholder="търси код или име…" autocomplete="off" />
    <div id="pl-pp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="pl-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#pl-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.slice();
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(p =>
      `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} ${PL_ENTRIES[p.id] || PL_ENTRIES[String(p.id)] ? '<span class="erp-muted">· вече в листата</span>' : ""}</button>`).join("")
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const p = ERP.prodById[Number(b.dataset.id)];
      if (!PL_ENTRIES[p.id] && !PL_ENTRIES[String(p.id)]) PL_ENTRIES[p.id] = { cname: "", price: 0, currency: "EUR" };
      close(); erpPLRenderGrid();
    }));
  };
  render("");
  wrap.querySelector("#pl-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#pl-pp-cancel").addEventListener("click", close);
}

/* ---------- Excel ---------- */
function erpPLExport() {
  if (typeof XLSX === "undefined") { alert("Excel библиотеката не е заредена."); return; }
  erpPLCollect();
  const HEAD = ["Код", "Наш продукт", "Име при клиента", "Цена", "Валута"];
  const rows = Object.keys(PL_ENTRIES).map(pid => {
    const p = ERP.prodById[pid] || ERP.prodById[Number(pid)] || {};
    const e = PL_ENTRIES[pid] || {};
    return { "Код": p.code || "", "Наш продукт": p.name || "", "Име при клиента": e.cname || "", "Цена": e.price || 0, "Валута": e.currency || "EUR" };
  }).sort((a, b) => (a["Наш продукт"] || "").localeCompare(b["Наш продукт"] || "", "bg"));
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEAD });
  ws["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 36 }, { wch: 10 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ценова листа");
  XLSX.writeFile(wb, `cenova-lista-${(PL_CLIENT.company || "клиент").replace(/[^\wа-яА-Я -]/g, "").slice(0, 40)}.xlsx`);
}

async function erpPLImport(file) {
  if (typeof XLSX === "undefined") { alert("Excel библиотеката не е заредена."); return; }
  let rows;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  } catch (e) { alert("Не мога да прочета файла: " + (e.message || e)); return; }
  if (!rows.length) { alert("Файлът е празен."); return; }
  const keys = Object.keys(rows[0]);
  const find = subs => keys.find(k => subs.some(s => k.toLowerCase().includes(s)));
  const codeKey = find(["код"]);
  const cnameKey = find(["име при клиента", "клиентско", "име на клиента"]) || find(["име"]);
  const priceKey = find(["цена", "price"]);
  const curKey = find(["валута", "currency"]);
  if (!codeKey) { alert("Не намирам колона Код. Ползвай сваления шаблон."); return; }

  const byCode = {};
  ERP.products.forEach(p => { if (p.code) byCode[String(p.code).trim().toLowerCase()] = p; });
  let set = 0; const unknown = [];
  rows.forEach(r => {
    const code = String(r[codeKey] || "").trim().toLowerCase();
    if (!code) return;
    const p = byCode[code];
    if (!p) { unknown.push(r[codeKey]); return; }
    const cname = cnameKey ? String(r[cnameKey] || "").trim() : "";
    const price = priceKey ? erpToNum(r[priceKey]) || 0 : 0;
    const currency = curKey ? (String(r[curKey] || "").toUpperCase().includes("BGN") ? "BGN" : "EUR") : "EUR";
    if (!cname && !(price > 0)) return;
    PL_ENTRIES[p.id] = { cname, price, currency };
    set++;
  });
  if (!set) { alert("Няма разпознати редове (провери колоната Код)." + (unknown.length ? "\nНенамерени: " + unknown.slice(0, 15).join(", ") : "")); return; }
  const ok = await erpPLSave(PL_CLIENT.id, PL_CLIENT.company, PL_ENTRIES);
  erpPLRenderGrid();
  alert(`Готово! Записани ${set} реда в листата на ${PL_CLIENT.company}.` + (unknown.length ? `\nНенамерени по код: ${unknown.length}` : "") + (ok ? "" : "\n⚠ Запис в базата не мина."));
}
