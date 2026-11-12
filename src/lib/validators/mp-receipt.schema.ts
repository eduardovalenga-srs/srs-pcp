import { z } from "zod";

import { decimalInput, nullableDate, nullableText } from "@/lib/validators/common";

/**
 * MATERIAL de uma NOTA DE ENTRADA (059): a linha da nota é o material
 * (com o peso recebido nele) — o item e o item pai saem da tela.
 */
export const mpReceiptMaterialSchema = z.object({
  /** Chave normalizada do material (descrição + unidade em maiúsculas). */
  materialKey: z.string().trim().min(1, "Matéria-prima inválida"),
  description: z.string().trim().min(1, "Matéria-prima inválida"),
  unit: z.string().trim().min(1, "Unidade inválida"),
  /** Kg recebidos NESTA nota (> 0 — o total é a soma das notas). */
  quantityKg: decimalInput("Quantidade", { min: 0.01 }),
});

/**
 * Cabeçalho + materiais de uma NOTA DE ENTRADA (um registro por ação).
 * O nº e a data da nota ficam no cabeçalho; os materiais, nas linhas.
 */
export const mpReceiptSchema = z
  .object({
    orderId: z.string().trim().min(1, "Selecione a OF"),
    /** Nº digitado da nota de entrada. */
    entryNumber: z.string().trim().min(1, "Informe o número da nota de entrada"),
    /** Data da nota de entrada (AAAA-MM-DD). */
    entryDate: nullableDate,
    notes: nullableText(1000),
    materials: z
      .array(mpReceiptMaterialSchema)
      .min(1, "Informe o peso recebido de pelo menos uma matéria-prima")
      .max(500, "Máximo de 500 materiais por nota de entrada"),
  })
  .superRefine((receipt, ctx) => {
    const seen = new Set<string>();
    for (const [index, material] of receipt.materials.entries()) {
      if (seen.has(material.materialKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["materials", index, "materialKey"],
          message: "Matéria-prima repetida na nota de entrada",
        });
      }
      seen.add(material.materialKey);
    }
  });

/** Payload digitado no formulário (kg ainda como texto/número). */
export type MpReceiptInput = z.input<typeof mpReceiptSchema>;

/** Valores já convertidos (kg como número). */
export type MpReceiptValues = z.output<typeof mpReceiptSchema>;
export type MpReceiptMaterialValues = z.output<typeof mpReceiptMaterialSchema>;
