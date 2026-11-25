import type {
  OrderScheduleIndex,
  ProcessScheduleQueue,
  ProcessScheduleWindow,
} from "@/lib/types/scheduling";
import type { ProcessDefinition } from "@/lib/types/production";
import { computeProductionChainSchedule } from "@/lib/utils/scheduling";

/** Índice vazio — telas sem fila carregada mostram "—" em todas as datas. */
export const EMPTY_SCHEDULE_INDEX: OrderScheduleIndex = {
  windowsByOrder: {},
  expeditionByOrder: {},
};

/**
 * Constrói o índice de datas previstas por OF a partir das filas do
 * sequenciamento.
 *
 * Cada fila já chega ordenada pela prioridade global (o banco aplica
 * `seq nulls last, entrega, código`). A carga é acumulada por processo,
 * como na tela de Sequenciamento; depois o resultado é transpocado para o
 * formato por OF, que é o que as demais telas exibem.
 *
 * Regras:
 *  - OF com o EXP concluído não ocupa capacidade (peso zero no banco) e
 *    recebe como data de expedição a CONCLUSÃO EFETIVA do EXP;
 *  - a data planejada é o próximo dia útil após o fim da última etapa;
 *  - processo sem peso/família/capacidade não ganha janela (fica "—").
 */
export function buildScheduleIndex(
  queues: readonly ProcessScheduleQueue[],
  processes: readonly Pick<ProcessDefinition, "id" | "code" | "displayOrder" | "durationDays">[],
  anchorOverride?: { processId: string; anchorDate: string } | null,
): OrderScheduleIndex {
  const schedule = computeProductionChainSchedule(queues, processes, [], anchorOverride);
  const windowsByOrder: Record<string, Record<string, ProcessScheduleWindow>> = {};

  for (const [orderId, processWindows] of Object.entries(schedule.windowsByOrder)) {
    const orderWindows = (windowsByOrder[orderId] ??= {});
    for (const [processCode, window] of Object.entries(processWindows)) {
      if (window.issue || !window.startDate || !window.endDate) continue;
      orderWindows[processCode] = { start: window.startDate, end: window.endDate };
    }
  }

  return {
    windowsByOrder,
    expeditionByOrder: schedule.expeditionByOrder,
  };
}

/** Janelas previstas de uma OF (objeto vazio quando ela não está na fila). */
export function windowsForOrder(
  index: OrderScheduleIndex,
  orderId: string,
): Record<string, ProcessScheduleWindow> {
  return index.windowsByOrder[orderId] ?? {};
}

/** Data de expedição de uma OF (null = sem janela/expedição conhecida). */
export function expeditionForOrder(index: OrderScheduleIndex, orderId: string): string | null {
  return index.expeditionByOrder[orderId] ?? null;
}
