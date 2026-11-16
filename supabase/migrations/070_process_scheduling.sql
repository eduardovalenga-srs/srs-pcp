-- =============================================================
-- 070) Sequenciamento de produção por processo
-- =============================================================
-- O planejamento define a ORDEM das OFs em cada processo. A fila é
-- independente da sequência geral de fabricação (order_items.seq, 036):
-- aqui cada PROCESSO tem a sua própria ordem, com uma data de início
-- (âncora) e uma observação por OF.
--
-- A capacidade usada no cálculo é a capacidade em KG/dia do GRUPO de
-- produto da OF naquele processo (068). O peso da OF é a soma dos itens
-- RAIZ (total_weight_kg, 023). O cálculo de carga/datas acontece na
-- aplicação (dias úteis), não no banco.
--
-- 1. orders.product_group_id: família escolhida na importação (uma por
--    arquivo) — vínculo separado do campo técnico order_items.family.
-- 2. order_process_schedules: posição + observação por OF/processo.
-- 3. process_schedule_settings: data de início por processo (persistida).
-- 4. get_process_scheduling: leitura agregada da tela.
-- 5. save_process_schedule: grava a ordem e a data de início numa
--    transação (ADMIN/GESTOR), preservando as posições já ocupadas
--    quando a tela salva apenas uma família filtrada.
-- =============================================================

alter table public.orders
  add column if not exists product_group_id bigint
    references public.product_groups (id) on delete set null;

create index if not exists orders_product_group_id_idx
  on public.orders (product_group_id);

create table public.order_process_schedules (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  process_id uuid not null references public.processes (id) on delete cascade,
  position integer not null check (position >= 1),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_process_schedules_unique unique (order_id, process_id)
);

create index order_process_schedules_process_idx
  on public.order_process_schedules (process_id, position);

create or replace trigger order_process_schedules_set_updated_at
  before update on public.order_process_schedules
  for each row execute function public.set_updated_at();

create table public.process_schedule_settings (
  process_id uuid primary key references public.processes (id) on delete cascade,
  anchor_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger process_schedule_settings_set_updated_at
  before update on public.process_schedule_settings
  for each row execute function public.set_updated_at();

alter table public.order_process_schedules enable row level security;
alter table public.process_schedule_settings enable row level security;

create policy "order_process_schedules_select"
  on public.order_process_schedules
  for select to authenticated using (true);
create policy "order_process_schedules_insert"
  on public.order_process_schedules
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));
create policy "order_process_schedules_update"
  on public.order_process_schedules
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));
create policy "order_process_schedules_delete"
  on public.order_process_schedules
  for delete to authenticated using (public.has_role(array ['ADMIN', 'GESTOR']));

create policy "process_schedule_settings_select"
  on public.process_schedule_settings
  for select to authenticated using (true);
create policy "process_schedule_settings_insert"
  on public.process_schedule_settings
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));
create policy "process_schedule_settings_update"
  on public.process_schedule_settings
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));
create policy "process_schedule_settings_delete"
  on public.process_schedule_settings
  for delete to authenticated using (public.has_role(array ['ADMIN', 'GESTOR']));

grant select, insert, update, delete on public.order_process_schedules to authenticated;
grant select, insert, update, delete on public.process_schedule_settings to authenticated;

-- -------------------------------------------------------------
-- get_process_scheduling — linhas da fila do processo.
--
-- Uma linha por OF ativa (PLANEJADO/EM_PRODUCAO) com itens raiz:
--   quantity    = soma das quantidades dos itens raiz;
--   weight_kg   = soma do peso total dos itens raiz;
--   capacity_kg = capacidade KG/dia do grupo da OF no processo;
--   position    = ordem salva (null = ainda sem posição).
-- O filtro de família é opcional; sem ele, OFs sem família também
-- aparecem (para revisão), com capacidade nula.
-- -------------------------------------------------------------
create or replace function public.get_process_scheduling(
  p_process_id uuid,
  p_family_group_id bigint default null
)
returns table (
  order_id uuid,
  order_code text,
  order_type text,
  customer_name text,
  delivery_date date,
  order_status text,
  product_group_id bigint,
  family_description text,
  family_abbreviation text,
  group_type text,
  quantity numeric,
  weight_kg numeric,
  capacity_kg numeric,
  "position" integer,
  notes text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.id,
    o.code,
    o.type,
    o.customer_name,
    o.delivery_date,
    o.status,
    o.product_group_id,
    pg.family_description,
    pg.family_abbreviation,
    case
      when pg.id is null then null
      else pg.id::text || '-' || pg.family_abbreviation
    end,
    coalesce(items.quantity, 0)::numeric,
    items.weight_kg,
    cap.capacity,
    s."position",
    s.notes
  from public.orders o
  left join public.product_groups pg on pg.id = o.product_group_id
  left join lateral (
    select
      sum(oi.quantity) as quantity,
      sum(oi.total_weight_kg) as weight_kg
    from public.order_items oi
    where oi.order_id = o.id
      and oi.parent_order_item_id is null
  ) items on true
  left join public.product_group_process_capacities cap
    on cap.product_group_id = o.product_group_id
   and cap.process_id = p_process_id
   and cap.unit = 'KG'
  left join public.order_process_schedules s
    on s.order_id = o.id
   and s.process_id = p_process_id
  where o.status in ('PLANEJADO', 'EM_PRODUCAO')
    and items.quantity is not null
    and (p_family_group_id is null or o.product_group_id = p_family_group_id)
  order by s."position" nulls last, o.delivery_date nulls last, o.code;
$$;

revoke execute on function public.get_process_scheduling(uuid, bigint) from public, anon;
grant execute on function public.get_process_scheduling(uuid, bigint) to authenticated;

-- -------------------------------------------------------------
-- save_process_schedule — grava a fila do processo.
--
-- p_rows: [{ "order_id": uuid, "position": int, "notes": text|null }]
-- A aplicação envia a lista já na ordem final (position 1..n). A ordem
-- é aplicada PRESERVANDO as posições já ocupadas pelas OFs enviadas:
-- assim salvar uma visão filtrada por família não reinicia a posição
-- das outras famílias (as OFs ainda sem posição entram no fim da fila).
-- -------------------------------------------------------------
create or replace function public.save_process_schedule(
  p_process_id uuid,
  p_anchor_date date,
  p_rows jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing_positions integer[];
  v_next integer;
  v_idx integer := 0;
  v_position integer;
  v_row record;
begin
  if not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Você não tem permissão para salvar o sequenciamento.';
  end if;

  if not exists (select 1 from public.processes p where p.id = p_process_id) then
    raise exception 'Processo não encontrado.';
  end if;

  if p_anchor_date is null then
    raise exception 'Informe a data de início do sequenciamento.';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Sequência inválida.';
  end if;

  insert into public.process_schedule_settings (process_id, anchor_date)
  values (p_process_id, p_anchor_date)
  on conflict (process_id) do update
    set anchor_date = excluded.anchor_date;

  -- Posições já ocupadas pelas OFs enviadas (na ordem atual da fila).
  select coalesce(array_agg(s.position order by s.position), '{}')
    into v_existing_positions
    from public.order_process_schedules s
   where s.process_id = p_process_id
     and s.order_id in (
       select r.order_id
         from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
     );

  -- Próxima posição livre para quem ainda não estava na fila.
  select coalesce(max(s.position), 0) + 1
    into v_next
    from public.order_process_schedules s
   where s.process_id = p_process_id;

  for v_row in
    select r.order_id, r.notes
      from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
      join public.orders o on o.id = r.order_id
     order by r.position
  loop
    v_idx := v_idx + 1;
    if v_idx <= cardinality(v_existing_positions) then
      v_position := v_existing_positions[v_idx];
    else
      v_position := v_next;
      v_next := v_next + 1;
    end if;

    insert into public.order_process_schedules (order_id, process_id, position, notes)
    values (v_row.order_id, p_process_id, v_position, nullif(btrim(v_row.notes), ''))
    on conflict (order_id, process_id) do update
      set position = excluded.position,
          notes = excluded.notes;
  end loop;
end;
$$;

revoke execute on function public.save_process_schedule(uuid, date, jsonb) from public, anon;
grant execute on function public.save_process_schedule(uuid, date, jsonb) to authenticated;
