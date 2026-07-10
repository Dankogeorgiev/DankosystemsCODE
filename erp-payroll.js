/* Данко Системс — ЕРП „Заплати (седмично)".
   Място, където всяка седмица се попълва какво е получил всеки служител
   (банка, в брой/С005, надник, извънреден, бонус) + отработени дни и отпуск.
   Целта е месечен отчет: колко точно е взел всеки. Това е ОТЧЕТ на изплатеното
   (без осигуровки) — не участва в себестойността.
   Пази се в app_config (id=payroll_<понеделник>), без нов SQL. */

let erpPayView = "fri";      // fri | week | month
let erpPayMonday = "";
let erpPayMonth = "";
const PAY_MONEY = [{ k: "bank", l: "Банка" }, { k: "cash", l: "В брой (С005)" }, { k: "nadnik", l: "Надник" }, { k: "overtime", l: "Извънреден" }, { k: "bonus", l: "Бонус" }];
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

async function erpPayFridaysView(v) {
  if (!erpPayMonth) { const d = new Date(); erpPayMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  const [Y, M] = erpPayMonth.split("-").map(Number);
  const fridays = payFridays(Y, M);
  const entries = await erpPayLoadMonth(erpPayMonth);
  const { byWs, order } = erpPayRoster();

  const inp = (cls, name, val, extra) => `<input type="number" class="${cls}" data-name="${escapeAttr(name)}" ${extra || ""} step="any" value="${val != null && val !== "" ? escapeAttr(String(val)) : ""}" />`;
  const friBreak = (bank, code) => `🏦 ${payEur(bank)}<br>005 ${payEur(code)}`;
  const empRow = e => {
    const r = entries[e.name] || {};
    const fri = r.fri || {};
    const rz = r.rz || {};
    const rzSum = Number(rz.sum) || 0;
    const bd = payFriBreakdown(r.net, fri, fridays);
    const friCells = bd.rows.map(row => {
      const wo = row.wo;
      return `<td class="num pf-fricol">
        <div class="pf-fline"><span>Седм.</span>${inp("pf-friw", e.name, wo.w, `data-iso="${row.iso}"`)}</div>
        <div class="pf-fline"><span>Изв.</span>${inp("pf-frio", e.name, wo.o, `data-iso="${row.iso}"`)}</div>
        <div class="pf-fribd ${row.code > 0 ? "pf-over" : ""}" data-name="${escapeAttr(e.name)}" data-iso="${row.iso}">${friBreak(row.bank, row.code)}</div>
      </td>`;
    }).join("");
    return `<tr data-row="${escapeAttr(e.name)}">
      <td>${escapeHtml(e.name)} <button class="btn btn-small pf-rm" data-name="${escapeAttr(e.name)}" title="Махни служителя">×</button></td>
      <td class="num pf-dnc">${inp("pf-dnevno", e.name, e.dnevno)}</td>
      <td class="num pf-sec">${inp("pf-sedm", e.name, e.sedmichno)}</td>
      <td class="num pf-netc">${inp("pf-net", e.name, r.net)}</td>
      ${friCells}
      <td class="num pf-bank" data-bank="${escapeAttr(e.name)}">${payEur(bd.fromBank)}</td>
      <td class="num pf-code ${bd.code005 > 0 ? "pf-over" : ""}" data-code="${escapeAttr(e.name)}">${payEur(bd.code005)}</td>
      <td class="num pf-rzcol">
        <div class="pf-fline"><span>Сума</span><input type="number" class="pf-rzsum" data-name="${escapeAttr(e.name)}" step="any" value="${rz.sum != null && rz.sum !== "" ? escapeAttr(String(rz.sum)) : ""}" /></div>
        <div class="pf-fline"><span>Бел.</span><input type="text" class="pf-rznote" data-name="${escapeAttr(e.name)}" value="${escapeAttr(rz.note || "")}" /></div>
      </td>
      <td class="num pf-tot" data-tot="${escapeAttr(e.name)}"><b>${payEur(bd.sum + rzSum)}</b></td>
    </tr>`;
  };

  v.innerHTML = `
    <div class="erp-toolbar">
      <label class="erp-inline">Месец <input type="month" id="pf-month" value="${escapeAttr(erpPayMonth)}" /></label>
      <span class="erp-count">${PAY_MONTHS[M - 1]} ${Y} · ${fridays.length} петъка</span>
      <button class="btn btn-small" id="pf-add-emp">+ Добави служител</button>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pf-save-rates">💾 Запази ставки (Дневно/Седмично/По банка)</button>
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
        ${order.map(ws => `<tr class="pay-ws"><td colspan="${fridays.length + 8}"><b>${escapeHtml(ws)}</b></td></tr>` + byWs[ws].map(empRow).join("")).join("") ||
          `<tr><td colspan="${fridays.length + 8}" class="report-empty">Няма служители. Добави с бутона горе.</td></tr>`}
      </tbody>
      <tfoot><tr class="pf-foot">
        <td colspan="3"><b>ОБЩО (всички служители)</b></td>
        <td class="num"></td>
        ${fridays.map(f => `<td class="num pf-fcol">
          <div class="pf-ftot" data-iso="${f.iso}"></div>
          <button class="btn btn-small pf-save-fri" data-iso="${f.iso}">💾 Запази петъка</button>
        </td>`).join("")}
        <td class="num pf-bank" id="pf-gbank"></td>
        <td class="num pf-code" id="pf-gcode"></td>
        <td class="num pf-rz" id="pf-grz"></td>
        <td class="num pf-tot" id="pf-gtot"></td>
      </tr></tfoot>
    </table></div>
    <p class="hint"><b>ДНЕВНО</b> и <b>СЕДМИЧНО</b> са ставки на служителя — въвеждаш ги веднъж и се пренасят за всеки следващ месец (за нов месец попълваш само ПО БАНКА). Всеки петък има две полета: <b>Седм.</b> (седмично плащане) и <b>Изв.</b> (извънредни за тази седмица). Под тях се вижда колко от парите за петъка са <b>🏦 по банка</b> и колко по <b>005</b>. Долният ред <b>ОБЩО</b> показва за всеки петък сумарно за всички служители колко е по банка и колко по CODE 005. <b>ПО БАНКА</b> = чистата сума от ведомостта за месеца; докато я стигнеш, парите са по банка, над нея — CODE 005. Ако ПО БАНКА = 0, всичко влиза в CODE 005. Сумите са в евро.<br><b>РАЗЛИЧНИ</b> (преди ОБЩО) е за други плащания на служителя за месеца: <b>Сума</b> (влиза в ОБЩО) и <b>Бел.</b> (кратка забележка). Не влиза в разбивката по банка/005. <br><b>Запазване:</b> ставките (Дневно/Седмично/По банка) <b>и РАЗЛИЧНИ</b> се пазят с горния бутон „Запази ставки"; всеки петък се пази отделно с бутона „Запази петъка" под неговата колона.</p>`;

  v.querySelector("#pf-month").addEventListener("change", e => { erpPayMonth = e.target.value; erpPayFridaysView(v); });
  v.querySelector("#pf-add-emp").addEventListener("click", () => erpPayAddEmployee(v));
  v.querySelectorAll(".pf-rm").forEach(b => b.addEventListener("click", () => erpPayRemoveEmployee(b.dataset.name, v)));

  const recompute = name => {
    const esc = CSS.escape(name);
    const net = Number((v.querySelector(`.pf-net[data-name="${esc}"]`) || {}).value) || 0;
    const fri = {};
    v.querySelectorAll(`.pf-friw[data-name="${esc}"]`).forEach(i => { (fri[i.dataset.iso] = fri[i.dataset.iso] || {}).w = Number(i.value) || 0; });
    v.querySelectorAll(`.pf-frio[data-name="${esc}"]`).forEach(i => { (fri[i.dataset.iso] = fri[i.dataset.iso] || {}).o = Number(i.value) || 0; });
    const bd = payFriBreakdown(net, fri, fridays);
    bd.rows.forEach(row => {
      const el = v.querySelector(`.pf-fribd[data-name="${esc}"][data-iso="${row.iso}"]`);
      if (el) { el.innerHTML = `🏦 ${payEur(row.bank)}<br>005 ${payEur(row.code)}`; el.classList.toggle("pf-over", row.code > 0); }
    });
    const bk = v.querySelector(`.pf-bank[data-bank="${esc}"]`); if (bk) bk.textContent = payEur(bd.fromBank);
    const cd = v.querySelector(`.pf-code[data-code="${esc}"]`); if (cd) { cd.textContent = payEur(bd.code005); cd.classList.toggle("pf-over", bd.code005 > 0); }
    const rzSum = Number((v.querySelector(`.pf-rzsum[data-name="${esc}"]`) || {}).value) || 0;
    const tt = v.querySelector(`.pf-tot[data-tot="${esc}"]`); if (tt) tt.innerHTML = `<b>${payEur(bd.sum + rzSum)}</b>`;
  };
  // Долен ред: за всеки петък — общо по банка и общо по CODE 005 за всички служители.
  const recomputeFooter = () => {
    const perFri = {}; fridays.forEach(f => perFri[f.iso] = { bank: 0, code: 0 });
    let gBank = 0, gCode = 0;
    v.querySelectorAll("tr[data-row]").forEach(tr => {
      const esc = CSS.escape(tr.getAttribute("data-row"));
      const net = Number((v.querySelector(`.pf-net[data-name="${esc}"]`) || {}).value) || 0;
      const fri = {};
      v.querySelectorAll(`.pf-friw[data-name="${esc}"]`).forEach(i => { (fri[i.dataset.iso] = fri[i.dataset.iso] || {}).w = Number(i.value) || 0; });
      v.querySelectorAll(`.pf-frio[data-name="${esc}"]`).forEach(i => { (fri[i.dataset.iso] = fri[i.dataset.iso] || {}).o = Number(i.value) || 0; });
      const bd = payFriBreakdown(net, fri, fridays);
      bd.rows.forEach(row => { perFri[row.iso].bank += row.bank; perFri[row.iso].code += row.code; });
      gBank += bd.fromBank; gCode += bd.code005;
    });
    let gRz = 0;
    v.querySelectorAll(".pf-rzsum").forEach(i => { gRz += Number(i.value) || 0; });
    fridays.forEach(f => {
      const el = v.querySelector(`.pf-ftot[data-iso="${f.iso}"]`);
      if (el) { const t = perFri[f.iso]; el.innerHTML = `🏦 ${payEur(t.bank)}<br>005 ${payEur(t.code)}`; el.classList.toggle("pf-over", t.code > 0); }
    });
    const gb = v.querySelector("#pf-gbank"); if (gb) gb.innerHTML = `<b>${payEur(gBank)}</b>`;
    const gc = v.querySelector("#pf-gcode"); if (gc) gc.innerHTML = `<b>${payEur(gCode)}</b>`;
    const grz = v.querySelector("#pf-grz"); if (grz) grz.innerHTML = `<b>${payEur(gRz)}</b>`;
    const gt = v.querySelector("#pf-gtot"); if (gt) gt.innerHTML = `<b>${payEur(gBank + gCode + gRz)}</b>`;
  };
  v.querySelectorAll(".pf-net, .pf-friw, .pf-frio, .pf-rzsum").forEach(i => i.addEventListener("input", () => { recompute(i.dataset.name); recomputeFooter(); }));
  recomputeFooter();

  const num = x => Number(String(x).replace(",", ".")) || 0;
  const flash = (btn, ok) => {
    const old = btn.dataset.lbl || btn.textContent; btn.dataset.lbl = old;
    btn.textContent = ok ? "✓ Записано" : "Грешка"; btn.disabled = false;
    setTimeout(() => { btn.textContent = old; }, 1500);
  };
  const eachRow = fn => v.querySelectorAll("tr[data-row]").forEach(tr => fn(tr.getAttribute("data-row"), CSS.escape(tr.getAttribute("data-row"))));
  const val = (cls, esc, iso) => { const el = v.querySelector(`.${cls}[data-name="${esc}"]${iso ? `[data-iso="${iso}"]` : ""}`); return el ? el.value.trim() : ""; };

  // Запази ставки: ДНЕВНО/СЕДМИЧНО (при служителя) + ПО БАНКА (при месеца).
  v.querySelector("#pf-save-rates").addEventListener("click", async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.dataset.lbl = btn.dataset.lbl || btn.textContent; btn.textContent = "Записва…";
    const entries = await erpPayLoadMonth(erpPayMonth);
    eachRow((name, esc) => {
      const emp = (COST_CFG.employees || []).find(x => x.name === name);
      if (emp) { const d = val("pf-dnevno", esc), s = val("pf-sedm", esc); emp.dnevno = d === "" ? 0 : num(d); emp.sedmichno = s === "" ? 0 : num(s); }
      const n = val("pf-net", esc);
      const rec = entries[name] = entries[name] || {};
      if (n === "") delete rec.net; else rec.net = num(n);
      // РАЗЛИЧНИ (Сума + Бел.) — месечно, на служителя.
      const rzs = val("pf-rzsum", esc), rzn = val("pf-rznote", esc);
      const rzSum = rzs === "" ? 0 : num(rzs);
      if (rzSum || rzn) rec.rz = { sum: rzSum, note: rzn }; else delete rec.rz;
    });
    const ok = await erpPaySaveMonth(erpPayMonth, entries);
    if (typeof erpSaveCostCfg === "function") await erpSaveCostCfg();
    flash(btn, ok);
  });

  // Запази петъка: само колоната на този петък (седмично + извънредни) за всички служители.
  v.querySelectorAll(".pf-save-fri").forEach(b => b.addEventListener("click", async e => {
    const btn = e.currentTarget; const iso = btn.dataset.iso;
    btn.disabled = true; btn.dataset.lbl = btn.dataset.lbl || btn.textContent; btn.textContent = "Записва…";
    const entries = await erpPayLoadMonth(erpPayMonth);
    eachRow((name, esc) => {
      const w = val("pf-friw", esc, iso), o = val("pf-frio", esc, iso);
      const rec = entries[name] = entries[name] || {};
      const fr = rec.fri = rec.fri || {};
      const wn = w === "" ? 0 : num(w), on = o === "" ? 0 : num(o);
      if (wn || on) fr[iso] = { w: wn, o: on }; else delete fr[iso];
    });
    const ok = await erpPaySaveMonth(erpPayMonth, entries);
    flash(btn, ok);
  }));
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
    return `<tr>
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
  v.querySelector("#pay-add-emp").addEventListener("click", () => erpPayAddEmployee(v));
  v.querySelectorAll(".pay-rm").forEach(b => b.addEventListener("click", () => erpPayRemoveEmployee(b.dataset.name, v)));
  const recompute = name => {
    let t = 0;
    v.querySelectorAll(`.pay-in[data-name="${CSS.escape(name)}"]`).forEach(i => { if (PAY_MONEY.some(c => c.k === i.dataset.f)) t += Number(i.value) || 0; });
    const cellEl = v.querySelector(`.pay-total[data-total="${CSS.escape(name)}"]`); if (cellEl) cellEl.textContent = payEur(t);
  };
  v.querySelectorAll(".pay-in").forEach(i => i.addEventListener("input", () => recompute(i.dataset.name)));
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
      <span class="erp-count">${PAY_MONTHS[M - 1]} ${Y} · ${weeks.length} седмици · ${list.length} служители</span>
      <span class="spacer"></span>
      <b>${payEur(grand)}</b>
      <button class="btn btn-small" id="pay-csv">⤓ Excel</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Служител</th><th>Цех</th>${PAY_MONEY.map(c => `<th class="num">${c.l}</th>`).join("")}<th class="num">ОБЩО получено</th></tr></thead>
      <tbody>
        ${list.map(r => `<tr>
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
  v.querySelector("#pay-csv").addEventListener("click", () => {
    const esc = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
    const n = x => String(Math.round((Number(x) || 0) * 100) / 100).replace(".", ",");
    const lines = [["Служител", "Цех", ...PAY_MONEY.map(c => c.l), "ОБЩО получено"].map(esc).join(",")];
    list.forEach(r => lines.push([r.name, r.ws, ...PAY_MONEY.map(c => n(r[c.k])), n(r.total)].map(esc).join(",")));
    lines.push(["ОБЩО", "", ...PAY_MONEY.map(() => ""), n(grand)].map(esc).join(","));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `zaplati-${erpPayMonth}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
