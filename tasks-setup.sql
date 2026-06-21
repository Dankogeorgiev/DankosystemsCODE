-- ============================================================
-- Данко Системс — Модул „Цехове / Производствени задачи“
-- Пусни този файл веднъж в Supabase → SQL Editor → Run.
-- Безопасно е да се пусне повторно.
-- ============================================================

-- Задачи за производство (по цехове)
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb       not null default '{}'::jsonb,
  done        boolean     not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists tasks_updated_idx on public.tasks (updated_at desc);

alter table public.tasks enable row level security;
drop policy if exists "tasks auth all" on public.tasks;
create policy "tasks auth all" on public.tasks
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;

-- Споделени настройки (напр. работници по цехове)
create table if not exists public.app_config (
  id          text primary key,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "config auth all" on public.app_config;
create policy "config auth all" on public.app_config
  for all to authenticated using (true) with check (true);

-- Готово!
