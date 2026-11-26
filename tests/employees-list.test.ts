import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  EmployeesList,
  filterEmployees,
  type EmployeeListFilters,
} from "@/components/rh/EmployeesList";
import { employeesSheet } from "@/lib/export/columns";
import {
  DEFAULT_EMPLOYEE_FILTERS,
  parseEmployeeListFilters,
  sortEmployees,
} from "@/lib/utils/employee-list";
import type { EmployeeRow } from "@/lib/types/database";

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const emptyFilters: EmployeeListFilters = {
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

function employee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: "employee-1",
    company_code: "752",
    company_name: "SRS DESENVOLVIMENTO LTDA",
    registration: "2",
    name: "ADRIANO CARDOSO DE OLIVEIRA",
    billing_model: "HORA",
    admission_date: "2023-04-13",
    dismissal_date: null,
    registered_client: "GERAL/BRAFER",
    location: "UNIDADE A",
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
    last_allocation_position_id: null,
    ...overrides,
  };
}

const second = employee({
  id: "employee-2",
  company_code: "750",
  company_name: "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
  registration: "7",
  name: "JOAREZ DE OLIVEIRA",
  billing_model: "KG",
  admission_date: "2024-01-10",
  dismissal_date: "2024-06-01",
  registered_client: "GERAL/FABRICA SRS",
  location: "FÁBRICA SRS",
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

  it("filtra cliente cadastrado, local, turno, área, cliente, líder e encarregado", () => {
    expect(filterEmployees(employees, { ...emptyFilters, registeredClient: "brafer" })).toEqual([employees[0]]);
    expect(filterEmployees(employees, { ...emptyFilters, location: "unidade" })).toEqual([employees[0]]);
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

describe("sortEmployees", () => {
  it("ordena colunas nos dois sentidos e mantém valores vazios no fim", () => {
    expect(
      sortEmployees(employees, { key: "registration", direction: "asc" }),
    ).toEqual([employees[0], second]);
    expect(
      sortEmployees(employees, { key: "registration", direction: "desc" }),
    ).toEqual([second, employees[0]]);
    expect(
      sortEmployees(employees, { key: "dismissal_date", direction: "desc" }),
    ).toEqual([second, employees[0]]);
  });
});

describe("parseEmployeeListFilters", () => {
  it("usa somente ativos como status padrão e aceita o recorte de todos", () => {
    expect(parseEmployeeListFilters({})).toEqual(DEFAULT_EMPLOYEE_FILTERS);
    expect(parseEmployeeListFilters({ status: "ALL" }).status).toBe("ALL");
    expect(parseEmployeeListFilters({ status: "invalid" }).status).toBe("ATIVO");
  });
});

describe("employeesSheet", () => {
  it("monta a planilha com todas as colunas de dados e datas tipadas", () => {
    const sheet = employeesSheet(employees);

    expect(sheet.headers).toEqual([
      "Matrícula",
      "Nome",
      "Empresa",
      "Modelo de cobrança",
      "Admissão",
      "Demissão",
      "Status",
      "Cliente Cadastrado",
      "Cliente",
      "Local",
      "Turno",
      "Área",
      "Líder",
      "Encarregado",
    ]);
    expect(sheet.rows[0]?.[3]).toBe("Hora");
    expect(sheet.rows[1]?.[3]).toBe("KG");
    expect(sheet.rows[0]?.[6]).toBe("Ativo");
    expect(sheet.rows[0]?.[7]).toBe("GERAL/BRAFER");
    expect(sheet.rows[0]?.[8]).toBe("CLIENTE A");
    expect(sheet.rows[0]?.[9]).toBe("UNIDADE A");
    expect(sheet.rows[0]?.[4]).toBeInstanceOf(Date);
    expect(sheet.rows[0]?.[5]).toBe("—");
    expect(sheet.dateColumns).toEqual([4, 5]);
  });
});

describe("EmployeesList", () => {
  it("inicia mostrando ativos, disponibiliza ordenação e exporta para Excel", () => {
    const markup = html(createElement(EmployeesList, { employees, canManage: false }));

    expect(markup).toContain("Lid.");
    expect(markup).toContain("Enc.");
    expect(markup).toContain("Líder");
    expect(markup).toContain("Encarregado");
    expect(markup).toContain("1 funcionário(s)");
    expect(markup).not.toContain("JOAREZ DE OLIVEIRA");
    expect(markup).toContain("Exportar Excel");
    expect(markup).toContain("Modelo de cobrança");
    expect(markup).toContain("Hora");
    expect(markup).toContain("Ordenar por Matrícula");
    expect(markup).toContain('aria-sort="ascending"');
  });

  it("não envia o modelo de cobrança na visão externa restrita", () => {
    const markup = html(
      createElement(EmployeesList, { employees, canManage: false, restricted: true }),
    );

    expect(markup).not.toContain("Modelo de cobrança");
    expect(markup).not.toContain(">Hora<");
    expect(markup).not.toContain(">KG<");
  });
});
