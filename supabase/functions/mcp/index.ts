// Данко Системс — Edge функция „mcp": MCP сървър на «СИСТЕМАТА» (етап 1 — САМО ЧЕТЕНЕ).
// Данко и Григор я добавят като конектор в claude.ai и питат Claude на български
// за реалните данни: заявки, склад, фактури, вземания/задължения, Пулс, Таблица ЕРП.
//
// СИГУРНОСТ:
//   • Достъп само с таен ключ (секрета MCP_TOKEN) — идва в адреса: .../mcp/<ключ>.
//     Без верен ключ — 401, нищо не се чете. Ключът НЕ стои в кода, нито в репото.
//   • Само четене: фиксирани справки, НЯМА инструмент за произволна заявка/запис.
//   • Заплати по хора, отпуски, IBAN-и и всякакви лични данни — ИЗВЪН обхвата.
//     (Месечните „Заплати" в Пулса са само фирмен сбор, без имена.)
//
// Качване (еднократно, от Данко):
//   1) Supabase Dashboard → Edge Functions → Deploy a new function → име: mcp
//      → постави съдържанието на този файл. ВАЖНО: изключи „Enforce JWT verification"
//      (Verify JWT = OFF) — конекторът на Claude не носи Supabase JWT; пази ни MCP_TOKEN.
//   2) Project Settings → Edge Functions → Secrets → MCP_TOKEN = дълъг случаен низ
//      (40+ знака, от генератор на пароли; само букви и цифри).
//   3) В claude.ai: Settings → Connectors → Add custom connector →
//      URL: https://<проект>.supabase.co/functions/v1/mcp/<ключа от т.2>
//   (SUPABASE_URL и SERVICE_ROLE ключът ги дава самата платформа — нищо не се попълва.)

const ENV = (k: string) => {
  try { if (typeof Deno !== "undefined" && Deno.env) return Deno.env.get(k) || ""; } catch (_e) { /* */ }
  try { return (globalThis as any).process?.env?.[k] || ""; } catch (_e) { return ""; }
};

const BGN = 1.95583;
const num = (x: unknown) => {   // огледало на erpToNum (erp.js): интервали/валута/NaN
  if (x === null || x === undefined || x === "") return 0;
  if (typeof x === "number") return isNaN(x) ? 0 : x;
  const n = parseFloat(String(x).replace(/\s+/g, "").replace(",", ".").replace(/[^\d.\-]/g, ""));
  return isNaN(n) ? 0 : n;
};
const r2 = (x: number) => Math.round((Number(x) || 0) * 100) / 100;
const toEur = (n: number, cur: string) => (cur === "BGN" ? n / BGN : n);
const lineNet = (arr: any[]) => (arr || []).reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0);

/* ---------- Четене от базата (PostgREST, на страници по 1000) ---------- */
async function dbFetch(path: string): Promise<any[]> {
  // order=id е ЗАДЪЛЖИТЕЛЕН: без ORDER BY PostgREST не гарантира реда и
  // страниците по Range могат да повтарят/пропускат редове.
  const url = ENV("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1/" + path + (path.includes("?") ? "&" : "?") + "order=id";
  const key = ENV("SUPABASE_SERVICE_ROLE_KEY");
  const out: any[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const res = await fetch(url, {
      headers: { apikey: key, Authorization: "Bearer " + key, Range: `${from}-${from + PAGE - 1}`, Prefer: "count=none" },
    });
    if (!res.ok) throw new Error(`База: HTTP ${res.status} за ${path.split("?")[0]}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("База: неочакван отговор.");
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
async function cfg(id: string): Promise<any> {
  const rows = await dbFetch(`app_config?id=eq.${encodeURIComponent(id)}&select=data`);
  return (rows[0] && rows[0].data) || null;
}

/* ---------- Формулите — 1:1 с приложението ---------- */
const coValueLeft = (o: any) => (o.lines || []).reduce((s: number, l: any) => {
  const q = num(l.qty);
  const d = Math.min(Math.max(0, Number(l.delivered) || 0), q);
  return s + (q - d) * num(l.unitPrice);
}, 0);
const coDoneish = (o: any) => {   // огледало на erpCODoneish
  if ((o.status || "нова") === "завършена") return true;
  if (coValueLeft(o) > 0.004) return false;
  const lines = o.lines || [];
  const qtyLeft = lines.reduce((s: number, l: any) => {
    const q = num(l.qty);
    const d = Math.min(Math.max(0, Number(l.delivered) || 0), q);
    return s + (q - d);
  }, 0);
  if (qtyLeft > 0.004) return false;
  // Нищо не е ПОРЪЧВАНО (празна/чернова без количества) + е от ДНЕС → видима.
  const everOrdered = lines.some((l: any) => num(l.qty) > 0);
  if (!everOrdered && String(o.date || "") >= new Date().toISOString().slice(0, 10)) return false;
  return true;
};
const invTotals = (o: any) => {
  const base = lineNet(o.lines);
  const rate = Number(o.vatRate != null ? o.vatRate : 20);
  const sign = o.kind === "credit" ? -1 : 1;
  return { base: base * sign, vat: base * rate / 100 * sign, total: base * (1 + rate / 100) * sign, rate };
};
const puLineVat = (o: any, l: any) => {   // огледало на erpPuLineVat: "" = ставката на документа; NaN → 0
  const raw = (l.vatRate != null && l.vatRate !== "") ? l.vatRate : ((o.vatRate != null && o.vatRate !== "") ? o.vatRate : 20);
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
};
const puTotals = (o: any) => {
  let base = 0, vat = 0;
  (o.lines || []).forEach((l: any) => {
    const amt = num(l.qty) * num(l.unitPrice);
    base += amt; vat += amt * puLineVat(o, l) / 100;
  });
  if (o.docType === "credit") { base = -Math.abs(base); vat = -Math.abs(vat); }
  return { base, vat, total: base + vat };
};

/* ---------- Инструментите (само четене) ---------- */
type Tool = { name: string; description: string; inputSchema: any; sensitive?: boolean; run: (a: any) => Promise<any> };

const TOOLS: Tool[] = [
  {
    name: "orders_list",
    description: "Заявки от клиенти: номер, клиент, дата, срок, статус, редове (код/име/брой/доставени), стойност и колко ОСТАВА (по недоставеното, EUR без ДДС). Филтри: клиент (част от името), статус, търсене, включване на завършените.",
    inputSchema: { type: "object", properties: {
      client: { type: "string", description: "Част от името на клиента" },
      status: { type: "string", description: "нова | в производство | готова за продажба | частично завършена | завършена" },
      q: { type: "string", description: "Търсене в № / клиент / клиентски №" },
      include_done: { type: "boolean", description: "Да се включат ли завършените (иначе се крият)" },
      limit: { type: "number", description: "Най-много заявки (по подразбиране 50, таван 200)" },
    } },
    run: async (a) => {
      const rows = await dbFetch("customer_orders?select=id,data");
      let list = rows.map((r) => ({ id: r.id, ...(r.data || {}) }));
      if (!a.include_done) list = list.filter((o) => !coDoneish(o));
      const qq = String(a.q || "").toLowerCase();
      if (qq) list = list.filter((o) => `${o.ourNo || ""} ${o.clientNo || ""} ${o.clientName || ""} ${o.status || ""}`.toLowerCase().includes(qq));
      if (a.client) list = list.filter((o) => String(o.clientName || "").toLowerCase().includes(String(a.client).toLowerCase()));
      if (a.status) list = list.filter((o) => (o.status || "нова") === a.status);
      list.sort((x, y) => String(x.deadline || "9999").localeCompare(String(y.deadline || "9999")));
      const lim = Math.min(Number(a.limit) || 50, 200);
      const out = list.slice(0, lim).map((o) => ({
        no: o.ourNo || null, clientNo: o.clientNo || null, client: o.clientName || "",
        date: o.date || null, deadline: o.deadline || null, status: o.status || "нова",
        totalEur: r2(toEur(lineNet(o.lines), o.currency || "EUR")), leftEur: r2(toEur(coValueLeft(o), o.currency || "EUR")),
        lines: (o.lines || []).map((l: any) => ({ code: l.code || null, name: l.name || "", qty: num(l.qty), delivered: Number(l.delivered) || 0, unitPrice: num(l.unitPrice) })),
      }));
      return { count: list.length, shown: out.length, truncated: list.length > out.length, orders: out };
    },
  },
  {
    name: "client_summary",
    description: "Обобщение за клиент по заявките му за период: брой и стойност, тенденция (втора половина срещу първа), ритъм (среден брой дни между заявки), преди колко дни е последната, най-поръчваните изделия и списък на заявките.",
    inputSchema: { type: "object", required: ["client"], properties: {
      client: { type: "string", description: "Част от името на клиента" },
      months: { type: "number", description: "Период назад в месеци (по подразбиране 12; 0 = всичко)" },
    } },
    run: async (a) => {
      const rows = await dbFetch("customer_orders?select=id,data");
      const all = rows.map((r) => ({ id: r.id, ...(r.data || {}) }));
      const nameQ = String(a.client || "").toLowerCase();
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const m = a.months == null ? 12 : Number(a.months) || 0;
      const since = m ? new Date(today.getFullYear(), today.getMonth() - m, today.getDate()).toISOString().slice(0, 10) : "";
      const dOf = (o: any) => String(o.date || o.deadline || "");
      // Частичното име НЕ слива различни клиенти: при повече от едно съвпадащо
      // ИМЕ искаме уточнение, вместо да съберем оборота на двама в едно.
      const matchedNames = [...new Set(all.map((o) => String(o.clientName || "")).filter((n) => n && n.toLowerCase().includes(nameQ)))];
      if (!matchedNames.length) return { client: a.client, orders: 0, note: "Няма клиент с такова име." };
      if (matchedNames.length > 1) return { matchedClients: matchedNames.sort(), note: "Няколко клиенти отговарят на името — повтори с точното име." };
      const exact = matchedNames[0];
      const list = all.filter((o) => String(o.clientName || "") === exact)
        .filter((o) => { const d = dOf(o); return d && (!since || d >= since) && d <= todayIso; })
        .sort((x, y) => dOf(x).localeCompare(dOf(y)));
      if (!list.length) return { client: exact, orders: 0, note: "Няма заявки за периода." };
      const val = (o: any) => toEur(lineNet(o.lines), o.currency || "EUR");
      const total = list.reduce((s, o) => s + val(o), 0);
      const start = since || dOf(list[0]);
      const mid = (new Date(start).getTime() + today.getTime()) / 2;
      let v1 = 0, v2 = 0;
      list.forEach((o) => { if (new Date(dOf(o)).getTime() < mid) v1 += val(o); else v2 += val(o); });
      const trend = (list.length < 2 || (v1 < 1 && v2 < 1)) ? "—" : v2 > v1 * 1.15 ? "расте" : v2 < v1 * 0.85 ? "намалява" : "равно";
      const ds = list.map((o) => new Date(dOf(o)).getTime());
      const rhythmDays = list.length >= 2 ? Math.round((ds[ds.length - 1] - ds[0]) / (ds.length - 1) / 864e5) : null;
      const lastGapDays = Math.round((today.getTime() - ds[ds.length - 1]) / 864e5);
      const prod = new Map<string, any>();
      list.forEach((o) => {
        const seen = new Set();
        (o.lines || []).forEach((l: any) => {
          const k = String(l.code || l.name || "?");
          const p = prod.get(k) || { code: k, name: l.name || "", orders: 0, qty: 0 };
          p.qty += num(l.qty);
          if (!seen.has(k)) { p.orders++; seen.add(k); }
          prod.set(k, p);
        });
      });
      const top = [...prod.values()].sort((x, y) => y.orders - x.orders || y.qty - x.qty).slice(0, 5);
      return {
        client: list[0].clientName, orders: list.length, totalEur: r2(total),
        trend, firstHalfEur: r2(v1), secondHalfEur: r2(v2), rhythmDays, lastGapDays,
        topProducts: top.map((p) => ({ ...p, qty: Math.round(p.qty) })),
        list: list.slice().reverse().map((o) => ({ no: o.ourNo || null, date: dOf(o), status: o.status || "нова", valueEur: r2(val(o)), leftEur: r2(toEur(coValueLeft(o), o.currency || "EUR")) })),
      };
    },
  },
  {
    name: "materials_stock",
    description: "Склад МАТЕРИАЛИ: код, име, група, мерна единица, наличност и минимум. Филтри: търсене, само под минимума, група.",
    inputSchema: { type: "object", properties: {
      q: { type: "string", description: "Търсене в код/име/група" },
      below_min: { type: "boolean", description: "Само материалите ПОД минималния запас" },
      group: { type: "string", description: "Част от името на групата (напр. Ламарина)" },
      limit: { type: "number", description: "Най-много редове (по подразбиране 100, таван 400)" },
    } },
    run: async (a) => {
      const [mats, stock] = await Promise.all([
        dbFetch("materials?select=id,code,name,group_name,unit,min_stock"),
        dbFetch("v_material_stock?select=id,stock,below_min"),
      ]);
      const st = new Map(stock.map((s) => [String(s.id), s]));
      let list = mats.map((m) => { const s = st.get(String(m.id)) || {}; return { code: m.code, name: m.name, group: m.group_name, unit: m.unit, stock: r2(Number(s.stock) || 0), minStock: r2(Number(m.min_stock) || 0), belowMin: !!s.below_min }; });
      const qq = String(a.q || "").toLowerCase();
      if (qq) list = list.filter((m) => `${m.code || ""} ${m.name || ""} ${m.group || ""}`.toLowerCase().includes(qq));
      if (a.group) list = list.filter((m) => String(m.group || "").toLowerCase().includes(String(a.group).toLowerCase()));
      if (a.below_min) list = list.filter((m) => m.belowMin);
      list.sort((x, y) => String(x.group || "").localeCompare(String(y.group || ""), "bg") || String(x.name || "").localeCompare(String(y.name || ""), "bg"));
      const lim = Math.min(Number(a.limit) || 100, 400);
      return { count: list.length, shown: Math.min(list.length, lim), truncated: list.length > lim, materials: list.slice(0, lim) };
    },
  },
  {
    name: "products_stock",
    description: "Склад ДЕТАЙЛИ (готови изделия): код, име, група и наличност в склада.",
    inputSchema: { type: "object", properties: {
      q: { type: "string", description: "Търсене в код/име" },
      only_available: { type: "boolean", description: "Само с наличност > 0" },
      limit: { type: "number", description: "Най-много редове (по подразбиране 100, таван 400)" },
    } },
    run: async (a) => {
      const [prods, stock] = await Promise.all([
        dbFetch("products?select=id,code,name,group_name"),
        dbFetch("v_product_stock?select=id,stock"),
      ]);
      const st = new Map(stock.map((s) => [String(s.id), Number(s.stock) || 0]));
      let list = prods.map((p) => ({ code: p.code, name: p.name, group: p.group_name, stock: r2(st.get(String(p.id)) || 0) }));
      const qq = String(a.q || "").toLowerCase();
      if (qq) list = list.filter((p) => `${p.code || ""} ${p.name || ""}`.toLowerCase().includes(qq));
      if (a.only_available) list = list.filter((p) => p.stock > 0);
      list.sort((x, y) => y.stock - x.stock || String(x.code || "").localeCompare(String(y.code || "")));
      const lim = Math.min(Number(a.limit) || 100, 400);
      return { count: list.length, shown: Math.min(list.length, lim), truncated: list.length > lim, products: list.slice(0, lim) };
    },
  },
  {
    name: "invoices_list",
    description: "Издадени фактури и известия (без проформи и чернови): номер, тип, клиент, дата, сума без/с ДДС, валута, статус, изпратена ли е по имейл (кога и на кого). Кредитните са с минус. Филтри: месец, клиент.",
    inputSchema: { type: "object", properties: {
      month: { type: "string", description: "Месец ГГГГ-ММ (напр. 2026-10)" },
      client: { type: "string", description: "Част от името на клиента" },
      limit: { type: "number", description: "Най-много документи (по подразбиране 60, таван 300)" },
    } },
    run: async (a) => {
      const rows = await dbFetch("invoices?select=id,doc_no,posted,kind,data");
      let list = rows.map((r) => ({ id: r.id, docNo: r.doc_no, posted: r.posted, kindDb: r.kind, ...(r.data || {}) }))
        .filter((o) => o.posted && o.kind !== "proforma" && o.status !== "анулирана" && o.status !== "сторнирана");
      if (a.month) list = list.filter((o) => String(o.issueDate || "").slice(0, 7) === String(a.month));
      if (a.client) list = list.filter((o) => String((o.client && o.client.name) || "").toLowerCase().includes(String(a.client).toLowerCase()));
      list.sort((x, y) => String(y.issueDate || "").localeCompare(String(x.issueDate || "")));
      const lim = Math.min(Number(a.limit) || 60, 300);
      const out = list.slice(0, lim).map((o) => {
        const t = invTotals(o);
        return { no: o.docNo, kind: o.kind, client: (o.client && o.client.name) || "", date: o.issueDate || null,
          baseEur: r2(toEur(t.base, o.currency || "EUR")), totalWithVatEur: r2(toEur(t.total, o.currency || "EUR")), currency: o.currency || "EUR",
          dueDate: o.dueDate || null, emailedAt: o.emailedAt || null, emailedTo: o.emailedTo || null };
      });
      const sum = list.reduce((s, o) => s + toEur(invTotals(o).base, o.currency || "EUR"), 0);
      return { count: list.length, shown: out.length, truncated: list.length > out.length, totalBaseEur: r2(sum), invoices: out };
    },
  },
  {
    name: "receivables_due",
    description: "ВЗЕМАНИЯ: кой клиент колко ни дължи по фактури — неплатени и частично платени, с падеж и дали е просрочено. Сборове общо и само по просрочените.",
    inputSchema: { type: "object", properties: { client: { type: "string", description: "Част от името на клиента" } } },
    run: async (a) => {
      const d = await cfg("receivables");
      const today = new Date().toISOString().slice(0, 10);
      // Стоковите разписки НЕ са вземания за събиране — чакат фактуриране
      // (правило на Данко, 07.10.2026; както екранът Вземания).
      let list = ((d && d.list) || []).filter((p: any) => !p.paid && (p.docType || "Фактура") !== "Стокова");
      if (a.client) list = list.filter((p: any) => String(p.client || "").toLowerCase().includes(String(a.client).toLowerCase()));
      const out = list.map((p: any) => {
        const paidPart = (p.payments || []).reduce((s: number, x: any) => s + num(x.amount), 0);
        const left = r2(num(p.amount) - paidPart);
        return { client: p.client || "", invoiceNo: p.invoiceNo || null, docType: p.docType || "Фактура", dueDate: p.dueDate || null,
          amountEur: r2(num(p.amount)), paidEur: r2(paidPart), leftEur: left, overdue: !!(p.dueDate && p.dueDate < today) };
      }).filter((x: any) => x.leftEur !== 0)   // кредитните известия стоят с МИНУС — вадят се от общото, не се крият
        .sort((x: any, y: any) => String(x.dueDate || "9999").localeCompare(String(y.dueDate || "9999")));
      return { count: out.length, totalLeftEur: r2(out.reduce((s: number, x: any) => s + x.leftEur, 0)),
        overdueLeftEur: r2(out.filter((x: any) => x.overdue).reduce((s: number, x: any) => s + x.leftEur, 0)), receivables: out };
    },
  },
  {
    name: "payables_due",
    description: "ЗАДЪЛЖЕНИЯ: на кой доставчик колко дължим — неплатените, с падеж и дали е просрочено (сумите са с ДДС, EUR).",
    inputSchema: { type: "object", properties: { supplier: { type: "string", description: "Част от името на доставчика" } } },
    run: async (a) => {
      const d = await cfg("payables");
      const today = new Date().toISOString().slice(0, 10);
      let list = ((d && d.list) || []).filter((p: any) => !p.paid);
      if (a.supplier) list = list.filter((p: any) => String(p.supplier || "").toLowerCase().includes(String(a.supplier).toLowerCase()));
      const out = list.map((p: any) => {
        const left = r2(Math.max(0, num(p.amountVat) - num(p.paidAmount)));
        return { supplier: p.supplier || "", docNo: p.docNo || null, dueDate: p.dueDate || null,
          amountVatEur: r2(num(p.amountVat)), leftEur: left, overdue: !!(p.dueDate && p.dueDate < today) };
      }).filter((x: any) => x.leftEur > 0).sort((x: any, y: any) => String(x.dueDate || "9999").localeCompare(String(y.dueDate || "9999")));
      return { count: out.length, totalLeftEur: r2(out.reduce((s: number, x: any) => s + x.leftEur, 0)),
        overdueLeftEur: r2(out.filter((x: any) => x.overdue).reduce((s: number, x: any) => s + x.leftEur, 0)), payables: out };
    },
  },
  {
    name: "monthly_results",
    description: "Месечните резултати (като Пулса): фактурирано без ДДС, продажби 005/стокови, разходи от Покупки, заплати (фирмен СБОР, без имена), осигуровки (сбор), кредити/други (ръчни), ДДС ± и РЕЗУЛТАТ по месеци. Ръчните корекции от Пулса важат. Последният месец е незавършен.",
    inputSchema: { type: "object", properties: { months: { type: "number", description: "Колко месеца назад (по подразбиране 6, таван 24)" } } },
    run: async (a) => {
      const nM = Math.min(Math.max(Number(a.months) || 6, 1), 24);
      const [manD, invRows, puRows, payRows, c005D] = await Promise.all([
        cfg("pulse_monthly"), dbFetch("invoices?select=posted,kind,data"), dbFetch("purchases?select=data"),
        dbFetch("app_config?select=id,data&id=like.payroll%25"), cfg("pulse_c005"),
      ]);
      const manual = (manD && manD.months) || {};
      const months: string[] = [];
      const now = new Date();
      for (let i = 0; i < nM; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
      const invBy: any = {}, vatOutBy: any = {}, purBy: any = {}, vatInBy: any = {}, salBy: any = {}, osigBy: any = {}, c005By: any = {};
      invRows.map((r) => ({ posted: r.posted, kind: r.kind, ...(r.data || {}) })).forEach((o: any) => {
        if (!o.posted || o.kind === "proforma") return;
        const m = String(o.issueDate || "").slice(0, 7); if (!m) return;
        const sign = o.kind === "credit" ? -1 : 1;
        const net = sign * toEur(lineNet(o.lines), o.currency || "EUR");
        invBy[m] = (invBy[m] || 0) + net;
        vatOutBy[m] = (vatOutBy[m] || 0) + net * Number(o.vatRate != null ? o.vatRate : 20) / 100;
      });
      puRows.map((r) => r.data || {}).forEach((o: any) => {
        const m = String(o.date || "").slice(0, 7); if (!m || o.docType === "goods") return;
        const pSign = o.docType === "credit" ? -1 : 1;
        purBy[m] = (purBy[m] || 0) + pSign * toEur(lineNet(o.lines), o.currency || "BGN");
        vatInBy[m] = (vatInBy[m] || 0) + toEur(puTotals(o).vat, o.currency || "BGN");
      });
      payRows.forEach((r: any) => {
        const id = String(r.id || "");
        if (/^payroll_\d{4}-\d{2}-\d{2}$/.test(id)) {
          const mon = (r.data && r.data.monday) || id.replace("payroll_", "");
          const m = String(mon).slice(0, 7);
          Object.values((r.data && r.data.entries) || {}).forEach((e: any) => {
            ["bank", "cash", "nadnik", "overtime", "bonus"].forEach((k) => { salBy[m] = (salBy[m] || 0) + (Number(e && e[k]) || 0); });
          });
        } else if (/^payroll_m_\d{4}-\d{2}$/.test(id)) {
          const m = id.replace("payroll_m_", "");
          Object.values((r.data && r.data.entries) || {}).forEach((e: any) => {
            const fri = (e && e.fri) || {};
            const isNew = Object.values(fri).some((x: any) => x && typeof x === "object" && (("b" in x) || ("c" in x)));
            if (isNew) Object.values(fri).forEach((x: any) => { salBy[m] = (salBy[m] || 0) + (Number(x && x.b) || 0) + (Number(x && x.c) || 0) + (Number(x && x.o) || 0); });
            else Object.values(fri).forEach((x: any) => {
              // СТАР формат {w,o} или число: Пулсът (payFriNormalize→payFriBreakdown)
              // дава b+c = w+o и добавя o отделно → w + 2o. Огледално, за да съвпада.
              const w = (x && typeof x === "object") ? (Number(x.w) || 0) : (Number(x) || 0);
              const o2 = (x && typeof x === "object") ? (Number(x.o) || 0) : 0;
              salBy[m] = (salBy[m] || 0) + w + o2 + o2;
            });
            salBy[m] = (salBy[m] || 0) + (Number((e && e.rz || {}).sum) || 0);
          });
        } else if (/^payroll_osig_\d{4}-\d{2}$/.test(id)) {
          const m = id.replace("payroll_osig_", "");
          let s = 0;
          Object.values(((r.data || {}).byName) || {}).forEach((x: any) => { s += Number(x) || 0; });
          (((r.data || {}).extra) || []).forEach((x: any) => { s += Number(x.osig) || 0; });
          if (s) osigBy[m] = s;
        }
      });
      const c005 = c005D || {};
      ((c005.list) || []).forEach((r: any) => { const m = String(r.date || "").slice(0, 7); if (m) c005By[m] = (c005By[m] || 0) + (Number(r.amount) || 0); });
      Object.keys(c005.deleted || {}).forEach((m) => { c005By[m] = (c005By[m] || 0) + (Number(c005.deleted[m]) || 0); });
      const ovVal = (man: any, k: string, auto: number) => {
        const raw = man[k];
        return (raw === undefined || raw === null || raw === "") ? auto : Number(raw) || 0;
      };
      const out = months.map((m) => {
        const man = manual[m] || {};
        const inv = ovVal(man, "ovInv", invBy[m] || 0);
        const c5 = (c005By[m] || 0) + (Number(man.c005) || 0);
        const pur = ovVal(man, "ovPur", purBy[m] || 0);
        const sal = ovVal(man, "ovSal", salBy[m] || 0);
        const osig = ovVal(man, "ovOsig", osigBy[m] || Number(man.osig) || 0);
        const vatDue = ovVal(man, "ovVat", (vatOutBy[m] || 0) - (vatInBy[m] || 0));
        const credits = Number(man.credits) || 0;
        const other = Number(man.other) || 0;
        const sales = inv + c5;
        return { month: m, invoicedEur: r2(inv), c005Eur: r2(c5), salesTotalEur: r2(sales), purchasesEur: r2(pur),
          salariesEur: r2(sal), socialEur: r2(osig), creditsEur: r2(credits), otherEur: r2(other), vatDueEur: r2(vatDue),
          resultEur: r2(sales - pur - sal - osig - credits - other - vatDue), note: man.note || null };
      });
      return { note: "Най-новият месец е незавършен. Преди юли 2026 числата в Системата са непълни (историята от ексела живее само в Пулса).", months: out };
    },
  },
  {
    name: "erp_weekly_table",
    description: "Таблица ЕРП — седмичният отчет: задължения, вземания, съотношение, разлика, заявки, банка, материали (тон), външен/вътрешен оборот, инвестиции, бележка. Ред на седмица, най-новите последни.",
    inputSchema: { type: "object", properties: { weeks: { type: "number", description: "Колко седмици назад (по подразбиране 12, таван 60)" } } },
    run: async (a) => {
      const d = await cfg("erp_weekly_table");
      const rows = ((d && d.rows) || []).slice().sort((x: any, y: any) => String(x.date || "").localeCompare(String(y.date || "")));
      const nW = Math.min(Math.max(Number(a.weeks) || 12, 1), 60);
      const out = rows.slice(-nW).map((r: any) => {
        const liab = Number(r.liabilities) || 0, recv = Number(r.receivables) || 0;
        return { date: r.date, liabilities: r2(liab), receivables: r2(recv),
          ratio: liab > 0 ? r2(recv / liab) : null, diff: r2(recv - liab),
          orders: r2(Number(r.orders) || 0), bank: r2(Number(r.bank) || 0),
          materialTons: r.materialTons != null && r.materialTons !== "" ? r2(Number(r.materialTons)) : null,
          extTurnover: r2(Number(r.extTurnover) || 0), intTurnover: r2(Number(r.intTurnover) || 0),
          investments: r2(Number(r.investments) || 0), note: r.note || null };
      });
      return { note: "Най-новият ред може да е автоматичният от текущия понеделник (банката се въвежда на ръка).", weeks: out };
    },
  },
  {
    name: "production_progress",
    description: "Напредък на производството по заявка (по наш №): операциите по цехове с произведени/пуснати бройки и кое е завършено.",
    inputSchema: { type: "object", required: ["order_no"], properties: { order_no: { type: "string", description: "Нашият № на заявката (напр. 217)" } } },
    run: async (a) => {
      const no = String(a.order_no || "").trim();
      const ords = await dbFetch("customer_orders?select=id,data");
      const o = ords.map((r) => ({ id: r.id, ...(r.data || {}) })).find((x) => String(x.ourNo || "").trim() === no);
      if (!o) return { error: `Няма заявка с наш № ${no}.` };
      // id-тата на заявките са UUID (низове). Грешка от базата се ОСТАВЯ да
      // гръмне (isError за извикването) — не се представя като „няма задачи".
      const asStr = encodeURIComponent(JSON.stringify([String(o.id)]));
      const tasks = await dbFetch(`tasks?select=id,done,data&data->source->orderIds=cs.${asStr}`);
      const ops = tasks.map((r: any) => ({ done: r.done, ...(r.data || {}) }))
        .filter((t: any) => ((t.source || {}).orderIds || []).map(String).includes(String(o.id)))
        .filter((t: any) => (t.source || {}).kind === "series")   // само поточните операции (не мостри и др.)
        .map((t: any) => ({ code: t.code || null, product: t.product || "", operation: t.operation || "", workshop: t.workshop || "",
          produced: Number(t.produced) || 0, qty: Number(t.qty) || 0,
          finished: !!(t.done || (Number(t.qty) > 0 && Number(t.produced) >= Number(t.qty))) }));
      return { order: { no: o.ourNo, client: o.clientName, deadline: o.deadline || null, status: o.status || "нова" },
        operations: ops, note: ops.length ? undefined : "По тази заявка няма пуснати производствени задачи." };
    },
  },
  {
    name: "company_contacts",
    description: "Указателят Клиенти/Доставчици: фирма, лице за контакт, телефон, имейл, категория, бележка. Търсене по която и да е от колоните.",
    inputSchema: { type: "object", required: ["q"], properties: {
      q: { type: "string", description: "Търсене (фирма / лице / категория / бележка / имейл)" },
      limit: { type: "number", description: "Най-много редове (по подразбиране 30, таван 100)" },
    } },
    run: async (a) => {
      const rows = await dbFetch("contacts?select=id,data");
      const qq = String(a.q || "").toLowerCase();
      let list = rows.map((r) => r.data || {})
        .filter((c: any) => `${c.company || ""} ${c.contact_person || ""} ${c.category || ""} ${c.note || ""} ${c.email || ""} ${c.phone || ""}`.toLowerCase().includes(qq))
        .map((c: any) => ({ company: c.company || "", person: c.contact_person || null, phone: c.phone || null, email: c.email || null, category: c.category || null, note: c.note || null }));
      list.sort((x: any, y: any) => String(x.company).localeCompare(String(y.company), "bg"));
      const lim = Math.min(Number(a.limit) || 30, 100);
      return { count: list.length, shown: Math.min(list.length, lim), truncated: list.length > lim, contacts: list.slice(0, lim) };
    },
  },
  {
    name: "invoice_mails",
    description: "Изпратените по имейл фактури по клиент: № на документа, кога е изпратен и на кой имейл + запомненият фактурен имейл на клиента (този, който излиза сам при следваща фактура).",
    inputSchema: { type: "object", properties: { client: { type: "string", description: "Част от името на клиента (празно = всички)" } } },
    run: async (a) => {
      const [rows, extra] = await Promise.all([dbFetch("invoices?select=doc_no,kind,data"), cfg("extra_mails")]);
      const lastTo = (extra && extra.lastTo) || {};
      let list = rows.map((r) => ({ docNo: r.doc_no, kind: r.kind, ...(r.data || {}) })).filter((o: any) => o.emailedAt);
      if (a.client) list = list.filter((o: any) => String((o.client && o.client.name) || "").toLowerCase().includes(String(a.client).toLowerCase()));
      const by = new Map<string, any[]>();
      list.forEach((o: any) => { const c = (o.client && o.client.name) || "—"; if (!by.has(c)) by.set(c, []); by.get(c)!.push(o); });
      const groups = [...by.entries()].map(([name, docs]) => {
        docs.sort((x: any, y: any) => String(y.emailedAt).localeCompare(String(x.emailedAt)));
        return { client: name, rememberedEmail: lastTo[name.trim().toLowerCase()] || null,
          sent: docs.map((o: any) => ({ no: o.docNo, kind: o.kind, date: o.issueDate || null, sentAt: o.emailedAt, sentTo: o.emailedTo || null })) };
      }).sort((x, y) => String(y.sent[0].sentAt).localeCompare(String(x.sent[0].sentAt)));
      return { clients: groups.length, totalSent: list.length, groups };
    },
  },
  {
    name: "purchases_list",
    description: "ПОКУПКИ (фактурите от доставчици): № на фактурата, доставчик, вид разход, тип (Фактура / Кредитно известие − / Стокова разписка), дата, сума без ДДС, ДДС и общо в EUR. Кредитните са с минус. Филтри: месец, доставчик, вид разход, търсене.",
    inputSchema: { type: "object", properties: {
      month: { type: "string", description: "Месец ГГГГ-ММ (напр. 2026-10)" },
      supplier: { type: "string", description: "Част от името на доставчика" },
      expense_type: { type: "string", description: "Вид разход (напр. Метали, Транспорт, Инвестиции)" },
      q: { type: "string", description: "Търсене в № / доставчик / вид" },
      limit: { type: "number", description: "Най-много документи (по подразбиране 60, таван 300)" },
    } },
    run: async (a) => {
      const rows = await dbFetch("purchases?select=id,data");
      let list = rows.map((r) => ({ id: r.id, ...(r.data || {}) }));
      if (a.month) list = list.filter((o) => String(o.date || "").slice(0, 7) === String(a.month));
      if (a.supplier) list = list.filter((o) => String(o.supplierName || "").toLowerCase().includes(String(a.supplier).toLowerCase()));
      if (a.expense_type) list = list.filter((o) => String(o.expenseType || "").toLowerCase().includes(String(a.expense_type).toLowerCase()));
      const qq = String(a.q || "").toLowerCase();
      if (qq) list = list.filter((o) => `${o.invoiceNo || ""} ${o.supplierName || ""} ${o.expenseType || ""}`.toLowerCase().includes(qq));
      list.sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
      const lim = Math.min(Number(a.limit) || 60, 300);
      const kindOf = (o: any) => o.docType === "credit" ? "Кредитно известие" : o.docType === "goods" ? "Стокова разписка" : "Фактура";
      const out = list.slice(0, lim).map((o) => {
        const t = puTotals(o);
        const cur = o.currency || "BGN";
        return { invoiceNo: o.invoiceNo || null, supplier: o.supplierName || "", expenseType: o.expenseType || null,
          kind: kindOf(o), date: o.date || null, baseEur: r2(toEur(t.base, cur)), vatEur: r2(toEur(t.vat, cur)),
          totalEur: r2(toEur(t.total, cur)), creditToNo: o.creditToNo || null };
      });
      // Сборът за разходите е като в Пулса: БЕЗ стоковите разписки (не са разход).
      const sumBase = list.filter((o) => o.docType !== "goods").reduce((s, o) => s + toEur(puTotals(o).base, o.currency || "BGN"), 0);
      return { count: list.length, shown: out.length, truncated: list.length > out.length,
        totalBaseEurWithoutGoods: r2(sumBase), purchases: out };
    },
  },
  {
    name: "sales_list",
    description: "ПРОДАЖБИ (експедициите, които движат склада): № на продажбата, клиент, дата, осчетоводена ли е, редове (код/име/брой/цена) и стойност без ДДС в EUR.",
    inputSchema: { type: "object", properties: {
      month: { type: "string", description: "Месец ГГГГ-ММ" },
      client: { type: "string", description: "Част от името на клиента" },
      limit: { type: "number", description: "Най-много продажби (по подразбиране 60, таван 300)" },
    } },
    run: async (a) => {
      const rows = await dbFetch("sales?select=id,posted,data");
      let list = rows.map((r) => ({ id: r.id, posted: r.posted, ...(r.data || {}) }));
      if (a.month) list = list.filter((o) => String(o.date || "").slice(0, 7) === String(a.month));
      if (a.client) list = list.filter((o) => String(o.clientName || (o.client && o.client.name) || "").toLowerCase().includes(String(a.client).toLowerCase()));
      list.sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
      const lim = Math.min(Number(a.limit) || 60, 300);
      const out = list.slice(0, lim).map((o) => ({
        saleNo: o.saleNo || null, client: o.clientName || (o.client && o.client.name) || "", date: o.date || null,
        posted: !!o.posted, totalEur: r2(toEur(lineNet(o.lines), o.currency || "EUR")),
        lines: (o.lines || []).map((l: any) => ({ code: l.code || null, name: l.name || "", qty: num(l.qty), unitPrice: num(l.unitPrice) })),
      }));
      return { count: list.length, shown: out.length, truncated: list.length > out.length, sales: out };
    },
  },
  {
    name: "workshop_tasks",
    description: "Активните (незавършени) производствени задачи по цехове: цех, операция, код и име на детайла, произведени/пуснати бройки. Филтър по цех. Показва какво се работи в момента.",
    inputSchema: { type: "object", properties: {
      workshop: { type: "string", description: "Част от името на цеха (напр. Лазери, Абкант)" },
      limit: { type: "number", description: "Най-много задачи (по подразбиране 100, таван 300)" },
    } },
    run: async (a) => {
      // Само незавършените — филтър в базата, да не теглим хилядите готови.
      const rows = await dbFetch("tasks?select=id,done,data&done=eq.false");
      let list = rows.map((r) => ({ ...(r.data || {}) }))
        .filter((t: any) => !String(t.workshop || "").includes("\u00A6"))   // архивните цехове („¦арх:") вън
        .filter((t: any) => { const q = Number(t.qty) || 0, p = Number(t.produced) || 0; return !(q > 0 && p >= q); });
      if (a.workshop) list = list.filter((t: any) => String(t.workshop || "").toLowerCase().includes(String(a.workshop).toLowerCase()));
      list.sort((x: any, y: any) => String(x.workshop || "").localeCompare(String(y.workshop || ""), "bg") || String(x.deadline || "9999").localeCompare(String(y.deadline || "9999")));
      const lim = Math.min(Number(a.limit) || 100, 300);
      const out = list.slice(0, lim).map((t: any) => ({
        workshop: t.workshop || "", operation: t.operation || "", code: t.code || null, product: t.product || "",
        qty: Number(t.qty) || 0, produced: Number(t.produced) || 0, deadline: t.deadline || null,
        forStock: !!(t.source && t.source.stock),
      }));
      return { count: list.length, shown: out.length, truncated: list.length > out.length, tasks: out };
    },
  },
  {
    name: "transport_loads",
    description: "Логистика — товарите: фактура, клиент, дестинация, превозвач, камион, дата и статус (заявен/натоварен…).",
    inputSchema: { type: "object", properties: {
      client: { type: "string", description: "Част от името на клиента" },
      status: { type: "string", description: "Статус (напр. заявен, натоварен)" },
      limit: { type: "number", description: "Най-много товари (по подразбиране 40, таван 200)" },
    } },
    run: async (a) => {
      const d = await cfg("logistics_loads");
      let list = ((d && d.loads) || []).slice();
      if (a.client) list = list.filter((l: any) => String(l.client || "").toLowerCase().includes(String(a.client).toLowerCase()));
      if (a.status) list = list.filter((l: any) => String(l.status || "").toLowerCase().includes(String(a.status).toLowerCase()));
      list.sort((x: any, y: any) => String(y.date || y.at || "").localeCompare(String(x.date || x.at || "")));
      const lim = Math.min(Number(a.limit) || 40, 200);
      const out = list.slice(0, lim).map((l: any) => ({
        invoiceNo: l.invNo || null, orderNo: l.ourNo || null, client: l.client || "", dest: l.dest || null,
        carrier: l.carrier || null, vehicle: l.vehicle || null, date: l.date || null, status: l.status || null, note: l.note || null,
      }));
      return { count: list.length, shown: out.length, truncated: list.length > out.length, loads: out };
    },
  },
  {
    name: "payroll_month",
    description: "ЗАПЛАТИ — Месечният отчет по служители (ЧУВСТВИТЕЛНО, само за пълния ключ): за всеки — банка, CODE 005, надник, извънреден, бонус, различни, ОБЩО получено и осигуровките от ведомостта. Формулите са като екрана „Месечен отчет“ в Системата. Сумите са в EUR.",
    sensitive: true,
    inputSchema: { type: "object", properties: {
      month: { type: "string", description: "Месец ГГГГ-ММ (по подразбиране текущият)" },
    } },
    run: async (a) => {
      const month = /^\d{4}-\d{2}$/.test(String(a.month || "")) ? String(a.month) : new Date().toISOString().slice(0, 7);
      const [Y, M] = month.split("-").map(Number);
      const payRows = await dbFetch("app_config?select=id,data&id=like.payroll%25");
      // Петъците на месеца — за разпределянето на старите формати (като payFridays).
      const fridays: string[] = [];
      { const d = new Date(Y, M - 1, 1);
        while (d.getMonth() === M - 1) { if (d.getDay() === 5) fridays.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`); d.setDate(d.getDate() + 1); } }
      const tot: any = {};
      const g = (name: string) => tot[name] || (tot[name] = { bank: 0, cash: 0, nadnik: 0, overtime: 0, bonus: 0, rz: 0, osig: 0 });
      // 1) Седмичните записи (payroll_ГГГГ-ММ-ДД) с понеделник в месеца.
      payRows.filter((r: any) => /^payroll_\d{4}-\d{2}-\d{2}$/.test(String(r.id || ""))).forEach((r: any) => {
        const mon = (r.data && r.data.monday) || String(r.id).replace("payroll_", "");
        const d = new Date(mon + "T00:00:00");
        if (d.getFullYear() !== Y || d.getMonth() + 1 !== M) return;
        const e = (r.data && r.data.entries) || {};
        Object.keys(e).forEach((name) => {
          const row = e[name] || {};
          const t = g(name);
          ["bank", "cash", "nadnik", "overtime", "bonus"].forEach((k) => { t[k] += Number(row[k]) || 0; });
        });
      });
      // 2) „По петъци" (payroll_m_<месец>): банка → банка, 005 → CODE 005,
      //    отделно платените извънредни → извънреден, РАЗЛИЧНИ → rz
      //    (огледало на payComputeMonth/payFriNormalize/payFriBreakdown).
      const mRow = payRows.find((r: any) => String(r.id) === "payroll_m_" + month);
      Object.entries(((mRow || {}).data || {}).entries || {}).forEach(([name, r0]: any[]) => {
        const r = r0 || {};
        const fri = r.fri || {};
        const isNew = Object.values(fri).some((x: any) => x && typeof x === "object" && (("b" in x) || ("c" in x)));
        let b = 0, c = 0, oSep = 0;
        if (isNew) {
          Object.values(fri).forEach((x: any) => {
            if (!x || typeof x !== "object") return;
            b += Number(x.b) || 0; c += Number(x.c) || 0;
            if (!x.i) oSep += Number(x.o) || 0;   // i=1 → извънредният е ВЪТРЕ в банка/005
          });
        } else {
          // Стар формат {w,o}/число: разпределяне банка→005 по натрупване спрямо net.
          const net = Number(r.net) || 0; let cum = 0;
          fridays.forEach((iso) => {
            const x = (fri as any)[iso];
            const w = (x && typeof x === "object") ? (Number(x.w) || 0) : (Number(x) || 0);
            const o = (x && typeof x === "object") ? (Number(x.o) || 0) : 0;
            const amt = w + o;
            const bb = Math.min(amt, Math.max(0, net - cum));
            b += bb; c += amt - bb; cum += amt; oSep += o;
          });
        }
        const rz = Number((r.rz || {}).sum) || 0;
        if (!(b || c || oSep || rz)) return;
        const t = g(name);
        t.bank += b; t.cash += c; t.overtime += oSep; t.rz += rz;
      });
      // 3) Осигуровките от ведомостта (payroll_osig_<месец>).
      const oRow = payRows.find((r: any) => String(r.id) === "payroll_osig_" + month);
      const osigBy = ((oRow || {}).data || {}).byName || {};
      Object.keys(osigBy).forEach((name) => { g(name).osig += Number(osigBy[name]) || 0; });
      const extraOsig = (((oRow || {}).data || {}).extra || []).map((x: any) => ({ who: x.raw || "", osigEur: r2(Number(x.osig) || 0) }));
      const workers = Object.keys(tot).sort((x, y) => x.localeCompare(y, "bg")).map((name) => {
        const t = tot[name];
        const total = t.bank + t.cash + t.nadnik + t.overtime + t.bonus + t.rz;
        return { name, bankEur: r2(t.bank), code005Eur: r2(t.cash), nadnikEur: r2(t.nadnik), overtimeEur: r2(t.overtime),
          bonusEur: r2(t.bonus), othersEur: r2(t.rz), totalReceivedEur: r2(total), osigEur: r2(t.osig) };
      }).filter((w: any) => w.totalReceivedEur || w.osigEur);
      const sum = (k: string) => r2(workers.reduce((s: number, w: any) => s + (w[k] || 0), 0));
      return { month, workers,
        totals: { totalReceivedEur: sum("totalReceivedEur"), bankEur: sum("bankEur"), code005Eur: sum("code005Eur"), osigEur: sum("osigEur") },
        extraOsig, extraOsigTotalEur: r2(extraOsig.reduce((s: number, x: any) => s + x.osigEur, 0)),
        note: "Осигуровките са от ведомостта (месец назад), изцяло за сметка на фирмата — НЕ влизат в „ОБЩО получено“. Всичко към НАП = осигуровките на списъка + „извън списъка“." };
    },
  },
  {
    name: "transport_costs",
    description: "Колко плащаме за ТРАНСПОРТ: транспортните фактури от Покупки (вид разход „Транспорт…\u201c или доставчик от категория Транспорт/логистика в указателя) с дата, превозвач, сума без ДДС в EUR, дестинация и палети (от Логистиката) и ОТКЪС ОТ ТЕКСТА на редовете — там обикновено пише за кой клиент/курс е. Търсенето рови и в текста (напр. клиент или град). Кредитните са с минус.",
    inputSchema: { type: "object", properties: {
      q: { type: "string", description: "Търсене в превозвач / дестинация / текста на редовете (напр. име на клиент или град)" },
      months: { type: "number", description: "Период назад в месеци (по подразбиране 6; 0 = всичко)" },
      limit: { type: "number", description: "Най-много фактури (по подразбиране 80, таван 300)" },
    } },
    run: async (a) => {
      const [puRows, conRows, logi] = await Promise.all([
        dbFetch("purchases?select=id,data"), dbFetch("contacts?select=data"), cfg("logistics_loads"),
      ]);
      const norm = (x: unknown) => String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
      const carriers = new Set(conRows.map((r) => r.data || {})
        .filter((c: any) => /транспорт/i.test(c.category || "")).map((c: any) => norm(c.company)));
      const tcost = (logi && logi.tcost) || {};
      const m = a.months == null ? 6 : Number(a.months) || 0;
      const since = m ? (() => { const d = new Date(); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); })() : "";
      let list = puRows.map((r) => ({ id: r.id, ...(r.data || {}) }))
        .filter((p: any) => /^транспорт/i.test(p.expenseType || "") || (p.supplierName && carriers.has(norm(p.supplierName))))
        .filter((p: any) => !since || String(p.date || "") >= since);
      const row = (p: any) => {
        const t = puTotals(p);
        const tc = tcost[String(p.id)] || {};
        const txt = ((p.lines || []).map((l: any) => [l.article, l.name].filter(Boolean).join(" ")).join(" · ") + " " + (p.note || "")).trim();
        const palM = txt.match(/(\d{1,3})\s*(?:бр\.?\s*)?(?:евро\s*)?(?:пале|pallet|pal\b)/i);
        return { date: p.date || null, carrier: p.supplierName || "", invoiceNo: p.invoiceNo || null,
          kind: p.docType === "credit" ? "Кредитно известие" : "Фактура",
          baseEur: r2(toEur(t.base, p.currency || "BGN")),
          dest: tc.dest || null, pallets: Number(tc.pallets) || (palM ? Number(palM[1]) : null),
          text: txt.slice(0, 180) || null };
      };
      let out = list.map(row);
      const qq = norm(a.q);
      if (qq) out = out.filter((x: any) => norm(`${x.carrier} ${x.dest || ""} ${x.text || ""}`).includes(qq));
      out.sort((x: any, y: any) => String(y.date || "").localeCompare(String(x.date || "")));
      const lim = Math.min(Number(a.limit) || 80, 300);
      return { count: out.length, shown: Math.min(out.length, lim), truncated: out.length > lim,
        totalBaseEur: r2(out.reduce((s: number, x: any) => s + x.baseEur, 0)),
        note: "Връзката „транспорт → клиент\u201c не е структурно поле: търси по текста на редовете и дестинацията. Ако търсенето по клиент не хване нищо, вероятно името не е писано във фактурата на превозвача.",
        invoices: out.slice(0, lim) };
    },
  },
];

/* ---------- MCP протоколът (Streamable HTTP, без сесии) ---------- */
const PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = { name: "danko-systems-erp", title: "Данко Системс — СИСТЕМАТА", version: "1.3.0" };

function rpcResult(id: any, result: any) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id: any, code: number, message: string) { return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } }; }

function tokenEq(want: string, got: string): boolean {
  if (!want || want.length < 20 || !got || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
/* Два ключа: MCP_TOKEN = ПЪЛЕН достъп (вкл. заплатите);
   MCP_TOKEN_LIMITED (по избор) = всичко БЕЗ чувствителните справки.
   Данко решава кой ключ на кого да даде. */
function tokenAccess(req: Request): "full" | "limited" | null {
  const u = new URL(req.url);
  const parts = u.pathname.split("/").filter(Boolean);
  const got = parts[parts.length - 1] !== "mcp" ? parts[parts.length - 1] : (req.headers.get("x-mcp-token") || "");
  if (tokenEq(ENV("MCP_TOKEN"), got)) return "full";
  if (tokenEq(ENV("MCP_TOKEN_LIMITED"), got)) return "limited";
  return null;
}

async function handleRpc(msg: any, access: "full" | "limited"): Promise<any | null> {
  const { id, method, params } = msg || {};
  if (typeof method !== "string" || !method) return rpcError(id, -32600, "Invalid Request.");
  if (method === "initialize") {
    const asked = params && params.protocolVersion;
    return rpcResult(id, {
      protocolVersion: PROTOCOLS.has(asked) ? asked : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions: "Справки само за четене от ERP-то на Данко Системс (металообработка, Пловдив). Суми: EUR без ДДС, освен където е казано друго. Отговаряй на български.",
    });
  }
  if (method === "notifications/initialized" || String(method || "").startsWith("notifications/")) return null;   // без отговор
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") {
    const visible = TOOLS.filter((t) => !(t as any).sensitive || access === "full");
    return rpcResult(id, { tools: visible.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
  }
  if (method === "tools/call") {
    const name = params && params.name;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return rpcError(id, -32602, `Няма инструмент „${name}".`);
    if ((tool as any).sensitive && access !== "full") {
      return rpcResult(id, { content: [{ type: "text", text: "Този ключ няма достъп до тази справка." }], isError: true });
    }
    try {
      const res = await tool.run((params && params.arguments) || {});
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(res) }], isError: false });
    } catch (e: any) {
      return rpcResult(id, { content: [{ type: "text", text: "Грешка: " + (e && e.message || String(e)) }], isError: true });
    }
  }
  return rpcError(id, -32601, `Непознат метод „${method}".`);
}

const handler = async (req: Request): Promise<Response> => {
  const H = { "content-type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, x-mcp-token", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  const access = tokenAccess(req);
  if (!access) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: H });
  if (req.method === "GET") return new Response(null, { status: 405, headers: H });     // няма SSE поток — stateless
  if (req.method === "DELETE") return new Response(null, { status: 200, headers: H });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: H });
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify(rpcError(null, -32700, "Невалиден JSON.")), { status: 400, headers: H }); }
  if (Array.isArray(body)) {   // batch (стар протокол) — с таван, да не громи базата
    if (!body.length || body.length > 20) return new Response(JSON.stringify(rpcError(null, -32600, "Batch до 20 заявки.")), { status: 400, headers: H });
    const answers = (await Promise.all(body.map((m: any) => handleRpc(m, access)))).filter((x) => x !== null);
    return answers.length ? new Response(JSON.stringify(answers), { headers: H }) : new Response(null, { status: 202, headers: H });
  }
  const ans = await handleRpc(body, access);
  return ans === null ? new Response(null, { status: 202, headers: H }) : new Response(JSON.stringify(ans), { headers: H });
};

// В Supabase (Deno) тръгва сървърът; в тестовете файлът само изнася handler-а.
if (typeof Deno !== "undefined" && (Deno as any).serve) (Deno as any).serve(handler);
export { handler };
