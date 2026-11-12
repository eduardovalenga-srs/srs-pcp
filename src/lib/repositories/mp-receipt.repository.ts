import type { SupabaseServer } from "@/lib/supabase/types";
import type { Json, MpReceiptCustomerRow } from "@/lib/types/database";
import type {
  MpReceiptCustomerOption,
  MpReceiptOfOption,
} from "@/lib/types/mp-receipt";
import { assertOk } from "@/lib/utils/supabase-result";

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Seletor em cascata de /recebimento-mp: clientes com OFs que ainda
 * têm pendência de MP (RPC `get_mp_receipt_customers`, 056/059). Cliente
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
        pendingMaterials: toNumber(of.pending_materials) ?? 0,
        pendingKg: toNumber(of.pending_kg),
      }),
    ),
  }));
}

/**
 * MATÉRIAS-PRIMAS de uma OF para a tela de recebimento (059): uma linha
 * por material, com o peso total (soma dos itens que o consomem), o já
 * recebido (todas as notas de entrada) e o saldo.
 *
 * Toda a agregação acontece NO BANCO (`mp_order_materials`): o app não
 * recalcula peso — ele lê o que o Postgres derivou.
 */
export async function listMpReceiptMaterials(
  client: SupabaseServer,
  orderId: string,
): Promise<
  {
    materialKey: string;
    description: string;
    unit: string;
    totalKg: number;
    receivedKg: number;
    balanceKg: number;
  }[]
> {
  const { data, error } = await client.rpc("mp_order_materials", {
    p_order_id: orderId,
  });
  assertOk(error, "Não foi possível carregar as matérias-primas da OF");

  return (data ?? []).map((row) => ({
    materialKey: row.material_key as string,
    description: row.description as string,
    unit: row.unit as string,
    totalKg: toNumber(row.need_kg) ?? 0,
    receivedKg: toNumber(row.received_kg) ?? 0,
    balanceKg: toNumber(row.balance_kg) ?? 0,
  }));
}

/** Linha bruta de `mp_receipts` com cabeçalho e materiais embutidos (059). */
export interface MpReceiptHistoryRow {
  id: string;
  number: number | string;
  entry_number: string | null;
  entry_date: string | null;
  notes: string | null;
  created_at: string;
  profiles: { name: string | null } | null;
  mp_receipt_materials:
    | {
        material_key: string;
        material_description: string;
        material_unit: string;
        quantity_kg: number | string;
      }[]
    | null;
}

/**
 * Histórico de NOTAS DE ENTRADA de uma OF (nº digitado, data, usuário +
 * materiais em kg), do mais recente para o mais antigo.
 */
export async function listMpReceiptHistory(
  client: SupabaseServer,
  orderId: string,
): Promise<MpReceiptHistoryRow[]> {
  const { data, error } = await client
    .from("mp_receipts")
    .select(
      `id, number, entry_number, entry_date, notes, created_at,
       profiles ( name ),
       mp_receipt_materials ( material_key, material_description, material_unit, quantity_kg )`,
    )
    .eq("order_id", orderId)
    .order("number", { ascending: false });

  assertOk(error, "Não foi possível carregar o histórico de recebimentos");
  return (data ?? []) as unknown as MpReceiptHistoryRow[];
}

/** Grava uma NOTA DE ENTRADA (RPC transacional — 059). */
export async function saveMpReceiptRpc(
  client: SupabaseServer,
  input: {
    orderId: string;
    entryNumber: string;
    entryDate: string | null;
    notes: string | null;
    materials: {
      materialKey: string;
      description: string;
      unit: string;
      quantityKg: number;
    }[];
  },
): Promise<{ id: string; number: number }> {
  const { data, error } = await client.rpc("save_mp_receipt", {
    p_order_id: input.orderId,
    p_entry_number: input.entryNumber,
    p_entry_date: input.entryDate,
    p_notes: input.notes,
    p_materials: input.materials as unknown as Json,
  });
  assertOk(error, "Não foi possível registrar a nota de entrada");
  const payload = data as { id?: string; number?: number } | null;
  if (!payload?.id) throw new Error("Não foi possível registrar a nota de entrada.");
  return { id: payload.id, number: Number(payload.number ?? 0) };
}

/** Exclui uma nota de entrada (a RPC recalcula o espelho). */
export async function deleteMpReceiptRpc(
  client: SupabaseServer,
  receiptId: string,
): Promise<void> {
  const { error } = await client.rpc("delete_mp_receipt", { p_receipt_id: receiptId });
  assertOk(error, "Não foi possível excluir a nota de entrada");
}
