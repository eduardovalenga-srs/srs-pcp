-- -------------------------------------------------------------
-- 022) Processos do pedido: desmarcar/marcar persistem + MP
--      obrigatório + entrega herdada do pedido
--
-- Três ajustes, um por bloco:
--
-- 1) backfill_process (010) passa a criar a linha como
--    NAO_APLICAVEL — processo novo/reativado no catálogo NÃO nasce
--    aplicável em todos os itens; quem decide é o usuário no pedido.
--    Exceção: MP (021) nasce NAO_INICIADO, porque é pré-requisito
--    para iniciar a produção.
--    Reparo único dos dados já gravados, em três passos: MP ausente
--    com a fórmula da 021 (sem pendência => CONCLUIDO), backfill do
--    invariant 010 e normalização do MP que o formulário antigo
--    deixava como NAO_APLICAVEL.
--
-- 2) get_production_rows (cópia da 018): a entrega do ITEM passa a
--    herdar a do PEDIDO — coalesce(oi.delivery_date, o.delivery_date).
--    Era essa a diferença entre pedido manual e importação: a 016
--    grava entrega em todo registro importado, o formulário deixa a
--    entrega do item em branco e a grade ignorava a do pedido — sem
--    data não há janela prevista (process-schedule lê na leitura).
--    As janelas, o atraso e os filtros de período passam a usar o
--    mesmo valor (a coluna deliv já alimenta todos eles).
--
-- 3) get_production_stats (cópia da 020): mesma herança nos cards
--    "Atrasados" e no bloco "delivery" (hoje/7/30 dias).
--
-- Assinaturas inalteradas — PostgREST continua chamando igual.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) backfill_process: linha nova nasce NAO_APLICAVEL (MP: NAO_INICIADO)
-- -------------------------------------------------------------
create or replace function public.backfill_process(p_process_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  -- Processo informado precisa existir e estar ativo.
  if p_process_id is not null and not exists (
    select 1 from public.processes where id = p_process_id and active
  ) then
    raise exception 'Processo inválido ou inativo';
  end if;

  -- Cria as linhas ausentes (null = todos os processos ativos).
  -- MP é pré-requisito da produção (sempre aplicável); os demais
  -- entram como "não se aplica" até o pedido marcar o processo.
  insert into public.production_processes (order_item_id, process_id, status)
  select oi.id, p.id,
         case when p.code = 'MP' then 'NAO_INICIADO' else 'NAO_APLICAVEL' end
    from public.order_items oi
    cross join public.processes p
   where p.active
     and (p_process_id is null or p.id = p_process_id)
  on conflict (order_item_id, process_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.backfill_process(uuid) from anon;
grant execute on function public.backfill_process(uuid) to authenticated;

-- 1a) MP ausente nasce com a fórmula da 021 (idempotente): sem
-- pendência => CONCLUIDO, senão NAO_INICIADO. Precisa vir ANTES do
-- backfill geral para que ele não crie o MP como NAO_INICIADO em item
-- já concluído.
insert into public.production_processes (order_item_id, process_id, status)
select oi.id,
       p.id,
       case
         when not exists (
           select 1
             from public.production_processes pp
            where pp.order_item_id = oi.id
              and pp.status <> 'NAO_APLICAVEL'
              and pp.status <> 'CONCLUIDO'
         ) then 'CONCLUIDO'
         else 'NAO_INICIADO'
       end
  from public.order_items oi
  cross join public.processes p
 where p.code = 'MP'
   and p.active
   and not exists (
     select 1
       from public.production_processes pp
      where pp.order_item_id = oi.id
        and pp.process_id = p.id
   );

-- 1b) Fecha o invariant 010 para todos os processos: órfãos (item sem
-- linha) nascem NAO_APLICAVEL — o MP já existe e é preservado pelo
-- on conflict.
select public.backfill_process(null);

-- 1c) Normalização única do MP desmarcado no pedido antes desta regra:
-- volta para o fluxo com a mesma fórmula da 021 (sem pendência =>
-- CONCLUIDO), para não criar pendência nova em item já concluído.
update public.production_processes pp
   set status = case
     when not exists (
       select 1
         from public.production_processes x
        where x.order_item_id = pp.order_item_id
          and x.status <> 'NAO_APLICAVEL'
          and x.status <> 'CONCLUIDO'
     ) then 'CONCLUIDO'
     else 'NAO_INICIADO'
   end
  from public.processes p
 where p.id = pp.process_id
   and p.code = 'MP'
   and pp.status = 'NAO_APLICAVEL';

-- -------------------------------------------------------------
-- 2) get_production_rows: entrega do item herda a do pedido (018 + coalesce)
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
  p_delivery_to date default null
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
        -- 022: item sem entrega própria herda a do pedido (mesma regra
        -- da Fábrica 1 e do detalhe da OF) — é o que faz a previsão
        -- existir também no pedido manual.
        coalesce(oi.delivery_date, o.delivery_date) as deliv,
        oi.status as item_status,
        oi.op as op,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
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
              and not exists (
                select 1 from process_rows x
                where x.pid = oi.id and x.pcode = 'EXP' and x.pstatus = 'CONCLUIDO'
              )
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
      coalesce(sum(coalesce(j.unit_w, 0)) over(), 0) as weight_total,
      coalesce(sum(coalesce(j.qty, 0)) over(), 0) as qty_total,
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.op, j.overdue, j.processes
    from joined j
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
      p_delivery_to;
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) to authenticated;

-- -------------------------------------------------------------
-- 3) get_production_stats: mesma herança de entrega (020 + coalesce)
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
  select jsonb_build_object(
    'totalOrders', (select count(*) from public.orders),
    'ordersByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select o.status as status, count(*) as cnt
          from public.orders o
          group by o.status
        ) s
      ),
      '{}'::jsonb
    ),
    'totalItems', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null
    ),
    'itemsByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select oi.status as status, count(*) as cnt
          from public.order_items oi
          where oi.parent_order_item_id is null
          group by oi.status
        ) s
      ),
      '{}'::jsonb
    ),
    'itemsInProduction', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null and oi.status = 'EM_PRODUCAO'
    ),
    'itemsDone', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null and oi.status = 'CONCLUIDO'
    ),
    -- 022: atraso considera a entrega efetiva (item ou pedido)
    'itemsOverdue', (
      select count(*)
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.parent_order_item_id is null
        and coalesce(oi.delivery_date, o.delivery_date) is not null
        and coalesce(oi.delivery_date, o.delivery_date) < v_today
        and not exists (
          select 1
          from public.production_processes pp
          join public.processes pr on pr.id = pp.process_id
          where pp.order_item_id = oi.id
            and pr.code = 'EXP'
            and pp.status = 'CONCLUIDO'
        )
    ),
    'delivery', (
      select jsonb_build_object(
        'overdue', count(*) filter (where d.is_overdue),
        'overdueQty', coalesce(sum(coalesce(d.quantity, 0)) filter (where d.is_overdue), 0),
        'overdueWeight', coalesce(sum(coalesce(d.unit_weight_kg, 0)) filter (where d.is_overdue), 0),
        'today', count(*) filter (where d.delivery_date = v_today),
        'next7', count(*) filter (where d.delivery_date > v_today and d.delivery_date <= (v_today + 7)),
        'next30', count(*) filter (where d.delivery_date > (v_today + 7) and d.delivery_date <= (v_today + 30))
      )
      from (
        select
          coalesce(oi.delivery_date, o.delivery_date) as delivery_date,
          oi.quantity,
          oi.unit_weight_kg,
          (
            coalesce(oi.delivery_date, o.delivery_date) < v_today
            and not exists (
              select 1 from public.production_processes pp
              join public.processes pr on pr.id = pp.process_id
              where pp.order_item_id = oi.id and pr.code = 'EXP' and pp.status = 'CONCLUIDO'
            )
          ) as is_overdue
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        where oi.parent_order_item_id is null
          and coalesce(oi.delivery_date, o.delivery_date) is not null
      ) d
    ),
    'expedition', (
      select jsonb_build_object(
        'count', count(*),
        'qty', coalesce(sum(coalesce(oi.quantity, 0)), 0),
        'weight', coalesce(sum(coalesce(oi.unit_weight_kg, 0)), 0)
      )
      from public.order_items oi
      where oi.parent_order_item_id is null
        and exists (
          select 1
          from public.production_processes pp
          join public.processes pr on pr.id = pp.process_id
          where pp.order_item_id = oi.id
            and pr.code = 'EXP'
            and pp.status = 'CONCLUIDO'
        )
    ),
    'processes', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'code', g.code,
            'name', g.name,
            'displayOrder', g.display_order,
            'total', g.total,
            'pending', g.pending,
            'inProgress', g.in_progress,
            'blocked', g.blocked,
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
            count(*) filter (where oi.id is not null and pp.status = 'EM_ANDAMENTO') as in_progress,
            count(*) filter (where oi.id is not null and pp.status = 'BLOQUEADO') as blocked,
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
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_production_stats(date) from anon;
grant execute on function public.get_production_stats(date) to authenticated;
