import type {
  ProcessScheduleQueue,
  ScheduleQueueRow,
  ScheduledWindow,
  SchedulingLoadRow,
  SchedulingOrderRow,
} from "@/lib/types/scheduling";
import type { ProcessDefinition } from "@/lib/types/production";
import {
  addBusinessDays,
  businessISODate,
  isValidISODate,
  isBusinessDay,
  previousBusinessDay,
  subBusinessDays,
} from "@/lib/utils/dates";
import { MP_PROCESS_CODE } from "@/lib/constants/processes";

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
  /** orderId -> dia útil após a conclusão da última etapa (ou expedição efetiva). */
  expeditionByOrder: Record<string, string | null>;
  /** orderId -> um dia útil antes do primeiro processo de fabricação. */
  materialReceiptByOrder: Record<string, string | null>;
}

/**
 * Calcula as datas da cadeia de fabricação, respeitando sequência global,
 * capacidade, lead time e dependência entre etapas.
 *
 * `queues` contém somente processos aplicáveis às OFs e vem ordenado pelo
 * display_order do catálogo. A duração cadastrada e a carga por capacidade
 * são ambas contabilizadas em dias úteis. Com uma âncora selecionada, a fila
 * desse processo é calculada para frente, as etapas posteriores seguem a
 * cadeia e as anteriores são recalculadas para trás, preservando a capacidade
 * e a ordem global de cada fila.
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
    materialReceiptByOrder: {},
  };
  const preferredPosition = new Map(
    preferredOrderIds.map((orderId, index) => [orderId, index]),
  );
  const processById = new Map(processes.map((process) => [process.id, process]));
  const processByCode = new Map(processes.map((process) => [process.code, process]));
  // MP continua aparecendo na coluna de status/recebimento, mas não consome
  // capacidade nem participa das dependências entre processos produtivos.
  const processQueues = queues
    .filter((queue) => queue.processCode !== MP_PROCESS_CODE)
    .map((queue, index) => ({ queue, index }))
    .sort((left, right) => {
      const leftOrder = processById.get(left.queue.processId)?.displayOrder
        ?? processByCode.get(left.queue.processCode)?.displayOrder
        ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = processById.get(right.queue.processId)?.displayOrder
        ?? processByCode.get(right.queue.processCode)?.displayOrder
        ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ queue }) => {
      const process = processById.get(queue.processId) ?? processByCode.get(queue.processCode);
      const rows = queue.rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftPosition = preferredPosition.get(left.row.orderId) ?? Number.MAX_SAFE_INTEGER;
          const rightPosition = preferredPosition.get(right.row.orderId) ?? Number.MAX_SAFE_INTEGER;
          return leftPosition - rightPosition || left.index - right.index;
        })
        .map(({ row }) => row);

      return {
        queue,
        rows,
        rowsByOrderId: new Map(rows.map((row) => [row.orderId, row])),
        durationDays: normalizeDuration(process?.durationDays ?? 1),
      };
    });

  const fixedAnchorIndex = anchorOverride
    ? processQueues.findIndex((plan) => plan.queue.processId === anchorOverride.processId)
    : -1;
  const shippedDateByOrder = new Map<string, string | null>();

  if (fixedAnchorIndex < 0) {
    scheduleForwardRange(
      processQueues,
      0,
      processQueues.length,
      new Map(),
      result.windowsByOrder,
      shippedDateByOrder,
      null,
    );
  } else {
    // Primeiro calcula a partir do processo fixado, para que haja datas-alvo
    // para as etapas anteriores e para OFs que não passam por esse processo.
    scheduleForwardRange(
      processQueues,
      fixedAnchorIndex,
      processQueues.length,
      new Map(),
      result.windowsByOrder,
      shippedDateByOrder,
      anchorOverride ?? null,
    );

    // Recalcula as etapas anteriores de trás para frente, por fila, usando o
    // início previsto da próxima etapa aplicável como prazo de conclusão.
    for (let index = fixedAnchorIndex - 1; index >= 0; index -= 1) {
      const plan = processQueues[index];
      if (!plan) continue;
      scheduleBackwardQueue(processQueues, index, plan, result.windowsByOrder);
    }

    const previousEndByOrder = new Map<string, string | null>();
    const blockedOrders = new Set<string>();
    for (let index = 0; index < fixedAnchorIndex; index += 1) {
      const plan = processQueues[index];
      if (!plan) continue;
      for (const row of plan.rows) {
        const window = result.windowsByOrder[row.orderId]?.[plan.queue.processCode];
        if (!window || window.issue || !window.endDate) {
          blockedOrders.add(row.orderId);
        } else {
          previousEndByOrder.set(row.orderId, window.endDate);
        }
      }
    }
    for (const orderId of blockedOrders) previousEndByOrder.set(orderId, null);

    // A primeira passagem era apenas para obter prazos. Remova-a e gere de
    // novo a cadeia para frente usando as etapas anteriores recalculadas.
    for (let index = fixedAnchorIndex; index < processQueues.length; index += 1) {
      const plan = processQueues[index];
      if (!plan) continue;
      for (const row of plan.rows) {
        delete result.windowsByOrder[row.orderId]?.[plan.queue.processCode];
      }
    }
    shippedDateByOrder.clear();
    scheduleForwardRange(
      processQueues,
      fixedAnchorIndex,
      processQueues.length,
      previousEndByOrder,
      result.windowsByOrder,
      shippedDateByOrder,
      anchorOverride ?? null,
    );
  }

  for (const plan of processQueues) {
    for (const row of plan.rows) {
      if (row.expConcluded) {
        shippedDateByOrder.set(row.orderId, businessISODate(row.expCompletedAt));
      }
    }
  }
  result.expeditionByOrder = calculateExpeditionDates(
    processQueues,
    result.windowsByOrder,
    shippedDateByOrder,
  );

  // A MP deve estar disponível no dia útil anterior ao primeiro processo
  // produtivo aplicável. O estado da MP continua vindo do recebimento real.
  const productiveQueues = processQueues.map(({ queue }) => queue);
  const ordersWithMp = new Set(
    queues
      .filter((queue) => queue.processCode === MP_PROCESS_CODE)
      .flatMap((queue) => queue.rows.map((row) => row.orderId)),
  );
  for (const orderId of ordersWithMp) {
    for (const queue of productiveQueues) {
      const firstProcess = result.windowsByOrder[orderId]?.[queue.processCode];
      if (firstProcess?.startDate) {
        const receiptDate = previousBusinessDay(firstProcess.startDate);
        result.materialReceiptByOrder[orderId] = receiptDate;
        // Mantém a janela MP disponível às telas que exibem a data prevista
        // junto do status/recebimento real, sem tratar MP como carga produtiva.
        result.windowsByOrder[orderId]![MP_PROCESS_CODE] = {
          loadDays: 0,
          startDate: receiptDate,
          endDate: receiptDate,
          issue: null,
        };
        break;
      }
    }
    result.materialReceiptByOrder[orderId] ??= null;
  }

  return result;
}

interface ProcessQueuePlan {
  queue: ProcessScheduleQueue;
  rows: ScheduleQueueRow[];
  rowsByOrderId: Map<string, ScheduleQueueRow>;
  durationDays: number;
}

function scheduleForwardRange(
  plans: readonly ProcessQueuePlan[],
  startIndex: number,
  endIndex: number,
  previousEndByOrder: Map<string, string | null>,
  windowsByOrder: ProductionChainSchedule["windowsByOrder"],
  shippedDateByOrder: Map<string, string | null>,
  anchorOverride: { processId: string; anchorDate: string } | null,
): void {
  for (let index = startIndex; index < endIndex; index += 1) {
    const plan = plans[index];
    if (!plan) continue;
    const { queue, rows, durationDays } = plan;
    const isFixedAnchorQueue = anchorOverride?.processId === queue.processId;
    const anchorDate = isFixedAnchorQueue ? anchorOverride.anchorDate : queue.anchorDate;
    let cumulativeDays = 0;

    for (const row of rows) {
      const previousProcessEnd = previousEndByOrder.get(row.orderId);
      const orderWindows = (windowsByOrder[row.orderId] ??= {});

      if (row.expConcluded) {
        const completedDate = businessISODate(row.expCompletedAt);
        orderWindows[queue.processCode] = {
          loadDays: 0,
          startDate: completedDate,
          endDate: completedDate,
          issue: null,
        };
        shippedDateByOrder.set(row.orderId, completedDate);
        previousEndByOrder.set(row.orderId, completedDate);
        continue;
      }

      if (row.processConcluded) {
        const completedDate = businessISODate(row.processCompletedAt);
        orderWindows[queue.processCode] = completedDate
          ? { loadDays: 0, startDate: completedDate, endDate: completedDate, issue: null }
          : unavailableWindow("Data de conclusão do processo ausente");
        previousEndByOrder.set(row.orderId, completedDate);
        continue;
      }

      if (previousProcessEnd === null && !isFixedAnchorQueue) {
        previousEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow("Etapa anterior sem data prevista");
        continue;
      }

      const rowIssue = schedulingIssue(row);
      const anchorIssue = !isValidISODate(anchorDate)
        ? "Data de início inválida"
        : isFixedAnchorQueue && !isBusinessDay(anchorDate)
          ? "A data fixa deve ser um dia útil"
          : null;
      if (anchorIssue || rowIssue) {
        previousEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow(
          anchorIssue ?? rowIssue ?? "Dados de agendamento inválidos",
        );
        continue;
      }

      const readyDate = previousProcessEnd === undefined
        ? addBusinessDays(anchorDate, 0)
        : previousProcessEnd === null
          ? null
          : nextBusinessDayAfter(previousProcessEnd);
      if (readyDate === null && !isFixedAnchorQueue) {
        previousEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow("Etapa anterior sem data prevista");
        continue;
      }

      const fixedStartDate = addBusinessDays(anchorDate, 0);
      const effectiveStart = isFixedAnchorQueue
        ? fixedStartDate
        : laterISODate(fixedStartDate, readyDate ?? fixedStartDate);
      const readyOffset = businessDayOffset(anchorDate, effectiveStart);
      if (readyOffset === null) {
        previousEndByOrder.set(row.orderId, null);
        orderWindows[queue.processCode] = unavailableWindow(
          "Não foi possível determinar a data de início",
        );
        continue;
      }

      const loadDays = (row.weightKg as number) / (row.capacityKg as number);
      const startOffset = isFixedAnchorQueue
        ? cumulativeDays
        : Math.max(cumulativeDays, readyOffset);
      const startDate = addBusinessDays(anchorDate, Math.floor(startOffset));
      cumulativeDays = startOffset + loadDays;
      const capacityEndDate = addBusinessDays(
        anchorDate,
        Math.max(Math.ceil(cumulativeDays) - 1, Math.floor(startOffset)),
      );
      const durationEndDate = addBusinessDays(startDate, durationDays - 1);
      const endDate = laterISODate(capacityEndDate, durationEndDate);
      const startConflict =
        isFixedAnchorQueue &&
        (previousProcessEnd === null ||
          (previousProcessEnd !== undefined && readyDate !== null && readyDate > startDate));
      const issue = startConflict
        ? previousProcessEnd === null
          ? "Etapa anterior sem data prevista; a data fixa não pode ser validada"
          : "Etapa anterior termina após a data fixa deste processo"
        : null;

      orderWindows[queue.processCode] = { loadDays, startDate, endDate, issue };
      previousEndByOrder.set(row.orderId, issue ? null : endDate);
    }
  }
}

function scheduleBackwardQueue(
  plans: readonly ProcessQueuePlan[],
  index: number,
  plan: ProcessQueuePlan,
  windowsByOrder: ProductionChainSchedule["windowsByOrder"],
): void {
  const { queue, rows, durationDays } = plan;
  const nextWindowByOrder = new Map<string, ScheduledWindow | undefined>();

  for (const row of rows) {
    for (let nextIndex = index + 1; nextIndex < plans.length; nextIndex += 1) {
      const nextPlan = plans[nextIndex];
      if (!nextPlan?.rowsByOrderId.has(row.orderId)) continue;
      nextWindowByOrder.set(
        row.orderId,
        windowsByOrder[row.orderId]?.[nextPlan.queue.processCode],
      );
      break;
    }
  }

  const workRows: Array<{
    row: ScheduleQueueRow;
    loadDays: number;
    prefixDays: number;
    startOffset: number;
    endOffset: number;
    deadline: string | null;
    releaseDate: string | null;
  }> = [];
  let cumulativeDays = 0;
  let hasPredecessorDateIssue = false;

  for (const row of rows) {
    const orderWindows = (windowsByOrder[row.orderId] ??= {});
    const nextWindow = nextWindowByOrder.get(row.orderId);
    const deadline =
      nextWindow && !nextWindow.issue && nextWindow.startDate
        ? previousBusinessDay(nextWindow.startDate)
        : null;

    if (row.expConcluded) {
      const completedDate = businessISODate(row.expCompletedAt);
      orderWindows[queue.processCode] = {
        loadDays: 0,
        startDate: completedDate,
        endDate: completedDate,
        issue: null,
      };
      continue;
    }

    if (row.processConcluded) {
      const completedDate = businessISODate(row.processCompletedAt);
      const nextStartDate = nextWindow?.startDate;
      const nextWorkday =
        completedDate && deadline ? nextBusinessDayAfter(completedDate) : null;
      const completionIssue =
        nextWorkday && nextStartDate && nextWorkday > nextStartDate
          ? "Processo concluído após o início previsto da etapa seguinte"
          : null;
      orderWindows[queue.processCode] = completedDate
        ? { loadDays: 0, startDate: completedDate, endDate: completedDate, issue: completionIssue }
        : unavailableWindow("Data de conclusão do processo ausente");
      continue;
    }

    const issue = schedulingIssue(row);
    if (issue) {
      orderWindows[queue.processCode] = unavailableWindow(issue);
      continue;
    }

    const release = releaseAfterCompletedPredecessor(plans, index, row.orderId);
    if (release.issue) {
      orderWindows[queue.processCode] = unavailableWindow(release.issue);
      hasPredecessorDateIssue = true;
      continue;
    }

    const loadDays = (row.weightKg as number) / (row.capacityKg as number);
    const prefixDays = cumulativeDays;
    cumulativeDays += loadDays;
    const capacityEndOffset = Math.max(
      Math.ceil(cumulativeDays) - 1,
      Math.floor(prefixDays),
    );
    const durationEndOffset = Math.floor(prefixDays) + durationDays - 1;
    workRows.push({
      row,
      loadDays,
      prefixDays,
      startOffset: Math.floor(prefixDays),
      endOffset: Math.max(capacityEndOffset, durationEndOffset),
      deadline,
      releaseDate: release.date,
    });
  }

  const constrainedRows = workRows.filter((row) => row.deadline !== null);
  const releaseRows = workRows.filter((row) => row.releaseDate !== null);
  if (
    constrainedRows.length === 0 &&
    releaseRows.length === 0 &&
    !hasPredecessorDateIssue
  ) {
    scheduleUnanchoredQueueForward(plan, windowsByOrder);
    return;
  }

  const latestBaseDate = constrainedRows.length
    ? constrainedRows
      .map((row) => subBusinessDays(row.deadline as string, row.endOffset))
      .reduce((earliest, date) => (date < earliest ? date : earliest))
    : null;
  const earliestBaseDate = releaseRows.length
    ? releaseRows
      .map((row) => subBusinessDays(row.releaseDate as string, row.startOffset))
      .reduce((latest, date) => (date > latest ? date : latest))
    : null;
  const queueAnchorDate = isValidISODate(queue.anchorDate)
    ? addBusinessDays(queue.anchorDate, 0)
    : null;
  let baseDate: string | null;
  if (!latestBaseDate) {
    baseDate = earliestBaseDate
      ? laterISODate(earliestBaseDate, queueAnchorDate ?? earliestBaseDate)
      : queueAnchorDate;
  } else {
    const constraintDates = [
      ...constrainedRows.map((row) => row.deadline as string),
      ...releaseRows.map((row) => row.releaseDate as string),
    ];
    const earliestConstraintDate = constraintDates.reduce((earliest, date) =>
      date < earliest ? date : earliest,
    );
    const searchBackDays =
      Math.ceil(workRows.reduce((sum, row) => sum + row.loadDays, 0)) + durationDays + 2;
    const earliestSearchDate = subBusinessDays(earliestConstraintDate, searchBackDays);
    const searchSpan = businessDayOffset(earliestSearchDate, latestBaseDate) ?? 0;
    const lowerSchedule = scheduleBackwardRowsAtBase(workRows, earliestSearchDate, durationDays);

    if (!lowerSchedule.feasible) {
      // Se nem a busca mais antecipada satisfaz marcos reais e prazos, a
      // cadeia é inviável. Mantemos a previsão mais tardia possível e o
      // helper marca as OFs que não cabem na janela.
      baseDate = latestBaseDate;
    } else {
      let low = 0;
      let high = Math.max(0, searchSpan);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = addBusinessDays(earliestSearchDate, middle);
        if (scheduleBackwardRowsAtBase(workRows, candidate, durationDays).feasible) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      baseDate = addBusinessDays(earliestSearchDate, low);
    }
  }

  if (!baseDate) {
    for (const row of workRows) {
      windowsByOrder[row.row.orderId]![queue.processCode] = unavailableWindow(
        "Data de início inválida",
      );
    }
    return;
  }

  const scheduled = scheduleBackwardRowsAtBase(workRows, baseDate, durationDays);
  for (const row of workRows) {
    windowsByOrder[row.row.orderId]![queue.processCode] =
      scheduled.windows.get(row.row.orderId) ??
      unavailableWindow("Não foi possível determinar a data");
  }
}

function scheduleBackwardRowsAtBase(
  workRows: readonly {
    row: ScheduleQueueRow;
    loadDays: number;
    deadline: string | null;
    releaseDate: string | null;
  }[],
  baseDate: string,
  durationDays: number,
): { windows: Map<string, ScheduledWindow>; feasible: boolean } {
  const windows = new Map<string, ScheduledWindow>();
  let cumulativeDays = 0;
  let feasible = true;

  for (const row of workRows) {
    const releaseOffset = row.releaseDate
      ? businessDayOffset(baseDate, row.releaseDate) ?? 0
      : 0;
    const startOffset = Math.max(cumulativeDays, releaseOffset);
    const startDate = addBusinessDays(baseDate, Math.floor(startOffset));
    cumulativeDays = startOffset + row.loadDays;
    const capacityEndDate = addBusinessDays(
      baseDate,
      Math.max(Math.ceil(cumulativeDays) - 1, Math.floor(startOffset)),
    );
    const durationEndDate = addBusinessDays(startDate, durationDays - 1);
    const endDate = laterISODate(capacityEndDate, durationEndDate);
    const startsBeforeRelease = row.releaseDate !== null && startDate < row.releaseDate;
    const missesDeadline = row.deadline !== null && endDate > row.deadline;
    const issue = startsBeforeRelease
      ? "A etapa começa antes da conclusão da etapa anterior"
      : missesDeadline
        ? row.releaseDate
          ? "A conclusão da etapa anterior não cabe antes do prazo da próxima etapa"
          : "A capacidade desta etapa não permite terminar antes da próxima"
        : null;

    if (issue) feasible = false;
    windows.set(row.row.orderId, {
      loadDays: row.loadDays,
      startDate,
      endDate,
      issue,
    });
  }

  return { windows, feasible };
}

function releaseAfterCompletedPredecessor(
  plans: readonly ProcessQueuePlan[],
  index: number,
  orderId: string,
): { date: string | null; issue: string | null } {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previousPlan = plans[previousIndex];
    const previousRow = previousPlan?.rowsByOrderId.get(orderId);
    if (!previousPlan || !previousRow) continue;

    if (!previousRow.expConcluded && !previousRow.processConcluded) {
      // A etapa pendente mais próxima será calculada retroativamente; ela
      // controla o início deste processo pela própria dependência da cadeia.
      return { date: null, issue: null };
    }

    const completedAt = businessISODate(
      previousRow.expConcluded
        ? previousRow.expCompletedAt
        : previousRow.processCompletedAt,
    );
    if (!completedAt) {
      return {
        date: null,
        issue: "Etapa anterior concluída sem data real de conclusão",
      };
    }

    return { date: nextBusinessDayAfter(completedAt), issue: null };
  }

  return { date: null, issue: null };
}

function scheduleUnanchoredQueueForward(
  plan: ProcessQueuePlan,
  windowsByOrder: ProductionChainSchedule["windowsByOrder"],
): void {
  const { queue, rows, durationDays } = plan;
  let cumulativeDays = 0;

  for (const row of rows) {
    const orderWindows = (windowsByOrder[row.orderId] ??= {});
    if (row.expConcluded || row.processConcluded) {
      const completedDate = businessISODate(
        row.expConcluded ? row.expCompletedAt : row.processCompletedAt,
      );
      orderWindows[queue.processCode] = completedDate
        ? { loadDays: 0, startDate: completedDate, endDate: completedDate, issue: null }
        : unavailableWindow("Data de conclusão do processo ausente");
      continue;
    }

    const issue = schedulingIssue(row);
    if (!isValidISODate(queue.anchorDate) || issue) {
      orderWindows[queue.processCode] = unavailableWindow(
        !isValidISODate(queue.anchorDate)
          ? "Data de início inválida"
          : issue ?? "Dados de agendamento inválidos",
      );
      continue;
    }

    const loadDays = (row.weightKg as number) / (row.capacityKg as number);
    const startOffset = Math.floor(cumulativeDays);
    const startDate = addBusinessDays(queue.anchorDate, startOffset);
    cumulativeDays += loadDays;
    const capacityEndDate = addBusinessDays(
      queue.anchorDate,
      Math.max(Math.ceil(cumulativeDays) - 1, startOffset),
    );
    const durationEndDate = addBusinessDays(startDate, durationDays - 1);
    orderWindows[queue.processCode] = {
      loadDays,
      startDate,
      endDate: laterISODate(capacityEndDate, durationEndDate),
      issue: null,
    };
  }
}

function calculateExpeditionDates(
  plans: readonly ProcessQueuePlan[],
  windowsByOrder: ProductionChainSchedule["windowsByOrder"],
  shippedDateByOrder: ReadonlyMap<string, string | null>,
): Record<string, string | null> {
  const orderIds = new Set(plans.flatMap((plan) => plan.rows.map((row) => row.orderId)));
  const expeditionByOrder: Record<string, string | null> = {};

  for (const orderId of orderIds) {
    if (shippedDateByOrder.has(orderId)) {
      expeditionByOrder[orderId] = shippedDateByOrder.get(orderId) ?? null;
      continue;
    }

    let lastEndDate: string | null = null;
    let hasApplicableProcess = false;
    let blocked = false;
    for (const plan of plans) {
      if (!plan.rowsByOrderId.has(orderId)) continue;
      hasApplicableProcess = true;
      const window = windowsByOrder[orderId]?.[plan.queue.processCode];
      if (!window || window.issue || !window.endDate) {
        blocked = true;
        break;
      }
      lastEndDate = window.endDate;
    }

    expeditionByOrder[orderId] =
      hasApplicableProcess && !blocked && lastEndDate
        ? nextBusinessDayAfter(lastEndDate)
        : null;
  }

  return expeditionByOrder;
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
