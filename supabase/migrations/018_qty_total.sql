-- 018: total de quantidade da lista filtrada (card "Eventos" da gestão de entregas)
--
-- A RPC get_production_rows passa a devolver qty_total: soma da coluna
-- de quantidade (quantity) de TODAS as linhas que passam nos filtros —
-- a janela é avaliada antes do order by/limit/offset, então o número
-- acompanha a lista filtrada inteira, não só a página atual.
-- Itens sem quantidade entram como 0.
--
-- O PostgreSQL não permite acrescentar coluna em RETURNS TABLE via
-- CREATE OR REPLACE (muda o tipo de retorno), por isso DROP + recriação
-- com o mesmo corpo da 017 e os grants refeitos. Assinatura inalterada
-- (21 params) — o PostgREST não muda de nome nem de argumentos.
-- -------------------------------------------------------------

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
    filtered as (
      select
        oi.id as item_id,
        oi.order_id as ord_id,
        coalesce(oi.family, '') as family,
        coalesce(oi.parent_item, '') as parent_item,
        oi.description as descr,
        oi.quantity as qty,
        oi.unit_weight_kg as unit_w,
        oi.delivery_date as deliv,
        oi.status as item_status,
        oi.op as op,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
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
          -- filtro de entrega (janela rápida)
          case $5
            when 'OVERDUE' then
              oi.delivery_date is not null and oi.delivery_date < $6::date
              and not exists (
                select 1 from process_rows x
                where x.pid = oi.id and x.pcode = 'EXP' and x.pstatus = 'CONCLUIDO'
              )
            when 'TODAY' then oi.delivery_date = $6::date
            when 'NEXT_7_DAYS' then oi.delivery_date >= $6::date and oi.delivery_date <= (($6::date + 7))
            when 'NEXT_30_DAYS' then oi.delivery_date >= $6::date and oi.delivery_date <= (($6::date + 30))
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
        and ($18 is null or (oi.delivery_date is not null and oi.delivery_date >= $18))
        and ($19 is null or (oi.delivery_date is not null and oi.delivery_date <= $19))
    ),
    joined as (
      select
        f.*,
        (
          f.deliv is not null
          and f.deliv < $6::date
          and not exists (
            select 1 from process_rows x
            where x.pid = f.item_id and x.pcode = 'EXP' and x.pstatus = 'CONCLUIDO'
          )
        ) as overdue,
        coalesce(
          (
            select jsonb_object_agg(
              x.pcode,
              jsonb_build_object(
                'id', x.pp_id,
                'status', x.pstatus,
                'quantityPlanned', x.pq_planned,
                'quantityCompleted', x.pq_done,
                'notes', x.pnotes
              ) order by x.pcode
            )
            from process_rows x
            where x.pid = f.item_id
          ),
          '{}'::jsonb
        ) as processes
      from filtered f
    )
    select
      count(*) over() as total_count,
      coalesce(sum(coalesce(j.unit_w, 0)) over(), 0) as weight_total,
      coalesce(sum(coalesce(j.qty, 0)) over(), 0) as qty_total,
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.op, j.overdue, j.processes
    from joined j
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
