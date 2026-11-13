-- =============================================================
-- 069) Itens do grupo de produto e matriz de capacidades
-- =============================================================
-- As capacidades anteriores permanecem em
-- product_group_process_capacities e não são copiadas para os novos itens.

create table public.product_group_items (
  id uuid primary key default gen_random_uuid(),
  product_group_id bigint not null
    references public.product_groups (id) on delete cascade,
  description text not null
    check (length(trim(description)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index product_group_items_description_unique
  on public.product_group_items (product_group_id, lower(trim(description)));

create index product_group_items_group_idx
  on public.product_group_items (product_group_id);

create or replace trigger product_group_items_set_updated_at
  before update on public.product_group_items
  for each row execute function public.set_updated_at();

create table public.product_group_item_process_capacities (
  id uuid primary key default gen_random_uuid(),
  product_group_item_id uuid not null
    references public.product_group_items (id) on delete cascade,
  factory text not null check (factory in ('Fábrica 1', 'Fábrica 2')),
  process_id uuid not null references public.processes (id) on delete restrict,
  unit text not null check (unit in ('KG', 'M2', 'UNIDADES')),
  capacity numeric(14, 3) not null check (capacity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_group_item_process_capacities_unique
    unique (product_group_item_id, factory, process_id, unit)
);

create index product_group_item_process_capacities_item_idx
  on public.product_group_item_process_capacities (product_group_item_id, factory);

create or replace trigger product_group_item_process_capacities_set_updated_at
  before update on public.product_group_item_process_capacities
  for each row execute function public.set_updated_at();

alter table public.product_group_items enable row level security;
alter table public.product_group_item_process_capacities enable row level security;

create policy "product_group_items_select" on public.product_group_items
  for select to authenticated using (true);
create policy "product_group_items_insert" on public.product_group_items
  for insert to authenticated with check (public.is_admin());
create policy "product_group_items_update" on public.product_group_items
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "product_group_items_delete" on public.product_group_items
  for delete to authenticated using (public.is_admin());

create policy "product_group_item_process_capacities_select"
  on public.product_group_item_process_capacities
  for select to authenticated using (true);
create policy "product_group_item_process_capacities_insert"
  on public.product_group_item_process_capacities
  for insert to authenticated with check (public.is_admin());
create policy "product_group_item_process_capacities_update"
  on public.product_group_item_process_capacities
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "product_group_item_process_capacities_delete"
  on public.product_group_item_process_capacities
  for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.product_group_items to authenticated;
grant select, insert, update, delete on public.product_group_item_process_capacities to authenticated;

-- Processos realocados mantêm fábrica consistente nos dados legados e na
-- nova matriz por item. As capacidades antigas não são migradas nem apagadas.
create or replace function public.sync_product_group_capacity_factory()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.location is distinct from old.location
     and (
       exists (
         select 1 from public.product_group_process_capacities c
          where c.process_id = new.id
       )
       or exists (
         select 1 from public.product_group_item_process_capacities c
          where c.process_id = new.id
       )
     ) then
    if new.location is null or new.location not in ('Fábrica 1', 'Fábrica 2') then
      raise exception 'Associe o processo a uma fábrica antes de alterar seu cadastro.';
    end if;

    update public.product_group_process_capacities
       set factory = new.location
     where process_id = new.id
       and factory is distinct from new.location;

    update public.product_group_item_process_capacities
       set factory = new.location
     where process_id = new.id
       and factory is distinct from new.location;
  end if;
  return new;
end;
$$;

create or replace function public.save_product_group_with_items(
  p_group_id bigint,
  p_family_description text,
  p_family_abbreviation text,
  p_items jsonb
)
returns table (id bigint, group_type text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_group_id bigint;
  v_item jsonb;
  v_item_id uuid;
  v_description text;
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para gerenciar grupos de produto.';
  end if;

  if p_family_description is null
     or length(trim(p_family_description)) not between 1 and 120 then
    raise exception 'Informe a descrição da família (máximo de 120 caracteres).';
  end if;

  if p_family_abbreviation is null
     or p_family_abbreviation !~ '^[A-Z0-9]{1,3}$' then
    raise exception 'A abreviação deve ter de 1 a 3 letras ou números maiúsculos.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um item ao grupo.';
  end if;

  if exists (
    select 1 from public.processes p
     where p.location not in ('Fábrica 1', 'Fábrica 2') or p.location is null
  ) then
    raise exception 'Defina a fábrica de todos os processos antes de cadastrar o grupo.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_description := trim(coalesce(v_item ->> 'description', ''));
    if length(v_description) not between 1 and 120 then
      raise exception 'Informe a descrição de cada item (máximo de 120 caracteres).';
    end if;

    if v_item -> 'capacities' is null
       or jsonb_typeof(v_item -> 'capacities') <> 'array' then
      raise exception 'Informe as capacidades por processo para cada item.';
    end if;

    if exists (
      select 1
        from public.processes p
       where not exists (
         select 1
           from jsonb_to_recordset(v_item -> 'capacities')
             as c(factory text, "processId" uuid, unit text, capacity numeric)
          where c."processId" = p.id and c.factory = p.location
       )
    ) then
      raise exception 'Informe ao menos uma capacidade por processo e item, na fábrica correspondente.';
    end if;

    if exists (
      select 1
        from jsonb_to_recordset(v_item -> 'capacities')
          as c(factory text, "processId" uuid, unit text, capacity numeric)
        left join public.processes p on p.id = c."processId"
       where p.id is null or p.location is distinct from c.factory
    ) then
      raise exception 'Cada processo deve estar associado à sua fábrica cadastrada.';
    end if;
  end loop;

  if p_group_id is null then
    insert into public.product_groups (family_description, family_abbreviation)
    values (trim(p_family_description), p_family_abbreviation)
    returning product_groups.id into v_group_id;
  else
    update public.product_groups
       set family_description = trim(p_family_description),
           family_abbreviation = p_family_abbreviation
     where product_groups.id = p_group_id
     returning product_groups.id into v_group_id;

    if v_group_id is null then
      raise exception 'Grupo de produto não encontrado.';
    end if;
  end if;

  -- Itens da tela são substituídos como conjunto dentro desta transação.
  -- A tabela legada de capacidades do grupo não é alterada.
  delete from public.product_group_items
   where product_group_id = v_group_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.product_group_items (product_group_id, description)
    values (v_group_id, trim(v_item ->> 'description'))
    returning product_group_items.id into v_item_id;

    insert into public.product_group_item_process_capacities
      (product_group_item_id, factory, process_id, unit, capacity)
    select v_item_id, c.factory, c."processId", c.unit, c.capacity
      from jsonb_to_recordset(v_item -> 'capacities')
        as c(factory text, "processId" uuid, unit text, capacity numeric);
  end loop;

  return query
    select v_group_id, v_group_id::text || '-' || p_family_abbreviation;
end;
$$;

revoke execute on function public.save_product_group_with_items(bigint, text, text, jsonb)
  from public, anon;
grant execute on function public.save_product_group_with_items(bigint, text, text, jsonb)
  to authenticated;
