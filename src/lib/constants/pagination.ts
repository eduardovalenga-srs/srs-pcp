/** Configurações centrais de paginação e limites da aplicação.
 *
 * Todas as listas usam o MESMO padrão (200) e as mesmas opções
 * (200/500/1000), lidas da URL (`?pagina`/`?porpagina`). O teto de 1000
 * vale para qualquer valor vindo da URL (clamp em filters.ts); as RPCs
 * recebem p_limit explícito e o banco não impõe teto (só piso).
 */

export const PRODUCTION_PAGE_SIZE = 200;
export const PRODUCTION_PAGE_SIZE_OPTIONS = [200, 500, 1000] as const;

export const ORDERS_PAGE_SIZE = 200;
/** Opções do seletor "Por página" da listagem de pedidos. */
export const ORDERS_PAGE_SIZE_OPTIONS = [200, 500, 1000] as const;

export const IMPORT_HISTORY_PAGE_SIZE = 20;
/** Tela Fábrica 1 (itens filhos + materiais). */
export const CHILD_ITEMS_PAGE_SIZE = 200;
/** Opções do seletor "Por página" da Fábrica 1 (mesmas das demais listas). */
export const CHILD_ITEMS_PAGE_SIZE_OPTIONS = [200, 500, 1000] as const;

export const MAX_PAGE_SIZE = 1000;

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
