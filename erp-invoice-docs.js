/* Данко Системс — ИЗНОСНИ документи към фактурата (по образците от GenCloud,
   28.07.2026): INVOICE (EN, само ORIGINAL) + Packing List + CMR + Description
   of Goods + декларации за произход (BG/EN) + диалозите Транспорт и Палети.
   Тук са и липсвалите помощници invPrintWindow/invSellerBlock/invClientBlock/
   invDocRef, от които зависят придружаващите документи.
   Ползва erpDialog/escapeHtml/escapeAttr/erpNum/erpToNum/ERP_SELLER/
   erpInvTotals/invEnWords/invAmountWords от другите файлове. */

/* Нашите данни НА АНГЛИЙСКИ за износните документи (от образеца на GenCloud).
   ⚠ IBAN-ът тук е EUR сметката от износната фактура-образец — различен от
   лв. сметката в ERP_SELLER (erp-sales.js). Провери и поправи при нужда. */
const ERP_SELLER_EN = {
  name: "DANKO SYSTEMS Ltd.",
  address: "Str. Viktor Yugo 5",
  city: "4000 Plovdiv",
  country: "Bulgaria",
  vat: "BG115789385",
  phone: "00359 877 612 915",
  email: "office@dankosystems.com",
  iban: "BG65UBBS81551485471707",
  bic: "UBBSBGSF",
  bank: "UNITED BULGARIAN BANK AD",
  place: "Plovdiv",
  goodsDesc: "sofa bed mechanism and metal parts for sofas",   // за декларацията
  manager: "Danko Georgiev",
};

/* Условия на плащане за износ (искането на Данко) + дни за падежа.
   eom: след дните се отива до края на месеца. */
const INV_PAY_CONDITIONS = [
  { key: "5 days", days: 5 },
  { key: "7 days", days: 7 },
  { key: "10 days", days: 10 },
  { key: "10 days with 3% discount", days: 10 },
  { key: "14 days", days: 14 },
  { key: "30 days", days: 30 },
  { key: "30 days EOM", days: 30, eom: true },
  { key: "advanced payment", days: 0 },
];
const INV_VAT_EXEMPT_EU = "Intra-Community supply of goods, exempt from VAT according to Art. 138(1) Directive 2006/112/EC";
// Държави, за които декларацията за произход носи маршрут + митница.
const INV_DECL_ROUTE_COUNTRIES = ["сърбия", "serbia", "англия", "великобритания", "uk", "united kingdom", "england", "албания", "albania", "швейцария", "switzerland"];

function invDocRef(o) {
  const no = o.docNo || o.saleNo || "";
  const d = o.issueDate || o.date || "";
  return no ? `${no} / ${d}` : d;
}
function invFmtD(d) { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (d || ""); }

function invSellerBlock(en) {
  if (en) {
    const s = ERP_SELLER_EN;
    return `<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.address)}<br>${escapeHtml(s.city)} ${escapeHtml(s.country)}<br><b>VAT Number:</b> ${escapeHtml(s.vat)}<br>${escapeHtml(s.phone)}<br>${escapeHtml(s.email)}`;
  }
  const s = (typeof ERP_SELLER !== "undefined" && ERP_SELLER) || {};
  return `<b>${escapeHtml(s.name || "")}</b><br>ЕИК ${escapeHtml(s.eik || "")} · ${escapeHtml(s.vat || "")}<br>${escapeHtml(s.address || "")}<br>${escapeHtml(s.city || "")}<br>${escapeHtml(s.phone || "")}`;
}
function invClientBlock(o, which) {
  // which: "buyer" (по подразбиране) или "consignee" (за износ адресите се различават)
  const c = (which === "consignee" && o.consignee && (o.consignee.name || o.consignee.street || o.consignee.city))
    ? o.consignee : (o.client || {});
  return `<b>${escapeHtml(c.name || (o.client && o.client.name) || o.clientName || "")}</b><br>
    ${[c.street, c.city, c.country].filter(Boolean).map(escapeHtml).join("<br>")}
    ${c.vat ? `<br><b>VAT Number:</b> ${escapeHtml(c.vat)}` : ""}
    ${c.person ? `<br>${escapeHtml(c.person)}` : ""}`;
}

/* Печатен прозорец с общи стилове + бутони Печат и ✎ Редакция (contentEditable —
   поправяш текста директно преди печат; печатът крие бутоните). */
function invPrintWindow(title, body, lang, opts) {
  const en = lang === "en";
  opts = opts || {};
  const base = new URL(".", location.href).href;
  const html = `<!doctype html><html lang="${en ? "en" : "bg"}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,"DejaVu Sans",sans-serif;color:#111;font-size:12px;margin:16px 26px;max-width:840px}
    h1{font-size:17px;letter-spacing:.6px;margin:4px 0}
    h3{font-size:12.5px;margin:0 0 4px}
    .lg img{height:52px;display:block;margin-bottom:6px}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.4px solid #000;padding-bottom:6px;margin-bottom:10px}
    .parties{display:flex;gap:16px;margin-bottom:10px}
    .party{flex:1;border:1.4px solid #000;padding:6px 10px}
    table{width:100%;border-collapse:collapse;margin-bottom:10px}
    th,td{border:1.2px solid #000;padding:4px 6px;font-size:11.5px;text-align:left;vertical-align:top}
    th{background:#efefef;text-align:center}
    td.r{text-align:right}td.c,th.c{text-align:center}.muted{color:#777}
    .kv{margin:4px 0}
    .grid2{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 18px;border:1.4px solid #000;padding:6px 10px;margin-bottom:10px}
    .foot{display:flex;justify-content:space-between;margin-top:34px}
    .foot div{width:44%;border-top:1px solid #000;padding-top:4px;text-align:center}
    .made{text-align:center;font-size:9.5px;color:#666;margin-top:16px}
    @page{size:A4 portrait;margin:9mm}
    @media print{body{margin:0;max-width:none}.noprint{display:none}}
    .noprint{text-align:center;margin:10px 0}
    .btnp{background:#0f766e;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:14px;cursor:pointer;margin:0 4px}
    .btne{background:#b45309}
    body.editing{outline:3px dashed #b45309;outline-offset:-3px}
  </style></head><body>
    <div class="noprint">
      <button class="btnp" onclick="window.print()">🖨 ${en ? "Print" : "Печат"}</button>
      <button class="btnp btne" onclick="var b=document.body;b.contentEditable=(b.contentEditable!=='true');b.classList.toggle('editing');this.textContent=b.contentEditable==='true'?'✔ ${en ? "Done editing" : "Готово"}':'✎ ${en ? "Edit" : "Редакция"}'">✎ ${en ? "Edit" : "Редакция"}</button>
    </div>
    ${opts.noLogo ? "" : `<div class="lg"><img src="${base}welcome.svg?v=144" alt="DankoSystems" /></div>`}
    ${body}
    ${opts.noMade ? "" : `<div class="made">The Systems</div>`}
  </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  w.document.write(html); w.document.close(); w.focus();
}

/* Опциите за Conditions of delivery (по списъка на Кристина, 29.07.2026). */
const INV_INCOTERMS = ["CFR", "CIF", "CIP", "CPT", "DAP", "DAT", "DDP", "EXW", "FAS", "FCA", "FOB", "XXX"];
/* ЕС ли е дестинацията? Извън ЕС (Сърбия, UK, Швейцария…) ЧМР-то добавя
   EUR1, MRN към приложените документи. */
const INV_EU_RX = /\b(BG|RO|GR|EL|DE|IT|FR|ES|PT|NL|BE|AT|PL|CZ|SK|HU|SI|HR|DK|SE|FI|EE|LV|LT|IE|LU|MT|CY)\b|бълга|bulgaria|romania|румън|greece|гърц|german|герман|ital|итал|france|french|франц|spain|испан|portugal|португ|netherland|holland|нидерл|холанд|belgium|белги|austria|австри|poland|полша|czech|чехи|slovak|словаш|hungar|унгар|sloven|словен|croat|хърват|denmark|дани|sweden|швеци|finland|финланд|estonia|естон|latvia|латви|lithuania|литва|ireland|ирланд|luxembourg|люксемб|malta|малта|cyprus|кипър/i;
function invIsEU(o) {
  const tr = o.transport || {};
  const c = (o.consignee && o.consignee.country) || (o.client && o.client.country) || tr.destination || "";
  return INV_EU_RX.test(String(c));
}
/* Стоката в ЧМР (кл. 6-9): по подразбиране SOFA BED MECHANISMS; за Хомаг —
   Metal parts (orders №…) с номера на поръчката. Редактира се в 🚚 Транспорт. */
function invGoodsNature(o) {
  const tr = o.transport || {};
  if (tr.goodsNature) return tr.goodsNature;
  const nm = ((o.client && o.client.name) || "") + " " + ((o.consignee && o.consignee.name) || "");
  if (/homag/i.test(nm)) return "Metal parts (orders " + (o.orderRef || "") + ")";
  return "SOFA BED MECHANISMS";
}
/* Палети и бруто: бруто = нето + палети × тегло на палет (по подразб. 20 кг);
   ръчното „Бруто тегло" в 🚚 Транспорт има превес. */
function invPalletInfo(o, netKg) {
  const tr = o.transport || {};
  const n = parseInt(tr.totalPackages, 10) || 0;
  const pk = erpToNum(tr.palletKg) || 20;
  const manual = erpToNum(tr.totalWeightKg) || 0;
  const gross = manual > 0 ? manual : Math.round(((netKg || 0) + n * pk) * 10) / 10;
  return { n, pk, gross, net: Math.round((netKg || 0) * 10) / 10 };
}

/* ---------- ✎ Транспорт — диалогът, който липсваше ---------- */
function erpInvTransportDialog(o, onSave) {
  o.transport = o.transport || {};
  const tr = o.transport;
  const f = (id, label, val, ph) => `<label>${label}<input type="text" id="${id}" value="${escapeAttr(val || "")}" placeholder="${escapeAttr(ph || "")}" /></label>`;
  const { wrap, close } = erpDialog(`
    <h3>🚚 Транспорт — данни за документите</h3>
    <p class="hint">Попълват износната фактура, Packing List, ЧМР, Description of goods и декларациите.</p>
    <div class="erp-co-grid">
      <label>Условия на доставка (Incoterms)<select id="tr-incoterms"><option value="">—</option>${INV_INCOTERMS.map(x => `<option ${x === tr.incoterms ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      ${f("tr-means", "Превоз (Means of transport)", tr.means || "by truck", "by truck")}
      ${f("tr-loadplace", "Място на товарене (Place of shipment)", tr.loadPlace || "Plovdiv", "Plovdiv")}
      <label>Дата на експедиция (Date of shipment)<input type="date" id="tr-shipdate" value="${escapeAttr(tr.shipDate || "")}" /></label>
      ${f("tr-destination", "Дестинация (Destination)", tr.destination, "напр. Italy")}
      ${f("tr-unload", "Място на разтоварване (за ЧМР)", tr.unloadPlace, "адрес на доставката")}
      ${f("tr-carrier", "Превозвач (Carrier)", tr.carrier, "фирма превозвач")}
      ${f("tr-vehicle", "Камион № (Vehicle Plate No.)", tr.vehicleReg, "рег. номер + ремарке")}
      ${f("tr-driver", "Шофьор", tr.driver, "")}
      ${f("tr-route", "Маршрут (Route)", tr.route, "напр. BG-RO-HU-AT-DE-CH")}
      ${f("tr-customs", "Митница (Customs)", tr.customs, "напр. DE004101 Bietingen")}
      <label>Бруто тегло, кг — РЪЧНО<input type="number" step="any" id="tr-weight" value="${escapeAttr(String(tr.totalWeightKg || ""))}" placeholder="празно = нето + палетите" /></label>
      <label>Палети/пакети (бр.)<input type="text" id="tr-packages" value="${escapeAttr(String(tr.totalPackages || ""))}" /></label>
      <label>Тегло на 1 палет, кг<input type="number" step="any" id="tr-palletkg" value="${escapeAttr(String(tr.palletKg || 20))}" /></label>
      ${f("tr-goods", "Стока в ЧМР (Nature of goods)", tr.goodsNature || invGoodsNature(o), "SOFA BED MECHANISMS")}
    </div>
    <p class="hint">Бруто = нето (от редовете) + палети × тегло на палет — освен ако не въведеш бруто на ръка.</p>
    <div class="erp-dialog-actions">
      <span class="spacer"></span>
      <button class="btn" id="tr-cancel">Отказ</button>
      <button class="btn btn-primary" id="tr-save">Запази</button>
    </div>`);
  wrap.querySelector("#tr-cancel").addEventListener("click", close);
  wrap.querySelector("#tr-save").addEventListener("click", () => {
    const gv = id => (wrap.querySelector("#" + id) || {}).value || "";
    tr.incoterms = gv("tr-incoterms"); tr.means = gv("tr-means");
    tr.loadPlace = gv("tr-loadplace"); tr.shipDate = gv("tr-shipdate");
    tr.destination = gv("tr-destination"); tr.unloadPlace = gv("tr-unload");
    tr.carrier = gv("tr-carrier"); tr.vehicleReg = gv("tr-vehicle");
    tr.driver = gv("tr-driver"); tr.route = gv("tr-route"); tr.customs = gv("tr-customs");
    tr.totalWeightKg = gv("tr-weight"); tr.totalPackages = gv("tr-packages");
    tr.palletKg = gv("tr-palletkg"); tr.goodsNature = gv("tr-goods");
    close();
    if (typeof onSave === "function") onSave();
  });
}

/* ---------- ✎ Палети — диалогът, който липсваше ---------- */
function erpInvPalletsDialog(o, onSave) {
  o.pallets = Array.isArray(o.pallets) ? o.pallets : [];
  const rowsHtml = () => (o.pallets.length ? o.pallets : [{}]).map((p, i) => `
    <tr>
      <td><input type="text" data-i="${i}" data-k="no" value="${escapeAttr(String(p.no || i + 1))}" style="width:46px" /></td>
      <td><input type="text" data-i="${i}" data-k="desc" value="${escapeAttr(p.desc || "")}" style="width:100%" /></td>
      <td><input type="number" step="any" data-i="${i}" data-k="qty" value="${escapeAttr(String(p.qty || ""))}" style="width:80px" /></td>
      <td><input type="number" step="any" data-i="${i}" data-k="weightKg" value="${escapeAttr(String(p.weightKg || ""))}" style="width:80px" /></td>
      <td><button class="btn btn-small btn-danger" data-rm="${i}">✕</button></td>
    </tr>`).join("");
  const { wrap, close } = erpDialog(`
    <h3>🧱 Палети</h3>
    <p class="hint">Редовете влизат в Packing List и Палет описа. Празно = смята се от редовете на документа.</p>
    <table class="report-table"><thead><tr><th>№</th><th>Съдържание</th><th>Кол.</th><th>Тегло кг</th><th></th></tr></thead>
    <tbody id="pl-body">${rowsHtml()}</tbody></table>
    <div class="erp-dialog-actions">
      <button class="btn btn-small" id="pl-add">+ Палет</button>
      <span class="spacer"></span>
      <button class="btn" id="pl-cancel">Отказ</button>
      <button class="btn btn-primary" id="pl-save">Запази</button>
    </div>`);
  const body = wrap.querySelector("#pl-body");
  const collect = () => {
    const out = [];
    body.querySelectorAll("tr").forEach(tr => {
      const g = k => { const el = tr.querySelector(`[data-k="${k}"]`); return el ? el.value : ""; };
      const row = { no: g("no"), desc: g("desc"), qty: erpToNum(g("qty")) || 0, weightKg: erpToNum(g("weightKg")) || 0 };
      if (row.desc || row.qty || row.weightKg) out.push(row);
    });
    return out;
  };
  const rewire = () => {
    body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => {
      o.pallets = collect(); o.pallets.splice(Number(b.dataset.rm), 1);
      body.innerHTML = rowsHtml(); rewire();
    }));
  };
  rewire();
  wrap.querySelector("#pl-add").addEventListener("click", () => { o.pallets = collect(); o.pallets.push({ no: o.pallets.length + 1 }); body.innerHTML = rowsHtml(); rewire(); });
  wrap.querySelector("#pl-cancel").addEventListener("click", close);
  wrap.querySelector("#pl-save").addEventListener("click", () => { o.pallets = collect(); close(); if (typeof onSave === "function") onSave(); });
}

/* ---------- ИЗНОСНА ФАКТУРА (EN, само ORIGINAL — по образеца от GenCloud) ---------- */
function erpInvPrintExport(o) {
  const s = ERP_SELLER_EN;
  const t = erpInvTotals(o); const cur = erpInvCur(o) || "EUR";
  const tr = o.transport || {};
  const k = (typeof INV_KINDS !== "undefined" && INV_KINDS[o.kind]) || {};
  const title = k.en || (o.kind === "credit" ? "CREDIT NOTE" : o.kind === "debit" ? "DEBIT NOTE" : o.kind === "proforma" ? "PROFORMA INVOICE" : "INVOICE");
  const fm = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const c = o.client || {};
  const cons = (o.consignee && (o.consignee.name || o.consignee.street || o.consignee.city)) ? o.consignee : c;
  const party = (label, p) => `
    <div class="party"><div class="ph">${label}</div>
      <table class="pfields">
        <tr><td class="fl">Name</td><td><b>${escapeHtml(p.name || "")}</b></td></tr>
        <tr><td class="fl">Address</td><td>${[p.street, [p.city, p.country].filter(Boolean).join(", ")].filter(Boolean).map(escapeHtml).join("<br>")}</td></tr>
        <tr><td class="fl">VAT Number</td><td><b>${escapeHtml(p.vat || "")}</b></td></tr>
        <tr><td class="fl">E-mail</td><td>${escapeHtml(p.email || "")}</td></tr>
        <tr><td class="fl">Contact Name</td><td>${escapeHtml(p.person || "")}</td></tr>
      </table>
    </div>`;
  const rows = (o.lines || []).map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${escapeHtml(l.clientCode || l.code || "")}</td>
      <td>${escapeHtml(l.name || "")}</td>
      <td class="c">${escapeHtml(l.orderRef || o.orderRef || "")}</td>
      <td class="c">${escapeHtml(l.tariffCode || o.tariffCode || "")}</td>
      <td class="r">${erpNum(l.qty)} pcs.</td>
      <td class="r">${fm(l.unitPrice)}</td>
      <td class="r">${fm((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0))}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="c muted">—</td></tr>`;
  const noteRef = (o.kind === "credit" || o.kind === "debit") && o.refInvoice
    ? `<div class="kv"><b>Based on Invoice:</b> ${escapeHtml(o.refInvoice.docNo || "")} / ${invFmtD(o.refInvoice.date)}${o.refReason ? ` · ${escapeHtml(o.refReason)}` : ""}</div>` : "";
  const vatLine = Number(o.vatRate) === 0
    ? `<div class="vatline">${escapeHtml(o.vatBasis || INV_VAT_EXEMPT_EU)}</div>`
    : "";
  const body = `
    <div class="head">
      <div><h1>${escapeHtml(title)}</h1></div>
      <div style="text-align:right"><b>ORIGINAL</b></div>
    </div>
    <div class="sellerbar">
      <div><b>SELLER: ${escapeHtml(s.name)}</b><br>
        <span class="fl2">Address</span> ${escapeHtml(s.address)}, ${escapeHtml(s.city)} ${escapeHtml(s.country)}<br>
        <b>VAT Number:</b> ${escapeHtml(s.vat)}</div>
      <div style="text-align:right">№: <b>${escapeHtml(o.docNo || "____")}</b><br>Date: <b>${invFmtD(o.issueDate)}</b><br>
        Phone: ${escapeHtml(s.phone)}<br>Email: ${escapeHtml(s.email)}</div>
    </div>
    ${noteRef}
    <div class="parties">
      ${party("CONSIGNEE", cons)}
      ${party("BUYER/IMPORTER", c)}
    </div>
    <div class="grid2">
      <div><b>Transport:</b><br>Means of transport:<br><b>${escapeHtml(tr.means || "by truck")}</b><br>Destination: <b>${escapeHtml(tr.destination || c.country || "")}</b></div>
      <div>Date of shipment:<br><b>${invFmtD(tr.shipDate || o.issueDate)}</b><br>Place of shipment:<br><b>${escapeHtml(tr.loadPlace || s.place)}</b><br>Date of tax event:<br><b>${invFmtD(o.taxDate || o.issueDate)}</b></div>
      <div>Conditions of delivery:<br><b>${escapeHtml(tr.incoterms || "")}</b><br>Payment condition:<br><b>${escapeHtml(o.payCond || (Number(o.termDays) > 0 ? o.termDays + " days from invoice" : ""))}</b><br>MATURITY DATE: <b>${invFmtD(o.dueDate)}</b><br>Currency: <b>${escapeHtml(cur)}</b></div>
    </div>
    <table class="items">
      <thead><tr>
        <th class="c" style="width:24px">№</th><th class="c" style="width:80px">Code</th>
        <th>Description of goods / services</th>
        <th class="c" style="width:82px">Order No/Date</th>
        <th class="c" style="width:70px">Tariff Code</th>
        <th class="c" style="width:66px">Quantity</th>
        <th class="c" style="width:66px">Unit price ${escapeHtml(cur)}</th>
        <th class="c" style="width:76px">Amount ${escapeHtml(cur)}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totbox">
      <div class="tl"><b>Say:</b> ${escapeHtml(invAmountWords(t.total, cur, "en"))}<br><b>Payment method:</b> ${/каса|cash|брой/i.test(o.paymentMethod || "") ? "cash" : "bank transfer"}</div>
      <div class="tr2">
        ${Number(o.vatRate) > 0 ? `<div class="trow2"><span>Tax base:</span><b>${fm(t.base)} ${escapeHtml(cur)}</b></div><div class="trow2"><span>VAT ${t.rate}%:</span><b>${fm(t.vat)} ${escapeHtml(cur)}</b></div>` : ""}
        <div class="trow2"><span>TOTAL ${escapeHtml(cur)}:</span><b style="font-size:13px">${fm(t.total)}</b></div>
        <div class="trow2"><span>TOTAL in ${escapeHtml(cur)}:</span><b>${fm(t.total)}</b></div>
      </div>
    </div>
    ${vatLine}
    ${o.note ? `<div class="kv">${escapeHtml(o.note)}</div>` : ""}
    <div class="bankbox">
      <div><b>Date of issue:</b> ${invFmtD(o.issueDate)}<br><b>Place of transaction:</b> ${escapeHtml(s.place)}</div>
      <div><b>IBAN:</b> ${escapeHtml(s.iban)}<br><b>BIC/SWIFT:</b> ${escapeHtml(s.bic)}<br><b>Bank:</b> ${escapeHtml(s.bank)}<br><br>
        Compiler: ${escapeHtml(o.compiledBy || "")} <span style="margin-left:40px">signature:</span></div>
    </div>
    <style>
      .sellerbar{display:flex;justify-content:space-between;border:1.4px solid #000;padding:6px 10px;margin-bottom:8px}
      .party .ph{font-weight:700;background:#efefef;border-bottom:1.2px solid #000;margin:-6px -10px 6px;padding:3px 10px}
      table.pfields, table.pfields td{border:none!important;padding:2px 4px;font-size:11.5px}
      table.pfields .fl{color:#444;width:88px}
      .totbox{border:1.4px solid #000;display:flex;gap:12px;padding:8px 10px;margin-bottom:8px}
      .totbox .tl{flex:1;align-self:center}
      .totbox .tr2{min-width:250px}
      .totbox .trow2{display:flex;justify-content:space-between;gap:12px}
      .vatline{border:1.4px solid #000;padding:5px 10px;margin-bottom:8px;font-weight:600}
      .bankbox{border:1.4px solid #000;padding:8px 10px;display:flex;justify-content:space-between;gap:20px}
    </style>`;
  invPrintWindow(title + " " + (o.docNo || ""), body, "en");
}

/* ---------- Packing List (по образеца: Marks and numbers / Order / Qty / Net weight / Value) ---------- */
function erpInvPrintPackingEx(o) {
  const tr = o.transport || {};
  const cons = (o.consignee && (o.consignee.name || o.consignee.city)) ? o.consignee : (o.client || {});
  let totQ = 0, totW = 0;
  const rows = (o.lines || []).map((l, i) => {
    const q = erpToNum(l.qty) || 0; totQ += q;
    const kg1 = (typeof erpDocLineKg === "function") ? (erpDocLineKg(o, l) || 0) : 0;   // общо кг за реда
    const per1 = q > 0 ? kg1 / q : 0;
    totW += kg1;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${escapeHtml(l.clientCode || l.code || "")}</td>
      <td>${escapeHtml(l.name || "")}</td>
      <td class="c">${escapeHtml(l.orderRef || o.orderRef || "")}</td>
      <td class="r">${erpNum(q)} pcs.</td>
      <td class="r">${per1 ? erpNum(Math.round(per1 * 100) / 100) : ""}</td>
      <td class="r">${kg1 ? erpNum(Math.round(kg1 * 10) / 10) : ""}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="c muted">—</td></tr>`;
  const pi = invPalletInfo(o, totW);
  const body = `
    <div class="head"><div><h1>PACKING LIST</h1></div>
      <div style="text-align:right">INVOICE № and date: <b>${escapeHtml(invDocRef(o))}</b>${o.orderRef ? `<br>Order No.: <b>${escapeHtml(o.orderRef)}</b>` : ""}</div></div>
    <div class="parties"><div class="party"><h3>Consignee:</h3>${invClientBlock(o, "consignee")}</div></div>
    <div class="grid2">
      <div><b>Transport:</b><br>Means of transport:<br><b>${escapeHtml(tr.means || "by truck")}</b><br>Destination: <b>${escapeHtml(tr.destination || cons.country || "")}</b></div>
      <div>Conditions of delivery:<br><b>${escapeHtml(tr.incoterms || "")}</b></div>
      <div>Place of shipment:<br><b>${escapeHtml(tr.loadPlace || "Plovdiv")}</b><br>Date of shipment:<br><b>${invFmtD(tr.shipDate || o.issueDate || o.date)}</b></div>
    </div>
    <table>
      <thead><tr><th class="c" style="width:24px">№</th><th class="c" style="width:80px">Code</th><th>Marks and numbers</th><th class="c" style="width:84px">Order No/Date</th><th class="c" style="width:70px">Quantity</th><th class="c" style="width:70px">Net weight 1 pc (kg)</th><th class="c" style="width:76px">Net weight (kg)</th></tr></thead>
      <tbody>${rows}
      <tr><td colspan="4" class="r"><b>Total Qty:</b></td><td class="r"><b>${erpNum(totQ)} pcs</b></td><td></td><td class="r"><b>${erpNum(pi.net)} kg</b></td></tr></tbody>
    </table>
    <div class="kv"><b>Total net weight:</b> ${erpNum(pi.net)} kg</div>
    <div class="kv"><b>Pallets:</b> ${pi.n || "—"}${pi.n ? ` × ${erpNum(pi.pk)} kg = ${erpNum(pi.n * pi.pk)} kg` : ""}</div>
    <div class="kv"><b>Total gross weight:</b> ${erpNum(pi.gross)} kg</div>
    <div class="kv">Place: <b>${escapeHtml(tr.loadPlace || "Plovdiv")}</b> · Date: <b>${invFmtD(tr.shipDate || o.issueDate || o.date)}</b></div>
    <div class="foot"><div>Signature: ${escapeHtml(o.compiledBy || "")}</div><div>Received</div></div>`;
  invPrintWindow("Packing List " + (o.docNo || ""), body, "en");
}

/* ---------- Description of Goods (по образеца: митница, камион, маршрут, опис) ---------- */
function erpInvPrintDescGoods(o) {
  const tr = o.transport || {};
  const rows = (o.lines || []).map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${escapeHtml(l.name || "")}</b></td>
      <td>${escapeHtml(l.goodsDesc || "")}</td>
    </tr>`).join("") || `<tr><td colspan="3" class="c muted">—</td></tr>`;
  const body = `
    <div class="head"><div><h1>DESCRIPTION OF GOODS</h1></div>
      <div style="text-align:right"><b>${escapeHtml(invDocRef(o))}</b>${o.orderRef ? `<br>Order No.: <b>${escapeHtml(o.orderRef)}</b>` : ""}</div></div>
    <div class="grid2" style="grid-template-columns:1fr 1fr">
      <div>Speditor:<br>Company: <b>${escapeHtml(tr.carrier || "")}</b></div>
      <div>Митница: <b>${escapeHtml(tr.customs || "")}</b><br>Vehicle Plate No.: <b>${escapeHtml(tr.vehicleReg || "")}</b></div>
    </div>
    <div class="kv">Route: <b>${escapeHtml(tr.route || "")}</b></div>
    <table>
      <thead><tr><th class="c" style="width:26px">№</th><th>Marks and numbers</th><th style="width:200px">Описание (за митницата)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted" style="font-size:10.5px">Описанието на всеки ред („Тръби с планки", „Планки"…) се попълва с ✎ Редакция преди печат — или кажи на Клод да добави поле по ред.</p>
    <div class="foot"><div>Date: ${invFmtD(tr.shipDate || o.issueDate || o.date)}</div><div>Signature: ${escapeHtml(o.compiledBy || "")}</div></div>`;
  invPrintWindow("Description of Goods " + (o.docNo || ""), body, "en");
}

/* ---------- ЧМР / CMR — ОФИЦИАЛНИЯТ пълен формуляр (полета 1-24) ----------
   По образците от GenCloud (29.07.2026): едър, на цяла страница; кл. 5 носи
   фактура + пакинг лист (+ EUR1, MRN за извън ЕС); стоката (кл. 9) е
   SOFA BED MECHANISMS, а за Хомаг — Metal parts (orders №…); кл. 11 бруто =
   нето + палети × тегло на палет. */
function erpInvPrintCMREx(o) {
  const s = ERP_SELLER_EN; const tr = o.transport || {};
  const cons = (o.consignee && (o.consignee.name || o.consignee.city)) ? o.consignee : (o.client || {});
  const netKg = (o.lines || []).reduce((sum, l) => sum + ((typeof erpDocLineKg === "function" && erpDocLineKg(o, l)) || 0), 0);
  const pi = invPalletInfo(o, netKg);
  const eu = invIsEU(o);
  const docsAttached = `INVOICE No.: <b>${escapeHtml(o.docNo || "")}</b> / ${invFmtD(o.issueDate)}<br>PACKING LIST No.: ${escapeHtml(o.docNo || "")} / ${invFmtD(o.issueDate)}${o.orderRef ? `<br>ORDER No.: <b>${escapeHtml(o.orderRef)}</b>` : ""}${eu ? "" : "<br><b>EUR1, MRN</b>"}`;
  const bx = (cls, label, val, mh) => `<div class="cbx ${cls || ""}" style="min-height:${mh || 46}px"><div class="cbl">${label}</div><div class="cbv">${val || ""}</div></div>`;
  const body = `
    <div class="cmr-top">
      <div class="cmr-copy">Екземпляр за изпращача<br><i>Copy for sender</i><br><span class="cmr-fill">1 – 5, 9 – 16, 18 + 22</span></div>
      <div class="cmr-title"><b>МЕЖДУНАРОДНА<br>ТОВАРИТЕЛНИЦА</b><div class="cmr-big">CMR</div><i>INTERNATIONAL CONSIGNMENT NOTE</i></div>
      <div class="cmr-no">No <b>${escapeHtml(o.docNo || "..........")}</b><br><span class="cmr-fill">...................... Държава / Country</span></div>
    </div>
    <div class="cmr-note">За попълване на отговорност на изпращача · To be completed on the sender's responsibility · Очертаните графи с дебели линии се попълват от превозвача / The space framed with heavy lines must be filled in by the carrier</div>
    <div class="cmrgrid">
      <div class="cmrcol">
        ${bx("", "1 Изпращач (име, адрес, държава) / Sender (name, address, country)", `<b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.vat)}<br>${escapeHtml(s.address)}<br>${escapeHtml(s.city)}, ${escapeHtml(s.country)} BG`, 74)}
        ${bx("", "2 Получател (име, адрес, държава) / Consignee (name, address, country)", `<b>${escapeHtml(cons.name || "")}</b><br>${[cons.street, cons.city, cons.country].filter(Boolean).map(escapeHtml).join("<br>")}${cons.vat ? "<br>" + escapeHtml(cons.vat) : ""}`, 74)}
        ${bx("", "3 Място на разтоварване на стоката / Place of delivery of the goods (place, country)", escapeHtml(tr.unloadPlace || [cons.city, cons.country].filter(Boolean).join(", ")), 52)}
        ${bx("", "4 Място и дата на натоварване / Place and date of taking over the goods (place, country, date)", `${escapeHtml(tr.loadPlace || s.address + ", " + s.city)}, Bulgaria BG<br>Date: <b>${invFmtD(tr.shipDate || o.issueDate)}</b>`, 52)}
        ${bx("", "5 Приложени документи / Documents attached", docsAttached, 62)}
      </div>
      <div class="cmrcol">
        ${bx("hv", "16 Превозвач (име, адрес, държава) / Carrier (name, address, country)", escapeHtml(tr.carrier || "") + (tr.vehicleReg ? `<br>Vehicle Plate No.: <b>${escapeHtml(tr.vehicleReg)}</b>` : "") + (tr.driver ? `<br>Driver: ${escapeHtml(tr.driver)}` : ""), 74)}
        ${bx("hv", "17 Последващи превозвачи / Successive carriers", "", 52)}
        ${bx("hv", "18 Резерви и бележки на превозвача / Carrier's reservations and observations on taking over the goods", "", 74)}
        ${bx("", "13 Инструкции на изпращача / Sender's instructions", (tr.route ? "Route: <b>" + escapeHtml(tr.route) + "</b>" : "") + (tr.customs ? `<br>Customs: <b>${escapeHtml(tr.customs)}</b>` : ""), 62)}
        ${bx("", "14 Условия на доставка / Conditions of delivery", `<b>${escapeHtml(tr.incoterms || "")}</b>`, 34)}
      </div>
    </div>
    <table class="cmr-goods">
      <thead><tr>
        <th style="width:20%">6 Марки и номера<br><i>Marks and numbers</i></th>
        <th style="width:14%">7 Брой на пакетите<br><i>Number of packages</i></th>
        <th style="width:16%">8 Начин на опаковане<br><i>Method of packing</i></th>
        <th>9 Вид на стоката<br><i>Nature of the goods</i></th>
        <th style="width:12%">10 Статистически №<br><i>Statistical number</i></th>
        <th style="width:12%">11 Тегло бруто, kg<br><i>Gross weight in kg</i></th>
        <th style="width:9%">12 Обем m³<br><i>Volume in m³</i></th>
      </tr></thead>
      <tbody><tr style="height:84px">
        <td>Pallets: <b>${pi.n || ""}</b></td>
        <td class="c"><b>${pi.n || ""}</b></td>
        <td class="c">${pi.n ? "pallets" : ""}</td>
        <td><b>${escapeHtml(invGoodsNature(o))}</b></td>
        <td class="c">${escapeHtml(o.tariffCode || "")}</td>
        <td class="c"><b>${pi.gross ? erpNum(pi.gross) : ""}</b></td>
        <td></td>
      </tr></tbody>
    </table>
    <div class="cmrgrid">
      <div class="cmrcol">
        ${bx("", "19 Специални споразумения / Special agreements", "", 36)}
        ${bx("", "21 Съставена в / Established in — на / on", `${escapeHtml(tr.loadPlace || "Plovdiv")} · ${invFmtD(tr.shipDate || o.issueDate)}`, 36)}
        ${bx("", "22 Подпис и печат на изпращача / Signature and stamp of the sender", `<br><br>${escapeHtml(s.name)}`, 72)}
      </div>
      <div class="cmrcol">
        ${bx("hv", "20 Разни / Miscellaneous", "", 36)}
        ${bx("hv", "23 Подпис и печат на превозвача / Signature and stamp of the carrier", "<br><br><br>", 72)}
        ${bx("", "24 Стоката получена / Goods received — място / place ............... дата / date ...............<br>Подпис и печат на получателя / Signature and stamp of the consignee", "<br><br>", 72)}
      </div>
    </div>
    <p class="muted" style="font-size:9.5px;margin-top:4px">Този превоз се подчинява, независимо от всяка противна клауза, на Конвенцията за договора за международен автомобилен превоз на стоки (CMR). · This carriage is subject, notwithstanding any clause to the contrary, to the Convention on the Contract for the International Carriage of Goods by Road (CMR).</p>
    <style>
      .cmr-top{display:flex;gap:10px;align-items:stretch;border:2px solid #000;padding:6px 10px;margin-bottom:4px}
      .cmr-copy{font-size:10px;flex:1}
      .cmr-title{text-align:center;flex:1.4;font-size:12px;line-height:1.25}
      .cmr-big{font-size:30px;font-weight:800;letter-spacing:4px}
      .cmr-no{text-align:right;flex:1;font-size:11px}
      .cmr-fill{color:#555;font-size:9px}
      .cmr-note{font-size:8.5px;color:#333;margin:0 0 6px;border-bottom:1px solid #000;padding-bottom:3px}
      .cmrgrid{display:grid;grid-template-columns:1.12fr 1fr;gap:0 6px}
      .cbx{border:1.4px solid #000;margin-bottom:4px;padding:3px 6px}
      .cbx.hv{border-width:2.6px}
      .cbl{font-size:8.5px;color:#333;line-height:1.15;margin-bottom:2px}
      .cbl i{color:#555}
      .cbv{font-size:11.5px;line-height:1.3}
      table.cmr-goods{width:100%;border-collapse:collapse;margin:0 0 4px}
      table.cmr-goods th,table.cmr-goods td{border:1.4px solid #000;font-size:10.5px;padding:3px 6px;vertical-align:top}
      table.cmr-goods th{font-size:8.5px;font-weight:400;color:#333;text-align:left}
      table.cmr-goods th i{color:#555}
      table.cmr-goods td.c{text-align:center}
      @media print{ body{font-size:11px} }
    </style>`;
  invPrintWindow("CMR " + (o.docNo || ""), body, "bg");
}

/* ---------- Декларации за произход (BG + EN, авто от фактурата) ---------- */
function erpInvPrintDeclaration(o, lang) {
  const en = lang === "en";
  const s = ERP_SELLER_EN;
  const tr = o.transport || {};
  const country = String(((o.consignee && o.consignee.country) || (o.client && o.client.country) || tr.destination || "")).toLowerCase();
  const needRoute = INV_DECL_ROUTE_COUNTRIES.some(x => country.includes(x));
  const routeBlock = needRoute ? (en
    ? `<p>Route: <b>${escapeHtml(tr.route || "..................")}</b> · Customs: <b>${escapeHtml(tr.customs || "..................")}</b></p>`
    : `<p>Маршрут: <b>${escapeHtml(tr.route || "..................")}</b> · Митница: <b>${escapeHtml(tr.customs || "..................")}</b></p>`) : "";
  const body = en ? `
    <div class="head"><div><h1>Declaration by the exporter</h1></div><div></div></div>
    <p>By<br><b>${escapeHtml(s.name)}</b><br>${escapeHtml(s.country)}<br>${escapeHtml(s.city)}<br>${escapeHtml(s.address)}<br>VAT: ${escapeHtml(s.vat)}</p>
    <p>The undersigned <b>${escapeHtml(s.manager)}</b>, declares that the above products <b>${escapeHtml(s.goodsDesc)}</b>,
      exported with invoice No.: <b>${escapeHtml(o.docNo || "")}/${invFmtD(o.issueDate)}</b>${o.orderRef ? `, customer order No.: <b>${escapeHtml(o.orderRef)}</b>` : ""},
      loaded on truck: <b>${escapeHtml(tr.vehicleReg || "..................")}</b>,
      are produced with materials by EU and are with European statute.</p>
    ${routeBlock}
    <p style="margin-top:30px">Date: ${invFmtD(o.issueDate)}</p>
    <p style="margin-top:26px">Declared by: ................................<br>/${escapeHtml(s.manager)}/<br>Manager</p>` : `
    <div class="head"><div><h1>Декларация за произход</h1></div><div></div></div>
    <p>От<br><b>${escapeHtml((typeof ERP_SELLER !== "undefined" && ERP_SELLER.name) || s.name)}</b><br>гр. Пловдив 4000, ул. Виктор Юго № 5<br>ЕИК: ${escapeHtml((typeof ERP_SELLER !== "undefined" && ERP_SELLER.eik) || "115789385")}</p>
    <p>Долуподписаният <b>Данко Георгиев</b> декларирам, че описаните стоки — <b>механизми за дивани и метални части за мека мебел</b>,
      изнесени с фактура №: <b>${escapeHtml(o.docNo || "")}/${invFmtD(o.issueDate)}</b>${o.orderRef ? `, по поръчка на клиента №: <b>${escapeHtml(o.orderRef)}</b>` : ""},
      натоварени на камион: <b>${escapeHtml(tr.vehicleReg || "..................")}</b>,
      са произведени с материали от ЕС и са с европейски произход, съгласно чл. 313.</p>
    ${routeBlock}
    <p style="margin-top:30px">Дата: ${invFmtD(o.issueDate)}</p>
    <p style="margin-top:26px">Декларатор: ................................<br>/Данко Георгиев/<br>Управител</p>`;
  invPrintWindow(en ? "Declaration by exporter" : "Декларация за произход", body, lang);
}
