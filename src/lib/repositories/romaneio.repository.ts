import type { SupabaseServer } from "@/lib/supabase/types";
import type { Json } from "@/lib/types/database";
import type { OrderStatus, OrderType } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";
import type { RomaneioStatus } from "@/lib/constants/romaneio";
import type {
  RomaneioCandidate,
  RomaneioCandidateFilters,
  RomaneioFilters,
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

interface RomaneioSummaryRow {
  id: string;
  number: number;
  order_id: string;
  status: RomaneioStatus;
  shipment_date: string | null;
  carrier: string | null;
  nf_number: string | null;
  return_nf_number: string | null;
  conference_accepted_at: string | null;
  emitted_at: string | null;
  created_at: string;
  orders: { code: string; customer_name: string | null; delivery_date: string | null } | null;
  romaneio_items: { quantity: number | string; order_items: { unit_weight_kg: number | string | null } | null }[];
  romaneio_materials: { quantity_received: number | string | null; quantity_used: number | string | null }[];
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
  if (filters.status !== "ALL") {
    builder.eq("status", filters.status);
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
 * Lista paginada de romaneios com filtros no banco (nº, OF/OS e
 * cliente via join em `orders`; período sobre a data de saída).
 */
export async function listRomaneios(
  client: SupabaseServer,
  filters: RomaneioFilters,
): Promise<{ rows: RomaneioSummaryRow[]; total: number }> {
  const searchOrderIds = await resolveSearchOrderIds(client, filters);
  const pageQuery = applyRomaneioFilters(
    client.from("romaneios").select(
      `id, number, order_id, status, shipment_date, carrier, nf_number, return_nf_number,
       conference_accepted_at, emitted_at, created_at,
       orders ( code, customer_name, delivery_date ),
       romaneio_items ( quantity, order_items ( unit_weight_kg ) ),
       romaneio_materials ( quantity_received, quantity_used )`,
    ),
    filters,
    searchOrderIds,
  );
  // Filtro por path embutido (orders.code/customer_name) exige o recurso
  // embutido NO select: sem isso o PostgREST responde 400 PGRST108
  // ("'orders' is not an embedded resource in this request"). Como aqui é
  // head+count a resposta vem sem corpo e o erro vira mensagem genérica
  // na tela. O embed to-one não duplica a contagem.
  const countQuery = applyRomaneioFilters(
    client.from("romaneios").select("id, orders ( id )", { count: "exact", head: true }),
    filters,
    searchOrderIds,
  );

  const from = (filters.page - 1) * filters.pageSize;
  const [pageResult, countResult] = await Promise.all([
    pageQuery
      .order("number", { ascending: false })
      .range(from, from + filters.pageSize - 1),
    countQuery,
  ]);

  assertOk(pageResult.error, "Não foi possível carregar os romaneios");
  assertOk(countResult.error, "Não foi possível carregar os romaneios");
  return { rows: (pageResult.data ?? []) as RomaneioSummaryRow[], total: countResult.count ?? 0 };
}

/**
 * Contagem por situação com os mesmos filtros da lista (cartões de
 * resumo): o status pedido SUBSTITUI o filtro de status vigente.
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
    { ...filters, status },
    searchOrderIds,
  );
  assertOk(error, "Não foi possível contar os romaneios");
  return count ?? 0;
}

/** Converte a linha crua da listagem em campos numéricos prontos. */
export function romaneioSummaryNumbers(row: RomaneioSummaryRow) {
  let quantityTotal = 0;
  let weightTotal: number | null = null;
  let pendingReturn = false;
  let hasWeight = true;

  for (const item of row.romaneio_items ?? []) {
    const quantity = toNumber(item.quantity) ?? 0;
    quantityTotal += quantity;
    const unitWeight = toNumber(item.order_items?.unit_weight_kg ?? null);
    if (unitWeight === null) {
      hasWeight = false;
    } else {
      weightTotal = (weightTotal ?? 0) + unitWeight * quantity;
    }
  }
  if (!hasWeight) weightTotal = null;

  for (const material of row.romaneio_materials ?? []) {
    const received = toNumber(material.quantity_received);
    const used = toNumber(material.quantity_used);
    if (received !== null && used !== null && received - used > 0) {
      pendingReturn = true;
    }
  }

  return { quantityTotal, weightTotal, pendingReturn };
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
 * Quantidade já EXPEDIDA por item (Σ de romaneios EMITIDOS da OF,
 * excluindo um romaneio específico) — base da pendência de expedição
 * parcial.
 */
export async function listEmittedQuantityByItem(
  client: SupabaseServer,
  orderId: string,
  excludeRomaneioId: string | null,
): Promise<Map<string, number>> {
  let query = client
    .from("romaneio_items")
    .select(
      "order_item_id, quantity, romaneios!inner ( status, order_id )",
    )
    .eq("romaneios.status", "EMITIDO")
    .eq("romaneios.order_id", orderId);
  if (excludeRomaneioId) {
    query = query.neq("romaneio_id", excludeRomaneioId);
  }
  const { data, error } = await query;
  assertOk(error, "Não foi possível calcular a expedição já emitida");

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
 * OFs candidatas a virar romaneio: não canceladas e com ao menos um
 * item raiz. A flag de simulação aberta sai dos romaneios embutidos.
 */
export async function listRomaneioCandidates(
  client: SupabaseServer,
  filters: RomaneioCandidateFilters,
): Promise<{ candidates: RomaneioCandidate[]; total: number }> {
  const applySearch = <T>(query: T): T => {
    const term = escapeFilterTerm(filters.search);
    if (!term) return query;
    return (
      query as unknown as { or: (filter: string) => unknown }
    ).or(`code.ilike.%${term}%,customer_name.ilike.%${term}%`) as T;
  };

  const pageQuery = applySearch(
    client
      .from("orders")
      .select(
        `id, code, type, customer_name, delivery_date, status,
         order_items!inner ( id, quantity, unit_weight_kg ),
         romaneios ( id, status )`,
      )
      .neq("status", "CANCELADO")
      .is("order_items.parent_order_item_id", null),
  );
  // O filtro .is("order_items.parent_order_item_id", null) é por path
  // embutido: o PostgREST só aceita se `order_items` estiver no select —
  // sem isso responde 400 PGRST108 (e em head+count a mensagem se perde
  // na resposta sem corpo). O !inner mantém "tem item raiz" como filtro
  // de existência e a contagem segue distinta por OF.
  const countQuery = applySearch(
    client
      .from("orders")
      .select("id, order_items!inner ( id )", { count: "exact", head: true })
      .neq("status", "CANCELADO")
      .is("order_items.parent_order_item_id", null),
  );

  const from = (filters.page - 1) * filters.pageSize;
  const [pageResult, countResult] = await Promise.all([
    pageQuery
      .order("delivery_date", { ascending: true, nullsFirst: false })
      .order("code", { ascending: true })
      .range(from, from + filters.pageSize - 1),
    countQuery,
  ]);

  assertOk(pageResult.error, "Não foi possível carregar as OFs");
  assertOk(countResult.error, "Não foi possível carregar as OFs");

  type CandidateRow = {
    id: string;
    code: string;
    type: OrderType;
    customer_name: string | null;
    delivery_date: string | null;
    status: OrderStatus;
    order_items: { quantity: number | string; unit_weight_kg: number | string | null }[];
    romaneios: { id: string; status: RomaneioStatus }[] | null;
  };

  const rows = (pageResult.data ?? []) as CandidateRow[];
  const orderIds = rows.map((row) => row.id);
  const shipped = orderIds.length > 0
    ? await listEmittedQuantityByOrderIds(client, orderIds)
    : new Map<string, number>();

  const candidates = rows.map((row): RomaneioCandidate => {
    let rootQuantity = 0;
    let rootWeightKg: number | null = 0;
    for (const item of row.order_items) {
      rootQuantity += toNumber(item.quantity) ?? 0;
      const unitWeight = toNumber(item.unit_weight_kg);
      if (unitWeight === null) {
        rootWeightKg = null;
      } else if (rootWeightKg !== null) {
        rootWeightKg += unitWeight * (toNumber(item.quantity) ?? 0);
      }
    }
    const simulation = (row.romaneios ?? []).find(
      (romaneio) => romaneio.status === "SIMULACAO",
    );
    return {
      orderId: row.id,
      code: row.code,
      type: row.type,
      customerName: row.customer_name,
      deliveryDate: row.delivery_date,
      status: row.status,
      rootQuantity,
      rootWeightKg,
      shippedQuantity: shipped.get(row.id) ?? 0,
      hasSimulation: simulation !== undefined,
      simulationId: simulation?.id ?? null,
    };
  });

  return { candidates, total: countResult.count ?? 0 };
}

/** Σ de quantidade expedida (EMITIDO) por OF para um conjunto de OFs. */
async function listEmittedQuantityByOrderIds(
  client: SupabaseServer,
  orderIds: string[],
): Promise<Map<string, number>> {
  const { data, error } = await client
    .from("romaneio_items")
    .select("quantity, romaneios!inner ( status, order_id )")
    .eq("romaneios.status", "EMITIDO")
    .in("romaneios.order_id", orderIds);
  assertOk(error, "Não foi possível calcular a expedição já emitida");

  // A quantidade emitida é do ITEM; para o seletor agregamos por OF via
  // lookup dos itens — aqui devolvemos o total geral por romaneio-OF.
  const totals = new Map<string, number>();
  for (const row of (data ?? []) as {
    quantity: number | string;
    romaneios: { order_id: string } | null;
  }[]) {
    const orderId = row.romaneios?.order_id;
    if (!orderId) continue;
    totals.set(orderId, (totals.get(orderId) ?? 0) + (toNumber(row.quantity) ?? 0));
  }
  return totals;
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

/** Cria/atualiza um romaneio em SIMULAÇÃO (cabeçalho+itens+materiais). */
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

/** Sinaliza o aceite da conferência (quem/quando/observação). */
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

/** Valida os gates de emissão e trava o romaneio (EMITIDO). */
export async function emitRomaneioRpc(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  const { error } = await client.rpc("emit_romaneio", { p_romaneio_id: romaneioId });
  assertOk(error, "Não foi possível emitir o romaneio");
}

/** Cancela o romaneio (bloqueado com NF de saída registrada). */
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
