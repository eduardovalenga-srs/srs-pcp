-- -------------------------------------------------------------
-- 066) Fábrica 1 — peso unitário do grupo = MAIOR entre os membros
--
-- A célula "Peso unitário" da Fábrica 1 passa a exibir o MAIOR valor
-- entre os membros do grupo em vez de exigir que todos coincidam
-- (senão "—") — mesma regra do frontend (child-item-groups.ts, 065).
-- Ordenação por unit_weight_kg e as faixas p_weight_unit_min/max das
-- 4 RPCs passam a valer sobre o valor EXIBIDO (max(unit_w)), com
-- guarda de nulo (grupo sem peso nenhum continua fora das faixas).
--
-- Corpos copiados das definições vigentes:
--   * get_child_item_groups ......... 054 (sort + HAVING $19/$20)
--   * get_child_items_totals ........ 054 (HAVING nomeado)
--   * get_child_item_groups_page .... 064 (sort + HAVING $19/$20)
--   * get_child_items_kit_overdue_totals 063 (filtro nomeado)
--
-- Nenhuma assinatura muda — PostgREST continua chamando pelas mesmas
-- posições/nomes.
-- -------------------------------------------------------------

create or replace function public.get_child_item_groups(
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
  p_limit integer default 25,
  -- 038: seq por igualdade + faixas sobre os AGREGADOS do grupo
  p_seq integer default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_weight_unit_min numeric default null,
  p_weight_unit_max numeric default null,
  -- 043: ordenação por coluna (whitelist espelhada no frontend)
  p_sort text default 'seq',
  p_sort_dir text default 'asc'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_sort_expr text;
  v_sort_dir  text;
  v_order     text;
  v_sql       text;
  v_result    jsonb;
begin
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sort_expr := case p_sort
    -- seq desc só inverte o desempate (a ordem do planejamento é
    -- sempre crescente) — mesma convenção da gestão/F2.
    when 'seq'            then 'g.seq_min asc nulls last, g.delivery_key'
    when 'order_code'     then 'g.ord_code'
    when 'customer'       then 'g.cust'
    when 'child_item'     then 'g.key'
    when 'materials'      then 'g.mat_desc'
    when 'quantity'       then 'g.qty'
    when 'unit_weight_kg' then 'g.uw_max'
    when 'weight_total'   then 'g.weight'
    when 'delivery_date'  then 'g.delivery_key'
    else null
  end;

  if v_sort_expr is null then
    if p_sort = 'MP' then
      -- Coluna MP: status HERDADO do item pai (pior rank entre os pais
      -- distintos do grupo; sem pai com MP => 3, que vai por último).
      v_sort_expr :=
        '(select coalesce(gp.worst_rank, 3) '
        || 'from group_parent_mp gp '
        || 'where gp.ord_id = g.order_id and gp.gkey = g.key limit 1)';
    elsif exists (select 1 from public.processes pr where pr.code = p_sort) then
      v_sort_expr :=
        '(select coalesce(gr.worst_rank, 3) '
        || 'from group_proc_rank gr '
        || 'where gr.ord_id = g.order_id and gr.gkey = g.key '
        || 'and gr.pcode = ' || quote_literal(p_sort) || ' limit 1)';
    else
      v_sort_expr := null;
    end if;
  end if;

  v_order := case
    when v_sort_expr is null then 'g.seq_min nulls last, g.delivery_key nulls last, g.key'
    else v_sort_expr || ' ' || v_sort_dir || ' nulls last, g.ord_code asc, g.key asc'
  end;

  v_sql := $q$
    with
    -- 054: SALDO do PAI raiz (Σ dos romaneios CONFIRMADOS) — a fração
    -- que escala os FILHOS desta tela (pai fora do resultado ⇒ 1).
    parent_balance as (
      select
        oi.id as item_id,
        oi.quantity as planned,
        greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as qty
      from public.order_items oi
      left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
      where oi.parent_order_item_id is null
    ),
    filtered as (
      select oi.id, oi.order_id, oi.parent_item, oi.parent_order_item_id,
             oi.description, oi.delivery_date, oi.seq,
             -- 054: saldo do filho = planejado × fração pendente do pai.
             (case when pb.planned > 0
                   then oi.quantity * pb.qty / pb.planned
                   else oi.quantity end) as quantity,
             oi.unit_weight_kg as unit_w,
             -- 023: peso TOTAL derivado (qtd × peso unit.) — escalado pela
             -- MESMA fração pendente do pai (baixa proporcional, 054).
             (case when pb.planned > 0
                   then oi.total_weight_kg * pb.qty / pb.planned
                   else oi.total_weight_kg end) as total_w,
             o.delivery_date as order_delivery_date,
             o.code as ord_code,
             coalesce(o.customer_name, '') as cust,
             -- 043: menor descrição de MP do membro (coluna Matérias-primas
             -- ordena pela primeira do grupo).
             coalesce((
               select min(btrim(m.description))
                 from public.order_item_materials m
                where m.order_item_id = oi.id
             ), '') as mat_desc
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join parent_balance pb on pb.item_id = oi.parent_order_item_id
      where oi.parent_order_item_id is not null
        and ($1::text is null
             or oi.description ilike '%' || $1::text || '%'
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
               where pp.order_item_id = oi.id
                 and pp.process_id = $10::uuid
                 and ($11::text is null or pp.status = $11::text)))
        and ($10::uuid is not null or $11::text is null or exists (
              select 1 from public.production_processes pp
               where pp.order_item_id = oi.id
                 and pp.status = $11::text))
    ),
    grouped as (
      select order_id,
             coalesce(nullif(btrim(parent_item), ''), btrim(description)) as key,
             min(coalesce(delivery_date, order_delivery_date)) as delivery_key,
             min(seq) as seq_min,
             min(ord_code) as ord_code,
             min(cust) as cust,
             min(mat_desc) as mat_desc,
             -- 038: agregados do grupo para os filtros do HAVING.
             coalesce(sum(coalesce(quantity, 0)), 0) as qty,
             coalesce(sum(coalesce(total_w, 0)), 0) as weight,
             min(unit_w) as uw_min,
             max(unit_w) as uw_max,
             array_agg(
               id order by coalesce(nullif(btrim(parent_item), ''), btrim(description)), id
             ) as item_ids
        from filtered
       group by order_id, key
       -- 038: filtros PÓS-agrupamento — a faixa de Qtd./Peso vale sobre o
       -- grupo (Σ dos membros), como a coluna exibe; o peso unitário do
       -- grupo é o MAIOR entre os membros (065) e a faixa vale sobre ele.
       having ($14::integer is null or min(seq) = $14::integer)
          and ($15::numeric is null or coalesce(sum(coalesce(quantity, 0)), 0) >= $15::numeric)
          and ($16::numeric is null or coalesce(sum(coalesce(quantity, 0)), 0) <= $16::numeric)
          and ($17::numeric is null or coalesce(sum(coalesce(total_w, 0)), 0) >= $17::numeric)
          and ($18::numeric is null or coalesce(sum(coalesce(total_w, 0)), 0) <= $18::numeric)
          and ($19::numeric is null
               or (max(unit_w) is not null and max(unit_w) >= $19::numeric))
          and ($20::numeric is null
               or (max(unit_w) is not null and max(unit_w) <= $20::numeric))
    ),
    -- 043: rank do processo entre os MEMBROS do grupo — a mesma
    -- agregação da célula (aggregateGroupStatus): CONCLUIDO só quando
    -- todos os aplicáveis concluíram; NAO_APLICAVEL só quando nenhum
    -- se aplica; no meio, NAO_INICIADO.
    proc_ranks as (
      select f.order_id as ord_id,
             coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as gkey,
             pr.code as pcode,
             case pp.status
               when 'CONCLUIDO' then 1
               when 'NAO_INICIADO' then 2
               else 3
             end as rank
        from filtered f
        join public.production_processes pp on pp.order_item_id = f.id
        join public.processes pr on pr.id = pp.process_id
    ),
    group_proc_rank as (
      select r.ord_id, r.gkey, r.pcode,
             case
               when count(*) filter (where r.rank = 2) > 0 then 2
               when count(*) filter (where r.rank = 1) > 0 then 1
               else 3
             end as worst_rank
        from proc_ranks r
       group by r.ord_id, r.gkey, r.pcode
    ),
    -- 043: MP herdado do PAI — pior rank entre os pais distintos do
    -- grupo (parentProcessStatuses agregado no frontend).
    parent_mp_rank as (
      select f.order_id as ord_id,
             coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as gkey,
             case pp.status
               when 'CONCLUIDO' then 1
               when 'NAO_INICIADO' then 2
               else 3
             end as rank
        from filtered f
        join public.production_processes pp on pp.order_item_id = f.parent_order_item_id
        join public.processes pr on pr.id = pp.process_id and pr.code = 'MP'
       where f.parent_order_item_id is not null
    ),
    group_parent_mp as (
      select p.ord_id, p.gkey,
             case
               when count(*) filter (where p.rank = 2) > 0 then 2
               when count(*) filter (where p.rank = 1) > 0 then 1
               else 3
             end as worst_rank
        from parent_mp_rank p
       group by p.ord_id, p.gkey
    ),
    page as (
      select * from grouped g
       order by $ORDER$
       limit greatest(coalesce($13::integer, 25), 0)
       offset greatest(coalesce($12::integer, 0), 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from grouped),
      'groups', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'orderId', g.order_id,
            'key', g.key,
            'itemIds', g.item_ids
          ) order by $ORDER$
        ),
        '[]'::jsonb
      )
    )
    from page g
  $q$;

  v_sql := replace(v_sql, '$ORDER$', v_order);

  execute v_sql
    into v_result
    using
      p_search,
      p_order_code,
      p_customer,
      p_child_item,
      p_description,
      p_material,
      p_parent_ids,
      p_delivery_from,
      p_delivery_to,
      p_process_id,
      p_process_status,
      greatest(coalesce(p_offset, 0), 0),
      greatest(coalesce(p_limit, 25), 0),
      p_seq,
      p_qty_min,
      p_qty_max,
      p_weight_min,
      p_weight_max,
      p_weight_unit_min,
      p_weight_unit_max;

  return v_result;
end;
$$;

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
  p_process_status text default null,
  -- 038: mesmos filtros de grupo da get_child_item_groups
  p_seq integer default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_weight_unit_min numeric default null,
  p_weight_unit_max numeric default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_seq is null and p_qty_min is null and p_qty_max is null
     and p_weight_min is null and p_weight_max is null
     and p_weight_unit_min is null and p_weight_unit_max is null then
    -- Caminho rápido (sem filtro de grupo): janela idêntica à da 035 —
    -- uma única passada sobre o conjunto filtrado, sem agrupar por OF.
    with
    -- 054: SALDO do PAI raiz (Σ dos romaneios CONFIRMADOS) — a fração
    -- que escala os FILHOS (pai fora do resultado ⇒ 1).
    parent_balance as (
      select
        oi.id as item_id,
        oi.quantity as planned,
        greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as qty
      from public.order_items oi
      left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
      where oi.parent_order_item_id is null
    ),
    filtered as (
      select nullif(btrim(oi.family), '') as family,
             -- 054: saldo do filho = planejado × fração pendente do pai.
             coalesce(case when pb.planned > 0
                           then oi.quantity * pb.qty / pb.planned
                           else oi.quantity end, 0) as qty,
             coalesce(case when pb.planned > 0
                           then oi.total_weight_kg * pb.qty / pb.planned
                           else oi.total_weight_kg end, 0) as weight
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        left join parent_balance pb on pb.item_id = oi.parent_order_item_id
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
      -- janela de total/qtyTotal/weightTotal. Família vazia vira null e a
      -- UI exibe "—"; ordenado por qtd. desc (null por último no desempate).
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
    ) into v_result from filtered;
  else
    -- Com filtro de grupo: agrupa por (OF, código do filho) com o MESMO
    -- HAVING da get_child_item_groups — os totais cobrem os mesmos grupos
    -- da lista filtrada.
    with
    -- 054: SALDO do PAI raiz (Σ dos romaneios CONFIRMADOS) — a fração
    -- que escala os FILHOS (pai fora do resultado ⇒ 1).
    parent_balance as (
      select
        oi.id as item_id,
        oi.quantity as planned,
        greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as qty
      from public.order_items oi
      left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
      where oi.parent_order_item_id is null
    ),
    filtered as (
      select oi.order_id as ord_id,
             coalesce(nullif(btrim(oi.parent_item), ''), btrim(oi.description)) as key,
             nullif(btrim(oi.family), '') as family,
             oi.seq as seq,
             -- 054: saldo do filho = planejado × fração pendente do pai.
             coalesce(case when pb.planned > 0
                           then oi.quantity * pb.qty / pb.planned
                           else oi.quantity end, 0) as qty,
             coalesce(case when pb.planned > 0
                           then oi.total_weight_kg * pb.qty / pb.planned
                           else oi.total_weight_kg end, 0) as weight,
             oi.unit_weight_kg as unit_w
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        left join parent_balance pb on pb.item_id = oi.parent_order_item_id
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
    ),
    grouped as (
      select ord_id,
             key,
             sum(qty) as qty,
             sum(weight) as weight,
             min(unit_w) as uw_min,
             max(unit_w) as uw_max,
             count(*) as members
        from filtered
       group by ord_id, key
       having (p_seq is null or min(seq) = p_seq)
          and (p_qty_min is null or sum(qty) >= p_qty_min)
          and (p_qty_max is null or sum(qty) <= p_qty_max)
          and (p_weight_min is null or sum(weight) >= p_weight_min)
          and (p_weight_max is null or sum(weight) <= p_weight_max)
          and (p_weight_unit_min is null
               or (max(unit_w) is not null and max(unit_w) >= p_weight_unit_min))
          and (p_weight_unit_max is null
               or (max(unit_w) is not null and max(unit_w) <= p_weight_unit_max))
    )
    select jsonb_build_object(
      'total', coalesce(sum(g.members), 0),
      'qtyTotal', coalesce(sum(g.qty), 0),
      'weightTotal', coalesce(sum(g.weight), 0),
      -- 035: quebra por família (TP) — continua item a item, mas só os
      -- itens dos GRUPOS sobreviventes entram na soma.
      'families', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'family', f.family,
              'qty', f.qty,
              'weight', f.weight
            )
            order by f.qty desc, f.family asc
          )
          from (
            select fi.family as family,
                   sum(fi.qty) as qty,
                   sum(fi.weight) as weight
              from filtered fi
              join grouped g2 on g2.ord_id = fi.ord_id and g2.key = fi.key
             group by fi.family
          ) f
        ),
        '[]'::jsonb
      )
    ) into v_result from grouped g;
  end if;

  return v_result;
end;
$$;

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
    when 'unit_weight_kg' then 'g.uw_max'
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
    candidates as materialized (
      select oi.id, oi.order_id, oi.parent_item, oi.parent_order_item_id,
             oi.description, oi.delivery_date, oi.seq,
             oi.quantity as planned_quantity,
             oi.unit_weight_kg as unit_w,
             oi.total_weight_kg as planned_total_w,
             o.delivery_date as order_delivery_date,
             o.code as ord_code,
             coalesce(o.customer_name, '') as cust,
             coalesce((select min(btrim(m.description))
                         from public.order_item_materials m
                        where m.order_item_id = oi.id), '') as mat_desc
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
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
    candidate_parents as materialized (
      select distinct parent_order_item_id as parent_id from candidates
    ),
    parent_balance as materialized (
      select parent.id as item_id,
             parent.quantity as planned,
             greatest(coalesce(parent.quantity, 0) - coalesce(shipped.quantity, 0), 0) as qty
        from candidate_parents cp
        join public.order_items parent
          on parent.id = cp.parent_id
         and parent.parent_order_item_id is null
        left join lateral (
          select coalesce(sum(ri.quantity), 0)::numeric as quantity
            from public.romaneio_items ri
            join public.romaneios r on r.id = ri.romaneio_id and r.status = 'CONFIRMADO'
           where ri.order_item_id = parent.id
        ) shipped on true
    ),
    filtered as materialized (
      select c.id, c.order_id, c.parent_item, c.parent_order_item_id,
             c.description, c.delivery_date, c.seq,
             case when pb.planned > 0 then c.planned_quantity * pb.qty / pb.planned
                  else c.planned_quantity end as quantity,
             c.unit_w,
             case when pb.planned > 0 then c.planned_total_w * pb.qty / pb.planned
                  else c.planned_total_w end as total_w,
             c.order_delivery_date, c.ord_code, c.cust, c.mat_desc
        from candidates c
        left join parent_balance pb on pb.item_id = c.parent_order_item_id
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
     kit_catalog as materialized (
       select id, code, display_order
         from public.processes
        where code = 'KIT' and active
     ),
     kit_total_duration as materialized (
       select kit.id as kit_process_id,
              sum(case when scheduled.duration_days is null or scheduled.duration_days < 1
                       then 1 else floor(scheduled.duration_days)::integer end)::integer as business_days
         from kit_catalog kit
         join public.processes scheduled
           on scheduled.active
          and (scheduled.display_order > kit.display_order
               or (scheduled.display_order = kit.display_order and scheduled.code >= kit.code))
        group by kit.id
     ),
     group_kit_skipped_duration as materialized (
       select status.ord_id,
              status.gkey,
              sum(case when scheduled.duration_days is null or scheduled.duration_days < 1
                       then 1 else floor(scheduled.duration_days)::integer end)::integer as skipped_days
         from group_process_status status
         join public.processes scheduled
           on scheduled.code = status.pcode and scheduled.active
         join kit_catalog kit
           on (scheduled.display_order > kit.display_order
               or (scheduled.display_order = kit.display_order and scheduled.code >= kit.code))
        where status.status = 'NAO_APLICAVEL'
        group by status.ord_id, status.gkey
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
         and ($19::numeric is null or (max(unit_w) is not null
                                         and max(unit_w) >= $19::numeric))
         and ($20::numeric is null or (max(unit_w) is not null
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
     group_kit_schedule as (
       select g.*,
              kit_catalog.id as kit_process_id,
              kit.status as kit_status,
              greatest(
                coalesce(kit_total_duration.business_days, 0) - coalesce(kit_skipped.skipped_days, 0),
                0
              ) as kit_business_days
         from grouped g
         left join kit_catalog on true
         left join group_process_status kit
           on kit.ord_id = g.order_id and kit.gkey = g.gkey and kit.pcode = 'KIT'
         left join kit_total_duration
           on kit_total_duration.kit_process_id = kit_catalog.id
         left join group_kit_skipped_duration kit_skipped
           on kit_skipped.ord_id = g.order_id and kit_skipped.gkey = g.gkey
     ),
     due_groups as (
       select g.*,
              case
                when g.delivery_key is null or g.kit_process_id is null or g.kit_status is null
                  or g.kit_status in ('CONCLUIDO', 'NAO_APLICAVEL') then false
                else public.sub_business_days(
                       g.delivery_key,
                       g.kit_business_days
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
         from group_kit_schedule g
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

create or replace function public.get_child_items_kit_overdue_totals(
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
  p_seq integer default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  p_weight_unit_min numeric default null,
  p_weight_unit_max numeric default null,
  p_today date default current_date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  candidates as materialized (
    select oi.id,
           oi.order_id,
           oi.parent_order_item_id,
           oi.parent_item,
           oi.description,
           oi.delivery_date,
           oi.seq,
           oi.quantity as planned_quantity,
           oi.unit_weight_kg as unit_weight,
           oi.total_weight_kg as planned_weight,
           o.delivery_date as order_delivery_date
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
             select 1
               from public.order_item_materials m
              where m.order_item_id = oi.id
                and m.description ilike '%' || p_material || '%'))
       and (p_parent_ids is null or oi.parent_order_item_id = any (p_parent_ids))
       and (p_delivery_from is null or oi.delivery_date >= p_delivery_from)
       and (p_delivery_to is null or oi.delivery_date <= p_delivery_to)
       and (p_process_id is null or exists (
             select 1
               from public.production_processes pp
              where pp.order_item_id = oi.id
                and pp.process_id = p_process_id
                and (p_process_status is null or pp.status = p_process_status)))
       and (p_process_id is not null or p_process_status is null or exists (
             select 1
               from public.production_processes pp
              where pp.order_item_id = oi.id
                and pp.status = p_process_status))
  ),
  candidate_parents as materialized (
    select distinct parent_order_item_id as parent_id
      from candidates
  ),
  parent_balance as materialized (
    select parent.id as item_id,
           parent.quantity as planned,
           greatest(coalesce(parent.quantity, 0) - coalesce(shipped.quantity, 0), 0) as pending
      from candidate_parents cp
      join public.order_items parent
        on parent.id = cp.parent_id
       and parent.parent_order_item_id is null
      left join lateral (
        select coalesce(sum(ri.quantity), 0)::numeric as quantity
          from public.romaneio_items ri
          join public.romaneios r
            on r.id = ri.romaneio_id
           and r.status = 'CONFIRMADO'
         where ri.order_item_id = parent.id
      ) shipped on true
  ),
  filtered as materialized (
    select c.id,
           c.order_id,
           c.parent_item,
           c.description,
           c.delivery_date,
           c.seq,
           case when pb.planned > 0
                then c.planned_quantity * pb.pending / pb.planned
                else c.planned_quantity end as quantity,
           c.unit_weight,
           case when pb.planned > 0
                then c.planned_weight * pb.pending / pb.planned
                else c.planned_weight end as total_weight,
           coalesce(c.delivery_date, c.order_delivery_date) as effective_delivery_date
      from candidates c
      left join parent_balance pb on pb.item_id = c.parent_order_item_id
  ),
  grouped_metrics as materialized (
    select f.order_id,
           coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as group_key,
           min(f.effective_delivery_date) as delivery_date,
           min(f.seq) as seq_min,
           coalesce(sum(coalesce(f.quantity, 0)), 0) as quantity,
           coalesce(sum(coalesce(f.total_weight, 0)), 0) as total_weight,
           min(f.unit_weight) as unit_weight_min,
           max(f.unit_weight) as unit_weight_max
      from filtered f
      group by f.order_id,
               coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description))
  ),
  kit_catalog as materialized (
    select id, code, display_order
      from public.processes
     where code = 'KIT'
       and active
  ),
  kit_total_duration as materialized (
    select kit.id as kit_process_id,
           sum(case when scheduled.duration_days is null or scheduled.duration_days < 1
                    then 1 else floor(scheduled.duration_days)::integer end)::integer as business_days
      from kit_catalog kit
      join public.processes scheduled
        on scheduled.active
       and (scheduled.display_order > kit.display_order
            or (scheduled.display_order = kit.display_order and scheduled.code >= kit.code))
     group by kit.id
  ),
  group_process_status as materialized (
    select f.order_id,
            coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)) as group_key,
            pr.code,
            pr.duration_days,
            case
             when count(*) filter (where pp.status <> 'NAO_APLICAVEL') = 0
               then 'NAO_APLICAVEL'
             when count(*) filter (where pp.status = 'CONCLUIDO') =
                  count(*) filter (where pp.status <> 'NAO_APLICAVEL')
               then 'CONCLUIDO'
             else 'NAO_INICIADO'
           end as status
      from filtered f
      join public.production_processes pp on pp.order_item_id = f.id
      join public.processes pr on pr.id = pp.process_id and pr.active
      join kit_catalog kit
        on (pr.display_order > kit.display_order
            or (pr.display_order = kit.display_order and pr.code >= kit.code))
      group by f.order_id,
               coalesce(nullif(btrim(f.parent_item), ''), btrim(f.description)),
               pr.code,
               pr.duration_days
   ),
  grouped_with_status as materialized (
    select rows.order_id,
           rows.group_key,
           min(rows.delivery_date) filter (where rows.is_metrics) as delivery_date,
           min(rows.seq_min) filter (where rows.is_metrics) as seq_min,
           coalesce(sum(rows.quantity), 0) as quantity,
           coalesce(sum(rows.total_weight), 0) as total_weight,
           min(rows.unit_weight_min) filter (where rows.is_metrics) as unit_weight_min,
           max(rows.unit_weight_max) filter (where rows.is_metrics) as unit_weight_max,
           max(rows.process_status) filter (where rows.process_code = 'KIT') as kit_status,
           coalesce(sum(case when rows.process_status = 'NAO_APLICAVEL'
                             then rows.process_duration
                             else 0 end), 0)::integer as skipped_days
      from (
        select g.order_id, g.group_key, g.delivery_date, g.seq_min,
               g.quantity, g.total_weight, g.unit_weight_min, g.unit_weight_max,
               null::text as process_code, null::text as process_status,
               null::integer as process_duration, true as is_metrics
          from grouped_metrics g
        union all
        select s.order_id, s.group_key, null::date, null::integer,
               0::numeric, 0::numeric, null::numeric, null::numeric,
               s.code, s.status,
               case when s.duration_days is null or s.duration_days < 1
                    then 1 else floor(s.duration_days)::integer end,
               false
          from group_process_status s
      ) rows
     group by rows.order_id, rows.group_key
  ),
  grouped as materialized (
    select g.*
      from grouped_with_status g
     where (p_seq is null or g.seq_min = p_seq)
       and (p_qty_min is null or g.quantity >= p_qty_min)
       and (p_qty_max is null or g.quantity <= p_qty_max)
       and (p_weight_min is null or g.total_weight >= p_weight_min)
       and (p_weight_max is null or g.total_weight <= p_weight_max)
       and (p_weight_unit_min is null
            or (g.unit_weight_max is not null
                and g.unit_weight_max >= p_weight_unit_min))
       and (p_weight_unit_max is null
            or (g.unit_weight_max is not null
                and g.unit_weight_max <= p_weight_unit_max))
  ),
  group_kit_schedule as materialized (
    select g.order_id,
           g.group_key,
           g.quantity,
           g.total_weight,
           g.delivery_date,
           kit_catalog.id as kit_process_id,
           g.kit_status,
           greatest(coalesce(total_duration.business_days, 0) - g.skipped_days, 0) as business_days
      from grouped g
      cross join kit_catalog
      left join kit_total_duration total_duration
        on total_duration.kit_process_id = kit_catalog.id
  ),
  overdue as (
    select g.*
      from group_kit_schedule g
     where g.delivery_date is not null
       and g.kit_process_id is not null
       and g.kit_status is not null
       and g.kit_status not in ('CONCLUIDO', 'NAO_APLICAVEL')
       and public.sub_business_days(g.delivery_date, g.business_days) < coalesce(p_today, current_date)
  )
  select jsonb_build_object(
    'records', count(*),
    'qty', coalesce(sum(quantity), 0),
    'weight', coalesce(sum(total_weight), 0)
  )
    from overdue;
$$;
