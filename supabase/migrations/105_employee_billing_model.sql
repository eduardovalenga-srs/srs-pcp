-- Modelo de cobrança individual do funcionário.
-- Cadastros existentes e importações sem valor recebem HORA por padrão.
begin;

alter table public.employees
  add column if not exists billing_model text not null default 'HORA';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.employees'::regclass
       and conname = 'employees_billing_model_valid'
  ) then
    alter table public.employees
      add constraint employees_billing_model_valid
      check (billing_model in ('HORA', 'KG'));
  end if;
end;
$$;

commit;
