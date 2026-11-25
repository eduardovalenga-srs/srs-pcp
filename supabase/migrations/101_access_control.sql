-- =============================================================
-- 101_access_control.sql
-- Acesso personalizado por usuário:
--   * tipo de conta (INTERNAL/EXTERNAL);
--   * permissões por menu/tela/operação (perfil-modelo + override);
--   * escopo de dados: empresas (interno) e cliente (externo).
--
-- A migration é aditiva: os papéis atuais continuam existindo e são
-- convertidos em perfis-modelo, preservando o comportamento existente.
-- =============================================================
begin;

-- -------------------------------------------------------------
-- Tipos de conta e perfis-modelo
-- -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_account_type') then
    create type public.access_account_type as enum ('INTERNAL', 'EXTERNAL');
  end if;
end;
$$;

create table if not exists public.access_profiles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  role_key      text unique,
  account_type  public.access_account_type not null default 'INTERNAL',
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint access_profiles_name_not_blank check (btrim(name) <> '')
);

drop trigger if exists access_profiles_set_updated_at on public.access_profiles;
create trigger access_profiles_set_updated_at
  before update on public.access_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.access_profile_permissions (
  access_profile_id uuid not null references public.access_profiles (id) on delete cascade,
  permission_key    text not null,
  created_at        timestamptz not null default now(),
  primary key (access_profile_id, permission_key)
);

create table if not exists public.user_permission_overrides (
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  permission_key  text not null,
  allowed         boolean not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (profile_id, permission_key)
);

drop trigger if exists user_permission_overrides_set_updated_at on public.user_permission_overrides;
create trigger user_permission_overrides_set_updated_at
  before update on public.user_permission_overrides
  for each row execute function public.set_updated_at();

-- Escopo externo: raiz CLIENT da árvore de alocações.
create table if not exists public.profile_client_access (
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  client_node_id  uuid not null references public.employee_allocation_nodes (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (profile_id, client_node_id)
);

create index if not exists idx_profile_client_access_client
  on public.profile_client_access (client_node_id);

-- Escopo interno: empresas empregadoras visíveis (750/752).
create table if not exists public.profile_company_access (
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  company_code  text not null,
  created_at    timestamptz not null default now(),
  primary key (profile_id, company_code)
);

-- Auditoria imutável das alterações de acesso feitas pela administração.
create table if not exists public.access_audit_log (
  id                uuid primary key default gen_random_uuid(),
  actor_profile_id  uuid references public.profiles (id) on delete set null,
  target_profile_id uuid references public.profiles (id) on delete set null,
  action            text not null,
  details           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_access_audit_log_target_created
  on public.access_audit_log (target_profile_id, created_at desc);

-- -------------------------------------------------------------
-- Colunas de acesso no perfil
-- -------------------------------------------------------------
alter table public.profiles
  add column if not exists account_type public.access_account_type not null default 'INTERNAL';

alter table public.profiles
  add column if not exists access_profile_id uuid references public.access_profiles (id) on delete set null;

create index if not exists idx_profiles_access_profile
  on public.profiles (access_profile_id);

-- -------------------------------------------------------------
-- Perfis-modelo derivados dos papéis atuais
-- -------------------------------------------------------------
insert into public.access_profiles (name, role_key, account_type, is_system)
values
  ('Administrador', 'ADMIN', 'INTERNAL', true),
  ('Gestor', 'GESTOR', 'INTERNAL', true),
  ('Operador Fábrica 1', 'OPERADOR_F1', 'INTERNAL', true),
  ('Operador Fábrica 2', 'OPERADOR_F2', 'INTERNAL', true),
  ('Visualizador', 'VISUALIZADOR', 'INTERNAL', true)
on conflict (role_key) do update
  set name = excluded.name,
      account_type = excluded.account_type,
      is_system = excluded.is_system;

-- Matriz equivalente às capabilities atuais + operações granulares de RH.
insert into public.access_profile_permissions (access_profile_id, permission_key)
select ap.id, permissions.permission_key
from public.access_profiles ap
join (
  values
    -- ADMIN: tudo.
    ('ADMIN', 'production.view'),
    ('ADMIN', 'production.edit'),
    ('ADMIN', 'production.update_status'),
    ('ADMIN', 'production.view_history'),
    ('ADMIN', 'orders.view'),
    ('ADMIN', 'orders.create'),
    ('ADMIN', 'orders.edit'),
    ('ADMIN', 'orders.delete'),
    ('ADMIN', 'dashboard.view'),
    ('ADMIN', 'import.access'),
    ('ADMIN', 'processes.view'),
    ('ADMIN', 'processes.manage'),
    ('ADMIN', 'settings.manage'),
    ('ADMIN', 'users.manage'),
    ('ADMIN', 'romaneio.view'),
    ('ADMIN', 'romaneio.edit'),
    ('ADMIN', 'menu.gestao'),
    ('ADMIN', 'menu.dashboard'),
    ('ADMIN', 'menu.processes'),
    ('ADMIN', 'menu.product_groups'),
    ('ADMIN', 'menu.fabrica1'),
    ('ADMIN', 'fabrica2.view'),
    ('ADMIN', 'menu.fabrica2'),
    ('ADMIN', 'menu.settings'),
    ('ADMIN', 'menu.romaneio'),
    ('ADMIN', 'menu.recebimento_mp'),
    ('ADMIN', 'mp_receipt.edit'),
    ('ADMIN', 'menu.sequenciamento'),
    ('ADMIN', 'menu.rh'),
    ('ADMIN', 'rh.view'),
    ('ADMIN', 'rh.manage'),
    ('ADMIN', 'rh.allocation.view'),
    ('ADMIN', 'rh.allocation.manage'),
    ('ADMIN', 'rh.recruitment.view'),
    ('ADMIN', 'rh.recruitment.manage'),
    ('ADMIN', 'rh.employees.view'),
    ('ADMIN', 'rh.employees.create'),
    ('ADMIN', 'rh.employees.edit'),
    ('ADMIN', 'rh.employees.import'),
    ('ADMIN', 'rh.allocations.view'),
    ('ADMIN', 'rh.allocations.create_client'),
    ('ADMIN', 'rh.allocations.create_location'),
    ('ADMIN', 'rh.allocations.create_shift'),
    ('ADMIN', 'rh.allocations.create_area'),
    ('ADMIN', 'rh.allocations.create_position'),
    ('ADMIN', 'rh.allocations.edit'),
    ('ADMIN', 'rh.allocations.deactivate'),
    ('ADMIN', 'rh.allocations.delete'),
    ('ADMIN', 'rh.allocations.assign'),

    -- GESTOR: produção/pedidos/romaneio + alocações (sem cadastro de pessoal).
    ('GESTOR', 'production.view'),
    ('GESTOR', 'production.edit'),
    ('GESTOR', 'production.update_status'),
    ('GESTOR', 'production.view_history'),
    ('GESTOR', 'orders.view'),
    ('GESTOR', 'orders.create'),
    ('GESTOR', 'orders.edit'),
    ('GESTOR', 'orders.delete'),
    ('GESTOR', 'import.access'),
    ('GESTOR', 'processes.view'),
    ('GESTOR', 'menu.gestao'),
    ('GESTOR', 'menu.processes'),
    ('GESTOR', 'menu.product_groups'),
    ('GESTOR', 'menu.fabrica1'),
    ('GESTOR', 'fabrica2.view'),
    ('GESTOR', 'menu.fabrica2'),
    ('GESTOR', 'romaneio.view'),
    ('GESTOR', 'romaneio.edit'),
    ('GESTOR', 'menu.romaneio'),
    ('GESTOR', 'menu.recebimento_mp'),
    ('GESTOR', 'mp_receipt.edit'),
    ('GESTOR', 'menu.sequenciamento'),
    ('GESTOR', 'menu.rh'),
    ('GESTOR', 'rh.allocation.view'),
    ('GESTOR', 'rh.allocation.manage'),
    ('GESTOR', 'rh.recruitment.view'),
    ('GESTOR', 'rh.recruitment.manage'),
    ('GESTOR', 'rh.allocations.view'),
    ('GESTOR', 'rh.allocations.create_client'),
    ('GESTOR', 'rh.allocations.create_location'),
    ('GESTOR', 'rh.allocations.create_shift'),
    ('GESTOR', 'rh.allocations.create_area'),
    ('GESTOR', 'rh.allocations.create_position'),
    ('GESTOR', 'rh.allocations.edit'),
    ('GESTOR', 'rh.allocations.deactivate'),
    ('GESTOR', 'rh.allocations.delete'),
    ('GESTOR', 'rh.allocations.assign'),

    -- OPERADOR_F1: fábrica 1, dashboard, romaneio (leitura), MP, RH leitura.
    ('OPERADOR_F1', 'production.update_status'),
    ('OPERADOR_F1', 'orders.view'),
    ('OPERADOR_F1', 'menu.dashboard'),
    ('OPERADOR_F1', 'dashboard.view'),
    ('OPERADOR_F1', 'menu.rh'),
    ('OPERADOR_F1', 'rh.view'),
    ('OPERADOR_F1', 'menu.fabrica1'),
    ('OPERADOR_F1', 'romaneio.view'),
    ('OPERADOR_F1', 'menu.recebimento_mp'),
    ('OPERADOR_F1', 'mp_receipt.edit'),
    ('OPERADOR_F1', 'rh.employees.view'),

    -- OPERADOR_F2: apenas Fábrica 2.
    ('OPERADOR_F2', 'menu.fabrica2'),
    ('OPERADOR_F2', 'fabrica2.view'),
    ('OPERADOR_F2', 'production.update_status'),

    -- VISUALIZADOR: leitura de gestão/fábrica 1/romaneio/sequenciamento.
    ('VISUALIZADOR', 'production.view'),
    ('VISUALIZADOR', 'orders.view'),
    ('VISUALIZADOR', 'menu.gestao'),
    ('VISUALIZADOR', 'menu.fabrica1'),
    ('VISUALIZADOR', 'romaneio.view'),
    ('VISUALIZADOR', 'menu.romaneio'),
    ('VISUALIZADOR', 'menu.recebimento_mp'),
    ('VISUALIZADOR', 'menu.sequenciamento')
) as permissions(role_key, permission_key)
  on permissions.role_key = ap.role_key
on conflict (access_profile_id, permission_key) do nothing;

-- -------------------------------------------------------------
-- Backfill dos usuários existentes
-- -------------------------------------------------------------
update public.profiles profile
   set access_profile_id = access.id
  from public.access_profiles access
 where access.role_key = profile.role
   and profile.access_profile_id is null;

-- Usuários internos que já viam funcionários recebem as duas empresas,
-- preservando o comportamento atual. Depois disso, o escopo é restrito
-- pelas empresas explicitamente vinculadas.
insert into public.profile_company_access (profile_id, company_code)
select profile.id, companies.code
  from public.profiles profile
  cross join (values ('750'), ('752')) as companies(code)
 where exists (
   select 1
     from public.access_profile_permissions permission
    where permission.access_profile_id = profile.access_profile_id
      and permission.permission_key = 'rh.employees.view'
 )
   and profile.account_type = 'INTERNAL'
on conflict (profile_id, company_code) do nothing;

-- Mantém o perfil-modelo coerente quando o papel legado muda.
create or replace function public.sync_profile_access_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.role is distinct from old.role then
    select access.id
      into new.access_profile_id
      from public.access_profiles access
     where access.role_key = new.role;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_access_profile on public.profiles;
create trigger profiles_sync_access_profile
  before insert or update of role on public.profiles
  for each row execute function public.sync_profile_access_profile();

-- -------------------------------------------------------------
-- Funções de autorização (security definer: não sofrem RLS)
-- -------------------------------------------------------------
create or replace function public.current_profile_is_external()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select profile.account_type = 'EXTERNAL'
       from public.profiles profile
      where profile.id = auth.uid()),
    false
  );
$$;

create or replace function public.current_profile_is_internal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select profile.account_type = 'INTERNAL' and profile.active
       from public.profiles profile
      where profile.id = auth.uid()),
    false
  );
$$;

create or replace function public.current_profile_has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      (
        profile.role = 'ADMIN'
        or coalesce(
          (select override.allowed
             from public.user_permission_overrides override
            where override.profile_id = profile.id
              and override.permission_key = p_key),
          exists (
            select 1
              from public.access_profile_permissions permission
             where permission.access_profile_id = profile.access_profile_id
               and permission.permission_key = p_key
          ),
          false
        )
      )
      and (p_key not in ('users.manage', 'settings.manage') or profile.role = 'ADMIN')
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.active
  ), false)
  and (
    not public.current_profile_is_external()
    or p_key in (
      'rh.employees.view',
      'rh.allocations.view',
      'rh.allocations.create_location',
      'rh.allocations.create_shift',
      'rh.allocations.create_area',
      'rh.allocations.create_position'
    )
  );
$$;

create or replace function public.current_profile_company_allowed(p_company_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Sem empresas configuradas = sem restrição (o escopo só vale "quando
  -- configurado", preservando o comportamento dos usuários existentes).
  select public.is_admin()
    or not exists (
      select 1
        from public.profile_company_access access
       where access.profile_id = auth.uid()
    )
    or exists (
      select 1
        from public.profile_company_access access
       where access.profile_id = auth.uid()
         and access.company_code = p_company_code
    );
$$;

create or replace function public.current_profile_can_access_node(p_node_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive ancestors(id, parent_id, node_type) as (
    select node.id, node.parent_id, node.node_type
      from public.employee_allocation_nodes node
     where node.id = p_node_id
    union all
    select parent.id, parent.parent_id, parent.node_type
      from public.employee_allocation_nodes parent
      join ancestors child on parent.id = child.parent_id
  )
  select exists (
    select 1
      from ancestors ancestor
      join public.profile_client_access access
        on access.client_node_id = ancestor.id
     where ancestor.node_type = 'CLIENT'
       and access.profile_id = auth.uid()
  );
$$;

create or replace function public.current_profile_can_view_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.employees employee
     where employee.id = p_employee_id
       and (
         (
           not public.current_profile_is_external()
           and (
             public.is_admin()
             or public.current_profile_company_allowed(employee.company_code)
           )
         )
         or (
           public.current_profile_is_external()
           and employee.allocation_position_id is not null
           and public.current_profile_can_access_node(employee.allocation_position_id)
         )
       )
  );
$$;

-- Contexto de acesso consumido pela sessão (perfis + overrides + escopos).
create or replace function public.current_profile_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select profile.*
      from public.profiles profile
     where profile.id = auth.uid()
       and profile.active
  )
  select jsonb_build_object(
    'accountType', coalesce((select account_type::text from current_profile), 'INTERNAL'),
    'permissions', coalesce((
      select jsonb_agg(distinct permission_key)
        from (
          select permission.permission_key
            from current_profile profile
            join public.access_profile_permissions permission
              on permission.access_profile_id = profile.access_profile_id
           where not exists (
             select 1
               from public.user_permission_overrides override
              where override.profile_id = profile.id
                and override.permission_key = permission.permission_key
           )
          union
          select override.permission_key
            from current_profile profile
            join public.user_permission_overrides override
              on override.profile_id = profile.id
             and override.allowed
        ) granted(permission_key)
    ), '[]'::jsonb),
    'companyCodes', coalesce((
      select jsonb_agg(access.company_code)
        from public.profile_company_access access
       where access.profile_id = auth.uid()
    ), '[]'::jsonb),
    'clientIds', coalesce((
      select jsonb_agg(access.client_node_id)
        from public.profile_client_access access
       where access.profile_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.current_profile_is_external() from public, anon;
revoke all on function public.current_profile_is_internal() from public, anon;
revoke all on function public.current_profile_has_permission(text) from public, anon;
revoke all on function public.current_profile_company_allowed(text) from public, anon;
revoke all on function public.current_profile_can_access_node(uuid) from public, anon;
revoke all on function public.current_profile_can_view_employee(uuid) from public, anon;
revoke all on function public.current_profile_access_context() from public, anon;
grant execute on function public.current_profile_is_external() to authenticated;
grant execute on function public.current_profile_is_internal() to authenticated;
grant execute on function public.current_profile_has_permission(text) to authenticated;
grant execute on function public.current_profile_company_allowed(text) to authenticated;
grant execute on function public.current_profile_can_access_node(uuid) to authenticated;
grant execute on function public.current_profile_can_view_employee(uuid) to authenticated;
grant execute on function public.current_profile_access_context() to authenticated;

-- A função legada `has_role` também é usada por RPCs anteriores à migração.
-- Mantém a semântica para contas internas e garante que nenhuma role legada
-- transforme uma conta externa em usuário interno.
create or replace function public.has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (auth.uid() is null or public.current_profile_is_internal())
    and coalesce(public.current_user_role() = any (p_roles), false);
$$;

revoke all on function public.has_role(text[]) from public, anon;
grant execute on function public.has_role(text[]) to authenticated;

-- -------------------------------------------------------------
-- RLS das tabelas de configuração (somente ADMIN lê; escrita service-role)
-- -------------------------------------------------------------
alter table public.access_profiles enable row level security;
alter table public.access_profile_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.profile_client_access enable row level security;
alter table public.profile_company_access enable row level security;
alter table public.access_audit_log enable row level security;

drop policy if exists "access_profiles_select_admin" on public.access_profiles;
create policy "access_profiles_select_admin" on public.access_profiles
  for select to authenticated using (public.is_admin());

drop policy if exists "access_profile_permissions_select_admin" on public.access_profile_permissions;
create policy "access_profile_permissions_select_admin" on public.access_profile_permissions
  for select to authenticated using (public.is_admin());

drop policy if exists "user_permission_overrides_select_admin" on public.user_permission_overrides;
create policy "user_permission_overrides_select_admin" on public.user_permission_overrides
  for select to authenticated using (public.is_admin());

drop policy if exists "profile_client_access_select_admin" on public.profile_client_access;
create policy "profile_client_access_select_admin" on public.profile_client_access
  for select to authenticated using (public.is_admin());

drop policy if exists "profile_company_access_select_admin" on public.profile_company_access;
create policy "profile_company_access_select_admin" on public.profile_company_access
  for select to authenticated using (public.is_admin());

drop policy if exists "access_audit_log_select_admin" on public.access_audit_log;
create policy "access_audit_log_select_admin" on public.access_audit_log
  for select to authenticated using (public.is_admin());

grant select on public.access_profiles to authenticated;
grant select on public.access_profile_permissions to authenticated;
grant select on public.user_permission_overrides to authenticated;
grant select on public.profile_client_access to authenticated;
grant select on public.profile_company_access to authenticated;
grant select on public.access_audit_log to authenticated;
revoke all on public.access_profiles from anon;
revoke all on public.access_profile_permissions from anon;
revoke all on public.user_permission_overrides from anon;
revoke all on public.profile_client_access from anon;
revoke all on public.profile_company_access from anon;
revoke all on public.access_audit_log from anon;

-- Políticas RESTRICTIVE complementam os RLS legados: uma conta externa
-- não pode consultar módulos internos por acesso direto ao Supabase, e
-- usuários sem perfil ativo são negados mesmo onde a policy antiga era
-- `USING (true)`. RH externo é liberado apenas pelas policies específicas
-- de funcionários/alocações abaixo.
do $$
declare
  v_table record;
begin
  for v_table in
    select table_name
      from information_schema.tables
     where table_schema = 'public'
       and table_type = 'BASE TABLE'
       and table_name not in (
         'profiles',
         'employees',
         'employee_allocation_nodes'
       )
  loop
    execute format(
      'alter table public.%I enable row level security',
      v_table.table_name
    );
    execute format(
      'drop policy if exists internal_account_required on public.%I',
      v_table.table_name
    );
    execute format(
      'create policy internal_account_required on public.%I as restrictive for all to authenticated using (public.current_profile_is_internal()) with check (public.current_profile_is_internal())',
      v_table.table_name
    );
  end loop;
end;
$$;

drop policy if exists profiles_internal_or_self on public.profiles;
create policy profiles_internal_or_self on public.profiles
  as restrictive for all to authenticated
  using (
    id = auth.uid()
    or (public.current_profile_is_internal() and public.is_admin())
  )
  with check (
    id = auth.uid()
    or (public.current_profile_is_internal() and public.is_admin())
  );

-- Autorizações finais dos módulos existentes. Estas policies RESTRICTIVE
-- fazem com que overrides por usuário também sejam respeitados pelo acesso
-- direto ao banco, não apenas pelas telas e Server Actions.
do $$
declare
  v_gate record;
  v_name text;
  v_seen_tables text[] := array[]::text[];
begin
  for v_gate in
    select * from (values
      ('orders','SELECT','public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''dashboard.view'') or public.current_profile_has_permission(''fabrica2.view'')'),
      ('orders','INSERT','public.current_profile_has_permission(''orders.create'')'),
      ('orders','UPDATE','public.current_profile_has_permission(''orders.edit'')'),
      ('orders','DELETE','public.current_profile_has_permission(''orders.delete'')'),
      ('order_items','SELECT','public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''dashboard.view'') or public.current_profile_has_permission(''fabrica2.view'')'),
      ('order_items','INSERT','public.current_profile_has_permission(''orders.create'')'),
      ('order_items','UPDATE','public.current_profile_has_permission(''orders.edit'')'),
      ('order_items','DELETE','public.current_profile_has_permission(''orders.delete'')'),
      ('processes','SELECT','public.current_profile_has_permission(''processes.view'') or public.current_profile_has_permission(''processes.manage'') or public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''dashboard.view'') or public.current_profile_has_permission(''menu.product_groups'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''menu.sequenciamento'')'),
      ('processes','INSERT','public.current_profile_has_permission(''processes.manage'')'),
      ('processes','UPDATE','public.current_profile_has_permission(''processes.manage'')'),
      ('processes','DELETE','public.current_profile_has_permission(''processes.manage'')'),
      ('production_processes','SELECT','public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''production.view_history'') or public.current_profile_has_permission(''dashboard.view'') or public.current_profile_has_permission(''fabrica2.view'')'),
      ('production_processes','INSERT','public.current_profile_has_permission(''production.edit'') or public.current_profile_has_permission(''production.update_status'')'),
      ('production_processes','UPDATE','public.current_profile_has_permission(''production.edit'') or public.current_profile_has_permission(''production.update_status'')'),
      ('production_processes','DELETE','public.current_profile_has_permission(''production.edit'')'),
      ('production_events','SELECT','public.current_profile_has_permission(''production.view_history'') or public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''fabrica2.view'')'),
      ('production_events','INSERT','public.current_profile_has_permission(''production.edit'') or public.current_profile_has_permission(''production.update_status'')'),
      ('import_batches','SELECT','public.current_profile_has_permission(''import.access'')'),
      ('import_batches','INSERT','public.current_profile_has_permission(''import.access'')'),
      ('import_batches','UPDATE','public.current_profile_has_permission(''import.access'')'),
      ('import_batches','DELETE','public.current_profile_has_permission(''import.access'')'),
      ('import_errors','SELECT','public.current_profile_has_permission(''import.access'')'),
      ('import_errors','INSERT','public.current_profile_has_permission(''import.access'')'),
      ('order_item_materials','SELECT','public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''dashboard.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''fabrica2.view'')'),
      ('order_item_materials','INSERT','public.current_profile_has_permission(''orders.edit'') or public.current_profile_has_permission(''production.edit'')'),
      ('order_item_materials','UPDATE','public.current_profile_has_permission(''orders.edit'') or public.current_profile_has_permission(''production.edit'')'),
      ('order_item_materials','DELETE','public.current_profile_has_permission(''orders.edit'') or public.current_profile_has_permission(''production.edit'')'),
      ('romaneios','SELECT','public.current_profile_has_permission(''romaneio.view'')'),
      ('romaneios','INSERT','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneios','UPDATE','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneios','DELETE','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneio_items','SELECT','public.current_profile_has_permission(''romaneio.view'')'),
      ('romaneio_items','INSERT','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneio_items','UPDATE','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneio_items','DELETE','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneio_materials','SELECT','public.current_profile_has_permission(''romaneio.view'')'),
      ('romaneio_materials','INSERT','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneio_materials','UPDATE','public.current_profile_has_permission(''romaneio.edit'')'),
      ('romaneio_materials','DELETE','public.current_profile_has_permission(''romaneio.edit'')'),
      ('mp_receipts','SELECT','public.current_profile_has_permission(''menu.recebimento_mp'')'),
      ('mp_receipts','INSERT','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipts','UPDATE','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipts','DELETE','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipt_materials','SELECT','public.current_profile_has_permission(''menu.recebimento_mp'')'),
      ('mp_receipt_materials','INSERT','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipt_materials','DELETE','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipt_free_items','SELECT','public.current_profile_has_permission(''menu.recebimento_mp'')'),
      ('mp_receipt_free_items','INSERT','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipt_free_items','DELETE','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('mp_receipt_materials','DELETE','public.current_profile_has_permission(''mp_receipt.edit'')'),
      ('product_groups','SELECT','public.current_profile_has_permission(''menu.product_groups'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''processes.manage'') or public.current_profile_has_permission(''import.access'') or public.current_profile_has_permission(''dashboard.view'')'),
      ('product_groups','INSERT','public.current_profile_has_permission(''processes.manage'')'),
      ('product_groups','UPDATE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_groups','DELETE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_process_capacities','SELECT','public.current_profile_has_permission(''menu.product_groups'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''processes.manage'') or public.current_profile_has_permission(''dashboard.view'')'),
      ('product_group_process_capacities','INSERT','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_process_capacities','UPDATE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_process_capacities','DELETE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_items','SELECT','public.current_profile_has_permission(''menu.product_groups'') or public.current_profile_has_permission(''processes.manage'') or public.current_profile_has_permission(''orders.view'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''dashboard.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'')'),
      ('product_group_items','INSERT','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_items','UPDATE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_items','DELETE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_item_process_capacities','SELECT','public.current_profile_has_permission(''menu.product_groups'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'') or public.current_profile_has_permission(''processes.manage'') or public.current_profile_has_permission(''dashboard.view'')'),
      ('product_group_item_process_capacities','INSERT','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_item_process_capacities','UPDATE','public.current_profile_has_permission(''processes.manage'')'),
      ('product_group_item_process_capacities','DELETE','public.current_profile_has_permission(''processes.manage'')'),
      ('order_process_schedules','SELECT','public.current_profile_has_permission(''menu.sequenciamento'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'')'),
      ('order_process_schedules','INSERT','public.current_profile_has_permission(''production.edit'')'),
      ('order_process_schedules','UPDATE','public.current_profile_has_permission(''production.edit'')'),
      ('order_process_schedules','DELETE','public.current_profile_has_permission(''production.edit'')'),
      ('process_schedule_settings','SELECT','public.current_profile_has_permission(''menu.sequenciamento'') or public.current_profile_has_permission(''production.view'') or public.current_profile_has_permission(''menu.fabrica1'') or public.current_profile_has_permission(''menu.fabrica2'')'),
      ('process_schedule_settings','INSERT','public.current_profile_has_permission(''production.edit'')'),
      ('process_schedule_settings','UPDATE','public.current_profile_has_permission(''production.edit'')'),
      ('process_schedule_settings','DELETE','public.current_profile_has_permission(''production.edit'')'),
      ('recruitment_vacancies','SELECT','public.current_profile_has_permission(''rh.recruitment.view'')'),
      ('recruitment_vacancies','INSERT','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_vacancies','UPDATE','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_vacancies','DELETE','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_candidates','SELECT','public.current_profile_has_permission(''rh.recruitment.view'')'),
      ('recruitment_candidates','INSERT','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_candidates','UPDATE','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_candidates','DELETE','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_approved_roles','SELECT','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_approved_roles','INSERT','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_approved_roles','UPDATE','public.current_profile_has_permission(''rh.recruitment.manage'')'),
      ('recruitment_approved_roles','DELETE','public.current_profile_has_permission(''rh.recruitment.manage'')')
    ) as policy_gates(table_name, command, permission_expression)
  loop
    if to_regclass(format('public.%I', v_gate.table_name)) is null then
      continue;
    end if;
    if not (v_gate.table_name = any(v_seen_tables)) then
      execute format(
        'drop policy if exists module_internal_base on public.%I',
        v_gate.table_name
      );
      execute format(
        'create policy module_internal_base on public.%I for all to authenticated using (public.current_profile_is_internal()) with check (public.current_profile_is_internal())',
        v_gate.table_name
      );
      v_seen_tables := array_append(v_seen_tables, v_gate.table_name);
    end if;
    v_name := 'permission_gate_' || lower(v_gate.command);
    execute format('drop policy if exists %I on public.%I', v_name, v_gate.table_name);
    if v_gate.command = 'SELECT' then
      execute format(
        'create policy %I on public.%I as restrictive for select to authenticated using (%s)',
        v_name, v_gate.table_name, v_gate.permission_expression
      );
    elsif v_gate.command = 'INSERT' then
      execute format(
        'create policy %I on public.%I as restrictive for insert to authenticated with check (%s)',
        v_name, v_gate.table_name, v_gate.permission_expression
      );
    elsif v_gate.command = 'UPDATE' then
      execute format(
        'create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)',
        v_name, v_gate.table_name, v_gate.permission_expression, v_gate.permission_expression
      );
    else
      execute format(
        'create policy %I on public.%I as restrictive for delete to authenticated using (%s)',
        v_name, v_gate.table_name, v_gate.permission_expression
      );
    end if;
  end loop;
end;
$$;

-- Atualiza checagens ADMIN-only de RPCs de catálogo para o permission key
-- granular. O restante das funções/validações do banco é preservado.
do $$
declare
  v_signature text;
  v_definition text;
  v_updated text;
  v_old_check text;
  v_new_check text;
begin
  for v_signature in
    select unnest(array[
      'public.save_product_group(bigint,text,text,jsonb)',
      'public.save_product_group_with_items(bigint,text,text,jsonb)',
      'public.delete_product_group(bigint)'
    ])
  loop
    if to_regprocedure(v_signature) is null then
      continue;
    end if;
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    v_old_check := 'if not public.is_admin() then';
    v_new_check := 'if not public.current_profile_has_permission(''processes.manage'') then';
    v_updated := replace(v_definition, v_old_check, v_new_check);
    if v_updated = v_definition then
      raise exception 'A checagem de acesso esperada não existe em %.', v_signature;
    end if;
    execute v_updated;
  end loop;

  v_signature := 'public.save_process_schedule(uuid,date,jsonb)';
  if to_regprocedure(v_signature) is not null then
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    v_old_check := 'if not public.has_role(array [''ADMIN'', ''GESTOR'']) then';
    v_new_check := 'if not public.current_profile_has_permission(''production.edit'') then';
    v_updated := replace(v_definition, v_old_check, v_new_check);
    if v_updated = v_definition then
      raise exception 'A checagem de acesso esperada não existe em %.', v_signature;
    end if;
    execute v_updated;
  end if;
end;
$$;

create or replace function public.can_manage_recruitment()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_has_permission('rh.recruitment.manage');
$$;

-- RPCs de status que foram introduzidas antes do modelo granular: trocam
-- a checagem de papel fixo pela permissão efetiva de status/edição.
create or replace function public.refresh_order_statuses(
  p_item_id uuid,
  p_item_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_status text;
  v_next text;
begin
  if not (
    public.current_profile_has_permission('production.update_status')
    or public.current_profile_has_permission('production.edit')
  ) then
    raise exception 'Sem permissão para atualizar o status do item.';
  end if;

  if p_item_status not in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO') then
    raise exception 'Status de item inválido: %', p_item_status;
  end if;

  update public.order_items
     set status = p_item_status, updated_at = now()
   where id = p_item_id;

  if not found then
    raise exception 'Item de pedido não encontrado.';
  end if;

  select oi.order_id, o.status
    into v_order_id, v_order_status
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.id = p_item_id;

  if v_order_status = 'CANCELADO' then
    return;
  end if;

  select case
           when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
           when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
           else 'PLANEJADO'
         end
    into v_next
    from public.order_items oi
   where oi.order_id = v_order_id;

  if v_next is distinct from v_order_status then
    update public.orders set status = v_next, updated_at = now() where id = v_order_id;
  end if;
end;
$$;

create or replace function public.refresh_order_statuses_bulk(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected integer;
  v_updated integer;
begin
  if not (
    public.current_profile_has_permission('production.update_status')
    or public.current_profile_has_permission('production.edit')
  ) then
    raise exception 'Sem permissão para atualizar o status do item.';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Payload de status inválido.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as row_data(item_id uuid, status text)
     where row_data.item_id is null
        or row_data.status is null
        or row_data.status not in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO')
  ) then
    raise exception 'Status de item inválido.';
  end if;

  select count(distinct row_data.item_id)
    into v_expected
    from jsonb_to_recordset(p_items) as row_data(item_id uuid, status text);

  if v_expected = 0 then
    return;
  end if;

  update public.order_items item
     set status = row_data.status, updated_at = now()
    from jsonb_to_recordset(p_items) as row_data(item_id uuid, status text)
   where item.id = row_data.item_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'Item de pedido não encontrado.';
  end if;

  with affected as (
    select distinct item.order_id
      from public.order_items item
      join jsonb_to_recordset(p_items) as row_data(item_id uuid, status text)
        on item.id = row_data.item_id
  ),
  derived as (
    select item.order_id,
           case
             when bool_and(item.status = 'CONCLUIDO') then 'CONCLUIDO'
             when bool_or(item.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
             else 'PLANEJADO'
           end as next_status
      from public.order_items item
     where item.order_id in (select order_id from affected)
     group by item.order_id
  )
  update public.orders order_row
     set status = derived.next_status, updated_at = now()
    from derived
   where order_row.id = derived.order_id
     and order_row.status <> 'CANCELADO'
     and order_row.status is distinct from derived.next_status;
end;
$$;

revoke all on function public.refresh_order_statuses(uuid, text) from public, anon;
revoke all on function public.refresh_order_statuses_bulk(jsonb) from public, anon;
grant execute on function public.refresh_order_statuses(uuid, text) to authenticated;
grant execute on function public.refresh_order_statuses_bulk(jsonb) to authenticated;

-- SECURITY DEFINER helpers below are callable as RPCs; return no production
-- facts to an external account even when its legacy role is GESTOR/ADMIN.
create or replace function public.order_kit_concluded(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      auth.uid() is null
      or (
        public.current_profile_is_internal()
        and (
          public.current_profile_has_permission('orders.view')
          or public.current_profile_has_permission('production.view')
          or public.current_profile_has_permission('production.edit')
          or public.current_profile_has_permission('production.update_status')
        )
      )
    )
    and p_order_id is not null
    and exists (
      select 1
        from public.order_items item
        join public.production_processes production on production.order_item_id = item.id
        join public.processes process on process.id = production.process_id
       where item.order_id = p_order_id
         and item.parent_order_item_id is not null
         and process.code = 'KIT'
         and production.status <> 'NAO_APLICAVEL'
    )
    and not exists (
      select 1
        from public.order_items item
        join public.production_processes production on production.order_item_id = item.id
        join public.processes process on process.id = production.process_id
       where item.order_id = p_order_id
         and item.parent_order_item_id is not null
         and process.code = 'KIT'
         and production.status <> 'NAO_APLICAVEL'
         and production.status <> 'CONCLUIDO'
    );
$$;

create or replace function public.order_exp_concluded(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      auth.uid() is null
      or (
        public.current_profile_is_internal()
        and (
          public.current_profile_has_permission('orders.view')
          or public.current_profile_has_permission('production.view')
          or public.current_profile_has_permission('production.edit')
          or public.current_profile_has_permission('production.update_status')
          or public.current_profile_has_permission('menu.sequenciamento')
        )
      )
    )
    and p_order_id is not null
    and exists (
      select 1
        from public.order_items item
        join public.production_processes production on production.order_item_id = item.id
        join public.processes process on process.id = production.process_id
       where item.order_id = p_order_id
         and item.parent_order_item_id is null
         and process.code = 'EXP'
         and production.status <> 'NAO_APLICAVEL'
    )
    and not exists (
      select 1
        from public.order_items item
       where item.order_id = p_order_id
         and item.parent_order_item_id is null
         and not exists (
           select 1
             from public.production_processes production
             join public.processes process on process.id = production.process_id
            where production.order_item_id = item.id
              and process.code = 'EXP'
         )
    )
    and not exists (
      select 1
        from public.order_items item
        join public.production_processes production on production.order_item_id = item.id
        join public.processes process on process.id = production.process_id
       where item.order_id = p_order_id
         and item.parent_order_item_id is null
         and process.code = 'EXP'
         and production.status <> 'NAO_APLICAVEL'
         and production.status <> 'CONCLUIDO'
    );
$$;

create or replace function public.order_fully_shipped(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      auth.uid() is null
      or (
        public.current_profile_is_internal()
        and (
          public.current_profile_has_permission('orders.view')
          or public.current_profile_has_permission('romaneio.view')
          or public.current_profile_has_permission('romaneio.edit')
        )
      )
    )
    and p_order_id is not null
    and exists (
      select 1
        from public.order_items root
       where root.order_id = p_order_id
         and root.parent_order_item_id is null
    )
    and not exists (
      select 1
        from public.order_items root
       where root.order_id = p_order_id
         and root.parent_order_item_id is null
         and coalesce((
           select sum(item.quantity)
             from public.romaneio_items item
             join public.romaneios romaneio on romaneio.id = item.romaneio_id
            where item.order_item_id = root.id
              and romaneio.status = 'CONFIRMADO'
         ), 0) < root.quantity
    );
$$;

-- -------------------------------------------------------------
-- Employees: leitura por permissão + escopo (empresa interna / cliente externo)
-- -------------------------------------------------------------
drop policy if exists "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select to authenticated using (
    public.current_profile_has_permission('rh.employees.view')
    and public.current_profile_can_view_employee(id)
  );

drop policy if exists "employees_insert_admin" on public.employees;
create policy "employees_insert_admin" on public.employees
  for insert to authenticated
  with check (
    (
      public.current_profile_has_permission('rh.employees.create')
      or public.current_profile_has_permission('rh.employees.import')
    )
    and (
      not public.current_profile_is_external()
      and public.current_profile_company_allowed(company_code)
    )
  );

drop policy if exists "employees_update_admin" on public.employees;
create policy "employees_update_admin" on public.employees
  for update to authenticated
  using (
    (
      public.current_profile_has_permission('rh.employees.edit')
      or public.current_profile_has_permission('rh.employees.import')
    )
    and (
      not public.current_profile_is_external()
      and public.current_profile_company_allowed(company_code)
    )
  )
  with check (
    (
      public.current_profile_has_permission('rh.employees.edit')
      or public.current_profile_has_permission('rh.employees.import')
    )
    and (
      not public.current_profile_is_external()
      and public.current_profile_company_allowed(company_code)
    )
  );

drop policy if exists "employees_delete_admin" on public.employees;
create policy "employees_delete_admin" on public.employees
  for delete to authenticated
  using (
    public.current_profile_has_permission('rh.employees.edit')
    and (
      not public.current_profile_is_external()
      and public.current_profile_company_allowed(company_code)
    )
  );

-- Importação: antes exigia ADMIN; agora exige a operação explícita.
create or replace function public.import_employees(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.current_profile_has_permission('rh.employees.import') then
    raise exception 'Você não tem permissão para importar funcionários.';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'A lista de funcionários para importação é inválida.';
  end if;

  if public.current_profile_is_external() then
    raise exception 'Usuários externos não podem importar funcionários.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_rows) as row_data(company_code text)
     where nullif(btrim(row_data.company_code), '') is null
        or not public.current_profile_company_allowed(btrim(row_data.company_code))
  ) then
    raise exception 'A importação contém empresa fora do escopo autorizado.';
  end if;

  insert into public.employees (
    company_code, company_name, registration, name,
    admission_date, dismissal_date, registered_client
  )
  select
    btrim(row_data.company_code),
    btrim(row_data.company_name),
    btrim(row_data.registration),
    btrim(row_data.name),
    nullif(row_data.admission_date, '')::date,
    nullif(row_data.dismissal_date, '')::date,
    nullif(btrim(row_data.registered_client), '')
  from jsonb_to_recordset(p_rows) as row_data (
    company_code text,
    company_name text,
    registration text,
    name text,
    admission_date text,
    dismissal_date text,
    registered_client text
  )
  on conflict (company_code, registration) do update set
    company_name = excluded.company_name,
    name = excluded.name,
    admission_date = coalesce(excluded.admission_date, public.employees.admission_date),
    dismissal_date = excluded.dismissal_date,
    registered_client = coalesce(excluded.registered_client, public.employees.registered_client),
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_employees(jsonb) from public, anon;
grant execute on function public.import_employees(jsonb) to authenticated;

-- -------------------------------------------------------------
-- Árvore de alocação: leitura e criação por permissão + escopo de cliente
-- -------------------------------------------------------------
drop policy if exists "employee_allocation_nodes_select" on public.employee_allocation_nodes;
create policy "employee_allocation_nodes_select" on public.employee_allocation_nodes
  for select to authenticated using (
    public.current_profile_has_permission('rh.allocations.view')
    and (
      not public.current_profile_is_external()
      or public.current_profile_can_access_node(id)
    )
  );

drop policy if exists "employee_allocation_nodes_insert" on public.employee_allocation_nodes;
create policy "employee_allocation_nodes_insert" on public.employee_allocation_nodes
  for insert to authenticated
  with check (
    public.current_profile_has_permission(
      case node_type
        when 'CLIENT' then 'rh.allocations.create_client'
        when 'LOCATION' then 'rh.allocations.create_location'
        when 'SHIFT' then 'rh.allocations.create_shift'
        when 'AREA' then 'rh.allocations.create_area'
        when 'POSITION' then 'rh.allocations.create_position'
        else 'rh.allocations.create_client'
      end
    )
    and (
      node_type = 'CLIENT'
      or public.current_profile_can_access_node(parent_id)
      or not public.current_profile_is_external()
    )
    and (
      node_type <> 'CLIENT'
      or not public.current_profile_is_external()
    )
  );

drop policy if exists "employee_allocation_nodes_update" on public.employee_allocation_nodes;
create policy "employee_allocation_nodes_update" on public.employee_allocation_nodes
  for update to authenticated
  using (
    (
      public.current_profile_has_permission('rh.allocations.edit')
      or public.current_profile_has_permission('rh.allocations.deactivate')
    )
    and (
      not public.current_profile_is_external()
      or public.current_profile_can_access_node(id)
    )
  )
  with check (
    (
      public.current_profile_has_permission('rh.allocations.edit')
      or public.current_profile_has_permission('rh.allocations.deactivate')
    )
    and (
      not public.current_profile_is_external()
      or public.current_profile_can_access_node(id)
    )
  );

-- RLS não distingue colunas em um UPDATE. Esta trigger impede que a
-- permissão de inativar seja usada para também renomear/mover nós.
-- A função de guarda de inativação precisa consultar todos os funcionários
-- alocados, independentemente do escopo de leitura do usuário.
create or replace function public.guard_employee_allocation_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active and not new.active and exists (
    with recursive descendants as (
      select id
        from public.employee_allocation_nodes
       where id = old.id
      union all
      select child.id
        from public.employee_allocation_nodes child
        join descendants parent on child.parent_id = parent.id
    )
    select 1
      from public.employees employee
      join descendants descendant on descendant.id = employee.allocation_position_id
     where employee.dismissal_date is null
  ) then
    raise exception 'Transfira os funcionários alocados antes de inativar esta estrutura.';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_employee_allocation_update_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_edit_changed boolean;
  v_active_changed boolean;
begin
  -- Operações de migration/service-role sem JWT são confiáveis e mantêm
  -- compatibilidade com manutenção administrativa fora da sessão do app.
  if auth.uid() is null then
    return new;
  end if;

  v_edit_changed :=
    old.company_code is distinct from new.company_code
    or old.company_name is distinct from new.company_name
    or old.parent_id is distinct from new.parent_id
    or old.node_type is distinct from new.node_type
    or old.name is distinct from new.name
    or old.location_leader is distinct from new.location_leader
    or old.location_supervisor is distinct from new.location_supervisor
    or old.sort_order is distinct from new.sort_order;
  v_active_changed := old.active is distinct from new.active;

  if v_edit_changed
     and not public.current_profile_has_permission('rh.allocations.edit') then
    raise exception 'Você não tem permissão para editar itens da árvore.';
  end if;
  if v_active_changed
     and not public.current_profile_has_permission('rh.allocations.deactivate') then
    raise exception 'Você não tem permissão para inativar itens da árvore.';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_allocation_nodes_enforce_update_permission
  on public.employee_allocation_nodes;
create trigger employee_allocation_nodes_enforce_update_permission
  before update on public.employee_allocation_nodes
  for each row execute function public.enforce_employee_allocation_update_permission();

-- Atribuição/remoção de funcionários: permissão explícita, somente interno.
create or replace function public.assign_employee_allocation(p_employee_id uuid, p_position_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position public.employee_allocation_nodes%rowtype;
  v_employee public.employees%rowtype;
  v_client text;
  v_location text;
  v_shift text;
  v_area text;
begin
  if public.current_profile_is_external() then
    raise exception 'Usuários externos não podem alterar a alocação de funcionários.';
  end if;

  if not public.current_profile_has_permission('rh.allocations.assign') then
    raise exception 'Você não tem permissão para alocar funcionários.';
  end if;

  select * into v_employee
    from public.employees
   where id = p_employee_id;
  if not found then
    raise exception 'Funcionário não encontrado.';
  end if;
  if not public.current_profile_is_external()
     and not public.current_profile_company_allowed(v_employee.company_code) then
    raise exception 'Funcionário fora do escopo das empresas vinculadas ao seu usuário.';
  end if;

  if p_position_id is null then
    update public.employees
       set allocation_position_id = null
     where id = p_employee_id;
    return;
  end if;

  select * into v_position
    from public.employee_allocation_nodes
   where id = p_position_id;
  if not found or v_position.node_type <> 'POSITION' then
    raise exception 'O vínculo deve apontar para uma posição.';
  end if;

  if exists (
    select 1 from public.employees
     where allocation_position_id = p_position_id
       and id <> p_employee_id
  ) then
    raise exception 'Esta posição já está ocupada. Atualize a árvore e escolha outra vaga.';
  end if;

  -- Reconstrói os textos de alocação a partir dos ancestrais da posição.
  with recursive ancestors(id, parent_id, node_type, name, depth) as (
    select node.id, node.parent_id, node.node_type, node.name, 0
      from public.employee_allocation_nodes node
     where node.id = p_position_id
    union all
    select parent.id, parent.parent_id, parent.node_type, parent.name, child.depth + 1
      from public.employee_allocation_nodes parent
      join ancestors child on parent.id = child.parent_id
  )
  select
    max(name) filter (where node_type = 'CLIENT'),
    max(name) filter (where node_type = 'LOCATION'),
    max(name) filter (where node_type = 'SHIFT'),
    max(name) filter (where node_type = 'AREA')
  into v_client, v_location, v_shift, v_area
  from ancestors;

  update public.employees
     set allocation_position_id = p_position_id,
         client = v_client,
         location = v_location,
         area = v_area,
         shift = v_shift
   where id = p_employee_id;
end;
$$;

revoke all on function public.assign_employee_allocation(uuid, uuid) from public, anon;
grant execute on function public.assign_employee_allocation(uuid, uuid) to authenticated;

create or replace function public.delete_employee_allocation_subtree(p_node_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.employee_allocation_nodes%rowtype;
  v_descendant record;
begin
  if not public.current_profile_has_permission('rh.allocations.delete') then
    raise exception 'Você não tem permissão para excluir itens da árvore de alocações.';
  end if;

  if public.current_profile_is_external() then
    raise exception 'Usuários externos não podem excluir a estrutura de alocação.';
  end if;

  select * into v_node
    from public.employee_allocation_nodes
   where id = p_node_id
   for update;
  if not found then
    raise exception 'Item da árvore não encontrado.';
  end if;
  if v_node.node_type = 'COMPANY' then
    raise exception 'A empresa empregadora fixa não pode ser excluída.';
  end if;

  if exists (
    with recursive subtree(id) as (
      select p_node_id
      union all
      select child.id
        from public.employee_allocation_nodes child
        join subtree parent on child.parent_id = parent.id
    )
    select 1
      from public.employees employee
      join subtree on subtree.id = employee.allocation_position_id
  ) then
    raise exception 'Desaloque ou transfira os funcionários antes de excluir esta estrutura.';
  end if;

  for v_descendant in
    with recursive subtree(id, depth) as (
      select p_node_id, 0
      union all
      select child.id, parent.depth + 1
        from public.employee_allocation_nodes child
        join subtree parent on child.parent_id = parent.id
    )
    select id from subtree order by depth desc
  loop
    delete from public.employee_allocation_nodes
     where id = v_descendant.id;
  end loop;
end;
$$;

revoke all on function public.delete_employee_allocation_subtree(uuid) from public, anon;
grant execute on function public.delete_employee_allocation_subtree(uuid) to authenticated;

commit;
