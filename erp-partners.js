/* Данко Системс — ЕРП директории „Клиенти" и „Доставчици" (таблица partners).
   Отделни от модул Контакти (за сравнение). Един таб с превключвател между двете. */

let erpPartnerKind = "customer"; // customer | supplier
let erpPartners = null;
let erpPartnerSearch = "";

async function erpLoadPartners() {
  const { data, error } = await erpSelectAll("partners", "*");
  if (error) throw error;
  erpPartners = data || [];
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
    const payload = { kind, name, person: val("person"), phone: val("phone"), email: val("email"), city: val("city"), street: val("street"), country: val("country"), vat: val("vat"), note: val("note") };
    wrap.querySelector("#pt-status").textContent = "Записва…";
    let error;
    if (p) ({ error } = await sb.from("partners").update(payload).eq("id", p.id));
    else ({ error } = await sb.from("partners").insert(payload));
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
