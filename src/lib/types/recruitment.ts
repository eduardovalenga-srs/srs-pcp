import type {
  EmployeeAllocationNodeRow,
  RecruitmentCandidateStageValue,
  RecruitmentApprovedRoleRow,
  RecruitmentVacancyRow,
  RecruitmentVacancyStatusValue,
} from "@/lib/types/database";

export const VACANCY_STATUSES: { value: RecruitmentVacancyStatusValue; label: string }[] = [
  { value: "VAGAS_ABERTAS", label: "Vagas Abertas" },
  { value: "TRIAGEM", label: "Triagem" },
  { value: "ENTREVISTA", label: "Entrevista" },
  { value: "AGENDAMENTO_ASO", label: "Agendamento ASO" },
  { value: "INTEGRACAO", label: "Integração" },
  { value: "CONTRATADOS", label: "Contratados" },
];

export const CANDIDATE_STAGES: { value: RecruitmentCandidateStageValue; label: string }[] = [
  { value: "TRIAGEM", label: "Triagem" },
  { value: "ENTREVISTA", label: "Entrevista" },
  { value: "AGENDAMENTO_ASO", label: "Agendamento ASO" },
  { value: "INTEGRACAO", label: "Integração" },
  { value: "CONTRATADO", label: "Contratado" },
  { value: "REPROVADO", label: "Reprovado" },
];

export const EMPLOYMENT_TYPES = ["CLT", "PJ", "Temporário", "Estágio", "Aprendiz", "Outro"] as const;
export const VACANCY_PRIORITIES = ["BAIXA", "NORMAL", "ALTA"] as const;
export const RECRUITMENT_REQUEST_REASONS = [
  { value: "NOVA_VAGA", label: "Nova Vaga" },
  { value: "SUBSTITUICAO", label: "Substituição" },
  { value: "REFORCO", label: "Reforço" },
] as const;

export type VacancyListItem = RecruitmentVacancyRow & {
  candidate_count: number;
  selected_candidate_name: string | null;
  selected_candidate_hired_at: string | null;
};
export type RecruitmentVacancyDetails = RecruitmentVacancyRow & {
  replacement_employee_name: string | null;
};

export type RecruitmentPositionOption = {
  id: string;
  name: string;
  shiftName: string;
};

export type RecruitmentApprovedRoleOption = {
  id: string;
  clientId: string;
  name: string;
  active: boolean;
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
  approvedRoles: RecruitmentApprovedRoleOption[];
};

export type RecruitmentApprovedRoleListItem = RecruitmentApprovedRoleRow & {
  client_name: string;
};

export type RecruitmentApprovedRoleManagementData = {
  clients: { id: string; name: string; active: boolean }[];
  roles: RecruitmentApprovedRoleListItem[];
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

export type RecruitmentVacancyAreaSelection = Omit<RecruitmentVacancySelection, "allocationPositionId">;

export function normalizeRecruitmentLabel(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function buildRecruitmentFormOptions(
  nodes: readonly EmployeeAllocationNodeRow[],
  employees: readonly { id: string; name: string; allocation_position_id: string | null }[],
  approvedRoleRows: readonly Pick<RecruitmentApprovedRoleRow, "id" | "client_id" | "name" | "active">[] = [],
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
    nodes
      .filter((node) => node.node_type === "CLIENT")
      .map((node) => node.name.trim())
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
          areas: activeChildren(location.id, "SHIFT").flatMap((shift) =>
            activeChildren(shift.id, "AREA").map((area) => ({
              id: area.id,
              name: area.name,
              positions: activeChildren(area.id, "POSITION").map((position) => ({
                id: position.id,
                name: position.name,
                shiftName: shift.name,
              })).sort((left, right) =>
                `${left.name} ${left.shiftName}`.localeCompare(`${right.name} ${right.shiftName}`, "pt-BR"),
              ),
            })),
          ).sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
        })),
      ).sort((left, right) =>
        `${left.name} ${left.companyName}`.localeCompare(`${right.name} ${right.companyName}`, "pt-BR"),
      );
      const clientIds = new Set(allocationClients.map((client) => client.id));
      const approvedRoles = approvedRoleRows
        .filter((role) => clientIds.has(role.client_id))
        .map((role) => ({ id: role.id, clientId: role.client_id, name: role.name, active: role.active }))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
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
        approvedRoles,
      };
    }).filter((customer) => customer.allocationClientIds.length > 0),
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
    position.node_type !== "POSITION" ||
    position.parent_id !== area.id
  ) {
    return null;
  }
  const shift = area.parent_id ? byId.get(area.parent_id) : undefined;
  if (!shift || shift.node_type !== "SHIFT" || shift.parent_id !== location.id) return null;

  for (const node of [client, location, area, shift, position]) {
    if (!isNodePathActive(node, byId)) return null;
  }
  return { title: position.name, department: area.name, location: location.name };
}

export function resolveRecruitmentVacancyArea(
  nodes: readonly EmployeeAllocationNodeRow[],
  selection: RecruitmentVacancyAreaSelection,
): { department: string; location: string } | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const client = byId.get(selection.allocationClientId);
  const location = byId.get(selection.allocationLocationId);
  const area = byId.get(selection.allocationAreaId);
  const shift = area?.parent_id ? byId.get(area.parent_id) : undefined;
  if (
    !client ||
    !location ||
    !area ||
    !shift ||
    client.node_type !== "CLIENT" ||
    normalizeRecruitmentLabel(client.name) !== normalizeRecruitmentLabel(selection.customer) ||
    location.node_type !== "LOCATION" ||
    location.parent_id !== client.id ||
    shift.node_type !== "SHIFT" ||
    shift.parent_id !== location.id ||
    area.node_type !== "AREA"
  ) {
    return null;
  }

  for (const node of [client, location, shift, area]) {
    if (!isNodePathActive(node, byId)) return null;
  }
  return { department: area.name, location: location.name };
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
