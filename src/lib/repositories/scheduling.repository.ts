import type { AllProcessSchedulingQueueRecord, ProcessSchedulingRowRecord } from "@/lib/types/database";
import type {
  ProcessScheduleQueue,
  ProcessSchedulingData,
  SchedulingOrderRow,
} from "@/lib/types/scheduling";
import type { SupabaseServer } from "@/lib/supabase/types";
import { isProcessStatus } from "@/lib/constants/production";
import type { MpReceiptState } from "@/lib/types/mp-receipt";
import { todayISODate } from "@/lib/utils/dates";
import { roundWeightOrNull } from "@/lib/utils/formatting";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 078: normaliza a situação de MP vinda da RPC (valor inesperado = null). */
function toMpState(value: string | null): MpReceiptState | null {
  return value === "NONE" || value === "PARCIAL" || value === "TOTAL" ? value : null;
}

function mapRow(raw: ProcessSchedulingRowRecord): SchedulingOrderRow {
  return {
    orderId: raw.order_id,
    orderCode: raw.order_code,
    orderType: raw.order_type,
    customerName: raw.customer_name,
    deliveryDate: raw.delivery_date,
    orderStatus: raw.order_status,
    sequence: toNumber(raw.position),
    productGroupId: raw.product_group_id === null ? null : Number(raw.product_group_id),
    familyDescription: raw.family_description,
    familyAbbreviation: raw.family_abbreviation,
    groupType: raw.group_type,
    quantity: toNumber(raw.quantity) ?? 0,
    weightKg: roundWeightOrNull(toNumber(raw.weight_kg)),
    capacityKg: roundWeightOrNull(toNumber(raw.capacity_kg)),
    notes: raw.notes,
    processStatus:
      raw.process_status !== null && isProcessStatus(raw.process_status)
        ? raw.process_status
        : null,
    mpState: toMpState(raw.mp_state),
  };
}

/**
 * Linhas elegíveis para o processo (077) + data de início persistida.
 * O processo filtra as OFs e fornece a capacidade; a ordem vem da
 * sequência global de fabricação, depois entrega e código.
 */
export async function getProcessScheduling(
  client: SupabaseServer,
  input: { processId: string | null; familyGroupId: number | null },
): Promise<ProcessSchedulingData> {
  const rowsResult = await client.rpc("get_process_scheduling", {
    p_process_id: input.processId,
    p_family_group_id: input.familyGroupId,
  });
  const settingsResult = input.processId
    ? await client
      .from("process_schedule_settings")
      .select("anchor_date")
      .eq("process_id", input.processId)
      .maybeSingle()
    : null;

  assertOk(rowsResult.error, "Não foi possível carregar o sequenciamento");
  if (settingsResult) {
    assertOk(settingsResult.error, "Não foi possível carregar a data de início do sequenciamento");
  }

  return {
    processId: input.processId,
    anchorDate: settingsResult?.data?.anchor_date ?? todayISODate(),
    rows: ((rowsResult.data ?? []) as ProcessSchedulingRowRecord[]).map(mapRow),
  };
}

/**
 * Filas de TODOS os processos ativos em uma única chamada (093).
 *
 * Cada fila sai na ordem global do sequenciamento; o índice por OF é
 * montado em `buildScheduleIndex` (lib/utils/sequenced-schedule).
 */
export async function getAllProcessScheduling(
  client: SupabaseServer,
): Promise<ProcessScheduleQueue[]> {
  const { data, error } = await client.rpc("get_all_process_scheduling");
  assertOk(error, "Não foi possível carregar o sequenciamento");

  return ((data ?? []) as AllProcessSchedulingQueueRecord[]).map((raw) => {
    const rows = Array.isArray(raw.rows)
      ? (raw.rows as unknown as {
          order_id: string;
          product_group_id: number | string | null;
          weight_kg: number | string | null;
          capacity_kg: number | string | null;
          position: number | string | null;
          process_concluded: boolean;
          process_completed_at: string | null;
          exp_concluded: boolean;
          exp_completed_at: string | null;
        }[])
      : [];

    return {
      processId: raw.process_id,
      processCode: raw.process_code,
      anchorDate: raw.anchor_date ?? todayISODate(),
      rows: rows.map((row) => ({
        orderId: row.order_id,
        productGroupId: row.product_group_id === null ? null : Number(row.product_group_id),
        weightKg: roundWeightOrNull(toNumber(row.weight_kg)),
        capacityKg: roundWeightOrNull(toNumber(row.capacity_kg)),
        processConcluded: row.process_concluded,
        processCompletedAt: row.process_completed_at,
        expConcluded: row.exp_concluded,
        expCompletedAt: row.exp_completed_at,
      })),
    };
  });
}

/**
 * Grava a ordem recebida como início da sequência global e a data de
 * início do processo. OFs já sequenciadas que ficaram fora da visão vão
 * para o fim; a RPC faz tudo em uma transação.
 */
export async function saveProcessSchedule(
  client: SupabaseServer,
  input: {
    processId: string | null;
    anchorDate: string | null;
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
