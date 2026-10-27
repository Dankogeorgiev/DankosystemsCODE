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
При въпрос „кой доставя / откъде купуваме / кой е доставчикът на X" търси в раздел „Снабдяване" (ръчните описания на доставчици, паспортите и указателя) и отговори direct с името, телефона/имейла, ако ги има. Търси и по част от думата.
Основни модули: „+ Нова мостра/поръчка", Заявки от клиенти (в Склад/ЕРП), Склад/ЕРП (материали, рецепти, покупки, продажби), Цехове (производство — всеки служител отчита бройка и време на своята операция), Производствен отчет, Планиране, Финанси (само за офиса).
Производството върви ПОСЛЕДОВАТЕЛНО: пуска се от бутона „Пусни в производство" в заявката; при сложни изделия всички възли тръгват наведнъж, а всяка следваща операция се появява автоматично, след като предната е отчетена в цеха.`;

// Снабдяването: ръчните описания на доставчици (Заявки за материали),
// паспортите и указателят — за въпроси „кой доставя X". Кешира се 5 мин,
// за да не тежи на всяко съобщение.
let ASST_SUPP_CACHE = null, ASST_SUPP_AT = 0;
async function asstSupplySnapshot() {
  if (ASST_SUPP_CACHE !== null && Date.now() - ASST_SUPP_AT < 5 * 60 * 1000) return ASST_SUPP_CACHE;
  const parts = [];
  const cut = (x, n) => { x = String(x || "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "mat_supplier_desc").maybeSingle();
    const byKey = (data && data.data && data.data.byKey) || {};
    const rows = Object.entries(byKey).filter(([, v]) => v && v.text)
      .map(([k, v]) => `- ${v.name || k}: ${cut(v.text, 180)}`);
    if (rows.length) parts.push("Ръчни описания на доставчици (от Заявки за материали):\n" + rows.slice(0, 80).join("\n"));
  } catch (e) {}
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "supplier_profiles").maybeSingle();
    const byKey = (data && data.data && data.data.byKey) || {};
    const rows = Object.values(byKey).filter(pp => pp && (pp.whatWeBuy || pp.expenseType || pp.email || pp.phone))
      .map(pp => `- ${pp.name}: ${[pp.expenseType, cut(pp.whatWeBuy, 120), pp.person, pp.phone, pp.email].filter(Boolean).join(" · ")}`);
    if (rows.length) parts.push("Паспорти на доставчици (какво купуваме, контакт):\n" + rows.slice(0, 80).join("\n"));
  } catch (e) {}
  try {
    const { data } = await sb.from("contacts").select("data").limit(500);
    const rows = (data || []).map(r => r.data || {}).filter(c => c.company && (c.scope || c.notes))
      .map(c => `- ${c.company} (${c.category || "—"})${c.contact_person ? " · " + c.contact_person : ""}${c.phone ? " · " + c.phone : ""}${c.email ? " · " + c.email : ""}: ${cut([c.scope, c.notes].filter(Boolean).join(" · "), 150)}`);
    if (rows.length) parts.push("Указател Контакти (фирма · категория · лице · какво/бележка):\n" + rows.slice(0, 150).join("\n"));
  } catch (e) {}
  ASST_SUPP_CACHE = parts.length ? "[Снабдяване]\n" + parts.join("\n\n") : "";
  ASST_SUPP_AT = Date.now();
  return ASST_SUPP_CACHE;
}

// Компактна снимка на оперативните данни (без финанси).
async function asstSnapshot() {
  const parts = [];
  try { const sup = await asstSupplySnapshot(); if (sup) parts.push(sup); } catch (e) {}
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
