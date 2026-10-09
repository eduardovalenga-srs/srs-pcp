import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDb } from "./helpers/test-db";

const SEED_PATH = path.join(process.cwd(), "supabase", "seed_demo.sql");

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase();
  await ctx.db.exec(readFileSync(SEED_PATH, "utf8"));
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

async function count(sql: string): Promise<number> {
  const { rows } = await ctx.db.query<{ total: number }>(sql);
  return Number(rows[0]?.total ?? 0);
}

describe("seed de demonstração", () => {
  it("cria os pedidos e itens de demonstração", async () => {
    expect(await count("select count(*) as total from public.orders")).toBe(10);
    expect(await count("select count(*) as total from public.order_items")).toBe(15);
    expect(
      await count("select count(*) as total from public.production_processes"),
    ).toBeGreaterThan(100);
  });

  it("é idempotente (rodar de novo não duplica dados)", async () => {
    await ctx.db.exec(readFileSync(SEED_PATH, "utf8"));
    expect(await count("select count(*) as total from public.orders")).toBe(10);
    expect(await count("select count(*) as total from public.order_items")).toBe(15);
  });

  it("gera uma situação de processo para cada processo ativo de cada item", async () => {
    const { rows } = await ctx.db.query<{ total: number }>(
      `select count(*) as total
       from public.order_items oi
       cross join public.processes p
       where p.active
         and not exists (
           select 1 from public.production_processes pp
           where pp.order_item_id = oi.id and pp.process_id = p.id
         )`,
    );
    expect(Number(rows[0]?.total)).toBe(0);
  });

  it("aplica a regra de atraso na RPC (delivery vencida + expedição pendente)", async () => {
    const { rows } = await ctx.db.query<{ code: string; overdue: boolean }>(
      `select order_code as code, overdue
       from public.get_production_rows(
         $1, $2, $3, $4, $5, $6::date, $7, $8, $9::int, $10::int
       )`,
      [null, null, null, null, "OVERDUE", null, "delivery_date", "asc", 0, 50],
    );

    const codes = rows.map((row) => row.code);
    expect(codes).toContain("OF-001"); // entrega vencida, expedição pendente
    expect(codes).not.toContain("OF-002"); // entrega hoje (janela TODAY, não OVERDUE)
    expect(codes).not.toContain("OF-006"); // concluído, expedição ok
    expect(codes).not.toContain("OF-003"); // entrega futura
    expect(rows.every((row) => row.overdue)).toBe(true);
  });

  it("lista a entrega de hoje na janela TODAY", async () => {
    const { rows } = await ctx.db.query<{ code: string }>(
      `select order_code as code
       from public.get_production_rows(
         $1, $2, $3, $4, $5, $6::date, $7, $8, $9::int, $10::int
       )`,
      [null, null, null, null, "TODAY", null, "delivery_date", "asc", 0, 50],
    );
    expect(rows.map((row) => row.code)).toContain("OF-002");
  });

  it("expõe os KPIs do dashboard a partir do seed", async () => {
    const { rows } = await ctx.db.query<{ stats: Record<string, unknown> }>(
      `select public.get_production_stats(current_date) as stats`,
    );
    const stats = rows[0]?.stats as {
      totalOrders: number;
      totalItems: number;
      itemsOverdue: number;
      delivery: { overdue: number; today: number };
      processes: { code: string }[];
    };

    expect(stats.totalOrders).toBe(10);
    expect(stats.totalItems).toBe(15);
    expect(stats.itemsOverdue).toBeGreaterThanOrEqual(2);
    expect(stats.delivery.overdue).toBeGreaterThanOrEqual(2);
    expect(stats.delivery.today).toBeGreaterThanOrEqual(1);
    expect(stats.processes).toHaveLength(14); // 13 do catálogo + MP (021)
  });
});
