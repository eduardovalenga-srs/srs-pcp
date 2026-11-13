-- -------------------------------------------------------------
-- 065) QTDE "por conjunto": escala dos FILHOS já importados
--
-- Problema: nos formatos em que a QTDE da linha da PEÇA é POR
-- CONJUNTO/POSIÇÃO (lista de peças e conjuntos da Rondon e as 3
-- posições da Brafer da Lista de Composição), a importação gravava a
-- quantidade por conjunto sem multiplicar pela QTDE do pai. O peso
-- TOTAL do pai estava certo (trigger 023 = qtd × unit, e o unit já
-- somava Σ filho unit × qtd), mas os FILHOS gravavam 1 conjunto —
-- a Fábrica 1 (Σ dos filhos) ficava inferior à Gestão de OF/Fábrica 2.
--
-- Correção (o importador já foi corrigido — ver of-structure-parts.ts
-- e of-structure.ts; aqui se corrige o HISTÓRICO):
--   1. filhos: quantity × QTDE do pai (trigger 023 recalcula o total);
--   2. material dos filhos: quantity × QTDE do pai (KG da linha era
--      por conjunto; UN é a qtd de peças por conjunto);
--   3. espelho MP (production_processes.quantity_planned, processo
--      MP): × QTDE do pai nos FILHOS e nos PAIS afetados — o espelho
--      do pai é Σ dos filhos (057), então escala junto. O
--      quantity_completed (kg já recebido) NÃO muda: recebeu-se o que
--      se recebeu; o efeito esperado é MP parcial onde só entrou 1
--      conjunto.
--
-- ASSINATURA idempotente (só entra quem precisa): raiz com QTDE > 1,
-- todos os filhos com peso, e |Σ(filhos) × qtd − total_pai| ≤
-- max(1%, 0,1 kg) — a assinatura do "por conjunto". Re-executar após
-- a correção não encontra mais ninguém (Σ filhos já escalado passa
-- longe do total do pai).
--
-- Guardas (hoje nenhuma delas exclui ninguém — verificado em
-- produção antes desta migração):
--   * filho em romaneio (qualquer status) → raiz fica de fora (a
--     baixa física já usa a quantidade antiga);
--   * raiz em romaneio CONFIRMADO → fica de fora (expedição já
--     baixada; o saldo fração da 054 escalaria os filhos em dobro);
--   * raiz com filho sem peso → fica de fora (assinatura não fecha);
--   * PAIS NUNCA são tocados: quantity/total do pai já estavam
--     corretos; só o espelho MP do pai escala (item 3).
--
-- Estrutura de 2 níveis (sem netos — verificado); materiais e
-- processos dos pais intocados.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1) Raízes afetadas + a QTDE de conjunto de cada uma
-- -------------------------------------------------------------
create temporary table afetuados_por_conjunto as
select p.id as parent_id,
       p.quantity as qtd_conjunto
  from public.order_items p
 where p.parent_order_item_id is null
   and p.quantity > 1
   and p.total_weight_kg is not null
   -- todos os filhos com peso (unit e total derivado dele)
   and not exists (
         select 1
           from public.order_items c
          where c.parent_order_item_id = p.id
            and (c.unit_weight_kg is null or c.total_weight_kg is null)
       )
   and exists (
         select 1
           from public.order_items c
          where c.parent_order_item_id = p.id
       )
   -- assinatura: Σ (peso por conjunto dos filhos) × qtd = total do pai
   and abs(
         coalesce(
           (select sum(c.total_weight_kg)
              from public.order_items c
             where c.parent_order_item_id = p.id),
           0
         ) * p.quantity - p.total_weight_kg
       ) <= greatest(p.total_weight_kg * 0.01, 0.1)
   -- filho já expedido: não escala (baixa física com a qtd antiga)
   and not exists (
         select 1
           from public.order_items c
           join public.romaneio_items ri on ri.order_item_id = c.id
          where c.parent_order_item_id = p.id
       )
   -- raiz já expedida (CONFIRMADO): não escala
   and not exists (
         select 1
           from public.romaneio_items ri
           join public.romaneios r on r.id = ri.romaneio_id
          where ri.order_item_id = p.id
            and r.status = 'CONFIRMADO'
       );

-- -------------------------------------------------------------
-- 2) Filhos: quantidade × QTDE do pai (023 recalcula o total)
-- -------------------------------------------------------------
update public.order_items c
   set quantity = c.quantity * a.qtd_conjunto
  from afetuados_por_conjunto a
 where c.parent_order_item_id = a.parent_id;

-- -------------------------------------------------------------
-- 3) Material dos filhos: × QTDE do pai (KG e UN eram por conjunto)
-- -------------------------------------------------------------
update public.order_item_materials m
   set quantity = m.quantity * a.qtd_conjunto
  from afetuados_por_conjunto a
  join public.order_items c on c.parent_order_item_id = a.parent_id
 where m.order_item_id = c.id;

-- -------------------------------------------------------------
-- 4) Espelho MP (quantity_planned, processo MP): × QTDE do pai nos
--    FILHOS e nos PAIS afetados — o do pai é Σ dos filhos (057), o
--    derivado (mp_item_planned, 059) já sai escalado pelos itens
--    corrigidos acima; aqui se atualiza o valor GRAVADO para não
--    divergir. quantity_completed (kg recebidos) fica como está.
-- -------------------------------------------------------------
update public.production_processes pp
   set quantity_planned = pp.quantity_planned * a.qtd_conjunto
  from afetuados_por_conjunto a
  join public.order_items i
    on i.id = a.parent_id
    or i.parent_order_item_id = a.parent_id
 where pp.order_item_id = i.id
   and exists (
         select 1
           from public.processes pr
          where pr.id = pp.process_id
            and pr.code = 'MP'
       )
   and pp.quantity_planned is not null;

-- -------------------------------------------------------------
-- 5) Limpa a tabela de trabalho
-- -------------------------------------------------------------
drop table afetuados_por_conjunto;
