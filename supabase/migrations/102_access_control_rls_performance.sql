-- =============================================================
-- 102_access_control_rls_performance.sql
-- Cache de checagens constantes de autorização por statement.
--
-- Policies RLS chamavam funções SECURITY DEFINER diretamente para cada
-- linha lida. Envolvê-las em subqueries escalares permite ao PostgreSQL
-- calculá-las como InitPlan uma vez por statement, sem alterar a regra
-- nem o escopo efetivo de acesso.
-- =============================================================
begin;

do $$
declare
  v_policy record;
  v_roles text;
  v_command text;
  v_mode text;
  v_using text;
  v_check text;
  v_sql text;
begin
  for v_policy in
    select
      policy.oid,
      policy.polname,
      policy.polcmd,
      policy.polpermissive,
      policy.polroles,
      relation.relname as table_name,
      pg_get_expr(policy.polqual, policy.polrelid) as using_expression,
      pg_get_expr(policy.polwithcheck, policy.polrelid) as check_expression
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and (
        coalesce(pg_get_expr(policy.polqual, policy.polrelid), '') ~
          'current_profile_(has_permission|is_internal|is_external)\('
        or coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '') ~
          'current_profile_(has_permission|is_internal|is_external)\('
      )
  loop
    select string_agg(
      case
        when role_id = 0 then 'public'
        else quote_ident(role.rolname)
      end,
      ', ' order by role_id
    )
      into v_roles
      from unnest(v_policy.polroles) as role_ids(role_id)
      left join pg_roles role on role.oid = role_id;

    v_command := case v_policy.polcmd
      when 'r' then 'select'
      when 'a' then 'insert'
      when 'w' then 'update'
      when 'd' then 'delete'
      when '*' then 'all'
      else null
    end;
    if v_command is null then
      raise exception 'Comando RLS não suportado: %', v_policy.polcmd;
    end if;

    v_mode := case when v_policy.polpermissive then 'permissive' else 'restrictive' end;
    v_using := v_policy.using_expression;
    v_check := v_policy.check_expression;

    if v_using is not null then
      v_using := regexp_replace(
        v_using,
        '(public\.)?current_profile_has_permission\(([^()]*)\)',
        '(select public.current_profile_has_permission(\2))',
        'g'
      );
      v_using := regexp_replace(
        v_using,
        '(public\.)?current_profile_is_internal\(\)',
        '(select public.current_profile_is_internal())',
        'g'
      );
      v_using := regexp_replace(
        v_using,
        '(public\.)?current_profile_is_external\(\)',
        '(select public.current_profile_is_external())',
        'g'
      );
    end if;

    if v_check is not null then
      v_check := regexp_replace(
        v_check,
        '(public\.)?current_profile_has_permission\(([^()]*)\)',
        '(select public.current_profile_has_permission(\2))',
        'g'
      );
      v_check := regexp_replace(
        v_check,
        '(public\.)?current_profile_is_internal\(\)',
        '(select public.current_profile_is_internal())',
        'g'
      );
      v_check := regexp_replace(
        v_check,
        '(public\.)?current_profile_is_external\(\)',
        '(select public.current_profile_is_external())',
        'g'
      );
    end if;

    execute format(
      'drop policy %I on public.%I',
      v_policy.polname,
      v_policy.table_name
    );

    v_sql := format(
      'create policy %I on public.%I as %s for %s to %s',
      v_policy.polname,
      v_policy.table_name,
      v_mode,
      v_command,
      v_roles
    );
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;
    execute v_sql;
  end loop;
end;
$$;

commit;
