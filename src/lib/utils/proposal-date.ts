import { CHILD_SCOPED_PROCESS_CODES, MP_PROCESS_CODE } from "@/lib/constants/processes";
import type { ProcessStatus } from "@/lib/constants/production";
import type { ChildItemGroup } from "@/lib/types/order";
import type { OrderProcessCell, ProcessCell, ProcessDefinition } from "@/lib/types/production";
import { addBusinessDays } from "@/lib/utils/dates";
import { normalizeDuration } from "@/lib/utils/process-schedule";

/**
 * DATA DE PROPOSTA (DP) — "se a matéria-prima chegar HOJE, para quando
 * podemos nos comprometer a entregar?".
 *
 * REGRA: quando a MP de um item/OF ainda NÃO foi entregue (MP != CONCLUIDO),
 * a DP é HOJE + soma das durações (`durationDays`) dos processos
 * APLICÁVEIS da cadeia — EXCETO o próprio MP (a MP chegando hoje não
 * ocupa tempo) — contados em DIAS ÚTEIS (seg–sex, sem feriados, mesma
 * convenção de `computeProcessSchedule`). Com MP concluído (ou sem MP
 * aplicável), não há cenário hipotético a informar: célula "—".
 *
 * A duração de um processo sem valor cadastrado vale 1 dia útil
 * (`normalizeDuration`, mesma regra do cálculo de janelas).
 */

/** Processo de entrada para o cálculo (código + duração do catálogo). */
export interface ProposalProcess {
  code: string;
  durationDays: number;
}

/** Duração normalizada de um processo do catálogo (inválida/ausente => 1 dia). */
function durationOf(catalog: readonly ProcessDefinition[], code: string): number {
  return normalizeDuration(catalog.find((process) => process.code === code)?.durationDays ?? Number.NaN);
}

/** DP calculada: hoje + Σ durações em dias úteis (null = sem cenário a propor). */
export function computeProposalDate(
  today: string,
  mpPending: boolean,
  processes: readonly ProposalProcess[],
): string | null {
  if (!mpPending) return null;
  const total = processes.reduce((sum, process) => sum + normalizeDuration(process.durationDays), 0);
  return addBusinessDays(today, total);
}

/** O MP agregado da gestão está pendente? (sem célula aplicável => não). */
function aggregatedMpPending(cell: OrderProcessCell | undefined): boolean {
  if (!cell || cell.applicable === 0) return false;
  return cell.status !== "CONCLUIDO";
}

/** O MP do ITEM está pendente? (sem célula => não). */
function itemMpPending(cell: ProcessCell | undefined): boolean {
  if (!cell || cell.status === "NAO_APLICAVEL") return false;
  return cell.status !== "CONCLUIDO";
}

/**
 * DP da linha da GESTÃO DE OF: o MP agregado pendente (pior situação entre
 * os itens aplicáveis) abre o cenário; a soma usa os processos da OF com
 * pelo menos um item aplicável (`applicable > 0`), sem o MP.
 */
export function orderProposalDate(
  row: { processes: Record<string, OrderProcessCell> },
  catalog: readonly ProcessDefinition[],
  today: string,
): string | null {
  const processes = Object.entries(row.processes)
    .filter(([code, cell]) => code !== MP_PROCESS_CODE && cell.applicable > 0)
    .map(([code]) => ({ code, durationDays: durationOf(catalog, code) }));
  return computeProposalDate(today, aggregatedMpPending(row.processes[MP_PROCESS_CODE]), processes);
}

/**
 * DP da linha da FÁBRICA 2 (um item raiz): MP do próprio item pendente e
 * processos aplicáveis do item (sem o MP).
 */
export function itemProposalDate(
  row: { processes: Record<string, ProcessCell> },
  catalog: readonly ProcessDefinition[],
  today: string,
): string | null {
  const processes = Object.entries(row.processes)
    .filter(([code, cell]) => code !== MP_PROCESS_CODE && cell.status !== "NAO_APLICAVEL")
    .map(([code]) => ({ code, durationDays: durationOf(catalog, code) }));
  return computeProposalDate(today, itemMpPending(row.processes[MP_PROCESS_CODE]), processes);
}

/**
 * DP da linha da FÁBRICA 1 (grupo de filhos): o MP é o herdado do ITEM PAI
 * (`parentProcessStatuses`); a soma usa os processos aplicáveis do próprio
 * grupo (sem o MP).
 */
export function childItemProposalDate(
  item: Pick<ChildItemGroup, "processes" | "parentProcessStatuses">,
  catalog: readonly ProcessDefinition[],
  today: string,
): string | null {
  const mpStatus = item.parentProcessStatuses[MP_PROCESS_CODE];
  const mpPending = mpStatus !== undefined && mpStatus !== "CONCLUIDO" && mpStatus !== "NAO_APLICAVEL";
  const processes = item.processes
    .filter((process) => process.code !== MP_PROCESS_CODE && process.status !== "NAO_APLICAVEL")
    .map((process) => ({ code: process.code, durationDays: durationOf(catalog, process.code) }));
  return computeProposalDate(today, mpPending, processes);
}

/**
 * Linha crua da consulta de processos das OFs (tela/planilha de PEDIDOS):
 * uma célula de processo, dizendo se vem do item RAIZ (MP/PRÉ-MTG…EXP e o
 * pai das demais) ou de um FILHO (cadeia F1 e KIT).
 */
export interface OrderProcessRow {
  orderId: string;
  code: string;
  status: ProcessStatus;
  isRootItem: boolean;
}

/**
 * Escopo por código da RPC `get_production_rows_by_order` (039): a cadeia
 * F1 e o KIT leem os FILHOS; os demais (MP, PRÉ-MTG…EXP) vêm dos RAIZ.
 * Célula fora do escopo do seu código não conta na agregação — é o mesmo
 * filtro do `scoped_rows` do banco, para a DP de Pedidos bater com a da
 * gestão de entregas.
 */
const CHILD_SCOPED_CODES: ReadonlySet<string> = new Set<string>(CHILD_SCOPED_PROCESS_CODES);

/**
 * DP das OFs de PEDIDOS, agregando as células crus por pedido — escopo
 * idêntico ao `scoped_rows` da gestão (039):
 *
 *  - MP pendente: alguma célula de MP APLICÁVEL nos ITENS RAIZ que ainda
 *    não concluiu;
 *  - processos: qualquer código aplicável DENTRO DO ESCOPO (raiz para
 *    MP/PRÉ-MTG…EXP; filhos para cadeia F1 + KIT), sem o próprio MP.
 *
 * Devolve `{ pedido: ISO | null }` — null (célula "—") quando não há MP
 * pendente para propor. Pedidos sem nenhuma linha de processo não entram
 * no mapa (tratados como "—" pelo chamador).
 */
export function ordersProposalDates(
  rows: readonly OrderProcessRow[],
  catalog: readonly ProcessDefinition[],
  today: string,
): Record<string, string | null> {
  const byOrder = new Map<string, { mpPending: boolean; codes: Set<string> }>();
  for (const row of rows) {
    // Fora do escopo do código nesta OF (ex.: MP de um filho) — não conta.
    if (row.isRootItem === CHILD_SCOPED_CODES.has(row.code)) continue;
    if (row.status === "NAO_APLICAVEL") continue;

    const entry = byOrder.get(row.orderId) ?? { mpPending: false, codes: new Set<string>() };
    if (row.code === MP_PROCESS_CODE) {
      if (row.status !== "CONCLUIDO") entry.mpPending = true;
    } else {
      entry.codes.add(row.code);
    }
    byOrder.set(row.orderId, entry);
  }

  const result: Record<string, string | null> = {};
  for (const [orderId, entry] of byOrder) {
    const processes = [...entry.codes].map((code) => ({
      code,
      durationDays: durationOf(catalog, code),
    }));
    result[orderId] = computeProposalDate(today, entry.mpPending, processes);
  }
  return result;
}
