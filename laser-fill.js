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
  const meWorker = (typeof MY_WORKER !== "undefined" && MY_WORKER) || "";
  const NEW_ROWS = 10;
  // Служителите на Лазерите — от настройката на цеха; резерва: тримата по подразбиране.
  const LASER_WORKERS = ((typeof WORKERS !== "undefined" && WORKERS && WORKERS["Лазери"]) || []).length
    ? WORKERS["Лазери"].slice()
    : ["Костадин Алвантов", "Димитър", "Кръстьо"];
  const workerSel = (cls, i, val) => `<select class="${cls}" data-i="${i}" style="width:150px">
    <option value="">— избери —</option>
    ${LASER_WORKERS.map(n => `<option ${n === val ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")}
  </select>`;

  const pending = (LFILL || []).filter(r => r.status !== "заприходен").sort((a, b) => String(b.date || "").localeCompare(a.date || ""));
  const posted = (LFILL || []).filter(r => r.status === "заприходен").sort((a, b) => String(b.postedAt || "").localeCompare(a.postedAt || "")).slice(0, 30);

  const pendRow = r => `<tr data-id="${r.id}">
    <td>${lfillFmt(r.date)}</td>
    <td>${isAdmin ? `<input type="text" class="lf-code" data-id="${r.id}" value="${escapeAttr(r.code || "")}" list="lf-codes" style="width:110px" placeholder="код…" />` : `<b>${escapeHtml(r.code || "—")}</b>`}</td>
    <td>${escapeHtml(r.thickness || "")}</td>
    <td>${escapeHtml(r.name || "")}</td>
    <td class="num"><b>${erpNum(r.qty)}</b></td>
    <td>${escapeHtml(r.worker || "")}</td>
    <td class="erp-row-actions">
      ${isAdmin ? `<button class="btn btn-small btn-primary" data-post="${r.id}" title="Заприходява като готов детайл в Склад Детайли и изписва ламарината по рецептата">📥 Заприходи</button>` : '<span class="erp-muted">чака код</span>'}
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
      ? "Сложи КОД на чакащия ред и натисни 📥 Заприходи — бройката влиза в Склад Детайли, а ламарината се изписва от Материали."
      : "Попълни каквото знаеш — кодът може да остане празен, офисът ще го сложи. Всяка бройка после се заприходява като готов детайл."}</p>
    <div class="lf-scroll">
    <h4 class="erp-group-head">⏳ Чакащи заприходяване (${pending.length})</h4>
    ${pending.length ? `<table class="report-table erp-table"><thead><tr><th>Дата</th><th>Код</th><th>Дебелина</th><th>Наименование</th><th class="num">Брой</th><th>Служител</th><th></th></tr></thead>
      <tbody id="lf-pending">${pending.map(pendRow).join("")}</tbody></table>`
      : `<p class="hint">Няма чакащи редове. ${isAdmin ? "Когато лазерджиите запишат пълнеж, редовете излизат тук — слагаш код и заприходяваш." : "Попълни долу и натисни Запази."}</p>`}
    <h4 class="erp-group-head">➕ Нови редове</h4>
    <table class="report-table erp-table"><thead><tr><th>Дата</th><th>Код</th><th>Дебелина м-л</th><th>Наименование</th><th class="num">Брой</th><th>Служител</th><th></th></tr></thead>
      <tbody id="lf-new"></tbody></table>
    <button class="btn btn-small" id="lf-more">+ Още редове</button>
    ${isAdmin && posted.length ? `<h4 class="erp-group-head">✓ Заприходени (последните ${posted.length})</h4>
      <table class="report-table erp-table"><tbody>${posted.map(r => `<tr><td>${lfillFmt(r.date)}</td><td><b>${escapeHtml(r.code || "")}</b></td><td>${escapeHtml(r.name || "")}</td><td class="num">${erpNum(r.qty)} бр.</td><td>${escapeHtml(r.worker || "")}</td><td class="erp-muted">✓ ${lfillFmt(r.postedAt)}</td></tr>`).join("")}</tbody></table>` : ""}
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
      rows.push({ id: 0, date: g("lfn-date") || lfillToday(), code, thickness: g("lfn-thick"), name, qty, worker: g("lfn-worker") || meWorker, status: "чакащ" });
    });
    if (!rows.length) { alert("Попълни поне един ред (наименование/код + брой)."); return; }
    await lfillLoad();
    rows.forEach(r => { r.id = lfillNextId(); LFILL.push(r); });
    if (await lfillSave()) { close(); alert(`✅ Записани ${rows.length} реда. Офисът ще ги заприходи.`); }
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
    if (await lfillSave()) { close(); openLaserFill(); }
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
async function lfillPost(r, done) {
  if (typeof erpEnsureLoaded === "function") { try { await erpEnsureLoaded(); } catch (e) {} }
  const code = String(r.code || "").trim();
  if (!code) { alert("Първо въведи КОД на детайла (в колоната Код) — по него се заприходява."); return; }
  const p = (ERP.products || []).find(x => String(x.code || "").trim() === code);
  if (!p) { alert(`Няма продукт с код ${code} в ЕРП. Провери кода (или създай продукта).`); return; }
  const qty = Number(r.qty) || 0;
  if (!(qty > 0)) { alert("Невалиден брой."); return; }
  const needs = lfillMaterialNeeds(p.id);
  const needTxt = Object.keys(needs).map(mid => {
    const m = ERP.matById[mid] || {};
    return `• ${m.code || ""} ${m.name || "материал " + mid}: ${erpNum(needs[mid] * qty)} ${m.unit || ""}`;
  }).join("\n");
  if (!confirm(`Заприходявам „${p.code} ${p.name}" — ${qty} бр. в Склад Детайли (пълнеж от ${lfillFmt(r.date)}, ${r.worker || ""}).`
    + (needTxt ? `\n\nОт склад Материали ще се изпише:\n${needTxt}` : "\n\n(Продуктът няма материали в рецептата — складът за материали не се пипа.)"))) return;

  const ref = "пълнеж:" + r.id;
  // 1) Готовият детайл влиза в Склад Детайли.
  const ins = await sb.from("product_movements").insert({ product_id: Number(p.id), kind: "заприходяване", quantity: qty, ref, note: `ПЪЛНЕЖ ${lfillFmt(r.date)} · ${r.worker || ""} · ${r.name || ""}`.trim() });
  if (ins.error) { alert("Грешка при заприходяване: " + ins.error.message + "\n(Пусни erp-detail-stock.sql, ако таблицата липсва.)"); return; }
  // 2) Ламарината (и другите материали по рецептата) се изписват от склад Материали.
  const rows = Object.keys(needs).map(mid => ({ material_id: Number(mid), kind: "изписване", quantity: -(needs[mid] * qty), ref, note: "ПЪЛНЕЖ → " + (p.code || "") }));
  if (rows.length) { const c = await sb.from("stock_movements").insert(rows); if (c.error) { alert("Детайлът е заприходен, но изписването на материала се провали: " + c.error.message); } }

  r.status = "заприходен"; r.code = code; r.productId = p.id; r.postedAt = lfillToday();
  r.postedBy = (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "";
  await lfillSave();
  try { if (typeof erpLoadAll === "function") await erpLoadAll(); } catch (e) {}
  alert(`✅ Готово: ${qty} бр. „${p.code}" са в Склад Детайли${rows.length ? " и материалът е изписан" : ""}.`);
  if (done) done();
}

/* ---------- Бутонът ---------- */
function laserFillInit() {
  const b = document.getElementById("btn-laser-fill");
  if (b) b.addEventListener("click", openLaserFill);
}
document.addEventListener("DOMContentLoaded", laserFillInit);
