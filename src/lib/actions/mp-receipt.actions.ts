"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import {
  deleteMpReceipt,
  getMpReceiptCustomers,
  getMpReceiptHistory,
  getMpReceiptItems,
  saveMpReceipt,
} from "@/lib/services/mp-receipt.service";
import type {
  MpReceiptCustomerOption,
  MpReceiptHistoryEntry,
} from "@/lib/types/mp-receipt";
import type { MpReceiptItem } from "@/lib/repositories/mp-receipt.repository";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import { mpReceiptSchema } from "@/lib/validators/mp-receipt.schema";

/** Retorno padrão das ações do recebimento de MP (toast + refresh). */
export interface MpReceiptActionResult {
  success: boolean;
  message: string;
  receiptId: string | null;
  number: number | null;
}

const FAILURE: MpReceiptActionResult = {
  success: false,
  message: "",
  receiptId: null,
  number: null,
};

function failure(message: string): MpReceiptActionResult {
  return { ...FAILURE, message };
}

/**
 * O recebimento de MP altera o espelho da coluna MP em todas as listas
 * (gestão de entregas, fábricas, pedidos e o detalhe da OF).
 */
function revalidateMpReceipt() {
  revalidatePath("/recebimento-mp");
  revalidatePath("/gestao-entregas");
  revalidatePath("/fabrica-1");
  revalidatePath("/fabrica-2");
  revalidatePath("/pedidos");
  revalidatePath("/(dashboard)/pedidos/[id]", "page");
  revalidatePath("/dashboard");
}

/** Clientes com OFs pendentes de MP (seletor em cascata da tela). */
export async function getMpReceiptCustomersAction(): Promise<
  { success: true; customers: MpReceiptCustomerOption[] } | { success: false; message: string }
> {
  try {
    await requireCapability("menu.recebimento_mp");
    const client = await createClient();
    return { success: true, customers: await getMpReceiptCustomers(client) };
  } catch (error) {
    console.error("[getMpReceiptCustomersAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Linhas elegíveis (filhos + pai sem filhos) + histórico de uma OF. */
export async function loadMpReceiptOrderAction(
  orderId: string,
): Promise<
  | {
      success: true;
      items: MpReceiptItem[];
      history: MpReceiptHistoryEntry[];
    }
  | { success: false; message: string }
> {
  try {
    await requireCapability("menu.recebimento_mp");
    if (!orderId.trim()) return { success: false, message: "Selecione a OF." };

    const client = await createClient();
    const [items, history] = await Promise.all([
      getMpReceiptItems(client, orderId),
      getMpReceiptHistory(client, orderId),
    ]);
    return { success: true, items, history };
  } catch (error) {
    console.error("[loadMpReceiptOrderAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Registra um recebimento de MP (kg por linha: filho ou pai sem filhos). */
export async function saveMpReceiptAction(
  input: z.input<typeof mpReceiptSchema>,
): Promise<MpReceiptActionResult> {
  try {
    await requireCapability("mp_receipt.edit");
    const parsed = mpReceiptSchema.safeParse(input);
    if (!parsed.success) return failure(firstZodMessage(parsed.error));

    const client = await createClient();
    const result = await saveMpReceipt(client, {
      orderId: parsed.data.orderId,
      notes: parsed.data.notes,
      items: parsed.data.items,
    });

    revalidateMpReceipt();
    return {
      success: true,
      message: `Recebimento nº ${result.number} registrado.`,
      receiptId: result.id,
      number: result.number,
    };
  } catch (error) {
    console.error("[saveMpReceiptAction]", error);
    return failure(errorMessage(error));
  }
}

const receiptIdSchema = z.string().trim().min(1, "Recebimento inválido.");

/** Exclui um recebimento para correção (recalcula o espelho no banco). */
export async function deleteMpReceiptAction(receiptId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await requireCapability("mp_receipt.edit");
    const parsed = receiptIdSchema.safeParse(receiptId);
    if (!parsed.success) return { success: false, message: "Recebimento inválido." };

    const client = await createClient();
    await deleteMpReceipt(client, parsed.data);

    revalidateMpReceipt();
    return { success: true, message: "Recebimento excluído." };
  } catch (error) {
    console.error("[deleteMpReceiptAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}
