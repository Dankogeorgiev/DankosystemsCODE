/* Данко Системс — ЕРП екран „Разбивка на нуждите".
   Два начина (по Данко, 26.10.2026):
   1) Продукт × бройка → сумарни суровини (bom_requirements), сверени с наличности.
   2) 📋 Заявка от клиенти → разбивка за ВСИЧКИТЕ ѝ продуктови редове наведнъж
      (същата рецептурна рекурсия като „Необходими материали" в самата заявка).
   Дава сигнала „пусни за поръчка" при недостиг. */

let erpReqProdId = null;
let erpReqQty = 1;
let erpReqRows = null;   // резултат от bom_requirements
let erpReqBusy = false;
let erpReqQuery = "";    // търсене по продукт
let erpReqOrderId = null;   // избрана заявка от клиенти
let erpReqOrderQ = "";      // търсене по заявка
let erpReqHead = "";        // заглавие над таблицата (за коя заявка е сметнато)

// Опции за падащото меню (само продукти с рецепта), филтрирани по търсене.
function erpReqOptions(q) {
  q = (q || "").toLowerCase().trim();
  return ERP.products
    .filter(p => (ERP.linesByProduct[p.id] || []).length > 0)   // само с рецепта
    .filter(p => !q || ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"))
    .map(p => `<option value="${p.id}" ${p.id === erpReqProdId ? "selected" : ""}>${escapeHtml((p.code ? p.code + " · " : "") + p.name)}</option>`)
    .join("");
}

// Опции за падащото меню на заявките: само с продуктови редове; завършените
// се крият (освен при търсене). Най-новите номера най-отгоре.
function erpReqOrderOptions(q) {
  q = (q || "").toLowerCase().trim();
  const S = x => String(x == null ? "" : x);
  return ((typeof erpCOList !== "undefined" && erpCOList) || [])
    .filter(o => (o.lines || []).some(l => l.productId))
    .filter(o => q ? `${o.ourNo || ""} ${o.clientName || ""} ${o.status || ""}`.toLowerCase().includes(q) : (o.status || "нова") !== "завършена")
    .sort((a, b) => S(b.ourNo).localeCompare(S(a.ourNo), "bg", { numeric: true }))
    .slice(0, 300)
    .map(o => `<option value="${o.id}" ${String(o.id) === String(erpReqOrderId) ? "selected" : ""}>${escapeHtml(`№${o.ourNo || "—"} · ${o.clientName || "—"} · ${o.status || "нова"}`)}</option>`)
    .join("");
}

function erpRenderRequirements() {
  const v = erpView();
  v.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="erp-req-q" placeholder="🔎 търси продукт по код или име…" value="${escapeAttr(erpReqQuery)}" autocomplete="off" style="min-width:230px" />
      <label class="erp-inline">Продукт
        <select id="erp-req-prod"><option value="">— избери продукт —</option>${erpReqOptions(erpReqQuery)}</select>
      </label>
      <label class="erp-inline">Бройка
        <input type="number" id="erp-req-qty" min="1" step="any" value="${erpReqQty}" style="width:90px" />
      </label>
      <button class="btn btn-small btn-primary" id="erp-req-go">Изчисли</button>
    </div>
    <div class="erp-toolbar" title="Разбивката за ВСИЧКИ продуктови редове на заявката наведнъж">
      <input type="search" id="erp-req-oq" placeholder="🔎 търси заявка (№ или клиент)…" value="${escapeAttr(erpReqOrderQ)}" autocomplete="off" style="min-width:230px" />
      <label class="erp-inline">📋 Заявка от клиенти
        <select id="erp-req-order"><option value="">— избери заявка —</option>${erpReqOrderOptions(erpReqOrderQ)}</select>
      </label>
      <button class="btn btn-small btn-primary" id="erp-req-ogo">Изчисли по заявката</button>
    </div>
    <div id="erp-req-result">${erpReqRows ? (erpReqHead + erpReqTable(erpReqRows)) : `<p class="hint">Избери продукт и бройка — или цяла заявка от клиенти — за да видиш нужните суровини и недостига спрямо склада.</p>`}</div>`;

  const q = document.getElementById("erp-req-q");
  const sel = document.getElementById("erp-req-prod");
  q.addEventListener("input", e => {
    erpReqQuery = e.target.value;
    sel.innerHTML = `<option value="">— избери продукт —</option>` + erpReqOptions(erpReqQuery);
    // ако има точно едно съвпадение — избираме го автоматично
    const opts = [...sel.options].filter(o => o.value);
    if (opts.length === 1) { sel.value = opts[0].value; erpReqProdId = Number(opts[0].value) || null; }
  });
  sel.addEventListener("change", e => { erpReqProdId = Number(e.target.value) || null; });
  document.getElementById("erp-req-qty").addEventListener("input", e => { erpReqQty = erpToNum(e.target.value) || 1; });
  document.getElementById("erp-req-go").addEventListener("click", erpComputeRequirements);

  // Заявките: зареждаме ги тихо при първото влизане и пълним менюто.
  const oq = document.getElementById("erp-req-oq");
  const osel = document.getElementById("erp-req-order");
  const refillOrders = () => { osel.innerHTML = `<option value="">— избери заявка —</option>` + erpReqOrderOptions(erpReqOrderQ); };
  if (typeof erpCOList === "undefined" || !erpCOList) {
    osel.innerHTML = `<option value="">зареждам заявките…</option>`;
    (async () => {
      try { if (typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
      refillOrders();
    })();
  }
  oq.addEventListener("input", e => {
    erpReqOrderQ = e.target.value;
    refillOrders();
    const opts = [...osel.options].filter(o => o.value);
    if (opts.length === 1) { osel.value = opts[0].value; erpReqOrderId = opts[0].value; }
  });
  osel.addEventListener("change", e => { erpReqOrderId = e.target.value || null; });
  document.getElementById("erp-req-ogo").addEventListener("click", erpComputeOrderRequirements);
}

async function erpComputeRequirements() {
  if (erpReqBusy) return;
  const sel = document.getElementById("erp-req-prod");
  erpReqProdId = Number(sel.value) || null;
  erpReqQty = erpToNum(document.getElementById("erp-req-qty").value) || 1;
  if (!erpReqProdId) { document.getElementById("erp-req-result").innerHTML = `<p class="erp-warn">Първо избери продукт.</p>`; return; }

  erpReqBusy = true;
  document.getElementById("erp-req-result").innerHTML = `<p class="erp-loading">Изчисляване…</p>`;
  const { data, error } = await sb.rpc("bom_requirements", { p_id: erpReqProdId, p_qty: erpReqQty });
  erpReqBusy = false;
  if (error) { document.getElementById("erp-req-result").innerHTML = `<p class="erp-warn">${escapeHtml(error.message)}</p>`; return; }
  erpReqRows = data || [];
  const p = (ERP.prodById || {})[erpReqProdId] || {};
  erpReqHead = `<p style="margin:6px 0"><b>${escapeHtml((p.code ? p.code + " · " : "") + (p.name || "продукт"))}</b> × ${erpNum(erpReqQty)}</p>`;
  document.getElementById("erp-req-result").innerHTML = erpReqHead + erpReqTable(erpReqRows);
}

/* ---------- 📋 Разбивка по цяла заявка от клиенти ----------
   Същата рецептурна рекурсия като „Необходими материали" в прозореца на
   заявката (erpCOExplode): продукт → подвъзли → материали, умножено по
   количествата от редовете. Редове без продукт (свободен текст) и продукти
   без рецепта се изброяват отделно, за да не се подведе никой. */
async function erpComputeOrderRequirements() {
  if (erpReqBusy) return;
  const osel = document.getElementById("erp-req-order");
  erpReqOrderId = (osel && osel.value) || null;
  const out = document.getElementById("erp-req-result");
  if (!erpReqOrderId) { out.innerHTML = `<p class="erp-warn">Първо избери заявка от списъка (търси по № или клиент).</p>`; return; }
  erpReqBusy = true;
  out.innerHTML = `<p class="erp-loading">Изчисляване по заявката…</p>`;
  try {
    if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders();
    const o = ((typeof erpCOList !== "undefined" && erpCOList) || []).find(x => String(x.id) === String(erpReqOrderId));
    if (!o) { out.innerHTML = `<p class="erp-warn">Заявката не се намери — опресни екрана.</p>`; return; }
    // Смята се за ОСТАТЪКА: поръчано − доставено (l.delivered, както в процента
    // на заявката). Изцяло доставените редове не влизат, но се изброяват.
    const left = l => { const q = erpToNum(l.qty) || 0; return Math.max(0, q - Math.min(Math.max(0, Number(l.delivered) || 0), q)); };
    const lines = (o.lines || []).filter(l => l.productId && left(l) > 0);
    const doneLines = (o.lines || []).filter(l => (l.productId || l.materialId) && (erpToNum(l.qty) || 0) > 0 && left(l) <= 0);
    // Редове, които са директно МАТЕРИАЛ (без продукт) — влизат в нуждата 1:1.
    const matLines = (o.lines || []).filter(l => !l.productId && l.materialId && left(l) > 0);
    const skipped = (o.lines || []).filter(l => !l.productId && !l.materialId && String(l.name || l.code || "").trim());
    const acc = {};
    matLines.forEach(l => { acc[l.materialId] = (acc[l.materialId] || 0) + left(l); });
    const rec = (pid, mult, anc) => {
      (ERP.linesByProduct[pid] || []).forEach(l => {
        if (l.material_id) acc[l.material_id] = (acc[l.material_id] || 0) + mult * (Number(l.quantity) || 1);
        else if (l.child_product_id && !anc.has(l.child_product_id)) rec(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]));
      });
    };
    const noRecipe = [];
    lines.forEach(l => {
      if (!(ERP.linesByProduct[l.productId] || []).length) { noRecipe.push(l); return; }
      rec(l.productId, left(l), new Set([l.productId]));
    });
    erpReqRows = Object.entries(acc).map(([mid, qty]) => {
      const m = ERP.matById[mid] || ERP.matById[Number(mid)] || {};
      return { material_id: Number(mid), name: (m.code ? m.code + " · " : "") + (m.name || ("материал № " + mid)), unit: m.unit || "", required: qty };
    });
    const baseName = l => { const p = (ERP.prodById || {})[l.productId] || {}; return `${p.code || l.code || ""} ${p.name || l.name || ""}`.trim(); };
    const prodLabel = l => {
      const q = erpToNum(l.qty) || 0, lf = left(l);
      return `${baseName(l)} × ${erpNum(q)}` + (lf < q ? ` (доставени ${erpNum(q - lf)} → смятаме ${erpNum(lf)})` : "");
    };
    erpReqHead = `
      <p style="margin:6px 0">📋 Заявка <b>№${escapeHtml(o.ourNo || "—")}</b> · ${escapeHtml(o.clientName || "—")} · ${escapeHtml(o.status || "нова")}</p>
      <p class="hint" style="margin:0 0 4px">Смята се само за <b>остатъка</b> (поръчано − доставено). Изделия: ${lines.map(l => `<span class="mm-order">${escapeHtml(prodLabel(l))}</span>`).join(" ") || "—"}</p>
      ${doneLines.length ? `<p class="hint" style="margin:4px 0">✅ Изцяло доставени (не влизат): ${doneLines.map(l => escapeHtml(`${baseName(l) || String(l.name || l.code || "")} × ${erpNum(erpToNum(l.qty) || 0)}`)).join(" · ")}</p>` : ""}
      ${noRecipe.length ? `<p class="erp-warn" style="margin:4px 0">⚠ Без рецепта (не влизат в сметката): ${noRecipe.map(l => escapeHtml(prodLabel(l))).join(" · ")}</p>` : ""}
      ${skipped.length ? `<p class="hint" style="margin:4px 0">ℹ Редове без продукт от номенклатурата (пропуснати): ${skipped.map(l => escapeHtml(String(l.name || l.code || ""))).join(" · ")}</p>` : ""}`;
    out.innerHTML = erpReqHead + (erpReqRows.length
      ? erpReqTable(erpReqRows)
      : `<p class="report-empty">Нищо за смятане — заявката няма продуктови редове с рецепти.</p>`);
  } finally { erpReqBusy = false; }
}

function erpReqTable(rows) {
  if (!rows.length) return `<p class="report-empty">Няма суровини за този продукт (възможно е да няма рецепта).</p>`;
  const enriched = rows.map(r => {
    const m = ERP.matById[r.material_id] || {};
    const available = Number(m.stock) || 0;
    const required = Number(r.required) || 0;
    const shortage = Math.max(0, required - available);
    return { ...r, available, required, shortage, unit: r.unit || m.unit || "" };
  }).sort((a, b) => b.shortage - a.shortage || (a.name || "").localeCompare(b.name || "", "bg"));

  const shortCount = enriched.filter(r => r.shortage > 0).length;

  return `
    <div class="erp-toolbar">
      <span class="erp-count">${enriched.length} суровини${shortCount ? ` · <span class="erp-warn">${shortCount} за поръчка</span>` : ""}</span>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Суровина</th><th>Мярка</th><th class="num">Нужно</th><th class="num">Налично</th><th class="num">Недостиг</th></tr></thead>
      <tbody>${enriched.map(r => `
        <tr class="${r.shortage > 0 ? "erp-below" : ""}">
          <td data-label="Суровина">${escapeHtml(r.name || "")}</td>
          <td data-label="Мярка">${escapeHtml(r.unit)}</td>
          <td class="num" data-label="Нужно">${erpNum(r.required)}</td>
          <td class="num" data-label="Налично">${erpNum(r.available)}</td>
          <td class="num" data-label="Недостиг">${r.shortage > 0 ? `<span class="erp-warn">${erpNum(r.shortage)} ⚠</span>` : "0"}</td>
        </tr>`).join("")}</tbody>
    </table>
    ${shortCount ? `<p class="hint">Редовете с недостиг са за поръчка към доставчик.</p>` : `<p class="hint">Складът покрива цялото производство. ✅</p>`}`;
}
