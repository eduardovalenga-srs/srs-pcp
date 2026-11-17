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

type Stats = Record<string, unknown> | string;

function parseStats(value: Stats | undefined) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

describe("get_completed_weight_stats (074)", () => {
  it("soma quantidade concluída × peso unitário respeitando escopo pai/filho", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-074', 'OF') returning id`,
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

    const { rows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('month', '2026-11-13', 'America/Sao_Paulo', null) as stats`,
    );
    const stats = parseStats(rows[0]?.stats);
    const processes = stats?.processes as Array<{
      code: string;
      weightKg: number;
      quantity: number;
      cells: number;
      items: number;
    }>;
    expect(processes).toEqual([
      { code: "MP", name: "MP", displayOrder: 5, weightKg: 20, quantity: 2, cells: 1, items: 1 },
      { code: "PRE_MTG", name: "PRÉ-MTG", displayOrder: 80, weightKg: 30, quantity: 3, cells: 1, items: 1 },
      { code: "LASER", name: "LASER", displayOrder: 10, weightKg: 8, quantity: 4, cells: 1, items: 1 },
      { code: "KIT", name: "KIT", displayOrder: 70, weightKg: 10, quantity: 5, cells: 1, items: 1 },
    ].sort((a, b) => a.displayOrder - b.displayOrder));
    expect(stats?.total).toEqual({ weightKg: 68, quantity: 14 });
    expect(stats?.processCode).toBeNull();
    expect(stats?.periodStart).toBe("2026-11-01");
    expect(stats?.periodEnd).toBe("2026-11-30");

    const monthSeries = stats?.series as Array<{ bucket: string; weightKg: number }>;
    expect(monthSeries).toHaveLength(12);
    expect(monthSeries.find((bucket) => bucket.bucket === "2026-11-01")?.weightKg).toBe(68);

    // Matriz: um registro por dia do mês, mesmo sem produção.
    const days = stats?.days as Array<{ date: string; processes: Array<{ code: string; weightKg: number }> }>;
    expect(days).toHaveLength(30);
    expect(days.find((day) => day.date === "2026-11-01")).toMatchObject({ processes: [] });
    const day13 = days.find((day) => day.date === "2026-11-13");
    expect(day13?.processes.map((cell) => cell.code).sort()).toEqual(["KIT", "LASER", "MP", "PRE_MTG"]);

    // Filtro master: recorta totais, série e matriz para um processo.
    const { rows: filteredRows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('month', '2026-11-13', 'America/Sao_Paulo', 'LASER') as stats`,
    );
    const filtered = parseStats(filteredRows[0]?.stats);
    expect(filtered?.processCode).toBe("LASER");
    expect((filtered?.processes as Array<{ code: string }>).map((process) => process.code)).toEqual(["LASER"]);
    expect(filtered?.total).toEqual({ weightKg: 8, quantity: 4 });
    expect(
      (filtered?.days as Array<{ date: string; processes: Array<{ code: string }> }>).find(
        (day) => day.date === "2026-11-13",
      )?.processes,
    ).toEqual([{ code: "LASER", weightKg: 8, quantity: 4, cells: 1 }]);
    expect(
      (filtered?.series as Array<{ bucket: string; weightKg: number }>).find(
        (bucket) => bucket.bucket === "2026-11-01",
      )?.weightKg,
    ).toBe(8);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("usa a quantidade do item quando o lote marca CONCLUIDO sem quantidades", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-074-NOQTY', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
       values ($1, 'Item sem quantidade no processo', 6, 2.5) returning id`,
      [orderId],
    );
    const itemId = itemRows[0]?.id as string;
    // Edição em lote da gestão de OF: só o status muda.
    await db.query(
      `insert into public.production_processes
         (order_item_id, process_id, status, quantity_planned, quantity_completed, completed_at)
       select $1, p.id, 'CONCLUIDO', null, null, '2026-11-20 12:00:00-03'
         from public.processes p where p.code = 'MP'`,
      [itemId],
    );

    const { rows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('month', '2026-11-20', 'America/Sao_Paulo', null) as stats`,
    );
    const stats = parseStats(rows[0]?.stats);
    // Antes do fallback o kg era 0 e o HAVING removia o processo da resposta.
    expect(stats?.total).toEqual({ weightKg: 15, quantity: 6 });
    expect(stats?.processes).toEqual([
      { code: "MP", name: "MP", displayOrder: 5, weightKg: 15, quantity: 6, cells: 1, items: 1 },
    ]);
    expect(
      (stats?.days as Array<{ date: string; processes: Array<{ code: string }> }>).find(
        (day) => day.date === "2026-11-20",
      )?.processes,
    ).toEqual([{ code: "MP", weightKg: 15, quantity: 6, cells: 1 }]);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("mantém item concluído mesmo sem peso cadastrado (célula ✓ na UI)", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-074-NOWEIGHT', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
       values ($1, 'Item sem peso', 3, null) returning id`,
      [orderId],
    );
    const itemId = itemRows[0]?.id as string;
    await db.query(
      `insert into public.production_processes
         (order_item_id, process_id, status, quantity_planned, quantity_completed, completed_at)
       select $1, p.id, 'CONCLUIDO', 3, 3, '2026-11-21 12:00:00-03'
         from public.processes p where p.code = 'PRE_MTG'`,
      [itemId],
    );

    const { rows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('day', '2026-11-21', 'America/Sao_Paulo', null) as stats`,
    );
    const stats = parseStats(rows[0]?.stats);
    expect(stats?.total).toEqual({ weightKg: 0, quantity: 3 });
    expect(stats?.processes).toEqual([
      { code: "PRE_MTG", name: "PRÉ-MTG", displayOrder: 80, weightKg: 0, quantity: 3, cells: 1, items: 1 },
    ]);
    expect(stats?.days).toEqual([
      { date: "2026-11-21", processes: [{ code: "PRE_MTG", weightKg: 0, quantity: 3, cells: 1 }] },
    ]);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("usa updated_at como data efetiva quando completed_at está nulo", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-074-NULLDATE', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
       values ($1, 'Item de histórico', 1, 4) returning id`,
      [orderId],
    );
    const itemId = itemRows[0]?.id as string;
    await db.query(
      `insert into public.production_processes
         (order_item_id, process_id, status, quantity_planned, quantity_completed,
          completed_at, updated_at)
       select $1, p.id, 'CONCLUIDO', 1, 1, null, '2026-11-10 12:00:00+00'
         from public.processes p where p.code = 'MP'`,
      [itemId],
    );

    const { rows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('day', '2026-11-10', 'America/Sao_Paulo', null) as stats`,
    );
    const stats = parseStats(rows[0]?.stats);
    expect(stats?.total).toEqual({ weightKg: 4, quantity: 1 });
    expect(stats?.days).toEqual([
      { date: "2026-11-10", processes: [{ code: "MP", weightKg: 4, quantity: 1, cells: 1 }] },
    ]);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("agrupa semana/dia no fuso informado e devolve dias sem atividade", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-WEIGHT-074-DATE', 'OF') returning id`,
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

    const { rows: dayRows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('day', '2026-11-08', 'America/Sao_Paulo', null) as stats`,
    );
    const day = parseStats(dayRows[0]?.stats);
    expect(day?.periodStart).toBe("2026-11-08");
    expect(day?.total).toEqual({ weightKg: 15, quantity: 2 });
    expect((day?.series as unknown[])).toHaveLength(14);
    expect(day?.days).toEqual([
      { date: "2026-11-08", processes: [{ code: "MP", weightKg: 15, quantity: 2, cells: 1 }] },
    ]);

    const { rows: weekRows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('week', '2026-11-08', 'America/Sao_Paulo', null) as stats`,
    );
    const week = parseStats(weekRows[0]?.stats);
    expect(week?.periodStart).toBe("2026-11-02");
    expect(week?.periodEnd).toBe("2026-11-08");
    expect(week?.total).toEqual({ weightKg: 15, quantity: 2 });
    const weekSeries = week?.series as Array<{ bucket: string; weightKg: number }>;
    expect(weekSeries).toHaveLength(12);
    expect(weekSeries.find((bucket) => bucket.bucket === "2026-11-02")?.weightKg).toBe(15);

    const weekDays = week?.days as Array<{ date: string; processes: Array<{ code: string }> }>;
    expect(weekDays).toHaveLength(7);
    expect(weekDays.find((entry) => entry.date === "2026-11-02")).toMatchObject({ processes: [] });
    expect(weekDays.find((entry) => entry.date === "2026-11-08")?.processes).toEqual([
      { code: "MP", weightKg: 15, quantity: 2, cells: 1 },
    ]);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("recorta por família e devolve o montante de cada grupo no período (079)", async () => {
    await asSuperUser(db);
    const { rows: groupRows } = await db.query<{ id: number }>(
      `insert into public.product_groups (family_description, family_abbreviation)
       values ('Alfa 079', 'A79'), ('Beta 079', 'B79')
       returning id`,
    );
    const [groupA, groupB] = groupRows.map((row) => row.id);

    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, product_group_id)
       values ('OF-WEIGHT-079-A', 'OF', $1),
              ('OF-WEIGHT-079-B', 'OF', $2),
              ('OF-WEIGHT-079-NONE', 'OF', null)
       returning id`,
      [groupA, groupB],
    );
    const orderIds = orderRows.map((row) => row.id);

    const items = [
      { order: orderIds[0], quantity: 2, weight: 10 }, // 20 kg
      { order: orderIds[1], quantity: 3, weight: 4 }, // 12 kg
      { order: orderIds[2], quantity: 1, weight: 5 }, // 5 kg
    ];
    for (const item of items) {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
         values ($1, 'Item família 079', $2, $3) returning id`,
        [item.order, item.quantity, item.weight],
      );
      await db.query(
        `insert into public.production_processes
           (order_item_id, process_id, status, quantity_planned, quantity_completed, completed_at)
         select $1, p.id, 'CONCLUIDO', $2, $2, '2026-11-12 12:00:00-03'
           from public.processes p where p.code = 'MP'`,
        [rows[0]?.id, item.quantity],
      );
    }

    // Sem filtro: todos os grupos (inclusive "Sem família") aparecem.
    const { rows: allRows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('month', '2026-11-12', 'America/Sao_Paulo', null) as stats`,
    );
    const all = parseStats(allRows[0]?.stats);
    expect(all?.productGroupId).toBeNull();
    expect(all?.withoutProductGroup).toBe(false);
    expect(all?.total).toEqual({ weightKg: 37, quantity: 6 });
    expect(all?.groups).toEqual([
      { id: groupA, name: "Alfa 079", abbreviation: "A79", weightKg: 20, quantity: 2, items: 1, cells: 1 },
      { id: groupB, name: "Beta 079", abbreviation: "B79", weightKg: 12, quantity: 3, items: 1, cells: 1 },
      { id: null, name: "Sem família", abbreviation: "—", weightKg: 5, quantity: 1, items: 1, cells: 1 },
    ]);

    // Filtro por família: total/matriz recortados, mas os totais dos
    // grupos continuam completos para o seletor.
    const { rows: filteredRows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('month', '2026-11-12', 'America/Sao_Paulo', null, $1, false) as stats`,
      [groupA],
    );
    const filtered = parseStats(filteredRows[0]?.stats);
    expect(filtered?.productGroupId).toBe(groupA);
    expect(filtered?.total).toEqual({ weightKg: 20, quantity: 2 });
    expect(filtered?.groups).toHaveLength(3);
    expect(
      (filtered?.days as Array<{ date: string; processes: Array<{ weightKg: number }> }>).find(
        (day) => day.date === "2026-11-12",
      )?.processes,
    ).toEqual([{ code: "MP", weightKg: 20, quantity: 2, cells: 1 }]);

    // "Sem família" seleciona apenas as OFs com product_group_id nulo.
    const { rows: noneRows } = await db.query<{ stats: Stats }>(
      `select public.get_completed_weight_stats('month', '2026-11-12', 'America/Sao_Paulo', null, null, true) as stats`,
    );
    const none = parseStats(noneRows[0]?.stats);
    expect(none?.withoutProductGroup).toBe(true);
    expect(none?.total).toEqual({ weightKg: 5, quantity: 1 });
    expect(none?.groups).toHaveLength(3);

    await db.query(`delete from public.orders where id = any($1::uuid[])`, [orderIds]);
    await db.query(`delete from public.product_groups where id = any($1::bigint[])`, [[groupA, groupB]]);
  });
});
