-- =============================================================
-- 078) Sequenciamento: situação do processo e da matéria-prima por OF
-- =============================================================
-- Duas colunas novas na RPC de sequenciamento (077). A agregação fica no
-- Postgres, como nas demais listas:
--
--   process_status — situação do processo SELECIONADO na OF, agregada
--     pelos itens aplicáveis (status <> 'NAO_APLICAVEL'):
--       CONCLUIDO    = todos os itens aplicáveis concluíram a etapa;
--       NAO_INICIADO = ainda há item pendente;
--       null         = nenhum processo selecionado (a tela mostra "—").
--     O filtro da RPC devolve apenas OFs com a etapa pendente, então na
--     prática o valor é NAO_INICIADO; o ramo CONCLUIDO cobre o caso de o
--     filtro/uso mudar.
--
--   mp_state — espelho do recebimento de MP da OF (a coluna MP das
--     listas de produção), agregado pelos itens aplicáveis:
--       TOTAL   = todas as MPs concluídas;
--       PARCIAL = alguma MP concluída ou com kg recebido;
--       NONE    = itens com MP, nada recebido;
--       null    = OF sem linha de MP aplicável (a tela mostra "—").
--
-- A assinatura de retorno muda, então a função é recriada (drop + create)
-- e os grants são reaplicados.
-- =============================================================

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
