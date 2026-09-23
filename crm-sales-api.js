/* DANKO Sales Agent — API слой (salesAgentApi).
   ЕДИНСТВЕНОТО място, откъдето UI-ят взима данни. Два доставчика:
     • mock  — работи СЕГА, върху crm-sales-data.js + localStorage (джобовете);
     • n8n   — бъдещият: контролирани webhook/status endpoints (НЕ са измислени
               тук — методите отказват учтиво, докато Данко не даде адресите).
   UI кодът НЕ знае кой доставчик отговаря — вика salesAgentApi.method().

   СИГУРНОСТ: тук НЯМА и НЕ трябва да има ключове (n8n/Google/Gmail/OpenAI…).
   Браузърът ще говори само с контролирани endpoints (n8n webhook / Edge fn).

   ДЖОБОВЕ (пайплайни): бекендът върви минути, затова моделът е
   START → job_id → ПОЛВАНЕ на статус → COMPLETED/PARTIAL/FAILED.
   Mock-ът симулира същото: джобът се пази в localStorage със startedAt,
   а прогресът се смята от изтеклото време — затваряш страницата,
   връщаш се и той е мръднал напред (като истинския n8n). */

const CRM_JOBS_KEY = "crm_sales_jobs_v1";
const CRM_MODE_KEY = "crm_sales_api_mode";           // "mock" | "n8n"
const CRM_SEC_PER_STEP = { stage1: 7, stage2: 11, outreach: 8 };   // сек/компания в mock симулацията

function crmApiMode() { try { return localStorage.getItem(CRM_MODE_KEY) || "mock"; } catch (e) { return "mock"; } }
function crmSetApiMode(m) { try { localStorage.setItem(CRM_MODE_KEY, m === "n8n" ? "n8n" : "mock"); } catch (e) {} }

/* ---------- джобове в localStorage ---------- */
function crmJobsLoad() { try { return JSON.parse(localStorage.getItem(CRM_JOBS_KEY) || "[]"); } catch (e) { return []; } }
function crmJobsSave(list) { try { localStorage.setItem(CRM_JOBS_KEY, JSON.stringify(list.slice(-25))); } catch (e) {} }
function crmJobNo(list) { return `DS-${new Date().getFullYear()}-${String(101 + list.length).padStart(5, "0")}`; }

/* Симулиран изход по компания: детерминистичен (по индекса), за да се виждат
   и частичните резултати — една MISSING_EMAIL, една SKIPPED на всеки 5. */
function crmMockOutcome(idx) {
  if (idx % 5 === 3) return "MISSING_EMAIL";
  if (idx % 5 === 4) return "SKIPPED";
  return "OK";
}

/* Текущото състояние на mock джоб — чисто от изтеклото време. */
function crmJobState(job) {
  const now = Date.now();
  const el = Math.max(0, (now - job.startedAt) / 1000);
  const wants = { stage1: job.mode === "full" || job.mode === "stage1", stage2: job.mode === "full" || job.mode === "stage2", outreach: job.mode === "full" || job.mode === "outreach" };
  const comps = job.companies.map((c, i) => {
    let t = 0, phase = "QUEUED", done = false, outcome = crmMockOutcome(i);
    const t1 = wants.stage1 ? CRM_SEC_PER_STEP.stage1 * (i + 1) : 0;
    const t2 = t1 + (wants.stage2 ? CRM_SEC_PER_STEP.stage2 * (i + 1) : 0);
    const t3 = t2 + (wants.outreach ? CRM_SEC_PER_STEP.outreach * (i + 1) : 0);
    if (wants.stage1) phase = el >= t1 ? "CREATED" : "STAGE1_RUNNING";
    if (wants.stage2 && el >= t1) {
      if (outcome === "SKIPPED" && el >= t2) phase = "SKIPPED";
      else phase = el >= t2 ? (outcome === "MISSING_EMAIL" ? "MISSING_EMAIL" : "RESEARCH_COMPLETE") : "STAGE2_RUNNING";
    }
    if (wants.outreach && el >= t2 && outcome === "OK") phase = el >= t3 ? "DRAFT_CREATED" : "OUTREACH_RUNNING";
    done = el >= t3 || (outcome !== "OK" && el >= t2);
    return { ...c, phase, done, outcome };
  });
  const cnt = k => comps.filter(c => c.phase === k || (k === "CREATED" && ["RESEARCH_COMPLETE", "DRAFT_CREATED", "MISSING_EMAIL", "SKIPPED", "STAGE2_RUNNING", "OUTREACH_RUNNING"].includes(c.phase))).length;
  const allDone = comps.every(c => c.done);
  const anyBad = comps.some(c => c.outcome !== "OK");
  return {
    id: job.id, mode: job.mode, params: job.params, startedAt: job.startedAt,
    status: allDone ? (anyBad ? "PARTIAL" : "COMPLETED") : "RUNNING",
    requested: job.companies.length,
    stage1Done: cnt("CREATED"),
    stage2Done: comps.filter(c => ["RESEARCH_COMPLETE", "DRAFT_CREATED", "OUTREACH_RUNNING"].includes(c.phase)).length,
    draftsDone: comps.filter(c => c.phase === "DRAFT_CREATED").length,
    companies: comps
  };
}

/* Компании, „родени" от завършили mock джобове → добавят се към списъка. */
function crmJobCompanies() {
  const out = [];
  crmJobsLoad().forEach(j => {
    crmJobState(j).companies.forEach(c => {
      if (c.phase === "QUEUED" || c.phase === "STAGE1_RUNNING") return;
      out.push({
        dateAdded: new Date(j.startedAt).toISOString().slice(0, 10),
        company: c.company, country: c.country, website: c.website, industry: c.industry,
        description: `Добавена от пайплайн ${j.id} (mock).`, products: "", processes: "",
        fitScore: c.fitScore, potentialOpportunity: "",
        status: c.phase === "CREATED" ? "STAGE1" : c.phase === "STAGE2_RUNNING" ? "STAGE2_RUNNING" : c.phase === "MISSING_EMAIL" || c.phase === "SKIPPED" ? "STAGE1" : "RESEARCH_COMPLETE",
        stage2Needed: c.phase === "CREATED", outreachEligible: c.phase === "DRAFT_CREATED" || c.phase === "OUTREACH_RUNNING",
        decisionMakerRole: "", contactPerson: "", email: c.phase === "MISSING_EMAIL" ? "" : (c.phase === "DRAFT_CREATED" ? `office@${c.website}` : ""),
        linkedin: "", businessPhone: "", contactSourceUrl: "", salesApproach: "", verifiedFacts: "", inferences: "", sources: "", notes: `Mock пайплайн ${j.id}`,
        outreachStatus: c.phase === "DRAFT_CREATED" ? "DRAFT_CREATED" : c.phase === "MISSING_EMAIL" ? "MISSING_EMAIL" : c.phase === "SKIPPED" ? "SKIPPED" : "",
        outreachDate: c.phase === "DRAFT_CREATED" ? new Date(j.startedAt).toISOString().slice(0, 10) : "",
        outreachEmail: c.phase === "DRAFT_CREATED" ? `office@${c.website}` : "", outreachSubject: c.phase === "DRAFT_CREATED" ? `Production capacity for ${c.company} — DANKO Systems` : "",
        _fromJob: j.id
      });
    });
  });
  return out;
}

/* Общите филтри — ползват ги И mock, И production (клиентско филтриране:
   47 компании не заслужават сървърна пагинация; договорът обаче я търпи). */
function crmApplyFilters(list, filters) {
  const f = filters || {};
  const q = String(f.q || "").toLowerCase();
  if (q) list = list.filter(c => [c.company, c.website, c.country, c.industry, c.contactPerson].join(" ").toLowerCase().includes(q));
  if (f.country) list = list.filter(c => c.country === f.country);
  if (f.industry) list = list.filter(c => c.industry === f.industry);
  if (f.status) list = list.filter(c => c.status === f.status);
  if (f.fitMin) list = list.filter(c => (c.fitScore || 0) >= Number(f.fitMin));
  if (f.stage2 === "needed") list = list.filter(c => c.stage2Needed);
  if (f.stage2 === "done") list = list.filter(c => !c.stage2Needed);
  if (f.outreachEligible === "yes") list = list.filter(c => c.outreachEligible);
  if (f.outreachEligible === "no") list = list.filter(c => !c.outreachEligible);
  if (f.outreachStatus) list = list.filter(c => (c.outreachStatus || "") === f.outreachStatus);
  return list.sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)) || (b.fitScore || 0) - (a.fitScore || 0));
}

/* ================= MOCK ДОСТАВЧИК ================= */
const crmMockProvider = {
  async getDashboard() {
    const all = await this.getCompanies({});
    const n = s => all.filter(c => c.status === s).length;
    return {
      total: all.length,
      stage1: all.filter(c => c.status === "STAGE1" || c.status === "STAGE2_RUNNING").length,
      researchComplete: n("RESEARCH_COMPLETE"),
      outreachReady: all.filter(c => c.outreachEligible && c.outreachStatus !== "DRAFT_CREATED").length,
      drafts: all.filter(c => c.outreachStatus === "DRAFT_CREATED" || c.outreachStatus === "NEEDS_REVIEW").length,
      activities: CRM_MOCK.activities,
      pipeline: {
        new: all.filter(c => c.status === "STAGE1" && c.stage2Needed).length,
        stage1: n("STAGE1"), stage2: n("STAGE2_RUNNING"), ready: all.filter(c => c.outreachStatus === "READY").length,
        drafts: all.filter(c => ["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus)).length
      }
    };
  },
  async getCompanies(filters) {
    const seen = new Set();
    let list = [];
    [...CRM_MOCK.companies, ...crmJobCompanies()].forEach(c => {
      const key = String(c.website || "").toLowerCase();      // идентичност = домейн
      if (seen.has(key)) return;
      seen.add(key); list.push(c);
    });
    return crmApplyFilters(list, filters);
  },
  async getCompany(website) {
    const all = await this.getCompanies({});
    return all.find(c => String(c.website).toLowerCase() === String(website).toLowerCase()) || null;
  },
  async getPipelineRuns() { return crmJobsLoad().map(crmJobState).sort((a, b) => b.startedAt - a.startedAt); },
  async getPipelineRun(jobId) { const j = crmJobsLoad().find(x => x.id === jobId); return j ? crmJobState(j) : null; },
  async getExecutionStatus(jobId) { return this.getPipelineRun(jobId); },

  async _start(mode, params) {
    const jobs = crmJobsLoad();
    const want = Math.max(1, Math.min(8, Number(params.target_count) || 5));
    let pool = CRM_MOCK.discoverPool.filter(p => !params.country || p.country === params.country);
    if (params.min_fit_score) pool = pool.filter(p => p.fitScore >= Number(params.min_fit_score));
    if (pool.length < want) pool = pool.concat(CRM_MOCK.discoverPool.filter(p => !pool.includes(p)));
    const roll = jobs.length % Math.max(1, pool.length);
    const companies = [];
    for (let i = 0; i < want && i < pool.length; i++) {
      const p = pool[(roll + i) % pool.length];
      companies.push({ ...p, website: jobs.length ? p.website.replace(/^/, "") : p.website });
    }
    const job = { id: crmJobNo(jobs), mode, params, startedAt: Date.now(), companies };
    jobs.push(job); crmJobsSave(jobs);
    return { job_id: job.id };
  },
  async startFullPipeline(params) { return this._start("full", params); },
  async startStage1(params) { return this._start("stage1", params); },
  async startStage2(websites) { return this._start("stage2", { target_count: (websites || []).length || 3, websites }); },
  async startOutreach(websites) { return this._start("outreach", { target_count: (websites || []).length || 3, websites }); },

  async getOutreachQueue() {
    const all = await this.getCompanies({});
    return {
      ready: all.filter(c => c.outreachStatus === "READY" || (c.outreachEligible && !c.outreachStatus)),
      drafts: all.filter(c => c.outreachStatus === "DRAFT_CREATED"),
      review: all.filter(c => c.outreachStatus === "NEEDS_REVIEW"),
      skipped: all.filter(c => c.outreachStatus === "SKIPPED"),
      missing: all.filter(c => c.outreachStatus === "MISSING_EMAIL")
    };
  },
  async getTasks() { return CRM_MOCK.tasks; },
  async getReports() {
    const all = await this.getCompanies({});
    const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const group = key => { const m = {}; all.forEach(c => { const k = c[key] || "—"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    return {
      newThisWeek: all.filter(c => String(c.dateAdded) >= week).length,
      qualified: all.filter(c => (c.fitScore || 0) >= 80).length,
      avgFit: all.length ? Math.round(all.reduce((s, c) => s + (c.fitScore || 0), 0) / all.length) : 0,
      researchComplete: all.filter(c => c.status === "RESEARCH_COMPLETE").length,
      outreachEligible: all.filter(c => c.outreachEligible).length,
      drafts: all.filter(c => ["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus)).length,
      byCountry: group("country"), byIndustry: group("industry"), total: all.length
    };
  }
};

/* ================= PRODUCTION ДОСТАВЧИК (Фаза 2A — САМО ЧЕТЕНЕ) =================
   Браузър → Edge функция crm-bridge (проверява Supabase JWT + allow-list)
   → n8n READ webhook → Google Sheet „DANKO Sales Leads". Никакви ключове тук.
   Договор от моста: { ok, data, meta } / { ok:false, error:{code,message} }.
   Компаниите идват в snake_case (виж crm-bridge/index.ts) и се превеждат към
   модела на UI-я НА ЕДНО МЯСТО (crmFromApi). Идентичност = normalized domain.
   Пайплайните НЕ са свързани: старт в Production дава ясна грешка, БЕЗ тихо
   връщане към mock (иначе фалшиви данни ще минат за истински). */

const CRM_PROD_CACHE = { at: 0, companies: null, meta: null };
const CRM_PROD_TTL = 60000;   // 60 сек — Sheet-ът не се чука на всяко цъкане
function crmProdBust() { CRM_PROD_CACHE.at = 0; CRM_PROD_CACHE.companies = null; }

async function crmBridge(action, payload) {
  const cfg = window.DANKO_CONFIG || {};
  let token = cfg.SUPABASE_ANON_KEY;
  try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  let res, j;
  try {
    res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/crm-bridge", {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      body: JSON.stringify({ action, ...(payload || {}) }),
    });
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "CRM мостът не отговори до 25 сек (timeout)." : "Няма връзка с CRM моста (crm-bridge). Деплойната ли е функцията?");
  } finally { clearTimeout(t); }
  try { j = await res.json(); } catch (e) { throw new Error("CRM мостът върна невалиден отговор (не е JSON)."); }
  if (res.status === 401 || res.status === 403 || (j && j.error && j.error.code === "FORBIDDEN")) {
    throw new Error("Нямаш права за CRM данните (сървърна проверка). Провери allow-list-а в crm-bridge.");
  }
  if (!j || j.ok !== true) throw new Error((j && j.error && j.error.message) || `CRM мостът върна грешка (HTTP ${res.status}).`);
  return j;
}

/* snake_case договор → моделът на UI-я (ЕДИНСТВЕНОТО място на превода). */
function crmFromApi(r) {
  const normSt = s => String(s || "").trim().toUpperCase().replace(/\s+/g, "_");
  return {
    dateAdded: r.date_added || "", company: r.company || "", country: r.country || "",
    website: r.domain || r.website || "", websiteRaw: r.website || "", rowNumber: r.row_number,
    industry: r.industry || "", description: r.description || "", products: r.products || "", processes: r.processes || "",
    fitScore: Number(r.danko_fit_score) || 0, potentialOpportunity: r.potential_opportunity || "",
    status: normSt(r.status) || (r.stage2_needed ? "STAGE1" : "RESEARCH_COMPLETE"),
    statusRaw: r.status || "", stage2Needed: !!r.stage2_needed, outreachEligible: !!r.outreach_eligible,
    decisionMakerRole: r.decision_maker_role || "", contactPerson: r.contact_person || "", email: r.email || "",
    linkedin: r.linkedin || "", businessPhone: r.business_phone || "", contactSourceUrl: r.contact_source_url || "",
    salesApproach: r.sales_approach || "", verifiedFacts: r.verified_facts || "", inferences: r.inferences || "",
    sources: r.sources || "", notes: r.notes || "",
    outreachStatus: normSt(r.outreach_status), outreachDate: r.outreach_date || "",
    outreachEmail: r.outreach_email || "", outreachSubject: r.outreach_subject || "",
  };
}

const crmProdProvider = {
  async _companies() {
    if (CRM_PROD_CACHE.companies && Date.now() - CRM_PROD_CACHE.at < CRM_PROD_TTL) return CRM_PROD_CACHE.companies;
    const j = await crmBridge("companies");
    const list = (j.data || []).map(crmFromApi);
    CRM_PROD_CACHE.companies = list; CRM_PROD_CACHE.meta = j.meta || null; CRM_PROD_CACHE.at = Date.now();
    return list;
  },
  meta() { return CRM_PROD_CACHE.meta; },

  async getDashboard() {
    const all = await this._companies();
    // Изчислените полета от Sheet-а са авторитетни (Stage2 Needed / Outreach
    // Eligible); Status се показва суров и НЕ се преизчислява тук.
    const drafts = all.filter(c => c.outreachDate || ["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus));
    return {
      total: all.length,
      stage1: all.filter(c => c.stage2Needed).length,
      researchComplete: all.filter(c => !c.stage2Needed).length,
      outreachReady: all.filter(c => c.outreachEligible && !drafts.includes(c)).length,
      drafts: drafts.length,
      activities: (CRM_PROD_CACHE.meta && CRM_PROD_CACHE.meta.fetched_at) ? [{ at: new Date(CRM_PROD_CACHE.meta.fetched_at).toLocaleString("bg-BG"), text: `CRM прочетен на живо: ${all.length} компании (DANKO Sales Leads).` }] : [],
      pipeline: {
        new: all.filter(c => c.stage2Needed).length, stage1: all.filter(c => c.stage2Needed).length,
        stage2: 0, ready: all.filter(c => c.outreachEligible && !drafts.includes(c)).length, drafts: drafts.length,
      }
    };
  },
  async getCompanies(filters) { return crmApplyFilters((await this._companies()).slice(), filters); },
  async getCompany(website) {
    const all = await this._companies();
    const key = String(website || "").toLowerCase();
    return all.find(c => c.website.toLowerCase() === key || String(c.websiteRaw).toLowerCase().includes(key)) || null;
  },
  async getOutreachQueue() {
    const all = await this._companies();
    return {
      ready: all.filter(c => c.outreachEligible && !c.outreachStatus),
      drafts: all.filter(c => c.outreachStatus === "DRAFT_CREATED"),
      review: all.filter(c => c.outreachStatus === "NEEDS_REVIEW"),
      skipped: all.filter(c => c.outreachStatus === "SKIPPED"),
      missing: all.filter(c => c.outreachStatus === "MISSING_EMAIL" || (c.outreachEligible === false && !c.stage2Needed && !c.email)),
    };
  },
  async getTasks() {
    const all = await this._companies();
    const t = [];
    all.forEach(c => {
      if (!c.stage2Needed && !c.email) t.push({ type: "MISSING_EMAIL", company: c.company, website: c.website, text: "Research готов, но липсва потвърден имейл.", since: c.dateAdded });
      if (c.outreachEligible && !c.outreachStatus && (c.fitScore || 0) >= 90) t.push({ type: "STRONG_LEAD", company: c.company, website: c.website, text: `Fit ${c.fitScore}, Outreach Eligible — чака outreach.`, since: c.dateAdded });
      if (c.outreachStatus === "NEEDS_REVIEW") t.push({ type: "NEEDS_REVIEW", company: c.company, website: c.website, text: "Gmail Draft чака преглед.", since: c.outreachDate || c.dateAdded });
      if (c.stage2Needed && (c.fitScore || 0) >= 90) t.push({ type: "STRONG_LEAD", company: c.company, website: c.website, text: `Fit ${c.fitScore}, а Stage 2 още не е пуснат.`, since: c.dateAdded });
    });
    return t.slice(0, 40);
  },
  async getReports() {
    const all = await this._companies();
    const week = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const group = key => { const m = {}; all.forEach(c => { const k = c[key] || "—"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    return {
      newThisWeek: all.filter(c => String(c.dateAdded) >= week).length,
      qualified: all.filter(c => (c.fitScore || 0) >= 80).length,
      avgFit: all.length ? Math.round(all.reduce((s, c) => s + (c.fitScore || 0), 0) / all.length) : 0,
      researchComplete: all.filter(c => !c.stage2Needed).length,
      outreachEligible: all.filter(c => c.outreachEligible).length,
      drafts: all.filter(c => c.outreachDate || ["DRAFT_CREATED", "NEEDS_REVIEW"].includes(c.outreachStatus)).length,
      byCountry: group("country"), byIndustry: group("industry"), total: all.length
    };
  },

  /* ---- Фаза 2B: живи джобове. Стартът минава през crm-bridge (идемпотентно
     request_id), а състоянието се ЧЕТЕ от crm_jobs (RLS, само оторизираните).
     Supabase е истината — localStorage пази само последния job id за удобство.
     Прогресът е истинският от n8n: няма измислени проценти. ---- */
  async _startJob(action, params) {
    const request_id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const j = await crmBridge(action, { request_id, params });
    try { localStorage.setItem("crm_last_job", String(j.data.id)); } catch (e) {}
    return { job_id: j.data.id, duplicate: !!j.duplicate_request };
  },
  async startFullPipeline(p) { return this._startJob("start_full", p); },
  async startStage1(p) { return this._startJob("start_stage1", p); },
  async startStage2(websites) { return this._startJob("start_stage2", { requested_websites: websites }); },
  async startOutreach(websites) { return this._startJob("start_outreach", { requested_websites: websites }); },

  _jobFromRow(r) {
    if (!r) return null;
    const st = r.stages || {};
    const s = k => st[k] || {};
    const req = Number(r.params && r.params.target_count) || (r.params && r.params.requested_websites || []).length || 0;
    return {
      id: r.id, live: true, mode: r.mode === "FULL_PIPELINE" ? "full" : r.mode.toLowerCase(),
      status: r.status, params: r.params || {}, error: r.error || "",
      startedAt: new Date(r.created_at).getTime(), finishedAt: r.finished_at ? new Date(r.finished_at).getTime() : null,
      currentStage: r.current_stage || "", requested: req,
      stages: { stage1: s("stage1"), stage2: s("stage2"), outreach: s("outreach") },
      stage1Done: Number(s("stage1").completed) || 0, stage2Done: Number(s("stage2").completed) || 0,
      draftsDone: Number(r.drafts_created) || 0, emailsSent: Number(r.emails_sent) || 0,
      companies: (r.companies || []).map(c => ({
        website: c.website || "", company: c.company || c.website || "?", country: c.country || "",
        fitScore: Number(c.fit_score) || 0, phase: c.phase || c.outcome || "", outcome: c.outcome || "", note: c.note || "", draftLink: c.draft_link || "",
      })),
    };
  },
  async getPipelineRuns() {
    const { data, error } = await sb.from("crm_jobs").select("*").order("created_at", { ascending: false }).limit(25);
    if (error) {
      if (/relation .*crm_jobs/i.test(error.message || "")) return [];   // таблицата още не е пусната
      throw new Error("Джобовете не се четат: " + error.message);
    }
    return (data || []).map(r => this._jobFromRow(r));
  },
  async getPipelineRun(jobId) {
    const { data, error } = await sb.from("crm_jobs").select("*").eq("id", jobId).maybeSingle();
    if (error) throw new Error("Джобът не се чете: " + error.message);
    return this._jobFromRow(data);
  },
  async getExecutionStatus(jobId) { return this.getPipelineRun(jobId); },
};

/* Единственият вход за UI-я. */
const salesAgentApi = new Proxy({}, {
  get: (_t, prop) => {
    const p = crmApiMode() === "n8n" ? crmProdProvider : crmMockProvider;
    const v = p[prop];
    return typeof v === "function" ? v.bind(p) : v;
  }
});
