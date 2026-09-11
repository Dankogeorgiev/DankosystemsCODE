/* Данко Системс — ЕРП „Таблица ЕРП" (седмичен финансов отчет).
   Таблицата, която Кристина попълва всеки понеделник: задължения, вземания,
   съотношение (авт.), разлика (авт.), заявки, банкова наличност, наличности
   материали (тон), външен/вътрешен оборот, инвестиции, забележка.
   Пази се в app_config (id=erp_weekly_table), без нов SQL. */

const ET_FIELDS = [
  { k: "liabilities", l: "Задължения (€ с ДДС)", money: true },
  { k: "receivables", l: "Вземания общо (€ с ДДС)", money: true },
  { k: "orders", l: "Заявки (€)", money: true },
  { k: "bank", l: "Банкова наличност (€)", money: true },
  { k: "materialTons", l: "Наличности материали (тон)", money: false },
  { k: "extTurnover", l: "Външен оборот за седмица (€)", money: true },
  { k: "intTurnover", l: "Вътрешен оборот за седмица (€ с ДДС)", money: true },
  { k: "investments", l: "Инвестиции (€ с ДДС)", money: true },
];
let ET_ROWS = null;

function etMoney(n) { return (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function etDate(d) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : (d || ""); }
function etMondayIso() { const d = new Date(); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
// Номер на седмицата в годината (ISO) по датата.
function etWeekNo(dateStr) {
  const d = new Date((dateStr || "") + "T00:00:00"); if (isNaN(d.getTime())) return "";
  const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

async function erpETLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "erp_weekly_table").maybeSingle(); ET_ROWS = (data && data.data && data.data.rows) || []; }
  catch (e) { ET_ROWS = []; }
}
async function erpETSave() {
  const { error } = await sb.from("app_config").upsert({ id: "erp_weekly_table", data: { rows: ET_ROWS }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

/* ---------- Автопопълване всеки понеделник ----------
   При отваряне на Системата/таблицата: ако за текущата седмица (понеделник)
   няма ред, той се създава автоматично от данните в модулите:
   • Задължения/Вземания — неплатените остатъци към момента;
   • Заявки — стойността на активните (без „завършена");
   • Материали (тон) — складът на материалите в килограми ÷ 1000;
   • Външен/вътрешен оборот — издадените фактури за ИЗМИНАЛАТА седмица
     (серия 1 = износ, без ДДС; останалите = вътрешен, с ДДС);
   • Инвестиции — покупките „Инвестиции" от изминалата седмица (с ДДС).
   Банковата наличност няма откъде да се вземе — попълва се на ръка (✎). */
async function erpETAutoRow() {
  if (!ET_ROWS) await erpETLoad();
  const monday = etMondayIso();
  if ((ET_ROWS || []).some(r => String(r.date || "").slice(0, 10) === monday)) return false;
  const addD = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const wFrom = addD(monday, -7), wTo = addD(monday, -1);   // изминалата седмица (пн–нд)
  const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
  const toEur = (n, cur) => cur === "BGN" ? n / 1.95583 : n;
  // Дозареждане на модулите, които още не са отваряни в тази сесия.
  try { if (typeof PAYABLES !== "undefined" && !PAYABLES && typeof erpPayLoad === "function") await erpPayLoad(); } catch (e) {}
  try { if (typeof RECEIVABLES !== "undefined" && !RECEIVABLES && typeof erpRecvLoad === "function") await erpRecvLoad(); } catch (e) {}
  try { if (typeof erpInvoices !== "undefined" && !erpInvoices && typeof erpLoadInvoices === "function") await erpLoadInvoices(); } catch (e) {}
  try { if (typeof erpPurchases !== "undefined" && !erpPurchases && typeof erpLoadPurchases === "function") await erpLoadPurchases(); } catch (e) {}
  try { if (typeof erpCOList !== "undefined" && !erpCOList && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  const row = { date: monday, auto: true, note: "авто · банка на ръка" };
  try {
    row.liabilities = r2((typeof PAYABLES !== "undefined" && PAYABLES || []).filter(p => !p.paid).reduce((s, p) => s + (Number(p.amountVat) || 0), 0));
  } catch (e) {}
  try {
    row.receivables = r2((typeof RECEIVABLES !== "undefined" && RECEIVABLES || []).filter(p => !p.paid).reduce((s, p) => s + (typeof recvOutstanding === "function" ? recvOutstanding(p) : Number(p.amount) || 0), 0));
  } catch (e) {}
  try {
    row.orders = r2((typeof erpCOList !== "undefined" && erpCOList || []).filter(o => (o.status || "нова") !== "завършена")
      .reduce((s, o) => s + (o.lines || []).reduce((t, l) => t + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0), 0));
  } catch (e) {}
  try {
    if (typeof ERP !== "undefined" && (ERP.materials || []).length)
      row.materialTons = r2(ERP.materials.filter(m => /^кг/i.test(m.unit || "")).reduce((s, m) => s + (Number(m.stock) || 0), 0) / 1000);
  } catch (e) {}
  try {
    const inWeek = o => { const d = String(o.issueDate || o.date || "").slice(0, 10); return d >= wFrom && d <= wTo; };
    const issued = (typeof erpInvoices !== "undefined" && erpInvoices || []).filter(o => o.posted && o.kind !== "proforma" && inWeek(o));
    let ext = 0, int_ = 0;
    issued.forEach(o => { const t = erpInvTotals(o); const v = toEur(t.total, o.currency || "EUR"); if (o.seriesKey === "1") ext += v; else int_ += v; });
    row.extTurnover = r2(ext); row.intTurnover = r2(int_);
  } catch (e) {}
  try {
    row.investments = r2((typeof erpPurchases !== "undefined" && erpPurchases || [])
      .filter(p => p.expenseType === "Инвестиции" && String(p.date || "") >= wFrom && String(p.date || "") <= wTo)
      .reduce((s, p) => s + toEur(erpPuTotals(p).total, p.currency || "BGN"), 0));
  } catch (e) {}
  ET_ROWS = ET_ROWS || [];
  ET_ROWS.push(row);
  try { await erpETSave(); } catch (e) { return false; }
  return true;
}

async function erpRenderETable(v) {
  if (!ET_ROWS) { v.innerHTML = `<p class="erp-loading">Зареждане…</p>`; await erpETLoad(); }
  try { await erpETAutoRow(); } catch (e) { console.warn("ET auto", e); }
  const rows = (ET_ROWS || []).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const calc = r => {
    const liab = Number(r.liabilities) || 0, recv = Number(r.receivables) || 0;
    return { ratio: liab > 0 ? recv / liab : null, diff: recv - liab };
  };
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">Таблица ЕРП · седмичен отчет (${rows.length})</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="et-csv">⤓ Excel</button>
      <button class="btn btn-small btn-primary" id="et-add">+ Нов ред (понеделник)</button>
    </div>
    <div class="pay-scroll"><table class="report-table erp-table et-table">
      <thead><tr>
        <th class="num">№ седм.</th><th>Дата</th><th class="num">Задължения</th><th class="num">Вземания</th><th class="num">Съотн.</th><th class="num">Разлика</th>
        <th class="num">Заявки</th><th class="num">Банка</th><th class="num">Материали (т)</th><th class="num">Външен об.</th><th class="num">Вътр. об.</th><th class="num">Инвестиции</th><th>Забележка</th><th></th>
      </tr></thead>
      <tbody>${rows.map(r => { const c = calc(r); const i = ET_ROWS.indexOf(r); return `
        <tr class="erp-clickable" data-i="${i}">
          <td class="num" data-label="№ седм."><b>${etWeekNo(r.date)}</b></td>
          <td data-label="Дата"><b>${etDate(r.date)}</b></td>
          <td class="num" data-label="Задължения">${etMoney(r.liabilities)}</td>
          <td class="num" data-label="Вземания">${etMoney(r.receivables)}</td>
          <td class="num" data-label="Съотн.">${c.ratio != null ? (Math.round(c.ratio * 100) / 100).toLocaleString("bg-BG") : "—"}</td>
          <td class="num" data-label="Разлика">${etMoney(c.diff)}</td>
          <td class="num" data-label="Заявки">${etMoney(r.orders)}</td>
          <td class="num" data-label="Банка">${etMoney(r.bank)}</td>
          <td class="num" data-label="Материали (т)">${r.materialTons != null && r.materialTons !== "" ? etMoney(r.materialTons) : "—"}</td>
          <td class="num" data-label="Външен об.">${etMoney(r.extTurnover)}</td>
          <td class="num" data-label="Вътр. об.">${etMoney(r.intTurnover)}</td>
          <td class="num" data-label="Инвестиции">${etMoney(r.investments)}</td>
          <td data-label="Забележка">${escapeHtml(r.note || "")}</td>
          <td class="erp-row-actions"><button class="btn btn-small" data-edit="${i}">✎</button></td>
        </tr>`; }).join("") || `<tr><td colspan="14" class="report-empty">Още няма записи. Натисни „+ Нов ред".</td></tr>`}
      </tbody>
    </table></div>
    <p class="hint">Съотношение = Вземания ÷ Задължения; Разлика = Вземания − Задължения (смятат се автоматично). Данните са с ДДС, в евро. Редът за текущата седмица се създава АВТОМАТИЧНО всеки понеделник от данните в Системата — само банковата наличност се въвежда на ръка (✎), а числата могат да се коригират.</p>`;

  v.querySelector("#et-add").addEventListener("click", () => erpETEdit(null, v));
  v.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpETEdit(Number(b.dataset.edit), v); }));
  v.querySelectorAll("tr[data-i]").forEach(tr => tr.addEventListener("click", () => erpETEdit(Number(tr.dataset.i), v)));
  v.querySelector("#et-csv").addEventListener("click", () => erpETExport(rows, calc));
}

function erpETEdit(index, v) {
  const r = index != null ? (ET_ROWS[index] || {}) : { date: etMondayIso() };
  const g = k => (r[k] != null && r[k] !== "") ? escapeAttr(String(r[k])) : "";
  const { wrap, close } = erpDialog(`
    <h3>${index != null ? "Редакция на ред" : "Нов ред (седмичен отчет)"}</h3>
    <label>Дата на отчитане <input type="date" id="et-date" value="${escapeAttr(r.date || etMondayIso())}" /></label>
    ${ET_FIELDS.map(f => `<label>${f.l} <input type="number" step="any" id="et-${f.k}" value="${g(f.k)}" /></label>`).join("")}
    <label>Забележка <input type="text" id="et-note" value="${escapeAttr(r.note || "")}" /></label>
    <div class="erp-dialog-actions">
      ${index != null ? '<button class="btn btn-danger" id="et-del">Изтрий</button>' : ""}
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="et-cancel">Отказ</button>
      <button class="btn btn-primary" id="et-save">Запази</button>
    </div>`);
  wrap.querySelector("#et-cancel").addEventListener("click", close);
  wrap.querySelector("#et-save").addEventListener("click", async () => {
    const row = { date: wrap.querySelector("#et-date").value || etMondayIso(), note: wrap.querySelector("#et-note").value.trim() };
    ET_FIELDS.forEach(f => { const val = wrap.querySelector("#et-" + f.k).value.trim(); if (val !== "") row[f.k] = Number(String(val).replace(",", ".")) || 0; });
    ET_ROWS = ET_ROWS || [];
    if (index != null) ET_ROWS[index] = row; else ET_ROWS.push(row);
    await erpETSave(); close(); erpRenderETable(v);
  });
  const del = wrap.querySelector("#et-del");
  if (del) del.addEventListener("click", async () => {
    if (!confirm("Да изтрия ли този ред?")) return;
    ET_ROWS.splice(index, 1); await erpETSave(); close(); erpRenderETable(v);
  });
}

function erpETExport(rows, calc) {
  const n = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headers = [{ label: "№ седм.", num: true }, { label: "Дата" }, { label: "Задължения", num: true }, { label: "Вземания", num: true }, { label: "Съотношение", num: true }, { label: "Разлика", num: true }, { label: "Заявки", num: true }, { label: "Банкова наличност", num: true }, { label: "Материали (тон)", num: true }, { label: "Външен оборот", num: true }, { label: "Вътрешен оборот", num: true }, { label: "Инвестиции", num: true }, { label: "Забележка" }];
  const outRows = rows.map(r => { const c = calc(r); return [etWeekNo(r.date), etDate(r.date), n(r.liabilities), n(r.receivables), c.ratio != null ? n(c.ratio) : "", n(c.diff), n(r.orders), n(r.bank), n(r.materialTons), n(r.extTurnover), n(r.intTurnover), n(r.investments), r.note || ""]; });
  reportExportXls("tablica-erp", "ЕРП таблица (седмично)", [{ headers, rows: outRows }]);
}
