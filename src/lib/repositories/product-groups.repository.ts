import type { SupabaseServer } from "@/lib/supabase/types";
import type { ImportProductGroup } from "@/lib/types/import";
import type {
  ProductGroupCapacityDefinition,
  ProductGroupDefinition,
  ProductGroupOption,
  ProductFactory,
} from "@/lib/types/product-group";
import type { ProductCapacityUnit } from "@/lib/validators/product-group.schema";
import { assertOk } from "@/lib/utils/supabase-result";

type JoinedCapacity = {
  id: string;
  product_group_id: number;
  factory: ProductFactory;
  process_id: string;
  unit: ProductCapacityUnit;
  capacity: number | string;
  processes: { code: string; name: string; display_order: number };
};

export async function getAllProductGroups(client: SupabaseServer): Promise<ProductGroupDefinition[]> {
  const [{ data: groups, error: groupsError }, { data: rawCapacities, error: capacitiesError }] =
    await Promise.all([
      client
        .from("product_groups")
        .select("id, family_description, family_abbreviation")
        .order("id", { ascending: true }),
      client
        .from("product_group_process_capacities")
        .select(
          "id, product_group_id, factory, process_id, unit, capacity, processes!inner(code, name, display_order)",
        )
        .order("factory", { ascending: true }),
    ]);

  assertOk(groupsError, "Não foi possível carregar os grupos de produtos");
  assertOk(capacitiesError, "Não foi possível carregar as capacidades dos grupos");

  const capacities = (rawCapacities ?? []) as unknown as JoinedCapacity[];
  const capacitiesByGroup = new Map<number, ProductGroupCapacityDefinition[]>();

  for (const capacity of capacities) {
    const rows = capacitiesByGroup.get(capacity.product_group_id) ?? [];
    rows.push({
      id: capacity.id,
      factory: capacity.factory,
      processId: capacity.process_id,
      processCode: capacity.processes.code,
      processName: capacity.processes.name,
      processDisplayOrder: capacity.processes.display_order,
      unit: capacity.unit,
      capacity: Number(capacity.capacity),
    });
    capacitiesByGroup.set(capacity.product_group_id, rows);
  }

  return (groups ?? []).map((group) => ({
    id: group.id,
    familyDescription: group.family_description,
    familyAbbreviation: group.family_abbreviation,
    groupType: `${group.id}-${group.family_abbreviation}`,
    capacities: (capacitiesByGroup.get(group.id) ?? []).sort(
      (a, b) =>
        a.factory.localeCompare(b.factory) ||
        a.processDisplayOrder - b.processDisplayOrder ||
        a.unit.localeCompare(b.unit),
    ),
  }));
}

/**
 * Famílias cadastradas para seleção em formulários (sem capacidades).
 * Usada na edição da OF e em qualquer tela que só precisa exibir o rótulo.
 */
export async function listProductGroupOptions(
  client: SupabaseServer,
): Promise<ProductGroupOption[]> {
  const { data, error } = await client
    .from("product_groups")
    .select("id, family_description, family_abbreviation")
    .order("family_description", { ascending: true });

  assertOk(error, "Não foi possível carregar as famílias de produto");

  return (data ?? []).map((group) => ({
    id: group.id,
    familyDescription: group.family_description,
    familyAbbreviation: group.family_abbreviation,
    groupType: `${group.id}-${group.family_abbreviation}`,
  }));
}

/** Grupo usado pela importação (validação no servidor + rótulo da prévia). */
export async function getProductGroupById(
  client: SupabaseServer,
  id: number,
): Promise<ImportProductGroup | null> {
  const { data, error } = await client
    .from("product_groups")
    .select("id, family_description, family_abbreviation")
    .eq("id", id)
    .maybeSingle();

  assertOk(error, "Não foi possível verificar a família selecionada");
  if (!data) return null;

  return {
    id: data.id,
    familyDescription: data.family_description,
    familyAbbreviation: data.family_abbreviation,
    groupType: `${data.id}-${data.family_abbreviation}`,
  };
}

export async function saveProductGroup(
  client: SupabaseServer,
  input: {
    id: number | null;
    familyDescription: string;
    familyAbbreviation: string;
    capacities: {
      factory: ProductFactory;
      processId: string;
      unit: ProductCapacityUnit;
      capacity: number;
    }[];
  },
): Promise<{ id: number; groupType: string }> {
  const { data, error } = await client.rpc("save_product_group", {
    p_group_id: input.id,
    p_family_description: input.familyDescription,
    p_family_abbreviation: input.familyAbbreviation,
    p_capacities: input.capacities,
  });

  assertOk(error, "Não foi possível salvar o grupo de produtos");
  const saved = data?.[0];
  if (!saved) throw new Error("O banco não retornou o grupo salvo.");
  return { id: saved.id, groupType: saved.group_type };
}

/** Exclui o grupo; capacidades/itens saem por cascade e as OFs ficam sem família. */
export async function deleteProductGroup(client: SupabaseServer, id: number): Promise<void> {
  const { error } = await client.rpc("delete_product_group", { p_group_id: id });
  assertOk(error, "Não foi possível excluir o grupo de produtos");
}
