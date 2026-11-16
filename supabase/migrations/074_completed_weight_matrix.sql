-- -------------------------------------------------------------
-- 074) Peso concluído por processo — matriz dia × processo + filtro master
--
-- Substitui a RPC da 067 e o detalhe diário da 072 com as mudanças
-- pedidas pelo dashboard:
--
--  1. MATRIZ POR DIA: além dos totais do período e da série de
--     evolução, a função devolve `days` — um registro por dia do
--     período (zero-filled) com peso/peças/células concluídas em cada
--     processo, para a tabela "Dia × processos" (mesmo layout da
--     gestão de OF).
--
--  2. QUANTIDADE DE FALLBACK: ao marcar um processo como CONCLUIDO
--     pela gestão de OF (edição em lote) só a situação muda — as
--     quantidades ficam nulas. Antes isso gerava kg = 0 e a linha era
--     removida pelo HAVING, então o processo "sumia" do dashboard.
--     Agora a quantidade vem de, nesta ordem: quantidade produzida,
--     quantidade planejada e quantidade do ITEM. A linha permanece na
--     resposta mesmo com peso 0 (a UI marca a célula como "✓").
--
--  3. FILTRO MASTER: `p_process_code` restringe TODOS os recortes
--     (período, comparação, série e matriz) ao processo escolhido.
--
-- `completed_at` nulo (histórico antigo) usa `updated_at` como data
-- efetiva, para não desaparecer do período em que foi marcado.
-- -------------------------------------------------------------

create index if not exists idx_production_processes_completed_at
  on public.production_processes (completed_at);

-- A assinatura ganha p_process_code e o detalhe diário passa a viver
-- dentro de `days`: as versões antigas saem para não deixar sobrecargas
-- com o mesmo nome nem uma segunda RPC com regra divergente.
drop function if exists public.get_completed_weight_daily_detail(text, date, text);
drop function if exists public.get_completed_weight_stats(text, date, text);

create or replace function public.get_completed_weight_stats(
  p_granularity text default 'month',
  p_anchor date default null,
  p_timezone text default 'America/Sao_Paulo',
  p_process_code text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_gran text := case
    when lower(coalesce(p_granularity, '')) in ('day', 'week', 'month')
      then lower(p_granularity)
    else 'month'
  end;
  v_tz text := coalesce(nullif(p_timezone, ''), 'America/Sao_Paulo');
  v_anchor date := coalesce(p_anchor, (now() at time zone v_tz)::date);
  v_process text := nullif(btrim(coalesce(p_process_code, '')), '');
  v_start date;                       -- início do período (inclusivo)
  v_end date;                         -- fim do período (EXCLUSIVO)
  v_prev_start date;                  -- período anterior, mesma extensão
  v_series_start date;                -- início da janela de evolução
  v_step interval;
  v_result jsonb;
begin
  if v_gran = 'day' then
    v_start := v_anchor;
    v_end := v_anchor + 1;
    v_prev_start := v_anchor - 1;
    v_step := interval '1 day';
    v_series_start := v_anchor - 13;                    -- 14 dias
  elsif v_gran = 'week' then
    -- Semana civil: segunda a domingo (date_trunc('week')).
    v_start := date_trunc('week', v_anchor::timestamp)::date;
    v_end := v_start + 7;
    v_prev_start := v_start - 7;
    v_step := interval '7 days';
    v_series_start := v_start - (7 * 11);               -- 12 semanas
  else
    v_start := date_trunc('month', v_anchor::timestamp)::date;
    v_end := (date_trunc('month', v_anchor::timestamp) + interval '1 month')::date;
    v_prev_start := (v_start - interval '1 month')::date;
    v_step := interval '1 month';
    v_series_start := (v_start - interval '11 months')::date;  -- 12 meses
  end if;

  with done_rows as (
    select
      pr.code as code,
      pr.name as name,
      pr.display_order as display_order,
      -- Data efetiva: completed_at; histórico antigo cai em updated_at.
      (coalesce(pp.completed_at, pp.updated_at, pp.created_at) at time zone v_tz)::date as done_date,
      -- Quantidade concluída com fallback (ver comentário do cabeçalho).
      coalesce(nullif(pp.quantity_completed, 0), nullif(pp.quantity_planned, 0), oi.quantity, 0) as quantity,
      coalesce(nullif(pp.quantity_completed, 0), nullif(pp.quantity_planned, 0), oi.quantity, 0)
        * coalesce(oi.unit_weight_kg, 0) as weight_kg,
      oi.id as item_id
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
    join public.order_items oi on oi.id = pp.order_item_id
    where pp.status = 'CONCLUIDO'
      -- Filtro master: null = todos os processos.
      and (v_process is null or pr.code = v_process)
      -- Limite bruto em timestamptz preserva o índice. A série começa
      -- antes do período de comparação e cobre ambos os recortes.
      and coalesce(pp.completed_at, pp.updated_at, pp.created_at) >= (v_series_start::timestamp at time zone v_tz)
      and coalesce(pp.completed_at, pp.updated_at, pp.created_at) < (v_end::timestamp at time zone v_tz)
      -- Escopo 039: código de filho (F1 + KIT) só em item filho; os
      -- demais (MP, PRÉ-MTG…EXP) só em item raiz.
      and ((pr.code in ('LASER', 'DB_CH', 'SERRA', 'DB_TB', 'PUNC', 'METALEIRA', 'FICEP', 'KIT'))
           = (oi.parent_order_item_id is not null))
  ),
  period_rows as (
    select * from done_rows
    where done_date >= v_start and done_date < v_end
  ),
  process_agg as (
    select
      code, name, display_order,
      sum(weight_kg) as weight_kg,
      sum(quantity) as quantity,
      count(*) as cells,
      count(distinct item_id) as items
    from period_rows
    group by code, name, display_order
  ),
  period_total as (
    select
      coalesce(sum(weight_kg), 0) as weight_kg,
      coalesce(sum(quantity), 0) as quantity
    from period_rows
  ),
  previous_total as (
    select
      coalesce(sum(weight_kg), 0) as weight_kg,
      coalesce(sum(quantity), 0) as quantity
    from done_rows
    where done_date >= v_prev_start and done_date < v_start
  ),
  -- ---------------------------------------------
  -- Matriz Dia × processos (período atual)
  -- ---------------------------------------------
  period_days as (
    select generate_series(v_start, v_end - 1, interval '1 day')::date as day
  ),
  day_rows as (
    select
      d.done_date as day,
      d.code as code,
      d.display_order as display_order,
      sum(d.weight_kg) as weight_kg,
      sum(d.quantity) as quantity,
      count(*) as cells
    from period_rows d
    group by d.done_date, d.code, d.display_order
  ),
  day_processes as (
    select
      day,
      jsonb_agg(
        jsonb_build_object(
          'code', code,
          'weightKg', weight_kg,
          'quantity', quantity,
          'cells', cells
        )
        order by display_order, code
      ) as processes
    from day_rows
    group by day
  ),
  days_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', pd.day,
          'processes', coalesce(dp.processes, '[]'::jsonb)
        )
        order by pd.day
      ),
      '[]'::jsonb
    ) as value
    from period_days pd
    left join day_processes dp on dp.day = pd.day
  ),
  -- ---------------------------------------------
  -- Série de evolução (dia/semana/mês do anchor)
  -- ---------------------------------------------
  buckets as (
    select generate_series(
      v_series_start::timestamp,
      (v_end - 1)::timestamp,
      v_step
    )::date as bucket
  ),
  series_rows as (
    select
      d.*,
      case v_gran
        when 'day' then d.done_date
        when 'week' then date_trunc('week', d.done_date::timestamp)::date
        else date_trunc('month', d.done_date::timestamp)::date
      end as bucket
    from done_rows d
    where d.done_date >= v_series_start and d.done_date < v_end
  ),
  by_bucket as (
    select
      d.bucket,
      d.code as code,
      d.display_order as display_order,
      sum(d.weight_kg) as weight_kg,
      sum(d.quantity) as quantity
    from series_rows d
    group by d.bucket, d.code, d.display_order
  ),
  bucket_totals as (
    select bucket, sum(weight_kg) as weight_kg, sum(quantity) as quantity
    from by_bucket
    group by bucket
  ),
  bucket_processes as (
    select
      bucket,
      jsonb_agg(
        jsonb_build_object('code', code, 'weightKg', weight_kg, 'quantity', quantity)
        order by display_order, code
      ) as processes
    from by_bucket
    group by bucket
  ),
  processes_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'code', a.code,
          'name', a.name,
          'displayOrder', a.display_order,
          'weightKg', a.weight_kg,
          'quantity', a.quantity,
          'items', a.items,
          'cells', a.cells
        )
        order by a.display_order, a.code
      ),
      '[]'::jsonb
    ) as value
    from process_agg a
  ),
  series_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'bucket', b.bucket,
          'weightKg', coalesce(t.weight_kg, 0),
          'quantity', coalesce(t.quantity, 0),
          'processes', coalesce(bp.processes, '[]'::jsonb)
        )
        order by b.bucket
      ),
      '[]'::jsonb
    ) as value
    from buckets b
    left join bucket_totals t on t.bucket = b.bucket
    left join bucket_processes bp on bp.bucket = b.bucket
  )
  select jsonb_build_object(
    'granularity', v_gran,
    'anchor', v_anchor,
    'periodStart', v_start,
    'periodEnd', (v_end - 1),
    'processCode', v_process,
    'processes', (select value from processes_json),
    'total', (
      select jsonb_build_object('weightKg', weight_kg, 'quantity', quantity)
      from period_total
    ),
    'previous', (
      select jsonb_build_object('weightKg', weight_kg, 'quantity', quantity)
      from previous_total
    ),
    'days', (select value from days_json),
    'series', (select value from series_json)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_completed_weight_stats(text, date, text, text) from anon;
grant execute on function public.get_completed_weight_stats(text, date, text, text) to authenticated;
