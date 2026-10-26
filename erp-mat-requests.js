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
const MATREQ_GROUPS = ["Метали", "Бои и цинк", "Крепежи", "Пластмаси", "Опаковки", "Технически газове", "Заваръчно"];
const MATREQ_NOGRP = "Без група";
const MATREQ_ICONS = { "Метали": "🔩", "Бои и цинк": "🎨", "Крепежи": "🔧", "Пластмаси": "🧩", "Опаковки": "📦", "Технически газове": "💨", "Заваръчно": "⚡" };
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
  const t = o.expenseType || "";
  if (MATREQ_GROUPS.includes(t)) return t;
  if (t) return null;   // друг вид разход (услуга) — не е папка материали
  for (const l of (o.lines || [])) {
    const g = String(l.groupName || "").toLowerCase();
    if (!g) continue;
    const hit = MATREQ_GROUPS.find(G => g === G.toLowerCase() || g.indexOf(G.toLowerCase()) === 0);
    if (hit) return hit;
  }
  return MATREQ_NOGRP;
}

/* група → Map(ключ на доставчик → { name, docs, eur, last }) от реалните покупки.
   Стоковите разписки не влизат в оборота (парите идват с месечната фактура),
   но се броят като документи и дават артикули. */
function matreqFolderData() {
  const groups = new Map();
  [...MATREQ_GROUPS, MATREQ_NOGRP].forEach(g => groups.set(g, new Map()));
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    const g = matreqDocGroup(o); if (!g) return;
    const name = matreqCanon(o.supplierName); if (!name) return;
    const sk = matreqSupKey(name);
    const m = groups.get(g);
    const rec = m.get(sk) || { name, docs: 0, eur: 0, last: "" };
    rec.docs++;
    if (o.docType !== "goods") {
      try {
        const t = erpPuTotals(o);   // кредитните са с минус
        rec.eur += ((typeof erpPuCur === "function" ? erpPuCur(o) : "EUR") === "BGN") ? t.base / PU_EUR_BGN : t.base;
      } catch (e) {}
    }
    if (o.docType !== "credit" && String(o.date || "") > rec.last) rec.last = o.date || "";   // връщане ≠ покупка
    m.set(sk, rec);
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
    if (matreqDocGroup(o) !== group) return;
    const isCredit = o.docType === "credit";
    const cur = (typeof erpPuCur === "function") ? erpPuCur(o) : (o.currency || "EUR");
    (o.lines || []).forEach(l => {
      if (l.fromGoodsId) return;
      const nm = String(l.article || l.name || "").trim();
      if (!nm || /^разход$/i.test(nm)) return;
      const ak = nm.toLowerCase();
      const it = arts.get(ak) || { article: nm, code: "", unit: l.unit || "", n: 0, last: "", lastPriceEur: 0 };
      it.n++;
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
    if (matreqDocGroup(o) !== group) return;
    const name = matreqCanon(o.supplierName); if (!name) return;
    const sk = matreqSupKey(name); if (!sk) return;
    const isCredit = o.docType === "credit";
    const cur = (typeof erpPuCur === "function") ? erpPuCur(o) : (o.currency || "EUR");
    (o.lines || []).forEach(l => {
      if (l.fromGoodsId) return;
      const nm = String(l.article || l.name || "").trim();
      if (!nm || /^разход$/i.test(nm)) return;
      const ak = nm.toLowerCase();
      const it = arts.get(ak) || { article: nm, code: "", unit: l.unit || "", n: 0, last: "", supps: new Map() };
      it.n++;
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
   без него (влизане в таба, смяна на изглед, след запис) тегли наново. */
let MATREQ_PU_ERR = null;   // последната грешка при зареждане на Покупките
async function erpRenderMatRequests(keepCache) {
  const v = erpView();
  const wantsPurch = MATREQ_NAV.view === "folders" || MATREQ_NAV.view === "bymat";
  const needPurch = wantsPurch && (typeof erpPurchases === "undefined" || !erpPurchases);
  if (!keepCache || !MATREQ || needPurch) v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await matreqLoad(!keepCache);
  if (wantsPurch) {
    MATREQ_PU_ERR = null;
    try { if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases(); }
    catch (e) { MATREQ_PU_ERR = e; }   // показва се в изгледа, с „Опитай пак"
    try { if (typeof suppLoad === "function") await suppLoad(); } catch (e) {}
  }
  const activeN = (MATREQ || []).filter(r => r.status !== "доставено").length;
  const view = MATREQ_NAV.view;
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small ${view === "folders" ? "btn-primary" : ""}" id="mr-v-fold" title="Групите материали като папки → доставчици → какво сме купували от всеки">📂 Доставчици по групи</button>
      <button class="btn btn-small ${view === "register" ? "btn-primary" : ""}" id="mr-v-reg" title="Регистърът на заявките — какво сме поискали и кога ще дойде">📋 Регистър на заявките${activeN ? ` (${activeN})` : ""}</button>
      <button class="btn btn-small ${view === "missing" ? "btn-primary" : ""}" id="mr-v-miss" title="Какво няма да стигне за пуснатите в производство заявки — с предложен доставчик и групова поръчка">⚠ Липсващи по заявки</button>
      <button class="btn btn-small ${view === "bymat" ? "btn-primary" : ""}" id="mr-v-bymat" title="Намери материала по име/код → виж от кой доставчик е купуван → 🛒 заявка">🔎 Търсене по материал</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="mr-new" title="Заявка на свободен текст — за доставчик или материал без история в Покупки">+ Нова заявка (свободна)</button>
    </div>
    <div id="mr-body"></div>`;
  v.querySelector("#mr-v-fold").addEventListener("click", () => { if (MATREQ_NAV.view !== "folders") { MATREQ_NAV.view = "folders"; erpRenderMatRequests(); } });
  v.querySelector("#mr-v-reg").addEventListener("click", () => { if (MATREQ_NAV.view !== "register") { MATREQ_NAV.view = "register"; erpRenderMatRequests(); } });
  v.querySelector("#mr-v-miss").addEventListener("click", () => { if (MATREQ_NAV.view !== "missing") { MATREQ_NAV.view = "missing"; erpRenderMatRequests(); } });
  v.querySelector("#mr-v-bymat").addEventListener("click", () => { if (MATREQ_NAV.view !== "bymat") { MATREQ_NAV.view = "bymat"; erpRenderMatRequests(); } });
  v.querySelector("#mr-new").addEventListener("click", () => erpMatReqCompose([]));
  const box = v.querySelector("#mr-body");
  if (view === "folders") matreqRenderFolders(box);
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
    <p class="hint">Групите материали от Покупки като папки. Влез в папка → доставчиците ѝ и какво сме купували от всеки → отметни артикули → 🛒 заявката се пише сама. „${MATREQ_NOGRP}" са стари/импортирани фактури без посочен вид разход.</p>
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
      <span class="spacer"></span>
      <input type="search" id="mr-q" placeholder="търси доставчик…" style="width:200px" />
    </div>
    <p class="hint">Клик върху доставчик → какво сме купували от него (с последни цени) и бърза заявка. Сумите са без ДДС, в EUR; стоковите разписки не влизат в оборота (парите идват с месечната фактура).</p>
    <table class="report-table erp-table">
      <thead><tr><th>Доставчик</th><th class="num">Документи</th><th class="num cost-cell">Оборот (EUR)</th><th>Последно купено</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="erp-clickable" data-mrs="${escapeAttr(r.sk)}" title="Клик = артикулите на доставчика">
        <td><b>${escapeHtml(r.name)}</b></td>
        <td class="num">${r.docs}</td>
        <td class="num cost-cell">${matreqEurInt(r.eur)}</td>
        <td>${matreqFmt(r.last)}</td>
        <td class="erp-row-actions"><button class="btn btn-small btn-primary" data-mrs="${escapeAttr(r.sk)}">Отвори →</button></td>
      </tr>`).join("") || `<tr><td colspan="5" class="report-empty">Няма доставчици с покупки в тази група.</td></tr>`}</tbody>
    </table>`;
  box.querySelector("#mr-back-root").addEventListener("click", () => { MATREQ_NAV.group = null; MATREQ_NAV.supplier = null; erpRenderMatRequests(true); });
  const q = box.querySelector("#mr-q");
  q.addEventListener("input", () => {
    const s = q.value.toLowerCase().trim();
    box.querySelectorAll("tbody tr[data-mrs]").forEach(tr => { tr.style.display = !s || tr.textContent.toLowerCase().includes(s) ? "" : "none"; });
  });
  box.querySelectorAll("[data-mrs]").forEach(el => el.addEventListener("click", e => {
    if (el.tagName === "TR" && e.target.closest("button")) return;
    MATREQ_NAV.supplier = el.dataset.mrs; erpRenderMatRequests(true);
  }));
}

function matreqRenderSupplier(box, rec) {
  const g = MATREQ_NAV.group, name = rec.name;
  const arts = matreqSupplierArts(MATREQ_NAV.supplier, g);
  box.innerHTML = `
    <div class="erp-toolbar" style="margin:0 0 6px">
      <button class="btn btn-small" id="mr-back-root">← Групи</button>
      <button class="btn btn-small" id="mr-back-grp">← ${escapeHtml(g)}</button>
      <span class="erp-count">🏭 ${escapeHtml(name)}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mr-free-sup" title="Заявка на свободен текст към този доставчик — за материал, който още не сме купували от него">✉ Свободна заявка</button>
      <button class="btn btn-small btn-primary" id="mr-order" title="Отваря заявката към доставчика с отметнатите артикули — писмото се пише само">🛒 Заявка за избраните (<span id="mr-ordcnt">0</span>)</button>
    </div>
    <p class="hint" id="mr-supinfo">⏳ …</p>
    <p class="hint">${rec.docs} документа в „${escapeHtml(g)}" · последно купено ${matreqFmt(rec.last)}. Отметни артикулите, сложи бройки и „🛒 Заявка за избраните" — доставчик, имейл и редове се попълват сами.</p>
    ${arts.length ? `
    <div class="erp-toolbar" style="margin:0 0 4px"><input type="search" id="mr-aq" placeholder="търси артикул или код…" style="width:240px" /></div>
    <div style="max-height:56vh;overflow:auto">
    <table class="report-table erp-table" style="font-size:12.5px">
      <thead><tr><th></th><th>Артикул</th><th>Код</th><th class="num">Пъти</th><th>Последно</th><th class="num cost-cell">Посл. цена (EUR)</th><th class="num">Поръчай</th></tr></thead>
      <tbody>${arts.map((i, bi) => `<tr data-mra="1">
        <td><input type="checkbox" class="mr-buy" data-bi="${bi}" /></td>
        <td>${escapeHtml(i.article)}</td><td class="t-code">${escapeHtml(i.code || "")}</td>
        <td class="num">${i.n}</td><td>${matreqFmt(i.last)}</td>
        <td class="num cost-cell">${i.lastPriceEur ? matreqPrice(i.lastPriceEur) : ""}</td>
        <td class="num"><input type="number" class="mr-buyqty" data-bi="${bi}" min="0" step="any" style="width:76px" placeholder="${escapeAttr(i.unit || "бр.")}" /></td>
      </tr>`).join("")}</tbody>
    </table>
    </div>` : `<p class="report-empty">Фактурите на този доставчик тук са без разбити редове — няма откъде да извадим артикули. Ползвай „✉ Свободна заявка".</p>`}`;
  box.querySelector("#mr-back-root").addEventListener("click", () => { MATREQ_NAV.group = null; MATREQ_NAV.supplier = null; erpRenderMatRequests(true); });
  box.querySelector("#mr-back-grp").addEventListener("click", () => { MATREQ_NAV.supplier = null; erpRenderMatRequests(true); });
  box.querySelector("#mr-free-sup").addEventListener("click", () => erpMatReqCompose([], null, name));
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
  const chips = [...MATREQ_GROUPS, MATREQ_NOGRP].map(g =>
    `<button class="btn btn-small ${g === MATREQ_BM.group ? "btn-primary" : ""}" data-bmg="${escapeAttr(g)}">${MATREQ_ICONS[g] || "📁"} ${escapeHtml(g)}</button>`).join(" ");
  box.innerHTML = `
    <div class="erp-toolbar" style="margin:0 0 4px;flex-wrap:wrap">${chips}</div>
    <div class="erp-toolbar" style="margin:0 0 6px">
      <input type="search" id="mr-bm-q" placeholder="🔎 търси материал по име или код…" value="${escapeAttr(MATREQ_BM.q)}" autocomplete="off" style="min-width:260px" />
      <span class="erp-count" id="mr-bm-n"></span>
    </div>
    <p class="hint">Всички поръчвани артикули в „${escapeHtml(MATREQ_BM.group)}" от реалните покупки. Избери доставчика (най-скорошният е предизбран, с последната му цена в EUR), сложи бройка и 🛒 — заявката се отваря написана.</p>
    <div style="max-height:58vh;overflow:auto">
    <table class="report-table erp-table" style="font-size:12.5px">
      <thead><tr><th>Артикул</th><th>Код</th><th class="num">Пъти</th><th>Последно</th><th>Доставчик</th><th class="num">Поръчай</th><th></th></tr></thead>
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
      <td class="num">${a.n}</td><td>${matreqFmt(a.last)}</td>
      <td><select class="bm-supp" data-i="${i}" style="max-width:200px">${a.supps.slice(0, 6).map((c, j) =>
        `<option value="${escapeAttr(c.name)}" ${j === 0 ? "selected" : ""}>${escapeHtml(c.name)}${c.priceEur ? ` · ${Math.round(c.priceEur * 100) / 100} €` : ""}</option>`).join("")}</select></td>
      <td class="num"><input type="number" class="bm-qty" data-i="${i}" min="0" step="any" style="width:76px" placeholder="${escapeAttr(a.unit || "бр.")}" /></td>
      <td><button class="btn btn-small btn-primary bm-buy" data-i="${i}" title="Заявка към избрания доставчик за този материал — отваря се попълнена">🛒</button></td>
    </tr>`).join("") || `<tr><td colspan="7" class="report-empty">Нищо в тази група${q ? " за това търсене" : ""}.</td></tr>`;
    tbody.querySelectorAll(".bm-buy").forEach(b => b.addEventListener("click", () => {
      const a = shown[Number(b.dataset.i)]; if (!a) return;
      const sEl = tbody.querySelector(`.bm-supp[data-i="${b.dataset.i}"]`);
      const qEl = tbody.querySelector(`.bm-qty[data-i="${b.dataset.i}"]`);
      const qty = erpToNum(qEl && qEl.value) || 1;
      erpMatReqCompose([{ code: a.code || "", name: a.article, qty, unit: a.unit || "бр." }], null, (sEl && sEl.value) || undefined);
    }));
  };
  paint();
  box.querySelector("#mr-bm-q").addEventListener("input", e => { MATREQ_BM.q = e.target.value; paint(); });
  box.querySelectorAll("[data-bmg]").forEach(b => b.addEventListener("click", () => {
    MATREQ_BM.group = b.dataset.bmg; MATREQ_BM.q = ""; erpRenderMatRequests(true);
  }));
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
