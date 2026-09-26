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
    <button class="btn btn-small ${erpPayView === "week" ? "btn-primary" : ""}" id="pay-nav-w">🗓 Седмица (стар изглед)</button>
    <button class="btn btn-small ${erpPayView === "month" ? "btn-primary" : ""}" id="pay-nav-m">📅 Месечен отчет</button></div>`;
  v.innerHTML = nav + `<div id="pay-body"><p class="erp-loading">Зареждане…</p></div>`;
  v.querySelector("#pay-nav-f").addEventListener("click", () => { erpPayView = "fri"; erpRenderPayroll(v); });
  v.querySelector("#pay-nav-w").addEventListener("click", () => { erpPayView = "week"; erpRenderPayroll(v); });
  v.querySelector("#pay-nav-m").addEventListener("click", () => { erpPayView = "month"; erpRenderPayroll(v); });
  const body = v.querySelector("#pay-body");
  if (erpPayView === "month") await erpPayMonthView(body);
  else if (erpPayView === "week") await erpPayWeekView(body);
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
    fridays.forEach(f => { const x = fri[f.iso] || {}; map[f.iso] = { b: Number(x.b) || 0, c: Number(x.c) || 0, o: Number(x.o) || 0 }; });
    return map;
  }
  const bd = payFriBreakdown(r && r.net, fri, fridays);
  bd.rows.forEach(row => { map[row.iso] = { b: row.bank, c: row.code, o: (row.wo && row.wo.o) || 0 }; });
  return map;
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
      const x = friN[f.iso]; sumB += x.b; sumC += x.c; sumO += x.o;
      return `<td class="num pf-fricol">
        <div class="pf-fline"><span>Седм. банка</span>${inp("pf-frib", e.name, x.b, `data-iso="${f.iso}"`)}</div>
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
      <td class="num pf-netc">${inp("pf-net", e.name, r.net)}</td>
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
      <label class="erp-inline">Месец <input type="month" id="pf-month" value="${escapeAttr(erpPayMonth)}" /></label>
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
    <p class="hint"><b>ДНЕВНО</b> и <b>СЕДМИЧНО</b> са ставки на служителя — въвеждаш ги веднъж и се пренасят за всеки следващ месец. Всеки петък има три полета: <b>Седм. банка</b> (плащане по банка), <b>Седм. 005</b> (плащане по CODE 005) и <b>Извънредни</b>. Под тях се вижда разбивката 🏦 банка / 005 / Изв. Колоните <b>От банка</b> и <b>CODE 005</b> сумират съответните полета за месеца.<br>Отметката <b>„По банка"</b> под всеки петък (на реда на цеха) прехвърля цялата седмична сума на всички в цеха към <b>по банка</b>; махнеш ли я — към <b>005</b> (напр. служителят има пари по банка, но е болничен и се дава 005). После можеш да коригираш отделен служител ръчно.<br><b>ПО БАНКА</b> е ориентир (чистата сума за месеца) — ако „От банка" я надвиши, се оцветява. <b>РАЗЛИЧНИ</b> (Сума + Бел.) влиза в ОБЩО, но не в разбивката банка/005. Сумите са в евро.<br><b>Запазване:</b> „💾 ЗАПАЗИ" записва всичко; таблицата се <b>авто-запазва на всеки 2 минути</b>.<br><b>⤓ Excel (месеца)</b> сваля чиста таблица: Цех · Служител · <b>ПО БАНКА</b> · <b>CODE 005</b> · ОБЩО, с Данко най-отгоре и два сбора най-долу — без него и с него. Взема това, което е в таблицата в момента — и още незаписаното.</p>`;

  v.querySelector("#pf-month").addEventListener("change", e => { erpPayMonth = e.target.value; erpPayFridaysView(v); });
  const pfFind = v.querySelector("#pay-find"); if (pfFind) pfFind.addEventListener("input", e => { payFilter = e.target.value; payApplyFilter(v); });
  v.querySelector("#pf-add-emp").addEventListener("click", () => erpPayAddEmployee(v));
  v.querySelectorAll(".pf-rm").forEach(b => b.addEventListener("click", () => erpPayRemoveEmployee(b.dataset.name, v)));

  const friVal = (cls, esc, iso) => Number((v.querySelector(`.${cls}[data-name="${esc}"][data-iso="${iso}"]`) || {}).value) || 0;
  const recompute = name => {
    const esc = CSS.escape(name);
    const net = Number((v.querySelector(`.pf-net[data-name="${esc}"]`) || {}).value) || 0;
    let sumB = 0, sumC = 0, sumO = 0;
    fridays.forEach(f => {
      const b = friVal("pf-frib", esc, f.iso), c = friVal("pf-fric", esc, f.iso), o = friVal("pf-frio", esc, f.iso);
      sumB += b; sumC += c; sumO += o;
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
        perFri[f.iso].bank += b; perFri[f.iso].code += c; gBank += b; gCode += c; gO += o;
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
      fridays.forEach(f => { b += friVal("pf-frib", esc, f.iso); c += friVal("pf-fric", esc, f.iso); o += friVal("pf-frio", esc, f.iso); });
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
        if (b || c || o) friClean[f.iso] = { b, c, o };
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
  const emps = (COST_CFG.employees || []).slice();
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

async function erpPayMonthView(v) {
  if (!erpPayMonth) { const d = new Date(); erpPayMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  const rows = await erpPayAllWeeks();
  const [Y, M] = erpPayMonth.split("-").map(Number);
  const weeks = rows.filter(r => {
    const mon = (r.data && r.data.monday) || String(r.id || "").replace("payroll_", "");
    const d = new Date(mon + "T00:00:00");
    return d.getFullYear() === Y && (d.getMonth() + 1) === M;
  });
  const wsByName = {}, empByName = {}; (COST_CFG.employees || []).forEach(e => { wsByName[e.name] = e.ws; empByName[e.name] = e; });
  const tot = {};
  weeks.forEach(w => {
    const e = (w.data && w.data.entries) || {};
    Object.keys(e).forEach(name => {
      const r = e[name];
      const g = tot[name] || (tot[name] = { bank: 0, cash: 0, nadnik: 0, overtime: 0, bonus: 0 });
      PAY_MONEY.forEach(c => g[c.k] += Number(r[c.k]) || 0);
    });
  });
  const list = Object.keys(tot).map(name => ({ name, ws: wsByName[name] || "", ...tot[name], total: payRowTotal(tot[name]) }))
    .sort((a, b) => (a.ws || "").localeCompare(b.ws || "", "bg") || a.name.localeCompare(b.name, "bg"));
  const grand = list.reduce((s, r) => s + r.total, 0);

  v.innerHTML = `
    <div class="erp-toolbar">
      <label class="erp-inline">Месец <input type="month" id="pay-month" value="${escapeAttr(erpPayMonth)}" /></label>
      ${payFindBox()}
      <span class="erp-count">${PAY_MONTHS[M - 1]} ${Y} · ${weeks.length} седмици · ${list.length} служители</span>
      <span class="spacer"></span>
      <b>${payEur(grand)}</b>
      <button class="btn btn-small" id="pay-csv">⤓ Excel</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Служител</th><th>Цех</th>${PAY_MONEY.map(c => `<th class="num">${c.l}</th>`).join("")}<th class="num">ОБЩО получено</th></tr></thead>
      <tbody>
        ${list.map(r => `<tr data-row="${escapeAttr(r.name)}">
          <td><b>${escapeHtml(r.name)}</b></td><td>${escapeHtml(r.ws)}</td>
          ${PAY_MONEY.map(c => {
            let extra = "";
            if (c.k === "nadnik") {
              const e = empByName[r.name] || {};
              const ch = (e.nadnikLog || []).filter(l => { const d = new Date((l.date || "") + "T00:00:00"); return d.getFullYear() === Y && (d.getMonth() + 1) === M; });
              if (ch.length) { const last = ch[ch.length - 1]; extra = ` <span class="pay-raise" title="Надникът е променен през месеца">⬆ ${payEur(last.from)}→${payEur(last.to)}</span>`; }
            }
            return `<td class="num">${payEur(r[c.k])}${extra}</td>`;
          }).join("")}
          <td class="num"><b>${payEur(r.total)}</b></td></tr>`).join("") ||
          `<tr><td colspan="8" class="report-empty">Няма попълнени седмици за този месец.</td></tr>`}
        ${list.length ? `<tr class="pr-total"><td colspan="7"><b>ОБЩО за месеца</b></td><td class="num"><b>${payEur(grand)}</b></td></tr>` : ""}
      </tbody>
    </table>
    <p class="hint">Сумира всички попълнени седмици, чийто понеделник е в избрания месец.</p>`;

  v.querySelector("#pay-month").addEventListener("change", e => { erpPayMonth = e.target.value; erpPayMonthView(v); });
  const pmFind = v.querySelector("#pay-find"); if (pmFind) pmFind.addEventListener("input", e => { payFilter = e.target.value; payApplyFilter(v); });
  payApplyFilter(v);
  v.querySelector("#pay-csv").addEventListener("click", () => {
    const n = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const headers = [{ label: "Служител" }, { label: "Цех" }, ...PAY_MONEY.map(c => ({ label: c.l, num: true })), { label: "ОБЩО получено", num: true }];
    const rows = list.map(r => [r.name, r.ws, ...PAY_MONEY.map(c => n(r[c.k])), n(r.total)]);
    rows.push(["ОБЩО", "", ...PAY_MONEY.map(() => ""), n(grand)]);
    reportExportXls(`zaplati-${erpPayMonth}`, `Заплати · ${PAY_MONTHS[M - 1]} ${Y}`, [{ headers, rows }]);
  });
}
