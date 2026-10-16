import type { OrderStatus, OrderType } from "@/lib/constants/orders";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { ItemProcess, OrderDetails, OrderFilters, OrderItemDetails, OrderSummary } from "@/lib/types/order";
import type { ExistingOfItem, ExistingOfStructure } from "@/lib/types/import";
import type { ProcessStatus } from "@/lib/constants/production";
import { escapeFilterTerm } from "@/lib/utils/filters";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface OrderRow {
  id: string;
  code: string;
  type: OrderType;
  customer_name: string | null;
  description: string | null;
  order_date: string | null;
  delivery_date: string | null;
  status: OrderStatus;
  order_items?: { id: string }[];
}

function mapOrderSummary(row: OrderRow): OrderSummary {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    customerName: row.customer_name,
    description: row.description,
    orderDate: row.order_date,
    deliveryDate: row.delivery_date,
    status: row.status,
    itemCount: row.order_items?.length ?? 0,
  };
}

/** Aplica os filtros de listagem em qualquer query builder de orders. */
function applyOrderFilters<T>(query: T, filters: OrderFilters): T {
  const builder = query as unknown as {
    or: (filter: string) => unknown;
    eq: (column: string, value: string) => unknown;
  };
  const term = escapeFilterTerm(filters.search);
  if (term) {
    builder.or(`code.ilike.%${term}%,customer_name.ilike.%${term}%,description.ilike.%${term}%`);
  }
  if (filters.status !== "ALL") {
    builder.eq("status", filters.status);
  }
  return query;
}

/** Lista paginada de pedidos com filtros no banco. */
export async function listOrders(
  client: SupabaseServer,
  filters: OrderFilters,
): Promise<{ orders: OrderSummary[]; total: number }> {
  // 024: a contagem sai de uma consulta própria, SEM o embed de itens —
  // `count: exact` sobre o join varria a tabela filha e podia inflar o
  // número (uma linha por item em vez de uma por pedido).
  const pageQuery = applyOrderFilters(
    client
      .from("orders")
      .select("id, code, type, customer_name, description, order_date, delivery_date, status, order_items(id)"),
    filters,
  );
  const countQuery = applyOrderFilters(
    client.from("orders").select("id", { count: "exact", head: true }),
    filters,
  );

  const from = (filters.page - 1) * filters.pageSize;
  const [pageResult, countResult] = await Promise.all([
    pageQuery
      .order("delivery_date", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true })
      .range(from, from + filters.pageSize - 1),
    countQuery,
  ]);

  assertOk(pageResult.error, "Não foi possível carregar os pedidos");
  assertOk(countResult.error, "Não foi possível carregar os pedidos");
  return {
    orders: (pageResult.data ?? []).map((row) => mapOrderSummary(row as OrderRow)),
    total: countResult.count ?? 0,
  };
}

/** Pedido com itens, processos e materiais (detalhes). */
export async function getOrderDetails(client: SupabaseServer, orderId: string): Promise<OrderDetails | null> {
  const { data, error } = await client
    .from("orders")
    .select(
      `id, code, type, customer_name, description, order_date, delivery_date, status,
       order_items (
         id, order_id, parent_order_item_id, family, parent_item, description, quantity, unit_weight_kg, total_weight_kg, delivery_date, status, op,
         production_processes (
           id, process_id, status, quantity_planned, quantity_completed, notes, completed_at,
           processes ( id, code, name, display_order )
         ),
         order_item_materials ( id, description, quantity, unit, notes )
       )`,
    )
    .eq("id", orderId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o pedido");
  if (!data) return null;

  type RawItem = {
    id: string;
    order_id: string;
    /** Vínculo filho -> pai (016); null = item de nível raiz. */
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

  type RawOrder = {
    id: string;
    code: string;
    type: OrderType;
    customer_name: string | null;
    description: string | null;
    order_date: string | null;
    delivery_date: string | null;
    status: OrderStatus;
    order_items: RawItem[];
  };

  const raw = data as unknown as RawOrder;

  const items: OrderItemDetails[] = (raw.order_items ?? [])
    .map((item) => ({
      id: item.id,
      orderId: item.order_id,
      parentItemId: item.parent_order_item_id,
      family: item.family,
      parentItem: item.parent_item,
      description: item.description,
      quantity: toNumber(item.quantity) ?? 0,
      unitWeightKg: toNumber(item.unit_weight_kg),
      totalWeightKg: toNumber(item.total_weight_kg),
      deliveryDate: item.delivery_date,
      status: item.status,
      op: item.op ?? null,
      processes: (item.production_processes ?? [])
        .map((process): ItemProcess => ({
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
      materials: (item.order_item_materials ?? []).map((material) => ({
        id: material.id,
        description: material.description,
        quantity: toNumber(material.quantity) ?? 0,
        unit: material.unit,
        notes: material.notes,
      })),
    }))
    .sort((a, b) => (a.parentItem ?? "").localeCompare(b.parentItem ?? ""));

  return {
    id: raw.id,
    code: raw.code,
    type: raw.type,
    customerName: raw.customer_name,
    description: raw.description,
    orderDate: raw.order_date,
    deliveryDate: raw.delivery_date,
    status: raw.status,
    items,
  };
}

/** Códigos de pedido já existentes (usado na importação). */
export async function findOrdersByCodes(
  client: SupabaseServer,
  codes: string[],
): Promise<Map<string, { id: string; code: string; status: OrderStatus; deliveryDate: string | null }>> {
  const result = new Map<string, { id: string; code: string; status: OrderStatus; deliveryDate: string | null }>();
  if (codes.length === 0) return result;

  const { data, error } = await client
    .from("orders")
    .select("id, code, status, delivery_date")
    .in("code", codes);

  assertOk(error, "Não foi possível verificar pedidos existentes");
  for (const row of data ?? []) {
    result.set(row.code, { id: row.id, code: row.code, status: row.status, deliveryDate: row.delivery_date });
  }
  return result;
}

/**
 * Itens de nível raiz dos pedidos informados (chave lógica de
 * duplicidade do formulário). Itens filhos importados ficam de fora —
 * o formulário edita somente os itens pai (016).
 */
export async function findItemsByOrderCodes(
  client: SupabaseServer,
  codes: string[],
): Promise<
  Map<
    string,
    { id: string; orderCode: string; parentItem: string | null; description: string; status: OrderStatus }
  >
> {
  const result = new Map<
    string,
    { id: string; orderCode: string; parentItem: string | null; description: string; status: OrderStatus }
  >();
  if (codes.length === 0) return result;

  const { data, error } = await client
    .from("order_items")
    .select("id, parent_item, description, status, orders!inner(code)")
    .in("orders.code", codes)
    .is("parent_order_item_id", null);

  assertOk(error, "Não foi possível verificar itens existentes");

  type Raw = {
    id: string;
    parent_item: string | null;
    description: string;
    status: OrderStatus;
    orders: { code: string };
  };

  for (const row of (data ?? []) as unknown as Raw[]) {
    result.set(buildItemKey(row.orders.code, row.parent_item, row.description), {
      id: row.id,
      orderCode: row.orders.code,
      parentItem: row.parent_item,
      description: row.description,
      status: row.status,
    });
  }
  return result;
}

/**
 * Estrutura completa das OFs informadas (raiz + filhos + materiais) para
 * a prévia da importação comparar SISTEMA x ARQUIVO. `hasProgress` sinaliza
 * item com processo avançado ou OP — usado para avisar remoções.
 */
export async function findOrderStructures(
  client: SupabaseServer,
  codes: string[],
): Promise<Map<string, ExistingOfStructure>> {
  const result = new Map<string, ExistingOfStructure>();
  if (codes.length === 0) return result;

  const { data, error } = await client
    .from("orders")
    .select(
      `id, code, type, customer_name, description, delivery_date, status,
       order_items (
         id, parent_order_item_id, family, parent_item, description, quantity,
         unit_weight_kg, total_weight_kg, delivery_date, status, op,
         order_item_materials ( description, quantity, unit ),
         production_processes ( status )
       )`,
    )
    .in("code", codes);

  assertOk(error, "Não foi possível carregar as OFs existentes");

  type Raw = {
    id: string;
    code: string;
    type: string;
    customer_name: string | null;
    description: string | null;
    delivery_date: string | null;
    status: string;
    order_items: {
      id: string;
      parent_order_item_id: string | null;
      family: string | null;
      parent_item: string | null;
      description: string;
      quantity: number | string;
      unit_weight_kg: number | string | null;
      total_weight_kg: number | string | null;
      delivery_date: string | null;
      status: string;
      op: string | null;
      order_item_materials: { description: string; quantity: number | string; unit: string }[];
      production_processes: { status: string }[];
    }[];
  };

  for (const row of (data ?? []) as unknown as Raw[]) {
    const items: ExistingOfItem[] = (row.order_items ?? []).map((item) => ({
      id: item.id,
      parentItemId: item.parent_order_item_id,
      code: item.parent_item ?? "",
      description: item.description,
      family: item.family,
      quantity: toNumber(item.quantity) ?? 0,
      unitWeightKg: toNumber(item.unit_weight_kg),
      totalWeightKg: toNumber(item.total_weight_kg),
      deliveryDate: item.delivery_date,
      status: item.status,
      op: item.op,
      materials: (item.order_item_materials ?? []).map((material) => ({
        description: material.description,
        quantity: toNumber(material.quantity) ?? 0,
        unit: material.unit,
      })),
      hasProgress:
        (item.op !== null && item.op !== "") ||
        (item.production_processes ?? []).some((process) => process.status === "CONCLUIDO"),
    }));

    result.set(row.code.toUpperCase(), {
      id: row.id,
      code: row.code,
      type: row.type,
      customerName: row.customer_name,
      description: row.description,
      deliveryDate: row.delivery_date,
      status: row.status,
      items,
    });
  }
  return result;
}

/**
 * Chave lógica de um item (item 29):
 * OF/OS + ITEM PAI. Sem ITEM PAI, usa OF/OS + descrição como fallback
 * claramente definido.
 */
export function buildItemKey(orderCode: string, parentItem: string | null, description: string): string {
  const parent = parentItem?.trim();
  if (parent) return `${orderCode.trim().toUpperCase()}::${parent.toUpperCase()}`;
  return `${orderCode.trim().toUpperCase()}::#${description.trim().toUpperCase()}`;
}

/** Remove um pedido (apenas ADMIN — RLS também protege). */
export async function deleteOrder(client: SupabaseServer, orderId: string): Promise<void> {
  const { error } = await client.from("orders").delete().eq("id", orderId);
  assertOk(error, "Não foi possível excluir o pedido");
}

/**
 * Atualiza a data de entrega do PEDIDO (025) — é a data que a gestão de
 * entregas consolidada exibe e edita na coluna "Ent.". Itens com data
 * própria (override) mantêm a deles: elas continuam visíveis/editáveis na
 * tela da Fábrica 2 e no detalhe do pedido.
 *
 * O `.select()` existe para detectar 0 linhas afetadas: o action já filtra
 * por capacidade, aqui fica a defesa de "pedido não existe / RLS negou".
 */
export async function updateOrderDeliveryDate(
  client: SupabaseServer,
  orderId: string,
  deliveryDate: string | null,
): Promise<void> {
  const { data, error } = await client
    .from("orders")
    .update({ delivery_date: deliveryDate })
    .eq("id", orderId)
    .select("id");

  assertOk(error, "Não foi possível atualizar a entrega do pedido");
  if (!data || data.length === 0) {
    throw new Error("Pedido não encontrado ou sem permissão para editar a entrega.");
  }
}

export interface DashboardOrdersSummary {
  /** Top clientes (nome + nº de pedidos), já agregados no banco. */
  topCustomers: { name: string; count: number }[];
  /** Pedidos em aberto por faixa de envelhecimento (0-7 … 60+, sem-data). */
  aging: Record<string, number>;
}

/**
 * Agregados do dashboard (top clientes + envelhecimento) calculados NO
 * BANCO pela RPC get_dashboard_orders (024). Antes a página varria a
 * tabela orders INTEIRA (sem limite) para contar no JavaScript.
 */
export async function getDashboardOrders(client: SupabaseServer): Promise<DashboardOrdersSummary> {
  const { data, error } = await client.rpc("get_dashboard_orders");
  assertOk(error, "Não foi possível carregar o dashboard");

  const raw = (data ?? {}) as { topCustomers?: unknown; aging?: unknown };
  const aging = (raw.aging ?? {}) as Record<string, unknown>;

  return {
    topCustomers: ((raw.topCustomers ?? []) as { name?: unknown; count?: unknown }[]).map((entry) => ({
      name: String(entry.name ?? ""),
      count: Number(entry.count ?? 0),
    })),
    aging: Object.fromEntries(
      Object.entries(aging).map(([key, value]) => [key, Number(value ?? 0)]),
    ),
  };
}
