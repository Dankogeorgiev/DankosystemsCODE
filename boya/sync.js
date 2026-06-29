/* Данко Системс — Споделяне на „Линия за прахово боядисване“
   Закача се върху приложението от index.html (същите глобални променливи:
   hangerTypes, parts, entries, phi, running и т.н.) и:
     • изисква вход (същата Supabase сесия като основното приложение);
     • пази състоянието на линията като ред 'painting_line' в таблица
       app_config и го споделя на живо (realtime) между всички.
   Записва се при всяко действие (състав, мина +/−, старт/пауза, цвят) +
   лека снимка на всеки 15 сек, докато линията върви. */

(function () {
  "use strict";

  const KEY = "painting_line";
  const clientId = "c" + Math.floor(Math.random() * 1e9).toString(36);
  let sbx = null, ready = false, applyingRemote = false, saveTimer = null, hb = null;

  const $id = id => document.getElementById(id);
  function setSync(t, warn) { const e = $id("sync"); if (e) { e.textContent = t; e.style.color = warn ? "#C0392B" : "#6B7686"; } }

  function serialize() {
    return {
      v: 1, by: clientId, uid,
      hangerTypes, parts, entries, selEntry, paintToday,
      paint: $id("paint").value,
      speed: +$id("speed").value || 45, preview: +$id("preview").value || 60, capacity: +$id("capacity").value || 62,
      phi, runSec, pauseSec, running,
      updatedAt: new Date().toISOString(),
    };
  }
  function applyDoc(d) {
    if (!d) return;
    if (Array.isArray(d.hangerTypes)) hangerTypes = d.hangerTypes;
    if (Array.isArray(d.parts)) parts = d.parts;
    if (Array.isArray(d.entries)) entries = d.entries;
    if (Array.isArray(d.paintToday)) paintToday = d.paintToday;
    selEntry = (d.selEntry != null && entries.some(e => e.id === d.selEntry)) ? d.selEntry : (entries[0] ? entries[0].id : null);
    if (typeof d.uid === "number") uid = Math.max(uid, d.uid);
    phi = +d.phi || 0; runSec = +d.runSec || 0; pauseSec = +d.pauseSec || 0; running = false;
    if (d.paint) $id("paint").value = d.paint;
    if (d.speed) $id("speed").value = d.speed;
    if (d.preview) $id("preview").value = d.preview;
    if (d.capacity) $id("capacity").value = d.capacity;
    const sbtn = $id("startBtn"); if (sbtn) { sbtn.textContent = "▶ Старт"; sbtn.dataset.p = "0"; }
    refresh();
  }

  async function saveNow() {
    if (!sbx || !ready) return;
    const doc = serialize();
    try {
      const { error } = await sbx.from("app_config").upsert({ id: KEY, data: doc, updated_at: doc.updatedAt });
      if (error) throw error;
      setSync("споделено ✓");
    } catch (e) { console.warn("Боядисване: запис", e); setSync("грешка при запис", true); }
  }
  function saveSoon() {
    if (applyingRemote || !ready || !sbx) return;
    setSync("запазва…");
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
  }
  async function load() {
    try {
      const { data, error } = await sbx.from("app_config").select("*").eq("id", KEY).maybeSingle();
      if (error) throw error;
      if (data && data.data) { applyingRemote = true; applyDoc(data.data); applyingRemote = false; setSync("споделено ✓"); }
      else { await saveNow(); }   // първи запис от текущите стойности
    } catch (e) { console.warn("Боядисване: зареждане", e); setSync("само локално", true); }
  }
  function subscribe() {
    sbx.channel("painting-line")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_config", filter: "id=eq." + KEY }, p => {
        const d = p.new && p.new.data;
        if (!d || d.by === clientId) return;   // пропусни собственото ехо
        if (running) return;                   // не прекъсвай оператора, който кара
        applyingRemote = true; applyDoc(d); applyingRemote = false;
      }).subscribe();
  }

  // Записвай при действия. Тези слушатели се добавят СЛЕД тези на
  // приложението, затова при тях състоянието вече е променено.
  const CHANGE_IDS = ["speed", "preview", "capacity", "paint"];
  const CLICK_SEL = "#startBtn,#resetBtn,#fwd,#back,#newColor,#addHanger,#addPart,#addEntry,[data-loadpart],[data-delh],[data-delp],[data-dele]";
  document.addEventListener("input", e => { const t = e.target; if (t.dataset && (t.dataset.h || t.dataset.p || t.dataset.e)) saveSoon(); else if (CHANGE_IDS.includes(t.id)) saveSoon(); });
  document.addEventListener("change", e => { const t = e.target; if ((t.dataset && t.dataset.e && t.dataset.f === "hanger") || t.id === "paint") saveSoon(); });
  document.addEventListener("click", e => { if (e.target.closest && e.target.closest(CLICK_SEL)) saveSoon(); });

  async function start() {
    setSync("зарежда…");
    if (!window.supabase || !window.DANKO_CONFIG) { setSync("само локално", true); return; }
    sbx = window.supabase.createClient(DANKO_CONFIG.SUPABASE_URL, DANKO_CONFIG.SUPABASE_ANON_KEY);
    let session = null;
    try { const r = await sbx.auth.getSession(); session = r.data.session; } catch (e) {}
    if (!session) { $id("gate").hidden = false; setSync("вход", true); return; }
    ready = true;
    await load();
    subscribe();
    if (!hb) hb = setInterval(() => { if (running) saveSoon(); }, 15000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
