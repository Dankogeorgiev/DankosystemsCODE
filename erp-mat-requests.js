/* Данко Системс — „Заявки за материали" (снабдяване).
   Регистър на всички запитвания/заявки към доставчици за материали: кой, кога,
   какво е поискал, от кого, кога се очаква да дойде и докъде е стигнало
   (запитване → поръчано → доставено). Пуска се от таб „Заявки за материали",
   от „Липсващи материали по заявки" (избор с отметки) или от бутона на
   началния екран. Клик върху ред = редакция (както при Заявките).
   Пази се в app_config id="mat_requests": { list:[...] }. */

let MATREQ = null;

async function matreqLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "mat_requests").maybeSingle(); MATREQ = (data && data.data && data.data.list) || []; }
  catch (e) { MATREQ = []; }
}
async function matreqSave() {
  const { error } = await sb.from("app_config").upsert({ id: "mat_requests", data: { list: MATREQ || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function matreqNextId() { let m = 0; (MATREQ || []).forEach(p => { if ((Number(p.id) || 0) > m) m = Number(p.id); }); return m + 1; }
function matreqToday() { return new Date().toISOString().slice(0, 10); }
function matreqFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }

const MATREQ_STATUSES = ["запитване", "поръчано", "доставено"];

/* ---------- Регистърът (таб „Заявки за материали") ---------- */
async function erpRenderMatRequests() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await matreqLoad();
  const today = matreqToday();
  const active = (MATREQ || []).filter(r => r.status !== "доставено").sort((a, b) => String(a.expected || "9999").localeCompare(b.expected || "9999"));
  const done = (MATREQ || []).filter(r => r.status === "доставено").sort((a, b) => String(b.arrivedAt || "").localeCompare(a.arrivedAt || "")).slice(0, 40);

  const itemsCell = r => (r.items || []).map(i => `<span class="mm-order">${escapeHtml((i.code ? i.code + " " : "") + (i.name || ""))} · ${erpNum(i.qty)} ${escapeHtml(i.unit || "")}</span>`).join(" ") || '<span class="erp-muted">(виж съобщението — клик върху реда)</span>';
  const stBadge = r => {
    if (r.status === "доставено") return '<span class="erp-co-status" style="background:#dcfce7;color:#166534">доставено</span>';
    if (r.status === "поръчано") return '<span class="erp-co-status" style="background:#dbeafe;color:#1e40af">поръчано</span>';
    return '<span class="erp-co-status" style="background:#fef3c7;color:#92400e">запитване</span>';
  };
  const row = (r, isDone) => {
    const overdue = !isDone && r.expected && r.expected < today;
    return `<tr class="erp-clickable ${overdue ? "pay-overdue" : ""}" data-mr-open="${r.id}" title="Клик = отвори за редакция">
      <td>${matreqFmt(r.date)}</td>
      <td><b>${escapeHtml(r.supplier || "—")}</b>${r.sentBy ? `<div class="erp-muted" style="font-size:11px">от ${escapeHtml(r.sentBy)}</div>` : ""}</td>
      <td>${itemsCell(r)}</td>
      <td>${stBadge(r)}${r.emailSent ? ' <span title="Изпратен е имейл">✉</span>' : ""}</td>
      <td>${isDone ? matreqFmt(r.arrivedAt) : (r.expected ? `<b>${matreqFmt(r.expected)}</b>${overdue ? ' <span class="pay-neg">⚠ закъснява</span>' : ""}` : '<span class="erp-muted">—</span>')}</td>
      <td class="erp-row-actions">
        ${!isDone && r.status === "запитване" ? `<button class="btn btn-small" data-mr-ord="${r.id}" title="Отбележи като поръчано и въведи кога ще дойде">📦 Поръчано</button>` : ""}
        ${!isDone ? `<button class="btn btn-small btn-primary" data-mr-done="${r.id}" title="Материалът е дошъл">✅ Доставено</button>` : ""}
        ${!isDone ? `<button class="btn btn-small" data-mr-exp="${r.id}" title="Промени очакваната дата">📅</button>` : ""}
        <button class="btn btn-small btn-danger" data-mr-del="${r.id}">×</button>
      </td></tr>`;
  };

  v.innerHTML = `
    <div class="erp-toolbar">
      <span class="erp-count">📨 Заявки за материали — ${active.length} активни</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="mr-new">+ Нова заявка към доставчик</button>
    </div>
    <p class="hint">Всички запитвания и заявки за материали на едно място — кой какво е поискал, кога и <b>кога ще дойде</b>. „⚠ закъснява" = очакваната дата е минала, а не е доставено. <b>Клик върху ред = редакция.</b> Пуска се и от „Липсващи материали по заявки" (с отметките).</p>
    <h4 class="erp-group-head">⏳ Активни (${active.length})</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>Доставчик</th><th>Материали</th><th>Статус</th><th>Очаква се</th><th></th></tr></thead>
      <tbody>${active.map(r => row(r, false)).join("") || `<tr><td colspan="6" class="report-empty">Няма активни заявки. Пусни от бутона горе или от Липсващи материали.</td></tr>`}</tbody>
    </table>
    ${done.length ? `<h4 class="erp-group-head">✅ Доставени (последните ${done.length})</h4>
    <table class="report-table erp-table">
      <thead><tr><th>Дата</th><th>Доставчик</th><th>Материали</th><th>Статус</th><th>Дошло на</th><th></th></tr></thead>
      <tbody>${done.map(r => row(r, true)).join("")}</tbody>
    </table>` : ""}`;

  document.getElementById("mr-new").addEventListener("click", () => erpMatReqCompose([]));
  // Клик върху реда (извън бутоните) → редакция на заявката.
  v.querySelectorAll("tr[data-mr-open]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    const r = MATREQ.find(x => x.id === Number(tr.dataset.mrOpen)); if (!r) return;
    erpMatReqCompose(r.items || [], r);
  }));
  v.querySelectorAll("[data-mr-ord]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrOrd)); if (!r) return;
    const d = prompt("Кога ще дойде? (ГГГГ-ММ-ДД):", r.expected || "");
    if (d === null) return;
    r.status = "поръчано"; r.expected = (d || "").trim();
    if (await matreqSave()) erpRenderMatRequests();
  }));
  v.querySelectorAll("[data-mr-done]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrDone)); if (!r) return;
    r.status = "доставено"; r.arrivedAt = matreqToday();
    if (await matreqSave()) erpRenderMatRequests();
  }));
  v.querySelectorAll("[data-mr-exp]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrExp)); if (!r) return;
    const d = prompt("Очаквана дата на доставка (ГГГГ-ММ-ДД):", r.expected || "");
    if (d === null) return;
    r.expected = (d || "").trim();
    if (await matreqSave()) erpRenderMatRequests();
  }));
  v.querySelectorAll("[data-mr-del]").forEach(b => b.addEventListener("click", async () => {
    const r = MATREQ.find(x => x.id === Number(b.dataset.mrDel)); if (!r) return;
    if (!confirm(`Да изтрия ли заявката към ${r.supplier || "—"} от ${matreqFmt(r.date)}?`)) return;
    MATREQ = MATREQ.filter(x => x.id !== r.id);
    if (await matreqSave()) erpRenderMatRequests();
  }));
}

/* ---------- Избор на материали (от „🧱 Добави материали" в прозореца) ---------- */
// onDone(items) — извиква се с избраните; без onDone отваря прозореца за заявка.
function erpMatReqPickMaterials(onDone) {
  const chosen = {};   // mid -> qty
  const { wrap, close } = erpDialog(`
    <h3>Избери материали за заявката</h3>
    <input type="search" id="mrp-q" placeholder="търси код или име…" />
    <div id="mrp-list" class="erp-lp-list" style="max-height:46vh;overflow:auto"></div>
    <div id="mrp-chosen" class="hint" style="margin-top:6px"></div>
    <div class="erp-dialog-actions"><button class="btn" id="mrp-cancel">Отказ</button><button class="btn btn-primary" id="mrp-next">Добави ✓</button></div>`);
  const chosenBox = wrap.querySelector("#mrp-chosen");
  const renderChosen = () => {
    const ids = Object.keys(chosen);
    chosenBox.innerHTML = ids.length ? "Избрани: " + ids.map(id => { const m = ERP.matById[id] || {}; return `<b>${escapeHtml(m.code || "")}</b> ×${erpNum(chosen[id])}`; }).join(", ") : "Нищо избрано още — цъкни материал от списъка.";
  };
  const render = q => {
    q = (q || "").toLowerCase().trim();
    let list = (ERP.materials || []).slice();
    if (q) list = list.filter(m => ((m.code || "") + " " + (m.name || "")).toLowerCase().includes(q));
    list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "bg"));
    wrap.querySelector("#mrp-list").innerHTML = list.slice(0, 80).map(m =>
      `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">нал. ${erpNum(m.stock || 0)} ${escapeHtml(m.unit || "")}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения.</p>`;
    wrap.querySelectorAll(".erp-lp-item").forEach(b => b.addEventListener("click", () => {
      const m = ERP.matById[Number(b.dataset.id)];
      const q2 = prompt(`Количество за ${m.code || ""} ${m.name || ""} (${m.unit || "бр."}):`, "");
      if (q2 === null) return;
      const n = erpToNum(q2) || 0;
      if (n > 0) chosen[m.id] = n; else delete chosen[m.id];
      renderChosen();
    }));
  };
  render(""); renderChosen();
  wrap.querySelector("#mrp-q").addEventListener("input", e => render(e.target.value));
  wrap.querySelector("#mrp-cancel").addEventListener("click", close);
  wrap.querySelector("#mrp-next").addEventListener("click", () => {
    const items = Object.keys(chosen).map(id => { const m = ERP.matById[id] || {}; return { materialId: Number(id), code: m.code || "", name: m.name || "", unit: m.unit || "", qty: chosen[id] }; });
    if (!items.length) { alert("Избери поне един материал."); return; }
    close();
    if (typeof onDone === "function") onDone(items); else erpMatReqCompose(items);
  });
}

/* ---------- Прозорецът за заявка (нов запис И редакция) ----------
   rec = съществуващ запис от регистъра → режим редакция (клик върху ред). */
async function erpMatReqCompose(startItems, rec) {
  const items = (startItems || []).slice();
  let suppliers = [];
  try { suppliers = await erpLoadSuppliers(); } catch (e) {}
  const bullet = i => `• ${i.code ? i.code + " " : ""}${i.name} — ${erpNum(i.qty)} ${i.unit || ""}`;
  const myCc = (typeof erpMailMyCc === "function") ? erpMailMyCc() : "";
  const edit = !!rec;
  const defMsg = `Здравейте,

Молим за потвърждение и доставка на следните материали:

${items.map(bullet).join("\n")}

Моля, потвърдете наличност, единични цени и срок на доставка.

Поздрави,
Данко Системс`;
  const msg = (edit && rec.msg) ? rec.msg : defMsg;
  const { wrap, close } = erpDialog(`
    <h3>${edit ? "✎ Заявка към доставчик — редакция" : "✉ Заявка за материали към доставчик"}</h3>
    ${edit ? `<p class="erp-muted" style="margin:-6px 0 8px">Създадена на ${matreqFmt(rec.date)}${rec.sentBy ? " от " + escapeHtml(rec.sentBy) : ""}${rec.emailSent ? " · ✉ имейлът е изпратен" : " · без изпратен имейл"}</p>` : ""}
    <div class="erp-co-grid">
      <label>Доставчик <input type="text" id="mq-supplier" list="mq-sups" placeholder="избери или напиши" value="${edit ? escapeAttr(rec.supplier || "") : ""}" />
        <datalist id="mq-sups">${suppliers.map(s => `<option value="${escapeAttr(s.name)}"></option>`).join("")}</datalist></label>
      <label>Имейл <input type="email" id="mq-email" placeholder="имейл на доставчика" value="${edit ? escapeAttr(rec.supplierEmail || "") : ""}" /></label>
      <label>Очаквана доставка (ако знаеш) <input type="date" id="mq-expected" value="${edit ? escapeAttr(rec.expected || "") : ""}" /></label>
      ${edit ? `<label>Статус <select id="mq-status">${MATREQ_STATUSES.map(s => `<option value="${s}" ${rec.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>` : ""}
    </div>
    <label>Съобщение <button type="button" class="btn btn-small" id="mq-additems" style="float:right" title="Избери материали от склада — добавят се като редове в съобщението">🧱 Добави материали</button>
      <textarea id="mq-text" rows="9">${escapeHtml(msg)}</textarea></label>
    ${myCc ? `<p class="hint" style="margin:6px 0 0">📩 Копие ще получиш и ти: <b>${escapeHtml(myCc)}</b></p>` : ""}
    <div id="mq-result" style="margin-top:8px"></div>
    <div class="erp-dialog-actions">
      <button class="btn" id="mq-cancel">Отказ</button>
      <button class="btn" id="mq-saveonly" title="${edit ? "Записва промените без имейл" : "Записва в регистъра без да изпраща имейл (пратено по телефон/viber)"}">💾 ${edit ? "Запази промените" : "Само запиши"}</button>
      <button class="btn btn-primary" id="mq-send">📤 Изпрати и запиши</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-wide");
  // Имейлът на доставчика от партньорите (при избор по име).
  wrap.querySelector("#mq-supplier").addEventListener("change", async e => {
    if (typeof erpPartnerEmail !== "function") return;
    const rec2 = await erpPartnerEmail("supplier", null, e.target.value);
    if (rec2 && rec2.email && !wrap.querySelector("#mq-email").value) wrap.querySelector("#mq-email").value = rec2.email;
  });
  wrap.querySelector("#mq-cancel").addEventListener("click", close);
  // Добавяне на материали → и в списъка, и като редове в съобщението.
  wrap.querySelector("#mq-additems").addEventListener("click", () => {
    erpMatReqPickMaterials(newItems => {
      newItems.forEach(n => items.push(n));
      const ta = wrap.querySelector("#mq-text");
      const lines = ta.value.split("\n");
      let idx = -1;
      lines.forEach((l, i) => { if (l.trim().indexOf("•") === 0) idx = i; });
      if (idx === -1) { const j = lines.findIndex(l => l.indexOf("материали:") >= 0); idx = j >= 0 ? j + 1 : lines.length - 1; }
      lines.splice(idx + 1, 0, ...newItems.map(bullet));
      ta.value = lines.join("\n");
    });
  });
  const collect = () => ({
    supplier: wrap.querySelector("#mq-supplier").value.trim(),
    supplierEmail: wrap.querySelector("#mq-email").value.trim(),
    expected: wrap.querySelector("#mq-expected").value || "",
    msg: wrap.querySelector("#mq-text").value,
    items,
  });
  const saveRec = async (sent) => {
    if (edit) {
      Object.assign(rec, collect());
      const st = wrap.querySelector("#mq-status");
      if (st) {
        rec.status = st.value;
        if (rec.status === "доставено") rec.arrivedAt = rec.arrivedAt || matreqToday();
        else rec.arrivedAt = "";
      }
      if (sent) { rec.emailSent = true; rec.sentAt = new Date().toISOString(); }
      return matreqSave();
    }
    await matreqLoad();
    MATREQ.push(Object.assign({
      id: matreqNextId(), date: matreqToday(), status: "запитване",
      sentBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "", sentAt: new Date().toISOString(),
      emailSent: !!sent,
    }, collect()));
    return matreqSave();
  };
  const refresh = () => { if (ERP.tab === "matreq") erpRenderMatRequests(); };
  wrap.querySelector("#mq-saveonly").addEventListener("click", async () => {
    if (await saveRec(false)) { close(); if (!edit) alert("✅ Записано в регистъра Заявки за материали (без имейл)."); refresh(); }
  });
  wrap.querySelector("#mq-send").addEventListener("click", async () => {
    const to = wrap.querySelector("#mq-email").value.trim();
    if (!to) { alert("Въведи имейл на доставчика (или запиши без имейл)."); return; }
    const btn = wrap.querySelector("#mq-send"); btn.disabled = true; btn.textContent = "Изпращам…";
    const r = (typeof erpMailSend === "function")
      ? await erpMailSend({ to, subject: "Заявка за доставка на материали — Данко Системс", text: wrap.querySelector("#mq-text").value, direct: true })
      : { ok: false, error: "Имейл модулът не е зареден." };
    btn.disabled = false; btn.textContent = "📤 Изпрати и запиши";
    const res = wrap.querySelector("#mq-result");
    if (r.ok) {
      await saveRec(true);
      res.innerHTML = '<div style="background:#dcfce7;color:#166534;padding:8px 10px;border-radius:8px">✓ Изпратено и записано в регистъра!</div>';
      setTimeout(() => { close(); refresh(); }, 900);
    } else {
      const why = (typeof erpMailExplain === "function") ? erpMailExplain(r.error) : "";
      res.innerHTML = `<div style="background:#fef2f2;color:#991b1b;padding:8px 10px;border-radius:8px">✗ ${escapeHtml(r.error)}${why ? `<br>👉 <b>${escapeHtml(why)}</b>` : ""}<br><span class="erp-muted">Можеш да запишеш без имейл и да пратиш по друг канал.</span></div>`;
    }
  });
}

/* ---------- Бутонът на началния екран (на мястото на „План материали") ---------- */
function matreqInit() {
  const b = document.getElementById("btn-matreq");
  if (b && !b._mrWired) {
    b._mrWired = true;
    b.addEventListener("click", async () => {
      ERP.tab = "matreq";
      await openErp();
      erpSetTab("matreq", true);
    });
  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", matreqInit);
else matreqInit();
