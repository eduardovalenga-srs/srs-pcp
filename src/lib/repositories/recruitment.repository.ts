import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  EmployeeAllocationNodeRow,
  RecruitmentApprovedRoleRow,
  EmployeeStatusValue,
  RecruitmentCandidateRow,
  RecruitmentVacancyRow,
} from "@/lib/types/database";
import {
  buildRecruitmentFormOptions,
  isNodePathActive,
  normalizeRecruitmentLabel,
  resolveRecruitmentVacancyArea,
  resolveRecruitmentVacancySelection,
  type RecruitmentFormOptions,
  type RecruitmentApprovedRoleManagementData,
  type RecruitmentVacancyDetails,
  type VacancyListItem,
} from "@/lib/types/recruitment";
import {
  createEmployeeAllocationNode,
  getEmployeeAllocationNodeById,
  getEmployeeAllocationNodes,
} from "@/lib/repositories/employee-allocation.repository";
import type {
  CreateRecruitmentCandidateOutput,
  CreateRecruitmentApprovedRoleInput,
  UpdateRecruitmentApprovedRoleInput,
  SaveRecruitmentVacancyOutput,
  SaveRecruitmentCandidateScheduleOutput,
} from "@/lib/validators/recruitment.schema";
import { assertOk } from "@/lib/utils/supabase-result";

const VACANCY_COLUMNS =
  "id, title, customer, request_reason, replacement_employee_id, allocation_client_id, allocation_location_id, allocation_area_id, allocation_position_id, approved_role_id, selected_candidate_id, department, location, employment_type, quantity, description, requirements, salary_range, requester, recruiter, priority, status, opening_date, target_date, closed_reason, created_at, updated_at, created_by, updated_by";
const CANDIDATE_COLUMNS =
  "id, vacancy_id, name, email, phone, source, stage, notes, triage_scheduled_at, interview_scheduled_at, aso_scheduled_at, integration_scheduled_at, hired_at, created_at, updated_at, created_by, updated_by";
const APPROVED_ROLE_COLUMNS = "id, client_id, name, active, created_at, updated_at, created_by, updated_by";

function sameInstant(left: string | null, right: string | null): boolean {
  if (!left || !right) return left === right;
  return new Date(left).getTime() === new Date(right).getTime();
}

export async function getRecruitmentVacancies(client: SupabaseServer): Promise<VacancyListItem[]> {
  const [{ data: vacancies, error: vacancyError }, { data: candidates, error: candidateError }] =
    await Promise.all([
      client.from("recruitment_vacancies").select(VACANCY_COLUMNS).order("opening_date", { ascending: false }),
      client.from("recruitment_candidates").select("id, vacancy_id, name, hired_at").range(0, 9999),
    ]);

  assertOk(vacancyError, "Não foi possível carregar as vagas");
  assertOk(candidateError, "Não foi possível carregar os candidatos");

  const counts = new Map<string, number>();
  const candidatesById = new Map<string, { name: string; hired_at: string | null }>();
  for (const candidate of candidates ?? []) {
    counts.set(candidate.vacancy_id, (counts.get(candidate.vacancy_id) ?? 0) + 1);
    candidatesById.set(candidate.id, { name: candidate.name, hired_at: candidate.hired_at });
  }

  return ((vacancies ?? []) as unknown as RecruitmentVacancyRow[]).map((vacancy) => ({
    ...vacancy,
    candidate_count: counts.get(vacancy.id) ?? 0,
    selected_candidate_name: candidatesById.get(vacancy.selected_candidate_id ?? "")?.name ?? null,
    selected_candidate_hired_at: candidatesById.get(vacancy.selected_candidate_id ?? "")?.hired_at ?? null,
  }));
}

export async function getRecruitmentFormOptions(
  client: SupabaseServer,
): Promise<RecruitmentFormOptions> {
  const [allocationNodes, employeeRows, approvedRoleRows] = await Promise.all([
    getEmployeeAllocationNodes(client),
    client
      .from("employees")
      .select("id, name, allocation_position_id")
      .eq("status", "ATIVO")
      .not("allocation_position_id", "is", null)
      .order("name", { ascending: true }),
    client
      .from("recruitment_approved_roles")
      .select(APPROVED_ROLE_COLUMNS)
      .order("name", { ascending: true }),
  ]);
  assertOk(employeeRows.error, "Não foi possível carregar os funcionários alocados");
  assertOk(approvedRoleRows.error, "Não foi possível carregar os cargos aprovados");

  return buildRecruitmentFormOptions(
    allocationNodes,
    (employeeRows.data ?? []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      allocation_position_id: employee.allocation_position_id,
    })),
    (approvedRoleRows.data ?? []) as unknown as RecruitmentApprovedRoleRow[],
  );
}

export async function getRecruitmentApprovedRoleManagementData(
  client: SupabaseServer,
): Promise<RecruitmentApprovedRoleManagementData> {
  const [clientResult, roleResult] = await Promise.all([
    client.rpc("current_profile_recruitment_clients"),
    client.from("recruitment_approved_roles").select(APPROVED_ROLE_COLUMNS).order("name", { ascending: true }),
  ]);
  assertOk(clientResult.error, "Não foi possível carregar os clientes vinculados");
  assertOk(roleResult.error, "Não foi possível carregar os cargos aprovados");

  const clients = (clientResult.data ?? []).map((client) => ({
    id: client.id,
    name: client.name,
    active: client.active,
  }));
  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const roles = ((roleResult.data ?? []) as unknown as RecruitmentApprovedRoleRow[])
    .map((role) => ({
      ...role,
      client_name: clientNames.get(role.client_id) ?? "Cliente não encontrado",
    }))
    .sort((left, right) =>
      `${left.client_name} ${left.name}`.localeCompare(`${right.client_name} ${right.name}`, "pt-BR"),
    );

  return { clients, roles };
}

export async function createRecruitmentCustomer(
  client: SupabaseServer,
  name: string,
  userId: string,
): Promise<string> {
  const existingNodes = await getEmployeeAllocationNodes(client);
  if (existingNodes.some((node) =>
    node.node_type === "CLIENT" &&
    normalizeRecruitmentLabel(node.name) === normalizeRecruitmentLabel(name),
  )) {
    throw new Error("Esse cliente já está cadastrado na árvore de alocações.");
  }
  return createEmployeeAllocationNode(client, {
    companyCode: "CLIENTES",
    companyName: "Clientes",
    parentId: null,
    nodeType: "CLIENT",
    name,
    userId,
  });
}

export async function createRecruitmentApprovedRole(
  client: SupabaseServer,
  input: CreateRecruitmentApprovedRoleInput,
  userId: string,
): Promise<RecruitmentApprovedRoleRow> {
  const allocationNode = await getEmployeeAllocationNodeById(client, input.clientId);
  if (!allocationNode || allocationNode.node_type !== "CLIENT" || !allocationNode.active) {
    throw new Error("Selecione um cliente ativo cadastrado na árvore de alocações.");
  }
  const { data, error } = await client
    .from("recruitment_approved_roles")
    .insert({
      client_id: input.clientId,
      name: input.name,
      created_by: userId,
      updated_by: userId,
    })
    .select(APPROVED_ROLE_COLUMNS)
    .single();
  assertOk(error, "Não foi possível cadastrar o cargo aprovado. Verifique se já existe para este cliente.");
  return data as unknown as RecruitmentApprovedRoleRow;
}

export async function setRecruitmentApprovedRoleActive(
  client: SupabaseServer,
  id: string,
  active: boolean,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("recruitment_approved_roles")
    .update({ active, updated_by: userId })
    .eq("id", id)
    .select("id")
    .single();
  assertOk(error, "Não foi possível atualizar o cargo aprovado");
}

export async function updateRecruitmentApprovedRole(
  client: SupabaseServer,
  input: UpdateRecruitmentApprovedRoleInput,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("recruitment_approved_roles")
    .update({ name: input.name, updated_by: userId })
    .eq("id", input.id)
    .select("id")
    .single();

  if (error?.code === "23505") {
    throw new Error("Já existe um cargo com esse nome para o cliente.");
  }
  assertOk(error, "Não foi possível editar o cargo aprovado");
}

export async function deleteRecruitmentApprovedRole(
  client: SupabaseServer,
  id: string,
): Promise<void> {
  const { error } = await client
    .from("recruitment_approved_roles")
    .delete()
    .eq("id", id)
    .select("id")
    .single();

  if (error?.code === "23503") {
    throw new Error("Este cargo está vinculado a uma ou mais vagas e não pode ser excluído. Inative-o para preservar o histórico.");
  }
  assertOk(error, "Não foi possível excluir o cargo aprovado");
}

export async function getRecruitmentVacancy(
  client: SupabaseServer,
  id: string,
): Promise<RecruitmentVacancyDetails | null> {
  const { data, error } = await client
    .from("recruitment_vacancies")
    .select(VACANCY_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  assertOk(error, "Não foi possível carregar a vaga");
  const vacancy = data as unknown as RecruitmentVacancyRow | null;
  if (!vacancy) return null;
  if (!vacancy.replacement_employee_id) return { ...vacancy, replacement_employee_name: null };

  const { data: employee, error: employeeError } = await client
    .from("employees")
    .select("name")
    .eq("id", vacancy.replacement_employee_id)
    .maybeSingle();
  assertOk(employeeError, "Não foi possível carregar o funcionário substituído");
  return { ...vacancy, replacement_employee_name: employee?.name ?? null };
}

export async function getRecruitmentCandidates(
  client: SupabaseServer,
  vacancyId: string,
): Promise<RecruitmentCandidateRow[]> {
  const { data, error } = await client
    .from("recruitment_candidates")
    .select(CANDIDATE_COLUMNS)
    .eq("vacancy_id", vacancyId)
    .order("created_at", { ascending: false });
  assertOk(error, "Não foi possível carregar os candidatos");
  return (data ?? []) as unknown as RecruitmentCandidateRow[];
}

export async function saveRecruitmentVacancy(
  client: SupabaseServer,
  input: SaveRecruitmentVacancyOutput,
  userId: string,
): Promise<RecruitmentVacancyRow> {
  const allocationNodes = await getEmployeeAllocationNodes(client);
  let existingVacancy: Pick<RecruitmentVacancyRow, "approved_role_id" | "allocation_position_id"> | null = null;
  if (input.id) {
    const { data, error } = await client
      .from("recruitment_vacancies")
      .select("approved_role_id, allocation_position_id")
      .eq("id", input.id)
      .maybeSingle();
    assertOk(error, "Não foi possível validar a vaga");
    existingVacancy = data;
    if (!existingVacancy) throw new Error("A vaga não foi encontrada.");
  }

  let title: string;
  let department: string;
  let location: string;
  let approvedRoleId: string | null = null;
  let allocationPositionId: string | null = null;

  if (input.approvedRoleId) {
    const labels = resolveRecruitmentVacancyArea(allocationNodes, {
      customer: input.customer,
      allocationClientId: input.allocationClientId,
      allocationLocationId: input.allocationLocationId,
      allocationAreaId: input.allocationAreaId,
    });
    if (!labels) {
      throw new Error("Local ou área não pertence ao cliente selecionado ou está inativo.");
    }
    const { data: role, error: roleError } = await client
      .from("recruitment_approved_roles")
      .select("id, client_id, name, active")
      .eq("id", input.approvedRoleId)
      .eq("client_id", input.allocationClientId)
      .maybeSingle();
    assertOk(roleError, "Não foi possível validar o cargo aprovado");
    if (
      !role ||
      (!role.active && existingVacancy?.approved_role_id !== role.id)
    ) {
      throw new Error("O cargo aprovado não está ativo para o cliente selecionado.");
    }
    title = role.name;
    department = labels.department;
    location = labels.location;
    approvedRoleId = role.id;
  } else {
    if (
      !input.id ||
      !input.allocationPositionId ||
      existingVacancy?.approved_role_id ||
      existingVacancy?.allocation_position_id !== input.allocationPositionId
    ) {
      throw new Error("Selecione um cargo aprovado para esta vaga.");
    }
    const labels = resolveRecruitmentVacancySelection(allocationNodes, {
      customer: input.customer,
      allocationClientId: input.allocationClientId,
      allocationLocationId: input.allocationLocationId,
      allocationAreaId: input.allocationAreaId,
      allocationPositionId: input.allocationPositionId,
    });
    if (!labels) {
      throw new Error("O cargo legado não pertence ao local selecionado ou está inativo.");
    }
    title = labels.title;
    department = labels.department;
    location = labels.location;
    allocationPositionId = input.allocationPositionId;
  }

  if (input.requestReason === "SUBSTITUICAO") {
    if (!input.replacementEmployeeId) {
      throw new Error("Selecione o funcionário que será substituído.");
    }
    await assertEmployeeBelongsToClient(
      client,
      allocationNodes,
      input.replacementEmployeeId,
      input.allocationClientId,
    );
  }

  const values = {
    title,
    customer: input.customer,
    request_reason: input.requestReason,
    replacement_employee_id: input.requestReason === "SUBSTITUICAO" ? input.replacementEmployeeId : null,
    allocation_client_id: input.allocationClientId,
    allocation_location_id: input.allocationLocationId,
    allocation_area_id: input.allocationAreaId,
    allocation_position_id: allocationPositionId,
    approved_role_id: approvedRoleId,
    department,
    location,
    employment_type: input.employmentType,
    quantity: 1,
    description: input.description || null,
    requirements: input.requirements || null,
    salary_range: input.salaryRange || null,
    requester: input.requester || null,
    recruiter: input.recruiter || null,
    priority: input.priority,
    status: input.status,
    opening_date: input.openingDate,
    target_date: input.targetDate || null,
    closed_reason: null,
    updated_by: userId,
  };
  const query = input.id
    ? client.from("recruitment_vacancies").update(values).eq("id", input.id)
    : client.from("recruitment_vacancies").insert({ ...values, created_by: userId });
  const { data, error } = await query.select(VACANCY_COLUMNS).single();
  assertOk(error, "Não foi possível salvar a vaga");
  return data as unknown as RecruitmentVacancyRow;
}

async function assertEmployeeBelongsToClient(
  client: SupabaseServer,
  allocationNodes: EmployeeAllocationNodeRow[],
  employeeId: string,
  allocationClientId: string,
): Promise<void> {
  const { data, error } = await client
    .from("employees")
    .select("id, allocation_position_id, status")
    .eq("id", employeeId)
    .maybeSingle();
  assertOk(error, "Não foi possível validar o funcionário selecionado");
  if (!data || (data.status as EmployeeStatusValue) !== "ATIVO" || !data.allocation_position_id) {
    throw new Error("O funcionário selecionado não está ativo ou não possui alocação.");
  }

  const byId = new Map(allocationNodes.map((node) => [node.id, node]));
  const position = byId.get(data.allocation_position_id);
  if (!position || position.node_type !== "POSITION" || !isNodePathActive(position, byId)) {
    throw new Error("O funcionário selecionado não possui uma alocação ativa.");
  }

  let current: EmployeeAllocationNodeRow | undefined = position;
  const visited = new Set<string>();
  while (current && current.node_type !== "CLIENT" && !visited.has(current.id)) {
    visited.add(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  if (!current || current.id !== allocationClientId) {
    throw new Error("O funcionário selecionado não está vinculado ao cliente desta vaga.");
  }
}

export async function updateRecruitmentVacancyStatus(
  client: SupabaseServer,
  id: string,
  status: RecruitmentVacancyRow["status"],
  selectedCandidateId: string | null,
  userId: string,
): Promise<void> {
  const { data: vacancy, error: vacancyError } = await client
    .from("recruitment_vacancies")
    .select("id, status, selected_candidate_id")
    .eq("id", id)
    .maybeSingle();
  assertOk(vacancyError, "Não foi possível carregar a vaga");
  if (!vacancy) throw new Error("A vaga não foi encontrada.");

  const requiresSelectedCandidate = ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(status);
  if (requiresSelectedCandidate && !selectedCandidateId) {
    throw new Error("Selecione o candidato que seguirá nesta vaga.");
  }

  const selectedId = selectedCandidateId || null;
  const alreadyAtAsoOrLater = ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADOS"].includes(vacancy.status);
  if (
    alreadyAtAsoOrLater &&
    requiresSelectedCandidate &&
    vacancy.selected_candidate_id &&
    selectedId !== vacancy.selected_candidate_id
  ) {
    throw new Error("Para trocar o candidato, retorne a vaga para Entrevista primeiro.");
  }

  if (
    !requiresSelectedCandidate &&
    vacancy.selected_candidate_id &&
    !selectedId
  ) {
    const { error: resetStageError } = await client
      .from("recruitment_candidates")
      .update({ stage: "ENTREVISTA", updated_by: userId })
      .eq("id", vacancy.selected_candidate_id)
      .eq("vacancy_id", id)
      .in("stage", ["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADO"]);
    assertOk(resetStageError, "Não foi possível retornar o candidato à etapa de entrevista");
  }

  if (selectedId) {
    const { data: candidate, error: candidateError } = await client
      .from("recruitment_candidates")
      .select("id, hired_at, stage")
      .eq("id", selectedId)
      .eq("vacancy_id", id)
      .maybeSingle();
    assertOk(candidateError, "Não foi possível validar o candidato selecionado");
    if (!candidate) throw new Error("O candidato selecionado não pertence a esta vaga.");
    if (candidate.stage === "REPROVADO") {
      throw new Error("Não é possível selecionar um candidato reprovado para avançar na vaga.");
    }

    if (status === "CONTRATADOS" && !candidate.hired_at) {
      throw new Error("Informe a data de contratação do candidato antes de concluir a vaga.");
    }

    const selectedStage: Partial<Record<RecruitmentVacancyRow["status"], RecruitmentCandidateRow["stage"]>> = {
      AGENDAMENTO_ASO: "AGENDAMENTO_ASO",
      INTEGRACAO: "INTEGRACAO",
      CONTRATADOS: "CONTRATADO",
    };
    const candidateStage = selectedStage[status];
    if (candidateStage) {
      const { error: stageError } = await client
        .from("recruitment_candidates")
        .update({ stage: candidateStage, updated_by: userId })
        .eq("id", selectedId)
        .eq("vacancy_id", id);
      assertOk(stageError, "Não foi possível atualizar a etapa do candidato selecionado");
    }
  }

  const { error } = await client
    .from("recruitment_vacancies")
    .update({
      status,
      selected_candidate_id: selectedId,
      updated_by: userId,
    })
    .eq("id", id)
    .select("id")
    .single();
  assertOk(error, "Não foi possível atualizar o status da vaga");
}

export async function createRecruitmentCandidate(
  client: SupabaseServer,
  input: CreateRecruitmentCandidateOutput,
  userId: string,
): Promise<RecruitmentCandidateRow> {
  const { data, error } = await client
    .from("recruitment_candidates")
    .insert({
      vacancy_id: input.vacancyId,
      name: input.name,
      stage: "TRIAGEM",
      email: input.email || null,
      phone: input.phone || null,
      source: input.source || null,
      notes: input.notes || null,
      created_by: userId,
      updated_by: userId,
    })
    .select(CANDIDATE_COLUMNS)
    .single();
  assertOk(error, "Não foi possível cadastrar o candidato");
  return data as unknown as RecruitmentCandidateRow;
}

export async function updateRecruitmentCandidateStage(
  client: SupabaseServer,
  id: string,
  vacancyId: string,
  stage: RecruitmentCandidateRow["stage"],
  userId: string,
): Promise<void> {
  const { data: candidate, error: candidateError } = await client
    .from("recruitment_candidates")
    .select("id")
    .eq("id", id)
    .eq("vacancy_id", vacancyId)
    .maybeSingle();
  assertOk(candidateError, "Não foi possível validar o candidato");
  if (!candidate) throw new Error("O candidato não pertence a esta vaga.");

  if (["AGENDAMENTO_ASO", "INTEGRACAO", "CONTRATADO"].includes(stage)) {
    throw new Error("Avance para ASO, integração ou contratação pelo status da vaga.");
  }

  const { error } = await client
    .from("recruitment_candidates")
    .update({ stage, updated_by: userId })
    .eq("id", id)
    .eq("vacancy_id", vacancyId)
    .select("id")
    .single();
  assertOk(error, "Não foi possível atualizar a etapa do candidato");
}

export async function saveRecruitmentCandidateSchedule(
  client: SupabaseServer,
  input: SaveRecruitmentCandidateScheduleOutput,
  userId: string,
): Promise<void> {
  const { data: candidate, error: candidateError } = await client
    .from("recruitment_candidates")
    .select("id, vacancy_id, triage_scheduled_at, interview_scheduled_at, aso_scheduled_at, integration_scheduled_at, hired_at")
    .eq("id", input.id)
    .eq("vacancy_id", input.vacancyId)
    .maybeSingle();
  assertOk(candidateError, "Não foi possível carregar os agendamentos do candidato");
  if (!candidate) throw new Error("O candidato não pertence a esta vaga.");

  const { data: vacancy, error: vacancyError } = await client
    .from("recruitment_vacancies")
    .select("status, selected_candidate_id")
    .eq("id", input.vacancyId)
    .maybeSingle();
  assertOk(vacancyError, "Não foi possível validar a vaga");
  const isSelectedCandidate = vacancy?.selected_candidate_id === input.id;
  const completingLegacyHiredCandidate =
    vacancy?.status === "CONTRATADOS" && !vacancy.selected_candidate_id;
  const advancedScheduleChanged =
    !sameInstant(input.asoScheduledAt, candidate.aso_scheduled_at) ||
    !sameInstant(input.integrationScheduledAt, candidate.integration_scheduled_at) ||
    input.hiredAt !== candidate.hired_at;
  if (!isSelectedCandidate && !completingLegacyHiredCandidate && advancedScheduleChanged) {
    throw new Error("Agendamento de ASO, integração e contratação só pode ser alterado para o candidato selecionado.");
  }

  const { error } = await client
    .from("recruitment_candidates")
    .update({
      triage_scheduled_at: input.triageScheduledAt,
      interview_scheduled_at: input.interviewScheduledAt,
      aso_scheduled_at: input.asoScheduledAt,
      integration_scheduled_at: input.integrationScheduledAt,
      hired_at: input.hiredAt,
      updated_by: userId,
    })
    .eq("id", input.id)
    .eq("vacancy_id", input.vacancyId)
    .select("id")
    .single();
  assertOk(error, "Não foi possível salvar os agendamentos do candidato");
}
