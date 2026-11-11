import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let gestorId: string;

let orderA: string;
let rootA: string;
let child1: string;
let child2: string;
let orderB: string;
let rootB: string;

/** Recibo gravado no1º teste — usado na exclusão do último. */
let receipt1Id: string;

async function createOrder(code: string, customer: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, status, delivery_date)
     values ($1, 'OF', $2, 'EM_PRODUCAO', '2026-11-20') returning id`,
    [code, customer],
  );
  return rows[0]?.id as string;
}

async function createItem(
  orderId: string,
  parentItemId: string | null,
  code: string,
  description: string,
  quantity: number,
  unitWeight: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items
       (order_id, parent_item, description, quantity, unit_weight_kg, parent_order_item_id, status)
     values ($1, $2, $3, $4, $5, $6, 'PLANEJADO') returning id`,
    [orderId, code, description, quantity, unitWeight, parentItemId],
  );
  return rows[0]?.id as string;
}

/** Célula MP do item (status + quantidades do espelho 056/057). */
async function mpCell(itemId: string): Promise<{
  status: string;
  planned: number | null;
  completed: number | null;
  completedAt: string | null;
} | null> {
  const { rows } = await db.query<{
    status: string;
    planned: string | null;
    completed: string | null;
    completed_at: string | null;
  }>(
    `select pp.status,
            pp.quantity_planned::text as planned,
            pp.quantity_completed::text as completed,
            pp.completed_at::text as completed_at
       from public.production_processes pp
       join public.processes p on p.id = pp.process_id
      where pp.order_item_id = $1 and p.code = 'MP'`,
    [itemId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    planned: row.planned === null ? null : Number(row.planned),
    completed: row.completed === null ? null : Number(row.completed),
    completedAt: row.completed_at,
  };
}

async function save(
  orderId: string,
  items: { orderItemId: string; quantityKg: number }[],
): Promise<{ id: string; number: number }> {
  const { rows } = await db.query<{ id: string; number: string }>(
    `select (r ->> 'id')::text as id, (r ->> 'number')::bigint as number
       from (select public.save_mp_receipt($1, null, $2::jsonb) as r) s`,
    [orderId, JSON.stringify(items)],
  );
  return { id: rows[0]?.id as string, number: Number(rows[0]?.number ?? 0) };
}

/** Linhas do seletor em cascata (cliente → OFs com pendência). */
async function customers(): Promise<
  { customerName: string | null; pendingItems: number; pendingKg: number | null }[]
> {
  const { rows } = await db.query<{ customer_name: string | null; ofs: unknown }>(
    `select customer_name, ofs from public.get_mp_receipt_customers()`,
  );
  return rows.flatMap((row) => {
    const ofs = Array.isArray(row.ofs) ? (row.ofs as Record<string, unknown>[]) : [];
    return ofs.map((of) => ({
      customerName: row.customer_name,
      pendingItems: Number(of.pending_items ?? 0),
      pendingKg: of.pending_kg === null || of.pending_kg === undefined ? null : Number(of.pending_kg),
    }));
  });
}

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;

  await asSuperUser(db);
  gestorId = await createUser(db, "gestor.mp@serralheria.com", "GESTOR");

  // OF-A: pai com d.filhos (CH-1: 2 × 10 kg = 20; CH-2: 2 × 5 kg = 10).
  orderA = await createOrder("OF-MP-001", "Cliente A");
  rootA = await createItem(orderA, null, "PAI-1", "Conjunto de porta", 1, 15);
  child1 = await createItem(orderA, rootA, "CH-1", "Perfil 100x50", 2, 10);
  child2 = await createItem(orderA, rootA, "CH-2", "Chapa 3mm", 2, 5);

  // OF-B: pai SEM filhos (material direto no pai — fallback 057).
  orderB = await createOrder("OF-MP-002", "Cliente B");
  rootB = await createItem(orderB, null, "SOZ-1", "Estrutura simples", 1, 12.5);
});

afterAll(async () => {
  await close();
});

describe("recebimento de MP por item filho (057)", () => {
  it("salva no filho e espelha o filho + o agregado no pai", async () => {
    await asUser(db, "authenticated", gestorId);
    const receipt = await save(orderA, [{ orderItemId: child1, quantityKg: 20 }]);
    receipt1Id = receipt.id;
    expect(receipt.number).toBeGreaterThan(0);
    await asSuperUser(db);

    // Filho: peso próprio coberto → verde.
    const filho = await mpCell(child1);
    expect(filho).toMatchObject({ status: "CONCLUIDO", planned: 20, completed: 20 });
    expect(filho?.completedAt).not.toBeNull();

    // Pai: Σ dos filhos (20 de 30) → amarelo/NAO_INICIADO, sem data.
    const pai = await mpCell(rootA);
    expect(pai).toMatchObject({ status: "NAO_INICIADO", planned: 30, completed: 20 });
    expect(pai?.completedAt).toBeNull();
  });

  it("seletor conta as LINHAS elegíveis (filhos + raiz sem filhos)", async () => {
    const rows = await customers();

    // OF-A: só o CH-2 segue pendente (1 linha, 10 kg).
    expect(rows.find((row) => row.customerName === "Cliente A")).toMatchObject({
      pendingItems: 1,
      pendingKg: 10,
    });
    // OF-B: a raiz sem filhos continua elegível (1 linha, 12,5 kg).
    expect(rows.find((row) => row.customerName === "Cliente B")).toMatchObject({
      pendingItems: 1,
      pendingKg: 12.5,
    });
  });

  it("rejeita lançar no pai que tem filhos (a linha saiu da tela)", async () => {
    await asUser(db, "authenticated", gestorId);
    await expect(save(orderA, [{ orderItemId: rootA, quantityKg: 5 }])).rejects.toThrow(
      /elegível/,
    );
    await asSuperUser(db);

    // A RPC é transacional: nada do recibo rejeitado fica para trás.
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from public.mp_receipts where order_id = $1`,
      [orderA],
    );
    expect(rows[0]?.total).toBe(1);
  });

  it("pai só fica CONCLUIDO quando TODOS os filhos recebem", async () => {
    await asUser(db, "authenticated", gestorId);
    await save(orderA, [{ orderItemId: child2, quantityKg: 10 }]);
    await asSuperUser(db);

    const pai = await mpCell(rootA);
    expect(pai).toMatchObject({ status: "CONCLUIDO", planned: 30, completed: 30 });
    expect(pai?.completedAt).not.toBeNull();

    // Filho coberto também fica verde.
    expect(await mpCell(child2)).toMatchObject({ status: "CONCLUIDO", planned: 10, completed: 10 });

    // OF-A fechou: some do seletor (a OF-B segue).
    const rows = await customers();
    expect(rows.some((row) => row.customerName === "Cliente A")).toBe(false);
  });

  it("raiz sem filhos segue recebendo pela regra antiga (fallback)", async () => {
    await asUser(db, "authenticated", gestorId);
    await save(orderB, [{ orderItemId: rootB, quantityKg: 12.5 }]);
    // sync_parent de um pai sem filhos cai na regra do próprio item.
    await db.query(`select public.mp_receipt_sync_parent($1, $2)`, [rootB, gestorId]);
    await asSuperUser(db);

    expect(await mpCell(rootB)).toMatchObject({
      status: "CONCLUIDO",
      planned: 12.5,
      completed: 12.5,
    });

    // Nenhuma OF com pendência — seletor vazio.
    expect(await customers()).toHaveLength(0);
  });

  it("recibo legado lançado no pai soma no agregado", async () => {
    await asSuperUser(db);
    const { rows: receipt } = await db.query<{ id: string }>(
      `insert into public.mp_receipts (order_id, notes, created_by)
       values ($1, 'legado no pai', $2) returning id`,
      [orderA, gestorId],
    );
    await db.query(
      `insert into public.mp_receipt_items (mp_receipt_id, order_item_id, quantity_kg)
       values ($1, $2, 20)`,
      [receipt[0]?.id, rootA],
    );

    await asUser(db, "authenticated", gestorId);
    await db.query(`select public.mp_receipt_sync_parent($1, $2)`, [rootA, gestorId]);
    await asSuperUser(db);

    // Σ dos filhos (30) + legado do pai (20) = 50 — e segue verde.
    expect(await mpCell(rootA)).toMatchObject({
      status: "CONCLUIDO",
      planned: 30,
      completed: 50,
    });
  });

  it("exclusão reverte o filho e o agregado do pai", async () => {
    await asUser(db, "authenticated", gestorId);
    await db.query(`select public.delete_mp_receipt($1)`, [receipt1Id]);
    await asSuperUser(db);

    // Filho sem recebimento volta ao estado padrão.
    expect(await mpCell(child1)).toMatchObject({
      status: "NAO_INICIADO",
      planned: 20,
      completed: 0,
    });
    expect((await mpCell(child1))?.completedAt).toBeNull();

    // Pai: 10 (CH-2) + 20 (legado) = 30 kg, mas um filho está sem
    // recebimento → NÃO fica verde (pior caso entre os filhos).
    expect(await mpCell(rootA)).toMatchObject({
      status: "NAO_INICIADO",
      planned: 30,
      completed: 30,
    });

    // OF-A volta ao seletor com a pendência do CH-1 (20 kg).
    const rows = await customers();
    expect(rows.find((row) => row.customerName === "Cliente A")).toMatchObject({
      pendingItems: 1,
      pendingKg: 20,
    });
  });
});
