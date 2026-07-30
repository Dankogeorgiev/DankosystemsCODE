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
let PACK_LAYOUTS = null; // запомнени палетни подредби: ключ клиент|кодове → шаблон
let packQuery = "";

async function erpPackLoad() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "packaging").maybeSingle();
    PACKAGING = (data && data.data && data.data.list) || [];
    PACK_LAYOUTS = (data && data.data && data.data.layouts) || {};
  }
  catch (e) { PACKAGING = []; PACK_LAYOUTS = PACK_LAYOUTS || {}; }
}
async function erpPackSave() {
  const { error } = await sb.from("app_config").upsert({ id: "packaging", data: { list: PACKAGING || [], layouts: PACK_LAYOUTS || {} }, updated_at: new Date().toISOString() });
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
        <th class="num">бр/кашон</th><th class="num">кг/брой</th><th class="num">кг/кашон</th><th class="num">кашони/палет</th>
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
    <td class="num" data-label="бр/кашон">${n(p.piecesPerBox)}</td>
    <td class="num" data-label="кг/брой">${n(p.kgPerPiece)}</td>
    <td class="num" data-label="кг/кашон">${n(p.kgPerBox)}</td>
    <td class="num" data-label="кашони/палет">${n(p.boxesPerPallet)}</td>
    <td data-label="Аксесоари">${escapeHtml(p.accessories || "")}</td>
    <td class="erp-row-actions"><button class="btn btn-small" data-edit="${p.id}">✎</button> <button class="btn btn-small btn-danger" data-del="${p.id}">×</button></td>
  </tr>`).join("") || `<tr><td colspan="11" class="report-empty">Няма опаковки. Натисни „+ Нова опаковка".</td></tr>`;
  tb.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackForm((PACKAGING || []).find(x => String(x.id) === String(b.dataset.edit))); }));
  tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackDelete(Number(b.dataset.del)); }));
  tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpPackForm((PACKAGING || []).find(x => String(x.id) === String(tr.dataset.id)))));
}

/* ---------- Форма (добавяне/редакция) ---------- */
function erpPackForm(rec) {
  const isNew = !rec;
  const r = rec ? { ...rec } : { id: null, code: "", clientName: "", clientProductName: "", kgPerPiece: "", kgPerBox: "", piecesPerBox: "", boxesPerPallet: "", boxType: "", accessories: "" };
  const { wrap, close } = erpDialog(`
    <h3>${isNew ? "Нова опаковка" : "Редакция на опаковка"}</h3>
    <div class="erp-co-grid">
      <label>Наш код (може празно — попълва се после) <input type="text" id="pk-code" list="pack-codes" value="${escapeAttr(r.code || "")}" placeholder="напр. 30..." /></label>
      <label>Клиент <input type="text" id="pk-client" list="pack-clients" value="${escapeAttr(r.clientName || "")}" placeholder="празно = за всички клиенти" /></label>
      <label>Име по клиента / № чертеж <input type="text" id="pk-cpname" value="${escapeAttr(r.clientProductName || "")}" placeholder="както клиента поръчва" /></label>
      <label>Вид кашон <input type="text" id="pk-boxtype" value="${escapeAttr(r.boxType || "")}" placeholder="напр. кафяв 5-слоен…" /></label>
      <label>Размер кашон <input type="text" id="pk-boxsize" value="${escapeAttr(r.boxSize || "")}" placeholder="напр. 600×400×300" /></label>
      <label>Броя в кашон <input type="number" id="pk-ppb" step="1" min="0" value="${escapeAttr(String(r.piecesPerBox ?? ""))}" /></label>
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
    const kgP = packNum(g("pk-kgp")), kgB = packNum(g("pk-kgb")), bpp = packNum(g("pk-bpp")), ppb = packNum(g("pk-ppb"));
    const perBox = ppb > 0 ? Math.round(ppb) : ((kgP > 0 && kgB > 0) ? Math.max(1, Math.round(kgB / kgP)) : 0);
    const box = wrap.querySelector("#pk-preview"); if (!box) return;
    const head = code
      ? `<b>${escapeHtml(code)}</b>${p ? " · " + escapeHtml(p.name || "") : ' · <span class="erp-muted">няма продукт с този код</span>'}`
      : `<span class="erp-muted">⚠ без наш код (ще се допълни после)</span>`;
    box.innerHTML = head
      + (perBox ? ` · <b>${perBox} бр.</b> в кашон` : "")
      + (perBox && bpp ? ` · <b>${perBox * bpp} бр.</b> на палет (${bpp} кашона)` : "");
  };
  ["pk-code", "pk-kgp", "pk-kgb", "pk-bpp", "pk-ppb"].forEach(id => wrap.querySelector("#" + id).addEventListener("input", preview));
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
      piecesPerBox: packNum(g("pk-ppb")), boxesPerPallet: packNum(g("pk-bpp")), accessories: g("pk-acc"),
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
      boxSize: r.boxSize != null ? r.boxSize : ((spec && spec.boxSize) || ""),
      perBox: r.perBox != null ? r.perBox : (spec && packNum(spec.piecesPerBox) > 0 ? Math.round(packNum(spec.piecesPerBox)) : ((spec && packNum(spec.kgPerBox) > 0 && packNum(spec.kgPerPiece) > 0) ? Math.round(packNum(spec.kgPerBox) / packNum(spec.kgPerPiece)) : "")),
      perPallet: r.perPallet != null ? r.perPallet : ((spec && spec.boxesPerPallet) || ""),
    };
  };
  const calc = st => {
    const perBox = packNum(st.perBox), perPallet = packNum(st.perPallet);
    const bd = packBoxBreakdown(st.qty, perBox);
    const pallets = (bd.boxes > 0 && perPallet > 0) ? bd.boxes / perPallet : 0;
    const netKg = Math.round(st.qty * packNum(st.kgPer) * 10) / 10;
    return { boxes: bd.boxes, bdText: bd.text, pallets, netKg };
  };
  const render = () => {
    const states = (o.lines || []).map((_, i) => rowState(i));
    const totals = states.reduce((t, st) => {
      const c = calc(st);
      t.qty += st.qty; t.boxes += c.boxes; t.pallets += c.pallets; t.net += c.netKg;
      return t;
    }, { qty: 0, boxes: 0, pallets: 0, net: 0 });
    const built = packPlanPallets(states.map(st => ({ ...st, ...calc(st) })), P);
    const palletsUp = built.length || Math.ceil(totals.pallets - 1e-9);
    const smallCnt = built.filter(p => p.small).length;
    const palletsKg = built.length ? packPalletsKg(built, P.palletKg) : palletsUp * packNum(P.palletKg || 20);
    const gross = Math.round((totals.net + palletsKg) * 10) / 10;
    v.innerHTML = `
      <div class="erp-toolbar">
        <button class="btn btn-small" id="pko-back">← Опаковки</button>
        <span class="erp-count">📦 Опаковане — заявка <b>${escapeHtml(o.ourNo || "—")}</b>${o.clientNo ? " · клиентски № " + escapeHtml(o.clientNo) : ""} · ${escapeHtml(o.clientName || "")}</span>
        <span class="spacer"></span>
        <button class="btn btn-small btn-primary" id="pko-save">💾 Запази опаковката</button>
      </div>
      <table class="report-table erp-table">
        <thead><tr><th>КОД</th><th>Продукт</th><th class="num">Бройка</th><th class="num">КГ за брой</th><th>Вид кашон</th><th>Размер кашон</th><th class="num">Броя в кашон</th><th class="num">Кашони на палет</th><th class="num">Кашони</th><th class="num">Палети</th><th class="num">Нето кг</th></tr></thead>
        <tbody>${states.map((st, i) => { const c = calc(st); return `<tr data-i="${i}">
          <td><b>${escapeHtml(st.code)}</b></td>
          <td>${escapeHtml(st.name)}</td>
          <td class="num">${erpNum(st.qty)}</td>
          <td class="num"><input type="number" step="any" min="0" class="pko-kg" data-i="${i}" value="${escapeAttr(String(st.kgPer || ""))}" style="width:80px" /></td>
          <td><input type="text" class="pko-box" data-i="${i}" value="${escapeAttr(st.boxType)}" style="width:120px" placeholder="напр. кафяв 5-слоен" /></td>
          <td><input type="text" class="pko-boxsize" data-i="${i}" value="${escapeAttr(st.boxSize)}" style="width:96px" placeholder="60×40×30" /></td>
          <td class="num"><input type="number" step="1" min="0" class="pko-perbox" data-i="${i}" value="${escapeAttr(String(st.perBox || ""))}" style="width:70px" /></td>
          <td class="num"><input type="number" step="1" min="0" class="pko-perpal" data-i="${i}" value="${escapeAttr(String(st.perPallet || ""))}" style="width:70px" /></td>
          <td class="num"><b>${c.boxes || "—"}</b>${c.boxes > 1 && c.bdText ? `<br><span class="erp-muted" style="white-space:nowrap">${c.bdText}</span>` : ""}</td>
          <td class="num">${c.pallets ? (Math.round(c.pallets * 100) / 100) : "—"}</td>
          <td class="num">${c.netKg || "—"}</td>
        </tr>`; }).join("")}</tbody>
        <tfoot><tr style="font-weight:700;background:#f8fafc">
          <td colspan="2">ОБЩО</td><td class="num">${erpNum(totals.qty)}</td><td></td><td></td><td></td><td></td><td></td>
          <td class="num">${totals.boxes}</td><td class="num" id="pko-palfoot">${palletsUp}${totals.pallets ? ` <span class="erp-muted">(${Math.round(totals.pallets * 100) / 100})</span>` : ""}</td><td class="num">${Math.round(totals.net * 10) / 10}</td>
        </tr></tfoot>
      </table>
      <div class="costk-stats">
        <span>Сума на палетите: <b id="pko-palsum">${palletsUp}</b><span class="erp-muted" id="pko-palbrk">${smallCnt ? ` (${palletsUp - smallCnt} × 120×80 + ${smallCnt} × 60×80)` : ""}</span></span>
        <span>Кашони: <b>${totals.boxes}</b></span>
        <span>Нето: <b>${Math.round(totals.net * 10) / 10} кг</b></span>
        <span title="Теглото на празния евро палет 120×80; малкият 60×80 се брои наполовина">Тегло на палет 120×80: <input type="number" step="any" id="pko-palkg" value="${escapeAttr(String(P.palletKg || 20))}" style="width:64px" /> кг</span>
        <span>Бруто: <b id="pko-gross">${gross} кг</b></span>
      </div>
      <div id="pko-plan"></div>
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
          boxSize: ((tr.querySelector(".pko-boxsize") || {}).value || "").trim(),
          perBox: erpToNum((tr.querySelector(".pko-perbox") || {}).value) || 0,
          perPallet: erpToNum((tr.querySelector(".pko-perpal") || {}).value) || 0,
        };
      });
      P.palletKg = erpToNum((document.getElementById("pko-palkg") || {}).value) || 20;
    };
    v.querySelector("#pko-back").addEventListener("click", () => erpRenderPackaging());
    v.querySelectorAll(".pko-kg,.pko-box,.pko-boxsize,.pko-perbox,.pko-perpal").forEach(el => el.addEventListener("change", () => { collect(); render(); }));
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
          if (r.boxSize) spec.boxSize = r.boxSize;
          if (r.perBox > 0) spec.piecesPerBox = r.perBox;
          if (r.perBox > 0 && r.kgPer > 0) spec.kgPerBox = Math.round(r.perBox * r.kgPer * 100) / 100;
          if (r.perPallet > 0) spec.boxesPerPallet = r.perPallet;
        });
        // Стандартните палети (🧠 Запомни) → шаблон за клиента.
        try {
          if (Array.isArray(P.plan) && o.clientName) {
            const tpl = packLayoutTemplate(P);
            PACK_LAYOUTS = PACK_LAYOUTS || {};
            if (tpl) PACK_LAYOUTS[packNorm(o.clientName)] = tpl;
            else if ((P.plan || []).length) delete PACK_LAYOUTS[packNorm(o.clientName)];
          }
        } catch (e) {}
        await erpPackSave();
        btn.textContent = "✓ Записано"; setTimeout(() => { btn.textContent = "💾 Запази опаковката"; btn.disabled = false; }, 1200);
      } catch (e) { btn.disabled = false; btn.textContent = "💾 Запази опаковката"; alert("Грешка при запис: " + (e.message || e)); }
    });
    // Печат — трите документа от опаковъчните данни.
    const docRows = () => (o.lines || []).map((_, i) => rowState(i)).map(st => ({ ...st, ...calc(st) }));
    v.querySelector("#pko-packing").addEventListener("click", () => { collect(); packPrintPacking(o, docRows(), P); });
    v.querySelector("#pko-goods").addEventListener("click", () => { collect(); packPrintGoods(o, docRows()); });
    v.querySelector("#pko-pallets").addEventListener("click", () => {
      collect();
      const trayCnt = (P.tray || []).reduce((s, x) => s + x.boxes, 0);
      if (trayCnt && !confirm(`Внимание: ${trayCnt} кашона са „Настрани" и НЯМА да влязат в Палет описа. Да печатам ли все пак?`)) return;
      packPrintPallets(o, docRows(), P);
    });
    renderPlan();
  };
  /* --- 3D редактор на палетния план ---
     Всеки КАШОН е отделна кутия. Клик маркира/отмаркира (може много
     наведнъж), после „⤵ Тук (N)" на целевия палет. Влаченето мести
     един кашон (или цялата селекция, ако влачиш маркиран). „Настрани"
     е страничният ред за разпределяне — кашоните там НЕ влизат в описа. */
  const SEL = new Set();   // избрани кашони: "pi:gi:k" (pi = -1 → Настрани)
  const contOf = pi => pi < 0 ? (P.tray = P.tray || []) : ((P.plan[pi] || {}).g || null);
  const moveSel = toPi => {
    if (!SEL.size) return;
    const byGroup = new Map();
    SEL.forEach(key => { const [pi, gi] = key.split(":").map(Number); if (pi === toPi) return; const k = pi + ":" + gi; byGroup.set(k, (byGroup.get(k) || 0) + 1); });
    const target = contOf(toPi); if (!target) { SEL.clear(); return; }
    const touched = new Set();
    byGroup.forEach((cnt, k) => {
      const [pi, gi] = k.split(":").map(Number);
      const cont = contOf(pi); if (!cont) return;
      const g = cont[gi]; if (!g) return;
      const n = Math.min(cnt, g.boxes);
      g.boxes -= n; touched.add(pi);
      const same = target.find(x => x !== g && x.code === g.code && x.per === g.per && !x.part === !g.part);
      if (same) same.boxes += n; else target.push({ code: g.code, boxes: n, per: g.per, part: g.part });
    });
    touched.forEach(pi => { const cont = contOf(pi); for (let i = cont.length - 1; i >= 0; i--) if (cont[i].boxes <= 0) cont.splice(i, 1); });
    SEL.clear();
    renderPlan(); refreshStats();   // само планът + числата — БЕЗ пълен ререндер (скорост)
  };
  // Обновява само числата, които зависят от палетния план (без ререндер на екрана).
  const refreshStats = () => {
    const states = (o.lines || []).map((_, i) => rowState(i)).map(st => ({ ...st, ...calc(st) }));
    const net = states.reduce((s, c) => s + (c.netKg || 0), 0);
    const fracSum = states.reduce((s, c) => s + (c.pallets || 0), 0);
    const built = packPlanPallets(states, P);
    const palletsUp = built.length || Math.ceil(fracSum - 1e-9);
    const smallCnt = built.filter(p => p.small).length;
    const palKg = built.length ? packPalletsKg(built, P.palletKg) : palletsUp * packNum(P.palletKg || 20);
    const s1 = v.querySelector("#pko-palsum"); if (s1) s1.textContent = palletsUp;
    const s2 = v.querySelector("#pko-palbrk"); if (s2) s2.textContent = smallCnt ? ` (${palletsUp - smallCnt} × 120×80 + ${smallCnt} × 60×80)` : "";
    const s3 = v.querySelector("#pko-gross"); if (s3) s3.textContent = (Math.round((net + palKg) * 10) / 10) + " кг";
    const s4 = v.querySelector("#pko-palfoot"); if (s4) s4.innerHTML = `${palletsUp}${fracSum ? ` <span class="erp-muted">(${Math.round(fracSum * 100) / 100})</span>` : ""}`;
  };
  const renderPlan = () => {
    const box = v.querySelector("#pko-plan"); if (!box) return;
    const rows = (o.lines || []).map((_, i) => rowState(i)).map(st => ({ ...st, ...calc(st) })).filter(r => r.boxes > 0);
    if (!rows.length) { box.innerHTML = ""; return; }
    const sig = packPlanSig(rows);
    if (!Array.isArray(P.plan) || P.planSig !== sig) {
      // Първо запомнената подредба на клиента (ако има), иначе автоматиката.
      P.plan = packPlanFromTemplate(rows, o.clientName) || packPlanAuto(rows);
      P.planSig = sig; P.tray = []; SEL.clear();
    }
    packPlanNorm(P);
    P.tray = P.tray || [];
    const info = {}; rows.forEach(r => { info[r.code] = r; });
    /* --- Истинска 3D визия (изометрия). Всичко е в СМ, после се проектира:
       екранX = (x − y)·K, екранY = (x + y)/2·K − z·K. Кашонът е с реалните
       размери: най-голямото число = дължина, средното = ширина, най-малкото
       = височина. Палетът е 120×80 (или 60×80), дебелина 12 см. --- */
    const K = 1.4, PALH = 12;
    const dimsOf = code => {
      const nums = (String((info[code] || {}).boxSize || "").match(/\d+/g) || []).map(Number).filter(n => n > 0).sort((a, b) => b - a);
      if (!nums.length) return { l: 40, w: 30, h: 25 };
      const l = Math.min(nums[0], 200);
      const w = nums[1] ? Math.min(nums[1], 120) : Math.round(l * 0.7);
      const h = nums[2] || Math.round(w * 0.8);
      return { l, w, h };
    };
    const layoutBoxes = (g, PL, PW) => {
      const units = [];
      (g || []).forEach((x, gi) => { const d = dimsOf(x.code); for (let k = 0; k < x.boxes; k++) units.push({ ...d, code: x.code, per: x.per, part: x.part, gi, k }); });
      let cx = 0, cy = 0, cz = 0, rowW = 0, layH = 0;
      units.forEach(u => {
        const l = Math.min(u.l, PL), w = Math.min(u.w, PW);
        if (cx + l > PL + 0.01) { cx = 0; cy += rowW; rowW = 0; }
        if (cy + w > PW + 0.01) { cy = 0; cx = 0; cz += layH; layH = 0; rowW = 0; }
        u.x = cx; u.y = cy; u.z = cz; u.l = l; u.w = w;
        cx += l; rowW = Math.max(rowW, w); layH = Math.max(layH, u.h);
      });
      return { units };
    };
    const pal3d = (p, pi) => {
      // Обикновен палет 120×80 / 60×80, или „подът" (буферът) — широка площ без палет.
      const PL = p.floor ? 200 : (p.small ? 60 : 120), PW = p.floor ? 130 : 80;
      const baseH = p.floor ? 3 : PALH, baseCol = p.floor ? "#c9d2dd" : "#b07a34";
      const { units } = layoutBoxes(p.g, PL, PW);
      const maxTop = Math.max(30, ...units.map(u => u.z + u.h));
      const offX = PW * K + 4, offY = maxTop * K + 4;
      const W = Math.round((PL + PW) * K + 8), H = Math.round((PL + PW) * 0.5 * K + (maxTop + baseH) * K + 8);
      const pr = (x, y, z) => [Math.round((x - y) * K + offX), Math.round(((x + y) * 0.5 - z) * K + offY)];
      const face = (p0, a, b, c, d, wdt, hgt, col, br, key, tip, sel) =>
        `<div class="pk3i-f${sel ? " selq" : ""}" ${key ? `data-key="${key}" draggable="true" title="${tip || ""}"` : ""} style="width:${Math.round(wdt)}px;height:${Math.round(hgt)}px;background:${col};filter:brightness(${br});transform:matrix(${a},${b},${c},${d},${p0[0]},${p0[1]})"></div>`;
      const cub = (x, y, z, l, w, h, col, key, sel, tip) =>
        face(pr(x + l, y, z + h), -K, .5 * K, 0, K, w, h, col, .6, key, tip, sel)
          + face(pr(x, y + w, z + h), K, .5 * K, 0, K, l, h, col, .84, key, tip, sel)
          + face(pr(x, y, z + h), K, .5 * K, -K, .5 * K, l, w, col, 1.1, key, tip, sel);
      let html = cub(0, 0, -baseH, PL, PW, baseH, baseCol, null, false);
      [...units].sort((a, b) => (a.x + a.y + a.z) - (b.x + b.y + b.z)).forEach(u => {
        const key = pi + ":" + u.gi + ":" + u.k;
        const inf = info[u.code] || {};
        const tip = `${escapeAttr(u.code)} · ${escapeAttr(inf.name || "")} — 1 кашон × ${u.per} бр.${u.part ? " (непълен)" : ""}${inf.boxSize ? " · " + escapeAttr(inf.boxSize) : ""}. Клик = маркирай, влачи = премести.`;
        html += cub(u.x, u.y, u.z, u.l, u.w, u.h, packColor(u.code), key, SEL.has(key), tip);
        if (u.part) { const c = pr(u.x + u.l / 2, u.y + u.w / 2, u.z + u.h); html += `<span class="pk3i-part" style="left:${c[0]}px;top:${c[1]}px">${u.per} бр.</span>`; }
      });
      // По една табелка на артикул — четима, не се върти с кутиите.
      const byG = new Map();
      units.forEach(u => { const c = pr(u.x + u.l / 2, u.y + u.w / 2, u.z + u.h); const a = byG.get(u.gi) || { n: 0, sx: 0, sy: 0, gi: u.gi }; a.n++; a.sx += c[0]; a.sy += c[1]; byG.set(u.gi, a); });
      byG.forEach(a => {
        const g = (p.g || [])[a.gi]; if (!g) return;
        html += `<span class="pk3i-lbl">${escapeHtml(packBoxLabel((info[g.code] || {}).name, g.code))} · ${g.boxes}×${g.per}</span>`.replace("class=\"pk3i-lbl\"", `class="pk3i-lbl" style="left:${Math.round(a.sx / a.n)}px;top:${Math.round(a.sy / a.n) - 8}px"`);
      });
      return `<div class="pk3i-scene" style="width:${W}px;height:${H}px">${html}</div>`;
    };
    const dropBtn = pi => `<button class="btn btn-small btn-primary" data-moveto="${pi}" style="display:none">⤵ Тук</button>`;
    const palletHtml = (p, pi) => {
      const g = p.g || [];
      // Малкият палет 60×80 побира половината кашони на 120×80.
      const capOf = x => { const c = packNum((info[x.code] || {}).perPallet) || x.boxes || 1; return p.small ? Math.max(1, c / 2) : c; };
      const pct = Math.round(g.reduce((s, x) => s + x.boxes / capOf(x), 0) * 100);
      const kg = g.reduce((s, x) => s + x.boxes * x.per * packNum((info[x.code] || {}).kgPer), 0);
      return `<div class="pk3d-pallet${pct > 100 ? " pk3d-overfull" : ""}" data-pi="${pi}">
        <div class="pk3d-head"><b>Палет №${pi + 1}</b><span><button type="button" class="btn btn-small" data-palsize="${pi}" title="Смени размера: стандартен евро 120×80 ↔ малък 60×80">${p.small ? "60×80" : "120×80"}</button> ${pct}%${kg ? " · " + Math.round(kg * 10) / 10 + " кг" : ""}${g.length > 1 ? " · комбиниран" : ""}</span></div>
        <div class="pk3d-fill${pct > 100 ? " over" : ""}"><div style="width:${Math.min(100, pct)}%"></div></div>
        ${g.length ? pal3d(p, pi) : `${pal3d(p, pi)}<div class="erp-muted" style="text-align:center">празен палет</div>`}
        <div class="pk3d-actions">
          ${dropBtn(pi)}
          ${g.length ? `<label style="font-size:12px;white-space:nowrap;cursor:pointer" title="Пази ТОЗИ палет като стандартен за клиента (с точните бройки). Следваща заявка го нарежда пак така и го повтаря, докато има пълни кашони. Записва се със „Запази опаковката"."><input type="checkbox" data-rem="${pi}"${p.rem ? " checked" : ""}> 🧠 Запомни</label>` : `<button class="btn btn-small btn-danger" data-delpal="${pi}">× Махни</button>`}
        </div>
      </div>`;
    };
    // 🎯 БУФЕРЪТ (подът): кашоните извън палетите лежат на земята — пак 3D.
    const trayCnt = P.tray.reduce((s, x) => s + x.boxes, 0);
    const floorHtml = `<div class="pk3d-pallet pk3d-floor" data-pi="-1" title="Хвърли кашони тук (влачене), или маркирай и кликни върху пода — отиват в буфера">
        <div class="pk3d-head"><b>🎯 Под (буфер)</b><span>${trayCnt ? trayCnt + " кашона · ⚠ не влизат в Палет описа" : "хвърли кашони тук"}</span></div>
        ${trayCnt ? pal3d({ g: P.tray, floor: 1 }, -1) : '<div class="pk3d-floorempty"><span class="big">🎯</span><span>Пусни кашони тук —<br>лягат на пода, после ги качваш обратно</span></div>'}
        <div class="pk3d-actions">${dropBtn(-1)}</div>
      </div>`;
    box.innerHTML = `<h4 class="erp-group-head">🧱 План на палетите <span class="erp-muted" style="font-weight:400;font-size:12px">— клик върху кашон = маркирай (много), после „⤵ Тук" или клик върху пода; влаченето също работи. „🧠 Запомни" = стандартен палет за клиента.</span></h4>
      <div class="hint" id="pk3d-selbar" style="margin:4px 0" hidden>✔ Маркирани: <b id="pk3d-selcnt">0</b> кашона — „⤵ Тук" на целта (палет или пода), или <button class="btn btn-small" id="pk3d-desel">откажи</button></div>
      <div class="pk3d-wrap">${P.plan.map(palletHtml).join("")}
        ${floorHtml}
        <div class="pk3d-pallet pk3d-newpal">
          <button class="btn btn-small" id="pk3d-add">+ Палет</button>
          <button class="btn btn-small" id="pk3d-auto" title="Строи плана наново: цели палети по изделие + комбинирани остатъци">↺ Авто подредба</button>
          <button class="btn btn-small" id="pk3d-clear" title="Сваля всички кашони на пода — редиш палетите от нулата">⬇ Всичко на пода</button>
        </div>
      </div>`;
    const updateSelUI = () => {
      const bar = box.querySelector("#pk3d-selbar"); if (bar) bar.hidden = !SEL.size;
      const c = box.querySelector("#pk3d-selcnt"); if (c) c.textContent = SEL.size;
      box.querySelectorAll("[data-moveto]").forEach(b => { b.style.display = SEL.size ? "" : "none"; b.textContent = "⤵ Тук (" + SEL.size + ")"; });
    };
    box.querySelectorAll("[data-key]").forEach(b => {
      const key = b.dataset.key;
      // Маркиране БЕЗ прерисуване — само класове + броячи (мигновено).
      b.addEventListener("click", e => {
        e.stopPropagation();
        if (SEL.has(key)) SEL.delete(key); else SEL.add(key);
        box.querySelectorAll(`[data-key="${key}"]`).forEach(f => f.classList.toggle("selq", SEL.has(key)));
        updateSelUI();
      });
      b.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", key); });
    });
    box.querySelectorAll(".pk3d-pallet[data-pi]").forEach(card => {
      card.addEventListener("dragover", e => { e.preventDefault(); card.classList.add("pk3d-over"); });
      card.addEventListener("dragleave", () => card.classList.remove("pk3d-over"));
      card.addEventListener("drop", e => {
        e.preventDefault(); card.classList.remove("pk3d-over");
        const m = String(e.dataTransfer.getData("text/plain") || "").match(/^(-?\d+):(\d+):(\d+)$/);
        if (!m) return;
        const key = m[0], toPi = Number(card.dataset.pi);
        // влачиш маркиран кашон → мести цялата селекция; иначе само този
        setTimeout(() => { if (!SEL.has(key)) { SEL.clear(); SEL.add(key); } moveSel(toPi); }, 0);
      });
    });
    box.querySelectorAll("[data-moveto]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); moveSel(Number(b.dataset.moveto)); }));
    box.querySelectorAll("[data-delpal]").forEach(b => b.addEventListener("click", () => { P.plan.splice(Number(b.dataset.delpal), 1); SEL.clear(); renderPlan(); refreshStats(); }));
    box.querySelectorAll("[data-palsize]").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      const p = P.plan[Number(b.dataset.palsize)]; if (!p) return;
      p.small = p.small ? 0 : 1;
      renderPlan(); refreshStats();
    }));
    const desel = box.querySelector("#pk3d-desel"); if (desel) desel.addEventListener("click", () => { SEL.clear(); renderPlan(); });
    const fl = box.querySelector(".pk3d-floor"); if (fl) fl.addEventListener("click", e => {
      if (e.target.closest("[data-key]") || e.target.closest("button")) return;
      if (SEL.size) moveSel(-1);
    });
    box.querySelectorAll("[data-rem]").forEach(c => c.addEventListener("change", () => {
      const p = P.plan[Number(c.dataset.rem)]; if (p) p.rem = c.checked ? 1 : 0;
    }));
    const add = box.querySelector("#pk3d-add"); if (add) add.addEventListener("click", () => { P.plan.push({ small: 0, g: [] }); renderPlan(); });
    const auto = box.querySelector("#pk3d-auto"); if (auto) auto.addEventListener("click", () => { P.plan = packPlanAuto(rows); P.planSig = sig; P.tray = []; SEL.clear(); renderPlan(); refreshStats(); });
    const clr = box.querySelector("#pk3d-clear"); if (clr) clr.addEventListener("click", () => {
      P.plan.forEach(p => (p.g || []).forEach(g => {
        const same = P.tray.find(x => x.code === g.code && x.per === g.per && !x.part === !g.part);
        if (same) same.boxes += g.boxes; else P.tray.push({ ...g });
      }));
      P.plan.forEach(p => { p.g = []; });
      SEL.clear(); renderPlan(); refreshStats();
    });
    updateSelUI();
  };
  render();
}

/* Кашоните на едно изделие: пълни кашони + един непълен с остатъка.
   Пример: 150 бр. по 56 в кашон → 2×56 + 1×38 (текстът е за жените на кашоните). */
function packBoxBreakdown(qty, perBox) {
  const pb = packNum(perBox);
  if (!(pb > 0) || !(qty > 0)) return { full: 0, rest: 0, boxes: 0, text: "" };
  const full = Math.floor(qty / pb);
  const rest = Math.round((qty - full * pb) * 100) / 100;
  const boxes = full + (rest > 0 ? 1 : 0);
  const parts = [];
  if (full > 0) parts.push(`${full}×${pb}`);
  if (rest > 0) parts.push(`1×${rest}`);
  return { full, rest, boxes, text: parts.join(" + ") };
}

/* Разпределя кашоните по палети — както се прави на рампата:
   1) всяко изделие първо пълни ЦЕЛИ палети само със свои кашони;
   2) остатъчните кашони от ВСИЧКИ изделия се комбинират на общи палети —
      частта от палета на всяко изделие е кашони ÷ кашони-на-палет,
      редим най-големите остатъци първи и допълваме, докато палетът се напълни. */
function packBuildPallets(rows) {
  const items = rows.filter(r => r.boxes > 0).map(r => {
    const pb = packNum(r.perBox) || 0;
    const bd = packBoxBreakdown(r.qty, pb);
    return { r, pb, perPal: packNum(r.perPallet) || bd.boxes || 1, full: bd.full, rest: bd.rest };
  });
  const left = it => it.full + (it.rest > 0 ? 1 : 0);
  const take = (it, n) => { // сваля n кашона от изделието (пълните първи, непълният последен)
    const f = Math.min(n, it.full); it.full -= f;
    let restQty = 0;
    if (f < n && it.rest > 0) { restQty = it.rest; it.rest = 0; }
    const boxes = f + (restQty > 0 ? 1 : 0);
    const qty = f * it.pb + restQty;
    const parts = []; if (f > 0) parts.push(`${f}×${it.pb}`); if (restQty > 0) parts.push(`1×${restQty}`);
    return { code: it.r.code, name: it.r.name, boxes, qty, full: f, rest: restQty, pb: it.pb, text: parts.join(" + "), kg: Math.round(qty * packNum(it.r.kgPer) * 10) / 10 };
  };
  const pallets = [];
  // 1) цели палети по изделие
  items.forEach(it => { while (left(it) >= it.perPal) pallets.push({ items: [take(it, it.perPal)] }); });
  // 2) остатъците — на общи (комбинирани) палети, first-fit по заетата част
  const mixed = [];
  items.filter(it => left(it) > 0)
    .map(it => ({ it, frac: left(it) / it.perPal }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(x => {
      let m = mixed.find(mm => mm.frac + x.frac <= 1.0001);
      if (!m) { m = { frac: 0, items: [] }; mixed.push(m); }
      m.items.push(take(x.it, left(x.it))); m.frac += x.frac;
    });
  mixed.forEach(m => pallets.push({ items: m.items }));
  pallets.forEach((p, i) => { p.no = i + 1; });
  return pallets;
}

/* --- РЪЧНИЯТ план на палетите (редактируем; пази се в o.packing.plan) ---
   Планът е списък от палети; всеки палет е списък групи {code, boxes, per, part}
   (part = непълен кашон). Подписът пази плана валиден: промени ли се заявката
   (бройки/кашони), планът се строи наново от автоматиката. */
function packPlanSig(rows) { return rows.map(r => `${r.code}|${r.qty}|${packNum(r.perBox)}|${packNum(r.perPallet)}`).join(";"); }
/* Палет в плана: { small: 0|1, g: [групи] }. small = малък палет 60×80
   (половин вместимост и половин тегло); стандартът е ЕВРО ПАЛЕТ 120×80. */
function packPlanNorm(P) {
  if (P && Array.isArray(P.plan)) P.plan = P.plan.map(p => Array.isArray(p) ? { small: 0, g: p } : (p && Array.isArray(p.g) ? p : { small: 0, g: [] }));
}
function packPlanAuto(rows) {
  return packBuildPallets(rows).map(p => {
    const g = [];
    p.items.forEach(x => {
      if (x.full > 0) g.push({ code: x.code, boxes: x.full, per: x.pb });
      if (x.rest > 0) g.push({ code: x.code, boxes: 1, per: x.rest, part: 1 });
    });
    return { small: 0, g };
  });
}
/* Палетите за ДОКУМЕНТИТЕ: ръчният план (ако е валиден), иначе автоматиката. */
function packPlanPallets(rows, P) {
  rows = rows.filter(r => r.boxes > 0);
  if (!P || !Array.isArray(P.plan) || P.planSig !== packPlanSig(rows)) return packBuildPallets(rows).map(p => ({ ...p, small: 0 }));
  packPlanNorm(P);
  const info = {}; rows.forEach(r => { info[r.code] = r; });
  return P.plan.map(p => {
    const by = new Map();
    (p.g || []).forEach(x => {
      const it = by.get(x.code) || { code: x.code, name: (info[x.code] || {}).name || "", boxes: 0, qty: 0, parts: [] };
      it.boxes += x.boxes; it.qty += x.boxes * x.per; it.parts.push(`${x.boxes}×${x.per}`);
      by.set(x.code, it);
    });
    return { small: p.small ? 1 : 0, items: [...by.values()].map(it => ({ ...it, text: it.parts.join(" + "), kg: Math.round(it.qty * packNum((info[it.code] || {}).kgPer) * 10) / 10 })) };
  }).filter(p => p.items.length).map((p, i) => ({ ...p, no: i + 1 }));
}
/* --- СТАНДАРТНИ ПАЛЕТИ (запомнени по клиент) ---
   Запомнят се само палетите с отметка „🧠 Запомни" — с ТОЧНИТЕ бройки
   кашони (стандартният палет на клиента). При нова заявка всеки
   стандартен палет се нарежда отново и се ПОВТАРЯ, докато има пълни
   кашони за него; остатъкът минава през автоматиката. */
function packLayoutTemplate(P) {
  const pallets = (P.plan || []).filter(p => p.rem).map(p => {
    const per = {}; (p.g || []).forEach(x => { per[x.code] = (per[x.code] || 0) + x.boxes; });
    return { small: p.small ? 1 : 0, items: Object.keys(per).map(code => ({ code, boxes: per[code] })) };
  }).filter(p => p.items.length);
  return pallets.length ? { pallets } : null;
}
function packPlanFromTemplate(rows, clientName) {
  const t = PACK_LAYOUTS && PACK_LAYOUTS[packNorm(clientName)];
  if (!t || !Array.isArray(t.pallets) || !t.pallets.length) return null;
  const avail = {}, pbOf = {};
  rows.forEach(r => { const bd = packBoxBreakdown(r.qty, packNum(r.perBox)); avail[r.code] = { full: bd.full, rest: bd.rest }; pbOf[r.code] = packNum(r.perBox); });
  const plan = [];
  let made = false;
  t.pallets.forEach(tp => {
    const items = (tp.items || []).filter(it => it.boxes > 0);
    if (!items.length) return;
    const fits = () => items.every(it => avail[it.code] && avail[it.code].full >= it.boxes);
    let guard = 0;
    while (fits() && guard++ < 500) {   // повтаряме стандартния палет, докато има пълни кашони
      const g = items.map(it => { avail[it.code].full -= it.boxes; return { code: it.code, boxes: it.boxes, per: pbOf[it.code] }; });
      plan.push({ small: tp.small ? 1 : 0, g, rem: 1 });
      made = true;
    }
  });
  if (!made) return null;
  // Остатъкът (вкл. непълните кашони) — през автоматиката.
  const restRows = rows.map(r => {
    const a = avail[r.code]; if (!a) return null;
    const qty = a.full * pbOf[r.code] + a.rest;
    return qty > 0 ? { ...r, qty, boxes: a.full + (a.rest > 0 ? 1 : 0) } : null;
  }).filter(Boolean);
  packPlanAuto(restRows).forEach(p => plan.push(p));
  return plan;
}

/* Тегло на празния палет: 120×80 = настройката; 60×80 = половината. */
function packPalletsKg(pallets, palletKg) {
  const pk = packNum(palletKg || 20);
  return Math.round(pallets.reduce((s, p) => s + (p.small ? pk / 2 : pk), 0) * 10) / 10;
}
/* Етикет на кутията в 3D плана — първите дума-две от ИМЕТО (Hook, Bench legs…). */
function packBoxLabel(name, code) {
  const ws = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!ws.length) return String(code || "");
  let l = ws[0];
  if (ws[1] && (l + " " + ws[1]).length <= 16) l += " " + ws[1];
  return l;
}
/* Цвят на изделие в 3D плана — постоянен за даден код. */
function packColor(code) {
  let h = 0; const s = String(code || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h},62%,46%)`;
}
/* Клиент на латиница (без кирилица) = ИЗНОС → придружаващите документи на английски. */
function packIsExport(o) { const n = String((o && o.clientName) || ""); return /[A-Za-z]/.test(n) && !/[А-Яа-я]/.test(n); }
function packDocHead(o, title, en) {
  const L = en ? { ord: "Order", cl: "Client", dt: "Date" } : { ord: "Заявка", cl: "Клиент", dt: "Дата" };
  return `<div class="head"><div><h1>${title}</h1>
      <div>${L.ord}: <b>${escapeHtml(o.ourNo || "—")}</b>${o.clientNo ? " · Order No: <b>" + escapeHtml(o.clientNo) + "</b>" : ""}</div></div>
    <div style="text-align:right">${L.cl}: <b>${escapeHtml(o.clientName || "")}</b><br>${L.dt}: <b>${erpDMY(new Date().toISOString().slice(0, 10))}</b></div></div>`;
}
function packPrintPacking(o, rows, P) {
  const tot = rows.reduce((t, r) => { t.q += r.qty; t.b += r.boxes; t.p += r.pallets; t.n += r.netKg; return t; }, { q: 0, b: 0, p: 0, n: 0 });
  const plPallets = packPlanPallets(rows, P);
  const palletsUp = plPallets.length || Math.ceil(tot.p - 1e-9);
  const plSmall = plPallets.filter(p => p.small).length;
  const plKg = plPallets.length ? packPalletsKg(plPallets, P.palletKg) : palletsUp * packNum(P.palletKg || 20);
  const gross = Math.round((tot.n + plKg) * 10) / 10;
  const body = `${packDocHead(o, "PACKING LIST", packIsExport(o))}
    <table><thead><tr><th>№</th><th>Code</th><th>Description</th><th class="c">Qty</th><th class="c">kg / pc</th><th class="c">Box type</th><th class="c">Pcs / box</th><th class="c">Boxes</th><th class="c">Net kg</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td><b>${escapeHtml(r.code)}</b></td><td>${escapeHtml(r.name)}</td><td class="r">${erpNum(r.qty)}</td><td class="r">${r.kgPer || ""}</td><td>${escapeHtml(r.boxType)}</td><td class="r">${r.perBox || ""}</td><td class="r">${r.boxes || ""}${r.boxes > 1 && r.bdText ? `<br><small>${r.bdText}</small>` : ""}</td><td class="r">${r.netKg || ""}</td></tr>`).join("")}</tbody>
    <tfoot><tr><td colspan="3"><b>TOTAL</b></td><td class="r"><b>${erpNum(tot.q)}</b></td><td></td><td></td><td></td><td class="r"><b>${tot.b}</b></td><td class="r"><b>${Math.round(tot.n * 10) / 10}</b></td></tr></tfoot></table>
    <div class="kv"><b>Pallets:</b> ${plSmall ? `${palletsUp - plSmall} × EUR 120×80 (${packNum(P.palletKg || 20)} kg) + ${plSmall} × 60×80 (${packNum(P.palletKg || 20) / 2} kg)` : `${palletsUp} × EUR 120×80 (${packNum(P.palletKg || 20)} kg)`} — total ${plKg} kg</div>
    <div class="kv"><b>Total net weight:</b> ${Math.round(tot.n * 10) / 10} kg · <b>Total gross weight:</b> ${gross} kg</div>`;
  invPrintWindow("Packing List — заявка " + (o.ourNo || ""), body, "en");
}
function packPrintGoods(o, rows) {
  const en = packIsExport(o);
  const L = en ? { title: "DELIVERY NOTE", code: "Code", name: "Description", qty: "Qty", boxes: "Boxes", from: "Issued by", to: "Received by", win: "Delivery Note — order " }
    : { title: "СТОКОВА РАЗПИСКА", code: "Код", name: "Наименование", qty: "Бройка", boxes: "Кашони", from: "Предал", to: "Приел", win: "Стокова разписка — заявка " };
  const body = `${packDocHead(o, L.title, en)}
    <table><thead><tr><th>№</th><th>${L.code}</th><th>${L.name}</th><th class="c">${L.qty}</th><th class="c">${L.boxes}</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td><b>${escapeHtml(r.code)}</b></td><td>${escapeHtml(r.name)}</td><td class="r">${erpNum(r.qty)}</td><td class="r">${r.boxes || ""}${r.boxes > 1 && r.bdText ? `<br><small>${r.bdText}</small>` : ""}</td></tr>`).join("")}</tbody></table>
    <div class="foot"><div>${L.from}: ................</div><div>${L.to}: ................</div></div>`;
  invPrintWindow(L.win + (o.ourNo || ""), body, en ? "en" : "bg");
}
function packPrintPallets(o, rows, P) {
  const pallets = packPlanPallets(rows, P);
  const en = packIsExport(o);
  const L = en ? { title: "PALLET LIST", pal: "PALLET No", mix: "mixed", net: "Net weight", plt: "Pallet", gr: "Gross weight", code: "Code", name: "Description", boxes: "Boxes", qty: "Qty", kg: "Net kg", tot: "Total pallets", ord: "Order No", none: "No pallets — fill in boxes per pallet.", win: "Pallet List — order " }
    : { title: "ПАЛЕТ ОПИС / PALLET LIST", pal: "ПАЛЕТ №", mix: "комбиниран", net: "Нето", plt: "Палет", gr: "Бруто", code: "Код", name: "Наименование", boxes: "Кашони", qty: "Бройка", kg: "Нето кг", tot: "Общо палети", ord: "Order No (клиентски №)", none: "Няма палети — попълни кашоните на палет.", win: "Палет опис — заявка " };
  const kgU = en ? "kg" : "кг";
  const base = new URL(".", location.href).href;
  // Всеки палет на ОТДЕЛЕН лист А4 (вертикален) с ЛОГО, ЕДЪР шрифт и подпис.
  const pageCss = `<style>
    .palpage{font-size:17px}
    .palpage h1{font-size:28px}
    .palpage .head > div{font-size:21px;line-height:1.45}
    .palpage table th,.palpage table td{font-size:17px;padding:8px 10px}
    .palpage .kv{font-size:18px;margin:8px 0}
    .palpage .made{margin-top:30px;font-size:12px;color:#666;text-align:center}
  </style>`;
  const body = pageCss + (pallets.map((p, idx) => {
    const kg = Math.round(p.items.reduce((s, x) => s + x.kg, 0) * 10) / 10;
    const palKg = p.small ? packNum(P.palletKg || 20) / 2 : packNum(P.palletKg || 20);
    return `<div class="palpage" style="${idx < pallets.length - 1 ? "page-break-after:always" : ""}">
      <div class="lg"><img src="${base}welcome.svg?v=144" alt="DankoSystems" /></div>
      ${packDocHead(o, L.title, en)}
      <h2 style="margin:12px 0 6px;font-size:34px;letter-spacing:1px">${L.pal} ${p.no} / ${pallets.length} <span style="font-weight:400;font-size:21px;color:#555">· ${p.small ? "60×80" : "EUR 120×80"}${p.items.length > 1 ? " · " + L.mix : ""}</span></h2>
      <div class="kv" style="font-size:22px"><b>${L.ord}:</b> ${escapeHtml(o.clientNo || "—")}</div>
      <table><thead><tr><th>${L.code}</th><th>${L.name}</th><th class="c">${L.boxes}</th><th class="c">${L.qty}</th><th class="c">${L.kg}</th></tr></thead>
      <tbody>${p.items.map(x => `<tr><td><b>${escapeHtml(x.code)}</b></td><td>${escapeHtml(x.name)}</td><td class="r">${x.boxes}${x.text && x.boxes > 1 ? ` <small>(${x.text})</small>` : ""}</td><td class="r">${erpNum(x.qty)}</td><td class="r">${x.kg}</td></tr>`).join("")}</tbody></table>
      <div class="kv"><b>${L.net}:</b> ${kg} ${kgU} · <b>${L.plt}:</b> ${palKg} ${kgU} · <b>${L.gr}:</b> ${Math.round((kg + palKg) * 10) / 10} ${kgU}</div>
      ${idx === pallets.length - 1 ? `<div class="kv"><b>${L.tot}:</b> ${pallets.length}</div>` : ""}
      <div class="made">The Systems</div>
    </div>`;
  }).join("") || `<p>${L.none}</p>`);
  invPrintWindow(L.win + (o.ourNo || ""), body, en ? "en" : "bg", { noLogo: true, noMade: true });
}
