/* Данко Системс — „ЗАНИТВАНЕ" (сглобяване). Като ЦЕХ РОГОШ, но с два слоя:
   14 механизма → операции. Служителят избира механизъм, вижда операциите и
   записва брой. БРОЯТ НИТОВЕ е скрит от служителя — ползва се само в отчета
   (колко и какви механизми е сглобявал + колко нита е занитил).
   Данните: app_config id="nit_reports":
     { records: { "<служител>|<дата>": { worker, date, ops:{ "<операция>": qty }, at } } }
   Ползва глобалния sb и amWorker/escapeHtml/escapeAttr. */

const NIT_WORKERS = ["Богдана Камжалова", "Нели Кехайова", "Валентин Мирчев", "Мария Костова", "Иван Мералов", "ТЕСТОВ"];

// Механизми → операции. r = брой нитове (скрит), t = вид нит.
const NIT_MECHANISMS = [
  { name: "ИТАЛИЯ", ops: [
    { n: "Италия 2ка 3ка", r: 2, t: "обикн" },
    { n: "Италия 2ка 3ка и Нож", r: 5, t: "обикн" },   // 3× нит 8х12 + 2× нит 8х10 (по рецептата)
    { n: "Италия само нож", r: 1, t: "обикн" },
    { n: "Италия нож на готова заготовка", r: 2, t: "обикн" },   // готова заготовка + готов нож → механизъм
    { n: "Италия затваряне на крак", r: 2, t: "големи" },
    { n: "Крак колела", r: 1, t: "колела" },
  ] },
  { name: "ПОТАПЯЩ", ops: [
    { n: "Потапящ заготовка", r: 2, t: "обикн" },
    { n: "Потапящ затваряне", r: 2, t: "обикн" },
    { n: "Потапящ цял", r: 4, t: "обикн" },
  ] },
  { name: "Малък бял", ops: [
    { n: "Малък бял заготовка", r: 2, t: "обикн" },
    { n: "Малък бял затваряне", r: 2, t: "обикн" },
    { n: "Малък бял цял", r: 4, t: "обикн" },
  ] },
  { name: "МПК", ops: [
    { n: "МПК заготовка", r: 2, t: "обикн" },
    { n: "МПК затваряне с крак", r: 2, t: "обикн" },
    { n: "МПК колело на крак", r: 1, t: "колела" },
  ] },
  { name: "КОЛЕЛА", ops: [
    { n: "Колело ос+колело", r: 1, t: "колела" },
  ] },
  { name: "МАРКО", ops: [
    { n: "Марко пишльок", r: 1, t: "ос" },
    { n: "Марко заготовка", r: 2, t: "обикн" },
    { n: "Марко затваряне", r: 2, t: "обикн" },
  ] },
  { name: "45 градуса", ops: [
    { n: "45 градуса заготовка", r: 2, t: "обикн" },
    { n: "45 градуса затваряне", r: 2, t: "обикн" },
    { n: "45 градуса цял", r: 4, t: "обикн" },
  ] },
  { name: "ШИКОЗЕН 45 градуса", ops: [
    { n: "Шикозен 45 заготовка", r: 2, t: "обикн" },
    { n: "Шикозен 45 затваряне", r: 2, t: "обикн" },
    { n: "Шикозен 45 цял", r: 4, t: "обикн" },
  ] },
  { name: "45 градуса ГОЛЯМ БЯЛ", ops: [
    { n: "45 градуса Г.Б. заготовка", r: 2, t: "обикн" },
    { n: "45 градуса Г.Б. затваряне", r: 2, t: "обикн" },
    { n: "45 градуса Г.Б. цял", r: 4, t: "обикн" },
  ] },
  { name: "НИКОЛЕТИ", ops: [
    { n: "Николети 2ка 3ка", r: 2, t: "обикн" },
    { n: "Николети нож на заготовка", r: 2, t: "обикн" },
    { n: "Николети 2ка 3ка и нож", r: 4, t: "обикн" },
    { n: "Николети само нож", r: 2, t: "обикн" },
  ] },
  { name: "ММ03", ops: [
    { n: "ММ03 заготовка", r: 2, t: "обикн" },
    { n: "ММ03 затваряне", r: 2, t: "обикн" },
    { n: "ММ03 цял", r: 4, t: "обикн" },
  ] },
  { name: "ММ04", ops: [
    { n: "ММ04 заготовка", r: 6, t: "обикн" },    // 5× нит 8х12 + 1× нит 8х26
    { n: "ММ04 затваряне", r: 1, t: "обикн" },
    { n: "ММ04 цял", r: 7, t: "обикн" },
  ] },
  { name: "ЛАЗ. РЯЗАНЕ", ops: [
    { n: "Лаз.ряз осичка б", r: 1, t: "ос" },
    { n: "Лаз.ряз 2 нит", r: 2, t: "обикн" },
    { n: "Лаз.ряз 3 нит", r: 3, t: "обикн" },
    { n: "Лаз.ряз 4 нит", r: 4, t: "обикн" },
  ] },
  { name: "ЗАНИТВАНЕ", ops: [
    { n: "Занитване 1 нит", r: 1, t: "обикн" },
    { n: "Занитване 2 нита", r: 2, t: "обикн" },
  ] },
];
// Индекс: име на операция → { mech, r, t }
const NIT_OP_INDEX = (() => { const m = {}; NIT_MECHANISMS.forEach(me => me.ops.forEach(o => { m[o.n] = { mech: me.name, r: o.r, t: o.t }; })); return m; })();
const NIT_RIVET_TYPES = [["обикн", "обикновени"], ["големи", "големи"], ["колела", "колела"], ["ос", "ос"]];

/* Ляв / Десен: новите записи пазят {l, d} за операция; старите са число (без
   страна — брои се като десен). Общите категории (на парче) са без Л/Д. */
const NIT_NO_LD = new Set(["ЛАЗ. РЯЗАНЕ", "ЗАНИТВАНЕ"]);
function nitOpTotal(v) { return (v && typeof v === "object") ? (nitNum(v.l) + nitNum(v.d)) : nitNum(v); }
function nitOpLD(v) { return (v && typeof v === "object") ? { l: nitNum(v.l), d: nitNum(v.d) } : { l: 0, d: nitNum(v) }; }

/* ---------- Операции с ИЗБОР НА ИЗДЕЛИЕ ----------
   Един и същ възел влиза в много крайни механизми (напр. 100949/100950 →
   над 20 механизма). При такава операция служителят първо ИЗБИРА изделието
   от падащ списък, после пише бройките Л/Д. Записът се пази с ключ
   „операция¦код" (напр. Италия затваряне на крак¦101124), затова всяко
   изделие си има собствена бройка и собствена складова история.
   Списъкът идва от справката „Къде се влага" на възела (ЕРП → Продукти). */
const NIT_OP_PRODUCTS = {
  "Италия затваряне на крак": {
    from: "заготовка 100949",
    single: true,   // страната (ляв/десен) е В САМОТО изделие → едно поле за брой
    list: [
      ["101008", "Механизъм Asia - ляв"],
      ["101010", "Механизъм BG M19 - ляв"],
      ["101018", "Механизъм MECCANICA BLG ART.E-WHEEL(BG-M20)DA - ляв"],
      ["101020", "Механизъм MECCANICA BLG H.130 - ляв"],
      ["101022", "Механизъм MECCANICA BLG H.183 - ляв"],
      ["102496", "Механизъм MECCANICA BLG H.140 - десен"],
      ["102457", "Механизъм MECC.BLG NEW-MAX 2 - ляв"],
      ["103098", "Механизъм MECC.BLG NEW-MAX 2 WHE NEW PLATE rev.2 - ляв"],
      ["101024", "Механизъм New Maxi Blg - ляв"],
      ["101876", "Механизъм Vincent - ляв"],
      ["101034", "Механизъм Италия 9.5 - ляв"],
      ["101028", "Механизъм Италия 10 - ляв"],
      ["101026", "Механизъм Италия 10 BG M34 - ляв"],
      ["101030", "Механизъм Италия 11.5 - ляв"],
      ["101032", "Механизъм Италия 2.11 - ляв"],
      ["102204", "Механизъм Италия Начеви - 1 - ляв"],
      ["101040", "Механизъм Италия Начеви - 2 сваляемо колело - ляв"],
      ["101042", "Механизъм Италия Начеви 3 - ляв"],
      ["102250", "Механизъм Италия Начеви H130 - ляв"],
      ["102833", "Механизъм Италия Начеви Mobicord - ляв"],
      ["102627", "Механизъм Италия Сияна - ляв"],
      ["101038", "Механизъм Италия Станков - ляв"],
      ["101043", "Механизъм Италия-Румъния - десен"],
    ],
  },
};
// Ключ на запис: „операция" или „операция¦код на изделие".
function nitOpBase(key) { return String(key || "").split("¦")[0]; }
function nitOpPick(key) { const p = String(key || "").split("¦"); return p.length > 1 ? p[1] : ""; }
// Сборът за една операция в един запис (по всички избрани изделия).
function nitOpSum(rec, opName) {
  let s = 0;
  Object.keys((rec && rec.ops) || {}).forEach(k => { if (nitOpBase(k) === opName) s += nitOpTotal(rec.ops[k]); });
  return s;
}

/* ---------- Връзка със Склад детайли ----------
   Операциите с наш код се ЗАПРИХОДЯВАТ в Склад детайли при запис на отчета.
   Синхронизира се по разликата (rec.stocked пази вече заприходеното за
   служител+ден+операция) — редакция на бройката прави корекция в склада.
   Засега: механизъм ИТАЛИЯ. Добавяне на нов ред тук = нова връзка. */
/* ⚠ ВАЖНО при промяна: МАХАНЕТО на код от NIT_STOCK_MAP/NIT_COMBINE го изважда
   от предпазителя erpNitManagedCode (erp-orders.js) — поточните задачи за него
   пак почват да пипат склада, а src.stocked им е стоял замразен, така че
   първият отчет в Цехове би заприходил НАВЕДНЪЖ цялата натрупана бройка
   (двойно върху нит-записите). Преди да махнеш код оттук, кажи на Клод да
   изравни src.stocked/consumedUnits на задачите му. */
const NIT_STOCK_MAP = {
  //                             десен код   ляв код
  "Италия 2ка 3ка":            { d: "101116", l: "101117" },
  "Италия само нож":           { d: "101114", l: "101115" },
  "Италия 2ка 3ка и Нож":      { d: "100949", l: "100950" },   // всичко наведнъж → готов механизъм
  "Италия нож на готова заготовка": { d: "100949", l: "100950" },   // готови половини → готов механизъм
  "Малък бял заготовка":       { d: "100937", l: "100938" },
  "Малък бял затваряне":       { d: "101002", l: "101001" },
  "Малък бял цял":             { d: "101002", l: "101001" },   // същият резултат като „затваряне"
  "ММ04 заготовка":            { d: "101864", l: "101865" },
  "ММ04 затваряне":            { d: "101866", l: "101867" },
  "ММ04 цял":                  { d: "101866", l: "101867" },   // наведнъж, без етап заготовка
};

/* Стари имена на операции → новите (преименуване на механизъм). Пази
   историческите бройки в справките под новото име. */
const NIT_OP_RENAME = {
  "ММ02 заготовка": "ММ04 заготовка",
  "ММ02 затваряне": "ММ04 затваряне",
  "ММ02 цял": "ММ04 цял",
};
/* Консумация: какво ВЛАГА всяка операция за 1 брой (по рецептата на 101102).
   { code } = общ детайл (еднакъв за Л и Д); { side: {d, l} } = по страна;
   mat: true = материал от Склад материали (нитове, шайби); per = брой за 1.
   Изписва се огледално на делтата — корекция с минус връща вложеното. */
const NIT_CONSUME = {
  // ИТАЛИЯ — по рецептите на 101116/101117, 101114/101115 и 100949/100950
  // (частите са еднакви кодове за лява и дясна страна).
  "Италия 2ка 3ка": [
    { code: "100475", per: 1 },              // Двойка
    { code: "100652", per: 1 },              // Тройка
    { code: "100450", per: 1 },              // Винкел Италия
    { code: "100169", per: 2, mat: true },   // Нит 8 х 10
    { code: "100188", per: 2, mat: true },   // Подложна шайба DIN 125 АМ 8
  ],
  "Италия само нож": [
    { code: "100524", per: 1 },              // Нож
    { code: "100493", per: 1 },              // Единичка
    { code: "100641", per: 1 },              // Спирачка нож
    { code: "100170", per: 1, mat: true },   // Нит 8 х 12
    { code: "100188", per: 1, mat: true },   // Подложна шайба DIN 125 АМ 8
  ],
  "Италия 2ка 3ка и Нож": [
    { code: "100475", per: 1 }, { code: "100652", per: 1 }, { code: "100450", per: 1 },
    { code: "100524", per: 1 }, { code: "100493", per: 1 }, { code: "100641", per: 1 },
    { code: "100170", per: 3, mat: true },   // Нит 8 х 12
    { code: "100169", per: 2, mat: true },   // Нит 8 х 10
    { code: "100188", per: 5, mat: true },   // Подложна шайба DIN 125 АМ 8
  ],
  // Нож върху ГОТОВА заготовка: влага двете готови половини по страната
  // (не суровите части — те са изписани при правенето на половините).
  "Италия нож на готова заготовка": [
    { side: { d: "101116", l: "101117" }, per: 1 },   // готова заготовка 2ка 3ка
    { side: { d: "101114", l: "101115" }, per: 1 },   // готов нитован нож
    { code: "100170", per: 2, mat: true },   // Нит 8 х 12
    { code: "100188", per: 2, mat: true },   // Подложна шайба DIN 125 АМ 8
  ],
  "Малък бял заготовка": [
    { code: "100512", per: 1 },              // Късо малък бял
    { code: "100485", per: 1 },              // Дълго малък бял
    { code: "100453", per: 1 },              // Винкел малък бял
    { code: "100898", per: 1 },              // Ухо малък бял
    { code: "100168", per: 1, mat: true },   // Нит 6 х 12
  ],
  "Малък бял затваряне": [
    { side: { d: "100937", l: "100938" }, per: 1 },   // заготовката (същата страна)
    { code: "100502", per: 1 },              // Криво малък бял
    { code: "100167", per: 3, mat: true },   // Нит 6 х 10
    { code: "100187", per: 2, mat: true },   // Подложна шайба DIN 125 АМ 6
  ],
  "Малък бял цял": [
    { code: "100512", per: 1 }, { code: "100485", per: 1 },
    { code: "100453", per: 1 }, { code: "100898", per: 1 },
    { code: "100502", per: 1 },
    { code: "100168", per: 1, mat: true },
    { code: "100167", per: 3, mat: true },
    { code: "100187", per: 2, mat: true },
  ],
  // ММ04 (Потапящ малък) — по рецептите на 101864/101865, 101866/101867, 101157
  "ММ04 заготовка": [
    { code: "100461", per: 1 },              // Винкел потапящ малък
    { code: "100514", per: 1 },              // Късо ММ03
    { code: "100488", per: 1 },              // Дълго ММ04
    { code: "100170", per: 5, mat: true },   // Нит 8 х 12
    { code: "100188", per: 7, mat: true },   // Подложна шайба DIN 125 АМ 8
    { code: "100175", per: 1, mat: true },   // Нит 8 х 26
  ],
  "ММ04 затваряне": [
    { side: { d: "101864", l: "101865" }, per: 1 },   // заготовката (същата страна)
    { code: "100644", per: 1 },              // Стик - ММ04
    { code: "100170", per: 1, mat: true },
    { code: "100188", per: 1, mat: true },
  ],
  "ММ04 цял": [
    { code: "100461", per: 1 }, { code: "100514", per: 1 }, { code: "100488", per: 1 },
    { code: "100644", per: 1 },
    { code: "100170", per: 6, mat: true },   // 5 (заготовка) + 1 (затваряне)
    { code: "100188", per: 8, mat: true },   // 7 + 1
    { code: "100175", per: 1, mat: true },
  ],
};

/* Авто-сглобяване: щом в склада има И от двете половини, Системата ги
   „сглобява" — изписва по-малкото от двете и заприходява същия брой готови.
   Пример: 101117 (2ка3ка ляв) 100 бр + 101115 (нож ляв) 100 бр →
   −100/−100 и +100 бр 100950 (Италия цял ляв). Пуска се след всеки отчет. */
const NIT_COMBINE = [
  // Италия НЯМА авто-сглобяване (по изрично решение): съединяването на заготовка
  // и нож се отчита само като „Италия 2ка 3ка и Нож" — иначе системата
  // сглобяваше „на хартия" преди жените реално да са сложили ножа.
  { a: "101002", b: "101001", to: "101102", label: "Малък бял к-т (десен + ляв)", extra: [{ code: "100622", per: 2 }] },   // + 2 пружини L=90
  // ММ04: десен + ляв → цял механизъм 101157 + 2 огънати и 2 прави спирачки
  { a: "101866", b: "101867", to: "101157", label: "Потапящ малък ММ04 (десен + ляв)", extra: [{ code: "100638", per: 2 }, { code: "100639", per: 2 }] },
];
async function nitCombineStock() {
  const ids = await nitStockIds();
  // Бройки, РЕЗЕРВИРАНИ от пуснати заявки (кръстосано нетване) — не се комбинират:
  // те са обещани на заявка, която ще ги вложи при своето сглобяване.
  const reserved = {};
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
    const byOrder = (data && data.data && data.data.byOrder) || {};
    Object.values(byOrder).forEach(per => Object.keys(per || {}).forEach(pid => {
      reserved[pid] = (reserved[pid] || 0) + (Number(per[pid]) || 0);
    }));
  } catch (e) { /* без резервации при грешка */ }
  for (const c of NIT_COMBINE) {
    const ia = ids[c.a], ib = ids[c.b], it = ids[c.to];
    if (!ia || !ib || !it) continue;
    let stA = 0, stB = 0;
    try {
      const { data, error } = await sb.from("v_product_stock").select("id,stock").in("id", [ia, ib]);
      if (error) continue;
      (data || []).forEach(r => { if (r.id === ia) stA = Number(r.stock) || 0; if (r.id === ib) stB = Number(r.stock) || 0; });
    } catch (e) { continue; }
    stA = Math.max(0, stA - (reserved[ia] || 0));
    stB = Math.max(0, stB - (reserved[ib] || 0));
    const q = Math.floor(Math.min(stA, stB));
    if (!(q > 0)) continue;
    const note = `Авто-сглобяване: ${c.a} + ${c.b} → ${c.to} (${c.label})`;
    const ref = "нит-сглоб:" + new Date().toISOString();
    try {
      const rows = [
        { product_id: ia, kind: "изписване", quantity: -q, ref, note },
        { product_id: ib, kind: "изписване", quantity: -q, ref, note },
        { product_id: it, kind: "заприходяване", quantity: q, ref, note },
      ];
      (c.extra || []).forEach(x => {
        const xp = ids[x.code];
        if (xp) rows.push({ product_id: xp, kind: "изписване", quantity: -q * (Number(x.per) || 1), ref, note: note + " · влага " + x.code });
      });
      await sb.from("product_movements").insert(rows);
    } catch (e) { /* при грешка ще се сглоби при следващия отчет */ }
  }
}

let NIT_PID = null;   // код → product_id (кешира се само при УСПЕШНО зареждане)
async function nitStockIds() {
  if (NIT_PID) return NIT_PID;
  const out = {};
  try {
    const codes = [...new Set([
      ...Object.values(NIT_STOCK_MAP).flatMap(m => [m.l, m.d]),
      ...NIT_COMBINE.flatMap(c => [c.a, c.b, c.to]),
      ...Object.values(NIT_CONSUME).flat().flatMap(it => it.mat ? [] : (it.side ? [it.side.l, it.side.d] : [it.code])),
      ...NIT_COMBINE.flatMap(c => (c.extra || []).map(x => x.code)),
    ].filter(Boolean))];
    const { data, error } = await sb.from("products").select("id,code").in("code", codes);
    if (error) throw error;
    (data || []).forEach(p => { out[String(p.code).trim()] = p.id; });
    NIT_PID = out;   // кеш само при успех — при мрежова грешка ще опита пак
  } catch (e) { /* без кеш — следващият запис ще опита наново */ }
  return out;
}
let NIT_MID = null;   // код на материал → material_id (нитове, шайби)
async function nitMatIds() {
  if (NIT_MID) return NIT_MID;
  const out = {};
  try {
    const codes = [...new Set(Object.values(NIT_CONSUME).flat().filter(it => it.mat).map(it => it.code))];
    if (!codes.length) { NIT_MID = out; return out; }
    const { data, error } = await sb.from("materials").select("id,code").in("code", codes);
    if (error) throw error;
    (data || []).forEach(m => { out[String(m.code).trim()] = m.id; });
    NIT_MID = out;
  } catch (e) { /* следващият запис ще опита пак */ }
  return out;
}

async function nitSyncStock(rec) {
  const ids = await nitStockIds();
  const mids = await nitMatIds();
  const matMoves = [];
  rec.stocked = rec.stocked || {};
  const moves = [], applied = [], missing = [];
  Object.entries(NIT_STOCK_MAP).forEach(([op, m]) => {
    const ld = nitOpLD((rec.ops || {})[op]);
    [["l", "Л", "ляв"], ["d", "Д", "десен"]].forEach(([sk, tag, word]) => {
      const code = m[sk]; if (!code) return;
      const pid = ids[code];
      if (!pid) { if (ld[sk] > 0) missing.push(code + " (" + op + " · " + word + ")"); return; }
      const key = op + "¦" + tag;
      // съвместимост: старият формат пазеше stocked[op] без страна (= десен)
      const done = rec.stocked[key] != null ? Number(rec.stocked[key]) || 0
        : (sk === "d" ? Number(rec.stocked[op]) || 0 : 0);
      const now = ld[sk];
      const delta = now - done;
      if (!delta) {
        if (rec.stocked[key] == null && sk === "d" && rec.stocked[op] != null) { rec.stocked[key] = done; delete rec.stocked[op]; }
        return;
      }
      moves.push({
        product_id: pid, kind: "заприходяване", quantity: delta,
        ref: `нит:${rec.worker}|${rec.date}|${op}|${tag}`,
        note: `Занитване · ${rec.worker} · ${op} (${word})` + (delta < 0 ? " · корекция" : ""),
      });
      // Операцията ВЛАГА съставките си (детайли и материали) — огледално на делтата.
      (NIT_CONSUME[op] || []).forEach(item => {
        const ccode = item.side ? item.side[sk] : item.code;
        if (!ccode) return;
        const q = delta * (Number(item.per) || 1);
        const cref = `нит:${rec.worker}|${rec.date}|${op}|${tag}`;
        const cnote = `Занитване · ${rec.worker} · ${op} (${word}) — влага ${ccode}` + (delta < 0 ? " · корекция" : "");
        if (item.mat) {
          const mid = mids[ccode];
          if (mid) matMoves.push({ material_id: mid, kind: "изписване", quantity: -q, ref: cref, note: cnote, created_by: rec.worker || null });
          else if (delta > 0) missing.push(ccode + " (материал при " + op + ")");
        } else {
          const cpid = ids[ccode];
          if (cpid) moves.push({ product_id: cpid, kind: "изписване", quantity: -q, ref: cref, note: cnote });
          else if (delta > 0) missing.push(ccode + " (влагане при " + op + " · " + word + ")");
        }
      });
      applied.push({ key, now, op, sk, code, delta });
    });
  });
  if (missing.length) alert("⚠ СКЛАДЪТ не бе обновен за: " + missing.join(", ") + "\n\nТези кодове не се намират в Продукти (или няма връзка с базата). Отчетът се записва нормално.");
  if (!moves.length && !matMoves.length) return true;
  if (moves.length) {
    const { error } = await sb.from("product_movements").insert(moves);
    if (error) { alert("Отчетът ще се запише, но СКЛАДЪТ не се обнови: " + error.message + "\n\nПокажи това съобщение на Данко."); return false; }
  }
  if (matMoves.length) {
    const r2 = await sb.from("stock_movements").insert(matMoves);
    if (r2.error) alert("Детайлите са отчетени, но МАТЕРИАЛИТЕ (нитове/шайби) не се изписаха: " + r2.error.message);
  }
  applied.forEach(a => { rec.stocked[a.key] = a.now; if (a.sk === "d") delete rec.stocked[a.op]; });
  // Вариант Б: отчетът движи и ПРОГРЕСА на заявките (поточните задачи в цех
  // Занитване за същия код) — само produced/готово, без складови движения
  // (складът за тези кодове се води единствено тук; потокът ги прескача —
  // виж erpNitManagedCode в erp-orders.js).
  try { await nitCreditFlow(applied, rec.worker); } catch (e) { console.warn("нит→поток:", e); }
  return true;
}

/* Отчетът в Занитване бута напред поточните задачи „Занитване" за същия код:
   прогрес до поръчаното (излишъкът е складов, не прогресен), минус-корекция
   смъква прогреса (не под 0). Така заявката върви без Мастер отчитане, а
   гейтовете на следващите операции виждат готовите бройки веднага. */
async function nitCreditFlow(applied, worker) {
  const byCode = {};
  (applied || []).forEach(a => { if (a && a.code && a.delta) byCode[a.code] = (byCode[a.code] || 0) + a.delta; });
  const codes = Object.keys(byCode);
  if (!codes.length) return;
  let rows = [];
  try {
    // Странициране (Supabase връща макс. 1000 наведнъж) — през erpSelectAll,
    // ако е зареден; иначе ръчно.
    if (typeof erpSelectAll === "function") {
      const { data, error } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
      if (error) throw error;
      rows = data || [];
    } else {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("tasks").select("id,data")
          .eq("data->source->>flow", "true").order("id", { ascending: true }).range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
    }
  } catch (e) { console.warn("нит→поток: четене", e); return; }
  for (const code of codes) {
    let delta = byCode[code];
    const tasks = rows
      .map(r => ({ id: r.id, d: r.data }))
      .filter(x => x.d && x.d.source && x.d.source.kind === "series" && x.d.source.flow
        && x.d.workshop === "Занитване" && String(x.d.code).trim() === String(code).trim())
      .sort((a, b) => (Number(a.d.source.step) || 0) - (Number(b.d.source.step) || 0));
    for (let i = 0; i < tasks.length && delta; i++) {
      const x = tasks[i], q = Number(x.d.qty) || 0, p = Number(x.d.produced) || 0;
      // Плюс: пълним до поръчаното; ИЗЛИШЪКЪТ отива на последната задача (позволен
      // е и в Цехове — свръхпроизводството е складово). Минус: смъква, не под 0.
      const last = i === tasks.length - 1;
      const add = delta > 0
        ? (last ? delta : Math.min(Math.max(0, q - p), delta))
        : Math.max(delta, -p);
      if (!add) continue;
      x.d.produced = Math.max(0, p + add);
      x.d.logs = Array.isArray(x.d.logs) ? x.d.logs : [];
      x.d.logs.push({ date: nitToday(), worker: worker || "Занитване", qty: add, note: "отчет Занитване (авто)" });
      const done = q > 0 && x.d.produced >= q;
      const { error } = await sb.from("tasks").update({ data: x.d, done, updated_at: new Date().toISOString() }).eq("id", x.id);
      // При отказан запис НЕ прехвърляме бройката към друга серия (би излъгала
      // чужда заявка) — оставяме я; Мастер отчитане ще навакса прогреса.
      if (error) { console.warn("нит→поток: запис", error); break; }
      delta -= add;
    }
  }
}

let NIT = { records: {} };
let NIT_LOADED = false;
let nitWorker = "", nitDate = "", nitMech = null, nitView = "entry", nitPeriod = "week";

function nitToday() { return new Date().toISOString().slice(0, 10); }
function nitKey(w, d) { return w + "|" + d; }
function nitNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isNaN(n) ? 0 : n; }
function nitFmtDate(s) { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; }
function nitNowHM() { const d = new Date(); const p = n => String(n).padStart(2, "0"); return p(d.getHours()) + ":" + p(d.getMinutes()); }

async function nitLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "nit_reports").maybeSingle(); NIT = (data && data.data && typeof data.data === "object") ? data.data : { records: {} }; NIT.records = NIT.records || {}; }
  catch (e) { NIT = { records: {} }; }
}
async function nitSave() {
  const { error } = await sb.from("app_config").upsert({ id: "nit_reports", data: NIT, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

async function openNit() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("nit-modal").hidden = false;
  const isW = nitIsWorker();
  const lo = document.getElementById("nit-logout"); if (lo) lo.hidden = !isW;
  const cl = document.getElementById("nit-close"); if (cl) cl.hidden = isW;
  const h = document.querySelector("#nit-modal .mini-head h3");
  if (h) h.textContent = isW ? "🔩 ЗАНИТВАНЕ — дневен запис" : "🔩 ЗАНИТВАНЕ — сглобяване (отчет)";
  // Винаги свежи данни при отваряне — вторa отворена сесия (офис + таблет)
  // иначе презаписваше чуждите записи със стар кеш (last-writer-wins).
  await nitLoad(); NIT_LOADED = true;
  if (!nitDate) nitDate = nitToday();
  nitRender();
}
function closeNit() { document.getElementById("nit-modal").hidden = true; }
function nitIsWorker() { return (typeof amWorker === "function") && amWorker(); }

function nitRender() {
  const v = document.getElementById("nit-view"); if (!v) return;
  if (nitIsWorker() && !nitWorker) { nitRenderPicker(v); return; }
  if (nitView === "summary" && !nitIsWorker()) { nitRenderSummary(v); return; }
  if (nitMech != null) { nitRenderOps(v); return; }
  nitRenderMechanisms(v);
}

/* „Кой си ти" */
function nitRenderPicker(v) {
  v.innerHTML = `
    <div class="rog-picker">
      <h3>Здравей, аз съм Системата!<br>Кой си ти?</h3>
      <div class="rog-picker-list">
        ${NIT_WORKERS.map(n => `<button class="rog-id-btn" data-w="${escapeAttr(n)}"><span class="rog-av">${escapeHtml((n.trim()[0] || "?").toUpperCase())}</span>${escapeHtml(n)}</button>`).join("")}
      </div>
    </div>`;
  v.querySelectorAll(".rog-id-btn").forEach(b => b.addEventListener("click", () => { nitWorker = b.dataset.w; nitRender(); }));
}

/* Механизми (голяма мрежа от бутони) */
function nitRenderMechanisms(v) {
  const isW = nitIsWorker();
  const worker = nitWorker || NIT_WORKERS[0];
  if (!nitWorker) nitWorker = worker;
  const rec = NIT.records[nitKey(worker, nitDate)] || { ops: {} };
  const mechQty = me => me.ops.reduce((s, o) => s + nitOpSum(rec, o.n), 0);

  const workerCtrl = isW
    ? `<span class="rog-who">👷 <b>${escapeHtml(worker)}</b></span><button class="btn btn-small rog-switch-btn" id="nit-switch">🔄 Смени служител</button>`
    : `<label class="erp-inline">Служител <select id="nit-worker">${NIT_WORKERS.map(n => `<option ${n === worker ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select></label>`;

  v.innerHTML = `
    <div class="rog-toolbar">
      ${workerCtrl}
      <label class="erp-inline">Дата <input type="date" id="nit-date" value="${escapeAttr(nitDate)}" /></label>
      ${!isW ? `<button class="btn btn-small" id="nit-summary">📊 Обобщение (седмица/месец)</button>` : ""}
    </div>
    <p class="hint">Избери <b>механизъм</b>, после въведи колко си сглобил по всяка операция.</p>
    <div class="nit-mech-grid">
      ${NIT_MECHANISMS.map((me, i) => { const q = mechQty(me); return `<button class="nit-mech-btn" data-i="${i}">${escapeHtml(me.name)}${q ? `<span class="nit-mech-badge">${q}</span>` : ""}</button>`; }).join("")}
    </div>`;

  const dateEl = v.querySelector("#nit-date");
  if (dateEl) dateEl.addEventListener("change", () => { nitDate = dateEl.value || nitToday(); nitRender(); });
  const wsel = v.querySelector("#nit-worker");
  if (wsel) wsel.addEventListener("change", () => { nitWorker = wsel.value; nitRender(); });
  const sw = v.querySelector("#nit-switch");
  if (sw) sw.addEventListener("click", () => { nitWorker = ""; nitRender(); });
  const sum = v.querySelector("#nit-summary");
  if (sum) sum.addEventListener("click", () => { nitView = "summary"; nitRender(); });
  v.querySelectorAll(".nit-mech-btn").forEach(b => b.addEventListener("click", () => { nitMech = Number(b.dataset.i); nitRender(); }));
}

/* Операции на избрания механизъм (нитовете НЕ се показват) */
function nitRenderOps(v) {
  const worker = nitWorker || NIT_WORKERS[0];
  const me = NIT_MECHANISMS[nitMech]; if (!me) { nitMech = null; nitRender(); return; }
  const rec = NIT.records[nitKey(worker, nitDate)] || { ops: {} };
  v.innerHTML = `
    <div class="rog-toolbar">
      <button class="btn btn-small" id="nit-back">← Механизми</button>
      <span class="rog-who">🔩 <b>${escapeHtml(me.name)}</b> · 👷 ${escapeHtml(worker)} · ${nitFmtDate(nitDate)}</span>
    </div>
    <div class="rog-rows">
      <div class="rog-row rog-head"><div class="rog-op">Операция</div><div class="rog-inputs"><span class="rog-hq">${NIT_NO_LD.has(me.name) ? "НОВИ бройки (добавят се)" : "НОВИ бройки · Л = ляв, Д = десен"}</span></div></div>
      ${me.ops.map((o, oi) => {
        const cur = rec.ops ? rec.ops[o.n] : null;
        // Складовите кодове на операцията — винаги видими до името (Л и Д
        // хранят различни кодове; операция без връзка го казва изрично).
        const map = NIT_STOCK_MAP[o.n];
        const codesHtml = map
          ? `<div class="nit-opcodes">код: Л <b>${escapeHtml(map.l || "—")}</b> · Д <b>${escapeHtml(map.d || "—")}</b></div>`
          : `<div class="nit-opcodes nit-opcodes-none">без складов код</div>`;
        // Операция с ИЗБОР НА ИЗДЕЛИЕ: падащ списък + Л/Д за избраното.
        const pick = NIT_OP_PRODUCTS[o.n];
        if (pick) {
          const selId = "nit-pick-" + oi;
          const opts = pick.list.slice().sort((a, b) => a[1].localeCompare(b[1], "bg"));
          // Днешните бройки по изделия. Записите с избор пазят обща бройка
          // (страната е в изделието); старите записи без избор — Л/Д.
          const todays = Object.keys(rec.ops || {})
            .filter(k => nitOpBase(k) === o.n && nitOpTotal(rec.ops[k]) !== 0)
            .map(k => {
              const code = nitOpPick(k);
              if (!code) { const ld = nitOpLD(rec.ops[k]); return `<span class="nit-opcodes-none">без избор</span>: Л <b>${ld.l}</b> · Д <b>${ld.d}</b>`; }
              return `${escapeHtml(code)}: <b>${nitOpTotal(rec.ops[k])}</b>`;
            });
          const inputHtml = pick.single
            ? `<input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-pickref="${selId}" step="any" inputmode="decimal" value="" placeholder="брой за избраното изделие" />`
            : `<span class="rog-ld">
                <label class="nit-ldl">Л <input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-side="l" data-pickref="${selId}" step="any" inputmode="decimal" value="" placeholder="ляв" /></label>
                <label class="nit-ldl">Д <input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-side="d" data-pickref="${selId}" step="any" inputmode="decimal" value="" placeholder="десен" /></label>
              </span>`;
          return `<div class="rog-row">
            <div class="rog-op">${escapeHtml(o.n)}
              <div class="nit-opcodes">код: <b>по избраното изделие</b> <span class="nit-opcodes-none">(влага ${escapeHtml(pick.from || "")})</span></div>
              ${todays.length ? `<div class="nit-today">днес: ${todays.join(" &nbsp;|&nbsp; ")}</div>` : ""}
            </div>
            <div class="rog-inputs nit-pickwrap">
              <select class="nit-pick" id="${selId}">
                <option value="">— избери изделие —</option>
                ${opts.map(([c, n]) => `<option value="${escapeAttr(c)}">${escapeHtml(n)} · ${escapeHtml(c)}</option>`).join("")}
              </select>
              ${inputHtml}
            </div>
          </div>`;
        }
        if (NIT_NO_LD.has(me.name)) {
          const t = nitOpTotal(cur);
          return `<div class="rog-row">
            <div class="rog-op">${escapeHtml(o.n)}${codesHtml}${t ? `<div class="nit-today">днес: <b>${t}</b></div>` : ""}</div>
            <div class="rog-inputs"><input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" step="any" inputmode="decimal" value="" placeholder="добави брой" /></div>
          </div>`;
        }
        const ld = nitOpLD(cur);
        return `<div class="rog-row">
          <div class="rog-op">${escapeHtml(o.n)}${codesHtml}${(ld.l || ld.d) ? `<div class="nit-today">днес: Л <b>${ld.l}</b> · Д <b>${ld.d}</b></div>` : ""}</div>
          <div class="rog-inputs rog-ld">
            <label class="nit-ldl">Л <input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-side="l" step="any" inputmode="decimal" value="" placeholder="${map && map.l ? "ляв → " + escapeAttr(map.l) : "ляв"}" /></label>
            <label class="nit-ldl">Д <input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-side="d" step="any" inputmode="decimal" value="" placeholder="${map && map.d ? "десен → " + escapeAttr(map.d) : "десен"}" /></label>
          </div>
        </div>`;
      }).join("")}
    </div>
    <div class="rog-tot-line" id="nit-tot"></div>
    <div class="rog-actions">
      <span class="rog-status" id="nit-status"></span>
      <button class="btn btn-primary rog-save-btn" id="nit-save">💾 Запиши</button>
    </div>`;

  const dayTot = me.ops.reduce((s, o) => s + nitOpSum(rec, o.n), 0);
  const recalc = () => { let t = 0; v.querySelectorAll(".nit-q").forEach(i => t += nitNum(i.value)); const el = v.querySelector("#nit-tot"); if (el) el.innerHTML = `Добавяш сега: <b>${Math.round(t * 100) / 100}</b> · вече записани днес: <b>${Math.round(dayTot * 100) / 100}</b><br><span class="nit-hint">Пишеш само НОВИТЕ бройки — добавят се към днешните. Сгрешено? Въведи с минус (напр. -50), за да извадиш.</span>`; };
  v.querySelectorAll(".nit-q").forEach(i => i.addEventListener("input", recalc));
  recalc();
  v.querySelector("#nit-back").addEventListener("click", () => { nitMech = null; nitRender(); });
  v.querySelector("#nit-save").addEventListener("click", async () => {
    // Свеж документ точно преди записа — да не стъпчем запис от друга сесия
    // (кешът може да е от сутринта, а междувременно някой да е писал).
    try { await nitLoad(); } catch (e) {}
    const key = nitKey(worker, nitDate);
    const r = NIT.records[key] || { worker, date: nitDate, ops: {} };
    r.worker = worker; r.date = nitDate; r.ops = r.ops || {};
    const vals = {};
    const noPick = [];
    v.querySelectorAll(".nit-q").forEach(inp => {
      let op = inp.dataset.op;
      const side = inp.dataset.side || "";
      const q = nitNum(inp.value);
      // Операция с избор на изделие: ключът става „операция¦код".
      if (inp.dataset.pickref) {
        const sel = v.querySelector("#" + inp.dataset.pickref);
        const code = (sel && sel.value) || "";
        if (!code) { if (q) noPick.push(op); return; }
        op = op + "¦" + code;
      }
      const cur = vals[op] || (vals[op] = {});
      if (side) cur[side] = q; else cur.single = q;
    });
    if (noPick.length) {
      alert("Избери изделие от падащия списък за: " + [...new Set(noPick)].join(", ") + "\n\nБройката трябва да знае за кой механизъм е.");
      return;
    }
    Object.entries(vals).forEach(([op, x]) => {
      if (x.single !== undefined) {
        if (!x.single) return;   // празно поле не пипа днешното
        const nv = Math.max(0, nitOpTotal(r.ops[op]) + x.single);
        if (nv > 0) r.ops[op] = nv; else delete r.ops[op];
      } else {
        const addL = nitNum(x.l), addD = nitNum(x.d);
        if (!addL && !addD) return;
        const cur = nitOpLD(r.ops[op]);
        const l = Math.max(0, cur.l + addL), d = Math.max(0, cur.d + addD);
        if (l > 0 || d > 0) r.ops[op] = { l, d }; else delete r.ops[op];
      }
    });
    r.at = new Date().toISOString();
    // Полетата се нулират ВЕДНАГА щом бройките влязат в записа — иначе повторно
    // натискане на „Запиши" (напр. след паднала връзка) ги добавяше втори път.
    v.querySelectorAll(".nit-q").forEach(inp => { inp.value = ""; });
    recalc();
    const btn = v.querySelector("#nit-save"); btn.disabled = true; btn.textContent = "Записва…";
    // Заприходяване в Склад детайли за операциите с наш код (по разликата).
    try { await nitSyncStock(r); } catch (e) {}
    // Авто-сглобяване на двете половини в готов механизъм (мин. от двете).
    try { await nitCombineStock(); } catch (e) {}
    const hasStocked = r.stocked && Object.values(r.stocked).some(x => Number(x) > 0);
    if (Object.keys(r.ops).length || hasStocked) NIT.records[key] = r; else delete NIT.records[key];
    const ok = await nitSave();
    btn.disabled = false; btn.textContent = "💾 Запиши";
    const st = v.querySelector("#nit-status"); if (st) st.textContent = ok ? "✓ Записано " + nitNowHM() : "⚠ грешка";
    if (ok) setTimeout(() => { nitMech = null; nitRender(); }, 500);
  });
}

/* ---------- Период ---------- */
function nitIso(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function nitWeekNo(dateStr) {
  const d = new Date(dateStr + "T00:00:00"); if (isNaN(d.getTime())) return "";
  const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}
const NIT_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
function nitPeriodRange(dateStr, period) {
  const d = new Date((dateStr || nitToday()) + "T00:00:00");
  if (period === "day") return { from: nitIso(d), to: nitIso(d), label: nitFmtDate(dateStr) };
  if (period === "month") { const f = new Date(d.getFullYear(), d.getMonth(), 1), l = new Date(d.getFullYear(), d.getMonth() + 1, 0); return { from: nitIso(f), to: nitIso(l), label: NIT_MONTHS[d.getMonth()] + " " + d.getFullYear() }; }
  const off = (d.getDay() + 6) % 7; const mon = new Date(d); mon.setDate(d.getDate() - off); const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: nitIso(mon), to: nitIso(sun), label: `седмица ${nitWeekNo(nitIso(mon))} · ${nitFmtDate(nitIso(mon))} – ${nitFmtDate(nitIso(sun))}` };
}
function nitShiftDate(dateStr, period, dir) { const d = new Date((dateStr || nitToday()) + "T00:00:00"); if (period === "day") d.setDate(d.getDate() + dir); else if (period === "week") d.setDate(d.getDate() + 7 * dir); else d.setMonth(d.getMonth() + dir); return nitIso(d); }

function nitSummaryData(from, to) {
  const opAgg = {}, mechAgg = {}, riv = {};
  NIT_WORKERS.forEach(w => { opAgg[w] = {}; mechAgg[w] = {}; riv[w] = { обикн: 0, големи: 0, колела: 0, ос: 0, total: 0, pieces: 0, days: new Set() }; });
  Object.values(NIT.records || {}).forEach(r => {
    if (!r || !r.date || r.date < from || r.date > to) return;
    const w = r.worker; if (!opAgg[w]) return;
    let any = false;
    Object.entries(r.ops || {}).forEach(([op, qv]) => {
      const q = nitOpTotal(qv); if (!q) return; any = true;
      // Ключът може да е „операция¦код на изделие" (операции с избор) —
      // броим по базовата операция. Премахнати операции остават като архив,
      // за да не се топят историческите числа.
      const baseOp = NIT_OP_RENAME[nitOpBase(op)] || nitOpBase(op);
      const info = NIT_OP_INDEX[baseOp] || { mech: "(архивни операции)", r: 0, t: "обикн" };
      opAgg[w][op] = (opAgg[w][op] || 0) + q;
      mechAgg[w][info.mech] = (mechAgg[w][info.mech] || 0) + q;
      riv[w][info.t] = (riv[w][info.t] || 0) + q * info.r;
      riv[w].total += q * info.r; riv[w].pieces += q;
    });
    if (any) riv[w].days.add(r.date);
  });
  return { opAgg, mechAgg, riv };
}

/* Обобщение (админ): ден/седмица/месец — механизми + нитове по служител */
function nitRenderSummary(v) {
  const range = nitPeriodRange(nitDate, nitPeriod);
  const { opAgg, mechAgg, riv } = nitSummaryData(range.from, range.to);
  const grandPieces = NIT_WORKERS.reduce((s, w) => s + riv[w].pieces, 0);
  const grandRivets = NIT_WORKERS.reduce((s, w) => s + riv[w].total, 0);
  const pBtn = (key, label) => `<button class="btn btn-small ${nitPeriod === key ? "btn-primary" : ""}" data-period="${key}">${label}</button>`;

  const cards = NIT_WORKERS.map(w => { const a = riv[w]; return `<div class="rog-card">
    <div class="rog-card-name">${escapeHtml(w)}</div>
    <div class="rog-card-tot">${a.pieces || 0}</div>
    <div class="rog-card-sub">сглобени · <b>${a.total || 0}</b> нита</div>
    <div class="rog-card-days">${NIT_RIVET_TYPES.filter(([k]) => a[k]).map(([k, l]) => `${l}: ${a[k]}`).join(" · ") || "—"}</div>
    <div class="rog-card-days">${a.days.size} ${a.days.size === 1 ? "работен ден" : "работни дни"}</div>
  </div>`; }).join("") + `<div class="rog-card rog-card-grand"><div class="rog-card-name">ВСИЧКИ</div><div class="rog-card-tot">${grandPieces}</div><div class="rog-card-sub">сглобени · <b>${grandRivets}</b> нита</div></div>`;

  // Таблица: механизми (редове) × служители
  const mechTotal = me => NIT_WORKERS.reduce((s, w) => s + (mechAgg[w][me.name] || 0), 0);
  const mechRows = NIT_MECHANISMS.map(me => mechTotal(me) ? `<tr>
    <td>${escapeHtml(me.name)}</td>
    ${NIT_WORKERS.map(w => `<td class="num">${mechAgg[w][me.name] || "—"}</td>`).join("")}
    <td class="num"><b>${mechTotal(me)}</b></td></tr>` : "").join("") || `<tr><td colspan="${NIT_WORKERS.length + 2}" class="report-empty">Няма записи за периода.</td></tr>`;

  v.innerHTML = `
    <div class="rog-toolbar">
      <button class="btn btn-small" id="nit-back">← Отчет</button>
      <span class="rog-period-btns">${pBtn("day", "Ден")}${pBtn("week", "Седмица")}${pBtn("month", "Месец")}</span>
      <button class="btn btn-small" id="nit-prev">‹</button>
      <input type="date" id="nit-date2" value="${escapeAttr(nitDate)}" />
      <button class="btn btn-small" id="nit-next">›</button>
      <span class="rog-who">📊 <b>${escapeHtml(range.label)}</b></span>
    </div>
    <div class="rog-cards">${cards}</div>
    <h4 class="erp-group-head">Сглобени по механизъм</h4>
    <div class="rog-table-wrap"><table class="report-table rog-sum-table">
      <thead><tr><th>Механизъм</th>${NIT_WORKERS.map(w => `<th class="num">${escapeHtml(w.split(" ")[0])}</th>`).join("")}<th class="num">Общо</th></tr></thead>
      <tbody>${mechRows}</tbody>
    </table></div>`;
  v.querySelector("#nit-back").addEventListener("click", () => { nitView = "entry"; nitRender(); });
  v.querySelectorAll("[data-period]").forEach(b => b.addEventListener("click", () => { nitPeriod = b.dataset.period; nitRender(); }));
  const d2 = v.querySelector("#nit-date2"); if (d2) d2.addEventListener("change", () => { nitDate = d2.value || nitToday(); nitRender(); });
  const prev = v.querySelector("#nit-prev"); if (prev) prev.addEventListener("click", () => { nitDate = nitShiftDate(nitDate, nitPeriod, -1); nitRender(); });
  const next = v.querySelector("#nit-next"); if (next) next.addEventListener("click", () => { nitDate = nitShiftDate(nitDate, nitPeriod, 1); nitRender(); });
}

/* ---------- Инициализация ---------- */
function nitInit() {
  const wire = (id, fn) => { const el = document.getElementById(id); if (el && !el._nitWired) { el._nitWired = true; el.addEventListener("click", fn); } };
  wire("tasks-nit", openNit);
  wire("nit-close", closeNit);
  const lo = document.getElementById("nit-logout");
  if (lo && !lo._nitWired) { lo._nitWired = true; lo.addEventListener("click", () => { if (typeof sb !== "undefined" && sb) sb.auth.signOut(); }); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", nitInit);
else nitInit();
