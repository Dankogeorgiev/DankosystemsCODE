/* Данко Системс — ЕРП таб „💶 Себестойности" (реална калкулация на изделие).
   Един екран, който събира АВТОМАТИЧНО всичко, което системата знае за едно
   изделие, и прави реалната му цена — без ръчно преписване:
   • рецептното дърво (recipe_lines): детайли/възли × количества, материали
     (кг/бр по средна складова цена от покупките), операции по цехове;
   • ВРЕМЕНАТА от цеховете (production_log + живите задачи): за всеки детайл +
     операция — средно време за 1 бр., брой измервания, най-ползвана машина,
     време за настройка (амортизирано по партидите);
   • СТАВКИТЕ от „Разходи и ставки": труд + машина (по реалната машина) +
     режийни, €/час;
   • ПРОДАЖНАТА цена: ценова листа на клиента → последна заявка на клиента →
     последна заявка изобщо;
   • ПОСЛЕДНИТЕ покупни цени на материалите (сверка със средната).
   Резултат: калкулация по редове + обобщение (материали / труд / машина /
   режийни / рецептна цена / реална цена / маржин) + списък „Проверки" с всичко,
   което липсва или е съмнително (без цена, без време, без ставка, малко
   измервания, разминаване рецепта↔реално, стара покупна цена…).
   Само за финансовия достъп (financeAllowed). Ползва ERP/erpCostRates/
   erpMachineRateFor/collectTimeRows/erpPriceListEntry/erpCOList/erpPurchases. */

let CS = { client: "", pid: null, view: "list", busy: false };
const CS_DEFAULT_CLIENT = "ню мениджмънт";     // първоначален фокус (по искане на Данко)
const CS_DEFAULT_CODE = "103839";              // Механизъм 3 Дроп Ин 730 пълен комплект

/* ---------- Зареждане на източниците ---------- */
async function csEnsureData() {
  await erpEnsureLoaded();
  try { if (typeof erpEnsureOwnerClients === "function") await erpEnsureOwnerClients(); } catch (e) {}
  try { if (typeof erpLoadCostCfg === "function") await erpLoadCostCfg(); } catch (e) {}
  try { if (typeof erpPLEnsureCache === "function") await erpPLEnsureCache(); } catch (e) {}
  try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}
  try { if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases(); } catch (e) {}
  // Времената: вечният дневник + живите задачи (както в „Отчети").
  try { if (typeof loadProdLog === "function" && (typeof PROD_LOG === "undefined" || !PROD_LOG || !PROD_LOG.length)) await loadProdLog(); } catch (e) {}
  try { if (typeof tLoadTasks === "function" && (typeof TASKS === "undefined" || !TASKS || !TASKS.length)) await tLoadTasks(); } catch (e) {}
  await csLoadExtras();
}

/* ---------- ➕ Допълнителни разходи (извън рецептата) ----------
   Общи параметри (за всички изделия) + стойности за конкретното изделие.
   Пази се в app_config id="cost_extras": { params, byProduct: { pid: {...} } }.
   • Прахова боя: боядисана площ м²/изделие (за изделието) × €/м² (общо или
     за изделието). Влиза само ако рецептата минава през Бояджийно.
   • Опаковка: АВТОМАТИЧНО от таб „Опаковки" (бр./кашон, кашони/палет за
     клиента и кода) × цени на кашон/палет/стреч (общи); или €/бр. ръчно.
   • Транспорт: €/палет (общо) ÷ бройки на палет (от Опаковки); или €/бр.
   • Брак: % надбавка върху материали+операции (общ или за изделието);
     показва се и измереният брак при настройка от цеховете за сравнение.
   • Заваръчни консумативи (тел, газ, дюзи): €/час заваряване × измереното време.
   • Административни / гаранция: % върху всичко. */
let CS_EXTRAS = null;
const CS_EXTRA_DEFAULTS = { paintEurM2: 1.8, boxEur: 0.9, palletEur: 8, wrapEur: 2.5, transportPallet: 45, scrapPct: 2, weldEurH: 3.5, otherPct: 0 };
const CS_PARAM_LABELS = [
  ["paintEurM2", "Прахова боя, € за 1 м² боядисана площ", "прах ~€8–12/кг × ~0,15 кг/м² + газ за пещта"],
  ["boxEur", "Кашон, € за 1 бр.", ""],
  ["palletEur", "Палет, € за 1 бр.", "EUR палет / еднократен"],
  ["wrapEur", "Стреч + ъгли + лента, € за 1 палет", ""],
  ["transportPallet", "Транспорт, € за 1 палет", "средно за курс ÷ палети в курса"],
  ["scrapPct", "Брак и загуби, % върху материали + операции", "ако няма измерен за изделието"],
  ["weldEurH", "Заваръчни консумативи (тел, газ), € за 1 час заваряване", ""],
  ["otherPct", "Административни / гаранция / рекламации, % върху всичко", ""],
];
async function csLoadExtras() {
  if (CS_EXTRAS) return CS_EXTRAS;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "cost_extras").maybeSingle();
    CS_EXTRAS = (data && data.data) || {};
  } catch (e) { CS_EXTRAS = {}; }
  CS_EXTRAS.params = Object.assign({}, CS_EXTRA_DEFAULTS, CS_EXTRAS.params || {});
  CS_EXTRAS.byProduct = CS_EXTRAS.byProduct || {};
  return CS_EXTRAS;
}
async function csSaveExtras() {
  const { error } = await sb.from("app_config").upsert({ id: "cost_extras", data: CS_EXTRAS, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function csPackSpec(clientName, code) {
  const list = (typeof PACKAGING !== "undefined" && PACKAGING) || [];
  const cn = csNorm(clientName), cd = csNorm(code);
  if (!cd) return null;
  return list.find(x => csNorm(x.code) === cd && (!cn || csNorm(x.clientName) === cn))
      || list.find(x => csNorm(x.code) === cd) || null;
}
// Измерен брак при настройка за детайлите от дървото (от живите задачи).
function csMeasuredScrap(codes) {
  const set = new Set(codes.map(csNorm).filter(Boolean));
  let brak = 0, prod = 0;
  ((typeof TASKS !== "undefined" && TASKS) || []).forEach(t => {
    if (!t.source || !t.source.flow || !set.has(csNorm(t.code))) return;
    brak += Number(t.brak) || 0; prod += Number(t.produced) || 0;
  });
  return prod > 0 ? brak / prod * 100 : null;
}
function csExtras(pid, clientName, base) {
  const X = CS_EXTRAS || { params: CS_EXTRA_DEFAULTS, byProduct: {} };
  const P = X.params, o = X.byProduct[String(pid)] || {};
  const p = ERP.prodById[pid] || {};
  const num = v => (v === "" || v == null) ? null : (Number(String(v).replace(",", ".")) || 0);
  const rows = [], checks = [];
  const hasPaint = base.ops.some(r => /бояд|боя/i.test(r.ws) || /бояд/i.test(r.op));
  // 1) Прахова боя
  const m2 = num(o.paintM2), eurM2 = num(o.paintEurM2) != null ? num(o.paintEurM2) : P.paintEurM2;
  if (hasPaint) {
    const cost = (m2 || 0) * (eurM2 || 0);
    rows.push({ key: "paint", label: "Прахова боя", how: m2 ? `${erpNum(m2)} м² × ${erpEur(eurM2)}/м²` : "няма зададена боядисана площ", cost, source: m2 ? (num(o.paintEurM2) != null ? "площ и €/м² за изделието" : "площ за изделието × общ €/м²") : "—" });
    if (!m2) checks.push({ level: "warn", what: "Прахова боя", why: "рецептата минава през Бояджийно, но няма зададена боядисана площ (м²) — боята влиза с 0 €" });
  }
  // 2) Опаковка
  const spec = csPackSpec(clientName, p.code);
  const ppb = spec ? Number(spec.piecesPerBox) || 0 : 0, bpp = spec ? Number(spec.boxesPerPallet) || 0 : 0;
  const palletPieces = ppb * bpp;
  let packCost = 0, packHow = "", packSrc = "";
  if (num(o.packEur) != null) { packCost = num(o.packEur); packHow = "ръчно €/бр."; packSrc = "за изделието"; }
  else if (ppb > 0) {
    packCost = P.boxEur / ppb + (palletPieces > 0 ? (P.palletEur + P.wrapEur) / palletPieces : 0);
    packHow = `кашон ${erpEur(P.boxEur)} ÷ ${ppb} бр.` + (palletPieces > 0 ? ` + палет ${erpEur(P.palletEur + P.wrapEur)} ÷ ${palletPieces} бр.` : "");
    packSrc = `таб „Опаковки" (${spec.clientName || ""})`;
  } else { packHow = "няма опаковъчна спецификация"; checks.push({ level: "info", what: "Опаковка", why: `няма ред в таб „Опаковки" за ${clientName || "клиента"} и код ${p.code || ""} — опаковката влиза с 0 € (или задай €/бр. тук)` }); }
  rows.push({ key: "pack", label: "Опаковка", how: packHow, cost: packCost, source: packSrc || "—" });
  // 3) Транспорт
  let trCost = 0, trHow = "", trSrc = "";
  if (num(o.transportEur) != null) { trCost = num(o.transportEur); trHow = "ръчно €/бр."; trSrc = "за изделието"; }
  else if (palletPieces > 0) { trCost = P.transportPallet / palletPieces; trHow = `${erpEur(P.transportPallet)}/палет ÷ ${palletPieces} бр.`; trSrc = "общ €/палет × Опаковки"; }
  else { trHow = "няма бройки на палет"; checks.push({ level: "info", what: "Транспорт", why: "без бройки на палет (Опаковки) транспортът не може да се разпредели — задай €/бр. тук" }); }
  rows.push({ key: "transport", label: "Транспорт", how: trHow, cost: trCost, source: trSrc || "—" });
  // 4) Заваръчни консумативи
  const weldH = base.ops.filter(r => /зав/i.test(r.ws) && r.sec != null).reduce((s, r) => s + (r.sec + (r.setupSec || 0)) / 3600 * r.mult, 0);
  if (weldH > 0) rows.push({ key: "weld", label: "Заваръчни консумативи", how: `${erpNum(Math.round(weldH * 600) / 10)} мин заваряване × ${erpEur(P.weldEurH)}/ч`, cost: weldH * P.weldEurH, source: "измерено време × общ €/ч" });
  // 5) Брак
  const measured = csMeasuredScrap(base.codes || []);
  const scrapPct = num(o.scrapPct) != null ? num(o.scrapPct) : P.scrapPct;
  const scrapBase = base.mat + base.ops.reduce((s, r) => s + r.cost, 0);
  rows.push({ key: "scrap", label: "Брак и загуби", how: `${erpNum(scrapPct)} % × ${erpEur(scrapBase)}` + (measured != null ? ` · измерен при настройка: ${erpNum(Math.round(measured * 10) / 10)} %` : ""), cost: scrapBase * scrapPct / 100, source: num(o.scrapPct) != null ? "за изделието" : "общ %" });
  if (measured != null && measured > scrapPct + 1) checks.push({ level: "info", what: "Брак", why: `измереният брак при настройка (${erpNum(Math.round(measured * 10) / 10)} %) е над заложения ${erpNum(scrapPct)} %` });
  // 6) Административни
  const sub = base.real + rows.reduce((s, r) => s + r.cost, 0);
  if (P.otherPct > 0) rows.push({ key: "other", label: "Административни / гаранция", how: `${erpNum(P.otherPct)} % × ${erpEur(sub)}`, cost: sub * P.otherPct / 100, source: "общ %" });
  const total = rows.reduce((s, r) => s + r.cost, 0);
  return { rows, total, checks, override: o, params: P, hasPaint, spec, palletPieces, measuredScrap: measured };
}

/* ---------- Индекс на времената: детайл¦операция → статистика ---------- */
function csNorm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
function csTimeIndex() {
  const rows = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const byDetailOp = {}, byOp = {};
  const add = (map, key, r) => {
    const pp = (r.tPiece && r.tPiece.sec) ? Number(r.tPiece.sec)
      : ((r.tOrder && r.tOrder.sec && Number(r.qty) > 0) ? Number(r.tOrder.sec) / Number(r.qty) : null);
    const g = map[key] || (map[key] = { n: 0, pieces: 0, wsum: 0, wq: 0, machines: {}, workers: new Set(), last: "", setupSum: 0, setupQ: 0, setupN: 0, ws: r.workshop || "" });
    if (pp != null && pp > 0) {
      const q = Number(r.qty) || 1;
      g.n++; g.pieces += q; g.wsum += pp * q; g.wq += q;
      if (r.machine) g.machines[r.machine] = (g.machines[r.machine] || 0) + q;
      if (r.worker) g.workers.add(r.worker);
      if ((r.date || "") > g.last) g.last = r.date || "";
    }
    // Настройка: секунди за партидата → амортизира се на бройките ѝ.
    if (r.tSetup && r.tSetup.sec && Number(r.qty) > 0) { g.setupSum += Number(r.tSetup.sec); g.setupQ += Number(r.qty); g.setupN++; }
  };
  rows.forEach(r => {
    const op = csNorm(r.operation); if (!op) return;
    if (r.code) add(byDetailOp, csNorm(r.code) + "¦" + op, r);
    add(byOp, op, r);
  });
  const fin = g => {
    if (!g) return null;
    const machine = Object.keys(g.machines).sort((a, b) => g.machines[b] - g.machines[a])[0] || "";
    return {
      n: g.n, pieces: g.pieces, avg: g.wq > 0 ? g.wsum / g.wq : null,
      machine, workers: g.workers.size, last: g.last, ws: g.ws,
      setupPerPiece: g.setupQ > 0 ? g.setupSum / g.setupQ : 0, setupN: g.setupN,
    };
  };
  return {
    detailOp: (code, op) => fin(byDetailOp[csNorm(code) + "¦" + csNorm(op)]),
    op: op => fin(byOp[csNorm(op)]),
  };
}

/* ---------- Продажна цена за клиент+продукт ---------- */
function csSalePrice(clientName, pid) {
  const cn = csNorm(clientName);
  // 1) Ценова листа на клиента.
  if (clientName && typeof erpPriceListEntry === "function") {
    const e = erpPriceListEntry(null, clientName, pid);
    if (e && Number(e.price) > 0) return { price: Number(e.price), currency: e.currency || "EUR", source: "ценова листа" };
  }
  // 2) Последна заявка на клиента с този продукт; 3) последна заявка изобщо.
  const list = ((typeof erpCOList !== "undefined" && erpCOList) || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const find = own => {
    for (const o of list) {
      if (own && csNorm(o.clientName) !== cn) continue;
      const l = (o.lines || []).find(x => String(x.productId) === String(pid) && (erpToNum(x.unitPrice) || 0) > 0);
      if (l) return { price: erpToNum(l.unitPrice), currency: o.currency || "EUR", source: (own ? "заявка №" : "заявка на друг клиент №") + (o.ourNo || "—") + " · " + (erpDMY(o.date) || ""), client: o.clientName || "" };
    }
    return null;
  };
  return (cn && find(true)) || find(false) || null;
}

/* ---------- Последна покупна цена на материал (сверка) ---------- */
function csLastPurchase(mid) {
  const pur = (typeof erpPurchases !== "undefined" && erpPurchases) || [];
  let best = null;
  pur.forEach(o => (o.lines || []).forEach(l => {
    if (Number(l.materialId) !== Number(mid)) return;
    const price = erpToNum(l.unitPrice) || 0; if (!(price > 0)) return;
    const eur = (o.currency === "BGN") ? price / 1.95583 : price;
    if (!best || String(o.date || "") > best.date) best = { date: String(o.date || ""), price: eur, supplier: o.supplierName || "" };
  }));
  return best;
}

/* ---------- Калкулацията ---------- */
function csBuild(pid, clientName) {
  const R = (typeof erpCostRates === "function") ? erpCostRates() : { rate: {}, machineRate: {}, overheadRate: 0 };
  const T = csTimeIndex();
  const mats = {}, ops = [], nodes = [], checks = [], opAgg = {};
  const route = op => (typeof erpEffectiveRoute === "function") ? (erpEffectiveRoute(op).primary || op.workshop || "") : (op.workshop || "");
  const check = (level, what, why) => checks.push({ level, what, why });

  (function walk(id, mult, anc, depth, parentName) {
    const p = ERP.prodById[id] || {};
    const lines = ERP.linesByProduct[id] || [];
    const node = { pid: id, code: p.code || "", name: p.name || ("#" + id), mult, depth, parent: parentName || "", ops: 0, mats: 0, children: 0 };
    nodes.push(node);
    const manual = (typeof erpManualCostOf === "function") ? erpManualCostOf(id) : null;
    if (!lines.length) {
      // Лист без рецепта: покупна част с ръчна цена или дупка в рецептата.
      if (manual != null) { node.manual = manual; node.manualCost = manual * mult; }
      else check("warn", `${node.code} ${node.name}`, "възел без рецепта и без ръчна цена — влиза с 0 €");
      return;
    }
    lines.forEach(l => {
      const q = Number(l.quantity) || 0;
      if (l.material_id) {
        const m = ERP.matById[l.material_id] || {};
        const key = String(l.material_id);
        const g = mats[key] || (mats[key] = { mid: l.material_id, code: m.code || "", name: m.name || ("#" + l.material_id), unit: l.unit || m.unit || "", avg: Number(m.avg_cost) || 0, qty: 0, usedIn: new Set() });
        g.qty += q * mult; g.usedIn.add(node.code || node.name); node.mats++;
      } else if (l.operation_id) {
        // Събираме по детайл+операция: един детайл, влизащ през два възела
        // (напр. Винкел в ляв и десен механизъм), е ЕДИН ред с общата бройка.
        const key = (node.code || node.name) + "¦" + l.operation_id;
        const g = opAgg[key] || (opAgg[key] = { node, l, mult: 0 });
        g.mult += mult; node.ops++;
      } else if (l.child_product_id && !anc.has(l.child_product_id)) {
        node.children++;
        walk(l.child_product_id, mult * (q || 1), new Set([...anc, l.child_product_id]), depth + 1, node.code || node.name);
      }
    });
  })(pid, 1, new Set([pid]), 0, "");

  Object.values(opAgg).forEach(({ node, l, mult }) => {
    const q = Number(l.quantity) || 0;
    const op = ERP.opById[l.operation_id] || {};
    const ws = route(op);
    const perUnit = q || 1;   // технологичен множител (напр. 4 огъвки) — за цената по рецепта
    const unitCost = (typeof erpOpLinePrice === "function") ? erpOpLinePrice(l) : (Number(op.unit_cost) || 0);
    const md = T.detailOp(node.code, op.name);
    const mo = md && md.n ? null : T.op(op.name);
    const meas = (md && md.n) ? md : ((mo && mo.n) ? mo : null);
    const rate = R.rate[ws] || null;
    const machine = meas ? meas.machine : "";
    const mRate = rate ? ((typeof erpMachineRateFor === "function") ? erpMachineRateFor(machine, ws, R) : rate.machine) : 0;
    const labor = rate ? rate.labor : 0, overhead = R.overheadRate || 0;
    const full = labor + mRate + overhead;
    const row = {
      node: node.code || node.name, nodeName: node.name, mult, op: op.name || "", ws, perUnit,
      unitCost, recipeCost: perUnit * unitCost * mult,
      machine, labor, mRate, overhead, full,
      sec: meas ? meas.avg : null, setupSec: meas ? meas.setupPerPiece : 0,
      n: meas ? meas.n : 0, pieces: meas ? meas.pieces : 0, last: meas ? meas.last : "",
      source: (md && md.n) ? "измерено за детайла" : ((mo && mo.n) ? "средно за операцията (друг детайл)" : (unitCost > 0 ? "рецепта (ставка на операцията)" : "няма данни")),
      sourceLvl: (md && md.n) ? 0 : ((mo && mo.n) ? 1 : (unitCost > 0 ? 2 : 3)),
    };
    if (row.sec != null && full > 0) {
      const h = (row.sec + row.setupSec) / 3600 * mult;   // времето за 1 детайл покрива всички огъвки
      row.timeCost = h * full; row.laborCost = h * labor; row.machineCost = h * mRate; row.overheadCost = h * overhead;
      row.cost = row.timeCost;
    } else {
      row.cost = row.recipeCost; row.laborCost = 0; row.machineCost = 0; row.overheadCost = 0; row.timeCost = null;
    }
    ops.push(row);
    if (!ws) check("warn", `${row.node} · ${row.op}`, "операцията няма цех — няма ставка");
    else if (!rate || !(rate.full > 0)) check("warn", `${row.node} · ${row.op}`, `няма ставка за цех „${ws}" в „Разходи и ставки"`);
    if (row.sourceLvl === 1) check("info", `${row.node} · ${row.op}`, "няма измерено време за този детайл — ползва се средното за операцията от други детайли");
    else if (row.sourceLvl === 2) check("warn", `${row.node} · ${row.op}`, "няма измерено време — ползва се цената от рецептата");
    else if (row.sourceLvl === 3) check("bad", `${row.node} · ${row.op}`, "няма нито време, нито цена в рецептата — операцията влиза с 0 €");
    if (row.sourceLvl === 0 && row.n < 3) check("info", `${row.node} · ${row.op}`, `само ${row.n} измерване${row.n === 1 ? "" : "ния"} — времето не е надеждно още`);
    if (row.sourceLvl <= 1 && machine && rate && typeof COST_CFG !== "undefined" && COST_CFG && !(COST_CFG.machineAlias || {})[machine] && R.machineRate[machine] == null)
      check("info", `${row.node} · ${row.op}`, `машина „${machine}" не е свързана с ред от разходите — ползва се средната машинна ставка на цеха`);
  });
  // Редът на операциите: по реда на възлите в дървото, после по позиция в рецептата.
  const nodeOrder = {}; nodes.forEach((n, i) => { nodeOrder[n.code || n.name] = i; });
  ops.sort((a, b) => (nodeOrder[a.node] - nodeOrder[b.node]) || 0);

  const matRows = Object.values(mats).map(g => {
    const lp = csLastPurchase(g.mid);
    const row = { ...g, usedIn: [...g.usedIn].join(", "), cost: g.qty * g.avg, lastPrice: lp ? lp.price : null, lastDate: lp ? lp.date : "", supplier: lp ? lp.supplier : "" };
    if (!(g.avg > 0)) check("bad", `${g.code} ${g.name}`, "материал без средна цена — влиза с 0 €");
    else if (lp && Math.abs(lp.price - g.avg) / g.avg > 0.15) check("info", `${g.code} ${g.name}`, `последна покупна цена ${erpEur(lp.price)} (${erpDMY(lp.date)}) се различава с ${Math.round(Math.abs(lp.price - g.avg) / g.avg * 100)}% от средната ${erpEur(g.avg)}`);
    return row;
  }).sort((a, b) => b.cost - a.cost);

  const T_mat = matRows.reduce((s, r) => s + r.cost, 0);
  const T_manual = nodes.reduce((s, n) => s + (n.manualCost || 0), 0);
  const T_labor = ops.reduce((s, r) => s + (r.laborCost || 0), 0);
  const T_mach = ops.reduce((s, r) => s + (r.machineCost || 0), 0);
  const T_over = ops.reduce((s, r) => s + (r.overheadCost || 0), 0);
  const T_opsRecipe = ops.filter(r => r.timeCost == null).reduce((s, r) => s + r.cost, 0);
  const T_ops = T_labor + T_mach + T_over + T_opsRecipe;
  const real = T_mat + T_manual + T_ops;
  const recipe = Number(ERP.costById[pid]) || 0;
  const manualTop = (typeof erpManualCostOf === "function") ? erpManualCostOf(pid) : null;
  const measured = ops.filter(r => r.sourceLvl === 0).length, opsN = ops.length;
  const sale = csSalePrice(clientName, pid);
  if (!sale) check("warn", "Продажна цена", `няма цена за ${clientName || "клиента"} — нито в ценова листа, нито в заявка`);
  else if (sale.source.startsWith("заявка на друг")) check("info", "Продажна цена", `ползва се цена от ${sale.source} (${sale.client}) — за ${clientName || "клиента"} няма собствена`);
  if (recipe > 0 && real > 0 && Math.abs(real - recipe) / recipe > 0.25) check("info", "Рецепта ↔ реално", `рецептната себестойност ${erpEur(recipe)} и реалната ${erpEur(real)} се разминават с ${Math.round(Math.abs(real - recipe) / recipe * 100)}%`);
  // ➕ Допълнителните разходи (боя, опаковка, транспорт, консумативи, брак, административни).
  const ex = csExtras(pid, clientName, { mat: T_mat + T_manual, ops, real, codes: nodes.map(n => n.code) });
  ex.checks.forEach(k => checks.push(k));
  const realFull = real + ex.total;
  const order = { bad: 0, warn: 1, info: 2 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return { pid, clientName, mats: matRows, ops, nodes, checks, R, extras: ex,
    totals: { mat: T_mat, manual: T_manual, labor: T_labor, mach: T_mach, over: T_over, opsRecipe: T_opsRecipe, ops: T_ops, realBase: real, extras: ex.total, real: realFull, recipe, manualTop, measured, opsN },
    sale };
}

/* ---------- Клиенти и продукти за избор ---------- */
function csClients() {
  const set = new Set();
  ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(o => { if (o.clientName) set.add(String(o.clientName).trim()); });
  if (typeof PL_CACHE !== "undefined" && PL_CACHE) Object.values(PL_CACHE).forEach(d => { if (d && d.clientName) set.add(String(d.clientName).trim()); });
  (ERP.products || []).forEach(p => { if (p.owner_client) set.add(String(p.owner_client).trim()); });
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "bg"));
}
// Продуктите на клиента: от ценовата листа, заявките и „клиент-собственик".
function csClientProducts(clientName) {
  const cn = csNorm(clientName);
  const ids = new Set();
  if (cn) {
    if (typeof PL_CACHE !== "undefined" && PL_CACHE) Object.values(PL_CACHE).forEach(d => {
      if (csNorm(d && d.clientName) !== cn) return;
      Object.keys(d.entries || {}).forEach(k => ids.add(Number(k)));
    });
    ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(o => {
      if (csNorm(o.clientName) !== cn) return;
      (o.lines || []).forEach(l => { if (l.productId) ids.add(Number(l.productId)); });
    });
    (ERP.products || []).forEach(p => { if (csNorm(p.owner_client) === cn) ids.add(Number(p.id)); });
  }
  return [...ids].map(id => ERP.prodById[id]).filter(Boolean).sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "bg", { numeric: true }));
}

/* ---------- Екран ---------- */
async function erpRenderCostSheet() {
  const v = erpView();
  if (typeof financeAllowed === "function" && !financeAllowed()) {
    v.innerHTML = `<div class="erp-error"><h3>Няма достъп</h3><p>„Себестойности" е част от финансовия достъп.</p></div>`;
    return;
  }
  v.innerHTML = `<p class="erp-loading">Събирам рецепти, времена, ставки и цени…</p>`;
  try { await csEnsureData(); } catch (e) { v.innerHTML = `<div class="erp-error"><h3>Грешка при зареждане</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }

  const clients = csClients();
  if (!CS.client) CS.client = clients.find(c => csNorm(c).includes(CS_DEFAULT_CLIENT)) || "";
  if (!CS.pid) {
    const p = (ERP.products || []).find(x => String(x.code || "").trim() === CS_DEFAULT_CODE);
    if (p) CS.pid = p.id;
  }
  const prodOpts = (ERP.products || []).slice().sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "bg", { numeric: true }));
  const cur = CS.pid ? ERP.prodById[CS.pid] : null;

  v.innerHTML = `
    <div class="erp-toolbar">
      <label class="erp-inline">Клиент
        <select id="cs-client" style="min-width:220px"><option value="">— всички / без клиент —</option>${clients.map(c => `<option value="${escapeAttr(c)}" ${c === CS.client ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select></label>
      <label class="erp-inline">Изделие
        <input type="text" id="cs-prod" list="cs-prod-list" placeholder="код или име…" value="${cur ? escapeAttr((cur.code ? cur.code + " · " : "") + (cur.name || "")) : ""}" style="min-width:320px" autocomplete="off" />
        <datalist id="cs-prod-list">${prodOpts.map(p => `<option value="${escapeAttr((p.code ? p.code + " · " : "") + (p.name || ""))}"></option>`).join("")}</datalist></label>
      <button class="btn btn-small ${CS.view === "list" ? "btn-primary" : ""}" id="cs-view-list" title="Всички изделия на избрания клиент — рецептна и реална себестойност, цена, маржин">📋 Изделията на клиента</button>
      <button class="btn btn-small ${CS.view === "sheet" ? "btn-primary" : ""}" id="cs-view-sheet" title="Пълна калкулация на избраното изделие">🧾 Калкулация</button>
      <span class="spacer"></span>
      <button class="btn btn-small" id="cs-refresh" title="Презарежда времената и цените">🔄 Опресни</button>
      <button class="btn btn-small" id="cs-xls">⤓ Excel</button>
      <button class="btn btn-small" id="cs-print">🖨 Печат</button>
    </div>
    <div id="cs-body"></div>`;

  const body = v.querySelector("#cs-body");
  const pickProduct = txt => {
    const q = csNorm(txt); if (!q) return null;
    const code = q.split(" · ")[0].trim();
    return (ERP.products || []).find(p => csNorm(p.code) === code) || (ERP.products || []).find(p => csNorm(p.code) === q || csNorm(p.name) === q)
      || (ERP.products || []).find(p => csNorm((p.code || "") + " " + (p.name || "")).includes(q)) || null;
  };
  v.querySelector("#cs-client").addEventListener("change", e => { CS.client = e.target.value; CS.view = "list"; erpRenderCostSheet(); });
  v.querySelector("#cs-prod").addEventListener("change", e => { const p = pickProduct(e.target.value); if (p) { CS.pid = p.id; CS.view = "sheet"; erpRenderCostSheet(); } });
  v.querySelector("#cs-view-list").addEventListener("click", () => { CS.view = "list"; erpRenderCostSheet(); });
  v.querySelector("#cs-view-sheet").addEventListener("click", () => { CS.view = "sheet"; erpRenderCostSheet(); });
  v.querySelector("#cs-refresh").addEventListener("click", async () => {
    try { if (typeof loadProdLog === "function") await loadProdLog(); if (typeof tLoadTasks === "function") await tLoadTasks(); if (typeof erpLoadAll === "function") await erpLoadAll(); if (typeof PL_CACHE !== "undefined") PL_CACHE = null; } catch (e) {}
    erpRenderCostSheet();
  });

  if (CS.view === "sheet" && CS.pid) {
    const calc = csBuild(CS.pid, CS.client);
    body.innerHTML = csSheetHtml(calc);
    v.querySelector("#cs-xls").addEventListener("click", () => csExport(calc, "xls"));
    v.querySelector("#cs-print").addEventListener("click", () => csExport(calc, "print"));
    body.querySelectorAll("[data-cs-open]").forEach(b => b.addEventListener("click", () => { CS.pid = Number(b.dataset.csOpen); erpRenderCostSheet(); }));
    const xs = body.querySelector("#cs-x-save");
    if (xs) xs.addEventListener("click", async () => { xs.disabled = true; if (await csSaveExtrasFromForm(body, CS.pid)) erpRenderCostSheet(); else xs.disabled = false; });
  } else {
    const list = csClientProducts(CS.client);
    const calcs = list.map(p => ({ p, c: csBuild(p.id, CS.client) }));
    body.innerHTML = csListHtml(calcs);
    body.querySelectorAll("[data-cs-open]").forEach(b => b.addEventListener("click", () => { CS.pid = Number(b.dataset.csOpen); CS.view = "sheet"; erpRenderCostSheet(); }));
    v.querySelector("#cs-xls").addEventListener("click", () => csExportList(calcs));
    v.querySelector("#cs-print").addEventListener("click", () => csExportList(calcs, true));
  }
}

function csPct(cost, price) { return (price > 0) ? (price - cost) / price * 100 : null; }
function csPctCls(pct) { if (pct == null) return "fin-na"; if (pct < 0) return "fin-neg"; if (pct < 10) return "fin-low"; if (pct < 25) return "fin-mid"; return "fin-good"; }
function csSec(sec) { if (sec == null) return "—"; return sec >= 60 ? (Math.floor(sec / 60) + " мин " + Math.round(sec % 60) + " с") : (Math.round(sec * 10) / 10 + " с"); }
function csLvlIcon(l) { return l === "bad" ? "🔴" : (l === "warn" ? "🟠" : "🔵"); }

function csListHtml(calcs) {
  if (!calcs.length) return `<p class="report-empty">${CS.client ? `Няма изделия, свързани с „${escapeHtml(CS.client)}" (ценова листа, заявки или клиент-собственик).` : "Избери клиент или изделие."}</p>`;
  const T = calcs.reduce((a, x) => { a.real += x.c.totals.real; a.recipe += x.c.totals.recipe; a.bad += x.c.checks.filter(k => k.level === "bad").length; a.warn += x.c.checks.filter(k => k.level === "warn").length; return a; }, { real: 0, recipe: 0, bad: 0, warn: 0 });
  return `
    <p class="hint">Всяко изделие на <b>${escapeHtml(CS.client || "—")}</b> с <b>рецептна</b> себестойност (материали по средни цени + операции по ставки от рецептата) и <b>реална</b> (времената от цеховете × ставки „труд+машина+режийни" по реалната машина). Кликни ред за пълната калкулация и проверките.</p>
    <div class="fin-cards">
      <div class="fin-card"><div class="fin-card-l">Изделия</div><div class="fin-card-v">${calcs.length}</div></div>
      <div class="fin-card"><div class="fin-card-l">🔴 критични пропуски</div><div class="fin-card-v ${T.bad ? "fin-neg" : ""}">${T.bad}</div></div>
      <div class="fin-card"><div class="fin-card-l">🟠 предупреждения</div><div class="fin-card-v">${T.warn}</div></div>
    </div>
    <table class="report-table erp-table fin-table">
      <thead><tr><th>Код</th><th>Изделие</th><th class="num">Материали</th><th class="num">Операции</th><th class="num">Допълн.</th><th class="num">Реална себест.</th><th class="num">Рецептна</th><th class="num">Продажна цена</th><th class="num">Маржин %</th><th class="num">Времена</th><th>Проверки</th><th></th></tr></thead>
      <tbody>${calcs.map(({ p, c }) => {
        const t = c.totals; const price = c.sale ? c.sale.price : 0; const pct = csPct(t.real, price);
        const bad = c.checks.filter(k => k.level === "bad").length, warn = c.checks.filter(k => k.level === "warn").length;
        return `<tr class="erp-clickable" data-cs-open="${p.id}">
          <td data-label="Код"><b>${escapeHtml(p.code || "")}</b></td>
          <td data-label="Изделие">${escapeHtml(p.name || "")}</td>
          <td class="num" data-label="Материали">${erpEur(t.mat + t.manual)}</td>
          <td class="num" data-label="Операции">${erpEur(t.ops)}</td>
          <td class="num" data-label="Допълнителни">${erpEur(t.extras)}</td>
          <td class="num" data-label="Реална"><b>${erpEur(t.real)}</b></td>
          <td class="num" data-label="Рецептна">${erpEur(t.recipe)}</td>
          <td class="num" data-label="Цена">${price > 0 ? erpEur(price) + (c.sale.currency && c.sale.currency !== "EUR" ? " " + escapeHtml(c.sale.currency) : "") : "—"}${c.sale ? `<div class="erp-muted" style="font-size:11px">${escapeHtml(c.sale.source)}</div>` : ""}</td>
          <td class="num ${csPctCls(pct)}" data-label="Маржин %">${pct == null ? "—" : erpNum(Math.round(pct * 10) / 10) + " %"}</td>
          <td class="num" data-label="Времена" title="Операции с измерено време за самия детайл / всички операции">${t.measured}/${t.opsN}</td>
          <td data-label="Проверки">${bad ? `<span class="fin-neg">🔴 ${bad}</span> ` : ""}${warn ? `<span>🟠 ${warn}</span>` : ""}${!bad && !warn ? `<span class="fin-good">✓</span>` : ""}</td>
          <td class="erp-row-actions"><button class="btn btn-small" data-cs-open="${p.id}">🧾</button></td>
        </tr>`; }).join("")}
      </tbody>
    </table>`;
}

function csSheetHtml(c) {
  const p = ERP.prodById[c.pid] || {}; const t = c.totals;
  const price = c.sale ? c.sale.price : 0; const pct = csPct(t.real, price); const pctR = csPct(t.recipe, price);
  const src = r => r.sourceLvl === 0 ? `<span class="fin-good" title="Средно от ${r.n} измервания (${erpNum(r.pieces)} бр.), последно ${erpDMY(r.last) || "—"}">⏱ ${r.n}×</span>`
    : r.sourceLvl === 1 ? `<span title="Няма време за този детайл — средно за операцията от други детайли (${r.n} измервания)">≈ оп.</span>`
    : r.sourceLvl === 2 ? `<span class="erp-muted" title="Няма измерено време — цената от рецептата">рецепта</span>` : `<span class="fin-neg">няма</span>`;
  const rateTip = r => `труд ${erpEur(r.labor)}/ч + машина ${erpEur(r.mRate)}/ч${r.machine ? " (" + r.machine + ")" : " (средно за цеха)"} + режийни ${erpEur(r.overhead)}/ч`;
  return `
    <div class="cs-head">
      <h3 style="margin:0">🧾 ${escapeHtml(p.code || "")} · ${escapeHtml(p.name || "")}</h3>
      <div class="erp-muted">Клиент: <b>${escapeHtml(c.clientName || "—")}</b> · база: 1 бр. · рецепта: ${c.nodes.length} възела, ${c.ops.length} операции, ${c.mats.length} материала${t.manualTop != null ? ` · ⚠ има ръчна себестойност ${erpEur(t.manualTop)}` : ""}</div>
    </div>
    <div class="fin-cards">
      <div class="fin-card"><div class="fin-card-l">Материали${t.manual ? " (+ покупни части)" : ""}</div><div class="fin-card-v">${erpEur(t.mat + t.manual)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Труд</div><div class="fin-card-v">${erpEur(t.labor)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Машини</div><div class="fin-card-v">${erpEur(t.mach)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Режийни</div><div class="fin-card-v">${erpEur(t.over)}</div></div>
      ${t.opsRecipe ? `<div class="fin-card"><div class="fin-card-l">Операции без време (по рецепта)</div><div class="fin-card-v">${erpEur(t.opsRecipe)}</div></div>` : ""}
      <div class="fin-card"><div class="fin-card-l">➕ Допълнителни (боя, опаковка, транспорт…)</div><div class="fin-card-v">${erpEur(t.extras)}</div></div>
      <div class="fin-card" style="border-color:#0f766e"><div class="fin-card-l">РЕАЛНА себестойност</div><div class="fin-card-v">${erpEur(t.real)}</div><div class="erp-muted" style="font-size:11px">производство ${erpEur(t.realBase)} · рецептна: ${erpEur(t.recipe)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Продажна цена${c.sale ? ` <span class="erp-muted">(${escapeHtml(c.sale.source)})</span>` : ""}</div><div class="fin-card-v">${price > 0 ? erpEur(price) : "—"}</div></div>
      <div class="fin-card"><div class="fin-card-l">Маржин (реален / по рецепта)</div><div class="fin-card-v ${csPctCls(pct)}">${pct == null ? "—" : erpNum(Math.round(pct * 10) / 10) + " %"} <span class="erp-muted" style="font-size:12px">/ ${pctR == null ? "—" : erpNum(Math.round(pctR * 10) / 10) + " %"}</span></div>${price > 0 ? `<div class="erp-muted" style="font-size:11px">${erpEur(price - t.real)} на брой</div>` : ""}</div>
      <div class="fin-card"><div class="fin-card-l">Покритие с времена</div><div class="fin-card-v">${t.measured}/${t.opsN}</div></div>
    </div>

    <h4 class="erp-group-head">🔍 Проверки (${c.checks.length})</h4>
    ${(function () {
      const li = k => `<li>${csLvlIcon(k.level)} <b>${escapeHtml(k.what)}</b> — ${escapeHtml(k.why)}</li>`;
      const hard = c.checks.filter(k => k.level !== "info"), soft = c.checks.filter(k => k.level === "info");
      if (!c.checks.length) return `<p class="fin-good">✓ Всичко е налице: материалите имат цени, всички операции имат измерено време и ставка, има продажна цена.</p>`;
      return (hard.length ? `<ul class="cs-checks">${hard.map(li).join("")}</ul>` : `<p class="fin-good" style="margin:0 0 6px">✓ Няма критични пропуски.</p>`)
        + (soft.length ? `<details class="cs-more"><summary>🔵 Още ${soft.length} бележки (по-точни времена, връзки на машини, сверки на цени)</summary><ul class="cs-checks">${soft.map(li).join("")}</ul></details>` : "");
    })()}

    <h4 class="erp-group-head">⚙️ Операции (за 1 бр. изделие)</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Детайл</th><th class="num">бр./изд.</th><th>Операция</th><th>Цех</th><th>Машина</th><th class="num">Време/бр.</th><th class="num">Настройка/бр.</th><th class="num">Ставка €/ч</th><th>Източник</th><th class="num">€ / изд.</th></tr></thead>
      <tbody>${c.ops.map(r => `<tr>
        <td title="${escapeAttr(r.nodeName)}">${escapeHtml(r.node)}</td>
        <td class="num">${erpNum(r.mult)}</td>
        <td>${escapeHtml(r.op)}${r.perUnit > 1 ? ` <span class="erp-muted">×${r.perUnit}</span>` : ""}</td>
        <td>${escapeHtml(r.ws || "—")}</td>
        <td>${escapeHtml(r.machine || "—")}</td>
        <td class="num">${csSec(r.sec)}</td>
        <td class="num">${r.setupSec ? csSec(r.setupSec) : "—"}</td>
        <td class="num" title="${escapeAttr(rateTip(r))}">${r.full > 0 ? erpEur(r.full) : "—"}</td>
        <td>${src(r)}</td>
        <td class="num"><b>${erpEur(r.cost)}</b>${r.timeCost == null && r.recipeCost ? "" : (r.recipeCost && Math.abs(r.recipeCost - r.cost) > 0.005 ? `<div class="erp-muted" style="font-size:11px">рецепта ${erpEur(r.recipeCost)}</div>` : "")}</td>
      </tr>`).join("") || `<tr><td colspan="10" class="report-empty">Рецептата няма операции.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="9" style="text-align:right"><b>Общо операции</b></td><td class="num"><b>${erpEur(t.ops)}</b></td></tr></tfoot>
    </table>

    <h4 class="erp-group-head">🧱 Материали (за 1 бр. изделие)</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Материал</th><th class="num">Кол-во</th><th>Мярка</th><th class="num">Средна цена</th><th class="num">Последна покупка</th><th>Влага се в</th><th class="num">€ / изд.</th></tr></thead>
      <tbody>${c.mats.map(m => `<tr>
        <td>${escapeHtml(m.code)}</td><td>${escapeHtml(m.name)}</td>
        <td class="num">${erpNum(m.qty)}</td><td>${escapeHtml(m.unit)}</td>
        <td class="num ${m.avg > 0 ? "" : "fin-neg"}">${m.avg > 0 ? erpEur(m.avg) : "няма"}</td>
        <td class="num">${m.lastPrice != null ? `${erpEur(m.lastPrice)}<div class="erp-muted" style="font-size:11px">${erpDMY(m.lastDate)}${m.supplier ? " · " + escapeHtml(m.supplier) : ""}</div>` : "—"}</td>
        <td class="erp-muted" style="font-size:12px">${escapeHtml(m.usedIn)}</td>
        <td class="num"><b>${erpEur(m.cost)}</b></td>
      </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Рецептата няма материали.</td></tr>`}
      ${c.nodes.filter(n => n.manualCost).map(n => `<tr><td>${escapeHtml(n.code)}</td><td>${escapeHtml(n.name)} <span class="erp-muted">(покупна част / ръчна цена)</span></td><td class="num">${erpNum(n.mult)}</td><td>бр.</td><td class="num">${erpEur(n.manual)}</td><td></td><td class="erp-muted" style="font-size:12px">${escapeHtml(n.parent)}</td><td class="num"><b>${erpEur(n.manualCost)}</b></td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="7" style="text-align:right"><b>Общо материали</b></td><td class="num"><b>${erpEur(t.mat + t.manual)}</b></td></tr></tfoot>
    </table>

    <h4 class="erp-group-head">➕ Допълнителни разходи (за 1 бр. изделие)</h4>
    ${csExtrasHtml(c)}

    <h4 class="erp-group-head">🌳 Рецептно дърво</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Възел</th><th class="num">бр. за 1 изд.</th><th class="num">операции</th><th class="num">материали</th><th class="num">под-възли</th><th></th></tr></thead>
      <tbody>${c.nodes.map(n => `<tr>
        <td style="padding-left:${8 + n.depth * 18}px">${n.depth ? "↳ " : ""}<b>${escapeHtml(n.code)}</b> ${escapeHtml(n.name)}</td>
        <td class="num">${erpNum(n.mult)}</td><td class="num">${n.ops || ""}</td><td class="num">${n.mats || ""}</td><td class="num">${n.children || ""}</td>
        <td class="erp-row-actions">${n.depth ? `<button class="btn btn-small" data-cs-open="${n.pid}" title="Калкулация само на този възел">🧾</button>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="hint">Как се смята: <b>материали</b> = количество по рецептата × средна складова цена (тя се обновява автоматично при заприходяване на всяка фактура в „Покупки"). <b>Операции</b> = средното измерено време за 1 бр. на <i>този</i> детайл (от отчетите на цеховете, претеглено по бройки) + настройката, амортизирана по партидите, × ставка на цеха (труд + машина по реалната машина + режийни от „Разходи и ставки"). Където детайлът още няма измерено време, се взима средното за операцията от други детайли, а ако и такова няма — цената от рецептата. Времето за 1 бр. вече включва всички повторения на операцията (напр. ×4 огъвки), затова множителят важи само за рецептната цена.</p>`;
}

/* ---------- Експорт ---------- */
function csSections(c) {
  const p = ERP.prodById[c.pid] || {}; const t = c.totals; const price = c.sale ? c.sale.price : 0; const pct = csPct(t.real, price);
  return [
    { title: "Обобщение", headers: [{ label: "Показател" }, { label: "Стойност", num: true }], rows: [
      ["Изделие", `${p.code || ""} ${p.name || ""}`], ["Клиент", c.clientName || "—"],
      ["Материали (+ покупни части)", erpEur(t.mat + t.manual)], ["Труд", erpEur(t.labor)], ["Машини", erpEur(t.mach)], ["Режийни", erpEur(t.over)],
      ["Операции без време (по рецепта)", erpEur(t.opsRecipe)], ["Производствена себестойност", erpEur(t.realBase)],
      ["Допълнителни (боя, опаковка, транспорт, консумативи, брак, адм.)", erpEur(t.extras)], ["РЕАЛНА себестойност", erpEur(t.real)], ["Рецептна себестойност", erpEur(t.recipe)],
      ["Продажна цена", price > 0 ? erpEur(price) + " (" + (c.sale.source || "") + ")" : "—"], ["Маржин %", pct == null ? "—" : erpNum(Math.round(pct * 10) / 10) + " %"],
      ["Покритие с времена", `${t.measured}/${t.opsN}`],
    ] },
    { title: "Допълнителни разходи", headers: [{ label: "Разход" }, { label: "Как е сметнат" }, { label: "Източник" }, { label: "€/изд.", num: true }], rows: c.extras.rows.map(r => [r.label, r.how, r.source, erpNum(Math.round(r.cost * 100) / 100)]) },
    { title: "Проверки", headers: [{ label: "Ниво" }, { label: "Какво" }, { label: "Защо" }], rows: c.checks.map(k => [k.level === "bad" ? "критично" : (k.level === "warn" ? "внимание" : "инфо"), k.what, k.why]) },
    { title: "Операции", headers: [{ label: "Детайл" }, { label: "бр./изд.", num: true }, { label: "Операция" }, { label: "Цех" }, { label: "Машина" }, { label: "Време/бр. (с)", num: true }, { label: "Настройка/бр. (с)", num: true }, { label: "Ставка €/ч", num: true }, { label: "Измервания", num: true }, { label: "Източник" }, { label: "€/изд.", num: true }],
      rows: c.ops.map(r => [r.node, erpNum(r.mult), r.op + (r.perUnit > 1 ? " ×" + r.perUnit : ""), r.ws, r.machine, r.sec == null ? "" : erpNum(Math.round(r.sec)), r.setupSec ? erpNum(Math.round(r.setupSec)) : "", r.full > 0 ? erpNum(Math.round(r.full * 100) / 100) : "", r.n || "", r.source, erpNum(Math.round(r.cost * 100) / 100)]) },
    { title: "Материали", headers: [{ label: "Код" }, { label: "Материал" }, { label: "Кол-во", num: true }, { label: "Мярка" }, { label: "Средна цена", num: true }, { label: "Последна покупка", num: true }, { label: "Дата" }, { label: "Влага се в" }, { label: "€/изд.", num: true }],
      rows: c.mats.map(m => [m.code, m.name, erpNum(m.qty), m.unit, erpNum(Math.round(m.avg * 10000) / 10000), m.lastPrice != null ? erpNum(Math.round(m.lastPrice * 10000) / 10000) : "", m.lastDate ? erpDMY(m.lastDate) : "", m.usedIn, erpNum(Math.round(m.cost * 100) / 100)])
        .concat(c.nodes.filter(n => n.manualCost).map(n => [n.code, n.name + " (покупна част)", erpNum(n.mult), "бр.", erpNum(n.manual), "", "", n.parent, erpNum(Math.round(n.manualCost * 100) / 100)])) },
  ];
}
function csExport(c, mode) {
  const p = ERP.prodById[c.pid] || {};
  const title = `Себестойност · ${p.code || ""} ${p.name || ""}${c.clientName ? " · " + c.clientName : ""}`;
  if (mode === "print") { if (typeof reportOpenView === "function") reportOpenView(title, csSections(c)); return; }
  if (typeof reportExportXls === "function") reportExportXls(`sebestoynost-${(p.code || "izdelie")}`, title, csSections(c));
}
function csExportList(calcs, print) {
  const headers = [{ label: "Код" }, { label: "Изделие" }, { label: "Материали", num: true }, { label: "Операции", num: true }, { label: "Реална себест.", num: true }, { label: "Рецептна", num: true }, { label: "Продажна цена", num: true }, { label: "Източник на цената" }, { label: "Маржин %", num: true }, { label: "Времена" }, { label: "Критични", num: true }, { label: "Предупреждения", num: true }];
  const rows = calcs.map(({ p, c }) => { const t = c.totals; const price = c.sale ? c.sale.price : 0; const pct = csPct(t.real, price);
    return [p.code || "", p.name || "", erpNum(Math.round((t.mat + t.manual) * 100) / 100), erpNum(Math.round(t.ops * 100) / 100), erpNum(Math.round(t.real * 100) / 100), erpNum(Math.round(t.recipe * 100) / 100), price > 0 ? erpNum(price) : "", c.sale ? c.sale.source : "", pct == null ? "" : erpNum(Math.round(pct * 10) / 10), `${t.measured}/${t.opsN}`, c.checks.filter(k => k.level === "bad").length, c.checks.filter(k => k.level === "warn").length]; });
  const title = `Себестойности · ${CS.client || "всички"}`;
  const sections = [{ title, headers, rows }];
  if (print) { if (typeof reportOpenView === "function") reportOpenView(title, sections); return; }
  if (typeof reportExportXls === "function") reportExportXls(`sebestoynosti-${(CS.client || "vsichki").replace(/[^a-zA-Zа-яА-Я0-9]+/g, "_")}`, title, sections);
}

/* ---------- ➕ Допълнителни разходи: изглед и запис ---------- */
function csExtrasHtml(c) {
  const ex = c.extras, o = ex.override || {}, P = ex.params;
  const val = v => (v === "" || v == null) ? "" : escapeAttr(String(v));
  const inp = (key, ph, w) => `<input type="number" step="any" min="0" class="cs-x" data-cs-x="${key}" value="${val(o[key])}" placeholder="${escapeAttr(ph)}" style="width:${w || 90}px" />`;
  let packInfo = `Няма спецификация в таб „Опаковки" за този клиент и код — попълни я там и опаковката и транспортът ще се сметнат сами.`;
  if (ex.spec) {
    packInfo = `Опаковка от таб „Опаковки": <b>` + erpNum(ex.spec.piecesPerBox || 0) + " бр./кашон</b>";
    if (ex.spec.boxesPerPallet) packInfo += " · <b>" + erpNum(ex.spec.boxesPerPallet) + " кашона/палет</b> · " + erpNum(ex.palletPieces) + " бр./палет";
  }
  return `
    <table class="report-table erp-table">
      <thead><tr><th>Разход</th><th>Как е сметнат</th><th>Източник</th><th class="num">€ / изд.</th></tr></thead>
      <tbody>${ex.rows.map(r => `<tr><td><b>${escapeHtml(r.label)}</b></td><td>${escapeHtml(r.how)}</td><td class="erp-muted" style="font-size:12px">${escapeHtml(r.source)}</td><td class="num"><b>${erpEur(r.cost)}</b></td></tr>`).join("") || `<tr><td colspan="4" class="report-empty">Няма допълнителни разходи.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right"><b>Общо допълнителни</b></td><td class="num"><b>${erpEur(ex.total)}</b></td></tr></tfoot>
    </table>
    <div class="cs-extras-edit">
      <div class="cs-extras-col">
        <h5>За това изделие</h5>
        <label>Боядисана площ, м²/изделие ${inp("paintM2", ex.hasPaint ? "напр. 0,85" : "няма боя в рецептата")}</label>
        <label>Боя €/м² само за това изделие ${inp("paintEurM2", "общо: " + erpNum(P.paintEurM2))}</label>
        <label>Опаковка €/бр. (ръчно, вместо от „Опаковки") ${inp("packEur", ex.spec ? "авто от Опаковки" : "напр. 0,40")}</label>
        <label>Транспорт €/бр. (ръчно) ${inp("transportEur", ex.palletPieces ? "авто: €/палет ÷ " + ex.palletPieces : "напр. 0,60")}</label>
        <label>Брак % само за това изделие ${inp("scrapPct", "общо: " + erpNum(P.scrapPct))}</label>
        <p class="hint" style="margin:4px 0 0">${packInfo}</p>
      </div>
      <div class="cs-extras-col">
        <h5>Общи параметри (за всички изделия)</h5>
        ${CS_PARAM_LABELS.map(([k, l, hint]) => `<label>${escapeHtml(l)} <input type="number" step="any" min="0" class="cs-p" data-cs-p="${k}" value="${escapeAttr(String(P[k] != null ? P[k] : ""))}" style="width:90px" />${hint ? `<span class="erp-muted" style="font-size:11px"> ${escapeHtml(hint)}</span>` : ""}</label>`).join("")}
      </div>
    </div>
    <div class="erp-co-linebar"><button class="btn btn-small btn-primary" id="cs-x-save">💾 Запази допълнителните разходи</button><span class="erp-muted" style="font-size:12px">Празно поле за изделието = ползва се общият параметър / автоматичната сметка.</span></div>`;
}
async function csSaveExtrasFromForm(root, pid) {
  await csLoadExtras();
  const o = {};
  root.querySelectorAll(".cs-x").forEach(i => { const v = String(i.value).trim(); if (v !== "") o[i.dataset.csX] = Number(v.replace(",", ".")) || 0; });
  root.querySelectorAll(".cs-p").forEach(i => { const v = String(i.value).trim(); if (v !== "") CS_EXTRAS.params[i.dataset.csP] = Number(v.replace(",", ".")) || 0; });
  if (Object.keys(o).length) CS_EXTRAS.byProduct[String(pid)] = o; else delete CS_EXTRAS.byProduct[String(pid)];
  return csSaveExtras();
}
