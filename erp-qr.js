/* Данко Системс — 🏷 QR ОТЧИТАНЕ ПО ЦЕХОВЕ (тест, по Данко, 05.11.2026)
   ИДЕЯТА: един QR код за ЦЕЛИЯ ПЪТ на детайла (лазер → огъване → заварка → …).
   Кодът се печата при пускането/първата операция, лепи се на палета и върви с
   него. Служителят го сканира с камерата на ЛИЧНИЯ си телефон:
     • отваря се скан-екранът (без целия интерфейс) — телефонът е влязъл
       еднократно с общия акаунт (skan@danko.local);
     • вижда СВОБОДНИТЕ за отчитане операции (гейтът erpFlowAvailable решава);
     • ▶ ЗАПОЧВАМ пуска часовника; ✅ ЗАВЪРШИХ пита брой (предпопълнен с
       наличното), машина (едри бутони) и време (предпопълнено от часовника)
       и записва през logProduction — склад/поток/вечен дневник се движат
       както при отчитане от екрана в цеха. Частично отчитане = просто
       по-малък брой. ⚠ Брак минава през reportSetupScrap (както в цеха).
   QR = адресът на сайта + #scan=<id на ПЪРВАТА операция> — затова при
   сканиране винаги тръгваме от корена и показваме цялата верига.
   Печат на етикети: от Цехове (бутон 🏷 QR на задача), от Заявки от клиенти
   (🏷 QR етикети — по един етикет на детайл) и в Работния лист (QR на ред). */

const QR_LIB_SRC = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
const QR_WORKER_KEY = "qr_worker";          // името на служителя, запомнено на телефона

function qrLibLoad() {
  return new Promise((resolve, reject) => {
    if (window.QRCode) return resolve();
    const s = document.createElement("script");
    s.src = QR_LIB_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("QR библиотеката не се зареди — провери интернета."));
    document.head.appendChild(s);
  });
}

// PNG data-URL на QR код (за <img> в печатни прозорци — зарежда се мигновено).
function qrDataUrl(text, px) {
  const d = document.createElement("div");
  new QRCode(d, { text: String(text), width: px || 256, height: px || 256, correctLevel: QRCode.CorrectLevel.M });
  const c = d.querySelector("canvas");
  if (c) return c.toDataURL("image/png");
  const img = d.querySelector("img");
  return (img && img.src) || "";
}

// Адресът, който QR кодът носи: страницата + #scan=<id на корена>.
function qrScanUrl(rootId) {
  return location.origin + location.pathname + "#scan=" + rootId;
}

/* ---------- Веригата на детайла ---------- */

// Всички операции по реда им, тръгвайки от корена (следва flowNextTaskOf).
function qrChainOf(root) {
  const out = [];
  const seen = new Set();
  let cur = root;
  while (cur && !seen.has(String(cur.id)) && out.length < 40) {
    seen.add(String(cur.id));
    out.push(cur);
    cur = (typeof flowNextTaskOf === "function") ? flowNextTaskOf(cur) : null;
  }
  return out;
}

// От коя да е задача → коренът (първата операция) на веригата ѝ.
function qrRootOf(t) {
  return (typeof flowChainRoot === "function") ? (flowChainRoot(t) || t) : t;
}

/* ---------- Печат на етикети ---------- */

// Един етикет: QR + едри данни за палета. tasks може да са кои да е операции —
// свеждат се до корените им (един етикет на детайл/верига).
async function qrPrintLabels(tasks, preWin, title) {
  const w = preWin || window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  try { w.document.write('<p style="font-family:sans-serif;padding:20px">Подготвям етикетите…</p>'); } catch (e) {}
  try { await qrLibLoad(); } catch (e) { try { w.close(); } catch (e2) {} alert(e.message || e); return; }

  const seen = new Set();
  const chains = [];
  (tasks || []).forEach(t => {
    if (!t || !t.source || !t.source.flow) return;
    const root = qrRootOf(t);
    if (!root || seen.has(String(root.id))) return;
    seen.add(String(root.id));
    chains.push(qrChainOf(root));
  });
  if (!chains.length) { try { w.close(); } catch (e) {} alert("Няма поточни задачи за етикети (QR важи за задачите от заявки/серии)."); return; }

  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
  const labels = chains.map(chain => {
    const root = chain[0];
    const orders = (typeof taskSeriesOrders === "function") ? taskSeriesOrders(root) : [];
    const client = root.client || [...new Set(orders.map(o => (o.client || "").trim()).filter(Boolean))].join(", ");
    const nos = [...new Set(orders.map(o => String(o.no || "").trim()).filter(Boolean))];
    const route = chain.map(t2 => esc(t2.operation || "?")).join(" → ");
    const img = qrDataUrl(qrScanUrl(root.id), 256);
    return `<div class="lbl">
      <div class="side">
        <img src="${img}" alt="QR" />
        <div class="scanhint">📷 сканирай за отчитане</div>
      </div>
      <div class="info">
        <div class="client">${esc(client || "СЕРИЯ / СКЛАД")}</div>
        <div class="prod">${esc(root.product || "")}</div>
        <div class="code">${esc(root.code || "")}${nos.length ? ` · заявка № ${esc(nos.join(", "))}` : ""}</div>
        <div class="qty">${Number(root.qty) || 0} бр.${root.due ? ` · срок ${esc((typeof erpDMY === "function") ? erpDMY(root.due) : root.due)}` : ""}</div>
        <div class="route">${route}</div>
      </div>
    </div>`;
  }).join("");

  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><title>${esc(title || "QR етикети")}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:8mm;color:#111}
      .lbl{display:flex;gap:8mm;align-items:center;border:2px solid #111;border-radius:4mm;
           padding:6mm;margin-bottom:6mm;page-break-inside:avoid;min-height:52mm}
      .side{text-align:center;flex:0 0 auto}
      .side img{width:46mm;height:46mm;display:block}
      .scanhint{font-size:3mm;color:#444;margin-top:1mm}
      .info{min-width:0}
      .client{font-size:9mm;font-weight:800;line-height:1.1;text-transform:uppercase}
      .prod{font-size:6.5mm;font-weight:700;margin-top:2mm}
      .code{font-size:5mm;margin-top:1.5mm}
      .qty{font-size:5.5mm;font-weight:700;margin-top:1.5mm}
      .route{font-size:3.6mm;color:#333;margin-top:2.5mm}
      @page{size:A4 portrait;margin:8mm}
      @media print{.noprint{display:none}}
    </style></head><body>
    <div class="noprint" style="text-align:center;margin-bottom:6mm">
      <button onclick="window.print()" style="padding:10px 24px;font-size:15px">🖨 Печат</button>
    </div>
    ${labels}
    </body></html>`;
  try { w.document.open(); w.document.write(html); w.document.close(); w.focus(); } catch (e) { alert("Печатният прозорец се затвори."); }
}

// 🏷 QR етикети за цяла заявка от клиент: по един етикет на детайл (верига).
async function erpQRLabelsForOrder(o) {
  const w = window.open("", "_blank");
  if (!w) { alert("Изскачащият прозорец е блокиран. Разреши popup за сайта."); return; }
  try { w.document.write('<p style="font-family:sans-serif;padding:20px">Търся задачите по заявката…</p>'); } catch (e) {}
  try { if (typeof tLoadTasks === "function") await tLoadTasks(); } catch (e) {}
  const sid = String(o && o.id || "");
  const list = (typeof TASKS !== "undefined" ? TASKS || [] : []).filter(t =>
    t.source && t.source.flow && !t.closed
    && !String(t.source.seriesKey || "").includes("¦арх:")
    && (t.source.orderIds || []).map(String).includes(sid));
  if (!list.length) {
    try { w.close(); } catch (e) {}
    alert("По тази заявка няма пуснато производство (няма задачи в цеховете). Етикетите се правят след „пускане в производство“.");
    return;
  }
  await qrPrintLabels(list, w, `QR етикети — заявка № ${o.ourNo || ""}`);
}

/* ---------- 📷 СКАН-ЕКРАНЪТ (телефон) ---------- */

let QR_SCAN_ID = null;

function qrWorkerGet() { try { return localStorage.getItem(QR_WORKER_KEY) || ""; } catch (e) { return ""; } }
function qrWorkerSet(name) { try { if (name) localStorage.setItem(QR_WORKER_KEY, name); else localStorage.removeItem(QR_WORKER_KEY); } catch (e) {} }

function qrScanCss() {
  if (document.getElementById("qr-scan-css")) return;
  const st = document.createElement("style");
  st.id = "qr-scan-css";
  st.textContent = `
    #qr-scan{position:fixed;inset:0;z-index:9000;overflow:auto;background:#f1f5f9;
      font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#0f172a;
      -webkit-text-size-adjust:100%;padding:12px 12px 40px}
    #qr-scan .qs-head{background:#1d4ed8;color:#fff;border-radius:14px;padding:14px 16px;margin-bottom:10px}
    #qr-scan .qs-client{font-size:13px;opacity:.85;text-transform:uppercase;letter-spacing:.4px}
    #qr-scan .qs-prod{font-size:20px;font-weight:800;line-height:1.2;margin-top:2px}
    #qr-scan .qs-meta{font-size:13px;opacity:.9;margin-top:4px}
    #qr-scan .qs-worker{display:flex;align-items:center;gap:8px;background:#fff;border-radius:12px;
      padding:10px 14px;margin-bottom:10px;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    #qr-scan .qs-worker b{font-size:16px}
    #qr-scan .qs-op{background:#fff;border-radius:14px;padding:12px 14px;margin-bottom:10px;
      box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:6px solid #cbd5e1}
    #qr-scan .qs-op.on{border-left-color:#16a34a}
    #qr-scan .qs-op.done{border-left-color:#1d4ed8;opacity:.75}
    #qr-scan .qs-opname{font-size:17px;font-weight:700}
    #qr-scan .qs-opmeta{font-size:13px;color:#475569;margin-top:2px}
    #qr-scan .qs-timer{font-size:14px;color:#b45309;font-weight:700;margin-top:6px}
    #qr-scan .qs-btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    #qr-scan button{font:inherit;border:0;border-radius:12px;cursor:pointer}
    #qr-scan .qs-b{flex:1 1 40%;min-height:52px;font-size:16px;font-weight:700;color:#fff}
    #qr-scan .qs-start{background:#16a34a}
    #qr-scan .qs-finish{background:#1d4ed8}
    #qr-scan .qs-scrap{background:#fff;color:#b91c1c;border:2px solid #fca5a5;flex:0 1 30%;min-height:52px;font-size:14px;font-weight:700}
    #qr-scan .qs-small{background:#e2e8f0;color:#0f172a;padding:8px 12px;font-size:13px}
    #qr-scan .qs-done-msg{background:#dcfce7;border-radius:14px;padding:18px;text-align:center;font-size:18px;font-weight:700;color:#166534}
    #qr-scan .qs-note{font-size:13px;color:#64748b;text-align:center;margin-top:14px}
    .qs-overlay{position:fixed;inset:0;z-index:9100;background:rgba(15,23,42,.6);
      display:flex;align-items:flex-end;justify-content:center}
    .qs-sheet{background:#fff;border-radius:18px 18px 0 0;padding:16px 16px 28px;width:100%;
      max-width:520px;max-height:86vh;overflow:auto;font-family:inherit}
    .qs-sheet h3{margin:0 0 10px;font-size:18px}
    .qs-sheet label{display:block;font-size:13px;color:#475569;margin:10px 0 4px}
    .qs-sheet input[type=number],.qs-sheet input[type=text]{width:100%;box-sizing:border-box;
      font-size:18px;padding:10px;border:1px solid #cbd5e1;border-radius:10px}
    .qs-pick{display:flex;flex-wrap:wrap;gap:8px}
    .qs-pick button{background:#e2e8f0;color:#0f172a;padding:12px 14px;font-size:15px;font-weight:600;border-radius:10px}
    .qs-pick button.sel{background:#1d4ed8;color:#fff}
    .qs-sheet .qs-actions{display:flex;gap:8px;margin-top:16px}
    .qs-sheet .qs-actions button{flex:1;min-height:50px;font-size:16px;font-weight:700;border-radius:12px}
    .qs-sheet .qs-ok{background:#1d4ed8;color:#fff}
    .qs-sheet .qs-cancel{background:#e2e8f0;color:#0f172a}
  `;
  document.head.appendChild(st);
}

function qrScanHost() {
  qrScanCss();
  let host = document.getElementById("qr-scan");
  if (!host) { host = document.createElement("div"); host.id = "qr-scan"; document.body.appendChild(host); }
  return host;
}

// Вход от app.js при #scan=<id> (и при смяна на hash-а със следващ код).
async function qrScanOpen(taskId) {
  QR_SCAN_ID = Number(taskId);
  const host = qrScanHost();
  host.innerHTML = '<div class="qs-note" style="margin-top:40vh;font-size:16px">⏳ Зареждам задачите…</div>';
  try { if (typeof tLoadWorkers === "function") await tLoadWorkers(); } catch (e) {}
  try { await tLoadTasks(); } catch (e) {
    host.innerHTML = '<div class="qs-done-msg" style="background:#fee2e2;color:#991b1b">Грешка при зареждане. Провери интернета и опитай пак.</div>';
    return;
  }
  qrScanRender();
}

function qrScanRender() {
  const host = qrScanHost();
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
  const t0 = (TASKS || []).find(x => String(x.id) === String(QR_SCAN_ID));
  if (!t0) {
    host.innerHTML = '<div class="qs-done-msg" style="background:#fee2e2;color:#991b1b">Този код не отговаря на активна задача (изтрита или архивирана). Питай майстора.</div>';
    return;
  }
  const chain = qrChainOf(qrRootOf(t0));
  const root = chain[0];
  const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
  const worker = qrWorkerGet();
  const orders = (typeof taskSeriesOrders === "function") ? taskSeriesOrders(root) : [];
  const client = root.client || [...new Set(orders.map(o => (o.client || "").trim()).filter(Boolean))].join(", ");
  const nos = [...new Set(orders.map(o => String(o.no || "").trim()).filter(Boolean))];

  const rows = chain.map(t => {
    const qty = Number(t.qty) || 0, prod = Number(t.produced) || 0;
    const done = t.closed || (qty > 0 && prod >= qty);
    const avail = done ? 0 : ((typeof erpFlowAvailable === "function") ? Math.max(0, erpFlowAvailable(t, map) || 0) : Math.max(0, qty - prod));
    const active = !done && avail > 0;
    const startIso = t.qrStart && worker && t.qrStart[worker];
    const mins = startIso ? Math.max(1, Math.round((Date.now() - new Date(startIso).getTime()) / 60000)) : 0;
    const st = done ? "✅" : active ? "🟢" : "⚪";
    return `<div class="qs-op ${done ? "done" : active ? "on" : ""}" data-tid="${t.id}">
      <div class="qs-opname">${st} ${esc(t.operation || "?")}</div>
      <div class="qs-opmeta">${esc(t.workshop || "")} · готови ${prod} от ${qty}${active ? ` · <b>може да се отчете: ${avail}</b>` : done ? "" : " · чака предишната операция"}</div>
      ${startIso ? `<div class="qs-timer">⏱ ${esc(worker)} работи от ${mins} мин</div>` : ""}
      ${active ? `<div class="qs-btns">
        ${startIso ? "" : `<button class="qs-b qs-start" data-act="start" data-tid="${t.id}">▶ ЗАПОЧВАМ</button>`}
        <button class="qs-b qs-finish" data-act="finish" data-tid="${t.id}">✅ ЗАВЪРШИХ</button>
        <button class="qs-scrap" data-act="scrap" data-tid="${t.id}">⚠ Брак</button>
      </div>` : ""}
    </div>`;
  }).join("");

  const allDone = chain.every(t => t.closed || ((Number(t.qty) || 0) > 0 && (Number(t.produced) || 0) >= (Number(t.qty) || 0)));

  host.innerHTML = `
    <div class="qs-head">
      <div class="qs-client">${esc(client || "серия / склад")}</div>
      <div class="qs-prod">${esc(root.product || "")}</div>
      <div class="qs-meta">${esc(root.code || "")}${nos.length ? ` · заявка № ${esc(nos.join(", "))}` : ""} · ${Number(root.qty) || 0} бр.</div>
    </div>
    <div class="qs-worker">👤 ${worker ? `<b>${esc(worker)}</b>` : "<i>не е избран служител</i>"}
      <span style="flex:1"></span>
      <button class="qs-small" data-act="worker">✎ ${worker ? "смени" : "избери"}</button>
      <button class="qs-small" data-act="reload">↻</button>
    </div>
    ${allDone ? '<div class="qs-done-msg">🎉 Всички операции по детайла са завършени!</div>' : ""}
    ${rows}
    <div class="qs-note">Сканирай същия код след всяка операция — екранът показва докъде е стигнал детайлът.</div>`;

  host.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async () => {
    const act = b.dataset.act;
    const t = (TASKS || []).find(x => String(x.id) === String(b.dataset.tid));
    if (act === "reload") { await qrScanOpen(QR_SCAN_ID); return; }
    if (act === "worker") { const n = await qrPickWorker(t0.workshop); if (n) qrScanRender(); return; }
    if (!t) return;
    if (act === "start") await qrOpStart(t);
    else if (act === "finish") await qrOpFinish(t);
    else if (act === "scrap") await qrOpScrap(t);
  }));
}

// Служител: едри бутони от списъка на цеха + поле за друго име. Пази се на телефона.
function qrPickWorker(workshop) {
  return new Promise(resolve => {
    const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
    let names = [];
    try { names = (typeof wsWorkersOf === "function") ? (wsWorkersOf(workshop) || []) : []; } catch (e) {}
    if (!names.length) { try { names = (typeof wsWorkersOf === "function") ? (wsWorkersOf("__all") || []) : []; } catch (e) {} }
    const ov = document.createElement("div");
    ov.className = "qs-overlay";
    ov.innerHTML = `<div class="qs-sheet">
      <h3>👤 Кой отчита?</h3>
      <div class="qs-pick">${names.map(n => `<button type="button" data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div>
      <label>Друго име</label>
      <input type="text" id="qsw-free" placeholder="Име Фамилия" />
      <div class="qs-actions">
        <button type="button" class="qs-cancel">Отказ</button>
        <button type="button" class="qs-ok">Готово</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    let picked = "";
    const finish = name => { ov.remove(); if (name) qrWorkerSet(name); resolve(name || ""); };
    ov.querySelectorAll(".qs-pick button").forEach(b => b.addEventListener("click", () => {
      picked = b.dataset.n;
      ov.querySelectorAll(".qs-pick button").forEach(x => x.classList.toggle("sel", x === b));
      ov.querySelector("#qsw-free").value = "";
    }));
    ov.querySelector(".qs-ok").addEventListener("click", () => {
      const free = ov.querySelector("#qsw-free").value.trim();
      finish(free || picked);
    });
    ov.querySelector(".qs-cancel").addEventListener("click", () => finish(""));
    ov.addEventListener("click", e => { if (e.target === ov) finish(""); });
  });
}

async function qrNeedWorker(t) {
  let w = qrWorkerGet();
  if (!w) w = await qrPickWorker(t.workshop);
  return w;
}

// ▶ ЗАПОЧВАМ: пуска часовника за този служител и го записва по задачата.
async function qrOpStart(t) {
  const w = await qrNeedWorker(t); if (!w) return;
  try { await tLoadTasks(); } catch (e) {}
  const fresh = (TASKS || []).find(x => String(x.id) === String(t.id)); if (!fresh) return;
  fresh.qrStart = fresh.qrStart || {};
  fresh.qrStart[w] = new Date().toISOString();
  try { if (typeof taskSetAssignees === "function" && typeof taskAssignees === "function" && !taskAssignees(fresh).includes(w)) taskSetAssignees(fresh, [...taskAssignees(fresh), w]); } catch (e) {}
  await tSaveTask(fresh);
  qrScanRender();
}

// ✅ ЗАВЪРШИХ: брой (предпопълнен), машина (едри бутони), минути (от часовника).
async function qrOpFinish(t) {
  const w = await qrNeedWorker(t); if (!w) return;
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
  try { await tLoadTasks(); } catch (e) {}
  let fresh = (TASKS || []).find(x => String(x.id) === String(t.id)); if (!fresh) return;
  const map = (typeof erpSeriesProduced === "function") ? erpSeriesProduced(TASKS) : {};
  const qty = Number(fresh.qty) || 0, prod = Number(fresh.produced) || 0;
  const avail = (typeof erpFlowAvailable === "function") ? Math.max(0, erpFlowAvailable(fresh, map) || 0) : Math.max(0, qty - prod);
  if (avail <= 0) { alert("В момента няма налични бройки за отчитане по тази операция (изчакай предишната)."); qrScanRender(); return; }
  const machines = (typeof MACHINES_BY_WORKSHOP !== "undefined" && MACHINES_BY_WORKSHOP[fresh.workshop]) || null;
  const startIso = fresh.qrStart && fresh.qrStart[w];
  const elapsed = startIso ? Math.max(1, Math.round((Date.now() - new Date(startIso).getTime()) / 60000)) : "";

  const ov = document.createElement("div");
  ov.className = "qs-overlay";
  ov.innerHTML = `<div class="qs-sheet">
    <h3>✅ ${esc(fresh.operation || "")} — ${esc(w)}</h3>
    <label>Колко броя завърши сега? (свободни: ${avail})</label>
    <input type="number" id="qsf-qty" inputmode="numeric" min="1" value="${avail}" />
    ${machines ? `<label>На коя машина?</label><div class="qs-pick" id="qsf-mach">${machines.map(m => `<button type="button" data-m="${esc(m)}">${esc(m)}</button>`).join("")}</div>`
      : `<label>Машина (ако има)</label><input type="text" id="qsf-mach-free" placeholder="напр. преса / ръчно" />`}
    <label>Време за тази работа (минути)${startIso ? " — от часовника, поправи ако трябва" : ""}</label>
    <input type="number" id="qsf-min" inputmode="numeric" min="1" value="${elapsed}" placeholder="мин" />
    <div class="qs-actions">
      <button type="button" class="qs-cancel">Отказ</button>
      <button type="button" class="qs-ok">💾 Запиши</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  let mach = "";
  ov.querySelectorAll("#qsf-mach button").forEach(b => b.addEventListener("click", () => {
    mach = b.dataset.m;
    ov.querySelectorAll("#qsf-mach button").forEach(x => x.classList.toggle("sel", x === b));
  }));
  ov.querySelector(".qs-cancel").addEventListener("click", () => ov.remove());
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  ov.querySelector(".qs-ok").addEventListener("click", async () => {
    const n = Number(String(ov.querySelector("#qsf-qty").value).replace(",", "."));
    if (!(n > 0)) { alert("Въведи брой."); return; }
    if (machines && !mach) { alert("Избери машина."); return; }
    const freeM = ov.querySelector("#qsf-mach-free");
    const machine = mach || (freeM ? freeM.value.trim() : "");
    const mins = Number(ov.querySelector("#qsf-min").value);
    if (!(mins > 0)) { alert("Въведи времето в минути (за ценообразуването)."); return; }
    const okBtn = ov.querySelector(".qs-ok"); okBtn.disabled = true; okBtn.textContent = "⏳…";
    // Прясно състояние точно преди записа (двама може да отчитат едновременно).
    try { await tLoadTasks(); } catch (e) {}
    fresh = (TASKS || []).find(x => String(x.id) === String(t.id));
    if (!fresh) { ov.remove(); qrScanRender(); return; }
    const before = Number(fresh.produced) || 0;
    const extra = { tOrder: { v: mins, unit: "мин", sec: Math.round(mins * 60) } };
    if (machine) extra.machine = machine;
    try { await logProduction(fresh, n, extra, { worker: w }); }
    catch (e) { console.error("qr finish", e); }
    const after = Number(fresh.produced) || 0;
    if (after > before) {
      // записано: часовникът за този служител се нулира
      if (fresh.qrStart && fresh.qrStart[w]) { delete fresh.qrStart[w]; try { await tSaveTask(fresh); } catch (e) {} }
      ov.remove();
      await qrScanOpen(QR_SCAN_ID);
    } else {
      okBtn.disabled = false; okBtn.textContent = "💾 Запиши";
      // logProduction сам е показал причината (гейт/лимит); оставаме на формата
    }
  });
}

// ⚠ Брак — както в цеха: отива в brakLog и връща нужда към първата операция.
async function qrOpScrap(t) {
  const w = await qrNeedWorker(t); if (!w) return;
  const esc = (typeof escapeHtml === "function") ? escapeHtml : (s => String(s == null ? "" : s));
  const ov = document.createElement("div");
  ov.className = "qs-overlay";
  ov.innerHTML = `<div class="qs-sheet">
    <h3>⚠ Брак — ${esc(t.operation || "")}</h3>
    <label>Колко броя станаха брак?</label>
    <input type="number" id="qss-qty" inputmode="numeric" min="1" />
    <label>Какво стана? (по желание)</label>
    <input type="text" id="qss-note" placeholder="напр. крива настройка" />
    <div class="qs-actions">
      <button type="button" class="qs-cancel">Отказ</button>
      <button type="button" class="qs-ok" style="background:#b91c1c">⚠ Запиши брака</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector(".qs-cancel").addEventListener("click", () => ov.remove());
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
  ov.querySelector(".qs-ok").addEventListener("click", async () => {
    const n = Number(ov.querySelector("#qss-qty").value);
    if (!(n > 0)) { alert("Въведи брой."); return; }
    const note = ov.querySelector("#qss-note").value.trim();
    try { await tLoadTasks(); } catch (e) {}
    const fresh = (TASKS || []).find(x => String(x.id) === String(t.id));
    if (!fresh) { ov.remove(); qrScanRender(); return; }
    if (typeof reportSetupScrap === "function") { try { await reportSetupScrap(fresh, n, note ? note + " (от телефона: " + w + ")" : "от телефона: " + w); } catch (e) { console.error("qr scrap", e); } }
    ov.remove();
    await qrScanOpen(QR_SCAN_ID);
  });
}

// Сканиране на НОВ код, докато екранът е отворен (камерата смени само hash-а).
window.addEventListener("hashchange", () => {
  const m = location.hash.match(/#scan=(\d+)/);
  if (m && document.getElementById("qr-scan")) qrScanOpen(Number(m[1]));
});
