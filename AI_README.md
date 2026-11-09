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
