-- ============================================================
-- Данко Системс — Модул „Линия за боядисване“ (подвески)
-- Пусни този файл веднъж в Supabase → SQL Editor → Run.
-- Безопасно е да се пусне повторно.
-- (Нужен е само когато слееш модула с облака — прототипът работи
--  и без него, локално в браузъра.)
-- ============================================================

create table if not exists public.painting (
  id          uuid        primary key default gen_random_uuid(),
  data        jsonb       not null default '{}'::jsonb,  -- {ral, color, part, count, note}
  done        boolean     not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists painting_created_idx on public.painting (created_at);
create index if not exists painting_done_idx    on public.painting (done);

alter table public.painting enable row level security;
drop policy if exists "painting auth all" on public.painting;
create policy "painting auth all" on public.painting
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.painting;
exception when duplicate_object then null;
end $$;

-- Готово!
