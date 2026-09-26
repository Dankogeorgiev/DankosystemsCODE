/* Данко Системс — „📅 Календар" (офис календарът на Кристина).
   Всичко, което се прави по числа в месеца: преводи, осигуровки, кредити,
   декларации. ИНТУИТИВНОТО ПОЛЕ разбира изречения като:
     „На всяко 4то число от месеца се превеждат 1000 евро на Данко"
     „На 24то число се плащат осигуровки" · „Всеки петък — каса"
     „На 15.10 идва одиторът" (еднократно, с конкретна дата)
   и само ги подрежда в календара (месечно повтарящи се / седмични / еднократни).
   Горе — лента „⏰ Следва" с най-близките неща; същата лента свети и на
   началния екран под План за седмицата. Пази се в app_config
   id="office_calendar" { events: [...] }. Виждат/пишат всички админи. */

let CAL_EVENTS = null;                 // [{id,type:'monthly'|'weekly'|'once',day,weekday,date,text,createdBy}]
let calMonth = null;                   // "YYYY-MM" на показания месец

async function calLoad(force) {
  if (CAL_EVENTS && !force) return CAL_EVENTS;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "office_calendar").maybeSingle();
    CAL_EVENTS = (data && data.data && data.data.events) || [];
  } catch (e) { CAL_EVENTS = []; }
  return CAL_EVENTS;
}
async function calSave() {
  const { error } = await sb.from("app_config").upsert({ id: "office_calendar", data: { events: CAL_EVENTS || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function calNextId() { let m = 0; (CAL_EVENTS || []).forEach(e => { if ((Number(e.id) || 0) > m) m = Number(e.id); }); return m + 1; }
// ЛОКАЛНА дата (toISOString е UTC и около полунощ би върнал вчерашния ден).
function calYmd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

/* ---------- Интуитивното поле: текст → събитие ---------- */
const CAL_WEEKDAYS = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];
function calParseLine(line) {
  const t = String(line || "").trim();
  if (!t) return null;
  // „(на) всяко 4то число" / „на 24-то число" / „всяко 20 число" → месечно
  let m = t.match(/(?:на\s+)?(?:всяко|всеки)?\s*(\d{1,2})\s*-?\s*(?:то|ти|во|ро|о)?\s*(?:число|ден на месеца|ти ден)/i);
  if (m) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) return { type: "monthly", day, text: t };
  }
  // „всеки петък" → седмично
  m = t.match(/всеки\s+(понеделник|вторник|четвъртък|петък)|всяка\s+(сряда|събота|неделя)/i);
  if (m) {
    const wd = CAL_WEEKDAYS.indexOf((m[1] || m[2]).toLowerCase());
    if (wd >= 0) return { type: "weekly", weekday: wd, text: t };
  }
  // „всяка година на 15.10" → годишно
  m = t.match(/(?:всяка\s+година|годишно).*?(\d{1,2})[.](\d{1,2})/i) || t.match(/(\d{1,2})[.](\d{1,2}).*?(?:всяка\s+година|годишно)/i);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return { type: "yearly", day: d, month: mo, text: t };
  }
  // „на 15.10" / „на 15.10.2026" → еднократно (дата, не сума)
  m = t.match(/на\s+(\d{1,2})[.](\d{1,2})(?:[.](\d{2,4}))?(?!\d*\s*(?:евро|лв|eur|bgn|%))/i);
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      const dt = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (dt < calYmd(new Date()) && !m[3]) y += 1;   // „на 15.01" догодина, ако е минало
      return { type: "once", date: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, text: t };
    }
  }
  return { type: "unknown", text: t };
}
function calEventLabel(e) {
  if (e.type === "monthly") return `всеки месец на ${e.day}-о число`;
  if (e.type === "weekly") return `всеки ${CAL_WEEKDAYS[e.weekday]}`;
  if (e.type === "yearly") return `всяка година на ${e.day}.${String(e.month).padStart(2, "0")}`;
  if (e.type === "once") return `еднократно на ${erpDMY(e.date) || e.date}`;
  return "";
}

/* ---------- Следващи случвания (за лентата „⏰ Следва") ---------- */
function calOccursOn(e, dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (e.type === "monthly") {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(e.day, last);   // 31-во в къс месец = последния ден
  }
  if (e.type === "weekly") return d.getDay() === e.weekday;
  if (e.type === "yearly") return d.getDate() === e.day && (d.getMonth() + 1) === e.month;
  if (e.type === "once") return e.date === dateStr;
  return false;
}
function calUpcoming(days) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < (days || 14); i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const ds = calYmd(d);
    (CAL_EVENTS || []).forEach(e => {
      if (calOccursOn(e, ds)) out.push({ ...e, when: ds, inDays: i });
    });
  }
  return out;
}
function calWhenLabel(i, ds) {
  return i === 0 ? "ДНЕС" : i === 1 ? "утре" : `${erpDMY(ds) || ds} (след ${i} дни)`;
}

/* ---------- Модалът ---------- */
function openCal() {
  const m = document.getElementById("cal-modal");
  if (!m) return;
  m.hidden = false;
  if (!calMonth) calMonth = calYmd(new Date()).slice(0, 7);
  calRender();
}
function closeCal() { const m = document.getElementById("cal-modal"); if (m) m.hidden = true; calStrip(); }

async function calRender() {
  const v = document.getElementById("cal-view");
  if (!v) return;
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await calLoad();
  const [Y, M] = calMonth.split("-").map(Number);
  const first = new Date(Y, M - 1, 1);
  const daysIn = new Date(Y, M, 0).getDate();
  const startCol = (first.getDay() + 6) % 7;                 // Пн=0
  const todayStr = calYmd(new Date());
  const monthName = first.toLocaleDateString("bg-BG", { month: "long", year: "numeric" });
  const up = calUpcoming(14).slice(0, 5);

  let cells = "";
  for (let i = 0; i < startCol; i++) cells += `<div class="cal-cell cal-off"></div>`;
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${Y}-${String(M).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const evs = (CAL_EVENTS || []).filter(e => calOccursOn(e, ds));
    cells += `<div class="cal-cell${ds === todayStr ? " cal-today" : ""}">
      <div class="cal-daynum">${d}</div>
      ${evs.map(e => `<div class="cal-ev cal-ev-${e.type}" title="${escapeAttr(e.text + " · " + calEventLabel(e))}">${escapeHtml(e.text.length > 46 ? e.text.slice(0, 44) + "…" : e.text)}<span class="cal-del" data-caldel="${e.id}" title="Изтрий">×</span></div>`).join("")}
    </div>`;
  }

  v.innerHTML = `
    <div class="cal-nextbar">⏰ <b>Следва:</b> ${up.length ? up.map(u => `<span class="cal-next-chip cal-ev-${u.type}${u.inDays === 0 ? " cal-next-today" : ""}"><b>${calWhenLabel(u.inDays, u.when)}</b> — ${escapeHtml(u.text.length > 60 ? u.text.slice(0, 58) + "…" : u.text)}</span>`).join(" ") : `<span class="erp-muted">няма нищо в следващите 14 дни</span>`}</div>
    <div class="cal-typebar">
      <span class="erp-muted" style="font-size:12px">Кога:</span>
      ${[["auto", "✨ Авто (разбира от текста)"], ["monthly", "🟦 Месечно"], ["weekly", "🟩 Седмично"], ["yearly", "🟪 Годишно"], ["once", "🟨 Еднократно"]]
        .map(([k, l]) => `<label class="cal-type-chip"><input type="radio" name="cal-type" value="${k}" ${k === "auto" ? "checked" : ""} /> ${l}</label>`).join("")}
      <span id="cal-type-extra"></span>
    </div>
    <div class="cal-addbox">
      <textarea id="cal-input" rows="2" placeholder="Пиши свободно, по едно нещо на ред:&#10;На всяко 4то число от месеца се превеждат 1000 евро на Данко&#10;На 24то число се плащат осигуровки · Всеки петък — каса · На 15.10 идва одиторът"></textarea>
      <button class="btn btn-primary" id="cal-add">➕ Запиши в календара</button>
    </div>
    <div class="cal-monthbar">
      <button class="btn btn-small" id="cal-prev">←</button>
      <b style="min-width:190px;text-align:center;text-transform:capitalize">${escapeHtml(monthName)}</b>
      <button class="btn btn-small" id="cal-next">→</button>
      <button class="btn btn-small" id="cal-today">Днес</button>
      <span class="erp-muted" style="margin-left:auto">цветове: 🟦 месечно · 🟩 седмично · 🟪 годишно · 🟨 еднократно — × трие (повтарящите се: завинаги)</span>
    </div>
    <div class="cal-grid">
      ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map(d => `<div class="cal-head">${d}</div>`).join("")}
      ${cells}
    </div>`;

  v.querySelector("#cal-prev").addEventListener("click", () => { calMonth = calShift(-1); calRender(); });
  v.querySelector("#cal-next").addEventListener("click", () => { calMonth = calShift(1); calRender(); });
  v.querySelector("#cal-today").addEventListener("click", () => { calMonth = calYmd(new Date()).slice(0, 7); calRender(); });
  v.querySelector("#cal-add").addEventListener("click", calAddFromInput);
  // При избран тип се показват само нужните полета (ден / ден от седмицата / дата).
  const extra = v.querySelector("#cal-type-extra");
  const paintExtra = () => {
    const t = (v.querySelector('input[name="cal-type"]:checked') || {}).value || "auto";
    extra.innerHTML = t === "monthly" ? `число: <input type="number" id="cal-x-day" min="1" max="31" style="width:64px" placeholder="напр. 4" />`
      : t === "weekly" ? `<select id="cal-x-wd">${CAL_WEEKDAYS.map((w, i) => `<option value="${i}" ${i === 1 ? "selected" : ""}>${w}</option>`).filter((_, i) => true).join("")}</select>`
      : t === "yearly" ? `дата: <input type="text" id="cal-x-dm" placeholder="дд.мм" style="width:74px" />`
      : t === "once" ? `дата: <input type="date" id="cal-x-date" />` : "";
  };
  v.querySelectorAll('input[name="cal-type"]').forEach(r => r.addEventListener("change", paintExtra));
  paintExtra();
  v.querySelectorAll("[data-caldel]").forEach(x => x.addEventListener("click", async () => {
    const ev = (CAL_EVENTS || []).find(e => String(e.id) === x.dataset.caldel);
    if (!ev) return;
    if (!confirm(`Да изтрия ли:\n„${ev.text}"\n(${calEventLabel(ev)})?`)) return;
    CAL_EVENTS = CAL_EVENTS.filter(e => e !== ev);
    if (await calSave()) calRender();
  }));
}
function calShift(n) {
  const [Y, M] = calMonth.split("-").map(Number);
  const d = new Date(Y, M - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function calAddFromInput() {
  const ta = document.getElementById("cal-input");
  const lines = String(ta.value || "").split(/\n|·/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { alert("Напиши какво да запиша — по едно нещо на ред."); return; }
  // Ръчно избран тип → важи за всички редове; „Авто" → интуитивното разбиране.
  const mode = (document.querySelector('input[name="cal-type"]:checked') || {}).value || "auto";
  if (mode !== "auto") {
    const g = id => document.getElementById(id);
    let make = null;
    if (mode === "monthly") {
      const day = Number(g("cal-x-day") && g("cal-x-day").value);
      if (!(day >= 1 && day <= 31)) { alert("Напиши числото от месеца (1–31)."); return; }
      make = t => ({ type: "monthly", day, text: t });
    } else if (mode === "weekly") {
      const wd = Number(g("cal-x-wd") && g("cal-x-wd").value);
      make = t => ({ type: "weekly", weekday: wd, text: t });
    } else if (mode === "yearly") {
      const m = String(g("cal-x-dm") && g("cal-x-dm").value || "").match(/^(\d{1,2})[.](\d{1,2})$/);
      if (!m) { alert("Напиши датата като дд.мм (напр. 15.10)."); return; }
      make = t => ({ type: "yearly", day: Number(m[1]), month: Number(m[2]), text: t });
    } else {
      const d = g("cal-x-date") && g("cal-x-date").value;
      if (!d) { alert("Избери датата."); return; }
      make = t => ({ type: "once", date: d, text: t });
    }
    const good = lines.map(make);
    const summary = good.map(p => `• ${p.text}\n   → ${calEventLabel(p)}`).join("\n");
    if (!confirm(`Записвам:\n\n${summary}\n\nПотвърждаваш ли?`)) return;
    await calLoad();
    const who = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "";
    good.forEach(p => CAL_EVENTS.push({ id: calNextId(), ...p, createdBy: who, createdAt: new Date().toISOString() }));
    if (await calSave()) { ta.value = ""; calRender(); calStrip(); }
    return;
  }
  const parsed = lines.map(calParseLine).filter(Boolean);
  const bad = parsed.filter(p => p.type === "unknown");
  const good = parsed.filter(p => p.type !== "unknown");
  if (bad.length) {
    // Не познахме кога — питаме за ден от месеца, вместо да гадаем.
    for (const b of bad) {
      const day = prompt(`Не разбрах КОГА за:\n„${b.text}"\n\nНапиши число от месеца (1–31) за всеки месец, или дата дд.мм за еднократно:`);
      if (day == null) continue;
      const dm = String(day).trim().match(/^(\d{1,2})[.](\d{1,2})$/);
      if (dm) { const y = new Date().getFullYear(); good.push({ type: "once", date: `${y}-${String(Number(dm[2])).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`, text: b.text }); continue; }
      const n = Number(day);
      if (n >= 1 && n <= 31) good.push({ type: "monthly", day: n, text: b.text });
    }
  }
  if (!good.length) return;
  const summary = good.map(p => `• ${p.text}\n   → ${calEventLabel(p)}`).join("\n");
  if (!confirm(`Ето как го разбрах:\n\n${summary}\n\nЗаписвам ли?`)) return;
  await calLoad();
  const who = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "";
  good.forEach(p => CAL_EVENTS.push({ id: calNextId(), ...p, createdBy: who, createdAt: new Date().toISOString() }));
  if (await calSave()) { ta.value = ""; calRender(); calStrip(); }
}

/* ---------- Лентата „⏰ Следва" на НАЧАЛНИЯ екран ---------- */
async function calStrip() {
  const el = document.getElementById("cal-next-strip");
  if (!el) return;
  try { await calLoad(); } catch (e) { return; }
  const up = calUpcoming(7).slice(0, 3);
  el.hidden = !up.length;
  el.innerHTML = up.map(u => `<span class="cal-next-chip cal-ev-${u.type}${u.inDays === 0 ? " cal-next-today" : ""}">⏰ <b>${calWhenLabel(u.inDays, u.when)}</b> — ${escapeHtml(u.text.length > 48 ? u.text.slice(0, 46) + "…" : u.text)}</span>`).join(" ");
}

function calApplyAccess() {
  const b = document.getElementById("btn-calendar");
  if (b) b.style.display = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.isAdmin) ? "" : "none";
  calStrip();
}
function calInit() {
  const b = document.getElementById("btn-calendar");
  if (b) b.addEventListener("click", openCal);
  const c = document.getElementById("cal-close");
  if (c) c.addEventListener("click", closeCal);
}
document.addEventListener("DOMContentLoaded", calInit);
