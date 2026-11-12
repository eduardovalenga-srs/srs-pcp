import { z } from "zod";

import { MATERIAL_UNITS } from "@/lib/constants/materials";
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
 * MATERIAL FORA DA OF de uma nota de entrada (060): descrição + unidade
 * de medida + quantidade. É só registro — não afeta saldo nem espelho MP.
 */
export const mpReceiptFreeItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Informe a matéria-prima")
    .max(200, "Máximo de 200 caracteres"),
  unit: z.enum(MATERIAL_UNITS, { message: "Unidade de medida inválida" }),
  quantity: decimalInput("Quantidade", { min: 0.001 }),
});

/**
 * Cabeçalho + materiais de uma NOTA DE ENTRADA (um registro por ação).
 * O nº e a data da nota ficam no cabeçalho; os materiais, nas linhas.
 *
 * A nota pode ter só materiais da OF, só itens fora da OF ou os dois —
 * mas não pode ficar vazia.
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
      .max(500, "Máximo de 500 materiais por nota de entrada"),
    /** Itens fora da OF (opcional — 060). */
    freeItems: z
      .array(mpReceiptFreeItemSchema)
      .max(200, "Máximo de 200 materiais fora da OF por nota de entrada")
      .optional()
      .default([]),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.materials.length === 0 && receipt.freeItems.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["materials"],
        message: "Informe ao menos uma matéria-prima (da OF ou fora dela)",
      });
    }

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

    const seenFree = new Set<string>();
    for (const [index, item] of receipt.freeItems.entries()) {
      // Mesma chave do banco (mp_material_key): descrição + unidade.
      const key = `${item.description.trim().toUpperCase()}::${item.unit}`;
      if (seenFree.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["freeItems", index, "description"],
          message: "Matéria-prima repetida fora da OF",
        });
      }
      seenFree.add(key);
    }
  });

/** Payload digitado no formulário (kg ainda como texto/número). */
export type MpReceiptInput = z.input<typeof mpReceiptSchema>;

/** Valores já convertidos (kg como número). */
export type MpReceiptValues = z.output<typeof mpReceiptSchema>;
export type MpReceiptMaterialValues = z.output<typeof mpReceiptMaterialSchema>;
export type MpReceiptFreeItemValues = z.output<typeof mpReceiptFreeItemSchema>;
