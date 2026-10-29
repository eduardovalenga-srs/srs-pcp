-- -------------------------------------------------------------
-- 043) Ordenação por coluna em todas as listas
--
-- Padrão já existente nas telas de produção (036): o cabeçalho grava
-- `?ordem=&direcao=` na URL, o parser valida contra uma whitelist e a
-- RPC ordena NO SERVIDOR (`p_sort`/`p_sort_dir`) — nunca sorting
-- client-side, porque a paginação é server-side.
--
-- O que passa a ordenar:
--   * Gestão de OF — nova chave `customer` (o header "Cli." já gerava
--     ?ordem=customer, mas a chave caía no default silenciosamente) e
--     `proposal_date` (DP); a Fábrica 2 ganha `customer`;
--   * Fábrica 1 (get_child_item_groups) — todos os cabeçalhos, incluindo
--     colunas de processo (MP ordena pelo pior rank entre os PAIS
--     distintos — a coluna é herdada do pai; os demais códigos, pelo
--     pior rank agregado do grupo, mesma regra da célula);
--   * Romaneio (lista e seletor de OFs) — novas RPCs de listagem com
--     `p_sort`/`p_sort_dir` (as agregações de Qtd/Peso/pendência e o
--     Σ já expedido passam a ser computadas no banco).
--
-- A ORDENÇÃO DEFAULT de cada tela permanece exatamente a de antes —
-- sem clique nenhum, nenhuma lista muda de ordem.
--
-- Regra da DP (coluna da Gestão) espelhada em SQL: quando o MP da OF
-- está aplicável e ainda não concluiu, DP = hoje + Σ das durações dos
-- processos aplicáveis da OF (sem o MP), em dias úteis — a mesma
-- `orderProposalDate` do frontend, com o mesmo `addBusinessDays`.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) add_business_days — espelho SQL de `addBusinessDays`
--    (src/lib/utils/dates.ts): soma N DIAS ÚTEIS (seg–sex, sem
--    feriados). Se a partida cair em fim de semana, ela rola para o
--    próximo dia útil ANTES de somar; 0 dias devolve o dia útil.
--    A duração é sempre integer (dias), então o floor do JS é no-op.
-- -------------------------------------------------------------
create or replace function public.add_business_days(p_start date, p_days integer)
returns date
language plpgsql
immutable
as $$
declare
  v_date      date;
  v_remaining integer;
begin
  if p_start is null then
    return null;
  end if;

  v_date := p_start;
  while extract(dow from v_date) in (0, 6) loop
    v_date := v_date + 1;
  end loop;

  v_remaining := greatest(coalesce(p_days, 0), 0);
  while v_remaining > 0 loop
    v_date := v_date + 1;
    if extract(dow from v_date) not in (0, 6) then
      v_remaining := v_remaining - 1;
    end if;
  end loop;

  return v_date;
end;
$$;

revoke execute on function public.add_business_days(date, integer) from anon;
grant execute on function public.add_business_days(date, integer) to authenticated;

-- -------------------------------------------------------------
-- 2) Fábrica 2 — get_production_rows: apenas a chave `customer`
--    (create or replace — assinatura e tipo de retorno inalterados,
--    os grants vigentes seguem valendo).
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

-- -------------------------------------------------------------
-- 3) Gestão de OF — get_production_rows_by_order: chaves `customer`
--    (coluna "Cli.") e `proposal_date` (DP). A DP usa o helper
--    add_business_days (item 1) sobre as MESMAS janelas da RPC:
--    MP aplicável pendente abre o cenário; a soma usa os processos
--    aplicáveis da OF (`proc_agg`), sem o MP — igual a
--    `orderProposalDate` do frontend. Linhas sem cenário ordenam por
--    último (nulls last), como a célula "—".
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

-- -------------------------------------------------------------
-- 4) Fábrica 1 — get_child_item_groups ganha p_sort/p_sort_dir.
--    Assinatura muda (20 → 22 params) => DROP + recriação (padrão
--    038), com os grants refeitos. O corpo vira plpgsql com SQL
--    dinâmico (mesmo padrão das RPCs de produção) para montar o
--    ORDER BY a partir da whitelist.
--
--    Chaves: seq, order_code, customer, child_item, materials (menor
--    descrição de MP do grupo), quantity, unit_weight_kg (menor peso
--    unitário — a coluna só exibe quando todos coincidem),
--    weight_total (Σ), delivery_date e os códigos de processo do
--    catálogo. MP ordena pelo pior rank entre os PAIS distintos do
--    grupo (coluna herdada do pai); os demais códigos, pelo pior rank
--    agregado dos MEMBROS (mesma regra de aggregateGroupStatus: 1 =
--    tudo concluído, 2 = em andamento, 3 = nada aplicável por último).
--
--    A ordem DEFAULT continua `seq_min nulls last, delivery_key
--    nulls last, key` — sem clique, nada muda.
-- -------------------------------------------------------------
drop function if exists public.get_child_item_groups(
  text, text, text, text, text, text, uuid[], date, date, uuid, text,
  integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric
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
    with filtered as (
      select oi.id, oi.order_id, oi.parent_item, oi.parent_order_item_id,
             oi.description, oi.delivery_date, oi.seq,
             oi.quantity as quantity,
             oi.unit_weight_kg as unit_w,
             -- 023: peso TOTAL derivado (qtd × peso unit.).
             oi.total_weight_kg as total_w,
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

revoke execute on function public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, text, text) from anon;
grant execute on function public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated;

-- -------------------------------------------------------------
-- 5) Romaneio — get_romaneios_page: listagem paginada com filtros,
--    ordenação e os agregados derivados que antes o frontend montava
--    a partir dos embeds (romaneioSummaryNumbers):
--     * item_count/quantity_total — Σ dos itens do romaneio;
--     * weight_total — Σ (qtd × peso unit.); null quando QUALQUER item
--       está sem peso unitário (regra do frontend: sem peso => "—");
--     * pending_return — existe linha de material com recebida −
--       utilizada > 0 (mesma regra do frontend).
--    A busca genérica casa nº do romaneio (numérica, eq) OU código/
--    cliente da OF — o PostgREST precisava de consulta prévia para
--    isso; aqui o EXISTS resolve direto.
-- -------------------------------------------------------------
create or replace function public.get_romaneios_page(
  p_search text default null,
  p_status text default null,
  p_order_code text default null,
  p_customer text default null,
  p_shipment_from date default null,
  p_shipment_to date default null,
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
     limit $8 offset $7
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
      greatest(coalesce(p_offset, 0), 0),
      greatest(coalesce(p_limit, 25), 0);
end;
$$;

revoke execute on function public.get_romaneios_page(text, text, text, text, date, date, text, text, integer, integer) from anon;
grant execute on function public.get_romaneios_page(text, text, text, text, date, date, text, text, integer, integer) to authenticated;

-- -------------------------------------------------------------
-- 6) Seletor de OFs — get_romaneio_candidates: OFs não canceladas com
--    ao menos um item raiz, com os agregados que antes o frontend
--    montava (rootQuantity/rootWeightKg/shippedQuantity/ simulação
--    aberta). Peso null quando algum item raiz está sem peso
--    unitário; já expedida = Σ de itens em romaneios EMITIDOS.
--    Default de ordenação = o de antes: entrega asc (nulls last),
--    depois o código.
-- -------------------------------------------------------------
create or replace function public.get_romaneio_candidates(
  p_search text default null,
  p_sort text default 'delivery_date',
  p_sort_dir text default 'asc',
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  total_count bigint,
  order_id uuid,
  code text,
  type text,
  customer_name text,
  delivery_date date,
  status text,
  root_quantity numeric,
  root_weight_kg numeric,
  shipped_quantity numeric,
  has_simulation boolean,
  simulation_id uuid
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
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sort_expr := case p_sort
    when 'order_code'    then 'f.ocode'
    when 'customer'      then 'f.cust'
    when 'status'        then 'f.ostatus'
    when 'quantity'      then 'f.root_quantity'
    when 'weight'        then 'f.root_weight_kg'
    when 'shipped'       then 'f.shipped_quantity'
    else 'f.deliv'
  end;

  v_sql := $q$
    with root_agg as (
      select oi.order_id as ord_id,
             coalesce(sum(oi.quantity), 0) as root_quantity,
             case
               when count(*) filter (where oi.unit_weight_kg is null) > 0 then null
               else coalesce(sum(oi.unit_weight_kg * oi.quantity), 0)
             end as root_weight_kg
        from public.order_items oi
       where oi.parent_order_item_id is null
       group by oi.order_id
    ),
    shipped as (
      select r.order_id as ord_id, coalesce(sum(ri.quantity), 0) as shipped_quantity
        from public.romaneio_items ri
        join public.romaneios r on r.id = ri.romaneio_id
       where r.status = 'EMITIDO'
       group by r.order_id
    ),
    simulations as (
      select r.order_id as ord_id, r.id as simulation_id
        from public.romaneios r
       where r.status = 'SIMULACAO'
    ),
    filtered as (
      select o.id as ord_id,
             o.code as ocode,
             o.type as otype,
             coalesce(o.customer_name, '') as cust,
             o.delivery_date as deliv,
             o.status as ostatus,
             ra.root_quantity as root_quantity,
             ra.root_weight_kg as root_weight_kg,
             coalesce(s.shipped_quantity, 0) as shipped_quantity,
             s2.simulation_id as simulation_id
        from public.orders o
        join root_agg ra on ra.ord_id = o.id
        left join shipped s on s.ord_id = o.id
        left join simulations s2 on s2.ord_id = o.id
       where o.status <> 'CANCELADO'
         and ($1::text is null
              or o.code ilike '%' || $1::text || '%'
              or coalesce(o.customer_name, '') ilike '%' || $1::text || '%')
    )
    select count(*) over() as total_count,
           f.ord_id as order_id,
           f.ocode as code,
           f.otype as type,
           f.cust as customer_name,
           f.deliv as delivery_date,
           f.ostatus as status,
           f.root_quantity as root_quantity,
           f.root_weight_kg as root_weight_kg,
           f.shipped_quantity as shipped_quantity,
           (f.simulation_id is not null) as has_simulation,
           f.simulation_id as simulation_id
      from filtered f
     order by $ORDER$
     limit $3 offset $2
  $q$;

  v_sql := replace(
    v_sql,
    '$ORDER$',
    v_sort_expr || ' ' || v_sort_dir || ' nulls last, f.ocode asc, f.ord_id asc'
  );

  return query execute v_sql
    using
      nullif(p_search, ''),
      greatest(coalesce(p_offset, 0), 0),
      greatest(coalesce(p_limit, 25), 0);
end;
$$;

revoke execute on function public.get_romaneio_candidates(text, text, text, integer, integer) from anon;
grant execute on function public.get_romaneio_candidates(text, text, text, integer, integer) to authenticated;
