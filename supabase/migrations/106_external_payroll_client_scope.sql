-- =============================================================
-- 106_external_payroll_client_scope.sql
-- Permite a usuários externos consultar funcionários vinculados ao cliente
-- pela folha (`registered_client`), antes da alocação na árvore.
-- A correspondência é exata após normalizar caixa, acentos e espaços, e
-- aceita referências compostas por segmentos separados por / , ; ou |.
-- =============================================================
begin;

create or replace function public.normalize_client_reference(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select regexp_replace(
    translate(
      lower(btrim(coalesce(p_value, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  );
$$;

revoke all on function public.normalize_client_reference(text) from public, anon, authenticated;

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
           and (
             (
               employee.allocation_position_id is not null
               and public.current_profile_can_access_node(employee.allocation_position_id)
             )
             or exists (
               select 1
                 from public.profile_client_access access
                 join public.employee_allocation_nodes client
                   on client.id = access.client_node_id
                  and client.node_type = 'CLIENT'
                  and client.parent_id is null
                where access.profile_id = auth.uid()
                  and employee.registered_client is not null
                  and exists (
                    select 1
                      from regexp_split_to_table(
                        employee.registered_client,
                        '[/,;|]+'
                      ) as payroll_client(name)
                     where public.normalize_client_reference(payroll_client.name)
                         = public.normalize_client_reference(client.name)
                  )
             )
           )
         )
       )
  );
$$;

revoke all on function public.current_profile_can_view_employee(uuid) from public, anon;
grant execute on function public.current_profile_can_view_employee(uuid) to authenticated;

commit;
