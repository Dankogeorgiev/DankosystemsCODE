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
let compKindF = "";            // "" | customer | supplier

function compNorm(s) { return String(s || "").toLowerCase().replace(/х/g, "x").replace(/["'„“”.,\-–—()]/g, " ").replace(/\s+/g, " ").trim(); }

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

/* Контактите на фирмата: ръчно закачените + авто-мач по име на фирмата. */
function compContactsFor(p) {
  const n = compNorm(p.name);
  return ((typeof CONTACTS !== "undefined" && CONTACTS) || []).filter(c => {
    const manual = COMP_DIR && COMP_DIR.links[String(c.id)];
    if (manual != null) return String(manual) === String(p.id);
    return compNorm(c.company) === n;
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
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { if (typeof erpPartners === "undefined" || !erpPartners) await erpLoadPartners(); } catch (e) { try { await erpLoadPartners(); } catch (e2) {} }
  try { if ((typeof CONTACTS === "undefined" || !CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad(); } catch (e) {}
  try { if ((typeof erpCOList === "undefined" || !erpCOList) && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  try { if ((typeof erpPurchases === "undefined" || !erpPurchases) && typeof erpLoadPurchases === "function") await erpLoadPurchases(); } catch (e) {}
  try { if (typeof suppLoad === "function") await suppLoad(); } catch (e) {}
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
        cts.map(c => `${c.contact_person} ${c.email} ${c.phone} ${c.notes}`).join(" "),
        trade.map(t => `${t.code} ${t.name}`).join(" ")].join(" "));
      if (!words.every(w => hay.includes(w))) return false;
      const th = trade.filter(t => { const h = compNorm(t.code + " " + t.name); return words.some(w => h.includes(w)); });
      if (th.length) hits.set(p.id, th.slice(0, 3));
      return true;
    });
  }
  list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "bg"));

  // Контакти-фирми, които ги НЯМА в partners (само указател) — броим ги за инфо.
  const partnerNames = new Set((erpPartners || []).map(p => compNorm(p.name)));
  const orphanCompanies = [...new Set(((typeof CONTACTS !== "undefined" && CONTACTS) || [])
    .filter(c => (c.company || "").trim() && !partnerNames.has(compNorm(c.company)) && !(COMP_DIR.links[String(c.id)] != null))
    .map(c => c.company.trim()))];

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${list.length} фирми</span>
      <input type="search" id="comp-q" placeholder="🔎 фирма / продукт / контакт… после Enter" value="${escapeAttr(compQuery)}" style="width:270px;flex:0 0 auto" autocomplete="off" title="Търси и в търгуваното: „шайба" → доставчикът; „механизъм" → клиентите, които го купуват" />
      <button class="btn btn-small" id="comp-go">🔎</button>
      <select id="comp-kind" style="width:auto">
        <option value="">Всички</option>
        <option value="customer" ${compKindF === "customer" ? "selected" : ""}>Клиенти</option>
        <option value="supplier" ${compKindF === "supplier" ? "selected" : ""}>Доставчици</option>
      </select>
      <span class="spacer"></span>
      <button class="btn btn-small" id="comp-inq" title="Изпрати запитване по имейл до избрани доставчици">📨 Запитване до доставчици</button>
      <button class="btn btn-small" id="comp-inqreg" title="Регистър на изпратените запитвания">📋 Регистър запитвания</button>
      <button class="btn btn-small" id="comp-oldc" title="Старият указател Контакти — пълният списък с категории и бележки">📇 Стар указател</button>
      <button class="btn btn-small" id="comp-old" title="Старият изглед (директориите поотделно)">⚙ Стар изглед</button>
      <button class="btn btn-small btn-primary" id="comp-add">+ Нова фирма</button>
    </div>
    <p class="hint">Картонът на фирмата събира ВСИЧКО: реквизити (за фактурите), хора с роли (🧾 кой получава фактурите · 📨 кой получава поръчките · 📥 кой ни праща заявки) и какво търгуваме (пълни се само̀ от Покупки/Заявки).${orphanCompanies.length ? ` · <span class="erp-muted">${orphanCompanies.length} фирми са само в стария указател (без реквизити) — виж ги през 📇 Стар указател.</span>` : ""}</p>
    <table class="report-table erp-table">
      <thead><tr><th>Фирма</th><th>Тип</th><th>ЕИК</th><th>🧾 Фактури на</th><th>Хора</th><th>Търгуваме (авто)</th><th></th></tr></thead>
      <tbody>${list.map(p => {
        const cts = compContactsFor(p);
        const inv = cts.find(c => compRolesOf(c.id).includes("invoice"));
        const trade = hits.get(p.id) || compTradeFor(p).slice(0, 3);
        const isHit = hits.has(p.id);
        return `<tr class="erp-clickable" data-comp="${p.id}">
          <td><b>${escapeHtml(p.name || "—")}</b></td>
          <td>${p.kind === "supplier" ? `<span class="crmb crmb-orange">доставчик</span>` : `<span class="crmb crmb-blue">клиент</span>`}</td>
          <td>${escapeHtml(p.eik || "")}</td>
          <td>${inv ? `<span class="t-code">${escapeHtml(inv.email || "")}</span><div class="erp-muted" style="font-size:11px">${escapeHtml(inv.contact_person || "")}</div>` : `<span class="erp-muted" title="Отвори картона и отметни роля 🧾 на контакта, който получава фактурите">—</span>`}</td>
          <td class="num">${cts.length || `<span class="erp-muted">0</span>`}</td>
          <td style="max-width:330px;font-size:12px">${isHit ? `<span class="supp-hit">🎯 ${trade.map(t => `<b>${escapeHtml(t.name)}</b>${t.lastPrice ? ` (${t.lastPrice} ${escapeHtml(t.cur || "")})` : ""}`).join(" · ")}</span>` : `<span class="erp-muted">${trade.map(t => escapeHtml(t.name)).join(" · ") || "—"}</span>`}</td>
          <td class="erp-row-actions"><button class="btn btn-small" data-compopen="${p.id}">📇 Картон</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="7" class="report-empty">Няма фирми по този филтър.</td></tr>`}</tbody>
    </table>`;
  const doSearch = () => { compQuery = (v.querySelector("#comp-q") || {}).value || ""; erpRenderCompanies(); };
  const qEl = v.querySelector("#comp-q");
  if (qEl) {
    qEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });
    qEl.addEventListener("search", () => { if (!qEl.value) doSearch(); });
  }
  v.querySelector("#comp-go").addEventListener("click", doSearch);
  v.querySelector("#comp-kind").addEventListener("change", e => { compKindF = e.target.value; erpRenderCompanies(); });
  v.querySelector("#comp-inq").addEventListener("click", () => { if (typeof openContactsInquiry === "function") openContactsInquiry("form"); });
  v.querySelector("#comp-inqreg").addEventListener("click", () => { if (typeof openContactsInquiry === "function") openContactsInquiry("registry"); });
  v.querySelector("#comp-oldc").addEventListener("click", () => { if (typeof openContacts === "function") openContacts(); });
  v.querySelector("#comp-old").addEventListener("click", () => erpRenderPartners());
  v.querySelector("#comp-add").addEventListener("click", () => erpEditPartner(null));
  v.querySelectorAll("[data-compopen]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); compCard(Number(b.dataset.compopen)); }));
  v.querySelectorAll("tr[data-comp]").forEach(tr => tr.addEventListener("click", () => compCard(Number(tr.dataset.comp))));
}

/* ---------- Картонът ---------- */
async function compCard(pid) {
  const p = (erpPartners || []).find(x => x.id === pid);
  if (!p) { alert("Фирмата не е намерена."); return; }
  const cts = compContactsFor(p);
  const trade = compTradeFor(p);
  const roleChips = c => COMP_ROLES.map(([k, l]) =>
    `<label class="erp-inline" style="font-size:12px"><input type="checkbox" class="comp-role" data-cid="${c.id}" data-role="${k}" ${compRolesOf(c.id).includes(k) ? "checked" : ""} /> ${l}</label>`).join(" ");
  const freeContacts = ((typeof CONTACTS !== "undefined" && CONTACTS) || []).filter(c => !cts.includes(c));
  const { wrap, close } = erpDialog(`
    <h3>📇 ${escapeHtml(p.name || "—")} ${p.kind === "supplier" ? `<span class="crmb crmb-orange">доставчик</span>` : `<span class="crmb crmb-blue">клиент</span>`}</h3>

    <h4 class="erp-group-head">1 · Реквизити (за документите)</h4>
    <div class="crm-kv"><span>ЕИК / ДДС №</span><b>${escapeHtml(p.eik || "—")}${p.vat ? " · " + escapeHtml(p.vat) : ""}</b></div>
    <div class="crm-kv"><span>МОЛ</span><b>${escapeHtml(p.mol || "—")}</b></div>
    <div class="crm-kv"><span>Адрес</span><b>${escapeHtml([p.city, p.street, p.country].filter(Boolean).join(", ") || "—")}</b></div>
    <p style="margin:4px 0"><button class="btn btn-small" id="comp-editreq">✎ Редактирай реквизитите</button> <span class="hint">фактурите/заявките четат точно тези данни</span></p>

    <h4 class="erp-group-head">2 · Хора и роли (за комуникацията)</h4>
    ${cts.length ? cts.map(c => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;margin-bottom:6px">
        <b>${escapeHtml(c.contact_person || "—")}</b> · <span class="t-code">${escapeHtml(c.email || "без имейл")}</span>${c.phone ? " · " + escapeHtml(c.phone) : ""}
        ${c.category ? `<span class="erp-muted" style="font-size:11px"> · ${escapeHtml(c.category)}</span>` : ""}
        <div style="margin-top:4px;display:flex;gap:12px;flex-wrap:wrap">${roleChips(c)}</div>
        ${c.notes ? `<div class="erp-muted" style="font-size:11.5px;margin-top:2px">${escapeHtml(String(c.notes).slice(0, 140))}</div>` : ""}
      </div>`).join("") : `<p class="erp-muted">Няма закачени контакти — закачи от указателя или добави нов.</p>`}
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
    return c ? { email: c.email, person: c.contact_person || "" } : null;
  } catch (e) { return null; }
}
