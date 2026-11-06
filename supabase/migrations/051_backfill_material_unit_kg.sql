-- -------------------------------------------------------------
-- 051) Backfill — matéria-prima importada por PLANILHA vira KG
--
-- SINTOMA: na lista de devolução do detalhe do romaneio, a coluna
-- "Peso (kg)" só aparecia para as OFs criadas pelo IMPORTADOR DE
-- PDF, que grava a matéria-prima com QUANTIDADE = PESO e unidade
-- "KG". As três importações de PLANILHA gravavam a QUANTIDADE DE
-- PEÇAS com unidade fixa "UN" — e como só as unidades KG/G entram
-- no peso (weightKgOf), aquelas OFs mostravam "un" e "—" no lugar do
-- peso. Parecia "por cliente" porque a A1 Engeharia veio de PDF e as
-- demais vieram de planilha.
--
-- CORREÇÃO em duas partes:
--   1) os parsers de planilha já gravam em KG quando o arquivo traz
--      peso (materialQuantityAndUnit em src/lib/import/of-structure.ts)
--      — vale para as próximas importações;
--   2) ESTA migração corrige o HISTÓRICO já gravado: nas linhas cujo
--      ITEM tem peso total, a matéria-prima passa de "UN" (peças) para
--      "KG" com esse peso — a MESMA fonte que o resto da tela já usava
--      no fallback (loadWeightKg = quantidade × peso unitário).
--
-- Guardas (todas idempotentes — depois de virar "KG" a linha não casa
-- mais nenhuma):
--   * só itens com total_weight_kg > 0 (sem peso continua em peças);
--   * só a linha cuja QUANTIDADE do material é a QUANTIDADE DO ITEM —
--     é exatamente como as três importações de planilha escrevem;
--     material lançado MANUALMENTE em "UN" (parafuso, cx…) não tem
--     essa relação e fica intocado;
--   * só itens com UMA única linha de matéria-prima — com várias não
--     dá para saber a fatia de peso de cada uma.
-- -------------------------------------------------------------

update public.order_item_materials m
set unit = 'KG',
    quantity = i.total_weight_kg
from public.order_items i
where i.id = m.order_item_id
  and m.unit = 'UN'
  and m.quantity = i.quantity
  and i.total_weight_kg is not null
  and i.total_weight_kg > 0
  and not exists (
    select 1
    from public.order_item_materials other
    where other.order_item_id = i.id
      and other.id <> m.id
  );
