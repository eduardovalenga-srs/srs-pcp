import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmployeesList,
  filterEmployees,
  type EmployeeListFilters,
} from "@/components/rh/EmployeesList";
import type { EmployeeRow } from "@/lib/types/database";

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const emptyFilters: EmployeeListFilters = {
  registration: "",
  name: "",
  company: "",
  status: "ALL",
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

function employee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: "employee-1",
    company_code: "752",
    company_name: "SRS DESENVOLVIMENTO LTDA",
    registration: "2",
    name: "ADRIANO CARDOSO DE OLIVEIRA",
    admission_date: "2023-04-13",
    dismissal_date: null,
    location: "GERAL/BRAFER",
    status: "ATIVO",
    shift: "1º TURNO",
    area: "ESTRUTURAS",
    client: "CLIENTE A",
    responsible_1: "JOÃO LÍDER",
    responsible_2: "MARIA ENCARREGADA",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    updated_by: null,
    allocation_position_id: null,
    ...overrides,
  };
}

const second = employee({
  id: "employee-2",
  company_code: "750",
  company_name: "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
  registration: "7",
  name: "JOAREZ DE OLIVEIRA",
  admission_date: "2024-01-10",
  dismissal_date: "2024-06-01",
  location: "GERAL/FABRICA SRS",
  status: "INATIVO",
  shift: "2º TURNO",
  area: "CALDEIRARIA",
  client: "CLIENTE B",
  responsible_1: "CARLOS LÍDER",
  responsible_2: "ANA ENCARREGADA",
});

const employees = [employee(), second];

describe("filterEmployees", () => {
  it("filtra por matrícula e nome sem diferenciar maiúsculas ou acentos", () => {
    expect(filterEmployees(employees, { ...emptyFilters, registration: "7" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, name: "joarez" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, name: "ADRIANO" })).toEqual([employees[0]]);
    expect(filterEmployees(employees, { ...emptyFilters, responsible1: "joao" })).toEqual([employees[0]]);
  });

  it("filtra empresa e status", () => {
    expect(filterEmployees(employees, { ...emptyFilters, company: "750" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, status: "ATIVO" })).toEqual([employees[0]]);
    expect(filterEmployees(employees, { ...emptyFilters, status: "INATIVO" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, status: "ALL" })).toHaveLength(2);
  });

  it("filtra local, turno, área, cliente, líder e encarregado por conteúdo", () => {
    expect(filterEmployees(employees, { ...emptyFilters, location: "brafer" })).toEqual([employees[0]]);
    expect(filterEmployees(employees, { ...emptyFilters, shift: "2º" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, area: "caldeiraria" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, client: "cliente b" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, responsible1: "carlos" })).toEqual([second]);
    expect(filterEmployees(employees, { ...emptyFilters, responsible2: "maria" })).toEqual([employees[0]]);
  });

  it("filtra admissão e demissão por período inclusivo", () => {
    expect(
      filterEmployees(employees, { ...emptyFilters, admissionFrom: "2024-01-10" }),
    ).toEqual([second]);
    expect(
      filterEmployees(employees, { ...emptyFilters, admissionTo: "2023-12-31" }),
    ).toEqual([employees[0]]);
    expect(
      filterEmployees(employees, {
        ...emptyFilters,
        admissionFrom: "2023-04-13",
        admissionTo: "2024-01-10",
      }),
    ).toHaveLength(2);
    expect(
      filterEmployees(employees, { ...emptyFilters, dismissalFrom: "2024-06-01" }),
    ).toEqual([second]);
    expect(
      filterEmployees(employees, { ...emptyFilters, dismissalTo: "2024-06-01" }),
    ).toEqual([second]);
  });
});

describe("EmployeesList", () => {
  it("mostra filtros nas colunas e apenas o total respeitando os filtros", () => {
    const markup = html(createElement(EmployeesList, { employees, canManage: false }));

    expect(markup).toContain("Lid.");
    expect(markup).toContain("Enc.");
    expect(markup).toContain("Líder");
    expect(markup).toContain("Encarregado");
    expect(markup).toContain("2 funcionário(s)");
    expect(markup).not.toContain("de 2 funcionário(s)");
  });
});
