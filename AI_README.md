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

## 🚛 Fluxo do Romaneio (Expedição)
- **Status:** `ABERTO` ➔ `CONFERIDO` ➔ `CONFIRMADO` (e `CANCELADO`).
- **Regra de Baixa:** A expedição não decrementa `order_items.quantity`. O saldo expedido é derivado dinamicamente somando as cargas dos romaneios `CONFIRMADOS`.
- **Limitação:** Máximo de 1 romaneio `ABERTO` por OF.

## 🔐 Permissões (Roles)
- Perfis: `ADMIN`, `GESTOR`, `OPERADOR`, `VISUALIZADOR`.
- Regra rígida: Toda mutação precisa validar capacidades (`lib/auth/permissions.ts`) nas Server Actions antes de tocar no banco.
