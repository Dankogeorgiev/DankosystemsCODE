/* Данко Системс — 📝 Личен To do списък (под „Добре дошли" + плаващ бутон).
   ВСЕКИ от изброените си има СВОЙ списък и вижда САМО него:
     dankog@gmail.com                  → app_config "danko_todo"  (историческото име)
     grigor.baykov@dankosystems.com    → app_config "todo_grigor"
   Формат: { items: [{id, t, done, at}] }. */

let TODO_ITEMS = null;
const TODO_USERS = {
  "dankog@gmail.com": { cfg: "danko_todo", name: "Данко" },
  "grigor.baykov@dankosystems.com": { cfg: "todo_grigor", name: "Григор" },
};
function todoMe() {
  const e = String((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "").toLowerCase();
  return TODO_USERS[e] || null;
}
function todoAllowed() { return !!todoMe(); }

async function todoLoad() {
  const me = todoMe();
  if (!me) return [];
  if (TODO_ITEMS) return TODO_ITEMS;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", me.cfg).maybeSingle();
    TODO_ITEMS = (data && data.data && data.data.items) || [];
  } catch (e) { TODO_ITEMS = []; }
  return TODO_ITEMS;
}
async function todoSave() {
  const me = todoMe();
  if (!me) return;
  try {
    const { error } = await sb.from("app_config")
      .upsert({ id: me.cfg, data: { items: TODO_ITEMS || [] }, updated_at: new Date().toISOString() });
    if (error) alert("Грешка при запис на To do: " + error.message);
  } catch (e) { alert("Грешка при запис на To do: " + (e.message || e)); }
}

function todoRenderInto(box) {
  if (!box) return;
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s));
  const items = (TODO_ITEMS || []).slice()
    .sort((a, b) => (a.done - b.done) || String(b.at || "").localeCompare(String(a.at || "")));
  const fmtD = iso => {
    const s = String(iso || "").slice(0, 10).split("-");
    return s.length === 3 ? `${s[2]}.${s[1]}.${s[0].slice(2)}` : "";
  };
  box.innerHTML = items.map(i => {
    // „напомни ми" в текста → бележката мига (докато не се отметне).
    const remind = !i.done && /напомни\s*ми/i.test(i.t || "");
    return `
    <div class="todo-row ${i.done ? "done" : ""}${remind ? " remind" : ""}" data-id="${i.id}">
      <input type="checkbox" class="todo-chk" ${i.done ? "checked" : ""} title="Свършено" />
      <span class="todo-text">${remind ? "⏰ " : ""}${esc(i.t)}</span>
      <span class="todo-date" title="Записана на">${fmtD(i.at)}</span>
      <button class="todo-del" title="Изтрий">×</button>
    </div>`;
  }).join("") || `<p class="todo-empty">Списъкът е празен — запиши си първата задача през 📝.</p>`;
  box.querySelectorAll(".todo-chk").forEach(cb => cb.addEventListener("change", async () => {
    const it = (TODO_ITEMS || []).find(x => String(x.id) === cb.closest(".todo-row").dataset.id);
    if (it) { it.done = cb.checked ? 1 : 0; await todoSave(); todoRender(); }
  }));
  box.querySelectorAll(".todo-del").forEach(b => b.addEventListener("click", async () => {
    const id = b.closest(".todo-row").dataset.id;
    TODO_ITEMS = (TODO_ITEMS || []).filter(x => String(x.id) !== id);
    await todoSave(); todoRender();
  }));
}
/* Рисува списъка НАВСЯКЪДЕ, където го има: в прозореца 📝 и под „матрицата". */
function todoRender() {
  todoRenderInto(document.getElementById("todo-list"));
  todoRenderInto(document.getElementById("todo-welcome-list"));
}

async function todoAdd(inputId) {
  const inp = document.getElementById(inputId || "todo-new");
  if (!inp) return;
  const t = (inp.value || "").trim();
  if (!t) return;
  TODO_ITEMS = TODO_ITEMS || [];
  TODO_ITEMS.unshift({ id: String(Date.now()), t, done: 0, at: new Date().toISOString() });
  inp.value = "";
  await todoSave(); todoRender();
  inp.focus();
}

/* Вика се от applyAccess (app.js) след вход: показва плаващия 📝 бутон
   (само за Данко) и закача отварянето на прозореца. */
async function todoApplyAccess() {
  const fab = document.getElementById("btn-todo");
  const modal = document.getElementById("todo-modal");
  const wcard = document.getElementById("todo-welcome");
  if (!fab || !modal) return;
  const me = todoMe();
  if (!me) { fab.hidden = true; modal.hidden = true; if (wcard) wcard.hidden = true; return; }
  fab.hidden = false;
  if (wcard) wcard.hidden = false;
  // Заглавията носят името на човека; списъкът се чете свежо за ТОЗИ профил.
  const mt = document.getElementById("todo-mtitle"); if (mt) mt.textContent = `📝 To do — ${me.name}`;
  const wt = document.getElementById("todo-wtitle"); if (wt) wt.textContent = `📝 Какво имам да правя (${me.name})`;
  TODO_ITEMS = null;
  todoLoad().then(todoRender).catch(() => {});
  if (!fab.dataset.wired) {
    fab.dataset.wired = "1";
    fab.addEventListener("click", async () => {
      modal.hidden = false;
      await todoLoad();
      todoRender();
      const inp = document.getElementById("todo-new");
      if (inp) setTimeout(() => inp.focus(), 50);
    });
    document.getElementById("todo-close").addEventListener("click", () => { modal.hidden = true; });
    document.getElementById("todo-add").addEventListener("click", () => todoAdd("todo-new"));
    document.getElementById("todo-new").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); todoAdd("todo-new"); }
    });
    // Добавяне и ОТ ОСНОВНИЯ ЕКРАН (картата под „матрицата").
    const wAdd = document.getElementById("todo-add-w"), wInp = document.getElementById("todo-new-w");
    if (wAdd) wAdd.addEventListener("click", () => todoAdd("todo-new-w"));
    if (wInp) wInp.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); todoAdd("todo-new-w"); }
    });
  }
}
