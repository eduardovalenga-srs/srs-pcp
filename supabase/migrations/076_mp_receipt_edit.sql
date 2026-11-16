-- Permite editar uma nota de entrada já registrada, mantendo o número
-- sequencial e o usuário que originalmente criou o lançamento.
grant update (entry_number, entry_date, notes)
  on table public.mp_receipts to authenticated;

drop policy if exists "mp_receipts_update" on public.mp_receipts;
create policy "mp_receipts_update" on public.mp_receipts
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']))
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

create or replace function public.update_mp_receipt(
  p_receipt_id uuid,
  p_entry_number text,
  p_entry_date date,
  p_notes text,
  p_materials jsonb,
  p_free_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_order_id     uuid;
  v_entry_number text;
  v_entry_date   date;
  v_materials    jsonb := coalesce(p_materials, '[]'::jsonb);
  v_free_items   jsonb := coalesce(p_free_items, '[]'::jsonb);
  v_line         jsonb;
  v_desc         text;
  v_unit         text;
  v_key          text;
  v_qty          numeric;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  if p_receipt_id is null then
    raise exception 'Nota de entrada inválida.';
  end if;

  select r.order_id into v_order_id
    from public.mp_receipts r
   where r.id = p_receipt_id
   for update;
  if v_order_id is null then
    raise exception 'Nota de entrada não encontrada.';
  end if;

  v_entry_number := nullif(trim(coalesce(p_entry_number, '')), '');
  if v_entry_number is null then
    raise exception 'Informe o número da nota de entrada.';
  end if;
  v_entry_date := coalesce(p_entry_date, current_date);

  if jsonb_typeof(v_materials) <> 'array' then
    raise exception 'Lista de materiais inválida';
  end if;
  if jsonb_typeof(v_free_items) <> 'array' then
    raise exception 'Lista de materiais fora da OF inválida';
  end if;
  if jsonb_array_length(v_materials) = 0 and jsonb_array_length(v_free_items) = 0 then
    raise exception 'Informe ao menos um material';
  end if;
  if jsonb_array_length(v_materials) > 500 then
    raise exception 'Máximo de 500 materiais por nota de entrada';
  end if;
  if jsonb_array_length(v_free_items) > 200 then
    raise exception 'Máximo de 200 materiais fora da OF por nota de entrada';
  end if;

  update public.mp_receipts
     set entry_number = v_entry_number,
         entry_date = v_entry_date,
         notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_receipt_id;

  delete from public.mp_receipt_materials where mp_receipt_id = p_receipt_id;
  delete from public.mp_receipt_free_items where mp_receipt_id = p_receipt_id;

  -- Materiais da OF: cada chave precisa continuar pertencendo ao plano da OF.
  for v_line in select value from jsonb_array_elements(v_materials)
  loop
    v_key := nullif(trim(coalesce(v_line ->> 'materialKey', '')), '');
    v_desc := nullif(trim(coalesce(v_line ->> 'description', '')), '');
    v_unit := nullif(trim(coalesce(v_line ->> 'unit', '')), '');
    if v_key is null or v_desc is null or v_unit is null then
      raise exception 'Material inválido na nota de entrada';
    end if;

    begin
      v_qty := (v_line ->> 'quantityKg')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade inválida no material %', v_desc;
    end;
    if coalesce(v_qty, 0) <= 0 then
      raise exception 'Quantidade inválida no material %', v_desc;
    end if;
    if not exists (
      select 1 from public.mp_order_material_plan(v_order_id) p
       where p.material_key = v_key
    ) then
      raise exception 'Matéria-prima % não pertence a esta OF', v_desc;
    end if;
    if exists (
      select 1 from public.mp_receipt_materials rm
       where rm.mp_receipt_id = p_receipt_id
         and rm.material_key = v_key
    ) then
      raise exception 'Material repetido na nota de entrada: %', v_desc;
    end if;

    insert into public.mp_receipt_materials (
      mp_receipt_id, material_key, material_description, material_unit, quantity_kg
    )
    values (p_receipt_id, v_key, v_desc, v_unit, v_qty);
  end loop;

  -- Itens fora da OF são apenas informativos e não alteram o espelho.
  for v_line in select value from jsonb_array_elements(v_free_items)
  loop
    v_desc := nullif(btrim(coalesce(v_line ->> 'description', '')), '');
    if v_desc is null then
      raise exception 'Informe a descrição do material fora da OF.';
    end if;
    if length(v_desc) > 200 then
      raise exception 'Descrição do material fora da OF muito longa (máx. 200 caracteres).';
    end if;

    v_unit := upper(nullif(btrim(coalesce(v_line ->> 'unit', '')), ''));
    if v_unit is null then
      raise exception 'Informe a unidade de medida do material %', v_desc;
    end if;
    if v_unit not in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC') then
      raise exception 'Unidade de medida inválida no material fora da OF: %', v_desc;
    end if;

    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade inválida no material fora da OF %', v_desc;
    end;
    if coalesce(v_qty, 0) <= 0 then
      raise exception 'Quantidade inválida no material fora da OF %', v_desc;
    end if;

    v_key := public.mp_material_key(v_desc, v_unit);
    if exists (
      select 1 from public.mp_receipt_free_items fi
       where fi.mp_receipt_id = p_receipt_id
         and fi.material_key = v_key
    ) then
      raise exception 'Material repetido fora da OF: %', v_desc;
    end if;

    insert into public.mp_receipt_free_items (
      mp_receipt_id, material_key, description, unit, quantity
    )
    values (p_receipt_id, v_key, v_desc, v_unit, v_qty);
  end loop;

  perform public.mp_receipt_sync_order(v_order_id, v_user_id);

  return jsonb_build_object(
    'id', p_receipt_id,
    'orderId', v_order_id,
    'entryNumber', v_entry_number,
    'entryDate', v_entry_date,
    'freeItems', jsonb_array_length(v_free_items)
  );
end;
$$;

revoke execute on function public.update_mp_receipt(uuid, text, date, text, jsonb, jsonb) from anon;
grant execute on function public.update_mp_receipt(uuid, text, date, text, jsonb, jsonb) to authenticated;
