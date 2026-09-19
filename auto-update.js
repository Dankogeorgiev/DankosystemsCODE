/* Данко Системс — авто-обновяване на кеша (всички страници).
   Цеховите таблети и офисните браузъри стоят отворени с дни и продължават да
   работят със СТАРИЯ код — качените поправки не стигат до тях, а старо
   устройство може да съсипе защити, които разчитат всички да са на новата
   версия (напр. атомарните складови броячи от v700). На всеки 10 минути се
   тегли собственият index.html (без кеш) и се сравняват скрипт версиите
   (?v=) с тези на заредената страница. При разлика:
   • екранът е скрит/друг таб → тихо презареждане;
   • човекът гледа страницата → син банер „Има нова версия" (клик = веднага),
     а презареждането става само̀ при следващото скриване на екрана — за да
     не се губи нещо въведено. */
(function () {
  let pending = false, lastReload = 0;
  const startedAt = Date.now();
  const pageUrl = location.pathname.endsWith("/") ? location.pathname + "index.html" : location.pathname;

  const sigOf = list => list.filter(s => s && !/^https?:/i.test(s)).sort().join("|");
  const domSig = () => sigOf([...document.querySelectorAll("script[src]")].map(s => s.getAttribute("src")));
  const htmlSig = html => {
    const out = []; const re = /<script[^>]+src="([^"]+)"/g; let m;
    while ((m = re.exec(html))) out.push(m[1]);
    return sigOf(out);
  };
  const doReload = () => {
    // Пазим се от цикъл (CDN-ът кратко може да връща стар index): най-много
    // едно презареждане на 10 минути (белегът живее в sessionStorage).
    try {
      const last = Number(sessionStorage.getItem("au-reload") || 0);
      if (Date.now() - last < 10 * 60000) return;
      sessionStorage.setItem("au-reload", String(Date.now()));
    } catch (e) {}
    location.reload();
  };
  const showBanner = () => {
    if (document.getElementById("au-banner") || !document.body) return;
    const b = document.createElement("div");
    b.id = "au-banner";
    b.textContent = "🔄 Има нова версия на системата — натисни за обновяване";
    b.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:99999;" +
      "background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:999px;" +
      "font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)";
    b.addEventListener("click", doReload);
    document.body.appendChild(b);
  };
  async function check() {
    try {
      const r = await fetch(pageUrl, { cache: "no-store" });
      if (!r.ok) return;
      const html = await r.text();
      const fresh = htmlSig(html);
      if (!fresh || fresh === domSig()) return;
      pending = true;
      // Току-що заредена страница (до 30 сек) или скрит екран → тихо обновяване;
      // иначе банер + презареждане при следващото скриване.
      if (Date.now() - startedAt < 30000 || document.hidden) doReload();
      else showBanner();
    } catch (e) { /* без мрежа — ще опита пак */ }
  }
  document.addEventListener("visibilitychange", () => { if (pending && document.hidden) doReload(); });
  setTimeout(check, 5000);            // ранна проверка при отваряне (хваща стар кеш веднага)
  setInterval(check, 10 * 60000);
})();
