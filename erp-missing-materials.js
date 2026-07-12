/* Данко Системс — ЕРП „Липсващи материали по заявки".
   Събира РЕАЛНАТА консумация на материали от заявките, ПУСНАТИ в производство
   (движения stock_movements с ref="order:…", изписани при пускането), сравнява с
   текущата наличност и показва кои материали са отишли на минус (липсват) и кои
   заявки ги ползват. НЕ пресмята наново рецептата — ползва вече изписаното, за да
   няма двойно броене. „Налично" е текущата наличност (отразява ВСИЧКИ движения).
   Прави ПЪЛНО презареждане (erpLoadAll) при всяко влизане/обновяване, за да е
   свежа наличността. Ползва erpView/ERP.matById/erpNum/escapeHtml/erpSelectAll от
   другите ЕРП файлове; openMaterialsPlan от loading-plan.js. */

// Тегли САМО движенията от производство (ref започва с "order:") — филтрира на
// сървъра, за да не се сваля цялата таблица движения.
async function mmLoadOrderMoves() {
  const PAGE = 1000; let from = 0, out = [];
  for (;;) {
    const { data, error } = await sb.from("stock_movements").select("material_id,quantity,ref")
      .like("ref", "order:%").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return { data: out, error: null };
}

async function erpRenderMissingMaterials() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Проверявам материалите за пуснатите заявки…</p>`;
  // Пълно презареждане (не erpEnsureLoaded), за да е СВЕЖА наличността — иначе
  // „Налично"/„Липсва" се смятат от остарял кеш (напр. след ново пускане).
  try { await erpLoadAll(); }
  catch (e) { v.innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }

  // 1) Движения от производство: ref започва с "order:" (изписване при пускане).
  const mv = await mmLoadOrderMoves();
  if (mv.error) { v.innerHTML = `<p class="erp-warn">Не мога да заредя движенията: ${escapeHtml(mv.error.message)}</p>`; return; }
  const prod = mv.data || [];

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
    const isStock = sid.indexOf("stock-") === 0;
    if (!l) return isStock ? "За склад" : "заявка (без №)";
    return (l.no ? "№" + l.no : (isStock ? "За склад" : "заявка (без №)")) + (l.client ? " · " + l.client : "");
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
      <span class="erp-count">${!list.length ? "няма пуснати заявки" : short.length ? `<span class="erp-warn">${short.length} липсващи материала</span>` : "няма липси ✅"}${low.length ? ` · ${low.length} под минимум` : ""}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mm-refresh">↻ Обнови</button>
      ${typeof openMaterialsPlan === "function" ? `<button class="btn btn-small btn-primary" id="mm-plan" title="Отвори План материали, за да поръчаш липсващото от доставчик">📦 План материали</button>` : ""}
    </div>
    <p class="hint">Колоната <b>„Изписано за пуснатите"</b> е реалната консумация от заявките, ПУСНАТИ в производство (не се пресмята наново рецептата — няма двойно броене). <b>„Налично"</b> е текущата наличност в склада (тя отразява <i>всички</i> движения — и продажби/корекции), а <b>„Липсва"</b> = колко е на минус сега. Детайл, за който липсва материал, <b>все пак тръгва по цеховете</b> — складът просто отива на минус, затова тук виждаш дефицита. При съмнение защо е на минус — виж „Материали (склад)".</p>
    ${!list.length ? `<p class="report-empty">Още няма пуснати в производство заявки (няма изписани материали за проверка).</p>` : `
      ${short.length ? `
        <h4 class="erp-group-head">⚠ Липсващи (наличността е на минус)</h4>
        <table class="report-table erp-table">
          <thead><tr><th>Материал</th><th>Мярка</th><th class="num">Изписано за пуснатите</th><th class="num">Налично</th><th class="num">Липсва</th><th>Заявки</th></tr></thead>
          <tbody>${short.map(shortRow).join("")}</tbody>
        </table>`
        : `<p class="report-empty">✅ Нито един материал, ползван от пуснатите заявки, не е на минус.</p>`}
      ${low.length ? `
        <h4 class="erp-group-head">🟡 Под минимум (стигат засега, но да се поръчат)</h4>
        <table class="report-table erp-table">
          <thead><tr><th>Материал</th><th>Мярка</th><th class="num">Изписано за пуснатите</th><th class="num">Налично</th><th class="num">Минимум</th><th>Заявки</th></tr></thead>
          <tbody>${low.map(lowRow).join("")}</tbody>
        </table>` : ""}
    `}`;

  const rb = document.getElementById("mm-refresh"); if (rb) rb.addEventListener("click", erpRenderMissingMaterials);
  const pb = document.getElementById("mm-plan"); if (pb) pb.addEventListener("click", () => { if (typeof openMaterialsPlan === "function") openMaterialsPlan(); });
}
