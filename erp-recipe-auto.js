/* Данко Системс — ЕРП „Автоматизиране на рецепти".
   Три инструмента за по-бързо съставяне на технология:
   1) Копирай рецепта от подобен продукт (клониране + донагласяне) — тук.
   2) Шаблони по семейство (параметрични) — в erp-recipe-templates частта.
   3) AI чернова от чертеж — reuse на parse-document.
   Ползва ERP/erpDialog/erpReloadRecipe/erpToNum/escapeHtml/sb. */

/* ---------- Общи помощни ---------- */
function raNorm(s) { return String(s || "").toLowerCase().replace(/[^a-zа-я0-9]+/gi, " ").replace(/\s+/g, " ").trim(); }
function raTokens(s) { return raNorm(s).split(" ").filter(t => t.length >= 3); }
// Има ли findId някъде в дървото на rootId (за пазене от цикъл при копиране)?
function raRecipeContains(rootId, findId, seen) {
  seen = seen || new Set();
  if (seen.has(rootId)) return false; seen.add(rootId);
  for (const l of (ERP.linesByProduct[rootId] || [])) {
    if (l.child_product_id) {
      if (Number(l.child_product_id) === Number(findId)) return true;
      if (raRecipeContains(l.child_product_id, findId, seen)) return true;
    }
  }
  return false;
}
function raRecipeLineCount(pid) { return (ERP.linesByProduct[pid] || []).length; }

/* ---------- 1) Копирай рецепта от подобен продукт ---------- */
function erpCopyRecipeFrom(targetId) {
  const target = ERP.prodById[targetId];
  if (!target) return;
  const tTok = raTokens(target.name);
  const tGroup = raNorm(target.group_name);
  // Кандидати: продукти С рецепта, различни от целта.
  const cands = (ERP.products || []).filter(p => p.id !== targetId && raRecipeLineCount(p.id) > 0).map(p => {
    const pTok = raTokens(p.name);
    const shared = pTok.filter(t => tTok.includes(t)).length;
    const groupBonus = (tGroup && raNorm(p.group_name) === tGroup) ? 2 : 0;
    return { p, score: shared * 2 + groupBonus, lines: raRecipeLineCount(p.id) };
  });
  cands.sort((a, b) => b.score - a.score || (a.p.name || "").localeCompare(b.p.name || "", "bg"));

  const { wrap, close } = erpDialog(`
    <h3>📋 Копирай рецепта от подобен продукт</h3>
    <p class="hint" style="margin:0 0 6px">За: <b>${escapeHtml(target.code || "")}</b> ${escapeHtml(target.name || "")}. Избери продукт с готова рецепта — тя се копира тук, после донагласяш.</p>
    <input type="search" id="ra-q" placeholder="търси код или име…" />
    <div id="ra-list" class="erp-lp-list" style="max-height:52vh;overflow:auto"></div>
    <label class="erp-inline" style="margin-top:6px"><input type="checkbox" id="ra-replace" ${raRecipeLineCount(targetId) ? "checked" : ""} /> Замести текущата рецепта (иначе добавя най-отдолу)</label>
    <div class="erp-dialog-actions"><button class="btn" id="ra-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#ra-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = cands;
    if (q) list = cands.filter(c => ((c.p.code || "") + " " + (c.p.name || "")).toLowerCase().includes(q));
    listEl.innerHTML = list.slice(0, 60).map(c =>
      `<button type="button" class="erp-lp-item" data-id="${c.p.id}"><b>${escapeHtml(c.p.code || "")}</b> ${escapeHtml(c.p.name || "")} <span class="erp-muted">${c.lines} реда${c.score > 0 && !q ? " · подобен" : ""}</span></button>`).join("")
      || `<p class="report-empty">Няма продукти с рецепта.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", async () => {
      const sourceId = Number(b.dataset.id);
      const replace = wrap.querySelector("#ra-replace").checked;
      const src = ERP.prodById[sourceId];
      if (!confirm(`Да копирам ли рецептата на „${src.code || ""} ${src.name || ""}" (${raRecipeLineCount(sourceId)} реда)${replace ? " и да заместя текущата" : ""}?`)) return;
      close();
      await erpDoCopyRecipe(targetId, sourceId, replace);
    }));
  };
  render(""); wrap.querySelector("#ra-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#ra-cancel").addEventListener("click", close);
}

async function erpDoCopyRecipe(targetId, sourceId, replace) {
  const src = (ERP.linesByProduct[sourceId] || []).slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  if (!src.length) { alert("Изворният продукт няма рецепта."); return; }
  if (raRecipeContains(sourceId, targetId)) { alert("Не може — това създава цикъл (изворът съдържа този продукт като възел)."); return; }
  try {
    if (replace) { const del = await sb.from("recipe_lines").delete().eq("product_id", targetId); if (del.error) throw del.error; }
    const start = replace ? 0 : raRecipeLineCount(targetId);
    const rows = src.map((l, i) => ({
      product_id: targetId, position: start + i, quantity: l.quantity, unit: l.unit,
      material_id: l.material_id || null,
      child_product_id: (Number(l.child_product_id) === Number(targetId)) ? null : (l.child_product_id || null),
      operation_id: l.operation_id || null,
    })).filter(r => r.material_id || r.child_product_id || r.operation_id);
    const ins = await sb.from("recipe_lines").insert(rows);
    if (ins.error) throw ins.error;
    // Ако продуктът беше маркиран „чака рецепта" — вече има.
    try { const p = ERP.prodById[targetId]; if (p && p.needs_recipe) await sb.from("products").update({ needs_recipe: false }).eq("id", targetId); } catch (e) {}
    await erpReloadRecipe(targetId);
    alert(`Готово! Копирани ${rows.length} реда. Прегледай и донагласи количествата/възлите.`);
  } catch (e) { alert("Грешка при копиране: " + (e.message || e)); }
}
