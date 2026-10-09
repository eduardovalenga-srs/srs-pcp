-- =============================================================
-- 001_initial_schema.sql
-- Controle de Produção — Serralheria Industrial
-- Schema base: perfis, pedidos, itens, processos e produção.
-- =============================================================

-- gen_random_uuid() é função nativa do PostgreSQL 13+ (sem extensões extras).

-- -------------------------------------------------------------
-- updated_at automático
-- -------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- profiles (perfis de usuário e papel de acesso)
-- -------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  email       text,
  role        text not null default 'OPERADOR'
              check (role in ('ADMIN', 'GESTOR', 'OPERADOR', 'VISUALIZADOR')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- orders (OF/OS)
-- -------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  type          text not null check (type in ('OF', 'OS')),
  customer_name text,
  description   text,
  order_date    date,
  delivery_date date,
  status        text not null default 'PLANEJADO'
                check (status in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid
);

create or replace trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- order_items (itens do pedido)
-- -------------------------------------------------------------
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  family          text,
  parent_item     text,
  description     text not null,
  quantity        numeric not null check (quantity > 0),
  unit_weight_kg  numeric check (unit_weight_kg is null or unit_weight_kg >= 0),
  delivery_date   date,
  status          text not null default 'PLANEJADO'
                  check (status in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid
);

create or replace trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- processes (catálogo de processos — fonte de verdade)
-- Adicionar PINTURA, GALVANIZAÇÃO, etc. é apenas um INSERT,
-- nenhuma alteração de estrutura é necessária.
-- -------------------------------------------------------------
create table if not exists public.processes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  display_order integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace trigger processes_set_updated_at
  before update on public.processes
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- production_processes (situação de cada processo em cada item)
-- -------------------------------------------------------------
create table if not exists public.production_processes (
  id                 uuid primary key default gen_random_uuid(),
  order_item_id      uuid not null references public.order_items (id) on delete cascade,
  process_id         uuid not null references public.processes (id) on delete restrict,
  status             text not null default 'NAO_INICIADO'
                     check (status in ('NAO_INICIADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'BLOQUEADO', 'NAO_APLICAVEL')),
  quantity_planned   numeric check (quantity_planned is null or quantity_planned >= 0),
  quantity_completed numeric check (quantity_completed is null or quantity_completed >= 0),
  started_at         timestamptz,
  completed_at       timestamptz,
  operator_id        uuid references public.profiles (id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint production_processes_item_process_unique unique (order_item_id, process_id)
);

create or replace trigger production_processes_set_updated_at
  before update on public.production_processes
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------
-- production_events (histórico de alterações — nunca é apagado)
-- -------------------------------------------------------------
create table if not exists public.production_events (
  id                     uuid primary key default gen_random_uuid(),
  production_process_id  uuid not null references public.production_processes (id) on delete cascade,
  user_id                uuid not null references public.profiles (id) on delete restrict,
  event_type             text not null,
  old_status             text check (old_status is null or old_status in ('NAO_INICIADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'BLOQUEADO', 'NAO_APLICAVEL')),
  new_status             text check (new_status is null or new_status in ('NAO_INICIADO', 'EM_ANDAMENTO', 'CONCLUIDO', 'BLOQUEADO', 'NAO_APLICAVEL')),
  old_quantity           numeric,
  new_quantity           numeric,
  notes                  text,
  created_at             timestamptz not null default now()
);

-- Histórico é somente inserção (não há UPDATE/DELETE por aplicação).
revoke update, delete on table public.production_events from authenticated;
grant insert, select on table public.production_events to authenticated;

-- -------------------------------------------------------------
-- Perfil criado automaticamente no cadastro de usuário
-- -------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    'OPERADOR'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
