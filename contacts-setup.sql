-- ============================================================
-- Данко Системс — Модул „Контакти“
-- Пусни веднъж в Supabase → SQL Editor → Run. Безопасно е повторно.
-- ============================================================
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists contacts_updated_idx on public.contacts (updated_at desc);

alter table public.contacts enable row level security;
drop policy if exists "contacts auth all" on public.contacts;
create policy "contacts auth all" on public.contacts
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.contacts;
exception when duplicate_object then null;
end $$;
-- Готово!
