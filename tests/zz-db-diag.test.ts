import { it } from "vitest";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

type MaterialRow = { id: string; description: string }[];

it("diagnóstico (somente leitura): materiais nas OFs importadas", async () => {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: batches, error: batchesError } = await admin
    .from("import_batches")
    .select("id, file_name, status, total_rows, valid_rows, error_rows, created_at")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("LOTES:", JSON.stringify(batches, null, 1), batchesError?.message);

  const { data: orders } = await admin
    .from("orders")
    .select("id, code, created_at")
    .order("created_at", { ascending: false })
    .limit(6);

  for (const order of orders ?? []) {
    // Mesmo embed da Fábrica 1 (PostgREST real).
    const { data: items } = await admin
      .from("order_items")
      .select("id, parent_item, parent_order_item_id, order_item_materials ( id, description )")
      .eq("order_id", order.id);

    const parents = (items ?? []).filter((item) => !item.parent_order_item_id);
    const children = (items ?? []).filter((item) => item.parent_order_item_id);
    const childrenWithMaterials = children.filter(
      (child) => ((child.order_item_materials as unknown as MaterialRow) ?? []).length > 0,
    );

    // Cross-check: consulta direta na tabela (sem embed).
    const ids = (items ?? []).map((item) => item.id);
    let directCount = 0;
    if (ids.length > 0) {
      const { count } = await admin
        .from("order_item_materials")
        .select("id", { count: "exact", head: true })
        .in("order_item_id", ids);
      directCount = count ?? 0;
    }

    console.log(
      `OF ${order.code} (criada ${order.created_at}): pais=${parents.length} filhos=${children.length} ` +
        `filhos_com_material(embed)=${childrenWithMaterials.length} materiais_totais(consulta_direta)=${directCount}`,
    );
    if (parents.length > 0) {
      const pai0 = parents[0] as unknown as { order_item_materials: MaterialRow; parent_item: string | null };
      console.log(`  exemplo pai ${pai0.parent_item}: materiais=${JSON.stringify(pai0.order_item_materials)}`);
    }
    if (children.length > 0) {
      const filho0 = children[0] as unknown as { order_item_materials: MaterialRow; parent_item: string | null };
      console.log(`  exemplo filho ${filho0.parent_item}: materiais=${JSON.stringify(filho0.order_item_materials)}`);
    }
  }
}, 60_000);
