-- ============================================================================
-- Данко Системс — ПРОИЗВОДСТВЕН ДНЕВНИК (вечна история на отчитанията)
-- Пусни този файл ВЕДНЪЖ в Supabase → SQL Editor.
-- Всяко отчитане в цех (кой, кога, колко, машина, време) се записва ТУК като
-- отделен ред. Така отчетите (ОТЧЕТИ) остават дори след като изтеглиш или
-- изтриеш поръчката — историята на свършения труд не зависи от задачите.
-- ============================================================================

create table if not exists public.production_log (
  id          bigint generated always as identity primary key,
  lid         text,                          -- уникален id на вписването (за дедупликация със задачите)
  task_id     bigint,                        -- коя задача го е породила (може вече да е изтрита)
  data        jsonb not null,                -- снимка: date, worker, qty, machine, времена, workshop, operation, product, code, client, orderNo, notes
  created_at  timestamptz default now()
);

create index if not exists idx_prodlog_lid on public.production_log(lid);
create index if not exists idx_prodlog_created on public.production_log(created_at);

-- Права: всеки влязъл потребител (както другите таблици).
alter table public.production_log enable row level security;
drop policy if exists "production_log auth all" on public.production_log;
create policy "production_log auth all" on public.production_log
  for all to authenticated using (true) with check (true);

-- Готово! Оттук нататък всяко отчитане се пази вечно, независимо от задачите.
