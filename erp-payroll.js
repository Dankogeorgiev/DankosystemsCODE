/* Данко Системс — ЕРП „Заплати (седмично)".
   Място, където всяка седмица се попълва какво е получил всеки служител
   (банка, в брой/С005, надник, извънреден, бонус) + отработени дни и отпуск.
   Целта е месечен отчет: колко точно е взел всеки. Това е ОТЧЕТ на изплатеното
   (без осигуровки) — не участва в себестойността.
   Пази се в app_config (id=payroll_<понеделник>), без нов SQL. */

let erpPayView = "week";     // week | month
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
async function erpRenderPayroll(v) {
  await erpLoadCostCfg();
  const nav = `<div class="pr-row" style="margin-bottom:8px">
    <button class="btn btn-small ${erpPayView === "week" ? "btn-primary" : ""}" id="pay-nav-w">🗓 Седмица (попълване)</button>
    <button class="btn btn-small ${erpPayView === "month" ? "btn-primary" : ""}" id="pay-nav-m">📅 Месечен отчет</button></div>`;
  v.innerHTML = nav + `<div id="pay-body"><p class="erp-loading">Зареждане…</p></div>`;
  v.querySelector("#pay-nav-w").addEventListener("click", () => { erpPayView = "week"; erpRenderPayroll(v); });
  v.querySelector("#pay-nav-m").addEventListener("click", () => { erpPayView = "month"; erpRenderPayroll(v); });
  const body = v.querySelector("#pay-body");
  if (erpPayView === "month") await erpPayMonthView(body);
  else await erpPayWeekView(body);
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
      <td>${escapeHtml(e.name)}</td>
      ${PAY_MONEY.map(c => `<td class="num">${cell(e.name, c.k, r[c.k])}</td>`).join("")}
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
    const ok = await erpPaySaveWeek(erpPayMonday, ent);
    st.textContent = ok ? "✓ Записано" : "";
    setTimeout(() => { if (st) st.textContent = ""; }, 1500);
  });
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
  const wsByName = {}; (COST_CFG.employees || []).forEach(e => wsByName[e.name] = e.ws);
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
          ${PAY_MONEY.map(c => `<td class="num">${payEur(r[c.k])}</td>`).join("")}
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
