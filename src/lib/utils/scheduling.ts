import type {
  ProcessScheduleQueue,
  ScheduledWindow,
  SchedulingLoadRow,
  SchedulingOrderRow,
} from "@/lib/types/scheduling";
import type { ProcessDefinition } from "@/lib/types/production";
import {
  addBusinessDays,
  addDaysToISODate,
  businessISODate,
  isValidISODate,
} from "@/lib/utils/dates";

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

export interface ProductionChainSchedule {
  /** orderId -> código do processo -> janela prevista/efetiva. */
  windowsByOrder: Record<string, Record<string, ScheduledWindow>>;
  /** orderId -> fim da última etapa aplicável (ou expedição efetiva). */
  expeditionByOrder: Record<string, string | null>;
}

/**
 * Calcula as datas da cadeia de fabricação, respeitando sequência global,
 * capacidade, lead time e dependência entre etapas.
 *
 * `queues` contém somente processos aplicáveis às OFs e vem ordenado pelo
 * display_order do catálogo. Em cada processo, o prazo final é o maior entre
 * a carga calculada em dias úteis e o lead time cadastrado em dias corridos.
 * O próximo processo começa no próximo dia útil após a etapa anterior.
 */
export function computeProductionChainSchedule(
  queues: readonly ProcessScheduleQueue[],
  processes: readonly Pick<ProcessDefinition, "id" | "code" | "displayOrder" | "durationDays">[],
  preferredOrderIds: readonly string[] = [],
  anchorOverride?: { processId: string; anchorDate: string } | null,
): ProductionChainSchedule {
  const result: ProductionChainSchedule = {
    windowsByOrder: {},
    expeditionByOrder: {},
  };
  const previousProcessEndByOrder = new Map<string, string | null>();
  const preferredPosition = new Map(
    preferredOrderIds.map((orderId, index) => [orderId, index]),
  );
  const processById = new Map(processes.map((process) => [process.id, process]));
  const processByCode = new Map(processes.map((process) => [process.code, process]));
  const queuesInProcessOrder = queues
    .map((queue, index) => ({ queue, index }))
    .sort((left, right) => {
      const leftOrder = processById.get(left.queue.processId)?.displayOrder
        ?? processByCode.get(left.queue.processCode)?.displayOrder
        ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = processById.get(right.queue.processId)?.displayOrder
        ?? processByCode.get(right.queue.processCode)?.displayOrder
        ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    });

  for (const { queue } of queuesInProcessOrder) {
    const process = processById.get(queue.processId) ?? processByCode.get(queue.processCode);
    const anchorDate = anchorOverride?.processId === queue.processId
      ? anchorOverride.anchorDate
      : queue.anchorDate;
    const durationDays = normalizeDuration(process?.durationDays ?? 1);
    let cumulativeDays = 0;
    const indexedRows = queue.rows.map((row, index) => ({ row, index }));
    indexedRows.sort((left, right) => {
      const leftPosition = preferredPosition.get(left.row.orderId) ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = preferredPosition.get(right.row.orderId) ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition || left.index - right.index;
    });

    for (const { row } of indexedRows) {
      const previousProcessEnd = previousProcessEndByOrder.get(row.orderId);
      const orderWindows = (result.windowsByOrder[row.orderId] ??= {});

      if (row.expConcluded) {
        const completedDate = businessISODate(row.expCompletedAt);
        orderWindows[queue.processCode] = {
          loadDays: 0,
          startDate: completedDate,
          endDate: completedDate,
          issue: null,
        };
        result.expeditionByOrder[row.orderId] = completedDate;
        previousProcessEndByOrder.set(row.orderId, completedDate);
        continue;
      }

      if (row.processConcluded) {
        const completedDate = businessISODate(row.processCompletedAt);
        orderWindows[queue.processCode] = {
          loadDays: 0,
          startDate: completedDate,
          endDate: completedDate,
          issue: null,
        };
        previousProcessEndByOrder.set(row.orderId, completedDate);
        result.expeditionByOrder[row.orderId] = completedDate;
        continue;
      }

      // Se uma etapa anterior aplicável não pôde ser datada, não inventamos
      // uma data para esta ou para as etapas seguintes.
      if (previousProcessEnd === null) {
        previousProcessEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow(
          "Etapa anterior sem data prevista",
        );
        result.expeditionByOrder[row.orderId] = null;
        continue;
      }

      const issue = schedulingIssue(row);
      if (!isValidISODate(anchorDate) || issue) {
        previousProcessEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow(
          !isValidISODate(anchorDate)
            ? "Data de início inválida"
            : issue ?? "Dados de agendamento inválidos",
        );
        result.expeditionByOrder[row.orderId] = null;
        continue;
      }

      const readyDate = previousProcessEnd === undefined
        ? addBusinessDays(anchorDate, 0)
        : nextBusinessDayAfter(previousProcessEnd);
      if (readyDate === null) {
        previousProcessEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow(
          "Etapa anterior sem data prevista",
        );
        result.expeditionByOrder[row.orderId] = null;
        continue;
      }
      const effectiveStart = laterISODate(addBusinessDays(anchorDate, 0), readyDate);
      const readyOffset = businessDayOffset(anchorDate, effectiveStart);

      if (readyOffset === null) {
        previousProcessEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow(
          "Não foi possível determinar a data de início",
        );
        result.expeditionByOrder[row.orderId] = null;
        continue;
      }

      const loadDays = (row.weightKg as number) / (row.capacityKg as number);
      const startOffset = Math.max(cumulativeDays, readyOffset);
      const startDate = addBusinessDays(anchorDate, Math.floor(startOffset));
      cumulativeDays = startOffset + loadDays;
      const endOffset = Math.max(
        Math.ceil(cumulativeDays) - 1,
        Math.floor(startOffset),
      );
      const capacityEndDate = addBusinessDays(anchorDate, endOffset);
      const leadTimeEndDate = addDaysToISODate(startDate, durationDays - 1);
      const endDate = laterISODate(capacityEndDate, leadTimeEndDate);

      orderWindows[queue.processCode] = {
        loadDays,
        startDate,
        endDate,
        issue: null,
      };
      previousProcessEndByOrder.set(row.orderId, endDate);
      result.expeditionByOrder[row.orderId] = endDate;
    }
  }

  return result;
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

/** Início no próximo dia útil depois do fim efetivo da etapa anterior. */
function nextBusinessDayAfter(date: string): string | null {
  if (!isValidISODate(date)) return null;
  const nextBusinessDate = addBusinessDays(date, 0);
  return nextBusinessDate === date
    ? addBusinessDays(date, 1)
    : nextBusinessDate;
}

function laterISODate(first: string, second: string): string {
  return first >= second ? first : second;
}

function normalizeDuration(days: number): number {
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 1;
}

function unavailableWindow(issue: string): ScheduledWindow {
  return { loadDays: null, startDate: null, endDate: null, issue };
}

function schedulingIssue(row: SchedulingLoadRow): string | null {
  if (row.weightKg === null || row.weightKg <= 0) return "OF sem peso calculado";
  if (row.productGroupId === null) return "OF sem família cadastrada";
  if (row.capacityKg === null || row.capacityKg <= 0) {
    return "Sem capacidade em kg/dia para este processo";
  }
  return null;
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
