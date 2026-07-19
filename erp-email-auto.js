/* Данко Системс — АВТОМАТИЧНИ имейли през Brevo (Edge функция send-inquiry).
   Замества ръчното отваряне на Gmail: писмата се изпращат директно от системата,
   от името на FROM_EMAIL (настроен в Supabase secrets, напр. Gmail адреса,
   потвърден като подател в Brevo).
   Дава: erpMailSend (универсално), erpMailDiag (диагностика кое къса),
   erpMailInvoice (фактура към клиента), erpMailOrderDialog (заявка: готова/срок).
   Пада меко: ако функцията не тръгне, отваря старото Gmail compose (erp-email.js). */

async function erpMailSend({ to, subject, html, text, replyTo, direct }) {
  const list = (Array.isArray(to) ? to : [to]).filter(e => e && String(e).includes("@"));
  if (!list.length) return { ok: false, error: "Няма валиден имейл на получател." };
  try {
    const { data, error } = await sb.functions.invoke("send-inquiry", {
      body: { to: list, subject: subject || "", html: html || "", text: text || "", replyTo: replyTo || "", direct: !!direct },
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
    <label>До <input type="email" id="mc-to" value="${escapeAttr(to || "")}" placeholder="имейл на получателя" /></label>
    <label>Тема <input type="text" id="mc-subject" value="${escapeAttr(subject || "")}" /></label>
    <label>Съобщение <textarea id="mc-text" rows="7">${escapeHtml(text || "")}</textarea></label>
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

/* ---------- Фактура към клиента ---------- */
function erpMailInvoiceHtml(o) {
  const t = erpInvTotals(o); const cur = erpInvCur(o); const s = ERP_SELLER || {};
  const rows = (o.lines || []).map((l, i) => `<tr>
    <td style="border:1px solid #cbd5e1;padding:5px 7px">${i + 1}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px">${escapeHtml(l.code || "")}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px">${escapeHtml(l.name || "")}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${erpNum(l.qty)} ${escapeHtml(l.unit || "")}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${erpNum(l.unitPrice)}</td>
    <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${erpInvMoney((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), cur)}</td></tr>`).join("");
  const k = INV_KINDS[o.kind] || {};
  return `
  <h2 style="color:#0f766e;margin:14px 0 4px">${escapeHtml(k.bg || "ФАКТУРА")} № ${escapeHtml(o.docNo || "")}</h2>
  <p style="margin:2px 0">Дата: <b>${escapeHtml(o.issueDate || "")}</b> · Получател: <b>${escapeHtml((o.client && o.client.name) || "")}</b></p>
  <table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px">
    <tr style="background:#ecfdf5;color:#065f46"><th style="border:1px solid #cbd5e1;padding:5px 7px">№</th><th style="border:1px solid #cbd5e1;padding:5px 7px">Код</th><th style="border:1px solid #cbd5e1;padding:5px 7px">Наименование</th><th style="border:1px solid #cbd5e1;padding:5px 7px">Кол.</th><th style="border:1px solid #cbd5e1;padding:5px 7px">Ед. цена</th><th style="border:1px solid #cbd5e1;padding:5px 7px">Стойност</th></tr>
    ${rows}
  </table>
  <p style="margin:2px 0">Данъчна основа: <b>${erpInvMoney(t.base, cur)}</b> · ДДС ${t.rate}%: <b>${erpInvMoney(t.vat, cur)}</b></p>
  <p style="margin:2px 0;font-size:16px">Обща сума: <b style="color:#0f766e">${erpInvMoney(t.total, cur)}</b></p>
  ${(o.dueDate || Number(o.termDays) > 0) ? `<p style="margin:2px 0">Падеж: <b>${escapeHtml(o.dueDate || "")}</b>${Number(o.termDays) > 0 ? ` (${o.termDays} дни)` : ""}</p>` : ""}
  ${s.iban ? `<p style="margin:8px 0 2px">Плащане по банка: <b>IBAN ${escapeHtml(s.iban)}</b>${s.bic ? " · BIC " + escapeHtml(s.bic) : ""}${s.bank ? " · " + escapeHtml(s.bank) : ""}</p>` : ""}
  <p style="color:#64748b;font-size:12px;margin-top:12px">${escapeHtml(s.name || "Данко Системс")} · ЕИК ${escapeHtml(s.eik || "")} · ${escapeHtml([s.address, s.city].filter(Boolean).join(", "))}</p>`;
}
async function erpMailInvoice(o) {
  const rec = (typeof erpPartnerEmail === "function") ? await erpPartnerEmail("customer", o.clientId, o.client && o.client.name) : null;
  const k = INV_KINDS[o.kind] || {};
  erpMailComposeDialog({
    title: "✉ " + (k.label || "Фактура") + (o.docNo ? " № " + o.docNo : "") + " → клиента",
    to: (rec && rec.email) || "",
    subject: `${k.bg || "Фактура"} № ${o.docNo || ""} — ${(ERP_SELLER && ERP_SELLER.name) || "Данко Системс"}`,
    text: `Здравейте${rec && rec.person ? " " + rec.person : ""},\n\nПриложено изпращаме ${k.label || "фактура"} № ${o.docNo || ""} от ${o.issueDate || ""}.\n\nПоздрави,\nекип Данко Системс`,
    html: erpMailInvoiceHtml(o),
  });
}

/* ---------- Заявка: „готова" / „кога ще е готова" ---------- */
async function erpMailOrderDialog(o) {
  const rec = (typeof erpPartnerEmail === "function") ? await erpPartnerEmail("customer", o.clientId, o.clientName) : null;
  const person = (rec && rec.person) || "";
  const no = o.ourNo || "";
  const products = (o.lines || []).map(l => `• ${l.name || l.code || ""}${l.qty ? " — " + erpNum(l.qty) + " бр." : ""}`).filter(x => x.trim() !== "•").join("\n");
  const ready = {
    subject: "Поръчка" + (no ? " №" + no : "") + " е готова",
    text: `Здравейте${person ? " " + person : ""},\n\nВашата поръчка${no ? " №" + no : ""}${o.clientNo ? " (Ваш № " + o.clientNo + ")" : ""} е готова за получаване.\n${products ? "\n" + products + "\n" : ""}\nМоля, свържете се с нас за уговаряне на получаването/транспорта.\n\nПоздрави,\nекип Данко Системс`,
  };
  const term = {
    subject: "Срок за изпълнение на поръчка" + (no ? " №" + no : ""),
    text: `Здравейте${person ? " " + person : ""},\n\nВашата поръчка${no ? " №" + no : ""}${o.clientNo ? " (Ваш № " + o.clientNo + ")" : ""} е приета и се изпълнява.\nОчакван срок за готовност: ${o.deadline || "(попълни дата)"}.\n${products ? "\n" + products + "\n" : ""}\nЩе Ви уведомим при готовност.\n\nПоздрави,\nекип Данко Системс`,
  };
  const { wrap, close } = erpDialog(`
    <h3>✉ Имейл до клиента</h3>
    <p class="hint" style="margin:0 0 8px">Избери какво да съобщим на клиента за заявка ${escapeHtml(no ? "№" + no : "")}:</p>
    <div class="erp-dialog-actions" style="justify-content:flex-start">
      <button class="btn" id="mo-term">📅 Кога ще е готова (срок)</button>
      <button class="btn btn-primary" id="mo-ready">✅ Готова е</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="mo-cancel">Отказ</button>
    </div>`);
  const open = tpl => { close(); erpMailComposeDialog({ title: "✉ До клиента — заявка " + (no ? "№" + no : ""), to: (rec && rec.email) || "", subject: tpl.subject, text: tpl.text }); };
  wrap.querySelector("#mo-term").addEventListener("click", () => open(term));
  wrap.querySelector("#mo-ready").addEventListener("click", () => open(ready));
  wrap.querySelector("#mo-cancel").addEventListener("click", close);
}
