import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";
import { asSuperUser, createTestDatabase } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;
});

afterAll(async () => {
  await close();
});

describe("get_completed_weight_stats (067)", () => {
  it("soma quantidade concluída × peso unitário respeitando escopo pai/filho", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-067', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: rootRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'ROOT', 'Item raiz', 10, 10) returning id`,
      [orderId],
    );
    const rootId = rootRows[0]?.id as string;
    const { rows: childRows } = await db.query<{ id: string }>(
      `insert into public.order_items
         (order_id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, $2, 'CHILD', 'Item filho', 5, 2) returning id`,
      [orderId, rootId],
    );
    const childId = childRows[0]?.id as string;

    // MP + PRE_MTG moram na raiz; LASER + KIT moram no filho. A inversão
    // de escopo (MP filho / LASER raiz) não pode entrar na soma.
    const cells = [
      { itemId: rootId, code: "MP", quantity: 2 },
      { itemId: rootId, code: "PRE_MTG", quantity: 3 },
      { itemId: rootId, code: "LASER", quantity: 10 },
      { itemId: childId, code: "LASER", quantity: 4 },
      { itemId: childId, code: "KIT", quantity: 5 },
      { itemId: childId, code: "MP", quantity: 5 },
    ];
    for (const cell of cells) {
      await db.query(
        `insert into public.production_processes
           (order_item_id, process_id, status, quantity_planned, quantity_completed, completed_at)
         select $1, p.id, 'CONCLUIDO', $3, $3, '2026-11-13 12:00:00-03'
           from public.processes p where p.code = $2`,
        [cell.itemId, cell.code, cell.quantity],
      );
    }

    const { rows } = await db.query<{ stats: Record<string, unknown> | string }>(
      `select public.get_completed_weight_stats('month', '2026-11-13', 'America/Sao_Paulo') as stats`,
    );
    const stats =
      typeof rows[0]?.stats === "string" ? JSON.parse(rows[0].stats) : rows[0]?.stats;
    const processes = stats?.processes as Array<{ code: string; weightKg: number; quantity: number }>;
    expect(processes).toEqual([
      { code: "MP", name: "MP", displayOrder: 5, weightKg: 20, quantity: 2, items: 1 },
      { code: "PRE_MTG", name: "PRÉ-MTG", displayOrder: 80, weightKg: 30, quantity: 3, items: 1 },
      { code: "LASER", name: "LASER", displayOrder: 10, weightKg: 8, quantity: 4, items: 1 },
      { code: "KIT", name: "KIT", displayOrder: 70, weightKg: 10, quantity: 5, items: 1 },
    ].sort((a, b) => a.displayOrder - b.displayOrder));
    expect(stats?.total).toEqual({ weightKg: 68, quantity: 14 });
    const monthSeries = stats?.series as Array<{ bucket: string; weightKg: number }>;
    expect(monthSeries).toHaveLength(12);
    expect(monthSeries.find((bucket) => bucket.bucket === "2026-11-01")?.weightKg).toBe(68);
    expect(stats?.periodStart).toBe("2026-11-01");
    expect(stats?.periodEnd).toBe("2026-11-30");

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("agrupa semana/dia no fuso informado e devolve buckets sem atividade", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-067-DATE', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
       values ($1, 'Item do dia', 2, 7.5) returning id`,
      [orderId],
    );
    const itemId = itemRows[0]?.id as string;
    await db.query(
      `insert into public.production_processes
         (order_item_id, process_id, status, quantity_planned, quantity_completed, completed_at)
       select $1, p.id, 'CONCLUIDO', 2, 2, '2026-11-09 01:00:00+00'
         from public.processes p where p.code = 'MP'`,
      [itemId],
    );

    const { rows: dayRows } = await db.query<{ stats: Record<string, unknown> | string }>(
      `select public.get_completed_weight_stats('day', '2026-11-08', 'America/Sao_Paulo') as stats`,
    );
    const day = typeof dayRows[0]?.stats === "string" ? JSON.parse(dayRows[0].stats) : dayRows[0]?.stats;
    expect(day?.periodStart).toBe("2026-11-08");
    expect(day?.total).toEqual({ weightKg: 15, quantity: 2 });
    expect((day?.series as unknown[])).toHaveLength(14);

    const { rows: weekRows } = await db.query<{ stats: Record<string, unknown> | string }>(
      `select public.get_completed_weight_stats('week', '2026-11-08', 'America/Sao_Paulo') as stats`,
    );
    const week = typeof weekRows[0]?.stats === "string" ? JSON.parse(weekRows[0].stats) : weekRows[0]?.stats;
    expect(week?.periodStart).toBe("2026-11-02");
    expect(week?.periodEnd).toBe("2026-11-08");
    expect(week?.total).toEqual({ weightKg: 15, quantity: 2 });
    const weekSeries = week?.series as Array<{ bucket: string; weightKg: number }>;
    expect(weekSeries).toHaveLength(12);
    expect(weekSeries.find((bucket) => bucket.bucket === "2026-11-02")?.weightKg).toBe(15);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });
});
