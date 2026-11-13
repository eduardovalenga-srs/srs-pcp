import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let adminId: string;

beforeAll(async () => {
  const testDb = await createTestDatabase();
  db = testDb.db;
  close = testDb.close;
  adminId = await createUser(db, "product-groups-admin@example.com", "ADMIN");
});

afterAll(async () => {
  await close();
});

async function capacitiesForAllProcesses() {
  const { rows } = await db.query<{ id: string; location: string }>(
    "select id, location from public.processes order by display_order",
  );
  return rows.map((process) => ({
    factory: process.location,
    processId: process.id,
    unit: "UNIDADES",
    capacity: 10,
  }));
}

describe("migration 068 — grupos de produto", () => {
  it("mapeia o catálogo atual às fábricas e cria código autoincremental", async () => {
    await asUser(db, "authenticated", adminId);
    const capacities = await capacitiesForAllProcesses();
    const { rows } = await db.query<{ id: number; group_type: string }>(
      `select * from public.save_product_group($1, $2, $3, $4::jsonb)`,
      [null, "Estruturas metálicas", "EST", JSON.stringify(capacities)],
    );

    expect(rows[0]?.id).toBe(1);
    expect(rows[0]?.group_type).toBe("1-EST");
    const { rows: saved } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.product_group_process_capacities where product_group_id = $1",
      [rows[0]?.id],
    );
    expect(saved[0]?.count).toBe(capacities.length);
  });

  it("rejeita abreviação duplicada e não deixa alterações parciais", async () => {
    const capacities = await capacitiesForAllProcesses();
    await expect(
      db.query(
        `select * from public.save_product_group($1, $2, $3, $4::jsonb)`,
        [null, "Outra família", "EST", JSON.stringify(capacities)],
      ),
    ).rejects.toThrow(/product_groups_family_abbreviation_unique|duplicate key/i);

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.product_groups",
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("salva vários itens em matrizes e mantém intactas as capacidades legadas", async () => {
    const capacities = await capacitiesForAllProcesses();
    const items = [
      { description: "Coluna lateral", capacities },
      {
        description: "Travessa superior",
        capacities: capacities.map((capacity) => ({ ...capacity, capacity: 20 })),
      },
    ];

    const { rows } = await db.query<{ id: number; group_type: string }>(
      `select * from public.save_product_group_with_items($1, $2, $3, $4::jsonb)`,
      [1, "Estruturas metálicas", "EST", JSON.stringify(items)],
    );
    expect(rows[0]?.group_type).toBe("1-EST");

    const { rows: itemRows } = await db.query<{ description: string }>(
      "select description from public.product_group_items where product_group_id = 1 order by description",
    );
    expect(itemRows.map((row) => row.description)).toEqual(["Coluna lateral", "Travessa superior"]);

    const { rows: capacitiesSaved } = await db.query<{ count: number; total: number }>(
      `select count(*)::int as count, sum(c.capacity)::int as total
         from public.product_group_item_process_capacities c
         join public.product_group_items i on i.id = c.product_group_item_id
        where i.product_group_id = 1`,
    );
    expect(capacitiesSaved[0]?.count).toBe(capacities.length * 2);

    const { rows: legacy } = await db.query<{ count: number; total: number }>(
      `select count(*)::int as count, sum(capacity)::int as total
         from public.product_group_process_capacities
        where product_group_id = 1`,
    );
    expect(legacy[0]?.count).toBe(capacities.length);
    expect(legacy[0]?.total).toBe(capacities.length * 10);
  });

  it("realoca automaticamente as capacidades quando o processo muda de fábrica", async () => {
    const { rows: laser } = await db.query<{ id: string }>(
      "select id from public.processes where code = 'LASER'",
    );
    const processId = laser[0]?.id;
    await db.query("update public.processes set location = 'Fábrica 2' where id = $1", [processId]);

    const { rows: capacity } = await db.query<{ factory: string }>(
      `select factory from public.product_group_process_capacities
        where product_group_id = 1 and process_id = $1`,
      [processId],
    );
    expect(capacity[0]?.factory).toBe("Fábrica 2");

    const { rows: itemCapacity } = await db.query<{ factory: string }>(
      `select c.factory
         from public.product_group_item_process_capacities c
         join public.product_group_items i on i.id = c.product_group_item_id
        where i.product_group_id = 1 and c.process_id = $1`,
      [processId],
    );
    expect(itemCapacity).toHaveLength(2);
    expect(itemCapacity.every((row) => row.factory === "Fábrica 2")).toBe(true);
  });

  it("RLS impede que um gestor execute a gravação de itens", async () => {
    await asSuperUser(db);
    const gestorId = await createUser(db, "product-groups-gestor@example.com", "GESTOR");
    await asUser(db, "authenticated", gestorId);
    await expect(
      db.query(
        `select * from public.save_product_group_with_items($1, $2, $3, $4::jsonb)`,
        [
          null,
          "Família bloqueada",
          "BLQ",
          JSON.stringify([{ description: "Item bloqueado", capacities: await capacitiesForAllProcesses() }]),
        ],
      ),
    ).rejects.toThrow(/permissão|row-level security/i);
  });
});
