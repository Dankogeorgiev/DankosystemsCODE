/* Данко Системс — ЕРП „🤖 Фактура от оферта".
   За клиенти с много малки, различни изделия БЕЗ кодове в каталога (напр.
   SD Heat Exchangers): подробната оферта (нашият Excel шаблон DANKO Quotation)
   се качва, Системата чете редовете (чертожен №, описание, материал, ед. кг,
   бройки, ед. цена), изписва материала от склад Материали (по ръчно посочени
   кодове), сглобява палети до 800 кг и отваря СТАНДАРТНАТА фактурна форма,
   предварително попълнена. Оттам нататък всичко е каквото е при всяка фактура:
   номер от правилната серия (износ/БГ) при издаване, вземане от клиента,
   Packing List, ЧМР, палет опис, ценова листа.

   Редовете носят kgPerPiece (ед. кг от офертата) — документите смятат теглата
   от него, понеже тези изделия нямат продукт/опаковка в каталога. */

const INVAI_PALLET_MAX = 800;   // кг на палет — искане на Данко

function erpInvAIStart() {
  const { wrap, close } = erpDialog(`
    <h3>🤖 Фактура от оферта</h3>
    <p class="hint" style="margin:0 0 8px">Качи нашата оферта (Excel по шаблона DANKO Quotation). Системата чете редовете по поръчки, ти посочваш материалите за изписване и фактурата се отваря готова за преглед и издаване.</p>
    <label class="btn co-attach-btn" style="display:inline-block">⬆ Избери файл<input type="file" id="iai-file" accept=".xlsx,.xls" hidden /></label>
    <span id="iai-fname" class="erp-muted"></span>
    <p class="save-status" id="iai-status"></p>
    <div class="erp-dialog-actions"><button class="btn" id="iai-cancel">Отказ</button><button class="btn btn-primary" id="iai-go" disabled>Прочети офертата</button></div>`);
  let chosen = null;
  const st = wrap.querySelector("#iai-status"), inp = wrap.querySelector("#iai-file"), go = wrap.querySelector("#iai-go");
  inp.addEventListener("change", () => { chosen = inp.files && inp.files[0]; wrap.querySelector("#iai-fname").textContent = chosen ? "  " + chosen.name : ""; go.disabled = !chosen; });
  wrap.querySelector("#iai-cancel").addEventListener("click", close);
  go.addEventListener("click", async () => {
    if (!chosen) return;
    go.disabled = true;
    try {
      const parsed = await erpInvAIParse(chosen);
      if (!parsed.rows.length) { st.textContent = "⚠ Не намерих редове с артикули — това ли е шаблонът DANKO Quotation?"; go.disabled = false; return; }
      close();
      erpInvAIPreview(parsed);
    } catch (e) { st.textContent = "⚠ " + (e.message || e); go.disabled = false; }
  });
}

/* Чете шаблона: секции „PURCHASE ORDER N", под тях заглавен ред
   (#, Article no., Description, Stock profile…, Grade, Weight, Qty, Unit price, Amount)
   и редове до „Subtotal". Клиентът идва от блока TO. */
async function erpInvAIParse(file) {
  if (typeof XLSX === "undefined") throw new Error("Библиотеката за Excel още се зарежда — опитай пак след секунда.");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const out = { fileName: file.name, client: "", pos: [], rows: [] };
  let po = "", inTable = false, toNext = false;
  for (const r of raw) {
    const a = String(r[0] == null ? "" : r[0]).trim();
    if (!out.client) {
      if (/^TO$/i.test(a)) { toNext = true; continue; }
      if (toNext && a) { out.client = a.split(/\n/)[0].trim(); toNext = false; }
    }
    if (/^(subtotal|total)/i.test(a)) { inTable = false; continue; }   // преди PO-регекса — „TOTAL … purchase orders" не е секция
    const m = a.match(/PURCHASE\s*ORDER\s*№?\s*(\d[A-Za-z0-9\-\/]*)/i);
    if (m) { po = m[1]; if (!out.pos.includes(po)) out.pos.push(po); inTable = false; continue; }
    if (/^#$/.test(a) && /article/i.test(String(r[1] || ""))) { inTable = true; continue; }
    if (!inTable) continue;
    const article = String(r[1] || "").trim();
    const qty = erpToNum(r[6]) || 0;
    if (!article || !(qty > 0)) continue;
    out.rows.push({
      po, article,
      desc: String(r[2] || "").trim(),
      material: String(r[3] || "").trim(),
      grade: String(r[4] || "").trim(),
      kg: erpToNum(r[5]) || 0,          // ед. кг за 1 брой
      qty,
      price: erpToNum(r[7]) || 0,
    });
  }
  return out;
}

/* Палети до INVAI_PALLET_MAX кг: редовете се редят в реда от офертата; ако един
   БРОЙ не се дели (тежко изделие), редът може да мине в следващия палет. */
function erpInvAIPallets(rows) {
  const pallets = [];
  let cur = null;
  const open = () => { cur = { no: pallets.length + 1, items: [], qty: 0, kg: 0 }; pallets.push(cur); };
  open();
  rows.forEach(r => {
    let left = r.qty;
    while (left > 0) {
      const per = r.kg > 0 ? r.kg : 0;
      let fit = per > 0 ? Math.floor((INVAI_PALLET_MAX - cur.kg) / per) : left;
      if (fit <= 0) { if (cur.qty === 0) fit = 1; else { open(); continue; } }   // празен палет поема поне 1 бр.
      const take = Math.min(left, fit);
      cur.items.push(r.article + " ×" + take);
      cur.qty += take; cur.kg += take * per;
      left -= take;
      if (left > 0) open();
    }
  });
  return pallets.filter(p => p.qty > 0).map(p => ({
    no: p.no, desc: p.items.slice(0, 4).join(", ") + (p.items.length > 4 ? " …" : ""),
    qty: p.qty, weightKg: Math.round(p.kg * 100) / 100,
  }));
}

async function erpInvAIPreview(parsed) {
  try { await erpEnsureLoaded(); } catch (e) {}
  const clients = (typeof erpLoadSaleClients === "function") ? await erpLoadSaleClients() : [];
  const nrm = s => String(s || "").toLowerCase().replace(/[^a-zа-я0-9]+/gi, " ").trim();
  const hit = clients.find(c => nrm(c.name) === nrm(parsed.client)) ||
    clients.find(c => parsed.client && (nrm(c.name).includes(nrm(parsed.client)) || nrm(parsed.client).includes(nrm(c.name))));
  const guessExport = /b\.?v\.?|gmbh|s\.?r\.?l|kft|sp\.?\s*z|bvba|\bnv\b|\bab\b|\boy\b|s\.?l\.?u/i.test(parsed.client || "") ||
    (hit && hit.country && !/бълг|bulgaria|^bg$/i.test(String(hit.country)));

  // Материалните групи: „Stock profile + Grade" → общо кг за изписване.
  const groups = new Map();
  parsed.rows.forEach(r => {
    const k = (r.material + " · " + r.grade).trim();
    const g = groups.get(k) || { key: k, kg: 0, materialId: null, use: false };
    g.kg += r.kg * r.qty;
    groups.set(k, g);
  });
  const glist = [...groups.values()];

  const totKg = parsed.rows.reduce((s, r) => s + r.kg * r.qty, 0);
  const totAmt = parsed.rows.reduce((s, r) => s + r.qty * r.price, 0);
  const n2 = x => (Math.round((Number(x) || 0) * 100) / 100).toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const { wrap, close } = erpDialog(`
    <h3>🤖 Фактура от оферта — преглед</h3>
    <div class="erp-toolbar" style="margin:0 0 6px">
      <label class="erp-inline">Клиент <input type="text" id="iai-client" list="iai-clients" value="${escapeAttr((hit && hit.name) || parsed.client || "")}" style="min-width:240px" />
        <datalist id="iai-clients">${clients.map(c => `<option value="${escapeAttr(c.name)}"></option>`).join("")}</datalist></label>
      <label class="erp-check" title="Серия 1 (износ, EN) и ДДС 0%. Без отметка: серия 2 (БГ пазар), ДДС 20%."><input type="checkbox" id="iai-export" ${guessExport ? "checked" : ""} /> Износ (серия 1 · ДДС 0%)</label>
      <span class="spacer"></span>
      <span class="erp-count">${parsed.rows.length} реда · ${parsed.pos.map(p => "PO " + p).join(", ")} · ${n2(totKg)} кг · ${n2(totAmt)} EUR</span>
    </div>
    <div style="max-height:34vh;overflow:auto">
    <table class="report-table erp-table">
      <thead><tr><th>PO</th><th>Чертеж №</th><th>Описание</th><th>Материал</th><th class="num">Ед. кг</th><th class="num">Бр.</th><th class="num">Ед. цена €</th><th class="num">Сума €</th></tr></thead>
      <tbody>${parsed.rows.map((r, i) => `<tr>
        <td class="erp-muted">${escapeHtml(r.po)}</td>
        <td><b>${escapeHtml(r.article)}</b></td>
        <td>${escapeHtml(r.desc)}</td>
        <td class="erp-muted">${escapeHtml((r.material + " " + r.grade).trim())}</td>
        <td class="num">${n2(r.kg)}</td>
        <td class="num"><input type="number" step="any" min="0" data-iaiq="${i}" value="${escapeAttr(String(r.qty))}" style="width:70px" /></td>
        <td class="num"><input type="number" step="any" min="0" data-iaip="${i}" value="${escapeAttr(String(r.price))}" style="width:86px" /></td>
        <td class="num" data-iaia="${i}">${n2(r.qty * r.price)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <fieldset class="card" style="margin:8px 0;padding:8px 10px">
      <legend>✂ Изписване на материал от склад Материали (по желание)</legend>
      <p class="hint" style="margin:0 0 6px">Групите идват от колоната „материал" на офертата. Посочи нашия код за всяка група, която да се изпише — количеството е общите килограми от редовете. Непосочените не пипат склада.</p>
      <div id="iai-mats">${glist.map((g, i) => `
        <div class="erp-toolbar" style="margin:0 0 4px">
          <span style="min-width:280px">${escapeHtml(g.key || "— без материал —")} · <b>${n2(g.kg)} кг</b></span>
          <button type="button" class="btn btn-small" data-iaim="${i}">🔎 Материал</button>
          <span class="erp-muted" data-iaiml="${i}">— няма да се изписва —</span>
        </div>`).join("")}</div>
    </fieldset>
    <p class="hint" style="margin:0 0 6px">🧱 Палетите се сглобяват автоматично до <b>${INVAI_PALLET_MAX} кг</b> (после може да се донагласят от „Палети" във фактурата). Номерът на фактурата се тегли от серията ПРИ ИЗДАВАНЕ, вземането се записва тогава — както при всяка фактура.</p>
    <p class="save-status" id="iai-st2"></p>
    <div class="erp-dialog-actions">
      <button class="btn" id="iai-cancel2">Отказ</button>
      <button class="btn btn-primary" id="iai-make">🧾 Създай фактурата (чернова)</button>
    </div>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-xwide");
  const $ = s => wrap.querySelector(s);
  $("#iai-cancel2").addEventListener("click", close);

  wrap.querySelectorAll("[data-iaiq]").forEach(el => el.addEventListener("input", () => {
    const i = Number(el.dataset.iaiq); parsed.rows[i].qty = erpToNum(el.value) || 0;
    const c = wrap.querySelector(`[data-iaia="${i}"]`); if (c) c.textContent = n2(parsed.rows[i].qty * parsed.rows[i].price);
  }));
  wrap.querySelectorAll("[data-iaip]").forEach(el => el.addEventListener("input", () => {
    const i = Number(el.dataset.iaip); parsed.rows[i].price = erpToNum(el.value) || 0;
    const c = wrap.querySelector(`[data-iaia="${i}"]`); if (c) c.textContent = n2(parsed.rows[i].qty * parsed.rows[i].price);
  }));

  // Избор на материал за група (търсене по думи, като в Покупки).
  wrap.querySelectorAll("[data-iaim]").forEach(b => b.addEventListener("click", () => {
    const g = glist[Number(b.dataset.iaim)];
    const { wrap: mw, close: mclose } = erpDialog(`
      <h3>Материал за: ${escapeHtml(g.key)}</h3>
      <input type="search" id="iaim-q" placeholder="търси код или име…" />
      <div id="iaim-list" class="erp-lp-list"></div>
      <div class="erp-dialog-actions"><button class="btn" id="iaim-none">Без изписване</button><button class="btn" id="iaim-cancel">Затвори</button></div>`);
    const listEl = mw.querySelector("#iaim-list");
    const render = q => {
      const list = puMatFilter(ERP.materials, q || g.key);
      listEl.innerHTML = list.slice(0, 60).map(m => `<button type="button" class="erp-lp-item" data-id="${m.id}"><b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")} <span class="erp-muted">нал. ${erpNum(m.stock)} ${escapeHtml(m.unit || "")}</span></button>`).join("") || `<p class="report-empty">Няма съвпадения — потърси с други думи.</p>`;
      listEl.querySelectorAll(".erp-lp-item").forEach(x => x.addEventListener("click", () => {
        g.materialId = Number(x.dataset.id); g.use = true;
        const m = ERP.matById[g.materialId] || {};
        const lb = wrap.querySelector(`[data-iaiml="${glist.indexOf(g)}"]`);
        if (lb) lb.innerHTML = `→ ще се изпишат <b>${n2(g.kg)} ${escapeHtml(m.unit || "кг")}</b> от <b>${escapeHtml(m.code || "")}</b> ${escapeHtml(m.name || "")}`;
        mclose();
      }));
    };
    render("");
    mw.querySelector("#iaim-q").addEventListener("input", uiDebounce(e => render(e.target.value), 150));
    mw.querySelector("#iaim-none").addEventListener("click", () => {
      g.materialId = null; g.use = false;
      const lb = wrap.querySelector(`[data-iaiml="${glist.indexOf(g)}"]`);
      if (lb) lb.textContent = "— няма да се изписва —";
      mclose();
    });
    mw.querySelector("#iaim-cancel").addEventListener("click", mclose);
    setTimeout(() => mw.querySelector("#iaim-q").focus(), 50);
  }));

  $("#iai-make").addEventListener("click", async () => {
    const btn = $("#iai-make"); btn.disabled = true;
    const st = $("#iai-st2");
    const rows = parsed.rows.filter(r => r.qty > 0);
    if (!rows.length) { st.textContent = "⚠ Няма редове с бройки."; btn.disabled = false; return; }
    const clName = $("#iai-client").value.trim();
    if (!clName) { st.textContent = "⚠ Избери клиент."; btn.disabled = false; return; }
    const isExport = $("#iai-export").checked;
    const cm = clients.find(c => c.name === clName);
    const cl = cm
      ? { name: cm.name || "", eik: cm.eik || "", vat: cm.vat || "", city: cm.city || "", street: cm.street || "", country: cm.country || (isExport ? "" : "България"), person: cm.mol || cm.person || "" }
      : { name: clName, eik: "", vat: "", city: "", street: "", country: isExport ? "" : "България", person: "" };

    // 1) Изписване на материала (само посочените групи).
    const useG = glist.filter(g => g.use && g.materialId && g.kg > 0);
    if (useG.length) {
      const msg = useG.map(g => { const m = ERP.matById[g.materialId] || {}; return `• ${m.code || ""} ${m.name || ""}: −${n2(g.kg)} ${m.unit || "кг"}`; }).join("\n");
      if (confirm(`Да ИЗПИША ли от склад Материали:\n\n${msg}\n\n(движение „изписване" с бележка по офертата)`)) {
        const ref = "invai:" + Date.now();
        const moves = useG.map(g => ({ material_id: g.materialId, kind: "изписване", quantity: -(Math.round(g.kg * 1000) / 1000), ref, note: `Фактура по оферта ${parsed.fileName} · ${clName}` }));
        st.textContent = "Изписва материала…";
        const { error } = await sb.from("stock_movements").insert(moves);
        if (error) { alert("Материалът НЕ се изписа: " + error.message + "\nФактурата ще се създаде — изпиши после ръчно от Материали."); }
      }
    }

    // 2) Фактурата — стандартната форма, предварително попълнена.
    const today = new Date().toISOString().slice(0, 10);
    const o = {
      kind: "invoice", seriesKey: isExport ? "1" : "2",
      issueDate: today, taxDate: today,
      orderRef: parsed.pos.map(p => "PO " + p).join(", "),
      client: cl, clientId: cm ? cm.id : null,
      currency: "EUR",
      vatRate: isExport ? 0 : 20,
      vatBasis: (isExport && typeof INV_VAT_EXEMPT_EU !== "undefined") ? INV_VAT_EXEMPT_EU : "",
      paymentMethod: "по банка", termDays: 0, dueDate: "",
      note: "По оферта " + parsed.fileName.replace(/\.(xlsx|xls)$/i, ""),
      refInvoice: null, refReason: "",
      lines: rows.map(r => ({
        code: r.article, name: (r.desc + (r.material ? " — " + r.material : "") + (r.grade ? " " + r.grade : "")).trim(),
        qty: r.qty, unit: "бр.", unitPrice: r.price,
        kgPerPiece: r.kg, orderRef: r.po ? "PO " + r.po : "",
      })),
      pallets: erpInvAIPallets(rows),
      status: "чернова", posted: false, compiledBy: "",
    };
    close();
    erpInvForm(o);
  });
}
