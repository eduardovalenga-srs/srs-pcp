-- -------------------------------------------------------------
-- 049) Romaneio — colunas de processos da Fábrica 2 na listagem
--
-- A tela /romaneio ganha UMA coluna por processo do catálogo ativo
-- fora da cadeia da Fábrica 1 (mesma regra da tela F2: MP, KIT,
-- PRÉ-MTG, SOLDA, ACAB, QUALITY, EXP…), com filtro de situação e
-- ordenação por pior situação — como as demais colunas.
--
-- 1) get_romaneios_page: assinatura NOVA (DROP obrigatório — dois
--    parâmetros no fim: p_process_code/p_process_status) e coluna
--    nova `processes` (jsonb): pior situação de CADA processo entre
--    os ITENS DESTA CARGA (romaneio_items), com o KIT lido dos
--    FILHOS (039 — o KIT é etapa do filho; o raiz nasce NAO_APLICAVEL).
--    NAO_APLICAVEL fica de FORA do rank (max null => o jsonb grava
--    'NAO_APLICAVEL', símbolo "—" na tela); processo sem nenhuma
--    linha nos itens não entra no jsonb (também "—").
--      * filtro      — $15/$16: par ÚNICO processo+situação (mesma
--                      regra do backend da Fábrica 2). Chave ausente
--                      não casa com nenhum status;
--      * ordenação   — p_sort aceita código de processo (validado em
--                      `processes` + quote_literal, padrão 041):
--                      pior situação do processo, nulls last.
--
-- 2) get_romaneio_summary: MESMOS parâmetros e MESMO filtro — o
--    cartão "Total" continua batendo com a paginação da lista
--    (os dois blocos mudam juntos, lema da 047).
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) get_romaneios_page — drop da assinatura da 047 e recriação
--    com as colunas/filtro/ordenação de processo.
-- -------------------------------------------------------------
drop function if exists public.get_romaneios_page(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text, integer, integer);

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
  p_limit integer default 25,
  -- 049: par filtro de coluna de processo (um por vez).
  p_process_code text default null,
  p_process_status text default null
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
  created_at timestamptz,
  -- 049: pior situação por processo sobre os itens da carga.
  processes jsonb
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
    else null
  end;

  -- 049: código de processo do catálogo ordena pela pior situação
  -- (1 = CONCLUIDO … 3 = NAO_APLICAVEL; sem linha => nulls last).
  -- Só código existente em `processes` passa — quote_literal blind a
  -- interpolação, padrão da get_production_rows_by_order (041).
  if v_sort_expr is null then
    if exists (select 1 from public.processes pr where pr.code = p_sort) then
      v_sort_expr := '(case (f.proc_json ->> ' || quote_literal(p_sort) || ')
                           when ''CONCLUIDO'' then 1
                           when ''NAO_INICIADO'' then 2
                           when ''NAO_APLICAVEL'' then 3
                         end)';
    else
      v_sort_expr := 'f.rnumber';
    end if;
  end if;

  v_sql := $q$
    with proc_rows as (
      -- Processos dos ITENS DA CARGA (raiz — romaneio_items).
      select ri.romaneio_id as rid,
             pr.code as pcode,
             pp.status as pstatus
        from public.romaneio_items ri
        join public.production_processes pp on pp.order_item_id = ri.order_item_id
        join public.processes pr on pr.id = pp.process_id
    ),
    proc_agg as (
      -- Pior situação entre os APLICÁVEIS: 1 = CONCLUIDO, 2 =
      -- NAO_INICIADO; NAO_APLICAVEL fica de fora (max null => nada
      -- aplicável => o jsonb grava 'NAO_APLICAVEL', célula "—").
      select s.rid,
             s.pcode,
             max(case s.pstatus
                   when 'CONCLUIDO' then 1
                   when 'NAO_INICIADO' then 2
                 end) as worst_rank
        from proc_rows s
       group by s.rid, s.pcode
    ),
    proc_json as (
      select a.rid,
             coalesce(
               jsonb_object_agg(
                 a.pcode,
                 case a.worst_rank
                   when 1 then 'CONCLUIDO'
                   when 2 then 'NAO_INICIADO'
                   else 'NAO_APLICAVEL'
                 end
                 order by a.pcode
               ),
               '{}'::jsonb
             ) as processes
        from proc_agg a
       group by a.rid
    ),
    kit_children as (
      -- 039: o KIT é etapa do ITEM FILHO — agregado dos filhos do
      -- item da carga (o KIT do raiz nasce NAO_APLICAVEL).
      select ri.romaneio_id as rid,
             pp.status as pstatus
        from public.romaneio_items ri
        join public.order_items oi on oi.parent_order_item_id = ri.order_item_id
        join public.production_processes pp on pp.order_item_id = oi.id
        join public.processes pr on pr.id = pp.process_id and pr.code = 'KIT'
    ),
    kit_agg as (
      select k.rid,
             max(case k.pstatus
                   when 'CONCLUIDO' then 1
                   when 'NAO_INICIADO' then 2
                 end) as worst_rank,
             count(*) filter (where k.pstatus <> 'NAO_APLICAVEL') as applicable
        from kit_children k
       group by k.rid
    ),
    proc_full as (
      -- Processos do raiz COM o KIT sobrescrito pelo agregado dos
      -- filhos quando há filho com KIT aplicável (padrão 039).
      select coalesce(p.rid, ka.rid) as rid,
             case
               when coalesce(ka.applicable, 0) > 0 then
                 coalesce(p.processes, '{}'::jsonb) || jsonb_build_object(
                   'KIT',
                   case ka.worst_rank
                     when 1 then 'CONCLUIDO'
                     when 2 then 'NAO_INICIADO'
                     else 'NAO_APLICAVEL'
                   end
                 )
               else coalesce(p.processes, '{}'::jsonb)
             end as processes
        from proc_json p
        full outer join kit_agg ka on ka.rid = p.rid
    ),
    agg as (
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
             coalesce(p.pending_return, false) as pending_return,
             coalesce(pf.processes, '{}'::jsonb) as proc_json
        from public.romaneios r
        join public.orders o on o.id = r.order_id
        left join agg a on a.rid = r.id
        left join pending p on p.rid = r.id
        left join proc_full pf on pf.rid = r.id
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
         -- 049: par processo+situação; chave ausente não casa (célula "—").
         and ($15::text is null or $16::text is null
              or (coalesce(pf.processes, '{}'::jsonb) ->> ($15::text)) = $16::text)
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
           f.created_at as created_at,
           f.proc_json as processes
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
      greatest(coalesce(p_limit, 25), 0),
      nullif(p_process_code, ''),
      nullif(p_process_status, '');
end;
$$;

revoke execute on function public.get_romaneios_page(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text, integer, integer, text, text) from anon;
grant execute on function public.get_romaneios_page(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text, integer, integer, text, text) to authenticated;

-- -------------------------------------------------------------
-- 2) get_romaneio_summary — drop da assinatura da 047 e recriação
--    com o MESMO filtro de processo (espelho do `filtered` acima).
-- -------------------------------------------------------------
drop function if exists public.get_romaneio_summary(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text);

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
  p_return_nf text default null,
  -- 049: par filtro de coluna de processo (um por vez).
  p_process_code text default null,
  p_process_status text default null
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
    ),
    -- 049: MESMO agregado de processos da get_romaneios_page (itens
    -- da carga, KIT dos filhos) — só para aplicar o mesmo filtro.
    proc_rows as (
      select ri.romaneio_id as rid,
             pr.code as pcode,
             pp.status as pstatus
        from public.romaneio_items ri
        join public.production_processes pp on pp.order_item_id = ri.order_item_id
        join public.processes pr on pr.id = pp.process_id
    ),
    proc_agg as (
      select s.rid,
             s.pcode,
             max(case s.pstatus
                   when 'CONCLUIDO' then 1
                   when 'NAO_INICIADO' then 2
                 end) as worst_rank
        from proc_rows s
       group by s.rid, s.pcode
    ),
    proc_json as (
      select a.rid,
             coalesce(
               jsonb_object_agg(
                 a.pcode,
                 case a.worst_rank
                   when 1 then 'CONCLUIDO'
                   when 2 then 'NAO_INICIADO'
                   else 'NAO_APLICAVEL'
                 end
                 order by a.pcode
               ),
               '{}'::jsonb
             ) as processes
        from proc_agg a
       group by a.rid
    ),
    kit_children as (
      select ri.romaneio_id as rid,
             pp.status as pstatus
        from public.romaneio_items ri
        join public.order_items oi on oi.parent_order_item_id = ri.order_item_id
        join public.production_processes pp on pp.order_item_id = oi.id
        join public.processes pr on pr.id = pp.process_id and pr.code = 'KIT'
    ),
    kit_agg as (
      select k.rid,
             max(case k.pstatus
                   when 'CONCLUIDO' then 1
                   when 'NAO_INICIADO' then 2
                 end) as worst_rank,
             count(*) filter (where k.pstatus <> 'NAO_APLICAVEL') as applicable
        from kit_children k
       group by k.rid
    ),
    proc_full as (
      select coalesce(p.rid, ka.rid) as rid,
             case
               when coalesce(ka.applicable, 0) > 0 then
                 coalesce(p.processes, '{}'::jsonb) || jsonb_build_object(
                   'KIT',
                   case ka.worst_rank
                     when 1 then 'CONCLUIDO'
                     when 2 then 'NAO_INICIADO'
                     else 'NAO_APLICAVEL'
                   end
                 )
               else coalesce(p.processes, '{}'::jsonb)
             end as processes
        from proc_json p
        full outer join kit_agg ka on ka.rid = p.rid
    )
    select count(*) filter (where (p_status is null or r.status = p_status))::bigint,
           count(*) filter (where r.status = 'ABERTO')::bigint,
           count(*) filter (where r.status = 'CONFERIDO')::bigint,
           count(*) filter (where r.status = 'CONFIRMADO')::bigint
      from public.romaneios r
      join public.orders o on o.id = r.order_id
      left join agg a on a.rid = r.id
      left join proc_full pf on pf.rid = r.id
     where (p_search is null
            or (p_search ~ '^[0-9]{1,18}$' and p_search::bigint = r.number)
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
       and (p_return_nf is null or coalesce(r.return_nf_number, '') ilike '%' || p_return_nf || '%')
       -- 049: par processo+situação — mesmo filtro da lista.
       and (p_process_code is null or p_process_status is null
            or (coalesce(pf.processes, '{}'::jsonb) ->> p_process_code) = p_process_status);
end;
$$;

revoke execute on function public.get_romaneio_summary(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text) from anon;
grant execute on function public.get_romaneio_summary(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text) to authenticated;
