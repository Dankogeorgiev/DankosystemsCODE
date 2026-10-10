/* Данко Системс — 🗄 РЕЗЕРВНО КОПИЕ на данните (от браузъра).
   Тегли всички таблици през обикновения клиент и сваля ЕДИН файл на
   компютъра — извън Supabase и извън GitHub. Това е „последната мрежа":
   работи без пароли, без настройки и без достъп до сървъра.
   Файлът е JSON (по избор gzip): { meta, tables: { име: [редове] } }.
   Възстановяването се прави от този файл (или от нощния pg_dump в GitHub).
   Ползва erpSelectAll/erpDialog/escapeHtml/erpDMY. */

// Редът е нарочен: първо номенклатурите, после движенията (за възстановяване).
const BK_TABLES = [
  "app_config", "operations", "materials", "products", "recipe_lines",
  "partners", "contacts", "customer_orders", "samples", "sales", "invoices",
  "purchases", "tasks", "product_movements", "stock_movements",
  "production_log", "messages",
];

function bkBytes(n) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, x = Number(n) || 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return (Math.round(x * 10) / 10) + " " + u[i];
}
function bkToday() { return new Date().toISOString().slice(0, 10); }

/* Кога е правено последното копие (пази се в app_config → backup_log). */
async function erpBackupLastInfo() {
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "backup_log").maybeSingle();
    return (data && data.data) || null;
  } catch (e) { return null; }
}
function bkDaysSince(iso) {
  const t = Date.parse(iso || "");
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

/* Секцията в раздел „Импорт" — състояние + бутон. */
function erpBackupSectionHtml() {
  return `
    <h4 class="erp-group-head">🗄 Резервно копие на данните</h4>
    <div class="erp-toolbar" id="bk-bar">
      <button class="btn btn-small btn-primary" id="bk-run" title="Тегли всички таблици и сваля един файл на компютъра">🗄 Направи резервно копие</button>
      <span class="erp-muted" id="bk-last">…</span>
    </div>
    <p class="hint">Файлът се сваля <b>на този компютър</b> — извън Supabase и извън GitHub. Пази последните няколко на външен диск или в Google Drive. Нощното копие на цялата база се прави автоматично от GitHub (Actions → „Резервно копие на Supabase").</p>`;
}
async function erpBackupWire() {
  const btn = document.getElementById("bk-run");
  if (btn) btn.addEventListener("click", erpBackupRun);
  const el = document.getElementById("bk-last");
  if (!el) return;
  const info = await erpBackupLastInfo();
  if (!info || !info.at) { el.innerHTML = `<span class="erp-warn">⚠ Още няма правено резервно копие оттук.</span>`; return; }
  const d = bkDaysSince(info.at);
  const txt = `Последно копие: <b>${escapeHtml(erpDMY(String(info.at).slice(0, 10)) || "")}</b>`
    + (info.rows ? ` · ${Number(info.rows).toLocaleString("bg-BG")} реда` : "")
    + (info.by ? ` · ${escapeHtml(info.by)}` : "");
  el.innerHTML = (d != null && d > 7) ? `<span class="erp-warn">⚠ ${txt} — преди ${d} дни!</span>` : txt;
}

/* Самото копие: таблица по таблица, с видим напредък. */
async function erpBackupRun() {
  const { wrap, close } = erpDialog(`
    <h3>🗄 Резервно копие на данните</h3>
    <p class="hint" style="margin:-4px 0 8px">Тегля всички таблици. Не затваряй прозореца, докато не свърши.</p>
    <div id="bk-list" class="erp-lp-list" style="max-height:52vh;overflow:auto"></div>
    <div class="erp-dialog-actions"><button class="btn" id="bk-x">Затвори</button></div>`);
  const list = wrap.querySelector("#bk-list");
  const xb = wrap.querySelector("#bk-x");
  xb.addEventListener("click", close);
  xb.disabled = true;

  const out = {};
  let total = 0, failed = [];
  for (const t of BK_TABLES) {
    const row = document.createElement("div");
    row.className = "bk-row";
    row.innerHTML = `<span class="bk-t">${escapeHtml(t)}</span> <span class="bk-s">тегля…</span>`;
    list.appendChild(row);
    row.scrollIntoView({ block: "nearest" });
    try {
      const { data, error } = await erpSelectAll(t, "*");
      if (error) throw error;
      out[t] = data || [];
      total += out[t].length;
      row.querySelector(".bk-s").innerHTML = `<b>${out[t].length.toLocaleString("bg-BG")}</b> реда ✓`;
    } catch (e) {
      out[t] = [];
      failed.push(t);
      row.querySelector(".bk-s").innerHTML = `<span class="erp-warn">пропусната (${escapeHtml(String((e && e.message) || e))})</span>`;
    }
  }

  const meta = {
    app: "Данко Системс — СИСТЕМАТА",
    createdAt: new Date().toISOString(),
    by: (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "",
    project: (window.DANKO_CONFIG && window.DANKO_CONFIG.SUPABASE_URL) || "",
    tables: Object.keys(out).map(k => ({ name: k, rows: out[k].length })),
    totalRows: total,
    failed,
  };
  const json = JSON.stringify({ meta, tables: out });
  const base = `dankosystems-backup-${bkToday()}`;

  // gzip, ако браузърът може (файлът става около 10 пъти по-малък).
  let blob, name;
  try {
    if (typeof CompressionStream === "function") {
      const stream = new Blob([json], { type: "application/json" }).stream().pipeThrough(new CompressionStream("gzip"));
      blob = await new Response(stream).blob();
      name = base + ".json.gz";
    } else throw new Error("no gzip");
  } catch (e) {
    blob = new Blob([json], { type: "application/json" });
    name = base + ".json";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);

  try {
    await sb.from("app_config").upsert({ id: "backup_log", data: { at: meta.createdAt, rows: total, by: meta.by, file: name, tables: meta.tables }, updated_at: new Date().toISOString() });
  } catch (e) {}

  list.insertAdjacentHTML("beforeend", `<div class="bk-done">✅ Готово — <b>${total.toLocaleString("bg-BG")}</b> реда в <b>${escapeHtml(name)}</b> (${bkBytes(blob.size)}).
    ${failed.length ? `<br><span class="erp-warn">⚠ Пропуснати таблици: ${escapeHtml(failed.join(", "))}</span>` : ""}
    <br>Запази файла извън компютъра — външен диск или облак.</div>`);
  xb.disabled = false;
  const el = document.getElementById("bk-last");
  if (el) erpBackupWire();
}
