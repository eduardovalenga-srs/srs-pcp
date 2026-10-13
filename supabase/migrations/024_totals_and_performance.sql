-- -------------------------------------------------------------
-- 024) Totais com peso REAL (qtd × peso unit.) + consultas leves
--
-- Três mudanças, todas com assinatura inalterada (PostgREST chama
-- pelas mesmas posições/nomes de argumento):
--
-- 1) get_production_rows: o card "Peso total" da gestão de entregas
--    somava a coluna de PESO UNITÁRIO (sum(unit_w)) — 4 peças de
--    12,5 kg apareciam como 12,5 kg. Passa a somar total_weight_kg
--    (023: derivado de qtd × peso unit.).
--    Estrutura: as duas subconsultas correlacionadas por linha da
--    lista (jsonb dos processos + "expedição concluída?") viram UMA
--    pré-agregação por item (proc_agg) + hash join.
--
-- 2) get_production_stats: ~10 subselects independentes (um varria
--    cada tabela inteira, com not exists correlacionado por linha)
--    viram poucas passadas agregadas; "delivery.overdueWeight" e
--    "expedition.weight" também passam a somar o peso TOTAL.
--
-- 3) get_dashboard_orders (NOVA): top clientes e envelhecimento
--    agregados no banco. Substitui o select da tabela orders INTEIRA
--    que o dashboard fazia para contar no JavaScript.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) get_production_rows (cópia da 022 + peso total + proc_agg)
-- -------------------------------------------------------------
create or replace function public.get_production_rows(
  p_search text default null,
  p_order_status text default null,
  p_process_code text default null,
  p_process_status text default null,
  p_delivery_filter text default 'ALL',
  p_today date default null,
  p_sort text default 'delivery_date',
  p_sort_dir text default 'asc',
  p_offset integer default 0,
  p_limit integer default 50,
  -- filtros por coluna (007)
  p_order_code text default null,
  p_customer text default null,
  p_family text default null,
  p_parent_item text default null,
  p_description text default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  -- período de entrega (014): inclusivo, lados opcionais
  p_delivery_from date default null,
  p_delivery_to date default null
)
returns table (
  total_count bigint,
  weight_total numeric,
  qty_total numeric,
  order_item_id uuid,
  order_id uuid,
  order_code text,
  order_type text,
  customer_name text,
  order_status text,
  family text,
  parent_item text,
  description text,
  quantity numeric,
  unit_weight_kg numeric,
  delivery_date date,
  item_status text,
  op text,
  overdue boolean,
  processes jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_sort_expr text;
  v_sort_dir text;
  v_sql text;
begin
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sort_expr := case p_sort
    when 'delivery_date'  then 'j.deliv'
    when 'order_code'     then 'j.ord_code'
    when 'order_type'     then 'j.ord_type'
    when 'order_status'   then 'j.ord_status'
    when 'family'         then 'j.family'
    when 'parent_item'    then 'j.parent_item'
    when 'description'    then 'j.descr'
    when 'quantity'       then 'j.qty'
    when 'unit_weight_kg' then 'j.unit_w'
    when 'item_status'    then 'j.item_status'
    when 'op'             then 'j.op'
    when 'overdue'        then 'j.overdue'
    else null
  end;

  -- Ordenação por coluna de processo (código existente no catálogo)
  if v_sort_expr is null then
    if exists (select 1 from public.processes pr where pr.code = p_sort) then
      v_sort_expr :=
        '(select case xp.pstatus '
        || 'when ''CONCLUIDO'' then 1 '
        || 'when ''EM_ANDAMENTO'' then 2 '
        || 'when ''NAO_INICIADO'' then 3 '
        || 'when ''BLOQUEADO'' then 4 '
        || 'else 5 end '
        || 'from process_rows xp '
        || 'where xp.pid = j.item_id and xp.pcode = ' || quote_literal(p_sort) || ' limit 1)';
    else
      v_sort_expr := 'j.deliv';
    end if;
  end if;

  v_sql := $q$
    with process_rows as (
      select
        pp.order_item_id as pid,
        pr.code as pcode,
        pp.id as pp_id,
        pp.status as pstatus,
        pp.quantity_planned as pq_planned,
        pp.quantity_completed as pq_done,
        pp.notes as pnotes
      from public.production_processes pp
      join public.processes pr on pr.id = pp.process_id
    ),
    -- 024: agregação UMA vez por item — antes eram duas subconsultas
    -- correlacionadas (jsonb + expedicao) para CADA linha da lista.
    proc_agg as (
      select
        r.pid,
        coalesce(
          jsonb_object_agg(
            r.pcode,
            jsonb_build_object(
              'id', r.pp_id,
              'status', r.pstatus,
              'quantityPlanned', r.pq_planned,
              'quantityCompleted', r.pq_done,
              'notes', r.pnotes
            ) order by r.pcode
          ),
          '{}'::jsonb
        ) as processes,
        bool_or(r.pcode = 'EXP' and r.pstatus = 'CONCLUIDO') as exp_done
      from process_rows r
      group by r.pid
    ),
    filtered as (
      select
        oi.id as item_id,
        oi.order_id as ord_id,
        coalesce(oi.family, '') as family,
        coalesce(oi.parent_item, '') as parent_item,
        oi.description as descr,
        oi.quantity as qty,
        oi.unit_weight_kg as unit_w,
        -- 023: coluna derivada (qtd × peso unit.) mantida pelo trigger.
        oi.total_weight_kg as total_w,
        -- 022: item sem entrega própria herda a do pedido (mesma regra
        -- da Fábrica 1 e do detalhe da OF).
        coalesce(oi.delivery_date, o.delivery_date) as deliv,
        oi.status as item_status,
        oi.op as op,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust,
        coalesce(p.exp_done, false) as exp_done,
        p.processes as processes
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join proc_agg p on p.pid = oi.id
      -- 016: só itens de nível raiz (itens pai / manuais)
      where oi.parent_order_item_id is null
        and ($2 is null or o.status = $2)
        and (
          $1 is null
          or o.code ilike '%' || $1 || '%'
          or coalesce(oi.family, '') ilike '%' || $1 || '%'
          or coalesce(oi.parent_item, '') ilike '%' || $1 || '%'
          or oi.description ilike '%' || $1 || '%'
        )
        and (
          -- filtro de processo
          $3 is null
          or exists (
            select 1 from process_rows x
            where x.pid = oi.id
              and x.pcode = $3
              and (case when $4 is null then x.pstatus <> 'NAO_APLICAVEL' else x.pstatus = $4 end)
          )
        )
        and (
          -- status de processo sem processo específico
          $4 is null or $3 is not null
          or exists (select 1 from process_rows x where x.pid = oi.id and x.pstatus = $4)
        )
        and (
          -- filtro de entrega (janela rápida) — 022: entrega efetiva
          case $5
            when 'OVERDUE' then
              coalesce(oi.delivery_date, o.delivery_date) is not null
              and coalesce(oi.delivery_date, o.delivery_date) < $6::date
              and not coalesce(p.exp_done, false)
            when 'TODAY' then coalesce(oi.delivery_date, o.delivery_date) = $6::date
            when 'NEXT_7_DAYS' then
              coalesce(oi.delivery_date, o.delivery_date) >= $6::date
              and coalesce(oi.delivery_date, o.delivery_date) <= (($6::date + 7))
            when 'NEXT_30_DAYS' then
              coalesce(oi.delivery_date, o.delivery_date) >= $6::date
              and coalesce(oi.delivery_date, o.delivery_date) <= (($6::date + 30))
            else true
          end
        )
        and ($9 is null or o.code ilike '%' || $9 || '%')
        and ($10 is null or coalesce(o.customer_name, '') ilike '%' || $10 || '%')
        and ($11 is null or coalesce(oi.family, '') ilike '%' || $11 || '%')
        and ($12 is null or coalesce(oi.parent_item, '') ilike '%' || $12 || '%')
        and ($13 is null or oi.description ilike '%' || $13 || '%')
        and ($14 is null or oi.quantity >= $14)
        and ($15 is null or oi.quantity <= $15)
        and ($16 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg >= $16))
        and ($17 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg <= $17))
        and ($18 is null or (coalesce(oi.delivery_date, o.delivery_date) is not null
                             and coalesce(oi.delivery_date, o.delivery_date) >= $18))
        and ($19 is null or (coalesce(oi.delivery_date, o.delivery_date) is not null
                             and coalesce(oi.delivery_date, o.delivery_date) <= $19))
    )
    select
      count(*) over() as total_count,
      -- 024: PESO TOTAL (qtd × peso unit.) do conjunto filtrado inteiro.
      coalesce(sum(coalesce(j.total_w, 0)) over(), 0) as weight_total,
      coalesce(sum(coalesce(j.qty, 0)) over(), 0) as qty_total,
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.op,
      (j.deliv is not null and j.deliv < $6::date and not j.exp_done) as overdue,
      coalesce(j.processes, '{}'::jsonb) as processes
    from filtered j
  $q$;

  v_sql := v_sql
    || ' order by ' || v_sort_expr || ' ' || v_sort_dir
    || ' nulls last, j.ord_code asc, j.parent_item asc nulls last, j.item_id asc'
    || ' limit $7 offset $8';

  return query execute v_sql
    using
      nullif(p_search, ''),
      nullif(p_order_status, ''),
      nullif(p_process_code, ''),
      nullif(p_process_status, ''),
      coalesce(p_delivery_filter, 'ALL'),
      v_today,
      greatest(coalesce(p_limit, 50), 1),
      greatest(coalesce(p_offset, 0), 0),
      nullif(p_order_code, ''),
      nullif(p_customer, ''),
      nullif(p_family, ''),
      nullif(p_parent_item, ''),
      nullif(p_description, ''),
      p_qty_min,
      p_qty_max,
      p_weight_min,
      p_weight_max,
      p_delivery_from,
      p_delivery_to;
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) to authenticated;

-- -------------------------------------------------------------
-- 2) get_production_stats (cópia da 022 + agregação em poucas passadas)
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
  with roots as (
    select
      oi.id,
      oi.status,
      oi.quantity,
      oi.total_weight_kg,
      coalesce(oi.delivery_date, o.delivery_date) as deliv
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.parent_order_item_id is null
  ),
  -- 024: uma única passada de processos serve atraso, expedição e
  -- as janelas de entrega (antes: um not exists correlacionado por linha).
  pstat as (
    select
      pp.order_item_id as pid,
      bool_or(pr.code = 'EXP' and pp.status = 'CONCLUIDO') as exp_done
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
    group by pp.order_item_id
  ),
  rstat as (
    select r.*, coalesce(p.exp_done, false) as exp_done
    from roots r
    left join pstat p on p.pid = r.id
  ),
  item_status as (
    select s.status, count(*) as cnt
    from roots s
    group by s.status
  ),
  delivery_agg as (
    select
      count(*) filter (where d.is_overdue) as overdue,
      coalesce(sum(coalesce(d.quantity, 0)) filter (where d.is_overdue), 0) as overdue_qty,
      -- 023: peso TOTAL (qtd × peso unit.), não o unitário.
      coalesce(sum(coalesce(d.total_weight_kg, 0)) filter (where d.is_overdue), 0) as overdue_weight,
      count(*) filter (where d.deliv = v_today) as today,
      count(*) filter (where d.deliv > v_today and d.deliv <= (v_today + 7)) as next7,
      count(*) filter (where d.deliv > (v_today + 7) and d.deliv <= (v_today + 30)) as next30
    from (
      select r.quantity, r.total_weight_kg, r.deliv,
             (r.deliv is not null and r.deliv < v_today and not r.exp_done) as is_overdue
      from rstat r
      where r.deliv is not null
    ) d
  ),
  expedition_agg as (
    select
      count(*) as cnt,
      coalesce(sum(coalesce(r.quantity, 0)), 0) as qty,
      -- 023: peso TOTAL (qtd × peso unit.), não o unitário.
      coalesce(sum(coalesce(r.total_weight_kg, 0)), 0) as weight
    from rstat r
    where r.exp_done
  ),
  overdue_agg as (
    select count(*) as cnt
    from rstat r
    where r.deliv is not null and r.deliv < v_today and not r.exp_done
  ),
  orders_agg as (
    select count(*) as total from public.orders
  ),
  orders_by_status as (
    select coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select o.status as status, count(*) as cnt
          from public.orders o
          group by o.status
        ) s
      ),
      '{}'::jsonb
    ) as value
  ),
  process_load as (
    select coalesce(
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
    ) as value
  )
  select jsonb_build_object(
    'totalOrders', o.total,
    'ordersByStatus', bs.value,
    'totalItems', (select count(*) from roots),
    'itemsByStatus', coalesce(
      (select jsonb_object_agg(s.status, s.cnt) from item_status s),
      '{}'::jsonb
    ),
    'itemsInProduction', coalesce((select s.cnt from item_status s where s.status = 'EM_PRODUCAO'), 0),
    'itemsDone', coalesce((select s.cnt from item_status s where s.status = 'CONCLUIDO'), 0),
    'itemsOverdue', (select a.cnt from overdue_agg a),
    'delivery', jsonb_build_object(
      'overdue', d.overdue,
      'overdueQty', d.overdue_qty,
      'overdueWeight', d.overdue_weight,
      'today', d.today,
      'next7', d.next7,
      'next30', d.next30
    ),
    'expedition', jsonb_build_object(
      'count', e.cnt,
      'qty', e.qty,
      'weight', e.weight
    ),
    'processes', pl.value
  )
  into v_result
  from orders_agg o, orders_by_status bs, delivery_agg d, expedition_agg e, process_load pl;

  return v_result;
end;
$$;

revoke execute on function public.get_production_stats(date) from anon;
grant execute on function public.get_production_stats(date) to authenticated;

-- -------------------------------------------------------------
-- 3) get_dashboard_orders (NOVA): agregados do dashboard no banco
-- -------------------------------------------------------------
create or replace function public.get_dashboard_orders()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    -- Top 5 clientes (pedidos sem cliente viram "Sem cliente").
    'topCustomers', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('name', t.name, 'count', t.cnt)
          order by t.cnt desc, t.name asc
        )
        from (
          select coalesce(nullif(trim(o.customer_name), ''), 'Sem cliente') as name,
                 count(*) as cnt
          from public.orders o
          group by 1
          order by cnt desc, name asc
          limit 5
        ) t
      ),
      '[]'::jsonb
    ),
    -- Envelhecimento dos pedidos em aberto (mesmas faixas do cálculo
    -- legado em JS, inclusive data futura na última faixa).
    'aging', coalesce(
      (
        select jsonb_object_agg(a.bucket, a.cnt)
        from (
          select
            case
              when o.order_date is null then 'sem-data'
              when o.order_date > current_date then '60+'
              when (current_date - o.order_date) <= 7 then '0-7'
              when (current_date - o.order_date) <= 15 then '8-15'
              when (current_date - o.order_date) <= 30 then '16-30'
              when (current_date - o.order_date) <= 60 then '31-60'
              else '60+'
            end as bucket,
            count(*) as cnt
          from public.orders o
          where o.status in ('PLANEJADO', 'EM_PRODUCAO')
          group by 1
        ) a
      ),
      '{}'::jsonb
    )
  );
$$;

revoke execute on function public.get_dashboard_orders() from anon;
grant execute on function public.get_dashboard_orders() to authenticated;

-- -------------------------------------------------------------
-- 4) get_child_items_totals (NOVA): card da Fábrica 1 em 1 consulta
--
-- A tela buscava TODAS as linhas filtradas (com embeds de materiais e
-- processos) só para somar quantidade/peso no JavaScript e contar os
-- registros. Agora a soma e a contagem saem agregadas no banco, com
-- os mesmos filtros da listagem.
-- -------------------------------------------------------------
create or replace function public.get_child_items_totals(
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
  p_process_status text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*),
    'qtyTotal', coalesce(sum(coalesce(oi.quantity, 0)), 0),
    -- 023: peso TOTAL derivado (qtd × peso unit.).
    'weightTotal', coalesce(sum(coalesce(oi.total_weight_kg, 0)), 0)
  )
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
          select 1 from public.order_item_materials m
           where m.order_item_id = oi.id
             and m.description ilike '%' || p_material || '%'))
    and (p_parent_ids is null or oi.parent_order_item_id = any (p_parent_ids))
    and (p_delivery_from is null or oi.delivery_date >= p_delivery_from)
    and (p_delivery_to is null or oi.delivery_date <= p_delivery_to)
    and (p_process_id is null or exists (
          select 1 from public.production_processes pp
           where pp.order_item_id = oi.id
             and pp.process_id = p_process_id
             and (p_process_status is null or pp.status = p_process_status)))
    and (p_process_id is not null or p_process_status is null or exists (
          select 1 from public.production_processes pp
           where pp.order_item_id = oi.id
             and pp.status = p_process_status));
$$;

revoke execute on function public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text) from anon;
grant execute on function public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text) to authenticated;

-- Materiais por item (filtros e grade): a FK não tinha índice.
create index if not exists idx_order_item_materials_order_item_id
  on public.order_item_materials (order_item_id);
