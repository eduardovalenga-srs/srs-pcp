import { describe, expect, it } from "vitest";

import { saveRecruitmentVacancySchema } from "@/lib/validators/recruitment.schema";

const validVacancy = {
  customer: "Cliente da OF",
  allocationClientId: "11111111-1111-4111-8111-111111111111",
  allocationLocationId: "22222222-2222-4222-8222-222222222222",
  allocationAreaId: "33333333-3333-4333-8333-333333333333",
  allocationPositionId: "44444444-4444-4444-8444-444444444444",
  requestReason: "NOVA_VAGA",
  replacementEmployeeId: null,
  employmentType: "CLT",
  description: null,
  requirements: null,
  salaryRange: null,
  requester: "Gestor da área",
  recruiter: null,
  priority: "NORMAL",
  status: "RASCUNHO",
  openingDate: "2026-11-23",
  targetDate: null,
  closedReason: null,
};

describe("formulário de solicitação de vaga", () => {
  it("exige cliente, local, área, cargo e solicitante sem quantidade", () => {
    expect(saveRecruitmentVacancySchema.safeParse(validVacancy).success).toBe(true);
    expect(saveRecruitmentVacancySchema.safeParse({ ...validVacancy, customer: "" }).success).toBe(false);
    expect(saveRecruitmentVacancySchema.safeParse({ ...validVacancy, requester: "" }).success).toBe(false);
    expect(saveRecruitmentVacancySchema.safeParse({ ...validVacancy, allocationPositionId: "" }).success).toBe(false);
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
