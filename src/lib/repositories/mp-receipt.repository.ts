import type { SupabaseServer } from "@/lib/supabase/types";
import type { OrderItemMaterial } from "@/lib/types/order";
import type { MpReceiptCustomerRow } from "@/lib/types/database";
import type {
  MpReceiptCustomerOption,
  MpReceiptOfOption,
  MpReceiptState,
} from "@/lib/types/mp-receipt";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Seletor em cascata de /recebimento-mp: clientes com OFs que ainda
 * têm pendência de MP (RPC `get_mp_receipt_customers`, 056). Cliente
 * vazio vira um bucket único com `customerName: null`.
 */
export async function listMpReceiptCustomers(
  client: SupabaseServer,
): Promise<MpReceiptCustomerOption[]> {
  const { data, error } = await client.rpc("get_mp_receipt_customers");
  assertOk(error, "Não foi possível carregar os clientes");

  return ((data ?? []) as MpReceiptCustomerRow[]).map((row) => ({
    customerName: row.customer_name || null,
    ofCount: toNumber(row.of_count) ?? 0,
    ofs: (row.ofs ?? []).map(
      (of): MpReceiptOfOption => ({
        orderId: of.order_id,
        code: of.code,
        type: of.type as MpReceiptOfOption["type"],
        deliveryDate: of.delivery_date,
        status: of.status as MpReceiptOfOption["status"],
        pendingItems: toNumber(of.pending_items) ?? 0,
        pendingKg: toNumber(of.pending_kg),
      }),
    ),
  }));
}

/** Linha bruta de item da OF com os recibos embutidos (056/057). */
interface RawMpItem {
  id: string;
  parent_order_item_id: string | null;
  /** Código do item (coluna `parent_item` — nome histórico da coluna). */
  parent_item: string | null;
  description: string;
  quantity: number | string;
  unit_weight_kg: number | string | null;
  total_weight_kg: number | string | null;
  mp_receipt_items: { quantity_kg: number | string }[] | null;
  order_item_materials: {
    id: string;
    description: string;
    quantity: number | string;
    unit: string;
    notes: string | null;
  }[] | null;
}

/**
 * Linha da tela de recebimento (057): item FILHO da OF — o componente
 * que concentra a matéria-prima que compõe o pai — ou o pai SEM filhos
 * (material direto no pai), já com o espelho calculado.
 */
export interface MpReceiptItem {
  orderItemId: string;
  /** Código do próprio item (coluna `parent_item`). */
  code: string | null;
  /** Rótulo do item PAI (código, senão descrição) — null no pai sem filhos. */
  parentLabel: string | null;
  description: string;
  quantity: number;
  unitWeightKg: number | null;
  /** Peso planejado (total_weight_kg com fallback qtd × peso un.). */
  plannedKg: number | null;
  /** Σ dos kg já recebidos em recibos anteriores. */
  receivedKg: number;
  state: MpReceiptState;
  /** Kg que ainda falta receber (null = sem peso cadastrado). */
  pendingKg: number | null;
  /** Matéria-prima do item (`order_item_materials`) — coluna da Fábrica 1. */
  materials: OrderItemMaterial[];
}

/** Rótulo de um item: código (`parent_item`) com fallback na descrição. */
function itemLabel(row: RawMpItem): string {
  const code = row.parent_item?.trim();
  return code ? code : row.description;
}

/**
 * Linhas elegíveis de uma OF para a tela de recebimento (057): todos
 * os ITENS FILHOS + os itens pai SEM filhos (material direto no pai).
 * O pai que tem filho sai da lista — o lançamento é no filho e o
 * espelho do pai vira o agregado (RPC `mp_receipt_sync_parent`).
 * Peso planejado, Σ já recebido e situação seguem a regra do
 * `mp_item_state` (056), por item.
 */
export async function listMpReceiptItems(
  client: SupabaseServer,
  orderId: string,
): Promise<MpReceiptItem[]> {
  const { data, error } = await client
    .from("order_items")
    .select(
      `id, parent_order_item_id, parent_item, description, quantity,
       unit_weight_kg, total_weight_kg,
       mp_receipt_items ( quantity_kg ),
       order_item_materials ( id, description, quantity, unit, notes )`,
    )
    .eq("order_id", orderId);

  assertOk(error, "Não foi possível carregar os itens da OF");

  const rows = (data ?? []) as unknown as RawMpItem[];
  // Ids de itens que têm pai — logo, os pais com filho ficam de fora.
  const parentIds = new Set(
    rows
      .filter((row) => row.parent_order_item_id !== null)
      .map((row) => row.parent_order_item_id as string),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  return rows
    .filter((row) => row.parent_order_item_id !== null || !parentIds.has(row.id))
    .map((row) => {
      const quantity = toNumber(row.quantity) ?? 0;
      const unitWeightKg = toNumber(row.unit_weight_kg);
      const totalWeightKg = toNumber(row.total_weight_kg);
      const plannedRaw = totalWeightKg ?? (unitWeightKg !== null ? quantity * unitWeightKg : null);
      // Sem peso (ou peso 0) = planejado null — mesma regra da migração.
      const plannedKg = plannedRaw !== null && plannedRaw > 0 ? plannedRaw : null;
      const receivedKg = (row.mp_receipt_items ?? []).reduce(
        (total, receipt) => total + (toNumber(receipt.quantity_kg) ?? 0),
        0,
      );

      let state: MpReceiptState = "NONE";
      if (receivedKg > 0) {
        state = plannedKg === null || receivedKg >= plannedKg ? "TOTAL" : "PARCIAL";
      }

      const parent = row.parent_order_item_id ? byId.get(row.parent_order_item_id) : null;

      return {
        orderItemId: row.id,
        code: row.parent_item?.trim() || null,
        parentLabel: parent ? itemLabel(parent) : null,
        description: row.description,
        quantity,
        unitWeightKg,
        plannedKg,
        receivedKg,
        state,
        pendingKg:
          state === "TOTAL" ? 0 : plannedKg !== null ? Math.max(plannedKg - receivedKg, 0) : null,
        materials: (row.order_item_materials ?? []).map((material) => ({
          id: material.id,
          description: material.description,
          quantity: toNumber(material.quantity) ?? 0,
          unit: material.unit,
          notes: material.notes ?? null,
        })),
      };
    })
    .sort((left, right) => {
      const byParent = (left.parentLabel ?? "").localeCompare(right.parentLabel ?? "");
      if (byParent !== 0) return byParent;
      const byChild = (left.code ?? left.description).localeCompare(
        right.code ?? right.description,
      );
      if (byChild !== 0) return byChild;
      return left.orderItemId.localeCompare(right.orderItemId);
    });
}

/** Linha bruta de `mp_receipts` com cabeçalho e itens embutidos (056). */
export interface MpReceiptHistoryRow {
  id: string;
  number: number | string;
  receipt_date: string | null;
  notes: string | null;
  created_at: string;
  profiles: { name: string | null } | null;
  mp_receipt_items:
    | {
        order_item_id: string;
        quantity_kg: number | string;
        order_items: { description: string } | null;
      }[]
    | null;
}

/**
 * Histórico de recebimentos de uma OF (cabeçalho com nº, data,
 * usuário + itens em kg), do mais recente para o mais antigo.
 */
export async function listMpReceiptHistory(
  client: SupabaseServer,
  orderId: string,
): Promise<MpReceiptHistoryRow[]> {
  const { data, error } = await client
    .from("mp_receipts")
    .select(
      `id, number, receipt_date, notes, created_at,
       profiles ( name ),
       mp_receipt_items ( order_item_id, quantity_kg, order_items ( description ) )`,
    )
    .eq("order_id", orderId)
    .order("number", { ascending: false });

  assertOk(error, "Não foi possível carregar o histórico de recebimentos");
  return (data ?? []) as unknown as MpReceiptHistoryRow[];
}

/** Cria um recebimento (RPC transacional — 056). */
export async function saveMpReceiptRpc(
  client: SupabaseServer,
  input: {
    orderId: string;
    notes: string | null;
    items: { orderItemId: string; quantityKg: number }[];
  },
): Promise<{ id: string; number: number }> {
  const { data, error } = await client.rpc("save_mp_receipt", {
    p_order_id: input.orderId,
    p_notes: input.notes,
    p_items: input.items,
  });
  assertOk(error, "Não foi possível registrar o recebimento");
  const payload = data as { id?: string; number?: number } | null;
  if (!payload?.id) throw new Error("Não foi possível registrar o recebimento.");
  return { id: payload.id, number: Number(payload.number ?? 0) };
}

/** Exclui um recebimento para correção (a RPC recalcula o espelho). */
export async function deleteMpReceiptRpc(
  client: SupabaseServer,
  receiptId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_mp_receipt", { p_receipt_id: receiptId });
  assertOk(error, "Não foi possível excluir o recebimento");
}
