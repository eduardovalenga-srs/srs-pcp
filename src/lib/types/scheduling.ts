/**
 * Sequenciamento de produção (070).
 *
 * A prioridade é GLOBAL e compartilhada com order_items.seq. O processo
 * selecionado filtra OFs aplicáveis; as já concluídas aparecem com peso
 * considerado igual a zero. A capacidade é usada no cálculo de carga em
 * dias úteis. As situações do processo e da MP por OF vêm agregadas do
 * banco (078).
 */

import type { ProcessStatus } from "@/lib/constants/production";
import type { MpReceiptState } from "@/lib/types/mp-receipt";
/** OF na fila de um processo (dados crus, antes do cálculo de datas). */
export interface SchedulingOrderRow {
  orderId: string;
  orderCode: string;
  orderType: string;
  customerName: string | null;
  deliveryDate: string | null;
  orderStatus: string;
  /** Posição da prioridade global (null = ainda não sequenciada). */
  sequence: number | null;
  productGroupId: number | null;
  familyDescription: string | null;
  familyAbbreviation: string | null;
  groupType: string | null;
  quantity: number;
  weightKg: number | null;
  capacityKg: number | null;
  notes: string | null;
  /** 078: situação do processo selecionado na OF (null = sem processo). */
  processStatus: ProcessStatus | null;
  /** 078: situação do recebimento de MP da OF (null = sem MP aplicável). */
  mpState: MpReceiptState | null;
}

/** Linha da tela com a carga e as datas previstas calculadas. */
export interface ScheduledOrderRow extends SchedulingOrderRow {
  /** Peso ÷ capacidade (dias úteis, aceita fração). */
  loadDays: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Impedimento do cálculo (sem peso, sem capacidade, OF sem família). */
  issue: string | null;
}

export interface ProcessSchedulingData {
  processId: string | null;
  anchorDate: string;
  rows: SchedulingOrderRow[];
}
