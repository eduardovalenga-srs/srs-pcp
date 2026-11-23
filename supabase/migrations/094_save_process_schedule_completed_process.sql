-- 094) Alinha a validação de gravação à fila da 087: processos concluídos
-- continuam visíveis com peso zero e devem ser aceitos no payload do save.
--
-- Preserva a regra da 084: OFs expedidas ficam sem seq e não são reanexadas
-- ao final da fila.

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
                  and pp.status in ('NAO_INICIADO', 'CONCLUIDO')
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

  -- OFs com EXP concluído permanecem sem número de sequência.
end;
$$;

revoke execute on function public.save_process_schedule(uuid, date, jsonb) from public, anon;
grant execute on function public.save_process_schedule(uuid, date, jsonb) to authenticated;
