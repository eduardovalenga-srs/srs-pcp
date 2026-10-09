-- -------------------------------------------------------------
-- 014) Filtro por período na tela de gestão de entregas
--
--   Dois parâmetros novos em get_production_rows, aplicados sobre a
--   data de entrega do sub-item (período inclusivo, um lado pode ficar
--   em branco = aberto; item sem data fica de fora quando o período
--   está ativo):
--     p_delivery_from  ->  oi.delivery_date >= p_delivery_from
--     p_delivery_to    ->  oi.delivery_date <= p_delivery_to
--
--   O filtro combina em E com a janela rápida (p_delivery_filter) e
--   com todos os demais filtros. A assinatura muda (19 -> 21
--   parâmetros), então a versão antiga é removida antes de criar a
--   nova — sem o drop existiriam duas sobrecargas (mesmo padrão das
--   migrações 007 e 013). Os parâmetros entram no FINAL para não
--   quebrar chamadas posicionais existentes (ex.: seed).
-- -------------------------------------------------------------

drop function if exists public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric);

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
  -- ---------------------------------------------------------
  -- Ordenação com whitelist (nunca concatena entrada do usuário)
  -- ---------------------------------------------------------
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

  -- ---------------------------------------------------------
  -- Query principal
  -- ---------------------------------------------------------
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
      where ($2 is null or o.status = $2)
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
        -- -----------------------------------------------------
        -- Filtros por coluna (007): "contém" e faixas numéricas
        -- -----------------------------------------------------
        and ($9 is null or o.code ilike '%' || $9 || '%')
        and ($10 is null or coalesce(o.customer_name, '') ilike '%' || $10 || '%')
        and ($11 is null or coalesce(oi.family, '') ilike '%' || $11 || '%')
        and ($12 is null or coalesce(oi.parent_item, '') ilike '%' || $12 || '%')
        and ($13 is null or oi.description ilike '%' || $13 || '%')
        and ($14 is null or oi.quantity >= $14)
        and ($15 is null or oi.quantity <= $15)
        and ($16 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg >= $16))
        and ($17 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg <= $17))
        -- -----------------------------------------------------
        -- Período de entrega (014): inclusivo; item sem data fica
        -- de fora quando o lado correspondente está definido
        -- -----------------------------------------------------
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
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.op, j.overdue, j.processes
    from joined j
  $q$;

  -- Ordenação montada apenas com expressões de whitelist / quote_literal
  v_sql := v_sql
    || ' order by ' || v_sort_expr || ' ' || v_sort_dir
    || ' nulls last, j.ord_code asc, j.parent_item asc nulls last, j.item_id asc'
    || ' limit $7 offset $8';

  -- Ordem do USING: $1..$8 = filtros originais + paginação,
  -- $9..$17 = filtros de coluna (texto depois de trim, faixas como numeric),
  -- $18..$19 = período de entrega (014)
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
