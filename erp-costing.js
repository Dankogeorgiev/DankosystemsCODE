/* Данко Системс — ЕРП „Разходи и ставки" + реална себестойност.
   От справочните данни (машини, заплати, режийни) смята ставка €/час по цех
   (труд + машина + режийни). Връзва се с Времената: реалната себестойност на
   операция = време/брой × ставка, като ползва ставката на РЕАЛНАТА машина
   (по таблицата за свързване Времена↔разходи), с резерва „средно по цех".
   Конфигурацията се пази в app_config (id=cost_rates). */

// Начално свързване на имената: машина във „Времена" → машина в разходите.
// Празно / липсва → ползва се средната машинна ставка на цеха.
const DEFAULT_MACHINE_ALIAS = {
  "DURMA 6kw": "Лазер 1", "DURMA 3kw": "Лазер 2",
  "Gweike 3kw": "Лазер LF3015GA 1", "Gweike 3kw 1": "Лазер LF3015GA 1", "Gweike 3kw 2": "Лазер LF3015GA 2",
  "Gweike combi": "Тръбен лазер", "Gweike Tube": "Тръбен лазер",
  "DURMA щанца": "CNC щанца",
  "Swiss Type 1": "Автоматичен CNC струг 1", "Swiss Type 2": "Автоматичен CNC струг 2",
  "VMC966": "CNC фреза / обработващ център 1", "VMC850": "CNC фреза / обработващ център 2",
  "Автоматична Преса 1": "Автоматична пресова линия ЕП63 + Decoiler",
};

let COST_CFG = null;

async function erpLoadCostCfg() {
  if (COST_CFG) return COST_CFG;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "cost_rates").maybeSingle();
    if (data && data.data && data.data.params) COST_CFG = data.data;
  } catch (e) {}
  if (!COST_CFG) COST_CFG = JSON.parse(JSON.stringify(COST_SEED));
  COST_CFG.params = Object.assign({}, COST_SEED.params, COST_CFG.params || {});
  COST_CFG.prodWorkshops = COST_CFG.prodWorkshops || COST_SEED.prodWorkshops;
  COST_CFG.machines = COST_CFG.machines || COST_SEED.machines;
  COST_CFG.employees = COST_CFG.employees || COST_SEED.employees;
  COST_CFG.machineAlias = Object.assign({}, DEFAULT_MACHINE_ALIAS, COST_CFG.machineAlias || {});
  return COST_CFG;
}
async function erpSaveCostCfg() {
  const { error } = await sb.from("app_config").upsert({ id: "cost_rates", data: COST_CFG, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

// Ставки: труд/машина(средно)/режийни/обща по цех + машинна ставка по име.
function erpCostRates(cfg) {
  cfg = cfg || COST_CFG || COST_SEED;
  const p = cfg.params;
  const hpm = p.hoursPerDay * p.daysPerMonth * p.utilization;
  const hpy = p.hoursPerDay * p.daysPerMonth * 12 * p.utilization;
  const load = p.salaryHasSocial ? 1 : (Number(p.socialLoad) || 1.2);
  const ws = cfg.prodWorkshops;
  const labor = {}, count = {}, mSum = {}, mCnt = {}, machineRate = {};
  ws.forEach(w => { labor[w] = 0; count[w] = 0; mSum[w] = 0; mCnt[w] = 0; });
  // Само служители с въведена заплата участват в ставката (добавените само за
  // седмичния отчет, без заплата, не изкривяват себестойността).
  (cfg.employees || []).forEach(e => { const pay = Number(e.pay) || 0; if (labor[e.ws] !== undefined && pay > 0) { labor[e.ws] += pay; count[e.ws]++; } });
  (cfg.machines || []).forEach(m => {
    const r = (Number(m.deprAnnual || 0) + Number(m.maint || 0)) / hpy + Number(m.kwh || 0) * p.elec;
    machineRate[m.name] = r;
    if (mSum[m.ws] !== undefined) { mSum[m.ws] += r; mCnt[m.ws]++; }
  });
  const prodWorkers = ws.reduce((n, w) => n + count[w], 0);
  const overheadRate = (prodWorkers > 0 && hpm > 0) ? p.overheadMonthly / (prodWorkers * hpm) : 0;
  const rate = {};
  ws.forEach(w => {
    const laborRate = count[w] > 0 && hpm > 0 ? (labor[w] / count[w] * load) / hpm : 0;
    const machAvg = mCnt[w] > 0 ? mSum[w] / mCnt[w] : 0;
    rate[w] = { labor: laborRate, machine: machAvg, overhead: overheadRate, full: laborRate + machAvg + overheadRate, workers: count[w], machines: mCnt[w] };
  });
  return { rate, machineRate, overheadRate, prodWorkers, hpm, hpy };
}

// Машинна ставка за име от „Времена": по свързването → конкретна машина; иначе средно по цех.
function erpMachineRateFor(machineName, ws, R) {
  const alias = (COST_CFG && COST_CFG.machineAlias && COST_CFG.machineAlias[machineName]) || "";
  const target = alias || machineName;
  if (target && R.machineRate[target] != null) return R.machineRate[target];
  return (R.rate[ws] ? R.rate[ws].machine : 0);
}

function erpTimePerPiece(r) {
  if (r.tPiece && r.tPiece.sec) return r.tPiece.sec;
  if (r.tOrder && r.tOrder.sec && (Number(r.qty) || 0) > 0) return r.tOrder.sec / Number(r.qty);
  return null;
}

// Реална себестойност на 1 брой по операция (име) — от Времената, с ставката
// на реалната машина. Връща { opName: €/брой }.
function erpOpUnitCost(R) {
  R = R || erpCostRates();
  const rows = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const m = {};
  rows.forEach(r => {
    const pp = erpTimePerPiece(r); if (pp == null) return;
    const ws = r.workshop || "";
    const lr = R.rate[ws] ? R.rate[ws].labor : 0;
    const mr = erpMachineRateFor(r.machine || "", ws, R);
    const full = lr + mr + R.overheadRate;
    const q = Number(r.qty) || 1;
    const g = m[r.operation || ""] || (m[r.operation || ""] = { cost: 0, q: 0 });
    g.cost += pp / 3600 * full * q; g.q += q;
  });
  const out = {};
  Object.keys(m).forEach(k => { if (m[k].q > 0) out[k] = m[k].cost / m[k].q; });
  return out;
}

// Реална себестойност на продукт (за 1 брой): материали + операции, рекурсивно.
function erpRealCost(pid, opCost, anc) {
  opCost = opCost || erpOpUnitCost();
  anc = anc || new Set([pid]);
  let material = 0, opcost = 0, opsCovered = 0, opsTotal = 0;
  (ERP.linesByProduct[pid] || []).forEach(l => {
    const q = Number(l.quantity) || 1;
    if (l.material_id) {
      material += q * (Number((ERP.matById[l.material_id] || {}).avg_cost) || 0);
    } else if (l.operation_id) {
      const op = ERP.opById[l.operation_id] || {};
      opsTotal++;
      const c = opCost[op.name || ""];
      if (c != null) { opcost += q * c; opsCovered++; }
    } else if (l.child_product_id && !anc.has(l.child_product_id)) {
      const s = erpRealCost(l.child_product_id, opCost, new Set([...anc, l.child_product_id]));
      material += q * s.material; opcost += q * s.opcost;
      opsCovered += s.opsCovered; opsTotal += s.opsTotal;
    }
  });
  return { material, opcost, cost: material + opcost, opsCovered, opsTotal };
}

// Всички имена на машини, познати във „Времена" (за таблицата за свързване).
function erpVremenaMachines() {
  const set = new Set();
  if (typeof MACHINES_BY_WORKSHOP === "object") Object.values(MACHINES_BY_WORKSHOP).forEach(a => (a || []).forEach(x => set.add(x)));
  if (typeof FIELDS_BY_WORKER === "object") Object.values(FIELDS_BY_WORKER || {}).forEach(w => {
    if (w.byMachine) Object.keys(w.byMachine).forEach(x => set.add(x));
    if (w.byWorkshop) Object.values(w.byWorkshop).forEach(c => { if (Array.isArray(c.machines)) c.machines.forEach(x => set.add(x)); });
  });
  if (typeof collectTimeRows === "function") collectTimeRows().forEach(r => { if (r.machine) set.add(r.machine); });
  return [...set].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), "bg"));
}

// Записва реалните себестойности (време × ставка) в операциите (operations.unit_cost),
// за да ги отразят рецептите и себестойността навсякъде. Обновяват се само
// операциите с измерено време.
async function erpApplyOpCosts(statusEl) {
  const R = erpCostRates();
  const opCost = erpOpUnitCost(R);
  const ups = [];
  (ERP.operations || []).forEach(op => {
    const c = opCost[op.name || ""];
    if (c != null) ups.push({ id: op.id, unit_cost: Math.round(c * 10000) / 10000, name: op.name });
  });
  if (!ups.length) { alert("Още няма измерени времена, за да се сметнат себестойности на операции. Първо цеховете да отчетат време."); return; }
  if (!confirm(`Ще запиша реалната себестойност (труд+машина+режийни) на ${ups.length} операции в рецептите. Това презаписва досегашните им стойности. Да продължа?`)) return;
  let done = 0;
  for (const u of ups) {
    const { error } = await sb.from("operations").update({ unit_cost: u.unit_cost }).eq("id", u.id);
    if (error) { alert("Грешка при операция " + (u.name || "") + ": " + error.message); return; }
    done++;
    if (statusEl) statusEl.textContent = `Записва… ${done}/${ups.length}`;
  }
  await erpLoadAll();   // опреснява себестойностите (v_product_cost)
  if (statusEl) statusEl.textContent = "✓ Записано";
  alert(`Готово! Записани себестойности за ${done} операции. Рецептите и маржинът вече ги отразяват.`);
}

/* ---------- Екран „Разходи и ставки" ---------- */
async function erpRenderCostRates(host) {
  const v = host || erpView();
  await erpLoadCostCfg();
  const p = COST_CFG.params;
  const R = erpCostRates();
  const { rate, overheadRate, prodWorkers, hpm } = R;
  const ws = COST_CFG.prodWorkshops;
  const money = n => (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vremena = erpVremenaMachines();
  const costMachines = (COST_CFG.machines || []).map(m => m.name);

  v.innerHTML = `
    <div class="cost-params">
      <h4 class="erp-group-head">Параметри за ставките</h4>
      <div class="cost-grid">
        <label>Часове/ден <input type="number" id="cp-hpd" step="any" value="${p.hoursPerDay}" /></label>
        <label>Дни/месец <input type="number" id="cp-dpm" step="any" value="${p.daysPerMonth}" /></label>
        <label>Натовареност (0–1) <input type="number" id="cp-util" step="any" min="0" max="1" value="${p.utilization}" /></label>
        <label>Ток €/kWh <input type="number" id="cp-elec" step="any" value="${p.elec}" /></label>
        <label>Режийни €/мес <input type="number" id="cp-oh" step="any" value="${p.overheadMonthly}" /></label>
        <label class="cost-chk"><input type="checkbox" id="cp-soc" ${p.salaryHasSocial ? "checked" : ""} /> Заплатите включват осигуровки</label>
      </div>
      <p class="hint">Продуктивни часове/мес: <b>${money(hpm)}</b> · произв. работници: <b>${prodWorkers}</b> · режийни: <b>${money(overheadRate)} €/ч</b></p>
    </div>

    <details class="cost-details"><summary>💶 Ставка на час по цех</summary>
    <table class="report-table erp-table cost-rate-table">
      <thead><tr><th>Цех</th><th class="num">Работници</th><th class="num">Машини</th><th class="num">Труд €/ч</th><th class="num">Машина (ср) €/ч</th><th class="num">Режийни €/ч</th><th class="num">Обща ставка €/ч</th></tr></thead>
      <tbody>${ws.map(w => { const r = rate[w]; return `<tr>
        <td><b>${escapeHtml(w)}</b></td><td class="num">${r.workers}</td><td class="num">${r.machines}</td>
        <td class="num">${money(r.labor)}</td><td class="num">${money(r.machine)}</td><td class="num">${money(r.overhead)}</td>
        <td class="num"><b>${money(r.full)}</b></td></tr>`; }).join("")}</tbody>
    </table>
    <p class="hint">Себестойност на операция = време за 1 брой (Времена) × (труд + ставка на реалната машина + режийни). Соларите не се смятат (отделна инвестиция).</p>
    </details>

    <details class="cost-details"><summary>🔗 Свързване на машини (Времена ↔ разходи) — за точна машинна ставка</summary>
      <table class="report-table erp-table"><thead><tr><th>Машина във „Времена"</th><th>= машина от разходите</th><th class="num">€/ч на машината</th></tr></thead>
      <tbody>${vremena.map(nm => {
        const cur = (COST_CFG.machineAlias[nm] || "");
        const eff = cur || nm;
        const mr = R.machineRate[eff];
        return `<tr>
          <td>${escapeHtml(nm)}</td>
          <td><select class="cost-alias" data-nm="${escapeAttr(nm)}"><option value="">— средно по цех —</option>${costMachines.map(cm => `<option value="${escapeAttr(cm)}" ${cm === cur ? "selected" : ""}>${escapeHtml(cm)}</option>`).join("")}</select></td>
          <td class="num">${mr != null ? money(mr) : '<span class="muted">средно</span>'}</td></tr>`;
      }).join("") || `<tr><td colspan="3" class="report-empty">Няма машини за свързване.</td></tr>`}</tbody></table>
      <p class="hint">Където не е свързано, се ползва средната машинна ставка на цеха. Свържи каквото знаеш — колкото повече, толкова по-точна е себестойността.</p>
    </details>

    <details class="cost-details"><summary>🏭 Машини (${(COST_CFG.machines || []).length})</summary>
      <table class="report-table erp-table"><thead><tr><th>Машина</th><th>Цех</th><th class="num">Год. аморт.</th><th class="num">Поддр./год</th><th class="num">kWh/ч</th><th class="num">€/ч</th></tr></thead>
      <tbody>${(COST_CFG.machines || []).map(m => `<tr>
        <td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.ws)}</td><td class="num">${money(m.deprAnnual)}</td><td class="num">${money(m.maint)}</td><td class="num">${money(m.kwh)}</td><td class="num">${money(R.machineRate[m.name])}</td></tr>`).join("")}</tbody></table>
    </details>

    <details class="cost-details"><summary>👥 Досие на служители (${(COST_CFG.employees || []).length}) — натисни за преглед/редакция</summary>
      <table class="report-table erp-table"><thead><tr><th>Служител</th><th>Цех</th><th class="num">Заплата €/мес</th><th>Длъжност</th><th></th></tr></thead>
      <tbody>${(COST_CFG.employees || []).map(e => { const d = erpDossierMerged(e); const has = d.position || d.operations || d.phone; return `<tr class="erp-clickable" data-emp="${escapeAttr(e.name || "")}"><td><b>${escapeHtml(e.name || "")}</b></td><td>${escapeHtml(e.ws || "")}</td><td class="num">${money(e.pay)}</td><td>${escapeHtml(d.position || e.role || "")}</td><td class="erp-row-actions">${has ? "📄" : "✎"}</td></tr>`; }).join("")}</tbody></table>
    </details>

    <div class="erp-co-linebar"><button class="btn btn-small" id="cp-apply">📥 Запиши себестойностите в операциите (рецепти)</button><span class="spacer"></span><button class="btn btn-small btn-primary" id="cp-save">💾 Запази</button><span class="save-status" id="cp-status"></span></div>
    <p class="hint">„Запиши в операциите" презаписва себестойността на операциите (unit_cost) с реалната (време × ставка), за да я отразят рецептите и калкулациите. Прави се когато решиш да обновиш — не автоматично.</p>`;

  const upd = () => {
    p.hoursPerDay = erpToNum(v.querySelector("#cp-hpd").value) || 7.5;
    p.daysPerMonth = erpToNum(v.querySelector("#cp-dpm").value) || 21;
    p.utilization = erpToNum(v.querySelector("#cp-util").value) || 0.75;
    p.elec = erpToNum(v.querySelector("#cp-elec").value) || 0;
    p.overheadMonthly = erpToNum(v.querySelector("#cp-oh").value) || 0;
    p.salaryHasSocial = v.querySelector("#cp-soc").checked;
    erpRenderCostRates(v);
  };
  ["cp-hpd", "cp-dpm", "cp-util", "cp-elec", "cp-oh"].forEach(id => v.querySelector("#" + id).addEventListener("change", upd));
  v.querySelector("#cp-soc").addEventListener("change", upd);
  v.querySelectorAll(".cost-alias").forEach(sel => sel.addEventListener("change", () => {
    const nm = sel.dataset.nm;
    if (sel.value) COST_CFG.machineAlias[nm] = sel.value; else delete COST_CFG.machineAlias[nm];
    erpRenderCostRates(v);
  }));
  v.querySelector("#cp-save").addEventListener("click", async () => {
    const st = v.querySelector("#cp-status"); st.textContent = "Записва…";
    const ok = await erpSaveCostCfg();
    st.textContent = ok ? "✓ Записано" : "";
    setTimeout(() => { if (st) st.textContent = ""; }, 1500);
  });
  v.querySelector("#cp-apply").addEventListener("click", () => erpApplyOpCosts(v.querySelector("#cp-status")));
  v.querySelectorAll("[data-emp]").forEach(tr => tr.addEventListener("click", () => {
    const e = (COST_CFG.employees || []).find(x => x.name === tr.dataset.emp) || { name: tr.dataset.emp };
    erpShowDossier(e, v);
  }));
}

// Полета на досието (редактируеми).
const DOSSIER_FIELDS = [
  { k: "position", l: "Длъжност", t: "text" },
  { k: "phone", l: "Телефон", t: "text" },
  { k: "birth", l: "Рождена дата", t: "date" },
  { k: "family", l: "Семеен статус", t: "text" },
  { k: "children", l: "Деца", t: "text" },
  { k: "operations", l: "Операции / какво извършва", t: "area" },
  { k: "responsibilities", l: "Отговорности", t: "area" },
  { k: "needs", l: "От какво има нужда", t: "area" },
  { k: "ideas", l: "Идеи за подобрение", t: "area" },
  { k: "dislikes", l: "Какво не обича да прави", t: "area" },
  { k: "opinion", l: "Лично мнение", t: "area" },
];

// Намира базовото досие по име (съвпадение по първо и последно име).
function erpDossierFor(name) {
  if (typeof DOSSIER_SEED === "undefined") return null;
  const toks = String(name || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const first = toks[0], last = toks[toks.length - 1];
  return DOSSIER_SEED.find(d => { const dn = String(d.name || "").toLowerCase(); return dn.includes(first) && dn.includes(last); }) || null;
}
// Базово досие (от файловете) + ръчните редакции на служителя.
function erpDossierMerged(emp) {
  return Object.assign({}, (erpDossierFor(emp && emp.name) || {}), (emp && emp.dossier) || {});
}

// Показва и позволява РЕДАКЦИЯ на досието; записва се в конфигурацията (app_config).
function erpShowDossier(emp, host) {
  emp = emp || {};
  const d = erpDossierMerged(emp);
  const money = n => (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const field = f => {
    const val = d[f.k] != null ? String(d[f.k]) : "";
    if (f.t === "area") return `<label class="dos-edit">${f.l}<textarea id="dos-${f.k}" rows="2">${escapeHtml(val)}</textarea></label>`;
    return `<label class="dos-edit">${f.l}<input type="${f.t}" id="dos-${f.k}" value="${escapeAttr(val)}" /></label>`;
  };
  const { wrap, close } = erpDialog(`
    <h3>📄 ${escapeHtml(emp.name || "")}</h3>
    ${(emp.pay != null && emp.pay !== "") ? `<p class="dos-pay">Заплата (нето): <b>${money(emp.pay)} €/мес</b> <span class="erp-muted">(сменя се в списъка със ставки)</span></p>` : ""}
    ${DOSSIER_FIELDS.map(field).join("")}
    <div class="erp-dialog-actions">
      <button class="btn" id="dos-cancel">Отказ</button>
      <button class="btn btn-primary" id="dos-save">💾 Запази</button>
      <span class="save-status" id="dos-status"></span>
    </div>`);
  wrap.querySelector("#dos-cancel").addEventListener("click", close);
  wrap.querySelector("#dos-save").addEventListener("click", async () => {
    const st = wrap.querySelector("#dos-status"); st.textContent = "Записва…";
    // Гарантираме, че редактираме реалния запис в списъка.
    let target = (COST_CFG.employees || []).find(x => x.name === emp.name);
    if (!target) { target = { name: emp.name, ws: emp.ws || "", pay: emp.pay || 0 }; (COST_CFG.employees = COST_CFG.employees || []).push(target); }
    target.dossier = target.dossier || {};
    DOSSIER_FIELDS.forEach(f => { target.dossier[f.k] = wrap.querySelector("#dos-" + f.k).value.trim(); });
    const ok = await erpSaveCostCfg();
    st.textContent = ok ? "✓ Записано" : "";
    setTimeout(() => { close(); if (host && typeof erpRenderCostRates === "function") erpRenderCostRates(host); }, 700);
  });
}
