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

/** Dados mínimos de carga de uma linha na fila de um processo. */
export interface SchedulingLoadRow {
  weightKg: number | null;
  productGroupId: number | null;
  capacityKg: number | null;
}

/** Janela prevista de execução de um processo (YYYY-MM-DD). */
export interface ProcessScheduleWindow {
  /** Primeiro dia útil em que o processo deve rodar. */
  start: string;
  /** Último dia útil (inclusive) em que o processo deve terminar. */
  end: string;
}

/** Janela/carga calculada para uma linha de fila. */
export interface ScheduledWindow {
  /** Peso ÷ capacidade (dias úteis, aceita fração). */
  loadDays: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Impedimento do cálculo (sem peso, sem capacidade, OF sem família). */
  issue: string | null;
}

/** Linha da tela com a carga e as datas previstas calculadas. */
export interface ScheduledOrderRow extends SchedulingOrderRow, ScheduledWindow {}

export interface ProcessSchedulingData {
  processId: string | null;
  anchorDate: string;
  rows: SchedulingOrderRow[];
}

/**
 * Linha mínima de uma fila por processo usada pelo índice compartilhado
 * (Gestão de OF, Fábrica 1, Fábrica 2, Pedidos).
 */
export interface ScheduleQueueRow extends SchedulingLoadRow {
  orderId: string;
  /** Processo da OF concluído em todos os itens aplicáveis. */
  processConcluded: boolean;
  /** Conclusão efetiva do processo, quando conhecida. */
  processCompletedAt: string | null;
  /** OF já teve a expedição concluída (sai da fila, não ocupa capacidade). */
  expConcluded: boolean;
  /** Conclusão efetiva do EXP — data de expedição de quem já foi expedido. */
  expCompletedAt: string | null;
}

/** Fila crua de UM processo (ordem global já aplicada pelo banco). */
export interface ProcessScheduleQueue {
  processId: string;
  processCode: string;
  anchorDate: string;
  rows: ScheduleQueueRow[];
}

/**
 * Índice de datas previstas por OF, compartilhado pelas telas: a janela de
 * cada processo vem da fila do sequenciamento (seq global + âncora +
 * capacidade), não da data de entrega.
 */
export interface OrderScheduleIndex {
  /** orderId -> código do processo -> janela prevista. */
  windowsByOrder: Record<string, Record<string, ProcessScheduleWindow>>;
  /** orderId -> dia útil após a cadeia ou data efetiva, se já expedida. */
  expeditionByOrder: Record<string, string | null>;
}
