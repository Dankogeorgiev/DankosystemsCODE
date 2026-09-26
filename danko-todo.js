/* Данко Системс — 📝 Личните To do списъци (под „Добре дошли" + плаващ бутон).
   ВСЕКИ офис профил (isAdmin) има СВОЙ списък и вижда САМО него.
   Хранилище: app_config id = "todo_<имейл>" (исторически: Данко → danko_todo,
   Григор → todo_grigor). Формат: { items: [{id, t, done, at, from?, byCfg?, orig?, notified?}] }.

   ВЪЗЛАГАНЕ (само Данко, Григор и Миро): пишеш „Кажи на Юлия да оправи
   крепежите на ЕГТ" → в списъка на Юлия излиза „от Данко: Юлия, моля те
   оправи крепежите на ЕГТ". Когато тя го отметне, при възложителя излиза
   „✔ Юлия свърши: …". Екраните се опресняват сами на 5 минути + бутон ↻. */

let TODO_ITEMS = null;

const TODO_PEOPLE = {
  "dankog@gmail.com":                { cfg: "danko_todo",  name: "Данко",    boss: true },
  "grigor.baykov@dankosystems.com":  { cfg: "todo_grigor", name: "Григор",   boss: true },
  "miroslav.pilev@dankosystems.com": { cfg: "todo_miro",   name: "Миро",     boss: true },
  "danko.orders@gmail.com":          { cfg: "todo_julia",  name: "Юлия" },
  "office@dankosystems.com":         { cfg: "todo_krisi",  name: "Кристина" },
};
function todoMe() {
  if (typeof MY_ACCESS === "undefined" || !MY_ACCESS || !MY_ACCESS.isAdmin) return null;
  const e = String(MY_ACCESS.email || "").toLowerCase();
  if (!e) return null;
  if (TODO_PEOPLE[e]) return { email: e, ...TODO_PEOPLE[e] };
  // Непознат офис профил → пак си има личен списък, кръстен на имейла.
  return { email: e, cfg: "todo_" + e.replace(/[^a-z0-9]+/g, "_"), name: e.split("@")[0] };
}
function todoAllowed() { return !!todoMe(); }

/* ---------- Облакът ---------- */
async function todoFetch(cfgId) {
  const { data } = await sb.from("app_config").select("data").eq("id", cfgId).maybeSingle();
  return (data && data.data && data.data.items) || [];
}
async function todoStore(cfgId, items) {
  const { error } = await sb.from("app_config")
    .upsert({ id: cfgId, data: { items: items || [] }, updated_at: new Date().toISOString() });
  if (error) throw error;
}
async function todoLoad() {
  const me = todoMe();
  if (!me) return [];
  if (TODO_ITEMS) return TODO_ITEMS;
  try { TODO_ITEMS = await todoFetch(me.cfg); } catch (e) { TODO_ITEMS = []; }
  return TODO_ITEMS;
}
async function todoSave() {
  const me = todoMe();
  if (!me) return;
  try { await todoStore(me.cfg, TODO_ITEMS || []); }
  catch (e) { alert("Грешка при запис на To do: " + (e.message || e)); }
}
/* Пуска запис в чужд списък (възлагане / разписка „свършено"). */
async function todoPushTo(cfgId, item) {
  try {
    const items = await todoFetch(cfgId);
    items.unshift(item);
    await todoStore(cfgId, items);
    return true;
  } catch (e) { alert("Не успях да пратя задачата: " + (e.message || e)); return false; }
}

/* ---------- „Кажи на Юлия да …" ---------- */
function todoParseAssign(text) {
  const me = todoMe();
  if (!me || !me.boss) return null;
  // Хваща и „Кажи на Юлия да оправи…", и „Кажи на Григор: свободен текст"
  // (с двоеточие/запетая/тире след името).
  const m = String(text || "").match(/^\s*кажи\s+на\s+([А-Яа-яA-Za-z]+)\s*[:,\-–—]?\s+(.+)$/i);
  if (!m) return null;
  const who = m[1].toLowerCase();
  const target = Object.entries(TODO_PEOPLE)
    .map(([email, p]) => ({ email, ...p }))
    .find(p => p.name.toLowerCase() === who || p.email.split("@")[0].toLowerCase() === who);
  if (!target || target.email === me.email) return null;
  const rest = m[2].trim();
  // „да оправи…" → задача („моля те оправи…"); свободен текст → предава се дословно.
  const isTask = /^да\s+/i.test(rest);
  const msg = isTask ? `${target.name}, моля те ${rest.replace(/^да\s+/i, "")}` : rest;
  return { target, text: msg, orig: isTask ? rest.replace(/^да\s+/i, "") : rest };
}

/* ---------- Рисуване ---------- */
function todoRenderInto(box) {
  if (!box) return;
  const me = todoMe();
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s));
  const fmtD = iso => {
    const s = String(iso || "").slice(0, 10).split("-");
    return s.length === 3 ? `${s[2]}.${s[1]}.${s[0].slice(2)}` : "";
  };
  const items = (TODO_ITEMS || []).slice()
    .sort((a, b) => (a.done - b.done) || String(b.at || "").localeCompare(String(a.at || "")));
  box.innerHTML = items.map(i => {
    const remind = !i.done && /напомни\s*ми/i.test(i.t || "");
    return `
    <div class="todo-row ${i.done ? "done" : ""}${remind ? " remind" : ""}" data-id="${i.id}">
      <input type="checkbox" class="todo-chk" ${i.done ? "checked" : ""} title="Свършено" />
      <span class="todo-text">${i.from ? `<b class="todo-from">от ${esc(i.from)}:</b> ` : ""}${remind ? "⏰ " : ""}${esc(i.t)}</span>
      <span class="todo-date" title="Записана на">${fmtD(i.at)}</span>
      <button class="todo-del" title="Изтрий">×</button>
    </div>`;
  }).join("") || `<p class="todo-empty">Списъкът е празен — запиши си първата задача.</p>`;
  box.querySelectorAll(".todo-chk").forEach(cb => cb.addEventListener("change", async () => {
    const it = (TODO_ITEMS || []).find(x => String(x.id) === cb.closest(".todo-row").dataset.id);
    if (!it) return;
    it.done = cb.checked ? 1 : 0;
    // Разписка към възложителя: „✔ Юлия свърши: …" (само първия път).
    if (it.done && it.byCfg && !it.notified && me && it.byCfg !== me.cfg) {
      it.notified = 1;
      todoPushTo(it.byCfg, { id: String(Date.now()), t: `✔ ${me.name} свърши: ${it.orig || it.t}`, done: 0, at: new Date().toISOString() });
    }
    await todoSave(); todoRender();
  }));
  box.querySelectorAll(".todo-del").forEach(b => b.addEventListener("click", async () => {
    const id = b.closest(".todo-row").dataset.id;
    TODO_ITEMS = (TODO_ITEMS || []).filter(x => String(x.id) !== id);
    await todoSave(); todoRender();
  }));
}
function todoRender() {
  todoRenderInto(document.getElementById("todo-list"));
  todoRenderInto(document.getElementById("todo-welcome-list"));
}
async function todoRefresh() {
  TODO_ITEMS = null;
  try { await todoLoad(); } catch (e) {}
  todoRender();
}

/* ---------- Добавяне ---------- */
async function todoAdd(inputId) {
  const inp = document.getElementById(inputId || "todo-new");
  if (!inp) return;
  const t = (inp.value || "").trim();
  if (!t) return;
  const me = todoMe();
  // Възлагане: „Кажи на Юлия да …" → отива в НЕЙНИЯ списък.
  const asg = todoParseAssign(t);
  if (asg) {
    const ok = await todoPushTo(asg.target.cfg, {
      id: String(Date.now()), t: asg.text, orig: asg.orig, done: 0,
      at: new Date().toISOString(), from: me.name, byCfg: me.cfg,
    });
    if (ok) {
      inp.value = "";
      inp.placeholder = `✓ изпратено в To do на ${asg.target.name}`;
      setTimeout(() => { inp.placeholder = todoPlaceholder(); }, 2500);
    }
    return;
  }
  TODO_ITEMS = TODO_ITEMS || [];
  TODO_ITEMS.unshift({ id: String(Date.now()), t, done: 0, at: new Date().toISOString() });
  inp.value = "";
  await todoSave(); todoRender();
  inp.focus();
}
function todoPlaceholder() {
  const me = todoMe();
  return me && me.boss ? "Какво имаш да свършиш? (или: Кажи на Юлия да…) Enter добавя" : "Какво имаш да свършиш? Enter добавя";
}

/* Вика се от applyAccess (app.js) след вход. */
async function todoApplyAccess() {
  const fab = document.getElementById("btn-todo");
  const modal = document.getElementById("todo-modal");
  const wcard = document.getElementById("todo-welcome");
  if (!fab || !modal) return;
  const me = todoMe();
  if (!me) { fab.hidden = true; modal.hidden = true; if (wcard) wcard.hidden = true; return; }
  fab.hidden = false;
  if (wcard) wcard.hidden = false;
  const mt = document.getElementById("todo-mtitle"); if (mt) mt.textContent = `📝 To do — ${me.name}`;
  const wt = document.getElementById("todo-wtitle"); if (wt) wt.textContent = `📝 Какво имам да правя (${me.name})`;
  ["todo-new", "todo-new-w"].forEach(id => { const el = document.getElementById(id); if (el) el.placeholder = todoPlaceholder(); });
  TODO_ITEMS = null;
  todoLoad().then(todoRender).catch(() => {});
  // Комуникацията диша: опресняване на всеки 5 минути.
  if (!window._todoTimer) window._todoTimer = setInterval(() => { if (todoMe()) todoRefresh(); }, 5 * 60000);
  if (!fab.dataset.wired) {
    fab.dataset.wired = "1";
    fab.addEventListener("click", async () => {
      modal.hidden = false;
      await todoRefresh();
      const inp = document.getElementById("todo-new");
      if (inp) setTimeout(() => inp.focus(), 50);
    });
    document.getElementById("todo-close").addEventListener("click", () => { modal.hidden = true; });
    document.getElementById("todo-add").addEventListener("click", () => todoAdd("todo-new"));
    document.getElementById("todo-new").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); todoAdd("todo-new"); }
    });
    const wAdd = document.getElementById("todo-add-w"), wInp = document.getElementById("todo-new-w");
    if (wAdd) wAdd.addEventListener("click", () => todoAdd("todo-new-w"));
    if (wInp) wInp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); todoAdd("todo-new-w"); }
    });
    ["todo-refresh", "todo-refresh-w"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", todoRefresh);
    });
  }
}
