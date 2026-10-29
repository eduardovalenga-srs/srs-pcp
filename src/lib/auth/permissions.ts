import type { Role } from "@/lib/constants/orders";

/** Capacidades do sistema (RBAC pragmático). */
export type Capability =
  | "production.view"
  | "production.edit"
  | "production.update_status"
  | "production.view_history"
  | "orders.view"
  | "orders.create"
  | "orders.edit"
  | "orders.delete"
  | "dashboard.view"
  | "import.access"
  | "processes.view"
  | "processes.manage"
  | "settings.manage"
  | "users.manage"
  | "romaneio.view"
  | "romaneio.edit"
  | "menu.gestao"
  | "menu.dashboard"
  | "menu.processes"
  | "menu.fabrica1"
  | "fabrica2.view"
  | "menu.fabrica2"
  | "menu.settings"
  | "menu.romaneio"
  // 043: módulo RH (sidebar agrupada).
  | "menu.rh"
  | "rh.view"
  | "rh.manage";

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  ADMIN: [
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
    // 043: RH — admin gerencia (cadastro completo).
    "menu.rh",
    "rh.view",
    "rh.manage",
  ],
  GESTOR: [
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
  ],
  // OPERADOR não vê a gestão de entregas (menu nem página): o trabalho dele
  // entra pela Fábrica 1 → link da OF → folha do processo em /pedidos/[id].
  // Romaneio: view sem menu (acesso pela URL, ex.: consulta na expedição).
  OPERADOR: [
    "production.update_status",
    "orders.view",
    // 043: Dashboard (menu + página) e RH (grupo + item) são de ADMIN e OPERADOR.
    "menu.dashboard",
    "dashboard.view",
    "menu.rh",
    "rh.view",
    "menu.fabrica1",
    "romaneio.view",
  ],
  VISUALIZADOR: [
    "production.view",
    "orders.view",
    "menu.gestao",
    "menu.fabrica1",
    "romaneio.view",
    "menu.romaneio",
  ],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: Role): readonly Capability[] {
  return CAPABILITIES[role] ?? [];
}

/**
 * Página inicial por papel (pós-login e raiz "/"): quem não tem
 * `production.view` (OPERADOR) só enxerga a Fábrica 1 — cair fora
 * disso derrubaria a renderização no guard da página de gestão.
 */
export function homePathFor(role: Role | null | undefined): string {
  if (role && !can(role, "production.view")) return "/fabrica-1";
  return "/gestao-entregas";
}
