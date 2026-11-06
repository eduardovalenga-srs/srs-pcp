-- -------------------------------------------------------------
-- 052) Romaneio — save_romaneio_conference grava materiais com UPSERT
--
-- A RPC 048 atualizava apenas linhas EXISTENTES em romaneio_materials
-- (update com chave descrição+unidade): uma linha da ficha que ainda
-- não existisse no banco (material alocado que o save_romaneio ainda
-- não persistiu) era ignorada EM SILENCÍCIO e o lançamento da RECEBIDA
-- se perdia — o usuário salvava e o valor não aparecia.
--
-- Agora a gravação é um UPSERT pela chave (romaneio_id, description,
-- unit), que é unique desde a 042:
--   - linha NOVA nasce com o previsto do payload (quantityPlanned,
--     ausente = 0) e a recebida/utilizada informadas;
--   - linha EXISTENTE continua atualizando SÓ recebida/utilizada (o
--     previsto em ABERTO é derivado da alocação na leitura e é
--     regravado a cada Salvar do detalhe — o payload da ficha pode
--     vir defasado e não deve sobrescrevê-lo).
--
-- O restante da RPC (validações, marcação por item, cabeçalho e o
-- gate de ABERTO/permissão) permanece igual à 048.
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
  v_planned   numeric;
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

  -- Materiais: UPSERT pela chave (romaneio_id, description, unit) —
  -- linha que ainda não exista NASCE aqui (052); a existente atualiza
  -- recebida/utilizada e mantém o previsto gravado.
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
    values (p_romaneio_id, v_desc, v_unit, v_planned, v_received, v_used)
    on conflict (romaneio_id, description, unit)
    do update set
      quantity_received = excluded.quantity_received,
      quantity_used = excluded.quantity_used;
  end loop;
end;
$$;

revoke execute on function public.save_romaneio_conference(uuid, text, uuid[], jsonb, boolean) from anon;
grant execute on function public.save_romaneio_conference(uuid, text, uuid[], jsonb, boolean) to authenticated;
