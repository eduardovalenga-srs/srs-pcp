import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  MpReceiptCustomerOption,
  MpReceiptDetail,
  MpReceiptFreeItem,
  MpReceiptHistoryEntry,
  MpReceiptListEntry,
  MpReceiptMaterial,
} from "@/lib/types/mp-receipt";
import {
  deleteMpReceiptRpc,
  getMpReceiptEntryById,
  listMpReceiptEntries,
  listMpReceiptCustomers,
  listMpReceiptMaterials,
  saveMpReceiptRpc,
  type MpReceiptHistoryRow,
} from "@/lib/repositories/mp-receipt.repository";
import { toNumber } from "@/lib/utils/formatting";

/** Clientes com OFs que ainda têm pendência de MP (seletor em cascata). */
export async function getMpReceiptCustomers(
  client: SupabaseServer,
): Promise<MpReceiptCustomerOption[]> {
  return listMpReceiptCustomers(client);
}

/** Matérias-primas de uma OF para a tela de recebimento (059). */
export async function getMpReceiptMaterials(
  client: SupabaseServer,
  orderId: string,
): Promise<MpReceiptMaterial[]> {
  const rows = await listMpReceiptMaterials(client, orderId);
  return rows.map((row) => ({
    materialKey: row.materialKey,
    description: row.description,
    unit: row.unit,
    totalKg: row.totalKg,
    receivedKg: row.receivedKg,
    balanceKg: row.balanceKg,
  }));
}

/** Lista geral de todos os recebimentos cadastrados. */
export async function getMpReceiptEntries(
  client: SupabaseServer,
): Promise<MpReceiptListEntry[]> {
  const rows = await listMpReceiptEntries(client);
  return rows.map((row) => ({
    id: row.id,
    number: toNumber(row.number) ?? 0,
    entryNumber: row.entry_number ?? "",
    entryDate: row.entry_date,
    userName: row.profiles?.name ?? null,
    orderCode: row.orders?.code ?? null,
    customerName: row.orders?.customer_name ?? null,
    materials: (row.mp_receipt_materials ?? []).map((material) => ({
      materialKey: material.material_key,
      description: material.material_description,
      unit: material.material_unit,
      quantityKg: toNumber(material.quantity_kg) ?? 0,
    })),
  }));
}

/** Dados completos de uma nota de entrada para a tela de consulta. */
export async function getMpReceiptEntry(
  client: SupabaseServer,
  receiptId: string,
): Promise<MpReceiptDetail | null> {
  const row = await getMpReceiptEntryById(client, receiptId);
  if (!row) return null;

  return {
    ...mapHistoryRow(row),
    orderId: row.order_id,
    orderCode: row.orders?.code ?? null,
    customerName: row.orders?.customer_name ?? null,
  };
}

function mapHistoryRow(row: MpReceiptHistoryRow): MpReceiptHistoryEntry {
  return {
    id: row.id,
    number: toNumber(row.number) ?? 0,
    entryNumber: row.entry_number ?? "",
    entryDate: row.entry_date,
    notes: row.notes,
    createdAt: row.created_at,
    userName: row.profiles?.name ?? null,
    materials: (row.mp_receipt_materials ?? []).map((material) => ({
      materialKey: material.material_key,
      description: material.material_description,
      unit: material.material_unit,
      quantityKg: toNumber(material.quantity_kg) ?? 0,
    })),
    freeItems: (row.mp_receipt_free_items ?? []).map((item) => ({
      description: item.description,
      unit: item.unit,
      quantity: toNumber(item.quantity) ?? 0,
    })),
  };
}

/** Registra uma NOTA DE ENTRADA (RPC transacional — 059/060). */
export async function saveMpReceipt(
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
    freeItems: MpReceiptFreeItem[];
  },
): Promise<{ id: string; number: number }> {
  return saveMpReceiptRpc(client, input);
}

/** Exclui uma nota de entrada (recalcula o espelho no banco). */
export async function deleteMpReceipt(
  client: SupabaseServer,
  receiptId: string,
): Promise<void> {
  return deleteMpReceiptRpc(client, receiptId);
}
