-- =============================================================
-- 005_import_tables.sql
-- Log de importações de planilha e erros por linha.
-- =============================================================

create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  file_size     bigint,
  status        text not null default 'PENDENTE'
                check (status in ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'COM_ERROS', 'FALHOU')),
  total_rows    integer,
  valid_rows    integer,
  error_rows    integer,
  warning_rows  integer,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table if not exists public.import_errors (
  id               uuid primary key default gen_random_uuid(),
  import_batch_id  uuid not null references public.import_batches (id) on delete cascade,
  row_number       integer not null,
  column_name      text,
  error_type       text not null,
  message          text not null,
  raw_value        text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_import_batches_created_at
  on public.import_batches (created_at desc);
create index if not exists idx_import_errors_batch_id
  on public.import_errors (import_batch_id);

-- -------------------------------------------------------------
-- RLS das tabelas de importação
-- -------------------------------------------------------------
alter table public.import_batches enable row level security;
alter table public.import_errors enable row level security;

revoke all on table public.import_batches from anon;
revoke all on table public.import_errors from anon;

drop policy if exists "import_batches_select" on public.import_batches;
create policy "import_batches_select" on public.import_batches
  for select to authenticated using (true);

drop policy if exists "import_batches_insert" on public.import_batches;
create policy "import_batches_insert" on public.import_batches
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "import_batches_update" on public.import_batches;
create policy "import_batches_update" on public.import_batches
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "import_batches_delete" on public.import_batches;
create policy "import_batches_delete" on public.import_batches
  for delete to authenticated using (public.is_admin());

drop policy if exists "import_errors_select" on public.import_errors;
create policy "import_errors_select" on public.import_errors
  for select to authenticated using (true);

drop policy if exists "import_errors_insert" on public.import_errors;
create policy "import_errors_insert" on public.import_errors
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));
