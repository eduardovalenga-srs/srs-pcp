import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

/**
 * 054 — Baixa derivada da expedição nos TOTAIS das RPCs de produção.
 *
 * Cenário: OF-054 com um item raiz 100 × 2 kg (total 200 kg) e um filho
 * 10 × 1 kg (total 10 kg), EXPEDIÇÃO concluída. Emitir a nota de uma carga
 * de 40 muda o exibido para o SALDO (60 / 120 kg; filho proporcional 6/6)
 * sem tocar em `order_items.quantity`; uma segunda carga de 60 zera o
 * saldo e tira o item dos cards; cancelar restaura.
 */

let db: PGlite;
let close: () => Promise<void>;
let gestorId: string;

let orderId: string;
let rootId: string;
let childId: string;

async function createOrder(code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, status, delivery_date)
     values ($1, 'OF', 'Metalúrgica Alfa', 'EM_PRODUCAO', current_date + 10) returning id`,
    [code],
  );
  return rows[0]?.id as string;
}

/** Item raiz com EXPEDIÇÃO concluída (pré-requisito da confirmação). */
async function createRootItem(
  orderId: string,
  description: string,
  quantity: number,
  unitWeightKg: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, $5, 'EM_PRODUCAO') returning id`,
    [orderId, description, description, quantity, unitWeightKg],
  );
  const itemId = rows[0]?.id as string;
  await db.query(
    `insert into public.production_processes (order_item_id, process_id, status, quantity_planned, quantity_completed)
     select $1, p.id, 'CONCLUIDO', $2, $2
       from public.processes p where p.code = 'EXP'`,
    [itemId, quantity],
  );
  return itemId;
}

/** Item FILHO (016) — a baixa é proporcional à fração expedida do pai. */
async function createChildItem(
  orderId: string,
  parentItemId: string,
  description: string,
  quantity: number,
  unitWeightKg: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, parent_order_item_id, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, $5, $6, 'EM_PRODUCAO') returning id`,
    [orderId, description, description, quantity, unitWeightKg, parentItemId],
  );
  return rows[0]?.id as string;
}

async function saveRomaneio(orderId: string, items: { orderItemId: string; quantity: number }[]): Promise<string> {
  const { rows } = await db.query<{ save_romaneio: { id: string } }>(
    `select public.save_romaneio(null::uuid, $1::uuid, null::date, null::text, null::text, null::text, $2::jsonb, '[]'::jsonb)`,
    [orderId, JSON.stringify(items)],
  );
  return rows[0]!.save_romaneio.id;
}

async function signConference(romaneioId: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select order_item_id as id from public.romaneio_items where romaneio_id = $1`,
    [romaneioId],
  );
  await db.query(
    `select public.save_romaneio_conference($1::uuid, null::text, $2::uuid[], '[]'::jsonb, true)`,
    [romaneioId, rows.map((row) => row.id)],
  );
}

/** Registra a NF de saída direto (o emissor é externo). */
async function setNfNumber(romaneioId: string, nfNumber: string): Promise<void> {
  await asSuperUser(db);
  await db.query(`update public.romaneios set nf_number = $2 where id = $1`, [romaneioId, nfNumber]);
  await asUser(db, "authenticated", gestorId);
}

async function confirmRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.confirm_romaneio($1::uuid)`, [romaneioId]);
}

async function cancelRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.cancel_romaneio($1::uuid)`, [romaneioId]);
}

/** Emite a carga completa: conferência → NF → confirmação. */
async function ship(orderId: string, quantity: number, nf: string): Promise<string> {
  const romaneioId = await saveRomaneio(orderId, [{ orderItemId: rootId, quantity }]);
  await signConference(romaneioId);
  await setNfNumber(romaneioId, nf);
  await confirmRomaneio(romaneioId);
  return romaneioId;
}

type RowTotals = {
  total_count: number | string;
  qty_total: number | string;
  weight_total: number | string;
  quantity: number | string;
};

async function f2Rows(search: string, qtyMin: number | null = null): Promise<RowTotals[]> {
  const { rows } = await db.query<RowTotals>(
    qtyMin === null
      ? `select * from public.get_production_rows(p_search => $1)`
      : `select * from public.get_production_rows(p_search => $1, p_qty_min => $2::numeric)`,
    qtyMin === null ? [search] : [search, qtyMin],
  );
  return rows;
}

async function managementRows(search: string): Promise<RowTotals[]> {
  const { rows } = await db.query<RowTotals>(
    `select * from public.get_production_rows_by_order(p_search => $1)`,
    [search],
  );
  return rows;
}

type ChildTotals = {
  total: number | string;
  qtyTotal: number | string;
  weightTotal: number | string;
};

async function childTotals(orderCode: string, qtyMin: number | null = null): Promise<ChildTotals> {
  const { rows } = await db.query<{ totals: ChildTotals | string }>(
    qtyMin === null
      ? `select public.get_child_items_totals(p_order_code => $1) as totals`
      : `select public.get_child_items_totals(p_order_code => $1, p_qty_min => $2::numeric) as totals`,
    qtyMin === null ? [orderCode] : [orderCode, qtyMin],
  );
  const raw = rows[0]?.totals;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as ChildTotals;
}

type Stats = {
  totalItems: number;
  itemsByStatus: Record<string, number>;
  itemsInProduction: number;
  itemsDone: number;
  itemsOverdue: number;
  delivery: Record<string, number>;
  expedition: { count: number; qty: number; weight: number };
};

async function readStats(): Promise<Stats> {
  const { rows } = await db.query<{ stats: Stats | string }>(
    `select public.get_production_stats() as stats`,
  );
  const raw = rows[0]?.stats;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as Stats;
}

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;

  await asSuperUser(db);
  gestorId = await createUser(db, "gestor.shipping@serralheria.com", "GESTOR");
  await asUser(db, "authenticated", gestorId);

  orderId = await createOrder("OF-054");
  rootId = await createRootItem(orderId, "Portão basculante", 100, 2);
  childId = await createChildItem(orderId, rootId, "Folha do portão", 10, 1);
});

afterAll(async () => {
  await close();
});

describe("054 — saldo derivado da expedição nos totais", () => {
  it("sem expedição os totais são o planejado (raiz e filho)", async () => {
    const f2 = await f2Rows("OF-054");
    expect(f2).toHaveLength(1);
    expect(Number(f2[0]?.qty_total)).toBe(100);
    expect(Number(f2[0]?.weight_total)).toBe(200);
    expect(Number(f2[0]?.quantity)).toBe(100);

    const management = await managementRows("OF-054");
    expect(management).toHaveLength(1);
    expect(Number(management[0]?.qty_total)).toBe(100);
    expect(Number(management[0]?.weight_total)).toBe(200);

    const totals = await childTotals("OF-054");
    expect(Number(totals.total)).toBe(1);
    expect(Number(totals.qtyTotal)).toBe(10);
    expect(Number(totals.weightTotal)).toBe(10);

    const stats = await readStats();
    expect(stats.totalItems).toBe(1);
    expect(stats.itemsInProduction).toBe(1);
  });

  it("carga de 40: F2/Gestão passam a somar o SALDO (60 / 120 kg)", async () => {
    await ship(orderId, 40, "54001");

    const f2 = await f2Rows("OF-054");
    expect(f2).toHaveLength(1);
    expect(Number(f2[0]?.qty_total)).toBe(60);
    expect(Number(f2[0]?.weight_total)).toBe(120);
    expect(Number(f2[0]?.quantity)).toBe(60);

    const management = await managementRows("OF-054");
    expect(management).toHaveLength(1);
    expect(Number(management[0]?.qty_total)).toBe(60);
    expect(Number(management[0]?.weight_total)).toBe(120);
    expect(Number(management[0]?.quantity)).toBe(60);

    // O planejado NUNCA é decrementado (a baixa é derivada, não gravada).
    const { rows } = await db.query<{ quantity: string; total_weight_kg: string }>(
      `select quantity::text, total_weight_kg::text from public.order_items where id = $1`,
      [rootId],
    );
    expect(Number(rows[0]?.quantity)).toBe(100);
    expect(Number(rows[0]?.total_weight_kg)).toBe(200);
  });

  it("filtro de Qtd. da F2 vale sobre o SALDO (70 fica vazio)", async () => {
    expect(await f2Rows("OF-054", 70)).toHaveLength(0);
    // Abaixo do saldo continua listando (60 >= 50).
    expect(await f2Rows("OF-054", 50)).toHaveLength(1);
  });

  it("filho baixa proporcional à fração expedida do pai (6 / 6 kg)", async () => {
    const totals = await childTotals("OF-054");
    expect(Number(totals.total)).toBe(1);
    expect(Number(totals.qtyTotal)).toBe(6);
    expect(Number(totals.weightTotal)).toBe(6);

    // HAVING do grupo (Σ dos membros) também é sobre o saldo.
    expect(Number((await childTotals("OF-054", 7)).total)).toBe(0);
    expect(Number((await childTotals("OF-054", 5)).total)).toBe(1);

    const { rows } = await db.query<{ page: { total: number | string; groups: unknown[] } }>(
      `select public.get_child_item_groups(p_order_code => 'OF-054', p_qty_min => 7::numeric) as page`,
    );
    expect(Number(rows[0]?.page?.total)).toBe(0);
    expect(rows[0]?.page?.groups).toHaveLength(0);

    // O filho também NÃO é decrementado: só a exibição usa a fração.
    const { rows: child } = await db.query<{ quantity: string }>(
      `select quantity::text from public.order_items where id = $1`,
      [childId],
    );
    expect(Number(child[0]?.quantity)).toBe(10);
  });

  it("o card de itens continua contando o que falta expedir", async () => {
    const stats = await readStats();
    // Item raiz com saldo 60 segue nos cards.
    expect(stats.totalItems).toBe(1);
    expect(stats.itemsInProduction).toBe(1);
    // O card "Expedição" mantém o CONJUNTO (EXP concluída) inalterado…
    expect(stats.expedition.count).toBe(1);
    // …mas a quantidade/pendência dele acompanha o saldo exibido.
    expect(Number(stats.expedition.qty)).toBe(60);
    expect(Number(stats.expedition.weight)).toBe(120);
  });

  it("segunda carga de 60 zera o saldo e tira o item dos cards", async () => {
    await ship(orderId, 60, "54002");

    const f2 = await f2Rows("OF-054");
    // A listagem continua mostrando a linha (saldo 0), só os cards filtram.
    expect(f2).toHaveLength(1);
    expect(Number(f2[0]?.qty_total)).toBe(0);
    expect(Number(f2[0]?.weight_total)).toBe(0);
    expect(Number(f2[0]?.quantity)).toBe(0);

    const totals = await childTotals("OF-054");
    expect(Number(totals.qtyTotal)).toBe(0);
    expect(Number(totals.weightTotal)).toBe(0);

    const stats = await readStats();
    expect(stats.totalItems).toBe(0);
    expect(stats.itemsInProduction).toBe(0);
    // O conjunto da EXPEDIÇÃO continua com o item (só o saldo zera).
    expect(stats.expedition.count).toBe(1);
    expect(Number(stats.expedition.qty)).toBe(0);
  });

  it("cancelar a carga restaura o saldo sem nenhum contador gravado", async () => {
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFIRMADO' order by number desc limit 1`,
      [orderId],
    );
    await cancelRomaneio(rows[0]!.id);

    const f2 = await f2Rows("OF-054");
    expect(Number(f2[0]?.qty_total)).toBe(60);
    expect(Number(f2[0]?.weight_total)).toBe(120);

    const totals = await childTotals("OF-054");
    expect(Number(totals.qtyTotal)).toBe(6);
    expect(Number(totals.weightTotal)).toBe(6);

    const stats = await readStats();
    expect(stats.totalItems).toBe(1);

    const { rows: items } = await db.query<{ quantity: string }>(
      `select quantity::text from public.order_items where id = $1`,
      [rootId],
    );
    expect(Number(items[0]?.quantity)).toBe(100);
  });

  it("helper romaneio_shipped_by_item() só soma romaneios CONFIRMADOS (e nega anon)", async () => {
    const { rows } = await db.query<{ item_id: string; shipped: string }>(
      `select * from public.romaneio_shipped_by_item() where item_id = $1`,
      [rootId],
    );
    // 40 confirmados + 60 cancelados = 40.
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.shipped)).toBe(40);

    const { rows: grants } = await db.query<{ authenticated: boolean; acl: string | null }>(
      `select has_function_privilege('authenticated', 'public.romaneio_shipped_by_item()', 'EXECUTE') as authenticated,
              coalesce((select p.proacl::text
                          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'romaneio_shipped_by_item'), '') as acl`,
    );
    expect(grants[0]?.authenticated).toBe(true);
    // O revoke da 054 remove o grant EXPLÍCITO do anon (no PGlite ele ainda
    // herda o EXECUTE default de PUBLIC — a checagem é sobre o proacl).
    expect(grants[0]?.acl).toContain("authenticated=");
    expect(grants[0]?.acl).not.toContain("anon=");
  });
});
