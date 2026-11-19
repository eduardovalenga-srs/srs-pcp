import type { EmployeeRow } from "@/lib/types/database";

export interface EmployeeListFilters {
  registration: string;
  name: string;
  company: string;
  status: string;
  registeredClient: string;
  location: string;
  shift: string;
  area: string;
  client: string;
  responsible1: string;
  responsible2: string;
  admissionFrom: string | null;
  admissionTo: string | null;
  dismissalFrom: string | null;
  dismissalTo: string | null;
}

export const EMPTY_EMPLOYEE_FILTERS: EmployeeListFilters = {
  registration: "",
  name: "",
  company: "",
  status: "ALL",
  registeredClient: "",
  location: "",
  shift: "",
  area: "",
  client: "",
  responsible1: "",
  responsible2: "",
  admissionFrom: null,
  admissionTo: null,
  dismissalFrom: null,
  dismissalTo: null,
};

/** Filtro inicial da tela: mostra somente os funcionários ativos. */
export const DEFAULT_EMPLOYEE_FILTERS: EmployeeListFilters = {
  ...EMPTY_EMPLOYEE_FILTERS,
  status: "ATIVO",
};

export const EMPLOYEE_SORT_KEYS = [
  "registration",
  "name",
  "company_name",
  "admission_date",
  "dismissal_date",
  "status",
  "registered_client",
  "client",
  "location",
  "shift",
  "area",
  "responsible_1",
  "responsible_2",
] as const satisfies readonly (keyof EmployeeRow)[];

export type EmployeeSortKey = (typeof EMPLOYEE_SORT_KEYS)[number];
export type EmployeeSortDirection = "asc" | "desc";

export interface EmployeeSortState {
  key: EmployeeSortKey;
  direction: EmployeeSortDirection;
}

const searchCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function matchesText(value: string | null | undefined, query: string): boolean {
  return !query || normalizeSearch(value).includes(normalizeSearch(query));
}

/** Aplica os filtros das colunas à lista já carregada no servidor. */
export function filterEmployees(
  employees: readonly EmployeeRow[],
  filters: EmployeeListFilters,
): EmployeeRow[] {
  return employees.filter((employee) => {
    if (!matchesText(employee.registration, filters.registration)) return false;
    if (!matchesText(employee.name, filters.name)) return false;
    if (filters.company && employee.company_code !== filters.company) return false;
    if (filters.status !== "ALL" && employee.status !== filters.status) return false;
    if (!matchesText(employee.registered_client, filters.registeredClient)) return false;
    if (!matchesText(employee.location, filters.location)) return false;
    if (!matchesText(employee.shift, filters.shift)) return false;
    if (!matchesText(employee.area, filters.area)) return false;
    if (!matchesText(employee.client, filters.client)) return false;
    if (!matchesText(employee.responsible_1, filters.responsible1)) return false;
    if (!matchesText(employee.responsible_2, filters.responsible2)) return false;

    const admission = employee.admission_date ?? "";
    if (filters.admissionFrom && (!admission || admission < filters.admissionFrom)) return false;
    if (filters.admissionTo && (!admission || admission > filters.admissionTo)) return false;

    const dismissal = employee.dismissal_date ?? "";
    if (filters.dismissalFrom && (!dismissal || dismissal < filters.dismissalFrom)) return false;
    if (filters.dismissalTo && (!dismissal || dismissal > filters.dismissalTo)) return false;

    return true;
  });
}

/** Ordena a lista filtrada antes da paginação, mantendo valores vazios no fim. */
export function sortEmployees(
  employees: readonly EmployeeRow[],
  sort: EmployeeSortState,
): EmployeeRow[] {
  return [...employees].sort((left, right) => {
    const leftValue = left[sort.key];
    const rightValue = right[sort.key];
    const leftEmpty = leftValue === null || leftValue === "";
    const rightEmpty = rightValue === null || rightValue === "";

    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return 0;
      return leftEmpty ? 1 : -1;
    }

    const comparison = searchCollator.compare(String(leftValue), String(rightValue));
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function isEmployeeSortKey(value: string): value is EmployeeSortKey {
  return (EMPLOYEE_SORT_KEYS as readonly string[]).includes(value);
}

type EmployeeSearchParams = Record<string, string | string[] | undefined>;

function paramValue(params: EmployeeSearchParams, key: string): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Lê os filtros de coluna enviados pelo botão de exportação. */
export function parseEmployeeListFilters(params: EmployeeSearchParams): EmployeeListFilters {
  const status = paramValue(params, "status").toUpperCase();
  return {
    registration: paramValue(params, "registration").trim(),
    name: paramValue(params, "name").trim(),
    company: paramValue(params, "company").trim(),
    status: ["ATIVO", "INATIVO", "ALL"].includes(status) ? status : "ATIVO",
    registeredClient: paramValue(params, "registeredClient").trim(),
    location: paramValue(params, "location").trim(),
    shift: paramValue(params, "shift").trim(),
    area: paramValue(params, "area").trim(),
    client: paramValue(params, "client").trim(),
    responsible1: paramValue(params, "responsible1").trim(),
    responsible2: paramValue(params, "responsible2").trim(),
    admissionFrom: paramValue(params, "admissionFrom").trim() || null,
    admissionTo: paramValue(params, "admissionTo").trim() || null,
    dismissalFrom: paramValue(params, "dismissalFrom").trim() || null,
    dismissalTo: paramValue(params, "dismissalTo").trim() || null,
  };
}
