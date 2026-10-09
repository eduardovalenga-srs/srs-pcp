import { z } from "zod";

import { ORDER_TYPES } from "@/lib/constants/orders";
import { nullableDate, nullableText } from "@/lib/validators/common";

/**
 * Dados do pedido (nível OF).
 *
 * O status NÃO vem do cliente: ele é derivado no servidor a partir dos
 * itens (em espera / em produção / concluído) — regra da OP (013).
 */
export const orderSchema = z.object({
  type: z.enum(ORDER_TYPES, { message: "Selecione o tipo (OF/OS)" }),
  code: z
    .string()
    .trim()
    .min(1, "Informe o número do pedido")
    .max(60, "Máximo de 60 caracteres")
    .transform((value) => value.toUpperCase()),
  customerName: nullableText(200),
  description: nullableText(1000),
  orderDate: nullableDate,
  deliveryDate: nullableDate,
});

export type OrderInput = z.input<typeof orderSchema>;
export type OrderOutput = z.output<typeof orderSchema>;
