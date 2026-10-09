/** Configurações centrais de paginação e limites da aplicação. */

export const PRODUCTION_PAGE_SIZE = 50;
export const PRODUCTION_PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export const ORDERS_PAGE_SIZE = 20;
export const IMPORT_HISTORY_PAGE_SIZE = 20;
/** Tela Fábrica 1 (itens filhos + materiais): menos linhas, célula de materiais é alta. */
export const CHILD_ITEMS_PAGE_SIZE = 25;

export const MAX_PAGE_SIZE = 200;

/** Debounce (ms) da busca de texto na tela de gestão de entregas. */
export const SEARCH_DEBOUNCE_MS = 350;

/** Janelas de entrega usadas nos filtros. */
export const DELIVERY_FILTERS = ["ALL", "OVERDUE", "TODAY", "NEXT_7_DAYS", "NEXT_30_DAYS"] as const;
export type DeliveryFilter = (typeof DELIVERY_FILTERS)[number];

/** Rótulos em pt-BR de cada janela de entrega. */
export const DELIVERY_LABELS: Record<DeliveryFilter, string> = {
  ALL: "Todas as entregas",
  OVERDUE: "Atrasados",
  TODAY: "Entrega hoje",
  NEXT_7_DAYS: "Próximos 7 dias",
  NEXT_30_DAYS: "Próximos 30 dias",
};
