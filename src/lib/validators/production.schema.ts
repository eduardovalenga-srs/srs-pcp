import { z } from "zod";

import { PROCESS_STATUSES } from "@/lib/constants/production";
import { nullableText, optionalDecimalInput } from "@/lib/validators/common";

/** Atualização rápida de uma célula de processo. */
export const processUpdateSchema = z
  .object({
    productionProcessId: z.string().min(1, "Processo inválido"),
    status: z.enum(PROCESS_STATUSES, { message: "Selecione um status válido" }),
    quantityPlanned: optionalDecimalInput("Quantidade planejada", { min: 0 }),
    quantityCompleted: optionalDecimalInput("Quantidade produzida", { min: 0 }),
    notes: nullableText(2000),
  })
  .refine(
    (value) =>
      value.quantityCompleted === null ||
      value.quantityPlanned === null ||
      value.quantityCompleted <= value.quantityPlanned * 10,
    { message: "Quantidade produzida incoerente com a planejada" },
  );

export type ProcessUpdateInput = z.input<typeof processUpdateSchema>;
export type ProcessUpdateOutput = z.output<typeof processUpdateSchema>;
