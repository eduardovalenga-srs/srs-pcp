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
  | "menu.gestao"
  | "menu.dashboard"
  | "menu.import"
  | "menu.processes"
  | "menu.fabrica1"
  | "menu.settings";

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
    "menu.gestao",
    "menu.dashboard",
    "menu.import",
    "menu.processes",
    "menu.fabrica1",
    "menu.settings",
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
    "dashboard.view",
    "import.access",
    "processes.view",
    "menu.gestao",
    "menu.dashboard",
    "menu.import",
    "menu.processes",
    "menu.fabrica1",
  ],
  // OPERADOR não vê a gestão de entregas (menu nem página): o trabalho dele
  // entra pela Fábrica 1 → link da OF → folha do processo em /pedidos/[id].
  OPERADOR: ["production.update_status", "orders.view", "menu.fabrica1"],
  VISUALIZADOR: ["production.view", "orders.view", "menu.gestao", "menu.fabrica1"],
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function capabilitiesFor(role: Role): readonly Capability[] {
  return CAPABILITIES[role] ?? [];
}
