/* Данко Системс — „Заявки за материали" (снабдяване).
   ДВА изгледа (по Данко, 26.10.2026):
   1) 📂 Доставчици по групи — групите материали от Покупки като папки
      (Метали, Бои и цинк, Крепежи, Пластмаси, Опаковки, Технически газове,
      Заваръчно + „Без група" за старите фактури без вид). Папка → доставчиците
      ѝ (от РЕАЛНИТЕ покупки) → какво сме купували от всеки (последна цена,
      кога, колко пъти) → отметки → 🛒 готова заявка към доставчика.
   2) 📋 Регистър на заявките — какво сме поискали, от кого, кога ще дойде
      и докъде е стигнало (запитване → поръчано → доставено).
   Пуска се от таб „Заявки за материали", от „Липсващи материали по заявки"
   (избор с отметки) или от бутона на началния екран. Клик върху ред = редакция.
   Пази се в app_config id="mat_requests": { list:[...] }. */

let MATREQ = null;

async function matreqLoad(force) {
  if (MATREQ && !force) return;   // чистата навигация из папките не тегли наново
  try { const { data } = await sb.from("app_config").select("data").eq("id", "mat_requests").maybeSingle(); MATREQ = (data && data.data && data.data.list) || []; }
  catch (e) { MATREQ = []; }
}
async function matreqSave() {
  const { error } = await sb.from("app_config").upsert({ id: "mat_requests", data: { list: MATREQ || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function matreqNextId() { let m = 0; (MATREQ || []).forEach(p => { if ((Number(p.id) || 0) > m) m = Number(p.id); }); return m + 1; }
function matreqToday() { return new Date().toISOString().slice(0, 10); }
function matreqFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }

const MATREQ_STATUSES = ["запитване", "поръчано", "доставено"];

/* ---------- 📂 Доставчици по групи (данните) ----------
   Папките са каноничните видове разход за МАТЕРИАЛИ от Покупки (внимание:
   „Крепежи", не „Крепеж"). Покупка с друг вид (транспорт, ток…) не е материал
   и не влиза в никоя папка; покупка БЕЗ вид отива по групата на редовете си
   или в „Без група" — за да не изчезва история. */
const MATREQ_GROUPS = ["Метали", "Бои и цинк", "Крепежи", "Пластмаси", "Опаковки", "Технически газове", "Заваръчно",
  "Абразиви и Рязане", "Инструменти за машини", "Консумативи за производство", "Поддръжка машини", "Външни услуги"];
const MATREQ_NOGRP = "Без група";
const MATREQ_ICONS = { "Метали": "🔩", "Бои и цинк": "🎨", "Крепежи": "🔧", "Пластмаси": "🧩", "Опаковки": "📦", "Технически газове": "💨", "Заваръчно": "⚡",
  "Абразиви и Рязане": "💿", "Инструменти за машини": "🛠", "Консумативи за производство": "🧰", "Поддръжка машини": "⚙", "Външни услуги": "🤝" };
// Навигацията се помни в сесията — след запис на заявка оставаш където беше.
let MATREQ_NAV = { view: "folders", group: null, supplier: null };

function matreqCanon(name) { return (typeof suppCanon === "function") ? suppCanon(name) : String(name || "").trim(); }
/* По-грубо от suppKey: маха ВСИЧКО освен букви/цифри, за да се слеят
   изписвания като „Ангел Стоилов - 96 АД" и „АНГЕЛ СТОИЛОВ-96 АД"
   (различни интервали/тирета около същото име). Само за този екран. */
function matreqSupKey(name) { return String(name || "").toLowerCase().replace(/[^0-9a-zа-яё]+/g, ""); }
function matreqEurInt(n) { return Math.round(Number(n) || 0).toLocaleString("bg-BG"); }
function matreqPrice(n) { return (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 4 }); }

function matreqDocGroup(o) {
  const t = matreqGroupCanon(o.expenseType || "");
  if (MATREQ_GROUPS.includes(t)) return t;
  if (/^транспорт/i.test(t)) return null;   // домът им е Логистика → 🧾 Фактури транспорт
  // Вид ИЗВЪН материалните групи (Ток, Други разходи, Инвестиции… вкл.
  // ГРЕШНО класираните) → „Без група", за да не изчезва нищо (Данко, 26.10):
  // колоната „Вид (Покупки)" показва какъв е сега, а ➡ го разпределя.
  if (t) return MATREQ_NOGRP;
  for (const l of (o.lines || [])) {
    const g = String(l.groupName || "").toLowerCase();
    if (!g) continue;
    const hit = MATREQ_GROUPS.find(G => g === G.toLowerCase() || g.indexOf(G.toLowerCase()) === 0);
    if (hit) return hit;
  }
  return MATREQ_NOGRP;
}

/* ---------- ➡ Групата на АРТИКУЛА (по Данко, 26.10) ----------
   Единицата за местене е артикулът, не доставчикът: преместен веднъж,
   артикулът се помни (app_config mat_group_overrides, ключ = materialId
   или името — като бележките) и всичките му редове — стари и бъдещи —
   се водят в новата група. Доставчикът „сам се премества": показва се
   във всяка папка, където има артикули. */
let MATREQ_GRP_OVR = null;
async function matreqGrpOvrLoad(force) {
  if (MATREQ_GRP_OVR && !force) return MATREQ_GRP_OVR;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "mat_group_overrides").maybeSingle();
    MATREQ_GRP_OVR = (data && data.data && data.data.byKey) || {};
  } catch (e) { MATREQ_GRP_OVR = MATREQ_GRP_OVR || {}; }
  return MATREQ_GRP_OVR;
}
async function matreqGrpOvrSave(key, group, name) {
  try {
    if (!key || typeof sb === "undefined" || !sb) return false;
    const { data, error } = await sb.from("app_config").select("data").eq("id", "mat_group_overrides").maybeSingle();
    if (error) { alert("Преместването не се записа: " + error.message); return false; }
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    if (group) byKey[key] = { group, name: name || (byKey[key] && byKey[key].name) || "", updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "" };
    else delete byKey[key];
    const { error: e2 } = await sb.from("app_config").upsert({ id: "mat_group_overrides", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (e2) { alert("Преместването не се записа: " + e2.message); return false; }
    MATREQ_GRP_OVR = byKey;
    return true;
  } catch (e) { return false; }
}
/* Batch: няколко артикула наведнъж → една група (един свеж прочит, един
   запис — иначе N заявки и N презаписа на документа). */
async function matreqGrpOvrSaveMany(keys, group, nameOrMap) {
  try {
    keys = (keys || []).filter(Boolean);
    if (!keys.length || !group || typeof sb === "undefined" || !sb) return false;
    const { data, error } = await sb.from("app_config").select("data").eq("id", "mat_group_overrides").maybeSingle();
    if (error) { alert("Преместването не се записа: " + error.message); return false; }
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    const stamp = { updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "" };
    const nameOf = (nameOrMap && typeof nameOrMap === "object") ? nameOrMap : {};
    const one = (typeof nameOrMap === "string") ? nameOrMap : "";
    keys.forEach(k => { byKey[k] = Object.assign({ group, name: one || nameOf[k] || (byKey[k] && byKey[k].name) || "" }, stamp); });
    const { error: e2 } = await sb.from("app_config").upsert({ id: "mat_group_overrides", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (e2) { alert("Преместването не се записа: " + e2.message); return false; }
    MATREQ_GRP_OVR = byKey;
    return true;
  } catch (e) { return false; }
}
/* Групата на един ред: ТОЧКОВИЯТ override (доставчик|артикул) е с предимство
   (по Данко, 27.10: „като преместя едно нещо, да се мести само то" — нищо
   при другите доставчици не мърда). Старите широки правила (само по артикул)
   са неактивни — ключът им не съвпада. */
function matreqMoveKey(sk, mid, article) { return sk + "|" + matreqNoteKey(mid, article); }
function matreqGroupCanon(t) {
  if (typeof erpPuTypeCanon === "function") return erpPuTypeCanon(t);
  return t === "Абразиви за шлайфане" ? "Абразиви и Рязане" : (t || "");
}
function matreqArtGroup(sk, mid, article, docGroup) {
  const r = (MATREQ_GRP_OVR || {})[matreqMoveKey(sk, mid, article)];
  const rg = r && matreqGroupCanon(r.group);
  if (rg && (MATREQ_GROUPS.includes(rg) || rg === MATREQ_NOGRP)) return rg;
  return docGroup;
}
/* ---------- 📝 Описание на доставчик (по Данко, 26.10) ----------
   Ръчен текст след името на доставчика в списъка на групата — дълъг е,
   затова в клетката стои съкратен, а при посочване излиза ЦЕЛИЯТ с едър
   шрифт (плаващият прозорец mr-bigtip). Пази се по доставчик в app_config
   mat_supplier_desc — свеж прочит + сливане само на своя ключ. */
let MATREQ_SDESC = null;
async function matreqSuppDescLoad(force) {
  if (MATREQ_SDESC && !force) return MATREQ_SDESC;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "mat_supplier_desc").maybeSingle();
    MATREQ_SDESC = (data && data.data && data.data.byKey) || {};
  } catch (e) { MATREQ_SDESC = MATREQ_SDESC || {}; }
  return MATREQ_SDESC;
}
function matreqSuppDescOf(sk) { const r = (MATREQ_SDESC || {})[sk]; return (r && r.text) || ""; }
async function matreqSuppDescSave(sk, name, text) {
  try {
    if (!sk || typeof sb === "undefined" || !sb) return false;
    text = String(text || "").trim();
    const { data, error } = await sb.from("app_config").select("data").eq("id", "mat_supplier_desc").maybeSingle();
    if (error) { alert("Описанието не се записа: " + error.message); return false; }
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    if (text) byKey[sk] = { text, name: name || "", updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "" };
    else delete byKey[sk];
    const { error: e2 } = await sb.from("app_config").upsert({ id: "mat_supplier_desc", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (e2) { alert("Описанието не се записа: " + e2.message); return false; }
    MATREQ_SDESC = byKey;
    return true;
  } catch (e) { return false; }
}
function matreqSuppDescDialog(sk, name, after) {
  const r = (MATREQ_SDESC || {})[sk] || {};
  const { wrap, close } = erpDialog(`
    <h3>📝 ${escapeHtml(name)} — описание</h3>
    <p class="hint">Свободен текст за този доставчик — какво поръчваме от него, условия, контакти, особености. Вижда се в списъка (и целият — при посочване с мишката).</p>
    <textarea id="msd-text" rows="8" style="width:100%">${escapeHtml(r.text || "")}</textarea>
    ${r.updatedAt ? `<p class="erp-muted" style="font-size:11.5px;margin:4px 0 0">Последна промяна: ${matreqFmt(String(r.updatedAt).slice(0, 10))}${r.updatedBy ? " · " + escapeHtml(r.updatedBy) : ""}</p>` : ""}
    <div class="erp-dialog-actions"><button class="btn" id="msd-cancel">Отказ</button><button class="btn btn-primary" id="msd-save">💾 Запази</button></div>`);
  wrap.querySelector("#msd-cancel").addEventListener("click", close);
  wrap.querySelector("#msd-save").addEventListener("click", async e => {
    e.target.disabled = true;
    const ok = await matreqSuppDescSave(sk, name, wrap.querySelector("#msd-text").value);
    e.target.disabled = false;
    if (ok) { close(); if (typeof after === "function") after(); }
  });
}
/* Плаващият едър прозорец при посочване (елементи с data-bigtip). */
function matreqBigTipWire(root) {
  let tip = document.getElementById("mr-bigtip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "mr-bigtip";
    tip.style.cssText = "position:fixed;z-index:99999;max-width:540px;background:#1e293b;color:#fff;font-size:16.5px;line-height:1.55;padding:12px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);display:none;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(tip);
  }
  root.querySelectorAll("[data-bigtip]").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const t = el.dataset.bigtip; if (!t) return;
      tip.textContent = t;
      tip.style.display = "block";
      const r = el.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 560)) + "px";
      tip.style.top = Math.min(r.bottom + 6, window.innerHeight - 200) + "px";
    });
    el.addEventListener("mouseleave", () => { tip.style.display = "none"; });
  });
}

/* Ползваем ред (общият шумов филтър): без авто-редовете от покриващи
   фактури, без празни имена и без „разход" от импорта. */
function matreqLineName(l) {
  if (l.fromGoodsId) return "";
  const nm = String(l.article || l.name || "").trim();
  if (!nm || /^разход$/i.test(nm)) return "";
  // 🗑 скритите от Данко служебни редове („Фактура", „Транспорт"…) не се
  // показват никъде из Заявки за материали (фактурите в Покупки не се пипат).
  const r = (MATREQ_GRP_OVR || {})[matreqNoteKey(l.materialId, nm)];
  if (r && r.hidden) return "";
  return nm;
}
/* 🗑 Скриване на артикули (по Данко, 26.10): служебните редове се махат от
   списъците. Пази се в mat_group_overrides (hidden:true) — връщане от
   „Търсене по материал" → 🗑 Скрити. */
async function matreqHideArts(list) {
  list = (list || []).filter(Boolean);
  if (!list.length) { alert("Отметни поне един артикул."); return false; }
  const what = list.length === 1 ? `„${list[0].article}"` : `${list.length} отметнати артикула`;
  if (!confirm(`Да СКРИЯ ли ${what} от списъците на Заявки за материали?\n\nФактурите в Покупки НЕ се пипат — маха се само от артикулните списъци тук, завинаги.`)) return false;
  try {
    const { data, error } = await sb.from("app_config").select("data").eq("id", "mat_group_overrides").maybeSingle();
    if (error) { alert("Скриването не се записа: " + error.message); return false; }
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    const stamp = { updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "" };
    list.forEach(a => { const k = matreqNoteKey(a.mid, a.article); if (k) byKey[k] = Object.assign({ hidden: true, name: a.article || "" }, stamp); });
    const { error: e2 } = await sb.from("app_config").upsert({ id: "mat_group_overrides", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (e2) { alert("Скриването не се записа: " + e2.message); return false; }
    MATREQ_GRP_OVR = byKey;
    return true;
  } catch (e) { return false; }
}

/* група → Map(ключ на доставчик → { name, docs, eur, last }) от реалните
   покупки — ПО РЕДОВЕ: всеки артикул брои за СВОЯТА група (override или
   групата на документа), затова смесена фактура праща доставчика в няколко
   папки. Документ без ползваеми редове се брои цял в групата си. Стоковите
   разписки не влизат в оборота (парите идват с месечната фактура). */
function matreqFolderData() {
  const groups = new Map();
  [...MATREQ_GROUPS, MATREQ_NOGRP].forEach(g => groups.set(g, new Map()));
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    const dg = matreqDocGroup(o);
    const name = matreqCanon(o.supplierName); if (!name) return;
    const sk = matreqSupKey(name); if (!sk) return;
    const k = ((typeof erpPuCur === "function" ? erpPuCur(o) : "EUR") === "BGN") ? 1 / PU_EUR_BGN : 1;
    const sign = o.docType === "credit" ? -1 : 1;
    const seenG = new Set();
    const touch = (g, eur) => {
      const m = groups.get(g); if (!m) return;
      const rec = m.get(sk) || { name, docs: 0, eur: 0, last: "", types: new Set(), arts: new Set() };
      rec.types.add(o.expenseType || "— без вид");
      if (!seenG.has(g)) {
        seenG.add(g); rec.docs++;
        if (o.docType !== "credit" && String(o.date || "") > rec.last) rec.last = o.date || "";   // връщане ≠ покупка
      }
      if (o.docType !== "goods") rec.eur += eur;
      m.set(sk, rec);
    };
    let anyLine = false;
    (o.lines || []).forEach(l => {
      const nm = matreqLineName(l); if (!nm) return;
      const lg = matreqArtGroup(sk, l.materialId, nm, dg); if (!lg) return;
      anyLine = true;
      touch(lg, (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0) * k * sign);
      const m2 = groups.get(lg); const rec2 = m2 && m2.get(sk);
      if (rec2) rec2.arts.add(nm);
    });
    if (!anyLine && dg) {
      // документ без разбити/ползваеми редове → целият в групата на документа
      let base = 0;
      try { base = erpPuTotals(o).base * k; } catch (e) {}
      touch(dg, base);
    }
  });
  return groups;
}

/* Какво сме купували от доставчик В тази група: артикул, код, колко пъти,
   последна цена (EUR) и кога. Шумът се чисти: авто-редовете от покриващи
   фактури (fromGoodsId), празни артикули и „разход" от импорта; кредитните
   известия не дават „последна цена/дата" (връщане, не покупка). */
function matreqSupplierArts(sk, group) {
  const arts = new Map();
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    if (matreqSupKey(matreqCanon(o.supplierName)) !== sk) return;
    const dg = matreqDocGroup(o);
    const isCredit = o.docType === "credit";
    const cur = (typeof erpPuCur === "function") ? erpPuCur(o) : (o.currency || "EUR");
    (o.lines || []).forEach(l => {
      const nm = matreqLineName(l); if (!nm) return;
      if (matreqArtGroup(sk, l.materialId, nm, dg) !== group) return;   // групата на РЕДА
      const ak = nm.toLowerCase();
      const it = arts.get(ak) || { article: nm, code: "", unit: l.unit || "", n: 0, last: "", lastPriceEur: 0, mid: 0 };
      it.n++;
      if (l.materialId && !it.mid) it.mid = Number(l.materialId);
      if (l.code) it.code = l.code;
      if (l.unit) it.unit = l.unit;
      if (!isCredit && String(o.date || "") >= String(it.last || "")) {
        it.last = o.date || "";
        const pr = erpToNum(l.unitPrice) || 0;
        if (pr) it.lastPriceEur = (cur === "BGN") ? pr / PU_EUR_BGN : pr;
      }
      arts.set(ak, it);
    });
  });
  return [...arts.values()].sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)));
}

/* Всички поръчвани артикули в дадена група — с доставчиците на всеки
   (най-скорошният пръв, с последната му цена в EUR). За изгледа
   „🔎 Търсене по материал": намираш материала → виждаш от кого е купуван
   → 🛒 заявка. Същото чистене на шума като при артикулите по доставчик. */
function matreqGroupArticles(group) {
  const arts = new Map();
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    const dg = matreqDocGroup(o);
    const name = matreqCanon(o.supplierName); if (!name) return;
    const sk = matreqSupKey(name); if (!sk) return;
    const isCredit = o.docType === "credit";
    const cur = (typeof erpPuCur === "function") ? erpPuCur(o) : (o.currency || "EUR");
    (o.lines || []).forEach(l => {
      const nm = matreqLineName(l); if (!nm) return;
      if (matreqArtGroup(sk, l.materialId, nm, dg) !== group) return;   // групата на РЕДА
      const ak = nm.toLowerCase();
      const it = arts.get(ak) || { article: nm, code: "", unit: l.unit || "", n: 0, last: "", supps: new Map(), mid: 0 };
      it.n++;
      if (l.materialId && !it.mid) it.mid = Number(l.materialId);
      if (l.code) it.code = l.code;
      if (l.unit) it.unit = l.unit;
      const srec = it.supps.get(sk) || { name, last: "", priceEur: 0 };
      if (!isCredit && String(o.date || "") >= String(srec.last || "")) {
        srec.last = o.date || "";
        const pr = erpToNum(l.unitPrice) || 0;
        if (pr) srec.priceEur = (cur === "BGN") ? pr / PU_EUR_BGN : pr;
        if (String(o.date || "") > String(it.last || "")) it.last = o.date || "";
      }
      it.supps.set(sk, srec);
      arts.set(ak, it);
    });
  });
  return [...arts.values()]
    .map(it => Object.assign({}, it, { supps: [...it.supps.values()].sort((a, b) => String(b.last).localeCompare(String(a.last))) }))
    .sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)));
}

/* Кой доставчик ни е доставял всеки складов материал (по покупните редове
   с materialId, без кредитни и без авто-редовете от покриващи фактури).
   За предложението „Поръчай от…" в Липсващи материали: mid → кандидати,
   най-скорошният пръв, с последната му цена в EUR. */
function matreqSuppliersOfMaterials() {
  const by = new Map();
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    if (o.docType === "credit") return;
    const name = matreqCanon(o.supplierName); if (!name) return;
    const sk = matreqSupKey(name);
    const cur = (typeof erpPuCur === "function") ? erpPuCur(o) : (o.currency || "EUR");
    (o.lines || []).forEach(l => {
      if (!l.materialId || l.fromGoodsId) return;
      const mid = Number(l.materialId);
      const m = by.get(mid) || new Map();
      const rec = m.get(sk) || { name, last: "", priceEur: 0 };
      if (String(o.date || "") >= String(rec.last || "")) {
        rec.last = o.date || "";
        const pr = erpToNum(l.unitPrice) || 0;
        if (pr) rec.priceEur = (cur === "BGN") ? pr / PU_EUR_BGN : pr;
      }
      m.set(sk, rec); by.set(mid, m);
    });
  });
  const out = new Map();
  by.forEach((m, mid) => out.set(mid, [...m.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)))));
  return out;
}

/* ---------- 📝 Бележки по артикул (по Данко, 26.10) ----------
   Ръчно описание „за къде се ползва" — пази се в app_config mat_notes по
   ключ: materialId (ако артикулът е вързан към склада) или името. Записът
   чете свежия ред и слива само своя ключ (никога цял кеш). */
let MATREQ_NOTES = null;
async function matreqNotesLoad(force) {
  if (MATREQ_NOTES && !force) return MATREQ_NOTES;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "mat_notes").maybeSingle();
    MATREQ_NOTES = (data && data.data && data.data.byKey) || {};
  } catch (e) { MATREQ_NOTES = MATREQ_NOTES || {}; }
  return MATREQ_NOTES;
}
function matreqNoteKey(mid, article) { return mid ? "m" + mid : "a:" + String(article || "").trim().toLowerCase(); }
function matreqNoteOf(mid, article) { const r = (MATREQ_NOTES || {})[matreqNoteKey(mid, article)]; return (r && r.note) || ""; }
async function matreqNoteSave(key, note) {
  try {
    if (!key || typeof sb === "undefined" || !sb) return;
    note = String(note || "").trim();
    const { data, error } = await sb.from("app_config").select("data").eq("id", "mat_notes").maybeSingle();
    if (error) return;
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    if (note) byKey[key] = { note, updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "" };
    else delete byKey[key];
    const { error: e2 } = await sb.from("app_config").upsert({ id: "mat_notes", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (!e2) MATREQ_NOTES = byKey;
  } catch (e) { /* тихо */ }
}

/* ---------- 🧩 Къде се ползва материалът (от рецептите) ----------
   direct: materialId → продуктите, в чиято рецепта влиза директно;
   parents: възел → кой го влага. Изкачването дава крайните продукти. */
function matreqMatUsage() {
  const direct = new Map(), parents = new Map();
  Object.entries((typeof ERP !== "undefined" && ERP.linesByProduct) || {}).forEach(([pid, lines]) => {
    (lines || []).forEach(l => {
      if (l.material_id) { const s = direct.get(Number(l.material_id)) || new Set(); s.add(Number(pid)); direct.set(Number(l.material_id), s); }
      else if (l.child_product_id) { const s = parents.get(Number(l.child_product_id)) || new Set(); s.add(Number(pid)); parents.set(Number(l.child_product_id), s); }
    });
  });
  return { direct, parents };
}
function matreqMatProducts(mid, usage) {
  const seen = new Set(), out = new Set();
  const walk = pid => {
    if (seen.has(pid)) return; seen.add(pid);
    const p = ((typeof ERP !== "undefined" && ERP.prodById) || {})[pid];
    const par = usage.parents.get(pid);
    if (p && !p.is_semifinished) out.add(pid);          // краен продукт
    if (par && par.size) par.forEach(walk);
    else if (p && p.is_semifinished) out.add(pid);      // възел, който никой не влага
  };
  (usage.direct.get(Number(mid)) || new Set()).forEach(walk);
  return [...out].map(pid => ((typeof ERP !== "undefined" && ERP.prodById) || {})[pid]).filter(Boolean)
    .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name), "bg"));
}
/* Клетката „Ползва се в": до 3 продукта — изписани; повече → „🔁 серийно · N".
   И двете са бутон към пълния списък. */
function matreqUsageCell(mid, usage) {
  if (!mid) return '<span class="erp-muted" title="Артикулът не е вързан към складов материал — няма как да се провери в рецептите">—</span>';
  const prods = matreqMatProducts(mid, usage);
  if (!prods.length) return '<span class="erp-muted" title="Не участва в нито една рецепта">—</span>';
  const label = prods.length > 3 ? `🔁 серийно · ${prods.length}` : prods.map(p => escapeHtml(p.code || p.name)).join(", ");
  return `<button type="button" class="btn btn-small mr-useinfo" data-mid="${mid}" title="Ползва се в ${prods.length} ${prods.length === 1 ? "продукт" : "продукта"} — клик за списъка">${label}</button>`;
}
function matreqUsageDialog(mid) {
  const usage = matreqMatUsage();
  const m = ((typeof ERP !== "undefined" && ERP.matById) || {})[mid] || {};
  const prods = matreqMatProducts(mid, usage);
  const direct = [...(usage.direct.get(Number(mid)) || new Set())]
    .map(pid => ((typeof ERP !== "undefined" && ERP.prodById) || {})[pid]).filter(Boolean)
    .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name), "bg"));
  const li = p => `<li><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}${p.is_semifinished ? ' <span class="erp-muted">(възел)</span>' : ""}</li>`;
  const { wrap, close } = erpDialog(`
    <h3>🧩 Къде се ползва</h3>
    <p style="margin:4px 0"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")}${prods.length > 3 ? ` · <b>🔁 серийно</b> — в ${prods.length} продукта` : ""}</p>
    <h4 class="erp-group-head">Директно в рецептата на (${direct.length})</h4>
    <ul style="margin:4px 0 10px;max-height:24vh;overflow:auto">${direct.map(li).join("") || "<li class='erp-muted'>— няма</li>"}</ul>
    <h4 class="erp-group-head">Стига до крайните продукти (${prods.length})</h4>
    <ul style="margin:4px 0;max-height:28vh;overflow:auto">${prods.map(li).join("") || "<li class='erp-muted'>— няма</li>"}</ul>
    <div class="erp-dialog-actions"><button class="btn" id="mu-close">Затвори</button></div>`);
  wrap.querySelector("#mu-close").addEventListener("click", close);
}

/* ---------- ➡ Преместване в друга група (по Данко, 26.10) ----------
   Старите/грешно класифицирани покупки се разнасят по местата си: видът
   разход (data.expenseType) се сменя НАПРАВО в purchases — промяната е
   обща (виждат я всички: Покупки, анализите, папките). Всеки документ се
   чете свеж точно преди записа, за да не затрием чужда редакция. */
async function matreqMoveDocs(sk, fromGroup, toGroup, silent) {
  const docs = ((typeof erpPurchases !== "undefined" && erpPurchases) || [])
    .filter(o => matreqSupKey(matreqCanon(o.supplierName)) === sk && matreqDocGroup(o) === fromGroup);
  if (!docs.length) { if (!silent) alert("Няма документи за преместване."); return false; }
  const name = matreqCanon(docs[0].supplierName);
  if (!silent && !confirm(`Да преместя ли ${docs.length} ${docs.length === 1 ? "документ" : "документа"} на „${name}" от „${fromGroup}" в „${toGroup}"?\n\nВидът разход им става „${toGroup}" — промяната е ОБЩА (виждат я всички в офиса) и важи и в Покупки, и в анализите. Доставчикът се запомня с тази група — новите му покупки ще я получават сами.`)) return false;
  let ok = 0, fail = 0;
  for (const o of docs) {
    try {
      const { data, error } = await sb.from("purchases").select("data").eq("id", o.id).maybeSingle();
      if (error || !data) { fail++; continue; }
      const d = data.data || {};
      d.expenseType = toGroup;
      const { error: e2 } = await sb.from("purchases").update({ data: d, updated_at: new Date().toISOString() }).eq("id", o.id);
      if (e2) { fail++; continue; }
      o.expenseType = toGroup;   // и в паметта — папките се преправят веднага
      ok++;
    } catch (e) { fail++; }
  }
  try { SUPP_BOUGHT = null; } catch (e) {}   // агрегатите по доставчик да се преизчислят
  if (ok) matreqRememberGroup(name, toGroup);   // тихо — за следващите покупки
  if (fail) alert(`⚠ Преместени ${ok}, неуспешни ${fail}. Натисни „↻ Обнови" и опитай пак за останалите.`);
  return ok > 0;
}
/* Групата на един РЕД за предложението на вида: override на артикула →
   складовата група на материала → groupName на реда. ПРОДУКТЪТ определя
   категорията, не доставчикът (Данко, 26.10). */
function matreqGroupOfLine(mid, article, lineGroupName) {
  const r = (MATREQ_GRP_OVR || {})[matreqNoteKey(mid, article)];
  if (r && r.group && MATREQ_GROUPS.includes(r.group)) return r.group;
  const m = mid && (typeof ERP !== "undefined" && ERP.matById) ? ERP.matById[Number(mid)] : null;
  const g = String((m && m.group_name) || lineGroupName || "").toLowerCase();
  if (!g) return "";
  return MATREQ_GROUPS.find(G => g === G.toLowerCase() || g.indexOf(G.toLowerCase()) === 0) || "";
}
/* Предложеният вид разход за документ С РЕДОВЕ: мнозинството от групите
   на артикулите му (празно, ако нищо не се разпознава). */
function matreqGuessTypeFromLines(lines) {
  const cnt = {};
  (lines || []).forEach(l => {
    const nm = String((l && (l.article || l.name)) || "").trim();
    if (!nm || /^разход$/i.test(nm)) return;
    const g = matreqGroupOfLine(l.materialId, nm, l.groupName);
    if (g) cnt[g] = (cnt[g] || 0) + 1;
  });
  let best = "", n = 0;
  Object.entries(cnt).forEach(([g, c]) => { if (c > n) { best = g; n = c; } });
  return best;
}

/* Преместването се ЗАПОМНЯ (по Данко): групата влиза в паспорта на
   доставчика (expenseType) — нова покупка от него си я получава сама.
   onlyIfEmpty=true (записът на покупка): пише се само ПЪРВИЯ път — при
   смесени доставчици (крепежи + консумативи) паспортът не бива да се
   мята от всяка фактура; изричното ➡ преместване презаписва. */
async function matreqRememberGroup(name, group, onlyIfEmpty) {
  try {
    if (!String(name || "").trim() || !group || typeof sb === "undefined" || !sb) return;
    const canon = (typeof suppCanon === "function") ? suppCanon(name) : String(name).trim();
    const k = (typeof suppKey === "function") ? suppKey(canon) : String(canon).toLowerCase();
    if (!k) return;
    const { data, error } = await sb.from("app_config").select("data").eq("id", "supplier_profiles").maybeSingle();
    if (error) return;
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    const p = byKey[k];
    if (p && p.expenseType === group) return;
    if (onlyIfEmpty && p && p.expenseType) return;
    byKey[k] = Object.assign({ name: canon }, p || {}, {
      expenseType: group,
      updatedAt: new Date().toISOString(),
      updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "",
    });
    const { error: e2 } = await sb.from("app_config").upsert({ id: "supplier_profiles", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (!e2 && typeof SUPP_PROFILES !== "undefined" && SUPP_PROFILES) SUPP_PROFILES.byKey = byKey;
  } catch (e) { /* тихо */ }
}

/* ➡ Преместване на АРТИКУЛ — ТОЧКОВО: само този артикул при ТЕЗИ доставчици
   (списък от {sk, name}); никой друг не мърда. Помни се и за бъдещите им
   покупки със същия артикул. */
async function matreqMoveArt(supps, mid, article, fromGroup, toGroup) {
  const list = (Array.isArray(supps) ? supps : [supps]).filter(x => x && x.sk);
  if (!list.length) return false;
  const who = list.length === 1 ? `при „${list[0].name}"` : `при ${list.length} доставчици (${list.map(x => x.name).slice(0, 3).join(", ")}${list.length > 3 ? "…" : ""})`;
  if (!confirm(`Да преместя ли артикула „${article}" от „${fromGroup}" в „${toGroup}" ${who}?\n\nМести се САМО той — нищо друго. Помни се (и за бъдещите покупки на същия артикул от същия доставчик).`)) return false;
  return matreqGrpOvrSaveMany(list.map(x => matreqMoveKey(x.sk, mid, article)), toGroup, article);
}
function matreqArtMoveSelect(idx, fromGroup) {
  const opts = [...MATREQ_GROUPS, MATREQ_NOGRP].filter(g => g !== fromGroup)
    .map(g => `<option value="${escapeAttr(g)}">${MATREQ_ICONS[g] || "📁"} ${escapeHtml(g)}</option>`).join("");
  // Транспортите от „Без група" (по Данко, 26.10): отиват в Логистика →
  // 🧾 Фактури транспорт — това мести ДОКУМЕНТИТЕ (видът им разход).
  const trans = `<optgroup label="Логистика · Фактури транспорт">
    <option value="t:Транспорт износ">🚛 Транспорт износ</option>
    <option value="t:Транспорт вътрешен">🚐 Транспорт вътрешен</option></optgroup>
    <optgroup label="Чистене"><option value="__hide">🗑 Скрий артикула</option></optgroup>`;
  return `<select class="mr-amove" data-ai="${idx}" title="Премести АРТИКУЛА в друга група (помни се, доставчикът сам се показва там) — или документите му към Логистика → Фактури транспорт" style="max-width:70px"><option value="">➡</option>${opts}${trans}</select>`;
}
/* Избран транспортен вид: документите от текущата група, съдържащи артикула,
   получават вид „Транспорт износ/вътрешен" → отиват в Логистика →
   🧾 Фактури транспорт. Доставчиците им се запомнят с този вид. */
async function matreqMoveArtDocsToType(arts, fromGroup, toType) {
  const list = Array.isArray(arts) ? arts : [arts];
  const keys = new Set(list.map(a => String(a.article || "").toLowerCase()).filter(Boolean));
  const docs = ((typeof erpPurchases !== "undefined" && erpPurchases) || []).filter(o =>
    matreqDocGroup(o) === fromGroup && (o.lines || []).some(l => keys.has(matreqLineName(l).toLowerCase())));
  if (!docs.length) { alert("Няма документи с тези артикули тук."); return false; }
  const what = list.length === 1 ? `„${list[0].article}"` : `${list.length} отметнати артикула`;
  if (!confirm(`${docs.length} ${docs.length === 1 ? "документ" : "документа"}, съдържащи ${what}, стават вид „${toType}" и отиват в Логистика → 🧾 Фактури транспорт.\n\nПромяната е ОБЩА (Покупки, анализите). Доставчиците им се запомнят с „${toType}" — новите им фактури ще го получават сами.`)) return false;
  let ok = 0, fail = 0;
  const sups = new Set();
  for (const o of docs) {
    try {
      const { data, error } = await sb.from("purchases").select("data").eq("id", o.id).maybeSingle();
      if (error || !data) { fail++; continue; }
      const d = data.data || {};
      d.expenseType = toType;
      const { error: e2 } = await sb.from("purchases").update({ data: d, updated_at: new Date().toISOString() }).eq("id", o.id);
      if (e2) { fail++; continue; }
      o.expenseType = toType; ok++;
      if (o.supplierName) sups.add(matreqCanon(o.supplierName));
    } catch (e) { fail++; }
  }
  sups.forEach(n => matreqRememberGroup(n, toType));
  try { SUPP_BOUGHT = null; } catch (e) {}
  if (fail) alert(`⚠ Преместени ${ok}, неуспешни ${fail} — натисни „↻ Обнови" и опитай пак.`);
  return ok > 0;
}
/* ➡ Групово: ОТМЕТНАТИТЕ артикули наведнъж в избрана група (или
   документите им към Фактури транспорт). По Данко, 26.10. */
async function matreqMoveArtsBulk(sk, supName, list, fromGroup, to) {
  if (!list.length) { alert("Отметни поне един артикул."); return false; }
  if (to === "__hide") return matreqHideArts(list);
  if (to.indexOf("t:") === 0) return matreqMoveArtDocsToType(list, fromGroup, to.slice(2));
  if (!confirm(`Да преместя ли ${list.length} отметнати артикула на „${supName}" от „${fromGroup}" в „${to}"?\n\nМестят се САМО те, само при този доставчик. Помни се (и за бъдещите му покупки със същите артикули).`)) return false;
  const nameOf = {};
  const keys = list.map(a => { const k = matreqMoveKey(sk, a.mid, a.article); nameOf[k] = a.article || ""; return k; });
  return matreqGrpOvrSaveMany(keys, to, nameOf);
}

/* ➡ Маркирани ДОСТАВЧИЦИ: мести целия доставчик — всичките му артикули от
   тази група (точкови правила: само неговите), или документите му към
   Логистика → Фактури транспорт. По Данко, 27.10. */
async function matreqMoveSuppliers(list, fromGroup, to) {
  if (!list.length) { alert("Маркирай поне един доставчик (отметката до името)."); return false; }
  const names = list.map(x => x.name);
  if (to.indexOf("t:") === 0) {
    const toType = to.slice(2);
    if (!confirm(`${list.length} ${list.length === 1 ? "доставчик" : "доставчици"} (${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}): ВСИЧКИТЕ им документи от „${fromGroup}" стават вид „${toType}" и отиват в Логистика → 🧾 Фактури транспорт?\n\nПромяната е обща (Покупки, анализите); доставчиците се запомнят с този вид.`)) return false;
    let any = false;
    for (const x of list) { if (await matreqMoveDocs(x.sk, fromGroup, toType, true)) any = true; }
    return any;
  }
  const nameOf = {}; const keys = []; const noArts = [];
  let totArts = 0;
  list.forEach(x => {
    const arts = matreqSupplierArts(x.sk, fromGroup);
    if (!arts.length) { noArts.push(x.name); return; }
    totArts += arts.length;
    arts.forEach(a => { const k = matreqMoveKey(x.sk, a.mid, a.article); keys.push(k); nameOf[k] = a.article || ""; });
  });
  if (!keys.length) { alert("Маркираните нямат разбити артикули тук — отвори доставчика и премести документите му (падащото в празния изглед)."); return false; }
  if (!confirm(`Да преместя ли ${list.length} ${list.length === 1 ? "доставчик" : "доставчици"} — общо ${totArts} артикула — от „${fromGroup}" в „${to}"?\n\nМестят се САМО техните артикули от тази група (точково, при никой друг нищо не мърда). Помни се и за бъдещите им покупки.${noArts.length ? `\nБез редове (остават тук): ${noArts.join(", ")}.` : ""}`)) return false;
  return matreqGrpOvrSaveMany(keys, to, nameOf);
}

/* suppsOf(a) казва при КОИ доставчици важи преместването: в изгледа на
   доставчик — само той; в Търсене по материал — доставчиците от реда. */
function matreqWireArtMove(root, arts, fromGroup, after, suppsOf) {
  root.querySelectorAll(".mr-amove").forEach(sel => sel.addEventListener("change", async () => {
    const to = sel.value; if (!to) return;
    const a = arts[Number(sel.dataset.ai)]; if (!a) { sel.value = ""; return; }
    sel.disabled = true;
    const ok = to === "__hide"
      ? await matreqHideArts([a])
      : (to.indexOf("t:") === 0
        ? await matreqMoveArtDocsToType(a, fromGroup, to.slice(2))   // към Логистика
        : await matreqMoveArt(suppsOf(a), a.mid, a.article, fromGroup, to));
    sel.disabled = false; sel.value = "";
    if (ok) after();
  }));
}

/* Падащото „➡ премести в…" (ДОКУМЕНТИТЕ на доставчик) — остава само като
   резерва за фактури БЕЗ разбити редове, където няма артикули за местене. */
function matreqMoveSelect(sk, fromGroup, cls) {
  const opts = [...MATREQ_GROUPS].filter(g => g !== fromGroup)
    .map(g => `<option value="${escapeAttr(g)}">${MATREQ_ICONS[g] || "📁"} ${escapeHtml(g)}</option>`).join("");
  return `<select class="${cls}" data-mv-sk="${escapeAttr(sk)}" title="Премества ВСИЧКИ документи на доставчика от тази група в избраната — за старите/грешно класифицираните. Промяната е обща.">
    <option value="">➡ премести в…</option>${opts}</select>`;
}
function matreqWireMove(root, fromGroup, after) {
  root.querySelectorAll("[data-mv-sk]").forEach(sel => sel.addEventListener("change", async e => {
    e.stopPropagation();
    const to = sel.value; if (!to) return;
    sel.disabled = true;
    const moved = await matreqMoveDocs(sel.dataset.mvSk, fromGroup, to);
    sel.disabled = false; sel.value = "";
    if (moved) after();
  }));
}

/* Окабеляване на бележките (запис при промяна) и „🧩 Ползва се в" (диалог). */
function matreqWireNotes(root) {
  root.querySelectorAll(".mr-note").forEach(inp => inp.addEventListener("change", () => matreqNoteSave(inp.dataset.nk, inp.value)));
  root.querySelectorAll(".mr-useinfo").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); matreqUsageDialog(Number(b.dataset.mid)); }));
}

/* Ръчно избран доставчик за даден материал (изгледът „Липсващи"): помни се
   в app_config mat_supplier_prefs и следващия път излиза пръв/предложен.
   Записът чете свежия ред и слива само своя ключ (никога цял кеш). */
async function matreqSuppPrefs() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "mat_supplier_prefs").maybeSingle();
    return (data && data.data && data.data.byMat) || {};
  } catch (e) { return {}; }
}
async function matreqSuppPrefSave(mid, name) {
  try {
    mid = String(mid || ""); name = String(name || "").trim();
    if (!mid || !name || typeof sb === "undefined" || !sb) return;
    const { data, error } = await sb.from("app_config").select("data").eq("id", "mat_supplier_prefs").maybeSingle();
    if (error) return;
    const cur = (data && data.data) || {};
    const byMat = cur.byMat || {};
    if (byMat[mid] && byMat[mid].name === name) return;
    byMat[mid] = { name, updatedAt: new Date().toISOString(), updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "" };
    await sb.from("app_config").upsert({ id: "mat_supplier_prefs", data: Object.assign({}, cur, { byMat }), updated_at: new Date().toISOString() });
  } catch (e) { /* тихо */ }
}

/* Контактът на доставчика за инфо-реда: Контакти → паспорт → партньори. */
async function matreqSupInfo(el, name) {
  if (!el) return;
  let line = "";
  try {
    if (typeof CONTACTS !== "undefined") {
      if ((!CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad();
      const low = String(name).trim().toLowerCase();
      const c = (CONTACTS || []).find(x => /^Доставчик/i.test(x.category || "") && String(x.company || "").trim().toLowerCase() === low);
      if (c) line = `📇 ${escapeHtml(c.contact_person || "")}${c.phone ? " · ☎ " + escapeHtml(c.phone) : ""}${(c.email || c.invoice_email) ? " · ✉ " + escapeHtml(c.email || c.invoice_email) : ""}`;
    }
  } catch (e) {}
  if (!line) {
    const p = (typeof suppProfile === "function") ? suppProfile(name) : null;
    if (p && (p.email || p.person || p.phone)) line = `🏷 ${escapeHtml(p.person || "")}${p.phone ? " · ☎ " + escapeHtml(p.phone) : ""}${p.email ? " · ✉ " + escapeHtml(p.email) : ""} <span class="erp-muted">(от паспорта на доставчика)</span>`;
  }
  if (!line && typeof erpPartnerEmail === "function") {
    try { const r = await erpPartnerEmail("supplier", null, name); if (r && r.email) line = `✉ ${escapeHtml(r.email)} <span class="erp-muted">(от партньорите)</span>`; } catch (e) {}
  }
  el.innerHTML = line || `✉ <b class="erp-warn">Няма имейл за този доставчик никъде</b> — напиши го в заявката, ще се запомни в паспорта му за следващия път.`;
}

/* Ръчно въведен имейл в заявка → запомня се в паспорта на доставчика (само
   ако там е празно — не пипаме въведеното от счетоводството). Тихо.
   ВАЖНО: чете СВЕЖИЯ ред от базата точно преди записа и слива САМО този
   ключ — запис от кеш (или от кеширан ПРОВАЛ на suppLoad) би изтрил чуждите
   паспорти, понеже документът се презаписва цял (урокът от Логистика). */
async function matreqRememberEmail(name, email) {
  try {
    if (!String(name || "").trim() || !String(email || "").trim()) return;
    if (typeof sb === "undefined" || !sb) return;
    const canon = (typeof suppCanon === "function") ? suppCanon(name) : String(name).trim();
    const k = (typeof suppKey === "function") ? suppKey(canon) : String(canon).toLowerCase();
    if (!k) return;
    const { data, error } = await sb.from("app_config").select("data").eq("id", "supplier_profiles").maybeSingle();
    if (error) return;   // не пишем на сляпо при неуспешен прочит
    const cur = (data && data.data) || {};
    const byKey = cur.byKey || {};
    const p = byKey[k];
    if (p && p.email) return;
    byKey[k] = Object.assign({ name: canon }, p || {}, {
      email: String(email).trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "",
    });
    const { error: e2 } = await sb.from("app_config").upsert({ id: "supplier_profiles", data: Object.assign({}, cur, { byKey }), updated_at: new Date().toISOString() });
    if (!e2 && typeof SUPP_PROFILES !== "undefined" && SUPP_PROFILES) SUPP_PROFILES.byKey = byKey;   // кешът да не изостава
  } catch (e) { /* тихо — паметта за имейла не бива да пречи на записа */ }
}

/* ---------- Табът (рутер): 📂 папки / 📋 регистър / ⚠ липсващи ----------
   keepCache=true (навигация из папките) рисува мигновено от паметта;
   без него (влизане в таба, смяна на изглед, след запис) тегли наново.
   СВЕЖЕСТ (по Данко, 26.10): покупките за този екран се извличат наново
   при влизане, щом са по-стари от 4 часа — новите материали и доставчици
   излизат сами всеки ден, без да се прави нищо. ↻ ги тегли веднага. */
let MATREQ_PU_ERR = null;   // последната грешка при зареждане на Покупките
let MATREQ_PU_AT = 0;       // кога този екран последно е теглил покупките
const MATREQ_PU_TTL = 4 * 60 * 60 * 1000;
async function erpRenderMatRequests(keepCache) {
  const v = erpView();
  const wantsPurch = MATREQ_NAV.view === "folders" || MATREQ_NAV.view === "bymat";
  const puStale = !keepCache && (!MATREQ_PU_AT || Date.now() - MATREQ_PU_AT > MATREQ_PU_TTL);
  const needPurch = wantsPurch && ((typeof erpPurchases === "undefined" || !erpPurchases) || puStale);
  if (!keepCache || !MATREQ || needPurch) v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await matreqLoad(!keepCache);
  if (wantsPurch) {
    MATREQ_PU_ERR = null;
    try {
      if (typeof erpLoadPurchases === "function" && needPurch) { await erpLoadPurchases(); MATREQ_PU_AT = Date.now(); }
    }
    catch (e) { MATREQ_PU_ERR = e; }   // показва се в изгледа, с „Опитай пак"
    try { if (typeof suppLoad === "function") await suppLoad(); } catch (e) {}
    try { await matreqNotesLoad(!keepCache); } catch (e) {}
    try { await matreqGrpOvrLoad(!keepCache); } catch (e) {}
    try { await matreqSuppDescLoad(!keepCache); } catch (e) {}
  }
  if (MATREQ_NAV.view === "breakdown") {
    try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}
  }
  const activeN = (MATREQ || []).filter(r => r.status !== "доставено").length;
  const view = MATREQ_NAV.view;
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small ${view === "folders" ? "btn-primary" : ""}" id="mr-v-fold" title="Групите материали като папки → доставчици → какво сме купували от всеки">📂 Доставчици по групи</button>
      <button class="btn btn-small ${view === "register" ? "btn-primary" : ""}" id="mr-v-reg" title="Регистърът на заявките — какво сме поискали и кога ще дойде">📋 Регистър на заявките${activeN ? ` (${activeN})` : ""}</button>
      <button class="btn btn-small ${view === "missing" ? "btn-primary" : ""}" id="mr-v-miss" title="Какво няма да стигне за пуснатите в производство заявки — с предложен доставчик и групова поръчка">⚠ Липсващи по заявки</button>
      <button class="btn btn-small ${view === "bymat" ? "btn-primary" : ""}" id="mr-v-bymat" title="Намери материала по име/код → виж от кой доставчик е купуван → 🛒 заявка">🔎 Търсене по материал</button>
      <button class="btn btn-small ${view === "breakdown" ? "btn-primary" : ""}" id="mr-breakdown" title="Избери клиентска заявка → суровините за остатъка ѝ срещу наличното — какво трябва да се поръча">🧮 Разбивка по заявка</button>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mr-refresh" title="Проверява за НОВИ фактури и доставчици и казва какво е намерил. Твоята подредба (преместеното и скритото) НЕ се пипа — тя е записана в облака.">↻ Обнови</button>
      <button class="btn btn-small btn-primary" id="mr-new" title="Заявка на свободен текст — за доставчик или материал без история в Покупки">+ Нова заявка (свободна)</button>
    </div>
    <div id="mr-body"></div>`;
  v.querySelector("#mr-v-fold").addEventListener("click", () => { if (MATREQ_NAV.view !== "folders") { MATREQ_NAV.view = "folders"; erpRenderMatRequests(); } });
  v.querySelector("#mr-v-reg").addEventListener("click", () => { if (MATREQ_NAV.view !== "register") { MATREQ_NAV.view = "register"; erpRenderMatRequests(); } });
  v.querySelector("#mr-v-miss").addEventListener("click", () => { if (MATREQ_NAV.view !== "missing") { MATREQ_NAV.view = "missing"; erpRenderMatRequests(); } });
  v.querySelector("#mr-v-bymat").addEventListener("click", () => { if (MATREQ_NAV.view !== "bymat") { MATREQ_NAV.view = "bymat"; erpRenderMatRequests(); } });
  v.querySelector("#mr-new").addEventListener("click", () => erpMatReqCompose([]));
  v.querySelector("#mr-breakdown").addEventListener("click", () => { if (MATREQ_NAV.view !== "breakdown") { MATREQ_NAV.view = "breakdown"; erpRenderMatRequests(); } });
  v.querySelector("#mr-refresh").addEventListener("click", async () => {
    // Снимка ПРЕДИ: кои доставчици са по групите и колко документа има.
    // Подредбата на Данко е в облака и обновяването НЕ я пипа — тук само
    // проверяваме и ДОКЛАДВАМЕ кое е новото.
    let before = null;
    try {
      const g0 = matreqFolderData();
      before = { sups: new Map(), docs: (((typeof erpPurchases !== "undefined" && erpPurchases) || []).length) };
      g0.forEach(m => m.forEach((r, sk) => before.sups.set(sk, r.name)));
    } catch (e) {}
    MATREQ_PU_AT = 0;                                     // следващият рендер тегли наново
    try { if (typeof erpPurchases !== "undefined") erpPurchases = null; } catch (e) {}
    try { SUPP_BOUGHT = null; } catch (e) {}              // агрегатите да се преизчислят
    await erpRenderMatRequests();
    try {
      if (!before) return;
      const g1 = matreqFolderData();
      const fresh = [];
      g1.forEach((m, g) => m.forEach((r, sk) => { if (!before.sups.has(sk)) fresh.push(`${r.name} → ${MATREQ_ICONS[g] || "📁"} ${g}`); }));
      const newDocs = (((typeof erpPurchases !== "undefined" && erpPurchases) || []).length) - before.docs;
      alert(fresh.length
        ? `✅ Обновено. НОВИ доставчици (${fresh.length}):\n• ${fresh.slice(0, 15).join("\n• ")}${fresh.length > 15 ? `\n…и още ${fresh.length - 15}` : ""}${newDocs > 0 ? `\nНови документи: ${newDocs}.` : ""}\n\nТвоята подредба не е пипната.`
        : `✅ Обновено. Няма нови доставчици${newDocs > 0 ? ` (нови документи: ${newDocs})` : ""}. Твоята подредба не е пипната.`);
    } catch (e) {}
  });
  const box = v.querySelector("#mr-body");
  if (view === "folders") matreqRenderFolders(box);
  else if (view === "breakdown") matreqRenderBreakdown(box);
  else if (view === "bymat") matreqRenderByMat(box);
  else if (view === "missing") {
    if (typeof erpRenderMissingMaterials === "function") erpRenderMissingMaterials(box);
    else box.innerHTML = `<p class="erp-warn">Модулът „Липсващи материали" не е зареден.</p>`;
  } else matreqRenderRegister(box);
}

function matreqRenderFolders(box) {
  // Неуспешно зареждане на Покупките НЕ бива да изглежда като „няма покупки".
  if (MATREQ_PU_ERR && (typeof erpPurchases === "undefined" || !erpPurchases)) {
    box.innerHTML = `<div class="erp-error"><h3>Покупките не се заредиха</h3>
      <p>${escapeHtml((MATREQ_PU_ERR && MATREQ_PU_ERR.message) || String(MATREQ_PU_ERR))}</p>
      <button class="btn btn-small btn-primary" id="mr-pu-retry">↻ Опитай пак</button></div>`;
    box.querySelector("#mr-pu-retry").addEventListener("click", () => erpRenderMatRequests());
    return;
  }
  const groups = matreqFolderData();
  if (MATREQ_NAV.group && !groups.has(MATREQ_NAV.group)) { MATREQ_NAV.group = null; MATREQ_NAV.supplier = null; }
  if (!MATREQ_NAV.group) return matreqRenderGroupGrid(box, groups);
  const m = groups.get(MATREQ_NAV.group) || new Map();
  if (MATREQ_NAV.supplier && !m.has(MATREQ_NAV.supplier)) MATREQ_NAV.supplier = null;
  if (!MATREQ_NAV.supplier) return matreqRenderGroupSuppliers(box, m);
  matreqRenderSupplier(box, m.get(MATREQ_NAV.supplier));
}

function matreqRenderGroupGrid(box, groups) {
  const cards = [...MATREQ_GROUPS, MATREQ_NOGRP].map(g => {
    const m = groups.get(g);
    if (g === MATREQ_NOGRP && !m.size) return "";
    const docs = [...m.values()].reduce((s, r) => s + r.docs, 0);
    return `<button type="button" class="btn" data-mrg="${escapeAttr(g)}" ${m.size ? "" : "disabled"}
      style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 10px;height:auto;white-space:normal"
      title="${m.size ? `${m.size} доставчици — клик за списъка` : "Още няма покупки от този вид"}">
      <span style="font-size:30px;line-height:1">${MATREQ_ICONS[g] || "📁"}</span>
      <b style="font-size:14px">${escapeHtml(g)}</b>
      <span class="erp-muted" style="font-size:12px">${m.size ? `${m.size} доставчици · ${docs} документа` : "няма покупки"}</span>
    </button>`;
  }).join("");
  box.innerHTML = `
    <p class="hint">Групите материали от Покупки като папки. Влез в папка → доставчиците ѝ и какво сме купували от всеки → отметни артикули → 🛒 заявката се пише сама. „${MATREQ_NOGRP}" събира ВСИЧКО извън материалните групи — фактури без вид разход И с вид като Ток/Други разходи (вкл. грешно класираните): колоната „Вид (Покупки)" показва какъв е сега, а ➡ разпределя. Транспортните са си в Логистика → 🧾 Фактури транспорт.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;margin-top:6px">${cards}</div>`;
  box.querySelectorAll("[data-mrg]").forEach(b => b.addEventListener("click", () => {
    MATREQ_NAV.group = b.dataset.mrg; MATREQ_NAV.supplier = null; erpRenderMatRequests(true);
  }));
}

function matreqRenderGroupSuppliers(box, m) {
  const g = MATREQ_NAV.group;
  const rows = [...m.entries()].map(([sk, r]) => Object.assign({ sk }, r)).sort((a, b) => b.eur - a.eur || b.docs - a.docs);
  box.innerHTML = `
    <div class="erp-toolbar" style="margin:0 0 6px">
      <button class="btn btn-small" id="mr-back-root">← Всички групи</button>
      <span class="erp-count">${MATREQ_ICONS[g] || "📁"} ${escapeHtml(g)} — ${rows.length} доставчици</span>
      <select id="mr-supmove" title="Мести МАРКИРАНИТЕ доставчици: всичките им артикули от тази група (точково — само тяхното), или документите им към Логистика → Фактури транспорт">
        <option value="">➡ Маркираните в…</option>
        ${[...MATREQ_GROUPS, MATREQ_NOGRP].filter(x => x !== g).map(x => `<option value="${escapeAttr(x)}">${MATREQ_ICONS[x] || "📁"} ${escapeHtml(x)}</option>`).join("")}
        <optgroup label="Логистика · Фактури транспорт"><option value="t:Транспорт износ">🚛 Транспорт износ</option><option value="t:Транспорт вътрешен">🚐 Транспорт вътрешен</option></optgroup>
      </select>
      <span class="spacer"></span>
      <input type="search" id="mr-q" placeholder="търси доставчик…" style="width:200px" />
    </div>
    <p class="hint">Клик върху доставчик → какво сме купували от него (с последни цени) и бърза заявка. Сумите са без ДДС, в EUR; стоковите разписки не влизат в оборота (парите идват с месечната фактура).</p>
    <table class="report-table erp-table">
      <thead><tr><th class="pay-chk"><input type="checkbox" id="mr-sall" title="Маркирай всички (видимите)" /></th><th>Доставчик</th><th>📝 Описание</th>${g === MATREQ_NOGRP ? '<th>Вид (Покупки)</th>' : ""}<th class="num" title="Колко различни артикула държат доставчика в тази група — посочи за имената">Артикули</th><th class="num">Документи</th><th class="num cost-cell">Оборот (EUR)</th><th>Последно купено</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="erp-clickable" data-mrs="${escapeAttr(r.sk)}" title="Клик = артикулите на доставчика">
        <td class="pay-chk"><input type="checkbox" class="mr-ssel" data-sk="${escapeAttr(r.sk)}" data-name="${escapeAttr(r.name)}" title="Маркирай за „➡ Маркираните в…" — мести доставчика с всичките му артикули тук" /></td>
        <td><a href="#" class="mr-pass" data-name="${escapeAttr(r.name)}" title="Отваря паспорта на доставчика — четеш и коригираш (имейл, лице, условия, IBAN…)"><b>${escapeHtml(r.name)}</b> 🏷</a></td>
        <td class="mr-sdesc" data-sk="${escapeAttr(r.sk)}" data-name="${escapeAttr(r.name)}" ${matreqSuppDescOf(r.sk) ? `data-bigtip="${escapeAttr(matreqSuppDescOf(r.sk))}"` : ""} title="Клик = редакция на описанието" style="cursor:pointer;max-width:240px">${matreqSuppDescOf(r.sk) ? `<span style="display:block;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12.5px">${escapeHtml(matreqSuppDescOf(r.sk))}</span>` : '<span class="erp-muted" style="font-size:12px">— добави описание</span>'}</td>
        ${g === MATREQ_NOGRP ? `<td class="erp-muted" style="font-size:12px" title="Как са класирани документите му в Покупки сега">${escapeHtml([...(r.types || [])].join(", "))}</td>` : ""}
        <td class="num" ${r.arts && r.arts.size ? `data-bigtip="${escapeAttr([...r.arts].slice(0, 12).join("\n") + (r.arts.size > 12 ? "\n…и още " + (r.arts.size - 12) : ""))}"` : ""}>${(r.arts && r.arts.size) || "—"}</td>
        <td class="num">${r.docs}</td>
        <td class="num cost-cell">${matreqEurInt(r.eur)}</td>
        <td>${matreqFmt(r.last)}</td>
        <td class="erp-row-actions"><button class="btn btn-small btn-primary" data-mrs="${escapeAttr(r.sk)}">Отвори →</button></td>
      </tr>`).join("") || `<tr><td colspan="9" class="report-empty">Няма доставчици с покупки в тази група.</td></tr>`}</tbody>
    </table>`;
  box.querySelector("#mr-back-root").addEventListener("click", () => { MATREQ_NAV.group = null; MATREQ_NAV.supplier = null; erpRenderMatRequests(true); });
  const q = box.querySelector("#mr-q");
  q.addEventListener("input", () => {
    const s = q.value.toLowerCase().trim();
    box.querySelectorAll("tbody tr[data-mrs]").forEach(tr => { tr.style.display = !s || tr.textContent.toLowerCase().includes(s) ? "" : "none"; });
  });
  box.querySelectorAll("[data-mrs]").forEach(el => el.addEventListener("click", e => {
    if (el.tagName === "TR" && e.target.closest("button, select, input, .mr-pass, .mr-sdesc")) return;
    MATREQ_NAV.supplier = el.dataset.mrs; erpRenderMatRequests(true);
  }));
  const sall = box.querySelector("#mr-sall");
  if (sall) sall.addEventListener("change", () => {
    box.querySelectorAll("tbody tr[data-mrs]").forEach(tr => {
      if (tr.style.display === "none") return;
      const cb = tr.querySelector(".mr-ssel"); if (cb) cb.checked = sall.checked;
    });
  });
  const supMove = box.querySelector("#mr-supmove");
  if (supMove) supMove.addEventListener("change", async () => {
    const to = supMove.value; if (!to) return;
    const sel = [...box.querySelectorAll(".mr-ssel:checked")].map(cb => ({ sk: cb.dataset.sk, name: cb.dataset.name }));
    supMove.disabled = true;
    const ok = await matreqMoveSuppliers(sel, g, to);
    supMove.disabled = false; supMove.value = "";
    if (ok) erpRenderMatRequests(true);
  });
  // 📝 Описанието: клик = редакция; посочване = целият текст с едър шрифт.
  box.querySelectorAll(".mr-sdesc").forEach(td => td.addEventListener("click", e => {
    e.stopPropagation();
    matreqSuppDescDialog(td.dataset.sk, td.dataset.name, () => erpRenderMatRequests(true));
  }));
  matreqBigTipWire(box);
  // 🏷 Паспортът на доставчика — направо от името (по Данко, 26.10).
  box.querySelectorAll(".mr-pass").forEach(a => a.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if (typeof suppForm !== "function") { alert("Модулът Паспорти доставчици не е зареден."); return; }
    suppForm(a.dataset.name, { refresh: () => erpRenderMatRequests(true) });
  }));
}

function matreqRenderSupplier(box, rec) {
  const g = MATREQ_NAV.group, name = rec.name;
  const arts = matreqSupplierArts(MATREQ_NAV.supplier, g);
  const usage = matreqMatUsage();
  box.innerHTML = `
    <div class="erp-toolbar" style="margin:0 0 6px">
      <button class="btn btn-small" id="mr-back-root">← Групи</button>
      <button class="btn btn-small" id="mr-back-grp">← ${escapeHtml(g)}</button>
      <span class="erp-count">🏭 ${escapeHtml(name)}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mr-pass-btn" title="Паспортът на доставчика — четеш и коригираш (имейл, лице, условия, IBAN, какво купуваме)">🏷 Паспорт</button>
      <button class="btn btn-small" id="mr-free-sup" title="Заявка на свободен текст към този доставчик — за материал, който още не сме купували от него">✉ Свободна заявка</button>
      <select id="mr-bulkmove" title="Премества ОТМЕТНАТИТЕ артикули наведнъж в избраната група (или документите им към Логистика → Фактури транспорт) — помни се общо">
        <option value="">➡ Избраните в…</option>
        ${[...MATREQ_GROUPS, MATREQ_NOGRP].filter(x => x !== g).map(x => `<option value="${escapeAttr(x)}">${MATREQ_ICONS[x] || "📁"} ${escapeHtml(x)}</option>`).join("")}
        <optgroup label="Логистика · Фактури транспорт"><option value="t:Транспорт износ">🚛 Транспорт износ</option><option value="t:Транспорт вътрешен">🚐 Транспорт вътрешен</option></optgroup>
        <optgroup label="Чистене"><option value="__hide">🗑 Скрий избраните</option></optgroup>
      </select>
      <button class="btn btn-small btn-primary" id="mr-order" title="Отваря заявката към доставчика с отметнатите артикули — писмото се пише само">🛒 Заявка за избраните (<span id="mr-ordcnt">0</span>)</button>
    </div>
    <p class="hint" id="mr-supinfo">⏳ …</p>
    <p class="hint">${rec.docs} документа в „${escapeHtml(g)}" · последно купено ${matreqFmt(rec.last)}. Отметни артикулите, сложи бройки и „🛒 Заявка за избраните" — доставчик, имейл и редове се попълват сами.</p>
    ${arts.length ? `
    <div class="erp-toolbar" style="margin:0 0 4px"><input type="search" id="mr-aq" placeholder="търси артикул или код…" style="width:240px" /></div>
    <div style="max-height:56vh;overflow:auto">
    <table class="report-table erp-table" style="font-size:12.5px">
      <thead><tr><th></th><th>Артикул</th><th>Код</th><th>📝 Бележка</th><th>🧩 Ползва се в</th><th class="num">Пъти</th><th>Последно</th><th class="num cost-cell">Посл. цена (EUR)</th><th class="num">Поръчай</th><th title="Премести артикула в друга група">➡</th></tr></thead>
      <tbody>${arts.map((i, bi) => `<tr data-mra="1">
        <td><input type="checkbox" class="mr-buy" data-bi="${bi}" /></td>
        <td>${escapeHtml(i.article)}</td><td class="t-code">${escapeHtml(i.code || "")}</td>
        <td><input type="text" class="mr-note" data-nk="${escapeAttr(matreqNoteKey(i.mid, i.article))}" value="${escapeAttr(matreqNoteOf(i.mid, i.article))}" placeholder="за къде се ползва…" style="width:150px" title="Свободна бележка — запазва се сама" /></td>
        <td>${matreqUsageCell(i.mid, usage)}</td>
        <td class="num">${i.n}</td><td>${matreqFmt(i.last)}</td>
        <td class="num cost-cell">${i.lastPriceEur ? matreqPrice(i.lastPriceEur) : ""}</td>
        <td class="num"><input type="number" class="mr-buyqty" data-bi="${bi}" min="0" step="any" style="width:76px" placeholder="${escapeAttr(i.unit || "бр.")}" /></td>
        <td>${matreqArtMoveSelect(bi, g)}</td>
      </tr>`).join("")}</tbody>
    </table>
    </div>` : `<p class="report-empty">Фактурите на този доставчик тук са без разбити редове — няма артикули за местене. Ползвай „✉ Свободна заявка", а за прекласифициране премести ДОКУМЕНТИТЕ: ${matreqMoveSelect(MATREQ_NAV.supplier, g, "mr-move")}</p>`}`;
  box.querySelector("#mr-back-root").addEventListener("click", () => { MATREQ_NAV.group = null; MATREQ_NAV.supplier = null; erpRenderMatRequests(true); });
  box.querySelector("#mr-back-grp").addEventListener("click", () => { MATREQ_NAV.supplier = null; erpRenderMatRequests(true); });
  box.querySelector("#mr-free-sup").addEventListener("click", () => erpMatReqCompose([], null, name));
  box.querySelector("#mr-pass-btn").addEventListener("click", () => {
    if (typeof suppForm !== "function") { alert("Модулът Паспорти доставчици не е зареден."); return; }
    suppForm(name, { refresh: () => erpRenderMatRequests(true) });
  });
  matreqWireMove(box, g, () => erpRenderMatRequests(true));      // резервата (фактури без редове)
  matreqWireArtMove(box, arts, g, () => erpRenderMatRequests(true), () => [{ sk: MATREQ_NAV.supplier, name }]);
  const bulkEl = box.querySelector("#mr-bulkmove");
  if (bulkEl) bulkEl.addEventListener("change", async () => {
    const to = bulkEl.value; if (!to) return;
    const sel = [...box.querySelectorAll(".mr-buy:checked")].map(cb => arts[Number(cb.dataset.bi)]).filter(Boolean);
    bulkEl.disabled = true;
    const ok = await matreqMoveArtsBulk(MATREQ_NAV.supplier, name, sel, g, to);
    bulkEl.disabled = false; bulkEl.value = "";
    if (ok) erpRenderMatRequests(true);
  });
  matreqSupInfo(box.querySelector("#mr-supinfo"), name);
  const aq = box.querySelector("#mr-aq");
  if (aq) aq.addEventListener("input", () => {
    const s = aq.value.toLowerCase().trim();
    box.querySelectorAll("tr[data-mra]").forEach(tr => { tr.style.display = !s || tr.textContent.toLowerCase().includes(s) ? "" : "none"; });
  });
  // Отметка + бройка → 🛒 заявка (същият похват като в паспорта на доставчика).
  const cnt = () => { const el = box.querySelector("#mr-ordcnt"); if (el) el.textContent = box.querySelectorAll(".mr-buy:checked").length; };
  box.querySelectorAll(".mr-buy").forEach(cb => cb.addEventListener("change", () => {
    const q2 = box.querySelector(`.mr-buyqty[data-bi="${cb.dataset.bi}"]`);
    if (cb.checked && q2 && !q2.value) q2.value = 1;
    cnt();
  }));
  box.querySelectorAll(".mr-buyqty").forEach(inp => inp.addEventListener("input", () => {
    const cb = box.querySelector(`.mr-buy[data-bi="${inp.dataset.bi}"]`);
    if (cb && Number(inp.value) > 0) { cb.checked = true; cnt(); }
  }));
  matreqWireNotes(box);
  box.querySelector("#mr-order").addEventListener("click", () => {
    const items = [...box.querySelectorAll(".mr-buy:checked")].map(cb => {
      const it = arts[Number(cb.dataset.bi)]; if (!it) return null;
      const qEl = box.querySelector(`.mr-buyqty[data-bi="${cb.dataset.bi}"]`);
      return { code: it.code || "", name: it.article, qty: Number(qEl && qEl.value) || 1, unit: it.unit || "бр." };
    }).filter(Boolean);
    if (!items.length) { alert("Отметни поне един артикул (и бройка)."); return; }
    erpMatReqCompose(items, null, name);
  });
}

/* ---------- 🔎 Търсене по материал (под-изглед) ----------
   Избираш група → всички поръчвани артикули в нея → търсиш по име/код →
   доставчикът (с алтернативи и последна цена) → бройка → 🛒 заявка. */
let MATREQ_BM = { group: "Метали", q: "" };
function matreqRenderByMat(box) {
  if (MATREQ_PU_ERR && (typeof erpPurchases === "undefined" || !erpPurchases)) {
    box.innerHTML = `<div class="erp-error"><h3>Покупките не се заредиха</h3>
      <p>${escapeHtml((MATREQ_PU_ERR && MATREQ_PU_ERR.message) || String(MATREQ_PU_ERR))}</p>
      <button class="btn btn-small btn-primary" id="mr-pu-retry">↻ Опитай пак</button></div>`;
    box.querySelector("#mr-pu-retry").addEventListener("click", () => erpRenderMatRequests());
    return;
  }
  const arts = matreqGroupArticles(MATREQ_BM.group);
  const usage = matreqMatUsage();
  const chips = [...MATREQ_GROUPS, MATREQ_NOGRP].map(g =>
    `<button class="btn btn-small ${g === MATREQ_BM.group ? "btn-primary" : ""}" data-bmg="${escapeAttr(g)}">${MATREQ_ICONS[g] || "📁"} ${escapeHtml(g)}</button>`).join(" ");
  box.innerHTML = `
    <div class="erp-toolbar" style="margin:0 0 4px;flex-wrap:wrap">${chips}</div>
    <div class="erp-toolbar" style="margin:0 0 6px">
      <input type="search" id="mr-bm-q" placeholder="🔎 търси материал по име или код…" value="${escapeAttr(MATREQ_BM.q)}" autocomplete="off" style="min-width:260px" />
      <span class="erp-count" id="mr-bm-n"></span>
      <span class="spacer"></span>
    </div>
    <p class="hint">Всички поръчвани артикули в „${escapeHtml(MATREQ_BM.group)}" от реалните покупки. Избери доставчика (най-скорошният е предизбран, с последната му цена в EUR), сложи бройка и 🛒 — заявката се отваря написана.</p>
    <div style="max-height:58vh;overflow:auto">
    <table class="report-table erp-table" style="font-size:12.5px">
      <thead><tr><th>Артикул</th><th>Код</th><th>📝 Бележка</th><th>🧩 Ползва се в</th><th class="num">Пъти</th><th>Последно</th><th>Доставчик</th><th class="num">Поръчай</th><th></th><th title="Премести артикула в друга група">➡</th></tr></thead>
      <tbody id="mr-bm-rows"></tbody>
    </table>
    </div>`;
  const tbody = box.querySelector("#mr-bm-rows");
  const nEl = box.querySelector("#mr-bm-n");
  let shown = [];   // артикулите на екрана, по индекс (за select/qty/🛒)
  const paint = () => {
    const q = MATREQ_BM.q.toLowerCase().trim();
    const list = q ? arts.filter(a => (a.article + " " + a.code).toLowerCase().includes(q)) : arts;
    shown = list.slice(0, 300);
    nEl.textContent = list.length ? `${list.length} артикула${list.length > 300 ? " (първите 300 — стесни с търсачката)" : ""}` : "няма съвпадения";
    tbody.innerHTML = shown.map((a, i) => `<tr>
      <td>${escapeHtml(a.article)}</td><td class="t-code">${escapeHtml(a.code || "")}</td>
      <td><input type="text" class="mr-note" data-nk="${escapeAttr(matreqNoteKey(a.mid, a.article))}" value="${escapeAttr(matreqNoteOf(a.mid, a.article))}" placeholder="за къде се ползва…" style="width:140px" title="Свободна бележка — запазва се сама" /></td>
      <td>${matreqUsageCell(a.mid, usage)}</td>
      <td class="num">${a.n}</td><td>${matreqFmt(a.last)}</td>
      <td><select class="bm-supp" data-i="${i}" style="max-width:200px">${a.supps.slice(0, 6).map((c, j) =>
        `<option value="${escapeAttr(c.name)}" ${j === 0 ? "selected" : ""}>${escapeHtml(c.name)}${c.priceEur ? ` · ${Math.round(c.priceEur * 100) / 100} €` : ""}</option>`).join("")}</select></td>
      <td class="num"><input type="number" class="bm-qty" data-i="${i}" min="0" step="any" style="width:76px" placeholder="${escapeAttr(a.unit || "бр.")}" /></td>
      <td><button class="btn btn-small btn-primary bm-buy" data-i="${i}" title="Заявка към избрания доставчик за този материал — отваря се попълнена">🛒</button></td>
      <td>${matreqArtMoveSelect(i, MATREQ_BM.group)}</td>
    </tr>`).join("") || `<tr><td colspan="10" class="report-empty">Нищо в тази група${q ? " за това търсене" : ""}.</td></tr>`;
    tbody.querySelectorAll(".bm-buy").forEach(b => b.addEventListener("click", () => {
      const a = shown[Number(b.dataset.i)]; if (!a) return;
      const sEl = tbody.querySelector(`.bm-supp[data-i="${b.dataset.i}"]`);
      const qEl = tbody.querySelector(`.bm-qty[data-i="${b.dataset.i}"]`);
      const qty = erpToNum(qEl && qEl.value) || 1;
      erpMatReqCompose([{ code: a.code || "", name: a.article, qty, unit: a.unit || "бр." }], null, (sEl && sEl.value) || undefined);
    }));
    matreqWireNotes(tbody);
    matreqWireArtMove(tbody, shown, MATREQ_BM.group, () => erpRenderMatRequests(true),
      a => (a.supps || []).map(c => ({ sk: matreqSupKey(c.name), name: c.name })));
  };
  paint();
  box.querySelector("#mr-bm-q").addEventListener("input", e => { MATREQ_BM.q = e.target.value; paint(); });
  box.querySelectorAll("[data-bmg]").forEach(b => b.addEventListener("click", () => {
    MATREQ_BM.group = b.dataset.bmg; MATREQ_BM.q = ""; erpRenderMatRequests(true);
  }));
}

/* ---------- 🧮 Разбивка по заявка (под-изглед, по Данко 27.10: в лентата,
   не в изскачащ прозорец). Сметката е общата erpReqBuildOrder. ---------- */
let MATREQ_BD = { q: "", id: null, out: "" };
function matreqRenderBreakdown(box) {
  if (typeof erpReqBuildOrder !== "function" || typeof erpReqTable !== "function") {
    box.innerHTML = `<p class="erp-warn">Модулът Разбивка на нуждите не е зареден.</p>`;
    return;
  }
  box.innerHTML = `
    <div class="erp-toolbar" style="margin:0 0 8px">
      <input type="search" id="mb-q" placeholder="🔎 № или клиент…" value="${escapeAttr(MATREQ_BD.q)}" autocomplete="off" style="min-width:220px" />
      <label class="erp-inline">📋 Заявка
        <select id="mb-sel"><option value="">— избери заявка —</option>${(typeof erpReqOrderOptions === "function") ? erpReqOrderOptions(MATREQ_BD.q, MATREQ_BD.id) : ""}</select>
      </label>
      <button class="btn btn-small btn-primary" id="mb-go">Изчисли</button>
    </div>
    <div id="mb-out">${MATREQ_BD.out || `<p class="hint">Избери клиентска заявка — виждаш суровините за ОСТАТЪКА ѝ (поръчано − доставено) срещу наличното в склада и какво трябва да се поръча.</p>`}</div>`;
  const sel = box.querySelector("#mb-sel");
  const qEl = box.querySelector("#mb-q");
  qEl.addEventListener("input", () => {
    MATREQ_BD.q = qEl.value;
    sel.innerHTML = `<option value="">— избери заявка —</option>` + ((typeof erpReqOrderOptions === "function") ? erpReqOrderOptions(MATREQ_BD.q, MATREQ_BD.id) : "");
    const opts = [...sel.options].filter(x => x.value);
    if (opts.length === 1) { sel.value = opts[0].value; MATREQ_BD.id = opts[0].value; }
  });
  sel.addEventListener("change", () => { MATREQ_BD.id = sel.value || null; });
  box.querySelector("#mb-go").addEventListener("click", () => {
    const out = box.querySelector("#mb-out");
    const id = sel.value || MATREQ_BD.id;
    if (!id) { out.innerHTML = `<p class="erp-warn">Първо избери заявка (търси по № или клиент).</p>`; return; }
    const o = ((typeof erpCOList !== "undefined" && erpCOList) || []).find(x => String(x.id) === String(id));
    if (!o) { out.innerHTML = `<p class="erp-warn">Заявката не се намери — натисни „↻ Обнови".</p>`; return; }
    const r = erpReqBuildOrder(o);
    MATREQ_BD.out = r.head + (r.rows.length ? erpReqTable(r.rows) : `<p class="report-empty">Нищо за смятане — заявката няма продуктови редове с рецепти.</p>`);
    out.innerHTML = MATREQ_BD.out;
  });
}

/* ---------- 📋 Регистърът на заявките (под-изглед) ---------- */
function matreqRenderRegister(box) {
  const today = matreqToday();
  const active = (MATREQ || []).filter(r => r.status !== "доставено").sort((a, b) => String(a.expected || "9999").localeCompare(b.expected || "9999"));
  const done = (MATREQ || []).filter(r => r.status === "доставено").sort((a, b) => String(b.arrivedAt || "").localeCompare(a.arrivedAt || "")).slice(0, 40);

  const itemsCell = r => (r.items || []).map(i => `<span class="mm-order">${escapeHtml((i.code ? i.code + " " : "") + (i.name || ""))} · ${erpNum(i.qty)} ${escapeHtml(i.unit || "")}</span>`).join(" ") || '<span class="erp-muted">(виж съобщението — клик върху реда)</span>';
  const stBadge = r => {
    if (r.status === "доставено") return '<span class="erp-co-status" style="background:#dcfce7;color:#166534">доставено</span>';
    if (r.status === "поръчано") return '<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">поръчано</span>';
    return '<span class="erp-co-status" style="background:#fef3c7;color:#92400e">запитване</span>';
  };
  const row = (r, isDone) => {
    const overdue = !isDone && r.expected && r.expected < today;
    return `<tr class="erp-clickable ${overdue ? "pay-overdue" : ""}" data-mr-open="${r.id}" title="Клик = отвори за редакция">
      <td>${matreqFmt(r.date)}</td>
      <td><b>${escapeHtml(r.supplier || "—")}</b>${r.sentBy ? `<div class="erp-muted" style="font-size:11px">от ${escapeHtml(r.sentBy)}</div>` : ""}</td>
      <td>${itemsCell(r)}</td>
      <td>${stBadge(r)}${r.emailSent ? ' <span title="Изпратен е имейл">✉</span>' : ""}</td>
      <td>${isDone ? matreqFmt(r.arrivedAt) : (r.expected ? `<b>${matreqFmt(r.expected)}</b>${overdue ? ' <span class="pay-neg">⚠ закъснява</span>' : ""}` : '<span class="erp-muted">—</span>')}</td>
      <td>${r.note ? escapeHtml(r.note) : '<span class="erp-muted">—</span>'}</td>
      <td class="erp-row-actions">
        ${!isDone && r.status === "запитване" ? `<button class="btn btn-small" data-mr-ord="${r.id}" title="Отбележи като поръчано и въведи кога ще дойде">📦 Поръчано</button>` : ""}
        ${!isDone ? `<button class="btn btn-small btn-primary" data-mr-done="${r.id}" title="Материалът е дошъл — редът слиза долу при Доставени">Доставено</button>` : ""}
        ${!isDone ? `<button class="btn btn-small" data-mr-exp="${r.id}" title="Промени очакваната дата">📅</button>` : ""}
        <button class="btn btn-small btn-danger" data-mr-del="${r.id}">×</button>
      </td></tr>`;
  };

  box.innerHTML = `
    <p class="hint">Всички запитвания и заявки за материали на едно място — кой какво е поискал, кога и <b>кога ще дойде</b>. „⚠ закъснява" = очакваната дата е минала, а не е доставено. <b>Клик върху ред = редакция.</b> Пуска се и от „Липсващи материали по заявки" (с отметките) и от папките „Доставчици по групи".</p>
    <h4 class="erp-group-head">⏳ Активни (${active.length})</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>Доставчик</th><th>Материали</th><th>Статус</th><th>Очаква се</th><th>Забележка</th><th></th></tr></thead>
      <tbody>${active.map(r => row(r, false)).join("") || `<tr><td colspan="7" class="report-empty">Няма активни заявки. Пусни от „+ Нова заявка" горе, от папките или от Липсващи материали.</td></tr>`}</tbody>
    </table>
    ${done.length ? `<h4 class="erp-group-head">✅ Доставени (последните ${done.length})</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>Доставчик</th><th>Материали</th><th>Статус</th><th>Дошло на</th><th>Забележка</th><th></th></tr></thead>
      <tbody>${done.map(r => row(r, true)).join("")}</tbody>
    </table>` : ""}`;

  // Клик върху реда (извън бутоните) → редакция на заявката.
  box.querySelectorAll("tr[data-mr-open]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    const r = MATREQ.find(x => x.id === Number(tr.dataset.mrOpen)); if (!r) return;
    erpMatReqCompose(r.items || [], r);
  }));
  box.querySelectorAll("[data-mr-ord]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrOrd)); if (!r) return;
    const d = prompt("Кога ще дойде? (ГГГГ-ММ-ДД):", r.expected || "");
    if (d === null) return;
    r.status = "поръчано"; r.expected = (d || "").trim();
    if (await matreqSave()) erpRenderMatRequests();
  }));
  box.querySelectorAll("[data-mr-done]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrDone)); if (!r) return;
    r.status = "доставено"; r.arrivedAt = matreqToday();
    if (await matreqSave()) erpRenderMatRequests();
  }));
  box.querySelectorAll("[data-mr-exp]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrExp)); if (!r) return;
    const d = prompt("Очаквана дата на доставка (ГГГГ-ММ-ДД):", r.expected || "");
    if (d === null) return;
    r.expected = (d || "").trim();
    if (await matreqSave()) erpRenderMatRequests();
  }));
  box.querySelectorAll("[data-mr-del]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrDel)); if (!r) return;
    if (!confirm(`Да изтрия ли заявката към ${r.supplier || "—"} от ${matreqFmt(r.date)}?`)) return;
    MATREQ = MATREQ.filter(x => x.id !== r.id);
    if (await matreqSave()) erpRenderMatRequests();
  }));
}

/* ---------- Избор на материали (от „🧱 Добави материали" в прозореца) ---------- */
// onDone(items) — извиква се с избраните; без onDone отваря прозореца за заявка.
function erpMatReqPickMaterials(onDone) {
  const chosen = {};   // mid -> qty
  const { wrap, close } = erpDialog(`
    <h3>Избери материали за заявката</h3>
    <input type="search" id="mrp-q" placeholder="търси код или име…" />
    <div id="mrp-list" class="erp-lp-list" style="max-height:46vh;overflow:auto"></div>
    <div id="mrp-chosen" class="hint" style="margin-top:6px"></div>
    <div class="erp-dialog-actions"><button class="btn" id="mrp-cancel">Отказ</button><button class="btn btn-primary" id="mrp-next">Добави ✓</button></div>`);
  const chosenBox = wrap.querySelector("#mrp-chosen");
  const renderChosen = () => {
    const ids = Object.keys(chosen);
    chosenBox.innerHTML = ids.length ? "Избрани: " + ids.map(id => { const m = ERP.matById[id] || {}; return `<b>${escapeHtml(m.code || "")}</b> ×${erpNum(chosen[id])}`; }).join(", ") : "Нищо избрано още — цъкни материал от списъка.";
  };
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = (ERP.materials || []).slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    wrap.querySelector("#mrp-list").innerHTML = list.slice(0, 80).map(m =>
      `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">нал. ${erpNum(m.stock || 0)} ${escapeHtml(m.unit || "")}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    wrap.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const m = ERP.matById[Number(b.dataset.id)];
      const q2 = prompt(`Количество за ${m.code || ""} ${m.name || ""} (${m.unit || "бр."}):`, "");
      if (q2 === null) return;
      const n = erpToNum(q2) || 0;
      if (n > 0) chosen[m.id] = n; else delete chosen[m.id];
      renderChosen();
    }));
  };
  render(""); renderChosen();
  wrap.querySelector("#mrp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#mrp-cancel").addEventListener("click", close);
  wrap.querySelector("#mrp-next").addEventListener("click", () => {
    const items = Object.keys(chosen).map(id => { const m = ERP.matById[id] || {}; return { materialId: Number(id), code: m.code || "", name: m.name || "", unit: m.unit || "", qty: chosen[id] }; });
    if (!items.length) { alert("Избери поне един материал."); return; }
    close();
    if (typeof onDone === "function") onDone(items); else erpMatReqCompose(items);
  });
}

/* ---------- Прозорецът за заявка (нов запис И редакция) ----------
   rec = съществуващ запис от регистъра → режим редакция (клик върху ред). */
/* presetSupplier: отваря НОВА заявка с предизбран доставчик (бутонът „🛒
   Заявка" от Паспорти доставчици — намерил си материала, поръчваш веднага). */
async function erpMatReqCompose(startItems, rec, presetSupplier) {
  const items = (startItems || []).slice();
  let suppliers = [];
  try { suppliers = await erpLoadSuppliers(); } catch (e) {}
  // Доставчиците от КОНТАКТИ (категории „Доставчик – …") — основният източник
  // за име и имейл; партньорите от Покупки остават като резервен списък.
  let contacts = [];
  try {
    if (typeof CONTACTS !== "undefined") {
      if ((!CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad();
      contacts = (CONTACTS || []).filter(c => /^Доставчик/i.test(c.category || ""));
    }
  } catch (e) { /* контактите не са достъпни — работим с партньорите */ }
  const supOptions = [];
  const seenSup = new Set();
  contacts.forEach(c => {
    const n = (c.company || "").trim();
    if (!n || seenSup.has(n.toLowerCase())) return;
    seenSup.add(n.toLowerCase());
    supOptions.push({ name: n, hint: [c.category, c.contact_person].filter(Boolean).join(" · ") });
  });
  suppliers.forEach(s => {
    const n = (s.name || "").trim();
    if (!n || seenSup.has(n.toLowerCase())) return;
    seenSup.add(n.toLowerCase());
    supOptions.push({ name: n, hint: "от Покупки" });
  });
  const mailOptions = contacts.filter(c => c.email || c.invoice_email)
    .map(c => ({ email: c.email || c.invoice_email, label: (c.company || "") + (c.category ? " · " + c.category : "") }));
  const bullet = i => `• ${i.code ? i.code + " " : ""}${i.name} — ${erpNum(i.qty)} ${i.unit || ""}`;
  const myCc = (typeof erpMailMyCc === "function") ? erpMailMyCc() : "";
  const edit = !!rec;
  const defMsg = `Здравейте,

Молим за потвърждение и доставка на следните материали:

${items.map(bullet).join("\n")}

Моля, потвърдете наличност, единични цени и срок на доставка.

Поздрави,
Данко Системс`;
  const msg = (edit && rec.msg) ? rec.msg : defMsg;
  const { wrap, close } = erpDialog(`
    <h3>${edit ? "✎ Заявка към доставчик — редакция" : "✉ Заявка за материали към доставчик"}</h3>
    ${edit ? `<p class="erp-muted" style="margin:-6px 0 8px">Създадена на ${matreqFmt(rec.date)}${rec.sentBy ? " от " + escapeHtml(rec.sentBy) : ""}${rec.emailSent ? " · ✉ имейлът е изпратен" : " · без изпратен имейл"}</p>` : ""}
    <div class="erp-co-grid">
      <label>Доставчик <input type="text" id="mq-supplier" list="mq-sups" placeholder="избери от Контактите или напиши" value="${edit ? escapeAttr(rec.supplier || "") : escapeAttr(presetSupplier || "")}" />
        <datalist id="mq-sups">${supOptions.map(s => `<option value="${escapeAttr(s.name)}">${escapeAttr(s.hint)}</option>`).join("")}</datalist></label>
      <label>Имейл <input type="email" id="mq-email" list="mq-cmails" placeholder="имейл на доставчика" value="${edit ? escapeAttr(rec.supplierEmail || "") : ""}" />
        <datalist id="mq-cmails">${mailOptions.map(m => `<option value="${escapeAttr(m.email)}">${escapeAttr(m.label)}</option>`).join("")}</datalist></label>
      <label>Очаквана доставка (ако знаеш) <input type="date" id="mq-expected" value="${edit ? escapeAttr(rec.expected || "") : ""}" /></label>
      ${edit ? `<label>Статус <select id="mq-status">${MATREQ_STATUSES.map(s => `<option value="${s}" ${rec.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>` : ""}
      <label>Забележка <input type="text" id="mq-note" value="${edit ? escapeAttr(rec.note || "") : ""}" placeholder="по избор — напр. частична доставка, уговорена цена…" /></label>
    </div>
    <p class="hint" id="mq-cinfo" style="margin:4px 0 0"></p>
    <label>Съобщение <button type="button" class="btn btn-small" id="mq-additems" style="float:right" title="Избери материали от склада — добавят се като редове в съобщението">🧱 Добави материали</button>
      <textarea id="mq-text" rows="9">${escapeHtml(msg)}</textarea></label>
    ${myCc ? `<p class="hint" style="margin:6px 0 0">📩 Копие ще получиш и ти: <b>${escapeHtml(myCc)}</b></p>` : ""}
    <div id="mq-result" style="margin-top:8px"></div>
    <div class="erp-dialog-actions">
      <button class="btn" id="mq-cancel">Отказ</button>
      <button class="btn" id="mq-saveonly" title="${edit ? "Записва промените без имейл" : "Записва в регистъра без да изпраща имейл (пратено по телефон/viber)"}">💾 ${edit ? "Запази промените" : "Само запиши"}</button>
      <button class="btn btn-primary" id="mq-send">📤 Изпрати и запиши</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  // При избор на доставчик: имейл + инфо (лице, телефон, бележки) от КОНТАКТИ;
  // ако го няма там — от паспорта на доставчика (вкл. запомнен от стара
  // заявка); накрая резервно от партньорите (Покупки).
  // Авто-попълненият имейл носи флаг (data-auto) и СЕ ЧИСТИ при смяна на
  // доставчика — иначе старият адрес надживява смяната и писмото тръгва
  // към грешната фирма (а грешката се запомва в паспорта ѝ).
  const emailEl = wrap.querySelector("#mq-email");
  const setAutoMail = mail => { emailEl.value = mail; emailEl.dataset.auto = "1"; };
  emailEl.addEventListener("input", () => { emailEl.dataset.auto = ""; });
  const applySupplier = async (name, keepEmail) => {
    const n = String(name || "").trim().toLowerCase();
    const info = wrap.querySelector("#mq-cinfo");
    if (!keepEmail && emailEl.dataset.auto === "1") { emailEl.value = ""; emailEl.dataset.auto = ""; }
    const c = contacts.find(x => String(x.company || "").trim().toLowerCase() === n);
    if (c) {
      const mail = c.email || c.invoice_email || "";
      if (mail && !(keepEmail && emailEl.value)) setAutoMail(mail);
      info.innerHTML = `📇 ${escapeHtml(c.contact_person || "")}${c.phone ? " · ☎ " + escapeHtml(c.phone) : ""}${c.category ? " · " + escapeHtml(c.category) : ""}${!mail ? ' · <b class="erp-warn">няма имейл в Контакти — по телефона?</b>' : ""}${c.notes ? "<br>📝 " + escapeHtml(c.notes) : ""}`;
      return;
    }
    info.textContent = "";
    try {
      if (typeof suppLoad === "function") await suppLoad();
      const p = (typeof suppProfile === "function") ? suppProfile(name) : null;
      if (p && p.email) {
        if (!emailEl.value) setAutoMail(p.email);
        info.innerHTML = `🏷 ${escapeHtml(p.person || "")}${p.phone ? " · ☎ " + escapeHtml(p.phone) : ""} <span class="erp-muted">(от паспорта на доставчика)</span>`;
        return;
      }
    } catch (e) {}
    if (typeof erpPartnerEmail !== "function") return;
    const rec2 = await erpPartnerEmail("supplier", null, name);
    if (rec2 && rec2.email && !emailEl.value) setAutoMail(rec2.email);
  };
  wrap.querySelector("#mq-supplier").addEventListener("change", e => applySupplier(e.target.value));
  if (edit && rec.supplier) applySupplier(rec.supplier, true);
  else if (presetSupplier) applySupplier(presetSupplier, true);
  wrap.querySelector("#mq-cancel").addEventListener("click", close);
  // Добавяне на материали → и в списъка, и като редове в съобщението.
  wrap.querySelector("#mq-additems").addEventListener("click", () => {
    erpMatReqPickMaterials(newItems => {
      newItems.forEach(n => items.push(n));
      const ta = wrap.querySelector("#mq-text");
      const lines = ta.value.split("\n");
      let idx = -1;
      lines.forEach((l, i) => { if (l.trim().indexOf("•") === 0) idx = i; });
      if (idx === -1) { const j = lines.findIndex(l => l.indexOf("материали:") >= 0); idx = j >= 0 ? j + 1 : lines.length - 1; }
      lines.splice(idx + 1, 0, ...newItems.map(bullet));
      ta.value = lines.join("\n");
    });
  });
  const collect = () => ({
    supplier: wrap.querySelector("#mq-supplier").value.trim(),
    supplierEmail: wrap.querySelector("#mq-email").value.trim(),
    expected: wrap.querySelector("#mq-expected").value || "",
    note: wrap.querySelector("#mq-note").value.trim(),
    msg: wrap.querySelector("#mq-text").value,
    items,
  });
  const saveRec = async (sent) => {
    const c = collect();
    // Запомня се само РЪЧНО въведен имейл (авто-попълненият си има източник).
    if (emailEl.dataset.auto !== "1") matreqRememberEmail(c.supplier, c.supplierEmail);
    if (edit) {
      Object.assign(rec, c);
      const st = wrap.querySelector("#mq-status");
      if (st) {
        rec.status = st.value;
        if (rec.status === "доставено") rec.arrivedAt = rec.arrivedAt || matreqToday();
        else rec.arrivedAt = "";
      }
      if (sent) { rec.emailSent = true; rec.sentAt = new Date().toISOString(); }
      return matreqSave();
    }
    await matreqLoad();
    MATREQ.push(Object.assign({
      id: matreqNextId(), date: matreqToday(), status: "запитване",
      sentBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "", sentAt: new Date().toISOString(),
      emailSent: !!sent,
    }, c));
    return matreqSave();
  };
  const refresh = () => { if (ERP.tab === "matreq") erpRenderMatRequests(); };
  wrap.querySelector("#mq-saveonly").addEventListener("click", async e => {
    const btn = e.currentTarget;
    if (btn.disabled) return;   // двойното щракване иначе пуска два конкурентни записа
    btn.disabled = true;
    const ok = await saveRec(false);
    btn.disabled = false;
    if (ok) { close(); if (!edit) alert("✅ Записано в регистъра Заявки за материали (без имейл)."); refresh(); }
  });
  wrap.querySelector("#mq-send").addEventListener("click", async () => {
    const to = wrap.querySelector("#mq-email").value.trim();
    if (!to) { alert("Въведи имейл на доставчика (или запиши без имейл)."); return; }
    const btn = wrap.querySelector("#mq-send"); btn.disabled = true; btn.textContent = "Изпращам…";
    const r = (typeof erpMailSend === "function")
      ? await erpMailSend({ to, subject: "Заявка за доставка на материали — Данко Системс", text: wrap.querySelector("#mq-text").value, direct: true })
      : { ok: false, error: "Имейл модулът не е зареден." };
    btn.disabled = false; btn.textContent = "📤 Изпрати и запиши";
    const res = wrap.querySelector("#mq-result");
    if (r.ok) {
      await saveRec(true);
      res.innerHTML = '<div style="background:#dcfce7;color:#166534;padding:8px 10px;border-radius:8px">✓ Изпратено и записано в регистъра!</div>';
      setTimeout(() => { close(); refresh(); }, 900);
    } else {
      const why = (typeof erpMailExplain === "function") ? erpMailExplain(r.error) : "";
      res.innerHTML = `<div style="background:#fef2f2;color:#991b1b;padding:8px 10px;border-radius:8px">✗ ${escapeHtml(r.error)}${why ? `<br>👉 <b>${escapeHtml(why)}</b>` : ""}<br><span class="erp-muted">Можеш да запишеш без имейл и да пратиш по друг канал.</span></div>`;
    }
  });
}

/* ---------- Бутонът на началния екран (на мястото на „План материали") ---------- */
function matreqInit() {
  const b = document.getElementById("btn-matreq");
  if (b && !b._mrWired) {
    b._mrWired = true;
    b.addEventListener("click", async () => {
      ERP.tab = "matreq";
      await openErp();
      erpSetTab("matreq", true);
    });
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", matreqInit);
else matreqInit();
