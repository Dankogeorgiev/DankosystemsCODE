/* Данко Системс — ЕРП „Заявки от клиенти".
   Стандартни поръчки за продукти от каталога: наш № + клиентски №, забележка,
   няколко продукта, разбивка на материалите, пускане в производство (всички
   редове наведнъж) и проследяване. Заявката се пази в customer_orders.data (JSON).
   Ползва ERP/erpDialog/erpBuildTasks/erpToNum/erpNum/erpEur от другите erp-*.js. */

let erpCOList = null;       // заредени заявки
let erpCOSort = "deadline"; // подредба на списъка
let erpCOQuery = "";        // търсене в списъка
let erpCOHideDone = true;   // скрий завършените (по подразбиране)
let erpCOStatusFilter = ""; // филтър по статус
let erpCOClientFilter = ""; // филтър по клиент

// Подрежда/филтрира заявките за списъка.
function erpCOSortRows(rows) {
  const q = (erpCOQuery || "").toLowerCase().trim();
  let out = rows.filter(o => !q || `${o.ourNo || ""} ${o.clientNo || ""} ${o.clientName || ""} ${o.status || ""}`.toLowerCase().includes(q));
  if (erpCOStatusFilter) out = out.filter(o => (o.status || "нова") === erpCOStatusFilter);
  if (erpCOClientFilter) out = out.filter(o => (o.clientName || "") === erpCOClientFilter);
  // Завършените се крият по подразбиране (освен при търсене или изрично избран статус).
  if (erpCOHideDone && !q && !erpCOStatusFilter) out = out.filter(o => (o.status || "нова") !== "завършена");
  const val = o => erpCOValueLeft(o);   // подрежда се по ОСТАВАЩАТА стойност
  const S = String;
  const cmp = {
    deadline: (a, b) => S(a.deadline || "9999-99-99").localeCompare(S(b.deadline || "9999-99-99")),   // най-скорошен срок отгоре
    client: (a, b) => (a.clientName || "").localeCompare(b.clientName || "", "bg"),
    date: (a, b) => S(b.date || "").localeCompare(S(a.date || "")),                                    // най-нови отгоре
    ourNo: (a, b) => S(a.ourNo || "").localeCompare(S(b.ourNo || ""), "bg", { numeric: true }),
    status: (a, b) => (a.status || "").localeCompare(b.status || "", "bg"),
    value: (a, b) => val(b) - val(a),                                                                   // най-голяма стойност отгоре
  }[erpCOSort] || (() => 0);
  return out.sort(cmp);
}
let erpClientsCache = null; // клиенти от Контакти (за избор)

async function erpLoadCustomerOrders() {
  const { data, error } = await erpSelectAll("customer_orders", "*");
  if (!error) (data || []).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  if (error) throw error;
  erpCOList = (data || []).map(r => ({ id: r.id, ...(r.data || {}) }));
  if (typeof erpPLEnsureCache === "function") { try { await erpPLEnsureCache(); } catch (e) {} }   // клиентски ценови листи
}

// Ако цялото производство на заявката е готово → статус „готова за продажба".
// Ползва се и от Мастер отчитане (за да не остане „в производство" след докарване).
async function erpMarkOrderReadyIfDone(orderId) {
  if (!orderId) return false;
  try {
    const co = await sb.from("customer_orders").select("id,data").eq("id", orderId).maybeSingle();
    if (!co || !co.data) return false;   // не е клиентска заявка (мостра/за склад)
    const d = co.data.data || {};
    if (d.status !== "в производство") return false;
    const { rows } = (typeof erpFlowTasksFor === "function") ? await erpFlowTasksFor(orderId) : { rows: [] };
    if (!rows.length) return false;
    const allDone = rows.every(r => { const dd = r.data || {}; const q = Number(dd.qty) || 0, p = Number(dd.produced) || 0; return q > 0 && p >= q; });
    if (!allDone) return false;
    d.status = "готова за продажба";
    await sb.from("customer_orders").update({ data: d, updated_at: new Date().toISOString() }).eq("id", orderId);
    if (typeof erpCOList !== "undefined" && Array.isArray(erpCOList)) { const it = erpCOList.find(x => String(x.id) === String(orderId)); if (it) it.status = d.status; }
    return true;
  } catch (e) { return false; }
}

async function erpLoadClients() {
  if (erpClientsCache) return erpClientsCache;
  try {
    // Клиентите идват от новата ЕРП директория (таблица partners, kind=customer).
    const { data } = await erpSelectAll("partners", "id,name", "kind", "customer");
    erpClientsCache = (data || []).map(r => ({ id: r.id, company: r.name }))
      .sort((a, b) => (a.company || "").localeCompare(b.company || "", "bg"));
  } catch { erpClientsCache = []; }
  return erpClientsCache;
}

// Бърз „+ Нов клиент" направо от прозореца на заявката — записва в partners
// (kind=customer) и веднага го избира в заявката.
function erpCOAddClient(o) {
  const { wrap, close } = erpDialog(`
    <h3>Нов клиент</h3>
    <label>Име / Фирма<input type="text" id="nc-name" placeholder="Фирма ООД" /></label>
    <label>Лице за контакт<input type="text" id="nc-person" /></label>
    <label>Телефон<input type="text" id="nc-phone" /></label>
    <label>Имейл<input type="text" id="nc-email" /></label>
    <label>Град<input type="text" id="nc-city" /></label>
    <label>Улица / адрес<input type="text" id="nc-street" /></label>
    <label>ЕИК<input type="text" id="nc-eik" placeholder="за фактурите" /></label>
    <label>ДДС №<input type="text" id="nc-vat" /></label>
    <label>МОЛ<input type="text" id="nc-mol" placeholder="управител / МОЛ" /></label>
    <div class="erp-dialog-actions"><button class="btn" id="nc-cancel">Отказ</button><button class="btn btn-primary" id="nc-save">Добави</button></div>
    <p class="save-status" id="nc-status"></p>`);
  wrap.querySelector("#nc-cancel").addEventListener("click", close);
  wrap.querySelector("#nc-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#nc-name").value.trim();
    const status = wrap.querySelector("#nc-status");
    if (!name) { status.textContent = "Въведи име."; return; }
    const val = id => { const el = wrap.querySelector("#nc-" + id); const v = el ? el.value.trim() : ""; return v || null; };
    const payload = {
      kind: "customer", name, person: val("person"), phone: val("phone"), email: val("email"),
      city: val("city"), street: val("street"), vat: val("vat"), eik: val("eik"), mol: val("mol"),
    };
    status.textContent = "Записва…";
    // Пази и полета, които базата още няма (ЕИК/МОЛ) — без промени по нея.
    const { id, error } = (typeof erpPartnerSaveSafe === "function")
      ? await erpPartnerSaveSafe(null, payload)
      : await sb.from("partners").insert(payload).select("id").single().then(r => ({ id: r.data && r.data.id, error: r.error }));
    if (error) { status.textContent = "⚠ " + error.message; return; }
    o.clientName = name; o.clientId = id;
    erpClientsCache = null;                                     // клиентите да се презаредят
    if (typeof erpPartners !== "undefined") erpPartners = null; // и екранът Клиенти/Доставчици
    close();
    erpRenderCOForm(o);                                        // пре-рисуваме с новия клиент избран
  });
}

function erpNextOrderNo() {
  let max = 0;
  (erpCOList || []).forEach(o => {
    const c = String(o.ourNo || "").trim();
    if (/^\d+$/.test(c)) { const n = parseInt(c, 10); if (n > max) max = n; }
  });
  return String(max + 1);
}

async function erpSaveCO(o) {
  const data = { ...o }; delete data.id;
  if (o.id) {
    const { error } = await sb.from("customer_orders").update({ data, updated_at: new Date().toISOString() }).eq("id", o.id);
    if (error) throw error;
  } else {
    const { data: ins, error } = await sb.from("customer_orders").insert({ data }).select("id").single();
    if (error) throw error;
    o.id = ins.id;
  }
}

/* ---------- Частична завършеност ----------
   Доставени бройки (l.delivered) спрямо поръчаните — за процента в списъка
   и формата. Заявка „в производство" с частични доставки носи ДВА баджа:
   статуса + „частично · N%" с лента на прогреса. */
/* ---------- Стойност на заявката ----------
   „Цялата" е поръчаното × цена, а в списъка се показва ОСТАВАЩАТА: недоставените
   бройки × цена. Иначе частично изпълнените заявки надуват сумата с неща, които
   вече са излезли и фактурирани. */
function erpCOValue(o) {
  return (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
}
function erpCOValueLeft(o) {
  return (o.lines || []).reduce((s, l) => {
    const q = erpToNum(l.qty) || 0;
    const d = Math.min(Math.max(0, Number(l.delivered) || 0), q);
    return s + (q - d) * (erpToNum(l.unitPrice) || 0);
  }, 0);
}
function erpCOValueCell(o) {
  const tot = erpCOValue(o), left = erpCOValueLeft(o);
  if (Math.abs(tot - left) < 0.005) return erpEur(tot);
  return `<b>${erpEur(left)}</b><div class="erp-muted co-val-full" title="Цялата заявка ${erpEur(tot)}; разликата е вече доставена">от ${erpEur(tot)}</div>`;
}
function erpCOPct(o) {
  let tot = 0, del = 0;
  (o.lines || []).forEach(l => { const q = erpToNum(l.qty) || 0; tot += q; del += Math.min(Number(l.delivered) || 0, q); });
  return { tot, del, pct: tot > 0 ? Math.round(del / tot * 100) : 0 };
}
function erpCOStatusCell(o) {
  const st = o.status || "нова";
  const p = erpCOPct(o);
  const badge = `<span class="erp-co-status s-${escapeAttr(st)}">${escapeHtml(st)}</span>`;
  if (!(p.del > 0 && p.pct < 100 && st !== "завършена")) return badge;
  return `${badge}<span class="erp-co-status co-partial" title="доставени ${erpNum(p.del)} от ${erpNum(p.tot)} бр.">частично · ${p.pct}%</span>
    <div class="co-progress" title="доставени ${erpNum(p.del)} от ${erpNum(p.tot)} бр."><div class="co-progress-fill" style="width:${p.pct}%"></div></div>`;
}

/* ---------- „В плана за седмицата ли е?" ----------
   Показва се до статуса. Данните идват от loading-plan.js (app_config
   „loading_plan"); ако модулът още не е зареден — клетката стои празна и
   се попълва, щом дойде (erpCOPlanFill). */
function erpCOPlanCell(o) {
  const inf = (typeof lpOrderPlanInfo === "function") ? lpOrderPlanInfo(o) : null;
  if (!inf) return `<span class="erp-muted co-plan-no" title="Заявката не е включена в план за седмица">—</span>`;
  const wk = `седм. ${inf.weekNo}`;
  const more = inf.more ? ` <span class="erp-muted">+${inf.more}</span>` : "";
  const per = `${inf.from}–${inf.to}`;
  if (inf.done) return `<span class="co-plan ok" title="Планирана за ${per} и вече е излязла напълно">🚚 ${wk} ✅</span>${more}`;
  if (inf.late) return `<span class="co-plan late" title="Изостава с ${inf.weeks === 1 ? "1 седмица" : inf.weeks + " седмици"} — първо планирана за седмицата от ${erpDMY(inf.orig)}. Сега е в ${per}.">🚚 ${wk} ⚠</span>${more}`;
  if (inf.sent > 0) return `<span class="co-plan part" title="Планирана за ${per}: излезли ${erpNum(inf.sent)} от ${erpNum(inf.plan)} бр.">🚚 ${wk} · ${inf.pct}%</span>${more}`;
  return `<span class="co-plan" title="Планирана за ${per} — ${erpNum(inf.plan)} бр.">🚚 ${wk}</span>${more}`;
}
/* Същото, но с думи — за формата на заявката (под падащия статус). */
function erpCOPlanLine(o) {
  const inf = (typeof lpOrderPlanInfo === "function") ? lpOrderPlanInfo(o) : null;
  if (!inf) return `<span class="erp-muted co-plan-no">🚚 не е в план за седмица</span>`;
  const per = `седмица ${inf.weekNo} (${inf.from}–${inf.to})`;
  if (inf.done) return `<span class="co-plan ok">🚚 ${per} — излязла напълно ✅</span>`;
  if (inf.late) return `<span class="co-plan late">🚚 ${per} — ⚠ изостава с ${inf.weeks === 1 ? "1 седмица" : inf.weeks + " седмици"} (първо планирана за ${erpDMY(inf.orig)})</span>`;
  if (inf.sent > 0) return `<span class="co-plan part">🚚 ${per} — излезли ${erpNum(inf.sent)} от ${erpNum(inf.plan)} бр. (${inf.pct}%)</span>`;
  return `<span class="co-plan">🚚 ${per} — планирани ${erpNum(inf.plan)} бр.</span>`;
}
/* ---------- Документи по заявката: продажба и фактура ----------
   Продажбата се свързва по fromOrderId, фактурата — през продажбата
   (s.invoiceNo/s.invoiceId) или по „Поръчка на клиента" на фактурата. */
function erpCODocsOf(o) {
  const sales = ((typeof erpSales !== "undefined" && erpSales) || [])
    .filter(s => s && String(s.fromOrderId || "") === String(o.id))
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const invs = [];
  const seen = new Set();
  sales.forEach(s => {
    if (!s.invoiceNo || seen.has(String(s.invoiceNo))) return;
    seen.add(String(s.invoiceNo));
    invs.push({ id: s.invoiceId || null, docNo: s.invoiceNo });
  });
  // Фактури, писани направо по номера на поръчката на клиента (без продажба).
  const cn = String(o.clientNo || "").trim().toLowerCase();
  const on = String(o.ourNo || "").trim().toLowerCase();
  ((typeof erpInvoices !== "undefined" && erpInvoices) || []).forEach(i => {
    if (!i || !i.docNo || seen.has(String(i.docNo))) return;
    const ref = String(i.orderRef || "").trim().toLowerCase();
    if (!ref) return;
    const hit = (cn.length >= 3 && ref.includes(cn)) || (on && ref === on);
    if (!hit) return;
    seen.add(String(i.docNo));
    invs.push({ id: i.id, docNo: i.docNo });
  });
  return { sales, invs };
}
function erpCODocsLine(o) {
  if (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production) return "";
  const { sales, invs } = erpCODocsOf(o);
  if (!sales.length && !invs.length)
    return `<span class="erp-muted co-docs-no">🧾 няма пусната продажба или фактура по тази заявка</span>`;
  const sc = sales.map(s => `<button type="button" class="co-doc${s.posted ? " ok" : " draft"}" data-sale="${escapeAttr(String(s.id))}" title="${s.posted ? "Осчетоводена продажба" : "Чернова — още не е осчетоводена"} · ${escapeAttr(erpDMY(s.date))}. Клик — отвори.">💶 продажба № ${escapeHtml(String(s.saleNo || "—"))}${s.posted ? " ✓" : " (чернова)"}</button>`).join("");
  const ic = invs.map(i => `<button type="button" class="co-doc inv" ${i.id ? `data-inv="${escapeAttr(String(i.id))}"` : ""} title="Издадена фактура${i.id ? ". Клик — отвори." : ""}">🧾 фактура № ${escapeHtml(String(i.docNo))}</button>`).join("");
  return sc + ic;
}
function erpCODocsWire(root, o) {
  (root || document).querySelectorAll("[data-sale]").forEach(b => b.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if (typeof erpOpenSale === "function") erpOpenSale(b.dataset.sale);
  }));
  (root || document).querySelectorAll("[data-inv]").forEach(b => b.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if (typeof erpOpenInvoice === "function") erpOpenInvoice(b.dataset.inv);
  }));
}
/* Допълва клетките, след като планът се зареди фоново. */
function erpCOPlanFill() {
  const byId = new Map((erpCOList || []).map(x => [String(x.id), x]));
  document.querySelectorAll("#co-orders-table td[data-plan-for]").forEach(td => {
    const o = byId.get(td.dataset.planFor);
    if (o) td.innerHTML = erpCOPlanCell(o);
  });
}

/* ---------- Списъкът: ред + папки по клиент ----------
   При подредба „Клиент (А→Я)" клиентите с 2+ заявки се групират в ПАПКА —
   клик върху нея разгъва/скрива заявките на клиента. */
let erpCOOpenClients = new Set();
function erpCORowHtml(o) {
  return `
          <tr class="erp-clickable" data-id="${o.id}">
            <td data-label="Наш №">${erpCOIsNonstd(o) ? '<span title="Нестандартна поръчка — изделия по клиентски код" style="color:#f59e0b">📦</span> ' : ""}<b>${escapeHtml(o.ourNo || "—")}</b></td>
            <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
            <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
            <td data-label="Дата">${erpDMY(o.date)}</td>
            <td data-label="Срок">${erpDMY(o.deadline)}</td>
            <td class="num" data-label="Продукти">${(o.lines || []).length}</td>
            <td class="num sell-cell" data-label="Стойност">${erpCOValueCell(o)}</td>
            <td data-label="Статус">${erpCOStatusCell(o)}</td>
            <td data-label="План" data-plan-for="${o.id}">${erpCOPlanCell(o)}</td>
            <td data-label="Файл">${erpCOFileCell(o)}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
          </tr>`;
}
function erpCOListHtml(rows) {
  if (erpCOSort !== "client" || (erpCOQuery || "").trim()) return rows.map(erpCORowHtml).join("");
  const groups = new Map();
  rows.forEach(o => { const c = o.clientName || "— без клиент —"; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(o); });
  let out = "";
  for (const [c, list] of groups) {
    const open = erpCOOpenClients.has(c);   // всеки клиент е в папка (и с 1 заявка)
    const sum = list.reduce((s, o) => s + erpCOValueLeft(o), 0);
    out += `<tr class="co-folder erp-clickable" data-folder="${escapeAttr(c)}"><td colspan="11">${open ? "📂 ▾" : "📁 ▸"} <b>${escapeHtml(c)}</b> — ${list.length} ${list.length === 1 ? "заявка" : "заявки"} <span class="sell-cell erp-muted" title="Само недоставеното">· остава ${erpEur(sum)}</span><span class="erp-muted" style="float:right">${open ? "скрий" : "отвори"}</span></td></tr>`;
    if (open) out += list.map(erpCORowHtml).join("");
  }
  return out;
}

/* ---------- Печат на заявка ---------- */
function erpPrintCO(o) {
  // Цените се крият за „само производство" достъп (както в списъка).
  const showPrices = !(typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production);
  const s = (typeof ERP_SELLER !== "undefined" && ERP_SELLER) || {};
  const total = (o.lines || []).reduce((sum, l) => sum + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const rows = (o.lines || []).map((l, i) => {
    const del = Number(l.delivered) || 0;
    const rem = Math.max(0, (erpToNum(l.qty) || 0) - del);
    const delNote = del > 0 ? `<br><span class="muted">доставени ${erpNum(del)}${rem > 0 ? ", остават " + erpNum(rem) : " (напълно)"}</span>` : "";
    return `<tr>
      <td>${i + 1}</td><td>${escapeHtml(l.code || "")}</td>
      <td>${escapeHtml(l.name || "")}${delNote}</td>
      <td class="r">${erpNum(l.qty)}</td>
      ${showPrices ? `<td class="r">${erpEur((erpToNum(l.unitPrice) || 0))}</td><td class="r">${erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0))}</td>` : ""}
    </tr>`;
  }).join("") || `<tr><td colspan="${showPrices ? 6 : 4}" class="c muted">— няма продукти —</td></tr>`;

  const sellerLines = [
    s.eik ? "ЕИК: " + escapeHtml(s.eik) : "",
    s.vat ? "ДДС №: " + escapeHtml(s.vat) : "",
    (s.city || s.address) ? escapeHtml([s.city, s.address].filter(Boolean).join(", ")) : "",
    s.mol ? "МОЛ: " + escapeHtml(s.mol) : "",
  ].filter(Boolean).join("<br>");

  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>Заявка ${escapeHtml(o.ourNo || "")}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 22px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f766e;padding-bottom:8px;margin-bottom:12px}
    .head h1{font-size:22px;margin:0;color:#0f766e;letter-spacing:1px}
    .meta{text-align:right;font-size:12px;color:#333}
    .parties{display:flex;gap:16px;margin-bottom:14px}
    .party{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px}
    .party h3{margin:0 0 4px;font-size:12px;color:#0f766e}
    table.items{width:100%;border-collapse:collapse;margin-bottom:8px}
    table.items th,table.items td{border:1px solid #cbd5e1;padding:5px 7px;font-size:11.5px;text-align:left;vertical-align:top}
    table.items th{background:#ecfdf5;color:#065f46}
    td.r{text-align:right}td.c{text-align:center}.muted{color:#777}
    .sum{width:280px;margin-left:auto;border-collapse:collapse}
    .sum td{padding:4px 8px;font-size:13px}.sum tr.g td{border-top:2px solid #0f766e;font-size:14px}
    .foot{display:flex;justify-content:space-between;margin-top:26px;font-size:11px;color:#444}
    .foot div{flex:1;border-top:1px solid #333;padding-top:4px;margin:0 12px;text-align:center}
    .pay{margin:6px 0 12px;font-size:12px}
    @media print{body{margin:8mm}.noprint{display:none}}
    .noprint{text-align:center;margin:14px 0}
    .btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer}
  </style></head><body>
    <div class="noprint"><button class="btnp" onclick="window.print()">🖨 Печат</button></div>
    <div class="head">
      <div><h1>ЗАЯВКА</h1><div>№ <b>${escapeHtml(o.ourNo || "____")}</b>${o.clientNo ? ` · клиентски № <b>${escapeHtml(o.clientNo)}</b>` : ""}</div></div>
      <div class="meta">Дата: <b>${erpDMY(o.date)}</b><br>Срок за изпълнение: <b>${erpDMY(o.deadline) || "—"}</b><br>Статус: <b>${escapeHtml(o.status || "нова")}</b></div>
    </div>
    <div class="parties">
      <div class="party"><h3>Доставчик</h3><b>${escapeHtml(s.name || "")}</b>${sellerLines ? "<br>" + sellerLines : ""}</div>
      <div class="party"><h3>Клиент</h3><b>${escapeHtml(o.clientName || "—")}</b></div>
    </div>
    <table class="items">
      <thead><tr><th>№</th><th>Код</th><th>Продукт</th><th>Бройка</th>${showPrices ? "<th>Ед. цена</th><th>Сума</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${showPrices ? `<table class="sum"><tr class="g"><td><b>Обща стойност</b></td><td class="r"><b>${erpEur(total)}</b></td></tr></table>` : ""}
    ${o.note ? `<div class="pay">Забележка: ${escapeHtml(o.note)}</div>` : ""}
    <div class="foot"><div>Съставил</div><div>Приел</div></div>
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за този сайт и опитай пак."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

/* ---------- Файл на заявката (сканирана заявка/PDF/снимка) ---------- */
// Списъкът с прикачени файлове в формата (с връзка за отваряне и бутон за махане).
function erpCOFilesHtml(o) {
  const files = (o && o.files) || [];
  if (!files.length) return `<p class="erp-muted" style="margin:0 0 6px">Няма прикачен файл. Прикачи сканираната заявка (PDF/снимка).</p>`;
  return `<ul class="co-file-ul">${files.map((f, i) => `
    <li><a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener">📄 ${escapeHtml(f.name || "файл")}</a>
      <button type="button" class="btn btn-small btn-danger co-file-rm" data-cofrm="${i}" title="Махни файла">×</button></li>`).join("")}</ul>`;
}

// Клетка за списъка: 📎 връзка към прикачения файл (или „—").
function erpCOFileCell(o) {
  const files = (o && o.files) || [];
  if (!files.length) return "—";
  const f = files[0];
  return `<a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener" class="co-file-link" title="Отвори прикачения файл на заявката">📎${files.length > 1 ? " " + files.length : ""}</a>`;
}

// Качва файл(ове) към заявката. За нова заявка първо я записваме (за да има id).
async function erpCOAttachFiles(o, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const st = document.getElementById("co-file-status");
  if (!o.id) {
    if (st) st.textContent = "Записвам заявката…";
    try { await erpSaveCO(o); } catch (e) { alert("Първо запази заявката (грешка: " + (e.message || e) + ")."); if (st) st.textContent = ""; return; }
  }
  o.files = o.files || [];
  for (const file of files) {
    if (st) st.textContent = "Качвам „" + file.name + "“…";
    const path = `orders/${o.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file);
    if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); continue; }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    o.files.push({ name: file.name, type: file.type, path, url: data.publicUrl });
  }
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис на заявката: " + (e.message || e)); }
  try { await erpLoadCustomerOrders(); } catch (e) {}
  if (st) st.textContent = "";
  const list = document.getElementById("co-files-list");
  if (list) list.innerHTML = erpCOFilesHtml(o);
  const inp = document.getElementById("co-file-input"); if (inp) inp.value = "";
}

// Маха прикачен файл (от склада за файлове и от заявката).
async function erpCORemoveFile(o, i) {
  const f = (o.files || [])[i]; if (!f) return;
  if (!confirm(`Да махна ли файла „${f.name || ""}"?`)) return;
  if (f.path) { try { await sb.storage.from(BUCKET).remove([f.path]); } catch (e) {} }
  o.files.splice(i, 1);
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); }
  try { await erpLoadCustomerOrders(); } catch (e) {}
  const list = document.getElementById("co-files-list");
  if (list) list.innerHTML = erpCOFilesHtml(o);
}

/* ---------- Списък ---------- */
async function erpRenderCustomerOrders() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { if (typeof quickLoad === "function") await quickLoad(); } catch (e) {}   // за значките 📦
  try { await erpLoadCustomerOrders(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя заявките</h3><p>${escapeHtml(e.message || String(e))}</p>` +
      `<p class="hint">Пусни обновения <code>erp-setup.sql</code> (таблица customer_orders) в Supabase.</p></div>`;
    return;
  }
  // Текущи производства ЗА СКЛАД (пуснати от Продукти/Склад детайли, без заявка) —
  // показват се тук, за да се виждат наравно със заявките. Четат се от задачите.
  let stockGroups = [];
  try {
    // Филтър В БАЗАТА: само задачите „за склад" (преди се теглеха ВСИЧКИ
    // задачи с целите им данни — все по-бавно с растежа им).
    const { data } = await erpSelectAll("tasks", "id,done,data", "data->source->>stock", "true");
    const st = (data || []).map(r => ({ tid: r.id, tdone: r.done, ...(r.data || {}) }))
      .filter(t => t.source && t.source.stock);
    const bySid = {};
    st.forEach(t => {
      const sid = String(((t.source.orders || [])[0] || {}).id || "");
      if (!sid) return;
      (bySid[sid] = bySid[sid] || []).push(t);
    });
    stockGroups = Object.entries(bySid).map(([sid, ts]) => {
      ts.sort((a, b) => (a.source.step || 0) - (b.source.step || 0));
      const last = ts[ts.length - 1];
      const allDone = ts.every(t => t.tdone || (Number(t.qty) > 0 && Number(t.produced) >= Number(t.qty)));
      return { sid, code: ts[0].code || "", product: ts[0].product || "", qty: Number(ts[0].qty) || 0,
        stocked: Number((last.source || {}).stocked) || 0, allDone,
        ops: ts.map(t => ({ op: t.operation || "", ws: t.workshop || "", p: Number(t.produced) || 0, q: Number(t.qty) || 0 })) };
    }).filter(g => !g.allDone);
  } catch (e) { /* тихо — секцията просто не се показва */ }
  // Всичко за склад се показва като ЕДНА „заявка" — кликаш и излиза целият списък.
  const stTotQty = stockGroups.reduce((s, g) => s + g.qty, 0);
  const stTotDone = stockGroups.reduce((s, g) => s + g.stocked, 0);
  const stockHtml = stockGroups.length ? `
    <div class="co-stock-box co-stock-one erp-clickable" id="co-stock-open" title="Отвори всички текущи производства за склад">
      <span class="co-stock-ttl">🏭 <b>ПРОИЗВОДСТВО ЗА СКЛАД</b></span>
      <span class="erp-co-status s-в производство">в производство</span>
      <span class="erp-muted">${stockGroups.length} ${stockGroups.length === 1 ? "изделие" : "изделия"} · общо ${erpNum(stTotQty)} бр. · готови в склада ${erpNum(stTotDone)}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" type="button">Отвори →</button>
    </div>` : "";

  // Прозорецът „Производство за склад" — всичко на едно място, като отворена заявка.
  function erpCOStockDialog(groups) {
    const totQ = groups.reduce((s, g) => s + g.qty, 0);
    const totS = groups.reduce((s, g) => s + g.stocked, 0);
    const gPct = g => { const ops = g.ops || []; if (!ops.length) return 0; const s = ops.reduce((t, o) => t + (o.q > 0 ? Math.min(1, o.p / o.q) : 1), 0); return Math.round(s / ops.length * 100); };
    const { wrap, close } = erpDialog(`
      <h3>🏭 Производство ЗА СКЛАД — текущи (${groups.length})</h3>
      <div class="costk-stats">
        <span>Изделия: <b>${groups.length}</b></span>
        <span>Пуснати общо: <b>${erpNum(totQ)} бр.</b></span>
        <span>Готови в Склад детайли: <b>${erpNum(totS)} бр.</b></span>
        <span>Остават: <b>${erpNum(Math.max(0, totQ - totS))} бр.</b></span>
      </div>
      <p class="hint" style="margin:0 0 8px">Пуснати от Продукти / Склад детайли (без клиентска заявка). Готовите бройки от ПОСЛЕДНАТА операция влизат директно в Склад детайли — щом всичко мине, изделието изчезва оттук.</p>
      <div style="max-height:66vh;overflow:auto">
      <table class="report-table erp-table" style="margin-bottom:6px">
        <thead><tr><th>Код</th><th>Детайл</th><th class="num">Пуснати</th><th style="width:42%">Напредък по операции (цех · готови/всичко)</th><th style="width:110px">Общо</th><th class="num">В склада</th><th class="num">Остават</th><th></th></tr></thead>
        <tbody>${groups.map(g => `<tr>
          <td><b>${escapeHtml(g.code)}</b></td>
          <td>${escapeHtml(g.product)}</td>
          <td class="num">${erpNum(g.qty)}</td>
          <td>${g.ops.map(o => `<span class="oip-op ${o.q > 0 && o.p >= o.q ? "ok" : o.p > 0 ? "part" : ""}">${escapeHtml(o.op)}${o.ws ? " · " + escapeHtml(o.ws) : ""} <b>${o.p}/${o.q}</b></span>`).join(" ")}</td>
          <td><div class="co-progress" style="max-width:none" title="${gPct(g)}% от операциите"><div class="co-progress-fill" style="width:${gPct(g)}%"></div></div><span class="erp-muted" style="font-size:11px">${gPct(g)}%</span></td>
          <td class="num"><b>${erpNum(g.stocked)}</b></td>
          <td class="num">${erpNum(Math.max(0, g.qty - g.stocked))}</td>
          <td class="erp-row-actions"><button class="btn btn-small btn-danger" data-stockrm="${escapeAttr(g.sid)}" title="Изтегля производството за склад (маха задачите по цеховете)">✕ Изтегли</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <div class="erp-dialog-actions"><span class="spacer"></span><button class="btn" id="costk-close">Затвори</button></div>`);
    wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
    wrap.querySelector("#costk-close").addEventListener("click", close);
    wrap.querySelectorAll("[data-stockrm]").forEach(b => b.addEventListener("click", async () => {
      const sid = b.dataset.stockrm;
      const g = groups.find(x => x.sid === sid);
      if (!confirm(`Да изтегля ли производството за склад на „${(g && g.code) || ""} ${(g && g.product) || ""}"?\nЗадачите му по цеховете ще се премахнат.`)) return;
      try {
        if (typeof erpFlowRemoveOrder === "function") await erpFlowRemoveOrder(sid);
        else await sb.from("tasks").delete().eq("data->source->>sampleId", String(sid));
      } catch (e) { alert("Грешка при изтегляне: " + (e.message || e)); return; }
      close(); erpRenderCustomerOrders();
    }));
  }

  // Частичен ререндер: филтри/подредба/папки сменят САМО тялото на таблицата,
  // без да презареждат заявките и складовите групи от базата.
  function erpCORefreshTable() {
    const tb = document.querySelector("#co-orders-table tbody");
    if (!tb) { erpRenderCustomerOrders(); return; }
    const list = erpCOSortRows(erpCOList.slice());
    tb.innerHTML = erpCOListHtml(list) || `<tr><td colspan="11" class="report-empty">Няма съвпадения.</td></tr>`;
    // Броячът и сумата горе следват филтъра.
    const cnt = document.getElementById("erp-co-count");
    if (cnt) cnt.innerHTML = `${list.length} заявки${(typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production) ? "" :
      ` <span class="sell-cell erp-muted" title="Сборът е само по НЕдоставеното — вече изпратеното не се брои">· остава ${erpEur(list.reduce((s, o) => s + erpCOValueLeft(o), 0))}</span>`}`;
    tb.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); erpOpenCO(b.dataset.open); }));
    tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", ev => { if (ev.target.closest("a")) return; erpOpenCO(tr.dataset.id); }));
    tb.querySelectorAll("[data-folder]").forEach(tr => tr.addEventListener("click", () => {
      const c = tr.dataset.folder;
      if (erpCOOpenClients.has(c)) erpCOOpenClients.delete(c); else erpCOOpenClients.add(c);
      erpCORefreshTable();
    }));
  }

  const rows = erpCOSortRows(erpCOList.slice());
  const sortOpts = [
    ["deadline", "Срок на доставка"], ["client", "Клиент (А→Я)"], ["date", "Дата (нови отгоре)"],
    ["ourNo", "Наш №"], ["status", "Статус"], ["value", "Остатъчна стойност (голяма отгоре)"],
  ];
  const statusOpts = ["нова", "в производство", "готова за продажба", "частично завършена", "завършена"];
  const clientOpts = [...new Set((erpCOList || []).map(o => o.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count" id="erp-co-count">${rows.length} заявки${(typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production) ? "" :
        ` <span class="sell-cell erp-muted" title="Сборът е само по НЕдоставеното — вече изпратеното не се брои">· остава ${erpEur(rows.reduce((s, o) => s + erpCOValueLeft(o), 0))}</span>`}</span>
      <input type="search" id="erp-co-q" placeholder="🔎 търси № / клиент / статус…" value="${escapeAttr(erpCOQuery)}" autocomplete="off" style="min-width:190px" />
      <label class="erp-inline">Статус
        <select id="erp-co-fstatus"><option value="">Всички</option>${statusOpts.map(s => `<option ${s === erpCOStatusFilter ? "selected" : ""}>${s}</option>`).join("")}</select>
      </label>
      <label class="erp-inline">Клиент
        <select id="erp-co-fclient"><option value="">Всички</option>${clientOpts.map(c => `<option ${c === erpCOClientFilter ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
      </label>
      <label class="erp-inline">Подреди по
        <select id="erp-co-sort">${sortOpts.map(([k, l]) => `<option value="${k}" ${k === erpCOSort ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="erp-inline" title="Скрива завършените заявки, за да не пълнят списъка"><input type="checkbox" id="erp-co-hidedone" ${erpCOHideDone ? "checked" : ""} /> Скрий завършените${(function () { const n = erpCOList.filter(o => (o.status || "нова") === "завършена").length; return n ? ` (${n})` : ""; })()}</label>
      ${(erpCOStatusFilter || erpCOClientFilter) ? `<button class="btn btn-small" id="erp-co-clearf">✕ Изчисти филтрите</button>` : ""}
      <span class="spacer"></span>
      ${typeof erpQuickHome === "function" ? '<button class="btn btn-small" id="erp-co-quick-cat" title="Каталог на бързите изделия по клиентски код — преглед, редакция, чертежи, шаблони">📦</button><button class="btn btn-small" id="erp-co-quick" title="Нова заявка с нестандартни изделия по клиентски код — добавяш ги с „⚡ Ново бързо изделие" направо във формата">+ Нестандартни поръчки</button>' : ""}
      ${typeof erpAIStart === "function" ? '<button class="btn btn-small" id="erp-co-ai" title="Качи сканирана заявка (PDF/снимка) — Claude я разчита, ти потвърждаваш">🤖 Разчети заявка (AI)</button>' : ""}
      <button class="btn btn-small btn-primary" id="erp-co-new">+ Нова заявка</button>
    </div>
    ${stockHtml}
    <table class="report-table erp-table" id="co-orders-table">
      <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Дата</th><th>Срок</th><th class="num">Продукти</th><th class="num sell-cell" title="Стойността на НЕдоставеното; отдолу с дребен шрифт е цялата заявка">Остава</th><th>Статус</th><th title="В кой седмичен план за експедиция е включена заявката">План</th><th>Файл</th><th></th></tr></thead>
      <tbody>
        ${erpCOListHtml(rows) ||
          `<tr><td colspan="11" class="report-empty">Още няма заявки. Натисни „+ Нова заявка".</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("erp-co-new").addEventListener("click", erpNewCO);
  // „Заявката" за склад: клик → прозорец с всички текущи производства за склад.
  const stOpen = document.getElementById("co-stock-open");
  if (stOpen) stOpen.addEventListener("click", () => erpCOStockDialog(stockGroups));
  const aiBtn = document.getElementById("erp-co-ai");
  if (aiBtn) aiBtn.addEventListener("click", erpAIStart);
  const sortSel = document.getElementById("erp-co-sort");
  if (sortSel) sortSel.addEventListener("change", e => { erpCOSort = e.target.value; erpCORefreshTable(); });
  const fStatus = document.getElementById("erp-co-fstatus");
  if (fStatus) fStatus.addEventListener("change", e => { erpCOStatusFilter = e.target.value; erpCORefreshTable(); });
  const fClient = document.getElementById("erp-co-fclient");
  if (fClient) fClient.addEventListener("change", e => { erpCOClientFilter = e.target.value; erpCORefreshTable(); });
  const quickBtn = document.getElementById("erp-co-quick");
  if (quickBtn) quickBtn.addEventListener("click", () => erpNewCO(true));   // същата форма, белязана като нестандартна
  const quickCatBtn = document.getElementById("erp-co-quick-cat");
  if (quickCatBtn) quickCatBtn.addEventListener("click", () => erpQuickHome());
  const clearF = document.getElementById("erp-co-clearf");
  if (clearF) clearF.addEventListener("click", () => { erpCOStatusFilter = ""; erpCOClientFilter = ""; erpCORefreshTable(); });
  const hideDoneEl = document.getElementById("erp-co-hidedone");
  if (hideDoneEl) hideDoneEl.addEventListener("change", e => { erpCOHideDone = e.target.checked; erpCORefreshTable(); });
  const qEl = document.getElementById("erp-co-q");
  if (qEl) qEl.addEventListener("input", uiDebounce(e => {
    erpCOQuery = e.target.value;
    // пре-рисуваме само таблицата със заявките, за да не губим фокуса на търсачката
    const tb = v.querySelector("#co-orders-table tbody");
    if (!tb) { erpRenderCustomerOrders(); return; }
    erpCORefreshTable();
  }, 200));
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenCO(b.dataset.open); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", ev => { if (ev.target.closest("a")) return; erpOpenCO(tr.dataset.id); }));
  v.querySelectorAll("[data-folder]").forEach(tr => tr.addEventListener("click", () => {
    const c = tr.dataset.folder;
    if (erpCOOpenClients.has(c)) erpCOOpenClients.delete(c); else erpCOOpenClients.add(c);
    erpCORefreshTable();
  }));
  // Планът за седмицата се чете фоново — клетките „План" се допълват след това.
  if (typeof lpEnsureItems === "function") {
    (async () => {
      try {
        await lpEnsureItems();
        if (typeof lpLoadSales === "function" && !(typeof LP_SALES !== "undefined" && LP_SALES && LP_SALES.length)) await lpLoadSales();
      } catch (e) {}
      erpCOPlanFill();
    })();
  }
}

/* ---------- 📚 Архив (изпълнени заявки) ----------
   Тук отиват приключените заявки (продажбата им е осчетоводена). Всяка е
   свързана със своята продажба — която в бъдеще ще стане фактура (счетоводен
   модул). Така заявката и продажбата се пазят на едно място. */
let erpArchiveQuery = "";
async function erpRenderArchive() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpLoadCustomerOrders(); }
  catch (e) { v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя архива</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  const prod = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production);   // без цени/продажби за производство
  let sales = [];
  if (!prod) { try { if (typeof erpLoadSales === "function") await erpLoadSales(); sales = (typeof erpSales !== "undefined" && erpSales) ? erpSales : []; } catch (e) {} }
  const saleByOrder = {};
  sales.forEach(s => { if (s && s.fromOrderId) (saleByOrder[String(s.fromOrderId)] = saleByOrder[String(s.fromOrderId)] || []).push(s); });

  const val = o => (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count" id="erp-arch-count"></span>
      <input type="search" id="erp-arch-q" placeholder="🔎 търси № / клиент…" value="${escapeAttr(erpArchiveQuery)}" style="min-width:210px" autocomplete="off" />
    </div>
    <p class="hint">Тук отиват заявките, чиято продажба е осчетоводена. Продажбите се пазят и ще станат фактури, когато свържем счетоводния модул.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Приключена</th><th class="num">Продукти</th>${prod ? "" : `<th class="num sell-cell">Стойност</th><th>Продажба</th>`}<th></th></tr></thead>
      <tbody id="erp-arch-tbody"></tbody>
    </table>`;

  // Търсенето филтрира В ПАМЕТТА (обновява само тялото) — без нова заявка към базата.
  const fill = () => {
    const tb = document.getElementById("erp-arch-tbody"); if (!tb) return;
    const q = (erpArchiveQuery || "").toLowerCase().trim();
    let done = (erpCOList || []).filter(o => (o.status || "") === "завършена");
    if (q) done = done.filter(o => `${o.ourNo || ""} ${o.clientNo || ""} ${o.clientName || ""}`.toLowerCase().includes(q));
    done.sort((a, b) => String(b.closedAt || b.date || "").localeCompare(String(a.closedAt || a.date || "")));
    const cnt = document.getElementById("erp-arch-count"); if (cnt) cnt.textContent = `📚 Архив — ${done.length} изпълнени заявки`;
    tb.innerHTML = done.map(o => {
      const ss = saleByOrder[String(o.id)] || [];
      const saleCell = ss.length ? ss.map(s => `<button class="btn btn-small erp-arch-sale" data-sale="${s.id}" title="Отвори продажбата">🧾 №${escapeHtml(s.saleNo || "")}${s.posted ? " ✓" : ""}</button>`).join(" ") : `<span class="erp-muted">няма</span>`;
      return `<tr class="erp-clickable" data-id="${o.id}">
        <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
        <td data-label="Клиентски №">${escapeHtml(o.clientNo || "—")}</td>
        <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
        <td data-label="Приключена">${erpDMY((o.closedAt || "").slice(0, 10) || o.date)}</td>
        <td class="num" data-label="Продукти">${(o.lines || []).length}</td>
        ${prod ? "" : `<td class="num sell-cell" data-label="Стойност">${erpEur(val(o))}</td><td data-label="Продажба">${saleCell}</td>`}
        <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="${prod ? 6 : 8}" class="report-empty">Още няма изпълнени заявки. Появяват се тук, щом осчетоводиш продажбата им.</td></tr>`;
    tb.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenCO(b.dataset.open); }));
    tb.querySelectorAll(".erp-arch-sale").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); if (typeof erpOpenSale === "function") erpOpenSale(b.dataset.sale); }));
    tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenCO(tr.dataset.id)));
  };
  const qEl = document.getElementById("erp-arch-q");
  if (qEl) qEl.addEventListener("input", e => { erpArchiveQuery = e.target.value; fill(); });
  fill();
}

function erpNewCO(nonstd) {
  const today = new Date().toISOString().slice(0, 10);
  erpRenderCOForm({ ourNo: erpNextOrderNo(), clientNo: "", clientName: "", clientId: null, date: today, deadline: "", note: "", status: "нова", lines: [], nonstd: nonstd === true });
}
// Нестандартна поръчка: белязана при създаването или с поне едно бързо изделие.
function erpCOIsNonstd(o) {
  if (o && o.nonstd) return true;
  return !!(o && (o.lines || []).some(l => l.productId && typeof erpQuickIs === "function" && erpQuickIs(l.productId)));
}
// Оранжевата лента, която прави нестандартните безпогрешно различими.
function erpCONonstdBanner(extra) {
  return `<div style="background:#f59e0b;color:#1f2937;font-weight:700;padding:8px 14px;border-radius:8px;margin:0 0 8px;display:flex;align-items:center;gap:10px">📦 НЕСТАНДАРТНА ПОРЪЧКА <span style="font-weight:400;font-size:12px">изделия по клиентски код (бързи изделия)</span>${extra || ""}</div>`;
}
function erpOpenCO(id) {
  const o = (erpCOList || []).find(x => x.id === id);
  if (o) erpRenderCOForm(JSON.parse(JSON.stringify(o)));
}

/* ---------- Форма / детайл ---------- */
async function erpRenderCOForm(o) {
  const v = erpView();
  const clients = await erpLoadClients();
  if (!o.posted && (o.clientId || o.clientName)) erpCOFillPrices(o);   // авто-цени при отваряне
  const canDelete = (typeof isOwnerAdmin === "function") && isOwnerAdmin() && o.id;
  try { if (typeof quickLoad === "function") await quickLoad(); } catch (e) {}   // за знака „нестандартна"
  const nonstd = erpCOIsNonstd(o);
  v.innerHTML = `
    ${nonstd ? erpCONonstdBanner() : ""}
    <div class="erp-toolbar"${nonstd ? ' style="border-left:4px solid #f59e0b;padding-left:8px"' : ""}>
      <button class="btn btn-small" id="co-back">← Назад към заявките</button>
      <span class="spacer"></span>
      <button class="btn btn-small" id="co-print">🖨 Печат</button>
      ${canDelete ? '<button class="btn btn-small btn-danger" id="co-del">🗑 Изтрий заявката</button>' : ""}
      <button class="btn btn-small btn-primary" id="co-save">💾 Запази</button>
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Наш № <input type="text" id="co-ourno" value="${escapeAttr(o.ourNo || "")}" /></label>
        <label>Клиентски № (референция) <input type="text" id="co-clientno" value="${escapeAttr(o.clientNo || "")}" placeholder="номер на заявката от клиента" /></label>
        <label>Клиент
          <span class="co-client-row">
            <input type="text" id="co-client" list="co-clients" value="${escapeAttr(o.clientName || "")}" placeholder="избери или въведи" />
            <button type="button" class="btn btn-small" id="co-add-client" title="Добави нов клиент в директорията">+ Нов клиент</button>
          </span>
          <datalist id="co-clients">${clients.map(c => `<option value="${escapeAttr(c.company || "")}"></option>`).join("")}</datalist></label>
        <label>Дата <input type="date" id="co-date" value="${escapeAttr(o.date || "")}" /></label>
        <label>Срок <input type="date" id="co-deadline" value="${escapeAttr(o.deadline || "")}" /></label>
        <label>Статус
          <select id="co-status">
            ${["нова", "в производство", "готова за продажба", "частично завършена", "завършена"].map(s => `<option ${s === (o.status || "нова") ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <span class="co-plan-line" id="co-plan-line">${o.id ? erpCOPlanLine(o) : ""}</span>
          ${o.clientName ? `<button type="button" class="btn btn-small co-cli-info" id="co-cli-info" title="Специфики на клиента: чести грешки, палети, етикети, транспорт">🧭 Специфики на клиента</button>` : ""}
          <span class="co-docs-line" id="co-docs-line">${o.id ? erpCODocsLine(o) : ""}</span>
          ${(function () { const p = erpCOPct(o); return p.del > 0 ? `<span class="co-pct-info" title="по доставените бройки от редовете">✔ доставени ${erpNum(p.del)} от ${erpNum(p.tot)} бр. — <b>${p.pct}%</b></span><div class="co-progress"><div class="co-progress-fill" style="width:${p.pct}%"></div></div>` : ""; })()}</label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="co-note" rows="3" placeholder="специфични изисквания, договорки…">${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">📎 Файл на заявката</h4>
      <div class="erp-co-files">
        <div id="co-files-list">${erpCOFilesHtml(o)}</div>
        <label class="btn btn-small co-attach-btn">⬆ Прикачи файл<input type="file" id="co-file-input" multiple hidden /></label>
        <span class="erp-muted" id="co-file-status"></span>
      </div>

      <h4 class="erp-group-head">Продукти в заявката</h4>
      <table class="report-table erp-table" id="co-lines">
        <thead><tr><th>Код</th><th>Продукт</th><th class="num">Бройка</th><th class="num sell-cell">Прод. цена (€)</th><th class="num sell-cell">Сума</th><th></th></tr></thead>
        <tbody>${erpCOLinesHtml(o)}</tbody>
      </table>
      <div class="erp-co-linebar"><button class="btn btn-small" id="co-add-prod">+ Добави продукт</button>${(typeof quickAllowed === "function" && quickAllowed()) ? '<button class="btn btn-small btn-primary" id="co-add-quick" title="Нестандартно изделие по клиентски код — създава се с мини-рецепта и веднага влиза като ред в заявката">⚡ + Ново бързо изделие</button>' : ""}${((!o.id || nonstd) && typeof erpQuickTemplateXls === "function" && typeof quickAllowed === "function" && quickAllowed()) ? '<button type="button" class="btn btn-small" id="co-tpl-dl" title="Сваля Excel шаблон: ред за всяко нестандартно изделие (код, име, бройка, цена, маршрут, материали). Попълваш и го качваш с „⬆ Импорт шаблон".">⤓ Шаблон (Excel)</button><label class="btn btn-small" title="Качи ПОПЪЛНЕНИЯ шаблон — създава изделията с мини-рецептите и отваря заявка с всички редове">⬆ Импорт шаблон<input type="file" id="co-tpl-up" accept=".xlsx,.xls" hidden /></label>' : ""}${(!o.id && typeof erpAIStart === "function") ? '<button class="btn btn-small" id="co-ai-read" title="Качи файла на клиента (PDF/снимка/Excel) — Claude чете редовете, ти ги потвърждаваш и заявката се създава. Несъществуващите кодове се създават с „⚡ Ново".">🤖 Разчети заявка (AI)</button>' : ""}<span class="spacer"></span><span class="erp-count sell-cell" id="co-total"></span></div>

      <div class="erp-co-actions">
        <button class="btn btn-small" id="co-materials">🧮 Разбивка на материалите</button>
        <button class="btn btn-small" id="co-test" title="Провери маршрута — дали рецептите ще вървят правилно, преди да пуснеш">🧪 Тест рецепта</button>
        <button class="btn btn-small" id="co-sim" title="Паралелна реалност — прекарва заявката през цеховете с текущите наличности и показва докъде стига и къде спира">🔬 Симулирай производството</button>
        <button class="btn btn-small" id="co-matsubs" title="Смени материал САМО за тази поръчка (напр. Щрипс → Шина). Рецептата не се пипа; изписването тегли заместителя.">🔁 Смени материал${o.matSubs && Object.keys(o.matSubs).length ? ` (${Object.keys(o.matSubs).length})` : ""}</button>
        ${(typeof produceAllowed !== "function" || produceAllowed()) ? `<button class="btn btn-small btn-primary" id="co-produce">🏭 Пусни в производство</button>` : ""}
        <button class="btn btn-small" id="co-nitplan" title="Праща продуктите на заявката като приоритети в „План за седмицата" на Занитване">🗓 В плана на Занитване</button>
        ${o.production ? '<button class="btn btn-small" id="co-live-status" title="Жив статус — докъде е стигнало, къде е спряло и какво чака">📊 Статус на поръчката</button>' : ""}
        ${o.production ? '<button class="btn btn-small btn-danger" id="co-withdraw">⬅ Изтегли от производство</button>' : ""}
        <button class="btn btn-small" id="co-email" title="Отваря готово писмо до клиента, че поръчката е готова">✉ Съобщи на клиента (готова)</button>
        <button class="btn btn-small" id="co-sale">🧾 Създай продажба</button>
      </div>

      <h4 class="erp-group-head">Придружаващи документи</h4>
      <div class="erp-co-actions doc-src doc-src-pack">
        <span class="doc-src-lbl">📦 От ОПАКОВКИ:</span>
        <button class="btn btn-small" id="co-doc-goods">📦 Стокова разписка</button>
        <button class="btn btn-small" id="co-doc-packing">📦 Packing List</button>
        <button class="btn btn-small" id="co-doc-pallets">🧱 Палет опис</button>
      </div>
      <div class="erp-co-actions">
        ${typeof erpMailTransportInquiry === "function" ? '<button class="btn btn-small" id="co-mail-transport" title="Запитване за транспорт до превозвач — маршрут/палети/тегло се попълват от заявката">🚚 Запитване за транспорт</button>' : ""}
        <button class="btn btn-small" id="co-edit-transport">✎ Транспорт</button>
        <button class="btn btn-small" id="co-edit-pallets">✎ Палети (${(o.pallets || []).length})</button>
      </div>
      <p class="hint">Зелените документи се пълнят от <b>Опаковки</b> (кашони, тегла и палетния план на ТАЗИ заявка). ЧМР, Description of goods и декларациите се правят от <b>фактурата</b> — виж синята група там.</p>
      <div id="co-extra"></div>
    </div>`;

  const bind = (id, key) => { const el = document.getElementById(id); el.addEventListener("input", () => { o[key] = el.value; }); };
  bind("co-ourno", "ourNo"); bind("co-clientno", "clientNo"); bind("co-date", "date");
  bind("co-deadline", "deadline"); bind("co-note", "note");
  document.getElementById("co-client").addEventListener("input", e => {
    o.clientName = e.target.value;
    const m = clients.find(c => (c.company || "") === e.target.value);
    o.clientId = m ? m.id : null;
    if (m && erpCOFillPrices(o)) erpCORefreshLines(o);   // авто-цени за клиента
  });
  document.getElementById("co-status").addEventListener("change", e => { o.status = e.target.value; });
  const cliInfo = document.getElementById("co-cli-info");
  if (cliInfo) cliInfo.addEventListener("click", () => { if (typeof cliQuickView === "function") cliQuickView(o.clientName); });
  // Редът „в плана за седмицата" се допълва, щом планът дойде фоново.
  if (o.id && typeof lpEnsureItems === "function") {
    (async () => {
      try {
        await lpEnsureItems();
        if (typeof lpLoadSales === "function" && !(typeof LP_SALES !== "undefined" && LP_SALES && LP_SALES.length)) await lpLoadSales();
      } catch (e) {}
      const el = document.getElementById("co-plan-line");
      if (el) el.innerHTML = erpCOPlanLine(o);
    })();
  }
  // Продажбата/фактурата по заявката — също фоново (не бави отварянето).
  if (o.id && !(typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.production)) {
    (async () => {
      try { if (typeof erpLoadSales === "function" && (typeof erpSales === "undefined" || !erpSales)) await erpLoadSales(); } catch (e) {}
      try { if (typeof erpLoadInvoices === "function" && (typeof erpInvoices === "undefined" || !erpInvoices)) await erpLoadInvoices(); } catch (e) {}
      const el = document.getElementById("co-docs-line");
      if (!el) return;
      el.innerHTML = erpCODocsLine(o);
      erpCODocsWire(el, o);
    })();
    erpCODocsWire(document.getElementById("co-docs-line"), o);
  }
  const addClientBtn = document.getElementById("co-add-client");
  if (addClientBtn) addClientBtn.addEventListener("click", () => erpCOAddClient(o));

  document.getElementById("co-back").addEventListener("click", erpRenderCustomerOrders);
  document.getElementById("co-save").addEventListener("click", () => erpCOSaveClick(o));
  const printBtn = document.getElementById("co-print");
  if (printBtn) printBtn.addEventListener("click", () => erpPrintCO(o));
  const delBtn = document.getElementById("co-del");
  if (delBtn) delBtn.addEventListener("click", () => erpCODelete(o));
  const fileInput = document.getElementById("co-file-input");
  if (fileInput) fileInput.addEventListener("change", e => erpCOAttachFiles(o, e.target.files));
  const filesList = document.getElementById("co-files-list");
  if (filesList) filesList.addEventListener("click", e => {
    const rm = e.target.closest("[data-cofrm]");
    if (rm) { e.preventDefault(); erpCORemoveFile(o, Number(rm.dataset.cofrm)); }
  });
  document.getElementById("co-add-prod").addEventListener("click", () => erpCOAddProduct(o));
  const tplDl = document.getElementById("co-tpl-dl");
  if (tplDl) tplDl.addEventListener("click", async () => { try { await erpEnsureLoaded(); } catch (e) {} erpQuickTemplateXls(); });
  const tplUp = document.getElementById("co-tpl-up");
  if (tplUp) tplUp.addEventListener("change", e => {
    const f = e.target.files && e.target.files[0]; e.target.value = "";
    if (!f) return;
    if ((o.lines || []).length && !confirm("Импортът създава ОТДЕЛНА заявка с редовете от файла.\nВъведеното дотук в тази форма няма да се запази. Продължавам ли?")) return;
    erpQuickImportXls(f);
  });
  const cai = document.getElementById("co-ai-read");
  if (cai) cai.addEventListener("click", () => {
    if ((o.lines || []).length && !confirm("Разчитането създава ОТДЕЛНА нова заявка от файла на клиента.\nВъведените дотук редове в тази форма няма да се запазят. Продължавам ли?")) return;
    erpAIStart();
  });
  const caq = document.getElementById("co-add-quick");
  if (caq) caq.addEventListener("click", () => erpQuickWizard({
    preset: { client: o.clientName || "", clientId: o.clientId || null },
    onDone: p => {
      const en = (typeof erpQuickEntry === "function" && erpQuickEntry(p.id)) || {};
      o.lines = o.lines || [];
      o.lines.push({ productId: p.id, code: p.code, name: p.name, ourName: p.name, qty: 1, unitPrice: en.price || "" });
      erpCORefreshLines(o);
    },
  }));
  document.getElementById("co-materials").addEventListener("click", () => erpCOMaterials(o));
  const coTest = document.getElementById("co-test");
  if (coTest) coTest.addEventListener("click", () => {
    const items = (o.lines || []).filter(l => l.productId).map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
    if (!items.length) { alert("Добави поне един продукт от каталога, за да тестваш рецептата."); return; }
    if (typeof erpTestRecipeMulti === "function") erpTestRecipeMulti(items, true, o.ourNo ? ("заявка №" + o.ourNo) : "");
  });
  const coSim = document.getElementById("co-sim");
  if (coSim) coSim.addEventListener("click", () => {
    const items = (o.lines || []).filter(l => l.productId).map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
    if (!items.length) { alert("Добави поне един продукт от каталога, за да симулираш."); return; }
    if (typeof erpSimulateProduction === "function") erpSimulateProduction(items, { title: o.ourNo ? ("заявка №" + o.ourNo) : "", stockTop: true });
  });
  const coProduceBtn = document.getElementById("co-produce");
  if (coProduceBtn) coProduceBtn.addEventListener("click", () => erpCOProduce(o));
  const coNitPlan = document.getElementById("co-nitplan");
  if (coNitPlan) coNitPlan.addEventListener("click", () => erpCOToNitPlan(o));
  const msBtn = document.getElementById("co-matsubs");
  if (msBtn) msBtn.addEventListener("click", () => erpCOMatSubsDialog(o));
  const stBtn = document.getElementById("co-live-status");
  if (stBtn) stBtn.addEventListener("click", () => {
    if (typeof erpOrderStatus === "function") erpOrderStatus(o.id, o.ourNo ? ("заявка №" + o.ourNo) : (o.clientName || ""), {
      productLines: (o.lines || []).filter(l => l.productId).map(l => ({ pid: l.productId, qty: erpToNum(l.qty) || 1 })),
      stockCover: (o.production && o.production.stockCover) || [],
    });
  });
  const wBtn = document.getElementById("co-withdraw");
  if (wBtn) wBtn.addEventListener("click", () => erpCOWithdraw(o));
  const emBtn = document.getElementById("co-email");
  if (emBtn) emBtn.addEventListener("click", () => {
    // Ново: автоматично изпращане през Brevo (готова / срок); старото Gmail compose е резерва.
    if (typeof erpMailOrderDialog === "function") erpMailOrderDialog(o);
    else if (typeof erpEmailOrderReady === "function") erpEmailOrderReady(o);
  });
  const saleBtn = document.getElementById("co-sale");
  if (saleBtn) saleBtn.addEventListener("click", () => {
    if (!(o.lines || []).length) { alert("Добави поне един продукт."); return; }
    if (typeof erpNewSaleFromOrder === "function") erpNewSaleFromOrder(o);
    else alert("Модул Продажби още не е зареден.");
  });
  // Придружаващи документи — ВИНАГИ от ОПАКОВКИ (Опаковъчната верига).
  const docObj = () => erpCODocAdapter(o);
  const packDoc = kind => { if (typeof erpPackPrintFor === "function") erpPackPrintFor(o, kind); else alert("Модул Опаковки не е зареден."); };
  const dg = document.getElementById("co-doc-goods");
  if (dg) dg.addEventListener("click", () => packDoc("goods"));
  const dp = document.getElementById("co-doc-packing");
  if (dp) dp.addEventListener("click", () => packDoc("packing"));
  const dl = document.getElementById("co-doc-pallets");
  if (dl) dl.addEventListener("click", () => packDoc("pallets"));
  const et = document.getElementById("co-edit-transport");
  if (et) et.addEventListener("click", () => { if (typeof erpInvTransportDialog === "function") erpInvTransportDialog(o, () => { erpSaveCO(o).catch(() => {}); }); });
  const mtr = document.getElementById("co-mail-transport");
  if (mtr) mtr.addEventListener("click", () => erpMailTransportInquiry(docObj()));
  const ep = document.getElementById("co-edit-pallets");
  if (ep) ep.addEventListener("click", () => { if (typeof erpInvPalletsDialog === "function") erpInvPalletsDialog(o, () => { erpSaveCO(o).catch(() => {}); erpRenderCOForm(o); }); });

  erpCOWireLines(o);
  if (o.production) erpCOTracking(o);
}

// Адаптер: представя заявката като „документен" обект за общите печатни функции
// от Фактуриране (стокова разписка / packing list / палет опис).
function erpCODocAdapter(o) {
  return {
    __ref: "заявка № " + (o.ourNo || "—") + (o.clientNo ? " / клиентски № " + o.clientNo : ""),
    issueDate: o.date || "", date: o.date || "",
    client: { name: o.clientName || "", eik: "", vat: "", city: "", street: "", country: "", person: "" },
    lines: (o.lines || []).map(l => ({ code: l.code, name: l.name, clientCode: l.clientCode, qty: l.qty, unit: l.unit || "бр.", productId: l.productId, materialId: l.materialId })),
    transport: o.transport || {}, pallets: o.pallets || [],
  };
}

function erpCOLinesHtml(o) {
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Код">${escapeHtml(l.code || "")}${l.clientCode ? `<div class="erp-co-ccode" title="Код на клиента">клиент: ${escapeHtml(l.clientCode)}</div>` : ""}</td>
      <td data-label="Продукт">${escapeHtml(l.name || "")}${l.materialId ? ' <span class="erp-tag erp-tag-mat" title="Покупен материал за препродажба: не влиза в производство, изписва се от склад Материали при продажбата">🧱 материал</span>' : ""}${l.clientName && l.clientName !== l.name ? `<div class="erp-co-cname" title="Име при клиента">${escapeHtml(l.clientName)}</div>` : ""}${(function () {
        const del = Number(l.delivered) || 0; if (del <= 0) return "";
        const rem = Math.max(0, (erpToNum(l.qty) || 0) - del);
        return rem > 0
          ? `<div class="erp-co-deliv" title="Доставено при частично фактуриране">📦 доставени ${erpNum(del)} · остават <b>${erpNum(rem)}</b></div>`
          : `<div class="erp-co-deliv erp-co-deliv-full" title="Напълно доставено">✅ доставени ${erpNum(del)} (напълно)</div>`;
      })()}</td>
      <td class="num" data-label="Бройка"><input type="number" class="co-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || 1))}" style="width:70px" /></td>
      <td class="num sell-cell" data-label="Прод. цена"><input type="number" class="co-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:90px" placeholder="0.00" /></td>
      <td class="num sell-cell" data-label="Сума">${erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0))}</td>
      <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-rm="${i}">×</button></td>
    </tr>`).join("") || `<tr><td colspan="6" class="report-empty">Няма добавени продукти.</td></tr>`;
}
function erpCOWireLines(o) {
  const body = document.querySelector("#co-lines tbody");
  if (!body) return;
  body.querySelectorAll(".co-qty").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].qty = erpToNum(inp.value); erpCOLineSums(o); }));
  body.querySelectorAll(".co-price").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].unitPrice = erpToNum(inp.value); erpCOLineSums(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpCORefreshLines(o); }));
  erpCOTotal(o);
}
function erpCOLineSums(o) {  // обновява сумите по редове + общата, без загуба на фокус
  const body = document.querySelector("#co-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => {
    const l = (o.lines || [])[i]; if (!l) return;
    const sum = tr.querySelector('td[data-label="Сума"]');
    if (sum) sum.textContent = erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0));
  });
  erpCOTotal(o);
}
function erpCOTotal(o) {
  const el = document.getElementById("co-total"); if (!el) return;
  const t = erpCOValue(o), left = erpCOValueLeft(o);
  el.textContent = Math.abs(t - left) < 0.005
    ? "Стойност на заявката: " + erpEur(t)
    : `Стойност на заявката: ${erpEur(t)} · остава за доставяне: ${erpEur(left)}`;
}
function erpCORefreshLines(o) {
  const body = document.querySelector("#co-lines tbody");
  if (body) { body.innerHTML = erpCOLinesHtml(o); erpCOWireLines(o); }
}

// Самообучение на цените: последната продажна цена за този клиент+продукт
// (от предишни заявки и продажби). Ползва се за авто-попълване „до второ нареждане".
function erpCOClientPrice(o, productId) {
  const byId = o && o.clientId;
  const name = ((o && o.clientName) || "").trim().toLowerCase();
  if (!byId && !name) return null;
  // 1) Изрична ценова листа за клиента (има превес над наученото).
  if (typeof erpPriceListEntry === "function") {
    const e = erpPriceListEntry(o.clientId, o.clientName, productId);
    if (e && erpToNum(e.price) > 0) return erpToNum(e.price);
  }
  const hits = [];
  (erpCOList || []).forEach(x => {
    if (o && x.id === o.id) return;
    const same = byId ? (x.clientId === byId) : ((x.clientName || "").trim().toLowerCase() === name);
    if (!same) return;
    (x.lines || []).forEach(l => {
      if (String(l.productId) === String(productId) && erpToNum(l.unitPrice) > 0)
        hits.push({ price: erpToNum(l.unitPrice), date: x.date || "" });
    });
  });
  if (typeof erpLastPriceFor === "function") {
    try { const s = erpLastPriceFor({ clientId: o.clientId, clientName: o.clientName, currency: "EUR" }, "product", productId); if (s) hits.push({ price: s.price, date: s.date || "" }); } catch (e) {}
  }
  if (!hits.length) return null;
  hits.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return hits[0].price;
}
function erpCOFillPrices(o) {
  let filled = 0;
  (o.lines || []).forEach(l => {
    if (erpToNum(l.unitPrice) > 0) return;
    const p = erpCOClientPrice(o, l.productId);
    if (p) { l.unitPrice = p; filled++; }
  });
  return filled;
}

/* ---------- Смяна на материал САМО за тази поръчка ----------
   Рецептата остава непокътната. Изборът се пази на заявката (o.matSubs =
   { оригинален_материал_id: заместител_id }) и се прилага при пускането в
   производство — изписването и „липсващи материали" теглят заместителя. */
async function erpCOMatSubsDialog(o) {
  try { await erpEnsureLoaded(); } catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  // Всички материали, които поръчката ползва по рецептите (рекурсивно).
  const need = {};
  const rec = (pid, mult, anc) => {
    (ERP.linesByProduct[pid] || []).forEach(l => {
      const q = mult * (Number(l.quantity) || 1);
      if (l.material_id) need[l.material_id] = (need[l.material_id] || 0) + q;
      else if (l.child_product_id && !anc.has(l.child_product_id)) rec(l.child_product_id, q, new Set([...anc, l.child_product_id]));
    });
  };
  (o.lines || []).forEach(l => { if (l.productId) rec(l.productId, erpToNum(l.qty) || 1, new Set([l.productId])); });
  const mids = Object.keys(need).map(Number);
  if (!mids.length) { alert("Поръчката няма материали по рецептите (или продуктите нямат рецепти)."); return; }
  o.matSubs = o.matSubs || {};
  const mLabel = id => { const m = ERP.matById[id] || {}; return `${m.code || ""} ${m.name || ""}`.trim() || ("материал " + id); };
  const mStock = id => { const m = ERP.matById[id] || {}; return m.stock != null ? erpNum(m.stock) + " " + (m.unit || "") : "—"; };
  const { wrap, close } = erpDialog(`
    <h3>🔁 Смяна на материал — само за заявка №${escapeHtml(o.ourNo || "")}</h3>
    <p class="hint" style="margin:0 0 8px">Рецептата НЕ се пипа. Заместителят важи само за тази поръчка — изписването от склада и проверката за липси теглят него. Остави „— без смяна —", където няма промяна.</p>
    <table class="report-table erp-table">
      <thead><tr><th>По технология (рецепта)</th><th class="num">Нужно</th><th>Наличност</th><th>→ Ще се ползва (заместител)</th><th>Наличност</th></tr></thead>
      <tbody>${mids.map(id => {
        const sub = o.matSubs[id] || "";
        return `<tr>
          <td><b>${escapeHtml(mLabel(id))}</b></td>
          <td class="num">${erpNum(need[id])}</td>
          <td>${mStock(id)}</td>
          <td><input type="text" class="ms-sub" data-id="${id}" list="ms-mats" value="${sub ? escapeAttr(mLabel(Number(sub))) : ""}" placeholder="— без смяна —" style="min-width:220px" /></td>
          <td class="ms-substock" data-id="${id}">${sub ? mStock(Number(sub)) : ""}</td>
        </tr>`; }).join("")}</tbody>
    </table>
    <datalist id="ms-mats">${(ERP.materials || []).map(m => `<option value="${escapeAttr((m.code || "") + " " + (m.name || ""))}"></option>`).join("")}</datalist>
    <div class="erp-dialog-actions">
      <button class="btn" id="ms-clear">✕ Махни всички смени</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="ms-cancel">Отказ</button>
      <button class="btn btn-primary" id="ms-save">💾 Запази</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  const findMat = txt => {
    const t = String(txt || "").trim().toLowerCase();
    if (!t) return null;
    return (ERP.materials || []).find(m => (((m.code || "") + " " + (m.name || "")).trim().toLowerCase() === t))
      || (ERP.materials || []).find(m => String(m.code || "").toLowerCase() === t) || null;
  };
  wrap.querySelectorAll(".ms-sub").forEach(inp => inp.addEventListener("change", () => {
    const cell = wrap.querySelector(`.ms-substock[data-id="${inp.dataset.id}"]`);
    const m = findMat(inp.value);
    if (cell) cell.textContent = m ? mStock(m.id) : (inp.value.trim() ? "❓ не е намерен" : "");
  }));
  wrap.querySelector("#ms-clear").addEventListener("click", () => { wrap.querySelectorAll(".ms-sub").forEach(i => { i.value = ""; }); wrap.querySelectorAll(".ms-substock").forEach(c => c.textContent = ""); });
  wrap.querySelector("#ms-cancel").addEventListener("click", close);
  wrap.querySelector("#ms-save").addEventListener("click", async () => {
    const subs = {};
    let bad = "";
    wrap.querySelectorAll(".ms-sub").forEach(inp => {
      const txt = inp.value.trim(); if (!txt) return;
      const m = findMat(txt);
      if (!m) { bad = txt; return; }
      if (Number(m.id) !== Number(inp.dataset.id)) subs[inp.dataset.id] = m.id;
    });
    if (bad) { alert(`Не намирам материал „${bad}" в склада. Избери от списъка.`); return; }
    o.matSubs = subs;
    try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }
    close();
    if (typeof erpRenderCOForm === "function") erpRenderCOForm(o);
    const n = Object.keys(subs).length;
    alert(n ? `✅ Записани ${n} смени. При пускане в производство складът ще тегли заместителите.\nАко поръчката ВЕЧЕ е пусната — пусни я наново (произведеното се запазва), за да влязе смяната в сила.` : "Смените са премахнати.");
  });
}

function erpCOAddProduct(o) {
  const { wrap, close } = erpDialog(`
    <h3>Добави продукт или покупен материал</h3>
    <input type="search" id="co-pp-q" placeholder="търси код или име…" />
    <div id="co-pp-list" class="erp-lp-list"></div>
    <p class="hint" style="margin:6px 0 0">🧱 = покупен материал (препродажба): не влиза в производство, изписва се от склад Материали при продажбата. Цената я пишеш ти (продажната).</p>
    <div class="erp-dialog-actions">${(typeof quickAllowed === "function" && quickAllowed()) ? '<button class="btn" id="co-pp-quick" title="Изделие по клиентски код с мини-рецепта — създава се тук и веднага влиза като ред в заявката">⚡ Ново бързо изделие</button>' : ""}<span class="spacer"></span><button class="btn" id="co-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#co-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.filter(p => !p.is_semifinished || true);
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    // Материали за препродажба (болтове и др. покупни) — след продуктите.
    let mats = (ERP.materials || []);
    if (q) mats = mats.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    mats = mats.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = (list.slice(0, 60).map(p =>
      `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} <span class="erp-muted">${p.is_semifinished ? "полуфабрикат" : "артикул"}</span></button>`).join("")
      + mats.slice(0, 40).map(m =>
      `<button type="button" class="erp-lp-item" data-mid="${m.id}">🧱 <b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">материал · ${escapeHtml(m.unit || "")}${m.avg_cost ? " · дост. " + erpEur(m.avg_cost) : ""}${m.stock != null ? " · нал. " + erpNum(m.stock) : ""}</span></button>`).join(""))
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item[data-id]").forEach(b => b.addEventListener("click", () => {
      const p = ERP.prodById[Number(b.dataset.id)];
      o.lines = o.lines || [];
      const last = erpCOClientPrice(o, p.id);   // авто-цена по клиент (листа → научено)
      const ple = (typeof erpPriceListEntry === "function") ? erpPriceListEntry(o.clientId, o.clientName, p.id) : null;
      const dispName = (ple && ple.cname) ? ple.cname : p.name;   // клиентско име, ако има в листата
      o.lines.push({ productId: p.id, code: p.code, name: dispName, ourName: p.name, qty: 1, unitPrice: last || "" });
      close(); erpCORefreshLines(o);
    }));
    listEl.querySelectorAll(".erp-lp-item[data-mid]").forEach(b => b.addEventListener("click", () => {
      const m = ERP.matById[Number(b.dataset.mid)];
      o.lines = o.lines || [];
      o.lines.push({ materialId: m.id, code: m.code, name: m.name, ourName: m.name, unit: m.unit || "бр.", qty: 1, unitPrice: "" });
      close(); erpCORefreshLines(o);
    }));
  };
  render("");
  wrap.querySelector("#co-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#co-pp-cancel").addEventListener("click", close);
  const qkBtn = wrap.querySelector("#co-pp-quick");
  if (qkBtn) qkBtn.addEventListener("click", () => {
    close();
    erpQuickWizard({
      preset: { client: o.clientName || "", clientId: o.clientId || null },
      onDone: p => {
        const en = (typeof erpQuickEntry === "function" && erpQuickEntry(p.id)) || {};
        o.lines = o.lines || [];
        o.lines.push({ productId: p.id, code: p.code, name: p.name, ourName: p.name, qty: 1, unitPrice: en.price || "" });
        erpCORefreshLines(o);
      },
    });
  });
}

// Изтрива заявката + всичките ѝ задачи по цеховете (само за собственика).
async function erpCODelete(o) {
  if (!o.id) return;
  if (typeof isOwnerAdmin === "function" && !isOwnerAdmin()) { alert("Само собственикът може да трие заявки."); return; }
  if (!confirm(`Да изтрия ли заявка №${o.ourNo || ""}${o.clientName ? " (" + o.clientName + ")" : ""} и всичките ѝ задачи по цеховете?\nТова е необратимо.`)) return;
  try {
    if (typeof erpFlowRemoveOrder === "function") await erpFlowRemoveOrder(o.id);
    else await sb.from("tasks").delete().eq("data->source->>sampleId", String(o.id));
  } catch (e) { alert("Грешка при изтриване на задачите: " + (e.message || e)); return; }
  const delO = await sb.from("customer_orders").delete().eq("id", o.id);
  if (delO.error) { alert("Грешка при изтриване на заявката: " + delO.error.message); return; }
  alert("Заявката и задачите ѝ по цеховете са изтрити.");
  erpRenderCustomerOrders();
}

async function erpCOSaveClick(o) {
  const btn = document.getElementById("co-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  try {
    await erpSaveCO(o);
    await erpLoadCustomerOrders();
    if (btn) { btn.disabled = false; btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) btn.textContent = "💾 Запази"; }, 1500); }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; }
    alert("Грешка при запис: " + (e.message || e));
  }
}

/* ---------- Разбивка на материалите за цялата заявка ---------- */
function erpCOExplode(o) {
  const acc = {};
  const rec = (pid, mult, anc) => {
    (ERP.linesByProduct[pid] || []).forEach(l => {
      if (l.material_id) acc[l.material_id] = (acc[l.material_id] || 0) + mult * (Number(l.quantity) || 1);
      else if (l.child_product_id && !anc.has(l.child_product_id)) rec(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]));
    });
  };
  (o.lines || []).forEach(l => rec(l.productId, erpToNum(l.qty) || 0, new Set([l.productId])));
  return Object.entries(acc).map(([mid, qty]) => {
    const m = ERP.matById[mid] || {};
    const stock = Number(m.stock) || 0;
    return { name: m.name || "", unit: m.unit || "", required: qty, stock, shortage: Math.max(0, qty - stock) };
  }).sort((a, b) => b.shortage - a.shortage || a.name.localeCompare(b.name, "bg"));
}
function erpCOMaterials(o) {
  const box = document.getElementById("co-extra");
  const rows = erpCOExplode(o);
  if (!rows.length) { box.innerHTML = `<p class="report-empty">Няма материали (добави продукти с рецепта).</p>`; return; }
  const short = rows.filter(r => r.shortage > 0).length;
  box.innerHTML = `
    <h4 class="erp-group-head">Необходими материали за заявката${short ? ` · <span class="erp-warn">${short} за поръчка</span>` : ""}</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Суровина</th><th>Мярка</th><th class="num">Нужно</th><th class="num">Налично</th><th class="num">Недостиг</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr class="${r.shortage > 0 ? "erp-below" : ""}">
          <td data-label="Суровина">${escapeHtml(r.name)}</td>
          <td data-label="Мярка">${escapeHtml(r.unit)}</td>
          <td class="num" data-label="Нужно">${erpNum(r.required)}</td>
          <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
          <td class="num" data-label="Недостиг">${r.shortage > 0 ? `<span class="erp-warn">${erpNum(r.shortage)} ⚠</span>` : "0"}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

/* ---------- 🗓 В плана на Занитване ----------
   Праща продуктовите редове на заявката като приоритети в „План за
   седмицата" (app_config nit_week_plan). Подреждането става в Занитване. */
async function erpCOToNitPlan(o) {
  const lines = (o.lines || []).filter(l => l.productId);
  if (!lines.length) { alert("Заявката няма продуктови редове."); return; }
  let plan = { items: [] };
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "nit_week_plan").maybeSingle();
    if (data && data.data && Array.isArray(data.data.items)) plan = data.data;
  } catch (e) {}
  const note = "заявка №" + (o.ourNo || "—") + (o.clientName ? " · " + o.clientName : "");
  let added = 0;
  lines.forEach(l => {
    const p = (typeof ERP !== "undefined" && ERP.prodById && ERP.prodById[l.productId]) || {};
    const code = String(p.code || "").trim();
    if (plan.items.some(it => (it.code || "") === code && (it.note || "") === note)) return;   // без дубли от същата заявка
    plan.items.push({ code, name: p.name || l.name || "", qty: erpToNum(l.qty) || 0, note, done: false });
    added++;
  });
  if (!added) { alert("Тези редове вече са в плана (от същата заявка)."); return; }
  const { error } = await sb.from("app_config").upsert({ id: "nit_week_plan", data: plan, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис на плана: " + error.message); return; }
  alert(`Добавени ${added} позиции в „План за седмицата" на Занитване.\nПодреди приоритетите от прозореца на Занитване → 🗓 План за седмицата (стрелките ↑↓).`);
}

/* ---------- Пускане в производство (поточно, серии между поръчки) ---------- */
/* Какво би дошло от склада при пускане на тази заявка — изделията И частите им.
   Ползва същата разбивка като самото пускане (erpFlowSteps с карта наличности),
   но само за преглед. Наличностите са ПРЯСНИ, минус резервираното от другите
   заявки (flow_netting), за да не питаме за бройки, които са заети. */
async function erpCOStockPreview(o, lines) {
  if (typeof erpFlowSteps !== "function") return [];
  const stock = {};
  try {
    const { data, error } = await erpSelectAll("v_product_stock", "id,stock");
    if (error) return [];
    (data || []).forEach(r => { stock[r.id] = Math.max(0, Number(r.stock) || 0); });
  } catch (e) { return []; }
  try {
    const { data: cfg } = await sb.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
    const byOrder = (cfg && cfg.data && cfg.data.byOrder) || {};
    Object.entries(byOrder).forEach(([oid, per]) => {
      if (String(oid) === String(o.id)) return;               // своята резервация не се брои
      Object.entries(per || {}).forEach(([pid, q]) => {
        stock[pid] = Math.max(0, (Number(stock[pid]) || 0) - (Number(q) || 0));
      });
    });
  } catch (e) { /* без резервации — по-скоро ще попитаме, отколкото да пропуснем */ }
  // Собствените ВЕЧЕ произведени бройки на тази заявка (при пре-пускане) не се
  // предлагат като „налични" — те са отчетени по задачите ѝ и пускането ги
  // брои там (erpFlowOwnStockedLeft, стъпка 0г), не като наличност от рафта.
  try {
    if (typeof erpFlowOwnStockedLeft === "function" && typeof erpSelectAll === "function" && o.production) {
      const { data: fr } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
      const own = erpFlowOwnStockedLeft(fr || [], o.id, stock);
      Object.keys(own).forEach(pid => { stock[pid] = Math.max(0, (Number(stock[pid]) || 0) - own[pid]); });
    }
  } catch (e) { /* без корекцията — прегледът показва повече, пускането пак смята вярно */ }
  const consumed = {};
  const topIds = new Set(lines.map(l => String(l.productId)));
  const need = {};
  lines.forEach(l => {
    need[String(l.productId)] = (need[String(l.productId)] || 0) + l.qty;
    try {
      erpFlowSteps({ erpProductId: l.productId, erpQty: l.qty },
        { stock, consumed, matSubs: o.matSubs || null });
    } catch (e) {}
  });
  return Object.entries(consumed)
    .filter(([, q]) => (Number(q) || 0) > 0)
    .map(([pid, q]) => {
      const p = (ERP.prodById || {})[pid] || {};
      return { pid, code: p.code || "", name: p.name || ("№ " + pid), use: Number(q) || 0,
        need: need[String(pid)] || Number(q) || 0, top: topIds.has(String(pid)) };
    })
    .sort((a, b) => (b.top - a.top) || String(a.code).localeCompare(String(b.code), "bg"));
}

async function erpCOProduce(o) {
  if (typeof produceAllowed === "function" && !produceAllowed()) { alert("Пускането в производство към момента е позволено само на Данко и Григор."); return; }
  if (!(o.lines || []).length) { alert("Добави поне един продукт."); return; }
  // Първо запазваме, за да има № и id за връзката към задачите.
  try { await erpSaveCO(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

  // Само продуктовите редове тръгват в производство (покупните материали за
  // препродажба се изписват при продажбата, не се произвеждат).
  const lines = (o.lines || []).filter(l => l.productId).map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
  let totalSteps = 0, external = [];
  const missMap = {};
  lines.forEach(l => {
    const r = (typeof erpFlowSteps === "function") ? erpFlowSteps({ erpProductId: l.productId, erpQty: l.qty }, { matSubs: o.matSubs || null }) : { steps: [], external: [], missing: [] };
    totalSteps += r.steps.length; external = external.concat(r.external);
    (r.missing || []).forEach(m => { const k = m.code || m.name; const c = missMap[k] || (missMap[k] = { code: m.code, name: m.name, qty: 0 }); c.qty += Number(m.qty) || 0; });
  });
  const missList = Object.values(missMap);
  const missTxt = missList.length
    ? `\n\n⚠ ЛИПСВАЩИ ДЕТАЙЛИ (нямат рецепта с операции и не са на склад):\n`
      + missList.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужни ${erpNum(m.qty)} бр.`).join("\n")
      + `\n\nСглобяването на тези изделия НЯМА да се пусне, докато детайлите нямат рецепта или наличност.`
    : "";
  if (!totalSteps) {
    alert(missList.length
      ? `Не мога да пусна — детайлите нямат рецепта с операции и не са на склад.${missTxt}`
      : "Няма операции за пускане (продуктите нямат рецепта с операции).");
    return;
  }

  const already = o.production && o.production.count;
  let msg = `Ще пусна ПОТОЧНО производство за заявка №${o.ourNo} (${lines.length} продукта).\n\n`
    + `Еднакви детайли от различни поръчки се обединяват в СЕРИЯ; всяка операция приема детайлите постепенно, колкото са отчетени в предната.`;
  if (external.length) msg += `\n\n${external.length} външни операции (напр. поцинковане) са за подизпълнител.`;
  msg += missTxt;
  if (o.matSubs && Object.keys(o.matSubs).length) {
    const mn = id => { const m = (ERP.matById || {})[id] || {}; return `${m.code || ""} ${m.name || "материал " + id}`.trim(); };
    msg += `\n\n🔁 СМЕНЕН МАТЕРИАЛ за тази поръчка:\n` + Object.entries(o.matSubs).map(([a, b]) => `• ${mn(a)} → ${mn(b)}`).join("\n");
  }
  msg += `\n\n📦 Материалите за производството ще се изпишат от склада.`;
  msg += `\n✅ Щом мине последната операция, готовото изделие влиза в Склад детайли (после се изписва с Продажба).`;
  if (already) msg += `\n\n♻ Вече има пуснато производство по тази заявка. НОВИТЕ редове/бройки ще се ДОБАВЯТ към него, а вече произведеното и отчетеното по цеховете СЕ ЗАПАЗВАТ (нищо не се пуска отначало).`;
  if (!confirm(msg)) return;

  // Какво БИ СЕ ВЗЕЛО от склада — не само готовите изделия, а и частите им.
  // Наличностите се четат ПРЯСНО (кешът от отварянето на ЕРП остарява) и от тях
  // се маха резервираното от другите заявки.
  let noNet = false, useStock = null;
  const ready = await erpCOStockPreview(o, lines);
  if (ready.length) {
    const ans = await new Promise(resolve => {
      const { wrap, close } = erpDialog(`
        <h3>📦 За тази заявка има налични бройки в склада</h3>
        <p class="hint">В колоната „Ползвай" напиши КОЛКО от наличните да се вземат — толкова НЕ се пуска в цех, останалото се произвежда. 0 = не пипай този детайл. Ако наличните са правени за <b>друга заявка</b>, която още не е продадена — „Произведи всичко наново" ги пази всичките.</p>
        <div style="max-height:46vh;overflow:auto"><table class="report-table erp-table">
          <thead><tr><th>Код</th><th>Изделие</th><th class="num">Нужни</th><th class="num">Свободни</th><th class="num">Ползвай</th></tr></thead>
          <tbody>${ready.map((x, i) => `<tr><td><b>${escapeHtml(x.code)}</b></td><td>${escapeHtml(x.name)}${x.top ? "" : ' <span class="erp-muted">(част)</span>'}</td><td class="num">${erpNum(x.need)}</td><td class="num">${erpNum(x.use)}</td><td class="num"><input type="number" class="ns-q" data-i="${i}" min="0" max="${x.use}" step="1" value="${x.use}" style="width:84px"></td></tr>`).join("")}</tbody>
        </table></div>
        <div class="erp-dialog-actions">
          <button class="btn" id="nn-use">➖ Ползвай избраните (произвеждаме останалото)</button>
          <button class="btn btn-primary" id="nn-new">🏭 Произведи ВСИЧКО наново (пази наличните)</button>
        </div>`);
      wrap.querySelector("#nn-use").addEventListener("click", () => {
        const m = {};
        wrap.querySelectorAll(".ns-q").forEach(inp => {
          const x = ready[Number(inp.dataset.i)]; if (!x) return;
          m[x.pid] = Math.min(x.use, Math.max(0, Math.round(Number(String(inp.value).replace(",", ".")) || 0)));
        });
        close(); resolve({ noNet: false, useStock: m });
      });
      wrap.querySelector("#nn-new").addEventListener("click", () => { close(); resolve({ noNet: true, useStock: null }); });
    });
    noNet = ans.noNet; useStock = ans.useStock;
  }

  const res = await erpFlowApply({
    clientName: o.clientName || "", deadline: o.deadline || "", sampleId: o.id,
    sampleType: "customer_order", orderNo: o.ourNo || "",
    noNet,      // true = складът изобщо не се пипа (нито изделията, нито частите)
    noNetTop: noNet,
    useStock,   // { pid: брой } — ръчният избор какво/колко от склада да се ползва (0д)
    matSubs: o.matSubs || null,   // смяна на материал само за тази поръчка (Щрипс → Шина)
    stockTop: true,   // готовото изделие влиза в Склад детайли при завършване (после се изписва с Продажба)
  }, lines);
  if (res.error) { alert("Грешка при създаване на задачи: " + (res.error.message || res.error)); return; }

  const fs = res.fromStock || [];
  o.production = { at: new Date().toISOString(), count: (res.seriesCount != null ? res.seriesCount : totalSteps), flow: true, external: external.length, fromStock: fs.length, stockCover: fs };
  // Ако всичко е налично от склада (0 операции) — заявката е готова за продажба;
  // иначе е „в производство". Частта, очаквана от текущо „Производство за склад"
  // (wip), НЕ е на рафта → заявката остава „в производство", докато влезе.
  const wipTotal = fs.reduce((s, f) => s + (Number(f.wip) || 0), 0);
  const readyNow = (res.seriesCount === 0) && !(res.missing || []).length && !wipTotal;
  o.status = readyNow ? "готова за продажба" : "в производство";
  // Записваме статуса надеждно (не го гълтаме тихо).
  try { await erpSaveCO(o); }
  catch (e) { alert("⚠ Производството е пуснато, но статусът не се записа: " + (e.message || e) + "\nОтвори заявката пак и натисни 💾 Запази."); }
  try { await erpLoadCustomerOrders(); } catch {}
  const st = document.getElementById("co-status"); if (st) st.value = o.status;
  const miss = res.missing || [];
  const matShort = res.materialsShort || [];
  if ((res.seriesCount === 0) && !miss.length) {
    alert((wipTotal
        ? `⏳ Нищо ново не се пуска в цех — количествата са покрити, но ${erpNum(wipTotal)} бр. се ОЧАКВАТ от текущо „Производство за склад" (още в цех).\nЗаявката остава „в производство"; като складовите бройки влязат в Склад детайли, натисни „🏭 Пусни в производство" отново — ще я обяви готова.\n`
        : `✅ Всичко е налично в Склад детайли — няма какво да се произвежда.\n`)
      + (fs.length ? `\n📦 Покрито от склад:\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.${f.wip ? ` (⏳ ${erpNum(f.wip)} бр. от тях идват от „Производство за склад" — още в цех)` : ""}`).join("\n") + `\n` : "")
      + (wipTotal ? "" : `\nЗаявката е готова за продажба — натисни „🧾 Създай продажба".`));
    if (typeof erpRenderCOForm === "function") erpRenderCOForm(o);
    return;
  }
  alert(`Готово! Пуснах поточно производство.\n`
    + `Всяка операция приема детайлите постепенно, колкото са отчетени в предната.`
    + (noNet ? `\n\n🏭 По твой избор складът НЕ е пипан — всичко се произвежда наново, наличните остават запазени.` : "")
    + (fs.length ? `\n\n📦 Взети от склад (не се пускат в цех):\n` + fs.map(f => `• ${f.code ? f.code + " " : ""}${f.name}: ${erpNum(f.qty)} бр.${f.wip ? ` (⏳ ${erpNum(f.wip)} бр. от тях идват от „Производство за склад" — още в цех)` : ""}`).join("\n") : "")
    + (matShort.length ? `\n\n⚠ НЯМА ДА СТИГНЕ МАТЕРИАЛ (виж таб „⚠ Липсващи материали"):\n` + matShort.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: нужно ${erpNum(m.need)}, налично ${erpNum(m.have)} ${m.unit || ""}`).join("\n") : "")
    + (miss.length ? `\n\n⚠ Сглобяване НЕ е пуснато — липсват детайли без рецепта/наличност:\n` + miss.map(m => `• ${m.code ? m.code + " " : ""}${m.name}: ${erpNum(m.qty)} бр.`).join("\n") : "")
    + (external.length ? `\n\n(${external.length} външни операции са за подизпълнител.)` : ""));
  if (typeof erpUpdateMissingBadge === "function") erpUpdateMissingBadge();   // осветяваме таба, ако липсва материал
  // Пре-рисуваме цялата форма, за да се появи бутонът „⬅ Изтегли от производство"
  // и проследяването (иначе остават скрити до повторно отваряне на заявката).
  erpRenderCOForm(o);
}

// Изтегля заявката от производство: маха задачите ѝ по цеховете, освобождава
// резервираната наличност и заявката става отново „чакаща" (нова). ГОТОВОТО
// (вече заприходено) ОСТАВА в склада — то е произведено и физически го има;
// анулира се само отчетената недовършена работа (виж erpFlowDropSeries).
async function erpCOWithdraw(o) {
  if (!o.id) return;
  let extra = "";
  try {
    const pv = (typeof erpFlowWithdrawPreview === "function") ? await erpFlowWithdrawPreview(o.id) : null;
    if (pv && !pv.error) {
      if (pv.keep.length) extra += `\n✔ ОСТАВАТ в Склад детайли (вече произведени):\n`
        + pv.keep.map(k => `• ${k.code}: ${erpNum(k.qty)} бр.`).join("\n") + "\n";
      if (pv.lose.length) extra += `\n⚠ АНУЛИРА СЕ отчетена, но НЕдовършена работа (материалът ѝ се връща в склада; при повторно пускане цехът я отчита наново):\n`
        + pv.lose.map(l => `• ${l.code}${l.operation ? " · " + l.operation : ""}: ${erpNum(l.qty)} бр.`).join("\n") + "\n";
      if (pv.shared) extra += `\nℹ ${pv.shared} задачи са в серии с други заявки — изработеното по тях остава за останалите заявки.\n`;
    }
  } catch (e) { /* без преглед — изтеглянето пак е коректно */ }
  if (!confirm(`Да изтегля ли заявка №${o.ourNo || ""} от производство?\n\nЗадачите ѝ по цеховете ще се премахнат, резервираната наличност се освобождава и заявката ще стане отново „чакаща".\n${extra}\n(Заявката НЕ се трие — остава като чакаща.)`)) return;
  try {
    if (typeof erpFlowRemoveOrder === "function") await erpFlowRemoveOrder(o.id);
    else await sb.from("tasks").delete().eq("data->source->>sampleId", String(o.id));
  } catch (e) { alert("Грешка при изтегляне: " + (e.message || e)); return; }
  o.production = null;
  o.status = "нова";
  try { await erpSaveCO(o); await erpLoadCustomerOrders(); } catch {}
  alert("Заявката е изтеглена от производство и е отново чакаща.");
  erpRenderCOForm(o);
}

/* ---------- Проследяване ---------- */
async function erpCOTracking(o) {
  const box = document.getElementById("co-extra");
  if (!box || !o.id) return;
  box.innerHTML = `<p class="erp-muted">Производство: зареждане на напредъка…</p>`;
  const { rows, error } = (typeof erpFlowTasksFor === "function")
    ? await erpFlowTasksFor(o.id)
    : { rows: [], error: { message: "Липсва поточният модул." } };
  if (error) { box.innerHTML = `<p class="erp-warn">${escapeHtml(error.message || String(error))}</p>`; return; }
  const planned = rows.length;
  const done = rows.filter(r => r.done).length;
  const active = rows.filter(r => !r.done).map(r => r.data || {});
  const pct = planned ? Math.round(done / planned * 100) : 0;
  const activeHtml = active.length
    ? `<div class="erp-prod-active">${active.map(a => `↳ <b>${escapeHtml(a.product || "")}</b> — ${escapeHtml(a.operation || "")} (цех ${escapeHtml(a.workshop || "")}): ${Number(a.produced) || 0}/${Number(a.qty) || 0}${(a.source && a.source.orderIds && a.source.orderIds.length >= 2) ? " · СЕРИЯ" : ""}`).join("<br>")}</div>`
    : (done ? `<div class="erp-prod-active">✓ всички операции са готови</div>` : "");
  const allDone = planned > 0 && done === planned;
  const allFromStock = !planned && o.production && Number(o.production.count) === 0;
  // Производството е приключило (или всичко е от склад) → „готова за продажба".
  if ((allDone || allFromStock) && o.status === "в производство") {
    o.status = "готова за продажба";
    try { await erpSaveCO(o); const st = document.getElementById("co-status"); if (st) st.value = o.status; if (typeof erpCOList !== "undefined" && Array.isArray(erpCOList)) { const it = erpCOList.find(x => String(x.id) === String(o.id)); if (it) it.status = o.status; } } catch (e) {}
  }
  box.innerHTML = planned
    ? `<div class="erp-prod-line"><b>Поточно производство:</b> ${done} / ${planned} операции готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button class="btn btn-small" id="co-refresh">↻</button></div>${activeHtml}`
       + (allDone ? `<div class="erp-prod-active" style="color:#047857">✅ Готовото е в Склад детайли (заприходява се автоматично при последната операция). Изпиши го с „🧾 Създай продажба".</div>` : "")
    : (allFromStock
        ? `<div class="erp-prod-active" style="color:#047857"><b>✅ Всичко е налично в Склад детайли</b> — няма какво да се произвежда. Готово за продажба (🧾 Създай продажба).</div>`
        : `<p class="erp-muted">Няма задачи за тази заявка.</p>`);
  const rb = document.getElementById("co-refresh"); if (rb) rb.addEventListener("click", () => erpCOTracking(o));
}
