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

async function erpRenderETable(v) {
  if (!ET_ROWS) { v.innerHTML = `<p class="erp-loading">Зареждане…</p>`; await erpETLoad(); }
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
    <p class="hint">Съотношение = Вземания ÷ Задължения; Разлика = Вземания − Задължения (смятат се автоматично). Данните са с ДДС, в евро.</p>`;

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
