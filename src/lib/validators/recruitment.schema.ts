import { z } from "zod";

import type { RecruitmentCandidateStageValue, RecruitmentVacancyStatusValue } from "@/lib/types/database";

export const saveRecruitmentVacancySchema = z.object({
  id: z.string().uuid().nullable().optional(),
  customer: z.string().trim().min(1, "Selecione o cliente").max(180),
  allocationClientId: z.string().uuid("Selecione um cliente com alocações cadastradas."),
  allocationLocationId: z.string().uuid("Selecione o local de trabalho."),
  allocationAreaId: z.string().uuid("Selecione a área."),
  allocationPositionId: z.string().uuid("Selecione o cargo."),
  requestReason: z.enum(["NOVA_VAGA", "SUBSTITUICAO", "REFORCO"]),
  replacementEmployeeId: z.string().uuid().nullable(),
  employmentType: z.string().trim().min(1).max(60),
  description: z.string().trim().max(5000).nullable(),
  requirements: z.string().trim().max(5000).nullable(),
  salaryRange: z.string().trim().max(120).nullable(),
  requester: z.string().trim().min(1, "Informe o solicitante / gestor").max(150),
  recruiter: z.string().trim().max(150).nullable(),
  priority: z.enum(["BAIXA", "NORMAL", "ALTA"]),
  status: z.enum(["RASCUNHO", "ABERTA", "PAUSADA", "PREENCHIDA", "ENCERRADA", "CANCELADA"]),
  openingDate: z.string().date(),
  targetDate: z.string().date().nullable(),
  closedReason: z.string().trim().max(500).nullable(),
}).superRefine((value, context) => {
  if (value.requestReason === "SUBSTITUICAO" && !value.replacementEmployeeId) {
    context.addIssue({
      code: "custom",
      path: ["replacementEmployeeId"],
      message: "Selecione o funcionário que será substituído.",
    });
  }
  if (value.requestReason !== "SUBSTITUICAO" && value.replacementEmployeeId) {
    context.addIssue({
      code: "custom",
      path: ["replacementEmployeeId"],
      message: "Vincule funcionário somente para solicitações de substituição.",
    });
  }
});

export type SaveRecruitmentVacancyInput = z.input<typeof saveRecruitmentVacancySchema>;
export type SaveRecruitmentVacancyOutput = z.output<typeof saveRecruitmentVacancySchema>;

export const createRecruitmentCandidateSchema = z.object({
  vacancyId: z.string().uuid(),
  name: z.string().trim().min(1, "Informe o nome do candidato").max(180),
  email: z.string().email("Informe um e-mail válido").max(254).nullable(),
  phone: z.string().trim().max(40).nullable(),
  source: z.string().trim().max(120).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export type CreateRecruitmentCandidateInput = z.input<typeof createRecruitmentCandidateSchema>;
export type CreateRecruitmentCandidateOutput = z.output<typeof createRecruitmentCandidateSchema>;

export const updateRecruitmentCandidateStageSchema = z.object({
  id: z.string().uuid(),
  stage: z.custom<RecruitmentCandidateStageValue>(
    (value) => ["NOVO", "TRIAGEM", "ENTREVISTA", "APROVADO", "REPROVADO", "CONTRATADO"].includes(String(value)),
    "Selecione uma etapa válida.",
  ),
});

export const updateRecruitmentVacancyStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.custom<RecruitmentVacancyStatusValue>(
    (value) => ["RASCUNHO", "ABERTA", "PAUSADA", "PREENCHIDA", "ENCERRADA", "CANCELADA"].includes(String(value)),
    "Selecione um status válido.",
  ),
  closedReason: z.string().trim().max(500).nullable(),
});
