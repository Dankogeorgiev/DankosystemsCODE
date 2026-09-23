/* DANKO Sales Agent — интерфейсът (нов модул на DANKO SYSTEMS).
   Контролен/визуализационен слой над n8n бекенда (Stage 1 → Stage 2 →
   Outreach → Gmail Draft). НИКАКВА бизнес логика от n8n не се повтаря тук.
   Данните идват САМО през salesAgentApi (crm-sales-api.js) — сега mock,
   после реалните endpoints. Никога не изпраща имейли; Gmail Draft-ите само
   се преглеждат. Отваря се от бутона „CRM Sales agent" на основния екран
   (виж CRM_EMAILS кой го вижда). Ползва erpDialog/escapeHtml от системата. */

const CRM_EMAILS = ["dankog@gmail.com", "grigor.baykov@dankosystems.com"];
function crmAllowed() {
  const e = ((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "").toLowerCase();
  return CRM_EMAILS.includes(e);
}

const CRMS = { tab: "home", filters: {}, pollTimer: null, searchMode: "full" };

const CRM_TABS = [
  ["home", "🏠 Начало"], ["companies", "🏢 Компании"], ["pipeline", "📊 Пайплайн"],
  ["search", "🔍 Ново търсене"], ["outreach", "✉ Outreach"], ["tasks", "⚑ Задачи"],
  ["reports", "📈 Отчети"], ["settings", "⚙ Настройки"],
];

const CRM_ST_BG = {
  STAGE1: ["Stage 1", "crmb-blue"], STAGE2_RUNNING: ["Stage 2…", "crmb-orange"],
  RESEARCH_COMPLETE: ["Research Complete", "crmb-green"],
};
const CRM_OUT_BG = {
  READY: ["Готов за Outreach", "crmb-blue"], DRAFT_CREATED: ["Draft Created", "crmb-green"],
  NEEDS_REVIEW: ["Needs Review", "crmb-orange"], SKIPPED: ["Skipped", "crmb-grey"],
  MISSING_EMAIL: ["Missing Email", "crmb-red"],
};
function crmBadge(map, key) {
  if (!key) return `<span class="crmb crmb-grey">—</span>`;
  const [label, cls] = map[key] || [key, "crmb-grey"];
  return `<span class="crmb ${cls}">${escapeHtml(label)}</span>`;
}
function crmFit(score) {
  const s = Number(score) || 0;
  const cls = s >= 90 ? "crmfit-strong" : s >= 80 ? "crmfit-q" : "crmfit-low";
  const label = s >= 90 ? "Strong" : s >= 80 ? "Qualified" : "Lower Fit";
  return `<span class="crmfit ${cls}" title="${label}">${s}</span>`;
}

/* ---------- отваряне / затваряне ---------- */
function openCrm() {
  const m = document.getElementById("crm-modal");
  if (!m) return;
  m.hidden = false;
  crmRender();
}
function closeCrm() {
  const m = document.getElementById("crm-modal");
  if (m) m.hidden = true;
  if (CRMS.pollTimer) { clearInterval(CRMS.pollTimer); CRMS.pollTimer = null; }
}

function crmView() { return document.getElementById("crm-view"); }

async function crmRender() {
  if (CRMS.pollTimer) { clearInterval(CRMS.pollTimer); CRMS.pollTimer = null; }
  const nav = document.getElementById("crm-nav");
  if (nav) nav.innerHTML = CRM_TABS.map(([k, l]) =>
    `<button class="crm-tab${CRMS.tab === k ? " active" : ""}" data-crmtab="${k}">${l}</button>`).join("") +
    `<span class="crm-mode">${crmApiMode() === "mock" ? "MOCK ДАННИ" : "PRODUCTION · САМО ЧЕТЕНЕ"}</span>`;
  if (nav) nav.querySelectorAll("[data-crmtab]").forEach(b => b.addEventListener("click", () => { CRMS.tab = b.dataset.crmtab; crmRender(); }));
  const v = crmView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try {
    if (CRMS.tab === "home") await crmHome(v);
    else if (CRMS.tab === "companies") await crmCompanies(v);
    else if (CRMS.tab === "pipeline") await crmPipeline(v);
    else if (CRMS.tab === "search") await crmSearch(v);
    else if (CRMS.tab === "outreach") await crmOutreach(v);
    else if (CRMS.tab === "tasks") await crmTasks(v);
    else if (CRMS.tab === "reports") await crmReports(v);
    else if (CRMS.tab === "settings") await crmSettings(v);
  } catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p>
      <p class="hint">Ако си в режим Production (n8n) — endpoints още няма. Върни на Mock от ⚙ Настройки.</p></div>`;
  }
}

/* ================= НАЧАЛО ================= */
async function crmHome(v) {
  const d = await salesAgentApi.getDashboard();
  const kpi = (label, val, cls) => `<div class="crm-kpi ${cls || ""}"><div class="crm-kpi-n">${val}</div><div class="crm-kpi-l">${label}</div></div>`;
  const act = (title, sub, mode, icon) => `<button class="crm-action" data-crmgo="${mode}">
      <div class="crm-action-ico">${icon}</div><div><b>${title}</b><div class="crm-action-sub">${sub}</div></div></button>`;
  v.innerHTML = `
    <div class="crm-hero">
      <h2>Добре дошли в DANKO Sales Agent</h2>
      <p>Намирайте нови клиенти. Проучвайте ги. Подготвяйте outreach.</p>
    </div>
    <div class="crm-kpis">
      ${kpi("Общо компании", d.total)}
      ${kpi("Нови / Stage 1", d.stage1, "k-blue")}
      ${kpi("Research Complete", d.researchComplete, "k-green")}
      ${kpi("Готови за Outreach", d.outreachReady, "k-orange")}
      ${kpi("Gmail Drafts", d.drafts, "k-navy")}
    </div>
    <div class="crm-actions">
      ${act("Намери нови компании", "Stage 1", "stage1", "🔍")}
      ${act("Проучи контакти", "Stage 2", "stage2", "🧭")}
      ${act("Подготви имейли", "Outreach (само драфтове — нищо не се изпраща)", "outreach", "✉")}
      ${act("Пълен пайплайн", "Stage 1 → Stage 2 → Outreach", "full", "🚀")}
    </div>
    <div class="crm-cols">
      <div class="crm-card">
        <h4>Последни активности</h4>
        ${(d.activities || []).map(a => `<div class="crm-actline"><span class="erp-muted">${escapeHtml(a.at)}</span> ${escapeHtml(a.text)}</div>`).join("") || `<p class="erp-muted">Няма.</p>`}
      </div>
      <div class="crm-card">
        <h4>Пайплайн — обобщение</h4>
        <div class="crm-flow">
          <div class="crm-flow-step"><b>${d.pipeline.stage1}</b><span>Stage 1</span></div><div class="crm-flow-arr">→</div>
          <div class="crm-flow-step"><b>${d.pipeline.stage2}</b><span>Stage 2</span></div><div class="crm-flow-arr">→</div>
          <div class="crm-flow-step"><b>${d.pipeline.ready}</b><span>Готови</span></div><div class="crm-flow-arr">→</div>
          <div class="crm-flow-step"><b>${d.pipeline.drafts}</b><span>Drafts</span></div>
        </div>
        <p class="hint">Агентът никога не изпраща имейли сам — създава само Gmail Drafts за твоя преглед.</p>
      </div>
    </div>`;
  v.querySelectorAll("[data-crmgo]").forEach(b => b.addEventListener("click", () => { CRMS.searchMode = b.dataset.crmgo; CRMS.tab = "search"; crmRender(); }));
}

/* ================= КОМПАНИИ ================= */
async function crmCompanies(v) {
  const f = CRMS.filters;
  const all = await salesAgentApi.getCompanies({});
  const list = await salesAgentApi.getCompanies(f);
  const uniq = key => [...new Set(all.map(c => c[key]).filter(Boolean))].sort();
  const sel = (id, opts, cur, any) => `<select id="${id}"><option value="">${any}</option>${opts.map(o => {
    const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
    return `<option value="${escapeAttr(String(val))}"${String(val) === String(cur || "") ? " selected" : ""}>${escapeHtml(String(lab))}</option>`;
  }).join("")}</select>`;
  v.innerHTML = `
    <div class="crm-toolbar">
      <input type="search" id="crmq" placeholder="🔎 компания / домейн / контакт…" value="${escapeAttr(f.q || "")}" style="min-width:220px" />
      ${sel("crmf-country", uniq("country"), f.country, "Държава: всички")}
      ${sel("crmf-industry", uniq("industry"), f.industry, "Индустрия: всички")}
      ${sel("crmf-status", uniq("status").map(s => [s, (CRM_ST_BG[s] || [s])[0]]), f.status, "Статус: всички")}
      ${sel("crmf-fit", [["90", "Fit ≥ 90 (Strong)"], ["80", "Fit ≥ 80 (Qualified)"]], f.fitMin, "Fit: всички")}
      ${sel("crmf-s2", [["needed", "Stage 2: чака"], ["done", "Stage 2: готов"]], f.stage2, "Stage 2: всички")}
      ${sel("crmf-oe", [["yes", "Eligible: да"], ["no", "Eligible: не"]], f.outreachEligible, "Outreach Eligible")}
      ${sel("crmf-os", Object.keys(CRM_OUT_BG).map(k => [k, CRM_OUT_BG[k][0]]), f.outreachStatus, "Outreach: всички")}
      <span class="erp-count">${list.length} от ${all.length}</span>
      ${crmApiMode() === "n8n" ? `<button class="btn btn-small" id="crm-refresh" title="Чете CRM-а наново (иначе се пази 60 сек)">↻</button>` : ""}
    </div>
    <table class="report-table erp-table crm-table">
      <thead><tr><th>Company</th><th>Country</th><th>Industry</th><th>Website</th><th class="num">Fit</th><th>Status</th><th>Stage 2</th><th>Eligible</th><th>Outreach</th><th>Date Added</th></tr></thead>
      <tbody>${list.map(c => `<tr class="erp-clickable" data-crmco="${escapeAttr(c.website)}">
        <td><b>${escapeHtml(c.company)}</b></td>
        <td>${escapeHtml(c.country)}</td>
        <td>${escapeHtml(c.industry || "")}</td>
        <td class="t-code">${escapeHtml(c.website)}</td>
        <td class="num">${crmFit(c.fitScore)}</td>
        <td>${crmBadge(CRM_ST_BG, c.status)}</td>
        <td>${c.stage2Needed ? `<span class="crmb crmb-orange">чака</span>` : `<span class="crmb crmb-green">✓</span>`}</td>
        <td>${c.outreachEligible ? `<span class="crmb crmb-green">да</span>` : `<span class="crmb crmb-grey">не</span>`}</td>
        <td>${crmBadge(CRM_OUT_BG, c.outreachStatus)}</td>
        <td>${escapeHtml(c.dateAdded || "")}</td>
      </tr>`).join("") || `<tr><td colspan="10" class="report-empty">Няма компании по тези филтри.</td></tr>`}</tbody>
    </table>`;
  const rf = () => { crmCompanies(v); };
  const bind = (id, key) => { const el = v.querySelector("#" + id); if (el) el.addEventListener("change", () => { CRMS.filters[key] = el.value || undefined; rf(); }); };
  const q = v.querySelector("#crmq");
  if (q) q.addEventListener("input", uiDebounce(() => { CRMS.filters.q = q.value || undefined; rf(); }, 250));
  bind("crmf-country", "country"); bind("crmf-industry", "industry"); bind("crmf-status", "status");
  bind("crmf-fit", "fitMin"); bind("crmf-s2", "stage2"); bind("crmf-oe", "outreachEligible"); bind("crmf-os", "outreachStatus");
  const rfBtn = v.querySelector("#crm-refresh");
  if (rfBtn) rfBtn.addEventListener("click", () => { if (typeof crmProdBust === "function") crmProdBust(); rf(); });
  v.querySelectorAll("[data-crmco]").forEach(tr => tr.addEventListener("click", () => crmCompanyDetail(tr.dataset.crmco)));
}

/* ================= ДЕТАЙЛ НА КОМПАНИЯ ================= */
async function crmCompanyDetail(website) {
  const c = await salesAgentApi.getCompany(website);
  if (!c) { alert("Компанията не е намерена."); return; }
  const chips = [
    `<span class="crmfit ${Number(c.fitScore) >= 90 ? "crmfit-strong" : Number(c.fitScore) >= 80 ? "crmfit-q" : "crmfit-low"}">Fit ${c.fitScore}</span>`,
    `<span class="crmb crmb-blue">Stage 1</span>`,
    c.status === "RESEARCH_COMPLETE" ? `<span class="crmb crmb-green">Research Complete</span>` : "",
    c.outreachEligible ? `<span class="crmb crmb-green">Outreach Eligible</span>` : "",
    ["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus) ? `<span class="crmb crmb-navy">Draft Created</span>` : "",
  ].filter(Boolean).join(" ");
  const kv = (l, val, mono) => `<div class="crm-kv"><span>${l}</span><b class="${mono ? "t-code" : ""}">${escapeHtml(String(val || "—"))}</b></div>`;
  const secs = {
    "Общ преглед": `${kv("Company", c.company)}${kv("Country", c.country)}${kv("Website", c.websiteRaw || c.website, 1)}${kv("Industry", c.industry)}${kv("Date Added", c.dateAdded)}${kv("Status", c.statusRaw || c.status)}${kv("Est. Annual Opportunity (EUR)", c.potentialOpportunity)}${c.rowNumber ? kv("CRM ред", "№ " + c.rowNumber) : ""}`,
    "Описание": `<p>${escapeHtml(c.description || "—")}</p>${kv("Potential Products for Danko", c.products)}${kv("Relevant Danko Processes", c.processes)}`,
    "Контакти": `${kv("Decision Maker Role", c.decisionMakerRole)}${kv("Contact Person", c.contactPerson)}${kv("Email", c.email, 1)}${kv("LinkedIn", c.linkedin, 1)}${kv("Business Phone", c.businessPhone, 1)}${kv("Contact Source URL", c.contactSourceUrl, 1)}`,
    "Подход": `${kv("Sales Approach", c.salesApproach)}${kv("Verified Facts", c.verifiedFacts)}${kv("Inferences", c.inferences)}${kv("Notes", c.notes)}`,
    "Източници": `<p class="t-code">${escapeHtml(c.sources || "—")}</p>`,
    "Outreach": `${kv("Outreach Status", (CRM_OUT_BG[c.outreachStatus] || [c.outreachStatus || "—"])[0])}${kv("Outreach Date", c.outreachDate)}${kv("Outreach Email", c.outreachEmail, 1)}${kv("Outreach Subject", c.outreachSubject)}
      ${["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus) ? `<p><button class="btn btn-primary" id="crm-draft-view">✉ Прегледай Gmail Draft</button> <span class="hint">Изпращането е ВИНАГИ ръчно, от Gmail.</span></p>` : ""}`,
    "История": `<p class="erp-muted">${escapeHtml(c._fromJob ? `Добавена от пайплайн ${c._fromJob}.` : `В CRM от ${c.dateAdded}.`)} Пълната история ще идва от n8n endpoint (бъдеща интеграция).</p>`,
  };
  const names = Object.keys(secs);
  const { wrap, close } = erpDialog(`
    <h3>🏢 ${escapeHtml(c.company)}</h3>
    <p class="hint" style="margin:0 0 6px">${escapeHtml(c.country)} · <span class="t-code">${escapeHtml(c.website)}</span> · ${escapeHtml(c.industry || "")}</p>
    <div style="margin-bottom:10px">${chips}</div>
    <div class="crm-dtabs">${names.map((n, i) => `<button class="crm-dtab${i === 0 ? " active" : ""}" data-crmdt="${i}">${n}</button>`).join("")}</div>
    <div id="crm-dbody" style="min-height:180px;max-height:46vh;overflow:auto">${secs[names[0]]}</div>
    <div class="erp-dialog-actions"><span class="spacer"></span><button class="btn" id="crm-dclose">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#crm-dclose").addEventListener("click", close);
  const bindDraft = () => {
    const b = wrap.querySelector("#crm-draft-view");
    if (b) b.addEventListener("click", () => crmDraftPreview(c));
  };
  wrap.querySelectorAll("[data-crmdt]").forEach(b => b.addEventListener("click", () => {
    wrap.querySelectorAll(".crm-dtab").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    wrap.querySelector("#crm-dbody").innerHTML = secs[names[Number(b.dataset.crmdt)]];
    bindDraft();
  }));
  bindDraft();
}

function crmDraftPreview(c) {
  const { wrap, close } = erpDialog(`
    <h3>✉ Gmail Draft — ${escapeHtml(c.company)}</h3>
    <p class="hint" style="margin:0 0 8px">Draft-ът стои в Gmail и се изпраща САМО ръчно, от теб. ${crmApiMode() === "mock" ? "(mock преглед — реалният линк ще идва от n8n)" : ""}</p>
    <div class="crm-kv"><span>До</span><b class="t-code">${escapeHtml(c.outreachEmail || "—")}</b></div>
    <div class="crm-kv"><span>Тема</span><b>${escapeHtml(c.outreachSubject || "—")}</b></div>
    <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:13px">${escapeHtml(c.salesApproach ? `(mock съдържание по Sales Approach)\n\n${c.salesApproach}` : "Съдържанието на драфта ще се показва от n8n endpoint.")}</pre>
    <div class="erp-dialog-actions"><span class="spacer"></span><button class="btn" id="crm-dpclose">Затвори</button></div>`);
  wrap.querySelector("#crm-dpclose").addEventListener("click", close);
}

/* ================= ПАЙПЛАЙН (джобове + Kanban) ================= */
async function crmPipeline(v) {
  const runs = await salesAgentApi.getPipelineRuns();
  const all = await salesAgentApi.getCompanies({});
  // Колоните се строят от ИЗЧИСЛЕНИТЕ полета (Stage2 Needed / Outreach
  // Eligible + Outreach Status) — те са авторитетни и в Mock, и в живия CRM,
  // независимо какъв речник ползва колоната Status в Sheet-а.
  const isDraft = c => ["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus);
  const hasResearch = c => !c.stage2Needed && (c.contactPerson || c.verifiedFacts || c.email || c.status === "RESEARCH_COMPLETE");
  const cols = [
    ["Нови", all.filter(c => c.stage2Needed && !c.outreachStatus)],
    ["Stage 1 Complete", all.filter(c => !c.stage2Needed && !hasResearch(c) && !c.outreachEligible && !isDraft(c))],
    ["Stage 2 / Research", all.filter(c => hasResearch(c) && !c.outreachEligible && !isDraft(c))],
    ["Готови за Outreach", all.filter(c => c.outreachEligible && !isDraft(c))],
    ["Gmail Drafts", all.filter(isDraft)],
  ];
  const runRow = r => `<tr class="erp-clickable" data-crmrun="${escapeAttr(r.id)}">
      <td><b>#${escapeHtml(r.id)}</b></td><td>${escapeHtml(r.mode === "full" ? "Пълен пайплайн" : r.mode)}</td>
      <td>${r.status === "RUNNING" ? `<span class="crmb crmb-orange">Работи…</span>` : r.status === "COMPLETED" ? `<span class="crmb crmb-green">Завършен</span>` : r.status === "PARTIAL" ? `<span class="crmb crmb-orange">Частичен</span>` : `<span class="crmb crmb-red">${escapeHtml(r.status)}</span>`}</td>
      <td class="num">${r.requested}</td><td class="num">${r.stage1Done}</td><td class="num">${r.stage2Done}</td><td class="num">${r.draftsDone}</td>
      <td>${new Date(r.startedAt).toLocaleString("bg-BG")}</td></tr>`;
  v.innerHTML = `
    ${runs.length ? `<div class="crm-card" style="margin-bottom:12px">
      <h4>Пайплайни (${runs.length})</h4>
      <table class="report-table erp-table"><thead><tr><th>№</th><th>Режим</th><th>Статус</th><th class="num">Заявени</th><th class="num">Stage 1</th><th class="num">Stage 2</th><th class="num">Drafts</th><th>Стартиран</th></tr></thead>
      <tbody>${runs.map(runRow).join("")}</tbody></table></div>` : `<p class="hint">Няма стартирани пайплайни. Пусни от „🔍 Ново търсене".</p>`}
    <div class="crm-kanban">
      ${cols.map(([title, list]) => `<div class="crm-kcol">
        <div class="crm-kcol-h">${title} <span class="crm-kcnt">${list.length}</span></div>
        ${list.map(c => `<div class="crm-kcard erp-clickable" data-crmco="${escapeAttr(c.website)}">
          <b>${escapeHtml(c.company)}</b>
          <div class="crm-kmeta">${escapeHtml(c.country)} · ${crmFit(c.fitScore)}</div>
          <div class="crm-kmeta">${crmBadge(CRM_OUT_BG, c.outreachStatus) === `<span class="crmb crmb-grey">—</span>` ? crmBadge(CRM_ST_BG, c.status) : crmBadge(CRM_OUT_BG, c.outreachStatus)} <span class="erp-muted">${escapeHtml(c.dateAdded || "")}</span></div>
        </div>`).join("") || `<p class="erp-muted" style="font-size:12px;padding:4px">празно</p>`}
      </div>`).join("")}
    </div>`;
  v.querySelectorAll("[data-crmco]").forEach(el => el.addEventListener("click", () => crmCompanyDetail(el.dataset.crmco)));
  v.querySelectorAll("[data-crmrun]").forEach(tr => tr.addEventListener("click", () => crmRunDialog(tr.dataset.crmrun)));
  if (runs.some(r => r.status === "RUNNING")) {
    CRMS.pollTimer = setInterval(() => { if (CRMS.tab === "pipeline") crmPipeline(v); }, 4000);
  }
}

/* Прозорецът на един джоб — полва статуса, докато е отворен. */
async function crmRunDialog(jobId) {
  let closed = false;
  const { wrap, close } = erpDialog(`<h3>Pipeline #${escapeHtml(jobId)}</h3><div id="crm-runbody"><p class="erp-loading">Зареждане…</p></div>
    <div class="erp-dialog-actions"><span class="spacer"></span><button class="btn" id="crm-runclose">Затвори</button></div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  const doClose = () => { closed = true; close(); };
  wrap.querySelector("#crm-runclose").addEventListener("click", doClose);
  const PH = {
    QUEUED: ["на опашка", "crmb-grey"], STAGE1_RUNNING: ["Stage 1…", "crmb-orange"], CREATED: ["CREATED", "crmb-blue"],
    STAGE2_RUNNING: ["Stage 2…", "crmb-orange"], RESEARCH_COMPLETE: ["RESEARCH_COMPLETE", "crmb-green"],
    OUTREACH_RUNNING: ["Outreach…", "crmb-orange"], DRAFT_CREATED: ["DRAFT_CREATED", "crmb-green"],
    SKIPPED: ["SKIPPED", "crmb-grey"], MISSING_EMAIL: ["MISSING_EMAIL", "crmb-red"], FAILED: ["FAILED", "crmb-red"],
  };
  const paint = async () => {
    const r = await salesAgentApi.getPipelineRun(jobId);
    const box = wrap.querySelector("#crm-runbody");
    if (!r || !box || closed) return;
    const bar = (done, total) => `<div class="crm-bar"><div style="width:${total ? Math.round(done / total * 100) : 0}%"></div></div>`;
    box.innerHTML = `
      <p style="margin:4px 0 10px">Статус: ${r.status === "RUNNING" ? `<b style="color:#b45309">Работи…</b>` : r.status === "COMPLETED" ? `<b style="color:#166534">Пайплайнът е завършен.</b>` : r.status === "PARTIAL" ? `<b style="color:#b45309">Завършен частично.</b>` : `<b style="color:#991b1b">${escapeHtml(r.status)}</b>`}
        · Заявени: <b>${r.requested}</b></p>
      <div class="crm-runstats">
        <div>Stage 1: <b>${r.stage1Done} / ${r.requested}</b>${bar(r.stage1Done, r.requested)}</div>
        <div>Stage 2: <b>${r.stage2Done} / ${r.requested}</b>${bar(r.stage2Done, r.requested)}</div>
        <div>Gmail Drafts: <b>${r.draftsDone} / ${r.requested}</b>${bar(r.draftsDone, r.requested)}</div>
      </div>
      ${r.status !== "RUNNING" ? `<p><b>Заявени:</b> ${r.requested} · <b>Намерени:</b> ${r.stage1Done} · <b>Проучени:</b> ${r.stage2Done} · <b>Gmail Drafts:</b> ${r.draftsDone} · <b>Изпратени: 0</b></p>` : `<p class="hint">Може да затвориш прозореца — пайплайнът продължава и ще го намериш в „📊 Пайплайн".</p>`}
      <table class="report-table erp-table"><thead><tr><th>Company</th><th>Country</th><th class="num">Fit</th><th>Резултат</th></tr></thead>
      <tbody>${r.companies.map(c => `<tr class="erp-clickable" data-crmco="${escapeAttr(c.website)}">
        <td><b>${escapeHtml(c.company)}</b></td><td>${escapeHtml(c.country)}</td><td class="num">${crmFit(c.fitScore)}</td>
        <td><span class="crmb ${(PH[c.phase] || ["", "crmb-grey"])[1]}">${escapeHtml((PH[c.phase] || [c.phase])[0])}</span></td></tr>`).join("")}</tbody></table>`;
    box.querySelectorAll("[data-crmco]").forEach(el => el.addEventListener("click", () => crmCompanyDetail(el.dataset.crmco)));
    if (r.status === "RUNNING" && !closed) setTimeout(paint, 2500);
  };
  paint();
}

/* ================= НОВО ТЪРСЕНЕ ================= */
async function crmSearch(v) {
  const mode = CRMS.searchMode || "full";
  const modes = [["stage1", "Stage 1"], ["stage2", "Stage 2"], ["outreach", "Outreach"], ["full", "Пълен пайплайн"]];
  const all = await salesAgentApi.getCompanies({});
  const s2Cands = all.filter(c => c.stage2Needed);
  const outCands = all.filter(c => c.outreachEligible && !["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus));
  const wsPick = (list, id) => `<div class="crm-card" style="max-height:200px;overflow:auto">
      ${list.map(c => `<label style="display:block;margin:2px 0"><input type="checkbox" class="${id}" value="${escapeAttr(c.website)}" checked /> ${escapeHtml(c.company)} <span class="erp-muted t-code">${escapeHtml(c.website)}</span></label>`).join("") || `<p class="erp-muted">Няма подходящи компании.</p>`}
    </div>`;
  const prodLock = crmApiMode() === "n8n";
  v.innerHTML = `
    <h2 style="margin:4px 0 10px">Стартирай ново търсене</h2>
    ${prodLock ? `<p style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:10px;max-width:640px">⏸ <b>Pipeline execution is not connected yet.</b> В Production режим данните са на живо, но стартирането на Stage 1/2/Outreach чака Фаза 2B. За проба на пайплайните мини на Mock от ⚙ Настройки.</p>` : ""}
    <div class="crm-modes">${modes.map(([k, l]) => `<button class="crm-modebtn${mode === k ? " active" : ""}" data-crmmode="${k}">${l}</button>`).join("")}</div>
    ${mode === "full" || mode === "stage1" ? `
      <div class="crm-form">
        <label>Държава <input type="text" id="crm-country" placeholder="Germany" value="Germany" /></label>
        <label>Брой компании <input type="number" id="crm-count" min="1" max="8" value="5" /></label>
        <label>Минимален DANKO Fit Score <input type="number" id="crm-fit" min="0" max="100" value="80" /></label>
        <label style="grid-column:1/-1">Фокус индустрии <input type="text" id="crm-focus" value="industrial machinery, machine builders, industrial equipment manufacturers" /></label>
        <label style="grid-column:1/-1">Изключи индустрии <input type="text" id="crm-exclude" value="packaging machinery" /></label>
      </div>` : mode === "stage2" ? `
      <p class="hint">Stage 2 обогатява СЪЩИТЕ CRM записи (по домейн). Избери кои:</p>${wsPick(s2Cands, "crm-ws2")}` : `
      <p class="hint">Outreach създава Gmail Drafts за проучените компании. Избери кои:</p>${wsPick(outCands, "crm-wso")}`}
    <div style="display:flex;align-items:center;gap:14px;margin:14px 0">
      <button class="btn btn-primary" id="crm-start" style="font-size:15px"${prodLock ? " disabled" : ""}>🚀 ${mode === "full" ? "Стартирай пълния пайплайн" : mode === "stage1" ? "Стартирай Stage 1" : mode === "stage2" ? "Стартирай Stage 2" : "Подготви имейлите (Drafts)"}</button>
      <span class="erp-muted" id="crm-startst"></span>
    </div>
    <div class="crm-card" style="max-width:420px">
      <h4>Какво ще се случи</h4>
      <div class="crm-vflow">${["Stage 1 — намиране и CRM запис", "Stage 2 — проучване на СЪЩИЯ запис", "Outreach — подготовка на имейл", "Gmail Draft — чака ТВОЯ преглед"]
        .map((s, i, a) => `<div class="crm-vstep${(mode === "stage1" && i > 0) || (mode === "stage2" && i !== 1) || (mode === "outreach" && i < 2) ? " dim" : ""}">${s}</div>${i < a.length - 1 ? `<div class="crm-varr">↓</div>` : ""}`).join("")}</div>
      <p class="hint"><b>Имейли НЕ се изпращат автоматично</b> — никога.</p>
    </div>`;
  v.querySelectorAll("[data-crmmode]").forEach(b => b.addEventListener("click", () => { CRMS.searchMode = b.dataset.crmmode; crmSearch(v); }));
  v.querySelector("#crm-start").addEventListener("click", async () => {
    const st = v.querySelector("#crm-startst");
    try {
      let res;
      if (mode === "full" || mode === "stage1") {
        const params = {
          country: v.querySelector("#crm-country").value.trim(),
          target_count: Number(v.querySelector("#crm-count").value) || 5,
          min_fit_score: Number(v.querySelector("#crm-fit").value) || 80,
          industry_focus: v.querySelector("#crm-focus").value.trim(),
          exclude_industries: v.querySelector("#crm-exclude").value.trim(),
        };
        res = mode === "full" ? await salesAgentApi.startFullPipeline(params) : await salesAgentApi.startStage1(params);
      } else if (mode === "stage2") {
        const ws = [...v.querySelectorAll(".crm-ws2:checked")].map(x => x.value);
        if (!ws.length) { alert("Избери поне една компания."); return; }
        res = await salesAgentApi.startStage2(ws);
      } else {
        const ws = [...v.querySelectorAll(".crm-wso:checked")].map(x => x.value);
        if (!ws.length) { alert("Избери поне една компания."); return; }
        res = await salesAgentApi.startOutreach(ws);
      }
      st.textContent = `✓ стартиран job ${res.job_id}`;
      crmRunDialog(res.job_id);
    } catch (e) { alert("Грешка: " + (e.message || e)); }
  });
}

/* ================= OUTREACH ================= */
async function crmOutreach(v) {
  const q = await salesAgentApi.getOutreachQueue();
  const sec = (title, list, cls) => `
    <h4 class="erp-group-head">${title} <span class="crm-kcnt">${list.length}</span></h4>
    <table class="report-table erp-table"><thead><tr><th>Company</th><th>Contact</th><th>Email</th><th class="num">Fit</th><th>Outreach Status</th><th>Draft Date</th><th></th></tr></thead>
    <tbody>${list.map(c => `<tr class="erp-clickable" data-crmco="${escapeAttr(c.website)}">
      <td><b>${escapeHtml(c.company)}</b></td><td>${escapeHtml(c.contactPerson || "—")}</td><td class="t-code">${escapeHtml(c.email || c.outreachEmail || "—")}</td>
      <td class="num">${crmFit(c.fitScore)}</td><td>${crmBadge(CRM_OUT_BG, c.outreachStatus || (c.outreachEligible ? "READY" : ""))}</td><td>${escapeHtml(c.outreachDate || "—")}</td>
      <td class="erp-row-actions">${["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus) ? `<button class="btn btn-small" data-crmdraft="${escapeAttr(c.website)}">✉ Прегледай Draft</button>` : ""}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="report-empty">Празно.</td></tr>`}</tbody></table>`;
  v.innerHTML = `
    <p class="hint" style="margin:4px 0 10px"><b>Нищо не се изпраща от тук.</b> Агентът само подготвя Gmail Drafts — изпращаш ги ти, от Gmail, след преглед.</p>
    ${sec("Готови за Outreach", q.ready)}
    ${sec("Draft Created", q.drafts)}
    ${sec("Needs Review", q.review)}
    ${sec("Skipped", q.skipped)}
    ${sec("Missing Verified Email", q.missing)}`;
  v.querySelectorAll("[data-crmco]").forEach(tr => tr.addEventListener("click", e => { if (e.target.closest("button")) return; crmCompanyDetail(tr.dataset.crmco); }));
  v.querySelectorAll("[data-crmdraft]").forEach(b => b.addEventListener("click", async () => {
    const c = await salesAgentApi.getCompany(b.dataset.crmdraft);
    if (c) crmDraftPreview(c);
  }));
}

/* ================= ЗАДАЧИ ================= */
async function crmTasks(v) {
  const tasks = await salesAgentApi.getTasks();
  const ICO = { MISSING_EMAIL: "📧", NEEDS_REVIEW: "👀", STRONG_LEAD: "⭐", LOW_FIT: "⬇", PIPELINE_FAILED: "💥", CRM_FAILED: "🗄" };
  v.innerHTML = `
    <h2 style="margin:4px 0 10px">Задачи / Нужда от внимание</h2>
    ${tasks.map(t => `<div class="crm-card crm-task erp-clickable" data-crmco="${escapeAttr(t.website)}">
      <div class="crm-task-ico">${ICO[t.type] || "⚑"}</div>
      <div><b>${escapeHtml(t.company)}</b> <span class="erp-muted">· от ${escapeHtml(t.since)}</span><div>${escapeHtml(t.text)}</div></div>
    </div>`).join("") || `<p class="erp-muted">Няма чакащи задачи. ✅</p>`}`;
  v.querySelectorAll("[data-crmco]").forEach(el => el.addEventListener("click", () => crmCompanyDetail(el.dataset.crmco)));
}

/* ================= ОТЧЕТИ ================= */
async function crmReports(v) {
  const r = await salesAgentApi.getReports();
  const kpi = (l, val) => `<div class="crm-kpi"><div class="crm-kpi-n">${val}</div><div class="crm-kpi-l">${l}</div></div>`;
  const bars = (title, rows) => `<div class="crm-card"><h4>${title}</h4>
    ${rows.map(([k, n]) => `<div class="crm-brow"><span>${escapeHtml(k)}</span>
      <div class="crm-bar"><div style="width:${Math.round(n / (rows[0][1] || 1) * 100)}%"></div></div><b>${n}</b></div>`).join("")}</div>`;
  v.innerHTML = `
    <div class="crm-kpis">
      ${kpi("Нови тази седмица", r.newThisWeek)}
      ${kpi("Qualified (Fit ≥ 80)", r.qualified)}
      ${kpi("Среден Fit Score", r.avgFit)}
      ${kpi("Research Complete", r.researchComplete)}
      ${kpi("Outreach Eligible", r.outreachEligible)}
      ${kpi("Drafts Created", r.drafts)}
    </div>
    <div class="crm-cols">
      ${bars("Компании по държава", r.byCountry)}
      ${bars("Компании по индустрия", r.byIndustry)}
    </div>`;
}

/* ================= НАСТРОЙКИ ================= */
async function crmSettings(v) {
  const mode = crmApiMode();
  v.innerHTML = `
    <h2 style="margin:4px 0 10px">Настройки</h2>
    <div class="crm-card" style="max-width:640px">
      <h4>Източник на данни</h4>
      <label style="display:block;margin:6px 0"><input type="radio" name="crmmode" value="mock"${mode === "mock" ? " checked" : ""} /> <b>Mock</b> — примерни данни в браузъра (сегашният режим; нищо не пипа реалния CRM)</label>
      <label style="display:block;margin:6px 0"><input type="radio" name="crmmode" value="n8n"${mode === "n8n" ? " checked" : ""} /> <b>Production (n8n)</b> — ЖИВ CRM, само четене (Фаза 2A); пайплайните чакат Фаза 2B</label>
      <p class="hint">Фронтендът НИКОГА не говори директно с Google Sheets/Gmail и не съдържа ключове — само Edge функцията crm-bridge. Production никога не пада тихо към Mock: ако мостът не работи, виждаш грешка, не фалшиви данни.</p>
      <p><button class="btn" id="crm-ping">🔌 Тест на връзката</button> <span class="erp-muted" id="crm-pingst"></span></p>
    </div>
    <div class="crm-card" style="max-width:640px">
      <h4>Бекендът (n8n) — какво е свързано</h4>
      <p>CRM: Google Sheet <b>DANKO Sales Leads</b> → „Qualified Leads" (47 компании, редове 2–48; броим само реалните записи, не служебните редове).</p>
      <p>Workflows: <b>DANKO Sales Agent v1.0</b> (оркестрация) · <b>Stage 1 Batch Research</b> · <b>Stage 2 Batch Research</b> · <b>Outreach Batch</b> (само Gmail Drafts, никога не изпраща).</p>
    </div>
    <div class="crm-card" style="max-width:640px">
      <h4>Достъп</h4>
      <p>Табът виждат: ${CRM_EMAILS.map(e => `<span class="t-code">${escapeHtml(e)}</span>`).join(" · ")}</p>
      <p class="hint">Списъкът е CRM_EMAILS в crm-sales.js — кажи на Клод кого да добави.</p>
    </div>`;
  v.querySelectorAll("input[name=crmmode]").forEach(r => r.addEventListener("change", () => {
    crmSetApiMode(r.value);
    if (typeof crmProdBust === "function") crmProdBust();
    crmRender();
  }));
  const ping = v.querySelector("#crm-ping");
  if (ping) ping.addEventListener("click", async () => {
    const st = v.querySelector("#crm-pingst");
    st.textContent = "проверявам…"; ping.disabled = true;
    try {
      const p = await crmBridge("ping");
      if (!p.data.configured) { st.textContent = "⚠ Мостът работи, но N8N_READ_URL не е настроен в секретите."; return; }
      if (typeof crmProdBust === "function") crmProdBust();
      const list = await crmProdProvider._companies();
      const m = crmProdProvider.meta() || {};
      st.textContent = `✓ на живо: ${list.length} компании · домейни: ${m.unique_domains}${(m.duplicate_domains || []).length ? ` · ДУБЛИ: ${m.duplicate_domains.join(", ")}` : " · без дубли"}${(m.missing_fields || []).length ? ` · ⚠ липсващи колони: ${m.missing_fields.join(", ")}` : ""} · ${new Date(m.fetched_at).toLocaleTimeString("bg-BG")}`;
    } catch (e) { st.textContent = "✕ " + (e.message || e); }
    finally { ping.disabled = false; }
  });
}

/* ---------- достъп + инициализация ---------- */
function crmApplyAccess() {
  const b = document.getElementById("btn-crm");
  if (b) b.style.display = crmAllowed() ? "" : "none";
}
function crmInit() {
  const b = document.getElementById("btn-crm");
  if (b) b.addEventListener("click", openCrm);
  const c = document.getElementById("crm-close");
  if (c) c.addEventListener("click", closeCrm);
}
document.addEventListener("DOMContentLoaded", crmInit);
