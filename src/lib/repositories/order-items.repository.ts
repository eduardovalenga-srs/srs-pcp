import type { OrderStatus } from "@/lib/constants/orders";
import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  ChildItemFilters,
  ChildItemMaterialsResult,
  ChildItemProcess,
  ChildItemWithMaterials,
  OrderItemDetails,
  OrderItemMaterial,
} from "@/lib/types/order";
import type { ProcessStatus } from "@/lib/constants/production";
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
         id, process_id, status, quantity_planned, quantity_completed, notes,
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
 * Itens FILHOS (parent_order_item_id preenchido) com seus materiais —
 * base da tela Fábrica 1 (lista de insumos por peça).
 *
 * O embed de materiais vira `!inner` somente quando há filtro de material:
 * o filtro passa a limitar os itens aos que têm o material casado (e a
 * célula mostra apenas esses materiais), sem esconder filhos sem material
 * quando não há filtro.
 *
 * `processId` vem do catálogo (o serviço resolve `filters.processCode`) e
 * liga o embed extra `pp_filter`: ele restringe as LINHAS sem mexer no
 * embed de exibição, então a célula continua mostrando todos os processos
 * do filho mesmo com filtro de situação ativo.
 *
 * A coluna MP não é filtrável aqui: o valor exibido vem do PAI
 * (`parentProcessStatuses`) e é editado na gestão de entregas.
 *
 * Ordenação em colunas próprias do item (entrega → código do pai →
 * descrição → id) — determinística para a paginação.
 */
export async function listChildItemsWithMaterials(
  client: SupabaseServer,
  filters: ChildItemFilters,
  processId: string | null = null,
): Promise<ChildItemMaterialsResult> {
  const search = filters.search.trim();
  const searchOr = search ? `description.ilike.%${search}%,parent_item.ilike.%${search}%` : null;
  const orderCode = filters.orderCode.trim();
  const customer = filters.customer.trim();
  const childItem = filters.childItem.trim();
  const description = filters.description.trim();
  const materialFilter = filters.material.trim();
  const materialEmbed = materialFilter ? "order_item_materials!inner" : "order_item_materials";
  const materialIlike = materialFilter ? `%${materialFilter}%` : null;
  // Filtro de processo: embed extra (inner) — nunca altera o embed de exibição.
  const processFilter = processId !== null || filters.processStatus !== "ALL";

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

  // ATENÇÃO: o pai NÃO entra por embed. `order_items.parent_order_item_id` é
  // FK para a PRÓPRIA tabela e, em self-join, o PostgREST só resolve por FK a
  // direção "filhos" (to-many) — a direção "pai" (to-one) exigiria uma
  // Computed Relationship (função SQL). O embed `parent:order_items!…` voltava
  // `[]` e apagava o badge "Item pai", a descrição do pai e a coluna MP. Os
  // pais são buscados numa consulta própria, logo após a página.
  const pageColumns = `id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg, delivery_date, status,
   orders!inner ( id, code, customer_name, delivery_date ),
   production_processes ( id, status, quantity_planned, quantity_completed, notes, processes ( code, name, display_order ) ),
   ${materialEmbed} ( id, description, quantity, unit, notes )${
     processFilter ? ", pp_filter:production_processes!inner ( process_id, status )" : ""
   }`;

  // Os embeds de join (`orders` e, com filtro, materiais/processos `!inner`)
  // precisam estar presentes em CADA consulta que filtra por eles.
  let pageQuery = client
    .from("order_items")
    .select(pageColumns, { count: "exact" })
    .not("parent_order_item_id", "is", null);

  if (searchOr) {
    pageQuery = pageQuery.or(searchOr);
  }
  if (orderCode) {
    pageQuery = pageQuery.ilike("orders.code", `%${orderCode}%`);
  }
  if (customer) {
    pageQuery = pageQuery.ilike("orders.customer_name", `%${customer}%`);
  }
  if (childItem) {
    pageQuery = pageQuery.ilike("parent_item", `%${childItem}%`);
  }
  if (description) {
    pageQuery = pageQuery.ilike("description", `%${description}%`);
  }
  if (materialIlike) {
    pageQuery = pageQuery.ilike("order_item_materials.description", materialIlike);
  }
  if (parentIds !== null) {
    // Lista vazia = nenhum pai casou: sentinel mantém o filtro honesto.
    const ids = parentIds.length > 0 ? parentIds : [NIL_UUID];
    pageQuery = pageQuery.in("parent_order_item_id", ids);
  }
  // Período sobre a data do próprio filho (itens sem data ficam de fora,
  // mesma semântica do filtro de período da gestão de entregas).
  if (filters.deliveryFrom) {
    pageQuery = pageQuery.gte("delivery_date", filters.deliveryFrom);
  }
  if (filters.deliveryTo) {
    pageQuery = pageQuery.lte("delivery_date", filters.deliveryTo);
  }
  if (processFilter) {
    if (processId !== null) {
      pageQuery = pageQuery.eq("pp_filter.process_id", processId);
    }
    if (filters.processStatus !== "ALL") {
      pageQuery = pageQuery.eq("pp_filter.status", filters.processStatus);
    }
  }

  // 024: página (com embeds) + contagem/soma do conjunto filtrado inteiro
  // em UMA RPC — antes a tela baixava TODAS as linhas filtradas (com
  // embeds de materiais e processos) só para somar no JavaScript.
  const from = (filters.page - 1) * filters.pageSize;
  const [pageResult, totalsResult] = await Promise.all([
    pageQuery
      .order("delivery_date", { ascending: true, nullsFirst: false })
      .order("parent_item", { ascending: true, nullsFirst: true })
      .order("description", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + filters.pageSize - 1),
    client.rpc("get_child_items_totals", {
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
    }),
  ]);

  assertOk(pageResult.error, "Não foi possível carregar os itens filhos");
  assertOk(totalsResult.error, "Não foi possível carregar os itens filhos");

  type RawParent = {
    id: string;
    parent_item: string | null;
    description: string;
    production_processes: { status: ProcessStatus; processes: { code: string } }[];
  };

  // PAIS da página (≤ pageSize ids, com repetição removida): busca própria em
  // vez de embed — ver o comentário no select. Um Map cobre todos os filhos
  // do mesmo pai sem repetir dado.
  const pageParentIds = [
    ...new Set(
      ((pageResult.data ?? []) as unknown as { parent_order_item_id: string | null }[])
        .map((row) => row.parent_order_item_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const parentsById = new Map<string, RawParent>();
  if (pageParentIds.length > 0) {
    const { data, error } = await client
      .from("order_items")
      .select("id, parent_item, description, production_processes ( status, processes ( code ) )")
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
    status: OrderStatus;
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

  const items: ChildItemWithMaterials[] = ((pageResult.data ?? []) as unknown as Raw[]).map(
    (row) => {
      const parent = row.parent_order_item_id
        ? parentsById.get(row.parent_order_item_id)
        : undefined;

      return {
        id: row.id,
        orderId: row.orders.id,
        orderCode: row.orders.code,
        customerName: row.orders.customer_name,
        parentItem: parent?.parent_item ?? null,
        parentDescription: parent?.description ?? null,
        childItem: row.parent_item,
        description: row.description,
        quantity: toNumber(row.quantity) ?? 0,
        unitWeightKg: toNumber(row.unit_weight_kg),
        deliveryDate: row.delivery_date ?? row.orders.delivery_date,
        status: row.status,
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
        // Situação dos processos do PAI (a coluna MP da Fábrica 1 mostra este valor).
        parentProcessStatuses: (parent?.production_processes ?? []).reduce<
          Record<string, ProcessStatus>
        >((statuses, entry) => {
          statuses[entry.processes.code] = entry.status;
          return statuses;
        }, {}),
        materials: (row.order_item_materials ?? [])
          .map((material): OrderItemMaterial => ({
            id: material.id,
            description: material.description,
            quantity: toNumber(material.quantity) ?? 0,
            unit: material.unit,
            notes: material.notes,
          }))
          .sort((left, right) => left.description.localeCompare(right.description)),
      };
    },
  );

  // Contagem e soma de TODO o conjunto filtrado (todas as páginas) —
  // total, Qtd. total e Peso total (qtd × peso unit., 023) do card.
  type TotalsRow = {
    total: number | string;
    qtyTotal: number | string;
    weightTotal: number | string;
  };
  const totals = (totalsResult.data ?? {}) as unknown as TotalsRow;

  return {
    items,
    total: toNumber(totals.total) ?? 0,
    qtyTotal: toNumber(totals.qtyTotal) ?? 0,
    weightTotal: toNumber(totals.weightTotal) ?? 0,
  };
}
