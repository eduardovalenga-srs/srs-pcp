"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { isProcessStatus } from "@/lib/constants/production";
import { createClient } from "@/lib/supabase/server";
import type { ProductionEvent } from "@/lib/types/production";
import { getItemHistory, updateProcess, updateProcessBatch } from "@/lib/services/production.service";
import { errorMessage } from "@/lib/utils/supabase-result";

/** Normaliza valor de formulário para o texto esperado pelos schemas. */
function toText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export interface ProcessActionResult {
  success: boolean;
  message: string;
  changed: boolean;
}

/**
 * Atualização de uma célula de processo (status/quantidades/observações).
 * O avanço de status é sempre explícito e gera evento de histórico.
 *
 * Quantidades e observações chegam como texto do formulário (aceita "80,5")
 * e são normalizadas para o schema do serviço.
 */
export async function updateProcessAction(input: {
  productionProcessId: string;
  status: string;
  quantityPlanned?: string | number | null;
  quantityCompleted?: string | number | null;
  notes?: string | null;
}): Promise<ProcessActionResult> {
  try {
    const sessionUser = await requireCapability("production.update_status");
    if (!isProcessStatus(input.status)) {
      return { success: false, message: "Status inválido.", changed: false };
    }

    const client = await createClient();

    const result = await updateProcess(
      client,
      sessionUser,
      {
        productionProcessId: input.productionProcessId,
        status: input.status,
        quantityPlanned: toText(input.quantityPlanned),
        quantityCompleted: toText(input.quantityCompleted),
        notes: toText(input.notes),
      },
      { canEditQuantities: can(sessionUser.role, "production.edit") },
    );

    if (result.changed) {
      revalidatePath("/gestao-entregas");
      revalidatePath("/fabrica-1");
      revalidatePath("/fabrica-2");
      revalidatePath("/dashboard");
      revalidatePath("/(dashboard)/pedidos/[id]", "page");
    }

    return { success: true, message: result.message, changed: result.changed };
  } catch (error) {
    console.error("[updateProcessAction]", error);
    return { success: false, message: errorMessage(error), changed: false };
  }
}

export interface ProcessBatchActionResult {
  success: boolean;
  message: string;
  changed: boolean;
  /** Itens cuja situação realmente mudou. */
  updated: number;
  /** Itens com o processo aplicável na OF. */
  total: number;
}

/**
 * Edição EM LOTE de um processo em TODOS os itens aplicáveis da OF
 * (025 — a célula de processo da gestão de entregas consolidada) ou num
 * conjunto explícito de itens (033 — célula AGRUPADA da Fábrica 1).
 * Só a situação muda; quantidades/observações por item ficam intactas
 * e cada item alterado gera seu evento de histórico.
 */
export async function updateProcessBatchAction(input: {
  orderId: string;
  processCode: string;
  status: string;
  /** 033: escopo explícito de itens (linha agrupada da Fábrica 1). */
  orderItemIds?: string[];
}): Promise<ProcessBatchActionResult> {
  try {
    const sessionUser = await requireCapability("production.update_status");
    if (!isProcessStatus(input.status)) {
      return { success: false, message: "Status inválido.", changed: false, updated: 0, total: 0 };
    }
    // Escopo explícito: só ids não vazios, com teto para não estourar o in().
    const orderItemIds = (input.orderItemIds ?? []).filter((id) => id.trim() !== "");
    if (input.orderItemIds !== undefined && (orderItemIds.length === 0 || orderItemIds.length > 500)) {
      return {
        success: false,
        message: "Escopo de itens inválido.",
        changed: false,
        updated: 0,
        total: 0,
      };
    }

    const client = await createClient();
    const result = await updateProcessBatch(client, sessionUser, {
      orderId: input.orderId,
      processCode: input.processCode,
      status: input.status,
      orderItemIds: input.orderItemIds !== undefined ? orderItemIds : undefined,
    });

    if (result.changed) {
      revalidatePath("/gestao-entregas");
      revalidatePath("/fabrica-1");
      revalidatePath("/fabrica-2");
      revalidatePath("/dashboard");
      revalidatePath("/(dashboard)/pedidos/[id]", "page");
    }

    return {
      success: true,
      message: result.message,
      changed: result.changed,
      updated: result.updated,
      total: result.total,
    };
  } catch (error) {
    console.error("[updateProcessBatchAction]", error);
    return { success: false, message: errorMessage(error), changed: false, updated: 0, total: 0 };
  }
}

export interface HistoryResult {
  success: boolean;
  message: string;
  events: ProductionEvent[];
}
/** Histórico de alterações de um item (nunca destruído). */
export async function getItemHistoryAction(orderItemId: string): Promise<HistoryResult> {
  try {
    await requireCapability("production.view_history");
    const client = await createClient();
    const events = await getItemHistory(client, orderItemId);
    return { success: true, message: "", events };
  } catch (error) {
    console.error("[getItemHistoryAction]", error);
    return { success: false, message: errorMessage(error), events: [] };
  }
}
