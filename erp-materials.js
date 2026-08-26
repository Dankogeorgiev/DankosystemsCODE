/* Данко Системс — ЕРП екран „Материали (склад)".
   Таблица от v_material_stock (+ група), сигнал под минимум, списък „Липсва",
   движения (входящ/изписване/корекция) с история. Част от модул erp.js. */

let erpMatSearch = "";
let erpMatOnlyBelow = false;

// Мярката вече е в килограми? (кг, kg, килограм…)
function erpUnitIsKg(unit) {
  const u = String(unit || "").trim().toLowerCase().replace(/[.\s]+$/, "");   // маха „кг." → „кг"
  return u === "кг" || u === "kg" || u === "килограм" || u === "килограми" || u === "kilogram";
}
// Тегло на 1 мярка в кг: за материал в кг → 1; иначе от ръчно въведеното (app_config).
function erpMatKgPerUnit(m) {
  if (erpUnitIsKg(m.unit)) return 1;
  const w = Number((ERP.matKg || {})[m.id]);
  return w > 0 ? w : null;
}
// Наличност в килограми (или null, ако тегло на мярката не е зададено).
function erpMatStockKg(m) {
  const f = erpMatKgPerUnit(m);
  return f == null ? null : (Number(m.stock) || 0) * f;
}
async function erpSaveMatKg() {
  const { error } = await sb.from("app_config").upsert({ id: "material_kg", data: { perUnit: ERP.matKg || {} }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на тегло: " + error.message);
  return !error;
}

function erpRenderMaterials() {
  const v = erpView();
  const q = erpMatSearch.trim().toLowerCase();
  let rows = ERP.materials.slice();
  if (q) rows = rows.filter(m =>
    (m.code || "").toLowerCase().includes(q) ||
    (m.name || "").toLowerCase().includes(q) ||
    (m.group_name || "").toLowerCase().includes(q));
  if (erpMatOnlyBelow) rows = rows.filter(m => m.below_min);
  rows.sort((a, b) => bgCmp(a.name, b.name));
  const totalRows = rows.length;
  const MAT_CAP = 400;                       // повече редове бавят рисуването; търсенето стеснява
  const capped = totalRows > MAT_CAP;
  if (capped) rows = rows.slice(0, MAT_CAP);

  const belowCount = ERP.materials.filter(m => m.below_min).length;
  // Общо в килограми за показаните материали + колко нямат зададено тегло.
  let totalKg = 0, noWeight = 0;
  rows.forEach(m => { const kg = erpMatStockKg(m); if (kg == null) { if ((Number(m.stock) || 0) !== 0) noWeight++; } else totalKg += kg; });

  v.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="erp-mat-search" placeholder="Търси код, име, група…" value="${escapeAttr(erpMatSearch)}" />
      <label class="erp-check"><input type="checkbox" id="erp-mat-below" ${erpMatOnlyBelow ? "checked" : ""} /> Само липсващите</label>
      <span class="spacer"></span>
      <span class="erp-count">${rows.length} материала${belowCount ? ` · <span class="erp-warn">${belowCount} под минимум</span>` : ""}</span>
      <button class="btn btn-small" id="erp-mat-needed" title="Какви материали трябва да купим за пуснатите в производство заявки">🛒 Необходими материали</button>
      <button class="btn btn-small" id="erp-mat-quick" title="Заприходи няколко материала наведнъж (цяла доставка)">⚡ Бърз приход</button>
      <button class="btn btn-small btn-primary" id="erp-mat-add">+ Нов материал</button>
    </div>
    <div class="erp-kg-total">⚖ Общо наличност: <strong>${erpNum(totalKg)} кг</strong>${noWeight ? ` <span class="erp-muted">(${noWeight} материала без зададено тегло на мярка — не влизат в сумата)</span>` : ""}</div>
    <table class="report-table erp-table">
      <thead>
        <tr><th>Код</th><th>Име</th><th>Група</th><th>Вид</th>
            <th class="num">Наличност</th><th>Мярка</th><th class="num">В кг</th><th class="num">Минимум</th>
            <th class="num cost-cell">Ср. цена</th><th></th></tr>
      </thead>
      <tbody>
        ${rows.map(m => { const kg = erpMatStockKg(m); return `
          <tr class="${m.below_min ? "erp-below" : ""}">
            <td data-label="Код">${escapeHtml(m.code || "—")}</td>
            <td data-label="Име">${escapeHtml(m.name || "")}</td>
            <td data-label="Група">${escapeHtml(m.group_name || "")}</td>
            <td data-label="Вид">${m.is_purchased ? "Покупни" : "Метал"}</td>
            <td class="num" data-label="Наличност">${erpNum(m.stock)}${m.below_min ? " ⚠" : ""}</td>
            <td data-label="Мярка">${escapeHtml(m.unit || "")}</td>
            <td class="num erp-kg-cell" data-label="В кг">${kg == null ? `<button class="btn btn-small erp-mat-setkg" data-setkg="${m.id}" title="Задай тегло на 1 мярка, за да се смята в кг">задай тегло</button>` : `<strong>${erpNum(kg)}</strong> кг`}</td>
            <td class="num" data-label="Минимум">${erpNum(m.min_stock)}</td>
            <td class="num cost-cell" data-label="Ср. цена">${erpEur(m.avg_cost)}</td>
            <td class="erp-row-actions" data-label="">
              <button class="btn btn-small" data-move="${m.id}">Движение</button>
              <button class="btn btn-small" data-hist="${m.id}">История</button>
              <button class="btn btn-small" data-edit="${m.id}">✎</button>
            </td>
          </tr>`; }).join("") ||
          `<tr><td colspan="10" class="report-empty">Няма материали. Импортирай рецепти или добави ръчно.</td></tr>`}
        ${capped ? `<tr><td colspan="10" class="report-empty">Показани са първите ${rows.length} от ${totalRows} — пиши в търсачката, за да стесниш.</td></tr>` : ""}
      </tbody>
    </table>`;

  document.getElementById("erp-mat-search").addEventListener("input", uiDebounce(e => {
    erpMatSearch = e.target.value; erpRenderMaterials();
    const el = document.getElementById("erp-mat-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  }, 200));
  document.getElementById("erp-mat-below").addEventListener("change", e => {
    erpMatOnlyBelow = e.target.checked; erpRenderMaterials();
  });
  document.getElementById("erp-mat-add").addEventListener("click", () => erpEditMaterial(null));
  const needBtn = document.getElementById("erp-mat-needed");
  if (needBtn) needBtn.addEventListener("click", erpMatNeededDialog);
  const quickBtn = document.getElementById("erp-mat-quick");
  if (quickBtn) quickBtn.addEventListener("click", erpQuickIntake);
  v.querySelectorAll("[data-move]").forEach(b =>
    b.addEventListener("click", () => erpMovementDialog(Number(b.dataset.move))));
  v.querySelectorAll("[data-hist]").forEach(b =>
    b.addEventListener("click", () => erpHistoryDialog(Number(b.dataset.hist))));
  v.querySelectorAll("[data-edit]").forEach(b =>
    b.addEventListener("click", () => erpEditMaterial(Number(b.dataset.edit))));
  v.querySelectorAll("[data-setkg]").forEach(b =>
    b.addEventListener("click", () => erpSetMatKg(Number(b.dataset.setkg))));
}

// Бърз диалог: тегло на 1 мярка (кг) за материал, който не е в кг.
function erpSetMatKg(matId) {
  const m = ERP.matById[matId]; if (!m) return;
  const cur = Number((ERP.matKg || {})[matId]) || "";
  const { wrap, close } = erpDialog(`
    <h3>Тегло на 1 ${escapeHtml(m.unit || "мярка")}</h3>
    <p class="erp-muted">${escapeHtml(m.code || "")} ${escapeHtml(m.name || "")}</p>
    <label>Колко кг тежи 1 ${escapeHtml(m.unit || "мярка")}? <input type="number" id="mk-w" step="any" min="0" value="${escapeAttr(String(cur))}" /></label>
    <p class="erp-muted">Наличност: ${erpNum(m.stock)} ${escapeHtml(m.unit || "")}. Ще се смята в кг = наличност × това тегло.</p>
    <div class="erp-dialog-actions">
      <button class="btn" id="mk-cancel">Отказ</button>
      <button class="btn btn-primary" id="mk-save">Запиши</button>
    </div>
    <p class="save-status" id="mk-status"></p>`);
  wrap.querySelector("#mk-cancel").addEventListener("click", close);
  wrap.querySelector("#mk-save").addEventListener("click", async () => {
    const w = erpToNum(wrap.querySelector("#mk-w").value);
    ERP.matKg = ERP.matKg || {};
    if (w > 0) ERP.matKg[matId] = w; else delete ERP.matKg[matId];
    wrap.querySelector("#mk-status").textContent = "Записва…";
    const ok = await erpSaveMatKg();
    if (!ok) { wrap.querySelector("#mk-status").textContent = "⚠ грешка"; return; }
    close(); erpRenderMaterials();
  });
}

/* ---------- Малък модал (общ помощник) ---------- */
function erpDialog(html) {
  const wrap = document.createElement("div");
  wrap.className = "overlay erp-dialog";
  wrap.innerHTML = `<div class="erp-dialog-box">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  return { wrap, close };
}

/* ---------- Движение (входящ / изписване / корекция) ---------- */
function erpMovementDialog(matId) {
  const m = ERP.matById[matId]; if (!m) return;
  const { wrap, close } = erpDialog(`
    <h3>Движение — ${escapeHtml(m.name)}</h3>
    <p class="hint">Текуща наличност: <strong>${erpNum(m.stock)} ${escapeHtml(m.unit || "")}</strong></p>
    <label>Вид движение
      <select id="mv-kind">
        <option value="входящ">Входящ (+)</option>
        <option value="изписване">Изписване (−)</option>
        <option value="начално">Начално салдо</option>
        <option value="корекция">Корекция (±)</option>
      </select>
    </label>
    <label>Количество (${escapeHtml(m.unit || "")})
      <input type="number" id="mv-qty" step="any" min="0" inputmode="decimal" placeholder="0" />
    </label>
    <label id="mv-price-lbl">Доставна цена (€ за 1 ${escapeHtml(m.unit || "мярка")}) <span class="erp-muted">— обновява средната цена</span>
      <input type="number" id="mv-price" step="any" min="0" inputmode="decimal" placeholder="0.00" value="${(Number(m.avg_cost) > 0) ? escapeAttr(String(m.avg_cost)) : ""}" />
    </label>
    <label>Доставчик / № заявка / бележка
      <input type="text" id="mv-ref" placeholder="напр. Метал ООД, № 1234" />
    </label>
    <label>Забележка
      <input type="text" id="mv-note" placeholder="по избор" />
    </label>
    <p class="hint" id="mv-corr-hint" hidden>При „Корекция" въведи количеството със знак (напр. -5 за брак).</p>
    <div class="erp-dialog-actions">
      <button class="btn" id="mv-cancel">Отказ</button>
      <button class="btn btn-primary" id="mv-save">Запиши</button>
    </div>
    <p class="save-status" id="mv-status"></p>`);

  const kind = wrap.querySelector("#mv-kind");
  const qty = wrap.querySelector("#mv-qty");
  const corrHint = wrap.querySelector("#mv-corr-hint");
  const priceLbl = wrap.querySelector("#mv-price-lbl");
  const updKind = () => {
    const isCorr = kind.value === "корекция";
    corrHint.hidden = !isCorr;
    qty.min = isCorr ? "" : "0";
    // Доставна цена има смисъл само при приход (входящ / начално салдо).
    const isIn = kind.value === "входящ" || kind.value === "начално";
    if (priceLbl) priceLbl.hidden = !isIn;
  };
  kind.addEventListener("change", updKind);
  updKind();
  wrap.querySelector("#mv-cancel").addEventListener("click", close);
  wrap.querySelector("#mv-save").addEventListener("click", async () => {
    const k = kind.value;
    let amount = erpToNum(qty.value);
    if (!amount) { wrap.querySelector("#mv-status").textContent = "Въведи количество."; return; }
    // Знак според вида: изписване → минус; входящ/начално → плюс; корекция → както е въведено.
    let signed = amount;
    if (k === "изписване") signed = -Math.abs(amount);
    else if (k === "входящ" || k === "начално") signed = Math.abs(amount);
    // при корекция запазваме знака от въведеното (позволяваме ± чрез текст)
    if (k === "корекция") signed = erpToNum(qty.value);

    wrap.querySelector("#mv-status").textContent = "Записва…";
    const { error } = await sb.from("stock_movements").insert({
      material_id: matId, kind: k, quantity: signed,
      ref: wrap.querySelector("#mv-ref").value || null,
      note: wrap.querySelector("#mv-note").value || null,
      created_by: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || null,
    });
    if (error) { wrap.querySelector("#mv-status").textContent = "⚠ " + error.message; return; }
    // Доставна цена при приход → обновяваме средната цена (претеглено; при начално салдо — директно).
    const priceEl = wrap.querySelector("#mv-price");
    const price = priceEl ? (erpToNum(priceEl.value) || 0) : 0;
    if ((k === "входящ" || k === "начално") && price > 0) {
      const stock = Number(m.stock) || 0, avg = Number(m.avg_cost) || 0, addq = Math.abs(amount);
      const base = Math.max(0, stock);   // отрицателна наличност не тежи в средната цена
      const newAvg = (k === "начално") ? price : ((base + addq) > 0 ? (base * avg + addq * price) / (base + addq) : price);
      try { await sb.from("materials").update({ avg_cost: newAvg }).eq("id", matId); } catch (e) {}
    }
    close();
    await erpReload();
  });
}

/* ---------- История на движенията ---------- */
async function erpHistoryDialog(matId) {
  const m = ERP.matById[matId]; if (!m) return;
  const { wrap, close } = erpDialog(`
    <h3>История — ${escapeHtml(m.name)}</h3>
    <div id="hist-body"><p class="erp-loading">Зареждане…</p></div>
    <div class="erp-dialog-actions"><button class="btn" id="hist-close">Затвори</button></div>`);
  wrap.querySelector("#hist-close").addEventListener("click", close);
  const { data, error } = await sb.from("stock_movements")
    .select("*").eq("material_id", matId).order("created_at", { ascending: false }).limit(200);
  const body = wrap.querySelector("#hist-body");
  if (error) { body.innerHTML = `<p class="erp-warn">${escapeHtml(error.message)}</p>`; return; }
  if (!data || !data.length) { body.innerHTML = `<p class="report-empty">Няма движения.</p>`; return; }
  body.innerHTML = `
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>Вид</th><th class="num">Кол-во</th><th>Реф.</th><th>Забележка</th><th>От</th></tr></thead>
      <tbody>${data.map(r => `
        <tr>
          <td>${escapeHtml((r.created_at || "").slice(0, 16).replace("T", " "))}</td>
          <td>${escapeHtml(r.kind)}</td>
          <td class="num ${Number(r.quantity) < 0 ? "erp-warn" : ""}">${erpNum(r.quantity)}</td>
          <td>${escapeHtml(r.ref || "")}</td>
          <td>${escapeHtml(r.note || "")}</td>
          <td>${escapeHtml(r.created_by || "")}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

/* ---------- Ръчно добавяне / редакция на материал ---------- */
function erpEditMaterial(matId) {
  const m = matId ? ERP.matById[matId] : null;
  const { wrap, close } = erpDialog(`
    <h3>${m ? "Редакция на материал" : "Нов материал"}</h3>
    <label>Код${m ? "" : ' <span class="erp-muted">(предложен пореден)</span>'}<input type="text" id="mt-code" value="${m ? escapeAttr(m.code || "") : escapeAttr(erpNextCode())}" /></label>
    <label>Име<input type="text" id="mt-name" value="${m ? escapeAttr(m.name || "") : ""}" /></label>
    <label>Група<input type="text" id="mt-group" value="${m ? escapeAttr(m.group_name || "") : ""}" /></label>
    <label>Мярка<input type="text" id="mt-unit" value="${m ? escapeAttr(m.unit || "кг") : "кг"}" /></label>
    <label>Тегло на 1 мярка (кг) <span class="erp-muted">— ако мярката НЕ е кг (за наличност в кг)</span><input type="number" id="mt-kg" step="any" min="0" value="${m && ERP.matKg && ERP.matKg[m.id] ? escapeAttr(String(ERP.matKg[m.id])) : ""}" placeholder="напр. 1 лист = 47 кг" /></label>
    <label class="cost-cell">Средна цена (€)<input type="number" id="mt-cost" step="any" min="0" value="${m ? (m.avg_cost || 0) : 0}" /></label>
    <label>Минимум (точка на презареждане)<input type="number" id="mt-min" step="any" min="0" value="${m ? (m.min_stock || 0) : 0}" /></label>
    <label class="erp-check"><input type="checkbox" id="mt-purch" ${m && m.is_purchased ? "checked" : ""} /> Покупни/стока (иначе метал)</label>
    <div class="erp-dialog-actions">
      <button class="btn" id="mt-cancel">Отказ</button>
      <button class="btn btn-primary" id="mt-save">Запиши</button>
    </div>
    <p class="save-status" id="mt-status"></p>`);
  wrap.querySelector("#mt-cancel").addEventListener("click", close);
  wrap.querySelector("#mt-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#mt-name").value.trim();
    if (!name) { wrap.querySelector("#mt-status").textContent = "Въведи име."; return; }
    const payload = {
      code: wrap.querySelector("#mt-code").value.trim() || null,
      name,
      group_name: wrap.querySelector("#mt-group").value.trim() || null,
      unit: wrap.querySelector("#mt-unit").value.trim() || "кг",
      avg_cost: erpToNum(wrap.querySelector("#mt-cost").value),
      min_stock: erpToNum(wrap.querySelector("#mt-min").value),
      is_purchased: wrap.querySelector("#mt-purch").checked,
    };
    wrap.querySelector("#mt-status").textContent = "Записва…";
    const kgW = erpToNum(wrap.querySelector("#mt-kg").value);
    let error;
    if (m) ({ error } = await sb.from("materials").update(payload).eq("id", m.id));
    else ({ error } = await sb.from("materials").insert(payload));
    if (error) { wrap.querySelector("#mt-status").textContent = "⚠ " + error.message; return; }
    // Тегло на мярка (кг) се пази в app_config; за нов материал се задава после с „задай тегло".
    if (m) { ERP.matKg = ERP.matKg || {}; if (kgW > 0) ERP.matKg[m.id] = kgW; else delete ERP.matKg[m.id]; await erpSaveMatKg(); }
    close();
    await erpReload();
  });
}

// „Необходими материали" — какво трябва да купим за пуснатите в производство
// заявки. Сумира оставащата нужда по всички поточни задачи (за 1-ва операция) и
// вади наличното. На живо — щом купиш/нарежеш, числата се променят.
async function erpMatNeededDialog() {
  try { if (typeof erpEnsureLoaded === "function") await erpEnsureLoaded(); } catch (e) {}
  if (typeof erpRefreshMatStock === "function") await erpRefreshMatStock();
  let tasks = (typeof TASKS !== "undefined" && Array.isArray(TASKS) && TASKS.length) ? TASKS : null;
  if (!tasks) {
    try {
      const { data } = await erpSelectAll("tasks", "id,data", "data->source->>flow", "true");
      tasks = (data || []).map(r => Object.assign({ id: r.id }, r.data || {}));
    } catch (e) { tasks = []; }
  }
  const rows = (typeof erpFlowMatNeeded === "function") ? erpFlowMatNeeded(tasks) : [];
  const buyRows = rows.filter(r => r.buy > 0);
  const okRows = rows.filter(r => r.buy <= 0);
  const rowHtml = r => `<tr class="${r.buy > 0 ? "erp-below" : ""}">
    <td data-label="Код">${escapeHtml(r.code || "—")}</td>
    <td data-label="Материал">${escapeHtml(r.name || "")}</td>
    <td class="num" data-label="Нужно">${erpNum(r.need)}</td>
    <td class="num" data-label="Налично">${erpNum(r.have)}</td>
    <td class="num" data-label="За купуване"><b>${r.buy > 0 ? erpNum(r.buy) : "—"}</b></td>
    <td data-label="Мярка">${escapeHtml(r.unit || "")}</td></tr>`;
  const table = list => `<table class="report-table erp-table">
    <thead><tr><th>Код</th><th>Материал</th><th class="num">Нужно</th><th class="num">Налично</th><th class="num">За купуване</th><th>Мярка</th></tr></thead>
    <tbody>${list.map(rowHtml).join("") || `<tr><td colspan="6" class="report-empty">Няма.</td></tr>`}</tbody></table>`;

  const { wrap, close } = erpDialog(`
      <h3>🛒 Необходими материали за производството</h3>
      <p class="hint">Сумата на оставащия материал по всички пуснати заявки (по първата операция), минус наличното.
        Числата са на живо — щом купиш материал или нарежеш детайли, се обновяват.</p>
      ${buyRows.length ? `<h4 class="erp-warn">⚠ Трябва да се купи (${buyRows.length})</h4>${table(buyRows)}` : `<div class="erp-kg-total">✅ За пуснатото има достатъчно материал.</div>`}
      ${okRows.length ? `<h4 style="margin-top:14px">Достатъчно на склад (${okRows.length})</h4>${table(okRows)}` : ""}
      <div class="erp-dialog-actions">
        ${(typeof reportExportXls === "function" && rows.length) ? `<button class="btn btn-small" id="mn-xls">⤓ Excel</button>` : ""}
        <button class="btn btn-primary" id="mn-close">Затвори</button>
      </div>`);
  wrap.querySelector("#mn-close").addEventListener("click", close);
  const xls = wrap.querySelector("#mn-xls");
  if (xls) xls.addEventListener("click", () => {
    const headers = [{ label: "Код" }, { label: "Материал" }, { label: "Нужно", num: true }, { label: "Налично", num: true }, { label: "За купуване", num: true }, { label: "Мярка" }];
    const toRow = r => [r.code || "", r.name || "", erpNum(r.need), erpNum(r.have), r.buy > 0 ? erpNum(r.buy) : "", r.unit || ""];
    reportExportXls("neobhodimi-materiali", "Необходими материали за производството", [
      { title: "За купуване", headers, rows: buyRows.map(toRow) },
      { title: "Достатъчно на склад", headers, rows: okRows.map(toRow) },
    ]);
  });
}

// ⚡ Бърз приход — заприходява няколко материала наведнъж (една доставка) с общ
// доставчик/№. Записва движения „входящ" (+) в stock_movements.
function erpQuickIntake() {
  const lines = [];   // { id, code, name, unit, qty }
  const { wrap, close } = erpDialog(`
    <h3>⚡ Бърз приход на материали</h3>
    <p class="hint">Заприходи няколко материала наведнъж (цяла доставка). Търси, добави с бройка, запиши всички.</p>
    <label>Доставчик / № на доставка <input type="text" id="qi-ref" placeholder="напр. Метал ООД, № 1234" /></label>
    <label>Търси материал <input type="search" id="qi-search" placeholder="код или име…" autocomplete="off" /></label>
    <div id="qi-results" class="erp-lp-list"></div>
    <div id="qi-lines" style="margin-top:10px"></div>
    <div class="erp-dialog-actions">
      <button class="btn" id="qi-cancel">Затвори</button>
      <button class="btn btn-primary" id="qi-save">💾 Заприходи всички</button>
    </div>
    <p class="save-status" id="qi-status"></p>`);

  const results = wrap.querySelector("#qi-results");
  const linesBox = wrap.querySelector("#qi-lines");
  const searchEl = wrap.querySelector("#qi-search");

  const renderResults = (q) => {
    q = (q || "").toLowerCase().trim();
    let list = (ERP.materials || []).slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "") + " " + (m.group_name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    results.innerHTML = list.slice(0, 40).map(m =>
      `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">${escapeHtml(m.unit || "")}${m.group_name ? " · " + escapeHtml(m.group_name) : ""}</span></button>`
    ).join("") + (list.length > 40 ? `<p class="hint">Показани 40 от ${list.length}. Уточни търсенето.</p>` : "")
      || `<p class="report-empty">Няма съвпадения. Създай материала с „+ Нов материал".</p>`;
    results.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => addLine(Number(b.dataset.id))));
  };

  const addLine = (id) => {
    const m = ERP.matById[id]; if (!m) return;
    // Цената по подразбиране = текущата средна цена (за удобство; смени я с реалната).
    if (!lines.some(l => l.id === id)) lines.push({ id, code: m.code || "", name: m.name || "", unit: m.unit || "", qty: "", price: (Number(m.avg_cost) > 0 ? String(m.avg_cost) : "") });
    searchEl.value = ""; renderResults(""); renderLines();
    const last = linesBox.querySelector('.qi-qty[data-i="' + (lines.length - 1) + '"]'); if (last) last.focus();
  };

  const renderLines = () => {
    linesBox.innerHTML = lines.length
      ? `<table class="report-table erp-table"><thead><tr><th>Код</th><th>Материал</th><th class="num">Приход</th><th>Мярка</th><th class="num">Цена/мярка (€)</th><th></th></tr></thead>
         <tbody>${lines.map((l, i) => `<tr>
           <td>${escapeHtml(l.code)}</td><td>${escapeHtml(l.name)}</td>
           <td class="num"><input type="number" class="qi-qty" data-i="${i}" step="any" min="0" value="${escapeAttr(String(l.qty))}" style="width:80px" /></td>
           <td>${escapeHtml(l.unit)}</td>
           <td class="num"><input type="number" class="qi-price" data-i="${i}" step="any" min="0" value="${escapeAttr(String(l.price))}" placeholder="0.00" style="width:90px" /></td>
           <td><button type="button" class="btn btn-small" data-rm="${i}">×</button></td></tr>`).join("")}</tbody></table>
         <p class="hint">Цената е за 1 мярка (напр. €/кг). При запис обновява средната цена на материала (претеглена спрямо наличното). Празна цена → не пипа цената.</p>`
      : `<p class="erp-muted">Още няма добавени материали — потърси и избери отгоре.</p>`;
    linesBox.querySelectorAll(".qi-qty").forEach(inp => inp.addEventListener("input", e => { lines[Number(e.target.dataset.i)].qty = e.target.value; }));
    linesBox.querySelectorAll(".qi-price").forEach(inp => inp.addEventListener("input", e => { lines[Number(e.target.dataset.i)].price = e.target.value; }));
    linesBox.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { lines.splice(Number(b.dataset.rm), 1); renderLines(); }));
  };

  searchEl.addEventListener("input", e => renderResults(e.target.value));
  renderResults(""); renderLines();
  wrap.querySelector("#qi-cancel").addEventListener("click", close);
  wrap.querySelector("#qi-save").addEventListener("click", async () => {
    const ref = wrap.querySelector("#qi-ref").value || null;
    const rows = lines.map(l => ({ id: l.id, q: erpToNum(l.qty) || 0, price: erpToNum(l.price) || 0 })).filter(l => l.q > 0);
    if (!rows.length) { wrap.querySelector("#qi-status").textContent = "Въведи поне един материал с бройка > 0."; return; }
    wrap.querySelector("#qi-status").textContent = "Записва…";
    const by = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || null;

    // Свежи наличности и средни цени (за претеглената средна цена), с резервен вариант от кеша.
    const ids = rows.map(l => l.id);
    const stockById = {}, avgById = {};
    try {
      const [stk, mat] = await Promise.all([
        sb.from("v_material_stock").select("id,stock").in("id", ids),
        sb.from("materials").select("id,avg_cost").in("id", ids),
      ]);
      if (!stk.error) (stk.data || []).forEach(r => { stockById[r.id] = Number(r.stock) || 0; });
      if (!mat.error) (mat.data || []).forEach(r => { avgById[r.id] = Number(r.avg_cost) || 0; });
    } catch (e) {}
    ids.forEach(id => { const m = ERP.matById[id] || {}; if (stockById[id] == null) stockById[id] = Number(m.stock) || 0; if (avgById[id] == null) avgById[id] = Number(m.avg_cost) || 0; });

    const moves = [], avgUpdates = [];
    rows.forEach(l => {
      moves.push({ material_id: l.id, kind: "входящ", quantity: Math.abs(l.q), ref, note: null, created_by: by });
      if (l.price > 0) {
        const stock = stockById[l.id] || 0, avg = avgById[l.id] || 0;
        const base = Math.max(0, stock);   // отрицателна наличност не тежи в средната цена
        const newAvg = (base + l.q) > 0 ? (base * avg + l.q * l.price) / (base + l.q) : l.price;
        avgUpdates.push({ id: l.id, avg: newAvg });
      }
    });
    const { error } = await sb.from("stock_movements").insert(moves);
    if (error) { wrap.querySelector("#qi-status").textContent = "⚠ " + error.message; return; }
    for (const u of avgUpdates) {
      const { error: e2 } = await sb.from("materials").update({ avg_cost: u.avg }).eq("id", u.id);
      if (e2) { wrap.querySelector("#qi-status").textContent = "⚠ цена: " + e2.message; return; }
    }
    close();
    await erpReload();
    alert(`Заприходени ${rows.length} материала` + (ref ? ` (${ref})` : "") + "."
      + (avgUpdates.length ? `\nОбновени средни цени: ${avgUpdates.length}.` : ""));
  });
}
