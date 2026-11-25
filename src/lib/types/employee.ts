import type { EmployeeBillingModelValue, EmployeeRow } from "@/lib/types/database";

export const EMPLOYEE_BILLING_MODELS = ["HORA", "KG"] as const satisfies readonly EmployeeBillingModelValue[];

export const EMPLOYEE_BILLING_MODEL_LABELS: Record<EmployeeBillingModelValue, string> = {
  HORA: "Hora",
  KG: "KG",
};

export type EmployeeCompany = {
  code: string;
  name: string;
};

export const EMPLOYEE_COMPANIES: EmployeeCompany[] = [
  { code: "752", name: "SRS DESENVOLVIMENTO LTDA" },
  { code: "750", name: "SRS PROJETOS E DESENVOLVIMENTOS LTDA" },
];

export type EmployeeImportRow = Pick<
  EmployeeRow,
  | "company_code"
  | "company_name"
  | "registration"
  | "name"
  | "admission_date"
  | "dismissal_date"
  | "registered_client"
> & {
  source: "PLANILHA" | "PDF";
  warning?: string;
};

export type EmployeeFilters = {
  search: string;
  company: string;
  status: string;
  registeredClient: string;
  location: string;
  shift: string;
  area: string;
  client: string;
  responsible1: string;
  responsible2: string;
  admissionFrom: string;
  admissionTo: string;
  dismissalFrom: string;
  dismissalTo: string;
};

export type Employee = EmployeeRow;
