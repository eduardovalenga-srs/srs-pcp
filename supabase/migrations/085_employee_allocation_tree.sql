-- Árvore de alocação de funcionários por empresa, cliente e posição.
begin;

create table if not exists public.employee_allocation_nodes (
  id uuid primary key default gen_random_uuid(),
  company_code text not null,
  company_name text not null,
  parent_id uuid references public.employee_allocation_nodes(id) on delete restrict,
  node_type text not null check (
    node_type in ('COMPANY', 'CLIENT', 'LOCATION', 'AREA', 'SHIFT', 'POSITION')
  ),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint employee_allocation_nodes_name_not_blank check (btrim(name) <> ''),
  constraint employee_allocation_nodes_name_length check (char_length(name) <= 120)
);

create unique index if not exists employee_allocation_nodes_unique_sibling
  on public.employee_allocation_nodes (
    company_code,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    node_type,
    lower(btrim(name))
  );

create index if not exists idx_employee_allocation_nodes_parent
  on public.employee_allocation_nodes (parent_id, sort_order, name);

drop trigger if exists employee_allocation_nodes_set_updated_at
  on public.employee_allocation_nodes;
create trigger employee_allocation_nodes_set_updated_at
  before update on public.employee_allocation_nodes
  for each row execute function public.set_updated_at();

-- As empresas empregadoras já cadastradas no RH são as raízes da árvore.
insert into public.employee_allocation_nodes (
  company_code, company_name, node_type, name, sort_order
)
values
  ('752', 'SRS DESENVOLVIMENTO LTDA', 'COMPANY', 'SRS DESENVOLVIMENTO LTDA', 1),
  ('750', 'SRS PROJETOS E DESENVOLVIMENTOS LTDA', 'COMPANY', 'SRS PROJETOS E DESENVOLVIMENTOS LTDA', 2)
on conflict do nothing;

alter table public.employees
  add column if not exists allocation_position_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_allocation_position_fkey'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_allocation_position_fkey
      foreign key (allocation_position_id)
      references public.employee_allocation_nodes(id)
      on delete restrict;
  end if;
end;
$$;

-- Um funcionário por posição. Um funcionário só tem uma coluna de alocação.
create unique index if not exists employees_allocation_position_unique
  on public.employees (allocation_position_id)
  where allocation_position_id is not null;

create index if not exists idx_employees_allocation_position
  on public.employees (allocation_position_id);

-- Protege também alterações feitas por outros fluxos administrativos:
-- somente uma posição ativa da própria empresa pode ser vinculada.
create or replace function public.validate_employee_allocation_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_node public.employee_allocation_nodes%rowtype;
  v_path_active boolean;
begin
  if new.allocation_position_id is null then
    return new;
  end if;

  select * into v_node
    from public.employee_allocation_nodes
   where id = new.allocation_position_id;
  if not found or v_node.node_type <> 'POSITION' then
    raise exception 'O vínculo deve apontar para uma posição.';
  end if;
  if v_node.company_code <> new.company_code then
    raise exception 'A posição pertence a outra empresa empregadora.';
  end if;

  with recursive ancestors(id, parent_id, active) as (
    select id, parent_id, active
      from public.employee_allocation_nodes
     where id = new.allocation_position_id
    union all
    select parent.id, parent.parent_id, parent.active
      from public.employee_allocation_nodes parent
      join ancestors child on parent.id = child.parent_id
  )
  select bool_and(active) into v_path_active from ancestors;

  if not coalesce(v_path_active, false) then
    raise exception 'A posição ou um item superior está inativo.';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_validate_allocation_assignment on public.employees;
create trigger employees_validate_allocation_assignment
  before insert or update of allocation_position_id, company_code on public.employees
  for each row execute function public.validate_employee_allocation_assignment();

-- A demissão libera a posição atual, sem apagar a estrutura da árvore.
create or replace function public.release_employee_allocation_on_dismissal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.dismissal_date is null and new.dismissal_date is not null
     and new.allocation_position_id is not null then
    update public.employees
       set allocation_position_id = null,
           client = null,
           location = null,
           area = null,
           shift = null
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_release_allocation_on_dismissal on public.employees;
create trigger employees_release_allocation_on_dismissal
  after update of dismissal_date on public.employees
  for each row execute function public.release_employee_allocation_on_dismissal();

-- Verifica a estrutura da árvore e impede alteração de empresa/tipo/pai
-- após a criação. Reorganizar nomes e ordem não altera vínculos.
create or replace function public.validate_employee_allocation_node()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_parent public.employee_allocation_nodes%rowtype;
begin
  new.name := btrim(new.name);
  if new.name = '' or char_length(new.name) > 120 then
    raise exception 'Informe um nome de até 120 caracteres.';
  end if;

  if tg_op = 'UPDATE' and (
    old.parent_id is distinct from new.parent_id
    or old.node_type is distinct from new.node_type
    or old.company_code is distinct from new.company_code
    or old.company_name is distinct from new.company_name
  ) then
    raise exception 'A estrutura e a empresa de um item existente não podem ser alteradas.';
  end if;

  if new.node_type = 'COMPANY' then
    if new.parent_id is not null or new.company_code not in ('750', '752') then
      raise exception 'Empresa empregadora inválida.';
    end if;
    if not new.active then
      raise exception 'A empresa empregadora não pode ser inativada por esta tela.';
    end if;
    if tg_op = 'UPDATE' and new.name is distinct from old.name then
      raise exception 'O nome da empresa empregadora é mantido no cadastro de empresas.';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception 'Este nível precisa pertencer a um item superior da árvore.';
  end if;

  select * into v_parent
    from public.employee_allocation_nodes
   where id = new.parent_id;

  if not found then
    raise exception 'O item superior não existe.';
  end if;
  if v_parent.company_code <> new.company_code then
    raise exception 'O item superior pertence a outra empresa.';
  end if;
  if not v_parent.active then
    raise exception 'Não é possível adicionar um item abaixo de uma estrutura inativa.';
  end if;

  if not (
    (v_parent.node_type = 'COMPANY' and new.node_type = 'CLIENT')
    or (v_parent.node_type = 'CLIENT' and new.node_type = 'LOCATION')
    or (v_parent.node_type = 'LOCATION' and new.node_type = 'AREA')
    or (v_parent.node_type = 'AREA' and new.node_type = 'SHIFT')
    or (v_parent.node_type = 'SHIFT' and new.node_type = 'POSITION')
  ) then
    raise exception 'O nível informado não pode ser criado abaixo deste item.';
  end if;

  new.company_name := v_parent.company_name;
  return new;
end;
$$;

drop trigger if exists employee_allocation_nodes_validate
  on public.employee_allocation_nodes;
create trigger employee_allocation_nodes_validate
  before insert or update on public.employee_allocation_nodes
  for each row execute function public.validate_employee_allocation_node();

-- Uma posição ocupada não pode ser inativada, nem diretamente nem por
-- inativação de um ancestral.
create or replace function public.guard_employee_allocation_deactivation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.active and not new.active and exists (
    with recursive descendants as (
      select id
        from public.employee_allocation_nodes
       where id = old.id
      union all
      select child.id
        from public.employee_allocation_nodes child
        join descendants parent on child.parent_id = parent.id
    )
    select 1
      from public.employees e
      join descendants d on d.id = e.allocation_position_id
     where e.dismissal_date is null
  ) then
    raise exception 'Transfira os funcionários alocados antes de inativar esta estrutura.';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_allocation_nodes_guard_deactivation
  on public.employee_allocation_nodes;
create trigger employee_allocation_nodes_guard_deactivation
  before update of active on public.employee_allocation_nodes
  for each row execute function public.guard_employee_allocation_deactivation();

-- Mantém os campos textuais legados sincronizados quando se altera o nome
-- de qualquer nível da árvore que já tenha funcionários alocados.
create or replace function public.sync_employee_allocation_labels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.name is not distinct from new.name then
    return new;
  end if;

  with recursive descendants(id) as (
    select new.id
    union all
    select child.id
      from public.employee_allocation_nodes child
      join descendants parent on child.parent_id = parent.id
  ),
  positions as (
    select n.id
      from public.employee_allocation_nodes n
      join descendants d on d.id = n.id
     where n.node_type = 'POSITION'
  ),
  paths as (
    select p.id as position_id, n.id, n.parent_id, n.node_type, n.name
      from positions p
      join public.employee_allocation_nodes n on n.id = p.id
    union all
    select paths.position_id, parent.id, parent.parent_id, parent.node_type, parent.name
      from paths
      join public.employee_allocation_nodes parent on parent.id = paths.parent_id
  ),
  labels as (
    select
      position_id,
      max(name) filter (where node_type = 'CLIENT') as client,
      max(name) filter (where node_type = 'LOCATION') as location,
      max(name) filter (where node_type = 'AREA') as area,
      max(name) filter (where node_type = 'SHIFT') as shift
    from paths
    group by position_id
  )
  update public.employees e
     set client = labels.client,
         location = labels.location,
         area = labels.area,
         shift = labels.shift
    from labels
   where e.allocation_position_id = labels.position_id;

  return new;
end;
$$;

drop trigger if exists employee_allocation_nodes_sync_labels
  on public.employee_allocation_nodes;
create trigger employee_allocation_nodes_sync_labels
  after update of name on public.employee_allocation_nodes
  for each row execute function public.sync_employee_allocation_labels();

-- Vínculo atômico: troca libera a posição anterior e ocupa a nova na mesma
-- transação. O lock no nó impede duas alocações concorrentes para a mesma vaga.
create or replace function public.assign_employee_allocation(
  p_employee_id uuid,
  p_position_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
  v_position public.employee_allocation_nodes%rowtype;
  v_lock record;
  v_path_active boolean;
  v_client text;
  v_location text;
  v_area text;
  v_shift text;
begin
  if not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Você não tem permissão para alterar alocações.';
  end if;

  select * into v_employee
    from public.employees
   where id = p_employee_id
   for update;
  if not found then
    raise exception 'Funcionário não encontrado.';
  end if;
  if v_employee.dismissal_date is not null then
    raise exception 'Não é possível alocar um funcionário inativo.';
  end if;

  if p_position_id is null then
    update public.employees
       set allocation_position_id = null,
           client = null,
           location = null,
           area = null,
           shift = null
     where id = p_employee_id;
    return;
  end if;

  select * into v_position
    from public.employee_allocation_nodes
   where id = p_position_id;
  if not found or v_position.node_type <> 'POSITION' then
    raise exception 'Selecione uma posição válida.';
  end if;
  if v_position.company_code <> v_employee.company_code then
    raise exception 'A posição pertence a outra empresa empregadora.';
  end if;

  -- Trava a cadeia desde a raiz. Alocações distintas podem prosseguir
  -- simultaneamente; alterações de status em qualquer ancestral aguardam.
  for v_lock in
    with recursive path(id, parent_id, depth) as (
      select id, parent_id, 0
        from public.employee_allocation_nodes
       where id = p_position_id
      union all
      select parent.id, parent.parent_id, path.depth + 1
        from public.employee_allocation_nodes parent
        join path on parent.id = path.parent_id
    )
    select id from path order by depth desc
  loop
    if v_lock.id = p_position_id then
      perform 1 from public.employee_allocation_nodes where id = v_lock.id for update;
    else
      perform 1 from public.employee_allocation_nodes where id = v_lock.id for share;
    end if;
  end loop;

  select * into v_position
    from public.employee_allocation_nodes
   where id = p_position_id;

  with recursive ancestors(id, parent_id, active, node_type, name) as (
    select id, parent_id, active, node_type, name
      from public.employee_allocation_nodes
     where id = p_position_id
    union all
    select parent.id, parent.parent_id, parent.active, parent.node_type, parent.name
      from public.employee_allocation_nodes parent
      join ancestors child on parent.id = child.parent_id
  )
  select
    bool_and(active),
    max(name) filter (where node_type = 'CLIENT'),
    max(name) filter (where node_type = 'LOCATION'),
    max(name) filter (where node_type = 'AREA'),
    max(name) filter (where node_type = 'SHIFT')
  into v_path_active, v_client, v_location, v_area, v_shift
  from ancestors;

  if not coalesce(v_path_active, false) then
    raise exception 'A posição ou um item superior está inativo.';
  end if;

  if exists (
    select 1 from public.employees
     where allocation_position_id = p_position_id
       and id <> p_employee_id
  ) then
    raise exception 'Esta posição já está ocupada. Atualize a árvore e escolha outra vaga.';
  end if;

  update public.employees
     set allocation_position_id = p_position_id,
         client = v_client,
         location = v_location,
         area = v_area,
         shift = v_shift
   where id = p_employee_id;
end;
$$;

alter table public.employee_allocation_nodes enable row level security;

drop policy if exists "employee_allocation_nodes_select" on public.employee_allocation_nodes;
create policy "employee_allocation_nodes_select" on public.employee_allocation_nodes
  for select to authenticated using (true);

drop policy if exists "employee_allocation_nodes_insert" on public.employee_allocation_nodes;
create policy "employee_allocation_nodes_insert" on public.employee_allocation_nodes
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "employee_allocation_nodes_update" on public.employee_allocation_nodes;
create policy "employee_allocation_nodes_update" on public.employee_allocation_nodes
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

grant select, insert, update on public.employee_allocation_nodes to authenticated;
revoke delete on public.employee_allocation_nodes from authenticated, anon;
revoke all on public.employee_allocation_nodes from anon;

revoke all on function public.assign_employee_allocation(uuid, uuid) from public, anon;
grant execute on function public.assign_employee_allocation(uuid, uuid) to authenticated;

commit;
