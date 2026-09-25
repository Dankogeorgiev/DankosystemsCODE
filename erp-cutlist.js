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

/* ---------- Събиране на тръбите ---------- */
function cutIsTube(m) { return /тръб/i.test(`${m.name || ""} ${m.group_name || ""}`); }
function cutLenFromName(name) {
  const m = String(name || "").match(/L\s*=?\s*(\d{3,5})(?!\d)/i);
  return m ? Number(m[1]) : 0;
}
// Рекурсивно през рецептата (и полуфабрикатите): тръбите за 1 бр. изделие.
function cutTubesForProduct(pid, mult, out, depth) {
  if (!pid || depth > 6) return;
  ((typeof ERP !== "undefined" && ERP.linesByProduct && ERP.linesByProduct[pid]) || []).forEach(l => {
    if (l.material_id) {
      const m = ERP.matById[l.material_id];
      if (m && cutIsTube(m)) out.push({ mat: m, perQty: (Number(l.quantity) || 0) * mult, unit: String(l.unit || m.unit || "").toLowerCase() });
    } else if (l.child_product_id) {
      cutTubesForProduct(l.child_product_id, mult * (Number(l.quantity) || 1), out, depth + 1);
    }
  });
}

/* Редовете на разкроя от избраните заявки. Ключ: материал + дължина. */
function cutCollect(orders) {
  const rows = new Map();
  const problems = [];
  orders.forEach(o => (o.lines || []).forEach(li => {
    const qty = erpToNum(li.qty) || 0;
    if (!qty || !li.productId) return;
    const tubes = [];
    cutTubesForProduct(li.productId, 1, tubes, 0);
    if (!tubes.length) return;
    tubes.forEach(t => {
      let lenMm = cutLenFromName(t.mat.name);
      let cuts = 0, note = "";
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
      const key = `${t.mat.id}|${lenMm}`;
      const r = rows.get(key) || { matId: t.mat.id, code: t.mat.code || "", name: t.mat.name || "", lenMm, cuts: 0, note, srcs: [] };
      r.cuts += cuts;
      r.srcs.push(`${o.clientName || "?"} №${o.ourNo || "—"} · ${li.name || li.code || "?"} ×${erpNum(qty)}`);
      if (note && !r.note) r.note = note;
      rows.set(key, r);
    });
  }));
  return { rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "bg") || a.lenMm - b.lenMm), problems };
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
  const list = ((typeof erpCOList !== "undefined" && erpCOList) || [])
    .filter(o => CUT_SHOWDONE || (o.status || "нова") !== "завършена")
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  v.innerHTML = `
    <div class="erp-toolbar">
      <button class="btn btn-small" id="cut-back">← Назад към заявките</button>
      <span class="erp-count">🪚 Подготовка за производство — разкрой на тръби</span>
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
  const { rows, problems } = cutCollect(orders);
  let ai = {};
  if (rows.length) {
    if (btn) btn.textContent = "🤖 изглаждам описанията…";
    try { ai = await cutAIDescribe([...new Set(rows.map(r => r.name))]); } catch (e) { /* и без AI списъкът е верен */ }
  }
  if (btn) { btn.disabled = false; btn.textContent = `🪚 Генерирай разкрой (${CUT_SEL.size})`; }
  if (!rows.length) {
    alert(`В рецептите на изделията от избраните заявки няма ТРЪБИ.\nПровери дали изделията имат рецепти (и дали тръбите са вписани като материали в тях).`);
    return;
  }
  const hdr = orders.map(o => `${o.clientName || "?"} №${o.ourNo || "—"}`).join(" · ");
  const cell = r => {
    const a = ai[r.name] || {};
    const bits = [a.vid, a.sechenie, a.debelina ? a.debelina + " мм" : ""].filter(Boolean).join(" · ");
    return `<b>${escapeHtml(r.name)}</b>${bits ? `<div class="erp-muted" style="font-size:11px">${escapeHtml(bits)}</div>` : ""}${r.code ? `<div class="t-code" style="font-size:11px">${escapeHtml(r.code)}</div>` : ""}`;
  };
  const { wrap, close } = erpDialog(`
    <h3>🪚 Разкрой на тръби</h3>
    <p class="hint" style="margin:0 0 8px">Заявки: ${escapeHtml(hdr)} · Бройките са: тръби на изделие × бройка от заявката.</p>
    ${problems.length ? `<p style="background:#fef3c7;color:#92400e;padding:6px 10px;border-radius:8px">⚠ Без ясна дължина (провери рецептата): ${problems.slice(0, 4).map(escapeHtml).join(" · ")}${problems.length > 4 ? " …" : ""}</p>` : ""}
    <div style="max-height:52vh;overflow:auto">
    <table class="report-table erp-table">
      <thead><tr><th>Тръба (вид · дебелина)</th><th class="num">Размер за рязане</th><th class="num">Бройка</th><th>За какво е</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${cell(r)}</td>
        <td class="num" style="font-size:16px"><b>${r.lenMm ? "L = " + erpNum(r.lenMm) + " мм" : "?"}</b>${r.note ? `<div class="erp-muted" style="font-size:11px">${escapeHtml(r.note)}</div>` : ""}</td>
        <td class="num" style="font-size:16px"><b>${erpNum(r.cuts)}</b></td>
        <td style="font-size:11.5px">${r.srcs.map(escapeHtml).join("<br>")}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="erp-dialog-actions">
      <button class="btn" id="cut-xls">⬇ Excel</button>
      <button class="btn btn-primary" id="cut-print">🖨 Печат за Бинков</button>
      <span class="spacer"></span>
      <button class="btn" id="cut-close">Затвори</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  wrap.querySelector("#cut-close").addEventListener("click", close);
  wrap.querySelector("#cut-xls").addEventListener("click", () => {
    const headers = ["Тръба", "Код", "Вид/дебелина (AI)", "L за рязане (мм)", "Бройка", "За какво е"];
    const body = rows.map(r => { const a = ai[r.name] || {}; return [r.name, r.code, [a.vid, a.sechenie, a.debelina].filter(Boolean).join(" "), r.lenMm || "", r.cuts, r.srcs.join(" | ")]; });
    reportExportXls(`razkroy-trabi-${new Date().toISOString().slice(0, 10)}`, `Разкрой тръби · ${hdr}`, [{ headers, rows: body }]);
  });
  wrap.querySelector("#cut-print").addEventListener("click", () => {
    const body = `<style>.cutp td,.cutp th{font-size:17px;padding:8px 10px}.cutp .len{font-size:22px;font-weight:800}.cutp .cnt{font-size:22px;font-weight:800}</style>
      <div class="head"><div><h1>РАЗКРОЙ ТРЪБИ</h1><div>${escapeHtml(hdr)}</div></div>
      <div style="text-align:right">Дата: <b>${escapeHtml(new Date().toLocaleDateString("bg-BG"))}</b><br>Изготвил: ${escapeHtml((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "")}</div></div>
      <table class="cutp"><thead><tr><th>Тръба</th><th>L за рязане</th><th>Бройка</th><th>Готово ✓</th></tr></thead>
      <tbody>${rows.map(r => { const a = ai[r.name] || {}; const bits = [a.vid, a.sechenie, a.debelina ? a.debelina + " мм" : ""].filter(Boolean).join(" · ");
        return `<tr><td><b>${escapeHtml(r.name)}</b>${bits ? `<br><small>${escapeHtml(bits)}</small>` : ""}</td><td class="len">${r.lenMm ? erpNum(r.lenMm) + " мм" : "?"}</td><td class="cnt">${erpNum(r.cuts)} бр.</td><td style="width:70px"></td></tr>`; }).join("")}</tbody></table>
      ${problems.length ? `<p><b>⚠ Провери:</b> ${problems.map(escapeHtml).join(" · ")}</p>` : ""}`;
    if (typeof invPrintWindow === "function") invPrintWindow("Разкрой тръби", body, "bg", { noLogo: false, noMade: true });
  });
}
