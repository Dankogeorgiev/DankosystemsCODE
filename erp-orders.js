/* Данко Системс — Връзка Мостра/Поръчка ↔ ЕРП.
   - обвързване на поръчката с продукт от каталога;
   - „Вземи материалите от рецептата" (bom_requirements → раздел 5, с наличности);
   - „Пусни в производство" → задачи в „Цехове" по маршрутизацията (Операции → Цех);
   - проследяване на напредъка от цеховете обратно в поръчката.
   Ползва глобалните getCurrent/touch/renderMaterials (app.js), ERP/erpEnsureLoaded
   (erp.js), erpEffectiveRoute (erp-operations.js), erpDialog (erp-materials.js). */

// Мапва ЕРП материал към една от съществуващите категории в раздел 5.
function erpMatCategory(m) {
  const s = (((m && m.group_name) || "") + " " + ((m && m.name) || "")).toLowerCase();
  if (s.includes("ламарин")) return "Ламарини";
  if (s.includes("ral") || s.includes("цвят") || s.includes("боя")) return "Цвят по RAL";
  if (s.includes("болт") || s.includes("гайк") || s.includes("крепеж") || s.includes("винт") || s.includes("нит") || s.includes("шайб") || s.includes("резба")) return "Крепежи";
  if (s.includes("профил") || s.includes("винкел") || s.includes("тръб") || s.includes("шина") || s.includes("лента") || s.includes("квадрат") || s.includes("кръг") || s.includes("тел")) return "Профили";
  return "Други покупни";
}

/* ---------- Панел в поръчката ---------- */
function erpRenderOrderPanel(s) {
  const host = document.getElementById("erp-order-panel");
  if (!host) return;
  if (!s || s.type === "claim") { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;

  const linked = !!s.erpProductId;
  host.innerHTML = `
    <fieldset class="card erp-order-card">
      <legend>🏭 Производство (ЕРП)</legend>
      ${linked ? `
        <div class="erp-linked">
          <span>Свързан продукт: <b>${escapeHtml(s.erpProductCode || "")} ${escapeHtml(s.erpProductName || "")}</b></span>
          <button type="button" class="btn btn-small" id="erp-op-link">Смени</button>
        </div>
        <div class="erp-order-actions">
          <label class="erp-inline">Бройка
            <input type="number" id="erp-op-qty" min="1" step="any" value="${escapeAttr(String(s.erpQty || 1))}" style="width:90px" />
          </label>
          <button type="button" class="btn btn-small" id="erp-op-fill">↧ Вземи материалите от рецептата</button>
          <button type="button" class="btn btn-small btn-primary" id="erp-op-produce">🏭 Пусни в производство</button>
        </div>
        <div id="erp-op-status" class="erp-prod-status"></div>
      ` : `
        <p class="hint">Свържи поръчката с продукт от каталога, за да вземеш материалите от рецептата и да пуснеш задачи към цеховете.</p>
        <button type="button" class="btn btn-small btn-primary" id="erp-op-link">🔗 Свържи с ЕРП продукт</button>
      `}
    </fieldset>`;

  const linkBtn = host.querySelector("#erp-op-link");
  if (linkBtn) linkBtn.addEventListener("click", () => erpLinkProduct(s));
  const qtyEl = host.querySelector("#erp-op-qty");
  if (qtyEl) qtyEl.addEventListener("change", () => { s.erpQty = erpToNum(qtyEl.value) || 1; touch(s); });
  const fillBtn = host.querySelector("#erp-op-fill");
  if (fillBtn) fillBtn.addEventListener("click", () => erpFillMaterials(s));
  const prodBtn = host.querySelector("#erp-op-produce");
  if (prodBtn) prodBtn.addEventListener("click", () => erpProduce(s));

  if (linked && s.production) erpShowProduction(s);
}

/* ---------- Избор на продукт ---------- */
async function erpLinkProduct(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Не мога да заредя ЕРП данните. Пуснат ли е erp-setup.sql?\n" + (e.message || e)); return; }

  const { wrap, close } = erpDialog(`
    <h3>Свържи с ЕРП продукт</h3>
    <input type="search" id="erp-lp-q" placeholder="Търси код или име…" />
    <div id="erp-lp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="erp-lp-cancel">Отказ</button></div>`);

  const listEl = wrap.querySelector("#erp-lp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.products.slice();
    if (q) list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    const shown = list.slice(0, 80);
    listEl.innerHTML = shown.map(p =>
      `<button type="button" class="erp-lp-item" data-id="${p.id}"><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} <span class="erp-muted">${p.is_semifinished ? "полуфабрикат" : "артикул"}${p.needs_recipe ? " · чака рецепта" : ""}</span></button>`
    ).join("") + (list.length > 80 ? `<p class="hint">Показани първите 80 от ${list.length}. Уточни търсенето.</p>` : "")
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b =>
      b.addEventListener("click", () => {
        const p = ERP.prodById[Number(b.dataset.id)];
        s.erpProductId = p.id; s.erpProductCode = p.code; s.erpProductName = p.name;
        if (!s.erpQty) s.erpQty = 1;
        touch(s); close(); erpRenderOrderPanel(s);
      }));
  };
  render("");
  wrap.querySelector("#erp-lp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#erp-lp-cancel").addEventListener("click", close);
}

/* ---------- Вземане на материалите от рецептата ---------- */
async function erpFillMaterials(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  const qty = erpToNum(s.erpQty) || 1;
  const { data, error } = await sb.rpc("bom_requirements", { p_id: s.erpProductId, p_qty: qty });
  if (error) { alert("Грешка при разбивката: " + error.message); return; }
  if (!data || !data.length) { alert("Този продукт няма суровини в рецептата (или няма рецепта)."); return; }

  s.materials = (s.materials || []).filter(m => !m.fromErp);
  data.forEach(r => {
    const m = ERP.matById[r.material_id] || {};
    const stock = Number(m.stock) || 0;
    const required = Number(r.required) || 0;
    const shortage = Math.max(0, required - stock);
    const unit = r.unit || m.unit || "";
    s.materials.push({
      category: erpMatCategory(m),
      name: (m.code ? m.code + " · " : "") + (r.name || m.name || ""),
      qty: erpNum(required) + (unit ? " " + unit : ""),
      status: "not-ordered",
      note: `Склад: ${erpNum(stock)} ${unit}` + (shortage > 0 ? ` · недостиг ${erpNum(shortage)} ⚠` : " · достатъчно ✓"),
      fromErp: true, matId: r.material_id,
    });
  });
  touch(s);
  renderMaterials(s);
  erpRenderOrderPanel(s);
  const short = data.filter(r => (Number(r.required) || 0) > (Number((ERP.matById[r.material_id] || {}).stock) || 0)).length;
  alert(`Заредени ${data.length} материала от рецептата за ${erpNum(qty)} бр.` + (short ? `\n${short} от тях са с недостиг (виж раздел 5).` : ""));
}

/* ---------- Пускане в производство ---------- */
// Обхожда рецептата и връща задачите по цехове (+ външните операции).
function erpBuildTasks(s) {
  const qty = erpToNum(s.erpQty) || 1;
  const tasks = [], external = [];
  const route = op => (typeof erpEffectiveRoute === "function") ? erpEffectiveRoute(op) : { primary: op.workshop || "", alt: [] };
  (function walk(pid, mult, anc) {
    const p = ERP.prodById[pid] || {};
    (ERP.linesByProduct[pid] || []).forEach(l => {
      if (l.operation_id) {
        const op = ERP.opById[l.operation_id] || {};
        const ws = (route(op).primary) || "";
        const cnt = mult * (Number(l.quantity) || 1);
        if (!ws || ws === "Външна услуга") { external.push({ op: op.name || "", product: p.name || "" }); return; }
        tasks.push({
          client: s.clientName || "", product: p.name || "", code: p.code || "",
          operation: op.name || "", workshop: ws, qty: cnt, produced: 0,
          due: s.deadline || "", thickness: "", files: [], logs: [],
          source: { kind: "order", sampleId: s.id, sampleType: s.type || "order" },
        });
      } else if (l.child_product_id && !anc.has(l.child_product_id)) {
        walk(l.child_product_id, mult * (Number(l.quantity) || 1), new Set([...anc, l.child_product_id]));
      }
    });
  })(s.erpProductId, qty, new Set([s.erpProductId]));
  return { tasks, external };
}

async function erpProduce(s) {
  try { await erpEnsureLoaded(); }
  catch (e) { alert("Грешка при зареждане на ЕРП: " + (e.message || e)); return; }
  if (!s.erpProductId) { alert("Първо свържи продукт от ЕРП."); return; }

  const { tasks, external } = erpBuildTasks(s);
  if (!tasks.length) {
    alert("Няма операции за пускане. Проверете дали продуктът има рецепта с операции и дали операциите са насочени към цех (таб Операции → Цех).");
    return;
  }
  const already = s.production && s.production.count;
  let msg = `Ще създам ${tasks.length} задачи в цеховете за „${s.erpProductName}" × ${erpNum(erpToNum(s.erpQty) || 1)} бр.`;
  if (external.length) msg += `\n\n${external.length} външни операции (напр. поцинковане) няма да отидат в цех — те са за подизпълнител.`;
  if (already) msg += `\n\n⚠ Вече има пуснато производство (${s.production.count} задачи). Ще ги заменя с новите.`;
  if (!confirm(msg)) return;

  // Идемпотентност: махаме старите задачи за тази поръчка, после създаваме наново.
  const del = await sb.from("tasks").delete().eq("data->source->>sampleId", String(s.id));
  if (del.error) { alert("Грешка при изчистване на старите задачи: " + del.error.message); return; }
  const { error } = await sb.from("tasks").insert(tasks.map(t => ({ data: t })));
  if (error) { alert("Грешка при създаване на задачи: " + error.message); return; }

  s.production = { at: new Date().toISOString(), count: tasks.length, external: external.length };
  touch(s);
  erpRenderOrderPanel(s);
  alert(`Готово! Създадени ${tasks.length} задачи в цеховете.` + (external.length ? `\n(${external.length} външни операции пропуснати.)` : ""));
}

/* ---------- Проследяване на напредъка ---------- */
async function erpShowProduction(s) {
  const box = document.getElementById("erp-op-status");
  if (!box) return;
  box.innerHTML = `<span class="erp-muted">Производство: пуснато (${s.production.count} задачи) — зареждане на напредъка…</span>`;
  const { data, error } = await sb.from("tasks").select("done").eq("data->source->>sampleId", String(s.id));
  if (error) { box.innerHTML = `<span class="erp-warn">Не мога да заредя напредъка: ${escapeHtml(error.message)}</span>`; return; }
  const total = (data || []).length;
  const done = (data || []).filter(r => r.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  box.innerHTML = total
    ? `<div class="erp-prod-line"><b>Производство:</b> ${done} / ${total} задачи готови (${pct}%)
         <span class="erp-prodbar"><span style="width:${pct}%"></span></span>
         <button type="button" class="btn btn-small" id="erp-op-refresh">↻</button></div>`
    : `<span class="erp-muted">Няма задачи за тази поръчка (възможно е да са изчистени от цеха).</span>`;
  const rb = document.getElementById("erp-op-refresh");
  if (rb) rb.addEventListener("click", () => erpShowProduction(s));
}
