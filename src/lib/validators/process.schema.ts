import { z } from "zod";

import { nullableText } from "@/lib/validators/common";

/**
 * Duração do processo em DIAS ÚTEIS — seg–sex (obrigatório, 1 a 365).
 * É o que a tela de gestão de entregas usa para calcular as janelas de
 * execução previstas, contadas de trás para frente da data de entrega.
 * Aceita texto digitado ou número já convertido — mesmo raciocínio dos
 * demais campos numéricos (`decimalInput`): o mesmo schema valida a
 * entrada do formulário e o output reenviado pela Server Action.
 */
const durationDaysField = z
  .union([z.string(), z.number()])
  .transform((raw, ctx) => {
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) {
        ctx.addIssue({ code: "custom", message: "Duração inválida" });
        return z.NEVER;
      }
      return checkedDuration(raw, ctx);
    }

    const value = raw.trim();
    if (value === "") {
      ctx.addIssue({ code: "custom", message: "Informe a duração do processo em dias" });
      return z.NEVER;
    }
    const normalized = value.replace(/\s/g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (normalized === "" || !Number.isFinite(parsed)) {
      ctx.addIssue({ code: "custom", message: "Duração inválida" });
      return z.NEVER;
    }
    return checkedDuration(parsed, ctx);
  });

function checkedDuration(days: number, ctx: z.RefinementCtx): number {
  if (!Number.isInteger(days)) {
    ctx.addIssue({ code: "custom", message: "Use um número inteiro de dias" });
    return z.NEVER;
  }
  if (days < 1) {
    ctx.addIssue({ code: "custom", message: "Mínimo de 1 dia" });
    return z.NEVER;
  }
  if (days > 365) {
    ctx.addIssue({ code: "custom", message: "Máximo de 365 dias" });
    return z.NEVER;
  }
  return days;
}

/**
 * Reordenação da cadeia (arrastar e soltar): lista completa de ids na nova
 * ordem. Sem repetição — o servidor compara com o catálogo antes de gravar.
 */
export const reorderProcessesSchema = z
  .array(z.string().min(1, "Processo inválido"))
  .min(1, "Nenhum processo para reordenar")
  .refine((ids) => new Set(ids).size === ids.length, "A lista não pode repetir processos");

/**
 * Criação de processo no catálogo (código é imutável depois de criado).
 * A ordem de exibição NÃO vem do formulário: o servidor anexa o processo
 * ao final da cadeia (máximo atual + 1).
 */
export const createProcessSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Informe o código (mínimo de 2 caracteres)")
    .max(12, "Máximo de 12 caracteres")
    .regex(/^[A-Z][A-Z0-9_]*$/, "Use letras maiúsculas, números e _ (comece com letra)"),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do processo")
    .max(80, "Máximo de 80 caracteres"),
  location: nullableText(60),
  durationDays: durationDaysField,
});

/**
 * Atualização de processo do catálogo (código não muda para não quebrar
 * histórico/importação; a posição na cadeia muda apenas arrastando na lista).
 */
export const updateProcessSchema = z.object({
  id: z.string().min(1, "Processo inválido"),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do processo")
    .max(80, "Máximo de 80 caracteres"),
  active: z.boolean(),
  location: nullableText(60),
  durationDays: durationDaysField,
});

export type CreateProcessInput = z.input<typeof createProcessSchema>;
export type CreateProcessOutput = z.output<typeof createProcessSchema>;
export type UpdateProcessInput = z.input<typeof updateProcessSchema>;
export type UpdateProcessOutput = z.output<typeof updateProcessSchema>;
export type ReorderProcessesInput = z.input<typeof reorderProcessesSchema>;
