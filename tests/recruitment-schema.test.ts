import { describe, expect, it } from "vitest";

import {
  deleteRecruitmentApprovedRoleSchema,
  saveRecruitmentCandidateScheduleSchema,
  saveRecruitmentVacancySchema,
  updateRecruitmentApprovedRoleSchema,
} from "@/lib/validators/recruitment.schema";

const validVacancy = {
  customer: "Cliente da OF",
  allocationClientId: "11111111-1111-4111-8111-111111111111",
  allocationLocationId: "22222222-2222-4222-8222-222222222222",
  allocationAreaId: "33333333-3333-4333-8333-333333333333",
  approvedRoleId: "44444444-4444-4444-8444-444444444444",
  allocationPositionId: null,
  requestReason: "NOVA_VAGA",
  replacementEmployeeId: null,
  employmentType: "CLT",
  description: null,
  requirements: null,
  salaryRange: null,
  requester: "Gestor da área",
  recruiter: null,
  priority: "NORMAL",
  status: "VAGAS_ABERTAS",
  openingDate: "2026-11-23",
  targetDate: null,
  closedReason: null,
};

describe("formulário de solicitação de vaga", () => {
  it("exige cliente, local, área, cargo aprovado e solicitante sem quantidade", () => {
    expect(saveRecruitmentVacancySchema.safeParse(validVacancy).success).toBe(true);
    expect(saveRecruitmentVacancySchema.safeParse({ ...validVacancy, customer: "" }).success).toBe(false);
    expect(saveRecruitmentVacancySchema.safeParse({ ...validVacancy, requester: "" }).success).toBe(false);
    expect(saveRecruitmentVacancySchema.safeParse({ ...validVacancy, approvedRoleId: null }).success).toBe(false);
    expect(
      saveRecruitmentVacancySchema.safeParse({
        ...validVacancy,
        approvedRoleId: null,
        allocationPositionId: "55555555-5555-4555-8555-555555555555",
      }).success,
    ).toBe(true);
    expect(
      saveRecruitmentVacancySchema.safeParse({
        ...validVacancy,
        allocationPositionId: "55555555-5555-4555-8555-555555555555",
      }).success,
    ).toBe(false);
  });

  it("exige funcionário vinculado somente quando o motivo for substituição", () => {
    expect(
      saveRecruitmentVacancySchema.safeParse({
        ...validVacancy,
        requestReason: "SUBSTITUICAO",
        replacementEmployeeId: null,
      }).success,
    ).toBe(false);
    expect(
      saveRecruitmentVacancySchema.safeParse({
        ...validVacancy,
        requestReason: "SUBSTITUICAO",
        replacementEmployeeId: "55555555-5555-4555-8555-555555555555",
      }).success,
    ).toBe(true);
    expect(
      saveRecruitmentVacancySchema.safeParse({
        ...validVacancy,
        requestReason: "REFORCO",
        replacementEmployeeId: "55555555-5555-4555-8555-555555555555",
      }).success,
    ).toBe(false);
  });
});

describe("agendamento da entrevista", () => {
  const validSchedule = {
    id: "11111111-1111-4111-8111-111111111111",
    vacancyId: "22222222-2222-4222-8222-222222222222",
    triageScheduledAt: null,
    interviewScheduledAt: null,
    interviewerName: null,
    asoScheduledAt: null,
    integrationScheduledAt: null,
    hiredAt: null,
  };

  it("exige e normaliza o nome do entrevistador quando há horário marcado", () => {
    expect(saveRecruitmentCandidateScheduleSchema.safeParse(validSchedule).success).toBe(true);
    expect(
      saveRecruitmentCandidateScheduleSchema.safeParse({
        ...validSchedule,
        interviewScheduledAt: "2026-11-25T10:00:00-03:00",
      }).success,
    ).toBe(false);
    expect(
      saveRecruitmentCandidateScheduleSchema.parse({
        ...validSchedule,
        interviewScheduledAt: "2026-11-25T10:00:00-03:00",
        interviewerName: "  Ana Entrevistadora  ",
      }).interviewerName,
    ).toBe("Ana Entrevistadora");
  });

  it("limita o nome do entrevistador a 150 caracteres", () => {
    expect(
      saveRecruitmentCandidateScheduleSchema.safeParse({
        ...validSchedule,
        interviewerName: "A".repeat(151),
      }).success,
    ).toBe(false);
  });
});

describe("ações de cargos aprovados", () => {
  it("valida a edição do nome e o id usado para exclusão", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(updateRecruitmentApprovedRoleSchema.parse({ id, name: "  Soldador  " })).toEqual({
      id,
      name: "Soldador",
    });
    expect(updateRecruitmentApprovedRoleSchema.safeParse({ id, name: " " }).success).toBe(false);
    expect(deleteRecruitmentApprovedRoleSchema.parse({ id })).toEqual({ id });
    expect(deleteRecruitmentApprovedRoleSchema.safeParse({ id: "inválido" }).success).toBe(false);
  });
});
