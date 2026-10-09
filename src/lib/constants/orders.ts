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

/** Roles do sistema (tabela profiles.role). */
export const ROLES = ["ADMIN", "GESTOR", "OPERADOR", "VISUALIZADOR"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  OPERADOR: "Operador",
  VISUALIZADOR: "Visualizador",
};
