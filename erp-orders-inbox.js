/* Данко Системс — ЕРП „📥 Входящи заявки" (пощенската кутия на агента).
   Edge функцията orders-poll чете danko.orders@gmail.com на 5 минути,
   класифицира и разчита писмата и ги пуска тук със статус „за_преглед".
   Човек (Данко/Григор/Таня/Кристина) одобрява: одобрението отваря ПОЗНАТИЯ
   преглед на AI-разчитането (същия като „🤖 Разчети заявка") и оттам се
   ражда стандартна заявка. Отказ/„Не е заявка" само сменят статуса. */

const INBOX_EMAILS = ["dankog@gmail.com", "grigor.baykov@dankosystems.com", "danko.orders@gmail.com", "office@dankosystems.com"];
function inboxAllowed() {
  const e = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && (MY_ACCESS.email || "").toLowerCase()) || "";
  return INBOX_EMAILS.includes(e);
}

let INBOX_LIST = null;
let inboxFilter = "за_преглед";

async function inboxLoad() {
  const { data, error } = await sb.from("orders_inbox").select("*").order("received_at", { ascending: false }).limit(300);
  if (error) throw error;
  INBOX_LIST = data || [];
}
// Броячът за значката (леко: само чакащите).
async function inboxPendingCount() {
  try {
    const { count } = await sb.from("orders_inbox").select("id", { count: "exact", head: true }).eq("status", "за_преглед");
    return Number(count) || 0;
  } catch (e) { return 0; }   // таблицата още не е създадена — тихо
}
async function inboxSetStatus(row, status) {
  const who = (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "";
  const { error } = await sb.from("orders_inbox").update({ status, decided_by: who, decided_at: new Date().toISOString() }).eq("id", row.id);
  if (error) { alert("Грешка: " + error.message); return false; }
  row.status = status;
  return true;
}

const INBOX_ST = {
  "за_преглед": ["⏳ за преглед", "#fef3c7;color:#92400e"],
  "одобрена": ["✅ одобрена", "#dcfce7;color:#166534"],
  "отказана": ["✕ отказана", "#fee2e2;color:#991b1b"],
  "не_е_заявка": ["— не е заявка", "#e2e8f0;color:#475569"],
  "грешка": ["⚠ грешка", "#fee2e2;color:#991b1b"],
};

/* Сръчква агента ВЕДНАГА: вика orders-poll директно, без да чака крона.
   С reparseId („↻ Разчети наново") обработва отначало САМО това писмо
   и презаписва реда му — файлове, разчитане, бележки. */
async function inboxPollNow(reparseId) {
  try {
    const cfg = window.DANKO_CONFIG || {};
    let token = cfg.SUPABASE_ANON_KEY;
    try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/orders-poll", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      body: JSON.stringify(reparseId ? { reparse: reparseId } : {}),
    });
    return await res.json().catch(() => ({}));
  } catch (e) { return { error: String(e && e.message || e) }; }
}

async function erpOrdersInbox(skipPoll) {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане на входящите…</p>`;
  try { await inboxLoad(); }
  catch (e) {
    v.innerHTML = `<div class="erp-error"><h3>Входящите не са настроени</h3><p>${escapeHtml(e.message || String(e))}</p>
      <p class="hint">Пусни <code>orders-inbox-setup.sql</code> в Supabase и деплойни Edge функцията <code>orders-poll</code> (виж указанията).</p>
      <p><button class="btn" id="ib-back0">← Назад</button></p></div>`;
    const b = document.getElementById("ib-back0"); if (b) b.addEventListener("click", erpRenderCustomerOrders);
    return;
  }
  const chip = s => { const c = INBOX_ST[s] || [s, "#e2e8f0"]; return `<span class="erp-co-status" style="background:${c[1].split(";")[0]};${c[1].split(";")[1] || ""}">${c[0]}</span>`; };
  const rows = (INBOX_LIST || []).filter(r => !inboxFilter || r.status === inboxFilter);
  const conf = r => r.confidence == null ? "" : (Number(r.confidence) >= 0.8 ? " 🟢" : Number(r.confidence) >= 0.5 ? " 🟡" : " 🔴");
  const tab = (k, l) => `<button class="btn btn-small ${inboxFilter === k ? "btn-primary" : ""}" data-ibf="${k}">${l}</button>`;
  const cnt = s => (INBOX_LIST || []).filter(r => r.status === s).length;

  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="ib-back">← Назад към заявките</button>
      <span class="erp-count">📥 Входящи заявки — danko.orders@gmail.com</span>
      <span class="erp-muted" id="ib-poll-st"></span>
      <button class="btn btn-small" id="ib-poll" title="Проверява пощата в момента, без да чака автоматичните 5 минути">🔄 Провери пощата</button>
      <span class="spacer"></span>
      ${tab("за_преглед", `⏳ За преглед (${cnt("за_преглед")})`)}
      ${tab("одобрена", "✅")} ${tab("отказана", "✕")} ${tab("не_е_заявка", "—")} ${tab("грешка", "⚠")} ${tab("", "Всички")}
    </div>
    <p class="hint" style="margin:4px 0 8px">Агентът само чете пощата и предлага — заявка в Системата се ражда ЧАК след „✅ Одобри" (отваря познатия преглед с редовете). Жълтите бележки са неща, които Claude не е намерил в писмото.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Получено</th><th>От</th><th>Тема</th><th class="num">Редове</th><th>Бележки</th><th>Статус</th><th></th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr class="erp-clickable" data-ib="${r.id}">
          <td>${r.received_at ? erpDMY(String(r.received_at).slice(0, 10)) + " " + String(r.received_at).slice(11, 16) : "—"}</td>
          <td>${escapeHtml(r.from_name || r.from_email || "—")}<div class="t-code">${escapeHtml(r.from_email || "")}</div></td>
          <td>${escapeHtml(r.subject || "—")}${conf(r)}</td>
          <td class="num">${(r.parsed && r.parsed.lines || []).length || "—"}</td>
          <td class="erp-muted" style="max-width:260px">${escapeHtml((r.notes || r.classify_reason || "").slice(0, 90))}</td>
          <td>${chip(r.status)}</td>
          <td class="erp-row-actions">${r.status === "за_преглед" && inboxAllowed() ? `<button class="btn btn-small btn-primary" data-ibok="${r.id}">✅ Одобри</button>` : ""}</td>
        </tr>`).join("") || `<tr><td colspan="7" class="report-empty">${inboxFilter === "за_преглед" ? "Няма чакащи — пощата е чиста. ✅" : "Няма писма в този статус."}</td></tr>`}
      </tbody>
    </table>`;

  v.querySelector("#ib-back").addEventListener("click", erpRenderCustomerOrders);
  const pollRun = async () => {
    const st = v.querySelector("#ib-poll-st"), pb = v.querySelector("#ib-poll");
    if (pb) pb.disabled = true;
    if (st) st.textContent = "🔄 проверявам пощата…";
    const r = await inboxPollNow();
    if (r && r.error) { if (st) st.textContent = "⚠ " + String(r.error).slice(0, 80); if (pb) pb.disabled = false; return; }
    const fresh = (Number(r && r.orders) || 0) + (Number(r && r.skipped) || 0) + (Number(r && r.errors) || 0);
    if (fresh > 0) { erpOrdersInbox(true); return; }   // има нови редове — пре-зареждаме списъка
    if (st) st.textContent = `✓ проверено · нищо ново (${Number(r && r.checked) || 0} писма прегледани)`;
    if (pb) pb.disabled = false;
  };
  const pollBtn = v.querySelector("#ib-poll");
  if (pollBtn) pollBtn.addEventListener("click", pollRun);
  if (!skipPoll) pollRun();   // отварянето на „📥 Входящи" веднага чука пощата
  v.querySelectorAll("[data-ibf]").forEach(b => b.addEventListener("click", () => { inboxFilter = b.dataset.ibf; erpOrdersInbox(true); }));
  v.querySelectorAll("tr[data-ib]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    const r = INBOX_LIST.find(x => String(x.id) === tr.dataset.ib);
    if (r) inboxDetail(r);
  }));
  v.querySelectorAll("[data-ibok]").forEach(b => b.addEventListener("click", () => {
    const r = INBOX_LIST.find(x => String(x.id) === b.dataset.ibok);
    if (r) inboxApprove(r);
  }));
}

/* Детайлът: парснатото вляво, оригиналът (тяло + файлове) вдясно. */
function inboxDetail(r) {
  const p = r.parsed || {};
  const lines = p.lines || [];
  const filesHtml = (r.files || []).map(f => f.url
    ? `<a class="erp-tag" href="${escapeAttr(f.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(f.name || "файл")}</a>`
    : `<span class="erp-tag" title="${escapeAttr(f.error || "")}">⚠ ${escapeHtml(f.name || "файл")}</span>`).join(" ") || `<span class="erp-muted">няма файлове</span>`;
  const { wrap, close } = erpDialog(`
    <h3>📥 ${escapeHtml(r.subject || "Без тема")}</h3>
    <p class="hint" style="margin:0 0 8px">${escapeHtml(r.from_name || "")} &lt;${escapeHtml(r.from_email || "")}&gt; · ${r.received_at ? erpDMY(String(r.received_at).slice(0, 10)) : ""} · ${escapeHtml(r.classify_reason || "")}${r.confidence != null ? ` · увереност ${Math.round(Number(r.confidence) * 100)}%` : ""}</p>
    ${r.notes ? `<p style="background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:8px;margin:0 0 8px">🟡 ${escapeHtml(r.notes)}</p>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <p style="margin:0 0 4px"><b>Разчетено:</b> ${escapeHtml(p.client_name || "—")}${p.order_no ? " · № " + escapeHtml(String(p.order_no)) : ""}${p.order_date ? " · " + escapeHtml(String(p.order_date)) : ""}</p>
        <div style="max-height:40vh;overflow:auto">
        <table class="report-table erp-table">
          <thead><tr><th>Код</th><th>Артикул</th><th class="num">Бр.</th><th class="num">Цена</th></tr></thead>
          <tbody>${lines.map(l => `<tr><td>${escapeHtml(l.client_code || "—")}</td><td>${escapeHtml(l.client_name || "")}</td><td class="num">${escapeHtml(String(l.quantity != null ? l.quantity : "—"))}</td><td class="num">${escapeHtml(String(l.unit_price != null ? l.unit_price : "—"))}</td></tr>`).join("") || `<tr><td colspan="4" class="report-empty">Claude не извади редове — виж оригинала вдясно.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div>
        <p style="margin:0 0 4px"><b>Оригиналът:</b> ${filesHtml}</p>
        <pre style="max-height:40vh;overflow:auto;white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:12px">${escapeHtml((r.body_text || "").slice(0, 5000) || "— празно тяло —")}</pre>
      </div>
    </div>
    <div class="erp-dialog-actions">
      ${inboxAllowed() && ["за_преглед", "грешка", "не_е_заявка"].includes(r.status) && r.gmail_message_id
        ? `<button class="btn" id="ib-reparse" title="Претегля писмото и файловете от пощата и ги разчита пак (напр. след обновяване на агента)">↻ Разчети наново</button>` : ""}
      ${inboxAllowed() && r.status === "за_преглед" ? `
        <button class="btn" id="ib-notorder">— Не е заявка</button>
        <button class="btn btn-danger" id="ib-reject">✕ Отказ</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="ib-approve">✅ Одобри → преглед на заявката</button>` : `<span class="spacer"></span>`}
      <button class="btn" id="ib-close">Затвори</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#ib-close").addEventListener("click", close);
  const no = wrap.querySelector("#ib-notorder");
  if (no) no.addEventListener("click", async () => { if (await inboxSetStatus(r, "не_е_заявка")) { close(); erpOrdersInbox(true); } });
  const rej = wrap.querySelector("#ib-reject");
  if (rej) rej.addEventListener("click", async () => { if (confirm("Отказ на тази заявка? (остава в архива като отказана)") && await inboxSetStatus(r, "отказана")) { close(); erpOrdersInbox(true); } });
  const ap = wrap.querySelector("#ib-approve");
  if (ap) ap.addEventListener("click", () => { close(); inboxApprove(r); });
  const rp = wrap.querySelector("#ib-reparse");
  if (rp) rp.addEventListener("click", async () => {
    rp.disabled = true; rp.textContent = "🔄 разчитам наново…";
    const res = await inboxPollNow(r.gmail_message_id);
    if (res && res.error) {
      alert("Грешка при преразчитането: " + String(res.error).slice(0, 200));
      rp.disabled = false; rp.textContent = "↻ Разчети наново";
      return;
    }
    close();
    await erpOrdersInbox(true);   // презарежда списъка с новото разчитане
    const fresh = (INBOX_LIST || []).find(x => x.gmail_message_id === r.gmail_message_id);
    if (fresh) inboxDetail(fresh);
  });
}

/* Одобрение: маркира и отваря ПОЗНАТИЯ преглед на AI-разчитането — с мача на
   клиента, „🔎 Продукт", „⚡ Ново" и създаването на стандартна заявка. */
async function inboxApprove(r) {
  if (!inboxAllowed()) { alert("Одобряват Данко, Григор, Таня и Кристина."); return; }
  const p = r.parsed;
  if (!p || !(p.lines || []).length) {
    alert("Claude не е извадил редове от това писмо.\nОтвори файла от детайла и въведи заявката с „🤖 Разчети заявка“ или на ръка — после маркирай писмото като отказано/одобрено.");
    inboxDetail(r);
    return;
  }
  if (!await inboxSetStatus(r, "одобрена")) return;
  try { await erpEnsureLoaded(); if (typeof erpAILoadAliases === "function") await erpAILoadAliases(); } catch (e) {}
  const f0 = (r.files || []).find(f => f.url) || null;
  const fileInfo = f0 ? { name: f0.name, type: f0.type, path: f0.path, url: f0.url } : { name: "имейл: " + (r.subject || ""), type: "text/plain", path: "", url: "" };
  if (typeof erpAIRenderReview === "function") await erpAIRenderReview(p, fileInfo, null);
  else alert("Модулът за преглед не е зареден (erp-ai-orders.js).");
}

/* Значката „📥 Входящи (N)" — вика се от списъка на заявките. */
async function inboxBadge(el) {
  if (!el) return;
  const n = await inboxPendingCount();
  el.textContent = n ? `📥 Входящи (${n})` : "📥 Входящи";
  el.classList.toggle("btn-primary", n > 0);
}
