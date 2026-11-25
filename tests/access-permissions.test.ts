import { describe, expect, it } from "vitest";

import {
  ACCESS_SCREENS,
  applyScreenSelection,
  defaultAccessConfig,
  normalizeAccessConfig,
  roleDefaultPermissions,
  screenSelection,
} from "@/lib/auth/access";

describe("per-screen access", () => {
  it("keeps legacy roles as templates and expands RH operations", () => {
    const gestor = roleDefaultPermissions("GESTOR");
    expect(gestor).toContain("rh.allocations.view");
    expect(gestor).toContain("rh.allocations.create_position");
    expect(gestor).not.toContain("rh.employees.view");
    expect(defaultAccessConfig("OPERADOR_F2").permissions).toContain("fabrica2.view");
  });

  it("supports no access, view-only, and edit per screen", () => {
    const employees = ACCESS_SCREENS.find((screen) => screen.id === "employees");
    expect(employees).toBeDefined();
    if (!employees) return;

    const viewOnly = applyScreenSelection(
      [],
      employees,
      { view: true, operations: [] },
      "INTERNAL",
    );
    expect(screenSelection(employees, viewOnly)).toEqual({ view: true, operations: [] });
    expect(viewOnly).toContain("rh.employees.view");

    const editable = applyScreenSelection(
      viewOnly,
      employees,
      { view: true, operations: ["rh.employees.create", "rh.employees.edit"] },
      "INTERNAL",
    );
    expect(screenSelection(employees, editable)).toEqual({
      view: true,
      operations: ["rh.employees.create", "rh.employees.edit"],
    });

    const denied = applyScreenSelection(
      editable,
      employees,
      { view: false, operations: [] },
      "INTERNAL",
    );
    expect(screenSelection(employees, denied)).toEqual({ view: false, operations: [] });
  });

  it("limits external users to approved employee, allocation and vacancy reads", () => {
    const normalized = normalizeAccessConfig({
      accountType: "EXTERNAL",
      permissions: [
        "rh.employees.view",
        "rh.allocations.view",
        "rh.allocations.create_location",
        "rh.recruitment.view",
      ],
      clientIds: ["a1b2c3d4-e5f6-4789-8123-123456789abc"],
      companyCodes: [],
    });
    expect(normalized.ok).toBe(true);

    expect(
      normalizeAccessConfig({
        accountType: "EXTERNAL",
        permissions: ["rh.employees.edit"],
        clientIds: ["a1b2c3d4-e5f6-4789-8123-123456789abc"],
      }),
    ).toMatchObject({ ok: false });
    expect(
      normalizeAccessConfig({
        accountType: "EXTERNAL",
        permissions: ["rh.recruitment.manage"],
        clientIds: ["a1b2c3d4-e5f6-4789-8123-123456789abc"],
      }),
    ).toMatchObject({ ok: false });
    expect(
      normalizeAccessConfig({
        accountType: "EXTERNAL",
        permissions: ["rh.employees.view"],
        clientIds: [],
      }),
    ).toMatchObject({ ok: false });
  });
});
