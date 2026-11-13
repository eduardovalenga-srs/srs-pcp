"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import {
  deleteMpReceipt,
  getMpReceiptCustomers,
  getMpReceiptMaterials,
  saveMpReceipt,
} from "@/lib/services/mp-receipt.service";
import type {
  MpReceiptCustomerOption,
  MpReceiptMaterial,
} from "@/lib/types/mp-receipt";
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

/** Matérias-primas da OF + histórico de notas de entrada. */
export async function loadMpReceiptOrderAction(
  orderId: string,
): Promise<
  | {
      success: true;
      materials: MpReceiptMaterial[];
    }
  | { success: false; message: string }
> {
  try {
    await requireCapability("menu.recebimento_mp");
    if (!orderId.trim()) return { success: false, message: "Selecione a OF." };

    const client = await createClient();
    const materials = await getMpReceiptMaterials(client, orderId);
    return { success: true, materials };
  } catch (error) {
    console.error("[loadMpReceiptOrderAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/**
 * Registra uma NOTA DE ENTRADA (nº + data + o peso recebido de cada
 * matéria-prima). O espelho da coluna MP é recalculado no banco.
 */
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
      entryNumber: parsed.data.entryNumber,
      entryDate: parsed.data.entryDate,
      notes: parsed.data.notes,
      materials: parsed.data.materials,
      freeItems: parsed.data.freeItems,
    });

    revalidateMpReceipt();
    return {
      success: true,
      message: `Nota de entrada nº ${parsed.data.entryNumber} registrada.`,
      receiptId: result.id,
      number: result.number,
    };
  } catch (error) {
    console.error("[saveMpReceiptAction]", error);
    return failure(errorMessage(error));
  }
}

const receiptIdSchema = z.string().trim().min(1, "Nota de entrada inválida.");

/** Exclui uma nota de entrada para correção (recalcula o espelho no banco). */
export async function deleteMpReceiptAction(receiptId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await requireCapability("mp_receipt.edit");
    const parsed = receiptIdSchema.safeParse(receiptId);
    if (!parsed.success) return { success: false, message: "Nota de entrada inválida." };

    const client = await createClient();
    await deleteMpReceipt(client, parsed.data);

    revalidateMpReceipt();
    return { success: true, message: "Nota de entrada excluída." };
  } catch (error) {
    console.error("[deleteMpReceiptAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}
