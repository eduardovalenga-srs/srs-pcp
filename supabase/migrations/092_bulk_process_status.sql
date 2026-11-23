-- 092 — Lote de processos: refresh de status em UMA chamada + guard do
-- trigger de EXP.
--
-- Contexto: concluir um processo em lote (ex.: ACAB em uma OF de 20 itens)
-- chamava `refresh_order_statuses` uma vez por item — e cada chamada varria
-- TODOS os itens da OF para re-derivar o status do pedido. Além disso, o
-- trigger de expedição resequenciava a fila a cada linha EXP concluída,
-- mesmo quando várias linhas fechavam a mesma OF no mesmo lote.
--
-- 1) `refresh_order_statuses_bulk` recebe o status já derivado (a regra
--    continua no serviço/TS) e grava todos os itens de uma vez, rederivando
--    cada OF afetada UMA única vez. OF CANCELADO continua intocada.
-- 2) O trigger de EXP virou um trigger de STATEMENT com tabelas de
--    transição: um UPDATE em lote resequencia a fila no máximo uma vez,
--    em vez de uma vez por linha EXP concluída.

-- -------------------------------------------------------------
-- 1) refresh_order_statuses_bulk
-- -------------------------------------------------------------
create or replace function public.refresh_order_statuses_bulk(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected integer;
  v_updated integer;
begin
  if not public.has_role(array ['ADMIN', 'GESTOR', 'OPERADOR_F1', 'OPERADOR_F2']) then
    raise exception 'Sem permissão para atualizar o status do item.';
  end if;

  if jsonb_typeof(coalesce(p_items, 'null'::jsonb)) <> 'array' then
    raise exception 'Payload de status inválido.';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as r(item_id uuid, status text)
     where r.item_id is null
        or r.status is null
        or r.status not in ('PLANEJADO', 'EM_PRODUCAO', 'CONCLUIDO', 'CANCELADO')
  ) then
    raise exception 'Status de item inválido.';
  end if;

  select count(distinct r.item_id)
    into v_expected
    from jsonb_to_recordset(p_items) as r(item_id uuid, status text);

  if v_expected = 0 then
    return;
  end if;

  update public.order_items oi
     set status = r.status, updated_at = now()
    from jsonb_to_recordset(p_items) as r(item_id uuid, status text)
   where oi.id = r.item_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'Item de pedido não encontrado.';
  end if;

  -- Mesma precedência de deriveOrderStatus (camada de serviço):
  -- todos concluídos -> CONCLUIDO; algum em produção -> EM_PRODUCAO;
  -- senão Em espera. Recalcula cada OF uma única vez.
  with affected as (
    select distinct oi.order_id
      from public.order_items oi
      join jsonb_to_recordset(p_items) as r(item_id uuid, status text)
        on oi.id = r.item_id
  ),
  derived as (
    select oi.order_id,
           case
             when bool_and(oi.status = 'CONCLUIDO') then 'CONCLUIDO'
             when bool_or(oi.status = 'EM_PRODUCAO') then 'EM_PRODUCAO'
             else 'PLANEJADO'
           end as next_status
      from public.order_items oi
     where oi.order_id in (select order_id from affected)
     group by oi.order_id
  )
  update public.orders o
     set status = d.next_status, updated_at = now()
    from derived d
   where o.id = d.order_id
     and o.status <> 'CANCELADO'
     and o.status is distinct from d.next_status;
end;
$$;

revoke execute on function public.refresh_order_statuses_bulk(jsonb) from anon;
grant execute on function public.refresh_order_statuses_bulk(jsonb) to authenticated;

-- -------------------------------------------------------------
-- 2) Trigger de EXP: uma resequência por STATEMENT, não por linha
-- -------------------------------------------------------------
-- O trigger de 083 era FOR EACH ROW: concluir o EXP de 20 itens de uma vez
-- disparava `resequence_expedition_queue` 20 vezes (e cada chamada varre a
-- fila inteira). Como é um AFTER trigger, todas as linhas do UPDATE já
-- estão gravadas quando ele roda — nenhuma checagem por linha consegue
-- saber qual foi a "última". A solução é um trigger de STATEMENT com
-- tabelas de transição: roda UMA vez por UPDATE e resequencia no máximo
-- uma vez.
create or replace function public.production_process_expedition_resequence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_any_concluded boolean;
begin
  -- Alguma OF do statement concluiu o EXP e ficou totalmente expedida?
  -- Mesma condição do WHEN antigo (a situação mudou para CONCLUIDO), mas
  -- avaliada uma vez por OF do lote.
  select exists (
    select 1
      from (
        select distinct oi.order_id
          from new_rows nr
          join old_rows orw on orw.id = nr.id
          join public.processes p on p.id = nr.process_id
          join public.order_items oi on oi.id = nr.order_item_id
         where p.code = 'EXP'
           and orw.status is distinct from nr.status
           and nr.status = 'CONCLUIDO'
      ) changed
     where public.order_exp_concluded(changed.order_id)
  )
  into v_any_concluded;

  if v_any_concluded then
    perform public.resequence_expedition_queue();
  end if;

  return null;
end;
$$;

revoke execute on function public.production_process_expedition_resequence() from public, anon, authenticated;

drop trigger if exists production_processes_resequence_expedition on public.production_processes;
create trigger production_processes_resequence_expedition
  after update on public.production_processes
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.production_process_expedition_resequence();
