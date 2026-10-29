import {
  ACAB_PROCESS_CODE,
  FABRICA1_PROCESS_CODES,
  KIT_PROCESS_CODE,
  MP_PROCESS_CODE,
  SHIPMENT_PROCESS_CODE,
} from "@/lib/constants/processes";
import { PROCESS_STATUSES, type ProcessStatus } from "@/lib/constants/production";
import type { ProductionRow } from "@/lib/types/production";
import { todayISODate } from "@/lib/utils/dates";
import { calculateTotalWeight } from "@/lib/utils/formatting";
import {
  computeProcessSchedule,
  scheduleProcessesForItem,
  type ProcessWindow,
} from "@/lib/utils/process-schedule";

export interface ProcessState {
  processCode: string;
  status: ProcessStatus;
}

export interface OverdueInput {
  /** YYYY-MM-DD */
  deliveryDate: string | null;
  /** Mapa processo -> status do item */
  processStatuses: Readonly<Record<string, ProcessStatus>>;
}

/**
 * REGRA DE ATRASO (item 13, revisada) — a MESMA da coluna `overdue` da RPC
 * `get_production_rows`: atrasado quando a entrega é anterior a hoje E a
 * EXPEDIÇÃO do item ainda não foi concluída (`processStatuses` traz o status
 * por código de processo; EXP concluído nunca fica atrasado).
 * Não considera feriados/fins de semana no MVP.
 */
export function isItemOverdue(
  { deliveryDate, processStatuses }: OverdueInput,
  today = todayISODate(),
): boolean {
  if (!deliveryDate) return false;
  if (deliveryDate >= today) return false;
  return processStatuses[SHIPMENT_PROCESS_CODE] !== "CONCLUIDO";
}

/**
 * REGRA DA COR DE DATA VENCIDA (gestão de entregas):
 * a previsão de um processo fica em VERMELHO quando o início é anterior
 * à data de referência — exceto processo já CONCLUÍDO, cuja data
 * passada é esperada e não é destacada.
 */
export function isProcessStartOverdue(
  startDate: string | null | undefined,
  status: string | null | undefined,
  today: string,
): boolean {
  if (!startDate) return false;
  if (startDate >= today) return false;
  return status !== "CONCLUIDO";
}

/** Dados que o cálculo da janela do ACAB precisa de cada processo do catálogo. */
export interface AcabCatalogProcess {
  code: string;
  displayOrder: number;
  durationDays: number;
}

/**
 * Janela prevista do ACAB de um item da Fábrica 2 — MESMA receita da célula
 * da tabela (`scheduleByItem` em `components/fabrica2/Fabrica2Table`): dias
 * úteis contados de trás para frente a partir da entrega, com o status do
 * processo NO ITEM (`NAO_APLICAVEL` não ocupa dias nem ganha janela).
 * Devolve null quando não há entrega válida ou o item não tem ACAB aplicável.
 */
export function acabWindowForItem(
  item: Pick<ProductionRow, "deliveryDate" | "processes">,
  catalog: readonly AcabCatalogProcess[],
): ProcessWindow | null {
  const statusByCode = new Map(
    Object.entries(item.processes).map(([code, cell]) => [code, cell.status] as const),
  );
  return (
    computeProcessSchedule(
      item.deliveryDate,
      scheduleProcessesForItem(catalog, (code) => statusByCode.get(code)),
    ).get(ACAB_PROCESS_CODE) ?? null
  );
}

/**
 * REGRA DE ATRASO DA FÁBRICA 2 — card "Atrasados" desta tela:
 * o item está atrasado quando a data da coluna ACAB (o INÍCIO previsto da
 * janela, o mesmo valor exibido em vermelho na célula) é ANTERIOR à data de
 * referência.
 *
 * Fora da conta:
 *  - ACAB `CONCLUIDO` (item que já passou pelo acabamento não fica
 *    eternamente "atrasado" — mesma convenção da cor de data vencida);
 *  - ACAB `NAO_APLICAVEL`/ausente no item;
 *  - sem janela calculável (item sem data de entrega).
 *
 * ATENÇÃO: a regra global de atraso por entrega (`isItemOverdue`) continua
 * valendo para as demais telas (gestão de OF e cores da coluna Entrega).
 */
export function isAcabOverdue(
  item: Pick<ProductionRow, "deliveryDate" | "processes">,
  catalog: readonly AcabCatalogProcess[],
  today: string,
): boolean {
  const acab = item.processes[ACAB_PROCESS_CODE];
  if (!acab || acab.status === "NAO_APLICAVEL") return false;

  const window = acabWindowForItem(item, catalog);
  if (!window) return false;

  return isProcessStartOverdue(window.start, acab.status, today);
}

/** Totais de um recorte de itens da Fábrica 2 (registros, Σ qtd., Σ peso). */
export function productionRowsTotals(
  rows: readonly Pick<ProductionRow, "quantity" | "unitWeightKg">[],
): { records: number; qty: number; weight: number } {
  return rows.reduce(
    (totals, row) => {
      totals.records += 1;
      totals.qty += row.quantity;
      totals.weight += calculateTotalWeight(row.quantity, row.unitWeightKg) ?? 0;
      return totals;
    },
    { records: 0, qty: 0, weight: 0 },
  );
}

/**
 * Deriva o status agregado do item a partir dos seus processos e da OP.
 *
 * REGRA DA ORDEM DE PRODUÇÃO (013):
 *  - todos os processos aplicáveis concluídos -> CONCLUIDO
 *    (o progresso vence: a conclusão não depende da OP);
 *  - OP em branco -> PLANEJADO ("em espera"), mesmo que algum processo
 *    já esteja em andamento;
 *  - OP preenchida -> EM_PRODUCAO.
 *
 * Regra 62 (revisada): a marcação em cascata acontece na gravação —
 * `predecessorsToComplete`/`concludedProcessesToReset` dizem quem muda
 * junto; aqui apenas o status do item é derivado para exibição/KPIs.
 */
export function deriveOrderItemStatus(
  processes: readonly ProcessState[],
  op: string | null,
): "PLANEJADO" | "EM_PRODUCAO" | "CONCLUIDO" {
  const applicable = processes.filter((process) => process.status !== "NAO_APLICAVEL");
  if (applicable.length === 0) return "CONCLUIDO";
  if (applicable.every((process) => process.status === "CONCLUIDO")) return "CONCLUIDO";
  if (!op || !op.trim()) return "PLANEJADO";
  return "EM_PRODUCAO";
}

/**
 * Deriva o status agregado do pedido a partir dos status dos seus itens.
 * CANCELADO nunca é derivado (estado final só por ação explícita).
 */
export function deriveOrderStatus(itemStatuses: readonly string[]): "PLANEJADO" | "EM_PRODUCAO" | "CONCLUIDO" {
  if (itemStatuses.length === 0) return "PLANEJADO";
  if (itemStatuses.every((status) => status === "CONCLUIDO")) return "CONCLUIDO";
  if (itemStatuses.some((status) => status === "EM_PRODUCAO")) return "EM_PRODUCAO";
  return "PLANEJADO";
}

/** Total de pendências (processos aplicáveis ainda não concluídos). */
export function countPendingProcesses(processes: readonly ProcessState[]): number {
  return processes.filter(
    (process) => process.status !== "NAO_APLICAVEL" && process.status !== "CONCLUIDO",
  ).length;
}

/** Progresso percentual dos processos aplicáveis (0 a 100). */
export function calculateProgress(processes: readonly ProcessState[]): number {
  const applicable = processes.filter((process) => process.status !== "NAO_APLICAVEL");
  if (applicable.length === 0) return 100;
  const done = applicable.filter((process) => process.status === "CONCLUIDO").length;
  return Math.round((done / applicable.length) * 100);
}

/**
 * Situações que a UI e o serviço aceitam para cada processo.
 *
 * O MP (matéria-prima) é um portão de duas posições: só NAO_INICIADO
 * e CONCLUIDO. A folha de edição lista apenas essas opções e o
 * serviço de atualização rejeita as demais. Os processos sem
 * restrição mantêm o catálogo completo.
 */
const PROCESS_STATUS_RESTRICTIONS: Readonly<Record<string, readonly ProcessStatus[]>> = {
  MP: ["NAO_INICIADO", "CONCLUIDO"],
};

export function allowedProcessStatuses(processCode: string): readonly ProcessStatus[] {
  return PROCESS_STATUS_RESTRICTIONS[processCode] ?? PROCESS_STATUSES;
}

/**
 * Processos que um item pode percorrer (aplicáveis) em ordem fabril.
 *
 * "Não aplicável" fica de fora — a tela Fábrica 1 usa isso para mostrar,
 * por item filho, apenas os processos que podem ser selecionados/acompanhados.
 * Ordena por `displayOrder` (não muta a lista original).
 */
export function applicableProcesses<
  T extends { status: ProcessStatus; displayOrder: number },
>(processes: readonly T[]): T[] {
  return processes
    .filter((process) => process.status !== "NAO_APLICAVEL")
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

/**
 * Linha do tempo de um item: processos aplicáveis na mesma ordem do cálculo
 * de previsão (`computeProcessSchedule`) — `displayOrder` com desempate pelo
 * código. `NAO_APLICAVEL` fica de fora; a lista original não é mutada.
 */
function itemTimeline<
  T extends { code: string; displayOrder: number; status: ProcessStatus },
>(processes: readonly T[]): T[] {
  return processes
    .filter((process) => process.status !== "NAO_APLICAVEL")
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder || left.code.localeCompare(right.code),
    );
}

/**
 * Predecessores a concluir quando `afterCode` vira CONCLUIDO (cascata para
 * frente): os que vêm antes dele na linha do tempo e estão NAO_INICIADO.
 * Já concluídos e não aplicáveis não são tocados; alvo fora da linha do
 * tempo não dispara nada.
 */
export function predecessorsToComplete<
  T extends { code: string; displayOrder: number; status: ProcessStatus },
>(processes: readonly T[], afterCode: string): T[] {
  const timeline = itemTimeline(processes);
  const index = timeline.findIndex((process) => process.code === afterCode);
  if (index < 0) return [];
  return timeline.slice(0, index).filter((process) => process.status === "NAO_INICIADO");
}

/**
 * Processos a devolver a NAO_INICIADO quando `code` sai de CONCLUIDO
 * (reinício da linha — regra 62 revisada): todos os concluídos aplicáveis
 * da linha do tempo, ANTES e DEPOIS do alvo. Alvo fora da linha do tempo
 * (ex.: recém desmarcado como NAO_APLICAVEL) não dispara nada.
 */
export function concludedProcessesToReset<
  T extends { code: string; displayOrder: number; status: ProcessStatus },
>(processes: readonly T[], code: string): T[] {
  const timeline = itemTimeline(processes);
  if (!timeline.some((process) => process.code === code)) return [];
  return timeline.filter((process) => process.code !== code && process.status === "CONCLUIDO");
}

/**
 * Processos exibidos por item na tela Fábrica 1.
 *
 * Regras da tela: o **MP vem primeiro**, seguido dos demais processos
 * aplicáveis em ordem fabril — e **o que vem depois do KIT fica oculto**
 * (pré-montagem, solda, acabamento, qualidade e expedição acontecem no
 * kit montado). Sem KIT no item, a lista segue aberta até o fim.
 */
export function fabrica1ItemProcesses<
  T extends { code: string; status: ProcessStatus; displayOrder: number },
>(processes: readonly T[]): T[] {
  const kitOrder = processes.find((process) => process.code === KIT_PROCESS_CODE)?.displayOrder;
  const limit = kitOrder ?? Number.POSITIVE_INFINITY;
  return applicableProcesses(processes)
    .filter((process) => process.displayOrder <= limit)
    .sort((left, right) => {
      if (left.code === MP_PROCESS_CODE) return -1;
      if (right.code === MP_PROCESS_CODE) return 1;
      return left.displayOrder - right.displayOrder;
    });
}

/**
 * Colunas de processos da tabela da Fábrica 1: a cadeia F1 (MP primeiro,
 * depois LASER…FICEP e o KIT) na ordem do catálogo. O que vem depois do KIT
 * continua oculto nesta tela — mora na gestão de entregas.
 *
 * O MP abre a lista SEM depender do `displayOrder`: no banco ele divide o
 * mesmo número (5) com o PUNC, então ordenar só por número o deixaria no
 * meio da cadeia. Mesma regra de `fabrica1ItemProcesses` (badges mobile).
 */
export function fabrica1ProcessColumns<T extends { code: string; displayOrder: number }>(
  processes: readonly T[],
): T[] {
  const codes = new Set(FABRICA1_PROCESS_CODES);
  return processes
    .filter((process) => codes.has(process.code))
    .sort((left, right) => {
      if (left.code === MP_PROCESS_CODE) return -1;
      if (right.code === MP_PROCESS_CODE) return 1;
      return left.displayOrder - right.displayOrder;
    });
}
