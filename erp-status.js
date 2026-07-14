/* Данко Системс — „📊 Статус на поръчката (на живо)".
   Моментна снимка на РЕАЛНО пусната поръчка: кои операции са минали, къде е
   спряло, какво чака (материал / части / предната операция) и от какво се нуждае.
   Чете истинските поточни задачи (erpFlowTasksFor) и ползва същите логики като
   цеховете: erpFlowAvailable, erpFlowGatePending, taskMaterialShort.
   Ползва ERP, erpEnsureLoaded, erpRefreshMatStock, erpDialog, erpNum,
   escapeHtml/escapeAttr, erpSelectAll. */

function ostNum(n) { return (typeof simNum === "function") ? simNum(n) : (typeof erpNum === "function" ? erpNum(n) : String(n)); }

// Състояние на една операция (задача) спрямо цялата картина (map).
function ostOpState(t, map) {
  const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
  if (qty > 0 && prod >= qty) return { k: "done", icon: "✅", label: "готово" };
  const matShort = (typeof taskMaterialShort === "function") ? taskMaterialShort(t) : null;
  if (matShort) return { k: "mat", icon: "🔴", label: "чака материал", note: matShort.map(m => `${m.code ? m.code + " " : ""}${m.name}: липсват ${ostNum(m.short)} ${m.unit || ""}`).join("; ") };
  const avail = (typeof erpFlowAvailable === "function") ? erpFlowAvailable(t, map) : (qty - prod);
  if (avail > 0) {
    return prod > 0
      ? { k: "progress", icon: "🔵", label: `тече · ${ostNum(prod)}/${ostNum(qty)}` }
      : { k: "ready", icon: "🟢", label: `готова за работа (${ostNum(avail)} налични)` };
  }
  const pend = (typeof erpFlowGatePending === "function") ? erpFlowGatePending(t, map) : [];
  if (pend.length) return { k: "parts", icon: "🟡", label: "чака части", note: pend.map(p => `${p.code}${p.operation ? " · " + p.operation : ""} (${ostNum(p.produced)}/${ostNum(p.qty)})`).join("; ") };
  if (t.source && t.source.prevKey) return { k: "prev", icon: "⏳", label: "чака предната операция" };
  return { k: "wait", icon: "⏳", label: "чака" };
}

// Отваря статуса за поръчка (sampleId = s.id или o.id).
async function erpOrderStatus(orderId, title) {
  try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); } catch (e) {}
  if (typeof erpRefreshMatStock === "function") { try { await erpRefreshMatStock(); } catch (e) {} }

  // Всички поточни задачи (за картата на потока) + тези на поръчката.
  const { data, error } = await erpSelectAll("tasks", "id,data,done", "data->source->>flow", "true");
  if (error) { alert("Не мога да заредя статуса: " + (error.message || error)); return; }
  const all = (data || []).map(r => Object.assign({ id: r.id }, r.data || {}));
  const map = {};
  all.forEach(t => {
    const s = t.source;
    if (!s || !s.flow || !s.seriesKey) return;
    const m = map[s.seriesKey] || (map[s.seriesKey] = { produced: 0, qty: 0 });
    m.produced += Number(t.produced) || 0; m.qty += Number(t.qty) || 0;
  });

  const sid = String(orderId);
  const mine = all.filter(t => t.source && t.source.kind === "series" && (t.source.orderIds || []).map(String).includes(sid));

  erpOrderStatusShow(mine, map, title || "", orderId);
}

function erpOrderStatusShow(mine, map, title, orderId) {
  if (!mine.length) {
    const { wrap, close } = erpDialog(`<h3>📊 Статус на поръчката${title ? " — " + escapeHtml(title) : ""}</h3>
      <p class="rt-muted">Няма пуснато производство за тази поръчка (или е изтеглена).</p>
      <div class="erp-dialog-actions"><button class="btn btn-primary" id="ost-close">Затвори</button></div>`);
    wrap.querySelector("#ost-close").addEventListener("click", close);
    return;
  }

  // По детайл/възел (pid), операциите подредени по стъпка.
  const byPid = {};
  mine.forEach(t => {
    const pid = (t.source && t.source.pid) || t.code || t.product;
    const g = byPid[pid] || (byPid[pid] = { code: t.code || "", product: t.product || "", isTop: (t.source && t.source.role) === "final", stocked: 0, ops: [] });
    if (t.source && t.source.last) g.stocked = Number(t.source.stocked) || 0;
    g.ops.push({ t, step: (t.source && t.source.step) || 0, operation: t.operation || "", workshop: t.workshop || "", state: ostOpState(t, map) });
  });
  const details = Object.values(byPid).map(g => { g.ops.sort((a, b) => a.step - b.step); return g; })
    .sort((a, b) => (b.isTop ? 1 : 0) - (a.isTop ? 1 : 0) || String(a.product).localeCompare(String(b.product), "bg"));

  // Обобщение.
  const totalOps = mine.length;
  const doneOps = mine.filter(t => { const q = Number(t.qty) || 0, p = Number(t.produced) || 0; return q > 0 && p >= q; }).length;
  const pct = totalOps ? Math.round(doneOps / totalOps * 100) : 0;
  const tops = mine.filter(t => t.source && t.source.role === "final" && t.source.last);
  const producedTop = tops.reduce((s, t) => s + (Number(t.produced) || 0), 0);
  const topQty = tops.reduce((s, t) => s + (Number(t.qty) || 0), 0);

  // Спирачки (по видове).
  const flat = [];
  details.forEach(g => g.ops.forEach(o => { if (o.state.k !== "done") flat.push({ g, o }); }));
  const matBlock = flat.filter(x => x.o.state.k === "mat");
  const partBlock = flat.filter(x => x.o.state.k === "parts");
  const active = flat.filter(x => x.o.state.k === "ready" || x.o.state.k === "progress");

  let verdict, vcls;
  if (doneOps >= totalOps) { verdict = `✅ Всичко е готово — ${ostNum(producedTop)} бр. краен продукт.`; vcls = "rt-verdict-ok"; }
  else if (matBlock.length) { verdict = `🔴 Спряло — чака материал (${matBlock.length} ${matBlock.length === 1 ? "детайл" : "детайла"}).`; vcls = "rt-verdict-bad"; }
  else if (active.length) { verdict = `🟢 Тече — ${active.length} ${active.length === 1 ? "операция може" : "операции могат"} да се работят сега.`; vcls = "rt-verdict-ok"; }
  else if (partBlock.length) { verdict = `🟡 Чака сглобяване — частите още не са готови.`; vcls = "rt-verdict-warn"; }
  else { verdict = `⏳ Чака — нищо не може да напредне в момента.`; vcls = "rt-verdict-warn"; }

  const stateCls = { done: "ost-done", progress: "ost-prog", ready: "ost-ready", mat: "ost-mat", parts: "ost-parts", prev: "ost-prev", wait: "ost-prev" };
  const opRow = o => `<div class="ost-op ${stateCls[o.state.k] || ""}">
      <span class="ost-op-ic">${o.state.icon}</span>
      <span class="ost-op-name">${escapeHtml(o.operation)}</span>
      <span class="ost-op-ws">${o.workshop ? "🏭 " + escapeHtml(o.workshop) : ""}</span>
      <span class="ost-op-qty">${ostNum(Number(o.t.produced) || 0)}/${ostNum(Number(o.t.qty) || 0)}</span>
      <span class="ost-op-st">${escapeHtml(o.state.label)}${o.state.note ? ` — ${escapeHtml(o.state.note)}` : ""}</span>
    </div>`;

  const detailHtml = details.map(g => `
    <div class="ost-detail">
      <div class="ost-detail-h">${g.isTop ? "🏁 " : "🔩 "}<b>${escapeHtml(g.code)}</b> ${escapeHtml(g.product)}
        ${g.stocked > 0 ? `<span class="ost-stocked">📥 в склада: ${ostNum(g.stocked)}</span>` : ""}</div>
      ${g.ops.map(opRow).join("")}
    </div>`).join("");

  const blockersHtml = (matBlock.length || partBlock.length) ? `
    <h4 style="margin:12px 0 6px">🚧 Спирачки</h4>
    ${matBlock.length ? `<div class="ost-block"><b class="rt-bad-txt">Чака материал:</b>${matBlock.map(x => `<div class="ost-bl">🔴 ${escapeHtml(x.g.code)} ${escapeHtml(x.g.product)} · ${escapeHtml(x.o.operation)} — ${escapeHtml(x.o.state.note || "")}</div>`).join("")}</div>` : ""}
    ${partBlock.length ? `<div class="ost-block"><b>Чака части:</b>${partBlock.map(x => `<div class="ost-bl">🟡 ${escapeHtml(x.g.code)} ${escapeHtml(x.g.product)} · ${escapeHtml(x.o.operation)} — ${escapeHtml(x.o.state.note || "")}</div>`).join("")}</div>` : ""}
  ` : "";

  const activeHtml = active.length ? `
    <h4 style="margin:12px 0 6px">🟢 Може да се работи сега</h4>
    <div class="ost-block">${active.map(x => `<div class="ost-bl">▶ ${escapeHtml(x.g.code)} ${escapeHtml(x.g.product)} · <b>${escapeHtml(x.o.operation)}</b> ${x.o.workshop ? "→ " + escapeHtml(x.o.workshop) : ""} <span class="rt-muted">(${escapeHtml(x.o.state.label)})</span></div>`).join("")}</div>
  ` : "";

  const html = `
    <div class="sim-dialog ost-dialog">
      <h3>📊 Статус на поръчката${title ? " — " + escapeHtml(title) : ""}</h3>
      <div class="rt-verdict ${vcls}">${verdict}</div>
      <div class="ost-summary">
        Операции: <b>${doneOps}/${totalOps}</b> готови (${pct}%)
        <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
        ${topQty ? ` · Крайно изделие: <b>${ostNum(producedTop)}/${ostNum(topQty)}</b> бр.` : ""}
      </div>
      ${blockersHtml}
      ${activeHtml}
      <h4 style="margin:14px 0 6px">🧭 По детайли</h4>
      <div class="ost-details">${detailHtml}</div>
      <div class="erp-dialog-actions">
        <button class="btn btn-small" id="ost-refresh">↻ Обнови</button>
        <button class="btn btn-primary" id="ost-close">Затвори</button>
      </div>
    </div>`;

  const { wrap, close } = erpDialog(html);
  const box = wrap.querySelector(".erp-dialog-box");
  if (box) box.classList.add("sim-box");
  wrap.querySelector("#ost-close").addEventListener("click", close);
  wrap.querySelector("#ost-refresh").addEventListener("click", () => { close(); erpOrderStatus(orderId, title); });
}
