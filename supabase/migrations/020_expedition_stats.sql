-- 020: card "Expedição" da gestão de entregas
--
-- O objeto stats da RPC get_production_stats ganha 'expedition' com
-- três números sobre os itens cuja etapa EXPEDIÇÃO está CONCLUIDA:
--   count — quantidade de itens (só raiz, 016);
--   qty   — soma da coluna de quantidade (quantity);
--   weight— soma da coluna de peso unitário (unit_weight_kg).
-- Itens sem quantidade/peso entram como 0; item sem linha EXP ou com
-- EXP em outro status fica fora dos três números ao mesmo tempo.
--
-- retorna jsonb e assinatura (date) inalteradas — CREATE OR REPLACE
-- normal, sem DROP (mesmo padrão da 019).
-- -------------------------------------------------------------

create or replace function public.get_production_stats(p_today date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_result jsonb;
begin
  select jsonb_build_object(
    'totalOrders', (select count(*) from public.orders),
    'ordersByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select o.status as status, count(*) as cnt
          from public.orders o
          group by o.status
        ) s
      ),
      '{}'::jsonb
    ),
    'totalItems', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null
    ),
    'itemsByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select oi.status as status, count(*) as cnt
          from public.order_items oi
          where oi.parent_order_item_id is null
          group by oi.status
        ) s
      ),
      '{}'::jsonb
    ),
    'itemsInProduction', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null and oi.status = 'EM_PRODUCAO'
    ),
    'itemsDone', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null and oi.status = 'CONCLUIDO'
    ),
    'itemsOverdue', (
      select count(*)
      from public.order_items oi
      where oi.parent_order_item_id is null
        and oi.delivery_date is not null
        and oi.delivery_date < v_today
        and not exists (
          select 1
          from public.production_processes pp
          join public.processes pr on pr.id = pp.process_id
          where pp.order_item_id = oi.id
            and pr.code = 'EXP'
            and pp.status = 'CONCLUIDO'
        )
    ),
    'delivery', (
      select jsonb_build_object(
        'overdue', count(*) filter (where d.is_overdue),
        'overdueQty', coalesce(sum(coalesce(d.quantity, 0)) filter (where d.is_overdue), 0),
        'overdueWeight', coalesce(sum(coalesce(d.unit_weight_kg, 0)) filter (where d.is_overdue), 0),
        'today', count(*) filter (where d.delivery_date = v_today),
        'next7', count(*) filter (where d.delivery_date > v_today and d.delivery_date <= (v_today + 7)),
        'next30', count(*) filter (where d.delivery_date > (v_today + 7) and d.delivery_date <= (v_today + 30))
      )
      from (
        select
          oi.delivery_date,
          oi.quantity,
          oi.unit_weight_kg,
          (
            oi.delivery_date < v_today
            and not exists (
              select 1 from public.production_processes pp
              join public.processes pr on pr.id = pp.process_id
              where pp.order_item_id = oi.id and pr.code = 'EXP' and pp.status = 'CONCLUIDO'
            )
          ) as is_overdue
        from public.order_items oi
        where oi.parent_order_item_id is null
          and oi.delivery_date is not null
      ) d
    ),
    'expedition', (
      select jsonb_build_object(
        'count', count(*),
        'qty', coalesce(sum(coalesce(oi.quantity, 0)), 0),
        'weight', coalesce(sum(coalesce(oi.unit_weight_kg, 0)), 0)
      )
      from public.order_items oi
      where oi.parent_order_item_id is null
        and exists (
          select 1
          from public.production_processes pp
          join public.processes pr on pr.id = pp.process_id
          where pp.order_item_id = oi.id
            and pr.code = 'EXP'
            and pp.status = 'CONCLUIDO'
        )
    ),
    'processes', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'code', g.code,
            'name', g.name,
            'displayOrder', g.display_order,
            'total', g.total,
            'pending', g.pending,
            'inProgress', g.in_progress,
            'blocked', g.blocked,
            'done', g.done
          ) order by g.display_order
        )
        from (
          select
            p.code as code,
            p.name as name,
            p.display_order as display_order,
            count(*) filter (where oi.id is not null and pp.status <> 'NAO_APLICAVEL') as total,
            count(*) filter (where oi.id is not null and pp.status = 'NAO_INICIADO') as pending,
            count(*) filter (where oi.id is not null and pp.status = 'EM_ANDAMENTO') as in_progress,
            count(*) filter (where oi.id is not null and pp.status = 'BLOQUEADO') as blocked,
            count(*) filter (where oi.id is not null and pp.status = 'CONCLUIDO') as done
          from public.processes p
          left join public.production_processes pp on pp.process_id = p.id
          left join public.order_items oi
            on oi.id = pp.order_item_id
           and oi.parent_order_item_id is null
          where p.active
          group by p.id, p.code, p.name, p.display_order
        ) g
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_production_stats(date) from anon;
grant execute on function public.get_production_stats(date) to authenticated;
