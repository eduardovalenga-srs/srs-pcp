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
  unitWeightKg: number | null,
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
  status: "ABERTO" | "CONFERIDO" | "CONFIRMADO" | "CANCELADO";
  shipmentDate: string | null;
  items: { orderItemId: string; quantity: number }[];
  pendingReturn: boolean;
  nfNumber?: string | null;
  returnNfNumber?: string | null;
}

/** Insere um romaneio (com itens/materiais) ligado a uma OF já criada. */
async function insertRomaneio(seed: RomaneioSeed): Promise<{ id: string; number: number }> {
  const { rows } = await db.query<{ id: string; number: number }>(
    `insert into public.romaneios (order_id, status, shipment_date, nf_number, return_nf_number)
     values ($1, $2, $3::date, $4, $5) returning id, number`,
    [seed.orderId, seed.status, seed.shipmentDate, seed.nfNumber ?? null, seed.returnNfNumber ?? null],
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
    // OF-ROM-1 → Cliente Alfa (rA, ABERTO, qtd 4 / peso 50 / devolução pendente).
    const ofAlfa = await insertOrder({ code: "OF-ROM-1", customer: "Cliente Alfa", deliveryDate: "2026-11-10" });
    const itemAlfa = await insertRootItem(ofAlfa, "P-ROME-1", "Porta Alfa", 4, 12.5, "2026-11-10");
    const romA = await insertRomaneio({
      orderId: ofAlfa,
      status: "ABERTO",
      shipmentDate: "2026-11-12",
      items: [{ orderItemId: itemAlfa, quantity: 4 }],
      pendingReturn: true,
    });

    // OF-ROM-2 → Cliente Beta (rB, CONFIRMADO, qtd 2 / peso 16 / sem devolução).
    const ofBeta = await insertOrder({ code: "OF-ROM-2", customer: "Cliente Beta", deliveryDate: "2026-11-01" });
    const itemBeta = await insertRootItem(ofBeta, "P-ROME-2", "Porta Beta", 2, 8, "2026-11-01");
    const romB = await insertRomaneio({
      orderId: ofBeta,
      status: "CONFIRMADO",
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
    // Sem linha de material em peso → regra antiga (qtd × peso unitário).
    expect(Number(rows[0]?.weight_total)).toBe(16);
    expect(rows[0]?.pending_return).toBe(false);
    expect(rows[1]?.order_code).toBe("OF-ROM-1");
    expect(Number(rows[1]?.quantity_total)).toBe(4);
    // 050: COM material em KG na carga o peso é a UTILIZADA gravada
    // (aqui 2 kg) — mesma fonte do detalhe e da ficha.
    expect(Number(rows[1]?.weight_total)).toBe(2);
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
      `select status, quantity_total, item_count from public.get_romaneios_page(p_status => 'CONFIRMADO')`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("CONFIRMADO");
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
// 047) Filtros de coluna novos da get_romaneios_page + get_romaneio_summary.
// ---------------------------------------------------------------------------

describe("RPC 047 — filtros de coluna (Nº, peso, NF) e resumo", () => {
  beforeAll(async () => {
    await db.query(`delete from public.romaneio_materials`);
    await db.query(`delete from public.romaneio_items`);
    await db.query(`delete from public.romaneios`);
    await db.query(`delete from public.order_items`);
    await db.query(`delete from public.orders`);

    // r10 → ABERTO, peso 50, NF saída 12345, sem NF de devolução.
    const of10 = await insertOrder({ code: "OF-FILT-10", customer: "Cliente Alfa", deliveryDate: "2026-11-10" });
    const item10 = await insertRootItem(of10, "P-FILT-10", "Porta 10", 4, 12.5, "2026-11-10");
    await insertRomaneio({
      orderId: of10,
      status: "ABERTO",
      shipmentDate: "2026-11-12",
      items: [{ orderItemId: item10, quantity: 4 }],
      pendingReturn: false,
      nfNumber: "12345",
    });

    // r20 → CONFERIDO, peso 16, NF saída 9999 + NF devolução 5555.
    const of20 = await insertOrder({ code: "OF-FILT-20", customer: "Cliente Beta", deliveryDate: "2026-11-01" });
    const item20 = await insertRootItem(of20, "P-FILT-20", "Porta 20", 2, 8, "2026-11-01");
    await insertRomaneio({
      orderId: of20,
      status: "CONFERIDO",
      shipmentDate: "2026-11-05",
      items: [{ orderItemId: item20, quantity: 2 }],
      pendingReturn: false,
      nfNumber: "9999",
      returnNfNumber: "5555",
    });

    // r30 → CONFIRMADO, SEM peso unitário → weight_total NULL (some do
    // filtro de peso; não conta como 0).
    const of30 = await insertOrder({ code: "OF-FILT-30", customer: "Cliente Gama", deliveryDate: "2026-11-20" });
    const item30 = await insertRootItem(of30, "P-FILT-30", "Porta 30", 1, null, "2026-11-20");
    await insertRomaneio({
      orderId: of30,
      status: "CONFIRMADO",
      shipmentDate: null,
      items: [{ orderItemId: item30, quantity: 1 }],
      pendingReturn: false,
    });
  });

  it("filtra por faixa de nº (de/ate)", async () => {
    // Os nºs vêm de sequence — leio os reais antes de montar a faixa.
    const { rows: seeded } = await db.query<{ number: number; code: string }>(
      `select r.number, o.code from public.romaneios r join public.orders o on o.id = r.order_id`,
    );
    const alfa = seeded.find((row) => row.code === "OF-FILT-10")!;
    const beta = seeded.find((row) => row.code === "OF-FILT-20")!;
    const gama = seeded.find((row) => row.code === "OF-FILT-30")!;
    expect(alfa.number).toBeLessThan(beta.number);
    expect(beta.number).toBeLessThan(gama.number);

    // Faixa de um só nº (lados inclusivos).
    const { rows } = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_number_from => $1, p_number_to => $1)`,
      [beta.number],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.order_code).toBe("OF-FILT-20");

    // Só o limite inferior: os três passam.
    const desde = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_number_from => $1)`,
      [alfa.number],
    );
    expect(desde.rows).toHaveLength(3);

    // Acima do maior nº: lista vazia.
    const acima = await db.query(
      `select 1 from public.get_romaneios_page(p_number_from => $1)`,
      [gama.number + 1000],
    );
    expect(acima.rows).toHaveLength(0);
  });

  it("filtra por faixa de peso e exclui o romaneio sem peso", async () => {
    // Peso >= 20: só o de 50 kg (o de 16 fica fora e o NULL não conta como 0).
    const { rows } = await db.query<{ order_code: string; weight_total: number | null }>(
      `select order_code, weight_total from public.get_romaneios_page(p_weight_min => 20)`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.order_code).toBe("OF-FILT-10");
    expect(Number(rows[0]?.weight_total)).toBe(50);

    // Peso <= 20: só o de 16 kg — o NULL continua fora.
    const ate = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_weight_max => 20)`,
    );
    expect(ate.rows).toHaveLength(1);
    expect(ate.rows[0]?.order_code).toBe("OF-FILT-20");
  });

  it("filtra por NF de saída e por NF de devolução (contém)", async () => {
    const nfSaida = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_nf_number => '123')`,
    );
    expect(nfSaida.rows).toHaveLength(1);
    expect(nfSaida.rows[0]?.order_code).toBe("OF-FILT-10");

    const nfDev = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_return_nf => '55')`,
    );
    expect(nfDev.rows).toHaveLength(1);
    expect(nfDev.rows[0]?.order_code).toBe("OF-FILT-20");
  });

  it("combina os filtros novos com os antigos e devolve o total certo", async () => {
    const { rows } = await db.query<{ total_count: number; order_code: string }>(
      `select total_count, order_code
         from public.get_romaneios_page(p_status => 'ABERTO', p_nf_number => '12345')`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.total_count)).toBe(1);
    expect(rows[0]?.order_code).toBe("OF-FILT-10");

    // Nada combina → lista vazia, total_count 0.
    const vazio = await db.query(
      `select total_count from public.get_romaneios_page(p_number_from => 9999)`,
    );
    expect(vazio.rows).toHaveLength(0);
  });

  it("get_romaneio_summary devolve 1 linha com o mesmo filtro da lista", async () => {
    const { rows } = await db.query<{
      total_count: number;
      open_count: number;
      conferred_count: number;
      confirmed_count: number;
    }>(`select * from public.get_romaneio_summary()`);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.total_count)).toBe(3);
    expect(Number(rows[0]?.open_count)).toBe(1);
    expect(Number(rows[0]?.conferred_count)).toBe(1);
    expect(Number(rows[0]?.confirmed_count)).toBe(1);
  });

  it("no resumo o total respeita a situação e o breakdown a ignora", async () => {
    const { rows } = await db.query<{
      total_count: number;
      open_count: number;
      confirmed_count: number;
    }>(`select * from public.get_romaneio_summary(p_status => 'ABERTO')`);

    expect(Number(rows[0]?.total_count)).toBe(1); // bate com a lista filtrada
    expect(Number(rows[0]?.open_count)).toBe(1); // breakdown continua completo
    expect(Number(rows[0]?.confirmed_count)).toBe(1);
  });

  it("no resumo os filtros de coluna valem igual (peso incluído)", async () => {
    const { rows } = await db.query<{
      total_count: number;
      open_count: number;
      conferred_count: number;
      confirmed_count: number;
    }>(`select * from public.get_romaneio_summary(p_weight_min => 20)`);

    // Só o de 50 kg passa no filtro de peso — inclusive no resumo.
    expect(Number(rows[0]?.total_count)).toBe(1);
    expect(Number(rows[0]?.open_count)).toBe(1);
    expect(Number(rows[0]?.conferred_count)).toBe(0);
    expect(Number(rows[0]?.confirmed_count)).toBe(0);
  });

  it("authenticated executa as duas RPCs (grant da migração 049)", async () => {
    const { rows } = await db.query<{ page: boolean; summary: boolean }>(
      `select has_function_privilege('authenticated', 'public.get_romaneios_page(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text, integer, integer, text, text)', 'EXECUTE') as page,
              has_function_privilege('authenticated', 'public.get_romaneio_summary(text, text, text, text, date, date, bigint, bigint, numeric, numeric, text, text, text, text)', 'EXECUTE') as summary`,
    );
    expect(rows[0]?.page).toBe(true);
    expect(rows[0]?.summary).toBe(true);
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
      status: "ABERTO",
      shipmentDate: null,
      items: [{ orderItemId: itemZeta, quantity: 5 }],
      pendingReturn: false,
    });

    // OF-ROM-4 → Cliente Alfa, entrega 15/10, raiz qty 3, 1 já expedida (CONFIRMADO).
    const ofAlfa = await insertOrder({ code: "OF-CAND-4", customer: "Cliente Alfa", deliveryDate: "2026-10-15" });
    const itemAlfa = await insertRootItem(ofAlfa, "P-ROME-4", "Porta Alfa 2", 3, 10, "2026-10-15");
    const romConfirmed = await insertRomaneio({
      orderId: ofAlfa,
      status: "CONFIRMADO",
      shipmentDate: "2026-10-20",
      items: [{ orderItemId: itemAlfa, quantity: 1 }],
      pendingReturn: false,
    });
    expect(romConfirmed.id).toBeTruthy();
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
      has_open: boolean;
      open_romaneio_id: string | null;
    }>(`select order_id, code, customer_name, delivery_date, root_quantity, root_weight_kg, shipped_quantity, has_open, open_romaneio_id
             from public.get_romaneio_candidates()`);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.code).toBe("OF-CAND-4"); // entrega 10/15 < 12/01
    expect(Number(rows[0]?.root_quantity)).toBe(3);
    // O expedido só conta o que está CONFIRMADO.
    expect(Number(rows[0]?.shipped_quantity)).toBe(1);
    expect(rows[0]?.has_open).toBe(false);
    expect(rows[0]?.open_romaneio_id).toBeNull();
    expect(rows[1]?.code).toBe("OF-CAND-3"); // entrega 12/01
    expect(Number(rows[1]?.root_quantity)).toBe(5);
    expect(Number(rows[1]?.shipped_quantity)).toBe(0);
    // A OF com romaneio em aberto expõe o id do rascunho aberto.
    expect(rows[1]?.has_open).toBe(true);
    expect(rows[1]?.open_romaneio_id).toBeTruthy();
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

// ---------------------------------------------------------------------------
// get_romaneio_customers (044) — seletor em cascata cliente → OFs (jsonb).
// ---------------------------------------------------------------------------

/** Linha do seletor em cascata (jsonb chega como objeto ou texto). */
interface CustomerRow {
  customer_name: string | null;
  of_count: number | string;
  ofs: {
    order_id: string;
    code: string;
    type: string;
    delivery_date: string | null;
    status: string;
    root_quantity: number;
    root_weight_kg: number | null;
    shipped_quantity: number;
    has_open: boolean;
    open_romaneio_id: string | null;
  }[];
}

function parseOfs(row: CustomerRow): CustomerRow["ofs"] {
  return typeof row.ofs === "string" ? JSON.parse(row.ofs) : row.ofs;
}

describe("RPC get_romaneio_customers (044) — seletor em cascata", () => {
  beforeAll(async () => {
    await db.query(`delete from public.romaneio_materials`);
    await db.query(`delete from public.romaneio_items`);
    await db.query(`delete from public.romaneios`);
    await db.query(`delete from public.order_items`);
    await db.query(`delete from public.orders`);

    // Cliente Alfa: DUAS OFs disponíveis — a primeira (10/11) com
    // romaneio em aberto, a segunda (01/11) sem rascunho.
    const alfaA = await insertOrder({
      code: "OF-CUST-1",
      customer: "Cliente Alfa",
      deliveryDate: "2026-11-10",
    });
    const alfaAItem = await insertRootItem(alfaA, "P-CUST-1", "Porta Alfa 1", 4, 10, "2026-11-10");
    const mountedAlfa = await insertRomaneio({
      orderId: alfaA,
      status: "ABERTO",
      shipmentDate: null,
      items: [{ orderItemId: alfaAItem, quantity: 4 }],
      pendingReturn: false,
    });
    expect(mountedAlfa.id).toBeTruthy();

    const alfaB = await insertOrder({
      code: "OF-CUST-2",
      customer: "Cliente Alfa",
      deliveryDate: "2026-11-01",
    });
    await insertRootItem(alfaB, "P-CUST-2", "Porta Alfa 2", 3, 8, "2026-11-01");

    // Cliente Beta: única OF TOTALMENTE expedida (2 de 2 em CONFIRMADO) —
    // nem a OF nem o cliente podem aparecer no seletor.
    const beta = await insertOrder({
      code: "OF-CUST-3",
      customer: "Cliente Beta",
      deliveryDate: "2026-11-05",
    });
    const betaItem = await insertRootItem(beta, "P-CUST-3", "Porta Beta", 2, 5, "2026-11-05");
    const romBeta = await insertRomaneio({
      orderId: beta,
      status: "CONFIRMADO",
      shipmentDate: "2026-11-06",
      items: [{ orderItemId: betaItem, quantity: 2 }],
      pendingReturn: false,
    });
    expect(romBeta.id).toBeTruthy();

    // Sem cliente (nome em branco) → bucket único, sempre no fim.
    const semCliente = await insertOrder({
      code: "OF-CUST-4",
      customer: "",
      deliveryDate: "2026-11-20",
    });
    await insertRootItem(semCliente, "P-CUST-4", "Porta sem cliente", 1, 4, "2026-11-20");
  });

  it("agrupa por cliente, conta as OFs e devolve as OFs em jsonb", async () => {
    const { rows } = await db.query<CustomerRow>(
      `select customer_name, of_count, ofs from public.get_romaneio_customers()`,
    );

    // Beta some inteira (totalmente expedida); Alfa e o bucket sem
    // cliente continuam.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.customer_name)).toEqual(["Cliente Alfa", null]);
    expect(Number(rows[0]?.of_count)).toBe(2);
    expect(Number(rows[1]?.of_count)).toBe(1);

    const alfaOfs = parseOfs(rows[0]!);
    expect(alfaOfs.map((of) => of.code)).toEqual(["OF-CUST-2", "OF-CUST-1"]);
    expect(alfaOfs.map((of) => of.delivery_date)).toEqual(["2026-11-01", "2026-11-10"]);
    expect(Number(alfaOfs[0]?.root_quantity)).toBe(3);
    expect(Number(alfaOfs[0]?.root_weight_kg)).toBe(24);
    expect(Number(alfaOfs[0]?.shipped_quantity)).toBe(0);
    expect(alfaOfs[0]?.type).toBe("OF");
  });

  it("marca a OF com romaneio em aberto (badge do seletor) e a sem rascunho", async () => {
    const { rows } = await db.query<CustomerRow>(
      `select customer_name, of_count, ofs from public.get_romaneio_customers()`,
    );
    const alfaOfs = parseOfs(rows[0]!);

    const comAberto = alfaOfs.find((of) => of.code === "OF-CUST-1");
    const semAberto = alfaOfs.find((of) => of.code === "OF-CUST-2");
    expect(comAberto?.has_open).toBe(true);
    expect(comAberto?.open_romaneio_id).toBeTruthy();
    expect(semAberto?.has_open).toBe(false);
    expect(semAberto?.open_romaneio_id).toBeNull();
  });

  it("ordena os clientes em ASC com o bucket sem cliente no fim", async () => {
    const { rows } = await db.query<{ customer_name: string | null }>(
      `select customer_name from public.get_romaneio_customers()`,
    );
    // Alfa (A) antes de Beta — e Beta não existe; null sempre por último.
    expect(rows.map((row) => row.customer_name)).toEqual(["Cliente Alfa", null]);
    expect(rows[rows.length - 1]?.customer_name).toBeNull();
  });

  it("authenticated executa a RPC (grant da migração 044)", async () => {
    const { rows } = await db.query<{ authenticated: boolean }>(
      `select has_function_privilege('authenticated', 'public.get_romaneio_customers()', 'EXECUTE') as authenticated`,
    );
    expect(rows[0]?.authenticated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 049) Colunas de processos da Fábrica 2 — agregação sobre os itens da
//      carga, filtro por par processo+situação e ordenação por pior situação.
// ---------------------------------------------------------------------------

/** Marca um processo em um item (insere a linha de production_processes). */
async function setProcess(orderItemId: string, code: string, status: string): Promise<void> {
  await db.query(
    `insert into public.production_processes (order_item_id, process_id, status)
     values ($1, (select id from public.processes where code = $2), $3)
     on conflict (order_item_id, process_id) do update set status = excluded.status`,
    [orderItemId, code, status],
  );
}

/** jsonb da RPC pode chegar como objeto ou texto — normaliza. */
function parseProcesses(value: unknown): Record<string, string> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, string>;
  return (value ?? {}) as Record<string, string>;
}

describe("RPC 049 — colunas de processos da Fábrica 2 na listagem", () => {
  beforeAll(async () => {
    await db.query(`delete from public.romaneio_materials`);
    await db.query(`delete from public.romaneio_items`);
    await db.query(`delete from public.romaneios`);
    await db.query(`delete from public.order_items`);
    await db.query(`delete from public.orders`);

    // r1 → ABERTO: SOLDA concluída no RAIZ + KIT concluída no FILHO
    // (039: o KIT da carga vem agregado dos filhos).
    const of1 = await insertOrder({ code: "OF-PROC-1", customer: "Cliente Alfa", deliveryDate: "2026-11-10" });
    const root1 = await insertRootItem(of1, "P-PROC-1", "Porta 1", 4, 10, "2026-11-10");
    const child1 = await insertRootItem(of1, "P-PROC-1A", "Portão filho", 2, 3, "2026-11-10");
    await db.query(`update public.order_items set parent_order_item_id = $1 where id = $2`, [root1, child1]);
    await setProcess(root1, "SOLDA", "CONCLUIDO");
    await setProcess(child1, "KIT", "CONCLUIDO");
    const r1 = await insertRomaneio({
      orderId: of1,
      status: "ABERTO",
      shipmentDate: null,
      items: [{ orderItemId: root1, quantity: 4 }],
      pendingReturn: false,
    });

    // r2 → CONFERIDO: SOLDA não iniciada no raiz + EXP não aplicável.
    const of2 = await insertOrder({ code: "OF-PROC-2", customer: "Cliente Beta", deliveryDate: "2026-11-05" });
    const root2 = await insertRootItem(of2, "P-PROC-2", "Porta 2", 2, 8, "2026-11-05");
    await setProcess(root2, "SOLDA", "NAO_INICIADO");
    await setProcess(root2, "EXP", "NAO_APLICAVEL");
    const r2 = await insertRomaneio({
      orderId: of2,
      status: "CONFERIDO",
      shipmentDate: null,
      items: [{ orderItemId: root2, quantity: 2 }],
      pendingReturn: false,
    });

    // r3 → CONFIRMADO: item SEM nenhum processo — agregado vazio.
    const of3 = await insertOrder({ code: "OF-PROC-3", customer: "Cliente Gama", deliveryDate: "2026-11-20" });
    const root3 = await insertRootItem(of3, "P-PROC-3", "Porta 3", 1, null, "2026-11-20");
    const r3 = await insertRomaneio({
      orderId: of3,
      status: "CONFIRMADO",
      shipmentDate: null,
      items: [{ orderItemId: root3, quantity: 1 }],
      pendingReturn: false,
    });
    expect(r1.id).toBeTruthy();
    expect(r2.id).toBeTruthy();
    expect(r3.id).toBeTruthy();
  });

  it("agrega a pior situação por processo SÓ sobre os itens da carga", async () => {
    const { rows } = await db.query<{ order_code: string; processes: unknown }>(
      `select order_code, processes from public.get_romaneios_page(p_sort => 'order_code', p_sort_dir => 'asc')`,
    );
    expect(rows).toHaveLength(3);

    const byCode = new Map(rows.map((row) => [row.order_code, parseProcesses(row.processes)]));
    // r1: SOLDA do raiz CONCLUIDO + KIT agregada dos FILHOS (039).
    expect(byCode.get("OF-PROC-1")).toMatchObject({ SOLDA: "CONCLUIDO", KIT: "CONCLUIDO" });
    // r2: pior situação do raiz; NAO_APLICAVEL vira valor (célula "—").
    expect(byCode.get("OF-PROC-2")).toEqual({ SOLDA: "NAO_INICIADO", EXP: "NAO_APLICAVEL" });
    // r3: nenhum processo nos itens → objeto vazio (tudo "—").
    expect(byCode.get("OF-PROC-3")).toEqual({});
  });

  it("filtra pelo par processo+situação (um por vez)", async () => {
    const concluida = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_process_code => 'SOLDA', p_process_status => 'CONCLUIDO')`,
    );
    expect(concluida.rows.map((row) => row.order_code)).toEqual(["OF-PROC-1"]);

    const naoAplicavel = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_process_code => 'EXP', p_process_status => 'NAO_APLICAVEL')`,
    );
    expect(naoAplicavel.rows.map((row) => row.order_code)).toEqual(["OF-PROC-2"]);

    // KIT vem dos filhos — filtra como as demais colunas.
    const kit = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_process_code => 'KIT', p_process_status => 'CONCLUIDO')`,
    );
    expect(kit.rows.map((row) => row.order_code)).toEqual(["OF-PROC-1"]);

    // Processo sem nenhuma linha na carga não casa (chave ausente).
    const semChave = await db.query(
      `select order_code from public.get_romaneios_page(p_process_code => 'ACAB', p_process_status => 'CONCLUIDO')`,
    );
    expect(semChave.rows).toHaveLength(0);

    // Par incompleto não filtra (mesma regra do backend da Fábrica 2).
    const semSituacao = await db.query(
      `select order_code from public.get_romaneios_page(p_process_code => 'SOLDA')`,
    );
    expect(semSituacao.rows).toHaveLength(3);
  });

  it("ordena pela pior situação do processo (asc = melhor primeiro)", async () => {
    const asc = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_sort => 'SOLDA', p_sort_dir => 'asc')`,
    );
    // CONCLUIDO (1) → NAO_INICIADO (2) → sem processo (null) no fim.
    expect(asc.rows.map((row) => row.order_code)).toEqual([
      "OF-PROC-1",
      "OF-PROC-2",
      "OF-PROC-3",
    ]);

    const desc = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_sort => 'SOLDA', p_sort_dir => 'desc')`,
    );
    expect(desc.rows.map((row) => row.order_code)).toEqual([
      "OF-PROC-2",
      "OF-PROC-1",
      "OF-PROC-3",
    ]);
  });

  it("código de processo fora do catálogo não quebra a ordenação", async () => {
    const { rows } = await db.query<{ order_code: string }>(
      `select order_code from public.get_romaneios_page(p_sort => 'NAO_EXISTE', p_sort_dir => 'asc')`,
    );
    // Código inexistente em `processes` cai na ordenação default (nº).
    expect(rows).toHaveLength(3);
  });

  it("no resumo o filtro de processo vale igual (total bate com a lista)", async () => {
    const { rows } = await db.query<{
      total_count: number;
      open_count: number;
      conferred_count: number;
      confirmed_count: number;
    }>(`select * from public.get_romaneio_summary(p_process_code => 'SOLDA', p_process_status => 'CONCLUIDO')`);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.total_count)).toBe(1); // mesma contagem da lista
    expect(Number(rows[0]?.open_count)).toBe(1); // r1 é ABERTO
    expect(Number(rows[0]?.conferred_count)).toBe(0);
    expect(Number(rows[0]?.confirmed_count)).toBe(0);
  });
});
