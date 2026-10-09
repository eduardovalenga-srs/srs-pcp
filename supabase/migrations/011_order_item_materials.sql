-- -------------------------------------------------------------
-- 011) Matérias-primas por sub-item
--
-- Modelo (3 níveis):
--   OF (orders) -> sub-itens (order_items) -> matéria-prima (aqui)
--
-- A matéria-prima é um INSUMO consumido pelo sub-item: descrição,
-- quantidade e unidade. NÃO tem processos fabris nem entra na grade
-- item × processo da gestão de entregas (a compra/composição é um
-- dado do pedido, não uma etapa de produção).
--
-- Inserção manual: formulário de pedido e tela de detalhes da OF,
-- sempre via RPC replace_item_materials (troca a lista do item em
-- UMA transação). Importação de planilha de materiais = evolução
-- futura (mesma chave OF + item pai).
-- -------------------------------------------------------------

create table if not exists public.order_item_materials (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references public.order_items (id) on delete cascade,
  description    text not null check (length(trim(description)) > 0),
  quantity       numeric not null check (quantity > 0),
  unit           text not null default 'UN'
                 check (unit in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace trigger order_item_materials_set_updated_at
  before update on public.order_item_materials
  for each row execute function public.set_updated_at();

create index if not exists idx_order_item_materials_order_item_id
  on public.order_item_materials (order_item_id);

-- -------------------------------------------------------------
-- RLS: leitura para todos os autenticados; escrita para quem
-- edita pedidos (ADMIN/GESTOR — capacidade orders.edit).
-- -------------------------------------------------------------
alter table public.order_item_materials enable row level security;

drop policy if exists "order_item_materials_select" on public.order_item_materials;
create policy "order_item_materials_select" on public.order_item_materials
  for select to authenticated using (true);

drop policy if exists "order_item_materials_insert" on public.order_item_materials;
create policy "order_item_materials_insert" on public.order_item_materials
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "order_item_materials_update" on public.order_item_materials;
create policy "order_item_materials_update" on public.order_item_materials
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "order_item_materials_delete" on public.order_item_materials;
create policy "order_item_materials_delete" on public.order_item_materials
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']));

-- -------------------------------------------------------------
-- RPC: substitui a lista de materiais de um sub-item.
-- Obrigatório ser array; máximo 50; validação de descrição e
-- quantidade (as constraints da tabela são a última trava).
-- -------------------------------------------------------------
create or replace function public.replace_item_materials(
  p_item_id uuid,
  p_materials jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int := 0;
  v_mat   jsonb;
  v_desc  text;
  v_qty   numeric;
begin
  if not exists (select 1 from public.order_items where id = p_item_id) then
    raise exception 'Item não encontrado';
  end if;

  if jsonb_typeof(coalesce(p_materials, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de materiais inválida';
  end if;

  if jsonb_array_length(p_materials) > 50 then
    raise exception 'Máximo de 50 materiais por item';
  end if;

  -- Substitui a lista inteira (mesmo padrão do save do pedido).
  delete from public.order_item_materials where order_item_id = p_item_id;

  for v_mat in select value from jsonb_array_elements(p_materials)
  loop
    v_desc := nullif(trim(v_mat ->> 'description'), '');
    if v_desc is null then
      raise exception 'Material sem descrição';
    end if;

    begin
      v_qty := (v_mat ->> 'quantity')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade inválida no material %', v_desc;
    end;

    if coalesce(v_qty, 0) <= 0 then
      raise exception 'Quantidade inválida no material %', v_desc;
    end if;

    insert into public.order_item_materials (order_item_id, description, quantity, unit, notes)
    values (
      p_item_id,
      v_desc,
      v_qty,
      coalesce(nullif(trim(v_mat ->> 'unit'), ''), 'UN'),
      nullif(trim(v_mat ->> 'notes'), '')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.replace_item_materials(uuid, jsonb) from anon;
grant execute on function public.replace_item_materials(uuid, jsonb) to authenticated;
