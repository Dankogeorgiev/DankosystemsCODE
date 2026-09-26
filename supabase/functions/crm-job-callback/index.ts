// ============================================================
// Данко Системс — Edge функция „crm-job-callback": СЪРВЪР-КЪМ-СЪРВЪР
// callback-ът, с който n8n Pipeline Runner обновява джобовете в crm_jobs.
//
//   n8n → x-callback-secret → crm-job-callback → crm_jobs (service role)
//
// САМО action "job_update". НИЩО друго: без CRM четене, без стартиране,
// без Sheets/Gmail/AI. Браузърният път (потребител → crm-bridge) остава
// какъвто си е — тази функция е отделна врата само за n8n.
//
// Деплой: Supabase → Edge Functions → New → име: crm-job-callback → този файл.
//   ⚠ ВАЖНО: Verify JWT = OFF (САМО за тази функция!) — n8n няма потребителски
//   JWT; пази я тайният header. crm-bridge си остава с Verify JWT ON.
//   (Настройката: функцията → Details/Settings → „Verify JWT with legacy
//   secret" / „Enforce JWT verification" → изключи → Save.)
// Тайни: N8N_CALLBACK_SECRET (същата, която n8n праща в x-callback-secret).
//   SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY се подават автоматично.
//
// Договор:  POST {action:"job_update", job_id:"<uuid>", patch:{...}}
//   → {ok:true, data:<обновеният джоб>} | {ok:false, error:{code,message}}
// Правила: джобът трябва да СЪЩЕСТВУВА (никакво създаване оттук — това е
// работа на удостоверения старт път); полетата са в бял списък; stages се
// СЛИВА; emails_sent не се приема (и базата има CHECK = 0); терминален
// статус си слага finished_at сам.
// ============================================================

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), { headers: { "content-type": "application/json" } });
}
function fail(code: string, message: string, status = 400): Response {
  // Никакви стекове/тайни навън — подробното отива в server лога.
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers: { "content-type": "application/json" } });
}

function sbHeaders(): Record<string, string> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
}
async function jobsReq(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/crm_jobs${path}`, { ...init, headers: { ...sbHeaders(), ...(init.headers || {}) } });
}
async function jobById(id: string): Promise<Record<string, unknown> | null> {
  const r = await jobsReq(`?id=eq.${encodeURIComponent(id)}&limit=1`, { method: "GET" });
  const arr = r.ok ? await r.json() : [];
  return arr[0] || null;
}

// Бял списък: САМО изпълнение/прогрес. Идентичност, вход и собственик
// (id, request_id, created_by_email, mode, params, created_at) са недосегаеми.
// emails_sent УМИШЛЕНО липсва — базата и без това има CHECK (emails_sent = 0).
const PATCHABLE = new Set(["status", "current_stage", "progress_percent", "stages", "companies", "drafts_created", "result", "error", "n8n_execution_id", "finished_at"]);
const JOB_STATUSES = new Set(["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]);
const STAGE_STATUSES = new Set(["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "SKIPPED"]);

function validatePatch(raw: Record<string, unknown>): { patch?: Record<string, unknown>; err?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { err: "patch трябва да е обект." };
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    if (!PATCHABLE.has(k)) continue;                       // чуждите полета тихо отпадат
    patch[k] = raw[k];
  }
  if (patch.status !== undefined && !JOB_STATUSES.has(String(patch.status))) {
    return { err: `Невалиден status „${String(patch.status)}". Позволени: ${[...JOB_STATUSES].join(", ")}.` };
  }
  if (patch.progress_percent !== undefined) {
    const p = Number(patch.progress_percent);
    if (!isFinite(p) || p < 0 || p > 100) return { err: "progress_percent трябва да е 0..100." };
    patch.progress_percent = Math.round(p);
  }
  if (patch.stages !== undefined) {
    if (typeof patch.stages !== "object" || Array.isArray(patch.stages)) return { err: "stages трябва да е обект." };
    for (const [name, sg] of Object.entries(patch.stages as Record<string, unknown>)) {
      if (!sg || typeof sg !== "object") return { err: `stages.${name} трябва да е обект.` };
      const st = (sg as Record<string, unknown>).status;
      if (st !== undefined && !STAGE_STATUSES.has(String(st))) {
        return { err: `Невалиден статус на етап „${String(st)}". Позволени: ${[...STAGE_STATUSES].join(", ")}.` };
      }
    }
  }
  if (patch.companies !== undefined && !Array.isArray(patch.companies)) return { err: "companies трябва да е масив." };
  if (patch.drafts_created !== undefined) {
    const d = Number(patch.drafts_created);
    if (!Number.isInteger(d) || d < 0) return { err: "drafts_created трябва да е цяло число ≥ 0." };
  }
  if (!Object.keys(patch).length) return { err: "patch не съдържа нито едно позволено поле." };
  return { patch };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("METHOD", "Ползвай POST.", 405);

  // Проверката на тайната е ПЪРВА — преди каквото и да е четене на базата.
  const secret = Deno.env.get("N8N_CALLBACK_SECRET") || "";
  const got = req.headers.get("x-callback-secret") || "";
  if (!secret) return fail("NOT_CONFIGURED", "N8N_CALLBACK_SECRET не е настроен в секретите.", 500);
  if (!got || got !== secret) {
    console.warn("crm-job-callback: отказан (грешен/липсващ x-callback-secret)");
    return fail("FORBIDDEN", "Невалиден callback secret.", 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_) { return fail("BAD_REQUEST", "Тялото не е валиден JSON."); }
  if (String(body.action || "") !== "job_update") {
    return fail("BAD_REQUEST", `Тази функция поддържа само action "job_update".`);
  }
  const id = String(body.job_id || "").trim();
  if (!id) return fail("BAD_REQUEST", "Липсва job_id.");

  const cur = await jobById(id);
  if (!cur) return fail("NOT_FOUND", "Няма джоб с това id — callback-ът НЕ създава джобове.", 404);

  const { patch, err } = validatePatch((body.patch || {}) as Record<string, unknown>);
  if (err) return fail("INVALID_PATCH", err, 422);
  const p = patch as Record<string, unknown>;

  // stages се слива с наличното — n8n праща само променения етап.
  if (p.stages) p.stages = { ...(cur.stages as Record<string, unknown> || {}), ...(p.stages as Record<string, unknown>) };
  if (["COMPLETED", "PARTIAL", "FAILED"].includes(String(p.status || "")) && !p.finished_at) {
    p.finished_at = new Date().toISOString();
  }

  const r = await jobsReq(`?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(p),
  });
  if (!r.ok) {
    console.error("crm-job-callback PATCH:", r.status, (await r.text()).slice(0, 200));
    return fail("DB_ERROR", "Джобът не се обнови.", 500);
  }
  const arr = await r.json();
  return ok(arr[0] || null);
});
