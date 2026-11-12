-- -------------------------------------------------------------
-- 059) Recebimento de MP por NOTA DE ENTRADA (grão MATÉRIA-PRIMA)
--
-- A tela /recebimento-mp deixa de ser por ITEM FILHO e passa a ser
-- por MATÉRIA-PRIMA: uma linha por material da OF, somando os itens
-- que o consomem, com o PESO TOTAL (somado) e o SALDO (o que ainda
-- falta). As colunas item e item pai saem da tela.
--
-- O grão da VERDADE muda junto com a tela: o que se grava é a NOTA
-- DE ENTRADA (nº digitado + data + observação) e, dentro dela, o
-- PESO recebido de cada MATERIAL. A linha do item some: o material
-- é o insumo, o item é quem consome.
--
-- O ESPELHO por ITEM (a coluna MP das telas de fábrica) continua
-- existindo — é ele que libera a produção — mas passa a ser
-- DERIVADO do material pelo PREENCHIMENTO SEQUENCIAL: o material
-- recebido vai cobrindo os itens na ORDEM DE PRODUÇÃO (seq do grupo,
-- seq do item, código). Item coberto por completo = verde
-- (CONCLUIDO); parcial = amarelo; nada = padrão. Assim dá para
-- começar a produzir com parte do material — a portão do MP.
--
-- O saldo é o que falta para o material fechar: peso total − o que
-- já foi recebido em TODAS as notas de entrada (recebimentos
-- parciais em n notas somam entre si).
--
-- GRÃO DE CADA COISA:
--   * nota de entrada   = mp_receipts (nº digitado + data + obs);
--   * linha da nota     = mp_receipt_materials (material + kg);
--   * cobertura do item = DERIVADA (mp_order_material_allocation).
--
-- MATERIAIS SEM PESO: o recebimento é por PESO (kg), então material
-- em unidade não-ponderal (UN, M, CX…) não entra no fluxo de kg.
-- O item ELEGÍVEL sem nenhum material em peso cai num grupo
-- SINTÉTICO (a própria descrição do item, unidade KG) com o peso
-- planejado dele — assim ele continua sendo recebível como hoje
-- (item sem MP cadastrada ainda fecha o MP da OF).
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Chave normalizada do material (descrição + unidade).
--    Mesma convenção do merge do romaneio (materialKey): maiúsculas
--    e sem espaços nas pontas, para casar "TB42.20X3.56" com
--    " TB42.20X3.56 " e "TB42.20X3.56".
-- -------------------------------------------------------------
create or replace function public.mp_material_key(p_description text, p_unit text)
returns text
language sql
immutable
as $$
  select upper(btrim(p_description)) || '::' || upper(btrim(p_unit))
$$;

revoke execute on function public.mp_material_key(text, text) from anon;
grant execute on function public.mp_material_key(text, text) to authenticated;

-- -------------------------------------------------------------
-- 2) Peso (kg) de uma linha de material. Só KG e G entram — as
--    demais unidades não são peso (parafuso, metro, caixa…).
-- -------------------------------------------------------------
create or replace function public.mp_material_weight_kg(p_unit text, p_quantity numeric)
returns numeric
language sql
immutable
as $$
  select case
    when upper(btrim(p_unit)) = 'KG' then p_quantity
    when upper(btrim(p_unit)) = 'G' then p_quantity / 1000.0
    else null
  end
$$;

revoke execute on function public.mp_material_weight_kg(text, numeric) from anon;
grant execute on function public.mp_material_weight_kg(text, numeric) to authenticated;

-- -------------------------------------------------------------
-- 3) Tabela de linhas da nota de entrada (grão MATERIAL).
-- -------------------------------------------------------------
create table if not exists public.mp_receipt_materials (
  id                    uuid primary key default gen_random_uuid(),
  mp_receipt_id         uuid not null references public.mp_receipts (id) on delete cascade,
  material_key          text not null check (length(trim(material_key)) > 0),
  material_description  text not null check (length(trim(material_description)) > 0),
  material_unit         text not null check (length(trim(material_unit)) > 0),
  quantity_kg           numeric not null check (quantity_kg > 0),
  created_at            timestamptz not null default now(),
  unique (mp_receipt_id, material_key)
);

create index if not exists idx_mp_receipt_materials_receipt_id
  on public.mp_receipt_materials (mp_receipt_id);

create index if not exists idx_mp_receipt_materials_material
  on public.mp_receipt_materials (material_key);

alter table public.mp_receipt_materials enable row level security;

drop policy if exists "mp_receipt_materials_select" on public.mp_receipt_materials;
create policy "mp_receipt_materials_select" on public.mp_receipt_materials
  for select to authenticated using (true);

drop policy if exists "mp_receipt_materials_insert" on public.mp_receipt_materials;
create policy "mp_receipt_materials_insert" on public.mp_receipt_materials
  for insert to authenticated
  with check (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

drop policy if exists "mp_receipt_materials_delete" on public.mp_receipt_materials;
create policy "mp_receipt_materials_delete" on public.mp_receipt_materials
  for delete to authenticated
  using (public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1']));

-- -------------------------------------------------------------
-- 4) O cabeçalho vira a NOTA DE ENTRADA: nº digitado + data.
-- -------------------------------------------------------------
alter table public.mp_receipts
  add column if not exists entry_number text not null default '';

alter table public.mp_receipts
  rename column receipt_date to entry_date;

-- -------------------------------------------------------------
-- 5) Conversão das linhas antigas (grão ITEM) para o grão
--     MATERIAL. Item com um material em peso: vai inteiro. Item
--     com vários: dividido na proporção do peso de cada material.
--     Item sem material em peso: grupo sintético (a descrição do
--     próprio item, em KG).
--     (Em produção não havia nenhuma linha — a conversão é
--     defensiva.)
-- -------------------------------------------------------------
with conv as (
  select ri.id,
         ri.mp_receipt_id,
         ri.quantity_kg,
         m.description,
         m.unit,
         public.mp_material_key(m.description, m.unit) as material_key,
         public.mp_material_weight_kg(m.unit, m.quantity) as w
    from public.mp_receipt_items ri
    join public.order_item_materials m on m.order_item_id = ri.order_item_id
   where public.mp_material_weight_kg(m.unit, m.quantity) > 0
),
split as (
  select c.mp_receipt_id,
         c.material_key,
         c.description,
         c.unit,
         case
           when sum(c.w) over (partition by c.id) > 0
             then c.quantity_kg * c.w / sum(c.w) over (partition by c.id)
           else 0
         end as qty
    from conv c
),
synthetic as (
  select ri.mp_receipt_id,
         public.mp_material_key(oi.description, 'KG') as material_key,
         oi.description,
         'KG'::text as unit,
         ri.quantity_kg as qty
    from public.mp_receipt_items ri
    join public.order_items oi on oi.id = ri.order_item_id
   where not exists (
     select 1 from public.order_item_materials m
      where m.order_item_id = ri.order_item_id
        and public.mp_material_weight_kg(m.unit, m.quantity) > 0
   )
),
all_lines as (
  select * from split where qty > 0
  union all
  select * from synthetic
)
insert into public.mp_receipt_materials (
  mp_receipt_id, material_key, material_description, material_unit, quantity_kg
)
select mp_receipt_id, material_key, description, unit, sum(qty)
  from all_lines
 group by mp_receipt_id, material_key, description, unit
on conflict (mp_receipt_id, material_key)
do update set quantity_kg = excluded.quantity_kg;

-- As funções da 056/057/058 que ainda falam de mp_receipt_items saem
-- antes da tabela (a 059 redefine todas — seções 15 a 20).
drop function if exists public.mp_receipt_recover_legacy(boolean, text, uuid);
drop function if exists public.mp_receipt_rollback_legacy();
drop function if exists public.save_mp_receipt(uuid, text, jsonb);
drop function if exists public.delete_mp_receipt(uuid);
drop function if exists public.mp_receipt_sync_item(uuid, uuid);
drop function if exists public.mp_receipt_sync_parent(uuid, uuid);
drop function if exists public.get_mp_receipt_customers();

drop table if exists public.mp_receipt_items;

-- -------------------------------------------------------------
-- 6) Plano de material da OF: uma linha por (item elegível, grupo
--    de material) com o peso que aquele item consome.
--
--    Elegíveis = filhos + raízes sem filhos (regra 057).
--    Itens sem material em peso entram no grupo SINTÉTICO (a
--    descrição do próprio item, em KG) com o peso planejado do
--    item — mantêm a possibilidade de fechar o MP de um item sem
--    MP cadastrada.
--
--    fill_seq = a ORDEM DE PRODUÇÃO (seq do grupo, seq do item,
--    código do pai, código do item, id) — é a ordem em que o
--    material recebido vai cobrindo os itens.
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
         a.need_kg,
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
-- 7) Cobertura: quanto de cada material já foi recebido na OF e
--    quanto disso cobre cada item (preenchimento sequencial).
--
--    O pool de cada material (received_kg) é distribuído na ordem
--    de produção: o primeiro item da ordem leva o que precisa, o
--    resto passa para o próximo. O excedente do que a OF precisa
--    simplesmente não é alocado.
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
         least(
           c.need_kg,
           greatest(coalesce(rv.received_kg, 0) - c.need_before, 0)
         ) as allocated_kg
    from cumulative c
    left join received rv on rv.material_key = c.material_key
$$;

revoke execute on function public.mp_order_material_allocation(uuid) from anon;
grant execute on function public.mp_order_material_allocation(uuid) to authenticated;

-- -------------------------------------------------------------
-- 8) Materiais da OF (a tela): peso total, já recebido e saldo.
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
         t.need_kg,
         coalesce(rv.received_kg, 0) as received_kg,
         t.need_kg - coalesce(rv.received_kg, 0) as balance_kg
    from totals t
    left join received rv on rv.material_key = t.material_key
   order by t.description, t.unit
$$;

revoke execute on function public.mp_order_materials(uuid) from anon;
grant execute on function public.mp_order_materials(uuid) to authenticated;

-- -------------------------------------------------------------
-- 9) Fatos do MP de um item: peso planejado, peso recebido e
--    situação.
--    Item com filhos = agregado deles (regra 057, pior caso);
--    item elegível = o próprio consumo de material.
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
  select case
    when (select count(*) from kids) > 0 then (select sum(k.planned_kg) from kids k)
    else (select o.planned_kg from own o)
  end as planned_kg,
  case
    when (select count(*) from kids) > 0 then (select coalesce(sum(k.received_kg), 0) from kids k)
    else (select coalesce(o.received_kg, 0) from own o)
  end as received_kg,
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
-- 10) Recebido do item = cobertura derivada do material.
-- -------------------------------------------------------------
create or replace function public.mp_item_received(p_order_item_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select f.received_kg
    from public.mp_item_mp_facts(p_order_item_id) f
$$;

revoke execute on function public.mp_item_received(uuid) from anon;
grant execute on function public.mp_item_received(uuid) to authenticated;

-- -------------------------------------------------------------
-- 11) Situação do MP de um item: NONE / PARCIAL / TOTAL.
-- -------------------------------------------------------------
create or replace function public.mp_item_state(p_order_item_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select f.state
    from public.mp_item_mp_facts(p_order_item_id) f
$$;

revoke execute on function public.mp_item_state(uuid) from anon;
grant execute on function public.mp_item_state(uuid) to authenticated;

-- -------------------------------------------------------------
-- 12) Peso PLANEJADO de um item no grão do material (soma do
--     que o item consome). Substitui o antigo mp_item_planned
--     (peso do item) para que plano e espelho falem a mesma
--     língua: peso do MATERIAL, não do item.
-- -------------------------------------------------------------
create or replace function public.mp_item_planned(p_order_item_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select f.planned_kg
    from public.mp_item_mp_facts(p_order_item_id) f
$$;

revoke execute on function public.mp_item_planned(uuid) from anon;
grant execute on function public.mp_item_planned(uuid) to authenticated;

-- -------------------------------------------------------------
-- 13) Data efetiva dos itens de uma OF: a data da NOTA DE
--     ENTRADA que cobriu o item. As notas de um material são
--     percorridas na ordem (data, id) e o acumulado do material
--     é comparado com o peso acumulado até o item — a nota que
--     fecha o item é a que "traz" a matéria-prima dele. Com
--     vários materiais, vale a data da última a fechar.
-- -------------------------------------------------------------
create or replace function public.mp_order_effective_dates(p_order_id uuid)
returns table (
  order_item_id uuid,
  entry_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  with plan as (
    select pl.*,
           sum(pl.need_kg) over (
             partition by pl.material_key order by pl.fill_seq
           ) as cum_need
      from public.mp_order_material_plan(p_order_id) pl
  ),
  notes as (
    select r.id as receipt_id,
           r.entry_date,
           rm.material_key,
           sum(rm.quantity_kg) over (
             partition by rm.material_key order by r.entry_date, r.id
           ) as cum_qty,
           row_number() over (
             partition by rm.material_key order by r.entry_date, r.id
           ) as note_rank
      from public.mp_receipts r
      join public.mp_receipt_materials rm on rm.mp_receipt_id = r.id
     where r.order_id = p_order_id
  ),
  covering as (
    select distinct on (p.order_item_id, p.material_key)
           p.order_item_id,
           p.material_key,
           n.entry_date
      from plan p
      join notes n
        on n.material_key = p.material_key
       and n.cum_qty >= p.cum_need
     order by p.order_item_id, p.material_key, n.note_rank
  )
  select c.order_item_id,
         max(c.entry_date) as entry_date
    from covering c
   group by c.order_item_id
$$;

revoke execute on function public.mp_order_effective_dates(uuid) from anon;
grant execute on function public.mp_order_effective_dates(uuid) to authenticated;

-- -------------------------------------------------------------
-- 14) Espelho do MP: situação, pesos e data efetiva.
--     A data efetiva (completed_at) é a data da NOTA DE ENTRADA
--     que cobriu o item — a data em que o material entrou, não a
--     data em que o clerk digitou. Fica gravada na primeira
--     cobertura completa (como na 056) e some se o item voltar a
--     ficar pendente.
-- -------------------------------------------------------------
drop function if exists public.mp_receipt_apply(uuid, numeric, numeric, text, uuid);

create or replace function public.mp_receipt_apply(
  p_order_item_id uuid,
  p_planned numeric,
  p_received numeric,
  p_state text,
  p_completed_at date,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_target        text;
  v_pp_id         uuid;
  v_old_status    text;
  v_old_completed numeric;
  v_at            timestamptz;
begin
  v_target := case when p_state = 'TOTAL' then 'CONCLUIDO' else 'NAO_INICIADO' end;
  v_at := coalesce(p_completed_at::timestamptz, now());

  select pp.id, pp.status, pp.quantity_completed
    into v_pp_id, v_old_status, v_old_completed
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
   where pp.order_item_id = p_order_item_id
     and pr.code = 'MP';

  if v_pp_id is null then
    insert into public.production_processes (
      order_item_id, process_id, status,
      quantity_planned, quantity_completed, started_at, completed_at
    )
    select p_order_item_id, pr.id, v_target,
           p_planned, p_received,
           case when v_target = 'CONCLUIDO' then v_at end,
           case when v_target = 'CONCLUIDO' then v_at end
      from public.processes pr
     where pr.code = 'MP'
    returning id into v_pp_id;

    if v_pp_id is not null and p_received > 0 then
      insert into public.production_events (
        production_process_id, user_id, event_type,
        old_status, new_status, old_quantity, new_quantity, notes
      )
      values (
        v_pp_id, p_user_id, 'STATUS_CHANGE',
        null, v_target, null, p_received,
        'Espelho do recebimento de MP (059)'
      );
    end if;
    return;
  end if;

  update public.production_processes
     set status = v_target,
         quantity_planned = p_planned,
         quantity_completed = p_received,
         completed_at = case
           when v_target = 'CONCLUIDO' then coalesce(completed_at, v_at)
           else null
         end
   where id = v_pp_id
     and (status is distinct from v_target
       or quantity_planned is distinct from p_planned
       or quantity_completed is distinct from p_received
       or (v_target = 'CONCLUIDO' and completed_at is null)
       or (v_target <> 'CONCLUIDO' and completed_at is not null));

  if found and (v_old_status is distinct from v_target
       or v_old_completed is distinct from p_received) then
    insert into public.production_events (
      production_process_id, user_id, event_type,
      old_status, new_status, old_quantity, new_quantity, notes
    )
    values (
      v_pp_id, p_user_id,
      case when v_old_status is distinct from v_target then 'STATUS_CHANGE' else 'DATA_CHANGE' end,
      v_old_status, v_target, v_old_completed, p_received,
      'Espelho do recebimento de MP (059)'
    );
  end if;
end;
$$;

revoke execute on function public.mp_receipt_apply(uuid, numeric, numeric, text, date, uuid) from anon;
grant execute on function public.mp_receipt_apply(uuid, numeric, numeric, text, date, uuid) to authenticated;

-- -------------------------------------------------------------
-- 15) Espelho da OF inteira: itens elegíveis e os pais (agregado
--     dos filhos, como na 057).
-- -------------------------------------------------------------
create or replace function public.mp_receipt_sync_order(p_order_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
begin
  drop table if exists _mp_sync_alloc;
  create temporary table _mp_sync_alloc on commit drop as
    select a.order_item_id,
           a.need_kg,
           a.allocated_kg,
           (select oi.parent_order_item_id
              from public.order_items oi where oi.id = a.order_item_id) as parent_id
      from public.mp_order_material_allocation(p_order_id) a;

  drop table if exists _mp_sync_dates;
  create temporary table _mp_sync_dates on commit drop as
    select * from public.mp_order_effective_dates(p_order_id);

  -- Itens elegíveis: o proprio espelho do material.
  for v_row in
    select c.order_item_id,
           sum(c.need_kg) as planned_kg,
           sum(c.allocated_kg) as received_kg,
           (select d.entry_date from _mp_sync_dates d where d.order_item_id = c.order_item_id) as effective_date
      from _mp_sync_alloc c
     group by c.order_item_id
  loop
    perform public.mp_receipt_apply(
      v_row.order_item_id,
      v_row.planned_kg,
      v_row.received_kg,
      case
        when v_row.received_kg <= 0 then 'NONE'
        when v_row.planned_kg is null or v_row.planned_kg <= 0 then 'TOTAL'
        when v_row.received_kg >= v_row.planned_kg then 'TOTAL'
        else 'PARCIAL'
      end,
      v_row.effective_date,
      p_user_id
    );
  end loop;

  -- Pais: agregado dos filhos (pior caso + soma dos kg), como na 057.
  for v_row in
    with children as (
      select c.order_item_id,
             c.parent_id,
             sum(c.need_kg) as planned_kg,
             sum(c.allocated_kg) as received_kg
        from _mp_sync_alloc c
       where c.parent_id is not null
       group by c.order_item_id, c.parent_id
    )
    select r.parent_id,
           r.planned_kg,
           r.received_kg,
           case
             when r.not_received = 0 and r.partial = 0 then 'TOTAL'
             when r.received_kg > 0 then 'PARCIAL'
             else 'NONE'
           end as state,
           (select max(d.entry_date)
              from children c2
              join _mp_sync_dates d on d.order_item_id = c2.order_item_id
             where c2.parent_id = r.parent_id) as effective_date
      from (
        select c.parent_id,
               sum(c.planned_kg) as planned_kg,
               sum(c.received_kg) as received_kg,
               count(*) filter (where c.received_kg <= 0) as not_received,
               count(*) filter (
                 where c.received_kg > 0 and c.received_kg < c.planned_kg
               ) as partial
          from children c
         group by c.parent_id
      ) r
  loop
    perform public.mp_receipt_apply(
      v_row.parent_id,
      v_row.planned_kg,
      v_row.received_kg,
      v_row.state,
      v_row.effective_date,
      p_user_id
    );
  end loop;
end;
$$;

revoke execute on function public.mp_receipt_sync_order(uuid, uuid) from anon;
grant execute on function public.mp_receipt_sync_order(uuid, uuid) to authenticated;

-- Compatibilidade: espelho de UM item (usado pela recuperacao 058).
create or replace function public.mp_receipt_sync_item(p_order_item_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_facts    record;
begin
  select oi.order_id into v_order_id
    from public.order_items oi where oi.id = p_order_item_id;
  if v_order_id is null then
    return;
  end if;

  select f.planned_kg, f.received_kg, f.state into v_facts
    from public.mp_item_mp_facts(p_order_item_id) f;

  perform public.mp_receipt_apply(
    p_order_item_id,
    v_facts.planned_kg,
    v_facts.received_kg,
    v_facts.state,
    (select max(d.entry_date)
       from public.mp_order_effective_dates(v_order_id) d
      where d.order_item_id = p_order_item_id),
    p_user_id
  );
end;
$$;

revoke execute on function public.mp_receipt_sync_item(uuid, uuid) from anon;
grant execute on function public.mp_receipt_sync_item(uuid, uuid) to authenticated;

create or replace function public.mp_receipt_sync_parent(p_parent_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_facts    record;
begin
  select oi.order_id into v_order_id
    from public.order_items oi where oi.id = p_parent_id;
  if v_order_id is null then
    return;
  end if;

  select f.planned_kg, f.received_kg, f.state into v_facts
    from public.mp_item_mp_facts(p_parent_id) f;

  perform public.mp_receipt_apply(
    p_parent_id,
    v_facts.planned_kg,
    v_facts.received_kg,
    v_facts.state,
    (select max(d.entry_date)
       from public.mp_order_effective_dates(v_order_id) d
       join public.mp_order_material_plan(v_order_id) pl
         on pl.order_item_id = d.order_item_id
      where pl.material_key in (
              select rm.material_key
                from public.mp_receipt_materials rm
                join public.mp_receipts r on r.id = rm.mp_receipt_id
               where r.order_id = v_order_id
            )),
    p_user_id
  );
end;
$$;

revoke execute on function public.mp_receipt_sync_parent(uuid, uuid) from anon;
grant execute on function public.mp_receipt_sync_parent(uuid, uuid) to authenticated;

-- -------------------------------------------------------------
-- 16) Gravar uma NOTA DE ENTRADA: nº, data, observação e o peso
--     recebido de cada MATERIAL.
--
--     O material precisa existir na OF (senão é recusado com
--     mensagem clara) e o peso precisa ser > 0.
-- -------------------------------------------------------------
create or replace function public.save_mp_receipt(
  p_order_id uuid,
  p_entry_number text,
  p_entry_date date,
  p_notes text,
  p_materials jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_order_status text;
  v_id           uuid;
  v_number       bigint;
  v_entry_number text;
  v_entry_date   date;
  v_line         jsonb;
  v_desc         text;
  v_unit         text;
  v_key          text;
  v_qty          numeric;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  if p_order_id is null then
    raise exception 'Pedido inválido.';
  end if;

  select o.status into v_order_status from public.orders o where o.id = p_order_id;
  if v_order_status is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_order_status = 'CANCELADO' then
    raise exception 'Não é possível registrar recebimento de uma OF cancelada.';
  end if;

  v_entry_number := nullif(trim(coalesce(p_entry_number, '')), '');
  if v_entry_number is null then
    raise exception 'Informe o número da nota de entrada.';
  end if;

  v_entry_date := coalesce(p_entry_date, current_date);

  if jsonb_typeof(coalesce(p_materials, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de materiais inválida';
  end if;
  if jsonb_array_length(p_materials) = 0 then
    raise exception 'Informe ao menos um material';
  end if;
  if jsonb_array_length(p_materials) > 500 then
    raise exception 'Máximo de 500 materiais por nota de entrada';
  end if;

  insert into public.mp_receipts (order_id, entry_number, entry_date, notes, created_by)
  values (
    p_order_id,
    v_entry_number,
    v_entry_date,
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user_id
  )
  returning id, number into v_id, v_number;

  for v_line in select value from jsonb_array_elements(p_materials)
  loop
    v_key := nullif(trim(coalesce(v_line ->> 'materialKey', '')), '');
    v_desc := nullif(trim(coalesce(v_line ->> 'description', '')), '');
    v_unit := nullif(trim(coalesce(v_line ->> 'unit', '')), '');
    if v_key is null or v_desc is null or v_unit is null then
      raise exception 'Material inválido na nota de entrada';
    end if;

    begin
      v_qty := (v_line ->> 'quantityKg')::numeric;
    exception when invalid_text_representation then
      raise exception 'Quantidade inválida no material %', v_desc;
    end;
    if coalesce(v_qty, 0) <= 0 then
      raise exception 'Quantidade inválida no material %', v_desc;
    end if;

    if not exists (
      select 1 from public.mp_order_material_plan(p_order_id) p
       where p.material_key = v_key
    ) then
      raise exception 'Matéria-prima % não pertence a esta OF', v_desc;
    end if;

    if exists (
      select 1 from public.mp_receipt_materials rm
       where rm.mp_receipt_id = v_id
         and rm.material_key = v_key
    ) then
      raise exception 'Material repetido na nota de entrada: %', v_desc;
    end if;

    insert into public.mp_receipt_materials (
      mp_receipt_id, material_key, material_description, material_unit, quantity_kg
    )
    values (v_id, v_key, v_desc, v_unit, v_qty);
  end loop;

  perform public.mp_receipt_sync_order(p_order_id, v_user_id);

  return jsonb_build_object(
    'id', v_id,
    'number', v_number,
    'entryNumber', v_entry_number,
    'entryDate', v_entry_date
  );
end;
$$;

revoke execute on function public.save_mp_receipt(uuid, text, date, text, jsonb) from anon;
grant execute on function public.save_mp_receipt(uuid, text, date, text, jsonb) to authenticated;

-- -------------------------------------------------------------
-- 17) Excluir uma nota de entrada: apaga (cascade nas linhas) e
--     recalcula o espelho da OF.
-- -------------------------------------------------------------
create or replace function public.delete_mp_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
  v_order_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  if p_receipt_id is null then
    raise exception 'Nota de entrada inválida.';
  end if;

  select r.order_id into v_order_id
    from public.mp_receipts r where r.id = p_receipt_id;
  if v_order_id is null then
    raise exception 'Nota de entrada não encontrada.';
  end if;

  delete from public.mp_receipts r where r.id = p_receipt_id;
  if not found then
    raise exception 'Sem permissão para excluir esta nota de entrada (ADMIN/GESTOR/OPERADOR_F1).';
  end if;

  perform public.mp_receipt_sync_order(v_order_id, v_user_id);

  return jsonb_build_object('id', p_receipt_id, 'orderId', v_order_id);
end;
$$;

revoke execute on function public.delete_mp_receipt(uuid) from anon;
grant execute on function public.delete_mp_receipt(uuid) to authenticated;

-- -------------------------------------------------------------
-- 18) Seletor em cascata: OFs com pendência de MP.
--     A pendência agora é por MATERIAL (a unidade da tela): uma OF
--     entra na lista enquanto algum material dela estiver com saldo.
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
            select count(*) filter (where mt.balance_kg > 0)::bigint as pending_materials,
                   coalesce(sum(greatest(mt.balance_kg, 0)), 0) as pending_kg
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
-- 19) RECUPERAÇÃO 058 (redefinida para o grão MATERIAL).
--
--     A 058 devolvia as marcas legadas como recibos POR ITEM. No
--     grão novo, a marca legada de um item significa "o material
--     deste item foi recebido": para o item fechar é preciso
--     material suficiente para COBRIR TAMBÉM os itens anteriores
--     dele na ordem de produção (preenchimento sequencial). Então a
--     recuperação vira: para cada material marcado, a quantidade é
--     o peso ACUMULADO até o ÚLTIMO item marcado na ordem — o que
--     fecha todos os marcados de uma vez.
--
--     As proteções da 058 continuam: alvo já coberto pelo fluxo
--     novo e alvo zerado pelo fluxo depois da marca ficam de fora.
-- -------------------------------------------------------------
create or replace function public.mp_receipt_recover_legacy(
  p_dry_run  boolean default false,
  p_scope    text    default 'todas',
  p_order_id uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report  jsonb;
  v_receipt uuid;
  r         record;
begin
  if auth.uid() is not null and not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Sem permissao para recuperar as marcacoes de MP.';
  end if;

  if p_scope not in ('todas', 'manual') then
    raise exception 'Escopo invalido: use todas ou manual.';
  end if;

  -- 1) Ultimo evento do MP que NAO e do espelho (o espelho e derivado
  --    do fluxo novo, nao uma marca).
  drop table if exists _mp_legacy_events;
  create temporary table _mp_legacy_events on commit drop as
  with ultimo as (
    select distinct on (e.production_process_id)
           e.production_process_id,
           e.new_status,
           e.new_quantity,
           e.created_at,
           e.user_id,
           e.notes
      from public.production_events e
      join public.production_processes pp on pp.id = e.production_process_id
      join public.processes pr on pr.id = pp.process_id
     where pr.code = 'MP'
       and coalesce(e.notes, '') not like 'Espelho do recebimento de MP%'
     order by e.production_process_id, e.created_at desc, e.ctid desc
  )
  select pp.order_item_id,
         pp.id as production_process_id,
         oi.order_id,
         oi.parent_order_item_id,
         u.new_status,
         u.new_quantity as legacy_kg,
         u.created_at  as marked_at,
         u.user_id,
         (coalesce(u.notes, '') like 'Conclu% automaticamente%') as cascata
    from ultimo u
    join public.production_processes pp on pp.id = u.production_process_id
    join public.order_items oi on oi.id = pp.order_item_id;

  -- 2) Marcas legadas: celula MP = CONCLUIDO, de OF nao cancelada.
  drop table if exists _mp_legacy_marks;
  create temporary table _mp_legacy_marks on commit drop as
  select e.*
    from _mp_legacy_events e
    join public.orders o on o.id = e.order_id
   where e.new_status = 'CONCLUIDO'
     and o.status <> 'CANCELADO'
     and (p_scope = 'todas' or not e.cascata)
     and (p_order_id is null or e.order_id = p_order_id);

  -- 3) Alvos: a marca do proprio item ou, se for um pai, os filhos.
  drop table if exists _mp_legacy_candidates;
  create temporary table _mp_legacy_candidates on commit drop as
  select m.order_item_id as target_id,
         m.order_id,
         m.parent_order_item_id,
         m.marked_at,
         m.user_id,
         m.cascata,
         'marcado'::text as origem
    from _mp_legacy_marks m
    join public.order_items oi on oi.id = m.order_item_id
   where not exists (
     select 1 from public.order_items c
      where c.parent_order_item_id = m.order_item_id
   )
  union all
  select c.id,
         m.order_id,
         m.parent_order_item_id,
         m.marked_at,
         m.user_id,
         m.cascata,
         'expandido'::text as origem
    from _mp_legacy_marks m
    join public.order_items c on c.parent_order_item_id = m.order_item_id;

  drop table if exists _mp_legacy_targets;
  create temporary table _mp_legacy_targets on commit drop as
  select distinct on (c.target_id)
         c.target_id,
         c.order_id,
         c.parent_order_item_id,
         c.marked_at,
         c.user_id,
         c.cascata,
         c.origem
    from _mp_legacy_candidates c
   order by c.target_id, (c.origem = 'marcado') desc, c.marked_at asc;

  -- 4) Alvos com as protecoes do fluxo novo.
  drop table if exists _mp_legacy_lines;
  create temporary table _mp_legacy_lines on commit drop as
  with espelho as (
    select distinct on (e.production_process_id)
           e.production_process_id,
           e.new_status,
           e.created_at
      from public.production_events e
      join public.production_processes pp on pp.id = e.production_process_id
      join public.processes pr on pr.id = pp.process_id
     where pr.code = 'MP'
       and coalesce(e.notes, '') like 'Espelho do recebimento de MP%'
     order by e.production_process_id, e.created_at desc, e.ctid desc
  )
  select t.*,
         (exists (select 1 from public.mp_receipt_materials rm
                   join public.mp_receipts r2 on r2.id = rm.mp_receipt_id
                  where r2.order_id = t.order_id
                    and rm.material_key in (
                      select a.material_key
                        from public.mp_order_material_plan(t.order_id) a
                       where a.order_item_id = t.target_id
                    )
                )) as tem_recibo_novo,
         (exists (
            select 1
              from public.production_processes pp
              join espelho x on x.production_process_id = pp.id
             where pp.order_item_id = t.target_id
               and x.new_status = 'NAO_INICIADO'
               and x.created_at >= t.marked_at
          )) as falado_depois
    from _mp_legacy_targets t;

  -- 5) Material a recuperar: para cada material, o peso ACUMULADO
  --    ate o ULTIMO item marcado na ordem de producao (o que fecha
  --    todos os marcados de uma vez) menos o que ja foi recebido.
  drop table if exists _mp_legacy_materials;
  create temporary table _mp_legacy_materials on commit drop as
  with targets as (
    select * from _mp_legacy_lines l
     where not l.tem_recibo_novo and not l.falado_depois
  ),
  orders as (
    select distinct t.order_id from targets t
  ),
  plan as (
    select o.order_id, pl.*
      from orders o
      cross join lateral public.mp_order_material_plan(o.order_id) pl
  ),
  cumulative as (
    select p.*,
           sum(p.need_kg) over (
             partition by p.order_id, p.material_key order by p.fill_seq
           ) as cum_need
      from plan p
  ),
  marked as (
    select c.order_id,
           c.material_key,
           c.description,
           c.unit,
           c.cum_need,
           c.fill_seq
      from cumulative c
      join targets t
        on t.order_id = c.order_id and t.target_id = c.order_item_id
  ),
  required as (
    select m.order_id,
           m.material_key,
           (array_agg(m.description order by m.fill_seq))[1] as description,
           (array_agg(m.unit order by m.fill_seq))[1] as unit,
           max(m.cum_need) as required_kg
      from marked m
     group by m.order_id, m.material_key
  ),
  already as (
    -- O alias é `rc` (e não `r`): nesta função `r` é a variável de
    -- registro do PL/pgSQL e o interpretador tentaria usá-la como
    -- coluna ("record r is not assigned yet").
    select rc.order_id,
           rm.material_key,
           sum(rm.quantity_kg) as received_kg
      from public.mp_receipt_materials rm
      join public.mp_receipts rc on rc.id = rm.mp_receipt_id
     group by 1, 2
  ),
  dated as (
    select rq.*,
           min((l.marked_at at time zone 'UTC')::date) as receipt_date
      from required rq
      join _mp_legacy_lines l
        on l.order_id = rq.order_id
       and exists (
         select 1
           from public.mp_order_material_plan(l.order_id) pl
          where pl.material_key = rq.material_key
            and pl.order_item_id = l.target_id
       )
     group by rq.order_id, rq.material_key, rq.description, rq.unit, rq.required_kg
  ),
  -- Quem assinou a marca legada da OF (o primeiro por data). `min()`
  -- não serve para uuid — daí o array_agg.
  autor as (
    select l.order_id,
           (array_agg(l.user_id order by l.marked_at, l.user_id))[1] as user_id
      from _mp_legacy_lines l
     group by l.order_id
  )
  select d.order_id,
         d.material_key,
         d.description,
         d.unit,
         d.required_kg,
         d.receipt_date,
         au.user_id,
         d.required_kg - coalesce(al.received_kg, 0) as delta_kg
    from dated d
    left join already al
      on al.order_id = d.order_id and al.material_key = d.material_key
    left join autor au
      on au.order_id = d.order_id
   where d.required_kg - coalesce(al.received_kg, 0) > 0;

  -- 6) Itens e OFs afetados (backup, espelho e re-derivacao).
  drop table if exists _mp_legacy_affected;
  create temporary table _mp_legacy_affected on commit drop as
  select distinct l.target_id as item_id, l.order_id
    from _mp_legacy_lines l
   where not l.tem_recibo_novo and not l.falado_depois
  union
  select distinct m.order_item_id as item_id, m.order_id
    from _mp_legacy_marks m
  union
  select distinct c.parent_order_item_id as item_id, c.order_id
    from _mp_legacy_lines l
    join public.order_items c on c.id = l.target_id
   where l.parent_order_item_id is not null
     and not l.tem_recibo_novo and not l.falado_depois;

  if p_dry_run then
    select jsonb_build_object(
      'modo', 'dry-run',
      'escopo', p_scope,
      'of_filtro', p_order_id,
      'marcas', jsonb_build_object(
        'itens', (select count(*) from _mp_legacy_marks),
        'manual', (select count(*) from _mp_legacy_marks where not cascata),
        'cascata', (select count(*) from _mp_legacy_marks where cascata)
      ),
      'materiais', jsonb_build_object(
        'a_lancar', (select count(*) from _mp_legacy_materials),
        'kg', (select coalesce(sum(delta_kg), 0) from _mp_legacy_materials)
      ),
      'linhas', jsonb_build_object(
        'alvos', (select count(*) from _mp_legacy_lines),
        'expandidas', (select count(*) from _mp_legacy_lines where origem = 'expandido'),
        'com_recibo_novo', (select count(*) from _mp_legacy_lines where tem_recibo_novo),
        'falado_depois', (select count(*) from _mp_legacy_lines where falado_depois),
        'a_lancar', (select count(*) from _mp_legacy_materials),
        'kg', (select coalesce(sum(delta_kg), 0) from _mp_legacy_materials)
      ),
      'por_of', (
        select coalesce(jsonb_agg(item order by item->>'of'), '[]'::jsonb)
          from (
            select jsonb_build_object(
                     'of', o.code,
                     'cliente', o.customer_name,
                     'marcas', (select count(*) from _mp_legacy_marks m where m.order_id = o.id),
                     'materiais', (select count(*) from _mp_legacy_materials lm where lm.order_id = o.id),
                     'kg', (select coalesce(sum(lm.delta_kg), 0) from _mp_legacy_materials lm where lm.order_id = o.id),
                     'datas', (select coalesce(jsonb_agg(distinct to_char(lm.receipt_date, 'YYYY-MM-DD')), '[]'::jsonb)
                                 from _mp_legacy_materials lm where lm.order_id = o.id)
                   ) as item
              from public.orders o
             where o.id in (select order_id from _mp_legacy_materials)
          ) s
      )
    ) into v_report;
    return v_report;
  end if;

  -- 7) Backup das celulas MP que podem mudar (uma vez so).
  insert into public.mp_recovery_backup_058 (
    production_process_id, order_item_id, status,
    quantity_planned, quantity_completed, started_at, completed_at
  )
  select pp.id, pp.order_item_id, pp.status,
         pp.quantity_planned, pp.quantity_completed, pp.started_at, pp.completed_at
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
   where pr.code = 'MP'
     and pp.order_item_id in (select item_id from _mp_legacy_affected)
  on conflict (production_process_id) do nothing;

  -- 8) Uma NOTA DE ENTRADA por (OF, data) com os materiais a
  --    recuperar. O nº é "REC-058" (nota gerada pela recuperação).
  for r in
    select lm.order_id,
           lm.receipt_date,
           (array_agg(lm.user_id order by lm.user_id))[1] as user_id,
           jsonb_agg(
             jsonb_build_object(
               'materialKey', lm.material_key,
               'description', lm.description,
               'unit', lm.unit,
               'quantityKg', lm.delta_kg
             )
             order by lm.description
           ) as materiais
      from _mp_legacy_materials lm
     group by lm.order_id, lm.receipt_date
     order by lm.order_id, lm.receipt_date
  loop
    insert into public.mp_receipts (order_id, entry_number, entry_date, notes, created_by)
    values (
      r.order_id,
      'REC-058',
      r.receipt_date,
      'Recuperacao 058 - marcacao de MP do historico (legado)',
      coalesce(auth.uid(), r.user_id)
    )
    returning id into v_receipt;

    insert into public.mp_recovery_receipts_058 (receipt_id, order_id, receipt_date)
    values (v_receipt, r.order_id, r.receipt_date);

    insert into public.mp_receipt_materials (
      mp_receipt_id, material_key, material_description, material_unit, quantity_kg
    )
    select v_receipt,
           m ->> 'materialKey',
           m ->> 'description',
           m ->> 'unit',
           (m ->> 'quantityKg')::numeric
      from jsonb_array_elements(r.materiais) m;
  end loop;

  -- 9) Espelho das OFs afetadas (itens + pais).
  for r in
    select distinct a.order_id
      from _mp_legacy_affected a
     order by a.order_id
  loop
    perform public.mp_receipt_sync_order(
      r.order_id,
      coalesce(
        auth.uid(),
        (
          select (array_agg(rc.created_by order by rc.created_by))[1]
            from public.mp_receipts rc
           where rc.order_id = r.order_id
        )
      )
    );
  end loop;

  -- 10) Re-deriva o status de item e de OF (mesma regra do app).
  update public.order_items oi
     set status = d.derived
    from (
      select t.item_id,
             case
               when not exists (
                      select 1 from public.production_processes pp
                       where pp.order_item_id = t.item_id
                         and pp.status <> 'NAO_APLICAVEL')
                 then 'CONCLUIDO'
               when not exists (
                      select 1 from public.production_processes pp
                       where pp.order_item_id = t.item_id
                         and pp.status <> 'NAO_APLICAVEL'
                         and pp.status <> 'CONCLUIDO')
                 then 'CONCLUIDO'
               when oi.op is null or btrim(oi.op) = '' then 'PLANEJADO'
               else 'EM_PRODUCAO'
             end as derived
        from (select distinct item_id from _mp_legacy_affected) t
        join public.order_items oi on oi.id = t.item_id
    ) d
   where oi.id = d.item_id
     and oi.status <> 'CANCELADO'
     and oi.status is distinct from d.derived;

  update public.orders o
     set status = d.derived
    from (
      select t.order_id,
             case
               when count(*) = 0 then 'PLANEJADO'
               when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
               when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
               else 'PLANEJADO'
             end as derived
        from (select distinct order_id from _mp_legacy_affected) t
        join public.order_items oi on oi.order_id = t.order_id
       group by t.order_id
    ) d
   where o.id = d.order_id
     and o.status <> 'CANCELADO'
     and o.status is distinct from d.derived;

  select jsonb_build_object(
    'modo', 'aplicado',
    'escopo', p_scope,
    'of_filtro', p_order_id,
    'marcas', jsonb_build_object(
      'itens', (select count(*) from _mp_legacy_marks),
      'manual', (select count(*) from _mp_legacy_marks where not cascata),
      'cascata', (select count(*) from _mp_legacy_marks where cascata)
    ),
    'materiais', jsonb_build_object(
      'a_lancar', (select count(*) from _mp_legacy_materials),
      'kg', (select coalesce(sum(delta_kg), 0) from _mp_legacy_materials)
    ),
    'linhas', jsonb_build_object(
      'alvos', (select count(*) from _mp_legacy_lines),
      'expandidas', (select count(*) from _mp_legacy_lines where origem = 'expandido'),
      'com_recibo_novo', (select count(*) from _mp_legacy_lines where tem_recibo_novo),
      'falado_depois', (select count(*) from _mp_legacy_lines where falado_depois),
      'a_lancar', (select count(*) from _mp_legacy_materials),
      'kg', (select coalesce(sum(delta_kg), 0) from _mp_legacy_materials)
    ),
    'notas', jsonb_build_object(
      'criadas', (select count(*) from public.mp_recovery_receipts_058),
      'itens', (select count(*) from public.mp_receipt_materials rm
                  where rm.mp_receipt_id in (select receipt_id from public.mp_recovery_receipts_058))
    ),
    'celulas', jsonb_build_object(
      'mp_concluidas', (select count(*) from public.production_processes pp
                          join public.processes pr on pr.id = pp.process_id
                         where pr.code = 'MP' and pp.status = 'CONCLUIDO')
    )
  ) into v_report;

  return v_report;
end;
$$;

revoke execute on function public.mp_receipt_recover_legacy(boolean, text, uuid) from public;
revoke execute on function public.mp_receipt_recover_legacy(boolean, text, uuid) from anon;
grant execute on function public.mp_receipt_recover_legacy(boolean, text, uuid) to authenticated;
grant execute on function public.mp_receipt_recover_legacy(boolean, text, uuid) to service_role;

-- -------------------------------------------------------------
-- 20) Rollback da recuperacao: apaga as notas criadas pela
--     recuperacao e restaura as celulas do backup.
-- -------------------------------------------------------------
create or replace function public.mp_receipt_rollback_legacy()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report  jsonb;
  v_recibos int;
  v_celulas int;
begin
  if auth.uid() is not null and not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Sem permissao para desfazer a recuperacao de MP.';
  end if;

  drop table if exists _mp_rollback_items;
  create temporary table _mp_rollback_items on commit drop as
  select distinct r.order_id, rm.material_key
    from public.mp_recovery_receipts_058 rec
    join public.mp_receipts r on r.id = rec.receipt_id
    join public.mp_receipt_materials rm on rm.mp_receipt_id = r.id;

  select count(*) into v_recibos from public.mp_recovery_receipts_058;
  select count(*) into v_celulas from public.mp_recovery_backup_058;

  delete from public.mp_receipts r
   using public.mp_recovery_receipts_058 rec
   where r.id = rec.receipt_id;

  update public.production_processes pp
     set status = b.status,
         quantity_planned = b.quantity_planned,
         quantity_completed = b.quantity_completed,
         started_at = b.started_at,
         completed_at = b.completed_at
    from public.mp_recovery_backup_058 b
   where b.production_process_id = pp.id;

  update public.order_items oi
     set status = d.derived
    from (
      select t.item_id,
             case
               when not exists (
                      select 1 from public.production_processes pp
                       where pp.order_item_id = t.item_id
                         and pp.status <> 'NAO_APLICAVEL')
                 then 'CONCLUIDO'
               when not exists (
                      select 1 from public.production_processes pp
                       where pp.order_item_id = t.item_id
                         and pp.status <> 'NAO_APLICAVEL'
                         and pp.status <> 'CONCLUIDO')
                 then 'CONCLUIDO'
               when oi.op is null or btrim(oi.op) = '' then 'PLANEJADO'
               else 'EM_PRODUCAO'
             end as derived
        from (
          select distinct pl.order_item_id as item_id
            from _mp_rollback_items rb
            join public.mp_order_material_plan(rb.order_id) pl
              on pl.material_key = rb.material_key
        ) t
        join public.order_items oi on oi.id = t.item_id
    ) d
   where oi.id = d.item_id
     and oi.status <> 'CANCELADO'
     and oi.status is distinct from d.derived;

  update public.orders o
     set status = d.derived
    from (
      select t.order_id,
             case
               when count(*) = 0 then 'PLANEJADO'
               when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
               when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
               else 'PLANEJADO'
             end as derived
        from (select distinct order_id from _mp_rollback_items) t
        join public.order_items oi on oi.order_id = t.order_id
       group by t.order_id
    ) d
   where o.id = d.order_id
     and o.status <> 'CANCELADO'
     and o.status is distinct from d.derived;

  delete from public.mp_recovery_receipts_058;
  delete from public.mp_recovery_backup_058;

  select jsonb_build_object(
    'modo', 'rollback',
    'notas_apagadas', v_recibos,
    'celulas_restauradas', v_celulas
  ) into v_report;

  return v_report;
end;
$$;

revoke execute on function public.mp_receipt_rollback_legacy() from public;
revoke execute on function public.mp_receipt_rollback_legacy() from anon;
grant execute on function public.mp_receipt_rollback_legacy() to authenticated;
grant execute on function public.mp_receipt_rollback_legacy() to service_role;
