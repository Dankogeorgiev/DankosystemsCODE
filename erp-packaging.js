/* Данко Системс — ЕРП „Опаковки".
   Как се опакова всяко изделие за всеки клиент. Едно и също изделие може да се
   опакова различно за различни клиенти → ключ = наш код + клиент.
   Полета: наш код · клиент · име на продукта според клиента (или № чертеж) ·
   кг за брой · кг за кашон · брой кашони на палет · допълнителни аксесоари.
   Оттук се черпи информацията за Придружаващите документи (Packing List,
   Стокова разписка, Палет опис, транспорт/палети) — виж erpDocLineKg/erpDocAutoRows.
   Пази се в app_config id="packaging": { list:[ {...} ] }.
   Ползва ERP/erpView/erpDialog/escapeHtml/escapeAttr, глобалния sb, erpLoadClients. */

let PACKAGING = null;
let packQuery = "";

async function erpPackLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "packaging").maybeSingle(); PACKAGING = (data && data.data && data.data.list) || []; }
  catch (e) { PACKAGING = []; }
}
async function erpPackSave() {
  const { error } = await sb.from("app_config").upsert({ id: "packaging", data: { list: PACKAGING || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message + (/row-level security|violates/i.test(error.message || "") ? "\n\nПусни app-config-rls-fix.sql в Supabase." : "")); return false; }
  return true;
}
function packNextId() { let m = 0; (PACKAGING || []).forEach(p => { const n = Number(p.id) || 0; if (n > m) m = n; }); return m + 1; }
function packNum(v) { const n = parseFloat(String(v == null ? "" : v).replace(/\s/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; }
function packNorm(s) { return String(s || "").trim().toLowerCase(); }

/* ---------- Търсене на опаковка (ключ: наш код + клиент) ----------
   Първо точно (код + клиент); ако няма — общ запис за кода (без клиент);
   ако и той липсва — единствен запис за кода (ако е само един). Връща spec или null. */
function erpPackFind(code, clientName) {
  if (!PACKAGING || !code) return null;
  const c = packNorm(code), cl = packNorm(clientName);
  let hit = PACKAGING.find(p => packNorm(p.code) === c && packNorm(p.clientName) === cl && cl);
  if (hit) return hit;
  hit = PACKAGING.find(p => packNorm(p.code) === c && !packNorm(p.clientName));
  if (hit) return hit;
  const all = PACKAGING.filter(p => packNorm(p.code) === c);
  return all.length === 1 ? all[0] : null;
}

/* ---------- Списък ---------- */
async function erpRenderPackaging() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await erpPackLoad();
  let clients = [];
  try { if (typeof erpLoadClients === "function") clients = await erpLoadClients(); } catch (e) {}
  const clientNames = clients.map(c => c.company).filter(Boolean);
  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count" id="pack-count"></span>
      <input type="search" id="pack-q" placeholder="🔎 код / клиент / име…" value="${escapeAttr(packQuery)}" style="min-width:220px" autocomplete="off" />
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="pack-new">+ Нова опаковка</button>
    </div>
    <p class="hint">Как се опакова всяко изделие <b>за всеки клиент</b>. Оттук Придружаващите документи (Packing List, Стокова разписка, Палет опис) вземат теглото на брой, кашоните и палетите. Едно изделие може да има различна опаковка за различни клиенти.</p>
    <table class="report-table erp-table">
      <thead><tr>
        <th>Наш код</th><th>Клиент</th><th>Име по клиента / № чертеж</th>
        <th class="num">кг/брой</th><th class="num">кг/кашон</th><th class="num">кашони/палет</th>
        <th>Аксесоари на палета</th><th></th>
      </tr></thead>
      <tbody id="pack-tbody"></tbody>
    </table>
    <datalist id="pack-codes">${(typeof ERP !== "undefined" && ERP.products ? ERP.products : []).slice(0, 4000).map(p => `<option value="${escapeAttr(p.code || "")}">${escapeAttr(p.name || "")}</option>`).join("")}</datalist>
    <datalist id="pack-clients">${clientNames.map(n => `<option value="${escapeAttr(n)}"></option>`).join("")}</datalist>`;
  const qEl = document.getElementById("pack-q");
  if (qEl) qEl.addEventListener("input", e => { packQuery = e.target.value; erpPackFillRows(); });
  document.getElementById("pack-new").addEventListener("click", () => erpPackForm(null));
  erpPackFillRows();
}
// Пълни само тялото (търсене в паметта — без нова заявка).
function erpPackFillRows() {
  const tb = document.getElementById("pack-tbody"); if (!tb) return;
  const q = packNorm(packQuery);
  let rows = (PACKAGING || []).filter(p => !q || `${p.code || ""} ${p.clientName || ""} ${p.clientProductName || ""}`.toLowerCase().includes(q));
  rows.sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "bg") || String(a.clientName || "").localeCompare(String(b.clientName || ""), "bg"));
  const cnt = document.getElementById("pack-count"); if (cnt) cnt.textContent = rows.length + " опаковки";
  const n = v => (v === "" || v == null) ? "" : (typeof erpNum === "function" ? erpNum(v) : v);
  tb.innerHTML = rows.map(p => `<tr class="erp-clickable" data-id="${p.id}">
    <td data-label="Наш код"><b>${escapeHtml(p.code || "")}</b></td>
    <td data-label="Клиент">${escapeHtml(p.clientName || "— (за всички)")}</td>
    <td data-label="Име по клиента">${escapeHtml(p.clientProductName || "")}</td>
    <td class="num" data-label="кг/брой">${n(p.kgPerPiece)}</td>
    <td class="num" data-label="кг/кашон">${n(p.kgPerBox)}</td>
    <td class="num" data-label="кашони/палет">${n(p.boxesPerPallet)}</td>
    <td data-label="Аксесоари">${escapeHtml(p.accessories || "")}</td>
    <td class="erp-row-actions"><button class="btn btn-small" data-edit="${p.id}">✎</button> <button class="btn btn-small btn-danger" data-del="${p.id}">×</button></td>
  </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Няма опаковки. Натисни „+ Нова опаковка".</td></tr>`;
  tb.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackForm((PACKAGING || []).find(x => String(x.id) === String(b.dataset.edit))); }));
  tb.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpPackDelete(Number(b.dataset.del)); }));
  tb.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpPackForm((PACKAGING || []).find(x => String(x.id) === String(tr.dataset.id)))));
}

/* ---------- Форма (добавяне/редакция) ---------- */
function erpPackForm(rec) {
  const isNew = !rec;
  const r = rec ? { ...rec } : { id: null, code: "", clientName: "", clientProductName: "", kgPerPiece: "", kgPerBox: "", boxesPerPallet: "", accessories: "" };
  const { wrap, close } = erpDialog(`
    <h3>${isNew ? "Нова опаковка" : "Редакция на опаковка"}</h3>
    <div class="erp-co-grid">
      <label>Наш код <input type="text" id="pk-code" list="pack-codes" value="${escapeAttr(r.code || "")}" placeholder="напр. 30..." /></label>
      <label>Клиент <input type="text" id="pk-client" list="pack-clients" value="${escapeAttr(r.clientName || "")}" placeholder="празно = за всички клиенти" /></label>
      <label>Име по клиента / № чертеж <input type="text" id="pk-cpname" value="${escapeAttr(r.clientProductName || "")}" placeholder="както клиента поръчва" /></label>
      <label>Килограми за брой <input type="number" id="pk-kgp" step="any" min="0" value="${escapeAttr(String(r.kgPerPiece ?? ""))}" /></label>
      <label>Килограми за кашон <input type="number" id="pk-kgb" step="any" min="0" value="${escapeAttr(String(r.kgPerBox ?? ""))}" /></label>
      <label>Брой кашони на палет <input type="number" id="pk-bpp" step="any" min="0" value="${escapeAttr(String(r.boxesPerPallet ?? ""))}" /></label>
    </div>
    <label class="erp-co-note">Допълнителни аксесоари на палета <input type="text" id="pk-acc" value="${escapeAttr(r.accessories || "")}" placeholder="напр. капак, ъгли, стреч, разделители…" /></label>
    <div class="erp-dialog-actions"><button class="btn" id="pk-cancel">Отказ</button><button class="btn btn-primary" id="pk-save">💾 Запази</button></div>`);
  wrap.querySelector("#pk-cancel").addEventListener("click", close);
  wrap.querySelector("#pk-save").addEventListener("click", async () => {
    const g = id => (wrap.querySelector("#" + id).value || "").trim();
    const code = g("pk-code");
    if (!code) { alert("Въведи наш код."); return; }
    const rc = {
      code, clientName: g("pk-client"), clientProductName: g("pk-cpname"),
      kgPerPiece: packNum(g("pk-kgp")), kgPerBox: packNum(g("pk-kgb")),
      boxesPerPallet: packNum(g("pk-bpp")), accessories: g("pk-acc"),
    };
    if (isNew) {
      // Ако вече има запис за същия код+клиент — обновяваме го, вместо дубликат.
      const ex = (PACKAGING || []).find(p => packNorm(p.code) === packNorm(rc.code) && packNorm(p.clientName) === packNorm(rc.clientName));
      if (ex) Object.assign(ex, rc);
      else (PACKAGING = PACKAGING || []).push({ id: packNextId(), ...rc });
    } else {
      const ex = (PACKAGING || []).find(p => p.id === r.id);
      if (ex) Object.assign(ex, rc);
    }
    if (await erpPackSave()) { close(); erpPackFillRows(); }
  });
}
async function erpPackDelete(id) {
  const p = (PACKAGING || []).find(x => x.id === id); if (!p) return;
  if (!confirm(`Да изтрия ли опаковката за код ${p.code}${p.clientName ? " · " + p.clientName : ""}?`)) return;
  PACKAGING = (PACKAGING || []).filter(x => x.id !== id);
  if (await erpPackSave()) erpPackFillRows();
}

/* ---------- Достъп до опаковката за придружаващите документи ----------
   Използва се от erp-invoices.js (erpDocLineKg/erpDocAutoRows). Гарантира, че
   PACKAGING е зареден дори ако табът „Опаковки" не е отварян в тази сесия. */
async function erpPackEnsureLoaded() { if (!PACKAGING) await erpPackLoad(); }
