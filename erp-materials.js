/* Данко Системс — ЕРП екран „Материали (склад)".
   Таблица от v_material_stock (+ група), сигнал под минимум, списък „Липсва",
   движения (входящ/изписване/корекция) с история. Част от модул erp.js. */

let erpMatSearch = "";
let erpMatOnlyBelow = false;

function erpRenderMaterials() {
  const v = erpView();
  const q = erpMatSearch.trim().toLowerCase();
  let rows = ERP.materials.slice();
  if (q) rows = rows.filter(m =>
    (m.code || "").toLowerCase().includes(q) ||
    (m.name || "").toLowerCase().includes(q) ||
    (m.group_name || "").toLowerCase().includes(q));
  if (erpMatOnlyBelow) rows = rows.filter(m => m.below_min);
  rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));

  const belowCount = ERP.materials.filter(m => m.below_min).length;

  v.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="erp-mat-search" placeholder="Търси код, име, група…" value="${escapeAttr(erpMatSearch)}" />
      <label class="erp-check"><input type="checkbox" id="erp-mat-below" ${erpMatOnlyBelow ? "checked" : ""} /> Само липсващите</label>
      <span class="spacer"></span>
      <span class="erp-count">${rows.length} материала${belowCount ? ` · <span class="erp-warn">${belowCount} под минимум</span>` : ""}</span>
      <button class="btn btn-small btn-primary" id="erp-mat-add">+ Нов материал</button>
    </div>
    <table class="report-table erp-table">
      <thead>
        <tr><th>Код</th><th>Име</th><th>Група</th><th>Вид</th>
            <th class="num">Наличност</th><th class="num">Минимум</th><th>Мярка</th>
            <th class="num">Ср. цена</th><th></th></tr>
      </thead>
      <tbody>
        ${rows.map(m => `
          <tr class="${m.below_min ? "erp-below" : ""}">
            <td data-label="Код">${escapeHtml(m.code || "—")}</td>
            <td data-label="Име">${escapeHtml(m.name || "")}</td>
            <td data-label="Група">${escapeHtml(m.group_name || "")}</td>
            <td data-label="Вид">${m.is_purchased ? "Покупни" : "Метал"}</td>
            <td class="num" data-label="Наличност">${erpNum(m.stock)}${m.below_min ? " ⚠" : ""}</td>
            <td class="num" data-label="Минимум">${erpNum(m.min_stock)}</td>
            <td data-label="Мярка">${escapeHtml(m.unit || "")}</td>
            <td class="num" data-label="Ср. цена">${erpEur(m.avg_cost)}</td>
            <td class="erp-row-actions" data-label="">
              <button class="btn btn-small" data-move="${m.id}">Движение</button>
              <button class="btn btn-small" data-hist="${m.id}">История</button>
              <button class="btn btn-small" data-edit="${m.id}">✎</button>
            </td>
          </tr>`).join("") ||
          `<tr><td colspan="9" class="report-empty">Няма материали. Импортирай рецепти или добави ръчно.</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("erp-mat-search").addEventListener("input", e => {
    erpMatSearch = e.target.value; erpRenderMaterials();
    const el = document.getElementById("erp-mat-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
  document.getElementById("erp-mat-below").addEventListener("change", e => {
    erpMatOnlyBelow = e.target.checked; erpRenderMaterials();
  });
  document.getElementById("erp-mat-add").addEventListener("click", () => erpEditMaterial(null));
  v.querySelectorAll("[data-move]").forEach(b =>
    b.addEventListener("click", () => erpMovementDialog(Number(b.dataset.move))));
  v.querySelectorAll("[data-hist]").forEach(b =>
    b.addEventListener("click", () => erpHistoryDialog(Number(b.dataset.hist))));
  v.querySelectorAll("[data-edit]").forEach(b =>
    b.addEventListener("click", () => erpEditMaterial(Number(b.dataset.edit))));
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
  kind.addEventListener("change", () => {
    const isCorr = kind.value === "корекция";
    corrHint.hidden = !isCorr;
    qty.min = isCorr ? "" : "0";
  });
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
    <label>Средна цена (€)<input type="number" id="mt-cost" step="any" min="0" value="${m ? (m.avg_cost || 0) : 0}" /></label>
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
    let error;
    if (m) ({ error } = await sb.from("materials").update(payload).eq("id", m.id));
    else ({ error } = await sb.from("materials").insert(payload));
    if (error) { wrap.querySelector("#mt-status").textContent = "⚠ " + error.message; return; }
    close();
    await erpReload();
  });
}
