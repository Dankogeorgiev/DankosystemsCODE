/* Данко Системс — Модул „Контакти“
   Контактите се пазят в таблица `contacts` (Supabase). Достъп само за админи. */

let CONTACTS = [];
let contactsLoaded = false;
let contactsSubscribed = false;

const CONTACT_CATEGORIES = [
  "Клиент – вътрешен пазар", "Клиент – външен пазар", "Клиент – външен пазар (HOMAG)",
  "Транспорт / логистика", "Услуги / други",
  "Доставчик – опаковки", "Доставчик – кашони", "Доставчик – други",
];

/* ---------- Зареждане / запис ---------- */
async function cLoad() {
  const { data, error } = await sb.from("contacts").select("*").order("updated_at", { ascending: false });
  if (error) { alert("Грешка при зареждане на контактите: " + error.message); return; }
  CONTACTS = (data || []).map(r => ({ ...r.data, id: r.id }));
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
  renderCatFilter();
  renderContacts();
}
function showContactsSub(which) {
  document.getElementById("contacts-view").hidden = which !== "list";
  document.getElementById("contact-form").hidden = which !== "form";
}

function allCategories() {
  const set = new Set(CONTACT_CATEGORIES);
  CONTACTS.forEach(c => { if (c.category) set.add(c.category); });
  return [...set];
}
function renderCatFilter() {
  const sel = document.getElementById("contact-cat");
  const cur = sel.value;
  const counts = {};
  CONTACTS.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
  sel.innerHTML = `<option value="">Всички категории (${CONTACTS.length})</option>` +
    allCategories().map(cat => `<option value="${escapeAttr(cat)}">${escapeHtml(cat)} (${counts[cat] || 0})</option>`).join("");
  sel.value = cur;
}

/* ---------- Списък ---------- */
function renderContacts() {
  showContactsSub("list");
  const tbody = document.getElementById("contacts-body");
  const cat = document.getElementById("contact-cat").value;
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
      <td><span class="cat-badge">${escapeHtml(c.category) || "—"}</span></td>
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
  renderCatFilter();
  renderContacts();
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
  document.getElementById("contact-cat").addEventListener("change", renderContacts);
  document.getElementById("contact-search").addEventListener("input", renderContacts);
  document.getElementById("btn-add-contact").addEventListener("click", () => renderContactForm(null));
}
document.addEventListener("DOMContentLoaded", cInit);
