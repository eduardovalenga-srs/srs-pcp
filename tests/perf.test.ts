import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, createTestDatabase } from "./helpers/test-db";

/**
 * Meta de performance (024): cada tela deve responder em ≤ 2 s com base
 * grande. Este teste semeia ~10 mil itens e mede as RPCs agregadas que
 * sustentam as telas de maior volume:
 *
 *  - get_production_rows   -> gestão de entregas / atrasados (paginação + cards)
 *  - get_production_stats  -> cards do dashboard
 *  - get_dashboard_orders  -> top clientes + envelhecimento
 *  - get_child_items_totals -> card da Fábrica 1
 *
 * Os limites são generosos para CI lento; o ponto é pegar regressão de
 * ordem de grandeza (ex.: voltar a varrer tudo no JavaScript).
 */

const BUDGET_MS = 2000;
const ORDER_COUNT = 200;
const PARENTS_PER_ORDER = 6;
const CHILDREN_PER_PARENT = 7;

let db: PGlite;
let close: () => Promise<void>;

async function seed(): Promise<void> {
  // Seed em SQL puro: 200 OFs × 6 pais × (1 linha própria + 7 filhos)
  // = 1200 pais + 8400 filhos = 9600 itens.

  await db.query(`
    insert into public.orders (code, type, customer_name, status, order_date, delivery_date)
    select
      'OF-PERF-' || lpad(n::text, 5, '0'),
      case when n % 3 = 0 then 'OS' else 'OF' end,
      'Cliente ' || (n % 50),
      case when n % 4 = 0 then 'CONCLUIDO' else 'EM_PRODUCAO' end,
      current_date - (n % 90),
      current_date + ((n % 60) - 30)
    from generate_series(1, ${ORDER_COUNT}) as n
  `);

  // Itens pai (raiz) — metade atrasada (entrega no passado, EXP pendente).
  await db.query(`
    insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
    select o.id,
           'P-' || p.n || '-' || o.code,
           'Peça pai ' || p.n || ' da ' || o.code,
           1 + (p.n % 7),
           round((0.5 + (p.n % 9))::numeric, 2),
           coalesce(o.delivery_date, current_date) - p.n,
           'EM_PRODUCAO'
      from public.orders o
      cross join generate_series(1, ${PARENTS_PER_ORDER}) as p(n)
     where o.code like 'OF-PERF-%'
  `);

  // Itens filhos (o que a Fábrica 1 lista).
  await db.query(`
    insert into public.order_items (order_id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
    select oi.order_id,
           oi.id,
           'F-' || c.n || '-' || oi.parent_item,
           'Componente ' || c.n || ' de ' || oi.parent_item,
           1 + (c.n % 5),
           round((0.25 + (c.n % 4))::numeric, 2),
           oi.delivery_date,
           'EM_PRODUCAO'
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      cross join generate_series(1, ${CHILDREN_PER_PARENT}) as c(n)
     where oi.parent_order_item_id is null
       and o.code like 'OF-PERF-%'
  `);

  // Processos de produção (EXP concluído em 10% dos pais, para a regra de atraso).
  await db.query(`
    insert into public.production_processes (order_item_id, process_id, status, quantity_planned, quantity_completed)
    select oi.id, p.id, 'NAO_INICIADO', oi.quantity, 0
      from public.order_items oi
      cross join public.processes p
     where oi.parent_order_item_id is null
       and oi.parent_item like 'P-%-%'
       and p.code in ('LASER', 'SERRA', 'EXP')
  `);
  await db.query(`
    update public.production_processes pp
       set status = 'CONCLUIDO', quantity_completed = pp.quantity_planned
      from public.processes p
     where pp.process_id = p.id
       and p.code = 'EXP'
       and pp.order_item_id in (
         select oi.id from public.order_items oi
          where oi.parent_order_item_id is null
            and oi.parent_item like 'P-1-%'
       )
  `);
  await db.query(`analyze`);
}

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await run();
  return { value, ms: performance.now() - start };
}

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;
  await asSuperUser(db);
  await seed();
}, 300_000);

afterAll(async () => {
  await close();
});

describe(`performance com base grande (${ORDER_COUNT} OFs)`, () => {
  it("semeou ~10 mil itens", async () => {
    const { rows } = await db.query<{ count: string }>(
      `select count(*)::text as count from public.order_items`,
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(9_000);
  });

  it("get_production_rows (gestão de entregas) responde dentro do orçamento", async () => {
    const { value, ms } = await timed(() =>
      db.query<{ n: number }>(
        `select count(*) as n from public.get_production_rows(
           p_search => null, p_order_status => null, p_process_code => null,
           p_process_status => null, p_delivery_filter => 'OVERDUE',
           p_today => current_date, p_sort => 'delivery_date', p_sort_dir => 'asc',
           p_offset => 0, p_limit => 50)`,
      ),
    );
    expect(Number(value.rows[0]?.n)).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("get_production_rows ordenado por coluna de processo responde dentro do orçamento", async () => {
    const { ms } = await timed(() =>
      db.query(
        `select count(*) as n from public.get_production_rows(
           p_sort => 'EXP', p_sort_dir => 'asc', p_offset => 0, p_limit => 50)`,
      ),
    );
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("get_production_stats (cards do dashboard) responde dentro do orçamento", async () => {
    const { value, ms } = await timed(() =>
      db.query<{ stats: { delivery: { overdueWeight: number }; totalItems: number } }>(
        `select public.get_production_stats() as stats`,
      ),
    );
    const stats = value.rows[0]?.stats;
    // Stats conta só itens RAIZ (6 por OF = 1200).
    expect(Number(stats?.totalItems)).toBeGreaterThanOrEqual(1_000);
    // Peso total (qtd × peso unit.) — nunca só o unitário.
    expect(Number(stats?.delivery.overdueWeight)).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("get_dashboard_orders responde dentro do orçamento", async () => {
    const { value, ms } = await timed(() =>
      db.query<{ data: { topCustomers: unknown[]; aging: Record<string, number> } }>(
        `select public.get_dashboard_orders() as data`,
      ),
    );
    const data = value.rows[0]?.data;
    expect(Array.isArray(data?.topCustomers)).toBe(true);
    expect(Object.keys(data?.aging ?? {}).length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("get_child_items_totals (Fábrica 1) responde dentro do orçamento", async () => {
    const { value, ms } = await timed(() =>
      db.query<{ totals: { total: number; weightTotal: number } }>(
        `select public.get_child_items_totals() as totals`,
      ),
    );
    const totals = value.rows[0]?.totals;
    expect(Number(totals?.total)).toBeGreaterThanOrEqual(4_000);
    expect(Number(totals?.weightTotal)).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("get_child_items_totals com filtros responde dentro do orçamento", async () => {
    const { value, ms } = await timed(() =>
      db.query<{ totals: { total: number } }>(
        `select public.get_child_items_totals(
           p_search => 'Componente 1',
           p_customer => 'Cliente 7',
           p_material => null,
           p_delivery_from => (current_date - 30)::date,
           p_delivery_to => (current_date + 30)::date
         ) as totals`,
      ),
    );
    expect(Number(value.rows[0]?.totals.total)).toBeGreaterThan(0);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
