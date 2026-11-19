-- Separa o centro de custo importado do PDF dos campos de alocação atuais.
begin;

alter table public.employees
  add column if not exists registered_client text;

alter table public.employees
  add constraint employees_registered_client_not_blank
  check (registered_client is null or btrim(registered_client) <> '');

create index if not exists idx_employees_registered_client
  on public.employees (lower(registered_client));

-- Antes da alocação pela árvore, `location` continha o centro de custo
-- importado do PDF. Funcionários já alocados mantêm o local atual e recebem
-- Cliente Cadastrado vazio para evitar copiar local de trabalho como centro.
update public.employees
   set registered_client = location,
       location = null
 where allocation_position_id is null
   and registered_client is null
   and location is not null;

-- A planilha continua sendo a fonte de empresa, matrícula, nome e datas.
-- O PDF atualiza somente registered_client; jamais sobrescreve os campos de
-- cliente/local/turno/área controlados pela alocação.
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
    admission_date, dismissal_date, registered_client
  )
  select
    btrim(row_data.company_code),
    btrim(row_data.company_name),
    btrim(row_data.registration),
    btrim(row_data.name),
    nullif(row_data.admission_date, '')::date,
    nullif(row_data.dismissal_date, '')::date,
    nullif(btrim(row_data.registered_client), '')
  from jsonb_to_recordset(p_rows) as row_data(
    company_code text,
    company_name text,
    registration text,
    name text,
    admission_date text,
    dismissal_date text,
    registered_client text
  )
  where nullif(btrim(row_data.registration), '') is not null
    and nullif(btrim(row_data.name), '') is not null
  on conflict (company_code, registration) do update set
    company_name = excluded.company_name,
    name = excluded.name,
    admission_date = coalesce(excluded.admission_date, employees.admission_date),
    dismissal_date = coalesce(excluded.dismissal_date, employees.dismissal_date),
    registered_client = coalesce(excluded.registered_client, employees.registered_client),
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_employees(jsonb) from public, anon;
grant execute on function public.import_employees(jsonb) to authenticated, service_role;

commit;
