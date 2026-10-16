-- -------------------------------------------------------------
-- 033) Fábrica 1: página de GRUPOS por código de item filho (dentro da OF)
--
-- A tela listava uma linha por item filho; o mesmo componente (cp_comp)
-- se repete entre os itens pai de uma OF e a visão de insumos/compras
-- precisa da SOMA. A RPC devolve a página de grupos (chave = código do
-- filho, com fallback para a descrição quando o código vem vazio) MAIS
-- os ids dos itens membros — a montagem (somas, situação agregada dos
-- processos, materiais mesclados) acontece no servidor da app, em
-- src/lib/utils/child-item-groups.ts.
--
-- Escopo e ordenação:
--   * grupos nunca atravessam OFs (order_id participa da chave);
--   * os 11 filtros são os MESMOS da listagem/card (clonados da
--     get_child_items_totals da 024): o filtro escolhe as LINHAS e os
--     grupos são os códigos distintos delas — a soma da linha bate
--     sempre com o que está filtrado;
--   * ordena pela MENOR entrega do grupo (com fallback para a data da
--     OF, mesma semântica de exibição) e depois pela chave —
--     determinística para a paginação;
--   * 'total' é o nº de GRUPOS (paginação e card); os somatórios de
--     quantidade/peso continuam na get_child_items_totals.
--
-- Casos-limite: página vazia devolve groups: [] (total segue real);
-- p_limit/p_offset negativos viram 0 (nenhum grupo na página).
--
-- Gerada por script a partir da 024 (cláusula WHERE copiada com
-- contagem de ocorrências — falha alto se a 024 mudar).
-- -------------------------------------------------------------
create or replace function public.get_child_item_groups(
  p_search text default null,
  p_order_code text default null,
  p_customer text default null,
  p_child_item text default null,
  p_description text default null,
  p_material text default null,
  p_parent_ids uuid[] default null,
  p_delivery_from date default null,
  p_delivery_to date default null,
  p_process_id uuid default null,
  p_process_status text default null,
  p_offset integer default 0,
  p_limit integer default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select oi.id, oi.order_id, oi.parent_item, oi.description, oi.delivery_date,
           o.delivery_date as order_delivery_date
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.parent_order_item_id is not null
        and (p_search is null
             or oi.description ilike '%' || p_search || '%'
             or coalesce(oi.parent_item, '') ilike '%' || p_search || '%')
        and (p_order_code is null or o.code ilike '%' || p_order_code || '%')
        and (p_customer is null or coalesce(o.customer_name, '') ilike '%' || p_customer || '%')
        and (p_child_item is null or coalesce(oi.parent_item, '') ilike '%' || p_child_item || '%')
        and (p_description is null or oi.description ilike '%' || p_description || '%')
        and (p_material is null or exists (
              select 1 from public.order_item_materials m
               where m.order_item_id = oi.id
                 and m.description ilike '%' || p_material || '%'))
        and (p_parent_ids is null or oi.parent_order_item_id = any (p_parent_ids))
        and (p_delivery_from is null or oi.delivery_date >= p_delivery_from)
        and (p_delivery_to is null or oi.delivery_date <= p_delivery_to)
        and (p_process_id is null or exists (
              select 1 from public.production_processes pp
               where pp.order_item_id = oi.id
                 and pp.process_id = p_process_id
                 and (p_process_status is null or pp.status = p_process_status)))
        and (p_process_id is not null or p_process_status is null or exists (
              select 1 from public.production_processes pp
               where pp.order_item_id = oi.id
                 and pp.status = p_process_status))
  ),
  grouped as (
    select order_id,
           coalesce(nullif(btrim(parent_item), ''), btrim(description)) as key,
           min(coalesce(delivery_date, order_delivery_date)) as delivery_key,
           array_agg(
             id order by coalesce(nullif(btrim(parent_item), ''), btrim(description)), id
           ) as item_ids
      from filtered
     group by order_id, key
  ),
  page as (
    select *
      from grouped
     order by delivery_key nulls last, key
     limit greatest(coalesce(p_limit, 25), 0)
     offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from grouped),
    'groups', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'orderId', order_id,
          'key', key,
          'itemIds', item_ids
        ) order by delivery_key nulls last, key
      ),
      '[]'::jsonb
    )
  )
  from page;
$$;

revoke execute on function public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer) from anon;
grant execute on function public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer) to authenticated;
