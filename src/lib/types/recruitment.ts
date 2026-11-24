import type {
  EmployeeAllocationNodeRow,
  RecruitmentCandidateStageValue,
  RecruitmentVacancyRow,
  RecruitmentVacancyStatusValue,
} from "@/lib/types/database";

export const VACANCY_STATUSES: { value: RecruitmentVacancyStatusValue; label: string }[] = [
  { value: "RASCUNHO", label: "Rascunho" },
  { value: "ABERTA", label: "Aberta" },
  { value: "PAUSADA", label: "Pausada" },
  { value: "PREENCHIDA", label: "Preenchida" },
  { value: "ENCERRADA", label: "Encerrada" },
  { value: "CANCELADA", label: "Cancelada" },
];

export const CANDIDATE_STAGES: { value: RecruitmentCandidateStageValue; label: string }[] = [
  { value: "NOVO", label: "Novo" },
  { value: "TRIAGEM", label: "Triagem" },
  { value: "ENTREVISTA", label: "Entrevista" },
  { value: "APROVADO", label: "Aprovado" },
  { value: "REPROVADO", label: "Reprovado" },
  { value: "CONTRATADO", label: "Contratado" },
];

export const EMPLOYMENT_TYPES = ["CLT", "PJ", "Temporário", "Estágio", "Aprendiz", "Outro"] as const;
export const VACANCY_PRIORITIES = ["BAIXA", "NORMAL", "ALTA"] as const;
export const RECRUITMENT_REQUEST_REASONS = [
  { value: "NOVA_VAGA", label: "Nova Vaga" },
  { value: "SUBSTITUICAO", label: "Substituição" },
  { value: "REFORCO", label: "Reforço" },
] as const;

export type VacancyListItem = RecruitmentVacancyRow & { candidate_count: number };
export type RecruitmentVacancyDetails = RecruitmentVacancyRow & {
  replacement_employee_name: string | null;
};

export type RecruitmentPositionOption = {
  id: string;
  name: string;
  shiftName: string;
};

export type RecruitmentAreaOption = {
  id: string;
  name: string;
  positions: RecruitmentPositionOption[];
};

export type RecruitmentLocationOption = {
  id: string;
  name: string;
  clientId: string;
  companyName: string;
  areas: RecruitmentAreaOption[];
};

export type RecruitmentEmployeeOption = {
  id: string;
  name: string;
  clientId: string;
};

export type RecruitmentCustomerOption = {
  name: string;
  allocationClientIds: string[];
  locations: RecruitmentLocationOption[];
  employees: RecruitmentEmployeeOption[];
};

export type RecruitmentFormOptions = {
  customers: RecruitmentCustomerOption[];
};

export type RecruitmentVacancySelection = {
  customer: string;
  allocationClientId: string;
  allocationLocationId: string;
  allocationAreaId: string;
  allocationPositionId: string;
};

export function normalizeRecruitmentLabel(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function buildRecruitmentFormOptions(
  customerNames: readonly string[],
  nodes: readonly EmployeeAllocationNodeRow[],
  employees: readonly { id: string; name: string; allocation_position_id: string | null }[],
): RecruitmentFormOptions {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const isActivePath = (start: EmployeeAllocationNodeRow) => {
    let current: EmployeeAllocationNodeRow | undefined = start;
    const visited = new Set<string>();
    while (current) {
      if (!current.active || visited.has(current.id)) return false;
      visited.add(current.id);
      if (!current.parent_id) return true;
      current = byId.get(current.parent_id);
    }
    return false;
  };
  const activeChildren = (parentId: string, nodeType: EmployeeAllocationNodeRow["node_type"]) =>
    nodes.filter(
      (node) =>
        node.parent_id === parentId &&
        node.node_type === nodeType &&
        isActivePath(node),
    );
  const clientAncestorForPosition = (positionId: string | null): string | null => {
    let current = positionId ? byId.get(positionId) : undefined;
    const visited = new Set<string>();
    while (current) {
      if (!isActivePath(current) || visited.has(current.id)) return null;
      visited.add(current.id);
      if (current.node_type === "CLIENT") return current.id;
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return null;
  };

  const uniqueCustomers = [...new Map(
    customerNames
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => [normalizeRecruitmentLabel(name), name]),
  ).values()].sort((left, right) => left.localeCompare(right, "pt-BR"));

  return {
    customers: uniqueCustomers.map((name) => {
      const allocationClients = nodes.filter(
        (node) =>
          node.node_type === "CLIENT" &&
          normalizeRecruitmentLabel(node.name) === normalizeRecruitmentLabel(name) &&
          isActivePath(node),
      );
      const locations = allocationClients.flatMap((client) =>
        activeChildren(client.id, "LOCATION").map((location) => ({
          id: location.id,
          name: location.name,
          clientId: client.id,
          companyName: location.company_name,
          areas: activeChildren(location.id, "AREA").map((area) => ({
            id: area.id,
            name: area.name,
            positions: activeChildren(area.id, "SHIFT").flatMap((shift) =>
              activeChildren(shift.id, "POSITION").map((position) => ({
                id: position.id,
                name: position.name,
                shiftName: shift.name,
              })),
            ).sort((left, right) =>
              `${left.name} ${left.shiftName}`.localeCompare(`${right.name} ${right.shiftName}`, "pt-BR"),
            ),
          })).sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
        })),
      ).sort((left, right) =>
        `${left.name} ${left.companyName}`.localeCompare(`${right.name} ${right.companyName}`, "pt-BR"),
      );
      const clientIds = new Set(allocationClients.map((client) => client.id));
      const clientEmployees = employees
        .flatMap((employee) => {
          const clientId = clientAncestorForPosition(employee.allocation_position_id);
          return clientId && clientIds.has(clientId)
            ? [{ id: employee.id, name: employee.name, clientId }]
            : [];
        })
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

      return {
        name,
        allocationClientIds: [...clientIds],
        locations,
        employees: clientEmployees,
      };
    }),
  };
}

export function resolveRecruitmentVacancySelection(
  nodes: readonly EmployeeAllocationNodeRow[],
  selection: RecruitmentVacancySelection,
): {
  title: string;
  department: string;
  location: string;
} | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const client = byId.get(selection.allocationClientId);
  const location = byId.get(selection.allocationLocationId);
  const area = byId.get(selection.allocationAreaId);
  const position = byId.get(selection.allocationPositionId);
  if (
    !client ||
    !location ||
    !area ||
    !position ||
    client.node_type !== "CLIENT" ||
    normalizeRecruitmentLabel(client.name) !== normalizeRecruitmentLabel(selection.customer) ||
    location.node_type !== "LOCATION" ||
    location.parent_id !== client.id ||
    area.node_type !== "AREA" ||
    area.parent_id !== location.id ||
    position.node_type !== "POSITION"
  ) {
    return null;
  }
  const shift = position.parent_id ? byId.get(position.parent_id) : undefined;
  if (!shift || shift.node_type !== "SHIFT" || shift.parent_id !== area.id) return null;

  for (const node of [client, location, area, shift, position]) {
    if (!isNodePathActive(node, byId)) return null;
  }
  return { title: position.name, department: area.name, location: location.name };
}

export function isNodePathActive(
  start: EmployeeAllocationNodeRow,
  byId: ReadonlyMap<string, EmployeeAllocationNodeRow>,
): boolean {
  let current: EmployeeAllocationNodeRow | undefined = start;
  const visited = new Set<string>();
  while (current) {
    if (!current.active || visited.has(current.id)) return false;
    visited.add(current.id);
    if (!current.parent_id) return true;
    current = byId.get(current.parent_id);
  }
  return false;
}
