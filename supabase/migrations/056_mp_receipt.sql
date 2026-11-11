-- -------------------------------------------------------------
-- 056) Recebimento de matéria-prima (estilo romaneio)
--
-- A coluna MP deixa de ser marcada à mão: o recebimento é registrado
-- POR OF em `mp_receipts` (cabeçalho: nº, data, usuário) com os kg de
-- cada item RAIZ em `mp_receipt_items` — parcial ou total, em quantos
-- recibos forem necessários.
--
-- O processo MP continua existindo, mas passa a ser um ESPELHO
-- calculado a partir dos recibos (fonte de verdade):
--   * TOTAL      → status CONCLUIDO + completed_at;
--   * parcial/nenhum → status NAO_INICIADO (completed_at limpo);
--   * quantity_planned = peso planejado do item (total_weight_kg com
--     fallback qtd × peso unit.; sem peso fica null);
--   * quantity_completed = Σ dos kg recebidos.
-- Assim o DP (proposal-date), o status derivado e as telas antigas
-- continuam funcionando sem saber do novo fluxo. Cada mudança de
-- espelho gera um production_event.
--
-- REGRA DE SITUAÇÃO (por item): sem recebimento → nenhum; item SEM
-- peso recebido qualquer kg → TOTAL; com peso → TOTAL quando a soma
-- recebida cobre o planejado; no meio → parcial.
--
-- A coluna MP nas listas vira somente leitura (amarelo = parcial,
-- verde = total) e a cascata de processos (056/TS) não toca mais no
-- MP — a marcação antiga (gestão de OF, folha Fábrica 2, /pedidos)
-- também fica só de leitura.
-- -------------------------------------------------------------

create table if not exists public.mp_receipts (
  id            uuid primary key default gen_random_uuid(),
  -- Número sequencial do documento (referência no histórico).
  number        bigint generated always as identity,
  order_id      uuid not null references public.orders (id) on delete cascade,
  -- Data física do recebimento (default = hoje; registro é por dia).
  receipt_date  date not null default current_date,
  notes         text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_mp_receipts_order_id
  on public.mp_receipts (order_id);

create index if not exists idx_mp_receipts_number
  on public.mp_receipts (number);

-- -------------------------------------------------------------
-- Kg recebidos por item RAIZ neste recebimento (parcial por item).
-- -------------------------------------------------------------
create table if not exists public.mp_receipt_items (
  id             uuid primary key default gen_random_uuid(),
  mp_receipt_id  uuid not null references public.mp_receipts (id) on delete cascade,
  order_item_id  uuid not null references public.order_items (id) on delete cascade,
  quantity_kg    numeric not null check (quantity_kg > 0),
  created_at     timestamptz not null default now(),
  unique (mp_receipt_id, order_item_id)
);

create index if not exists idx_mp_receipt_items_receipt_id
  on public.mp_receipt_items (mp_receipt_id);

create index if not exists idx_mp_receipt_items_order_item_id
  on public.mp_receipt_items (order_item_id);

-- -------------------------------------------------------------
-- RLS: leitura para todos os autenticados; escrita para quem tem a
-- capacidade mp_receipt.edit (ADMIN/GESTOR/OPERADOR_F1). As tabelas
-- são append-only (sem policy de UPDATE): correção = excluir e
-- registrar de novo.
-- -------------------------------------------------------------
alter table public.mp_receipts enable row level security;
alter table public.mp_receipt_items enable row level security;

drop policy if exists "mp_receipts_select" on public.mp_receipts;
create policy "mp_receipts_select" on public.mp_receipts
  for select to authenticated using (true);

drop policy if exists "mp_receipts_insert" on public.mp_receipts;
create policy "mp_receipts_insert" on public.mp_receipts
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

drop policy if exists "mp_receipts_delete" on public.mp_receipts;
create policy "mp_receipts_delete" on public.mp_receipts
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

drop policy if exists "mp_receipt_items_select" on public.mp_receipt_items;
create policy "mp_receipt_items_select" on public.mp_receipt_items
  for select to authenticated using (true);

drop policy if exists "mp_receipt_items_insert" on public.mp_receipt_items;
create policy "mp_receipt_items_insert" on public.mp_receipt_items
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

drop policy if exists "mp_receipt_items_delete" on public.mp_receipt_items;
create policy "mp_receipt_items_delete" on public.mp_receipt_items
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

-- -------------------------------------------------------------
-- Helpers puros do espelho (estáveis — usados nas leituras).
-- -------------------------------------------------------------
-- Peso planejado do item: total_weight_kg com fallback
-- quantity × unit_weight_kg. Sem peso (ou peso 0) → null.
create or replace function public.mp_item_planned(p_order_item_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select nullif(
    greatest(
      coalesce(
        (select oi.total_weight_kg from public.order_items oi where oi.id = p_order_item_id),
        (select oi.quantity * oi.unit_weight_kg
           from public.order_items oi
          where oi.id = p_order_item_id)
      ),
      0
    ),
    0
  );
$$;

revoke execute on function public.mp_item_planned(uuid) from anon;
grant execute on function public.mp_item_planned(uuid) to authenticated;

-- Σ dos kg recebidos (soma de todos os recibos do item).
create or replace function public.mp_item_received(p_order_item_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(ri.quantity_kg), 0)
    from public.mp_receipt_items ri
   where ri.order_item_id = p_order_item_id;
$$;

revoke execute on function public.mp_item_received(uuid) from anon;
grant execute on function public.mp_item_received(uuid) to authenticated;

-- Situação do recebimento: NONE / PARCIAL / TOTAL.
create or replace function public.mp_item_state(p_order_item_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when public.mp_item_received(p_order_item_id) <= 0 then 'NONE'
    when public.mp_item_planned(p_order_item_id) is null then 'TOTAL'
    when public.mp_item_received(p_order_item_id) >= public.mp_item_planned(p_order_item_id)
      then 'TOTAL'
    else 'PARCIAL'
  end;
$$;

revoke execute on function public.mp_item_state(uuid) from anon;
grant execute on function public.mp_item_state(uuid) to authenticated;

-- -------------------------------------------------------------
-- Recalcula o ESPELHO do MP de um item a partir dos recibos:
-- situação, quantidades em kg e completed_at — com evento de
-- histórico quando algo muda.
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
  v_planned       numeric;
  v_received      numeric;
  v_state         text;
  v_target        text;
  v_pp_id         uuid;
  v_old_status    text;
  v_old_completed numeric;
begin
  v_planned  := public.mp_item_planned(p_order_item_id);
  v_received := public.mp_item_received(p_order_item_id);
  v_state := case
    when v_received <= 0 then 'NONE'
    when v_planned is null then 'TOTAL'
    when v_received >= v_planned then 'TOTAL'
    else 'PARCIAL'
  end;
  -- Espelho: só as duas posições (a regra do portão do MP continua valendo).
  v_target := case when v_state = 'TOTAL' then 'CONCLUIDO' else 'NAO_INICIADO' end;

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
           v_planned, v_received,
           case when v_target = 'CONCLUIDO' then now() else null end,
           case when v_target = 'CONCLUIDO' then now() else null end
      from public.processes pr
     where pr.code = 'MP'
    returning id into v_pp_id;

    -- Histórico só quando há o que contar (a linha nasceu com recebimento).
    if v_pp_id is not null and v_received > 0 then
      insert into public.production_events (
        production_process_id, user_id, event_type,
        old_status, new_status, old_quantity, new_quantity, notes
      )
      values (
        v_pp_id, p_user_id, 'STATUS_CHANGE',
        null, v_target, null, v_received,
        'Espelho do recebimento de MP (056)'
      );
    end if;
    return;
  end if;

  update public.production_processes
     set status = v_target,
         quantity_planned = v_planned,
         quantity_completed = v_received,
         completed_at = case
           when v_target = 'CONCLUIDO' then coalesce(completed_at, now())
           else null
         end
   where id = v_pp_id
     and (status is distinct from v_target
       or quantity_planned is distinct from v_planned
       or quantity_completed is distinct from v_received);

  if found and (v_old_status is distinct from v_target
     or v_old_completed is distinct from v_received) then
    insert into public.production_events (
      production_process_id, user_id, event_type,
      old_status, new_status, old_quantity, new_quantity, notes
    )
    values (
      v_pp_id, p_user_id,
      case when v_old_status is distinct from v_target then 'STATUS_CHANGE' else 'DATA_CHANGE' end,
      v_old_status, v_target, v_old_completed, v_received,
      'Espelho do recebimento de MP (056)'
    );
  end if;
end;
$$;

revoke execute on function public.mp_receipt_sync_item(uuid, uuid) from anon;
grant execute on function public.mp_receipt_sync_item(uuid, uuid) to authenticated;

-- -------------------------------------------------------------
-- save_mp_receipt: cria o cabeçalho, grava os kg por item RAIZ e
-- recalcula o espelho de cada item tocado — tudo numa transação.
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
  v_qty          numeric;
  v_touched      uuid[] := '{}';
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

    if not exists (
      select 1 from public.order_items oi
       where oi.id = v_item_id
         and oi.order_id = p_order_id
         and oi.parent_order_item_id is null
    ) then
      raise exception 'Item não pertence a esta OF ou não é item raiz';
    end if;

    insert into public.mp_receipt_items (mp_receipt_id, order_item_id, quantity_kg)
    values (v_id, v_item_id, v_qty);

    v_touched := array_append(v_touched, v_item_id);
  end loop;

  foreach v_item_id in array v_touched
  loop
    perform public.mp_receipt_sync_item(v_item_id, v_user_id);
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_number, 'receiptDate', v_date);
end;
$$;

revoke execute on function public.save_mp_receipt(uuid, text, jsonb) from anon;
grant execute on function public.save_mp_receipt(uuid, text, jsonb) to authenticated;

-- -------------------------------------------------------------
-- delete_mp_receipt: exclusão para correção — apaga o recibo e
-- recalcula o espelho dos itens afetados (a soma volta ao estado
-- anterior).
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
  end loop;

  return jsonb_build_object('id', p_receipt_id, 'orderId', v_order_id);
end;
$$;

revoke execute on function public.delete_mp_receipt(uuid) from anon;
grant execute on function public.delete_mp_receipt(uuid) to authenticated;

-- -------------------------------------------------------------
-- get_mp_receipt_customers: seletor em cascata de /recebimento-mp —
-- clientes com OFs que ainda têm pendência de MP (algum item raiz
-- não totalmente recebido). Mesmo formato do get_romaneio_customers.
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
               -- Itens raiz ainda sem receber totalmente.
               count(*) filter (where public.mp_item_state(oi.id) <> 'TOTAL')::bigint
                 as pending_items,
               -- Kg pendentes (null quando nenhum item raiz tem peso).
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
           and oi.parent_order_item_id is null
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
