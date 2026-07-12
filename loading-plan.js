/* Данко Системс — „🚚 План за товарене".
   Седмичен план: избор на клиент, стока, килограми, палети и забележка за всяко
   товарене. Започва от седмица 29 (2026). Данните се пазят в app_config
   (id='loading_plan'), без нужда от нов SQL. Ползва глобалния sb и escapeHtml/escapeAttr. */

let LP_ITEMS = [];        // [{ id, week (понеделник YYYY-MM-DD), client, goods, kg, pallets, note, createdAt }]
let LP_CLIENTS = [];      // имена на клиенти (от partners kind=customer)
let LP_GOODS = [];        // детайли от Склад детайли (за избор на стока) — "код · име"
let LP_MONDAY = null;     // текущо разглеждан понеделник (Date)
let LP_LOADED = false;

// Разпознава детайл/възел (Склад детайли), както в erp-detail-stock.
function lpIsDetail(p) {
  if (p && p.is_semifinished) return true;
  const g = ((p && p.group_name) || "").toLowerCase();
  return g.includes("детайл") || g.includes("възл") || g.includes("полуфабрикат") || g.includes("заготов");
}
async function lpLoadGoods() {
  try {
    const { data } = await sb.from("products").select("id,code,name,is_semifinished,group_name").limit(2000);
    LP_GOODS = (data || []).filter(lpIsDetail)
      .map(p => ((p.code ? p.code + " · " : "") + (p.name || "")).trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "bg"));
  } catch (e) { LP_GOODS = []; }
}

/* ---------- ISO седмици ---------- */
function lpMondayOfISOWeek(year, week) {
  // 4 януари винаги е в седмица 1 (ISO 8601).
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;   // понеделник = 0
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dow);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}
function lpISOWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);   // най-близкия четвъртък
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return { week, year: date.getUTCFullYear() };
}
function lpMondayStr(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function lpFmtDM(d) {
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}`;
}
function lpAddDays(d, n) { const r = new Date(d); r.setUTCDate(d.getUTCDate() + n); return r; }
function lpToNum(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s+/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function lpFmtNum(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toLocaleString("bg-BG");
}

/* ---------- Данни ---------- */
async function lpLoad() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "loading_plan").maybeSingle();
    LP_ITEMS = (data && data.data && Array.isArray(data.data.items)) ? data.data.items : [];
  } catch (e) { console.error("loading load", e); LP_ITEMS = []; }
}
async function lpSave() {
  const { error } = await sb.from("app_config").upsert({ id: "loading_plan", data: { items: LP_ITEMS }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на плана за товарене: " + error.message);
}
async function lpLoadClients() {
  try {
    const { data } = await sb.from("partners").select("id,name").eq("kind", "customer");
    LP_CLIENTS = [...new Set((data || []).map(p => (p.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  } catch (e) { LP_CLIENTS = []; }
}

/* ---------- Отваряне ---------- */
async function openLoadingPlan() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("loading-modal").hidden = false;
  if (!LP_LOADED) {
    await Promise.all([lpLoad(), lpLoadClients(), lpLoadGoods()]);
    LP_LOADED = true;
  }
  if (!LP_MONDAY) LP_MONDAY = lpMondayOfISOWeek(2026, 29);   // започваме от седмица 29
  lpRender();
}
function closeLoadingPlan() { document.getElementById("loading-modal").hidden = true; }

/* Стоките на едно товарене (нов формат: масив lines; съвместимо със стария единичен). */
function lpItemLines(x) {
  if (Array.isArray(x.lines) && x.lines.length) return x.lines;
  if ((x.goods && x.goods !== "") || (x.kg != null && x.kg !== "") || (x.pallets != null && x.pallets !== ""))
    return [{ goods: x.goods || "", kg: x.kg, pallets: x.pallets }];
  return [{ goods: "", kg: "", pallets: "" }];
}
function lpItemKg(x) { return lpItemLines(x).reduce((s, l) => s + lpToNum(l.kg), 0); }
function lpItemPal(x) { return lpItemLines(x).reduce((s, l) => s + lpToNum(l.pallets), 0); }

/* ---------- Рендиране ---------- */
function lpRender() {
  const v = document.getElementById("loading-view");
  if (!v) return;
  const mondayStr = lpMondayStr(LP_MONDAY);
  const wk = lpISOWeek(LP_MONDAY);
  const sunday = lpAddDays(LP_MONDAY, 6);
  const items = LP_ITEMS.filter(x => x.week === mondayStr)
    .sort((a, b) => (a.client || "").localeCompare(b.client || "", "bg") || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const totKg = items.reduce((s, x) => s + lpItemKg(x), 0);
  const totPal = items.reduce((s, x) => s + lpItemPal(x), 0);

  const rowsArr = [];
  items.forEach(x => {
    const lines = lpItemLines(x);
    const n = lines.length;
    lines.forEach((ln, idx) => {
      let tr = `<tr class="lp-erow">`;
      if (idx === 0) tr += `<td data-label="Клиент" rowspan="${n}"><b>${escapeHtml(x.client || "—")}</b>${n > 1 ? ` <span class="lp-muted">(${n} стоки)</span>` : ""}</td>`;
      tr += `<td data-label="Стока">${escapeHtml(ln.goods || "")}</td>
        <td class="num" data-label="Кг">${ln.kg != null && ln.kg !== "" ? lpFmtNum(ln.kg) : "—"}</td>
        <td class="num" data-label="Палети">${ln.pallets != null && ln.pallets !== "" ? lpFmtNum(ln.pallets) : "—"}</td>`;
      if (idx === 0) {
        tr += `<td data-label="Забележка" rowspan="${n}">${escapeHtml(x.note || "")}</td>
          <td class="lp-actions" rowspan="${n}">
            <button class="btn btn-small lp-edit" data-id="${x.id}" title="Редактирай">✎</button>
            <button class="btn btn-small lp-del" data-id="${x.id}" title="Изтрий">×</button>
          </td>`;
      }
      tr += `</tr>`;
      rowsArr.push(tr);
    });
  });
  const rows = rowsArr.join("");

  v.innerHTML = `
    <div class="lp-toolbar">
      <button class="btn btn-small" id="lp-prev">◀ предишна</button>
      <div class="lp-weeklabel">Седмица <b>${wk.week}</b> <span class="lp-muted">· ${lpFmtDM(LP_MONDAY)}–${lpFmtDM(sunday)}.${sunday.getUTCFullYear()}</span></div>
      <button class="btn btn-small" id="lp-next">следваща ▶</button>
      <button class="btn btn-small" id="lp-today" title="Върни се на седмица 29">⌂ Седмица 29</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small btn-primary" id="lp-add">+ Ново товарене</button>
    </div>
    <table class="report-table lp-table">
      <thead><tr><th>Клиент</th><th>Стока</th><th class="num">Кг</th><th class="num">Палети</th><th>Забележка</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="report-empty">Няма товарения за тази седмица. Натисни „+ Ново товарене".</td></tr>`}</tbody>
      ${items.length ? `<tfoot><tr class="lp-total">
        <td>ОБЩО (${items.length} ${items.length === 1 ? "товарене" : "товарения"})</td><td></td>
        <td class="num"><b>${lpFmtNum(totKg)}</b> кг</td>
        <td class="num"><b>${lpFmtNum(totPal)}</b> палети</td>
        <td colspan="2"></td>
      </tr></tfoot>` : ""}
    </table>`;

  v.querySelector("#lp-prev").addEventListener("click", () => { LP_MONDAY = lpAddDays(LP_MONDAY, -7); lpRender(); });
  v.querySelector("#lp-next").addEventListener("click", () => { LP_MONDAY = lpAddDays(LP_MONDAY, 7); lpRender(); });
  v.querySelector("#lp-today").addEventListener("click", () => { LP_MONDAY = lpMondayOfISOWeek(2026, 29); lpRender(); });
  v.querySelector("#lp-add").addEventListener("click", () => lpOpenForm(null));
  v.querySelectorAll(".lp-edit").forEach(b => b.addEventListener("click", () => lpOpenForm(b.dataset.id)));
  v.querySelectorAll(".lp-del").forEach(b => b.addEventListener("click", () => lpDelete(b.dataset.id)));
}

/* ---------- Форма (ново/редакция) — един клиент, много стоки ---------- */
function lpOpenForm(id) {
  const editing = id ? LP_ITEMS.find(x => x.id === id) : null;
  const mondayStr = lpMondayStr(LP_MONDAY);
  const wk = lpISOWeek(LP_MONDAY);
  const initLines = editing ? lpItemLines(editing).map(l => ({ goods: l.goods || "", kg: l.kg, pallets: l.pallets })) : [{ goods: "", kg: "", pallets: "" }];
  const lineRow = ln => `
    <div class="lp-line-row">
      <input type="text" class="lp-l-goods" list="lp-goods-list" value="${escapeAttr(ln.goods || "")}" placeholder="детайл (код/име)…" autocomplete="off" />
      <input type="number" class="lp-l-kg" min="0" step="any" inputmode="decimal" value="${escapeAttr(ln.kg != null ? String(ln.kg) : "")}" placeholder="кг" />
      <input type="number" class="lp-l-pallets" min="0" step="any" inputmode="decimal" value="${escapeAttr(ln.pallets != null ? String(ln.pallets) : "")}" placeholder="палети" />
      <button type="button" class="btn btn-small lp-l-rm" title="Махни стоката">×</button>
    </div>`;
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box lp-form-box">
      <h3>${editing ? "✎ Редакция на товарене" : "+ Ново товарене"} — седмица ${wk.week}</h3>
      <label>Клиент *
        <input type="text" id="lp-client" list="lp-clients" value="${escapeAttr(editing ? (editing.client || "") : "")}" placeholder="избери или въведи" autocomplete="off" />
        <datalist id="lp-clients">${LP_CLIENTS.map(c => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist>
      </label>
      <div class="lp-lines-head"><span>Стоки за товарене (детайл · кг · палети)</span></div>
      <div id="lp-lines">${initLines.map(lineRow).join("")}</div>
      <datalist id="lp-goods-list">${LP_GOODS.map(g => `<option value="${escapeAttr(g)}"></option>`).join("")}</datalist>
      <button type="button" id="lp-addline" class="btn btn-small">+ още стока</button>
      <label>Забележка<textarea id="lp-note" rows="2" placeholder="по желание — напр. час, транспорт, специфики">${escapeHtml(editing ? (editing.note || "") : "")}</textarea></label>
      <div class="ask-actions">
        <button id="lp-save" class="btn btn-primary">${editing ? "Запази" : "Добави"}</button>
        <button id="lp-cancel" class="btn">Отказ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  const linesBox = wrap.querySelector("#lp-lines");
  const wireRm = () => linesBox.querySelectorAll(".lp-l-rm").forEach(b => {
    b.onclick = () => {
      if (linesBox.querySelectorAll(".lp-line-row").length > 1) b.closest(".lp-line-row").remove();
      else b.closest(".lp-line-row").querySelectorAll("input").forEach(i => { i.value = ""; });
    };
  });
  wireRm();
  wrap.querySelector("#lp-addline").addEventListener("click", () => {
    const tmp = document.createElement("div"); tmp.innerHTML = lineRow({ goods: "", kg: "", pallets: "" });
    linesBox.appendChild(tmp.firstElementChild);
    wireRm();
    const last = linesBox.querySelector(".lp-line-row:last-child .lp-l-goods"); if (last) last.focus();
  });
  wrap.querySelector("#lp-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#lp-save").addEventListener("click", async () => {
    const client = wrap.querySelector("#lp-client").value.trim();
    if (!client) { alert("Въведи клиент."); return; }
    const lines = [];
    linesBox.querySelectorAll(".lp-line-row").forEach(row => {
      const goods = row.querySelector(".lp-l-goods").value.trim();
      const kg = row.querySelector(".lp-l-kg").value.trim();
      const pallets = row.querySelector(".lp-l-pallets").value.trim();
      if (goods || kg || pallets) lines.push({ goods, kg, pallets });
    });
    if (!lines.length) { alert("Добави поне една стока."); return; }
    const note = wrap.querySelector("#lp-note").value.trim();
    const btn = wrap.querySelector("#lp-save"); btn.disabled = true; btn.textContent = "Записва…";
    if (editing) {
      editing.client = client; editing.lines = lines; editing.note = note;
      delete editing.goods; delete editing.kg; delete editing.pallets;   // мигриране към новия формат
    } else {
      LP_ITEMS.push({ id: "lp_" + Date.now() + "_" + Math.floor(Math.random() * 1e6), week: mondayStr, client, lines, note, createdAt: new Date().toISOString() });
    }
    await lpSave();
    close();
    lpRender();
  });
  setTimeout(() => { const c = wrap.querySelector("#lp-client"); if (c) c.focus(); }, 50);
}

async function lpDelete(id) {
  const x = LP_ITEMS.find(i => i.id === id);
  if (!x) return;
  if (!confirm(`Да изтрия ли товаренето за „${x.client || ""}"?`)) return;
  LP_ITEMS = LP_ITEMS.filter(i => i.id !== id);
  await lpSave();
  lpRender();
}

/* ================= План материали (поръчани материали от доставчици) ================= */
let MP_ITEMS = [];        // [{ id, supplier, material, qty, unit, orderDate, arrivalDate, note, received, createdAt }]
let MP_SUPPLIERS = [];    // имена на доставчици (partners kind=supplier)
let MP_MATERIALS = [];    // материали ("код · име") от materials
let MP_LOADED = false;

async function mpLoad() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "materials_plan").maybeSingle();
    MP_ITEMS = (data && data.data && Array.isArray(data.data.items)) ? data.data.items : [];
  } catch (e) { console.error("materials load", e); MP_ITEMS = []; }
}
async function mpSave() {
  const { error } = await sb.from("app_config").upsert({ id: "materials_plan", data: { items: MP_ITEMS }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на плана за материали: " + error.message);
}
async function mpLoadRefs() {
  try {
    const { data } = await sb.from("partners").select("name").eq("kind", "supplier");
    MP_SUPPLIERS = [...new Set((data || []).map(p => (p.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  } catch (e) { MP_SUPPLIERS = []; }
  try {
    const { data } = await sb.from("materials").select("code,name").limit(2000);
    MP_MATERIALS = [...new Set((data || []).map(m => ((m.code ? m.code + " · " : "") + (m.name || "")).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  } catch (e) { MP_MATERIALS = []; }
}

async function openMaterialsPlan() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("materials-modal").hidden = false;
  if (!MP_LOADED) { await Promise.all([mpLoad(), mpLoadRefs()]); MP_LOADED = true; }
  mpRender();
}
function closeMaterialsPlan() { document.getElementById("materials-modal").hidden = true; }

function mpFmtDate(s) {
  if (!s) return "—";
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
/* Материалите на една поръчка (нов формат: масив materials; съвместимо със стария единичен). */
function mpItemLines(x) {
  if (Array.isArray(x.materials) && x.materials.length) return x.materials;
  if ((x.material && x.material !== "") || (x.qty != null && x.qty !== "") || (x.unit && x.unit !== ""))
    return [{ material: x.material || "", qty: x.qty, unit: x.unit }];
  return [{ material: "", qty: "", unit: "" }];
}
function mpRender() {
  const v = document.getElementById("materials-view");
  if (!v) return;
  const items = MP_ITEMS.slice().sort((a, b) => {
    if (!!a.received !== !!b.received) return a.received ? 1 : -1;           // получените най-долу
    const da = a.arrivalDate || "9999-12-31", db = b.arrivalDate || "9999-12-31";
    return da.localeCompare(db);                                             // по очаквано пристигане
  });
  const rowsArr = [];
  items.forEach(x => {
    const lines = mpItemLines(x);
    const n = lines.length;
    lines.forEach((ln, idx) => {
      let tr = `<tr class="${x.received ? "mp-received" : ""}">`;
      if (idx === 0) tr += `<td data-label="Доставчик" rowspan="${n}"><b>${escapeHtml(x.supplier || "—")}</b>${n > 1 ? ` <span class="lp-muted">(${n} вида)</span>` : ""}</td>`;
      tr += `<td data-label="Материал">${escapeHtml(ln.material || "")}</td>
        <td class="num" data-label="Кол-во">${ln.qty != null && ln.qty !== "" ? lpFmtNum(ln.qty) : "—"} ${escapeHtml(ln.unit || "")}</td>`;
      if (idx === 0) {
        tr += `<td data-label="Поръчано" rowspan="${n}">${mpFmtDate(x.orderDate)}</td>
          <td data-label="Пристига" rowspan="${n}">${mpFmtDate(x.arrivalDate)}</td>
          <td data-label="Забележка" rowspan="${n}">${escapeHtml(x.note || "")}</td>
          <td class="lp-actions" rowspan="${n}">
            <button class="btn btn-small mp-recv" data-id="${x.id}" title="${x.received ? "Отбележи като чакащо" : "Отбележи като пристигнало"}">${x.received ? "↩" : "✓ прист."}</button>
            <button class="btn btn-small mp-edit" data-id="${x.id}" title="Редактирай">✎</button>
            <button class="btn btn-small mp-del" data-id="${x.id}" title="Изтрий">×</button>
          </td>`;
      }
      tr += `</tr>`;
      rowsArr.push(tr);
    });
  });
  const rows = rowsArr.join("");

  const pending = items.filter(x => !x.received).length;
  v.innerHTML = `
    <div class="lp-toolbar">
      <div class="lp-weeklabel"><b>${items.length}</b> поръчки <span class="lp-muted">· ${pending} чакащи</span></div>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small btn-primary" id="mp-add">+ Нова поръчка материали</button>
    </div>
    <table class="report-table lp-table">
      <thead><tr><th>Доставчик</th><th>Материал</th><th class="num">Кол-во</th><th>Поръчано</th><th>Пристига</th><th>Забележка</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7" class="report-empty">Няма поръчани материали. Натисни „+ Нова поръчка материали".</td></tr>`}</tbody>
    </table>`;

  v.querySelector("#mp-add").addEventListener("click", () => mpOpenForm(null));
  v.querySelectorAll(".mp-edit").forEach(b => b.addEventListener("click", () => mpOpenForm(b.dataset.id)));
  v.querySelectorAll(".mp-del").forEach(b => b.addEventListener("click", () => mpDelete(b.dataset.id)));
  v.querySelectorAll(".mp-recv").forEach(b => b.addEventListener("click", () => mpToggleReceived(b.dataset.id)));
}

function mpOpenForm(id) {
  const editing = id ? MP_ITEMS.find(x => x.id === id) : null;
  const initLines = editing ? mpItemLines(editing).map(l => ({ material: l.material || "", qty: l.qty, unit: l.unit })) : [{ material: "", qty: "", unit: "" }];
  const lineRow = ln => `
    <div class="lp-line-row">
      <input type="text" class="mp-l-material" list="mp-materials" value="${escapeAttr(ln.material || "")}" placeholder="материал (код/име)…" autocomplete="off" />
      <input type="number" class="mp-l-qty" min="0" step="any" inputmode="decimal" value="${escapeAttr(ln.qty != null ? String(ln.qty) : "")}" placeholder="кол-во" />
      <input type="text" class="mp-l-unit" value="${escapeAttr(ln.unit || "")}" placeholder="мярка" />
      <button type="button" class="btn btn-small lp-l-rm" title="Махни материала">×</button>
    </div>`;
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box lp-form-box">
      <h3>${editing ? "✎ Редакция на поръчка материали" : "+ Нова поръчка материали"}</h3>
      <label>Доставчик *
        <input type="text" id="mp-supplier" list="mp-suppliers" value="${escapeAttr(editing ? (editing.supplier || "") : "")}" placeholder="избери или въведи" autocomplete="off" />
        <datalist id="mp-suppliers">${MP_SUPPLIERS.map(c => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist>
      </label>
      <div class="lp-lines-head"><span>Материали (материал · кол-во · мярка)</span></div>
      <div id="mp-lines">${initLines.map(lineRow).join("")}</div>
      <datalist id="mp-materials">${MP_MATERIALS.map(c => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist>
      <button type="button" id="mp-addline" class="btn btn-small">+ още материал</button>
      <div class="lp-form-row">
        <label>Дата на поръчка<input type="date" id="mp-order" value="${escapeAttr(editing ? (editing.orderDate || "") : "")}" /></label>
        <label>Очаквано пристигане<input type="date" id="mp-arrival" value="${escapeAttr(editing ? (editing.arrivalDate || "") : "")}" /></label>
      </div>
      <label>Забележка<textarea id="mp-note" rows="2" placeholder="по желание">${escapeHtml(editing ? (editing.note || "") : "")}</textarea></label>
      <div class="ask-actions">
        <button id="mp-save" class="btn btn-primary">${editing ? "Запази" : "Добави"}</button>
        <button id="mp-cancel" class="btn">Отказ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  const linesBox = wrap.querySelector("#mp-lines");
  const wireRm = () => linesBox.querySelectorAll(".lp-l-rm").forEach(b => {
    b.onclick = () => {
      if (linesBox.querySelectorAll(".lp-line-row").length > 1) b.closest(".lp-line-row").remove();
      else b.closest(".lp-line-row").querySelectorAll("input").forEach(i => { i.value = ""; });
    };
  });
  wireRm();
  wrap.querySelector("#mp-addline").addEventListener("click", () => {
    const tmp = document.createElement("div"); tmp.innerHTML = lineRow({ material: "", qty: "", unit: "" });
    linesBox.appendChild(tmp.firstElementChild);
    wireRm();
    const last = linesBox.querySelector(".lp-line-row:last-child .mp-l-material"); if (last) last.focus();
  });
  wrap.querySelector("#mp-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#mp-save").addEventListener("click", async () => {
    const supplier = wrap.querySelector("#mp-supplier").value.trim();
    if (!supplier) { alert("Въведи доставчик."); return; }
    const materials = [];
    linesBox.querySelectorAll(".lp-line-row").forEach(row => {
      const material = row.querySelector(".mp-l-material").value.trim();
      const qty = row.querySelector(".mp-l-qty").value.trim();
      const unit = row.querySelector(".mp-l-unit").value.trim();
      if (material || qty || unit) materials.push({ material, qty, unit });
    });
    if (!materials.length) { alert("Добави поне един материал."); return; }
    const rec = {
      supplier, materials,
      orderDate: wrap.querySelector("#mp-order").value,
      arrivalDate: wrap.querySelector("#mp-arrival").value,
      note: wrap.querySelector("#mp-note").value.trim(),
    };
    const btn = wrap.querySelector("#mp-save"); btn.disabled = true; btn.textContent = "Записва…";
    if (editing) {
      Object.assign(editing, rec);
      delete editing.material; delete editing.qty; delete editing.unit;   // мигриране към новия формат
    } else {
      MP_ITEMS.push(Object.assign({ id: "mp_" + Date.now() + "_" + Math.floor(Math.random() * 1e6), received: false, createdAt: new Date().toISOString() }, rec));
    }
    await mpSave();
    close();
    mpRender();
  });
  setTimeout(() => { const s = wrap.querySelector("#mp-supplier"); if (s) s.focus(); }, 50);
}

async function mpToggleReceived(id) {
  const x = MP_ITEMS.find(i => i.id === id);
  if (!x) return;
  x.received = !x.received;
  await mpSave();
  mpRender();
}
async function mpDelete(id) {
  const x = MP_ITEMS.find(i => i.id === id);
  if (!x) return;
  if (!confirm(`Да изтрия ли поръчката от „${x.supplier || ""}" (${mpItemLines(x).length} вида материал)?`)) return;
  MP_ITEMS = MP_ITEMS.filter(i => i.id !== id);
  await mpSave();
  mpRender();
}

/* ---------- Инициализация ---------- */
function lpInit() {
  const btn = document.getElementById("btn-loading");
  if (btn && !btn._lpWired) { btn._lpWired = true; btn.addEventListener("click", openLoadingPlan); }
  const cl = document.getElementById("loading-close");
  if (cl && !cl._lpWired) { cl._lpWired = true; cl.addEventListener("click", closeLoadingPlan); }
  const mb = document.getElementById("btn-materials");
  if (mb && !mb._lpWired) { mb._lpWired = true; mb.addEventListener("click", openMaterialsPlan); }
  const mc = document.getElementById("materials-close");
  if (mc && !mc._lpWired) { mc._lpWired = true; mc.addEventListener("click", closeMaterialsPlan); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lpInit);
else lpInit();
