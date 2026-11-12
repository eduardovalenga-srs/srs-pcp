-- -------------------------------------------------------------
-- 060) Material FORA DA OF na NOTA DE ENTRADA
--
-- A nota de entrada (059) passa a aceitar, além dos materiais da
-- OF, uma lista OPCIONAL de itens livres: matéria-prima que chegou
-- mas não pertence à OF em conferência (descrição + unidade de
-- medida + quantidade).
--
-- É SÓ REGISTRO: o item livre não entra em mp_order_materials,
-- mp_order_material_plan nem mp_order_material_allocation — não
-- mexe no saldo da OF nem no espelho da coluna MP (o portão da
-- produção). Ele fica no histórico da nota, como rastro do que
-- entrou.
--
-- A nota pode conter:
--   * só materiais da OF (comportamento da 059);
--   * só itens fora da OF;
--   * os dois juntos (mesmo nº e mesma data).
--
-- Grão: mp_receipt_free_items (uma linha por item da nota).
-- A chave normalizada (mp_material_key) impede repetir o mesmo
-- item (mesma descrição + unidade) na MESMA nota.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Linhas de material fora da OF.
--    A lista de unidades é a MESMA de src/lib/constants/materials.ts
--    (MATERIAL_UNITS) — manter em sincronia.
-- -------------------------------------------------------------
create table if not exists public.mp_receipt_free_items (
  id            uuid primary key default gen_random_uuid(),
  mp_receipt_id uuid not null references public.mp_receipts (id) on delete cascade,
  -- Chave normalizada (descrição + unidade em maiúsculas).
  material_key  text not null check (length(btrim(material_key)) > 0),
  description   text not null
                check (length(btrim(description)) > 0 and length(description) <= 200),
  unit          text not null
                check (unit in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC')),
  quantity      numeric not null check (quantity > 0),
  created_at    timestamptz not null default now(),
  unique (mp_receipt_id, material_key)
);

create index if not exists idx_mp_receipt_free_items_receipt_id
  on public.mp_receipt_free_items (mp_receipt_id);

alter table public.mp_receipt_free_items enable row level security;

-- Leitura para quem já acessa o recebimento; escrita pelos mesmos
-- perfis da nota (ADMIN/GESTOR/OPERADOR_F1). Sem update: a nota é
-- append-only — corrigir = excluir a nota e relançar.
drop policy if exists "mp_receipt_free_items_select" on public.mp_receipt_free_items;
create policy "mp_receipt_free_items_select" on public.mp_receipt_free_items
  for select to authenticated using (true);

drop policy if exists "mp_receipt_free_items_insert" on public.mp_receipt_free_items;
create policy "mp_receipt_free_items_insert" on public.mp_receipt_free_items
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

drop policy if exists "mp_receipt_free_items_delete" on public.mp_receipt_free_items;
create policy "mp_receipt_free_items_delete" on public.mp_receipt_free_items
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

-- -------------------------------------------------------------
-- 2) Gravar a NOTA DE ENTRADA com os itens fora da OF.
--
--    A assinatura ganha o 6º parâmetro (p_free_items, default []).
--    O overload de 5 parâmetros é DROPADO: com o default, chamar a
--    RPC com 5 argumentos casaria com as duas versões (ambiguidade).
--
--    Regras:
--      * a nota precisa ter ao menos um material da OF OU um item
--        fora da OF (não existe nota vazia);
--      * material da OF: precisa existir no plano da OF e kg > 0
--        (mesma regra da 059);
--      * item fora da OF: descrição obrigatória (≤ 200), unidade da
--        lista do projeto, quantidade > 0 e sem repetir
--        descrição+unidade na mesma nota.
-- -------------------------------------------------------------
drop function if exists public.save_mp_receipt(uuid, text, date, text, jsonb);

create or replace function public.save_mp_receipt(
  p_order_id uuid,
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
  v_order_status text;
  v_id           uuid;
  v_number       bigint;
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

  insert into public.mp_receipts (order_id, entry_number, entry_date, notes, created_by)
  values (
    p_order_id,
    v_entry_number,
    v_entry_date,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  )
  returning id, number into v_id, v_number;

  -- Materiais DA OF (grão MATERIAL desde a 059).
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
      select 1 from public.mp_order_material_plan(p_order_id) p
       where p.material_key = v_key
    ) then
      raise exception 'Matéria-prima % não pertence a esta OF', v_desc;
    end if;

    if exists (
      select 1 from public.mp_receipt_materials rm
       where rm.mp_receipt_id = v_id
         and rm.material_key = v_key
    ) then
      raise exception 'Material repetido na nota de entrada: %', v_desc;
    end if;

    insert into public.mp_receipt_materials (
      mp_receipt_id, material_key, material_description, material_unit, quantity_kg
    )
    values (v_id, v_key, v_desc, v_unit, v_qty);
  end loop;

  -- Materiais FORA DA OF (só registro — não alimentam saldo/espelho).
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
       where fi.mp_receipt_id = v_id
         and fi.material_key = v_key
    ) then
      raise exception 'Material repetido fora da OF: %', v_desc;
    end if;

    insert into public.mp_receipt_free_items (
      mp_receipt_id, material_key, description, unit, quantity
    )
    values (v_id, v_key, v_desc, v_unit, v_qty);
  end loop;

  -- Só os materiais DA OF mexem no espelho (os livres não entram).
  perform public.mp_receipt_sync_order(p_order_id, v_user_id);

  return jsonb_build_object(
    'id', v_id,
    'number', v_number,
    'entryNumber', v_entry_number,
    'entryDate', v_entry_date,
    'freeItems', jsonb_array_length(v_free_items)
  );
end;
$$;

revoke execute on function public.save_mp_receipt(uuid, text, date, text, jsonb, jsonb) from anon;
grant execute on function public.save_mp_receipt(uuid, text, date, text, jsonb, jsonb) to authenticated;
