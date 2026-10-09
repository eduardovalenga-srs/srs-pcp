import type { ImportBatchStatusValue, Json } from "@/lib/types/database";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { ImportErrorEntry, ImportBatchHistory } from "@/lib/types/import";
import { assertOk } from "@/lib/utils/supabase-result";

export interface ApplyPlanResult {
  created: number;
  updated: number;
  skipped: number;
  ordersCreated: number;
}

/**
 * Executa o plano de escrita em UMA transação (RPC apply_import).
 * Usado pelo cadastro de pedidos (formato item único): um único ponto
 * de gravação, com rollback automático em erro.
 */
export async function applyPlan(client: SupabaseServer, plan: Json): Promise<ApplyPlanResult> {
  const { data, error } = await client.rpc("apply_import", { p_plan: plan });
  if (error) throw new Error(`Falha na gravação: ${error.message}`);
  return data;
}

export interface ApplyOfPlanResult {
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  parentsCreated: number;
  parentsUpdated: number;
  childrenCreated: number;
  childrenUpdated: number;
  itemsRemoved: number;
}

/**
 * Executa o plano do novo layout (OF -> pais -> filhos -> materiais) em
 * UMA transação (RPC apply_of_import, migração 016). Erro em qualquer
 * ponto desfaz tudo — nunca fica meio importado.
 */
export async function applyOfPlan(client: SupabaseServer, plan: Json): Promise<ApplyOfPlanResult> {
  const { data, error } = await client.rpc("apply_of_import", { p_plan: plan });
  if (error) throw new Error(`Falha na gravação: ${error.message}`);
  return data;
}

export async function createBatch(
  client: SupabaseServer,
  input: {
    fileName: string;
    fileSize: number;
    totalRows: number;
    validRows: number;
    errorRows: number;
    warningRows: number;
    createdBy: string;
  },
): Promise<string> {
  const { data, error } = await client
    .from("import_batches")
    .insert({
      file_name: input.fileName,
      file_size: input.fileSize,
      status: "PROCESSANDO",
      total_rows: input.totalRows,
      valid_rows: input.validRows,
      error_rows: input.errorRows,
      warning_rows: input.warningRows,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  assertOk(error, "Não foi possível registrar a importação");
  if (!data) throw new Error("Não foi possível registrar a importação: registro não retornado.");
  return data.id;
}

export async function completeBatch(
  client: SupabaseServer,
  batchId: string,
  input: { status: ImportBatchStatusValue; validRows?: number },
): Promise<void> {
  const { error } = await client
    .from("import_batches")
    .update({
      status: input.status,
      ...(input.validRows !== undefined ? { valid_rows: input.validRows } : {}),
      completed_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  assertOk(error, "Não foi possível finalizar o registro da importação");
}

export async function insertBatchErrors(
  client: SupabaseServer,
  batchId: string,
  entries: ImportErrorEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const { error } = await client.from("import_errors").insert(
    entries.map((entry) => ({
      import_batch_id: batchId,
      row_number: entry.rowNumber,
      column_name: entry.columnName,
      error_type: entry.errorType,
      message: entry.message,
      raw_value: entry.rawValue,
    })),
  );

  assertOk(error, "Não foi possível registrar os erros da importação");
}

/** Histórico de importações (mais recentes primeiro). */
export async function listBatches(client: SupabaseServer, limit = 20): Promise<ImportBatchHistory[]> {
  const { data, error } = await client
    .from("import_batches")
    .select(
      `id, file_name, file_size, status, total_rows, valid_rows, error_rows, warning_rows,
       created_at, completed_at, created_by, profiles!inner(name)`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  assertOk(error, "Não foi possível carregar o histórico de importações");

  type Raw = {
    id: string;
    file_name: string;
    file_size: number | null;
    status: string;
    total_rows: number | null;
    valid_rows: number | null;
    error_rows: number | null;
    warning_rows: number | null;
    created_at: string;
    completed_at: string | null;
    profiles: { name: string | null } | null;
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    fileSize: row.file_size,
    status: row.status,
    totalRows: row.total_rows,
    validRows: row.valid_rows,
    errorRows: row.error_rows,
    warningRows: row.warning_rows,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    createdByName: row.profiles?.name ?? null,
    errors: [],
  }));
}

/** Erros registrados de um lote de importação. */
export async function listBatchErrors(client: SupabaseServer, batchId: string): Promise<ImportErrorEntry[]> {
  const { data, error } = await client
    .from("import_errors")
    .select("row_number, column_name, error_type, message, raw_value")
    .eq("import_batch_id", batchId)
    .order("row_number", { ascending: true })
    .limit(500);

  assertOk(error, "Não foi possível carregar os erros da importação");

  return (data ?? []).map((row) => ({
    rowNumber: row.row_number,
    columnName: row.column_name,
    errorType: row.error_type,
    message: row.message,
    rawValue: row.raw_value,
  }));
}
