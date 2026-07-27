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

  // Складовите движения по една задача. t = данните СЛЕД вдигането на produced
  // (същият обект, който току-що е записан). Мутира t.source (stocked /
  // consumedUnits / matConsumed) и презаписва задачата само ако има промяна.
  async function afterCredit(c, rowId, t) {
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
        if (!error) { src.stocked = produced; changed = true; }
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

  window.FLOW_CREDIT = { afterCredit, prodLog, markOrdersReady };
})();
