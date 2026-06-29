/* Данко Системс — Модул „Линия за прахово боядисване“
   Използва глобалния Supabase клиент (sb). Споделеното състояние на
   линията се пази като един ред в таблица `app_config` (id = 'painting_line'),
   за да го виждат всички в реално време. Фината live-синхронизация на
   движещия се брояч ще се доуточни — засега се записва моментна снимка при
   всяко действие (състав, мина +/−, старт/пауза, смяна на цвят). */

(function () {
  "use strict";

  const PA_KEY = "painting_line";
  const PAL = ['#2C7A8C', '#E07B39', '#8E5BA6', '#4E8A47', '#C0518A', '#B8842B', '#3B6FB0'];

  // ---------- състояние ----------
  let uid = 1; const nid = () => uid++;
  let hangerTypes, parts, entries, selEntry, paintToday;
  let hangers = [];
  let phi = 0, running = false, runSec = 0, pauseSec = 0, last = 0, paused = false;

  let loaded = false, paOpen = false, rafOn = false;
  let saveTimer = null, applyingRemote = false, channel = null, heartbeat = null;
  const clientId = "c" + Math.floor(Math.random() * 1e9).toString(36);

  function defaults() {
    uid = 1;
    hangerTypes = [
      { id: nid(), name: 'Двойна (крака)', rows: 2, color: PAL[0] },
      { id: nid(), name: 'Тройна', rows: 3, color: PAL[1] },
      { id: nid(), name: 'Четворна', rows: 4, color: PAL[2] },
      { id: nid(), name: 'Петторна', rows: 5, color: PAL[3] },
      { id: nid(), name: 'Висяща (тръби)', rows: 1, color: PAL[4] },
    ];
    parts = [
      { id: nid(), name: 'Дребен детайл', perRow: 18 },
      { id: nid(), name: 'Крак', perRow: 9 },
      { id: nid(), name: 'Тръба с планка', perRow: 6 },
    ];
    entries = [
      { id: nid(), hanger: hangerTypes[1].id, part: parts[0].id, count: 30 },
      { id: nid(), hanger: hangerTypes[3].id, part: parts[0].id, count: 5 },
      { id: nid(), hanger: hangerTypes[0].id, part: parts[1].id, count: 25 },
      { id: nid(), hanger: hangerTypes[4].id, part: parts[2].id, count: 5 },
    ];
    selEntry = entries[0].id;
    paintToday = ['#3B6FB0'];
    phi = 0; running = false; runSec = 0; pauseSec = 0; paused = false;
  }

  // ---------- помощни ----------
  const $ = id => document.getElementById(id);
  const root = () => $("painting-modal");
  const H = id => hangerTypes.find(h => h.id === id);
  const P = id => parts.find(p => p.id === id);
  const cap = e => { const h = H(e.hanger), p = P(e.part); return (h && p) ? h.rows * p.perRow : 0; };
  function buildHangers() { hangers = []; entries.forEach(e => { for (let i = 0; i < e.count; i++) hangers.push({ type: e.hanger, part: e.part }); }); if (phi > hangers.length) phi = hangers.length; }
  const L = () => hangers.length;
  const paintedCount = () => Math.max(0, Math.min(L(), Math.floor(phi)));
  const speed = () => +$('pa-speed').value || 45, preview = () => +$('pa-preview').value || 1, PAINT = () => $('pa-paint').value;
  function fmt(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`; }

  // ---------- дефиниции ----------
  function renderHangers() {
    $('pa-hangerList').innerHTML = hangerTypes.map(h => `
      <div class="pa-item"><span class="pa-dot" style="background:${h.color}"></span>
        <input type="text" value="${h.name}" data-h="${h.id}" data-f="name">
        <span class="pa-lab">редове</span><input type="number" value="${h.rows}" data-h="${h.id}" data-f="rows" style="width:44px">
        <button class="btn pa-x" data-delh="${h.id}">×</button></div>`).join('');
  }
  function renderPalette() {
    $('pa-palette').innerHTML = parts.map(p => `
      <div class="pa-chip" data-loadpart="${p.id}">${p.name}
        <span class="pa-pr"><input type="number" value="${p.perRow}" data-p="${p.id}" data-f="perRow" onclick="event.stopPropagation()">/ред</span>
        <span class="btn pa-x" data-delp="${p.id}" onclick="event.stopPropagation()">×</span></div>`).join('');
  }
  const hangerOpts = s => hangerTypes.map(h => `<option value="${h.id}"${h.id === s ? ' selected' : ''}>${h.name}</option>`).join('');
  function renderEntries() {
    $('pa-entryList').innerHTML = entries.map(e => { const h = H(e.hanger), p = P(e.part);
      return `<div class="pa-entry${e.id === selEntry ? ' sel' : ''}" data-sel="${e.id}">
        <input class="pa-cnt" type="number" value="${e.count}" data-e="${e.id}" data-f="count" onclick="event.stopPropagation()">
        <div class="pa-meta"><div class="pa-nm"><span class="pa-dot" style="background:${h ? h.color : '#ccc'}"></span>
          <select data-e="${e.id}" data-f="hanger" onclick="event.stopPropagation()">${hangerOpts(e.hanger)}</select></div>
          <div class="pa-det">детайл: <b>${p ? p.name : '—'}</b> · ${h ? h.rows : 0}×${p ? p.perRow : 0} = ${cap(e)} бр/подв.</div></div>
        <button class="btn pa-x" data-dele="${e.id}" onclick="event.stopPropagation()">×</button></div>`; }).join('');
  }
  function renderColor() {
    const c = $('pa-paint').value; $('pa-paintName').textContent = c.toUpperCase();
    $('pa-paintChanges').textContent = 'смени днес: ' + Math.max(0, paintToday.length - 1);
    $('pa-colordots').innerHTML = paintToday.map(x => `<span class="pa-cd" style="background:${x}"></span>`).join('');
  }

  // ---------- контур ----------
  function drawLoop() {
    const Wd = 820, Hd = 430, cx = Wd / 2, cy = Hd / 2, a = 355, b = 175, boothA = -Math.PI / 2, Lc = L(), step = 2 * Math.PI / Math.max(1, Lc);
    const pos = t => [cx + a * Math.cos(t), cy + b * Math.sin(t)];
    let s = `<svg viewBox="0 0 ${Wd} ${Hd}" font-family="IBM Plex Mono,monospace">`;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${a}" ry="${b}" fill="none" stroke="#C7D0DC" stroke-width="10"/>`;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${a}" ry="${b}" fill="none" stroke="#EAEEF3" stroke-width="6" stroke-dasharray="2 14"/>`;
    for (let k = 0; k < Lc; k++) { const t = boothA - ((k + 1) - phi) * step, [x, y] = pos(t), painted = phi >= k + 1, col = H(hangers[k].type)?.color || '#ccc';
      s += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="7.5" fill="${painted ? PAINT() : '#fff'}" stroke="${painted ? PAINT() : col}" stroke-width="${painted ? 1.4 : 2.4}"/>` +
        `<circle r="2.8" fill="${painted ? '#fff' : col}"/></g>`; }
    const [bx, by] = pos(boothA);
    s += `<g transform="translate(${bx},${by})"><rect x="-34" y="-40" width="68" height="30" rx="6" fill="#1F3864"/>` +
      `<text x="0" y="-20" font-size="12" fill="#fff" text-anchor="middle" font-weight="700">КАБИНА</text>` +
      `<line x1="0" y1="-10" x2="0" y2="2" stroke="#1F3864" stroke-width="2"/><polygon points="-7,2 7,2 4,9 -4,9" fill="${PAINT()}"/></g>`;
    s += `<text x="${cx}" y="${cy - 4}" font-size="26" font-weight="700" fill="#1F3864" text-anchor="middle" font-family="Space Grotesk">${paintedCount()} / ${Lc}</text>`;
    s += `<text x="${cx}" y="${cy + 18}" font-size="12" fill="#6B7686" text-anchor="middle">боядисани</text></svg>`;
    $('pa-loop').innerHTML = s;
  }

  // ---------- обобщение ----------
  function update() {
    if (!loaded) return;
    const Lc = L(), done = paintedCount(), left = Lc - done, capLine = Math.round(+$('pa-capacity').value || 0);
    $('pa-r_done').textContent = done; $('pa-r_pct').textContent = Lc ? Math.round(done / Lc * 100) + '%' : '0%';
    $('pa-r_left').textContent = left;
    const over = Lc - capLine; $('pa-r_cap').textContent = over > 0 ? ('+' + over + ' над капацитет!') : (capLine - Lc) + ' свободни места';
    $('pa-r_cap').className = 'pa-vsub' + (over > 0 ? ' warn' : '');
    $('pa-r_elapsed').textContent = fmt(runSec); $('pa-r_pause').textContent = 'паузи ' + fmt(pauseSec);
    const secPer = 3600 / speed(); $('pa-r_eta').textContent = Lc ? (left ? fmt(left * secPer) : 'готово ✓') : '–';
    const agg = {};
    for (let k = 0; k < Lc; k++) { const h = hangers[k], p = P(h.part); if (!p) continue; const key = p.id;
      if (!agg[key]) agg[key] = { name: p.name, color: H(h.type)?.color || '#ccc', done: 0, left: 0, leftParts: 0 };
      if (phi >= k + 1) agg[key].done++; else { agg[key].left++; agg[key].leftParts += (H(h.type)?.rows || 0) * p.perRow; } }
    $('pa-bdBody').innerHTML = Object.values(agg).map(a =>
      `<tr><td><div class="pa-nm2"><span class="pa-dot" style="background:${a.color}"></span>${a.name}</div></td>` +
      `<td>${a.done}</td><td>${a.left}</td><td><b>${a.leftParts.toLocaleString('bg')}</b></td></tr>`).join('')
      || '<tr><td colspan="4" class="pa-note">няма заредени детайли</td></tr>';
    drawLoop();
  }
  function refresh() { buildHangers(); renderHangers(); renderPalette(); renderEntries(); renderColor(); update(); }

  // ---------- анимация ----------
  function tick(ts) {
    if (!paOpen) { rafOn = false; return; }
    if (!last) last = ts; const dt = (ts - last) / 1000; last = ts;
    if (running) { const sps = speed() / 3600 * preview(); phi += sps * dt; runSec += dt * preview();
      if (paintedCount() >= L()) { running = false; paused = false; setStartLabel(); saveSoon(); } }
    else if (paused) pauseSec += dt * preview();
    update(); requestAnimationFrame(tick);
  }
  function startRaf() { if (!rafOn) { rafOn = true; last = 0; requestAnimationFrame(tick); } }
  function setStartLabel() { $('pa-startBtn').textContent = running ? '❚❚ Пауза (почивка)' : '▶ Старт'; }

  // ---------- Supabase: запис/зареждане/споделяне ----------
  function serialize() {
    return {
      v: 1, by: clientId, uid,
      hangerTypes, parts, entries, selEntry, paintToday,
      paint: $('pa-paint') ? $('pa-paint').value : '#3B6FB0',
      speed: speed(), preview: preview(), capacity: Math.round(+$('pa-capacity').value || 62),
      phi, runSec, pauseSec, running,
      updatedAt: new Date().toISOString(),
    };
  }
  function applyDoc(d) {
    if (!d) return;
    hangerTypes = Array.isArray(d.hangerTypes) ? d.hangerTypes : hangerTypes;
    parts = Array.isArray(d.parts) ? d.parts : parts;
    entries = Array.isArray(d.entries) ? d.entries : entries;
    paintToday = Array.isArray(d.paintToday) ? d.paintToday : (paintToday || ['#3B6FB0']);
    selEntry = d.selEntry != null && entries.some(e => e.id === d.selEntry) ? d.selEntry
      : (entries[0] ? entries[0].id : null);
    if (typeof d.uid === 'number') uid = Math.max(uid, d.uid);
    else { let mx = 0; [].concat(hangerTypes, parts, entries).forEach(o => { if (o && o.id > mx) mx = o.id; }); uid = mx + 1; }
    phi = +d.phi || 0; runSec = +d.runSec || 0; pauseSec = +d.pauseSec || 0;
    running = false; paused = false; // движението не се пуска автоматично при отдалечена промяна
    if ($('pa-paint') && d.paint) $('pa-paint').value = d.paint;
    if ($('pa-speed') && d.speed) $('pa-speed').value = d.speed;
    if ($('pa-preview') && d.preview) $('pa-preview').value = d.preview;
    if ($('pa-capacity') && d.capacity) $('pa-capacity').value = d.capacity;
  }
  function setSync(txt, cls) { const el = $('pa-sync'); if (el) { el.textContent = txt; el.className = 'pa-sync' + (cls ? ' ' + cls : ''); } }

  async function loadFromCloud() {
    if (typeof sb === 'undefined' || !sb) { defaults(); loaded = true; refresh(); setSync('само локално', 'warn'); return; }
    try {
      const { data, error } = await sb.from('app_config').select('*').eq('id', PA_KEY).maybeSingle();
      if (error) throw error;
      if (data && data.data) { applyDoc(data.data); loaded = true; refresh(); setSync('споделено ✓'); }
      else { defaults(); loaded = true; refresh(); await saveNow(); setSync('споделено ✓'); }
    } catch (e) {
      console.warn('Боядисване: грешка при зареждане', e);
      defaults(); loaded = true; refresh(); setSync('само локално', 'warn');
    }
  }
  async function saveNow() {
    if (typeof sb === 'undefined' || !sb || !loaded) return;
    const doc = serialize();
    try {
      const { error } = await sb.from('app_config').upsert({ id: PA_KEY, data: doc, updated_at: doc.updatedAt });
      if (error) throw error;
      setSync('споделено ✓');
    } catch (e) { console.warn('Боядисване: грешка при запис', e); setSync('грешка при запис', 'warn'); }
  }
  function saveSoon() {
    if (applyingRemote || !loaded) return;
    if (typeof sb === 'undefined' || !sb) { setSync('само локално', 'warn'); return; }
    setSync('запазва…');
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700);
  }
  function subscribe() {
    if (channel || typeof sb === 'undefined' || !sb) return;
    channel = sb.channel('painting-line')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_config', filter: 'id=eq.' + PA_KEY }, payload => {
        const d = payload.new && payload.new.data;
        if (!d || d.by === clientId) return;          // пропусни собственото ехо
        if (running) return;                          // не прекъсвай оператора, който кара
        applyingRemote = true; applyDoc(d); refresh(); applyingRemote = false;
      })
      .subscribe();
  }

  // ---------- събития (само в рамките на модала) ----------
  function wire() {
    const r = root(); if (!r || r.dataset.wired) return; r.dataset.wired = '1';

    r.addEventListener('input', e => { const t = e.target;
      if (t.dataset.h) { const h = H(+t.dataset.h); if (t.dataset.f === 'name') h.name = t.value; else h.rows = Math.max(1, +t.value || 1); refresh(); saveSoon(); }
      else if (t.dataset.p) { P(+t.dataset.p).perRow = Math.max(0, +t.value || 0); refresh(); saveSoon(); }
      else if (t.dataset.e && t.dataset.f === 'count') { entries.find(x => x.id === +t.dataset.e).count = Math.max(0, +t.value || 0); refresh(); saveSoon(); }
      else if (['pa-capacity', 'pa-speed', 'pa-preview'].includes(t.id)) { update(); saveSoon(); }
    });
    r.addEventListener('change', e => { const t = e.target;
      if (t.dataset.e && t.dataset.f === 'hanger') { entries.find(x => x.id === +t.dataset.e).hanger = +t.value; refresh(); saveSoon(); }
      if (t.id === 'pa-paint') { paintToday[paintToday.length - 1] = t.value; renderColor(); update(); saveSoon(); }
    });
    r.addEventListener('click', e => { const t = e.target.closest('[data-sel],[data-loadpart],[data-delh],[data-delp],[data-dele]') || e.target;
      if (t.dataset && t.dataset.sel) { selEntry = +t.dataset.sel; renderEntries(); return; }
      if (t.dataset && t.dataset.loadpart) { const en = entries.find(x => x.id === selEntry); if (en) { en.part = +t.dataset.loadpart; refresh(); saveSoon(); } return; }
      if (t.dataset && t.dataset.delh) { hangerTypes = hangerTypes.filter(h => h.id != +t.dataset.delh); refresh(); saveSoon(); return; }
      if (t.dataset && t.dataset.delp) { parts = parts.filter(p => p.id != +t.dataset.delp); refresh(); saveSoon(); return; }
      if (t.dataset && t.dataset.dele) { entries = entries.filter(x => x.id != +t.dataset.dele); refresh(); saveSoon(); return; }
    });

    $('pa-addHanger').onclick = () => { hangerTypes.push({ id: nid(), name: 'Нова подвеска', rows: 3, color: PAL[hangerTypes.length % PAL.length] }); refresh(); saveSoon(); };
    $('pa-addPart').onclick = () => { parts.push({ id: nid(), name: 'Нов детайл', perRow: 10 }); refresh(); saveSoon(); };
    $('pa-addEntry').onclick = () => { const e = { id: nid(), hanger: hangerTypes[0].id, part: parts[0].id, count: 1 }; entries.push(e); selEntry = e.id; refresh(); saveSoon(); };
    $('pa-newColor').onclick = () => { paintToday.push($('pa-paint').value); renderColor(); update(); saveSoon(); };
    $('pa-startBtn').onclick = () => { running = !running; paused = !running; setStartLabel(); saveSoon(); };
    $('pa-resetBtn').onclick = () => { phi = 0; runSec = 0; pauseSec = 0; running = false; paused = false; setStartLabel(); update(); saveSoon(); };
    $('pa-fwd').onclick = () => { phi = Math.min(L(), Math.floor(phi) + 1); update(); saveSoon(); };
    $('pa-back').onclick = () => { phi = Math.max(0, Math.ceil(phi) - 1); update(); saveSoon(); };

    $('painting-close').onclick = closePainting;
    const hb = $('btn-painting'); if (hb) hb.onclick = openPainting;
    const tb = $('tasks-painting'); if (tb) tb.onclick = openPainting;
    window.addEventListener('resize', () => { if (paOpen) update(); });
  }

  // ---------- отваряне/затваряне ----------
  async function openPainting() {
    wire();
    root().hidden = false;
    paOpen = true;
    if (!loaded) { setSync('зарежда…'); await loadFromCloud(); subscribe(); }
    else refresh();
    startRaf();
    // лека периодична снимка, докато върви (за тези, които ще отворят после)
    if (!heartbeat) heartbeat = setInterval(() => { if (paOpen && running) saveSoon(); }, 15000);
  }
  function closePainting() {
    // запиши моментното състояние при затваряне
    if (running) { running = false; paused = false; setStartLabel(); }
    saveNow();
    paOpen = false;
    root().hidden = true;
  }

  // публично (за app.js / tasks.js)
  window.openPainting = openPainting;

  // закачи бутоните възможно най-рано (модалът съществува при зареждане)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
