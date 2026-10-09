"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { replaceItemMaterials } from "@/lib/repositories/materials.repository";
import { updateItemDeliveryDate } from "@/lib/repositories/order-items.repository";
import { getOrder, removeOrder, saveOrder } from "@/lib/services/orders.service";
import { firstZodMessage, nullableDate } from "@/lib/validators/common";
import { materialsSchema } from "@/lib/validators/material.schema";
import { isValidISODate } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";

export interface OrderActionResult {
  success: boolean;
  message: string;
  orderId: string | null;
  code: string;
}

/** Cria ou atualiza um pedido com seus itens (transação única via apply_import). */
export async function saveOrderAction(input: unknown): Promise<OrderActionResult> {
  try {
    await requireCapability("orders.create");
    const client = await createClient();
    const result = await saveOrder(client, input);

    revalidatePath("/pedidos");
    revalidatePath("/gestao-entregas");
    revalidatePath("/dashboard");

    return {
      success: true,
      message: `Pedido ${result.code} salvo com sucesso.`,
      orderId: result.orderId,
      code: result.code,
    };
  } catch (error) {
    console.error("[saveOrderAction]", error);
    return { success: false, message: errorMessage(error), orderId: null, code: "" };
  }
}

/** Exclui um pedido (apenas ADMIN/GESTOR), com confirmação prévia na UI. */
export async function deleteOrderAction(orderId: string): Promise<OrderActionResult> {
  try {
    const sessionUser = await requireCapability("orders.delete");
    if (!can(sessionUser.role, "orders.delete")) {
      return { success: false, message: "Você não tem permissão para excluir pedidos.", orderId: null, code: "" };
    }

    const client = await createClient();
    await removeOrder(client, orderId);

    revalidatePath("/pedidos");
    revalidatePath("/gestao-entregas");
    revalidatePath("/dashboard");

    return { success: true, message: "Pedido excluído.", orderId, code: "" };
  } catch (error) {
    console.error("[deleteOrderAction]", error);
    return { success: false, message: errorMessage(error), orderId: null, code: "" };
  }
}

/** 
 * Carrega um pedido completo para edição — somente os itens pai. Os itens
 * filhos importados (016) ficam de fora do formulário: eles são ajustados
 * na tela de detalhes ou por reimportação (evita colisão de chave dupla).
 */
export async function getOrderForEditAction(orderId: string): Promise<
  { success: true; order: NonNullable<Awaited<ReturnType<typeof getOrder>>> } | { success: false; message: string }
> {
  try {
    await requireCapability("orders.edit");
    const client = await createClient();
    const order = await getOrder(client, orderId);
    if (!order) return { success: false, message: "Pedido não encontrado." };

    return {
      success: true,
      order: { ...order, items: order.items.filter((item) => item.parentItemId === null) },
    };
  } catch (error) {
    console.error("[getOrderForEditAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/**
 * Substitui a lista de matéria-prima de um sub-item (ADMIN/GESTOR).
 * Usado na tela de detalhes do pedido — o formulário grava via saveOrder.
 */
export async function saveItemMaterialsAction(
  orderItemId: string,
  input: unknown,
): Promise<{ success: boolean; message: string }> {
  try {
    await requireCapability("orders.edit");
    const parsed = materialsSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) ?? "Dados inválidos." };
    }

    const client = await createClient();
    await replaceItemMaterials(client, orderItemId, parsed.data);

    revalidatePath("/(dashboard)/pedidos/[id]", "page");
    return { success: true, message: "Materiais atualizados." };
  } catch (error) {
    console.error("[saveItemMaterialsAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

/**
 * Edita a data de entrega de um item (ADMIN/GESTOR) a partir da gestão de
 * entregas. As previsões dos processos derivam desta data em toda leitura:
 * gravada a nova data, as janelas de todos os processos são recalculadas
 * no retorno do refresh — nenhuma outra gravação é necessária.
 */
export async function updateItemDeliveryDateAction(
  orderItemId: string,
  deliveryDate: unknown,
): Promise<{ success: boolean; message: string; deliveryDate: string | null }> {
  try {
    await requireCapability("orders.edit");

    const parsed = nullableDate.safeParse(deliveryDate);
    if (!parsed.success || (parsed.data !== null && !isValidISODate(parsed.data))) {
      return {
        success: false,
        message: parsed.success
          ? "Data de entrega inválida."
          : (firstZodMessage(parsed.error) ?? "Data de entrega inválida."),
        deliveryDate: null,
      };
    }

    const client = await createClient();
    await updateItemDeliveryDate(client, orderItemId, parsed.data);

    revalidatePath("/gestao-entregas");
    revalidatePath("/dashboard");
    revalidatePath("/(dashboard)/pedidos/[id]", "page");

    return {
      success: true,
      message: "Entrega atualizada — as previsões dos processos foram recalculadas.",
      deliveryDate: parsed.data,
    };
  } catch (error) {
    console.error("[updateItemDeliveryDateAction]", error);
    return { success: false, message: errorMessage(error), deliveryDate: null };
  }
}
