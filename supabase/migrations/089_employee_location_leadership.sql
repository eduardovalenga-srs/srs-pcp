-- Líderes são definidos no nível do local de trabalho e herdados pelos
-- funcionários atualmente alocados em posições daquele local.
begin;

alter table public.employee_allocation_nodes
  add column if not exists location_leader text,
  add column if not exists location_supervisor text;

alter table public.employee_allocation_nodes
  add constraint employee_allocation_location_leader_valid
    check (
      location_leader is null
      or (btrim(location_leader) <> '' and char_length(location_leader) <= 150)
    ),
  add constraint employee_allocation_location_supervisor_valid
    check (
      location_supervisor is null
      or (btrim(location_supervisor) <> '' and char_length(location_supervisor) <= 150)
    ),
  add constraint employee_allocation_leadership_location_only
    check (
      node_type = 'LOCATION'
      or (location_leader is null and location_supervisor is null)
    );

create or replace function public.sync_employee_location_leadership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.location_leader is not distinct from new.location_leader
     and old.location_supervisor is not distinct from new.location_supervisor then
    return new;
  end if;

  with recursive descendants(id) as (
    select new.id
    union all
    select child.id
      from public.employee_allocation_nodes child
      join descendants parent on child.parent_id = parent.id
  ),
  positions(id) as (
    select node.id
      from public.employee_allocation_nodes node
      join descendants descendant on descendant.id = node.id
     where node.node_type = 'POSITION'
  )
  update public.employees employee
     set responsible_1 = new.location_leader,
         responsible_2 = new.location_supervisor
    from positions
   where employee.allocation_position_id = positions.id;

  return new;
end;
$$;

drop trigger if exists employee_allocation_nodes_sync_leadership
  on public.employee_allocation_nodes;
create trigger employee_allocation_nodes_sync_leadership
  after update of location_leader, location_supervisor
  on public.employee_allocation_nodes
  for each row
  when (
    old.location_leader is distinct from new.location_leader
    or old.location_supervisor is distinct from new.location_supervisor
  )
  execute function public.sync_employee_location_leadership();

create or replace function public.sync_employee_location_leadership_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_leader text;
  v_supervisor text;
begin
  if new.allocation_position_id is null then
    update public.employees
       set responsible_1 = null,
           responsible_2 = null
     where id = new.id
       and (responsible_1 is not null or responsible_2 is not null);
    return new;
  end if;

  with recursive ancestors(id, parent_id, node_type, location_leader, location_supervisor) as (
    select id, parent_id, node_type, location_leader, location_supervisor
      from public.employee_allocation_nodes
     where id = new.allocation_position_id
    union all
    select parent.id, parent.parent_id, parent.node_type,
           parent.location_leader, parent.location_supervisor
      from public.employee_allocation_nodes parent
      join ancestors child on parent.id = child.parent_id
  )
  select
    max(location_leader) filter (where node_type = 'LOCATION'),
    max(location_supervisor) filter (where node_type = 'LOCATION')
  into v_leader, v_supervisor
  from ancestors;

  update public.employees
     set responsible_1 = v_leader,
         responsible_2 = v_supervisor
   where id = new.id
     and (
       responsible_1 is distinct from v_leader
       or responsible_2 is distinct from v_supervisor
     );

  return new;
end;
$$;

drop trigger if exists employees_sync_location_leadership
  on public.employees;
create trigger employees_sync_location_leadership
  after insert or update of allocation_position_id
  on public.employees
  for each row execute function public.sync_employee_location_leadership_on_assignment();

revoke all on function public.sync_employee_location_leadership() from public, anon;
revoke all on function public.sync_employee_location_leadership_on_assignment() from public, anon;

commit;
