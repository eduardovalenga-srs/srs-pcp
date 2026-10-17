-- -------------------------------------------------------------
-- 038) Filtros por coluna em todas as telas + unicidade de seq por OF
--
-- Fecha o pacote de filtros por coluna (desktop) das quatro listas e
-- endurece a sequência de fabricação (036):
--
--  1) Seq. exclusivo por OF: mesmo número pode se repetir DENTRO da
--     mesma OF (o grupo/agrupamento usa o menor), mas NUNCA em outra
--     OF — trigger BEFORE em order_items (insert ou update of seq)
--     recusa com mensagem pt-BR. A app grava por item (F2), por
--     grupo de membros (F1) e por OF inteira (gestão); o trigger
--     compara apenas contra itens de OUTRAS OFs, então os três
--     caminhos seguem funcionando (mesma OF pode regravar o número).
--     Índice parcial em seq apoia o lookup do trigger, o filtro por
--     igualdade e a ordenação default `seq nulls last`.
--
--  2) Índice trgm na coluna OP (Fábrica 2, filtro "contém") —
--     mesmo guard de pg_trgm da 023 (PGlite dos testes não tem a
--     extensão; sem ela a busca cai em seq scan e funciona).
--
--  3) get_child_item_groups (redef. da 036) ganha p_seq (igualdade
--     sobre o MENOR seq do grupo) e faixas sobre os AGREGADOS do
--     grupo: p_qty_min/max (Σ dos membros), p_weight_min/max (Σ do
--     peso derivado) e p_weight_unit_min/max (peso unitário EXIBIDO —
--     só existe quando todos os membros coincidem, senão "—"). As
--     faixas entram no HAVING do `grouped`, então a paginação e o
--     count(*) já veem só os grupos sobreviventes. Assinatura muda
--     (13 → 20 params) => DROP + recriação (padrão 017/018/022/035/036).
--
--  4) get_child_items_totals (redef. da 035) ganha os MESMOS 7 params
--     com a MESMA semântica de grupo — os totais do card continuam
--     casando com a lista filtrada. O body passa a agrupar por
--     (order_id, key) antes de somar; sem filtro de grupo ativo o
--     resultado é idêntico ao de antes (mesmos itens sobrevivem).
--
--  5) get_production_rows (Fábrica 2, redef. da 036) ganha p_seq
--     (igualdade sobre o seq do item) e p_op ("contém" sobre a coluna
--     OP) — 21 → 23 params (append no fim, USING posicional $20/$21).
--
--  6) get_production_rows_by_order (gestão, redef. da 037) ganha
--     p_seq (igualdade sobre o menor seq da OF) — 18 → 19 params
--     (USING posicional $17).
--
-- Todos os filtros novos são opcionais (default null) e combináveis
-- com os vigentes. -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Seq exclusivo por OF (trigger + índice de apoio)
-- -------------------------------------------------------------
create or replace function public.enforce_order_seq_uniqueness()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.seq is not null and exists (
    select 1
      from public.order_items oi
     where oi.seq = new.seq
       -- Outra OF apenas: mesma OF pode (re)usar o número — F1 e
       -- gestão regravam o mesmo valor em vários itens por vez.
       and oi.order_id is distinct from new.order_id
  ) then
    raise exception 'Sequência % já está em uso por outra OF.', new.seq;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_seq_unique_per_order on public.order_items;
create trigger order_items_seq_unique_per_order
  before insert or update of seq on public.order_items
  for each row
  execute function public.enforce_order_seq_uniqueness();

-- Apoio ao lookup do trigger, ao filtro por igualdade (p_seq) e à
-- ordenação default `seq nulls last` — parcial para não custar nas
-- linhas sem número (a maioria).
create index if not exists idx_order_items_seq
  on public.order_items (seq)
  where seq is not null;

-- -------------------------------------------------------------
-- 2) Índice trgm da coluna OP (filtro "contém" da Fábrica 2)
-- -------------------------------------------------------------
-- Mesmo guard da 023: sem pg_trgm (ex.: PGlite dos testes) a busca
-- textual segue funcionando com seq scan.
do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm indisponível — filtro de OP segue com seq scan';
  end;

  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create index if not exists idx_order_items_op_trgm
      on public.order_items using gin (op gin_trgm_ops);
  end if;
end;
$$;

-- -------------------------------------------------------------
-- 3) Fábrica 1 — grupos por código de filho (redef. da 036): ganha
--    p_seq + faixas sobre os agregados do grupo (HAVING no grouped).
--    Assinatura muda (13 → 20 params) => DROP + recriação.
-- -------------------------------------------------------------
drop function if exists public.get_child_item_groups(
  text, text, text, text, text, text, uuid[], date, date, uuid, text,
  integer, integer
);

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
  p_weight_unit_max numeric default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select oi.id, oi.order_id, oi.parent_item, oi.description, oi.delivery_date,
           oi.seq,
           oi.quantity as quantity,
           oi.unit_weight_kg as unit_w,
           -- 023: peso TOTAL derivado (qtd × peso unit.).
           oi.total_weight_kg as total_w,
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
    select order_id,
           coalesce(nullif(btrim(parent_item), ''), btrim(description)) as key,
           min(coalesce(delivery_date, order_delivery_date)) as delivery_key,
           min(seq) as seq_min,
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
     -- grupo (Σ dos membros), como a coluna exibe; o peso unitário só
     -- existe quando todos os membros coincidem (senão a célula é "—").
     having (p_seq is null or min(seq) = p_seq)
        and (p_qty_min is null or coalesce(sum(coalesce(quantity, 0)), 0) >= p_qty_min)
        and (p_qty_max is null or coalesce(sum(coalesce(quantity, 0)), 0) <= p_qty_max)
        and (p_weight_min is null or coalesce(sum(coalesce(total_w, 0)), 0) >= p_weight_min)
        and (p_weight_max is null or coalesce(sum(coalesce(total_w, 0)), 0) <= p_weight_max)
        and (p_weight_unit_min is null
             or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                 and min(unit_w) >= p_weight_unit_min))
        and (p_weight_unit_max is null
             or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                 and max(unit_w) <= p_weight_unit_max))
  ),
  page as (
    select *
      from grouped
     order by seq_min nulls last, delivery_key nulls last, key
     limit greatest(coalesce(p_limit, 25), 0)
     offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from grouped),
    'groups', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', order_id,
          'key', key,
          'itemIds', item_ids
        ) order by seq_min nulls last, delivery_key nulls last, key
      ),
      '[]'::jsonb
    )
  )
  from page;
$$;

revoke execute on function public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric) from anon;
grant execute on function public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- -------------------------------------------------------------
-- 4) Totais do card da Fábrica 1 (redef. da 035): os MESMOS 7 params
--    com a MESMA semântica de grupo — o card continua casando com a
--    lista filtrada. Dois caminhos: sem filtro de grupo a janela é a
--    de antes (um group by family, mesma passada/performance da 035);
--    com filtro de grupo agrupa por (OF, código do filho) antes de
--    somar, como a lista. `total` = soma dos MEMBROS dos grupos que
--    sobrevivem. Assinatura muda (11 → 18 params) => DROP + recriação.
-- -------------------------------------------------------------
drop function if exists public.get_child_items_totals(
  text, text, text, text, text, text, uuid[], date, date, uuid, text
);

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
    with filtered as (
      select nullif(btrim(oi.family), '') as family,
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
    with filtered as (
      select oi.order_id as ord_id,
             coalesce(nullif(btrim(oi.parent_item), ''), btrim(oi.description)) as key,
             nullif(btrim(oi.family), '') as family,
             oi.seq as seq,
             coalesce(oi.quantity, 0) as qty,
             -- 023: peso TOTAL derivado (qtd × peso unit.).
             coalesce(oi.total_weight_kg, 0) as weight,
             oi.unit_weight_kg as unit_w
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
               or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                   and min(unit_w) >= p_weight_unit_min))
          and (p_weight_unit_max is null
               or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                   and max(unit_w) <= p_weight_unit_max))
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

revoke execute on function public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, numeric, numeric, numeric, numeric, numeric, numeric) from anon;
grant execute on function public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

-- -------------------------------------------------------------
-- 5) Fábrica 2 — uma linha por item raiz (redef. da 036): ganha
--    p_seq (igualdade) e p_op ("contém"). Assinatura muda
--    (21 → 23 params) => DROP + recriação; os params novos entram no
--    fim do USING posicional ($20 = p_seq, $21 = p_op).
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
  p_delivery_to date default null,
  -- 038: seq por igualdade (exclusivo por OF) e coluna OP ("contém")
  p_seq integer default null,
  p_op text default null
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
  family_totals jsonb,
  -- 036: sequência de fabricação do item (null = sem número)
  seq integer
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
    -- 036: 'seq' embute o desempate (entrega asc) — a ordem do planejamento
    -- com as linhas sem número caindo depois (nulls last) e mantendo a
    -- sequência atual de exibição entre elas.
    when 'seq'            then 'j.seq asc nulls last, j.deliv'
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
        -- 036: sequência de fabricação do item.
        oi.seq as seq,
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
        -- 038: seq por igualdade (número exclusivo por OF — trigger 038)
        and ($20 is null or (oi.seq is not null and oi.seq = $20))
        -- 038: coluna OP ("contém", insensível a maiúsculas)
        and ($21 is null or coalesce(oi.op, '') ilike '%' || $21 || '%')
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
      ) as family_totals,
      -- 036: sequência de fabricação do item.
      j.seq
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
      p_delivery_to,
      p_seq,
      nullif(p_op, '');
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date, integer, text) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date, integer, text) to authenticated;

-- -------------------------------------------------------------
-- 6) Gestão de OF — uma linha por pedido (redef. da 037): ganha
--    p_seq (igualdade sobre o MENOR seq dos itens raiz da OF).
--    Assinatura muda (18 → 19 params) => DROP + recriação; o param
--    novo entra no fim do USING posicional ($17 = p_seq).
-- -------------------------------------------------------------
drop function if exists public.get_production_rows_by_order(
  text, text, text, text, text, date, text, text, integer, integer,
  text, text, numeric, numeric, numeric, numeric, date, date
);

create or replace function public.get_production_rows_by_order(
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
  -- filtros por coluna
  p_order_code text default null,
  p_customer text default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  -- período de entrega (inclusivo, lados opcionais)
  p_delivery_from date default null,
  p_delivery_to date default null,
  -- 038: seq da OF por igualdade (menor seq entre os itens raiz)
  p_seq integer default null
)
returns table (
  total_count bigint,
  weight_total numeric,
  qty_total numeric,
  order_id uuid,
  order_code text,
  order_type text,
  customer_name text,
  order_status text,
  delivery_date date,
  quantity numeric,
  weight_kg numeric,
  overdue boolean,
  processes jsonb,
  -- 036: menor seq entre os itens raiz da OF (null = sem número)
  seq integer,
  -- 037: quebra por família dos itens raiz das OFs filtradas
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
    -- 036: ordem do planejamento com desempate na entrega (ver 035/F2).
    when 'seq'           then 'j.seq_min asc nulls last, j.deliv'
    when 'delivery_date' then 'j.deliv'
    when 'order_code'    then 'j.ord_code'
    when 'order_type'    then 'j.ord_type'
    when 'order_status'  then 'j.ord_status'
    when 'quantity'      then 'j.qty'
    when 'weight_total'  then 'j.wt'
    when 'overdue'       then 'j.overdue'
    else null
  end;

  -- Ordenação por coluna de processo (código existente no catálogo):
  -- usa o pior rank agregado da OF (1 = tudo concluído … 5 = nada
  -- aplicável, que vai por último).
  if v_sort_expr is null then
    if exists (select 1 from public.processes pr where pr.code = p_sort) then
      v_sort_expr :=
        '(select coalesce(s.worst_rank, 5) '
        || 'from proc_agg s '
        || 'where s.ord_id = j.ord_id and s.pcode = ' || quote_literal(p_sort) || ' limit 1)';
    else
      v_sort_expr := 'j.deliv';
    end if;
  end if;

  v_sql := $q$
    with root_items as (
      -- 016: só itens de nível raiz (itens pai / manuais)
      select oi.id as pid, oi.order_id as ord_id, oi.quantity as qty,
             oi.total_weight_kg as wt, oi.seq as seq,
             -- 037: família entra na quebra por TP do card "OFs".
             oi.family as family
      from public.order_items oi
      where oi.parent_order_item_id is null
    ),
    proc_rows as (
      select
        oi.order_id as ord_id,
        (oi.parent_order_item_id is null) as is_root,
        pr.code as pcode,
        pp.status as pstatus,
        pp.quantity_planned as pq_planned,
        pp.quantity_completed as pq_done,
        pp.completed_at as p_completed
      from public.production_processes pp
      join public.processes pr on pr.id = pp.process_id
      join public.order_items oi on oi.id = pp.order_item_id
    ),
    -- 025: escopo por código — cadeia F1 lê os FILHOS; os demais
    -- processos (MP, KIT, PRÉ-MTG…EXP) vêm dos itens RAIZ.
    scoped_rows as (
      select r.*
      from proc_rows r
      where r.is_root <> (r.pcode in ('LASER', 'DB_CH', 'SERRA', 'DB_TB', 'PUNC', 'METALEIRA', 'FICEP'))
    ),
    proc_agg as (
      select
        s.ord_id,
        s.pcode,
        -- pior situação entre os itens aplicáveis: rank 1 = CONCLUIDO
        -- (melhor) … 2 = NAO_INICIADO (pior); NAO_APLICAVEL fica de fora
        -- (se não resta nada aplicável, max é null => célula "—").
        max(case s.pstatus
              when 'CONCLUIDO' then 1
              when 'NAO_INICIADO' then 2
            end) as worst_rank,
        count(*) filter (where s.pstatus = 'CONCLUIDO') as done,
        count(*) filter (where s.pstatus <> 'NAO_APLICAVEL') as applicable,
        coalesce(sum(coalesce(s.pq_planned, 0)) filter (where s.pstatus <> 'NAO_APLICAVEL'), 0) as planned,
        coalesce(sum(coalesce(s.pq_done, 0)) filter (where s.pstatus <> 'NAO_APLICAVEL'), 0) as completed,
        -- 031: data efetiva entre os itens concluídos (maior conclusão)
        max(s.p_completed) filter (where s.pstatus = 'CONCLUIDO') as p_completed
      from scoped_rows s
      group by s.ord_id, s.pcode
    ),
    proc_json as (
      select
        a.ord_id,
        coalesce(
          jsonb_object_agg(
            a.pcode,
            jsonb_build_object(
              'status', case a.worst_rank
                          when 1 then 'CONCLUIDO'
                          when 2 then 'NAO_INICIADO'
                          else 'NAO_APLICAVEL'
                        end,
              'done', a.done,
              'applicable', a.applicable,
              'quantityPlanned', a.planned,
              'quantityCompleted', a.completed,
              -- 031: data efetiva só quando a célula consolidada está CONCLUIDO
              'completedAt', case when a.worst_rank = 1 then a.p_completed end
            ) order by a.pcode
          ),
          '{}'::jsonb
        ) as processes
      from proc_agg a
      group by a.ord_id
    ),
    exp_item as (
      -- regra de atraso: item raiz com EXPEDIÇÃO concluída
      select oi.pid as pid,
             bool_or(pr.code = 'EXP' and pp.status = 'CONCLUIDO') as exp_done
      from root_items oi
      left join public.production_processes pp on pp.order_item_id = oi.pid
      left join public.processes pr on pr.id = pp.process_id
      group by oi.pid
    ),
    exp_by_order as (
      -- a OF só sai do atraso quando TODOS os itens raiz foram expedidos
      select oi.ord_id as ord_id, bool_and(coalesce(e.exp_done, false)) as exp_done
      from root_items oi
      join exp_item e on e.pid = oi.pid
      group by oi.ord_id
    ),
    order_agg as (
      select oi.ord_id as ord_id,
             coalesce(sum(oi.qty), 0) as qty,
             coalesce(sum(oi.wt), 0) as wt,
             -- 036: seq da OF = menor seq entre os itens raiz (null = nenhuma linha numerada).
             min(oi.seq) as seq_min
      from root_items oi
      group by oi.ord_id
    ),
    filtered as (
      select
        o.id as ord_id,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust,
        o.delivery_date as deliv,
        a.qty as qty,
        coalesce(a.wt, 0) as wt,
        a.seq_min as seq_min,
        coalesce(e.exp_done, false) as exp_done,
        -- atraso por OF: entrega do pedido vencida + expedição pendente
        (o.delivery_date is not null
         and o.delivery_date < $6::date
         and not coalesce(e.exp_done, false)) as overdue
      from public.orders o
      join order_agg a on a.ord_id = o.id
      left join exp_by_order e on e.ord_id = o.id
      where ($2 is null or o.status = $2)
        and (
          -- busca genérica: código do pedido, cliente e família/item pai/
          -- descrição de QUALQUER item da OF (a OF aparece se bater)
          $1 is null
          or o.code ilike '%' || $1 || '%'
          or coalesce(o.customer_name, '') ilike '%' || $1 || '%'
          or exists (
            select 1 from public.order_items si
            where si.order_id = o.id
              and (coalesce(si.family, '') ilike '%' || $1 || '%'
                   or coalesce(si.parent_item, '') ilike '%' || $1 || '%'
                   or si.description ilike '%' || $1 || '%')
          )
        )
        and (
          -- filtro de processo (na OF: algum item no escopo da coluna)
          $3 is null
          or exists (
            select 1 from scoped_rows x
            where x.ord_id = o.id
              and x.pcode = $3
              and (case when $4 is null then x.pstatus <> 'NAO_APLICAVEL' else x.pstatus = $4 end)
          )
        )
        and (
          -- status de processo sem processo específico
          $4 is null or $3 is not null
          or exists (select 1 from scoped_rows x where x.ord_id = o.id and x.pstatus = $4)
        )
        and (
          -- filtro de entrega (janela rápida) sobre a data do PEDIDO
          case $5
            when 'OVERDUE' then
              o.delivery_date is not null
              and o.delivery_date < $6::date
              and not coalesce(e.exp_done, false)
            when 'TODAY' then o.delivery_date = $6::date
            when 'NEXT_7_DAYS' then
              o.delivery_date >= $6::date and o.delivery_date <= ($6::date + 7)
            when 'NEXT_30_DAYS' then
              o.delivery_date >= $6::date and o.delivery_date <= ($6::date + 30)
            else true
          end
        )
        and ($9 is null or o.code ilike '%' || $9 || '%')
        and ($10 is null or coalesce(o.customer_name, '') ilike '%' || $10 || '%')
        and ($11 is null or a.qty >= $11)
        and ($12 is null or a.qty <= $12)
        and ($13 is null or (a.wt is not null and a.wt >= $13))
        and ($14 is null or (a.wt is not null and a.wt <= $14))
        and ($15 is null or (o.delivery_date is not null and o.delivery_date >= $15))
        and ($16 is null or (o.delivery_date is not null and o.delivery_date <= $16))
        -- 038: seq da OF por igualdade (menor seq entre os itens raiz)
        and ($17 is null or a.seq_min = $17)
    )
    select
      count(*) over() as total_count,
      -- soma do peso TOTAL (qtd × peso unit.) de toda a lista filtrada
      coalesce(sum(j.wt) over(), 0) as weight_total,
      coalesce(sum(j.qty) over(), 0) as qty_total,
      j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status, j.deliv,
      j.qty, j.wt, j.overdue,
      coalesce(p.processes, '{}'::jsonb) as processes,
      -- 036: menor seq entre os itens raiz da OF.
      j.seq_min,
      -- 037: quebra por família dos ITENS RAIZ das OFs filtradas — mesma
      -- janela do qty_total (subconsulta não correlacionada, padrão 035;
      -- avaliada uma vez sobre root_items ⋈ filtered).
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('family', g.family, 'qty', g.qty, 'weight', g.weight)
            order by g.qty desc, g.family asc
          )
          from (
            select nullif(btrim(ri.family), '') as family,
                   sum(coalesce(ri.qty, 0)) as qty,
                   sum(coalesce(ri.wt, 0)) as weight
            from root_items ri
            join filtered j2 on j2.ord_id = ri.ord_id
            group by nullif(btrim(ri.family), '')
          ) g
        ),
        '[]'::jsonb
      ) as family_totals
    from filtered j
    left join proc_json p on p.ord_id = j.ord_id
  $q$;

  v_sql := v_sql
    || ' order by ' || v_sort_expr || ' ' || v_sort_dir
    || ' nulls last, j.ord_code asc, j.ord_id asc'
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
      p_qty_min,
      p_qty_max,
      p_weight_min,
      p_weight_max,
      p_delivery_from,
      p_delivery_to,
      p_seq;
end;
$$;

revoke execute on function public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date, integer) from anon;
grant execute on function public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date, integer) to authenticated;
