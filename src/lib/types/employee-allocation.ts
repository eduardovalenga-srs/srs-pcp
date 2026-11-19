import type {
  EmployeeAllocationNodeRow,
  EmployeeAllocationNodeType,
} from "@/lib/types/database";

export type EmployeeAllocationNode = EmployeeAllocationNodeRow;
export type EmployeeAllocationKind = Exclude<EmployeeAllocationNodeType, "COMPANY">;

export type AllocationEmployee = {
  id: string;
  company_code: string;
  registration: string;
  name: string;
  status: "ATIVO" | "INATIVO";
  allocation_position_id: string | null;
};

export const ALLOCATION_CHILD_KIND: Record<
  EmployeeAllocationNodeType,
  EmployeeAllocationKind | null
> = {
  COMPANY: "CLIENT",
  CLIENT: "LOCATION",
  LOCATION: "SHIFT",
  SHIFT: "AREA",
  AREA: "POSITION",
  POSITION: null,
};

export const ALLOCATION_KIND_LABEL: Record<EmployeeAllocationNodeType, string> = {
  COMPANY: "Empresa empregadora",
  CLIENT: "Cliente",
  LOCATION: "Local de trabalho",
  AREA: "Área",
  SHIFT: "Turno",
  POSITION: "Posição",
};
