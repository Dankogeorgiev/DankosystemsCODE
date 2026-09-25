/* Данко Системс — ЕРП „Клиенти/Доставчици" (ОБЕДИНЕНИЯТ картон на фирмата).
   Едно лице върху ДВЕТЕ съществуващи бази — нищо старо не се пипа:
     • partners  → реквизитите (ЕИК, ДДС, МОЛ, адрес) — фактурите четат оттук;
     • contacts  → хората (имейли, телефони) — запитванията/заявките четат оттук;
     • Покупки   → какво КУПУВАМЕ от доставчика (автоматично, suppBoughtFor);
     • Заявки    → какво ни КУПУВА клиентът (автоматично, compClientBought).
   Добавки (без SQL): app_config "company_directory" =
     { links: { "<contactId>": <partnerId> },      // ръчно закачени контакти
       roles: { "<contactId>": ["invoice","orders","inbound"] } }  // ролите
   Роли: 🧾 invoice = получава фактурите · 📨 orders = получава поръчки/запитвания
         📥 inbound = праща ни заявки. (Пращането на фактури по имейл ще чете
   ролята invoice — Фаза Б.) Търсенето (Enter) рови и в търгуваното: „шайба" →
   доставчикът; „механизъм 3" → клиентите, които го купуват. */

let COMP_DIR = null;           // { links, roles }
let compQuery = "";
let compKindF = "customer";    // подтаб: customer | supplier | "" (всички)
let COMP_ACTIVE = false;       // кой изглед е на екрана: обединеният или старият

function compNorm(s) { return String(s || "").toLowerCase().replace(/х/g, "x").replace(/["'„“”.,\-–—()]/g, " ").replace(/\s+/g, " ").trim(); }

/* „Разхлабено" име за съпоставка: махаме правната форма (ООД/ЕООД/GmbH…) и
   уеднаквяваме буквите, които се пишат еднакво на кирилица и латиница.
   Така „Мултивак" от Контакти се закача за „Мултивак България ЕООД" от реквизитите. */
/* Правни форми — и латинските, и българските СЛЕД буквеното уеднаквяване
   (а→a е→e о→o с→c р→p х→x): „ООД"→ooд, „ЕООД"→eooд, „АД"→aд, „ЕАД"→eaд… */
const COMP_LEGAL = new Set(["ood", "eood", "ad", "ead", "et", "cd", "kd", "gmbh", "ltd", "llc", "jsc", "plc", "srl", "sro", "kft", "bv", "ag", "sa", "spa", "inc", "co", "kg", "doo", "gbr", "ohg",
  "ooд", "eooд", "aд", "eaд", "eт", "cд", "кд"]);
function compLoose(s) {
  return String(s || "").toLowerCase()
    .replace(/х/g, "x").replace(/а/g, "a").replace(/е/g, "e").replace(/о/g, "o").replace(/с/g, "c").replace(/р/g, "p")
    .replace(/["'„“”.,\-–—()&\/]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(w => w && !COMP_LEGAL.has(w));
}

/* Авто-връзки контакт → фирма: точно „разхлабено" име, или единствената фирма,
   чиито думи включват думите на контакта (или обратно). При две възможни — не
   гадаем (закача се ръчно с 🔗 от картона). */
let COMP_AUTO = null, COMP_AUTO_P = null, COMP_AUTO_C = null;
function compAutoLinks() {
  const parts = (typeof erpPartners !== "undefined" && erpPartners) || [];
  const cts = (typeof CONTACTS !== "undefined" && CONTACTS) || [];
  if (COMP_AUTO && COMP_AUTO_P === parts && COMP_AUTO_C === cts) return COMP_AUTO;
  const pt = parts.map(p => ({ id: p.id, toks: compLoose(p.name) }));
  const byKey = new Map();   // „разхлабено" име → всички редове с това име (дубликатите)
  pt.forEach(x => { const k = x.toks.join(" "); if (!k) return; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(x.id); });
  const subset = (a, b) => a.length && a.every(w => b.includes(w));
  const meaty = t => t.some(w => w.length >= 4);
  const kindOfCat = cat => /^Доставчик/.test(cat || "") ? "supplier" : (/^Клиент/.test(cat || "") ? "customer" : "");
  const byId = new Map(); parts.forEach(p => byId.set(p.id, p));
  const map = new Map();
  cts.forEach(c => {
    const toks = compLoose(c.company);
    if (!toks.length) return;
    const key = toks.join(" ");
    if (byKey.has(key)) {
      let ids = byKey.get(key);
      const want = kindOfCat(c.category);
      if (ids.length > 1 && want) { const pref = ids.filter(id => (byId.get(id) || {}).kind === want); if (pref.length) ids = pref; }
      map.set(String(c.id), ids.slice().sort((a, b) => b - a)[0]);
      return;
    }
    if (!meaty(toks)) return;
    let cand = pt.filter(x => x.toks.length && (subset(toks, x.toks) || subset(x.toks, toks)));
    if (cand.length > 1) {
      // Дубликати/преиздадени фирми: ако всички кандидати са с ЕДНО и също
      // „разхлабено" име (МЕБЕЛ СТИЛ ООД два пъти; Метма ЕООД/ЕАД) — това е
      // една фирма. Предпочитаме тип по категорията на контакта, после най-новия ред.
      const keys = new Set(cand.map(x => x.toks.join(" ")));
      if (keys.size === 1) {
        const want = kindOfCat(c.category);
        const pref = want ? cand.filter(x => (byId.get(x.id) || {}).kind === want) : [];
        cand = (pref.length ? pref : cand).sort((a, b) => b.id - a.id).slice(0, 1);
      }
    }
    if (cand.length === 1) map.set(String(c.id), cand[0].id);
  });
  COMP_AUTO = map; COMP_AUTO_P = parts; COMP_AUTO_C = cts;
  return map;
}

async function compDirLoad() {
  if (COMP_DIR) return COMP_DIR;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "company_directory").maybeSingle();
    COMP_DIR = { links: (data && data.data && data.data.links) || {}, roles: (data && data.data && data.data.roles) || {} };
  } catch (e) { COMP_DIR = { links: {}, roles: {} }; }
  return COMP_DIR;
}
async function compDirSave() {
  const { error } = await sb.from("app_config").upsert({ id: "company_directory", data: COMP_DIR, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
const COMP_ROLES = [["invoice", "🧾 получава ФАКТУРИ"], ["orders", "📨 получава поръчки/запитвания"], ["inbound", "📥 праща ни заявки"]];
function compRolesOf(cid) { return (COMP_DIR && COMP_DIR.roles[String(cid)]) || []; }

/* ЕИК: ако полето е празно, но има български ДДС № (BG + цифрите на ЕИК),
   го извеждаме оттам — импортът от Bizzio даваше само ДДС номера. */
function compEik(p) {
  if (p.eik) return p.eik;
  const v = String(p.vat || "").toUpperCase().replace(/\s+/g, "");
  return /^BG\d{9,13}$/.test(v) ? v.slice(2) : "";
}

/* Контактите на фирмата: ръчно закачените + авто-мач по „разхлабено" име. */
function compContactsFor(p) {
  const auto = compAutoLinks();
  return ((typeof CONTACTS !== "undefined" && CONTACTS) || []).filter(c => {
    const manual = COMP_DIR && COMP_DIR.links[String(c.id)];
    if (manual != null) return String(manual) === String(p.id);
    return auto.get(String(c.id)) === p.id;
  });
}

/* Какво ни купува КЛИЕНТЪТ — автоматично от Заявки от клиенти. */
let COMP_CB = null, COMP_CB_SRC = null;
function compClientBoughtMap() {
  const src = (typeof erpCOList !== "undefined" && erpCOList) || [];
  if (COMP_CB && COMP_CB_SRC === src) return COMP_CB;
  const byClient = new Map();
  src.forEach(o => {
    const k = compNorm(o.clientName); if (!k) return;
    if (!byClient.has(k)) byClient.set(k, new Map());
    const arts = byClient.get(k);
    (o.lines || []).forEach(l => {
      const nm = String(l.name || l.code || "").trim(); if (!nm) return;
      const ak = (l.code || nm).toLowerCase();
      const it = arts.get(ak) || { code: l.code || "", name: nm, qty: 0, n: 0, last: "", lastPrice: 0 };
      it.qty += erpToNum(l.qty) || 0; it.n++;
      if (String(o.date || "") >= String(it.last || "")) { it.last = o.date || ""; const pr = erpToNum(l.unitPrice); if (pr) it.lastPrice = pr; }
      arts.set(ak, it);
    });
  });
  const out = new Map();
  byClient.forEach((arts, k) => out.set(k, [...arts.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)) || b.qty - a.qty)));
  COMP_CB = out; COMP_CB_SRC = src;
  return out;
}
function compTradeFor(p) {
  if (p.kind === "supplier") return (typeof suppBoughtFor === "function") ? suppBoughtFor(p.name).map(i => ({ code: i.code, name: i.article, qty: null, n: i.n, last: i.last, lastPrice: i.lastPrice, cur: i.cur })) : [];
  return (compClientBoughtMap().get(compNorm(p.name)) || []).map(i => ({ code: i.code, name: i.name, qty: i.qty, n: i.n, last: i.last, lastPrice: i.lastPrice, cur: "EUR" }));
}

/* ---------- Списъкът ---------- */
async function erpRenderCompanies() {
  COMP_ACTIVE = true;
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { if (typeof erpPartners === "undefined" || !erpPartners) await erpLoadPartners(); } catch (e) { try { await erpLoadPartners(); } catch (e2) {} }
  try { if ((typeof CONTACTS === "undefined" || !CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad(); } catch (e) {}
  try { if ((typeof erpCOList === "undefined" || !erpCOList) && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  try { if ((typeof erpPurchases === "undefined" || !erpPurchases) && typeof erpLoadPurchases === "function") await erpLoadPurchases(); } catch (e) {}
  try { if (typeof suppLoad === "function") await suppLoad(); } catch (e) {}
  try { if (typeof cliLoad === "function") await cliLoad(); } catch (e) {}
  await compDirLoad();

  let list = (erpPartners || []).slice();
  if (compKindF) list = list.filter(p => p.kind === compKindF);
  const words = compNorm(compQuery).split(" ").filter(Boolean);
  const hits = new Map();
  if (words.length) {
    list = list.filter(p => {
      const cts = compContactsFor(p);
      const trade = compTradeFor(p);
      const hay = compNorm([p.name, p.eik, p.vat, p.mol, p.city, p.street,
        cts.map(c => `${c.contact_person} ${c.email} ${c.phone} ${c.scope} ${c.notes}`).join(" "),
        trade.map(t => `${t.code} ${t.name}`).join(" ")].join(" "));
      if (!words.every(w => hay.includes(w))) return false;
      const th = trade.filter(t => { const h = compNorm(t.code + " " + t.name); return words.some(w => h.includes(w)); });
      if (th.length) hits.set(p.id, th.slice(0, 3));
      return true;
    });
  }

  // Фирми, които са САМО в указателя Контакти (без реквизити) — показваме ги
  // като редове в сиво, с хората и телефоните им, за да не „изчезва" нищо.
  const auto = compAutoLinks();
  const orphMap = new Map();   // normName -> { name, kind, cts: [] }
  (((typeof CONTACTS !== "undefined" && CONTACTS) || [])).forEach(c => {
    if (!(c.company || "").trim()) return;
    if (COMP_DIR.links[String(c.id)] != null || auto.has(String(c.id))) return;
    const k = compNorm(c.company);
    if (!orphMap.has(k)) orphMap.set(k, { key: k, name: c.company.trim(), kind: "", cts: [] });
    const o = orphMap.get(k);
    o.cts.push(c);
    if (/^Доставчик/.test(c.category || "")) o.kind = o.kind || "supplier";
    if (/^Клиент/.test(c.category || "")) o.kind = o.kind || "customer";
  });
  let orphans = [...orphMap.values()];
  let hiddenOrph = 0;
  if (compKindF) { const before = orphans.length; orphans = orphans.filter(o => o.kind === compKindF); hiddenOrph = before - orphans.length; }
  if (words.length) {
    orphans = orphans.filter(o => {
      const hay = compNorm([o.name, o.cts.map(c => `${c.contact_person} ${c.email} ${c.phone} ${c.scope} ${c.notes} ${c.category}`).join(" ")].join(" "));
      return words.every(w => hay.includes(w));
    });
  }
  window.COMP_ORPH = orphMap;   // за картона на фирма от указателя

  const peopleCell = (cts, fb) => {
    if (!cts.length) {
      if (fb && (fb.person || fb.phone || fb.email)) return `${escapeHtml(fb.person || fb.email || "—")}${fb.phone ? `<div class="erp-muted" style="font-size:11px">📞 ${escapeHtml(fb.phone)}</div>` : ""}<div class="erp-muted" style="font-size:10.5px">${escapeHtml(fb.src || "от реквизитите")}</div>`;
      return `<span class="erp-muted">—</span>`;
    }
    const c0 = cts[0];
    return `${escapeHtml(c0.contact_person || c0.email || "—")}${c0.phone ? `<div class="erp-muted" style="font-size:11px">📞 ${escapeHtml(c0.phone)}</div>` : ""}${cts.length > 1 ? `<div class="erp-muted" style="font-size:11px">+ още ${cts.length - 1}</div>` : ""}`;
  };
  const kindBadge = k => k === "supplier" ? `<span class="crmb crmb-orange">доставчик</span>` : (k === "customer" ? `<span class="crmb crmb-blue">клиент</span>` : `<span class="erp-muted">указател</span>`);
  const rowsData = [];
  list.forEach(p => {
    const cts = compContactsFor(p);
    const inv = cts.find(c => compRolesOf(c.id).includes("invoice"));
    const trade = hits.get(p.id) || compTradeFor(p).slice(0, 3);
    const isHit = hits.has(p.id);
    const rq = compReq(p);
    let fb = { person: rq.person, phone: rq.phone, email: rq.email, src: rq.fromPassport ? "от паспорта" : "от реквизитите" };
    if (p.kind === "customer" && !fb.person && !fb.phone && !fb.email && typeof cliProfile === "function") {
      const cp = cliProfile(p.name);
      const cc = ((cp && cp.contacts) || []).find(c => c && (c.name || c.phone || c.email));
      if (cc) fb = { person: cc.name, phone: cc.phone, email: cc.email, src: "от паспорта на клиента" };
    }
    rowsData.push({ name: String(p.name || ""), html: `<tr class="erp-clickable" data-comp="${p.id}">
      <td><b>${escapeHtml(p.name || "—")}</b></td>
      <td>${kindBadge(p.kind)}</td>
      <td>${escapeHtml(rq.eik || "")}</td>
      <td>${inv ? `<span class="t-code">${escapeHtml(inv.email || "")}</span><div class="erp-muted" style="font-size:11px">${escapeHtml(inv.contact_person || "")}</div>` : `<span class="erp-muted" title="Отвори картона и отметни роля 🧾 на контакта, който получава фактурите">—</span>`}</td>
      <td style="max-width:190px">${peopleCell(cts, fb)}</td>
      <td style="max-width:330px;font-size:12px">${isHit ? `<span class="supp-hit">🎯 ${trade.map(t => `<b>${escapeHtml(t.name)}</b>${t.lastPrice ? ` (${t.lastPrice} ${escapeHtml(t.cur || "")})` : ""}`).join(" · ")}</span>` : `<span class="erp-muted">${trade.map(t => escapeHtml(t.name)).join(" · ") || "—"}</span>`}</td>
      <td class="erp-row-actions"><button class="btn btn-small" data-compopen="${p.id}">📇 Картон</button></td>
    </tr>` });
  });
  orphans.forEach(o => {
    rowsData.push({ name: o.name, html: `<tr class="erp-clickable" data-orph="${escapeAttr(o.key)}" style="opacity:.78">
      <td><b>${escapeHtml(o.name)}</b><div class="erp-muted" style="font-size:11px">само в указателя — без реквизити</div></td>
      <td>${kindBadge(o.kind)}</td>
      <td><span class="erp-muted">—</span></td>
      <td><span class="erp-muted">—</span></td>
      <td style="max-width:190px">${peopleCell(o.cts)}</td>
      <td style="max-width:330px;font-size:12px"><span class="erp-muted">—</span></td>
      <td class="erp-row-actions"><button class="btn btn-small" data-orphopen="${escapeAttr(o.key)}">📇 Картон</button></td>
    </tr>` });
  });
  rowsData.sort((a, b) => a.name.localeCompare(b.name, "bg"));

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${list.length + orphans.length} фирми${orphans.length ? ` (${orphans.length} само от указателя)` : ""}${hiddenOrph ? ` · още ${hiddenOrph} без тип → Всички` : ""}</span>
      <button class="btn btn-small ${compKindF === "customer" ? "btn-primary" : ""}" id="comp-tab-cli">👤 Клиенти</button>
      <button class="btn btn-small ${compKindF === "supplier" ? "btn-primary" : ""}" id="comp-tab-sup">🏭 Доставчици</button>
      <button class="btn btn-small ${compKindF === "" ? "btn-primary" : ""}" id="comp-tab-all" title="Всички заедно, вкл. фирмите от указателя без определен тип">Всички</button>
      <input type="search" id="comp-q" placeholder="🔎 фирма / продукт / контакт… после Enter" value="${escapeAttr(compQuery)}" style="width:270px;flex:0 0 auto" autocomplete="off" title="Търси и в търгуваното: „шайба" → доставчикът; „механизъм" → клиентите, които го купуват" />
      <button class="btn btn-small" id="comp-go">🔎</button>
      <span class="spacer"></span>
      <button class="btn btn-small" id="comp-inq" title="Изпрати запитване по имейл до избрани доставчици">📨 Запитване до доставчици</button>
      <button class="btn btn-small" id="comp-inqreg" title="Регистър на изпратените запитвания">📋 Регистър запитвания</button>
      <button class="btn btn-small" id="comp-oldc" title="Старият указател Контакти — пълният списък с категории и бележки">📇 Стар указател</button>
      <button class="btn btn-small" id="comp-old" title="Старият изглед (директориите поотделно)">⚙ Стар изглед</button>
      <button class="btn btn-small btn-primary" id="comp-add">+ Нова фирма</button>
    </div>
    <p class="hint">Картонът на фирмата събира ВСИЧКО: реквизити (за фактурите), хора с роли (🧾 кой получава фактурите · 📨 кой получава поръчките · 📥 кой ни праща заявки) и какво търгуваме (пълни се само̀ от Покупки/Заявки). Фирмите в сиво са само от указателя Контакти — отвори картона им и цъкни ➕ Създай реквизити.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Фирма</th><th>Тип</th><th>ЕИК</th><th>🧾 Фактури на</th><th>Хора (лице · тел.)</th><th>Търгуваме (авто)</th><th></th></tr></thead>
      <tbody>${rowsData.map(r => r.html).join("") || `<tr><td colspan="7" class="report-empty">Няма фирми по този филтър.</td></tr>`}</tbody>
    </table>`;
  const doSearch = () => { compQuery = (v.querySelector("#comp-q") || {}).value || ""; erpRenderCompanies(); };
  const qEl = v.querySelector("#comp-q");
  if (qEl) {
    qEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
    qEl.addEventListener("search", () => { if (!qEl.value) doSearch(); });
  }
  v.querySelector("#comp-go").addEventListener("click", doSearch);
  v.querySelector("#comp-tab-cli").addEventListener("click", () => { compKindF = "customer"; erpRenderCompanies(); });
  v.querySelector("#comp-tab-sup").addEventListener("click", () => { compKindF = "supplier"; erpRenderCompanies(); });
  v.querySelector("#comp-tab-all").addEventListener("click", () => { compKindF = ""; erpRenderCompanies(); });
  v.querySelector("#comp-inq").addEventListener("click", () => { if (typeof openContactsInquiry === "function") openContactsInquiry("form"); });
  v.querySelector("#comp-inqreg").addEventListener("click", () => { if (typeof openContactsInquiry === "function") openContactsInquiry("registry"); });
  v.querySelector("#comp-oldc").addEventListener("click", () => { if (typeof openContacts === "function") openContacts(); });
  v.querySelector("#comp-old").addEventListener("click", () => erpRenderPartners());
  v.querySelector("#comp-add").addEventListener("click", () => erpEditPartner(null, { kind: compKindF || undefined }));
  v.querySelectorAll("[data-compopen]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); compCard(Number(b.dataset.compopen)); }));
  v.querySelectorAll("tr[data-comp]").forEach(tr => tr.addEventListener("click", () => compCard(Number(tr.dataset.comp))));
  v.querySelectorAll("[data-orphopen]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); compCardOrphan(b.dataset.orphopen); }));
  v.querySelectorAll("tr[data-orph]").forEach(tr => tr.addEventListener("click", () => compCardOrphan(tr.dataset.orph)));
}

/* Картон на фирма, която е САМО в указателя (без ред в реквизитите):
   показва хората ѝ и предлага да ѝ се създадат реквизити с едно цъкане. */
function compCardOrphan(key) {
  const o = (window.COMP_ORPH && window.COMP_ORPH.get(key)) || null;
  if (!o) { alert("Фирмата не е намерена."); return; }
  const c0 = o.cts[0] || {};
  const { wrap, close } = erpDialog(`
    <h3>📇 ${escapeHtml(o.name)} <span class="erp-muted" style="font-size:13px">само в указателя</span></h3>
    <p class="hint">Тази фирма още няма реквизити (ЕИК, ДДС, адрес) — има само хора в указателя Контакти. За фактури/заявки ѝ трябват реквизити.</p>
    ${o.cts.map(c => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-bottom:6px">
        <b>${escapeHtml(c.contact_person || "—")}</b> · <span class="t-code">${escapeHtml(c.email || "без имейл")}</span>${c.phone ? " · 📞 " + escapeHtml(c.phone) : ""}
        ${c.category ? `<span class="erp-muted" style="font-size:11px"> · ${escapeHtml(c.category)}</span>` : ""}
        ${c.scope ? `<div class="erp-muted" style="font-size:11.5px;margin-top:2px">${escapeHtml(c.scope)}</div>` : ""}
        ${c.notes ? `<div class="erp-muted" style="font-size:11.5px;margin-top:2px">${escapeHtml(String(c.notes).slice(0, 200))}</div>` : ""}
      </div>`).join("")}
    <div class="erp-dialog-actions">
      <button class="btn btn-primary" id="orph-create">➕ Създай реквизити (нова фирма)</button>
      <span class="spacer"></span>
      <button class="btn" id="orph-close">Затвори</button>
    </div>`);
  wrap.querySelector("#orph-close").addEventListener("click", close);
  wrap.querySelector("#orph-create").addEventListener("click", () => {
    close();
    erpEditPartner(null, { kind: o.kind || "customer", name: o.name, person: c0.contact_person || "", phone: c0.phone || "", email: c0.email || "" });
  });
}

/* Сборните реквизити на фирмата: собствените ѝ полета, а при доставчик —
   допълнени от 🏷 Паспорта на доставчика (там живеят ЕИК, лице, телефон,
   имейл за фактури). Нищо не се губи, само се чете от двете места. */
function compReq(p) {
  const sp = (p.kind === "supplier" && typeof suppProfile === "function") ? (suppProfile(p.name) || {}) : {};
  return {
    eik: compEik(p) || sp.eik || "",
    vat: p.vat || sp.vat || "",
    addr: [p.city, p.street, p.country].filter(Boolean).join(", ") || [sp.addr, sp.country].filter(Boolean).join(", ") || "",
    person: p.person || sp.person || "",
    phone: p.phone || sp.phone || "",
    email: p.email || sp.email || "",
    fromPassport: !!(sp.eik || sp.person || sp.phone || sp.email || sp.addr),
  };
}

/* ---------- Картонът ---------- */
async function compCard(pid) {
  const p = (erpPartners || []).find(x => x.id === pid);
  if (!p) { alert("Фирмата не е намерена."); return; }
  try { if (typeof suppLoad === "function") await suppLoad(); } catch (e) {}
  try { if (typeof cliLoad === "function") await cliLoad(); } catch (e) {}
  const rq = compReq(p);
  const cts = compContactsFor(p);
  const trade = compTradeFor(p);
  // Контактите по роли от 🧭 Паспорта на клиента (Поръчки, Качество, Счетоводство…)
  const cliP = (p.kind === "customer" && typeof cliProfile === "function") ? cliProfile(p.name) : null;
  const cliCts = ((cliP && cliP.contacts) || []).filter(c => c && (c.name || c.phone || c.email));
  const cliRoleLbl = r => (typeof CLI_ROLES !== "undefined" && (CLI_ROLES.find(x => x[0] === r) || [])[1]) || r;
  // Паспортът на доставчика — показва се ЦЕЛИЯТ наличен (не само като резерва).
  const spRaw = (p.kind === "supplier" && typeof suppProfile === "function") ? suppProfile(p.name) : null;
  const spP = (spRaw && (spRaw.person || spRaw.phone || spRaw.email || spRaw.eik || spRaw.vat || spRaw.addr || spRaw.whatWeBuy)) ? spRaw : null;
  const roleChips = c => COMP_ROLES.map(([k, l]) =>
    `<label class="erp-inline" style="font-size:12px"><input type="checkbox" class="comp-role" data-cid="${c.id}" data-role="${k}" ${compRolesOf(c.id).includes(k) ? "checked" : ""} /> ${l}</label>`).join(" ");
  const freeContacts = ((typeof CONTACTS !== "undefined" && CONTACTS) || []).filter(c => !cts.includes(c));
  // Предложения: свободни контакти, чието име на фирма споделя дума с тази фирма.
  const ptoks = compLoose(p.name).filter(w => w.length >= 3);
  const sugg = freeContacts
    .map(c => ({ c, n: compLoose(c.company).filter(w => w.length >= 3 && ptoks.includes(w)).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  const { wrap, close } = erpDialog(`
    <h3>📇 ${escapeHtml(p.name || "—")} ${p.kind === "supplier" ? `<span class="crmb crmb-orange">доставчик</span>` : `<span class="crmb crmb-blue">клиент</span>`}</h3>

    <h4 class="erp-group-head">1 · Реквизити (за документите)</h4>
    <div class="crm-kv"><span>ЕИК / ДДС №</span><b>${escapeHtml(rq.eik || "—")}${!p.eik && rq.eik ? ` <span class="erp-muted" style="font-size:11px">(от ДДС/паспорта)</span>` : ""}${rq.vat ? " · " + escapeHtml(rq.vat) : ""}</b></div>
    <div class="crm-kv"><span>МОЛ</span><b>${escapeHtml(p.mol || "—")}</b></div>
    <div class="crm-kv"><span>Адрес</span><b>${escapeHtml(rq.addr || "—")}</b></div>
    ${(rq.person || rq.phone || rq.email) ? `<div class="crm-kv"><span>Лице / тел. / имейл</span><b>${escapeHtml([rq.person, rq.phone, rq.email].filter(Boolean).join(" · "))}</b></div>` : ""}
    ${p.note ? `<div class="crm-kv"><span>Забележка</span><b>${escapeHtml(p.note)}</b></div>` : ""}
    ${rq.fromPassport ? `<p class="erp-muted" style="font-size:11.5px;margin:2px 0">част от данните идват от 🏷 Паспорта на доставчика</p>` : ""}
    <p style="margin:4px 0"><button class="btn btn-small" id="comp-editreq">✎ Редактирай реквизитите</button> <span class="hint">фактурите/заявките четат точно тези данни</span></p>

    <h4 class="erp-group-head">2 · Хора и роли (за комуникацията)</h4>
    ${cts.length ? cts.map(c => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-bottom:6px">
        <button class="btn btn-small comp-unlink" data-cid="${c.id}" title="Откачи този контакт от фирмата (остава си в указателя)" style="float:right">✂ Откачи</button>
        <b>${escapeHtml(c.contact_person || "—")}</b> · <span class="t-code">${escapeHtml(c.email || "без имейл")}</span>${c.phone ? " · 📞 " + escapeHtml(c.phone) : ""}
        ${c.category ? `<span class="erp-muted" style="font-size:11px"> · ${escapeHtml(c.category)}</span>` : ""}
        <div style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">${roleChips(c)}</div>
        ${c.scope ? `<div class="erp-muted" style="font-size:11.5px;margin-top:2px">${escapeHtml(c.scope)}</div>` : ""}
        ${c.notes ? `<div class="erp-muted" style="font-size:11.5px;margin-top:2px">${escapeHtml(String(c.notes).slice(0, 200))}</div>` : ""}
      </div>`).join("") : `<p class="erp-muted">Няма закачени контакти — закачи от указателя или добави нов.</p>`}
    ${(cliP && (cliCts.length || cliP.addr || cliP.orderChannel)) ? `<div style="border:1px solid #bae6fd;background:#f0f9ff;border-radius:10px;padding:8px 10px;margin-bottom:6px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">🧭 От Паспорта на клиента:</div>
      ${cliCts.map(c => `<div style="font-size:12.5px;margin-bottom:3px"><span class="erp-muted">${escapeHtml(cliRoleLbl(c.role))}:</span> <b>${escapeHtml(c.name || "—")}</b>${c.phone ? " · 📞 " + escapeHtml(c.phone) : ""}${c.email ? ` · <span class="t-code">${escapeHtml(c.email)}</span>` : ""}${c.note ? ` <span class="erp-muted">· ${escapeHtml(c.note)}</span>` : ""}</div>`).join("")}
      ${cliP.addr ? `<div style="font-size:12px"><span class="erp-muted">Адрес(и) за доставка:</span> ${escapeHtml(cliP.addr)}</div>` : ""}
      ${cliP.orderChannel ? `<div style="font-size:12px"><span class="erp-muted">Как приемат поръчки:</span> ${escapeHtml(cliP.orderChannel)}</div>` : ""}
    </div>` : ""}
    ${spP ? `<div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:10px;padding:8px 10px;margin-bottom:6px">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px">🏷 От Паспорта на доставчика:</div>
      ${(spP.person || spP.phone || spP.email) ? `<div style="font-size:12.5px;margin-bottom:3px"><b>${escapeHtml(spP.person || "—")}</b>${spP.phone ? " · 📞 " + escapeHtml(spP.phone) : ""}${spP.email ? ` · <span class="t-code">${escapeHtml(spP.email)}</span> <span class="erp-muted">(имейл за фактури)</span>` : ""}</div>` : ""}
      ${(spP.eik || spP.vat) ? `<div style="font-size:12px"><span class="erp-muted">ЕИК / ДДС №:</span> ${escapeHtml([spP.eik, spP.vat].filter(Boolean).join(" · "))}</div>` : ""}
      ${spP.addr ? `<div style="font-size:12px"><span class="erp-muted">Адрес:</span> ${escapeHtml([spP.addr, spP.country].filter(Boolean).join(", "))}</div>` : ""}
      ${spP.whatWeBuy ? `<div style="font-size:12px"><span class="erp-muted">Какво купуваме:</span> ${escapeHtml(spP.whatWeBuy)}</div>` : ""}
    </div>` : ""}
    ${sugg.length ? `<div style="border:1px dashed #94a3b8;border-radius:10px;padding:8px 10px;margin-bottom:6px">
      <div class="erp-muted" style="font-size:12px;margin-bottom:4px">Може би са на тази фирма (от указателя Контакти):</div>
      ${sugg.map(x => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:3px;font-size:12.5px">
        <button class="btn btn-small comp-sugg" data-cid="${x.c.id}">🔗 Закачи</button>
        <span><b>${escapeHtml(x.c.company || "")}</b> · ${escapeHtml(x.c.contact_person || "—")}${x.c.phone ? " · 📞 " + escapeHtml(x.c.phone) : ""}${x.c.email ? ` · <span class="t-code">${escapeHtml(x.c.email)}</span>` : ""}</span>
      </div>`).join("")}
    </div>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input type="text" id="comp-linkpick" list="comp-freec" placeholder="🔗 закачи съществуващ контакт…" style="width:250px;flex:0 0 auto" autocomplete="off" />
      <datalist id="comp-freec">${freeContacts.slice(0, 400).map(c => `<option value="${escapeAttr(`${c.company || "?"} · ${c.contact_person || c.email || c.phone || c.id}`)}"></option>`).join("")}</datalist>
      <button class="btn btn-small" id="comp-linkgo">🔗 Закачи</button>
      <button class="btn btn-small" id="comp-newc">➕ Нов контакт</button>
    </div>

    <h4 class="erp-group-head">3 · Търгуваме (пълни се само̀ — ${p.kind === "supplier" ? "от Покупки" : "от Заявки"})</h4>
    ${trade.length ? `<div style="max-height:240px;overflow:auto"><table class="report-table erp-table" style="font-size:12px">
      <thead><tr><th>Код</th><th>${p.kind === "supplier" ? "Артикул" : "Изделие"}</th><th class="num">${p.kind === "supplier" ? "Пъти" : "Общо бр."}</th><th>Последно</th><th class="num">Посл. цена</th></tr></thead>
      <tbody>${trade.slice(0, 15).map(t => `<tr><td class="t-code">${escapeHtml(t.code || "")}</td><td>${escapeHtml(t.name)}</td><td class="num">${p.kind === "supplier" ? t.n : erpNum(Math.round(t.qty || 0))}</td><td>${escapeHtml(erpDMY(t.last) || "")}</td><td class="num">${t.lastPrice ? t.lastPrice + " " + escapeHtml(t.cur || "") : ""}</td></tr>`).join("")}</tbody>
    </table></div>${trade.length > 15 ? `<p class="erp-muted" style="font-size:11px">…и още ${trade.length - 15}.</p>` : ""}` : `<p class="erp-muted">Още няма документи с тази фирма.</p>`}

    <div class="erp-dialog-actions">
      ${p.kind === "supplier" && typeof erpMatReqCompose === "function" ? `<button class="btn" id="comp-order">🛒 Заявка за материали</button>` : ""}
      ${p.kind === "supplier" && typeof suppForm === "function" ? `<button class="btn" id="comp-passport">🏷 Паспорт (счетоводен)</button>` : ""}
      ${p.kind === "customer" && typeof cliForm === "function" ? `<button class="btn" id="comp-clipass">🧭 Паспорт на клиента</button>` : ""}
      <span class="spacer"></span>
      <button class="btn" id="comp-close">Затвори</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#comp-close").addEventListener("click", close);
  wrap.querySelector("#comp-editreq").addEventListener("click", () => { close(); erpEditPartner(p.id); });
  const ord = wrap.querySelector("#comp-order");
  if (ord) ord.addEventListener("click", () => { close(); erpMatReqCompose([], null, p.name); });
  const pass = wrap.querySelector("#comp-passport");
  if (pass) pass.addEventListener("click", () => { close(); suppForm(p.name); });
  const clip = wrap.querySelector("#comp-clipass");
  if (clip) clip.addEventListener("click", () => { close(); cliForm(p.name); });
  // Ролите: пишат се веднага (един източник за пращането на фактури — Фаза Б).
  wrap.querySelectorAll(".comp-role").forEach(cb => cb.addEventListener("change", async () => {
    const cid = String(cb.dataset.cid), role = cb.dataset.role;
    const cur = new Set(COMP_DIR.roles[cid] || []);
    if (cb.checked) cur.add(role); else cur.delete(role);
    // 🧾 фактури: по един на фирма — новата отметка сваля старата.
    if (role === "invoice" && cb.checked) {
      cts.forEach(c => { if (String(c.id) !== cid) { const r = new Set(COMP_DIR.roles[String(c.id)] || []); if (r.delete("invoice")) COMP_DIR.roles[String(c.id)] = [...r]; } });
      wrap.querySelectorAll(`.comp-role[data-role="invoice"]`).forEach(x => { if (x !== cb) x.checked = false; });
    }
    COMP_DIR.roles[cid] = [...cur];
    await compDirSave();
  }));
  // ✂ Откачане: контактът остава в указателя, но вече не се води на тази фирма
  // (links = 0 значи „изрично откачен" — и авто-мачът спира да го връща тук).
  wrap.querySelectorAll(".comp-unlink").forEach(b => b.addEventListener("click", async () => {
    const c = cts.find(x => String(x.id) === String(b.dataset.cid));
    if (!confirm(`Да откача ли ${(c && (c.contact_person || c.email)) || "този контакт"} от ${p.name}?`)) return;
    COMP_DIR.links[String(b.dataset.cid)] = 0;
    if (await compDirSave()) { close(); compCard(p.id); }
  }));
  // Предложените контакти — закачане с едно цъкане.
  wrap.querySelectorAll(".comp-sugg").forEach(b => b.addEventListener("click", async () => {
    COMP_DIR.links[String(b.dataset.cid)] = p.id;
    if (await compDirSave()) { close(); compCard(p.id); }
  }));
  // Закачане на съществуващ контакт към фирмата.
  wrap.querySelector("#comp-linkgo").addEventListener("click", async () => {
    const val = wrap.querySelector("#comp-linkpick").value.trim();
    if (!val) return;
    const c = freeContacts.find(x => `${x.company || "?"} · ${x.contact_person || x.email || x.phone || x.id}` === val);
    if (!c) { alert("Избери контакт от списъка (пиши името на фирмата му, за да го намериш)."); return; }
    COMP_DIR.links[String(c.id)] = p.id;
    if (await compDirSave()) { close(); compCard(p.id); }
  });
  // Нов контакт направо от картона — влиза в СЪЩАТА таблица contacts.
  wrap.querySelector("#comp-newc").addEventListener("click", async () => {
    const person = prompt("Име на човека (или отдел):", ""); if (person == null) return;
    const email = prompt("Имейл:", "") || "";
    const phone = prompt("Телефон:", "") || "";
    const cat = p.kind === "supplier" ? "Доставчик – други" : "Клиент – вътрешен пазар";
    try {
      const row = { company: p.name, contact_person: person.trim(), email: email.trim(), phone: phone.trim(), category: cat, notes: "" };
      const { data, error } = await sb.from("contacts").insert({ data: row }).select("id").single();
      if (error) throw error;
      if (typeof CONTACTS !== "undefined" && CONTACTS) CONTACTS.push({ ...row, id: data.id });
      COMP_DIR.links[String(data.id)] = p.id;
      await compDirSave();
      close(); compCard(p.id);
    } catch (e) { alert("Грешка при създаване: " + (e.message || e)); }
  });
}
/* ---------- 🧾 Фактурният имейл на клиент (за пращането на фактури) ----------
   Вика се от erpMailInvoice: контактът с роля „получава фактури" от картона.
   Няма ли такъв → null и пращането пада на старата логика (partners email),
   а човекът вижда и може да смени адреса в диалога преди изпращане. */
async function compInvoiceEmail(clientId, clientName) {
  try {
    await compDirLoad();
    if (typeof erpPartners === "undefined" || !erpPartners) await erpLoadPartners();
    if ((typeof CONTACTS === "undefined" || !CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad();
    const p = (erpPartners || []).find(x => clientId && x.id === clientId)
      || (erpPartners || []).find(x => compNorm(x.name) === compNorm(clientName));
    if (!p) return null;
    const c = compContactsFor(p).find(x => compRolesOf(x.id).includes("invoice") && (x.email || "").includes("@"));
    if (c) return { email: c.email, person: c.contact_person || "" };
    // Резерва: 🧭 Паспорт на клиента → роля „Счетоводство / плащания".
    try { if (typeof cliLoad === "function") await cliLoad(); } catch (e2) {}
    const cp = (typeof cliProfile === "function") ? cliProfile(p.name) : null;
    const fc = ((cp && cp.contacts) || []).find(x => x && x.role === "finance" && (x.email || "").includes("@"));
    return fc ? { email: fc.email, person: fc.name || "" } : null;
  } catch (e) { return null; }
}
