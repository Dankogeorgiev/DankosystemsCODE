-- ============================================================
-- Данко Системс — Настройка на облачната база (Supabase)
-- ============================================================
-- Как се пуска:
--   1. Влез в проекта си в Supabase
--   2. Отляво: "SQL Editor" → "New query"
--   3. Постави ЦЕЛИЯ този файл и натисни "Run"
-- Безопасно е да се пусне повторно (използва IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- 1) Таблица с мострите. Цялата мостра се пази в "data" (JSON).
create table if not exists public.samples (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb       not null default '{}'::jsonb,
  completed   boolean     not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists samples_updated_at_idx on public.samples (updated_at desc);

-- 2) Защита на ниво ред: достъп само за влезли потребители.
alter table public.samples enable row level security;

drop policy if exists "authenticated full access" on public.samples;
create policy "authenticated full access" on public.samples
  for all
  to authenticated
  using (true)
  with check (true);

-- 3) Включваме "на живо" обновления (realtime) за таблицата.
--    Ако даде грешка "already member of publication" — нормално е, пропусни я.
do $$
begin
  alter publication supabase_realtime add table public.samples;
exception
  when duplicate_object then null;
end $$;

-- 4) Хранилище за чертежи (снимки/PDF).
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', true)
on conflict (id) do nothing;

-- 5) Правила за хранилището.
drop policy if exists "drawings public read" on storage.objects;
create policy "drawings public read" on storage.objects
  for select
  using (bucket_id = 'drawings');

drop policy if exists "drawings auth upload" on storage.objects;
create policy "drawings auth upload" on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'drawings');

drop policy if exists "drawings auth delete" on storage.objects;
create policy "drawings auth delete" on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'drawings');

-- Готово!
