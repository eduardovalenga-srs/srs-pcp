-- Resumo do card KIT da Fábrica 1: agrega o conjunto filtrado inteiro, sem
-- montar página, ids de membros ou embeds. A expedição é consultada só para
-- os pais dos filhos candidatos, não para todos os itens raiz do banco.
create or replace function public.sub_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_date date := p_date - (greatest(coalesce(p_days, 0), 0) / 5) * 7;
  v_days integer := mod(greatest(coalesce(p_days, 0), 0), 5);
begin
  while v_days > 0 loop
    v_date := v_date - 1;
    if extract(isodow from v_date) < 6 then
      v_days := v_days - 1;
    end if;
  end loop;
  return v_date;
end;
$$;

create or replace function public.get_child_items_kit_overdue_totals(
  p_search text default null,
  p_order_code text default null,
  p_customer text default null,
  p_child_item text default null,
  p_description text default null,
  p_material text default null,
  p_parent_ids uuid[] default null,
  p_delivery_from date default null,
  p_delivery_to date default null,
  p_process_id uuid default null,
  p_process_status text default null,
  p_seq integer default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_weight_unit_min numeric default null,
  p_weight_unit_max numeric default null,
  p_today date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  candidates as materialized (
    select oi.id,
           oi.order_id,
           oi.parent_order_item_id,
           oi.parent_item,
           oi.description,
           oi.delivery_date,
           oi.seq,
           oi.quantity as planned_quantity,
           oi.unit_weight_kg as unit_weight,
           oi.total_weight_kg as planned_weight,
           o.delivery_date as order_delivery_date
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.parent_order_item_id is not null
       and (p_search is null
            or oi.description ilike '%' || p_search || '%'
            or coalesce(oi.parent_item, '') ilike '%' || p_search || '%')
       and (p_order_code is null or o.code ilike '%' || p_order_code || '%')
       and (p_customer is null or coalesce(o.customer_name, '') ilike '%' || p_customer || '%')
       and (p_child_item is null or coalesce(oi.parent_item, '') ilike '%' || p_child_item || '%')
       and (p_description is null or oi.description ilike '%' || p_description || '%')
       and (p_material is null or exists (
             select 1
               from public.order_item_materials m
              where m.order_item_id = oi.id
                and m.description ilike '%' || p_material || '%'))
       and (p_parent_ids is null or oi.parent_order_item_id = any (p_parent_ids))
       and (p_delivery_from is null or oi.delivery_date >= p_delivery_from)
       and (p_delivery_to is null or oi.delivery_date <= p_delivery_to)
       and (p_process_id is null or exists (
             select 1
               from public.production_processes pp
              where pp.order_item_id = oi.id
                and pp.process_id = p_process_id
                and (p_process_status is null or pp.status = p_process_status)))
       and (p_process_id is not null or p_process_status is null or exists (
             select 1
               from public.production_processes pp
              where pp.order_item_id = oi.id
                and pp.status = p_process_status))
  ),
  candidate_parents as materialized (
    select distinct parent_order_item_id as parent_id
      from candidates
  ),
  parent_balance as materialized (
    select parent.id as item_id,
           parent.quantity as planned,
           greatest(coalesce(parent.quantity, 0) - coalesce(shipped.quantity, 0), 0) as pending
      from candidate_parents cp
      join public.order_items parent
        on parent.id = cp.parent_id
       and parent.parent_order_item_id is null
      left join lateral (
        select coalesce(sum(ri.quantity), 0)::numeric as quantity
          from public.romaneio_items ri
          join public.romaneios r
            on r.id = ri.romaneio_id
           and r.status = 'CONFIRMADO'
         where ri.order_item_id = parent.id
      ) shipped on true
  ),
  filtered as materialized (
    select c.id,
           c.order_id,
           c.parent_item,
           c.description,
           c.delivery_date,
           c.seq,
           case when pb.planned > 0
                then c.planned_quantity * pb.pending / pb.planned
                else c.planned_quantity end as quantity,
           c.unit_weight,
           case when pb.planned > 0
                then c.planned_weight * pb.pending / pb.planned
                else c.planned_weight end as total_weight,
           coalesce(c.delivery_date, c.order_delivery_date) as effective_delivery_date
      from candidates c
      left join parent_balance pb on pb.item_id = c.parent_order_item_id
  ),
  grouped_metrics as materialized (
    select f.order_id,
           coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as group_key,
           min(f.effective_delivery_date) as delivery_date,
           min(f.seq) as seq_min,
           coalesce(sum(coalesce(f.quantity, 0)), 0) as quantity,
           coalesce(sum(coalesce(f.total_weight, 0)), 0) as total_weight,
           min(f.unit_weight) as unit_weight_min,
           max(f.unit_weight) as unit_weight_max
      from filtered f
      group by f.order_id,
               coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description))
  ),
  kit_catalog as materialized (
    select id, code, display_order
      from public.processes
     where code = 'KIT'
       and active
  ),
  kit_total_duration as materialized (
    select kit.id as kit_process_id,
           sum(case when scheduled.duration_days is null or scheduled.duration_days < 1
                    then 1 else floor(scheduled.duration_days)::integer end)::integer as business_days
      from kit_catalog kit
      join public.processes scheduled
        on scheduled.active
       and (scheduled.display_order > kit.display_order
            or (scheduled.display_order = kit.display_order and scheduled.code >= kit.code))
     group by kit.id
  ),
  group_process_status as materialized (
    select f.order_id,
            coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as group_key,
            pr.code,
            pr.duration_days,
            case
             when count(*) filter (where pp.status <> 'NAO_APLICAVEL') = 0
               then 'NAO_APLICAVEL'
             when count(*) filter (where pp.status = 'CONCLUIDO') =
                  count(*) filter (where pp.status <> 'NAO_APLICAVEL')
               then 'CONCLUIDO'
             else 'NAO_INICIADO'
           end as status
      from filtered f
      join public.production_processes pp on pp.order_item_id = f.id
      join public.processes pr on pr.id = pp.process_id and pr.active
      join kit_catalog kit
        on (pr.display_order > kit.display_order
            or (pr.display_order = kit.display_order and pr.code >= kit.code))
      group by f.order_id,
               coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)),
               pr.code,
               pr.duration_days
   ),
  grouped_with_status as materialized (
    select rows.order_id,
           rows.group_key,
           min(rows.delivery_date) filter (where rows.is_metrics) as delivery_date,
           min(rows.seq_min) filter (where rows.is_metrics) as seq_min,
           coalesce(sum(rows.quantity), 0) as quantity,
           coalesce(sum(rows.total_weight), 0) as total_weight,
           min(rows.unit_weight_min) filter (where rows.is_metrics) as unit_weight_min,
           max(rows.unit_weight_max) filter (where rows.is_metrics) as unit_weight_max,
           max(rows.process_status) filter (where rows.process_code = 'KIT') as kit_status,
           coalesce(sum(case when rows.process_status = 'NAO_APLICAVEL'
                             then rows.process_duration
                             else 0 end), 0)::integer as skipped_days
      from (
        select g.order_id, g.group_key, g.delivery_date, g.seq_min,
               g.quantity, g.total_weight, g.unit_weight_min, g.unit_weight_max,
               null::text as process_code, null::text as process_status,
               null::integer as process_duration, true as is_metrics
          from grouped_metrics g
        union all
        select s.order_id, s.group_key, null::date, null::integer,
               0::numeric, 0::numeric, null::numeric, null::numeric,
               s.code, s.status,
               case when s.duration_days is null or s.duration_days < 1
                    then 1 else floor(s.duration_days)::integer end,
               false
          from group_process_status s
      ) rows
     group by rows.order_id, rows.group_key
  ),
  grouped as materialized (
    select g.*
      from grouped_with_status g
     where (p_seq is null or g.seq_min = p_seq)
       and (p_qty_min is null or g.quantity >= p_qty_min)
       and (p_qty_max is null or g.quantity <= p_qty_max)
       and (p_weight_min is null or g.total_weight >= p_weight_min)
       and (p_weight_max is null or g.total_weight <= p_weight_max)
       and (p_weight_unit_min is null
            or (g.unit_weight_min is not null
                and g.unit_weight_min = g.unit_weight_max
                and g.unit_weight_min >= p_weight_unit_min))
       and (p_weight_unit_max is null
            or (g.unit_weight_min is not null
                and g.unit_weight_min = g.unit_weight_max
                and g.unit_weight_max <= p_weight_unit_max))
  ),
  group_kit_schedule as materialized (
    select g.order_id,
           g.group_key,
           g.quantity,
           g.total_weight,
           g.delivery_date,
           kit_catalog.id as kit_process_id,
           g.kit_status,
           greatest(coalesce(total_duration.business_days, 0) - g.skipped_days, 0) as business_days
      from grouped g
      cross join kit_catalog
      left join kit_total_duration total_duration
        on total_duration.kit_process_id = kit_catalog.id
  ),
  overdue as (
    select g.*
      from group_kit_schedule g
     where g.delivery_date is not null
       and g.kit_process_id is not null
       and g.kit_status is not null
       and g.kit_status not in ('CONCLUIDO', 'NAO_APLICAVEL')
       and public.sub_business_days(g.delivery_date, g.business_days) < coalesce(p_today, current_date)
  )
  select jsonb_build_object(
    'records', count(*),
    'qty', coalesce(sum(quantity), 0),
    'weight', coalesce(sum(total_weight), 0)
  )
    from overdue;
$$;

revoke execute on function public.get_child_items_kit_overdue_totals(
  text, text, text, text, text, text, uuid[], date, date, uuid, text,
  integer, numeric, numeric, numeric, numeric, numeric, numeric, date
) from public, anon;
grant execute on function public.get_child_items_kit_overdue_totals(
  text, text, text, text, text, text, uuid[], date, date, uuid, text,
  integer, numeric, numeric, numeric, numeric, numeric, numeric, date
) to authenticated;
