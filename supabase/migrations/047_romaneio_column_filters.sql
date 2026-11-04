-- -------------------------------------------------------------
-- 047) Romaneio — filtros em TODAS as colunas da listagem
--
-- A tela /romaneio passa a filtrar também por Nº (faixa), Situação,
-- Peso (faixa), NF de saída e NF de devolução — além dos filtros que
-- já existiam (busca, OF/OS, cliente, período de saída).
--
-- 1) get_romaneios_page: assinatura NOVA (o DROP é obrigatório —
--    mudou a lista de parâmetros; sem ele ficam duas funções
--    homônimas e a chamada por nome falha). Os filtros novos entram
--    no CTE `filtered` (mesmo lugar dos atuais):
--      * nº        — r.number entre $7 e $8;
--      * peso      — a.weight_total (agregado Σ qtd × peso unit.) entre
--                    $9 e $10; item sem peso unitário dá NULL e fica
--                    FORA quando há filtro de peso (não conta como 0);
--      * NF saída  — ilike em coalesce(nf_number, '')   ($11);
--      * NF devol. — ilike em coalesce(return_nf_number, '') ($12);
--      * situação  — $2 já existia (a app passava null).
--
-- 2) get_romaneio_summary (NOVA): os cartões Abertos/Conferidos/
--    Confirmados deixam de ser 3 contagens em PostgREST e passam a
--    vir daqui com TODOS os filtros aplicados — inclusive o de peso,
--    que é agregado e o PostgREST não alcança. Sempre devolve 1 linha.
--      * total_count — respeita p_status (bate com o total da lista
--                      paginada);
--      * *_count     — breakdown por situação, IGNORA p_status (senão
--                      os outros dois cartões zerariam).
--    Os filtros são idênticos aos da get_romaneios_page — os dois
--    blocos precisam mudar juntos.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) get_romaneios_page — drop da assinatura antiga (043/045) e
--    recriação com os filtros de coluna novos.
-- -------------------------------------------------------------
drop function if exists public.get_romaneios_page(text, text, text, text, date, date, text, text, integer, integer);

create or replace function public.get_romaneios_page(
  p_search text default null,
  p_status text default null,
  p_order_code text default null,
  p_customer text default null,
  p_shipment_from date default null,
  p_shipment_to date default null,
  p_number_from bigint default null,
  p_number_to bigint default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_nf_number text default null,
  p_return_nf text default null,
  p_sort text default 'number',
  p_sort_dir text default 'desc',
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  total_count bigint,
  id uuid,
  number bigint,
  order_id uuid,
  order_code text,
  customer_name text,
  order_delivery_date date,
  status text,
  shipment_date date,
  carrier text,
  item_count bigint,
  quantity_total numeric,
  weight_total numeric,
  nf_number text,
  return_nf_number text,
  pending_return boolean,
  conference_accepted_at timestamptz,
  emitted_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sort_expr text;
  v_sort_dir  text;
  v_sql       text;
begin
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;

  v_sort_expr := case p_sort
    when 'number'           then 'f.rnumber'
    when 'order_code'       then 'f.ord_code'
    when 'customer'         then 'f.cust'
    when 'status'           then 'f.rstatus'
    when 'shipment_date'    then 'f.ship_date'
    when 'item_count'       then 'f.item_count'
    when 'quantity_total'   then 'f.quantity_total'
    when 'weight_total'     then 'f.weight_total'
    when 'nf_number'        then 'f.nf_number'
    when 'return_nf_number' then 'f.return_nf'
    else 'f.rnumber'
  end;

  v_sql := $q$
    with agg as (
      select ri.romaneio_id as rid,
             count(*)::bigint as item_count,
             coalesce(sum(ri.quantity), 0) as quantity_total,
             case
               when count(*) filter (where oi.unit_weight_kg is null) > 0 then null
               else coalesce(sum(oi.unit_weight_kg * ri.quantity), 0)
             end as weight_total
        from public.romaneio_items ri
        join public.order_items oi on oi.id = ri.order_item_id
       group by ri.romaneio_id
    ),
    pending as (
      select rm.romaneio_id as rid, true as pending_return
        from public.romaneio_materials rm
       where rm.quantity_received is not null
         and rm.quantity_used is not null
         and rm.quantity_received - rm.quantity_used > 0
       group by rm.romaneio_id
    ),
    filtered as (
      select r.id as rid,
             r.number as rnumber,
             r.order_id as ord_id,
             r.status as rstatus,
             r.shipment_date as ship_date,
             r.carrier as carrier_name,
             r.nf_number as nf_number,
             r.return_nf_number as return_nf,
             r.conference_accepted_at as conf_at,
             r.emitted_at as emitted_at,
             r.created_at as created_at,
             o.code as ord_code,
             coalesce(o.customer_name, '') as cust,
             o.delivery_date as order_delivery,
             coalesce(a.item_count, 0)::bigint as item_count,
             coalesce(a.quantity_total, 0) as quantity_total,
             a.weight_total as weight_total,
             coalesce(p.pending_return, false) as pending_return
        from public.romaneios r
        join public.orders o on o.id = r.order_id
        left join agg a on a.rid = r.id
        left join pending p on p.rid = r.id
       where ($1::text is null
              or ($1::text ~ '^[0-9]{1,18}$' and r.number = $1::text::bigint)
              or exists (
                select 1 from public.orders so
                 where so.id = r.order_id
                   and (so.code ilike '%' || $1::text || '%'
                        or coalesce(so.customer_name, '') ilike '%' || $1::text || '%')))
         and ($2::text is null or r.status = $2::text)
         and ($3::text is null or o.code ilike '%' || $3::text || '%')
         and ($4::text is null or coalesce(o.customer_name, '') ilike '%' || $4::text || '%')
         and ($5::date is null or (r.shipment_date is not null and r.shipment_date >= $5::date))
         and ($6::date is null or (r.shipment_date is not null and r.shipment_date <= $6::date))
         and ($7::bigint is null or r.number >= $7::bigint)
         and ($8::bigint is null or r.number <= $8::bigint)
         and ($9::numeric is null or (a.weight_total is not null and a.weight_total >= $9::numeric))
         and ($10::numeric is null or (a.weight_total is not null and a.weight_total <= $10::numeric))
         and ($11::text is null or coalesce(r.nf_number, '') ilike '%' || $11::text || '%')
         and ($12::text is null or coalesce(r.return_nf_number, '') ilike '%' || $12::text || '%')
    )
    select count(*) over() as total_count,
           f.rid as id,
           f.rnumber as number,
           f.ord_id as order_id,
           f.ord_code as order_code,
           f.cust as customer_name,
           f.order_delivery as order_delivery_date,
           f.rstatus as status,
           f.ship_date as shipment_date,
           f.carrier_name as carrier,
           f.item_count as item_count,
           f.quantity_total as quantity_total,
           f.weight_total as weight_total,
           f.nf_number as nf_number,
           f.return_nf as return_nf_number,
           f.pending_return as pending_return,
           f.conf_at as conference_accepted_at,
           f.emitted_at as emitted_at,
           f.created_at as created_at
      from filtered f
     order by $ORDER$
     limit $14 offset $13
  $q$;

  v_sql := replace(
    v_sql,
    '$ORDER$',
    v_sort_expr || ' ' || v_sort_dir || ' nulls last, f.rnumber desc, f.rid asc'
  );

  return query execute v_sql
    using
      nullif(p_search, ''),
      nullif(p_status, ''),
      nullif(p_order_code, ''),
      nullif(p_customer, ''),
      p_shipment_from,
      p_shipment_to,
      p_number_from,
      p_number_to,
      p_weight_min,
      p_weight_max,
      nullif(p_nf_number, ''),
      nullif(p_return_nf, ''),
      greatest(coalesce(p_offset, 0), 0),
      greatest(coalesce(p_limit, 25), 0);
end;
$$;

revoke execute on function public.get_romaneios_page(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text, integer, integer) from anon;
grant execute on function public.get_romaneios_page(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text, integer, integer) to authenticated;

-- -------------------------------------------------------------
-- 2) get_romaneio_summary — contagens dos cartões de resumo com os
--    MESMOS filtros da listagem (espelho do `filtered` acima).
-- -------------------------------------------------------------
create or replace function public.get_romaneio_summary(
  p_search text default null,
  p_status text default null,
  p_order_code text default null,
  p_customer text default null,
  p_shipment_from date default null,
  p_shipment_to date default null,
  p_number_from bigint default null,
  p_number_to bigint default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_nf_number text default null,
  p_return_nf text default null
)
returns table (
  total_count bigint,
  open_count bigint,
  conferred_count bigint,
  confirmed_count bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  -- count(*) sempre devolve 1 linha, mesmo com 0 romaneio.
  return query
    with agg as (
      select ri.romaneio_id as rid,
             case
               when count(*) filter (where oi.unit_weight_kg is null) > 0 then null
               else coalesce(sum(oi.unit_weight_kg * ri.quantity), 0)
             end as weight_total
        from public.romaneio_items ri
        join public.order_items oi on oi.id = ri.order_item_id
       group by ri.romaneio_id
    )
    select count(*) filter (where (p_status is null or r.status = p_status))::bigint,
           count(*) filter (where r.status = 'ABERTO')::bigint,
           count(*) filter (where r.status = 'CONFERIDO')::bigint,
           count(*) filter (where r.status = 'CONFIRMADO')::bigint
      from public.romaneios r
      join public.orders o on o.id = r.order_id
      left join agg a on a.rid = r.id
     where (p_search is null
            or (p_search ~ '^[0-9]{1,18}$' and r.number = p_search::bigint)
            or exists (
              select 1 from public.orders so
               where so.id = r.order_id
                 and (so.code ilike '%' || p_search || '%'
                      or coalesce(so.customer_name, '') ilike '%' || p_search || '%')))
       and (p_order_code is null or o.code ilike '%' || p_order_code || '%')
       and (p_customer is null or coalesce(o.customer_name, '') ilike '%' || p_customer || '%')
       and (p_shipment_from is null or (r.shipment_date is not null and r.shipment_date >= p_shipment_from))
       and (p_shipment_to is null or (r.shipment_date is not null and r.shipment_date <= p_shipment_to))
       and (p_number_from is null or r.number >= p_number_from)
       and (p_number_to is null or r.number <= p_number_to)
       and (p_weight_min is null or (a.weight_total is not null and a.weight_total >= p_weight_min))
       and (p_weight_max is null or (a.weight_total is not null and a.weight_total <= p_weight_max))
       and (p_nf_number is null or coalesce(r.nf_number, '') ilike '%' || p_nf_number || '%')
       and (p_return_nf is null or coalesce(r.return_nf_number, '') ilike '%' || p_return_nf || '%');
end;
$$;

revoke execute on function public.get_romaneio_summary(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text) from anon;
grant execute on function public.get_romaneio_summary(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text) to authenticated;
