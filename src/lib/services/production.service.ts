import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { PROCESS_STATUS_LABELS, type ProcessStatus } from "@/lib/constants/production";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { ProductionEvent, ProductionFilters, ProductionOrderResult, ProductionResult, ProductionStats, ProcessDefinition } from "@/lib/types/production";
import {
  getActiveProcesses,
  getEventsByItemId,
  getOrderProcessTargets,
  getProductionOrderRows,
  getProductionProcessById,
  getProductionRows,
  getProductionStats,
  getAndLockProcessState,
  insertProductionEvent,
  updateProductionProcess,
  type OrderProcessTarget,
} from "@/lib/repositories/production.repository";
import { getItemAggregate, refreshOrderStatuses } from "@/lib/repositories/order-items.repository";
import { allowedProcessStatuses, deriveOrderItemStatus } from "@/lib/utils/production";
import { todayISODate } from "@/lib/utils/dates";
import { processUpdateSchema, type ProcessUpdateInput } from "@/lib/validators/production.schema";
import { firstZodMessage } from "@/lib/validators/common";

export interface ProductionPage extends ProductionResult {
  processes: ProcessDefinition[];
  /** Data de referência (AAAA-MM-DD) usada pela RPC — mesma base da regra de atraso. */
  today: string;
}

/** Página da tela de gestão de entregas (dados + catálogo de processos). */
export async function getProductionPage(
  client: SupabaseServer,
  filters: ProductionFilters,
): Promise<ProductionPage> {
  const today = todayISODate();
  const [result, processes] = await Promise.all([
    getProductionRows(client, filters, today),
    getActiveProcesses(client),
  ]);
  return { ...result, processes, today };
}

export interface ProductionOrderPage extends ProductionOrderResult {
  processes: ProcessDefinition[];
  /** Data de referência (AAAA-MM-DD) usada pela RPC — mesma base da regra de atraso. */
  today: string;
}

/**
 * Página da gestão de entregas CONSOLIDADA por OF (025): uma linha por
 * pedido, com quantidades/pesos somados e todos os processos agregados.
 * A Fábrica 2 continua usando `getProductionPage` (uma linha por item).
 */
export async function getProductionOrdersPage(
  client: SupabaseServer,
  filters: ProductionFilters,
): Promise<ProductionOrderPage> {
  const today = todayISODate();
  const [result, processes] = await Promise.all([
    getProductionOrderRows(client, filters, today),
    getActiveProcesses(client),
  ]);
  return { ...result, processes, today };
}

/** Indicadores do dashboard. */
export async function getDashboardData(client: SupabaseServer): Promise<ProductionStats> {
  return getProductionStats(client, todayISODate());
}

/** Histórico de alterações de um item. */
export async function getItemHistory(client: SupabaseServer, orderItemId: string): Promise<ProductionEvent[]> {
  return getEventsByItemId(client, orderItemId);
}

export interface UpdateProcessResult {
  changed: boolean;
  message: string;
}

/**
 * Atualização rápida de um processo (célula da tabela).
 *
 * Regras:
 *  - o avanço de status é sempre explícito (nunca automático);
 *  - toda alteração gera um production_event;
 *  - o status agregado do item é derivado dos processos.
 */
export async function updateProcess(
  client: SupabaseServer,
  sessionUser: SessionUser,
  input: ProcessUpdateInput,
  options: { canEditQuantities: boolean },
): Promise<UpdateProcessResult> {
  const parsed = processUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(firstZodMessage(parsed.error));
  }

  const current = await getProductionProcessById(client, parsed.data.productionProcessId);
  if (!current) {
    throw new Error("Processo não encontrado.");
  }

  const quantityPlanned = options.canEditQuantities ? parsed.data.quantityPlanned : current.quantityPlanned;
  const next: ProcessStatus = parsed.data.status;

  // Processo com situação restrita (regra do MP: só não iniciado/concluído).
  // O schema valida o ENUM; quem sabe qual status o processo aceita é aqui.
  const allowedStatuses = allowedProcessStatuses(current.process.code);
  if (!allowedStatuses.includes(next)) {
    const labels = allowedStatuses.map((value) => PROCESS_STATUS_LABELS[value].toLowerCase()).join(", ");
    throw new Error(`${current.process.name} aceita apenas as situações: ${labels}.`);
  }

  const changes: string[] = [];
  if (current.status !== next) changes.push("status");
  if (current.quantityPlanned !== quantityPlanned) changes.push("quantidade planejada");
  if (current.quantityCompleted !== parsed.data.quantityCompleted) changes.push("quantidade produzida");
  if ((current.notes ?? null) !== (parsed.data.notes ?? null)) changes.push("observações");

  if (changes.length === 0) {
    return { changed: false, message: "Nenhuma alteração para salvar." };
  }

  await updateProductionProcess(client, current.id, {
    status: next,
    quantityPlanned,
    quantityCompleted: parsed.data.quantityCompleted,
    notes: parsed.data.notes,
  });

  await insertProductionEvent(client, {
    productionProcessId: current.id,
    userId: sessionUser.id,
    eventType: changes.includes("status") ? "STATUS_CHANGE" : "DATA_CHANGE",
    oldStatus: current.status,
    newStatus: next,
    oldQuantity: current.quantityCompleted,
    newQuantity: parsed.data.quantityCompleted,
    notes: parsed.data.notes,
  });

  const aggregate = await getItemAggregate(client, current.orderItemId);
  if (aggregate) {
    // Status agregado derivado dos processos + OP (013). A RPC também
    // re-deriva o status da OF (cancelada nunca é sobrescrita).
    const derived = deriveOrderItemStatus(
      aggregate.processStatuses.map((status) => ({ processCode: "", status })),
      aggregate.op,
    );
    if (aggregate.status !== "CANCELADO" && derived !== aggregate.status) {
      await refreshOrderStatuses(client, current.orderItemId, derived);
    }
  }

  const statusChanged = current.status !== next;
  return {
    changed: true,
    message: statusChanged
      ? `${current.process.name}: ${current.item.description} → ${next.replace("_", " ").toLowerCase()}`
      : `${current.process.name} atualizado.`,
  };
}

export interface UpdateProcessBatchResult {
  changed: boolean;
  /** Itens cuja situação realmente mudou. */
  updated: number;
  /** Itens com o processo aplicável na OF (denominador do lote). */
  total: number;
  message: string;
}

/**
 * Edição EM LOTE de um processo na OF (025 — célula da gestão de entregas
 * consolidada): aplica a mesma situação a TODOS os itens aplicáveis daquele
 * processo na OF inteira.
 *
 * Regras:
 *  - o escopo espelha a coluna exibida: cadeia F1 (LASER…FICEP) grava nos
 *    itens FILHOS; MP e os demais (KIT, PRÉ-MTG…EXP) grava nos RAIZ;
 *  - itens NAO_APLICAVEL ficam de fora — o lote nunca recria um processo
 *    desmarcado no pedido (a célula "—" não é editável);
 *  - quantidades e observações por item NÃO mudam (seguem na Fábrica 2 e
 *    no detalhe do pedido) — só a situação;
 *  - cada item alterado gera seu production_event e re-deriva o status
 *    agregado do item/OF, igual à edição unitária.
 */
export async function updateProcessBatch(
  client: SupabaseServer,
  sessionUser: SessionUser,
  input: { orderId: string; processCode: string; status: ProcessStatus },
): Promise<UpdateProcessBatchResult> {
  // Processo com situação restrita (MP): mesma regra da edição unitária.
  const allowedStatuses = allowedProcessStatuses(input.processCode);
  if (!allowedStatuses.includes(input.status)) {
    const labels = allowedStatuses.map((value) => PROCESS_STATUS_LABELS[value].toLowerCase()).join(", ");
    throw new Error(`Este processo aceita apenas as situações: ${labels}.`);
  }

  const targets = await getOrderProcessTargets(client, input.orderId, input.processCode);
  const applicable = targets.filter((target) => target.status !== "NAO_APLICAVEL");
  if (applicable.length === 0) {
    throw new Error("Nenhum item desta OF tem este processo aplicável.");
  }

  let updated = 0;
  const changedTargets: OrderProcessTarget[] = [];
  for (const target of applicable) {
    if (target.status === input.status) continue;
    // Só a situação muda: quantidades/observações do item são preservadas.
    await updateProductionProcess(client, target.id, {
      status: input.status,
      quantityPlanned: target.quantityPlanned,
      quantityCompleted: target.quantityCompleted,
      notes: target.notes,
    });
    await insertProductionEvent(client, {
      productionProcessId: target.id,
      userId: sessionUser.id,
      eventType: "STATUS_CHANGE",
      oldStatus: target.status,
      newStatus: input.status,
      oldQuantity: target.quantityCompleted,
      newQuantity: target.quantityCompleted,
      notes: target.notes,
    });
    changedTargets.push(target);
    updated += 1;
  }

  // Status agregado re-derivado apenas dos itens que REALMENTE mudaram.
  const touchedItems = [...new Set(changedTargets.map((target) => target.orderItemId))];
  for (const orderItemId of touchedItems) {
    const aggregate = await getItemAggregate(client, orderItemId);
    if (!aggregate) continue;
    const derived = deriveOrderItemStatus(
      aggregate.processStatuses.map((status) => ({ processCode: "", status })),
      aggregate.op,
    );
    if (aggregate.status !== "CANCELADO" && derived !== aggregate.status) {
      await refreshOrderStatuses(client, orderItemId, derived);
    }
  }

  const label = PROCESS_STATUS_LABELS[input.status].toLowerCase();
  return {
    changed: updated > 0,
    updated,
    total: applicable.length,
    message:
      updated > 0
        ? `${input.processCode} → ${label} em ${updated} de ${applicable.length} ${applicable.length === 1 ? "item" : "itens"}.`
        : "Nenhuma alteração para salvar.",
  };
}

/** Detalhe de um processo para a folha de edição. */
export async function getProcessDetail(
  client: SupabaseServer,
  productionProcessId: string,
): Promise<Awaited<ReturnType<typeof getProductionProcessById>>> {
  return getProductionProcessById(client, productionProcessId);
}

/** Estado atual antes de editar (comparações do serviço). */
export async function getProcessState(
  client: SupabaseServer,
  productionProcessId: string,
): Promise<Awaited<ReturnType<typeof getAndLockProcessState>>> {
  return getAndLockProcessState(client, productionProcessId);
}
