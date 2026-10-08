/* Данко Системс — ЕРП „Заплати (седмично)".
   Място, където всяка седмица се попълва какво е получил всеки служител
   (банка, в брой/С005, надник, извънреден, бонус) + отработени дни и отпуск.
   Целта е месечен отчет: колко точно е взел всеки. Това е ОТЧЕТ на изплатеното
   (без осигуровки) — не участва в себестойността.
   Пази се в app_config (id=payroll_<понеделник>), без нов SQL. */

let erpPayView = "fri";      // fri | week | month
let erpPayMonday = "";
let erpPayMonth = "";
let payAutoTimer = null;     // авто-запазване на седмичния изглед (на 2 мин)
let payFilter = "";          // търсене по име на служител (общо за изгледите)

// Скрива редовете, които не съвпадат с търсенето, без пре-рендер (пази въведеното).
function payApplyFilter(v) {
  const q = (payFilter || "").trim().toLowerCase();
  const rows = [...v.querySelectorAll("tbody tr")];
  rows.forEach(tr => {
    if (tr.classList.contains("pay-ws") || tr.classList.contains("pr-total") || tr.querySelector(".report-empty")) return;
    const name = (tr.getAttribute("data-row") || "").toLowerCase();
    tr.style.display = (!q || name.includes(q)) ? "" : "none";
  });
  // Заглавие на цех: скрий, ако под него няма видим служител.
  rows.forEach((tr, i) => {
    if (!tr.classList.contains("pay-ws")) return;
    let vis = false;
    for (let j = i + 1; j < rows.length && !rows[j].classList.contains("pay-ws"); j++) {
      if (rows[j].style.display !== "none" && !rows[j].querySelector(".report-empty")) { vis = true; break; }
    }
    tr.style.display = vis ? "" : "none";
  });
}
function payFindBox() { return `<label class="erp-inline pay-findbox">🔍 <input type="search" id="pay-find" placeholder="търси служител" value="${escapeAttr(payFilter)}" /></label>`; }
function payNowHM() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); }
const PAY_MONEY = [{ k: "bank", l: "Банка" }, { k: "cash", l: "В брой (С005)" }, { k: "nadnik", l: "Надник" }, { k: "overtime", l: "Извънреден" }, { k: "bonus", l: "Бонус" }];
// Кой ред стои най-отгоре в експорта (и се вади в отделния сбор „без …").
const PAY_TOP_NAME = /Данко\s+Евгениев/i;
const PAY_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];

function payIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function payMondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); d.setHours(0, 0, 0, 0); return d;
}
function payWeekNo(d) {
  const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
function payFmt(d) { const p = n => String(n).padStart(2, "0"); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; }
function payEur(n) { return (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function payRowTotal(r) { return PAY_MONEY.reduce((s, c) => s + (Number(r[c.k]) || 0), 0); }

async function erpPayLoadWeek(mondayIso) {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "payroll_" + mondayIso).maybeSingle(); return (data && data.data && data.data.entries) || {}; }
  catch (e) { return {}; }
}
async function erpPaySaveWeek(mondayIso, entries) {
  const { error } = await sb.from("app_config").upsert({ id: "payroll_" + mondayIso, data: { entries, monday: mondayIso }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
async function erpPayAllWeeks() {
  try { const { data } = await sb.from("app_config").select("id,data").like("id", "payroll_%"); return data || []; }
  catch (e) { return []; }
}

/* ---------- Изглед ---------- */
let erpPayRootEl = null;
async function erpRenderPayroll(v) {
  erpPayRootEl = v;
  await erpLoadCostCfg();
  const nav = `<div class="pr-row" style="margin-bottom:8px">
    <button class="btn btn-small ${erpPayView === "fri" ? "btn-primary" : ""}" id="pay-nav-f">🏦 По петъци (банка + CODE 005)</button>
    <button class="btn btn-small ${erpPayView === "month" ? "btn-primary" : ""}" id="pay-nav-m">📅 Месечен отчет</button></div>`;
  v.innerHTML = nav + `<div id="pay-body"><p class="erp-loading">Зареждане…</p></div>`;
  v.querySelector("#pay-nav-f").addEventListener("click", () => { erpPayView = "fri"; erpRenderPayroll(v); });
  v.querySelector("#pay-nav-m").addEventListener("click", () => { erpPayView = "month"; erpRenderPayroll(v); });
  const body = v.querySelector("#pay-body");
  // „Седмица (стар изглед)" е махнат (не се ползва от юли) — старите му
  // записи обаче продължават да се четат в Месечния отчет.
  if (erpPayView === "month") await erpPayMonthView(body);
  else await erpPayFridaysView(body);
}

// Пре-рендер на активния изглед (след добавяне/махане на служител).
function erpPayRerender() { if (erpPayRootEl) erpRenderPayroll(erpPayRootEl); }

// Всички петъци в месеца (YYYY-MM) като {iso, label}.
function payFridays(Y, M) {
  const out = [];
  const d = new Date(Y, M - 1, 1);
  while (d.getMonth() === M - 1) {
    if (d.getDay() === 5) out.push({ iso: payIso(d), label: payFmt(d).slice(0, 5) });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function erpPayLoadMonth(monthStr) {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "payroll_m_" + monthStr).maybeSingle(); return (data && data.data && data.data.entries) || {}; }
  catch (e) { return {}; }
}
async function erpPaySaveMonth(monthStr, entries) {
  const { error } = await sb.from("app_config").upsert({ id: "payroll_m_" + monthStr, data: { entries, month: monthStr }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

/* Стойност на един петък: {w: седмична надница, o: извънредни}. Пази съвместимост
   със стар запис, където петъкът беше просто число (надница). */
function friWO(x) {
  if (x && typeof x === "object") return { w: Number(x.w) || 0, o: Number(x.o) || 0 };
  return { w: Number(x) || 0, o: 0 };
}
/* Разпределя раздаденото по петъци (в хронологичен ред): натрупва към „чисто по банка";
   до нея е „От банка", над нея — CODE 005. Ако чисто по банка = 0 → всичко е CODE 005. */
function payFriBreakdown(net, friMap, fridays) {
  const n = Number(net) || 0; let cum = 0, bank = 0, code = 0;
  const rows = fridays.map(f => {
    const wo = friWO((friMap || {})[f.iso]);
    const amt = wo.w + wo.o;
    const room = Math.max(0, n - cum);
    const b = Math.min(amt, room); const c = amt - b; cum += amt;
    bank += b; code += c;
    return { iso: f.iso, amt, bank: b, code: c, wo };
  });
  return { rows, fromBank: bank, code005: code, sum: cum };
}

/* Нормализира петъците към нов формат {b:седм.банка, c:седм.005, o:извънредни}.
   Стар формат ({w,o} или число) се разделя банка/005 по натрупване спрямо ПО БАНКА,
   за да остане историята непроменена, докато не се презапише ръчно. */
function payFriNormalize(r, fridays) {
  const fri = (r && r.fri) || {};
  const isNew = Object.values(fri).some(x => x && typeof x === "object" && (("b" in x) || ("c" in x)));
  const map = {};
  if (isNew) {
    fridays.forEach(f => {
      const x = fri[f.iso] || {};
      map[f.iso] = { b: Number(x.b) || 0, c: Number(x.c) || 0, o: Number(x.o) || 0 };
      if (x.i) map[f.iso].i = 1;   // извънредните са ВЪТРЕ в банка/005 (авто-разпределен петък)
    });
    return map;
  }
  const bd = payFriBreakdown(r && r.net, fri, fridays);
  bd.rows.forEach(row => { map[row.iso] = { b: row.bank, c: row.code, o: (row.wo && row.wo.o) || 0 }; });
  return map;
}

/* ---------- ПРАВИЛОТО НА ДАНКО за разпределението (08.10.2026) ----------
   Месечната сума ПО БАНКА (net, чистото от ведомостта) се налива по петъците
   ОТПРЕД-НАЗАД: всеки петък взима по банка най-много дължимото си, а дължимото
   е СЕДМИЧНОТО (ставката) + извънредните на петъка. Щом банковият бюджет
   свърши, остатъкът от дължимото отива в Седм. 005; следващите петъци са
   изцяло 005. net = 0 (Георги) → всичко в 005. Ако net > сбора дължими,
   остатъкът се добавя към ПОСЛЕДНИЯ петък по банка — чистото по ведомост се
   превежда до стотинка. Петъци ПРЕДИ fromIso не се пипат (платеното си
   остава, „увеличението е винаги в бъдеще") — тяхната банка се приспада от
   бюджета. Извънредните (o) само се четат — тях ги въвежда човек. */
function payFriDistribute(net, fridays, friMap, weekly, fromIso) {
  const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
  const out = {};
  let room = r2(Math.max(0, Number(net) || 0));
  const w = r2(weekly);
  let lastIso = null;
  fridays.forEach(f => {
    const x = (friMap || {})[f.iso] || {};
    // Пази се: минал петък (платеното си остава) или РЪЧНО пипнат (x.lock —
    // „ръчното е господар": болничен на 005 не се връща на банка от тригер).
    if ((fromIso && f.iso < fromIso) || x.lock) {
      out[f.iso] = { b: r2(x.b), c: r2(x.c), o: r2(x.o) };
      if (x.i) out[f.iso].i = 1;
      room = r2(Math.max(0, room - out[f.iso].b));
      return;
    }
    const o = r2(x.o);
    const due = r2(w + o);
    const b = Math.min(due, room);
    out[f.iso] = { b: r2(b), c: r2(due - b), o };
    // i=1: извънредните са ВКЛЮЧЕНИ в банка/005 на петъка (дължимото ги носи)
    // — сборовете не бива да ги добавят втори път.
    if (o) out[f.iso].i = 1;
    room = r2(room - b);
    lastIso = f.iso;
  });
  if (room > 0.004 && lastIso) out[lastIso].b = r2(out[lastIso].b + room);
  return out;
}

/* Чистото от ведомостта → ПО БАНКА (net) + авто-разпределение по петъците.
   ЕДНА функция за ДВАТА пътя на запис: „✅ Приложи реално" (от теста) и
   директния „💾 Запази" без тестов режим — иначе вторият път пълнеше само
   ПО БАНКА и петъците оставаха празни. Минали петъци (локална дата) не се
   пипат; офисните/напусналите (skipKeys) не влизат в петъчната таблица. */
function payApplyNetsToMonth(entries, netByName, skipKeys, monthStr) {
  const frs = payFridays(...monthStr.split("-").map(Number));
  const fromIso = payIso(new Date());
  Object.keys(netByName || {}).forEach(n => {
    if (skipKeys.has(payNameKey(n))) return;
    const er = entries[n] = entries[n] || {};
    // Снимка на петъците ПРЕДИ новото чисто: при стар формат (число/{w,o})
    // нормализацията дели банка/005 по net — трябва да е СТАРИЯТ net,
    // иначе миналите петъци се пренаписват с новата сума.
    const before = payFriNormalize(er, frs);
    er.net = netByName[n];
    const emp = (COST_CFG.employees || []).find(e => payNameKey(e.name) === payNameKey(n));
    const weekly = Number(emp && emp.sedmichno) || 0;
    if (weekly > 0) {
      const map = payFriDistribute(er.net, frs, before, weekly, fromIso);
      const clean = {};
      Object.keys(map).forEach(k => { const x = map[k]; if (x.b || x.c || x.o) clean[k] = x; });
      if (Object.keys(clean).length) er.fri = clean; else delete er.fri;
    }
  });
}

async function erpPayFridaysView(v) {
  if (!erpPayMonth) { const d = new Date(); erpPayMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  const [Y, M] = erpPayMonth.split("-").map(Number);
  const fridays = payFridays(Y, M);
  const entries = await erpPayLoadMonth(erpPayMonth);
  const { byWs, order } = erpPayRoster();

  // Нормализирани петъци за всеки служител (за редовете и за отметките в шапката на цеха).
  const friByEmp = {};
  order.forEach(ws => byWs[ws].forEach(e => { friByEmp[e.name] = payFriNormalize(entries[e.name] || {}, fridays); }));

  const inp = (cls, name, val, extra) => `<input type="number" class="${cls}" data-name="${escapeAttr(name)}" ${extra || ""} step="any" value="${val != null && val !== "" ? escapeAttr(String(val)) : ""}" />`;
  const friBreak3 = (b, c, o) => `🏦 ${payEur(b)}<br>005 ${payEur(c)}<br>Изв. ${payEur(o)}`;
  // Ред-заглавие на цеха: под всеки петък — отметка „По банка" (цялата седмица по банка).
  const wsHeadRow = ws => {
    const checks = fridays.map(f => {
      let b = 0, c = 0; byWs[ws].forEach(e => { const x = friByEmp[e.name][f.iso]; b += x.b; c += x.c; });
      const checked = c === 0 && b > 0;
      return `<td class="pf-wscol"><label class="pf-wsbank"><input type="checkbox" class="pf-bankchk" data-ws="${escapeAttr(ws)}" data-iso="${f.iso}" ${checked ? "checked" : ""} /> По банка</label></td>`;
    }).join("");
    return `<tr class="pay-ws"><td colspan="4"><b>${escapeHtml(ws)}</b></td>${checks}<td colspan="4"></td></tr>`;
  };
  const empRow = e => {
    const r = entries[e.name] || {};
    const friN = friByEmp[e.name];
    const rz = r.rz || {};
    const rzSum = Number(rz.sum) || 0;
    let sumB = 0, sumC = 0, sumO = 0;
    const friCells = fridays.map(f => {
      const x = friN[f.iso]; sumB += x.b; sumC += x.c; sumO += (x.i ? 0 : x.o);
      return `<td class="num pf-fricol">
        <div class="pf-fline"><span>Седм. банка</span>${inp("pf-frib", e.name, x.b, `data-iso="${f.iso}" data-inc="${x.i ? 1 : 0}"`)}</div>
        <div class="pf-fline"><span>Седм. 005</span>${inp("pf-fric", e.name, x.c, `data-iso="${f.iso}"`)}</div>
        <div class="pf-fline"><span>Извънредни</span>${inp("pf-frio", e.name, x.o, `data-iso="${f.iso}"`)}</div>
        <div class="pf-fribd" data-name="${escapeAttr(e.name)}" data-iso="${f.iso}">${friBreak3(x.b, x.c, x.o)}</div>
      </td>`;
    }).join("");
    const net = Number(r.net) || 0;
    const sum = sumB + sumC + sumO;
    return `<tr data-row="${escapeAttr(e.name)}">
      <td>${escapeHtml(e.name)} <button class="btn btn-small pf-rm" data-name="${escapeAttr(e.name)}" title="Махни служителя">×</button></td>
      <td class="num pf-dnc">${inp("pf-dnevno", e.name, e.dnevno)}</td>
      <td class="num pf-sec">${inp("pf-sedm", e.name, e.sedmichno)}</td>
      <td class="num pf-netc">${inp("pf-net", e.name, r.net)}<button class="btn btn-small pf-redo" data-name="${escapeAttr(e.name)}" title="Разпредели наново: налива ПО БАНКА по петъците от днес нататък (по СЕДМИЧНОТО + извънредните). Маха ръчните корекции на бъдещите петъци; миналите не пипа.">↻</button></td>
      ${friCells}
      <td class="num pf-bank ${net > 0 && sumB > net ? "pf-over" : ""}" data-bank="${escapeAttr(e.name)}">${payEur(sumB)}</td>
      <td class="num pf-code" data-code="${escapeAttr(e.name)}">${payEur(sumC)}</td>
      <td class="num pf-rzcol">
        <div class="pf-fline"><span>Сума</span><input type="number" class="pf-rzsum" data-name="${escapeAttr(e.name)}" step="any" value="${rz.sum != null && rz.sum !== "" ? escapeAttr(String(rz.sum)) : ""}" /></div>
        <div class="pf-fline"><span>Бел.</span><input type="text" class="pf-rznote" data-name="${escapeAttr(e.name)}" value="${escapeAttr(rz.note || "")}" /></div>
      </td>
      <td class="num pf-tot" data-tot="${escapeAttr(e.name)}"><b>${payEur(sum + rzSum)}</b></td>
    </tr>`;
  };

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-inline" style="display:inline-flex;align-items:center;gap:6px">
        <button class="btn btn-small" id="pf-m-prev" title="Предишен месец">‹</button>
        <b style="min-width:150px;text-align:center;font-size:16px">${PAY_MONTHS[M - 1]} ${Y}</b>
        <button class="btn btn-small" id="pf-m-next" title="Следващ месец">›</button>
        <input type="month" id="pf-month" value="${escapeAttr(erpPayMonth)}" title="Скок към произволен месец" style="width:52px" />
      </span>
      ${payFindBox()}
      <span class="erp-count">${PAY_MONTHS[M - 1]} ${Y} · ${fridays.length} петъка</span>
      <button class="btn btn-small" id="pf-add-emp">+ Добави служител</button>
      <button class="btn btn-small" id="pf-xls" title="Сваля таблицата за месеца в Excel: ПО БАНКА, От банка и общо CODE 005 за всеки служител">⤓ Excel (месеца)</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pf-save-all">💾 ЗАПАЗИ</button>
      <span class="erp-muted" id="pf-save-status" style="margin-left:8px"></span>
    </div>
    <div class="pay-scroll"><table class="report-table erp-table pay-table pf-table">
      <thead><tr>
        <th>Служител</th>
        <th class="num pf-hd">ДНЕВНО</th>
        <th class="num pf-hs">СЕДМИЧНО</th>
        <th class="num pf-hn">ПО БАНКА</th>
        ${fridays.map(f => `<th class="pf-frih">Петък<br>${f.label}</th>`).join("")}
        <th class="num">От банка</th>
        <th class="num">CODE 005</th>
        <th class="num pf-hrz">РАЗЛИЧНИ</th>
        <th class="num">ОБЩО</th>
      </tr></thead>
      <tbody>
        ${order.map(ws => wsHeadRow(ws) + byWs[ws].map(empRow).join("")).join("") ||
          `<tr><td colspan="${fridays.length + 8}" class="report-empty">Няма служители. Добави с бутона горе.</td></tr>`}
      </tbody>
      <tfoot><tr class="pf-foot">
        <td colspan="3"><b>ОБЩО (всички служители)</b></td>
        <td class="num"></td>
        ${fridays.map(f => `<td class="num pf-fcol">
          <div class="pf-ftot" data-iso="${f.iso}"></div>
        </td>`).join("")}
        <td class="num pf-bank" id="pf-gbank"></td>
        <td class="num pf-code" id="pf-gcode"></td>
        <td class="num pf-rz" id="pf-grz"></td>
        <td class="num pf-tot" id="pf-gtot"></td>
      </tr></tfoot>
    </table></div>
    <p class="hint"><b>ДНЕВНО</b> и <b>СЕДМИЧНО</b> са ставки на служителя — въвеждаш ги веднъж и се пренасят за всеки следващ месец. Всеки петък има три полета: <b>Седм. банка</b> (плащане по банка), <b>Седм. 005</b> (плащане по CODE 005) и <b>Извънредни</b>. Под тях се вижда разбивката 🏦 банка / 005 / Изв. Колоните <b>От банка</b> и <b>CODE 005</b> сумират съответните полета за месеца.<br>Отметката <b>„По банка"</b> под всеки петък (на реда на цеха) прехвърля цялата седмична сума на всички в цеха към <b>по банка</b>; махнеш ли я — към <b>005</b> (напр. служителят има пари по банка, но е болничен и се дава 005). После можеш да коригираш отделен служител ръчно.<br><b>ПО БАНКА</b> (чистото за месеца) се попълва АВТОМАТИЧНО от „🤖 Ведомост" в Месечния отчет и се <b>РАЗПРЕДЕЛЯ САМО̀ по петъците</b>: банката се налива отпред-назад — всеки петък взима по банка до дължимото си (СЕДМИЧНО + извънредните му), а щом банката свърши, остатъкът от дължимото отива в Седм. 005; празно ПО БАНКА → всичко в 005. Пипнеш ли <b>ПО БАНКА</b>, <b>СЕДМИЧНО</b> или <b>Извънредни</b>, разпределението се преизчислява наново — от днес нататък (при извънредни — от техния петък); минали петъци НЕ се пипат. Ръчна поправка на Седм. банка/005 не се преразпределя — ръчното е господар, но ако „От банка" надвиши ПО БАНКА, колоната се оцветява. <b>РАЗЛИЧНИ</b> (Сума + Бел.) влиза в ОБЩО, но не в разбивката банка/005. Сумите са в евро.<br><b>Запазване:</b> „💾 ЗАПАЗИ" записва всичко; таблицата се <b>авто-запазва на всеки 2 минути</b>.<br><b>⤓ Excel (месеца)</b> сваля чиста таблица: Цех · Служител · <b>ПО БАНКА</b> · <b>CODE 005</b> · ОБЩО, с Данко най-отгоре и два сбора най-долу — без него и с него. Взема това, което е в таблицата в момента — и още незаписаното.</p>`;

  const pfShift = dir => { const d = new Date(Y, M - 1 + dir, 1); erpPayMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; erpPayFridaysView(v); };
  v.querySelector("#pf-m-prev").addEventListener("click", () => pfShift(-1));
  v.querySelector("#pf-m-next").addEventListener("click", () => pfShift(1));
  v.querySelector("#pf-month").addEventListener("change", e => { if (e.target.value) { erpPayMonth = e.target.value; erpPayFridaysView(v); } });
  const pfFind = v.querySelector("#pay-find"); if (pfFind) pfFind.addEventListener("input", e => { payFilter = e.target.value; payApplyFilter(v); });
  v.querySelector("#pf-add-emp").addEventListener("click", () => erpPayAddEmployee(v));
  v.querySelectorAll(".pf-rm").forEach(b => b.addEventListener("click", () => erpPayRemoveEmployee(b.dataset.name, v)));

  const friVal = (cls, esc, iso) => Number((v.querySelector(`.${cls}[data-name="${esc}"][data-iso="${iso}"]`) || {}).value) || 0;
  // Извънредните на АВТО-разпределен петък (data-inc=1 на b-полето) са вече
  // вътре в банка/005 — сборовете не ги добавят втори път.
  const friInc = (esc, iso) => ((v.querySelector(`.pf-frib[data-name="${esc}"][data-iso="${iso}"]`) || {}).dataset || {}).inc === "1";
  const recompute = name => {
    const esc = CSS.escape(name);
    const net = Number((v.querySelector(`.pf-net[data-name="${esc}"]`) || {}).value) || 0;
    let sumB = 0, sumC = 0, sumO = 0;
    fridays.forEach(f => {
      const b = friVal("pf-frib", esc, f.iso), c = friVal("pf-fric", esc, f.iso), o = friVal("pf-frio", esc, f.iso);
      sumB += b; sumC += c; sumO += (friInc(esc, f.iso) ? 0 : o);
      const el = v.querySelector(`.pf-fribd[data-name="${esc}"][data-iso="${f.iso}"]`);
      if (el) el.innerHTML = `🏦 ${payEur(b)}<br>005 ${payEur(c)}<br>Изв. ${payEur(o)}`;
    });
    const bk = v.querySelector(`.pf-bank[data-bank="${esc}"]`); if (bk) { bk.textContent = payEur(sumB); bk.classList.toggle("pf-over", net > 0 && sumB > net); }
    const cd = v.querySelector(`.pf-code[data-code="${esc}"]`); if (cd) cd.textContent = payEur(sumC);
    const rzSum = Number((v.querySelector(`.pf-rzsum[data-name="${esc}"]`) || {}).value) || 0;
    const tt = v.querySelector(`.pf-tot[data-tot="${esc}"]`); if (tt) tt.innerHTML = `<b>${payEur(sumB + sumC + sumO + rzSum)}</b>`;
  };
  // Долен ред: за всеки петък — общо по банка и общо по CODE 005 за всички служители.
  const recomputeFooter = () => {
    const perFri = {}; fridays.forEach(f => perFri[f.iso] = { bank: 0, code: 0 });
    let gBank = 0, gCode = 0, gO = 0;
    v.querySelectorAll("tr[data-row]").forEach(tr => {
      const esc = CSS.escape(tr.getAttribute("data-row"));
      fridays.forEach(f => {
        const b = friVal("pf-frib", esc, f.iso), c = friVal("pf-fric", esc, f.iso), o = friVal("pf-frio", esc, f.iso);
        perFri[f.iso].bank += b; perFri[f.iso].code += c; gBank += b; gCode += c; gO += (friInc(esc, f.iso) ? 0 : o);
      });
    });
    let gRz = 0;
    v.querySelectorAll(".pf-rzsum").forEach(i => { gRz += Number(i.value) || 0; });
    fridays.forEach(f => {
      const el = v.querySelector(`.pf-ftot[data-iso="${f.iso}"]`);
      if (el) { const t = perFri[f.iso]; el.innerHTML = `🏦 ${payEur(t.bank)}<br>005 ${payEur(t.code)}`; }
    });
    const gb = v.querySelector("#pf-gbank"); if (gb) gb.innerHTML = `<b>${payEur(gBank)}</b>`;
    const gc = v.querySelector("#pf-gcode"); if (gc) gc.innerHTML = `<b>${payEur(gCode)}</b>`;
    const grz = v.querySelector("#pf-grz"); if (grz) grz.innerHTML = `<b>${payEur(gRz)}</b>`;
    const gt = v.querySelector("#pf-gtot"); if (gt) gt.innerHTML = `<b>${payEur(gBank + gCode + gO + gRz)}</b>`;
  };
  v.querySelectorAll(".pf-net, .pf-frib, .pf-fric, .pf-frio, .pf-rzsum").forEach(i => i.addEventListener("input", () => { recompute(i.dataset.name); recomputeFooter(); }));

  /* Автоматичното разпределение (ПРАВИЛОТО НА ДАНКО, 08.10.2026): пипнеш ли
     ПО БАНКА, СЕДМИЧНО или Извънредни — банката се пренарежда по петъците
     от fromIso нататък; миналите петъци НЕ се пипат (платеното си остава).
     Ръчна поправка на Седм. банка / Седм. 005 НЕ преразпределя — ръчното е
     господар. Служител без СЕДМИЧНО ставка не се разпределя автоматично. */
  // Отметките „По банка" на цеховете следват реалните стойности (c=0 и b>0).
  const syncBankChecks = () => v.querySelectorAll(".pf-bankchk").forEach(chk => {
    let b = 0, c = 0;
    (byWs[chk.dataset.ws] || []).forEach(e => { const esc = CSS.escape(e.name); b += friVal("pf-frib", esc, chk.dataset.iso); c += friVal("pf-fric", esc, chk.dataset.iso); });
    chk.checked = c === 0 && b > 0;
  });
  const redistribute = (name, fromIso) => {
    const esc = CSS.escape(name);
    const weekly = Number((v.querySelector(`.pf-sedm[data-name="${esc}"]`) || {}).value) || 0;
    if (!(weekly > 0)) return;
    const net = Number((v.querySelector(`.pf-net[data-name="${esc}"]`) || {}).value) || 0;
    const cur = {};
    fridays.forEach(f => {
      const bEl = v.querySelector(`.pf-frib[data-name="${esc}"][data-iso="${f.iso}"]`);
      const cEl = v.querySelector(`.pf-fric[data-name="${esc}"][data-iso="${f.iso}"]`);
      cur[f.iso] = {
        b: Number((bEl || {}).value) || 0, c: Number((cEl || {}).value) || 0, o: friVal("pf-frio", esc, f.iso),
        i: ((bEl || {}).dataset || {}).inc === "1" ? 1 : 0,
        lock: !!((bEl && bEl.dataset.manual) || (cEl && cEl.dataset.manual)),
      };
    });
    const map = payFriDistribute(net, fridays, cur, weekly, fromIso);
    fridays.forEach(f => {
      if ((fromIso && f.iso < fromIso) || cur[f.iso].lock) return;
      const bEl = v.querySelector(`.pf-frib[data-name="${esc}"][data-iso="${f.iso}"]`);
      const cEl = v.querySelector(`.pf-fric[data-name="${esc}"][data-iso="${f.iso}"]`);
      if (bEl) { bEl.value = String(map[f.iso].b || 0); bEl.dataset.inc = map[f.iso].i ? "1" : "0"; }
      if (cEl) cEl.value = String(map[f.iso].c || 0);
    });
    recompute(name); recomputeFooter(); syncBankChecks();
  };
  // Датата „днес" се смята В МОМЕНТА на пипането (локално време, payIso) —
  // екранът може да стои отворен с дни, а toISOString е UTC и след полунощ бърка.
  v.querySelectorAll(".pf-net").forEach(i => i.addEventListener("input", () => redistribute(i.dataset.name, payIso(new Date()))));
  v.querySelectorAll(".pf-sedm").forEach(i => i.addEventListener("input", () => redistribute(i.dataset.name, payIso(new Date()))));
  v.querySelectorAll(".pf-frio").forEach(i => i.addEventListener("input", () => {
    const today = payIso(new Date());
    if (i.dataset.iso < today) {
      // Извънредни със задна дата: миналият петък НЕ се пренарежда (платен е);
      // сумата се брои ОТДЕЛНО (махаме inc флага му) и нищо друго не мърда.
      const bEl = v.querySelector(`.pf-frib[data-name="${CSS.escape(i.dataset.name)}"][data-iso="${i.dataset.iso}"]`);
      if (bEl) bEl.dataset.inc = "0";
      recompute(i.dataset.name); recomputeFooter();
      return;
    }
    redistribute(i.dataset.name, i.dataset.iso);
  }));
  // Ръчна редакция на Седм. банка / Седм. 005 ЗАКЛЮЧВА петъка за авто-
  // разпределението („ръчното е господар") — до следващото презареждане.
  // ИЗТРИТО (празно) поле обаче ОТКЛЮЧВА — „изчистих го, попълни ме наново".
  v.querySelectorAll(".pf-frib, .pf-fric").forEach(i => i.addEventListener("input", () => {
    if (i.value.trim() === "") delete i.dataset.manual;
    else i.dataset.manual = "1";
  }));
  // ↻ на реда: изрично преразпределяне — маха ръчните ключалки и пита откъде:
  // от ПЪРВИЯ петък (когато месецът е почнал, а банката се зарежда сега —
  // напр. октомври 2026, платено частично на 02.10) или само от днес нататък.
  v.querySelectorAll(".pf-redo").forEach(b => b.addEventListener("click", () => {
    const esc = CSS.escape(b.dataset.name);
    const whole = confirm(`↻ ${b.dataset.name}: пренареждам банката по петъците.\n\nОК = от ПЪРВИЯ петък на месеца — пренарежда и вече миналите (ползвай, когато месецът е започнал, а ПО БАНКА се зарежда сега)\nОтказ = само от ДНЕС нататък — миналите петъци остават както са платени`);
    v.querySelectorAll(`.pf-frib[data-name="${esc}"], .pf-fric[data-name="${esc}"]`).forEach(x => { delete x.dataset.manual; });
    redistribute(b.dataset.name, whole ? null : payIso(new Date()));
  }));
  // Отметка „По банка" за петък в даден цех: премества седмичната сума банка⇄005 за всички в цеха.
  v.querySelectorAll(".pf-bankchk").forEach(chk => chk.addEventListener("change", () => {
    const ws = chk.dataset.ws, iso = chk.dataset.iso, toBank = chk.checked;
    (byWs[ws] || []).forEach(e => {
      const esc = CSS.escape(e.name);
      const bEl = v.querySelector(`.pf-frib[data-name="${esc}"][data-iso="${iso}"]`);
      const cEl = v.querySelector(`.pf-fric[data-name="${esc}"][data-iso="${iso}"]`);
      if (!bEl || !cEl) return;
      const b = Number(bEl.value) || 0, c = Number(cEl.value) || 0;
      if (toBank) { bEl.value = String(b + c); cEl.value = "0"; }
      else { cEl.value = String(b + c); bEl.value = "0"; }
      bEl.dataset.manual = "1"; cEl.dataset.manual = "1";   // ръчно решение — заключва петъка
      recompute(e.name);
    });
    recomputeFooter();
  }));
  recomputeFooter();
  payApplyFilter(v);

  /* ⤓ Excel за месеца — една чиста таблица: Цех · Служител · ПО БАНКА · CODE 005 · ОБЩО.
     Данко е най-отгоре (най-голямата заплата), а долу има два сбора: без него и с него.
     Чете живите стойности от таблицата — значи хваща и още незаписаното. */
  v.querySelector("#pf-xls").addEventListener("click", () => {
    const n2 = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const numOf = (cls, esc) => { const el = v.querySelector(`.${cls}[data-name="${esc}"]`); return el ? Number(el.value) || 0 : 0; };

    // Събиране на данните по служител (в реда на таблицата: по цехове).
    const list = [];
    order.forEach(ws => byWs[ws].forEach(e => {
      const esc = CSS.escape(e.name);
      if (!v.querySelector(`tr[data-row="${esc}"]`)) return;
      let b = 0, c = 0, o = 0;
      fridays.forEach(f => { b += friVal("pf-frib", esc, f.iso); c += friVal("pf-fric", esc, f.iso); o += (friInc(esc, f.iso) ? 0 : friVal("pf-frio", esc, f.iso)); });
      const rz = numOf("pf-rzsum", esc);
      list.push({ name: e.name, ws, net: numOf("pf-net", esc), code: c, total: b + c + o + rz });
    }));
    // Собственикът излиза пръв — заплатата му изкривява картината на цеховете.
    const isBoss = r => PAY_TOP_NAME.test(r.name);
    const boss = list.filter(isBoss), rest = list.filter(r => !isBoss(r));
    const ordered = boss.concat(rest);

    const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const totRow = (label, arr) => ["", label, n2(sum(arr, "net")), n2(sum(arr, "code")), n2(sum(arr, "total"))];

    const headers = [{ label: "Цех" }, { label: "Служител" }, { label: "ПО БАНКА", num: true }, { label: "CODE 005", num: true }, { label: "ОБЩО", num: true }];
    const rows = ordered.map(r => [r.ws, r.name, n2(r.net), n2(r.code), n2(r.total)]);
    if (rows.length) {
      if (boss.length) rows.push(totRow("ОБЩО (без " + boss[0].name.split(" ")[0] + ")", rest));
      rows.push(totRow(boss.length ? "ОБЩО (всички)" : "ОБЩО ЗА МЕСЕЦА", ordered));
    }

    const per = `${PAY_MONTHS[M - 1]} ${Y}`;
    reportExportXls(`zaplati-petuci-${erpPayMonth}`, `Заплати по петъци · ${per}`,
      [{ title: `По служител · ${per} (сумите са в евро)`, headers, rows }]);
  });

  const num = x => Number(String(x).replace(",", ".")) || 0;
  const flash = (btn, ok) => {
    const old = btn.dataset.lbl || btn.textContent; btn.dataset.lbl = old;
    btn.textContent = ok ? "✓ Записано" : "Грешка"; btn.disabled = false;
    setTimeout(() => { btn.textContent = old; }, 1500);
  };
  const eachRow = fn => v.querySelectorAll("tr[data-row]").forEach(tr => fn(tr.getAttribute("data-row"), CSS.escape(tr.getAttribute("data-row"))));
  const val = (cls, esc, iso) => { const el = v.querySelector(`.${cls}[data-name="${esc}"]${iso ? `[data-iso="${iso}"]` : ""}`); return el ? el.value.trim() : ""; };

  // ЗАПАЗИ (всичко): ставки ДНЕВНО/СЕДМИЧНО (при служителя) + ПО БАНКА + всички
  // петъци (Седм./Изв.) + РАЗЛИЧНИ (Сума/Бел.) — от текущите стойности в таблицата.
  async function payDoSaveAll() {
    const entries = await erpPayLoadMonth(erpPayMonth);
    eachRow((name, esc) => {
      const emp = (COST_CFG.employees || []).find(x => x.name === name);
      if (emp) { const d = val("pf-dnevno", esc), s = val("pf-sedm", esc); emp.dnevno = d === "" ? 0 : num(d); emp.sedmichno = s === "" ? 0 : num(s); }
      const rec = entries[name] = entries[name] || {};
      const n = val("pf-net", esc);
      if (n === "") delete rec.net; else rec.net = num(n);
      // Всички петъци: Седм. банка (b) + Седм. 005 (c) + Извънредни (o).
      const friClean = {};
      fridays.forEach(f => {
        const b = num(val("pf-frib", esc, f.iso)), c = num(val("pf-fric", esc, f.iso)), o = num(val("pf-frio", esc, f.iso));
        if (b || c || o) {
          friClean[f.iso] = { b, c, o };
          // i=1: извънредните на този петък са ВЪТРЕ в банка/005 (авто-разпределение).
          const bEl = v.querySelector(`.pf-frib[data-name="${esc}"][data-iso="${f.iso}"]`);
          if (bEl && bEl.dataset.inc === "1") friClean[f.iso].i = 1;
        }
      });
      if (Object.keys(friClean).length) rec.fri = friClean; else delete rec.fri;
      // РАЗЛИЧНИ (Сума + Бел.).
      const rzs = val("pf-rzsum", esc), rzn = val("pf-rznote", esc);
      const rzSum = rzs === "" ? 0 : num(rzs);
      if (rzSum || rzn) rec.rz = { sum: rzSum, note: rzn }; else delete rec.rz;
    });
    const ok = await erpPaySaveMonth(erpPayMonth, entries);
    if (typeof erpSaveCostCfg === "function") await erpSaveCostCfg();
    return ok;
  }

  v.querySelector("#pf-save-all").addEventListener("click", async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.dataset.lbl = btn.dataset.lbl || btn.textContent; btn.textContent = "Записва…";
    const ok = await payDoSaveAll();
    flash(btn, ok);
    const st = v.querySelector("#pf-save-status"); if (st) st.textContent = ok ? "✓ Запазено " + payNowHM() : "⚠ грешка при запис";
  });

  // Авто-запазване на всеки 2 минути, докато изгледът е отворен.
  if (payAutoTimer) { clearInterval(payAutoTimer); payAutoTimer = null; }
  payAutoTimer = setInterval(async () => {
    if (!document.body.contains(v) || !v.querySelector(".pf-table")) { clearInterval(payAutoTimer); payAutoTimer = null; return; }
    const ok = await payDoSaveAll();
    const st = v.querySelector("#pf-save-status"); if (st) st.textContent = ok ? "✓ Авто-запазено " + payNowHM() : "⚠ авто-запис: грешка";
  }, 120000);
}

function erpPayRoster() {
  // Офисът/управлението (office: true) се води през Ведомостта, не в петъчните заплати.
  const emps = (COST_CFG.employees || []).filter(e => !e.office);
  const byWs = {};
  emps.forEach(e => { (byWs[e.ws] = byWs[e.ws] || []).push(e); });
  return { byWs, order: Object.keys(byWs).sort((a, b) => a.localeCompare(b, "bg")) };
}

async function erpPayWeekView(v) {
  if (!erpPayMonday) erpPayMonday = payIso(payMondayOf());
  const mon = new Date(erpPayMonday + "T00:00:00");
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const entries = await erpPayLoadWeek(erpPayMonday);
  const { byWs, order } = erpPayRoster();

  const cell = (name, k, val) => `<input type="number" class="pay-in" data-name="${escapeAttr(name)}" data-f="${k}" step="any" value="${val != null && val !== "" ? escapeAttr(String(val)) : ""}" />`;
  const empRow = e => {
    const r = entries[e.name] || {};
    return `<tr data-row="${escapeAttr(e.name)}">
      <td>${escapeHtml(e.name)} <button class="btn btn-small pay-rm" data-name="${escapeAttr(e.name)}" title="Махни служителя">×</button></td>
      ${PAY_MONEY.map(c => { let val = r[c.k]; if (c.k === "nadnik" && (val == null || val === "")) val = e.nadnik; return `<td class="num">${cell(e.name, c.k, val)}</td>`; }).join("")}
      <td class="num">${cell(e.name, "days", r.days)}</td>
      <td class="num">${cell(e.name, "leave", r.leave)}</td>
      <td class="num pay-total" data-total="${escapeAttr(e.name)}">${payEur(payRowTotal(r))}</td>
      <td><input type="text" class="pay-note" data-name="${escapeAttr(e.name)}" value="${escapeAttr(r.note || "")}" /></td>
    </tr>`;
  };

  v.innerHTML = `
    <div class="erp-toolbar">
      <label class="erp-inline">Седмица (дата от седмицата) <input type="date" id="pay-date" value="${escapeAttr(erpPayMonday)}" /></label>
      ${payFindBox()}
      <span class="erp-count">Седмица ${payWeekNo(mon)} · ${payFmt(mon)} – ${payFmt(sun)}</span>
      <button class="btn btn-small" id="pay-add-emp">+ Добави служител</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pay-save">💾 Запази седмицата</button>
      <span class="save-status" id="pay-status"></span>
    </div>
    <div class="pay-scroll"><table class="report-table erp-table pay-table">
      <thead><tr><th>Служител</th>${PAY_MONEY.map(c => `<th class="num">${c.l}</th>`).join("")}<th class="num">Отраб. дни</th><th class="num">Отпуск (дни)</th><th class="num">Получено</th><th>Забележка</th></tr></thead>
      <tbody>
        ${order.map(ws => `<tr class="pay-ws"><td colspan="10"><b>${escapeHtml(ws)}</b></td></tr>` + byWs[ws].map(empRow).join("")).join("")}
      </tbody>
    </table></div>
    <p class="hint">Сумите са в евро. „Получено" = банка + в брой + надник + извънреден + бонус. Този отчет е за изплатеното (без осигуровки) — не влиза в себестойността.</p>`;

  v.querySelector("#pay-date").addEventListener("change", e => { erpPayMonday = payIso(payMondayOf(e.target.value)); erpPayWeekView(v); });
  const pwFind = v.querySelector("#pay-find"); if (pwFind) pwFind.addEventListener("input", e => { payFilter = e.target.value; payApplyFilter(v); });
  v.querySelector("#pay-add-emp").addEventListener("click", () => erpPayAddEmployee(v));
  v.querySelectorAll(".pay-rm").forEach(b => b.addEventListener("click", () => erpPayRemoveEmployee(b.dataset.name, v)));
  const recompute = name => {
    let t = 0;
    v.querySelectorAll(`.pay-in[data-name="${CSS.escape(name)}"]`).forEach(i => { if (PAY_MONEY.some(c => c.k === i.dataset.f)) t += Number(i.value) || 0; });
    const cellEl = v.querySelector(`.pay-total[data-total="${CSS.escape(name)}"]`); if (cellEl) cellEl.textContent = payEur(t);
  };
  v.querySelectorAll(".pay-in").forEach(i => i.addEventListener("input", () => recompute(i.dataset.name)));
  payApplyFilter(v);
  v.querySelector("#pay-save").addEventListener("click", async () => {
    const st = v.querySelector("#pay-status"); st.textContent = "Записва…";
    const ent = {};
    v.querySelectorAll(".pay-in").forEach(i => {
      const val = i.value.trim(); if (val === "") return;
      (ent[i.dataset.name] = ent[i.dataset.name] || {})[i.dataset.f] = Number(String(val).replace(",", ".")) || 0;
    });
    v.querySelectorAll(".pay-note").forEach(i => { const val = i.value.trim(); if (val) (ent[i.dataset.name] = ent[i.dataset.name] || {}).note = val; });
    // Надникът е ставка (заплата) — стои запаметен; при промяна се отбелязва (увеличение).
    let cfgChanged = false;
    (COST_CFG.employees || []).forEach(e => {
      const nv = Number((ent[e.name] || {}).nadnik) || 0;
      const prev = Number(e.nadnik) || 0;
      if (nv > 0 && nv !== prev) {
        if (prev > 0) { e.nadnikLog = e.nadnikLog || []; e.nadnikLog.push({ date: erpPayMonday, from: prev, to: nv }); }
        e.nadnik = nv; cfgChanged = true;
      }
    });
    const ok = await erpPaySaveWeek(erpPayMonday, ent);
    if (cfgChanged && typeof erpSaveCostCfg === "function") await erpSaveCostCfg();
    st.textContent = ok ? "✓ Записано" : "";
    setTimeout(() => { if (st) st.textContent = ""; }, 1500);
  });
}

// Добавя служител в общия списък (ползва се и от заплати, и от досие/себестойност).
function erpPayAddEmployee(v) {
  const wsSet = new Set([...(COST_CFG.prodWorkshops || []), ...((COST_CFG.employees || []).map(e => e.ws))]);
  const wsList = [...wsSet].filter(Boolean).sort((a, b) => a.localeCompare(b, "bg"));
  const { wrap, close } = erpDialog(`
    <h3>Добави служител</h3>
    <label>Име <input type="text" id="pe-name" placeholder="Име Фамилия" /></label>
    <label>Цех <input type="text" id="pe-ws" list="pe-ws-list" placeholder="избери или въведи" />
      <datalist id="pe-ws-list">${wsList.map(w => `<option value="${escapeAttr(w)}"></option>`).join("")}</datalist></label>
    <label>Заплата €/мес (по избор — за себестойността) <input type="number" id="pe-pay" step="any" /></label>
    <div class="erp-dialog-actions"><button class="btn" id="pe-cancel">Отказ</button><button class="btn btn-primary" id="pe-save">Добави</button></div>`);
  wrap.querySelector("#pe-cancel").addEventListener("click", close);
  wrap.querySelector("#pe-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#pe-name").value.trim();
    if (!name) { alert("Въведи име."); return; }
    const ws = wrap.querySelector("#pe-ws").value.trim();
    const pay = erpToNum(wrap.querySelector("#pe-pay").value) || 0;
    COST_CFG.employees = COST_CFG.employees || [];
    if (COST_CFG.employees.some(e => e.name === name)) { alert("Вече има служител с това име."); return; }
    COST_CFG.employees.push({ name, ws, pay });
    await erpSaveCostCfg();
    close(); erpPayRerender();
  });
}
async function erpPayRemoveEmployee(name, v) {
  if (!confirm(`Да махна ли "${name}" от списъка със служители? Историята на изплатеното остава непроменена.`)) return;
  COST_CFG.employees = (COST_CFG.employees || []).filter(e => e.name !== name);
  await erpSaveCostCfg();
  erpPayRerender();
}

/* Смята Месечния отчет за даден месец (седмични записи + „По петъци" + РАЗЛИЧНИ
   + осигуровките от ведомостта). ЕДИНСТВЕНИЯТ източник на истината за месеца —
   ползва се и от изгледа, и от синхронизацията на заплатите в Разходи и ставки. */
async function payComputeMonth(monthStr) {
  const rows = await erpPayAllWeeks();
  const [Y, M] = monthStr.split("-").map(Number);
  const weeks = rows.filter(r => {
    // Само истинските седмични записи (payroll_YYYY-MM-DD); payroll_m_* и payroll_osig_* се четат отделно.
    if (/^payroll_(m|osig)_/.test(String(r.id || ""))) return false;
    const mon = (r.data && r.data.monday) || String(r.id || "").replace("payroll_", "");
    const d = new Date(mon + "T00:00:00");
    return d.getFullYear() === Y && (d.getMonth() + 1) === M;
  });
  const tot = {};
  weeks.forEach(w => {
    const e = (w.data && w.data.entries) || {};
    Object.keys(e).forEach(name => {
      const r = e[name];
      const g = tot[name] || (tot[name] = { bank: 0, cash: 0, nadnik: 0, overtime: 0, bonus: 0, rz: 0 });
      PAY_MONEY.forEach(c => g[c.k] += Number(r[c.k]) || 0);
    });
  });
  // + Данните от „По петъци" (payroll_m_<месец>): банка → Банка, 005 → В брой, извънредни → Извънреден,
  //   РАЗЛИЧНИ → отделна колона. Двата източника се събират.
  const friEntries = await erpPayLoadMonth(monthStr);
  const fridays = payFridays(Y, M);
  let friHasData = false;
  Object.keys(friEntries || {}).forEach(name => {
    const r = friEntries[name] || {};
    const map = payFriNormalize(r, fridays);
    // oSep = извънредни, платени ОТДЕЛНО (пари в повече); oAll = всички
    // извънредни за показване — тези с i=1 са ВЕЧЕ вътре в банка/005.
    let b = 0, c = 0, oSep = 0, oAll = 0;
    fridays.forEach(f => { const x = map[f.iso] || {}; b += Number(x.b) || 0; c += Number(x.c) || 0; const oo = Number(x.o) || 0; oAll += oo; if (!x.i) oSep += oo; });
    const rz = Number((r.rz || {}).sum) || 0;
    if (!(b || c || oAll || rz)) return;
    friHasData = true;
    const g = tot[name] || (tot[name] = { bank: 0, cash: 0, nadnik: 0, overtime: 0, bonus: 0, rz: 0 });
    g.bank += b; g.cash += c; g.overtime += oSep; g.rz = (g.rz || 0) + rz;
    g.otAll = (g.otAll || 0) + oAll;
  });
  // Осигуровките от Ведомостта за заплати (разчетени с AI, пазени по месец).
  const osigRec = await erpPayLoadOsig(monthStr);
  const osigBy = (osigRec && osigRec.byName) || {};
  // ПРАВИЛО: човек със заплати, но БЕЗ ред във ведомостта, си стои в отчета
  // (осигуровките му са просто празни). И обратното: човек от ведомостта без
  // попълнени заплати този месец също се показва (сумите му са тирета).
  Object.keys(osigBy).forEach(name => { if (!tot[name]) tot[name] = { bank: 0, cash: 0, nadnik: 0, overtime: 0, bonus: 0, rz: 0 }; });
  return { weeks, friEntries, friHasData, tot, osigRec, osigBy };
}

// АБСОЛЮТНИЯТ тотал на служител за месеца: банка + 005 + надник + извънреден
// + бонус + различни + осигуровки. Това е пълният разход на фирмата за човека.
function payAbsTotal(g, osigBy, name) {
  return payRowTotal(g) + (Number(g.rz) || 0) + (Number((osigBy || {})[name]) || 0);
}

async function erpPayMonthView(v) {
  if (!erpPayMonth) { const d = new Date(); erpPayMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  const [Y, M] = erpPayMonth.split("-").map(Number);
  const { weeks, friEntries, friHasData, tot, osigRec, osigBy } = await payComputeMonth(erpPayMonth);
  const wsByName = {}, empByName = {}; (COST_CFG.employees || []).forEach(e => { wsByName[e.name] = e.ws; empByName[e.name] = e; });
  const osigSrc = (osigRec && osigRec.src) || "";
  const osigAt = (osigRec && osigRec.at) || "";

  const list = Object.keys(tot).map(name => ({ name, ws: wsByName[name] || ((osigRec.reportOnly || []).some(r => payNameKey(r) === payNameKey(name)) ? "— напуснал —" : ""), ...tot[name], total: payRowTotal(tot[name]) + (Number(tot[name].rz) || 0) }))
    .sort((a, b) => (a.ws || "").localeCompare(b.ws || "", "bg") || a.name.localeCompare(b.name, "bg"));
  const grand = list.reduce((s, r) => s + r.total, 0);
  // 🧪 Тестова ведомост (ако има) — отделна колона + сравнение, до „Приложи реално".
  const osigTestRec = await erpPayLoadOsigTest(erpPayMonth);
  const testBy = (osigTestRec && osigTestRec.byName) || {};
  const testNet = (osigTestRec && osigTestRec.netByName) || {};
  const hasTest = Object.keys(testBy).length > 0 || Object.keys(testNet).length > 0;

  // Филтри на месечния отчет: цех + конкретен служител + само с извънредни (данните са вече заредени — само пре-рисуване).
  let mWs = "", mEmp = "", mOt = false;
  const wsList = [...new Set(list.map(r => r.ws).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));

  const draw = () => {
    const q = (payFilter || "").trim().toLowerCase();
    // Показваните извънредни: ВСИЧКИ (otAll — вкл. платените през банката/005
    // при авто-разпределението); в „ОБЩО получено" влизат само отделно платените.
    const otShow = r => Number(r.otAll != null ? r.otAll : r.overtime) || 0;
    const shown = list.filter(r =>
      (!mWs || r.ws === mWs) &&
      (!mEmp || r.name === mEmp) &&
      (!mOt || otShow(r) > 0) &&
      (!q || r.name.toLowerCase().includes(q)));
    if (mOt) shown.sort((a, b) => otShow(b) - otShow(a));
    const sum = shown.reduce((s, r) => s + r.total, 0);
    const otSum = shown.reduce((s, r) => s + otShow(r), 0);
    const colSum = k => shown.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    const osigOf = name => Number((osigBy || {})[name]) || 0;
    const osigSum = shown.reduce((s, r) => s + osigOf(r.name), 0);
    // Само в падащото меню „Служител" — по азбучен ред (таблицата остава по цехове).
    const emps = list.filter(r => !mWs || r.ws === mWs).slice().sort((a, b) => a.name.localeCompare(b.name, "bg"));
    const one = mEmp ? shown[0] : null;
    const dash = n => Number(n) ? payEur(n) : `<span class="erp-muted">—</span>`;

    v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-inline" style="display:inline-flex;align-items:center;gap:6px">
        <button class="btn btn-small" id="pay-m-prev" title="Предишен месец">‹</button>
        <b style="min-width:150px;text-align:center;font-size:16px">${PAY_MONTHS[M - 1]} ${Y}</b>
        <button class="btn btn-small" id="pay-m-next" title="Следващ месец">›</button>
        <input type="month" id="pay-month" value="${escapeAttr(erpPayMonth)}" title="Скок към произволен месец" style="width:52px" />
      </span>
      <label class="erp-inline">Цех <select id="pay-ws-f"><option value="">— всички —</option>${wsList.map(w => `<option value="${escapeAttr(w)}" ${w === mWs ? "selected" : ""}>${escapeHtml(w)}</option>`).join("")}</select></label>
      <label class="erp-inline">Служител <select id="pay-emp-f"><option value="">— всички —</option>${emps.map(r => `<option value="${escapeAttr(r.name)}" ${r.name === mEmp ? "selected" : ""}>${escapeHtml(r.name)}</option>`).join("")}</select></label>
      <label class="erp-inline" title="Показва само служителите с извънредни за месеца, подредени от най-много надолу"><input type="checkbox" id="pay-ot-f" ${mOt ? "checked" : ""} /> ⏱ Само с извънредни</label>
      ${payFindBox()}
      <span class="erp-count">${PAY_MONTHS[M - 1]} ${Y} · ${weeks.length ? weeks.length + " седмици" : ""}${weeks.length && friHasData ? " + " : ""}${friHasData ? "петъчният отчет" : ""}${!weeks.length && !friHasData ? "няма данни" : ""} · ${shown.length} служители</span>
      <button class="btn btn-small" id="pay-osig" title="Качи Ведомостта за заплати (PDF/снимка/Excel) — Claude разчита осигуровките на всеки и ги попълва в колоната">🤖 Ведомост (осигуровки)</button>
      <button class="btn btn-small" id="pay-csv">⤓ Excel</button>
    </div>
    ${mOt ? `<div style="display:inline-block;background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:8px 16px;margin:2px 0 8px;font-size:16px">⏱ Извънредни за ${PAY_MONTHS[M - 1]} ${Y}${mWs ? ` · ${escapeHtml(mWs)}` : ""}: <b style="font-size:18px">${payEur(otSum)}</b> при ${shown.length} служители</div>` : ""}
    ${one ? `<div style="display:inline-block;background:#eef7ee;border:1px solid #bbe3bb;border-radius:10px;padding:8px 16px;margin:2px 0 8px;font-size:16px">💶 <b>${escapeHtml(one.name)}</b> (${escapeHtml(one.ws)}) е получил <b style="font-size:18px">${payEur(one.total)}</b> за ${PAY_MONTHS[M - 1]} ${Y} — ${[["банка", one.bank], ["005", one.cash], ["надник", one.nadnik], ["извънредни", otShow(one)], ["бонус", one.bonus], ["различни", one.rz]].filter(p => Number(p[1])).map(p => `${p[0]} ${payEur(p[1])}`).join(" · ") || "без разбивка"}</div>` : ""}
    ${weeks.length && friHasData ? `<p class="hint" style="color:#b45309"><b>⚠ Внимание:</b> този месец има данни И в седмичния изглед, И в „По петъци" — сборът по-долу ги СЪБИРА. Ако едните дублират другите, изтрий дубликата от съответния изглед.</p>` : ""}
    ${hasTest ? (() => {
      const tOs = Object.values(testBy).reduce((s, x) => s + (Number(x) || 0), 0);
      const tNet = Object.values(testNet).reduce((s, x) => s + (Number(x) || 0), 0);
      const tExtra = (osigTestRec.extra || []);
      const tExOs = tExtra.reduce((s, x) => s + (Number(x.osig) || 0), 0);
      const cmp = Object.keys(testNet).sort((a, b) => a.localeCompare(b, "bg")).map(n => {
        const cur = Number((friEntries[n] || {}).net) || 0, tv = Number(testNet[n]) || 0, d = tv - cur;
        return `<tr><td>${escapeHtml(n)}</td><td class="num">${payEur(tv)}</td><td class="num">${cur ? payEur(cur) : `<span class="erp-muted">—</span>`}</td><td class="num"><b style="color:${Math.abs(d) < 0.01 ? "#16a34a" : "#b91c1c"}">${Math.abs(d) < 0.01 ? "✓ съвпада" : (d > 0 ? "+" : "") + payEur(d)}</b></td></tr>`;
      }).join("");
      return `<div style="background:#fffbeb;border:2px solid #fcd34d;border-radius:12px;padding:12px 16px;margin:4px 0 10px;max-width:1290px">
        <div style="font-size:16px;font-weight:800">🧪 Тестова ведомост за ${escapeHtml(osigTestRec.vedMonth ? payYmLabel(osigTestRec.vedMonth) : "?")} (файл „${escapeHtml(osigTestRec.src || "")}") — нищо реално не е пипнато</div>
        <div style="margin:6px 0">Общо: чисто <b>${payEur(tNet)}</b> · осигуровки по цеховите служители <b>${payEur(tOs)}</b> (колоната „🧪 Тест" по-долу).</div>
        ${tExOs ? `<div style="margin:6px 0">➕ Извън списъка на цеховете (офис/управление): <b>${payEur(tExOs)}</b> — ${tExtra.map(x => escapeHtml(x.raw)).join(", ")}.<br>💶 <b>ВСИЧКО осигуровки+данък по ведомостта: ${payEur(tOs + tExOs)}</b> — това е числото за сверка с платежните към НАП (ДОО+ЗОВ+ДЗПО+ДОД).</div>` : ""}
        ${cmp ? `<details style="margin:6px 0"><summary style="cursor:pointer;font-weight:700">🔍 Сравнение: чисто от ведомостта ↔ сегашното ПО БАНКА (${Object.keys(testNet).length} души)</summary>
          <table class="report-table erp-table" style="margin-top:6px;max-width:820px"><thead><tr><th>Служител</th><th class="num">Ведомост (чисто)</th><th class="num">Сегашно ПО БАНКА</th><th class="num">Разлика</th></tr></thead><tbody>${cmp}</tbody></table></details>` : ""}
        <div style="margin-top:8px">
          <button class="btn btn-small btn-primary" id="po-apply">✅ Приложи реално (ПО БАНКА + Осигуровки)</button>
          <button class="btn btn-small" id="po-deltest">🗑 Махни теста</button>
        </div></div>`;
    })() : ""}
    <div style="max-width:1290px"><table class="report-table erp-table">
      <thead><tr><th>Служител</th><th>Цех</th>${PAY_MONEY.map(c => `<th class="num">${c.l}</th>`).join("")}<th class="num">Различни</th><th class="num" title="От Ведомостта за заплати (🤖 бутонът горе)">Осигуровки</th>${hasTest ? `<th class="num" style="background:#fffbeb">🧪 Тест</th>` : ""}<th class="num">ОБЩО получено</th></tr></thead>
      <tbody>
        ${shown.map(r => `<tr data-row="${escapeAttr(r.name)}">
          <td><b>${escapeHtml(r.name)}</b></td><td>${escapeHtml(r.ws)}</td>
          ${PAY_MONEY.map(c => {
            let extra = "";
            if (c.k === "nadnik") {
              const e = empByName[r.name] || {};
              const ch = (e.nadnikLog || []).filter(l => { const d = new Date((l.date || "") + "T00:00:00"); return d.getFullYear() === Y && (d.getMonth() + 1) === M; });
              if (ch.length) { const last = ch[ch.length - 1]; extra = ` <span class="pay-raise" title="Надникът е променен през месеца">⬆ ${payEur(last.from)}→${payEur(last.to)}</span>`; }
            }
            if (c.k === "overtime") {
              const all = otShow(r);
              const inBank = all - (Number(r.overtime) || 0);
              return `<td class="num">${dash(all)}${inBank > 0.004 ? ` <span class="erp-muted" style="font-size:10px" title="Платени през банката/005 — включени са в тези колони, не се броят втори път">↪ в банка/005</span>` : ""}</td>`;
            }
            return `<td class="num">${dash(r[c.k])}${extra}</td>`;
          }).join("")}
          <td class="num">${dash(r.rz)}</td>
          <td class="num">${dash(osigOf(r.name))}</td>
          ${hasTest ? `<td class="num" style="background:#fffbeb">${dash(testBy[r.name])}</td>` : ""}
          <td class="num"><b>${payEur(r.total)}</b></td></tr>`).join("") ||
          `<tr><td colspan="${hasTest ? 11 : 10}" class="report-empty">${list.length ? "Нищо не отговаря на филтъра." : "Няма попълнени данни за този месец — нито в седмичния изглед, нито в „По петъци“."}</td></tr>`}
        ${shown.length ? `<tr class="pr-total"><td colspan="2"><b>ОБЩО${mWs || mEmp || q || mOt ? " (по филтъра)" : " за месеца"}</b></td>
          ${PAY_MONEY.map(c => `<td class="num"><b>${dash(c.k === "overtime" ? otSum : colSum(c.k))}</b></td>`).join("")}
          <td class="num"><b>${dash(colSum("rz"))}</b></td>
          <td class="num"><b>${dash(osigSum)}</b></td>
          ${hasTest ? `<td class="num" style="background:#fffbeb"><b>${dash(shown.reduce((s, r) => s + (Number(testBy[r.name]) || 0), 0))}</b></td>` : ""}
          <td class="num"><b>${payEur(sum)}</b></td></tr>` : ""}
      </tbody>
    </table></div>
    <p class="hint">Сумира и седмичния изглед, и „🏦 По петъци" за избрания месец: петъчната „Седм. банка" влиза в <b>Банка</b>, „Седм. 005" — във <b>В брой (С005)</b>, „Извънредни" — в <b>Извънреден</b>, а „РАЗЛИЧНИ" — в колоната <b>Различни</b>. Филтрите по цех/служител смятат и „ОБЩО" само за показаното; Excel-ът сваля същото.${osigSrc ? (() => {
      const ex = (osigRec.extra || []); const exOs = ex.reduce((s, x) => s + (Number(x.osig) || 0), 0);
      const fullOs = Object.values(osigBy).reduce((s, x) => s + (Number(x) || 0), 0);
      return ` <br><b>Осигуровки:</b> от ведомостта за ${escapeHtml(osigRec.vedMonth ? payYmLabel(osigRec.vedMonth) : "предходния месец")} (файл „${escapeHtml(osigSrc)}"${osigAt ? `, разчетен ${new Date(osigAt).toLocaleDateString("bg-BG")}` : ""}) — плащат се през този месец и са изцяло за сметка на фирмата; не влизат в „ОБЩО получено".${exOs ? ` <b>➕ Извън списъка (офис/управление): ${payEur(exOs)}</b> (${ex.map(x => escapeHtml(x.raw)).join(", ")}) — всичко към НАП: <b>${payEur(fullOs + exOs)}</b>.` : ""}`;
    })() : ""}</p>`;

    const shiftMonth = dir => { const d = new Date(Y, M - 1 + dir, 1); erpPayMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; erpPayMonthView(v); };
    v.querySelector("#pay-m-prev").addEventListener("click", () => shiftMonth(-1));
    v.querySelector("#pay-m-next").addEventListener("click", () => shiftMonth(1));
    v.querySelector("#pay-month").addEventListener("change", e => { if (e.target.value) { erpPayMonth = e.target.value; erpPayMonthView(v); } });
    v.querySelector("#pay-ws-f").addEventListener("change", e => { mWs = e.target.value; if (mEmp && mWs && (wsByName[mEmp] || "") !== mWs) mEmp = ""; draw(); });
    v.querySelector("#pay-emp-f").addEventListener("change", e => { mEmp = e.target.value; draw(); });
    v.querySelector("#pay-ot-f").addEventListener("change", e => { mOt = e.target.checked; draw(); });
    v.querySelector("#pay-osig").addEventListener("click", () => {
      const allNames = [...new Set([...(COST_CFG.employees || []).map(e => e.name), ...list.map(r => r.name)])].filter(Boolean);
      erpPayOsigDialog(erpPayMonth, allNames, () => erpPayMonthView(v));
    });
    const applyBtn = v.querySelector("#po-apply");
    if (applyBtn) applyBtn.addEventListener("click", async () => {
      if (!confirm(`Прилагам тестовата ведомост РЕАЛНО за ${payYmLabel(erpPayMonth)}?\n• Осигуровките влизат в колоната „Осигуровки"\n• Чистото попълва „ПО БАНКА" в „По петъци"\n• Тестът се маха`)) return;
      applyBtn.disabled = true; applyBtn.textContent = "Прилагам…";
      const t = osigTestRec;
      const rec = await payOsigMaterialize({ byName: t.byName || {}, netByName: t.netByName || {}, extra: t.extra || [], reportOnly: t.reportOnly || [], src: t.src || "", at: new Date().toISOString(), month: erpPayMonth, vedMonth: t.vedMonth || "" });
      const ok1 = await erpPaySaveOsig(erpPayMonth, rec);
      let ok2 = true;
      if (ok1 && Object.keys(rec.netByName || {}).length) {
        const entries = await erpPayLoadMonth(erpPayMonth);
        // ПО БАНКА само за цеховите (офисните и напусналите не са в петъчната таблица).
        const skipKeys = new Set([...(COST_CFG.employees || []).filter(e => e.office).map(e => payNameKey(e.name)), ...(rec.reportOnly || []).map(payNameKey)]);
        payApplyNetsToMonth(entries, rec.netByName, skipKeys, erpPayMonth);
        ok2 = await erpPaySaveMonth(erpPayMonth, entries);
      }
      if (ok1 && ok2) { await erpPayDeleteOsigTest(erpPayMonth); erpPayMonthView(v); }
      else { applyBtn.disabled = false; applyBtn.textContent = "✅ Приложи реално (ПО БАНКА + Осигуровки)"; }
    });
    const delTestBtn = v.querySelector("#po-deltest");
    if (delTestBtn) delTestBtn.addEventListener("click", async () => {
      if (!confirm("Махам тестовата ведомост? (нищо реално не е било пипнато)")) return;
      await erpPayDeleteOsigTest(erpPayMonth);
      erpPayMonthView(v);
    });
    const pmFind = v.querySelector("#pay-find");
    if (pmFind) pmFind.addEventListener("change", e => { payFilter = e.target.value; draw(); });
    v.querySelector("#pay-csv").addEventListener("click", () => {
      const n = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const headers = [{ label: "Служител" }, { label: "Цех" }, ...PAY_MONEY.map(c => ({ label: c.l, num: true })), { label: "Различни", num: true }, { label: "Осигуровки", num: true }, { label: "ОБЩО получено", num: true }];
      const rows = shown.map(r => [r.name, r.ws, ...PAY_MONEY.map(c => n(c.k === "overtime" ? otShow(r) : r[c.k])), n(r.rz), n(osigOf(r.name)), n(r.total)]);
      rows.push(["ОБЩО", "", ...PAY_MONEY.map(c => n(c.k === "overtime" ? otSum : colSum(c.k))), n(colSum("rz")), n(osigSum), n(sum)]);
      reportExportXls(`zaplati-${erpPayMonth}${mWs ? "-" + mWs : ""}`, `Заплати · ${PAY_MONTHS[M - 1]} ${Y}${mWs ? " · " + mWs : ""}${mEmp ? " · " + mEmp : ""}`, [{ headers, rows }]);
    });
  };
  draw();
}

/* ---------- 🤖 Ведомост за заплати → ПО БАНКА + Осигуровки ----------
   ПРАВИЛАТА НА ДАНКО (27.09.2026):
   1) Работникът получава по банка ЧИСТОТО ЗА ВЗЕМАНЕ от ведомостта.
      ВСИЧКО останало (лични осигуровки, ДОД, осигуровки за сметка на
      работодателя) е разход на ФИРМАТА, без значение че по закон част
      се води „за сметка на служителя".
   2) Ведомостта е винаги ЕДИН МЕСЕЦ НАЗАД: ведомост за септември →
      сумите се изплащат през октомври. Затова записът отива в месеца
      СЛЕД месеца на ведомостта: осигуровките → payroll_osig_<плащане>,
      чистото → ПО БАНКА (net) в payroll_m_<плащане> („По петъци").
   Claude съпоставя хората ПО ТРИТЕ ИМЕНА (редът на думите е без
   значение); резултатът се преглежда и чак тогава се записва. */

function payMonthAdd(ym, delta) {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function payYmLabel(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return (PAY_MONTHS[m - 1] || ym) + " " + y;
}

async function erpPayLoadOsig(monthStr) {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "payroll_osig_" + monthStr).maybeSingle(); return (data && data.data) || {}; }
  catch (e) { return {}; }
}
async function erpPaySaveOsig(monthStr, rec) {
  const { error } = await sb.from("app_config").upsert({ id: "payroll_osig_" + monthStr, data: rec, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
// 🧪 Тестов режим: същото, но в отделен запис — не пипа нищо реално,
// докато Данко не натисне „Приложи реално" в Месечния отчет.
async function erpPayLoadOsigTest(monthStr) {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "payroll_osig_test_" + monthStr).maybeSingle(); return (data && data.data) || {}; }
  catch (e) { return {}; }
}
async function erpPaySaveOsigTest(monthStr, rec) {
  const { error } = await sb.from("app_config").upsert({ id: "payroll_osig_test_" + monthStr, data: rec, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
async function erpPayDeleteOsigTest(monthStr) {
  try { await sb.from("app_config").delete().eq("id", "payroll_osig_test_" + monthStr); } catch (e) {}
}

// Сбор от израз „192.74+251.16+25.30" (приема и десетични запетаи).
function payEvalSum(s) {
  return String(s).split("+").reduce((t, p) => t + (Number(String(p).trim().replace(",", ".")) || 0), 0);
}

// Ключ за съпоставяне по имена: малки букви, само буквите, думите сортирани —
// така „Иван Петров Георгиев" и „ГЕОРГИЕВ ИВАН ПЕТРОВ" дават един и същ ключ.
function payNameKey(s) {
  return String(s || "").toLowerCase().replace(/[^а-яёa-z\s]/gi, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}
// Търси служител по име от ведомостта: пълно съвпадение на ключа, после
// „всички думи от по-късото се съдържат в по-дългото" (само при ЕДИН кандидат).
function payOsigMatch(raw, names) {
  const k = payNameKey(raw);
  if (!k) return "";
  const exact = names.find(n => payNameKey(n) === k);
  if (exact) return exact;
  const kt = k.split(" ");
  const cands = names.filter(n => {
    const nt = payNameKey(n).split(" ");
    const short = kt.length <= nt.length ? kt : nt, long = kt.length <= nt.length ? nt : kt;
    return short.length >= 2 && short.every(t => long.includes(t));
  });
  return cands.length === 1 ? cands[0] : "";
}

// Схемата на отговора — насилваме я през tool (tool_choice). Това ИЗКЛЮЧВА
// разсъжденията на модела, които при многостранична ведомост изяждаха целия
// бюджет („празен текст, stop_reason: max_tokens, блокове: thinking").
const PAY_OSIG_TOOL = {
  name: "record_vedomost",
  description: "Записва извлечените от ведомостта суми по служители.",
  input_schema: {
    type: "object",
    properties: {
      matched: {
        type: "array",
        items: { type: "object", properties: {
          name: { type: "string", description: "ТОЧНОТО име от дадения списък на служителите." },
          net: { type: ["number", "null"], description: "„Получавана сума“ на лицето (чистото за вземане)." },
          osig: { type: ["number", "string", "null"], description: "Сборът ПО ФОРМУЛАТА от инструкцията — като низ със събираемите: \"192.74+251.16+25.30\" (системата ги сумира)." },
        }, required: ["name"] },
      },
      unmatched: {
        type: "array",
        items: { type: "object", properties: {
          raw: { type: "string", description: "Името, както е изписано във файла." },
          net: { type: ["number", "null"] },
          osig: { type: ["number", "string", "null"] },
        }, required: ["raw"] },
      },
      ved_month: { type: ["string", "null"], description: "Месецът ОТ ЗАГЛАВИЕТО на ведомостта („за месец август 2026 год.“ → \"2026-08\"), формат YYYY-MM." },
      totals: {
        type: "object",
        description: "От блока „Общо“ на ПОСЛЕДНАТА страница на ведомостта — за сверка.",
        properties: {
          net: { type: ["number", "null"], description: "Получавана сума — общо." },
          tax: { type: ["number", "null"], description: "Данък — общо." },
          osig: { type: ["number", "string", "null"], description: "Сборът по същата формула върху блока Общо — може като низ със събираемите." },
        },
      },
    },
    required: ["matched", "unmatched"],
  },
};

async function payOsigAI(content) {
  const cfg = window.DANKO_CONFIG || {};
  let token = cfg.SUPABASE_ANON_KEY;
  try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
  const system = `Ти четеш българска РАЗЧЕТНО-ПЛАТЕЖНА ВЕДОМОСТ (обикновено от програмата TROX РПВ), МНОГО страници — мини през ВСИЧКИ. Всяко лице е отделен блок с много полета. За ВСЕКИ служител извади ДВЕ числа:

(1) net = „Получавана сума" на лицето — чистото за вземане.

(2) osig = СБОРЪТ НА ВСИЧКИ ТЕЗИ ПОЛЕТА на лицето (правилото на фирмата: всичко извън чистото е разход на фирмата, и личните, и работодателските части):
• ДОО от осигурен + ДОО от осигурител
• ф. ТЗПБ — числото ДО реда „ф. ТЗПБ x%" (работодателска вноска, НЕ я пропускай)
• ДОО в/у СР от осигурен + ДОО в/у СР от осигурит
• ЗО от осигурен + ЗО от осигурител + ЗО вр нетр (осигурен и осигурител) + ЗО непл.отп. (осигурен и осигурител)
• ДЗПО-УПФ осигурен + ДЗПО-УПФ осигурит + ДЗПО в ППФ осигурит
• ФондГарант вземания + За Учителски ПФ
• Данък (ДОД)
Полета със стойност 0,00 просто не добавят нищо. НЕ пропускай работодателските части („от осигурител"/„осигурит") — те са отделни числа в блока! НЕ измисляй липсващи числа.

ПОДРЕДБАТА НА БЛОКА (TROX): всяко лице е правоъгълен блок с 4 двойни колони „етикет → число вдясно". Първата колона (За отраб. дни / За прос. време / Отпуска…) носи ДНИ и СУМИ ОТ ЗАПЛАТАТА — те НЕ влизат в osig; Брутна заплата също НЕ влиза. Числата за osig са само от изброените полета.

САМОПРОВЕРКА НА ВСЯКО ЛИЦЕ: „Общо удръжки" = личните вноски + Данък; „Получавана сума" = Брутна заплата − Общо удръжки. Ако твоите числа не пасват на тази сметка, препрочети блока.

СВЕРКА (задължителна): на последната страница има блок „Общо". Върни в totals: net = Получавана сума общо, tax = Данък общо, osig = сборът по СЪЩАТА формула върху блока Общо. Сборът на osig по хората ТРЯБВА да е близък до totals.osig — ако не е, ПРЕГЛЕДАЙ отново кое поле си пропуснал.

Съпоставяй хората с дадения СПИСЪК НА СЛУЖИТЕЛИТЕ по трите имена, БЕЗ да гледаш реда на думите (може да е Фамилия Име Презиме, с главни букви). Човек, когото не откриваш ЕДНОЗНАЧНО в списъка, отива в unmatched с името от файла.

ЗАДЪЛЖИТЕЛНО: извади и МЕСЕЦА от заглавието на ведомостта („РАЗЧЕТНО-ПЛАТЕЖНА ВЕДОМОСТ … за месец юни 2026 год." → ved_month: "2026-06").

ФОРМАТ (важно): matched и unmatched са ИСТИНСКИ JSON МАСИВИ ОТ ОБЕКТИ, НЕ низове/текст. Числата са с десетична ТОЧКА (1234.56), никога запетая. За osig НЕ смятай сбора наум — дай СЪБИРАЕМИТЕ като НИЗ В КАВИЧКИ: "osig": "192.74+251.16+25.30+73.60+110.40+50.60+64.40+2414.97" — системата ги сумира сама (така няма аритметични грешки). net е просто число. Извикай record_vedomost с резултата.`;
  let j = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/assistant", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      body: JSON.stringify({
        model: "claude-sonnet-5", max_tokens: 16000, system,
        tools: [PAY_OSIG_TOOL], tool_choice: { type: "tool", name: "record_vedomost" },
        messages: [{ role: "user", content }],
      }),
    });
    j = await res.json().catch(() => ({}));
    const err = j.error ? String(j.error) : (res.ok ? "" : "HTTP " + res.status);
    if (!err) break;
    if (/празен текст/i.test(err) && /thinking/i.test(err)) {
      // Старата версия на функцията не подава tools → мисленето пак изяжда бюджета.
      throw new Error(`Edge функцията „assistant" е стара версия. Данко: Supabase → Edge Functions → assistant → замени кода с новия от GitHub (supabase/functions/assistant/index.ts) → Deploy. После пробвай пак.`);
    }
    if (attempt < 3 && /overloaded|529|rate.?limit|too many|timeout/i.test(err)) { await new Promise(r => setTimeout(r, attempt * 5000)); continue; }
    throw new Error(/overloaded|529/i.test(err) ? "Claude е претоварен — изчакай минута и опитай пак." : err);
  }
  // Понякога моделът връща полетата като JSON ТЕКСТ вместо истински масиви —
  // при това с ДЕСЕТИЧНИ ЗАПЕТАИ в числата (123,45), което чупи JSON.parse.
  // Нормализираме всичко до масиви/обекти с няколко резервни опита.
  const tryParse = s => { try { return JSON.parse(s); } catch (e) { return undefined; } };
  const fixCommas = s => String(s).replace(/(\d),(\d)/g, "$1.$2");
  // Моделът често пише сбора като ИЗРАЗ (192.74+251.16+25.30) — невалиден JSON.
  // Смятаме израза предварително и го заместваме с готовото число.
  const fixExpr = s => String(s).replace(/:\s*([0-9][0-9.,\s]*(?:\+\s*[0-9][0-9.,\s]*)+)/g, (mm, ex) => ":" + (Math.round(payEvalSum(ex) * 100) / 100));
  const asArr = x => {
    if (Array.isArray(x)) return x;
    if (typeof x !== "string") return [];
    const s0 = x.replace(/```json|```/g, "").trim();
    const s = fixExpr(s0);
    for (const cand of [s, fixCommas(s)]) {
      let v = tryParse(cand);
      if (Array.isArray(v)) return v;
      if (v && typeof v === "object") return [v];
      const m2 = cand.match(/\[[\s\S]*\]/);
      if (m2) { v = tryParse(m2[0]); if (Array.isArray(v)) return v; }
    }
    // Последен опит: обект по обект.
    const objs = fixCommas(s).match(/\{[^{}]*\}/g) || [];
    const out = []; objs.forEach(o => { const v = tryParse(o); if (v) out.push(v); });
    return out;
  };
  const asObj = x => {
    if (x && typeof x === "object" && !Array.isArray(x)) return x;
    if (typeof x === "string") { const f = fixExpr(x); const v = tryParse(f) ?? tryParse(fixCommas(f)); return (v && typeof v === "object" && !Array.isArray(v)) ? v : null; }
    return null;
  };
  const norm = p => ({ matched: asArr(p.matched).map(asObj).filter(Boolean), unmatched: asArr(p.unmatched).map(asObj).filter(Boolean), totals: asObj(p.totals), ved_month: /^\d{4}-\d{2}$/.test(String(p.ved_month || "")) ? String(p.ved_month) : "" });
  const snippet = p => { try { const s = typeof p === "string" ? p : JSON.stringify(p); return String(s).slice(0, 500); } catch (e) { return ""; } };
  if (j.parsed && (j.parsed.matched || j.parsed.unmatched)) {
    const out = norm(j.parsed);
    out.__raw = snippet(j.parsed.matched);
    return out;
  }
  const txt = String(j.text || "").replace(/```json|```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude не върна валиден JSON: " + txt.slice(0, 200));
  const out = norm(tryParse(m[0]) || tryParse(fixCommas(m[0])) || {});
  out.__raw = txt.slice(0, 500);
  return out;
}

/* При РЕАЛЕН запис: хората „➕ добави" от ведомостта стават служители в
   Разходи и ставки (група „Офис / Управление", office: true — не влизат в
   петъчните заплати и в цеховите ставки). Заплатата им = чисто + осигуровки,
   сумите им минават в byName/netByName, за да се виждат и в Месечния отчет. */
async function payOsigMaterialize(rec) {
  const keep = [];
  let cfgChanged = false;
  (rec.extra || []).forEach(x => {
    if (!x.add) { keep.push(x); return; }
    const name = String(x.raw || "").trim();
    if (!name) return;
    const net = Number(x.net) || 0, os = Number(x.osig) || 0;
    if (os) rec.byName[name] = os;
    if (net) rec.netByName[name] = net;
    const total = Math.round((net + os) * 100) / 100;
    let emp = (COST_CFG.employees || []).find(e => payNameKey(e.name) === payNameKey(name));
    if (!emp) { (COST_CFG.employees = COST_CFG.employees || []).push({ name, ws: "Офис / Управление", office: true, pay: total, paySrc: rec.month }); cfgChanged = true; }
    else if (total > 0) { emp.pay = total; emp.paySrc = rec.month; if (emp.office == null && !emp.ws) { emp.ws = "Офис / Управление"; emp.office = true; } cfgChanged = true; }
  });
  rec.extra = keep;
  if (cfgChanged && typeof erpSaveCostCfg === "function") await erpSaveCostCfg();
  return rec;
}

function erpPayOsigDialog(monthStr, names, after) {
  // По подразбиране: предходният календарен месец (ведомостта излиза в началото на следващия).
  const now = new Date();
  let vedMonth = payMonthAdd(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, -1);
  const { wrap, close } = erpDialog(`
    <h3>🤖 Ведомост за заплати</h3>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:10px 14px;margin:0 0 10px;font-size:14px;line-height:1.6">
      <b>Правилата:</b><br>
      1) Работникът получава по банка <b>ЧИСТОТО за вземане</b> — то попълва автоматично „ПО БАНКА" в „🏦 По петъци".<br>
      2) <b>Всичко останало</b> (лични осигуровки + ДОД + осигуровки на работодателя) е <b>разход на фирмата</b> → колоната „Осигуровки".<br>
      3) Ведомостта е <b>един месец назад</b>: сумите влизат в СЛЕДВАЩИЯ месец, когато реално се плащат.
    </div>
    <label class="erp-inline">Ведомостта е за месец <input type="month" id="po-ved" value="${escapeAttr(vedMonth)}" /></label>
    <p id="po-flow" style="font-weight:700;margin:6px 0 10px"></p>
    <label class="erp-inline" style="display:block;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px;margin:0 0 10px">
      <input type="checkbox" id="po-test" checked /> 🧪 <b>Тестов режим</b> — резултатът отива в отделна колона „Тест" в Месечния отчет и НЕ пипа нито ПО БАНКА, нито Осигуровките. Като видиш, че всичко е наред → „✅ Приложи реално".
    </label>
    <label class="btn co-attach-btn" style="display:inline-block">⬆ Избери файл<input type="file" id="po-file" accept="application/pdf,image/*,.xlsx,.xls,.csv" hidden /></label>
    <span id="po-fname" class="erp-muted"></span>
    <p class="save-status" id="po-status"></p>
    <div class="erp-dialog-actions"><button class="btn" id="po-cancel">Отказ</button><button class="btn btn-primary" id="po-go" disabled>Разчети</button></div>`);
  let chosen = null;
  const st = wrap.querySelector("#po-status"), inp = wrap.querySelector("#po-file"), go = wrap.querySelector("#po-go");
  const flow = wrap.querySelector("#po-flow");
  const updFlow = () => { flow.textContent = `Ведомост за ${payYmLabel(vedMonth)} → ПО БАНКА и Осигуровки за ${payYmLabel(payMonthAdd(vedMonth, 1))} (месецът на плащане)`; };
  updFlow();
  // И „input", и „change" — при писане в month-полето някои браузъри пускат само „input".
  ["input", "change"].forEach(ev => wrap.querySelector("#po-ved").addEventListener(ev, e => { if (/^\d{4}-\d{2}$/.test(e.target.value || "")) { vedMonth = e.target.value; updFlow(); } }));
  inp.addEventListener("change", () => { chosen = inp.files && inp.files[0]; wrap.querySelector("#po-fname").textContent = chosen ? "  " + chosen.name : ""; go.disabled = !chosen; });
  wrap.querySelector("#po-cancel").addEventListener("click", close);
  go.addEventListener("click", async () => {
    if (!chosen) return;
    go.disabled = true; inp.disabled = true;
    try {
      const listTxt = "СПИСЪК НА СЛУЖИТЕЛИТЕ (точните имена в системата):\n" + names.join("\n");
      let content;
      if (/\.(xlsx|xls|csv)$/i.test(chosen.name)) {
        st.textContent = "Чета таблицата…";
        const buf = await chosen.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        let txt = "";
        wb.SheetNames.forEach(sn => { txt += "== ЛИСТ: " + sn + " ==\n" + XLSX.utils.sheet_to_csv(wb.Sheets[sn]) + "\n"; });
        if (txt.length > 150000) txt = txt.slice(0, 150000);
        content = listTxt + "\n\nВЕДОМОСТТА (CSV от Excel):\n" + txt;
      } else {
        st.textContent = "Качвам файла…";
        const path = "payroll/osig/" + Date.now() + "-" + safeName(chosen.name);
        const up = await sb.storage.from(BUCKET).upload(path, chosen);
        if (up.error) throw new Error("Качване: " + up.error.message);
        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        const blk = chosen.type === "application/pdf"
          ? { type: "document", source: { type: "url", url: pub.publicUrl } }
          : { type: "image", source: { type: "url", url: pub.publicUrl } };
        content = [blk, { type: "text", text: listTxt + "\n\nИзвлечи осигуровките от приложената ведомост и върни JSON." }];
      }
      st.textContent = "Claude разчита ведомостта…";
      const isTest = wrap.querySelector("#po-test").checked;
      const out = await payOsigAI(content);
      try { console.log("Ведомост AI резултат:", JSON.parse(JSON.stringify(out))); } catch (e2) {}
      const nMatched = (out.matched || []).length, nUnmatched = (out.unmatched || []).length;
      if (!nMatched && !nUnmatched) {
        st.textContent = "⚠ Claude върна данни в неочакван формат — виж прозореца и прати screenshot.";
        alert("Неочакван формат от Claude. Началото на суровия отговор:\n\n" + (out.__raw || "(празно)"));
        go.disabled = false; inp.disabled = false;
        return;
      }
      // Ръчният избор е основата; ако AI прочете ДРУГ месец в заглавието — пита.
      if (out.ved_month && out.ved_month !== vedMonth) {
        if (confirm(`В заглавието на ведомостта пише, че е за ${payYmLabel(out.ved_month)}, а ти си избрал ${payYmLabel(vedMonth)}.\n\nOK = ползвам месеца ОТ ФАЙЛА (${payYmLabel(out.ved_month)})\nОтказ = оставям твоя избор (${payYmLabel(vedMonth)})`)) vedMonth = out.ved_month;
      }
      close();
      // Прегледът е отделен прозорец — ако нещо в него гръмне, да се ВИДИ, а не да потъне.
      try {
        payOsigPreview(vedMonth, chosen.name, out.matched || [], out.unmatched || [], names, after, isTest, out.totals || null);
      } catch (e3) {
        alert("Грешка при показване на прегледа: " + (e3.message || e3) + "\n(разчетени: " + nMatched + " разпознати, " + nUnmatched + " неразпознати)");
      }
    } catch (e) {
      st.textContent = "⚠ " + (e.message || e);
      go.disabled = false; inp.disabled = false;
    }
  });
}

// Преглед преди запис: съвпадналите с редактируеми ЧИСТО и ОСИГУРОВКИ;
// несъвпадналите — с избор на служител. Записът отива в месеца НА ПЛАЩАНЕ.
function payOsigPreview(vedMonth, srcName, matched, unmatched, names, after, isTest, totals) {
  const payMonth = payMonthAdd(vedMonth, 1);
  // Мрежа за сигурност: пре-съпоставяме и връщането на AI (ако е върнал име извън списъка).
  const fixed = [], un = [];
  const numv = x => {
    if (typeof x === "string" && x.includes("+")) return Math.round(payEvalSum(x) * 100) / 100;
    return Number(typeof x === "string" ? x.replace(",", ".") : x) || 0;
  };
  if (totals) totals = { net: totals.net != null ? numv(totals.net) : null, tax: totals.tax != null ? numv(totals.tax) : null, osig: totals.osig != null ? numv(totals.osig) : null };
  (matched || []).forEach(m => {
    const hit = names.includes(m.name) ? m.name : payOsigMatch(m.name, names);
    if (hit) fixed.push({ name: hit, net: numv(m.net), osig: numv(m.osig) });
    else un.push({ raw: m.name, net: numv(m.net), osig: numv(m.osig) });
  });
  (unmatched || []).forEach(u => {
    const hit = payOsigMatch(u.raw, names);
    if (hit) fixed.push({ name: hit, net: numv(u.net), osig: numv(u.osig) });
    else un.push({ raw: u.raw, net: numv(u.net), osig: numv(u.osig) });
  });
  const netSum = fixed.reduce((s, f) => s + f.net, 0), osSum = fixed.reduce((s, f) => s + f.osig, 0);
  const opts = names.slice().sort((a, b) => a.localeCompare(b, "bg"));
  const { wrap, close } = erpDialog(`
    <h3>${isTest ? "🧪 ТЕСТ · " : ""}Провери: ведомост за ${escapeHtml(payYmLabel(vedMonth))}</h3>
    ${isTest
      ? `<p style="font-weight:700;margin:0 0 6px;color:#b45309">🧪 Тестов режим → отива САМО в колоната „Тест" на Месечния отчет за ${escapeHtml(payYmLabel(payMonth))}. Нищо реално не се пипа.</p>`
      : `<p style="font-weight:700;margin:0 0 6px">→ Записва се в <span style="color:#1d4ed8">${escapeHtml(payYmLabel(payMonth))}</span> (месецът на плащане): ЧИСТОТО → „ПО БАНКА" в По петъци · ОСИГУРОВКИТЕ → Месечния отчет.</p>`}
    <p class="hint" style="margin:0 0 6px">${fixed.length} разпознати${un.length ? " · " + un.length + " за ръчно посочване" : ""} — поправи каквото трябва и запази. Общо: чисто ${payEur(netSum)} · осигуровки+данък ${payEur(osSum)}.</p>
    ${totals ? (() => {
      const allOs = osSum + un.reduce((s, u) => s + (Number(u.osig) || 0), 0);
      const allNet = netSum + un.reduce((s, u) => s + (Number(u.net) || 0), 0);
      const chk = (mine, ved) => ved == null ? `<span class="erp-muted">няма във ведомостта</span>` : (Math.abs(mine - ved) <= 1 ? `<b style="color:#16a34a">✓ съвпада (${payEur(ved)})</b>` : `<b style="color:#b91c1c">⚠ ведомостта дава ${payEur(ved)} — разлика ${payEur(mine - ved)}</b>`);
      return `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:8px 12px;margin:0 0 8px;font-size:14px;line-height:1.6">
        <b>🔍 Сверка с блока „Общо" на ведомостта:</b><br>
        • Осигуровки+данък по хора: ${payEur(allOs)} ↔ ${chk(allOs, totals.osig)}<br>
        • Чисто по хора: ${payEur(allNet)} ↔ ${chk(allNet, totals.net)}<br>
        ${totals.tax != null ? `• Данък (ДОД) общо по ведомост: <b>${payEur(totals.tax)}</b> — свери с платежното „ДОД 10% ПЕРСОНАЛ" към НАП.` : ""}
      </div>`;
    })() : ""}
    <div style="max-height:52vh;overflow:auto">
    <table class="report-table erp-table"><thead><tr><th>Служител</th><th class="num">Чисто по банка (€)</th><th class="num">Осигуровки — за фирмата (€)</th></tr></thead><tbody>
      ${fixed.map(f => `<tr><td>${escapeHtml(f.name)}</td>
        <td class="num"><input type="number" step="any" class="po-net" data-name="${escapeAttr(f.name)}" value="${f.net}" style="width:110px" /></td>
        <td class="num"><input type="number" step="any" class="po-amt" data-name="${escapeAttr(f.name)}" value="${f.osig}" style="width:110px" /></td></tr>`).join("") || `<tr><td colspan="3" class="report-empty">Нищо не е разпознато.</td></tr>`}
    </tbody></table>
    ${un.length ? `<h4 class="erp-group-head">Неразпознати имена от файла</h4>
    <table class="report-table erp-table"><tbody>
      ${un.map((u, i) => `<tr><td>${escapeHtml(u.raw)} <span class="erp-muted">(чисто ${payEur(u.net)} · осиг. ${payEur(u.osig)})</span></td>
        <td><select class="po-un" data-i="${i}"><option value="__report__" selected>📊 Само в Месечния отчет (напуснал / без ред в заплатите)</option><option value="__add__">➕ Служител в Разходи и ставки (Офис / Управление)</option><option value="">— пропусни —</option>${opts.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table>` : ""}
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="po2-cancel">Отказ</button><button class="btn btn-primary" id="po2-save">${isTest ? "🧪 Запази като ТЕСТ" : "💾 Запази в " + escapeHtml(payYmLabel(payMonth))}</button><span class="save-status" id="po2-status"></span></div>`);
  wrap.querySelector("#po2-cancel").addEventListener("click", close);
  wrap.querySelector("#po2-save").addEventListener("click", async () => {
    const stt = wrap.querySelector("#po2-status"); stt.textContent = "Записва…";
    const byName = {}, netByName = {};
    const num = s => Number(String(s).replace(",", ".")) || 0;
    wrap.querySelectorAll(".po-amt").forEach(i => { const nv = num(i.value); if (nv) byName[i.dataset.name] = nv; });
    wrap.querySelectorAll(".po-net").forEach(i => { const nv = num(i.value); if (nv) netByName[i.dataset.name] = nv; });
    const extra = []; // хора от ведомостта ИЗВЪН списъка — с add: true се създават в Разходи и ставки при РЕАЛЕН запис
    const reportOnly = []; // напуснали: ред в Месечния отчет, но НЕ и в петъчните/Разходи и ставки
    wrap.querySelectorAll(".po-un").forEach(s => {
      const u = un[Number(s.dataset.i)];
      if (!u) return;
      const raw = String(u.raw || "").trim();
      if (s.value === "__report__") { if (numv(u.osig)) byName[raw] = numv(u.osig); if (numv(u.net)) netByName[raw] = numv(u.net); reportOnly.push(raw); }
      else if (s.value === "__add__") { if (numv(u.osig) || numv(u.net)) extra.push({ raw, net: numv(u.net), osig: numv(u.osig), add: true }); }
      else if (s.value) { if (numv(u.osig)) byName[s.value] = numv(u.osig); if (numv(u.net)) netByName[s.value] = numv(u.net); }
      else if (numv(u.osig) || numv(u.net)) extra.push({ raw, net: numv(u.net), osig: numv(u.osig) });
    });
    const nBy = Object.keys(byName).length, nNet = Object.keys(netByName).length;
    if (!nBy && !nNet) {
      stt.textContent = "";
      alert("⚠ Няма нищо за запис: всички суми са празни/0 и никой неразпознат не е посочен. Провери числата в таблицата.");
      return;
    }
    if (isTest) {
      // 🧪 Тест: отделен запис, нищо реално не се пипа.
      const ok = await erpPaySaveOsigTest(payMonth, { byName, netByName, extra, reportOnly, src: srcName, at: new Date().toISOString(), month: payMonth, vedMonth, test: true });
      // Сверка: прочети обратно записа — да сме СИГУРНИ, че е в базата.
      let backOk = false;
      if (ok) { try { const back = await erpPayLoadOsigTest(payMonth); backOk = Object.keys((back && back.byName) || {}).length > 0 || Object.keys((back && back.netByName) || {}).length > 0; } catch (e) {} }
      stt.textContent = ok ? "✓ Записано (тест)" : "";
      if (ok && backOk) setTimeout(() => { close(); erpPayMonth = payMonth; if (after) after(); alert(`🧪 Тестът е записан (${nBy} души с осигуровки, ${nNet} с чисто).\nОтчетът те прехвърли на ${payYmLabel(payMonth)} — жълтият банер и колоната „Тест" са там.\nАко всичко е наред → „✅ Приложи реално".`); }, 400);
      else if (ok && !backOk) alert("⚠ Записът мина, но при обратната проверка тестът излиза празен — прати screenshot на този прозорец.");
      return;
    }
    // 1) Осигуровките (+ чистото за справка) → payroll_osig_<месец на плащане>.
    //    „➕ добави"-хората стават служители в Разходи и ставки (Офис / Управление).
    const rec = await payOsigMaterialize({ byName, netByName, extra, reportOnly, src: srcName, at: new Date().toISOString(), month: payMonth, vedMonth });
    const ok1 = await erpPaySaveOsig(payMonth, rec);
    // 2) Чистото → ПО БАНКА (net) в „По петъци" + АВТО-РАЗПРЕДЕЛЕНИЕ по петъците
    //    (правилото на Данко). Само за цеховите — офисните (office) и
    //    напусналите (reportOnly) не са в петъчната таблица.
    let ok2 = true;
    if (ok1 && Object.keys(rec.netByName).length) {
      const entries = await erpPayLoadMonth(payMonth);
      const skipKeys = new Set([...(COST_CFG.employees || []).filter(e => e.office).map(e => payNameKey(e.name)), ...(rec.reportOnly || []).map(payNameKey)]);
      payApplyNetsToMonth(entries, rec.netByName, skipKeys, payMonth);
      ok2 = await erpPaySaveMonth(payMonth, entries);
    }
    stt.textContent = ok1 && ok2 ? "✓ Записано" : "";
    if (ok1 && ok2) setTimeout(() => { close(); erpPayMonth = payMonth; if (after) after(); alert(`Готово!\n• ПО БАНКА (чистото) е попълнено в „🏦 По петъци" за ${payYmLabel(payMonth)}.\n• Осигуровките са в Месечния отчет за ${payYmLabel(payMonth)} (отчетът те прехвърли там).`); }, 400);
  });
}

/* ---------- Сигурната връзка: Месечен отчет → заплатата в Разходи и ставки ----------
   Заплатата (pay) на служителя в Разходи и ставки / досието идва САМО оттук:
   АБСОЛЮТНИЯТ тотал (банка + 005 + надник + извънреден + бонус + различни +
   осигуровки) за последния месец с данни. Ръчно въвеждане няма. */
async function erpPaySyncSalaries() {
  const now = new Date();
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  for (let i = 1; i <= 3; i++) {
    const m = payMonthAdd(cur, -i);
    let data;
    try { data = await payComputeMonth(m); } catch (e) { continue; }
    if (!Object.keys(data.tot).length) continue;
    let changed = 0;
    const netBy = (data.osigRec && data.osigRec.netByName) || {};
    (COST_CFG.employees || []).forEach(e => {
      const g = data.tot[e.name];
      let t = 0;
      if (g) t = Math.round(payAbsTotal(g, data.osigBy, e.name) * 100) / 100;
      else {
        // Офис/управление: няма петъчни заплати — тоталът им е чисто + осигуровки от ведомостта.
        const n = Number(netBy[e.name]) || 0, o = Number((data.osigBy || {})[e.name]) || 0;
        if (n || o) t = Math.round((n + o) * 100) / 100;
      }
      if (!t) return; // няма данни за човека този месец — старата му заплата остава
      if (Math.abs((Number(e.pay) || 0) - t) >= 0.01) { e.pay = t; changed++; }
      e.paySrc = m;
    });
    if (changed) {
      // Тоталът ВКЛЮЧВА осигуровките → ставката не бива да ги начислява втори път.
      COST_CFG.params = COST_CFG.params || {};
      COST_CFG.params.salaryHasSocial = true;
      if (typeof erpSaveCostCfg === "function") await erpSaveCostCfg();
    }
    return { month: m, changed };
  }
  return { month: "", changed: 0 };
}
