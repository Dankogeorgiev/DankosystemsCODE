/* Данко Системс — 📝 To do списъкът на Данко (под „Добре дошли").
   Пази се в облака: app_config id="danko_todo" = { items: [{id, t, done, at}] }.
   Вижда се само от Данко (dankog@gmail.com). */

let TODO_ITEMS = null;
const TODO_OWNER = "dankog@gmail.com";

function todoAllowed() {
  return typeof MY_ACCESS !== "undefined" && MY_ACCESS
    && String(MY_ACCESS.email || "").toLowerCase() === TODO_OWNER;
}

async function todoLoad() {
  if (TODO_ITEMS) return TODO_ITEMS;
  try {
    const { data } = await sb.from("app_config").select("data").eq("id", "danko_todo").maybeSingle();
    TODO_ITEMS = (data && data.data && data.data.items) || [];
  } catch (e) { TODO_ITEMS = []; }
  return TODO_ITEMS;
}
async function todoSave() {
  try {
    const { error } = await sb.from("app_config")
      .upsert({ id: "danko_todo", data: { items: TODO_ITEMS || [] }, updated_at: new Date().toISOString() });
    if (error) alert("Грешка при запис на To do: " + error.message);
  } catch (e) { alert("Грешка при запис на To do: " + (e.message || e)); }
}

function todoRender() {
  const box = document.getElementById("todo-list");
  if (!box) return;
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s));
  const items = (TODO_ITEMS || []).slice()
    .sort((a, b) => (a.done - b.done) || String(b.at || "").localeCompare(String(a.at || "")));
  box.innerHTML = items.map(i => `
    <div class="todo-row ${i.done ? "done" : ""}" data-id="${i.id}">
      <input type="checkbox" class="todo-chk" ${i.done ? "checked" : ""} title="Свършено" />
      <span class="todo-text">${esc(i.t)}</span>
      <button class="todo-del" title="Изтрий">×</button>
    </div>`).join("") || `<p class="todo-empty">Списъкът е празен — запиши си първата задача.</p>`;
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

async function todoAdd() {
  const inp = document.getElementById("todo-new");
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
  if (!fab || !modal) return;
  if (!todoAllowed()) { fab.hidden = true; modal.hidden = true; return; }
  fab.hidden = false;
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
    document.getElementById("todo-add").addEventListener("click", todoAdd);
    document.getElementById("todo-new").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); todoAdd(); }
    });
  }
}
