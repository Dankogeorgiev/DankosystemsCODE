-- ============================================================
-- Данко Системс — „Палетни описи" (архивът от Google Drive).
-- Пуска се ВЕДНЪЖ в Supabase → SQL Editor. Самите описи се качват
-- след това от Системата: Опаковки → „⬆ Стари описи (импорт)"
-- с файла packing-archive.json.
--
-- Какво пази: текстът на всеки исторически палетен опис по клиент.
-- Оттам „🤖 Опис с AI" учи как точно се редят палетите на клиента
-- (стил, език, групиране, типични бройки) и пише новия опис така.
-- ============================================================

create table if not exists packing_archive (
  id bigint generated always as identity primary key,
  client text not null,          -- името на папката в архива (напр. "Начеви", "SAMAC")
  doc_date date,                 -- датата от името на файла (25.01.19 → 2019-01-25)
  source text,                   -- пътят на файла в архива, за проследимост
  kind text,                     -- doc | docx | xlsx
  body text,                     -- извлеченият текст на описа
  created_at timestamptz default now()
);

create index if not exists packing_archive_client_date
  on packing_archive (client, doc_date desc);

alter table packing_archive enable row level security;

-- Влезлите потребители четат, качват и презареждат архива.
drop policy if exists "parc read" on packing_archive;
create policy "parc read" on packing_archive for select to authenticated using (true);
drop policy if exists "parc insert" on packing_archive;
create policy "parc insert" on packing_archive for insert to authenticated with check (true);
drop policy if exists "parc delete" on packing_archive;
create policy "parc delete" on packing_archive for delete to authenticated using (true);

-- Проверка след импорта: select client, count(*) from packing_archive group by client order by 2 desc;
