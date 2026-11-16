/**
 * Sequenciamento de produção (070).
 *
 * A fila é POR PROCESSO: cada OF ocupa uma posição na fila daquele
 * processo. A carga é calculada em dias úteis a partir do peso da OF e
 * da capacidade em KG/dia do grupo de produto da família.
 */

/** OF na fila de um processo (dados crus, antes do cálculo de datas). */
export interface SchedulingOrderRow {
  orderId: string;
  orderCode: string;
  orderType: string;
  customerName: string | null;
  deliveryDate: string | null;
  orderStatus: string;
  productGroupId: number | null;
  familyDescription: string | null;
  familyAbbreviation: string | null;
  groupType: string | null;
  quantity: number;
  weightKg: number | null;
  capacityKg: number | null;
  notes: string | null;
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
  processId: string;
  anchorDate: string;
  rows: SchedulingOrderRow[];
}
