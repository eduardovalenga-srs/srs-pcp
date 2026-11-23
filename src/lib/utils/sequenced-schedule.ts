import { SHIPMENT_PROCESS_CODE } from "@/lib/constants/processes";
import type {
  OrderScheduleIndex,
  ProcessScheduleQueue,
  ProcessScheduleWindow,
} from "@/lib/types/scheduling";
import { businessISODate } from "@/lib/utils/dates";
import { computeScheduleRows } from "@/lib/utils/scheduling";

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
 *  - a data de expedição planejada é o FIM da janela do EXP;
 *  - processo sem peso/família/capacidade não ganha janela (fica "—").
 */
export function buildScheduleIndex(queues: readonly ProcessScheduleQueue[]): OrderScheduleIndex {
  const windowsByOrder: Record<string, Record<string, ProcessScheduleWindow>> = {};
  const expeditionByOrder: Record<string, string | null> = {};

  for (const queue of queues) {
    const scheduled = computeScheduleRows(queue.rows, queue.anchorDate);

    for (const row of scheduled) {
      const orderWindows = (windowsByOrder[row.orderId] ??= {});

      if (row.expConcluded) {
        // OF já expedida: a DP é a conclusão efetiva do EXP.
        expeditionByOrder[row.orderId] = businessISODate(row.expCompletedAt);
      }

      if (row.processConcluded) {
        // Processo concluído não consome capacidade; exibe a data efetiva
        // para que as demais etapas concluídas também tenham uma data.
        const completedDate = businessISODate(row.processCompletedAt);
        if (completedDate) {
          orderWindows[queue.processCode] = {
            start: completedDate,
            end: completedDate,
          };
        }
        continue;
      }

      if (row.expConcluded) continue;

      if (!row.startDate || !row.endDate) continue;

      orderWindows[queue.processCode] = { start: row.startDate, end: row.endDate };

      if (queue.processCode === SHIPMENT_PROCESS_CODE) {
        expeditionByOrder[row.orderId] = row.endDate;
      }
    }
  }

  return { windowsByOrder, expeditionByOrder };
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
