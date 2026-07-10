/* Данко Системс — „🚚 План за товарене".
   Седмичен план: избор на клиент, стока, килограми, палети и забележка за всяко
   товарене. Започва от седмица 29 (2026). Данните се пазят в app_config
   (id='loading_plan'), без нужда от нов SQL. Ползва глобалния sb и escapeHtml/escapeAttr. */

let LP_ITEMS = [];        // [{ id, week (понеделник YYYY-MM-DD), client, goods, kg, pallets, note, createdAt }]
let LP_CLIENTS = [];      // имена на клиенти (от partners kind=customer)
let LP_MONDAY = null;     // текущо разглеждан понеделник (Date)
let LP_LOADED = false;

/* ---------- ISO седмици ---------- */
function lpMondayOfISOWeek(year, week) {
  // 4 януари винаги е в седмица 1 (ISO 8601).
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7;   // понеделник = 0
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - dow);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}
function lpISOWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);   // най-близкия четвъртък
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return { week, year: date.getUTCFullYear() };
}
function lpMondayStr(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function lpFmtDM(d) {
  const p = n => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}`;
}
function lpAddDays(d, n) { const r = new Date(d); r.setUTCDate(d.getUTCDate() + n); return r; }
function lpToNum(v) {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/\s+/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function lpFmtNum(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toLocaleString("bg-BG");
}

/* ---------- Данни ---------- */
async function lpLoad() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "loading_plan").maybeSingle();
    LP_ITEMS = (data && data.data && Array.isArray(data.data.items)) ? data.data.items : [];
  } catch (e) { console.error("loading load", e); LP_ITEMS = []; }
}
async function lpSave() {
  const { error } = await sb.from("app_config").upsert({ id: "loading_plan", data: { items: LP_ITEMS }, updated_at: new Date().toISOString() });
  if (error) alert("Грешка при запис на плана за товарене: " + error.message);
}
async function lpLoadClients() {
  try {
    const { data } = await sb.from("partners").select("id,name").eq("kind", "customer");
    LP_CLIENTS = [...new Set((data || []).map(p => (p.name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "bg"));
  } catch (e) { LP_CLIENTS = []; }
}

/* ---------- Отваряне ---------- */
async function openLoadingPlan() {
  if (typeof sb === "undefined" || !sb) { alert("Първо влез в приложението."); return; }
  document.getElementById("loading-modal").hidden = false;
  if (!LP_LOADED) {
    await Promise.all([lpLoad(), lpLoadClients()]);
    LP_LOADED = true;
  }
  if (!LP_MONDAY) LP_MONDAY = lpMondayOfISOWeek(2026, 29);   // започваме от седмица 29
  lpRender();
}
function closeLoadingPlan() { document.getElementById("loading-modal").hidden = true; }

/* ---------- Рендиране ---------- */
function lpRender() {
  const v = document.getElementById("loading-view");
  if (!v) return;
  const mondayStr = lpMondayStr(LP_MONDAY);
  const wk = lpISOWeek(LP_MONDAY);
  const sunday = lpAddDays(LP_MONDAY, 6);
  const items = LP_ITEMS.filter(x => x.week === mondayStr)
    .sort((a, b) => (a.client || "").localeCompare(b.client || "", "bg") || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const totKg = items.reduce((s, x) => s + lpToNum(x.kg), 0);
  const totPal = items.reduce((s, x) => s + lpToNum(x.pallets), 0);

  const rows = items.map(x => `
    <tr>
      <td data-label="Клиент"><b>${escapeHtml(x.client || "—")}</b></td>
      <td data-label="Стока">${escapeHtml(x.goods || "")}</td>
      <td class="num" data-label="Кг">${x.kg != null && x.kg !== "" ? lpFmtNum(x.kg) : "—"}</td>
      <td class="num" data-label="Палети">${x.pallets != null && x.pallets !== "" ? lpFmtNum(x.pallets) : "—"}</td>
      <td data-label="Забележка">${escapeHtml(x.note || "")}</td>
      <td class="lp-actions">
        <button class="btn btn-small lp-edit" data-id="${x.id}" title="Редактирай">✎</button>
        <button class="btn btn-small lp-del" data-id="${x.id}" title="Изтрий">×</button>
      </td>
    </tr>`).join("");

  v.innerHTML = `
    <div class="lp-toolbar">
      <button class="btn btn-small" id="lp-prev">◀ предишна</button>
      <div class="lp-weeklabel">Седмица <b>${wk.week}</b> <span class="lp-muted">· ${lpFmtDM(LP_MONDAY)}–${lpFmtDM(sunday)}.${sunday.getUTCFullYear()}</span></div>
      <button class="btn btn-small" id="lp-next">следваща ▶</button>
      <button class="btn btn-small" id="lp-today" title="Върни се на седмица 29">⌂ Седмица 29</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-small btn-primary" id="lp-add">+ Ново товарене</button>
    </div>
    <table class="report-table lp-table">
      <thead><tr><th>Клиент</th><th>Стока</th><th class="num">Кг</th><th class="num">Палети</th><th>Забележка</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="report-empty">Няма товарения за тази седмица. Натисни „+ Ново товарене".</td></tr>`}</tbody>
      ${items.length ? `<tfoot><tr class="lp-total">
        <td>ОБЩО (${items.length} ${items.length === 1 ? "товарене" : "товарения"})</td><td></td>
        <td class="num"><b>${lpFmtNum(totKg)}</b> кг</td>
        <td class="num"><b>${lpFmtNum(totPal)}</b> палети</td>
        <td colspan="2"></td>
      </tr></tfoot>` : ""}
    </table>`;

  v.querySelector("#lp-prev").addEventListener("click", () => { LP_MONDAY = lpAddDays(LP_MONDAY, -7); lpRender(); });
  v.querySelector("#lp-next").addEventListener("click", () => { LP_MONDAY = lpAddDays(LP_MONDAY, 7); lpRender(); });
  v.querySelector("#lp-today").addEventListener("click", () => { LP_MONDAY = lpMondayOfISOWeek(2026, 29); lpRender(); });
  v.querySelector("#lp-add").addEventListener("click", () => lpOpenForm(null));
  v.querySelectorAll(".lp-edit").forEach(b => b.addEventListener("click", () => lpOpenForm(b.dataset.id)));
  v.querySelectorAll(".lp-del").forEach(b => b.addEventListener("click", () => lpDelete(b.dataset.id)));
}

/* ---------- Форма (ново/редакция) ---------- */
function lpOpenForm(id) {
  const editing = id ? LP_ITEMS.find(x => x.id === id) : null;
  const mondayStr = lpMondayStr(LP_MONDAY);
  const wk = lpISOWeek(LP_MONDAY);
  const wrap = document.createElement("div");
  wrap.className = "overlay ask-overlay";
  wrap.innerHTML = `
    <div class="overlay-box ask-box">
      <h3>${editing ? "✎ Редакция на товарене" : "+ Ново товарене"} — седмица ${wk.week}</h3>
      <label>Клиент *
        <input type="text" id="lp-client" list="lp-clients" value="${escapeAttr(editing ? (editing.client || "") : "")}" placeholder="избери или въведи" autocomplete="off" />
        <datalist id="lp-clients">${LP_CLIENTS.map(c => `<option value="${escapeAttr(c)}"></option>`).join("")}</datalist>
      </label>
      <label>Стока (какво се товари)<textarea id="lp-goods" rows="2" placeholder="напр. рафтове, стелажи, детайли…">${escapeHtml(editing ? (editing.goods || "") : "")}</textarea></label>
      <div class="lp-form-row">
        <label>Килограми<input type="number" id="lp-kg" min="0" step="any" inputmode="decimal" value="${escapeAttr(editing && editing.kg != null ? String(editing.kg) : "")}" placeholder="кг" /></label>
        <label>Палети<input type="number" id="lp-pallets" min="0" step="any" inputmode="decimal" value="${escapeAttr(editing && editing.pallets != null ? String(editing.pallets) : "")}" placeholder="бр." /></label>
      </div>
      <label>Забележка<textarea id="lp-note" rows="2" placeholder="по желание — напр. час, транспорт, специфики">${escapeHtml(editing ? (editing.note || "") : "")}</textarea></label>
      <div class="ask-actions">
        <button id="lp-save" class="btn btn-primary">${editing ? "Запази" : "Добави"}</button>
        <button id="lp-cancel" class="btn">Отказ</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#lp-cancel").addEventListener("click", close);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.querySelector("#lp-save").addEventListener("click", async () => {
    const client = wrap.querySelector("#lp-client").value.trim();
    if (!client) { alert("Въведи клиент."); return; }
    const goods = wrap.querySelector("#lp-goods").value.trim();
    const kg = wrap.querySelector("#lp-kg").value.trim();
    const pallets = wrap.querySelector("#lp-pallets").value.trim();
    const note = wrap.querySelector("#lp-note").value.trim();
    const btn = wrap.querySelector("#lp-save"); btn.disabled = true; btn.textContent = "Записва…";
    if (editing) {
      editing.client = client; editing.goods = goods; editing.kg = kg; editing.pallets = pallets; editing.note = note;
    } else {
      LP_ITEMS.push({
        id: "lp_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
        week: mondayStr, client, goods, kg, pallets, note, createdAt: new Date().toISOString(),
      });
    }
    await lpSave();
    close();
    lpRender();
  });
  setTimeout(() => { const c = wrap.querySelector("#lp-client"); if (c) c.focus(); }, 50);
}

async function lpDelete(id) {
  const x = LP_ITEMS.find(i => i.id === id);
  if (!x) return;
  if (!confirm(`Да изтрия ли товаренето за „${x.client || ""}"?`)) return;
  LP_ITEMS = LP_ITEMS.filter(i => i.id !== id);
  await lpSave();
  lpRender();
}

/* ---------- Инициализация ---------- */
function lpInit() {
  const btn = document.getElementById("btn-loading");
  if (btn && !btn._lpWired) { btn._lpWired = true; btn.addEventListener("click", openLoadingPlan); }
  const cl = document.getElementById("loading-close");
  if (cl && !cl._lpWired) { cl._lpWired = true; cl.addEventListener("click", closeLoadingPlan); }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lpInit);
else lpInit();
