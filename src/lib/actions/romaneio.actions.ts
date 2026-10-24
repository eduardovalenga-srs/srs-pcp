"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import {
  cancelRomaneio,
  createRomaneio,
  emitRomaneio,
  saveRomaneio,
  saveRomaneioNfNumbers,
  signRomaneioConference,
} from "@/lib/services/romaneio.service";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import {
  romaneioConferenceSchema,
  romaneioNfSchema,
  romaneioSchema,
} from "@/lib/validators/romaneio.schema";

/** Retorno padrão das ações do romaneio (toast + refresh da tela). */
export interface RomaneioActionResult {
  success: boolean;
  message: string;
  romaneioId: string | null;
  number: number | null;
}

const FAILURE: RomaneioActionResult = { success: false, message: "", romaneioId: null, number: null };

function failure(message: string): RomaneioActionResult {
  return { ...FAILURE, message };
}

/** Revalida a lista e (opcionalmente) a tela de detalhe do romaneio. */
function revalidateRomaneio(romaneioId?: string) {
  revalidatePath("/romaneio");
  if (romaneioId) {
    revalidatePath("/romaneio/novo");
    revalidatePath("/(dashboard)/romaneio/[id]", "page");
  }
}

const romaneioIdSchema = z.string().trim().min(1, "Romaneio inválido.");

/**
 * Cria uma simulação vazia para a OF (seletor em /romaneio/novo) e
 * devolve o id para o cliente redirecionar ao editor.
 */
export async function createRomaneioAction(orderId: string): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedOrderId = romaneioIdSchema.safeParse(orderId);
    if (!parsedOrderId.success) return failure("Selecione a OF.");

    const client = await createClient();
    const result = await createRomaneio(client, parsedOrderId.data);

    revalidateRomaneio(result.id);
    return {
      success: true,
      message: `Simulação nº ${result.number} criada.`,
      romaneioId: result.id,
      number: result.number,
    };
  } catch (error) {
    console.error("[createRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Salva cabeçalho+itens+materiais de um romaneio em SIMULAÇÃO. */
export async function saveRomaneioAction(input: unknown): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsed = romaneioSchema.safeParse(input);
    if (!parsed.success) return failure(firstZodMessage(parsed.error));

    const client = await createClient();
    const result = await saveRomaneio(client, parsed.data);

    revalidateRomaneio(result.id);
    return {
      success: true,
      message: `Romaneio nº ${result.number} salvo.`,
      romaneioId: result.id,
      number: result.number,
    };
  } catch (error) {
    console.error("[saveRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Sinaliza o aceite da conferência (quem/quando/observação). */
export async function signRomaneioConferenceAction(
  romaneioId: string,
  notes: unknown,
): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return failure("Romaneio inválido.");
    const parsedNotes = romaneioConferenceSchema.safeParse({ notes });
    if (!parsedNotes.success) return failure(firstZodMessage(parsedNotes.error));

    const client = await createClient();
    await signRomaneioConference(client, parsedId.data, parsedNotes.data.notes);

    revalidateRomaneio(parsedId.data);
    return {
      success: true,
      message: "Aceite da conferência sinalizado.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[signRomaneioConferenceAction]", error);
    return failure(errorMessage(error));
  }
}

/**
 * Emite o romaneio (trava cabeçalho/itens/materiais). Os gates são
 * validados na RPC 042 — a mensagem amigável sobe para o toast.
 */
export async function emitRomaneioAction(romaneioId: string): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return failure("Romaneio inválido.");

    const client = await createClient();
    await emitRomaneio(client, parsedId.data);

    revalidateRomaneio(parsedId.data);
    return {
      success: true,
      message: "Romaneio emitido.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[emitRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Cancela o romaneio (bloqueado com NF de saída registrada). */
export async function cancelRomaneioAction(romaneioId: string): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return failure("Romaneio inválido.");

    const client = await createClient();
    await cancelRomaneio(client, parsedId.data);

    revalidateRomaneio(parsedId.data);
    return {
      success: true,
      message: "Romaneio cancelado.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[cancelRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Registra os números de NF de saída/devolução no romaneio. */
export async function saveRomaneioNfAction(
  romaneioId: string,
  input: unknown,
): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return failure("Romaneio inválido.");
    const parsed = romaneioNfSchema.safeParse(input);
    if (!parsed.success) return failure(firstZodMessage(parsed.error));

    const client = await createClient();
    await saveRomaneioNfNumbers(client, parsedId.data, parsed.data);

    revalidateRomaneio(parsedId.data);
    return {
      success: true,
      message: "Números de NF salvos.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[saveRomaneioNfAction]", error);
    return failure(errorMessage(error));
  }
}
