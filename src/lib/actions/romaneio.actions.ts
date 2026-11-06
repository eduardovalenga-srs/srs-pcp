"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCapability } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import {
  cancelRomaneio,
  confirmRomaneio,
  createRomaneio,
  deleteRomaneio,
  getRomaneioOrderItems,
  getRomaneioView,
  saveRomaneio,
  saveRomaneioConference,
  saveRomaneioNfNumbers,
} from "@/lib/services/romaneio.service";
import type { RomaneioOrderItem } from "@/lib/types/romaneio";
import type { RomaneioStatus } from "@/lib/constants/romaneio";
import { checkRomaneioConfirmation } from "@/lib/utils/romaneio";
import { errorMessage } from "@/lib/utils/supabase-result";
import { isValidISODate } from "@/lib/utils/dates";
import { firstZodMessage } from "@/lib/validators/common";
import {
  romaneioConferenceSchema,
  romaneioItemSchema,
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

/** Revalida a lista e (opcionalmente) as telas do romaneio. */
function revalidateRomaneio(romaneioId?: string) {
  revalidatePath("/romaneio");
  if (romaneioId) {
    revalidatePath("/romaneio/novo");
    revalidatePath("/(dashboard)/romaneio/[id]", "page");
    revalidatePath("/(dashboard)/romaneio/[id]/conferencia", "page");
  }
}

const romaneioIdSchema = z.string().trim().min(1, "Romaneio inválido.");

/**
 * Pré-requisitos de EMISSÃO (botão da listagem): os gates do
 * `confirm_romaneio` sem o de NF — o diálogo de emissão é quem exige o
 * campo preenchido, então a checagem da NF é do cliente.
 */
export interface RomaneioEmissionGate {
  status: RomaneioStatus;
  /** Motivos que impedem emitir (mensagens prontas), NF à parte. */
  blockers: string[];
  /** true quando não sobrou nenhum bloqueio além da NF. */
  canConfirm: boolean;
}

export type RomaneioEmissionResult =
  | { success: true; gate: RomaneioEmissionGate }
  | { success: false; message: string };

/**
 * Calcula os pré-requisitos de emissão do romaneio para o diálogo da
 * listagem — mesma fonte da tela de detalhe (`getRomaneioView` →
 * `checkRomaneioConfirmation`), só que com a NF tratada pelo diálogo.
 */
export async function getRomaneioEmissionAction(
  romaneioId: string,
): Promise<RomaneioEmissionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return { success: false, message: "Romaneio inválido." };

    const client = await createClient();
    const view = await getRomaneioView(client, parsedId.data, true);
    if (!view) return { success: false, message: "Romaneio não encontrado." };

    const gate = checkRomaneioConfirmation({
      status: view.status,
      orderStatus: view.orderStatus,
      // O diálogo sempre envia a nota de industrialização preenchida.
      hasNfNumber: true,
      items: view.items.map((item) => ({
        itemQuantity: item.itemQuantity,
        shippedQuantity: item.shippedQuantity,
        quantity: item.quantity,
        expStatus: item.expStatus,
      })),
    });

    return {
      success: true,
      gate: { status: view.status, blockers: gate.blockers, canConfirm: gate.canConfirm },
    };
  } catch (error) {
    console.error("[getRomaneioEmissionAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Entrada da criação em /romaneio/novo: OF + data + itens marcados. */
const createRomaneioInputSchema = z.object({
  orderId: z.string().trim().min(1, "Selecione a OF."),
  /** Data de saída obrigatória (YYYY-MM-DD) — gate do botão no cliente. */
  shipmentDate: z
    .string()
    .trim()
    .min(1, "Informe a data de saída.")
    .refine(isValidISODate, "Data de saída inválida."),
  /** Itens da remessa (quantidade > 0 = incluído nesta carga). */
  items: z
    .array(romaneioItemSchema)
    .min(1, "Liste os itens da OF antes de confirmar.")
    .max(500, "Máximo de 500 itens por romaneio"),
});

/**
 * Cria o romaneio da OF em /romaneio/novo — já com os itens marcados
 * (esta remessa) e a data de saída — e devolve o id para o cliente
 * abrir a tela de detalhe.
 */
export async function createRomaneioAction(
  input: z.input<typeof createRomaneioInputSchema>,
): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsed = createRomaneioInputSchema.safeParse(input);
    if (!parsed.success) return failure(firstZodMessage(parsed.error));

    if (!parsed.data.items.some((item) => item.quantity > 0)) {
      return failure("Informe a quantidade de pelo menos um item nesta remessa.");
    }

    const client = await createClient();
    const result = await createRomaneio(
      client,
      parsed.data.orderId,
      parsed.data.shipmentDate,
      parsed.data.items,
    );

    revalidateRomaneio(result.id);
    return {
      success: true,
      message: `Romaneio nº ${result.number} criado.`,
      romaneioId: result.id,
      number: result.number,
    };
  } catch (error) {
    console.error("[createRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Retorno da listagem de itens da OF para a seleção em /romaneio/novo. */
export interface RomaneioOrderItemsResult {
  success: boolean;
  message: string;
  items: RomaneioOrderItem[];
}

/**
 * Lista os itens RAIZ de uma OF (com EXP e já expedido) para o
 * usuário marcar o que entra nesta remessa — chamado pelo botão
 * "Listar itens" de /romaneio/novo.
 */
export async function getRomaneioOrderItemsAction(
  orderId: string,
): Promise<RomaneioOrderItemsResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(orderId);
    if (!parsedId.success) {
      return { success: false, message: "Selecione a OF.", items: [] };
    }

    const client = await createClient();
    const items = await getRomaneioOrderItems(client, parsedId.data);
    if (items.length === 0) {
      return { success: false, message: "Esta OF não tem itens raiz para expedir.", items: [] };
    }
    return { success: true, message: "", items };
  } catch (error) {
    console.error("[getRomaneioOrderItemsAction]", error);
    return { success: false, message: errorMessage(error), items: [] };
  }
}

/** Salva cabeçalho+itens+materiais de um romaneio em ABERTO. */
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

/**
 * Salva a ficha de conferência como formulário (048): marcação por
 * item, quantidades de material e observação. `sign` conclui a
 * conferência (ABERTO → CONFERIDO) — rascunho mantém o status.
 */
export async function saveRomaneioConferenceAction(
  input: unknown,
): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsed = romaneioConferenceSchema.safeParse(input);
    if (!parsed.success) return failure(firstZodMessage(parsed.error));

    const client = await createClient();
    await saveRomaneioConference(client, parsed.data);

    revalidateRomaneio(parsed.data.romaneioId);
    return {
      success: true,
      message: parsed.data.sign
        ? "Conferência marcada como concluída."
        : "Rascunho da conferência salvo.",
      romaneioId: parsed.data.romaneioId,
      number: null,
    };
  } catch (error) {
    console.error("[saveRomaneioConferenceAction]", error);
    return failure(errorMessage(error));
  }
}

/**
 * Confirma o romaneio (CONFERIDO → CONFIRMADO): registra a NF como
 * saída e dá baixa dos itens na pendência da OF. Os gates são
 * validados na RPC 045 — a mensagem amigável sobe para o toast.
 */
export async function confirmRomaneioAction(romaneioId: string): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return failure("Romaneio inválido.");

    const client = await createClient();
    await confirmRomaneio(client, parsedId.data);

    revalidateRomaneio(parsedId.data);
    return {
      success: true,
      message: "Romaneio confirmado — itens baixados na pendência da OF.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[confirmRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Exclui DEFINITIVAMENTE um romaneio em ABERTO (antes da conferência). */
export async function deleteRomaneioAction(romaneioId: string): Promise<RomaneioActionResult> {
  try {
    await requireCapability("romaneio.edit");
    const parsedId = romaneioIdSchema.safeParse(romaneioId);
    if (!parsedId.success) return failure("Romaneio inválido.");

    const client = await createClient();
    await deleteRomaneio(client, parsedId.data);

    revalidateRomaneio();
    return {
      success: true,
      message: "Romaneio excluído.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[deleteRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Cancela o romaneio (CONFERIDO/CONFIRMADO) — a baixa se restaura. */
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
      message: "Romaneio cancelado — quantidades devolvidas à pendência da OF.",
      romaneioId: parsedId.data,
      number: null,
    };
  } catch (error) {
    console.error("[cancelRomaneioAction]", error);
    return failure(errorMessage(error));
  }
}

/** Registra os números da nota de industrialização e da NF de devolução no romaneio. */
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
