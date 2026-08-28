-- ============================================================================
-- Данко Системс — СКЛАД ЗА ДЕТАЙЛИ/ПОЛУФАБРИКАТИ (готова продукция на етап)
-- Пусни този файл ВЕДНЪЖ в Supabase → SQL Editor.
-- Дава наличност и на детайлите/възлите (не само на суровините), за да може при
-- пускане в производство системата да приспадне наличното и да прати в цех само
-- недостига. Наличност = сбор от движенията (както при материалите).
-- ============================================================================

create table if not exists public.product_movements (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.products(id) on delete cascade,
  kind        text not null check (kind in ('начално','заприходяване','изписване','корекция')),
  quantity    numeric(14,3) not null,        -- + за влизане в склада, - за изписване
  ref         text,                          -- напр. „order:123" (връзка към заявка) / бележка
  note        text,
  created_at  timestamptz default now(),
  created_by  text
);

create index if not exists idx_pmv_product on public.product_movements(product_id);
create index if not exists idx_pmv_ref on public.product_movements(ref);

-- Текуща наличност на детайли/полуфабрикати (изчислена от движенията).
create or replace view public.v_product_stock as
select p.id, p.code, p.name, p.is_semifinished, p.group_name,
       coalesce(sum(pm.quantity), 0) as stock
from public.products p
left join public.product_movements pm on pm.product_id = p.id
group by p.id, p.code, p.name, p.is_semifinished, p.group_name;

-- Права: всеки влязъл потребител (както другите таблици).
alter table public.product_movements enable row level security;
drop policy if exists "product_movements auth all" on public.product_movements;
create policy "product_movements auth all" on public.product_movements
  for all to authenticated using (true) with check (true);

-- Готово! Изгледът v_product_stock дава наличността на всеки детайл/възел.
