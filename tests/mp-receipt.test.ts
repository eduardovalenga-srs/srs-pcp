import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let gestorId: string;

/**
 * OF-A: pai com 2 filhos que consomem o MESMO material (TB33: 10 kg em
 * cada) — o material é uma LINHA só na tela, com 20 kg de peso total.
 * O CH-2 consome ainda a CHAPA (5 kg).
 */
let orderA: string;
let rootA: string;
let childA1: string;
let childA2: string;

/** OF-B: raiz SEM filhos e SEM material cadastrado (grupo sintético). */
let orderB: string;
let rootB: string;

/** Recibo gravado no 1º teste — usado na exclusão do último. */
let receipt1Id: string;

const MATERIAL_TB33 = "TB33.40X3.38::KG";
const MATERIAL_CHAPA = "CHAPA 3MM::KG";

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
  seq: number | null = null,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items
       (order_id, parent_item, description, quantity, unit_weight_kg, parent_order_item_id, status, seq)
     values ($1, $2, $3, $4, $5, $6, 'PLANEJADO', $7) returning id`,
    [orderId, code, description, quantity, unitWeight, parentItemId, seq],
  );
  return rows[0]?.id as string;
}

/** Material do item (`order_item_materials`) — insumo que o item consome. */
async function createMaterial(
  itemId: string,
  description: string,
  quantity: number,
  unit = "KG",
): Promise<void> {
  await db.query(
    `insert into public.order_item_materials (order_item_id, description, quantity, unit)
     values ($1, $2, $3, $4)`,
    [itemId, description, quantity, unit],
  );
}

/** Célula MP do item (status + quantidades do espelho 056/059). */
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

/** Materiais da OF como a tela mostra (RPC `mp_order_materials`). */
async function orderMaterials(orderId: string): Promise<
  {
    materialKey: string;
    description: string;
    unit: string;
    totalKg: number;
    receivedKg: number;
    balanceKg: number;
  }[]
> {
  const { rows } = await db.query<{
    material_key: string;
    description: string;
    unit: string;
    need_kg: string;
    received_kg: string;
    balance_kg: string;
  }>(`select * from public.mp_order_materials($1)`, [orderId]);
  return rows.map((row) => ({
    materialKey: row.material_key,
    description: row.description,
    unit: row.unit,
    totalKg: Number(row.need_kg),
    receivedKg: Number(row.received_kg),
    balanceKg: Number(row.balance_kg),
  }));
}

/** Grava uma NOTA DE ENTRADA (RPC `save_mp_receipt`, 059). */
async function save(
  orderId: string,
  entryNumber: string,
  entryDate: string,
  materials: { materialKey: string; description: string; unit: string; quantityKg: number }[],
): Promise<{ id: string; number: number }> {
  const { rows } = await db.query<{ id: string; number: string }>(
    `select (r ->> 'id')::text as id, (r ->> 'number')::bigint as number
       from (select public.save_mp_receipt($1, $2, $3::date, null, $4::jsonb) as r) s`,
    [orderId, entryNumber, entryDate, JSON.stringify(materials)],
  );
  return { id: rows[0]?.id as string, number: Number(rows[0]?.number ?? 0) };
}

/** Linhas do seletor em cascata (cliente → OFs com pendência). */
async function customers(): Promise<
  { customerName: string | null; pendingMaterials: number; pendingKg: number | null }[]
> {
  const { rows } = await db.query<{ customer_name: string | null; ofs: unknown }>(
    `select customer_name, ofs from public.get_mp_receipt_customers()`,
  );
  return rows.flatMap((row) => {
    const ofs = Array.isArray(row.ofs) ? (row.ofs as Record<string, unknown>[]) : [];
    return ofs.map((of) => ({
      customerName: row.customer_name,
      pendingMaterials: Number(of.pending_materials ?? 0),
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

  // OF-A: pai com 2 filhos. CH-1 (seq 2) e CH-2 (seq 3) consomem o
  // mesmo TB33 (10 kg cada) — o CH-2 consome também a CHAPA (5 kg).
  // O seq do pai (1) é o do GRUPO: os dois filhos estão na mesma
  // sequência de produção.
  orderA = await createOrder("OF-MP-001", "Cliente A");
  rootA = await createItem(orderA, null, "PAI-1", "Conjunto de porta", 1, 15, 1);
  childA1 = await createItem(orderA, rootA, "CH-1", "Perfil 100x50", 2, 10, 2);
  childA2 = await createItem(orderA, rootA, "CH-2", "Chapa 3mm", 2, 5, 3);
  await createMaterial(childA1, "TB33.40X3.38", 10);
  await createMaterial(childA2, "TB33.40X3.38", 10);
  await createMaterial(childA2, "CHAPA 3MM", 5);

  // OF-B: raiz SEM filhos e SEM material — cai no grupo sintético.
  orderB = await createOrder("OF-MP-002", "Cliente B");
  rootB = await createItem(orderB, null, "SOZ-1", "Estrutura simples", 1, 12.5, 10);
});

afterAll(async () => {
  await close();
});

describe("recebimento de MP por matéria-prima (059)", () => {
  it("agrega os itens que consomem o mesmo material numa linha só", async () => {
    const materials = await orderMaterials(orderA);

    // TB33 aparece UMA vez, com 20 kg (10 do CH-1 + 10 do CH-2).
    const tb33 = materials.find((m) => m.materialKey === MATERIAL_TB33);
    expect(tb33).toMatchObject({
      description: "TB33.40X3.38",
      unit: "KG",
      totalKg: 20,
      receivedKg: 0,
      balanceKg: 20,
    });

    // A CHAPA (só do CH-2) é outra linha, com 5 kg.
    expect(materials.find((m) => m.materialKey === MATERIAL_CHAPA)).toMatchObject({
      totalKg: 5,
      balanceKg: 5,
    });

    // O material não aparece em duplicidade.
    expect(materials).toHaveLength(2);
  });

  it("registra a nota de entrada e distribui o material na ordem de produção", async () => {
    await asUser(db, "authenticated", gestorId);
    const receipt = await save(orderA, "NE-001", "2026-11-01", [
      {
        materialKey: MATERIAL_TB33,
        description: "TB33.40X3.38",
        unit: "KG",
        quantityKg: 15,
      },
    ]);
    receipt1Id = receipt.id;
    expect(receipt.number).toBeGreaterThan(0);
    await asSuperUser(db);

    // 15 kg de TB33: cobrem o CH-1 inteiro (10) e 5 kg do CH-2.
    expect(await mpCell(childA1)).toMatchObject({
      status: "CONCLUIDO",
      planned: 10,
      completed: 10,
    });
    expect(await mpCell(childA2)).toMatchObject({
      status: "NAO_INICIADO",
      planned: 15,
      completed: 5,
    });
    // O pai agrega os filhos: 25 kg planejados, 15 recebidos.
    expect(await mpCell(rootA)).toMatchObject({
      status: "NAO_INICIADO",
      planned: 25,
      completed: 15,
    });

    // O saldo do material caiu de 20 para 5.
    const tb33 = (await orderMaterials(orderA)).find((m) => m.materialKey === MATERIAL_TB33);
    expect(tb33).toMatchObject({ totalKg: 20, receivedKg: 15, balanceKg: 5 });
  });

  it("a data efetiva do item é a data da nota que cobriu o material", async () => {
    const filho = await mpCell(childA1);
    expect(filho?.completedAt).not.toBeNull();
    expect(new Date(filho?.completedAt as string).toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("seletor conta os MATERIAIS com saldo (não os itens)", async () => {
    const rows = await customers();

    // OF-A: 2 materiais (TB33 com 5 kg de saldo + CHAPA com 5 kg).
    expect(rows.find((row) => row.customerName === "Cliente A")).toMatchObject({
      pendingMaterials: 2,
      pendingKg: 10,
    });
    // OF-B: 1 material (grupo sintético do item sem material).
    expect(rows.find((row) => row.customerName === "Cliente B")).toMatchObject({
      pendingMaterials: 1,
      pendingKg: 12.5,
    });
  });

  it("rejeita material que não pertence à OF", async () => {
    await asUser(db, "authenticated", gestorId);
    await expect(
      save(orderA, "NE-X", "2026-11-02", [
        {
          materialKey: "NAO EXISTE::KG",
          description: "NAO EXISTE",
          unit: "KG",
          quantityKg: 5,
        },
      ]),
    ).rejects.toThrow(/não pertence/i);
    await asSuperUser(db);

    // A RPC é transacional: a nota rejeitada não fica para trás.
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from public.mp_receipts where order_id = $1`,
      [orderA],
    );
    expect(rows[0]?.total).toBe(1);
  });

  it("rejeita material repetido na mesma nota", async () => {
    await asUser(db, "authenticated", gestorId);
    await expect(
      save(orderA, "NE-Y", "2026-11-02", [
        {
          materialKey: MATERIAL_TB33,
          description: "TB33.40X3.38",
          unit: "KG",
          quantityKg: 5,
        },
        {
          materialKey: MATERIAL_TB33,
          description: "TB33.40X3.38",
          unit: "KG",
          quantityKg: 5,
        },
      ]),
    ).rejects.toThrow(/repetido/i);
    await asSuperUser(db);
  });

  it("recebimentos parciais em n notas somam entre si", async () => {
    await asUser(db, "authenticated", gestorId);
    await save(orderA, "NE-002", "2026-11-05", [
      {
        materialKey: MATERIAL_TB33,
        description: "TB33.40X3.38",
        unit: "KG",
        quantityKg: 5,
      },
      {
        materialKey: MATERIAL_CHAPA,
        description: "CHAPA 3MM",
        unit: "KG",
        quantityKg: 5,
      },
    ]);
    await asSuperUser(db);

    // TB33 fechou (15 + 5 = 20) e a CHAPA também (5).
    const materials = await orderMaterials(orderA);
    expect(materials.find((m) => m.materialKey === MATERIAL_TB33)).toMatchObject({
      receivedKg: 20,
      balanceKg: 0,
    });
    expect(materials.find((m) => m.materialKey === MATERIAL_CHAPA)).toMatchObject({
      receivedKg: 5,
      balanceKg: 0,
    });

    // Os dois filhos ficam verdes e o pai (agregado) também.
    expect(await mpCell(childA1)).toMatchObject({ status: "CONCLUIDO" });
    expect(await mpCell(childA2)).toMatchObject({
      status: "CONCLUIDO",
      planned: 15,
      completed: 15,
    });
    expect(await mpCell(rootA)).toMatchObject({
      status: "CONCLUIDO",
      planned: 25,
      completed: 25,
    });

    // OF-A fechou: some do seletor (a OF-B segue).
    expect((await customers()).some((row) => row.customerName === "Cliente A")).toBe(false);
  });

  it("item sem material cadastrado segue recebe pelo grupo sintético", async () => {
    await asUser(db, "authenticated", gestorId);
    await save(orderB, "NE-003", "2026-11-06", [
      {
        materialKey: "ESTRUTURA SIMPLES::KG",
        description: "Estrutura simples",
        unit: "KG",
        quantityKg: 12.5,
      },
    ]);
    await asSuperUser(db);

    expect(await mpCell(rootB)).toMatchObject({
      status: "CONCLUIDO",
      planned: 12.5,
      completed: 12.5,
    });

    // Nenhuma OF com pendência — seletor vazio.
    expect(await customers()).toHaveLength(0);
  });

  it("exclusão da nota reverte o espelho e devolve o saldo", async () => {
    await asUser(db, "authenticated", gestorId);
    await db.query(`select public.delete_mp_receipt($1)`, [receipt1Id]);
    await asSuperUser(db);

    // Sem a 1ª nota sobram 5 kg de TB33 (da 2ª nota): o
    // preenchimento sequencial entrega tudo ao CH-1 (o primeiro da
    // ordem) e o CH-2 fica sem TB33 — só com os 5 kg da CHAPA.
    expect(await mpCell(childA1)).toMatchObject({
      status: "NAO_INICIADO",
      planned: 10,
      completed: 5,
    });
    expect((await mpCell(childA1))?.completedAt).toBeNull();
    expect(await mpCell(childA2)).toMatchObject({
      status: "NAO_INICIADO",
      planned: 15,
      completed: 5,
    });

    // O TB33 volta ao saldo de 15 (5 da 2ª nota + 10 que faltavam).
    const tb33 = (await orderMaterials(orderA)).find((m) => m.materialKey === MATERIAL_TB33);
    expect(tb33).toMatchObject({ totalKg: 20, receivedKg: 5, balanceKg: 15 });

    // A OF-A volta ao seletor — só o TB33 ainda tem saldo
    // (a CHAPA foi recebida por inteiro na 2ª nota).
    const rows = await customers();
    expect(rows.find((row) => row.customerName === "Cliente A")).toMatchObject({
      pendingMaterials: 1,
      pendingKg: 15,
    });
  });
});
