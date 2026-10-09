"use server";

import { requireCapability } from "@/lib/auth/guards";
import { listBatchErrors, listBatches } from "@/lib/repositories/import.repository";
import { createClient } from "@/lib/supabase/server";
import type { ImportBatchHistory, ImportErrorEntry } from "@/lib/types/import";
import { errorMessage } from "@/lib/utils/supabase-result";

/** Falha tratável das ações do histórico (mensagem em pt-BR). */
type ActionError = { error: string };

export type ImportHistoryResult = ImportBatchHistory[] | ActionError;
export type ImportBatchErrorsResult = ImportErrorEntry[] | ActionError;

/**
 * Histórico de importações (mais recentes primeiro), com os erros do lote
 * mais recente já carregados para a expansão inicial da tabela.
 * Exige a capacidade `import.access`.
 */
export async function getImportHistoryAction(): Promise<ImportHistoryResult> {
  try {
    await requireCapability("import.access");
    const client = await createClient();

    const batches = await listBatches(client);
    const [mostRecent] = batches;
    if (mostRecent) {
      mostRecent.errors = await listBatchErrors(client, mostRecent.id);
    }

    return batches;
  } catch (error) {
    console.error("[getImportHistoryAction]", error);
    return { error: errorMessage(error, "Não foi possível carregar o histórico de importações.") };
  }
}

/**
 * Erros de um lote específico — usado ao expandir "Ver erros" no histórico.
 * Exige a capacidade `import.access`.
 */
export async function getImportBatchErrorsAction(batchId: string): Promise<ImportBatchErrorsResult> {
  try {
    const id = typeof batchId === "string" ? batchId.trim() : "";
    if (!id) return { error: "Lote de importação inválido." };

    await requireCapability("import.access");
    const client = await createClient();
    return await listBatchErrors(client, id);
  } catch (error) {
    console.error("[getImportBatchErrorsAction]", error);
    return { error: errorMessage(error, "Não foi possível carregar os erros da importação.") };
  }
}
