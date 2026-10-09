import { describe, expect, it } from "vitest";

import { can, capabilitiesFor, type Capability } from "@/lib/auth/permissions";
import { ROLES, type Role } from "@/lib/constants/orders";

const ALL_CAPABILITIES: Capability[] = [
  "production.view",
  "production.edit",
  "production.update_status",
  "production.view_history",
  "orders.view",
  "orders.create",
  "orders.edit",
  "orders.delete",
  "dashboard.view",
  "import.access",
  "processes.view",
  "processes.manage",
  "settings.manage",
  "users.manage",
  "menu.gestao",
  "menu.dashboard",
  "menu.import",
  "menu.processes",
  "menu.fabrica1",
  "menu.settings",
];

describe("matriz de permissões (item 40)", () => {
  it("ADMIN tem todas as capacidades", () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(can("ADMIN", capability), capability).toBe(true);
    }
  });

  it("GESTOR edita produção e pedidos, mas não gerencia usuários/configurações", () => {
    const allowed: Capability[] = [
      "production.view",
      "production.edit",
      "production.update_status",
      "production.view_history",
      "orders.view",
      "orders.create",
      "orders.edit",
      "orders.delete",
      "dashboard.view",
      "import.access",
      "processes.view",
      "menu.gestao",
      "menu.dashboard",
      "menu.import",
      "menu.processes",
      "menu.fabrica1",
    ];
    const denied: Capability[] = [
      "processes.manage",
      "users.manage",
      "settings.manage",
      "menu.settings",
    ];

    for (const capability of allowed) expect(can("GESTOR", capability), capability).toBe(true);
    for (const capability of denied) expect(can("GESTOR", capability), capability).toBe(false);
  });

  it("OPERADOR atualiza status pela Fábrica 1, sem gestão de entregas nem edições", () => {
    const allowed: Capability[] = ["production.update_status", "orders.view", "menu.fabrica1"];
    const denied: Capability[] = [
      "production.view",
      "production.edit",
      "production.view_history",
      "orders.create",
      "orders.edit",
      "orders.delete",
      "import.access",
      "settings.manage",
      "users.manage",
      "processes.manage",
      "dashboard.view",
      "processes.view",
      "menu.gestao",
    ];

    for (const capability of allowed) expect(can("OPERADOR", capability), capability).toBe(true);
    for (const capability of denied) expect(can("OPERADOR", capability), capability).toBe(false);
  });

  it("VISUALIZADOR é somente leitura", () => {
    const allowed: Capability[] = [
      "production.view",
      "orders.view",
      "menu.gestao",
      "menu.fabrica1",
    ];
    const denied: Capability[] = [
      "production.edit",
      "production.update_status",
      "production.view_history",
      "orders.create",
      "orders.edit",
      "orders.delete",
      "import.access",
      "settings.manage",
      "users.manage",
      "processes.manage",
      "dashboard.view",
      "processes.view",
    ];

    for (const capability of allowed) expect(can("VISUALIZADOR", capability), capability).toBe(true);
    for (const capability of denied) expect(can("VISUALIZADOR", capability), capability).toBe(false);
  });

  it("menus por perfil: OPERADOR vê só a Fábrica 1", () => {
    // Gestão de Entregas: ADMIN, GESTOR e VISUALIZADOR — o OPERADOR não.
    expect(can("ADMIN", "menu.gestao")).toBe(true);
    expect(can("GESTOR", "menu.gestao")).toBe(true);
    expect(can("VISUALIZADOR", "menu.gestao")).toBe(true);
    expect(can("OPERADOR", "menu.gestao")).toBe(false);

    // Configurações é exclusivo do ADMIN (nem GESTOR tem o botão).
    expect(can("ADMIN", "menu.settings")).toBe(true);
    expect(can("GESTOR", "menu.settings")).toBe(false);
    expect(can("OPERADOR", "menu.settings")).toBe(false);
    expect(can("VISUALIZADOR", "menu.settings")).toBe(false);

    // Dashboard/Importação/Processos: ADMIN e GESTOR apenas.
    for (const capability of ["menu.dashboard", "menu.import", "menu.processes"] as const) {
      expect(can("GESTOR", capability), capability).toBe(true);
      expect(can("OPERADOR", capability), capability).toBe(false);
      expect(can("VISUALIZADOR", capability), capability).toBe(false);
    }

    // Fábrica 1 (lista de itens filhos/materiais) é leitura — todos os perfis.
    expect(can("GESTOR", "menu.fabrica1")).toBe(true);
    expect(can("OPERADOR", "menu.fabrica1")).toBe(true);
    expect(can("VISUALIZADOR", "menu.fabrica1")).toBe(true);
  });

  it("perfil desconhecido/nulo não tem acesso a nada", () => {
    expect(can(null, "production.view")).toBe(false);
    expect(can(undefined, "orders.view")).toBe(false);
  });

  it("toda role da lista tem capacidades declaradas", () => {
    for (const role of ROLES as readonly Role[]) {
      expect(capabilitiesFor(role).length).toBeGreaterThan(0);
    }
  });
});
