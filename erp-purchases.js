/* Данко Системс — ЕРП „Покупки / Фактури-разходи".
   Въвежда ВСИЧКИ входящи фактури: материали за склад, покупни, услуги, транспорт,
   всякакви разходи. Всяка фактура носи:
   • класификация на редовете: артикулна група · артикул · наш код (+ материал);
   • начин на плащане (Банка/Каса) и срок в дни → дата за плащане;
   • файл (сканът), архив и търсене по артикул/код (сверка на цени, кога е купено).
   Две независими оси:
   1) ПЛАЩАНЕ — Банка+срок → „За плащане" → „Плати" (с дата) → архив „Платена";
      Каса/веднага → директно платена.
   2) ЗАПРИХОДЯВАНЕ — само материалните редове вдигат склад + средна цена
      (BGN се превръща в EUR за средната цена). Услуги/транспорт не пипат склада.
   Пази се в purchases.data (JSON). Ползва ERP/erpDialog/erpToNum/erpNum/erpEur… */

const PU_EUR_BGN = 1.95583;
let erpPurchases = null;
let erpPuFolder = "payable";   // payable | paid | all
let erpPuQuery = "";

async function erpLoadPurchases() {
  const { data, error } = await sb.from("purchases").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  erpPurchases = (data || []).map(r => ({ id: r.id, posted: r.posted, ...(r.data || {}) }));
}
async function erpSavePurchase(o) {
  const data = { ...o }; delete data.id; delete data.posted;
  if (o.id) {
    const { error } = await sb.from("purchases").update({ data, posted: !!o.posted, updated_at: new Date().toISOString() }).eq("id", o.id);
    if (error) throw error;
  } else {
    const { data: ins, error } = await sb.from("purchases").insert({ data, posted: !!o.posted }).select("id").single();
    if (error) throw error;
    o.id = ins.id;
  }
}
async function erpLoadSuppliers() {
  try {
    const { data } = await erpSelectAll("partners", "id,name", "kind", "supplier");
    return (data || []).map(r => ({ id: r.id, name: r.name })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  } catch { return []; }
}

/* ---------- Плащане / статуси ---------- */
function erpPuAddDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00"); if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}
function erpPuCur(o) { return o.currency || "BGN"; }
function erpPuMoney(n, cur) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " " + (cur || "BGN"); }
// Дата за плащане: ръчно зададена или авто (дата + срок), само за Банка+срок.
function erpPuDueDate(o) {
  if (o.dueDate) return o.dueDate;
  if (o.paymentMethod === "Банка" && Number(o.termDays) > 0) return erpPuAddDays(o.date, o.termDays);
  return "";
}
// „За плащане" = Банка, срок>0, още неплатена.
function erpPuIsPayable(o) { return !o.paid && o.paymentMethod === "Банка" && Number(o.termDays) > 0; }
function erpPuStatus(o) { return o.paid ? "платена" : (erpPuIsPayable(o) ? "за плащане" : "платена"); }
function erpPuTotals(o) {
  const base = (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const rate = Number(o.vatRate != null ? o.vatRate : 20);
  const vat = base * rate / 100;
  return { base, vat, total: base + vat, rate };
}

/* ---------- Списък (папки + търсене) ---------- */
async function erpRenderPurchases() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpLoadPurchases(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя покупките</h3><p>${escapeHtml(e.message || String(e))}</p><p class="hint">Пусни обновения <code>erp-setup.sql</code> (таблица purchases) в Supabase.</p></div>`;
    return;
  }
  const q = (erpPuQuery || "").toLowerCase().trim();
  const matchQ = o => !q || (`${o.invoiceNo || ""} ${o.supplierName || ""}`.toLowerCase().includes(q) ||
    (o.lines || []).some(l => `${l.code || ""} ${l.article || ""} ${l.groupName || ""} ${l.name || ""}`.toLowerCase().includes(q)));
  const payableAll = (erpPurchases || []).filter(erpPuIsPayable);
  let rows = (erpPurchases || []).filter(o => {
    if (erpPuFolder === "payable" && !erpPuIsPayable(o)) return false;
    if (erpPuFolder === "paid" && erpPuIsPayable(o)) return false;
    return matchQ(o);
  });
  if (erpPuFolder === "payable") rows.sort((a, b) => String(erpPuDueDate(a) || "9999").localeCompare(String(erpPuDueDate(b) || "9999")));
  else rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const today = new Date().toISOString().slice(0, 10);
  const payableSum = payableAll.reduce((s, o) => s + erpPuTotals(o).total, 0);
  const tab = (key, label) => `<button class="btn btn-small ${erpPuFolder === key ? "btn-primary" : ""}" data-folder="${key}">${label}</button>`;
  v.innerHTML = `
    <div class="erp-toolbar">
      ${tab("payable", `⏳ За плащане (${payableAll.length})`)}
      ${tab("paid", "✓ Платени / архив")}
      ${tab("all", "Всички")}
      <input type="search" id="pu-q" placeholder="🔎 № / доставчик / артикул / код…" value="${escapeAttr(erpPuQuery)}" style="min-width:210px" />
      <span class="spacer"></span>
      <button class="btn btn-small" id="pu-code-hist" title="История на цените по код на артикул">💹 Цени по код</button>
      ${typeof erpPuAIStart === "function" ? '<button class="btn btn-small" id="pu-ai" title="Качи сканирана фактура — Claude я разчита">🤖 Разчети фактура (AI)</button>' : ""}
      <button class="btn btn-small btn-primary" id="erp-pu-new">+ Нова фактура</button>
    </div>
    ${erpPuFolder === "payable" && payableAll.length ? `<p class="hint">За плащане общо: <b>${erpPuMoney(payableSum, "BGN")}</b> · подредени по най-близък срок.</p>` : ""}
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№ Фактура</th><th>Доставчик</th><th>Класификация</th><th class="num">Сума (с ДДС)</th><th>Плащане</th><th>${erpPuFolder === "paid" ? "Платена на" : "Срок"}</th><th></th></tr></thead>
      <tbody>${rows.map(o => {
        const t = erpPuTotals(o); const due = erpPuDueDate(o);
        const overdue = erpPuIsPayable(o) && due && due < today;
        const cls = [...new Set((o.lines || []).map(l => l.groupName).filter(Boolean))].slice(0, 2).join(", ");
        return `<tr class="erp-clickable ${overdue ? "erp-below" : ""}" data-id="${o.id}">
          <td data-label="Дата">${escapeHtml(o.date || "")}</td>
          <td data-label="№ Фактура"><b>${escapeHtml(o.invoiceNo || "—")}</b></td>
          <td data-label="Доставчик">${escapeHtml(o.supplierName || "")}</td>
          <td data-label="Класификация">${escapeHtml(cls || "—")}${o.posted ? ' <span class="erp-co-status" style="background:#dcfce7;color:#166534">заприх.</span>' : ""}</td>
          <td class="num" data-label="Сума">${erpPuMoney(t.total, erpPuCur(o))}</td>
          <td data-label="Плащане">${escapeHtml(o.paymentMethod || "—")}${o.paymentMethod === "Банка" && Number(o.termDays) ? " · " + o.termDays + " дни" : ""}</td>
          <td data-label="Срок">${erpPuFolder === "paid" ? escapeHtml(o.paidDate || o.date || "") : (due ? `${escapeHtml(due)}${overdue ? " ⚠" : ""}` : (o.paid ? "платена" : "—"))}</td>
          <td class="erp-row-actions">${erpPuIsPayable(o) ? `<button class="btn btn-small btn-primary" data-pay="${o.id}" title="Отбележи като платена">💵 Плати</button> ` : ""}<button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
        </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">${erpPuFolder === "payable" ? "Няма фактури за плащане. 🎉" : "Няма фактури."}</td></tr>`}
      </tbody>
    </table>`;
  v.querySelectorAll("[data-folder]").forEach(b => b.addEventListener("click", () => { erpPuFolder = b.dataset.folder; erpRenderPurchases(); }));
  const qEl = document.getElementById("pu-q");
  if (qEl) qEl.addEventListener("input", e => { erpPuQuery = e.target.value; erpRenderPurchases(); });
  document.getElementById("erp-pu-new").addEventListener("click", erpNewPurchase);
  document.getElementById("pu-code-hist").addEventListener("click", () => erpPuCodeHistory(""));
  const aiBtn = document.getElementById("pu-ai");
  if (aiBtn) aiBtn.addEventListener("click", erpPuAIStart);
  v.querySelectorAll("[data-pay]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const o = erpPurchases.find(x => String(x.id) === b.dataset.pay); if (o) erpPuMarkPaid(o); }));
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenPurchase(b.dataset.open); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenPurchase(tr.dataset.id)));
}

function erpNewPurchase() {
  const today = new Date().toISOString().slice(0, 10);
  erpRenderPurchaseForm({ type: "фактура", supplierName: "", supplierId: null, invoiceNo: "", date: today, paymentMethod: "Банка", termDays: 0, dueDate: "", paid: false, paidDate: "", currency: "BGN", vatRate: 20, note: "", files: [], posted: false, lines: [] });
}
function erpOpenPurchase(id) {
  const o = (erpPurchases || []).find(x => String(x.id) === String(id));
  if (o) erpRenderPurchaseForm(JSON.parse(JSON.stringify(o)));
}

/* ---------- Плати ---------- */
async function erpPuMarkPaid(o) {
  const today = new Date().toISOString().slice(0, 10);
  const d = prompt("Дата на плащане (ГГГГ-ММ-ДД):", o.paidDate || today);
  if (d === null) return;
  o.paid = true; o.paidDate = (d || today).trim();
  try { await erpSavePurchase(o); await erpLoadPurchases(); } catch (e) { alert("Грешка: " + (e.message || e)); return; }
  erpRenderPurchases();
}

/* ---------- Форма ---------- */
async function erpRenderPurchaseForm(o) {
  const v = erpView();
  const suppliers = await erpLoadSuppliers();
  const locked = !!o.posted;   // заключва само редовете за склад (заприходените)
  const groups = [...new Set((erpPurchases || []).flatMap(p => (p.lines || []).map(l => l.groupName)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const articles = [...new Set((erpPurchases || []).flatMap(p => (p.lines || []).map(l => l.article)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  const due = erpPuDueDate(o);
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="pu-back">← Назад</button>
      <span class="erp-count">${escapeHtml(o.invoiceNo ? "Фактура № " + o.invoiceNo : "Нова фактура")}${o.paid ? " · ✓ платена " + escapeHtml(o.paidDate || "") : (erpPuIsPayable(o) ? " · ⏳ за плащане" : "")}</span>
      <span class="spacer"></span>
      ${erpPuIsPayable(o) ? '<button class="btn btn-small btn-primary" id="pu-pay">💵 Плати</button>' : ""}
      <button class="btn btn-small" id="pu-save">💾 Запази</button>
      ${locked ? '<span class="erp-count">✓ Заприходена</span>' : '<button class="btn btn-small" id="pu-post" title="Само материалните редове вдигат склад + средна цена">📥 Заприходи материалите</button>'}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Доставчик <input type="text" id="pu-supplier" list="pu-suppliers" value="${escapeAttr(o.supplierName || "")}" placeholder="избери или въведи" />
          <datalist id="pu-suppliers">${suppliers.map(s => `<option value="${escapeAttr(s.name)}"></option>`).join("")}</datalist></label>
        <label>№ Фактура <input type="text" id="pu-invoice" value="${escapeAttr(o.invoiceNo || "")}" /></label>
        <label>Дата <input type="date" id="pu-date" value="${escapeAttr(o.date || "")}" /></label>
        <label>Начин на плащане <select id="pu-method"><option ${o.paymentMethod === "Банка" ? "selected" : ""}>Банка</option><option ${o.paymentMethod === "Каса" ? "selected" : ""}>Каса</option></select></label>
        <label id="pu-term-wrap" ${o.paymentMethod === "Каса" ? 'style="display:none"' : ""}>Срок (дни) <input type="number" id="pu-term" min="0" value="${escapeAttr(String(o.termDays || 0))}" placeholder="0 = веднага" /></label>
        <label id="pu-due-wrap" ${o.paymentMethod === "Каса" ? 'style="display:none"' : ""}>Дата за плащане <input type="date" id="pu-due" value="${escapeAttr(due)}" /></label>
        <label>Валута <select id="pu-cur"><option ${erpPuCur(o) === "BGN" ? "selected" : ""}>BGN</option><option ${erpPuCur(o) === "EUR" ? "selected" : ""}>EUR</option></select></label>
        <label>ДДС ставка % <select id="pu-vat">${["20", "9", "0"].map(r => `<option value="${r}" ${Number(r) === Number(o.vatRate) ? "selected" : ""}>${r}%</option>`).join("")}</select></label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="pu-note" rows="2">${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">📎 Файл на фактурата</h4>
      <div class="erp-co-files"><div id="pu-files-list">${erpPuFilesHtml(o)}</div>
        <label class="btn btn-small co-attach-btn">⬆ Прикачи файл<input type="file" id="pu-file-input" multiple hidden /></label>
        <span class="erp-muted" id="pu-file-status"></span></div>

      <h4 class="erp-group-head">Редове (класификация)</h4>
      <table class="report-table erp-table" id="pu-lines">
        <thead><tr><th>Група</th><th>Артикул</th><th>Код</th><th class="num">Кол.</th><th>МЕ</th><th class="num">Ед. цена</th><th class="num">Сума</th><th></th></tr></thead>
        <tbody>${erpPuLinesHtml(o, locked)}</tbody>
      </table>
      <div class="erp-co-actions">
        <button class="btn btn-small" id="pu-add-mat">+ Материал (склад)</button>
        <button class="btn btn-small" id="pu-add-exp">+ Разход / услуга</button>
      </div>
      <datalist id="pu-groups">${groups.map(g => `<option value="${escapeAttr(g)}"></option>`).join("")}</datalist>
      <datalist id="pu-articles">${articles.map(a => `<option value="${escapeAttr(a)}"></option>`).join("")}</datalist>
      <div class="erp-sale-totals" id="pu-totals"></div>
      <p class="hint">„Материал (склад)" се брои при заприходяване (вдига наличност + средна цена). „Разход/услуга" се класифицира и плаща, но не влиза в склада. Средните цени се водят в EUR — BGN се превръща авт.</p>
    </div>`;

  const bind = (id, k, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("input", () => { o[k] = el.value; if (fn) fn(); }); };
  bind("pu-invoice", "invoiceNo"); bind("pu-date", "date", () => erpPuSyncDue(o)); bind("pu-note", "note");
  bind("pu-term", "termDays", () => erpPuSyncDue(o)); bind("pu-due", "dueDate");
  document.getElementById("pu-supplier").addEventListener("input", e => { o.supplierName = e.target.value; const m = suppliers.find(s => s.name === e.target.value); o.supplierId = m ? m.id : null; });
  document.getElementById("pu-method").addEventListener("change", e => { o.paymentMethod = e.target.value; erpRenderPurchaseForm(o); });
  document.getElementById("pu-cur").addEventListener("change", e => { o.currency = e.target.value; erpPuTotalsBox(o); });
  document.getElementById("pu-vat").addEventListener("change", e => { o.vatRate = Number(e.target.value); erpPuTotalsBox(o); });
  document.getElementById("pu-back").addEventListener("click", erpRenderPurchases);
  document.getElementById("pu-save").addEventListener("click", () => erpPuSaveClick(o));
  const payBtn = document.getElementById("pu-pay"); if (payBtn) payBtn.addEventListener("click", async () => { await erpPuMarkPaid(o); erpRenderPurchaseForm(o); });
  const postBtn = document.getElementById("pu-post"); if (postBtn) postBtn.addEventListener("click", () => erpPostPurchase(o));
  document.getElementById("pu-add-mat").addEventListener("click", () => erpPuAddMaterial(o));
  document.getElementById("pu-add-exp").addEventListener("click", () => { o.lines.push({ groupName: "", article: "", code: "", batch: "", qty: 1, unit: "бр.", unitPrice: "" }); erpPuRefreshFull(o); });
  const fi = document.getElementById("pu-file-input"); if (fi) fi.addEventListener("change", e => erpPuAttachFiles(o, e.target.files));
  const fl = document.getElementById("pu-files-list"); if (fl) fl.addEventListener("click", e => { const rm = e.target.closest("[data-pufrm]"); if (rm) { e.preventDefault(); erpPuRemoveFile(o, Number(rm.dataset.pufrm)); } });
  erpPuWireLines(o, locked);
  erpPuTotalsBox(o);
}
function erpPuSyncDue(o) {
  o.dueDate = "";   // изчисти ръчната, за да се преизчисли авто
  const el = document.getElementById("pu-due"); if (el) el.value = erpPuDueDate(o);
}

function erpPuLinesHtml(o, locked) {
  return (o.lines || []).map((l, i) => {
    const isMat = !!l.materialId;
    const ro = locked && isMat;   // заприходените материални редове са заключени
    return `<tr>
      <td data-label="Група">${ro ? escapeHtml(l.groupName || "") : `<input type="text" class="pu-grp" data-i="${i}" list="pu-groups" value="${escapeAttr(l.groupName || "")}" style="width:120px" />`}</td>
      <td data-label="Артикул">${ro ? escapeHtml(l.article || l.name || "") : `<input type="text" class="pu-art" data-i="${i}" list="pu-articles" value="${escapeAttr(l.article || l.name || "")}" style="width:150px" />`}</td>
      <td data-label="Код">${escapeHtml(l.code || "")}${isMat ? ' <span class="erp-muted">склад</span>' : ""}</td>
      <td class="num" data-label="Кол.">${ro ? erpNum(l.qty) : `<input type="number" class="pu-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:80px" />`}</td>
      <td data-label="МЕ">${ro ? escapeHtml(l.unit || "") : `<input type="text" class="pu-unit" data-i="${i}" value="${escapeAttr(l.unit || "бр.")}" style="width:52px" />`}</td>
      <td class="num" data-label="Ед. цена">${ro ? erpNum(l.unitPrice) : `<input type="number" class="pu-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:90px" placeholder="—" />`}</td>
      <td class="num" data-label="Сума">${erpPuMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpPuCur(o))}</td>
      <td class="erp-row-actions">${ro ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`; }).join("") || `<tr><td colspan="8" class="report-empty">Няма редове. Добави материал или разход.</td></tr>`;
}
function erpPuWireLines(o, locked) {
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  const line = el => o.lines[Number(el.dataset.i)];
  body.querySelectorAll(".pu-grp").forEach(el => el.addEventListener("input", () => line(el).groupName = el.value));
  body.querySelectorAll(".pu-art").forEach(el => el.addEventListener("input", () => line(el).article = el.value));
  body.querySelectorAll(".pu-unit").forEach(el => el.addEventListener("input", () => line(el).unit = el.value));
  body.querySelectorAll(".pu-qty").forEach(el => el.addEventListener("input", () => { line(el).qty = erpToNum(el.value); erpPuLineSums(o); }));
  body.querySelectorAll(".pu-price").forEach(el => el.addEventListener("input", () => { line(el).unitPrice = erpToNum(el.value); erpPuLineSums(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpPuRefreshFull(o); }));
}
function erpPuLineSums(o) {
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => { const l = (o.lines || [])[i]; if (!l) return; const c = tr.querySelector('td[data-label="Сума"]'); if (c) c.textContent = erpPuMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), erpPuCur(o)); });
  erpPuTotalsBox(o);
}
function erpPuRefreshFull(o) { const body = document.querySelector("#pu-lines tbody"); if (body) { body.innerHTML = erpPuLinesHtml(o, !!o.posted); erpPuWireLines(o, !!o.posted); } erpPuTotalsBox(o); }
function erpPuTotalsBox(o) {
  const box = document.getElementById("pu-totals"); if (!box) return;
  const t = erpPuTotals(o); const cur = erpPuCur(o);
  const eur = cur === "BGN" ? ` <span class="erp-muted">≈ ${erpPuMoney(t.total / PU_EUR_BGN, "EUR")}</span>` : "";
  box.innerHTML = `<table class="erp-sale-sum">
    <tr><td>Данъчна основа</td><td class="num">${erpPuMoney(t.base, cur)}</td></tr>
    <tr><td>ДДС ${t.rate}%</td><td class="num">${erpPuMoney(t.vat, cur)}</td></tr>
    <tr class="grand"><td><b>Общо с ДДС</b></td><td class="num"><b>${erpPuMoney(t.total, cur)}${eur}</b></td></tr></table>`;
}

function erpPuAddMaterial(o) {
  const { wrap, close } = erpDialog(`
    <h3>Добави материал (влиза в склада)</h3>
    <input type="search" id="pu-pp-q" placeholder="търси код или име…" />
    <div id="pu-pp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="pu-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#pu-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.materials.slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(m => `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">${escapeHtml(m.unit || "")}${m.avg_cost ? " · " + erpEur(m.avg_cost) : ""}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const m = ERP.matById[Number(b.dataset.id)];
      o.lines.push({ materialId: m.id, code: m.code, name: m.name, article: m.name, groupName: m.group_name || "", unit: m.unit, qty: 1, unitPrice: "" });
      close(); erpPuRefreshFull(o);
    }));
  };
  render(""); wrap.querySelector("#pu-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#pu-pp-cancel").addEventListener("click", close);
}

/* ---------- Файлове ---------- */
function erpPuFilesHtml(o) {
  const files = (o && o.files) || [];
  if (!files.length) return `<p class="erp-muted" style="margin:0 0 6px">Няма прикачен файл. Прикачи сканираната фактура (PDF/снимка).</p>`;
  return `<ul class="co-file-ul">${files.map((f, i) => `<li><a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener">📄 ${escapeHtml(f.name || "файл")}</a> <button type="button" class="btn btn-small btn-danger" data-pufrm="${i}">×</button></li>`).join("")}</ul>`;
}
async function erpPuAttachFiles(o, fileList) {
  const files = Array.from(fileList || []); if (!files.length) return;
  const st = document.getElementById("pu-file-status");
  if (!o.id) { if (st) st.textContent = "Записвам…"; try { await erpSavePurchase(o); } catch (e) { alert("Първо запази фактурата: " + (e.message || e)); return; } }
  o.files = o.files || [];
  for (const file of files) {
    if (st) st.textContent = "Качвам „" + file.name + "“…";
    const path = `purchases/${o.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    o.files.push({ name: file.name, type: file.type, path, url: data.publicUrl });
  }
  try { await erpSavePurchase(o); } catch (e) {}
  if (st) st.textContent = "";
  const list = document.getElementById("pu-files-list"); if (list) list.innerHTML = erpPuFilesHtml(o);
  const inp = document.getElementById("pu-file-input"); if (inp) inp.value = "";
}
async function erpPuRemoveFile(o, i) {
  const f = (o.files || [])[i]; if (!f) return;
  if (!confirm(`Да махна ли „${f.name || ""}"?`)) return;
  if (f.path) { try { await sb.storage.from(BUCKET).remove([f.path]); } catch (e) {} }
  o.files.splice(i, 1);
  try { await erpSavePurchase(o); } catch (e) {}
  const list = document.getElementById("pu-files-list"); if (list) list.innerHTML = erpPuFilesHtml(o);
}

async function erpPuSaveClick(o) {
  const btn = document.getElementById("pu-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  // Каса или „веднага" (Банка, срок 0) → директно платена, с дата на фактурата.
  if (!o.paid && (o.paymentMethod === "Каса" || !(Number(o.termDays) > 0))) { o.paid = true; if (!o.paidDate) o.paidDate = o.date || new Date().toISOString().slice(0, 10); }
  try { await erpSavePurchase(o); await erpLoadPurchases(); if (btn) { btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) { btn.textContent = "💾 Запази"; btn.disabled = false; } }, 1400); } }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; } alert("Грешка при запис: " + (e.message || e)); }
}

/* ---------- История на цените по код ---------- */
function erpPuCodeHistory(preCode) {
  const rows = [];
  (erpPurchases || []).forEach(o => (o.lines || []).forEach(l => { if (l.code) rows.push({ code: l.code, article: l.article || l.name || "", date: o.date || "", supplier: o.supplierName || "", qty: erpToNum(l.qty) || 0, price: erpToNum(l.unitPrice) || 0, cur: erpPuCur(o), inv: o.invoiceNo || "" }); }));
  const { wrap, close } = erpDialog(`
    <h3>💹 История на цените по артикул</h3>
    <input type="search" id="puh-q" value="${escapeAttr(preCode || "")}" placeholder="код или име на артикул…" />
    <div id="puh-list" style="max-height:60vh;overflow:auto;margin-top:8px"></div>
    <div class="erp-dialog-actions"><button class="btn" id="puh-close">Затвори</button></div>`);
  const listEl = wrap.querySelector("#puh-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let r = rows.filter(x => !q || (`${x.code} ${x.article}`.toLowerCase().includes(q)));
    r.sort((a, b) => a.code.localeCompare(b.code) || String(b.date).localeCompare(String(a.date)));
    listEl.innerHTML = r.length ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Артикул</th><th>Дата</th><th>Доставчик</th><th class="num">Кол.</th><th class="num">Ед. цена</th><th>№</th></tr></thead>
      <tbody>${r.slice(0, 200).map(x => `<tr><td><b>${escapeHtml(x.code)}</b></td><td>${escapeHtml(x.article)}</td><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.supplier)}</td><td class="num">${erpNum(x.qty)}</td><td class="num">${erpPuMoney(x.price, x.cur)}</td><td>${escapeHtml(x.inv)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="report-empty">Няма съвпадения.</p>`;
  };
  render(preCode || ""); wrap.querySelector("#puh-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#puh-close").addEventListener("click", close);
}

/* ---------- Заприходяване (само материалните редове; BGN→EUR за средната цена) ---------- */
async function erpPostPurchase(o) {
  if (o.posted) { alert("Вече е заприходена."); return; }
  const matLines = (o.lines || []).filter(l => l.materialId && (erpToNum(l.qty) || 0) > 0);
  if (!matLines.length) { alert("Няма материални редове за заприходяване. Само редове, добавени с бутона Материал (склад), влизат в склада."); return; }
  if (!confirm(`Да заприходя ли ${matLines.length} материала в склада? Наличностите се вдигат и средните цени се обновяват (веднъж).`)) return;
  try { await erpSavePurchase(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

  const [stk, mat] = await Promise.all([sb.from("v_material_stock").select("id,stock"), sb.from("materials").select("id,avg_cost")]);
  if (stk.error || mat.error) { alert("Грешка: " + ((stk.error || mat.error).message)); return; }
  const stockById = {}, avgById = {};
  (stk.data || []).forEach(r => stockById[r.id] = Number(r.stock) || 0);
  (mat.data || []).forEach(r => avgById[r.id] = Number(r.avg_cost) || 0);
  const rate = erpPuCur(o) === "BGN" ? PU_EUR_BGN : 1;   // средните цени са в EUR

  const ref = `Фактура ${o.invoiceNo || "—"} · ${o.supplierName || ""}`.trim();
  const moves = [], avgUpdates = [];
  for (const l of matLines) {
    const qty = erpToNum(l.qty) || 0;
    const priceEur = (erpToNum(l.unitPrice) || 0) / rate;
    moves.push({ material_id: l.materialId, kind: "входящ", quantity: qty, ref, created_by: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || null });
    if (priceEur > 0) {
      const base = Math.max(0, stockById[l.materialId] || 0), avg = avgById[l.materialId] || 0;
      const newAvg = (base + qty) > 0 ? (base * avg + qty * priceEur) / (base + qty) : priceEur;
      avgById[l.materialId] = newAvg; avgUpdates.push({ id: l.materialId, avg: newAvg });
    }
    stockById[l.materialId] = (stockById[l.materialId] || 0) + qty;
  }
  const ins = await sb.from("stock_movements").insert(moves);
  if (ins.error) { alert("Грешка при движенията: " + ins.error.message); return; }
  for (const u of avgUpdates) { const { error } = await sb.from("materials").update({ avg_cost: u.avg }).eq("id", u.id); if (error) { alert("Грешка при цена: " + error.message); return; } }

  o.posted = true; o.postedAt = new Date().toISOString();
  try { await erpSavePurchase(o); } catch {}
  await erpLoadAll(); await erpLoadPurchases();
  alert(`Готово! Заприходени ${moves.length} материала. Средните цени (EUR) са обновени.`);
  erpRenderPurchaseForm(o);
}
