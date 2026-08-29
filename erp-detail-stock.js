/* Данко Системс — Склад за детайли/полуфабрикати.
   Наличност на готовите детайли/възли (не суровини). При пускане в производство
   системата приспада наличното и праща в цех само недостига (виж erpFlowApply).
   Наличност = сбор от движенията (начално / заприходяване / изписване / корекция).
   Ползва erp-detail-stock.sql (таблица product_movements + изглед v_product_stock). */

let DS_TERM = "";
let DS_ONLY_STOCK = false;
let DS_ONLY_NEG = false;   // показва само детайли с отрицателна наличност
let DS_HAS_DRAW = new Set();   // id-та на продукти с поне един чертеж (за оцветяване на бутона)
let DS_BLOCKED = {};       // product_id -> блокирано от пуснати заявки (flow_netting)
let DS_BLOCKED_TIP = {};   // product_id -> „заявка №… : брой" за подсказката

// Блокираните наличности идват от резервациите на пуснатите заявки
// (app_config → flow_netting). Заявката „пази" взетото от склад, докато
// производството ѝ го консумира; приключилите заявки не блокират нищо.
async function dsLoadBlocked() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
    const byOrder = (data && data.data && data.data.byOrder) || {};
    const oids = Object.keys(byOrder);
    // Номер, статус и ДОСТАВЕНАТА част на заявките (малко на брой — само пуснатите).
    const names = {}, done = {}, factor = {};
    if (oids.length) {
      try {
        const { data: cos } = await sb.from("customer_orders").select("id,data").in("id", oids);
        const seen = new Set();
        (cos || []).forEach(r => {
          const d = r.data || {};
          seen.add(String(r.id));
          names[String(r.id)] = d.ourNo ? ("заявка №" + d.ourNo) : ("заявка #" + r.id);
          if (d.status === "завършена") done[String(r.id)] = true;
          // Частично доставена заявка блокира само НЕДОСТАВЕНАТА си част —
          // доставените бройки са изписани с продажбата.
          factor[String(r.id)] = (typeof erpOrderRemainFactor === "function") ? erpOrderRemainFactor(d) : 1;
        });
        oids.forEach(k => { if (!seen.has(String(k))) done[String(k)] = true; });   // изтрита заявка
      } catch (e) { /* без имена — показваме само броя */ }
    }
    const tot = {}, per = {};
    oids.forEach(oid => {
      if (done[oid]) return;                       // приключила заявка — не блокира
      const fx = factor[oid] != null ? factor[oid] : 1;
      if (!(fx > 0)) return;                       // всичко доставено — нищо не блокира
      const m = byOrder[oid] || {};
      Object.keys(m).forEach(pid => {
        const q = Math.round((Number(m[pid]) || 0) * fx);
        if (!(q > 0)) return;
        tot[pid] = (tot[pid] || 0) + q;
        (per[pid] || (per[pid] = [])).push(`${names[oid] || ("поръчка " + String(oid).slice(0, 8))}: ${q}`);
      });
    });
    const tips = {};
    Object.keys(per).forEach(pid => { tips[pid] = per[pid].join(", "); });
    DS_BLOCKED = tot; DS_BLOCKED_TIP = tips;
  } catch (e) { /* при грешка оставаме на старите стойности */ }
}

let DS_SEMI = {};       // pid -> полу-готови: отчетени на първата операция, но не излезли от последната
let DS_SEMI_TIP = {};   // pid -> разбивка за подсказката
let DS_NEED = {};       // pid -> колко още трябва да излязат от цеха за активните заявки
let DS_NEED_TIP = {};   // pid -> разбивка по заявки

// Полу-готово и „трябват за заявките" — от поточните задачи (без архивите).
// За всяка активна верига: полу-готово = отчетено на ПЪРВАТА операция минус
// излязло от ПОСЛЕДНАТА (нарязани 30, огънати 20 → 10 между операциите);
// „трябват" = остатъкът на последната операция (количество − произведено) по
// заявъчните вериги. „За склад" веригите дават полу-готово, но не „трябват".
async function dsLoadFlowInfo() {
  try {
    const { data } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
    const rows = (data || []).map(r => r.data || {}).filter(t => {
      const src = t.source || {};
      return src.kind === "series" && src.seriesKey && !String(src.seriesKey).includes("¦арх:");
    });
    const byKey = {};
    rows.forEach(t => { byKey[t.source.seriesKey] = t; });
    const label = src => src.stock ? "за склад"
      : (((src.orders || []).map(o => (o && o.no) ? ("№" + o.no) : null).filter(Boolean).join(", ")) || "заявка");
    const semi = {}, semiTip = {}, need = {}, needTip = {};
    rows.forEach(t => {
      const src = t.source || {};
      if (!src.last || !src.pid) return;
      // Първата операция на веригата — назад по prevKey.
      let first = t; const seen = new Set();
      while (first.source.prevKey && byKey[first.source.prevKey] && !seen.has(first.source.seriesKey)) {
        seen.add(first.source.seriesKey);
        first = byKey[first.source.prevKey];
      }
      const s = Math.max(0, (Number(first.produced) || 0) - (Number(t.produced) || 0));
      if (s > 0) {
        semi[src.pid] = (Number(semi[src.pid]) || 0) + s;
        (semiTip[src.pid] || (semiTip[src.pid] = [])).push(`${label(src)}: ${first.operation || ""} ${erpNum(first.produced)} → ${t.operation || ""} ${erpNum(t.produced)}`);
      }
      if (!src.stock) {
        const rem = Math.max(0, (Number(t.qty) || 0) - (Number(t.produced) || 0));
        if (rem > 0) {
          need[src.pid] = (Number(need[src.pid]) || 0) + rem;
          (needTip[src.pid] || (needTip[src.pid] = [])).push(`${label(src)}: още ${erpNum(rem)}`);
        }
      }
    });
    DS_SEMI = semi; DS_NEED = need;
    DS_SEMI_TIP = {}; DS_NEED_TIP = {};
    Object.keys(semiTip).forEach(pid => { DS_SEMI_TIP[pid] = semiTip[pid].join(", "); });
    Object.keys(needTip).forEach(pid => { DS_NEED_TIP[pid] = needTip[pid].join(", "); });
  } catch (e) { /* при грешка оставаме на старите стойности */ }
}

// Чете ВСИЧКИ продукти (със странициране — Supabase връща макс. 1000 наведнъж).
async function dsFetchAllProducts(cols) {
  const out = []; const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await sb.from("products").select(cols).range(from, from + CHUNK - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < CHUNK) break;
  }
  return out;
}
// Зарежда наведнъж кои продукти имат чертежи (products.drawings непразно).
// Леко: тегли само id-тата на продуктите С чертежи (не целия jsonb списък —
// при хиляди продукти това бяха мегабайти при всяко отваряне на склада).
// Прави се ВЕДНЪЖ на сесия и НИКОГА не спира отварянето на склада: при грешка
// бутоните за чертежи просто остават неоцветени.
let DS_DRAW_LOADED = false;
async function dsLoadHasDrawings(force) {
  if (DS_DRAW_LOADED && !force) return;
  const found = new Set();
  try {
    const CHUNK = 1000;
    for (let from = 0; ; from += CHUNK) {
      const { data, error } = await sb.from("products").select("id")
        .not("drawings", "is", null).neq("drawings", "[]")
        .order("id", { ascending: true }).range(from, from + CHUNK - 1);
      if (error) throw error;
      (data || []).forEach(r => found.add(Number(r.id)));
      if (!data || data.length < CHUNK) break;
    }
    DS_HAS_DRAW = found;
    DS_DRAW_LOADED = true;
  } catch (e) {
    console.warn("Склад детайли: чертежите не се заредиха —", e && (e.message || e));
  }
}
// Има ли продуктът чертеж? Зареденото в паметта има превес (за да отразява промени).
function dsHasDrawing(p) {
  if (Array.isArray(p.drawings)) return p.drawings.length > 0;
  return DS_HAS_DRAW.has(Number(p.id));
}

// Кои продукти са „детайли/възли" (не крайни артикули без рецепта-предназначение):
// показваме полуфабрикатите + всичко, което участва в рецепта на друг продукт.
function dsIsDetail(p) {
  if (p.is_semifinished) return true;
  // Ползван като част/възел в ничия рецепта → надежден сигнал, че е детайл
  // (независимо дали импортът го е сложил като „артикул").
  if (ERP.childIds && ERP.childIds.has(Number(p.id))) return true;
  const g = (p.group_name || "").toLowerCase();
  if (g.includes("детайл") || g.includes("възл") || g.includes("полуфабрикат") || g.includes("заготов")) return true;
  return false;
}
// Има ли продуктът собствена рецепта (може да се произведе → готовото влиза тук).
function dsIsProducible(p) {
  const ls = ERP.linesByProduct && ERP.linesByProduct[p.id];
  return !!(ls && ls.length);
}
// В списъка показваме: детайли/възли + всичко ПРОИЗВОДИМО (има рецепта — при
// готовност влиза в Склад детайли) + всичко с реална наличност/движения. Така
// краен продукт с рецепта (напр. 103435) също се вижда като позиция.
function dsShowInStock(p) {
  return dsIsDetail(p) || dsIsProducible(p) || (Number(p.stock) || 0) !== 0;
}

// Опреснява наличностите на продуктите от v_product_stock (готовото, заприходено
// от производствената дъска, не минава през ERP кеша — затова презареждаме тук).
// force = true при изрично опресняване (след движение/сглобяване).
async function dsRefreshStock(force) {
  // Ако наличностите са изтеглени преди секунди (напр. току-що при отварянето
  // на ЕРП), не ги дърпаме пак — това беше втори пълен обход при всяко влизане.
  const fresh = ERP._stockAt && (Date.now() - ERP._stockAt) < 20000;
  if (fresh && !force) return;
  const blockedP = dsLoadBlocked();   // паралелно с наличностите (грешките са уловени вътре)
  const flowP = dsLoadFlowInfo();     // полу-готово и „трябват" — също паралелно
  try {
    // Теглим САМО ненулевите наличности (те са малцинство) — базата така или
    // иначе смята целия изглед, но пращаме в мрежата стотици реда вместо
    // хиляди нули, и почти винаги стигаме с една страница.
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("v_product_stock").select("id,stock")
        .neq("stock", 0).order("id", { ascending: true }).range(from, from + 999);
      if (error) return;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const byId = {}; rows.forEach(r => { byId[r.id] = Number(r.stock) || 0; });
    (ERP.products || []).forEach(p => { p.stock = byId[p.id] != null ? byId[p.id] : 0; });
    ERP._stockAt = Date.now();
  } catch (e) { /* при грешка оставаме на кешираните стойности */ }
  try { await blockedP; } catch (e) {}
  try { await flowP; } catch (e) {}
}

// Обвивка: каквото и да се обърка вътре, екранът СЕ ОТВАРЯ и показва точната
// грешка (иначе табът оставаше празен и не се разбираше защо).
async function erpRenderDetailStock() {
  try { await erpRenderDetailStockInner(); }
  catch (e) {
    console.error("Склад детайли:", e);
    erpView().innerHTML = `<div class="erp-error">
      <h3>📦 Склад детайли — възникна грешка</h3>
      <p>${escapeHtml((e && (e.message || e.details)) || String(e))}</p>
      <p class="hint">Опитай пак с бутона по-долу. Ако се повтаря, покажи това съобщение на Данко.</p>
      <button class="btn btn-small btn-primary" id="ds-retry">↻ Опитай пак</button>
    </div>`;
    const rb = document.getElementById("ds-retry");
    if (rb) rb.addEventListener("click", () => erpRenderDetailStock());
  }
}

async function erpRenderDetailStockInner() {
  try { await erpEnsureLoaded(); }
  catch (e) { erpView().innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  await dsRefreshStock();   // винаги свежи наличности (готовото от цеха се вижда веднага)

  // Проверка дали складът за детайли е създаден — веднъж на сесия (пестим
  // една заявка при всяко отваряне).
  if (!window.DS_PROBED) {
    const probe = await sb.from("product_movements").select("id").limit(1);
    window.DS_PROBED = !probe.error;
    if (probe.error) {
      erpView().innerHTML = `
        <div class="erp-error">
          <h3>📦 Склад за детайли — още не е включен</h3>
          <p>За да следим наличности и на детайлите/възлите (не само суровините), пусни веднъж
          файла <code>erp-detail-stock.sql</code> в Supabase → SQL Editor.</p>
          <p><a href="https://supabase.com/dashboard/project/hwbblteomrrahfrsyuow/sql/new" target="_blank" class="btn btn-small btn-primary">Отвори SQL Editor</a></p>
          <p class="hint">След това презареди страницата и се върни тук.</p>
        </div>`;
      return;
    }
  }

  const totalWith = ERP.products.filter(dsIsDetail).filter(p => (Number(p.stock) || 0) > 0).length;
  erpView().innerHTML = `
    <div class="erp-head-row">
      <h3 class="erp-h">📦 Склад за детайли/полуфабрикати</h3>
      <span class="erp-muted">${totalWith} детайла с наличност</span>
    </div>
    <p class="hint"><b>Наличност</b> е реално готовото на рафта (отдолу в клетката — колко са пазени за пуснати
      заявки и колко са свободни); <b>Полу-готово</b> са бройките между операциите в цеха (напр. нарязани, но
      неогънати); <b>Трябват за заявките</b> е колко още трябва да излязат от цеховете за активните заявки.
      Задръж мишката върху числата за разбивка по заявки. При пускане на заявка системата пита какво от
      наличното да се ползва — ти решаваш, ред по ред.</p>
    <div class="erp-toolbar">
      <input type="search" id="ds-q" placeholder="Търси код или име…" value="${escapeAttr(DS_TERM)}" autocomplete="off" />
      <label class="erp-inline"><input type="checkbox" id="ds-only" ${DS_ONLY_STOCK ? "checked" : ""} /> само с наличност</label>
      <button type="button" class="btn btn-small${DS_ONLY_NEG ? " btn-danger" : ""}" id="ds-neg" title="Показва само детайлите, чиято наличност е под нулата (изписано е повече, отколкото е заприходено)">⚠ Отрицателни наличности</button>
      <button type="button" class="btn btn-small" id="ds-acc" title="Наличностите на аксесоарите (спирачки, пружини, болтове, степенчати колела) — изписват се при продажбата, не при сглобяването">🔩 Аксесоари</button>
      <button type="button" class="btn btn-small" id="ds-nodemap" title="Цял екран: къде се включва изделието (нагоре) и кои ВЪЗЛИ влизат в него (надолу) — само кодовете на възлите, без дребните части">🌳 Структура (възли)</button>
      <span id="ds-count" class="erp-muted"></span>
      <span class="spacer"></span>
      <label class="btn btn-small" for="ds-draw-bulk" title="Избери много чертежи или архив (ZIP, RAR, 7z) — разпределят се по кода в началото на името">📎 Качи чертежи наведнъж</label>
      <input type="file" id="ds-draw-bulk" accept="image/*,.pdf,application/pdf,.zip,.rar,.7z,.tar,.gz,.tgz,application/zip,application/x-zip-compressed,application/vnd.rar,application/x-rar-compressed,application/x-7z-compressed,.dwg,.dxf,.step,.stp,.igs,.iges" multiple hidden />
      <button type="button" class="btn btn-small" id="ds-draw-check" title="Сверява записаните чертежи с реалните файлове в облака">🔎 Провери чертежите</button>
      <button type="button" class="btn btn-small" id="ds-fixcls" title="Намира продукти, ползвани като части в рецепти, но маркирани като артикул — и ги оправя, за да влязат тук">🔧 Провери класификацията</button>
      <button type="button" class="btn btn-small" id="ds-dedup" title="Открива продукти с еднакъв код, заведени два пъти (наличността на единия, рецептата на другия) — и ги обединява">🔗 Дублирани по код</button>
    </div>
    <p class="hint">💡 За масово качване на чертежи: кръсти всеки файл да <b>започва с кода</b> на детайла, напр.
      <code>100526_Нож-Николети_3мм.pdf</code>. Дебелината (напр. <code>3мм</code>) я слагай в името за твое удобство — системата разпознава детайла по кода отпред.
      Може да качиш и <b>ZIP архив</b> — системата сама го разпакова и разпределя чертежите.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Детайл/възел</th><th class="num" title="Реално готово на рафта; отдолу — пазени за пуснати заявки и свободни">Наличност</th><th class="num" title="Между операциите в цеха: отчетени на първата, но не излезли от последната (напр. нарязани, неогънати)">Полу-готово</th><th class="num" title="Колко още трябва да излязат от цеховете за активните заявки (остатък по последната операция)">Трябват за заявките</th><th>Движение</th></tr></thead>
      <tbody id="ds-tbody"></tbody>
    </table>`;

  const q = document.getElementById("ds-q");
  // Търсене „на живо" без пре-рисуване на целия изглед (за да не губи фокус полето).
  if (q) q.addEventListener("input", uiDebounce(e => { DS_TERM = e.target.value; dsFillRows(); }, 180));
  const only = document.getElementById("ds-only");
  if (only) only.addEventListener("change", e => { DS_ONLY_STOCK = e.target.checked; dsFillRows(); });
  const neg = document.getElementById("ds-neg");
  if (neg) neg.addEventListener("click", () => {
    DS_ONLY_NEG = !DS_ONLY_NEG;
    neg.classList.toggle("btn-danger", DS_ONLY_NEG);
    dsFillRows();
  });
  const acc = document.getElementById("ds-acc");
  if (acc) acc.addEventListener("click", dsAccessoriesDialog);
  const exp = document.getElementById("ds-export");
  if (exp) exp.addEventListener("click", dsExportTemplate);
  const db = document.getElementById("ds-draw-bulk");
  if (db) db.addEventListener("change", e => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) dsBulkDrawings(fs); });
  const dc = document.getElementById("ds-draw-check");
  if (dc) dc.addEventListener("click", dsCheckDrawings);
  const fc = document.getElementById("ds-fixcls");
  if (fc) fc.addEventListener("click", dsFixClassification);
  const dd = document.getElementById("ds-dedup");
  if (dd) dd.addEventListener("click", dsFindDuplicates);
  const rs = document.getElementById("ds-reset");
  if (rs) rs.addEventListener("click", dsResetTestMovements);
  const nm = document.getElementById("ds-nodemap");
  if (nm) nm.addEventListener("click", () => dsNodeMapOpen(null));
  dsFillRows();
  if (q) q.focus();
  // Чертежите се дозареждат отзад — таблицата вече е на екрана и НЕ я чака.
  dsLoadHasDrawings().then(() => dsFillRows()).catch(() => {});
}

// Пълни само редовете на таблицата според текущото търсене/филтър (без да
// пипа търсачката) — така фокусът остава и се пише плавно.
function dsFillRows() {
  const tbody = document.getElementById("ds-tbody");
  if (!tbody) return;
  try { dsFillRowsInner(tbody); }
  catch (e) {
    console.error("Склад детайли (редове):", e);
    tbody.innerHTML = `<tr><td colspan="5" class="erp-warn">Грешка при показване на списъка: ${escapeHtml((e && e.message) || String(e))}</td></tr>`;
  }
}

function dsFillRowsInner(tbody) {
  let list = (ERP.products || []).filter(dsShowInStock);
  if (DS_TERM) { const q = DS_TERM.toLowerCase().trim(); list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q)); }
  if (DS_ONLY_STOCK) list = list.filter(p => (Number(p.stock) || 0) > 0);
  if (DS_ONLY_NEG) {
    list = list.filter(p => (Number(p.stock) || 0) < 0);
    // Най-големият минус най-отгоре — там е най-спешното.
    list.sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0) || (a.name || "").localeCompare(b.name || "", "bg"));
  } else {
    list.sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0) || (a.name || "").localeCompare(b.name || "", "bg"));
  }

  const canProduce = (typeof produceAllowed !== "function" || produceAllowed());
  const shown = list.slice(0, 300);
  tbody.innerHTML = shown.map(p => {
    const stock = Number(p.stock) || 0;
    const blocked = Math.min(Math.max(stock, 0), Number(DS_BLOCKED[p.id]) || 0);
    const free = stock - blocked;
    const semi = Number(DS_SEMI[p.id]) || 0;
    const needQ = Number(DS_NEED[p.id]) || 0;
    return `
    <tr>
      <td data-label="Код"><b>${escapeHtml(p.code || "")}</b></td>
      <td data-label="Детайл">${escapeHtml(p.name || "")} <span class="erp-muted">#${p.id}</span>${p.is_semifinished ? ` <span class="erp-muted">възел</span>` : ""}</td>
      <td class="num" data-label="Наличност"${DS_BLOCKED_TIP[p.id] ? ` title="За заявки: ${escapeAttr(DS_BLOCKED_TIP[p.id])}"` : ""}>
        <b class="${stock > 0 ? "" : stock < 0 ? "erp-warn" : "erp-muted"}">${erpNum(stock)}</b> ${escapeHtml(p.unit || "бр.")}
        ${blocked > 0 ? `<div class="erp-muted co-val-full">за заявки ${erpNum(blocked)} · свободни ${erpNum(free)}</div>` : ""}
      </td>
      <td class="num" data-label="Полу-готово"${DS_SEMI_TIP[p.id] ? ` title="${escapeAttr(DS_SEMI_TIP[p.id])}"` : ""}>${semi ? `<b>${erpNum(semi)}</b>` : `<span class="erp-muted">—</span>`}</td>
      <td class="num" data-label="Трябват"${DS_NEED_TIP[p.id] ? ` title="${escapeAttr(DS_NEED_TIP[p.id])}"` : ""}>${needQ ? `<b>${erpNum(needQ)}</b>` : `<span class="erp-muted">—</span>`}</td>
      <td data-label="Движение">
        ${canProduce ? `<button type="button" class="btn btn-small btn-primary ds-prod" data-id="${p.id}" title="Пусни по цеховете; готовото влиза тук">🏭 произведи</button>` : ""}
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="заприходяване">＋ заприходи</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="изписване">− изпиши</button>
        <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="корекция">✎ наличност</button>
        ${((ERP.linesByProduct && ERP.linesByProduct[p.id]) || []).some(l => l.child_product_id) ? `<button type="button" class="btn btn-small ds-asm" data-id="${p.id}" title="Опаковка: изписва частите по рецептата от склада и заприходява готовия артикул — без операция в цех">🧩 сглоби</button>` : ""}
        ${ERP.childIds && ERP.childIds.has(Number(p.id)) ? `<button type="button" class="btn btn-small ds-wu" data-id="${p.id}" title="Къде се влага този възел/детайл — директно и в кои крайни продукти">↥ влага се в</button>` : ""}
        <button type="button" class="btn btn-small ds-draw${dsHasDrawing(p) ? " ds-draw-has" : ""}" data-id="${p.id}" title="${dsHasDrawing(p) ? "Има прикачен чертеж" : "Няма чертеж"}">📎 чертежи</button>
        <button type="button" class="btn btn-small ds-log" data-id="${p.id}">история</button>
      </td>
    </tr>`; }).join("") || `<tr><td colspan="6" class="report-empty">Няма детайли по този филтър.</td></tr>`;

  const cnt = document.getElementById("ds-count");
  if (cnt) cnt.textContent = list.length > 300 ? `показани 300 от ${list.length}` : `${list.length} детайла`;
  tbody.querySelectorAll(".ds-mv").forEach(b => b.addEventListener("click", () => dsMoveDialog(Number(b.dataset.id), b.dataset.k)));
  tbody.querySelectorAll(".ds-asm").forEach(b => b.addEventListener("click", () => dsAssembleDialog(Number(b.dataset.id))));
  tbody.querySelectorAll(".ds-wu").forEach(b => b.addEventListener("click", () => {
    if (typeof erpWhereUsedDialog === "function") erpWhereUsedDialog(Number(b.dataset.id));
    else alert("Модулът Продукти не е зареден. Презареди страницата.");
  }));
  tbody.querySelectorAll(".ds-log").forEach(b => b.addEventListener("click", () => dsHistory(Number(b.dataset.id))));
  tbody.querySelectorAll(".ds-prod").forEach(b => b.addEventListener("click", () => dsProduce(Number(b.dataset.id))));
  tbody.querySelectorAll(".ds-draw").forEach(b => b.addEventListener("click", () => {
    if (typeof erpNodeDrawings === "function") erpNodeDrawings(Number(b.dataset.id));
    else alert("Модулът за чертежи не е зареден. Презареди страницата.");
  }));
}

// 🔩 Аксесоари: наличностите на кодовете от NIT_ACCESSORY_* (спирачки,
// пружини, болтове, степенчати колела). Изписват се при продажбата, затова
// тук се вижда „реалната кутия на рафта" — с бърз достъп до историята.
async function dsAccessoriesDialog() {
  try {
    await dsRefreshStock(true);
    const accP = (typeof NIT_ACCESSORY_CODES !== "undefined") ? [...NIT_ACCESSORY_CODES] : [];
    const accM = (typeof NIT_ACCESSORY_MAT_CODES !== "undefined") ? [...NIT_ACCESSORY_MAT_CODES] : [];
    const watchP = (typeof NIT_ACCESSORY_WATCH_CODES !== "undefined") ? [...NIT_ACCESSORY_WATCH_CODES] : [];
    const watchM = (typeof NIT_ACCESSORY_WATCH_MATS !== "undefined") ? [...NIT_ACCESSORY_WATCH_MATS] : [];
    const isWatch = new Set([...watchP, ...watchM]);
    const pc = [...accP, ...watchP].sort();
    const mc = [...accM, ...watchM].sort();
    if (!pc.length && !mc.length) { alert("Няма зададени аксесоарни кодове (списъкът е в nit.js)."); return; }
    let mats = [];
    try {
      const { data } = await sb.from("v_material_stock").select("id,code,name,stock").in("code", mc);
      mats = data || [];
    } catch (e) { /* показваме поне продуктите */ }
    const row = (code, name, stock, kind, extra) => `<tr>
      <td data-label="Код"><b>${escapeHtml(code)}</b></td><td data-label="Аксесоар">${escapeHtml(name || "")}</td>
      <td class="num" data-label="Наличност"><b class="${stock < 0 ? "erp-warn" : stock > 0 ? "" : "erp-muted"}">${erpNum(stock)}</b></td>
      <td data-label="Склад">${kind}</td>
      <td data-label="Изписва се">${isWatch.has(code) ? '<span class="erp-muted">при монтажа (Занитване/колела)</span>' : "при продажбата"}</td>
      <td>${extra || ""}</td></tr>`;
    const pRows = pc.map(c => {
      const p = (ERP.products || []).find(x => String(x.code || "").trim() === c);
      if (!p) return row(c, "— не е намерен в Продукти", 0, "детайли", "");
      const blocked = Math.min(Math.max(Number(p.stock) || 0, 0), Number((typeof DS_BLOCKED !== "undefined" && DS_BLOCKED[p.id]) || 0));
      return row(c, p.name, Number(p.stock) || 0, "детайли",
        `${blocked ? `🔒 ${erpNum(blocked)} блок. ` : ""}<button type="button" class="btn btn-small ds-acc-log" data-id="${p.id}">история</button>`);
    }).join("");
    const mRows = mc.map(c => {
      const m = mats.find(x => String(x.code || "").trim() === c);
      return m ? row(c, m.name, Number(m.stock) || 0, "материали", "")
               : row(c, "— не е намерен в Материали", 0, "материали", "");
    }).join("");
    let wrap = document.getElementById("ds-acc-modal");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "ds-acc-modal"; wrap.className = "overlay dsnm-overlay";
      document.body.appendChild(wrap);
    }
    wrap.innerHTML = `<div class="dsnm-box">
      <div class="dsnm-top-bar">
        <h3>🔩 Аксесоари — наличности</h3>
        <span class="spacer"></span>
        <button type="button" class="btn btn-small" id="ds-acc-close">✕ Затвори</button>
      </div>
      <p class="hint">Аксесоарите се слагат на палета преди експедиция: сглобяването в Занитване НЕ ги изписва —
        изписват се при осчетоводяване на Продажба. Осите са тук само за следене — те се монтират и изписват
        при самата операция. Минус = изписано повече, отколкото е отчетено произведено/купено.
        Списъкът с кодовете се допълва в nit.js.</p>
      <table class="report-table erp-table">
        <thead><tr><th>Код</th><th>Аксесоар</th><th class="num">Наличност</th><th>Склад</th><th>Изписва се</th><th></th></tr></thead>
        <tbody>${pRows}${mRows}</tbody>
      </table></div>`;
    wrap.querySelector("#ds-acc-close").addEventListener("click", () => wrap.remove());
    wrap.querySelectorAll(".ds-acc-log").forEach(b => b.addEventListener("click", () => dsHistory(Number(b.dataset.id))));
  } catch (e) { alert("Аксесоари: " + ((e && e.message) || e)); }
}

// Пуска детайл за производство ЗА СКЛАД (без заявка) — минава по цеховете и
// готовото се заприходява тук автоматично след последната операция.
async function dsProduce(pid) {
  const p = ERP.prodById[pid] || {};
  if (typeof erpProduceToStock !== "function") { alert("Модулът за производство не е зареден."); return; }
  const v = prompt(`Колко броя „${p.code ? p.code + " " : ""}${p.name}" да пусна за производство (влизат в Склад детайли, щом минат цеховете)?`, "");
  if (v === null) return;
  const q = erpToNum(v);
  if (!(q > 0)) { if (v.trim() !== "") alert("Въведи брой по-голям от 0."); return; }
  const res = await erpProduceToStock(pid, q);
  if (!res || res.error) return;
  const miss = (res.missing || []);
  alert(`Пуснах ${erpNum(q)} бр. „${p.name}" по цеховете.\n`
    + `Щом минат последната операция, ще влязат автоматично в Склад детайли.`
    + (miss.length ? `\n\n⚠ Липсват детайли: ` + miss.map(m => m.code || m.name).join(", ") : ""));
}

/* ---------- Нулиране на тестовите движения (връща склада до внесената база) ----------
   Всичко, което цикълът (пускане→производство→продажба) записва, е с ЕТИКЕТ:
     product_movements:  order: / prod: / sale: / orderdone:
     stock_movements:     order: / sale:
   Внесената начална наличност е „корекция" БЕЗ етикет и покупките имат друг етикет,
   затова триенето по тези етикети връща склада точно до внесеното, без да пипа базата.
   За тестване: пусни заявка на живо → провери целия цикъл → нулирай → почни чисто. */
async function dsResetTestMovements() {
  const msg = "⚠ НУЛИРАНЕ НА ТЕСТОВИТЕ ДВИЖЕНИЯ\n\n"
    + "Връща склада ТОЧНО до внесената база.\n\n"
    + "ЩЕ СЕ ИЗТРИЯТ:\n"
    + "• движенията от производство/влагане/продажба\n"
    + "   (order: / prod: / consume: / sale: / orderdone: / matprod:)\n"
    + "• всички поточни задачи по цеховете\n"
    + "• флагът „в производство“ на заявките (стават чакащи)\n\n"
    + "ЩЕ ОСТАНАТ НЕПОКЪТНАТИ:\n"
    + "• внесените начални наличности (корекции без етикет)\n"
    + "• материалният склад от покупки\n"
    + "• рецепти, продукти, заявки (само флагът се маха)\n\n"
    + "Продължавам?";
  if (!confirm(msg)) return;
  const typed = prompt("За потвърждение напиши с ГЛАВНИ букви:  НУЛИРАЙ");
  if ((typed || "").trim() !== "НУЛИРАЙ") { alert("Отказано — текстът не съвпадна."); return; }

  const log = [];
  try {
    // 1) Движения в Склад детайли (готово, нетване, влагане при сглобяване,
    //    продажби, ръчно заприходено). Продажбите пишат ref „Продажба <№> · <клиент>".
    for (const pfx of ["order:", "prod:", "consume:", "sale:", "orderdone:", "Продажба "]) {
      const { error } = await sb.from("product_movements").delete().like("ref", pfx + "%");
      if (error) throw new Error("детайлни движения (" + pfx + "): " + error.message);
    }
    // 2) Материални движения от пускане, от рязане и от продажби (покупките имат
    //    друг етикет и остават).
    for (const pfx of ["order:", "matprod:", "sale:", "Продажба "]) {
      const { error } = await sb.from("stock_movements").delete().like("ref", pfx + "%");
      if (error) throw new Error("материални движения (" + pfx + "): " + error.message);
    }
    // 3) Поточни задачи по цеховете.
    const { error: tErr } = await sb.from("tasks").delete().eq("data->source->>flow", "true");
    if (tErr) throw new Error("поточни задачи: " + tErr.message);
    // 3б) Резервациите за кръстосано нетване (flow_netting) — вече няма пуснати заявки.
    try { await sb.from("app_config").delete().eq("id", "flow_netting"); } catch (e) {}
    // 4) Флаг „в производство“ по заявките — за да станат отново чакащи.
    for (const tbl of ["samples", "customer_orders"]) {
      let rows = [];
      try {
        const { data, error } = await sb.from(tbl).select("id,data").not("data->production", "is", null);
        if (error) throw error;
        rows = data || [];
      } catch (e) {
        // Резервен вариант: изтегли всички и филтрирай локално.
        const { data } = await sb.from(tbl).select("id,data");
        rows = (data || []).filter(r => r && r.data && r.data.production);
      }
      for (const r of rows) {
        const d = r.data || {}; delete d.production;
        const { error } = await sb.from(tbl).update({ data: d, updated_at: new Date().toISOString() }).eq("id", r.id);
        if (error) throw new Error(tbl + " флаг: " + error.message);
      }
      log.push(tbl + ": " + rows.length + " заявки върнати в чакащи");
    }
  } catch (e) {
    alert("Грешка при нулиране: " + (e.message || e) + "\n\nНякои неща може да са изтрити частично — може да натиснеш нулиране пак.");
    return;
  }

  try { await erpLoadAll(); } catch (e) {}
  if (typeof erpRenderDetailStock === "function") erpRenderDetailStock();
  alert("✅ Нулирано — складът е върнат до внесената база.\n" + log.join("\n")
    + "\n\nПрезареди страницата (Ctrl+F5), за да се опреснят списъците със заявки.");
}

/* ---------- Поправка на класификацията (детайл/възел ↔ артикул) ----------
   Импортът налучква is_semifinished по името на групата, затова много части
   остават като „артикул" и не влизат в Склад детайли. Тук ползваме сигурния
   сигнал: продукт, ползван като част (child_product_id) в нечия рецепта, е
   детайл/възел → маркираме го като полуфабрикат, за да се следи тук. */
async function dsFixClassification() {
  const usedAsChild = new Set();
  (ERP.lines || []).forEach(l => { if (l.child_product_id) usedAsChild.add(Number(l.child_product_id)); });
  // Ползват се като части, но са маркирани „артикул" → трябва да станат възли.
  const toSemi = ERP.products.filter(p => usedAsChild.has(Number(p.id)) && !p.is_semifinished)
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", "bg"));
  // Само за сведение: маркирани „възел", но никъде не се ползват и нямат рецепта.
  const orphanSemi = ERP.products.filter(p => p.is_semifinished && !usedAsChild.has(Number(p.id)) && !((ERP.linesByProduct[p.id] || []).length));

  const { wrap, close } = erpDialog(`
    <h3>🔧 Проверка на класификацията</h3>
    <p class="hint">Правило: продукт, който се ползва като <b>част в рецептата на друг продукт</b>, е <b>детайл/възел</b> и трябва да се следи в Склад детайли. Импортът често ги е оставил като „артикул".</p>
    <p><b>${toSemi.length}</b> продукта се ползват като части, но са маркирани „артикул" — затова не влизат в Склад детайли.</p>
    ${toSemi.length ? `<div class="dc-list" style="max-height:320px;overflow:auto"><table class="report-table erp-table"><thead><tr><th>Код</th><th>Име</th><th>Сега</th></tr></thead><tbody>${
      toSemi.slice(0, 500).map(p => `<tr><td><b>${escapeHtml(p.code || "")}</b></td><td>${escapeHtml(p.name || "")}</td><td class="erp-muted">артикул</td></tr>`).join("")
    }</tbody></table>${toSemi.length > 500 ? `<p class="erp-muted">…и още ${toSemi.length - 500}</p>` : ""}</div>` : `<p class="erp-ready-ok">Няма продукти за поправка 👍</p>`}
    ${orphanSemi.length ? `<p class="hint erp-muted">ℹ Има и ${orphanSemi.length} продукта, маркирани „възел", които никъде не се ползват и нямат рецепта — <b>не ги пипам</b> (само за сведение).</p>` : ""}
    <div class="erp-dialog-actions">
      <button class="btn" id="dfc-cancel">Затвори</button>
      ${toSemi.length ? `<button class="btn btn-primary" id="dfc-go">✔ Маркирай ${toSemi.length} като детайл/възел</button>` : ""}
    </div>
    <p class="save-status" id="dfc-status"></p>`);
  wrap.querySelector("#dfc-cancel").addEventListener("click", close);
  const go = wrap.querySelector("#dfc-go");
  if (go) go.addEventListener("click", async () => {
    go.disabled = true;
    const st = wrap.querySelector("#dfc-status"); st.textContent = "Записва…";
    const ids = toSemi.map(p => Number(p.id));
    let done = 0, err = null;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await sb.from("products").update({ is_semifinished: true }).in("id", chunk);
      if (error) { err = error; break; }
      done += chunk.length;
      st.textContent = `Записани ${done}/${ids.length}…`;
    }
    if (err) { st.textContent = "⚠ Грешка: " + err.message; go.disabled = false; return; }
    await erpLoadAll();
    close();
    erpRenderDetailStock();
    alert(`Готово! ${done} продукта са маркирани като детайл/възел и вече ще се следят в Склад детайли.`);
  });
}

/* ---------- Обединяване на дублирани продукти по код ----------
   Понякога един и същ детайл е заведен два пъти (напр. единият дошъл от импорта на
   рецептата, другият създаден ръчно със склад). Тъй като всичко се свързва по вътрешен
   id (не по код), наличността „виси" на единия, а рецептата ползва другия → нетването
   при пускане в производство не ги засича. Тук ги обединяваме в един запис. */
function dsCodeKey(p) { return String((p && p.code) || "").trim().toLowerCase(); }
function dsNameKey(p) { return String((p && p.name) || "").trim().toLowerCase(); }
// Ползва ли се продуктът като вложен детайл (child) и има ли собствена рецепта (parent)?
function dsProductUsage(pid) {
  let asChild = 0;
  (ERP.lines || []).forEach(l => { if (String(l.child_product_id) === String(pid)) asChild++; });
  const asParent = (ERP.linesByProduct[pid] || []).length;
  return { asChild, asParent };
}
// Групи дубликати по КОД и по ИМЕ (понякога дублирането е на името, не на кода).
function dsDuplicateGroups() {
  const out = [], seen = new Set();
  const collect = (keyFn, by) => {
    const map = {};
    (ERP.products || []).forEach(p => { const k = keyFn(p); if (!k) return; (map[k] = map[k] || []).push(p); });
    Object.values(map).forEach(arr => {
      if (arr.length < 2) return;
      const sig = arr.map(p => p.id).sort((a, b) => a - b).join(",");
      if (seen.has(sig)) return;   // не показвай един и същ набор два пъти
      seen.add(sig);
      out.push({ by, items: arr });
    });
  };
  collect(dsCodeKey, "код");
  collect(dsNameKey, "име");
  return out;
}

function dsFindDuplicates() {
  const groups = dsDuplicateGroups();
  const groupHtml = (g, gi) => {
    const arr = g.items;
    const rows = arr.map(p => {
      const u = dsProductUsage(p.id);
      const score = u.asChild * 2 + u.asParent * 2 + ((Number(p.stock) || 0) > 0 ? 1 : 0);
      return { p, u, score };
    }).sort((a, b) => b.score - a.score);
    const keeperId = rows[0].p.id;   // по подразбиране най-свързаният с рецепти
    const bothRecipes = rows.filter(r => r.u.asParent > 0).length > 1;
    const body = rows.map(r => `<tr>
      <td><input type="radio" name="keep-${gi}" value="${r.p.id}" ${r.p.id === keeperId ? "checked" : ""} /></td>
      <td>${escapeHtml(r.p.code || "")}</td>
      <td>${escapeHtml(r.p.name || "")} <span class="erp-muted">#${r.p.id}</span></td>
      <td class="num">${erpNum(Number(r.p.stock) || 0)}</td>
      <td>${r.p.is_semifinished ? "възел" : "артикул"}</td>
      <td class="num">${r.u.asChild}</td>
      <td>${r.u.asParent ? "да" : "—"}</td>
    </tr>`).join("");
    const title = g.by === "код" ? `Код <b>${escapeHtml(arr[0].code || "")}</b>` : `Име <b>${escapeHtml(arr[0].name || "")}</b>`;
    return `<div class="ds-dupgroup">
      <h4 style="margin:6px 0">${title} — ${arr.length} записа <span class="erp-muted">(дублиран ${g.by})</span></h4>
      <table class="report-table erp-table"><thead><tr><th>Запази</th><th>Код</th><th>Име</th><th class="num">Наличност</th><th>Тип</th><th class="num">Като детайл</th><th>Рецепта</th></tr></thead><tbody>${body}</tbody></table>
      ${bothRecipes ? `<p class="erp-warn">⚠ Повече от един запис има собствена рецепта — обединяването ще ги слее. Провери внимателно преди да продължиш.</p>` : ""}
      <div style="text-align:right;margin:4px 0 2px"><button class="btn btn-small btn-primary ds-merge" data-gi="${gi}">🔗 Обедини в избрания</button></div>
    </div>`;
  };
  const { wrap, close } = erpDialog(`
    <h3>🔗 Дублирани продукти по код или име</h3>
    <p class="hint">Продукти, заведени повече от веднъж с <b>еднакъв код ИЛИ еднакво име</b> (напр. наличността на единия, рецептата на другия — затова нетването не ги засича). Избери кой запис да <b>остане</b> (по подразбиране — най-свързаният с рецепти) и натисни „Обедини". Наличността, рецептите и връзките на другия се <b>прехвърлят</b> към него. По подразбиране дубликатът <b>НЕ се трие</b> — само остава празен (нищо не се губи). Може по избор да го изтриеш.</p>
    <label class="erp-check" style="margin:0 0 8px"><input type="checkbox" id="dd-delete" /> 🗑 Изтрий празния дубликат след обединяване (по избор)</label>
    <div class="ds-manual" style="border:1px dashed var(--line,#cbd5e1);border-radius:10px;padding:10px;margin:0 0 10px;background:#f8fafc">
      <b>✋ Ръчно обединяване</b> <span class="erp-muted">— когато кодовете И имената са различни (напр. след преименуване). Търси и избери двата записа от списъка.</span>
      <datalist id="dm-products">${(ERP.products || []).map(p => `<option value="${escapeAttr((p.code || "") + " · " + (p.name || "") + " · #" + p.id)}"></option>`).join("")}</datalist>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-top:6px">
        <label class="erp-inline" style="flex-direction:column;align-items:flex-start">Запази (остава)<input list="dm-products" id="dm-keep" placeholder="търси код/име" style="min-width:240px" /></label>
        <label class="erp-inline" style="flex-direction:column;align-items:flex-start">Обедини в него (трие се)<input list="dm-products" id="dm-dup" placeholder="търси код/име" style="min-width:240px" /></label>
        <button class="btn btn-small btn-primary" id="dm-merge">🔗 Обедини ръчно</button>
      </div>
    </div>
    <div class="ds-dup-list" style="max-height:50vh;overflow:auto">${groups.length ? groups.map(groupHtml).join("<hr/>") : `<p class="erp-ready-ok">Няма автоматично открити дубликати. Ако знаеш два записа за едно нещо — ползвай „Ръчно обединяване" горе.</p>`}</div>
    <div class="erp-dialog-actions"><button class="btn" id="dd-close">Затвори</button></div>
    <p class="save-status" id="dd-status"></p>`);
  wrap.querySelector("#dd-close").addEventListener("click", close);
  const dmMerge = wrap.querySelector("#dm-merge");
  if (dmMerge) dmMerge.addEventListener("click", async () => {
    const pid = s => { const m = /#(\d+)\s*$/.exec(String(s || "")); return m ? Number(m[1]) : null; };
    const keeperId = pid(wrap.querySelector("#dm-keep").value);
    const dupId = pid(wrap.querySelector("#dm-dup").value);
    if (!keeperId || !dupId) { alert("Избери и двата продукта от падащия списък (да съдържат #номер)."); return; }
    if (keeperId === dupId) { alert("Избери два различни записа."); return; }
    const keeper = ERP.prodById[keeperId], dup = ERP.prodById[dupId];
    if (!keeper || !dup) { alert("Един от продуктите не е намерен. Избери от списъка."); return; }
    const deleteDup = !!(wrap.querySelector("#dd-delete") || {}).checked;
    if (!confirm(`Да обединя ли „${dup.code || ""} ${dup.name || ""}" (#${dupId}) в „${keeper.code || ""} ${keeper.name || ""}" (#${keeperId})?\n\nНаличността, рецептите и връзките минават към записа, който остава.\n${deleteDup ? "Дубликатът ще бъде изтрит." : "Дубликатът остава празен (не се трие)."}`)) return;
    dmMerge.disabled = true;
    const st = wrap.querySelector("#dd-status"); if (st) st.textContent = "Обединявам…";
    const res = await dsMergeInto(keeperId, [dupId], { deleteDup });
    if (res.error) { if (st) st.textContent = "⚠ " + res.error; dmMerge.disabled = false; return; }
    await erpLoadAll();
    close();
    erpRenderDetailStock();
    alert(`Готово! Прехвърлен запис #${dupId} в #${keeperId}.`
      + (res.jsonFixed ? `\nПренасочени ${res.jsonFixed} връзки (мостри/заявки/продажби/цени).` : "")
      + (res.deleteDup ? `\nДубликатът е изтрит.` : `\nДубликатът остана празен (не е изтрит).`));
  });
  wrap.querySelectorAll(".ds-merge").forEach(b => b.addEventListener("click", async () => {
    const gi = Number(b.dataset.gi);
    const grp = (groups[gi] && groups[gi].items) || [];
    const sel = wrap.querySelector(`input[name="keep-${gi}"]:checked`);
    if (!sel) { alert("Избери кой запис да остане."); return; }
    const keeperId = Number(sel.value);
    const dupIds = grp.filter(p => Number(p.id) !== keeperId).map(p => Number(p.id));
    const keeper = grp.find(p => Number(p.id) === keeperId) || {};
    const deleteDup = !!(wrap.querySelector("#dd-delete") || {}).checked;
    if (!confirm(`Да обединя ли ${dupIds.length} дубликат(а) в „${keeper.code || ""} ${keeper.name || ""}" (#${keeperId})?\n\nНаличността и рецептите им се прехвърлят към този запис.\n${deleteDup ? "Дубликатите ще бъдат изтрити." : "Дубликатите остават празни (не се трият)."}`)) return;
    b.disabled = true;
    const st = wrap.querySelector("#dd-status"); if (st) st.textContent = "Обединявам…";
    const res = await dsMergeInto(keeperId, dupIds, { deleteDup });
    if (res.error) { if (st) st.textContent = "⚠ " + res.error; b.disabled = false; return; }
    await erpLoadAll();
    close();
    erpRenderDetailStock();
    alert(`Готово! Прехвърлени ${res.consolidated} записа в #${keeperId}.`
      + (res.jsonFixed ? `\nПренасочени ${res.jsonFixed} връзки в мостри/заявки/продажби/ценови листи.` : "")
      + (res.deleteDup ? `\nИзтрити ${res.deleted} дубликата.` : `\nДубликатите останаха празни (не са изтрити).`)
      + (res.notDeleted ? `\n(${res.notDeleted} не можаха да се изтрият — безобидни, празни.)` : ""));
  }));
}

// Прехвърля ВСИЧКИ референции от дубликатите към keeper.
// 1) DB таблици с FK (пренасочваме ПРЕДИ евентуално триене).
// 2) JSONB референции без FK (мостри/заявки/продажби/ценови листи) — тихо чупене, затова и тях.
// 3) Дубликатът се трие САМО ако opts.deleteDup === true; иначе остава празен (безобиден).
async function dsMergeInto(keeperId, dupIds, opts) {
  const K = Number(keeperId);
  const deleteDup = !!(opts && opts.deleteDup);
  const dupSet = new Set(dupIds.map(Number));
  const isDup = v => v != null && dupSet.has(Number(v));
  let deleted = 0, notDeleted = 0, jsonFixed = 0;

  // 1) DB таблици с FK
  for (const D of dupIds) {
    let r = await sb.from("product_movements").update({ product_id: K }).eq("product_id", D);
    if (r.error) return { error: "движения: " + r.error.message };
    r = await sb.from("recipe_lines").update({ child_product_id: K }).eq("child_product_id", D);
    if (r.error) return { error: "рецепти (вложен): " + r.error.message };
    r = await sb.from("recipe_lines").update({ product_id: K }).eq("product_id", D);
    if (r.error) return { error: "рецепти (родител): " + r.error.message };
  }

  // 2) JSONB референции (без FK — пренасочваме ръчно, за да не се счупи тихо)
  try {
    const { data } = await erpSelectAll("samples", "id,data");
    for (const row of (data || [])) { const d = row.data || {}; if (isDup(d.erpProductId)) { d.erpProductId = K; await sb.from("samples").update({ data: d }).eq("id", row.id); jsonFixed++; } }
  } catch (e) { /* таблицата може да липсва */ }
  try {
    const { data } = await erpSelectAll("customer_orders", "id,data");
    for (const row of (data || [])) { const d = row.data || {}; let ch = false; (d.lines || []).forEach(l => { if (isDup(l.productId)) { l.productId = K; ch = true; } }); if (ch) { await sb.from("customer_orders").update({ data: d, updated_at: new Date().toISOString() }).eq("id", row.id); jsonFixed++; } }
  } catch (e) {}
  try {
    const { data } = await erpSelectAll("sales", "id,data,posted");
    for (const row of (data || [])) { const d = row.data || {}; let ch = false; (d.lines || []).forEach(l => { if (l.itemKind === "product" && isDup(l.refId)) { l.refId = K; ch = true; } }); if (ch) { await sb.from("sales").update({ data: d, posted: !!row.posted, updated_at: new Date().toISOString() }).eq("id", row.id); jsonFixed++; } }
  } catch (e) {}
  try {
    const { data } = await sb.from("app_config").select("id,data").like("id", "pricelist_%");
    for (const row of (data || [])) { const d = row.data || {}, ent = d.entries || {}; let ch = false; dupIds.forEach(D => { if (ent[D] != null) { if (ent[K] == null) ent[K] = ent[D]; delete ent[D]; ch = true; } }); if (ch) { d.entries = ent; await sb.from("app_config").update({ data: d, updated_at: new Date().toISOString() }).eq("id", row.id); jsonFixed++; } }
  } catch (e) {}

  // 3) Триене — само по изричен избор. Иначе дубликатът остава празен (0 наличност, без рецепта).
  if (deleteDup) {
    for (const D of dupIds) {
      const del = await sb.from("products").delete().eq("id", D);
      if (del.error) notDeleted++; else deleted++;
    }
  }
  return { consolidated: dupIds.length, deleted, notDeleted, jsonFixed, deleteDup };
}

// Индекс по код (веднъж), сортиран по дължина — за бързо и точно разпознаване.
function dsBuildCodeIndex(products) {
  const byCode = {}; const list = [];
  (products || []).forEach(p => { const c = String(p.code || "").trim().toLowerCase(); if (c) { byCode[c] = p; list.push({ p, c }); } });
  list.sort((a, b) => b.c.length - a.c.length);
  return { byCode, list };
}
// Намира продукт по името на файла — кодът може да е НАВСЯКЪДЕ в името
// (като отделна „дума" или ограден от небуквено-цифрови знаци), не само отпред.
function dsMatchProductByFilename(base, idx) {
  const b = String(base || "").trim().toLowerCase();
  if (!b) return null;
  const { byCode, list } = idx;
  // 1) Кодът като отделна „дума" някъде в името (дължина >= 3, за да не хване „3мм").
  const tokens = b.split(/[\s._\-–—()\[\]]+/).filter(t => t.length >= 3);
  for (const t of tokens) { if (byCode[t]) return byCode[t]; }
  // 2) Най-дългият код, с който името започва на граница (кодове със знаци/тирета).
  for (const o of list) {
    if (b.startsWith(o.c) && (b.length === o.c.length || /[^a-z0-9]/i.test(b[o.c.length]))) return o.p;
  }
  // 3) Кодът се съдържа някъде в името, ограден от небуквено-цифрови граници.
  for (const o of list) {
    if (o.c.length < 3) continue;
    const i = b.indexOf(o.c);
    if (i < 0) continue;
    const before = i === 0 ? "" : b[i - 1];
    const after = b[i + o.c.length] || "";
    if ((before === "" || /[^a-z0-9]/i.test(before)) && (after === "" || /[^a-z0-9]/i.test(after))) return o.p;
  }
  return null;
}

// Предполага MIME по разширението (за файлове извадени от архив).
function dsGuessMime(name) {
  const e = String(name).toLowerCase().split(".").pop();
  return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml" })[e] || "application/octet-stream";
}
const DS_DRAW_EXT = /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?|svg|dwg|dxf|step|stp|igs|iges)$/i;   // + CAD формати

// Разгъва избраните файлове: ZIP архивите се разпакова́т на отделни чертежи.
// Диагностика: казва ЯСНО какво е намерено в архива и защо нещо е прескочено.
/* Разпакова RAR/7z/tar… в браузъра през libarchive.js (WebAssembly).
   Библиотеката е локална (vendor-libarchive) и се зарежда чак при нужда —
   не бави останалите екрани. Връща само файловете с чертежни разширения. */
let DS_ARCHIVE_LIB = null;
async function dsArchiveLib() {
  if (DS_ARCHIVE_LIB) return DS_ARCHIVE_LIB;
  const base = new URL(".", location.href).href;
  const mod = await import(base + "vendor-libarchive/libarchive.mjs?v=1");
  mod.Archive.init({ workerUrl: base + "vendor-libarchive/worker-bundle.js?v=1" });
  DS_ARCHIVE_LIB = mod.Archive;
  return DS_ARCHIVE_LIB;
}
async function dsExtractWithLibarchive(f) {
  const Archive = await dsArchiveLib();
  const ar = await Archive.open(f);
  let files = [];
  try { files = await ar.extractFiles(); }
  finally { try { await ar.close(); } catch (e) {} }
  const out = [];
  let total = 0, skipped = 0;
  const skippedExt = new Set();
  const walk = obj => {
    Object.keys(obj || {}).forEach(k => {
      const v = obj[k];
      if (v instanceof File || (v && typeof v.arrayBuffer === "function" && v.name !== undefined)) {
        if (/(^|\/)__MACOSX\//.test(k) || String(k).startsWith(".")) return;
        total++;
        const bn = String(v.name || k).split("/").pop();
        if (!bn || !DS_DRAW_EXT.test(bn)) { skipped++; const m = bn.match(/\.[^.]+$/); if (m) skippedExt.add(m[0].toLowerCase()); return; }
        out.push(new File([v], bn, { type: v.type || dsGuessMime(bn) }));
      } else if (v && typeof v === "object") walk(v);
    });
  };
  walk(files);
  if (!total) alert(`Архивът „${f.name}" изглежда празен (0 файла вътре).`);
  else if (skipped) alert(`От архива „${f.name}": взети ${total - skipped} от ${total} файла.\nПрескочени ${skipped} с неподдържано разширение: ${[...skippedExt].join(", ") || "без разширение"}.\nПоддържат се: PDF, снимки, DWG, DXF, STEP.`);
  return out;
}

async function dsExpandFiles(files) {
  const out = [];
  for (const f of files) {
    // RAR / 7z / tar.gz — през libarchive (WASM). Зарежда се само при нужда.
    if (/\.(rar|7z|tar|gz|tgz|bz2|xz|cab|iso)$/i.test(f.name)) {
      try {
        const got = await dsExtractWithLibarchive(f);
        got.forEach(x => out.push(x));
      } catch (e) {
        alert(`Не мога да разпакова „${f.name}": ${e.message || e}\n\nАко архивът е с ПАРОЛА или е RAR5 с плътна компресия, отвори го на компютъра и го пре-запиши като ZIP.`);
      }
      continue;
    }
    if (/\.zip$/i.test(f.name) || /zip/i.test(f.type || "")) {
      if (typeof JSZip === "undefined") { alert("Библиотеката за архиви не е заредена. Презареди страницата (Ctrl+Shift+R) и опитай пак."); continue; }
      try {
        const zip = await JSZip.loadAsync(await f.arrayBuffer());
        let entries = 0, skippedExt = 0;
        const skippedNames = new Set();
        for (const name of Object.keys(zip.files)) {
          const entry = zip.files[name];
          if (entry.dir) continue;
          if (/(^|\/)__MACOSX\//.test(name) || /(^|\/)\./.test(name)) continue;   // системни/скрити
          entries++;
          const bn = name.split("/").pop();
          if (!bn || !DS_DRAW_EXT.test(bn)) { skippedExt++; const m = String(bn || "").match(/\.[^.]+$/); if (m) skippedNames.add(m[0].toLowerCase()); continue; }
          const blob = await entry.async("blob");
          out.push(new File([blob], bn, { type: blob.type || dsGuessMime(bn) }));
        }
        if (!entries) alert(`Архивът „${f.name}" изглежда празен (0 файла вътре).`);
        else if (skippedExt) alert(`От архива „${f.name}": взети ${entries - skippedExt} от ${entries} файла.\nПрескочени ${skippedExt} с неподдържано разширение: ${[...skippedNames].join(", ") || "без разширение"}.\nПоддържат се: PDF, снимки, DWG, DXF, STEP.`);
      } catch (e) {
        alert(`Не мога да разчета архива „${f.name}": ${e.message || e}\n\nАко е много голям (стотици MB), раздели чертежите на няколко по-малки ZIP-а (напр. по 300-400 файла) и ги качи един по един — качването прескача вече качените, нищо няма да се дублира.`);
      }
    } else {
      out.push(f);
    }
  }
  return out;
}

// Стъпка 1: разпознаване + ПРЕГЛЕД (какво е разпознато и какво не) преди качване.
async function dsBulkDrawings(rawFiles) {
  const files = await dsExpandFiles(rawFiles || []);
  if (!files.length) { alert("Няма чертежи за качване (архивът е празен или няма разпознати файлове)."); return; }
  const idx = dsBuildCodeIndex(ERP.products || []);
  const groups = new Map();        // pid -> { p, files: [] }
  const unmatched = [];
  files.forEach(f => {
    const base = f.name.replace(/\.[^.]+$/, "");
    const p = dsMatchProductByFilename(base, idx);
    if (!p) { unmatched.push(f.name); return; }
    if (!groups.has(p.id)) groups.set(p.id, { p, files: [] });
    groups.get(p.id).files.push(f);
  });
  dsBulkPreview(groups, unmatched, files.length);
}

// Прегледен диалог: показва разпознати/неразпознати и чак тогава качва.
function dsBulkPreview(groups, unmatched, total) {
  const matchedCount = [...groups.values()].reduce((s, g) => s + g.files.length, 0);
  const gList = [...groups.values()].sort((a, b) => b.files.length - a.files.length);
  const { wrap, close } = erpDialog(`
    <h3>Преглед на чертежите за качване</h3>
    <p>Избрани файла: <b>${total}</b> · разпознати: <b>${matchedCount}</b> за <b>${groups.size}</b> детайла · <b class="${unmatched.length ? "erp-warn" : ""}">ненамерени: ${unmatched.length}</b></p>
    ${unmatched.length ? `<p class="hint">Ненамерените нямат разпознаваем код в името. Свали списъка, преименувай ги (кодът да е в името) и качи пак само тях.</p>` : ""}
    <label class="erp-inline" style="display:block;margin:6px 0;padding:8px 10px;background:#fef9c3;border:1px solid #fde047;border-radius:8px">
      <input type="checkbox" id="dbp-onlymissing" checked />
      <b>Качи САМО при детайли БЕЗ чертеж</b> — където вече има какъвто и да е чертеж, не се качва нищо (нула дублиране). Махни отметката, ако искаш да ДОБАВЯШ към съществуващите (тогава се прескачат само файлове със същото име).
    </label>
    <div class="dc-cols">
      <div class="dc-col"><h4 class="erp-group-head">✅ Разпознати (${groups.size} детайла)</h4>
        <div class="dc-list">${gList.length ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Детайл</th><th class="num">Файла</th><th>Сега</th></tr></thead><tbody>${
          gList.map(g => `<tr><td>${escapeHtml(g.p.code || "")}</td><td>${escapeHtml(g.p.name || "")}</td><td class="num">${g.files.length}</td><td>${dsHasDrawing(g.p) ? '<span title="вече има чертеж — с отметката горе ще бъде ПРЕСКОЧЕН">📎 има</span>' : '<span class="erp-muted">няма</span>'}</td></tr>`).join("")
        }</tbody></table>` : `<p class="erp-muted">Нищо разпознато.</p>`}</div>
      </div>
      <div class="dc-col"><h4 class="erp-group-head">❌ Ненамерени (${unmatched.length})</h4>
        <div class="dc-list">${unmatched.length ? `<ul class="dc-un">${unmatched.slice(0, 400).map(n => `<li>${escapeHtml(n)}</li>`).join("")}${unmatched.length > 400 ? `<li class="erp-muted">…и още ${unmatched.length - 400}</li>` : ""}</ul>` : `<p class="erp-ready-ok">Всичко е разпознато 👍</p>`}</div>
      </div>
    </div>
    <div class="erp-dialog-actions">
      ${unmatched.length ? `<button class="btn btn-small" id="dbp-export">⤓ Свали ненамерените</button>` : ""}
      <span class="spacer"></span>
      <button class="btn" id="dbp-cancel">Отказ</button>
      <button class="btn btn-primary" id="dbp-go" ${groups.size ? "" : "disabled"}>Качи разпознатите (${matchedCount})</button>
    </div>
    <div id="dbp-prog"></div>`);
  wrap.querySelector("#dbp-cancel").addEventListener("click", close);
  const exp = wrap.querySelector("#dbp-export");
  if (exp) exp.addEventListener("click", () => {
    const blob = new Blob(["﻿" + "Ненамерени файлове (нямат разпознат код в името)\n" + unmatched.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "nenameren-chertezhi.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  wrap.querySelector("#dbp-go").addEventListener("click", () => dsBulkUpload(groups, wrap, close, !!(wrap.querySelector("#dbp-onlymissing") || {}).checked));
}

// Стъпка 2: реалното качване (с прогрес и без дублиране на вече качени файлове).
// onlyMissing = качва САМО при детайли, които нямат никакъв чертеж (масовото
// зареждане на Данко: 1685 файла, Системата решава кое да запази).
async function dsBulkUpload(groups, wrap, close, onlyMissing) {
  const prog = wrap.querySelector("#dbp-prog");
  const go = wrap.querySelector("#dbp-go"); if (go) go.disabled = true;
  const total = [...groups.values()].reduce((s, g) => s + g.files.length, 0);
  let ok = 0, dup = 0, failed = 0, saveErr = 0, idx = 0, doneFiles = 0, skippedProducts = 0, skippedFiles = 0;
  const failedNames = [];
  prog.innerHTML = `<div class="dc-prog"><div class="dc-bar"><span id="dbp-fill"></span></div><span id="dbp-pct">0%</span></div>`;
  const tick = () => { doneFiles++; const pct = Math.round(doneFiles / total * 100); const f = wrap.querySelector("#dbp-fill"); if (f) f.style.width = pct + "%"; const t = wrap.querySelector("#dbp-pct"); if (t) t.textContent = pct + "%"; };

  for (const g of groups.values()) {
    const p = g.p;
    // Актуалните чертежи от базата (не от кеша) — за да не презапишем/дублираме.
    let list = [];
    try {
      const { data: cur } = await sb.from("products").select("drawings").eq("id", p.id).maybeSingle();
      list = (cur && Array.isArray(cur.drawings)) ? cur.drawings.slice() : [];
    } catch (e) { list = Array.isArray(p.drawings) ? p.drawings.slice() : []; }
    if (onlyMissing && list.length > 0) {
      // Детайлът ВЕЧЕ има чертеж → целият му пакет файлове се прескача.
      skippedProducts++; skippedFiles += g.files.length;
      g.files.forEach(tick);
      continue;
    }
    const have = new Set(list.map(d => String((d && d.name) || "").toLowerCase()));
    let changed = false;
    for (const file of g.files) {
      if (have.has(file.name.toLowerCase())) { dup++; tick(); continue; }   // вече качен — прескачаме
      const path = `products/${p.id}/${Date.now()}-${idx++}-${safeName(file.name)}`;
      const up = await sb.storage.from(BUCKET).upload(path, file);
      if (up.error) { failed++; failedNames.push(file.name); tick(); continue; }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      list.push({ name: file.name, type: file.type, path, url: data.publicUrl });
      have.add(file.name.toLowerCase());
      ok++; changed = true; tick();
    }
    if (changed) {
      const { error } = await sb.from("products").update({ drawings: list }).eq("id", p.id);
      if (error) { saveErr++; }
      else if (ERP.prodById[p.id]) ERP.prodById[p.id].drawings = list;
    }
  }
  if (close) close();
  if (document.getElementById("ds-tbody")) dsFillRows();   // пре-оцветяваме бутоните
  alert(`Готово!\n✅ Качени нови: ${ok}`
    + (skippedProducts ? `\n⏭ Прескочени детайли С НАЛИЧЕН чертеж: ${skippedProducts} (файлове: ${skippedFiles})` : "")
    + (dup ? `\n↩ Същото име, вече качено (прескочени): ${dup}` : "")
    + (failed ? `\n⚠ Неуспешни качвания (файл): ${failed}\n` + failedNames.slice(0, 15).join("\n") : "")
    + (saveErr ? `\n⚠ Детайли с грешка при запис в базата: ${saveErr}` : "")
    + `\n\n💡 Натисни „🔎 Провери чертежите", за да сверим общо колко са записани.`);
}

/* ---------- Проверка на чертежите (запис в базата ↔ файл в облака) ---------- */
async function dsCheckDrawings() {
  const { wrap, close } = erpDialog(`
    <h3>🔎 Проверка на чертежите</h3>
    <div id="dc-body"><p class="erp-loading">Чета от базата…</p></div>
    <div class="erp-dialog-actions"><button class="btn" id="dc-close">Затвори</button></div>`);
  wrap.querySelector("#dc-close").addEventListener("click", close);
  const body = wrap.querySelector("#dc-body");

  let prods;
  try {
    prods = await dsFetchAllProducts("id,code,name,drawings");   // със странициране (над 1000)
  } catch (e) { body.innerHTML = `<p class="erp-error">Грешка при четене: ${escapeHtml(e.message || String(e))}</p>`; return; }

  const withDraw = prods.filter(p => Array.isArray(p.drawings) && p.drawings.length);
  const totalRecords = withDraw.reduce((s, p) => s + p.drawings.length, 0);
  const noPath = [];
  withDraw.forEach(p => p.drawings.forEach(d => { if (!d || !d.path) noPath.push({ p, d, base: "(без път)" }); }));

  body.innerHTML = `
    <p>📦 <b>${withDraw.length}</b> детайла с чертежи · общо <b>${totalRecords}</b> записа.</p>
    <p>Проверявам дали файловете реално съществуват в облака…</p>
    <div class="dc-prog"><div class="dc-bar"><span id="dc-fill"></span></div><span id="dc-pct">0%</span></div>`;

  const broken = [];
  let done = 0;
  for (const p of withDraw) {
    let names = new Set();
    try {
      const { data: files } = await sb.storage.from(BUCKET).list(`products/${p.id}`, { limit: 1000 });
      names = new Set((files || []).map(f => f.name));
    } catch (e) { /* ако листването гръмне, прескачаме проверката за този детайл */ names = null; }
    if (names) p.drawings.forEach(d => {
      if (!d || !d.path) return;
      const base = String(d.path).split("/").pop();
      if (base && !names.has(base)) broken.push({ p, d, base });
    });
    done++;
    const pct = Math.round(done / withDraw.length * 100);
    const fill = wrap.querySelector("#dc-fill"); if (fill) fill.style.width = pct + "%";
    const pctEl = wrap.querySelector("#dc-pct"); if (pctEl) pctEl.textContent = pct + "%";
  }

  const bad = broken.concat(noPath);
  const okCount = totalRecords - bad.length;
  let html = `
    <p>📦 <b>${withDraw.length}</b> детайла с чертежи · общо <b>${totalRecords}</b> записа.</p>
    <ul class="dc-sum">
      <li>✅ Изправни (файлът съществува): <b>${okCount}</b></li>
      <li>❌ Счупени (записът сочи липсващ файл): <b>${broken.length}</b></li>
      ${noPath.length ? `<li>⚠ Без път/url: <b>${noPath.length}</b></li>` : ""}
    </ul>`;
  if (bad.length) {
    html += `<div class="dc-list"><table class="report-table erp-table"><thead><tr><th>Код</th><th>Детайл</th><th>Файл</th></tr></thead><tbody>${
      bad.slice(0, 300).map(b => `<tr><td>${escapeHtml(b.p.code || "")}</td><td>${escapeHtml(b.p.name || "")}</td><td>${escapeHtml((b.d && b.d.name) || b.base || "?")}</td></tr>`).join("")
    }</tbody></table>${bad.length > 300 ? `<p class="erp-muted">…и още ${bad.length - 300}</p>` : ""}</div>
    <p class="hint">Тези записи показват „липсва чертеж", защото файлът не е в облака (напр. качването е прекъснало). Премахни ги и качи файловете наново.</p>
    <button class="btn btn-small btn-danger" id="dc-clean">🧹 Премахни счупените записи (${bad.length})</button>`;
  } else {
    html += `<p class="erp-ready-ok">🎉 Всичко е наред — всеки записан чертеж има реален файл в облака.</p>`;
  }
  body.innerHTML = html;

  const keyOf = d => (d && d.path) ? d.path : "noname:" + ((d && d.name) || "");
  const cleanBtn = wrap.querySelector("#dc-clean");
  if (cleanBtn) cleanBtn.addEventListener("click", async () => {
    if (!confirm(`Ще премахна ${bad.length} счупени записа (без реален файл). Файловете и без това липсват — това само чисти списъка. Продължавам?`)) return;
    const byProd = new Map();
    bad.forEach(b => { const a = byProd.get(b.p.id) || []; a.push(b); byProd.set(b.p.id, a); });
    let cleaned = 0, errs = 0;
    for (const [pid, items] of byProd) {
      const p = withDraw.find(x => x.id === pid);
      const badKeys = new Set(items.map(i => keyOf(i.d)));
      const kept = (p.drawings || []).filter(d => !badKeys.has(keyOf(d)));
      const { error } = await sb.from("products").update({ drawings: kept }).eq("id", pid);
      if (error) { errs++; continue; }
      cleaned += (p.drawings.length - kept.length);
      if (ERP.prodById[pid]) ERP.prodById[pid].drawings = kept;
    }
    alert(`Премахнати ${cleaned} счупени записа.` + (errs ? `\n${errs} детайла с грешка при запис.` : ""));
    close();
  });
}

// Сваля Excel-шаблон с всички детайли/възли за попълване на наличности.
function dsExportTemplate() {
  if (typeof XLSX === "undefined") { alert("Excel библиотеката не е заредена. Опитай пак след презареждане."); return; }
  const HEAD = ["Код", "Детайл/възел", "Мярка", "Налично сега (система)", "Налична бройка (попълни)"];
  const list = ERP.products.filter(dsIsDetail).slice()
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", "bg") || (a.name || "").localeCompare(b.name || "", "bg"));
  const rows = list.map(p => ({
    "Код": p.code || "",
    "Детайл/възел": p.name || "",
    "Мярка": p.unit || "бр.",
    "Налично сега (система)": Number(p.stock) || 0,
    "Налична бройка (попълни)": "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEAD });
  ws["!cols"] = [{ wch: 14 }, { wch: 42 }, { wch: 8 }, { wch: 20 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Склад детайли");
  XLSX.writeFile(wb, "Склад-детайли-шаблон.xlsx");
}

// Импортира попълнения шаблон: задава наличността на всеки детайл на въведената
// бройка (чрез движение „корекция" = разлика спрямо текущото). Празни редове се
// прескачат. Съвпадение по Код, а при липса — по име.
async function dsImportFill(file) {
  if (typeof XLSX === "undefined") { alert("Excel библиотеката не е заредена."); return; }
  let rows;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch (e) { alert("Не мога да прочета файла: " + (e.message || e)); return; }
  if (!rows.length) { alert("Файлът е празен."); return; }

  const keys = Object.keys(rows[0]);
  const findKey = subs => keys.find(k => subs.some(s => k.toLowerCase().includes(s)));
  const codeKey = findKey(["код"]);
  const nameKey = findKey(["детайл", "възел", "име", "продукт", "name"]);
  let qtyKey = findKey(["попълни", "налична бройка", "готова"]);
  if (!qtyKey) { alert("Не намирам колоната за попълване (Налична бройка).\nПолзвай сваления шаблон и не преименувай колоните."); return; }

  // Чест случай: бройките са попълнени в грешната колона („Налично сега (система)"),
  // а колоната за попълване е останала празна. Тогава ползваме нея.
  const isEmpty = v => v === "" || v === null || v === undefined;
  if (rows.every(r => isEmpty(r[qtyKey]))) {
    const sysKey = keys.find(k => /налично сега|система/i.test(k))
      || keys.find(k => k !== qtyKey && k.toLowerCase().includes("налично"));
    if (sysKey && rows.some(r => !isEmpty(r[sysKey]) && erpToNum(r[sysKey]) !== 0)) qtyKey = sysKey;
  }

  const byCode = {}, byName = {};
  ERP.products.filter(dsIsDetail).forEach(p => {
    if (p.code) byCode[String(p.code).trim().toLowerCase()] = p;
    if (p.name) byName[String(p.name).trim().toLowerCase()] = p;
  });

  const moves = [];
  let skipped = 0; const unknown = [];
  rows.forEach(r => {
    const raw = r[qtyKey];
    if (raw === "" || raw === null || raw === undefined) { skipped++; return; }
    const val = erpToNum(raw);
    const code = codeKey ? String(r[codeKey] || "").trim().toLowerCase() : "";
    const name = nameKey ? String(r[nameKey] || "").trim().toLowerCase() : "";
    const p = (code && byCode[code]) || (name && byName[name]);
    if (!p) { if (code || name) unknown.push(r[codeKey] || r[nameKey] || "?"); return; }
    const cur = Number(p.stock) || 0;
    const delta = val - cur;
    if (!delta) { skipped++; return; }
    moves.push({ product_id: p.id, kind: "корекция", quantity: delta, note: "Импорт наличности (готова продукция)" });
  });

  if (!moves.length) {
    alert(`Няма промени за запис.\nПропуснати (празни или без промяна): ${skipped}` + (unknown.length ? `\nНенамерени по код/име: ${unknown.length}` : ""));
    return;
  }
  if (!confirm(`Ще задам наличността на ${moves.length} детайла според файла.`
    + (skipped ? `\nПропуснати (празни/без промяна): ${skipped}` : "")
    + (unknown.length ? `\nНенамерени по код/име (ще се прескочат): ${unknown.length}` : "")
    + `\n\nПродължавам?`)) return;

  const { error } = await sb.from("product_movements").insert(moves);
  if (error) { alert("Грешка при запис: " + error.message); return; }
  await erpLoadAll();
  erpRenderDetailStock();
  alert(`Готово! Обновени ${moves.length} детайла.` + (unknown.length ? `\n${unknown.length} реда не бяха намерени по код/име.` : ""));
}

/* ---------- 🌳 Структура (възли) — цял екран ----------
   Показва САМО възлите (продукти, чиято рецепта съдържа други продукти) —
   без дребните съставни части, материали и операции. Пример: за 101137 ASIA
   излизат 101007/101008, а под тях 100971/100972 (крак) и 100949/100950
   (заготовка) — Нож/Двойка/Тройка и т.н. НЕ се показват (те са детайли).
   Нагоре: къде се включва изделието, чак до крайните продукти. */
function dsIsAssembly(pid) {
  return ((ERP.linesByProduct && ERP.linesByProduct[pid]) || []).some(l => l.child_product_id);
}
// Надолу: възлите в рецептата (рекурсивно), с бройка за 1 родител.
function dsNodeMapDown(pid, depth, anc) {
  const out = [];
  ((ERP.linesByProduct && ERP.linesByProduct[pid]) || []).forEach(l => {
    if (!l.child_product_id || anc.has(l.child_product_id)) return;
    if (!dsIsAssembly(l.child_product_id)) return;   // детайл без свои възли — не се показва
    const cp = ERP.prodById[l.child_product_id]; if (!cp) return;
    out.push({ p: cp, qty: Number(l.quantity) || 1, depth });
    out.push(...dsNodeMapDown(l.child_product_id, depth + 1, new Set([...anc, l.child_product_id])));
  });
  return out;
}
// Нагоре: родителите (рекурсивно), с бройка „влиза ×N в 1".
function dsNodeMapUp(pid, depth, anc) {
  const out = [];
  if (depth > 7) return out;
  (ERP.lines || []).forEach(l => {
    if (Number(l.child_product_id) !== Number(pid) || anc.has(Number(l.product_id))) return;
    const pp = ERP.prodById[l.product_id]; if (!pp) return;
    out.push({ p: pp, qty: Number(l.quantity) || 1, depth, top: !(ERP.childIds && ERP.childIds.has(Number(pp.id))) });
    out.push(...dsNodeMapUp(l.product_id, depth + 1, new Set([...anc, Number(l.product_id)])));
  });
  return out;
}
function dsNodeMapOpen(pid) {
  let wrap = document.getElementById("ds-nodemap-dlg");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "ds-nodemap-dlg";
    wrap.className = "overlay dsnm-overlay";
    document.body.appendChild(wrap);
  }
  dsNodeMapRender(pid);
}
function dsNodeMapRender(pid) {
  const wrap = document.getElementById("ds-nodemap-dlg"); if (!wrap) return;
  const p = pid ? (ERP.prodById[pid] || null) : null;
  const stockTxt = x => `<span class="dsnm-stock ${(Number(x.stock) || 0) < 0 ? "erp-warn" : ""}">${erpNum(Number(x.stock) || 0)} ${escapeHtml(x.unit || "бр.")}</span>`;
  const recBtns = id => `<span class="dsnm-acts">
      <button type="button" class="btn btn-small dsnm-rec" data-rec="${id}" title="Покажи рецептата на този възел тук">📋 рецепта</button>
      <button type="button" class="btn btn-small dsnm-dl" data-dl="${id}" title="Свали рецептата като Excel файл">⤓</button>
    </span>`;
  const row = (it, dir) => `
    <div class="dsnm-row" data-go="${it.p.id}" style="margin-left:${it.depth * 26}px" title="Клик — покажи структурата на този възел">
      ${dir === "up" && it.top ? `<span class="dsnm-top" title="Краен продукт">🧾</span>` : "🔩"}
      <b>${escapeHtml(it.p.code || "")}</b> ${escapeHtml(it.p.name || "")}
      <span class="erp-muted">× ${erpNum(it.qty)}</span> · ${stockTxt(it.p)}
      ${recBtns(it.p.id)}
    </div>`;
  let body = "";
  if (p) {
    const down = dsNodeMapDown(p.id, 0, new Set([p.id]));
    const up = dsNodeMapUp(p.id, 0, new Set([p.id]));
    body = `
      <div class="dsnm-head-prod">🔩 <b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} · на склад: ${stockTxt(p)} ${recBtns(p.id)}</div>
      <div class="dsnm-cols">
        <div class="dsnm-col">
          <h4>⬇ Възли в него <span class="erp-muted">(${down.length})</span></h4>
          ${down.map(it => row(it, "down")).join("") || `<p class="erp-muted">Няма възли — това е детайл (само материали/операции) или няма рецепта.</p>`}
        </div>
        <div class="dsnm-col">
          <h4>⬆ Влиза в <span class="erp-muted">(${up.length})</span></h4>
          ${(() => {
            // Разделено: първо междинните ВЪЗЛИ (с йерархията), после
            // КРАЙНИТЕ продукти (плоско, без повторения).
            const upNodes = up.filter(it => !it.top);
            const seen = new Set();
            const upTops = up.filter(it => it.top && !seen.has(it.p.id) && seen.add(it.p.id));
            if (!upNodes.length && !upTops.length) return `<p class="erp-muted">Не се влага никъде — краен продукт.</p>`;
            return `
              <h5 class="dsnm-subh">🔩 Възли <span class="erp-muted">(${upNodes.length})</span></h5>
              ${upNodes.map(it => row(it, "up")).join("") || `<p class="erp-muted">Няма междинни възли — влиза направо в крайни продукти.</p>`}
              <h5 class="dsnm-subh">🧾 Крайни продукти <span class="erp-muted">(${upTops.length})</span></h5>
              ${upTops.map(it => row({ p: it.p, qty: it.qty, depth: 0, top: true }, "up")).join("") || `<p class="erp-muted">Не стига до краен продукт.</p>`}`;
          })()}
        </div>
      </div>`;
  } else {
    body = `<p class="hint" style="font-size:15px">Напиши код или име на изделие горе — ще видиш възлите му (без дребните части) и къде се включва.</p>`;
  }
  wrap.innerHTML = `
    <div class="dsnm-box">
      <div class="dsnm-top-bar">
        <h3>🌳 Структура — само възлите</h3>
        <input type="search" id="dsnm-q" placeholder="🔎 код или име на изделие…" autocomplete="off" />
        <span class="spacer"></span>
        <button class="btn btn-small" id="dsnm-close">✕ Затвори</button>
      </div>
      <div id="dsnm-cand"></div>
      ${body}
    </div>`;
  wrap.querySelector("#dsnm-close").addEventListener("click", () => wrap.remove());
  const q = wrap.querySelector("#dsnm-q");
  const cand = wrap.querySelector("#dsnm-cand");
  q.addEventListener("input", () => {
    const t = q.value.trim().toLowerCase();
    if (t.length < 2) { cand.innerHTML = ""; return; }
    const hits = (ERP.products || [])
      .filter(x => ((x.code || "") + " " + (x.name || "")).toLowerCase().includes(t))
      .slice(0, 20);
    cand.innerHTML = hits.map(x => `<div class="dsnm-row" data-pick="${x.id}"><b>${escapeHtml(x.code || "")}</b> ${escapeHtml(x.name || "")}</div>`).join("");
    cand.querySelectorAll("[data-pick]").forEach(r => r.addEventListener("click", () => dsNodeMapRender(Number(r.dataset.pick))));
  });
  wrap.querySelectorAll("[data-go]").forEach(r => r.addEventListener("click", () => dsNodeMapRender(Number(r.dataset.go))));
  // 📋 рецепта — разгъва състава на възела под реда; ⤓ — сваля я като Excel.
  wrap.querySelectorAll(".dsnm-dl").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    if (typeof erpRecipeDownload === "function") erpRecipeDownload(Number(b.dataset.dl));
    else alert("Модулът Рецепти не е зареден. Презареди страницата.");
  }));
  wrap.querySelectorAll(".dsnm-rec").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const rowEl = b.closest(".dsnm-row, .dsnm-head-prod"); if (!rowEl) return;
    const nxt = rowEl.nextElementSibling;
    const same = nxt && nxt.classList && nxt.classList.contains("dsnm-rec-panel");
    if (same) { nxt.remove(); if (nxt.dataset.for === String(b.dataset.rec)) return; }
    rowEl.insertAdjacentHTML("afterend", dsNodeRecipePanel(Number(b.dataset.rec)));
    const panel = rowEl.nextElementSibling;
    const dlb = panel && panel.querySelector(".dsnm-panel-dl");
    if (dlb) dlb.addEventListener("click", () => {
      if (typeof erpRecipeDownload === "function") erpRecipeDownload(Number(dlb.dataset.dl));
      else alert("Модулът Рецепти не е зареден. Презареди страницата.");
    });
  }));
  if (!p) q.focus();
}

// Пълната рецепта на възел (дървото: възли/детайли, материали, операции с
// количества за 1 родител) — за панела „📋 рецепта" в Структурата.
function dsNodeRecipePanel(pid) {
  const rows = [];
  (function walk(id, depth, anc) {
    if (rows.length > 400) return;
    ((ERP.linesByProduct && ERP.linesByProduct[id]) || []).forEach(l => {
      const qty = erpNum(Number(l.quantity) || 1);
      const ind = depth * 20;
      if (l.material_id) {
        const m = ERP.matById[l.material_id] || {};
        rows.push(`<tr><td style="padding-left:${ind}px">🧱 материал</td><td><b>${escapeHtml(m.code || "")}</b></td><td>${escapeHtml(m.name || "")}</td><td class="num">${qty} ${escapeHtml(l.unit || m.unit || "")}</td></tr>`);
      } else if (l.operation_id) {
        const op = (ERP.opById && ERP.opById[l.operation_id]) || {};
        rows.push(`<tr><td style="padding-left:${ind}px">⚙ операция</td><td>${escapeHtml(op.code || "")}</td><td>${escapeHtml((op.name || "") + (op.workshop ? " · " + op.workshop : ""))}</td><td class="num">${qty}</td></tr>`);
      } else if (l.child_product_id) {
        const cp = ERP.prodById[l.child_product_id] || {};
        rows.push(`<tr><td style="padding-left:${ind}px">${dsIsAssembly(l.child_product_id) ? "🔩 възел" : "▪ детайл"}</td><td><b>${escapeHtml(cp.code || "")}</b></td><td>${escapeHtml(cp.name || "")}</td><td class="num">${qty} ${escapeHtml(l.unit || cp.unit || "бр.")}</td></tr>`);
        if (!anc.has(l.child_product_id)) walk(l.child_product_id, depth + 1, new Set([...anc, l.child_product_id]));
      }
    });
  })(pid, 0, new Set([pid]));
  const p = ERP.prodById[pid] || {};
  return `<div class="dsnm-rec-panel" data-for="${pid}">
    <div class="dsnm-rec-head">📋 Рецепта на <b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")}
      <span class="spacer"></span>
      <button type="button" class="btn btn-small dsnm-panel-dl" data-dl="${pid}">⤓ Свали (Excel)</button>
    </div>
    ${rows.length
      ? `<table class="report-table erp-table"><thead><tr><th>Тип</th><th>Код</th><th>Име</th><th class="num">К-во за 1 родител</th></tr></thead><tbody>${rows.join("")}</tbody></table>${rows.length > 400 ? `<p class="erp-muted">…показани първите 400 реда</p>` : ""}`
      : `<p class="erp-muted">Този възел няма рецепта.</p>`}
  </div>`;
}

/* ---------- „Опаковка" — сглобяване на артикул от наличните му части ----------
   За изделия без финална операция (напр. без „Опаковане"): частите са на склад,
   а готовият артикул не се събира от производството. Тук се сглобява ръчно:
   изписват се частите по рецептата, заприходява се готовият (erpAssembleFromParts). */
async function dsAssembleDialog(pid) {
  const p = ERP.prodById[pid] || {};
  if (typeof erpAssembleFromParts !== "function" || typeof erpDirectStockComponents !== "function") { alert("Модулът за производство не е зареден. Презареди страницата."); return; }
  const comps = erpDirectStockComponents(pid);
  if (!comps.length) { alert("Този продукт няма части по рецепта, от които да се сглоби."); return; }
  const stock = {};
  try {
    const { data } = await sb.from("v_product_stock").select("id,stock").in("id", comps.map(c => c.pid));
    (data || []).forEach(r => { stock[r.id] = Number(r.stock) || 0; });
  } catch (e) {}
  let max = Infinity;
  comps.forEach(c => { const per = Number(c.per) || 0; if (per > 0) max = Math.min(max, Math.floor(Math.max(0, stock[c.pid] || 0) / per)); });
  if (!isFinite(max)) max = 0;
  const rowsHtml = comps.map(c => {
    const cp = ERP.prodById[c.pid] || {};
    const per = Number(c.per) || 0, have = Math.max(0, stock[c.pid] || 0);
    return `<tr><td><b>${escapeHtml(cp.code || "")}</b></td><td>${escapeHtml(cp.name || "")}</td><td class="num">${erpNum(per)}</td><td class="num ${have < per ? "erp-warn" : ""}">${erpNum(stock[c.pid] || 0)}</td><td class="num">${per > 0 ? erpNum(Math.floor(have / per)) : "—"}</td></tr>`;
  }).join("");
  const { wrap, close } = erpDialog(`
    <h3>🧩 Сглоби от налични части</h3>
    <p><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} — сега на склад: <b>${erpNum(Number(p.stock) || 0)}</b> ${escapeHtml(p.unit || "бр.")}</p>
    <table class="report-table erp-table"><thead><tr><th>Код</th><th>Част (за 1 бр.)</th><th class="num">Бройка</th><th class="num">Налично</th><th class="num">Стига за</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    <p class="hint">Изписва частите от Склад детайли и заприходява готовия артикул — „опаковка" без операция в цех. Ако част не достига, системата първо опитва да сглоби нея от нейните части.</p>
    <label class="erp-inline">Колко броя да сглобя <input type="number" id="asm-qty" min="1" step="1" value="${max > 0 ? max : ""}" style="width:110px" /></label>
    <span class="erp-muted">възможни сега: <b>${erpNum(max)}</b></span>
    <div class="erp-dialog-actions">
      <button class="btn" id="asm-cancel">Отказ</button>
      <button class="btn btn-primary" id="asm-go" ${max > 0 ? "" : "disabled"}>🧩 Сглоби</button>
    </div>
    <p class="save-status" id="asm-status"></p>`);
  wrap.querySelector("#asm-cancel").addEventListener("click", close);
  wrap.querySelector("#asm-go").addEventListener("click", async () => {
    const q = Math.floor(erpToNum(wrap.querySelector("#asm-qty").value) || 0);
    if (!(q > 0)) { alert("Въведи брой по-голям от 0."); return; }
    const btn = wrap.querySelector("#asm-go"); btn.disabled = true;
    const st = wrap.querySelector("#asm-status"); st.textContent = "Сглобявам…";
    const res = await erpAssembleFromParts(pid, q, "сглоб:ръчно");
    if (res.error) { st.textContent = "⚠ Грешка: " + res.error; btn.disabled = false; return; }
    close();
    await erpLoadAll();
    erpRenderDetailStock();
    const missTxt = (res.missing || []).map(m => `• ${m.code} ${m.name}: липсват ${erpNum(m.short)}`).join("\n");
    alert(res.made > 0
      ? `🧩 Сглобени ${erpNum(res.made)} бр. „${p.name || ""}" — частите са изписани, готовият е заприходен.`
        + (res.made < q ? `\n\nЗа останалите ${erpNum(q - res.made)} бр. не достигат части:\n${missTxt}` : "")
      : `Не може да се сглоби нито един брой — липсват части:\n${missTxt}`);
  });
}

function dsMoveDialog(pid, kind) {
  const p = ERP.prodById[pid] || {};
  const cur = Number(p.stock) || 0;
  const isCorr = kind === "корекция";
  const title = kind === "заприходяване" ? "Заприходи в склада" : kind === "изписване" ? "Изпиши от склада" : "Задай точна наличност";
  const { wrap, close } = erpDialog(`
    <h3>${title}</h3>
    <p><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} — сега на склад: <b>${erpNum(cur)}</b> ${escapeHtml(p.unit || "бр.")}</p>
    ${isCorr ? `<p class="hint" style="background:#fef3c7;border-left:3px solid #f59e0b;padding:8px 10px;border-radius:6px">
      ⚠ <b>Числото тук е ЦЯЛАТА истина за този детайл</b> — колко има РЕАЛНО: на склад, по линията, полуготови (нарязани и чакащи), запазени за заявки.
      Напишеш ли <b>0</b>, значи го няма никъде. След записа Системата предлага да пренастрои производството по новата бройка.
    </p>` : ""}
    <label class="erp-inline">${isCorr ? "Реална наличност (всичко налично)" : "Брой"}
      <input type="number" id="ds-qty" min="0" step="any" value="${isCorr ? cur : ""}" style="width:120px" autofocus />
    </label>
    <label>Бележка (по избор)<input type="text" id="ds-note" placeholder="напр. партида, дата, причина" /></label>
    <div class="erp-dialog-actions">
      <button class="btn" id="ds-cancel">Отказ</button>
      <button class="btn btn-primary" id="ds-ok">Запиши</button>
    </div>`);
  wrap.querySelector("#ds-cancel").addEventListener("click", close);
  wrap.querySelector("#ds-ok").addEventListener("click", async () => {
    const val = erpToNum(wrap.querySelector("#ds-qty").value);
    const note = (wrap.querySelector("#ds-note").value || "").trim();
    if (isCorr) {
      const delta = val - cur;
      if (!delta) { close(); return; }
      const { error } = await sb.from("product_movements").insert({ product_id: pid, kind: "корекция", quantity: delta, note: note || "Корекция на наличност" });
      if (error) { alert("Грешка: " + error.message); return; }
    } else {
      if (!(val > 0)) { alert("Въведи брой по-голям от 0."); return; }
      const signed = kind === "изписване" ? -val : val;
      const { error } = await sb.from("product_movements").insert({ product_id: pid, kind, quantity: signed, note });
      if (error) { alert("Грешка: " + error.message); return; }
    }
    close();
    await erpLoadAll();
    erpRenderDetailStock();
    // РЪЧНАТА КОРЕКЦИЯ Е ИСТИНАТА: това е всичко налично — на склад И по
    // линията. Затова пренастройваме производството по новата бройка.
    if (isCorr) { try { await dsReplanAfterCorrection(pid, val, cur); } catch (e) { alert("Пренастройката не мина: " + (e.message || e)); } }
  });
}

/* ---------- Пренастройка след ръчна корекция на наличност ----------
   Новата бройка е ЦЯЛАТА истина за детайла: няма скрити бройки в цеха,
   няма полуготови (нарязани и чакащи), няма запазени за друга заявка.
   Затова:
     1) чистим резервациите (flow_netting) за този детайл — свободен е;
     2) нулираме отчетеното по НЕЗАВЪРШЕНИТЕ междинни операции за кода
        (полуфабрикатът физически го няма);
     2б) при корекция НАДОЛУ смъкваме „произведено" (и заприходено) по
        ПОСЛЕДНИТЕ операции на активните вериги с липсващата разлика —
        иначе броячите „помнят" готови бройки, които вече не съществуват,
        никой не ги преработва и недостигът изплува чак при сглобяване/
        продажба. Вечният дневник пази труда — добавя се коригиращ запис;
     3) пре-пускаме активните заявки, в които участва детайлът — плановете
        се преизчисляват спрямо реалната наличност (липсващите влизат
        отново като работа за цеховете). */
async function dsReplanAfterCorrection(pid, newQty, oldQty) {
  const p = (ERP.prodById || {})[pid] || {};
  const code = String(p.code || "").trim();
  if (!code) return;
  // Кои активни заявки съдържат този детайл (директно или в рецепта)?
  let orders = [];
  try {
    const { data } = await erpSelectAll("customer_orders", "id,data");
    orders = (data || []).map(r => ({ id: r.id, ...(r.data || {}) }))
      .filter(o => o.production && o.status !== "завършена");
  } catch (e) {}
  const uses = o => (o.lines || []).some(l => {
    if (String(l.productId) === String(pid)) return true;
    if (typeof erpFlowSteps !== "function" || !l.productId) return false;
    try { return erpFlowSteps({ erpProductId: l.productId, erpQty: 1 }, {}).steps.some(st => String(st.code || "").trim() === code); }
    catch (e) { return false; }
  });
  const affected = orders.filter(uses);
  // Поточните задачи за кода: незавършените МЕЖДИННИ операции (полуготовите)
  // и ПОСЛЕДНИТЕ операции на активните вериги (за смъкване при липси).
  let midTasks = [], lastTasks = [];
  try {
    const { data } = await erpSelectAll("tasks", "id,done,data", "data->source->>flow", "true");
    (data || []).forEach(r => {
      const d = r.data || {}, src = d.source || {};
      if (src.kind !== "series" || String(src.code || "").trim() !== code) return;
      if (String(src.seriesKey || "").includes("¦арх:")) return;   // архив — не се пипа
      if (!src.last && !r.done && (Number(d.produced) || 0) > 0) midTasks.push(r);
      if (src.last && (Number(d.produced) || 0) > 0) lastTasks.push(r);
    });
  } catch (e) {}
  // Липсващи ГОТОВИ бройки (корекция надолу): разпределяме разликата като
  // смъкване на „произведено" по последните операции — първо от най-големите
  // броячи. Толкова ще се ПРЕРАБОТИ при пре-пускането.
  const lost = Math.max(0, (Number(oldQty) || 0) - (Number(newQty) || 0));
  const lastCuts = [];
  if (lost > 0 && lastTasks.length) {
    lastTasks.sort((a, b) => (Number(b.data.produced) || 0) - (Number(a.data.produced) || 0));
    let left = lost;
    lastTasks.forEach(r => {
      if (left <= 0) return;
      const cut = Math.min(Number(r.data.produced) || 0, left);
      if (cut > 0) { lastCuts.push({ r, cut }); left -= cut; }
    });
  }
  const cutTotal = lastCuts.reduce((s, x) => s + x.cut, 0);
  // Снимка на задачите за ТОЗИ код преди пренастройването — за да се види
  // черно на бяло какво се променя (и че вече произведеното НЕ се губи).
  const snapTasks = async () => {
    const out = {};
    try {
      const { data } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
      (data || []).forEach(r => {
        const d = r.data || {}, src = d.source || {};
        if (src.kind !== "series" || String(src.code || "").trim() !== code) return;
        out[src.seriesKey] = { op: d.operation || "", ws: d.workshop || "", qty: Number(d.qty) || 0, produced: Number(d.produced) || 0 };
      });
    } catch (e) {}
    return out;
  };
  const before = await snapTasks();
  // Частично доставените заявки: пренастройването смята ЦЯЛОТО поръчано
  // количество, а вече отчетеното по задачите остава — то покрива доставеното.
  const partLines = [];
  affected.forEach(o => {
    let tot = 0, del = 0;
    (o.lines || []).forEach(l => { const q = erpToNum(l.qty) || 0; tot += q; del += Math.min(q, Number(l.delivered) || 0); });
    if (del > 0) partLines.push(`   № ${o.ourNo || "—"} ${o.clientName || ""}: поръчани ${erpNum(tot)}, доставени ${erpNum(del)}`);
  });
  const msg = `Ръчната корекция задава ${erpNum(newQty)} бр. като ЦЯЛАТА налична бройка на ${code} `
    + `(склад + производство + полуготови).\n\n`
    + `Да пренастроя ли производството?\n`
    + `• освобождавам резервациите на този детайл по заявките\n`
    + (midTasks.length ? `• нулирам отчетеното по ${midTasks.length} незавършени МЕЖДИННИ операции (полуготовите ги няма)\n` : "")
    + (cutTotal > 0 ? `• смъквам „произведено" по ${lastCuts.length} задачи (последна операция) с общо ${erpNum(cutTotal)} бр. — липсващите готови се ПРЕРАБОТВАТ от цеховете\n` : "")
    + (lost > cutTotal ? `• ⚠ ${erpNum(lost - cutTotal)} бр. от липсата не се водят по никоя задача (ръчно заприходени/стари) — просто ги няма\n` : "")
    + (affected.length ? `• пре-пускам ${affected.length} активни заявки, за да се преизчислят по реалната наличност\n` : "• няма активни заявки с този детайл\n")
    + (partLines.length
      ? `\n⚠ ЧАСТИЧНО ДОСТАВЕНИ ЗАЯВКИ:\n${partLines.join("\n")}\n`
        + `   Смята се ЦЯЛОТО поръчано количество, но вече отчетеното по задачите се ЗАПАЗВА —\n`
        + `   значи в цеха остава само недовършеното. Ако доставените бройки са тръгнали от\n`
        + `   склада, а не от цеха, провери остатъците след пренастройването.\n`
      : "");
  if (!confirm(msg)) return;
  // 1) резервациите
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
    const by = (data && data.data && data.data.byOrder) || {};
    let ch = false;
    Object.keys(by).forEach(oid => { if (by[oid] && by[oid][pid] != null) { delete by[oid][pid]; ch = true; if (!Object.keys(by[oid]).length) delete by[oid]; } });
    if (ch) await sb.from("app_config").upsert({ id: "flow_netting", data: { byOrder: by }, updated_at: new Date().toISOString() });
  } catch (e) {}
  // 2) полуготовите ги няма
  for (const r of midTasks) {
    const d = r.data || {};
    d.produced = 0;
    (d.source || {}).consumedUnits = 0;
    try { await sb.from("tasks").update({ data: d, updated_at: new Date().toISOString() }).eq("id", r.id); } catch (e) {}
  }
  // 2б) липсващите готови: смъкваме „произведено"/заприходено на последните
  // операции — задачите се „отварят" наново и цехът ги преработва. БЕЗ
  // складово движение (корекцията вече смъкна наличността); дневникът
  // получава коригиращ запис, оригиналните отчети на хората остават.
  for (const x of lastCuts) {
    const d = x.r.data || {}, src = d.source || {};
    d.produced = Math.max(0, (Number(d.produced) || 0) - x.cut);
    if ((Number(src.stocked) || 0) > d.produced) src.stocked = d.produced;   // повторното отчитане да заприходи наново
    const q = Number(d.qty) || 0;
    const done = !!d.closed || (q > 0 && (Number(d.produced) || 0) >= q);
    try { await sb.from("tasks").update({ data: d, done, updated_at: new Date().toISOString() }).eq("id", x.r.id); } catch (e) {}
    try {
      if (typeof prodLogWrite === "function") await prodLogWrite(d, {
        date: new Date().toISOString().slice(0, 10),
        worker: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && (MY_ACCESS.name || MY_ACCESS.email)) || "офис",
        qty: -x.cut,
        lid: (typeof prodLogId === "function") ? prodLogId() : (Date.now().toString(36) + "-c" + Math.random().toString(36).slice(2, 5)),
        activity: "Корекция на наличност — липсващи готови за преработка",
      });
    } catch (e) { /* дневникът може да липсва */ }
  }
  // 3) пре-пускане на засегнатите заявки
  let ok = 0, fail = 0;
  for (const o of affected) {
    const lines = (o.lines || []).filter(l => l.productId && (erpToNum(l.qty) || 0) > 0)
      .map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 0 }));
    if (!lines.length) continue;
    try {
      const res = await erpFlowApply({
        clientName: o.clientName || "", deadline: o.deadline || "", sampleId: o.id,
        sampleType: "customer_order", orderNo: o.ourNo || "", matSubs: o.matSubs || null, stockTop: true,
      }, lines);
      if (res && res.error) fail++; else ok++;
    } catch (e) { fail++; }
  }
  const after = await snapTasks();
  // Какво се смени по задачите на този код: остатък преди → след.
  const diff = [];
  Object.keys(after).forEach(k => {
    const a = after[k], b = before[k] || { qty: 0, produced: 0 };
    const ra = Math.max(0, a.qty - a.produced), rb = Math.max(0, b.qty - b.produced);
    if (ra !== rb || a.qty !== b.qty) diff.push(`• ${a.ws || ""} · ${a.op || ""}: остатък ${erpNum(rb)} → ${erpNum(ra)} (кол. ${erpNum(b.qty)} → ${erpNum(a.qty)}, произведено ${erpNum(a.produced)})`);
  });
  await erpLoadAll();
  erpRenderDetailStock();
  alert(`✓ Пренастроено по новата наличност на ${code}.\n`
    + `• резервациите — освободени\n`
    + (midTasks.length ? `• нулирани междинни операции: ${midTasks.length}\n` : "")
    + `• преизчислени заявки: ${ok}${fail ? ` (неуспешни: ${fail})` : ""}\n`
    + (diff.length ? `\nПромени по задачите (произведеното е запазено):\n${diff.join("\n")}\n` : `\nЗадачите за ${code} останаха същите.\n`)
    + `\nПровери Цехове — количествата по задачите вече са спрямо реалната наличност.`);
}

async function dsHistory(pid) {
  const p = ERP.prodById[pid] || {};
  const { data, error } = await sb.from("product_movements").select("kind,quantity,ref,note,created_at").eq("product_id", pid).order("created_at", { ascending: false }).limit(100);
  const rows = error ? [] : (data || []);
  const { wrap, close } = erpDialog(`
    <h3>История · ${escapeHtml(p.code || "")} ${escapeHtml(p.name || "")}</h3>
    <div class="erp-lp-list">
      ${rows.length ? `<table class="report-table erp-table"><thead><tr><th>Дата</th><th>Тип</th><th class="num">Кол.</th><th>Бележка</th></tr></thead>
        <tbody>${rows.map(m => `<tr>
          <td>${erpDMY((m.created_at || "").slice(0, 10))}</td>
          <td>${escapeHtml(m.kind || "")}</td>
          <td class="num ${Number(m.quantity) < 0 ? "erp-warn" : ""}">${Number(m.quantity) > 0 ? "+" : ""}${erpNum(Number(m.quantity) || 0)}</td>
          <td>${escapeHtml(m.note || m.ref || "")}</td>
        </tr>`).join("")}</tbody></table>` : `<p class="report-empty">Няма движения.</p>`}
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="ds-h-close">Затвори</button></div>`);
  wrap.querySelector("#ds-h-close").addEventListener("click", close);
}
