/* Данко Системс — браузърният бутон „Назад" (и жестът назад на телефон)
   затваря текущия слой (диалог → детайл → модал), вместо да излиза от
   приложението. Работи глобално, без промяна по останалите файлове.
   ВАЖНО: на устройства с МИШКА (десктоп) „назад" НЕ затваря нищо — само
   оставаме на място. Иначе страничният бутон на мишката / случайно плъзгане
   по тъчпада изхвърляше от Отчети/Съобщения/Цехове по средата на работа.
   Слоевото затваряне остава за телефони/таблети (жестът назад е нарочен). */
(function () {
  // Затваря най-горния отворен слой. Връща true, ако е обработено.
  function handleBack() {
    // 1) Динамични диалози (ЕРП + „Цехове"/съобщения) — най-горният.
    const dlgs = document.querySelectorAll(".erp-dialog, .ask-overlay");
    if (dlgs.length) { dlgs[dlgs.length - 1].remove(); return true; }

    // 2) ЕРП модал: първо назад от детайл (рецепта/заявка) към списъка.
    const erp = document.getElementById("erp-modal");
    if (erp && !erp.hidden) {
      const detailBack = erp.querySelector("#erp-recipe-back, #co-back, #sa-back");
      if (detailBack) { detailBack.click(); return true; }
      const close = document.getElementById("erp-close");
      if (close) close.click(); else erp.hidden = true;
      return true;
    }

    // 3) Модал „Цехове" — винаги оставаме в приложението (пази заключените
    //    цехови акаунти). Подизглед (Отчети/Съобщения/Служители/Планиране…)
    //    се връща към таблото на Цехове — НЕ затваряме целия модул.
    const tm = document.getElementById("tasks-modal");
    if (tm && !tm.hidden) {
      const subs = ["workers-view", "report-view", "messages-view", "times-view", "planning-view", "board-view"];
      const inSub = subs.some(id => { const el = document.getElementById(id); return el && !el.hidden; });
      if (inSub && typeof showSub === "function") {
        showSub("tasks");
        if (typeof renderTasks === "function") try { renderTasks(); } catch (e) {}
        return true;
      }
      const c = document.getElementById("tasks-close");
      if (c && getComputedStyle(c).display !== "none") c.click();
      return true;
    }

    // 4) Модал „Контакти".
    const cm = document.getElementById("contacts-modal");
    if (cm && !cm.hidden) {
      const c = document.getElementById("contacts-close");
      if (c) c.click(); else cm.hidden = true;
      return true;
    }

    return false;
  }

  function seed() { try { history.pushState({ dsBack: 1 }, ""); } catch (e) {} }

  // Телефон/таблет (груб показалец) → жестът назад затваря слой (нарочен е).
  // Десктоп с мишка → нищо не се затваря: случайният страничен бутон/плъзгане
  // само остава на място (капанът в app.js връща състоянието).
  const touchDevice = (function () {
    try { return window.matchMedia && window.matchMedia("(pointer: coarse)").matches; }
    catch (e) { return false; }
  })();

  window.addEventListener("popstate", function () {
    if (!touchDevice) return;   // мишка: не пипаме нищо, само оставаме (app.js)
    // Ако сме затворили слой — оставяме буферно състояние, за да не излезем.
    if (handleBack()) seed();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", seed);
  else seed();
})();
