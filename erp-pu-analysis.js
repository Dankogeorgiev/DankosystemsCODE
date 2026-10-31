/* Данко Системс — „🤖 Анализ на покупките" (по Данко, 24.10.2026).
   Пълен разбор на разходите за избран период: по вид (Метали, Транспорт,
   Крепежи, Бои и цинк…), металите В КИЛОГРАМИ с Ø цена €/кг (и по подвид:
   ламарина/тръби/шини/щрипс), топ доставчици, движение по месеци — и отгоре
   КОМЕНТАР ОТ CLAUDE (през Edge функцията „assistant", ключът не е в браузъра).
   Сумите са БЕЗ ДДС, в EUR (BGN ÷ 1.95583); кредитните известия са с минус. */

const PUA_BGN = 1.95583;

function puaK(o) { return (o.currency === "BGN") ? 1 / PUA_BGN : 1; }
function puaBase(o) {
  try { if (typeof erpPuTotals === "function") return erpPuTotals(o).base * puaK(o); } catch (e) {}
  return 0;
}
function puaMonth(o) { return String(o.date || "").slice(0, 7); }
function puaF2(n) { return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* Подвид метал по текста на реда. */
function puaMetalKind(text) {
  const s = String(text || "").toLowerCase();
  if (/ламарин|лист|рулон/.test(s)) return "Ламарина";
  if (/тръб/.test(s)) return "Тръби";
  if (/шина/.test(s)) return "Шини";
  if (/щрипс|лента/.test(s)) return "Щрипс/лента";
  if (/винкел|профил/.test(s)) return "Профили/винкели";
  if (/тел\b|тел /.test(s)) return "Тел";
  return "Други метали";
}

/* Агрегатите за периода [from..to] (YYYY-MM, включително). */
function puaBuild(from, to) {
  const rows = ((typeof erpPurchases !== "undefined" && erpPurchases) || [])
    .filter(p => { const m = puaMonth(p); return m && m >= from && m <= to; });
  const byType = new Map(), byVendor = new Map(), byMonth = new Map();
  const metals = { kg: 0, eur: 0, byKind: new Map(), byMonth: new Map() };
  // Складовите редове (с избран „Материал (склад)") — ТЕ влизат в склада,
  // независимо от вида разход. Групираме ги по складова група, за да се
  // види какво реално заприходяваме и дали нещо виси под грешен вид.
  const stock = { lines: 0, eur: 0, byGroup: new Map(), nonMat: new Map(), typesWithStock: new Set() };
  let total = 0;
  rows.forEach(p => {
    const base = puaBase(p);
    total += base;
    const t = p.expenseType || "— без класификация";
    const bt = byType.get(t) || { sum: 0, n: 0 }; bt.sum += base; bt.n++; byType.set(t, bt);
    const vn = p.supplierName || "—";
    const bv = byVendor.get(vn) || { sum: 0, n: 0 }; bv.sum += base; bv.n++; byVendor.set(vn, bv);
    const m = puaMonth(p);
    byMonth.set(m, (byMonth.get(m) || 0) + base);
    {
      const k = puaK(p), sign = p.docType === "credit" ? -1 : 1;
      const isMat = !!(p.expenseType && typeof erpPuTypeIsMat === "function" && erpPuTypeIsMat(p.expenseType));
      (p.lines || []).forEach(l => {
        if (!l.materialId) return;
        const eur = (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0) * k * sign;
        stock.lines++; stock.eur += eur; stock.typesWithStock.add(t);
        const nm = l.article || l.name || "";
        const g = l.groupName || "— без група";
        const bg = stock.byGroup.get(g) || { n: 0, eur: 0, types: new Set(), ex: [] };
        bg.n++; bg.eur += eur; bg.types.add(t);
        if (nm && bg.ex.length < 3 && !bg.ex.includes(nm)) bg.ex.push(nm);
        stock.byGroup.set(g, bg);
        if (!isMat) {
          const bn = stock.nonMat.get(t) || { n: 0, eur: 0, ex: [] };
          bn.n++; bn.eur += eur;
          if (nm && bn.ex.length < 3 && !bn.ex.includes(nm)) bn.ex.push(nm);
          stock.nonMat.set(t, bn);
        }
      });
    }
    // Металите в килограми — редовете на фактурите „Метали" с мерна единица кг/тон.
    if (p.expenseType === "Метали") {
      const k = puaK(p);
      const sign = p.docType === "credit" ? -1 : 1;
      (p.lines || []).forEach(l => {
        const u = String(l.unit || "").toLowerCase();
        let kg = 0;
        if (/кг|kg/.test(u)) kg = erpToNum(l.qty) || 0;
        else if (/^т\.?$|тон|^t$/.test(u)) kg = (erpToNum(l.qty) || 0) * 1000;
        if (kg <= 0) return;
        const eur = kg * (erpToNum(l.unitPrice) || 0) * (/тон|^т\.?$|^t$/.test(u) ? 1 / 1000 : 1) * k * sign;
        kg *= sign;
        metals.kg += kg; metals.eur += eur;
        const kind = puaMetalKind((l.article || "") + " " + (l.name || ""));
        const bk = metals.byKind.get(kind) || { kg: 0, eur: 0 }; bk.kg += kg; bk.eur += eur; metals.byKind.set(kind, bk);
        const bm = metals.byMonth.get(m) || { kg: 0, eur: 0 }; bm.kg += kg; bm.eur += eur; metals.byMonth.set(m, bm);
      });
    }
  });
  return { from, to, count: rows.length, total, byType, byVendor, byMonth, metals, stock };
}

function puaRender(d) {
  const typeRows = [...d.byType.entries()].sort((a, b) => b[1].sum - a[1].sum);
  const vendorRows = [...d.byVendor.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 10);
  const monthRows = [...d.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const kindRows = [...d.metals.byKind.entries()].sort((a, b) => b[1].eur - a[1].eur);
  const mm = [...d.metals.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sgRows = [...d.stock.byGroup.entries()].sort((a, b) => b[1].eur - a[1].eur);
  const nmRows = [...d.stock.nonMat.entries()].sort((a, b) => b[1].n - a[1].n);
  // Материални видове, по които ИМА фактури, но нито един ред не е минал
  // през „Материал (склад)" — т.е. купеното не е влязло в наличностите.
  const matIdle = (typeof PU_EXPENSE_TYPES !== "undefined" ? PU_EXPENSE_TYPES : [])
    .filter(t => t.mat && d.byType.has(t.k) && !d.stock.typesWithStock.has(t.k)).map(t => t.k);
  const stockHtml = d.stock.lines ? `
    <h4 class="erp-group-head">📦 Какво влиза в склада (заприходявани редове)</h4>
    <p style="margin:4px 0"><b>${d.stock.lines}</b> складови реда за <b>${puaF2(d.stock.eur)} EUR</b>. В склада влиза всеки ред, добавен с „Материал (склад)" — независимо от вида разход на фактурата.</p>
    <table class="report-table erp-table"><thead><tr><th>Група (склад)</th><th class="num">Редове</th><th class="num">EUR</th><th>Вид разход</th><th>Примери</th></tr></thead>
      <tbody>${sgRows.map(([k, x]) => `<tr><td><b>${escapeHtml(k)}</b></td><td class="num">${x.n}</td><td class="num">${puaF2(x.eur)}</td><td>${escapeHtml([...x.types].join(", "))}</td><td class="erp-muted">${escapeHtml(x.ex.join(" · "))}</td></tr>`).join("")}</tbody></table>
    ${nmRows.length ? `<p style="margin:6px 0;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:8px 12px">⚠ <b>Складови редове под НЕ-материален вид разход:</b><br>${nmRows.map(([k, x]) => `• <b>${escapeHtml(k)}</b> — ${x.n} реда (${puaF2(x.eur)} EUR)${x.ex.length ? ": " + escapeHtml(x.ex.join(" · ")) : ""}`).join("<br>")}<br><span class="erp-muted">Тези редове СА влезли в склада. Ако видът е верен, значи и той вкарва материали — кажи да го отбележим като материален (🧱).</span></p>` : `<p class="hint">Всички складови редове са под материалните видове (🧱). ✔</p>`}
    ${matIdle.length ? `<p class="hint">ℹ Материални видове с фактури, но БЕЗ нито един складов ред в периода: <b>${escapeHtml(matIdle.join(", "))}</b> — редовете им са въведени като „разход/услуга" и НЕ са вдигнали наличности.</p>` : ""}` : "";
  return `
    <p style="margin:6px 0"><b>${d.count}</b> документа за периода · общо <b>${puaF2(d.total)} EUR</b> без ДДС</p>
    <div id="pua-ai" style="margin:8px 0"></div>
    <h4 class="erp-group-head">По вид разход</h4>
    <table class="report-table erp-table"><thead><tr><th>Вид</th><th class="num">Сума (EUR)</th><th class="num">Дял</th><th class="num">Фактури</th></tr></thead>
      <tbody>${typeRows.map(([k, x]) => `<tr><td><b>${escapeHtml(k)}</b></td><td class="num">${puaF2(x.sum)}</td><td class="num">${d.total ? Math.round(x.sum / d.total * 100) : 0}%</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table>
    ${stockHtml}
    ${d.metals.kg ? `<h4 class="erp-group-head">Метали в килограми</h4>
    <p style="margin:4px 0">Общо <b>${erpNum(Math.round(d.metals.kg))} кг</b> за <b>${puaF2(d.metals.eur)} EUR</b> · Ø <b>${puaF2(d.metals.eur / d.metals.kg)} €/кг</b></p>
    <table class="report-table erp-table"><thead><tr><th>Подвид</th><th class="num">Кг</th><th class="num">EUR</th><th class="num">Ø €/кг</th></tr></thead>
      <tbody>${kindRows.map(([k, x]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${erpNum(Math.round(x.kg))}</td><td class="num">${puaF2(x.eur)}</td><td class="num">${x.kg ? puaF2(x.eur / x.kg) : "—"}</td></tr>`).join("")}</tbody></table>
    <table class="report-table erp-table"><thead><tr><th>Месец</th><th class="num">Кг</th><th class="num">Ø €/кг</th></tr></thead>
      <tbody>${mm.map(([m, x]) => `<tr><td>${escapeHtml(m)}</td><td class="num">${erpNum(Math.round(x.kg))}</td><td class="num">${x.kg ? puaF2(x.eur / x.kg) : "—"}</td></tr>`).join("")}</tbody></table>` : ""}
    <h4 class="erp-group-head">Топ доставчици</h4>
    <table class="report-table erp-table"><thead><tr><th>Доставчик</th><th class="num">Сума (EUR)</th><th class="num">Фактури</th></tr></thead>
      <tbody>${vendorRows.map(([k, x]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${puaF2(x.sum)}</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table>
    <h4 class="erp-group-head">По месеци</h4>
    <table class="report-table erp-table"><thead><tr><th>Месец</th><th class="num">Сума (EUR)</th></tr></thead>
      <tbody>${monthRows.map(([m, s]) => `<tr><td>${escapeHtml(m)}</td><td class="num">${puaF2(s)}</td></tr>`).join("")}</tbody></table>`;
}

/* Компактното резюме за Claude (кратко, за да не гори токени). */
function puaSummaryText(d) {
  const t = [...d.byType.entries()].sort((a, b) => b[1].sum - a[1].sum)
    .map(([k, x]) => `${k}: ${Math.round(x.sum)} EUR (${x.n} ф-ри)`).join("; ");
  const v = [...d.byVendor.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 8)
    .map(([k, x]) => `${k}: ${Math.round(x.sum)}`).join("; ");
  const m = [...d.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, s]) => `${k}: ${Math.round(s)}`).join("; ");
  const mk = [...d.metals.byKind.entries()].map(([k, x]) => `${k}: ${Math.round(x.kg)} кг @ ${x.kg ? (x.eur / x.kg).toFixed(2) : "?"} €/кг`).join("; ");
  const mm = [...d.metals.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, x]) => `${k}: ${Math.round(x.kg)} кг @ ${x.kg ? (x.eur / x.kg).toFixed(2) : "?"}`).join("; ");
  const sg = [...d.stock.byGroup.entries()].sort((a, b) => b[1].eur - a[1].eur).slice(0, 12)
    .map(([k, x]) => `${k}: ${x.n} реда / ${Math.round(x.eur)} EUR (вид: ${[...x.types].join("+")})`).join("; ");
  const nm = [...d.stock.nonMat.entries()]
    .map(([k, x]) => `${k}: ${x.n} реда (${x.ex.join(", ")})`).join("; ");
  return `Период: ${d.from} до ${d.to}. Общо покупки: ${Math.round(d.total)} EUR без ДДС, ${d.count} документа.
По вид: ${t}.
Метали общо: ${Math.round(d.metals.kg)} кг за ${Math.round(d.metals.eur)} EUR (средно ${d.metals.kg ? (d.metals.eur / d.metals.kg).toFixed(2) : "?"} €/кг). По подвид: ${mk}.
Метали по месец (кг @ €/кг): ${mm}.
Складови (заприходявани) редове: ${d.stock.lines} за ${Math.round(d.stock.eur)} EUR. По складова група: ${sg || "няма"}.
Складови редове под НЕ-материален вид разход: ${nm || "няма"}.
Топ доставчици: ${v}.
Общо по месец: ${m}.`;
}

/* Общият канал към Claude (Edge функцията „assistant" — ключът не е тук). */
async function puaClaudeCall(system, messages) {
  const cfg = window.DANKO_CONFIG || {};
  if (!cfg.SUPABASE_URL) throw new Error("Няма връзка с облака.");
  let token = cfg.SUPABASE_ANON_KEY;
  try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
  // Дълъг разговор: данните (първото съобщение) + последните ~11 реплики.
  const trimmed = messages.length > 12 ? [messages[0], ...messages.slice(-11)] : messages;
  const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
    body: JSON.stringify({ system, messages: trimmed, max_tokens: 1600 }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || ("HTTP " + res.status));
  return j.text || "(празен отговор)";
}

/* 💬 ЧАТ с Claude върху анализа (Данко, 24.10.2026): първият отговор е
   коментарът, а отдолу Данко пише какво да се има предвид / какво да се
   игнорира и Claude преработва. Данните стоят в първото (скрито) съобщение. */
function puaChatMount(box, system, dataText) {
  const msgs = [];
  // Логът скролва САМ (max-height), а полето за писане стои ВИНАГИ видимо
  // под него — иначе дългият анализ го избутваше извън екрана (Пулс).
  box.innerHTML = `
    <div id="pua-chat-log" style="max-height:45vh;overflow:auto"></div>
    <div class="erp-toolbar" style="margin:6px 0 10px">
      <input type="text" id="pua-chat-in" placeholder="💬 Кажи на Claude какво да има предвид / задай въпрос… (Enter)" style="flex:1;min-width:220px" />
      <button class="btn btn-small btn-primary" id="pua-chat-send" title="Изпраща уточнението — Claude отговаря, помнейки данните и разговора">↩ Изпрати</button>
    </div>`;
  const log = box.querySelector("#pua-chat-log");
  const paint = busy => {
    log.innerHTML = msgs.slice(1).map(m => m.role === "user"
      ? `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:8px 12px;margin:6px 0;font-size:13px">🙋 ${escapeHtml(m.content)}</div>`
      : `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px 14px;margin:6px 0;white-space:pre-wrap;font-size:13.5px;line-height:1.55">🤖 ${escapeHtml(m.content)}</div>`).join("")
      + (busy ? `<div class="erp-loading">🤖 Claude пише…</div>` : "");
    log.scrollTop = log.scrollHeight;   // най-новото винаги в полезрение
  };
  let busy = false;
  const send = async userText => {
    if (busy) return;
    busy = true;
    msgs.push({ role: "user", content: userText });
    paint(true);
    try { msgs.push({ role: "assistant", content: await puaClaudeCall(system, msgs) }); }
    catch (e) { msgs.push({ role: "assistant", content: "⚠ Claude не отговори: " + (e.message || e) + "\n(Таблиците долу са пълни и без него. Опитай пак след минута.)" }); }
    busy = false;
    paint(false);
  };
  const inp = box.querySelector("#pua-chat-in");
  const go = () => { const t = inp.value.trim(); if (!t) return; inp.value = ""; send(t); };
  box.querySelector("#pua-chat-send").addEventListener("click", go);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  // Данните + молбата за първия анализ (не се показват в чата).
  send(dataText + "\n\nДай първоначалния анализ.");
}

function puaAiComment(d, box) {
  const system = `Ти си финансовият анализатор на „Данко Системс" (металообработваща фирма, Пловдив). Разговаряш с Данко (собственика) върху обобщение на ПОКУПКИТЕ (разходите) за период. Първо дай кратък, конкретен коментар НА БЪЛГАРСКИ (10-15 изречения, с булети):
1) Най-големите пера и дяловете им; 2) Движението по месеци — расте/пада и къде; 3) Металите: количества и ДВИЖЕНИЕТО НА ЦЕНАТА €/кг по месеци (поскъпване/поевтиняване, с числа); 4) Аномалии и съмнителни скокове; 5) 2-3 практични препоръки (къде да се натисне за цена, какво да се следи). Пиши стегнато, с числата от данните. Без общи приказки.
После отговаряй на уточненията му: ако каже нещо да се има предвид или да се игнорира — преработи анализа според това.`;
  return puaChatMount(box, system, puaSummaryText(d));
}

async function erpPuAnalysisDialog() {
  try { if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases(); } catch (e) {}
  const now = new Date();
  const toDef = now.toISOString().slice(0, 7);
  const fromDef = String(now.getFullYear()) + "-01";
  const { wrap, close } = erpDialog(`
    <h3>🤖 Анализ на покупките</h3>
    <div class="erp-toolbar" style="margin:0 0 8px">
      <label class="erp-inline">От <input type="month" id="pua-from" value="${fromDef}" /></label>
      <label class="erp-inline">До <input type="month" id="pua-to" value="${toDef}" /></label>
      <button class="btn btn-small btn-primary" id="pua-go">📊 Анализирай</button>
    </div>
    <div id="pua-out" style="max-height:62vh;overflow:auto"><p class="hint">Избери периода и натисни „📊 Анализирай" — таблиците излизат веднага, а Claude пише коментара отгоре.</p></div>
    <div class="erp-dialog-actions"><button class="btn" id="pua-close">Затвори</button></div>`);
  try { wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide"); } catch (e) {}
  wrap.querySelector("#pua-close").addEventListener("click", close);
  wrap.querySelector("#pua-go").addEventListener("click", () => {
    const from = wrap.querySelector("#pua-from").value || fromDef;
    const to = wrap.querySelector("#pua-to").value || toDef;
    const d = puaBuild(from, to);
    const out = wrap.querySelector("#pua-out");
    out.innerHTML = d.count ? puaRender(d) : `<p class="report-empty">Няма покупки в периода ${escapeHtml(from)} – ${escapeHtml(to)}.</p>`;
    if (d.count) puaAiComment(d, out.querySelector("#pua-ai"));
  });
}

/* ================== 🤖 Анализ на ПРОДАЖБИТЕ (фактурите) ==================
   По Данко, 24.10.2026: огледалният анализ — по клиенти, продукти, износ/
   вътрешен пазар, по месеци + коментар от Claude. Гледат се ИЗДАДЕНИТЕ
   фактури и известия (кредитните с минус); проформите и анулираните НЕ. */

function invaCurK(o) { return (erpInvCur(o) === "BGN") ? 1 / PUA_BGN : 1; }

function invaBuild(from, to) {
  const rows = ((typeof erpInvoices !== "undefined" && erpInvoices) || []).filter(o => {
    if (!o.posted || o.kind === "proforma" || o.status === "анулирана") return false;
    const m = String(o.issueDate || "").slice(0, 7);
    return m && m >= from && m <= to;
  });
  const byClient = new Map(), byProduct = new Map(), byMonth = new Map(), bySeries = new Map();
  let total = 0, vat = 0, credits = 0;
  rows.forEach(o => {
    const t = erpInvTotals(o);          // кредитните са с минус
    const k = invaCurK(o);
    const base = t.base * k;
    total += base; vat += t.vat * k;
    if (o.kind === "credit") credits += base;
    const cn = (o.client && o.client.name) || "—";
    const bc = byClient.get(cn) || { sum: 0, n: 0 }; bc.sum += base; bc.n++; byClient.set(cn, bc);
    const m = String(o.issueDate || "").slice(0, 7);
    byMonth.set(m, (byMonth.get(m) || 0) + base);
    const sk = (typeof invSeriesOfInvoice === "function") ? invSeriesOfInvoice(o) : String(o.seriesKey || "2");
    const lbl = sk === "1" ? "🌍 Износ" : (sk === "3" ? "📆 Месечни" : "🇧🇬 Вътрешен");
    const bs = bySeries.get(lbl) || { sum: 0, n: 0 }; bs.sum += base; bs.n++; bySeries.set(lbl, bs);
    const sign = o.kind === "credit" ? -1 : 1;
    (o.lines || []).forEach(l => {
      const key = (l.code ? l.code + " · " : "") + (l.name || "—");
      const qty = (erpToNum(l.qty) || 0) * sign;
      const eur = qty * (erpToNum(l.unitPrice) || 0) * k;
      const bp = byProduct.get(key) || { qty: 0, eur: 0, n: 0 };
      bp.qty += qty; bp.eur += eur; bp.n++;
      byProduct.set(key, bp);
    });
  });
  return { from, to, count: rows.length, total, vat, credits, byClient, byProduct, byMonth, bySeries };
}

function invaRender(d) {
  const cliRows = [...d.byClient.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 15);
  const prodRows = [...d.byProduct.entries()].sort((a, b) => b[1].eur - a[1].eur).slice(0, 15);
  const monthRows = [...d.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const serRows = [...d.bySeries.entries()].sort((a, b) => b[1].sum - a[1].sum);
  return `
    <p style="margin:6px 0"><b>${d.count}</b> документа за периода · фактурирано <b>${puaF2(d.total)} EUR</b> без ДДС${d.credits ? ` · кредитни: <b>${puaF2(d.credits)}</b>` : ""}</p>
    <div id="inva-ai" style="margin:8px 0"></div>
    <h4 class="erp-group-head">Пазари</h4>
    <table class="report-table erp-table"><thead><tr><th>Пазар</th><th class="num">Сума (EUR)</th><th class="num">Дял</th><th class="num">Фактури</th></tr></thead>
      <tbody>${serRows.map(([k, x]) => `<tr><td><b>${escapeHtml(k)}</b></td><td class="num">${puaF2(x.sum)}</td><td class="num">${d.total ? Math.round(x.sum / d.total * 100) : 0}%</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table>
    <h4 class="erp-group-head">Топ клиенти</h4>
    <table class="report-table erp-table"><thead><tr><th>Клиент</th><th class="num">Сума (EUR)</th><th class="num">Дял</th><th class="num">Фактури</th></tr></thead>
      <tbody>${cliRows.map(([k, x]) => `<tr><td><b>${escapeHtml(k)}</b></td><td class="num">${puaF2(x.sum)}</td><td class="num">${d.total ? Math.round(x.sum / d.total * 100) : 0}%</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table>
    <h4 class="erp-group-head">Топ продукти</h4>
    <table class="report-table erp-table"><thead><tr><th>Продукт</th><th class="num">Бройки</th><th class="num">Сума (EUR)</th><th class="num">Ø цена</th></tr></thead>
      <tbody>${prodRows.map(([k, x]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${erpNum(Math.round(x.qty))}</td><td class="num">${puaF2(x.eur)}</td><td class="num">${x.qty ? puaF2(x.eur / x.qty) : "—"}</td></tr>`).join("")}</tbody></table>
    <h4 class="erp-group-head">По месеци</h4>
    <table class="report-table erp-table"><thead><tr><th>Месец</th><th class="num">Фактурирано (EUR)</th></tr></thead>
      <tbody>${monthRows.map(([m, s]) => `<tr><td>${escapeHtml(m)}</td><td class="num">${puaF2(s)}</td></tr>`).join("")}</tbody></table>`;
}

function invaSummaryText(d) {
  const c = [...d.byClient.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 10)
    .map(([k, x]) => `${k}: ${Math.round(x.sum)} EUR (${x.n} ф-ри)`).join("; ");
  const p = [...d.byProduct.entries()].sort((a, b) => b[1].eur - a[1].eur).slice(0, 12)
    .map(([k, x]) => `${k}: ${Math.round(x.qty)} бр @ ${x.qty ? (x.eur / x.qty).toFixed(2) : "?"} = ${Math.round(x.eur)}`).join("; ");
  const m = [...d.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, s]) => `${k}: ${Math.round(s)}`).join("; ");
  const s = [...d.bySeries.entries()].map(([k, x]) => `${k}: ${Math.round(x.sum)} (${x.n})`).join("; ");
  return `Период: ${d.from} до ${d.to}. Фактурирано: ${Math.round(d.total)} EUR без ДДС, ${d.count} документа. Кредитни известия: ${Math.round(d.credits)} EUR.
Пазари: ${s}.
Топ клиенти: ${c}.
Топ продукти (бройки @ Ø цена = сума): ${p}.
По месец: ${m}.`;
}

function invaAiComment(d, box) {
  const system = `Ти си търговският анализатор на „Данко Системс" (металообработваща фирма, Пловдив — механизми за мека мебел, метални изделия). Разговаряш с Данко (собственика) върху обобщение на ПРОДАЖБИТЕ (издадените фактури) за период. Първо дай кратък, конкретен коментар НА БЪЛГАРСКИ (10-15 изречения, с булети):
1) Концентрация по клиенти — кой носи оборота и колко е рискът от зависимост; 2) Движението по месеци — расте/пада, сезонност; 3) Износ срещу вътрешен пазар; 4) Продуктите — кои носят парите, къде Ø цената изглежда ниска; 5) Кредитните известия — нормални ли са; 6) 2-3 практични препоръки. Пиши стегнато, с числата от данните. Без общи приказки.
После отговаряй на уточненията му: ако каже нещо да се има предвид или да се игнорира — преработи анализа според това.`;
  return puaChatMount(box, system, invaSummaryText(d));
}

async function erpInvAnalysisDialog() {
  try { if (typeof erpLoadInvoices === "function" && (typeof erpInvoices === "undefined" || !erpInvoices)) await erpLoadInvoices(); } catch (e) {}
  try { if (typeof erpInvLoadSeries === "function") await erpInvLoadSeries(); } catch (e) {}
  const now = new Date();
  const toDef = now.toISOString().slice(0, 7);
  const fromDef = String(now.getFullYear()) + "-01";
  const { wrap, close } = erpDialog(`
    <h3>🤖 Анализ на продажбите</h3>
    <div class="erp-toolbar" style="margin:0 0 8px">
      <label class="erp-inline">От <input type="month" id="inva-from" value="${fromDef}" /></label>
      <label class="erp-inline">До <input type="month" id="inva-to" value="${toDef}" /></label>
      <button class="btn btn-small btn-primary" id="inva-go">📊 Анализирай</button>
    </div>
    <div id="inva-out" style="max-height:62vh;overflow:auto"><p class="hint">Избери периода и натисни „📊 Анализирай" — таблиците излизат веднага, а Claude пише коментара отгоре. Проформите и анулираните не влизат; кредитните са с минус.</p></div>
    <div class="erp-dialog-actions"><button class="btn" id="inva-close">Затвори</button></div>`);
  try { wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide"); } catch (e) {}
  wrap.querySelector("#inva-close").addEventListener("click", close);
  wrap.querySelector("#inva-go").addEventListener("click", () => {
    const from = wrap.querySelector("#inva-from").value || fromDef;
    const to = wrap.querySelector("#inva-to").value || toDef;
    const d = invaBuild(from, to);
    const out = wrap.querySelector("#inva-out");
    out.innerHTML = d.count ? invaRender(d) : `<p class="report-empty">Няма издадени фактури в периода ${escapeHtml(from)} – ${escapeHtml(to)}.</p>`;
    if (d.count) invaAiComment(d, out.querySelector("#inva-ai"));
  });
}
