/* Данко Системс — Споделяне на „Ръчна линия за прахово боядисване“
   Същата Supabase сесия като основното приложение. Държи състоянието на
   ръчната линия като ред 'painting_manual_line' в таблица app_config и
   го споделя на живо. Дневните отчети влизат в общия списък
   'painting_reports' (както при автоматичната линия), но с маркер
   line:'ръчна', за да се различават в изгледа „Времена“.

   Логиката на ръчната линия още не е сглобена. За да остане файлът
   независим от бъдещия модел, страницата може да закачи две функции:
     window.MANUAL_LINE.serialize()  -> обект със състоянието за запис
     window.MANUAL_LINE.apply(doc)   -> прилага получено състояние
   Докато ги няма, sync.js само пази входа и предоставя paintSaveReport. */

(function () {
  "use strict";

  const KEY = "painting_manual_line";
  const clientId = "c" + Math.floor(Math.random() * 1e9).toString(36);
  let sbx = null, ready = false, applyingRemote = false, saveTimer = null;

  const $id = id => document.getElementById(id);
  function setSync(t, warn) { const e = $id("sync"); if (e) { e.textContent = t; e.style.color = warn ? "#C0392B" : "#6B7686"; } }

  const hook = () => (typeof window !== "undefined" && window.MANUAL_LINE) || null;

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
    } catch (e) { console.warn("Ръчна линия: запис", e); setSync("грешка при запис", true); }
  }
  function saveSoon() {
    if (applyingRemote || !ready || !sbx) return;
    setSync("запазва…");
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
  }
  // Достъпно за страницата, за да задейства запис при действие.
  window.manualSaveSoon = saveSoon;

  async function load() {
    try {
      const { data, error } = await sbx.from("app_config").select("*").eq("id", KEY).maybeSingle();
      if (error) throw error;
      if (data && data.data) { applyingRemote = true; applyDoc(data.data); applyingRemote = false; setSync("споделено ✓"); }
      else { setSync("ново"); }
    } catch (e) { console.warn("Ръчна линия: зареждане", e); setSync("само локално", true); }
  }
  function subscribe() {
    sbx.channel("painting-manual-line")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_config", filter: "id=eq." + KEY }, p => {
        const d = p.new && p.new.data;
        if (!d || d.by === clientId) return;   // пропусни собственото ехо
        applyingRemote = true; applyDoc(d); applyingRemote = false;
      }).subscribe();
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
    await load();
    subscribe();
  }

  // Записва дневен отчет в общия списък „painting_reports" (изгледа „Времена").
  // Маркира го с line:'ръчна', за да се отличи от автоматичната линия.
  async function saveReport(report) {
    if (!sbx) return false;
    try {
      const tagged = Object.assign({ line: "ръчна" }, report);
      const { data } = await sbx.from("app_config").select("*").eq("id", "painting_reports").maybeSingle();
      const list = (data && data.data && Array.isArray(data.data.list)) ? data.data.list : [];
      list.push(tagged);
      const { error } = await sbx.from("app_config").upsert({ id: "painting_reports", data: { list }, updated_at: new Date().toISOString() });
      if (error) throw error;
      return true;
    } catch (e) { console.warn("Ръчна линия: запис на отчет", e); return false; }
  }
  window.paintSaveReport = saveReport;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
