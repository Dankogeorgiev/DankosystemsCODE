/* Данко Системс — Споделяне на „Ръчно заваръчно“
   Същата Supabase сесия като основното приложение.

   Този цех чете задачите от общата система „Цехове“ (таблица `tasks`),
   цех „Заваръчно“ — Таня налива там всичко и разпределя кое за коя маса
   (= кой служител). Всяка маса показва задачите, възложени на нейното
   име (assignee). Когато заварчикът отбележи заварено, записваме обратно
   в същата задача (produced + logs), за да се вижда напредъкът в „Цехове“.

   Освен това държи имената/нареждането на 6-те маси като ред
   'welding_rachno_line' в app_config и ги споделя на живо между таблетите.
   Имената на масите се вписват и в общия списък със служители
   (app_config 'workers' → цех „Заваръчно“), за да може Таня да възлага
   задачи към тях от „Цехове“.

   Страницата закача модела чрез:
     window.LINE_STATE.serialize()  -> обект със състоянието (имена на маси)
     window.LINE_STATE.apply(doc)   -> прилага получено състояние
   и ползва window.WELD за данните (задачи / служители). */

(function () {
  "use strict";

  const KEY = "welding_rachno_line";   // ред със състоянието на масите
  const CEX = "Ръчно заваръчно";        // маркер за дневните отчети във „Времена“
  const WS  = "Заваръчно";              // цех в общата система „Цехове“
  const WS_ALIASES = ["Заваръчно", "Заварки"];   // стари имена от ERP
  const clientId = "c" + Math.floor(Math.random() * 1e9).toString(36);
  let sbx = null, ready = false, applyingRemote = false, saveTimer = null;

  const $id = id => document.getElementById(id);
  function setSync(t, warn) { const e = $id("sync"); if (e) { e.textContent = t; e.style.color = warn ? "#C0392B" : "#6B7686"; } }

  const hook = () => (typeof window !== "undefined" && window.LINE_STATE) || null;

  function serialize() {
    const h = hook();
    const state = (h && typeof h.serialize === "function") ? h.serialize() : {};
    return Object.assign({ v: 1, by: clientId }, state, { updatedAt: new Date().toISOString() });
  }
  function applyDoc(d) {
    if (!d) return;
    const h = hook();
    if (h && typeof h.apply === "function") h.apply(d);
  }

  async function saveNow() {
    if (!sbx || !ready) return;
    const doc = serialize();
    try {
      const { error } = await sbx.from("app_config").upsert({ id: KEY, data: doc, updated_at: doc.updatedAt });
      if (error) throw error;
      setSync("споделено ✓");
    } catch (e) { console.warn(CEX + ": запис", e); setSync("грешка при запис", true); }
  }
  function saveSoon() {
    if (applyingRemote || !ready || !sbx) return;
    setSync("запазва…");
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
  }
  window.lineSaveSoon = saveSoon;

  async function loadLine() {
    try {
      const { data, error } = await sbx.from("app_config").select("*").eq("id", KEY).maybeSingle();
      if (error) throw error;
      if (data && data.data) { applyingRemote = true; applyDoc(data.data); applyingRemote = false; setSync("споделено ✓"); }
      else { setSync("ново"); }
    } catch (e) { console.warn(CEX + ": зареждане", e); setSync("само локално", true); }
  }
  function subscribeLine() {
    sbx.channel("welding-rachno-line")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_config", filter: "id=eq." + KEY }, p => {
        const d = p.new && p.new.data;
        if (!d || d.by === clientId) return;   // пропусни собственото ехо
        applyingRemote = true; applyDoc(d); applyingRemote = false;
      }).subscribe();
  }

  /* ---------- Задачи от общата система „Цехове“ (цех „Заваръчно“) ---------- */
  // Зарежда задачите за заваряване. Връща масив от обекти-задачи (със
  // закачено id от реда в базата), точно както ги държи модул „Цехове“.
  async function loadTasks() {
    if (!sbx) return [];
    try {
      const { data, error } = await sbx.from("tasks")
        .select("*").in("data->>workshop", WS_ALIASES)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(r => {
        const t = Object.assign({}, r.data, { id: r.id });
        if (t.workshop === "Заварки") t.workshop = WS;   // нормализирай старото име
        t.files = t.files || [];
        t.logs = t.logs || [];
        return t;
      });
    } catch (e) { console.warn(CEX + ": зареждане на задачи", e); return []; }
  }

  // Записва задача обратно в таблица `tasks` (същия формат като „Цехове“):
  // целият обект отива в data, а `done` се изчислява от бройките.
  async function saveTask(t) {
    if (!sbx || !t || !t.id) return false;
    t.updatedAt = new Date().toISOString();
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    const done = qty > 0 && prod >= qty;
    try {
      const { error } = await sbx.from("tasks").update({ data: t, done, updated_at: t.updatedAt }).eq("id", t.id);
      if (error) throw error;
      return true;
    } catch (e) { console.warn(CEX + ": запис на задача", e); return false; }
  }

  // Абонира за промени по задачите (Таня възлага/добавя → масите се опресняват).
  function subscribeTasks(cb) {
    sbx.channel("welding-rachno-tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => { try { cb && cb(); } catch (e) {} })
      .subscribe();
  }

  /* ---------- Служители в цех „Заваръчно“ (за възлагане от „Цехове“) ---------- */
  // Вписва имената на масите в общия списък със служители, за да може Таня да
  // възлага задачи към тях. Само добавя липсващи имена (не трие нищо).
  async function ensureTableWorkers(names) {
    if (!sbx || !Array.isArray(names) || !names.length) return;
    try {
      const { data } = await sbx.from("app_config").select("*").eq("id", "workers").maybeSingle();
      const cfg = (data && data.data) ? data.data : {};
      const workshops = cfg.workshops || {};
      const list = Array.isArray(workshops[WS]) ? workshops[WS].slice() : [];
      let changed = false;
      names.forEach(nm => { nm = (nm || "").trim(); if (nm && !list.includes(nm)) { list.push(nm); changed = true; } });
      if (!changed) return;
      workshops[WS] = list;
      const next = Object.assign({}, cfg, { workshops });
      await sbx.from("app_config").upsert({ id: "workers", data: next, updated_at: new Date().toISOString() });
    } catch (e) { console.warn(CEX + ": вписване на маси в служители", e); }
  }

  async function start() {
    setSync("зарежда…");
    if (!window.supabase || !window.DANKO_CONFIG) { setSync("само локално", true); return; }
    sbx = window.supabase.createClient(DANKO_CONFIG.SUPABASE_URL, DANKO_CONFIG.SUPABASE_ANON_KEY);
    let session = null;
    try { const r = await sbx.auth.getSession(); session = r.data.session; } catch (e) {}
    if (!session) { $id("gate").hidden = false; setSync("вход", true); return; }
    window.PAINT_USER = (session.user && session.user.email) || "";
    ready = true;
    await loadLine();
    subscribeLine();
    // Подай управлението на страницата (зареждане на задачите и т.н.).
    window.WELD.ready = true;
    try { if (typeof window.WELD.onReady === "function") await window.WELD.onReady(); } catch (e) { console.warn(CEX, e); }
  }

  // Записва дневен отчет в общия списък „painting_reports" (изгледа „Времена").
  // Маркира го с cex:'Ръчно заваръчно', за да се отличи от другите цехове.
  async function saveReport(report) {
    if (!sbx) return false;
    try {
      const tagged = Object.assign({ cex: CEX }, report);
      const { data } = await sbx.from("app_config").select("*").eq("id", "painting_reports").maybeSingle();
      const list = (data && data.data && Array.isArray(data.data.list)) ? data.data.list : [];
      list.push(tagged);
      const { error } = await sbx.from("app_config").upsert({ id: "painting_reports", data: { list }, updated_at: new Date().toISOString() });
      if (error) throw error;
      return true;
    } catch (e) { console.warn(CEX + ": запис на отчет", e); return false; }
  }
  window.paintSaveReport = saveReport;

  // Публичен интерфейс за страницата.
  window.WELD = {
    ready: false,
    onReady: null,             // страницата задава callback, който се вика при готовност
    workshop: WS,
    user: () => window.PAINT_USER || "",
    loadTasks, saveTask, subscribeTasks, ensureTableWorkers,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
