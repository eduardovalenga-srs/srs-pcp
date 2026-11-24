import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  EmployeeAllocationNodeRow,
  EmployeeStatusValue,
  RecruitmentCandidateRow,
  RecruitmentVacancyRow,
} from "@/lib/types/database";
import {
  buildRecruitmentFormOptions,
  isNodePathActive,
  normalizeRecruitmentLabel,
  resolveRecruitmentVacancySelection,
  type RecruitmentFormOptions,
  type RecruitmentVacancyDetails,
  type RecruitmentVacancySelection,
  type VacancyListItem,
} from "@/lib/types/recruitment";
import { getEmployeeAllocationNodes } from "@/lib/repositories/employee-allocation.repository";
import type {
  CreateRecruitmentCandidateOutput,
  SaveRecruitmentVacancyOutput,
} from "@/lib/validators/recruitment.schema";
import { assertOk } from "@/lib/utils/supabase-result";

const VACANCY_COLUMNS =
  "id, title, customer, request_reason, replacement_employee_id, allocation_client_id, allocation_location_id, allocation_area_id, allocation_position_id, department, location, employment_type, quantity, description, requirements, salary_range, requester, recruiter, priority, status, opening_date, target_date, closed_reason, created_at, updated_at, created_by, updated_by";
const CANDIDATE_COLUMNS =
  "id, vacancy_id, name, email, phone, source, stage, notes, created_at, updated_at, created_by, updated_by";

export async function getRecruitmentVacancies(client: SupabaseServer): Promise<VacancyListItem[]> {
  const [{ data: vacancies, error: vacancyError }, { data: candidates, error: candidateError }] =
    await Promise.all([
      client.from("recruitment_vacancies").select(VACANCY_COLUMNS).order("opening_date", { ascending: false }),
      client.from("recruitment_candidates").select("vacancy_id").range(0, 9999),
    ]);

  assertOk(vacancyError, "Não foi possível carregar as vagas");
  assertOk(candidateError, "Não foi possível carregar os candidatos");

  const counts = new Map<string, number>();
  for (const candidate of candidates ?? []) {
    counts.set(candidate.vacancy_id, (counts.get(candidate.vacancy_id) ?? 0) + 1);
  }

  return ((vacancies ?? []) as unknown as RecruitmentVacancyRow[]).map((vacancy) => ({
    ...vacancy,
    candidate_count: counts.get(vacancy.id) ?? 0,
  }));
}

export async function getRecruitmentFormOptions(
  client: SupabaseServer,
): Promise<RecruitmentFormOptions> {
  const [allocationNodes, customerRows, employeeRows] = await Promise.all([
    getEmployeeAllocationNodes(client),
    getOrderCustomers(client),
    client
      .from("employees")
      .select("id, name, allocation_position_id")
      .eq("status", "ATIVO")
      .not("allocation_position_id", "is", null)
      .order("name", { ascending: true }),
  ]);
  assertOk(employeeRows.error, "Não foi possível carregar os funcionários alocados");

  return buildRecruitmentFormOptions(
    customerRows,
    allocationNodes,
    (employeeRows.data ?? []).map((employee) => ({
      id: employee.id,
      name: employee.name,
      allocation_position_id: employee.allocation_position_id,
    })),
  );
}

async function getOrderCustomers(client: SupabaseServer): Promise<string[]> {
  const pageSize = 1000;
  const customers: string[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await client
      .from("orders")
      .select("customer_name")
      .eq("type", "OF")
      .not("customer_name", "is", null)
      .order("customer_name", { ascending: true })
      .range(from, from + pageSize - 1);
    assertOk(error, "Não foi possível carregar os clientes das OFs");
    const page = (data ?? []).map((row) => row.customer_name ?? "");
    customers.push(...page);
    hasMore = page.length === pageSize;
    from += page.length;
  }

  return customers;
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
  const [allocationNodes, orderCustomers] = await Promise.all([
    getEmployeeAllocationNodes(client),
    getOrderCustomers(client),
  ]);
  if (!orderCustomers.some((name) => normalizeRecruitmentLabel(name) === normalizeRecruitmentLabel(input.customer))) {
    throw new Error("Selecione um cliente encontrado nas ordens de fabricação.");
  }

  const selection: RecruitmentVacancySelection = {
    customer: input.customer,
    allocationClientId: input.allocationClientId,
    allocationLocationId: input.allocationLocationId,
    allocationAreaId: input.allocationAreaId,
    allocationPositionId: input.allocationPositionId,
  };
  const labels = resolveRecruitmentVacancySelection(allocationNodes, selection);
  if (!labels) {
    throw new Error("Local, área ou cargo não pertence ao cliente selecionado ou está inativo.");
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

  const isClosed = input.status === "ENCERRADA" || input.status === "CANCELADA";
  const values = {
    title: labels.title,
    customer: input.customer,
    request_reason: input.requestReason,
    replacement_employee_id: input.requestReason === "SUBSTITUICAO" ? input.replacementEmployeeId : null,
    allocation_client_id: input.allocationClientId,
    allocation_location_id: input.allocationLocationId,
    allocation_area_id: input.allocationAreaId,
    allocation_position_id: input.allocationPositionId,
    department: labels.department,
    location: labels.location,
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
    closed_reason: isClosed ? input.closedReason || null : null,
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
  closedReason: string | null,
  userId: string,
): Promise<void> {
  const isClosed = status === "ENCERRADA" || status === "CANCELADA";
  const { error } = await client
    .from("recruitment_vacancies")
    .update({
      status,
      closed_reason: isClosed ? closedReason || null : null,
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
  const { error } = await client
    .from("recruitment_candidates")
    .update({ stage, updated_by: userId })
    .eq("id", id)
    .eq("vacancy_id", vacancyId)
    .select("id")
    .single();
  assertOk(error, "Não foi possível atualizar a etapa do candidato");
}
