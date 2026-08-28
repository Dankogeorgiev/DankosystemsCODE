/* Данко Системс — „⚡ Мастер отчитане" (само за офиса/админ).
   Бърз backfill на производството, когато цеховете не са отчитали. Групира по
   заявка → АРТИКУЛ (както е в заявката на клиента) → детайли. С един бутон
   „▶▶ готов" целият артикул се докарва до готово (всички детайли + сглобяване);
   при нужда артикулът се разгъва и се работи по отделните детайли/операции.
   Ползва logProduction(..., {silent:true}) — стоковите движения, дневникът и
   гейтовете остават коректни.
   Ползва TASKS, erpSeriesProduced, erpFlowAvailable, logProduction, escapeHtml. */

let masterQuery = "";
let MASTER_LINES = {};    // orderId -> [{ pid, qty }] — артикулите от заявката
let masterOpen = {};      // "oid¦pid" -> true — кои артикули са разгънати

function masterWorker() {
  return (typeof MY_ACCESS !== "undefined" && MY_ACCESS && (MY_ACCESS.name || MY_ACCESS.email)) || "Мастер";
}
function mStep(t) { return Number(t && t.source && t.source.step) || 0; }
function mDone(t) { const q = Number(t.qty) || 0, p = Number(t.produced) || 0; return q > 0 && p >= q; }

// Групиране: заявка → детайл → операции (сортирани по стъпка).
function masterGroups() {
  const flow = (typeof TASKS !== "undefined" ? TASKS : []).filter(t => t.source && t.source.flow && t.source.kind === "series");
  const orders = {};
  flow.forEach(t => {
    const os = (t.source.orders && t.source.orders.length) ? t.source.orders : [{ id: t.source.seriesKey, no: "", client: t.client || "" }];
    os.forEach(o => {
      const oid = String(o.id);
      const e = orders[oid] || (orders[oid] = { id: oid, no: o.no || "", client: o.client || "", details: {} });
      if (!e.no && o.no) e.no = o.no; if (!e.client && o.client) e.client = o.client;
      const dk = (t.code || t.product || "?");
      const d = e.details[dk] || (e.details[dk] = { code: t.code || "", name: t.product || "", key: dk, ops: [] });
      if (!d.ops.includes(t)) d.ops.push(t);
    });
  });
  let list = Object.values(orders).map(e => {
    const details = Object.values(e.details).map(d => { d.ops.sort((a, b) => mStep(a) - mStep(b)); return d; });
    const total = details.reduce((s, d) => s + d.ops.length, 0);
    const done = details.reduce((s, d) => s + d.ops.filter(mDone).length, 0);
    return Object.assign(e, { details, total, done, active: done < total });
  }).filter(e => e.active);
  const q = (masterQuery || "").toLowerCase().trim();
  if (q) list = list.filter(e => (`${e.no} ${e.client}`).toLowerCase().includes(q));
  list.sort((a, b) => String(a.no).localeCompare(String(b.no), "bg", { numeric: true }) || String(a.client).localeCompare(String(b.client), "bg"));
  return list;
}

/* ---------- Артикулите от заявката ----------
   Задачите в производството не помнят от кой артикул идват (сериите са общи),
   затова четем редовете на заявката (customer_orders.data.lines / samples) и
   съпоставяме всеки детайл по рецептното дърво на артикула. */

// Зарежда артикулите на всички заявки в производство (веднъж при отваряне).
async function masterLoadLines() {
  MASTER_LINES = {};
  const ids = new Set();
  (typeof TASKS !== "undefined" ? TASKS : []).forEach(t => {
    const os = (t.source && t.source.flow && t.source.orders) || [];
    os.forEach(o => { if (o && o.id != null) ids.add(String(o.id)); });
  });
  if (!ids.size) return;
  const want = id => ids.has(String(id));
  // Заявки от клиенти: data.lines = [{ productId, qty, ... }]
  try {
    const { data, error } = (typeof erpSelectAll === "function")
      ? await erpSelectAll("customer_orders", "id,data")
      : await sb.from("customer_orders").select("id,data");
    if (!error) (data || []).forEach(r => {
      if (!want(r.id)) return;
      const arr = ((r.data && r.data.lines) || []).filter(l => l && l.productId)
        .map(l => ({ pid: Number(l.productId), qty: Number(l.qty) || 0 }));
      if (arr.length) MASTER_LINES[String(r.id)] = arr;
    });
  } catch (e) { /* без артикули — падаме на изгледа по детайли */ }
  // Мостри/вътрешни: един продукт (erpProductId + erpQty).
  try {
    const { data, error } = (typeof erpSelectAll === "function")
      ? await erpSelectAll("samples", "id,data")
      : await sb.from("samples").select("id,data");
    if (!error) (data || []).forEach(r => {
      if (!want(r.id) || MASTER_LINES[String(r.id)]) return;
      const d = r.data || {};
      if (d.erpProductId) MASTER_LINES[String(r.id)] = [{ pid: Number(d.erpProductId), qty: Number(d.erpQty) || 0 }];
    });
  } catch (e) {}
}

// Всички ключове (код||име) в рецептното дърво на артикула — със същото правило,
// по което erpFlowSteps именува сериите, за да се съпоставят детайлите точно.
function masterTreeKeySet(pid) {
  const out = new Set();
  if (typeof ERP === "undefined" || !ERP.linesByProduct) return out;
  (function walk(id, anc) {
    const p = (ERP.prodById || {})[id] || {};
    out.add(String(p.code || p.name || id));
    ((ERP.linesByProduct || {})[id] || []).forEach(l => {
      if (l.child_product_id && !anc.has(l.child_product_id)) walk(l.child_product_id, new Set([...anc, l.child_product_id]));
    });
  })(pid, new Set([pid]));
  return out;
}

// Разпределя детайлите на една заявка по артикулите ѝ. Несъпоставените
// (споделени серии от други заявки, липсваща рецепта) отиват в „Други детайли".
function masterArticles(e) {
  const lines = MASTER_LINES[String(e.id)] || [];
  const arts = lines.map(ln => {
    const p = (typeof ERP !== "undefined" && ERP.prodById && ERP.prodById[ln.pid]) || {};
    return { pid: ln.pid, qty: ln.qty, code: p.code || "", name: p.name || ("#" + ln.pid), keys: masterTreeKeySet(ln.pid), details: [] };
  });
  const misc = [];
  e.details.forEach(d => {
    let hit = false;
    arts.forEach(a => { if (a.keys.has(String(d.key))) { a.details.push(d); hit = true; } });
    if (!hit) misc.push(d);
  });
  arts.forEach(a => {
    a.total = a.details.reduce((s, d) => s + d.ops.length, 0);
    a.done = a.details.reduce((s, d) => s + d.ops.filter(mDone).length, 0);
  });
  return { arts, misc };
}

// Делът на ЗАЯВКАТА в серията на задачата. Мастерът отчита най-много толкова
// на операция: споделена серия (100 за тази заявка + 1000 за други = 1100) НЕ
// бива да се отчита цялата от бутона на едната заявка — иначе се заприходяват
// готови и се изписват материали за бройки, които цехът не е произвеждал.
// Серия без записани заявки (стар запис) няма дял — старото поведение (цялата).
function mOrderShare(t, oid) {
  const os = (t && t.source && t.source.orders) || [];
  if (!os.length) return Infinity;
  const o = os.find(x => String(x.id) === String(oid));
  return o ? (Number(o.qty) || 0) : 0;
}

// Докарва един детайл до дадена стъпка (отчита всяка операция до наличното,
// но най-много дела на заявката).
async function masterAdvanceDetail(oid, ops, targetStep) {
  const sorted = ops.slice().sort((a, b) => mStep(a) - mStep(b));
  for (const t of sorted) {
    if (mStep(t) > targetStep) break;
    const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
    const avail = (typeof erpFlowAvailable === "function") ? erpFlowAvailable(t, map) : ((Number(t.qty) || 0) - (Number(t.produced) || 0));
    const rem = Math.max(0, (Number(t.qty) || 0) - (Number(t.produced) || 0));
    const toReport = Math.min(rem, Math.max(0, avail), mOrderShare(t, oid));
    if (toReport > 0) await logProduction(t, toReport, { note: "мастер отчитане" }, { silent: true, worker: masterWorker() });
  }
}

// Докарва набор детайли до готово (цикли, докато има напредък) — ползва се и за
// цял артикул, и за цялата заявка. Общо отчетеното на задача от ТОВА действие
// се ограничава до дела на заявката в серията ѝ.
async function masterCompleteOrder(oid, details) {
  const reported = new Map();   // задача -> отчетено от това действие
  let progressed = true, guard = 0;
  while (progressed && guard++ < 60) {
    progressed = false;
    const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
    for (const d of details) for (const t of d.ops) {
      const avail = (typeof erpFlowAvailable === "function") ? erpFlowAvailable(t, map) : ((Number(t.qty) || 0) - (Number(t.produced) || 0));
      const rem = Math.max(0, (Number(t.qty) || 0) - (Number(t.produced) || 0));
      const left = mOrderShare(t, oid) - (reported.get(t) || 0);
      const toReport = Math.min(rem, Math.max(0, avail), Math.max(0, left));
      if (toReport > 0) {
        await logProduction(t, toReport, { note: "мастер отчитане" }, { silent: true, worker: masterWorker() });
        reported.set(t, (reported.get(t) || 0) + toReport);
        progressed = true;
      }
    }
  }
}

/* ---------- ⏪ Отмяна на мастер отчитания ----------
   Всяко мастер вписване носи note: "мастер отчитане" и дата в дневника на
   задачата, затова може да се намери и развърти точно. Отмяната за избран ден:
   маха вписванията, смъква produced, връща складовите последствия
   (erpFlowRollback: заприходено готово, вложени части, материал) и сваля
   статуса „готова за продажба" на заявки, които вече не са готови. Авто-боята,
   пусната от мастер отчета (worker „авто-боя", същия ден, по веригите на
   засегнатите задачи), също се отменя. Вечният дневник (production_log) НЕ се
   трие — добавя се коригиращ запис, както при „поправка на сгрешен отчет". */
function masterUndoScan() {
  const flow = (typeof TASKS !== "undefined" ? TASKS : []).filter(t => t.source && t.source.flow && t.source.kind === "series");
  const isM = l => l && l.note === "мастер отчитане";
  const dates = {};
  flow.forEach(t => (t.logs || []).forEach(l => {
    if (!isM(l)) return;
    const d = dates[l.date] || (dates[l.date] = { date: l.date, items: new Map(), master: 0, paint: 0 });
    const it = d.items.get(t) || { t, qty: 0, entries: [] };
    it.qty += Number(l.qty) || 0; it.entries.push(l);
    d.items.set(t, it);
    d.master += Number(l.qty) || 0;
  }));
  Object.values(dates).forEach(d => {
    // Веригите (по prevKey, в двете посоки) на засегнатите задачи — за авто-боята.
    const keys = new Set();
    d.items.forEach(it => { if (it.t.source.seriesKey) keys.add(it.t.source.seriesKey); });
    let grew = true;
    while (grew) {
      grew = false;
      flow.forEach(t => {
        const sk = t.source.seriesKey, pk = t.source.prevKey;
        if (!sk) return;
        if (keys.has(sk)) { if (pk && !keys.has(pk)) { keys.add(pk); grew = true; } }
        else if (pk && keys.has(pk)) { keys.add(sk); grew = true; }
      });
    }
    flow.forEach(t => {
      if (!keys.has(t.source.seriesKey)) return;
      (t.logs || []).forEach(l => {
        if (!l || isM(l) || l.worker !== "авто-боя" || l.date !== d.date) return;
        const it = d.items.get(t) || { t, qty: 0, entries: [] };
        it.qty += Number(l.qty) || 0; it.entries.push(l);
        d.items.set(t, it);
        d.paint += Number(l.qty) || 0;
      });
    });
  });
  return Object.values(dates).map(d => ({ date: d.date, items: [...d.items.values()], master: d.master, paint: d.paint }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function masterUndoApply(d) {
  const affected = [];
  for (const it of d.items) {
    const t = it.t;
    t.logs = (t.logs || []).filter(l => !it.entries.includes(l));
    t.produced = Math.max(0, (Number(t.produced) || 0) - it.qty);
    await tSaveTask(t);   // първо броячът и дневникът на задачата
    try {
      await prodLogWrite(t, {
        date: (typeof todayStr === "function") ? todayStr() : d.date,
        worker: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && (MY_ACCESS.name || MY_ACCESS.email)) || "офис",
        qty: -it.qty,
        lid: (typeof prodLogId === "function") ? prodLogId() : (Date.now().toString(36) + "-u" + Math.random().toString(36).slice(2, 5)),
        activity: "Отмяна на мастер отчитане", notes: "мастер от " + d.date,
      });
    } catch (e) { /* дневникът може да липсва — отмяната продължава */ }
    // Складът: връща излишно заприходеното/вложеното до новото produced.
    try { if (typeof erpFlowRollback === "function") await erpFlowRollback(t); } catch (e) { console.error("undo rollback", e); }
    try { await tSaveTask(t); } catch (e) {}   // персистира смъкнатите броячи (stocked/consumedUnits/matConsumed)
    affected.push(t);
  }
  // Статус „готова за продажба" → назад към „в производство", ако вече не е готова.
  const flow = (typeof TASKS !== "undefined" ? TASKS : []).filter(t => t.source && t.source.flow && t.source.kind === "series");
  const oids = new Set();
  affected.forEach(t => ((t.source.orders) || []).forEach(o => { if (o && o.id != null) oids.add(String(o.id)); }));
  for (const oid of oids) {
    try {
      const co = await sb.from("customer_orders").select("id,data").eq("id", oid).maybeSingle();
      if (!co || !co.data) continue;
      const dd = (co.data.data) || {};
      if (dd.status !== "готова за продажба") continue;
      const rows = flow.filter(t => ((t.source.orderIds) || []).map(String).includes(oid));
      const allDone = rows.length > 0 && rows.every(t => { const q = Number(t.qty) || 0; return q > 0 && (Number(t.produced) || 0) >= q; });
      if (!allDone) { dd.status = "в производство"; await sb.from("customer_orders").update({ data: dd, updated_at: new Date().toISOString() }).eq("id", oid); }
    } catch (e) { /* следващата заявка */ }
  }
  return affected.length;
}

function masterUndoDialog() {
  const dates = masterUndoScan();
  if (!dates.length) { alert("Няма мастер отчитания за отмяна."); return; }
  const wrap = document.createElement("div");
  wrap.className = "overlay";
  wrap.innerHTML = `<div class="master-box" style="max-width:520px">
    <div class="master-head"><h3>⏪ Отмяна на мастер отчитания</h3><button type="button" class="btn btn-small" id="mu-close">Затвори</button></div>
    <p class="hint">Избери ден — махат се мастер вписванията от него, бройките и складът се връщат назад (заприходено готово, вложени части, материал), а заявки „готова за продажба", които вече не са готови, стават пак „в производство".<br>⚠ Ако междувременно е <b>продавано или влагано</b> от отчетените бройки, складът може да отиде на минус — провери „Склад детайли" след отмяната.</p>
    ${dates.map((d, i) => `<button type="button" class="btn mu-date" data-i="${i}" style="display:block;width:100%;margin:4px 0;text-align:left">📅 <b>${escapeHtml(d.date)}</b> — ${d.items.length} задачи, ${d.master} бр. мастер${d.paint ? ` + ${d.paint} бр. авто-боя` : ""}</button>`).join("")}
  </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener("click", e => { if (e.target === wrap) wrap.remove(); });
  wrap.querySelector("#mu-close").addEventListener("click", () => wrap.remove());
  wrap.querySelectorAll(".mu-date").forEach(b => b.addEventListener("click", async () => {
    const d = dates[Number(b.dataset.i)]; if (!d) return;
    const lines = d.items.slice(0, 15).map(it => `• ${it.t.code || it.t.product || ""} · ${it.t.operation || ""}: −${it.qty} бр.`).join("\n");
    if (!confirm(`Да ОТМЕНЯ ли мастер отчитанията от ${d.date}?\n\n${lines}${d.items.length > 15 ? `\n… и още ${d.items.length - 15} задачи` : ""}\n\nОбщо: −${d.master + d.paint} бр. Складът се връща назад.`)) return;
    wrap.querySelectorAll("button").forEach(x => x.disabled = true);
    let n = 0;
    try { n = await masterUndoApply(d); } catch (e) { alert("Грешка: " + (e.message || e)); }
    wrap.remove();
    alert(`✓ Отменени са мастер отчитанията от ${d.date} по ${n} задачи.\nПровери „Склад детайли" и „Склад материали" за разминавания, ако междувременно е продавано/влагано.`);
    masterRender();
    if (typeof renderTasks === "function") renderTasks();
  }));
}

async function openMasterReport() {
  let wrap = document.getElementById("master-modal");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "master-modal"; wrap.className = "overlay master-modal";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) wrap.remove(); });
  }
  wrap.innerHTML = `<div class="master-box"><p class="erp-loading">Зареждам артикулите от заявките…</p></div>`;
  // ЕРП данните трябват за рецептните дървета (съпоставяне детайл → артикул).
  try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); } catch (e) {}
  try { await masterLoadLines(); } catch (e) {}
  masterRender();
}

function masterRender() {
  const wrap = document.getElementById("master-modal"); if (!wrap) return;
  const groups = masterGroups();
  const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
  const chip = (oid, d, t) => {
    const q = Number(t.qty) || 0, p = Number(t.produced) || 0;
    const avail = (typeof erpFlowAvailable === "function") ? erpFlowAvailable(t, map) : (q - p);
    const cls = mDone(t) ? "m-done" : (avail > 0 ? (p > 0 ? "m-prog" : "m-ready") : "m-wait");
    // Споделена серия: показваме и дела на ТАЗИ заявка — толкова най-много ще отчете кликът.
    const share = mOrderShare(t, oid);
    const shareTxt = (isFinite(share) && share < q) ? ` · дял ${share}` : "";
    return `<button type="button" class="m-chip ${cls}" data-oid="${escapeAttr(oid)}" data-code="${escapeAttr(d.key)}" data-step="${mStep(t)}" title="Докарай детайла до „${escapeAttr(t.operation || "")}"${shareTxt ? ` — серията е споделена, отчита се най-много делът на тази заявка (${share} бр.)` : ""}">${escapeHtml(t.operation || "")}<span class="m-qn">${p}/${q}${shareTxt}</span></button>`;
  };
  const detailHtml = (oid, d) => `<div class="m-detail">
      <div class="m-detail-h">🔩 <b>${escapeHtml(d.code)}</b> ${escapeHtml(d.name)}</div>
      <div class="m-chips">${d.ops.map(t => chip(oid, d, t)).join("")}</div>
    </div>`;
  // Артикул от заявката: ред с прогрес + „▶▶ готов"; клик върху заглавието разгъва детайлите.
  const artHtml = (oid, a) => {
    const okey = oid + "¦" + a.pid;
    const open = !!masterOpen[okey];
    const ready = a.total > 0 && a.done >= a.total;
    return `<div class="m-art${ready ? " m-art-done" : ""}">
      <div class="m-art-h" data-okey="${escapeAttr(okey)}" title="Клик — покажи/скрий детайлите">
        <span class="m-art-t">${open ? "▾" : "▸"} 🛠 <b>${escapeHtml(a.code)}</b> ${escapeHtml(a.name)}${a.qty ? ` <span class="rt-muted">× ${a.qty} бр.</span>` : ""}</span>
        <span class="m-prog-n">${a.done}/${a.total} оп.</span>
        ${a.total === 0
          ? `<span class="rt-muted">няма операции в цех (от склад/готово)</span>`
          : ready
            ? `<span class="m-art-ok">✔ готов</span>`
            : `<button type="button" class="btn btn-small btn-primary m-art-complete" data-oid="${escapeAttr(oid)}" data-pid="${escapeAttr(String(a.pid))}" title="Отчита ВСИЧКИ детайли и операции на този артикул до готово">▶▶ готов</button>`}
      </div>
      ${open ? a.details.map(d => detailHtml(oid, d)).join("") || `<p class="rt-muted" style="margin:6px 0 2px 18px">Няма детайли в цех за този артикул.</p>` : ""}
    </div>`;
  };
  const orderHtml = e => {
    const { arts, misc } = masterArticles(e);
    let body;
    if (arts.length) {
      body = arts.map(a => artHtml(e.id, a)).join("");
      if (misc.length) body += artHtml(e.id, { pid: "misc", qty: 0, code: "", name: "Други детайли (извън артикулите)", details: misc, total: misc.reduce((s, d) => s + d.ops.length, 0), done: misc.reduce((s, d) => s + d.ops.filter(mDone).length, 0) });
    } else {
      // Няма намерени редове на заявката (стар запис/мостра без продукт) — старият изглед по детайли.
      body = e.details.map(d => detailHtml(e.id, d)).join("");
    }
    return `<div class="m-order">
      <div class="m-order-h">📦 ${e.no ? "№" + escapeHtml(e.no) : "СЕРИЯ"} · <b>${escapeHtml(e.client || "—")}</b>
        <span class="m-prog-n">${e.done}/${e.total} оп.</span>
        <button type="button" class="btn btn-small m-complete" data-oid="${escapeAttr(e.id)}" title="Докарай цялата заявка до готово">▶▶ докарай до готово</button></div>
      ${body}
    </div>`;
  };

  wrap.innerHTML = `<div class="master-box">
    <div class="master-head">
      <h3>⚡ Мастер отчитане <span class="rt-muted">— по артикули от заявката</span></h3>
      <span>
        <button type="button" class="btn btn-small btn-danger" id="m-undo" title="Връща назад мастер отчитания по дни — бройки, склад и статуси">⏪ Отмяна</button>
        <button type="button" class="btn btn-small" id="m-close">Затвори</button>
      </span>
    </div>
    <p class="hint">Всеки ред е <b>артикул от заявката на клиента</b>. „▶▶ готов" отчита всичките му детайли и операции докрай (когато цехът не е отчитал). От серии, споделени с други заявки, се отчита <b>само делът на тази заявка</b> (пише го на чипа: „дял N"). Клик върху артикула го разгъва до отделните детайли. Легенда: <span class="m-chip m-ready" style="pointer-events:none">готова</span> <span class="m-chip m-prog" style="pointer-events:none">частично</span> <span class="m-chip m-wait" style="pointer-events:none">чака</span> <span class="m-chip m-done" style="pointer-events:none">готово</span></p>
    <div class="master-tools"><input type="search" id="m-q" placeholder="🔎 търси заявка / клиент…" value="${escapeAttr(masterQuery)}" autocomplete="off" /><span class="rt-muted">${groups.length} заявки в производство</span></div>
    <div class="master-list">${groups.map(orderHtml).join("") || `<p class="report-empty">Няма заявки в производство.</p>`}</div>
  </div>`;

  wrap.querySelector("#m-close").addEventListener("click", () => wrap.remove());
  const undoBtn = wrap.querySelector("#m-undo");
  if (undoBtn) undoBtn.addEventListener("click", masterUndoDialog);
  const qEl = wrap.querySelector("#m-q");
  if (qEl) qEl.addEventListener("input", e => { masterQuery = e.target.value; masterRender(); const el = document.getElementById("m-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });

  // Разгъване/свиване на артикул (кликът върху бутона „готов" не разгъва).
  wrap.querySelectorAll(".m-art-h").forEach(h => h.addEventListener("click", e => {
    if (e.target.closest(".m-art-complete")) return;
    const k = h.dataset.okey;
    masterOpen[k] = !masterOpen[k];
    masterRender();
  }));

  // „▶▶ готов" за артикул: отчита всичките му детайли до готово.
  wrap.querySelectorAll(".m-art-complete").forEach(b => b.addEventListener("click", async () => {
    const oid = b.dataset.oid, pid = b.dataset.pid;
    const g = masterGroups().find(x => String(x.id) === String(oid)); if (!g) return;
    const { arts, misc } = masterArticles(g);
    const a = pid === "misc"
      ? { name: "Други детайли", qty: 0, details: misc }
      : arts.find(x => String(x.pid) === String(pid));
    if (!a) return;
    if (!confirm(`Да отчета ли артикула „${a.code ? a.code + " " : ""}${a.name}"${a.qty ? ` × ${a.qty} бр.` : ""} до ГОТОВО?\n\nЩе се отчетат всичките му детайли и операции (${a.details.length} детайла). От споделените с други заявки серии се отчита САМО делът на тази заявка.`)) return;
    wrap.querySelectorAll(".m-chip, .m-complete, .m-art-complete").forEach(x => x.disabled = true);
    try { await masterCompleteOrder(oid, a.details); } catch (e) { alert("Грешка: " + (e.message || e)); }
    if (typeof erpMarkOrderReadyIfDone === "function") { try { await erpMarkOrderReadyIfDone(oid); } catch (e) {} }
    masterRender();
    if (typeof renderTasks === "function") renderTasks();
  }));

  wrap.querySelectorAll(".m-chip").forEach(b => b.addEventListener("click", async () => {
    if (b.classList.contains("m-done")) return;
    const oid = b.dataset.oid, code = b.dataset.code, step = Number(b.dataset.step);
    const g = masterGroups().find(e => String(e.id) === String(oid)); if (!g) return;
    const d = g.details.find(x => x.key === code); if (!d) return;
    wrap.querySelectorAll(".m-chip, .m-complete, .m-art-complete").forEach(x => x.disabled = true);
    try { await masterAdvanceDetail(oid, d.ops, step); } catch (e) { alert("Грешка: " + (e.message || e)); }
    if (typeof erpMarkOrderReadyIfDone === "function") { try { await erpMarkOrderReadyIfDone(oid); } catch (e) {} }
    masterRender();
    if (typeof renderTasks === "function") renderTasks();
  }));

  wrap.querySelectorAll(".m-complete").forEach(b => b.addEventListener("click", async () => {
    const oid = b.dataset.oid;
    const g = masterGroups().find(e => String(e.id) === String(oid)); if (!g) return;
    if (!confirm(`Да докарам ли цялата заявка ${g.no ? "№" + g.no : ""} до готово (всички операции)?\n\nОт споделените с други заявки серии се отчита САМО делът на тази заявка.`)) return;
    wrap.querySelectorAll(".m-chip, .m-complete, .m-art-complete").forEach(x => x.disabled = true);
    try { await masterCompleteOrder(oid, g.details); } catch (e) { alert("Грешка: " + (e.message || e)); }
    if (typeof erpMarkOrderReadyIfDone === "function") { try { await erpMarkOrderReadyIfDone(oid); } catch (e) {} }
    masterRender();
    if (typeof renderTasks === "function") renderTasks();
  }));
}
