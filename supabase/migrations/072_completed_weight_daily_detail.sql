-- 072) Movimento diário detalhado por processo no recorte semanal/mensal do dashboard.
-- Usa o mesmo escopo pai/filho, fuso e regra de peso da RPC 067.
create or replace function public.get_completed_weight_daily_detail(
  p_granularity text default 'week',
  p_anchor date default null,
  p_timezone text default 'America/Sao_Paulo'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gran text := case
    when lower(coalesce(p_granularity, '')) in ('day', 'week', 'month')
      then lower(p_granularity)
    else 'week'
  end;
  v_tz text := coalesce(nullif(p_timezone, ''), 'America/Sao_Paulo');
  v_anchor date := coalesce(p_anchor, (now() at time zone v_tz)::date);
  v_start date;
  v_end date;
  v_result jsonb;
begin
  if v_gran = 'week' then
    v_start := date_trunc('week', v_anchor::timestamp)::date;
    v_end := v_start + 7;
  elsif v_gran = 'month' then
    v_start := date_trunc('month', v_anchor::timestamp)::date;
    v_end := (date_trunc('month', v_anchor::timestamp) + interval '1 month')::date;
  else
    v_start := v_anchor;
    v_end := v_start + 1;
  end if;

  with days as (
    select generate_series(v_start::timestamp, (v_end - 1)::timestamp, interval '1 day')::date as day
  ),
  done_rows as (
    select
      (pp.completed_at at time zone v_tz)::date as done_date,
      pr.code,
      pr.name,
      pr.display_order,
      coalesce(pp.quantity_completed, 0) * coalesce(oi.unit_weight_kg, 0) as weight_kg,
      coalesce(pp.quantity_completed, 0) as quantity,
      oi.id as item_id
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
    join public.order_items oi on oi.id = pp.order_item_id
    where pp.status = 'CONCLUIDO'
      and pp.completed_at is not null
      and pp.completed_at >= (v_start::timestamp at time zone v_tz)
      and pp.completed_at < (v_end::timestamp at time zone v_tz)
      and ((pr.code in ('LASER', 'DB_CH', 'SERRA', 'DB_TB', 'PUNC', 'METALEIRA', 'FICEP', 'KIT'))
           = (oi.parent_order_item_id is not null))
  ),
  process_agg as (
    select
      done_date,
      code,
      name,
      display_order,
      sum(weight_kg) as weight_kg,
      sum(quantity) as quantity,
      count(distinct item_id) as items
    from done_rows
    group by done_date, code, name, display_order
    having sum(weight_kg) > 0 or sum(quantity) > 0
  ),
  day_totals as (
    select done_date, sum(weight_kg) as weight_kg, sum(quantity) as quantity
    from done_rows
    group by done_date
  ),
  day_processes as (
    select
      done_date,
      jsonb_agg(
        jsonb_build_object(
          'code', code,
          'name', name,
          'displayOrder', display_order,
          'weightKg', weight_kg,
          'quantity', quantity,
          'items', items
        )
        order by display_order, code
      ) as processes
    from process_agg
    group by done_date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', d.day,
        'weightKg', coalesce(t.weight_kg, 0),
        'quantity', coalesce(t.quantity, 0),
        'processes', coalesce(p.processes, '[]'::jsonb)
      )
      order by d.day
    ),
    '[]'::jsonb
  )
  into v_result
  from days d
  left join day_totals t on t.done_date = d.day
  left join day_processes p on p.done_date = d.day;

  return v_result;
end;
$$;

revoke execute on function public.get_completed_weight_daily_detail(text, date, text) from anon;
grant execute on function public.get_completed_weight_daily_detail(text, date, text) to authenticated;
