import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { PROCESS_STATUS_LABELS, type ProcessStatus } from "@/lib/constants/production";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { ProductionEvent, ProductionFilters, ProductionResult, ProductionStats, ProcessDefinition } from "@/lib/types/production";
import {
  getActiveProcesses,
  getEventsByItemId,
  getProductionProcessById,
  getProductionRows,
  getProductionStats,
  getAndLockProcessState,
  insertProductionEvent,
  updateProductionProcess,
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
