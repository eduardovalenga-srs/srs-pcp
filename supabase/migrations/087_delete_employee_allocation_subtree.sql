-- Exclusão gráfica de um nó com seus descendentes, sem remover empresas-raiz
-- ou funcionários atualmente alocados na subárvore.
begin;

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
  if not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Você não tem permissão para excluir itens da árvore de alocações.';
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

  -- Exclui de baixo para cima para respeitar a FK parent_id com RESTRICT.
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
