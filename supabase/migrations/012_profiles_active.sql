-- -------------------------------------------------------------
-- 012) Conta de usuário: status ativo, troca de senha pendente
--      e blindagem de privilégios no profile.
--
-- Contexto (gestão de usuários):
--   * usuários são criados pelo ADMIN em /configuracoes com senha
--     temporária (service role no Auth); o trigger handle_new_user
--     nasce o profile como OPERADOR e o serviço aplica o perfil;
--   * "desativar" (active = false) bloqueia login E sessões abertas —
--     nunca há exclusão de usuário (histórico preserva o responsável);
--   * must_change_password cobre a senha temporária (banner na UI).
--
-- Blindagem: a política de UPDATE de profiles permitia ao próprio
-- usuário editar a própria linha — inclusive o campo role (escalação
-- de privilégio via PostgREST). Este trigger restringe role/active/
-- email a administradores. Papéis com super/bypassrls (postgres na
-- migração, service_role e o contexto SECURITY DEFINER de
-- claim_first_admin/handle_new_user) passam sempre.
-- -------------------------------------------------------------

alter table public.profiles
  add column if not exists active boolean not null default true;

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

comment on column public.profiles.active is
  'false = login e sessões bloqueados (desativação; histórico preservado).';

comment on column public.profiles.must_change_password is
  'true = usuário recebeu senha temporária e precisa definir a própria.';

-- -------------------------------------------------------------
-- Proteção de privilégios (colunas sensíveis só por ADMIN).
-- Trigger INVOKER de propósito: enxerga o papel real da chamada
-- (authenticated/service_role/postgres) mesmo dentro de funções
-- SECURITY DEFINER como claim_first_admin.
-- -------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Papel com super/bypassrls (migrations, service client, definer
  -- de handle_new_user e claim_first_admin): não passa pela regra.
  if exists (
    select 1 from pg_roles
     where rolname = current_user
       and (rolsuper or rolbypassrls)
  ) then
    return new;
  end if;

  -- Criação de linha: sessão comum exige ADMIN (o handle_new_user e
  -- demais contexto sem sessão são liberados aqui e pelo bypass acima).
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'Perfil criado apenas pelo administrador.';
    end if;
    return new;
  end if;

  -- Atualização por sessão comum: colunas sensíveis exigem ADMIN.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'Somente administrador altera perfil, status ou e-mail.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_privileges on public.profiles;
create trigger profiles_protect_privileges
  before insert or update on public.profiles
  for each row execute function public.protect_profile_privileges();
