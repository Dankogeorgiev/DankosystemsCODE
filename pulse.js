/* Данко Системс — „Пулс" (табло на собственика).
   Един екран с най-важното в момента: производство днес, заявки, закъснели,
   незавършено производство по цех, материали под минимум. Достъп само за
   PULSE_EMAILS (pulseAllowed). Ползва erpSelectAll/escapeHtml/erpNum от другите файлове. */

function pulseToday() { return new Date().toISOString().slice(0, 10); }

async function openPulse() {
  if (typeof pulseAllowed === "function" && !pulseAllowed()) { alert("Нямаш достъп до Пулс."); return; }
  const m = document.getElementById("pulse-modal");
  if (!m) return;
  m.hidden = false;
  await renderPulse();
}
function closePulse() { const m = document.getElementById("pulse-modal"); if (m) m.hidden = true; }

async function renderPulse() {
  const v = document.getElementById("pulse-view");
  if (!v) return;
  v.innerHTML = `<p class="erp-loading">Зареждане на пулса…</p>`;
  const today = pulseToday();
  let orders = [], tasks = [], lowMat = [], sales = [];
  try {
    const [co, tk, mat, sl] = await Promise.all([
      erpSelectAll("customer_orders", "data"),
      erpSelectAll("tasks", "data,done"),
      erpSelectAll("v_material_stock", "code,name,stock,min_stock,below_min", "below_min", true),
      erpSelectAll("sales", "data").catch(() => ({ data: [] })),
    ]);
    orders = (co.data || []).map(r => r.data || {});
    tasks = tk.data || [];
    lowMat = mat.data || [];
    sales = (sl && sl.data || []).map(r => r.data || {});
  } catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Грешка при зареждане</h3><p>${escapeHtml(e.message || String(e))}</p></div>`;
    return;
  }

  // Заявки
  const activeOrders = orders.filter(o => (o.status || "нова") !== "завършена");
  const inProd = activeOrders.filter(o => o.production || o.status === "в производство");
  const overdue = activeOrders.filter(o => o.deadline && o.deadline < today)
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));

  // Производство днес + незавършено (WIP) по цех
  let todayQty = 0, todayEntries = 0;
  const workersToday = new Set();
  const wipByWs = {};
  tasks.forEach(r => {
    const t = r.data || {};
    const isExtra = t.source && t.source.kind === "extra";
    (t.logs || []).forEach(l => {
      if (l.date === today) {
        todayQty += Number(l.qty) || 0; todayEntries++;
        if (l.worker) workersToday.add(l.worker);
      }
    });
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    const isDone = r.done || (qty > 0 && prod >= qty);
    if (!isDone && !isExtra && t.workshop) wipByWs[t.workshop] = (wipByWs[t.workshop] || 0) + 1;
  });
  const wipRows = Object.entries(wipByWs).sort((a, b) => b[1] - a[1]);
  const totalWip = wipRows.reduce((s, [, n]) => s + n, 0);

  // Пари: стойност на всички заявки + продажби за месеца (без ДДС), по валута.
  const num = v => (typeof erpToNum === "function") ? erpToNum(v) : (Number(v) || 0);
  const lineNet = arr => (arr || []).reduce((a, l) => a + num(l.qty) * num(l.unitPrice), 0);
  const money = (n, cur) => Math.round(n).toLocaleString("bg-BG") + " " + (cur === "BGN" ? "лв" : cur === "EUR" ? "€" : (cur || "€"));
  const ordersValue = orders.reduce((s, o) => s + lineNet(o.lines), 0);
  const month = today.slice(0, 7);
  const salesByCur = {};
  sales.forEach(s => {
    if (String(s.date || "").slice(0, 7) !== month) return;
    const cur = s.currency || "EUR";
    salesByCur[cur] = (salesByCur[cur] || 0) + lineNet(s.lines);
  });
  const salesMonthStr = Object.keys(salesByCur).length
    ? Object.entries(salesByCur).map(([c, n]) => money(n, c)).join(" · ")
    : "0 €";

  const card = (label, value, cls) => `<div class="pulse-card ${cls || ""}"><div class="pulse-val">${value}</div><div class="pulse-lbl">${label}</div></div>`;

  v.innerHTML = `
    <div class="pulse-cards">
      ${card("общо заявки (стойност)", money(ordersValue, "EUR"), "money")}
      ${card("продажби месец (без ДДС)", salesMonthStr, "money")}
      ${card("произведено днес (бр.)", erpNum(todayQty), "ok")}
      ${card("работници днес", workersToday.size, "")}
      ${card("активни заявки", activeOrders.length, "")}
      ${card("в производство", inProd.length, "info")}
      ${card("закъснели заявки", overdue.length, overdue.length ? "danger" : "")}
      ${card("незавършени задачи", totalWip, "")}
      ${card("материали под минимум", lowMat.length, lowMat.length ? "warn" : "")}
    </div>
    <div class="pulse-grid">
      <div class="pulse-panel">
        <h4>🏭 Незавършено производство по цех</h4>
        ${wipRows.length
          ? `<table class="report-table"><tbody>${wipRows.map(([w, n]) => `<tr><td>${escapeHtml(w)}</td><td class="num"><b>${n}</b> задачи</td></tr>`).join("")}</tbody></table>`
          : `<p class="erp-muted">Няма незавършени задачи.</p>`}
      </div>
      <div class="pulse-panel">
        <h4>⏰ Закъснели заявки (${overdue.length})</h4>
        ${overdue.length
          ? `<table class="report-table"><thead><tr><th>№</th><th>Клиент</th><th>Срок</th></tr></thead><tbody>${overdue.slice(0, 25).map(o => `<tr><td>${escapeHtml(o.ourNo || "—")}</td><td>${escapeHtml(o.clientName || "")}</td><td class="pulse-danger">${escapeHtml(o.deadline || "")}</td></tr>`).join("")}</tbody></table>${overdue.length > 25 ? `<p class="erp-muted">…и още ${overdue.length - 25}</p>` : ""}`
          : `<p class="erp-muted">Няма закъснели заявки. 🎉</p>`}
      </div>
      <div class="pulse-panel">
        <h4>🧱 Материали под минимум (${lowMat.length})</h4>
        ${lowMat.length
          ? `<table class="report-table"><thead><tr><th>Код</th><th>Материал</th><th class="num">Налично</th><th class="num">Мин.</th></tr></thead><tbody>${lowMat.slice(0, 40).map(m => `<tr><td>${escapeHtml(m.code || "")}</td><td>${escapeHtml(m.name || "")}</td><td class="num pulse-warn">${erpNum(m.stock)}</td><td class="num">${erpNum(m.min_stock)}</td></tr>`).join("")}</tbody></table>${lowMat.length > 40 ? `<p class="erp-muted">…и още ${lowMat.length - 40}</p>` : ""}`
          : `<p class="erp-muted">Всичко е над минимума. 👍</p>`}
      </div>
    </div>
    <p class="erp-muted pulse-ts">Днес: ${today} · ${todayEntries} записа · обновено ${new Date().toLocaleTimeString("bg-BG")}</p>`;
}

function pulseInit() {
  const btn = document.getElementById("btn-pulse");
  if (btn) btn.addEventListener("click", openPulse);
  const c = document.getElementById("pulse-close"); if (c) c.addEventListener("click", closePulse);
  const r = document.getElementById("pulse-refresh"); if (r) r.addEventListener("click", renderPulse);
}
document.addEventListener("DOMContentLoaded", pulseInit);
