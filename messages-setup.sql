-- ============================================================
-- Данко Системс — Модул „Вътрешни съобщения“ (служител ↔ админ)
-- Пусни този файл веднъж в Supabase → SQL Editor → Run.
-- Безопасно е да се пусне повторно.
-- ============================================================

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  data        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at desc);

alter table public.messages enable row level security;
drop policy if exists "messages auth all" on public.messages;
create policy "messages auth all" on public.messages
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- Готово!
