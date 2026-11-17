-- =============================================================
-- 077) O sequenciamento por processo passa a definir a fila global
-- =============================================================
-- O processo selecionado filtra as OFs elegíveis e fornece a capacidade
-- usada no cálculo, mas a prioridade salva é global. order_items.seq é a
-- prioridade já consumida pelas telas de produção e gestão de OF.
--
-- Ao salvar uma visão filtrada:
--   1. as OFs enviadas ocupam o início da fila, na ordem enviada;
--   2. OFs ativas que ficaram fora da visão e já tinham sequência vão
--      para o fim, preservando a ordem anterior;
--   3. OFs sem sequência e fora da visão continuam sem sequência.
-- OFs concluídas/canceladas preservam a sequência histórica; a fila ativa
-- começa após a maior sequência mantida fora dela.
--
-- A fila por processo em order_process_schedules deixa de ser fonte de
-- ordem; a tabela continua guardando observações por OF/processo.
-- =============================================================

create or replace function public.get_process_scheduling(
  p_process_id uuid,
  p_family_group_id bigint default null
)
returns table (
  order_id uuid,
  order_code text,
  order_type text,
  customer_name text,
  delivery_date date,
  order_status text,
  product_group_id bigint,
  family_description text,
  family_abbreviation text,
  group_type text,
  quantity numeric,
  weight_kg numeric,
  capacity_kg numeric,
  "position" integer,
  notes text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.id,
    o.code,
    o.type,
    o.customer_name,
    o.delivery_date,
    o.status,
    o.product_group_id,
    pg.family_description,
    pg.family_abbreviation,
    case
      when pg.id is null then null
      else pg.id::text || '-' || pg.family_abbreviation
    end,
    coalesce(items.quantity, 0)::numeric,
    items.weight_kg,
    cap.capacity,
    global_sequence.position,
    s.notes
  from public.orders o
  left join public.product_groups pg on pg.id = o.product_group_id
  left join lateral (
    select
      sum(oi.quantity) as quantity,
      sum(oi.total_weight_kg) as weight_kg
    from public.order_items oi
    where oi.order_id = o.id
      and oi.parent_order_item_id is null
  ) items on true
  left join lateral (
    select min(oi.seq)::integer as position
      from public.order_items oi
     where oi.order_id = o.id
  ) global_sequence on true
  left join public.product_group_process_capacities cap
    on cap.product_group_id = o.product_group_id
   and cap.process_id = p_process_id
   and cap.unit = 'KG'
  left join public.order_process_schedules s
    on s.order_id = o.id
   and s.process_id = p_process_id
  where o.status in ('PLANEJADO', 'EM_PRODUCAO')
    and items.quantity is not null
    and (p_family_group_id is null or o.product_group_id = p_family_group_id)
    and (
      p_process_id is null
      or exists (
        select 1
          from public.order_items oi
          join public.production_processes pp on pp.order_item_id = oi.id
         where oi.order_id = o.id
           and pp.process_id = p_process_id
           and pp.status = 'NAO_INICIADO'
      )
    )
  order by global_sequence.position nulls last, o.delivery_date nulls last, o.code;
$$;

revoke execute on function public.get_process_scheduling(uuid, bigint) from public, anon;
grant execute on function public.get_process_scheduling(uuid, bigint) to authenticated;

create or replace function public.save_process_schedule(
  p_process_id uuid,
  p_anchor_date date,
  p_rows jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_omitted_order_ids uuid[];
  v_order_id uuid;
  v_idx integer := 0;
  v_sequence_base integer := 0;
  v_row record;
begin
  if not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Você não tem permissão para salvar o sequenciamento.';
  end if;

  if p_process_id is not null
     and not exists (select 1 from public.processes p where p.id = p_process_id) then
    raise exception 'Processo não encontrado.';
  end if;

  if p_process_id is not null and p_anchor_date is null then
    raise exception 'Informe a data de início do sequenciamento.';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Sequência inválida.';
  end if;

  if exists (
    select r.order_id
      from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
     group by r.order_id
    having count(*) > 1
  ) then
    raise exception 'A mesma OF não pode aparecer duas vezes na sequência.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
     where not exists (
       select 1
          from public.orders o
         where o.id = r.order_id
           and o.status in ('PLANEJADO', 'EM_PRODUCAO')
           and exists (
             select 1
               from public.order_items oi
              where oi.order_id = o.id
                and oi.parent_order_item_id is null
           )
           and (
             p_process_id is null
             or exists (
               select 1
                 from public.order_items oi
                 join public.production_processes pp on pp.order_item_id = oi.id
                where oi.order_id = o.id
                  and pp.process_id = p_process_id
                  and pp.status = 'NAO_INICIADO'
             )
           )
     )
  ) then
    raise exception 'Uma ou mais OFs não estão ativas para o planejamento selecionado.';
  end if;

  -- Registra as OFs já sequenciadas que não estão nesta visão. A ordem
  -- anterior é capturada antes de limpar/regravar a sequência global.
  select coalesce(
           array_agg(q.order_id order by q.old_position, q.delivery_date nulls last, q.code),
           '{}'
         )
    into v_omitted_order_ids
    from (
      select o.id as order_id,
             min(oi.seq) as old_position,
             o.delivery_date,
             o.code
        from public.orders o
        join public.order_items oi on oi.order_id = o.id
       where o.status in ('PLANEJADO', 'EM_PRODUCAO')
         and oi.seq is not null
         and not exists (
           select 1
             from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
            where r.order_id = o.id
         )
       group by o.id, o.delivery_date, o.code
    ) q;

  select coalesce(max(oi.seq), 0)
    into v_sequence_base
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
   where o.status not in ('PLANEJADO', 'EM_PRODUCAO')
     and oi.seq is not null;

  if p_process_id is not null then
    insert into public.process_schedule_settings (process_id, anchor_date)
    values (p_process_id, p_anchor_date)
    on conflict (process_id) do update
      set anchor_date = excluded.anchor_date;
  end if;

  -- A constraint 038 garante seq exclusivo entre OFs. Limpa apenas a fila
  -- ativa; sequências de OFs fechadas são preservadas como histórico.
  update public.order_items oi
     set seq = null
    from public.orders o
   where o.id = oi.order_id
     and o.status in ('PLANEJADO', 'EM_PRODUCAO')
     and oi.seq is not null;

  v_idx := v_sequence_base;
  for v_row in
    select r.order_id, r.notes
      from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
     order by r.position
  loop
    v_idx := v_idx + 1;

    update public.order_items
       set seq = v_idx
     where order_id = v_row.order_id;

    if p_process_id is not null then
      insert into public.order_process_schedules (order_id, process_id, position, notes)
      values (v_row.order_id, p_process_id, v_idx, nullif(btrim(v_row.notes), ''))
      on conflict (order_id, process_id) do update
        set position = excluded.position,
            notes = excluded.notes;
    end if;
  end loop;

  -- OFs planejadas omitidas pela visão/filtro entram após as escolhidas.
  foreach v_order_id in array coalesce(v_omitted_order_ids, '{}')
  loop
    v_idx := v_idx + 1;
    update public.order_items
       set seq = v_idx
     where order_id = v_order_id;
  end loop;
end;
$$;

revoke execute on function public.save_process_schedule(uuid, date, jsonb) from public, anon;
grant execute on function public.save_process_schedule(uuid, date, jsonb) to authenticated;
