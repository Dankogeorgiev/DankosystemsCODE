/* Данко Системс — ЕРП „Липсващи материали по заявки".
   Събира РЕАЛНАТА консумация на материали от заявките, ПУСНАТИ в производство
   (движения stock_movements с ref="order:…", изписани при пускането), сравнява с
   текущата наличност и показва кои материали са отишли на минус (липсват) и кои
   заявки ги ползват. НЕ пресмята наново рецептата — ползва вече изписаното, за да
   няма двойно броене. Ползва erpEnsureLoaded/erpView/erpSelectAll/ERP.matById/
   erpNum/escapeHtml от другите ЕРП файлове; openMaterialsPlan от loading-plan.js. */

async function erpRenderMissingMaterials() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Проверявам материалите за пуснатите заявки…</p>`;
  try { await erpEnsureLoaded(); }
  catch (e) { v.innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }

  // 1) Движения от производство: ref започва с "order:" (изписване при пускане).
  const mv = await erpSelectAll("stock_movements", "material_id,quantity,ref");
  if (mv.error) { v.innerHTML = `<p class="erp-warn">Не мога да заредя движенията: ${escapeHtml(mv.error.message)}</p>`; return; }
  const prod = (mv.data || []).filter(m => typeof m.ref === "string" && m.ref.indexOf("order:") === 0);

  // 2) Етикети на заявките (№ · клиент) от поточните задачи (source.orders) и клиентските заявки.
  const label = {};
  const tk = await erpSelectAll("tasks", "data", "data->source->>flow", "true");
  (tk.data || []).forEach(r => {
    const orders = (r.data && r.data.source && r.data.source.orders) || [];
    orders.forEach(o => { const sid = String(o.id); if (!label[sid]) label[sid] = { no: o.no || "", client: o.client || "" }; });
  });
  try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}
  ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(o => { const sid = String(o.id); if (!label[sid]) label[sid] = { no: o.ourNo || "", client: o.clientName || "" }; });
  const orderText = sid => {
    const l = label[sid];
    if (!l) return sid.indexOf("stock-") === 0 ? "За склад" : ("№" + sid);
    return (l.no ? "№" + l.no : (sid.indexOf("stock-") === 0 ? "За склад" : sid)) + (l.client ? " · " + l.client : "");
  };

  // 3) Агрегиране: консумация по материал + кои заявки го ползват.
  const consumed = {}, ordersByMat = {};
  prod.forEach(m => {
    const mid = m.material_id; if (!mid) return;
    const q = Math.max(0, -(Number(m.quantity) || 0));   // изписване е с отрицателен знак
    const sid = String(m.ref).slice(6);                   // след "order:"
    consumed[mid] = (consumed[mid] || 0) + q;
    (ordersByMat[mid] = ordersByMat[mid] || new Set()).add(sid);
  });

  const list = Object.keys(consumed).map(mid => {
    const m = ERP.matById[Number(mid)] || ERP.matById[mid] || {};
    const stock = Number(m.stock) || 0, min = Number(m.min_stock) || 0;
    return {
      mid, code: m.code || "", name: m.name || "", unit: m.unit || "",
      stock, min, need: consumed[mid], missing: Math.max(0, -stock), orders: [...(ordersByMat[mid] || [])],
    };
  });
  const short = list.filter(r => r.missing > 0).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, "bg"));
  const low = list.filter(r => r.missing <= 0 && r.min > 0 && r.stock < r.min).sort((a, b) => (a.stock - a.min) - (b.stock - b.min));

  const ordersCell = r => r.orders.map(orderText).map(t => `<span class="mm-order">${escapeHtml(t)}</span>`).join(" ") || "—";
  const shortRow = r => `
    <tr class="erp-below">
      <td data-label="Материал"><b>${escapeHtml(r.code)}</b> ${escapeHtml(r.name)}</td>
      <td data-label="Мярка">${escapeHtml(r.unit)}</td>
      <td class="num" data-label="Изписано за пуснатите">${erpNum(r.need)}</td>
      <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
      <td class="num" data-label="Липсва"><span class="erp-warn">${erpNum(r.missing)} ⚠</span></td>
      <td data-label="Заявки">${ordersCell(r)}</td>
    </tr>`;
  const lowRow = r => `
    <tr>
      <td data-label="Материал"><b>${escapeHtml(r.code)}</b> ${escapeHtml(r.name)}</td>
      <td data-label="Мярка">${escapeHtml(r.unit)}</td>
      <td class="num" data-label="Изписано за пуснатите">${erpNum(r.need)}</td>
      <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
      <td class="num" data-label="Минимум">${erpNum(r.min)}</td>
      <td data-label="Заявки">${ordersCell(r)}</td>
    </tr>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${short.length ? `<span class="erp-warn">${short.length} липсващи материала</span>` : "Няма липси ✅"}${low.length ? ` · ${low.length} под минимум` : ""}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mm-refresh">↻ Обнови</button>
      ${typeof openMaterialsPlan === "function" ? `<button class="btn btn-small btn-primary" id="mm-plan" title="Отвори План материали, за да поръчаш липсващото от доставчик">📦 План материали</button>` : ""}
    </div>
    <p class="hint">Показва материалите, реално <b>изписани при пускането в производство</b> на заявките. „Липсва" = наличността е отишла на минус, т.е. не е стигнала за пуснатото. Не се пресмята наново рецептата (няма двойно броене). Детайл, за който липсва материал, <b>все пак тръгва по цеховете</b> — складът просто отива на минус, затова тук виждаш дефицита.</p>
    ${short.length ? `
      <h4 class="erp-group-head">⚠ Липсващи (наличността е на минус)</h4>
      <table class="report-table erp-table">
        <thead><tr><th>Материал</th><th>Мярка</th><th class="num">Изписано за пуснатите</th><th class="num">Налично</th><th class="num">Липсва</th><th>Заявки</th></tr></thead>
        <tbody>${short.map(shortRow).join("")}</tbody>
      </table>`
      : `<p class="report-empty">✅ Материалите стигат за всички пуснати заявки — нищо не е на минус.</p>`}
    ${low.length ? `
      <h4 class="erp-group-head">🟡 Под минимум (стигат засега, но да се поръчат)</h4>
      <table class="report-table erp-table">
        <thead><tr><th>Материал</th><th>Мярка</th><th class="num">Изписано за пуснатите</th><th class="num">Налично</th><th class="num">Минимум</th><th>Заявки</th></tr></thead>
        <tbody>${low.map(lowRow).join("")}</tbody>
      </table>` : ""}
    ${(!short.length && !low.length && !list.length) ? `<p class="hint">Още няма пуснати в производство заявки (няма изписани материали).</p>` : ""}`;

  const rb = document.getElementById("mm-refresh"); if (rb) rb.addEventListener("click", erpRenderMissingMaterials);
  const pb = document.getElementById("mm-plan"); if (pb) pb.addEventListener("click", () => { if (typeof openMaterialsPlan === "function") openMaterialsPlan(); });
}
