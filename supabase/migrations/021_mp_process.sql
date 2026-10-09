-- -------------------------------------------------------------
-- 021) Processo MP (matéria-prima) — coluna controlável
--
-- A antiga coluna derivada INICIO F1 vira o processo MP: coluna
-- real da gestão de entregas, com célula clicável como as demais
-- (situação, quantidades, observações e histórico).
--
-- REGRA DE SITUAÇÃO: o MP aceita APENAS NAO_INICIADO e CONCLUIDO
-- (portão de duas posições — nunca "em andamento", "bloqueado" ou
-- "não aplicável"). A folha de edição lista só essas duas opções e
-- o serviço rejeita as demais; a restrição por processo vive em
-- lib/utils/production.ts (allowedProcessStatuses).
--
-- display_order 5 (< 10 = LASER): o MP fica na PRIMEIRA coluna de
-- processos, exatamente onde a INICIO F1 aparecia. A janela prevista
-- é calculada na leitura (process-schedule) e, por vir antes da
-- LASER, não desloca as janelas dos demais processos.
--
-- Idempotente: o insert usa on conflict (code) e o backfill nunca
-- altera status existente.
-- -------------------------------------------------------------
insert into public.processes (code, name, display_order, location, duration_days, active)
values ('MP', 'MP', 5, null, 1, true)
on conflict (code) do update
  set display_order = excluded.display_order,
      active = excluded.active;

-- Backfill dos itens já existentes, preservando a situação derivada
-- (deriveOrderItemStatus): item que já não tem pendências recebe
-- MP CONCLUIDO — nenhum status de item muda de valor; os demais
-- nascem NAO_INICIADO. Escopo igual ao backfill_process (010):
-- todo item, sem filtrar processo ativo.
insert into public.production_processes (order_item_id, process_id, status)
select oi.id,
       p.id,
       case
         when not exists (
           select 1
             from public.production_processes pp
            where pp.order_item_id = oi.id
              and pp.status <> 'NAO_APLICAVEL'
              and pp.status <> 'CONCLUIDO'
         ) then 'CONCLUIDO'
         else 'NAO_INICIADO'
       end
  from public.order_items oi
  cross join public.processes p
 where p.code = 'MP'
   and p.active
   and not exists (
     select 1
       from public.production_processes pp
      where pp.order_item_id = oi.id
        and pp.process_id = p.id
   );
