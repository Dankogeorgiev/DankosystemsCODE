/* Данко Системс — ЕРП „Разходи и ставки" + реална себестойност.
   От справочните данни (машини, заплати, режийни) смята ставка €/час по цех
   (труд + средна машина + режийни) и я връзва с Времената:
   реална себестойност на операция = време/брой × ставка на цеха.
   Оттам идва реалният маржин. Конфигурацията се пази в app_config (id=cost_rates). */

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
  return COST_CFG;
}
async function erpSaveCostCfg() {
  const { error } = await sb.from("app_config").upsert({ id: "cost_rates", data: COST_CFG, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}

// Ставки от конфигурацията: труд/машина/режийни/обща по цех.
function erpCostRates(cfg) {
  cfg = cfg || COST_CFG || COST_SEED;
  const p = cfg.params;
  const hpm = p.hoursPerDay * p.daysPerMonth * p.utilization;
  const hpy = p.hoursPerDay * p.daysPerMonth * 12 * p.utilization;
  const load = p.salaryHasSocial ? 1 : (Number(p.socialLoad) || 1.2);
  const ws = cfg.prodWorkshops;
  const labor = {}, count = {}, mSum = {}, mCnt = {};
  ws.forEach(w => { labor[w] = 0; count[w] = 0; mSum[w] = 0; mCnt[w] = 0; });
  (cfg.employees || []).forEach(e => { if (labor[e.ws] !== undefined) { labor[e.ws] += Number(e.pay) || 0; count[e.ws]++; } });
  (cfg.machines || []).forEach(m => {
    if (mSum[m.ws] === undefined) return;
    mSum[m.ws] += (Number(m.deprAnnual || 0) + Number(m.maint || 0)) / hpy + Number(m.kwh || 0) * p.elec;
    mCnt[m.ws]++;
  });
  const prodWorkers = ws.reduce((n, w) => n + count[w], 0);
  const overheadRate = (prodWorkers > 0 && hpm > 0) ? p.overheadMonthly / (prodWorkers * hpm) : 0;
  const rate = {};
  ws.forEach(w => {
    const laborRate = count[w] > 0 && hpm > 0 ? (labor[w] / count[w] * load) / hpm : 0;
    const machineRate = mCnt[w] > 0 ? mSum[w] / mCnt[w] : 0;
    rate[w] = { labor: laborRate, machine: machineRate, overhead: overheadRate, full: laborRate + machineRate + overheadRate, workers: count[w], machines: mCnt[w] };
  });
  return { rate, overheadRate, prodWorkers, hpm, hpy };
}

// Средно време за 1 брой по операция (име) от Времената.
function erpOpAvgSec() {
  const rows = (typeof collectTimeRows === "function") ? collectTimeRows() : [];
  const m = {};
  rows.forEach(r => {
    let pp = null;
    if (r.tPiece && r.tPiece.sec) pp = r.tPiece.sec;
    else if (r.tOrder && r.tOrder.sec && (Number(r.qty) || 0) > 0) pp = r.tOrder.sec / Number(r.qty);
    if (pp == null) return;
    const g = m[r.operation || ""] || (m[r.operation || ""] = { sum: 0, q: 0 });
    const q = Number(r.qty) || 1; g.sum += pp * q; g.q += q;
  });
  const out = {};
  Object.keys(m).forEach(k => { if (m[k].q > 0) out[k] = m[k].sum / m[k].q; });
  return out;
}

// Реална себестойност на продукт (за 1 брой): материали + операции (време×ставка),
// рекурсивно през възлите. Връща { material, opcost, cost, opsCovered, opsTotal }.
function erpRealCost(pid, rates, opSec, anc) {
  rates = rates || erpCostRates().rate;
  opSec = opSec || erpOpAvgSec();
  anc = anc || new Set([pid]);
  const route = op => (typeof erpEffectiveRoute === "function") ? erpEffectiveRoute(op) : { primary: op.workshop || "" };
  let material = 0, opcost = 0, opsCovered = 0, opsTotal = 0;
  (ERP.linesByProduct[pid] || []).forEach(l => {
    const q = Number(l.quantity) || 1;
    if (l.material_id) {
      material += q * (Number((ERP.matById[l.material_id] || {}).avg_cost) || 0);
    } else if (l.operation_id) {
      const op = ERP.opById[l.operation_id] || {};
      const wsn = (route(op).primary) || op.workshop || "";
      const r = rates[wsn]; const sec = opSec[op.name || ""];
      opsTotal++;
      if (r && sec != null) { opcost += q * (sec / 3600) * r.full; opsCovered++; }
    } else if (l.child_product_id && !anc.has(l.child_product_id)) {
      const s = erpRealCost(l.child_product_id, rates, opSec, new Set([...anc, l.child_product_id]));
      material += q * s.material; opcost += q * s.opcost;
      opsCovered += s.opsCovered; opsTotal += s.opsTotal;
    }
  });
  return { material, opcost, cost: material + opcost, opsCovered, opsTotal };
}

/* ---------- Екран „Разходи и ставки" ---------- */
async function erpRenderCostRates(host) {
  const v = host || erpView();
  await erpLoadCostCfg();
  const p = COST_CFG.params;
  const { rate, overheadRate, prodWorkers, hpm } = erpCostRates();
  const ws = COST_CFG.prodWorkshops;
  const money = n => (Number(n) || 0).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

    <h4 class="erp-group-head">Ставка на час по цех</h4>
    <table class="report-table erp-table cost-rate-table">
      <thead><tr><th>Цех</th><th class="num">Работници</th><th class="num">Машини</th><th class="num">Труд €/ч</th><th class="num">Машина €/ч</th><th class="num">Режийни €/ч</th><th class="num">Обща ставка €/ч</th></tr></thead>
      <tbody>${ws.map(w => { const r = rate[w]; return `<tr>
        <td><b>${escapeHtml(w)}</b></td><td class="num">${r.workers}</td><td class="num">${r.machines}</td>
        <td class="num">${money(r.labor)}</td><td class="num">${money(r.machine)}</td><td class="num">${money(r.overhead)}</td>
        <td class="num"><b>${money(r.full)}</b></td></tr>`; }).join("")}</tbody>
    </table>
    <p class="hint">Себестойност на операция = време за 1 брой (от „Времена") × обща ставка на цеха. Машинната ставка е средна за машините в цеха; амортизация + поддръжка + ток (соларите са отделна инвестиция и не се смятат).</p>

    <details class="cost-details"><summary>🏭 Машини (${(COST_CFG.machines || []).length})</summary>
      <table class="report-table erp-table"><thead><tr><th>Машина</th><th>Цех</th><th class="num">Год. аморт.</th><th class="num">Поддр./год</th><th class="num">kWh/ч</th><th class="num">€/ч</th></tr></thead>
      <tbody>${(COST_CFG.machines || []).map(m => { const mr = (Number(m.deprAnnual || 0) + Number(m.maint || 0)) / (p.hoursPerDay * p.daysPerMonth * 12 * p.utilization) + Number(m.kwh || 0) * p.elec; return `<tr>
        <td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.ws)}</td><td class="num">${money(m.deprAnnual)}</td><td class="num">${money(m.maint)}</td><td class="num">${money(m.kwh)}</td><td class="num">${money(mr)}</td></tr>`; }).join("")}</tbody></table>
    </details>

    <details class="cost-details"><summary>👥 Заплати по служители (${(COST_CFG.employees || []).length})</summary>
      <table class="report-table erp-table"><thead><tr><th>Служител</th><th>Цех</th><th class="num">Заплата €/мес</th><th>Роля</th></tr></thead>
      <tbody>${(COST_CFG.employees || []).map(e => `<tr><td>${escapeHtml(e.name || "")}</td><td>${escapeHtml(e.ws || "")}</td><td class="num">${money(e.pay)}</td><td>${escapeHtml(e.role || "")}</td></tr>`).join("")}</tbody></table>
    </details>

    <div class="erp-co-linebar"><span class="spacer"></span><button class="btn btn-small btn-primary" id="cp-save">💾 Запази параметрите</button><span class="save-status" id="cp-status"></span></div>`;

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
  v.querySelector("#cp-save").addEventListener("click", async () => {
    const st = v.querySelector("#cp-status"); st.textContent = "Записва…";
    const ok = await erpSaveCostCfg();
    st.textContent = ok ? "✓ Записано" : "";
    setTimeout(() => { if (st) st.textContent = ""; }, 1500);
  });
}
