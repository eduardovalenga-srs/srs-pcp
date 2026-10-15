import { DELIVERY_FILTERS, DELIVERY_LABELS, PRODUCTION_PAGE_SIZE, PRODUCTION_PAGE_SIZE_OPTIONS, MAX_PAGE_SIZE, ORDERS_PAGE_SIZE, CHILD_ITEMS_PAGE_SIZE, type DeliveryFilter } from "@/lib/constants/pagination";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants/orders";
import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, type ProcessStatus } from "@/lib/constants/production";
import type { ChildItemFilters, OrderFilters } from "@/lib/types/order";
import type { ProductionFilters } from "@/lib/types/production";
import { formatDate, isValidISODate } from "@/lib/utils/dates";
import { formatQuantity, formatWeight, toNumber } from "@/lib/utils/formatting";

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Chaves de ordenação aceitas pela RPC get_production_rows (whitelist do banco). */
export const PRODUCTION_SORT_KEYS = [
  "delivery_date",
  "order_code",
  "order_type",
  "order_status",
  "family",
  "parent_item",
  "description",
  "quantity",
  "unit_weight_kg",
  "item_status",
  "op",
  "overdue",
  // 025: coluna "Peso total" da gestão de entregas consolidada por OF.
  // A Fábrica 2 não usa — a RPC dela ignora chaves fora da whitelist.
  "weight_total",
] as const;
export type ProductionSortKey = (typeof PRODUCTION_SORT_KEYS)[number];

/** Extrai o primeiro valor de um parâmetro de busca. */
export function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Limite de tamanho de um filtro de coluna (protege URLs absurdas). */
const MAX_COLUMN_FILTER_LENGTH = 80;

/** Lê um filtro de texto de coluna ("contém") da URL. */
function textParam(params: SearchParamsRecord, key: string): string {
  return firstValue(params[key]).trim().slice(0, MAX_COLUMN_FILTER_LENGTH);
}

/**
 * Lê um limite numérico de coluna da URL.
 * Aceita vírgula decimal ("12,5") e descarta negativos/não numéricos.
 */
function numberParam(params: SearchParamsRecord, key: string): number | null {
  const parsed = toNumber(firstValue(params[key]));
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/**
 * Lê uma data de período (YYYY-MM-DD) da URL.
 * Formato fora do padrão ou data impossível (ex.: 2026-02-31) é
 * descartado (null) — nunca chega inválida ao banco.
 */
function dateParam(params: SearchParamsRecord, key: string): string | null {
  const value = firstValue(params[key]).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  // Round-trip: Date.UTC normaliza datas inválidas (02/31 vira 03/03) —
  // se os componentes mudaram, a data não existe no calendário.
  const utc = new Date(Date.UTC(year, month - 1, day));
  const valid =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  return valid ? value : null;
}

function clampPageSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const rounded = Math.floor(value);
  return Math.min(Math.max(rounded, 1), MAX_PAGE_SIZE);
}

export type DeliveryPeriodError = "invalid" | "inverted" | null;

export interface DeliveryPeriod {
  /** Lado "de" pronto para a URL (vazio = aberto). */
  from: string | null;
  /** Lado "até" pronto para a URL (vazio = aberto). */
  to: string | null;
  /** Motivo pelo qual o período não pode ser aplicado, se houver. */
  error: DeliveryPeriodError;
}

/**
 * Normaliza o rascunho do período de entrega antes de ir para a URL.
 *
 * O `<input type="date">` devolve "" enquanto a data está incompleta (é o
 * valor lido no meio da digitação), então o commit só pode acontecer com
 * datas prontas: incompletas/inexistentes bloqueiam a aplicação ("invalid")
 * e "de" posterior a "até" também ("inverted" — em ISO a comparação
 * lexicográfica é cronológica). Vazio de propósito mantém o lado aberto.
 */
export function normalizeDeliveryPeriod(fromDraft: string, toDraft: string): DeliveryPeriod {
  const from = fromDraft.trim();
  const to = toDraft.trim();

  if ((from !== "" && !isValidISODate(from)) || (to !== "" && !isValidISODate(to))) {
    return { from: null, to: null, error: "invalid" };
  }

  if (from !== "" && to !== "" && from > to) {
    return { from: null, to: null, error: "inverted" };
  }

  return { from: from || null, to: to || null, error: null };
}

/**
 * Código de processo válido para ordenação (a RPC só aceita código do
 * catálogo; qualquer outro valor cai em `delivery_date`).
 */
export function isSortableColumn(value: string): value is ProductionSortKey {
  return (PRODUCTION_SORT_KEYS as readonly string[]).includes(value);
}

export function isValidProcessSort(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{1,11}$/.test(value);
}

/** Lê os filtros da tela de gestão de entregas a partir da URL. */
export function parseProductionFilters(params: SearchParamsRecord): ProductionFilters {
  const search = firstValue(params.q).trim();
  const orderStatusRaw = firstValue(params.status).toUpperCase();
  const orderStatus = (ORDER_STATUSES as readonly string[]).includes(orderStatusRaw)
    ? (orderStatusRaw as OrderStatus)
    : "ALL";

  const processCodeRaw = firstValue(params.processo).toUpperCase();
  const processCode = processCodeRaw && /^[A-Z][A-Z0-9_]{1,11}$/.test(processCodeRaw) ? processCodeRaw : "ALL";

  const processStatusRaw = firstValue(params.situacao).toUpperCase();
  const processStatus = (PROCESS_STATUSES as readonly string[]).includes(processStatusRaw)
    ? (processStatusRaw as ProcessStatus)
    : "ALL";

  const deliveryRaw = firstValue(params.entrega).toUpperCase() as DeliveryFilter;
  const delivery = (DELIVERY_FILTERS as readonly string[]).includes(deliveryRaw) ? deliveryRaw : "ALL";

  const deliveryFrom = dateParam(params, "entregade");
  const deliveryTo = dateParam(params, "entregaate");

  const sortRaw = firstValue(params.ordem).toLowerCase();
  const sort = isSortableColumn(sortRaw) || isValidProcessSort(sortRaw) ? sortRaw : "delivery_date";

  const sortDirRaw = firstValue(params.direcao).toLowerCase();
  const sortDir: "asc" | "desc" = sortDirRaw === "desc" ? "desc" : "asc";

  const pageRaw = Number.parseInt(firstValue(params.pagina), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const pageSizeRaw = Number.parseInt(firstValue(params.porpagina), 10);
  const pageSize = (PRODUCTION_PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : clampPageSize(pageSizeRaw, PRODUCTION_PAGE_SIZE);

  return {
    search,
    orderStatus,
    processCode,
    processStatus,
    delivery,
    deliveryFrom,
    deliveryTo,
    orderCode: textParam(params, "of"),
    customer: textParam(params, "cliente"),
    family: textParam(params, "familia"),
    parentItem: textParam(params, "itempai"),
    description: textParam(params, "descricao"),
    qtyMin: numberParam(params, "qtdmin"),
    qtyMax: numberParam(params, "qtdmax"),
    weightMin: numberParam(params, "pesomin"),
    weightMax: numberParam(params, "pesomax"),
    sort,
    sortDir,
    page,
    pageSize,
  };
}

/** Lê os filtros da listagem de pedidos a partir da URL. */
export function parseOrderFilters(params: SearchParamsRecord): OrderFilters {
  const search = firstValue(params.q).trim();
  const statusRaw = firstValue(params.status).toUpperCase();
  const status = (ORDER_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as OrderStatus)
    : "ALL";

  const pageRaw = Number.parseInt(firstValue(params.pagina), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const pageSizeRaw = Number.parseInt(firstValue(params.porpagina), 10);
  const pageSize = clampPageSize(pageSizeRaw, ORDERS_PAGE_SIZE);

  return { search, status, page, pageSize };
}

/** Lê os filtros da tela Fábrica 1 (itens filhos + matérias-primas). */
export function parseChildItemFilters(params: SearchParamsRecord): ChildItemFilters {
  const search = textParam(params, "q");
  const orderCode = textParam(params, "of");
  const customer = textParam(params, "cliente");
  const parentItem = textParam(params, "itempai");
  const childItem = textParam(params, "filho");
  const description = textParam(params, "descricao");
  const material = textParam(params, "material");

  const deliveryFrom = dateParam(params, "entregade");
  const deliveryTo = dateParam(params, "entregaate");

  const processCodeRaw = firstValue(params.processo).toUpperCase();
  const processCode =
    processCodeRaw && /^[A-Z][A-Z0-9_]{1,11}$/.test(processCodeRaw) ? processCodeRaw : "ALL";

  const processStatusRaw = firstValue(params.situacao).toUpperCase();
  const processStatus = (PROCESS_STATUSES as readonly string[]).includes(processStatusRaw)
    ? (processStatusRaw as ProcessStatus)
    : "ALL";

  const pageRaw = Number.parseInt(firstValue(params.pagina), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const pageSizeRaw = Number.parseInt(firstValue(params.porpagina), 10);
  const pageSize = clampPageSize(pageSizeRaw, CHILD_ITEMS_PAGE_SIZE);

  return {
    search,
    orderCode,
    customer,
    parentItem,
    childItem,
    description,
    material,
    deliveryFrom,
    deliveryTo,
    processCode,
    processStatus,
    page,
    pageSize,
  };
}

type PartialParams = Record<string, string | number | undefined>;

function toSearchParams(params: PartialParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

/** Monta a query string da tela de gestão de entregas (defaults omitidos). */
export function productionQueryString(filters: ProductionFilters, overrides: Partial<ProductionFilters> = {}): string {
  const next = { ...filters, ...overrides };
  return toSearchParams({
    q: next.search || undefined,
    status: next.orderStatus === "ALL" ? undefined : next.orderStatus,
    processo: next.processCode === "ALL" ? undefined : next.processCode,
    situacao: next.processStatus === "ALL" ? undefined : next.processStatus,
    entrega: next.delivery === "ALL" ? undefined : next.delivery,
    entregade: next.deliveryFrom || undefined,
    entregaate: next.deliveryTo || undefined,
    of: next.orderCode || undefined,
    cliente: next.customer || undefined,
    familia: next.family || undefined,
    itempai: next.parentItem || undefined,
    descricao: next.description || undefined,
    qtdmin: next.qtyMin ?? undefined,
    qtdmax: next.qtyMax ?? undefined,
    pesomin: next.weightMin ?? undefined,
    pesomax: next.weightMax ?? undefined,
    ordem: next.sort === "delivery_date" ? undefined : next.sort,
    direcao: next.sort === "delivery_date" || next.sortDir === "asc" ? undefined : next.sortDir,
    pagina: next.page === 1 ? undefined : next.page,
    porpagina: next.pageSize === PRODUCTION_PAGE_SIZE ? undefined : next.pageSize,
  });
}

/** Monta a query string da listagem de pedidos (defaults omitidos). */
export function orderQueryString(filters: OrderFilters, overrides: Partial<OrderFilters> = {}): string {
  const next = { ...filters, ...overrides };
  return toSearchParams({
    q: next.search || undefined,
    status: next.status === "ALL" ? undefined : next.status,
    pagina: next.page === 1 ? undefined : next.page,
    porpagina: next.pageSize === ORDERS_PAGE_SIZE ? undefined : next.pageSize,
  });
}

/** Monta a query string da tela Fábrica 1 (defaults omitidos). */
export function childItemQueryString(
  filters: ChildItemFilters,
  overrides: Partial<ChildItemFilters> = {},
): string {
  const next = { ...filters, ...overrides };
  return toSearchParams({
    q: next.search || undefined,
    of: next.orderCode || undefined,
    cliente: next.customer || undefined,
    itempai: next.parentItem || undefined,
    filho: next.childItem || undefined,
    descricao: next.description || undefined,
    material: next.material || undefined,
    entregade: next.deliveryFrom || undefined,
    entregaate: next.deliveryTo || undefined,
    processo: next.processCode === "ALL" ? undefined : next.processCode,
    situacao: next.processStatus === "ALL" ? undefined : next.processStatus,
    pagina: next.page === 1 ? undefined : next.page,
    porpagina: next.pageSize === CHILD_ITEMS_PAGE_SIZE ? undefined : next.pageSize,
  });
}

export interface ChildItemFilterChip {
  key:
    | "search"
    | "orderCode"
    | "customer"
    | "parentItem"
    | "childItem"
    | "description"
    | "material"
    | "deliveryPeriod"
    | "process";
  label: string;
  /** Como desligar só este filtro, mantendo os demais. */
  clear: Partial<ChildItemFilters>;
}

/**
 * Chips de "filtros ativos" da tela Fábrica 1 — um chip por filtro ligado,
 * com o ajuste exato para removê-lo individualmente.
 */
export function childItemFilterChips(filters: ChildItemFilters): ChildItemFilterChip[] {
  const chips: ChildItemFilterChip[] = [];

  const textColumns: {
    key: ChildItemFilterChip["key"];
    column: string;
    value: string;
    clear: Partial<ChildItemFilters>;
  }[] = [
    { key: "search", column: "Busca", value: filters.search, clear: { search: "" } },
    { key: "orderCode", column: "OF/OS", value: filters.orderCode, clear: { orderCode: "" } },
    { key: "customer", column: "Cliente", value: filters.customer, clear: { customer: "" } },
    { key: "parentItem", column: "Item pai", value: filters.parentItem, clear: { parentItem: "" } },
    { key: "childItem", column: "Filho", value: filters.childItem, clear: { childItem: "" } },
    {
      key: "description",
      column: "Descrição",
      value: filters.description,
      clear: { description: "" },
    },
    { key: "material", column: "Matérias-primas", value: filters.material, clear: { material: "" } },
  ];
  for (const text of textColumns) {
    if (text.value) {
      chips.push({ key: text.key, label: `${text.column}: ${text.value}`, clear: text.clear });
    }
  }

  if (filters.deliveryFrom || filters.deliveryTo) {
    chips.push({
      key: "deliveryPeriod",
      label: deliveryPeriodLabel(filters.deliveryFrom, filters.deliveryTo),
      clear: { deliveryFrom: null, deliveryTo: null },
    });
  }

  if (filters.processCode !== "ALL") {
    chips.push({
      key: "process",
      label:
        filters.processStatus === "ALL"
          ? `Processo: ${filters.processCode}`
          : `${filters.processCode}: ${PROCESS_STATUS_LABELS[filters.processStatus]}`,
      clear: { processCode: "ALL", processStatus: "ALL" },
    });
  } else if (filters.processStatus !== "ALL") {
    chips.push({
      key: "process",
      label: `${PROCESS_STATUS_LABELS[filters.processStatus]} (qualquer processo)`,
      clear: { processCode: "ALL", processStatus: "ALL" },
    });
  }

  return chips;
}

export interface ActiveFilterChip {
  key:
    | "search"
    | "orderStatus"
    | "delivery"
    | "deliveryPeriod"
    | "process"
    | "orderCode"
    | "customer"
    | "family"
    | "parentItem"
    | "description"
    | "qty"
    | "weight";
  label: string;
  /** Como desligar só este filtro, mantendo os demais. */
  clear: Partial<ProductionFilters>;
}

/** Rótulo do chip do período de entrega (lados opcionais). */
function deliveryPeriodLabel(from: string | null, to: string | null): string {
  if (from && to) return `Período de entrega: ${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `Período de entrega: a partir de ${formatDate(from)}`;
  return `Período de entrega: até ${formatDate(to)}`;
}

function rangeChipLabel(
  column: string,
  min: number | null,
  max: number | null,
  format: (value: number) => string,
): string {
  if (min !== null && max !== null) return `${column}: ${format(min)} – ${format(max)}`;
  if (min !== null) return `${column}: ≥ ${format(min)}`;
  if (max !== null) return `${column}: ≤ ${format(max)}`;
  return column;
}

/**
 * Chips de "filtros ativos" da tela de gestão de entregas.
 * Um chip por filtro ligado (busca, situação, entrega, processo e
 * filtros de coluna), com o ajuste exato para removê-lo individualmente.
 */
export function activeFilterChips(filters: ProductionFilters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (filters.search) {
    chips.push({ key: "search", label: `Busca: ${filters.search}`, clear: { search: "" } });
  }

  if (filters.orderStatus !== "ALL") {
    chips.push({
      key: "orderStatus",
      label: `Situação: ${ORDER_STATUS_LABELS[filters.orderStatus]}`,
      clear: { orderStatus: "ALL" },
    });
  }

  if (filters.delivery !== "ALL") {
    chips.push({
      key: "delivery",
      label: `Entrega: ${DELIVERY_LABELS[filters.delivery]}`,
      clear: { delivery: "ALL" },
    });
  }

  if (filters.deliveryFrom || filters.deliveryTo) {
    chips.push({
      key: "deliveryPeriod",
      label: deliveryPeriodLabel(filters.deliveryFrom, filters.deliveryTo),
      clear: { deliveryFrom: null, deliveryTo: null },
    });
  }

  if (filters.processCode !== "ALL") {
    chips.push({
      key: "process",
      label:
        filters.processStatus === "ALL"
          ? `Processo: ${filters.processCode}`
          : `${filters.processCode}: ${PROCESS_STATUS_LABELS[filters.processStatus]}`,
      clear: { processCode: "ALL", processStatus: "ALL" },
    });
  } else if (filters.processStatus !== "ALL") {
    chips.push({
      key: "process",
      label: `${PROCESS_STATUS_LABELS[filters.processStatus]} (qualquer processo)`,
      clear: { processCode: "ALL", processStatus: "ALL" },
    });
  }

  // Filtros de coluna — texto ("contém")
  const textColumns: { key: ActiveFilterChip["key"]; column: string; value: string; clear: Partial<ProductionFilters> }[] = [
    { key: "orderCode", column: "OF/OS", value: filters.orderCode, clear: { orderCode: "" } },
    { key: "customer", column: "Cliente", value: filters.customer, clear: { customer: "" } },
    { key: "family", column: "Tipo", value: filters.family, clear: { family: "" } },
    { key: "parentItem", column: "Item pai", value: filters.parentItem, clear: { parentItem: "" } },
    { key: "description", column: "Descrição", value: filters.description, clear: { description: "" } },
  ];
  for (const text of textColumns) {
    if (text.value) {
      chips.push({ key: text.key, label: `${text.column}: ${text.value}`, clear: text.clear });
    }
  }

  // Filtros de coluna — faixas numéricas
  if (filters.qtyMin !== null || filters.qtyMax !== null) {
    chips.push({
      key: "qty",
      label: rangeChipLabel("Qtd.", filters.qtyMin, filters.qtyMax, formatQuantity),
      clear: { qtyMin: null, qtyMax: null },
    });
  }
  if (filters.weightMin !== null || filters.weightMax !== null) {
    chips.push({
      key: "weight",
      label: rangeChipLabel("Peso un.", filters.weightMin, filters.weightMax, formatWeight),
      clear: { weightMin: null, weightMax: null },
    });
  }

  return chips;
}
