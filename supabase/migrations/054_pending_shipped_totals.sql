-- -------------------------------------------------------------
-- 054) Baixa derivada da expedição nos TOTAIS (saldo em leitura)
--
-- A emissão da nota no fim do romaneio (`confirm_romaneio`, 045/053)
-- continua NÃO decrementando `order_items.quantity` (regra do
-- AI_README): o que as telas passam a exibir é o SALDO pendente,
-- derivado a cada consulta a partir dos romaneios `CONFIRMADOS` —
-- cancelar um romaneio restaura os números sozinho (nenhum contador
-- é gravado).
--
-- Helper: `romaneio_shipped_by_item()` devolve (item, Σ expedido) só
-- nos CONFIRMADOS. Leitura para `authenticated` (RLS de romaneio_items
-- já é `using (true)` desde a 042); revogada do `anon`.
--
-- Fórmulas (idênticas ao espelho em src/lib/utils/shipping.ts):
--   * item RAIZ:  saldo_qtd   = greatest(qtd − expedido, 0)
--                 saldo_peso  = greatest(total_weight_kg − expedido
--                                        × unit_weight_kg, 0)
--                 (total_weight_kg null continua null — "—" na tela);
--   * item FILHO (Fábrica 1): valor planejado × FRAÇÃO pendente do pai
--     raiz = saldo_qtd(pai) ÷ qtd(pai); sem pai (ou pai que não é raiz)
--     a fração é 1 (fail-safe). Só existem 2 níveis: raiz → filho.
--
-- O que muda (assinaturas e tipos de retorno INALTERADOS —
-- `create or replace` preserva os grants vigentes):
--   * get_production_rows         — Qtd./Peso da linha e os cards da
--     Fábrica 2 (inclui os filtros de faixa, agora sobre o saldo);
--   * get_production_rows_by_order — Qtd./Peso por OF, quebras por
--     família e cards da Gestão;
--   * get_child_item_groups       — Qtd./Peso agregados do grupo (o
--     HAVING de faixa e o ORDER BY passam a valer sobre o saldo);
--   * get_child_items_totals      — card "Eventos" da Fábrica 1 (Σ dos
--     membros já escalado pela fração do pai);
--   * get_production_stats        — cards de ITEM do Dashboard contam
--     só itens com saldo > 0 (`has_pending`): totais, status, janelas
--     de entrega e atrasados. A carga por processo e o CONJUNTO do card
--     de EXPEDIÇÃO (itens com EXP concluída) continuam iguais — só os
--     números somam o saldo, como todos os demais totais.
--
-- Fora de escopo: `get_romaneio_candidates` (segue com o planejado +
-- "Já expedida"), a lista /pedidos, `pedidosSheet`, os status
-- derivados (`refresh_order_statuses`) e as regras 050/051 de peso.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) romaneio_shipped_by_item — Σ expedido por item (só CONFIRMADO)
-- -------------------------------------------------------------
create or replace function public.romaneio_shipped_by_item()
returns table (item_id uuid, shipped numeric)
language sql
stable
security invoker
set search_path = public
as $fn$
  select ri.order_item_id as item_id,
         coalesce(sum(ri.quantity), 0)::numeric as shipped
    from public.romaneio_items ri
    join public.romaneios r on r.id = ri.romaneio_id
   where r.status = 'CONFIRMADO'
   group by ri.order_item_id
$fn$;

revoke execute on function public.romaneio_shipped_by_item() from anon;
grant execute on function public.romaneio_shipped_by_item() to authenticated;

-- -------------------------------------------------------------
-- 2) Fábrica 2 — get_production_rows (redef. da 043)
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
    -- 043: coluna "Cli." (o header já mandava ?ordem=customer).
    when 'customer'       then 'j.cust'
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
    -- 054: SALDO derivado da expedição por item raiz — Σ das cargas dos
    -- romaneios CONFIRMADOS (qtd expedida × peso unitário). Nada é
    -- gravado: cancelar o romaneio restaura o planejado sozinho.
    shipped as (
      select
        oi.id as item_id,
        greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as qty,
        case when oi.total_weight_kg is null then null
             else greatest(oi.total_weight_kg
                           - coalesce(s.shipped, 0) * coalesce(oi.unit_weight_kg, 0), 0)
        end as total_w
      from public.order_items oi
      left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
      where oi.parent_order_item_id is null
    ),
    filtered as (
      select
        oi.id as item_id,
        oi.order_id as ord_id,
        coalesce(oi.family, '') as family,
        coalesce(oi.parent_item, '') as parent_item,
        oi.description as descr,
        -- 054: a linha passa a somar o SALDO (o 023 continua a base do peso).
        sh.qty as qty,
        oi.unit_weight_kg as unit_w,
        sh.total_w as total_w,
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
      left join shipped sh on sh.item_id = oi.id
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
        and ($14 is null or sh.qty >= $14)
        and ($15 is null or sh.qty <= $15)
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

-- -------------------------------------------------------------
-- 3) Gestão de OF — get_production_rows_by_order (redef. da 043)
-- -------------------------------------------------------------
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
    -- 043: coluna "Cli." da gestão.
    when 'customer'      then 'j.cust'
    when 'quantity'      then 'j.qty'
    when 'weight_total'  then 'j.wt'
    when 'overdue'       then 'j.overdue'
    -- 043: DP (data de proposta) — espelho de orderProposalDate.
    when 'proposal_date' then
      '(case'
      || ' when coalesce((select a.applicable from proc_agg ma'
      || '                 where ma.ord_id = j.ord_id and ma.pcode = ''MP''), 0) > 0'
      || '  and coalesce((select a.worst_rank from proc_agg ma'
      || '                 where ma.ord_id = j.ord_id and ma.pcode = ''MP''), 2) <> 1'
      || ' then public.add_business_days($6::date,'
      || '   (select coalesce(sum(case when pr.duration_days is null or pr.duration_days < 1'
      || '                             then 1 else floor(pr.duration_days) end), 0)'
      || '    from proc_agg pa'
      || '    join public.processes pr on pr.code = pa.pcode'
      || '    where pa.ord_id = j.ord_id and pa.pcode <> ''MP'' and pa.applicable > 0)::integer)'
      || ' else null end)'
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
    with
    -- 054: SALDO derivado da expedição por item raiz (Σ dos romaneios
    -- CONFIRMADOS × peso unitário) — base dos totais, filtros e cards.
    shipped as (
      select
        oi.id as item_id,
        greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as qty,
        case when oi.total_weight_kg is null then null
             else greatest(oi.total_weight_kg
                           - coalesce(s.shipped, 0) * coalesce(oi.unit_weight_kg, 0), 0)
        end as wt
      from public.order_items oi
      left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
      where oi.parent_order_item_id is null
    ),
    root_items as (
      -- 016: só itens de nível raiz (itens pai / manuais)
      select oi.id as pid, oi.order_id as ord_id,
             -- 054: a OF soma o SALDO (planejado − expedido) por item.
             coalesce(sh.qty, oi.quantity) as qty,
             coalesce(sh.wt, oi.total_weight_kg) as wt,
             oi.seq as seq,
             -- 037: família entra na quebra por TP do card "OFs".
             oi.family as family,
             -- 041: entrega do item (fallback na data do pedido) para
             -- o card "Atrasados" contar itens, como antes.
             oi.delivery_date as item_delivery
      from public.order_items oi
      left join shipped sh on sh.item_id = oi.id
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

-- -------------------------------------------------------------
-- 4) Fábrica 1 — get_child_item_groups (redef. da 043)
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
    when 'unit_weight_kg' then 'g.uw_min'
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
       -- grupo (Σ dos membros), como a coluna exibe; o peso unitário só
       -- existe quando todos os membros coincidem (senão a célula é "—").
       having ($14::integer is null or min(seq) = $14::integer)
          and ($15::numeric is null or coalesce(sum(coalesce(quantity, 0)), 0) >= $15::numeric)
          and ($16::numeric is null or coalesce(sum(coalesce(quantity, 0)), 0) <= $16::numeric)
          and ($17::numeric is null or coalesce(sum(coalesce(total_w, 0)), 0) >= $17::numeric)
          and ($18::numeric is null or coalesce(sum(coalesce(total_w, 0)), 0) <= $18::numeric)
          and ($19::numeric is null
               or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                   and min(unit_w) >= $19::numeric))
          and ($20::numeric is null
               or (min(unit_w) is not null and min(unit_w) = max(unit_w)
                   and max(unit_w) <= $20::numeric))
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

-- -------------------------------------------------------------
-- 5) Fábrica 1 — get_child_items_totals (redef. da 038)
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

-- -------------------------------------------------------------
-- 6) Dashboard — get_production_stats (redef. da 037)
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
  -- 054: SALDO derivado da expedição por item raiz (Σ dos romaneios
  -- CONFIRMADOS × peso unitário) — os cards de item contam só o que
  -- ainda falta expedir.
  with shipped as (
    select
      oi.id as item_id,
      greatest(coalesce(oi.quantity, 0) - coalesce(s.shipped, 0), 0) as quantity,
      case when oi.total_weight_kg is null then null
           else greatest(oi.total_weight_kg
                         - coalesce(s.shipped, 0) * coalesce(oi.unit_weight_kg, 0), 0)
      end as total_weight_kg
    from public.order_items oi
    left join public.romaneio_shipped_by_item() s on s.item_id = oi.id
    where oi.parent_order_item_id is null
  ),
  roots as (
    select
      oi.id,
      oi.status,
      -- 054: o card mostra o SALDO, não mais o planejado.
      coalesce(sh.quantity, oi.quantity) as quantity,
      coalesce(sh.total_weight_kg, oi.total_weight_kg) as total_weight_kg,
      -- 037: família entra para as quebras por TP dos cards.
      oi.family as family,
      coalesce(oi.delivery_date, o.delivery_date) as deliv
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join shipped sh on sh.item_id = oi.id
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
  has_pending as (
    -- 054: item raiz com SALDO a expedir — sem saldo o item sai dos
    -- cards de item (totais, status, janelas de entrega e atrasados).
    select r.id as id
      from roots r
     where coalesce(r.quantity, 0) > 0
  ),
  rstat as (
    select r.*,
           coalesce(p.exp_done, false) as exp_done,
           exists (select 1 from has_pending hp where hp.id = r.id) as pending
    from roots r
    left join pstat p on p.pid = r.id
  ),
  item_status as (
    -- 054: só itens com saldo pendente contam nos cards de status.
    select s.status, count(*) as cnt
    from rstat s
    where s.pending
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
      where r.deliv is not null and r.pending
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
      and r.pending
  ),
  -- 037: quebra por família (padrão 035) sobre os MESMOS conjuntos dos
  -- números de atraso e expedição logo acima — lista dos cards
  -- "Atrasados" e "Expedição" (F1, F2 e Gestão leem o mesmo KPI).
  overdue_families as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('family', g.family, 'qty', g.qty, 'weight', g.weight)
          order by g.qty desc, g.family asc
        )
        from (
          select nullif(btrim(r.family), '') as family,
                 sum(coalesce(r.quantity, 0)) as qty,
                 sum(coalesce(r.total_weight_kg, 0)) as weight
          from rstat r
          where r.deliv is not null and r.deliv < v_today and not r.exp_done
            and r.pending
          group by nullif(btrim(r.family), '')
        ) g
      ),
      '[]'::jsonb
    ) as value
  ),
  expedition_families as (
    select coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('family', g.family, 'qty', g.qty, 'weight', g.weight)
          order by g.qty desc, g.family asc
        )
        from (
          select nullif(btrim(r.family), '') as family,
                 sum(coalesce(r.quantity, 0)) as qty,
                 sum(coalesce(r.total_weight_kg, 0)) as weight
          from rstat r
          where r.exp_done
          group by nullif(btrim(r.family), '')
        ) g
      ),
      '[]'::jsonb
    ) as value
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
    'totalItems', (select count(*) from rstat r where r.pending),
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
    -- 037: quebra por família dos MESMOS conjuntos dos números acima.
    'overdueFamilies', od.value,
    'expeditionFamilies', ef.value,
    'processes', pl.value
  )
  into v_result
  from orders_agg o, orders_by_status bs, delivery_agg d, expedition_agg e, process_load pl,
       overdue_families od, expedition_families ef;

  return v_result;
end;
$$;
