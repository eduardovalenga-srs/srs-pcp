-- -------------------------------------------------------------
-- 048) Romaneio — a ficha de conferência vira FORMULÁRIO
--
-- A conferência passa a ser lançada na própria ficha
-- (/romaneio/[id]/conferencia): marcação por item, quantidades de
-- material (recebida/utilizada) e observação, com rascunho ou
-- conclusão (ABERTO → CONFERIDO) numa única transação.
--
-- O que muda:
--   1) romaneio_items ganha conference_checked (a marcação por item);
--   2) save_romaneio é recriada PRESERVANDO a marcação — o replace de
--      itens (delete + insert) apagaria a coluna nova a cada edição do
--      cabeçalho/itens no detalhe;
--   3) sign_romaneio_conference é removida (substituída pela nova RPC
--      abaixo — só a action antiga a usava);
--   4) save_romaneio_conference grava marcação + materiais + observação
--      e, com p_sign = true, conclui a conferência. Só romaneios em
--      ABERTO aceitam escrita (após CONFERIDO a ficha vira leitura —
--      correção = cancelar e recriar). Concluir exige ao menos um item
--      e TODOS marcados como conferidos.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Marcação de conferência por item.
-- -------------------------------------------------------------
alter table public.romaneio_items
  add column if not exists conference_checked boolean not null default false;

-- -------------------------------------------------------------
-- 2) save_romaneio — recriada preservando conference_checked.
--    O replace de itens (delete + insert) reinicia a coluna nova;
--    o snapshot por order_item_id antes do delete mantém a marcação
--    dos itens que continuam na carga (novos entram desmarcados).
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
  v_checks       jsonb;
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
  -- A marcação de conferência (048) sobrevive ao replace.
  -- -------------------------------------------------------
  select coalesce(
           jsonb_object_agg(ri.order_item_id::text, ri.conference_checked),
           '{}'::jsonb
         )
    into v_checks
    from public.romaneio_items ri
   where ri.romaneio_id = v_id;

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

    insert into public.romaneio_items (romaneio_id, order_item_id, quantity, conference_checked)
    values (
      v_id,
      v_item_id,
      v_qty,
      coalesce((v_checks ->> v_item_id::text)::boolean, false)
    );
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
-- 3) sign_romaneio_conference — substituída por
--    save_romaneio_conference (ficha como formulário).
-- -------------------------------------------------------------
drop function if exists public.sign_romaneio_conference(uuid, text);

-- -------------------------------------------------------------
-- 4) RPC: save_romaneio_conference — grava a conferência na ficha:
--    marcação por item, recebida/utilizada dos materiais e
--    observação. Rascunho (p_sign = false) mantém o romaneio em
--    ABERTO; concluir (p_sign = true) move para CONFERIDO e exige
--    ao menos um item e TODOS marcados. Tudo numa transação — ou
--    grava tudo, ou nada. Só se edita em ABERTO (048).
-- -------------------------------------------------------------
create or replace function public.save_romaneio_conference(
  p_romaneio_id uuid,
  p_notes text,
  p_checked_item_ids uuid[],
  p_materials jsonb,
  p_sign boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_status    text;
  v_material  jsonb;
  v_desc      text;
  v_unit      text;
  v_received  numeric;
  v_used      numeric;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.status into v_status from public.romaneios r where r.id = p_romaneio_id;
  if v_status is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status <> 'ABERTO' then
    raise exception 'A conferência só pode ser editada em romaneios em aberto.';
  end if;

  if jsonb_typeof(coalesce(p_materials, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de materiais inválida';
  end if;
  if jsonb_array_length(p_materials) > 200 then
    raise exception 'Máximo de 200 linhas de material por romaneio';
  end if;

  -- Concluir exige ao menos um item e que o payload marque TODOS (a
  -- gravação é o próprio payload — estado do banco pode vir defasado).
  if p_sign then
    if not exists (
      select 1 from public.romaneio_items ri where ri.romaneio_id = p_romaneio_id
    ) then
      raise exception 'Inclua ao menos um item no romaneio antes de concluir a conferência.';
    end if;
    if exists (
      select 1 from public.romaneio_items ri
       where ri.romaneio_id = p_romaneio_id
         and not (ri.order_item_id = any(coalesce(p_checked_item_ids, array[]::uuid[])))
    ) then
      raise exception 'Marque todos os itens como conferidos antes de concluir a conferência.';
    end if;
  end if;

  -- Cabeçalho: permissão (RLS ADMIN/GESTOR — 0 linhas = sem
  -- permissão) + situação e registro do aceite.
  update public.romaneios
     set status = case when p_sign then 'CONFERIDO' else status end,
         conference_accepted_at = case when p_sign then now() else conference_accepted_at end,
         conference_accepted_by = case when p_sign then v_user_id else conference_accepted_by end,
         conference_notes = nullif(trim(coalesce(p_notes, '')), ''),
         updated_by = v_user_id
   where id = p_romaneio_id
     and status = 'ABERTO';

  if not found then
    raise exception 'Sem permissão para editar o romaneio (ADMIN/GESTOR).';
  end if;

  -- Itens: grava a marcação de conferência desta rodada.
  update public.romaneio_items
     set conference_checked = (order_item_id = any(coalesce(p_checked_item_ids, array[]::uuid[])))
   where romaneio_id = p_romaneio_id;

  -- Materiais: atualiza recebida/utilizada das linhas existentes
  -- (chave descrição + unidade). Linhas que não existam mais são
  -- ignoradas — a lista da ficha pode estar defasada em relação ao
  -- romaneio.
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

    update public.romaneio_materials
       set quantity_received = v_received,
           quantity_used = v_used
     where romaneio_id = p_romaneio_id
       and description = v_desc
       and unit = v_unit;
  end loop;
end;
$$;

revoke execute on function public.save_romaneio_conference(uuid, text, uuid[], jsonb, boolean) from anon;
grant execute on function public.save_romaneio_conference(uuid, text, uuid[], jsonb, boolean) to authenticated;
