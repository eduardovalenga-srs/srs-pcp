-- Fábrica 1: agrega os cartões e aplica os recortes de atraso antes da
-- paginação. Evita carregar todas as páginas e seus embeds só para calcular
-- o cartão "Atrasados" ou filtrar grupos vencidos.

create or replace function public.sub_business_days(p_date date, p_days integer)
returns date
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  v_date date := p_date;
  v_days integer := greatest(coalesce(p_days, 0), 0);
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

revoke execute on function public.sub_business_days(date, integer) from public, anon;
grant execute on function public.sub_business_days(date, integer) to authenticated;

create or replace function public.get_child_item_groups_page(
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
  p_offset integer default 0,
  p_limit integer default 50,
  p_seq integer default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_weight_unit_min numeric default null,
  p_weight_unit_max numeric default null,
  p_sort text default 'seq',
  p_sort_dir text default 'asc',
  p_kit_overdue boolean default false,
  p_process_overdue boolean default false,
  p_process_code text default 'ALL',
  p_today date default current_date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sort_expr text;
  v_sort_dir text;
  v_order text;
  v_sql text;
  v_result jsonb;
begin
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sort_expr := case p_sort
    when 'seq'            then 'g.seq_min asc nulls last, g.delivery_key'
    when 'order_code'     then 'g.ord_code'
    when 'customer'       then 'g.cust'
    when 'child_item'     then 'g.gkey'
    when 'materials'      then 'g.mat_desc'
    when 'quantity'       then 'g.qty'
    when 'unit_weight_kg' then 'g.uw_min'
    when 'weight_total'   then 'g.weight'
    when 'delivery_date'  then 'g.delivery_key'
    else null
  end;

  if v_sort_expr is null then
    if p_sort = 'MP' then
      v_sort_expr := '(select coalesce(gp.worst_rank, 3) from group_parent_mp gp '
        || 'where gp.ord_id = g.order_id and gp.gkey = g.gkey limit 1)';
    elsif exists (select 1 from public.processes pr where pr.code = p_sort) then
      v_sort_expr := '(select coalesce(gr.worst_rank, 3) from group_proc_rank gr '
        || 'where gr.ord_id = g.order_id and gr.gkey = g.gkey '
        || 'and gr.pcode = ' || quote_literal(p_sort) || ' limit 1)';
    end if;
  end if;

  v_order := case
    when v_sort_expr is null then 'g.seq_min nulls last, g.delivery_key nulls last, g.gkey'
    when p_sort = 'seq' then v_sort_expr || ' ' || v_sort_dir || ' nulls last, g.ord_code asc, g.gkey asc'
    else v_sort_expr || ' ' || v_sort_dir || ' nulls last, g.ord_code asc, g.gkey asc'
  end;

  v_sql := $q$
    with
    parent_balance as (
      select oi.id as item_id,
             oi.quantity as planned,
             greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as qty
        from public.order_items oi
        left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
       where oi.parent_order_item_id is null
    ),
    filtered as (
      select oi.id, oi.order_id, oi.parent_item, oi.parent_order_item_id,
             oi.description, oi.delivery_date, oi.seq,
             case when pb.planned > 0 then oi.quantity * pb.qty / pb.planned
                  else oi.quantity end as quantity,
             oi.unit_weight_kg as unit_w,
             case when pb.planned > 0 then oi.total_weight_kg * pb.qty / pb.planned
                  else oi.total_weight_kg end as total_w,
             o.delivery_date as order_delivery_date,
             o.code as ord_code,
             coalesce(o.customer_name, '') as cust,
             coalesce((select min(btrim(m.description))
                         from public.order_item_materials m
                        where m.order_item_id = oi.id), '') as mat_desc
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        left join parent_balance pb on pb.item_id = oi.parent_order_item_id
       where oi.parent_order_item_id is not null
         and ($1::text is null or oi.description ilike '%' || $1::text || '%'
              or coalesce(oi.parent_item, '') ilike '%' || $1::text || '%')
         and ($2::text is null or o.code ilike '%' || $2::text || '%')
         and ($3::text is null or coalesce(o.customer_name, '') ilike '%' || $3::text || '%')
         and ($4::text is null or coalesce(oi.parent_item, '') ilike '%' || $4::text || '%')
         and ($5::text is null or oi.description ilike '%' || $5::text || '%')
         and ($6::text is null or exists (
               select 1 from public.order_item_materials m
                where m.order_item_id = oi.id
                  and m.description ilike '%' || $6::text || '%'))
         and ($7::uuid[] is null or oi.parent_order_item_id = any ($7::uuid[]))
         and ($8::date is null or oi.delivery_date >= $8::date)
         and ($9::date is null or oi.delivery_date <= $9::date)
         and ($10::uuid is null or exists (
               select 1 from public.production_processes pp
                where pp.order_item_id = oi.id and pp.process_id = $10::uuid
                  and ($11::text is null or pp.status = $11::text)))
         and ($10::uuid is not null or $11::text is null or exists (
               select 1 from public.production_processes pp
                where pp.order_item_id = oi.id and pp.status = $11::text))
    ),
    group_process_status as (
      select f.order_id as ord_id,
             coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as gkey,
             pr.code as pcode,
             case
               when count(*) filter (where pp.status <> 'NAO_APLICAVEL') = 0 then 'NAO_APLICAVEL'
               when count(*) filter (where pp.status = 'CONCLUIDO') =
                    count(*) filter (where pp.status <> 'NAO_APLICAVEL') then 'CONCLUIDO'
               else 'NAO_INICIADO'
             end as status
        from filtered f
        join public.production_processes pp on pp.order_item_id = f.id
        join public.processes pr on pr.id = pp.process_id
       group by f.order_id, coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)), pr.code
    ),
    grouped as (
      select order_id,
             coalesce(nullif(btrim(parent_item), ''), btrim(description)) as gkey,
             min(coalesce(delivery_date, order_delivery_date)) as delivery_key,
             min(seq) as seq_min,
             min(ord_code) as ord_code,
             min(cust) as cust,
             min(mat_desc) as mat_desc,
             coalesce(sum(coalesce(quantity, 0)), 0) as qty,
             coalesce(sum(coalesce(total_w, 0)), 0) as weight,
             min(unit_w) as uw_min,
             max(unit_w) as uw_max
        from filtered
       group by order_id, coalesce(nullif(btrim(parent_item), ''), btrim(description))
      having ($14::integer is null or min(seq) = $14::integer)
         and ($15::numeric is null or coalesce(sum(coalesce(quantity, 0)), 0) >= $15::numeric)
         and ($16::numeric is null or coalesce(sum(coalesce(quantity, 0)), 0) <= $16::numeric)
         and ($17::numeric is null or coalesce(sum(coalesce(total_w, 0)), 0) >= $17::numeric)
         and ($18::numeric is null or coalesce(sum(coalesce(total_w, 0)), 0) <= $18::numeric)
         and ($19::numeric is null or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                                         and min(unit_w) >= $19::numeric))
         and ($20::numeric is null or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                                         and max(unit_w) <= $20::numeric))
    ),
    proc_ranks as (
      select f.order_id as ord_id,
             coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as gkey,
             pr.code as pcode,
             case pp.status when 'CONCLUIDO' then 1 when 'NAO_INICIADO' then 2 else 3 end as rank
        from filtered f
        join public.production_processes pp on pp.order_item_id = f.id
        join public.processes pr on pr.id = pp.process_id
    ),
    group_proc_rank as (
      select ord_id, gkey, pcode,
             case when count(*) filter (where rank = 2) > 0 then 2
                  when count(*) filter (where rank = 1) > 0 then 1 else 3 end as worst_rank
        from proc_ranks
       group by ord_id, gkey, pcode
    ),
    parent_mp_rank as (
      select f.order_id as ord_id,
             coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as gkey,
             case pp.status when 'CONCLUIDO' then 1 when 'NAO_INICIADO' then 2 else 3 end as rank
        from filtered f
        join public.production_processes pp on pp.order_item_id = f.parent_order_item_id
        join public.processes pr on pr.id = pp.process_id and pr.code = 'MP'
       where f.parent_order_item_id is not null
    ),
    group_parent_mp as (
      select ord_id, gkey,
             case when count(*) filter (where rank = 2) > 0 then 2
                  when count(*) filter (where rank = 1) > 0 then 1 else 3 end as worst_rank
        from parent_mp_rank
       group by ord_id, gkey
    ),
    due_groups as (
      select g.*,
             case
               when g.delivery_key is null or kit_catalog.id is null or kit.status is null
                 or kit.status in ('CONCLUIDO', 'NAO_APLICAVEL') then false
               else public.sub_business_days(
                      g.delivery_key,
                      coalesce(kit_duration.days, 0)::integer
                    ) < coalesce($26::date, current_date)
             end as kit_is_overdue,
             case when not coalesce($24::boolean, false) or g.delivery_key is null then false else exists (
               select 1
                 from group_process_status target_status
                 join public.processes target on target.code = target_status.pcode and target.active
                where target_status.ord_id = g.order_id and target_status.gkey = g.gkey
                  and target_status.status not in ('CONCLUIDO', 'NAO_APLICAVEL')
                  and (($25::text = 'ALL' and target.code <> 'MP') or target.code = $25::text)
                  and public.sub_business_days(
                         g.delivery_key,
                         coalesce((
                           select sum(case when scheduled.duration_days is null or scheduled.duration_days < 1
                                           then 1 else floor(scheduled.duration_days)::integer end)
                             from public.processes scheduled
                             left join group_process_status scheduled_status
                               on scheduled_status.ord_id = g.order_id
                              and scheduled_status.gkey = g.gkey
                              and scheduled_status.pcode = scheduled.code
                            where scheduled.active
                             and (scheduled.display_order > target.display_order
                                  or (scheduled.display_order = target.display_order and scheduled.code >= target.code))
                             and coalesce(scheduled_status.status, 'NAO_INICIADO') <> 'NAO_APLICAVEL'
                        ), 0)::integer
                      ) < coalesce($26::date, current_date)
             ) end as process_is_overdue
        from grouped g
        left join group_process_status kit
          on kit.ord_id = g.order_id and kit.gkey = g.gkey and kit.pcode = 'KIT'
        left join public.processes kit_catalog on kit_catalog.code = 'KIT' and kit_catalog.active
        left join lateral (
          select sum(case when scheduled.duration_days is null or scheduled.duration_days < 1
                          then 1 else floor(scheduled.duration_days)::integer end) as days
            from public.processes scheduled
            left join group_process_status scheduled_status
              on scheduled_status.ord_id = g.order_id
             and scheduled_status.gkey = g.gkey
             and scheduled_status.pcode = scheduled.code
           where scheduled.active
             and kit_catalog.id is not null
             and kit.status not in ('CONCLUIDO', 'NAO_APLICAVEL')
             and (scheduled.display_order > kit_catalog.display_order
                  or (scheduled.display_order = kit_catalog.display_order and scheduled.code >= kit_catalog.code))
             and coalesce(scheduled_status.status, 'NAO_INICIADO') <> 'NAO_APLICAVEL'
        ) kit_duration on true
    ),
    eligible as (
      select * from due_groups
       where (not coalesce($23::boolean, false) or kit_is_overdue)
         and (not coalesce($24::boolean, false) or process_is_overdue)
    ),
    page_base as (
      select * from eligible g
       order by $ORDER$
       limit greatest(coalesce($13::integer, 50), 0)
       offset greatest(coalesce($12::integer, 0), 0)
    ),
    page as (
      select g.*,
             (select array_agg(f.id order by coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)), f.id)
                from filtered f
               where f.order_id = g.order_id
                 and coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) = g.gkey) as item_ids
        from page_base g
    ),
    totals as (
      select count(*) as total,
             coalesce(sum(qty), 0) as qty_total,
             coalesce(sum(weight), 0) as weight_total,
             count(*) filter (where kit_is_overdue) as overdue_records,
             coalesce(sum(qty) filter (where kit_is_overdue), 0) as overdue_qty,
             coalesce(sum(weight) filter (where kit_is_overdue), 0) as overdue_weight
        from eligible
    )
    select jsonb_build_object(
      'total', totals.total,
      'qtyTotal', totals.qty_total,
      'weightTotal', totals.weight_total,
      'kitOverdue', jsonb_build_object(
        'records', totals.overdue_records,
        'qty', totals.overdue_qty,
        'weight', totals.overdue_weight
      ),
      'groups', coalesce((
        select jsonb_agg(jsonb_build_object(
          'orderId', g.order_id,
          'key', g.gkey,
          'itemIds', g.item_ids
        ) order by $ORDER$)
        from page g
      ), '[]'::jsonb)
    )
      from totals
  $q$;

  v_sql := replace(v_sql, '$ORDER$', v_order);
  execute v_sql into v_result using
    p_search, p_order_code, p_customer, p_child_item, p_description, p_material,
    p_parent_ids, p_delivery_from, p_delivery_to, p_process_id, p_process_status,
    greatest(coalesce(p_offset, 0), 0), greatest(coalesce(p_limit, 50), 0),
    p_seq, p_qty_min, p_qty_max, p_weight_min, p_weight_max,
    p_weight_unit_min, p_weight_unit_max, p_sort, p_sort_dir,
    p_kit_overdue, p_process_overdue, coalesce(p_process_code, 'ALL'), p_today;

  return v_result;
end;
$$;

revoke execute on function public.get_child_item_groups_page(
  text, text, text, text, text, text, uuid[], date, date, uuid, text,
  integer, integer, integer, numeric, numeric, numeric, numeric, numeric,
  numeric, text, text, boolean, boolean, text, date
) from public, anon;
grant execute on function public.get_child_item_groups_page(
  text, text, text, text, text, text, uuid[], date, date, uuid, text,
  integer, integer, integer, numeric, numeric, numeric, numeric, numeric,
  numeric, text, text, boolean, boolean, text, date
) to authenticated;
