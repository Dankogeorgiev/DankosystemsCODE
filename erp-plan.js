/* Данко Системс — 📅 ПЛАН ЗА ПРОИЗВОДСТВО.
   Събира трите готови източника в една картина:
   1) ОЧАКВАНИ ЗАЯВКИ — ритъмът на всеки клиент по код (медиана на интервалите
      и количествата от историята на заявките) → кога и по колко се очаква;
   2) ⏱ ВРЕМЕНАТА — средно време/бройка по код (Продукти → „Обнови времената",
      пази се в app_config prod_times);
   3) ТЕКУЩО НАТОВАРВАНЕ — незавършените задачи по цехове (оставащи бройки ×
      време/бр) срещу КАПАЦИТЕТА: реално отчетените часове/седмица от
      последните 4 седмици в Отчети.
   Всичко е сметка на момента — нищо не се записва в базата. */

let erpPlanQ = "";
let erpPlanCache = null;   // данните се теглят веднъж; „⟳ Преизчисли" ги обновява

async function erpPlanData() {
  try { if ((typeof erpCOList === "undefined" || !erpCOList) && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  const orders = (typeof erpCOList !== "undefined" && erpCOList) || [];
  let times = ERP.prodTimes || null;
  if (!times) {
    try { const { data } = await sb.from("app_config").select("data").eq("id", "prod_times").maybeSingle(); times = (data && data.data) || null; ERP.prodTimes = times; } catch (e) { times = null; }
  }
  const [tRes, lRes, sRes] = await Promise.all([
    erpSelectAll("tasks", "id,done,data"),
    erpSelectAll("production_log", "id,data"),
    erpSelectAll("v_product_stock", "id,stock"),
  ]);
  return { orders, times, tasks: tRes.data || [], logRows: lRes.data || [], stockRows: sRes.data || [] };
}

/* Прогнозата: клиент+код с ≥2 заявки и разумен ритъм (до ~200 дни). */
function erpPlanForecast(orders) {
  const ev = {};
  orders.forEach(o => {
    const cl = String(o.clientName || "").trim(); if (!cl || !o.date) return;
    (o.lines || []).forEach(l => {
      const q = erpToNum(l.qty) || 0; if (!q || !l.code) return;
      const k = cl + "¦" + String(l.code).trim();
      (ev[k] = ev[k] || []).push({ d: o.date, q });
    });
  });
  const med = a => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = [];
  Object.keys(ev).forEach(k => {
    const rows = ev[k].sort((a, b) => String(a.d).localeCompare(String(b.d)));
    if (rows.length < 2) return;
    const gaps = [];
    for (let i = 1; i < rows.length; i++) { const g = Math.round((new Date(rows[i].d) - new Date(rows[i - 1].d)) / 864e5); if (g > 0) gaps.push(g); }
    if (!gaps.length) return;
    const per = Math.round(med(gaps));
    if (per > 200) return;
    const idx = k.indexOf("¦");
    const last = rows[rows.length - 1].d;
    out.push({
      client: k.slice(0, idx), code: k.slice(idx + 1),
      per, qty: Math.round(med(rows.map(r => r.q))), n: rows.length, last,
      next: new Date(new Date(last).getTime() + per * 864e5).toISOString().slice(0, 10),
    });
  });
  return out;
}

/* Изоставането: оставащи бройки по цех × време/бр (където го знаем). */
function erpPlanBacklog(tasks, times) {
  const by = {};
  tasks.forEach(r => {
    if (r.done) return;
    const d = r.data || {};
    const rem = Math.max(0, (Number(d.qty) || 0) - (Number(d.produced) || 0));
    if (!rem) return;
    const ws = d.workshop || "—";
    const b = by[ws] = by[ws] || { qty: 0, sec: 0, unknown: 0 };
    b.qty += rem;
    const t = times && times.byCode && times.byCode[String(d.code || "").trim()];
    const op = t && t.ops && t.ops[String(d.operation || "—")];
    if (op && op.per > 0) b.sec += rem * op.per; else b.unknown += rem;
  });
  return by;
}

/* Капацитетът: реално отчетени секунди по цех за последните 4 седмици ÷ 4. */
function erpPlanCapacity(logRows) {
  const SKIP = new Set(["григор байков", "тестов", "тест"]);
  const from = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const by = {};
  logRows.forEach(r => {
    const l = r.data || {};
    if ((l.date || "") < from) return;
    if (SKIP.has(String(l.worker || "").trim().toLowerCase())) return;
    const qty = Number(l.qty) || 0;
    const sec = ((l.tOrder && l.tOrder.sec) || ((l.tPiece && l.tPiece.sec) || 0) * qty) + ((l.tSetup && l.tSetup.sec) || 0);
    if (!(sec > 0)) return;
    const ws = l.workshop || "—";
    by[ws] = (by[ws] || 0) + sec;
  });
  Object.keys(by).forEach(ws => { by[ws] = by[ws] / 4; });
  return by;
}

function erpPlanH(sec) { return Math.round((sec || 0) / 360) / 10; }   // секунди → часове (1 знак)
function erpPlanWeekLabel(dstr) {
  const d = new Date(dstr); const day = (d.getDay() + 6) % 7;          // понеделник = 0
  const mon = new Date(d.getTime() - day * 864e5), sun = new Date(mon.getTime() + 6 * 864e5);
  const f = x => `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}`;
  return `Седмица ${f(mon)} – ${f(sun)}`;
}

async function erpRenderPlan() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Смятам плана… (заявки · времена · задачи · отчети)</p>`;
  try { await erpEnsureLoaded(); } catch (e) {}
  let data = erpPlanCache;
  if (!data) {
    try { data = await erpPlanData(); erpPlanCache = data; }
    catch (e) { v.innerHTML = `<div class="erp-error"><h3>Планът не се зареди</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  }
  const { orders, times, tasks, logRows, stockRows } = data;
  const nameByCode = {}, pidByCode = {};
  (ERP.products || []).forEach(p => { if (p.code) { nameByCode[String(p.code).trim()] = p.name || ""; pidByCode[String(p.code).trim()] = p.id; } });
  // Наличност: Склад детайли + идващото от текущо „Производство за склад".
  const stockByPid = {};
  (stockRows || []).forEach(r => { stockByPid[r.id] = Number(r.stock) || 0; });
  const wipByPid = {};
  tasks.forEach(r => {
    if (r.done) return;
    const d = r.data || {}, src = d.source || {};
    if (src.kind !== "series" || !src.flow || !src.stock || !src.last || !src.pid) return;
    if (String(src.seriesKey || "").includes("¦арх:")) return;
    const rem = Math.max(0, (Number(d.qty) || 0) - (Number(src.stocked) || 0));
    if (rem > 0) wipByPid[src.pid] = (wipByPid[src.pid] || 0) + rem;
  });

  const backlog = erpPlanBacklog(tasks, times);
  const cap = erpPlanCapacity(logRows);
  const wsAll = [...new Set([...Object.keys(backlog), ...Object.keys(cap)])].sort((a, b) => a.localeCompare(b, "bg"));

  const today = new Date(new Date().toISOString().slice(0, 10));
  const fc = erpPlanForecast(orders)
    .map(x => ({ ...x, days: Math.round((new Date(x.next) - today) / 864e5) }))
    .filter(x => x.days >= -14 && x.days <= 56)
    .sort((a, b) => a.days - b.days);
  const perOf = code => { const t = times && times.byCode && times.byCode[String(code).trim()]; return t && t.per > 0 ? t.per : 0; };
  // За производство = очаквано − (на склад + идващо от производство за склад).
  fc.forEach(x => {
    const pid = pidByCode[String(x.code).trim()];
    x.pid = pid || null;
    x.avail = pid ? (stockByPid[pid] || 0) : 0;
    x.wip = pid ? (wipByPid[pid] || 0) : 0;
    x.toProd = Math.max(0, x.qty - x.avail - x.wip);
  });
  const fcTotalSec = fc.filter(x => x.days <= 28).reduce((s, x) => s + x.toProd * perOf(x.code), 0);
  const capTotal = Object.values(cap).reduce((s, x) => s + x, 0);
  const backTotal = Object.values(backlog).reduce((s, b) => s + b.sec, 0);

  const light = ratio => ratio == null ? "" : (ratio < 0.7 ? '<span class="erp-co-status" style="background:#dcfce7;color:#166534">✓ спокойно</span>' : (ratio <= 1.5 ? '<span class="erp-co-status" style="background:#fef3c7;color:#92400e">⚠ натоварено</span>' : '<span class="erp-co-status" style="background:#fee2e2;color:#991b1b">🔥 претоварено</span>'));

  const q = erpPlanQ.trim().toLowerCase();
  const fcShown = q ? fc.filter(x => (x.client + " " + x.code + " " + (nameByCode[x.code] || "")).toLowerCase().includes(q)) : fc;
  const canProduce = (typeof produceAllowed !== "function") || produceAllowed();
  let lastWeek = "";
  const fcRows = fcShown.map(x => {
    const wk = erpPlanWeekLabel(x.next);
    const sep = wk !== lastWeek ? `<tr class="co-folder"><td colspan="8">📅 <b>${wk}</b></td></tr>` : "";
    lastWeek = wk;
    const sec = x.toProd * perOf(x.code);
    const badge = x.days < 0
      ? `<span class="erp-co-status" style="background:#fef3c7;color:#92400e">⏰ закъсняла с ${-x.days} дни</span>`
      : (x.days <= 7 ? `<span class="erp-co-status" style="background:#dcfce7;color:#166534">тази седмица</span>` : "");
    return `${sep}<tr>
      <td data-label="Очаквана"><b>${erpDMY(x.next)}</b> ${badge}</td>
      <td data-label="Клиент">${escapeHtml(x.client)}</td>
      <td data-label="Код"><b>${escapeHtml(x.code)}</b> <span class="erp-muted">${escapeHtml(nameByCode[x.code] || "")}</span></td>
      <td class="num" data-label="~Бройки">${erpNum(x.qty)} <span class="erp-muted" title="ритъм: на ~${x.per} дни · ${x.n} заявки · последна ${erpDMY(x.last)}">ⓘ</span></td>
      <td class="num" data-label="Налични">${x.avail + x.wip ? `${erpNum(x.avail + x.wip)}${x.wip ? ` <span class="erp-muted" title="${erpNum(x.avail)} на склад + ${erpNum(x.wip)} в текущо производство за склад">(⏳${erpNum(x.wip)})</span>` : ""}` : '<span class="erp-muted">0</span>'}</td>
      <td class="num" data-label="За производство">${x.toProd ? `<b>${erpNum(x.toProd)}</b>` : '<span class="erp-co-status" style="background:#dcfce7;color:#166534">✓ покрито</span>'}</td>
      <td class="num" data-label="~Часове">${sec ? erpPlanH(sec) + " ч" : (x.toProd ? '<span class="erp-muted" title="Няма измерено време — Продукти → ⏱ Обнови времената">—</span>' : "")}</td>
      <td class="erp-row-actions">${x.toProd && x.pid && canProduce ? `<button class="btn btn-small" data-planstock="${x.pid}" data-qty="${x.toProd}" data-code="${escapeAttr(x.code)}" title="Пуска бройките за производство ЗА СКЛАД — да са готови преди заявката">🏭 За склад</button>` : ""}</td>
    </tr>`;
  }).join("");

  v.innerHTML = `
    <div class="erp-toolbar">
      <h3 class="erp-h" style="margin:0">📅 План за производство</h3>
      <span class="spacer"></span>
      <input type="search" id="plan-q" placeholder="🔎 клиент / код…" value="${escapeAttr(erpPlanQ)}" style="min-width:200px" />
      <button class="btn btn-small" id="plan-refresh">⟳ Преизчисли</button>
    </div>
    <div class="costk-stats">
      <span>Изоставане (текущи задачи): <b>${erpPlanH(backTotal)} ч</b></span>
      <span>Капацитет (реален, от Отчети): <b>${erpPlanH(capTotal)} ч/седмица</b></span>
      <span title="След приспадане на наличното в Склад детайли и текущото производство за склад">Очаквано ново (4 седм., нето): <b>${erpPlanH(fcTotalSec)} ч</b></span>
      ${capTotal ? `<span>Общо натоварване / капацитет: ${light((backTotal + fcTotalSec) / (capTotal * 4))}</span>` : ""}
    </div>

    <h4 class="erp-group-head">⏳ Текущо натоварване по цехове</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Цех</th><th class="num">Оставащи бройки</th><th class="num">Часове работа</th><th class="num">Капацитет ч/седм</th><th class="num">~Седмици за изчистване</th><th>Състояние</th></tr></thead>
      <tbody>${wsAll.map(ws => {
        const b = backlog[ws] || { qty: 0, sec: 0, unknown: 0 };
        const c = cap[ws] || 0;
        const weeks = (b.sec && c) ? Math.round(b.sec / c * 10) / 10 : null;
        return `<tr>
          <td data-label="Цех"><b>${escapeHtml(ws)}</b></td>
          <td class="num" data-label="Бройки">${erpNum(b.qty)}${b.unknown ? ` <span class="erp-muted" title="Бройки без измерено време — не влизат в часовете">(⏱? ${erpNum(b.unknown)})</span>` : ""}</td>
          <td class="num" data-label="Часове">${b.sec ? erpPlanH(b.sec) + " ч" : "—"}</td>
          <td class="num" data-label="Капацитет">${c ? erpPlanH(c) + " ч" : "—"}</td>
          <td class="num" data-label="Седмици">${weeks != null ? weeks : "—"}</td>
          <td data-label="Състояние">${weeks != null ? light(weeks) : ""}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="6" class="report-empty">Няма активни задачи.</td></tr>`}</tbody>
    </table>
    <p class="hint">Капацитетът е РЕАЛНО отчетените часове на цеха средно за последните 4 седмици — колкото цехът наистина дава, не теоретичното. „⏱?" = бройки без измерено време (не влизат в часовете; пусни Продукти → „⏱ Обнови времената").</p>

    <h4 class="erp-group-head">📅 Очаквани заявки — следващите 8 седмици ${fc.some(x => x.days < 0) ? '+ закъснелите' : ""} (${fcShown.length})</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Очаквана</th><th>Клиент</th><th>Код</th><th class="num">~Бройки</th><th class="num" title="Склад детайли + идващо от текущо производство за склад">Налични + идващи</th><th class="num">За производство</th><th class="num">~Часове труд</th><th></th></tr></thead>
      <tbody>${fcRows || `<tr><td colspan="8" class="report-empty">Няма прогнозирани заявки${q ? " по това търсене" : " (трябват поне 2 заявки на клиент за същия код)"}.</td></tr>`}</tbody>
    </table>
    <p class="hint">Ритъмът е медианата на интервалите между заявките на клиента за този код; количеството — медианата на количествата. Закъснялата очаквана заявка е сигнал да подсетиш клиента или да заредиш склада предварително (Производство за склад).</p>`;

  const qi = v.querySelector("#plan-q");
  if (qi) qi.addEventListener("input", e => { erpPlanQ = e.target.value; erpRenderPlan(); setTimeout(() => { const el = document.getElementById("plan-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); });
  const rf = v.querySelector("#plan-refresh");
  if (rf) rf.addEventListener("click", () => { erpPlanCache = null; erpRenderPlan(); });
  // 🏭 Пускане за склад направо от плана (иска потвърждение + позволява друга бройка).
  v.querySelectorAll("[data-planstock]").forEach(b => b.addEventListener("click", async () => {
    const a = prompt(`Колко броя ${b.dataset.code} да пусна ЗА СКЛАД?\n(предложено: липсващите до очакваната заявка)`, b.dataset.qty);
    if (a == null) return;
    const q2 = Math.round(erpToNum(a)); if (!(q2 > 0)) return;
    b.disabled = true; b.textContent = "Пускам…";
    const r = (typeof erpProduceToStock === "function") ? await erpProduceToStock(Number(b.dataset.planstock), q2) : { error: "Модулът не е зареден." };
    if (r && !r.error) {
      alert(`✓ Пуснато за склад: ${erpNum(q2)} бр. ${b.dataset.code} (${r.seriesCount || 0} операции по цеховете).`);
      erpPlanCache = null; erpRenderPlan();
    } else { b.disabled = false; b.textContent = "🏭 За склад"; }
  }));
}
