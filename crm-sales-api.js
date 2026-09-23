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
    const f = filters || {};
    const q = String(f.q || "").toLowerCase();
    if (q) list = list.filter(c => [c.company, c.website, c.country, c.industry, c.contactPerson].join(" ").toLowerCase().includes(q));
    if (f.country) list = list.filter(c => c.country === f.country);
    if (f.industry) list = list.filter(c => c.industry === f.industry);
    if (f.status) list = list.filter(c => c.status === f.status);
    if (f.fitMin) list = list.filter(c => (c.fitScore || 0) >= Number(f.fitMin));
    if (f.stage2 === "needed") list = list.filter(c => c.stage2Needed);
    if (f.stage2 === "done") list = list.filter(c => !c.stage2Needed && c.status === "RESEARCH_COMPLETE");
    if (f.outreachEligible === "yes") list = list.filter(c => c.outreachEligible);
    if (f.outreachEligible === "no") list = list.filter(c => !c.outreachEligible);
    if (f.outreachStatus) list = list.filter(c => (c.outreachStatus || "") === f.outreachStatus);
    return list.sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)) || (b.fitScore || 0) - (a.fitScore || 0));
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

/* ================= N8N ДОСТАВЧИК (бъдещ) =================
   НЕ измисляме production адреси. Когато Данко даде контролираните
   endpoints (n8n webhooks или Edge функция-мост), се попълват ТУК —
   и никъде другаде. Дотогава всеки метод отказва ясно. */
const crmN8nProvider = new Proxy({}, {
  get: (_t, prop) => async () => {
    throw new Error(`Режим „Production (n8n)" още не е свързан — методът ${String(prop)} чака реалните endpoints. Върни на Mock от Настройки.`);
  }
});

/* Единственият вход за UI-я. */
const salesAgentApi = new Proxy({}, {
  get: (_t, prop) => {
    const p = crmApiMode() === "n8n" ? crmN8nProvider : crmMockProvider;
    const v = p[prop];
    return typeof v === "function" ? v.bind(p) : v;
  }
});
