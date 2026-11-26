import { describe, expect, it } from "vitest";

import type { EmployeeAllocationNodeRow, EmployeeAllocationNodeType } from "@/lib/types/database";
import {
  buildRecruitmentFormOptions,
  resolveRecruitmentVacancyArea,
  resolveRecruitmentVacancySelection,
} from "@/lib/types/recruitment";

function node(
  id: string,
  nodeType: EmployeeAllocationNodeType,
  parentId: string | null,
  name: string,
  active = true,
): EmployeeAllocationNodeRow {
  return {
    id,
    company_code: "752",
    company_name: "Empresa de teste",
    parent_id: parentId,
    node_type: nodeType,
    name,
    location_leader: null,
    location_supervisor: null,
    active,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    created_by: null,
    updated_by: null,
  };
}

const allocationNodes = [
  node("company", "COMPANY", null, "Empresa"),
  node("client", "CLIENT", "company", "Café Central"),
  node("location", "LOCATION", "client", "Unidade Norte"),
  node("shift", "SHIFT", "location", "1º turno"),
  node("area", "AREA", "shift", "Solda"),
  node("position", "POSITION", "area", "Soldador"),
  node("inactive-location", "LOCATION", "client", "Unidade Sul", false),
  node("inactive-shift", "SHIFT", "inactive-location", "2º turno"),
  node("inactive-area", "AREA", "inactive-shift", "Corte"),
  node("inactive-position", "POSITION", "inactive-area", "Operador de corte"),
  node("other-company", "COMPANY", null, "Outra empresa"),
  node("other-client", "CLIENT", "other-company", "Outro Cliente"),
  node("other-location", "LOCATION", "other-client", "Unidade Leste"),
  node("other-shift", "SHIFT", "other-location", "1º turno"),
  node("other-area", "AREA", "other-shift", "Pintura"),
  node("other-position", "POSITION", "other-area", "Pintor"),
];

describe("opções de alocação para vagas", () => {
  it("exibe somente clientes cadastrados na árvore ativa de alocações", () => {
    const options = buildRecruitmentFormOptions(
      allocationNodes,
      [
        { id: "employee-active", name: "Ana Funcionária", status: "ATIVO", allocation_position_id: "position" },
        { id: "employee-dismissed", name: "Bruno Funcionário", status: "INATIVO", allocation_position_id: "position" },
        { id: "employee-inactive-path", name: "Caio Funcionário", status: "INATIVO", allocation_position_id: "inactive-position" },
        { id: "employee-other-client", name: "Daniela Funcionária", status: "ATIVO", allocation_position_id: "other-position" },
      ],
      [
        { id: "approved-soldador", client_id: "client", name: "Soldador", active: true },
        { id: "approved-inactive", client_id: "client", name: "Torneiro", active: false },
        { id: "approved-other-client", client_id: "other-client", name: "Pintor", active: true },
      ],
    );

    expect(options.customers.map((customer) => customer.name)).toEqual(["Café Central", "Outro Cliente"]);
    expect(options.customers[0]?.locations.map((location) => location.name)).toEqual(["Unidade Norte"]);
    expect(options.customers[0]?.locations[0]?.areas.map((area) => area.name)).toEqual(["Solda"]);
    expect(options.customers[0]?.locations[0]?.areas[0]?.positions).toEqual([
      { id: "position", name: "Soldador", shiftName: "1º turno" },
    ]);
    expect(options.customers[0]?.employees).toEqual([
      { id: "employee-active", name: "Ana Funcionária", clientId: "client", status: "ATIVO" },
      { id: "employee-dismissed", name: "Bruno Funcionário", clientId: "client", status: "INATIVO" },
    ]);
    expect(options.customers[0]?.approvedRoles).toEqual([
      { id: "approved-soldador", clientId: "client", name: "Soldador", active: true },
      { id: "approved-inactive", clientId: "client", name: "Torneiro", active: false },
    ]);
    expect(options.customers[1]?.approvedRoles.map((role) => role.name)).toEqual(["Pintor"]);
  });

  it("só resolve cargo, área e local pertencentes ao cliente selecionado", () => {
    expect(resolveRecruitmentVacancyArea(allocationNodes, {
      customer: "Cafe Central",
      allocationClientId: "client",
      allocationLocationId: "location",
      allocationAreaId: "area",
    })).toEqual({
      department: "Solda",
      location: "Unidade Norte",
    });

    expect(resolveRecruitmentVacancySelection(allocationNodes, {
      customer: "Cafe Central",
      allocationClientId: "client",
      allocationLocationId: "location",
      allocationAreaId: "area",
      allocationPositionId: "position",
    })).toEqual({
      title: "Soldador",
      department: "Solda",
      location: "Unidade Norte",
    });

    expect(resolveRecruitmentVacancySelection(allocationNodes, {
      customer: "Cafe Central",
      allocationClientId: "client",
      allocationLocationId: "other-location",
      allocationAreaId: "other-area",
      allocationPositionId: "other-position",
    })).toBeNull();
  });
});
