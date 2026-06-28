// ============================================================
// Данко Системс — изпращане на запитване по имейл (Brevo HTTP API)
// Supabase Edge Function. Ключът НЕ е в кода — чете се от тайните
// ключове (secrets) в Supabase.
//
// Деплой:  supabase functions deploy send-inquiry
// Тайни:   BREVO_API_KEY, FROM_EMAIL, FROM_NAME
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Невалидни данни" }, 400);
  }

  const to: string[] = Array.isArray(payload.to) ? payload.to.filter((e: string) => e && e.includes("@")) : [];
  const subject: string = (payload.subject || "").toString();
  const html: string = (payload.html || "").toString();
  const text: string = (payload.text || "").toString();
  const replyTo: string = (payload.replyTo || "").toString();

  if (!to.length) return json({ error: "Няма валидни получатели" }, 400);
  if (!subject) return json({ error: "Липсва тема" }, 400);

  const apiKey = (Deno.env.get("BREVO_API_KEY") || "").trim();
  const fromEmail = (Deno.env.get("FROM_EMAIL") || "").trim();
  const fromName = (Deno.env.get("FROM_NAME") || "Данко Системс").trim();

  if (!apiKey || !fromEmail) {
    return json({ error: "Сървърът не е настроен (липсва BREVO_API_KEY или FROM_EMAIL)." }, 500);
  }

  // Получателите са в BCC (скрити един от друг); видим получател е самата поща.
  const body: any = {
    sender: { email: fromEmail, name: fromName },
    to: [{ email: fromEmail, name: fromName }],
    bcc: to.map((e) => ({ email: e })),
    subject,
    textContent: text || "Запитване от Данко Системс",
  };
  if (html) body.htmlContent = html;
  if (replyTo) body.replyTo = { email: replyTo };

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) return json({ ok: true, sent: to.length, id: (data as any).messageId || "" });
    return json({ error: "Brevo отказа (" + resp.status + "): " + ((data as any).message || JSON.stringify(data)) }, 502);
  } catch (err) {
    return json({ error: "Грешка при връзка с Brevo: " + ((err as any)?.message || String(err)) }, 502);
  }
});
