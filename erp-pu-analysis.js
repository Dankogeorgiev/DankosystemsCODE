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
  return { from, to, count: rows.length, total, byType, byVendor, byMonth, metals };
}

function puaRender(d) {
  const typeRows = [...d.byType.entries()].sort((a, b) => b[1].sum - a[1].sum);
  const vendorRows = [...d.byVendor.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 10);
  const monthRows = [...d.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const kindRows = [...d.metals.byKind.entries()].sort((a, b) => b[1].eur - a[1].eur);
  const mm = [...d.metals.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return `
    <p style="margin:6px 0"><b>${d.count}</b> документа за периода · общо <b>${puaF2(d.total)} EUR</b> без ДДС</p>
    <div id="pua-ai" style="margin:8px 0"></div>
    <h4 class="erp-group-head">По вид разход</h4>
    <table class="report-table erp-table"><thead><tr><th>Вид</th><th class="num">Сума (EUR)</th><th class="num">Дял</th><th class="num">Фактури</th></tr></thead>
      <tbody>${typeRows.map(([k, x]) => `<tr><td><b>${escapeHtml(k)}</b></td><td class="num">${puaF2(x.sum)}</td><td class="num">${d.total ? Math.round(x.sum / d.total * 100) : 0}%</td><td class="num">${x.n}</td></tr>`).join("")}</tbody></table>
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
  return `Период: ${d.from} до ${d.to}. Общо покупки: ${Math.round(d.total)} EUR без ДДС, ${d.count} документа.
По вид: ${t}.
Метали общо: ${Math.round(d.metals.kg)} кг за ${Math.round(d.metals.eur)} EUR (средно ${d.metals.kg ? (d.metals.eur / d.metals.kg).toFixed(2) : "?"} €/кг). По подвид: ${mk}.
Метали по месец (кг @ €/кг): ${mm}.
Топ доставчици: ${v}.
Общо по месец: ${m}.`;
}

async function puaAiComment(d, box) {
  box.innerHTML = `<div class="erp-loading">🤖 Claude анализира разходите…</div>`;
  try {
    const cfg = window.DANKO_CONFIG || {};
    if (!cfg.SUPABASE_URL) throw new Error("Няма връзка с облака.");
    let token = cfg.SUPABASE_ANON_KEY;
    try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
    const system = `Ти си финансовият анализатор на „Данко Системс" (металообработваща фирма, Пловдив). Получаваш обобщение на ПОКУПКИТЕ (разходите) за период. Дай кратък, конкретен коментар НА БЪЛГАРСКИ (10-15 изречения, с булети):
1) Най-големите пера и дяловете им; 2) Движението по месеци — расте/пада и къде; 3) Металите: количества и ДВИЖЕНИЕТО НА ЦЕНАТА €/кг по месеци (поскъпване/поевтиняване, с числа); 4) Аномалии и съмнителни скокове; 5) 2-3 практични препоръки (къде да се натисне за цена, какво да се следи). Пиши стегнато, с числата от данните. Без общи приказки.`;
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
      body: JSON.stringify({ system, messages: [{ role: "user", content: puaSummaryText(d) }], max_tokens: 1600 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || ("HTTP " + res.status));
    box.innerHTML = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:12px 14px;white-space:pre-wrap;font-size:13.5px;line-height:1.55"><b>🤖 Коментар на Claude</b>\n\n${escapeHtml(j.text || "(празен отговор)")}</div>`;
  } catch (e) {
    box.innerHTML = `<div style="background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px 12px">⚠ Коментарът не дойде: ${escapeHtml(e.message || String(e))}<br><span style="font-size:12px">Таблиците долу са пълни и без него. Ако Edge функцията „assistant" не е качена — виж ASSISTANT-SETUP.md.</span></div>`;
  }
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
