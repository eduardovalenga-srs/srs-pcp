# Contexto do Projeto para IA - Imperatriz

## 🚀 Arquitetura & Stack
- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript.
- **Arquitetura de Pastas:** `src/lib/actions` (Escrita), `src/lib/services` (Regras), `src/lib/repositories` (Dados/Supabase).
- **Banco & Infra:** Supabase (PostgreSQL + RLS) hospedado na Vercel.

## 📊 Regras de Dados & Derivações (Não recalcular no Node)
1. **Status Derivados:** O status do item/pedido é derivado no banco via RPC `refresh_order_statuses`. 
   - Todos concluídos -> `CONCLUIDO`
   - OP em branco -> `PLANEJADO`
   - OP preenchida -> `EM_PRODUCAO`
2. **Pesos Derivados:** O peso total (`total_weight_kg`) é quantidade × peso unitário, calculado automaticamente via TRIGGER no Postgres (Migração 023). Não passe isso via código Node.
3. **Cadeia de Processos:** Definida dinamicamente pela tabela `processes`. Todo item possui registros em `production_processes`.
4. **Fábrica 1 vs Fábrica 2:** 
   - A rota `/fabrica-1` agrupa itens filhos por código dentro da mesma OF (RPC `get_child_item_groups`).
   - A rota `/fabrica-2` lê itens pai linha por linha (RPC `get_production_rows`).
5. **Peso do Romaneio (050):** a coluna **Peso** da lista `/romaneio` (e do filtro por faixa) e a exportação `.xlsx` usam a MESMA fonte: **Σ da coluna "Utilizada" só nas linhas em unidade de peso** (KG vale; G ÷ 1000), calculado nas RPCs `get_romaneios_page`/`get_romaneio_summary`. Sem nenhuma linha em KG/G cai no Σ qtd × peso unitário dos itens; se algum item não tem peso, o peso é NULL (fora do filtro, não conta como 0). No detalhe e na ficha o mesmo número é derivado ao vivo (`resolveRomaneioWeights`) — nunca grave peso à mão.
6. **Unidade da Matéria-prima (051):** `order_item_materials.unit` nasce **KG com o PESO TOTAL do item** quando a origem traz peso — importador de PDF (`of-pdf.ts`) e os três importadores de PLANILHA (`of-structure.ts`, `of-structure-parts.ts`, `of-structure-project.ts`, todos via `materialQuantityAndUnit`); sem peso, a QUANTIDADE DE PEÇAS em "UN" (trocar só o rótulo mentiria sobre a unidade). A lista de devolução do romaneio só calcula peso por linha em KG/G (`weightKgOf`), por isso "UN" aparecia como "—" e parecia problema "por cliente". A migração **051** corrigiu o histórico: só itens com `total_weight_kg > 0` e **uma única** linha de MP cuja quantidade é a do item.
7. **Recebimento de MP por item FILHO (057):** `/recebimento-mp` lista os **itens filhos** da OF (+ itens pai **sem** filhos, material direto no pai) e grava kg por linha — `save_mp_receipt` **rejeita** raiz que tem filho e espelha filho + pai (`mp_receipt_sync_item` / `mp_receipt_sync_parent`). A **célula MP do pai** (coluna das listas) é o AGREGADO dos filhos: verde/`CONCLUIDO` só quando **todos** os filhos estão `TOTAL`; `quantity_completed` = Σ dos filhos + recibos legados já lançados no pai; `quantity_planned` = Σ dos planejados dos filhos (**null** se algum filho não tem peso) — pior caso entre os filhos, mesma regra do `aggregateMpReceipts` (TS). Pai **sem** filhos mantém a regra própria (peso/recebimento do item). A pendência do seletor (`get_mp_receipt_customers`) conta essas mesmas linhas elegíveis.
8. **Recuperação das marcas de MP perdidas na 057 (058):** a 057 (§7, backfill silencioso) recalculou a célula MP dos PAIS a partir dos recibos — que estavam vazios — e **zerou** as marcas manuais, sem deixar rastro. A **058** as recupera do **histórico** (`production_events`): `mp_receipt_recover_legacy(p_dry_run, p_scope, p_order_id)` lê o **último evento de cada processo MP que não é do espelho** (evento de espelho = o fluxo novo já respondeu pela célula) e devolve o dado na forma **nova: RECIBOS** (a única forma de a célula ficar verde de novo — mexer direto em `production_processes` seria apagado no próximo recebimento). Escopo: `'todas'` (padrão) ou `'manual'` (só as marcas feitas à mão; as de cascata `Concluído automaticamente ao concluir X` vinham da regra 62 antiga, em que o MP era pré-requisito de todo processo). Um item marcado vira recibo dos **filhos** (o verde do pai é o agregado deles, 057) e o kg é o **saldo** que falta (planejado − recebido; 1 kg quando o item não tem peso). Um recibo por (OF, data da marcação), com a data original preservada em `completed_at`. **Idempotente** (o saldo é calculado sobre o que já foi recebido) e com **rollback** (`mp_receipt_rollback_legacy` / `supabase/rollback_058_mp_receipt.sql`) que apaga os recibos da recuperação e restaura as células do backup (`mp_recovery_backup_058`).
9. **Datas da coluna MP (prevista × efetiva):** são **duas datas diferentes** e nenhuma delas é "gravada" no lugar da outra. A **PREVISTA** (janela do processo, "quando deveríamos receber a MP") é **DERIVADA a cada leitura** por `computeProcessSchedule()` — conta dias úteis de trás para frente a partir da `delivery_date` do pedido, com o catálogo e pulando `NAO_APLICAVEL`; por isso ela **nunca foi perdida** pela 057 e **não precisa** de restauração. A **EFETIVA** ("recebida em DD/MM") é o `production_processes.completed_at` gravado pelo recebimento (056/057) e é o que a 058 restaura. As três telas mostram as duas na célula MP: Fábrica 1 (chip herdado do pai), Fábrica 2 e **Gestão de OF** (desktop + card mobile). A Gestão de OF é a única delas cuja coluna MP é **somente leitura** (o recebimento se registra em `/recebimento-mp`). A prevista vencida (início anterior a hoje) fica em vermelho — exceto processo `CONCLUIDO` (regra em `utils/production`). Coberto por `tests/production-mp-column.test.ts`.

## 🚛 Fluxo do Romaneio (Expedição)
- **Status:** `ABERTO` ➔ `CONFERIDO` ➔ `CONFIRMADO` (e `CANCELADO`).
- **Regra de Baixa:** A expedição não decrementa `order_items.quantity`. O saldo expedido é derivado dinamicamente somando as cargas dos romaneios `CONFIRMADOS`.
- **Regra 054 (Baixa derivada nos totais):** emitir a nota no fim do romaneio (`confirm_romaneio`) **não grava contador nenhum** — os totais de QUANTIDADE e PESO exibidos viram o **saldo pendente**, derivado a cada leitura (cancelar restaura sozinho):
  - **Itens raiz:** `saldo_qtd = greatest(qtd − Σ cargas, 0)` e `saldo_peso = greatest(total_weight_kg − Σ cargas × peso unit., 0)` (`total_weight_kg` null permanece null → "—"). A base é **qtd expedida × peso unitário do item** — nunca o peso da regra 050.
  - **Itens filhos (Fábrica 1):** valor planejado × **fração pendente do pai raiz** (`saldo_pai/qtd_pai`); pai ausente/não raiz/planned ≤ 0 ⇒ fração 1 (mantém o valor cheio).
  - Fonte única: helper SQL `romaneio_shipped_by_item()` (reuso do repositório `listConfirmedQuantityByItem*` no Node). Valida nas RPCs `get_production_rows` (F2), `get_production_rows_by_order` (Gestão), `get_child_item_groups`/`get_child_items_totals` (F1) e `get_production_stats` (Dashboard), que também **filtram os cards por saldo > 0** (`has_pending`). Fórmulas espelhadas em `src/lib/utils/shipping.ts` (só exibição — nunca persistir). `order_items.quantity`/`total_weight_kg` seguem sendo o **planejado** (a edição cadastral usa esses). Emisão/cancelamento revalida `/dashboard`, `/gestao-entregas`, `/fabrica-1`, `/fabrica-2`, `/pedidos` e o detalhe da OF.
- **Limitação:** Máximo de 1 romaneio `ABERTO` por OF.
- **Devolução de MP:** a **"Utilizada na produção" é DERIVADA** dos itens da carga (alocação proporcional da OF) e recalcula a cada tecla — é somente leitura no detalhe e na ficha. O único lançamento é a **"Recebida"**, na ficha de conferência, e ela **nunca fica abaixo da utilizada** (`received = max(gravado, utilizada)` no merge; saldo zera). O **Peso da carga** fecha com essa mesma utilizada (regra 5 acima).

## 🔐 Permissões (Roles)
- Perfis: `ADMIN`, `GESTOR`, `OPERADOR_F1`, `OPERADOR_F2`, `VISUALIZADOR`.
  - **055:** o antigo `OPERADOR` virou dois papéis por fábrica — `OPERADOR_F1` é o
    operador da Fábrica 1 (comportamento idêntico ao antigo `OPERADOR`; os usuários
    existentes foram migrados para ele) e `OPERADOR_F2` é restrito à Fábrica 2
    (menu + página + atualização de status; sem dashboard, RH, romaneio, gestão
    de OF e sem a Fábrica 1). Home por papel: `homePathFor` manda F1/VISUALIZADOR
    para `/fabrica-1` e F2 para `/fabrica-2`.
- Regra rígida: Toda mutação precisa validar capacidades (`lib/auth/permissions.ts`) nas Server Actions antes de tocar no banco.
