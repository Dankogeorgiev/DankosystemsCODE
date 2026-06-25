/* Данко Системс — Модул „Контакти“
   Контактите се пазят в таблица `contacts` (Supabase). Достъп само за админи. */

let CONTACTS = [];
let INQUIRIES = [];
let contactsLoaded = false;
let contactsSubscribed = false;
let contactCat = "";
let inqCat = "";
let inqSelected = new Set();

// Синя палитра (различни нюанси) за категориите.
const CAT_PALETTE = [
  "#1e3a8a", "#1d4ed8", "#2563eb", "#3b82f6", "#1e40af", "#0369a1", "#0284c7",
  "#0ea5e9", "#075985", "#155e75", "#0891b2", "#4338ca", "#4f46e5", "#6366f1", "#312e81",
];

const CONTACT_CATEGORIES = [
  "Контакти – Служители",
  "Клиент – вътрешен пазар", "Клиент – външен пазар", "Клиент – външен пазар (HOMAG)",
  "Транспорт / логистика", "Услуги / други",
  "Доставчик – Метали", "Доставчик – Консумативи за производство", "Доставчик – Крепежи", "Доставчик – Покупни",
  "Доставчик – Инструменти за машини",
  "Доставчик – опаковки", "Доставчик – кашони", "Доставчик – други",
];

/* ---------- Зареждане / запис ---------- */
async function cLoad() {
  const { data, error } = await sb.from("contacts").select("*").order("updated_at", { ascending: false });
  if (error) { alert("Грешка при зареждане на контактите: " + error.message); return; }
  const all = (data || []).map(r => ({ ...r.data, id: r.id }));
  CONTACTS = all.filter(c => c.kind !== "inquiry");
  INQUIRIES = all.filter(c => c.kind === "inquiry");
}
async function cSeedIfNeeded() {
  // Зареждаме началните контакти само ако таблицата е празна и файлът с данни е наличен.
  if (CONTACTS.length > 0) return;
  if (!(window.DANKO_CONTACTS && window.DANKO_CONTACTS.length)) {
    alert("Файлът с контактите още не е зареден (кеш). Опресни с Ctrl+Shift+R и опитай пак.");
    return;
  }
  const rows = window.DANKO_CONTACTS.map(c => ({ data: c }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("contacts").insert(rows.slice(i, i + 200));
    if (error) { alert("Грешка при зареждане на началните контакти: " + error.message); break; }
  }
  await cLoad();
}
async function cSaveContact(c) {
  c.updatedAt = new Date().toISOString();
  if (c.id) {
    const { error } = await sb.from("contacts").update({ data: c, updated_at: c.updatedAt }).eq("id", c.id);
    if (error) alert("Грешка при запис: " + error.message);
  } else {
    const { data, error } = await sb.from("contacts").insert({ data: c }).select().single();
    if (error) { alert("Грешка при запис: " + error.message); return; }
    c.id = data.id;
    CONTACTS.unshift({ ...data.data, id: data.id });
  }
}
async function cDelete(c) {
  if (amWorker()) return;
  if (!confirm(`Изтриване на контакта „${c.company || c.contact_person || ""}“?`)) return;
  const { error } = await sb.from("contacts").delete().eq("id", c.id);
  if (error) { alert("Грешка: " + error.message); return; }
  CONTACTS = CONTACTS.filter(x => x.id !== c.id);
  renderContacts();
}

/* ---------- Отваряне ---------- */
async function openContacts() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("contacts-modal").hidden = false;
  showContactsSub("list");
  if (!contactsLoaded) { await cLoad(); await cSeedIfNeeded(); contactsLoaded = true; cSubscribe(); }
  renderContacts();
}
function showContactsSub(which) {
  document.getElementById("contacts-view").hidden = which !== "list";
  document.getElementById("contact-form").hidden = which !== "form";
  document.getElementById("inquiry-view").hidden = which !== "inquiry";
  document.getElementById("contact-cat-bar").style.display = which === "list" ? "" : "none";
}

function allCategories() {
  const set = new Set(CONTACT_CATEGORIES);
  CONTACTS.forEach(c => { if (c.category) set.add(c.category); });
  return [...set];
}
function catColor(cat) {
  const list = allCategories();
  let i = list.indexOf(cat);
  if (i < 0) i = Math.abs([...String(cat)].reduce((a, ch) => a + ch.charCodeAt(0), 0));
  return CAT_PALETTE[i % CAT_PALETTE.length];
}
function catGroup(cat) {
  if (/^Клиент/.test(cat)) return "Клиенти";
  if (/^Доставчик/.test(cat)) return "Доставчици";
  return "Други";
}
function renderCatBar() {
  const bar = document.getElementById("contact-cat-bar");
  const counts = {};
  CONTACTS.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
  const groups = { "Доставчици": [], "Клиенти": [], "Други": [] };
  allCategories().forEach(cat => { (groups[catGroup(cat)] || groups["Други"]).push(cat); });

  const chip = cat => `<button class="cat-chip ${contactCat === cat ? "active" : ""}" data-cat="${escapeAttr(cat)}" style="background:${catColor(cat)}">${escapeHtml(cat)} (${counts[cat] || 0})</button>`;

  let html = `<div class="cat-allrow"><button class="cat-chip ${contactCat === "" ? "active" : ""}" data-cat="" style="background:#475569">Всички (${CONTACTS.length})</button></div><div class="cat-groups">`;
  ["Доставчици", "Клиенти", "Други"].forEach(g => {
    if (!groups[g] || !groups[g].length) return;
    html += `<div class="cat-col"><div class="cat-col-title">${g}</div>${groups[g].map(chip).join("")}</div>`;
  });
  html += `</div>`;
  bar.innerHTML = html;
  bar.querySelectorAll(".cat-chip").forEach(b => b.addEventListener("click", () => {
    contactCat = b.dataset.cat; renderContacts();
  }));
}

/* ---------- Списък ---------- */
function renderContacts() {
  showContactsSub("list");
  renderCatBar();
  const tbody = document.getElementById("contacts-body");
  const cat = contactCat;
  const term = (document.getElementById("contact-search").value || "").trim().toLowerCase();
  tbody.innerHTML = "";

  const rows = CONTACTS.filter(c => {
    if (cat && c.category !== cat) return false;
    if (term && !(`${c.company} ${c.contact_person} ${c.phone} ${c.email} ${c.scope} ${c.notes}`.toLowerCase().includes(term))) return false;
    return true;
  }).sort((a, b) => (a.company || "").localeCompare(b.company || "", "bg"));

  document.getElementById("contacts-empty").hidden = rows.length > 0;

  rows.forEach(c => {
    const tr = document.createElement("tr");
    const flag = c.no_price_increase ? ` <span class="np-flag" title="Не пускаме увеличение">⚠</span>` : "";
    tr.innerHTML = `
      <td><span class="cat-badge" style="background:${c.category ? catColor(c.category) : "#94a3b8"};color:#fff">${escapeHtml(c.category) || "—"}</span></td>
      <td><strong>${escapeHtml(c.company) || "—"}</strong>${flag}${c.scope ? `<div class="c-scope">${escapeHtml(c.scope)}</div>` : ""}</td>
      <td>${escapeHtml(c.contact_person) || "—"}</td>
      <td>${escapeHtml(c.phone) || "—"}</td>
      <td>${c.email ? `<a href="mailto:${escapeAttr(c.email)}">${escapeHtml(c.email)}</a>` : "—"}</td>
      <td class="c-notes">${escapeHtml(c.notes) || ""}</td>
      <td class="c-actions">
        <button class="btn btn-small c-edit" title="Редакция">✎</button>
        <button class="remove-row c-del" title="Изтрий">×</button>
      </td>`;
    tr.querySelector(".c-edit").addEventListener("click", () => renderContactForm(c));
    tr.querySelector(".c-del").addEventListener("click", () => cDelete(c));
    tbody.appendChild(tr);
  });
}

/* ---------- Форма (добавяне/редакция) ---------- */
function renderContactForm(contact) {
  if (amWorker()) return;
  const c = contact || {};
  showContactsSub("form");
  const box = document.getElementById("contact-form");
  const cats = allCategories();
  box.innerHTML = `
    <div class="workers-head">
      <h3>${contact ? "Редакция на контакт" : "Нов контакт"}</h3>
      <button id="c-back" class="btn btn-small">← Назад</button>
    </div>
    <div class="cform-grid">
      <label>Категория
        <input list="cat-list" id="cf-category" value="${escapeAttr(c.category || "")}" placeholder="Избери или въведи" />
        <datalist id="cat-list">${cats.map(x => `<option value="${escapeAttr(x)}"></option>`).join("")}</datalist>
      </label>
      <label>Фирма *<input id="cf-company" value="${escapeAttr(c.company || "")}" /></label>
      <label>Лице за контакт<input id="cf-person" value="${escapeAttr(c.contact_person || "")}" /></label>
      <label>Телефон<input id="cf-phone" value="${escapeAttr(c.phone || "")}" /></label>
      <label>Имейл<input id="cf-email" value="${escapeAttr(c.email || "")}" /></label>
      <label>Артикул / релация / страна<input id="cf-scope" value="${escapeAttr(c.scope || "")}" /></label>
      <label>Адрес за доставка<input id="cf-address" value="${escapeAttr(c.delivery_address || "")}" /></label>
      <label>Имейл за фактури<input id="cf-invoice" value="${escapeAttr(c.invoice_email || "")}" /></label>
    </div>
    <label class="cf-check"><input type="checkbox" id="cf-noinc" ${c.no_price_increase ? "checked" : ""} /> Не пускаме увеличение на цената</label>
    <label class="cf-notes">Бележка * (задължително)
      <textarea id="cf-notes" rows="3" placeholder="Условия, начин на заявка, специфики...">${escapeHtml(c.notes || "")}</textarea>
    </label>
    <div class="cform-actions">
      <button id="cf-save" class="btn btn-primary">Запази</button>
      <button id="c-cancel" class="btn">Отказ</button>
    </div>`;
  box.querySelector("#c-back").addEventListener("click", renderContacts);
  box.querySelector("#c-cancel").addEventListener("click", renderContacts);
  box.querySelector("#cf-save").addEventListener("click", () => saveContactForm(contact));
}

async function saveContactForm(contact) {
  if (amWorker()) return;
  const g = id => document.getElementById(id).value.trim();
  const company = g("cf-company");
  const notes = g("cf-notes");
  if (!company) { alert("Полето „Фирма“ е задължително."); return; }
  if (!notes) { alert("Полето „Бележка“ е задължително."); document.getElementById("cf-notes").focus(); return; }
  const c = contact || {};
  c.category = g("cf-category");
  c.company = company;
  c.contact_person = g("cf-person");
  c.phone = g("cf-phone");
  c.email = g("cf-email");
  c.scope = g("cf-scope");
  c.delivery_address = g("cf-address");
  c.invoice_email = g("cf-invoice");
  c.no_price_increase = document.getElementById("cf-noinc").checked ? 1 : 0;
  c.notes = notes;
  await cSaveContact(c);
  renderContacts();
}

/* ---------- Запитване до доставчици ---------- */
function inqDateStr() { try { return new Date().toLocaleDateString("bg-BG"); } catch { return ""; } }

function renderInquiryForm() {
  if (amWorker()) return;
  inqSelected = new Set();
  inqCat = "";
  showContactsSub("inquiry");
  const box = document.getElementById("inquiry-view");
  const withEmail = CONTACTS.filter(c => (c.email || "").includes("@"));
  const nextNo = INQUIRIES.reduce((m, i) => Math.max(m, Number(i.number) || 0), 0) + 1;
  box.innerHTML = `
    <div class="workers-head"><h3>Запитване до доставчици · <span class="muted">Изх. № ${nextNo}</span></h3>
      <button id="inq-back" class="btn btn-small">← Назад</button></div>
    <label class="cf-notes">Тема *<input id="inq-subject" placeholder="напр. Запитване за цена — ламарина 2 мм" /></label>
    <label class="cf-notes">Съдържание на запитването *<textarea id="inq-body" rows="6" placeholder="Опишете какво запитвате — артикул, количества, размери, срок на доставка, условия..."></textarea></label>
    <h4 class="sub">Изберете контакти (${withEmail.length} с имейл) — <span id="inq-cnt">0</span> избрани</h4>
    <div id="inq-cat-bar" class="inq-cat-bar"></div>
    <input type="search" id="inq-filter" placeholder="Търси по фирма / имейл..." />
    <div id="inq-suppliers" class="inq-suppliers"></div>
    <div class="cform-actions">
      <button id="inq-send" class="btn btn-primary">Регистрирай и изпрати имейл</button>
      <button id="inq-cancel" class="btn">Отказ</button>
    </div>`;
  renderInqCatBar();
  renderInqSuppliers("");
  box.querySelector("#inq-back").addEventListener("click", renderContacts);
  box.querySelector("#inq-cancel").addEventListener("click", renderContacts);
  box.querySelector("#inq-filter").addEventListener("input", e => renderInqSuppliers(e.target.value));
  box.querySelector("#inq-send").addEventListener("click", sendInquiry);
}
function renderInqCatBar() {
  const bar = document.getElementById("inq-cat-bar");
  const withEmail = CONTACTS.filter(c => (c.email || "").includes("@"));
  const counts = {}; withEmail.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
  const cats = [...new Set(withEmail.map(c => c.category).filter(Boolean))];
  const groups = { "Доставчици": [], "Клиенти": [], "Други": [] };
  cats.forEach(cat => (groups[catGroup(cat)] || groups["Други"]).push(cat));
  const chip = cat => `<button class="cat-chip ${inqCat === cat ? "active" : ""}" data-cat="${escapeAttr(cat)}" style="background:${catColor(cat)}">${escapeHtml(cat)} (${counts[cat] || 0})</button>`;
  let html = `<div class="cat-allrow"><button class="cat-chip ${inqCat === "" ? "active" : ""}" data-cat="" style="background:#475569">Всички (${withEmail.length})</button></div><div class="cat-groups">`;
  ["Доставчици", "Клиенти", "Други"].forEach(g => { if (groups[g] && groups[g].length) html += `<div class="cat-col"><div class="cat-col-title">${g}</div>${groups[g].map(chip).join("")}</div>`; });
  html += `</div>`;
  bar.innerHTML = html;
  bar.querySelectorAll(".cat-chip").forEach(b => b.addEventListener("click", () => {
    inqCat = b.dataset.cat; renderInqCatBar();
    renderInqSuppliers(document.getElementById("inq-filter").value);
  }));
}
function renderInqSuppliers(term) {
  const cont = document.getElementById("inq-suppliers");
  const t = (term || "").toLowerCase();
  const list = CONTACTS.filter(c => (c.email || "").includes("@"))
    .filter(c => !inqCat || c.category === inqCat)
    .filter(c => !t || `${c.company} ${c.category} ${c.email}`.toLowerCase().includes(t))
    .sort((a, b) => (a.company || "").localeCompare(b.company || "", "bg"));
  cont.innerHTML = list.map(c =>
    `<label class="inq-sup"><input type="checkbox" data-id="${c.id}" ${inqSelected.has(c.id) ? "checked" : ""} />
      <span class="cat-dot" style="background:${catColor(c.category)}"></span>
      <strong>${escapeHtml(c.company)}</strong> <span class="muted">${escapeHtml(c.category || "")} · ${escapeHtml(c.email)}</span></label>`).join("")
    || "<em>Няма доставчици с имейл за този филтър.</em>";
  cont.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener("change", () => {
    if (cb.checked) inqSelected.add(cb.dataset.id); else inqSelected.delete(cb.dataset.id);
    const c = document.getElementById("inq-cnt"); if (c) c.textContent = inqSelected.size;
  }));
}
async function sendInquiry() {
  if (amWorker()) return;
  const subject = document.getElementById("inq-subject").value.trim();
  const body = document.getElementById("inq-body").value.trim();
  if (!subject) { alert("Въведи тема на запитването."); return; }
  if (!body) { alert("Въведи съдържание на запитването."); return; }
  if (!inqSelected.size) { alert("Избери поне един доставчик."); return; }
  const recips = CONTACTS.filter(c => inqSelected.has(c.id)).map(c => ({ company: c.company, email: c.email }));
  const emails = [...new Set(recips.map(r => r.email).filter(Boolean))];
  const number = INQUIRIES.reduce((m, i) => Math.max(m, Number(i.number) || 0), 0) + 1;
  const date = inqDateStr();
  const rec = { kind: "inquiry", number, date, subject, body, recipients: recips, createdAt: new Date().toISOString() };
  const { data, error } = await sb.from("contacts").insert({ data: rec }).select().single();
  if (error) { alert("Грешка при регистриране: " + error.message); return; }
  INQUIRIES.unshift({ ...data.data, id: data.id });
  openMailForInquiry(rec, emails);
  alert(`Регистрирано запитване Изх. № ${number} до ${emails.length} доставчика.\nОтваря се имейл програмата.`);
  renderInquiryRegistry();
}
function openMailForInquiry(rec, emails) {
  const fullBody = `${rec.body}\n\n— — —\nИзх. № ${rec.number} / ${rec.date}\nДанко Системс ООД`;
  window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}` +
    `&subject=${encodeURIComponent("Изх. № " + rec.number + " — " + rec.subject)}` +
    `&body=${encodeURIComponent(fullBody)}`;
}
function renderInquiryRegistry() {
  showContactsSub("inquiry");
  const box = document.getElementById("inquiry-view");
  const list = [...INQUIRIES].sort((a, b) => (b.number || 0) - (a.number || 0));
  box.innerHTML = `
    <div class="workers-head"><h3>Регистър на запитванията</h3>
      <button id="inq-new" class="btn btn-small btn-primary">+ Ново запитване</button>
      <button id="inq-back2" class="btn btn-small">← Към контакти</button></div>
    <table class="report-table"><thead><tr><th>Изх. №</th><th>Дата</th><th>Тема</th><th>Доставчици</th><th></th></tr></thead>
    <tbody>${list.map(i => `<tr>
      <td><strong>${escapeHtml(String(i.number || "—"))}</strong></td>
      <td>${escapeHtml(i.date || "")}</td>
      <td>${escapeHtml(i.subject || "")}</td>
      <td class="c-notes">${(i.recipients || []).map(r => escapeHtml(r.company)).join(", ")}</td>
      <td><button class="btn btn-small inq-resend" data-id="${i.id}">✉ Изпрати пак</button></td>
    </tr>`).join("") || `<tr><td colspan="5" class="report-empty">Няма регистрирани запитвания.</td></tr>`}</tbody></table>`;
  box.querySelector("#inq-new").addEventListener("click", renderInquiryForm);
  box.querySelector("#inq-back2").addEventListener("click", renderContacts);
  box.querySelectorAll(".inq-resend").forEach(b => b.addEventListener("click", () => {
    const inq = INQUIRIES.find(x => x.id === b.dataset.id);
    if (inq) openMailForInquiry(inq, (inq.recipients || []).map(r => r.email).filter(Boolean));
  }));
}

/* ---------- Realtime ---------- */
function cSubscribe() {
  if (contactsSubscribed) return;
  contactsSubscribed = true;
  sb.channel("contacts-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, async () => {
      if (document.getElementById("contacts-modal").hidden) return;
      await cLoad();
      if (!document.getElementById("contacts-view").hidden) renderContacts();
    })
    .subscribe();
}

/* ---------- Инициализация ---------- */
function cInit() {
  const btn = document.getElementById("btn-contacts");
  if (!btn) return;
  btn.addEventListener("click", openContacts);
  document.getElementById("contacts-close").addEventListener("click", () => {
    document.getElementById("contacts-modal").hidden = true;
  });
  document.getElementById("contact-search").addEventListener("input", renderContacts);
  document.getElementById("btn-add-contact").addEventListener("click", () => renderContactForm(null));
  document.getElementById("btn-inquiry").addEventListener("click", renderInquiryForm);
  document.getElementById("btn-inquiry-reg").addEventListener("click", renderInquiryRegistry);
}
document.addEventListener("DOMContentLoaded", cInit);
