-- ============================================================
-- Данко Системс — график за автоматичния сутрешен имейл.
-- Пуска се ВЕДНЪЖ в Supabase → SQL Editor (след като daily-mail
-- функцията е деплойната и тайните ключове са настроени).
--
-- Графикът е в UTC: 04:30 UTC = 07:30 българско лятно / 06:30 зимно.
-- Ако искаш друг час: смени '30 4 * * *' (минути часове * * *).
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Маха стария график, ако вече е създаван (за да няма дубли).
select cron.unschedule('daily-mail-morning')
where exists (select 1 from cron.job where jobname = 'daily-mail-morning');

select cron.schedule(
  'daily-mail-morning',
  '30 4 * * *',
  $$
  select net.http_post(
    url := 'https://hwbblteomrrahfrsyuow.supabase.co/functions/v1/daily-mail',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Проверка: select * from cron.job;
-- Ръчен тест веднага (без да чакаш сутринта):
-- select net.http_post(
--   url := 'https://hwbblteomrrahfrsyuow.supabase.co/functions/v1/daily-mail',
--   headers := '{"Content-Type": "application/json"}'::jsonb,
--   body := '{}'::jsonb
-- );
