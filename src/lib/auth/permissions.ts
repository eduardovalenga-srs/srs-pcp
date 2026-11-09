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
  // OPERADOR_F1 (era OPERADOR): não vê a gestão de entregas (menu nem
  // página) — o trabalho dele entra pela Fábrica 1 → link da OF → folha do
  // processo em /pedidos/[id]. Romaneio: view sem menu (acesso pela URL,
  // ex.: consulta na expedição).
  OPERADOR_F1: [
    "production.update_status",
    "orders.view",
    // 043: Dashboard (menu + página) e RH (grupo + item) são de ADMIN e
    // OPERADOR_F1.
    "menu.dashboard",
    "dashboard.view",
    "menu.rh",
    "rh.view",
    "menu.fabrica1",
    "romaneio.view",
  ],
  // 055: OPERADOR_F2 — acesso restrito à Fábrica 2 (menu + página +
  // atualização de status na própria tela). Sem dashboard, RH, romaneio,
  // gestão de OF ou Fábrica 1.
  OPERADOR_F2: [
    "menu.fabrica2",
    "fabrica2.view",
    "production.update_status",
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
 * Página inicial por papel (pós-login e raiz "/"):
 * - ADMIN/GESTOR (com `production.view`) caem na Gestão de Entregas;
 * - OPERADOR_F2 cai na Fábrica 2 (não tem `production.view`, senão o
 *   guard de /fabrica-1 derrubaria a renderização);
 * - OPERADOR_F1/VISUALIZADOR (sem `production.view`) caem na Fábrica 1.
 */
export function homePathFor(role: Role | null | undefined): string {
  if (role && can(role, "fabrica2.view") && !can(role, "production.view")) return "/fabrica-2";
  if (role && !can(role, "production.view")) return "/fabrica-1";
  return "/gestao-entregas";
}
