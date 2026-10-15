"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import {
  backfillProcess,
  getAllProcesses,
  getNextDisplayOrder,
  insertProcess,
  reorderProcesses,
  updateProcessCatalog,
} from "@/lib/repositories/production.repository";
import {
  createProcessSchema,
  reorderProcessesSchema,
  updateProcessSchema,
  type CreateProcessInput,
  type ReorderProcessesInput,
  type UpdateProcessInput,
} from "@/lib/validators/process.schema";
import { firstZodMessage } from "@/lib/validators/common";
import { errorMessage } from "@/lib/utils/supabase-result";

export interface CatalogActionResult {
  success: boolean;
  message: string;
}

/** Sufixo da mensagem quando o backfill preencheu itens existentes (010). */
function appliedSuffix(applied: number): string {
  return applied > 0 ? ` (aplicado a ${applied} ${applied === 1 ? "item" : "itens"})` : "";
}

/** Catálogo completo de processos (inclui inativos). */
export async function getProcessCatalogAction(): Promise<
  { success: true; processes: Awaited<ReturnType<typeof getAllProcesses>> } | { success: false; message: string }
> {
  try {
    await requireCapability("processes.view");
    const client = await createClient();
    return { success: true, processes: await getAllProcesses(client) };
  } catch (error) {
    console.error("[getProcessCatalogAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Cria um processo (ADMIN). */
export async function createProcessAction(input: CreateProcessInput): Promise<CatalogActionResult> {
  try {
    await requireCapability("processes.manage");
    const parsed = createProcessSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) ?? "Dados inválidos." };
    }

    const client = await createClient();
    // Ordem automática: entra ao final da cadeia (máximo atual + 1).
    const displayOrder = await getNextDisplayOrder(client);
    const created = await insertProcess(client, { ...parsed.data, displayOrder });
    // Itens existentes ganham o processo (010) — sem linha a célula fica "—".
    const applied = await backfillProcess(client, created.id);

    revalidatePath("/processos");
    revalidatePath("/gestao-entregas");
    revalidatePath("/fabrica-2");
    revalidatePath("/dashboard");
    return { success: true, message: `Processo ${parsed.data.code} criado com sucesso${appliedSuffix(applied)}.` };
  } catch (error) {
    console.error("[createProcessAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/** Atualiza um processo do catálogo (ADMIN). */
export async function updateCatalogProcessAction(input: UpdateProcessInput): Promise<CatalogActionResult> {
  try {
    await requireCapability("processes.manage");
    const parsed = updateProcessSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) ?? "Dados inválidos." };
    }

    const client = await createClient();
    await updateProcessCatalog(client, parsed.data.id, {
      name: parsed.data.name,
      active: parsed.data.active,
      location: parsed.data.location,
      durationDays: parsed.data.durationDays,
    });
    // Processo ativo: cobre itens órfãos (reativação ou itens criados
    // sem a linha). Idempotente — 0 linhas quando nada falta.
    const applied = parsed.data.active ? await backfillProcess(client, parsed.data.id) : 0;

    revalidatePath("/processos");
    revalidatePath("/gestao-entregas");
    revalidatePath("/fabrica-2");
    revalidatePath("/dashboard");
    return { success: true, message: `Processo atualizado com sucesso${appliedSuffix(applied)}.` };
  } catch (error) {
    console.error("[updateCatalogProcessAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/**
 * Reordena a cadeia de processos arrastando as linhas (ADMIN).
 * Grava tudo em uma transação (RPC) e revalida as telas afetadas:
 * a ordem define as colunas da gestão de entregas e as janelas
 * de execução previstas (o último processo termina na entrega).
 */
export async function reorderProcessesAction(
  input: ReorderProcessesInput,
): Promise<CatalogActionResult> {
  try {
    await requireCapability("processes.manage");
    const parsed = reorderProcessesSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) ?? "Dados inválidos." };
    }

    const client = await createClient();
    await reorderProcesses(client, parsed.data);

    revalidatePath("/processos");
    revalidatePath("/gestao-entregas");
    revalidatePath("/fabrica-2");
    revalidatePath("/dashboard");
    return { success: true, message: "Ordem da cadeia de processos atualizada." };
  } catch (error) {
    console.error("[reorderProcessesAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}
