/* Данко Системс — „⚡ Мастер отчитане" (само за офиса/админ).
   Бърз backfill на производството: с едно натискане докарваш детайла до избрана
   операция (отчита всички операции по веригата до пълно), без прозореца за
   машина/време. Ползва logProduction(..., {silent:true}) — стоковите движения,
   дневникът и гейтовете остават коректни. Групира по заявка → детайл → операции.
   Ползва TASKS, erpSeriesProduced, erpFlowAvailable, logProduction, escapeHtml. */

let masterQuery = "";

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

// Докарва един детайл до дадена стъпка (отчита всяка операция до пълно наличното).
async function masterAdvanceDetail(ops, targetStep) {
  const sorted = ops.slice().sort((a, b) => mStep(a) - mStep(b));
  for (const t of sorted) {
    if (mStep(t) > targetStep) break;
    const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
    const avail = (typeof erpFlowAvailable === "function") ? erpFlowAvailable(t, map) : ((Number(t.qty) || 0) - (Number(t.produced) || 0));
    const rem = Math.max(0, (Number(t.qty) || 0) - (Number(t.produced) || 0));
    const toReport = Math.min(rem, Math.max(0, avail));
    if (toReport > 0) await logProduction(t, toReport, { note: "мастер отчитане" }, { silent: true, worker: masterWorker() });
  }
}

// Докарва цялата заявка до готово (цикли, докато има напредък).
async function masterCompleteOrder(details) {
  let progressed = true, guard = 0;
  while (progressed && guard++ < 60) {
    progressed = false;
    const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
    for (const d of details) for (const t of d.ops) {
      const avail = (typeof erpFlowAvailable === "function") ? erpFlowAvailable(t, map) : ((Number(t.qty) || 0) - (Number(t.produced) || 0));
      const rem = Math.max(0, (Number(t.qty) || 0) - (Number(t.produced) || 0));
      const toReport = Math.min(rem, Math.max(0, avail));
      if (toReport > 0) { await logProduction(t, toReport, { note: "мастер отчитане" }, { silent: true, worker: masterWorker() }); progressed = true; }
    }
  }
}

function openMasterReport() {
  let wrap = document.getElementById("master-modal");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "master-modal"; wrap.className = "overlay master-modal";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) wrap.remove(); });
  }
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
    return `<button type="button" class="m-chip ${cls}" data-oid="${escapeAttr(oid)}" data-code="${escapeAttr(d.key)}" data-step="${mStep(t)}" title="Докарай детайла до „${escapeAttr(t.operation || "")}"">${escapeHtml(t.operation || "")}<span class="m-qn">${p}/${q}</span></button>`;
  };
  const detailHtml = (oid, d) => `<div class="m-detail">
      <div class="m-detail-h">🔩 <b>${escapeHtml(d.code)}</b> ${escapeHtml(d.name)}</div>
      <div class="m-chips">${d.ops.map(t => chip(oid, d, t)).join("")}</div>
    </div>`;
  const orderHtml = e => `<div class="m-order">
      <div class="m-order-h">📦 ${e.no ? "№" + escapeHtml(e.no) : "СЕРИЯ"} · <b>${escapeHtml(e.client || "—")}</b>
        <span class="m-prog-n">${e.done}/${e.total} оп.</span>
        <button type="button" class="btn btn-small m-complete" data-oid="${escapeAttr(e.id)}" title="Докарай цялата заявка до готово">▶▶ докарай до готово</button></div>
      ${e.details.map(d => detailHtml(e.id, d)).join("")}
    </div>`;

  wrap.innerHTML = `<div class="master-box">
    <div class="master-head">
      <h3>⚡ Мастер отчитане <span class="rt-muted">— бързо докарване на операциите</span></h3>
      <button type="button" class="btn btn-small" id="m-close">Затвори</button>
    </div>
    <p class="hint">Натисни операция → детайлът се отчита до нея (всички стъпки до пълно). Без прозорец за машина/време — за бърз backfill. Легенда: <span class="m-chip m-ready" style="pointer-events:none">готова</span> <span class="m-chip m-prog" style="pointer-events:none">частично</span> <span class="m-chip m-wait" style="pointer-events:none">чака</span> <span class="m-chip m-done" style="pointer-events:none">готово</span></p>
    <div class="master-tools"><input type="search" id="m-q" placeholder="🔎 търси заявка / клиент…" value="${escapeAttr(masterQuery)}" autocomplete="off" /><span class="rt-muted">${groups.length} заявки в производство</span></div>
    <div class="master-list">${groups.map(orderHtml).join("") || `<p class="report-empty">Няма заявки в производство.</p>`}</div>
  </div>`;

  wrap.querySelector("#m-close").addEventListener("click", () => wrap.remove());
  const qEl = wrap.querySelector("#m-q");
  if (qEl) qEl.addEventListener("input", e => { masterQuery = e.target.value; masterRender(); const el = document.getElementById("m-q"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });

  wrap.querySelectorAll(".m-chip").forEach(b => b.addEventListener("click", async () => {
    if (b.classList.contains("m-done")) return;
    const oid = b.dataset.oid, code = b.dataset.code, step = Number(b.dataset.step);
    const g = masterGroups().find(e => String(e.id) === String(oid)); if (!g) return;
    const d = g.details.find(x => x.key === code); if (!d) return;
    wrap.querySelectorAll(".m-chip, .m-complete").forEach(x => x.disabled = true);
    try { await masterAdvanceDetail(d.ops, step); } catch (e) { alert("Грешка: " + (e.message || e)); }
    if (typeof erpMarkOrderReadyIfDone === "function") { try { await erpMarkOrderReadyIfDone(oid); } catch (e) {} }
    masterRender();
    if (typeof renderTasks === "function") renderTasks();
  }));

  wrap.querySelectorAll(".m-complete").forEach(b => b.addEventListener("click", async () => {
    const oid = b.dataset.oid;
    const g = masterGroups().find(e => String(e.id) === String(oid)); if (!g) return;
    if (!confirm(`Да докарам ли цялата заявка ${g.no ? "№" + g.no : ""} до готово (всички операции)?`)) return;
    wrap.querySelectorAll(".m-chip, .m-complete").forEach(x => x.disabled = true);
    try { await masterCompleteOrder(g.details); } catch (e) { alert("Грешка: " + (e.message || e)); }
    if (typeof erpMarkOrderReadyIfDone === "function") { try { await erpMarkOrderReadyIfDone(oid); } catch (e) {} }
    masterRender();
    if (typeof renderTasks === "function") renderTasks();
  }));
}
