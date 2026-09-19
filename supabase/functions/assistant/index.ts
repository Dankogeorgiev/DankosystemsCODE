// Данко Системс — Edge функция „assistant": сигурен посредник към Claude API.
// Ключът ANTHROPIC_API_KEY стои тук (в секретите на Supabase), НЕ в браузъра.
// Достъпът е само за влезли потребители (Supabase проверява JWT автоматично).
//
// Качване:
//   1) Supabase Dashboard → Edge Functions → Deploy a new function → име: assistant
//      → постави съдържанието на този файл.
//   2) Project Settings → Edge Functions → Secrets → добави ANTHROPIC_API_KEY = sk-ant-...
//   (или през CLI: supabase functions deploy assistant && supabase secrets set ANTHROPIC_API_KEY=...)

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// По-евтин и бърз модел за помощ. За по-сложни разсъждения смени на "claude-sonnet-5".
const MODEL = "claude-haiku-4-5-20251001";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Ползвай POST." }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "Липсва ANTHROPIC_API_KEY в секретите на функцията." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Невалиден JSON." }, 400); }
  const { system, messages, max_tokens } = body || {};
  if (!Array.isArray(messages) || !messages.length) return json({ error: "Липсват съобщения." }, 400);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(Number(max_tokens) || 1024, 2048),
        system: String(system || ""),
        messages,
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || ("Claude API грешка (" + r.status + ")") }, r.status);
    const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
    return json({ text });
  } catch (e) {
    return json({ error: "Грешка при връзка с Claude: " + String((e as any)?.message || e) }, 502);
  }
});
