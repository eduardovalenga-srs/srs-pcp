-- =============================================================
-- 104_internal_admin_bootstrap.sql
-- External accounts cannot inspect profiles due RLS. Expose only a boolean
-- for the bootstrap banner and allow the claim RPC only for internal users.
-- =============================================================
begin;

create or replace function public.current_system_has_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles profile
     where profile.role = 'ADMIN'
       and profile.account_type = 'INTERNAL'
       and profile.active
  );
$$;

revoke all on function public.current_system_has_admin() from public, anon;
grant execute on function public.current_system_has_admin() to authenticated;

create or replace function public.claim_first_admin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type public.access_account_type;
  v_active boolean;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select profile.account_type, profile.active
    into v_account_type, v_active
    from public.profiles profile
   where profile.id = v_uid;

  if not found or not v_active then
    raise exception 'Perfil interno ativo não encontrado.';
  end if;
  if v_account_type <> 'INTERNAL' then
    raise exception 'Usuários externos não podem reivindicar o acesso de administrador.';
  end if;

  -- Serializa duas reivindicações simultâneas do primeiro administrador.
  lock table public.profiles in share row exclusive mode;

  if public.current_system_has_admin() then
    return jsonb_build_object(
      'claimed', false,
      'message', 'Já existe um administrador interno cadastrado.'
    );
  end if;

  update public.profiles
     set role = 'ADMIN', updated_at = now()
   where id = v_uid
     and account_type = 'INTERNAL'
     and active;

  if not found then
    raise exception 'Não foi possível promover este perfil.';
  end if;

  return jsonb_build_object(
    'claimed', true,
    'message', 'Você agora é administrador do sistema.'
  );
end;
$$;

revoke all on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated;

commit;
