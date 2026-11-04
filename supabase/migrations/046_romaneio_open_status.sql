-- -------------------------------------------------------------
-- 046) Romaneio — MONTADO → ABERTO
--
-- Renomeia o primeiro status do ciclo de vida do romaneio
-- (ABERTO → CONFERIDO → CONFIRMADO → CANCELADO). O valor passa a ser
-- ABERTO porque o romaneio nasce em edição livre (rascunho aberto) e
-- só depois vira "conferido" — "montado" confundia com o kit montado
-- da produção.
--
-- ORDEM IMPORTA (banco com dados pré-existentes), mesmo padrão da 045:
--   1) DROP do constraint antigo libera a coluna para o valor novo;
--   2) UPDATE migra os dados existentes (MONTADO → ABERTO);
--   3) ADD do constraint novo — o ADD valida as linhas existentes, que
--      já estão com o status novo. UPDATE antes do DROP viola o
--      constraint antigo (23514); ADD antes do UPDATE viola com as
--      linhas ainda nos status antigos.
--
-- As RPCs abaixo são recriadas (mesma assinatura → `create or replace`
-- preserva os grants; reaplicamos revoke/grant por segurança). A 045
-- fica intacta como histórico.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Status: MONTADO → ABERTO.
-- -------------------------------------------------------------
alter table public.romaneios drop constraint if exists romaneios_status_check;

update public.romaneios set status = 'ABERTO' where status = 'MONTADO';

alter table public.romaneios add constraint romaneios_status_check
  check (status in ('ABERTO', 'CONFERIDO', 'CONFIRMADO', 'CANCELADO'));

-- Apenas UM romaneio em aberto por OF (expedição parcial sem
-- duplicidade de rascunho) — mesmos dados, predicado novo.
drop index if exists idx_romaneios_one_open_per_order;
create unique index if not exists idx_romaneios_one_open_per_order
  on public.romaneios (order_id)
  where status = 'ABERTO';

-- -------------------------------------------------------------
-- RPC: save_romaneio — cria/atualiza um romaneio em ABERTO,
-- substituindo itens e materiais em UMA transação.
--
-- Validações: OF existe e não está cancelada; só se edita ABERTO;
-- itens precisam pertencer à OF e não exceder a quantidade do item;
-- materiais respeitam a coerência de saldo.
-- -------------------------------------------------------------
create or replace function public.save_romaneio(
  p_romaneio_id uuid,
  p_order_id uuid,
  p_shipment_date date,
  p_carrier text,
  p_vehicle text,
  p_notes text,
  p_items jsonb,
  p_materials jsonb
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
  v_status       text;
  v_item         jsonb;
  v_material     jsonb;
  v_item_id      uuid;
  v_qty          numeric;
  v_item_total   numeric;
  v_is_root      boolean;
  v_desc         text;
  v_unit         text;
  v_planned      numeric;
  v_received     numeric;
  v_used         numeric;
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
    raise exception 'Não é possível criar romaneio de uma OF cancelada.';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de itens inválida';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Máximo de 500 itens por romaneio';
  end if;

  if jsonb_typeof(coalesce(p_materials, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de materiais inválida';
  end if;
  if jsonb_array_length(p_materials) > 200 then
    raise exception 'Máximo de 200 linhas de material por romaneio';
  end if;

  if p_romaneio_id is null then
    if exists (
      select 1 from public.romaneios r
      where r.order_id = p_order_id and r.status = 'ABERTO'
    ) then
      raise exception 'Já existe um romaneio em aberto para esta OF.';
    end if;

    insert into public.romaneios (
      order_id, status, shipment_date, carrier, vehicle, notes, created_by
    )
    values (
      p_order_id,
      'ABERTO',
      p_shipment_date,
      nullif(trim(coalesce(p_carrier, '')), ''),
      nullif(trim(coalesce(p_vehicle, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      v_user_id
    )
    returning id, number into v_id, v_number;
  else
    select r.id, r.status into v_id, v_status
      from public.romaneios r
     where r.id = p_romaneio_id;

    if v_id is null then
      raise exception 'Romaneio não encontrado.';
    end if;
    if v_status <> 'ABERTO' then
      raise exception 'Somente romaneios em aberto podem ser editados. Exclua ou cancele o romaneio para recomeçar.';
    end if;

    update public.romaneios
       set shipment_date = p_shipment_date,
           carrier = nullif(trim(coalesce(p_carrier, '')), ''),
           vehicle = nullif(trim(coalesce(p_vehicle, '')), ''),
           notes = nullif(trim(coalesce(p_notes, '')), ''),
           updated_by = v_user_id
     where id = v_id
     returning number into v_number;

    -- O UPDATE passa pelo RLS: 0 linhas = sem permissão de edição.
    if v_number is null then
      raise exception 'Sem permissão para editar o romaneio (ADMIN/GESTOR).';
    end if;
  end if;

  -- -------------------------------------------------------
  -- Itens: substitui a lista (valida dono e quantidade).
  -- -------------------------------------------------------
  delete from public.romaneio_items where romaneio_id = v_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_item_id := (v_item ->> 'orderItemId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Item inválido';
    end;

    begin
      v_qty := (v_item ->> 'quantity')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade inválida no item';
    end;

    if coalesce(v_qty, 0) <= 0 then
      raise exception 'Quantidade inválida no item';
    end if;

    select oi.quantity, (oi.parent_order_item_id is null) into v_item_total, v_is_root
      from public.order_items oi
     where oi.id = v_item_id
       and oi.order_id = p_order_id;

    if v_item_total is null then
      raise exception 'Item não pertence a esta OF';
    end if;
    if not coalesce(v_is_root, false) then
      raise exception 'Somente itens raiz podem entrar no romaneio';
    end if;
    if v_qty > v_item_total then
      raise exception 'Quantidade maior que a disponível do item';
    end if;

    insert into public.romaneio_items (romaneio_id, order_item_id, quantity)
    values (v_id, v_item_id, v_qty);
  end loop;

  -- -------------------------------------------------------
  -- Materiais: substitui a lista (informados pelo usuário).
  -- -------------------------------------------------------
  delete from public.romaneio_materials where romaneio_id = v_id;

  for v_material in select value from jsonb_array_elements(p_materials)
  loop
    v_desc := nullif(trim(v_material ->> 'description'), '');
    if v_desc is null then
      raise exception 'Material sem descrição';
    end if;

    v_unit := coalesce(upper(nullif(trim(v_material ->> 'unit'), '')), 'UN');
    if v_unit not in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC') then
      v_unit := 'UN';
    end if;

    begin
      v_planned := nullif(trim(coalesce(v_material ->> 'quantityPlanned', '')), '')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade prevista inválida no material %', v_desc;
    end;
    if v_planned is null or v_planned < 0 then
      v_planned := 0;
    end if;

    begin
      v_received := nullif(trim(coalesce(v_material ->> 'quantityReceived', '')), '')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade recebida inválida no material %', v_desc;
    end;
    if v_received is not null and v_received < 0 then
      raise exception 'Quantidade recebida inválida no material %', v_desc;
    end if;

    begin
      v_used := nullif(trim(coalesce(v_material ->> 'quantityUsed', '')), '')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade utilizada inválida no material %', v_desc;
    end;
    if v_used is not null and v_used < 0 then
      raise exception 'Quantidade utilizada inválida no material %', v_desc;
    end if;

    if v_used is not null and v_received is not null and v_used > v_received then
      raise exception 'Material %: a quantidade utilizada não pode exceder a recebida', v_desc;
    end if;

    insert into public.romaneio_materials (
      romaneio_id, description, unit, quantity_planned, quantity_received, quantity_used
    )
    values (v_id, v_desc, v_unit, v_planned, v_received, v_used);
  end loop;

  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

revoke execute on function public.save_romaneio(uuid, uuid, date, text, text, text, jsonb, jsonb) from anon;
grant execute on function public.save_romaneio(uuid, uuid, date, text, text, text, jsonb, jsonb) to authenticated;

-- -------------------------------------------------------------
-- RPC: sign_romaneio_conference — sinaliza o ACEITE da conferência
-- (quem, quando e observação) e move o romaneio para CONFERIDO.
-- Re-sinalizar em um romaneio já CONFERIDO atualiza o registro do
-- aceite (mesma folha impressa conferida novamente).
-- -------------------------------------------------------------
create or replace function public.sign_romaneio_conference(
  p_romaneio_id uuid,
  p_notes text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status  text;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.status into v_status from public.romaneios r where r.id = p_romaneio_id;
  if v_status is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status not in ('ABERTO', 'CONFERIDO') then
    raise exception 'A conferência só pode ser sinalizada em romaneios abertos.';
  end if;

  update public.romaneios
     set status = case when v_status = 'ABERTO' then 'CONFERIDO' else v_status end,
         conference_accepted_at = now(),
         conference_accepted_by = v_user_id,
         conference_notes = nullif(trim(coalesce(p_notes, '')), ''),
         updated_by = v_user_id
   where id = p_romaneio_id;

  if not found then
    raise exception 'Sem permissão para editar o romaneio (ADMIN/GESTOR).';
  end if;
end;
$$;

revoke execute on function public.sign_romaneio_conference(uuid, text) from anon;
grant execute on function public.sign_romaneio_conference(uuid, text) to authenticated;

-- -------------------------------------------------------------
-- RPC: delete_romaneio — EXCLUSÃO DEFINITIVA de um romaneio em
-- ABERTO (antes da conferência; itens/materiais caem em cascata).
-- Depois disso o caminho é o cancelamento (CONFERIDO/CONFIRMADO).
-- -------------------------------------------------------------
create or replace function public.delete_romaneio(p_romaneio_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status  text;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.status into v_status from public.romaneios r where r.id = p_romaneio_id;
  if v_status is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status <> 'ABERTO' then
    raise exception 'Somente romaneios em aberto podem ser excluídos. Cancele o romaneio para reverter.';
  end if;

  -- O DELETE passa pelo RLS (ADMIN/GESTOR) — 0 linhas = sem permissão.
  delete from public.romaneios where id = p_romaneio_id;
  if not found then
    raise exception 'Sem permissão para excluir o romaneio (ADMIN/GESTOR).';
  end if;
end;
$$;

revoke execute on function public.delete_romaneio(uuid) from anon;
grant execute on function public.delete_romaneio(uuid) to authenticated;

-- -------------------------------------------------------------
-- RPC: cancel_romaneio — CANCELADO libera a baixa (o expedido é
-- derivado só dos CONFIRMADOS, então o romaneio sai do somatório e a
-- pendência da OF se restaura sozinha). Permitido em CONFERIDO e
-- CONFIRMADO; em ABERTO o caminho é a exclusão definitiva.
-- -------------------------------------------------------------
create or replace function public.cancel_romaneio(p_romaneio_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_status  text;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.status into v_status from public.romaneios r where r.id = p_romaneio_id;

  if v_status is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status = 'CANCELADO' then
    raise exception 'Romaneio já cancelado.';
  end if;
  if v_status not in ('CONFERIDO', 'CONFIRMADO') then
    raise exception 'Romaneios em aberto são excluídos, não cancelados.';
  end if;

  update public.romaneios
     set status = 'CANCELADO',
         updated_by = v_user_id
   where id = p_romaneio_id;

  if not found then
    raise exception 'Sem permissão para cancelar o romaneio (ADMIN/GESTOR).';
  end if;
end;
$$;

revoke execute on function public.cancel_romaneio(uuid) from anon;
grant execute on function public.cancel_romaneio(uuid) to authenticated;

-- -------------------------------------------------------------
-- get_romaneio_candidates (recria a da 045): já expedida = Σ de
-- itens em romaneios CONFIRMADOS; romaneio aberto = status ABERTO.
-- Só o corpo mudou (mesmo retorno) → `create or replace` basta.
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
  has_open boolean,
  open_romaneio_id uuid
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
       where r.status = 'CONFIRMADO'
       group by r.order_id
    ),
    open_romaneios as (
      select r.order_id as ord_id, r.id as open_romaneio_id
        from public.romaneios r
       where r.status = 'ABERTO'
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
             o2.open_romaneio_id as open_romaneio_id
        from public.orders o
        join root_agg ra on ra.ord_id = o.id
        left join shipped s on s.ord_id = o.id
        left join open_romaneios o2 on o2.ord_id = o.id
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
           (f.open_romaneio_id is not null) as has_open,
           f.open_romaneio_id as open_romaneio_id
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
