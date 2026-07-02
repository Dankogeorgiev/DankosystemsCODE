-- ============================================================
-- Данко Системс — Модул „СКЛАД + РЕЦЕПТИ + СЕБЕСТОЙНОСТ" (MRP-lite)
-- ------------------------------------------------------------
-- Как се пуска:
--   1. Влез в проекта си в Supabase (същия като СИСТЕМАТА).
--   2. Отляво: „SQL Editor" → „New query".
--   3. Постави ЦЕЛИЯ този файл и натисни „Run".
-- Безопасно е да се пусне повторно (използва IF NOT EXISTS / OR REPLACE).
-- Не пипа съществуващите таблици (samples, tasks, contacts, messages, app_config).
-- ============================================================

-- ============ 1. МАТЕРИАЛИ (Метали + Покупни/стока — купуват се, не се правят) ============
create table if not exists public.materials (
  id          bigint generated always as identity primary key,
  code        text unique,                 -- Bizzio "Код"
  name        text not null,               -- Bizzio "Артикул"
  group_name  text,                        -- Bizzio "Група" (Метали - Ламарина лист, ...)
  is_purchased boolean default false,      -- true = Покупни/стока; false = Метали
  unit        text not null default 'кг',  -- разходна мярка (кг / м / бр)
  avg_cost    numeric(12,4) default 0,     -- средно-претеглена цена/ед. (EUR)
  min_stock   numeric(14,3) default 0,     -- точка на презареждане
  created_at  timestamptz default now()
);

-- ============ 2. ОПЕРАЦИИ (услуги: лазер, огъване, заварка, боядисване, поцинковане...) ============
create table if not exists public.operations (
  id           bigint generated always as identity primary key,
  code         text unique,                -- Bizzio "Код"
  name         text not null,              -- напр. Рязане лазер
  workshop     text,                       -- към кой цех се маппва (по Група)
  unit_cost    numeric(12,4) default 0,    -- плоска цена/операция от ERP (EUR) — за миграция
  rate_per_min numeric(12,4) default 0,    -- ставка EUR/мин (за бъдеща реална себест. от Цехове)
  created_at   timestamptz default now()
);

-- ============ 3. ПРОДУКТИ (артикули И полуфабрикати/възли — и двете имат рецепта) ============
create table if not exists public.products (
  id              bigint generated always as identity primary key,
  code            text unique,             -- Bizzio "Код" / "Продукт (код)"
  name            text not null,
  is_semifinished boolean default false,   -- true = полуфабрикат/възел/детайл (влиза в друг продукт)
  group_name      text,                    -- Bizzio "Група" (Артикули, Възли, Детайли, ...)
  needs_recipe    boolean default false,   -- true = заготовка без рецепта („Чака рецепта")
  owner_client    text,                    -- незадължителен етикет (напр. SD Heat Exchangers)
  unit            text default 'бр.',
  drawings        jsonb not null default '[]'::jsonb,   -- прикачени чертежи (име/url/път)
  created_at      timestamptz default now()
);

-- Ако таблицата вече съществува (по-стар вариант) — добавяме колоната за чертежи.
alter table public.products add column if not exists drawings jsonb not null default '[]'::jsonb;

-- ============ 4. РЕЦЕПТА (BOM) — сърцето. Всеки ред сочи ТОЧНО ЕДНО от три неща ============
create table if not exists public.recipe_lines (
  id               bigint generated always as identity primary key,
  product_id       bigint not null references public.products(id) on delete cascade,
  position         int,                          -- Bizzio "#" в документа
  material_id      bigint references public.materials(id),  -- Тип = материал / стока
  child_product_id bigint references public.products(id),   -- Тип = полуфабрикат/възел  [многостепенност]
  operation_id     bigint references public.operations(id), -- Тип = услуга
  quantity         numeric(14,4) not null default 1,
  unit             text,
  line_cost        numeric(12,4),                -- Bizzio "Кр.цена" на реда (снимка от ERP, справка)
  constraint one_component_only check (
      (material_id is not null)::int
    + (child_product_id is not null)::int
    + (operation_id is not null)::int = 1 ),
  constraint no_self_reference check (
    child_product_id is null or child_product_id <> product_id )
);

create index if not exists idx_rl_product on public.recipe_lines(product_id);
create index if not exists idx_rl_material on public.recipe_lines(material_id);
create index if not exists idx_rl_child on public.recipe_lines(child_product_id);
create index if not exists idx_rl_operation on public.recipe_lines(operation_id);

-- ============ 5. ДВИЖЕНИЯ (склад) — наличност = сбор от движенията ============
create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  material_id bigint not null references public.materials(id),
  kind        text not null check (kind in ('начално','входящ','изписване','корекция')),
  quantity    numeric(14,3) not null,        -- + за влизане, - за изписване
  ref         text,                          -- доставчик / № заявка / бележка
  note        text,
  created_at  timestamptz default now(),
  created_by  text
);

create index if not exists idx_mv_material on public.stock_movements(material_id);

-- Текуща наличност (изчислена, не се пази наум)
create or replace view public.v_material_stock as
select m.id, m.code, m.name, m.unit, m.min_stock, m.is_purchased,
       coalesce(sum(sm.quantity),0) as stock,
       (coalesce(sum(sm.quantity),0) < m.min_stock) as below_min
from public.materials m
left join public.stock_movements sm on sm.material_id = m.id
group by m.id;

-- ============ 6. СЕБЕСТОЙНОСТ (рекурсивна, многостепенна, със защита от цикли) ============
create or replace function public.product_cost(p_id bigint, _depth int default 0)
returns numeric language sql stable as $$
  select case when _depth > 25 then 0 else coalesce(sum(
    case
      when rl.material_id is not null      then rl.quantity * coalesce(m.avg_cost,0)
      when rl.operation_id is not null     then rl.quantity * coalesce(o.unit_cost,0)
      when rl.child_product_id is not null then rl.quantity * public.product_cost(rl.child_product_id, _depth+1)
    end),0) end
  from public.recipe_lines rl
  left join public.materials  m on m.id = rl.material_id
  left join public.operations o on o.id = rl.operation_id
  where rl.product_id = p_id;
$$;

create or replace view public.v_product_cost as
select id, code, name, is_semifinished, group_name, needs_recipe,
       round(public.product_cost(id),4) as cost_eur
from public.products order by name;

-- ============ 7. РАЗБИВКА НА НУЖДИТЕ (нетиране): продукт × бройка → суровини ============
create or replace function public.bom_requirements(p_id bigint, p_qty numeric default 1)
returns table(material_id bigint, name text, unit text, required numeric)
language sql stable as $$
  with recursive explode as (
    select rl.material_id, rl.child_product_id, (rl.quantity * p_qty)::numeric as qty
    from public.recipe_lines rl where rl.product_id = p_id
    union all
    select rl.material_id, rl.child_product_id, e.qty * rl.quantity
    from explode e
    join public.recipe_lines rl on rl.product_id = e.child_product_id
    where e.child_product_id is not null
  )
  select m.id, m.name, m.unit, sum(e.qty)
  from explode e join public.materials m on m.id = e.material_id
  where e.material_id is not null
  group by m.id, m.name, m.unit;
$$;

-- ============ 8. ДОСТЪП (RLS) — както другите таблици: само за влезли потребители ============
-- Достъпът „само админ/офис" се пази в интерфейса (както при другите админ модули).
alter table public.materials       enable row level security;
alter table public.operations      enable row level security;
alter table public.products        enable row level security;
alter table public.recipe_lines    enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists "materials auth all" on public.materials;
create policy "materials auth all" on public.materials
  for all to authenticated using (true) with check (true);

drop policy if exists "operations auth all" on public.operations;
create policy "operations auth all" on public.operations
  for all to authenticated using (true) with check (true);

drop policy if exists "products auth all" on public.products;
create policy "products auth all" on public.products
  for all to authenticated using (true) with check (true);

drop policy if exists "recipe_lines auth all" on public.recipe_lines;
create policy "recipe_lines auth all" on public.recipe_lines
  for all to authenticated using (true) with check (true);

drop policy if exists "stock_movements auth all" on public.stock_movements;
create policy "stock_movements auth all" on public.stock_movements
  for all to authenticated using (true) with check (true);

-- Готово! Изгледите (v_material_stock, v_product_cost) и функциите
-- (product_cost, bom_requirements) наследяват достъпа на таблиците.
