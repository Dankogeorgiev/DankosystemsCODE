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
//   Verify JWT: ON (вика се само от влезли потребители).
// Тайни (Edge Functions → Secrets):
//   N8N_READ_URL    = production URL на n8n READ webhook-а (виж
//                     crm-bridge-n8n-setup.md за рецептата на workflow-а)
//   N8N_READ_SECRET = дълъг случаен низ; СЪЩИЯТ се слага в n8n Header Auth
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY — автоматични.
//
// Договор: POST {action:"companies"} | {action:"company", domain:"..."} |
//          {action:"ping"} → {ok:true, data, meta} | {ok:false, error:{code,message}}
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("METHOD", "Ползвай POST.", 405);

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
    return fail("BAD_REQUEST", `Непознато action „${action}". Позволени: ping, companies, company.`);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err && err.code) return fail(err.code, err.message || "Грешка.", 502);
    console.error("crm-bridge:", String(e));
    return fail("INTERNAL", "Вътрешна грешка в CRM моста (виж логовете на функцията).", 500);
  }
});
