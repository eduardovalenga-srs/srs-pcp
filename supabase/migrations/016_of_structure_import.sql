-- -------------------------------------------------------------
-- 016) Novo layout de importação (estrutura OF) + hierarquia pai/filho
--
--   O novo arquivo da fábrica traz a estrutura completa da OF:
--   pedido -> itens pai (ps_idPos) -> itens filhos (cp_comp) ->
--   matéria-prima por item. O arquivo NÃO traz processos nem data
--   de entrega: a data é digitada pelo operador na importação e vale
--   para todos os registros; os processos são criados pelo catálogo
--   completo em NAO_INICIADO (nível pai e filho).
--
--   1. order_items.parent_order_item_id: vínculo filho -> pai.
--      null = item de nível raiz (itens manuais legados e itens pai
--      importados preservam a semântica atual de parent_item = código
--      próprio). ON DELETE CASCADE acompanha a exclusão do pai.
--   2. apply_of_import: nova RPC transacional para o plano do novo
--      formato. A antiga apply_import continua existindo para o
--      formulário de pedidos (formato item único, sem filhos).
--   3. get_production_rows / get_production_stats: passam a contar
--      SOMENTE itens de nível raiz (pai) — a gestão de entregas mostra
--      a OF consolidada e seus itens pai; os filhos vivem na tela de
--      visualização da OF. Itens manuais (coluna nula) continuam
--      aparecendo. Mesma assinatura -> create or replace.
--   4. order_items_delete: a remoção de itens que sumiram do arquivo
--      roda como GESTOR (import.access) — a policy 002 era só ADMIN e
--      o DELETE era silenciosamente ignorado (0 linhas).
-- -------------------------------------------------------------

alter table public.order_items
  add column if not exists parent_order_item_id uuid
    references public.order_items (id) on delete cascade;

create index if not exists order_items_parent_order_item_id_idx
  on public.order_items (parent_order_item_id);

drop policy if exists "order_items_delete" on public.order_items;
create policy "order_items_delete" on public.order_items
  for delete to authenticated using (public.has_role(array ['ADMIN', 'GESTOR']));

-- -------------------------------------------------------------
-- apply_of_import — plano do novo formato:
--   { "operations": [ {
--         "action": "CREATE" | "UPDATE" | "KEEP" | "SKIP",
--         "order": { code, type, customerName, description, deliveryDate },
--         "parents": [ {
--             code, description, family, quantity, unitWeightKg,
--             totalWeightKg, deliveryDate,
--             "materials": [ { description, quantity, unit, notes } ],
--             "children": [ { ...mesmos campos..., "materials": [...] } ]
--         } ]
--     } ] }
--
--   Semântica:
--   - KEEP/SKIP: decisão do usuário na prévia — nada é gravado;
--   - CREATE/UPDATE: a estrutura do arquivo é a fonte da verdade.
--     Itens existentes são casados por código (pai na raiz; filho pelo
--     vínculo parent_order_item_id) e ATUALIZADOS preservando status e
--     OP; itens que deixaram de vir no arquivo são removidos (a prévia
--     avisa quando havia progresso);
--   - materiais do item são substituídos pelos do arquivo;
--   - os processos do catálogo ativo são garantidos em NAO_INICIADO
--     sem tocar em nenhum status já existente (progresso preservado);
--   - o status da OF é re-derivado (mesma precedência de
--     refresh_order_statuses); CANCELADO nunca é sobrescrito.
--   Qualquer erro lança exceção e TODA a operação sofre rollback.
-- -------------------------------------------------------------
create or replace function public.apply_of_import(p_plan jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_op jsonb;
  v_parent jsonb;
  v_child jsonb;
  v_mat jsonb;
  v_action text;
  v_order_id uuid;
  v_parent_id uuid;
  v_item_id uuid;
  v_kept uuid[];
  v_status text;
  v_n integer;
  v_qty numeric;
  v_unit text;
  v_orders_created integer := 0;
  v_orders_updated integer := 0;
  v_orders_skipped integer := 0;
  v_parents_created integer := 0;
  v_parents_updated integer := 0;
  v_children_created integer := 0;
  v_children_updated integer := 0;
  v_items_removed integer := 0;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  if p_plan is null or jsonb_typeof(p_plan -> 'operations') <> 'array' then
    raise exception 'Plano de importação inválido.';
  end if;

  for v_op in select value from jsonb_array_elements(p_plan -> 'operations')
  loop
    v_action := v_op ->> 'action';

    -- Decisão explícita do usuário na prévia: não mexe em nada.
    if v_action is null or v_action not in ('CREATE', 'UPDATE') then
      v_orders_skipped := v_orders_skipped + 1;
      continue;
    end if;

    v_kept := array[]::uuid[];

    -- -------------------------------------------------------
    -- Pedido (chave: code)
    -- -------------------------------------------------------
    select o.id into v_order_id
      from public.orders o
     where o.code = (v_op #>> '{order,code}');

    if v_order_id is null then
      insert into public.orders (
        code, type, customer_name, description, order_date, delivery_date,
        status, created_by, updated_by
      )
      values (
        nullif(v_op #>> '{order,code}', ''),
        coalesce(nullif(v_op #>> '{order,type}', ''), 'OF'),
        nullif(v_op #>> '{order,customerName}', ''),
        nullif(v_op #>> '{order,description}', ''),
        null,
        public.parse_date(nullif(v_op #>> '{order,deliveryDate}', '')),
        'PLANEJADO',
        v_user_id,
        v_user_id
      )
      on conflict (code) do nothing
      returning id into v_order_id;

      if v_order_id is null then
        -- corrida com outra inserção: reutiliza o pedido existente
        select o.id into v_order_id from public.orders o where o.code = (v_op #>> '{order,code}');
        v_orders_updated := v_orders_updated + 1;
      else
        v_orders_created := v_orders_created + 1;
      end if;
    else
      update public.orders
         set customer_name = coalesce(nullif(v_op #>> '{order,customerName}', ''), customer_name),
             description = coalesce(nullif(v_op #>> '{order,description}', ''), description),
             delivery_date = coalesce(public.parse_date(nullif(v_op #>> '{order,deliveryDate}', '')), delivery_date),
             type = coalesce(nullif(v_op #>> '{order,type}', ''), type),
             updated_by = v_user_id
       where id = v_order_id;

      v_orders_updated := v_orders_updated + 1;
    end if;

    if v_order_id is null then
      raise exception 'Pedido não encontrado: %', v_op #>> '{order,code}';
    end if;

    -- -------------------------------------------------------
    -- Itens pai (nível raiz: parent_order_item_id nulo)
    -- -------------------------------------------------------
    for v_parent in select value from jsonb_array_elements(coalesce(v_op -> 'parents', '[]'::jsonb))
    loop
      select oi.id into v_parent_id
        from public.order_items oi
       where oi.order_id = v_order_id
         and oi.parent_order_item_id is null
         and oi.parent_item = nullif(v_parent ->> 'code', '')
       limit 1;

      if v_parent_id is not null then
        update public.order_items
           set family = coalesce(nullif(v_parent ->> 'family', ''), family),
               description = coalesce(nullif(v_parent ->> 'description', ''), description),
               quantity = coalesce(public.parse_numeric(nullif(v_parent ->> 'quantity', '')), quantity),
               unit_weight_kg = coalesce(public.parse_numeric(nullif(v_parent ->> 'unitWeightKg', '')), unit_weight_kg),
               total_weight_kg = coalesce(public.parse_numeric(nullif(v_parent ->> 'totalWeightKg', '')), total_weight_kg),
               delivery_date = coalesce(public.parse_date(nullif(v_parent ->> 'deliveryDate', '')), public.parse_date(nullif(v_op #>> '{order,deliveryDate}', '')), delivery_date),
               updated_by = v_user_id
         where id = v_parent_id
           and order_id = v_order_id;
        v_parents_updated := v_parents_updated + 1;
      else
        insert into public.order_items (
          order_id, family, parent_item, description, quantity, unit_weight_kg,
          total_weight_kg, delivery_date, status, parent_order_item_id,
          created_by, updated_by
        )
        values (
          v_order_id,
          nullif(v_parent ->> 'family', ''),
          nullif(v_parent ->> 'code', ''),
          nullif(v_parent ->> 'description', ''),
          coalesce(public.parse_numeric(nullif(v_parent ->> 'quantity', '')), 1),
          public.parse_numeric(nullif(v_parent ->> 'unitWeightKg', '')),
          public.parse_numeric(nullif(v_parent ->> 'totalWeightKg', '')),
          coalesce(
            public.parse_date(nullif(v_parent ->> 'deliveryDate', '')),
            public.parse_date(nullif(v_op #>> '{order,deliveryDate}', ''))
          ),
          'PLANEJADO',
          null,
          v_user_id,
          v_user_id
        )
        returning id into v_parent_id;
        v_parents_created := v_parents_created + 1;
      end if;

      v_kept := array_append(v_kept, v_parent_id);

      -- Catálogo completo em NAO_INICIADO; o que já existe não é tocado.
      insert into public.production_processes (order_item_id, process_id, status)
      select v_parent_id, pr.id, 'NAO_INICIADO'
        from public.processes pr
       where pr.active
         and not exists (
           select 1 from public.production_processes pp
            where pp.order_item_id = v_parent_id
              and pp.process_id = pr.id
         );

      -- Materiais do pai: substituídos pelos do arquivo.
      delete from public.order_item_materials where order_item_id = v_parent_id;
      for v_mat in select value from jsonb_array_elements(coalesce(v_parent -> 'materials', '[]'::jsonb))
      loop
        if nullif(v_mat ->> 'description', '') is not null then
          v_qty := public.parse_numeric(nullif(v_mat ->> 'quantity', ''));
          if v_qty is null or v_qty <= 0 then
            raise exception 'Quantidade inválida no material %', nullif(v_mat ->> 'description', '');
          end if;
          -- Unidade fora da lista do check (011) cai no padrão UN.
          v_unit := coalesce(upper(nullif(trim(v_mat ->> 'unit'), '')), 'UN');
          if v_unit not in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC') then
            v_unit := 'UN';
          end if;

          insert into public.order_item_materials (order_item_id, description, quantity, unit, notes)
          values (
            v_parent_id,
            nullif(v_mat ->> 'description', ''),
            v_qty,
            v_unit,
            nullif(v_mat ->> 'notes', '')
          );
        end if;
      end loop;

      -- -------------------------------------------------------
      -- Itens filhos (vinculados ao pai)
      -- -------------------------------------------------------
      for v_child in select value from jsonb_array_elements(coalesce(v_parent -> 'children', '[]'::jsonb))
      loop
        select oi.id into v_item_id
          from public.order_items oi
         where oi.order_id = v_order_id
           and oi.parent_order_item_id = v_parent_id
           and oi.parent_item = nullif(v_child ->> 'code', '')
         limit 1;

        if v_item_id is not null then
          update public.order_items
             set family = coalesce(nullif(v_child ->> 'family', ''), family),
                 description = coalesce(nullif(v_child ->> 'description', ''), description),
                 quantity = coalesce(public.parse_numeric(nullif(v_child ->> 'quantity', '')), quantity),
                 unit_weight_kg = coalesce(public.parse_numeric(nullif(v_child ->> 'unitWeightKg', '')), unit_weight_kg),
                 total_weight_kg = coalesce(public.parse_numeric(nullif(v_child ->> 'totalWeightKg', '')), total_weight_kg),
                 delivery_date = coalesce(public.parse_date(nullif(v_child ->> 'deliveryDate', '')), public.parse_date(nullif(v_op #>> '{order,deliveryDate}', '')), delivery_date),
                 updated_by = v_user_id
           where id = v_item_id
             and order_id = v_order_id;
          v_children_updated := v_children_updated + 1;
        else
          insert into public.order_items (
            order_id, family, parent_item, description, quantity, unit_weight_kg,
            total_weight_kg, delivery_date, status, parent_order_item_id,
            created_by, updated_by
          )
          values (
            v_order_id,
            nullif(v_child ->> 'family', ''),
            nullif(v_child ->> 'code', ''),
            nullif(v_child ->> 'description', ''),
            coalesce(public.parse_numeric(nullif(v_child ->> 'quantity', '')), 1),
            public.parse_numeric(nullif(v_child ->> 'unitWeightKg', '')),
            public.parse_numeric(nullif(v_child ->> 'totalWeightKg', '')),
            coalesce(
              public.parse_date(nullif(v_child ->> 'deliveryDate', '')),
              public.parse_date(nullif(v_op #>> '{order,deliveryDate}', ''))
            ),
            'PLANEJADO',
            v_parent_id,
            v_user_id,
            v_user_id
          )
          returning id into v_item_id;
          v_children_created := v_children_created + 1;
        end if;

        v_kept := array_append(v_kept, v_item_id);

        insert into public.production_processes (order_item_id, process_id, status)
        select v_item_id, pr.id, 'NAO_INICIADO'
          from public.processes pr
         where pr.active
           and not exists (
             select 1 from public.production_processes pp
              where pp.order_item_id = v_item_id
                and pp.process_id = pr.id
           );

        delete from public.order_item_materials where order_item_id = v_item_id;
        for v_mat in select value from jsonb_array_elements(coalesce(v_child -> 'materials', '[]'::jsonb))
        loop
          if nullif(v_mat ->> 'description', '') is not null then
            v_qty := public.parse_numeric(nullif(v_mat ->> 'quantity', ''));
            if v_qty is null or v_qty <= 0 then
              raise exception 'Quantidade inválida no material %', nullif(v_mat ->> 'description', '');
            end if;
            v_unit := coalesce(upper(nullif(trim(v_mat ->> 'unit'), '')), 'UN');
            if v_unit not in ('KG', 'G', 'M', 'M2', 'M3', 'L', 'UN', 'CX', 'SC') then
              v_unit := 'UN';
            end if;

            insert into public.order_item_materials (order_item_id, description, quantity, unit, notes)
            values (
              v_item_id,
              nullif(v_mat ->> 'description', ''),
              v_qty,
              v_unit,
              nullif(v_mat ->> 'notes', '')
            );
          end if;
        end loop;
      end loop;
    end loop;

    -- -------------------------------------------------------
    -- Estrutura do arquivo é a fonte da verdade: o que não veio
    -- mais é removido (a prévia já avisou quem tinha progresso).
    -- -------------------------------------------------------
    delete from public.order_items oi
     where oi.order_id = v_order_id
       and not (oi.id = any (v_kept));
    get diagnostics v_n = row_count;
    v_items_removed := v_items_removed + v_n;

    -- -------------------------------------------------------
    -- Status da OF re-derivado (precedência de refresh_order_statuses)
    -- -------------------------------------------------------
    select o.status into v_status from public.orders o where o.id = v_order_id;

    if v_status is distinct from 'CANCELADO' then
      update public.orders o
         set status = sub.next_status,
             updated_at = now(),
             updated_by = v_user_id
        from (
          select case
                   when count(*) = 0 then 'PLANEJADO'
                   when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
                   when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
                   else 'PLANEJADO'
                 end as next_status
            from public.order_items oi
           where oi.order_id = v_order_id
        ) sub
       where o.id = v_order_id;
    end if;
  end loop;

  return jsonb_build_object(
    'ordersCreated', v_orders_created,
    'ordersUpdated', v_orders_updated,
    'ordersSkipped', v_orders_skipped,
    'parentsCreated', v_parents_created,
    'parentsUpdated', v_parents_updated,
    'childrenCreated', v_children_created,
    'childrenUpdated', v_children_updated,
    'itemsRemoved', v_items_removed
  );
end;
$$;

revoke execute on function public.apply_of_import(jsonb) from anon;
grant execute on function public.apply_of_import(jsonb) to authenticated;

-- -------------------------------------------------------------
-- get_production_rows (014 + itens pai)
--
-- A gestão de entregas mostra a OF consolidada e seus itens pai.
-- Filhos importados (parent_order_item_id preenchido) ficam de fora —
-- eles aparecem na tela de visualização da OF. Itens manuais legados
-- (coluna nula) continuam na lista. Assinatura inalterada (21 params).
-- -------------------------------------------------------------
create or replace function public.get_production_rows(
  p_search text default null,
  p_order_status text default null,
  p_process_code text default null,
  p_process_status text default null,
  p_delivery_filter text default 'ALL',
  p_today date default null,
  p_sort text default 'delivery_date',
  p_sort_dir text default 'asc',
  p_offset integer default 0,
  p_limit integer default 50,
  -- filtros por coluna (007)
  p_order_code text default null,
  p_customer text default null,
  p_family text default null,
  p_parent_item text default null,
  p_description text default null,
  p_qty_min numeric default null,
  p_qty_max numeric default null,
  p_weight_min numeric default null,
  p_weight_max numeric default null,
  -- período de entrega (014): inclusivo, lados opcionais
  p_delivery_from date default null,
  p_delivery_to date default null
)
returns table (
  total_count bigint,
  order_item_id uuid,
  order_id uuid,
  order_code text,
  order_type text,
  customer_name text,
  order_status text,
  family text,
  parent_item text,
  description text,
  quantity numeric,
  unit_weight_kg numeric,
  delivery_date date,
  item_status text,
  op text,
  overdue boolean,
  processes jsonb
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_sort_expr text;
  v_sort_dir text;
  v_sql text;
begin
  v_sort_dir := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  v_sort_expr := case p_sort
    when 'delivery_date'  then 'j.deliv'
    when 'order_code'     then 'j.ord_code'
    when 'order_type'     then 'j.ord_type'
    when 'order_status'   then 'j.ord_status'
    when 'family'         then 'j.family'
    when 'parent_item'    then 'j.parent_item'
    when 'description'    then 'j.descr'
    when 'quantity'       then 'j.qty'
    when 'unit_weight_kg' then 'j.unit_w'
    when 'item_status'    then 'j.item_status'
    when 'op'             then 'j.op'
    when 'overdue'        then 'j.overdue'
    else null
  end;

  -- Ordenação por coluna de processo (código existente no catálogo)
  if v_sort_expr is null then
    if exists (select 1 from public.processes pr where pr.code = p_sort) then
      v_sort_expr :=
        '(select case xp.pstatus '
        || 'when ''CONCLUIDO'' then 1 '
        || 'when ''EM_ANDAMENTO'' then 2 '
        || 'when ''NAO_INICIADO'' then 3 '
        || 'when ''BLOQUEADO'' then 4 '
        || 'else 5 end '
        || 'from process_rows xp '
        || 'where xp.pid = j.item_id and xp.pcode = ' || quote_literal(p_sort) || ' limit 1)';
    else
      v_sort_expr := 'j.deliv';
    end if;
  end if;

  v_sql := $q$
    with process_rows as (
      select
        pp.order_item_id as pid,
        pr.code as pcode,
        pp.id as pp_id,
        pp.status as pstatus,
        pp.quantity_planned as pq_planned,
        pp.quantity_completed as pq_done,
        pp.notes as pnotes
      from public.production_processes pp
      join public.processes pr on pr.id = pp.process_id
    ),
    filtered as (
      select
        oi.id as item_id,
        oi.order_id as ord_id,
        coalesce(oi.family, '') as family,
        coalesce(oi.parent_item, '') as parent_item,
        oi.description as descr,
        oi.quantity as qty,
        oi.unit_weight_kg as unit_w,
        oi.delivery_date as deliv,
        oi.status as item_status,
        oi.op as op,
        o.code as ord_code,
        o.type as ord_type,
        o.status as ord_status,
        coalesce(o.customer_name, '') as cust
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      -- 016: só itens de nível raiz (itens pai / manuais)
      where oi.parent_order_item_id is null
        and ($2 is null or o.status = $2)
        and (
          $1 is null
          or o.code ilike '%' || $1 || '%'
          or coalesce(oi.family, '') ilike '%' || $1 || '%'
          or coalesce(oi.parent_item, '') ilike '%' || $1 || '%'
          or oi.description ilike '%' || $1 || '%'
        )
        and (
          -- filtro de processo
          $3 is null
          or exists (
            select 1 from process_rows x
            where x.pid = oi.id
              and x.pcode = $3
              and (case when $4 is null then x.pstatus <> 'NAO_APLICAVEL' else x.pstatus = $4 end)
          )
        )
        and (
          -- status de processo sem processo específico
          $4 is null or $3 is not null
          or exists (select 1 from process_rows x where x.pid = oi.id and x.pstatus = $4)
        )
        and (
          -- filtro de entrega (janela rápida)
          case $5
            when 'OVERDUE' then
              oi.delivery_date is not null and oi.delivery_date < $6::date
              and not exists (
                select 1 from process_rows x
                where x.pid = oi.id and x.pcode = 'EXP' and x.pstatus = 'CONCLUIDO'
              )
            when 'TODAY' then oi.delivery_date = $6::date
            when 'NEXT_7_DAYS' then oi.delivery_date >= $6::date and oi.delivery_date <= (($6::date + 7))
            when 'NEXT_30_DAYS' then oi.delivery_date >= $6::date and oi.delivery_date <= (($6::date + 30))
            else true
          end
        )
        and ($9 is null or o.code ilike '%' || $9 || '%')
        and ($10 is null or coalesce(o.customer_name, '') ilike '%' || $10 || '%')
        and ($11 is null or coalesce(oi.family, '') ilike '%' || $11 || '%')
        and ($12 is null or coalesce(oi.parent_item, '') ilike '%' || $12 || '%')
        and ($13 is null or oi.description ilike '%' || $13 || '%')
        and ($14 is null or oi.quantity >= $14)
        and ($15 is null or oi.quantity <= $15)
        and ($16 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg >= $16))
        and ($17 is null or (oi.unit_weight_kg is not null and oi.unit_weight_kg <= $17))
        and ($18 is null or (oi.delivery_date is not null and oi.delivery_date >= $18))
        and ($19 is null or (oi.delivery_date is not null and oi.delivery_date <= $19))
    ),
    joined as (
      select
        f.*,
        (
          f.deliv is not null
          and f.deliv < $6::date
          and not exists (
            select 1 from process_rows x
            where x.pid = f.item_id and x.pcode = 'EXP' and x.pstatus = 'CONCLUIDO'
          )
        ) as overdue,
        coalesce(
          (
            select jsonb_object_agg(
              x.pcode,
              jsonb_build_object(
                'id', x.pp_id,
                'status', x.pstatus,
                'quantityPlanned', x.pq_planned,
                'quantityCompleted', x.pq_done,
                'notes', x.pnotes
              ) order by x.pcode
            )
            from process_rows x
            where x.pid = f.item_id
          ),
          '{}'::jsonb
        ) as processes
      from filtered f
    )
    select
      count(*) over() as total_count,
      j.item_id, j.ord_id, j.ord_code, j.ord_type, j.cust, j.ord_status,
      j.family, j.parent_item, j.descr, j.qty, j.unit_w, j.deliv, j.item_status,
      j.op, j.overdue, j.processes
    from joined j
  $q$;

  v_sql := v_sql
    || ' order by ' || v_sort_expr || ' ' || v_sort_dir
    || ' nulls last, j.ord_code asc, j.parent_item asc nulls last, j.item_id asc'
    || ' limit $7 offset $8';

  return query execute v_sql
    using
      nullif(p_search, ''),
      nullif(p_order_status, ''),
      nullif(p_process_code, ''),
      nullif(p_process_status, ''),
      coalesce(p_delivery_filter, 'ALL'),
      v_today,
      greatest(coalesce(p_limit, 50), 1),
      greatest(coalesce(p_offset, 0), 0),
      nullif(p_order_code, ''),
      nullif(p_customer, ''),
      nullif(p_family, ''),
      nullif(p_parent_item, ''),
      nullif(p_description, ''),
      p_qty_min,
      p_qty_max,
      p_weight_min,
      p_weight_max,
      p_delivery_from,
      p_delivery_to;
end;
$$;

revoke execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) from anon;
grant execute on function public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date) to authenticated;

-- -------------------------------------------------------------
-- get_production_stats (006 + itens pai)
--
-- Mesma consolidação da gestão: os KPIs de itens, entregas e
-- processos contam apenas itens de nível raiz — caso contrário os
-- números do dashboard não batem com as linhas da tabela. Assinatura
-- inalterada.
-- -------------------------------------------------------------
create or replace function public.get_production_stats(p_today date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, current_date);
  v_result jsonb;
begin
  select jsonb_build_object(
    'totalOrders', (select count(*) from public.orders),
    'ordersByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select o.status as status, count(*) as cnt
          from public.orders o
          group by o.status
        ) s
      ),
      '{}'::jsonb
    ),
    'totalItems', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null
    ),
    'itemsByStatus', coalesce(
      (
        select jsonb_object_agg(s.status, s.cnt)
        from (
          select oi.status as status, count(*) as cnt
          from public.order_items oi
          where oi.parent_order_item_id is null
          group by oi.status
        ) s
      ),
      '{}'::jsonb
    ),
    'itemsInProduction', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null and oi.status = 'EM_PRODUCAO'
    ),
    'itemsDone', (
      select count(*) from public.order_items oi
      where oi.parent_order_item_id is null and oi.status = 'CONCLUIDO'
    ),
    'itemsOverdue', (
      select count(*)
      from public.order_items oi
      where oi.parent_order_item_id is null
        and oi.delivery_date is not null
        and oi.delivery_date < v_today
        and not exists (
          select 1
          from public.production_processes pp
          join public.processes pr on pr.id = pp.process_id
          where pp.order_item_id = oi.id
            and pr.code = 'EXP'
            and pp.status = 'CONCLUIDO'
        )
    ),
    'delivery', (
      select jsonb_build_object(
        'overdue', count(*) filter (
          where oi.delivery_date < v_today
            and not exists (
              select 1 from public.production_processes pp
              join public.processes pr on pr.id = pp.process_id
              where pp.order_item_id = oi.id and pr.code = 'EXP' and pp.status = 'CONCLUIDO'
            )
        ),
        'today', count(*) filter (where oi.delivery_date = v_today),
        'next7', count(*) filter (where oi.delivery_date > v_today and oi.delivery_date <= (v_today + 7)),
        'next30', count(*) filter (where oi.delivery_date > (v_today + 7) and oi.delivery_date <= (v_today + 30))
      )
      from public.order_items oi
      where oi.parent_order_item_id is null
        and oi.delivery_date is not null
    ),
    'processes', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'code', g.code,
            'name', g.name,
            'displayOrder', g.display_order,
            'total', g.total,
            'pending', g.pending,
            'inProgress', g.in_progress,
            'blocked', g.blocked,
            'done', g.done
          ) order by g.display_order
        )
        from (
          select
            p.code as code,
            p.name as name,
            p.display_order as display_order,
            count(*) filter (where oi.id is not null and pp.status <> 'NAO_APLICAVEL') as total,
            count(*) filter (where oi.id is not null and pp.status = 'NAO_INICIADO') as pending,
            count(*) filter (where oi.id is not null and pp.status = 'EM_ANDAMENTO') as in_progress,
            count(*) filter (where oi.id is not null and pp.status = 'BLOQUEADO') as blocked,
            count(*) filter (where oi.id is not null and pp.status = 'CONCLUIDO') as done
          from public.processes p
          left join public.production_processes pp on pp.process_id = p.id
          left join public.order_items oi
            on oi.id = pp.order_item_id
           and oi.parent_order_item_id is null
          where p.active
          group by p.id, p.code, p.name, p.display_order
        ) g
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_production_stats(date) from anon;
grant execute on function public.get_production_stats(date) to authenticated;
