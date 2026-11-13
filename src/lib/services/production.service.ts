import "server-only";

import type { SessionUser } from "@/lib/auth/session";
import { PROCESS_STATUS_LABELS, type ProcessStatus, type WeightGranularity } from "@/lib/constants/production";
import { ACAB_PROCESS_CODE, MP_PROCESS_CODE } from "@/lib/constants/processes";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { CompletedWeightStats, FilteredKpiTotals, ProductionEvent, ProductionFilteredSummary, ProductionFilters, ProductionOrderResult, ProductionResult, ProductionRow, ProductionStats, ProcessDefinition } from "@/lib/types/production";
import {
  getActiveProcesses,
  getCompletedWeightStats as getCompletedWeightStatsFromRepository,
  getEventsByItemId,
  getOrderProcessTargets,
  getProductionOrderRows,
  getProductionProcessById,
  getProductionRows,
  getProductionStats,
  getAndLockProcessState,
  insertProductionEvent,
  updateProductionProcess,
  type OrderProcessTarget,
} from "@/lib/repositories/production.repository";
import { getItemAggregate, getItemProcessChain, refreshOrderStatuses } from "@/lib/repositories/order-items.repository";
import {
  allowedProcessStatuses,
  concludedProcessesToReset,
  deriveOrderItemStatus,
  isAcabOverdue,
  isProcessOverdue,
  predecessorsToComplete,
  productionRowsTotals,
} from "@/lib/utils/production";
import { collectAllPages, EXPORT_PAGE_SIZE } from "@/lib/utils/collect-pages";
import { todayISODate } from "@/lib/utils/dates";
import { processUpdateSchema, type ProcessUpdateInput } from "@/lib/validators/production.schema";
import { firstZodMessage } from "@/lib/validators/common";

export interface ProductionPage extends Omit<ProductionResult, "expedition" | "overdue"> {
  /** KPIs calculados durante a varredura necessária para filtrar a lista, se houver. */
  overdue: FilteredKpiTotals | null;
  processes: ProcessDefinition[];
  /**
   * 065: itens do recorte com o ACABAMENTO (ACAB) concluído — card
   * "Acabamento" da Fábrica 2 (substituiu o card "Expedição").
   */
  acabamento: FilteredKpiTotals | null;
  /** Data de referência (AAAA-MM-DD) usada pela RPC — mesma base da regra de atraso. */
  today: string;
}

/**
 * Varredura do conjunto filtrado INTEIRO (todas as páginas) com os recortes
 * EM MEMÓRIA da Fábrica 2 aplicados, nesta ordem:
 *
 *  1. `entrega=OVERDUE` → recorte pela data da coluna ACAB anterior a hoje
 *     (regra do card "Atrasados"); a janela do banco é DESLIGADA antes da
 *     varredura para não descartar itens antes da comparação;
 *  2. 051 — filtro de processo "Atrasados" → recorte pelo INÍCIO previsto da
 *     janela do processo escolhido (ou de qualquer um, no filtro do grupo).
 *
 * Os dois combinam por E (o da tela e o da exportação falam a mesma língua).
 * A janela não existe no banco, então não há filtro equivalente na RPC — é a
 * MESMA técnica da exportação .xlsx e do card de atrasados.
 */
export async function listFabrica2FilteredRows(
  client: SupabaseServer,
  filters: ProductionFilters,
  today: string,
  processes: readonly ProcessDefinition[],
): Promise<ProductionRow[]> {
  const rows = await collectAllPages((page) =>
    getProductionRows(
      client,
      {
        ...filters,
        // Recorte do ACAB é em memória: a janela do banco ficaria de fora
        // (ou cortaria) itens que a comparação ainda precisa ver.
        delivery: filters.delivery === "OVERDUE" ? "ALL" : filters.delivery,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      },
      today,
    ),
  );

  const deliveryCut =
    filters.delivery === "OVERDUE" ? rows.filter((row) => isAcabOverdue(row, processes, today)) : rows;

  return filters.processOverdue
    ? deliveryCut.filter((row) => isProcessOverdue(row, processes, filters.processCode, today))
    : deliveryCut;
}

/**
 * Card "Atrasados" da Fábrica 2 sobre um conjunto já filtrado: recorte pela
 * data da coluna ACAB (início previsto anterior a hoje).
 */
function acabOverdueTotalsOf(
  rows: readonly ProductionRow[],
  processes: readonly ProcessDefinition[],
  today: string,
) {
  return productionRowsTotals(rows.filter((row) => isAcabOverdue(row, processes, today)));
}

/** Itens do recorte com o ACABAMENTO concluído — card "Acabamento" da Fábrica 2. */
function acabamentoTotalsOf(rows: readonly ProductionRow[]) {
  return productionRowsTotals(
    rows.filter((row) => row.processes[ACAB_PROCESS_CODE]?.status === "CONCLUIDO"),
  );
}

/**
 * Totais dos cards da Fábrica 2. Executado pela API sob demanda para não
 * atrasar a renderização inicial da página com a varredura de todas as linhas.
 */
export async function getFabrica2FilteredSummary(
  client: SupabaseServer,
  filters: ProductionFilters,
): Promise<ProductionFilteredSummary> {
  const today = todayISODate();
  const processes = await getActiveProcesses(client);
  // O recorte de entrega OVERDUE depende da janela de ACAB, calculada em
  // memória. Busca o conjunto-base e reaplica esse recorte abaixo.
  const rows = await listFabrica2FilteredRows(
    client,
    { ...filters, delivery: "ALL", page: 1 },
    today,
    processes,
  );
  const filteredRows =
    filters.delivery === "OVERDUE" ? rows.filter((row) => isAcabOverdue(row, processes, today)) : rows;

  return {
    overdue: acabOverdueTotalsOf(filteredRows, processes, today),
    acabamento: acabamentoTotalsOf(filteredRows),
  };
}

/**
 * Página da Fábrica 2 (uma linha por item).
 *
 * O card "Atrasados" desta tela usa a data da coluna ACAB (início previsto
 * anterior a hoje), não a entrega. Seus KPIs e o card "Acabamento" são
 * carregados sob demanda por `getFabrica2FilteredSummary`, sem atrasar a
 * primeira renderização. Com o filtro ligado (`delivery=OVERDUE`), a lista
 * passa a ser o próprio recorte de atrasados e precisa da varredura em memória.
 *
 * 051: o mesmo caminho vale para a opção "Atrasados" dos filtros de PROCESSO
 * (`procsatrasado=1`) — com ela ligada, a lista é o recorte daquele processo
 * (ou de qualquer um, no filtro do grupo), combinando por E com o da entrega.
 *
 * 065: o card "Acabamento" conta os itens com o processo ACAB marcado como
 * concluído; seu resumo também é calculado pela varredura sob demanda.
 *
 * A gestão de OF continua usando `getProductionOrdersPage` (regra de atraso
 * por entrega, calculada na RPC).
 */
export async function getProductionPage(
  client: SupabaseServer,
  filters: ProductionFilters,
): Promise<ProductionPage> {
  const today = todayISODate();
  const processes = await getActiveProcesses(client);

  // Recorte em memória ligado (entrega e/ou processo): a lista, a paginação,
  // os totais e os KPIs saem do MESMO conjunto varrido.
  if (filters.delivery === "OVERDUE" || filters.processOverdue) {
    const cut = await listFabrica2FilteredRows(client, filters, today, processes);
    const totals = productionRowsTotals(cut);
    const from = (filters.page - 1) * filters.pageSize;
    return {
      rows: cut.slice(from, from + filters.pageSize),
      total: cut.length,
      qtyTotal: totals.qty,
      weightTotal: totals.weight,
      // Card "Atrasados": regra do ACAB sobre o conjunto filtrado — com
      // `entrega=OVERDUE` a própria lista já é esse recorte.
      overdue:
        filters.delivery === "OVERDUE" ? totals : acabOverdueTotalsOf(cut, processes, today),
      // Card "Acabamento": itens com o ACAB concluído dentro do MESMO recorte.
      acabamento: acabamentoTotalsOf(cut),
      processes,
      today,
    };
  }

  // Os KPIs são carregados depois da página pelo endpoint de resumo. A lista
  // visível e seus totais já vêm completos da RPC, sem varrer todas as páginas.
  const result = await getProductionRows(client, filters, today);
  const { rows, total, qtyTotal, weightTotal } = result;
  return {
    rows,
    total,
    qtyTotal,
    weightTotal,
    // Sem varredura síncrona: o cliente carrega os dois KPIs em segundo plano.
    overdue: null,
    acabamento: null,
    processes,
    today,
  };
}

export interface ProductionOrderPage extends ProductionOrderResult {
  processes: ProcessDefinition[];
  /** Data de referência (AAAA-MM-DD) usada pela RPC — mesma base da regra de atraso. */
  today: string;
}

/**
 * Página da gestão de entregas CONSOLIDADA por OF (025): uma linha por
 * pedido, com quantidades/pesos somados e todos os processos agregados.
 * A Fábrica 2 continua usando `getProductionPage` (uma linha por item).
 */
export async function getProductionOrdersPage(
  client: SupabaseServer,
  filters: ProductionFilters,
): Promise<ProductionOrderPage> {
  const today = todayISODate();
  const [result, processes] = await Promise.all([
    getProductionOrderRows(client, filters, today),
    getActiveProcesses(client),
  ]);
  return { ...result, processes, today };
}

/** Indicadores do dashboard. */
export async function getDashboardData(client: SupabaseServer): Promise<ProductionStats> {
  return getProductionStats(client, todayISODate());
}

/** Peso marcado como concluído por processo, com série do período para o dashboard. */
export async function getDashboardCompletedWeight(
  client: SupabaseServer,
  granularity: WeightGranularity,
  anchor: string,
): Promise<CompletedWeightStats> {
  return getCompletedWeightStatsFromRepository(client, granularity, anchor);
}

/** Histórico de alterações de um item. */
export async function getItemHistory(client: SupabaseServer, orderItemId: string): Promise<ProductionEvent[]> {
  return getEventsByItemId(client, orderItemId);
}

export interface UpdateProcessResult {
  changed: boolean;
  message: string;
}

/** Direção da cascata da linha do tempo de um item. */
type CascadeDirection = "forward" | "backward";

/**
 * Cascata da linha do tempo de UM item (regra 62 revisada):
 *
 *  - forward (o processo virou CONCLUIDO): os predecessores não iniciados
 *    da cadeia também viram CONCLUIDO;
 *  - backward (o processo saiu de CONCLUIDO para NAO_INICIADO): a linha
 *    reinicia — todos os concluídos aplicáveis, ANTES e DEPOIS do alvo,
 *    voltam a NAO_INICIADO.
 *
 * `NAO_APLICAVEL` fica fora da linha do tempo e nunca é tocado; quantidades
 * e observações de cada processo são preservadas. Cada processo ajustado
 * gera seu production_event com nota explicando a automação.
 * Devolve quantos processos a cascata ajustou.
 */
async function cascadeProcessStatus(
  client: SupabaseServer,
  sessionUser: SessionUser,
  orderItemId: string,
  processCode: string,
  direction: CascadeDirection,
): Promise<number> {
  const chain = await getItemProcessChain(client, orderItemId);
  const targets =
    direction === "forward"
      ? predecessorsToComplete(chain, processCode)
      : concludedProcessesToReset(chain, processCode);
  if (targets.length === 0) return 0;

  const newStatus: ProcessStatus = direction === "forward" ? "CONCLUIDO" : "NAO_INICIADO";
  const note =
    direction === "forward"
      ? `Concluído automaticamente ao concluir ${processCode}`
      : `Devolvido a não iniciado ao desmarcar ${processCode}`;

  for (const target of targets) {
    await updateProductionProcess(client, target.id, {
      status: newStatus,
      quantityPlanned: target.quantityPlanned,
      quantityCompleted: target.quantityCompleted,
      notes: target.notes,
    });
    await insertProductionEvent(client, {
      productionProcessId: target.id,
      userId: sessionUser.id,
      eventType: "STATUS_CHANGE",
      oldStatus: target.status,
      newStatus,
      oldQuantity: target.quantityCompleted,
      newQuantity: target.quantityCompleted,
      notes: note,
    });
  }

  return targets.length;
}

/** Sufixo da mensagem quando a cascata ajustou processos ("" se nada mudou). */
function cascadeSuffix(count: number, direction: CascadeDirection): string {
  if (count === 0) return "";
  return direction === "forward"
    ? ` · +${count} concluído${count === 1 ? "" : "s"} automaticamente`
    : ` · ${count} processo${count === 1 ? "" : "s"} devolvido${count === 1 ? "" : "s"}`;
}

/**
 * Atualização rápida de um processo (célula da tabela).
 *
 * Regras:
 *  - o avanço de status é explícito e a conclusão arrasta os predecessores
 *    da linha do tempo (cascata — regra 62 revisada);
 *  - devolver o processo a "não iniciado" devolve os sucessores concluídos;
 *  - toda alteração gera um production_event;
 *  - o status agregado do item é derivado dos processos.
 */
export async function updateProcess(
  client: SupabaseServer,
  sessionUser: SessionUser,
  input: ProcessUpdateInput,
  options: { canEditQuantities: boolean },
): Promise<UpdateProcessResult> {
  const parsed = processUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(firstZodMessage(parsed.error));
  }

  const current = await getProductionProcessById(client, parsed.data.productionProcessId);
  if (!current) {
    throw new Error("Processo não encontrado.");
  }

  // 056: o MP é um espelho do recebimento de matéria-prima — a marcação
  // manual saiu de todas as telas e o serviço rejeita por cima.
  if (current.process.code === MP_PROCESS_CODE) {
    throw new Error(
      "A matéria-prima é registrada em Recebimento de MP (/recebimento-mp) — esta coluna é somente leitura.",
    );
  }

  const quantityPlanned = options.canEditQuantities ? parsed.data.quantityPlanned : current.quantityPlanned;
  const next: ProcessStatus = parsed.data.status;

  // Processo com situação restrita (regra do MP: só não iniciado/concluído).
  // O schema valida o ENUM; quem sabe qual status o processo aceita é aqui.
  const allowedStatuses = allowedProcessStatuses(current.process.code);
  if (!allowedStatuses.includes(next)) {
    const labels = allowedStatuses.map((value) => PROCESS_STATUS_LABELS[value].toLowerCase()).join(", ");
    throw new Error(`${current.process.name} aceita apenas as situações: ${labels}.`);
  }

  const changes: string[] = [];
  if (current.status !== next) changes.push("status");
  if (current.quantityPlanned !== quantityPlanned) changes.push("quantidade planejada");
  if (current.quantityCompleted !== parsed.data.quantityCompleted) changes.push("quantidade produzida");
  if ((current.notes ?? null) !== (parsed.data.notes ?? null)) changes.push("observações");

  if (changes.length === 0) {
    return { changed: false, message: "Nenhuma alteração para salvar." };
  }

  await updateProductionProcess(client, current.id, {
    status: next,
    quantityPlanned,
    quantityCompleted: parsed.data.quantityCompleted,
    notes: parsed.data.notes,
  });

  await insertProductionEvent(client, {
    productionProcessId: current.id,
    userId: sessionUser.id,
    eventType: changes.includes("status") ? "STATUS_CHANGE" : "DATA_CHANGE",
    oldStatus: current.status,
    newStatus: next,
    oldQuantity: current.quantityCompleted,
    newQuantity: parsed.data.quantityCompleted,
    notes: parsed.data.notes,
  });

  // Cascata da linha do tempo (regra 62 revisada) — ANTES da derivação,
  // que lê o estado final dos processos do item.
  let cascadeCount = 0;
  let cascadeDirection: CascadeDirection | null = null;
  if (changes.includes("status")) {
    if (next === "CONCLUIDO") {
      cascadeDirection = "forward";
    } else if (current.status === "CONCLUIDO" && next === "NAO_INICIADO") {
      cascadeDirection = "backward";
    }
    if (cascadeDirection) {
      cascadeCount = await cascadeProcessStatus(
        client,
        sessionUser,
        current.orderItemId,
        current.process.code,
        cascadeDirection,
      );
    }
  }

  const aggregate = await getItemAggregate(client, current.orderItemId);
  if (aggregate) {
    // Status agregado derivado dos processos + OP (013). A RPC também
    // re-deriva o status da OF (cancelada nunca é sobrescrita).
    const derived = deriveOrderItemStatus(
      aggregate.processStatuses.map((status) => ({ processCode: "", status })),
      aggregate.op,
    );
    if (aggregate.status !== "CANCELADO" && derived !== aggregate.status) {
      await refreshOrderStatuses(client, current.orderItemId, derived);
    }
  }

  const statusChanged = current.status !== next;
  const suffix = cascadeDirection ? cascadeSuffix(cascadeCount, cascadeDirection) : "";
  return {
    changed: true,
    message: statusChanged
      ? `${current.process.name}: ${current.item.description} → ${next.replace("_", " ").toLowerCase()}${suffix}`
      : `${current.process.name} atualizado.`,
  };
}

export interface UpdateProcessBatchResult {
  changed: boolean;
  /** Itens cuja situação realmente mudou. */
  updated: number;
  /** Itens com o processo aplicável na OF (denominador do lote). */
  total: number;
  message: string;
}

/**
 * Edição EM LOTE de um processo na OF (025 — célula da gestão de entregas
 * consolidada): aplica a mesma situação a TODOS os itens aplicáveis daquele
 * processo na OF inteira.
 *
 * Regras:
 *  - o escopo espelha a coluna exibida: cadeia F1 (LASER…FICEP) e KIT (039)
 *    grava nos itens FILHOS; MP e os demais (PRÉ-MTG…EXP) grava nos RAIZ;
 *  - `orderItemIds` (033) restringe o escopo a itens explícitos — é o que
 *    a célula AGRUPADA da Fábrica 1 usa (linhas repetidas do mesmo
 *    componente viram um lote naqueles itens, nunca na OF inteira);
 *  - itens NAO_APLICAVEL ficam de fora — o lote nunca recria um processo
 *    desmarcado no pedido (a célula "—" não é editável);
 *  - quantidades e observações por item NÃO mudam (seguem na Fábrica 2 e
 *    no detalhe do pedido) — só a situação;
 *  - a conclusão/desconclusão dispara a cascata da linha do tempo em cada
 *    item atingido (regra 62 revisada), antes da re-derivação;
 *  - cada item alterado gera seu production_event e re-deriva o status
 *    agregado do item/OF, igual à edição unitária.
 */
export async function updateProcessBatch(
  client: SupabaseServer,
  sessionUser: SessionUser,
  input: {
    orderId: string;
    processCode: string;
    status: ProcessStatus;
    /** 033: escopo explícito de itens (linha agrupada da Fábrica 1). */
    orderItemIds?: readonly string[];
  },
): Promise<UpdateProcessBatchResult> {
  // 056: a edição em lote do MP saiu — o recebimento é registrado em
  // /recebimento-mp e o espelho recalcula a coluna de todas as listas.
  if (input.processCode === MP_PROCESS_CODE) {
    throw new Error(
      "A matéria-prima é registrada em Recebimento de MP (/recebimento-mp) — esta coluna é somente leitura.",
    );
  }

  // Processo com situação restrita (MP): mesma regra da edição unitária.
  const allowedStatuses = allowedProcessStatuses(input.processCode);
  if (!allowedStatuses.includes(input.status)) {
    const labels = allowedStatuses.map((value) => PROCESS_STATUS_LABELS[value].toLowerCase()).join(", ");
    throw new Error(`Este processo aceita apenas as situações: ${labels}.`);
  }

  const targets = await getOrderProcessTargets(
    client,
    input.orderId,
    input.processCode,
    input.orderItemIds ?? null,
  );
  const applicable = targets.filter((target) => target.status !== "NAO_APLICAVEL");
  if (applicable.length === 0) {
    throw new Error("Nenhum item desta OF tem este processo aplicável.");
  }

  let updated = 0;
  const changedTargets: OrderProcessTarget[] = [];
  for (const target of applicable) {
    if (target.status === input.status) continue;
    // Só a situação muda: quantidades/observações do item são preservadas.
    await updateProductionProcess(client, target.id, {
      status: input.status,
      quantityPlanned: target.quantityPlanned,
      quantityCompleted: target.quantityCompleted,
      notes: target.notes,
    });
    await insertProductionEvent(client, {
      productionProcessId: target.id,
      userId: sessionUser.id,
      eventType: "STATUS_CHANGE",
      oldStatus: target.status,
      newStatus: input.status,
      oldQuantity: target.quantityCompleted,
      newQuantity: target.quantityCompleted,
      notes: target.notes,
    });
    changedTargets.push(target);
    updated += 1;
  }

  const touchedItems = [...new Set(changedTargets.map((target) => target.orderItemId))];

  // Cascata da linha do tempo por item atingido — antes de re-derivar,
  // porque a derivação lê o estado final dos processos.
  let cascadeCount = 0;
  let cascadeDirection: CascadeDirection | null = null;
  if (changedTargets.length > 0) {
    if (input.status === "CONCLUIDO") {
      cascadeDirection = "forward";
    } else if (input.status === "NAO_INICIADO") {
      cascadeDirection = "backward";
    }
    if (cascadeDirection) {
      for (const orderItemId of touchedItems) {
        cascadeCount += await cascadeProcessStatus(
          client,
          sessionUser,
          orderItemId,
          input.processCode,
          cascadeDirection,
        );
      }
    }
  }

  // Status agregado re-derivado apenas dos itens que REALMENTE mudaram.
  for (const orderItemId of touchedItems) {
    const aggregate = await getItemAggregate(client, orderItemId);
    if (!aggregate) continue;
    const derived = deriveOrderItemStatus(
      aggregate.processStatuses.map((status) => ({ processCode: "", status })),
      aggregate.op,
    );
    if (aggregate.status !== "CANCELADO" && derived !== aggregate.status) {
      await refreshOrderStatuses(client, orderItemId, derived);
    }
  }

  const label = PROCESS_STATUS_LABELS[input.status].toLowerCase();
  const suffix = cascadeDirection ? cascadeSuffix(cascadeCount, cascadeDirection) : "";
  return {
    changed: updated > 0,
    updated,
    total: applicable.length,
    message:
      updated > 0
        ? `${input.processCode} → ${label} em ${updated} de ${applicable.length} ${applicable.length === 1 ? "item" : "itens"}${suffix}.`
        : "Nenhuma alteração para salvar.",
  };
}

/** Detalhe de um processo para a folha de edição. */
export async function getProcessDetail(
  client: SupabaseServer,
  productionProcessId: string,
): Promise<Awaited<ReturnType<typeof getProductionProcessById>>> {
  return getProductionProcessById(client, productionProcessId);
}

/** Estado atual antes de editar (comparações do serviço). */
export async function getProcessState(
  client: SupabaseServer,
  productionProcessId: string,
): Promise<Awaited<ReturnType<typeof getAndLockProcessState>>> {
  return getAndLockProcessState(client, productionProcessId);
}
