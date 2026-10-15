import { it } from "vitest";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

it("diagnóstico 3: query EXATA da Fábrica 1 (order-items.repository)", async () => {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // pageColumns com materialEmbed = "order_item_materials" (sem filtros).
  const pageColumns = `id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg, delivery_date, status,
   orders!inner ( id, code, customer_name, delivery_date ),
   production_processes ( id, status, quantity_planned, quantity_completed, notes, processes ( code, name, display_order ) ),
   order_item_materials ( id, description, quantity, unit, notes )`;

  const { data, error, count } = await admin
    .from("order_items")
    .select(pageColumns, { count: "exact" })
    .not("parent_order_item_id", "is", null)
    .order("delivery_date", { ascending: true, nullsFirst: false })
    .order("parent_item", { ascending: true, nullsFirst: true })
    .order("description", { ascending: true })
    .order("id", { ascending: true })
    .range(0, 49);

  if (error) {
    console.log("ERRO na query:", error.message, JSON.stringify(error.details ?? {}));
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as {
    parent_item: string | null;
    order_item_materials: { description: string; quantity: number | string; unit: string }[];
  }[];

  const semMaterial = rows.filter((row) => (row.order_item_materials ?? []).length === 0);
  console.log(`linhas=${rows.length} count=${count} sem_material=${semMaterial.length}`);
  for (const row of rows.slice(0, 5)) {
    console.log(
      `  ${row.parent_item}: ${JSON.stringify(row.order_item_materials)}`,
    );
  }
  if (semMaterial.length > 0) {
    console.log("FILHOS SEM MATERIAL:", semMaterial.map((row) => row.parent_item).join(", "));
  }

  // Consulta dos pais (como o repo faz em seguida).
  const parentIds = [
    ...new Set(
      ((data ?? []) as unknown as { parent_order_item_id: string | null }[])
        .map((row) => row.parent_order_item_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: parents, error: parentsError } = await admin
    .from("order_items")
    .select("id, parent_item, description, production_processes ( status, processes ( code ) )")
    .in("id", parentIds);
  console.log(
    `pais=${(parents ?? []).length}/${parentIds.length}`,
    parentsError?.message ?? "",
  );
  const pai0 = (parents ?? [])[0] as unknown as
    | { parent_item: string | null; production_processes: { status: string; processes: { code: string } }[] }
    | undefined;
  if (pai0) {
    const mp = pai0.production_processes.find((entry) => entry.processes.code === "MP");
    console.log(`  pai ${pai0.parent_item} -> MP=${mp?.status ?? "AUSENTE"}`);
  }
}, 60_000);
