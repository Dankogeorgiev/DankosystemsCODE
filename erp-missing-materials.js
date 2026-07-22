/* Данко Системс — ЕРП „Липсващи материали по заявки".
   Смята НУЖДАТА от материал за заявките, ПУСНАТИ в производство (по новия модел
   материалът се изписва при РЯЗАНЕ, не при пускане), спрямо текущата наличност.
   За всяка задача с първа операция (source.materials) взима оставащото за рязане
   (qty − produced) × материал за 1 бр., сумира по материал и показва къде няма да
   стигне + кои заявки го ползват. „Налично" отразява ВСИЧКИ движения (и рязане, и
   продажби, и корекции). Прави ПЪЛНО презареждане (erpLoadAll) при всяко влизане,
   за да е свежа наличността. Ползва erpView/ERP.matById/erpNum/escapeHtml/
   erpSelectAll; openMaterialsPlan от loading-plan.js. */

// Осветява/гаси таба „Липсващи материали" според броя недостигащи (без звук).
function erpSetMissingBadge(n) {
  const btn = document.querySelector('.erp-tab[data-tab="missmat"]');
  if (!btn) return;
  btn.classList.toggle("erp-tab-alert", n > 0);
  let badge = btn.querySelector(".erp-tab-badge");
  if (n > 0) {
    if (!badge) { badge = document.createElement("span"); badge.className = "erp-tab-badge"; btn.appendChild(badge); }
    badge.textContent = n;
  } else if (badge) { badge.remove(); }
}

// Брой материали, които няма да стигнат за пуснатите заявки (за индикатора).
async function erpMissingMatCount() {
  try {
    if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded();
    if (typeof erpRefreshMatStock === "function") await erpRefreshMatStock();
    const tk = await erpSelectAll("tasks", "data", "data->source->>flow", "true");
    const need = {};
    (tk.data || []).forEach(r => {
      const src = r.data && r.data.source;
      if (!src || !Array.isArray(src.materials) || !src.materials.length) return;
      const remaining = Math.max(0, (Number(r.data.qty) || 0) - (Number(r.data.produced) || 0));
      if (remaining <= 0) return;
      src.materials.forEach(mm => { const mid = Number(mm.mid) || 0; if (!mid) return; need[mid] = (need[mid] || 0) + (Number(mm.per) || 0) * remaining; });
    });
    let short = 0;
    Object.keys(need).forEach(mid => { const m = ERP.matById[mid] || ERP.matById[Number(mid)] || {}; if (need[mid] - (Number(m.stock) || 0) > 1e-9) short++; });
    return short;
  } catch (e) { return 0; }
}

// Пресмята и осветява таба (за отваряне на ЕРП и след пускане на заявка).
async function erpUpdateMissingBadge() {
  try { erpSetMissingBadge(await erpMissingMatCount()); } catch (e) {}
}

async function erpRenderMissingMaterials() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Проверявам материалите за пуснатите заявки…</p>`;
  // Пълно презареждане (не erpEnsureLoaded), за да е СВЕЖА наличността.
  try { await erpLoadAll(); }
  catch (e) { v.innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }

  // 1) Поточни задачи (носят source.materials на първата операция + source.orders).
  const tk = await erpSelectAll("tasks", "data", "data->source->>flow", "true");
  const tasks = (tk.data || []).map(r => r.data || {});

  // 2) Етикети на заявките (№ · клиент).
  const label = {};
  tasks.forEach(d => { const orders = (d.source && d.source.orders) || []; orders.forEach(o => { const sid = String(o.id); if (!label[sid]) label[sid] = { no: o.no || "", client: o.client || "" }; }); });
  try { if (typeof erpLoadCustomerOrders === "function" && (typeof erpCOList === "undefined" || !erpCOList)) await erpLoadCustomerOrders(); } catch (e) {}
  ((typeof erpCOList !== "undefined" && erpCOList) || []).forEach(o => { const sid = String(o.id); if (!label[sid]) label[sid] = { no: o.ourNo || "", client: o.clientName || "" }; });
  const orderText = sid => {
    const l = label[sid];
    const isStock = sid.indexOf("stock-") === 0;
    if (!l) return isStock ? "За склад" : "заявка (без №)";
    return (l.no ? "№" + l.no : (isStock ? "За склад" : "заявка (без №)")) + (l.client ? " · " + l.client : "");
  };

  // 3) Нужда от материал = сбор на (оставащо за рязане × материал за 1 бр.) по
  //    всички първи операции. Записваме и кои заявки ползват всеки материал.
  const need = {}, ordersByMat = {};
  tasks.forEach(d => {
    const src = d.source;
    if (!src || !Array.isArray(src.materials) || !src.materials.length) return;
    const remaining = Math.max(0, (Number(d.qty) || 0) - (Number(d.produced) || 0));
    if (remaining <= 0) return;
    src.materials.forEach(mm => {
      const mid = Number(mm.mid) || 0; if (!mid) return;
      need[mid] = (need[mid] || 0) + (Number(mm.per) || 0) * remaining;
      const set = ordersByMat[mid] = ordersByMat[mid] || new Set();
      (src.orders || []).forEach(o => set.add(String(o.id)));
    });
  });

  const list = Object.keys(need).map(mid => {
    const m = ERP.matById[Number(mid)] || ERP.matById[mid] || {};
    const stock = Number(m.stock) || 0, min = Number(m.min_stock) || 0;
    return {
      mid, code: m.code || "", name: m.name || "", unit: m.unit || "",
      stock, min, need: need[mid], missing: Math.max(0, need[mid] - stock), orders: [...(ordersByMat[mid] || [])],
    };
  });
  const short = list.filter(r => r.missing > 0).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, "bg"));
  const low = list.filter(r => r.missing <= 0 && r.min > 0 && r.stock < r.min).sort((a, b) => (a.stock - a.min) - (b.stock - b.min));
  erpSetMissingBadge(short.length);   // осветяваме таба според недостига

  const ordersCell = r => r.orders.map(orderText).map(t => `<span class="mm-order">${escapeHtml(t)}</span>`).join(" ") || "—";
  // Отметка за избор → „Запитване към доставчик" (кол. по подразбиране: липсващото/до минимума).
  const chk = (r, qty) => `<td class="pay-chk"><input type="checkbox" class="mm-sel" data-mid="${r.mid}" data-qty="${qty}" /></td>`;
  const shortRow = r => `
    <tr class="erp-below">
      ${chk(r, r.missing)}
      <td data-label="Материал"><b>${escapeHtml(r.code)}</b> ${escapeHtml(r.name)}</td>
      <td data-label="Мярка">${escapeHtml(r.unit)}</td>
      <td class="num" data-label="Нужен (оставащо)">${erpNum(r.need)}</td>
      <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
      <td class="num" data-label="Ще липсва"><span class="erp-warn">${erpNum(r.missing)} ⚠</span></td>
      <td data-label="Заявки">${ordersCell(r)}</td>
    </tr>`;
  const lowRow = r => `
    <tr>
      ${chk(r, Math.max(0, r.min - r.stock) || r.min)}
      <td data-label="Материал"><b>${escapeHtml(r.code)}</b> ${escapeHtml(r.name)}</td>
      <td data-label="Мярка">${escapeHtml(r.unit)}</td>
      <td class="num" data-label="Нужен (оставащо)">${erpNum(r.need)}</td>
      <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
      <td class="num" data-label="Минимум">${erpNum(r.min)}</td>
      <td data-label="Заявки">${ordersCell(r)}</td>
    </tr>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${!list.length ? "няма нужда от материал по пуснатите" : short.length ? `<span class="erp-warn">${short.length} материала няма да стигнат</span>` : "материалите стигат ✅"}${low.length ? ` · ${low.length} под минимум` : ""}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mm-refresh">↻ Обнови</button>
      ${typeof openMaterialsPlan === "function" ? `<button class="btn btn-small btn-primary" id="mm-plan" title="Отвори План материали, за да поръчаш липсващото от доставчик">📦 План материали</button>` : ""}
    </div>
    <p class="hint">Колоната <b>„Нужен (оставащо)"</b> е материалът за <i>още нерязаното</i> по заявките, ПУСНАТИ в производство (оставащо количество × материал за 1 бр.). <b>„Налично"</b> е текущата наличност в склада (отразява всички движения — рязане, продажби, корекции). <b>„Ще липсва"</b> = колко няма да стигне. Материалът се изписва при <b>рязане</b>, не при пускане — детайл без материал все пак тръгва, а складът отива на минус. Виж и „🛒 Необходими материали" в таб „Материали".</p>
    ${!list.length ? `<p class="report-empty">Няма пуснати в производство заявки, които да чакат рязане (или всичко вече е нарязано).</p>` : `
      ${short.length ? `
        <h4 class="erp-group-head">⚠ Няма да стигнат</h4>
        <table class="report-table erp-table">
          <thead><tr><th class="pay-chk"></th><th>Материал</th><th>Мярка</th><th class="num">Нужен (оставащо)</th><th class="num">Налично</th><th class="num">Ще липсва</th><th>Заявки</th></tr></thead>
          <tbody>${short.map(shortRow).join("")}</tbody>
        </table>`
        : `<p class="report-empty">✅ За оставащото рязане по пуснатите заявки има достатъчно материал.</p>`}
      ${low.length ? `
        <h4 class="erp-group-head">🟡 Под минимум (стигат засега, но да се поръчат)</h4>
        <table class="report-table erp-table">
          <thead><tr><th class="pay-chk"></th><th>Материал</th><th>Мярка</th><th class="num">Нужен (оставащо)</th><th class="num">Налично</th><th class="num">Минимум</th><th>Заявки</th></tr></thead>
          <tbody>${low.map(lowRow).join("")}</tbody>
        </table>` : ""}
      <div class="pay-paybar" id="mm-reqbar"><span class="erp-muted">Избери материали с отметките, за да пуснеш запитване към доставчик.</span></div>
    `}`;

  const rb = document.getElementById("mm-refresh"); if (rb) rb.addEventListener("click", erpRenderMissingMaterials);
  const pb = document.getElementById("mm-plan"); if (pb) pb.addEventListener("click", () => { if (typeof openMaterialsPlan === "function") openMaterialsPlan(); });
  // Избор с отметки → запитване към доставчик (влиза в регистъра „Заявки за материали").
  const bar = document.getElementById("mm-reqbar");
  const updBar = () => {
    if (!bar) return;
    const sel = [...v.querySelectorAll(".mm-sel:checked")];
    if (!sel.length) { bar.innerHTML = `<span class="erp-muted">Избери материали с отметките, за да пуснеш запитване към доставчик.</span>`; return; }
    bar.innerHTML = `<span class="pay-sel-info">Избрани: <b>${sel.length}</b> материала</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="mm-sendreq">✉ Запитване към доставчик (${sel.length})</button>`;
    bar.querySelector("#mm-sendreq").addEventListener("click", () => {
      const items = sel.map(c => {
        const m = ERP.matById[Number(c.dataset.mid)] || {};
        return { materialId: Number(c.dataset.mid), code: m.code || "", name: m.name || "", unit: m.unit || "", qty: Math.ceil((Number(c.dataset.qty) || 0) * 100) / 100 };
      });
      if (typeof erpMatReqCompose === "function") erpMatReqCompose(items);
      else alert("Модул Заявки за материали не е зареден.");
    });
  };
  v.querySelectorAll(".mm-sel").forEach(c => c.addEventListener("change", updBar));
}
