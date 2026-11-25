import { z } from "zod";

import type { RecruitmentCandidateStageValue, RecruitmentVacancyStatusValue } from "@/lib/types/database";

export const saveRecruitmentVacancySchema = z.object({
  id: z.string().uuid().nullable().optional(),
  customer: z.string().trim().min(1, "Selecione o cliente").max(180),
  allocationClientId: z.string().uuid("Selecione um cliente com alocações cadastradas."),
  allocationLocationId: z.string().uuid("Selecione o local de trabalho."),
  allocationAreaId: z.string().uuid("Selecione a área."),
  approvedRoleId: z.string().uuid().nullable(),
  allocationPositionId: z.string().uuid().nullable(),
  requestReason: z.enum(["NOVA_VAGA", "SUBSTITUICAO", "REFORCO"]),
  replacementEmployeeId: z.string().uuid().nullable(),
  employmentType: z.string().trim().min(1).max(60),
  description: z.string().trim().max(5000).nullable(),
  requirements: z.string().trim().max(5000).nullable(),
  salaryRange: z.string().trim().max(120).nullable(),
  requester: z.string().trim().min(1, "Informe o solicitante / gestor").max(150),
  recruiter: z.string().trim().max(150).nullable(),
  priority: z.enum(["BAIXA", "NORMAL", "ALTA"]),
  status: z.enum(["VAGAS_ABERTAS", "TRIAGEM", "ENTREVISTA", "AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"]),
  openingDate: z.string().date(),
  targetDate: z.string().date().nullable(),
  closedReason: z.string().trim().max(500).nullable(),
}).superRefine((value, context) => {
  if (!value.approvedRoleId && !value.allocationPositionId) {
    context.addIssue({
      code: "custom",
      path: ["approvedRoleId"],
      message: "Selecione um cargo aprovado.",
    });
  }
  if (value.approvedRoleId && value.allocationPositionId) {
    context.addIssue({
      code: "custom",
      path: ["approvedRoleId"],
      message: "Selecione somente um cargo aprovado.",
    });
  }
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

export const createRecruitmentApprovedRoleSchema = z.object({
  clientId: z.string().uuid("Selecione um cliente válido."),
  name: z.string().trim().min(1, "Informe o cargo").max(120, "Máximo de 120 caracteres"),
});
export type CreateRecruitmentApprovedRoleInput = z.input<typeof createRecruitmentApprovedRoleSchema>;

export const updateRecruitmentApprovedRoleSchema = z.object({
  id: z.string().uuid("Cargo inválido."),
  name: z.string().trim().min(1, "Informe o cargo").max(120, "Máximo de 120 caracteres"),
});
export type UpdateRecruitmentApprovedRoleInput = z.input<typeof updateRecruitmentApprovedRoleSchema>;

export const deleteRecruitmentApprovedRoleSchema = z.object({
  id: z.string().uuid("Cargo inválido."),
});
export type DeleteRecruitmentApprovedRoleInput = z.input<typeof deleteRecruitmentApprovedRoleSchema>;

export const setRecruitmentApprovedRoleActiveSchema = z.object({
  id: z.string().uuid("Cargo inválido."),
  active: z.boolean(),
});
export type SetRecruitmentApprovedRoleActiveInput = z.input<typeof setRecruitmentApprovedRoleActiveSchema>;

export const createRecruitmentClientSchema = z.object({
  name: z.string().trim().min(1, "Informe o cliente").max(120, "Máximo de 120 caracteres"),
});
export type CreateRecruitmentClientInput = z.input<typeof createRecruitmentClientSchema>;

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
    (value) => ["TRIAGEM", "ENTREVISTA", "AGENDAMENTO_ASO", "INTEGRACAO", "REPROVADO", "CONTRATADO"].includes(String(value)),
    "Selecione uma etapa válida.",
  ),
});

export const saveRecruitmentCandidateScheduleSchema = z.object({
  id: z.string().uuid(),
  vacancyId: z.string().uuid(),
  triageScheduledAt: z.string().datetime({ offset: true }).nullable(),
  interviewScheduledAt: z.string().datetime({ offset: true }).nullable(),
  asoScheduledAt: z.string().datetime({ offset: true }).nullable(),
  integrationScheduledAt: z.string().datetime({ offset: true }).nullable(),
  hiredAt: z.string().date().nullable(),
});

export type SaveRecruitmentCandidateScheduleInput = z.input<typeof saveRecruitmentCandidateScheduleSchema>;
export type SaveRecruitmentCandidateScheduleOutput = z.output<typeof saveRecruitmentCandidateScheduleSchema>;

export const updateRecruitmentVacancyStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.custom<RecruitmentVacancyStatusValue>(
    (value) => ["VAGAS_ABERTAS", "TRIAGEM", "ENTREVISTA", "AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(String(value)),
    "Selecione um status válido.",
  ),
  selectedCandidateId: z.string().uuid().nullable(),
});
