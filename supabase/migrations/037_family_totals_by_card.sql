-- -------------------------------------------------------------
-- 037) Quebra por família (coluna TP) em TODOS os cards de resumo
--
-- O card "Eventos" (035) mostrou o padrão: sob os três números
-- (Registros, Qtd. total, Peso total), a lista de famílias com Σ de
-- quantidade e Σ de peso do MESMO conjunto. Esta migration leva a
-- mesma lista aos demais cards das telas de produção:
--
--   * get_production_stats (def. vigente 029) ganha `overdueFamilies`
--     e `expeditionFamilies` — a quebra dos MESMOS conjuntos dos
--     números de atraso/expedição (KPIs globais de item raiz: valem
--     para Fábrica 1, Fábrica 2 e Gestão de OF). Chaves novas em jsonb
--     => create or replace sem DROP; o dashboard só lê as chaves
--     antigas, que não mudam;
--   * get_production_rows_by_order (def. vigente 036) ganha
--     `family_totals jsonb` — a quebra dos ITENS RAIZ das OFs
--     filtradas, batendo com o qty_total do card "OFs" (mesma
--     subconsulta NÃO correlacionada da 035). RETURNS TABLE muda =>
--     DROP + recriação com a MESMA assinatura (18 params) — precedente
--     das 017/018/022/035/036.
--
-- Mesma forma do 035: chave `nullif(btrim(family), '')` (sem família
-- vira "—"), Σ de qty/peso, ordenado por qty desc e depois família.
--
-- A Fábrica 1 usa os KPIs globais do stats para os cards novos
-- (Atrasados/Expedição): a regra de atraso e a EXPEDIÇÃO pertencem ao
-- item RAIZ — os filhos (cadeia LASER…FICEP) não têm expedição
-- própria.
-- -------------------------------------------------------------

-- 1) Estatísticas dos cards — redefinição da 029 (raiz ganha family;
--    duas listas novas no jsonb final, na mesma passada).
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
  with roots as (
    select
      oi.id,
      oi.status,
      oi.quantity,
      oi.total_weight_kg,
      -- 037: família entra para as quebras por TP dos cards.
      oi.family as family,
      coalesce(oi.delivery_date, o.delivery_date) as deliv
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
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
  rstat as (
    select r.*, coalesce(p.exp_done, false) as exp_done
    from roots r
    left join pstat p on p.pid = r.id
  ),
  item_status as (
    select s.status, count(*) as cnt
    from roots s
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
      where r.deliv is not null
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
    'totalItems', (select count(*) from roots),
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

revoke execute on function public.get_production_stats(date) from anon;
grant execute on function public.get_production_stats(date) to authenticated;

-- 2) Gestão de OF — card "OFs" ganha a quebra por família dos itens
--    raiz das OFs filtradas (def. vigente = 036). Coluna nova no
--    RETURNS TABLE exige DROP + recriação com a MESMA assinatura
--    (18 params) — precedente das 017/018/022/035/036. O DROP leva o
--    EXECUTE junto, então os grants são refeitos logo abaixo.
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
      p_delivery_to;
end;
$$;

revoke execute on function public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date) from anon;
grant execute on function public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date) to authenticated;
