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
  "romaneio.view",
  "romaneio.edit",
  "menu.gestao",
  "menu.dashboard",
  "menu.processes",
  "menu.fabrica1",
  "fabrica2.view",
  "menu.fabrica2",
  "menu.settings",
  "menu.romaneio",
  // 043: módulo RH (sidebar agrupada).
  "menu.rh",
  "rh.view",
  "rh.manage",
];

describe("página inicial por papel (homePathFor)", () => {
  it("ADMIN, GESTOR e VISUALIZADOR entram pela gestão de entregas", () => {
    expect(homePathFor("ADMIN")).toBe("/gestao-entregas");
    expect(homePathFor("GESTOR")).toBe("/gestao-entregas");
    expect(homePathFor("VISUALIZADOR")).toBe("/gestao-entregas");
  });

  it("OPERADOR_F1 (sem production.view) entra pela Fábrica 1", () => {
    expect(homePathFor("OPERADOR_F1")).toBe("/fabrica-1");
  });

  it("OPERADOR_F2 (sem production.view) entra pela Fábrica 2", () => {
    expect(homePathFor("OPERADOR_F2")).toBe("/fabrica-2");
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
      "import.access",
      "processes.view",
      "menu.gestao",
      "menu.processes",
      "menu.fabrica1",
      "fabrica2.view",
      "menu.fabrica2",
      "romaneio.view",
      "romaneio.edit",
      "menu.romaneio",
    ];
    const denied: Capability[] = [
      "processes.manage",
      "users.manage",
      "settings.manage",
      "menu.settings",
      "rh.manage",
    ];

    for (const capability of allowed) expect(can("GESTOR", capability), capability).toBe(true);
    for (const capability of denied) expect(can("GESTOR", capability), capability).toBe(false);
  });

  it("OPERADOR_F1 atualiza status pela Fábrica 1, sem gestão de entregas nem edições", () => {
    const allowed: Capability[] = [
      "production.update_status",
      "orders.view",
      // 043: Dashboard (menu + página) e RH (grupo + item) são de ADMIN e operadores.
      "menu.dashboard",
      "dashboard.view",
      "menu.rh",
      "rh.view",
      "menu.fabrica1",
      // Romaneio: consulta pela URL (sem menu) — a criação é de ADMIN/GESTOR.
      "romaneio.view",
    ];
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
      "processes.view",
      "menu.gestao",
      "fabrica2.view",
      "menu.fabrica2",
      "romaneio.edit",
      "menu.romaneio",
      // 043: RH agora é de ADMIN e operadores (grupo + item).
      "rh.manage",
    ];

    for (const capability of allowed) expect(can("OPERADOR_F1", capability), capability).toBe(true);
    for (const capability of denied) expect(can("OPERADOR_F1", capability), capability).toBe(false);
  });

  it("OPERADOR_F2 (055) é restrito à Fábrica 2: menu, página e status", () => {
    const allowed: Capability[] = ["menu.fabrica2", "fabrica2.view", "production.update_status"];
    const denied: Capability[] = [
      "production.view",
      "production.edit",
      "production.view_history",
      "orders.view",
      "orders.create",
      "orders.edit",
      "orders.delete",
      "dashboard.view",
      "menu.dashboard",
      "import.access",
      "processes.view",
      "processes.manage",
      "settings.manage",
      "users.manage",
      "romaneio.view",
      "romaneio.edit",
      "menu.gestao",
      "menu.fabrica1",
      "menu.romaneio",
      "menu.processes",
      "menu.rh",
      "rh.view",
      "rh.manage",
    ];

    for (const capability of allowed) expect(can("OPERADOR_F2", capability), capability).toBe(true);
    for (const capability of denied) expect(can("OPERADOR_F2", capability), capability).toBe(false);
  });

  it("VISUALIZADOR é somente leitura", () => {
    const allowed: Capability[] = [
      "production.view",
      "orders.view",
      "menu.gestao",
      "menu.fabrica1",
      "romaneio.view",
      "menu.romaneio",
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
      "romaneio.edit",
      // 043: RH é de ADMIN/GESTOR — o visualizador não vê o grupo.
      "menu.rh",
      "rh.view",
      "rh.manage",
    ];

    for (const capability of allowed) expect(can("VISUALIZADOR", capability), capability).toBe(true);
    for (const capability of denied) expect(can("VISUALIZADOR", capability), capability).toBe(false);
  });

  it("menus por perfil: OPERADOR_F1 vê Fábrica 1, Dashboard e RH; OPERADOR_F2 só a Fábrica 2", () => {
    // Gestão de Entregas: ADMIN, GESTOR e VISUALIZADOR — nenhum operador.
    expect(can("ADMIN", "menu.gestao")).toBe(true);
    expect(can("GESTOR", "menu.gestao")).toBe(true);
    expect(can("VISUALIZADOR", "menu.gestao")).toBe(true);
    expect(can("OPERADOR_F1", "menu.gestao")).toBe(false);
    expect(can("OPERADOR_F2", "menu.gestao")).toBe(false);

    // Configurações é exclusivo do ADMIN (nem GESTOR tem o botão).
    expect(can("ADMIN", "menu.settings")).toBe(true);
    expect(can("GESTOR", "menu.settings")).toBe(false);
    expect(can("OPERADOR_F1", "menu.settings")).toBe(false);
    expect(can("OPERADOR_F2", "menu.settings")).toBe(false);
    expect(can("VISUALIZADOR", "menu.settings")).toBe(false);

    // Dashboard: ADMIN e OPERADOR_F1 — fora do menu de Gestão de OF; menu e
    // página (dashboard.view) são exclusivos deles (OPERADOR_F2 não tem).
    expect(can("ADMIN", "menu.dashboard")).toBe(true);
    expect(can("OPERADOR_F1", "menu.dashboard")).toBe(true);
    expect(can("OPERADOR_F2", "menu.dashboard")).toBe(false);
    expect(can("GESTOR", "menu.dashboard")).toBe(false);
    expect(can("VISUALIZADOR", "menu.dashboard")).toBe(false);
    expect(can("ADMIN", "dashboard.view")).toBe(true);
    expect(can("OPERADOR_F1", "dashboard.view")).toBe(true);
    expect(can("OPERADOR_F2", "dashboard.view")).toBe(false);
    expect(can("GESTOR", "dashboard.view")).toBe(false);

    // Processos: ADMIN e GESTOR apenas.
    for (const capability of ["menu.processes"] as const) {
      expect(can("GESTOR", capability), capability).toBe(true);
      expect(can("OPERADOR_F1", capability), capability).toBe(false);
      expect(can("OPERADOR_F2", capability), capability).toBe(false);
      expect(can("VISUALIZADOR", capability), capability).toBe(false);
    }

    // Fábrica 1 (lista de itens filhos/materiais) é leitura — todos os
    // perfis menos o OPERADOR_F2 (055).
    expect(can("GESTOR", "menu.fabrica1")).toBe(true);
    expect(can("OPERADOR_F1", "menu.fabrica1")).toBe(true);
    expect(can("OPERADOR_F2", "menu.fabrica1")).toBe(false);
    expect(can("VISUALIZADOR", "menu.fabrica1")).toBe(true);

    // Fábrica 2 (réplica da gestão): ADMIN, GESTOR e OPERADOR_F2 (055) —
    // menu e página; OPERADOR_F1/VISUALIZADOR ficam de fora.
    expect(can("ADMIN", "menu.fabrica2")).toBe(true);
    expect(can("GESTOR", "menu.fabrica2")).toBe(true);
    expect(can("OPERADOR_F2", "menu.fabrica2")).toBe(true);
    expect(can("OPERADOR_F1", "menu.fabrica2")).toBe(false);
    expect(can("VISUALIZADOR", "menu.fabrica2")).toBe(false);
    expect(can("ADMIN", "fabrica2.view")).toBe(true);
    expect(can("GESTOR", "fabrica2.view")).toBe(true);
    expect(can("OPERADOR_F2", "fabrica2.view")).toBe(true);
    expect(can("OPERADOR_F1", "fabrica2.view")).toBe(false);
    expect(can("VISUALIZADOR", "fabrica2.view")).toBe(false);

    // Romaneio (expedição): ADMIN/GESTOR criam e confirmam; VISUALIZADOR
    // consulta pelo menu; OPERADOR_F1 só pela URL (view sem menu);
    // OPERADOR_F2 não acessa.
    expect(can("ADMIN", "menu.romaneio")).toBe(true);
    expect(can("GESTOR", "menu.romaneio")).toBe(true);
    expect(can("VISUALIZADOR", "menu.romaneio")).toBe(true);
    expect(can("OPERADOR_F1", "menu.romaneio")).toBe(false);
    expect(can("OPERADOR_F2", "menu.romaneio")).toBe(false);
    expect(can("ADMIN", "romaneio.edit")).toBe(true);
    expect(can("GESTOR", "romaneio.edit")).toBe(true);
    expect(can("VISUALIZADOR", "romaneio.edit")).toBe(false);
    expect(can("OPERADOR_F1", "romaneio.edit")).toBe(false);
    expect(can("OPERADOR_F2", "romaneio.edit")).toBe(false);
    expect(can("OPERADOR_F1", "romaneio.view")).toBe(true);
    expect(can("OPERADOR_F2", "romaneio.view")).toBe(false);

    // 043: RH (grupo + item) é de ADMIN e OPERADOR_F1; o cadastro é do ADMIN.
    expect(can("ADMIN", "menu.rh")).toBe(true);
    expect(can("OPERADOR_F1", "menu.rh")).toBe(true);
    expect(can("OPERADOR_F2", "menu.rh")).toBe(false);
    expect(can("GESTOR", "menu.rh")).toBe(false);
    expect(can("VISUALIZADOR", "menu.rh")).toBe(false);
    expect(can("ADMIN", "rh.view")).toBe(true);
    expect(can("OPERADOR_F1", "rh.view")).toBe(true);
    expect(can("OPERADOR_F2", "rh.view")).toBe(false);
    expect(can("GESTOR", "rh.view")).toBe(false);
    expect(can("VISUALIZADOR", "rh.view")).toBe(false);
    expect(can("ADMIN", "rh.manage")).toBe(true);
    expect(can("GESTOR", "rh.manage")).toBe(false);
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
