import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  MpReceiptCustomerOption,
  MpReceiptHistoryEntry,
} from "@/lib/types/mp-receipt";
import {
  deleteMpReceiptRpc,
  listMpReceiptCustomers,
  listMpReceiptHistory,
  listMpReceiptItems,
  saveMpReceiptRpc,
  type MpReceiptHistoryRow,
  type MpReceiptItem,
} from "@/lib/repositories/mp-receipt.repository";
import { toNumber } from "@/lib/utils/formatting";

/** Clientes com OFs que ainda têm pendência de MP (seletor em cascata). */
export async function getMpReceiptCustomers(
  client: SupabaseServer,
): Promise<MpReceiptCustomerOption[]> {
  return listMpReceiptCustomers(client);
}

/** Linhas elegíveis de uma OF para a tela de recebimento (057). */
export async function getMpReceiptItems(
  client: SupabaseServer,
  orderId: string,
): Promise<MpReceiptItem[]> {
  return listMpReceiptItems(client, orderId);
}

/** Histórico de recebimentos de uma OF (nº, data, usuário e itens em kg). */
export async function getMpReceiptHistory(
  client: SupabaseServer,
  orderId: string,
): Promise<MpReceiptHistoryEntry[]> {
  const rows = await listMpReceiptHistory(client, orderId);
  return rows.map(mapHistoryRow);
}

function mapHistoryRow(row: MpReceiptHistoryRow): MpReceiptHistoryEntry {
  return {
    id: row.id,
    number: toNumber(row.number) ?? 0,
    receiptDate: row.receipt_date,
    notes: row.notes,
    createdAt: row.created_at,
    userName: row.profiles?.name ?? null,
    items: (row.mp_receipt_items ?? []).map((item) => ({
      orderItemId: item.order_item_id,
      description: item.order_items?.description ?? null,
      quantityKg: toNumber(item.quantity_kg) ?? 0,
    })),
  };
}

/** Registra um recebimento de MP (RPC transacional — 056). */
export async function saveMpReceipt(
  client: SupabaseServer,
  input: {
    orderId: string;
    notes: string | null;
    items: { orderItemId: string; quantityKg: number }[];
  },
): Promise<{ id: string; number: number }> {
  return saveMpReceiptRpc(client, input);
}

/** Exclui um recebimento para correção (recalcula o espelho no banco). */
export async function deleteMpReceipt(
  client: SupabaseServer,
  receiptId: string,
): Promise<void> {
  return deleteMpReceiptRpc(client, receiptId);
}
