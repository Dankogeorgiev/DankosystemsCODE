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
let logiView = "dest";       // dest | loads
let logiQ = "";

async function logiLoad() {
  if (LOGI) return LOGI;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "logistics_loads").maybeSingle();
    LOGI = { loads: (data && data.data && data.data.loads) || [], inq: (data && data.data && data.data.inq) || [] };
  } catch (e) { LOGI = { loads: [], inq: [] }; }
  return LOGI;
}
async function logiSave() {
  const { error } = await sb.from("app_config").upsert({ id: "logistics_loads", data: { loads: (LOGI || {}).loads || [], inq: (LOGI || {}).inq || [] }, updated_at: new Date().toISOString() });
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
          await logiLoad();
          LOGI.inq = LOGI.inq || [];
          // Товарът (брой палети) се чете от реда „• Товар: …" на ФИНАЛНИЯ
          // текст — хваща и редакциите, направени в композитора преди пращане.
          LOGI.inq.push({
            id: Date.now(), at: new Date().toISOString(),
            to: [toV].concat((info && info.extras) || []).filter(Boolean),
            subject: (info && info.subject) || "", text: (info && info.text) || text,
            label: p.label || "", cargo: logiCargoOf({ text: (info && info.text) || text }),
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

/* 📜 Товарите: авто-редове от издадените износни фактури с превозвач. */
function logiSyncFromInvoices() {
  const loads = LOGI.loads;
  const have = new Set(loads.map(l => logiNorm(l.invNo)));
  let added = 0;
  ((typeof erpInvoices !== "undefined" && erpInvoices) || []).forEach(o => {
    if (o.kind === "proforma" || !o.posted || !o.docNo) return;
    const tr = o.transport || {};
    const cs = (o.consignee && (o.consignee.street || o.consignee.city)) ? o.consignee : (o.client || {});
    const isExport = String(invSeriesOfInvoice ? invSeriesOfInvoice(o) : o.seriesKey || "") === "1";
    if (!isExport && !tr.carrier) return;
    if (have.has(logiNorm(o.docNo))) return;
    loads.push({
      id: logiNextId(), invNo: String(o.docNo), date: tr.shipDate || o.issueDate || "",
      client: (o.client && o.client.name) || "", dest: [cs.city, cs.country].filter(Boolean).join(", "),
      carrier: tr.carrier || "", vehicle: tr.vehicleReg || "",
      status: tr.carrier ? "натоварен" : "заявен", note: "", at: new Date().toISOString(),
    });
    have.add(logiNorm(o.docNo)); added++;
  });
  return added;
}

const LOGI_STATUSES = ["заявен", "натоварен", "разтоварен"];

async function erpRenderLogistics() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане на логистиката…</p>`;
  try { if (typeof erpLoadInvoices === "function" && (typeof erpInvoices === "undefined" || !erpInvoices)) await erpLoadInvoices(); } catch (e) {}
  try { if (typeof erpInvLoadSeries === "function") await erpInvLoadSeries(); } catch (e) {}
  try { if ((typeof CONTACTS === "undefined" || !CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad(); } catch (e) {}
  await logiLoad();

  const q = logiNorm(logiQ);
  const money = "";

  let body = "";
  if (logiView === "inq") {
    let inqs = (LOGI.inq || []).slice().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (q) inqs = inqs.filter(x => logiNorm([x.label, x.subject, (x.to || []).join(" "), logiCargoOf(x), x.price, x.text].join(" ")).includes(q));
    body = `<table class="report-table erp-table">
      <thead><tr><th>Кога</th><th>До кого</th><th>Относно</th><th>Товар</th><th>Върната цена</th><th>Откъс</th><th></th></tr></thead>
      <tbody>${inqs.map(x => `<tr>
        <td style="white-space:nowrap">${escapeHtml(new Date(x.at).toLocaleString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }))}</td>
        <td>${(x.to || []).map(t => `<span class="t-code">${escapeHtml(t)}</span>`).join("<br>")}</td>
        <td>${escapeHtml(x.label || x.subject || "")}</td>
        <td style="white-space:nowrap">${escapeHtml(logiCargoOf(x)) || `<span class="erp-muted">—</span>`}</td>
        <td><input type="text" class="lgq-price" data-id="${x.id}" value="${escapeAttr(x.price || "")}" placeholder="напр. 450 €" title="Цената, която фирмата върна в отговор — записва се веднага, за сравнение между превозвачите" style="width:110px" /></td>
        <td class="erp-muted" style="max-width:340px;font-size:12px">${escapeHtml(String(x.text || "").split("\n").filter(l => l.trim().startsWith("•")).join(" · ") || String(x.text || "").slice(0, 90))}</td>
        <td class="erp-row-actions">
          <button class="btn btn-small lgq-view" data-id="${x.id}" title="Пълният текст на запитването">👁</button>
          <button class="btn btn-small btn-primary lgq-resend" data-id="${x.id}" title="Същото запитване до ДРУГА фирма — избираш получател, текстът е готов">↪ До друга фирма</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="7" class="report-empty">Още няма изпратени запитвания. Пращат се от „📨 Запитване за транспорт" или от бутона на дестинация — и се записват тук сами.</td></tr>`}</tbody>
    </table>
    <p class="hint">Всяко изпратено запитване се помни: кога, до кого, за какъв товар и какъв текст. Като получиш оферта — напиши я в „Върната цена" (записва се веднага) и после сравняваш превозвачите. „↪ До друга фирма" праща СЪЩИЯ текст на нов получател с два клика.</p>`;
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
    if (q) loads = loads.filter(l => logiNorm([l.invNo, l.client, l.dest, l.carrier, l.vehicle, l.note].join(" ")).includes(q));
    const stBadge = s => s === "разтоварен" ? `<span class="erp-co-status" style="background:#dcfce7;color:#166534">✓ разтоварен</span>`
      : s === "натоварен" ? `<span class="erp-co-status" style="background:#fef9c3;color:#854d0e">🚚 натоварен</span>`
      : `<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">⏳ заявен</span>`;
    body = `<table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№ Фактура</th><th>Клиент</th><th>Дестинация</th><th>Превозвач</th><th>Камион</th><th>Статус</th><th>Бележка / ЧМР</th><th></th></tr></thead>
      <tbody>${loads.map(l => `<tr data-lid="${l.id}">
        <td>${erpDMY(l.date) || "—"}</td>
        <td><b>${escapeHtml(l.invNo || "—")}</b></td>
        <td>${escapeHtml(l.client || "")}</td>
        <td>${escapeHtml(l.dest || "")}</td>
        <td>${escapeHtml(l.carrier || "") || `<span class="erp-muted">—</span>`}</td>
        <td>${escapeHtml(l.vehicle || "")}</td>
        <td><select class="lgi-st" data-lid="${l.id}" title="Статус на товара">${LOGI_STATUSES.map(s => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select> ${stBadge(l.status)}</td>
        <td><input type="text" class="lgi-note" data-lid="${l.id}" value="${escapeAttr(l.note || "")}" placeholder="ЧМР №, файл, уговорка…" style="width:160px" /></td>
        <td class="erp-row-actions"><button class="btn btn-small lgi-edit" data-lid="${l.id}" title="Редакция на товара">✎</button><button class="btn btn-small btn-danger lgi-del" data-lid="${l.id}" title="Изтрий реда">×</button></td>
      </tr>`).join("") || `<tr><td colspan="9" class="report-empty">Няма записани товари. „🔄 От фактурите" пълни архива от издадените износни фактури.</td></tr>`}</tbody>
    </table>
    <p class="hint">Архивът помни коя фактура с кой превозвач е тръгнала: заявен → натоварен → разтоварен. Статусът и бележката (№ на ЧМР) се записват веднага. „Разтоварен" отбелязваш, щом клиентът потвърди — така знаеш, че стоката е пристигнала.</p>`;
  }

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small ${logiView === "dest" ? "btn-primary" : ""}" id="lgi-v-dest">🗺 Дестинации</button>
      <button class="btn btn-small ${logiView === "loads" ? "btn-primary" : ""}" id="lgi-v-loads">📜 Товари (${(LOGI.loads || []).length})</button>
      <button class="btn btn-small ${logiView === "inq" ? "btn-primary" : ""}" id="lgi-v-inq">📨 Запитвания (${(LOGI.inq || []).length})</button>
      <input type="search" id="lgi-q" placeholder="🔎 клиент / адрес / № фактура / превозвач… (Enter)" value="${escapeAttr(logiQ)}" style="min-width:250px" autocomplete="off" />
      <span class="spacer"></span>
      <button class="btn btn-small" id="lgi-inq" title="Свободно запитване за транспорт до избрани транспортни фирми">📨 Запитване за транспорт</button>
      ${logiView === "loads" ? `<button class="btn btn-small" id="lgi-sync" title="Добавя в архива издадените износни фактури, които още ги няма (превозвачът идва от ✎ Транспорт на фактурата)">🔄 От фактурите</button>
      <button class="btn btn-small btn-primary" id="lgi-add">+ Товар</button>` : ""}
    </div>
    ${body}`;

  v.querySelector("#lgi-v-dest").addEventListener("click", () => { logiView = "dest"; erpRenderLogistics(); });
  v.querySelector("#lgi-v-loads").addEventListener("click", () => { logiView = "loads"; erpRenderLogistics(); });
  v.querySelector("#lgi-v-inq").addEventListener("click", () => { logiView = "inq"; erpRenderLogistics(); });
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
    logiInquiry({ text: x.text, subject: x.subject, label: (x.label || "") + " (повторно)" });
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

  if (logiView !== "loads") return;
  const findL = id => (LOGI.loads || []).find(x => Number(x.id) === Number(id));
  v.querySelector("#lgi-sync").addEventListener("click", async () => {
    const n = logiSyncFromInvoices();
    if (!n) { alert("Няма нови фактури за добавяне — всичко издадено (износ/с превозвач) вече е в архива."); return; }
    if (await logiSave()) { alert(`✅ Добавени ${n} товара от фактурите.`); erpRenderLogistics(); }
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

/* Ръчен товар / редакция. */
function logiEditDialog(l) {
  const isNew = !l;
  l = l || { id: 0, invNo: "", date: new Date().toISOString().slice(0, 10), client: "", dest: "", carrier: "", vehicle: "", status: "заявен", note: "" };
  const carriers = [...new Set(logiCarriers().map(c => (c.company || "").trim()).filter(Boolean))];
  const { wrap, close } = erpDialog(`
    <h3>${isNew ? "➕ Нов товар" : "✎ Товар — фактура № " + escapeHtml(l.invNo || "—")}</h3>
    <div class="erp-co-grid">
      <label>№ Фактура <input type="text" id="lg-inv" value="${escapeAttr(l.invNo)}" /></label>
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
    l.invNo = gv("lg-inv"); l.date = gv("lg-date"); l.client = gv("lg-client"); l.dest = gv("lg-dest");
    l.carrier = gv("lg-carrier"); l.vehicle = gv("lg-vehicle"); l.status = gv("lg-status"); l.note = gv("lg-note");
    if (isNew) { l.id = logiNextId(); l.at = new Date().toISOString(); LOGI.loads.push(l); }
    if (await logiSave()) { close(); erpRenderLogistics(); }
  });
}
