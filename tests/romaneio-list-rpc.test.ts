import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, createTestDatabase } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;
  await asSuperUser(db);
});

afterAll(async () => {
  await close();
});

/** Item raiz com peso unitário e data de entrega (mesmo shape do createItem da F1). */
async function insertRootItem(
  orderId: string,
  parentItem: string,
  description: string,
  quantity: number,
  unitWeightKg: number,
  deliveryDate: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, $5, $6, 'EM_PRODUCAO') returning id`,
    [orderId, parentItem, description, quantity, unitWeightKg, deliveryDate],
  );
  return rows[0]?.id as string;
}

interface RomaneioSeed {
  orderId: string;
  status: "SIMULACAO" | "EMITIDO" | "CANCELADO";
  shipmentDate: string | null;
  items: { orderItemId: string; quantity: number }[];
  pendingReturn: boolean;
}

/** Insere um romaneio (com itens/materiais) ligado a uma OF já criada. */
async function insertRomaneio(seed: RomaneioSeed): Promise<{ id: string; number: number }> {
  const { rows } = await db.query<{ id: string; number: number }>(
    `insert into public.romaneios (order_id, status, shipment_date)
     values ($1, $2, $3::date) returning id, number`,
    [seed.orderId, seed.status, seed.shipmentDate],
  );
  const romaneio = rows[0]!;
  for (const item of seed.items) {
    await db.query(
      `insert into public.romaneio_items (romaneio_id, order_item_id, quantity) values ($1, $2, $3)`,
      [romaneio.id, item.orderItemId, item.quantity],
    );
  }
  if (seed.pendingReturn) {
    // Saldo de devolução sem NF de devolução registrada (received − used > 0).
    await db.query(
      `insert into public.romaneio_materials (romaneio_id, description, unit, quantity_planned, quantity_received, quantity_used)
       values ($1, 'CHAPA-90', 'KG', 10, 4, 2)`,
      [romaneio.id],
    );
  }
  return romaneio;
}

interface OrderSeed {
  code: string;
  customer: string;
  deliveryDate: string;
}

async function insertOrder(seed: OrderSeed): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, delivery_date, status)
     values ($1, 'OF', $2, $3::date, 'EM_PRODUCAO') returning id`,
    [seed.code, seed.customer, seed.deliveryDate],
  );
  return rows[0]!.id;
}

/** ---------------------------------------------------------------------------
 * get_romaneios_page (043) — listagem de romaneios com ordenação por coluna.
 * ------------------------------------------------------------------------- */

describe("RPC get_romaneios_page (043) — listagem de romaneios ordenável", () => {
  beforeAll(async () => {
    // OF-ROM-1 → Cliente Alfa (rA, SIMULACAO, qtd 4 / peso 50 / devolução pendente).
    const ofAlfa = await insertOrder({ code: "OF-ROM-1", customer: "Cliente Alfa", deliveryDate: "2026-11-10" });
    const itemAlfa = await insertRootItem(ofAlfa, "P-ROME-1", "Porta Alfa", 4, 12.5, "2026-11-10");
    const romA = await insertRomaneio({
      orderId: ofAlfa,
      status: "SIMULACAO",
      shipmentDate: "2026-11-12",
      items: [{ orderItemId: itemAlfa, quantity: 4 }],
      pendingReturn: true,
    });

    // OF-ROM-2 → Cliente Beta (rB, EMITIDO, qtd 2 / peso 16 / sem devolução).
    const ofBeta = await insertOrder({ code: "OF-ROM-2", customer: "Cliente Beta", deliveryDate: "2026-11-01" });
    const itemBeta = await insertRootItem(ofBeta, "P-ROME-2", "Porta Beta", 2, 8, "2026-11-01");
    const romB = await insertRomaneio({
      orderId: ofBeta,
      status: "EMITIDO",
      shipmentDate: "2026-11-05",
      items: [{ orderItemId: itemBeta, quantity: 2 }],
      pendingReturn: false,
    });

    // Sanidade: os dois romaneios existem com os agregados esperados.
    expect(romA.id).toBeTruthy();
    expect(romB.id).toBeTruthy();
  });

  it("retorna a listagem completa com totais e ordena por nº desc (default)", async () => {
    const { rows } = await db.query<{
      total_count: number;
      id: string;
      number: number;
      order_code: string;
      customer_name: string | null;
      item_count: number;
      quantity_total: number;
      weight_total: number | null;
      pending_return: boolean;
    }>(`select * from public.get_romaneios_page()`);

    expect(rows).toHaveLength(2);
    expect(Number(rows[0]?.total_count)).toBe(2);
    // Default: nº desc → a última inserida (OF-ROM-2, nº 2) vem primeiro.
    expect(rows[0]?.order_code).toBe("OF-ROM-2");
    expect(Number(rows[0]?.quantity_total)).toBe(2);
    expect(Number(rows[0]?.weight_total)).toBe(16);
    expect(rows[0]?.pending_return).toBe(false);
    expect(rows[1]?.order_code).toBe("OF-ROM-1");
    expect(Number(rows[1]?.quantity_total)).toBe(4);
    expect(Number(rows[1]?.weight_total)).toBe(50);
    expect(rows[1]?.pending_return).toBe(true);
  });

  it("ordena por customer asc e desc (whitelist da coluna)", async () => {
    const asc = await db.query<{
      customer_name: string | null;
      order_code: string;
      number: number;
    }>(`select customer_name, order_code, number from public.get_romaneios_page(p_sort => 'customer', p_sort_dir => 'asc')`);
    expect(asc.rows[0]?.customer_name).toBe("Cliente Alfa");
    expect(asc.rows[0]?.order_code).toBe("OF-ROM-1");

    const desc = await db.query<{ customer_name: string | null; order_code: string }>(
      `select customer_name, order_code from public.get_romaneios_page(p_sort => 'customer', p_sort_dir => 'desc')`,
    );
    expect(desc.rows[0]?.customer_name).toBe("Cliente Beta");
    expect(desc.rows[0]?.order_code).toBe("OF-ROM-2");
  });

  it("ordena por quantity_total desc/asc sobre os agregados do banco", async () => {
    const desc = await db.query<{ order_code: string; quantity_total: number }>(
      `select order_code, quantity_total from public.get_romaneios_page(p_sort => 'quantity_total', p_sort_dir => 'desc')`,
    );
    expect(desc.rows[0]?.order_code).toBe("OF-ROM-1"); // 4 > 2

    const asc = await db.query<{ order_code: string; quantity_total: number }>(
      `select order_code, quantity_total from public.get_romaneios_page(p_sort => 'quantity_total', p_sort_dir => 'asc')`,
    );
    expect(asc.rows[0]?.order_code).toBe("OF-ROM-2"); // 2 < 4
  });

  it("filtra por status e devolve o agregado correspondente", async () => {
    const { rows } = await db.query<{ status: string; quantity_total: number; item_count: number }>(
      `select status, quantity_total, item_count from public.get_romaneios_page(p_status => 'EMITIDO')`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("EMITIDO");
    expect(Number(rows[0]?.quantity_total)).toBe(2);
    expect(Number(rows[0]?.item_count)).toBe(1);
  });

  it("busca por termo (código da OF) e devolve o romaneio correto", async () => {
    const { rows } = await db.query<{ order_code: string; quantity_total: number }>(
      `select order_code, quantity_total from public.get_romaneios_page(p_search => 'OF-ROM-1')`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.order_code).toBe("OF-ROM-1");
    expect(Number(rows[0]?.quantity_total)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// get_romaneio_candidates (043) — seletor de OFs candidatas com agregados.
// ---------------------------------------------------------------------------

describe("RPC get_romaneio_candidates (043) — seletor de OFs ordenável", () => {
  beforeAll(async () => {
    // OF-ROM-3 → Cliente Zeta, entrega 12/12, raiz qty 5, sem expedição ainda.
    await db.query(`delete from public.romaneio_materials`);
    await db.query(`delete from public.romaneio_items`);
    await db.query(`delete from public.romaneios`);
    await db.query(`delete from public.order_items`);
    await db.query(`delete from public.orders`);
    const ofZeta = await insertOrder({ code: "OF-CAND-3", customer: "Cliente Zeta", deliveryDate: "2026-12-01" });
    const itemZeta = await insertRootItem(ofZeta, "P-ROME-3", "Porta Zeta", 5, 10, "2026-12-01");
    await insertRomaneio({
      orderId: ofZeta,
      status: "SIMULACAO",
      shipmentDate: null,
      items: [{ orderItemId: itemZeta, quantity: 5 }],
      pendingReturn: false,
    });

    // OF-ROM-4 → Cliente Alfa, entrega 15/10, raiz qty 3, 1 já expedida (EMITIDO).
    const ofAlfa = await insertOrder({ code: "OF-CAND-4", customer: "Cliente Alfa", deliveryDate: "2026-10-15" });
    const itemAlfa = await insertRootItem(ofAlfa, "P-ROME-4", "Porta Alfa 2", 3, 10, "2026-10-15");
    const romEmitted = await insertRomaneio({
      orderId: ofAlfa,
      status: "EMITIDO",
      shipmentDate: "2026-10-20",
      items: [{ orderItemId: itemAlfa, quantity: 1 }],
      pendingReturn: false,
    });
    expect(romEmitted.id).toBeTruthy();
  });

  it("retorna candidatas com agregados e ordena por entrega asc (default: entrega asc, código asc)", async () => {
    const { rows } = await db.query<{
      order_id: string;
      code: string;
      customer_name: string | null;
      delivery_date: string | null;
      root_quantity: number;
      root_weight_kg: number | null;
      shipped_quantity: number;
      has_simulation: boolean;
    }>(`select order_id, code, customer_name, delivery_date, root_quantity, root_weight_kg, shipped_quantity, has_simulation
             from public.get_romaneio_candidates()`);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.code).toBe("OF-CAND-4"); // entrega 10/15 < 12/01
    expect(Number(rows[0]?.root_quantity)).toBe(3);
    expect(Number(rows[0]?.shipped_quantity)).toBe(1);
    expect(rows[1]?.code).toBe("OF-CAND-3"); // entrega 12/01
    expect(Number(rows[1]?.root_quantity)).toBe(5);
    expect(Number(rows[1]?.shipped_quantity)).toBe(0);
  });

  it("ordena por customer asc sobre o seletor", async () => {
    const { rows } = await db.query<{ customer_name: string | null; code: string }>(
      `select customer_name, code from public.get_romaneio_candidates(p_sort => 'customer', p_sort_dir => 'asc')`,
    );
    expect(rows[0]?.customer_name).toBe("Cliente Alfa");
    expect(rows[0]?.code).toBe("OF-CAND-4");
  });

  it("ordena por shipped_quantity desc sobre o seletor", async () => {
    const { rows } = await db.query<{ code: string; shipped_quantity: number }>(
      `select code, shipped_quantity from public.get_romaneio_candidates(p_sort => 'shipped', p_sort_dir => 'desc')`,
    );
    expect(rows[0]?.code).toBe("OF-CAND-4"); // 1 > 0
    expect(Number(rows[0]?.shipped_quantity)).toBe(1);

    const asc = await db.query<{ code: string; shipped_quantity: number }>(
      `select code, shipped_quantity from public.get_romaneio_candidates(p_sort => 'shipped', p_sort_dir => 'asc')`,
    );
    expect(asc.rows[0]?.code).toBe("OF-CAND-3"); // 0 < 1
  });

  it("busca por termo (cliente) no seletor", async () => {
    const { rows } = await db.query<{ code: string }>(
      `select code from public.get_romaneio_candidates(p_search => 'Cliente Zeta')`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("OF-CAND-3");
  });
});
