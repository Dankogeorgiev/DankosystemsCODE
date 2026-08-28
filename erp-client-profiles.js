/* Данко Системс — ЕРП „🧭 Паспорти на клиенти".
   Всичко специфично за клиента на едно място: качество и чести грешки, палети
   и опаковка, транспорт, рекламации, контакти по роли, търговски условия и
   ХРОНОЛОГИЯ на научените уроци. Целта е знанието да остане във фирмата, а не
   в главата на един човек.
   Половината се пълни САМО: изделия и обеми от продажбите, опаковъчните
   спецификации, запомнената подредба на палета, рекламациите от регистъра.
   Пази се в app_config id="client_profiles": { byKey: { "<ключ>": {...} } }.
   Ключът е нормализираното име на клиента (както се пише в заявките).
   Ползва ERP/erpView/erpDialog/erpDMY/erpNum/escapeHtml/sb + reportExportXls. */

let CLI_PROFILES = null;
let cliQuery = "";
let cliOnlyEmpty = false;
let cliMonths = 3;             // клиенти с движение в последните N месеца (0 = всички)
let cliSort = "turnover";      // turnover | name | filled
let CLI_CLAIMS = null;         // рекламации (зареждат се веднъж, лениво)

function cliKey(n) { return String(n || "").trim().replace(/\s+/g, " ").toLowerCase(); }
function cliMoney(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR"; }
function cliNum(v) { return (typeof erpToNum === "function") ? (erpToNum(v) || 0) : (Number(v) || 0); }

/* ---------- Речници ---------- */
const CLI_ROLES = [
  ["orders", "Поръчки"],
  ["quality", "Качество / рекламации"],
  ["logistics", "Логистика и склад"],
  ["finance", "Счетоводство / плащания"],
  ["urgent", "Спешен контакт"],
];
const CLI_TRANSPORT = [
  ["we", "Ние организираме транспорта"],
  ["they", "Клиентът организира (идват за стоката)"],
  ["forwarder", "Спедитор"],
  ["courier", "Куриер"],
];
const CLI_PALLET = [
  ["eur", "EUR палет 120×80"],
  ["small", "Палет 60×80"],
  ["oneway", "Еднократен палет"],
  ["client", "Палети на клиента (връщат се)"],
  ["none", "Без палет (в кашони / насипно)"],
];

/* ---------- Данни ---------- */
async function cliLoad() {
  if (CLI_PROFILES) return CLI_PROFILES;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "client_profiles").maybeSingle();
    CLI_PROFILES = { byKey: (data && data.data && data.data.byKey) || {} };
  } catch (e) { CLI_PROFILES = { byKey: {} }; }
  return CLI_PROFILES;
}
async function cliSave() {
  const { error } = await sb.from("app_config")
    .upsert({ id: "client_profiles", data: { byKey: (CLI_PROFILES || {}).byKey || {} }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function cliProfile(name) { return ((CLI_PROFILES || {}).byKey || {})[cliKey(name)] || null; }
async function cliEnsureLoaded() { await cliLoad(); }
function cliHasProfile(name) { return !!cliProfile(name); }
// Колко от важните полета са попълнени (за индикатора „Готов").
function cliFilled(p) {
  if (!p) return 0;
  const must = [
    p.quality && p.quality.mistakes, p.quality && p.quality.checks,
    p.pack && p.pack.type, p.pack && p.pack.label,
    p.transport && p.transport.who, p.claims && p.claims.typical,
    (p.contacts || []).some(c => c && (c.name || c.phone || c.email)) ? "1" : "",
    p.owner,
  ];
  return Math.round(must.filter(x => String(x || "").trim()).length / must.length * 100);
}
function cliSinceStr() {
  if (!cliMonths) return "";
  const d = new Date(); d.setMonth(d.getMonth() - cliMonths);
  return d.toISOString().slice(0, 10);
}

/* ---------- Кои са ни клиентите (от продажбите и заявките) ---------- */
function cliCollect() {
  const map = new Map();
  const add = name => {
    const k = cliKey(name); if (!k) return null;
    if (!map.has(k)) map.set(k, { key: k, name: String(name).trim(), turn: 0, sales: 0, orders: 0, last: "" });
    return map.get(k);
  };
  const from = new Date(); from.setMonth(from.getMonth() - 12);
  const fromStr = from.toISOString().slice(0, 10);
  ((typeof erpSales !== "undefined" && erpSales) || []).forEach(s => {
    if (!s.posted) return;
    const r = add(s.clientName); if (!r) return;
    r.sales++;
    const d = String(s.date || "").slice(0, 10);
    if (d > r.last) r.last = d;
    if (d >= fromStr) r.turn += (s.lines || []).reduce((a, l) => a + cliNum(l.qty) * cliNum(l.unitPrice), 0);
  });
  ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(o => {
    const r = add(o.clientName); if (!r) return;
    r.orders++;
    const d = String(o.date || "").slice(0, 10);
    if (d > r.last) r.last = d;
  });
  return [...map.values()];
}
// Активни клиенти без паспорт — те чакат.
function cliMissing() {
  const since = cliSinceStr();
  return cliCollect()
    .filter(r => !since || (r.last && r.last >= since))
    .filter(r => !cliProfile(r.name))
    .sort((a, b) => b.turn - a.turn || a.name.localeCompare(b.name, "bg"));
}
function cliSetBadge(n) {
  const btn = document.querySelector('.erp-tab[data-tab="cliprofiles"]');
  if (!btn) return;
  btn.classList.toggle("erp-tab-alert", n > 0);
  let badge = btn.querySelector(".erp-tab-badge");
  if (n > 0) {
    if (!badge) { badge = document.createElement("span"); badge.className = "erp-tab-badge"; btn.appendChild(badge); }
    badge.textContent = n;
  } else if (badge) { badge.remove(); }
}
async function cliUpdateBadge() {
  try {
    await cliLoad();
    if (typeof erpLoadSales === "function" && (typeof erpSales === "undefined" || !erpSales)) await erpLoadSales();
    cliSetBadge(cliMissing().length);
  } catch (e) {}
}

/* ---------- Каквото системата вече знае за клиента ---------- */
async function cliClaimsFor(name) {
  if (!CLI_CLAIMS) {
    try {
      const { data } = await sb.from("samples").select("id,data").limit(3000);
      CLI_CLAIMS = (data || []).map(r => r.data || {}).filter(s => s.type === "claim");
    } catch (e) { CLI_CLAIMS = []; }
  }
  const k = cliKey(name);
  return CLI_CLAIMS.filter(c => cliKey((c.client && c.client.company) || "") === k)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
function cliPackFor(name) {
  const k = cliKey(name);
  return ((typeof PACKAGING !== "undefined" && PACKAGING) || []).filter(p => cliKey(p.clientName) === k);
}
function cliItemsFor(name, months) {
  const k = cliKey(name);
  const since = new Date(); since.setMonth(since.getMonth() - (months || 12));
  const s0 = since.toISOString().slice(0, 10);
  const by = {};
  ((typeof erpSales !== "undefined" && erpSales) || []).forEach(s => {
    if (!s.posted || cliKey(s.clientName) !== k) return;
    if (String(s.date || "").slice(0, 10) < s0) return;
    (s.lines || []).forEach(l => {
      const code = String(l.code || "").trim() || String(l.name || "").trim();
      if (!code) return;
      const rec = by[code] || (by[code] = { code: l.code || "", name: l.name || "", qty: 0, val: 0 });
      rec.qty += cliNum(l.qty);
      rec.val += cliNum(l.qty) * cliNum(l.unitPrice);
    });
  });
  return Object.values(by).sort((a, b) => b.val - a.val);
}

/* ---------- Списък ---------- */
async function erpRenderClientProfiles() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await cliLoad();
  try { if (typeof erpLoadSales === "function" && (typeof erpSales === "undefined" || !erpSales)) await erpLoadSales(); } catch (e) {}
  try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}

  const everyone = cliCollect();
  const since = cliSinceStr();
  let rows = everyone.filter(r => !since || (r.last && r.last >= since));
  const q = cliQuery.trim().toLowerCase();
  if (q) rows = everyone.filter(r => r.name.toLowerCase().includes(q));   // търсенето рови във всички
  if (cliOnlyEmpty) rows = rows.filter(r => cliFilled(cliProfile(r.name)) < 100);
  const cmp = {
    turnover: (a, b) => b.turn - a.turn || a.name.localeCompare(b.name, "bg"),
    name: (a, b) => a.name.localeCompare(b.name, "bg"),
    filled: (a, b) => cliFilled(cliProfile(a.name)) - cliFilled(cliProfile(b.name)) || b.turn - a.turn,
  }[cliSort] || (() => 0);
  rows.sort(cmp);

  const active = everyone.filter(r => !since || (r.last && r.last >= since));
  const done = active.filter(r => cliFilled(cliProfile(r.name)) === 100).length;
  const missing = cliMissing();
  const totTurn = active.reduce((s, r) => s + r.turn, 0);
  let acc = 0, top80 = 0;
  for (const r of active.slice().sort((a, b) => b.turn - a.turn)) { acc += r.turn; top80++; if (totTurn > 0 && acc >= totTurn * 0.8) break; }

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} клиента · попълнени <b>${done}</b> от ${active.length}</span>
      <input type="search" id="cli-q" placeholder="🔎 клиент (търси във всички)…" value="${escapeAttr(cliQuery)}" style="min-width:190px" autocomplete="off" />
      <label class="erp-inline" title="Показват се клиентите с движение в този период">Период
        <select id="cli-months">
          ${[[3, "последните 3 месеца"], [6, "последните 6 месеца"], [12, "последните 12 месеца"], [0, "всички"]]
            .map(([m, l]) => `<option value="${m}" ${Number(cliMonths) === m ? "selected" : ""}>${l}</option>`).join("")}
        </select></label>
      <label class="erp-inline">Подреди по
        <select id="cli-sort">
          <option value="turnover" ${cliSort === "turnover" ? "selected" : ""}>Оборот 12 м. (голям отгоре)</option>
          <option value="name" ${cliSort === "name" ? "selected" : ""}>Име (А→Я)</option>
          <option value="filled" ${cliSort === "filled" ? "selected" : ""}>Непопълнени първо</option>
        </select></label>
      <label class="erp-inline"><input type="checkbox" id="cli-empty" ${cliOnlyEmpty ? "checked" : ""} /> Само непопълнени</label>
      <span class="spacer"></span>
      <button class="btn btn-small" id="cli-xls" title="Сваля паспортите в Excel">⬇ Excel</button>
    </div>
    ${missing.length ? `<div class="supp-newbar">
      <span>🧭 <b>${missing.length}</b> ${missing.length === 1 ? "клиент чака" : "клиента чакат"} паспорт:
        ${missing.slice(0, 5).map(r => `<b>${escapeHtml(r.name)}</b>`).join(" · ")}${missing.length > 5 ? " …" : ""}</span>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small btn-primary" id="cli-fill-next">✎ Попълни следващия</button>
    </div>` : ""}
    <p class="hint">Всичко специфично за клиента: <b>качество и чести грешки, палети и опаковка, транспорт, рекламации, контакти, уроци</b>. Половината се попълва сама от системата — виж вътре в паспорта.
      ${totTurn > 0 ? `<br>💡 Първите <b>${top80}</b> клиента правят 80% от оборота — от тях започни.` : ""}</p>
    <table class="report-table erp-table">
      <thead><tr>
        <th>Клиент</th><th>Отговорник</th><th>Палет</th><th>Транспорт</th>
        <th>Чести грешки</th><th class="num">Оборот 12 м.</th><th class="num">Уроци</th><th>Готов</th><th></th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const p = cliProfile(r.name) || {};
        const pct = cliFilled(p);
        const mist = String((p.quality && p.quality.mistakes) || "").split("\n").filter(x => x.trim());
        return `<tr class="erp-clickable" data-open="${escapeAttr(r.name)}">
          <td data-label="Клиент"><b>${escapeHtml(r.name)}</b>${r.last ? `<div class="erp-muted" style="font-size:11px">последно движение ${escapeHtml(erpDMY(r.last) || "")}</div>` : ""}</td>
          <td data-label="Отговорник">${escapeHtml(p.owner || "")}</td>
          <td data-label="Палет">${escapeHtml(cliLbl(CLI_PALLET, p.pack && p.pack.type))}</td>
          <td data-label="Транспорт">${escapeHtml(cliLbl(CLI_TRANSPORT, p.transport && p.transport.who))}</td>
          <td data-label="Чести грешки">${mist.length ? `<span class="cli-mist">⚠ ${mist.length}</span> ${escapeHtml(mist[0].slice(0, 60))}${mist[0].length > 60 ? "…" : ""}` : `<span class="erp-muted">—</span>`}</td>
          <td class="num" data-label="Оборот 12 м.">${r.turn ? cliMoney(r.turn) : ""}</td>
          <td class="num" data-label="Уроци">${(p.lessons || []).length || ""}</td>
          <td data-label="Готов"><span class="supp-pct ${pct === 100 ? "ok" : pct >= 50 ? "half" : "no"}">${pct}%</span></td>
          <td class="erp-row-actions"><button class="btn btn-small" data-edit="${escapeAttr(r.name)}">✎ Паспорт</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="9" class="report-empty">Няма клиенти по този филтър.</td></tr>`}
      </tbody>
    </table>`;

  cliSetBadge(missing.length);
  const qEl = document.getElementById("cli-q");
  if (qEl) qEl.addEventListener("input", e => {
    cliQuery = e.target.value; erpRenderClientProfiles();
    const el = document.getElementById("cli-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
  const mEl = document.getElementById("cli-months");
  if (mEl) mEl.addEventListener("change", e => { cliMonths = Number(e.target.value) || 0; erpRenderClientProfiles(); });
  const sEl = document.getElementById("cli-sort");
  if (sEl) sEl.addEventListener("change", e => { cliSort = e.target.value; erpRenderClientProfiles(); });
  const eEl = document.getElementById("cli-empty");
  if (eEl) eEl.addEventListener("change", e => { cliOnlyEmpty = e.target.checked; erpRenderClientProfiles(); });
  const nEl = document.getElementById("cli-fill-next");
  if (nEl) nEl.addEventListener("click", () => { const m = cliMissing()[0]; if (m) cliForm(m.name); });
  const xEl = document.getElementById("cli-xls");
  if (xEl) xEl.addEventListener("click", () => cliExportXls(rows));
  v.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); cliForm(b.dataset.edit); }));
  v.querySelectorAll("tr[data-open]").forEach(tr => tr.addEventListener("click", () => cliForm(tr.dataset.open)));
}
function cliLbl(list, k) { const x = (list || []).find(i => i[0] === k); return x ? x[1] : ""; }

/* ---------- Паспортът (форма) ---------- */
async function cliForm(name) {
  const key = cliKey(name);
  const p = JSON.parse(JSON.stringify(cliProfile(name) || {}));
  p.contacts = p.contacts || CLI_ROLES.map(([role]) => ({ role, name: "", phone: "", email: "", note: "" }));
  p.quality = p.quality || {}; p.pack = p.pack || {}; p.transport = p.transport || {};
  p.claims = p.claims || {}; p.trade = p.trade || {}; p.lessons = p.lessons || [];
  const g = f => escapeAttr(f == null ? "" : f);

  const claims = await cliClaimsFor(name);
  const packs = cliPackFor(name);
  const items = cliItemsFor(name, 12);
  const layout = (typeof PACK_LAYOUTS !== "undefined" && PACK_LAYOUTS && typeof packNorm === "function")
    ? PACK_LAYOUTS[packNorm(name)] : null;

  const { wrap, close } = erpDialog(`
    <h3>🧭 Паспорт на клиента — ${escapeHtml(name)}</h3>

    <div class="cli-auto">
      <b>Каквото системата вече знае</b>
      <div class="cli-auto-grid">
        <div><span class="erp-muted">Изделия (12 м.)</span><br>${items.length
          ? items.slice(0, 6).map(i => `${escapeHtml(i.code || i.name)} — ${erpNum(i.qty)} бр.`).join("<br>") + (items.length > 6 ? `<br><span class="erp-muted">…и още ${items.length - 6}</span>` : "")
          : `<span class="erp-muted">няма продажби</span>`}</div>
        <div><span class="erp-muted">Опаковка (спецификации)</span><br>${packs.length
          ? packs.slice(0, 6).map(x => `${escapeHtml(x.code || "")} — ${x.piecesPerBox ? x.piecesPerBox + " бр./кашон" : ""}${x.boxesPerPallet ? " · " + x.boxesPerPallet + " каш./палет" : ""}`).join("<br>") + (packs.length > 6 ? `<br><span class="erp-muted">…и още ${packs.length - 6}</span>` : "")
          : `<span class="erp-muted">няма попълнени</span>`}
          ${layout ? `<br>📐 <b>има запомнена подредба на палета</b>` : ""}</div>
        <div><span class="erp-muted">Рекламации</span><br>${claims.length
          ? `<b>${claims.length}</b> в регистъра<br>` + claims.slice(0, 3).map(c => `${escapeHtml(erpDMY(c.date) || "")} — ${escapeHtml(String((c.problem && c.problem.what) || c.rootCause || "").slice(0, 60))}`).join("<br>")
          : `<span class="erp-muted">няма</span>`}</div>
        <div><span class="erp-muted">Документи</span><br>${(typeof packIsExport === "function" && packIsExport({ clientName: name })) ? "на <b>английски</b> (износ)" : "на <b>български</b>"}</div>
      </div>
    </div>

    <h4 class="erp-group-head">Доставка и достъп</h4>
    <label>Адрес(и) за доставка<textarea id="cp-addr" rows="2" placeholder="ако са няколко — по един на ред">${escapeHtml(p.addr || "")}</textarea></label>
    <div class="erp-co-grid">
      <label>Работно време за разтоварване <input type="text" id="cp-hours" value="${g(p.hours)}" placeholder="напр. 08:00–15:30, обяд 12–13" /></label>
      <label>Заявка за час (booking)
        <select id="cp-booking">${[["", "— избери —"], ["no", "Не се изисква"], ["yes", "Да — задължително"], ["sometimes", "Понякога"]].map(([k, l]) => `<option value="${k}" ${String(p.booking || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Как приемат поръчки (портал/имейл) <input type="text" id="cp-orderch" value="${g(p.orderChannel)}" /></label>
      <label>Наш номер при тях (доставчик №) <input type="text" id="cp-ourno" value="${g(p.ourNoAtClient)}" /></label>
    </div>

    <h4 class="erp-group-head">Контакти по роли</h4>
    <div class="cli-contacts">
      <div class="cli-crow cli-chead"><span>Роля</span><span>Име</span><span>Телефон</span><span>Имейл</span><span>Как се работи с него</span></div>
      ${CLI_ROLES.map(([role, label], i) => {
        const c = (p.contacts || []).find(x => x && x.role === role) || {};
        return `<div class="cli-crow" data-role="${role}">
          <span class="cli-role">${escapeHtml(label)}</span>
          <input type="text" class="cp-c-name" value="${g(c.name)}" />
          <input type="text" class="cp-c-phone" value="${g(c.phone)}" />
          <input type="text" class="cp-c-email" value="${g(c.email)}" />
          <input type="text" class="cp-c-note" value="${g(c.note)}" placeholder="напр. пише само мейли" />
        </div>`;
      }).join("")}
    </div>

    <h4 class="erp-group-head">Качество</h4>
    <label>⚠ Често допускани грешки (по една на ред — това чете новият човек)<textarea id="cp-mistakes" rows="4" placeholder="напр. бърка се дясна с лява планка&#10;забравя се защитното фолио&#10;етикетът се лепи на грешната страна">${escapeHtml(p.quality.mistakes || "")}</textarea></label>
    <label>Задължителни проверки преди експедиция<textarea id="cp-checks" rows="2">${escapeHtml(p.quality.checks || "")}</textarea></label>
    <div class="erp-co-grid">
      <label>Кои размери мерят и с какво <input type="text" id="cp-measure" value="${g(p.quality.measure)}" /></label>
      <label>Допуски / изисквания <input type="text" id="cp-tol" value="${g(p.quality.tolerance)}" /></label>
      <label>Боя (RAL, дебелина, тест) <input type="text" id="cp-paint" value="${g(p.quality.paint)}" /></label>
      <label>Сертификати / декларации <input type="text" id="cp-cert" value="${g(p.quality.certs)}" /></label>
      <label>Мостра-еталон при нас <input type="text" id="cp-sample" value="${g(p.quality.sample)}" placeholder="има ли, къде стои" /></label>
      <label>Маркировка на детайла <input type="text" id="cp-mark" value="${g(p.quality.marking)}" /></label>
    </div>

    <h4 class="erp-group-head">Опаковка и палети</h4>
    <div class="erp-co-grid">
      <label>Тип палет
        <select id="cp-pallet"><option value="">— избери —</option>${CLI_PALLET.map(([k, l]) => `<option value="${k}" ${p.pack.type === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
      <label>Макс. височина (см) <input type="text" id="cp-maxh" value="${g(p.pack.maxHeight)}" /></label>
      <label>Макс. тегло на палет (кг) <input type="text" id="cp-maxw" value="${g(p.pack.maxWeight)}" /></label>
      <label>Смесени палети
        <select id="cp-mixed">${[["", "— избери —"], ["yes", "Позволени"], ["no", "НЕ се приемат"], ["marked", "Само ако са ясно маркирани"]].map(([k, l]) => `<option value="${k}" ${String(p.pack.mixed || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Стреч / капак / ъгли <input type="text" id="cp-wrap" value="${g(p.pack.wrap)}" /></label>
      <label>Етикет — какъв и къде <input type="text" id="cp-label" value="${g(p.pack.label)}" placeholder="напр. А5, горе вляво, на английски, с баркод" /></label>
    </div>
    <label>Специфики при опаковането<textarea id="cp-packnote" rows="2" placeholder="напр. ушите отделно в найлон; картон между редовете">${escapeHtml(p.pack.note || "")}</textarea></label>

    <h4 class="erp-group-head">Транспорт</h4>
    <div class="erp-co-grid">
      <label>Кой организира
        <select id="cp-tr-who"><option value="">— избери —</option>${CLI_TRANSPORT.map(([k, l]) => `<option value="${k}" ${p.transport.who === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
      <label>Обичаен превозвач <input type="text" id="cp-tr-carrier" value="${g(p.transport.carrier)}" /></label>
      <label>Заявка колко предварително <input type="text" id="cp-tr-lead" value="${g(p.transport.lead)}" placeholder="напр. 2 дни" /></label>
      <label>Документи с товара <input type="text" id="cp-tr-docs" value="${g(p.transport.docs)}" placeholder="ЧМР, опаковъчен лист, стокова" /></label>
      <label>Митница / износ <input type="text" id="cp-tr-customs" value="${g(p.transport.customs)}" /></label>
      <label>Колко чака шофьорът <input type="text" id="cp-tr-wait" value="${g(p.transport.wait)}" /></label>
    </div>

    <h4 class="erp-group-head">Рекламации</h4>
    <label>Типични причини<textarea id="cp-cl-typical" rows="2">${escapeHtml(p.claims.typical || "")}</textarea></label>
    <div class="erp-co-grid">
      <label>Как се процедира <input type="text" id="cp-cl-proc" value="${g(p.claims.procedure)}" placeholder="връщане / кредитно / подмяна" /></label>
      <label>Срок за отговор <input type="text" id="cp-cl-deadline" value="${g(p.claims.deadline)}" /></label>
    </div>

    <h4 class="erp-group-head">Търговски условия</h4>
    <div class="erp-co-grid">
      <label>Валута <input type="text" id="cp-tr2-cur" value="${g(p.trade.currency)}" /></label>
      <label>Срок на плащане <input type="text" id="cp-tr2-term" value="${g(p.trade.term)}" /></label>
      <label>Минимални количества <input type="text" id="cp-tr2-moq" value="${g(p.trade.moq)}" /></label>
      <label>Договор / рамка <input type="text" id="cp-tr2-contract" value="${g(p.trade.contract)}" /></label>
    </div>

    <h4 class="erp-group-head">Отговорност</h4>
    <div class="erp-co-grid">
      <label>Отговорник при нас <input type="text" id="cp-owner" value="${g(p.owner)}" /></label>
      <label>Заместник <input type="text" id="cp-deputy" value="${g(p.deputy)}" /></label>
    </div>

    <h4 class="erp-group-head">📚 Научени уроци (хронология)</h4>
    <div id="cp-lessons" class="cli-lessons">${(p.lessons || []).map((l, i) => cliLessonRow(l, i)).join("") || `<p class="hint" style="margin:0">Още няма записани уроци. Всеки проблем, който сме преживели с този клиент, се пише тук — с дата, причина и какво правим оттук нататък.</p>`}</div>
    <button type="button" class="btn btn-small" id="cp-add-lesson">+ Урок</button>

    ${p.updatedAt ? `<p class="erp-muted" style="font-size:12px;margin-top:8px">Последна промяна: ${escapeHtml(erpDMY(String(p.updatedAt).slice(0, 10)) || "")}${p.updatedBy ? " · " + escapeHtml(p.updatedBy) : ""}</p>` : ""}
    <div class="erp-dialog-actions">
      ${cliProfile(name) ? '<button class="btn" id="cp-print">🖨 Печат (А4)</button>' : ""}
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="cp-cancel">Отказ</button>
      <button class="btn btn-primary" id="cp-save">💾 Запази</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#cp-cancel").addEventListener("click", close);
  const lessonsBox = wrap.querySelector("#cp-lessons");
  wrap.querySelector("#cp-add-lesson").addEventListener("click", () => {
    const hint = lessonsBox.querySelector(".hint"); if (hint) hint.remove();
    const tmp = document.createElement("div");
    tmp.innerHTML = cliLessonRow({ date: new Date().toISOString().slice(0, 10), what: "", why: "", action: "" }, lessonsBox.children.length);
    lessonsBox.appendChild(tmp.firstElementChild);
    cliWireLessons(lessonsBox);
  });
  cliWireLessons(lessonsBox);

  const collect = () => {
    const val = id => { const el = wrap.querySelector("#" + id); return el ? el.value.trim() : ""; };
    const contacts = [...wrap.querySelectorAll(".cli-crow[data-role]")].map(r => ({
      role: r.dataset.role,
      name: r.querySelector(".cp-c-name").value.trim(),
      phone: r.querySelector(".cp-c-phone").value.trim(),
      email: r.querySelector(".cp-c-email").value.trim(),
      note: r.querySelector(".cp-c-note").value.trim(),
    }));
    const lessons = [...lessonsBox.querySelectorAll(".cli-lrow")].map(r => ({
      date: r.querySelector(".cp-l-date").value,
      what: r.querySelector(".cp-l-what").value.trim(),
      why: r.querySelector(".cp-l-why").value.trim(),
      action: r.querySelector(".cp-l-action").value.trim(),
    })).filter(l => l.what || l.why || l.action);
    return {
      name: String(name).trim(),
      addr: val("cp-addr"), hours: val("cp-hours"), booking: val("cp-booking"),
      orderChannel: val("cp-orderch"), ourNoAtClient: val("cp-ourno"),
      contacts,
      quality: {
        mistakes: val("cp-mistakes"), checks: val("cp-checks"), measure: val("cp-measure"),
        tolerance: val("cp-tol"), paint: val("cp-paint"), certs: val("cp-cert"),
        sample: val("cp-sample"), marking: val("cp-mark"),
      },
      pack: {
        type: val("cp-pallet"), maxHeight: val("cp-maxh"), maxWeight: val("cp-maxw"),
        mixed: val("cp-mixed"), wrap: val("cp-wrap"), label: val("cp-label"), note: val("cp-packnote"),
      },
      transport: {
        who: val("cp-tr-who"), carrier: val("cp-tr-carrier"), lead: val("cp-tr-lead"),
        docs: val("cp-tr-docs"), customs: val("cp-tr-customs"), wait: val("cp-tr-wait"),
      },
      claims: { typical: val("cp-cl-typical"), procedure: val("cp-cl-proc"), deadline: val("cp-cl-deadline") },
      trade: { currency: val("cp-tr2-cur"), term: val("cp-tr2-term"), moq: val("cp-tr2-moq"), contract: val("cp-tr2-contract") },
      owner: val("cp-owner"), deputy: val("cp-deputy"),
      lessons,
      updatedAt: new Date().toISOString(),
      updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "",
    };
  };
  const pr = wrap.querySelector("#cp-print");
  if (pr) pr.addEventListener("click", () => cliPrint(name, collect(), { claims, packs, items }));
  wrap.querySelector("#cp-save").addEventListener("click", async () => {
    CLI_PROFILES.byKey = CLI_PROFILES.byKey || {};
    CLI_PROFILES.byKey[key] = collect();
    if (await cliSave()) { close(); cliUpdateBadge(); erpRenderClientProfiles(); }
  });
}
function cliLessonRow(l, i) {
  return `<div class="cli-lrow">
    <input type="date" class="cp-l-date" value="${escapeAttr(l.date || "")}" />
    <input type="text" class="cp-l-what" value="${escapeAttr(l.what || "")}" placeholder="какво стана" />
    <input type="text" class="cp-l-why" value="${escapeAttr(l.why || "")}" placeholder="защо" />
    <input type="text" class="cp-l-action" value="${escapeAttr(l.action || "")}" placeholder="какво правим оттук нататък" />
    <button type="button" class="btn btn-small cp-l-rm" title="Махни">×</button>
  </div>`;
}
function cliWireLessons(box) {
  box.querySelectorAll(".cp-l-rm").forEach(b => { if (b._w) return; b._w = true; b.addEventListener("click", () => b.closest(".cli-lrow").remove()); });
}

/* ---------- 🖨 Печат на един лист ---------- */
function cliPrint(name, p, auto) {
  const row = (k, v) => v ? `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(v).replace(/\n/g, "<br>")}</td></tr>` : "";
  const contacts = (p.contacts || []).filter(c => c.name || c.phone || c.email)
    .map(c => `<tr><td class="k">${escapeHtml(cliLbl(CLI_ROLES, c.role))}</td><td>${escapeHtml([c.name, c.phone, c.email, c.note].filter(Boolean).join(" · "))}</td></tr>`).join("");
  const lessons = (p.lessons || []).map(l => `<tr><td class="k">${escapeHtml(erpDMY(l.date) || "")}</td><td><b>${escapeHtml(l.what)}</b>${l.why ? " — " + escapeHtml(l.why) : ""}${l.action ? `<br>➜ ${escapeHtml(l.action)}` : ""}</td></tr>`).join("");
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Паспорт — ${escapeHtml(name)}</title>
    <style>body{font-family:Arial,sans-serif;margin:14px 18px;color:#111}
    h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;font-weight:400;color:#555;margin:0 0 10px}
    h3{font-size:13px;margin:12px 0 4px;background:#eef2ff;padding:4px 8px;border-radius:6px}
    table{width:100%;border-collapse:collapse;margin-bottom:4px}
    td{border:1px solid #cbd5e1;padding:4px 7px;font-size:12px;vertical-align:top}
    td.k{width:30%;background:#f8fafc;font-weight:bold}
    .warn td{background:#fff7ed}
    @page{size:A4 portrait;margin:10mm}@media print{.noprint{display:none}}</style></head><body>
    <div class="noprint" style="text-align:center;margin-bottom:8px"><button onclick="window.print()" style="padding:8px 18px;font-size:14px">🖨 Печат</button></div>
    <h1>🧭 Паспорт на клиента — ${escapeHtml(name)}</h1>
    <h2>Отговорник: ${escapeHtml(p.owner || "—")}${p.deputy ? " · заместник: " + escapeHtml(p.deputy) : ""} · разпечатано ${erpDMY(new Date().toISOString().slice(0, 10))}</h2>
    ${p.quality && p.quality.mistakes ? `<h3>⚠ Често допускани грешки</h3><table class="warn"><tr><td>${escapeHtml(p.quality.mistakes).replace(/\n/g, "<br>")}</td></tr></table>` : ""}
    <h3>Качество</h3><table>
      ${row("Задължителни проверки", p.quality.checks)}${row("Мерят", p.quality.measure)}${row("Допуски", p.quality.tolerance)}
      ${row("Боя", p.quality.paint)}${row("Сертификати", p.quality.certs)}${row("Маркировка", p.quality.marking)}${row("Мостра-еталон", p.quality.sample)}</table>
    <h3>Опаковка и палети</h3><table>
      ${row("Тип палет", cliLbl(CLI_PALLET, p.pack.type))}${row("Макс. височина", p.pack.maxHeight)}${row("Макс. тегло", p.pack.maxWeight)}
      ${row("Смесени палети", p.pack.mixed === "no" ? "НЕ се приемат" : (p.pack.mixed === "yes" ? "позволени" : (p.pack.mixed === "marked" ? "само маркирани" : "")))}
      ${row("Стреч/капак/ъгли", p.pack.wrap)}${row("Етикет", p.pack.label)}${row("Специфики", p.pack.note)}</table>
    <h3>Транспорт и доставка</h3><table>
      ${row("Организира", cliLbl(CLI_TRANSPORT, p.transport.who))}${row("Превозвач", p.transport.carrier)}${row("Заявка", p.transport.lead)}
      ${row("Документи", p.transport.docs)}${row("Митница", p.transport.customs)}${row("Чакане", p.transport.wait)}
      ${row("Адрес(и)", p.addr)}${row("Работно време", p.hours)}${row("Booking", p.booking === "yes" ? "задължителен" : (p.booking === "sometimes" ? "понякога" : (p.booking === "no" ? "не се изисква" : "")))}</table>
    ${contacts ? `<h3>Контакти</h3><table>${contacts}</table>` : ""}
    ${(p.claims.typical || p.claims.procedure) ? `<h3>Рекламации</h3><table>${row("Типични причини", p.claims.typical)}${row("Процедура", p.claims.procedure)}${row("Срок за отговор", p.claims.deadline)}${auto && auto.claims && auto.claims.length ? row("В регистъра", auto.claims.length + " рекламации") : ""}</table>` : ""}
    ${lessons ? `<h3>📚 Научени уроци</h3><table>${lessons}</table>` : ""}
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

/* ---------- ⬇ Excel ---------- */
function cliExportXls(rows) {
  if (typeof reportExportXls !== "function") { alert("Модулът за експорт не е зареден."); return; }
  const list = (rows && rows.length ? rows : cliCollect());
  const headers = [
    { label: "Клиент" }, { label: "Отговорник" }, { label: "Заместник" },
    { label: "Чести грешки" }, { label: "Задължителни проверки" }, { label: "Мерят" }, { label: "Допуски" }, { label: "Боя" }, { label: "Сертификати" },
    { label: "Тип палет" }, { label: "Макс. височина" }, { label: "Макс. тегло" }, { label: "Смесени палети" }, { label: "Етикет" }, { label: "Специфики опаковка" },
    { label: "Транспорт" }, { label: "Превозвач" }, { label: "Заявка" }, { label: "Документи" }, { label: "Митница" },
    { label: "Рекламации — типични" }, { label: "Процедура" },
    { label: "Адрес" }, { label: "Работно време" }, { label: "Booking" }, { label: "Контакти" },
    { label: "Уроци", num: true }, { label: "Оборот 12 м.", num: true }, { label: "Готовност %", num: true },
  ];
  const body = list.map(r => {
    const p = cliProfile(r.name) || {};
    const q = p.quality || {}, pk = p.pack || {}, tr = p.transport || {}, cl = p.claims || {};
    return [
      r.name, p.owner || "", p.deputy || "",
      q.mistakes || "", q.checks || "", q.measure || "", q.tolerance || "", q.paint || "", q.certs || "",
      cliLbl(CLI_PALLET, pk.type), pk.maxHeight || "", pk.maxWeight || "",
      pk.mixed === "no" ? "не се приемат" : (pk.mixed === "yes" ? "позволени" : (pk.mixed === "marked" ? "само маркирани" : "")),
      pk.label || "", pk.note || "",
      cliLbl(CLI_TRANSPORT, tr.who), tr.carrier || "", tr.lead || "", tr.docs || "", tr.customs || "",
      cl.typical || "", cl.procedure || "",
      p.addr || "", p.hours || "", p.booking === "yes" ? "да" : (p.booking === "no" ? "не" : (p.booking === "sometimes" ? "понякога" : "")),
      (p.contacts || []).filter(c => c.name || c.phone).map(c => `${cliLbl(CLI_ROLES, c.role)}: ${[c.name, c.phone].filter(Boolean).join(" ")}`).join("; "),
      (p.lessons || []).length || "", r.turn ? Math.round(r.turn) : "", cliFilled(p),
    ];
  });
  const today = new Date().toISOString().slice(0, 10);
  reportExportXls(`klienti-pasporti-${today}`, `Паспорти на клиенти · ${erpDMY(today) || today}`, [{ headers, rows: body }]);
}

/* ---------- ℹ Кратък изглед (за заявката и плана) ---------- */
async function cliQuickView(name) {
  await cliLoad();
  const p = cliProfile(name);
  if (!p) {
    if (confirm(`За „${name}" още няма паспорт.\n\nДа го отворя ли, за да го попълниш?`)) cliForm(name);
    return;
  }
  const q = p.quality || {}, pk = p.pack || {}, tr = p.transport || {};
  const mist = String(q.mistakes || "").split("\n").filter(x => x.trim());
  const { wrap, close } = erpDialog(`
    <h3>🧭 ${escapeHtml(name)} — специфики</h3>
    ${mist.length ? `<div class="cli-warnbox"><b>⚠ Внимавай за:</b><ul>${mist.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>` : ""}
    <table class="report-table erp-table">
      ${q.checks ? `<tr><td><b>Проверки преди експедиция</b></td><td>${escapeHtml(q.checks)}</td></tr>` : ""}
      ${pk.type ? `<tr><td><b>Палет</b></td><td>${escapeHtml(cliLbl(CLI_PALLET, pk.type))}${pk.maxHeight ? " · макс. " + escapeHtml(pk.maxHeight) + " см" : ""}${pk.mixed === "no" ? " · <b>без смесени палети</b>" : ""}</td></tr>` : ""}
      ${pk.label ? `<tr><td><b>Етикет</b></td><td>${escapeHtml(pk.label)}</td></tr>` : ""}
      ${pk.note ? `<tr><td><b>Опаковка</b></td><td>${escapeHtml(pk.note)}</td></tr>` : ""}
      ${tr.who ? `<tr><td><b>Транспорт</b></td><td>${escapeHtml(cliLbl(CLI_TRANSPORT, tr.who))}${tr.carrier ? " · " + escapeHtml(tr.carrier) : ""}${tr.lead ? " · заявка " + escapeHtml(tr.lead) : ""}</td></tr>` : ""}
      ${p.owner ? `<tr><td><b>Отговорник</b></td><td>${escapeHtml(p.owner)}</td></tr>` : ""}
    </table>
    <div class="erp-dialog-actions"><button class="btn" id="cq-open">✎ Целият паспорт</button><span class="spacer" style="flex:1"></span><button class="btn btn-primary" id="cq-close">Затвори</button></div>`);
  wrap.querySelector("#cq-close").addEventListener("click", close);
  wrap.querySelector("#cq-open").addEventListener("click", () => { close(); cliForm(name); });
}
