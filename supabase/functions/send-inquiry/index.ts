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

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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

  // .trim() маха случайни интервали/нов ред, промъкнали се при въвеждане на тайните ключове
  const host = (Deno.env.get("SMTP_HOST") || "").trim();
  const port = Number((Deno.env.get("SMTP_PORT") || "465").trim());
  const user = (Deno.env.get("SMTP_USER") || "").trim();
  const pass = (Deno.env.get("SMTP_PASS") || "").trim();
  const fromEmail = (Deno.env.get("FROM_EMAIL") || user).trim();
  const fromName = (Deno.env.get("FROM_NAME") || "Данко Системс").trim();

  if (!host || !user || !pass) {
    return json({ error: "Сървърът не е настроен (липсват SMTP тайни ключове)." }, 500);
  }

  const message = {
    from: `${fromName} <${fromEmail}>`,
    to: fromEmail,            // видим получател — самата поща на запитванията
    bcc: to,                  // доставчиците/админът са скрити един от друг
    replyTo: replyTo || undefined,
    subject,
    content: text || "Запитване от Данко Системс",
    html: html || undefined,
  };

  // Опитваме конфигурирания порт, после алтернативния (465 ⇄ 587). По 2 опита всеки.
  const altPort = port === 465 ? 587 : 465;
  const conns = [
    { hostname: host, port, tls: port === 465 },
    { hostname: host, port: altPort, tls: altPort === 465 },
  ];

  let lastErr = "";
  for (const conn of conns) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = new SMTPClient({ connection: { ...conn, auth: { username: user, password: pass } } });
      try {
        await client.send(message);
        try { await client.close(); } catch (_) { /* ignore */ }
        return json({ ok: true, sent: to.length, via: `${conn.hostname}:${conn.port}` });
      } catch (err) {
        lastErr = (err && (err as any).message) || String(err);
        try { await client.close(); } catch (_) { /* ignore */ }
        // Ако е грешка в данните за вход, няма смисъл да опитваме повече
        if (/535|authentication|auth|credential|password/i.test(lastErr)) {
          return json({ error: "Грешни данни за вход в пощата (SMTP 535). Провери паролата (SMTP_PASS). [" + lastErr + "]" }, 502);
        }
        await sleep(400);
      }
    }
  }
  return json({
    error: "Изпращането не успя след няколко опита: " + lastErr +
      ` [потр=${user} · дължина_парола=${pass.length} · сървър=${host} · портове=${port}/${altPort}]`,
  }, 502);
});
