"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { isProcessStatus } from "@/lib/constants/production";
import { createClient } from "@/lib/supabase/server";
import type { ProductionEvent } from "@/lib/types/production";
import { getItemHistory, updateProcess } from "@/lib/services/production.service";
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
      revalidatePath("/dashboard");
      revalidatePath("/(dashboard)/pedidos/[id]", "page");
    }

    return { success: true, message: result.message, changed: result.changed };
  } catch (error) {
    console.error("[updateProcessAction]", error);
    return { success: false, message: errorMessage(error), changed: false };
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
