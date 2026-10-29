import { DELIVERY_FILTERS, DELIVERY_LABELS, PRODUCTION_PAGE_SIZE, PRODUCTION_PAGE_SIZE_OPTIONS, MAX_PAGE_SIZE, ORDERS_PAGE_SIZE, CHILD_ITEMS_PAGE_SIZE, ROMANEIO_PAGE_SIZE, type DeliveryFilter } from "@/lib/constants/pagination";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants/orders";
import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, type ProcessStatus } from "@/lib/constants/production";
import { ROMANEIO_STATUSES, type RomaneioStatus } from "@/lib/constants/romaneio";
import type { ChildItemFilters, OrderFilters } from "@/lib/types/order";
import type { ProductionFilters } from "@/lib/types/production";
import type { RomaneioCandidateFilters, RomaneioFilters } from "@/lib/types/romaneio";
import { formatDate, isValidISODate } from "@/lib/utils/dates";
import { formatQuantity, formatWeight, toNumber } from "@/lib/utils/formatting";

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Chaves de ordenação aceitas pela RPC get_production_rows (whitelist do banco). */
export const PRODUCTION_SORT_KEYS = [
  // 036: sequência de fabricação — é o DEFAULT das telas (seq nulls
  // last, depois a ordenação atual); as linhas sem número ficam no fim.
  "seq",
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
  // 043: "Cli." (a Fábrica 2 passa a ordenar junto) e a DP (data de
  // proposta) — a DP só existe na gestão; a RPC da Fábrica 2 não a
  // reconhece e cai no default (entrega), sem quebrar nada.
  "customer",
  "proposal_date",
] as const;
export type ProductionSortKey = (typeof PRODUCTION_SORT_KEYS)[number];

/**
 * Ordenação padrão das telas de produção (F2 e Gestão de OF): a ordem
 * do planejamento (seq nulls last, entrega como desempate). Sem
 * sequência nenhuma, tudo cai no desempate = comportamento de antes.
 */
export const DEFAULT_PRODUCTION_SORT: ProductionSortKey = "seq";

/**
 * 043: chaves de ordenação da Fábrica 1 (colunas da lista de grupos de
 * itens filhos). Os códigos de processo do catálogo também ordenam —
 * validação separada (isValidProcessSort), como na produção.
 */
export const CHILD_ITEM_SORT_KEYS = [
  "seq",
  "order_code",
  "customer",
  "child_item",
  "materials",
  "quantity",
  "unit_weight_kg",
  "weight_total",
  "delivery_date",
] as const;
export type ChildItemSortKey = (typeof CHILD_ITEM_SORT_KEYS)[number];

/** Ordem default da Fábrica 1 — exatamente a ordem fixa de antes. */
export const DEFAULT_CHILD_ITEM_SORT: ChildItemSortKey = "seq";

export function isChildItemSortableColumn(value: string): value is ChildItemSortKey {
  return (CHILD_ITEM_SORT_KEYS as readonly string[]).includes(value);
}

/**
 * 043: chaves de ordenação da listagem de romaneios. `number` é o
 * default (desc — os romaneios novos saem no topo).
 */
export const ROMANEIO_SORT_KEYS = [
  "number",
  "order_code",
  "customer",
  "status",
  "shipment_date",
  "item_count",
  "quantity_total",
  "weight_total",
  "nf_number",
  "return_nf_number",
] as const;
export type RomaneioSortKey = (typeof ROMANEIO_SORT_KEYS)[number];

/** Ordem default da listagem de romaneios: nº decrescente. */
export const DEFAULT_ROMANEIO_SORT: RomaneioSortKey = "number";
export const DEFAULT_ROMANEIO_SORT_DIR: "asc" | "desc" = "desc";

export function isRomaneioSortableColumn(value: string): value is RomaneioSortKey {
  return (ROMANEIO_SORT_KEYS as readonly string[]).includes(value);
}

/**
 * 043: chaves de ordenação do seletor de OFs de /romaneio/novo.
 * `delivery_date` é o default (asc, nulls last) — a ordem de antes.
 */
export const ROMANEIO_CANDIDATE_SORT_KEYS = [
  "order_code",
  "customer",
  "delivery_date",
  "status",
  "quantity",
  "weight",
  "shipped",
] as const;
export type RomaneioCandidateSortKey = (typeof ROMANEIO_CANDIDATE_SORT_KEYS)[number];

export const DEFAULT_ROMANEIO_CANDIDATE_SORT: RomaneioCandidateSortKey = "delivery_date";

export function isRomaneioCandidateSortableColumn(value: string): value is RomaneioCandidateSortKey {
  return (ROMANEIO_CANDIDATE_SORT_KEYS as readonly string[]).includes(value);
}

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
 * Neutraliza caracteres da gramática de filtros PostgREST em termos que
 * são interpolados em `.or(...)` (ex.: `code.ilike.%termo%`): vírgula
 * separa condições e parênteses agrupam. Sem o escape, a busca do
 * usuário quebrava a query (400) ou alterava a estrutura do filtro.
 * As colunas continuam protegidas por RLS de qualquer forma — isto é
 * correção de comportamento, não a única barreira.
 */
export function escapeFilterTerm(value: string): string {
  return value.replace(/[(),]/g, " ").trim();
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
 * 038: lê a sequência de fabricação da URL — INTEIRO >= 1 por igualdade
 * ("seq = N"). Zero, negativos e quebrados são descartados (null).
 */
function seqParam(params: SearchParamsRecord, key: string): number | null {
  const raw = firstValue(params[key]).trim();
  if (!/^\d{1,6}$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 1 ? parsed : null;
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
  const sort =
    isSortableColumn(sortRaw) || isValidProcessSort(sortRaw) ? sortRaw : DEFAULT_PRODUCTION_SORT;

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
    op: textParam(params, "op"),
    qtyMin: numberParam(params, "qtdmin"),
    qtyMax: numberParam(params, "qtdmax"),
    weightMin: numberParam(params, "pesomin"),
    weightMax: numberParam(params, "pesomax"),
    // 038: seq por igualdade — exclusiva por OF no banco (038).
    seq: seqParam(params, "seq"),
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

  return {
    search,
    status,
    // 038: filtros por coluna — mesmos nomes de URL das telas de produção.
    code: textParam(params, "of"),
    customer: textParam(params, "cliente"),
    deliveryFrom: dateParam(params, "entregade"),
    deliveryTo: dateParam(params, "entregaate"),
    page,
    pageSize,
  };
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

  // Card "Atrasados" da Fábrica 1: `?atrasados=1` liga o recorte do KIT vencido.
  const overdue = firstValue(params.atrasados) === "1";

  // 043: ordenação por coluna (whitelist + códigos de processo).
  const sortRaw = firstValue(params.ordem).toLowerCase();
  const sort =
    isChildItemSortableColumn(sortRaw) || isValidProcessSort(sortRaw)
      ? sortRaw
      : DEFAULT_CHILD_ITEM_SORT;
  const sortDirRaw = firstValue(params.direcao).toLowerCase();
  const sortDir: "asc" | "desc" = sortDirRaw === "desc" ? "desc" : "asc";

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
    overdue,
    // 038: seq por igualdade + faixas sobre os AGREGADOS do grupo.
    seq: seqParam(params, "seq"),
    qtyMin: numberParam(params, "qtdmin"),
    qtyMax: numberParam(params, "qtdmax"),
    weightMin: numberParam(params, "pesomin"),
    weightMax: numberParam(params, "pesomax"),
    weightUnitMin: numberParam(params, "pesounmin"),
    weightUnitMax: numberParam(params, "pesounmax"),
    sort,
    sortDir,
    page,
    pageSize,
  };
}

/**
 * Lê os filtros da listagem de romaneios de expedição a partir da URL.
 * `q` busca genérica (nº do romaneio, OF/OS ou cliente); `saida*` filtra
 * o período da data de saída (mesmas convenções das telas de entrega).
 */
export function parseRomaneioFilters(params: SearchParamsRecord): RomaneioFilters {
  const search = firstValue(params.q).trim();
  const statusRaw = firstValue(params.status).toUpperCase();
  const status = (ROMANEIO_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as RomaneioStatus)
    : "ALL";

  // 043: ordenação por coluna (whitelist fechada — sem código de processo).
  const sortRaw = firstValue(params.ordem).toLowerCase();
  const sort = isRomaneioSortableColumn(sortRaw) ? sortRaw : DEFAULT_ROMANEIO_SORT;
  const sortDirRaw = firstValue(params.direcao).toLowerCase();
  const sortDir: "asc" | "desc" =
    sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : DEFAULT_ROMANEIO_SORT_DIR;

  const pageRaw = Number.parseInt(firstValue(params.pagina), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const pageSizeRaw = Number.parseInt(firstValue(params.porpagina), 10);
  const pageSize = clampPageSize(pageSizeRaw, ROMANEIO_PAGE_SIZE);

  return {
    search,
    status,
    orderCode: textParam(params, "of"),
    customer: textParam(params, "cliente"),
    shipmentFrom: dateParam(params, "saidade"),
    shipmentTo: dateParam(params, "saidaate"),
    sort,
    sortDir,
    page,
    pageSize,
  };
}

/** Monta a query string da listagem de romaneios (defaults omitidos). */
export function romaneioQueryString(
  filters: RomaneioFilters,
  overrides: Partial<RomaneioFilters> = {},
): string {
  const next = { ...filters, ...overrides };
  return toSearchParams({
    q: next.search || undefined,
    status: next.status === "ALL" ? undefined : next.status,
    of: next.orderCode || undefined,
    cliente: next.customer || undefined,
    saidade: next.shipmentFrom || undefined,
    saidaate: next.shipmentTo || undefined,
    ordem: next.sort === DEFAULT_ROMANEIO_SORT ? undefined : next.sort,
    // `direcao` só sobrevive quando difere do default da tela (desc) —
    // no default, "asc" sobrevive sozinho (`?direcao=asc` reparseia na
    // chave padrão), senão a coluna ativa nunca conseguiria inverter.
    direcao: next.sortDir === DEFAULT_ROMANEIO_SORT_DIR ? undefined : next.sortDir,
    pagina: next.page === 1 ? undefined : next.page,
    porpagina: next.pageSize === ROMANEIO_PAGE_SIZE ? undefined : next.pageSize,
  });
}

/** Lê os filtros do seletor de OFs em /romaneio/novo a partir da URL. */
export function parseRomaneioCandidateFilters(
  params: SearchParamsRecord,
): RomaneioCandidateFilters {
  // 043: ordenação por coluna (whitelist fechada).
  const sortRaw = firstValue(params.ordem).toLowerCase();
  const sort = isRomaneioCandidateSortableColumn(sortRaw)
    ? sortRaw
    : DEFAULT_ROMANEIO_CANDIDATE_SORT;
  const sortDirRaw = firstValue(params.direcao).toLowerCase();
  const sortDir: "asc" | "desc" = sortDirRaw === "desc" ? "desc" : "asc";

  const pageRaw = Number.parseInt(firstValue(params.pagina), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const pageSizeRaw = Number.parseInt(firstValue(params.porpagina), 10);
  const pageSize = clampPageSize(pageSizeRaw, ROMANEIO_PAGE_SIZE);

  return {
    search: firstValue(params.q).trim().slice(0, MAX_COLUMN_FILTER_LENGTH),
    sort,
    sortDir,
    page,
    pageSize,
  };
}

/** Monta a query string do seletor de OFs (defaults omitidos). */
export function romaneioCandidateQueryString(
  filters: RomaneioCandidateFilters,
  overrides: Partial<RomaneioCandidateFilters> = {},
): string {
  const next = { ...filters, ...overrides };
  return toSearchParams({
    q: next.search || undefined,
    ordem: next.sort === DEFAULT_ROMANEIO_CANDIDATE_SORT ? undefined : next.sort,
    // `direcao` só sobrevive quando difere do default da tela (asc).
    direcao: next.sortDir === "asc" ? undefined : next.sortDir,
    pagina: next.page === 1 ? undefined : next.page,
    porpagina: next.pageSize === ROMANEIO_PAGE_SIZE ? undefined : next.pageSize,
  });
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
    op: next.op || undefined,
    qtdmin: next.qtyMin ?? undefined,
    qtdmax: next.qtyMax ?? undefined,
    pesomin: next.weightMin ?? undefined,
    pesomax: next.weightMax ?? undefined,
    seq: next.seq ?? undefined,
    ordem: next.sort === DEFAULT_PRODUCTION_SORT ? undefined : next.sort,
    // `direcao` cai só quando é "asc" (o default da tela) — no default,
    // "desc" sobrevive sozinho na URL (`?direcao=desc` reparseia na chave
    // padrão), senão a coluna ativa nunca conseguiria inverter a ordem.
    direcao: next.sortDir === "asc" ? undefined : next.sortDir,
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
    of: next.code || undefined,
    cliente: next.customer || undefined,
    entregade: next.deliveryFrom || undefined,
    entregaate: next.deliveryTo || undefined,
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
    atrasados: next.overdue ? 1 : undefined,
    seq: next.seq ?? undefined,
    qtdmin: next.qtyMin ?? undefined,
    qtdmax: next.qtyMax ?? undefined,
    pesomin: next.weightMin ?? undefined,
    pesomax: next.weightMax ?? undefined,
    pesounmin: next.weightUnitMin ?? undefined,
    pesounmax: next.weightUnitMax ?? undefined,
    ordem: next.sort === DEFAULT_CHILD_ITEM_SORT ? undefined : next.sort,
    // `direcao` cai só quando é "asc" (o default da tela) — no default,
    // "desc" sobrevive sozinha na URL, senão a coluna ativa nunca
    // conseguiria inverter a ordem.
    direcao: next.sortDir === "asc" ? undefined : next.sortDir,
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
    | "process"
    | "overdue"
    | "seq"
    | "qty"
    | "weight"
    | "weightUnit";
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

  // 038: seq por igualdade + faixas sobre os agregados do grupo (mesmo
  // rótulo das chips da gestão).
  if (filters.seq !== null) {
    chips.push({ key: "seq", label: `Seq.: ${filters.seq}`, clear: { seq: null } });
  }
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
      label: rangeChipLabel("Peso total", filters.weightMin, filters.weightMax, formatWeight),
      clear: { weightMin: null, weightMax: null },
    });
  }
  if (filters.weightUnitMin !== null || filters.weightUnitMax !== null) {
    chips.push({
      key: "weightUnit",
      label: rangeChipLabel("Peso un.", filters.weightUnitMin, filters.weightUnitMax, formatWeight),
      clear: { weightUnitMin: null, weightUnitMax: null },
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

  // Card "Atrasados": recorte pela regra do KIT (o clique no card liga).
  if (filters.overdue) {
    chips.push({ key: "overdue", label: "Atrasados (KIT vencido)", clear: { overdue: false } });
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
    | "op"
    | "qty"
    | "weight"
    | "seq";
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
    { key: "op", column: "OP", value: filters.op, clear: { op: "" } },
  ];
  for (const text of textColumns) {
    if (text.value) {
      chips.push({ key: text.key, label: `${text.column}: ${text.value}`, clear: text.clear });
    }
  }

  // 038: Seq. por igualdade (exclusiva por OF).
  if (filters.seq !== null) {
    chips.push({ key: "seq", label: `Seq.: ${filters.seq}`, clear: { seq: null } });
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
