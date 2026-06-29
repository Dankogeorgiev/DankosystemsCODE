// ============================================================
// Линия за боядисване — логика
// ------------------------------------------------------------
// Самостоятелно приложение (прототип). Данните се пазят локално
// в браузъра (localStorage). Слоят за данните `Store` е отделен,
// за да може после лесно да се смени със Supabase — виж бележката
// най-долу „Сливане със Supabase“.
// ============================================================

(function () {
  "use strict";

  // ---------- Цветове по RAL (за визуалния квадрат) ----------
  // Малка таблица с често ползвани прахови RAL цветове. Ако RAL-ът
  // не е в списъка, потребителят сам избира цвят с пипетата.
  const RAL_HEX = {
    "1003": "#f9a800", "1013": "#eae6ca", "1015": "#e6d2b5", "1018": "#f5d033",
    "1021": "#f3c300", "1023": "#fad201",
    "2004": "#e75b12", "2009": "#de5307",
    "3000": "#af2b1e", "3002": "#9b111e", "3005": "#59191f", "3020": "#cc0605",
    "5002": "#20214f", "5005": "#1d1e33", "5010": "#0e294b", "5012": "#3b83bd",
    "5015": "#2874b2", "5017": "#063971",
    "6005": "#0f4336", "6011": "#587246", "6018": "#61993b", "6029": "#20603d",
    "7001": "#8f999f", "7011": "#434b4d", "7012": "#4e5754", "7015": "#434750",
    "7016": "#293133", "7021": "#23282b", "7024": "#474a51", "7035": "#cbd0cc",
    "7037": "#7d7f7d", "7040": "#9da3a6", "7042": "#8d948d", "7043": "#4e5452",
    "8014": "#382c1e", "8017": "#45322e", "8019": "#403a3a",
    "9001": "#fdf4e3", "9002": "#e7ebda", "9003": "#f4f4f4", "9005": "#0a0a0a",
    "9006": "#a5a5a5", "9007": "#8f8f8c", "9010": "#ffffff", "9011": "#1c1c1c",
    "9016": "#f6f6f6", "9017": "#1e1e1e", "9022": "#9c9c9c",
  };

  function ralKey(ral) {
    return String(ral || "").replace(/[^0-9]/g, "");
  }
  function colorForRal(ral) {
    return RAL_HEX[ralKey(ral)] || null;
  }
  // Светъл или тъмен текст върху даден цвят
  function textOn(hex) {
    const c = (hex || "#000000").replace("#", "");
    if (c.length < 6) return "#fff";
    const r = parseInt(c.slice(0, 2), 16),
          g = parseInt(c.slice(2, 4), 16),
          b = parseInt(c.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? "#0f172a" : "#ffffff";
  }

  // ---------- Слой за данните (localStorage) ----------
  // Всеки запис е във формат, близък до Supabase реда:
  //   { id, data:{ral,color,part,count,note}, done, created_at, updated_at }
  const Store = {
    KEY: "danko_painting_v1",

    list() {
      try {
        const raw = localStorage.getItem(this.KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        console.warn("Грешка при четене:", e);
        return [];
      }
    },

    _writeAll(arr) {
      localStorage.setItem(this.KEY, JSON.stringify(arr));
    },

    upsert(rec) {
      const all = this.list();
      const i = all.findIndex((x) => x.id === rec.id);
      rec.updated_at = nowISO();
      if (i >= 0) all[i] = rec;
      else all.push(rec);
      this._writeAll(all);
      return rec;
    },

    remove(id) {
      this._writeAll(this.list().filter((x) => x.id !== id));
    },

    removeDone() {
      this._writeAll(this.list().filter((x) => !x.done));
    },

    // Известяване между отворени раздели (наподобява realtime)
    subscribe(cb) {
      window.addEventListener("storage", (e) => {
        if (e.key === this.KEY) cb();
      });
    },
  };

  // ---------- Помощни ----------
  function nowISO() { return new Date().toISOString(); }
  function uid() {
    return "h_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString("bg-BG", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  // ---------- Състояние на изгледа ----------
  let filter = "all"; // all | online | done

  // ---------- Рендиране ----------
  const elHangers = $("#hangers");
  const elSummary = $("#summary");
  const elEmpty = $("#empty");

  function render() {
    const all = Store.list();
    const online = all.filter((h) => !h.done);
    const done = all.filter((h) => h.done);

    renderSummary(online, done);

    const shown = filter === "online" ? online : filter === "done" ? done : all;
    elHangers.innerHTML = "";

    if (!all.length) {
      elEmpty.hidden = false;
    } else {
      elEmpty.hidden = true;
    }

    shown.forEach((h, i) => elHangers.appendChild(hangerNode(h, i + 1)));
  }

  function sumCount(list) {
    return list.reduce((s, h) => s + (Number(h.data.count) || 0), 0);
  }

  function renderSummary(online, done) {
    const cards = [
      { cls: "online", num: online.length, lbl: "подвески на линията" },
      { cls: "online", num: sumCount(online), lbl: "детайла на линията" },
      { cls: "done", num: done.length, lbl: "готови подвески" },
      { cls: "done", num: sumCount(done), lbl: "готови детайла" },
    ];
    elSummary.innerHTML = cards
      .map((c) => `<div class="stat ${c.cls}"><div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`)
      .join("");
  }

  function hangerNode(h, idx) {
    const d = h.data || {};
    const color = d.color || colorForRal(d.ral) || "#94a3b8";
    const node = document.createElement("div");
    node.className = "hanger" + (h.done ? " done" : "");
    node.dataset.id = h.id;

    const ralLabel = d.ral ? "RAL " + esc(d.ral) : "—";
    node.innerHTML = `
      <div class="card" data-act="edit">
        <div class="swatch" style="background:${esc(color)};color:${textOn(color)}">${ralLabel}</div>
        <div class="part">${esc(d.part) || "<span style='color:#94a3b8'>без описание</span>"}</div>
        <div class="meta">
          <span class="idx">#${idx}</span>
          <span class="count">×${Number(d.count) || 0} бр.</span>
        </div>
        ${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}
        ${h.done ? `<div class="meta"><span class="tag-done">✓ Готово ${fmtTime(h.done_at)}</span></div>` : ""}
        <button class="done-btn" data-act="toggle">${h.done ? "↩ Върни на линията" : "✓ Готово"}</button>
      </div>`;
    return node;
  }

  // ---------- Действия ----------
  function addHanger(ral, color, part, count) {
    const rec = {
      id: uid(),
      data: {
        ral: ral.trim(),
        color: color,
        part: part.trim(),
        count: Math.max(1, parseInt(count, 10) || 1),
        note: "",
      },
      done: false,
      done_at: null,
      created_at: nowISO(),
      updated_at: nowISO(),
    };
    Store.upsert(rec);
    render();
  }

  function toggleDone(id) {
    const rec = Store.list().find((x) => x.id === id);
    if (!rec) return;
    rec.done = !rec.done;
    rec.done_at = rec.done ? nowISO() : null;
    Store.upsert(rec);
    render();
  }

  // ---------- Диалог за редакция ----------
  const dlg = $("#edit-dialog");
  let editingId = null;

  function openEdit(id) {
    const rec = Store.list().find((x) => x.id === id);
    if (!rec) return;
    editingId = id;
    $("#e-ral").value = rec.data.ral || "";
    $("#e-color").value = rec.data.color || colorForRal(rec.data.ral) || "#1b1b1b";
    $("#e-part").value = rec.data.part || "";
    $("#e-count").value = rec.data.count || 1;
    $("#e-note").value = rec.data.note || "";
    dlg.showModal();
  }

  $("#edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const rec = Store.list().find((x) => x.id === editingId);
    if (!rec) { dlg.close(); return; }
    rec.data.ral = $("#e-ral").value.trim();
    rec.data.color = $("#e-color").value;
    rec.data.part = $("#e-part").value.trim();
    rec.data.count = Math.max(1, parseInt($("#e-count").value, 10) || 1);
    rec.data.note = $("#e-note").value.trim();
    Store.upsert(rec);
    dlg.close();
    render();
  });
  $("#e-cancel").addEventListener("click", () => dlg.close());
  $("#e-delete").addEventListener("click", () => {
    if (editingId && confirm("Да изтрия ли тази подвеска?")) {
      Store.remove(editingId);
      dlg.close();
      render();
    }
  });

  // Когато RAL се напише и е познат — синхронизирай пипетата
  function bindRalSync(ralInput, colorInput) {
    ralInput.addEventListener("input", () => {
      const hex = colorForRal(ralInput.value);
      if (hex) colorInput.value = hex;
    });
  }
  bindRalSync($("#f-ral"), $("#f-color"));
  bindRalSync($("#e-ral"), $("#e-color"));

  // ---------- Свързване на бутоните ----------
  $("#add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const part = $("#f-part").value;
    const count = $("#f-count").value;
    const ral = $("#f-ral").value;
    const color = $("#f-color").value;
    if (!part.trim() && !ral.trim()) {
      $("#f-part").focus();
      return;
    }
    addHanger(ral, color, part, count);
    // Изчисти за следващата подвеска, остави цвета/RAL (често е същата партида)
    $("#f-part").value = "";
    $("#f-count").value = 1;
    $("#f-part").focus();
  });

  elHangers.addEventListener("click", (e) => {
    const hanger = e.target.closest(".hanger");
    if (!hanger) return;
    const id = hanger.dataset.id;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "toggle") { toggleDone(id); }
    else if (act === "edit") { openEdit(id); }
  });

  $("#filters").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filter = chip.dataset.filter;
    $("#filters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
    render();
  });

  $("#btn-clear-done").addEventListener("click", () => {
    const n = Store.list().filter((x) => x.done).length;
    if (!n) { alert("Няма готови подвески за премахване."); return; }
    if (confirm(`Да премахна ли ${n} готови подвески от линията?`)) {
      Store.removeDone();
      render();
    }
  });

  $("#btn-print").addEventListener("click", () => window.print());

  // Обновяване при промяна от друг раздел (наподобява realtime)
  Store.subscribe(render);

  // Старт
  render();
})();

// ============================================================
// Сливане със Supabase (за по-късно)
// ------------------------------------------------------------
// Когато слееш това с основното приложение:
//   1. Пусни `painting-setup.sql` в Supabase (създава таблица `painting`).
//   2. Замени обекта `Store` по-горе с обвивка около supabase-client:
//        list()      -> select * from painting order by created_at
//        upsert(rec) -> upsert into painting
//        remove(id)  -> delete from painting where id = ...
//        subscribe() -> supabase.channel(...).on('postgres_changes', ...)
//   3. Форматът на записа ({id, data, done, done_at, created_at, updated_at})
//      вече съвпада с реда в таблицата, така че останалата логика не се пипа.
// ============================================================
