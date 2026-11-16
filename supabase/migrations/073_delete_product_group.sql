-- =============================================================
-- 073) Exclusão de grupos de produto
-- =============================================================
-- A 068 criou select/insert/update em product_groups, mas nenhuma
-- policy de DELETE — o grant existia sem que o comando passasse pela
-- RLS. Esta migration libera a exclusão para ADMIN (as capacidades e os
-- itens saem por cascade; as OFs ficam sem família por on delete set null)
-- e expõe a RPC usada pela tela de grupos.

create policy "product_groups_delete" on public.product_groups
  for delete to authenticated using (public.is_admin());

create or replace function public.delete_product_group(p_group_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  if not public.is_admin() then
    raise exception 'Você não tem permissão para excluir grupos de produto.';
  end if;

  if p_group_id is null then
    raise exception 'Grupo de produto inválido.';
  end if;

  delete from public.product_groups
   where id = p_group_id
   returning id into v_deleted;

  if v_deleted is null then
    raise exception 'Grupo de produto não encontrado.';
  end if;
end;
$$;

revoke execute on function public.delete_product_group(bigint) from public, anon;
grant execute on function public.delete_product_group(bigint) to authenticated;
