-- Clientes são as raízes da árvore; a empresa do funcionário não limita a
-- posição em que ele pode ser alocado.
begin;

-- Desvincula os clientes existentes das antigas raízes de empresa sem alterar
-- os vínculos dos funcionários com suas posições.
alter table public.employee_allocation_nodes
  disable trigger employee_allocation_nodes_validate;

update public.employee_allocation_nodes client
   set parent_id = null
 where client.node_type = 'CLIENT'
   and client.parent_id in (
     select id
       from public.employee_allocation_nodes
      where node_type = 'COMPANY'
   );

delete from public.employee_allocation_nodes
 where node_type = 'COMPANY';

alter table public.employee_allocation_nodes
  enable trigger employee_allocation_nodes_validate;

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
    raise exception 'Empresa não é um nível da árvore de alocações.';
  end if;

  if new.node_type = 'CLIENT' then
    if new.parent_id is not null then
      raise exception 'O cliente deve ser criado na raiz da árvore.';
    end if;
    return new;
  end if;

  if new.parent_id is null then
    raise exception 'Somente clientes podem ser criados na raiz da árvore.';
  end if;

  select * into v_parent
    from public.employee_allocation_nodes
   where id = new.parent_id;

  if not found then
    raise exception 'O item superior não existe.';
  end if;
  if v_parent.company_code <> new.company_code then
    raise exception 'O item superior pertence a outra estrutura.';
  end if;
  if not v_parent.active then
    raise exception 'Não é possível adicionar um item abaixo de uma estrutura inativa.';
  end if;

  if not (
    (v_parent.node_type = 'CLIENT' and new.node_type = 'LOCATION')
    or (v_parent.node_type = 'LOCATION' and new.node_type = 'SHIFT')
    or (v_parent.node_type = 'SHIFT' and new.node_type = 'AREA')
    or (v_parent.node_type = 'AREA' and new.node_type = 'POSITION')
  ) then
    raise exception 'O nível informado não pode ser criado abaixo deste item.';
  end if;

  new.company_name := v_parent.company_name;
  return new;
end;
$$;

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

  -- Bloqueia a cadeia até o cliente raiz; mudanças concorrentes de status
  -- aguardam a conclusão da alocação.
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

commit;
