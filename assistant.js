/* Данко Системс — AI Асистент (Клод).
   Плаващ чат бутон, който отговаря на въпроси за работата със СИСТЕМАТА и за
   текущите оперативни данни (активни заявки, материали под минимум). Ключът
   към Claude стои в Supabase Edge функцията „assistant" — не в браузъра.
   Не показва заплати/маржове/себестойности (те са само за офиса). */

let asstMsgs = [];   // [{ role:'user'|'assistant', text }]
let asstBusy = false;

const ASST_SYSTEM = `Ти си асистентът на „СИСТЕМАТА" — вътрешният софтуер на фирма Данко Системс (металообработване). Помагаш на служителите, докато работят.
Отговаряй кратко, ясно и на български. Ако въпросът е „как се прави нещо" — обясни стъпките в СИСТЕМАТА. Ако е за конкретни данни — ползвай раздела „Текущи данни" по-долу; ако ги нямаш там, кажи честно и посочи къде в СИСТЕМАТА се виждат.
Никога не показвай заплати, маржове и себестойности — те са само за офиса.
Основни модули: „+ Нова мостра/поръчка", Заявки от клиенти (в Склад/ЕРП), Склад/ЕРП (материали, рецепти, покупки, продажби), Цехове (производство — всеки служител отчита бройка и време на своята операция), Производствен отчет, Планиране, Финанси (само за офиса).
Производството върви ПОСЛЕДОВАТЕЛНО: пуска се от бутона „Пусни в производство" в заявката; при сложни изделия всички възли тръгват наведнъж, а всяка следваща операция се появява автоматично, след като предната е отчетена в цеха.`;

// Компактна снимка на оперативните данни (без финанси).
async function asstSnapshot() {
  const parts = [];
  try {
    const { data } = await sb.from("customer_orders").select("data").order("updated_at", { ascending: false }).limit(100);
    const open = (data || []).map(r => r.data || {}).filter(o => (o.status || "нова") !== "завършена");
    if (open.length) parts.push("Активни заявки от клиенти (" + open.length + "):\n" +
      open.slice(0, 60).map(o => `- №${o.ourNo || "?"} · ${o.clientName || "—"} · срок ${o.deadline || "—"} · ${o.status || "нова"} · ${(o.lines || []).length} продукта`).join("\n"));
  } catch (e) {}
  try {
    const { data } = await sb.from("v_material_stock").select("code,name,stock,min_stock").eq("below_min", true).limit(60);
    if (data && data.length) parts.push("Материали под минимум (" + data.length + "):\n" +
      data.map(m => `- ${m.code || ""} ${m.name || ""}: налично ${m.stock}, мин ${m.min_stock}`).join("\n"));
  } catch (e) {}
  return parts.join("\n\n") || "(в момента няма заредени оперативни данни)";
}

async function asstSend() {
  if (asstBusy) return;
  const inp = document.getElementById("asst-input");
  const q = (inp.value || "").trim();
  if (!q) return;
  inp.value = "";
  asstMsgs.push({ role: "user", text: q });
  asstBusy = true; asstRender();
  try {
    const cfg = window.DANKO_CONFIG || {};
    if (!cfg.SUPABASE_URL) throw new Error("Няма връзка с облака.");
    const snap = await asstSnapshot();
    const system = ASST_SYSTEM + "\n\n[Текущи данни]\n" + snap;
    const messages = asstMsgs.map(m => ({ role: m.role, content: m.text }));
    let token = cfg.SUPABASE_ANON_KEY;
    try { const { data } = await sb.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) {}
    const res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token },
      body: JSON.stringify({ system, messages, max_tokens: 1024 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(j.error || ("HTTP " + res.status));
    asstMsgs.push({ role: "assistant", text: j.text || "(празен отговор)" });
  } catch (e) {
    asstMsgs.push({ role: "assistant", text: "⚠ Асистентът не отговори: " + (e.message || e) + "\n\nАко още не е настроен: трябва да се качи Edge функцията assistant в Supabase и да се зададе ANTHROPIC_API_KEY (виж ASSISTANT-SETUP.md)." });
  }
  asstBusy = false; asstRender();
}

function asstRender() {
  const box = document.getElementById("asst-msgs");
  if (!box) return;
  const esc = s => (typeof escapeHtml === "function" ? escapeHtml(s) : String(s));
  const rows = asstMsgs.map(m => `<div class="asst-msg asst-${m.role}">${esc(m.text).replace(/\n/g, "<br>")}</div>`).join("");
  const typing = asstBusy ? `<div class="asst-msg asst-assistant asst-typing">пише…</div>` : "";
  box.innerHTML = (rows + typing) || `<div class="asst-hint">Здравей! 👋 Питай за работата със СИСТЕМАТА — напр.:<br>• „как да пусна поръчка в производство"<br>• „кои материали са под минимум"<br>• „как се отчита бройка в цеха"</div>`;
  box.scrollTop = box.scrollHeight;
  const send = document.getElementById("asst-send"); if (send) send.disabled = asstBusy;
}

function asstToggle() {
  const p = document.getElementById("asst-panel");
  p.hidden = !p.hidden;
  if (!p.hidden) { asstRender(); const i = document.getElementById("asst-input"); if (i) i.focus(); }
}

function asstInit() {
  if (document.getElementById("asst-fab")) return;
  const fab = document.createElement("button");
  fab.id = "asst-fab"; fab.className = "asst-fab"; fab.title = "Асистент (Клод)"; fab.textContent = "🤖";
  fab.style.display = "none";
  document.body.appendChild(fab);
  const panel = document.createElement("div");
  panel.id = "asst-panel"; panel.className = "asst-panel"; panel.hidden = true;
  panel.innerHTML = `
    <div class="asst-head"><b>🤖 Асистент</b><button id="asst-close" class="btn btn-small">✕</button></div>
    <div class="asst-msgs" id="asst-msgs"></div>
    <div class="asst-input-row"><textarea id="asst-input" rows="1" placeholder="Питай нещо…"></textarea><button id="asst-send" class="btn btn-primary btn-small">Изпрати</button></div>`;
  document.body.appendChild(panel);
  fab.addEventListener("click", asstToggle);
  panel.querySelector("#asst-close").addEventListener("click", asstToggle);
  panel.querySelector("#asst-send").addEventListener("click", asstSend);
  panel.querySelector("#asst-input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); asstSend(); } });
  // Показваме бутона само след вход (когато основното приложение е видимо).
  setInterval(() => {
    const main = document.querySelector("main.layout");
    const shown = main && !main.hidden;
    fab.style.display = shown ? "" : "none";
    if (!shown && !panel.hidden) panel.hidden = true;
  }, 800);
}
document.addEventListener("DOMContentLoaded", asstInit);
