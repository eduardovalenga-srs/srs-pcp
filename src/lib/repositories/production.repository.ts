import type { ProcessStatus } from "@/lib/constants/production";
import type { ProductionRowRecord, ProcessStatusValue } from "@/lib/types/database";
import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  ProductionEvent,
  ProductionFilters,
  ProductionResult,
  ProductionRow,
  ProductionStats,
  ProcessCell,
  ProcessDefinition,
} from "@/lib/types/production";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapProductionRow(raw: ProductionRowRecord): ProductionRow {
  const processes: Record<string, ProcessCell> = {};
  for (const [code, cell] of Object.entries(raw.processes ?? {})) {
    processes[code] = {
      id: cell.id,
      status: cell.status,
      quantityPlanned: toNumber(cell.quantityPlanned),
      quantityCompleted: toNumber(cell.quantityCompleted),
      notes: cell.notes ?? null,
    };
  }

  return {
    orderItemId: raw.order_item_id,
    orderId: raw.order_id,
    orderCode: raw.order_code,
    orderType: raw.order_type,
    customerName: raw.customer_name,
    orderStatus: raw.order_status,
    family: raw.family,
    parentItem: raw.parent_item,
    description: raw.description,
    quantity: toNumber(raw.quantity) ?? 0,
    unitWeightKg: toNumber(raw.unit_weight_kg),
    deliveryDate: raw.delivery_date,
    itemStatus: raw.item_status,
    op: raw.op ?? null,
    overdue: raw.overdue,
    processes,
  };
}

/** Lista paginada da tela de gestão de entregas (filtros aplicados no banco). */
export async function getProductionRows(
  client: SupabaseServer,
  filters: ProductionFilters,
  today: string,
): Promise<ProductionResult> {
  const { data, error } = await client.rpc("get_production_rows", {
    p_search: filters.search || null,
    p_order_status: filters.orderStatus === "ALL" ? null : filters.orderStatus,
    p_process_code: filters.processCode === "ALL" ? null : filters.processCode,
    p_process_status: filters.processStatus === "ALL" ? null : filters.processStatus,
    p_delivery_filter: filters.delivery,
    p_delivery_from: filters.deliveryFrom,
    p_delivery_to: filters.deliveryTo,
    p_today: today,
    p_sort: filters.sort,
    p_sort_dir: filters.sortDir,
    p_offset: (filters.page - 1) * filters.pageSize,
    p_limit: filters.pageSize,
    // filtros por coluna (007)
    p_order_code: filters.orderCode || null,
    p_customer: filters.customer || null,
    p_family: filters.family || null,
    p_parent_item: filters.parentItem || null,
    p_description: filters.description || null,
    p_qty_min: filters.qtyMin,
    p_qty_max: filters.qtyMax,
    p_weight_min: filters.weightMin,
    p_weight_max: filters.weightMax,
  });

  if (error) throw new Error(`Não foi possível carregar a gestão de entregas: ${error.message}`);

  const rawRows = data ?? [];
  const total = rawRows.length > 0 ? Number(rawRows[0].total_count ?? 0) : 0;
  const weightTotal = rawRows.length > 0 ? Number(rawRows[0].weight_total ?? 0) : 0;
  const qtyTotal = rawRows.length > 0 ? Number(rawRows[0].qty_total ?? 0) : 0;
  const rows = rawRows.map((row) => mapProductionRow(row));

  return { rows, total, weightTotal, qtyTotal };
}

/** Estatísticas do dashboard. */
export async function getProductionStats(client: SupabaseServer, today: string): Promise<ProductionStats> {
  const { data, error } = await client.rpc("get_production_stats", { p_today: today });
  if (error) throw new Error(`Não foi possível carregar o dashboard: ${error.message}`);
  return data as unknown as ProductionStats;
}

/** Catálogo de processos ativos, na ordem de exibição. */
export async function getActiveProcesses(client: SupabaseServer): Promise<ProcessDefinition[]> {
  const { data, error } = await client
    .from("processes")
    .select("id, code, name, display_order, active, location, duration_days")
    .eq("active", true)
    .order("display_order", { ascending: true });

  assertOk(error, "Não foi possível carregar os processos");
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    displayOrder: row.display_order,
    active: row.active,
    location: row.location,
    durationDays: row.duration_days,
  }));
}

/** Catálogo completo (inclui inativos) — tela de configuração de processos. */
export async function getAllProcesses(client: SupabaseServer): Promise<ProcessDefinition[]> {
  const { data, error } = await client
    .from("processes")
    .select("id, code, name, display_order, active, location, duration_days")
    .order("display_order", { ascending: true });

  assertOk(error, "Não foi possível carregar os processos");
  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    displayOrder: row.display_order,
    active: row.active,
    location: row.location,
    durationDays: row.duration_days,
  }));
}

/**
 * Próxima ordem de exibição: anexa o novo processo ao FINAL da cadeia
 * (maior ordem atual + 1). O número pode ter "buracos" (semente usa
 * 10, 20, 30…) — o que importa é a posição relativa.
 */
export async function getNextDisplayOrder(client: SupabaseServer): Promise<number> {
  const { data, error } = await client
    .from("processes")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertOk(error, "Não foi possível calcular a ordem do processo");
  return (data?.display_order ?? 0) + 1;
}

/**
 * Reordena a cadeia de processos em uma única transação (RPC 009).
 * A função valida a lista completa e grava posição 1..N — os códigos
 * (LASER, SOLDA…) não são alterados.
 */
export async function reorderProcesses(client: SupabaseServer, orderedIds: string[]): Promise<void> {
  const { error } = await client.rpc("reorder_processes", { p_ids: orderedIds });
  assertOk(error, "Não foi possível reordenar os processos");
}

/**
 * Preenche linhas de produção ausentes (RPC 010): todo item precisa de
 * todo processo ativo — sem linha a célula fica "—" e sem data na
 * gestão de entregas. Idempotente e não altera status existente.
 * `processId` null = todos os processos ativos (usado após importar).
 * Retorna o nº de linhas criadas.
 */
export async function backfillProcess(
  client: SupabaseServer,
  processId?: string | null,
): Promise<number> {
  const { data, error } = await client.rpc("backfill_process", { p_process_id: processId ?? null });
  assertOk(error, "Não foi possível aplicar o processo aos itens");
  return Number(data ?? 0);
}

/** Cria um processo no catálogo (RLS: somente ADMIN). */
export async function insertProcess(
  client: SupabaseServer,
  input: { code: string; name: string; displayOrder: number; location: string | null; durationDays: number },
): Promise<ProcessDefinition> {
  const { data, error } = await client
    .from("processes")
    .insert({
      code: input.code,
      name: input.name,
      display_order: input.displayOrder,
      location: input.location,
      duration_days: input.durationDays,
    })
    .select("id, code, name, display_order, active, location, duration_days")
    .single();

  assertOk(error, "Não foi possível criar o processo");
  if (!data) throw new Error("Não foi possível criar o processo: registro não retornado.");
  return {
    id: data.id,
    code: data.code,
    name: data.name,
    displayOrder: data.display_order,
    active: data.active,
    location: data.location,
    durationDays: data.duration_days,
  };
}

/** Atualiza nome/situação/local/duração de um processo do catálogo (RLS: somente ADMIN). A posição na cadeia muda apenas pela RPC de reordenação. */
export async function updateProcessCatalog(
  client: SupabaseServer,
  processId: string,
  patch: {
    name: string;
    active: boolean;
    location: string | null;
    durationDays: number;
  },
): Promise<void> {
  const { error } = await client
    .from("processes")
    .update({
      name: patch.name,
      active: patch.active,
      location: patch.location,
      duration_days: patch.durationDays,
    })
    .eq("id", processId);

  assertOk(error, "Não foi possível atualizar o processo");
}

/** Registro de um processo específico (para a folha de edição). */
export async function getProductionProcessById(
  client: SupabaseServer,
  productionProcessId: string,
): Promise<{
  id: string;
  orderItemId: string;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
  process: { code: string; name: string };
  item: { description: string; quantity: number };
} | null> {
  const { data, error } = await client
    .from("production_processes")
    .select(
      `id, order_item_id, status, quantity_planned, quantity_completed, notes,
       processes!inner(code, name), order_items!inner(description, quantity)`,
    )
    .eq("id", productionProcessId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o processo");
  if (!data) return null;

  type Raw = {
    id: string;
    order_item_id: string;
    status: ProcessStatusValue;
    quantity_planned: number | string | null;
    quantity_completed: number | string | null;
    notes: string | null;
    processes: { code: string; name: string };
    order_items: { description: string; quantity: number | string };
  };

  const row = data as unknown as Raw;
  return {
    id: row.id,
    orderItemId: row.order_item_id,
    status: row.status as ProcessStatus,
    quantityPlanned: toNumber(row.quantity_planned),
    quantityCompleted: toNumber(row.quantity_completed),
    notes: row.notes,
    process: { code: row.processes.code, name: row.processes.name },
    item: { description: row.order_items.description, quantity: toNumber(row.order_items.quantity) ?? 0 },
  };
}

export interface ProcessUpdatePatch {
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
}

/** Atualiza a situação de um processo (retorna a linha anterior). */
export async function getAndLockProcessState(
  client: SupabaseServer,
  productionProcessId: string,
): Promise<{
  id: string;
  orderItemId: string;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
} | null> {
  const { data, error } = await client
    .from("production_processes")
    .select("id, order_item_id, status, quantity_planned, quantity_completed, notes")
    .eq("id", productionProcessId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o processo");
  if (!data) return null;

  return {
    id: data.id,
    orderItemId: data.order_item_id,
    status: data.status as ProcessStatus,
    quantityPlanned: toNumber(data.quantity_planned),
    quantityCompleted: toNumber(data.quantity_completed),
    notes: data.notes,
  };
}

export async function updateProductionProcess(
  client: SupabaseServer,
  productionProcessId: string,
  patch: ProcessUpdatePatch,
): Promise<void> {
  const now = new Date().toISOString();
  const startedAt = patch.status === "NAO_INICIADO" || patch.status === "NAO_APLICAVEL" ? null : now;
  const completedAt = patch.status === "CONCLUIDO" ? now : null;

  const { error } = await client
    .from("production_processes")
    .update({
      status: patch.status,
      quantity_planned: patch.quantityPlanned,
      quantity_completed: patch.quantityCompleted,
      notes: patch.notes,
      started_at: startedAt,
      completed_at: completedAt,
    })
    .eq("id", productionProcessId);

  assertOk(error, "Não foi possível salvar o processo");
}

/** Registra uma alteração relevante no histórico (quem, quando, o que). */
export async function insertProductionEvent(
  client: SupabaseServer,
  event: {
    productionProcessId: string;
    userId: string;
    eventType: string;
    oldStatus: ProcessStatus | null;
    newStatus: ProcessStatus | null;
    oldQuantity: number | null;
    newQuantity: number | null;
    notes: string | null;
  },
): Promise<void> {
  const { error } = await client.from("production_events").insert({
    production_process_id: event.productionProcessId,
    user_id: event.userId,
    event_type: event.eventType,
    old_status: event.oldStatus,
    new_status: event.newStatus,
    old_quantity: event.oldQuantity,
    new_quantity: event.newQuantity,
    notes: event.notes,
  });

  assertOk(error, "Não foi possível registrar o histórico");
}

/** Histórico de alterações de um item. */
export async function getEventsByItemId(client: SupabaseServer, orderItemId: string): Promise<ProductionEvent[]> {
  const { data, error } = await client
    .from("production_events")
    .select(
      `id, production_process_id, event_type, old_status, new_status, old_quantity, new_quantity,
       notes, created_at,
       profiles!inner(name),
       production_processes!inner(order_item_id, processes!inner(code))`,
    )
    .eq("production_processes.order_item_id", orderItemId)
    .order("created_at", { ascending: false })
    .limit(100);

  assertOk(error, "Não foi possível carregar o histórico");

  type Raw = {
    id: string;
    production_process_id: string;
    event_type: string;
    old_status: ProcessStatusValue | null;
    new_status: ProcessStatusValue | null;
    old_quantity: number | string | null;
    new_quantity: number | string | null;
    notes: string | null;
    created_at: string;
    profiles: { name: string | null } | null;
    production_processes: { processes: { code: string } };
  };

  return ((data ?? []) as unknown as Raw[]).map((row) => ({
    id: row.id,
    productionProcessId: row.production_process_id,
    event_type: row.event_type,
    oldStatus: row.old_status as ProcessStatus | null,
    newStatus: row.new_status as ProcessStatus | null,
    oldQuantity: toNumber(row.old_quantity),
    newQuantity: toNumber(row.new_quantity),
    notes: row.notes,
    createdAt: row.created_at,
    userName: row.profiles?.name ?? null,
    processCode: row.production_processes?.processes?.code ?? null,
    itemDescription: null,
  }));
}
