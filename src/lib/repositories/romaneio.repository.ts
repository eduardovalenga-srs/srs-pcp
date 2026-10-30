import type { SupabaseServer } from "@/lib/supabase/types";
import type { Json, RomaneioCustomerRow } from "@/lib/types/database";
import type { OrderStatus, OrderType } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";
import type { RomaneioStatus } from "@/lib/constants/romaneio";
import type {
  RomaneioCandidate,
  RomaneioCustomerOption,
  RomaneioFilters,
  RomaneioSummary,
} from "@/lib/types/romaneio";
import type { RomaneioMaterialValues } from "@/lib/validators/romaneio.schema";
import { escapeFilterTerm } from "@/lib/utils/filters";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Linha crua de `romaneio_items` no retorno embutido. */
interface RawRomaneioItem {
  order_item_id: string;
  quantity: number | string;
}

/** Linha crua de `romaneio_materials`. */
export interface RawRomaneioMaterial {
  description: string;
  unit: string;
  quantity_planned: number | string;
  quantity_received: number | string | null;
  quantity_used: number | string | null;
}

/** Item da OF (raiz/filho) com materiais e processos — insumo da visão. */
export interface RawOrderItemStructure {
  id: string;
  parent_order_item_id: string | null;
  family: string | null;
  parent_item: string | null;
  description: string;
  quantity: number | string;
  unit_weight_kg: number | string | null;
  order_item_materials: { description: string; quantity: number | string; unit: string }[];
  production_processes: { status: ProcessStatus; processes: { code: string } | null }[];
}

/** Romaneio completo com a estrutura da OF (base da visão de detalhe). */
export interface RawRomaneioDetails {
  id: string;
  number: number;
  order_id: string;
  status: RomaneioStatus;
  shipment_date: string | null;
  carrier: string | null;
  vehicle: string | null;
  notes: string | null;
  conference_accepted_at: string | null;
  conference_notes: string | null;
  emitted_at: string | null;
  nf_number: string | null;
  return_nf_number: string | null;
  created_at: string;
  conference_user: { name: string | null } | null;
  orders: {
    id: string;
    code: string;
    type: OrderType;
    customer_name: string | null;
    delivery_date: string | null;
    status: OrderStatus;
    order_items: RawOrderItemStructure[];
  };
  romaneio_items: RawRomaneioItem[];
  romaneio_materials: RawRomaneioMaterial[];
}

/** Linha crua de `get_romaneios_page` (RPC 043) — agregados no banco. */
interface RawRomaneiosPageRow {
  total_count: number | string;
  id: string;
  number: number | string;
  order_id: string;
  order_code: string | null;
  customer_name: string | null;
  order_delivery_date: string | null;
  status: string;
  shipment_date: string | null;
  carrier: string | null;
  item_count: number | string;
  quantity_total: number | string;
  weight_total: number | string | null;
  nf_number: string | null;
  return_nf_number: string | null;
  pending_return: boolean;
  conference_accepted_at: string | null;
  emitted_at: string | null;
  created_at: string;
}

/**
 * Linha crua de `get_romaneio_candidates` (RPC 043/045) e de cada OF embutida
 * no `ofs` jsonb de `get_romaneio_customers` (044/045) — sem o agregado.
 */
interface RawRomaneioCandidate {
  order_id: string;
  code: string;
  type: string;
  /** Ausente nas OFs embutidas no `ofs` do 044 (o cliente já agrupa). */
  customer_name?: string | null;
  delivery_date: string | null;
  status: string;
  root_quantity: number | string;
  root_weight_kg: number | string | null;
  shipped_quantity: number | string;
  has_open: boolean;
  open_romaneio_id: string | null;
}

/** Mapeia a linha crua (RPC 043 ou OF embutida no 044) para o tipo da tela. */
function mapCandidate(row: RawRomaneioCandidate): RomaneioCandidate {
  return {
    orderId: row.order_id,
    code: row.code,
    type: row.type as OrderType,
    customerName: row.customer_name || null,
    deliveryDate: row.delivery_date,
    status: row.status as OrderStatus,
    rootQuantity: toNumber(row.root_quantity) ?? 0,
    rootWeightKg: toNumber(row.root_weight_kg),
    shippedQuantity: toNumber(row.shipped_quantity) ?? 0,
    hasOpenRomaneio: row.has_open,
    openRomaneioId: row.open_romaneio_id,
  };
}

/**
 * Teto de IDs de OF resolvidos na busca genérica — mesmo limite de
 * 1000 linhas por resposta do Supabase usado na varredura de exports.
 */
const SEARCH_ORDER_IDS_LIMIT = 1000;

/** UUID impossível para forçar resultado vazio (nada casou na busca). */
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Resolve os IDs de OF cujo código ou cliente casam com a busca genérica.
 *
 * A busca da listagem precisa cruzar `romaneios` × `orders`, mas o
 * PostgREST NÃO aceita paths embutidos dentro de `or=(...)` (PGRST100
 * "failed to parse logic tree" — só condições de coluna de topo), então o
 * cruzamento vira consulta prévia e o match entra como `order_id.in.(...)`
 * (coluna de topo de romaneios).
 */
async function resolveSearchOrderIds(
  client: SupabaseServer,
  filters: RomaneioFilters,
): Promise<string[]> {
  const term = escapeFilterTerm(filters.search);
  if (!term) return [];

  const { data, error } = await client
    .from("orders")
    .select("id")
    .or(`code.ilike.%${term}%,customer_name.ilike.%${term}%`)
    .limit(SEARCH_ORDER_IDS_LIMIT);
  assertOk(error, "Não foi possível carregar os romaneios");
  return (data ?? []).map((row) => (row as { id: string }).id);
}

/** Aplica os filtros da listagem em qualquer query builder de romaneios. */
function applyRomaneioFilters<T>(
  query: T,
  filters: RomaneioFilters,
  searchOrderIds: readonly string[],
  /** Situação aplicada no count (o filtro de status não existe mais na URL). */
  status: RomaneioStatus | null,
): T {
  const builder = query as unknown as {
    or: (filter: string) => unknown;
    eq: (column: string, value: string) => unknown;
    ilike: (column: string, value: string) => unknown;
    gte: (column: string, value: string) => unknown;
    lte: (column: string, value: string) => unknown;
  };
  // Busca genérica: nº do romaneio (bigint — só quando o termo é numérico,
  // senão o PostgREST não casa o cast) OU OF que casou na consulta prévia.
  // Só colunas de topo — ver resolveSearchOrderIds (PGRST100).
  const term = escapeFilterTerm(filters.search);
  if (term) {
    const conditions: string[] = [];
    if (/^\d{1,18}$/.test(term)) {
      conditions.push(`number.eq.${term}`);
    }
    if (searchOrderIds.length > 0) {
      // Dentro de or=(...) a condição usa ponto (field.op.valor), não a
      // sintaxe de query param (field=op.valor) — senão o PostgREST responde
      // 400 PGRST100 "failed to parse logic tree".
      conditions.push(`order_id.in.(${searchOrderIds.join(",")})`);
    }
    if (conditions.length > 0) {
      builder.or(conditions.join(","));
    } else {
      // Nenhuma OF casou com o texto: resultado vazio garantido.
      builder.eq("id", EMPTY_UUID);
    }
  }
  if (status) {
    builder.eq("status", status);
  }
  const code = escapeFilterTerm(filters.orderCode);
  if (code) {
    builder.ilike("orders.code", `%${code}%`);
  }
  const customer = escapeFilterTerm(filters.customer);
  if (customer) {
    builder.ilike("orders.customer_name", `%${customer}%`);
  }
  if (filters.shipmentFrom) {
    builder.gte("shipment_date", filters.shipmentFrom);
  }
  if (filters.shipmentTo) {
    builder.lte("shipment_date", filters.shipmentTo);
  }
  return query;
}

/**
 * Lista paginada de romaneios — RPC `get_romaneios_page` (043): filtros,
 * ordenação da coluna escolhida na URL e os agregados (Qtd/Peso/pendência
 * de devolução) computados no banco. Os cartões por situação continuam
 * em PostgREST (`countRomaneiosByStatus`).
 */
export async function listRomaneios(
  client: SupabaseServer,
  filters: RomaneioFilters,
): Promise<{ rows: RomaneioSummary[]; total: number }> {
  const { data, error } = await client.rpc("get_romaneios_page", {
    p_search: escapeFilterTerm(filters.search) || null,
    // A listagem não tem mais filtro de situação (a RPC aceita null).
    p_status: null,
    p_order_code: escapeFilterTerm(filters.orderCode) || null,
    p_customer: escapeFilterTerm(filters.customer) || null,
    p_shipment_from: filters.shipmentFrom || null,
    p_shipment_to: filters.shipmentTo || null,
    p_sort: filters.sort,
    p_sort_dir: filters.sortDir,
    p_offset: (filters.page - 1) * filters.pageSize,
    p_limit: filters.pageSize,
  });
  assertOk(error, "Não foi possível carregar os romaneios");

  const rows = (data ?? []) as RawRomaneiosPageRow[];
  const total = rows.length > 0 ? toNumber(rows[0].total_count) ?? 0 : 0;
  return { rows: rows.map(mapRomaneioSummary), total };
}

/**
 * Contagem por situação com os mesmos filtros da lista (cartões de
 * resumo): a situação pedida entra como filtro extra.
 */
export async function countRomaneiosByStatus(
  client: SupabaseServer,
  filters: RomaneioFilters,
  status: RomaneioStatus,
): Promise<number> {
  // Mesma regra do countQuery de listRomaneios: o embed `orders` precisa
  // estar no select para os filtros por path embutido passarem (PGRST108).
  const searchOrderIds = await resolveSearchOrderIds(client, filters);
  const { count, error } = await applyRomaneioFilters(
    client.from("romaneios").select("id, orders ( id )", { count: "exact", head: true }),
    filters,
    searchOrderIds,
    status,
  );
  assertOk(error, "Não foi possível contar os romaneios");
  return count ?? 0;
}

/** Converte a linha da RPC `get_romaneios_page` no resumo da tela/export. */
function mapRomaneioSummary(row: RawRomaneiosPageRow): RomaneioSummary {
  return {
    id: row.id,
    number: toNumber(row.number) ?? 0,
    orderId: row.order_id,
    orderCode: row.order_code || "—",
    customerName: row.customer_name || null,
    orderDeliveryDate: row.order_delivery_date,
    status: row.status as RomaneioStatus,
    shipmentDate: row.shipment_date,
    carrier: row.carrier,
    weightTotal: toNumber(row.weight_total),
    nfNumber: row.nf_number,
    returnNfNumber: row.return_nf_number,
    pendingReturn: row.pending_return,
    conferenceAcceptedAt: row.conference_accepted_at,
    emittedAt: row.emitted_at,
    createdAt: row.created_at,
  };
}

/**
 * Romaneio completo com a estrutura da OF (todos os itens, com materiais
 * e processos) — base da visão de detalhe.
 */
export async function getRomaneioById(
  client: SupabaseServer,
  romaneioId: string,
): Promise<RawRomaneioDetails | null> {
  const { data, error } = await client
    .from("romaneios")
    .select(
      `id, number, order_id, status, shipment_date, carrier, vehicle, notes,
       conference_accepted_at, conference_notes, emitted_at, nf_number, return_nf_number, created_at,
       conference_user:profiles!fk_romaneios_conference_user ( name ),
       orders (
         id, code, type, customer_name, delivery_date, status,
         order_items (
           id, parent_order_item_id, family, parent_item, description, quantity, unit_weight_kg,
           order_item_materials ( description, quantity, unit ),
           production_processes ( status, processes ( code ) )
         )
       ),
       romaneio_items ( order_item_id, quantity ),
       romaneio_materials ( description, unit, quantity_planned, quantity_received, quantity_used )`,
    )
    .eq("id", romaneioId)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o romaneio");
  return (data as RawRomaneioDetails | null) ?? null;
}

/**
 * Quantidade já EXPEDIDA por item (Σ de romaneios CONFIRMADOS da OF,
 * excluindo um romaneio específico) — base da pendência de expedição
 * parcial (a "baixa" é derivada, nunca gravada).
 */
export async function listConfirmedQuantityByItem(
  client: SupabaseServer,
  orderId: string,
  excludeRomaneioId: string | null,
): Promise<Map<string, number>> {
  let query = client
    .from("romaneio_items")
    .select(
      "order_item_id, quantity, romaneios!inner ( status, order_id )",
    )
    .eq("romaneios.status", "CONFIRMADO")
    .eq("romaneios.order_id", orderId);
  if (excludeRomaneioId) {
    query = query.neq("romaneio_id", excludeRomaneioId);
  }
  const { data, error } = await query;
  assertOk(error, "Não foi possível calcular a expedição já confirmada");

  const totals = new Map<string, number>();
  for (const row of (data ?? []) as { order_item_id: string; quantity: number | string }[]) {
    totals.set(row.order_item_id, (totals.get(row.order_item_id) ?? 0) + (toNumber(row.quantity) ?? 0));
  }
  return totals;
}

/**
 * Linhas de material gravadas em TODOS os romaneios não cancelados da
 * OF — base do Σ (recebida/utilizada/saldo) por OF inteira.
 */
export async function listOrderMaterialLines(
  client: SupabaseServer,
  orderId: string,
): Promise<RawRomaneioMaterial[]> {
  const { data, error } = await client
    .from("romaneios")
    .select(
      "romaneio_materials ( description, unit, quantity_planned, quantity_received, quantity_used )",
    )
    .eq("order_id", orderId)
    .neq("status", "CANCELADO");
  assertOk(error, "Não foi possível carregar os materiais da OF");

  const lines: RawRomaneioMaterial[] = [];
  for (const row of (data ?? []) as { romaneio_materials: RawRomaneioMaterial[] | null }[]) {
    for (const material of row.romaneio_materials ?? []) lines.push(material);
  }
  return lines;
}

/**
 * Seletor em cascata de /romaneio/novo: clientes com OFs disponíveis,
 * cada um com a lista das suas OFs (RPC `get_romaneio_customers`, 044).
 * OFs totalmente expedidas ficam de fora; cliente vazio vira um bucket
 * único com `customerName: null`.
 */
export async function listRomaneioCustomers(
  client: SupabaseServer,
): Promise<RomaneioCustomerOption[]> {
  const { data, error } = await client.rpc("get_romaneio_customers");
  assertOk(error, "Não foi possível carregar os clientes");

  return ((data ?? []) as RomaneioCustomerRow[]).map((row) => ({
    customerName: row.customer_name || null,
    ofCount: toNumber(row.of_count) ?? 0,
    ofs: (row.ofs ?? []).map(mapCandidate),
  }));
}

/** Item RAIZ da OF com processos — insumo da seleção de itens de /romaneio/novo. */
export interface RawRootOrderItem {
  id: string;
  family: string | null;
  parent_item: string | null;
  description: string;
  quantity: number | string;
  unit_weight_kg: number | string | null;
  production_processes: { status: ProcessStatus; processes: { code: string } | null }[];
}

/**
 * Itens RAIZ de uma OF (com o processo EXP) — alimenta a seleção de
 * itens da remessa em /romaneio/novo antes de criar o romaneio.
 */
export async function listRootOrderItems(
  client: SupabaseServer,
  orderId: string,
): Promise<RawRootOrderItem[]> {
  const { data, error } = await client
    .from("order_items")
    .select(
      `id, family, parent_item, description, quantity, unit_weight_kg,
       production_processes ( status, processes ( code ) )`,
    )
    .eq("order_id", orderId)
    .is("parent_order_item_id", null);
  assertOk(error, "Não foi possível carregar os itens da OF");
  return (data ?? []) as RawRootOrderItem[];
}

// ---------------------------------------------------------------------------
// RPCs (transação no banco — mesmo padrão de replace_item_materials/apply_import)
// ---------------------------------------------------------------------------

export interface SaveRomaneioRpcInput {
  romaneioId: string | null;
  orderId: string;
  shipmentDate: string | null;
  carrier: string | null;
  vehicle: string | null;
  notes: string | null;
  items: { orderItemId: string; quantity: number }[];
  materials: RomaneioMaterialValues[];
}

/** Cria/atualiza um romaneio em MONTADO (cabeçalho+itens+materiais). */
export async function saveRomaneioRpc(
  client: SupabaseServer,
  input: SaveRomaneioRpcInput,
): Promise<{ id: string; number: number }> {
  const { data, error } = await client.rpc("save_romaneio", {
    p_romaneio_id: input.romaneioId,
    p_order_id: input.orderId,
    p_shipment_date: input.shipmentDate,
    p_carrier: input.carrier,
    p_vehicle: input.vehicle,
    p_notes: input.notes,
    p_items: input.items as unknown as Json,
    p_materials: input.materials as unknown as Json,
  });
  assertOk(error, "Não foi possível salvar o romaneio");
  const result = data as { id: string; number: number | string } | null;
  return { id: result?.id ?? "", number: Number(result?.number ?? 0) };
}

/** Sinaliza o aceite da conferência (quem/quando/observação) — MONTADO → CONFERIDO. */
export async function signRomaneioConferenceRpc(
  client: SupabaseServer,
  romaneioId: string,
  notes: string | null,
): Promise<void> {
  const { error } = await client.rpc("sign_romaneio_conference", {
    p_romaneio_id: romaneioId,
    p_notes: notes,
  });
  assertOk(error, "Não foi possível sinalizar a conferência");
}

/**
 * Confirma o romaneio (CONFERIDO → CONFIRMADO): os gates são validados
 * NO BANCO (RPC 045) — a baixa na pendência da OF é derivada a partir
 * dos CONFIRMADOS, então este é o momento em que os itens saem.
 */
export async function confirmRomaneioRpc(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  const { error } = await client.rpc("confirm_romaneio", { p_romaneio_id: romaneioId });
  assertOk(error, "Não foi possível confirmar o romaneio");
}

/** Exclusão DEFINITIVA — só permitida em romaneios MONTADOS (045). */
export async function deleteRomaneioRpc(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_romaneio", { p_romaneio_id: romaneioId });
  assertOk(error, "Não foi possível excluir o romaneio");
}

/** Cancela o romaneio (CONFERIDO/CONFIRMADO — reverte a baixa derivada). */
export async function cancelRomaneioRpc(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  const { error } = await client.rpc("cancel_romaneio", { p_romaneio_id: romaneioId });
  assertOk(error, "Não foi possível cancelar o romaneio");
}

/**
 * Atualiza os números de NF do romaneio (saída/devolução). O guard de
 * status (não cancelado) vale no banco junto com o RLS.
 */
export async function updateRomaneioNfNumbers(
  client: SupabaseServer,
  romaneioId: string,
  nfNumber: string | null,
  returnNfNumber: string | null,
): Promise<void> {
  const { data, error } = await client
    .from("romaneios")
    .update({ nf_number: nfNumber, return_nf_number: returnNfNumber })
    .eq("id", romaneioId)
    .neq("status", "CANCELADO")
    .select("id");
  assertOk(error, "Não foi possível salvar os números de NF");
  if (!data || data.length === 0) {
    throw new Error("Romaneio não encontrado ou cancelado.");
  }
}
