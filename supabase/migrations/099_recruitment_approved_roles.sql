-- Cargos previamente aprovados para abertura de vagas, vinculados ao cliente
-- da árvore de alocações, mas independentes das posições por turno/área.
create table if not exists public.recruitment_approved_roles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.employee_allocation_nodes(id) on delete restrict,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint recruitment_approved_roles_name_not_blank check (btrim(name) <> ''),
  constraint recruitment_approved_roles_name_length check (char_length(name) <= 120)
);

create unique index if not exists recruitment_approved_roles_client_name_unique
  on public.recruitment_approved_roles (client_id, lower(btrim(name)));
create index if not exists idx_recruitment_approved_roles_client_active
  on public.recruitment_approved_roles (client_id, active, lower(name));

drop trigger if exists recruitment_approved_roles_set_updated_at
  on public.recruitment_approved_roles;
create trigger recruitment_approved_roles_set_updated_at
  before update on public.recruitment_approved_roles
  for each row execute function public.set_updated_at();

create or replace function public.validate_recruitment_approved_role_client()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client public.employee_allocation_nodes%rowtype;
begin
  select * into v_client
    from public.employee_allocation_nodes
   where id = new.client_id;
  if not found or v_client.node_type <> 'CLIENT' then
    raise exception 'Selecione um cliente cadastrado na árvore de alocações.';
  end if;
  if not v_client.active then
    raise exception 'Não é possível cadastrar cargos para um cliente inativo.';
  end if;
  return new;
end;
$$;

drop trigger if exists recruitment_approved_roles_validate_client
  on public.recruitment_approved_roles;
create trigger recruitment_approved_roles_validate_client
  before insert or update of client_id on public.recruitment_approved_roles
  for each row execute function public.validate_recruitment_approved_role_client();

alter table public.recruitment_approved_roles enable row level security;

drop policy if exists "recruitment_approved_roles_select" on public.recruitment_approved_roles;
create policy "recruitment_approved_roles_select" on public.recruitment_approved_roles
  for select to authenticated using (public.can_manage_recruitment());
drop policy if exists "recruitment_approved_roles_insert" on public.recruitment_approved_roles;
create policy "recruitment_approved_roles_insert" on public.recruitment_approved_roles
  for insert to authenticated with check (public.can_manage_recruitment());
drop policy if exists "recruitment_approved_roles_update" on public.recruitment_approved_roles;
create policy "recruitment_approved_roles_update" on public.recruitment_approved_roles
  for update to authenticated using (public.can_manage_recruitment())
  with check (public.can_manage_recruitment());
drop policy if exists "recruitment_approved_roles_delete" on public.recruitment_approved_roles;
create policy "recruitment_approved_roles_delete" on public.recruitment_approved_roles
  for delete to authenticated using (public.can_manage_recruitment());

grant select, insert, update, delete on public.recruitment_approved_roles to authenticated;
revoke all on public.recruitment_approved_roles from anon;

alter table public.recruitment_vacancies
  add column if not exists approved_role_id uuid
    references public.recruitment_approved_roles(id) on delete restrict;

create index if not exists idx_recruitment_vacancies_approved_role
  on public.recruitment_vacancies (approved_role_id);
