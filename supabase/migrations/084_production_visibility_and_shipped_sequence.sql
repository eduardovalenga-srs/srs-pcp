-- =============================================================
-- 084) Visibilidade por KIT/EXP e baixa integral na Gestão de OF
-- =============================================================
-- Regras:
--   * KIT concluído em todos os filhos aplicáveis: a OF sai da Fábrica 1;
--   * EXP concluído em todos os itens raiz aplicáveis: a OF sai da Fábrica 2
--     e do sequenciamento, mas continua na Gestão de OF;
--   * ao concluir EXP, o seq da OF é apagado e as demais OFs ativas são
--     compactadas, preservando a ordem relativa;
--   * Gestão de OF só remove a OF depois de todos os itens raiz terem sido
--     baixados integralmente em romaneios CONFIRMADOS.
-- =============================================================

-- A regra do KIT é agregada sobre os filhos, onde o processo é registrado.
create or replace function public.order_kit_concluded(p_order_id uuid)
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
         and oi.parent_order_item_id is not null
         and pr.code = 'KIT'
         and pp.status <> 'NAO_APLICAVEL'
    )
    and not exists (
      select 1
        from public.order_items oi
        join public.production_processes pp on pp.order_item_id = oi.id
        join public.processes pr on pr.id = pp.process_id
       where oi.order_id = p_order_id
         and oi.parent_order_item_id is not null
         and pr.code = 'KIT'
         and pp.status <> 'NAO_APLICAVEL'
         and pp.status <> 'CONCLUIDO'
    );
$$;

-- Uma raiz sem linha de EXP não pode tornar a OF expedida por omissão.
-- Espelha a regra de expedição da Gestão (054): todas as raízes precisam
-- ter EXP concluído ou explicitamente NAO_APLICAVEL, com ao menos um EXP
-- aplicável concluído.
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
       where oi.order_id = p_order_id
         and oi.parent_order_item_id is null
         and not exists (
           select 1
             from public.production_processes pp
             join public.processes pr on pr.id = pp.process_id
            where pp.order_item_id = oi.id
              and pr.code = 'EXP'
         )
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

-- Baixa total é calculada só a partir das quantidades de romaneios
-- CONFIRMADOS. Romaneios abertos/cancelados não contam.
create or replace function public.order_fully_shipped(p_order_id uuid)
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
        from public.order_items root
       where root.order_id = p_order_id
         and root.parent_order_item_id is null
    )
    and not exists (
      select 1
        from public.order_items root
       where root.order_id = p_order_id
         and root.parent_order_item_id is null
         and coalesce((
           select sum(ri.quantity)
             from public.romaneio_items ri
             join public.romaneios r on r.id = ri.romaneio_id
            where ri.order_item_id = root.id
              and r.status = 'CONFIRMADO'
         ), 0) < root.quantity
    );
$$;

revoke execute on function public.order_kit_concluded(uuid) from public, anon;
revoke execute on function public.order_fully_shipped(uuid) from public, anon;
grant execute on function public.order_kit_concluded(uuid) to authenticated;
grant execute on function public.order_fully_shipped(uuid) to authenticated;

-- Recompacta a fila de OFs ainda em execução. OF expedida fica com seq NULL;
-- a Gestão de OF já exibe NULL como "-". A base histórica de OFs inativas
-- não expedidas é preservada, e a unicidade (038) é respeitada limpando
-- primeiro todas as sequências que serão regravadas.
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
  v_order_id uuid;
begin
  select coalesce(max(oi.seq), 0)
    into v_base
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.seq is not null
     and o.status not in ('PLANEJADO', 'EM_PRODUCAO')
     and not public.order_exp_concluded(o.id);

  select coalesce(
           array_agg(q.order_id order by q.old_position nulls last, q.delivery_date nulls last, q.code),
           '{}'
         )
    into v_active_ids
    from (
      select o.id as order_id,
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

  -- Retira da sequência tanto a fila ativa quanto toda OF com EXP concluído.
  update public.order_items oi
     set seq = null
   where oi.seq is not null
     and (
       oi.order_id = any (v_active_ids)
       or exists (
         select 1
           from public.orders o
          where o.id = oi.order_id
            and public.order_exp_concluded(o.id)
       )
     );

  -- Mantém a ordem anterior das OFs em execução, sem deixar lacunas.
  foreach v_order_id in array v_active_ids
  loop
    v_idx := v_idx + 1;
    update public.order_items
       set seq = v_base + v_idx
     where order_id = v_order_id;
  end loop;
end;
$$;

revoke execute on function public.resequence_expedition_queue() from public, anon, authenticated;

-- Aplica os filtros no início das consultas das fábricas, antes de totalizar
-- e paginar. As expressões toleram variações de espaços/quebras de linha na
-- definição armazenada pelo PostgreSQL e não reaplicam um filtro já presente.
do $$
declare
  v_patch record;
  v_oid oid;
  v_definition text;
  v_updated text;
begin
  for v_patch in
    select *
      from (values
        (
          'public.get_child_item_groups(text,text,text,text,text,text,uuid[],date,date,uuid,text,integer,integer,integer,numeric,numeric,numeric,numeric,numeric,numeric,text,text)',
          E'where[[:space:]]+oi\\.parent_order_item_id[[:space:]]+is[[:space:]]+not[[:space:]]+null(?![[:space:]]+and[[:space:]]+not[[:space:]]+public\\.order_kit_concluded\\(o\\.id\\))',
          'where oi.parent_order_item_id is not null and not public.order_kit_concluded(o.id)'
        ),
        (
          'public.get_child_items_totals(text,text,text,text,text,text,uuid[],date,date,uuid,text,integer,numeric,numeric,numeric,numeric,numeric,numeric)',
          E'where[[:space:]]+oi\\.parent_order_item_id[[:space:]]+is[[:space:]]+not[[:space:]]+null(?![[:space:]]+and[[:space:]]+not[[:space:]]+public\\.order_kit_concluded\\(o\\.id\\))',
          'where oi.parent_order_item_id is not null and not public.order_kit_concluded(o.id)'
        ),
        (
          'public.get_child_item_groups_page(text,text,text,text,text,text,uuid[],date,date,uuid,text,integer,integer,integer,numeric,numeric,numeric,numeric,numeric,numeric,text,text,boolean,boolean,text,date)',
          E'where[[:space:]]+oi\\.parent_order_item_id[[:space:]]+is[[:space:]]+not[[:space:]]+null(?![[:space:]]+and[[:space:]]+not[[:space:]]+public\\.order_kit_concluded\\(o\\.id\\))',
          'where oi.parent_order_item_id is not null and not public.order_kit_concluded(o.id)'
        ),
        (
          'public.get_production_rows(text,text,text,text,text,date,text,text,integer,integer,text,text,text,text,text,numeric,numeric,numeric,numeric,date,date,integer,text)',
          E'where[[:space:]]+oi\\.parent_order_item_id[[:space:]]+is[[:space:]]+null[[:space:]]+and[[:space:]]+\\(\\$2[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+o\\.status[[:space:]]*=[[:space:]]*\\$2\\)(?![[:space:]]+and[[:space:]]+not[[:space:]]+public\\.order_exp_concluded\\(o\\.id\\))',
          E'where oi.parent_order_item_id is null\n        and ($2 is null or o.status = $2)\n        and not public.order_exp_concluded(o.id)'
        ),
        (
          'public.get_production_rows_by_order(text,text,text,text,text,date,text,text,integer,integer,text,text,numeric,numeric,numeric,numeric,date,date,integer)',
          E'where[[:space:]]+\\(\\$2[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+o\\.status[[:space:]]*=[[:space:]]*\\$2\\)(?![[:space:]]+and[[:space:]]+not[[:space:]]+public\\.order_fully_shipped\\(o\\.id\\))',
          'where not public.order_fully_shipped(o.id) and ($2 is null or o.status = $2)'
        )
      ) as patches(signature, source_pattern, replacement)
  loop
    v_oid := to_regprocedure(v_patch.signature);
    if v_oid is null then
      raise exception 'Função não encontrada para ajuste da migração 084: %', v_patch.signature;
    end if;

    v_definition := pg_get_functiondef(v_oid);
    v_updated := regexp_replace(v_definition, v_patch.source_pattern, v_patch.replacement, 'gi');
    if v_updated = v_definition then
      if v_definition ~* v_patch.source_pattern then
        raise exception 'Não foi possível ajustar o trecho da função na migração 084: %', v_patch.signature;
      end if;
      -- Idempotência: sem trecho antigo, a função já contém o filtro.
      if position(
        case
          when v_patch.signature like 'public.get_child%' then 'public.order_kit_concluded(o.id)'
          when v_patch.signature like 'public.get_production_rows_by_order%' then 'public.order_fully_shipped(o.id)'
          else 'public.order_exp_concluded(o.id)'
        end
        in v_definition
      ) = 0 then
        raise exception 'Trecho da função não encontrado na migração 084: %', v_patch.signature;
      end if;
    else
      execute v_updated;
    end if;
  end loop;
end;
$$;

-- save_process_schedule (077/083) já limpa o seq das OFs expedidas e não
-- aceita recolocá-las na fila. Remove somente o bloco que as numerava no fim.
do $$
declare
  v_definition text;
  v_start integer;
  v_end integer;
  v_marker constant text := '  -- Expedidas sempre depois de todas as ativas.';
  v_loop_end constant text := '  end loop;';
begin
  v_definition := pg_get_functiondef(
    'public.save_process_schedule(uuid,date,jsonb)'::regprocedure
  );
  v_start := strpos(v_definition, v_marker);
  if v_start = 0 then
    if position('OFs com EXP concluído permanecem sem número de sequência.' in v_definition) = 0 then
      raise exception 'Bloco de sequenciamento das expedidas não encontrado na save_process_schedule.';
    end if;
  else
    v_end := strpos(substr(v_definition, v_start), v_loop_end);
    if v_end = 0 then
      raise exception 'Fim do bloco de sequenciamento das expedidas não encontrado.';
    end if;
    v_end := v_start + v_end - 1 + length(v_loop_end);

    v_definition :=
      substr(v_definition, 1, v_start - 1)
      || '  -- OFs com EXP concluído permanecem sem número de sequência.'
      || chr(10)
      || substr(v_definition, v_end);
    execute v_definition;
  end if;
end;
$$;

-- Corrige também as OFs que já tinham EXP concluído antes desta migração.
select public.resequence_expedition_queue();
