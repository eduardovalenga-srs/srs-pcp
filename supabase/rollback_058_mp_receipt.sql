-- =============================================================
-- ROLLBACK da recuperação das marcações de MP (migração 058)
--
-- Desfaz o que `mp_receipt_recover_legacy(false)` fez:
--   1. apaga os recibos criados pela recuperação (as linhas caem
--      por cascade — a tabela `mp_receipt_items` referencia
--      `mp_receipts` com ON DELETE CASCADE);
--   2. restaura as células MP do backup (status, quantidades e
--      datas que estavam antes da recuperação);
--   3. re-deriva o status de item e de OF (mesma regra do app);
--   4. limpa a auditoria da recuperação.
--
-- O histórico de `production_events` é append-only por projeto e
-- NÃO é apagado (os eventos do espelho ficam como rastro).
--
-- USO (SQL Editor ou CLI):
--   psql "$SUPABASE_DB_URL" -f supabase/rollback_058_mp_receipt.sql
--   -- ou colar o conteúdo no SQL Editor do Supabase
--
-- OBSERVAÇÃO: rode `select public.mp_receipt_rollback_legacy();`
-- (o mesmo efeito, com relatório JSON) — este arquivo é a versão
-- copiável/standalone, para quem preferir não depender da função.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1) Itens/OFs que os recibos da recuperação tocaram
-- -------------------------------------------------------------
create temporary table _mp_rollback_items on commit drop as
select distinct ri.order_item_id as item_id, r.order_id
  from public.mp_recovery_receipts_058 rec
  join public.mp_receipts r on r.id = rec.receipt_id
  join public.mp_receipt_items ri on ri.mp_receipt_id = r.id;

-- -------------------------------------------------------------
-- 2) Apaga os recibos da recuperação (as linhas caem por cascade)
-- -------------------------------------------------------------
delete from public.mp_receipts r
 using public.mp_recovery_receipts_058 rec
 where r.id = rec.receipt_id;

-- -------------------------------------------------------------
-- 3) Restaura as células MP do backup
-- -------------------------------------------------------------
update public.production_processes pp
   set status = b.status,
       quantity_planned = b.quantity_planned,
       quantity_completed = b.quantity_completed,
       started_at = b.started_at,
       completed_at = b.completed_at
  from public.mp_recovery_backup_058 b
 where b.production_process_id = pp.id;

-- -------------------------------------------------------------
-- 4) Re-deriva o status de item e de OF (mesma regra do app)
-- -------------------------------------------------------------
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

-- -------------------------------------------------------------
-- 5) Limpa a auditoria da recuperação
-- -------------------------------------------------------------
delete from public.mp_recovery_receipts_058;
delete from public.mp_recovery_backup_058;

-- -------------------------------------------------------------
-- 6) Relatório
-- -------------------------------------------------------------
select jsonb_build_object(
  'modo', 'rollback',
  'itens', (select count(*) from _mp_rollback_items),
  'recibos_restantes',
    (select count(*) from public.mp_receipts
      where coalesce(notes, '') like 'Recuperacao 058%')
) as rollback_058;

commit;
