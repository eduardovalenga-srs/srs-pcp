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
import { buildChildItemGroup } from "@/lib/utils/child-item-groups";
import { escapeFilterTerm } from "@/lib/utils/filters";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  return {
    id: row.id,
    orderId: row.order_id,
    parentItemId: row.parent_order_item_id,
    family: row.family,
    parentItem: row.parent_item,
    description: row.description,
    quantity: toNumber(row.quantity) ?? 0,
    unitWeightKg: toNumber(row.unit_weight_kg),
    totalWeightKg: toNumber(row.total_weight_kg),
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
 * A RPC é SECURITY DEFINER com checagem de papel: o OPERADOR tem
 * production.update_status mas a RLS de order_items/orders é ADMIN/GESTOR.
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
export async function getItemAggregate(
  client: SupabaseServer,
  orderItemId: string,
): Promise<{ status: OrderStatus; op: string | null; processStatuses: ProcessStatus[] } | null> {
  const { data, error } = await client
    .from("order_items")
    .select("status, op, production_processes(status)")
    .eq("id", orderItemId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar os processos do item");
  if (!data) return null;

  return {
    status: data.status as OrderStatus,
    op: (data.op as string | null) ?? null,
    processStatuses: (data.production_processes ?? []).map(
      (process) => process.status as ProcessStatus,
    ),
  };
}

/**
 * Processos do item para a cascata da linha do tempo: situação, posição na
 * cadeia e quantidades/notas (preservadas quando a cascata muda o status).
 */
export async function getItemProcessChain(
  client: SupabaseServer,
  orderItemId: string,
): Promise<
  {
    id: string;
    status: ProcessStatus;
    code: string;
    displayOrder: number;
    quantityPlanned: number | null;
    quantityCompleted: number | null;
    notes: string | null;
  }[]
> {
  const { data, error } = await client
    .from("order_items")
    .select(
      "production_processes ( id, status, quantity_planned, quantity_completed, notes, processes ( code, display_order ) )",
    )
    .eq("id", orderItemId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar os processos do item");
  if (!data) return [];

  type Raw = {
    production_processes: {
      id: string;
      status: ProcessStatus;
      quantity_planned: number | string | null;
      quantity_completed: number | string | null;
      notes: string | null;
      processes: { code: string; display_order: number };
    }[];
  };

  const row = data as unknown as Raw;
  return (row.production_processes ?? []).map((process) => ({
    id: process.id,
    status: process.status,
    code: process.processes.code,
    displayOrder: process.processes.display_order,
    quantityPlanned: toNumber(process.quantity_planned),
    quantityCompleted: toNumber(process.quantity_completed),
    notes: process.notes,
  }));
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

/**
 * Itens FILHOS agrupados por código dentro da OF (033) — base da tela
 * Fábrica 1 (visão de insumos: o componente repetido vira UMA linha).
 *
 * Três passos:
 *  1. RPC `get_child_item_groups` (página de grupos + nº de grupos) em
 *     paralelo com a `get_child_items_totals` (soma do card) — os 11
 *     filtros são os mesmos das duas;
 *  2. busca dos membros da página pelos ids, com os embeds de exibição
 *     (processos/materiais) e os PAIS numa consulta própria — o
 *     self-join do PostgREST só resolve a direção "filhos";
 *  3. montagem: `buildChildItemGroup` soma quantidade/peso, agrega
 *     processos/materiais e a coluna MP herdada dos pais.
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
): Promise<ChildItemGroupsResult> {
  const search = escapeFilterTerm(filters.search);
  const orderCode = filters.orderCode.trim();
  const customer = filters.customer.trim();
  const childItem = filters.childItem.trim();
  const description = filters.description.trim();
  const materialFilter = filters.material.trim();
  const materialEmbed = materialFilter ? "order_item_materials!inner" : "order_item_materials";
  const materialIlike = materialFilter ? `%${materialFilter}%` : null;

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

  // 033: página de GRUPOS (código do filho, dentro da OF) + contagem de
  // grupos, em paralelo com a soma do card (024) — os filtros são os
  // mesmos das duas RPCs.
  const rpcFilters = {
    p_search: search || null,
    p_order_code: orderCode || null,
    p_customer: customer || null,
    p_child_item: childItem || null,
    p_description: description || null,
    p_material: materialFilter || null,
    p_parent_ids: parentIds !== null
      ? parentIds.length > 0
        ? parentIds
        : [NIL_UUID]
      : null,
    p_delivery_from: filters.deliveryFrom || null,
    p_delivery_to: filters.deliveryTo || null,
    p_process_id: processId,
    p_process_status: filters.processStatus !== "ALL" ? filters.processStatus : null,
  };
  const from = (filters.page - 1) * filters.pageSize;
  const [groupsResult, totalsResult] = await Promise.all([
    client.rpc("get_child_item_groups", {
      ...rpcFilters,
      p_offset: from,
      p_limit: filters.pageSize,
    }),
    client.rpc("get_child_items_totals", rpcFilters),
  ]);

  assertOk(groupsResult.error, "Não foi possível carregar os itens filhos");
  assertOk(totalsResult.error, "Não foi possível carregar os itens filhos");

  type GroupRow = { orderId: string; key: string; itemIds: string[] };
  const groupsPayload = (groupsResult.data ?? {}) as unknown as {
    total?: number | string;
    groups?: GroupRow[];
  };
  const groupRows = groupsPayload.groups ?? [];
  const memberIds = [
    ...new Set(groupRows.flatMap((group) => group.itemIds ?? [])),
  ];

  type TotalsRow = {
    total: number | string;
    qtyTotal: number | string;
    weightTotal: number | string;
  };
  const totals = (totalsResult.data ?? {}) as unknown as TotalsRow;
  const aggregated = {
    //033: card e paginação contam GRUPOS; os somatórios seguem Σ por item.
    total: toNumber(groupsPayload.total ?? null) ?? 0,
    qtyTotal: toNumber(totals.qtyTotal) ?? 0,
    weightTotal: toNumber(totals.weightTotal) ?? 0,
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
  const pageColumns = `id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg, delivery_date,
   orders!inner ( id, code, customer_name, delivery_date ),
   production_processes ( id, status, quantity_planned, quantity_completed, notes, processes ( code, name, display_order ) ),
   ${materialEmbed} ( id, description, quantity, unit, notes )`;

  let memberQuery = client.from("order_items").select(pageColumns).in("id", memberIds);
  if (materialIlike) {
    // Com filtro de material, o embed entrega só os materiais casados
    // (quem casou o filtro na RPC tem o material — ninguém cai fora).
    memberQuery = memberQuery.ilike("order_item_materials.description", materialIlike);
  }
  const { data: memberRows, error: membersError } = await memberQuery;
  assertOk(membersError, "Não foi possível carregar os itens filhos");

  type RawParent = {
    id: string;
    parent_item: string | null;
    description: string;
    delivery_date: string | null;
    orders: { delivery_date: string | null };
    production_processes: {
      status: ProcessStatus;
      completed_at: string | null;
      processes: { code: string };
    }[];
  };

  // PAIS da página (≤ pageSize ids, com repetição removida): busca própria em
  // vez de embed — ver o comentário no select. Um Map cobre todos os filhos
  // do mesmo pai sem repetir dado.
  const pageParentIds = [
    ...new Set(
      ((memberRows ?? []) as unknown as { parent_order_item_id: string | null }[])
        .map((row) => row.parent_order_item_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const parentsById = new Map<string, RawParent>();
  if (pageParentIds.length > 0) {
    const { data, error } = await client
      .from("order_items")
      .select(
        "id, parent_item, description, delivery_date, orders ( delivery_date ), production_processes ( status, completed_at, processes ( code ) )",
      )
      .in("id", pageParentIds);
    assertOk(error, "Não foi possível carregar os itens pai");
    for (const parent of (data ?? []) as unknown as RawParent[]) {
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
  const rows = ((memberRows ?? []) as unknown as Raw[]).slice().sort(
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
      // Situação dos processos do PAI (a coluna MP da Fábrica 1 mostra este valor).
      parentProcessStatuses: (parent?.production_processes ?? []).reduce<
        Record<string, ProcessStatus>
      >((statuses, entry) => {
        statuses[entry.processes.code] = entry.status;
        return statuses;
      }, {}),
      quantity: toNumber(row.quantity) ?? 0,
      unitWeightKg: toNumber(row.unit_weight_kg),
      deliveryDate: row.delivery_date ?? row.orders.delivery_date,
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
