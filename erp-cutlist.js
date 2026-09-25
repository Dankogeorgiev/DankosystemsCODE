/* Данко Системс — „🪚 Подготовка за производство" (разкроят на Григор).
   Григор избира няколко заявки → „Генерирай разкрой" → Системата минава през
   РЕЦЕПТИТЕ на изделията (рекурсивно, през полуфабрикатите) и вади всички
   ТРЪБИ: точно описание (вид/сечение/дебелина от името на материала), точен
   размер за рязане и точна бройка = бройки от заявките × тръби на изделие.
   Дължината идва от името („Тръба ... L=1240") или от рецептата (ред в метри
   → мм на изделие). Claude (assistant) само ИЗГЛАЖДА описанията — числата са
   винаги наши, деterministic. Резултатът: списък за рязане за Бинков —
   екран + 🖨 Печат (едър шрифт) + ⬇ Excel.
   Ползва ERP.linesByProduct/matById, erpCOList, erpDialog, invPrintWindow. */

let CUT_SEL = new Set();        // избраните заявки (id-та)
let CUT_SHOWDONE = false;
let CUT_TAB = "cut";            // "cut" (разкрой) | "report" (отчет на производство)
let CUT_REP_DONE = false;       // в отчета: показвай и завършените задачи
const CUT_WS_RE = /разкрой|рязане|лентоотрезна/i;   // цехът/операцията на Бинков

/* ---------- Събиране на тръбите ---------- */
function cutIsTube(m) { return /тръб/i.test(`${m.name || ""} ${m.group_name || ""}`); }
function cutLenFromName(name) {
  const m = String(name || "").match(/L\s*=?\s*(\d{3,5})(?!\d)/i);
  return m ? Number(m[1]) : 0;
}
// Рекурсивно през ЦЯЛАТА рецепта (и полуфабрикатите): тръбите за 1 бр. изделие.
// pids събира ВСИЧКИ посетени продукти — за чертежите към изделието и децата му.
//
// ДВАТА реални шаблона (сверени с рецептите на Данко, 25.09):
//  1) ТРЪБЕН ВЪЗЕЛ: дете-изделие с „Тръба … L=685" в ИМЕТО, а в собствената
//     му рецепта — материалът (напр. „Тръба СВ 30 x 20 x 0.9", воден в КГ)
//     + операцията „Рязане лентоотрезна". Дължината се чете от ИМЕТО на
//     възела, спецификацията — от материала вътре, бройката = колко пъти
//     възелът влиза в изделието. Надолу не се слиза (тръбата му е хваната).
//  2) Изделието В ЗАЯВКАТА само е тръба („Тръба L = 1340", код 101619):
//     същото правило, приложено на корена — дължина от името на изделието,
//     спецификация от материала в рецептата му.
//  Резервен път: директен тръбен материален ред (L= в името на материала,
//  или ред в метри → мм), както досега.
function cutTubesForProduct(pid, mult, out, depth, pids) {
  if (!pid || depth > 6) return;
  if (pids) pids.add(pid);
  const prod = (typeof ERP !== "undefined" && ERP.prodById && ERP.prodById[pid]) || null;
  const lines = ((typeof ERP !== "undefined" && ERP.linesByProduct && ERP.linesByProduct[pid]) || []);
  // Шаблон 1/2: „тръбен възел" — името носи L=, рецептата му носи тръбата.
  const nameLen = prod ? cutLenFromName(prod.name) : 0;
  const isTubeNode = prod && /тръб/i.test(prod.name || "");
  if (nameLen && isTubeNode) {
    const tubeMat = lines.map(l => l.material_id ? ERP.matById[l.material_id] : null).find(m => m && cutIsTube(m)) || null;
    out.push({
      mat: tubeMat || { id: "node-" + pid, code: (prod.code || ""), name: prod.name, group_name: "Тръби" },
      fixedLen: nameLen, perCuts: mult,
      viaNode: `${prod.code || ""} ${prod.name || ""}`.trim(),
    });
    return;
  }
  lines.forEach(l => {
    if (l.material_id) {
      const m = ERP.matById[l.material_id];
      if (m && cutIsTube(m)) out.push({ mat: m, perQty: (Number(l.quantity) || 0) * mult, unit: String(l.unit || m.unit || "").toLowerCase() });
    } else if (l.child_product_id) {
      cutTubesForProduct(l.child_product_id, mult * (Number(l.quantity) || 1), out, depth + 1, pids);
    }
  });
}

/* Редовете на разкроя от избраните заявки. Ключ: материал + дължина.
   srcs пази и бройките ПО заявка — от тях се раждат етикетите за палетите. */
function cutCollect(orders) {
  const rows = new Map();
  const problems = [];
  const prodIds = new Set();
  orders.forEach(o => (o.lines || []).forEach(li => {
    const qty = erpToNum(li.qty) || 0;
    if (!qty || !li.productId) return;
    const tubes = [];
    cutTubesForProduct(li.productId, 1, tubes, 0, prodIds);
    if (!tubes.length) return;
    tubes.forEach(t => {
      let lenMm = 0, cuts = 0, note = "";
      if (t.fixedLen) {
        // Тръбен възел: L от името на възела/изделието, брой = възли × бройка.
        lenMm = t.fixedLen;
        cuts = Math.ceil((t.perCuts || 1) * qty);
        note = t.viaNode ? `възел ${t.viaNode}` : "";
      } else {
        lenMm = cutLenFromName(t.mat.name);
        if (lenMm) {
          cuts = Math.ceil(t.perQty * qty);              // бр. тръби на изделие × бройка
        } else if (/^м|^m\b|метра/.test(t.unit)) {
          lenMm = Math.round(t.perQty * 1000);           // метри на изделие → мм за 1 рязане
          cuts = qty;
          note = `${t.perQty} м на изделие`;
        } else {
          cuts = Math.ceil(t.perQty * qty);
          note = "⚠ дължината не се чете от рецептата — провери";
          problems.push(`${t.mat.name} (${o.ourNo || "—"} · ${li.name || li.code || ""})`);
        }
      }
      const key = `${t.mat.id}|${lenMm}`;
      const r = rows.get(key) || { matId: t.mat.id, code: t.mat.code || "", name: t.mat.name || "", lenMm, cuts: 0, note, srcs: [] };
      r.cuts += cuts;
      r.srcs.push({ client: o.clientName || "?", no: o.ourNo || "—", clientNo: o.clientNo || "", prodCode: li.code || "", prod: li.name || li.code || "?", prodQty: qty, cuts });
      if (note && !r.note) r.note = note;
      rows.set(key, r);
    });
  }));
  return { rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "bg") || a.lenMm - b.lenMm), problems, prodIds: [...prodIds] };
}

/* Чертежите на въвлечените изделия и полуфабрикати (products.drawings). */
async function cutDrawings(prodIds) {
  if (!prodIds.length) return [];
  const out = [];
  try {
    const { data } = await sb.from("products").select("id,code,name,drawings").in("id", prodIds).not("drawings", "is", null);
    (data || []).forEach(p => (Array.isArray(p.drawings) ? p.drawings : []).forEach(d => {
      if (d && d.url) out.push({ pid: p.id, pcode: p.code || "", pname: p.name || "", fname: d.name || "чертеж", type: d.type || "", url: d.url });
    }));
  } catch (e) { /* без чертежи — списъкът пак е валиден */ }
  return out;
}

/* Печат на файл от Storage: тегли се като blob (същият origin → може print). */
async function cutPrintFile(f) {
  try {
    const res = await fetch(f.url);
    const blob = await res.blob();
    const bu = URL.createObjectURL(blob);
    const w = window.open("", "_blank");
    if (!w) { alert("Браузърът блокира прозореца — разреши popups."); return; }
    if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.fname)) {
      w.location = bu;
      setTimeout(() => { try { w.print(); } catch (e) {} }, 1200);
    } else {
      w.document.write(`<html><head><title>${escapeHtml(f.fname)}</title><style>body{margin:0;text-align:center}img{max-width:100%;max-height:98vh}</style></head><body><img src="${bu}" onload="setTimeout(function(){window.print()},300)" /></body></html>`);
      w.document.close();
    }
  } catch (e) { alert(`Чертежът „${f.fname}" не се отвори: ` + (e.message || e)); }
}

/* Claude изглажда описанията (вид/сечение/дебелина) — числата НЕ се пипат. */
async function cutAIDescribe(names) {
  if (typeof palAI !== "function" || !names.length) return {};
  const txt = await palAI(
    `Разчиташ имена на тръбни материали от българско метало-производство. За всяко име върни вид (напр. „ГВ" горещовалцувана / „СВ" студеновалцувана / кръгла / профилна / INOX), сечение (напр. 30x30, ф25) и дебелина на стената в мм, АКО ги има в името. НЕ си измисляй липсващи стойности — null. Отговори САМО с JSON: {"<точното име>": {"vid": "...", "sechenie": "...", "debelina": "..."}}`,
    `Имена:\n${names.map(n => "• " + n).join("\n")}`, 1500);
  const m = txt.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

/* ---------- Екранът ---------- */
async function erpCutlistOpen() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  try { await erpEnsureLoaded(); } catch (e) {}
  try { if ((typeof erpCOList === "undefined" || !erpCOList) && typeof erpLoadCustomerOrders === "function") await erpLoadCustomerOrders(); } catch (e) {}
  if (CUT_TAB === "report") { await erpCutReport(v); return; }
  const list = ((typeof erpCOList !== "undefined" && erpCOList) || [])
    .filter(o => CUT_SHOWDONE || (o.status || "нова") !== "завършена")
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="cut-back">← Назад към заявките</button>
      <span class="erp-count">🪚 Подготовка за производство</span>
      <button class="btn btn-small btn-primary" id="cut-tab-cut">🪚 Разкрой</button>
      <button class="btn btn-small" id="cut-tab-rep" title="Бърз отчет на нарязаното — влиза в СЪЩАТА верига като отчитането в Цехове (задача, дневник, поточност), без дублиране">✅ Отчет на производство</button>
      <label class="erp-inline"><input type="checkbox" id="cut-showdone" ${CUT_SHOWDONE ? "checked" : ""} /> покажи и завършените</label>
      <span class="spacer"></span>
      <button class="btn btn-primary" id="cut-gen">🪚 Генерирай разкрой (<span id="cut-cnt">${CUT_SEL.size}</span>)</button>
    </div>
    <p class="hint">Отметни заявките (3-4 или колкото трябват) → „Генерирай разкрой". Системата минава през рецептите на изделията (и полуфабрикатите им) и вади тръбите: вид, размер за рязане и бройка = тръби на изделие × бройката от заявката. Списъкът се печата за Бинков.</p>
    <table class="report-table erp-table">
      <thead><tr><th></th><th>Наш №</th><th>Клиентски №</th><th>Клиент</th><th>Дата</th><th>Срок</th><th class="num">Редове</th><th>Статус</th></tr></thead>
      <tbody>${list.map(o => `<tr class="erp-clickable" data-cutrow="${escapeAttr(String(o.id))}">
        <td><input type="checkbox" class="cut-sel" data-cid="${escapeAttr(String(o.id))}" ${CUT_SEL.has(String(o.id)) ? "checked" : ""} /></td>
        <td><b>${escapeHtml(o.ourNo || "—")}</b></td>
        <td>${escapeHtml(o.clientNo || "—")}</td>
        <td>${escapeHtml(o.clientName || "—")}</td>
        <td>${erpDMY(o.date) || ""}</td>
        <td>${erpDMY(o.deadline) || "—"}</td>
        <td class="num">${(o.lines || []).length}</td>
        <td>${typeof erpCOStatusCell === "function" ? erpCOStatusCell(o) : escapeHtml(o.status || "нова")}</td>
      </tr>`).join("") || `<tr><td colspan="8" class="report-empty">Няма заявки.</td></tr>`}</tbody>
    </table>`;
  v.querySelector("#cut-back").addEventListener("click", () => erpRenderCustomerOrders());
  v.querySelector("#cut-tab-rep").addEventListener("click", () => { CUT_TAB = "report"; erpCutlistOpen(); });
  v.querySelector("#cut-showdone").addEventListener("change", e => { CUT_SHOWDONE = e.target.checked; erpCutlistOpen(); });
  const syncCnt = () => { const c = v.querySelector("#cut-cnt"); if (c) c.textContent = CUT_SEL.size; };
  v.querySelectorAll(".cut-sel").forEach(cb => cb.addEventListener("change", () => {
    if (cb.checked) CUT_SEL.add(cb.dataset.cid); else CUT_SEL.delete(cb.dataset.cid);
    syncCnt();
  }));
  v.querySelectorAll("tr[data-cutrow]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("input")) return;
    const cb = tr.querySelector(".cut-sel"); cb.checked = !cb.checked; cb.dispatchEvent(new Event("change"));
  }));
  v.querySelector("#cut-gen").addEventListener("click", erpCutlistGenerate);
}

async function erpCutlistGenerate() {
  const orders = ((typeof erpCOList !== "undefined" && erpCOList) || []).filter(o => CUT_SEL.has(String(o.id)));
  if (!orders.length) { alert("Отметни поне една заявка."); return; }
  const btn = document.getElementById("cut-gen");
  if (btn) { btn.disabled = true; btn.textContent = "🪚 смятам…"; }
  const { rows, problems, prodIds } = cutCollect(orders);
  let ai = {}, draws = [];
  if (rows.length) {
    if (btn) btn.textContent = "🤖 изглаждам описанията…";
    const jobs = [cutDrawings(prodIds)];
    try { const [d, a] = await Promise.all([cutDrawings(prodIds), cutAIDescribe([...new Set(rows.map(r => r.name))])]); draws = d; ai = a; }
    catch (e) { try { draws = await jobs[0]; } catch (e2) {} }
  }
  if (btn) { btn.disabled = false; btn.textContent = `🪚 Генерирай разкрой (${CUT_SEL.size})`; }
  if (!rows.length) {
    alert(`В рецептите на изделията от избраните заявки няма ТРЪБИ.\nПровери дали изделията имат рецепти (и дали тръбите са вписани като материали в тях).`);
    return;
  }
  const hdr = orders.map(o => `${o.clientName || "?"} №${o.ourNo || "—"}`).join(" · ");
  const aiBits = name => { const a = ai[name] || {}; return [a.vid, a.sechenie, a.debelina ? a.debelina + " мм" : ""].filter(Boolean).join(" · "); };
  const { wrap, close } = erpDialog(`
    <h3>🪚 Разкрой на тръби — преглед и редакция</h3>
    <p class="hint" style="margin:0 0 8px">Заявки: ${escapeHtml(hdr)} · Всичко долу се РЕДАКТИРА преди печат (име, размер, бройка). Бройките са: тръби на изделие × бройка от заявката.</p>
    ${problems.length ? `<p style="background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:8px">⚠ Без ясна дължина (провери рецептата): ${problems.slice(0, 4).map(escapeHtml).join(" · ")}${problems.length > 4 ? " …" : ""}</p>` : ""}
    <div style="max-height:40vh;overflow:auto">
    <table class="report-table erp-table" id="cut-table">
      <thead><tr><th>Тръба (вид · дебелина)</th><th class="num">L за рязане, мм</th><th class="num">Бройка</th><th title="Палетен лист: Поръчка №, Клиент, тръбата и бройката — Бинков го слага на палета">🏷 Етикет</th><th>За какво е</th><th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-ci="${i}">
        <td><input type="text" class="cut-nm" data-ci="${i}" value="${escapeAttr(r.name)}" style="width:230px" />${aiBits(r.name) ? `<div class="erp-muted" style="font-size:11px">${escapeHtml(aiBits(r.name))}</div>` : ""}</td>
        <td class="num"><input type="number" class="cut-len" data-ci="${i}" value="${r.lenMm || ""}" style="width:86px;font-weight:700" />${r.note ? `<div class="erp-muted" style="font-size:10.5px">${escapeHtml(r.note)}</div>` : ""}</td>
        <td class="num"><input type="number" class="cut-cnt" data-ci="${i}" value="${r.cuts}" style="width:76px;font-weight:700" /></td>
        <td style="text-align:center"><input type="checkbox" class="cut-lbl" data-ci="${i}" checked /></td>
        <td style="font-size:11.5px">${r.srcs.map(s => `${escapeHtml(`${s.client} №${s.no} · `)}${s.prodCode ? `<b class="t-code">${escapeHtml(s.prodCode)}</b> · ` : ""}${escapeHtml(`${s.prod} — ${erpNum(s.cuts)} разреза`)}`).join("<br>")}</td>
        <td><button type="button" class="btn btn-small" data-cutrm="${i}" title="Махни реда">×</button></td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${draws.length ? `<h4 class="erp-group-head" style="margin-top:10px">📄 Чертежи към изделията и полуфабрикатите — отметни за печат</h4>
    <div style="max-height:150px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px">
      ${draws.map((d, i) => `<label style="display:block;margin:2px 0"><input type="checkbox" class="cut-draw" data-di="${i}" /> <b>${escapeHtml(d.pcode)}</b> ${escapeHtml(d.pname)} — <span class="t-code">${escapeHtml(d.fname)}</span></label>`).join("")}
    </div>
    <p style="margin:6px 0"><button type="button" class="btn" id="cut-drawprint">🖨 Принтирай избраните чертежи (<span id="cut-drawcnt">0</span>)</button> <span class="hint">всеки чертеж се отваря и праща команда за печат — потвърждаваш принтера</span></p>` : `<p class="erp-muted" style="font-size:12px">📄 Изделията нямат качени чертежи (Склад детайли → 📎).</p>`}
    <div class="erp-dialog-actions">
      <button class="btn" id="cut-xls">⬇ Excel</button>
      <button class="btn" id="cut-labels">🏷 Печат етикети (<span id="cut-lblcnt">${rows.length}</span>)</button>
      <button class="btn btn-primary" id="cut-print">🖨 Печат за Бинков</button>
      <span class="spacer"></span>
      <button class="btn" id="cut-close">Затвори</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#cut-close").addEventListener("click", close);

  // Живите стойности се четат от полетата — каквото виждаш, това се печата.
  const live = () => rows.map((r, i) => {
    const g = cls => wrap.querySelector(`.${cls}[data-ci="${i}"]`);
    if (!wrap.querySelector(`tr[data-ci="${i}"]`)) return null;   // премахнат ред
    return { ...r, name: (g("cut-nm") || {}).value || r.name, lenMm: Number((g("cut-len") || {}).value) || 0, cuts: Number((g("cut-cnt") || {}).value) || 0, label: !!(g("cut-lbl") || {}).checked };
  }).filter(Boolean).filter(r => r.cuts > 0);
  wrap.querySelectorAll("[data-cutrm]").forEach(b => b.addEventListener("click", () => {
    const tr = wrap.querySelector(`tr[data-ci="${b.dataset.cutrm}"]`); if (tr) tr.remove();
    const lc = wrap.querySelector("#cut-lblcnt"); if (lc) lc.textContent = live().filter(r => r.label).length;
  }));
  wrap.querySelectorAll(".cut-lbl").forEach(cb => cb.addEventListener("change", () => {
    const lc = wrap.querySelector("#cut-lblcnt"); if (lc) lc.textContent = live().filter(r => r.label).length;
  }));

  // Чертежи: брояч + печат на всеки отметнат (blob → печат; потвърждаваш принтера).
  const dSync = () => { const c = wrap.querySelector("#cut-drawcnt"); if (c) c.textContent = wrap.querySelectorAll(".cut-draw:checked").length; };
  wrap.querySelectorAll(".cut-draw").forEach(cb => cb.addEventListener("change", dSync));
  const dp = wrap.querySelector("#cut-drawprint");
  if (dp) dp.addEventListener("click", async () => {
    const sel = [...wrap.querySelectorAll(".cut-draw:checked")].map(cb => draws[Number(cb.dataset.di)]).filter(Boolean);
    if (!sel.length) { alert("Отметни поне един чертеж."); return; }
    for (const f of sel) { await cutPrintFile(f); await new Promise(r => setTimeout(r, 800)); }
  });

  wrap.querySelector("#cut-xls").addEventListener("click", () => {
    const rws = live();
    const headers = ["Тръба", "Код", "Вид/дебелина (AI)", "L за рязане (мм)", "Бройка", "За какво е"];
    const body = rws.map(r => [r.name, r.code, aiBits(r.name), r.lenMm || "", r.cuts, r.srcs.map(s => `${s.client} №${s.no} · ${s.prodCode ? s.prodCode + " " : ""}${s.prod} — ${s.cuts}`).join(" | ")]);
    reportExportXls(`razkroy-trabi-${new Date().toISOString().slice(0, 10)}`, `Разкрой тръби · ${hdr}`, [{ headers, rows: body }]);
  });

  wrap.querySelector("#cut-print").addEventListener("click", () => {
    const rws = live();
    const body = `<style>.cutp td,.cutp th{font-size:17px;padding:8px 10px}.cutp .len{font-size:22px;font-weight:800}.cutp .cnt{font-size:22px;font-weight:800}</style>
      <div class="head"><div><h1>РАЗКРОЙ ТРЪБИ</h1><div>${escapeHtml(hdr)}</div></div>
      <div style="text-align:right">Дата: <b>${escapeHtml(new Date().toLocaleDateString("bg-BG"))}</b><br>Изготвил: ${escapeHtml((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "")}</div></div>
      <table class="cutp"><thead><tr><th>Тръба</th><th>L за рязане</th><th>Бройка</th><th>Готово ✓</th></tr></thead>
      <tbody>${rws.map(r => { const bits = aiBits(r.name);
        return `<tr><td><b>${escapeHtml(r.name)}</b>${bits ? `<br><small>${escapeHtml(bits)}</small>` : ""}</td><td class="len">${r.lenMm ? erpNum(r.lenMm) + " мм" : "?"}</td><td class="cnt">${erpNum(r.cuts)} бр.</td><td style="width:70px"></td></tr>`; }).join("")}</tbody></table>
      ${problems.length ? `<p><b>⚠ Провери:</b> ${problems.map(escapeHtml).join(" · ")}</p>` : ""}`;
    if (typeof invPrintWindow === "function") invPrintWindow("Разкрой тръби", body, "bg", { noLogo: false, noMade: true });
  });

  // 🏷 Палетните етикети: по един ЛИСТ за всяка отметната тръба И всяка заявка
  // в нея (Бинков го слага на палета с нарязаното → тръгва към следваща операция).
  wrap.querySelector("#cut-labels").addEventListener("click", () => {
    const rws = live().filter(r => r.label);
    if (!rws.length) { alert("Отметни поне един ред в колоната 🏷 Етикет."); return; }
    const pages = [];
    rws.forEach(r => {
      const many = r.srcs.length > 1;
      r.srcs.forEach(s => pages.push(`
        <div class="lblpage">
          <div class="lbl-top">ПОРЪЧКА № <b>${escapeHtml(s.no)}</b>${s.clientNo ? ` <span class="lbl-sub">/ клиентски № ${escapeHtml(s.clientNo)}</span>` : ""}</div>
          <div class="lbl-cl">КЛИЕНТ: <b>${escapeHtml(s.client)}</b></div>
          <div class="lbl-tube">${escapeHtml(r.name)}</div>
          <div class="lbl-len">${r.lenMm ? "L = " + erpNum(r.lenMm) + " мм" : ""} — ${erpNum(many ? s.cuts : r.cuts)} БРОЯ</div>
          <div class="lbl-for">за: ${s.prodCode ? "<b>" + escapeHtml(s.prodCode) + "</b> · " : ""}${escapeHtml(s.prod)} × ${erpNum(s.prodQty)}</div>
          <div class="lbl-date">рязано на ${escapeHtml(new Date().toLocaleDateString("bg-BG"))} · след рязане → следваща операция</div>
        </div>`));
    });
    const w = window.open("", "_blank");
    if (!w) { alert("Браузърът блокира прозореца за печат."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Палетни етикети — разкрой</title><style>
      body{font-family:Arial,sans-serif;margin:0;color:#000}
      .lblpage{page-break-after:always;padding:40px 46px;box-sizing:border-box;min-height:96vh;display:flex;flex-direction:column;justify-content:center;gap:18px;border:4px solid #000;margin:6px}
      .lbl-top{font-size:34px} .lbl-top b{font-size:44px}
      .lbl-sub{font-size:22px;color:#333}
      .lbl-cl{font-size:34px} .lbl-cl b{font-size:44px}
      .lbl-tube{font-size:40px;font-weight:800;border-top:3px solid #000;border-bottom:3px solid #000;padding:16px 0}
      .lbl-len{font-size:54px;font-weight:900}
      .lbl-for{font-size:26px;color:#222}
      .lbl-date{font-size:16px;color:#555}
      .noprint{position:fixed;top:8px;right:8px;padding:8px 16px;font-size:15px}
      @media print{.noprint{display:none} .lblpage{min-height:auto;height:96vh}}
    </style></head><body>${pages.join("")}<button class="noprint" onclick="window.print()">🖨 Печат (${pages.length} листа)</button></body></html>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  });
}

/* ================== ✅ ОТЧЕТ НА ПРОИЗВОДСТВО (рязането) ==================
   Григор отчита ВМЕСТО операторите, които не работят със Системата (Бинков).
   ЕДНА верига, нула дублиране: тук се виждат ЖИВИТЕ задачи на цеха
   РАЗКРОЙ ТРЪБИ / Рязане / Лентоотрезна (същите, които виждат Цехове), а
   бутонът „✅ Отчети" вика logProduction() — СЪЩАТА функция като в Цехове:
   поточният гейт, предупреждението за материал, produced, дневникът
   production_log (worker = Бинков) и пускането на следващата операция си
   работят. Отчетеното тук се вижда веднага в Цехове и обратно. */
async function erpCutReport(v) {
  try { if (typeof tLoadTasks === "function") await tLoadTasks(); } catch (e) {}
  const all = (typeof TASKS !== "undefined" && Array.isArray(TASKS) ? TASKS : []);
  const mine = all.filter(t => CUT_WS_RE.test(`${t.workshop || ""} ${t.operation || ""}`));
  const rows = mine
    .filter(t => CUT_REP_DONE || (typeof taskStatus === "function" ? taskStatus(t) !== "done" : true))
    .sort((a, b) => String((taskOrderNos(b)[0]) || "").localeCompare(String((taskOrderNos(a)[0]) || ""), "bg", { numeric: true })
      || String(a.code || "").localeCompare(String(b.code || ""), "bg"));
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="cut-back">← Назад към заявките</button>
      <span class="erp-count">🪚 Подготовка за производство</span>
      <button class="btn btn-small" id="cut-tab-cut">🪚 Разкрой</button>
      <button class="btn btn-small btn-primary" id="cut-tab-rep">✅ Отчет на производство</button>
      <label class="erp-inline">Оператор: <input type="text" id="cut-rep-worker" value="Бинков" style="width:110px" title="От чие име се пише отчетът в дневника" /></label>
      <label class="erp-inline"><input type="checkbox" id="cut-rep-done" ${CUT_REP_DONE ? "checked" : ""} /> и завършените</label>
      <span class="spacer"></span>
      <button class="btn btn-small" id="cut-rep-refresh">↻ Опресни</button>
    </div>
    <p class="hint">Живите задачи на цеха <b>РАЗКРОЙ ТРЪБИ / Рязане / Лентоотрезна</b> — същите като в Цехове. „✅ Отчети" минава по СЪЩАТА верига (дневник, поточност, следваща операция) — без дублиране: каквото се отчете тук, го вижда цялата Система.</p>
    <table class="report-table erp-table">
      <thead><tr><th>Заявка</th><th>Код</th><th>Изделие / детайл</th><th>Операция</th><th>Цех</th><th class="num">План</th><th class="num">Отчетено</th><th class="num">Остава</th><th class="num">Днес бр.</th><th></th></tr></thead>
      <tbody>${rows.map(t => {
        const q = Number(t.qty) || 0, pr = Number(t.produced) || 0, left = Math.max(0, q - pr);
        const done = typeof taskStatus === "function" && taskStatus(t) === "done";
        return `<tr${done ? ' style="opacity:.55"' : ""}>
          <td>${taskOrderNos(t).map(escapeHtml).join(", ") || "—"}<div class="erp-muted" style="font-size:11px">${escapeHtml(t.client || "")}</div></td>
          <td class="t-code"><b>${escapeHtml(t.code || "—")}</b></td>
          <td>${escapeHtml(t.product || "")}</td>
          <td>${escapeHtml(t.operation || "")}</td>
          <td>${escapeHtml(t.workshop || "")}</td>
          <td class="num">${erpNum(q)}</td>
          <td class="num"><b>${erpNum(pr)}</b></td>
          <td class="num" style="font-weight:700;${left ? "color:#b45309" : "color:#166534"}">${erpNum(left)}</td>
          <td class="num">${done ? "" : `<input type="number" class="cut-rep-qty" data-tid="${escapeAttr(String(t.id))}" min="0" step="1" placeholder="${left || ""}" style="width:80px;font-weight:700" />`}</td>
          <td class="erp-row-actions">${done ? `<span class="erp-co-status" style="background:#dcfce7;color:#166534">✓ готово</span>` : `<button class="btn btn-small btn-primary" data-repgo="${escapeAttr(String(t.id))}">✅ Отчети</button>`}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="10" class="report-empty">Няма задачи за рязане${CUT_REP_DONE ? "" : " (пробвай отметката за завършените)"}. Задачите се раждат при пускане на заявка в производство.</td></tr>`}</tbody>
    </table>`;
  v.querySelector("#cut-back").addEventListener("click", () => erpRenderCustomerOrders());
  v.querySelector("#cut-tab-cut").addEventListener("click", () => { CUT_TAB = "cut"; erpCutlistOpen(); });
  v.querySelector("#cut-rep-refresh").addEventListener("click", () => erpCutlistOpen());
  v.querySelector("#cut-rep-done").addEventListener("change", e => { CUT_REP_DONE = e.target.checked; erpCutlistOpen(); });
  v.querySelectorAll("[data-repgo]").forEach(b => b.addEventListener("click", async () => {
    const t = all.find(x => String(x.id) === b.dataset.repgo);
    if (!t) return;
    const inp = v.querySelector(`.cut-rep-qty[data-tid="${b.dataset.repgo}"]`);
    const qty = Number(inp && inp.value);
    if (!(qty > 0)) { alert("Напиши колко броя са нарязани днес."); return; }
    const worker = (v.querySelector("#cut-rep-worker").value || "Бинков").trim();
    const before = Number(t.produced) || 0;
    b.disabled = true; b.textContent = "записвам…";
    try {
      await logProduction(t, qty, { origin: "Подготовка за производство" }, { worker });
    } catch (e) { alert("Грешка при отчитане: " + (e.message || e)); }
    b.disabled = false; b.textContent = "✅ Отчети";
    if ((Number(t.produced) || 0) > before) erpCutlistOpen();   // успех → свежи числа
  }));
}
