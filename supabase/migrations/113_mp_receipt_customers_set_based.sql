-- -------------------------------------------------------------
-- 113) Seletor de recebimento de MP — cálculo em LOTE
--
-- Problema: /recebimento-mp/novo chamava get_mp_receipt_customers(),
-- que percorria TODA OF não cancelada e, para cada uma, chamava
-- mp_order_materials(ord.id) numa junção lateral. Cada chamada
-- reconstruía o plano de material da OF (itens elegíveis, materiais,
-- fallback sintético e recebimentos). Com o volume atual isso passou
-- do statement_timeout do Postgres (57014) e a tela deixou de abrir.
--
-- Correção: a mesma conta passa a ser feita UMA vez para o conjunto
-- de OFs (set-based), sem a chamada por OF:
--   * itens elegíveis = filhos + raízes sem filhos (regra 057);
--   * necessidade = materiais com peso > 0 (KG/G) e, para item sem
--     material em peso, o grupo SINTÉTICO da 059;
--   * recebido = Σ de mp_receipt_materials das notas da OF;
--   * saldo = necessidade − recebido, com o MESMO arredondamento de
--     duas casas da 075 (por isso trim_scale(round(..., 2)) em cada
--     etapa — trocar a ordem muda quem aparece como pendente);
--   * pendência por MATERIAL (não por item), como a tela exibe.
--
-- Contrato inalterado: customer_name / of_count / ofs (order_id,
-- code, type, delivery_date, status, pending_materials, pending_kg).
-- A função segue SECURITY INVOKER (RLS do chamador) e STABLE.
--
-- mp_order_materials(uuid) NÃO muda — continua sendo o cálculo por
-- OF usado na tela de conferência e a referência dos testes.
-- -------------------------------------------------------------

create or replace function public.get_mp_receipt_customers()
returns table (
  customer_name text,
  of_count bigint,
  ofs jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped_orders as (
    select o.id,
           o.code,
           o.type,
           o.delivery_date,
           o.status,
           o.customer_name
      from public.orders o
     where o.status <> 'CANCELADO'
  ),
  -- Itens elegíveis ao MP: filhos + raízes sem filhos (regra 057).
  eligible_items as (
    select oi.id,
           oi.order_id,
           oi.description,
           coalesce(oi.total_weight_kg, oi.quantity * oi.unit_weight_kg) as item_weight
      from public.order_items oi
      join scoped_orders so on so.id = oi.order_id
     where oi.parent_order_item_id is not null
        or not exists (
             select 1
               from public.order_items c
              where c.parent_order_item_id = oi.id
           )
  ),
  -- Necessidade por item: só materiais cujo peso (KG/G) é positivo.
  real_need as (
    select ei.order_id,
           public.mp_material_key(m.description, m.unit) as material_key,
           trim_scale(round(public.mp_material_weight_kg(m.unit, m.quantity), 2)) as need_kg
      from eligible_items ei
      join public.order_item_materials m on m.order_item_id = ei.id
     where public.mp_material_weight_kg(m.unit, m.quantity) > 0
  ),
  -- Item elegível sem material em peso: grupo sintético da 059.
  synthetic_need as (
    select ei.order_id,
           public.mp_material_key(ei.description, 'KG') as material_key,
           trim_scale(round(coalesce(ei.item_weight, 1), 2)) as need_kg
      from eligible_items ei
     where not exists (
             select 1
               from public.order_item_materials m
              where m.order_item_id = ei.id
                and public.mp_material_weight_kg(m.unit, m.quantity) > 0
           )
  ),
  -- Necessidade total por (OF, material) — uma linha por material.
  material_need as (
    select n.order_id,
           n.material_key,
           trim_scale(round(sum(n.need_kg), 2)) as need_kg
      from (
        select order_id, material_key, need_kg from real_need
        union all
        select order_id, material_key, need_kg from synthetic_need
      ) n
     group by n.order_id, n.material_key
  ),
  -- Recebido total por (OF, material) — todas as notas de entrada.
  material_received as (
    select r.order_id,
           rm.material_key,
           trim_scale(round(sum(rm.quantity_kg), 2)) as received_kg
      from public.mp_receipt_materials rm
      join public.mp_receipts r on r.id = rm.mp_receipt_id
      join scoped_orders so on so.id = r.order_id
     group by r.order_id, rm.material_key
  ),
  -- Pendência da OF: conta MATERIAIS com saldo > 0 e soma os saldos.
  pending as (
    select n.order_id,
           (count(*) filter (
              where trim_scale(round(n.need_kg - coalesce(rv.received_kg, 0), 2)) > 0
            ))::bigint as pending_materials,
           coalesce(
             sum(
               greatest(
                 trim_scale(round(n.need_kg - coalesce(rv.received_kg, 0), 2)),
                 0
               )
             ),
             0
           ) as pending_kg
      from material_need n
      left join material_received rv
        on rv.order_id = n.order_id
       and rv.material_key = n.material_key
     group by n.order_id
  )
  select nullif(trim(so.customer_name), '') as customer_name,
         count(*)::bigint as of_count,
         jsonb_agg(
           jsonb_build_object(
             'order_id', so.id,
             'code', so.code,
             'type', so.type,
             'delivery_date', so.delivery_date,
             'status', so.status,
             'pending_materials', p.pending_materials,
             'pending_kg', p.pending_kg
           )
           order by so.delivery_date asc nulls last, so.code asc
         ) as ofs
    from pending p
    join scoped_orders so on so.id = p.order_id
   where p.pending_materials > 0
   group by 1
   order by 1 asc nulls last;
$$;

revoke execute on function public.get_mp_receipt_customers() from anon;
grant execute on function public.get_mp_receipt_customers() to authenticated;
