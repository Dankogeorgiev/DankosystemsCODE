/* Данко Системс — „🔬 Симулация на производството".
   Паралелна реалност: преди да пуснем заявка, прекарваме я през ИСТИНСКИЯ
   производствен двигател (erpFlowSteps + erpFlowAvailable), но изцяло в паметта —
   без нито един запис в базата. Показва:
     • докъде ще стигне (колко крайни изделия ще излязат) и къде ще спре;
     • коренните спирачки: липсва материал / липсва рецепта или цех / чака части;
     • хода по вълни (кой цех кога работи), както реално ще потече потокът.
   Ползва глобалните ERP, erpFlowSteps, erpFlowAvailable, erpFlowGatePending,
   erpEnsureLoaded, erpDialog, erpToNum, erpNum, escapeHtml/escapeAttr,
   erpFlowMatNeeded (за списъка материали), reportExportXls (по избор). */

// Форматира бройка/кг (може дробно).
function simNum(n) {
  if (typeof erpNum === "function") return erpNum(n);
  const x = Number(n) || 0;
  return (Math.round(x * 1000) / 1000).toLocaleString("bg-BG");
}

// Стартира симулация за поръчка (една или няколко продуктови линии).
// lines: [{ productId, qty }]; opts: { title, stockTop }
async function erpSimulateProduction(lines, opts) {
  opts = opts || {};
  try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); }
  catch (e) { alert("Не мога да заредя ЕРП данните: " + (e.message || e)); return; }
  if (typeof erpRefreshMatStock === "function") { try { await erpRefreshMatStock(); } catch (e) {} }

  lines = (lines || []).filter(l => l && l.productId && ERP.prodById[l.productId])
    .map(l => ({ productId: l.productId, qty: erpToNum(l.qty) || 1 }));
  if (!lines.length) { alert("Няма продукт за симулация."); return; }

  // Наличности за нетване (детайли) — копие, за да не мутираме кеша.
  const availDetails = {};
  ERP.products.forEach(p => { const s = Number(p.stock) || 0; if (s) availDetails[p.id] = s; });

  // 1) Строим стъпките (нето, спрямо наличните детайли) и ги обединяваме по серия.
  const mine = {};          // seriesKey -> { qty, st }
  const missingMap = {};    // липсващи детайли (без рецепта/цех и не на склад)
  const externalMap = {};   // външни услуги
  const consumed = {};      // взети от склад детайли
  lines.forEach(l => {
    const res = erpFlowSteps({ erpProductId: l.productId, erpQty: l.qty },
      { stock: availDetails, consumed, toStockTop: !!opts.stockTop });
    (res.steps || []).forEach(st => {
      const cur = mine[st.seriesKey] || (mine[st.seriesKey] = { qty: 0, make: 0, st });
      cur.qty += st.qty;
      cur.make += (Number(st.make) || 0);   // сумираме бройката и при споделен детайл между линии
    });
    (res.missing || []).forEach(m => {
      const k = m.code || m.name; const c = missingMap[k] || (missingMap[k] = { code: m.code, name: m.name, qty: 0 });
      c.qty += Number(m.qty) || 0;
    });
    (res.external || []).forEach(e => { const k = (e.product || "") + "¦" + (e.op || ""); externalMap[k] = { product: e.product, op: e.op }; });
  });
  const keys = Object.keys(mine);
  if (!keys.length) {
    const miss = Object.values(missingMap);
    alert(miss.length
      ? "Нищо не може да тръгне — липсват рецепти/цех за:\n" + miss.map(m => `• ${m.code ? m.code + " " : ""}${m.name}`).join("\n")
      : "Няма операции за пускане (детайлите са изцяло на склад или нямат рецепта).");
    return;
  }

  // 2) Псевдо-задачи по серия (в памет).
  const series = {};
  keys.forEach(k => {
    const st = mine[k].st;
    series[k] = {
      key: k, qty: mine[k].qty, produced: 0,
      code: st.code, product: st.product, operation: st.operation, workshop: st.workshop,
      step: st.step, last: !!st.last, role: st.role, pid: st.pid, make: mine[k].make,
      source: { flow: true, seriesKey: k, prevKey: st.prevKey || null, gate: st.gate || null, materials: st.materials || null, pid: st.pid, last: !!st.last },
    };
  });

  // Какво взема от Склад детайли (готова наличност — не се пуска в цех).
  const fromStock = Object.keys(consumed).map(pid => {
    const p = ERP.prodById[pid] || {};
    return { code: p.code || "", name: p.name || "", qty: Number(consumed[pid]) || 0, unit: p.unit || "бр." };
  }).filter(x => x.qty > 0).sort((a, b) => b.qty - a.qty);

  // Какво пуска в производство (нето — по детайл/възел, бройка за правене).
  const prodByPid = {};
  keys.forEach(k => {
    const t = series[k];
    const g = prodByPid[t.pid] || (prodByPid[t.pid] = { code: t.code, name: t.product, make: Number(t.make) || 0, ops: [], isTop: t.role === "final" });
    if (t.operation) g.ops.push({ operation: t.operation, workshop: t.workshop, step: t.step });
  });
  const produceList = Object.values(prodByPid).map(g => {
    g.ops.sort((a, b) => (a.step || 0) - (b.step || 0));
    return g;
  }).sort((a, b) => (b.isTop ? 1 : 0) - (a.isTop ? 1 : 0) || String(a.name).localeCompare(String(b.name), "bg"));

  // 3) Наличности на материалите — копие.
  const matStock = {};
  (ERP.materials || []).forEach(m => { matStock[m.id] = Number(m.stock) || 0; });

  // 4) Симулация по вълни. Всяка вълна = един „скок" на потока напред.
  //    Спираме, когато никоя серия не може да напредне.
  const waves = [];
  const maxRounds = keys.length * 2 + 10;
  let round = 0;
  while (round < maxRounds) {
    const map = {}; keys.forEach(k => { map[k] = { produced: series[k].produced, qty: series[k].qty }; });
    const wave = []; let progressed = 0;
    keys.forEach(k => {
      const t = series[k];
      const rem = t.qty - t.produced;
      if (rem <= 0) return;
      // Наличност по потока (предна операция / сглобяване) — истинската логика.
      let avail = (typeof erpFlowAvailable === "function")
        ? erpFlowAvailable({ source: t.source, qty: t.qty, produced: t.produced, brak: 0 }, map)
        : rem;
      // Ограничение по материал (само първата операция).
      let matCap = Infinity;
      if (t.source.materials && t.source.materials.length) {
        t.source.materials.forEach(m => {
          const per = Number(m.per) || 0; if (per <= 0) return;
          const can = Math.floor((matStock[m.mid] || 0) / per);
          if (can < matCap) matCap = can;
        });
      }
      const make = Math.max(0, Math.min(rem, avail, matCap === Infinity ? avail : matCap));
      if (make > 0) {
        if (t.source.materials) t.source.materials.forEach(m => { matStock[m.mid] = (matStock[m.mid] || 0) - (Number(m.per) || 0) * make; });
        t.produced += make; progressed += make;
        wave.push({ code: t.code, product: t.product, operation: t.operation, workshop: t.workshop, made: make, done: t.produced, qty: t.qty });
      }
    });
    if (progressed <= 0) break;
    waves.push(wave); round++;
  }

  // 5) Анализ: крайни изделия + къде спира.
  // „краен продукт" = ПОСЛЕДНАТА операция на върха (role final + last).
  const topSeries = keys.map(k => series[k]).filter(t => t.role === "final" && t.last);
  const orderedTop = lines.reduce((s, l) => s + l.qty, 0);
  const producedTop = topSeries.reduce((s, t) => s + t.produced, 0);
  const topQty = topSeries.reduce((s, t) => s + t.qty, 0);

  // Незавършени серии + причина.
  const finalMap = {}; keys.forEach(k => { finalMap[k] = { produced: series[k].produced, qty: series[k].qty }; });
  const stalls = [];
  keys.forEach(k => {
    const t = series[k];
    if (t.produced >= t.qty) return;
    let reason = "", kind = "flow";
    // материал?
    if (t.source.materials && t.source.materials.length) {
      const short = [];
      t.source.materials.forEach(m => {
        const per = Number(m.per) || 0; const rem = (t.qty - t.produced) * per;
        const mat = ERP.matById[m.mid] || {};
        const have = Math.max(0, Number(matStock[m.mid]) || 0);
        if (rem > 0 && have < rem) short.push(`${mat.code ? mat.code + " " : ""}${mat.name || ""} (липсват ${simNum(rem - have)} ${mat.unit || ""})`);
      });
      if (short.length) { reason = "липсва материал: " + short.join(", "); kind = "mat"; }
    }
    if (!reason) {
      const pend = (typeof erpFlowGatePending === "function") ? erpFlowGatePending({ source: t.source }, finalMap) : [];
      if (pend.length) { reason = "чака части: " + pend.map(p => `${p.code}${p.operation ? " · " + p.operation : ""} (${p.produced}/${p.qty})`).join(", "); kind = "parts"; }
    }
    if (!reason && t.source.prevKey) { reason = "чака предната операция"; kind = "flow"; }
    if (!reason) reason = "не може да напредне";
    stalls.push({ code: t.code, product: t.product, operation: t.operation, workshop: t.workshop, produced: t.produced, qty: t.qty, reason, kind });
  });

  // Материали за купуване (за цялата симулирана заявка).
  const matNeed = {};
  keys.forEach(k => {
    const t = series[k];
    if (!t.source.materials) return;
    t.source.materials.forEach(m => { matNeed[m.mid] = (matNeed[m.mid] || 0) + (Number(m.per) || 0) * t.qty; });
  });
  const buyList = Object.keys(matNeed).map(mid => {
    const m = ERP.matById[mid] || {}; const need = matNeed[mid]; const have = Math.max(0, Number(m.stock) || 0);
    return { code: m.code || "", name: m.name || "", unit: m.unit || "", need, have, buy: Math.max(0, need - have) };
  }).filter(r => r.buy > 0).sort((a, b) => b.buy - a.buy);

  erpSimShow({
    title: opts.title || "", waves, stalls, missing: Object.values(missingMap), external: Object.values(externalMap),
    orderedTop, producedTop, topQty, buyList, seriesCount: keys.length, fromStock, produceList, lines,
  });
}

// Показва резултата от симулацията.
function erpSimShow(r) {
  const full = r.producedTop >= r.topQty && r.topQty > 0 && !r.missing.length;
  let verdict, vcls;
  if (r.missing.length) { verdict = `❌ НЯМА да се сглоби докрай — липсват рецепти/цех за ${r.missing.length} детайл${r.missing.length === 1 ? "" : "а"}.`; vcls = "rt-verdict-bad"; }
  else if (full) { verdict = `✅ Ще се произведе НАПЪЛНО — ${simNum(r.producedTop)} бр. краен продукт.`; vcls = "rt-verdict-ok"; }
  else if (r.producedTop > 0) { verdict = `⚠ Ще стигне до ${simNum(r.producedTop)} от ${simNum(r.topQty)} бр. краен продукт, после спира.`; vcls = "rt-verdict-warn"; }
  else { verdict = `⛔ Няма да тръгне (0 бр.) — виж спирачките по-долу.`; vcls = "rt-verdict-bad"; }

  const matStalls = r.stalls.filter(s => s.kind === "mat");
  const partStalls = r.stalls.filter(s => s.kind === "parts");
  const otherStalls = r.stalls.filter(s => s.kind !== "mat" && s.kind !== "parts");

  const stallHtml = list => list.map(s =>
    `<div class="sim-stall">⛔ <b>${escapeHtml(s.code || "")}</b> ${escapeHtml(s.product || "")} · ${escapeHtml(s.operation || "")}${s.workshop ? ` <span class="rt-muted">(${escapeHtml(s.workshop)})</span>` : ""}
      — ${simNum(s.produced)}/${simNum(s.qty)} · <span class="sim-reason">${escapeHtml(s.reason)}</span></div>`).join("");

  const wavesHtml = r.waves.map((w, i) => {
    const byWs = {};
    w.forEach(e => { (byWs[e.workshop || "—"] = byWs[e.workshop || "—"] || []).push(e); });
    const cells = Object.keys(byWs).map(ws =>
      `<div class="sim-wave-ws"><span class="sim-ws">🏭 ${escapeHtml(ws)}</span>${byWs[ws].map(e =>
        `<span class="sim-op" title="${escapeAttr((e.code || "") + " " + (e.product || ""))}">${escapeHtml(e.operation || "")}: ${simNum(e.made)} бр.${e.done >= e.qty ? " ✔" : ""}</span>`).join("")}</div>`).join("");
    return `<div class="sim-wave"><div class="sim-wave-h">Вълна ${i + 1}</div>${cells}</div>`;
  }).join("");

  const html = `
    <div class="sim-dialog">
      <h3>🔬 Симулация на производството${r.title ? " — " + escapeHtml(r.title) : ""}</h3>
      <div class="rt-verdict ${vcls}">${verdict}</div>
      <p class="hint">Паралелна реалност — нищо не е записано. Прекарахме заявката през двигателя с текущите наличности, за да видим докъде стига и къде спира.</p>

      ${(matStalls.length || partStalls.length || otherStalls.length || r.missing.length || r.external.length) ? `
        <h4 style="margin:12px 0 6px">🚧 Къде спира и защо</h4>
        ${r.missing.length ? `<div class="sim-block"><b class="rt-bad-txt">Липсва рецепта/цех (блокира сглобяването):</b>${r.missing.map(m => `<div class="sim-stall">🚫 ${escapeHtml((m.code ? m.code + " " : "") + m.name)} — нужни ${simNum(m.qty)} бр.</div>`).join("")}</div>` : ""}
        ${matStalls.length ? `<div class="sim-block"><b class="rt-bad-txt">Спира за материал:</b>${stallHtml(matStalls)}</div>` : ""}
        ${partStalls.length ? `<div class="sim-block"><b>Чака части:</b>${stallHtml(partStalls)}</div>` : ""}
        ${otherStalls.length ? `<div class="sim-block"><b>Друго:</b>${stallHtml(otherStalls)}</div>` : ""}
        ${r.external.length ? `<div class="sim-block"><b>Външни услуги (подизпълнител):</b> ${r.external.map(e => escapeHtml((e.product || "") + " · " + (e.op || ""))).join("; ")}</div>` : ""}
      ` : `<div class="rt-verdict rt-verdict-ok" style="margin-top:8px">Няма спирачки — потокът минава чисто.</div>`}

      <div class="sim-cols">
        <div class="sim-col">
          <h4 style="margin:14px 0 6px">📦 Взема от Склад детайли <span class="rt-muted">(готово — не влиза в цех)</span></h4>
          ${r.fromStock.length
            ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Детайл</th><th class="num">Бройка</th></tr></thead>
               <tbody>${r.fromStock.map(s => `<tr><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.name)}</td><td class="num"><b>${simNum(s.qty)}</b> ${escapeHtml(s.unit)}</td></tr>`).join("")}</tbody></table>`
            : `<p class="rt-muted" style="margin:2px 0">Нищо — няма готова наличност за нетване.</p>`}
        </div>
        <div class="sim-col">
          <h4 style="margin:14px 0 6px">🏭 Пуска в производство <span class="rt-muted">(нето, по детайл)</span></h4>
          ${r.produceList.length
            ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Детайл/възел</th><th class="num">Бройка</th><th>Операции</th></tr></thead>
               <tbody>${r.produceList.map(p => `<tr${p.isTop ? ` class="sim-top-row"` : ""}><td>${escapeHtml(p.code)}${p.isTop ? " 🏁" : ""}</td><td>${escapeHtml(p.name)}</td><td class="num"><b>${simNum(p.make)}</b></td><td class="rt-muted">${p.ops.map(o => escapeHtml(o.operation) + (o.workshop ? " → " + escapeHtml(o.workshop) : "")).join(" · ")}</td></tr>`).join("")}</tbody></table>`
            : `<p class="rt-muted" style="margin:2px 0">Нищо за пускане.</p>`}
        </div>
      </div>

      ${r.buyList.length ? `
        <h4 style="margin:14px 0 6px">🛒 Трябва да се купи материал</h4>
        <table class="report-table erp-table"><thead><tr><th>Код</th><th>Материал</th><th class="num">Нужно</th><th class="num">Налично</th><th class="num">Купи</th><th>Мярка</th></tr></thead>
        <tbody>${r.buyList.map(b => `<tr class="erp-below"><td>${escapeHtml(b.code)}</td><td>${escapeHtml(b.name)}</td><td class="num">${simNum(b.need)}</td><td class="num">${simNum(b.have)}</td><td class="num"><b>${simNum(b.buy)}</b></td><td>${escapeHtml(b.unit)}</td></tr>`).join("")}</tbody></table>
      ` : ""}

      <h4 style="margin:14px 0 6px">🌊 Ход по вълни <span class="rt-muted">(докъдето стига)</span></h4>
      <div class="sim-waves">${wavesHtml || `<p class="report-empty">Нищо не тръгва.</p>`}</div>

      <div class="erp-dialog-actions">
        <button class="btn btn-small" id="sim-codes">📋 Всички кодове</button>
        <button class="btn btn-small" id="sim-print">🖨 Печат</button>
        <button class="btn btn-primary" id="sim-close">Затвори</button>
      </div>
    </div>`;

  const { wrap, close } = erpDialog(html);
  const box = wrap.querySelector(".erp-dialog-box");
  if (box) box.classList.add("sim-box");   // по-широк диалог за симулацията
  wrap.querySelector("#sim-close").addEventListener("click", close);
  const pr = wrap.querySelector("#sim-print");
  if (pr) pr.addEventListener("click", () => erpSimPrint(wrap, r.title));
  const cb = wrap.querySelector("#sim-codes");
  if (cb) cb.addEventListener("click", () => erpSimCodesDialog(r.lines, r.title));
}

// Пълен списък на ВСИЧКИ кодове (детайли/възли + крайно изделие), участващи в
// поръчката, с общи количества (пълно разбиване на рецептата, без нетване).
function erpSimAllCodes(lines) {
  const acc = {};
  const walk = (pid, mult, anc, depth) => {
    const p = ERP.prodById[pid] || {};
    const e = acc[pid] || (acc[pid] = { pid, code: p.code || "", name: p.name || "", qty: 0, isTop: false, hasChildren: false });
    e.qty += mult;
    if (depth === 0) e.isTop = true;
    const plines = ERP.linesByProduct[pid] || [];
    if (plines.some(l => l.child_product_id)) e.hasChildren = true;
    plines.forEach(l => {
      if (l.child_product_id && !anc.has(l.child_product_id)) {
        walk(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]), depth + 1);
      }
    });
  };
  (lines || []).forEach(l => { if (l.productId) walk(l.productId, Number(l.qty) || 1, new Set([l.productId]), 0); });
  return Object.values(acc).sort((a, b) => (b.isTop ? 1 : 0) - (a.isTop ? 1 : 0) || String(a.code).localeCompare(String(b.code), "bg"));
}

function erpSimCodesDialog(lines, title) {
  const codes = erpSimAllCodes(lines);
  const typeOf = c => c.isTop ? "крайно изделие" : (c.hasChildren ? "възел" : "детайл");
  const rowsHtml = codes.map(c => `<tr${c.isTop ? ' class="sim-top-row"' : ''}><td><b>${escapeHtml(c.code)}</b>${c.isTop ? " 🏁" : ""}</td><td>${escapeHtml(c.name)}</td><td class="num"><b>${simNum(c.qty)}</b></td><td>${typeOf(c)}</td></tr>`).join("");
  const html = `<div class="sim-dialog">
    <h3>📋 Всички кодове в поръчката${title ? " — " + escapeHtml(title) : ""} <span class="rt-muted">(${codes.length})</span></h3>
    <p class="hint">Всички кодове (детайли, възли и крайното изделие 🏁), които участват в поръчката, с общи количества.</p>
    <table class="report-table erp-table"><thead><tr><th>Код</th><th>Наименование</th><th class="num">Бройка</th><th>Вид</th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="4" class="report-empty">Няма кодове.</td></tr>`}</tbody></table>
    <div class="erp-dialog-actions">
      <button class="btn btn-small" id="sc-xls">⤓ Excel</button>
      <button class="btn btn-small" id="sc-print">🖨 Печат</button>
      <button class="btn btn-primary" id="sc-close">Затвори</button>
    </div></div>`;
  const { wrap, close } = erpDialog(html);
  const box = wrap.querySelector(".erp-dialog-box"); if (box) box.classList.add("sim-box");
  wrap.querySelector("#sc-close").addEventListener("click", close);
  const sections = () => [{
    title: "Всички кодове в поръчката" + (title ? " — " + title : ""),
    headers: [{ label: "Код" }, { label: "Наименование" }, { label: "Бройка", num: true }, { label: "Вид" }],
    rows: codes.map(c => [c.code, c.name, simNum(c.qty), typeOf(c)]),
  }];
  const xls = wrap.querySelector("#sc-xls"); if (xls) xls.addEventListener("click", () => { if (typeof reportExportXls === "function") reportExportXls("kodove-porachka", "Всички кодове в поръчката" + (title ? " — " + title : ""), sections()); });
  const pr = wrap.querySelector("#sc-print"); if (pr) pr.addEventListener("click", () => { if (typeof reportOpenView === "function") reportOpenView("Всички кодове в поръчката" + (title ? " — " + title : ""), sections()); });
}

// Печат на симулацията — отваря чист изглед със същите стилове и извиква печат.
function erpSimPrint(wrap, titleText) {
  const box = wrap && wrap.querySelector(".sim-dialog");
  if (!box) return;
  const clone = box.cloneNode(true);
  clone.querySelectorAll(".erp-dialog-actions, button").forEach(el => el.remove());   // без бутоните
  const styleLinks = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => `<link rel="stylesheet" href="${l.href}">`).join("");
  const w = window.open("", "_blank");
  if (!w) { alert("Разреши изскачащите прозорци, за да принтираш."); return; }
  w.document.write(`<!doctype html><html lang="bg"><head><meta charset="utf-8">
    <title>${escapeHtml(titleText ? "Симулация — " + titleText : "Симулация на производството")}</title>
    ${styleLinks}
    <style>
      body { padding: 16px 20px; background: #fff; color: #111; }
      .sim-dialog { max-width: 100%; }
      .sim-cols { display: flex; gap: 16px; flex-wrap: wrap; }
      .sim-col { flex: 1 1 320px; }
      table { page-break-inside: auto; }
      tr, .sim-wave, .sim-block, .sim-detail { page-break-inside: avoid; }
      @media print { .no-print { display: none; } }
    </style></head><body>${clone.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}
