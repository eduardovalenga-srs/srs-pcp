import { z } from "zod";

import { isValidISODate } from "@/lib/utils/dates";

/**
 * Gravação da fila global (077). O processo e a data são opcionais:
 * quando ausentes, salva somente a prioridade global sem capacidade.
 */
export const saveProcessScheduleSchema = z
  .object({
    processId: z.string().uuid("Processo inválido").nullable(),
    anchorDate: z
      .string()
      .refine((value) => isValidISODate(value), "Informe uma data de início válida")
      .nullable(),
    rows: z
      .array(
        z.object({
          orderId: z.string().uuid("OF inválida"),
          notes: z
            .string()
            .max(500, "A observação pode ter no máximo 500 caracteres")
            .nullish()
            .transform((value) => (value && value.trim() ? value.trim() : null)),
        }),
      )
      .max(2000, "Muitas OFs na sequência"),
  })
  .superRefine(({ processId, anchorDate, rows }, ctx) => {
    if (processId !== null && anchorDate === null) {
      ctx.addIssue({
        code: "custom",
        path: ["anchorDate"],
        message: "Informe uma data de início válida",
      });
    }

    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.orderId)) {
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "orderId"],
          message: "A mesma OF não pode aparecer duas vezes na sequência",
        });
      }
      seen.add(row.orderId);
    });
  });

export type SaveProcessScheduleInput = z.input<typeof saveProcessScheduleSchema>;
export type SaveProcessScheduleOutput = z.output<typeof saveProcessScheduleSchema>;
