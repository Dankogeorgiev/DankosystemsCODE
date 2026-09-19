/* Данко Системс — ЕРП екран „Разбивка на нуждите".
   Продукт × бройка → сумарни суровини (bom_requirements), сверени с наличности.
   Дава сигнала „пусни за поръчка" при недостиг. */

let erpReqProdId = null;
let erpReqQty = 1;
let erpReqRows = null;   // резултат от bom_requirements
let erpReqBusy = false;
let erpReqQuery = "";    // търсене по продукт

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
    <div id="erp-req-result">${erpReqRows ? erpReqTable(erpReqRows) : `<p class="hint">Избери продукт и бройка, за да видиш нужните суровини и недостига спрямо склада.</p>`}</div>`;

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
  document.getElementById("erp-req-result").innerHTML = erpReqTable(erpReqRows);
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
