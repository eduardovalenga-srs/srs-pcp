-- 044) Seletor em cascata de /romaneio/novo — get_romaneio_customers:
--      clientes com OFs DISPONÍVEIS para romaneio, cada um com a lista
--      das suas OFs em jsonb. Reusa get_romaneio_candidates (mesma regra
--      de candidatas: não cancelada + com item raiz); as totalmente
--      expedidas ficam de fora — não são "disponíveis para romaneio".
--      Cliente vazio/nulo vira um bucket único (customer_name null — a
--      tela exibe "Cliente não informado"), sempre no fim da lista.
--      Teto de 5000 candidatas por resposta (o seletor carrega de uma
--      vez; num cliente real o volume de OFs abertas é muito menor).
-- -------------------------------------------------------------
create or replace function public.get_romaneio_customers()
returns table (
  customer_name text,
  of_count bigint,
  ofs jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return query
    select nullif(trim(c.customer_name), '') as customer_name,
           count(*)::bigint as of_count,
           jsonb_agg(
             jsonb_build_object(
               'order_id', c.order_id,
               'code', c.code,
               'type', c.type,
               'delivery_date', c.delivery_date,
               'status', c.status,
               'root_quantity', c.root_quantity,
               'root_weight_kg', c.root_weight_kg,
               'shipped_quantity', c.shipped_quantity,
               'has_simulation', c.has_simulation,
               'simulation_id', c.simulation_id
             )
             order by c.delivery_date asc nulls last, c.code asc
           ) as ofs
      from public.get_romaneio_candidates(p_limit => 5000) c
     -- Totalmente expedida (qtd raiz > 0 e Σ emitido >= raiz) não abre carga.
     where not (c.root_quantity > 0 and c.shipped_quantity >= c.root_quantity)
     group by 1
     order by 1 asc nulls last;
end;
$$;

revoke execute on function public.get_romaneio_customers() from anon;
grant execute on function public.get_romaneio_customers() to authenticated;
