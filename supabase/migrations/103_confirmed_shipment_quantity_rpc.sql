-- =============================================================
-- 103_confirmed_shipment_quantity_rpc.sql
-- Aggregate confirmed shipment quantity in the database.
--
-- The Fábrica 1 overdue card previously downloaded every matching
-- romaneio_items row through a PostgREST relationship query. On large
-- item sets that produced very large requests/responses and could fail
-- at the Supabase gateway. Return one summed row per requested item.
-- =============================================================
begin;

create index if not exists idx_romaneio_items_item_receipt_quantity
  on public.romaneio_items (order_item_id, romaneio_id)
  include (quantity);

create or replace function public.get_confirmed_quantity_by_item_ids(
  p_item_ids uuid[]
)
returns table (
  order_item_id uuid,
  quantity numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if not public.current_profile_is_internal() then
      raise exception 'Usuários externos não podem consultar dados de expedição.';
    end if;
    if not (
      public.current_profile_has_permission('orders.view')
      or public.current_profile_has_permission('production.view')
      or public.current_profile_has_permission('menu.fabrica1')
      or public.current_profile_has_permission('menu.fabrica2')
      or public.current_profile_has_permission('fabrica2.view')
      or public.current_profile_has_permission('dashboard.view')
      or public.current_profile_has_permission('romaneio.view')
    ) then
      raise exception 'Você não tem permissão para consultar quantidades expedidas.';
    end if;
  end if;

  if p_item_ids is null then
    return;
  end if;
  if cardinality(p_item_ids) > 2000 then
    raise exception 'A consulta excede o limite de itens.';
  end if;

  return query
    select item.order_item_id, sum(item.quantity)::numeric
      from public.romaneio_items item
      join public.romaneios receipt on receipt.id = item.romaneio_id
     where item.order_item_id = any(p_item_ids)
       and receipt.status = 'CONFIRMADO'
     group by item.order_item_id;
end;
$$;

revoke all on function public.get_confirmed_quantity_by_item_ids(uuid[]) from public, anon;
grant execute on function public.get_confirmed_quantity_by_item_ids(uuid[]) to authenticated;

commit;
