/* Данко Системс — ЕРП „🏷 Паспорти на доставчици".
   Картон на всеки доставчик за СЧЕТОВОДСТВОТО: какво купуваме от него, къде и
   за какво се ползва, данъчен режим, счетоводна сметка, условия на плащане.
   Списъкът с доставчици се събира от РЕАЛНИТЕ покупки (кой ни е фактурирал) +
   директорията partners. Подредбата е по оборот за последните 12 месеца, за да
   се попълват първо тежките — първите 30 обикновено са 90% от парите.
   Пази се в app_config id="supplier_profiles": { byKey: { "<ключ>": {...} } }.
   Ключът е нормализираното име (без регистър/интервали) — същото, по което се
   пише доставчикът във фактурите.
   Ползва ERP/erpView/erpDialog/erpDMY/erpToNum/escapeHtml/sb + reportExportXls. */

let SUPP_PROFILES = null;      // { byKey: {...} }
let suppQuery = "";
let suppOnlyEmpty = false;
let suppSort = "type";         // type | turnover | name | filled
let suppMonths = 6;            // период: показваме доставчици с покупки в последните N месеца (0 = всички)

function suppKey(name) { return String(name || "").trim().replace(/\s+/g, " ").toLowerCase(); }
function suppNum(v) { return (typeof erpToNum === "function") ? (erpToNum(v) || 0) : (Number(v) || 0); }
function suppMoney(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " EUR"; }

/* ---------- Речници (падащите менюта) ---------- */
const SUPP_REGIMES = [
  ["local_vat", "Местен, регистриран по ДДС"],
  ["local_novat", "Местен, БЕЗ регистрация по ДДС"],
  ["eu_goods", "ВОП — стоки от ЕС (протокол по чл. 117)"],
  ["eu_service", "Услуга от ЕС (чл. 21, ал. 2 — протокол)"],
  ["import", "Внос от трета страна (митница)"],
  ["reverse_163a", "Обратно начисляване по чл. 163а (скрап/отпадъци)"],
  ["other", "Друго (виж бележката)"],
];
const SUPP_CREDIT = [
  ["full", "Пълен данъчен кредит"],
  ["partial", "Частичен данъчен кредит"],
  ["none", "БЕЗ данъчен кредит"],
  ["na", "Неприложимо (без ДДС)"],
];
const SUPP_KIND = [
  ["expense", "Текущ разход за периода"],
  ["stock", "Материали/стоки на склад"],
  ["asset", "ДМА (завежда се и се амортизира)"],
  ["prepaid", "Разсрочен разход (застраховка, абонамент)"],
  ["mixed", "Смесено — по редове"],
];
const SUPP_WHERE = [
  "Производство — цехове", "Поддръжка и ремонт", "Инструменти и консумативи",
  "Транспорт и логистика", "Автомобили и гориво", "Администрация и офис",
  "ИТ и софтуер", "Ток, вода, комуникации", "Наеми", "Персонал (СБКО, храна, ЛПС)",
  "Инвестиции (машини, сгради)", "Услуги на подизпълнител",
];
const SUPP_DOCFLOW = [
  ["invoice", "Фактура за всяка доставка"],
  ["goods_month", "Стокови разписки + месечна обобщена фактура"],
  ["subscription", "Абонамент/периодична фактура"],
  ["proforma", "Проформа и плащане предварително"],
];
function suppLabel(list, k) { const x = (list || []).find(i => i[0] === k); return x ? x[1] : (k || ""); }

/* ---------- Данни ---------- */
async function suppLoad() {
  if (SUPP_PROFILES) return SUPP_PROFILES;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "supplier_profiles").maybeSingle();
    SUPP_PROFILES = { byKey: (data && data.data && data.data.byKey) || {} };
  } catch (e) { SUPP_PROFILES = { byKey: {} }; }
  return SUPP_PROFILES;
}
async function suppSave() {
  const { error } = await sb.from("app_config")
    .upsert({ id: "supplier_profiles", data: { byKey: (SUPP_PROFILES || {}).byKey || {} }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function suppProfile(name) { return ((SUPP_PROFILES || {}).byKey || {})[suppKey(name)] || null; }
// Попълнен ли е профилът достатъчно, за да е полезен на счетоводството.
function suppFilled(p) {
  if (!p) return 0;
  const must = [p.eik, p.regime, p.credit, p.kind, p.account, p.whatWeBuy, (p.where || []).length ? "1" : ""];
  const have = must.filter(x => String(x || "").trim()).length;
  return Math.round(have / must.length * 100);
}

// Началото на периода („от коя дата смятаме доставчика за активен").
function suppSinceStr() {
  if (!suppMonths) return "";
  const d = new Date(); d.setMonth(d.getMonth() - suppMonths);
  return d.toISOString().slice(0, 10);
}
// Активни доставчици БЕЗ паспорт — те чакат Кристина.
function suppMissing() {
  const since = suppSinceStr();
  return suppCollect()
    .filter(r => r.docs > 0 && (!since || (r.last && r.last >= since)))
    .filter(r => !suppProfile(r.name))
    .sort((a, b) => b.turn12 - a.turn12 || a.name.localeCompare(b.name, "bg"));
}
/* Има ли паспорт този доставчик — ползва се и от Покупки (подсеща при нова
   фактура от непознат доставчик). */
async function suppEnsureLoaded() { await suppLoad(); }
function suppHasProfile(name) { return !!suppProfile(name); }

/* ---------- Индикатор на таба (като непрочетено съобщение) ----------
   Показва колко активни доставчика чакат паспорт. Свети, докато не се
   попълнят — така напомнянето не се губи между другите задачи. */
function suppSetBadge(n) {
  const btn = document.querySelector('.erp-tab[data-tab="supprofiles"]');
  if (!btn) return;
  btn.classList.toggle("erp-tab-alert", n > 0);
  let badge = btn.querySelector(".erp-tab-badge");
  if (n > 0) {
    if (!badge) { badge = document.createElement("span"); badge.className = "erp-tab-badge"; btn.appendChild(badge); }
    badge.textContent = n;
  } else if (badge) { badge.remove(); }
}
async function suppUpdateBadge() {
  try {
    await suppLoad();
    if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases();
    suppSetBadge(suppMissing().length);
  } catch (e) { /* тихо — индикаторът не е критичен */ }
}

/* ---------- Кои са ни доставчиците (от покупките + директорията) ---------- */
function suppCollect() {
  const map = new Map();
  const add = (name, extra) => {
    const k = suppKey(name); if (!k) return null;
    if (!map.has(k)) map.set(k, { key: k, name: String(name).trim(), turn12: 0, docs: 0, last: "", partner: null });
    const rec = map.get(k);
    if (extra) Object.assign(rec, extra);
    return rec;
  };
  const from = new Date(); from.setMonth(from.getMonth() - 12);
  const fromStr = from.toISOString().slice(0, 10);
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    const rec = add(o.supplierName); if (!rec) return;
    rec.docs++;
    if (String(o.date || "") > rec.last) rec.last = o.date || "";
    if (String(o.date || "") >= fromStr && o.docType !== "goods") {
      const t = (typeof erpPuTotals === "function") ? erpPuTotals(o) : { total: 0 };
      const eur = ((typeof erpPuCur === "function" ? erpPuCur(o) : "EUR") === "BGN") ? (t.total / 1.95583) : t.total;
      rec.turn12 += Number(eur) || 0;
    }
  });
  ((typeof erpPartners !== "undefined" && erpPartners) || []).forEach(p => {
    if (p.kind !== "supplier") return;
    const rec = add(p.name); if (rec) rec.partner = p;
  });
  return [...map.values()];
}

/* ---------- 🧾 Какво е купувано от всеки доставчик (АВТОМАТИЧНО от Покупки) ----------
   Агрегира редовете на всички покупни документи по доставчик: артикул, код,
   група, колко пъти, кога за последно и на каква цена. Това е „паметта" на
   паспорта — не се пише на ръка и винаги е актуална. */
let SUPP_BOUGHT = null, SUPP_BOUGHT_SRC = null;
function suppBought() {
  const src = (typeof erpPurchases !== "undefined" && erpPurchases) || [];
  if (SUPP_BOUGHT && SUPP_BOUGHT_SRC === src) return SUPP_BOUGHT;
  const bySupp = new Map();
  src.forEach(o => {
    const sk = suppKey(o.supplierName); if (!sk) return;
    if (!bySupp.has(sk)) bySupp.set(sk, new Map());
    const arts = bySupp.get(sk);
    (o.lines || []).forEach(l => {
      const nm = String(l.article || l.name || "").trim(); if (!nm) return;
      const ak = nm.toLowerCase();
      const it = arts.get(ak) || { article: nm, code: "", group: l.groupName || "", unit: l.unit || "", n: 0, last: "", lastPrice: 0, cur: "", isMat: false };
      it.n++;
      if (l.materialId) it.isMat = true;
      if (String(o.date || "") >= String(it.last || "")) {
        it.last = o.date || "";
        const pr = suppNum(l.unitPrice);
        if (pr) { it.lastPrice = pr; it.cur = (typeof erpPuCur === "function") ? erpPuCur(o) : ""; }
        if (l.code) it.code = l.code;
        if (l.groupName) it.group = l.groupName;
      }
      arts.set(ak, it);
    });
  });
  const out = new Map();
  bySupp.forEach((arts, sk) => out.set(sk, [...arts.values()].sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)))));
  SUPP_BOUGHT = out; SUPP_BOUGHT_SRC = src;
  return out;
}
function suppBoughtFor(name) { return suppBought().get(suppKey(name)) || []; }

/* Тип доставчик: 🧱 Материали за производство или 🛠 Услуги/други.
   Ръчният избор в паспорта (supType) е с предимство; иначе — авто:
   купувал ли ни е складови материали или материално звучащи артикули. */
const SUPP_MAT_RE = /ламарин|тръб|профил|болт|винт|гайк|шайб|нит|крепеж|бо[яи]|прах|кашон|опаков|стомана|метал|лист|шина|пръчк|електрод|тел |тел$|газ|материал|консуматив|стреч|фолио|палет|лепило|грунд|разредител|диск|абразив/i;
function suppType(name) {
  const p = suppProfile(name) || {};
  if (p.supType === "materials" || p.supType === "services") return p.supType;
  const items = suppBoughtFor(name);
  if (items.some(i => i.isMat)) return "materials";
  if (items.some(i => SUPP_MAT_RE.test(i.article + " " + i.group))) return "materials";
  if (p.kind === "stock") return "materials";
  return "services";
}

/* Нормализация за търсенето по артикули (ползва puMatNorm от Покупки, ако е
   зареден — думи, х/x, без словоред). */
function suppNorm(s) {
  if (typeof puMatNorm === "function") return puMatNorm(String(s || ""));
  return String(s || "").toLowerCase().replace(/х/g, "x").replace(/\s+/g, " ").trim();
}

/* ---------- Списък ---------- */
async function erpRenderSupplierProfiles() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await suppLoad();
  try { if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases(); } catch (e) {}
  try { if (typeof erpLoadPartners === "function" && (typeof erpPartners === "undefined" || !erpPartners)) await erpLoadPartners(); } catch (e) {}

  const everyone = suppCollect();
  // Само АКТИВНИТЕ: тези с покупка в последните N месеца. Старите (от години
  // назад) не се показват, за да не тежат — виждат се с „всички".
  const since = suppSinceStr();
  let rows = everyone.filter(r => !since || (r.last && r.last >= since));
  // Търсенето рови във ВСИЧКИ доставчици и във ВСИЧКО: име, паспорт (какво
  // купуваме, бележки, къде) и КУПУВАНИТЕ АРТИКУЛИ от Покупки — по думи,
  // без словоред. „винтове" → Крепежи България; „боя 9005" → Гиргинови.
  const words = suppNorm(suppQuery).split(" ").filter(Boolean);
  const matchedArts = new Map();   // key → съвпадналите артикули (за показване)
  if (words.length) {
    rows = everyone.filter(r => {
      const p = suppProfile(r.name) || {};
      const items = suppBoughtFor(r.name);
      const hay = suppNorm([r.name, p.eik, p.vat, p.whatWeBuy, p.usedFor, p.notes, p.taxnote,
        (p.where || []).join(" "), items.map(i => i.article + " " + i.code + " " + i.group).join(" ")].join(" "));
      if (!words.every(w => hay.includes(w))) return false;
      const hits = items.filter(i => { const h = suppNorm(i.article + " " + i.code + " " + i.group); return words.some(w => h.includes(w)); });
      if (hits.length) matchedArts.set(r.key, hits.slice(0, 4));
      return true;
    });
  }
  if (suppOnlyEmpty) rows = rows.filter(r => suppFilled(suppProfile(r.name)) < 100);
  const cmp = {
    // Тип: първо 🧱 Материали за производство, после 🛠 Услуги; вътре по оборот.
    type: (a, b) => (suppType(a.name) === suppType(b.name) ? 0 : suppType(a.name) === "materials" ? -1 : 1) || b.turn12 - a.turn12 || a.name.localeCompare(b.name, "bg"),
    turnover: (a, b) => b.turn12 - a.turn12 || a.name.localeCompare(b.name, "bg"),
    name: (a, b) => a.name.localeCompare(b.name, "bg"),
    filled: (a, b) => suppFilled(suppProfile(a.name)) - suppFilled(suppProfile(b.name)) || b.turn12 - a.turn12,
  }[suppSort] || (() => 0);
  rows.sort(cmp);

  // Статистиките са за АКТИВНИТЕ (в периода), не за целия архив.
  const active = everyone.filter(r => !since || (r.last && r.last >= since));
  const done = active.filter(r => suppFilled(suppProfile(r.name)) === 100).length;
  const totTurn = active.reduce((s, r) => s + r.turn12, 0);
  // Колко доставчика правят 90% от оборота — те са приоритетът.
  const sorted = active.slice().sort((a, b) => b.turn12 - a.turn12);
  let acc = 0, top90 = 0;
  for (const r of sorted) { acc += r.turn12; top90++; if (totTurn > 0 && acc >= totTurn * 0.9) break; }
  const missing = suppMissing();

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} доставчика · попълнени <b>${done}</b> от ${active.length}</span>
      <input type="search" id="supp-q" placeholder="🔎 материал / артикул… (винт м6, боя 9005)" value="${escapeAttr(suppQuery)}" style="width:260px;flex:0 0 auto" autocomplete="off" title="Търси по думи навсякъде: имена, паспорти И купуваните артикули от Покупки — показва откъде сме купували търсеното" />
      <input type="text" id="supp-pick" list="supp-names" placeholder="📇 избери доставчик…" style="width:220px;flex:0 0 auto" autocomplete="off" title="Падащ списък с всички доставчици — изборът отваря паспорта" />
      <datalist id="supp-names">${everyone.slice().sort((a, b) => a.name.localeCompare(b.name, "bg")).map(r => `<option value="${escapeAttr(r.name)}"></option>`).join("")}</datalist>
      <label class="erp-inline" title="Показват се доставчиците с покупка в този период">Период
        <select id="supp-months">
          ${[[3, "последните 3 месеца"], [6, "последните 6 месеца"], [12, "последните 12 месеца"], [24, "последните 2 години"], [0, "всички (архив)"]]
            .map(([m, l]) => `<option value="${m}" ${Number(suppMonths) === m ? "selected" : ""}>${l}</option>`).join("")}
        </select></label>
      <label class="erp-inline">Подреди по
        <select id="supp-sort">
          <option value="type" ${suppSort === "type" ? "selected" : ""}>Тип: Материали → Услуги</option>
          <option value="turnover" ${suppSort === "turnover" ? "selected" : ""}>Оборот 12 м. (голям отгоре)</option>
          <option value="name" ${suppSort === "name" ? "selected" : ""}>Име (А→Я)</option>
          <option value="filled" ${suppSort === "filled" ? "selected" : ""}>Непопълнени първо</option>
        </select></label>
      <label class="erp-inline" title="Показва само тези, чийто паспорт не е завършен"><input type="checkbox" id="supp-empty" ${suppOnlyEmpty ? "checked" : ""} /> Само непопълнени</label>
      <span class="spacer"></span>
      <button class="btn btn-small" id="supp-xls" title="Сваля паспортите за счетоводството">⬇ Excel</button>
    </div>
    <!-- Банерът „Попълни следващия" е махнат (24.09, Данко): „какво купуваме"
         вече се пълни само от Покупки; данъчните полета се попълват в движение. -->
    <p class="hint">Картон на всеки доставчик за счетоводството: <b>какво купуваме, къде се ползва, данъчен режим, сметка, условия</b>. Оборотът е по въведените фактури за последните 12 месеца (без стоковите разписки — техните пари идват с покриващата фактура).
      ${totTurn > 0 ? `<br>💡 Първите <b>${top90}</b> доставчика правят 90% от оборота — започни от тях, останалите се попълват в движение.` : ""}</p>
    <table class="report-table erp-table">
      <thead><tr>
        <th class="supp-colname">Доставчик</th><th>ЕИК</th><th>Сметка</th>
        <th class="supp-colwhat">Какво купуваме</th><th>Къде се ползва</th>
        <th class="num">Оборот 12 м.</th><th class="num">Док.</th><th>Готов</th><th></th>
      </tr></thead>
      <tbody>${(() => {
        let lastType = null;
        return rows.map(r => {
        const p = suppProfile(r.name) || {};
        const pct = suppFilled(p);
        const t = suppType(r.name);
        // Заглавен ред при групиране по тип
        let head = "";
        if (suppSort === "type" && t !== lastType) {
          lastType = t;
          const cnt = rows.filter(x => suppType(x.name) === t).length;
          head = `<tr class="supp-typehead"><td colspan="9">${t === "materials" ? "🧱 Материали за производство" : "🛠 Услуги и други"} — ${cnt} доставчика</td></tr>`;
        }
        const bought = suppBoughtFor(r.name);
        const hits = matchedArts.get(r.key);
        const autoLine = hits
          ? `<div class="supp-hit">🎯 ${hits.map(i => `<b>${escapeHtml(i.article)}</b>${i.lastPrice ? ` (${i.lastPrice} ${escapeHtml(i.cur || "")}${i.last ? ", " + escapeHtml(erpDMY(i.last) || "") : ""})` : ""}`).join(" · ")}</div>`
          : (bought.length ? `<div class="erp-muted" style="font-size:11px">🧾 ${bought.slice(0, 3).map(i => escapeHtml(i.article)).join(" · ")}${bought.length > 3 ? ` +${bought.length - 3}` : ""}</div>` : "");
        return head + `<tr class="erp-clickable" data-open="${escapeAttr(r.name)}">
          <td data-label="Доставчик"><b>${escapeHtml(r.name)}</b>${r.last ? `<div class="erp-muted" style="font-size:11px">последен документ ${escapeHtml(erpDMY(r.last) || "")}</div>` : ""}</td>
          <td data-label="ЕИК">${escapeHtml(p.eik || "")}</td>
          <td data-label="Сметка">${escapeHtml(p.account || "")}</td>
          <td data-label="Какво купуваме" class="supp-colwhat">${escapeHtml(p.whatWeBuy || "")}${autoLine}</td>
          <td data-label="Къде се ползва">${(p.where || []).map(w => `<span class="supp-tag">${escapeHtml(w)}</span>`).join(" ")}</td>
          <td class="num" data-label="Оборот 12 м.">${r.turn12 ? suppMoney(r.turn12) : ""}</td>
          <td class="num" data-label="Док.">${r.docs || ""}</td>
          <td data-label="Готов"><span class="supp-pct ${pct === 100 ? "ok" : pct >= 50 ? "half" : "no"}">${pct}%</span></td>
          <td class="erp-row-actions"><button class="btn btn-small" data-edit="${escapeAttr(r.name)}">✎ Паспорт</button></td>
        </tr>`;
      }).join("");
      })() || `<tr><td colspan="9" class="report-empty">Няма доставчици по този филтър.</td></tr>`}
      </tbody>
    </table>`;

  // Търсенето е с дебаунс — прерисуването на 209 доставчика на всяка буква
  // „запецваше"; сега чака 300 мс тишина и връща фокуса.
  const qEl = document.getElementById("supp-q");
  if (qEl) qEl.addEventListener("input", uiDebounce(e => {
    suppQuery = e.target.value; erpRenderSupplierProfiles();
    const el = document.getElementById("supp-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, 300));
  // Падащият списък с всички доставчици — изборът отваря паспорта направо.
  const pEl = document.getElementById("supp-pick");
  if (pEl) pEl.addEventListener("change", () => {
    const nm = pEl.value.trim();
    if (nm && everyone.some(r => r.name === nm)) { pEl.value = ""; suppForm(nm); }
  });
  suppSetBadge(missing.length);
  const mEl = document.getElementById("supp-months");
  if (mEl) mEl.addEventListener("change", e => { suppMonths = Number(e.target.value) || 0; erpRenderSupplierProfiles(); });
  const sEl = document.getElementById("supp-sort");
  if (sEl) sEl.addEventListener("change", e => { suppSort = e.target.value; erpRenderSupplierProfiles(); });
  const eEl = document.getElementById("supp-empty");
  if (eEl) eEl.addEventListener("change", e => { suppOnlyEmpty = e.target.checked; erpRenderSupplierProfiles(); });
  const xEl = document.getElementById("supp-xls");
  if (xEl) xEl.addEventListener("click", () => suppExportXls(rows));
  v.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); suppForm(b.dataset.edit); }));
  v.querySelectorAll("tr[data-open]").forEach(tr => tr.addEventListener("click", () => suppForm(tr.dataset.open)));
}

/* ---------- Паспорт (форма) ---------- */
function suppForm(name) {
  const key = suppKey(name);
  const p = JSON.parse(JSON.stringify(suppProfile(name) || {}));
  // Каквото го има в директорията — предлага се наготово.
  const pt = ((typeof erpPartners !== "undefined" && erpPartners) || []).find(x => x.kind === "supplier" && suppKey(x.name) === key) || {};
  const g = (f, alt) => escapeAttr(p[f] != null && p[f] !== "" ? p[f] : (alt || ""));
  const where = new Set(p.where || []);
  const { wrap, close } = erpDialog(`
    <h3>🏷 Паспорт на доставчика</h3>
    <p class="hint" style="margin:0 0 8px"><b>${escapeHtml(name)}</b> — попълва се за счетоводството. Каквото още не знаеш, остави празно и се връщаш после.</p>

    <h4 class="erp-group-head">Идентификация</h4>
    <div class="erp-co-grid">
      <label>ЕИК <input type="text" id="sp-eik" value="${g("eik", pt.eik)}" /></label>
      <label>ДДС № <input type="text" id="sp-vat" value="${g("vat", pt.vat)}" /></label>
      <label>Държава <input type="text" id="sp-country" value="${g("country", pt.country || "България")}" /></label>
      <label>Град / адрес <input type="text" id="sp-addr" value="${g("addr", [pt.city, pt.street].filter(Boolean).join(", "))}" /></label>
      <label>Лице за контакт <input type="text" id="sp-person" value="${g("person", pt.person)}" /></label>
      <label>Имейл за фактури <input type="text" id="sp-email" value="${g("email", pt.email)}" /></label>
      <label>Телефон <input type="text" id="sp-phone" value="${g("phone", pt.phone)}" /></label>
    </div>

    <h4 class="erp-group-head">Данъчно третиране</h4>
    <div class="erp-co-grid">
      <label>Режим на доставката
        <select id="sp-regime"><option value="">— избери —</option>${SUPP_REGIMES.map(([k, l]) => `<option value="${k}" ${p.regime === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
      <label>Данъчен кредит
        <select id="sp-credit"><option value="">— избери —</option>${SUPP_CREDIT.map(([k, l]) => `<option value="${k}" ${p.credit === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
      <label>Обичайна ДДС ставка
        <select id="sp-rate">${["", "20", "9", "0"].map(r => `<option value="${r}" ${String(p.rate || "") === r ? "selected" : ""}>${r === "" ? "— избери —" : r + "%"}</option>`).join("")}</select></label>
      <label>Издаваме ли протокол (чл. 117)
        <select id="sp-protocol">${[["", "— избери —"], ["no", "Не"], ["yes", "Да — при всяка доставка"]].map(([k, l]) => `<option value="${k}" ${String(p.protocol || "") === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
    </div>
    <label>Данъчна бележка (ограничения, основания, особености)
      <input type="text" id="sp-taxnote" value="${g("taxnote")}" placeholder="напр. леки автомобили — без данъчен кредит; чл. 163а — обратно начисляване" /></label>

    <h4 class="erp-group-head">Какво купуваме и къде отива</h4>
    ${(() => {
      const bought = suppBoughtFor(name);
      if (!bought.length) return `<p class="erp-muted" style="font-size:12px">🧾 Няма редове от Покупки за този доставчик (или фактурите му са без разбити редове).</p>`;
      return `<div class="supp-bought">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <b>🧾 Купувано от Покупки (автоматично)</b>
          <button type="button" class="btn btn-small" id="sp-autofill" title="Попълва „Какво купуваме" с най-честите артикули">⤵ Попълни „Какво купуваме"</button>
        </div>
        <table class="report-table erp-table" style="font-size:12px">
          <thead><tr><th>Артикул</th><th>Код</th><th>Група</th><th class="num">Пъти</th><th>Последно</th><th class="num">Посл. цена</th></tr></thead>
          <tbody>${bought.slice(0, 12).map(i => `<tr><td>${escapeHtml(i.article)}</td><td class="t-code">${escapeHtml(i.code || "")}</td><td>${escapeHtml(i.group || "")}</td><td class="num">${i.n}</td><td>${escapeHtml(erpDMY(i.last) || "")}</td><td class="num">${i.lastPrice ? i.lastPrice + " " + escapeHtml(i.cur || "") : ""}</td></tr>`).join("")}</tbody>
        </table>
        ${bought.length > 12 ? `<p class="erp-muted" style="font-size:11px">…и още ${bought.length - 12} артикула.</p>` : ""}
      </div>`;
    })()}
    <div class="erp-co-grid">
      <label>Тип доставчик
        <select id="sp-suptype">
          <option value="">Авто: ${suppType(name) === "materials" ? "🧱 Материали за производство" : "🛠 Услуги/други"}</option>
          <option value="materials" ${p.supType === "materials" ? "selected" : ""}>🧱 Материали за производство</option>
          <option value="services" ${p.supType === "services" ? "selected" : ""}>🛠 Услуги / други</option>
        </select></label>
    </div>
    <label>Какво купуваме <input type="text" id="sp-what" value="${g("whatWeBuy")}" placeholder="напр. ламарина S235 1.5–4 мм, тръби ф25" /></label>
    <label>За какво служи / защо ни трябва <input type="text" id="sp-usedfor" value="${g("usedFor")}" placeholder="напр. заготовки за механизми Дроп Ин" /></label>
    <div class="supp-where">${SUPP_WHERE.map(w => `<label class="erp-inline supp-w"><input type="checkbox" class="sp-where" value="${escapeAttr(w)}" ${where.has(w) ? "checked" : ""} /> ${escapeHtml(w)}</label>`).join("")}</div>
    <label>Уточнение къде (цех, машина, автомобил…) <input type="text" id="sp-wherenote" value="${g("whereNote")}" /></label>

    <h4 class="erp-group-head">Счетоводно отчитане</h4>
    <div class="erp-co-grid">
      <label>Вид на разхода
        <select id="sp-kind"><option value="">— избери —</option>${SUPP_KIND.map(([k, l]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
      <label title="Ще я вземем от новото счетоводство">Счетоводна сметка <input type="text" id="sp-account" value="${g("account")}" placeholder="напр. 601 / 602 / 302 / 204" /></label>
      <label>Вид разход в Системата
        <select id="sp-etype"><option value="">— избери —</option>${(typeof PU_EXPENSE_TYPES !== "undefined" ? PU_EXPENSE_TYPES : []).map(t => `<option value="${escapeAttr(t.k)}" ${p.expenseType === t.k ? "selected" : ""}>${escapeHtml(t.k)}</option>`).join("")}</select></label>
      <label>Документооборот
        <select id="sp-docflow"><option value="">— избери —</option>${SUPP_DOCFLOW.map(([k, l]) => `<option value="${k}" ${p.docflow === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
    </div>

    <h4 class="erp-group-head">Търговски условия</h4>
    <div class="erp-co-grid">
      <label>Начин на плащане <input type="text" id="sp-paymethod" value="${g("payMethod", "Банка")}" /></label>
      <label>Срок (дни) <input type="number" id="sp-term" min="0" value="${g("termDays")}" /></label>
      <label>Договор № <input type="text" id="sp-contract" value="${g("contract")}" /></label>
      <label>Договор до <input type="date" id="sp-contractto" value="${g("contractTo")}" /></label>
      <label>Отговорник при нас <input type="text" id="sp-owner" value="${g("owner")}" /></label>
      <label>Важност
        <select id="sp-critical">${[["", "— избери —"], ["critical", "Критичен — няма замяна"], ["normal", "Обикновен"], ["rare", "Рядко ползван"]].map(([k, l]) => `<option value="${k}" ${String(p.critical || "") === k ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select></label>
    </div>
    <label>Забележки за счетоводството <textarea id="sp-notes" rows="3" placeholder="всичко, което новото счетоводство трябва да знае за този доставчик">${escapeHtml(p.notes || "")}</textarea></label>

    ${p.updatedAt ? `<p class="erp-muted" style="font-size:12px">Последна промяна: ${escapeHtml(erpDMY(String(p.updatedAt).slice(0, 10)) || "")}${p.updatedBy ? " · " + escapeHtml(p.updatedBy) : ""}</p>` : ""}
    <div class="erp-dialog-actions">
      ${suppProfile(name) ? '<button class="btn btn-danger" id="sp-del">Изтрий паспорта</button>' : ""}
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="sp-cancel">Отказ</button>
      <button class="btn btn-primary" id="sp-save">💾 Запази</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  wrap.querySelector("#sp-cancel").addEventListener("click", close);
  const af = wrap.querySelector("#sp-autofill");
  if (af) af.addEventListener("click", () => {
    const el = wrap.querySelector("#sp-what");
    const top = suppBoughtFor(name).slice(0, 6).map(i => i.article).join(", ");
    if (!top) return;
    el.value = el.value.trim() ? el.value.trim().replace(/,\s*$/, "") + ", " + top : top;
  });
  const del = wrap.querySelector("#sp-del");
  if (del) del.addEventListener("click", async () => {
    if (!confirm(`Да изтрия ли паспорта на „${name}"?`)) return;
    delete SUPP_PROFILES.byKey[key];
    if (await suppSave()) { close(); suppUpdateBadge(); erpRenderSupplierProfiles(); }
  });
  wrap.querySelector("#sp-save").addEventListener("click", async () => {
    const val = id => { const el = wrap.querySelector("#sp-" + id); return el ? el.value.trim() : ""; };
    const rec = {
      name: String(name).trim(),
      eik: val("eik"), vat: val("vat"), country: val("country"), addr: val("addr"),
      person: val("person"), email: val("email"), phone: val("phone"),
      regime: val("regime"), credit: val("credit"), rate: val("rate"), protocol: val("protocol"), taxnote: val("taxnote"),
      whatWeBuy: val("what"), usedFor: val("usedfor"), supType: val("suptype"),
      where: [...wrap.querySelectorAll(".sp-where:checked")].map(c => c.value),
      whereNote: val("wherenote"),
      kind: val("kind"), account: val("account"), expenseType: val("etype"), docflow: val("docflow"),
      payMethod: val("paymethod"), termDays: val("term"), contract: val("contract"), contractTo: val("contractto"),
      owner: val("owner"), critical: val("critical"), notes: val("notes"),
      updatedAt: new Date().toISOString(),
      updatedBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "",
    };
    SUPP_PROFILES.byKey = SUPP_PROFILES.byKey || {};
    SUPP_PROFILES.byKey[key] = rec;
    if (await suppSave()) { close(); suppUpdateBadge(); erpRenderSupplierProfiles(); }
  });
}

/* ---------- ⬇ Excel за счетоводството ---------- */
function suppExportXls(rows) {
  if (typeof reportExportXls !== "function") { alert("Модулът за експорт не е зареден."); return; }
  const list = (rows && rows.length ? rows : suppCollect()).slice()
    .sort((a, b) => b.turn12 - a.turn12 || a.name.localeCompare(b.name, "bg"));
  const headers = [
    { label: "Доставчик" }, { label: "ЕИК" }, { label: "ДДС №" }, { label: "Държава" }, { label: "Адрес" },
    { label: "Режим на доставката" }, { label: "Данъчен кредит" }, { label: "ДДС %", num: true }, { label: "Протокол чл.117" },
    { label: "Данъчна бележка" },
    { label: "Какво купуваме" }, { label: "За какво служи" }, { label: "Къде се ползва" }, { label: "Уточнение" },
    { label: "Вид на разхода" }, { label: "Сметка" }, { label: "Вид разход (Системата)" }, { label: "Документооборот" },
    { label: "Плащане" }, { label: "Срок (дни)", num: true }, { label: "Договор" }, { label: "Договор до" },
    { label: "Отговорник" }, { label: "Важност" }, { label: "Забележки" },
    { label: "Оборот 12 м. (EUR)", num: true }, { label: "Документи", num: true }, { label: "Последен документ" },
  ];
  const body = list.map(r => {
    const p = suppProfile(r.name) || {};
    return [
      r.name, p.eik || "", p.vat || "", p.country || "", p.addr || "",
      suppLabel(SUPP_REGIMES, p.regime), suppLabel(SUPP_CREDIT, p.credit), p.rate || "", p.protocol === "yes" ? "да" : (p.protocol === "no" ? "не" : ""),
      p.taxnote || "",
      p.whatWeBuy || "", p.usedFor || "", (p.where || []).join("; "), p.whereNote || "",
      suppLabel(SUPP_KIND, p.kind), p.account || "", p.expenseType || "", suppLabel(SUPP_DOCFLOW, p.docflow),
      p.payMethod || "", p.termDays || "", p.contract || "", p.contractTo ? (erpDMY(p.contractTo) || "") : "",
      p.owner || "", p.critical === "critical" ? "критичен" : (p.critical === "rare" ? "рядък" : (p.critical === "normal" ? "обикновен" : "")),
      p.notes || "",
      r.turn12 ? (Math.round(r.turn12 * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
      r.docs || "", r.last ? (erpDMY(r.last) || "") : "",
    ];
  });
  const today = new Date().toISOString().slice(0, 10);
  reportExportXls(`dostavchitsi-pasporti-${today}`,
    `Доставчици — паспорт за счетоводството · ${erpDMY(today) || today}`,
    [{ headers, rows: body }]);
}
