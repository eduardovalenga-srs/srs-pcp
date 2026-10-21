-- -------------------------------------------------------------
-- 041) Cards "Atrasados" e "Expedição" passam a respeitar os filtros
--      (Fábrica 2 e Gestão de OF)
--
-- Os dois cards vinham do get_production_stats (019/020), que conta
-- ITENS no banco INTEIRO — o número não mudava quando o usuário
-- filtrava a lista. Agora os totais vêm da PRÓPRIA RPC da lista, já
-- computados sobre o conjunto filtrado inteiro (mesma janela do
-- total_count/weight_total/qty_total, antes da paginação).
--
-- Regra do atraso (INALTERADA em relação ao card global): item RAIZ
-- com entrega vencida (coalesce(entrega do item, entrega do pedido) <
-- hoje) e EXPEDIÇÃO ainda não concluída. Expedição = item RAIZ com
-- EXPEDIÇÃO concluída. Unidade: ITENS (não OFs) nos dois cards.
--
-- Na Gestão de OF (linha = OF) os agregados são por ITEM dentro das
-- OFs filtradas; na Fábrica 2 (linha = item) são os próprios itens
-- filtrados. O card global do dashboard continua vindo do
-- get_production_stats (inalterado).
--
-- Os 6 campos novos só mudam o TIPO DE RETORNO => DROP + recriação
-- (padrão 038); argumentos idênticos aos da 039.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Fábrica 2 — get_production_rows (uma linha por item RAIZ)
--    Mesmo corpo da 039 + 6 colunas de agregado no select final
--    (overdue_count/qty/weight e expedition_count/qty/weight), com
--    FILTER sobre o CTE `filtered` — a mesma regra da coluna
--    `overdue` por linha, contada sobre TODAS as linhas filtradas.
-- -------------------------------------------------------------
drop function if exists public.get_production_rows(
  text, text, text, text, text, date, text, text, integer, integer,
  text, text, text, text, text, numeric, numeric, numeric, numeric,
  date, date, integer, text
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
  -- 041: cards "Atrasados"/"Expedição" sobre o conjunto FILTRADO
  -- (itens raiz de todas as páginas, antes da paginação).
  overdue_count bigint,
  overdue_qty numeric,
  overdue_weight numeric,
  expedition_count bigint,
  expedition_qty numeric,
  expedition_weight numeric,
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
    -- 024: agregação UMA vez por item.
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
    -- 039: KIT agregado dos FILHOS do item raiz. Um único registro por
    -- item raiz (left join em filtered); null = sem filho com KIT.
    kit_children as (
      select
        oi.parent_order_item_id as root_id,
        pp.status as pstatus,
        pp.quantity_planned as pq_planned,
        pp.quantity_completed as pq_done,
        pp.completed_at as p_completed
      from public.order_items oi
      join public.production_processes pp on pp.order_item_id = oi.id
      join public.processes pr on pr.id = pp.process_id and pr.code = 'KIT'
      where oi.parent_order_item_id is not null
    ),
    kit_agg as (
      select
        kc.root_id as root_id,
        -- pior situação entre os APLICÁVEIS: 1 = CONCLUIDO, 2 = NAO_INICIADO;
        -- NAO_APLICAVEL fica de fora (max null => nenhum aplicável).
        max(case kc.pstatus
              when 'CONCLUIDO' then 1
              when 'NAO_INICIADO' then 2
            end) as worst_rank,
        count(*) filter (where kc.pstatus <> 'NAO_APLICAVEL') as applicable,
        coalesce(sum(coalesce(kc.pq_planned, 0)) filter (where kc.pstatus <> 'NAO_APLICAVEL'), 0) as planned,
        coalesce(sum(coalesce(kc.pq_done, 0)) filter (where kc.pstatus <> 'NAO_APLICAVEL'), 0) as completed,
        max(kc.p_completed) filter (where kc.pstatus = 'CONCLUIDO') as p_completed
      from kit_children kc
      group by kc.root_id
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
        oi.total_weight_kg as total_w,
        coalesce(oi.delivery_date, o.delivery_date) as deliv,
        oi.status as item_status,
        oi.op as op,
        oi.seq as seq,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust,
        coalesce(p.exp_done, false) as exp_done,
        -- 039: processos do raiz COM o KIT sobrescrito pelo agregado dos
        -- filhos quando houver filho com KIT aplicável (senão, o KIT do
        -- raiz — normalmente NAO_APLICAVEL — continua como estava).
        case
          when ka.applicable > 0 then
            coalesce(p.processes, '{}'::jsonb) || jsonb_build_object(
              'KIT',
              jsonb_build_object(
                'id', null,
                -- 039: sinaliza ao frontend que a célula é SOMENTE LEITURA
                -- (agregada dos filhos — a marcação acontece na Fábrica 1).
                'aggregated', true,
                'status', case ka.worst_rank
                            when 1 then 'CONCLUIDO'
                            when 2 then 'NAO_INICIADO'
                            else 'NAO_APLICAVEL'
                          end,
                'quantityPlanned', ka.planned,
                'quantityCompleted', ka.completed,
                'notes', null,
                'completedAt', case when ka.worst_rank = 1 then ka.p_completed end
              )
            )
          else coalesce(p.processes, '{}'::jsonb)
        end as processes
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      left join proc_agg p on p.pid = oi.id
      left join kit_agg ka on ka.root_id = oi.id
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
          $3 is null
          or exists (
            select 1 from process_rows x
            where x.pid = oi.id
              and x.pcode = $3
              and (case when $4 is null then x.pstatus <> 'NAO_APLICAVEL' else x.pstatus = $4 end)
          )
        )
        and ($4 is null or $3 is not null
          or exists (select 1 from process_rows x where x.pid = oi.id and x.pstatus = $4))
        and (
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
        and ($20 is null or (oi.seq is not null and oi.seq = $20))
        and ($21 is null or coalesce(oi.op, '') ilike '%' || $21 || '%')
    )
    select
      count(*) over() as total_count,
      coalesce(sum(coalesce(j.total_w, 0)) over(), 0) as weight_total,
      coalesce(sum(coalesce(j.qty, 0)) over(), 0) as qty_total,
      -- 041: cards "Atrasados"/"Expedição" sobre o FILTRADO inteiro.
      -- Mesma regra da coluna `overdue` por linha (entrega vencida +
      -- EXPEDIÇÃO pendente); janela computada antes do limit.
      count(*) filter (where j.deliv is not null and j.deliv < $6::date and not j.exp_done) over() as overdue_count,
      coalesce(sum(coalesce(j.qty, 0)) filter (where j.deliv is not null and j.deliv < $6::date and not j.exp_done) over(), 0) as overdue_qty,
      coalesce(sum(coalesce(j.total_w, 0)) filter (where j.deliv is not null and j.deliv < $6::date and not j.exp_done) over(), 0) as overdue_weight,
      count(*) filter (where j.exp_done) over() as expedition_count,
      coalesce(sum(coalesce(j.qty, 0)) filter (where j.exp_done) over(), 0) as expedition_qty,
      coalesce(sum(coalesce(j.total_w, 0)) filter (where j.exp_done) over(), 0) as expedition_weight,
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.op,
      (j.deliv is not null and j.deliv < $6::date and not j.exp_done) as overdue,
      coalesce(j.processes, '{}'::jsonb) as processes,
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
-- 2) Gestão de Entregas — get_production_rows_by_order (uma linha
--    por OF). Mesmo corpo da 039 + 6 colunas de agregado. Como a
--    linha é a OF e o card conta ITENS, os totais vêm do novo CTE
--    `item_kpi` (agrega os ITENS RAIZ de cada OF pelas MESMAS regras
--    dos cards globais 019/020) somado, no select final, sobre as
--    OFs que passam no filtro (`filtered`).
-- -------------------------------------------------------------
drop function if exists public.get_production_rows_by_order(
  text, text, text, text, text, date, text, text, integer, integer,
  text, text, numeric, numeric, numeric, numeric, date, date, integer
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
  -- 041: cards "Atrasados"/"Expedição" sobre as OFs FILTRADAS,
  -- contando ITENS RAIZ (mesma unidade dos cards de antes).
  overdue_count bigint,
  overdue_qty numeric,
  overdue_weight numeric,
  expedition_count bigint,
  expedition_qty numeric,
  expedition_weight numeric,
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
             oi.family as family,
             -- 041: entrega do item (fallback na data do pedido) para
             -- o card "Atrasados" contar itens, como antes.
             oi.delivery_date as item_delivery
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
    -- 025 + 039: escopo por código — cadeia F1 E o KIT leem os FILHOS;
    -- os demais processos (MP, PRÉ-MTG…EXP) vêm dos itens RAIZ.
    scoped_rows as (
      select r.*
      from proc_rows r
      where r.is_root <> (r.pcode in ('LASER', 'DB_CH', 'SERRA', 'DB_TB', 'PUNC', 'METALEIRA', 'FICEP', 'KIT'))
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
      left join exp_item e on e.pid = oi.pid
      group by oi.ord_id
    ),
    -- 041: totais por ITEM dentro de cada OF (raiz) — os cards
    -- "Atrasados"/"Expedição" contam ITENS das OFs filtradas (a
    -- listagem continua sendo uma linha por OF). Mesma regra dos
    -- cards globais 019/020: entrega vencida (item com fallback no
    -- pedido) + EXPEDIÇÃO pendente / EXPEDIÇÃO concluída.
    item_kpi as (
      select
        ri.ord_id as ord_id,
        count(*) filter (
          where coalesce(ri.item_delivery, o.delivery_date) is not null
            and coalesce(ri.item_delivery, o.delivery_date) < $6::date
            and not coalesce(e.exp_done, false)
        ) as overdue_count,
        coalesce(sum(coalesce(ri.qty, 0)) filter (
          where coalesce(ri.item_delivery, o.delivery_date) is not null
            and coalesce(ri.item_delivery, o.delivery_date) < $6::date
            and not coalesce(e.exp_done, false)
        ), 0) as overdue_qty,
        coalesce(sum(coalesce(ri.wt, 0)) filter (
          where coalesce(ri.item_delivery, o.delivery_date) is not null
            and coalesce(ri.item_delivery, o.delivery_date) < $6::date
            and not coalesce(e.exp_done, false)
        ), 0) as overdue_weight,
        count(*) filter (where coalesce(e.exp_done, false)) as expedition_count,
        coalesce(sum(coalesce(ri.qty, 0)) filter (where coalesce(e.exp_done, false)), 0) as expedition_qty,
        coalesce(sum(coalesce(ri.wt, 0)) filter (where coalesce(e.exp_done, false)), 0) as expedition_weight
      from root_items ri
      join public.orders o on o.id = ri.ord_id
      left join exp_item e on e.pid = ri.pid
      group by ri.ord_id
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
        (o.delivery_date is not null
         and o.delivery_date < $6::date
         and not coalesce(e.exp_done, false)) as overdue
      from public.orders o
      join order_agg a on a.ord_id = o.id
      left join exp_by_order e on e.ord_id = o.id
      where ($2 is null or o.status = $2)
        and (
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
      coalesce(sum(j.wt) over(), 0) as weight_total,
      coalesce(sum(j.qty) over(), 0) as qty_total,
      -- 041: cards "Atrasados"/"Expedição" — Σ dos totais por ITEM
      -- das OFs em `filtered` (a janela cobre todas as páginas).
      coalesce(sum(ik.overdue_count) over(), 0)::bigint as overdue_count,
      coalesce(sum(ik.overdue_qty) over(), 0) as overdue_qty,
      coalesce(sum(ik.overdue_weight) over(), 0) as overdue_weight,
      coalesce(sum(ik.expedition_count) over(), 0)::bigint as expedition_count,
      coalesce(sum(ik.expedition_qty) over(), 0) as expedition_qty,
      coalesce(sum(ik.expedition_weight) over(), 0) as expedition_weight,
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
    left join item_kpi ik on ik.ord_id = j.ord_id
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
