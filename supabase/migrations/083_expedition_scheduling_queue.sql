-- =============================================================
-- 083) Expedição concluída sai da fila do sequenciamento
-- =============================================================
-- Regra:
--   1. uma OF com a EXPEDIÇÃO (EXP) concluída em TODOS os itens RAIZ
--      aplicáveis não aparece mais em get_process_scheduling;
--   2. ela aparece na Gestão de OF DEPOIS das OFs ainda planejadas;
--   3. ao concluir a expedição, as OFs ativas seguintes assumem as
--      posições seguintes (a fila é compactada) e a OF expedida vai
--      para o fim.
--
-- A prioridade global continua sendo order_items.seq (036/077). O
-- reposicionamento é gravado no banco porque a Gestão de OF, a Fábrica
-- 1 e a Fábrica 2 já ordenam por esse campo.
--
-- A conclusão é detectada no banco (trigger em production_processes),
-- cobrindo edição unitária, edição em lote, cascata e importação. A
-- limpeza prévia dos seq evita a colisão com a unicidade por OF (038).
-- =============================================================

-- -------------------------------------------------------------
-- order_exp_concluded — a OF já teve TODA a expedição aplicável
-- concluída?
--
-- Só itens RAIZ entram (o EXP mora no pai — mesma regra do romaneio,
-- 045). Itens NAO_APLICAVEL ficam de fora do denominador; sem nenhum
-- item aplicável a OF NÃO é considerada expedida.
-- -------------------------------------------------------------
create or replace function public.order_exp_concluded(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_order_id is not null
    and exists (
      select 1
        from public.order_items oi
        join public.production_processes pp on pp.order_item_id = oi.id
        join public.processes pr on pr.id = pp.process_id
       where oi.order_id = p_order_id
         and oi.parent_order_item_id is null
         and pr.code = 'EXP'
         and pp.status <> 'NAO_APLICAVEL'
    )
    and not exists (
      select 1
        from public.order_items oi
        join public.production_processes pp on pp.order_item_id = oi.id
        join public.processes pr on pr.id = pp.process_id
       where oi.order_id = p_order_id
         and oi.parent_order_item_id is null
         and pr.code = 'EXP'
         and pp.status <> 'NAO_APLICAVEL'
         and pp.status <> 'CONCLUIDO'
    );
$$;

revoke execute on function public.order_exp_concluded(uuid) from public, anon;
grant execute on function public.order_exp_concluded(uuid) to authenticated;

-- -------------------------------------------------------------
-- get_process_scheduling — linha da 078 + exclusão da OF expedida.
--
-- A exclusão vale para qualquer visão (com/sem processo e família):
-- uma OF com a expedição concluída não é mais fila de produção.
-- -------------------------------------------------------------
drop function if exists public.get_process_scheduling(uuid, bigint);

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
  notes text,
  process_status text,
  mp_state text
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
    s.notes,
    process_state.process_status,
    mp.mp_state
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
  left join lateral (
    -- Situação do processo selecionado: pior caso entre os itens
    -- aplicáveis (NAO_APLICAVEL fica de fora).
    select
      case
        when p_process_id is null then null
        when count(*) = 0 then null
        when bool_and(pp.status = 'CONCLUIDO') then 'CONCLUIDO'
        else 'NAO_INICIADO'
      end as process_status
    from public.order_items oi
    join public.production_processes pp on pp.order_item_id = oi.id
    where oi.order_id = o.id
      and pp.process_id = p_process_id
      and pp.status <> 'NAO_APLICAVEL'
  ) process_state on true
  left join lateral (
    -- Espelho do recebimento de MP da OF: verde só quando todos os
    -- itens estão concluídos; amarelo quando algum recebeu; padrão
    -- quando nenhum recebeu. Itens sem MP aplicável não entram.
    select
      case
        when count(*) = 0 then null
        when bool_and(pp.status = 'CONCLUIDO') then 'TOTAL'
        when bool_or(
          pp.status = 'CONCLUIDO'
          or coalesce(pp.quantity_completed, 0) > 0
        ) then 'PARCIAL'
        else 'NONE'
      end as mp_state
    from public.order_items oi
    join public.production_processes pp on pp.order_item_id = oi.id
    join public.processes pr on pr.id = pp.process_id
    where oi.order_id = o.id
      and pr.code = 'MP'
      and pp.status <> 'NAO_APLICAVEL'
  ) mp on true
  where o.status in ('PLANEJADO', 'EM_PRODUCAO')
    and items.quantity is not null
    and not public.order_exp_concluded(o.id)
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

-- -------------------------------------------------------------
-- resequence_expedition_queue — compacta a fila ativa e joga as OFs
-- expedidas para o fim.
--
-- A "base" preserva a sequência das OFs inativas que NÃO foram
-- expedidas (histórico). A partir dela, as ativas são renumeradas na
-- ordem atual e, em seguida, as expedidas. Todos os seq das OFs que
-- serão renumeradas são limpos antes das gravações para respeitar a
-- unicidade de sequência por OF (038).
--
-- Se não houver OF ativa, as expedidas apenas são renumeradas depois
-- da base, mantendo a ordem relativa anterior.
-- -------------------------------------------------------------
create or replace function public.resequence_expedition_queue()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base integer := 0;
  v_idx integer := 0;
  v_active_ids uuid[] := '{}';
  v_shipped_ids uuid[] := '{}';
  v_order_id uuid;
begin
  -- Base: maior seq das OFs que NÃO entram nesta renumeração.
  select coalesce(max(oi.seq), 0)
    into v_base
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.seq is not null
     and o.status not in ('PLANEJADO', 'EM_PRODUCAO')
     and not public.order_exp_concluded(o.id);

  -- Fila ativa restante, na ordem atual: menor seq da OF, entrega e código.
  select coalesce(
           array_agg(q.order_id order by q.old_position nulls last, q.delivery_date nulls last, q.code),
           '{}'
         )
    into v_active_ids
    from (
      select
        o.id as order_id,
        min(oi.seq) as old_position,
        o.delivery_date,
        o.code
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.status in ('PLANEJADO', 'EM_PRODUCAO')
        and not public.order_exp_concluded(o.id)
        and exists (
          select 1
            from public.order_items root
           where root.order_id = o.id
             and root.parent_order_item_id is null
        )
      group by o.id, o.delivery_date, o.code
    ) q;

  -- OFs com a expedição concluída (qualquer status) vão para o fim.
  select coalesce(
           array_agg(q.order_id order by q.old_position nulls last, q.delivery_date nulls last, q.code),
           '{}'
         )
    into v_shipped_ids
    from (
      select
        o.id as order_id,
        min(oi.seq) as old_position,
        o.delivery_date,
        o.code
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where public.order_exp_concluded(o.id)
      group by o.id, o.delivery_date, o.code
    ) q;

  -- Limpa somente as OFs que serão renumeradas; as demais preservam o seq.
  update public.order_items oi
     set seq = null
   where oi.seq is not null
     and oi.order_id = any (v_active_ids || v_shipped_ids);

  -- Ativas primeiro, na ordem anterior.
  foreach v_order_id in array v_active_ids
  loop
    v_idx := v_idx + 1;
    update public.order_items
       set seq = v_base + v_idx
     where order_id = v_order_id;
  end loop;

  -- Expedidas depois de todas as ativas.
  foreach v_order_id in array v_shipped_ids
  loop
    v_idx := v_idx + 1;
    update public.order_items
       set seq = v_base + v_idx
     where order_id = v_order_id;
  end loop;
end;
$$;

revoke execute on function public.resequence_expedition_queue() from public, anon, authenticated;

-- -------------------------------------------------------------
-- Trigger: quando o status de um processo EXP vira CONCLUIDO, verifica
-- se a OF fechou a expedição e, se fechou, reordena a fila.
--
-- AFTER + SECURITY DEFINER: a atualização de production_processes pode
-- vir de OPERADOR_F2/GESTOR, mas order_items.seq é escrita pela função
-- (mesma estratégia de refresh_order_statuses, 055).
-- -------------------------------------------------------------
create or replace function public.production_process_expedition_resequence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if not exists (
    select 1
      from public.processes p
     where p.id = new.process_id
       and p.code = 'EXP'
  ) then
    return new;
  end if;

  select oi.order_id
    into v_order_id
    from public.order_items oi
   where oi.id = new.order_item_id;

  if v_order_id is not null and public.order_exp_concluded(v_order_id) then
    perform public.resequence_expedition_queue();
  end if;

  return new;
end;
$$;

revoke execute on function public.production_process_expedition_resequence() from public, anon, authenticated;

drop trigger if exists production_processes_resequence_expedition on public.production_processes;
create trigger production_processes_resequence_expedition
  after update of status on public.production_processes
  for each row
  when (old.status is distinct from new.status and new.status = 'CONCLUIDO')
  execute function public.production_process_expedition_resequence();

-- -------------------------------------------------------------
-- save_process_schedule — linha da 077 com a regra da expedição.
--
-- Mudanças:
--   * OF expedida não é aceita no payload (não está mais ativa);
--   * OF expedida não entra no bloco de ativas omitidas;
--   * a base da sequência ignora as expedidas;
--   * as expedidas são regravadas no fim, depois das ativas.
-- -------------------------------------------------------------
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
  v_shipped_order_ids uuid[];
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
           and not public.order_exp_concluded(o.id)
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

  -- OFs ativas já sequenciadas que não estão nesta visão. A ordem
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
         and not public.order_exp_concluded(o.id)
         and not exists (
           select 1
             from jsonb_to_recordset(p_rows) as r(order_id uuid, position integer, notes text)
            where r.order_id = o.id
         )
       group by o.id, o.delivery_date, o.code
    ) q;

  -- OFs expedidas: sempre no fim, mantendo a ordem anterior.
  select coalesce(
           array_agg(q.order_id order by q.old_position nulls last, q.delivery_date nulls last, q.code),
           '{}'
         )
    into v_shipped_order_ids
    from (
      select o.id as order_id,
             min(oi.seq) as old_position,
             o.delivery_date,
             o.code
        from public.orders o
        join public.order_items oi on oi.order_id = o.id
       where public.order_exp_concluded(o.id)
       group by o.id, o.delivery_date, o.code
    ) q;

  -- Base apenas das OFs inativas que não foram expedidas (histórico).
  select coalesce(max(oi.seq), 0)
    into v_sequence_base
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
   where oi.seq is not null
     and o.status not in ('PLANEJADO', 'EM_PRODUCAO')
     and not public.order_exp_concluded(o.id);

  if p_process_id is not null then
    insert into public.process_schedule_settings (process_id, anchor_date)
    values (p_process_id, p_anchor_date)
    on conflict (process_id) do update
      set anchor_date = excluded.anchor_date;
  end if;

  -- A constraint 038 garante seq exclusivo entre OFs. Limpa a fila
  -- ativa e as expedidas; sequências históricas das demais são preservadas.
  update public.order_items oi
     set seq = null
    from public.orders o
   where o.id = oi.order_id
     and oi.seq is not null
     and (
       o.status in ('PLANEJADO', 'EM_PRODUCAO')
       or public.order_exp_concluded(o.id)
     );

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

  -- Expedidas sempre depois de todas as ativas.
  foreach v_order_id in array coalesce(v_shipped_order_ids, '{}')
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

-- Backfill: corrige o estado que já existe no banco.
select public.resequence_expedition_queue();
