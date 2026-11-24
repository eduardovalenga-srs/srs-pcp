"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { createRecruitmentCandidate, saveRecruitmentVacancy, updateRecruitmentCandidateStage, updateRecruitmentVacancyStatus } from "@/lib/repositories/recruitment.repository";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import {
  createRecruitmentCandidateSchema,
  saveRecruitmentVacancySchema,
  updateRecruitmentCandidateStageSchema,
  updateRecruitmentVacancyStatusSchema,
  type CreateRecruitmentCandidateInput,
  type SaveRecruitmentVacancyInput,
} from "@/lib/validators/recruitment.schema";

export type RecruitmentActionResult = { success: boolean; message: string; id?: string };

export async function saveRecruitmentVacancyAction(
  input: SaveRecruitmentVacancyInput,
): Promise<RecruitmentActionResult> {
  try {
    const user = await requireCapability("rh.recruitment.manage");
    const parsed = saveRecruitmentVacancySchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };
    const client = await createClient();
    const saved = await saveRecruitmentVacancy(client, parsed.data, user.id);
    revalidatePath("/rh/vagas");
    return { success: true, message: "Vaga salva com sucesso.", id: saved.id };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function updateRecruitmentVacancyStatusAction(input: {
  id: string;
  status: string;
  closedReason: string | null;
}): Promise<RecruitmentActionResult> {
  try {
    const user = await requireCapability("rh.recruitment.manage");
    const parsed = updateRecruitmentVacancyStatusSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };
    const client = await createClient();
    await updateRecruitmentVacancyStatus(
      client,
      parsed.data.id,
      parsed.data.status,
      parsed.data.closedReason,
      user.id,
    );
    revalidatePath("/rh/vagas");
    revalidatePath(`/rh/vagas/${parsed.data.id}`);
    return { success: true, message: "Status da vaga atualizado." };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function createRecruitmentCandidateAction(
  input: CreateRecruitmentCandidateInput,
): Promise<RecruitmentActionResult> {
  try {
    const user = await requireCapability("rh.recruitment.manage");
    const parsed = createRecruitmentCandidateSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };
    const client = await createClient();
    const saved = await createRecruitmentCandidate(client, parsed.data, user.id);
    revalidatePath(`/rh/vagas/${parsed.data.vacancyId}`);
    revalidatePath("/rh/vagas");
    return { success: true, message: "Candidato cadastrado com sucesso.", id: saved.id };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function updateRecruitmentCandidateStageAction(input: {
  id: string;
  stage: string;
  vacancyId: string;
}): Promise<RecruitmentActionResult> {
  try {
    const user = await requireCapability("rh.recruitment.manage");
    const parsed = updateRecruitmentCandidateStageSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };
    if (!/^[0-9a-f-]{36}$/i.test(input.vacancyId)) {
      return { success: false, message: "Vaga inválida." };
    }
    const client = await createClient();
    await updateRecruitmentCandidateStage(
      client,
      parsed.data.id,
      input.vacancyId,
      parsed.data.stage,
      user.id,
    );
    revalidatePath(`/rh/vagas/${input.vacancyId}`);
    return { success: true, message: "Etapa do candidato atualizada." };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}
