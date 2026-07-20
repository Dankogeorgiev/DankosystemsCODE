/* Данко Системс — „Отпуски".
   Служителят (от своя цех) натиска „🏖 Поискай отпуск" и попълва молба по
   бланката на фирмата (чл. 155, ал. 1 КТ). Искането отива в Финанси → Отпуски,
   където офисът я преглежда, натиска „Одобрявам", принтира я 1:1 по бланката
   и я носи за подпис. Календар показва отпуските на всички. Има и ръчно
   вкарване на вече одобрени отпуски.
   Пази се в app_config id="leaves": { list:[ {id, name, egn, address, position,
   workshop, days, from, to, status: чакаща|одобрена, requestedAt, approvedAt} ] }.
   Ползва erpDialog/escapeHtml/escapeAttr, глобалния sb; invBgWords за словом. */

let LEAVES = null;
let leaveCalMonth = null;   // "YYYY-MM" на показвания месец в календара

async function leavesLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "leaves").maybeSingle(); LEAVES = (data && data.data && data.data.list) || []; }
  catch (e) { LEAVES = []; }
}
async function leavesSave() {
  const { error } = await sb.from("app_config").upsert({ id: "leaves", data: { list: LEAVES || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message + (/row-level security|violates/i.test(error.message || "") ? "\n\nПусни app-config-rls-fix.sql в Supabase." : "")); return false; }
  return true;
}
function leaveNextId() { let m = 0; (LEAVES || []).forEach(p => { const n = Number(p.id) || 0; if (n > m) m = n; }); return m + 1; }
function leaveFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }
// Работни дни между две дати включително (без събота/неделя).
function leaveWorkDays(from, to) {
  if (!from || !to) return 0;
  const a = new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00");
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  let n = 0;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/* ---------- Молбата (форма) — за служител и за ръчно вкарване ---------- */
function leaveRequestDialog(opts) {
  opts = opts || {};
  const admin = !!opts.adminEntry;   // ръчно вкарване на вече одобрен отпуск
  const editRec = opts.edit || null; // редакция на съществуваща молба (преди печат)
  const ws = (typeof MY_ACCESS !== "undefined" && (MY_ACCESS.workshop || (MY_ACCESS.workshops || [])[0])) || "";
  const V = (f, d) => escapeAttr(String((editRec && editRec[f] != null ? editRec[f] : d) || ""));
  const { wrap, close } = erpDialog(`
    <h3>${editRec ? "✎ Поправка на молбата" : admin ? "🏖 Вкарай одобрен отпуск" : "🏖 Молба за платен отпуск"}</h3>
    <p class="hint" style="margin:0 0 8px">${editRec ? "Допълни/поправи данните преди печата — служителят не винаги ги попълва всичките." : admin ? "За отпуски, разрешени преди системата — влизат директно като одобрени." : "Попълни молбата — както на хартиената бланка. Ние ще я разгледаме и ще се свържем с теб."}</p>
    <label>Трите имена <input type="text" id="lv-name" value="${V("name")}" placeholder="Иван Иванов Иванов" /></label>
    <div class="erp-co-grid">
      <label>ЕГН <input type="text" id="lv-egn" inputmode="numeric" maxlength="10" value="${V("egn")}" placeholder="(за молбата)" /></label>
      <label>Длъжност <input type="text" id="lv-pos" value="${V("position")}" placeholder="напр. оператор" /></label>
    </div>
    <label>Живущ в <input type="text" id="lv-addr" value="${V("address")}" placeholder="гр./с. …, ул. …" /></label>
    <div class="erp-co-grid">
      <label>От дата <input type="date" id="lv-from" value="${V("from")}" /></label>
      <label>До дата (включително) <input type="date" id="lv-to" value="${V("to")}" /></label>
    </div>
    <label>Работни дни <input type="number" id="lv-days" min="1" step="1" value="${V("days")}" placeholder="смята се само" /></label>
    <p class="erp-muted" id="lv-calc" style="margin:4px 0 0"></p>
    <div class="erp-dialog-actions"><button class="btn" id="lv-cancel">Отказ</button><button class="btn btn-primary" id="lv-send">${editRec ? "💾 Запази поправките" : admin ? "💾 Запиши като одобрен" : "📨 Поискай отпуск"}</button></div>`);
  const calc = () => {
    const f = wrap.querySelector("#lv-from").value, t = wrap.querySelector("#lv-to").value;
    const wd = leaveWorkDays(f, t);
    const el = wrap.querySelector("#lv-days");
    if (wd > 0 && !el.dataset.manual) el.value = wd;
    wrap.querySelector("#lv-calc").textContent = wd > 0 ? `Изчислени работни дни (без събота/неделя): ${wd}` : "";
  };
  wrap.querySelector("#lv-from").addEventListener("change", calc);
  wrap.querySelector("#lv-to").addEventListener("change", calc);
  wrap.querySelector("#lv-days").addEventListener("input", e => e.target.dataset.manual = "1");
  wrap.querySelector("#lv-cancel").addEventListener("click", close);
  wrap.querySelector("#lv-send").addEventListener("click", async () => {
    const g = id => (wrap.querySelector("#" + id).value || "").trim();
    const name = g("lv-name"), from = g("lv-from"), to = g("lv-to");
    const days = Number(g("lv-days")) || leaveWorkDays(from, to);
    if (!name) { alert("Въведи трите имена."); return; }
    if (!from || !to) { alert("Избери от коя до коя дата."); return; }
    if (to < from) { alert("Крайната дата е преди началната."); return; }
    if (!(days > 0)) { alert("Въведи брой работни дни."); return; }
    const btn = wrap.querySelector("#lv-send"); btn.disabled = true; btn.textContent = "Записвам…";
    await leavesLoad();
    if (editRec) {
      const ex = (LEAVES || []).find(x => x.id === editRec.id);
      if (ex) Object.assign(ex, { name, egn: g("lv-egn"), address: g("lv-addr"), position: g("lv-pos"), from, to, days });
    } else {
      LEAVES.push({
        id: leaveNextId(), name, egn: g("lv-egn"), address: g("lv-addr"), position: g("lv-pos"),
        workshop: ws, from, to, days,
        status: admin ? "одобрена" : "чакаща",
        requestedAt: new Date().toISOString().slice(0, 10),
        approvedAt: admin ? new Date().toISOString().slice(0, 10) : "",
      });
    }
    if (await leavesSave()) {
      close();
      if (editRec || admin) { if (typeof erpRenderFinance === "function") erpRenderFinance(); }
      else alert("✅ Вашето искане е прието, ще се свържем с вас за потвърждение.");
    } else { btn.disabled = false; btn.textContent = editRec ? "💾 Запази поправките" : admin ? "💾 Запиши като одобрен" : "📨 Поискай отпуск"; }
  });
}

/* ---------- Печат на молбата (1:1 по бланката) ---------- */
function leavePrint(r) {
  const dots = n => ".".repeat(n);
  const words = (typeof invBgWords === "function") ? invBgWords(r.days) : "";
  const val = (v, n) => v ? `<u>&nbsp;${escapeHtml(v)}&nbsp;</u>` : dots(n);
  const yFrom = String(r.from || "").slice(0, 4) || "2026";
  const yTo = String(r.to || "").slice(0, 4) || "2026";
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Молба за отпуск — ${escapeHtml(r.name || "")}</title>
  <style>
    body { font-family: "Times New Roman", serif; font-size: 14pt; color: #000; margin: 28mm 22mm; line-height: 1.7; }
    .to { margin-left: 55%; }
    h1 { text-align: center; font-size: 18pt; letter-spacing: 6px; margin: 34px 0 22px; font-weight: bold; }
    .body-txt { text-align: justify; }
    u { text-decoration: none; border-bottom: 1px dotted #000; padding: 0 4px; }
    .sign { display: flex; justify-content: space-between; margin-top: 60px; }
    @media print { .noprint { display: none } }
    .noprint { text-align: center; margin-bottom: 16px; }
    .btnp { background: #0f766e; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; font-family: Arial; }
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <div class="to">ДО<br>г-н Георгиев<br>Управител на „Данко Системс" ООД<br>гр. Пловдив</div>
    <h1>М О Л Б А</h1>
    <p>от ${val(r.name, 80)},</p>
    <p>ЕГН ${val(r.egn, 40)},</p>
    <p>живущ в ${val(r.address, 70)}</p>
    <p>на длъжност ${val(r.position, 55)}</p>
    <p style="margin-top:26px">Г-н Управител,</p>
    <p class="body-txt">На основание чл. 155, ал. 1 от Кодекса на труда, моля да ми разрешите да ползвам платен отпуск
    в размер на <u>&nbsp;${escapeHtml(String(r.days || ""))}&nbsp;</u> /${words ? `<u>&nbsp;${escapeHtml(words)}&nbsp;</u>` : dots(34)}/ работни дни,
    считано от <u>&nbsp;${escapeHtml(leaveFmt(r.from).slice(0, 6))}&nbsp;</u>${escapeHtml(yFrom)} до <u>&nbsp;${escapeHtml(leaveFmt(r.to).slice(0, 6))}&nbsp;</u>${escapeHtml(yTo)} г.</p>
    <div class="sign">
      <span>гр. Пловдив<br>Дата: ${escapeHtml(leaveFmt(r.requestedAt) || dots(20))}</span>
      <span>С уважение: ${dots(33)}</span>
    </div>
  </body></html>`;
  const w = window.open("", "_blank"); if (!w) { alert("Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

/* ---------- Офис изглед (Финанси → Отпуски) ---------- */
async function erpRenderLeaves(v) {
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await leavesLoad();
  if (!leaveCalMonth) leaveCalMonth = new Date().toISOString().slice(0, 7);
  const pending = (LEAVES || []).filter(l => l.status === "чакаща").sort((a, b) => String(a.from).localeCompare(b.from));
  const approved = (LEAVES || []).filter(l => l.status === "одобрена").sort((a, b) => String(b.from).localeCompare(a.from));

  const row = (l, isPending) => `<tr>
    <td data-label="Служител"><b>${escapeHtml(l.name || "")}</b>${l.workshop ? ` <span class="erp-muted">· ${escapeHtml(l.workshop)}</span>` : ""}</td>
    <td data-label="От">${leaveFmt(l.from)}</td>
    <td data-label="До">${leaveFmt(l.to)}</td>
    <td class="num" data-label="Раб. дни">${l.days || ""}</td>
    <td data-label="Подадена">${leaveFmt(l.requestedAt)}</td>
    <td class="erp-row-actions">
      ${isPending ? `<button class="btn btn-small btn-primary" data-approve="${l.id}">✓ Одобрявам</button>` : ""}
      <button class="btn btn-small" data-edit="${l.id}" title="Поправи/допълни молбата (напр. ЕГН, адрес) преди печата">✎ Поправи</button>
      <button class="btn btn-small" data-print="${l.id}" title="Принтирай молбата по бланката">🖨</button>
      <button class="btn btn-small btn-danger" data-del="${l.id}" title="Изтрий">×</button>
    </td></tr>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">🏖 Отпуски — ${pending.length} чакащи · ${approved.length} одобрени</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="lv-new-approved">+ Вкарай одобрен отпуск</button>
      <button class="btn btn-small btn-primary" id="lv-new-req">🏖 Нова молба</button>
    </div>
    ${pending.length ? `<h4 class="erp-group-head">⏳ Чакащи одобрение (${pending.length})</h4>
    <table class="report-table erp-table"><thead><tr><th>Служител</th><th>От</th><th>До</th><th class="num">Раб. дни</th><th>Подадена</th><th></th></tr></thead>
      <tbody>${pending.map(l => row(l, true)).join("")}</tbody></table>` : `<p class="hint">Няма чакащи молби за отпуск.</p>`}
    <h4 class="erp-group-head">📅 Календар на отпуските</h4>
    <div class="erp-toolbar" style="margin-bottom:4px">
      <button class="btn btn-small" id="lv-cal-prev">‹</button>
      <b id="lv-cal-title" style="min-width:150px;text-align:center"></b>
      <button class="btn btn-small" id="lv-cal-next">›</button>
      <span class="erp-muted" style="margin-left:10px">🟩 одобрен · 🟨 чакащ</span>
    </div>
    <div id="lv-cal"></div>
    <h4 class="erp-group-head">✓ Одобрени (${approved.length})</h4>
    ${approved.length ? `<table class="report-table erp-table"><thead><tr><th>Служител</th><th>От</th><th>До</th><th class="num">Раб. дни</th><th>Подадена</th><th></th></tr></thead>
      <tbody>${approved.map(l => row(l, false)).join("")}</tbody></table>` : `<p class="hint">Още няма одобрени отпуски.</p>`}`;

  document.getElementById("lv-new-req").addEventListener("click", () => leaveRequestDialog({}));
  document.getElementById("lv-new-approved").addEventListener("click", () => leaveRequestDialog({ adminEntry: true }));
  v.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.approve)); if (!l) return;
    l.status = "одобрена"; l.approvedAt = new Date().toISOString().slice(0, 10);
    if (await leavesSave()) { erpRenderLeaves(v); leavePrint(l); }
  }));
  v.querySelectorAll("[data-print]").forEach(b => b.addEventListener("click", () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.print)); if (l) leavePrint(l);
  }));
  v.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.edit)); if (l) leaveRequestDialog({ edit: l });
  }));
  v.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.del)); if (!l) return;
    if (!confirm(`Да изтрия ли отпуска на ${l.name} (${leaveFmt(l.from)} – ${leaveFmt(l.to)})?`)) return;
    LEAVES = LEAVES.filter(x => x.id !== l.id);
    if (await leavesSave()) erpRenderLeaves(v);
  }));
  const cal = () => leaveRenderCalendar(document.getElementById("lv-cal"), document.getElementById("lv-cal-title"));
  document.getElementById("lv-cal-prev").addEventListener("click", () => { leaveCalMonth = leaveShiftMonth(leaveCalMonth, -1); cal(); });
  document.getElementById("lv-cal-next").addEventListener("click", () => { leaveCalMonth = leaveShiftMonth(leaveCalMonth, 1); cal(); });
  cal();
}
function leaveShiftMonth(ym, d) {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(y, m - 1 + d, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
// ISO номер на седмицата (европейски стандарт — седмицата започва в понеделник).
function leaveWeekNo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round((d - firstThu) / 6048e5);
}
// Месечен календар: ред = седмица (с номер), колони = Понеделник…Неделя (BG).
function leaveRenderCalendar(box, titleEl) {
  if (!box) return;
  const [y, m] = leaveCalMonth.split("-").map(Number);
  const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
  if (titleEl) titleEl.textContent = MONTHS[m - 1] + " " + y;
  const first = new Date(y, m - 1, 1), daysIn = new Date(y, m, 0).getDate();
  const startCol = (first.getDay() + 6) % 7;   // понеделник = 0
  const today = new Date().toISOString().slice(0, 10);
  const dayISO = d => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const onLeave = iso => (LEAVES || []).filter(l => l.from && l.to && l.from <= iso && iso <= l.to && l.status !== "отказана");
  const DOW = ["Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота", "Неделя"];
  const DOW_S = ["пон", "вто", "сря", "чет", "пет", "съб", "нед"];
  let cells = `<div class="lv-wk lv-head" title="Номер на седмицата в годината">седм.</div>`
    + DOW.map((d, i) => `<div class="lv-head">${d}<span class="lv-head-s">${DOW_S[i]}</span></div>`).join("");
  let col = 0;
  const weekCell = day => `<div class="lv-wk" title="Седмица ${leaveWeekNo(new Date(y, m - 1, day))} от годината">${leaveWeekNo(new Date(y, m - 1, day))}</div>`;
  cells += weekCell(1);
  for (let i = 0; i < startCol; i++) { cells += `<div class="lv-cell lv-empty"></div>`; col++; }
  for (let d = 1; d <= daysIn; d++) {
    if (col === 7) { col = 0; cells += weekCell(d); }
    const iso = dayISO(d);
    const dow = new Date(y, m - 1, d).getDay();
    const we = dow === 0 || dow === 6;
    const ppl = onLeave(iso);
    cells += `<div class="lv-cell ${we ? "lv-we" : ""} ${iso === today ? "lv-today" : ""}">
      <div class="lv-day">${d} <span class="lv-day-dow">${DOW_S[(dow + 6) % 7]}</span>${iso === today ? '<span class="lv-today-lbl">днес</span>' : ""}</div>
      ${ppl.map(l => `<div class="lv-chip ${l.status === "одобрена" ? "lv-ok" : "lv-pend"}" title="${escapeAttr(l.name + " · " + leaveFmt(l.from) + " – " + leaveFmt(l.to) + (l.status === "одобрена" ? " (одобрен)" : " (чака)"))}">${escapeHtml((l.name || "").split(" ")[0])}</div>`).join("")}
    </div>`;
    col++;
  }
  while (col < 7 && col !== 0) { cells += `<div class="lv-cell lv-empty"></div>`; col++; }
  box.innerHTML = `<div class="lv-grid lv-grid-wk">${cells}</div>`;
}

/* ---------- Бутон за служителите (в Цехове / РОГОШ / ЗАНИТВАНЕ) ---------- */
function leavesInit() {
  ["tasks-leave", "rogosh-leave", "nit-leave"].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("click", () => leaveRequestDialog({}));
  });
}
document.addEventListener("DOMContentLoaded", leavesInit);
