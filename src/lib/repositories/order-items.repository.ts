import type { OrderStatus } from "@/lib/constants/orders";
import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  ChildItemFilters,
  ChildItemGroupMember,
  ChildItemGroupsResult,
  ChildItemProcess,
  OrderItemDetails,
  OrderItemMaterial,
} from "@/lib/types/order";
import { MP_PROCESS_CODE } from "@/lib/constants/processes";
import type { ProcessStatus } from "@/lib/constants/production";
import { listConfirmedQuantityByItemIds } from "@/lib/repositories/romaneio.repository";
import { buildChildItemGroup, applyChildItemOverdueCuts, summarizeKitOverdue } from "@/lib/utils/child-item-groups";
import { escapeFilterTerm } from "@/lib/utils/filters";
import { roundWeight } from "@/lib/utils/formatting";
import { mpReceiptFromCell } from "@/lib/utils/mp-receipt";
import { pendingQuantity, pendingRootQuantity, pendingRootWeight, pendingWeight } from "@/lib/utils/shipping";
import { assertOk } from "@/lib/utils/supabase-result";
import { todayISODate } from "@/lib/utils/dates";
import type { KitOverdueTotals } from "@/lib/utils/child-item-groups";
import type { OrderScheduleIndex } from "@/lib/types/scheduling";
import { EMPTY_SCHEDULE_INDEX } from "@/lib/utils/sequenced-schedule";
import { EXPORT_PAGE_SIZE, collectAllPages } from "@/lib/utils/collect-pages";

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Lotes para o `.in("id", …")` de LEITURA da página da Fábrica 1. Com
 * 1000 grupos por página a lista de ids passa de milhares de UUIDs e a
 * URL do PostgREST estoura o limite do proxy (414/431). Em lotes o total
 * de linhas lidas é o mesmo e as buscas rodam em paralelo (a latência
 * da página é a do pior lote, não a soma).
 */
const READ_ID_CHUNK_SIZE = 250;

function chunkIds(ids: readonly string[], size = READ_ID_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

/** Item com seus processos e materiais (usado na edição de item). */
export async function getOrderItemWithProcesses(
  client: SupabaseServer,
  itemId: string,
): Promise<OrderItemDetails | null> {
  const { data, error } = await client
    .from("order_items")
    .select(
      `id, order_id, parent_order_item_id, family, parent_item, description, quantity, unit_weight_kg, total_weight_kg, delivery_date, status, op,
       production_processes (
         id, process_id, status, quantity_planned, quantity_completed, notes, completed_at,
         processes ( id, code, name, display_order )
       ),
       order_item_materials ( id, description, quantity, unit, notes )`,
    )
    .eq("id", itemId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o item");
  if (!data) return null;

  type Raw = {
    id: string;
    order_id: string;
    parent_order_item_id: string | null;
    family: string | null;
    parent_item: string | null;
    description: string;
    quantity: number | string;
    unit_weight_kg: number | string | null;
    total_weight_kg: number | string | null;
    delivery_date: string | null;
    status: OrderStatus;
    op: string | null;
    production_processes: {
      id: string;
      process_id: string;
      status: ProcessStatus;
      quantity_planned: number | string | null;
      quantity_completed: number | string | null;
      notes: string | null;
      completed_at: string | null;
      processes: { id: string; code: string; name: string; display_order: number };
    }[];
    order_item_materials: {
      id: string;
      description: string;
      quantity: number | string;
      unit: string;
      notes: string | null;
    }[];
  };

  const row = data as unknown as Raw;

  // 054: saldo derivado da expedição (mesma regra do detalhe da OF) — o
  // expedido vem do banco; o filho resolve a fração pelo pai imediato.
  const parentId = row.parent_order_item_id;
  const [shippedByItem, parentResult] = await Promise.all([
    listConfirmedQuantityByItemIds(client, parentId ? [row.id, parentId] : [row.id]),
    parentId
      ? client
          .from("order_items")
          .select("quantity, parent_order_item_id")
          .eq("id", parentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // 054: a fração vale só para pai RAIZ (a SQL restringe `parent_balance`
  // a `parent_order_item_id is null`); pai ausente/não raiz/planned ≤ 0
  // mantém o filho com o valor cheio (fail-safe do helper).
  const parentRaw = parentResult.data as { quantity: number | string; parent_order_item_id: string | null } | null;
  const parentIsRoot = parentRaw !== null && parentRaw.parent_order_item_id === null;
  const rootPlanned = parentIsRoot ? toNumber(parentRaw.quantity) ?? 0 : 0;
  const rootShipped = parentIsRoot ? shippedByItem.get(parentId ?? "") ?? 0 : 0;

  const quantity = toNumber(row.quantity) ?? 0;
  const totalWeightKg = toNumber(row.total_weight_kg);
  const unitWeightKg = toNumber(row.unit_weight_kg);
  const pendingQty = parentId
    ? pendingRootQuantity(quantity, rootPlanned, rootShipped)
    : pendingQuantity(quantity, shippedByItem.get(row.id) ?? 0);
  const pendingWeightKg = parentId
    ? pendingRootWeight(totalWeightKg, rootPlanned, rootShipped)
    : pendingWeight(totalWeightKg, shippedByItem.get(row.id) ?? 0, unitWeightKg);

  return {
    id: row.id,
    orderId: row.order_id,
    parentItemId: row.parent_order_item_id,
    family: row.family,
    parentItem: row.parent_item,
    description: row.description,
    quantity,
    unitWeightKg,
    totalWeightKg,
    shippedQuantity: quantity - pendingQty,
    pendingQuantity: pendingQty,
    pendingWeightKg,
    deliveryDate: row.delivery_date,
    status: row.status,
    op: row.op ?? null,
    processes: (row.production_processes ?? [])
      .map((process) => ({
        id: process.id,
        processId: process.process_id,
        code: process.processes.code,
        name: process.processes.name,
        displayOrder: process.processes.display_order,
        status: process.status,
        quantityPlanned: toNumber(process.quantity_planned),
        quantityCompleted: toNumber(process.quantity_completed),
        notes: process.notes,
        completedAt: process.completed_at ?? null,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder),
    materials: (row.order_item_materials ?? []).map((material) => ({
      id: material.id,
      description: material.description,
      quantity: toNumber(material.quantity) ?? 0,
      unit: material.unit,
      notes: material.notes,
    })),
  };
}

/**
 * Grava o status DERIVADO do item e re-deriva o status da OF (RPC 013).
 *
 * A RPC é SECURITY DEFINER com checagem de papel: os operadores
 * (F1/F2) têm production.update_status mas a RLS de order_items/orders
 * é ADMIN/GESTOR.
 */
export async function refreshOrderStatuses(
  client: SupabaseServer,
  itemId: string,
  status: OrderStatus,
): Promise<void> {
  const { error } = await client.rpc("refresh_order_statuses", {
    p_item_id: itemId,
    p_item_status: status,
  });
  assertOk(error, "Não foi possível atualizar o status do item");
}

/**
 * Grava o status derivado de VÁRIOS itens em uma única RPC (092) e re-deriva
 * cada OF afetada uma única vez. É o caminho da edição em lote: uma chamada
 * por operação, não uma por item.
 */
export async function refreshOrderStatusesBulk(
  client: SupabaseServer,
  updates: readonly { itemId: string; status: OrderStatus }[],
): Promise<void> {
  if (updates.length === 0) return;

  const { error } = await client.rpc("refresh_order_statuses_bulk", {
    p_items: updates.map((update) => ({
      item_id: update.itemId,
      status: update.status,
    })),
  });

  assertOk(error, "Não foi possível atualizar o status do item");
}

/**
 * Atualiza a data de entrega de um item (edição manual na gestão de
 * entregas). As previsões dos processos são derivadas desta data em toda
 * leitura — nada de janela é gravado; a troca recalcula tudo sozinha.
 *
 * O `.select()` existe para detectar 0 linhas afetadas: o action já filtra
 * por capacidade, aqui fica a defesa de "item não existe / RLS negou".
 */
export async function updateItemDeliveryDate(
  client: SupabaseServer,
  orderItemId: string,
  deliveryDate: string | null,
): Promise<void> {
  const { data, error } = await client
    .from("order_items")
    .update({ delivery_date: deliveryDate })
    .eq("id", orderItemId)
    .select("id");

  assertOk(error, "Não foi possível atualizar a data de entrega");
  if (!data || data.length === 0) {
    throw new Error("Item não encontrado ou sem permissão para editar a entrega.");
  }
}

/** Status do item, OP e status de cada processo (para derivar o status agregado). */
export interface ItemAggregate {
  status: OrderStatus;
  op: string | null;
  processStatuses: ProcessStatus[];
}

/**
 * Status agregado de VÁRIOS itens em uma consulta (092 — lote de processos).
 * Evita uma ida ao banco por item depois da cascata.
 */
export async function getItemAggregates(
  client: SupabaseServer,
  orderItemIds: readonly string[],
): Promise<Map<string, ItemAggregate>> {
  const ids = [...new Set(orderItemIds)];
  const result = new Map<string, ItemAggregate>();
  if (ids.length === 0) return result;

  type Raw = {
    id: string;
    status: OrderStatus;
    op: string | null;
    production_processes: { status: ProcessStatus }[] | null;
  };

  for (const chunk of chunkIds(ids)) {
    const { data, error } = await client
      .from("order_items")
      .select("id, status, op, production_processes(status)")
      .in("id", chunk);

    assertOk(error, "Não foi possível carregar os processos do item");
    for (const row of (data ?? []) as unknown as Raw[]) {
      result.set(row.id, {
        status: row.status,
        op: row.op ?? null,
        processStatuses: (row.production_processes ?? []).map((process) => process.status),
      });
    }
  }

  return result;
}

/** Status do item, OP e status de cada processo (para derivar o status agregado). */
export async function getItemAggregate(
  client: SupabaseServer,
  orderItemId: string,
): Promise<ItemAggregate | null> {
  const aggregates = await getItemAggregates(client, [orderItemId]);
  return aggregates.get(orderItemId) ?? null;
}

/**
 * Linha da cadeia de processos de um item — entrada da cascata da linha do
 * tempo. `orderItemId` diz de onde veio a linha: na cadeia CONJUNTA
 * (raiz + filhos) cada processo é gravado no item de origem.
 */
export interface ItemProcessChainEntry {
  id: string;
  orderItemId: string;
  status: ProcessStatus;
  code: string;
  displayOrder: number;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
}

/** Select da cadeia — o mesmo nas duas leituras (item e item + filhos). */
const ITEM_PROCESS_CHAIN_COLUMNS =
  "production_processes ( id, status, quantity_planned, quantity_completed, notes, processes ( code, display_order ) )";

type RawItemProcessChain = {
  production_processes: {
    id: string;
    status: ProcessStatus;
    quantity_planned: number | string | null;
    quantity_completed: number | string | null;
    notes: string | null;
    processes: { code: string; display_order: number };
  }[];
};

/** Achata o embed de processos de um item, rotulando a origem de cada linha. */
function mapItemProcessChain(
  row: RawItemProcessChain,
  orderItemId: string,
): ItemProcessChainEntry[] {
  return (row.production_processes ?? []).map((process) => ({
    id: process.id,
    orderItemId,
    status: process.status,
    code: process.processes.code,
    displayOrder: process.processes.display_order,
    quantityPlanned: toNumber(process.quantity_planned),
    quantityCompleted: toNumber(process.quantity_completed),
    notes: process.notes,
  }));
}

type RawItemRow = { id: string; parent_order_item_id: string | null };

/**
 * Cadeia de VÁRIOS itens em 3 consultas no total (092 — lote de processos):
 *
 *  1. origem de cada item pedido (raiz ou filho);
 *  2. filhos dos itens RAIZ, quando `includeChildren` (cadeia conjunta);
 *  3. processos de todos os itens envolvidos.
 *
 * Retorna um mapa `itemId pedido -> cadeia`. Para um item RAIZ, a cadeia
 * inclui os filhos (a Fábrica 1 e o KIT moram neles); para um item FILHO,
 * inclui só a própria cadeia — o pai nunca entra.
 */
export async function getItemProcessChains(
  client: SupabaseServer,
  orderItemIds: readonly string[],
  options: { includeChildren: boolean },
): Promise<Map<string, ItemProcessChainEntry[]>> {
  const requested = [...new Set(orderItemIds)];
  const result = new Map<string, ItemProcessChainEntry[]>();
  if (requested.length === 0) return result;

  // 1) Itens pedidos: sabemos quais são raízes e quais são filhos.
  const items: RawItemRow[] = [];
  for (const chunk of chunkIds(requested)) {
    const { data, error } = await client
      .from("order_items")
      .select("id, parent_order_item_id")
      .in("id", chunk);

    assertOk(error, "Não foi possível carregar o item");
    items.push(...((data ?? []) as RawItemRow[]));
  }

  const rootIds = items
    .filter((item) => item.parent_order_item_id === null)
    .map((item) => item.id);

  // 2) Filhos dos itens RAIZ pedidos (cadeia conjunta raiz + filhos).
  const childrenByParent = new Map<string, string[]>();
  if (options.includeChildren && rootIds.length > 0) {
    for (const chunk of chunkIds(rootIds)) {
      const { data, error } = await client
        .from("order_items")
        .select("id, parent_order_item_id")
        .in("parent_order_item_id", chunk);

      assertOk(error, "Não foi possível carregar os itens filhos");
      for (const child of (data ?? []) as RawItemRow[]) {
        if (child.parent_order_item_id === null) continue;
        const list = childrenByParent.get(child.parent_order_item_id) ?? [];
        list.push(child.id);
        childrenByParent.set(child.parent_order_item_id, list);
      }
    }
  }

  // 3) Cadeia de todos os itens envolvidos (pedidos + filhos).
  const allIds = new Set(requested);
  if (options.includeChildren) {
    for (const childIds of childrenByParent.values()) {
      for (const childId of childIds) allIds.add(childId);
    }
  }

  const entriesById = new Map<string, ItemProcessChainEntry[]>();
  for (const chunk of chunkIds([...allIds])) {
    const { data, error } = await client
      .from("order_items")
      .select(`id, ${ITEM_PROCESS_CHAIN_COLUMNS}`)
      .in("id", chunk);

    assertOk(error, "Não foi possível carregar os processos do item");

    type RawWithId = RawItemProcessChain & { id: string };
    for (const row of (data ?? []) as unknown as RawWithId[]) {
      entriesById.set(row.id, mapItemProcessChain(row, row.id));
    }
  }

  for (const itemId of requested) {
    const chain = [...(entriesById.get(itemId) ?? [])];
    if (options.includeChildren) {
      for (const childId of childrenByParent.get(itemId) ?? []) {
        chain.push(...(entriesById.get(childId) ?? []));
      }
    }
    result.set(itemId, chain);
  }

  return result;
}

/**
 * Processos do item para a cascata da linha do tempo: situação, posição na
 * cadeia e quantidades/notas (preservadas quando a cascata muda o status).
 */
export async function getItemProcessChain(
  client: SupabaseServer,
  orderItemId: string,
): Promise<ItemProcessChainEntry[]> {
  const chains = await getItemProcessChains(client, [orderItemId], { includeChildren: false });
  return chains.get(orderItemId) ?? [];
}

/**
 * Cadeia para a cascata de CONCLUSÃO atravessando as fábricas: os processos
 * do item e, quando ele é RAIZ, os dos seus itens FILHOS.
 *
 * A cadeia da Fábrica 1 (LASER…FICEP) e o KIT moram nos filhos (039), então
 * concluir um processo de Fábrica 2 na gestão de OF precisa alcançá-los —
 * caso contrário a cascata pousava só no item raiz e a F1 ficava pendente.
 * O pai NÃO entra quando o item é filho: nada da cadeia do filho precede os
 * processos do pai, e o reinício da linha (backward) continua no item único.
 */
export async function getItemProcessChainWithChildren(
  client: SupabaseServer,
  orderItemId: string,
): Promise<ItemProcessChainEntry[]> {
  const chains = await getItemProcessChains(client, [orderItemId], { includeChildren: true });
  return chains.get(orderItemId) ?? [];
}

/** UUID nulo — sentinela para `in (...)` vazio (o PostgREST rejeita lista vazia). */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Limite de pais resolvidos no filtro "Item pai".
 *
 * `parent_item` do pai mora no self-join (order_items → order_items) e o
 * PostgREST não filtra embed por apelido, então os ids são resolvidos numa
 * consulta anterior e aplicados como `parent_order_item_id in (...)`.
 * 500 cobre qualquer filtro por código (uma OF tem poucas posições) sem
 * estourar o tamanho máximo de URL.
 */
const PARENT_ID_LOOKUP_LIMIT = 500;

async function childItemRpcFilters(
  client: SupabaseServer,
  filters: ChildItemFilters,
  processId: string | null,
) {
  const parentItem = filters.parentItem.trim();
  let parentIds: string[] | null = null;
  if (parentItem) {
    const { data, error } = await client
      .from("order_items")
      .select("id")
      .is("parent_order_item_id", null)
      .ilike("parent_item", `%${parentItem}%`)
      .order("id", { ascending: true })
      .limit(PARENT_ID_LOOKUP_LIMIT);
    assertOk(error, "Não foi possível filtrar por item pai");
    parentIds = (data ?? []).map((row) => row.id);
  }

  return {
    p_search: escapeFilterTerm(filters.search) || null,
    p_order_code: filters.orderCode.trim() || null,
    p_customer: filters.customer.trim() || null,
    p_child_item: filters.childItem.trim() || null,
    p_description: filters.description.trim() || null,
    p_material: filters.material.trim() || null,
    p_parent_ids: parentIds !== null
      ? parentIds.length > 0
        ? parentIds
        : [NIL_UUID]
      : null,
    p_delivery_from: filters.deliveryFrom || null,
    p_delivery_to: filters.deliveryTo || null,
    p_process_id: processId,
    p_process_status: filters.processStatus !== "ALL" ? filters.processStatus : null,
    p_seq: filters.seq,
    p_qty_min: filters.qtyMin,
    p_qty_max: filters.qtyMax,
    p_weight_min: filters.weightMin,
    p_weight_max: filters.weightMax,
    p_weight_unit_min: filters.weightUnitMin,
    p_weight_unit_max: filters.weightUnitMax,
  };
}

/**
 * Itens FILHOS agrupados por código dentro da OF (033) — base da tela
 * Fábrica 1 (visão de insumos: o componente repetido vira UMA linha).
 *
 * Caminhos de consulta:
 *  1. Listagem normal: RPCs paginadas existentes para página e totais;
 *  2. Recorte de atraso: RPC `get_child_item_groups_page`; resumo sob demanda:
 *     RPC agregada que devolve apenas os totais KIT;
 *  3. busca dos membros da página pelos ids, com os embeds de exibição
 *     (processos/materiais) e os PAIS numa consulta própria — o
 *     self-join do PostgREST só resolve a direção "filhos"; então
 *     `buildChildItemGroup` soma quantidade/peso, agrega processos/materiais
 *     e a coluna MP herdada dos pais.
 *
 * O embed de materiais continua `!inner` com o ilike quando há filtro:
 * os membros já casam o filtro (a RPC decidiu a pertinência) e o embed
 * entrega só os materiais casados — mesmo comportamento de antes.
 *
 * A coluna MP não é editável aqui: o valor vem do PAI (agregado entre
 * os pais do grupo) e é editado na gestão de entregas.
 */
export async function listChildItemGroups(
  client: SupabaseServer,
  filters: ChildItemFilters,
  processId: string | null = null,
  today: string = todayISODate(),
  schedule: OrderScheduleIndex = EMPTY_SCHEDULE_INDEX,
): Promise<ChildItemGroupsResult & { kitOverdue: KitOverdueTotals | null }> {
  if (filters.overdue || filters.processOverdue) {
    // Datas previstas vêm do sequenciamento (por OF): os recortes de
    // atraso são aplicados EM MEMÓRIA sobre o conjunto filtrado inteiro.
    const groups = await collectAllPages((page) =>
      listChildItemGroups(
        client,
        { ...filters, overdue: false, processOverdue: false, page, pageSize: EXPORT_PAGE_SIZE },
        processId,
        today,
        schedule,
      ).then((result) => ({ rows: result.items, total: result.total })),
    );
    const cut = applyChildItemOverdueCuts(groups, schedule, filters, today);
    const from = (filters.page - 1) * filters.pageSize;

    return {
      items: cut.slice(from, from + filters.pageSize),
      total: cut.length,
      qtyTotal: cut.reduce((sum, item) => sum + item.quantity, 0),
      weightTotal: roundWeight(cut.reduce((sum, item) => sum + (item.weightTotal ?? 0), 0)),
      kitOverdue: summarizeKitOverdue(cut, schedule, today),
    };
  }

  const rpcFilters = await childItemRpcFilters(client, filters, processId);
  const materialFilter = filters.material.trim();
  const materialEmbed = materialFilter ? "order_item_materials!inner" : "order_item_materials";
  const materialIlike = materialFilter ? `%${materialFilter}%` : null;

  // Filtros e argumentos compartilhados entre as RPCs da tela.
  const groupsRpcFilters = {
    ...rpcFilters,
    // 043: ordenação por coluna (whitelist do parser) — a RPC decide o
    // ORDER BY no servidor.
    p_sort: filters.sort,
    p_sort_dir: filters.sortDir,
  };
  const from = (filters.page - 1) * filters.pageSize;
  type GroupRow = { orderId: string; key: string; itemIds: string[] };
  type GroupsPayload = {
    total?: number | string;
    qtyTotal?: number | string;
    weightTotal?: number | string;
    kitOverdue?: {
      records?: number | string;
      qty?: number | string;
      weight?: number | string;
    };
    groups?: GroupRow[];
  };
  const kitOverdue: KitOverdueTotals | null = null;

  const [groupsResult, totalsResult] = await Promise.all([
    client.rpc("get_child_item_groups", {
      ...groupsRpcFilters,
      p_offset: from,
      p_limit: filters.pageSize,
    }),
    client.rpc("get_child_items_totals", rpcFilters),
  ]);
  assertOk(groupsResult.error, "Não foi possível carregar os itens filhos");
  assertOk(totalsResult.error, "Não foi possível carregar os itens filhos");
  const groupsPayload = (groupsResult.data ?? {}) as unknown as GroupsPayload;
  const totals = (totalsResult.data ?? {}) as unknown as {
    qtyTotal?: number | string;
    weightTotal?: number | string;
  };
  groupsPayload.qtyTotal = totals.qtyTotal;
  groupsPayload.weightTotal = totals.weightTotal;

  const groupRows = groupsPayload.groups ?? [];
  const memberIds = [
    ...new Set(groupRows.flatMap((group) => group.itemIds ?? [])),
  ];

  const aggregated = {
    // No caminho normal, kitOverdue é null: o card pede seu resumo sob demanda.
    total: toNumber(groupsPayload.total ?? null) ?? 0,
    qtyTotal: toNumber(groupsPayload.qtyTotal ?? null) ?? 0,
    weightTotal: roundWeight(toNumber(groupsPayload.weightTotal ?? null) ?? 0),
    kitOverdue,
  };
  if (memberIds.length === 0) {
    return { items: [], ...aggregated };
  }

  // ATENÇÃO: o pai NÃO entra por embed. `order_items.parent_order_item_id` é
  // FK para a PRÓPRIA tabela e, em self-join, o PostgREST só resolve por FK a
  // direção "filhos" (to-many) — a direção "pai" (to-one) exigiria uma
  // Computed Relationship (função SQL). O embed `parent:order_items!…` voltava
  // `[]` e apagava o badge "Item pai", a descrição do pai e a coluna MP. Os
  // pais são buscados numa consulta própria, logo após os membros.
  const pageColumns = `id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg, delivery_date, seq,
   orders!inner ( id, code, customer_name, delivery_date ),
   production_processes ( id, status, quantity_planned, quantity_completed, notes, processes ( code, name, display_order ) ),
   ${materialEmbed} ( id, description, quantity, unit, notes )`;

  const memberResults = await Promise.all(
    chunkIds(memberIds).map((ids) => {
      let query = client.from("order_items").select(pageColumns).in("id", ids);
      if (materialIlike) {
        // Com filtro de material, o embed entrega só os materiais casados
        // (quem casou o filtro na RPC tem o material — ninguém cai fora).
        query = query.ilike("order_item_materials.description", materialIlike);
      }
      return query;
    }),
  );
  for (const result of memberResults) {
    assertOk(result.error, "Não foi possível carregar os itens filhos");
  }
  const memberRows = memberResults.flatMap((result) => result.data ?? []);

  type RawParent = {
    id: string;
    parent_order_item_id: string | null;
    /** 054: planejado do pai — denominador da fração pendente dos filhos. */
    quantity: number | string;
    parent_item: string | null;
    description: string;
    delivery_date: string | null;
    orders: { delivery_date: string | null };
    production_processes: {
      status: ProcessStatus;
      completed_at: string | null;
      /** 056: espelho do recebimento de MP (kg) no pai. */
      quantity_planned: number | string | null;
      quantity_completed: number | string | null;
      processes: { code: string };
    }[];
  };

  // PAIS da página (≤ pageSize ids, com repetição removida): busca própria em
  // vez de embed — ver o comentário no select. Um Map cobre todos os filhos
  // do mesmo pai sem repetir dado.
  const pageParentIds = [
    ...new Set(
      (memberRows as unknown as { parent_order_item_id: string | null }[])
        .map((row) => row.parent_order_item_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  // 054: expedido (romaneios CONFIRMADOS) dos pais da página — base da
  // baixa proporcional dos filhos (mesma fração da RPC get_child_item_groups).
  const [shippedByParent, parentResults] = await Promise.all([
    listConfirmedQuantityByItemIds(client, pageParentIds),
    Promise.all(
      pageParentIds.length === 0
        ? []
        : chunkIds(pageParentIds).map((ids) =>
            client
              .from("order_items")
              .select(
                "id, parent_order_item_id, quantity, parent_item, description, delivery_date, orders ( delivery_date ), production_processes ( status, completed_at, quantity_planned, quantity_completed, processes ( code ) )",
              )
              .in("id", ids),
          ),
    ),
  ]);

  const parentsById = new Map<string, RawParent>();
  for (const result of parentResults) {
    assertOk(result.error, "Não foi possível carregar os itens pai");
    for (const parent of (result.data ?? []) as unknown as RawParent[]) {
      parentsById.set(parent.id, parent);
    }
  }

  type Raw = {
    id: string;
    parent_item: string | null;
    description: string;
    quantity: number | string;
    unit_weight_kg: number | string | null;
    delivery_date: string | null;
    /** 036: sequência de fabricação do filho (o grupo fica com o menor). */
    seq: number | string | null;
    orders: { id: string; code: string; customer_name: string | null; delivery_date: string | null };
    parent_order_item_id: string | null;
    production_processes: {
      id: string;
      status: ProcessStatus;
      quantity_planned: number | string | null;
      quantity_completed: number | string | null;
      notes: string | null;
      processes: { code: string; name: string; display_order: number };
    }[];
    order_item_materials: {
      id: string;
      description: string;
      quantity: number | string;
      unit: string;
      notes: string | null;
    }[];
  };

  // Ordenação determinística dos membros (pai → descrição → id): define
  // o "primeiro" membro de cada grupo (badge do pai, descrição, notas).
  const rows = (memberRows as unknown as Raw[]).slice().sort(
    (left, right) =>
      (left.parent_item ?? "").localeCompare(right.parent_item ?? "") ||
      left.description.localeCompare(right.description) ||
      left.id.localeCompare(right.id),
  );

  // Bruto → insumo do agregador (uma entrada por membro).
  const membersById = new Map<string, ChildItemGroupMember>();
  const rawById = new Map<string, Raw>();
  const ordersById = new Map<string, { code: string; customerName: string | null }>();
  for (const row of rows) {
    const parent = row.parent_order_item_id
      ? parentsById.get(row.parent_order_item_id)
      : undefined;

    // 054: saldo do filho = planejado × fração pendente do PAI raiz (a SQL
    // só enxerga pais raiz em `parent_balance`: pai ausente/não raiz/planned
    // ≤ 0 ⇒ fração 1, o filho mantém o valor cheio — fail-safe do helper).
    const quantity = toNumber(row.quantity) ?? 0;
    const parentIsRoot = parent !== undefined && parent.parent_order_item_id === null;
    const pendingQty = parentIsRoot
      ? pendingRootQuantity(
          quantity,
          toNumber(parent.quantity) ?? 0,
          shippedByParent.get(parent.id) ?? 0,
        )
      : quantity;

    rawById.set(row.id, row);
    ordersById.set(row.orders.id, {
      code: row.orders.code,
      customerName: row.orders.customer_name,
    });
    membersById.set(row.id, {
      id: row.id,
      description: row.description,
      parentItem: parent?.parent_item ?? null,
      parentDescription: parent?.description ?? null,
      // Entrega do PAI (item, com fallback para a OF) — base da janela do
      // MP exibida na coluna herdada da Fábrica 1.
      parentDeliveryDate: parent?.delivery_date ?? parent?.orders.delivery_date ?? null,
      // 031: data efetiva do MP concluído no PAI (coluna MP da Fábrica 1).
      parentMpCompletedAt:
        (parent?.production_processes ?? []).find(
          (entry) => entry.processes.code === MP_PROCESS_CODE && entry.status === "CONCLUIDO",
        )?.completed_at ?? null,
      // 056: espelho do recebimento de MP do PAI (coluna somente leitura).
      parentMpReceipt: parent
        ? mpReceiptFromCell(
            (() => {
              const entry = (parent.production_processes ?? []).find(
                (process) => process.processes.code === MP_PROCESS_CODE,
              );
              if (!entry) return null;
              return {
                status: entry.status,
                quantityPlanned: toNumber(entry.quantity_planned),
                quantityCompleted: toNumber(entry.quantity_completed),
              };
            })(),
          )
        : null,
      // Situação dos processos do PAI (a coluna MP da Fábrica 1 mostra este valor).
      parentProcessStatuses: (parent?.production_processes ?? []).reduce<
        Record<string, ProcessStatus>
      >((statuses, entry) => {
        statuses[entry.processes.code] = entry.status;
        return statuses;
      }, {}),
      // 054: o membro soma o SALDO (a linha e os cards da Fábrica 1
      // derivam daqui; `unit_weight_kg` permanece o cadastro).
      quantity: pendingQty,
      unitWeightKg: toNumber(row.unit_weight_kg),
      deliveryDate: row.delivery_date ?? row.orders.delivery_date,
      seq: toNumber(row.seq),
      processes: (row.production_processes ?? [])
        .map(
          (process): ChildItemProcess => ({
            id: process.id,
            code: process.processes.code,
            name: process.processes.name,
            displayOrder: process.processes.display_order,
            status: process.status,
            quantityPlanned: toNumber(process.quantity_planned),
            quantityCompleted: toNumber(process.quantity_completed),
            notes: process.notes ?? null,
          }),
        )
        .sort((left, right) => left.displayOrder - right.displayOrder),
      materials: (row.order_item_materials ?? [])
        .map((material): OrderItemMaterial => ({
          id: material.id,
          description: material.description,
          quantity: toNumber(material.quantity) ?? 0,
          unit: material.unit,
          notes: material.notes,
        }))
        .sort((left, right) => left.description.localeCompare(right.description)),
    });
  }

  // Linhas na ordem dos grupos da RPC (paginação decidida no banco).
  const items = groupRows.flatMap((group) => {
    const members = (group.itemIds ?? [])
      .map((id) => membersById.get(id))
      .filter((member): member is ChildItemGroupMember => member !== undefined);
    const order = ordersById.get(group.orderId);
    if (members.length === 0 || !order) return [];

    const firstCode = rawById.get(members[0]?.id ?? "")?.parent_item?.trim();
    return [
      buildChildItemGroup({
        order: { id: group.orderId, code: order.code, customerName: order.customerName },
        key: group.key,
        childItem: firstCode ? firstCode : null,
        members,
      }),
    ];
  });

  // Soma de TODO o conjunto filtrado (todas as páginas) — Qtd. total e
  // Peso total (qtd × peso unit., 023) do card; `total` = nº de grupos.
  return { items, ...aggregated };
}

/** Resumo KIT sob demanda, sem buscar relações ou membros da página. */
export async function getChildItemsKitOverdueTotals(
  client: SupabaseServer,
  filters: ChildItemFilters,
  processId: string | null = null,
  today: string = todayISODate(),
  schedule: OrderScheduleIndex = EMPTY_SCHEDULE_INDEX,
): Promise<KitOverdueTotals> {
  const groups = await collectAllPages((page) =>
    listChildItemGroups(
      client,
      { ...filters, overdue: false, processOverdue: false, page, pageSize: EXPORT_PAGE_SIZE },
      processId,
      today,
      schedule,
    ).then((result) => ({ rows: result.items, total: result.total })),
  );
  const processFiltered = filters.processOverdue
    ? applyChildItemOverdueCuts(groups, schedule, { ...filters, overdue: false }, today)
    : groups;
  return summarizeKitOverdue(processFiltered, schedule, today);
}
