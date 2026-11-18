-- Cadastro de funcionários e importação de relatórios do RH.
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_code text not null,
  company_name text not null,
  registration text not null,
  name text not null,
  admission_date date,
  dismissal_date date,
  location text,
  status text generated always as (
    case when dismissal_date is null then 'ATIVO' else 'INATIVO' end
  ) stored,
  shift text,
  area text,
  client text,
  responsible_1 text,
  responsible_2 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint employees_company_registration_unique unique (company_code, registration),
  constraint employees_registration_not_blank check (btrim(registration) <> ''),
  constraint employees_name_not_blank check (btrim(name) <> '')
);

create index if not exists idx_employees_name on public.employees (lower(name));
create index if not exists idx_employees_status on public.employees (status);
create index if not exists idx_employees_location on public.employees (location);
create index if not exists idx_employees_company_code on public.employees (company_code);

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

alter table public.employees enable row level security;

drop policy if exists "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select to authenticated using (true);

drop policy if exists "employees_insert_admin" on public.employees;
create policy "employees_insert_admin" on public.employees
  for insert to authenticated with check (public.is_admin());

drop policy if exists "employees_update_admin" on public.employees;
create policy "employees_update_admin" on public.employees
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "employees_delete_admin" on public.employees;
create policy "employees_delete_admin" on public.employees
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.employees to authenticated;
revoke all on public.employees from anon;

-- Importação idempotente: atualiza somente campos vindos dos relatórios.
-- Os dados complementares mantidos pelo usuário ficam intactos em reimportações.
create or replace function public.import_employees(p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem importar funcionários.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'A lista de funcionários para importação é inválida.';
  end if;

  insert into public.employees (
    company_code, company_name, registration, name,
    admission_date, dismissal_date, location
  )
  select
    btrim(row_data.company_code),
    btrim(row_data.company_name),
    btrim(row_data.registration),
    btrim(row_data.name),
    nullif(row_data.admission_date, '')::date,
    nullif(row_data.dismissal_date, '')::date,
    nullif(btrim(row_data.location), '')
  from jsonb_to_recordset(p_rows) as row_data(
    company_code text,
    company_name text,
    registration text,
    name text,
    admission_date text,
    dismissal_date text,
    location text
  )
  where nullif(btrim(row_data.registration), '') is not null
    and nullif(btrim(row_data.name), '') is not null
  on conflict (company_code, registration) do update set
    company_name = excluded.company_name,
    name = excluded.name,
    admission_date = excluded.admission_date,
    dismissal_date = excluded.dismissal_date,
    location = coalesce(excluded.location, employees.location),
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_employees(jsonb) from public, anon;
grant execute on function public.import_employees(jsonb) to authenticated, service_role;
