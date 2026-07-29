/* Данко Системс — АВТОМАТИЧНИ имейли през Brevo (Edge функция send-inquiry).
   Замества ръчното отваряне на Gmail: писмата се изпращат директно от системата,
   от името на FROM_EMAIL (настроен в Supabase secrets, напр. Gmail адреса,
   потвърден като подател в Brevo).
   Дава: erpMailSend (универсално), erpMailDiag (диагностика кое къса),
   erpMailInvoice (фактура към клиента), erpMailOrderDialog (заявка: готова/срок).
   Пада меко: ако функцията не тръгне, отваря старото Gmail compose (erp-email.js). */

// Личният мейл на влезлия потребител — праща му се копие (CC) на всичко изпратено
// от негово име. Цеховите профили (@danko.local) не са реални пощи → без копие.
function erpMailMyCc() {
  const e = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "";
  return (e.includes("@") && !e.toLowerCase().endsWith("@danko.local")) ? e : "";
}

async function erpMailSend({ to, subject, html, text, replyTo, direct, cc }) {
  const list = (Array.isArray(to) ? to : [to]).filter(e => e && String(e).includes("@"));
  if (!list.length) return { ok: false, error: "Няма валиден имейл на получател." };
  // Копие до личния мейл (ако не е изрично подадено друго).
  const ccList = (cc === undefined ? [erpMailMyCc()] : (Array.isArray(cc) ? cc : [cc]))
    .filter(e => e && String(e).includes("@") && !list.includes(e));
  // „Отговори" при получателя → отива при ЧОВЕКА, пуснал писмото (личния му мейл),
  // а не в пощата-подател (zapitvane@…), която никой не следи.
  if (!replyTo) replyTo = erpMailMyCc();
  try {
    const { data, error } = await sb.functions.invoke("send-inquiry", {
      body: { to: list, cc: ccList, subject: subject || "", html: html || "", text: text || "", replyTo: replyTo || "", direct: !!direct },
    });
    if (error) {
      // Тялото на грешката често носи истинската причина (Brevo отказа: ...).
      let msg = error.message || String(error);
      try { const ctx = await error.context.json(); if (ctx && ctx.error) msg = ctx.error; } catch (e) {}
      return { ok: false, error: msg };
    }
    if (data && data.error) return { ok: false, error: data.error };
    return { ok: true, sent: (data && data.sent) || list.length };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
}

// Превежда техническата грешка в ясно обяснение какво да се оправи.
function erpMailExplain(err) {
  const s = String(err || "");
  if (/NOT_FOUND|Requested function was not found/i.test(s)) return "Функцията send-inquiry НЕ е деплойната в Supabase → Edge Functions.";
  if (/Failed to fetch|FunctionsFetchError|Failed to send a request/i.test(s)) return "Функцията не отговаря — провери дали е деплойната и дали Verify JWT е ИЗКЛЮЧЕН.";
  if (/BREVO_API_KEY|FROM_EMAIL|не е настроен/i.test(s)) return "Липсват тайни ключове в Supabase → Edge Functions → Secrets: BREVO_API_KEY и FROM_EMAIL.";
  if (/401|unauthori[sz]ed|Key not found|invalid.*key/i.test(s)) return "BREVO_API_KEY е невалиден — генерирай нов в Brevo → Settings → SMTP & API.";
  if (/sender/i.test(s)) return "Подателят (FROM_EMAIL) не е потвърден в Brevo → Senders & IP → Add sender.";
  return "";
}

/* ---------- Диагностика (тест на връзката) ---------- */
async function erpMailDiag() {
  const my = (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "";
  const { wrap, close } = erpDialog(`
    <h3>✉ Тест на имейла</h3>
    <p class="hint" style="margin:0 0 8px">Изпраща тестово писмо, за да провери цялата верига: приложение → Supabase функция → Brevo → пощата. Ако нещо къса, ще ти кажа точно какво.</p>
    <label>До (твой имейл) <input type="email" id="md-to" value="${escapeAttr(my)}" /></label>
    <div id="md-result" style="margin-top:10px"></div>
    <div class="erp-dialog-actions"><button class="btn" id="md-close">Затвори</button><button class="btn btn-primary" id="md-send">📤 Изпрати тест</button></div>`);
  wrap.querySelector("#md-close").addEventListener("click", close);
  wrap.querySelector("#md-send").addEventListener("click", async () => {
    const btn = wrap.querySelector("#md-send"); const res = wrap.querySelector("#md-result");
    btn.disabled = true; btn.textContent = "Изпращам…";
    res.innerHTML = '<span class="erp-muted">Проверявам…</span>';
    const r = await erpMailSend({
      to: wrap.querySelector("#md-to").value.trim(), direct: true,
      subject: "Тест от СИСТЕМАТА — имейлите работят ✓",
      text: "Това е тестово писмо от Данко Системс. Ако го четеш — всичко е настроено.",
      html: "<p>Това е <b>тестово писмо</b> от Данко Системс.</p><p>Ако го четеш — всичко е настроено ✓</p>",
    });
    btn.disabled = false; btn.textContent = "📤 Изпрати тест";
    if (r.ok) res.innerHTML = '<div style="background:#dcfce7;color:#166534;padding:10px 12px;border-radius:8px"><b>✓ Изпратено!</b> Провери пощата (и папка Spam).</div>';
    else {
      const why = erpMailExplain(r.error);
      res.innerHTML = `<div style="background:#fef2f2;color:#991b1b;padding:10px 12px;border-radius:8px"><b>✗ Не тръгна.</b><br>${escapeHtml(r.error)}${why ? `<br><br>👉 <b>${escapeHtml(why)}</b>` : ""}</div>`;
    }
  });
}

/* ---------- Общ прозорец за изпращане ---------- */
function erpMailComposeDialog({ title, to, subject, html, text, onSent }) {
  const { wrap, close } = erpDialog(`
    <h3>${escapeHtml(title || "✉ Изпращане на имейл")}</h3>
    <label>До <input type="email" id="mc-to" list="mc-contacts" value="${escapeAttr(to || "")}" placeholder="имейл на получателя (или избери от Контактите)" /></label>
    ${typeof erpMailContactsDatalist === "function" ? erpMailContactsDatalist() : ""}
    <label>Тема <input type="text" id="mc-subject" value="${escapeAttr(subject || "")}" /></label>
    <label>Съобщение <textarea id="mc-text" rows="7">${escapeHtml(text || "")}</textarea></label>
    ${erpMailMyCc() ? `<p class="hint" style="margin:6px 0 0">📩 Копие ще получиш и ти: <b>${escapeHtml(erpMailMyCc())}</b></p>` : ""}
    ${html ? '<p class="hint" style="margin:6px 0 0">Писмото ще включи и оформена таблица с данните (HTML).</p>' : ""}
    <div id="mc-result" style="margin-top:8px"></div>
    <div class="erp-dialog-actions"><button class="btn" id="mc-cancel">Отказ</button><button class="btn btn-primary" id="mc-send">📤 Изпрати</button></div>`);
  wrap.querySelector("#mc-cancel").addEventListener("click", close);
  wrap.querySelector("#mc-send").addEventListener("click", async () => {
    const btn = wrap.querySelector("#mc-send"); const res = wrap.querySelector("#mc-result");
    const toV = wrap.querySelector("#mc-to").value.trim();
    const subjV = wrap.querySelector("#mc-subject").value.trim();
    const textV = wrap.querySelector("#mc-text").value;
    if (!toV) { alert("Въведи имейл на получателя."); return; }
    btn.disabled = true; btn.textContent = "Изпращам…";
    const bodyHtml = html ? `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>${escapeHtml(textV).replace(/\n/g, "<br>")}</p>${html}</div>` : "";
    const r = await erpMailSend({ to: toV, subject: subjV, text: textV, html: bodyHtml, direct: true });
    btn.disabled = false; btn.textContent = "📤 Изпрати";
    if (r.ok) { res.innerHTML = '<div style="background:#dcfce7;color:#166534;padding:8px 10px;border-radius:8px">✓ Изпратено!</div>'; setTimeout(() => { close(); if (onSent) onSent(toV); }, 900); }
    else {
      const why = erpMailExplain(r.error);
      res.innerHTML = `<div style="background:#fef2f2;color:#991b1b;padding:8px 10px;border-radius:8px">✗ ${escapeHtml(r.error)}${why ? `<br>👉 <b>${escapeHtml(why)}</b>` : ""}</div>`;
    }
  });
}

/* ---------- Фактура към клиента ----------
   Износна фактура (серия 1) → целият имейл е НА АНГЛИЙСКИ (тема, текст,
   таблица, банкови данни от ERP_SELLER_EN); вътрешна → на български. */
function erpMailInvoiceExport(o) { return String(o.seriesKey || "") === "1"; }
function erpMailInvoiceHtml(o) {
  const en = erpMailInvoiceExport(o);
  const t = erpInvTotals(o); const cur = erpInvCur(o);
  const s = (en && typeof ERP_SELLER_EN !== "undefined") ? ERP_SELLER_EN : (ERP_SELLER || {});
  const L = en
    ? { date: "Date", to: "Customer", no: "No", code: "Code", name: "Description", qty: "Qty", price: "Unit price", amount: "Amount", base: "Tax base", vat: "VAT", total: "Total due", due: "Maturity date", days: "days", pay: "Bank payment" }
    : { date: "Дата", to: "Получател", no: "№", code: "Код", name: "Наименование", qty: "Кол.", price: "Ед. цена", amount: "Стойност", base: "Данъчна основа", vat: "ДДС", total: "Обща сума", due: "Падеж", days: "дни", pay: "Плащане по банка" };
  const fmtD = d => (typeof erpDMY === "function") ? erpDMY(d) : (d || "");
  const rows = (o.lines || []).map((l, i) => `<tr>
    <td style="border:1px solid #cbd5e1;padding:5px 7px">${i + 1}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px">${escapeHtml(l.code || "")}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px">${escapeHtml(l.name || "")}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${erpNum(l.qty)} ${escapeHtml(en ? (l.unit === "бр." || !l.unit ? "pcs" : l.unit) : (l.unit || ""))}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${erpNum(l.unitPrice)}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${erpInvMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), cur)}</td></tr>`).join("");
  const k = INV_KINDS[o.kind] || {};
  const vatLine = en && !t.vat
    ? `<p style="margin:2px 0">${L.base}: <b>${erpInvMoney(t.base, cur)}</b> · ${L.vat} 0% — ${escapeHtml((typeof INV_VAT_EXEMPT_EU !== "undefined" && o.vatBasis) ? o.vatBasis : "Art. 138 (1) of VAT Act — Intra-Community supply")}</p>`
    : `<p style="margin:2px 0">${L.base}: <b>${erpInvMoney(t.base, cur)}</b> · ${L.vat} ${t.rate}%: <b>${erpInvMoney(t.vat, cur)}</b></p>`;
  return `
  <h2 style="color:#0f766e;margin:14px 0 4px">${escapeHtml(en ? (k.en || "INVOICE") : (k.bg || "ФАКТУРА"))} № ${escapeHtml(o.docNo || "")}</h2>
  <p style="margin:2px 0">${L.date}: <b>${escapeHtml(fmtD(o.issueDate))}</b> · ${L.to}: <b>${escapeHtml((o.client && o.client.name) || "")}</b></p>
  ${o.orderRef ? `<p style="margin:2px 0">${en ? "Your order" : "Поръчка"}: <b>${escapeHtml(o.orderRef)}</b></p>` : ""}
  <table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px">
    <tr style="background:#ecfdf5;color:#065f46"><th style="border:1px solid #cbd5e1;padding:5px 7px">${L.no}</th><th style="border:1px solid #cbd5e1;padding:5px 7px">${L.code}</th><th style="border:1px solid #cbd5e1;padding:5px 7px">${L.name}</th><th style="border:1px solid #cbd5e1;padding:5px 7px">${L.qty}</th><th style="border:1px solid #cbd5e1;padding:5px 7px">${L.price}</th><th style="border:1px solid #cbd5e1;padding:5px 7px">${L.amount}</th></tr>
    ${rows}
  </table>
  ${vatLine}
  <p style="margin:2px 0;font-size:16px">${L.total}: <b style="color:#0f766e">${erpInvMoney(t.total, cur)}</b></p>
  ${(o.dueDate || Number(o.termDays) > 0) ? `<p style="margin:2px 0">${L.due}: <b>${escapeHtml(fmtD(o.dueDate))}</b>${Number(o.termDays) > 0 ? ` (${o.termDays} ${L.days})` : ""}</p>` : ""}
  ${s.iban ? `<p style="margin:8px 0 2px">${L.pay}: <b>IBAN ${escapeHtml(s.iban)}</b>${s.bic ? " · BIC " + escapeHtml(s.bic) : ""}${s.bank ? " · " + escapeHtml(s.bank) : ""}</p>` : ""}
  <p style="color:#64748b;font-size:12px;margin-top:12px">${escapeHtml(s.name || "Данко Системс")} · ${en ? "VAT " + escapeHtml(s.vat || "") : "ЕИК " + escapeHtml(s.eik || "")} · ${escapeHtml([s.address, s.city, en ? s.country : ""].filter(Boolean).join(", "))}</p>`;
}
async function erpMailInvoice(o) {
  const rec = (typeof erpPartnerEmail === "function") ? await erpPartnerEmail("customer", o.clientId, o.client && o.client.name) : null;
  const k = INV_KINDS[o.kind] || {};
  const en = erpMailInvoiceExport(o);
  const fmtD = d => (typeof erpDMY === "function") ? erpDMY(d) : (d || "");
  erpMailComposeDialog({
    title: "✉ " + (k.label || "Фактура") + (o.docNo ? " № " + o.docNo : "") + " → клиента" + (en ? " (EN)" : ""),
    to: (rec && rec.email) || "",
    subject: en
      ? `${(k.en || "Invoice").charAt(0) + (k.en || "Invoice").slice(1).toLowerCase()} No ${o.docNo || ""} — DANKO SYSTEMS Ltd.`
      : `${k.bg || "Фактура"} № ${o.docNo || ""} — ${(ERP_SELLER && ERP_SELLER.name) || "Данко Системс"}`,
    text: en
      ? `Dear${rec && rec.person ? " " + rec.person : " Sir or Madam"},\n\nPlease find attached ${(k.en || "invoice").toLowerCase()} No ${o.docNo || ""} dated ${fmtD(o.issueDate)}.\n\nShould you have any questions, please do not hesitate to contact us.\n\nBest regards,\nDANKO SYSTEMS Ltd.`
      : `Здравейте${rec && rec.person ? " " + rec.person : ""},\n\nПриложено изпращаме ${k.label || "фактура"} № ${o.docNo || ""} от ${fmtD(o.issueDate)}.\n\nПоздрави,\nекип Данко Системс`,
    html: erpMailInvoiceHtml(o),
  });
}

/* ---------- Заявка: „готова" / „кога ще е готова" ---------- */
async function erpMailOrderDialog(o) {
  // Клиентът от КОНТАКТИ (таб Контакти) — основният източник за имейл и лице;
  // партньорите остават като резервен вариант.
  try { if (typeof CONTACTS !== "undefined" && (!CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad(); } catch (e) {}
  const cn = String(o.clientName || "").trim().toLowerCase();
  let con = null;
  if (cn && typeof CONTACTS !== "undefined" && CONTACTS) {
    con = CONTACTS.find(c => String(c.company || "").trim().toLowerCase() === cn)
      || CONTACTS.find(c => (c.company || "").trim() && String(c.company).toLowerCase().includes(cn))
      || CONTACTS.find(c => (c.company || "").trim() && cn.includes(String(c.company).trim().toLowerCase()));
  }
  const rec = (typeof erpPartnerEmail === "function") ? await erpPartnerEmail("customer", o.clientId, o.clientName) : null;
  const person = (con && con.contact_person) || (rec && rec.person) || "";
  const toMail = (con && (con.email || con.invoice_email)) || (rec && rec.email) || "";
  const no = o.ourNo || "";
  const products = (o.lines || []).map(l => `• ${l.name || l.code || ""}${l.qty ? " — " + erpNum(l.qty) + " бр." : ""}`).filter(x => x.trim() !== "•").join("\n");
  const ready = {
    subject: "Поръчка" + (no ? " №" + no : "") + " е готова",
    text: `Здравейте${person ? " " + person : ""},\n\nВашата поръчка${no ? " №" + no : ""}${o.clientNo ? " (Ваш № " + o.clientNo + ")" : ""} е готова за получаване.\n${products ? "\n" + products + "\n" : ""}\nМоля, свържете се с нас за уговаряне на получаването/транспорта.\n\nПоздрави,\nекип Данко Системс`,
  };
  const term = {
    subject: "Поръчка" + (no ? " №" + no : "") + " е в производство — очаквана дата",
    text: `Здравейте${person ? " " + person : ""},\n\nВашата поръчка${no ? " №" + no : ""}${o.clientNo ? " (Ваш № " + o.clientNo + ")" : ""} е в производство.\nОчаквана дата на готовност: ${o.deadline || "(попълни дата)"}.\n${products ? "\n" + products + "\n" : ""}\nЩе Ви уведомим, щом бъде готова за експедиция.\n\nПоздрави,\nекип Данко Системс`,
  };
  const { wrap, close } = erpDialog(`
    <h3>✉ Имейл до клиента</h3>
    <p class="hint" style="margin:0 0 8px">👤 Клиент: <b>${escapeHtml(o.clientName || "—")}</b>${con ? ` · 📇 ${escapeHtml(con.contact_person || "")}${con.phone ? " · ☎ " + escapeHtml(con.phone) : ""} · ${toMail ? escapeHtml(toMail) : '<span class="erp-warn">няма имейл в Контакти</span>'}` : (toMail ? " · " + escapeHtml(toMail) : ' · <span class="erp-warn">не е намерен в Контакти — попълни имейла ръчно</span>')}</p>
    <p class="hint" style="margin:0 0 8px">Избери какво да съобщим на клиента за заявка ${escapeHtml(no ? "№" + no : "")}:</p>
    <div class="erp-dialog-actions" style="justify-content:flex-start">
      <button class="btn" id="mo-term">📅 Кога ще е готова (срок)</button>
      <button class="btn btn-primary" id="mo-ready">✅ Готова е</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="mo-cancel">Отказ</button>
    </div>`);
  const open = tpl => { close(); erpMailComposeDialog({ title: "✉ До клиента — заявка " + (no ? "№" + no : ""), to: toMail, subject: tpl.subject, text: tpl.text }); };
  wrap.querySelector("#mo-term").addEventListener("click", () => open(term));
  wrap.querySelector("#mo-ready").addEventListener("click", () => open(ready));
  wrap.querySelector("#mo-cancel").addEventListener("click", close);
}

/* ---------- Запитване за ТРАНСПОРТ ----------
   От фактура или заявка: маршрут, палети и тегло се попълват сами (от
   Транспорт/Опаковки), получателят се избира от Контактите (превозвачи). */
function erpMailContactsDatalist() {
  const list = (typeof CONTACTS !== "undefined" && CONTACTS || []).filter(c => c.email);
  return `<datalist id="mc-contacts">${list.map(c => `<option value="${escapeAttr(c.email)}">${escapeAttr((c.company || c.name || "") + (c.category ? " · " + c.category : ""))}</option>`).join("")}</datalist>`;
}
function erpMailTransportInquiry(o) {
  const tr = (o && o.transport) || {};
  const pal = (typeof erpDocAutoRows === "function") ? erpDocAutoRows(o) : [];
  const totKg = pal.reduce((s, p) => s + (erpToNum(p.weightKg) || 0), 0);
  const cnt = (o.pallets && o.pallets.length) || (tr.totalPackages || pal.length || "");
  const text = `Здравейте,

Молим за оферта за транспорт:

• Маршрут: ${tr.loadPlace || "Пловдив, България"} → ${tr.unloadPlace || ((o.client && [o.client.city, o.client.country].filter(Boolean).join(", ")) || "(попълни)")}
• Товар: ${cnt || "(бр.)"} палета${totKg ? ", общо ~" + erpNum(totKg) + " кг" : ""}
• Готовност за товарене: ${tr.loadDate || "(дата)"}
${tr.incoterms ? "• Условие: " + tr.incoterms + "\n" : ""}
Моля, посочете цена и срок за доставка.

Поздрави,
Данко Системс`;
  erpMailComposeDialog({
    title: "🚚 Запитване за транспорт" + (o.__ref || o.docNo ? " — " + (o.__ref || "фактура № " + o.docNo) : ""),
    to: "", subject: "Запитване за транспорт — Данко Системс",
    text, datalist: "mc-contacts",
  });
}

/* ---------- Заявка за МАТЕРИАЛИ до доставчик (от Покупка) ---------- */
async function erpMailSupplierRequest(o) {
  const items = (o.lines || [])
    .filter(l => l.name || l.article || l.code)
    .map(l => `• ${l.code ? l.code + " " : ""}${l.article || l.name || ""}${l.qty ? " — " + erpNum(l.qty) + (l.unit ? " " + l.unit : "") : ""}`)
    .join("\n");
  if (!items) { alert("Добави поне един ред (материал/артикул) в покупката."); return; }
  const rec = (typeof erpPartnerEmail === "function") ? await erpPartnerEmail("supplier", o.supplierId, o.supplierName) : null;
  const person = (rec && rec.person) || "";
  const text = `Здравейте${person ? " " + person : ""},

Молим за потвърждение и доставка на следните материали:

${items}

Моля, потвърдете наличност, единични цени и срок на доставка.

Поздрави,
Данко Системс`;
  erpMailComposeDialog({
    title: "✉ Заявка за материали → " + (o.supplierName || "доставчик"),
    to: (rec && rec.email) || "", subject: "Заявка за доставка на материали — Данко Системс",
    text, datalist: "mc-contacts",
  });
}
