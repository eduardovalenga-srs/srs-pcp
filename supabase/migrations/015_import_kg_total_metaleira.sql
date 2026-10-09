-- -------------------------------------------------------------
-- 015) Importação: coluna KG TOTAL + processo METALEIRA
--
--   1. order_items.total_weight_kg: peso total do item (KG),
--      coluna nova alimentada pela planilha (campo KG TOTAL).
--      Obrigatório? não — opcional como o peso unitário, >= 0.
--   2. Processo METALEIRA: etapa da fábrica que faltava no seed
--      (a planilha da casa tem PUNC e METALEIRA como processos
--      distintos). Idempotente: se já foi cadastrado na tela de
--      processos, não faz nada.
--   3. apply_import passa a gravar {item,totalWeightKg}:
--      presente grava, vazio/nulo preserva o valor atual
--      (mesma semântica de unitWeightKg). Assinatura inalterada,
--      então basta CREATE OR REPLACE.
-- -------------------------------------------------------------

alter table public.order_items
  add column if not exists total_weight_kg numeric,
  drop constraint if exists order_items_total_weight_kg_check,
  add constraint order_items_total_weight_kg_check
    check (total_weight_kg is null or total_weight_kg >= 0);

-- Processo METALEIRA (55 = entre PUNC 50 e FICEP 60, igual à
-- ordem das colunas da planilha da casa).
insert into public.processes (code, name, display_order, active)
values ('METALEIRA', 'METALEIRA', 55, true)
on conflict (code) do nothing;

-- -------------------------------------------------------------
-- apply_import (cópia da 013 + totalWeightKg no item)
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
