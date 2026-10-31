-- ============================================================
-- DANKO Sales Agent — Фаза 2B: таблицата crm_jobs (джобовете на пайплайна).
-- Пуска се ВЕДНЪЖ в Supabase → SQL Editor.
--
-- Джоб = едно стартиране от Системата (Stage 1 / Stage 2 / Outreach / пълен
-- пайплайн). Създава го САМО crm-bridge (service role), n8n Runner-ът го
-- обновява през crm-bridge (callback с таен header), а браузърът само ЧЕТЕ
-- (RLS по имейл). Никой браузър не може да вмъкне/подправи джоб.
--
-- Статуси на джоба: QUEUED → RUNNING → COMPLETED | PARTIAL | FAILED
--   PARTIAL = завърши, но с пропуски (напр. 1 компания без потвърден имейл)
--   — това е ВАЛИДЕН резултат, не грешка. Конвенцията е документирана тук
--   и в crm-jobs-n8n-runner.md.
-- Статуси на етап (в stages): PENDING|RUNNING|COMPLETED|PARTIAL|FAILED|SKIPPED
-- ============================================================

create table if not exists crm_jobs (
  id uuid primary key default gen_random_uuid(),
  request_id text unique not null,          -- идемпотентност: същото request_id НЕ пуска втори джоб
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_email text,                    -- от проверения JWT (не от браузъра!)
  mode text not null check (mode in ('STAGE1','STAGE2','OUTREACH','FULL_PIPELINE')),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED')),
  params jsonb not null default '{}'::jsonb,   -- {country,target_count,min_fit_score,industry_focus,exclude_industries,requested_websites}
  stages jsonb not null default '{}'::jsonb,   -- {stage1:{status,requested,completed,success,failed},stage2:{...},outreach:{...}}
  companies jsonb not null default '[]'::jsonb,-- [{website,company,country,fit_score,phase,outcome,draft_id,draft_link,note}]
  drafts_created integer not null default 0,
  emails_sent integer not null default 0 check (emails_sent = 0),  -- ЖЕЛЯЗНОТО ПРАВИЛО, вкопано в базата
  current_stage text,
  progress_percent integer,
  result jsonb,
  error text,
  n8n_execution_id text,
  finished_at timestamptz
);

create index if not exists crm_jobs_created on crm_jobs (created_at desc);

-- updated_at се опреснява само при реална промяна.
create or replace function crm_jobs_touch() returns trigger as $$
begin new.updated_at = now(); return new; end $$ language plpgsql;
drop trigger if exists crm_jobs_touch_tr on crm_jobs;
create trigger crm_jobs_touch_tr before update on crm_jobs
  for each row execute function crm_jobs_touch();

alter table crm_jobs enable row level security;

-- Браузърът САМО ЧЕТЕ, и то само оторизираните за Sales Agent (същият
-- allow-list като в crm-bridge). INSERT/UPDATE политики НЯМА — пише само
-- service role (crm-bridge), така никой не може да си „нарисува" резултат.
drop policy if exists "crm jobs read" on crm_jobs;
create policy "crm jobs read" on crm_jobs for select to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) in ('dankog@gmail.com', 'grigor.baykov@dankosystems.com'));

-- Проверка: select id, mode, status, created_at from crm_jobs order by created_at desc limit 5;
