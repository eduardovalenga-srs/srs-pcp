import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let adminId: string;
let expProcessId: string;

interface CreatedOrder {
  orderId: string;
  itemIds: string[];
}

/**
 * 083 — OFs com a expedição concluída saem do sequenciamento e vão para
 * o fim da Gestão de OF, com a fila ativa compactada.
 */
async function createOrder(
  code: string,
  seq: number,
  expStatuses: string[],
): Promise<CreatedOrder> {
  await asSuperUser(db);

  const { rows: orderRows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, delivery_date, status)
     values ($1, 'OF', 'Cliente Expedição', '2026-12-01', 'EM_PRODUCAO')
     returning id`,
    [code],
  );
  const orderId = orderRows[0]?.id as string;
  const itemIds: string[] = [];

  for (const [index, status] of expStatuses.entries()) {
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg, status)
       values ($1, $2, 1, 10, 'EM_PRODUCAO')
       returning id`,
      [orderId, `${code} item ${index + 1}`],
    );
    const itemId = itemRows[0]?.id as string;
    itemIds.push(itemId);

    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, $3)`,
      [itemId, expProcessId, status],
    );
  }

  await db.query(`update public.order_items set seq = $2 where order_id = $1`, [orderId, seq]);

  return { orderId, itemIds };
}

async function concludeExp(orderItemId: string): Promise<void> {
  await asUser(db, "authenticated", adminId);
  await db.query(
    `update public.production_processes
        set status = 'CONCLUIDO'
      where order_item_id = $1
        and process_id = $2`,
    [orderItemId, expProcessId],
  );
}

async function schedulingCodes(): Promise<string[]> {
  await asSuperUser(db);
  const { rows } = await db.query<{ order_code: string }>(
    `select order_code from public.get_process_scheduling(null, null)`,
  );
  return rows.map((row) => row.order_code);
}

async function sequenceByOrder(codes: string[]): Promise<[string, number][]> {
  await asSuperUser(db);
  const { rows } = await db.query<{ order_code: string; position: number }>(
    `select o.code as order_code, min(oi.seq)::int as position
       from public.orders o
       join public.order_items oi on oi.order_id = o.id
      where o.code = any ($1::text[])
      group by o.code
      order by position`,
    [codes],
  );
  return rows.map((row) => [row.order_code, row.position]);
}

async function expConcluded(orderId: string): Promise<boolean> {
  await asSuperUser(db);
  const { rows } = await db.query<{ concluded: boolean }>(
    `select public.order_exp_concluded($1::uuid) as concluded`,
    [orderId],
  );
  return rows[0]?.concluded === true;
}

beforeAll(async () => {
  const testDb = await createTestDatabase();
  db = testDb.db;
  close = testDb.close;

  await asSuperUser(db);
  adminId = await createUser(db, "admin.expedition@example.com", "ADMIN");
  const { rows } = await db.query<{ id: string }>(
    `select id from public.processes where code = 'EXP'`,
  );
  expProcessId = rows[0]?.id as string;
});

afterAll(async () => {
  await close();
});

describe("083 — conclusão da expedição no sequenciamento", () => {
  it("remove a OF do sequenciamento, compacta a fila e deixa a expedida no fim", async () => {
    const first = await createOrder("OF-EXP-A", 1, ["NAO_INICIADO"]);
    const second = await createOrder("OF-EXP-B", 2, ["NAO_INICIADO"]);
    const third = await createOrder("OF-EXP-C", 3, ["NAO_INICIADO"]);

    expect(await schedulingCodes()).toEqual(["OF-EXP-A", "OF-EXP-B", "OF-EXP-C"]);

    await concludeExp(first.itemIds[0]!);

    expect(await expConcluded(first.orderId)).toBe(true);
    expect(await schedulingCodes()).toEqual(["OF-EXP-B", "OF-EXP-C"]);
    expect(await sequenceByOrder(["OF-EXP-A", "OF-EXP-B", "OF-EXP-C"])).toEqual([
      ["OF-EXP-B", 1],
      ["OF-EXP-C", 2],
      ["OF-EXP-A", 3],
    ]);

    // A fila de um processo específico também deixa a OF expedida de fora.
    await asSuperUser(db);
    const { rows } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling($1, null)`,
      [expProcessId],
    );
    expect(rows.map((row) => row.order_code)).toEqual(["OF-EXP-B", "OF-EXP-C"]);

    // Mantém o cenário dos próximos testes.
    expect(second.orderId).toBeTruthy();
    expect(third.orderId).toBeTruthy();
  });

  it("só considera expedida quando TODOS os itens raiz aplicáveis concluíram", async () => {
    const multi = await createOrder("OF-EXP-D", 4, ["NAO_INICIADO", "NAO_INICIADO"]);

    await concludeExp(multi.itemIds[0]!);
    expect(await expConcluded(multi.orderId)).toBe(false);
    expect(await schedulingCodes()).toContain("OF-EXP-D");
    expect(await sequenceByOrder(["OF-EXP-D"])).toEqual([["OF-EXP-D", 4]]);

    await concludeExp(multi.itemIds[1]!);
    expect(await expConcluded(multi.orderId)).toBe(true);
    expect(await schedulingCodes()).not.toContain("OF-EXP-D");
    expect(await sequenceByOrder(["OF-EXP-A", "OF-EXP-B", "OF-EXP-C", "OF-EXP-D"])).toEqual([
      ["OF-EXP-B", 1],
      ["OF-EXP-C", 2],
      ["OF-EXP-A", 3],
      ["OF-EXP-D", 4],
    ]);
  });

  it("ignora itens NAO_APLICAVEL e move a OF expedida para o fim", async () => {
    const partial = await createOrder("OF-EXP-E", 5, ["CONCLUIDO", "NAO_APLICAVEL"]);

    expect(await expConcluded(partial.orderId)).toBe(true);
    expect(await schedulingCodes()).not.toContain("OF-EXP-E");

    await asSuperUser(db);
    await db.query(`select public.resequence_expedition_queue()`);

    expect(
      await sequenceByOrder(["OF-EXP-A", "OF-EXP-B", "OF-EXP-C", "OF-EXP-D", "OF-EXP-E"]),
    ).toEqual([
      ["OF-EXP-B", 1],
      ["OF-EXP-C", 2],
      ["OF-EXP-A", 3],
      ["OF-EXP-D", 4],
      ["OF-EXP-E", 5],
    ]);
  });

  it("salvar o sequenciamento mantém a expedida no fim e recusa recolocá-la na fila", async () => {
    await asSuperUser(db);
    const { rows } = await db.query<{ id: string; code: string }>(
      `select id, code from public.orders where code in ('OF-EXP-B', 'OF-EXP-C', 'OF-EXP-A')`,
    );
    const ids = new Map(rows.map((row) => [row.code, row.id]));
    const bId = ids.get("OF-EXP-B") as string;
    const cId = ids.get("OF-EXP-C") as string;
    const aId = ids.get("OF-EXP-A") as string;

    await asUser(db, "authenticated", adminId);
    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      null,
      null,
      JSON.stringify([
        { order_id: cId, position: 1, notes: null },
        { order_id: bId, position: 2, notes: null },
      ]),
    ]);

    expect(
      await sequenceByOrder(["OF-EXP-A", "OF-EXP-B", "OF-EXP-C", "OF-EXP-D", "OF-EXP-E"]),
    ).toEqual([
      ["OF-EXP-C", 1],
      ["OF-EXP-B", 2],
      ["OF-EXP-A", 3],
      ["OF-EXP-D", 4],
      ["OF-EXP-E", 5],
    ]);

    await asUser(db, "authenticated", adminId);
    await expect(
      db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
        null,
        null,
        JSON.stringify([{ order_id: aId, position: 1, notes: null }]),
      ]),
    ).rejects.toThrow(/não estão ativas/i);

    expect(await schedulingCodes()).toEqual(["OF-EXP-C", "OF-EXP-B"]);
  });
});
