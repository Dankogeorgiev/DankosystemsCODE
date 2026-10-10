/* Данко Системс — 👣 Дневник на действията.
   Закача се ЦЕНТРАЛНО върху Supabase клиента (sb.from) и отбелязва всеки
   запис/промяна/изтриване: време, потребител, таблица, обект. Така "кой какво
   е свършил" се събира само̀, без да пипаме всеки модул поотделно.
   Пази се по ред НА ПОТРЕБИТЕЛ НА ДЕН (app_config id = act_<ден>_<имейл>) —
   един пишещ на ред, без състезания. Гледа се в Пулс → 👣 Активност. */

let ACT_BUF = [], ACT_LIST = [], ACT_LOADED = null, ACT_TIMER = null;

function actWho() { return ((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "").toLowerCase(); }
function actRowId() { return "act_" + new Date().toISOString().slice(0, 10) + "_" + actWho().replace(/[^a-z0-9]+/g, "_"); }

function actPush(table, op, args) {
  if (!actWho()) return;
  let id = "";
  try {
    const x = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (x && typeof x === "object" && x.id != null) id = String(x.id);
  } catch (e) {}
  if (table === "app_config" && /^act_/.test(id)) return;   // самият дневник не се логва
  ACT_BUF.push({ t: new Date().toTimeString().slice(0, 8), tb: table, op, id });
  if (!ACT_TIMER) ACT_TIMER = setTimeout(actFlush, 15000);
}

async function actFlush() {
  ACT_TIMER = null;
  if (!ACT_BUF.length || typeof sb === "undefined" || !sb) return;
  const rowId = actRowId();
  try {
    if (ACT_LOADED !== rowId) {
      const { data } = await sb.from("app_config").select("data").eq("id", rowId).maybeSingle();
      ACT_LIST = (data && data.data && data.data.list) || [];
      ACT_LOADED = rowId;
    }
    ACT_LIST = ACT_LIST.concat(ACT_BUF.splice(0));
    if (ACT_LIST.length > 4000) ACT_LIST = ACT_LIST.slice(-4000);
    await sb.from("app_config").upsert({
      id: rowId,
      data: { list: ACT_LIST, email: actWho(), day: new Date().toISOString().slice(0, 10) },
      updated_at: new Date().toISOString(),
    });
  } catch (e) { /* дневникът никога не пречи на работата */ }
}

/* Обвивката: чака sb да се създаде (app.js го прави след зареждане) и
   подменя sb.from така, че insert/upsert/update/delete първо се отбелязват. */
(function actWrap() {
  const tryWrap = () => {
    if (typeof sb === "undefined" || !sb || sb.__act) return false;
    const orig = sb.from.bind(sb);
    sb.from = function (table) {
      const q = orig(table);
      ["insert", "upsert", "update", "delete"].forEach(m => {
        if (typeof q[m] !== "function") return;
        const o = q[m].bind(q);
        q[m] = function (...a) { try { actPush(table, m, a); } catch (e) {} return o(...a); };
      });
      return q;
    };
    sb.__act = true;
    return true;
  };
  const iv = setInterval(() => { if (tryWrap()) clearInterval(iv); }, 800);
  window.addEventListener("beforeunload", () => { try { actFlush(); } catch (e) {} });
})();

/* ---------- Човешки имена на действията ---------- */
const ACT_TABLE_BG = {
  invoices: "Фактуриране", purchases: "Покупки", sales: "Продажби",
  customer_orders: "Заявки от клиенти", tasks: "Цехове / задачи",
  products: "Продукти", materials: "Материали", recipes: "Рецепти",
  operations: "Операции", contacts: "Контакти", packing_archive: "Палетни описи",
};
const ACT_CFG_BG = [
  [/^payroll_osig/, "Заплати · осигуровки"], [/^payroll/, "Заплати"],
  [/^pricelist/, "Ценови листи"], [/^cut_saved/, "Запазени разкрои"],
  [/^todo|^danko_todo/, "To do"], [/^receivables/, "Вземания"], [/^payables/, "Задължения"],
  [/^pulse/, "Пулс"], [/^roles/, "Достъпи"], [/^cost/, "Разходи и ставки"],
  [/^pal_/, "Палетни описи"], [/^cal_|^calendar/, "Календар"], [/^leaves/, "Отпуски"],
  [/^matreq|^inquir/, "Заявки за материали"], [/^rfq/, "Регистър RFQ"],
  [/^client_profile|^supplier_profile|^partner/, "Клиенти/Доставчици"],
];
function actLabel(e) {
  if (e.tb !== "app_config") return ACT_TABLE_BG[e.tb] || e.tb;
  for (const [re, l] of ACT_CFG_BG) if (re.test(e.id || "")) return l;
  return "Настройки";
}
const ACT_NAMES = {
  "dankog@gmail.com": "Данко", "grigor.baykov@dankosystems.com": "Григор",
  "office@dankosystems.com": "Кристина", "danko.orders@gmail.com": "Юлия",
};
function actName(email) {
  if (ACT_NAMES[email]) return ACT_NAMES[email];
  const m = String(email || "").match(/^([^@]+)@danko\.local$/i);
  return m ? m[1] + " (цех)" : email;
}
