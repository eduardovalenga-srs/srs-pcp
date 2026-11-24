import type {
  ProcessScheduleQueue,
  ScheduledWindow,
  SchedulingLoadRow,
  SchedulingOrderRow,
} from "@/lib/types/scheduling";
import { addBusinessDays, businessISODate, isValidISODate } from "@/lib/utils/dates";

/**
 * Calcula a carga e as datas previstas de uma fila já ordenada.
 *
 * Modelo da planilha de sequenciamento: cada OF consome
 * `peso ÷ capacidade` dias úteis. A carga é ACUMULADA (permite fração):
 * a OF começa no dia útil de `floor(acumulado)` e termina no dia útil de
 * `ceil(acumulado + carga) - 1`, contados a partir da data de início.
 * OFs sem peso/capacidade não ocupam dias e ficam sinalizadas — nunca
 * recebem um valor padrão silencioso.
 *
 * Genérica na linha de entrada: a tela de Sequenciamento usa as linhas
 * completas (`ScheduledOrderRow`) e o índice de datas das demais telas usa
 * só a carga por OF (`ScheduleQueueRow`).
 */
export function computeScheduleRows<T extends SchedulingLoadRow>(
  rows: readonly T[],
  anchorDate: string,
): Array<T & ScheduledWindow> {
  let cumulativeDays = 0;

  return rows.map((row) => {
    if (!isValidISODate(anchorDate)) {
      return { ...row, loadDays: null, startDate: null, endDate: null, issue: "Data de início inválida" };
    }

    if (row.weightKg === 0) {
      return { ...row, loadDays: 0, startDate: null, endDate: null, issue: null };
    }

    if (row.weightKg === null || row.weightKg <= 0) {
      return { ...row, loadDays: null, startDate: null, endDate: null, issue: "OF sem peso calculado" };
    }

    if (row.productGroupId === null) {
      return {
        ...row,
        loadDays: null,
        startDate: null,
        endDate: null,
        issue: "OF sem família cadastrada",
      };
    }

    if (row.capacityKg === null || row.capacityKg <= 0) {
      return {
        ...row,
        loadDays: null,
        startDate: null,
        endDate: null,
        issue: "Sem capacidade em kg/dia para este processo",
      };
    }

    const loadDays = row.weightKg / row.capacityKg;
    const startDate = addBusinessDays(anchorDate, Math.floor(cumulativeDays));
    cumulativeDays += loadDays;
    const endDate = addBusinessDays(
      anchorDate,
      Math.max(Math.ceil(cumulativeDays) - 1, Math.floor(cumulativeDays - loadDays)),
    );

    return { ...row, loadDays, startDate, endDate, issue: null };
  });
}

/**
 * Calcula a previsão de expedição encadeando os processos da fábrica.
 *
 * A ordem das filas recebidas deve ser a ordem de fabricação dos processos
 * (display_order). Dentro de cada fila, os pedidos respeitam a sequência
 * recebida do banco; `preferredOrderIds` permite refletir reordenações ainda
 * não salvas na tela.
 *
 * Cada processo respeita sua própria âncora e capacidade. Uma OF só pode
 * iniciar a etapa seguinte após concluir sua etapa aplicável anterior, e
 * aguarda também a capacidade acumulada da fila atual.
 */
export function computeSequentialExpeditionDates(
  queues: readonly ProcessScheduleQueue[],
  preferredOrderIds: readonly string[] = [],
): Record<string, string | null> {
  const expeditionDates: Record<string, string | null> = {};
  const previousProcessEndByOrder = new Map<string, string | null>();
  const preferredPosition = new Map(
    preferredOrderIds.map((orderId, index) => [orderId, index]),
  );

  for (const queue of queues) {
    let cumulativeDays = 0;
    const indexedRows = queue.rows.map((row, index) => ({ row, index }));
    indexedRows.sort((left, right) => {
      const leftPosition = preferredPosition.get(left.row.orderId) ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = preferredPosition.get(right.row.orderId) ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition || left.index - right.index;
    });

    for (const { row } of indexedRows) {
      const previousProcessEnd = previousProcessEndByOrder.get(row.orderId);

      if (row.expConcluded) {
        expeditionDates[row.orderId] = businessISODate(row.expCompletedAt);
        previousProcessEndByOrder.set(row.orderId, businessISODate(row.expCompletedAt));
        continue;
      }

      if (row.processConcluded) {
        const completedDate = businessISODate(row.processCompletedAt);
        previousProcessEndByOrder.set(row.orderId, completedDate);
        expeditionDates[row.orderId] = completedDate;
        continue;
      }

      // Se uma etapa anterior aplicável não pôde ser datada, não inventamos
      // uma data para esta ou para as etapas seguintes.
      if (previousProcessEnd === null) {
        previousProcessEndByOrder.set(row.orderId, null);
        expeditionDates[row.orderId] = null;
        continue;
      }

      if (
        !isValidISODate(queue.anchorDate) ||
        row.weightKg === null ||
        row.weightKg <= 0 ||
        row.productGroupId === null ||
        row.capacityKg === null ||
        row.capacityKg <= 0
      ) {
        previousProcessEndByOrder.set(row.orderId, null);
        expeditionDates[row.orderId] = null;
        continue;
      }

      const readyOffset = previousProcessEnd === undefined
        ? 0
        : businessDayOffset(queue.anchorDate, previousProcessEnd);

      if (readyOffset === null) {
        previousProcessEndByOrder.set(row.orderId, null);
        expeditionDates[row.orderId] = null;
        continue;
      }

      const loadDays = row.weightKg / row.capacityKg;
      const startOffset = Math.max(cumulativeDays, readyOffset);
      cumulativeDays = startOffset + loadDays;
      const endOffset = Math.max(
        Math.ceil(cumulativeDays) - 1,
        Math.floor(startOffset),
      );
      const endDate = addBusinessDays(queue.anchorDate, endOffset);

      previousProcessEndByOrder.set(row.orderId, endDate);
      expeditionDates[row.orderId] = endDate;
    }
  }

  return expeditionDates;
}

/** Dias úteis entre a âncora e a primeira data em que a OF está disponível. */
function businessDayOffset(anchorDate: string, readyDate: string): number | null {
  if (!isValidISODate(anchorDate) || !isValidISODate(readyDate)) return null;

  let current = addBusinessDays(anchorDate, 0);
  const target = addBusinessDays(readyDate, 0);
  if (target <= current) return 0;

  let offset = 0;
  while (current < target) {
    current = addBusinessDays(current, 1);
    offset += 1;
  }
  return offset;
}

/**
 * Move uma OF para a posição solicitada e desloca as demais sem criar
 * posições duplicadas.
 */
export function moveSchedulingRow(
  rows: readonly SchedulingOrderRow[],
  orderId: string,
  position: number,
): SchedulingOrderRow[] {
  if (!Number.isInteger(position) || position < 1 || position > rows.length) {
    return [...rows];
  }

  const currentIndex = rows.findIndex((row) => row.orderId === orderId);
  if (currentIndex < 0 || currentIndex === position - 1) return [...rows];

  const next = [...rows];
  const [moved] = next.splice(currentIndex, 1);
  if (!moved) return next;
  next.splice(position - 1, 0, moved);
  return next;
}

/** Carga em dias com uma casa decimal (ex.: 1,9). */
export function formatLoadDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}
