/* Данко Системс — браузърният бутон „Назад" (и жестът назад на телефон)
   затваря текущия слой (диалог → детайл → модал), вместо да излиза от
   приложението. Работи глобално, без промяна по останалите файлове. */
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
    //    цехови акаунти); затваряме само ако бутонът „Затвори" е видим (админ).
    const tm = document.getElementById("tasks-modal");
    if (tm && !tm.hidden) {
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

  window.addEventListener("popstate", function () {
    // Ако сме затворили слой — оставяме буферно състояние, за да не излезем.
    if (handleBack()) seed();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", seed);
  else seed();
})();
