/* Данко Системс — „ПЪЛНЕЖ" (Лазери).
   Лазерджиите отбелязват единичните бройки, с които допълват листовете
   (мостри, рязано за нас). Пише се: код (ако го знаят), дебелина на материала,
   наименование, брой, дата, служител. После админ слага/поправя кода на детайла
   и с „Заприходи" бройката влиза в Склад Детайли като готов детайл, а
   ламарината се изписва от склад Материали по рецептата на детайла.
   Пази се в app_config id="laser_fill": { list:[...] }. Ползва erpDialog,
   ERP (продукти/рецепти), product_movements + stock_movements. */

let LFILL = null;

async function lfillLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "laser_fill").maybeSingle(); LFILL = (data && data.data && data.data.list) || []; }
  catch (e) { LFILL = []; }
}
async function lfillSave() {
  const { error } = await sb.from("app_config").upsert({ id: "laser_fill", data: { list: LFILL || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function lfillNextId() { let m = 0; (LFILL || []).forEach(p => { if ((Number(p.id) || 0) > m) m = Number(p.id); }); return m + 1; }
function lfillToday() { return new Date().toISOString().slice(0, 10); }
function lfillFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }

/* ---------- Прозорецът ПЪЛНЕЖ ---------- */
async function openLaserFill() {
  await lfillLoad();
  const isAdmin = !(typeof amWorker === "function" && amWorker());
  // За офиса зареждаме ЕРП предварително — по рецептата се вижда дали детайлът
  // има още операции (и бутонът да пише „Пусни в цеха", а не „Заприходи").
  if (isAdmin && typeof erpEnsureLoaded === "function") { try { await erpEnsureLoaded(); } catch (e) {} }
  const meWorker = (typeof MY_WORKER !== "undefined" && MY_WORKER) || "";
  const NEW_ROWS = 10;
  // ПЪЛНЕЖ важи за Лазери и Преси. Служителите идват от настройката на цеха;
  // резерва: списъците по подразбиране.
  const FILL_WS = ["Лазери", "Преси"];
  const FILL_FALLBACK = {
    "Лазери": ["Костадин Алвантов", "Димитър", "Кръстьо"],
    "Преси": ["Захари Маджаров", "Васил Иванов", "Иво Бончев", "Петър Стоилов", "Симеон Танев"],
  };
  const wsList = ws => ((typeof WORKERS !== "undefined" && WORKERS && WORKERS[ws]) || []).length ? WORKERS[ws].slice() : (FILL_FALLBACK[ws] || []);
  // Моят цех (за работник): Преси или Лазери; админът вижда и двата.
  const wsMine = isAdmin ? "" :
    ((MY_ACCESS.workshop === "Преси" || (MY_ACCESS.workshops || []).includes("Преси")) ? "Преси" : "Лазери");
  const workerToWs = {};
  FILL_WS.forEach(ws => wsList(ws).forEach(n => { if (!workerToWs[n]) workerToWs[n] = ws; }));
  const workerSel = (cls, i, val) => `<select class="${cls}" data-i="${i}" style="width:160px">
    <option value="">— избери —</option>
    ${isAdmin
      ? FILL_WS.map(ws => `<optgroup label="${escapeAttr(ws)}">${wsList(ws).map(n => `<option ${n === val ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}</optgroup>`).join("")
      : wsList(wsMine).map(n => `<option ${n === val ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
  </select>`;

  const isHandled = r => r.status === "заприходен" || r.status === "в цех";
  const pending = (LFILL || []).filter(r => !isHandled(r)).sort((a, b) => String(b.date || "").localeCompare(a.date || ""));
  const posted = (LFILL || []).filter(isHandled).sort((a, b) => String(b.postedAt || "").localeCompare(a.postedAt || "")).slice(0, 30);

  const pendRow = r => `<tr data-id="${r.id}">
    <td>${lfillFmt(r.date)}</td>
    <td>${escapeHtml(r.workshop || "Лазери")}</td>
    <td>${isAdmin ? `<input type="text" class="lf-code" data-id="${r.id}" value="${escapeAttr(r.code || "")}" list="lf-codes" style="width:110px" placeholder="код…" />` : `<b>${escapeHtml(r.code || "—")}</b>`}</td>
    <td>${escapeHtml(r.thickness || "")}</td>
    <td>${escapeHtml(r.name || "")}</td>
    <td class="num"><b>${erpNum(r.qty)}</b></td>
    <td>${escapeHtml(r.worker || "")}</td>
    <td class="erp-row-actions">
      ${isAdmin ? (function () {
        const nx = lfillNextOps(r);
        if (nx && nx.remaining.length) {
          const first = nx.remaining[0];
          return `<button class="btn btn-small btn-primary" data-post="${r.id}" title="Детайлът има още ${nx.remaining.length} операции. Пуска се по веригата от „${escapeAttr(first.operation || "")}" (цех ${escapeAttr(first.workshop || "")}); нарязването се отчита като готово.">🏭 Пусни в цеха (${nx.remaining.length} оп.)</button>`;
        }
        return `<button class="btn btn-small btn-primary" data-post="${r.id}" title="Последна операция — заприходява като готов детайл в Склад Детайли и изписва ламарината по рецептата">📥 Заприходи</button>`;
      })() : '<span class="erp-muted">чака код</span>'}
      ${isAdmin ? `<button class="btn btn-small btn-danger" data-del="${r.id}">×</button>` : ""}
    </td></tr>`;

  const newRow = i => `<tr class="lf-new">
    <td><input type="date" class="lfn-date" data-i="${i}" value="${lfillToday()}" style="width:125px" /></td>
    <td><input type="text" class="lfn-code" data-i="${i}" list="lf-codes" style="width:100px" placeholder="ако го знаеш" /></td>
    <td><input type="text" class="lfn-thick" data-i="${i}" style="width:70px" placeholder="напр. 3" /></td>
    <td><input type="text" class="lfn-name" data-i="${i}" style="min-width:150px;width:100%" placeholder="наименование / мостра / за нас" /></td>
    <td><input type="number" class="lfn-qty" data-i="${i}" min="0" step="1" style="width:65px" placeholder="бр." /></td>
    <td>${workerSel("lfn-worker", i, meWorker)}</td>
    <td></td></tr>`;

  const { wrap, close } = erpDialog(`
    <h3>🔥 ПЪЛНЕЖ — единични бройки от листовете (мостри / рязано за нас)</h3>
    <p class="hint" style="margin:0 0 8px">${isAdmin
      ? "Сложи КОД на чакащия ред. Ако детайлът има още операции — бутонът пуска бройката ПО ВЕРИГАТА от следващия цех (нарязването се отчита като готово). Ако лазерът е последната му операция — заприходява направо в Склад Детайли. Ламарината се изписва и в двата случая."
      : "Попълни каквото знаеш — кодът може да остане празен, офисът ще го сложи. Всяка бройка после се заприходява като готов детайл."}</p>
    <div class="lf-scroll">
    ${pending.length > LFILL_ALARM_OVER ? `<div class="lf-warn">🚨 Натрупали са се <b>${pending.length}</b> реда за заприходяване (${erpNum(pending.reduce((a, r) => a + (Number(r.qty) || 0), 0))} бр.). Докато не се заприходят, тази стока я няма в Склад детайли.</div>` : ""}
    <h4 class="erp-group-head">⏳ Чакащи заприходяване (${pending.length})</h4>
    ${pending.length ? `<table class="report-table erp-table"><thead><tr><th>Дата</th><th>Цех</th><th>Код</th><th>Дебелина</th><th>Наименование</th><th class="num">Брой</th><th>Служител</th><th></th></tr></thead>
      <tbody id="lf-pending">${pending.map(pendRow).join("")}</tbody></table>`
      : `<p class="hint">Няма чакащи редове. ${isAdmin ? "Когато лазерджиите запишат пълнеж, редовете излизат тук — слагаш код и заприходяваш." : "Попълни долу и натисни Запази."}</p>`}
    <h4 class="erp-group-head">➕ Нови редове</h4>
    <table class="report-table erp-table"><thead><tr><th>Дата</th><th>Код</th><th>Дебелина м-л</th><th>Наименование</th><th class="num">Брой</th><th>Служител</th><th></th></tr></thead>
      <tbody id="lf-new"></tbody></table>
    <button class="btn btn-small" id="lf-more">+ Още редове</button>
    ${isAdmin && posted.length ? `<h4 class="erp-group-head">✓ Обработени (последните ${posted.length})</h4>
      <table class="report-table erp-table"><tbody>${posted.map(r => `<tr><td>${lfillFmt(r.date)}</td><td>${escapeHtml(r.workshop || "Лазери")}</td><td><b>${escapeHtml(r.code || "")}</b></td><td>${escapeHtml(r.name || "")}</td><td class="num">${erpNum(r.qty)} бр.</td><td>${escapeHtml(r.worker || "")}</td><td class="erp-muted">${r.status === "в цех" ? "🏭 в цеха" : "📥 в склада"} · ${lfillFmt(r.postedAt)}</td></tr>`).join("")}</tbody></table>` : ""}
    </div>
    <datalist id="lf-codes">${(typeof ERP !== "undefined" && ERP.products ? ERP.products : []).slice(0, 4000).map(p => `<option value="${escapeAttr(p.code || "")}">${escapeAttr(p.name || "")}</option>`).join("")}</datalist>
    <div class="erp-dialog-actions"><button class="btn" id="lf-close">Затвори</button><button class="btn btn-primary" id="lf-save">💾 Запази новите редове</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-full");

  const newBody = wrap.querySelector("#lf-new");
  let rowCount = 0;
  const addRows = n => { let h = ""; for (let i = 0; i < n; i++) h += newRow(rowCount++); newBody.insertAdjacentHTML("beforeend", h); };
  addRows(NEW_ROWS);
  wrap.querySelector("#lf-more").addEventListener("click", () => addRows(5));
  wrap.querySelector("#lf-close").addEventListener("click", close);

  // Запис на новите редове (взимат се само попълнените).
  wrap.querySelector("#lf-save").addEventListener("click", async () => {
    const rows = [];
    newBody.querySelectorAll("tr").forEach(tr => {
      const g = cls => { const el = tr.querySelector("." + cls); return el ? el.value.trim() : ""; };
      const qty = Number(g("lfn-qty")) || 0;
      const name = g("lfn-name"), code = g("lfn-code");
      if (!qty || (!name && !code)) return;   // празен ред
      const worker = g("lfn-worker") || meWorker;
      rows.push({ id: 0, date: g("lfn-date") || lfillToday(), code, thickness: g("lfn-thick"), name, qty, worker, workshop: wsMine || workerToWs[worker] || "Лазери", status: "чакащ" });
    });
    if (!rows.length) { alert("Попълни поне един ред (наименование/код + брой)."); return; }
    await lfillLoad();
    rows.forEach(r => { r.id = lfillNextId(); LFILL.push(r); });
    if (await lfillSave()) { close(); try { await lfillAlarmRefresh(true); } catch (e) {} alert(`✅ Записани ${rows.length} реда. Офисът ще ги заприходи.`); }
  });

  if (!isAdmin) return;
  // Админ: код + заприходяване + изтриване.
  wrap.querySelectorAll(".lf-code").forEach(inp => inp.addEventListener("change", async () => {
    const r = (LFILL || []).find(x => x.id === Number(inp.dataset.id)); if (!r) return;
    r.code = inp.value.trim(); await lfillSave();
  }));
  wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    const r = (LFILL || []).find(x => x.id === Number(b.dataset.del)); if (!r) return;
    if (!confirm(`Да изтрия ли реда „${r.name || r.code}" (${r.qty} бр.)?`)) return;
    LFILL = LFILL.filter(x => x.id !== r.id);
    if (await lfillSave()) { try { await lfillAlarmRefresh(true); } catch (e) {} close(); openLaserFill(); }
  }));
  wrap.querySelectorAll("[data-post]").forEach(b => b.addEventListener("click", async () => {
    const r = (LFILL || []).find(x => x.id === Number(b.dataset.post)); if (!r) return;
    await lfillPost(r, () => { close(); openLaserFill(); });
  }));
}

/* ---------- Заприходяване (админ): готов детайл + изписване на ламарината ---------- */
// Материални нужди на 1 брой продукт по рецептата (рекурсивно, само материалите).
function lfillMaterialNeeds(pid) {
  const out = {};   // material_id -> количество за 1 брой
  const rec = (id, mult, anc) => {
    (ERP.linesByProduct[id] || []).forEach(l => {
      const q = mult * (Number(l.quantity) || 1);
      if (l.material_id) out[l.material_id] = (out[l.material_id] || 0) + q;
      else if (l.child_product_id && !anc.has(l.child_product_id)) rec(l.child_product_id, q, new Set([...anc, l.child_product_id]));
    });
  };
  rec(pid, 1, new Set([pid]));
  return out;
}
/* Какви операции има детайлът и коя е свършена на лазера/пресата.
   Връща { p, own, doneIdx, remaining } или null (ако ЕРП още не е зареден
   или кодът не се разпознава). */
function lfillNextOps(r) {
  if (typeof ERP === "undefined" || !ERP.products || typeof erpFlowSteps !== "function") return null;
  const code = String((r && r.code) || "").trim();
  if (!code) return null;
  const p = (ERP.products || []).find(x => String(x.code || "").trim() === code);
  if (!p) return null;
  let steps = [];
  try { steps = (erpFlowSteps({ erpProductId: p.id, erpQty: Number(r.qty) || 1 }, { toStockTop: true, noNetTop: true }) || {}).steps || []; }
  catch (e) { return null; }
  // Само операциите на САМИЯ детайл (вложените части си имат свои).
  const own = steps.filter(st => String(st.pid) === String(p.id)).sort((a, b) => (Number(a.step) || 0) - (Number(b.step) || 0));
  if (!own.length) return { p, own, doneIdx: -1, remaining: [] };
  let doneIdx = own.findIndex(st => String(st.workshop || "") === String(r.workshop || "Лазери"));
  if (doneIdx < 0) doneIdx = 0;   // пълнежът е първата операция
  return { p, own, doneIdx, remaining: own.slice(doneIdx + 1) };
}

// Изписване на материала по рецептата (ламарината за нарязаното).
async function lfillConsumeMaterial(p, qty, r) {
  const needs = lfillMaterialNeeds(p.id);
  const rows = Object.keys(needs).map(mid => ({
    material_id: Number(mid), kind: "изписване", quantity: -(needs[mid] * qty),
    ref: "пълнеж:" + r.id, note: "ПЪЛНЕЖ → " + (p.code || ""),
  }));
  if (!rows.length) return { ok: true, count: 0 };
  const c = await sb.from("stock_movements").insert(rows);
  if (c.error) return { ok: false, error: c.error.message, count: 0 };
  return { ok: true, count: rows.length };
}
function lfillNeedsText(p, qty) {
  const needs = lfillMaterialNeeds(p.id);
  return Object.keys(needs).map(mid => {
    const m = ERP.matById[mid] || {};
    return `• ${m.code || ""} ${m.name || "материал " + mid}: ${erpNum(needs[mid] * qty)} ${m.unit || ""}`;
  }).join("\n");
}

async function lfillPost(r, done) {
  if (typeof erpEnsureLoaded === "function") { try { await erpEnsureLoaded(); } catch (e) {} }
  const code = String(r.code || "").trim();
  if (!code) { alert("Първо въведи КОД на детайла (в колоната Код) — по него се заприходява."); return; }
  const p = (ERP.products || []).find(x => String(x.code || "").trim() === code);
  if (!p) { alert(`Няма продукт с код ${code} в ЕРП. Провери кода (или създай продукта).`); return; }
  const qty = Number(r.qty) || 0;
  if (!(qty > 0)) { alert("Невалиден брой."); return; }

  const nx = lfillNextOps(r);
  // Има ли още операции след тази на лазера/пресата?
  if (nx && nx.remaining.length) { await lfillToFlow(r, p, qty, nx, done); return; }

  // Последна (или единствена) операция → готовият детайл влиза в склада.
  const needTxt = lfillNeedsText(p, qty);
  if (!confirm(`Заприходявам „${p.code} ${p.name}" — ${qty} бр. в Склад Детайли (пълнеж от ${lfillFmt(r.date)}, ${r.worker || ""}).`
    + (nx && nx.own.length ? `\n\n(Няма следващи операции — това е готов детайл.)` : "")
    + (needTxt ? `\n\nОт склад Материали ще се изпише:\n${needTxt}` : "\n\n(Продуктът няма материали в рецептата — складът за материали не се пипа.)"))) return;

  const ref = "пълнеж:" + r.id;
  // 1) Готовият детайл влиза в Склад Детайли.
  const ins = await sb.from("product_movements").insert({ product_id: Number(p.id), kind: "заприходяване", quantity: qty, ref, note: `ПЪЛНЕЖ ${lfillFmt(r.date)} · ${r.worker || ""} · ${r.name || ""}`.trim() });
  if (ins.error) { alert("Грешка при заприходяване: " + ins.error.message + "\n(Пусни erp-detail-stock.sql, ако таблицата липсва.)"); return; }
  // 2) Ламарината (и другите материали по рецептата) се изписват от склад Материали.
  const mat = await lfillConsumeMaterial(p, qty, r);
  if (!mat.ok) alert("Детайлът е заприходен, но изписването на материала се провали: " + mat.error);

  r.status = "заприходен"; r.code = code; r.productId = p.id; r.postedAt = lfillToday();
  r.postedBy = (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "";
  await lfillSave();
  try { await lfillAlarmRefresh(true); } catch (e) {}
  try { if (typeof erpLoadAll === "function") await erpLoadAll(); } catch (e) {}
  alert(`✅ Готово: ${qty} бр. „${p.code}" са в Склад Детайли${mat.count ? " и материалът е изписан" : ""}.`);
  if (done) done();
}

/* ПЪЛНЕЖ → ВЕРИГАТА. Детайлът е само НАРЯЗАН — има още операции. Пуска се
   производство за склад по рецептата му, а вече свършените стъпки (тази на
   лазера/пресата и всичко преди нея) се отчитат веднага като готови. Така
   детайлът тръгва от следващия цех, а в Склад детайли влиза чак когато
   мине докрай — както всеки друг детайл. */
async function lfillToFlow(r, p, qty, nx, done) {
  const first = nx.remaining[0] || {};
  const doneOps = nx.own.slice(0, nx.doneIdx + 1);
  const needTxt = lfillNeedsText(p, qty);
  const msg = `„${p.code} ${p.name}" — ${qty} бр. от ПЪЛНЕЖ (${lfillFmt(r.date)}, ${r.worker || ""}).\n\n`
    + `Детайлът НЕ е готов — има още ${nx.remaining.length} ${nx.remaining.length === 1 ? "операция" : "операции"}:\n`
    + nx.remaining.map(st => `• ${st.operation || "?"} → ${st.workshop || "?"}`).join("\n")
    + `\n\nПускам го по веригата:\n`
    + `✓ отчита се като ГОТОВО: ${doneOps.map(st => (st.operation || "?") + " (" + (st.workshop || "?") + ")").join(", ")}\n`
    + `▶ тръгва от: ${first.operation || "?"} — цех ${first.workshop || "?"}\n`
    + `📥 в Склад детайли влиза чак след последната операция\n`
    + (needTxt ? `\n📦 От склад Материали се изписва:\n${needTxt}\n` : "")
    + `\nПродължавам?`;
  if (!confirm(msg)) return;

  if (typeof erpProduceToStock !== "function") { alert("Модулът за производство не е зареден. Презареди страницата."); return; }
  const res = await erpProduceToStock(p.id, qty, { clientName: "ПЪЛНЕЖ", orderNo: (p.code || "") + " · пълнеж " + lfillFmt(r.date) });
  if (!res || res.error) return;                       // erpProduceToStock вече е казал защо
  const sid = res.sampleId;

  // Отбелязваме свършените стъпки като произведени (за да тръгне следващата).
  let marked = 0;
  try {
    const { data } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
    const mine = (data || []).filter(x => {
      const src = ((x.data || {}).source) || {};
      return (src.orderIds || []).map(String).includes(String(sid))
        && String(src.code || "").trim() === String(p.code || "").trim()
        && (Number(src.step) || 0) <= nx.doneIdx;
    });
    for (const row of mine) {
      const d = row.data || {};
      const q = Number(d.qty) || 0;
      d.produced = q;
      d.logs = (d.logs || []).concat([{ date: r.date || lfillToday(), worker: r.worker || "", qty: q, notes: "ПЪЛНЕЖ — нарязано преди пускането" }]);
      const src = d.source || (d.source = {});
      // Материалът се изписва тук (долу), не при отчитане — за да не излезе два пъти.
      if ((Number(src.step) || 0) === 0) src.matConsumed = q;
      await sb.from("tasks").update({ data: d, done: q > 0, updated_at: new Date().toISOString() }).eq("id", row.id);
      marked++;
    }
  } catch (e) { alert("Веригата е пусната, но отчитането на нарязаното не мина: " + (e.message || e)); }

  // Материалът за нарязаното — изписва се веднъж, тук.
  const mat = await lfillConsumeMaterial(p, qty, r);
  if (!mat.ok) alert("Веригата е пусната, но изписването на материала се провали: " + mat.error);

  r.status = "в цех"; r.code = p.code; r.productId = p.id; r.chainId = sid;
  r.postedAt = lfillToday();
  r.postedBy = (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "";
  await lfillSave();
  try { await lfillAlarmRefresh(true); } catch (e) {}
  try { if (typeof erpLoadAll === "function") await erpLoadAll(); } catch (e) {}
  alert(`✅ Пуснато по веригата: ${qty} бр. „${p.code}".\n`
    + `• отчетени като готови: ${marked} ${marked === 1 ? "операция" : "операции"}\n`
    + `• чака в цех ${first.workshop || "?"} — ${first.operation || "?"}\n`
    + (mat.count ? `• материалът е изписан\n` : "")
    + `\nВ Склад детайли ще влезе, щом мине последната операция.`);
  if (done) done();
}

/* ---------- 🚨 АЛАРМА: натрупани детайли за заприходяване ----------
   Пълнежът е готова стока, която НЕ е в склада, докато някой не ѝ сложи кода
   и не я заприходи. Натрупа ли се, наличностите лъжат. Затова при повече от
   4 чакащи реда светва аларма (лента над списъка + мигащ брояч на бутона). */
const LFILL_ALARM_OVER = 4;          // „повече от 4" → алармата пали на 5-ия
let LFILL_ALARM_AT = 0;              // кога последно четохме (за да не удряме базата на всеки рендер)

function lfillPendingRows() { return (LFILL || []).filter(r => r.status !== "заприходен"); }

/* Опреснява брояча на бутона и лентата-аларма. force = чете базата наново. */
async function lfillAlarmRefresh(force) {
  const now = Date.now();
  if (force || !LFILL || (now - LFILL_ALARM_AT) > 60000) {
    try { await lfillLoad(); LFILL_ALARM_AT = now; } catch (e) { return; }
  }
  const rows = lfillPendingRows();
  const n = rows.length;
  const on = n > LFILL_ALARM_OVER;

  const b = document.getElementById("btn-laser-fill");
  if (b) {
    let bd = b.querySelector(".lf-badge");
    if (n > 0) {
      if (!bd) { bd = document.createElement("span"); bd.className = "msg-badge lf-badge"; b.appendChild(bd); }
      bd.textContent = String(n);
      bd.hidden = false;
      b.title = `${n} реда чакат заприходяване в ПЪЛНЕЖ`;
    } else if (bd) { bd.hidden = true; }
    b.classList.toggle("lf-alarm", on);
  }

  const host = document.getElementById("lfill-alarm");
  if (!host) return;
  // Лентата е за този, който заприходява (офиса). Служителят си вижда брояча.
  const isAdmin = !(typeof amWorker === "function" && amWorker());
  if (!on || !isAdmin) { host.hidden = true; host.innerHTML = ""; return; }
  const qty = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const noCode = rows.filter(r => !String(r.code || "").trim()).length;
  const chips = rows.slice(0, 8).map(r => `<span class="ua-chip">${escapeHtml(r.code || r.name || "—")} <span class="ua-op">${erpNum(r.qty)} бр.</span></span>`).join("");
  host.hidden = false;
  host.innerHTML = `
    <div class="ua-flash"><span class="ua-siren">🚨</span>
      <span class="ua-title">ПЪЛНЕЖ — ${n} детайла чакат заприходяване</span>
      <span class="ua-siren">🚨</span></div>
    <div class="ua-list">${chips}${rows.length > 8 ? `<span class="ua-more">+ още ${rows.length - 8}</span>` : ""}</div>
    <div class="ua-actions">
      <span style="display:block;margin-bottom:6px">Общо ${erpNum(qty)} бр. готова стока още НЕ е в Склад детайли${noCode ? ` · ${noCode} без код` : ""}.</span>
      <button type="button" class="btn btn-small" id="lf-alarm-open">🔥 Отвори ПЪЛНЕЖ и заприходи</button>
    </div>`;
  const ob = host.querySelector("#lf-alarm-open");
  if (ob) ob.addEventListener("click", openLaserFill);
}

/* ---------- Бутонът ---------- */
function laserFillInit() {
  const b = document.getElementById("btn-laser-fill");
  if (b) b.addEventListener("click", openLaserFill);
}
document.addEventListener("DOMContentLoaded", laserFillInit);
