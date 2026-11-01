/* Данко Системс — ЕРП „🚚 ЛОГИСТИКА" (Офис), по Данко 20.10.2026.
   Три части:
   1) 🗺 Дестинации — всички разтоварни адреси (Consignee) от издадените
      износни фактури, групирани по клиент+получател, с брой фактури и
      последна дата. От всяка дестинация тръгва запитване с 1 клик.
   2) 📨 Запитване за транспорт — до транспортните фирми от указателя
      (категория „Транспорт / логистика") през имейл композитора (Brevo).
   3) 📜 Товари (архив) — коя фактура с коя транспортна фирма е натоварена:
      статус заявен → натоварен → разтоварен, камион, ЧМР бележка. Пълни се
      „🔄 От фактурите" (o.transport.carrier) и на ръка.
   Пази се в app_config id="logistics_loads": { loads: [...] }.
   Ползва erpDialog/erpDMY/escapeHtml/sb/erpInvoices/erpMailComposeDialog. */

let LOGI = null;             // { loads: [...] }
// Преработка по Данко (01.11.2026): останаха ТРИ раздела — 📨 Запитвания
// (работният екран), 🗺 Дестинации и 🧾 Фактури транспорт. Поръчки/План
// товарене/Товари/Анализ транспорт отпаднаха: заявките живеят в „Заявки от
// клиенти" (с камиончето 🚛 за запитване), а данните на старите товари и
// помощните функции (logiBindInvoice и др.) остават — спят, нищо не губим.
let logiView = "inq";        // inq | dest | tinv
let logiQ = "";

async function logiLoad(force) {
  if (LOGI && LOGI.__db && !force) return LOGI;
  try {
    const { data, error } = await sb.from("app_config").select("data").eq("id", "logistics_loads").maybeSingle();
    if (error) throw error;
    LOGI = { loads: (data && data.data && data.data.loads) || [], inq: (data && data.data && data.data.inq) || [], wplan: (data && data.data && data.data.wplan) || [], tcost: (data && data.data && data.data.tcost) || {}, __db: true };
  } catch (e) {
    // Неуспешен прочит НЕ се кешира като „празен регистър": запис върху такъв
    // обект би изтрил всички товари и запитвания. __db=false → logiSave отказва.
    if (!LOGI) LOGI = { loads: [], inq: [], wplan: [], tcost: {}, __db: false };
  }
  return LOGI;
}
async function logiSave() {
  if (!LOGI || !LOGI.__db) { alert("Логистиката не се зареди от базата (прекъсната връзка?). Нищо не е записано — презареди страницата и опитай пак."); return false; }
  const { error } = await sb.from("app_config").upsert({ id: "logistics_loads", data: { loads: LOGI.loads || [], inq: LOGI.inq || [], wplan: LOGI.wplan || [], tcost: LOGI.tcost || {} }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function logiNextId() { let m = 0; ((LOGI || {}).loads || []).forEach(l => { if ((Number(l.id) || 0) > m) m = Number(l.id); }); return m + 1; }
function logiNorm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

/* Транспортните фирми от указателя (категория „Транспорт / логистика"). */
function logiCarriers() {
  return ((typeof CONTACTS !== "undefined" && CONTACTS) || [])
    .filter(c => /транспорт/i.test(c.category || "") && (c.email || "").includes("@"))
    .sort((a, b) => String(a.company || "").localeCompare(String(b.company || ""), "bg") || String(a.contact_person || "").localeCompare(String(b.contact_person || ""), "bg"));
}

/* Дестинациите: издадените НЕ-проформи с получател или износен клиент. */
function logiDestinations() {
  const by = new Map();   // ключ клиент|получател|град
  ((typeof erpInvoices !== "undefined" && erpInvoices) || []).forEach(o => {
    if (o.kind === "proforma" || !o.posted) return;
    const cl = (o.client && o.client.name) || "";
    const cs = (o.consignee && (o.consignee.name || o.consignee.street || o.consignee.city)) ? o.consignee : null;
    const who = cs || o.client || {};
    const addr = [who.street, who.city, who.country].filter(Boolean).join(", ");
    if (!cl && !addr) return;
    // Само износ/с адрес: вътрешните без получател не са интересни тук.
    const isExport = String(invSeriesOfInvoice ? invSeriesOfInvoice(o) : o.seriesKey || "") === "1";
    if (!cs && !isExport) return;
    const key = logiNorm(cl) + "|" + logiNorm(who.name || "") + "|" + logiNorm(addr);
    const g = by.get(key) || { client: cl, consignee: who.name || cl, addr, country: who.country || "", n: 0, last: "", lastNo: "" };
    g.n++;
    if (String(o.issueDate || "") > g.last) { g.last = o.issueDate || ""; g.lastNo = o.docNo || ""; }
    by.set(key, g);
  });
  return [...by.values()].sort((a, b) => String(b.last).localeCompare(String(a.last)));
}

/* 📨 Запитване от ДОКУМЕНТ (заявка или фактура): маршрут, палети и тегло се
   попълват от „✎ Транспорт"/Опаковки, а запитването влиза в регистъра ВЪРЗАНО
   към поръчката (orderId/наш №) или към фактурата. Данко, 20.10.2026:
   транспортът се търси докато е още поръчка; фактурата идва после — сама. */
function logiInquiryForDoc(o, link) {
  const tr = (o && o.transport) || {};
  const lk = link || {};
  const pal = (typeof erpDocAutoRows === "function") ? (erpDocAutoRows(o) || []) : [];
  const totKg = (erpToNum(tr.totalWeightKg) || 0) || pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  const cnt = ((o.pallets || []).length) || Number(tr.totalPackages) || pal.length || 0;
  const clientName = (o.client && o.client.name) || lk.client || "";
  logiInquiry({
    from: tr.loadPlace || "Пловдив, България",
    to: tr.unloadPlace || tr.destination || ((o.client && [o.client.city, o.client.country].filter(Boolean).join(", ")) || ""),
    cargo: cnt ? (cnt + " палета" + (totKg ? ", общо ~" + erpNum(totKg) + " кг" : "")) : "",
    ready: tr.loadDate || tr.shipDate || "",
    incoterms: tr.incoterms || "",
    label: [clientName, lk.ourNo ? "поръчка №" + lk.ourNo : (lk.invNo || o.docNo ? "ф-ра №" + (lk.invNo || o.docNo) : "")].filter(Boolean).join(" — "),
    orderId: lk.orderId || null, ourNo: lk.ourNo || "",
    invNo: lk.invNo || (lk.orderId ? "" : String(o.docNo || "")),
    client: clientName,
  });
}

/* 📨 Запитване до транспортните: избор на фирми + готов текст. */
function logiInquiry(preset) {
  const carriers = logiCarriers();
  const p = preset || {};
  const { wrap, close } = erpDialog(`
    <h3>📨 Запитване за транспорт</h3>
    ${carriers.length ? `<p class="hint" style="margin:0 0 6px">Избери до кого — транспортните фирми от указателя (👥 Клиенти/Доставчици, категория „Транспорт / логистика"). Клик върху реда = отметка.</p>
    <div style="max-height:56vh;overflow:auto;margin-bottom:8px">
    <table class="report-table erp-table" style="font-size:13px">
      <thead><tr><th class="pay-chk"><input type="checkbox" id="lgi-all" title="Избери всички" /></th><th>Фирма</th><th>Лице</th><th>Имейл</th></tr></thead>
      <tbody>${carriers.map((c, i) => `<tr class="erp-clickable" data-ci="${i}">
        <td class="pay-chk"><input type="checkbox" class="lgi-c" data-i="${i}" /></td>
        <td><b>${escapeHtml(c.company || "—")}</b>${(c.scope || c.notes) ? `<div style="font-size:11.5px;color:#64748b;max-width:260px">${escapeHtml(c.scope || c.notes)}</div>` : ""}</td>
        <td>${escapeHtml(c.contact_person || "")}${c.phone ? ` <span class="erp-muted">· ☎ ${escapeHtml(c.phone)}</span>` : ""}</td>
        <td class="t-code">${escapeHtml(c.email)}</td>
      </tr>`).join("")}</tbody>
    </table>
    </div>`
      : `<p class="hint">В указателя няма контакти с категория „Транспорт / логистика" и имейл — добави ги в 👥 Клиенти/Доставчици („+ Нов контакт", категория „Транспорт / логистика"), за да излизат тук. Можеш и да напишеш имейла на ръка в следващата стъпка.</p>`}
    <div class="erp-dialog-actions"><button class="btn" id="lgi-cancel">Отказ</button><button class="btn btn-primary" id="lgi-go">Продължи към писмото →</button></div>`);
  try { wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide"); } catch (e) {}
  // Клик по реда = отметка; „избери всички" горе вляво.
  wrap.querySelectorAll("tr[data-ci]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.tagName === "INPUT") return;
    const cb = tr.querySelector(".lgi-c"); if (cb) cb.checked = !cb.checked;
  }));
  const allCb = wrap.querySelector("#lgi-all");
  if (allCb) allCb.addEventListener("change", () => wrap.querySelectorAll(".lgi-c").forEach(cb => { cb.checked = allCb.checked; }));
  wrap.querySelector("#lgi-cancel").addEventListener("click", close);
  wrap.querySelector("#lgi-go").addEventListener("click", () => {
    const sel = [...wrap.querySelectorAll(".lgi-c:checked")].map(x => carriers[Number(x.dataset.i)]);
    close();
    const text = p.text || `Здравейте,

Молим за оферта за транспорт:

• Маршрут: ${p.from || "Пловдив, България"} → ${p.to || "(адрес на разтоварване)"}
• Товар: ${p.cargo || "(брой палети / тегло)"}
• Готовност за товарене: ${p.ready || "(дата)"}
${p.incoterms ? "• Условие: " + p.incoterms + "\n" : ""}
Моля, посочете цена и срок за доставка.

Поздрави,
Данко Системс`;
    erpMailComposeDialog({
      title: "🚚 Запитване за транспорт" + (p.label ? " — " + p.label : ""),
      to: sel.map(c => c.email).join(", "),
      subject: p.subject || "Запитване за транспорт — Данко Системс",
      text, datalist: "mc-contacts",
      // 📨 Регистър: всяко изпратено запитване се помни (кога, до кого, какво),
      // за да се вижда в Логистика → Запитвания и да се препраща на друг.
      onSent: async (toV, info) => {
        try {
          await logiLoad(true);   // свеж прочит: композиторът може да е стоял дълго отворен
          LOGI.inq = LOGI.inq || [];
          // Товарът (брой палети) се чете от реда „• Товар: …" на ФИНАЛНИЯ
          // текст — хваща и редакциите, направени в композитора преди пращане.
          LOGI.inq.push({
            id: Date.now(), at: new Date().toISOString(),
            to: [toV].concat((info && info.extras) || []).filter(Boolean),
            subject: (info && info.subject) || "", text: (info && info.text) || text,
            label: p.label || "", cargo: logiCargoOf({ text: (info && info.text) || text }),
            // Връзката с поръчката/фактурата — за колоната „Поръчка / Ф-ра"
            // и за бутона „🚛 → Товар" (товарът наследява поръчката).
            orderId: p.orderId || null, ourNo: p.ourNo || "", invNo: p.invNo || "",
            client: p.client || "", dest: p.to || "",
          });
          await logiSave();
          if (typeof ERP !== "undefined" && ERP.tab === "logistics") erpRenderLogistics();
          // Камиончето на заявката става жълто веднага (Заявки от клиенти).
          else if (typeof ERP !== "undefined" && ERP.tab === "customer" && typeof erpRenderCustomerOrders === "function") erpRenderCustomerOrders();
        } catch (e2) { console.warn("регистър запитвания:", e2); }
      },
    });
  });
}

/* Товарът на запитване: полето cargo, а за старите записи — от текста
   (редът „• Товар: …"). Непопълнен шаблон „(брой палети / тегло)" = празно. */
function logiCargoOf(x) {
  let c = String((x && x.cargo) || "").trim();
  if (!c) {
    const ln = String((x && x.text) || "").split("\n").find(l => l.trim().startsWith("• Товар"));
    c = ln ? ln.replace(/^\s*•\s*Товар:?\s*/, "").trim() : "";
  }
  return /^\(/.test(c) ? "" : c;
}

/* 📜 Товарите: авто-редове от издадените износни фактури с превозвач.
   Ако по поръчката на фактурата вече ЧАКА товар (създаден преди издаването,
   без №) — той се ДОПЪЛВА с номера/превозвача, не се прави дублиращ ред. */
function logiSyncFromInvoices() {
  const loads = LOGI.loads;
  const have = new Set(loads.map(l => logiNorm(l.invNo)).filter(Boolean));
  // Продажба → заявка (за проследяване фактура → поръчка без заявки към базата).
  const orderBySale = new Map();
  ((typeof erpSales !== "undefined" && erpSales) || []).forEach(s => { if (s.fromOrderId) orderBySale.set(String(s.id), String(s.fromOrderId)); });
  // Поръчка → наш № (резерва за ръчни товари, въведени само с №).
  const noByOrder = new Map();
  ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(c => { if (c.ourNo) noByOrder.set(String(c.id), logiNorm(c.ourNo)); });
  let added = 0, linked = 0;
  ((typeof erpInvoices !== "undefined" && erpInvoices) || []).forEach(o => {
    if (o.kind === "proforma" || !o.posted || !o.docNo) return;
    const tr = o.transport || {};
    const cs = (o.consignee && (o.consignee.street || o.consignee.city)) ? o.consignee : (o.client || {});
    const isExport = String(invSeriesOfInvoice ? invSeriesOfInvoice(o) : o.seriesKey || "") === "1";
    if (!isExport && !tr.carrier) return;
    if (have.has(logiNorm(o.docNo))) return;
    // Чакащ товар се допълва само от ИСТИНСКА фактура (не известие) — по ЕДИН
    // (най-стария) на поръчка: частичните пратки чакат следващите фактури.
    const oids = new Set();
    if ((o.kind || "invoice") === "invoice") {
      if (o.fromOrderId) oids.add(String(o.fromOrderId));
      (o.fromSaleIds || []).forEach(sid => { const x = orderBySale.get(String(sid)); if (x) oids.add(x); });
    }
    const oidNos = new Set([...oids].map(x => noByOrder.get(x)).filter(Boolean));
    const pool = loads
      .filter(l => !l.invNo && ((l.orderId && oids.has(String(l.orderId))) || (!l.orderId && l.ourNo && oidNos.has(logiNorm(l.ourNo)))))
      .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
    const done = new Set();
    let matched = 0;
    pool.forEach(waiting => {
      const key = waiting.orderId ? "id:" + waiting.orderId : "no:" + logiNorm(waiting.ourNo);
      if (done.has(key)) return;
      done.add(key);
      waiting.invNo = String(o.docNo);
      if (!waiting.carrier && tr.carrier) { waiting.carrier = tr.carrier; waiting.status = waiting.status === "заявен" ? "натоварен" : waiting.status; }
      if (!waiting.vehicle) waiting.vehicle = tr.vehicleReg || "";
      if (!waiting.date) waiting.date = tr.shipDate || o.issueDate || "";
      if (!waiting.client) waiting.client = (o.client && o.client.name) || "";
      if (!waiting.dest) waiting.dest = [cs.city, cs.country].filter(Boolean).join(", ");
      matched++;
    });
    if (matched) { have.add(logiNorm(o.docNo)); linked += matched; return; }
    if (done.size) return;   // не би трябвало, но никога ред+допълване от една фактура
    loads.push({
      id: logiNextId(), invNo: String(o.docNo), date: tr.shipDate || o.issueDate || "",
      client: (o.client && o.client.name) || "", dest: [cs.city, cs.country].filter(Boolean).join(", "),
      carrier: tr.carrier || "", vehicle: tr.vehicleReg || "",
      orderId: oids.size === 1 ? [...oids][0] : null,
      status: tr.carrier ? "натоварен" : "заявен", note: "", at: new Date().toISOString(),
    });
    have.add(logiNorm(o.docNo)); added++;
  });
  return { added, linked };
}

/* ---- Връзката поръчка ↔ фактура ↔ товар (Данко, 20.10.2026) ----
   Транспортът се търси докато е още ПОРЪЧКА; товарът се създава с orderId и
   БЕЗ № фактура („⏳ очаква ф-ра"). Щом фактурата се издаде, тя се проследява:
   фактура → продажби (fromSaleIds) → заявка (fromOrderId) → чакащият товар
   получава номера ѝ АВТОМАТИЧНО. При анулиране връзката се разкача. */

// Всички orderId-та, към които води една фактура (директно или през продажбите).
async function logiOrderIdsOfInvoice(o) {
  const ids = new Set();
  if (o && o.fromOrderId) ids.add(String(o.fromOrderId));
  for (const sid of ((o && o.fromSaleIds) || [])) {
    let s = ((typeof erpSales !== "undefined" && erpSales) || []).find(x => String(x.id) === String(sid));
    if (!s) { try { const { data } = await sb.from("sales").select("data").eq("id", sid).maybeSingle(); s = (data && data.data) || null; } catch (e) {} }
    if (s && s.fromOrderId) ids.add(String(s.fromOrderId));
  }
  return ids;
}

/* Издадена фактура → попълва № на чакащите товари по същата поръчка.
   Само истински фактури — проформи и кредитни/дебитни известия не връзват. */
async function logiBindInvoice(o) {
  try {
    if (!o || !o.docNo || (o.kind || "invoice") !== "invoice") return 0;
    const ids = await logiOrderIdsOfInvoice(o);
    if (!ids.size) return 0;
    await logiLoad(true);   // свеж прочит — пишем от фактурния екран, не от таба
    // Наш №-тата на поръчките — резерва за ръчни товари, въведени само с №.
    const nos = new Set();
    for (const oid of ids) {
      let co = ((typeof erpCOList !== "undefined" && erpCOList) || []).find(x => String(x.id) === String(oid));
      if (!co) { try { const { data } = await sb.from("customer_orders").select("data").eq("id", oid).maybeSingle(); co = (data && data.data) || null; } catch (e) {} }
      if (co && co.ourNo) nos.add(logiNorm(co.ourNo));
    }
    // По ЕДИН чакащ товар на поръчка (най-старият): при частични пратки с
    // няколко камиона всяка фактура хваща своя товар, не всичките наведнъж.
    let n = 0;
    const done = new Set();
    (LOGI.loads || []).slice().sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).forEach(l => {
      if (l.invNo) return;
      const byId = l.orderId && ids.has(String(l.orderId));
      const byNo = !l.orderId && l.ourNo && nos.has(logiNorm(l.ourNo));
      if (!byId && !byNo) return;
      const key = byId ? "id:" + l.orderId : "no:" + logiNorm(l.ourNo);
      if (done.has(key)) return;
      done.add(key);
      const tr = o.transport || {};
      const cs = (o.consignee && (o.consignee.city || o.consignee.street)) ? o.consignee : (o.client || {});
      l.invNo = String(o.docNo);
      if (!l.client) l.client = (o.client && o.client.name) || "";
      if (!l.date) l.date = tr.shipDate || o.issueDate || "";
      if (!l.carrier && tr.carrier) { l.carrier = tr.carrier; if (l.status === "заявен") l.status = "натоварен"; }
      if (!l.vehicle) l.vehicle = tr.vehicleReg || "";
      if (!l.dest) l.dest = [cs.city, cs.country].filter(Boolean).join(", ");
      n++;
    });
    if (n) await logiSave();
    return n;
  } catch (e) { console.warn("logiBindInvoice:", e); return 0; }
}

/* Анулирана фактура → товарите ѝ се връщат в „⏳ очаква ф-ра" (само тези,
   които са вързани към поръчка — ръчните редове по номер не се пипат). */
async function logiUnbindInvoice(no) {
  try {
    if (!no) return 0;
    await logiLoad(true);   // свеж прочит — пишем от фактурния екран
    let n = 0;
    (LOGI.loads || []).forEach(l => { if (l.orderId && logiNorm(l.invNo) === logiNorm(no)) { l.invNo = ""; n++; } });
    if (n) await logiSave();
    return n;
  } catch (e) { return 0; }
}

/* Транспортният ред в картона на заявката: запитвания + товари по поръчката. */
async function logiOrderLine(orderId) {
  try {
    await logiLoad();
    const oid = String(orderId);
    const inqs = (LOGI.inq || []).filter(x => String(x.orderId || "") === oid);
    const loads = (LOGI.loads || []).filter(l => String(l.orderId || "") === oid);
    if (!inqs.length && !loads.length) return "";
    const parts = [];
    if (inqs.length) {
      const priced = inqs.filter(x => x.price);
      parts.push(`${inqs.length} запитван${inqs.length === 1 ? "е" : "ия"}${priced.length ? " (цени: " + priced.map(x => escapeHtml(x.price)).join("; ") + ")" : ""}`);
    }
    loads.forEach(l => parts.push(`товар: <b>${escapeHtml(l.carrier || "без превозвач")}</b> — ${l.invNo ? "ф-ра № " + escapeHtml(l.invNo) + ", " + escapeHtml(l.status || "") : "⏳ очаква ф-ра"}`));
    return `🚛 ${parts.join(" · ")}`;
  } catch (e) { return ""; }
}

/* ---- 📦 Поръчки в Логистика (за Таня, 20.10.2026) ----
   Офисът не влиза в Склад/ЕРП: всичко нужно за експедицията на една поръчка
   се вижда ТУК — срок, производство, палети/тегло, адрес, файлове, документи. */

/* Адресът на разтоварване: транспорта на заявката или паспорта на клиента
   (последният = най-новият адрес за доставка, събран от износните фактури). */
function logiOrderAddr(c) {
  // Получателят (Consignee) на самата заявка е С ПРЕДИМСТВО (Данко, 24.10.2026).
  const cs = c && c.consignee;
  if (cs && (cs.street || cs.city)) return [cs.name, [cs.street, cs.city, cs.country].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
  const tr = (c && c.transport) || {};
  if (tr.unloadPlace || tr.destination) return tr.unloadPlace || tr.destination;
  try {
    const prof = (typeof CLI_PROFILES !== "undefined" && CLI_PROFILES && CLI_PROFILES.byKey && typeof cliKey === "function")
      ? CLI_PROFILES.byKey[cliKey(c.clientName)] : null;
    const lines = String((prof && prof.addr) || "").split("\n").map(s => s.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : "";
  } catch (e) { return ""; }
}

/* Планираните товарения от „🚚 План за седмицата" (app_config loading_plan):
   поръчка → { палети, кг, week } за ТАЗИ седмица И НАПРЕД (Данко, 23.10.2026:
   „не само същата, но и следващи, които са планирани"). Миналите не влизат. */
let LOGI_PLAN = null;
async function logiPlanLoad() {
  const now = new Date();
  const u = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const monday = new Date(u.getTime() - ((u.getUTCDay() + 6) % 7) * 864e5);
  const p = n => String(n).padStart(2, "0");
  const mondayStr = `${monday.getUTCFullYear()}-${p(monday.getUTCMonth() + 1)}-${p(monday.getUTCDate())}`;
  const byOrder = new Map(), byNo = new Map();
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "loading_plan").maybeSingle();
    ((data && data.data && data.data.items) || []).forEach(x => {
      if (x.carried || !x.week || String(x.week) < mondayStr) return;   // миналото — не
      const add = (map, key) => {
        if (!key) return;
        const cur = map.get(key) || { kg: 0, pallets: 0, n: 0, week: String(x.week) };
        cur.kg += erpToNum(x.kg) || 0; cur.pallets += erpToNum(x.pallets) || 0; cur.n++;
        if (String(x.week) < cur.week) cur.week = String(x.week);   // най-ранната седмица
        map.set(key, cur);
      };
      add(byOrder, x.orderId ? String(x.orderId) : "");
      add(byNo, logiNorm(x.orderNo || ""));
    });
  } catch (e) {}
  LOGI_PLAN = { mondayStr, byOrder, byNo };
  return LOGI_PLAN;
}
function logiPlanOf(c, plan) {
  if (!plan || !c) return null;
  return plan.byOrder.get(String(c.id)) || (c.ourNo ? plan.byNo.get(logiNorm(c.ourNo)) : null) || null;
}
/* ---- 🗓 План за товарене по седмици (Данко, 23.10.2026) ----
   Работният транспортен план на Таня: за всяка седмица (от 43-та нататък) —
   дестинация, клиент, № фактура, палети, транспортна фирма и лице за контакт.
   Пази се в LOGI.wplan: [{ id, week (понеделник ISO), dest, client, invNo,
   pallets, carrier, contact, orderId, at }]. */

function logiMondayOf(d) {
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const mon = new Date(u.getTime() - ((u.getUTCDay() + 6) % 7) * 864e5);
  const p = n => String(n).padStart(2, "0");
  return `${mon.getUTCFullYear()}-${p(mon.getUTCMonth() + 1)}-${p(mon.getUTCDate())}`;
}
/* ISO номер на седмицата (43 за 19.10.2026) от понеделник „YYYY-MM-DD". */
function logiWeekNum(mondayStr) {
  const m = String(mondayStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return 0;
  const thu = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 3));
  const jan1 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  return Math.ceil(((thu - jan1) / 864e5 + 1) / 7);
}
function logiWeekShift(mondayStr, weeks) {
  const m = String(mondayStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + weeks * 7));
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
let LOGI_WPLAN_MON = null;   // разглежданият понеделник (начало: текущата седмица)
function logiWPlanNextId() { let m = 0; ((LOGI || {}).wplan || []).forEach(x => { if ((Number(x.id) || 0) > m) m = Number(x.id); }); return m + 1; }

/* Записите от „🚚 План за седмицата" за ТОЧНО тази седмица (за 🔄 попълване). */
async function logiPlanItemsFor(weekStr) {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "loading_plan").maybeSingle();
    return ((data && data.data && data.data.items) || []).filter(x => String(x.week) === String(weekStr) && !x.carried);
  } catch (e) { return []; }
}

/* „2026-10-26" (понеделник) → „26.10–01.11" за баджовете. */
function logiWeekLabel(weekStr) {
  const m = String(weekStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const mon = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sun = new Date(mon.getTime() + 6 * 864e5);
  const p = n => String(n).padStart(2, "0");
  return `${p(mon.getUTCDate())}.${p(mon.getUTCMonth() + 1)}–${p(sun.getUTCDate())}.${p(sun.getUTCMonth() + 1)}`;
}

/* Палети/тегло на заявката: от „✎ Палети" или от „✎ Транспорт". */
function logiOrderCargo(c) {
  const tr = (c && c.transport) || {};
  const pal = (c && c.pallets) || [];
  const cnt = pal.length || Number(tr.totalPackages) || 0;
  const kg = (erpToNum(tr.totalWeightKg) || 0) || pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  return { cnt, kg };
}

/* 👁 Поръчката за Таня — САМО ЗА ЧЕТЕНЕ: редове, палети, транспорт, файлове
   и печатните документи (Стокова / Packing List / Палет опис от Опаковки). */
function logiOrderViewDialog(co) {
  if (!co) { alert("Поръчката не е намерена в Заявките."); return; }
  const tr = co.transport || {};
  const pal = co.pallets || [];
  const cg = logiOrderCargo(co);
  const pct = (typeof erpCOPct === "function") ? erpCOPct(co) : { tot: 0, del: 0, pct: 0 };
  const files = co.files || [];
  const trRows = [
    ["Маршрут", [tr.loadPlace, tr.unloadPlace || tr.destination].filter(Boolean).join(" → ")],
    ["Превозвач", tr.carrier], ["Камион №", tr.vehicleReg], ["Шофьор", tr.driver],
    ["Дата на товарене", tr.shipDate ? erpDMY(tr.shipDate) : ""], ["Условие (Incoterms)", tr.incoterms],
    ["Тегло общо", cg.kg ? erpNum(cg.kg) + " кг" : ""], ["Естество на стоката", tr.goodsNature],
  ].filter(x => x[1]);
  const { wrap, close } = erpDialog(`
    <h3>📦 Поръчка № ${escapeHtml(co.ourNo || "—")} — ${escapeHtml(co.clientName || "")}</h3>
    <p class="hint" style="margin:0 0 8px">
      ${co.clientNo ? `Клиентски №: <b>${escapeHtml(co.clientNo)}</b> · ` : ""}Дата: <b>${erpDMY(co.date) || "—"}</b> · Срок: <b>${erpDMY(co.deadline) || "—"}</b> ·
      Статус: <b>${escapeHtml(co.status || "нова")}</b>${pct.tot ? ` · доставени <b>${erpNum(pct.del)}</b> от <b>${erpNum(pct.tot)}</b> бр. (${pct.pct}%)` : ""}
      ${logiOrderAddr(co) ? `<br>🚚 Разтоварване: <b>${escapeHtml(logiOrderAddr(co))}</b>` : ""}
    </p>
    <table class="report-table erp-table" style="margin-bottom:8px">
      <thead><tr><th>Код</th><th>Продукт</th><th class="num">Поръчано</th><th class="num">Доставено</th><th class="num">Остава</th></tr></thead>
      <tbody>${(co.lines || []).map(l => {
        const qq = erpToNum(l.qty) || 0, dd = Math.min(Number(l.delivered) || 0, qq);
        return `<tr><td>${escapeHtml(l.code || "")}</td><td>${escapeHtml(l.name || "")}${l.clientCode ? ` <span class="t-code" title="Код при клиента">${escapeHtml(l.clientCode)}</span>` : ""}</td>
          <td class="num">${erpNum(qq)} ${escapeHtml(l.unit || "бр.")}</td><td class="num">${erpNum(dd)}</td><td class="num"><b>${erpNum(qq - dd)}</b></td></tr>`;
      }).join("") || `<tr><td colspan="5" class="report-empty">Няма редове.</td></tr>`}</tbody>
    </table>
    ${pal.length ? `<p style="margin:4px 0 2px"><b>🧱 Палети: ${pal.length}</b>${cg.kg ? ` · общо ~${erpNum(cg.kg)} кг` : ""}</p>
    <table class="report-table erp-table" style="margin-bottom:8px"><thead><tr><th>№</th><th>Съдържание</th><th class="num">Бройка</th><th class="num">Тегло (кг)</th></tr></thead>
      <tbody>${pal.map((p, i) => `<tr><td>${escapeHtml(String(p.no || i + 1))}</td><td>${escapeHtml(p.desc || "")}</td><td class="num">${erpNum(p.qty)}</td><td class="num">${erpNum(p.weightKg)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${trRows.length ? `<p style="margin:4px 0 2px"><b>🚚 Транспортни данни (за ЧМР)</b></p>
    <p class="hint" style="margin:0 0 8px">${trRows.map(x => `${escapeHtml(x[0])}: <b>${escapeHtml(String(x[1]))}</b>`).join(" · ")}</p>` : ""}
    ${files.length ? `<p style="margin:4px 0 2px"><b>📎 Файлове на заявката</b></p>
    <p style="margin:0 0 8px">${files.map(f => `<a href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener" style="margin-right:12px">📄 ${escapeHtml(f.name || "файл")}</a>`).join("")}</p>` : ""}
    <div class="erp-dialog-actions" style="justify-content:flex-start;flex-wrap:wrap">
      ${typeof erpPackPrintFor === "function" ? `
      <button class="btn btn-small" id="lgo-doc-goods" title="Стокова разписка от Опаковки — за печат">🧾 Стокова разписка</button>
      <button class="btn btn-small" id="lgo-doc-packing" title="Packing List от Опаковки — за печат">📦 Packing List</button>
      <button class="btn btn-small" id="lgo-doc-pallets" title="Палет опис от Опаковки — за печат">🧱 Палет опис</button>` : ""}
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small btn-primary" id="lgo-v-inq" title="Запитване за транспорт по тази поръчка — влиза в регистъра">📨 Запитване</button>
      <button class="btn" id="lgo-v-close">Затвори</button>
    </div>`);
  try { wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide"); } catch (e) {}
  wrap.querySelector("#lgo-v-close").addEventListener("click", close);
  ["goods", "packing", "pallets"].forEach(kind => {
    const b = wrap.querySelector("#lgo-doc-" + kind);
    if (b) b.addEventListener("click", () => { try { erpPackPrintFor(co, kind); } catch (e) { alert("Документът не се отвори: " + (e.message || e)); } });
  });
  wrap.querySelector("#lgo-v-inq").addEventListener("click", () => { close(); logiOrderInquiry(co); });
}

/* 📨 Запитване от поръчка (ползва се от 📦 Поръчки и от 👁 диалога). */
function logiOrderInquiry(co) {
  const doc = (typeof erpCODocAdapter === "function") ? erpCODocAdapter(co)
    : { client: { name: co.clientName || "" }, transport: co.transport || {}, pallets: co.pallets || [] };
  if (!doc.transport.unloadPlace && !doc.transport.destination) {
    doc.transport = { ...doc.transport, unloadPlace: logiOrderAddr(co) };
  }
  logiInquiryForDoc(doc, { orderId: co.id, ourNo: co.ourNo || "", client: co.clientName || "" });
}

/* ---- 📊 Анализ транспорт (Данко, 24.10.2026) ----
   Транспортните фактури от ПОКУПКИ (вид разход „Транспорт износ/вътрешен"
   или доставчик от категория „Транспорт / логистика"): коя дестинация,
   колко палета, на каква цена, от коя фирма. Дестинацията и палетите се
   допълват на място (авто-предложение от текста на редовете) и се пазят в
   LOGI.tcost.byPurchase[purchaseId] = { dest, pallets }. Целта: нова оферта
   за дадена дестинация се сравнява на секундата с плащаното досега. */

const LOGI_BGN = 1.95583;
function logiTransList() {
  const carriers = new Set(logiCarriers().map(c => logiNorm(c.company)));
  return ((typeof erpPurchases !== "undefined" && erpPurchases) || []).filter(p => {
    if (/^транспорт/i.test(p.expenseType || "")) return true;
    return p.supplierName && carriers.has(logiNorm(p.supplierName));
  });
}
/* Сумата на покупката БЕЗ ДДС, в EUR (кредитните влизат с минус). */
function logiTransBase(p) {
  try {
    if (typeof erpPuTotals === "function") {
      const t = erpPuTotals(p);
      return (p.currency === "BGN") ? t.base / LOGI_BGN : t.base;
    }
  } catch (e) {}
  return 0;
}
/* Авто-предложение от текста на редовете: брой палети + откъс за подсказка. */
function logiTransExtract(p) {
  const txt = ((p.lines || []).map(l => [l.article, l.name].filter(Boolean).join(" ")).join(" · ") + " " + (p.note || "")).trim();
  const m = txt.match(/(\d{1,3})\s*(?:бр\.?\s*)?(?:евро\s*)?(?:пале|pallet|pal\b)/i);
  return { pal: m ? Number(m[1]) : 0, txt: txt.slice(0, 180) };
}
function logiTcostOf(p) { return ((LOGI || {}).tcost || {})[String(p.id)] || {}; }

const LOGI_STATUSES = ["заявен", "натоварен", "разтоварен"];

async function erpRenderLogistics() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане на логистиката…</p>`;
  try { if (typeof erpLoadInvoices === "function" && (typeof erpInvoices === "undefined" || !erpInvoices)) await erpLoadInvoices(); } catch (e) {}
  try { if (typeof erpInvLoadSeries === "function") await erpInvLoadSeries(); } catch (e) {}
  try { if ((typeof CONTACTS === "undefined" || !CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad(); } catch (e) {}
  // Заявките + паспортите на клиентите: за 📦 Поръчки и кликаемите номера.
  // Презареждат се, щом са по-стари от минута — нова заявка да излиза веднага.
  try {
    const stale = !window.LOGI_CO_AT || (Date.now() - window.LOGI_CO_AT > 60000);
    if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList || stale)) {
      await erpLoadCustomerOrders();
      window.LOGI_CO_AT = Date.now();
    }
  } catch (e) {}
  try { if (typeof cliLoad === "function") await cliLoad(); } catch (e) {}
  await logiLoad(true);   // табът винаги показва (и после пише върху) актуалното

  const q = logiNorm(logiQ);
  const money = "";

  let body = "";
  if (logiView === "inq") {
    let inqs = (LOGI.inq || []).slice().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (q) inqs = inqs.filter(x => logiNorm([x.label, x.subject, (x.to || []).join(" "), logiCargoOf(x), x.price, x.text].join(" ")).includes(q));
    body = `<table class="report-table erp-table">
      <thead><tr><th>Кога</th><th>До кого</th><th>Относно</th><th>Поръчка / Ф-ра</th><th>Товар</th><th>Върната цена</th><th>Откъс</th><th></th></tr></thead>
      <tbody>${inqs.map(x => `<tr>
        <td style="white-space:nowrap">${escapeHtml(new Date(x.at).toLocaleString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))}</td>
        <td>${(x.to || []).map(t => `<span class="t-code">${escapeHtml(t)}</span>`).join("<br>")}</td>
        <td>${escapeHtml(x.label || x.subject || "")}</td>
        <td style="white-space:nowrap">${x.ourNo ? `<a class="lgo-open" data-oid="${escapeAttr(String(x.orderId || ""))}" data-ono="${escapeAttr(x.ourNo)}" style="cursor:pointer;text-decoration:underline" title="Какво се товари: редове, палети, транспорт, файлове и документи"><b>№ ${escapeHtml(x.ourNo)}</b></a>` : ""}${x.invNo ? `${x.ourNo ? "<br>" : ""}<span class="erp-muted" title="Фактура">ф-ра ${escapeHtml(x.invNo)}</span>` : ""}${!x.ourNo && !x.invNo ? `<span class="erp-muted">—</span>` : ""}</td>
        <td style="white-space:nowrap">${escapeHtml(logiCargoOf(x)) || `<span class="erp-muted">—</span>`}</td>
        <td><input type="text" class="lgq-price" data-id="${x.id}" value="${escapeAttr(x.price || "")}" placeholder="напр. 450 €" title="Цената, която фирмата върна в отговор — записва се веднага, за сравнение между превозвачите" style="width:110px" /></td>
        <td class="erp-muted" style="max-width:300px;font-size:12px">${escapeHtml(String(x.text || "").split("\n").filter(l => l.trim().startsWith("•")).join(" · ") || String(x.text || "").slice(0, 90))}</td>
        <td class="erp-row-actions">
          <button class="btn btn-small lgq-view" data-id="${x.id}" title="Пълният текст на запитването">👁</button>
          <button class="btn btn-small btn-primary lgq-resend" data-id="${x.id}" title="Същото запитване до ДРУГА фирма — избираш получател, текстът е готов">↪ До друга фирма</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Още няма изпратени запитвания. Пращат се от камиончето 🚛 в „Заявки от клиенти", от фактурата или от дестинация — и се записват тук сами.</td></tr>`}</tbody>
    </table>
    <p class="hint">Всяко изпратено запитване се помни: кога, до кого, по коя заявка и за какъв товар. Като получиш оферта — напиши я в „Върната цена" (записва се веднага и се вижда при жълтото камионче 🚛 на заявката). Клик на № отваря какво се товари.</p>`;
  } else if (logiView === "tinv") {
    // 🧾 Фактури транспорт (по Данко, 26.10): всяка покупка с вид „Транспорт
    // износ/вътрешен" идва тук САМА (както Металите в папка Метали) —
    // разделени, със суми, за следене на разходите. Отдолу: фактурите от
    // превозвачи БЕЗ посочен вид — разнасят се с два бутона.
    const f2 = n => (Math.round(n * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let all = logiTransList().slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (q) all = all.filter(p => logiNorm([p.supplierName, p.invoiceNo, p.expenseType, logiTcostOf(p).dest, logiTransExtract(p).txt].join(" ")).includes(q));
    const exp = all.filter(p => /износ/i.test(p.expenseType || ""));
    const dom = all.filter(p => /вътрешен/i.test(p.expenseType || ""));
    const untyped = all.filter(p => !/^транспорт/i.test(p.expenseType || ""));
    const year = String(new Date().getFullYear());
    const sect = (icon, title, rows) => {
      const tot = rows.reduce((s2, p) => s2 + logiTransBase(p), 0);
      const totY = rows.filter(p => String(p.date || "").indexOf(year) === 0).reduce((s2, p) => s2 + logiTransBase(p), 0);
      return `
      <h4 class="erp-group-head">${icon} ${title} — ${rows.length} фактури · <b>${f2(tot)} EUR</b> без ДДС${Math.abs(totY - tot) > 0.005 ? ` · за ${year} г.: ${f2(totY)} EUR` : ""}</h4>
      <table class="report-table erp-table" style="margin-bottom:14px">
        <thead><tr><th>Дата</th><th>№ Фактура</th><th>Транспортна фирма</th><th>Дестинация</th><th class="num">Сума без ДДС (EUR)</th><th>Редовете на фактурата</th></tr></thead>
        <tbody>${rows.map(p => { const tc = logiTcostOf(p); const ex = logiTransExtract(p); return `<tr class="erp-clickable" data-puopen="${escapeAttr(String(p.id))}" title="Отваря фактурата с всичко, въведено в Покупки — редове, суми, плащане">
          <td style="white-space:nowrap">${erpDMY(p.date) || "—"}</td>
          <td><b>${escapeHtml(p.invoiceNo || "—")}</b></td>
          <td>${escapeHtml(p.supplierName || "—")}</td>
          <td>${escapeHtml(tc.dest || "")}</td>
          <td class="num">${f2(logiTransBase(p))}</td>
          <td class="erp-muted" style="max-width:340px;font-size:11.5px">${escapeHtml(ex.txt || "")}</td>
        </tr>`; }).join("") || `<tr><td colspan="6" class="report-empty">Още няма фактури тук.</td></tr>`}</tbody>
      </table>`;
    };
    body = `
    <p class="hint" style="margin-top:0">Всяка покупка с вид разход <b>Транспорт износ</b> или <b>Транспорт вътрешен</b> идва тук сама — включително преместените от „Заявки за материали → Без група". <b>Клик на ред</b> отваря фактурата с всичко, въведено в Покупки.</p>
    ${sect("🚛", "Транспорт износ", exp)}
    ${sect("🚐", "Транспорт вътрешен", dom)}
    ${untyped.length ? `<h4 class="erp-group-head">🏷 От превозвачи, БЕЗ посочен вид (${untyped.length})</h4>
    <p class="hint" style="margin:4px 0">Фактури от фирми с категория „Транспорт / логистика", но без вид разход — разнеси ги с бутоните (видът се записва в Покупки, общо за всички):</p>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№</th><th>Фирма</th><th class="num">Сума (EUR)</th><th>Редове</th><th></th></tr></thead>
      <tbody>${untyped.map(p => { const ex = logiTransExtract(p); return `<tr class="erp-clickable" data-puopen="${escapeAttr(String(p.id))}" title="Отваря фактурата с всичко, въведено в Покупки">
        <td style="white-space:nowrap">${erpDMY(p.date) || "—"}</td><td><b>${escapeHtml(p.invoiceNo || "—")}</b></td>
        <td>${escapeHtml(p.supplierName || "—")}</td><td class="num">${f2(logiTransBase(p))}</td>
        <td class="erp-muted" style="max-width:300px;font-size:11.5px">${escapeHtml(ex.txt || "")}</td>
        <td class="erp-row-actions"><button class="btn btn-small lgi-settype" data-pid="${escapeAttr(String(p.id))}" data-t="Транспорт износ">🚛 износ</button>
          <button class="btn btn-small lgi-settype" data-pid="${escapeAttr(String(p.id))}" data-t="Транспорт вътрешен">🚐 вътрешен</button></td>
      </tr>`; }).join("")}</tbody>
    </table>` : ""}`;
  } else if (logiView === "dest") {
    let dests = logiDestinations();
    if (q) dests = dests.filter(d => logiNorm([d.client, d.consignee, d.addr, d.country].join(" ")).includes(q));
    body = `<table class="report-table erp-table">
      <thead><tr><th>Клиент (Buyer)</th><th>Получател (Consignee)</th><th>Адрес на разтоварване</th><th>Държава</th><th class="num">Фактури</th><th>Последно</th><th></th></tr></thead>
      <tbody>${dests.map((d, i) => `<tr>
        <td><b>${escapeHtml(d.client || "—")}</b></td>
        <td>${escapeHtml(d.consignee || "—")}</td>
        <td>${escapeHtml(d.addr || "—")}</td>
        <td>${escapeHtml(d.country || "")}</td>
        <td class="num">${d.n}</td>
        <td>${erpDMY(d.last) || ""}${d.lastNo ? `<div class="erp-muted" style="font-size:11px">ф-ра ${escapeHtml(d.lastNo)}</div>` : ""}</td>
        <td class="erp-row-actions"><button class="btn btn-small" data-inq="${i}" title="Запитване за транспорт до този адрес — избираш транспортните фирми и писмото е готово">📨 Запитване</button></td>
      </tr>`).join("") || `<tr><td colspan="7" class="report-empty">Няма дестинации — те идват от издадените износни фактури (Consignee).</td></tr>`}</tbody>
    </table>
    <p class="hint">Дестинациите се събират сами от издадените фактури: получателят (Consignee) е мястото, където пращаме камиона. „📨 Запитване" предпопълва маршрута.</p>`;
    v.__dests = dests;
  }

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small ${logiView === "inq" ? "btn-primary" : ""}" id="lgi-v-inq" title="Всички изпратени запитвания за транспорт: кога, до кого, по коя заявка, върната цена">📨 Запитвания (${(LOGI.inq || []).length})</button>
      <button class="btn btn-small ${logiView === "dest" ? "btn-primary" : ""}" id="lgi-v-dest">🗺 Дестинации</button>
      <button class="btn btn-small ${logiView === "tinv" ? "btn-primary" : ""}" id="lgi-v-tinv" title="Всички транспортни фактури от Покупки — Транспорт износ и Транспорт вътрешен поотделно, със суми; клик на ред отваря фактурата с всичко от Покупки">🧾 Фактури транспорт</button>
      <input type="search" id="lgi-q" placeholder="🔎 поръчка / клиент / адрес / № фактура / превозвач… (Enter)" value="${escapeAttr(logiQ)}" style="min-width:250px" autocomplete="off" />
      <span class="spacer"></span>
      <button class="btn btn-small" id="lgi-inq" title="Свободно запитване за транспорт до избрани транспортни фирми">📨 Запитване за транспорт</button>
    </div>
    ${body}`;

  v.querySelector("#lgi-v-tinv").addEventListener("click", async () => {
    logiView = "tinv";
    try { if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases(); } catch (e) {}
    erpRenderLogistics();
  });
  // 🏷 „Разнеси" от Фактури транспорт: видът се записва в purchases (свеж
  // прочит преди записа) — промяната е обща; доставчикът се запомня с вида.
  v.querySelectorAll(".lgi-settype").forEach(b => b.addEventListener("click", async () => {
    const p0 = ((typeof erpPurchases !== "undefined" && erpPurchases) || []).find(x => String(x.id) === String(b.dataset.pid));
    const t = b.dataset.t;
    if (!p0 || !t) return;
    if (!confirm(`Фактура № ${p0.invoiceNo || "—"} на ${p0.supplierName || "—"} → вид „${t}"?\nПромяната е обща — вижда се и в Покупки, и в анализите.`)) return;
    b.disabled = true;
    try {
      const { data, error } = await sb.from("purchases").select("data").eq("id", p0.id).maybeSingle();
      if (error || !data) throw new Error((error && error.message) || "фактурата не се прочете");
      const d = data.data || {};
      d.expenseType = t;
      const { error: e2 } = await sb.from("purchases").update({ data: d, updated_at: new Date().toISOString() }).eq("id", p0.id);
      if (e2) throw e2;
      p0.expenseType = t;
      try { if (typeof matreqRememberGroup === "function") matreqRememberGroup(p0.supplierName, t); } catch (e) {}
      erpRenderLogistics();
    } catch (e) { alert("Не се записа: " + (e.message || e)); b.disabled = false; }
  }));
  v.querySelector("#lgi-v-dest").addEventListener("click", () => { logiView = "dest"; erpRenderLogistics(); });
  v.querySelector("#lgi-v-inq").addEventListener("click", () => { logiView = "inq"; erpRenderLogistics(); });
  // 🧾 Клик на ред във Фактури транспорт → фактурата с ВСИЧКО от Покупки
  // (отваря се в раздел Покупки — Логистиката си остава отворена като раздел).
  v.querySelectorAll("[data-puopen]").forEach(tr => tr.addEventListener("click", ev => {
    if (ev.target.closest("button,input,a,select")) return;   // Разнеси-бутоните са си бутони
    if (typeof erpOpenPurchase !== "function") return;
    if (typeof erpSetTab === "function" && typeof ERP !== "undefined" && ERP.tab !== "purchases") erpSetTab("purchases");
    erpOpenPurchase(tr.dataset.puopen);
  }));
  // Поръчката по id/наш № — за 👁 диалога от Запитванията.
  const findCO = (oid, ono) => {
    const list = (typeof erpCOList !== "undefined" && erpCOList) || [];
    return (oid && list.find(x => String(x.id) === String(oid)))
      || (ono && list.find(x => logiNorm(x.ourNo) === logiNorm(ono))) || null;
  };
  v.querySelectorAll(".lgo-open, .lgo-view").forEach(el => el.addEventListener("click", () => logiOrderViewDialog(findCO(el.dataset.oid, el.dataset.ono))));
  const findInq = id => (LOGI.inq || []).find(x => Number(x.id) === Number(id));
  v.querySelectorAll(".lgq-view").forEach(b => b.addEventListener("click", () => {
    const x = findInq(b.dataset.id); if (!x) return;
    const { wrap, close } = erpDialog(`<h3>📨 ${escapeHtml(x.subject || "Запитване")}</h3>
      <p class="hint" style="margin:0 0 6px">До: ${(x.to || []).map(escapeHtml).join(", ")} · ${escapeHtml(new Date(x.at).toLocaleString("bg-BG"))}${logiCargoOf(x) ? ` · Товар: <b>${escapeHtml(logiCargoOf(x))}</b>` : ""}${x.price ? ` · Върната цена: <b>${escapeHtml(x.price)}</b>` : ""}</p>
      <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;font:13px/1.5 system-ui">${escapeHtml(x.text || "")}</pre>
      <div class="erp-dialog-actions"><button class="btn" id="lgq-close">Затвори</button></div>`);
    wrap.querySelector("#lgq-close").addEventListener("click", close);
  }));
  v.querySelectorAll(".lgq-resend").forEach(b => b.addEventListener("click", () => {
    const x = findInq(b.dataset.id); if (!x) return;
    // Повторното запитване пази връзката с поръчката/фактурата на оригинала.
    logiInquiry({ text: x.text, subject: x.subject, label: (x.label || "") + " (повторно)",
      orderId: x.orderId || null, ourNo: x.ourNo || "", invNo: x.invNo || "", client: x.client || "", to: x.dest || "" });
  }));
  v.querySelectorAll(".lgq-price").forEach(i => i.addEventListener("change", async () => {
    const x = findInq(i.dataset.id); if (!x) return;
    x.price = i.value.trim(); await logiSave();
  }));
  uiSearchEnter(v.querySelector("#lgi-q"), val => { logiQ = val; erpRenderLogistics(); });
  v.querySelector("#lgi-inq").addEventListener("click", () => logiInquiry());
  v.querySelectorAll("[data-inq]").forEach(b => b.addEventListener("click", () => {
    const d = (v.__dests || [])[Number(b.dataset.inq)];
    if (!d) return;
    logiInquiry({ to: [d.consignee, d.addr].filter(Boolean).join(" — "), label: d.client, from: "Пловдив, България" });
  }));

}

/* Ръчен товар / редакция. l може да е и ПРЕДПОПЪЛНЕН нов (id:0, напр. от
   запитване — тогава носи orderId/ourNo). onSaved(l) се вика след записа. */
function logiEditDialog(l, onSaved) {
  const isNew = !l || !Number(l.id);
  l = l || { id: 0, invNo: "", date: new Date().toISOString().slice(0, 10), client: "", dest: "", carrier: "", vehicle: "", status: "заявен", note: "" };
  const carriers = [...new Set(logiCarriers().map(c => (c.company || "").trim()).filter(Boolean))];
  const { wrap, close } = erpDialog(`
    <h3>${isNew ? "➕ Нов товар" : "✎ Товар — " + (l.invNo ? "фактура № " + escapeHtml(l.invNo) : (l.ourNo ? "поръчка № " + escapeHtml(l.ourNo) : "—"))}</h3>
    ${l.orderId && !l.invNo ? `<p class="hint" style="margin:0 0 6px">Товарът е по поръчка № ${escapeHtml(l.ourNo || "—")} — № на фактурата ще се попълни САМ, щом я издадеш. Остави полето празно.</p>` : ""}
    <div class="erp-co-grid">
      <label>№ Фактура <input type="text" id="lg-inv" value="${escapeAttr(l.invNo)}" ${l.orderId && !l.invNo ? 'placeholder="ще дойде сам от фактурата"' : ""} /></label>
      <label>Поръчка № (Заявки) <input type="text" id="lg-ourno" value="${escapeAttr(l.ourNo || "")}" placeholder="наш № на заявката" /></label>
      <label>Дата на товарене <input type="date" id="lg-date" value="${escapeAttr(l.date || "")}" /></label>
      <label>Клиент <input type="text" id="lg-client" value="${escapeAttr(l.client)}" /></label>
      <label>Дестинация <input type="text" id="lg-dest" value="${escapeAttr(l.dest)}" placeholder="град, държава" /></label>
      <label>Превозвач <input type="text" id="lg-carrier" list="lg-carriers" value="${escapeAttr(l.carrier)}" /><datalist id="lg-carriers">${carriers.map(c => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist></label>
      <label>Камион № <input type="text" id="lg-vehicle" value="${escapeAttr(l.vehicle)}" /></label>
      <label>Статус <select id="lg-status">${LOGI_STATUSES.map(s => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Бележка / ЧМР № <input type="text" id="lg-note" value="${escapeAttr(l.note)}" /></label>
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="lg-cancel">Отказ</button><button class="btn btn-primary" id="lg-save">💾 Запази</button></div>`);
  wrap.querySelector("#lg-cancel").addEventListener("click", close);
  wrap.querySelector("#lg-save").addEventListener("click", async () => {
    const gv = id => (wrap.querySelector("#" + id) || {}).value.trim();
    l.invNo = gv("lg-inv"); l.ourNo = gv("lg-ourno"); l.date = gv("lg-date"); l.client = gv("lg-client"); l.dest = gv("lg-dest");
    l.carrier = gv("lg-carrier"); l.vehicle = gv("lg-vehicle"); l.status = gv("lg-status"); l.note = gv("lg-note");
    // Ръчно въведен наш № → намира поръчката, за да работи авто-връзката с фактурата.
    if (!l.orderId && l.ourNo) {
      try {
        if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders();
        const co = ((typeof erpCOList !== "undefined" && erpCOList) || []).find(x => logiNorm(x.ourNo) === logiNorm(l.ourNo));
        if (co) l.orderId = co.id;
      } catch (e) {}
    }
    if (isNew) { l.id = logiNextId(); l.at = new Date().toISOString(); LOGI.loads.push(l); }
    if (await logiSave()) { if (onSaved) { try { await onSaved(l); } catch (e) {} } close(); erpRenderLogistics(); }
  });
}
