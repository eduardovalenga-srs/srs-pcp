-- =============================================================
-- 002_rls.sql
-- Row Level Security — nenhum dado operacional acessível anonimamente.
-- =============================================================

-- -------------------------------------------------------------
-- Funções auxiliares de autorização (usadas nas policies)
-- -------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = any (p_roles), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'ADMIN', false);
$$;

revoke execute on function public.current_user_role() from anon;
revoke execute on function public.has_role(text[]) from anon;
revoke execute on function public.is_admin() from anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- -------------------------------------------------------------
-- Hardening: anon não acessa nenhuma tabela do schema public
-- -------------------------------------------------------------
revoke all on all tables in schema public from anon;

-- -------------------------------------------------------------
-- Habilita RLS em todas as tabelas operacionais
-- -------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.processes enable row level security;
alter table public.production_processes enable row level security;
alter table public.production_events enable row level security;

-- -------------------------------------------------------------
-- profiles
-- -------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------
-- orders (leitura liberada; escrita para ADMIN/GESTOR)
-- -------------------------------------------------------------
drop policy if exists "orders_select" on public.orders;
create policy "orders_select" on public.orders
  for select to authenticated using (true);

drop policy if exists "orders_insert" on public.orders;
create policy "orders_insert" on public.orders
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "orders_update" on public.orders;
create policy "orders_update" on public.orders
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "orders_delete" on public.orders;
create policy "orders_delete" on public.orders
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------
-- order_items
-- -------------------------------------------------------------
drop policy if exists "order_items_select" on public.order_items;
create policy "order_items_select" on public.order_items
  for select to authenticated using (true);

drop policy if exists "order_items_insert" on public.order_items;
create policy "order_items_insert" on public.order_items
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "order_items_update" on public.order_items;
create policy "order_items_update" on public.order_items
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR']));

drop policy if exists "order_items_delete" on public.order_items;
create policy "order_items_delete" on public.order_items
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------
-- processes (catálogo: somente ADMIN configura)
-- -------------------------------------------------------------
drop policy if exists "processes_select" on public.processes;
create policy "processes_select" on public.processes
  for select to authenticated using (true);

drop policy if exists "processes_insert" on public.processes;
create policy "processes_insert" on public.processes
  for insert to authenticated with check (public.is_admin());

drop policy if exists "processes_update" on public.processes;
create policy "processes_update" on public.processes
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "processes_delete" on public.processes;
create policy "processes_delete" on public.processes
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------
-- production_processes
-- Leitura para todos os autenticados; escrita para quem executa
-- produção (ADMIN/GESTOR/OPERADOR). As regras finas de autorização
-- (ex.: OPERADOR não altera quantidade planejada) são aplicadas na
-- camada de serviço, que sempre executa no servidor.
-- -------------------------------------------------------------
drop policy if exists "production_processes_select" on public.production_processes;
create policy "production_processes_select" on public.production_processes
  for select to authenticated using (true);

drop policy if exists "production_processes_insert" on public.production_processes;
create policy "production_processes_insert" on public.production_processes
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR']));

drop policy if exists "production_processes_update" on public.production_processes;
create policy "production_processes_update" on public.production_processes
  for update to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR']))
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR']));

drop policy if exists "production_processes_delete" on public.production_processes;
create policy "production_processes_delete" on public.production_processes
  for delete to authenticated using (public.is_admin());

-- -------------------------------------------------------------
-- production_events (histórico: inserção e consulta apenas)
-- -------------------------------------------------------------
drop policy if exists "production_events_select" on public.production_events;
create policy "production_events_select" on public.production_events
  for select to authenticated using (true);

drop policy if exists "production_events_insert" on public.production_events;
create policy "production_events_insert" on public.production_events
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR'])
  );

-- As policies de import_batches / import_errors estão em
-- 005_import_tables.sql (as tabelas são criadas naquela etapa).
