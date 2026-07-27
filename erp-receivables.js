/* Данко Системс — ЕРП „Вземания (за събиране)".
   Пари, които клиентите ни дължат. Всяка издадена фактура (Фактуриране) отива
   тук автоматично като вземане, с разсроченото плащане (падеж + срок). Може и
   импорт от GenCloud (същите колони като справката „Вземания"). Изгледът е
   групиран по клиент: болд ред със сбора на клиента, а отдолу фактурите, които
   го съставят (както в жълтото в справката). Кристина маркира фактура като
   платена → отива в архив (филтър „✓ Платени").
   Пази се в app_config id="receivables": { list:[ {...} ] }.
   Ползва ERP/erpView/erpDialog/escapeHtml, глобалния sb и XLSX (SheetJS). */

const RECV_EUR_BGN = 1.95583;
let RECEIVABLES = null;
let recvFilter = "all";            // all | week | month | overdue | paid
let recvQuery = "";                // 🔎 търсене (клиент / № фактура)
let recvSelected = new Set();      // избрани id за отбелязване платени

function recvNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function recvIso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function recvToday() { return recvIso(new Date()); }
// „17-07-2026" или „2026-07-17" → ISO „2026-07-17"
function recvParseDate(s) {
  s = String(s || "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/); if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return "";
}
function recvFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }
function recvMoney(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function recvEndOfWeek() { const d = new Date(); const off = (7 - d.getDay()) % 7; d.setDate(d.getDate() + off); return recvIso(d); }
function recvEndOfMonth() { const d = new Date(); return recvIso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function recvDaysLeft(due) { if (!due) return null; const a = new Date(due + "T00:00:00"), b = new Date(recvToday() + "T00:00:00"); return Math.round((a - b) / 864e5); }

async function erpRecvLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "receivables").maybeSingle(); RECEIVABLES = (data && data.data && data.data.list) || []; }
  catch (e) { RECEIVABLES = []; }
}
async function erpRecvSave() {
  const { error } = await sb.from("app_config").upsert({ id: "receivables", data: { list: RECEIVABLES || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message + (/row-level security|violates/i.test(error.message || "") ? "\n\nПусни app-config-rls-fix.sql в Supabase." : "")); return false; }
  return true;
}
function recvNextId() { let m = 0; (RECEIVABLES || []).forEach(p => { const n = Number(p.id) || 0; if (n > m) m = n; }); return m + 1; }

/* ---------- Списък (групиран по клиент) ---------- */
async function erpRenderReceivables() {
  const v = erpView();
  if (!RECEIVABLES) { v.innerHTML = `<p class="erp-loading">Зареждане…</p>`; await erpRecvLoad(); }
  const eow = recvEndOfWeek(), eom = recvEndOfMonth();
  const unpaid = (RECEIVABLES || []).filter(p => !p.paid);
  const sum = arr => arr.reduce((s, p) => s + recvNum(p.amount), 0);
  const weekItems = unpaid.filter(p => p.dueDate && p.dueDate <= eow);
  const monthItems = unpaid.filter(p => p.dueDate && p.dueDate <= eom);
  const overdueItems = unpaid.filter(p => { const d = recvDaysLeft(p.dueDate); return d != null && d < 0; });

  let rows;
  if (recvFilter === "paid") rows = (RECEIVABLES || []).filter(p => p.paid);
  else if (recvFilter === "week") rows = weekItems;
  else if (recvFilter === "month") rows = monthItems;
  else if (recvFilter === "overdue") rows = overdueItems;
  else rows = unpaid;
  // 🔎 Търсене (в паметта): клиент / № фактура. Картите горе остават общи.
  const rq = (recvQuery || "").toLowerCase().trim();
  if (rq) rows = rows.filter(p => `${p.client || ""} ${p.invoiceNo || ""}`.toLowerCase().includes(rq));

  // Групиране по клиент (болд сбор + фактурите под него). Подредбата следва
  // РЕДА ОТ ФАЙЛА на импорта (ord): първо експортните по азбучен ред, после
  // вътрешните — както е в GenCloud справката. Записи без ord (от издадени
  // фактури в Системата) отиват след тях, по азбучен ред.
  const groups = {};
  rows.forEach(p => { const k = p.client || "—"; (groups[k] = groups[k] || []).push(p); });
  const BIG = 1e12;
  const gOrd = {};
  Object.keys(groups).forEach(k => { gOrd[k] = Math.min(...groups[k].map(p => (p.ord != null && p.ord !== "") ? Number(p.ord) : BIG)); });
  const clientNames = Object.keys(groups).sort((a, b) => (gOrd[a] - gOrd[b]) || a.localeCompare(b, "bg"));
  clientNames.forEach(k => groups[k].sort((a, b) => {
    const ao = (a.ord != null && a.ord !== "") ? Number(a.ord) : BIG;
    const bo = (b.ord != null && b.ord !== "") ? Number(b.ord) : BIG;
    return (ao - bo) || String(a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  }));

  const card = (label, arr, hl) => `<div class="pay-card ${hl || ""}"><div class="pay-card-l">${label}</div><div class="pay-card-v">${recvMoney(sum(arr))} EUR</div><div class="pay-card-n">${arr.length} фактури</div></div>`;
  const tab = (key, label) => `<button class="btn btn-small ${recvFilter === key ? "btn-primary" : ""}" data-rf="${key}">${label}</button>`;

  const colspan = recvFilter === "paid" ? 8 : 9;
  const body = clientNames.length ? clientNames.map(name => {
    const items = groups[name];
    const gtot = sum(items);
    const groupHead = `<tr class="recv-client-row">
      ${recvFilter === "paid" ? "" : `<td class="pay-chk"><input type="checkbox" class="recv-sel-all" data-client="${escapeAttr(name)}" title="Избери всички на клиента" /></td>`}
      <td colspan="5"><b>${escapeHtml(name)}</b> <span class="erp-muted">· ${items.length} фактури</span></td>
      <td class="num"><b>${recvMoney(gtot)} EUR</b></td>
      <td></td><td></td>
    </tr>`;
    const invRows = items.map(p => {
      const dl = recvDaysLeft(p.dueDate);
      const overdue = !p.paid && dl != null && dl < 0;
      const soon = !p.paid && dl != null && dl >= 0 && dl <= 3;
      const neg = recvNum(p.amount) < 0;
      return `<tr class="recv-inv-row ${overdue ? "pay-overdue" : soon ? "pay-soon" : ""}" data-id="${p.id}">
        ${recvFilter === "paid" ? "" : `<td class="pay-chk"><input type="checkbox" class="recv-sel" data-id="${p.id}" data-client="${escapeAttr(name)}" ${recvSelected.has(p.id) ? "checked" : ""} /></td>`}
        <td><b>${recvFmt(p.dueDate)}</b></td>
        <td class="num">${dl == null ? "" : (dl < 0 ? `<span class="pay-neg">${dl}</span>` : dl)}</td>
        <td>${escapeHtml(p.invoiceNo || "")}</td>
        <td>${recvFmt(p.docDate)}</td>
        <td>${escapeHtml(p.docType || "Фактура")}</td>
        <td class="num ${neg ? "pay-neg" : ""}"><b>${recvMoney(p.amount)}</b></td>
        <td>${escapeHtml(p.payMethod || "Банка")}</td>
        ${recvFilter === "paid"
          ? `<td>${recvFmt(p.paidDate)} <button class="btn btn-small" data-unpay="${p.id}" title="Върни като неплатена">↩</button></td>`
          : `<td class="erp-row-actions"><button class="btn btn-small" data-fix="${p.id}" title="Корекция на сумата/падежа (при грешка от импорта)">✎ Корекция</button><button class="btn btn-small" data-paid1="${p.id}" title="Отбележи тази като платена">✓ Платена</button></td>`}
      </tr>`;
    }).join("");
    return groupHead + invRows;
  }).join("") : `<tr><td colspan="${colspan}" class="report-empty">${recvFilter === "paid" ? "Няма платени (архив)." : "Няма вземания. Издай фактура или импортирай от GenCloud."}</td></tr>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      ${tab("all", "⏳ Всички за събиране")}
      ${tab("week", "📅 Тази седмица")}
      ${tab("month", "📅 До края на месеца")}
      ${tab("overdue", `⚠ Просрочени (${overdueItems.length})`)}
      ${tab("paid", "✓ Платени (архив)")}
      <input type="search" id="recv-q" placeholder="🔎 клиент / № фактура…" value="${escapeAttr(recvQuery)}" style="min-width:180px" autocomplete="off" />
      <span class="spacer"></span>
      <label class="btn btn-small co-attach-btn">⤓ Импорт (GenCloud)<input type="file" id="recv-file" accept=".xlsx,.xls" hidden /></label>
      ${(RECEIVABLES || []).some(p => p.imported) ? '<button class="btn btn-small btn-danger" id="recv-clear-import" title="Изтрий импортираните вземания (тези от издадена фактура остават)">🗑 Изтегли импорта</button>' : ""}
      ${(RECEIVABLES || []).length ? '<button class="btn btn-small btn-danger" id="recv-clear-all" title="Изтрий ВСИЧКИ вземания (пълно изчистване)">🗑 Изчисти всичко</button>' : ""}
    </div>
    <div class="pay-cards">
      ${card("Σ Общо за събиране", unpaid, "pay-card-total")}
    </div>
    <div class="pay-scroll"><table class="report-table erp-table pay-table recv-table">
      <thead><tr>
        ${recvFilter === "paid" ? "" : '<th class="pay-chk"></th>'}
        <th>Падеж</th><th class="num">Дни</th><th>№ Фактура</th><th>Дата док.</th><th>Тип</th>
        <th class="num">Сума (EUR)</th><th>Плащане</th>${recvFilter === "paid" ? "<th>Платена на</th>" : "<th></th>"}
      </tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    ${recvFilter !== "paid" ? `<div class="pay-paybar" id="recv-paybar"></div>` : ""}`;

  v.querySelectorAll("[data-rf]").forEach(b => b.addEventListener("click", () => { recvFilter = b.dataset.rf; recvSelected.clear(); erpRenderReceivables(); }));
  const rqEl = document.getElementById("recv-q");
  if (rqEl) rqEl.addEventListener("input", e => {
    recvQuery = e.target.value;
    erpRenderReceivables();
    const el = document.getElementById("recv-q");
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });
  const fi = document.getElementById("recv-file"); if (fi) fi.addEventListener("change", e => erpRecvImport(e.target.files[0]));
  const ci = document.getElementById("recv-clear-import"); if (ci) ci.addEventListener("click", erpRecvClearImport);
  const ca = document.getElementById("recv-clear-all"); if (ca) ca.addEventListener("click", erpRecvClearAll);
  v.querySelectorAll(".recv-sel").forEach(c => c.addEventListener("change", () => { const id = Number(c.dataset.id); if (c.checked) recvSelected.add(id); else recvSelected.delete(id); erpRecvBar(); }));
  v.querySelectorAll(".recv-sel-all").forEach(c => c.addEventListener("change", () => {
    const name = c.dataset.client;
    (groups[name] || []).forEach(p => { if (c.checked) recvSelected.add(p.id); else recvSelected.delete(p.id); });
    erpRenderReceivables();
  }));
  v.querySelectorAll("[data-paid1]").forEach(b => b.addEventListener("click", () => erpRecvMarkPaid([Number(b.dataset.paid1)])));
  v.querySelectorAll("[data-unpay]").forEach(b => b.addEventListener("click", () => erpRecvUnpay(Number(b.dataset.unpay))));
  v.querySelectorAll("[data-fix]").forEach(b => b.addEventListener("click", () => erpRecvEdit(Number(b.dataset.fix))));
  erpRecvBar();
}

// Лентата „Отбележи избраните" — сумата на избраните.
function erpRecvBar() {
  const bar = document.getElementById("recv-paybar"); if (!bar) return;
  const sel = (RECEIVABLES || []).filter(p => recvSelected.has(p.id) && !p.paid);
  const tot = sel.reduce((s, p) => s + recvNum(p.amount), 0);
  if (!sel.length) { bar.innerHTML = `<span class="erp-muted">Избери фактури с отметка, за да ги отбележиш като платени.</span>`; return; }
  bar.innerHTML = `
    <span class="pay-sel-info">Избрани: <b>${sel.length}</b> · сума: <b>${recvMoney(tot)} EUR</b></span>
    <span class="spacer"></span>
    <button class="btn btn-small" id="recv-print">🖨 Списък за събиране</button>
    <button class="btn btn-small btn-primary" id="recv-paysel">✓ Отбележи избраните като платени</button>`;
  document.getElementById("recv-paysel").addEventListener("click", () => erpRecvMarkPaid([...recvSelected]));
  document.getElementById("recv-print").addEventListener("click", () => erpRecvPrint(sel));
}

/* ---------- Корекция (сума/падеж/№) — за грешки от импорта ---------- */
async function erpRecvEdit(id) {
  const p = (RECEIVABLES || []).find(x => x.id === id); if (!p) return;
  const { wrap, close } = erpDialog(`
    <h3>✎ Корекция на вземане</h3>
    <p class="erp-muted" style="margin:-6px 0 10px"><b>${escapeHtml(p.client || "")}</b> · фактура №${escapeHtml(p.invoiceNo || "—")}</p>
    <div class="erp-co-grid">
      <label>Сума (EUR) <input type="number" id="rce-amount" step="any" value="${escapeAttr(String(recvNum(p.amount)))}" /></label>
      <label>Падеж <input type="date" id="rce-due" value="${escapeAttr(p.dueDate || "")}" /></label>
      <label>№ Фактура <input type="text" id="rce-no" value="${escapeAttr(p.invoiceNo || "")}" /></label>
      <label>Клиент <input type="text" id="rce-client" value="${escapeAttr(p.client || "")}" /></label>
    </div>
    <div class="erp-dialog-actions">
      <button class="btn" id="rce-cancel">Отказ</button>
      <button class="btn btn-primary" id="rce-save">Запази</button>
    </div>
    <p class="save-status" id="rce-status"></p>`);
  wrap.querySelector("#rce-cancel").addEventListener("click", close);
  wrap.querySelector("#rce-save").addEventListener("click", async () => {
    p.amount = recvNum(wrap.querySelector("#rce-amount").value);
    p.dueDate = wrap.querySelector("#rce-due").value || "";
    p.invoiceNo = wrap.querySelector("#rce-no").value.trim();
    p.client = wrap.querySelector("#rce-client").value.trim();
    wrap.querySelector("#rce-status").textContent = "Записва…";
    if (await erpRecvSave()) { close(); erpRenderReceivables(); }
  });
}

/* ---------- Платено / върни ---------- */
async function erpRecvMarkPaid(ids) {
  ids = ids.filter(Boolean); if (!ids.length) return;
  const today = recvToday();
  const d = prompt(`Дата на плащане от клиента за ${ids.length} фактур${ids.length === 1 ? "а" : "и"} (ГГГГ-ММ-ДД):`, today);
  if (d === null) return;
  const date = (d || today).trim();
  (RECEIVABLES || []).forEach(p => { if (ids.includes(p.id)) { p.paid = true; p.paidDate = date; } });
  recvSelected.clear();
  if (await erpRecvSave()) erpRenderReceivables();
}
async function erpRecvUnpay(id) {
  const p = (RECEIVABLES || []).find(x => x.id === id); if (!p) return;
  p.paid = false; p.paidDate = "";
  if (await erpRecvSave()) erpRenderReceivables();
}

/* ---------- Импорт от GenCloud (xlsx) ----------
   Клиентски ред (болд) = Партньор без Док.№ → пропуска се (той е сборът).
   Ред с Док.№ = фактура/кредитно → вземане. Кредитните са отрицателни. */
async function erpRecvImport(file) {
  if (!file) return;
  if (typeof XLSX === "undefined") { alert("XLSX библиотеката не е заредена."); return; }
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!raw.length) { alert("Файлът е празен."); return; }
    const pick = (row, ...names) => { for (const n of names) { for (const k of Object.keys(row)) { if (String(k).trim().toLowerCase() === n.toLowerCase()) return row[k]; } } return ""; };
    await erpRecvLoad();
    // „Само липсващите": разпознаваме по НОМЕРА на фактурата (нормализиран —
    // без интервали и водещи нули), независимо как е изписан клиентът.
    // Съществуващите НЕ се пипат (ръчните остават) — само получават реда от
    // файла (ord), за да се показва списъкът в същата подредба.
    const norm = s => String(s || "").replace(/\s+/g, "").replace(/^0+/, "").toLowerCase();
    const byNo = new Map();
    (RECEIVABLES || []).forEach(p => { const k = norm(p.invoiceNo); if (k && !byNo.has(k)) byNo.set(k, p); });
    let added = 0, skipped = 0, headers = 0, seq = 0;
    const review = [];
    raw.forEach(r => {
      const client = String(pick(r, "Партньор", "Клиент", "Контрагент") || "").trim();
      const invoiceNo = String(pick(r, "Док.№", "Док.No", "№ Документ", "№:", "№") || "").trim();
      const docType = String(pick(r, "Док.тип", "Тип документ", "Тип") || "").trim();
      // Клиентски сборен ред (без документ) — пропускаме, той е сборът в жълто.
      if (!invoiceNo || !client) { headers++; return; }
      seq++;   // редът на ФАКТУРИТЕ във файла (за подредбата на екрана)
      const amount = recvNum(pick(r, "ОБЩО (=EUR)", "ОБЩО", "EUR", "Сума"));
      const k = norm(invoiceNo);
      const ex = byNo.get(k);
      if (ex) {
        ex.ord = seq;   // само подредбата — данните на съществуващата не се пипат
        skipped++;
        if (!ex.paid && Math.abs(recvNum(ex.amount) - amount) > 0.005)
          review.push(`№${invoiceNo} ${client}: в Системата ${recvMoney(ex.amount)}, във файла ${recvMoney(amount)} EUR`);
        return;
      }
      RECEIVABLES.push({
        id: recvNextId(), paid: false, paidDate: "", imported: true, ord: seq,
        client, invoiceNo,
        docType: /кредит/i.test(docType) ? "Кредитно" : /дебит/i.test(docType) ? "Дебитно" : "Фактура",
        docDate: recvParseDate(pick(r, "Док.дата", "Дата на док.", "Дата")),
        dueDate: recvParseDate(pick(r, "Падеж", "Дата на падеж")),
        termDays: recvNum(pick(r, "Плащане до дни", "Срок")),
        amount, currency: "EUR",
        payMethod: String(pick(r, "Авоар", "Плащане", "Начин на плащане") || "Банка").trim() || "Банка",
      });
      byNo.set(k, RECEIVABLES[RECEIVABLES.length - 1]);
      added++;
    });
    if (await erpRecvSave()) {
      recvFilter = "all"; erpRenderReceivables();
      let msg = `Импорт готов: ${added} добавени, ${skipped} прескочени (вече ги има — не са пипани)${headers ? `, ${headers} сборни реда` : ""}.`;
      if (review.length) msg += `\n\n⚠ РАЗЛИКА В СУМАТА (провери ръчно):\n` + review.slice(0, 15).join("\n") + (review.length > 15 ? `\n… и още ${review.length - 15}` : "");
      alert(msg);
    }
  } catch (e) { alert("Грешка при импорт: " + (e.message || e)); }
}
// Изтегля (изтрива) импортираните вземания; тези от издадена фактура остават.
async function erpRecvClearImport() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpRecvLoad();
  const imported = (RECEIVABLES || []).filter(p => !p.srcInvoiceId);
  if (!imported.length) { alert("Няма импортирани вземания за изтегляне."); return; }
  if (!confirm(`Да изтегля (изтрия) ли ${imported.length} импортирани вземания?\nТези от издадена фактура остават.`)) return;
  RECEIVABLES = (RECEIVABLES || []).filter(p => p.srcInvoiceId);
  recvSelected.clear();
  if (await erpRecvSave()) { recvFilter = "all"; erpRenderReceivables(); alert("Готово. Можеш да импортираш наново."); }
}
// Пълно изчистване — трие ВСИЧКИ вземания (вкл. архива с платените).
async function erpRecvClearAll() {
  if (!erpDangerPass()) return;   // парола срещу случайно изтриване
  await erpRecvLoad();
  const n = (RECEIVABLES || []).length;
  if (!n) { alert("Вземанията вече са празни."); return; }
  if (!confirm(`Да изтрия ли ВСИЧКИ ${n} вземания (вкл. архива с платените)?\nТова не може да се върне.`)) return;
  RECEIVABLES = [];
  recvSelected.clear();
  if (await erpRecvSave()) { recvFilter = "all"; erpRenderReceivables(); alert("Готово. Вземанията са изчистени."); }
}

/* ---------- Връзка с Фактуриране: издадена фактура → вземане ----------
   Извиква се при издаване на фактура. Проформа НЕ прави вземане. Кредитното е с
   отрицателна сума (намалява дълга). Сумата се води в EUR (BGN се превръща). */
async function erpRecvSyncFromInvoice(o) {
  if (!o || !o.id || !o.posted) return;
  if (o.kind === "proforma") return;              // проформата не е вземане
  await erpRecvLoad();
  const t = (typeof erpInvTotals === "function") ? erpInvTotals(o) : { total: 0 };
  const rate = (o.currency === "BGN") ? RECV_EUR_BGN : 1;
  const amountEur = Math.round((Number(t.total) / rate) * 100) / 100;
  const dueDate = o.dueDate || (Number(o.termDays) > 0 ? recvAddDays(o.issueDate, o.termDays) : "");
  const fields = {
    client: (o.client && o.client.name) || "",
    invoiceNo: o.docNo || "",
    docType: o.kind === "credit" ? "Кредитно" : o.kind === "debit" ? "Дебитно" : "Фактура",
    docDate: o.issueDate || "",
    dueDate, termDays: Number(o.termDays) || 0,
    amount: amountEur, currency: "EUR",
    payMethod: /каса|брой|cash/i.test(o.paymentMethod || "") ? "Каса" : "Банка",
    srcInvoiceId: o.id,
  };
  const idx = (RECEIVABLES || []).findIndex(p => p.srcInvoiceId === o.id);
  if (idx >= 0) { if (RECEIVABLES[idx].paid) return; Object.assign(RECEIVABLES[idx], fields); }
  else RECEIVABLES.push({ id: recvNextId(), paid: false, paidDate: "", ...fields });
  await erpRecvSave();
}
function recvAddDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00"); if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

/* ---------- Печат на списък за събиране ---------- */
function erpRecvPrint(items) {
  const tot = items.reduce((s, p) => s + recvNum(p.amount), 0);
  const rows = items.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.client || "")}</td><td>${escapeHtml(p.invoiceNo || "")}</td><td>${recvFmt(p.dueDate)}</td><td class="r">${recvMoney(p.amount)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>За събиране</title>
    <style>body{font-family:Arial,"DejaVu Sans",sans-serif;margin:18px;color:#111}h1{font-size:18px;color:#0f766e}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}th{background:#ecfdf5}
    td.r{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #0f766e}
    @media print{.noprint{display:none}}.noprint{margin:10px 0}.btnp{background:#0f766e;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}</style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <h1>Вземания за събиране — ${recvFmt(recvToday())}</h1>
    <table><thead><tr><th>№</th><th>Клиент</th><th>Фактура</th><th>Падеж</th><th>Сума (EUR)</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="4" class="r">ОБЩО</td><td class="r">${recvMoney(tot)} EUR</td></tr></tfoot></table></body></html>`;
  const w = window.open("", "_blank"); if (!w) { alert("Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}
