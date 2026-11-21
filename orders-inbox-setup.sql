-- ============================================================
-- Данко Системс — „📥 Входящи заявки" (агент за danko.orders@gmail.com).
-- Пуска се ВЕДНЪЖ в Supabase → SQL Editor, ПРЕДИ деплоя на orders-poll.
--
-- Какво прави: пощенска кутия в базата, в която Edge функцията orders-poll
-- записва новите писма-заявки (класифицирани и разчетени от Claude).
-- Заявка в customer_orders се ражда ЧАК при одобрение от човек в Системата.
-- ============================================================

create table if not exists orders_inbox (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text unique not null,      -- идемпотентност: писмо не влиза два пъти
  received_at timestamptz,
  from_email text,
  from_name text,
  subject text,
  body_text text,
  is_order boolean,                            -- класификацията на Claude
  classify_reason text,
  parsed jsonb,                                -- разчетената заявка (същата схема като parse-document)
  files jsonb default '[]'::jsonb,             -- [{name, type, path, url, size}]
  confidence numeric,
  notes text,
  status text not null default 'за_преглед',
    -- 'за_преглед' | 'одобрена' | 'отказана' | 'не_е_заявка' | 'грешка'
  decided_by text,                             -- кой е одобрил/отказал
  decided_at timestamptz,
  created_at timestamptz default now()
);

alter table orders_inbox enable row level security;

-- Влезлите потребители четат и решават (одобрение/отказ). INSERT няма политика —
-- пише само Edge функцията със service role ключа (заобикаля RLS).
drop policy if exists "inbox read" on orders_inbox;
create policy "inbox read" on orders_inbox for select to authenticated using (true);
drop policy if exists "inbox update" on orders_inbox;
create policy "inbox update" on orders_inbox for update to authenticated using (true) with check (true);

-- График: проверка на пощата на всеки 5 минути (pg_cron + pg_net, като daily-mail).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('orders-poll-5min')
where exists (select 1 from cron.job where jobname = 'orders-poll-5min');

select cron.schedule(
  'orders-poll-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://hwbblteomrrahfrsyuow.supabase.co/functions/v1/orders-poll',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Проверка: select * from cron.job;
-- Ръчен тест: select net.http_post(url := 'https://hwbblteomrrahfrsyuow.supabase.co/functions/v1/orders-poll', headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb);
