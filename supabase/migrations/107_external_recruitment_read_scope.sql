-- =============================================================
-- 107_external_recruitment_read_scope.sql
-- External users may read vacancies and candidates belonging to their
-- linked client roots. All write operations remain internal/manage-only.
-- =============================================================
begin;

-- Allow the explicit read permission for external accounts. Recruitment
-- management and all other internal capabilities remain excluded.
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
      'rh.allocations.create_position',
      'rh.recruitment.view'
    )
  );
$$;

revoke all on function public.current_profile_has_permission(text) from public, anon;
grant execute on function public.current_profile_has_permission(text) to authenticated;

-- Security-definer check for candidate rows. It reads the parent vacancy
-- without exposing vacancy records outside the user's assigned client roots.
create or replace function public.current_profile_can_access_recruitment_vacancy(
  p_vacancy_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.recruitment_vacancies vacancy
     where vacancy.id = p_vacancy_id
       and public.current_profile_is_external()
       and public.current_profile_has_permission('rh.recruitment.view')
       and public.current_profile_can_access_node(vacancy.allocation_client_id)
  );
$$;

revoke all on function public.current_profile_can_access_recruitment_vacancy(uuid)
  from public, anon;
grant execute on function public.current_profile_can_access_recruitment_vacancy(uuid)
  to authenticated;

-- Replace the generic "internal only" restrictive policies for these two
-- tables with internal access or client-scoped external SELECT. The write
-- check remains internal only, and the existing permission_gate policies
-- still require rh.recruitment.manage for all writes.
drop policy if exists internal_account_required on public.recruitment_vacancies;
create policy internal_account_required on public.recruitment_vacancies
  as restrictive for all to authenticated
  using (
    (select public.current_profile_is_internal())
    or (
      (select public.current_profile_is_external())
      and (select public.current_profile_has_permission('rh.recruitment.view'))
      and (select public.current_profile_can_access_node(allocation_client_id))
    )
  )
  with check ((select public.current_profile_is_internal()));

drop policy if exists internal_account_required on public.recruitment_candidates;
create policy internal_account_required on public.recruitment_candidates
  as restrictive for all to authenticated
  using (
    (select public.current_profile_is_internal())
    or (
      (select public.current_profile_is_external())
      and (select public.current_profile_has_permission('rh.recruitment.view'))
      and (select public.current_profile_can_access_recruitment_vacancy(vacancy_id))
    )
  )
  with check ((select public.current_profile_is_internal()));

-- Add permissive SELECT policies for external users, constrained to CLIENT
-- roots explicitly assigned in profile_client_access. These do not permit
-- INSERT/UPDATE/DELETE; internal users keep their existing policies.
drop policy if exists recruitment_vacancies_external_client_select
  on public.recruitment_vacancies;
create policy recruitment_vacancies_external_client_select
  on public.recruitment_vacancies
  for select to authenticated
  using (
    (select public.current_profile_is_external())
    and (select public.current_profile_has_permission('rh.recruitment.view'))
    and (select public.current_profile_can_access_node(allocation_client_id))
  );

drop policy if exists recruitment_candidates_external_client_select
  on public.recruitment_candidates;
create policy recruitment_candidates_external_client_select
  on public.recruitment_candidates
  for select to authenticated
  using (
    (select public.current_profile_is_external())
    and (select public.current_profile_has_permission('rh.recruitment.view'))
    and (select public.current_profile_can_access_recruitment_vacancy(vacancy_id))
  );

commit;
