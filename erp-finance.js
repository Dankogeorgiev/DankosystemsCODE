/* Данко Системс — ЕРП „Финансов модул".
   Първи екран: „Маржин по поръчка" — реалният маржин за всяка заявка от клиент:
   Приходи (продажни цени по редовете) − Себестойност (по рецепта: материали
   по средни цени + операции) = Маржин (лв/€) и Маржин %.
   Себестойността идва от ERP.costById (v_product_cost). Ползва erpCOList
   (заявки), erpEnsureLoaded/erpLoadCustomerOrders, erpEur/erpNum/erpToNum. */

let erpFinFrom = "", erpFinTo = "";

function erpFinOrderCalc(o) {
  let rev = 0, cost = 0, missing = 0;
  const lines = (o.lines || []).map(l => {
    const qty = erpToNum(l.qty) || 0;
    const price = erpToNum(l.unitPrice) || 0;
    const unitCost = Number(ERP.costById[l.productId]) || 0;
    const lineRev = qty * price, lineCost = qty * unitCost;
    if (price <= 0) missing++;
    rev += lineRev; cost += lineCost;
    return { code: l.code || "", name: l.name || "", qty, price, unitCost, rev: lineRev, cost: lineCost, margin: lineRev - lineCost };
  });
  const margin = rev - cost;
  const pct = rev > 0 ? margin / rev * 100 : 0;
  return { rev, cost, margin, pct, missing, lines };
}

function erpFinPctCls(pct, rev) {
  if (rev <= 0) return "fin-na";
  if (pct < 0) return "fin-neg";
  if (pct < 10) return "fin-low";
  if (pct < 25) return "fin-mid";
  return "fin-good";
}

async function erpRenderFinance() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpEnsureLoaded(); await erpLoadCustomerOrders(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя финансовите данни</h3><p>${escapeHtml(e.message || String(e))}</p></div>`;
    return;
  }
  let list = (erpCOList || []).slice();
  if (erpFinFrom) list = list.filter(o => (o.date || "") >= erpFinFrom);
  if (erpFinTo) list = list.filter(o => (o.date || "") <= erpFinTo);

  const calc = {}; list.forEach(o => calc[o.id] = erpFinOrderCalc(o));
  list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const T = list.reduce((a, o) => { const c = calc[o.id]; a.rev += c.rev; a.cost += c.cost; a.margin += c.margin; return a; }, { rev: 0, cost: 0, margin: 0 });
  const Tpct = T.rev > 0 ? T.margin / T.rev * 100 : 0;

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">Маржин по поръчка</span>
      <label class="erp-inline">От <input type="date" id="fin-from" value="${escapeAttr(erpFinFrom)}" /></label>
      <label class="erp-inline">До <input type="date" id="fin-to" value="${escapeAttr(erpFinTo)}" /></label>
      <span class="spacer"></span>
      <button class="btn btn-small" id="fin-csv">⤓ Excel</button>
    </div>
    <div class="fin-cards">
      <div class="fin-card"><div class="fin-card-l">Приходи</div><div class="fin-card-v">${erpEur(T.rev)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Себестойност</div><div class="fin-card-v">${erpEur(T.cost)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Маржин</div><div class="fin-card-v ${erpFinPctCls(Tpct, T.rev)}">${erpEur(T.margin)}</div></div>
      <div class="fin-card"><div class="fin-card-l">Маржин %</div><div class="fin-card-v ${erpFinPctCls(Tpct, T.rev)}">${T.rev > 0 ? erpNum(Tpct) + " %" : "—"}</div></div>
    </div>
    <table class="report-table erp-table fin-table">
      <thead><tr><th>Наш №</th><th>Клиент</th><th>Дата</th><th class="num">Приходи</th><th class="num">Себестойност</th><th class="num">Маржин</th><th class="num">Маржин %</th><th></th></tr></thead>
      <tbody>
        ${list.map(o => { const c = calc[o.id]; return `
          <tr class="fin-row erp-clickable" data-id="${escapeAttr(o.id)}">
            <td data-label="Наш №"><b>${escapeHtml(o.ourNo || "—")}</b></td>
            <td data-label="Клиент">${escapeHtml(o.clientName || "")}</td>
            <td data-label="Дата">${escapeHtml(o.date || "")}</td>
            <td class="num" data-label="Приходи">${erpEur(c.rev)}${c.missing ? ` <span class="fin-warn" title="${c.missing} реда без цена">⚠</span>` : ""}</td>
            <td class="num" data-label="Себестойност">${erpEur(c.cost)}</td>
            <td class="num ${erpFinPctCls(c.pct, c.rev)}" data-label="Маржин">${erpEur(c.margin)}</td>
            <td class="num ${erpFinPctCls(c.pct, c.rev)}" data-label="Маржин %">${c.rev > 0 ? erpNum(c.pct) + " %" : "—"}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-exp="${escapeAttr(o.id)}">▾</button></td>
          </tr>
          <tr class="fin-detail" id="fin-d-${escapeAttr(o.id)}" hidden><td colspan="8">${erpFinDetailHtml(c)}</td></tr>`; }).join("") ||
          `<tr><td colspan="8" class="report-empty">Няма заявки за периода.</td></tr>`}
      </tbody>
    </table>
    <p class="hint">Себестойността е по рецепта (материали по средни цени + операции). Ако операциите нямат зададена цена, маржинът излиза завишен (липсва трудът). „⚠" = ред без продажна цена. Изчислено „в реално време" от заявките.</p>`;

  document.getElementById("fin-from").addEventListener("change", e => { erpFinFrom = e.target.value; erpRenderFinance(); });
  document.getElementById("fin-to").addEventListener("change", e => { erpFinTo = e.target.value; erpRenderFinance(); });
  document.getElementById("fin-csv").addEventListener("click", () => erpFinExportCsv(list, calc));
  v.querySelectorAll("[data-exp]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    const d = document.getElementById("fin-d-" + b.dataset.exp);
    if (d) { d.hidden = !d.hidden; b.textContent = d.hidden ? "▾" : "▴"; }
  }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => {
    const d = document.getElementById("fin-d-" + tr.dataset.id);
    const b = tr.querySelector("[data-exp]");
    if (d) { d.hidden = !d.hidden; if (b) b.textContent = d.hidden ? "▾" : "▴"; }
  }));
}

function erpFinDetailHtml(c) {
  if (!c.lines.length) return `<span class="muted">Няма редове.</span>`;
  return `<table class="fin-sub"><thead><tr><th>Код</th><th>Продукт</th><th class="num">Бр.</th><th class="num">Ед. цена</th><th class="num">Ед. себест.</th><th class="num">Приход</th><th class="num">Себест.</th><th class="num">Маржин</th></tr></thead>
    <tbody>${c.lines.map(l => `<tr>
      <td>${escapeHtml(l.code)}</td><td>${escapeHtml(l.name)}</td>
      <td class="num">${erpNum(l.qty)}</td>
      <td class="num">${l.price > 0 ? erpEur(l.price) : '<span class="fin-warn">няма</span>'}</td>
      <td class="num">${erpEur(l.unitCost)}</td>
      <td class="num">${erpEur(l.rev)}</td><td class="num">${erpEur(l.cost)}</td>
      <td class="num ${l.margin < 0 ? "fin-neg" : ""}">${erpEur(l.margin)}</td>
    </tr>`).join("")}</tbody></table>`;
}

function erpFinExportCsv(list, calc) {
  const esc = s => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;
  const n = x => String((Math.round((Number(x) || 0) * 100) / 100)).replace(".", ",");
  const lines = [["Наш №", "Клиент", "Дата", "Приходи", "Себестойност", "Маржин", "Маржин %"].map(esc).join(",")];
  list.forEach(o => { const c = calc[o.id]; lines.push([o.ourNo || "", o.clientName || "", o.date || "", n(c.rev), n(c.cost), n(c.margin), c.rev > 0 ? n(c.pct) : ""].map(esc).join(",")); });
  const T = list.reduce((a, o) => { const c = calc[o.id]; a.rev += c.rev; a.cost += c.cost; a.margin += c.margin; return a; }, { rev: 0, cost: 0, margin: 0 });
  lines.push(["ОБЩО", "", "", n(T.rev), n(T.cost), n(T.margin), T.rev > 0 ? n(T.margin / T.rev * 100) : ""].map(esc).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "marjin-po-poruchka.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
