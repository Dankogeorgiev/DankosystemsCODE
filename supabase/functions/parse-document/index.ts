// Данко Системс — Edge функция „parse-document": сигурно разчитане на документ
// (клиентска заявка PDF/снимка) с Claude. Ключът ANTHROPIC_API_KEY стои тук
// (в секретите на Supabase), НИКОГА в браузъра. Достъпът е само за влезли
// потребители (Supabase проверява JWT автоматично — verify_jwt).
//
// Вход:  { file_url: string, media_type?: string, doc_type?: "заявка"|"фактура_доставчик" }
// Изход: { parsed: {...по схемата...}, usage: {...токени...} }
//
// ЖЕЛЕЗНИ ПРАВИЛА (виж заданието):
//  • AI само ЧЕТЕ и извлича дословно. Не смята суми, не гадае. Липсва → null.
//  • Кодът на клиента, напъхан в описанието, се вади в отделно поле.
//  • Оригиналът се пази отделно (в Storage) — тук само го разчитаме.
//
// Качване: Supabase → Edge Functions → Deploy → име: parse-document →
//   постави съдържанието на този файл. Секретът ANTHROPIC_API_KEY вече е зададен
//   (ползва се и от функцията „assistant").

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// По-точен на документи. При стабилно качество може "claude-haiku-4-5-20251001".
const MODEL = "claude-sonnet-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

// Uint8Array → base64 (на парчета, за да не препълни стека при големи файлове).
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const SYSTEM = `Ти си прецизен разчитач на търговски документи за металообработваща фирма. Извличаш структурирани данни от клиентска заявка (или фактура) ДОСЛОВНО.
ЖЕЛЕЗНИ ПРАВИЛА:
- Извличай точно каквото пише. НЕ превеждай, НЕ разкрасявай, НЕ „поправяй".
- Ако кодът на артикула е напъхан в текста на описанието (напр. „002H0975 S41 GUIDING BAR L=2200mm AISI-304"), извади кода в client_code, а остатъка остави в client_name.
- Ако поле липсва в документа → null. НИКОГА не гадай и не измисляй стойност.
- НЕ смятай суми и НЕ изчислявай нищо. Само чети записаното. Тоталите (данъчна основа, ДДС, общо) и стойността на всеки ред ги ПРОЧЕТИ от документа, ако са изписани.
- Десетичен разделител може да е запетая („551,25") → върни го с точка (551.25).
- Дати връщай във формат YYYY-MM-DD, ако е разчетима; иначе null.
- Върни всеки ред от таблицата с артикулите като отделен запис в lines.
- Документите винаги имат ДВЕ фирми: „Данко Системс" / DANKO SYSTEMS (ЕИК/VAT 115789385) сме НИЕ. В client_name се записва ДРУГАТА фирма — при фактура от доставчик това е ИЗДАТЕЛЯТ (доставчикът), при заявка — клиентът. НИКОГА не връщай „Данко Системс" в client_name.
- Фактурите за МЕТАЛИ (напр. thyssenkrupp) често имат ДВЕ количества на ред: брой (Колич.1, напр. 10 БР) и тегло (Колич.2, напр. 475,824 КГ), а цената е за 1000 КГ (колона ЕП). Тогава: quantity = броят, quantity_kg = килограмите, price_per = числото, за което важи цената (напр. 1000). Килограмите са ВАЖНИ — не ги изпускай.`;

// Схемата на извлечения резултат (принуждаваме я през tool use).
const TOOL = {
  name: "record_document",
  description: "Записва дословно разчетените данни от документа.",
  input_schema: {
    type: "object",
    properties: {
      client_name: { type: ["string", "null"], description: "Името на НАСРЕЩНАТА фирма: при фактура от доставчик — ИЗДАТЕЛЯТ (доставчикът); при клиентска заявка — клиентът. НИКОГА \u201eДанко Системс\u201c (ЕИК 115789385) — това сме ние, получателят." },
      order_no: { type: ["string", "null"], description: "Номер на заявката/документа на клиента." },
      order_date: { type: ["string", "null"], description: "Дата на документа, YYYY-MM-DD или null." },
      due_date: { type: ["string", "null"], description: "Срок за доставка (при заявка) или падеж за плащане (при фактура), YYYY-MM-DD или null." },
      currency: { type: ["string", "null"], description: "Валута (EUR, BGN, USD…) ако е видима." },
      net_total: { type: ["number", "null"], description: "Данъчна основа (всичко без ДДС), както е изписана на документа." },
      vat_total: { type: ["number", "null"], description: "Сума на ДДС, както е изписана." },
      grand_total: { type: ["number", "null"], description: "Обща сума с ДДС, както е изписана." },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            position: { type: ["integer", "null"] },
            client_code: { type: ["string", "null"], description: "Кодът на артикула, както го пише клиентът." },
            client_name: { type: "string", description: "Описанието/името на артикула, както го пише клиентът." },
            quantity: { type: ["number", "null"] },
            quantity_kg: { type: ["number", "null"], description: "Количество в КИЛОГРАМИ за реда, ако документът показва и брой, и тегло (метали: Колич.2 КГ). null ако няма второ количество." },
            price_per: { type: ["number", "null"], description: "За колко единици важи цената (колона ЕП): напр. 1000 при цена за 1000 КГ. null ако цената е за 1 единица." },
            unit: { type: ["string", "null"] },
            unit_price: { type: ["number", "null"] },
            total: { type: ["number", "null"], description: "Стойност на реда (кол. × ед. цена), както е записана на документа." },
            drawing_rev: { type: ["string", "null"], description: "Ревизия на чертежа, ако е посочена." },
            note: { type: ["string", "null"] },
          },
          required: ["client_name"],
        },
      },
    },
    required: ["lines"],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Ползвай POST." }, 405);
  if (!ANTHROPIC_API_KEY) return json({ error: "Липсва ANTHROPIC_API_KEY в секретите на функцията." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Невалиден JSON." }, 400); }
  const fileUrl = body && body.file_url;
  if (!fileUrl || typeof fileUrl !== "string") return json({ error: "Липсва file_url." }, 400);

  // 1) Тегли оригинала (bucket-ът е публичен) и го кодирай base64.
  let bytes: Uint8Array, mediaType: string;
  try {
    const fr = await fetch(fileUrl);
    if (!fr.ok) return json({ error: "Не мога да сваля файла (" + fr.status + ")." }, 400);
    mediaType = String(body.media_type || fr.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    bytes = new Uint8Array(await fr.arrayBuffer());
  } catch (e) {
    return json({ error: "Грешка при сваляне на файла: " + String((e as any)?.message || e) }, 502);
  }
  if (bytes.length > 30 * 1024 * 1024) return json({ error: "Файлът е над 30 MB." }, 400);
  if (!mediaType) mediaType = /\.pdf(\?|$)/i.test(fileUrl) ? "application/pdf" : "image/jpeg";
  const b64 = toBase64(bytes);

  // 2) Блокът с документа ВИНАГИ преди текстовия (както препоръчва документацията).
  const isPdf = mediaType === "application/pdf";
  const docBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: b64 } };
  const kind = body.doc_type === "фактура_доставчик" ? "фактура от доставчик" : "заявка от клиент";
  const userText = `Това е ${kind}. Разчети я дословно и извикай record_document с извлечените данни. Всеки артикул от таблицата е отделен ред в lines. Ако код на артикул е напъхан в описанието — извади го в client_code.${body.doc_type === "фактура_доставчик" ? " ВАЖНО: в client_name запиши ИЗДАТЕЛЯ на фактурата (доставчика), НЕ получателя \u201eДанко Системс\u201c (ЕИК 115789385) — получателят сме ние." : ""}`;

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
        max_tokens: 4096,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "record_document" },
        messages: [{ role: "user", content: [docBlock, { type: "text", text: userText }] }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || ("Claude API грешка (" + r.status + ")") }, r.status);
    const tu = (data.content || []).find((b: any) => b.type === "tool_use");
    if (!tu) return json({ error: "Claude не върна структуриран резултат." }, 502);
    return json({ parsed: tu.input, usage: data.usage || null, model: MODEL });
  } catch (e) {
    return json({ error: "Грешка при връзка с Claude: " + String((e as any)?.message || e) }, 502);
  }
});
