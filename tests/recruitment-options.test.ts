import { describe, expect, it } from "vitest";

import type { EmployeeAllocationNodeRow, EmployeeAllocationNodeType } from "@/lib/types/database";
import {
  buildRecruitmentFormOptions,
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
  node("area", "AREA", "location", "Solda"),
  node("shift", "SHIFT", "area", "1º turno"),
  node("position", "POSITION", "shift", "Soldador"),
  node("inactive-location", "LOCATION", "client", "Unidade Sul", false),
  node("inactive-area", "AREA", "inactive-location", "Corte"),
  node("inactive-shift", "SHIFT", "inactive-area", "2º turno"),
  node("inactive-position", "POSITION", "inactive-shift", "Operador de corte"),
  node("other-company", "COMPANY", null, "Outra empresa"),
  node("other-client", "CLIENT", "other-company", "Outro Cliente"),
  node("other-location", "LOCATION", "other-client", "Unidade Leste"),
  node("other-area", "AREA", "other-location", "Pintura"),
  node("other-shift", "SHIFT", "other-area", "1º turno"),
  node("other-position", "POSITION", "other-shift", "Pintor"),
];

describe("opções de alocação para vagas", () => {
  it("relaciona clientes das OFs com nomes normalizados e filtra a árvore ativa", () => {
    const options = buildRecruitmentFormOptions(
      ["Cafe Central", "Cliente sem alocação"],
      allocationNodes,
      [
        { id: "employee-active", name: "Ana Funcionária", allocation_position_id: "position" },
        { id: "employee-inactive-path", name: "Bruno Funcionário", allocation_position_id: "inactive-position" },
        { id: "employee-other-client", name: "Carla Funcionária", allocation_position_id: "other-position" },
      ],
    );

    expect(options.customers.map((customer) => customer.name)).toEqual(["Cafe Central", "Cliente sem alocação"]);
    expect(options.customers[0]?.locations.map((location) => location.name)).toEqual(["Unidade Norte"]);
    expect(options.customers[0]?.locations[0]?.areas.map((area) => area.name)).toEqual(["Solda"]);
    expect(options.customers[0]?.locations[0]?.areas[0]?.positions).toEqual([
      { id: "position", name: "Soldador", shiftName: "1º turno" },
    ]);
    expect(options.customers[0]?.employees.map((employee) => employee.name)).toEqual(["Ana Funcionária"]);
    expect(options.customers[1]?.allocationClientIds).toEqual([]);
  });

  it("só resolve cargo, área e local pertencentes ao cliente selecionado", () => {
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
