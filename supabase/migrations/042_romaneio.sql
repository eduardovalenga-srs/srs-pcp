-- -------------------------------------------------------------
-- 042) Romaneio de expedição
--
-- Um romaneio organiza a EXPEDIÇÃO DE UMA OF: quais itens (raiz) e
-- quantidades saem em cada carga, apoiando a emissão da(s) NF(s) e o
-- cálculo da devolução de matéria-prima ao cliente.
--
-- Devolução de MP (saldo = recebida do cliente − utilizada na
-- produção) é gravada POR ROMANEIO em `romaneio_materials`, com as
-- quantidades informadas pelo usuário; o saldo é derivado na leitura.
--
-- Status:
--   SIMULACAO — rascunho livre: pode ser montado mesmo com itens
--               não concluídos (expedição organizada com antecedência);
--   EMITIDO   — travado: só os números de NF continuam editáveis;
--   CANCELADO — histórico (libera as quantidades expedidas da OF).
--
-- Expedição PARCIAL: vários romaneios por OF. O índice único abaixo
-- garante apenas UM rascunho (SIMULACAO) aberto por OF — os demais
-- romaneios são emitidos/cancelados. O teto de expedição (Σ emitido
-- ≤ qtd do item) é validado na emissão (emit_romaneio).
--
-- Emissão só passa quando: a OF não está cancelada, o EXP de TODOS
-- os itens raiz aplicáveis está CONCLUIDO, o aceite de conferência
-- está sinalizado (sign_romaneio_conference) e há ao menos 1 item.
-- -------------------------------------------------------------

create table if not exists public.romaneios (
  id                      uuid primary key default gen_random_uuid(),
  -- Número sequencial do documento (referência na NF/impressão).
  number                  bigint generated always as identity,
  order_id                uuid not null references public.orders (id) on delete cascade,
  status                  text not null default 'SIMULACAO'
                            check (status in ('SIMULACAO', 'EMITIDO', 'CANCELADO')),
  -- Dados da saída física da carga.
  shipment_date           date,
  carrier                 text,
  vehicle                 text,
  notes                   text,
  -- Aceite de conferência (pré-requisito da emissão).
  conference_accepted_at  timestamptz,
  conference_accepted_by  uuid references public.profiles (id),
  conference_notes        text,
  -- Emissão (trava o romaneio).
  emitted_at              timestamptz,
  emitted_by              uuid references public.profiles (id),
  -- Números de NF registrados após a emissão (apoio à contabilidade).
  nf_number               text,
  return_nf_number        text,
  created_by              uuid references public.profiles (id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.profiles (id),
  constraint fk_romaneios_conference_user
    foreign key (conference_accepted_by) references public.profiles (id),
  constraint fk_romaneios_emitted_user
    foreign key (emitted_by) references public.profiles (id),
  constraint fk_romaneios_created_user
    foreign key (created_by) references public.profiles (id)
);

create or replace trigger romaneios_set_updated_at
  before update on public.romaneios
  for each row execute function public.set_updated_at();

-- Apenas UM rascunho aberto por OF (expedição parcial sem duplicidade
-- de simulação).
create unique index if not exists idx_romaneios_one_simulation_per_order
  on public.romaneios (order_id)
  where status = 'SIMULACAO';

create index if not exists idx_romaneios_order_id
  on public.romaneios (order_id);

create index if not exists idx_romaneios_status
  on public.romaneios (status);

-- -------------------------------------------------------------
-- Itens expedidos neste romaneio (itens RAIZ da OF — o EXP mora no
-- pai; a quantidade permite expedição parcial do mesmo item).
-- -------------------------------------------------------------
create table if not exists public.romaneio_items (
  id             uuid primary key default gen_random_uuid(),
  romaneio_id    uuid not null references public.romaneios (id) on delete cascade,
  order_item_id  uuid not null references public.order_items (id) on delete cascade,
  quantity       numeric not null check (quantity > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (romaneio_id, order_item_id)
);

create or replace trigger romaneio_items_set_updated_at
  before update on public.romaneio_items
  for each row execute function public.set_updated_at();

create index if not exists idx_romaneio_items_romaneio_id
  on public.romaneio_items (romaneio_id);

create index if not exists idx_romaneio_items_order_item_id
  on public.romaneio_items (order_item_id);

-- -------------------------------------------------------------
-- Linhas de matéria-prima para a devolução: previsto (alocado do
-- pedido) + informado (recebida do cliente / utilizada na
-- produção). O SALDO (received − used) é derivado na leitura — não
-- é coluna, para nunca divergir dos valores informados.
-- -------------------------------------------------------------
create table if not exists public.romaneio_materials (
  id                uuid primary key default gen_random_uuid(),
  romaneio_id       uuid not null references public.romaneios (id) on delete cascade,
  description       text not null check (length(trim(description)) > 0),
  unit              text not null default 'UN'
                      check (unit in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC')),
  quantity_planned  numeric not null default 0 check (quantity_planned >= 0),
  quantity_received numeric check (quantity_received is null or quantity_received >= 0),
  quantity_used     numeric check (quantity_used is null or quantity_used >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Linha única por material dentro do romaneio (chave: descrição+unidade).
  unique (romaneio_id, description, unit)
);

create or replace trigger romaneio_materials_set_updated_at
  before update on public.romaneio_materials
  for each row execute function public.set_updated_at();

create index if not exists idx_romaneio_materials_romaneio_id
  on public.romaneio_materials (romaneio_id);

-- -------------------------------------------------------------
-- RLS: leitura para todos os autenticados; escrita para quem edita
-- pedidos (ADMIN/GESTOR — capacidade romaneio.edit).
-- -------------------------------------------------------------
alter table public.romaneios enable row level security;
alter table public.romaneio_items enable row level security;
alter table public.romaneio_materials enable row level security;

drop policy if exists "romaneios_select" on public.romaneios;
create policy "romaneios_select" on public.romaneios
  for select to authenticated using (true);

drop policy if exists "romaneios_insert" on public.romaneios;
create policy "romaneios_insert" on public.romaneios
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneios_update" on public.romaneios;
create policy "romaneios_update" on public.romaneios
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneios_delete" on public.romaneios;
create policy "romaneios_delete" on public.romaneios
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneio_items_select" on public.romaneio_items;
create policy "romaneio_items_select" on public.romaneio_items
  for select to authenticated using (true);

drop policy if exists "romaneio_items_insert" on public.romaneio_items;
create policy "romaneio_items_insert" on public.romaneio_items
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneio_items_update" on public.romaneio_items;
create policy "romaneio_items_update" on public.romaneio_items
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneio_items_delete" on public.romaneio_items;
create policy "romaneio_items_delete" on public.romaneio_items
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneio_materials_select" on public.romaneio_materials;
create policy "romaneio_materials_select" on public.romaneio_materials
  for select to authenticated using (true);

drop policy if exists "romaneio_materials_insert" on public.romaneio_materials;
create policy "romaneio_materials_insert" on public.romaneio_materials
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneio_materials_update" on public.romaneio_materials;
create policy "romaneio_materials_update" on public.romaneio_materials
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "romaneio_materials_delete" on public.romaneio_materials;
create policy "romaneio_materials_delete" on public.romaneio_materials
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']));

-- -------------------------------------------------------------
-- RPC: save_romaneio — cria/atualiza um romaneio em SIMULACAO,
-- substituindo itens e materiais em UMA transação (mesmo padrão
-- transacional da apply_of_import/replace_item_materials).
--
-- Validações: OF existe e não está cancelada; só se edita
-- SIMULACAO; itens precisam pertencer à OF e não exceder a
-- quantidade do item; materiais respeitam a coerência de saldo.
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
    raise exception 'Não é possível montar romaneio de uma OF cancelada.';
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
      where r.order_id = p_order_id and r.status = 'SIMULACAO'
    ) then
      raise exception 'Já existe uma simulação de romaneio aberta para esta OF.';
    end if;

    insert into public.romaneios (
      order_id, status, shipment_date, carrier, vehicle, notes, created_by
    )
    values (
      p_order_id,
      'SIMULACAO',
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
    if v_status <> 'SIMULACAO' then
      raise exception 'Somente simulações podem ser editadas. Cancele o romaneio para recomeçar.';
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
-- (quem, quando e observação). Pré-requisito da emissão.
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
  if v_status <> 'SIMULACAO' then
    raise exception 'A conferência só pode ser sinalizada em simulações.';
  end if;

  update public.romaneios
     set conference_accepted_at = now(),
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
-- RPC: emit_romaneio — valida TODOS os gates de emissão e trava o
-- romaneio (status EMITIDO). Os gates:
--   1) OF não cancelada;
--   2) romaneio em SIMULACAO;
--   3) aceite de conferência sinalizado;
--   4) ao menos 1 item incluído;
--   5) EXP de TODOS os itens raiz aplicáveis = CONCLUIDO;
--   6) Σ (este romaneio + já emitidos) ≤ quantidade do item
--      (teto da expedição parcial).
-- -------------------------------------------------------------
create or replace function public.emit_romaneio(p_romaneio_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id       uuid := auth.uid();
  v_order_id      uuid;
  v_order_status  text;
  v_status        text;
  v_has_conference boolean;
  v_item_count    integer;
  v_pending_exp   integer;
  v_over_limit    integer;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.order_id, r.status, (r.conference_accepted_at is not null)
    into v_order_id, v_status, v_has_conference
    from public.romaneios r
   where r.id = p_romaneio_id;

  if v_order_id is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status <> 'SIMULACAO' then
    raise exception 'Apenas simulações podem ser emitidas.';
  end if;
  if not v_has_conference then
    raise exception 'Sinalize o aceite da conferência antes de emitir.';
  end if;

  select o.status into v_order_status from public.orders o where o.id = v_order_id;
  if v_order_status = 'CANCELADO' then
    raise exception 'A OF está cancelada.';
  end if;

  select count(*) into v_item_count
    from public.romaneio_items ri
   where ri.romaneio_id = p_romaneio_id;
  if v_item_count = 0 then
    raise exception 'Inclua ao menos um item no romaneio.';
  end if;

  -- Gate de produção: EXP aplicável CONCLUIDO em todos os itens raiz.
  select count(*) into v_pending_exp
    from public.order_items oi
    join public.production_processes pp on pp.order_item_id = oi.id
    join public.processes pr on pr.id = pp.process_id and pr.code = 'EXP'
   where oi.order_id = v_order_id
     and oi.parent_order_item_id is null
     and pp.status <> 'NAO_APLICAVEL'
     and pp.status <> 'CONCLUIDO';

  if v_pending_exp > 0 then
    raise exception 'A OF tem % item(ns) raiz com EXPEDIÇÃO pendente.', v_pending_exp;
  end if;

  -- Teto da expedição parcial:Σ emitido (outros romaneios) + este ≤ qtd do item.
  select count(*) into v_over_limit
    from public.romaneio_items ri
    join public.order_items oi on oi.id = ri.order_item_id
   where ri.romaneio_id = p_romaneio_id
     and ri.quantity + coalesce(
       (
         select sum(ri2.quantity)
           from public.romaneio_items ri2
           join public.romaneios r2 on r2.id = ri2.romaneio_id
          where ri2.order_item_id = ri.order_item_id
            and r2.status = 'EMITIDO'
       ),
       0
     ) > oi.quantity;

  if v_over_limit > 0 then
    raise exception 'Quantidade maior que a pendência de expedição em % item(ns).', v_over_limit;
  end if;

  update public.romaneios
     set status = 'EMITIDO',
         emitted_at = now(),
         emitted_by = v_user_id,
         updated_by = v_user_id
   where id = p_romaneio_id;

  if not found then
    raise exception 'Sem permissão para emitir o romaneio (ADMIN/GESTOR).';
  end if;
end;
$$;

revoke execute on function public.emit_romaneio(uuid) from anon;
grant execute on function public.emit_romaneio(uuid) to authenticated;

-- -------------------------------------------------------------
-- RPC: cancel_romaneio — CANCELADO libera as quantidades expedidas
-- (o teto da expedição parcial só conta romaneios EMITIDOS). Bloqueia
-- quando já há NF de saída registrada (consistência fiscal).
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
  v_nf      text;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select r.status, r.nf_number into v_status, v_nf
    from public.romaneios r
   where r.id = p_romaneio_id;

  if v_status is null then
    raise exception 'Romaneio não encontrado.';
  end if;
  if v_status = 'CANCELADO' then
    raise exception 'Romaneio já cancelado.';
  end if;
  if v_nf is not null then
    raise exception 'Limpe o número da NF de saída antes de cancelar.';
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
