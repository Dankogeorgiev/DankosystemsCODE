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
let logiView = "orders";     // orders | dest | loads | inq (📦 Поръчки е работният екран)
let logiQ = "";

async function logiLoad(force) {
  if (LOGI && LOGI.__db && !force) return LOGI;
  try {
    const { data, error } = await sb.from("app_config").select("data").eq("id", "logistics_loads").maybeSingle();
    if (error) throw error;
    LOGI = { loads: (data && data.data && data.data.loads) || [], inq: (data && data.data && data.data.inq) || [], __db: true };
  } catch (e) {
    // Неуспешен прочит НЕ се кешира като „празен регистър": запис върху такъв
    // обект би изтрил всички товари и запитвания. __db=false → logiSave отказва.
    if (!LOGI) LOGI = { loads: [], inq: [], __db: false };
  }
  return LOGI;
}
async function logiSave() {
  if (!LOGI || !LOGI.__db) { alert("Логистиката не се зареди от базата (прекъсната връзка?). Нищо не е записано — презареди страницата и опитай пак."); return false; }
  const { error } = await sb.from("app_config").upsert({ id: "logistics_loads", data: { loads: LOGI.loads || [], inq: LOGI.inq || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function logiNextId() { let m = 0; ((LOGI || {}).loads || []).forEach(l => { if ((Number(l.id) || 0) > m) m = Number(l.id); }); return m + 1; }
function logiNorm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

/* Транспортните фирми от указателя (категория „Транспорт / логистика"). */
function logiCarriers() {
  return ((typeof CONTACTS !== "undefined" && CONTACTS) || [])
    .filter(c => /транспорт/i.test(c.category || "") && (c.email || "").includes("@"));
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
    ${carriers.length ? `<p class="hint" style="margin:0 0 6px">Избери до кого (транспортните фирми от указателя, категория „Транспорт / логистика"):</p>
    <div style="max-height:60vh;overflow:auto;margin-bottom:8px">${carriers.map((c, i) => `
      <label style="display:block;padding:3px 0"><input type="checkbox" class="lgi-c" data-i="${i}" /> <b>${escapeHtml(c.company || "—")}</b> · ${escapeHtml(c.contact_person || "")} <span class="t-code">${escapeHtml(c.email)}</span></label>`).join("")}</div>`
      : `<p class="hint">В указателя няма контакти с категория „Транспорт / логистика" и имейл — добави ги в Клиенти/Доставчици (📇 Стар указател), за да излизат тук. Можеш и да напишеш имейла на ръка в следващата стъпка.</p>`}
    <div class="erp-dialog-actions"><button class="btn" id="lgi-cancel">Отказ</button><button class="btn btn-primary" id="lgi-go">Продължи към писмото →</button></div>`);
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
  const tr = (c && c.transport) || {};
  if (tr.unloadPlace || tr.destination) return tr.unloadPlace || tr.destination;
  try {
    const prof = (typeof CLI_PROFILES !== "undefined" && CLI_PROFILES && CLI_PROFILES.byKey && typeof cliKey === "function")
      ? CLI_PROFILES.byKey[cliKey(c.clientName)] : null;
    const lines = String((prof && prof.addr) || "").split("\n").map(s => s.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : "";
  } catch (e) { return ""; }
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

const LOGI_STATUSES = ["заявен", "натоварен", "разтоварен"];

async function erpRenderLogistics() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане на логистиката…</p>`;
  try { if (typeof erpLoadInvoices === "function" && (typeof erpInvoices === "undefined" || !erpInvoices)) await erpLoadInvoices(); } catch (e) {}
  try { if (typeof erpInvLoadSeries === "function") await erpInvLoadSeries(); } catch (e) {}
  try { if ((typeof CONTACTS === "undefined" || !CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad(); } catch (e) {}
  // Заявките + паспортите на клиентите: за 📦 Поръчки и кликаемите номера.
  try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}
  try { if (typeof cliLoad === "function") await cliLoad(); } catch (e) {}
  await logiLoad(true);   // табът винаги показва (и после пише върху) актуалното

  const q = logiNorm(logiQ);
  const money = "";

  let body = "";
  if (logiView === "inq") {
    let inqs = (LOGI.inq || []).slice().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (q) inqs = inqs.filter(x => logiNorm([x.label, x.subject, (x.to || []).join(" "), logiCargoOf(x), x.price, x.text].join(" ")).includes(q));
    const loadOfInq = x => (LOGI.loads || []).find(l => Number(l.id) === Number(x.loadId));
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
          ${x.orderId ? (loadOfInq(x)
            ? `<span class="erp-count" title="От това запитване вече е направен товар">🚛 ${escapeHtml((loadOfInq(x).carrier || "товар"))}</span>`
            : `<button class="btn btn-small lgq-load" data-id="${x.id}" title="Избрал си тази фирма → създава ТОВАР по поръчката. № на фактурата ще се попълни САМ, щом я издадеш.">🚛 → Товар</button>`) : ""}
        </td>
      </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Още няма изпратени запитвания. Пращат се от „📨 Запитване за транспорт" — от поръчката (Заявки), от фактурата или от дестинация — и се записват тук сами.</td></tr>`}</tbody>
    </table>
    <p class="hint">Всяко изпратено запитване се помни: кога, до кого, по коя поръчка и за какъв товар. Като получиш оферта — напиши я в „Върната цена" (записва се веднага). Избереш ли фирма — „🚛 → Товар" прави товара по поръчката, а № на фактурата се връзва сам при издаването ѝ.</p>`;
  } else if (logiView === "orders") {
    let cos = ((typeof erpCOList !== "undefined" && erpCOList) || []).filter(c => (c.status || "нова") !== "завършена");
    if (q) cos = cos.filter(c => logiNorm([c.ourNo, c.clientNo, c.clientName, c.status, logiOrderAddr(c)].join(" ")).includes(q));
    cos.sort((a, b) => String(a.deadline || "9999-99-99").localeCompare(String(b.deadline || "9999-99-99")));
    const today = new Date().toISOString().slice(0, 10);
    const trCell = c => {
      const oid = String(c.id);
      const inqs = (LOGI.inq || []).filter(x => String(x.orderId || "") === oid);
      const lds = (LOGI.loads || []).filter(l => String(l.orderId || "") === oid);
      const parts = [];
      if (inqs.length) {
        const priced = inqs.filter(x => x.price);
        parts.push(`<span title="Изпратени запитвания по поръчката${priced.length ? " · върнати цени: " + priced.map(x => escapeAttr(x.price)).join("; ") : ""}">📨 ${inqs.length}${priced.length ? " · " + priced.map(x => escapeHtml(x.price)).join("; ") : ""}</span>`);
      }
      lds.forEach(l => parts.push(`<span title="Товар по поръчката">🚛 ${escapeHtml(l.carrier || "товар")} — ${l.invNo ? "ф-ра " + escapeHtml(l.invNo) + ", " + escapeHtml(l.status || "") : "⏳ очаква ф-ра"}</span>`));
      return parts.join("<br>") || `<span class="erp-muted">—</span>`;
    };
    body = `<table class="report-table erp-table">
      <thead><tr><th>Поръчка</th><th>Клиент</th><th>Срок</th><th>Производство</th><th>Палети · Тегло</th><th>Разтоварване</th><th>Транспорт</th><th></th></tr></thead>
      <tbody>${cos.map(c => {
        const pct = (typeof erpCOPct === "function") ? erpCOPct(c) : { tot: 0, del: 0, pct: 0 };
        const cg = logiOrderCargo(c);
        const late = c.deadline && c.deadline < today && (c.status || "") !== "готова за продажба";
        return `<tr>
          <td><a class="lgo-open" data-oid="${escapeAttr(String(c.id))}" style="cursor:pointer;text-decoration:underline" title="Какво се товари: редове, палети, транспорт, файлове и документи — без да влизаш в Склад/ЕРП"><b>№ ${escapeHtml(c.ourNo || "—")}</b></a>${c.clientNo ? `<div class="erp-muted" style="font-size:11px" title="Клиентски №">кл. № ${escapeHtml(c.clientNo)}</div>` : ""}</td>
          <td>${escapeHtml(c.clientName || "")}</td>
          <td style="white-space:nowrap">${c.deadline ? `<b style="${late ? "color:#dc2626" : ""}">${erpDMY(c.deadline)}</b>${late ? ' <span title="Срокът е минал">⚠</span>' : ""}` : `<span class="erp-muted">—</span>`}</td>
          <td><span class="erp-co-status s-${escapeAttr(c.status || "нова")}">${escapeHtml(c.status || "нова")}</span>${pct.tot ? `<div class="erp-muted" style="font-size:11px">доставени ${erpNum(pct.del)} от ${erpNum(pct.tot)} бр. (${pct.pct}%)</div>` : ""}</td>
          <td style="white-space:nowrap">${cg.cnt ? `🧱 ${cg.cnt} пал.` : `<span class="erp-muted" title="Палетите се попълват от Опаковки / ✎ Палети на заявката">—</span>`}${cg.kg ? `<div class="erp-muted" style="font-size:11px">~${erpNum(cg.kg)} кг</div>` : ""}</td>
          <td style="max-width:260px">${escapeHtml(logiOrderAddr(c)) || `<span class="erp-muted">—</span>`}</td>
          <td style="font-size:12px">${trCell(c)}</td>
          <td class="erp-row-actions">
            <button class="btn btn-small lgo-view" data-oid="${escapeAttr(String(c.id))}" title="Какво се товари — редове, палети, файлове, документи">👁</button>
            <button class="btn btn-small lgo-inq" data-oid="${escapeAttr(String(c.id))}" title="Запитване за транспорт по тази поръчка — адрес/палети/тегло са готови">📨</button>
            <button class="btn btn-small btn-primary lgo-load" data-oid="${escapeAttr(String(c.id))}" title="Нов товар по тази поръчка — № на фактурата ще дойде сам при издаването">🚛</button>
          </td>
        </tr>`;
      }).join("") || `<tr><td colspan="8" class="report-empty">Няма активни поръчки (завършените се крият). Поръчките идват от Заявки — тук е всичко нужно за експедицията им.</td></tr>`}</tbody>
    </table>
    <p class="hint">Всичко за експедицията на една поръчка е тук — без влизане в Склад/ЕРП: 👁 показва какво се товари (редове, палети, файлове, Стокова/Packing List/Палет опис), 📨 праща запитване с готов адрес и тегло, 🚛 отваря нов товар. Срок в червено = минал срок.</p>`;
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
  } else {
    let loads = (LOGI.loads || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (q) loads = loads.filter(l => logiNorm([l.invNo, l.ourNo, l.client, l.dest, l.carrier, l.vehicle, l.note].join(" ")).includes(q));
    const stBadge = s => s === "разтоварен" ? `<span class="erp-co-status" style="background:#dcfce7;color:#166534">✓ разтоварен</span>`
      : s === "натоварен" ? `<span class="erp-co-status" style="background:#fef9c3;color:#854d0e">🚚 натоварен</span>`
      : `<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">⏳ заявен</span>`;
    body = `<table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№ Фактура</th><th>Поръчка</th><th>Клиент</th><th>Дестинация</th><th>Превозвач</th><th>Камион</th><th>Статус</th><th>Бележка / ЧМР</th><th></th></tr></thead>
      <tbody>${loads.map(l => `<tr data-lid="${l.id}">
        <td>${erpDMY(l.date) || "—"}</td>
        <td>${l.invNo ? `<b>${escapeHtml(l.invNo)}</b>` : (l.orderId || l.ourNo ? `<span class="erp-muted" title="Товарът е по поръчка — номерът на фактурата ще се попълни САМ при издаването ѝ">⏳ очаква ф-ра</span>` : "—")}</td>
        <td>${l.ourNo || l.orderId ? `<a class="lgo-open" data-oid="${escapeAttr(String(l.orderId || ""))}" data-ono="${escapeAttr(l.ourNo || "")}" style="cursor:pointer;text-decoration:underline" title="Какво се товари: редове, палети, транспорт, файлове и документи"><b>№ ${escapeHtml(l.ourNo || "?")}</b></a>` : `<span class="erp-muted">—</span>`}</td>
        <td>${escapeHtml(l.client || "")}</td>
        <td>${escapeHtml(l.dest || "")}</td>
        <td>${escapeHtml(l.carrier || "") || `<span class="erp-muted">—</span>`}</td>
        <td>${escapeHtml(l.vehicle || "")}</td>
        <td><select class="lgi-st" data-lid="${l.id}" title="Статус на товара">${LOGI_STATUSES.map(s => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select> ${stBadge(l.status)}</td>
        <td><input type="text" class="lgi-note" data-lid="${l.id}" value="${escapeAttr(l.note || "")}" placeholder="ЧМР №, файл, уговорка…" style="width:160px" /></td>
        <td class="erp-row-actions"><button class="btn btn-small lgi-edit" data-lid="${l.id}" title="Редакция на товара">✎</button><button class="btn btn-small btn-danger lgi-del" data-lid="${l.id}" title="Изтрий реда">×</button></td>
      </tr>`).join("") || `<tr><td colspan="10" class="report-empty">Няма записани товари. Товар се прави от запитване („🚛 → Товар") още докато е поръчка, а „🔄 От фактурите" пълни архива от издадените износни фактури.</td></tr>`}</tbody>
    </table>
    <p class="hint">Архивът помни коя поръчка/фактура с кой превозвач е тръгнала: заявен → натоварен → разтоварен. Товар по поръчка стои с „⏳ очаква ф-ра" и номерът се попълва САМ при издаването на фактурата. Статусът и бележката (№ на ЧМР) се записват веднага.</p>`;
  }

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small ${logiView === "orders" ? "btn-primary" : ""}" id="lgi-v-orders" title="Активните поръчки с всичко за експедицията — срок, производство, палети, адрес, документи">📦 Поръчки (${(((typeof erpCOList !== "undefined" && erpCOList) || []).filter(c => (c.status || "нова") !== "завършена")).length})</button>
      <button class="btn btn-small ${logiView === "dest" ? "btn-primary" : ""}" id="lgi-v-dest">🗺 Дестинации</button>
      <button class="btn btn-small ${logiView === "loads" ? "btn-primary" : ""}" id="lgi-v-loads">📜 Товари (${(LOGI.loads || []).length})</button>
      <button class="btn btn-small ${logiView === "inq" ? "btn-primary" : ""}" id="lgi-v-inq">📨 Запитвания (${(LOGI.inq || []).length})</button>
      <input type="search" id="lgi-q" placeholder="🔎 поръчка / клиент / адрес / № фактура / превозвач… (Enter)" value="${escapeAttr(logiQ)}" style="min-width:250px" autocomplete="off" />
      <span class="spacer"></span>
      <button class="btn btn-small" id="lgi-inq" title="Свободно запитване за транспорт до избрани транспортни фирми">📨 Запитване за транспорт</button>
      ${logiView === "loads" ? `<button class="btn btn-small" id="lgi-sync" title="Добавя в архива издадените износни фактури, които още ги няма (превозвачът идва от ✎ Транспорт на фактурата)">🔄 От фактурите</button>
      <button class="btn btn-small btn-primary" id="lgi-add">+ Товар</button>` : ""}
    </div>
    ${body}`;

  v.querySelector("#lgi-v-orders").addEventListener("click", () => { logiView = "orders"; erpRenderLogistics(); });
  v.querySelector("#lgi-v-dest").addEventListener("click", () => { logiView = "dest"; erpRenderLogistics(); });
  v.querySelector("#lgi-v-loads").addEventListener("click", () => { logiView = "loads"; erpRenderLogistics(); });
  v.querySelector("#lgi-v-inq").addEventListener("click", () => { logiView = "inq"; erpRenderLogistics(); });
  // Поръчката по id/наш № — за 👁 диалога отвсякъде (📦, Товари, Запитвания).
  const findCO = (oid, ono) => {
    const list = (typeof erpCOList !== "undefined" && erpCOList) || [];
    return (oid && list.find(x => String(x.id) === String(oid)))
      || (ono && list.find(x => logiNorm(x.ourNo) === logiNorm(ono))) || null;
  };
  v.querySelectorAll(".lgo-open, .lgo-view").forEach(el => el.addEventListener("click", () => logiOrderViewDialog(findCO(el.dataset.oid, el.dataset.ono))));
  v.querySelectorAll(".lgo-inq").forEach(b => b.addEventListener("click", () => { const co = findCO(b.dataset.oid); if (co) logiOrderInquiry(co); }));
  v.querySelectorAll(".lgo-load").forEach(b => b.addEventListener("click", () => {
    const co = findCO(b.dataset.oid); if (!co) return;
    logiEditDialog({
      id: 0, invNo: "", date: new Date().toISOString().slice(0, 10),
      client: co.clientName || "", dest: logiOrderAddr(co),
      carrier: "", vehicle: "", status: "заявен", note: "",
      orderId: co.id, ourNo: co.ourNo || "",
    });
  }));
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
  // „🚛 → Товар": от избраното запитване → товар по поръчката (без №, чака ф-ра).
  v.querySelectorAll(".lgq-load").forEach(b => b.addEventListener("click", () => {
    const x = findInq(b.dataset.id); if (!x) return;
    // Ако запитването е било до ЕДНА фирма — тя е избраният превозвач.
    const one = (x.to || []).length === 1 ? (logiCarriers().find(c => logiNorm(c.email) === logiNorm(x.to[0])) || {}).company || "" : "";
    logiEditDialog({
      id: 0, invNo: x.invNo || "", date: new Date().toISOString().slice(0, 10),
      client: x.client || (x.label || "").split(" — ")[0] || "", dest: x.dest || "",
      carrier: one, vehicle: "", status: "заявен",
      note: x.price ? "оферта: " + x.price : "",
      orderId: x.orderId, ourNo: x.ourNo || "",
    }, async l => { x.loadId = l.id; await logiSave(); });
  }));
  uiSearchEnter(v.querySelector("#lgi-q"), val => { logiQ = val; erpRenderLogistics(); });
  v.querySelector("#lgi-inq").addEventListener("click", () => logiInquiry());
  v.querySelectorAll("[data-inq]").forEach(b => b.addEventListener("click", () => {
    const d = (v.__dests || [])[Number(b.dataset.inq)];
    if (!d) return;
    logiInquiry({ to: [d.consignee, d.addr].filter(Boolean).join(" — "), label: d.client, from: "Пловдив, България" });
  }));

  if (logiView !== "loads") return;
  const findL = id => (LOGI.loads || []).find(x => Number(x.id) === Number(id));
  v.querySelector("#lgi-sync").addEventListener("click", async () => {
    // Продажбите трябват за проследяването фактура → поръчка (fromOrderId).
    // Без тях чакащ товар не се разпознава и би се направил ДУБЛИРАЩ ред.
    try { if (typeof erpLoadSales === "function" && (typeof erpSales === "undefined" || !erpSales)) await erpLoadSales(); } catch (e) {}
    if (typeof erpSales === "undefined" || !Array.isArray(erpSales)) { alert("Продажбите не се заредиха (прекъсната връзка?) — без тях синхронизацията би дублирала товари. Опитай пак."); return; }
    try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}
    const r = logiSyncFromInvoices();
    if (!r.added && !r.linked) { alert("Няма нови фактури за добавяне — всичко издадено (износ/с превозвач) вече е в архива."); return; }
    if (await logiSave()) {
      alert(`✅ ${r.added ? "Добавени " + r.added + " товара от фактурите." : ""}${r.added && r.linked ? "\n" : ""}${r.linked ? "Допълнени " + r.linked + " чакащи товара с № на фактурата им." : ""}`);
      erpRenderLogistics();
    }
  });
  v.querySelector("#lgi-add").addEventListener("click", () => logiEditDialog(null));
  v.querySelectorAll(".lgi-st").forEach(s => s.addEventListener("change", async () => {
    const l = findL(s.dataset.lid); if (!l) return;
    l.status = s.value; await logiSave(); erpRenderLogistics();
  }));
  v.querySelectorAll(".lgi-note").forEach(i => i.addEventListener("change", async () => {
    const l = findL(i.dataset.lid); if (!l) return;
    l.note = i.value.trim(); await logiSave();
  }));
  v.querySelectorAll(".lgi-edit").forEach(b => b.addEventListener("click", () => logiEditDialog(findL(b.dataset.lid))));
  v.querySelectorAll(".lgi-del").forEach(b => b.addEventListener("click", async () => {
    const l = findL(b.dataset.lid); if (!l) return;
    if (!confirm(`Да изтрия ли товара по фактура № ${l.invNo || "—"} (${l.carrier || "без превозвач"})?`)) return;
    LOGI.loads = (LOGI.loads || []).filter(x => Number(x.id) !== Number(l.id));
    if (await logiSave()) erpRenderLogistics();
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
