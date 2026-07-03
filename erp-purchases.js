/* Данко Системс — ЕРП „Покупки" (доставки/фактури).
   Въвеждаш всичко купено (доставчик, № фактура, материали с цени), после
   „заприходяваш" → движения „входящ" в склада + обновяване на средните цени
   (средно-претеглена). Покупката се пази в purchases.data (JSON). */

let erpPurchases = null;

async function erpLoadPurchases() {
  const { data, error } = await sb.from("purchases").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  erpPurchases = (data || []).map(r => ({ id: r.id, posted: r.posted, ...(r.data || {}) }));
}
async function erpSavePurchase(o) {
  const data = { ...o }; delete data.id; delete data.posted;
  if (o.id) {
    const { error } = await sb.from("purchases").update({ data, posted: !!o.posted, updated_at: new Date().toISOString() }).eq("id", o.id);
    if (error) throw error;
  } else {
    const { data: ins, error } = await sb.from("purchases").insert({ data, posted: !!o.posted }).select("id").single();
    if (error) throw error;
    o.id = ins.id;
  }
}
async function erpLoadSuppliers() {
  try {
    const { data } = await erpSelectAll("partners", "id,name", "kind", "supplier");
    return (data || []).map(r => ({ id: r.id, name: r.name })).sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  } catch { return []; }
}

/* ---------- Списък ---------- */
async function erpRenderPurchases() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpLoadPurchases(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя покупките</h3><p>${escapeHtml(e.message || String(e))}</p>` +
      `<p class="hint">Пусни обновения <code>erp-setup.sql</code> (таблица purchases) в Supabase.</p></div>`;
    return;
  }
  const rows = erpPurchases;
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">${rows.length} покупки</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="erp-pu-new">+ Нова покупка</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>№ Фактура</th><th>Доставчик</th><th class="num">Редове</th><th>Статус</th><th></th></tr></thead>
      <tbody>
        ${rows.map(o => `
          <tr class="erp-clickable" data-id="${o.id}">
            <td data-label="Дата">${escapeHtml(o.date || "")}</td>
            <td data-label="№ Фактура">${escapeHtml(o.invoiceNo || "—")}</td>
            <td data-label="Доставчик">${escapeHtml(o.supplierName || "")}</td>
            <td class="num" data-label="Редове">${(o.lines || []).length}</td>
            <td data-label="Статус">${o.posted ? '<span class="erp-co-status" style="background:#dcfce7;color:#166534">заприходена</span>' : '<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">чернова</span>'}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-open="${o.id}">Отвори →</button></td>
          </tr>`).join("") ||
          `<tr><td colspan="6" class="report-empty">Още няма покупки. Натисни „+ Нова покупка".</td></tr>`}
      </tbody>
    </table>`;
  document.getElementById("erp-pu-new").addEventListener("click", erpNewPurchase);
  v.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpOpenPurchase(b.dataset.open); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpOpenPurchase(tr.dataset.id)));
}

function erpNewPurchase() {
  const today = new Date().toISOString().slice(0, 10);
  erpRenderPurchaseForm({ supplierName: "", supplierId: null, invoiceNo: "", date: today, note: "", posted: false, lines: [] });
}
function erpOpenPurchase(id) {
  const o = (erpPurchases || []).find(x => x.id === id);
  if (o) erpRenderPurchaseForm(JSON.parse(JSON.stringify(o)));
}

/* ---------- Форма ---------- */
async function erpRenderPurchaseForm(o) {
  const v = erpView();
  const suppliers = await erpLoadSuppliers();
  const locked = !!o.posted;
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="pu-back">← Назад към покупките</button>
      <span class="spacer"></span>
      ${locked ? '<span class="erp-count">✓ Заприходена — само за преглед</span>'
        : '<button class="btn btn-small" id="pu-save">💾 Запази</button><button class="btn btn-small btn-primary" id="pu-post">📥 Заприходи в склада</button>'}
    </div>
    <div class="erp-co-form">
      <div class="erp-co-grid">
        <label>Доставчик <input type="text" id="pu-supplier" list="pu-suppliers" value="${escapeAttr(o.supplierName || "")}" ${locked ? "disabled" : ""} placeholder="избери или въведи" />
          <datalist id="pu-suppliers">${suppliers.map(s => `<option value="${escapeAttr(s.name)}"></option>`).join("")}</datalist></label>
        <label>№ Фактура <input type="text" id="pu-invoice" value="${escapeAttr(o.invoiceNo || "")}" ${locked ? "disabled" : ""} /></label>
        <label>Дата <input type="date" id="pu-date" value="${escapeAttr(o.date || "")}" ${locked ? "disabled" : ""} /></label>
      </div>
      <label class="erp-co-note">Забележка <textarea id="pu-note" rows="2" ${locked ? "disabled" : ""}>${escapeHtml(o.note || "")}</textarea></label>

      <h4 class="erp-group-head">Купени материали</h4>
      <table class="report-table erp-table" id="pu-lines">
        <thead><tr><th>Код</th><th>Материал</th><th class="num">Количество</th><th class="num">Ед. цена (€)</th><th class="num">Сума</th><th></th></tr></thead>
        <tbody>${erpPuLinesHtml(o, locked)}</tbody>
      </table>
      ${locked ? "" : '<button class="btn btn-small" id="pu-add">+ Добави материал</button>'}
      <p class="hint">Ако не знаеш цената — остави я празна; количеството ще влезе в склада, а средната цена остава непроменена.</p>
      <p class="erp-count" id="pu-total"></p>
    </div>`;

  if (!locked) {
    const bind = (id, k) => { const el = document.getElementById(id); el.addEventListener("input", () => { o[k] = el.value; }); };
    bind("pu-invoice", "invoiceNo"); bind("pu-date", "date"); bind("pu-note", "note");
    document.getElementById("pu-supplier").addEventListener("input", e => {
      o.supplierName = e.target.value;
      const m = suppliers.find(s => s.name === e.target.value); o.supplierId = m ? m.id : null;
    });
    document.getElementById("pu-save").addEventListener("click", () => erpPuSaveClick(o));
    document.getElementById("pu-post").addEventListener("click", () => erpPostPurchase(o));
    document.getElementById("pu-add").addEventListener("click", () => erpPuAddLine(o));
  }
  document.getElementById("pu-back").addEventListener("click", erpRenderPurchases);
  erpPuWireLines(o, locked);
  erpPuTotal(o);
}

function erpPuLinesHtml(o, locked) {
  return (o.lines || []).map((l, i) => `
    <tr>
      <td data-label="Код">${escapeHtml(l.code || "")}</td>
      <td data-label="Материал">${escapeHtml(l.name || "")}</td>
      <td class="num" data-label="Количество">${locked ? erpNum(l.qty) : `<input type="number" class="pu-qty" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.qty || ""))}" style="width:90px" />`}</td>
      <td class="num" data-label="Ед. цена">${locked ? erpEur(l.unitPrice) : `<input type="number" class="pu-price" data-i="${i}" min="0" step="any" value="${escapeAttr(String(l.unitPrice || ""))}" style="width:90px" placeholder="—" />`}</td>
      <td class="num" data-label="Сума">${erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0))}</td>
      <td class="erp-row-actions" data-label="">${locked ? "" : `<button class="btn btn-small" data-rm="${i}">×</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="report-empty">Няма добавени материали.</td></tr>`;
}
function erpPuWireLines(o, locked) {
  if (locked) return;
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  body.querySelectorAll(".pu-qty").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].qty = erpToNum(inp.value); erpPuRefresh(o); }));
  body.querySelectorAll(".pu-price").forEach(inp => inp.addEventListener("input", () => { o.lines[Number(inp.dataset.i)].unitPrice = erpToNum(inp.value); erpPuRefresh(o); }));
  body.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { o.lines.splice(Number(b.dataset.rm), 1); erpPuRefreshFull(o); }));
}
function erpPuRefresh(o) { // само сумите, без загуба на фокус
  const body = document.querySelector("#pu-lines tbody"); if (!body) return;
  body.querySelectorAll("tr").forEach((tr, i) => {
    const l = (o.lines || [])[i]; if (!l) return;
    const sum = tr.querySelector('td[data-label="Сума"]'); if (sum) sum.textContent = erpEur((erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0));
  });
  erpPuTotal(o);
}
function erpPuRefreshFull(o) {
  const body = document.querySelector("#pu-lines tbody"); if (body) { body.innerHTML = erpPuLinesHtml(o, false); erpPuWireLines(o, false); }
  erpPuTotal(o);
}
function erpPuTotal(o) {
  const t = (o.lines || []).reduce((s, l) => s + (erpToNum(l.qty) || 0) * (erpToNum(l.unitPrice) || 0), 0);
  const el = document.getElementById("pu-total"); if (el) el.textContent = "Обща стойност: " + erpEur(t);
}

function erpPuAddLine(o) {
  const { wrap, close } = erpDialog(`
    <h3>Добави материал</h3>
    <input type="search" id="pu-pp-q" placeholder="търси код или име…" />
    <div id="pu-pp-list" class="erp-lp-list"></div>
    <div class="erp-dialog-actions"><button class="btn" id="pu-pp-cancel">Затвори</button></div>`);
  const listEl = wrap.querySelector("#pu-pp-list");
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = ERP.materials.slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    listEl.innerHTML = list.slice(0, 80).map(m =>
      `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">${escapeHtml(m.unit || "")}${m.avg_cost ? " · " + erpEur(m.avg_cost) : ""}</span></button>`).join("")
      || `<p class="report-empty">Няма съвпадения.</p>`;
    listEl.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const m = ERP.matById[Number(b.dataset.id)];
      o.lines = o.lines || [];
      o.lines.push({ materialId: m.id, code: m.code, name: m.name, unit: m.unit, qty: 1, unitPrice: Number(m.avg_cost) || "" });
      close(); erpPuRefreshFull(o);
    }));
  };
  render("");
  wrap.querySelector("#pu-pp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#pu-pp-cancel").addEventListener("click", close);
}

async function erpPuSaveClick(o) {
  const btn = document.getElementById("pu-save");
  if (btn) { btn.disabled = true; btn.textContent = "Записва…"; }
  try { await erpSavePurchase(o); await erpLoadPurchases(); if (btn) { btn.textContent = "✓ Записано"; setTimeout(() => { if (btn) { btn.textContent = "💾 Запази"; btn.disabled = false; } }, 1500); } }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = "💾 Запази"; } alert("Грешка при запис: " + (e.message || e)); }
}

/* ---------- Заприходяване (движения + средни цени) ---------- */
async function erpPostPurchase(o) {
  if (o.posted) { alert("Вече е заприходена."); return; }
  if (!(o.lines || []).length) { alert("Добави поне един материал."); return; }
  if (!confirm(`Да заприходя ли ${o.lines.length} материала в склада? Наличностите ще се вдигнат и средните цени ще се обновят. Това действие се прави веднъж.`)) return;
  try { await erpSavePurchase(o); } catch (e) { alert("Грешка при запис: " + (e.message || e)); return; }

  // Свежи наличности и средни цени преди доставката.
  const [stk, mat] = await Promise.all([
    sb.from("v_material_stock").select("id,stock"),
    sb.from("materials").select("id,avg_cost"),
  ]);
  if (stk.error || mat.error) { alert("Грешка: " + ((stk.error || mat.error).message)); return; }
  const stockById = {}, avgById = {};
  (stk.data || []).forEach(r => stockById[r.id] = Number(r.stock) || 0);
  (mat.data || []).forEach(r => avgById[r.id] = Number(r.avg_cost) || 0);

  const ref = `Фактура ${o.invoiceNo || "—"} · ${o.supplierName || ""}`.trim();
  const moves = [];
  const avgUpdates = [];
  for (const l of o.lines) {
    const qty = erpToNum(l.qty) || 0; if (qty <= 0) continue;
    const price = erpToNum(l.unitPrice) || 0;
    moves.push({ material_id: l.materialId, kind: "входящ", quantity: qty, ref, created_by: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || null });
    if (price > 0) {
      const stock = stockById[l.materialId] || 0, avg = avgById[l.materialId] || 0;
      const newAvg = (stock + qty) > 0 ? (stock * avg + qty * price) / (stock + qty) : price;
      avgById[l.materialId] = newAvg;
      avgUpdates.push({ id: l.materialId, avg: newAvg });
    }
    stockById[l.materialId] = (stockById[l.materialId] || 0) + qty;
  }

  const ins = await sb.from("stock_movements").insert(moves);
  if (ins.error) { alert("Грешка при движенията: " + ins.error.message); return; }
  for (const u of avgUpdates) {
    const { error } = await sb.from("materials").update({ avg_cost: u.avg }).eq("id", u.id);
    if (error) { alert("Грешка при цена: " + error.message); return; }
  }

  o.posted = true; o.postedAt = new Date().toISOString();
  try { await erpSavePurchase(o); } catch {}
  await erpLoadAll();               // опреснява наличности и цени в кеша
  await erpLoadPurchases();
  alert(`Готово! Заприходени ${moves.length} материала. Средните цени са обновени за тези с цена.`);
  erpRenderPurchaseForm(o);
}
