/* Данко Системс — 📅 КАЛЕНДАР НА ЗАЯВКИТЕ (Данко, 24.11.2026).
   В „Заявки от клиенти": месечен календар — на кой ден коя заявка е ДОШЛА
   (по полето „Дата" на заявката). Мишката върху заявка показва какво е
   поръчал клиентът; клик я отваря. Под календара — отчет за месеца:
   колко заявки, от кои клиенти, за колко пари + пълен списък.
   Рисува се В ЕКРАНА с „← Назад" (без изскачащи прозорци). */

let COCAL_YM = new Date().toISOString().slice(0, 7);   // показваният месец (ГГГГ-ММ)
// Скриване на приключилите заявки (Данко, 24.11.2026) — изборът се помни.
let COCAL_HIDE_DONE = (function () { try { return localStorage.getItem("cocal_hidedone") === "1"; } catch (e) { return false; } })();

function coCalMoney(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/* Многоредов надпис за мишката: какво е поръчал клиентът. */
function coCalTip(o) {
  const L = o.lines || [];
  const rows = L.slice(0, 14).map(l => `• ${l.qty || 0} ${l.unit || "бр."} × ${(l.code || "").trim()} ${(l.name || "").trim()}`.trim());
  if (L.length > 14) rows.push(`… и още ${L.length - 14} реда`);
  const val = erpCOValue(o);
  return [
    `${o.clientName || "— без клиент —"} — заявка № ${o.ourNo || "—"}${o.clientNo ? ` (клиентски № ${o.clientNo})` : ""}`,
    `Дошла: ${erpDMY(o.date) || "—"} · Срок: ${erpDMY(o.deadline) || "—"} · Статус: ${o.status || "нова"}`,
    val ? `Стойност: ${coCalMoney(val)} EUR` : "",
    "",
    ...rows,
  ].filter(x => x !== "").join("\n");
}

async function erpCOCalendarView(v, onBack) {
  v = v || erpView();
  if (!erpCOList) {
    v.innerHTML = `<p class="erp-loading">Зареждане на заявките…</p>`;
    try { await erpLoadCustomerOrders(); } catch (e) { v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя заявките</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  }
  const [Y, M] = COCAL_YM.split("-").map(Number);
  const monthName = new Date(Y, M - 1, 1).toLocaleDateString("bg-BG", { month: "long", year: "numeric" });
  const today = new Date().toISOString().slice(0, 10);
  // Заявките на месеца, групирани по ден (по датата, на която са ДОШЛИ).
  const allMonth = (erpCOList || []).filter(o => String(o.date || "").slice(0, 7) === COCAL_YM);
  const doneN = allMonth.filter(o => erpCODoneish(o)).length;
  const inMonth = allMonth.filter(o => !(COCAL_HIDE_DONE && erpCODoneish(o)))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.ourNo || "").localeCompare(String(b.ourNo || ""), "bg", { numeric: true }));
  const byDay = {};
  inMonth.forEach(o => { (byDay[o.date] = byDay[o.date] || []).push(o); });

  // Мрежата: понеделник–неделя; бледи клетки преди 1-во и след последния ден.
  const first = new Date(Y, M - 1, 1);
  const daysIn = new Date(Y, M, 0).getDate();
  const lead = (first.getDay() + 6) % 7;                      // пон=0 … нед=6
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const chip = o => `<div class="cocal-chip${erpCODoneish(o) ? " done" : ""}" data-copen="${escapeAttr(String(o.id))}" title="${escapeAttr(coCalTip(o))}">${escapeHtml((o.clientName || "—").slice(0, 22))}<small> №${escapeHtml(o.ourNo || "—")}</small></div>`;
  const cell = d => {
    if (!d) return `<div class="cocal-cell cocal-empty"></div>`;
    const iso = `${COCAL_YM}-${String(d).padStart(2, "0")}`;
    const os = byDay[iso] || [];
    return `<div class="cocal-cell${iso === today ? " cocal-today" : ""}">
      <div class="cocal-dnum">${d}${os.length ? `<span class="cocal-cnt">${os.length}</span>` : ""}</div>
      ${os.map(chip).join("")}</div>`;
  };

  // Отчетът на месеца: общо + по клиенти + пълният списък.
  const totalVal = inMonth.reduce((s, o) => s + erpCOValue(o), 0);
  const byClient = {};
  inMonth.forEach(o => {
    const k = o.clientName || "— без клиент —";
    const r = byClient[k] = byClient[k] || { n: 0, val: 0 };
    r.n++; r.val += erpCOValue(o);
  });
  const clientRows = Object.entries(byClient).sort((a, b) => b[1].val - a[1].val);

  v.innerHTML = `
    <style>
      .cocal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; }
      .cocal-head { font-weight:700; text-align:center; color:#64748b; font-size:12.5px; padding:2px 0; }
      .cocal-cell { background:var(--panel,#fff); border:1px solid #e2e8f0; border-radius:8px; min-height:74px; padding:3px 4px; overflow:hidden; }
      .cocal-empty { background:transparent; border-color:transparent; }
      .cocal-today { border:2px solid #1d4ed8; }
      .cocal-dnum { font-size:12px; font-weight:700; color:#64748b; display:flex; justify-content:space-between; align-items:center; }
      .cocal-cnt { background:#1d4ed8; color:#fff; border-radius:999px; font-size:10.5px; padding:0 6px; }
      .cocal-chip { background:#eef2ff; border:1px solid #c7d2fe; border-radius:6px; font-size:11.5px; line-height:1.25; padding:2px 4px; margin-top:2px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .cocal-chip small { color:#64748b; }
      .cocal-chip.done { background:#f1f5f9; border-color:#e2e8f0; color:#94a3b8; }
      .cocal-chip:hover { background:#dbeafe; }
      @media (max-width: 760px) {
        .cocal-cell { min-height:46px; padding:2px 3px; }
        .cocal-chip { font-size:0; padding:0; height:7px; }       /* на телефон — само цветна чертичка */
        .cocal-chip small { display:none; }
      }
    </style>
    <div class="erp-toolbar">
      <button class="btn btn-small" id="cocal-back">← Назад</button>
      <span class="erp-count">📅 Календар на заявките</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="cocal-prev" title="Предишен месец">◀</button>
      <b style="min-width:150px;text-align:center">${escapeHtml(monthName)}</b>
      <button class="btn btn-small" id="cocal-next" title="Следващ месец">▶</button>
      <button class="btn btn-small" id="cocal-now" title="Връща на текущия месец">Днес</button>
      <label class="erp-inline" title="Крие приключилите заявки — и от календара, и от отчета отдолу"><input type="checkbox" id="cocal-hidedone" ${COCAL_HIDE_DONE ? "checked" : ""} /> Скрий приключилите${doneN ? ` (${doneN})` : ""}</label>
    </div>
    <p class="hint" style="margin:4px 0 8px">Всяка заявка стои в деня, в който е <b>дошла</b>. Задръж мишката върху заявка — какво е поръчал клиентът; клик я отваря.${window.innerWidth <= 760 ? " На телефон чертичката = заявка — подробностите са в отчета отдолу." : ""}</p>
    <div class="cocal-grid">
      ${["пон", "вто", "сря", "чет", "пет", "съб", "нед"].map(d => `<div class="cocal-head">${d}</div>`).join("")}
      ${cells.map(cell).join("")}
    </div>

    <h4 class="erp-group-head" style="margin-top:18px">📊 Отчет за ${escapeHtml(monthName)}</h4>
    ${inMonth.length ? `
    <div class="pay-cards">
      <div class="pay-card"><div class="pay-card-l">Влезли заявки</div><div class="pay-card-v">${inMonth.length}</div></div>
      <div class="pay-card"><div class="pay-card-l">Клиенти</div><div class="pay-card-v">${clientRows.length}</div></div>
      <div class="pay-card pay-card-total"><div class="pay-card-l">Обща стойност (без ДДС)</div><div class="pay-card-v">${coCalMoney(totalVal)} EUR</div></div>
    </div>
    <div class="pay-scroll"><table class="report-table erp-table">
      <thead><tr><th>Клиент</th><th class="num">Заявки</th><th class="num">Стойност (EUR)</th></tr></thead>
      <tbody>${clientRows.map(([c, r]) => `<tr><td data-label="Клиент">${escapeHtml(c)}</td><td class="num" data-label="Заявки">${r.n}</td><td class="num" data-label="Стойност"><b>${coCalMoney(r.val)}</b></td></tr>`).join("")}</tbody>
    </table></div>
    <h4 class="erp-group-head" style="margin-top:14px">Всички заявки през месеца</h4>
    <div class="pay-scroll"><table class="report-table erp-table">
      <thead><tr><th>Дошла</th><th>№</th><th>Клиент</th><th>Какво е поръчано</th><th class="num">Стойност</th><th>Срок</th><th>Статус</th><th></th></tr></thead>
      <tbody>${inMonth.map(o => `<tr>
        <td data-label="Дошла"><b>${erpDMY(o.date)}</b></td>
        <td data-label="№">${escapeHtml(o.ourNo || "—")}</td>
        <td data-label="Клиент">${escapeHtml(o.clientName || "—")}</td>
        <td data-label="Какво" title="${escapeAttr(coCalTip(o))}">${(o.lines || []).slice(0, 3).map(l => `${l.qty || 0}× ${escapeHtml((l.code || l.name || "").slice(0, 26))}`).join(", ")}${(o.lines || []).length > 3 ? ` <span class="erp-muted">+ още ${(o.lines || []).length - 3}</span>` : ""}</td>
        <td class="num" data-label="Стойност"><b>${coCalMoney(erpCOValue(o))}</b></td>
        <td data-label="Срок">${erpDMY(o.deadline) || "—"}</td>
        <td data-label="Статус">${escapeHtml(o.status || "нова")}</td>
        <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-copen="${escapeAttr(String(o.id))}">Отвори →</button></td>
      </tr>`).join("")}</tbody>
    </table></div>` : `<p class="report-empty">През ${escapeHtml(monthName)} няма влезли заявки.</p>`}`;

  const redraw = () => erpCOCalendarView(v, onBack);
  v.querySelector("#cocal-back").addEventListener("click", () => (typeof onBack === "function" ? onBack() : erpRenderCustomerOrders()));
  v.querySelector("#cocal-prev").addEventListener("click", () => { COCAL_YM = new Date(Y, M - 2, 15).toISOString().slice(0, 7); redraw(); });
  v.querySelector("#cocal-next").addEventListener("click", () => { COCAL_YM = new Date(Y, M, 15).toISOString().slice(0, 7); redraw(); });
  v.querySelector("#cocal-now").addEventListener("click", () => { COCAL_YM = new Date().toISOString().slice(0, 7); redraw(); });
  v.querySelector("#cocal-hidedone").addEventListener("change", e => {
    COCAL_HIDE_DONE = e.target.checked;
    try { localStorage.setItem("cocal_hidedone", COCAL_HIDE_DONE ? "1" : "0"); } catch (err) {}
    redraw();
  });
  v.querySelectorAll("[data-copen]").forEach(el => el.addEventListener("click", () => { if (typeof erpOpenCO === "function") erpOpenCO(el.dataset.copen); }));
}
