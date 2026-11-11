-- -------------------------------------------------------------
-- 058) RECUPERAÇÃO das marcações de MP do histórico (a 057 zerou)
--
-- PROBLEMA: a 057 (§7, "backfill silencioso") recalculou a célula MP
-- de TODOS os itens PAIS a partir dos recibos — que estavam vazios —
-- e zerou o que estava marcado (MP = CONCLUIDO). Como o backfill não
-- grava production_events, a marcação sumiu sem nenhum rastro no
-- banco.
--
-- A marcação continua no HISTÓRICO (production_events) — é de lá que
-- a recuperação lê. E como a 056/057 tirou a marcação de mão (o MP
-- virou espelho dos recibos), a recuperação devolve o dado na forma
-- NOVA: RECIBOS. É a única forma de a célula ficar verde de novo:
-- mexer direto em production_processes seria apagado no próximo
-- recebimento da OF.
--
-- O QUE É "MARCA" (o estado legado da célula MP):
--   * o ÚLTIMO evento do processo MP que NÃO é do espelho (nota
--     'Espelho do recebimento de MP%') — o espelho é derivado do
--     fluxo novo, não é uma marca;
--   * new_status = CONCLUIDO → a célula estava marcada.
--
-- ESCOPO (p_scope):
--   'todas' (padrão) — todas as marcas. As de CASCATA ('Concluído
--       automaticamente ao concluir X') vinham da regra 62 antiga: o
--       MP era pré-requisito de todo processo e era concluído junto —
--       na prática, a produção só andou porque o material chegou.
--   'manual' — só as marcas feitas À MÃO (as da Gestão de OF).
--
-- O QUE A RECUPERAÇÃO FAZ (por alvo elegível):
--   1. marca de item FILHO  → recibo do próprio item;
--      marca de item PAI     → recibo de TODOS os filhos (é o
--      agregado dos filhos que decide o verde do pai na 057 — sem os
--      filhos o pai nunca chega a TOTAL);
--      marca de item PAI sem filhos → recibo do próprio item;
--      data da marca PRÓPRIA do item tem precedência sobre a do pai
--      (a MP do pai é o conjunto; a do filho, o item);
--   2. kg = o SALDO que falta para o item fechar (planejado menos o
--      já recebido); item sem peso cadastrado → 1 kg (qualquer
--      recebimento > 0 já conta como total);
--   3. UM recibo por (OF, data da marcação) — created_by = quem
--      marcou, com nota de recuperação (auditoria na tela);
--   4. restaura o completed_at (a data que a lista mostra) e roda o
--      espelho (mp_receipt_sync_item / mp_receipt_sync_parent);
--   5. re-deriva o status de item e de OF (mesma regra do app).
--
-- O QUE O FLUXO NOVO PROTEGE (nada é sobrescrito por baixo):
--   * alvo que JÁ tem recibo → fica de fora (o fluxo novo é a fonte
--     da verdade atual);
--   * alvo cujo ÚLTIMO evento de espelho é posterior à marca legada
--     → fica de fora (o fluxo novo falou por ele — por exemplo, um
--     recibo lançado e depois EXCLUÍDO; recuperá-lo desfaria a
--     exclusão).
--
-- IDEMPOTENTE: o saldo é calculado sobre o que JÁ foi recebido (nada
-- é contado duas vezes) e o backup (mp_recovery_backup_058) só é
-- gravado uma vez. Rodar de novo não faz nada.
--
-- USO (SQL Editor ou CLI — a função exige o dono da base ou
-- ADMIN/GESTOR autenticado):
--   select public.mp_receipt_recover_legacy(true);            -- dry-run
--   select public.mp_receipt_recover_legacy(true, 'manual');   -- dry-run só manual
--   select public.mp_receipt_recover_legacy(false);            -- aplica
--   select public.mp_receipt_recover_legacy(false, 'todas',
--          '<uuid da OF>');                                    -- aplica só uma OF
--
-- O filtro por OF (3º argumento) existe para a produção: com 25 OFs
-- e ~3.200 marcas, dá para recuperar OF a OF, conferindo o relatório
-- de cada uma antes de aplicar. Sem o filtro, a função aplica tudo
-- de uma vez.
--
-- ROLLBACK: select public.mp_receipt_rollback_legacy();
--            (ou supabase/rollback_058_mp_receipt.sql)
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Tabelas de auditoria da recuperação (sem policy: só o dono e
--    o service_role enxergam — o app não tem porta de entrada).
-- -------------------------------------------------------------
create table if not exists public.mp_recovery_backup_058 (
  production_process_id uuid primary key,
  order_item_id         uuid not null,
  status                text,
  quantity_planned      numeric,
  quantity_completed    numeric,
  started_at            timestamptz,
  completed_at          timestamptz,
  recovered_at          timestamptz not null default now()
);

create table if not exists public.mp_recovery_receipts_058 (
  receipt_id   uuid primary key,
  order_id     uuid not null,
  receipt_date date not null,
  recovered_at timestamptz not null default now()
);

alter table public.mp_recovery_backup_058 enable row level security;
alter table public.mp_recovery_receipts_058 enable row level security;

create index if not exists idx_mp_recovery_receipts_058_order
  on public.mp_recovery_receipts_058 (order_id);

-- -------------------------------------------------------------
-- 2) A recuperação
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
  -- Permissão: o dono da base (SQL Editor/CLI) passa direto; via
  -- PostgREST só ADMIN/GESTOR (a função é SECURITY DEFINER).
  if auth.uid() is not null and not public.has_role(array ['ADMIN', 'GESTOR']) then
    raise exception 'Sem permissao para recuperar as marcacoes de MP.';
  end if;

  if p_scope not in ('todas', 'manual') then
    raise exception 'Escopo invalido: use todas ou manual.';
  end if;

  -- ---------------------------------------------------------------
  -- 1) Estado legado de cada célula MP: o último evento que NÃO é
  --    do espelho (o espelho é derivado do fluxo novo).
  --
  --    Desempate: `created_at` é o timestamp da TRANSAÇÃO (várias
  --    linhas da mesma transação compartilham o valor), então o
  --    `ctid` desempata na ordem de inserção dentro da transação
  --    (o heap appenda no fim).
  -- ---------------------------------------------------------------
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

  -- Marcas legadas: estado legado = CONCLUIDO, de OF não cancelada
  -- (o fluxo novo recusa OF cancelada).
  drop table if exists _mp_legacy_marks;
  create temporary table _mp_legacy_marks on commit drop as
  select e.*
    from _mp_legacy_events e
    join public.orders o on o.id = e.order_id
   where e.new_status = 'CONCLUIDO'
     and o.status <> 'CANCELADO'
     and (p_scope = 'todas' or not e.cascata)
     and (p_order_id is null or e.order_id = p_order_id);

  -- ---------------------------------------------------------------
  -- 2) Alvos: a linha de recibo que restaura cada marca
  --    - item FILHO marcado        → ele mesmo
  --    - item PAI marcado          → todos os filhos (o verde do pai
  --                                   é o agregado dos filhos, 057)
  --    - item PAI sem filhos       → ele mesmo
  -- ---------------------------------------------------------------
  drop table if exists _mp_legacy_candidates;
  create temporary table _mp_legacy_candidates on commit drop as
  select m.order_item_id as target_id,
         oi.order_id,
         oi.parent_order_item_id,
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
         c.order_id,
         c.parent_order_item_id,
         m.marked_at,
         m.user_id,
         m.cascata,
         'expandido'::text as origem
    from _mp_legacy_marks m
    join public.order_items c on c.parent_order_item_id = m.order_item_id;

  -- Uma linha por alvo: a marca PRÓPRIA do item tem precedência
  -- sobre a expandida pelo pai (a data de quem marcou o item).
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

  -- ---------------------------------------------------------------
  -- 3) Saldo a receber por alvo + as proteções do fluxo novo
  --
  --    "falado_depois" = o fluxo novo ZEROU a célula depois da marca
  --    legada (evento de espelho com new_status = NAO_INICIADO). É o
  --    caso do recibo excluído à mão: recuperar ali desfaria a
  --    exclusão. O espelho que a PRÓPRIA recuperação grava (verde)
  --    não entra aqui — por isso rodar de novo não muda nada.
  -- ---------------------------------------------------------------
  drop table if exists _mp_legacy_lines;
  create temporary table _mp_legacy_lines on commit drop as
  with espelho as (
    -- último evento de espelho de cada célula MP
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
         public.mp_item_planned(t.target_id)  as planned_kg,
         public.mp_item_received(t.target_id) as received_kg,
         -- o fluxo novo já gerencia este item?
         (exists (select 1 from public.mp_receipt_items ri
                   where ri.order_item_id = t.target_id)) as tem_recibo_novo,
         -- o fluxo novo ZEROU este item depois da marca legada?
         (exists (
            select 1
              from public.production_processes pp
              join espelho x on x.production_process_id = pp.id
             where pp.order_item_id = t.target_id
               and x.new_status = 'NAO_INICIADO'
               and x.created_at >= t.marked_at
         )) as falado_depois,
         case
           when public.mp_item_planned(t.target_id) is null
             then case when public.mp_item_received(t.target_id) > 0 then 0 else 1 end
           else greatest(
             public.mp_item_planned(t.target_id) - public.mp_item_received(t.target_id),
             0
           )
         end as delta_kg
    from _mp_legacy_targets t;

  -- Data do PAI: a marca do pai quando ele tem, senão a última data
  -- dos filhos (o pai fecha quando TODOS os filhos fecham).
  drop table if exists _mp_legacy_parent_dates;
  create temporary table _mp_legacy_parent_dates on commit drop as
  select l.parent_order_item_id as parent_id,
         case
           when pm.marked_at is not null then pm.marked_at
           else max(l.marked_at)
         end as marked_at
    from _mp_legacy_lines l
    left join _mp_legacy_marks pm on pm.order_item_id = l.parent_order_item_id
   where l.parent_order_item_id is not null
   group by l.parent_order_item_id, pm.marked_at
  union
  -- pais marcados que não são pai de nenhum alvo (filhos protegidos)
  select m.order_item_id, m.marked_at
    from _mp_legacy_marks m
   where exists (
     select 1 from public.order_items c
      where c.parent_order_item_id = m.order_item_id
   );

  -- Itens/OFs afetados (backup, espelho e re-derivação).
  drop table if exists _mp_legacy_affected;
  create temporary table _mp_legacy_affected on commit drop as
  select distinct l.target_id as item_id, l.order_id
    from _mp_legacy_lines l
   where not l.tem_recibo_novo and not l.falado_depois
  union
  select distinct m.order_item_id, m.order_id
    from _mp_legacy_marks m
  union
  -- pais dos alvos: a célula do pai também é re-espelhada
  select distinct c.parent_order_item_id, c.order_id
    from _mp_legacy_lines l
    join public.order_items c on c.id = l.target_id
   where c.parent_order_item_id is not null
     and not l.tem_recibo_novo and not l.falado_depois;

  -- ---------------------------------------------------------------
  -- 4) Relatório (dry-run) ou aplicação
  -- ---------------------------------------------------------------
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
      'linhas', jsonb_build_object(
        'alvos', (select count(*) from _mp_legacy_lines),
        'expandidas', (select count(*) from _mp_legacy_lines where origem = 'expandido'),
        'com_recibo_novo', (select count(*) from _mp_legacy_lines where tem_recibo_novo),
        'falado_depois', (select count(*) from _mp_legacy_lines where falado_depois),
        'a_lancar', (select count(*) from _mp_legacy_lines
                       where delta_kg > 0 and not tem_recibo_novo and not falado_depois),
        'kg', (select coalesce(sum(delta_kg), 0) from _mp_legacy_lines
                where not tem_recibo_novo and not falado_depois)
      ),
      'por_of', (
        select coalesce(jsonb_agg(item order by item->>'of'), '[]'::jsonb)
          from (
            select jsonb_build_object(
                     'of', o.code,
                     'cliente', o.customer_name,
                     'marcas', (select count(*) from _mp_legacy_marks m where m.order_id = o.id),
                     'linhas', (select count(*) from _mp_legacy_lines l where l.order_id = o.id),
                     'kg', (select coalesce(sum(l.delta_kg), 0) from _mp_legacy_lines l
                             where l.order_id = o.id
                               and not l.tem_recibo_novo and not l.falado_depois),
                     'datas', (select coalesce(jsonb_agg(distinct to_char(l.marked_at at time zone 'UTC', 'YYYY-MM-DD')), '[]'::jsonb)
                                 from _mp_legacy_lines l where l.order_id = o.id)
                   ) as item
              from public.orders o
             where o.id in (select order_id from _mp_legacy_lines)
          ) s
      )
    ) into v_report;
    return v_report;
  end if;

  -- ---------------------------------------------------------------
  -- 5) Backup das células MP que podem mudar (uma vez só)
  -- ---------------------------------------------------------------
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

  -- ---------------------------------------------------------------
  -- 6) Um recibo por (OF, data da marcação)
  -- ---------------------------------------------------------------
  for r in
    select l.order_id,
           (l.marked_at at time zone 'UTC')::date as receipt_date,
           (array_agg(l.user_id order by l.marked_at))[1] as user_id,
           count(*) as linhas,
           sum(l.delta_kg) as kg
      from _mp_legacy_lines l
     where l.delta_kg > 0
       and not l.tem_recibo_novo
       and not l.falado_depois
     group by l.order_id, (l.marked_at at time zone 'UTC')::date
  loop
    insert into public.mp_receipts (order_id, receipt_date, notes, created_by)
    values (
      r.order_id,
      r.receipt_date,
      'Recuperacao 058 - marcacao de MP do historico (legado)',
      r.user_id
    )
    returning id into v_receipt;

    insert into public.mp_recovery_receipts_058 (receipt_id, order_id, receipt_date)
    values (v_receipt, r.order_id, r.receipt_date);

    insert into public.mp_receipt_items (mp_receipt_id, order_item_id, quantity_kg)
    select v_receipt, l.target_id, l.delta_kg
      from _mp_legacy_lines l
     where l.order_id = r.order_id
       and (l.marked_at at time zone 'UTC')::date = r.receipt_date
       and l.delta_kg > 0
       and not l.tem_recibo_novo
       and not l.falado_depois;
  end loop;

  -- ---------------------------------------------------------------
  -- 7) Data original do recebimento (a que a lista mostra) —
  --    gravada ANTES do espelho, que preserva via coalesce.
  -- ---------------------------------------------------------------
  update public.production_processes pp
     set completed_at = coalesce(pp.completed_at, l.marked_at)
    from _mp_legacy_lines l
   where pp.order_item_id = l.target_id
     and pp.process_id = (select id from public.processes where code = 'MP')
     and l.delta_kg > 0
     and not l.tem_recibo_novo
     and not l.falado_depois;

  update public.production_processes pp
     set completed_at = coalesce(pp.completed_at, d.marked_at)
    from _mp_legacy_parent_dates d
   where pp.order_item_id = d.parent_id
     and pp.process_id = (select id from public.processes where code = 'MP');
  -- ---------------------------------------------------------------
  -- 8) Espelho (056/057): item + pai
  --    O usuário do evento do espelho é quem rodou a recuperação
  --    (PostgREST) ou quem marcou (SQL Editor) — o RLS de
  --    production_events exige user_id = auth.uid().
  -- ---------------------------------------------------------------
  for r in
    select distinct l.target_id,
           coalesce(auth.uid(), l.user_id) as user_id
      from _mp_legacy_lines l
     where not l.tem_recibo_novo
       and not l.falado_depois
  loop
    perform public.mp_receipt_sync_item(r.target_id, r.user_id);
  end loop;

  for r in
    select distinct l.parent_order_item_id,
           coalesce(auth.uid(), l.user_id) as user_id
      from _mp_legacy_lines l
     where l.parent_order_item_id is not null
       and not l.tem_recibo_novo
       and not l.falado_depois
  loop
    perform public.mp_receipt_sync_parent(r.parent_order_item_id, r.user_id);
  end loop;

  -- Pais marcados: o agregado dos filhos (o verde do pai).
  for r in
    select distinct m.order_item_id,
           coalesce(auth.uid(), m.user_id) as user_id
      from _mp_legacy_marks m
     where exists (
       select 1 from public.order_items c
        where c.parent_order_item_id = m.order_item_id
     )
  loop
    perform public.mp_receipt_sync_parent(r.order_item_id, r.user_id);
  end loop;

  -- ---------------------------------------------------------------
  -- 9) Re-deriva o status de item e de OF (mesma regra do app)
  -- ---------------------------------------------------------------
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
      select o2.id,
             case
               when count(*) = 0 then 'PLANEJADO'
               when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
               when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
               else 'PLANEJADO'
             end as derived
        from public.orders o2
        join public.order_items oi on oi.order_id = o2.id
       where o2.id in (select order_id from _mp_legacy_affected)
       group by o2.id
    ) d
   where o.id = d.id
     and o.status <> 'CANCELADO'
     and o.status is distinct from d.derived;

  -- ---------------------------------------------------------------
  -- 10) Relatório final
  -- ---------------------------------------------------------------
  select jsonb_build_object(
    'modo', 'aplicado',
    'escopo', p_scope,
    'of_filtro', p_order_id,
    'marcas', jsonb_build_object(
      'itens', (select count(*) from _mp_legacy_marks),
      'manual', (select count(*) from _mp_legacy_marks where not cascata),
      'cascata', (select count(*) from _mp_legacy_marks where cascata)
    ),
    'linhas', jsonb_build_object(
      'alvos', (select count(*) from _mp_legacy_lines),
      'expandidas', (select count(*) from _mp_legacy_lines where origem = 'expandido'),
      'com_recibo_novo', (select count(*) from _mp_legacy_lines where tem_recibo_novo),
      'falado_depois', (select count(*) from _mp_legacy_lines where falado_depois),
      'a_lancar', (select count(*) from _mp_legacy_lines
                     where delta_kg > 0 and not tem_recibo_novo and not falado_depois),
      'kg', (select coalesce(sum(delta_kg), 0) from _mp_legacy_lines
              where not tem_recibo_novo and not falado_depois)
    ),
    'recibos', jsonb_build_object(
      'criados', (select count(*) from public.mp_recovery_receipts_058),
      'itens', (select count(*) from public.mp_receipt_items ri
                  where ri.mp_receipt_id in (select receipt_id from public.mp_recovery_receipts_058))
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
-- 3) Rollback: apaga os recibos da recuperação, restaura as
--    células MP do backup e re-deriva os status.
--    (o histórico de eventos é append-only e fica como está)
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

  -- Itens/OFs que os recibos da recuperação tocaram.
  drop table if exists _mp_rollback_items;
  create temporary table _mp_rollback_items on commit drop as
  select distinct ri.order_item_id as item_id, r.order_id
    from public.mp_recovery_receipts_058 rec
    join public.mp_receipts r on r.id = rec.receipt_id
    join public.mp_receipt_items ri on ri.mp_receipt_id = r.id;

  select count(*) into v_recibos from public.mp_recovery_receipts_058;
  select count(*) into v_celulas from public.mp_recovery_backup_058;

  -- Apaga os recibos (as linhas caem por cascade).
  delete from public.mp_receipts r
   using public.mp_recovery_receipts_058 rec
   where r.id = rec.receipt_id;

  -- Restaura as células MP do backup.
  update public.production_processes pp
     set status = b.status,
         quantity_planned = b.quantity_planned,
         quantity_completed = b.quantity_completed,
         started_at = b.started_at,
         completed_at = b.completed_at
    from public.mp_recovery_backup_058 b
   where b.production_process_id = pp.id;

  -- Re-deriva o status de item e de OF (mesma regra do app).
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
        from (select distinct item_id from _mp_rollback_items) t
        join public.order_items oi on oi.id = t.item_id
    ) d
   where oi.id = d.item_id
     and oi.status <> 'CANCELADO'
     and oi.status is distinct from d.derived;

  update public.orders o
     set status = d.derived
    from (
      select o2.id,
             case
               when count(*) = 0 then 'PLANEJADO'
               when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
               when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
               else 'PLANEJADO'
             end as derived
        from public.orders o2
        join public.order_items oi on oi.order_id = o2.id
       where o2.id in (select order_id from _mp_rollback_items)
       group by o2.id
    ) d
   where o.id = d.id
     and o.status <> 'CANCELADO'
     and o.status is distinct from d.derived;

  -- Limpa a auditoria da recuperação.
  delete from public.mp_recovery_receipts_058;
  delete from public.mp_recovery_backup_058;

  select jsonb_build_object(
    'modo', 'rollback',
    'recibos_apagados', v_recibos,
    'celulas_restauradas', v_celulas,
    'itens', (select count(*) from _mp_rollback_items)
  ) into v_report;

  return v_report;
end;
$$;

revoke execute on function public.mp_receipt_rollback_legacy() from public;
revoke execute on function public.mp_receipt_rollback_legacy() from anon;
grant execute on function public.mp_receipt_rollback_legacy() to authenticated;
grant execute on function public.mp_receipt_rollback_legacy() to service_role;
