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
    { n: "Италия само нож", r: 1, t: "обикн" },
    { n: "Италия нож на готова заготовка", r: 2, t: "обикн" },   // готова заготовка + готов нож → механизъм
    { n: "Крак колела — десни", r: 1, t: "колела" },
    { n: "Крак колела — леви", r: 1, t: "колела" },
    { n: "Италия крак затваряне", r: 4, t: "големи" },   // 4× нит 8х26 на цял механизъм
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
    { n: "МПК заготовка", r: 2, t: "обикн" },                    // → 100959 (Д) / 100960 (Л)
    { n: "МПК колело на крак — десни", r: 1, t: "колела" },      // → кракът с колело (от рецептата на половината)
    { n: "МПК колело на крак — леви", r: 1, t: "колела" },
    { n: "МПК затваряне с крак — десни", r: 2, t: "обикн" },     // → десните 🔩 половини
    { n: "МПК затваряне с крак — леви", r: 2, t: "обикн" },      // → левите 🔩 половини
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

/* ---------- ИТАЛИЯ: крака и крайни продукти ----------
   От структурния износ на 100949/100950 (28.07.2026, файл от Данко):
   🔩 = крак (полу-механизъм) — първо му се слагат колела („Крак колела");
   🧾 = краен продукт — ражда се при „Италия крак затваряне" от ляв + десен
   крак с колела + двете заготовки (лява заготовка ← десен крак и обратно). */
const NIT_ITALY_LEGS_L = [
  ["101008", "Механизъм Asia - ляв"],
  ["101010", "Механизъм BG M19 - ляв"],
  ["102457", "Механизъм MECC.BLG NEW-MAX 2 - ляв"],
  ["103098", "Механизъм MECC.BLG NEW-MAX 2 WHE NEW PLATE rev.2 - ляв"],
  ["101018", "Механизъм MECCANICA BLG ART.E-WHEEL(BG-M20)DA - ляв"],
  ["101020", "Механизъм MECCANICA BLG H.130 - ляв"],
  ["102495", "Механизъм MECCANICA BLG H.140 - ляв"],
  ["101022", "Механизъм MECCANICA BLG H.183 - ляв"],
  ["101024", "Механизъм New Maxi Blg - ляв"],
  ["101876", "Механизъм Vincent - ляв"],
  ["101028", "Механизъм Италия 10 - ляв"],
  ["101026", "Механизъм Италия 10 BG M34 - ляв"],
  ["101030", "Механизъм Италия 11.5 - ляв"],
  ["101032", "Механизъм Италия 2.11 - ляв"],
  ["101034", "Механизъм Италия 9.5 - ляв"],
  ["102204", "Механизъм Италия Начеви - 1 - ляв"],
  ["101042", "Механизъм Италия Начеви 3-ляв"],
  ["102250", "Механизъм Италия Начеви H130-ляв"],
  ["102833", "Механизъм Италия Начеви Mobicord-ляв"],
  ["102627", "Механизъм Италия Сияна - ляв"],
  ["101038", "Механизъм Италия Станков - ляв"],
  ["101040", "Механизъм Италия-Начеви-2 сваляемо колело-ляв"],
  ["101044", "Механизъм Италия-Румъния-ляв"]
];
const NIT_ITALY_LEGS_R = [
  ["101007", "Механизъм Asia - десен"],
  ["101009", "Механизъм BG M19 - десен"],
  ["102456", "Механизъм MECC.BLG NEW-MAX 2 - десен"],
  ["103097", "Механизъм MECC.BLG NEW-MAX 2 WHE NEW PLATE rev.2 - десен"],
  ["101017", "Механизъм MECCANICA BLG ART.E-WHEEL(BG-M20)DA - десен"],
  ["101019", "Механизъм MECCANICA BLG H.130 - десен"],
  ["102496", "Механизъм MECCANICA BLG H.140 - десен"],
  ["101021", "Механизъм MECCANICA BLG H.183 - десен"],
  ["101023", "Механизъм New Maxi Blg - десен"],
  ["101877", "Механизъм Vincent - десен"],
  ["101027", "Механизъм Италия 10 - десен"],
  ["101025", "Механизъм Италия 10 BG M34 - десен"],
  ["101029", "Механизъм Италия 11.5 - десен"],
  ["101031", "Механизъм Италия 2.11 - десен"],
  ["101033", "Механизъм Италия 9.5 - десен"],
  ["102203", "Механизъм Италия Начеви - 1 - десен"],
  ["102251", "Механизъм Италия Начеви H130-десен"],
  ["102834", "Механизъм Италия Начеви Mobicord-десен"],
  ["102626", "Механизъм Италия Сияна - десен"],
  ["101037", "Механизъм Италия Станков - десен"],
  ["101041", "Механизъм Италия-Начеви 3-десен"],
  ["101039", "Механизъм Италия-Начеви-2 сваляемо колело-десен"],
  ["101043", "Механизъм Италия-Румъния-десен"]
];
const NIT_ITALY_FINALS = [
  { code: "101141", name: "IZA MECHANISAM, BLACK 713MM", left: "101044", right: "101043" },
  { code: "102458", name: "MECC.BLG NEW-MAX 2", left: "102457", right: "102456" },
  { code: "103093", name: "MECC.BLG NEW-MAX 2 WHE NEW PLATE rev.2", left: "103098", right: "103097" },
  { code: "101131", name: "MECCANICA NEW MAXI BLG", left: "101024", right: "101023" },
  { code: "102752", name: "MECCANICA NEW MAXI BLG - Cubolli Version", left: "101024", right: "101023" },
  { code: "101124", name: "Механзиъм Италия 9.5", left: "101034", right: "101033" },
  { code: "101125", name: "Механизъм BG M19", left: "101010", right: "101009" },
  { code: "101128", name: "Механизъм MECCANICA BLG ART.E-WHEEL(BG-M20)DA", left: "101018", right: "101017" },
  { code: "101129", name: "Механизъм MECCANICA BLG H.130", left: "101020", right: "101019" },
  { code: "102494", name: "Механизъм MECCANICA BLG H.140", left: "102495", right: "102496" },
  { code: "101130", name: "Механизъм MECCANICA BLG H183", left: "101022", right: "101021" },
  { code: "101133", name: "Механизъм Италия 10", left: "101028", right: "101027" },
  { code: "101134", name: "Механизъм Италия 10 BG - M34", left: "101026", right: "101025" },
  { code: "101135", name: "Механизъм Италия 11.5 - СОФА МАКС", left: "101030", right: "101029" },
  { code: "101136", name: "Механизъм Италия 2.11", left: "101032", right: "101031" },
  { code: "101137", name: "Механизъм Италия ASIA", left: "101008", right: "101007" },
  { code: "101880", name: "Механизъм Италия VINCENT", left: "101876", right: "101877" },
  { code: "101123", name: "Механизъм Италия Начеви - 1", left: "102204", right: "102203" },
  { code: "101139", name: "Механизъм Италия Начеви - 2 - сваляемо колело", left: "101040", right: "101039" },
  { code: "101140", name: "Механизъм Италия Начеви - 3", left: "101042", right: "101041" },
  { code: "102835", name: "Механизъм Италия Начеви - Mobicord", left: "102833", right: "102834" },
  { code: "102252", name: "Механизъм Италия Начеви H140", left: "102250", right: "102251" },
  { code: "101142", name: "Механизъм Италия Станков", left: "101038", right: "101037" },
  { code: "102621", name: "Механизъм СИЯНА", left: "102627", right: "102626" }
];

/* ---------- МПК: половини и крайни продукти ----------
   От структурния износ на 100959/100960 (28.07.2026, от Данко):
   заготовка ДЯСНА (100959) влиза в ЛЕВИТЕ 🔩 половини и обратно.
   Веригата: „МПК заготовка" (Л/Д → 100959/100960, влагане по рецептата) →
   „МПК колело на крак — десни/леви" (избира се ПОЛОВИНАТА; заприходява се
   НЕЙНИЯТ КРАК-възел от рецептата, влагат се частите му — гол крак, колела,
   оси) → „МПК затваряне с крак — десни/леви" (заготовката + кракът като ЦЯЛ
   от склада + директните материали → 🔩 половината). Крак без колела не
   минава през колело-опа: кракът му идва готов от потока (заваръчното).
   Комплектите (🧾) НЕ се правят в Занитване — сглобяват се при продажба/опаковка. */
const NIT_MPK_LEGS_L = [
  ["101046", "Механизъм МПК 61 + 6 см Литва - ляв"],
  ["101048", "Механизъм МПК 61 см - ляв"],
  ["101050", "Механизъм МПК 61 см Литва - ляв"],
  ["101052", "Механизъм МПК 69 - 10 - спирачка - ляв"],
  ["101054", "Механизъм МПК 69 см - ГОЛФ ляв"],
  ["101056", "Механизъм МПК 69 см - ляв"],
  ["101058", "Механизъм МПК 79 см - ляв"],
  ["103777", "Механизъм МПК 79 см - ляв H150"],
  ["101060", "Механизъм МПК 85 см - ляв"],
  ["102119", "Механизъм МПК Мебелиана-Пами 2 - ляв"],
  ["101062", "Механизъм МПК Тедива Соул - ляв"],
  ["103643", "Механизъм МПК Тедива Соул - ляв 1"],
  ["103589", "Механизъм МПК Тедива Соул - ляв 2"],
  ["102210", "Механизъм Италия-Начеви-79 см- сваляемо колело-ляв"]
];
const NIT_MPK_LEGS_R = [
  ["101045", "Механизъм МПК 61 + 6 см Литва - десен"],
  ["101047", "Механизъм МПК 61 см - десен"],
  ["101049", "Механизъм МПК 61 см Литва - десен"],
  ["101051", "Механизъм МПК 69 - 10 - спирачка - десен"],
  ["101053", "Механизъм МПК 69 см - ГОЛФ десен"],
  ["101055", "Механизъм МПК 69 см - десен"],
  ["101057", "Механизъм МПК 79 см - десен"],
  ["103776", "Механизъм МПК 79 см - десен H150"],
  ["101059", "Механизъм МПК 85 см - десен"],
  ["102118", "Механизъм МПК Мебелиана-Пами 2 - десен"],
  ["101061", "Механизъм МПК Тедива Соул - десен"],
  ["103644", "Механизъм МПК Тедива Соул - десен 1"],
  ["103588", "Механизъм МПК Тедива Соул - десен 2"],
  ["102209", "Механизъм Италия-Начеви-79 см- сваляемо колело-десен"]
];
/* Кой краен комплект (🧾) от кои половини се ражда — за филтъра „само с
   пуснати заявки" (половината е активна, ако комплектът ѝ е поръчан). */
const NIT_MPK_FINALS = [
  { code: "101147", name: "Механизъм потапящ малък с крак 61 см", left: "101048", right: "101047" },
  { code: "103656", name: "Потапящ механизъм с крак 61 см - Литва", left: "101050", right: "101049" },
  { code: "101161", name: "Потапящ механизъм с крак 61+6 см - Литва", left: "101046", right: "101045" },
  { code: "101149", name: "Механизъм потапящ малък с крак 69 см", left: "101056", right: "101055" },
  { code: "101159", name: "Потапящ механизъм малък с крак 69 см - 12.5", left: "101056", right: "101055" },
  { code: "101150", name: "Механизъм потапящ малък с крак 69 см - 100 мм", left: "101052", right: "101051" },
  { code: "101152", name: "МПК 69 см", left: "101054", right: "101053" },
  { code: "103864", name: "Механизъм МПК 69 см - ГОЛФ комплект ляв и десен", left: "101054", right: "101053" },
  { code: "101151", name: "Механизъм потапящ малък с крак 79 см", left: "101058", right: "101057" },
  { code: "103772", name: "Механизъм потапящ малък с крак 79 см H 150", left: "103777", right: "103776" },
  { code: "101153", name: "МПК 85 см", left: "101060", right: "101059" },
  { code: "102120", name: "Механизъм Мебелиана - Пами 2", left: "102119", right: "102118" },
  { code: "101145", name: "Механизъм ТЕДИВА СОУЛ", left: "101062", right: "101061" },
  { code: "103640", name: "Механизъм ТЕДИВА СОУЛ 1", left: "103643", right: "103644" },
  { code: "103592", name: "Механизъм ТЕДИВА СОУЛ 2", left: "103589", right: "103588" },
  { code: "102208", name: "Механизъм Начев 79 см", left: "102210", right: "102209" }
];

/* ---------- Операции с ИЗБОР НА ИЗДЕЛИЕ ----------
   Служителят първо ИЗБИРА изделието от падащ списък, после пише броя.
   Записът се пази с ключ „операция¦код" — всяко изделие има собствена
   бройка и собствена складова история. */
const NIT_OP_PRODUCTS = {
  "Крак колела — десни": { from: "заварения крак + колела/оси", single: true, list: NIT_ITALY_LEGS_R },
  "Крак колела — леви":  { from: "заварения крак + колела/оси", single: true, list: NIT_ITALY_LEGS_L },
  "Италия крак затваряне": {
    from: "ляв + десен крак с колела + заготовки 100949 и 100950",
    single: true,
    list: NIT_ITALY_FINALS.map(f => [f.code, f.name]),
  },
  "МПК колело на крак — десни": { from: "голия крак + колела/оси (по рецептата на крака) — избери МЕХАНИЗМА, за който е кракът", single: true, list: NIT_MPK_LEGS_R },
  "МПК колело на крак — леви":  { from: "голия крак + колела/оси (по рецептата на крака) — избери МЕХАНИЗМА, за който е кракът", single: true, list: NIT_MPK_LEGS_L },
  "МПК затваряне с крак — десни": { from: "лява заготовка 100960 + крака с колело (цял, от склада)", single: true, list: NIT_MPK_LEGS_R },
  "МПК затваряне с крак — леви":  { from: "дясна заготовка 100959 + крака с колело (цял, от склада)", single: true, list: NIT_MPK_LEGS_L },
};

/* Складова връзка ЗА ИЗБРАНО ИЗДЕЛИЕ: какво заприходява (самия избран код)
   и какво влага. Крак без известна рецепта = само заприходяване (колелата
   ще се допълнят, щом дойде рецептата му). */
const NIT_PICK_RULES = (() => {
  const rules = {
    "Крак колела — десни": {}, "Крак колела — леви": {}, "Италия крак затваряне": {},
    "МПК колело на крак — десни": {}, "МПК колело на крак — леви": {},
    "МПК затваряне с крак — десни": {}, "МПК затваряне с крак — леви": {},
  };
  // Всички крака се заприходяват при „Крак колела".
  NIT_ITALY_LEGS_R.forEach(([code]) => { rules["Крак колела — десни"][code] = { consume: [] }; });
  NIT_ITALY_LEGS_L.forEach(([code]) => { rules["Крак колела — леви"][code] = { consume: [] }; });
  // МПК: и двете операции избират ПОЛОВИНАТА (механизма); влагането е
  // ДИНАМИЧНО по живата рецепта (nitDynamicConsume) — тук само ги обявяваме,
  // за да са нит-управлявани (erpNitManagedCode) и разпознати от пикъра.
  // „Колело на крак" заприходява НЕ половината, а нейния крак (от рецептата).
  NIT_MPK_LEGS_R.forEach(([code]) => { rules["МПК колело на крак — десни"][code] = { consume: [] }; rules["МПК затваряне с крак — десни"][code] = { consume: [] }; });
  NIT_MPK_LEGS_L.forEach(([code]) => { rules["МПК колело на крак — леви"][code] = { consume: [] }; rules["МПК затваряне с крак — леви"][code] = { consume: [] }; });
  // Колела/оси — където имаме рецептата: ASIA по 2, BG M19 по 1 (100160 колело Ф42, 100182 ос къса).
  const WHEELS = { "101007": 2, "101008": 2, "101009": 1, "101010": 1 };
  Object.entries(WHEELS).forEach(([code, n]) => {
    const op = rules["Крак колела — десни"][code] ? "Крак колела — десни" : "Крак колела — леви";
    rules[op][code] = { consume: [
      { code: "100160", per: n, mat: true },   // Колело малко Ф42
      { code: "100182", per: n, mat: true },   // Ос къса степенчата
    ] };
  });
  // Затваряне: 1 краен = ляв крак + десен крак + двете заготовки + нитове
  // (2× нит 8х26 + 2× шайби АМ8 НА СТРАНА — сверено с рецептите на ASIA и BG M19).
  NIT_ITALY_FINALS.forEach(f => {
    const consume = [
      { code: f.left, per: 1 }, { code: f.right, per: 1 },
      { code: "100949", per: 1 }, { code: "100950", per: 1 },
      { code: "100175", per: 4, mat: true },   // Нит 8 х 26
      { code: "100188", per: 4, mat: true },   // Подложна шайба DIN 125 АМ 8
    ];
    // ASIA носи и спирачки/болтове/степенчати колела (по рецептата на 101137).
    if (f.code === "101137") consume.push(
      { code: "100640", per: 2 },              // Спирачка Италия
      { code: "100128", per: 2, mat: true },   // Болт DIN 912 M8x60
      { code: "100194", per: 2, mat: true },   // Степенчато колело
    );
    rules["Италия крак затваряне"][f.code] = { consume };
  });
  return rules;
})();

/* BOM-кодове на ГОЛИТЕ крака (в рецептите кракът включва колелата, но
   физически колелата се слагат в Занитване): тези кодове нямат складов живот —
   жените заприходяват направо крака-с-колела (101007-тип). Влизат в
   предпазителя erpNitManagedCode, за да не ги складира потокът/Мастер при
   докарване на задачите им (иначе фантомна наличност + двоен крак).
   Допълва се с кодовете от рецептите на останалите механизми. */
const NIT_LEG_BOM_CODES = ["100971", "100972", "100986"];

/* ---------- 📜 История на механизъм (само за офиса/админ) ----------
   Всички кодове по веригата на механизма: наличност сега + последните
   движения (продукти от Склад детайли, материали от Склад материали).
   Наборите се СТРОЯТ АВТОМАТИЧНО от складовата конфигурация (NIT_STOCK_MAP,
   NIT_CONSUME, NIT_PICK_RULES, NIT_COMBINE) — виж NIT_HISTORY_SETS по-долу,
   след дефинициите. Механизъм без складова връзка няма бутон. Липсващите
   имена се допълват от базата при отваряне. */

async function nitHistoryView(setName) {
  const cfg = NIT_HISTORY_SETS[setName]; if (!cfg) return;
  let wrap = document.getElementById("nit-hist-modal");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "nit-hist-modal"; wrap.className = "overlay dsnm-overlay";
    document.body.appendChild(wrap);
  }
  wrap.innerHTML = `<div class="dsnm-box"><p class="erp-loading" style="font-size:16px">Зареждам движенията по ${escapeHtml(setName)}…</p></div>`;
  const fmtD = s => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})T?(\d{2})?:?(\d{2})?/); return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? " " + m[4] + ":" + m[5] : ""}` : String(s || ""); };
  try {
    // Продукти: id-та, наличности, движения.
    const pCodes = cfg.products.map(x => x[0]);
    const { data: prods } = await sb.from("products").select("id,code,name").in("code", pCodes);
    const pid2code = {}, code2pid = {}, pid2name = {};
    (prods || []).forEach(p => { pid2code[p.id] = String(p.code).trim(); code2pid[String(p.code).trim()] = p.id; pid2name[p.id] = p.name || ""; });
    const pids = Object.keys(pid2code).map(Number);
    const pStock = {};
    if (pids.length) {
      const { data } = await sb.from("v_product_stock").select("id,stock").in("id", pids);
      (data || []).forEach(r => { pStock[r.id] = Number(r.stock) || 0; });
    }
    const pMoves = {};
    if (pids.length) {
      const { data } = await sb.from("product_movements").select("product_id,kind,quantity,ref,note,created_at")
        .in("product_id", pids).order("created_at", { ascending: false }).limit(1000);
      (data || []).forEach(m => { (pMoves[m.product_id] = pMoves[m.product_id] || []).push(m); });
    }
    // Материали: id-та, наличности, движения.
    const mCodes = cfg.materials.map(x => x[0]);
    const { data: mats } = await sb.from("materials").select("id,code,name").in("code", mCodes);
    const mid2code = {}, mid2name = {};
    (mats || []).forEach(m => { mid2code[m.id] = String(m.code).trim(); mid2name[m.id] = m.name || ""; });
    const mids = Object.keys(mid2code).map(Number);
    const mStock = {};
    if (mids.length) {
      const { data } = await sb.from("v_material_stock").select("id,stock").in("id", mids);
      (data || []).forEach(r => { mStock[r.id] = Number(r.stock) || 0; });
    }
    const mMoves = {};
    if (mids.length) {
      const { data } = await sb.from("stock_movements").select("material_id,kind,quantity,ref,note,created_at")
        .in("material_id", mids).order("created_at", { ascending: false }).limit(800);
      (data || []).forEach(m => { (mMoves[m.material_id] = mMoves[m.material_id] || []).push(m); });
    }
    const movesTbl = list => list && list.length ? `<table class="nit-hist-tbl">
        <thead><tr><th>Дата</th><th>Тип</th><th style="text-align:right">Кол.</th><th>Бележка</th></tr></thead>
        <tbody>${list.slice(0, 25).map(m => `<tr>
          <td>${escapeHtml(fmtD(m.created_at))}</td><td>${escapeHtml(m.kind || "")}</td>
          <td style="text-align:right"><b class="${Number(m.quantity) < 0 ? "erp-warn" : ""}">${Number(m.quantity) > 0 ? "+" : ""}${erpNum(Number(m.quantity) || 0)}</b></td>
          <td class="nit-hist-note">${escapeHtml(m.note || m.ref || "")}</td>
        </tr>`).join("")}</tbody></table>${list.length > 25 ? `<p class="erp-muted">…показани последните 25 от ${list.length} изтеглени</p>` : ""}`
      : `<p class="erp-muted" style="margin:4px 0 8px">Няма движения.</p>`;
    const block = (code, name, stock, list, kind) => `
      <details class="nit-hist-blk" ${list && list.length ? "" : ""}>
        <summary><b>${escapeHtml(code)}</b> ${escapeHtml(name)} · <span class="${(stock || 0) < 0 ? "erp-warn" : "dsnm-stock"}">${erpNum(stock || 0)}</span> <span class="erp-muted">${kind}</span> <span class="erp-muted">(${(list || []).length} движ.)</span></summary>
        ${movesTbl(list)}
      </details>`;
    const prodBlocks = cfg.products.map(([c, n]) => { const pid = code2pid[c]; return pid ? block(c, n || pid2name[pid] || "", pStock[pid], pMoves[pid], "· Склад детайли") : `<p class="erp-warn">${escapeHtml(c)} — не е намерен в Продукти</p>`; }).join("");
    const matBlocks = cfg.materials.map(([c, n]) => { const mid = Object.keys(mid2code).find(id => mid2code[id] === c); return mid ? block(c, n || mid2name[mid] || "", mStock[mid], mMoves[mid], "· Склад материали") : `<p class="erp-warn">${escapeHtml(c)} — не е намерен в Материали</p>`; }).join("");
    wrap.innerHTML = `<div class="dsnm-box">
      <div class="dsnm-top-bar">
        <h3>📜 ${escapeHtml(setName)} — движение и история на всички кодове</h3>
        <span class="spacer"></span>
        <button class="btn btn-small" id="nit-hist-close">✕ Затвори</button>
      </div>
      <p class="hint">Клик върху ред го разгъва до последните движения. Минусите са в червено. Етикет „нит:" = отчет от Занитване; „нит-сглоб:" = авто-комплектоване; „prod:/consume:" = поток.</p>
      <h4 class="erp-group-head">Детайли и възли (Склад детайли)</h4>
      ${prodBlocks}
      <h4 class="erp-group-head" style="margin-top:14px">Материали (Склад материали)</h4>
      ${matBlocks}
    </div>`;
    wrap.querySelector("#nit-hist-close").addEventListener("click", () => wrap.remove());
  } catch (e) {
    wrap.innerHTML = `<div class="dsnm-box"><h3>Грешка</h3><p>${escapeHtml((e && e.message) || String(e))}</p><button class="btn" onclick="document.getElementById('nit-hist-modal').remove()">Затвори</button></div>`;
  }
}

/* Кодове с ПУСНАТИ (незавършени) заявки в момента — падащите списъци показват
   само тях, за да е лесно на жените. Кракът се смята за активен и когато
   активен е крайният му механизъм. При грешка/празно — показваме всички. */
let NIT_ACTIVE = null;
let NIT_PICK_ALL = false;   // „покажи всички изделия" (ръчен превключвател)
async function nitLoadActiveCodes() {
  const out = new Set();
  let okTasks = false, okOrders = false;
  // 1) Пуснати в производство (незавършени поточни задачи).
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("tasks")
        .select("code:data->>code,qty:data->>qty,produced:data->>produced")
        .eq("data->source->>flow", "true").order("id", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      (data || []).forEach(r => {
        const q = Number(r.qty) || 0, p = Number(r.produced) || 0;
        if (r.code && !(q > 0 && p >= q)) out.add(String(r.code).trim());
      });
      if (!data || data.length < 1000) break;
    }
    okTasks = true;
  } catch (e) { /* продължаваме с поръчките */ }
  // 2) ПОРЪЧАНИ от клиенти (отворени заявки) — дори още да не са пуснати в цех.
  //    Изключваме завършените и готовите за продажба (по тях не се работи).
  try {
    const pids = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("customer_orders").select("id,data")
        .order("id", { ascending: true }).range(from, from + 999);
      if (error) throw error;
      (data || []).forEach(r => {
        const d = (r && r.data) || {};
        const st = d.status || "нова";
        if (st === "завършена" || st === "готова за продажба") return;
        (d.lines || []).forEach(l => { if (l.productId) pids.push(Number(l.productId)); });
      });
      if (!data || data.length < 1000) break;
    }
    const ids = [...new Set(pids)];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await sb.from("products").select("id,code").in("id", ids.slice(i, i + 200));
      (data || []).forEach(p => { if (p.code) out.add(String(p.code).trim()); });
    }
    okOrders = true;
  } catch (e) { /* при грешка — каквото е събрано */ }
  NIT_ACTIVE = (okTasks || okOrders) ? out : null;
}
function nitPickActive(op, code) {
  if (!NIT_ACTIVE) return true;
  if (NIT_ACTIVE.has(String(code))) return true;
  // Крак: активен, ако крайният му механизъм има пусната заявка.
  if (typeof NIT_ITALY_FINALS !== "undefined" && /^Крак колела/.test(op)) {
    return NIT_ITALY_FINALS.some(f => (f.left === code || f.right === code) && NIT_ACTIVE.has(f.code));
  }
  // МПК половина (затваряне И колело на крак): активна, ако комплектът ѝ
  // (🧾) има пусната заявка.
  if (typeof NIT_MPK_FINALS !== "undefined" && /^МПК /.test(op)) {
    return NIT_MPK_FINALS.some(f => (f.left === code || f.right === code) && NIT_ACTIVE.has(f.code));
  }
  return false;
}

/* ---------- ДИНАМИЧНА консумация по живата рецепта („всички като ASIA") ----------
   Вместо ръчни таблици за всеки механизъм, при запис четем рецептата от базата:
   • „Крак колела" (🔩 P): намираме крак-BOM възела на P (детето, което не е
     заготовка 100949/100950) и влагаме неговите ЧАСТИ (тръба, планка…) и
     МАТЕРИАЛИ (колела, оси) — по бройките от рецептата.
   • „Италия крак затваряне" (краен F): влагаме двата 🔩 (цели), заготовките и
     директните материали от рецептите на 🔩-те (нитове/шайби), плюс екстрите
     на F (спирачки, болтове, степенчати колела…).
   Статичните правила (ASIA, BG M19) остават като резервен път при мрежова
   грешка. Промяна на рецепта се отразява от следващия запис — без пипане тук. */
const NIT_ZAG_CODES = new Set(["100949", "100950"]);
const NIT_MPK_ZAG = new Set(["100959", "100960"]);   // заготовки потапящ (МПК)
async function nitLines(pids) {
  if (!pids.length) return {};
  const { data, error } = await sb.from("recipe_lines")
    .select("product_id,child_product_id,material_id,quantity").in("product_id", pids);
  if (error) throw error;
  const by = {};
  (data || []).forEach(l => { (by[l.product_id] = by[l.product_id] || []).push(l); });
  return by;
}
async function nitProdCodes(ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.from("products").select("id,code").in("id", ids);
  if (error) throw error;
  const m = {}; (data || []).forEach(p => { m[p.id] = String(p.code || "").trim(); });
  return m;
}
// Кракът (възелът) на МПК половина: детето в рецептата ѝ, което НЕ е
// заготовка 100959/100960. Връща { pid, code } или null.
async function nitMpkLegNode(halfPid) {
  const L1 = await nitLines([halfPid]);
  const lines = L1[halfPid] || [];
  const childIds = lines.filter(l => l.child_product_id).map(l => l.child_product_id);
  if (!childIds.length) return null;
  const codes = await nitProdCodes(childIds);
  const kid = childIds.find(id => !NIT_MPK_ZAG.has(codes[id]));
  if (!kid) return null;
  return { pid: kid, code: codes[kid] || "" };
}

// Влагане за Л/Д операция БЕЗ статична таблица: директната рецепта на
// заприходявания код — децата (части) + материалите, по бройките от нея.
async function nitLDDynamic(pid) {
  const L1 = await nitLines([pid]);
  const items = [];
  (L1[pid] || []).forEach(l => {
    const per = Number(l.quantity) || 1;
    if (l.child_product_id) items.push({ pid: l.child_product_id, qty: per });
    else if (l.material_id) items.push({ mid: l.material_id, qty: per });
  });
  return items;
}

// Връща { items: [{pid?|mid?, qty за 1 бр.}], legCode } или null (непълна рецепта).
async function nitDynamicConsume(base, pick, ids) {
  const pid = ids[pick]; if (!pid) return null;
  const L1 = await nitLines([pid]);
  const lines = L1[pid] || [];
  if (!lines.length) return null;
  const childIds = lines.filter(l => l.child_product_id).map(l => l.child_product_id);
  const codes = await nitProdCodes(childIds);
  const items = [];
  if (/^Крак колела|^МПК колело на крак/.test(base)) {
    // Избраното е 🔩 (Италия крак / МПК половина); кракът-възел е детето,
    // което не е заготовка. Влагат се ЧАСТИТЕ и МАТЕРИАЛИТЕ на крака-възел.
    const zag = /^МПК/.test(base) ? NIT_MPK_ZAG : NIT_ZAG_CODES;
    const legLine = lines.find(l => l.child_product_id && !zag.has(codes[l.child_product_id]));
    if (!legLine) return null;
    const K = legLine.child_product_id;
    const L2 = await nitLines([K]);
    (L2[K] || []).forEach(l => {
      const per = Number(l.quantity) || 1;
      if (l.child_product_id) items.push({ pid: l.child_product_id, qty: per });
      else if (l.material_id) items.push({ mid: l.material_id, qty: per });
    });
    if (!items.length) return null;
    return { items, legCode: codes[K] || "" };
  }
  if (/^МПК затваряне/.test(base)) {
    // 🔩 половина (заготовка + крак с колело): заготовката (складова) се влага
    // директно; кракът-възел се влага като ЦЯЛ код — той е заприходен от
    // „МПК колело на крак" (ако е с колела) или от потока (голият заварен
    // крак, ако е без). Така затварянето не прескача слагането на колелото.
    // Директните материали на 🔩 (нитове/шайби) — също.
    for (const l of lines) {
      const per = Number(l.quantity) || 1;
      if (l.material_id) { items.push({ mid: l.material_id, qty: per }); continue; }
      if (l.child_product_id) items.push({ pid: l.child_product_id, qty: per });
    }
    if (!items.length) return null;
    return { items, legCode: "" };   // кракът НЕ се гардва тук — гардва се само когато колело-опът го произвежда
  }
  // Крак затваряне: краен механизъм F
  const fin = (typeof NIT_ITALY_FINALS !== "undefined") ? NIT_ITALY_FINALS.find(f => f.code === pick) : null;
  if (!fin) return null;
  const halfCodes = new Set([fin.left, fin.right]);
  const halves = lines.filter(l => l.child_product_id && halfCodes.has(codes[l.child_product_id]));
  if (halves.length !== 2) return null;
  // 1) двата 🔩 като цели + 2) екстрите на F (други деца и директни материали)
  lines.forEach(l => {
    const per = Number(l.quantity) || 1;
    if (l.child_product_id) items.push({ pid: l.child_product_id, qty: per });
    else if (l.material_id) items.push({ mid: l.material_id, qty: per });
  });
  // 3) от рецептите на 🔩-те: заготовката + директните им материали (нитове/
  //    шайби); крак-BOM възелът се пропуска (влиза чрез самия 🔩).
  const hIds = halves.map(l => l.child_product_id);
  const L2 = await nitLines(hIds);
  const c2ids = hIds.flatMap(h => (L2[h] || []).filter(l => l.child_product_id).map(l => l.child_product_id));
  const codes2 = await nitProdCodes(c2ids);
  hIds.forEach(h => (L2[h] || []).forEach(l => {
    const per = Number(l.quantity) || 1;
    if (l.child_product_id) {
      if (NIT_ZAG_CODES.has(codes2[l.child_product_id])) items.push({ pid: l.child_product_id, qty: per });
    } else if (l.material_id) items.push({ mid: l.material_id, qty: per });
  }));
  return { items, legCode: "" };
}

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
  "Италия нож на готова заготовка": { d: "100949", l: "100950" },   // готови половини → готов механизъм
  "Малък бял заготовка":       { d: "100937", l: "100938" },
  "Малък бял затваряне":       { d: "101002", l: "101001" },
  "Малък бял цял":             { d: "101002", l: "101001" },   // същият резултат като „затваряне"
  "ММ04 заготовка":            { d: "101864", l: "101865" },
  "ММ04 затваряне":            { d: "101866", l: "101867" },
  "ММ04 цял":                  { d: "101866", l: "101867" },   // наведнъж, без етап заготовка
  "МПК заготовка":             { d: "100959", l: "100960" },   // влагане по живата рецепта (няма статична таблица)
};

/* Стари имена на операции → новите (преименуване на механизъм). Пази
   историческите бройки в справките под новото име. */
const NIT_OP_RENAME = {
  "Италия затваряне на крак": "Италия крак затваряне",
  "Крак колела": "Крак колела — десни",
  "ММ02 заготовка": "ММ04 заготовка",
  "ММ02 затваряне": "ММ04 затваряне",
  "ММ02 цял": "ММ04 цял",
  "МПК затваряне с крак": "МПК затваряне с крак — десни",
  "МПК колело на крак": "МПК колело на крак — десни",
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
  // и нож се отчита само с „Италия нож на готова заготовка" — иначе системата
  // сглобяваше „на хартия" преди жените реално да са сложили ножа.
  { a: "101002", b: "101001", to: "101102", label: "Малък бял к-т (десен + ляв)", extra: [{ code: "100622", per: 2 }] },   // + 2 пружини L=90
  // ММ04: десен + ляв → цял механизъм 101157 + 2 огънати и 2 прави спирачки
  { a: "101866", b: "101867", to: "101157", label: "Потапящ малък ММ04 (десен + ляв)", extra: [{ code: "100638", per: 2 }, { code: "100639", per: 2 }] },
  // (ASIA 101007+101008→101137 беше вързан пробно и МАХНАТ по искане на Данко —
  //  ще се върне при масовото връзване на механизмите, заедно с extra:
  //  2× 100640 спирачка + 2× 100128 болт (мат.) + 2× 100194 степенчато колело (мат.))
];

/* 📜 Наборите за „движения" — по един за ВСЕКИ механизъм със складова връзка.
   Кодовете се събират от цялата конфигурация на операциите му; имената идват
   от списъците (Италия/МПК) и от ръчната карта, останалите — от базата. */
const NIT_HISTORY_SETS = (() => {
  const NAMES = {
    "101864": "Заготовка потапящ ММ04 — дясна", "101865": "Заготовка потапящ ММ04 — лява",
    "101866": "Механизъм потапящ ММ04 — десен", "101867": "Механизъм потапящ ММ04 — ляв",
    "101157": "Потапящ малък механизъм /ММ04/ — комплект",
    "100461": "Винкел потапящ малък", "100514": "Късо ММ03", "100488": "Дълго ММ04", "100644": "Стик — ММ04",
    "100638": "Спирачка огъната ММ03-04", "100639": "Спирачка права ММ03-04",
    "100170": "Нит 8 х 12", "100175": "Нит 8 х 26", "100188": "Подложна шайба DIN 125 АМ 8",
    "100949": "Заготовка Италия — дясна", "100950": "Заготовка Италия — лява",
    "100959": "Заготовка потапящ — дясна", "100960": "Заготовка потапящ — лява",
  };
  [...NIT_ITALY_LEGS_L, ...NIT_ITALY_LEGS_R, ...NIT_MPK_LEGS_L, ...NIT_MPK_LEGS_R]
    .forEach(([c, n]) => { NAMES[c] = NAMES[c] || n; });
  [...NIT_ITALY_FINALS, ...NIT_MPK_FINALS].forEach(f => { NAMES[f.code] = NAMES[f.code] || f.name; });
  const sets = {};
  NIT_MECHANISMS.forEach(me => {
    const prod = new Set(), mat = new Set();
    me.ops.forEach(o => {
      const op = o.n;
      const m = NIT_STOCK_MAP[op];
      if (m) { if (m.d) prod.add(m.d); if (m.l) prod.add(m.l); }
      (NIT_CONSUME[op] || []).forEach(it => {
        if (it.mat) mat.add(it.code);
        else if (it.side) { if (it.side.d) prod.add(it.side.d); if (it.side.l) prod.add(it.side.l); }
        else if (it.code) prod.add(it.code);
      });
      const rules = NIT_PICK_RULES[op];
      if (rules) Object.entries(rules).forEach(([code, r]) => {
        prod.add(code);
        (r.consume || []).forEach(it => { if (it.mat) mat.add(it.code); else if (it.code) prod.add(it.code); });
      });
    });
    // Авто-комплектоването на неговите половини: целите + екстрите също влизат.
    NIT_COMBINE.forEach(c => {
      if (prod.has(c.a) || prod.has(c.b)) {
        prod.add(c.a); prod.add(c.b); prod.add(c.to);
        (c.extra || []).forEach(x => { if (x.mat) mat.add(x.code); else prod.add(x.code); });
      }
    });
    if (!prod.size && !mat.size) return;   // без складова връзка → без бутон
    sets[me.name] = {
      products: [...prod].sort().map(c => [c, NAMES[c] || ""]),
      materials: [...mat].sort().map(c => [c, NAMES[c] || ""]),
    };
  });
  return sets;
})();
async function nitCombineStock() {
  const ids = await nitStockIds();
  const mids = await nitMatIds();
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
      const matRows = [];
      (c.extra || []).forEach(x => {
        if (x.mat) {
          // Добавка от Склад материали (болтове, колела…)
          const mid = mids[x.code];
          if (mid) matRows.push({ material_id: mid, kind: "изписване", quantity: -q * (Number(x.per) || 1), ref, note: note + " · влага " + x.code });
        } else {
          const xp = ids[x.code];
          if (xp) rows.push({ product_id: xp, kind: "изписване", quantity: -q * (Number(x.per) || 1), ref, note: note + " · влага " + x.code });
        }
      });
      await sb.from("product_movements").insert(rows);
      if (matRows.length) { try { await sb.from("stock_movements").insert(matRows); } catch (e) { /* следващия отчет */ } }
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
      ...NIT_COMBINE.flatMap(c => (c.extra || []).filter(x => !x.mat).map(x => x.code)),
      // Операции с избор на изделие: самите изделия + детайлните им съставки
      ...Object.values(NIT_PICK_RULES).flatMap(rules => Object.entries(rules).flatMap(([code, r]) =>
        [code, ...((r.consume || []).filter(i => !i.mat).map(i => i.code))])),
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
    const codes = [...new Set([
      ...Object.values(NIT_CONSUME).flat().filter(it => it.mat).map(it => it.code),
      ...NIT_COMBINE.flatMap(c => (c.extra || []).filter(x => x.mat).map(x => x.code)),
      ...Object.values(NIT_PICK_RULES).flatMap(rules => Object.values(rules).flatMap(r => (r.consume || []).filter(i => i.mat).map(i => i.code))),
    ])];
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
  for (const [op, m] of Object.entries(NIT_STOCK_MAP)) {
    const ld = nitOpLD((rec.ops || {})[op]);
    for (const [sk, tag, word] of [["l", "Л", "ляв"], ["d", "Д", "десен"]]) {
      const code = m[sk]; if (!code) continue;
      const pid = ids[code];
      if (!pid) { if (ld[sk] > 0) missing.push(code + " (" + op + " · " + word + ")"); continue; }
      const key = op + "¦" + tag;
      // съвместимост: старият формат пазеше stocked[op] без страна (= десен)
      const done = rec.stocked[key] != null ? Number(rec.stocked[key]) || 0
        : (sk === "d" ? Number(rec.stocked[op]) || 0 : 0);
      const now = ld[sk];
      const delta = now - done;
      if (!delta) {
        if (rec.stocked[key] == null && sk === "d" && rec.stocked[op] != null) { rec.stocked[key] = done; delete rec.stocked[op]; }
        continue;
      }
      moves.push({
        product_id: pid, kind: "заприходяване", quantity: delta,
        ref: `нит:${rec.worker}|${rec.date}|${op}|${tag}`,
        note: `Занитване · ${rec.worker} · ${op} (${word})` + (delta < 0 ? " · корекция" : ""),
      });
      // Операцията ВЛАГА съставките си (детайли и материали) — огледално на делтата.
      if (NIT_CONSUME[op]) {
        NIT_CONSUME[op].forEach(item => {
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
      } else {
        // БЕЗ статична таблица (нови механизми — „всички като ASIA"): влага се
        // по живата рецепта на самия код — децата (части) + материалите.
        let dynLD = null;
        try { dynLD = await nitLDDynamic(pid); } catch (e) { dynLD = null; }
        if (dynLD && dynLD.length) {
          const cref = `нит:${rec.worker}|${rec.date}|${op}|${tag}`;
          const cnote = `Занитване · ${rec.worker} · ${op} (${word}) — влага по рецепта` + (delta < 0 ? " · корекция" : "");
          dynLD.forEach(it => {
            const q = delta * (Number(it.qty) || 1);
            if (it.mid) matMoves.push({ material_id: it.mid, kind: "изписване", quantity: -q, ref: cref, note: cnote, created_by: rec.worker || null });
            else if (it.pid) moves.push({ product_id: it.pid, kind: "изписване", quantity: -q, ref: cref, note: cnote });
          });
        } else if (delta > 0) {
          missing.push(code + " (" + op + " — влагане по рецепта неуспешно, само заприходено)");
        }
      }
      applied.push({ key, now, op, sk, code, delta });
    }
  }
  // Операции с ИЗБРАНО ИЗДЕЛИЕ (ключ „операция¦код"): заприходяват самия
  // избран код и влагат ПО ЖИВАТА РЕЦЕПТА (nitDynamicConsume); статичното
  // правило е резервен път при мрежова грешка. Изделие без правило се
  // отчита само като бройка — без складово движение.
  for (const key of Object.keys(rec.ops || {})) {
    const base = nitOpBase(key), pick = nitOpPick(key);
    if (!pick) continue;
    const rule = NIT_PICK_RULES[base] && NIT_PICK_RULES[base][pick];
    if (!rule) continue;
    const now = nitOpTotal(rec.ops[key]);
    const done = Number(rec.stocked[key]) || 0;
    const delta = now - done;
    if (!delta) continue;
    const pid = ids[pick];
    if (!pid) { if (delta > 0) missing.push(pick + " (" + base + ")"); continue; }
    // „МПК колело на крак": избира се ПОЛОВИНАТА (механизмът), но се
    // заприходява НЕЙНИЯТ КРАК — възелът от рецептата ѝ. Кракът с колело има
    // складов живот: тук влиза, при „затваряне с крак" излиза като цял.
    let creditPid = pid, creditCode = pick;
    if (/^МПК колело на крак/.test(base)) {
      let leg = null;
      try { leg = await nitMpkLegNode(pid); } catch (e) { leg = null; }
      if (!leg) {
        if (delta > 0) missing.push(pick + " (" + base + " — кракът не е намерен в рецептата, нищо не е записано в склада)");
        continue;
      }
      creditPid = leg.pid; creditCode = leg.code || pick;
      // Кракът е нит-управляван — потокът не бива да го складира втори път.
      if (leg.code && typeof erpNitManagedCode === "function" && erpNitManagedCode._set) erpNitManagedCode._set.add(String(leg.code));
    }
    const ref = `нит:${rec.worker}|${rec.date}|${key}`;
    moves.push({
      product_id: creditPid, kind: "заприходяване", quantity: delta, ref,
      note: `Занитване · ${rec.worker} · ${base} (${pick}${creditCode !== pick ? " → крак " + creditCode : ""})` + (delta < 0 ? " · корекция" : ""),
    });
    // 1) Динамично: рецептата от базата, в момента на записа.
    let dyn = null;
    try { dyn = await nitDynamicConsume(base, pick, ids); } catch (e) { dyn = null; }
    if (dyn && dyn.items.length) {
      const cnote = `Занитване · ${rec.worker} · ${base} (${pick}) — влага по рецепта` + (delta < 0 ? " · корекция" : "");
      dyn.items.forEach(it => {
        const q = delta * (Number(it.qty) || 1);
        if (it.mid) matMoves.push({ material_id: it.mid, kind: "изписване", quantity: -q, ref, note: cnote, created_by: rec.worker || null });
        else if (it.pid) moves.push({ product_id: it.pid, kind: "изписване", quantity: -q, ref, note: cnote });
      });
      // Голият крак-BOM код влиза в предпазителя (потокът да не го складира).
      if (dyn.legCode && typeof erpNitManagedCode === "function" && erpNitManagedCode._set) erpNitManagedCode._set.add(String(dyn.legCode));
    } else if ((rule.consume || []).length) {
      // 2) Резервен път: статичното правило (кодове).
      (rule.consume || []).forEach(item => {
        const q = delta * (Number(item.per) || 1);
        const cnote = `Занитване · ${rec.worker} · ${base} (${pick}) — влага ${item.code}` + (delta < 0 ? " · корекция" : "");
        if (item.mat) {
          const mid = mids[item.code];
          if (mid) matMoves.push({ material_id: mid, kind: "изписване", quantity: -q, ref, note: cnote, created_by: rec.worker || null });
          else if (delta > 0) missing.push(item.code + " (материал при " + base + ")");
        } else {
          const cpid = ids[item.code];
          if (cpid) moves.push({ product_id: cpid, kind: "изписване", quantity: -q, ref, note: cnote });
          else if (delta > 0) missing.push(item.code + " (влагане при " + base + ")");
        }
      });
    } else if (delta > 0) {
      missing.push(pick + " (влагане по рецепта неуспешно — само заприходено)");
    }
    // creditCode: при „МПК колело на крак" прогресът по заявките върви по
    // кода на КРАКА (него заприходяваме), не по избраната половина.
    applied.push({ key, now, op: base, sk: "d", code: creditCode, delta });
  }
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
  // Активните заявки (за кратките падащи списъци) — на заден фон.
  nitLoadActiveCodes().then(() => { const v = document.getElementById("nit-view"); if (v && nitMech != null) nitRender(); }).catch(() => {});
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
      ${!isW ? Object.keys(NIT_HISTORY_SETS).map(k => `<button class="btn btn-small nit-hist-btn" data-set="${escapeAttr(k)}" title="Наличности и последните движения на всички кодове по веригата на механизма — само за офиса">📜 ${escapeHtml(k)} — движения</button>`).join("") : ""}
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
  v.querySelectorAll(".nit-hist-btn").forEach(b => b.addEventListener("click", () => nitHistoryView(b.dataset.set)));
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
          let opts = pick.list.slice();
          // Кратък списък: само изделията с пуснати заявки (освен при „всички").
          let filtered = false;
          if (!NIT_PICK_ALL && NIT_ACTIVE && NIT_ACTIVE.size) {
            const act = opts.filter(([c]) => nitPickActive(o.n, c));
            if (act.length) { opts = act; filtered = true; }
          }
          opts.sort((a, b) => a[1].localeCompare(b[1], "bg"));
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
            ? `<input type="number" class="nit-q nit-pickqty" data-op="${escapeAttr(o.n)}" data-pickref="${selId}" step="any" inputmode="decimal" value="" placeholder="брой" />`
            : `<span class="rog-ld">
                <label class="nit-ldl">Л <input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-side="l" data-pickref="${selId}" step="any" inputmode="decimal" value="" placeholder="ляв" /></label>
                <label class="nit-ldl">Д <input type="number" class="nit-q" data-op="${escapeAttr(o.n)}" data-side="d" data-pickref="${selId}" step="any" inputmode="decimal" value="" placeholder="десен" /></label>
              </span>`;
          return `<div class="rog-row">
            <div class="rog-op">${escapeHtml(o.n)}
              <div class="nit-opcodes">код: <b>по избраното изделие</b> <span class="nit-opcodes-none">(влага ${escapeHtml(pick.from || "")})</span></div>
              ${filtered ? `<div class="nit-opcodes-none">само с пуснати заявки (${opts.length}) · <label class="nit-showall"><input type="checkbox" class="nit-allchk" /> покажи всички</label></div>`
                        : (NIT_PICK_ALL ? `<div class="nit-opcodes-none">всички изделия · <label class="nit-showall"><input type="checkbox" class="nit-allchk" checked /> покажи всички</label></div>` : "")}
              ${todays.length ? `<div class="nit-today">днес: ${todays.join(" &nbsp;|&nbsp; ")}</div>` : ""}
            </div>
            <div class="rog-inputs nit-pickwrap">
              <select class="nit-pick" id="${selId}">
                <option value="">— избери —</option>
                ${opts.map(([c, n]) => { const wired = NIT_PICK_RULES[o.n] && NIT_PICK_RULES[o.n][c]; return `<option value="${escapeAttr(c)}">${escapeHtml(n)} · ${escapeHtml(c)}${wired ? " ✓" : ""}</option>`; }).join("")}
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
  v.querySelectorAll(".nit-allchk").forEach(chk => chk.addEventListener("change", () => { NIT_PICK_ALL = chk.checked; nitRender(); }));
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
