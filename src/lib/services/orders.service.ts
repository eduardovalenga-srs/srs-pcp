import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type { ChildItemFilters, ChildItemGroupsResult, ChildItemGroup, OrderFilters, OrderListResult, OrderDetails, OrderItemPayload } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import type { Json } from "@/lib/types/database";
import type { ProcessStatus } from "@/lib/constants/production";
import { todayISODate } from "@/lib/utils/dates";
import {
  buildItemKey,
  deleteOrder,
  findItemsByOrderCodes,
  findOrdersByCodes,
  getOrderDetails,
  listOrders,
} from "@/lib/repositories/orders.repository";
import { replaceItemMaterials } from "@/lib/repositories/materials.repository";
import { getOrderItemWithProcesses, listChildItemGroups } from "@/lib/repositories/order-items.repository";
import { collectAllPages, EXPORT_PAGE_SIZE } from "@/lib/utils/collect-pages";
import { kitOverdueGroups, type KitOverdueTotals } from "@/lib/utils/child-item-groups";
import { applyPlan } from "@/lib/repositories/import.repository";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { orderWithItemsSchema, type OrderWithItemsOutput } from "@/lib/validators/order-item.schema";
import { MP_PROCESS_CODE } from "@/lib/constants/processes";
import { firstZodMessage } from "@/lib/validators/common";
import { deriveOrderItemStatus, deriveOrderStatus } from "@/lib/utils/production";
import { calculateTotalWeight } from "@/lib/utils/formatting";
import { getOrdersProcessRows } from "@/lib/repositories/orders.repository";
import { ordersProposalDates } from "@/lib/utils/proposal-date";

/** Página de pedidos + a data de proposta (DP) de cada linha. */
export interface OrdersPage extends OrderListResult {
  /**
   * DP por pedido (ISO `AAAA-MM-DD` ou null = célula "—"): quando a MP do
   * pedido ainda não foi entregue, hoje + Σ das durações dos processos
   * aplicáveis (sem o MP) em dias úteis. Pedido sem linha de processo não
   * entra no mapa (trate como null).
   */
  proposalByOrder: Record<string, string | null>;
  /** Data de referência (AAAA-MM-DD) usada no cálculo da DP. */
  today: string;
}

/**
 * DP dos pedidos informados — usada pela página de Pedidos (só a página
 * visível) e pela exportação (o conjunto inteiro), para as duas lerem a
 * mesma regra. Busca os processos em lotes e agrega no cliente.
 */
export async function getOrdersProposal(
  client: SupabaseServer,
  orderIds: readonly string[],
  today: string = todayISODate(),
): Promise<Record<string, string | null>> {
  if (orderIds.length === 0) return {};
  const [catalog, processRows] = await Promise.all([
    getActiveProcesses(client),
    getOrdersProcessRows(client, orderIds),
  ]);
  return ordersProposalDates(processRows, catalog, today);
}

export async function getOrdersPage(client: SupabaseServer, filters: OrderFilters): Promise<OrdersPage> {
  const ordersPage = await listOrders(client, filters);
  const today = todayISODate();
  const proposalByOrder = await getOrdersProposal(
    client,
    ordersPage.orders.map((order) => order.id),
    today,
  );
  return { ...ordersPage, proposalByOrder, today };
}

export interface ChildItemPage extends ChildItemGroupsResult {
  /** Catálogo ativo (com durações) — colunas do grupo PROCESSOS e folha de edição. */
  processes: ProcessDefinition[];
  /** Data de referência (AAAA-MM-DD) — mesma base da regra de atraso. */
  today: string;
  /**
   * Regra do KIT: card "Atrasados" da Fábrica 1 — grupos do CONJUNTO FILTRADO INTEIRO
   * (todas as páginas) com o início previsto da coluna KIT anterior a hoje.
   */
  kitOverdue: KitOverdueTotals;
}

/**
 * Varre o conjunto filtrado inteiro e devolve os grupos com o KIT vencido —
 * mesma varredura da exportação (.xlsx): página de 1000 grupos por chamada,
 * filtros idênticos aos da lista, para os cards baterem com a tela.
 */
async function listKitOverdueGroups(
  client: SupabaseServer,
  filters: ChildItemFilters,
  processId: string | null,
  processes: readonly ProcessDefinition[],
  today: string,
): Promise<ChildItemGroup[]> {
  const items = await collectAllPages((page) =>
    listChildItemGroups(client, { ...filters, page, pageSize: EXPORT_PAGE_SIZE }, processId).then(
      (result) => ({ rows: result.items, total: result.total }),
    ),
  );
  return kitOverdueGroups(items, processes, today);
}

/** Os três números do card "Atrasados" para um conjunto de grupos já vencidos. */
function kitOverdueTotalsOf(groups: readonly ChildItemGroup[]): KitOverdueTotals {
  return groups.reduce<KitOverdueTotals>(
    (totals, group) => {
      totals.records += 1;
      totals.qty += group.quantity;
      totals.weight += group.weightTotal ?? 0;
      return totals;
    },
    { records: 0, qty: 0, weight: 0 },
  );
}

/**
 * Página em memória de um conjunto JÁ recortado de grupos (filtro do card
 * "Atrasados"): corta a página, soma qtd./peso e alimenta os cards com o
 * mesmo conjunto que a lista exibe — "Atrasados" passa a ser o próprio
 * recorte e "Eventos" mostra o total filtrado.
 */
function sliceChildItemGroups(
  groups: readonly ChildItemGroup[],
  filters: ChildItemFilters,
): ChildItemGroupsResult & { kitOverdue: KitOverdueTotals } {
  const totals = kitOverdueTotalsOf(groups);
  const from = (filters.page - 1) * filters.pageSize;
  return {
    items: groups.slice(from, from + filters.pageSize),
    total: groups.length,
    qtyTotal: totals.qty,
    weightTotal: totals.weight,
    kitOverdue: totals,
  };
}

/**
 * Página de itens filhos com materiais (tela Fábrica 1).
 * O catálogo é carregado antes da lista porque resolve o `processCode`
 * do filtro para o id da linha de processo (filtro no banco).
 *
 * O card "Atrasados" (regra do KIT) roda em paralelo com a página: ele varre o
 * conjunto filtrado inteiro para comparar a data da coluna KIT de cada
 * grupo com a data de referência.
 */
export async function getChildItemsPage(
  client: SupabaseServer,
  filters: ChildItemFilters,
): Promise<ChildItemPage> {
  const processes = await getActiveProcesses(client);
  const today = todayISODate();

  const processId =
    filters.processCode === "ALL"
      ? null
      : (processes.find((process) => process.code === filters.processCode)?.id ?? null);

  // Processo fora do catálogo ativo não casa nenhuma linha.
  if (filters.processCode !== "ALL" && processId === null) {
    return {
      items: [],
      total: 0,
      qtyTotal: 0,
      weightTotal: 0,
      processes,
      today,
      kitOverdue: { records: 0, qty: 0, weight: 0 },
    };
  }

  // Card "Atrasados" LIGADO (clique no card): a janela do KIT é calculada em
  // memória (dias úteis + status agregados do grupo), então não há filtro
  // equivalente no banco — o recorte é feito sobre o conjunto filtrado inteiro
  // e a página é montada aqui. Paginar no banco antes descartaria grupos
  // vencidos das outras páginas.
  if (filters.overdue) {
    const overdue = await listKitOverdueGroups(client, filters, processId, processes, today);
    return { ...sliceChildItemGroups(overdue, filters), processes, today };
  }

  const [result, overdueGroups] = await Promise.all([
    listChildItemGroups(client, filters, processId),
    listKitOverdueGroups(client, filters, processId, processes, today),
  ]);
  return { ...result, processes, today, kitOverdue: kitOverdueTotalsOf(overdueGroups) };
}

export async function getOrder(client: SupabaseServer, orderId: string): Promise<OrderDetails | null> {
  return getOrderDetails(client, orderId);
}

export async function removeOrder(client: SupabaseServer, orderId: string): Promise<void> {
  await deleteOrder(client, orderId);
}

interface PlanProcess {
  code: string;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
}

/**
 * Monta o plano de escrita para um pedido com seus itens.
 *
 * Reutiliza a RPC transacional de importação (apply_import): pedido + itens +
 * processos são gravados em uma única transação, com rollback automático.
 */
export async function saveOrder(
  client: SupabaseServer,
  input: unknown,
): Promise<{ orderId: string | null; code: string }> {
  const parsed = orderWithItemsSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(firstZodMessage(parsed.error));
  }

  const payload: OrderWithItemsOutput = parsed.data;
  const catalog = await getActiveProcesses(client);
  const activeCodes = new Set(catalog.map((process) => process.code));

  for (const item of payload.items) {
    for (const code of item.processCodes) {
      if (!activeCodes.has(code)) {
        throw new Error(`Processo inválido: ${code}`);
      }
    }
  }

  // Detecta itens duplicados antes de gravar (nunca duplicar silenciosamente)
  const [existingByKey, ordersByCode] = await Promise.all([
    findItemsByOrderCodes(client, [payload.code]),
    findOrdersByCodes(client, [payload.code]),
  ]);
  const existingOrder = ordersByCode.get(payload.code);
  const operations: Record<string, unknown>[] = [];
  const itemStatuses: string[] = [];

  // 024: busca dos itens existentes em UMA passada (antes era 1 consulta
  // por item no meio do loop — N+1 no salvamento de pedidos grandes).
  const existingItemIds = payload.items
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id));
  const existingItemsById = new Map<string, Awaited<ReturnType<typeof getOrderItemWithProcesses>>>();
  if (existingItemIds.length > 0) {
    const existingItems = await Promise.all(
      existingItemIds.map((id) => getOrderItemWithProcesses(client, id)),
    );
    existingItemIds.forEach((id, index) => {
      existingItemsById.set(id, existingItems[index] ?? null);
    });
  }

  for (const item of payload.items) {
    const key = buildItemKey(payload.code, item.parentItem, item.description);
    const existing = existingByKey.get(key);

    if (!item.id && existing) {
      throw new Error(
        `Já existe um item com item pai "${item.parentItem || item.description}" no pedido ${payload.code}. ` +
          `Edite o item existente para não duplicar registros.`,
      );
    }

    // MP (021) é pré-requisito para iniciar a produção: o item nunca
    // fica sem a linha de matéria-prima, mesmo que o cliente não a envie.
    const selected = new Set(item.processCodes);
    if (activeCodes.has(MP_PROCESS_CODE)) {
      selected.add(MP_PROCESS_CODE);
    }

    const existingItem = item.id ? existingItemsById.get(item.id) ?? null : null;

    // Plano cobre TODO o catálogo ativo (invariante 010): sempre há uma
    // linha por processo — selecionado mantém o status que já roda (ou
    // nasce NAO_INICIADO) e desmarcado vira NAO_APLICAVEL, criado inclusive
    // quando o item ainda não tinha linha. Antes, o desmarcado sem linha
    // simplesmente sumia do plano e o processo voltava marcado na abertura.
    const processes: PlanProcess[] = catalog.map((process) => {
      const current = existingItem?.processes.find((entry) => entry.code === process.code);
      const isSelected = selected.has(process.code);

      // Re-marcar um processo que estava NAO_APLICAVEL volta a
      // NAO_INICIADO — senão a remarcação também não era gravada.
      const status: ProcessStatus =
        !isSelected
          ? "NAO_APLICAVEL"
          : current && current.status !== "NAO_APLICAVEL"
            ? current.status
            : "NAO_INICIADO";

      return {
        code: process.code,
        status,
        quantityPlanned: current?.quantityPlanned ?? null,
        quantityCompleted: current?.quantityCompleted ?? null,
        notes: current?.notes ?? null,
      };
    });

    // Status do item é DERIVADO no servidor (013): processos + OP.
    const itemStatus = deriveOrderItemStatus(
      processes.map((process) => ({ processCode: process.code, status: process.status })),
      item.op,
    );
    itemStatuses.push(itemStatus);

    operations.push({
      action: item.id ? "UPDATE" : "CREATE",
      ...(item.id ? { itemId: item.id } : {}),
      order: {
        code: payload.code,
        type: payload.type,
        customerName: payload.customerName,
        description: payload.description,
        orderDate: payload.orderDate,
        deliveryDate: payload.deliveryDate,
      },
      item: {
        family: item.family,
        parentItem: item.parentItem,
        description: item.description,
        quantity: item.quantity,
        unitWeightKg: item.unitWeightKg,
        // 023: o plano envia o total DERIVADO (qtd × peso unit.) — antes o
        // formulário não enviava nada e a RPC gravava null. O banco ainda
        // recalcula por trigger; aqui o valor já sai correto para a prévia.
        totalWeightKg: calculateTotalWeight(item.quantity, item.unitWeightKg),
        // Item sem entrega própria herda a do pedido (mesma regra da
        // importação, que grava entrega em todo registro): sem data não
        // existe janela prevista calculada na leitura (022).
        deliveryDate: item.deliveryDate ?? payload.deliveryDate,
        status: itemStatus,
        op: item.op,
        processes,
      },
    });
  }

  // Status do pedido DERIVADO dos itens (013); CANCELADO nunca é sobrescrito.
  const orderStatus = existingOrder?.status === "CANCELADO" ? "CANCELADO" : deriveOrderStatus(itemStatuses);
  for (const operation of operations) {
    (operation.order as Record<string, unknown>).status = orderStatus;
  }

  const plan = { operations } as unknown as Json;
  await applyPlan(client, plan);

  // Matérias-primas (011): resolve os ids gravados e substitui a lista
  // de cada item do payload (mesma chave lógica da duplicidade).
  const savedItems = await findItemsByOrderCodes(client, [payload.code]);
  // 024: substituições em paralelo — cada uma é independente.
  await Promise.all(
    payload.items.map((item) => {
      const saved = savedItems.get(buildItemKey(payload.code, item.parentItem, item.description));
      return saved ? replaceItemMaterials(client, saved.id, item.materials ?? []) : Promise.resolve();
    }),
  );

  // Devolve o id para a UI ir direto à tela de detalhes do pedido.
  const savedOrders = await findOrdersByCodes(client, [payload.code]);

  return { orderId: savedOrders.get(payload.code)?.id ?? null, code: payload.code };
}

/** Itens de um pedido já existente (usado no formulário de edição). */
export type { OrderItemPayload };
