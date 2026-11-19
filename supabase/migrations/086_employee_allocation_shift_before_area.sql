-- A ordem da árvore passa a ser:
-- Empresa → Cliente → Local → Turno → Área → Posição.
begin;

-- Migra a estrutura anterior (Local → Área → Turno → Posição), se houver
-- dados criados antes desta alteração. Turnos com o mesmo nome dentro de um
-- local passam a ser um único nó, e suas posições continuam sob a área.
drop trigger if exists employee_allocation_nodes_validate
  on public.employee_allocation_nodes;

create temporary table allocation_shift_upgrade_map
on commit drop
as
with old_shifts as (
  select
    shift_node.id as old_shift_id,
    area_node.id as area_id,
    location_node.id as location_id,
    shift_node.name as shift_name,
    first_value(shift_node.id) over (
      partition by location_node.id, lower(btrim(shift_node.name))
      order by shift_node.created_at, shift_node.id
    ) as canonical_shift_id
  from public.employee_allocation_nodes shift_node
  join public.employee_allocation_nodes area_node
    on area_node.id = shift_node.parent_id
   and area_node.node_type = 'AREA'
  join public.employee_allocation_nodes location_node
    on location_node.id = area_node.parent_id
   and location_node.node_type = 'LOCATION'
  where shift_node.node_type = 'SHIFT'
)
select
  old_shift_id,
  area_id,
  location_id,
  shift_name,
  canonical_shift_id
from old_shifts;

-- Posições permanecem individualizadas, mas passam a ser filhas da área.
update public.employee_allocation_nodes position_node
   set parent_id = mapping.area_id
  from allocation_shift_upgrade_map mapping
 where position_node.parent_id = mapping.old_shift_id
   and position_node.node_type = 'POSITION';

-- Reúne áreas sob o turno canônico correspondente.
update public.employee_allocation_nodes area_node
   set parent_id = mapping.canonical_shift_id
  from allocation_shift_upgrade_map mapping
 where area_node.id = mapping.area_id;

-- O turno canônico passa a ser filho direto do local.
update public.employee_allocation_nodes shift_node
   set parent_id = mapping.location_id
  from allocation_shift_upgrade_map mapping
 where shift_node.id = mapping.canonical_shift_id;

-- Remove somente os turnos duplicados que ficaram sem posições/filhos.
delete from public.employee_allocation_nodes duplicate_shift
 using allocation_shift_upgrade_map mapping
 where duplicate_shift.id = mapping.old_shift_id
   and duplicate_shift.id <> mapping.canonical_shift_id;

-- Áreas parciais que ainda não tinham turno ganham um agrupador explícito,
-- sem apagar ou renomear os dados cadastrados.
insert into public.employee_allocation_nodes (
  company_code, company_name, parent_id, node_type, name, sort_order, active
)
select distinct
  location_node.company_code,
  location_node.company_name,
  location_node.id,
  'SHIFT',
  'Turno não definido',
  0,
  location_node.active
from public.employee_allocation_nodes area_node
join public.employee_allocation_nodes location_node
  on location_node.id = area_node.parent_id
where area_node.node_type = 'AREA'
  and location_node.node_type = 'LOCATION'
  and not exists (
    select 1
      from public.employee_allocation_nodes shift_node
     where shift_node.parent_id = area_node.id
       and shift_node.node_type = 'SHIFT'
  )
on conflict do nothing;

update public.employee_allocation_nodes area_node
   set parent_id = shift_node.id
  from public.employee_allocation_nodes location_node,
       public.employee_allocation_nodes shift_node
 where area_node.parent_id = location_node.id
   and area_node.node_type = 'AREA'
   and location_node.node_type = 'LOCATION'
   and shift_node.parent_id = location_node.id
   and shift_node.node_type = 'SHIFT'
   and lower(btrim(shift_node.name)) = 'turno não definido'
   and not exists (
     select 1
       from public.employee_allocation_nodes child_shift
      where child_shift.parent_id = area_node.id
        and child_shift.node_type = 'SHIFT'
   );

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

create trigger employee_allocation_nodes_validate
  before insert or update on public.employee_allocation_nodes
  for each row execute function public.validate_employee_allocation_node();

commit;
