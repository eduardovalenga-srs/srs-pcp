import type { Json } from "@/lib/types/database";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { MaterialValues } from "@/lib/validators/material.schema";
import { assertOk } from "@/lib/utils/supabase-result";

/**
 * Substitui a lista de matéria-prima de um sub-item (RPC 011).
 * Tudo em uma transação: apaga as linhas antigas e grava as novas.
 * Retorna o nº de linhas gravadas. RLS exige ADMIN/GESTOR.
 */
export async function replaceItemMaterials(
  client: SupabaseServer,
  orderItemId: string,
  materials: MaterialValues[],
): Promise<number> {
  const { data, error } = await client.rpc("replace_item_materials", {
    p_item_id: orderItemId,
    p_materials: materials as unknown as Json,
  });
  assertOk(error, "Não foi possível salvar os materiais");
  return Number(data ?? 0);
}
