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

async function erpRenderMissingMaterials(box) {
  // box: по избор — рендира се и ВЪТРЕ в таб „Заявки за материали" (изгледът
  // „⚠ Липсващи по заявки"), не само в собствения си таб.
  const v = box || erpView();
  v.innerHTML = `<p class="erp-loading">Проверявам материалите за пуснатите заявки…</p>`;
  // Пълно презареждане (не erpEnsureLoaded), за да е СВЕЖА наличността.
  try { await erpLoadAll(); }
  catch (e) { v.innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }
  // Покупките — за предложението „Поръчай от…" (кой ни е доставял материала).
  let mmSupp = new Map();
  try {
    if (typeof erpLoadPurchases === "function" && (typeof erpPurchases === "undefined" || !erpPurchases)) await erpLoadPurchases();
    if (typeof suppLoad === "function") await suppLoad();
    if (typeof matreqSuppliersOfMaterials === "function") mmSupp = matreqSuppliersOfMaterials();
  } catch (e) { /* без предложения — екранът работи и така */ }
  // Запомнените ръчни избори (материал → доставчик) — излизат първи.
  let mmPrefs = {};
  try { if (typeof matreqSuppPrefs === "function") mmPrefs = await matreqSuppPrefs(); } catch (e) {}
  // Всички познати доставчици — за „Въведи доставчик" (datalist).
  // Вече планираните (Заявки за материали → 🗓 Планувани) — за бележка „в плана".
  const mmPlanned = {};
  try {
    if (typeof matreqPlannedLoad === "function") ((await matreqPlannedLoad()) || []).forEach(p => {
      const k = String(Number(p.mid) || ""); if (k) mmPlanned[k] = (mmPlanned[k] || 0) + (Number(p.qty) || 0);
    });
  } catch (e) {}
  const mmAllSupps = new Set();
  try { ((typeof erpLoadSuppliers === "function" && await erpLoadSuppliers()) || []).forEach(s2 => { const n = String(s2.name || "").trim(); if (n) mmAllSupps.add(n); }); } catch (e) {}
  try {
    if (typeof CONTACTS !== "undefined") {
      if ((!CONTACTS || !CONTACTS.length) && typeof cLoad === "function") await cLoad();
      (CONTACTS || []).filter(c => /^Доставчик/i.test(c.category || "")).forEach(c => { const n = String(c.company || "").trim(); if (n) mmAllSupps.add(n); });
    }
  } catch (e) {}
  ((typeof erpPurchases !== "undefined" && erpPurchases) || []).forEach(o => {
    const n = (typeof matreqCanon === "function") ? matreqCanon(o.supplierName) : String(o.supplierName || "").trim();
    if (n) mmAllSupps.add(n);
  });

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
  // Бързо заприходяване направо от този екран — само за Данко.
  const canIn = ((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "").toLowerCase() === "dankog@gmail.com";
  const inBtn = r => canIn ? `<td class="erp-row-actions"><button class="btn btn-small" data-mm-in="${r.mid}" title="Заприходи в Склад материали — входящо движение с доставна цена (обновява средната)">📥 Заприходи</button></td>` : "";
  const inTh = canIn ? "<th></th>" : "";
  // Отметка за избор → „Запитване към доставчик" (кол. по подразбиране: липсващото/до минимума).
  const chk = (r, qty) => `<td class="pay-chk"><input type="checkbox" class="mm-sel" data-mid="${r.mid}" data-qty="${qty}" /></td>`;
  // „Доставчик" (отделна колона) — доставчиците, доставяли този материал
  // (запомненият/най-скорошният предизбран, с последната му цена); без
  // история → „Въведи доставчик" от списъка с всички (запомня се за
  // следващия път). ОТТУК НЕ СЕ ПОРЪЧВА (Данко, 13.11.2026) — бутонът
  // „🗓 Планувай" праща материала в Заявки за материали → 🗓 Планувани за
  // поръчка (с избрания доставчик), а поръчката се прави само оттам.
  const plan1 = r => `<button class="btn btn-small btn-primary mm-plan1" data-mid="${r.mid}" title="Добави материала в Заявки за материали → 🗓 Планувани за поръчка (с липсващото количество и избрания доставчик). Поръчката се прави оттам.">🗓 Планувай за поръчка</button>${mmPlanned[String(Number(r.mid))] ? `<div class="erp-muted mm-inplan" style="font-size:11.5px;margin-top:3px">✓ вече в плана: ${erpNum(mmPlanned[String(Number(r.mid))])}</div>` : ""}`;
  const suppSel = r => {
    let cands = (mmSupp.get(Number(r.mid)) || []).slice(0, 6);
    const pref = mmPrefs[String(r.mid)] && mmPrefs[String(r.mid)].name;
    if (pref) {
      const i = cands.findIndex(c => c.name === pref);
      if (i > 0) cands.unshift(cands.splice(i, 1)[0]);
      else if (i === -1) cands.unshift({ name: pref, priceEur: 0, manual: true });
    }
    if (!cands.length) return `<input type="text" class="mm-supin" data-mid="${r.mid}" list="mm-supdl" placeholder="Въведи доставчик…" style="max-width:190px" title="Избери от списъка или напиши — запомня се и следващия път излиза сам" autocomplete="off" />`;
    return `<select class="mm-supp" data-mid="${r.mid}" style="max-width:190px" title="Кой да го достави — доставчиците, от които сме го купували (посл. цена в EUR); избереш ли друг, се запомня">${cands.map((c, i) =>
      `<option value="${escapeAttr(c.name)}" ${i === 0 ? "selected" : ""}>${escapeHtml(c.name)}${c.manual ? " · запомнен" : (c.priceEur ? ` · ${Math.round(c.priceEur * 100) / 100} €` : "")}</option>`).join("")}</select>`;
  };
  const shortRow = r => `
    <tr class="erp-below">
      ${chk(r, r.missing)}
      <td data-label="Материал"><b>${escapeHtml(r.code)}</b> ${escapeHtml(r.name)}</td>
      <td data-label="Мярка">${escapeHtml(r.unit)}</td>
      <td class="num" data-label="Нужен (оставащо)">${erpNum(r.need)}${typeof matreqMetalGuessHtml === "function" ? matreqMetalGuessHtml(r.name, r.need, r.unit, r.mid) : ""}</td>
      <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
      <td class="num" data-label="Ще липсва"><span class="erp-warn">${erpNum(r.missing)} ⚠</span>${typeof matreqMetalGuessHtml === "function" ? matreqMetalGuessHtml(r.name, r.missing, r.unit, r.mid) : ""}</td>
      <td data-label="Заявки">${ordersCell(r)}</td>
      <td data-label="Доставчик">${suppSel(r)}</td>
      <td data-label="Планиране">${plan1(r)}</td>
      ${inBtn(r)}
    </tr>`;
  const lowRow = r => `
    <tr>
      ${chk(r, Math.max(0, r.min - r.stock) || r.min)}
      <td data-label="Материал"><b>${escapeHtml(r.code)}</b> ${escapeHtml(r.name)}</td>
      <td data-label="Мярка">${escapeHtml(r.unit)}</td>
      <td class="num" data-label="Нужен (оставащо)">${erpNum(r.need)}${typeof matreqMetalGuessHtml === "function" ? matreqMetalGuessHtml(r.name, r.need, r.unit, r.mid) : ""}</td>
      <td class="num" data-label="Налично">${erpNum(r.stock)}</td>
      <td class="num" data-label="Минимум">${erpNum(r.min)}</td>
      <td data-label="Заявки">${ordersCell(r)}</td>
      <td data-label="Доставчик">${suppSel(r)}</td>
      <td data-label="Планиране">${plan1(r)}</td>
      ${inBtn(r)}
    </tr>`;

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${!list.length ? "няма нужда от материал по пуснатите" : short.length ? `<span class="erp-warn">${short.length} материала няма да стигнат</span>` : "материалите стигат ✅"}${low.length ? ` · ${low.length} под минимум` : ""}</span>
      <span class="spacer"></span>
      <button class="btn btn-small" id="mm-refresh">↻ Обнови</button>
    </div>
    <p class="hint">Колоната <b>„Нужен (оставащо)"</b> е материалът за <i>още нерязаното</i> по заявките, ПУСНАТИ в производство (оставащо количество × материал за 1 бр.). <b>„Налично"</b> е текущата наличност в склада (отразява всички движения — рязане, продажби, корекции). <b>„Ще липсва"</b> = колко няма да стигне. Материалът се изписва при <b>рязане</b>, не при пускане — детайл без материал все пак тръгва, а складът отива на минус. Виж и „🛒 Необходими материали" в таб „Материали". <b>Поръчките се правят само от Заявки за материали</b> — „🗓 Планувай за поръчка" праща материала в 🗓 Планувани за поръчка.</p>
    ${!list.length ? `<p class="report-empty">Няма пуснати в производство заявки, които да чакат рязане (или всичко вече е нарязано).</p>` : `
      ${short.length ? `
        <h4 class="erp-group-head">⚠ Няма да стигнат</h4>
        <table class="report-table erp-table">
          <thead><tr><th class="pay-chk"></th><th>Материал</th><th>Мярка</th><th class="num">Нужен (оставащо)</th><th class="num">Налично</th><th class="num">Ще липсва</th><th>Заявки</th><th>Доставчик</th><th></th>${inTh}</tr></thead>
          <tbody>${short.map(shortRow).join("")}</tbody>
        </table>`
        : `<p class="report-empty">✅ За оставащото рязане по пуснатите заявки има достатъчно материал.</p>`}
      ${low.length ? `
        <h4 class="erp-group-head">🟡 Под минимум (стигат засега, но да се поръчат)</h4>
        <table class="report-table erp-table">
          <thead><tr><th class="pay-chk"></th><th>Материал</th><th>Мярка</th><th class="num">Нужен (оставащо)</th><th class="num">Налично</th><th class="num">Минимум</th><th>Заявки</th><th>Доставчик</th><th></th>${inTh}</tr></thead>
          <tbody>${low.map(lowRow).join("")}</tbody>
        </table>` : ""}
      <datalist id="mm-supdl">${[...mmAllSupps].sort((a, b) => a.localeCompare(b, "bg")).map(n => `<option value="${escapeAttr(n)}"></option>`).join("")}</datalist>
      <div class="pay-paybar" id="mm-reqbar"><span class="erp-muted">Отметни материали — долу излиза бутон „🗓 Планувай избраните" (отиват в Заявки за материали → 🗓 Планувани за поръчка).</span></div>
    `}`;

  const rb = v.querySelector("#mm-refresh"); if (rb) rb.addEventListener("click", () => erpRenderMissingMaterials(box));
  // 📥 Заприходи (само Данко) — отваря стандартния диалог „Движение" (входящ + цена).
  v.querySelectorAll("[data-mm-in]").forEach(b => b.addEventListener("click", e => {
    e.stopPropagation();
    if (typeof erpMovementDialog === "function") erpMovementDialog(Number(b.dataset.mmIn));
  }));
  // Избраният доставчик на реда: от падащото ИЛИ от „Въведи доставчик".
  const rowSupp = mid => {
    const el = v.querySelector(`.mm-supp[data-mid="${mid}"]`) || v.querySelector(`.mm-supin[data-mid="${mid}"]`);
    return ((el && el.value) || "").trim();
  };
  const r2 = n => Math.ceil((Number(n) || 0) * 100) / 100;
  const ordersOf = mid => { const r = list.find(x => Number(x.mid) === Number(mid)); return r ? r.orders.map(orderText).join(", ") : ""; };
  // Записва материалите в 🗓 Планувани за поръчка (Заявки за материали).
  const planItems = async (sel) => {
    if (typeof matreqPlannedAdd !== "function") { alert("Модул Заявки за материали не е зареден."); return false; }
    const items = sel.map(({ mid, qty }) => {
      const m = ERP.matById[mid] || {};
      return { mid, code: m.code || "", name: m.name || "", unit: m.unit || "", qty: r2(qty) || 1, supplier: rowSupp(mid) };
    });
    const froms = [...new Set(sel.map(x => ordersOf(x.mid)).filter(Boolean))].join(", ");
    return matreqPlannedAdd(items, "Липсващи материали" + (froms ? ": " + froms : ""));
  };
  const markPlanned = mid => {
    const b = v.querySelector(`.mm-plan1[data-mid="${mid}"]`);
    if (b) { b.disabled = true; b.textContent = "✓ Планиран"; b.classList.remove("btn-primary"); }
  };
  // Избор с отметки → „🗓 Планувай избраните" (всички наведнъж в плана).
  const bar = v.querySelector("#mm-reqbar");
  const updBar = () => {
    if (!bar) return;
    const sel = [...v.querySelectorAll(".mm-sel:checked")];
    if (!sel.length) { bar.innerHTML = `<span class="erp-muted">Отметни материали — долу излиза бутон „🗓 Планувай избраните" (отиват в Заявки за материали → 🗓 Планувани за поръчка).</span>`; return; }
    bar.innerHTML = `<span class="pay-sel-info">Избрани: <b>${sel.length}</b> материала</span>
      <span class="spacer"></span>
      <span class="erp-muted" id="mm-plan-st"></span>
      <button class="btn btn-small btn-primary" id="mm-plansel" title="Добавя избраните в Заявки за материали → 🗓 Планувани за поръчка (с количеството и избрания доставчик). Поръчката се прави оттам.">🗓 Планувай избраните (${sel.length})</button>`;
    const pb = bar.querySelector("#mm-plansel");
    pb.addEventListener("click", async () => {
      const cur = [...v.querySelectorAll(".mm-sel:checked")].map(c => ({ mid: Number(c.dataset.mid), qty: Number(c.dataset.qty) || 0 }));
      if (!cur.length) return;
      pb.disabled = true; pb.textContent = "Записвам…";
      const ok = await planItems(cur);
      if (!ok) { pb.disabled = false; pb.textContent = `🗓 Планувай избраните (${cur.length})`; return; }
      cur.forEach(x => markPlanned(x.mid));
      v.querySelectorAll(".mm-sel:checked").forEach(c => { c.checked = false; });
      updBar();
      const st = bar.querySelector(".erp-muted");
      if (st) st.textContent = `✅ ${cur.length} материал${cur.length === 1 ? "" : "а"} са в Заявки за материали → 🗓 Планувани за поръчка.`;
    });
  };
  v.querySelectorAll(".mm-sel").forEach(c => c.addEventListener("change", updBar));
  // Смяна/въвеждане на доставчик → запомня се за материала (следващия път
  // излиза пръв).
  v.querySelectorAll(".mm-supp, .mm-supin").forEach(s2 => s2.addEventListener("change", () => {
    if (typeof matreqSuppPrefSave === "function") matreqSuppPrefSave(s2.dataset.mid, s2.value);
  }));
  // 🗓 Планувай ЕДИН ред: количеството по подразбиране (липсващото / до минимума).
  v.querySelectorAll(".mm-plan1").forEach(b => b.addEventListener("click", async () => {
    const mid = Number(b.dataset.mid);
    const cEl = v.querySelector(`.mm-sel[data-mid="${mid}"]`);
    b.disabled = true; b.textContent = "Записвам…";
    const ok = await planItems([{ mid, qty: Number(cEl && cEl.dataset.qty) || 0 }]);
    if (ok) markPlanned(mid);
    else { b.disabled = false; b.textContent = "🗓 Планувай за поръчка"; }
  }));
}
