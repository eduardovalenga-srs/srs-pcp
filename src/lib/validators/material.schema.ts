import { z } from "zod";

import { MATERIAL_UNITS, MAX_MATERIALS_PER_ITEM } from "@/lib/constants/materials";
import { decimalInput, nullableText } from "@/lib/validators/common";

/**
 * Matéria-prima de um sub-item: insumo consumido na produção
 * (descrição + quantidade + unidade). Não tem processos próprios.
 */
export const materialSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Informe o material")
    .max(200, "Máximo de 200 caracteres"),
  quantity: decimalInput("Quantidade", { min: 0.001 }),
  unit: z.enum(MATERIAL_UNITS),
  notes: nullableText(300),
});

/** Lista de materiais de um sub-item (máx. 50 — mesma regra da RPC 011). */
export const materialsSchema = z
  .array(materialSchema)
  .max(MAX_MATERIALS_PER_ITEM, `Máximo de ${MAX_MATERIALS_PER_ITEM} materiais por item`);

/** Payload digitado no formulário (quantity ainda como texto/número). */
export type MaterialInput = z.input<typeof materialSchema>;

/** Valores já convertidos (quantity como número). */
export type MaterialValues = z.output<typeof materialSchema>;
