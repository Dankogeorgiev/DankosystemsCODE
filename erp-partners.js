/* Данко Системс — ЕРП директории „Клиенти" и „Доставчици" (таблица partners).
   Отделни от модул Контакти (за сравнение). Един таб с превключвател между двете. */

let erpPartnerKind = "customer"; // customer | supplier
let erpPartners = null;
let erpPartnerSearch = "";

/* ---------- Полета, които базата още няма (ЕИК/МОЛ) — БЕЗ SQL ----------
   Ако таблицата partners няма колони eik/mol, стойностите се пазят в
   app_config (id = "partners_extra": { byId: { "<id>": {eik, mol} } }) и се
   сливат при зареждане. Така новият клиент се въвежда изцяло от екрана. */
let PT_EXTRA = null;
async function ptExtraLoad() {
  if (PT_EXTRA) return PT_EXTRA;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "partners_extra").maybeSingle();
    PT_EXTRA = (data && data.data && data.data.byId) || {};
  } catch (e) { PT_EXTRA = {}; }
  return PT_EXTRA;
}
async function ptExtraSave(id, fields) {
  if (!id) return;
  await ptExtraLoad();
  const k = String(id);
  const rec = { ...(PT_EXTRA[k] || {}), ...(fields || {}) };
  Object.keys(rec).forEach(f => { if (!rec[f]) delete rec[f]; });
  if (Object.keys(rec).length) PT_EXTRA[k] = rec; else delete PT_EXTRA[k];
  const { error } = await sb.from("app_config")
    .upsert({ id: "partners_extra", data: { byId: PT_EXTRA }, updated_at: new Date().toISOString() });
  if (error) console.warn("partners_extra:", error.message || error);
}
function ptMergeExtra(list) {
  (list || []).forEach(p => {
    const x = PT_EXTRA && PT_EXTRA[String(p.id)];
    if (!x) return;
    if (!p.eik && x.eik) p.eik = x.eik;
    if (!p.mol && x.mol) p.mol = x.mol;
  });
  return list;
}
/* Записва партньор БЕЗ да иска промени по базата: при липсваща колона пробва
   пак без нея и слага стойността в app_config. Връща { id, error }. */
async function erpPartnerSaveSafe(existing, payload) {
  const doSave = async pl => existing
    ? (await sb.from("partners").update(pl).eq("id", existing.id).select("id").single())
    : (await sb.from("partners").insert(pl).select("id").single());
  let res = await doSave(payload);
  if (res.error && /column|schema cache/i.test(res.error.message || "")) {
    const pl2 = { ...payload }; delete pl2.eik; delete pl2.mol;
    res = await doSave(pl2);
    if (!res.error) {
      const id = existing ? existing.id : (res.data && res.data.id);
      try { await ptExtraSave(id, { eik: payload.eik || "", mol: payload.mol || "" }); } catch (e) {}
      return { id, error: null, viaExtra: true };
    }
  }
  if (res.error) return { id: null, error: res.error };
  const id = existing ? existing.id : (res.data && res.data.id);
  // Колоните ги има → чистим стария резервен запис, ако е останал.
  if (PT_EXTRA && PT_EXTRA[String(id)]) { try { await ptExtraSave(id, { eik: "", mol: "" }); } catch (e) {} }
  return { id, error: null };
}

async function erpLoadPartners() {
  const { data, error } = await erpSelectAll("partners", "*");
  if (error) throw error;
  erpPartners = data || [];
  await ptExtraLoad();
  ptMergeExtra(erpPartners);
}

async function erpRenderPartners() {
  const v = erpView();
  if (!erpPartners) {
    v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
    try { await erpLoadPartners(); }
    catch (e) {
      v.innerHTML = `<div class="erp-error"><h3>Не мога да заредя партньорите</h3><p>${escapeHtml(e.message || String(e))}</p>` +
        `<p class="hint">Пусни <code>erp-partners-load.sql</code> в Supabase (създава таблица partners).</p></div>`;
      return;
    }
  }
  const q = erpPartnerSearch.trim().toLowerCase();
  let rows = erpPartners.filter(p => p.kind === erpPartnerKind)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
  if (q) rows = rows.filter(p =>
    ((p.name || "") + " " + (p.person || "") + " " + (p.city || "") + " " + (p.vat || "") + " " + (p.email || "")).toLowerCase().includes(q));

  const cCount = erpPartners.filter(p => p.kind === "customer").length;
  const sCount = erpPartners.filter(p => p.kind === "supplier").length;

  v.innerHTML = `
    <div class="erp-toolbar">
      <div class="erp-seg">
        <button class="erp-seg-btn ${erpPartnerKind === "customer" ? "active" : ""}" data-kind="customer">👤 Клиенти (${cCount})</button>
        <button class="erp-seg-btn ${erpPartnerKind === "supplier" ? "active" : ""}" data-kind="supplier">🏭 Доставчици (${sCount})</button>
      </div>
      <input type="search" id="erp-pt-search" placeholder="търси име, лице, град, ДДС…" value="${escapeAttr(erpPartnerSearch)}" />
      <span class="spacer"></span>
      <span class="erp-count">${rows.length} записа</span>
      <button class="btn btn-small btn-primary" id="erp-pt-add">+ Нов ${erpPartnerKind === "customer" ? "клиент" : "доставчик"}</button>
    </div>
    <table class="report-table erp-table">
      <thead><tr><th>№</th><th>Име</th><th>Лице</th><th>Телефон</th><th>Имейл</th><th>Град</th><th>ДДС №</th><th></th></tr></thead>
      <tbody>
        ${rows.map(p => `
          <tr class="erp-clickable" data-id="${p.id}">
            <td data-label="№">${p.id}</td>
            <td data-label="Име"><b>${escapeHtml(p.name || "")}</b></td>
            <td data-label="Лице">${escapeHtml(p.person || "")}</td>
            <td data-label="Телефон">${escapeHtml(p.phone || "")}</td>
            <td data-label="Имейл">${p.email ? `<a href="mailto:${escapeAttr(p.email)}">${escapeHtml(p.email)}</a>` : ""}</td>
            <td data-label="Град">${escapeHtml(p.city || "")}</td>
            <td data-label="ДДС №">${escapeHtml(p.vat || "")}</td>
            <td class="erp-row-actions" data-label=""><button class="btn btn-small" data-edit="${p.id}">✎</button></td>
          </tr>`).join("") ||
          `<tr><td colspan="8" class="report-empty">Няма записи за този филтър.</td></tr>`}
      </tbody>
    </table>`;

  v.querySelectorAll(".erp-seg-btn").forEach(b => b.addEventListener("click", () => { erpPartnerKind = b.dataset.kind; erpRenderPartners(); }));
  document.getElementById("erp-pt-search").addEventListener("input", e => {
    erpPartnerSearch = e.target.value; erpRenderPartners();
    const el = document.getElementById("erp-pt-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
  document.getElementById("erp-pt-add").addEventListener("click", () => erpEditPartner(null));
  v.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); erpEditPartner(Number(b.dataset.edit)); }));
  v.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => erpEditPartner(Number(tr.dataset.id))));
}

function erpEditPartner(id) {
  const p = id ? (erpPartners || []).find(x => x.id === id) : null;
  const kind = p ? p.kind : erpPartnerKind;
  const lbl = kind === "customer" ? "клиент" : "доставчик";
  const g = (k) => p ? escapeAttr(p[k] || "") : "";
  const { wrap, close } = erpDialog(`
    <h3>${p ? "Редакция на " + lbl : "Нов " + lbl}${p ? ` <span class="erp-muted">№${p.id}</span>` : ""}</h3>
    <label>Име / Фирма<input type="text" id="pt-name" value="${g("name")}" /></label>
    <label>ЕИК / Булстат<input type="text" id="pt-eik" value="${g("eik")}" /></label>
    <label>МОЛ<input type="text" id="pt-mol" value="${g("mol")}" /></label>
    <label>Лице за контакт<input type="text" id="pt-person" value="${g("person")}" /></label>
    <label>Телефон<input type="text" id="pt-phone" value="${g("phone")}" /></label>
    <label>Имейл<input type="text" id="pt-email" value="${g("email")}" /></label>
    <label>Град<input type="text" id="pt-city" value="${g("city")}" /></label>
    <label>Улица / адрес<input type="text" id="pt-street" value="${g("street")}" /></label>
    <label>Държава<input type="text" id="pt-country" value="${p ? escapeAttr(p.country || "") : "BG"}" /></label>
    <label>ДДС №<input type="text" id="pt-vat" value="${g("vat")}" /></label>
    <label>Забележка<input type="text" id="pt-note" value="${g("note")}" /></label>
    <div class="erp-dialog-actions">
      ${p ? '<button class="btn btn-danger" id="pt-del">Изтрий</button>' : ""}
      <span class="spacer" style="flex:1"></span>
      <button class="btn" id="pt-cancel">Отказ</button>
      <button class="btn btn-primary" id="pt-save">Запази</button>
    </div>
    <p class="save-status" id="pt-status"></p>`);
  wrap.querySelector("#pt-cancel").addEventListener("click", close);
  const val = i => wrap.querySelector("#pt-" + i).value.trim() || null;
  wrap.querySelector("#pt-save").addEventListener("click", async () => {
    const name = wrap.querySelector("#pt-name").value.trim();
    if (!name) { wrap.querySelector("#pt-status").textContent = "Въведи име."; return; }
    const payload = { kind, name, person: val("person"), phone: val("phone"), email: val("email"), city: val("city"), street: val("street"), country: val("country"), vat: val("vat"), eik: val("eik"), mol: val("mol"), note: val("note") };
    wrap.querySelector("#pt-status").textContent = "Записва…";
    const { error } = await erpPartnerSaveSafe(p, payload);
    if (error) { wrap.querySelector("#pt-status").textContent = "⚠ " + error.message; return; }
    close(); erpPartners = null; erpRenderPartners();
  });
  const del = wrap.querySelector("#pt-del");
  if (del) del.addEventListener("click", async () => {
    if (!confirm("Да изтрия ли този запис?")) return;
    const { error } = await sb.from("partners").delete().eq("id", p.id);
    if (error) { alert("Грешка: " + error.message); return; }
    close(); erpPartners = null; erpRenderPartners();
  });
}
