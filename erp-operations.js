/* Данко Системс — ЕРП екран „Операции → Цех".
   За всяка операция: основен цех + „може също" (алтернативни цехове).
   Тази маршрутизация захранва бъдещото „Пусни в производство".
   Пази се в app_config (id='erp_op_routing'), за да не се губи при импорт. */

// Цехове, към които може да се насочва (10-те цеха + „Външна услуга").
function erpWorkshops() {
  const base = (typeof TASK_DEFAULT_WORKSHOPS !== "undefined" && TASK_DEFAULT_WORKSHOPS)
    ? TASK_DEFAULT_WORKSHOPS.slice()
    : ["Лазери", "CNC цех", "Преси", "Абкант", "Заваръчно", "Занитване", "Бояджийно", "Заготовки", "Сглобяване", "Опаковане/Експедиция"];
  base.push("Външна услуга");
  return base;
}

// Начална карта по решенията на собственика (правила по ключова дума в името).
// Първото съвпадение печели; издържа на варианти с размери в името.
const ERP_ROUTING_SEED = [
  { kw: ["лазер"],       primary: "Лазери" },
  { kw: ["боядис"],      primary: "Бояджийно" },
  { kw: ["завар"],       primary: "Заваръчно" },
  { kw: ["фрезов", "фрезенк"], primary: "CNC цех" },
  { kw: ["огъв"],        primary: "Абкант" },
  { kw: ["занитв"],      primary: "Занитване" },
  { kw: ["зачистван", "лентоотрез"], primary: "Заготовки" },
  { kw: ["поцинк", "галван", "гълван"], primary: "Външна услуга" },
  { kw: ["монтаж"],      primary: "Сглобяване" },
  { kw: ["опакова"],     primary: "Опаковане/Експедиция" },
  { kw: ["пробиване бормашина"], primary: "Преси", alt: ["Абкант"] },
  { kw: ["резбов", "набиване", "оребр", "пробиван", "щанц", "сечене", "гилотина", "преса"], primary: "Преси" },
];

function erpSeedRoute(name) {
  const s = (name || "").toLowerCase();
  // Огъване, което се прави на ПРЕСА (ексцентрик / хидравлична / щанца) е за цех
  // Преси, а не Абкант. Проверява се ПРЕДИ общото правило „огъв → Абкант".
  if (s.includes("огъв") && /прес|хидравли|ексцентр|щанц/.test(s)) {
    return { primary: "Преси", alt: ["Абкант"] };
  }
  for (const r of ERP_ROUTING_SEED) {
    if (r.kw.some(k => s.includes(k))) return { primary: r.primary, alt: (r.alt || []).slice() };
  }
  return { primary: "", alt: [] };
}

// Ефективна маршрутизация за операция: запазена > начална карта > авто от импорт.
function erpEffectiveRoute(op) {
  const saved = ERP.opRoutingSaved[op.code];
  if (saved && saved.primary !== undefined) return { primary: saved.primary || "", alt: (saved.alt || []).slice() };
  const seed = erpSeedRoute(op.name);
  if (seed.primary) return seed;
  return { primary: op.workshop || "", alt: [] };
}

let erpRoutingDirty = false;

function erpRenderOperations() {
  const v = erpView();
  // Работно копие в паметта (веднъж, за да не се губят несъхранени промени при пре-рендиране).
  ERP.operations.forEach(op => {
    if (!ERP.opRouting[op.code]) ERP.opRouting[op.code] = erpEffectiveRoute(op);
  });

  const ops = ERP.operations.slice().sort((a, b) =>
    (ERP.opUsage[b.id] || 0) - (ERP.opUsage[a.id] || 0) || (a.name || "").localeCompare(b.name || "", "bg"));
  const noPrimary = ops.filter(op => !ERP.opRouting[op.code].primary).length;
  const ws = erpWorkshops();

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${ops.length} операции${noPrimary ? ` · <span class="erp-warn">${noPrimary} без основен цех</span>` : " · всички разпределени ✅"}</span>
      <span class="spacer"></span>
      <button class="btn btn-small ${erpRoutingDirty ? "btn-primary" : ""}" id="erp-route-save" ${erpRoutingDirty ? "" : "disabled"}>💾 Запази промените</button>
    </div>
    <p class="hint">За всяка операция избери <b>основен цех</b> (там отива задачата при „Пусни в производство") и по избор „<b>може също</b>" — алтернативни цехове, между които се преразпределя при нужда.</p>
    <table class="report-table erp-table erp-routing">
      <thead><tr><th>Операция</th><th class="num">Ползв.</th><th class="num cost-cell">Себест.</th><th>Основен цех</th><th>Може също в…</th><th></th></tr></thead>
      <tbody>
        ${ops.map(op => {
          const r = ERP.opRouting[op.code];
          const altOpts = ws.filter(w => w !== r.primary && !(r.alt || []).includes(w));
          return `<tr class="${!r.primary ? "erp-below" : ""}" data-code="${escapeAttr(op.code || "")}">
            <td data-label="Операция">${escapeHtml(op.name || "")}<div class="t-code">${escapeHtml(op.code || "")}</div></td>
            <td class="num" data-label="Ползв.">${ERP.opUsage[op.id] || 0}</td>
            <td class="num cost-cell" data-label="Себест.">${erpEur(op.unit_cost)}</td>
            <td data-label="Основен цех">
              <select class="erp-route-primary">
                <option value="">— избери —</option>
                ${ws.map(w => `<option ${w === r.primary ? "selected" : ""}>${escapeHtml(w)}</option>`).join("")}
              </select>
            </td>
            <td data-label="Може също">
              <span class="erp-alt-chips">${(r.alt || []).map(w =>
                `<span class="erp-chip">${escapeHtml(w)} <button class="erp-chip-x" data-alt="${escapeAttr(w)}">×</button></span>`).join("")}</span>
              <select class="erp-route-alt-add">
                <option value="">+ добави…</option>
                ${altOpts.map(w => `<option>${escapeHtml(w)}</option>`).join("")}
              </select>
            </td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-editop="${op.id}" title="Редактирай име/себестойност">✎</button><button class="btn btn-small" data-mergeop="${op.id}" title="Обедини с друга операция (за дублирани кодове)">⧉</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;

  // Основен цех
  v.querySelectorAll(".erp-route-primary").forEach(sel =>
    sel.addEventListener("change", () => {
      const code = sel.closest("tr").dataset.code;
      ERP.opRouting[code].primary = sel.value;
      // махаме избрания основен от алтернативите, ако съвпада
      ERP.opRouting[code].alt = (ERP.opRouting[code].alt || []).filter(w => w !== sel.value);
      erpRoutingDirty = true;
      erpRenderOperations();
    }));
  // Добавяне на алтернативен цех
  v.querySelectorAll(".erp-route-alt-add").forEach(sel =>
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      const code = sel.closest("tr").dataset.code;
      const r = ERP.opRouting[code];
      r.alt = r.alt || [];
      if (sel.value !== r.primary && !r.alt.includes(sel.value)) r.alt.push(sel.value);
      erpRoutingDirty = true;
      erpRenderOperations();
    }));
  // Премахване на алтернативен цех
  v.querySelectorAll(".erp-chip-x").forEach(btn =>
    btn.addEventListener("click", () => {
      const code = btn.closest("tr").dataset.code;
      ERP.opRouting[code].alt = (ERP.opRouting[code].alt || []).filter(w => w !== btn.dataset.alt);
      erpRoutingDirty = true;
      erpRenderOperations();
    }));
  // Редакция / обединяване на операция
  v.querySelectorAll("[data-editop]").forEach(b => b.addEventListener("click", () => erpEditOperation(Number(b.dataset.editop))));
  v.querySelectorAll("[data-mergeop]").forEach(b => b.addEventListener("click", () => erpMergeOperation(Number(b.dataset.mergeop))));
  // Запазване
  const saveBtn = document.getElementById("erp-route-save");
  if (saveBtn) saveBtn.addEventListener("click", erpSaveRouting);
}

// Редакция на операция: име + себестойност (€/бр.). Оправя напр. завишена цена.
function erpEditOperation(id) {
  const op = ERP.opById[id];
  if (!op) return;
  const { wrap, close } = erpDialog(`
    <h3>Редакция на операция <span class="erp-muted">${escapeHtml(op.code || "")}</span></h3>
    <label>Име<input type="text" id="eo-name" value="${escapeAttr(op.name || "")}" /></label>
    <label class="cost-cell">Себестойност €/бр.<input type="number" id="eo-cost" step="any" min="0" value="${op.unit_cost || 0}" /></label>
    <div class="erp-dialog-actions"><button class="btn" id="eo-cancel">Отказ</button><button class="btn btn-primary" id="eo-save">Запази</button></div>
    <p class="save-status" id="eo-status"></p>`);
  wrap.querySelector("#eo-cancel").addEventListener("click", close);
  wrap.querySelector("#eo-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#eo-name").value.trim();
    const status = wrap.querySelector("#eo-status");
    if (!name) { status.textContent = "Въведи име."; return; }
    const cost = erpToNum(wrap.querySelector("#eo-cost").value) || 0;
    status.textContent = "Записва…";
    const { error } = await sb.from("operations").update({ name, unit_cost: cost }).eq("id", id);
    if (error) { status.textContent = "⚠ " + error.message; return; }
    close();
    await erpReload();
  });
}

// Обединяване на дублирани операции: рецептите се пренасочват към избраната
// операция, а тази се изтрива (напр. две „Лазерно рязане" → една).
function erpMergeOperation(fromId) {
  const from = ERP.opById[fromId];
  if (!from) return;
  const fromLbl = (from.code ? from.code + " " : "") + (from.name || "");
  const others = ERP.operations.filter(o => o.id !== fromId).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  const uses = ERP.opUsage[fromId] || 0;
  const { wrap, close } = erpDialog(`
    <h3>Обедини операция</h3>
    <p class="hint">Всички рецепти (${uses} реда), които ползват <b>${escapeHtml(fromLbl)}</b>, ще започнат да сочат към избраната операция, а тази ще се <b>изтрие</b>. Полезно за дублирани кодове (напр. две „Лазерно рязане").</p>
    <label>Обедини в:
      <select id="mo-target"><option value="">— избери операция —</option>${others.map(o => `<option value="${o.id}">${escapeHtml((o.code ? o.code + " " : "") + (o.name || ""))}</option>`).join("")}</select>
    </label>
    <div class="erp-dialog-actions"><button class="btn" id="mo-cancel">Отказ</button><button class="btn btn-primary" id="mo-save">Обедини</button></div>
    <p class="save-status" id="mo-status"></p>`);
  wrap.querySelector("#mo-cancel").addEventListener("click", close);
  wrap.querySelector("#mo-save").addEventListener("click", async () => {
    const targetId = Number(wrap.querySelector("#mo-target").value);
    const status = wrap.querySelector("#mo-status");
    if (!targetId) { status.textContent = "Избери операция."; return; }
    const target = ERP.opById[targetId] || {};
    const targetLbl = (target.code ? target.code + " " : "") + (target.name || "");
    if (!confirm(`Рецептите ще сочат към „${targetLbl}", а „${fromLbl}" ще се изтрие. Продължавам?`)) return;
    status.textContent = "Обединява…";
    const e1 = await sb.from("recipe_lines").update({ operation_id: targetId }).eq("operation_id", fromId);
    if (e1.error) { status.textContent = "⚠ " + e1.error.message; return; }
    const e2 = await sb.from("operations").delete().eq("id", fromId);
    if (e2.error) { status.textContent = "⚠ Пренасочено, но не изтрито: " + e2.error.message; return; }
    close();
    await erpReload();
  });
}

async function erpSaveRouting() {
  const byCode = {};
  ERP.operations.forEach(op => {
    const r = ERP.opRouting[op.code] || { primary: "", alt: [] };
    byCode[op.code] = { primary: r.primary || "", alt: (r.alt || []).slice() };
  });
  const btn = document.getElementById("erp-route-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  const { error } = await sb.from("app_config").upsert({
    id: "erp_op_routing", data: { byCode }, updated_at: new Date().toISOString(),
  });
  if (error) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази промените"; } alert("Грешка при запис: " + error.message); return; }
  ERP.opRoutingSaved = byCode;
  erpRoutingDirty = false;
  erpRenderOperations();
}
