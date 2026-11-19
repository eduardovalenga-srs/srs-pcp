import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let adminId: string;
let expProcessId: string;
let kitProcessId: string;

interface VisibilityOrder {
  orderId: string;
  rootId: string;
  childIds: string[];
}

async function createOrder(
  code: string,
  seq: number,
  quantity: number,
  expStatus: string,
  kitStatuses: string[],
): Promise<VisibilityOrder> {
  await asSuperUser(db);
  const { rows: orderRows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, delivery_date, status)
     values ($1, 'OF', 'Cliente Teste', '2026-12-01', 'EM_PRODUCAO')
     returning id`,
    [code],
  );
  const orderId = orderRows[0]?.id as string;
  const { rows: rootRows } = await db.query<{ id: string }>(
    `insert into public.order_items
       (order_id, family, parent_item, description, quantity, unit_weight_kg, status, seq)
     values ($1, 'ESTRUTURA', $2, $2, $3, 10, 'EM_PRODUCAO', $4)
     returning id`,
    [orderId, `${code}-ROOT`, quantity, seq],
  );
  const rootId = rootRows[0]?.id as string;
  await db.query(
    `insert into public.production_processes (order_item_id, process_id, status)
     values ($1, $2, $3)`,
    [rootId, expProcessId, expStatus],
  );

  const childIds: string[] = [];
  for (const [index, status] of kitStatuses.entries()) {
    const { rows: childRows } = await db.query<{ id: string }>(
      `insert into public.order_items
         (order_id, family, parent_item, description, quantity, unit_weight_kg,
          status, parent_order_item_id, seq)
       values ($1, 'ESTRUTURA', $2, $3, $4, 10, 'EM_PRODUCAO', $5, $6)
       returning id`,
      [orderId, `${code}-ROOT`, `${code}-CHILD-${index + 1}`, quantity, rootId, seq],
    );
    const childId = childRows[0]?.id as string;
    childIds.push(childId);
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, $3)`,
      [childId, kitProcessId, status],
    );
  }

  return { orderId, rootId, childIds };
}

async function childGroups(orderCode: string): Promise<number> {
  await asSuperUser(db);
  const { rows } = await db.query<{ page: { total: number; groups: unknown[] } }>(
    `select public.get_child_item_groups(p_order_code => $1) as page`,
    [orderCode],
  );
  return Number(rows[0]?.page.total ?? 0);
}

async function productionRows(orderCode: string): Promise<number> {
  await asSuperUser(db);
  const { rows } = await db.query<{ order_item_id: string }>(
    `select order_item_id
       from public.get_production_rows(p_search => $1)`,
    [orderCode],
  );
  return rows.length;
}

async function managementRow(orderCode: string): Promise<{ seq: number | null } | null> {
  await asSuperUser(db);
  const { rows } = await db.query<{ seq: number | null }>(
    `select seq
       from public.get_production_rows_by_order(p_search => $1)`,
    [orderCode],
  );
  return rows[0] ?? null;
}

async function concludeExp(rootId: string): Promise<void> {
  await asUser(db, "authenticated", adminId);
  await db.query(
    `update public.production_processes
        set status = 'CONCLUIDO'
      where order_item_id = $1
        and process_id = $2`,
    [rootId, expProcessId],
  );
}

async function confirmShipment(orderId: string, rootId: string, quantity: number): Promise<string> {
  await asSuperUser(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.romaneios (order_id, status)
     values ($1, 'CONFIRMADO')
     returning id`,
    [orderId],
  );
  const romaneioId = rows[0]?.id as string;
  await db.query(
    `insert into public.romaneio_items (romaneio_id, order_item_id, quantity)
     values ($1, $2, $3)`,
    [romaneioId, rootId, quantity],
  );
  return romaneioId;
}

beforeAll(async () => {
  const testDb = await createTestDatabase();
  db = testDb.db;
  close = testDb.close;

  await asSuperUser(db);
  adminId = await createUser(db, "admin.visibility@example.com", "ADMIN");
  const { rows } = await db.query<{ id: string; code: string }>(
    `select id, code from public.processes where code in ('EXP', 'KIT')`,
  );
  expProcessId = rows.find((row) => row.code === "EXP")!.id;
  kitProcessId = rows.find((row) => row.code === "KIT")!.id;
});

afterAll(async () => {
  await close();
});

describe("visibilidade das OFs nas telas de produção", () => {
  it("a migração 084 pode ser reaplicada sem duplicar os filtros", async () => {
    await asSuperUser(db);
    await db.exec(
      readFileSync("supabase/migrations/084_production_visibility_and_shipped_sequence.sql", "utf8"),
    );
  });

  it("tira da Fábrica 1 quando todos os KIT aplicáveis estão concluídos", async () => {
    const concluded = await createOrder("OF-KIT-DONE", 1, 3, "NAO_INICIADO", ["CONCLUIDO"]);
    const pending = await createOrder("OF-KIT-PENDING", 2, 3, "NAO_INICIADO", ["NAO_INICIADO"]);

    expect(await childGroups("OF-KIT-DONE")).toBe(0);
    expect(await childGroups("OF-KIT-PENDING")).toBe(1);

    await asSuperUser(db);
    const { rows: totals } = await db.query<{ total: number }>(
      `select (public.get_child_items_totals(p_order_code => 'OF-KIT-DONE')->>'total')::int as total`,
    );
    expect(totals[0]?.total).toBe(0);
    expect(concluded.childIds).toHaveLength(1);
    expect(pending.childIds).toHaveLength(1);
  });

  it("tira da Fábrica 2 ao concluir EXP, mas mantém na Gestão até a baixa total", async () => {
    const order = await createOrder("OF-EXP-AND-SHIP", 3, 3, "NAO_INICIADO", ["CONCLUIDO"]);

    expect(await productionRows("OF-EXP-AND-SHIP")).toBe(1);
    await concludeExp(order.rootId);

    expect(await productionRows("OF-EXP-AND-SHIP")).toBe(0);
    expect(await managementRow("OF-EXP-AND-SHIP")).toEqual({ seq: null });
    await asSuperUser(db);
    const { rows: pageRows } = await db.query<{ page: { total: number } }>(
      `select public.get_child_item_groups_page(
         p_order_code => 'OF-EXP-AND-SHIP',
         p_offset => 0,
         p_limit => 10
       ) as page`,
    );
    expect(pageRows[0]?.page.total).toBe(0);

    await confirmShipment(order.orderId, order.rootId, 2);
    expect(await managementRow("OF-EXP-AND-SHIP")).toEqual({ seq: null });

    const { rows: shipmentRows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFIRMADO'`,
      [order.orderId],
    );
    await db.query(
      `update public.romaneio_items
          set quantity = 3
        where romaneio_id = $1
          and order_item_id = $2`,
      [shipmentRows[0]!.id, order.rootId],
    );

    expect(await managementRow("OF-EXP-AND-SHIP")).toBeNull();
  });
});
