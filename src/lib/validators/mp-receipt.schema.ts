import { z } from "zod";

import { decimalInput, nullableText } from "@/lib/validators/common";

/**
 * Item de um recebimento de MP (056/057): linha elegível da OF —
 * item FILHO, ou pai SEM filhos — + kg recebidos NESTE recibo (> 0 —
 * o total é a soma de todos os recibos, validado no banco).
 */
export const mpReceiptItemSchema = z.object({
  orderItemId: z.string().trim().min(1, "Item inválido"),
  quantityKg: decimalInput("Quantidade", { min: 0.01 }),
});

/** Cabeçalho + itens de um recebimento de MP (um registro por ação). */
export const mpReceiptSchema = z
  .object({
    orderId: z.string().trim().min(1, "Selecione a OF"),
    notes: nullableText(1000),
    items: z
      .array(mpReceiptItemSchema)
      .min(1, "Informe ao menos um kg recebido")
      .max(500, "Máximo de 500 itens por recebimento"),
  })
  .superRefine((receipt, ctx) => {
    const seen = new Set<string>();
    for (const [index, item] of receipt.items.entries()) {
      if (seen.has(item.orderItemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "orderItemId"],
          message: "Item repetido no recebimento",
        });
      }
      seen.add(item.orderItemId);
    }
  });

/** Payload digitado no formulário (kg ainda como texto/número). */
export type MpReceiptInput = z.input<typeof mpReceiptSchema>;

/** Valores já convertidos (kg como número). */
export type MpReceiptValues = z.output<typeof mpReceiptSchema>;
export type MpReceiptItemValues = z.output<typeof mpReceiptItemSchema>;
