-- -------------------------------------------------------------
-- 025) Gestão de entregas CONSOLIDADA por OF
--
-- A tela de gestão de entregas passa a mostrar UMA LINHA POR PEDIDO
-- (OF/OS) em vez de uma linha por item pai. A RPC antiga
-- get_production_rows continua intacta — é ela que sustenta a tela
-- da Fábrica 2 (que continua por item). Esta migration cria uma RPC
-- NOVA, get_production_rows_by_order, com a visão agregada:
--
--  - uma linha por pedido que tenha itens raiz;
--  - "Qtd."  = soma das quantidades dos itens raiz da OF;
--  - "Peso"  = soma do total_weight_kg (023) dos itens raiz;
--  - "Ent."  = data do PEDIDO (orders.delivery_date) — é o que a
--    coluna passa a exibir e editar (a data por item continua na
--    Fábrica 2 e no detalhe do pedido);
--  - atraso  = entrega do pedido vencida e algum item raiz ainda
--    sem EXPEDIÇÃO concluída (regra 13 por OF);
--  - processos: todas as etapas do catálogo, agregadas por OF.
--
-- FONTE POR CÓDIGO (decisão de produto): a cadeia da Fábrica 1 —
-- LASER, DB CH, SERRA, DB TB, PUNC, METALEIRA, FICEP — é rastreada
-- nos ITENS FILHOS (é lá que a Fábrica 1 grava), portanto a célula
-- agregada lê os filhos. MP e os demais processos (KIT, PRÉ-MTG,
-- SOLDA, ACAB, QUALITY, EXPEDIÇÃO) vêm dos itens RAIZ.
--
-- CÉLULA DE PROCESSO (agregação da OF):
--  - status   = pior situação entre os itens aplicáveis
--               (BLOQUEADO > EM_ANDAMENTO > NAO_INICIADO > CONCLUIDO);
--  - done     = quantos itens aplicáveis estão CONCLUIDO;
--  - applicable = quantos itens têm o processo aplicável
--               (NAO_APLICAVEL fica de fora; 0 => a célula vira "—");
--  - quantityPlanned / quantityCompleted = somas das quantidades,
--               exibidas no tooltip (a edição continua por item).
--
-- Filtros/ordenação seguem o formato da 024 (dynamic SQL + whitelist),
-- com duas diferenças: não há mais colunas TP/Item pai/Descrição/OP
-- (a busca genérica $1 continua varrendo família/item pai/descrição
-- de QUALQUER item da OF) e os filtros de faixa de qtd/peso valem
-- sobre os TOTAIS da OF.
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
  p_delivery_to date default null
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
      select oi.id as pid, oi.order_id as ord_id, oi.quantity as qty, oi.total_weight_kg as wt
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
        pp.quantity_completed as pq_done
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
        -- (melhor) … 4 = BLOQUEADO (pior); NAO_APLICAVEL fica de fora
        -- (se não resta nada aplicável, max é null => célula "—").
        max(case s.pstatus
              when 'CONCLUIDO' then 1
              when 'EM_ANDAMENTO' then 2
              when 'NAO_INICIADO' then 3
              when 'BLOQUEADO' then 4
            end) as worst_rank,
        count(*) filter (where s.pstatus = 'CONCLUIDO') as done,
        count(*) filter (where s.pstatus <> 'NAO_APLICAVEL') as applicable,
        coalesce(sum(coalesce(s.pq_planned, 0)) filter (where s.pstatus <> 'NAO_APLICAVEL'), 0) as planned,
        coalesce(sum(coalesce(s.pq_done, 0)) filter (where s.pstatus <> 'NAO_APLICAVEL'), 0) as completed
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
                          when 2 then 'EM_ANDAMENTO'
                          when 3 then 'NAO_INICIADO'
                          when 4 then 'BLOQUEADO'
                          else 'NAO_APLICAVEL'
                        end,
              'done', a.done,
              'applicable', a.applicable,
              'quantityPlanned', a.planned,
              'quantityCompleted', a.completed
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
             coalesce(sum(oi.wt), 0) as wt
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
    )
    select
      count(*) over() as total_count,
      -- soma do peso TOTAL (qtd × peso unit.) de toda a lista filtrada
      coalesce(sum(j.wt) over(), 0) as weight_total,
      coalesce(sum(j.qty) over(), 0) as qty_total,
      j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status, j.deliv,
      j.qty, j.wt, j.overdue,
      coalesce(p.processes, '{}'::jsonb) as processes
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
      p_delivery_to;
end;
$$;

revoke execute on function public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date) from anon;
grant execute on function public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date) to authenticated;

-- Índice de apoio: a consolidação agrupa itens por pedido (a FK não
-- tinha índice próprio em todas as bases).
create index if not exists idx_order_items_order_id
  on public.order_items (order_id);
