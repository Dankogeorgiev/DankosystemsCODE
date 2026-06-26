// ============================================================
// Данко Системс — изпращане на запитване по имейл (SMTP)
// Supabase Edge Function. Паролата НЕ е в кода — чете се от
// тайните ключове (secrets), зададени в Supabase.
//
// Деплой:  supabase functions deploy send-inquiry
// Тайни:   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL, FROM_NAME
// ============================================================

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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

  const host = Deno.env.get("SMTP_HOST") || "";
  const port = Number(Deno.env.get("SMTP_PORT") || "465");
  const user = Deno.env.get("SMTP_USER") || "";
  const pass = Deno.env.get("SMTP_PASS") || "";
  const fromEmail = Deno.env.get("FROM_EMAIL") || user;
  const fromName = Deno.env.get("FROM_NAME") || "Данко Системс";

  if (!host || !user || !pass) {
    return json({ error: "Сървърът не е настроен (липсват SMTP тайни ключове)." }, 500);
  }

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port,
      tls: port === 465, // 465 = директен TLS
      auth: { username: user, password: pass },
    },
  });

  try {
    await client.send({
      from: `${fromName} <${fromEmail}>`,
      to: fromEmail,            // видим получател — самата поща на запитванията
      bcc: to,                  // доставчиците са скрити един от друг
      replyTo: replyTo || undefined,
      subject,
      content: text || "Запитване от Данко Системс",
      html: html || undefined,
    });
    await client.close();
    return json({ ok: true, sent: to.length });
  } catch (err) {
    try { await client.close(); } catch (_) {}
    return json({ error: "Грешка при изпращане: " + (err?.message || String(err)) }, 502);
  }
});
