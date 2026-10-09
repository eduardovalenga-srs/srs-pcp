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
import { calculateTotalWeight } from "@/lib/utils/formatting";

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

/**
 * Itens FILHOS (parent_order_item_id preenchido) com seus materiais —
 * base da tela Fábrica 1 (lista de insumos por peça).
 *
 * O embed de materiais vira `!inner` só quando há filtro de material: o
 * filtro passa a limitar os itens aos que têm o material casado (e a
 * célula mostra apenas esses materiais), sem esconder filhos sem
 * material quando não há filtro.
 *
 * Ordenação em colunas próprias do item (entrega → código do pai →
 * descrição → id) — determinística para a paginação.
 */
export async function listChildItemsWithMaterials(
  client: SupabaseServer,
  filters: ChildItemFilters,
): Promise<ChildItemMaterialsResult> {
  const search = filters.search.trim();
  const searchOr = search ? `description.ilike.%${search}%,parent_item.ilike.%${search}%` : null;
  const orderCode = filters.orderCode.trim();
  const materialFilter = filters.material.trim();
  const materialEmbed = materialFilter ? "order_item_materials!inner" : "order_item_materials";
  const materialIlike = materialFilter ? `%${materialFilter}%` : null;

  // Os dois embeds de join (`orders` e, com filtro, materiais `!inner`)
  // precisam estar presentes em CADA consulta que filtra por eles.
  let pageQuery = client
    .from("order_items")
    .select(
      `id, parent_item, description, quantity, unit_weight_kg, delivery_date, status,
       orders!inner ( id, code, customer_name, delivery_date ),
       parent:order_items!parent_order_item_id ( parent_item, description ),
       production_processes ( status, processes ( code, name, display_order ) ),
       ${materialEmbed} ( id, description, quantity, unit, notes )`,
      { count: "exact" },
    )
    .not("parent_order_item_id", "is", null);
  let totalsQuery = client
    .from("order_items")
    .select(`quantity, unit_weight_kg, orders!inner ( id ), ${materialEmbed} ( id )`)
    .not("parent_order_item_id", "is", null);

  if (searchOr) {
    pageQuery = pageQuery.or(searchOr);
    totalsQuery = totalsQuery.or(searchOr);
  }
  if (orderCode) {
    pageQuery = pageQuery.ilike("orders.code", `%${orderCode}%`);
    totalsQuery = totalsQuery.ilike("orders.code", `%${orderCode}%`);
  }
  if (materialIlike) {
    pageQuery = pageQuery.ilike("order_item_materials.description", materialIlike);
    totalsQuery = totalsQuery.ilike("order_item_materials.description", materialIlike);
  }

  // Página (com embeds) + soma do conjunto filtrado inteiro (card Eventos).
  const from = (filters.page - 1) * filters.pageSize;
  const [pageResult, totalsResult] = await Promise.all([
    pageQuery
      .order("delivery_date", { ascending: true, nullsFirst: false })
      .order("parent_item", { ascending: true, nullsFirst: true })
      .order("description", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + filters.pageSize - 1),
    totalsQuery,
  ]);

  assertOk(pageResult.error, "Não foi possível carregar os itens filhos");
  assertOk(totalsResult.error, "Não foi possível carregar os itens filhos");

  type Raw = {
    id: string;
    parent_item: string | null;
    description: string;
    quantity: number | string;
    unit_weight_kg: number | string | null;
    delivery_date: string | null;
    status: OrderStatus;
    orders: { id: string; code: string; customer_name: string | null; delivery_date: string | null };
    parent: { parent_item: string | null; description: string } | null;
    production_processes: {
      status: ProcessStatus;
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
    (row) => ({
      id: row.id,
      orderId: row.orders.id,
      orderCode: row.orders.code,
      customerName: row.orders.customer_name,
      parentItem: row.parent?.parent_item ?? null,
      parentDescription: row.parent?.description ?? null,
      childItem: row.parent_item,
      description: row.description,
      quantity: toNumber(row.quantity) ?? 0,
      unitWeightKg: toNumber(row.unit_weight_kg),
      deliveryDate: row.delivery_date ?? row.orders.delivery_date,
      status: row.status,
      processes: (row.production_processes ?? []).map(
        (process): ChildItemProcess => ({
          code: process.processes.code,
          name: process.processes.name,
          displayOrder: process.processes.display_order,
          status: process.status,
        }),
      ),
      materials: (row.order_item_materials ?? [])
        .map((material): OrderItemMaterial => ({
          id: material.id,
          description: material.description,
          quantity: toNumber(material.quantity) ?? 0,
          unit: material.unit,
          notes: material.notes,
        }))
        .sort((left, right) => left.description.localeCompare(right.description)),
    }),
  );

  // Soma de TODO o conjunto filtrado (todas as páginas) — Qtd. total e
  // Peso total (qtd × peso unit.) do card "Eventos".
  let qtyTotal = 0;
  let weightTotal = 0;
  type TotalRow = { quantity: number | string; unit_weight_kg: number | string | null };
  for (const row of (totalsResult.data ?? []) as unknown as TotalRow[]) {
    const quantity = toNumber(row.quantity) ?? 0;
    qtyTotal += quantity;
    weightTotal += calculateTotalWeight(quantity, toNumber(row.unit_weight_kg)) ?? 0;
  }
  weightTotal = Math.round(weightTotal * 1000) / 1000;

  return { items, total: pageResult.count ?? 0, qtyTotal, weightTotal };
}
