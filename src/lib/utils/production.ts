import { KIT_PROCESS_CODE, MP_PROCESS_CODE, SHIPMENT_PROCESS_CODE } from "@/lib/constants/processes";
import { PROCESS_STATUSES, type ProcessStatus } from "@/lib/constants/production";
import { todayISODate } from "@/lib/utils/dates";

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
 * REGRA DE ATRASO (item 13):
 * atrasado quando delivery_date < hoje AND processo de expedição != CONCLUIDO.
 * Não considera feriados/fins de semana no MVP.
 *
 * Se o item não possuir registro do processo de expedição, também é considerado
 * atrasado (não há envio concluído).
 */
export function isItemOverdue({ deliveryDate, processStatuses }: OverdueInput, today = todayISODate()): boolean {
  if (!deliveryDate) return false;
  if (deliveryDate >= today) return false;
  const shipmentStatus = processStatuses[SHIPMENT_PROCESS_CODE];
  return shipmentStatus !== "CONCLUIDO";
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
 * Regra 62: processos NÃO são concluídos automaticamente entre si —
 * apenas o status do item é derivado para exibição/KPIs.
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
