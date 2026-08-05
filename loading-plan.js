/* Данко Системс — „🚚 План за седмицата (експедиция)".
   Кратък и ясен план: КОИ ЗАЯВКИ излизат тази седмица, с колко палета и кила.
   Цяла клиентска заявка влиза с един клик („📋 Добави заявка") — редовете и
   бройките се попълват от недоставеното, кг и палети идват от ОПАКОВКИ — и
   после се РЕДАКТИРАТ (маха се това, което няма да излезе).
   Колоната „В склада" показва готово ли е изделието (Склад детайли).
   Данните се пазят в app_config (id='loading_plan'), без нов SQL. */

let LP_ITEMS = [];        // [{ id, week (понеделник YYYY-MM-DD), client, goods, kg, pallets, note, createdAt }]
let LP_CLIENTS = [];      // имена на клиенти (от partners kind=customer)
let LP_GOODS = [];        // детайли от Склад детайли (за избор на стока) — "код · име"
let LP_MONDAY = null;     // текущо разглеждан понеделник (Date)
let LP_LOADED = false;
let LP_ORDERS = [];       // активните клиентски заявки (за „📋 Добави заявка")
let LP_SALES = [];        // осчетоводените продажби (по тях се мери изпълнението)

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
  if (typeof weekPlanAllowed === "function" && !weekPlanAllowed()) {
    alert("Планът за седмицата към момента е позволен само на Данко и Григор.");
    return;
  }
  document.getElementById("loading-modal").hidden = false;
  if (!LP_LOADED) {
    await Promise.all([lpLoad(), lpLoadClients(), lpLoadGoods()]);
    LP_LOADED = true;
  }
  if (!LP_MONDAY) LP_MONDAY = lpMondayOfDate(new Date());   // отваря се на ТЕКУЩАТА седмица
  lpRender();
  // Заявките и наличностите идват фоново — планът се пре-рисува, щом дойдат.
  (async () => {
    try { await lpLoadOrders(); } catch (e) {}
    try { await lpLoadSales(); } catch (e) {}
    try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); } catch (e) {}
    if (!document.getElementById("loading-modal").hidden) lpRender();
  })();
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

/* ---------- Заявките на клиенти (за „+ Добави заявка") ---------- */
async function lpLoadOrders() {
  try {
    if ((typeof erpCOList === "undefined" || !erpCOList) && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders();
    LP_ORDERS = ((typeof erpCOList !== "undefined" && erpCOList) || []).filter(o => (o.status || "") !== "завършена");
  } catch (e) { LP_ORDERS = []; }
}
// Недоставеното по ред (това влиза в плана по подразбиране).
function lpLineLeft(l) {
  const q = lpToNum(l.qty), d = lpToNum(l.delivered);
  return Math.max(0, q - d);
}
// Наличност на код в Склад детайли (за колоната „готово").
function lpStockOfCode(code) {
  if (typeof ERP === "undefined" || !ERP.products) return null;
  const c = String(code || "").trim(); if (!c) return null;
  const p = (ERP.products || []).find(x => String(x.code || "").trim() === c);
  if (!p) return null;
  return Number((ERP.prodStock && ERP.prodStock[p.id]) != null ? ERP.prodStock[p.id] : p.stock) || 0;
}

/* Заявка → редове за плана: недоставените бройки + кг и палети от ОПАКОВКИ. */
async function lpLinesFromOrder(o) {
  let pack = [];
  try { if (typeof erpPackDocRows === "function") pack = await erpPackDocRows(o); } catch (e) { pack = []; }
  const byKey = {};
  (pack || []).forEach(r => { byKey[String(r.code || "")] = r; });
  return (o.lines || []).map(l => {
    // САМО остатъкът: поръчано − вече доставено. Напълно доставен ред отпада.
    const left = lpLineLeft(l);
    if (!(left > 0)) return null;
    const pr = byKey[String(l.code || "")] || {};
    // Кг/палети се смятат за ПЛАНИРАНОТО количество, не за цялата заявка.
    const share = (pr.qty > 0) ? (left / pr.qty) : 1;
    const kg = pr.netKg ? Math.round(pr.netKg * share * 10) / 10 : "";
    const pal = pr.pallets ? Math.round(pr.pallets * share * 100) / 100 : "";
    return { code: l.code || "", name: l.ourName || l.name || "", qty: left, kg, pallets: pal };
  }).filter(Boolean);
}

/* ---------- ИЗПЪЛНЕНИЕ: какво реално е излязло (по продажбите) ----------
   Мери се с осчетоводените ПРОДАЖБИ с дата В СЕДМИЦАТА на плана. Каквото не е
   излязло, остава „неизпълнено" и се предлага за прехвърляне в следващата. */
async function lpLoadSales() {
  try {
    if ((typeof erpSales === "undefined" || !erpSales) && typeof erpLoadSales === "function") await erpLoadSales();
    LP_SALES = ((typeof erpSales !== "undefined" && erpSales) || []).filter(s => s.posted);
  } catch (e) { LP_SALES = []; }
}
function lpWeekEnd(mondayStr) {
  const d = new Date(mondayStr + "T00:00:00Z");
  return lpMondayStr(lpAddDays(d, 6));
}
/* Изпратено по този запис (код → бройки) — продажби в неговата седмица. */
function lpShippedMap(x) {
  const from = x.week, to = lpWeekEnd(x.week);
  const out = {};
  const cl = String(x.client || "").trim().toLowerCase();
  (LP_SALES || []).forEach(sa => {
    const d = String(sa.date || "").slice(0, 10);
    if (!d || d < from || d > to) return;
    const sameOrder = x.orderId && String(sa.fromOrderId || "") === String(x.orderId);
    const sameClient = !x.orderId && cl && String(sa.clientName || "").trim().toLowerCase() === cl;
    if (!sameOrder && !sameClient) return;
    (sa.lines || []).forEach(l => {
      const c = String(l.code || "").trim(); if (!c) return;
      out[c] = (out[c] || 0) + (lpToNum(l.qty) || 0);
    });
  });
  return out;
}
/* Обобщение на изпълнението: планирано/изпратено/остава (по бройки) + редове. */
function lpProgress(x) {
  const ship = lpShippedMap(x);
  const lines = lpItemLines(x).map(l => {
    const plan = lpToNum(l.qty);
    const sent = l.code ? Math.min(plan, lpToNum(ship[String(l.code).trim()])) : 0;
    return { l, plan, sent, left: Math.max(0, plan - sent), tracked: !!l.code };
  });
  const plan = lines.reduce((s, r) => s + r.plan, 0);
  const sent = lines.reduce((s, r) => s + r.sent, 0);
  const doneN = lines.filter(r => r.plan > 0 && r.left <= 0).length;
  return { lines, plan, sent, left: Math.max(0, plan - sent), pct: plan > 0 ? Math.round(sent / plan * 100) : 0, doneN, n: lines.length };
}
/* ---------- ИЗОСТАВАНЕ ----------
   Записът помни от коя седмица е тръгнал (carriedOrig) и колко пъти е местен
   (carryN). По-старите записи знаят само предишната седмица (carriedFrom) —
   за тях броим едно прехвърляне. */
function lpWeeksBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 6048e5);
}
function lpLate(x) {
  const orig = x.carriedOrig || x.carriedFrom || "";
  if (!orig) return null;
  return {
    orig,
    from: x.carriedFrom || orig,
    weeks: Math.max(1, lpWeeksBetween(orig, x.week)),
    times: Number(x.carryN) || 1,
  };
}
function lpWeeksWord(n) { return n === 1 ? "1 седмица" : n + " седмици"; }
/* Неизпълненото от ПРЕДИШНИ седмици (до 8 назад), което още не е прехвърлено. */
function lpPendingBefore(mondayStr) {
  return (LP_ITEMS || []).filter(x => {
    if (x.week >= mondayStr || x.carried) return false;
    const d = (new Date(mondayStr + "T00:00:00Z") - new Date(x.week + "T00:00:00Z")) / 864e5;
    if (d > 56) return false;                       // по-старо от 8 седмици не гоним
    return lpProgress(x).left > 0;
  });
}
/* Прехвърля неизпълненото в показваната седмица (слива по заявка). */
async function lpCarryOver() {
  const target = lpMondayStr(LP_MONDAY);
  const src = lpPendingBefore(target);
  if (!src.length) { alert("Няма неизпълнено за прехвърляне."); return; }
  const txt = src.map(x => `• ${x.client || ""}${x.orderNo ? " № " + x.orderNo : ""} — остават ${lpFmtNum(lpProgress(x).left)} бр.`).join("\n");
  if (!confirm(`Да прехвърля ли неизпълненото в тази седмица?\n\n${txt}\n\nБройките се намаляват с вече изпратеното; старите записи остават като история.`)) return;
  src.forEach(x => {
    const pr = lpProgress(x);
    const left = pr.lines.filter(r => r.left > 0).map(r => {
      const k = r.plan > 0 ? r.left / r.plan : 1;   // кг и палети следват остатъка
      return {
        code: r.l.code || "", name: r.l.name || r.l.goods || "", qty: r.left,
        kg: lpToNum(r.l.kg) ? Math.round(lpToNum(r.l.kg) * k * 10) / 10 : "",
        pallets: lpToNum(r.l.pallets) ? Math.round(lpToNum(r.l.pallets) * k * 100) / 100 : "",
      };
    });
    if (!left.length) return;
    // Ако същата заявка вече е в целевата седмица — сливаме редовете.
    const same = x.orderId && LP_ITEMS.find(y => y.week === target && String(y.orderId || "") === String(x.orderId));
    if (same) {
      const byCode = {};
      lpItemLines(same).forEach(l => { byCode[String(l.code || l.name || "")] = l; });
      left.forEach(l => {
        const k = String(l.code || l.name || "");
        if (byCode[k]) { byCode[k].qty = lpToNum(byCode[k].qty) + l.qty; }
        else same.lines = (same.lines || []).concat([l]);
      });
      same.carriedFrom = x.week;
      // Изостава от най-ранната планирана седмица на двете слети.
      const o = [same.carriedOrig, x.carriedOrig, x.week].filter(Boolean).sort()[0];
      same.carriedOrig = o;
      same.carryN = Math.max(Number(same.carryN) || 0, (Number(x.carryN) || 0) + 1);
    } else {
      LP_ITEMS.push({
        id: "lp_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
        week: target, client: x.client || "", lines: left, note: x.note || "",
        orderNo: x.orderNo || "", due: x.due || "", orderId: x.orderId || null,
        carriedFrom: x.week, carriedOrig: x.carriedOrig || x.week,
        carryN: (Number(x.carryN) || 0) + 1, createdAt: new Date().toISOString(),
      });
    }
    x.carried = target;
  });
  await lpSave();
  lpRender();
}

/* ---------- Рендиране ---------- */
function lpRender() {
  const v = document.getElementById("loading-view");
  if (!v) return;
  const mondayStr = lpMondayStr(LP_MONDAY);
  const wk = lpISOWeek(LP_MONDAY);
  const sunday = lpAddDays(LP_MONDAY, 6);
  const items = LP_ITEMS.filter(x => x.week === mondayStr)
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")) || (a.client || "").localeCompare(b.client || "", "bg"));
  const totKg = items.reduce((s, x) => s + lpItemKg(x), 0);
  const totPal = items.reduce((s, x) => s + lpItemPal(x), 0);
  const totLines = items.reduce((s, x) => s + lpItemLines(x).filter(l => l.code || l.goods || l.name).length, 0);
  // Изпълнение на седмицата (по бройки) + неизпълненото от предишните.
  const wPlan = items.reduce((s, x) => s + lpProgress(x).plan, 0);
  const wSent = items.reduce((s, x) => s + lpProgress(x).sent, 0);
  const wPct = wPlan > 0 ? Math.round(wSent / wPlan * 100) : 0;
  const wDone = items.filter(x => { const p = lpProgress(x); return p.plan > 0 && p.left <= 0; }).length;
  const pend = lpPendingBefore(mondayStr);
  const pendQty = pend.reduce((s, x) => s + lpProgress(x).left, 0);

  // Изостанали: прехвърляни от предишна седмица и още неизпълнени.
  const lateItems = items.filter(x => lpLate(x) && lpProgress(x).left > 0);
  const lateQty = lateItems.reduce((s, x) => s + lpProgress(x).left, 0);

  const card = x => {
    const pr = lpProgress(x);
    const late = lpLate(x);
    const isLate = !!late && pr.left > 0;
    const kg = lpItemKg(x), pal = lpItemPal(x);
    const rows = pr.lines.map(r => {
      const l = r.l;
      const nm = l.code ? `<b>${escapeHtml(l.code)}</b> ${escapeHtml(l.name || "")}` : escapeHtml(l.goods || l.name || "");
      const have = l.code ? lpStockOfCode(l.code) : null;
      const done = r.plan > 0 && r.left <= 0;
      const sent = !r.tracked ? `<span class="lp-muted" title="Редът няма код — не се следи по продажбите">—</span>`
        : (done ? `<span class="lp-ok">✅ ${lpFmtNum(r.sent)}</span>`
          : (r.sent > 0 ? `<span class="lp-part">${lpFmtNum(r.sent)} · остават ${lpFmtNum(r.left)}</span>`
            : `<span class="lp-none">още не</span>`));
      const ready = (have == null || !r.plan || done) ? "" : (have >= r.left
        ? `<span class="lp-ok">✅ готово</span>`
        : `<span class="lp-part" title="в Склад детайли">⏳ ${lpFmtNum(have)} от ${lpFmtNum(r.left)}</span>`);
      return `<tr class="${done ? "lp-row-done" : ""}">
        <td>${nm}</td>
        <td class="num">${r.plan ? lpFmtNum(r.plan) + " бр." : "—"}</td>
        <td class="num">${sent}</td>
        <td class="num">${l.pallets !== "" && l.pallets != null ? lpFmtNum(l.pallets) : "—"}</td>
        <td class="num">${l.kg !== "" && l.kg != null ? lpFmtNum(l.kg) : "—"}</td>
        <td>${ready}</td></tr>`;
    }).join("");
    const badge = pr.plan <= 0 ? ""
      : (pr.left <= 0 ? `<span class="lp-badge lp-b-ok">✅ изпълнена</span>`
        : (pr.sent > 0 ? `<span class="lp-badge lp-b-part">🟡 ${pr.pct}% · остават ${lpFmtNum(pr.left)} бр.</span>`
          : `<span class="lp-badge lp-b-no">⬜ още не е тръгвала</span>`));
    const lateChip = !late ? ""
      : (isLate
        ? `<span class="lp-late" title="Първо планирана за седмицата от ${escapeAttr(lpFmtDate(late.orig))}. Прехвърляна ${late.times} ${late.times === 1 ? "път" : "пъти"}; последно от ${escapeAttr(lpFmtDate(late.from))}.">⚠ ИЗОСТАВА с ${lpWeeksWord(late.weeks)}</span>`
        : `<span class="lp-carry" title="Прехвърлена от седмицата на ${escapeAttr(lpFmtDate(late.from))} — вече е изпълнена">⤳ наваксана</span>`);
    return `<div class="lp-card${pr.plan > 0 && pr.left <= 0 ? " lp-card-done" : ""}${isLate ? " lp-card-late" : ""}">
      <div class="lp-card-h">
        <span class="lp-cl">${escapeHtml(x.client || "—")}</span>
        ${x.orderNo ? `<span class="lp-no">📋 № ${escapeHtml(String(x.orderNo))}</span>` : ""}
        ${x.due ? `<span class="lp-due">срок ${escapeHtml(lpFmtDate(x.due))}</span>` : ""}
        ${lateChip}
        ${badge}
        <span class="spacer" style="flex:1"></span>
        <span class="lp-sum"><b>${lpFmtNum(pal)}</b> пал. · <b>${lpFmtNum(kg)}</b> кг</span>
        <button class="btn btn-small lp-edit" data-id="${x.id}" title="Редактирай">✎</button>
        <button class="btn btn-small lp-del" data-id="${x.id}" title="Махни от плана">×</button>
      </div>
      <table class="report-table lp-lines">
        <thead><tr><th>Изделие</th><th class="num">План</th><th class="num">Изпратено</th><th class="num">Палети</th><th class="num">Кг</th><th>В склада</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${x.note ? `<div class="lp-note">📝 ${escapeHtml(x.note)}</div>` : ""}
    </div>`;
  };

  v.innerHTML = `
    <div class="lp-toolbar">
      <button class="btn btn-small" id="lp-prev">◀</button>
      <div class="lp-weeklabel">Седмица <b>${wk.week}</b> <span class="lp-muted">· ${lpFmtDM(LP_MONDAY)}–${lpFmtDM(sunday)}.${sunday.getUTCFullYear()}</span></div>
      <button class="btn btn-small" id="lp-next">▶</button>
      <button class="btn btn-small" id="lp-today" title="Текущата седмица">⌂ Тази седмица</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small" id="lp-print" title="Разпечатай плана за седмицата">🖨</button>
      <button class="btn btn-small" id="lp-add">+ Ръчно</button>
      <button class="btn btn-small btn-primary" id="lp-add-order">📋 Добави заявка</button>
    </div>
    <div class="lp-stats">
      <span>Заявки за експедиция: <b>${items.length}</b>${wDone ? ` <span class="lp-ok">(${wDone} изпълнени)</span>` : ""}</span>
      <span>Изделия: <b>${totLines}</b></span>
      <span>Палети: <b>${lpFmtNum(totPal)}</b></span>
      <span>Общо тегло: <b>${lpFmtNum(totKg)}</b> кг</span>
      ${wPlan > 0 ? `<span>Изпълнение: <b>${wPct}%</b> <span class="lp-muted">(${lpFmtNum(wSent)} от ${lpFmtNum(wPlan)} бр.)</span></span>` : ""}
      ${wPlan > 0 ? `<span class="lp-bar"><span style="width:${wPct}%"></span></span>` : ""}
      ${lateItems.length ? `<span class="lp-late-sum">⚠ Изостават: <b>${lateItems.length}</b> ${lateItems.length === 1 ? "заявка" : "заявки"} · ${lpFmtNum(lateQty)} бр.</span>` : ""}
    </div>
    ${lateItems.length ? `<div class="lp-latebar">
      <span>⚠ <b>Изостава от плана</b> — прехвърлено от предишни седмици и още неизпълнено:
        ${lateItems.map(x => escapeHtml((x.client || "") + (x.orderNo ? " № " + x.orderNo : "")) + ` <span class="lp-late-w">(${lpWeeksWord(lpLate(x).weeks)})</span>`).join(" · ")}</span>
    </div>` : ""}
    ${pend.length ? `<div class="lp-carrybar">
      <span>⤳ От предишни седмици <b>не са излезли</b> ${pend.length} ${pend.length === 1 ? "заявка" : "заявки"} (${lpFmtNum(pendQty)} бр.):
        ${pend.slice(0, 4).map(x => escapeHtml((x.client || "") + (x.orderNo ? " № " + x.orderNo : ""))).join(" · ")}${pend.length > 4 ? " …" : ""}</span>
      <button class="btn btn-small btn-primary" id="lp-carry">⤳ Прехвърли ги тук</button>
    </div>` : ""}
    ${items.length ? items.map(card).join("") : `<p class="report-empty">Няма планирани експедиции за тази седмица. Натисни „📋 Добави заявка".</p>`}`;

  v.querySelector("#lp-prev").addEventListener("click", () => { LP_MONDAY = lpAddDays(LP_MONDAY, -7); lpRender(); });
  v.querySelector("#lp-next").addEventListener("click", () => { LP_MONDAY = lpAddDays(LP_MONDAY, 7); lpRender(); });
  v.querySelector("#lp-today").addEventListener("click", () => { LP_MONDAY = lpMondayOfDate(new Date()); lpRender(); });
  v.querySelector("#lp-add").addEventListener("click", () => lpOpenForm(null));
  v.querySelector("#lp-add-order").addEventListener("click", lpOrderPicker);
  v.querySelector("#lp-print").addEventListener("click", () => lpPrintWeek(items, wk, sunday));
  const cb = v.querySelector("#lp-carry"); if (cb) cb.addEventListener("click", lpCarryOver);
  v.querySelectorAll(".lp-edit").forEach(b => b.addEventListener("click", () => lpOpenForm(b.dataset.id)));
  v.querySelectorAll(".lp-del").forEach(b => b.addEventListener("click", () => lpDelete(b.dataset.id)));
}

function lpFmtDate(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }
function lpMondayOfDate(d) {
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (u.getUTCDay() + 6) % 7;
  return new Date(u.getTime() - day * 864e5);
}

/* ---------- 📋 Избор на заявка ---------- */
async function lpOrderPicker() {
  const v = document.getElementById("loading-view");
  if (!LP_ORDERS || !LP_ORDERS.length) {
    const old = v.innerHTML;
    v.innerHTML = `<p class="erp-loading">Зареждам заявките…</p>`;
    await lpLoadOrders();
    try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); } catch (e) {}
    lpRender();
    if (!LP_ORDERS.length) { alert("Няма активни заявки от клиенти."); return; }
  }
  const thisWeek = lpMondayStr(LP_MONDAY);
  const planned = new Set(LP_ITEMS.filter(x => x.week === thisWeek && x.orderId).map(x => String(x.orderId)));
  // Същата заявка, но планирана за ДРУГА седмица — само отбелязваме.
  const otherWeek = {};
  LP_ITEMS.forEach(x => { if (x.orderId && x.week !== thisWeek) otherWeek[String(x.orderId)] = x.week; });
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  const rowsHtml = q => LP_ORDERS
    .filter(o => !q || `${o.ourNo || ""} ${o.clientNo || ""} ${o.clientName || ""}`.toLowerCase().includes(q))
    .sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")))
    .slice(0, 200)
    .map(o => {
      const n = (o.lines || []).length;
      const left = (o.lines || []).reduce((s, l) => s + lpLineLeft(l), 0);
      const tot = (o.lines || []).reduce((s, l) => s + lpToNum(l.qty), 0);
      const done = planned.has(String(o.id));
      const full = !(left > 0);                       // всичко по заявката е доставено
      const ow = otherWeek[String(o.id)];
      const nLeft = (o.lines || []).filter(l => lpLineLeft(l) > 0).length;
      return `<button type="button" class="lp-pick" data-id="${escapeAttr(String(o.id))}" ${done || full ? "disabled" : ""}>
        <span class="lp-pick-l"><b>№ ${escapeHtml(o.ourNo || "—")}</b>${o.clientNo ? ` <span class="lp-muted">(${escapeHtml(o.clientNo)})</span>` : ""} · ${escapeHtml(o.clientName || "")}</span>
        <span class="lp-pick-r">${o.deadline ? "срок " + lpFmtDate(o.deadline) + " · " : ""}${full
          ? "<b>всичко е доставено</b>"
          : `остават <b>${lpFmtNum(left)}</b> от ${lpFmtNum(tot)} бр. · ${nLeft} от ${n} реда`}${done ? " · <b>вече в плана</b>" : ""}${ow && !done ? ` · <span class="lp-muted">в плана за ${lpFmtDate(ow)}</span>` : ""}</span>
      </button>`;
    }).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
  wrap.innerHTML = `
    <div class="overlay-box ask-box lp-form-box">
      <h3>📋 Коя заявка ще излезе тази седмица?</h3>
      <input type="search" id="lp-pq" placeholder="🔎 № / клиент…" autocomplete="off" />
      <div id="lp-plist" class="lp-picklist">${rowsHtml("")}</div>
      <div class="ask-actions"><button id="lp-pcancel" class="btn">Затвори</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#lp-pcancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  const bind = () => wrap.querySelectorAll(".lp-pick").forEach(b => b.addEventListener("click", async () => {
    const o = LP_ORDERS.find(x => String(x.id) === String(b.dataset.id));
    if (!o) return;
    b.disabled = true; b.textContent = "Смятам…";
    const lines = await lpLinesFromOrder(o);
    if (!lines.length) { alert(`Заявка № ${o.ourNo || "—"} няма недоставени бройки — няма какво да се планира.`); close(); return; }
    close();
    lpOpenForm(null, { client: o.clientName || "", orderId: o.id, orderNo: o.ourNo || o.clientNo || "", due: o.deadline || "", lines });
  }));
  bind();
  const qi = wrap.querySelector("#lp-pq");
  qi.addEventListener("input", () => { wrap.querySelector("#lp-plist").innerHTML = rowsHtml(qi.value.trim().toLowerCase()); bind(); });
  setTimeout(() => qi.focus(), 50);
}

/* ---------- Форма (ново/редакция) ---------- */
function lpOpenForm(id, preset) {
  const editing = id ? LP_ITEMS.find(x => x.id === id) : null;
  const mondayStr = lpMondayStr(LP_MONDAY);
  const wk = lpISOWeek(LP_MONDAY);
  const src = editing || preset || {};
  const initLines = (editing ? lpItemLines(editing) : (preset && preset.lines) || [{ code: "", name: "", qty: "", kg: "", pallets: "" }])
    .map(l => ({ code: l.code || "", name: l.name || l.goods || "", qty: l.qty != null ? l.qty : "", kg: l.kg, pallets: l.pallets }));
  // Редовете са РЕШЕТКА (grid), не таблица — колоните не могат да се разминат.
  const lineRow = ln => `
    <div class="lp-lgrid lp-line-row">
      <input type="text" class="lp-l-code" value="${escapeAttr(ln.code || "")}" placeholder="код" />
      <input type="text" class="lp-l-name" list="lp-goods-list" value="${escapeAttr(ln.name || "")}" placeholder="изделие" autocomplete="off" />
      <input type="number" class="lp-l-qty" min="0" step="any" inputmode="decimal" value="${escapeAttr(ln.qty != null ? String(ln.qty) : "")}" placeholder="бр." />
      <input type="number" class="lp-l-pallets" min="0" step="any" inputmode="decimal" value="${escapeAttr(ln.pallets != null ? String(ln.pallets) : "")}" placeholder="пал." />
      <input type="number" class="lp-l-kg" min="0" step="any" inputmode="decimal" value="${escapeAttr(ln.kg != null ? String(ln.kg) : "")}" placeholder="кг" />
      <button type="button" class="btn btn-small lp-l-rm" title="Махни реда">×</button>
    </div>`;
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box lp-form-box">
      <h3>${editing ? "✎ Редакция" : "+ В плана"} — седмица ${wk.week}${src.orderNo ? ` · заявка № ${escapeHtml(String(src.orderNo))}` : ""}</h3>
      <div class="lp-form-grid">
        <label>Клиент *
          <input type="text" id="lp-client" list="lp-clients" value="${escapeAttr(src.client || "")}" placeholder="избери или въведи" autocomplete="off" />
          <datalist id="lp-clients">${LP_CLIENTS.map(c => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist></label>
        <label>Заявка № <input type="text" id="lp-orderno" value="${escapeAttr(String(src.orderNo || ""))}" placeholder="по желание" /></label>
        <label>Срок <input type="date" id="lp-due" value="${escapeAttr(src.due || "")}" /></label>
      </div>
      <p class="hint" style="margin:6px 0">Махни редовете, които НЯМА да излязат тази седмица, или намали бройките — планът е за реалното.</p>
      <div class="lp-lines-wrap">
        <div class="lp-lgrid lp-lgrid-head"><span>Код</span><span>Изделие</span><span>Бройки</span><span>Палети</span><span>Кг</span><span></span></div>
        <div id="lp-lines">${initLines.map(lineRow).join("")}</div>
      </div>
      <datalist id="lp-goods-list">${LP_GOODS.map(g => `<option value="${escapeAttr(g)}"></option>`).join("")}</datalist>
      <button type="button" id="lp-addline" class="btn btn-small">+ ред</button>
      <label>Забележка<textarea id="lp-note" rows="2" placeholder="напр. транспорт, час, специфики">${escapeHtml(src.note || "")}</textarea></label>
      <div class="ask-actions">
        <button id="lp-save" class="btn btn-primary">${editing ? "Запази" : "Добави в седмицата"}</button>
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
    const tmp = document.createElement("div"); tmp.innerHTML = lineRow({ code: "", name: "", qty: "", kg: "", pallets: "" });
    linesBox.appendChild(tmp.firstElementChild);
    wireRm();
    const last = linesBox.querySelector(".lp-line-row:last-child .lp-l-code"); if (last) last.focus();
  });
  wrap.querySelector("#lp-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#lp-save").addEventListener("click", async () => {
    const client = wrap.querySelector("#lp-client").value.trim();
    if (!client) { alert("Въведи клиент."); return; }
    const lines = [];
    linesBox.querySelectorAll(".lp-line-row").forEach(row => {
      const code = row.querySelector(".lp-l-code").value.trim();
      const name = row.querySelector(".lp-l-name").value.trim();
      const qty = row.querySelector(".lp-l-qty").value.trim();
      const kg = row.querySelector(".lp-l-kg").value.trim();
      const pallets = row.querySelector(".lp-l-pallets").value.trim();
      if (code || name || qty || kg || pallets) lines.push({ code, name, qty, kg, pallets });
    });
    if (!lines.length) { alert("Остави поне един ред."); return; }
    const note = wrap.querySelector("#lp-note").value.trim();
    const orderNo = wrap.querySelector("#lp-orderno").value.trim();
    const due = wrap.querySelector("#lp-due").value;
    const btn = wrap.querySelector("#lp-save"); btn.disabled = true; btn.textContent = "Записва…";
    if (editing) {
      Object.assign(editing, { client, lines, note, orderNo, due });
      delete editing.goods; delete editing.kg; delete editing.pallets;
    } else {
      LP_ITEMS.push({
        id: "lp_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
        week: mondayStr, client, lines, note, orderNo, due,
        orderId: (preset && preset.orderId) || null, createdAt: new Date().toISOString(),
      });
    }
    await lpSave();
    close();
    lpRender();
  });
  setTimeout(() => { const c = wrap.querySelector("#lp-client"); if (c) c.focus(); }, 50);
}

/* ---------- 🖨 Разпечатка на седмицата ---------- */
function lpPrintWeek(items, wk, sunday) {
  if (!items.length) { alert("Няма какво да се печата за тази седмица."); return; }
  const totKg = items.reduce((s, x) => s + lpItemKg(x), 0);
  const totPal = items.reduce((s, x) => s + lpItemPal(x), 0);
  const body = items.map(x => {
    const late = lpLate(x);
    const isLate = !!late && lpProgress(x).left > 0;
    return `<h3${isLate ? ' class="late"' : ""}>${escapeHtml(x.client || "—")}${x.orderNo ? " · заявка № " + escapeHtml(String(x.orderNo)) : ""}${x.due ? " · срок " + lpFmtDate(x.due) : ""}${isLate ? ` · <b>⚠ ИЗОСТАВА с ${lpWeeksWord(late.weeks)}</b> (планирана за ${lpFmtDate(late.orig)})` : ""}
        <span style="float:right;font-weight:400">${lpFmtNum(lpItemPal(x))} пал. · ${lpFmtNum(lpItemKg(x))} кг</span></h3>
      <table><thead><tr><th>Код</th><th>Изделие</th><th class="r">План</th><th class="r">Изпратено</th><th class="r">Палети</th><th class="r">Кг</th><th style="width:80px">Готово ✓</th></tr></thead>
      <tbody>${lpProgress(x).lines.map(r => `<tr><td>${escapeHtml(r.l.code || "")}</td><td>${escapeHtml(r.l.name || r.l.goods || "")}</td>
        <td class="r">${r.plan ? lpFmtNum(r.plan) : ""}</td><td class="r">${r.tracked ? lpFmtNum(r.sent) : ""}</td>
        <td class="r">${r.l.pallets !== "" && r.l.pallets != null ? lpFmtNum(r.l.pallets) : ""}</td>
        <td class="r">${r.l.kg !== "" && r.l.kg != null ? lpFmtNum(r.l.kg) : ""}</td><td></td></tr>`).join("")}</tbody></table>
      ${x.note ? `<p style="margin:2px 0 10px;font-size:12px">📝 ${escapeHtml(x.note)}</p>` : ""}`;
  }).join("");
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>План за седмица ${wk.week}</title>
    <style>body{font-family:Arial,sans-serif;margin:14px 18px;color:#111}
    h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;font-weight:400;color:#555;margin:0 0 12px}
    h3{font-size:14px;margin:14px 0 4px;background:#eef2ff;padding:5px 8px;border-radius:6px}
    h3.late{background:#fee2e2;border-left:4px solid #dc2626}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}
    th,td{border:1px solid #94a3b8;padding:4px 6px;font-size:12px;text-align:left}
    th{background:#f1f5f9}.r{text-align:right}
    @page{size:A4 portrait;margin:10mm}@media print{.noprint{display:none}}</style></head><body>
    <div class="noprint" style="text-align:center;margin-bottom:8px"><button onclick="window.print()" style="padding:8px 18px;font-size:14px">🖨 Печат</button></div>
    <h1>План за експедиция — седмица ${wk.week}</h1>
    <h2>${lpFmtDM(LP_MONDAY)}–${lpFmtDM(sunday)}.${sunday.getUTCFullYear()} · ${items.length} заявки · ${lpFmtNum(totPal)} палета · ${lpFmtNum(totKg)} кг</h2>
    ${body}</body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

async function lpDelete(id) {
  const x = LP_ITEMS.find(i => i.id === id);
  if (!x) return;
  if (!confirm(`Да махна ли „${x.client || ""}"${x.orderNo ? " (№ " + x.orderNo + ")" : ""} от плана за седмицата?`)) return;
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
