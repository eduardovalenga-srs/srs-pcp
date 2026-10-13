import { z } from "zod";

import { decimalInput, nullableDate, nullableText, optionalDecimalInput } from "@/lib/validators/common";
import { materialsSchema } from "@/lib/validators/material.schema";
import { orderSchema } from "@/lib/validators/order.schema";
import { normalizeOrderCode } from "@/lib/utils/order-code";

export const orderItemSchema = z.object({
  id: z.string().optional(),
  family: nullableText(200),
  parentItem: nullableText(200),
  description: z
    .string()
    .trim()
    .min(1, "Informe a descrição do item")
    .max(1000, "Máximo de 1000 caracteres"),
  quantity: decimalInput("Quantidade", { min: 0.001 }),
  unitWeightKg: optionalDecimalInput("Peso unitário", { min: 0 }),
  deliveryDate: nullableDate,
  // Ordem de Produção vinculada ao item (013): vazia = em espera.
  // O status do item NÃO vem do cliente — é derivado no servidor.
  op: nullableText(50),
  processCodes: z
    .array(z.string().min(1))
    .min(1, "Selecione ao menos um processo"),
  // Matérias-primas do sub-item (011): ausente = lista vazia.
  materials: materialsSchema.default([]),
});

/**
 * Pedido + itens (formulário manual e salvamento no servidor).
 *
 * O código é normalizado para o padrão da importação — "<TIPO> <número>"
 * (ex.: "OF 107482", sempre com espaço): digitado "107482" ou "of-1234",
 * sai "OF 107482"/"OF 1234" e casa com a chave de dedupe da reimportação.
 */
export const orderWithItemsSchema = orderSchema
  .extend({
    items: z.array(orderItemSchema).min(1, "Adicione ao menos um item"),
  })
  .transform((value) => {
    const { code, type } = normalizeOrderCode(value.code, value.type);
    return { ...value, code, type };
  });

export type OrderItemInput = z.input<typeof orderItemSchema>;
export type OrderItemOutput = z.output<typeof orderItemSchema>;
export type OrderWithItemsInput = z.input<typeof orderWithItemsSchema>;
export type OrderWithItemsOutput = z.output<typeof orderWithItemsSchema>;
