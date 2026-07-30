// ============================================================
// Данко Системс — АВТОМАТИЧЕН сутрешен имейл (100% без човек).
// Вика се по график от pg_cron (виж cron-setup.sql) всяка сутрин.
// Съдържание: просрочени ВЗЕМАНИЯ от клиенти + ЗАДЪЛЖЕНИЯ с
// наближаващ/изтекъл падеж + маркираните „За днес" за Кристина.
// Ако няма нищо за докладване — не изпраща (без спам).
//
// Деплой:  функция daily-mail (Verify JWT OFF)
// Тайни:   BREVO_API_KEY, FROM_EMAIL, FROM_NAME (същите като send-inquiry)
//          OFFICE_EMAIL (по избор — до кого да стига; иначе FROM_EMAIL)
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY се подават автоматично.
// ============================================================

function esc(s: unknown) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)); }
function money(n: number) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmt(d: string) { const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (d || ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const apiKey = (Deno.env.get("BREVO_API_KEY") || "").trim();
  const fromEmail = (Deno.env.get("FROM_EMAIL") || "").trim();
  const fromName = (Deno.env.get("FROM_NAME") || "Данко Системс").trim();
  const office = (Deno.env.get("OFFICE_EMAIL") || fromEmail).trim();
  if (!url || !key) return Response.json({ error: "Липсва SUPABASE_URL/SERVICE_ROLE_KEY" }, { status: 500 });
  if (!apiKey || !fromEmail) return Response.json({ error: "Липсва BREVO_API_KEY или FROM_EMAIL" }, { status: 500 });

  // Четем вземания + задължения от app_config (както ги пази приложението).
  const resp = await fetch(`${url}/rest/v1/app_config?id=in.(receivables,payables)&select=id,data`, {
    headers: { apikey: key, authorization: "Bearer " + key },
  });
  if (!resp.ok) return Response.json({ error: "Грешка при четене: " + resp.status }, { status: 502 });
  const rows: any[] = await resp.json();
  const recv = (rows.find(r => r.id === "receivables")?.data?.list || []) as any[];
  const pay = (rows.find(r => r.id === "payables")?.data?.list || []) as any[];

  const today = new Date().toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

  const recvOver = recv.filter(p => !p.paid && p.dueDate && p.dueDate < today)
    .sort((a, b) => String(a.dueDate).localeCompare(b.dueDate));
  const paySoon = pay.filter(p => !p.paid && ((p.dueDate && p.dueDate <= in3) || p.forToday))
    .sort((a, b) => String(a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

  // Производството ВЧЕРА — от вечния дневник production_log (какво е свършено).
  const yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const SKIP_WORKERS = new Set(["Григор Байков", "Тестов", "тестов", "Тест"]);
  let prodRows: any[] = [];
  try {
    const pr = await fetch(`${url}/rest/v1/production_log?select=data&data->>date=eq.${yday}`, {
      headers: { apikey: key, authorization: "Bearer " + key },
    });
    if (pr.ok) prodRows = ((await pr.json()) as any[]).map(r => r.data || {}).filter(d => !SKIP_WORKERS.has(String(d.worker || "").trim()));
  } catch (e) { /* без производствена секция при грешка */ }
  const byShop: Record<string, { qty: number; cnt: number }> = {};
  const byWorker: Record<string, { qty: number; ws: string }> = {};
  prodRows.forEach(d => {
    const q = Number(d.qty) || 0; const ws = d.workshop || "—";
    (byShop[ws] = byShop[ws] || { qty: 0, cnt: 0 }); byShop[ws].qty += q; byShop[ws].cnt++;
    const w = d.worker || "—"; (byWorker[w] = byWorker[w] || { qty: 0, ws }); byWorker[w].qty += q;
  });
  const prodTotal = prodRows.reduce((s, d) => s + (Number(d.qty) || 0), 0);

  if (!recvOver.length && !paySoon.length && !prodRows.length) return Response.json({ ok: true, skipped: "нищо за докладване" });

  const sum = (arr: any[], f: string) => arr.reduce((s, p) => s + (Number(String(p[f]).replace(",", ".")) || 0), 0);
  const tbl = (head: string, rws: string) => `<table style="border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:13px">
    <tr style="background:#ecfdf5;color:#065f46">${head}</tr>${rws}</table>`;
  const td = (v: string, r = false) => `<td style="border:1px solid #cbd5e1;padding:5px 7px${r ? ";text-align:right" : ""}">${v}</td>`;
  const th = (v: string) => `<th style="border:1px solid #cbd5e1;padding:5px 7px;text-align:left">${v}</th>`;

  let html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
    <h2 style="color:#0f766e">Сутрешен отчет — ${fmt(today)}</h2>`;
  if (recvOver.length) {
    html += `<h3 style="color:#991b1b">⚠ Просрочени вземания от клиенти: ${recvOver.length} бр. · ${money(sum(recvOver, "amount"))} EUR</h3>`
      + tbl(th("Клиент") + th("Фактура") + th("Падеж") + th("Сума EUR"),
        recvOver.map(p => `<tr>${td(esc(p.client))}${td(esc(p.invoiceNo))}${td(fmt(p.dueDate))}${td(money(Number(p.amount) || 0), true)}</tr>`).join(""));
  }
  if (paySoon.length) {
    html += `<h3 style="color:#92400e">💳 Задължения за плащане (до 3 дни / „За днес"): ${paySoon.length} бр. · ${money(sum(paySoon, "amountVat"))} EUR</h3>`
      + tbl(th("Доставчик") + th("Фактура") + th("Падеж") + th("С ДДС EUR") + th(""),
        paySoon.map(p => `<tr>${td(esc(p.supplier))}${td(esc(p.invoiceNo))}${td(fmt(p.dueDate))}${td(money(Number(p.amountVat) || 0), true)}${td(p.forToday ? "☀ За днес" : "")}</tr>`).join(""));
  }
  if (prodRows.length) {
    const shopRows = Object.entries(byShop).sort((a, b) => b[1].qty - a[1].qty);
    const workerRows = Object.entries(byWorker).sort((a, b) => b[1].qty - a[1].qty).slice(0, 15);
    html += `<h3 style="color:#065f46">🏭 Свършено вчера (${fmt(yday)}): ${money(prodTotal).replace(",00", "")} бр. · ${prodRows.length} отчета</h3>`
      + tbl(th("Цех") + th("Отчети") + th("Бройки"),
        shopRows.map(([ws, d]) => `<tr>${td(esc(ws))}${td(String(d.cnt), true)}${td(String(Math.round(d.qty)), true)}</tr>`).join(""))
      + `<h4 style="margin:4px 0">Топ служители</h4>`
      + tbl(th("Служител") + th("Цех") + th("Бройки"),
        workerRows.map(([w, d]) => `<tr>${td(esc(w))}${td(esc(d.ws))}${td(String(Math.round(d.qty)), true)}</tr>`).join(""));
  }
  html += `<p style="color:#64748b;font-size:12px">Автоматично писмо от СИСТЕМАТА (Данко Системс).</p></div>`;

  const send = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: office.split(",").map(e => ({ email: e.trim() })).filter(x => x.email.includes("@")),
      subject: `Сутрешен отчет ${fmt(today)}: произведени ${Math.round(prodTotal)} бр. · ${recvOver.length} просрочени вземания · ${paySoon.length} задължения`,
      htmlContent: html,
    }),
  });
  const data = await send.json().catch(() => ({}));
  if (send.ok) return Response.json({ ok: true, recvOverdue: recvOver.length, payDue: paySoon.length });
  return Response.json({ error: "Brevo отказа (" + send.status + "): " + ((data as any).message || "") }, { status: 502 });
});
