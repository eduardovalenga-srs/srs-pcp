export const ORDER_TYPES = ["OF", "OS"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ["PLANEJADO", "EM_PRODUCAO", "CONCLUIDO", "CANCELADO"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PLANEJADO: "Em espera",
  EM_PRODUCAO: "Em produção",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

/**
 * Roles do sistema (tabela profiles.role).
 *
 * 055: o antigo OPERADOR virou dois papéis específicos por fábrica —
 * OPERADOR_F1 (Fábrica 1, comportamento idêntico ao antigo OPERADOR) e
 * OPERADOR_F2 (somente Fábrica 2).
 */
export const ROLES = ["ADMIN", "GESTOR", "OPERADOR_F1", "OPERADOR_F2", "VISUALIZADOR"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  OPERADOR_F1: "Operador Fábrica 1",
  OPERADOR_F2: "Operador Fábrica 2",
  VISUALIZADOR: "Visualizador",
};
