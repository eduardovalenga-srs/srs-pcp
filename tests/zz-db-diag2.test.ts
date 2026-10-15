import { it } from "vitest";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const text = readFileSync(".env.local", "utf8");
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  return (match?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}

it("diagnóstico 2 (somente leitura): RLS real + catálogo de processos", async () => {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T | null> => {
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      console.log(`rpc(${name}) ERRO:`, error.message);
      return null;
    }
    return data as T;
  };

  // 1) Políticas RLS REALMENTE aplicadas em order_item_materials / order_items.
  const policies = await admin.rpc("exec_sql_readonly", {
    query: "select 1",
  }).then(() => null as never).catch(() => null as never);
  void policies;

  const { data: policyRows, error: policyError } = await admin
    .from("pg_policy")
    .select("*")
    .limit(1);
  console.log("pg_policy via PostgREST:", policyError?.message ?? "ok");

  // pg_catalog não é exposto via PostgREST; usa uma função SQL se existir.
  // Alternativa: information_schema também não. -> tenta rpc custom inexistente sem crashar.
  void rpc;

  // 2) Catálogo de processos (PostgREST é suficiente aqui).
  const { data: processes, error: procError } = await admin
    .from("processes")
    .select("code, name, active, display_order")
    .order("display_order");
  console.log("PROCESSOS:", JSON.stringify(processes), procError?.message);

  // 3) Processes da OF 106073: pais e filhos.
  const { data: order } = await admin
    .from("orders")
    .select("id, code")
    .eq("code", "OF 106073")
    .maybeSingle();

  if (order) {
    const { data: items } = await admin
      .from("order_items")
      .select(
        "id, parent_item, parent_order_item_id, production_processes ( status, quantity_planned, quantity_completed, processes ( code ) )",
      )
      .eq("order_id", order.id);

    const parents = (items ?? []).filter((item) => !item.parent_order_item_id);
    const children = (items ?? []).filter((item) => item.parent_order_item_id);

    const pp = (item: (typeof parents)[number]): { processes: { code: string } | null; status: string }[] =>
      (item as unknown as { production_processes: { processes: { code: string } | null; status: string }[] }).production_processes ?? [];

    for (const parent of parents) {
      const codes = pp(parent).map((entry) => `${entry.processes?.code}:${entry.status}`);
      console.log(
        `PAI ${(parent as unknown as { parent_item: string | null }).parent_item}: ${codes.length} processos -> ${codes.join(", ")}`,
      );
    }
    const childSample = children.slice(0, 3);
    for (const child of childSample) {
      const codes = pp(child).map((entry) => `${entry.processes?.code}:${entry.status}`);
      console.log(
        `FILHO ${(child as unknown as { parent_item: string | null }).parent_item}: ${codes.length} processos -> ${codes.join(", ")}`,
      );
    }

    const childrenWithoutMp = children.filter(
      (child) => !pp(child).some((entry) => entry.processes?.code === "MP"),
    );
    const parentsWithoutMp = parents.filter(
      (parent) => !pp(parent).some((entry) => entry.processes?.code === "MP"),
    );
    console.log(
      `MP ausente: pais=${parentsWithoutMp.length}/${parents.length} filhos=${childrenWithoutMp.length}/${children.length}`,
    );
  } else {
    console.log("OF 106073 não encontrada");
  }
}, 60_000);
