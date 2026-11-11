-- -------------------------------------------------------------
-- 057) Recebimento de MP por item FILHO + espelho agregado no PAI
--
-- A tela /recebimento-mp passa a listar os ITENS FILHOS da OF (os
-- componentes que concentram a matéria-prima que compõe o pai) e os
-- itens pai SEM filhos (material direto no pai — caso previsto no
-- importador, "Sem itens filhos (material direto no pai)"). O
-- lançamento continua um registro por ação, com kg por linha (056).
--
-- O que muda:
--   * save_mp_receipt aceita as MESMAS linhas elegíveis da tela
--     (filho, ou raiz SEM filhos) e passa a rejeitar raiz COM filhos
--     — o lançamento direto no pai não existe mais quando há filho;
--   * o espelho do PAI vira o AGREGADO dos filhos: verde (CONCLUIDO)
--     só quando TODOS os filhos estão TOTAL; kg = Σ dos filhos + os
--     recibos antigos já lançados no pai (legado, não se perde);
--     planejado = Σ dos planejados dos filhos (null se algum filho
--     não tem peso) — mesma regra de aggregateMpReceipts (TS);
--     pai SEM filhos mantém a regra antiga (peso/recebimento próprios);
--   * get_mp_receipt_customers conta as LINHAS ELEGÍVEIS (filhos +
--     raízes sem filhos) na pendência da OF;
--   * backfill silêncioso (sem production_events) recalcula a célula
--     MP dos pais que têm filhos — sem isso o espelho antigo (peso
--     próprio do pai) só mudaria no próximo recebimento da OF.
--
-- Os auxiliares puros da 056 continuam válidos para QUALQUER item:
-- mp_item_planned / mp_item_received / mp_item_state valem por item
-- (filho usa o próprio peso e os próprios recibos).
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) mp_receipt_apply: NÚCLEO do espelho (extraído do corpo da
--    mp_receipt_sync_item da 056) — grava situação, quantidades e
--    completed_at na célula MP do item, criando a linha se faltar,
--    com production_event quando algo muda.
-- -------------------------------------------------------------
create or replace function public.mp_receipt_apply(
  p_order_item_id uuid,
  p_planned numeric,
  p_received numeric,
  p_state text,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target        text;
  v_pp_id         uuid;
  v_old_status    text;
  v_old_completed numeric;
begin
  -- Espelho: só as duas posições (a regra do portão do MP continua valendo).
  v_target := case when p_state = 'TOTAL' then 'CONCLUIDO' else 'NAO_INICIADO' end;

  select pp.id, pp.status, pp.quantity_completed
    into v_pp_id, v_old_status, v_old_completed
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
   where pp.order_item_id = p_order_item_id
     and pr.code = 'MP';

  if v_pp_id is null then
    -- Linha ausente nasce já espelhando o recebimento (MP é obrigatório).
    insert into public.production_processes (
      order_item_id, process_id, status,
      quantity_planned, quantity_completed, started_at, completed_at
    )
    select p_order_item_id, pr.id, v_target,
           p_planned, p_received,
           case when v_target = 'CONCLUIDO' then now() else null end,
           case when v_target = 'CONCLUIDO' then now() else null end
      from public.processes pr
     where pr.code = 'MP'
    returning id into v_pp_id;

    -- Histórico só quando há o que contar (a linha nasceu com recebimento).
    if v_pp_id is not null and p_received > 0 then
      insert into public.production_events (
        production_process_id, user_id, event_type,
        old_status, new_status, old_quantity, new_quantity, notes
      )
      values (
        v_pp_id, p_user_id, 'STATUS_CHANGE',
        null, v_target, null, p_received,
        'Espelho do recebimento de MP (056)'
      );
    end if;
    return;
  end if;

  update public.production_processes
     set status = v_target,
         quantity_planned = p_planned,
         quantity_completed = p_received,
         completed_at = case
           when v_target = 'CONCLUIDO' then coalesce(completed_at, now())
           else null
         end
   where id = v_pp_id
     and (status is distinct from v_target
       or quantity_planned is distinct from p_planned
       or quantity_completed is distinct from p_received);

  if found and (v_old_status is distinct from v_target
     or v_old_completed is distinct from p_received) then
    insert into public.production_events (
      production_process_id, user_id, event_type,
      old_status, new_status, old_quantity, new_quantity, notes
    )
    values (
      v_pp_id, p_user_id,
      case when v_old_status is distinct from v_target then 'STATUS_CHANGE' else 'DATA_CHANGE' end,
      v_old_status, v_target, v_old_completed, p_received,
      'Espelho do recebimento de MP (056)'
    );
  end if;
end;
$$;

revoke execute on function public.mp_receipt_apply(uuid, numeric, numeric, text, uuid) from anon;
grant execute on function public.mp_receipt_apply(uuid, numeric, numeric, text, uuid) to authenticated;

-- -------------------------------------------------------------
-- 2) mp_receipt_sync_item: espelho do PRÓPRIO item (filho na tela,
--    ou pai sem filhos no fallback) — regra inalterada da 056.
-- -------------------------------------------------------------
create or replace function public.mp_receipt_sync_item(
  p_order_item_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_planned  numeric;
  v_received numeric;
  v_state    text;
begin
  v_planned  := public.mp_item_planned(p_order_item_id);
  v_received := public.mp_item_received(p_order_item_id);
  v_state := case
    when v_received <= 0 then 'NONE'
    when v_planned is null then 'TOTAL'
    when v_received >= v_planned then 'TOTAL'
    else 'PARCIAL'
  end;

  perform public.mp_receipt_apply(p_order_item_id, v_planned, v_received, v_state, p_user_id);
end;
$$;

revoke execute on function public.mp_receipt_sync_item(uuid, uuid) from anon;
grant execute on function public.mp_receipt_sync_item(uuid, uuid) to authenticated;

-- -------------------------------------------------------------
-- 3) mp_receipt_sync_parent: espelho do PAI agregando os FILHOS.
--
--    * sem filhos → regra antiga do próprio item (fallback);
--    * com filhos:
--      - received = Σ mp_item_received(filho) + recibos legados no pai;
--      - planned  = Σ mp_item_planned(filho), null se ALGUM filho não
--        tem peso (Σ só quando todos têm — regra do aggregateMpReceipts);
--      - state    = pior caso dos filhos (+ estado próprio do pai só
--        quando ele tem kg legado): todos TOTAL → TOTAL; algum recebido
--        → PARCIAL; senão NONE.
-- -------------------------------------------------------------
create or replace function public.mp_receipt_sync_parent(
  p_parent_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_child_count    bigint;
  v_without_weight bigint;
  v_not_total      bigint;
  v_with_receipt   bigint;
  v_children_kg    numeric;
  v_children_planned numeric;
  v_own_received   numeric;
  v_own_planned    numeric;
  v_planned        numeric;
  v_received       numeric;
  v_state          text;
begin
  select count(*),
         count(*) filter (where public.mp_item_planned(c.id) is null),
         count(*) filter (where public.mp_item_state(c.id) <> 'TOTAL'),
         count(*) filter (where public.mp_item_received(c.id) > 0),
         coalesce(sum(public.mp_item_received(c.id)), 0),
         sum(public.mp_item_planned(c.id))
    into v_child_count, v_without_weight, v_not_total, v_with_receipt,
         v_children_kg, v_children_planned
    from public.order_items c
   where c.parent_order_item_id = p_parent_id;

  -- Pai sem filhos: comportamento anterior (peso/recebimento próprios).
  if coalesce(v_child_count, 0) = 0 then
    perform public.mp_receipt_sync_item(p_parent_id, p_user_id);
    return;
  end if;

  -- Recibos antigos lançados no próprio pai continuam somando aqui.
  v_own_received := public.mp_item_received(p_parent_id);
  v_own_planned  := public.mp_item_planned(p_parent_id);
  v_received := v_children_kg + coalesce(v_own_received, 0);
  v_planned := case when v_without_weight = 0 then v_children_planned end;

  v_state := case
    when v_not_total = 0
      and (coalesce(v_own_received, 0) <= 0
           or v_own_planned is null
           or v_own_received >= v_own_planned)
      then 'TOTAL'
    when v_with_receipt > 0 or coalesce(v_own_received, 0) > 0 then 'PARCIAL'
    else 'NONE'
  end;

  perform public.mp_receipt_apply(p_parent_id, v_planned, v_received, v_state, p_user_id);
end;
$$;

revoke execute on function public.mp_receipt_sync_parent(uuid, uuid) from anon;
grant execute on function public.mp_receipt_sync_parent(uuid, uuid) to authenticated;

-- -------------------------------------------------------------
-- 4) save_mp_receipt: aceita as linhas elegíveis da tela (filho ou
--    raiz sem filhos) e espelha filho + pai de cada item gravado.
-- -------------------------------------------------------------
create or replace function public.save_mp_receipt(
  p_order_id uuid,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_order_status text;
  v_id           uuid;
  v_number       bigint;
  v_date         date := current_date;
  v_item         jsonb;
  v_item_id      uuid;
  v_parent_id    uuid;
  v_qty          numeric;
  v_touched      uuid[] := '{}';
  v_parents      uuid[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  if p_order_id is null then
    raise exception 'Pedido inválido.';
  end if;

  select o.status into v_order_status from public.orders o where o.id = p_order_id;
  if v_order_status is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_order_status = 'CANCELADO' then
    raise exception 'Não é possível registrar recebimento de uma OF cancelada.';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de itens inválida';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'Informe ao menos um item recebido';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Máximo de 500 itens por recebimento';
  end if;

  insert into public.mp_receipts (order_id, receipt_date, notes, created_by)
  values (
    p_order_id,
    v_date,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  )
  returning id, number into v_id, v_number;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := (v_item ->> 'orderItemId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Item inválido';
    end;

    begin
      v_qty := (v_item ->> 'quantityKg')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade inválida no item';
    end;

    if coalesce(v_qty, 0) <= 0 then
      raise exception 'Quantidade inválida no item';
    end if;

    if v_item_id = any(v_touched) then
      raise exception 'Item repetido no recebimento';
    end if;

    -- Elegível = filho, ou raiz SEM filhos (mesma regra da tela 057).
    if not exists (
      select 1 from public.order_items oi
       where oi.id = v_item_id
         and oi.order_id = p_order_id
         and (oi.parent_order_item_id is not null
              or not exists (
                select 1 from public.order_items c
                 where c.parent_order_item_id = oi.id))
    ) then
      raise exception 'Item não pertence a esta OF ou não é elegível para recebimento de MP';
    end if;

    insert into public.mp_receipt_items (mp_receipt_id, order_item_id, quantity_kg)
    values (v_id, v_item_id, v_qty);

    v_touched := array_append(v_touched, v_item_id);
  end loop;

  foreach v_item_id in array v_touched
  loop
    perform public.mp_receipt_sync_item(v_item_id, v_user_id);

    -- Filho tocado: o pai tem que refluir o agregado (057).
    select c.parent_order_item_id into v_parent_id
      from public.order_items c
     where c.id = v_item_id;
    if v_parent_id is not null and not (v_parent_id = any(v_parents)) then
      v_parents := array_append(v_parents, v_parent_id);
    end if;
  end loop;

  foreach v_parent_id in array v_parents
  loop
    perform public.mp_receipt_sync_parent(v_parent_id, v_user_id);
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_number, 'receiptDate', v_date);
end;
$$;

revoke execute on function public.save_mp_receipt(uuid, text, jsonb) from anon;
grant execute on function public.save_mp_receipt(uuid, text, jsonb) to authenticated;

-- -------------------------------------------------------------
-- 5) delete_mp_receipt: exclusão para correção — apaga o recibo e
--    recalcula o espelho dos itens afetados e dos seus pais.
-- -------------------------------------------------------------
create or replace function public.delete_mp_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_item_ids uuid[];
  v_item_id uuid;
  v_parent_id uuid;
  v_parents uuid[] := '{}';
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  if p_receipt_id is null then
    raise exception 'Recebimento inválido.';
  end if;

  select r.order_id into v_order_id
    from public.mp_receipts r
   where r.id = p_receipt_id;
  if v_order_id is null then
    raise exception 'Recebimento não encontrado.';
  end if;

  select array_agg(distinct ri.order_item_id) into v_item_ids
    from public.mp_receipt_items ri
   where ri.mp_receipt_id = p_receipt_id;

  delete from public.mp_receipts r
   where r.id = p_receipt_id;
  -- UPDATE/DELETE passam pelo RLS: 0 linhas = sem permissão.
  if not found then
    raise exception 'Sem permissão para excluir este recebimento (ADMIN/GESTOR/OPERADOR_F1).';
  end if;

  foreach v_item_id in array coalesce(v_item_ids, '{}'::uuid[])
  loop
    perform public.mp_receipt_sync_item(v_item_id, v_user_id);

    select c.parent_order_item_id into v_parent_id
      from public.order_items c
     where c.id = v_item_id;
    if v_parent_id is not null and not (v_parent_id = any(v_parents)) then
      v_parents := array_append(v_parents, v_parent_id);
    end if;
  end loop;

  foreach v_parent_id in array v_parents
  loop
    perform public.mp_receipt_sync_parent(v_parent_id, v_user_id);
  end loop;

  return jsonb_build_object('id', p_receipt_id, 'orderId', v_order_id);
end;
$$;

revoke execute on function public.delete_mp_receipt(uuid) from anon;
grant execute on function public.delete_mp_receipt(uuid) to authenticated;

-- -------------------------------------------------------------
-- 6) get_mp_receipt_customers: a pendência da OF passa a contar as
--    LINHAS ELEGÍVEIS da tela (itens filhos + raízes sem filhos).
-- -------------------------------------------------------------
create or replace function public.get_mp_receipt_customers()
returns table (
  customer_name text,
  of_count bigint,
  ofs jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return query
    select nullif(trim(o.customer_name), '') as customer_name,
           count(*)::bigint as of_count,
           jsonb_agg(
             jsonb_build_object(
               'order_id', o.id,
               'code', o.code,
               'type', o.type,
               'delivery_date', o.delivery_date,
               'status', o.status,
               'pending_items', o.pending_items,
               'pending_kg', o.pending_kg
             )
             order by o.delivery_date asc nulls last, o.code asc
           ) as ofs
      from (
        select o.id,
               o.code,
               o.type,
               o.delivery_date,
               o.status,
               o.customer_name,
               -- Linhas ainda sem receber totalmente (filho ou raiz sem filhos).
               count(*) filter (where public.mp_item_state(oi.id) <> 'TOTAL')::bigint
                 as pending_items,
               -- Kg pendentes (null quando nenhuma linha tem peso).
               nullif(
                 sum(
                   case when public.mp_item_planned(oi.id) is not null then
                     greatest(
                       public.mp_item_planned(oi.id) - public.mp_item_received(oi.id),
                       0
                     )
                   end
                 ),
                 0
               ) as pending_kg
          from public.orders o
          join public.order_items oi
            on oi.order_id = o.id
           and (oi.parent_order_item_id is not null
                or not exists (
                  select 1 from public.order_items c
                   where c.parent_order_item_id = oi.id))
         where o.status <> 'CANCELADO'
         group by o.id
        having count(*) filter (where public.mp_item_state(oi.id) <> 'TOTAL') > 0
      ) o
     group by 1
     order by 1 asc nulls last;
end;
$$;

revoke execute on function public.get_mp_receipt_customers() from anon;
grant execute on function public.get_mp_receipt_customers() to authenticated;

-- -------------------------------------------------------------
-- 7) Backfill silêncioso: a célula MP dos pais que têm filhos passa
--    a espelhar o AGREGADO (057). Sem production_events — é correção
--    de leitura do espelho, não um evento de produção percebido.
-- -------------------------------------------------------------
with children as (
  select oi.parent_order_item_id as parent_id,
         count(*) filter (where public.mp_item_planned(oi.id) is null) as without_weight,
         count(*) filter (where public.mp_item_state(oi.id) <> 'TOTAL') as not_total,
         count(*) filter (where public.mp_item_received(oi.id) > 0) as with_receipt,
         coalesce(sum(public.mp_item_received(oi.id)), 0) as children_kg,
         sum(public.mp_item_planned(oi.id)) as children_planned
    from public.order_items oi
   where oi.parent_order_item_id is not null
   group by oi.parent_order_item_id
),
own as (
  select oi.id as parent_id,
         public.mp_item_received(oi.id) as own_received,
         public.mp_item_planned(oi.id) as own_planned
    from public.order_items oi
   where exists (
     select 1 from public.order_items c
      where c.parent_order_item_id = oi.id
   )
),
agg as (
  select c.parent_id,
         (c.children_kg + coalesce(o.own_received, 0)) as received,
         case when c.without_weight = 0 then c.children_planned end as planned,
         case
           when c.not_total = 0
             and (coalesce(o.own_received, 0) <= 0
                  or o.own_planned is null
                  or o.own_received >= o.own_planned)
             then 'TOTAL'
           when c.with_receipt > 0 or coalesce(o.own_received, 0) > 0 then 'PARCIAL'
           else 'NONE'
         end as state
    from children c
    left join own o on o.parent_id = c.parent_id
)
update public.production_processes pp
   set status = case when agg.state = 'TOTAL' then 'CONCLUIDO' else 'NAO_INICIADO' end,
       quantity_planned = agg.planned,
       quantity_completed = agg.received,
       completed_at = case
         when agg.state = 'TOTAL' then coalesce(pp.completed_at, now())
         else null
       end
  from agg
 where pp.order_item_id = agg.parent_id
   and exists (
     select 1 from public.processes p
      where p.id = pp.process_id and p.code = 'MP'
   )
   and (pp.status is distinct from case when agg.state = 'TOTAL' then 'CONCLUIDO' else 'NAO_INICIADO' end
     or pp.quantity_planned is distinct from agg.planned
     or pp.quantity_completed is distinct from agg.received);
