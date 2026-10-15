import { describe, expect, it } from "vitest";

import { can, capabilitiesFor, homePathFor, type Capability } from "@/lib/auth/permissions";
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
  "menu.processes",
  "menu.fabrica1",
  "fabrica2.view",
  "menu.fabrica2",
  "menu.settings",
];

describe("página inicial por papel (homePathFor)", () => {
  it("ADMIN, GESTOR e VISUALIZADOR entram pela gestão de entregas", () => {
    expect(homePathFor("ADMIN")).toBe("/gestao-entregas");
    expect(homePathFor("GESTOR")).toBe("/gestao-entregas");
    expect(homePathFor("VISUALIZADOR")).toBe("/gestao-entregas");
  });

  it("OPERADOR (sem production.view) entra pela Fábrica 1", () => {
    expect(homePathFor("OPERADOR")).toBe("/fabrica-1");
  });

  it("sem papel definido usa o destino padrão", () => {
    expect(homePathFor(null)).toBe("/gestao-entregas");
    expect(homePathFor(undefined)).toBe("/gestao-entregas");
  });
});

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
      "menu.processes",
      "menu.fabrica1",
      "fabrica2.view",
      "menu.fabrica2",
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
      "fabrica2.view",
      "menu.fabrica2",
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
      "fabrica2.view",
      "menu.fabrica2",
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

    // Dashboard/Processos: ADMIN e GESTOR apenas.
    for (const capability of ["menu.dashboard", "menu.processes"] as const) {
      expect(can("GESTOR", capability), capability).toBe(true);
      expect(can("OPERADOR", capability), capability).toBe(false);
      expect(can("VISUALIZADOR", capability), capability).toBe(false);
    }

    // Fábrica 1 (lista de itens filhos/materiais) é leitura — todos os perfis.
    expect(can("GESTOR", "menu.fabrica1")).toBe(true);
    expect(can("OPERADOR", "menu.fabrica1")).toBe(true);
    expect(can("VISUALIZADOR", "menu.fabrica1")).toBe(true);

    // Fábrica 2 (réplica da gestão) é exclusiva de ADMIN/GESTOR — menu e página.
    expect(can("ADMIN", "menu.fabrica2")).toBe(true);
    expect(can("GESTOR", "menu.fabrica2")).toBe(true);
    expect(can("OPERADOR", "menu.fabrica2")).toBe(false);
    expect(can("VISUALIZADOR", "menu.fabrica2")).toBe(false);
    expect(can("ADMIN", "fabrica2.view")).toBe(true);
    expect(can("GESTOR", "fabrica2.view")).toBe(true);
    expect(can("OPERADOR", "fabrica2.view")).toBe(false);
    expect(can("VISUALIZADOR", "fabrica2.view")).toBe(false);
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
