alter table public.employees
  add column if not exists registered_function text;

create or replace function public.import_employees(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.current_profile_has_permission('rh.employees.import') then
    raise exception 'Você não tem permissão para importar funcionários.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'A lista de funcionários para importação é inválida.';
  end if;

  if public.current_profile_is_external() then
    raise exception 'Usuários externos não podem importar funcionários.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_rows) as row_data(company_code text)
     where nullif(btrim(row_data.company_code), '') is null
        or not public.current_profile_company_allowed(btrim(row_data.company_code))
  ) then
    raise exception 'A importação contém empresa fora do escopo autorizado.';
  end if;

  insert into public.employees (
    company_code, company_name, registration, name,
    admission_date, dismissal_date, registered_client, registered_function
  )
  select
    btrim(row_data.company_code),
    btrim(row_data.company_name),
    btrim(row_data.registration),
    btrim(row_data.name),
    nullif(row_data.admission_date, '')::date,
    nullif(row_data.dismissal_date, '')::date,
    nullif(btrim(row_data.registered_client), ''),
    nullif(btrim(row_data.registered_function), '')
  from jsonb_to_recordset(p_rows) as row_data (
    company_code text,
    company_name text,
    registration text,
    name text,
    admission_date text,
    dismissal_date text,
    registered_client text,
    registered_function text
  )
  on conflict (company_code, registration) do update set
    company_name = excluded.company_name,
    name = excluded.name,
    admission_date = coalesce(excluded.admission_date, public.employees.admission_date),
    dismissal_date = coalesce(excluded.dismissal_date, public.employees.dismissal_date),
    registered_client = coalesce(excluded.registered_client, public.employees.registered_client),
    registered_function = coalesce(excluded.registered_function, public.employees.registered_function),
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_employees(jsonb) from public, anon;
grant execute on function public.import_employees(jsonb) to authenticated;
