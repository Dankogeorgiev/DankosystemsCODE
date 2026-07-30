/* Данко Системс — ЕРП „Опаковки".
   Как се опакова всяко изделие за всеки клиент. Едно и също изделие може да се
   опакова различно за различни клиенти → ключ = наш код + клиент.
   Полета: наш код · клиент · име на продукта според клиента (или № чертеж) ·
   кг за брой · кг за кашон · брой кашони на палет · допълнителни аксесоари.
   Оттук се черпи информацията за Придружаващите документи (Packing List,
   Стокова разписка, Палет опис, транспорт/палети) — виж erpDocLineKg/erpDocAutoRows.
   Пази се в app_config id="packaging": { list:[ {...} ] }.
   Ползва ERP/erpView/erpDialog/escapeHtml/escapeAttr, глобалния sb, erpLoadClients. */

let PACKAGING = null;
let packQuery = "";

async function erpPackLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "packaging").maybeSingle(); PACKAGING = (data && data.data && data.data.list) || []; }
  catch (e) { PACKAGING = []; }
}
async function erpPackSave() {
  const { error } = await sb.from("app_config").upsert({ id: "packaging", data: { list: PACKAGING || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message + (/row-level security|violates/i.test(error.message || "") ? "\n\nПусни app-config-rls-fix.sql в Supabase." : "")); return false; }
  return true;
}
function packNextId() { let m = 0; (PACKAGING || []).forEach(p => { const n = Number(p.id) || 0; if (n > m) m = n; }); return m + 1; }
function packNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function packNorm(s) { return String(s || "").trim().toLowerCase(); }

/* ---------- Търсене на опаковка (ключ: наш код + клиент) ----------
   Първо точно (код + клиент); ако няма — общ запис за кода (без клиент);
   ако и той липсва — единствен запис за кода (ако е само един). Връща spec или null. */
function erpPackFind(code, clientName) {
  if (!PACKAGING || !code) return null;
  const c = packNorm(code), cl = packNorm(clientName);
  let hit = PACKAGING.find(p => packNorm(p.code) === c && packNorm(p.clientName) === cl && cl);
  if (hit) return hit;
  hit = PACKAGING.find(p => packNorm(p.code) === c && !packNorm(p.clientName));
  if (hit) return hit;
  const all = PACKAGING.filter(p => packNorm(p.code) === c);
  return all.length === 1 ? all[0] : null;
}

/* ---------- Списък ---------- */
async function erpRenderPackaging() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await erpPackLoad();
  // Заявките — за секцията „Заявки за опаковане" (Опаковъчната верига).
  try { if ((typeof erpCOList === "undefined" || !erpCOList) && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  let clients = [];
  try { if (typeof erpLoadClients === "function") clients = await erpLoadClients(); } catch (e) {}
  const clientNames = clients.map(c => c.company).filter(Boolean);
  v.innerHTML = `
    <div id="pack-orders-box">${packOrdersListHtml()}</div>
    <div class="erp-toolbar">
      <span class="erp-count" id="pack-count"></span>
      <input type="search" id="pack-q" placeholder="🔎 код / клиент / име…" value="${escapeAttr(packQuery)}" style="min-width:220px" autocomplete="off" />
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pack-new">+ Нова опаковка</button>
    </div>
    <p class="hint">Как се опакова всяко изделие <b>за всеки клиент</b>. Оттук Придружаващите документи (Packing List, Стокова разписка, Палет опис) вземат теглото на брой, кашоните и палетите. Едно изделие може да има различна опаковка за различни клиенти.</p>
    <table class="report-table erp-table">
      <thead><tr>
        <th>Наш код</th><th>Клиент</th><th>Име по клиента / № чертеж</th><th>Вид кашон</th><th>Размер кашон</th>
        <th class="num">кг/брой</th><th class="num">кг/кашон</th><th class="num">кашони/палет</th>
        <th>Аксесоари на палета</th><th></th>
      </tr></thead>
      <tbody id="pack-tbody"></tbody>
    </table>
    <datalist id="pack-codes">${(typeof ERP !== "undefined" && ERP.products ? ERP.products : []).slice(0, 4000).map(p => `<option value="${escapeAttr(p.code || "")}">${escapeAttr(p.name || "")}</option>`).join("")}</datalist>
    <datalist id="pack-clients">${clientNames.map(n => `<option value="${escapeAttr(n)}"></option>`).join("")}</datalist>`;
  const qEl = document.getElementById("pack-q");
  if (qEl) qEl.addEventListener("input", e => { packQuery = e.target.value; erpPackFillRows(); });
  document.getElementById("pack-new").addEventListener("click", () => erpPackForm(null));
  // Опаковъчната верига: папки по клиент + отваряне в опаковъчния изглед.
  packOrdersWire();
  erpPackFillRows();
}
// Пълни само тялото (търсене в паметта — без нова заявка).
function erpPackFillRows() {
  const tb = document.getElementById("pack-tbody"); if (!tb) return;
  const q = packNorm(packQuery);
  let rows = (PACKAGING || []).filter(p => !q || `${p.code || ""} ${p.clientName || ""} ${p.clientProductName || ""}`.toLowerCase().includes(q));
  rows.sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "bg") || String(a.clientName || "").localeCompare(String(b.clientName || ""), "bg"));
  const cnt = document.getElementById("pack-count"); if (cnt) cnt.textContent = rows.length + " опаковки";
  const n = v => (v === "" || v == null) ? "" : (typeof erpNum === "function" ? erpNum(v) : v);
  tb.innerHTML = rows.map(p => `<tr class="erp-clickable" data-id="${p.id}">
    <td data-label="Наш код">${p.code ? `<b>${escapeHtml(p.code)}</b>` : '<span class="pack-nocode" title="Записът чака да се попълни нашият код — дотогава не влиза в придружаващите документи">⚠ без код</span>'}</td>
    <td data-label="Клиент">${escapeHtml(p.clientName || "— (за всички)")}</td>
    <td data-label="Име по клиента">${escapeHtml(p.clientProductName || "")}</td>
    <td data-label="Вид кашон">${escapeHtml(p.boxType || "")}</td>
    <td data-label="Размер кашон">${escapeHtml(p.boxSize || "")}</td>
    <td class="num" data-label="кг/брой">${n(p.kgPerPiece)}</td>
    <td class="num" data-label="кг/кашон">${n(p.kgPerBox)}</td>
    <td class="num" data-label="кашони/палет">${n(p.boxesPerPallet)}</td>
    <td data-label="Аксесоари">${escapeHtml(p.accessories || "")}</td>
    <td class="erp-row-actions"><button class="btn btn-small" data-edit="${p.id}">✎</button> <button class="btn btn-small btn-danger" data-del="${p.id}">×</button></td>
  </tr>`).join("") || `<tr><td colspan="10" class="report-empty">Няма опаковки. Натисни „+ Нова опаковка".</td></tr>`;
  tb.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackForm((PACKAGING || []).find(x => String(x.id) === String(b.dataset.edit))); }));
  tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackDelete(Number(b.dataset.del)); }));
  tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpPackForm((PACKAGING || []).find(x => String(x.id) === String(tr.dataset.id)))));
}

/* ---------- Форма (добавяне/редакция) ---------- */
function erpPackForm(rec) {
  const isNew = !rec;
  const r = rec ? { ...rec } : { id: null, code: "", clientName: "", clientProductName: "", kgPerPiece: "", kgPerBox: "", boxesPerPallet: "", boxType: "", accessories: "" };
  const { wrap, close } = erpDialog(`
    <h3>${isNew ? "Нова опаковка" : "Редакция на опаковка"}</h3>
    <div class="erp-co-grid">
      <label>Наш код (може празно — попълва се после) <input type="text" id="pk-code" list="pack-codes" value="${escapeAttr(r.code || "")}" placeholder="напр. 30..." /></label>
      <label>Клиент <input type="text" id="pk-client" list="pack-clients" value="${escapeAttr(r.clientName || "")}" placeholder="празно = за всички клиенти" /></label>
      <label>Име по клиента / № чертеж <input type="text" id="pk-cpname" value="${escapeAttr(r.clientProductName || "")}" placeholder="както клиента поръчва" /></label>
      <label>Вид кашон <input type="text" id="pk-boxtype" value="${escapeAttr(r.boxType || "")}" placeholder="напр. кафяв 5-слоен…" /></label>
      <label>Размер кашон <input type="text" id="pk-boxsize" value="${escapeAttr(r.boxSize || "")}" placeholder="напр. 600×400×300" /></label>
      <label>Килограми за брой <input type="number" id="pk-kgp" step="any" min="0" value="${escapeAttr(String(r.kgPerPiece ?? ""))}" /></label>
      <label>Килограми за кашон <input type="number" id="pk-kgb" step="any" min="0" value="${escapeAttr(String(r.kgPerBox ?? ""))}" /></label>
      <label>Брой кашони на палет <input type="number" id="pk-bpp" step="any" min="0" value="${escapeAttr(String(r.boxesPerPallet ?? ""))}" /></label>
    </div>
    <label class="erp-co-note">Допълнителни аксесоари на палета <input type="text" id="pk-acc" value="${escapeAttr(r.accessories || "")}" placeholder="напр. капак, ъгли, стреч, разделители…" /></label>
    <div class="pack-preview" id="pk-preview"></div>
    <div class="erp-dialog-actions"><button class="btn" id="pk-cancel">Отказ</button><button class="btn btn-primary" id="pk-save">💾 Запази</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  // Обобщение под аксесоарите: наш код + описание (нашето име на продукта) + бройки.
  const preview = () => {
    const g = id => (wrap.querySelector("#" + id).value || "").trim();
    const code = g("pk-code");
    const p = (typeof ERP !== "undefined" && ERP.products ? ERP.products : []).find(x => String(x.code || "").trim() === code);
    const kgP = packNum(g("pk-kgp")), kgB = packNum(g("pk-kgb")), bpp = packNum(g("pk-bpp"));
    const perBox = (kgP > 0 && kgB > 0) ? Math.max(1, Math.round(kgB / kgP)) : 0;
    const box = wrap.querySelector("#pk-preview"); if (!box) return;
    const head = code
      ? `<b>${escapeHtml(code)}</b>${p ? " · " + escapeHtml(p.name || "") : ' · <span class="erp-muted">няма продукт с този код</span>'}`
      : `<span class="erp-muted">⚠ без наш код (ще се допълни после)</span>`;
    box.innerHTML = head
      + (perBox ? ` · <b>${perBox} бр.</b> в кашон` : "")
      + (perBox && bpp ? ` · <b>${perBox * bpp} бр.</b> на палет (${bpp} кашона)` : "");
  };
  ["pk-code", "pk-kgp", "pk-kgb", "pk-bpp"].forEach(id => wrap.querySelector("#" + id).addEventListener("input", preview));
  preview();
  wrap.querySelector("#pk-cancel").addEventListener("click", close);
  wrap.querySelector("#pk-save").addEventListener("click", async () => {
    const g = id => (wrap.querySelector("#" + id).value || "").trim();
    const code = g("pk-code");
    // Кодът НЕ е задължителен: някой попълва информацията, кодът се добавя после.
    // Без код и без нищо друго обаче няма смисъл от запис.
    if (!code && !g("pk-cpname") && !g("pk-client")) { alert("Попълни поне наш код, клиент или име по клиента."); return; }
    const rc = {
      code, clientName: g("pk-client"), clientProductName: g("pk-cpname"),
      boxType: g("pk-boxtype"), boxSize: g("pk-boxsize"),
      kgPerPiece: packNum(g("pk-kgp")), kgPerBox: packNum(g("pk-kgb")),
      boxesPerPallet: packNum(g("pk-bpp")), accessories: g("pk-acc"),
    };
    if (isNew) {
      // Дедуп: по код+клиент (ако има код) или по име по клиента+клиент (ако няма).
      const ex = (PACKAGING || []).find(p => code
        ? (packNorm(p.code) === packNorm(rc.code) && packNorm(p.clientName) === packNorm(rc.clientName))
        : (!packNorm(p.code) && packNorm(p.clientProductName) === packNorm(rc.clientProductName) && packNorm(p.clientName) === packNorm(rc.clientName) && packNorm(rc.clientProductName)));
      if (ex) Object.assign(ex, rc);
      else (PACKAGING = PACKAGING || []).push({ id: packNextId(), ...rc });
    } else {
      const ex = (PACKAGING || []).find(p => p.id === r.id);
      if (ex) Object.assign(ex, rc);
    }
    if (await erpPackSave()) { close(); erpPackFillRows(); }
  });
}
async function erpPackDelete(id) {
  const p = (PACKAGING || []).find(x => x.id === id); if (!p) return;
  if (!confirm(`Да изтрия ли опаковката за код ${p.code}${p.clientName ? " · " + p.clientName : ""}?`)) return;
  PACKAGING = (PACKAGING || []).filter(x => x.id !== id);
  if (await erpPackSave()) erpPackFillRows();
}

/* ---------- Достъп до опаковката за придружаващите документи ----------
   Използва се от erp-invoices.js (erpDocLineKg/erpDocAutoRows). Гарантира, че
   PACKAGING е зареден дори ако табът „Опаковки" не е отварян в тази сесия. */
async function erpPackEnsureLoaded() { if (!PACKAGING) await erpPackLoad(); }

/* ================== ОПАКОВЪЧНА ВЕРИГА (заявка → Опаковки → документи) ==================
   НОВАТА връзка (30.07.2026, Данко): всяка въведена заявка (наш № + клиентски №)
   се появява тук; отваря се в опаковъчен изглед с колони КОД / Бройка /
   КГ за брой / Вид кашон / Броя в кашон / Кашони на палет + Сума на палетите.
   Оттук се печатат РЕАЛНИТЕ Packing List, Стокова разписка и Палет опис
   (по палети) — директно от заявката, без да минават през фактурата
   (старата „ФАКТУРНА ВЕРИГА" остава като резервен път).
   Данните се пазят В ЗАЯВКАТА (o.packing) и дообучават картотеката горе. */

let PACK_CO_OPEN = new Set(); // отворени клиентски папки в „Заявки за опаковане"

function packOrderRowHtml(o) {
  const packed = o.packing && Object.keys(o.packing.rows || {}).length;
  const status = (typeof erpCOStatusCell === "function") ? erpCOStatusCell(o) : escapeHtml(o.status || "нова");
  return `<tr class="erp-clickable" data-packco="${o.id}">
    <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
    <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
    <td data-label="Дата">${erpDMY(o.date)}</td>
    <td class="num" data-label="Редове">${(o.lines || []).length}</td>
    <td data-label="Статус">${status}</td>
    <td data-label="Опаковка">${packed ? '<span class="erp-co-status" style="background:#dcfce7;color:#166534">✓ попълнена</span>' : '<span class="erp-muted">—</span>'}</td>
    <td class="erp-row-actions"><button class="btn btn-small" data-packco-open="${o.id}">Опаковай →</button></td>
  </tr>`;
}

function packOrdersListHtml() {
  const list = ((typeof erpCOList !== "undefined" && erpCOList) || [])
    .filter(o => (o.status || "нова") !== "завършена")
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  if (!list.length) return "";
  // Папки по клиент — както в Заявки: всеки клиент си е в папка.
  const byClient = new Map();
  list.forEach(o => { const c = o.clientName || "— без клиент"; if (!byClient.has(c)) byClient.set(c, []); byClient.get(c).push(o); });
  const clients = [...byClient.keys()].sort((a, b) => a.localeCompare(b, "bg"));
  const body = clients.map(c => {
    const rows = byClient.get(c);
    const packed = rows.filter(o => o.packing && Object.keys(o.packing.rows || {}).length).length;
    const open = PACK_CO_OPEN.has(c);
    return `<tr class="co-folder erp-clickable" data-packfolder="${escapeAttr(c)}">
      <td colspan="7">📁 ${open ? "▾" : "▸"} <b>${escapeHtml(c)}</b> — ${rows.length} ${rows.length === 1 ? "заявка" : "заявки"} · опаковани ${packed}/${rows.length}</td>
    </tr>` + (open ? rows.map(packOrderRowHtml).join("") : "");
  }).join("");
  return `
    <div class="pack-orders">
      <h4 class="erp-group-head" style="margin-top:0">📦 Заявки за опаковане (${list.length})</h4>
      <table class="report-table erp-table" style="margin-bottom:8px">
        <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Дата</th><th class="num">Редове</th><th>Статус</th><th>Опаковка</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// Кабелира секцията; папка се отваря/затваря с прерисуване САМО на кутията (без заявки към базата).
function packOrdersWire() {
  const box = document.getElementById("pack-orders-box"); if (!box) return;
  box.querySelectorAll("[data-packfolder]").forEach(tr => tr.addEventListener("click", () => {
    const c = tr.dataset.packfolder;
    if (PACK_CO_OPEN.has(c)) PACK_CO_OPEN.delete(c); else PACK_CO_OPEN.add(c);
    box.innerHTML = packOrdersListHtml();
    packOrdersWire();
  }));
  box.querySelectorAll("[data-packco-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackOrderOpen(b.dataset.packcoOpen); }));
  box.querySelectorAll("tr[data-packco]").forEach(tr => tr.addEventListener("click", () => erpPackOrderOpen(tr.dataset.packco)));
}

// Тегло на 1 брой: картотеката (код+клиент) → рецептата → ръчно.
function packKgFor(code, clientName, productId) {
  const spec = erpPackFind(code, clientName);
  if (spec && packNum(spec.kgPerPiece) > 0) return packNum(spec.kgPerPiece);
  if (productId && typeof erpProductWeightKg === "function") {
    const kg = erpProductWeightKg(productId);
    if (kg > 0) return Math.round(kg * 1000) / 1000;
  }
  return 0;
}

async function erpPackOrderOpen(orderId) {
  const o = ((typeof erpCOList !== "undefined" && erpCOList) || []).find(x => String(x.id) === String(orderId));
  if (!o) { alert("Заявката не е намерена."); return; }
  try { await erpEnsureLoaded(); } catch (e) {}
  o.packing = o.packing || { rows: {}, palletKg: 20 };
  const v = erpView();
  const P = o.packing;
  const rowState = i => {
    const l = (o.lines || [])[i] || {};
    const key = String(l.code || i);
    const r = P.rows[key] || {};
    const spec = erpPackFind(l.code, o.clientName);
    return {
      key, code: l.code || "", name: l.name || "", qty: erpToNum(l.qty) || 0,
      kgPer: r.kgPer != null ? r.kgPer : packKgFor(l.code, o.clientName, l.productId),
      boxType: r.boxType != null ? r.boxType : ((spec && spec.boxType) || ""),
      perBox: r.perBox != null ? r.perBox : ((spec && packNum(spec.kgPerBox) > 0 && packNum(spec.kgPerPiece) > 0) ? Math.round(packNum(spec.kgPerBox) / packNum(spec.kgPerPiece)) : ""),
      perPallet: r.perPallet != null ? r.perPallet : ((spec && spec.boxesPerPallet) || ""),
    };
  };
  const calc = st => {
    const perBox = packNum(st.perBox), perPallet = packNum(st.perPallet);
    const boxes = perBox > 0 ? Math.ceil(st.qty / perBox) : 0;
    const pallets = (boxes > 0 && perPallet > 0) ? boxes / perPallet : 0;
    const netKg = Math.round(st.qty * packNum(st.kgPer) * 10) / 10;
    return { boxes, pallets, netKg };
  };
  const render = () => {
    const states = (o.lines || []).map((_, i) => rowState(i));
    const totals = states.reduce((t, st) => {
      const c = calc(st);
      t.qty += st.qty; t.boxes += c.boxes; t.pallets += c.pallets; t.net += c.netKg;
      return t;
    }, { qty: 0, boxes: 0, pallets: 0, net: 0 });
    const palletsUp = Math.ceil(totals.pallets - 1e-9);
    const gross = Math.round((totals.net + palletsUp * packNum(P.palletKg || 20)) * 10) / 10;
    v.innerHTML = `
      <div class="erp-toolbar">
        <button class="btn btn-small" id="pko-back">← Опаковки</button>
        <span class="erp-count">📦 Опаковане — заявка <b>${escapeHtml(o.ourNo || "—")}</b>${o.clientNo ? " · клиентски № " + escapeHtml(o.clientNo) : ""} · ${escapeHtml(o.clientName || "")}</span>
        <span class="spacer"></span>
        <button class="btn btn-small btn-primary" id="pko-save">💾 Запази опаковката</button>
      </div>
      <table class="report-table erp-table">
        <thead><tr><th>КОД</th><th>Продукт</th><th class="num">Бройка</th><th class="num">КГ за брой</th><th>Вид кашон</th><th class="num">Броя в кашон</th><th class="num">Кашони на палет</th><th class="num">Кашони</th><th class="num">Палети</th><th class="num">Нето кг</th></tr></thead>
        <tbody>${states.map((st, i) => { const c = calc(st); return `<tr data-i="${i}">
          <td><b>${escapeHtml(st.code)}</b></td>
          <td>${escapeHtml(st.name)}</td>
          <td class="num">${erpNum(st.qty)}</td>
          <td class="num"><input type="number" step="any" min="0" class="pko-kg" data-i="${i}" value="${escapeAttr(String(st.kgPer || ""))}" style="width:80px" /></td>
          <td><input type="text" class="pko-box" data-i="${i}" value="${escapeAttr(st.boxType)}" style="width:120px" placeholder="напр. кафяв 5-слоен" /></td>
          <td class="num"><input type="number" step="1" min="0" class="pko-perbox" data-i="${i}" value="${escapeAttr(String(st.perBox || ""))}" style="width:70px" /></td>
          <td class="num"><input type="number" step="1" min="0" class="pko-perpal" data-i="${i}" value="${escapeAttr(String(st.perPallet || ""))}" style="width:70px" /></td>
          <td class="num"><b>${c.boxes || "—"}</b></td>
          <td class="num">${c.pallets ? (Math.round(c.pallets * 100) / 100) : "—"}</td>
          <td class="num">${c.netKg || "—"}</td>
        </tr>`; }).join("")}</tbody>
        <tfoot><tr style="font-weight:700;background:#f8fafc">
          <td colspan="2">ОБЩО</td><td class="num">${erpNum(totals.qty)}</td><td></td><td></td><td></td><td></td>
          <td class="num">${totals.boxes}</td><td class="num">${palletsUp}${totals.pallets ? ` <span class="erp-muted">(${Math.round(totals.pallets * 100) / 100})</span>` : ""}</td><td class="num">${Math.round(totals.net * 10) / 10}</td>
        </tr></tfoot>
      </table>
      <div class="costk-stats">
        <span>Сума на палетите: <b>${palletsUp}</b></span>
        <span>Кашони: <b>${totals.boxes}</b></span>
        <span>Нето: <b>${Math.round(totals.net * 10) / 10} кг</b></span>
        <span>Тегло на палет: <input type="number" step="any" id="pko-palkg" value="${escapeAttr(String(P.palletKg || 20))}" style="width:64px" /> кг</span>
        <span>Бруто: <b>${gross} кг</b></span>
      </div>
      <div class="erp-co-actions">
        <button class="btn btn-small" id="pko-packing">🖨 Packing List</button>
        <button class="btn btn-small" id="pko-goods">🖨 Стокова разписка</button>
        <button class="btn btn-small" id="pko-pallets">🖨 Палет опис (по палети)</button>
        <span class="erp-muted">Документите се пълнят от ТАЗИ таблица (Опаковъчната верига).</span>
      </div>`;
    const collect = () => {
      v.querySelectorAll("tr[data-i]").forEach(tr => {
        const i = Number(tr.dataset.i);
        const l = (o.lines || [])[i] || {};
        const key = String(l.code || i);
        P.rows[key] = {
          kgPer: erpToNum((tr.querySelector(".pko-kg") || {}).value) || 0,
          boxType: ((tr.querySelector(".pko-box") || {}).value || "").trim(),
          perBox: erpToNum((tr.querySelector(".pko-perbox") || {}).value) || 0,
          perPallet: erpToNum((tr.querySelector(".pko-perpal") || {}).value) || 0,
        };
      });
      P.palletKg = erpToNum((document.getElementById("pko-palkg") || {}).value) || 20;
    };
    v.querySelector("#pko-back").addEventListener("click", () => erpRenderPackaging());
    v.querySelectorAll(".pko-kg,.pko-box,.pko-perbox,.pko-perpal").forEach(el => el.addEventListener("change", () => { collect(); render(); }));
    const palkg = v.querySelector("#pko-palkg"); if (palkg) palkg.addEventListener("change", () => { collect(); render(); });
    v.querySelector("#pko-save").addEventListener("click", async () => {
      collect();
      const btn = v.querySelector("#pko-save"); btn.disabled = true; btn.textContent = "Записва…";
      try {
        await erpSaveCO(o);
        // Дообучаване на картотеката: код+клиент → кг/брой, кашон, кашони/палет.
        (o.lines || []).forEach((l, i) => {
          const r = P.rows[String(l.code || i)];
          if (!r || !l.code) return;
          let spec = (PACKAGING || []).find(p => packNorm(p.code) === packNorm(l.code) && packNorm(p.clientName) === packNorm(o.clientName));
          if (!spec) { spec = { id: packNextId(), code: l.code, clientName: o.clientName || "" }; PACKAGING.push(spec); }
          if (r.kgPer > 0) spec.kgPerPiece = r.kgPer;
          if (r.boxType) spec.boxType = r.boxType;
          if (r.perBox > 0 && r.kgPer > 0) spec.kgPerBox = Math.round(r.perBox * r.kgPer * 100) / 100;
          if (r.perPallet > 0) spec.boxesPerPallet = r.perPallet;
        });
        await erpPackSave();
        btn.textContent = "✓ Записано"; setTimeout(() => { btn.textContent = "💾 Запази опаковката"; btn.disabled = false; }, 1200);
      } catch (e) { btn.disabled = false; btn.textContent = "💾 Запази опаковката"; alert("Грешка при запис: " + (e.message || e)); }
    });
    // Печат — трите документа от опаковъчните данни.
    const docRows = () => (o.lines || []).map((_, i) => rowState(i)).map(st => ({ ...st, ...calc(st) }));
    v.querySelector("#pko-packing").addEventListener("click", () => { collect(); packPrintPacking(o, docRows(), P); });
    v.querySelector("#pko-goods").addEventListener("click", () => { collect(); packPrintGoods(o, docRows()); });
    v.querySelector("#pko-pallets").addEventListener("click", () => { collect(); packPrintPallets(o, docRows(), P); });
  };
  render();
}

/* Разпределя кашоните по палети (последователно) — за описа „всеки един палет". */
function packBuildPallets(rows) {
  const pallets = [];
  let cur = null, curCap = 0;   // капацитет на текущия палет в КАШОНИ от текущия ред
  rows.forEach(st => {
    let left = st.boxes;
    const perPal = packNum(st.perPallet) || st.boxes || 1;
    while (left > 0) {
      if (!cur || curCap <= 0) { cur = { no: pallets.length + 1, items: [] }; pallets.push(cur); curCap = perPal; }
      const take = Math.min(left, curCap);
      const qty = Math.min(st.qty, take * (packNum(st.perBox) || st.qty));
      cur.items.push({ code: st.code, name: st.name, boxes: take, qty: take === st.boxes ? st.qty : take * (packNum(st.perBox) || 0), kg: Math.round(((take === st.boxes ? st.qty : take * (packNum(st.perBox) || 0)) * packNum(st.kgPer)) * 10) / 10 });
      left -= take; curCap -= take;
    }
  });
  return pallets;
}
function packDocHead(o, title) {
  return `<div class="head"><div><h1>${title}</h1>
      <div>Заявка: <b>${escapeHtml(o.ourNo || "—")}</b>${o.clientNo ? " · Order No: <b>" + escapeHtml(o.clientNo) + "</b>" : ""}</div></div>
    <div style="text-align:right">Клиент: <b>${escapeHtml(o.clientName || "")}</b><br>Дата: <b>${erpDMY(new Date().toISOString().slice(0, 10))}</b></div></div>`;
}
function packPrintPacking(o, rows, P) {
  const tot = rows.reduce((t, r) => { t.q += r.qty; t.b += r.boxes; t.p += r.pallets; t.n += r.netKg; return t; }, { q: 0, b: 0, p: 0, n: 0 });
  const palletsUp = Math.ceil(tot.p - 1e-9);
  const gross = Math.round((tot.n + palletsUp * packNum(P.palletKg || 20)) * 10) / 10;
  const body = `${packDocHead(o, "PACKING LIST")}
    <table><thead><tr><th>№</th><th>Code</th><th>Description</th><th class="c">Qty</th><th class="c">kg / pc</th><th class="c">Box type</th><th class="c">Pcs / box</th><th class="c">Boxes</th><th class="c">Net kg</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td><b>${escapeHtml(r.code)}</b></td><td>${escapeHtml(r.name)}</td><td class="r">${erpNum(r.qty)}</td><td class="r">${r.kgPer || ""}</td><td>${escapeHtml(r.boxType)}</td><td class="r">${r.perBox || ""}</td><td class="r">${r.boxes || ""}</td><td class="r">${r.netKg || ""}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3"><b>TOTAL</b></td><td class="r"><b>${erpNum(tot.q)}</b></td><td></td><td></td><td></td><td class="r"><b>${tot.b}</b></td><td class="r"><b>${Math.round(tot.n * 10) / 10}</b></td></tr></tfoot></table>
    <div class="kv"><b>Pallets:</b> ${palletsUp} × ${packNum(P.palletKg || 20)} kg</div>
    <div class="kv"><b>Total net weight:</b> ${Math.round(tot.n * 10) / 10} kg · <b>Total gross weight:</b> ${gross} kg</div>`;
  invPrintWindow("Packing List — заявка " + (o.ourNo || ""), body, "en");
}
function packPrintGoods(o, rows) {
  const body = `${packDocHead(o, "СТОКОВА РАЗПИСКА")}
    <table><thead><tr><th>№</th><th>Код</th><th>Наименование</th><th class="c">Бройка</th><th class="c">Кашони</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td><b>${escapeHtml(r.code)}</b></td><td>${escapeHtml(r.name)}</td><td class="r">${erpNum(r.qty)}</td><td class="r">${r.boxes || ""}</td></tr>`).join("")}</tbody></table>
    <div class="foot"><div>Предал: ................</div><div>Приел: ................</div></div>`;
  invPrintWindow("Стокова разписка — заявка " + (o.ourNo || ""), body, "bg");
}
function packPrintPallets(o, rows, P) {
  const pallets = packBuildPallets(rows);
  const body = `${packDocHead(o, "ПАЛЕТ ОПИС / PALLET LIST")}
    ${pallets.map(p => {
      const kg = Math.round(p.items.reduce((s, x) => s + x.kg, 0) * 10) / 10;
      return `<h3 style="margin:12px 0 4px">Палет № ${p.no} <span style="font-weight:400;color:#555">— нето ${kg} кг + палет ${packNum(P.palletKg || 20)} кг = бруто ${Math.round((kg + packNum(P.palletKg || 20)) * 10) / 10} кг</span></h3>
      <table><thead><tr><th>Код</th><th>Наименование</th><th class="c">Кашони</th><th class="c">Бройка</th><th class="c">Нето кг</th></tr></thead>
      <tbody>${p.items.map(x => `<tr><td><b>${escapeHtml(x.code)}</b></td><td>${escapeHtml(x.name)}</td><td class="r">${x.boxes}</td><td class="r">${erpNum(x.qty)}</td><td class="r">${x.kg}</td></tr>`).join("")}</tbody></table>`;
    }).join("") || "<p>Няма палети — попълни кашоните на палет.</p>"}
    <div class="kv"><b>Общо палети:</b> ${pallets.length}</div>`;
  invPrintWindow("Палет опис — заявка " + (o.ourNo || ""), body, "bg");
}
