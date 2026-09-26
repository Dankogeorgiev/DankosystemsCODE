/* Данко Системс — предпазители за интерфейса.

   ПРОБЛЕМЪТ: всички прозорци се затварят при щракване върху сивия фон
   (`if (e.target === wrap) close()`). Браузърът обаче праща събитието „click"
   към ОБЩИЯ РОДИТЕЛ на натискането и пускането на бутона. Затова, когато
   маркираш текст ВЪТРЕ в прозореца и пуснеш бутона малко извън него (върху
   фона), кликът се води върху фона — и прозорецът изчезва по средата на
   маркирането. Оттук идваше усещането, че „не може да се маркира нищо".

   ПОПРАВКАТА: затваряме по фона само при ИСТИНСКО щракване — натискането И
   пускането да са станали върху самия фон. Иначе спираме събитието, преди да
   стигне до затварящия слушател. Работи глобално, без промяна по останалите
   файлове (клас „overlay" в основното приложение, „ovl" в цеховите). */
(function () {
  let downOn = null, upOn = null;

  function isBackdrop(el) {
    return !!(el && el.classList && (el.classList.contains("overlay") || el.classList.contains("ovl")));
  }

  const remember = e => { downOn = e.target; upOn = null; };
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("mousedown", remember, true);   // резерв за стари браузъри
  document.addEventListener("pointerup", e => { upOn = e.target; }, true);
  document.addEventListener("mouseup", e => { upOn = e.target; }, true);

  document.addEventListener("click", e => {
    if (!isBackdrop(e.target)) return;                 // клик вътре в прозореца — не пипаме
    const pressedOnBackdrop = downOn === e.target;
    const releasedOnBackdrop = !upOn || upOn === e.target;
    if (pressedOnBackdrop && releasedOnBackdrop) return;   // истинско щракване по фона → затваря
    // Маркиране на текст, което е свършило върху фона — прозорецът ОСТАВА.
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
})();
