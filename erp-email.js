/* Данко Системс — изпращане на имейли от системата (без сървър).
   Отваря готово писмо в Gmail (compose) от служебния адрес; операторът само
   натиска „Изпрати". Ползва се за: заявка до доставчик за материали и
   съобщение до клиент, че поръчката е готова. */

const SYS_EMAIL_FROM = "dankosystems@gmail.com";

// Отваря Gmail „Ново писмо" с попълнени получател/тема/текст (fallback: mailto).
function sysEmailCompose(to, subject, body) {
  const url = "https://mail.google.com/mail/?view=cm&fs=1"
    + "&authuser=" + encodeURIComponent(SYS_EMAIL_FROM)
    + "&to=" + encodeURIComponent(to || "")
    + "&su=" + encodeURIComponent(subject || "")
    + "&body=" + encodeURIComponent(body || "");
  const w = window.open(url, "_blank");
  if (!w) {   // изскачащ прозорец е блокиран → отваряме локалната пощенска програма
    window.location.href = "mailto:" + encodeURIComponent(to || "")
      + "?subject=" + encodeURIComponent(subject || "")
      + "&body=" + encodeURIComponent(body || "");
  }
}

// Намира имейла на партньор по id, после по име.
async function erpPartnerEmail(kind, id, name) {
  try {
    if (id != null) {
      const { data } = await sb.from("partners").select("email,person,name").eq("id", id).maybeSingle();
      if (data) return data;
    }
    if (name) {
      const { data } = await sb.from("partners").select("email,person,name").eq("kind", kind).ilike("name", String(name).trim()).limit(1);
      if (data && data[0]) return data[0];
    }
  } catch (e) { /* без имейл — ще питаме ръчно */ }
  return null;
}

// Съобщение до клиента, че поръчката е готова.
async function erpEmailOrderReady(o) {
  const rec = await erpPartnerEmail("customer", o.clientId, o.clientName);
  const to = prompt("Имейл на клиента:", (rec && rec.email) || "");
  if (to === null) return;
  const person = (rec && rec.person) || "";
  const no = o.ourNo || "";
  const products = (o.lines || [])
    .map(l => `• ${l.name || l.code || ""}${l.qty ? " — " + erpNum(l.qty) + " бр." : ""}`)
    .filter(x => x.trim() !== "•").join("\n");
  const subject = "Поръчка" + (no ? " №" + no : "") + " е готова";
  const body =
`Здравейте${person ? " " + person : ""},

Вашата поръчка${no ? " №" + no : ""}${o.clientNo ? " (Ваш № " + o.clientNo + ")" : ""} е готова за получаване.
${products ? "\n" + products + "\n" : ""}
Моля, свържете се с нас за уговаряне на получаването/транспорта.

Поздрави,
екип Данко Системс`;
  sysEmailCompose(to, subject, body);
}

// Заявка до доставчик за доставка на материали (от покупка-чернова).
async function erpEmailSupplierRequest(o) {
  const items = (o.lines || [])
    .filter(l => l.name || l.code)
    .map(l => `• ${l.code ? l.code + " " : ""}${l.name || ""}${l.qty ? " — " + erpNum(l.qty) + (l.unit ? " " + l.unit : "") : ""}`)
    .join("\n");
  if (!items) { alert("Добави поне един материал в покупката, преди да изпратиш заявка."); return; }
  const rec = await erpPartnerEmail("supplier", o.supplierId, o.supplierName);
  const to = prompt("Имейл на доставчика:", (rec && rec.email) || "");
  if (to === null) return;
  const person = (rec && rec.person) || "";
  const subject = "Заявка за доставка на материали — Данко Системс";
  const body =
`Здравейте${person ? " " + person : ""},

Молим за оферта и доставка на следните материали:

${items}

Моля, потвърдете наличност, единична цена и срок на доставка.

Поздрави,
екип Данко Системс`;
  sysEmailCompose(to, subject, body);
}
