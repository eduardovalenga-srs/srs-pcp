-- -------------------------------------------------------------
-- 095) Datas efetivas para processos concluídos no índice do sequenciamento
--
-- As datas previstas dos processos passam a vir das FILAS do sequenciamento
-- (prioridade global + âncora do processo + capacidade kg/dia da família),
-- exatamente como a tela de Sequenciamento calcula.
--
-- Esta RPC devolve uma linha por processo ativo, com todas as OFs da fila
-- agrupadas em JSON. Isso evita truncamento pelo limite padrão de linhas do
-- PostgREST, mantendo uma única chamada para construir o índice global.
--
-- Processo concluído na OF não consome capacidade. OF com EXP concluído
-- também sai da fila e recebe a data efetiva da conclusão do EXP.
--
-- A ordenação interna de cada fila é:
-- `seq nulls last, entrega, código`.
-- -------------------------------------------------------------
create or replace function public.get_all_process_scheduling()
returns table (
  process_id uuid,
  process_code text,
  anchor_date date,
  rows jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with queue_rows as (
    select
      p.id as process_id,
      p.code as process_code,
      p.display_order as process_display_order,
      settings.anchor_date,
      o.id as order_id,
      o.code as order_code,
      o.delivery_date,
      o.product_group_id,
      case
        when process_state.process_status = 'CONCLUIDO' or exp.concluded then 0::numeric
        else items.weight_kg
      end as weight_kg,
      cap.capacity as capacity_kg,
      global_sequence.position,
      process_state.process_status,
      process_state.process_completed_at,
      coalesce(exp.concluded, false) as exp_concluded,
      exp.completed_at as exp_completed_at
    from public.processes p
    join public.orders o
      on (
        o.status in ('PLANEJADO', 'EM_PRODUCAO')
        or public.order_exp_concluded(o.id)
      )
    left join public.process_schedule_settings settings
      on settings.process_id = p.id
    left join public.product_group_process_capacities cap
      on cap.product_group_id = o.product_group_id
     and cap.process_id = p.id
     and cap.unit = 'KG'
    left join lateral (
      select
        sum(oi.quantity) as quantity,
        sum(oi.total_weight_kg) as weight_kg
      from public.order_items oi
      where oi.order_id = o.id
        and oi.parent_order_item_id is null
    ) items on true
    left join lateral (
      select min(oi.seq)::integer as position
      from public.order_items oi
      where oi.order_id = o.id
    ) global_sequence on true
    left join lateral (
      -- Situação do processo na OF: pior caso entre os itens aplicáveis.
      select
        case
          when count(*) = 0 then null
          when bool_and(pp.status = 'CONCLUIDO') then 'CONCLUIDO'
          else 'NAO_INICIADO'
        end as process_status,
        max(pp.completed_at) filter (where pp.status = 'CONCLUIDO') as process_completed_at
      from public.order_items oi
      join public.production_processes pp on pp.order_item_id = oi.id
      where oi.order_id = o.id
        and pp.process_id = p.id
        and pp.status <> 'NAO_APLICAVEL'
    ) process_state on true
    left join lateral (
      -- Expedida só quando todas as raízes atendem à regra da 084.
      select
        public.order_exp_concluded(o.id) as concluded,
        max(pp.completed_at) as completed_at
      from public.order_items oi
      join public.production_processes pp on pp.order_item_id = oi.id
      join public.processes pr on pr.id = pp.process_id
      where oi.order_id = o.id
        and oi.parent_order_item_id is null
        and pr.code = 'EXP'
        and pp.status = 'CONCLUIDO'
    ) exp on true
    where p.active
      and items.quantity is not null
      and exists (
        select 1
        from public.order_items oi
        join public.production_processes pp on pp.order_item_id = oi.id
        where oi.order_id = o.id
          and pp.process_id = p.id
          and pp.status in ('NAO_INICIADO', 'CONCLUIDO')
      )
  )
  select
    q.process_id,
    q.process_code,
    q.anchor_date,
    jsonb_agg(
      jsonb_build_object(
        'order_id', q.order_id,
        'product_group_id', q.product_group_id,
        'weight_kg', q.weight_kg,
        'capacity_kg', q.capacity_kg,
        'position', q.position,
        'process_concluded', coalesce(q.process_status = 'CONCLUIDO', false),
        'process_completed_at', q.process_completed_at,
        'exp_concluded', q.exp_concluded,
        'exp_completed_at', q.exp_completed_at
      )
      order by q.position nulls last, q.delivery_date nulls last, q.order_code
    ) as rows
  from queue_rows q
  group by q.process_id, q.process_code, q.process_display_order, q.anchor_date
  order by q.process_display_order, q.process_code;
$$;

revoke execute on function public.get_all_process_scheduling() from public, anon;
grant execute on function public.get_all_process_scheduling() to authenticated;
