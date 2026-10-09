-- =============================================================
-- 006_functions.sql
-- Funções RPC da aplicação (executadas pelo Supabase via cliente JS).
--
-- Todas são SECURITY INVOKER: rodam com as permissões do usuário
-- autenticado e, portanto, respeitam as policies de RLS.
-- =============================================================

-- -------------------------------------------------------------
-- 0) Helpers de conversão usados pela importação
--    Aceitam formatos brasileiros ("80,5", "1.234,56") e datas
--    em DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD.
-- -------------------------------------------------------------
create or replace function public.parse_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v text;
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  v := btrim(p_value);
  v := replace(v, 'kg', '');
  v := btrim(v);

  if position(',' in v) > 0 and position('.' in v) > 0 then
    if position(',' in v) > position('.' in v) then
      -- 1.234,56
      v := replace(regexp_replace(v, '\.', '', 'g'), ',', '.');
    else
      -- 1,234.56
      v := replace(v, ',', '');
    end if;
  elsif position(',' in v) > 0 then
    v := replace(v, ',', '.');
  end if;

  if v !~ '^-?\d+(\.\d+)?$' then
    raise exception 'Número inválido: %', p_value;
  end if;

  return v::numeric;
end;
$$;

create or replace function public.parse_date(p_value text)
returns date
language plpgsql
immutable
as $$
declare
  v text;
  m text[];
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  v := btrim(p_value);

  m := regexp_match(v, '^(\d{4})[-/](\d{1,2})[-/](\d{1,2})');
  if m is not null then
    return make_date(m[1]::int, m[2]::int, m[3]::int);
  end if;

  m := regexp_match(v, '^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})');
  if m is not null then
    return make_date(m[3]::int, m[2]::int, m[1]::int);
  end if;

  raise exception 'Data inválida: %', p_value;
end;
$$;

revoke execute on function public.parse_numeric(text) from anon;
revoke execute on function public.parse_date(text) from anon;
grant execute on function public.parse_numeric(text) to authenticated;
grant execute on function public.parse_date(text) to authenticated;

-- -------------------------------------------------------------
-- 1) Bootstrap do primeiro administrador
-- (nenhum ADMIN existe ainda -> o usuário logado se declara ADMIN)
-- -------------------------------------------------------------
create or replace function public.claim_first_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin_count integer;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select count(*) into v_admin_count from public.profiles where role = 'ADMIN';

  if v_admin_count > 0 then
    return jsonb_build_object('claimed', false, 'message', 'Já existe um administrador cadastrado.');
  end if;

  update public.profiles
     set role = 'ADMIN', updated_at = now()
   where id = v_uid;

  return jsonb_build_object('claimed', true, 'message', 'Você agora é administrador do sistema.');
end;
$$;

revoke execute on function public.claim_first_admin() from anon;
grant execute on function public.claim_first_admin() to authenticated;

-- -------------------------------------------------------------
-- 2) Listagem da tela de produção (filtros, ordenação, paginação)
--    A regra de atraso é aplicada no banco: delivery_date < hoje
--    AND processo de expedição (EXP) <> CONCLUIDO.
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
  p_limit integer default 50
)
returns table (
  total_count bigint,
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
  -- ---------------------------------------------------------
  -- Ordenação com whitelist (nunca concatena entrada do usuário)
  -- ---------------------------------------------------------
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

  -- ---------------------------------------------------------
  -- Query principal
  -- ---------------------------------------------------------
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
        oi.delivery_date as deliv,
        oi.status as item_status,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where ($2 is null or o.status = $2)
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
          -- filtro de entrega
          case $5
            when 'OVERDUE' then
              oi.delivery_date is not null and oi.delivery_date < $6::date
              and not exists (
                select 1 from process_rows x
                where x.pid = oi.id and x.pcode = 'EXP' and x.pstatus = 'CONCLUIDO'
              )
            when 'TODAY' then oi.delivery_date = $6::date
            when 'NEXT_7_DAYS' then oi.delivery_date >= $6::date and oi.delivery_date <= (($6::date + 7))
            when 'NEXT_30_DAYS' then oi.delivery_date >= $6::date and oi.delivery_date <= (($6::date + 30))
            else true
          end
        )
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
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.overdue, j.processes
    from joined j
  $q$;

  -- Ordenação montada apenas com expressões de whitelist / quote_literal
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
      greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer) to authenticated;

-- -------------------------------------------------------------
-- 3) Estatísticas do dashboard (KPIs, processos e entregas)
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
    'totalItems', (select count(*) from public.order_items),
    'itemsByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select oi.status as status, count(*) as cnt
          from public.order_items oi
          group by oi.status
        ) s
      ),
      '{}'::jsonb
    ),
    'itemsInProduction', (
      select count(*) from public.order_items oi where oi.status = 'EM_PRODUCAO'
    ),
    'itemsDone', (
      select count(*) from public.order_items oi where oi.status = 'CONCLUIDO'
    ),
    'itemsOverdue', (
      select count(*)
      from public.order_items oi
      where oi.delivery_date is not null
        and oi.delivery_date < v_today
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
        'overdue', count(*) filter (
          where oi.delivery_date < v_today
            and not exists (
              select 1 from public.production_processes pp
              join public.processes pr on pr.id = pp.process_id
              where pp.order_item_id = oi.id and pr.code = 'EXP' and pp.status = 'CONCLUIDO'
            )
        ),
        'today', count(*) filter (where oi.delivery_date = v_today),
        'next7', count(*) filter (where oi.delivery_date > v_today and oi.delivery_date <= (v_today + 7)),
        'next30', count(*) filter (where oi.delivery_date > (v_today + 7) and oi.delivery_date <= (v_today + 30))
      )
      from public.order_items oi
      where oi.delivery_date is not null
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
            count(*) filter (where pp.status <> 'NAO_APLICAVEL') as total,
            count(*) filter (where pp.status = 'NAO_INICIADO') as pending,
            count(*) filter (where pp.status = 'EM_ANDAMENTO') as in_progress,
            count(*) filter (where pp.status = 'BLOQUEADO') as blocked,
            count(*) filter (where pp.status = 'CONCLUIDO') as done
          from public.processes p
          left join public.production_processes pp on pp.process_id = p.id
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

-- -------------------------------------------------------------
-- 4) Aplicação da importação em uma única transação
--    Recebe o plano já validado pela camada de serviço:
--      { "operations": [ { "action": "CREATE|UPDATE|SKIP",
--                          "order": {...}, "item": {...}, "itemId": "..." } ] }
--    Qualquer erro lança exceção e TODA a importação sofre rollback.
-- -------------------------------------------------------------
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
             delivery_date = coalesce(public.parse_date(nullif(v_op #>> '{item,deliveryDate}', '')), delivery_date),
             status = coalesce(nullif(v_op #>> '{item,status}', ''), status),
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
        delivery_date, status, created_by, updated_by
      )
      values (
        v_order_id,
        nullif(v_op #>> '{item,family}', ''),
        v_parent_item,
        nullif(v_op #>> '{item,description}', ''),
        public.parse_numeric(nullif(v_op #>> '{item,quantity}', '')),
        public.parse_numeric(nullif(v_op #>> '{item,unitWeightKg}', '')),
        public.parse_date(nullif(v_op #>> '{item,deliveryDate}', '')),
        coalesce(nullif(v_op #>> '{item,status}', ''), 'PLANEJADO'),
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
                when excluded.status in ('EM_ANDAMENTO', 'CONCLUIDO')
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
