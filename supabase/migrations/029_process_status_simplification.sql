-- -------------------------------------------------------------
-- 029) Processos com 3 status: NAO_INICIADO, CONCLUIDO, NAO_APLICAVEL
--
-- Decisão de produto: EM_ANDAMENTO e BLOQUEADO saem de cena — nenhum
-- regra de negócio (derivação de item/pedido 013, atraso 13, progresso,
-- lote) dependia deles; sobravam como opções de UI e contadores.
--
--   * dados gravados: EM_ANDAMENTO/BLOQUEADO -> NAO_INICIADO em
--     production_processes e no histórico production_events (decisão
--     registrada com o usuário: nada "avançado" sem confirmação);
--   * constraints do 001 (status, old_status, new_status) trocados
--     para a lista de 3 (drop + add; nomes automáticos do Postgres);
--   * cópias ATUAIS das RPCs afetadas redefinidas (corpos copiados
--     das migrações-fonte, alterações pontuais):
--       - apply_import (015): started_at passa a marcar só com CONCLUIDO;
--       - get_production_rows (024): ordenação por coluna de processo
--         usa rank 1=CONCLUIDO, 2=NAO_INICIADO, senão 3;
--       - get_production_stats (024): saem os contadores inProgress e
--         blocked do agregado "processes" (UI atualizada em conjunto);
--       - get_production_rows_by_order (025): pior situação entre itens
--         vira rank 1=CONCLUIDO, 2=NAO_INICIADO; NAO_APLICAVEL segue
--         fora (célula "—").
--
-- Deploy: aplicar ANTES do deploy do código (os dropdowns encolhem no
-- mesmo pacote; código antigo continua válido com a lista maior).
-- -------------------------------------------------------------

-- 1) Dados (antes das constraints)
update public.production_processes
   set status = 'NAO_INICIADO'
 where status in ('EM_ANDAMENTO', 'BLOQUEADO');

update public.production_events
   set old_status = case when old_status in ('EM_ANDAMENTO', 'BLOQUEADO') then 'NAO_INICIADO' else old_status end,
       new_status = case when new_status in ('EM_ANDAMENTO', 'BLOQUEADO') then 'NAO_INICIADO' else new_status end
 where old_status in ('EM_ANDAMENTO', 'BLOQUEADO')
    or new_status in ('EM_ANDAMENTO', 'BLOQUEADO');

-- 2) Constraints (001) — drop + add com a lista de 3
alter table public.production_processes
  drop constraint if exists production_processes_status_check;
alter table public.production_processes
  add constraint production_processes_status_check
  check (status in ('NAO_INICIADO', 'CONCLUIDO', 'NAO_APLICAVEL'));

alter table public.production_events
  drop constraint if exists production_events_old_status_check;
alter table public.production_events
  add constraint production_events_old_status_check
  check (old_status is null or old_status in ('NAO_INICIADO', 'CONCLUIDO', 'NAO_APLICAVEL'));

alter table public.production_events
  drop constraint if exists production_events_new_status_check;
alter table public.production_events
  add constraint production_events_new_status_check
  check (new_status is null or new_status in ('NAO_INICIADO', 'CONCLUIDO', 'NAO_APLICAVEL'));

-- 3) RPCs


create or replace function public.apply_import(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_op jsonb;
  v_proc jsonb;
  v_action text;
  v_order_id uuid;
  v_item_id uuid;
  v_parent_item text;
  v_process_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_orders_created integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  if p_plan is null or jsonb_typeof(p_plan -> 'operations') <> 'array' then
    raise exception 'Plano de importação inválido.';
  end if;

  for v_op in select value from jsonb_array_elements(p_plan -> 'operations')
  loop
    v_action := v_op ->> 'action';

    if v_action is null or v_action = 'SKIP' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- -------------------------------------------------------
    -- Pedido (chave lógica: code)
    -- -------------------------------------------------------
    select o.id into v_order_id
      from public.orders o
     where o.code = (v_op #>> '{order,code}');

    if v_order_id is null then
      insert into public.orders (
        code, type, customer_name, description, order_date, delivery_date,
        status, created_by, updated_by
      )
      values (
        nullif(v_op #>> '{order,code}', ''),
        coalesce(nullif(v_op #>> '{order,type}', ''), 'OF'),
        nullif(v_op #>> '{order,customerName}', ''),
        nullif(v_op #>> '{order,description}', ''),
        public.parse_date(nullif(v_op #>> '{order,orderDate}', '')),
        public.parse_date(nullif(v_op #>> '{order,deliveryDate}', '')),
        coalesce(nullif(v_op #>> '{order,status}', ''), 'PLANEJADO'),
        v_user_id,
        v_user_id
      )
      on conflict (code) do nothing
      returning id into v_order_id;

      if v_order_id is null then
        -- corrida com outra inserção: reutiliza o pedido existente
        select o.id into v_order_id from public.orders o where o.code = (v_op #>> '{order,code}');
      else
        v_orders_created := v_orders_created + 1;
      end if;
    elsif v_action = 'UPDATE' then
      update public.orders
         set customer_name = coalesce(nullif(v_op #>> '{order,customerName}', ''), customer_name),
             description = coalesce(nullif(v_op #>> '{order,description}', ''), description),
             order_date = coalesce(public.parse_date(nullif(v_op #>> '{order,orderDate}', '')), order_date),
             delivery_date = coalesce(public.parse_date(nullif(v_op #>> '{order,deliveryDate}', '')), delivery_date),
             type = coalesce(nullif(v_op #>> '{order,type}', ''), type),
             status = coalesce(nullif(v_op #>> '{order,status}', ''), status),
             updated_by = v_user_id
       where id = v_order_id;
    end if;

    if v_order_id is null then
      raise exception 'Pedido não encontrado: %', v_op #>> '{order,code}';
    end if;

    -- -------------------------------------------------------
    -- Item do pedido
    -- -------------------------------------------------------
    v_parent_item := nullif(v_op #>> '{item,parentItem}', '');
    v_item_id := nullif(v_op ->> 'itemId', '')::uuid;

    if v_action = 'UPDATE' then
      if v_item_id is null then
        select oi.id into v_item_id
          from public.order_items oi
         where oi.order_id = v_order_id
           and (
             case
               when v_parent_item is not null then oi.parent_item = v_parent_item
               else oi.description = (v_op #>> '{item,description}')
             end
           )
         limit 1;
      end if;

      if v_item_id is null then
        -- item sumiu entre o plano e a execução: cria como novo
        v_action := 'CREATE';
      end if;
    end if;

    if v_action = 'UPDATE' then
      update public.order_items
         set family = coalesce(nullif(v_op #>> '{item,family}', ''), family),
             parent_item = coalesce(v_parent_item, parent_item),
             description = coalesce(nullif(v_op #>> '{item,description}', ''), description),
             quantity = coalesce(public.parse_numeric(nullif(v_op #>> '{item,quantity}', '')), quantity),
             unit_weight_kg = coalesce(public.parse_numeric(nullif(v_op #>> '{item,unitWeightKg}', '')), unit_weight_kg),
             total_weight_kg = coalesce(public.parse_numeric(nullif(v_op #>> '{item,totalWeightKg}', '')), total_weight_kg),
             delivery_date = coalesce(public.parse_date(nullif(v_op #>> '{item,deliveryDate}', '')), delivery_date),
             status = coalesce(nullif(v_op #>> '{item,status}', ''), status),
             -- chave {item,op} presente grava (null = limpa);
             -- ausente (planilha) preserva o valor atual (013)
             op = case when v_op -> 'item' ? 'op'
                       then nullif(v_op #>> '{item,op}', '')
                       else op
                  end,
             updated_by = v_user_id
       where id = v_item_id
         and order_id = v_order_id;

      if not found then
        raise exception 'Item de pedido inexistente na atualização.';
      end if;

      v_updated := v_updated + 1;
    else
      insert into public.order_items (
        order_id, family, parent_item, description, quantity, unit_weight_kg,
        total_weight_kg, delivery_date, status, op, created_by, updated_by
      )
      values (
        v_order_id,
        nullif(v_op #>> '{item,family}', ''),
        v_parent_item,
        nullif(v_op #>> '{item,description}', ''),
        public.parse_numeric(nullif(v_op #>> '{item,quantity}', '')),
        public.parse_numeric(nullif(v_op #>> '{item,unitWeightKg}', '')),
        public.parse_numeric(nullif(v_op #>> '{item,totalWeightKg}', '')),
        public.parse_date(nullif(v_op #>> '{item,deliveryDate}', '')),
        coalesce(nullif(v_op #>> '{item,status}', ''), 'PLANEJADO'),
        nullif(v_op #>> '{item,op}', ''),
        v_user_id,
        v_user_id
      )
      returning id into v_item_id;

      v_created := v_created + 1;
    end if;

    -- -------------------------------------------------------
    -- Processos do item (chave: order_item_id + process_id)
    -- -------------------------------------------------------
    if jsonb_typeof(coalesce(v_op -> 'item' -> 'processes', '[]'::jsonb)) = 'array' then
      for v_proc in select value from jsonb_array_elements(v_op -> 'item' -> 'processes')
      loop
        select pr.id into v_process_id
          from public.processes pr
         where pr.code = (v_proc ->> 'code')
           and pr.active;

        if v_process_id is null then
          -- processo desconhecido: não derruba a importação, apenas ignora
          continue;
        end if;

        insert into public.production_processes (
          order_item_id, process_id, status, quantity_planned, quantity_completed, notes
        )
        values (
          v_item_id,
          v_process_id,
          coalesce(nullif(v_proc ->> 'status', ''), 'NAO_INICIADO'),
          public.parse_numeric(nullif(v_proc ->> 'quantityPlanned', '')),
          public.parse_numeric(nullif(v_proc ->> 'quantityCompleted', '')),
          nullif(v_proc ->> 'notes', '')
        )
        on conflict (order_item_id, process_id) do update
          set status = case when v_action = 'UPDATE' then excluded.status else production_processes.status end,
              quantity_planned = case when v_action = 'UPDATE' then excluded.quantity_planned else production_processes.quantity_planned end,
              quantity_completed = case when v_action = 'UPDATE' then excluded.quantity_completed else production_processes.quantity_completed end,
              notes = case when v_action = 'UPDATE' then excluded.notes else production_processes.notes end,
              started_at = case
                when excluded.status = 'CONCLUIDO'
                  then coalesce(production_processes.started_at, now())
                else production_processes.started_at
              end,
              completed_at = case
                when excluded.status = 'CONCLUIDO'
                  then coalesce(production_processes.completed_at, now())
                else production_processes.completed_at
              end;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'ordersCreated', v_orders_created
  );
end;
$$;

revoke execute on function public.apply_import(jsonb) from anon;
grant execute on function public.apply_import(jsonb) to authenticated;

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
        pp.notes as pnotes
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
              'notes', r.pnotes
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
      coalesce(j.processes, '{}'::jsonb) as processes
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
      p_delivery_to;
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) to authenticated;

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
    'processes', pl.value
  )
  into v_result
  from orders_agg o, orders_by_status bs, delivery_agg d, expedition_agg e, process_load pl;

  return v_result;
end;
$$;

revoke execute on function public.get_production_stats(date) from anon;
grant execute on function public.get_production_stats(date) to authenticated;

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
        -- (melhor) … 2 = NAO_INICIADO (pior); NAO_APLICAVEL fica de fora
        -- (se não resta nada aplicável, max é null => célula "—").
        max(case s.pstatus
              when 'CONCLUIDO' then 1
              when 'NAO_INICIADO' then 2
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
                          when 2 then 'NAO_INICIADO'
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
