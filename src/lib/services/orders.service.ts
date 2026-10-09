import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type { ChildItemFilters, ChildItemMaterialsResult, OrderFilters, OrderListResult, OrderDetails, OrderItemPayload } from "@/lib/types/order";
import type { Json } from "@/lib/types/database";
import type { ProcessStatus } from "@/lib/constants/production";
import {
  buildItemKey,
  deleteOrder,
  findItemsByOrderCodes,
  findOrdersByCodes,
  getOrderDetails,
  listOrders,
} from "@/lib/repositories/orders.repository";
import { replaceItemMaterials } from "@/lib/repositories/materials.repository";
import { getOrderItemWithProcesses, listChildItemsWithMaterials } from "@/lib/repositories/order-items.repository";
import { applyPlan } from "@/lib/repositories/import.repository";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { orderWithItemsSchema, type OrderWithItemsOutput } from "@/lib/validators/order-item.schema";
import { firstZodMessage } from "@/lib/validators/common";
import { deriveOrderItemStatus, deriveOrderStatus } from "@/lib/utils/production";

export async function getOrdersPage(client: SupabaseServer, filters: OrderFilters): Promise<OrderListResult> {
  return listOrders(client, filters);
}

/** Página de itens filhos com materiais (tela Fábrica 1). */
export async function getChildItemsPage(
  client: SupabaseServer,
  filters: ChildItemFilters,
): Promise<ChildItemMaterialsResult> {
  return listChildItemsWithMaterials(client, filters);
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
  const existingByKey = await findItemsByOrderCodes(client, [payload.code]);
  const existingOrder = (await findOrdersByCodes(client, [payload.code])).get(payload.code);
  const operations: Record<string, unknown>[] = [];
  const itemStatuses: string[] = [];

  for (const item of payload.items) {
    const key = buildItemKey(payload.code, item.parentItem, item.description);
    const existing = existingByKey.get(key);

    if (!item.id && existing) {
      throw new Error(
        `Já existe um item com item pai "${item.parentItem || item.description}" no pedido ${payload.code}. ` +
          `Edite o item existente para não duplicar registros.`,
      );
    }

    const selected = new Set(item.processCodes);
    const existingItem = item.id ? await getOrderItemWithProcesses(client, item.id) : null;

    const processes: PlanProcess[] = [];
    for (const process of catalog) {
      const current = existingItem?.processes.find((entry) => entry.code === process.code);
      const isSelected = selected.has(process.code);

      if (!isSelected) {
        // item selecionável desmarcado -> mantém registro histórico como não aplicável
        if (current) {
          processes.push({
            code: process.code,
            status: "NAO_APLICAVEL",
            quantityPlanned: current.quantityPlanned,
            quantityCompleted: current.quantityCompleted,
            notes: current.notes,
          });
        }
        continue;
      }

      processes.push({
        code: process.code,
        status: current?.status ?? "NAO_INICIADO",
        quantityPlanned: current?.quantityPlanned ?? null,
        quantityCompleted: current?.quantityCompleted ?? null,
        notes: current?.notes ?? null,
      });
    }

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
        deliveryDate: item.deliveryDate,
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
  for (const item of payload.items) {
    const key = buildItemKey(payload.code, item.parentItem, item.description);
    const saved = savedItems.get(key);
    if (saved) {
      await replaceItemMaterials(client, saved.id, item.materials ?? []);
    }
  }

  // Devolve o id para a UI ir direto à tela de detalhes do pedido.
  const savedOrders = await findOrdersByCodes(client, [payload.code]);

  return { orderId: savedOrders.get(payload.code)?.id ?? null, code: payload.code };
}

/** Itens de um pedido já existente (usado no formulário de edição). */
export type { OrderItemPayload };
