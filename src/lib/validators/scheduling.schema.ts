import { z } from "zod";

import { isValidISODate } from "@/lib/utils/dates";

/**
 * Gravação da fila de um processo (070). A ordem enviada é a ordem final:
 * o servidor atribui position 1..n na sequência do array.
 */
export const saveProcessScheduleSchema = z
  .object({
    processId: z.string().uuid("Processo inválido"),
    anchorDate: z
      .string()
      .refine((value) => isValidISODate(value), "Informe uma data de início válida"),
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
  .superRefine(({ rows }, ctx) => {
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
