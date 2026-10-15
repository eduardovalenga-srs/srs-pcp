-- -------------------------------------------------------------
-- 027) apply_of_import: só o MP nasce marcado (paridade com o manual)
--
-- A RPC da importação (016) foi escrita ANTES da 022 e criava o
-- catálogo completo em NAO_INICIADO para pai e filho — todas as
-- colunas saíam "marcadas" para a OF importada, sem que ninguém
-- tivesse escolhido nada. O pedido manual (apply_import + formulário)
-- e o backfill de catálogo (022) já usam a regra correta:
--   * MP (021) -> NAO_INICIADO (obrigatório, pré-requisito da produção);
--   * demais   -> NAO_APLICAVEL (desmarcado até o usuário marcar).
--
-- Aqui a função é redefinida com a MESMA fórmula da backfill_process
-- (022) nos dois inserts (pai e filho). Todo o resto permanece idêntico
-- à 016:
--   * invariante 010 mantida — todas as linhas nascem (a célula da
--     grade mostra "—" em vez de vazia); muda apenas o status inicial;
--   * linhas existentes não são tocadas (not exists) — progresso
--     preservado no UPDATE; KEEP/SKIP seguem sem efeito;
--   * materiais, remoção de itens ausentes e re-derivação do status
--     da OF inalterados.
--
-- Sem reparo de dados: OFs já importadas mantêm os status gravados
-- (apenas o comportamento futuro muda).
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

      -- Linhas ausentes nascem pela fórmula da 022 (paridade com o manual):
      -- só o MP é obrigatório (NAO_INICIADO); os demais nascem
      -- desmarcados (NAO_APLICAVEL). O que já existe não é tocado.
      insert into public.production_processes (order_item_id, process_id, status)
      select v_parent_id, pr.id, case when pr.code = 'MP' then 'NAO_INICIADO' else 'NAO_APLICAVEL' end
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
        select v_item_id, pr.id, case when pr.code = 'MP' then 'NAO_INICIADO' else 'NAO_APLICAVEL' end
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
