/* Данко Системс — Склад за детайли/полуфабрикати.
   Наличност на готовите детайли/възли (не суровини). При пускане в производство
   системата приспада наличното и праща в цех само недостига (виж erpFlowApply).
   Наличност = сбор от движенията (начално / заприходяване / изписване / корекция).
   Ползва erp-detail-stock.sql (таблица product_movements + изглед v_product_stock). */

let DS_TERM = "";
let DS_ONLY_STOCK = false;

// Кои продукти са „детайли/възли" (не крайни артикули без рецепта-предназначение):
// показваме полуфабрикатите + всичко, което участва в рецепта на друг продукт.
function dsIsDetail(p) {
  if (p.is_semifinished) return true;
  const g = (p.group_name || "").toLowerCase();
  if (g.includes("детайл") || g.includes("възл") || g.includes("полуфабрикат") || g.includes("заготов")) return true;
  return false;
}

async function erpRenderDetailStock() {
  try { await erpEnsureLoaded(); }
  catch (e) { erpView().innerHTML = `<div class="erp-error"><h3>Грешка</h3><p>${escapeHtml(e.message || String(e))}</p></div>`; return; }

  // Проверка дали складът за детайли е създаден.
  const probe = await sb.from("product_movements").select("id").limit(1);
  if (probe.error) {
    erpView().innerHTML = `
      <div class="erp-error">
        <h3>📦 Склад за детайли — още не е включен</h3>
        <p>За да следим наличности и на детайлите/възлите (не само суровините), пусни веднъж
        файла <code>erp-detail-stock.sql</code> в Supabase → SQL Editor.</p>
        <p><a href="https://supabase.com/dashboard/project/hwbblteomrrahfrsyuow/sql/new" target="_blank" class="btn btn-small btn-primary">Отвори SQL Editor</a></p>
        <p class="hint">След това презареди страницата и се върни тук.</p>
      </div>`;
    return;
  }

  let list = ERP.products.filter(dsIsDetail);
  if (DS_TERM) { const q = DS_TERM.toLowerCase(); list = list.filter(p => ((p.code || "") + " " + (p.name || "")).toLowerCase().includes(q)); }
  if (DS_ONLY_STOCK) list = list.filter(p => (Number(p.stock) || 0) > 0);
  list.sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0) || (a.name || "").localeCompare(b.name || "", "bg"));

  const totalWith = ERP.products.filter(dsIsDetail).filter(p => (Number(p.stock) || 0) > 0).length;
  erpView().innerHTML = `
    <div class="erp-head-row">
      <h3 class="erp-h">📦 Склад за детайли/полуфабрикати</h3>
      <span class="erp-muted">${totalWith} детайла с наличност</span>
    </div>
    <p class="hint">Тук въвеждаш реалната наличност на готовите детайли/възли. При пускане на заявка системата
      автоматично приспада наличното и праща в цех само недостига.</p>
    <div class="erp-toolbar">
      <input type="search" id="ds-q" placeholder="Търси код или име…" value="${escapeAttr(DS_TERM)}" />
      <label class="erp-inline"><input type="checkbox" id="ds-only" ${DS_ONLY_STOCK ? "checked" : ""} /> само с наличност</label>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Код</th><th>Детайл/възел</th><th class="num">Наличност</th><th>Движение</th></tr></thead>
      <tbody>${list.slice(0, 300).map(p => `
        <tr>
          <td data-label="Код"><b>${escapeHtml(p.code || "")}</b></td>
          <td data-label="Детайл">${escapeHtml(p.name || "")}${p.is_semifinished ? ` <span class="erp-muted">възел</span>` : ""}</td>
          <td class="num" data-label="Наличност"><b class="${(Number(p.stock) || 0) > 0 ? "" : "erp-muted"}">${erpNum(Number(p.stock) || 0)}</b> ${escapeHtml(p.unit || "бр.")}</td>
          <td data-label="Движение">
            <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="заприходяване">＋ заприходи</button>
            <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="изписване">− изпиши</button>
            <button type="button" class="btn btn-small ds-mv" data-id="${p.id}" data-k="корекция">✎ наличност</button>
            <button type="button" class="btn btn-small ds-log" data-id="${p.id}">история</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="4" class="report-empty">Няма детайли по този филтър.</td></tr>`}
      </tbody>
    </table>
    ${list.length > 300 ? `<p class="hint">Показани първите 300. Уточни търсенето.</p>` : ""}`;

  const q = document.getElementById("ds-q");
  if (q) q.addEventListener("input", e => { DS_TERM = e.target.value; erpRenderDetailStock(); });
  const only = document.getElementById("ds-only");
  if (only) only.addEventListener("change", e => { DS_ONLY_STOCK = e.target.checked; erpRenderDetailStock(); });
  erpView().querySelectorAll(".ds-mv").forEach(b => b.addEventListener("click", () => dsMoveDialog(Number(b.dataset.id), b.dataset.k)));
  erpView().querySelectorAll(".ds-log").forEach(b => b.addEventListener("click", () => dsHistory(Number(b.dataset.id))));
}

function dsMoveDialog(pid, kind) {
  const p = ERP.prodById[pid] || {};
  const cur = Number(p.stock) || 0;
  const isCorr = kind === "корекция";
  const title = kind === "заприходяване" ? "Заприходи в склада" : kind === "изписване" ? "Изпиши от склада" : "Задай точна наличност";
  const { wrap, close } = erpDialog(`
    <h3>${title}</h3>
    <p><b>${escapeHtml(p.code || "")}</b> ${escapeHtml(p.name || "")} — сега на склад: <b>${erpNum(cur)}</b> ${escapeHtml(p.unit || "бр.")}</p>
    <label class="erp-inline">${isCorr ? "Нова наличност" : "Брой"}
      <input type="number" id="ds-qty" min="0" step="any" value="${isCorr ? cur : ""}" style="width:120px" autofocus />
    </label>
    <label>Бележка (по избор)<input type="text" id="ds-note" placeholder="напр. партида, дата, причина" /></label>
    <div class="erp-dialog-actions">
      <button class="btn" id="ds-cancel">Отказ</button>
      <button class="btn btn-primary" id="ds-ok">Запиши</button>
    </div>`);
  wrap.querySelector("#ds-cancel").addEventListener("click", close);
  wrap.querySelector("#ds-ok").addEventListener("click", async () => {
    const val = erpToNum(wrap.querySelector("#ds-qty").value);
    const note = (wrap.querySelector("#ds-note").value || "").trim();
    if (isCorr) {
      const delta = val - cur;
      if (!delta) { close(); return; }
      const { error } = await sb.from("product_movements").insert({ product_id: pid, kind: "корекция", quantity: delta, note: note || "Корекция на наличност" });
      if (error) { alert("Грешка: " + error.message); return; }
    } else {
      if (!(val > 0)) { alert("Въведи брой по-голям от 0."); return; }
      const signed = kind === "изписване" ? -val : val;
      const { error } = await sb.from("product_movements").insert({ product_id: pid, kind, quantity: signed, note });
      if (error) { alert("Грешка: " + error.message); return; }
    }
    close();
    await erpLoadAll();
    erpRenderDetailStock();
  });
}

async function dsHistory(pid) {
  const p = ERP.prodById[pid] || {};
  const { data, error } = await sb.from("product_movements").select("kind,quantity,ref,note,created_at").eq("product_id", pid).order("created_at", { ascending: false }).limit(100);
  const rows = error ? [] : (data || []);
  const { wrap, close } = erpDialog(`
    <h3>История · ${escapeHtml(p.code || "")} ${escapeHtml(p.name || "")}</h3>
    <div class="erp-lp-list">
      ${rows.length ? `<table class="report-table erp-table"><thead><tr><th>Дата</th><th>Тип</th><th class="num">Кол.</th><th>Бележка</th></tr></thead>
        <tbody>${rows.map(m => `<tr>
          <td>${escapeHtml((m.created_at || "").slice(0, 10))}</td>
          <td>${escapeHtml(m.kind || "")}</td>
          <td class="num ${Number(m.quantity) < 0 ? "erp-warn" : ""}">${Number(m.quantity) > 0 ? "+" : ""}${erpNum(Number(m.quantity) || 0)}</td>
          <td>${escapeHtml(m.note || m.ref || "")}</td>
        </tr>`).join("")}</tbody></table>` : `<p class="report-empty">Няма движения.</p>`}
    </div>
    <div class="erp-dialog-actions"><button class="btn" id="ds-h-close">Затвори</button></div>`);
  wrap.querySelector("#ds-h-close").addEventListener("click", close);
}
