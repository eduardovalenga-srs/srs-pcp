import type { ProcessStatus } from "@/lib/constants/production";
import type { MpCellReceipt, MpReceiptState } from "@/lib/types/mp-receipt";

/**
 * REGRA DE SITUAÇÃO do recebimento (056) — a MESMA da migração
 * (`mp_item_state`):
 *
 *  - sem kg recebido → NONE (coluna no estado padrão);
 *  - item SEM peso (planejado null/0): qualquer recebimento > 0 → TOTAL;
 *  - com peso: TOTAL quando a soma recebida cobre o planejado; no meio,
 *    PARCIAL.
 */
export function mpReceiptStateOf(plannedKg: number | null, receivedKg: number): MpReceiptState {
  if (receivedKg <= 0) return "NONE";
  if (plannedKg === null || plannedKg <= 0) return "TOTAL";
  return receivedKg >= plannedKg ? "TOTAL" : "PARCIAL";
}

/** Espelho de um item a partir do planejado/recebido. */
export function mpCellReceipt(plannedKg: number | null, receivedKg: number): MpCellReceipt {
  return { state: mpReceiptStateOf(plannedKg, receivedKg), receivedKg, plannedKg };
}

/**
 * Espelho lido de UMA célula do processo MP (`production_processes`):
 *
 *  - o STATUS é o espelho do TOTAL (CONCLUIDO = todos os kg recebidos);
 *  - sem CONCLUIDO, kg recebidos > 0 = parcial (amarelo);
 *  - nada recebido = estado padrão.
 *
 * O status vem primeiro de propósito: cobre marcações antigas feitas à
 * mão (CONCLUIDO sem quantidade gravada) e o agregado por OF (pior caso
 * entre os itens + Σ das quantidades), que a RPC mantém em sincronia
 * com `mp_receipt_items`.
 */
export function mpReceiptFromCell(
  cell:
    | {
        status: ProcessStatus;
        quantityPlanned: number | null;
        quantityCompleted: number | null;
      }
    | null
    | undefined,
): MpCellReceipt {
  const receivedKg = cell?.quantityCompleted ?? 0;
  const plannedKg = cell?.quantityPlanned ?? null;
  const state: MpReceiptState =
    cell?.status === "CONCLUIDO" ? "TOTAL" : receivedKg > 0 ? "PARCIAL" : "NONE";
  return { state, receivedKg, plannedKg };
}

/**
 * Pior caso entre recibos de itens/pais distintos — verde só quando
 * TODOS estão TOTAL; amarelo quando qualquer um recebeu; padrão quando
 * ninguém recebeu.
 */
export function aggregateMpReceiptState(
  states: readonly MpReceiptState[],
): MpReceiptState {
  if (states.length > 0 && states.every((state) => state === "TOTAL")) return "TOTAL";
  if (states.some((state) => state !== "NONE")) return "PARCIAL";
  return "NONE";
}

/** Agrega espelhos de itens/pais distintos (pior caso + Σ de kg). */
export function aggregateMpReceipts(
  receipts: readonly MpCellReceipt[],
): MpCellReceipt | null {
  if (receipts.length === 0) return null;
  const plannedValues = receipts.map((receipt) => receipt.plannedKg);
  return {
    state: aggregateMpReceiptState(receipts.map((receipt) => receipt.state)),
    receivedKg: receipts.reduce((total, receipt) => total + receipt.receivedKg, 0),
    // Σ só quando todos têm peso (senão o "—" some junto com o total).
    plannedKg: plannedValues.every((value) => value !== null)
      ? plannedValues.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
  };
}

/** Rótulos em português das situações do recebimento. */
export const MP_RECEIPT_STATE_LABELS: Record<MpReceiptState, string> = {
  NONE: "Sem recebimento",
  PARCIAL: "Recebimento parcial",
  TOTAL: "Totalmente recebido",
};

/**
 * Classes da célula do espelho MP (cores das listas): verde = total,
 * amarelo = parcial, padrão = nada recebido. Mesma receita do
 * `statusClass` das tabelas.
 */
export const MP_RECEIPT_STATE_CLASSES: Record<MpReceiptState, string> = {
  TOTAL: "border-status-done/40 bg-status-done-bg text-status-done",
  PARCIAL: "border-status-progress/40 bg-status-progress-bg text-status-progress",
  NONE: "border-border bg-background text-muted-foreground",
};

export function mpReceiptClass(state: MpReceiptState): string {
  return MP_RECEIPT_STATE_CLASSES[state];
}
