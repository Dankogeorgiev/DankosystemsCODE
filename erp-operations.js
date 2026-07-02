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
      <thead><tr><th>Операция</th><th class="num">Ползв.</th><th>Основен цех</th><th>Може също в…</th></tr></thead>
      <tbody>
        ${ops.map(op => {
          const r = ERP.opRouting[op.code];
          const altOpts = ws.filter(w => w !== r.primary && !(r.alt || []).includes(w));
          return `<tr class="${!r.primary ? "erp-below" : ""}" data-code="${escapeAttr(op.code || "")}">
            <td data-label="Операция">${escapeHtml(op.name || "")}<div class="t-code">${escapeHtml(op.code || "")}</div></td>
            <td class="num" data-label="Ползв.">${ERP.opUsage[op.id] || 0}</td>
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
  // Запазване
  const saveBtn = document.getElementById("erp-route-save");
  if (saveBtn) saveBtn.addEventListener("click", erpSaveRouting);
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
