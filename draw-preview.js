/* ---------- 📄 Чертеж при посочване на код — НАВСЯКЪДЕ ----------
   Един модул за всички екрани (Цехове, Планиране, Мастер, ЕРП, цеховите
   приложения). Не зависи от конкретен екран: наблюдава страницата и където
   се появи текст, който е код на изделие/детайл с качен чертеж (или името му
   едно към едно), го „оживява":
     • посочваш с мишката → изскача чертежът (снимка или PDF);
     • на таблет: докосваш кода → изскача; докосване встрани → скрива се;
     • в прозорчето има „отвори ↗" за нов раздел.
   Кликът върху самия код НЕ се прихваща — редовете/бутоните си работят както
   досега.

   Откъде идват чертежите:
     • products.drawings (Склад детайли → 📎) — зарежда се лек списък
       „кои кодове имат чертеж" (id, код, име), а самите файлове се теглят
       чак при посочване и се кешират;
     • app_config quick_items (Нестандартни поръчки) — първият файл по код.
   Списъкът се опреснява на 10 мин, при връщане към раздела и веднага след
   качване на чертеж (DrawPreview.refresh(true)).

   Кратки чисто числови кодове (под 5 знака) се разпознават само в „кодови"
   места (колона Код, .t-code, заглавие на детайл…), за да не се бъркат с
   количества и номера на заявки. Полета за писане, падащи списъци и
   вече обработени места се пропускат. */
(function () {
  "use strict";
  if (window.DrawPreview) return;

  const CODEISH = '.t-code,[data-label="Код"],[data-label="Детайл"],[data-label="Артикул"],[data-label="Продукт"],[data-label="Изделие"],.m-detail-h,.oip-detail-h,.prod-nm,b,strong,th';
  const SKIP = 'script,style,textarea,input,select,option,datalist,[contenteditable],.cs-code,.dp-code,.dp-off,#dp-pop,#cs-pop,svg,iframe,canvas';
  const TOKEN_RE = /[0-9A-Za-zА-Яа-яЁё][0-9A-Za-zА-Яа-яЁё._\-\/]*/g;

  const DP = {
    byCode: {},   // "103839" → { pid, url? , name }
    byName: {},   // "механизъм 3 дроп ин 730…" → { pid, name }
    loaded: false,
    loadedAt: 0,
    cache: {},    // pid → [ {name,type,url} ]
    _sb: null,
    _busy: null,
    _timer: null,
    _queue: new Set(),
  };
  window.DrawPreview = DP;

  const norm = s => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function client() {
    try { if (typeof sb !== "undefined" && sb) return sb; } catch (e) {}
    if (window.sb) return window.sb;
    if (DP._sb) return DP._sb;
    if (window.supabase && window.DANKO_CONFIG && DANKO_CONFIG.SUPABASE_URL && DANKO_CONFIG.SUPABASE_ANON_KEY) {
      try { DP._sb = window.supabase.createClient(DANKO_CONFIG.SUPABASE_URL, DANKO_CONFIG.SUPABASE_ANON_KEY); } catch (e) { DP._sb = null; }
    }
    return DP._sb;
  }

  /* ---- Списък „кои кодове имат чертеж" ---- */
  async function loadIndex(force) {
    if (DP._busy) return DP._busy;
    if (DP.loaded && !force && Date.now() - DP.loadedAt < 5 * 60 * 1000) return true;
    const c = client();
    if (!c) return false;
    DP._busy = (async () => {
      const byCode = {}, byName = {};
      let okAny = false;
      try {
        const CHUNK = 1000;
        for (let from = 0; ; from += CHUNK) {
          const { data, error } = await c.from("products").select("id,code,name")
            .not("drawings", "is", null).neq("drawings", "[]")
            .order("id", { ascending: true }).range(from, from + CHUNK - 1);
          if (error) throw error;
          (data || []).forEach(r => {
            const code = norm(r.code), name = norm(r.name);
            const rec = { pid: Number(r.id), code: String(r.code || "").trim(), name: String(r.name || "").trim() };
            if (code && !byCode[code]) byCode[code] = rec;
            if (name && name.length >= 6 && !byName[name]) byName[name] = rec;
          });
          okAny = true;
          if (!data || data.length < CHUNK) break;
        }
      } catch (e) { console.warn("Чертежи (преглед): списъкът не се зареди —", e && (e.message || e)); }
      try {
        const { data } = await c.from("app_config").select("data").eq("id", "quick_items").maybeSingle();
        const by = (data && data.data && data.data.byId) || {};
        Object.values(by).forEach(e => {
          const code = norm(e.code);
          if (code && !byCode[code] && e.files && e.files[0] && e.files[0].url) {
            byCode[code] = { pid: null, code: String(e.code).trim(), name: String(e.name || "").trim(), files: e.files.filter(f => f && f.url) };
          }
        });
        okAny = true;
      } catch (e) {}
      if (okAny) {
        DP.byCode = byCode; DP.byName = byName;
        DP.loaded = true; DP.loadedAt = Date.now();
        if (force) DP.cache = {};
      }
      DP._busy = null;
      return okAny;
    })();
    return DP._busy;
  }

  /* ---- Разпознаване в текста ---- */
  function lookupToken(tok, codeish) {
    const k = norm(tok);
    if (!k) return null;
    const rec = DP.byCode[k];
    if (!rec) return null;
    if (!codeish && /^\d+$/.test(k) && k.length < 5) return null;
    return rec;
  }

  function makeSpan(text, rec) {
    const s = document.createElement("span");
    s.className = "dp-code";
    s.dataset.code = rec.code;
    if (rec.pid) s.dataset.pid = String(rec.pid);
    s.title = `Чертеж на ${rec.code || rec.name} — посочи за преглед`;
    s.textContent = text;
    return s;
  }

  function processTextNode(n) {
    const v = n.nodeValue;
    if (!v || v.length < 2) return;
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    const whole = norm(v);
    if (!whole) return;
    // 1) Цялата клетка/етикет е точно код или точно име на изделие.
    const codeish = !!p.closest(CODEISH);
    let rec = lookupToken(whole, codeish);
    if (!rec && DP.byName[whole]) {
      // Име едно към едно: само ако кодът не стои и без това наблизо (иначе маркираме кода).
      const r = DP.byName[whole], box = p.closest("td,li,tr,.card,.row,div") || p;
      if (!r.code || !norm(box.textContent).includes(norm(r.code))) rec = r;
    }
    if (rec) {
      const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
      const frag = document.createDocumentFragment();
      if (lead) frag.appendChild(document.createTextNode(lead));
      frag.appendChild(makeSpan(v.trim(), rec));
      if (trail) frag.appendChild(document.createTextNode(trail));
      n.parentNode.replaceChild(frag, n);
      return;
    }
    // 2) Кодът е част от по-дълъг текст („🔩 103839 Механизъм…").
    if (!/[0-9A-Za-zА-Яа-я]/.test(v)) return;
    TOKEN_RE.lastIndex = 0;
    let m, last = 0, frag = null;
    while ((m = TOKEN_RE.exec(v))) {
      let tok = m[0], start = m.index;
      // Махаме крайна пунктуация („103839.", „103839,").
      while (tok.length > 1 && /[.,\/\-]$/.test(tok)) tok = tok.slice(0, -1);
      const r = lookupToken(tok, codeish);
      if (!r) continue;
      // Не късаме числа: „1103839" или „103839.5" не са кодът.
      const before = v[start - 1], after = v[start + tok.length];
      if (before && /[0-9A-Za-zА-Яа-я.,]/.test(before)) continue;
      if (after && /[0-9A-Za-zА-Яа-я]/.test(after)) continue;
      if (after && /[.,]/.test(after) && /[0-9]/.test(v[start + tok.length + 1] || "")) continue;
      if (!frag) frag = document.createDocumentFragment();
      if (start > last) frag.appendChild(document.createTextNode(v.slice(last, start)));
      frag.appendChild(makeSpan(tok, r));
      last = start + tok.length;
    }
    if (frag) {
      if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)));
      n.parentNode.replaceChild(frag, n);
    }
  }

  function scan(root) {
    if (!DP.loaded || !root) return;
    if (root.nodeType === Node.TEXT_NODE) { processTextNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && (root.matches(SKIP) || root.closest(SKIP))) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || v.length < 2 || !/[0-9A-Za-zА-Яа-я]/.test(v)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    if (nodes.length > 20000) nodes.length = 20000;
    nodes.forEach(processTextNode);
  }

  function schedule(node) {
    if (node) DP._queue.add(node);
    clearTimeout(DP._timer);
    DP._timer = setTimeout(() => {
      const items = [...DP._queue]; DP._queue.clear();
      if (!DP.loaded) return;
      // Ако е сменен целият екран — сканираме тялото веднъж, вместо хиляди възли поотделно.
      if (items.length > 400 || items.some(x => x === document.body)) { scan(document.body); return; }
      items.forEach(x => { if (x.isConnected) scan(x); });
    }, 200);
  }

  function observe() {
    if (!document.body) { document.addEventListener("DOMContentLoaded", observe, { once: true }); return; }
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === "characterData") { if (m.target && m.target.parentElement) schedule(m.target.parentElement); continue; }
        m.addedNodes && m.addedNodes.forEach(nd => {
          if (nd.nodeType === Node.ELEMENT_NODE) { if (!nd.matches(SKIP)) schedule(nd); }
          else if (nd.nodeType === Node.TEXT_NODE && nd.parentElement) schedule(nd.parentElement);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    scan(document.body);
  }

  /* ---- Файловете на конкретно изделие (лениво, с кеш) ---- */
  async function filesFor(rec) {
    if (!rec) return [];
    if (!rec.pid) return rec.files || [];
    if (DP.cache[rec.pid]) return DP.cache[rec.pid];
    const c = client();
    if (!c) return [];
    try {
      const { data } = await c.from("products").select("drawings").eq("id", rec.pid).maybeSingle();
      const list = (data && Array.isArray(data.drawings)) ? data.drawings.filter(d => d && d.url) : [];
      DP.cache[rec.pid] = list;
      return list;
    } catch (e) { return []; }
  }
  function kindOf(d) {
    const t = String(d.type || "").toLowerCase(), u = String(d.url || d.name || "").toLowerCase().split("?")[0];
    if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(u)) return "image";
    if (t === "application/pdf" || /\.pdf$/.test(u)) return "pdf";
    return "other";
  }

  /* ---- Прозорчето ---- */
  let popTimer = null, curEl = null, seq = 0;
  function pop() {
    let el = document.getElementById("dp-pop");
    if (!el) {
      el = document.createElement("div"); el.id = "dp-pop"; el.hidden = true;
      el.addEventListener("mouseenter", () => clearTimeout(popTimer));
      el.addEventListener("mouseleave", () => hide(false));
      document.body.appendChild(el);
    }
    return el;
  }
  function place(el, anchor) {
    const r = anchor.getBoundingClientRect();
    const W = Math.min(540, window.innerWidth - 16), H = Math.min(460, window.innerHeight - 16);
    let x = r.right + 12, y = r.top - 10;
    if (x + W > window.innerWidth - 8) x = Math.max(8, r.left - W - 12);
    if (x + W > window.innerWidth - 8) x = Math.max(8, window.innerWidth - W - 8);
    if (y + H > window.innerHeight - 8) y = Math.max(8, window.innerHeight - H - 8);
    el.style.left = x + "px"; el.style.top = y + "px";
  }
  async function show(anchor) {
    clearTimeout(popTimer);
    const code = anchor.dataset.code;
    const rec = DP.byCode[norm(code)] || Object.values(DP.byName).find(r => r.pid && String(r.pid) === anchor.dataset.pid);
    if (!rec) return;
    curEl = anchor;
    const my = ++seq;
    const el = pop();
    el.innerHTML = `<div class="dp-pop-h"><b>${esc(rec.code)}</b> ${esc(rec.name || "")}<span class="dp-pop-x" title="затвори">✕</span></div><div class="dp-pop-wait">зареждане на чертежа…</div>`;
    el.hidden = false;
    place(el, anchor);
    const list = await filesFor(rec);
    if (my !== seq || el.hidden) return;
    if (!list.length) { el.innerHTML = `<div class="dp-pop-h"><b>${esc(rec.code)}</b> ${esc(rec.name || "")}<span class="dp-pop-x" title="затвори">✕</span></div><div class="dp-pop-other">няма качен чертеж</div>`; return; }
    const d = list[0], kind = kindOf(d);
    const more = list.length > 1 ? `<div class="dp-pop-more">+ още ${list.length - 1}: ${list.slice(1).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name || "файл")}</a>`).join(" · ")}</div>` : "";
    el.innerHTML = `<div class="dp-pop-h"><span><b>${esc(rec.code)}</b> ${esc(rec.name || "")}</span><span><a href="${esc(d.url)}" target="_blank" rel="noopener">отвори ↗</a> <span class="dp-pop-x" title="затвори">✕</span></span></div>`
      + (kind === "image" ? `<a href="${esc(d.url)}" target="_blank" rel="noopener"><img src="${esc(d.url)}" alt="" /></a>`
        : kind === "pdf" ? `<iframe src="${esc(d.url)}#toolbar=0&navpanes=0&view=FitH" title="чертеж"></iframe>`
        : `<div class="dp-pop-other">📎 ${esc(d.name || "файл")} — <a href="${esc(d.url)}" target="_blank" rel="noopener">отвори</a></div>`)
      + `<div class="dp-pop-f">${esc(d.name || "")}</div>` + more;
    place(el, anchor);
  }
  function hide(now) {
    clearTimeout(popTimer);
    const f = () => { const el = document.getElementById("dp-pop"); if (el) { el.hidden = true; el.innerHTML = ""; } curEl = null; };
    if (now) f(); else popTimer = setTimeout(f, 250);
  }

  function wireEvents() {
    document.addEventListener("mouseover", e => {
      const t = e.target && e.target.closest && e.target.closest(".dp-code");
      if (!t) return;
      if (curEl === t) { clearTimeout(popTimer); return; }
      clearTimeout(popTimer);
      popTimer = setTimeout(() => show(t), 120);
    });
    document.addEventListener("mouseout", e => {
      const t = e.target && e.target.closest && e.target.closest(".dp-code");
      if (!t) return;
      hide(false);
    });
    // Таблет/телефон: докосване на кода показва; докосване встрани — скрива.
    document.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch") return;
      const t = e.target && e.target.closest && e.target.closest(".dp-code");
      if (t) { if (curEl === t) hide(true); else show(t); return; }
      if (!(e.target.closest && e.target.closest("#dp-pop"))) hide(true);
    }, true);
    document.addEventListener("click", e => {
      if (e.target && e.target.classList && e.target.classList.contains("dp-pop-x")) { e.preventDefault(); e.stopPropagation(); hide(true); }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") hide(true); });
    window.addEventListener("scroll", () => { if (curEl) hide(true); }, true);
  }

  function injectStyles() {
    if (document.getElementById("dp-style")) return;
    const st = document.createElement("style");
    st.id = "dp-style";
    st.textContent = `
.dp-code { cursor: help; border-bottom: 1px dotted #2563eb; color: inherit; white-space: nowrap; }
.dp-code::after { content: " 📄"; font-size: .8em; opacity: .85; }
#dp-pop { position: fixed; z-index: 100000; width: 540px; max-width: calc(100vw - 16px); background: #fff; color: #0f172a; border: 1px solid #cbd5e1; border-radius: 12px; box-shadow: 0 10px 30px rgba(15,23,42,.28); padding: 8px; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left; }
#dp-pop .dp-pop-h { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 12px; color: #475569; margin-bottom: 6px; }
#dp-pop .dp-pop-h a { color: #1d4ed8; text-decoration: none; font-weight: 600; }
#dp-pop .dp-pop-x { cursor: pointer; margin-left: 8px; color: #94a3b8; font-weight: 700; }
#dp-pop img { display: block; max-width: 520px; max-height: 400px; margin: 0 auto; border-radius: 6px; }
#dp-pop iframe { display: block; width: 520px; max-width: 100%; height: 390px; border: 0; border-radius: 6px; background: #f8fafc; }
#dp-pop .dp-pop-more, #dp-pop .dp-pop-other, #dp-pop .dp-pop-f, #dp-pop .dp-pop-wait { font-size: 12px; color: #475569; margin-top: 6px; }
#dp-pop .dp-pop-wait { padding: 18px 0; text-align: center; }
@media print { .dp-code { border-bottom: 0; } .dp-code::after { content: ""; } #dp-pop { display: none !important; } }
`;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- Публично ---- */
  DP.refresh = async function (force) {
    const ok = await loadIndex(force);
    if (ok) scan(document.body);
    return ok;
  };
  DP.forget = function (pid) { if (pid) delete DP.cache[Number(pid)]; };
  DP.scan = scan;

  async function start() {
    injectStyles();
    wireEvents();
    observe();
    // Клиентът може да се появи по-късно (след вход / зареждане на config) — опитваме няколко пъти.
    let tries = 0;
    const tick = async () => {
      const ok = await DP.refresh(false);
      if (!ok && tries < 40) setTimeout(tick, Math.min(30000, 2000 * (++tries)));
    };
    tick();
    setInterval(() => DP.refresh(true), 10 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) DP.refresh(false); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
