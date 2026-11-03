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
let leaveView = "requests"; // requests | balance (Оставащи отпуски)

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
    ${(!editRec && !admin) ? '<p class="lv-warn">⚠ ТОВА, ЧЕ СТЕ ПУСНАЛИ МОЛБА ЗА ОТПУСК, НЕ ОЗНАЧАВА, ЧЕ ТЯ Е ОДОБРЕНА. ДОКАТО НЕ ПОЛУЧИТЕ ОБРАТНА ВРЪЗКА ОТ ОФИСА, СТАТУСЪТ Е ПРОСТО МОЛБА.</p>' : ""}
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
      // Опресняваме само изгледа, от който е отворен диалогът (opts.onSaved) —
      // erpRenderFinance() би залял активния панел с екрана Финанси.
      if (editRec || admin) { if (opts.onSaved) opts.onSaved(); else if (typeof erpRenderFinance === "function") erpRenderFinance(); }
      else {
        // Имейл до админите — да видят молбата веднага (не блокира записа).
        try { erpLeaveNotifyAdmins({ name, from, to, days, ws }).catch(() => {}); } catch (e) {}
        alert("✅ Молбата е ИЗПРАТЕНА.\n\n⚠ ВНИМАНИЕ: Това НЕ означава, че отпускът е одобрен! Докато не получите обратна връзка от офиса, статусът е просто молба.");
        // От офисния изглед новата молба да се ВИДИ веднага в списъка.
        if (opts.onSaved) opts.onSaved();
      }
    } else { btn.disabled = false; btn.textContent = editRec ? "💾 Запази поправките" : admin ? "💾 Запиши като одобрен" : "📨 Поискай отпуск"; }
  });
}

/* ---------- Нотификация при нова молба ----------
   Праща имейл (през Brevo) САМО до офиса — по изрично искане на Данко
   (03.11.2026): молбите за отпуск не отиват на личната му поща. */
const LEAVES_NOTIFY_TO = ["office@dankosystems.com"];
async function erpLeaveNotifyAdmins(r) {
  if (typeof erpMailSend !== "function") return;
  const admins = LEAVES_NOTIFY_TO;
  const subj = `🏖 Нова молба за отпуск: ${r.name} (${leaveFmt(r.from)} – ${leaveFmt(r.to)})`;
  const text = `Постъпи нова молба за платен отпуск.\n\nСлужител: ${r.name}${r.ws ? "\nЦех: " + r.ws : ""}\nОт дата: ${leaveFmt(r.from)}\nДо дата (вкл.): ${leaveFmt(r.to)}\nРаботни дни: ${r.days}\n\nСтатус: ЧАКАЩА — разгледай я във Финанси → 🏖 Отпуски.\n\n— СИСТЕМАТА`;
  await erpMailSend({ to: admins, subject: subj, text, cc: [], direct: true });
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
  if (leaveView === "balance") { await erpRenderLeaveBalance(v); return; }
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
      <button class="btn btn-small" id="lv-balance">📊 Оставащи отпуски</button>
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

  // ВНИМАНИЕ: само v.querySelector, НЕ document.getElementById — изгледът може
  // да съществува в два панела едновременно (разделът Служители се пази скрит,
  // докато Финанси→Служители рисува втори екземпляр) и глобалното търсене
  // закача слушателите на СКРИТИЯ дубликат → мъртви бутони, празен календар.
  v.querySelector("#lv-new-req").addEventListener("click", () => leaveRequestDialog({ onSaved: () => erpRenderLeaves(v) }));
  v.querySelector("#lv-new-approved").addEventListener("click", () => leaveRequestDialog({ adminEntry: true, onSaved: () => erpRenderLeaves(v) }));
  v.querySelector("#lv-balance").addEventListener("click", () => { leaveView = "balance"; erpRenderLeaves(v); });
  v.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.approve)); if (!l) return;
    l.status = "одобрена"; l.approvedAt = new Date().toISOString().slice(0, 10);
    if (await leavesSave()) { erpRenderLeaves(v); leavePrint(l); }
  }));
  v.querySelectorAll("[data-print]").forEach(b => b.addEventListener("click", () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.print)); if (l) leavePrint(l);
  }));
  v.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.edit)); if (l) leaveRequestDialog({ edit: l, onSaved: () => erpRenderLeaves(v) });
  }));
  v.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    const l = (LEAVES || []).find(x => x.id === Number(b.dataset.del)); if (!l) return;
    if (!confirm(`Да изтрия ли отпуска на ${l.name} (${leaveFmt(l.from)} – ${leaveFmt(l.to)})?`)) return;
    LEAVES = LEAVES.filter(x => x.id !== l.id);
    if (await leavesSave()) erpRenderLeaves(v);
  }));
  const cal = () => leaveRenderCalendar(v.querySelector("#lv-cal"), v.querySelector("#lv-cal-title"));
  v.querySelector("#lv-cal-prev").addEventListener("click", () => { leaveCalMonth = leaveShiftMonth(leaveCalMonth, -1); cal(); });
  v.querySelector("#lv-cal-next").addEventListener("click", () => { leaveCalMonth = leaveShiftMonth(leaveCalMonth, 1); cal(); });
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
      ${ppl.map(l => `<div class="lv-chip ${l.status === "одобрена" ? "lv-ok" : "lv-pend"}" title="${escapeAttr(l.name + " · " + leaveFmt(l.from) + " – " + leaveFmt(l.to) + (l.status === "одобрена" ? " (одобрен)" : " (чака)"))}">${escapeHtml(l.name || "")}</div>`).join("")}
    </div>`;
    col++;
  }
  while (col < 7 && col !== 0) { cells += `<div class="lv-cell lv-empty"></div>`; col++; }
  box.innerHTML = `<div class="lv-grid lv-grid-wk">${cells}</div>`;
}

/* ---------- Съобщение при служителите (в Цехове / РОГОШ / ЗАНИТВАНЕ) ----------
   Вместо бутона „Поискай отпуск" стои надпис. Смяната на текста (или махането
   му) е един ред тук: празен низ → нищо не се показва. */
const LEAVES_NOTICE = "🚫 Отпуски за Август 2026 са забранени";
function leavesInit() {
  ["tasks-leaveban", "rogosh-leaveban", "nit-leaveban"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = LEAVES_NOTICE;
    el.hidden = !LEAVES_NOTICE;
  });
  // Ако някъде е останал старият бутон — да не виси без действие.
  ["tasks-leave", "rogosh-leave", "nit-leave"].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.hidden = true;
  });
}
document.addEventListener("DOMContentLoaded", leavesInit);

/* ================== ОСТАВАЩИ ОТПУСКИ (баланс по служител) ==================
   Като файла „ОТПУСКИ 2026": Име · Остатък от 2025 · Платен отпуск (дни) ·
   ползвани по месеци · ОСТАТЪК. Ползваните дни се събират от 2 източника:
   1) ръчно/импортирани от файла (редактируеми клетки по месец);
   2) АВТОМАТИЧНО от одобрените молби в системата (зелено „+n", не се пипа).
   Остатък = Остатък 2025 + Платен отпуск − (ръчни + автоматични).
   Пази се в app_config id="leave_balance": { year, list:[{id,name,carry,entitle,months[12]}] }. */

let LEAVE_BAL = null;
let leaveBalSaveT = null;
const LEAVE_BAL_YEAR = 2026;

async function leaveBalLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "leave_balance").maybeSingle(); LEAVE_BAL = (data && data.data) || { year: LEAVE_BAL_YEAR, list: [] }; }
  catch (e) { LEAVE_BAL = { year: LEAVE_BAL_YEAR, list: [] }; }
  if (!Array.isArray(LEAVE_BAL.list)) LEAVE_BAL.list = [];
}
async function leaveBalSave() {
  const { error } = await sb.from("app_config").upsert({ id: "leave_balance", data: LEAVE_BAL, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function leaveBalSaveSoon(cb) { clearTimeout(leaveBalSaveT); leaveBalSaveT = setTimeout(async () => { await leaveBalSave(); if (cb) cb(); }, 600); }
function leaveBalNextId() { let m = 0; (LEAVE_BAL.list || []).forEach(p => { if ((Number(p.id) || 0) > m) m = Number(p.id); }); return m + 1; }
function lbNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }

// Автоматично ползвани РАБОТНИ дни по месеци от ОДОБРЕНИТЕ молби (за годината).
function leaveAutoMonths(name, year) {
  // Числата са служебни номера („Георги Спасов 39") — махат се преди връзване.
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim()
    .split(" ").filter(w => !/^\d+$/.test(w)).join(" ");
  const n1 = norm(name);
  const match = l => {
    const n2 = norm(l.name); if (!n1 || !n2) return false;
    if (n1 === n2) return true;
    const a = n1.split(" "), b = n2.split(" ");
    return a.length > 1 && b.length > 1 && a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
  };
  const out = Array(12).fill(0);
  (LEAVES || []).filter(l => l.status === "одобрена" && match(l)).forEach(l => {
    if (!l.from || !l.to) return;
    const a = new Date(l.from + "T00:00:00"), b = new Date(l.to + "T00:00:00");
    if (isNaN(a) || isNaN(b)) return;
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() !== year) continue;
      const w = d.getDay(); if (w === 0 || w === 6) continue;
      out[d.getMonth()]++;
    }
  });
  return out;
}

async function erpRenderLeaveBalance(v) {
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await leavesLoad(); await leaveBalLoad();
  const MON = ["Яну", "Фев", "Мар", "Апр", "Май", "Юни", "Юли", "Авг", "Сеп", "Окт", "Ное", "Дек"];
  const rows = (LEAVE_BAL.list || []).slice().sort((a, b) => String(a.name || "").localeCompare(b.name || "", "bg"));
  const html = rows.map(p => {
    const auto = leaveAutoMonths(p.name, LEAVE_BAL_YEAR);
    const man = Array.isArray(p.months) ? p.months : Array(12).fill(0);
    const used = man.reduce((s, x) => s + lbNum(x), 0) + auto.reduce((s, x) => s + x, 0);
    const left = lbNum(p.carry) + lbNum(p.entitle) - used;
    return `<tr data-id="${p.id}">
      <td class="lb-name"><b>${escapeHtml(p.name || "")}</b></td>
      <td class="num"><input type="number" class="lb-in lb-carry" data-id="${p.id}" value="${escapeAttr(String(p.carry ?? 0))}" /></td>
      <td class="num"><input type="number" class="lb-in lb-ent" data-id="${p.id}" value="${escapeAttr(String(p.entitle ?? 20))}" /></td>
      ${MON.map((mn, i) => `<td class="num lb-mcell">
        <input type="number" class="lb-in lb-m" data-id="${p.id}" data-m="${i}" value="${escapeAttr(String(man[i] || ""))}" placeholder="·" />
        ${auto[i] ? `<span class="lb-auto" title="+${auto[i]} дни от одобрени молби в системата (автоматично)">+${auto[i]}</span>` : ""}
      </td>`).join("")}
      <td class="num"><b>${used}</b></td>
      <td class="num"><b class="${left < 0 ? "lb-neg" : "lb-pos"}">${Math.round(left * 10) / 10}</b></td>
      <td class="erp-row-actions"><button class="btn btn-small btn-danger" data-lbdel="${p.id}" title="Махни служителя">×</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="18" class="report-empty">Няма служители. Импортирай файла или добави ръчно.</td></tr>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">📊 Оставащи отпуски ${LEAVE_BAL_YEAR} — ${rows.length} служители</span>
      <span class="spacer"></span>
      <label class="btn btn-small co-attach-btn" title="Импорт от файла ОТПУСКИ (лист ${LEAVE_BAL_YEAR}): име, остатък, платен отпуск, ползвани по месеци">⤓ Импорт (xlsx)<input type="file" id="lb-file" accept=".xlsx,.xls" hidden /></label>
      <button class="btn btn-small" id="lb-add">+ Добави служител</button>
      <button class="btn btn-small" id="lb-back">← Молби и календар</button>
    </div>
    <p class="hint">Клетките се пишат направо в таблицата (запазва се само). Зелените <b>+n</b> са дни от <b>одобрени молби в системата</b> — приспадат се автоматично и не се пипат. ОСТАТЪК = Остатък 2025 + Платен отпуск − всички ползвани.</p>
    <div class="pay-scroll"><table class="report-table erp-table lb-table">
      <thead><tr><th>Име, Презиме, Фамилия</th><th>Ост. 2025</th><th>Плат. отпуск</th>
        ${MON.map(m => `<th class="num">${m}</th>`).join("")}<th>Ползв.</th><th>ОСТАТЪК</th><th></th></tr></thead>
      <tbody id="lb-body">${html}</tbody>
    </table></div>`;

  const rerender = () => erpRenderLeaveBalance(v);
  // Връщаме се В СЪЩИЯ контейнер (разделът Служители / Финанси / прозорецът),
  // не през erpRenderFinance() — тя рисува ЦЕЛИЯ екран Финанси върху активния
  // панел и от раздела Служители се губи навигацията (по Данко, 03.11.2026).
  // И тук само v.querySelector — при два екземпляра на изгледа глобалното
  // търсене закача „← Молби и календар" на скрития дубликат (мъртъв бутон).
  v.querySelector("#lb-back").addEventListener("click", () => { leaveView = "requests"; erpRenderLeaves(v); });
  v.querySelector("#lb-add").addEventListener("click", async () => {
    const name = prompt("Трите имена на служителя:"); if (!name || !name.trim()) return;
    const ent = prompt("Платен отпуск за годината (дни):", "20"); if (ent === null) return;
    LEAVE_BAL.list.push({ id: leaveBalNextId(), name: name.trim(), carry: 0, entitle: lbNum(ent) || 20, months: Array(12).fill(0) });
    if (await leaveBalSave()) rerender();
  });
  const fi = v.querySelector("#lb-file"); if (fi) fi.addEventListener("change", e => leaveBalImport(e.target.files[0], rerender));
  v.querySelectorAll("[data-lbdel]").forEach(b => b.addEventListener("click", async () => {
    const p = LEAVE_BAL.list.find(x => x.id === Number(b.dataset.lbdel)); if (!p) return;
    if (!confirm(`Да махна ли ${p.name} от таблицата?`)) return;
    LEAVE_BAL.list = LEAVE_BAL.list.filter(x => x.id !== p.id);
    if (await leaveBalSave()) rerender();
  }));
  // Инлайн редакция: пише се направо, пази се автоматично (и опреснява остатъка).
  v.querySelectorAll(".lb-in").forEach(inp => inp.addEventListener("change", () => {
    const p = LEAVE_BAL.list.find(x => x.id === Number(inp.dataset.id)); if (!p) return;
    if (inp.classList.contains("lb-carry")) p.carry = lbNum(inp.value);
    else if (inp.classList.contains("lb-ent")) p.entitle = lbNum(inp.value);
    else { p.months = Array.isArray(p.months) ? p.months : Array(12).fill(0); p.months[Number(inp.dataset.m)] = lbNum(inp.value); }
    leaveBalSaveSoon(rerender);
  }));
}

// Импорт от файла ОТПУСКИ — лист „2026": A=име, B=остатък 2025, C=платен отпуск,
// после 12 двойки ПО/НО (взимаме само ПО — платения). Дедуп по име (обновява).
async function leaveBalImport(file, done) {
  if (!file) return;
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const wsName = wb.SheetNames.find(n => n.trim() === String(LEAVE_BAL_YEAR)) || wb.SheetNames[wb.SheetNames.length - 1];
    const ws = wb.Sheets[wsName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    let added = 0, updated = 0;
    raw.forEach(r => {
      const name = String(r[0] || "").trim();
      // Прескачаме заглавия/празни: името трябва да е поне 2 думи с букви.
      if (!name || name.split(/\s+/).length < 2 || /ОТПУСКИ|Име|дни/i.test(name)) return;
      const carry = lbNum(r[1]);
      const entitle = lbNum(r[2]);
      if (!entitle && !carry) return;
      const months = [];
      for (let m = 0; m < 12; m++) months.push(lbNum(r[3 + m * 2]));   // само ПО (платен)
      const ex = (LEAVE_BAL.list || []).find(p => norm(p.name) === norm(name));
      if (ex) { ex.carry = carry; ex.entitle = entitle; ex.months = months; updated++; }
      else { LEAVE_BAL.list.push({ id: leaveBalNextId(), name, carry, entitle, months }); added++; }
    });
    if (!added && !updated) { alert("Не намерих редове със служители в листа „" + wsName + "”."); return; }
    LEAVE_BAL.year = LEAVE_BAL_YEAR;
    if (await leaveBalSave()) { alert(`Импорт готов (лист ${wsName}): ${added} нови, ${updated} обновени.`); if (done) done(); }
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}

/* ---------- Отпуски от НАЧАЛНИЯ екран (без достъп до Финанси) ----------
   Списък с имейли, които виждат бутона „🏖 Отпуски" до Склад/ЕРП. Отваря същия
   офис изглед (чакащи, одобряване, календар, оставащи дни) в собствен прозорец. */
/* ---------- 👥 СЛУЖИТЕЛИ (по Данко, 01.11.2026) ----------
   Обвивка с два подтаба: 🏖 Отпуски (екранът си е същият) и 📋 Присъствена
   форма — месечна таблица кой е бил на работа и кой не. Служителите идват
   от „Оставащи отпуски" (leave_balance), одобрените отпуски се отбелязват
   сами като „О". Пази се в app_config "attendance":
   { "YYYY-MM": { "Име": { "1": "р"|"н"|"б", ... } } }. */
let staffView = "leaves";   // leaves | attend
async function erpRenderStaff(v) {
  v.innerHTML = `
    <div class="erp-toolbar" style="margin-bottom:6px">
      <button class="btn btn-small ${staffView === "leaves" ? "btn-primary" : ""}" id="st-v-leaves">🏖 Отпуски</button>
      <button class="btn btn-small ${staffView === "attend" ? "btn-primary" : ""}" id="st-v-attend" title="Кой е бил на работа и кой не — по дни за месеца. Отпуските от одобрените молби се отбелязват сами.">📋 Присъствена форма</button>
    </div>
    <div id="staff-body"></div>`;
  v.querySelector("#st-v-leaves").addEventListener("click", () => { staffView = "leaves"; erpRenderStaff(v); });
  v.querySelector("#st-v-attend").addEventListener("click", () => { staffView = "attend"; erpRenderStaff(v); });
  const body = v.querySelector("#staff-body");
  if (staffView === "attend") await erpRenderAttendance(body);
  else await erpRenderLeaves(body);
}

let ATTEND = null;          // целият регистър по месеци
let attendMonth = null;     // показваният месец "YYYY-MM"
let attendSaveT = null;
async function attendLoad() {
  if (ATTEND) return;
  try { const { data } = await sb.from("app_config").select("data").eq("id", "attendance").maybeSingle(); ATTEND = (data && data.data) || {}; }
  catch (e) { ATTEND = ATTEND || {}; }
}
async function attendSave() {
  const { error } = await sb.from("app_config").upsert({ id: "attendance", data: ATTEND || {}, updated_at: new Date().toISOString() });
  if (error) { alert("Присъствената форма НЕ се записа: " + error.message); return false; }
  return true;
}
function attendSaveSoon() { clearTimeout(attendSaveT); attendSaveT = setTimeout(() => { attendSave(); }, 600); }
/* Одобрените отпуски на месеца: .days(име) → Set от дните (само работни).
   Името се връзва по ПЪЛНО съвпадение ИЛИ — еднозначно — по първо име +
   фамилия: молбата може да е с 2 имена, а отчетната форма с 3 (и обратно).
   При два служители с еднакви първо+фамилия съкратеното връзване се
   изключва (за да не се отбележи П на грешния човек). */
function attendLeaveDays(ym, people) {
  // Числата в имената са СЛУЖЕБНИ номера от системата за чекиране
  // („Георги Спасов 39") — не са част от името и се махат преди връзването,
  // иначе номерът минава за „фамилия" и П-то не излиза (Данко, 03.11.2026).
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim()
    .split(" ").filter(w => !/^\d+$/.test(w)).join(" ");
  const fl = n => { const w = norm(n).split(" ").filter(Boolean); return w.length > 1 ? w[0] + "|" + w[w.length - 1] : ""; };
  const by = new Map(), byFl = new Map(), flOwner = new Map(), flBad = new Set();
  // Двусмислие СРЕД СЛУЖИТЕЛИТЕ: двама с еднакво чисто име или еднакви
  // първо+фамилия → не се гадае, никой не получава П по съкратения път.
  const empFl = new Map(), empFlBad = new Set(), empN = new Map(), empNBad = new Set();
  (people || []).forEach(p => {
    const raw = String(p.name || "").replace(/\s+/g, " ").trim();
    const kN = norm(p.name), kF = fl(p.name);
    if (kN) { if (empN.has(kN) && empN.get(kN) !== raw) empNBad.add(kN); else empN.set(kN, raw); }
    if (!kF) return;
    // Сравняваме СУРОВИТЕ имена: след махане на номерата „Иван Иванов 1" и
    // „Иван Иванов 2" се нормализират еднакво, но са различни хора.
    if (empFl.has(kF) && empFl.get(kF) !== raw) empFlBad.add(kF); else empFl.set(kF, raw);
  });
  const [Y, M] = ym.split("-").map(Number);
  (LEAVES || []).filter(l => l.status === "одобрена" && l.from && l.to).forEach(l => {
    const kN = norm(l.name), kF = fl(l.name);
    if (kF) { if (flOwner.has(kF) && flOwner.get(kF) !== kN) flBad.add(kF); else flOwner.set(kF, kN); }
    const a = new Date(l.from + "T00:00:00"), b = new Date(l.to + "T00:00:00");
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() !== Y || d.getMonth() + 1 !== M) continue;
      const wd = d.getDay();
      if (wd === 0 || wd === 6) continue;   // уикендите не са отпуск
      if (!by.has(kN)) by.set(kN, new Set());
      by.get(kN).add(d.getDate());
      if (kF) { if (!byFl.has(kF)) byFl.set(kF, new Set()); byFl.get(kF).add(d.getDate()); }
    }
  });
  flBad.forEach(k => byFl.delete(k));
  const EMPTY = new Set();
  return { days: name => (!empNBad.has(norm(name)) && by.get(norm(name))) || (!empFlBad.has(fl(name)) && byFl.get(fl(name))) || EMPTY };
}
/* Имената от ОФИЦИАЛНАТА отчетна форма: ред с „Трите имена" (3+ кирилски
   думи) + длъжността от следващата текстова клетка (прескача числата/8-ците).
   Чиста функция — тества се отделно от Excel-а. */
function attendParseNames(raw) {
  const out = [];
  const isName = x => {
    const t = String(x || "").replace(/\s+/g, " ").trim();
    const w = t.split(" ").filter(Boolean);
    if (w.length < 3 || w.length > 4) return false;
    // Истинско име: всяка дума е Главна + малки букви (заглавията са ГЛАВНИ).
    return w.every(x2 => /^[А-Я][а-я]+(-[А-Я][а-я]+)?$/.test(x2));
  };
  (raw || []).forEach(r => {
    if (!Array.isArray(r)) return;
    const i = r.findIndex(isName);
    if (i < 0) return;
    const name = String(r[i]).replace(/\s+/g, " ").trim();
    let role = "";
    for (let j = i + 1; j < Math.min(r.length, i + 5); j++) {
      const c = String(r[j] == null ? "" : r[j]).trim();
      if (!c || /^[\d.,/ ч]+$/i.test(c)) continue;      // 8, 4/8 ч, числа — не са длъжност
      if (/[А-Яа-яA-Za-z]/.test(c) && !isName(c)) { role = c.replace(/\s+/g, " "); break; }
      break;
    }
    if (!out.some(x => x.name.toLowerCase() === name.toLowerCase())) out.push({ name, role });
  });
  return out;
}
/* Импортът: четеш официалната форма, избираш месечния лист, имената и
   длъжностите влизат в списъка на служителите (Оставащи отпуски). */
async function attendImportFile(file, done) {
  if (!file) return;
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена — отвори първо Оставащи отпуски."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const pick = wsName => {
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { header: 1, defval: "" });
      const found = attendParseNames(raw);
      if (!found.length) { alert("В лист „" + wsName + "\u201C не намерих имена (търся „Трите имена по документ за самоличност\u201C)."); return; }
      let added = 0, updated = 0;
      const normN = x => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
      found.forEach(f => {
        const ex = (LEAVE_BAL.list || []).find(p2 => normN(p2.name) === normN(f.name));
        if (ex) { if (f.role && ex.role !== f.role) { ex.role = f.role; updated++; } }
        else { LEAVE_BAL.list.push({ id: leaveBalNextId(), name: f.name, role: f.role || "", carry: 0, entitle: 20, months: [] }); added++; }
      });
      leaveBalSave().then(ok => {
        if (ok) { alert(`✅ От лист „${wsName}\u201C: ${added} нови служители${updated ? ", " + updated + " обновени длъжности" : ""}.`); if (done) done(); }
      });
    };
    if (wb.SheetNames.length === 1) { pick(wb.SheetNames[0]); return; }
    const { wrap, close } = erpDialog(`<h3>📥 От кой месечен лист да заредя имената?</h3>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${wb.SheetNames.map((n, i) => `<button class="btn btn-small" data-ws="${i}">${escapeHtml(n)}</button>`).join("")}</div>
      <div class="erp-dialog-actions"><button class="btn" id="ati-cancel">Отказ</button></div>`);
    wrap.querySelector("#ati-cancel").addEventListener("click", close);
    wrap.querySelectorAll("[data-ws]").forEach(b => b.addEventListener("click", () => { const n = wb.SheetNames[Number(b.dataset.ws)]; close(); pick(n); }));
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}

/* ---------- 📥 Импорт от СИСТЕМАТА ЗА ЧЕКИРАНЕ (по Данко, 03.11.2026) ----------
   Експортът е CSV (Windows-1251, разделител ;): всяко чекиране вход/изход е
   ред с дата и име. Отбелязваме САМО присъствалите (✓); празното остава
   празно — отпуски/болнични се пишат на ръка. Непознато име → нов служител. */
function attendParseCheckins(text) {
  const out = [];
  String(text || "").split(/\r?\n/).forEach(line => {
    const cells = line.split(";").map(c => c.replace(/^"|"$/g, "").trim());
    const name = String(cells[7] || "").replace(/\s+/g, " ").trim();
    if (!name || /общо време/i.test(line)) return;
    const dt = String(cells[0] || cells[2] || "");
    const m = dt.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!m) return;
    out.push({ name, ym: `${m[3]}-${String(Number(m[2])).padStart(2, "0")}`, day: Number(m[1]) });
  });
  return out;
}
/* Нанася чекиранията: връзва двете имена от чека към трите имена в списъка
   (първо име + фамилия); пише „р" САМО в празни клетки. Връща равносметка. */
function attendApplyCheckins(entries) {
  // Името от чека („Георги Спасов 39") се връзва към списъка: 1) точно;
  // 2) без служебния номер, по първо име + фамилия — само ако е ЕДНОЗНАЧНО
  // (при двама с еднакъв ключ не се гадае, прави се нов ред).
  const clean = n => String(n || "").toLowerCase().replace(/\s+/g, " ").trim();
  const key = n => { const w = clean(n).split(" ").filter(x => x && !/^\d+$/.test(x)); return w.length ? w[0] + "|" + w[w.length - 1] : ""; };
  const byRaw = new Map(), byKey = new Map(), keyBad = new Set();
  const reg = p => {
    byRaw.set(clean(p.name), p);
    const k = key(p.name);
    if (!k) return;
    if (byKey.has(k) && byKey.get(k) !== p) keyBad.add(k); else byKey.set(k, p);
  };
  (LEAVE_BAL.list || []).forEach(reg);
  let added = 0, marked = 0;
  const months = new Set();
  (entries || []).forEach(e => {
    const k = key(e.name);
    let p = byRaw.get(clean(e.name)) || (!keyBad.has(k) && byKey.get(k)) || null;
    if (!p) {
      p = { id: leaveBalNextId(), name: e.name, role: "", carry: 0, entitle: 20, months: [] };
      LEAVE_BAL.list.push(p); reg(p); added++;
    }
    ATTEND[e.ym] = ATTEND[e.ym] || {};
    const rec = ATTEND[e.ym][p.name] = ATTEND[e.ym][p.name] || {};
    if (!rec[String(e.day)]) { rec[String(e.day)] = "р"; marked++; }
    months.add(e.ym);
  });
  return { added, marked, months: [...months].sort() };
}
async function attendImportCheckins(file, done) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    let text = "";
    try { text = new TextDecoder("windows-1251").decode(buf); } catch (e) { text = new TextDecoder().decode(buf); }
    if (!/[А-Яа-я]/.test(text)) text = new TextDecoder().decode(buf);   // файлът може да е и UTF-8
    const entries = attendParseCheckins(text);
    if (!entries.length) { alert("Не намерих чекирания във файла — очаквам колони „Час на събитие; …; Име\u201C (експортът от системата за чекиране)."); return; }
    await leavesLoad(); await leaveBalLoad(); await attendLoad();
    const r = attendApplyCheckins(entries);
    const okBal = r.added ? await leaveBalSave() : true;
    const okAtt = await attendSave();
    if (okBal && okAtt) {
      if (r.months.length) attendMonth = r.months[r.months.length - 1];
      alert(`✅ Чекирането е нанесено: ${r.marked} отработени дни (✓) за ${r.months.join(", ")}.${r.added ? `\n➕ ${r.added} нови служители от чека (допиши им длъжност при нужда).` : ""}\nПразните дни се попълват на ръка: ✗ / Б / Н / М (П идва от молбите).`);
      if (done) done();
    }
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}
/* ---------- ⬇ Експорт на попълнената форма за СЧЕТОВОДСТВОТО ---------- */
function attendExportRows(ym) {
  const [Y, M] = ym.split("-").map(Number);
  const daysIn = new Date(Y, M, 0).getDate();
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const monthRec = (ATTEND || {})[ym] || {};
  const leavesBy = attendLeaveDays(ym, (LEAVE_BAL && LEAVE_BAL.list) || []);
  const MONN = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];
  const people = (LEAVE_BAL.list || []).slice().sort((a, b) => String(a.name || "").localeCompare(b.name || "", "bg"));
  const VIEW = { "р": "8", "н": "О", "б": "Б", "нп": "Н", "м": "М" };   // по образеца: 8 = отработен ден
  const rows = [];
  rows.push(["ДАНКО СИСТЕМС ООД — ОТЧЕТНА ФОРМА за явяването и неявяването на работа"]);
  rows.push([`${MONN[M - 1]} ${Y} г.`]);
  rows.push([]);
  const head = ["№", "Трите имена", "Длъжност", ...Array.from({ length: daysIn }, (_, i) => i + 1), "Отраб. дни", "П", "Н", "М", "Б", "Неявявания"];
  rows.push(head);
  people.forEach((p, pi) => {
    const r = [pi + 1, p.name || "", p.role || ""];
    let ok = 0, lv = 0, unp = 0, mat = 0, sick = 0, no = 0;
    for (let d = 1; d <= daysIn; d++) {
      const man = (monthRec[p.name] || {})[String(d)] || "";
      const onLeave = leavesBy.days(p.name).has(d);
      const code = man || (onLeave ? "П" : "");
      if (code === "р") ok++; else if (code === "П") lv++; else if (code === "нп") unp++;
      else if (code === "м") mat++; else if (code === "б") sick++; else if (code === "н") no++;
      r.push(code === "П" ? "П" : (VIEW[code] || ""));
    }
    r.push(ok, lv, unp, mat, sick, no);
    rows.push(r);
  });
  rows.push([]);
  rows.push(["Легенда: 8 = отработен ден · П = платен отпуск · Н = неплатен · М = майчинство · Б = болничен · О = неявяване"]);
  rows.push(["Съставил: ..................", "", "Управител: .................."]);
  return rows;
}
function attendExportXlsx(ym) {
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена."); return; }
  const [Y, M] = ym.split("-").map(Number);
  const MONN = ["Януари", "Февруари", "Март", "Април", "Май", "Юни", "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"];
  const ws = XLSX.utils.aoa_to_sheet(attendExportRows(ym));
  ws["!cols"] = [{ wch: 4 }, { wch: 28 }, { wch: 18 }, ...Array.from({ length: 31 }, () => ({ wch: 3.2 })), { wch: 9 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 4 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${MONN[M - 1]} ${Y}`);
  XLSX.writeFile(wb, `Присъствена форма ${MONN[M - 1]} ${Y}.xlsx`);
}

/* ---------- 🖨 Месечен отчет „Отпуски" за СЧЕТОВОДСТВОТО (печат → PDF) ----------
   Кой е ползвал платен отпуск през месеца, по одобрените молби: периодите се
   режат до месеца, броят се само работните дни в него. */
function attendLeaveReportRows(ym) {
  const [Y, M] = ym.split("-").map(Number);
  const mStart = `${ym}-01`;
  const mEnd = `${ym}-${String(new Date(Y, M, 0).getDate()).padStart(2, "0")}`;
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim()
    .split(" ").filter(w => !/^\d+$/.test(w)).join(" ");   // без служебните номера
  const fl = n => { const w = norm(n).split(" ").filter(Boolean); return w.length > 1 ? w[0] + "|" + w[w.length - 1] : ""; };
  const byPerson = new Map();
  (LEAVES || []).filter(l => l.status === "одобрена" && l.from && l.to && l.from <= mEnd && l.to >= mStart).forEach(l => {
    const from = l.from < mStart ? mStart : l.from;
    const to = l.to > mEnd ? mEnd : l.to;
    const days = leaveWorkDays(from, to);
    if (!days) return;   // напр. отпуск само през уикенда на ръба на месеца
    const k = norm(l.name);
    if (!byPerson.has(k)) byPerson.set(k, { name: l.name, role: l.position || "", periods: [], days: 0 });
    const p = byPerson.get(k);
    p.periods.push(leaveFmt(from) + " – " + leaveFmt(to) + ((l.from < mStart || l.to > mEnd) ? " *" : ""));
    p.days += days;
  });
  const rows = [...byPerson.values()].sort((a, b) => String(a.name).localeCompare(b.name, "bg"));
  // Длъжността: от молбата, иначе от списъка на служителите (и по 2 имена).
  rows.forEach(r => {
    if (r.role) return;
    const p = (LEAVE_BAL && LEAVE_BAL.list || []).find(x => norm(x.name) === norm(r.name) || (fl(x.name) && fl(x.name) === fl(r.name)));
    if (p && p.role) r.role = p.role;
  });
  return rows;
}
function attendLeaveReportHtml(ym) {
  const [Y, M] = ym.split("-").map(Number);
  const MONN = ["ЯНУАРИ", "ФЕВРУАРИ", "МАРТ", "АПРИЛ", "МАЙ", "ЮНИ", "ЮЛИ", "АВГУСТ", "СЕПТЕМВРИ", "ОКТОМВРИ", "НОЕМВРИ", "ДЕКЕМВРИ"];
  const rows = attendLeaveReportRows(ym);
  const total = rows.reduce((s, r) => s + r.days, 0);
  const hasClip = rows.some(r => r.periods.some(p => p.includes("*")));
  const body = rows.length ? rows.map((r, i) => `<tr>
      <td class="num">${i + 1}</td>
      <td><b>${escapeHtml(r.name)}</b></td>
      <td>${escapeHtml(r.role || "")}</td>
      <td>${r.periods.map(escapeHtml).join("<br>")}</td>
      <td class="num"><b>${r.days}</b></td>
    </tr>`).join("")
    : `<tr><td colspan="5" class="empty">Няма одобрени отпуски през месеца.</td></tr>`;
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Отпуски ${escapeHtml(MONN[M - 1].toLowerCase())} ${Y}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12pt; color: #000; margin: 20mm 16mm; }
    h2 { text-align: center; margin: 0 0 2px; font-size: 13pt; }
    h1 { text-align: center; margin: 2px 0 4px; font-size: 16pt; letter-spacing: 1px; }
    .sub { text-align: center; margin: 0 0 14px; font-size: 10.5pt; color: #333; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 5px 8px; text-align: left; vertical-align: top; }
    th { background: #eee; font-size: 10.5pt; }
    .num { text-align: center; width: 1%; white-space: nowrap; }
    .empty { text-align: center; color: #555; padding: 18px; }
    tfoot td { font-weight: bold; background: #f5f5f5; }
    .note { font-size: 10pt; color: #333; margin-top: 8px; }
    .sign { display: flex; justify-content: space-between; margin-top: 46px; font-size: 11.5pt; }
    @media print { .noprint { display: none } }
    .noprint { text-align: center; margin-bottom: 14px; }
    .btnp { background: #0f766e; color: #fff; border: none; padding: 8px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат / Запази като PDF</button></div>
    <h2>„ДАНКО СИСТЕМС" ООД</h2>
    <h1>ОТПУСКИ ЗА МЕСЕЦ ${MONN[M - 1]} ${Y} г.</h1>
    <p class="sub">Платен годишен отпуск по одобрени молби — броят се само работните дни в месеца</p>
    <table>
      <thead><tr><th class="num">№</th><th>Трите имена</th><th>Длъжност</th><th>Период</th><th class="num">Раб. дни</th></tr></thead>
      <tbody>${body}</tbody>
      ${rows.length ? `<tfoot><tr><td colspan="3">ОБЩО</td><td>${rows.length} ${rows.length === 1 ? "служител" : "служители"}</td><td class="num">${total}</td></tr></tfoot>` : ""}
    </table>
    ${hasClip ? `<p class="note">* отпускът продължава и извън месеца — в отчета са само дните, попадащи в месеца.</p>` : ""}
    <div class="sign"><span>Съставил: ..............................</span><span>Управител: ..............................</span></div>
  </body></html>`;
}
function attendLeavePrint(ym) {
  const html = attendLeaveReportHtml(ym);
  const w = window.open("", "_blank"); if (!w) { alert("Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

async function erpRenderAttendance(v, quiet) {
  // quiet = тихо пре-рендериране след клик по клетка: без „Зареждане…" и без
  // презареждане от базата (данните са в паметта), а хоризонталният скрол се
  // пази — иначе след всяка отметка след средата на месеца таблицата се
  // връща в началото и трябва пак да се скролва.
  const keepX = quiet ? ((v.querySelector(".at-scroll") || {}).scrollLeft || 0) : 0;
  if (!quiet) {
    v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
    await leavesLoad(); await leaveBalLoad(); await attendLoad();
  }
  if (!attendMonth) attendMonth = new Date().toISOString().slice(0, 7);
  const ym = attendMonth;
  const [Y, M] = ym.split("-").map(Number);
  const daysIn = new Date(Y, M, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);
  const WD = ["Н", "П", "В", "С", "Ч", "П", "С"];
  const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const people = (LEAVE_BAL.list || []).slice().sort((a, b) => String(a.name || "").localeCompare(b.name || "", "bg"));
  const monthRec = ATTEND[ym] = ATTEND[ym] || {};
  const leavesBy = attendLeaveDays(ym, (LEAVE_BAL && LEAVE_BAL.list) || []);
  const MONN = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
  // Кодовете са по ОФИЦИАЛНАТА отчетна форма (файлът на Данко, 02.11):
  // ✓ = отработен ден (8 ч), ✗ = неявяване, Б = болничен, Н = неплатен
  // отпуск, М = майчинство; П = платен отпуск — идва САМ от одобрените молби.
  const AT_VIEW = { "р": "✓", "н": "✗", "б": "Б", "нп": "Н", "м": "М", "П": "П" };
  const AT_CLS = { "р": "at-ok", "н": "at-no", "б": "at-sick", "нп": "at-unpaid", "м": "at-mat", "П": "at-leave" };
  const cellOf = (p, d) => {
    const man = (monthRec[p.name] || {})[String(d)] || "";
    const dt = new Date(Y, M - 1, d);
    const we = dt.getDay() === 0 || dt.getDay() === 6;
    const onLeave = leavesBy.days(p.name).has(d);
    const code = man || (onLeave ? "П" : "");
    const cls = we ? "at-we" : (AT_CLS[code] || "");
    const iso = `${ym}-${String(d).padStart(2, "0")}`;
    return `<td class="at-c ${cls}${iso === todayIso ? " at-today" : ""}" data-n="${escapeAttr(p.name)}" data-d="${d}" title="${escapeAttr(p.name)} · ${String(d).padStart(2, "0")}.${String(M).padStart(2, "0")}${we ? " (почивен)" : ""}${onLeave && !man ? " · платен отпуск по одобрена молба" : ""}. Клик: ✓ работа → ✗ неявяване → Б болничен → Н неплатен → М майчинство → изчисти.">${AT_VIEW[code] || ""}</td>`;
  };
  const totals = p => {
    const t = { ok: 0, no: 0, sick: 0, unpaid: 0, mat: 0, lv: 0 };
    for (let d = 1; d <= daysIn; d++) {
      const man = (monthRec[p.name] || {})[String(d)] || "";
      const onLeave = leavesBy.days(p.name).has(d);
      const code = man || (onLeave ? "П" : "");
      if (code === "р") t.ok++; else if (code === "н") t.no++; else if (code === "б") t.sick++;
      else if (code === "нп") t.unpaid++; else if (code === "м") t.mat++; else if (code === "П") t.lv++;
    }
    return t;
  };
  v.innerHTML = `
    <div class="erp-toolbar" style="margin-bottom:4px">
      <button class="btn btn-small" id="at-prev">‹</button>
      <b style="min-width:170px;text-align:center">${MONN[M - 1]} ${Y}</b>
      <button class="btn btn-small" id="at-next">›</button>
      <span class="erp-muted" style="margin-left:10px">клик: <b style="color:#166534">✓ работа</b> → <b style="color:#b91c1c">✗ неявяване</b> → <b style="color:#b45309">Б болничен</b> → <b style="color:#334155">Н неплатен</b> → <b style="color:#7e22ce">М майчинство</b> → празно · <b style="color:#1d4ed8">П</b> = платен отпуск (само̀, от одобрените молби)</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="at-import" title="Зарежда имената и длъжностите от официалната отчетна форма (Excel) — избираш файла и месечния лист">📥 Имена от формата</button>
      <input type="file" id="at-import-file" accept=".xlsx,.xls" style="display:none" />
      <button class="btn btn-small" id="at-import-chk" title="Експортът от системата за чекиране (CSV) — отбелязва ✓ на всеки, който се е чекирал през деня. Празното остава празно (отпуск/болничен се пишат на ръка), непознатите имена стават нови служители.">📥 От чекирането</button>
      <input type="file" id="at-import-chk-file" accept=".csv,.txt" style="display:none" />
      <button class="btn btn-small" id="at-export" title="Сваля попълнената присъствена форма за този месец като Excel файл — готов за изпращане на счетоводството.">⬇ Свали (Excel)</button>
      <button class="btn btn-small" id="at-leave-pdf" title="Месечен отчет кой е ползвал платен отпуск (по одобрените молби) — отваря се за печат, от диалога избери „Запази като PDF&#8220; и го прати на счетоводството.">🖨 Отпуски (PDF)</button>
      <span class="erp-count">${people.length} служители</span>
    </div>
    ${people.length ? `<div class="at-scroll" style="overflow:auto"><table class="report-table erp-table at-table">
      <thead><tr><th style="min-width:160px">Служител</th><th style="min-width:90px">Длъжност</th>${Array.from({ length: daysIn }, (_, i) => { const dt = new Date(Y, M - 1, i + 1); const we = dt.getDay() === 0 || dt.getDay() === 6; return `<th class="at-h${we ? " at-we" : ""}">${i + 1}<div class="at-wd">${WD[dt.getDay()]}</div></th>`; }).join("")}<th class="num" title="Отработени дни">✓</th><th class="num" title="Неявявания">✗</th><th class="num" title="Болнични">Б</th><th class="num" title="Неплатен отпуск">Н</th><th class="num" title="Майчинство">М</th><th class="num" title="Платен отпуск">П</th></tr></thead>
      <tbody>${people.map(p => { const t = totals(p); return `<tr><td><b>${escapeHtml(p.name || "")}</b></td><td class="erp-muted" style="font-size:11.5px">${escapeHtml(p.role || "")}</td>${Array.from({ length: daysIn }, (_, i) => cellOf(p, i + 1)).join("")}<td class="num" style="color:#166534"><b>${t.ok || ""}</b></td><td class="num" style="color:#b91c1c"><b>${t.no || ""}</b></td><td class="num" style="color:#b45309"><b>${t.sick || ""}</b></td><td class="num" style="color:#334155"><b>${t.unpaid || ""}</b></td><td class="num" style="color:#7e22ce"><b>${t.mat || ""}</b></td><td class="num" style="color:#1d4ed8"><b>${t.lv || ""}</b></td></tr>`; }).join("")}</tbody>
    </table></div>
    <p class="hint">Отбелязаното се записва само̀. Кодовете са по официалната отчетна форма: ✓ отработен ден · ✗ неявяване · Б болничен · Н неплатен отпуск · М майчинство · П платен отпуск (идва сам от одобрените молби; ръчна отметка в същия ден го заменя). „📥 От чекирането" нанася ✓ от експорта на системата за чекиране (CSV); празното се дописва на ръка. „⬇ Свали (Excel)" дава попълнената форма, а „🖨 Отпуски (PDF)" — месечния отчет кой е ползвал отпуск, за счетоводството.</p>`
    : `<p class="report-empty">Няма служители. Натисни „📥 Имена от формата" горе и избери официалната отчетна форма (Excel) — имената и длъжностите се зареждат от избрания месечен лист.</p>`}`;
  if (keepX) { const sc = v.querySelector(".at-scroll"); if (sc) sc.scrollLeft = keepX; }
  const impBtn = v.querySelector("#at-import");
  const impFile = v.querySelector("#at-import-file");
  if (impBtn && impFile) {
    impBtn.addEventListener("click", () => impFile.click());
    impFile.addEventListener("change", e => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (f) attendImportFile(f, () => erpRenderAttendance(v));
    });
  }
  const chkBtn = v.querySelector("#at-import-chk");
  const chkFile = v.querySelector("#at-import-chk-file");
  if (chkBtn && chkFile) {
    chkBtn.addEventListener("click", () => chkFile.click());
    chkFile.addEventListener("change", e => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (f) attendImportCheckins(f, () => erpRenderAttendance(v));
    });
  }
  const expBtn = v.querySelector("#at-export");
  if (expBtn) expBtn.addEventListener("click", () => { try { attendExportXlsx(attendMonth); } catch (e) { alert("Грешка при експорта: " + (e.message || e)); } });
  const lvPdfBtn = v.querySelector("#at-leave-pdf");
  if (lvPdfBtn) lvPdfBtn.addEventListener("click", () => { try { attendLeavePrint(attendMonth); } catch (e) { alert("Грешка при отчета: " + (e.message || e)); } });
  v.querySelector("#at-prev").addEventListener("click", () => { attendMonth = leaveShiftMonth(attendMonth, -1); erpRenderAttendance(v); });
  v.querySelector("#at-next").addEventListener("click", () => { attendMonth = leaveShiftMonth(attendMonth, 1); erpRenderAttendance(v); });
  v.querySelectorAll(".at-c").forEach(td => td.addEventListener("click", () => {
    const name = td.dataset.n, d = String(td.dataset.d);
    const rec = monthRec[name] = monthRec[name] || {};
    const cur = rec[d] || "";
    const next = cur === "" ? "р" : cur === "р" ? "н" : cur === "н" ? "б" : cur === "б" ? "нп" : cur === "нп" ? "м" : "";
    if (next) rec[d] = next; else delete rec[d];
    attendSaveSoon();
    erpRenderAttendance(v, true);   // тихо: клетката + сборовете веднага, скролът остава
  }));
}

const LEAVES_MAIN_EMAILS = ["angelov@dankosystems.com", "grigor.baykov@dankosystems.com", "dankog@gmail.com"];
function leavesMainAllowed() {
  const e = ((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "").toLowerCase();
  return LEAVES_MAIN_EMAILS.includes(e);
}
/* Явно ВЛИЗАНЕ в модула (от меню/бутон): започва се от Отпуски → молбите.
   Иначе глобалните leaveView/staffView „изтичат" между контекстите и
   Служители се отваря направо на съвсем друг подекран. */
function staffResetView() { staffView = "leaves"; leaveView = "requests"; }
function openLeavesStandalone() {
  staffResetView();
  const { wrap, close } = erpDialog(`
    <h3>👥 Служители</h3>
    <div id="lv-standalone"></div>
    <div class="erp-dialog-actions"><button class="btn" id="lv-sa-close">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-full");
  wrap.querySelector("#lv-sa-close").addEventListener("click", close);
  erpRenderStaff(wrap.querySelector("#lv-standalone"));
}
function leavesMainInit() {
  const b = document.getElementById("btn-leaves-main");
  if (b && !b._lvWired) { b._lvWired = true; b.addEventListener("click", openLeavesStandalone); }
  // От 💼 Офис менюто в ЕРП-то: НОРМАЛЕН РАЗДЕЛ (като Фактуриране), не
  // изскачащ прозорец (по Данко, 02.11.2026). Прозорецът остава резерва.
  const ob = document.getElementById("erp-office-leaves");
  if (ob && !ob._lvWired) {
    ob._lvWired = true;
    ob.addEventListener("click", () => {
      if (typeof erpSetTab === "function") { staffResetView(); erpSetTab("staff", true); }
      else openLeavesStandalone();
    });
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", leavesMainInit);
else leavesMainInit();
