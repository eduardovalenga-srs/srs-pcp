-- -------------------------------------------------------------
-- 035) Cards de resumo: totais por FAMÍLIA do produto (F1 e F2)
--
-- Os cards de resumo da Fábrica 1 e da Fábrica 2 passam a mostrar,
-- junto dos números já existentes, a quebra por família (coluna TP /
-- order_items.family) de TODO o conjunto filtrado — mesma janela do
-- "Qtd. total" e do "Peso total" (todas as páginas, antes do
-- limit/offset). Ordenação: quantidade desc; família vazia vira null
-- e a UI exibe "—". A gestão de OF não muda.
--
-- 1) get_child_items_totals (redefinição da 024): ganha a chave
--    'families' = [{family, qty, weight}]. A consulta vira CTE
--    `filtered` (mesmos 11 filtros, inalterados) e o agrupamento sai
--    num subselect. Assinatura inalterada (retorna jsonb).
--
-- 2) get_production_rows (redefinição da 031): coluna nova no
--    RETURNS TABLE exige DROP + recriação com a MESMA assinatura
--    (21 params) — precedente exato das 017/018/022. Ganha
--    `family_totals jsonb` por subconsulta NÃO correlacionada sobre o
--    CTE filtered: avaliada uma vez por execução, sobre o conjunto
--    filtrado inteiro (o limit da listagem não a corta).
--
-- Corpos copiados das migrações-fonte por contagem de ocorrências
-- (gen035.mjs) — falha alto se a fonte mudar.
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
  with filtered as (
    select
      nullif(btrim(oi.family), '') as family,
      coalesce(oi.quantity, 0) as qty,
      coalesce(oi.total_weight_kg, 0) as weight
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
               and pp.status = p_process_status))
  )
  select jsonb_build_object(
    'total', count(*),
    'qtyTotal', coalesce(sum(qty), 0),
    -- 023: peso TOTAL derivado (qtd × peso unit.).
    'weightTotal', coalesce(sum(weight), 0),
    -- 035: quebra por família (TP) do conjunto filtrado inteiro — mesma
    -- janela de total/qtyTotal/weightTotal. Família vazia vira null e a UI
    -- exibe "—"; ordenado por qtd. desc (null por último no desempate).
    'families', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'family', g.family,
            'qty', g.qty,
            'weight', g.weight
          )
          order by g.qty desc, g.family asc
        )
        from (
          select family, sum(qty) as qty, sum(weight) as weight
          from filtered
          group by family
        ) g
      ),
      '[]'::jsonb
    )
  )
  from filtered;
$$;

revoke execute on function public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text) from anon;
grant execute on function public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text) to authenticated;

-- A coluna nova no RETURNS TABLE não entra via CREATE OR REPLACE (muda o
-- tipo de retorno): DROP + recriação com a MESMA assinatura (21 params) —
-- precedente exato das 017/018/022. O DROP leva o EXECUTE junto, então os
-- grants são refeitos logo abaixo do create.
drop function if exists public.get_production_rows(
  text, text, text, text, text, date, text, text, integer, integer,
  text, text, text, text, text, numeric, numeric, numeric, numeric, date, date
);

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
  processes jsonb,
  family_totals jsonb
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
        || 'when ''NAO_INICIADO'' then 2 '
        || 'else 3 end '
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
        pp.notes as pnotes,
        pp.completed_at as p_completed
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
              'notes', r.pnotes,
              'completedAt', r.p_completed
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
      coalesce(j.processes, '{}'::jsonb) as processes,
      -- 035: totais por família de TODO o conjunto filtrado. Subconsulta
      -- NÃO correlacionada sobre o CTE: avaliada uma vez por execução,
      -- sobre o conjunto inteiro (o limit/offset da listagem não a corta) —
      -- mesma janela de total_count/weight_total/qty_total.
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'family', g.family,
              'qty', g.qty,
              'weight', g.weight
            )
            order by g.qty desc, g.family asc
          )
          from (
            select nullif(btrim(j2.family), '') as family,
                   sum(coalesce(j2.qty, 0)) as qty,
                   sum(coalesce(j2.total_w, 0)) as weight
            from filtered j2
            group by nullif(btrim(j2.family), '')
          ) g
        ),
        '[]'::jsonb
      ) as family_totals
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
