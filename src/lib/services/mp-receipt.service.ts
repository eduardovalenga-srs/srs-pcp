import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  MpReceiptCustomerOption,
  MpReceiptHistoryEntry,
  MpReceiptMaterial,
} from "@/lib/types/mp-receipt";
import {
  deleteMpReceiptRpc,
  listMpReceiptCustomers,
  listMpReceiptHistory,
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

/** Histórico de NOTAS DE ENTRADA de uma OF (nº, data, usuário e materiais). */
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
  };
}

/** Registra uma NOTA DE ENTRADA (RPC transacional — 059). */
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
