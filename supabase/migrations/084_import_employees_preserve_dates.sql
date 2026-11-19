-- =============================================================
-- 084) Importação de funcionários: data ausente no arquivo não apaga
--      a data já cadastrada
-- =============================================================
-- Até a 081, admission_date/dismissal_date eram sobrescritas por
-- excluded.*, então uma linha sem data (célula vazia na planilha ou
-- funcionário vindo apenas do PDF de alocação) zerava admissão e
-- demissão. Como status é coluna gerada a partir de dismissal_date,
-- isso também reativava funcionários demitidos.
--
-- Regra nova: os relatórios só alteram datas quando trazem um valor;
-- data vazia preserva o que já está cadastrado, assim como location.
-- Efeito colateral aceito: a importação não consegue mais limpar uma
-- data; para isso o funcionário precisa ser editado manualmente.
-- Nome e empresa continuam vindo sempre do arquivo (campos NOT NULL).
-- =============================================================

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
    admission_date = coalesce(excluded.admission_date, employees.admission_date),
    dismissal_date = coalesce(excluded.dismissal_date, employees.dismissal_date),
    location = coalesce(excluded.location, employees.location),
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_employees(jsonb) from public, anon;
grant execute on function public.import_employees(jsonb) to authenticated, service_role;
