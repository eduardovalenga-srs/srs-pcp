-- =============================================================
-- 108_approved_roles_client_scope.sql
-- Scope the approved-role catalog to the selected client.
-- Internal users filter the management list by client; external users can
-- read only roles for linked client roots and cannot mutate the catalog.
-- =============================================================
begin;

create or replace function public.current_profile_recruitment_clients()
returns table (
  id uuid,
  name text,
  active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_profile_is_external() then
    if not public.current_profile_has_permission('rh.recruitment.view') then
      raise exception 'Você não tem permissão para consultar os cargos aprovados.';
    end if;

    return query
      select client.id, client.name, client.active
        from public.profile_client_access access
        join public.employee_allocation_nodes client
          on client.id = access.client_node_id
       where access.profile_id = auth.uid()
         and client.node_type = 'CLIENT'
         and client.parent_id is null
       order by client.name;
    return;
  end if;

  if not public.current_profile_is_internal()
     or not (
       public.current_profile_has_permission('rh.recruitment.view')
       or public.current_profile_has_permission('rh.recruitment.manage')
     ) then
    raise exception 'Você não tem permissão para consultar os cargos aprovados.';
  end if;

  return query
    select client.id, client.name, client.active
      from public.employee_allocation_nodes client
     where client.node_type = 'CLIENT'
       and client.parent_id is null
     order by client.name;
end;
$$;

revoke all on function public.current_profile_recruitment_clients() from public, anon;
grant execute on function public.current_profile_recruitment_clients() to authenticated;

-- Replace the internal-only restrictive policy with a scoped external
-- SELECT path. The WITH CHECK remains internal, so external writes stay
-- denied even if another permissive policy is added later.
drop policy if exists internal_account_required on public.recruitment_approved_roles;
create policy internal_account_required on public.recruitment_approved_roles
  as restrictive for all to authenticated
  using (
    (select public.current_profile_is_internal())
    or (
      (select public.current_profile_is_external())
      and (select public.current_profile_has_permission('rh.recruitment.view'))
      and (select public.current_profile_can_access_node(client_id))
    )
  )
  with check ((select public.current_profile_is_internal()));

-- The existing 101 SELECT gate was for internal management only. Add the
-- read permission while retaining manage access for existing administrators.
drop policy if exists permission_gate_select on public.recruitment_approved_roles;
create policy permission_gate_select on public.recruitment_approved_roles
  as restrictive for select to authenticated
  using (
    (select public.current_profile_has_permission('rh.recruitment.view'))
    or (select public.current_profile_has_permission('rh.recruitment.manage'))
  );

drop policy if exists recruitment_approved_roles_external_client_select
  on public.recruitment_approved_roles;
create policy recruitment_approved_roles_external_client_select
  on public.recruitment_approved_roles
  for select to authenticated
  using (
    (select public.current_profile_is_external())
    and (select public.current_profile_has_permission('rh.recruitment.view'))
    and (select public.current_profile_can_access_node(client_id))
  );

commit;
