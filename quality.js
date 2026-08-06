/* Данко Системс — КОНТРОЛ НА КАЧЕСТВОТО (общ за всички цехове).
   Преди ВСЯКО отчитане на операция излиза напомняне с големи червени букви;
   служителят потвърждава качеството и чак тогава отчита. На всяко 3-то
   отчитане прозорецът е СЪС ЗАДЪРЖАНЕ 60 секунди — време да измери реално.

   Ползване (навсякъде еднакво):
     qcGate(function () { ...тук е истинското отчитане... });
   Броячът е локален за устройството/служителя (localStorage). */

const QC_EVERY = 3;        // всяко трето отчитане е с отброяване
const QC_SECONDS = 60;     // колко секунди се чака тогава

/* Текстовете се СМЕНЯТ на всеки 2 дни (по календара — еднакво за всички),
   за да не се превърнат в невидим шум. Все за качеството. */
const QC_TEXTS = [
  { t: "ПРОВЕРИ ЛИ КАЧЕСТВОТО?<br>РАЗМЕРИТЕ ОТГОВАРЯТ ЛИ?", s: "НАПРАВИ КОНТРОЛНО ИЗМЕРВАНЕ<br>И СВЕРКА С ЧЕРТЕЖА.", n: "Измери детайла и сверѝ с чертежа, преди да отчетеш.", w: "ПРОВЕРИ РАЗМЕРИТЕ И КАЧЕСТВОТО" },
  { t: "ИЗМЕРИ ЛИ ПОСЛЕДНИЯ ДЕТАЙЛ?", s: "ЕДИН БРАК ДНЕС Е<br>ЦЯЛА ПАРТИЯ УТРЕ.", n: "Вземи шублера и провери реалния размер сега.", w: "ИЗМЕРИ ПОСЛЕДНИЯ ДЕТАЙЛ" },
  { t: "СВЕРИ С ЧЕРТЕЖА!", s: "ПРАВИЛНИЯТ ЧЕРТЕЖ ЛИ Е?<br>ПРАВИЛНАТА РЕВИЗИЯ ЛИ Е?", n: "Виж номера и ревизията на чертежа, преди да отчетеш.", w: "СВЕРИ ЧЕРТЕЖА И РЕВИЗИЯТА" },
  { t: "КАЧЕСТВОТО Е ТВОЙ ПОДПИС.", s: "ПРОВЕРИ ЪГЛИТЕ, ОТВОРИТЕ<br>И ЗАВАРКИТЕ.", n: "Огледай детайла: ъгли, отвори, заварки, чистота.", w: "ПРОВЕРИ ЪГЛИ, ОТВОРИ, ЗАВАРКИ" },
  { t: "НЕ ПОДАВАЙ НАПРЕД ГРЕШКА!", s: "СЛЕДВАЩАТА ОПЕРАЦИЯ<br>НЯМА ДА Я ХВАНЕ.", n: "Ако нещо не е наред — спри и кажи, не отчитай.", w: "ПРОВЕРИ ПРЕДИ ДА ПОДАДЕШ НАПРЕД" },
  { t: "КЛИЕНТЪТ МЕРИ ВСЕКИ ДЕТАЙЛ.", s: "ИЗМЕРИ ГО ТИ ПРЪВ.", n: "Контролно измерване сега — после е късно.", w: "ИЗМЕРИ ПРЕДИ КЛИЕНТА" },
  { t: "ПЪРВИЯТ И ПОСЛЕДНИЯТ<br>ДЕТАЙЛ — ЗАДЪЛЖИТЕЛНО!", s: "ИЗМЕРИ ГИ И ДВАТА.", n: "Провери първия и последния от партидата.", w: "ИЗМЕРИ ПЪРВИЯ И ПОСЛЕДНИЯ" },
];
function qcText() {
  const days = Math.floor(Date.now() / 864e5);      // ден от епохата
  return QC_TEXTS[Math.floor(days / 2) % QC_TEXTS.length];
}

function qcCountKey() {
  let who = "";
  try {
    who = (typeof MY_WORKER !== "undefined" && MY_WORKER) ||
      (typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) ||
      (window.WELDING && window.WELDING.worker) || "";
  } catch (e) {}
  return "qc_count_" + (who || "общ");
}
function qcNextCount() {
  const k = qcCountKey();
  let n = 0;
  try { n = Number(localStorage.getItem(k)) || 0; } catch (e) {}
  n++;
  try { localStorage.setItem(k, String(n)); } catch (e) {}
  return n;
}
function qcEnsureStyles() {
  if (document.getElementById("qc-styles")) return;
  const s = document.createElement("style");
  s.id = "qc-styles";
  s.textContent = `
    .qc-ovl{position:fixed;inset:0;background:rgba(15,23,42,.78);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px}
    .qc-box{background:#fff;border-radius:16px;max-width:640px;width:100%;padding:26px 28px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.4);border:4px solid #dc2626}
    .qc-title{color:#dc2626;font-weight:900;font-size:30px;line-height:1.25;letter-spacing:.5px;margin:0 0 10px}
    .qc-sub{color:#dc2626;font-weight:800;font-size:22px;line-height:1.3;margin:0 0 6px}
    .qc-note{color:#334155;font-size:15px;margin:12px 0 18px}
    .qc-timer{font-size:64px;font-weight:900;color:#dc2626;margin:10px 0 4px;font-variant-numeric:tabular-nums}
    .qc-bar{height:10px;background:#fee2e2;border-radius:6px;overflow:hidden;margin:0 0 16px}
    .qc-bar>div{height:100%;background:linear-gradient(90deg,#f97316,#dc2626);width:100%;transition:width 1s linear}
    .qc-btn{background:#16a34a;color:#fff;border:none;border-radius:10px;padding:14px 26px;font-size:18px;font-weight:800;cursor:pointer;min-width:280px}
    .qc-btn:disabled{background:#cbd5e1;color:#64748b;cursor:not-allowed}
    .qc-cancel{background:none;border:none;color:#64748b;font-size:13px;margin-top:12px;cursor:pointer;text-decoration:underline}
    @media (max-width:600px){.qc-title{font-size:23px}.qc-sub{font-size:18px}.qc-timer{font-size:48px}.qc-btn{min-width:0;width:100%}}`;
  document.head.appendChild(s);
}

/* Показва напомнянето и вика cb() САМО след потвърждение. */
function qcGate(cb) {
  qcEnsureStyles();
  const n = qcNextCount();
  const timed = (n % QC_EVERY === 0);
  const T = qcText();
  const ovl = document.createElement("div");
  ovl.className = "qc-ovl";
  ovl.innerHTML = `
    <div class="qc-box">
      <p class="qc-title">${timed ? T.w : T.t}</p>
      <p class="qc-sub">${timed ? T.t.replace(/<br>/g, " ") : T.s}</p>
      ${timed ? `<div class="qc-timer" id="qc-timer">${QC_SECONDS}</div>
        <div class="qc-bar"><div id="qc-bar"></div></div>
        <p class="qc-note">${T.n} Бутонът се отключва след ${QC_SECONDS} секунди.</p>`
        : `<p class="qc-note">${T.n}</p>`}
      <button class="qc-btn" id="qc-ok" ${timed ? "disabled" : ""}>${timed ? `Изчакай ${QC_SECONDS} сек.` : "✔ Потвърждавам качеството"}</button>
      <br><button class="qc-cancel" id="qc-no">Откажи отчитането</button>
    </div>`;
  document.body.appendChild(ovl);
  const ok = ovl.querySelector("#qc-ok");
  let timer = null;
  const close = () => { if (timer) clearInterval(timer); ovl.remove(); };
  if (timed) {
    let left = QC_SECONDS;
    const tEl = ovl.querySelector("#qc-timer"), bEl = ovl.querySelector("#qc-bar");
    timer = setInterval(() => {
      left--;
      if (tEl) tEl.textContent = left;
      if (bEl) bEl.style.width = Math.max(0, (left / QC_SECONDS) * 100) + "%";
      if (left <= 0) {
        clearInterval(timer); timer = null;
        ok.disabled = false; ok.textContent = "✔ Потвърждавам качеството";
      } else ok.textContent = `Изчакай ${left} сек.`;
    }, 1000);
  }
  ok.addEventListener("click", () => { if (ok.disabled) return; close(); try { cb(); } catch (e) { alert("Грешка: " + (e.message || e)); } });
  ovl.querySelector("#qc-no").addEventListener("click", close);
}
window.qcGate = qcGate;
