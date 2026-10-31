// ============================================================
// Данко Системс — Edge функция „crm-bridge": мостът на DANKO Sales Agent.
// ФАЗА 2A: САМО ЧЕТЕНЕ. Браузърът вика ТАЗИ функция; тя проверява кой си
// (Supabase JWT + allow-list) и чете CRM-а през n8n READ webhook-а.
// Никакви Google/n8n ключове не стигат до браузъра.
//
//   Браузър → crm-bridge (JWT + allow-list) → n8n webhook → Google Sheet
//                                              „DANKO Sales Leads" / Qualified Leads
//
// ЗАБРАНЕНО в тази фаза (и функцията ФИЗИЧЕСКИ не го може): писане в CRM,
// Stage 1/2, Outreach, Gmail драфтове, изпращане на имейли.
//
// Деплой: Supabase → Edge Functions → New → име: crm-bridge → този файл.
//   Verify JWT: ON (вика се само от влезли потребители; n8n callback-ът
//   праща anon ключа като Bearer + таен header x-callback-secret).
// Тайни (Edge Functions → Secrets):
//   N8N_READ_URL     = production URL на n8n READ webhook-а (Фаза 2A)
//   N8N_READ_SECRET  = тайната на READ webhook-а (header x-read-key)
//   N8N_START_URL    = production URL на n8n „DANKO Pipeline Runner" webhook-а
//   N8N_START_SECRET = тайната му (header x-start-key)
//   N8N_CALLBACK_SECRET = тайната, с която n8n ОБНОВЯВА джобовете тук
//                     (header x-callback-secret) — виж crm-jobs-n8n-runner.md
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY — автоматични.
//
// ФАЗА 2B — договор:
//   Четене:  {action:"ping"|"companies"|"company"}         (както Фаза 2A)
//   Старт:   {action:"start_full"|"start_stage1"|"start_stage2"|"start_outreach",
//             request_id:"uuid", params:{...}} → {ok, data: job, duplicate_request?}
//            Идемпотентност: същото request_id НИКОГА не пуска втори джоб —
//            unique constraint в crm_jobs + връщане на съществуващия.
//            Отговорът се връща ВЕДНАГА (n8n само потвърждава старта);
//            пайплайнът тече независимо и пише прогреса си тук.
//   Callback (само n8n): {action:"job_update", job_id, patch:{...}} +
//            header x-callback-secret. Полетата са в бял списък;
//            emails_sent НЕ може да се пипа (и базата има CHECK = 0).
// ============================================================

// Кой има достъп до CRM данните (сървърната истина — списъкът в браузъра
// само крие бутона). Дръж двата списъка еднакви: тук и CRM_EMAILS в crm-sales.js.
const CRM_ALLOWED = new Set([
  "dankog@gmail.com",
  "grigor.baykov@dankosystems.com",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function ok(data: unknown, meta?: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data, meta }), { headers: { ...CORS, "content-type": "application/json" } });
}
function fail(code: string, message: string, status = 400): Response {
  // Никакви стекове/вътрешни грешки към браузъра — подробното отива в лога.
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers: { ...CORS, "content-type": "application/json" } });
}

// --- Кой пита? Проверка през Supabase Auth (НЕ вярваме на имейл от тялото). ---
async function userEmail(req: Request): Promise<string> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return "";
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "" },
  });
  if (!res.ok) return "";
  const j = await res.json().catch(() => ({}));
  return String(j && j.email || "").toLowerCase();
}

// --- Нормализации ---
function normDomain(website: string): string {
  return String(website || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/\s.*$/, "");
}
function normBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return /^(true|yes|да|y|1)$/i.test(String(v ?? "").trim());
}
function normScore(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(",", "."));
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}

// ЕДИНСТВЕНОТО място на мапването: колона в Sheet-а ↔ поле в договора.
// Имената на колоните в Sheet-а са АВТОРИТЕТНИ — четем ги от реалните редове
// (n8n Google Sheets node връща обект с ключове = header row). Ако колона
// липсва → null + доклад в meta.missing_fields (нищо не се измисля).
// Имената по-долу са СВЕРЕНИ с реалния ред 1 на Qualified Leads (22.09.2026,
// Данко ги прати дословно) — не ги „оправяй" по памет.
const FIELD_MAP: [string, string][] = [
  ["Date Added", "date_added"], ["Company", "company"], ["Country", "country"],
  ["Website", "website"], ["Industry", "industry"], ["Company Description", "description"],
  ["Potential Products for Danko", "products"], ["Relevant Danko Processes", "processes"],
  ["DANKO Fit Score", "danko_fit_score"], ["Estimated Annual Opportunity EUR", "potential_opportunity"],
  ["Status", "status"],
  ["Decision Maker Role", "decision_maker_role"], ["Contact Person", "contact_person"],
  ["Email", "email"], ["LinkedIn", "linkedin"], ["Business Phone", "business_phone"],
  ["Contact Source URL", "contact_source_url"], ["Sales Approach", "sales_approach"],
  ["Verified Facts", "verified_facts"], ["Inferences", "inferences"],
  ["Sources", "sources"], ["Notes", "notes"],
  ["Outreach Status", "outreach_status"], ["Outreach Date", "outreach_date"],
  ["Outreach Email", "outreach_email"], ["Outreach Subject", "outreach_subject"],
  ["Stage2 Needed", "stage2_needed"], ["Outreach Eligible", "outreach_eligible"],
];

// Търпим дребни разлики: точното име първо, после без главни/интервали.
function headerIndex(row: Record<string, unknown>): Map<string, string> {
  const idx = new Map<string, string>();
  const keys = Object.keys(row || {});
  const loose = new Map(keys.map(k => [k.toLowerCase().replace(/\s+/g, " ").trim(), k]));
  for (const [sheetName] of FIELD_MAP) {
    if (keys.includes(sheetName)) idx.set(sheetName, sheetName);
    else {
      const hit = loose.get(sheetName.toLowerCase());
      if (hit) idx.set(sheetName, hit);
    }
  }
  return idx;
}

function normalizeRows(rows: Record<string, unknown>[]): { companies: Record<string, unknown>[]; meta: Record<string, unknown> } {
  const first = rows.find(r => r && Object.keys(r).length) || {};
  const idx = headerIndex(first);
  const missing = FIELD_MAP.filter(([s]) => !idx.has(s)).map(([s]) => s);
  const companies: Record<string, unknown>[] = [];
  const seen = new Map<string, number>();
  const dupes: string[] = [];
  rows.forEach((r, i) => {
    const get = (sheetName: string) => { const k = idx.get(sheetName); return k != null ? String(r[k] ?? "").trim() : ""; };
    const company = get("Company"), website = get("Website");
    // Запис = реално попълнена компания. ARRAYFORMULA „опашката" (редове само
    // с формулни полета) НЕ е компания — затова НЕ броим по дължина на диапазона.
    if (!company && !website) return;
    const domain = normDomain(website) || normDomain(company);
    if (seen.has(domain)) dupes.push(domain); else seen.set(domain, i);
    const out: Record<string, unknown> = { id: domain, row_number: i + 2, domain };   // ред 1 = header
    for (const [sheetName, api] of FIELD_MAP) out[api] = get(sheetName) || null;
    out.danko_fit_score = normScore(out.danko_fit_score);
    out.stage2_needed = normBool(out.stage2_needed);
    out.outreach_eligible = normBool(out.outreach_eligible);
    companies.push(out);
  });
  return {
    companies,
    meta: {
      count: companies.length, unique_domains: seen.size, duplicate_domains: dupes,
      missing_fields: missing, headers_seen: Object.keys(first),
      fetched_at: new Date().toISOString(), source: "n8n → DANKO Sales Leads / Qualified Leads",
    },
  };
}

// --- Четене от n8n (единственият изход навън; READ-ONLY workflow) ---
let CACHE: { at: number; body: { companies: Record<string, unknown>[]; meta: Record<string, unknown> } } | null = null;
const CACHE_MS = 30000;

async function fetchCrm(): Promise<{ companies: Record<string, unknown>[]; meta: Record<string, unknown> }> {
  if (CACHE && Date.now() - CACHE.at < CACHE_MS) return CACHE.body;
  const url = Deno.env.get("N8N_READ_URL") || "";
  const secret = Deno.env.get("N8N_READ_SECRET") || "";
  if (!url) throw { code: "NOT_CONFIGURED", message: "N8N_READ_URL не е настроен в секретите на crm-bridge." };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json", "x-read-key": secret }, body: "{}" });
  } catch (e) {
    console.error("n8n read failed:", String(e));
    throw { code: "BACKEND_DOWN", message: "n8n READ endpoint-ът не отговори (timeout/мрежа)." };
  } finally { clearTimeout(t); }
  if (!res.ok) {
    console.error("n8n read HTTP", res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw { code: "BACKEND_ERROR", message: `n8n READ endpoint-ът върна HTTP ${res.status}.` };
  }
  const j = await res.json().catch(() => null);
  // n8n връща масив от редове (или {rows:[...]}). Всичко друго = malformed.
  const rows = Array.isArray(j) ? j : (j && Array.isArray(j.rows) ? j.rows : (j && Array.isArray(j.data) ? j.data : null));
  if (!rows) throw { code: "MALFORMED", message: "n8n върна неочакван формат (очаквам масив от редове)." };
  const body = normalizeRows(rows as Record<string, unknown>[]);
  CACHE = { at: Date.now(), body };
  return body;
}

// ================= ДЖОБОВЕ (Фаза 2B) =================
function sbHeaders(): Record<string, string> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}
async function jobsReq(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/crm_jobs${path}`, { ...init, headers: { ...sbHeaders(), ...(init.headers || {}) } });
}
async function jobByRequestId(requestId: string): Promise<Record<string, unknown> | null> {
  const r = await jobsReq(`?request_id=eq.${encodeURIComponent(requestId)}&limit=1`, { method: "GET" });
  const arr = r.ok ? await r.json() : [];
  return arr[0] || null;
}
async function jobById(id: string): Promise<Record<string, unknown> | null> {
  const r = await jobsReq(`?id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET" });
  const arr = r.ok ? await r.json() : [];
  return arr[0] || null;
}
async function jobPatch(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const r = await jobsReq(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(patch) });
  if (!r.ok) { console.error("jobPatch:", r.status, (await r.text()).slice(0, 200)); return null; }
  const arr = await r.json();
  return arr[0] || null;
}

const START_MODES: Record<string, string> = {
  start_full: "FULL_PIPELINE", start_stage1: "STAGE1", start_stage2: "STAGE2", start_outreach: "OUTREACH",
};

// Валидация: fail closed. Границите са по заданието (target ≤ 10, Fit 65-100).
function validateStart(mode: string, p: Record<string, unknown>): string | null {
  if (mode === "FULL_PIPELINE" || mode === "STAGE1") {
    if (!String(p.country || "").trim()) return "Липсва държава (country).";
    const n = Number(p.target_count);
    if (!Number.isInteger(n) || n < 1 || n > 10) return "Брой компании: цяло число от 1 до 10.";
    const f = Number(p.min_fit_score);
    if (!isFinite(f) || f < 65 || f > 100) return "Минимален Fit Score: между 65 и 100.";
  } else {
    const ws = Array.isArray(p.requested_websites) ? p.requested_websites.filter((x) => String(x).trim()) : [];
    if (!ws.length) return "INVALID_INPUT: празен списък компании — Stage 2/Outreach искат конкретни домейни (0 действия).";
    if (ws.length > 10) return "Максимум 10 компании на джоб.";
  }
  return null;
}

async function startJob(email: string, action: string, requestId: string, rawParams: Record<string, unknown>): Promise<Response> {
  const mode = START_MODES[action];
  if (!requestId || requestId.length < 8) return fail("BAD_REQUEST", "Липсва request_id (идемпотентният ключ).");
  const p = rawParams || {};
  const verr = validateStart(mode, p);
  if (verr) return fail("INVALID_INPUT", verr, 422);
  // Идемпотентност (сървърна): опит за INSERT; unique(request_id) отбива дубъла.
  const params = {
    country: String(p.country || "").trim() || null,
    target_count: Number(p.target_count) || (Array.isArray(p.requested_websites) ? p.requested_websites.length : null),
    min_fit_score: Number(p.min_fit_score) || null,
    industry_focus: String(p.industry_focus || "").trim() || null,
    exclude_industries: String(p.exclude_industries || "").trim() || null,
    requested_websites: Array.isArray(p.requested_websites) ? p.requested_websites.map((x) => normDomain(String(x))).filter(Boolean) : null,
  };
  const ins = await jobsReq("", {
    method: "POST", headers: { prefer: "return=representation" },
    body: JSON.stringify({ request_id: requestId, created_by_email: email, mode, status: "QUEUED", params, current_stage: "старт" }),
  });
  if (ins.status === 409) {
    const existing = await jobByRequestId(requestId);
    if (existing) return new Response(JSON.stringify({ ok: true, duplicate_request: true, data: existing }), { headers: { ...CORS, "content-type": "application/json" } });
    return fail("CONFLICT", "Дублирано request_id, но джобът не се намери.", 409);
  }
  if (!ins.ok) {
    const t = (await ins.text()).slice(0, 200);
    console.error("job insert:", ins.status, t);
    if (/relation .*crm_jobs.* does not exist/i.test(t)) return fail("NOT_CONFIGURED", "Таблицата crm_jobs я няма — пусни crm-jobs-setup.sql.", 500);
    return fail("DB_ERROR", "Джобът не се записа в базата.", 500);
  }
  const job = (await ins.json())[0];

  // Стартираме n8n Runner-а: той САМО потвърждава (Respond веднага) и
  // продължава пайплайна сам — тази заявка НЕ чака Stage 1/2/Outreach.
  const startUrl = Deno.env.get("N8N_START_URL") || "";
  if (!startUrl) {
    await jobPatch(job.id, { status: "FAILED", error: "N8N_START_URL не е настроен в секретите на crm-bridge.", finished_at: new Date().toISOString() });
    return fail("NOT_CONFIGURED", "Стартирането още не е свързано: N8N_START_URL липсва в секретите.", 500);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(startUrl, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-start-key": Deno.env.get("N8N_START_SECRET") || "" },
      body: JSON.stringify({ job_id: job.id, request_id: requestId, mode, params }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
  } catch (e) {
    console.error("n8n start failed:", String(e));
    const failed = await jobPatch(job.id, { status: "FAILED", error: "n8n Runner-ът не прие старта (" + String(e).slice(0, 80) + "). Безопасно е да опиташ пак със СЪЩОТО request_id.", finished_at: new Date().toISOString() });
    return new Response(JSON.stringify({ ok: false, error: { code: "N8N_START_FAILED", message: "n8n не прие старта — джобът е маркиран FAILED, нищо не е пуснато." }, data: failed }), { status: 502, headers: { ...CORS, "content-type": "application/json" } });
  } finally { clearTimeout(t); }
  await jobPatch(job.id, { status: "RUNNING", current_stage: "изпратен към n8n" });
  return ok({ ...job, status: "RUNNING" });
}

// n8n callback: обновява джоб. Само с валиден x-callback-secret; полетата са
// в бял списък — emails_sent умишлено ЛИПСВА (и базата има CHECK = 0).
const PATCHABLE = new Set(["status", "current_stage", "progress_percent", "stages", "companies", "drafts_created", "result", "error", "n8n_execution_id", "finished_at"]);
async function jobUpdate(body: Record<string, unknown>): Promise<Response> {
  const id = String(body.job_id || "");
  if (!id) return fail("BAD_REQUEST", "Липсва job_id.");
  const cur = await jobById(id);
  if (!cur) return fail("NOT_FOUND", "Няма такъв джоб.", 404);
  const raw = (body.patch || {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (PATCHABLE.has(k)) patch[k] = raw[k];
  // stages се слива (n8n праща само променения етап, старите не се губят)
  if (patch.stages && typeof patch.stages === "object") {
    patch.stages = { ...(cur.stages as Record<string, unknown> || {}), ...(patch.stages as Record<string, unknown>) };
  }
  if (["COMPLETED", "PARTIAL", "FAILED"].includes(String(patch.status || "")) && !patch.finished_at) {
    patch.finished_at = new Date().toISOString();
  }
  const upd = await jobPatch(id, patch);
  return upd ? ok(upd) : fail("DB_ERROR", "Джобът не се обнови.", 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("METHOD", "Ползвай POST.", 405);

  let bodyEarly: Record<string, unknown> = {};
  try { bodyEarly = await req.clone().json(); } catch (_) { /* ок */ }

  // n8n callback-ът се удостоверява със СПОДЕЛЕНАТА ТАЙНА, не с потребител.
  if (String(bodyEarly.action || "") === "job_update") {
    const secret = Deno.env.get("N8N_CALLBACK_SECRET") || "";
    if (!secret || req.headers.get("x-callback-secret") !== secret) {
      console.warn("job_update с грешен callback secret");
      return fail("FORBIDDEN", "Невалиден callback secret.", 403);
    }
    return jobUpdate(bodyEarly);
  }

  const email = await userEmail(req);
  if (!email) return fail("UNAUTHENTICATED", "Не си влязъл в Системата.", 401);
  if (!CRM_ALLOWED.has(email)) {
    console.warn("crm-bridge отказан достъп:", email);
    return fail("FORBIDDEN", "Нямаш достъп до DANKO Sales Agent данните.", 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* празно тяло — ок за ping */ }
  const action = String(body.action || "");

  try {
    if (action === "ping") {
      return ok({ pong: true, configured: !!Deno.env.get("N8N_READ_URL") }, { user: email });
    }
    if (action === "companies") {
      const { companies, meta } = await fetchCrm();
      return ok(companies, meta);
    }
    if (action === "company") {
      const dom = normDomain(String(body.domain || ""));
      if (!dom) return fail("BAD_REQUEST", "Липсва domain.");
      const { companies, meta } = await fetchCrm();
      const hit = companies.find(c => c.domain === dom) || null;
      return hit ? ok(hit, meta) : fail("NOT_FOUND", `Няма компания с домейн ${dom}.`, 404);
    }
    if (START_MODES[action]) {
      return startJob(email, action, String(body.request_id || ""), (body.params || {}) as Record<string, unknown>);
    }
    return fail("BAD_REQUEST", `Непознато action „${action}". Позволени: ping, companies, company, start_full, start_stage1, start_stage2, start_outreach.`);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err && err.code) return fail(err.code, err.message || "Грешка.", 502);
    console.error("crm-bridge:", String(e));
    return fail("INTERNAL", "Вътрешна грешка в CRM моста (виж логовете на функцията).", 500);
  }
});
