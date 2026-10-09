-- -------------------------------------------------------------
-- 013) Ordem de Produção (OP) por item
--
--   - order_items.op: código da OP vinculada ao sub-item.
--     null (em branco) = a item está "em espera"; com OP = "em produção".
--     Sem backfill: as OFs existentes ficam em branco e o código da OP
--     é preenchido quando a ordem de produção for criada.
--   - apply_import ganha a chave {item,op}: presente grava/limpa,
--     ausente (planilha) preserva o valor atual.
--   - get_production_rows passa a expor a coluna "op" e aceitar a
--     ordenação por ela. O tipo de retorno muda, então a função é
--     removida e recriada (CREATE OR REPLACE não altera RETURNS TABLE).
-- -------------------------------------------------------------

alter table public.order_items
  add column op text,
  add constraint order_items_op_check
    check (op is null or (btrim(op) <> '' and char_length(op) <= 50));

-- -------------------------------------------------------------
-- get_production_rows (cópia da 007 + coluna "op" e ordenação por ela)
-- -------------------------------------------------------------

drop function if exists public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric);

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
  p_weight_max numeric default null
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
        oi.op as op,
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
        -- -----------------------------------------------------
        -- Filtros por coluna (007): "contém" e faixas numéricas
        -- -----------------------------------------------------
        and ($9 is null or o.code ilike '%' || $9 || '%')
        and ($10 is null or coalesce(o.customer_name, '') ilike '%' || $10 || '%')
        and ($11 is null or coalesce(oi.family, '') ilike '%' || $11 || '%')
        and ($12 is null or coalesce(oi.parent_item, '') ilike '%' || $12 || '%')
        and ($13 is null or oi.description ilike '%' || $13 || '%')
        and ($14 is null or oi.quantity >= $14)
        and ($15 is null or oi.quantity <= $15)
        and ($16 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg >= $16))
        and ($17 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg <= $17))
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
      j.op, j.overdue, j.processes
    from joined j
  $q$;

  -- Ordenação montada apenas com expressões de whitelist / quote_literal
  v_sql := v_sql
    || ' order by ' || v_sort_expr || ' ' || v_sort_dir
    || ' nulls last, j.ord_code asc, j.parent_item asc nulls last, j.item_id asc'
    || ' limit $7 offset $8';

  -- Ordem do USING: $1..$8 = filtros originais + paginação,
  -- $9..$17 = filtros de coluna (texto depois de trim, faixas como numeric)
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
      p_weight_max;
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric) to authenticated;

-- -------------------------------------------------------------
-- apply_import (cópia da 006 + gravação de {item,op})
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
        delivery_date, status, op, created_by, updated_by
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

-- -------------------------------------------------------------
-- refresh_order_statuses (013)
--
-- Grava o status DERIVADO do item e re-deriva o status da OF.
--
-- Por que SECURITY DEFINER: a derivação roda durante a atualização de um
-- processo (Gestão de Entregas) e o OPERADOR tem production.update_status,
-- mas a RLS de order_items/orders é só ADMIN/GESTOR — sem esta RPC o
-- status derivado do OPERADOR falhava com 42501.
--
-- A escrita é blindada por papel e por faixa de valores; CANCELADO na OF
-- nunca é sobrescrito (mesma regra da camada de serviço, 013).
-- -------------------------------------------------------------
create or replace function public.refresh_order_statuses(
  p_item_id uuid,
  p_item_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_status text;
  v_next text;
begin
  if not public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR']) then
    raise exception 'Sem permissão para atualizar o status do item.';
  end if;

  if p_item_status not in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO') then
    raise exception 'Status de item inválido: %', p_item_status;
  end if;

  update public.order_items
     set status = p_item_status, updated_at = now()
   where id = p_item_id;

  if not found then
    raise exception 'Item de pedido não encontrado.';
  end if;

  select oi.order_id, o.status
    into v_order_id, v_order_status
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.id = p_item_id;

  if v_order_status = 'CANCELADO' then
    return;
  end if;

  -- Mesma precedência de deriveOrderStatus (camada de serviço):
  -- todos concluídos -> CONCLUIDO; algum em produção -> EM_PRODUCAO; senão Em espera.
  select case
           when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
           when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
           else 'PLANEJADO'
         end
    into v_next
    from public.order_items oi
   where oi.order_id = v_order_id;

  if v_next is distinct from v_order_status then
    update public.orders set status = v_next, updated_at = now() where id = v_order_id;
  end if;
end;
$$;

revoke execute on function public.refresh_order_statuses(uuid, text) from anon;
grant execute on function public.refresh_order_statuses(uuid, text) to authenticated;
