/* Данко Системс — „Регистър RFQ" (запитвания за оферта от клиенти).
   Всеки RFQ: пореден №, клиент, дата, описание + прикачен мейл от клиента,
   и ПАПКИ с файлове (чертежи, спецификации, снимки…).
   Запис: app_config id="rfq_register": { list:[{ id, client, date, desc,
   mailFiles:[], folders:[{ id, name, files:[{name,type,path,url}] }],
   createdBy, createdAt }] }. Файловете отиват в Supabase Storage (BUCKET),
   папка rfq/<№>/… Ползва erpDialog/erpView/escapeHtml/safeName/BUCKET. */

let RFQ = null;
let rfqQuery = "";

async function rfqLoad() {
  try { const { data } = await sb.from("app_config").select("data").eq("id", "rfq_register").maybeSingle(); RFQ = (data && data.data && data.data.list) || []; }
  catch (e) { RFQ = []; }
}
async function rfqSave() {
  const { error } = await sb.from("app_config").upsert({ id: "rfq_register", data: { list: RFQ || [] }, updated_at: new Date().toISOString() });
  if (error) { alert("Грешка при запис: " + error.message); return false; }
  return true;
}
function rfqNextNo() { let m = 0; (RFQ || []).forEach(r => { if ((Number(r.id) || 0) > m) m = Number(r.id); }); return m + 1; }
function rfqFmt(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s || ""); }
function rfqFileCount(r) {
  let n = (r.mailFiles || []).length;
  (r.folders || []).forEach(f => { n += (f.files || []).length; });
  return n;
}

/* ---------- Списъкът (таб „Регистър RFQ") ---------- */
async function erpRenderRfq() {
  const v = erpView();
  v.innerHTML = `<p class="erp-loading">Зареждане…</p>`;
  await rfqLoad();
  const q = rfqQuery.trim().toLowerCase();
  let rows = (RFQ || []).slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  if (q) rows = rows.filter(r =>
    String(r.id).includes(q) ||
    (r.client || "").toLowerCase().includes(q) ||
    (r.desc || "").toLowerCase().includes(q));

  v.innerHTML = `
    <div class="erp-toolbar">
      <input type="search" id="rfq-search" placeholder="Търси № , клиент, описание…" value="${escapeAttr(rfqQuery)}" />
      <span class="erp-count">${rows.length} RFQ</span>
      <span class="spacer"></span>
      <button class="btn btn-small btn-primary" id="rfq-new">+ Нов RFQ</button>
    </div>
    <p class="hint">Регистър на клиентските запитвания за оферта. <b>Клик върху ред = отваря RFQ-то</b> — там са описанието, мейлът от клиента и папките с файлове.</p>
    <table class="report-table erp-table">
      <thead><tr><th>№</th><th>Дата</th><th>Клиент</th><th>Описание</th><th class="num">Файлове</th><th></th></tr></thead>
      <tbody>${rows.map(r => `
        <tr class="erp-clickable" data-rfq="${r.id}">
          <td data-label="№"><b>RFQ-${String(r.id).padStart(3, "0")}</b></td>
          <td data-label="Дата">${rfqFmt(r.date)}</td>
          <td data-label="Клиент"><b>${escapeHtml(r.client || "—")}</b></td>
          <td data-label="Описание">${escapeHtml((r.desc || "").slice(0, 120))}${(r.desc || "").length > 120 ? "…" : ""}</td>
          <td class="num" data-label="Файлове">${rfqFileCount(r) || "—"}</td>
          <td class="erp-row-actions">${rfqIsBoss() ? `<button class="btn btn-small btn-danger" data-rfq-del="${r.id}" title="Изтрий RFQ (само админ)">×</button>` : ""}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="report-empty">Още няма RFQ записи. Създай първия с бутона горе.</td></tr>`}
      </tbody>
    </table>`;

  const se = document.getElementById("rfq-search");
  se.addEventListener("input", e => { rfqQuery = e.target.value; erpRenderRfq().then(() => { const el = document.getElementById("rfq-search"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); });
  document.getElementById("rfq-new").addEventListener("click", erpRfqNew);
  v.querySelectorAll("tr[data-rfq]").forEach(tr => tr.addEventListener("click", e => {
    if (e.target.closest("button")) return;
    const r = RFQ.find(x => x.id === Number(tr.dataset.rfq));
    if (r) erpRfqOpen(r);
  }));
  v.querySelectorAll("[data-rfq-del]").forEach(b => b.addEventListener("click", async () => {
    const r = RFQ.find(x => x.id === Number(b.dataset.rfqDel)); if (!r) return;
    if (!confirm(`Да изтрия ли RFQ-${String(r.id).padStart(3, "0")} (${r.client || "—"})?\nПрикачените файлове също ще бъдат изтрити.`)) return;
    // Чистим файловете от Storage (мейл + всички папки).
    const paths = [...(r.mailFiles || []).map(f => f.path), ...(r.folders || []).flatMap(f => (f.files || []).map(x => x.path))].filter(Boolean);
    if (paths.length) { try { await sb.storage.from(BUCKET).remove(paths); } catch (e) {} }
    RFQ = RFQ.filter(x => x.id !== r.id);
    if (await rfqSave()) erpRenderRfq();
  }));
}

/* ---------- Нов RFQ ---------- */
async function erpRfqNew() {
  await rfqLoad();
  const rec = {
    id: rfqNextNo(), client: "", date: new Date().toISOString().slice(0, 10),
    desc: "", mailFiles: [], folders: [{ id: 1, name: "Чертежи", files: [] }],
    createdBy: (typeof MY_ACCESS !== "undefined" && MY_ACCESS.email) || "", createdAt: new Date().toISOString(),
  };
  RFQ.push(rec);
  if (await rfqSave()) erpRfqOpen(rec);
}

/* ---------- Качване/махане на файл ---------- */
async function rfqUpload(rec, sub, file) {
  const path = `rfq/${rec.id}/${sub}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file);
  if (error) { alert("Грешка при качване на „" + file.name + "“: " + error.message); return null; }
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return { name: file.name, type: file.type, path, url: data.publicUrl };
}
// Пълен контрол (триене, избор, сваляне) — само за Данко.
function rfqIsBoss() {
  return ((typeof MY_ACCESS !== "undefined" && MY_ACCESS && MY_ACCESS.email) || "").toLowerCase() === "dankog@gmail.com";
}
function rfqFilesHtml(files, delAttr) {
  const boss = rfqIsBoss();
  return `<ul class="files-list erp-draw-list">
    ${(files || []).map((f, i) => {
      const isImg = (f.type || "").startsWith("image/");
      const prev = isImg ? `<img src="${escapeAttr(f.url)}" alt="${escapeAttr(f.name)}" />` : `<span class="pdf-icon">📄</span>`;
      return `<li>
        ${boss ? `<label class="rfq-fchk" title="Избери за сваляне"><input type="checkbox" class="rfq-fsel" data-url="${escapeAttr(f.url)}" data-name="${escapeAttr(f.name)}" /></label>` : ""}
        <a href="${escapeAttr(f.url)}" target="_blank" download="${escapeAttr(f.name)}">${prev}</a>
        <div class="file-name">${escapeHtml(f.name)}</div>
        ${boss ? `<button type="button" class="remove-file" data-${delAttr}="${i}" title="Премахни (само админ)">×</button>` : ""}
      </li>`;
    }).join("") || `<li class="erp-muted">Няма файлове.</li>`}
  </ul>`;
}

// Сваля избраните файлове (отметките) на компютъра, един по един.
async function rfqDownloadSelected(wrap) {
  const sel = [...wrap.querySelectorAll(".rfq-fsel:checked")];
  if (!sel.length) { alert("Избери файлове с отметките върху чертежите."); return; }
  for (const c of sel) {
    try {
      const resp = await fetch(c.dataset.url);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = c.dataset.name || "file";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { window.open(c.dataset.url, "_blank"); }   // резервно: отваря в нов таб
  }
}

/* ---------- Детайлът на един RFQ (папки, описание, мейл) ---------- */
async function erpRfqOpen(rec) {
  let clients = [];
  try { if (typeof erpLoadClients === "function") clients = await erpLoadClients(); } catch (e) {}
  const { wrap, close } = erpDialog(`
    <h3>📄 RFQ-${String(rec.id).padStart(3, "0")} <span class="erp-muted" id="rfq-head-client">${escapeHtml(rec.client || "")}</span></h3>
    <div class="erp-co-grid">
      <label>Клиент <input type="text" id="rf-client" list="rf-clients" value="${escapeAttr(rec.client || "")}" placeholder="име на клиента" />
        <datalist id="rf-clients">${clients.map(c => `<option value="${escapeAttr(c.company || "")}"></option>`).join("")}</datalist></label>
      <label>Дата <input type="date" id="rf-date" value="${escapeAttr(rec.date || "")}" /></label>
    </div>
    <label>Описание
      <textarea id="rf-desc" rows="4" placeholder="какво иска клиентът, количества, срокове…">${escapeHtml(rec.desc || "")}</textarea></label>
    <div class="erp-rfq-mail">
      <b>✉ Мейл от клиента</b> <span class="erp-muted">(запази писмото като файл — .eml/.msg/PDF/снимка — и го прикачи тук)</span>
      <label class="btn btn-small" for="rf-mail-file">+ Прикачи мейл/файл</label>
      <input type="file" id="rf-mail-file" multiple hidden />
      <div id="rf-mail-list">${rfqFilesHtml(rec.mailFiles, "mdel")}</div>
    </div>
    <div class="erp-toolbar" style="margin-top:12px">
      <b>📁 Папки с файлове</b>
      <span class="spacer"></span>
      <button class="btn btn-small" id="rf-addfolder">+ Нова папка</button>
    </div>
    <div id="rf-folders"></div>
    <div class="erp-dialog-actions">
      ${rfqIsBoss() ? '<button class="btn" id="rf-dlsel">⬇ Свали избраните (0)</button>' : ""}
      <span class="spacer"></span>
      <button class="btn" id="rf-close">Затвори</button>
      <button class="btn btn-primary" id="rf-save">💾 Запази</button>
    </div>
    <p class="save-status" id="rf-status"></p>`);
  wrap.querySelector(".erp-dialog-box").classList.add("erp-dialog-full");
  const status = wrap.querySelector("#rf-status");
  const saveFields = async (silent) => {
    rec.client = wrap.querySelector("#rf-client").value.trim();
    rec.date = wrap.querySelector("#rf-date").value || rec.date;
    rec.desc = wrap.querySelector("#rf-desc").value;
    const head = wrap.querySelector("#rfq-head-client"); if (head) head.textContent = rec.client;
    const ok = await rfqSave();
    if (!silent) status.textContent = ok ? "✅ Записано." : "";
    return ok;
  };
  wrap.querySelector("#rf-save").addEventListener("click", () => saveFields(false));
  wrap.querySelector("#rf-close").addEventListener("click", async () => { await saveFields(true); close(); if (ERP.tab === "rfq") erpRenderRfq(); });
  // Сваляне на избраните с отметките (само админ). Броячът се обновява на живо.
  const dlBtn = wrap.querySelector("#rf-dlsel");
  if (dlBtn) {
    dlBtn.addEventListener("click", () => rfqDownloadSelected(wrap));
    wrap.addEventListener("change", e => {
      if (e.target && e.target.classList && e.target.classList.contains("rfq-fsel"))
        dlBtn.textContent = `⬇ Свали избраните (${wrap.querySelectorAll(".rfq-fsel:checked").length})`;
    });
  }

  // Мейлът от клиента (файлове до описанието).
  const mailBox = wrap.querySelector("#rf-mail-list");
  const renderMail = () => {
    mailBox.innerHTML = rfqFilesHtml(rec.mailFiles, "mdel");
    mailBox.querySelectorAll("[data-mdel]").forEach(b => b.addEventListener("click", async () => {
      const f = rec.mailFiles[Number(b.dataset.mdel)];
      if (f && f.path) { try { await sb.storage.from(BUCKET).remove([f.path]); } catch (e) {} }
      rec.mailFiles.splice(Number(b.dataset.mdel), 1);
      await rfqSave(); renderMail();
    }));
  };
  renderMail();
  wrap.querySelector("#rf-mail-file").addEventListener("change", async e => {
    for (const file of [...e.target.files]) {
      const f = await rfqUpload(rec, "mail", file);
      if (f) (rec.mailFiles = rec.mailFiles || []).push(f);
    }
    e.target.value = "";
    await rfqSave(); renderMail();
  });

  // Папките. Свити по подразбиране — клик върху заглавието отваря/затваря.
  const foldersBox = wrap.querySelector("#rf-folders");
  const openFolders = new Set();
  const renderFolders = () => {
    foldersBox.innerHTML = (rec.folders || []).map((fo, fi) => {
      const open = openFolders.has(fo.id);
      return `
      <div class="erp-rfq-folder">
        <div class="erp-toolbar erp-rfq-fhead" style="margin:0" data-ftog="${fo.id}" title="Клик = отвори/затвори папката">
          <span class="erp-rfq-farrow">${open ? "▾" : "▸"}</span>
          <b>📁 ${escapeHtml(fo.name || "Папка")}</b>
          <span class="erp-muted">(${(fo.files || []).length} файла)</span>
          <span class="spacer"></span>
          <button class="btn btn-small" data-fren="${fi}" title="Преименувай папката">✎</button>
          <label class="btn btn-small" for="rf-fol-file-${fi}">+ Прикачи файлове</label>
          <input type="file" id="rf-fol-file-${fi}" data-fadd="${fi}" multiple hidden />
          ${rfqIsBoss() ? `<button class="btn btn-small btn-danger" data-fdel="${fi}" title="Изтрий папката (с файловете) — само админ">×</button>` : ""}
        </div>
        ${open ? `<div data-frow="${fi}">${rfqFilesHtml(fo.files, "fdel-" + fi)}</div>` : ""}
      </div>`;
    }).join("") || `<p class="erp-muted">Няма папки — добави с „+ Нова папка".</p>`;
    // отваряне/затваряне (бутоните в заглавието не превключват)
    foldersBox.querySelectorAll("[data-ftog]").forEach(h => h.addEventListener("click", e => {
      if (e.target.closest("button") || e.target.closest("label") || e.target.closest("input")) return;
      const id = Number(h.dataset.ftog);
      if (openFolders.has(id)) openFolders.delete(id); else openFolders.add(id);
      renderFolders();
    }));
    // качване
    foldersBox.querySelectorAll("[data-fadd]").forEach(inp => inp.addEventListener("change", async e => {
      const fo = rec.folders[Number(inp.dataset.fadd)];
      for (const file of [...e.target.files]) {
        const f = await rfqUpload(rec, "f" + fo.id, file);
        if (f) (fo.files = fo.files || []).push(f);
      }
      e.target.value = "";
      openFolders.add(fo.id);   // след качване папката се отваря, за да се видят файловете
      await rfqSave(); renderFolders();
    }));
    // махане на файл
    (rec.folders || []).forEach((fo, fi) => {
      foldersBox.querySelectorAll(`[data-fdel-${fi}]`).forEach(b => b.addEventListener("click", async () => {
        const f = fo.files[Number(b.getAttribute("data-fdel-" + fi))];
        if (f && f.path) { try { await sb.storage.from(BUCKET).remove([f.path]); } catch (e) {} }
        fo.files.splice(Number(b.getAttribute("data-fdel-" + fi)), 1);
        await rfqSave(); renderFolders();
      }));
    });
    // преименуване / изтриване на папка
    foldersBox.querySelectorAll("[data-fren]").forEach(b => b.addEventListener("click", async () => {
      const fo = rec.folders[Number(b.dataset.fren)];
      const n = prompt("Име на папката:", fo.name || "");
      if (n === null) return;
      fo.name = n.trim() || fo.name;
      await rfqSave(); renderFolders();
    }));
    foldersBox.querySelectorAll("[data-fdel]").forEach(b => b.addEventListener("click", async () => {
      const fi = Number(b.dataset.fdel);
      const fo = rec.folders[fi];
      if (!confirm(`Да изтрия ли папка „${fo.name}" с ${(fo.files || []).length} файла?`)) return;
      const paths = (fo.files || []).map(f => f.path).filter(Boolean);
      if (paths.length) { try { await sb.storage.from(BUCKET).remove(paths); } catch (e) {} }
      rec.folders.splice(fi, 1);
      await rfqSave(); renderFolders();
    }));
  };
  renderFolders();
  wrap.querySelector("#rf-addfolder").addEventListener("click", async () => {
    const n = prompt("Име на новата папка:", "");
    if (n === null || !n.trim()) return;
    let m = 0; (rec.folders || []).forEach(f => { if ((Number(f.id) || 0) > m) m = Number(f.id); });
    (rec.folders = rec.folders || []).push({ id: m + 1, name: n.trim(), files: [] });
    openFolders.add(m + 1);   // новата папка се отваря веднага
    await rfqSave(); renderFolders();
  });
}
