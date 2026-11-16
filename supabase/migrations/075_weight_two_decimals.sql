-- -------------------------------------------------------------
-- 075) PESOS em 2 casas decimais
--
-- Problema: pesos (kg) eram gravados/derivados com 3+ casas. Restos
-- de 0,001 mantinham OFs "pendentes" no recebimento de MP: o plano
-- pedia 20,001 kg e a nota recebia 20,000 — o saldo 0,001 > 0 entrava
-- em get_mp_receipt_customers e o item nunca fechava.
--
-- Regra: TODO peso em kg tem 2 casas (arredondamento half-up, igual ao
-- Postgres `round`). Quantidades de peças, metros, m² e demais unidades
-- NÃO mudam.
--
--   1. BACKFILL do histórico nos campos de peso;
--   2. TRIGGERS normalizam novos registros (insert/update);
--   3. FUNÇÕES de peso proporcional/saldo arredondam o resultado —
--      o saldo de MP fecha e o 0,001 deixa de existir.
--
-- `trim_scale` mantém o formato de exibição do numeric (50, não 50,00)
-- — a mesma decisão da 023.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Backfill: order_items (peso unitário e total)
-- -------------------------------------------------------------
update public.order_items
   set unit_weight_kg = trim_scale(round(unit_weight_kg, 2))
 where unit_weight_kg is not null
   and unit_weight_kg is distinct from trim_scale(round(unit_weight_kg, 2));

update public.order_items
   set total_weight_kg = trim_scale(round(quantity * unit_weight_kg, 2))
 where unit_weight_kg is not null
   and total_weight_kg is distinct from trim_scale(round(quantity * unit_weight_kg, 2));

update public.order_items
   set total_weight_kg = null
 where unit_weight_kg is null
   and total_weight_kg is not null;

-- -------------------------------------------------------------
-- 2) Backfill: recebimento de MP (grão material + itens fora da OF)
-- -------------------------------------------------------------
-- Linhas abaixo de meio centésimo arredondariam a zero e violariam o
-- CHECK (> 0); removê-las equivale exatamente ao valor normalizado 0.
delete from public.mp_receipt_materials
 where round(quantity_kg, 2) = 0;

update public.mp_receipt_materials
   set quantity_kg = trim_scale(round(quantity_kg, 2))
 where quantity_kg is distinct from trim_scale(round(quantity_kg, 2));

delete from public.mp_receipt_free_items
 where upper(btrim(unit)) = 'KG'
   and round(quantity, 2) = 0;

update public.mp_receipt_free_items
   set quantity = trim_scale(round(quantity, 2))
 where upper(btrim(unit)) = 'KG'
   and quantity is distinct from trim_scale(round(quantity, 2));

-- -------------------------------------------------------------
-- 3) Backfill: matérias-primas em KG (item e romaneio)
-- -------------------------------------------------------------
delete from public.order_item_materials
 where upper(btrim(unit)) = 'KG'
   and round(quantity, 2) = 0;

update public.order_item_materials
   set quantity = trim_scale(round(quantity, 2))
 where upper(btrim(unit)) = 'KG'
   and quantity is distinct from trim_scale(round(quantity, 2));

update public.romaneio_materials
   set quantity_planned = coalesce(trim_scale(round(quantity_planned, 2)), 0),
       quantity_received = case
         when quantity_received is null then null
         else trim_scale(round(quantity_received, 2))
       end,
       quantity_used = case
         when quantity_used is null then null
         else trim_scale(round(quantity_used, 2))
       end
 where upper(btrim(unit)) = 'KG'
   and (
     quantity_planned is distinct from coalesce(trim_scale(round(quantity_planned, 2)), 0)
     or (quantity_received is not null
         and quantity_received is distinct from trim_scale(round(quantity_received, 2)))
     or (quantity_used is not null
         and quantity_used is distinct from trim_scale(round(quantity_used, 2)))
   );

-- -------------------------------------------------------------
-- 4) Backfill: espelho MP (quantidades do processo MP são kg)
-- -------------------------------------------------------------
update public.production_processes pp
   set quantity_planned = case
         when pp.quantity_planned is null then null
         else trim_scale(round(pp.quantity_planned, 2))
       end,
       quantity_completed = case
         when pp.quantity_completed is null then null
         else trim_scale(round(pp.quantity_completed, 2))
       end
  from public.processes p
 where p.id = pp.process_id
   and p.code = 'MP'
   and (
     (pp.quantity_planned is not null
       and pp.quantity_planned is distinct from trim_scale(round(pp.quantity_planned, 2)))
     or (pp.quantity_completed is not null
       and pp.quantity_completed is distinct from trim_scale(round(pp.quantity_completed, 2)))
   );

-- -------------------------------------------------------------
-- 5) Backfill: capacidade kg/dia dos grupos de produto
-- -------------------------------------------------------------
-- As colunas nasceram numeric(14,3); retirar o typmod permite que
-- trim_scale mantenha a escala gravada (12,5 em vez de 12,500) e não
-- limita outras unidades a 3 casas.
alter table public.product_group_process_capacities
  alter column capacity type numeric using capacity::numeric;

alter table public.product_group_item_process_capacities
  alter column capacity type numeric using capacity::numeric;

update public.product_group_process_capacities
   set capacity = trim_scale(round(capacity, 2))
 where unit = 'KG'
   and capacity is distinct from trim_scale(round(capacity, 2));

update public.product_group_item_process_capacities
   set capacity = trim_scale(round(capacity, 2))
 where unit = 'KG'
   and capacity is distinct from trim_scale(round(capacity, 2));

-- -------------------------------------------------------------
-- 6) Triggers: novos registros sempre com 2 casas
-- -------------------------------------------------------------
-- 6.1) Item: arredonda o peso unitário e recalcula o total (023).
create or replace function public.set_item_total_weight()
returns trigger
language plpgsql
as $$
begin
  if new.unit_weight_kg is not null then
    new.unit_weight_kg := trim_scale(round(new.unit_weight_kg, 2));
  end if;

  new.total_weight_kg := case
    when new.quantity is not null and new.unit_weight_kg is not null
      then trim_scale(round(new.quantity * new.unit_weight_kg, 2))
    else null
  end;
  return new;
end;
$$;

drop trigger if exists order_items_total_weight on public.order_items;
create trigger order_items_total_weight
  before insert or update on public.order_items
  for each row
  execute function public.set_item_total_weight();

-- 6.2) Recebimento de MP (cada linha é peso em kg).
create or replace function public.set_mp_receipt_material_weight_scale()
returns trigger
language plpgsql
as $$
begin
  new.quantity_kg := trim_scale(round(new.quantity_kg, 2));
  return new;
end;
$$;

drop trigger if exists mp_receipt_materials_weight_scale on public.mp_receipt_materials;
create trigger mp_receipt_materials_weight_scale
  before insert or update on public.mp_receipt_materials
  for each row
  execute function public.set_mp_receipt_material_weight_scale();

-- 6.3) Material fora da OF — só quando a unidade é KG.
create or replace function public.set_mp_free_item_weight_scale()
returns trigger
language plpgsql
as $$
begin
  if upper(btrim(new.unit)) = 'KG' then
    new.quantity := trim_scale(round(new.quantity, 2));
  end if;
  return new;
end;
$$;

drop trigger if exists mp_receipt_free_items_weight_scale on public.mp_receipt_free_items;
create trigger mp_receipt_free_items_weight_scale
  before insert or update on public.mp_receipt_free_items
  for each row
  execute function public.set_mp_free_item_weight_scale();

-- 6.4) Matéria-prima do item — só em KG (m, m², un… mantêm a escala).
create or replace function public.set_order_item_material_weight_scale()
returns trigger
language plpgsql
as $$
begin
  if upper(btrim(new.unit)) = 'KG' then
    new.quantity := trim_scale(round(new.quantity, 2));
  end if;
  return new;
end;
$$;

drop trigger if exists order_item_materials_weight_scale on public.order_item_materials;
create trigger order_item_materials_weight_scale
  before insert or update on public.order_item_materials
  for each row
  execute function public.set_order_item_material_weight_scale();

-- 6.5) Material do romaneio — só em KG.
create or replace function public.set_romaneio_material_weight_scale()
returns trigger
language plpgsql
as $$
begin
  if upper(btrim(new.unit)) = 'KG' then
    new.quantity_planned := coalesce(trim_scale(round(new.quantity_planned, 2)), 0);
    if new.quantity_received is not null then
      new.quantity_received := trim_scale(round(new.quantity_received, 2));
    end if;
    if new.quantity_used is not null then
      new.quantity_used := trim_scale(round(new.quantity_used, 2));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists romaneio_materials_weight_scale on public.romaneio_materials;
create trigger romaneio_materials_weight_scale
  before insert or update on public.romaneio_materials
  for each row
  execute function public.set_romaneio_material_weight_scale();

-- 6.6) Espelho MP: quantidades do processo MP são kg.
create or replace function public.set_production_process_weight_scale()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.processes p
     where p.id = new.process_id and p.code = 'MP'
  ) then
    if new.quantity_planned is not null then
      new.quantity_planned := trim_scale(round(new.quantity_planned, 2));
    end if;
    if new.quantity_completed is not null then
      new.quantity_completed := trim_scale(round(new.quantity_completed, 2));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists production_processes_weight_scale on public.production_processes;
create trigger production_processes_weight_scale
  before insert or update on public.production_processes
  for each row
  execute function public.set_production_process_weight_scale();

-- 6.7) Capacidade kg/dia dos grupos de produto (M2/unidades intactos).
create or replace function public.set_capacity_weight_scale()
returns trigger
language plpgsql
as $$
begin
  if new.unit = 'KG' then
    new.capacity := trim_scale(round(new.capacity, 2));
  end if;
  return new;
end;
$$;

drop trigger if exists product_group_capacities_weight_scale
  on public.product_group_process_capacities;
create trigger product_group_capacities_weight_scale
  before insert or update on public.product_group_process_capacities
  for each row
  execute function public.set_capacity_weight_scale();

drop trigger if exists product_group_item_capacities_weight_scale
  on public.product_group_item_process_capacities;
create trigger product_group_item_capacities_weight_scale
  before insert or update on public.product_group_item_process_capacities
  for each row
  execute function public.set_capacity_weight_scale();

-- -------------------------------------------------------------
-- 7) Peso (kg) de uma linha de material — 059 com 2 casas
-- -------------------------------------------------------------
create or replace function public.mp_material_weight_kg(p_unit text, p_quantity numeric)
returns numeric
language sql
immutable
as $$
  select case
    when upper(btrim(p_unit)) = 'KG' then trim_scale(round(p_quantity, 2))
    when upper(btrim(p_unit)) = 'G' then trim_scale(round(p_quantity / 1000.0, 2))
    else null
  end
$$;

revoke execute on function public.mp_material_weight_kg(text, numeric) from anon;
grant execute on function public.mp_material_weight_kg(text, numeric) to authenticated;

-- -------------------------------------------------------------
-- 8) Plano de material da OF — need_kg com 2 casas (059)
--    É a fonte do saldo de MP: sem isto o plano pedia 20,001.
-- -------------------------------------------------------------
create or replace function public.mp_order_material_plan(p_order_id uuid)
returns table (
  order_item_id uuid,
  material_key text,
  description text,
  unit text,
  need_kg numeric,
  fill_seq bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select oi.id,
           oi.description,
           oi.parent_item,
           oi.seq,
           oi.parent_order_item_id,
           coalesce(oi.total_weight_kg, oi.quantity * oi.unit_weight_kg) as item_weight
      from public.order_items oi
     where oi.order_id = p_order_id
       and (oi.parent_order_item_id is not null
            or not exists (
                 select 1 from public.order_items c
                  where c.parent_order_item_id = oi.id
               ))
  ),
  grouped as (
    select e.*,
           (select p.parent_item
              from public.order_items p
             where p.id = e.parent_order_item_id) as parent_code,
           (
             select min(s.seq)
               from public.order_items s
              where s.id = coalesce(e.parent_order_item_id, e.id)
                 or s.parent_order_item_id = coalesce(e.parent_order_item_id, e.id)
           ) as group_seq
      from eligible e
  ),
  weighed as (
    select g.id as order_item_id,
           g.parent_code,
           g.parent_item,
           g.seq,
           g.group_seq,
           g.item_weight,
           m.description,
           m.unit,
           public.mp_material_key(m.description, m.unit) as material_key,
           public.mp_material_weight_kg(m.unit, m.quantity) as need_kg
      from grouped g
      join public.order_item_materials m on m.order_item_id = g.id
  ),
  real_rows as (
    select w.* from weighed w where w.need_kg is not null and w.need_kg > 0
  ),
  fallback_rows as (
    select g.id as order_item_id,
           g.parent_code,
           g.parent_item,
           g.seq,
           g.group_seq,
           g.item_weight,
           g.description,
           'KG'::text as unit,
           public.mp_material_key(g.description, 'KG') as material_key,
           coalesce(g.item_weight, 1) as need_kg
      from grouped g
     where not exists (
             select 1 from public.order_item_materials m
              where m.order_item_id = g.id
                and public.mp_material_weight_kg(m.unit, m.quantity) > 0
           )
  ),
  all_rows as (
    select * from real_rows
    union all
    select * from fallback_rows
  )
  select a.order_item_id,
         a.material_key,
         a.description,
         a.unit,
         trim_scale(round(a.need_kg, 2)) as need_kg,
         row_number() over (
           order by a.group_seq asc nulls last,
                    a.seq asc nulls last,
                    a.parent_code asc nulls last,
                    a.parent_item asc nulls last,
                    a.order_item_id asc
         ) as fill_seq
    from all_rows a
$$;

revoke execute on function public.mp_order_material_plan(uuid) from anon;
grant execute on function public.mp_order_material_plan(uuid) to authenticated;

-- -------------------------------------------------------------
-- 9) Cobertura do MP — alocado com 2 casas (059)
-- -------------------------------------------------------------
create or replace function public.mp_order_material_allocation(p_order_id uuid)
returns table (
  order_item_id uuid,
  material_key text,
  description text,
  unit text,
  need_kg numeric,
  allocated_kg numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with plan as (
    select * from public.mp_order_material_plan(p_order_id)
  ),
  received as (
    select rm.material_key,
           sum(rm.quantity_kg) as received_kg
      from public.mp_receipt_materials rm
      join public.mp_receipts r on r.id = rm.mp_receipt_id
     where r.order_id = p_order_id
     group by rm.material_key
  ),
  cumulative as (
    select p.*,
           coalesce(
             sum(p.need_kg) over (
               partition by p.material_key order by p.fill_seq
               rows between unbounded preceding and 1 preceding
             ),
             0
           ) as need_before
      from plan p
  )
  select c.order_item_id,
         c.material_key,
         c.description,
         c.unit,
         c.need_kg,
         trim_scale(round(
           least(
             c.need_kg,
             greatest(coalesce(rv.received_kg, 0) - c.need_before, 0)
           ),
           2
         )) as allocated_kg
    from cumulative c
    left join received rv on rv.material_key = c.material_key
$$;

revoke execute on function public.mp_order_material_allocation(uuid) from anon;
grant execute on function public.mp_order_material_allocation(uuid) to authenticated;

-- -------------------------------------------------------------
-- 10) Materiais da OF (tela): total, recebido e saldo com 2 casas
-- -------------------------------------------------------------
create or replace function public.mp_order_materials(p_order_id uuid)
returns table (
  material_key text,
  description text,
  unit text,
  need_kg numeric,
  received_kg numeric,
  balance_kg numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with plan as (
    select * from public.mp_order_material_plan(p_order_id)
  ),
  totals as (
    select p.material_key,
           (array_agg(p.description order by p.fill_seq))[1] as description,
           (array_agg(p.unit order by p.fill_seq))[1] as unit,
           sum(p.need_kg) as need_kg
      from plan p
     group by p.material_key
  ),
  received as (
    select rm.material_key,
           sum(rm.quantity_kg) as received_kg
      from public.mp_receipt_materials rm
      join public.mp_receipts r on r.id = rm.mp_receipt_id
     where r.order_id = p_order_id
     group by rm.material_key
  )
  select t.material_key,
         t.description,
         t.unit,
         trim_scale(round(t.need_kg, 2)) as need_kg,
         trim_scale(round(coalesce(rv.received_kg, 0), 2)) as received_kg,
         trim_scale(round(t.need_kg - coalesce(rv.received_kg, 0), 2)) as balance_kg
    from totals t
    left join received rv on rv.material_key = t.material_key
   order by t.description, t.unit
$$;

revoke execute on function public.mp_order_materials(uuid) from anon;
grant execute on function public.mp_order_materials(uuid) to authenticated;

-- -------------------------------------------------------------
-- 11) Fatos do MP do item — planejado/recebido com 2 casas (059)
-- -------------------------------------------------------------
create or replace function public.mp_item_mp_facts(p_order_item_id uuid)
returns table (
  planned_kg numeric,
  received_kg numeric,
  state text
)
language sql
stable
security invoker
set search_path = public
as $$
  with alloc as (
    select a.*
      from public.mp_order_material_allocation(
             (select oi.order_id from public.order_items oi where oi.id = p_order_item_id)
           ) a
  ),
  kids as (
    select c.id,
           sum(a.need_kg) as planned_kg,
           sum(a.allocated_kg) as received_kg
      from alloc a
      join public.order_items c on c.id = a.order_item_id
     where c.parent_order_item_id = p_order_item_id
     group by c.id
  ),
  own as (
    select sum(a.need_kg) as planned_kg,
           sum(a.allocated_kg) as received_kg
      from alloc a
     where a.order_item_id = p_order_item_id
  )
  select trim_scale(round(case
    when (select count(*) from kids) > 0 then (select sum(k.planned_kg) from kids k)
    else (select o.planned_kg from own o)
  end, 2)) as planned_kg,
  trim_scale(round(case
    when (select count(*) from kids) > 0 then (select coalesce(sum(k.received_kg), 0) from kids k)
    else (select coalesce(o.received_kg, 0) from own o)
  end, 2)) as received_kg,
  case
    when (select count(*) from kids) > 0 then
      case
        when (select count(*) from kids k where k.received_kg <= 0) = 0
          and (select count(*) from kids k where k.received_kg > 0 and k.received_kg < k.planned_kg) = 0
          then 'TOTAL'
        when (select coalesce(sum(k.received_kg), 0) from kids k) > 0 then 'PARCIAL'
        else 'NONE'
      end
    else
      case
        when (select coalesce(o.received_kg, 0) from own o) <= 0 then 'NONE'
        when (select o.planned_kg from own o) is null
          or (select o.planned_kg from own o) <= 0 then 'TOTAL'
        when (select o.received_kg from own o) >= (select o.planned_kg from own o) then 'TOTAL'
        else 'PARCIAL'
      end
  end as state
$$;

revoke execute on function public.mp_item_mp_facts(uuid) from anon;
grant execute on function public.mp_item_mp_facts(uuid) to authenticated;

-- -------------------------------------------------------------
-- 12) Seletor de recebimento: pendência só com saldo ≥ 0,01
-- -------------------------------------------------------------
create or replace function public.get_mp_receipt_customers()
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
    select nullif(trim(o.customer_name), '') as customer_name,
           count(*)::bigint as of_count,
           jsonb_agg(
             jsonb_build_object(
               'order_id', o.id,
               'code', o.code,
               'type', o.type,
               'delivery_date', o.delivery_date,
               'status', o.status,
               'pending_materials', o.pending_materials,
               'pending_kg', o.pending_kg
             )
             order by o.delivery_date asc nulls last, o.code asc
           ) as ofs
      from (
        select ord.id,
               ord.code,
               ord.type,
               ord.delivery_date,
               ord.status,
               ord.customer_name,
               m.pending_materials,
               m.pending_kg
          from public.orders ord
          join lateral (
            select count(*) filter (where trim_scale(round(mt.balance_kg, 2)) > 0)::bigint
                     as pending_materials,
                   coalesce(sum(greatest(trim_scale(round(mt.balance_kg, 2)), 0)), 0)
                     as pending_kg
              from public.mp_order_materials(ord.id) mt
          ) m on true
         where ord.status <> 'CANCELADO'
           and m.pending_materials > 0
      ) o
     group by 1
     order by 1 asc nulls last;
end;
$$;

revoke execute on function public.get_mp_receipt_customers() from anon;
grant execute on function public.get_mp_receipt_customers() to authenticated;

-- -------------------------------------------------------------
-- 13) RPCs de peso proporcional/saldos (050, 054, 066, 074)
--
-- As funções evoluem em migrações anteriores e têm corpos longos. Aqui
-- obtemos a definição já instalada (a mais recente) e alteramos somente
-- as expressões de peso. A transformação preserva assinatura, permissões,
-- filtros e ordenações das RPCs, sem copiar os corpos inteiros.
-- -------------------------------------------------------------
do $$
declare
  v_function record;
  v_definition text;
  v_updated text;
begin
  for v_function in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'get_romaneios_page',
         'get_romaneio_summary',
         'get_production_rows',
         'get_production_rows_by_order',
         'get_production_stats',
         'get_child_item_groups',
         'get_child_items_totals',
         'get_child_item_groups_page',
         'get_child_items_kit_overdue_totals',
         'get_completed_weight_stats'
       )
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := v_definition;

    if v_function.proname in ('get_romaneios_page', 'get_romaneio_summary') then
      -- 050: carga de KG/G e fallback por quantidade × peso unitário.
      if position('round(coalesce(sum(case' in v_updated) = 0 then
        v_updated := replace(v_updated, 'coalesce(sum(case', 'round(coalesce(sum(case');
        v_updated := replace(v_updated, 'end), 0) as used_weight', 'end), 0), 2) as used_weight');
      end if;
      v_updated := replace(
        v_updated,
        'else coalesce(sum(oi.unit_weight_kg * ri.quantity), 0)',
        'else round(coalesce(sum(oi.unit_weight_kg * ri.quantity), 0), 2)'
      );
    end if;

    -- 054: saldo expedido por item; 066: saldo proporcional dos filhos.
    if position('round(greatest(oi.total_weight_kg' in v_updated) = 0 then
      v_updated := regexp_replace(
        v_updated,
        'greatest\(oi\.total_weight_kg[[:space:]]*-[[:space:]]*coalesce\(s\.shipped, 0\)[[:space:]]*\*[[:space:]]*coalesce\(oi\.unit_weight_kg, 0\), 0\)',
        'round(greatest(oi.total_weight_kg - coalesce(s.shipped, 0) * coalesce(oi.unit_weight_kg, 0), 0), 2)',
        'g'
      );
    end if;
    if position('round(oi.total_weight_kg * pb.qty / pb.planned, 2)' in v_updated) = 0 then
      v_updated := replace(
        v_updated,
        'oi.total_weight_kg * pb.qty / pb.planned',
        'round(oi.total_weight_kg * pb.qty / pb.planned, 2)'
      );
    end if;
    if position('round(c.planned_weight * pb.pending / pb.planned, 2)' in v_updated) = 0 then
      v_updated := replace(
        v_updated,
        'c.planned_weight * pb.pending / pb.planned',
        'round(c.planned_weight * pb.pending / pb.planned, 2)'
      );
    end if;
    if position('round(c.planned_total_w * pb.qty / pb.planned, 2)' in v_updated) = 0 then
      v_updated := replace(
        v_updated,
        'c.planned_total_w * pb.qty / pb.planned',
        'round(c.planned_total_w * pb.qty / pb.planned, 2)'
      );
    end if;

    -- 074: arredonda peso concluído por célula antes das somas/buckets.
    if v_function.proname = 'get_completed_weight_stats' then
      v_updated := replace(
        v_updated,
        'coalesce(nullif(pp.quantity_completed, 0), nullif(pp.quantity_planned, 0), oi.quantity, 0)' ||
        chr(10) || '        * coalesce(oi.unit_weight_kg, 0) as weight_kg',
        'round(coalesce(nullif(pp.quantity_completed, 0), nullif(pp.quantity_planned, 0), oi.quantity, 0)' ||
        chr(10) || '        * coalesce(oi.unit_weight_kg, 0), 2) as weight_kg'
      );
    end if;

    if v_updated <> v_definition then
      execute v_updated;
    end if;
  end loop;
end;
$$;
