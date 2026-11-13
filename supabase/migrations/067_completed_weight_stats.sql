-- -------------------------------------------------------------
-- 067) Peso (kg) concluído por PROCESSO no período (dashboard)
--
-- O dashboard passa a mostrar, para cada processo, o peso marcado como
-- CONCLUÍDO em um período (dia, semana ou mês), com série de evolução:
--
--   kg = production_processes.quantity_completed × order_items.unit_weight_kg
--
-- sobre as células com status CONCLUIDO e `completed_at` dentro do
-- período. O escopo pai/filho espelha a RPC da 039 (e o
-- CHILD_SCOPED_PROCESS_CODES da UI): a cadeia F1 e o KIT são lidos nos
-- ITENS FILHOS; MP e os demais processos nos ITENS RAIZ — o mesmo peso
-- nunca é contado duas vezes.
--
-- A função devolve também:
--   * `previous` — total do período ANTERIOR de mesma extensão (base da
--     variação exibida nos cards);
--   * `series` — buckets preenchidos com zero para o gráfico de
--     evolução (14 dias / 12 semanas / 12 meses até o anchor).
--
-- O dia é interpretado no fuso do negócio (p_timezone, o mesmo
-- BUSINESS_TIMEZONE da aplicação) — a coluna completed_at é timestamptz.
-- -------------------------------------------------------------

create index if not exists idx_production_processes_completed_at
  on public.production_processes (completed_at);

create or replace function public.get_completed_weight_stats(
  p_granularity text default 'month',
  p_anchor date default null,
  p_timezone text default 'America/Sao_Paulo'
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
      (pp.completed_at at time zone v_tz)::date as done_date,
      -- Peso concluído no processo: qtd concluída × peso unitário do item.
      coalesce(pp.quantity_completed, 0) * coalesce(oi.unit_weight_kg, 0) as weight_kg,
      coalesce(pp.quantity_completed, 0) as quantity,
      oi.id as item_id
    from public.production_processes pp
    join public.processes pr on pr.id = pp.process_id
    join public.order_items oi on oi.id = pp.order_item_id
    where pp.status = 'CONCLUIDO'
      and pp.completed_at is not null
      -- Limite bruto em timestamptz preserva o uso do índice 067. A série
      -- começa antes do período de comparação, então cobre ambos os recortes.
      and pp.completed_at >= (v_series_start::timestamp at time zone v_tz)
      and pp.completed_at < (v_end::timestamp at time zone v_tz)
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
      count(distinct item_id) as items
    from period_rows
    group by code, name, display_order
    having sum(weight_kg) > 0 or sum(quantity) > 0
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
        jsonb_build_object('code', code, 'weightKg', weight_kg)
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
          'items', a.items
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
    'processes', (select value from processes_json),
    'total', (
      select jsonb_build_object('weightKg', weight_kg, 'quantity', quantity)
      from period_total
    ),
    'previous', (
      select jsonb_build_object('weightKg', weight_kg, 'quantity', quantity)
      from previous_total
    ),
    'series', (select value from series_json)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.get_completed_weight_stats(text, date, text) from anon;
grant execute on function public.get_completed_weight_stats(text, date, text) to authenticated;
