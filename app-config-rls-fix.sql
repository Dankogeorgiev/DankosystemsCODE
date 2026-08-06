-- Данко Системс — поправка на RLS + пред-създаване на редовете в app_config.
-- Причина: работник/потребител получаваше „new row violates row-level security
-- policy for table app_config" при ПЪРВИ запис на нов ключ (реда още го нямаше).
-- Пусни веднъж в Supabase → SQL Editor → Run.

-- 1) Правилната политика: всеки влязъл потребител чете/пише app_config
--    (както е замислено в tasks-setup.sql).
alter table public.app_config enable row level security;
drop policy if exists "config auth all" on public.app_config;
create policy "config auth all" on public.app_config
  for all to authenticated using (true) with check (true);

-- 2) Пред-създаване на редовете (SQL Editor работи с права, които заобикалят RLS).
--    Така всеки следващ запис от приложението е ОБНОВЯВАНЕ на съществуващ ред.
insert into public.app_config (id, data) values
  ('nit_reports',       '{"records":{}}'::jsonb),   -- ЗАНИТВАНЕ отчет
  ('invoice_series',    '{}'::jsonb),                -- номера на фактури
  ('recipe_templates',  '{"list":[]}'::jsonb),       -- шаблони за рецепти
  ('product_aliases',   '{"byClient":{}}'::jsonb),   -- AI: клиентски код → наш продукт
  ('material_aliases',  '{"byClient":{}}'::jsonb)    -- AI: описание на доставчик → наш материал
on conflict (id) do nothing;
