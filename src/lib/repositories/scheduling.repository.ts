import type { ProcessSchedulingRowRecord } from "@/lib/types/database";
import type { ProcessSchedulingData, SchedulingOrderRow } from "@/lib/types/scheduling";
import type { SupabaseServer } from "@/lib/supabase/types";
import { todayISODate } from "@/lib/utils/dates";
import { roundWeightOrNull } from "@/lib/utils/formatting";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRow(raw: ProcessSchedulingRowRecord): SchedulingOrderRow {
  return {
    orderId: raw.order_id,
    orderCode: raw.order_code,
    orderType: raw.order_type,
    customerName: raw.customer_name,
    deliveryDate: raw.delivery_date,
    orderStatus: raw.order_status,
    productGroupId: raw.product_group_id === null ? null : Number(raw.product_group_id),
    familyDescription: raw.family_description,
    familyAbbreviation: raw.family_abbreviation,
    groupType: raw.group_type,
    quantity: toNumber(raw.quantity) ?? 0,
    weightKg: roundWeightOrNull(toNumber(raw.weight_kg)),
    capacityKg: roundWeightOrNull(toNumber(raw.capacity_kg)),
    notes: raw.notes,
  };
}

/**
 * Linhas da fila de um processo (070) + data de início persistida.
 * A ordem vem do banco: posição salva, depois entrega, depois código.
 */
export async function getProcessScheduling(
  client: SupabaseServer,
  input: { processId: string; familyGroupId: number | null },
): Promise<ProcessSchedulingData> {
  const [rowsResult, settingsResult] = await Promise.all([
    client.rpc("get_process_scheduling", {
      p_process_id: input.processId,
      p_family_group_id: input.familyGroupId,
    }),
    client
      .from("process_schedule_settings")
      .select("anchor_date")
      .eq("process_id", input.processId)
      .maybeSingle(),
  ]);

  assertOk(rowsResult.error, "Não foi possível carregar o sequenciamento");
  assertOk(settingsResult.error, "Não foi possível carregar a data de início do sequenciamento");

  return {
    processId: input.processId,
    anchorDate: settingsResult.data?.anchor_date ?? todayISODate(),
    rows: ((rowsResult.data ?? []) as ProcessSchedulingRowRecord[]).map(mapRow),
  };
}

/**
 * Grava a ordem final da fila na sequência do array e a data de início.
 * A RPC valida a permissão, roda tudo em uma transação e preserva as
 * posições já ocupadas pelas OFs enviadas (salvar uma família filtrada
 * não reinicia a posição das outras).
 */
export async function saveProcessSchedule(
  client: SupabaseServer,
  input: {
    processId: string;
    anchorDate: string;
    rows: readonly { orderId: string; notes: string | null }[];
  },
): Promise<void> {
  const { error } = await client.rpc("save_process_schedule", {
    p_process_id: input.processId,
    p_anchor_date: input.anchorDate,
    p_rows: input.rows.map((row, index) => ({
      order_id: row.orderId,
      position: index + 1,
      notes: row.notes,
    })),
  });

  assertOk(error, "Não foi possível salvar o sequenciamento");
}
