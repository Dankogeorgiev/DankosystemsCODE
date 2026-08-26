/* Данко Системс — складови последствия при отчитане от изнесените цехови
   приложения (заваръчни маси / заваръчни роботи).
   Главното табло (tasks.js → logProduction) прави след всеки отчет:
   заприходяване на готовото (последна операция), изписване на вложените
   части от рецептата (сглобяваща операция), изписване на материала (първа
   операция), запис във вечния производствен дневник и маркиране на заявката
   „готова за продажба". Изнесените приложения пишеха само produced и всичко
   това се губеше. Този модул повтаря стъпките ЕДНО КЪМ ЕДНО, идемпотентно
   (по делтата produced − вече отчетено), със същите ref етикети
   (prod:/consume:/matprod:) — затова справките и „Нулирай тестови движения"
   ги виждат като нормални производствени движения.
   Ползване (виж creditWeldingWorkshop в двете приложения):
     await FLOW_CREDIT.afterCredit(client, rowId, t);   // след update на задачата
     await FLOW_CREDIT.prodLog(client, rowId, t, entry);
     await FLOW_CREDIT.markOrdersReady(client, orderIds); */
(function () {
  function n(v) { return Number(v) || 0; }

  // Чете всички редове (Supabase връща макс. 1000 наведнъж).
  async function selAll(c, table, cols, filterCol, filterVal) {
    const out = []; const CHUNK = 1000;
    for (let from = 0; ; from += CHUNK) {
      let q = c.from(table).select(cols).range(from, from + CHUNK - 1);
      if (filterCol) q = q.eq(filterCol, filterVal);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < CHUNK) break;
    }
    return out;
  }

  /* ---------- Последователни вериги (мостри / производство за склад) ----------
     Порт на erpSeqTask/erpAdvanceSeq/erpMaybeStartFinal от erp-orders.js.
     Без него отчет от масите/роботите завършваше стъпката, но НЕ пускаше
     следващата операция — веригата спираше и следващият цех не получаваше
     задача. Повтаря главната логика 1:1 (advanced флаг, дубъл-проверка). */
  function seqTask(step, i, meta) {
    const src = {
      kind: meta.kind || "order", sampleId: meta.sampleId, sampleType: meta.sampleType || "order",
      seq: true, group: meta.group, chainId: meta.chainId, step: i, total: meta.steps.length, steps: meta.steps,
      role: meta.role || "part",
    };
    if (meta.finalChainId) { src.finalChainId = meta.finalChainId; src.finalSteps = meta.finalSteps; }
    return {
      client: meta.clientName || "", product: step.product || "", code: step.code || "",
      operation: step.operation || "", workshop: step.workshop || "",
      qty: step.qty, opsPerUnit: step.opsPerUnit || 1, produced: 0, due: meta.deadline || "", thickness: "", files: [], logs: [],
      source: src,
    };
  }
  async function advanceSeq(c, rowId, t) {
    const src = t && t.source;
    if (!src || !src.seq) return;
    const steps = src.steps || [];
    const qty = n(t.qty), prod = n(t.produced);
    if (!(qty > 0 && prod >= qty)) return;             // стъпката още не е готова
    const next = (Number(src.step) || 0) + 1;
    if (next < steps.length) {
      if (src.advanced) return;
      src.advanced = true;
      await c.from("tasks").update({ data: t, done: true, updated_at: new Date().toISOString() }).eq("id", rowId);
      try {
        const { data } = await c.from("tasks").select("data").eq("data->source->>sampleId", String(src.sampleId));
        const exists = (data || []).some(r => {
          const s2 = r.data && r.data.source;
          return s2 && String(s2.chainId) === String(src.chainId) && (Number(s2.step) || 0) === next;
        });
        if (exists) return;
      } catch (e) { /* по-добре дубъл, отколкото спряна верига */ }
      const nt = seqTask(steps[next], next, {
        clientName: t.client || "", deadline: t.due || "", kind: src.kind, sampleId: src.sampleId,
        sampleType: src.sampleType, group: src.group, chainId: src.chainId, steps,
        role: src.role, finalChainId: src.finalChainId, finalSteps: src.finalSteps,
      });
      await c.from("tasks").insert({ data: nt });
      return;
    }
    // Възелът приключи → ако всички възли от групата са готови, пусни финала.
    if (src.role === "part" && src.finalChainId && (src.finalSteps || []).length) {
      let rows = [];
      try { const { data } = await c.from("tasks").select("data,done").eq("data->source->>sampleId", String(src.sampleId)); rows = data || []; } catch (e) { return; }
      if (rows.some(r => { const s = r.data && r.data.source; return s && String(s.chainId) === String(src.finalChainId); })) return;
      const parts = {};
      rows.forEach(r => {
        const s = r.data && r.data.source;
        if (!s || s.role !== "part" || String(s.group) !== String(src.group)) return;
        const g = parts[s.chainId] || (parts[s.chainId] = { done: false });
        const stepN = Number(s.step) || 0, len = (s.steps || []).length;
        if (stepN === len - 1) g.done = !!r.done;
      });
      const ids = Object.keys(parts);
      if (!ids.length || !ids.every(id => parts[id].done)) return;
      const nt = seqTask(src.finalSteps[0], 0, {
        clientName: t.client || "", deadline: t.due || "", kind: src.kind, sampleId: src.sampleId,
        sampleType: src.sampleType, group: src.group, chainId: src.finalChainId, steps: src.finalSteps, role: "final",
      });
      await c.from("tasks").insert({ data: nt });
    }
  }

  /* ---------- Поточен гейт (порт на erpSeriesProduced/erpFlowAvailable/
     erpFlowGatePending от erp-orders.js) — СЪЩАТА проверка като в Цехове:
     не може да се отчете повече, отколкото предната операция е дала. ---------- */
  function seriesProduced(tasks) {
    const map = {};
    (tasks || []).forEach(t => {
      const src = t && t.source;
      if (!src || !src.flow || !src.seriesKey) return;
      const m = map[src.seriesKey] || (map[src.seriesKey] = { produced: 0, qty: 0 });
      m.produced += n(t.produced); m.qty += n(t.qty);
    });
    return map;
  }
  function flowAvailable(t, map) {
    const src = t && t.source;
    const qty = n(t.qty), prod = n(t.produced);
    if (!src || !src.flow) return Math.max(0, qty - prod);
    let gateLimit = Infinity;
    if (Array.isArray(src.gate) && src.gate.length) {
      src.gate.forEach(entry => {
        const k = (typeof entry === "string") ? entry : (entry && entry.key);
        const fromStock = (typeof entry === "string") ? 0 : (n(entry && entry.stock));
        const per = (typeof entry === "object" && entry && entry.per != null) ? Number(entry.per) : null;
        const g = map[k];
        if (!g) return;
        const produced = n(g.produced);
        if (per != null) {
          const have = fromStock + produced;
          const covers = per > 0 ? Math.floor(have / per) : (have > 0 ? qty : 0);
          gateLimit = Math.min(gateLimit, covers);
          return;
        }
        const need = (typeof entry === "string") ? null : (n(entry && entry.need));
        if (need == null || need <= 0) { if (produced < n(g.qty)) gateLimit = 0; return; }
        const total = need + fromStock;
        const perL = qty > 0 ? total / qty : total;
        const have = fromStock + produced;
        const covers = perL > 0 ? Math.floor(have / perL) : (have >= total ? qty : 0);
        gateLimit = Math.min(gateLimit, covers);
      });
    }
    let avail;
    if (src.prevKey) {
      const brak = n(t.brak);
      const up = map[src.prevKey];
      avail = Math.max(0, (up ? up.produced : 0) - prod - brak);
    } else {
      avail = Math.max(0, qty - prod);
    }
    if (gateLimit !== Infinity) avail = Math.min(avail, Math.max(0, gateLimit - prod));
    return avail;
  }
  function gatePending(t, map) {
    const src = t && t.source;
    if (!src || !Array.isArray(src.gate)) return [];
    const out = [];
    const tqty = n(t && t.qty);
    src.gate.forEach(entry => {
      const k = (typeof entry === "string") ? entry : (entry && entry.key);
      const fromStock = (typeof entry === "string") ? 0 : n(entry && entry.stock);
      const per = (typeof entry === "object" && entry && entry.per != null) ? Number(entry.per) : null;
      const g = map[k];
      if (!g) return;
      const producedNow = n(g.produced);
      const p = String(k).split("¦");
      if (per != null) {
        const totalParts = per * tqty;
        const haveParts = fromStock + producedNow;
        if (totalParts > 1e-9 && haveParts < totalParts - 1e-9) out.push({ code: p[0] || "", operation: p[1] || "", produced: haveParts, qty: totalParts });
        return;
      }
      const need = (typeof entry === "string") ? null : n(entry && entry.need);
      const target = (need != null && need > 0) ? Math.min(need, n(g.qty)) : n(g.qty);
      if (target > 0 && producedNow < target) out.push({ code: p[0] || "", operation: p[1] || "", produced: producedNow + fromStock, qty: target + fromStock });
    });
    return out;
  }
  /* Проверка ПРЕДИ отчет от изнесено приложение: matches = задачите за това
     изделие, qty = колко искат да запишат. Връща { ok } или { ok:false, msg }
     с точно същите съобщения като главното табло. При мрежова грешка НЕ
     блокира (по-добре отчет, отколкото спряна работа). */
  async function gateCheck(c, matches, qty) {
    const isGated = t => t && t.source && t.source.flow && (t.source.prevKey || (Array.isArray(t.source.gate) && t.source.gate.length));
    const open = (matches || []).filter(t => Math.max(0, n(t.qty) - n(t.produced)) > 0);
    const pool = open.length ? open : (matches || []);
    if (!pool.length || pool.some(t => !isGated(t))) return { ok: true };   // има негейтната цел → не ограничаваме
    let rows;
    try { rows = await selAll(c, "tasks", "id,data", "data->source->>flow", "true"); }
    catch (e) { return { ok: true }; }
    const map = seriesProduced(rows.map(r => r.data || {}));
    let allowed = 0; const pend = [];
    pool.forEach(t => { allowed += flowAvailable(t, map); gatePending(t, map).forEach(p => pend.push(p)); });
    if (qty <= allowed) return { ok: true };
    const seen = new Set();
    const detail = pend.filter(p => { const k = p.code + "¦" + p.operation; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(p => `• ${p.code}${p.operation ? " · " + p.operation : ""}: готови ${p.produced}/${p.qty}`).join("\n");
    return { ok: false, allowed, msg: allowed > 0
      ? `Поточно производство: сега можеш да запишеш най-много ${allowed} бр. (толкова са произведени в предната операция).${detail ? "\n\nЧака да се завършат:\n" + detail : ""}`
      : `Поточно производство: детайлите за тази стъпка още не са готови в предната операция.${detail ? "\n\nЧака да се завършат:\n" + detail : ""}\n\nИзчакай съответния цех.` };
  }

  // Дялове на заявките от бройките [from, to) на споделена серия — порт на
  // erpFlowOrderShares от erp-orders.js (за дозаключването по-долу).
  function orderShares(src, from, to) {
    const out = [];
    let off = 0;
    ((src && src.orders) || []).forEach(o => {
      const q = n(o && o.qty);
      if (!(q > 0)) return;
      const a = Math.max(from, off), b = Math.min(to, off + q);
      if (b > a) out.push({ sid: String(o.id), qty: b - a });
      off += q;
    });
    return out;
  }
  // Добавя резервирани бройки в кръстосаното нетване (app_config →
  // flow_netting) — порт на erpNettingBump. Чете свежо и пипа само своите заявки.
  async function nettingBump(c, shares, pid, sign) {
    if (!shares || !shares.length || !pid) return;
    const key = String(pid);
    const { data } = await c.from("app_config").select("data").eq("id", "flow_netting").maybeSingle();
    const byOrder = (data && data.data && data.data.byOrder) || {};
    shares.forEach(s => {
      const m = byOrder[s.sid] || (byOrder[s.sid] = {});
      const v = n(m[key]) + sign * s.qty;
      if (v > 0) m[key] = v; else delete m[key];
      if (!Object.keys(m).length) delete byOrder[s.sid];
    });
    await c.from("app_config").upsert({ id: "flow_netting", data: { byOrder }, updated_at: new Date().toISOString() });
  }

  // Складовите движения по една задача. t = данните СЛЕД вдигането на produced
  // (същият обект, който току-що е записан). Мутира t.source (stocked /
  // consumedUnits / matConsumed) и презаписва задачата само ако има промяна.
  async function afterCredit(c, rowId, t) {
    // Последователна верига (мостра / производство за склад): готова стъпка →
    // пусни следващата операция (порт на erpAdvanceSeq, липсваше тук).
    try { await advanceSeq(c, rowId, t); } catch (e) { console.warn("seq advance", e); }
    const src = t && t.source;
    if (!src || !src.flow) return;   // стар модел / ръчна задача — няма складова логика
    const produced = n(t.produced);
    const name = t.code || t.product || "";
    let changed = false;
    // 1) Последна операция → готовото влиза в Склад детайли.
    if (src.last && src.pid) {
      const delta = produced - n(src.stocked);
      if (delta > 0) {
        const { error } = await c.from("product_movements").insert({ product_id: Number(src.pid), kind: "заприходяване", quantity: delta, ref: "prod:" + rowId, note: "Производство · " + name });
        if (!error) {
          // Готовото изделие на ЗАЯВКА се дозаключва към резервацията ѝ
          // (кръстосано нетване) — както erpFlowStockIn в главното табло.
          // „Производство за склад" (src.stock) не се пази — то е свободно.
          if (src.toStock && !src.stock) {
            try { await nettingBump(c, orderShares(src, n(src.stocked), produced), src.pid, +1); }
            catch (e) { console.warn("stock-in netting", e); }   // изравнява се при повторно пускане
          }
          src.stocked = produced; changed = true;
        }
      }
    }
    // 2) Сглобяваща операция → изписва вложените части от Склад детайли.
    if (Array.isArray(src.consumes) && src.consumes.length) {
      const delta = produced - n(src.consumedUnits);
      if (delta > 0) {
        const rows = [];
        src.consumes.forEach(cc => {
          const pid = Number(cc && cc.pid) || 0; const use = n(cc && cc.per) * delta;
          if (pid && use > 0) rows.push({ product_id: pid, kind: "изписване", quantity: -use, ref: "consume:" + rowId, note: "Вложен в " + name });
        });
        let ok = true;
        if (rows.length) { const { error } = await c.from("product_movements").insert(rows); ok = !error; }
        if (ok) { src.consumedUnits = produced; changed = true; }
      }
    }
    // 3) Първа операция (рязане) → изписва материала от Склад материали.
    if (Array.isArray(src.materials) && src.materials.length) {
      const delta = produced - n(src.matConsumed);
      if (delta > 0) {
        const rows = [];
        src.materials.forEach(m => {
          const mid = Number(m && m.mid) || 0; const use = n(m && m.per) * delta;
          if (mid && use > 0) rows.push({ material_id: mid, kind: "изписване", quantity: -use, ref: "matprod:" + rowId, note: "Вложен в " + name });
        });
        let ok = true;
        if (rows.length) { const { error } = await c.from("stock_movements").insert(rows); ok = !error; }
        if (ok) { src.matConsumed = produced; changed = true; }
      }
    }
    if (changed) {
      const done = n(t.qty) > 0 && produced >= n(t.qty);
      await c.from("tasks").update({ data: t, done, updated_at: new Date().toISOString() }).eq("id", rowId);
    }
  }

  // Вечен производствен дневник (production_log) — както prodLogWrite в tasks.js.
  // Ако entry.lid липсва, се генерира (същият lid трябва да е и в t.logs, за да
  // не се брои двойно в справките).
  async function prodLog(c, rowId, t, entry) {
    try {
      const lid = entry.lid || (Date.now().toString(36) + "-x-" + Math.random().toString(36).slice(2, 6));
      entry.lid = lid;
      const nos = [...new Set(((t.source && t.source.orders) || []).map(o => o && o.no).filter(Boolean))];
      const snap = Object.assign({}, entry, {
        workshop: t.workshop || "", operation: t.operation || "", product: t.product || "", code: t.code || "",
        client: t.client || "", orderNo: nos.join(", "), notes: entry.notes || "",
      });
      await c.from("production_log").insert({ lid, task_id: (typeof rowId === "number" ? rowId : null), data: snap });
    } catch (e) { /* таблицата може да липсва — тихо, логът остава на задачата */ }
  }

  // Ако всички операции на заявката са готови → статус „готова за продажба"
  // (както erpMarkOrderReadyIfDone в главното приложение).
  async function markOrdersReady(c, orderIds) {
    const ids = [...new Set((orderIds || []).map(String))].filter(Boolean);
    if (!ids.length) return;
    let all = null;   // всички поточни задачи — четем ги веднъж за всички заявки
    for (const oid of ids) {
      try {
        const co = await c.from("customer_orders").select("id,data").eq("id", oid).maybeSingle();
        if (!co || !co.data) continue;   // мостра / производство за склад — няма статус
        const d = (co.data.data) || {};
        if (d.status !== "в производство") continue;
        if (!all) all = await selAll(c, "tasks", "id,data,done", "data->source->>flow", "true");
        const rows = all.filter(r => { const s = r.data && r.data.source; return s && s.kind === "series" && (s.orderIds || []).map(String).includes(oid); });
        if (!rows.length) continue;
        const allDone = rows.every(r => { const dd = r.data || {}; return n(dd.qty) > 0 && n(dd.produced) >= n(dd.qty); });
        if (!allDone) continue;
        d.status = "готова за продажба";
        await c.from("customer_orders").update({ data: d, updated_at: new Date().toISOString() }).eq("id", oid);
      } catch (e) { /* следващата заявка */ }
    }
  }

  /* ---------- 🎨 Авто-боя (както в главното табло) ----------
     Бояджийно не се отчита — щом отчет от масите/роботите отключи детайли
     за него, задачата му се отчита автоматично („авто-боя") и потокът
     продължава. Изключване: app_config id="paint_auto" data {"on": false}. */
  async function autoPaint(c) {
    try {
      const { data } = await c.from("app_config").select("data").eq("id", "paint_auto").maybeSingle();
      if (data && data.data && data.data.on === false) return 0;
    } catch (e) { /* без връзка към ключа — автоматиката е включена */ }
    let total = 0;
    for (let pass = 0; pass < 3; pass++) {
      let rows;
      try { rows = await selAll(c, "tasks", "id,data,done"); } catch (e) { return total; }
      const all = rows.map(r => ({ ...(r.data || {}), id: r.id }));
      const map = seriesProduced(all);
      let changed = 0;
      for (const t of all) {
        if ((t.workshop || "") !== "Бояджийно") continue;
        const src = t.source || {};
        const qty = n(t.qty), prod = n(t.produced);
        let add = 0;
        if (src.seq) add = Math.max(0, qty - prod);
        else if (src.flow) add = flowAvailable(t, map);
        else continue;
        if (add <= 0) continue;
        t.produced = prod + add;
        t.logs = Array.isArray(t.logs) ? t.logs : [];
        const entry = { date: new Date().toISOString().slice(0, 10), worker: "авто-боя", qty: add, lid: Date.now().toString(36) + "-p-" + Math.random().toString(36).slice(2, 6), notes: "автоматично (Бояджийно не се отчита)" };
        t.logs.push(entry);
        const done = qty > 0 && n(t.produced) >= qty;
        const { error } = await c.from("tasks").update({ data: t, done, updated_at: new Date().toISOString() }).eq("id", t.id);
        if (error) continue;
        try { await afterCredit(c, t.id, t); } catch (e) {}   // склад + следваща стъпка от веригата
        try { await prodLog(c, t.id, t, entry); } catch (e) {}
        if (src.flow && src.seriesKey && map[src.seriesKey]) map[src.seriesKey].produced += add;
        changed++;
      }
      total += changed;
      if (!changed) break;   // нов проход хваща стъпки, пуснати от advanceSeq
    }
    return total;
  }

  window.FLOW_CREDIT = { afterCredit, prodLog, markOrdersReady, gateCheck, autoPaint };
})();
