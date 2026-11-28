-- Данко Системс — таблица „Фактуриране".
-- Пусни я веднъж в Supabase (SQL Editor → New query → постави → Run).
-- Пази фактури, проформи, кредитни и дебитни известия. Данните са в JSON
-- (в стила на sales/customer_orders); номерът е отделна колона с уникален
-- индекс, за да няма дублирани номера (законово изискване).

create table if not exists invoices (
  id          bigint generated always as identity primary key,
  doc_no      text,                        -- издаденият номер (напр. 2000005343); null докато е чернова
  kind        text not null default 'invoice',   -- invoice | proforma | credit | debit
  posted      boolean not null default false,    -- издадена (заключена) ли е
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);

-- Уникален номер (но допуска много чернови без номер).
create unique index if not exists idx_invoices_docno on invoices(doc_no) where doc_no is not null;
create index if not exists idx_invoices_kind on invoices(kind);

alter table public.invoices enable row level security;
-- Достъп само за влезли потребители (както другите таблици в системата).
drop policy if exists "invoices auth all" on public.invoices;
create policy "invoices auth all" on public.invoices
  for all to authenticated using (true) with check (true);
