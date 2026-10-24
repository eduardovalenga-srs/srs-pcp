import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import {
  allocateRomaneioMaterials,
  checkRomaneioEmission,
  materialReturnQuantity,
  mergeRomaneioMaterialLines,
} from "@/lib/utils/romaneio";
import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let gestorId: string;
let operadorId: string;

interface ProcessInput {
  code: string;
  status: string;
}

async function createOrder(code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, status)
     values ($1, 'OF', 'Metalúrgica Alfa', 'EM_PRODUCAO') returning id`,
    [code],
  );
  return rows[0]?.id as string;
}

/** Item RAIZ com processos e materiais próprios. */
async function createRootItem(
  orderId: string,
  description: string,
  quantity: number,
  processes: ProcessInput[],
  materials: { description: string; quantity: number; unit: string }[] = [],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, 10, 'EM_PRODUCAO') returning id`,
    [orderId, description, description, quantity],
  );
  const itemId = rows[0]?.id as string;

  for (const process of processes) {
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status, quantity_planned, quantity_completed)
       select $1, p.id, $3, $2, $2
         from public.processes p where p.code = $4`,
      [itemId, quantity, process.status, process.code],
    );
  }

  for (const material of materials) {
    await db.query(
      `insert into public.order_item_materials (order_item_id, description, quantity, unit)
       values ($1, $2, $3, $4)`,
      [itemId, material.description, material.quantity, material.unit],
    );
  }

  return itemId;
}

/** Item FILHO (016) — materiais dos filhos entram na alocação × ratio. */
async function createChildItem(
  orderId: string,
  parentItemId: string,
  description: string,
  quantity: number,
  materials: { description: string; quantity: number; unit: string }[] = [],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, parent_order_item_id, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, 2, $5, 'EM_PRODUCAO') returning id`,
    [orderId, description, description, quantity, parentItemId],
  );
  const itemId = rows[0]?.id as string;

  for (const material of materials) {
    await db.query(
      `insert into public.order_item_materials (order_item_id, description, quantity, unit)
       values ($1, $2, $3, $4)`,
      [itemId, material.description, material.quantity, material.unit],
    );
  }

  return itemId;
}

interface SaveParams {
  romaneioId?: string | null;
  orderId: string;
  shipmentDate?: string | null;
  carrier?: string | null;
  vehicle?: string | null;
  notes?: string | null;
  items: { orderItemId: string; quantity: number }[];
  materials?: {
    description: string;
    unit: string;
    quantityPlanned?: number | null;
    quantityReceived?: number | null;
    quantityUsed?: number | null;
  }[];
}

async function saveRomaneio(params: SaveParams): Promise<{ id: string; number: number }> {
  const { rows } = await db.query<{ save_romaneio: { id: string; number: number } }>(
    `select public.save_romaneio(
       $1::uuid, $2::uuid, $3::date, $4::text, $5::text, $6::text, $7::jsonb, $8::jsonb
     )`,
    [
      params.romaneioId ?? null,
      params.orderId,
      params.shipmentDate ?? null,
      params.carrier ?? null,
      params.vehicle ?? null,
      params.notes ?? null,
      JSON.stringify(params.items),
      JSON.stringify(params.materials ?? []),
    ],
  );
  return rows[0]!.save_romaneio;
}

async function signConference(romaneioId: string, notes: string | null = null): Promise<void> {
  await db.query(`select public.sign_romaneio_conference($1::uuid, $2::text)`, [romaneioId, notes]);
}

async function emitRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.emit_romaneio($1::uuid)`, [romaneioId]);
}

async function cancelRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.cancel_romaneio($1::uuid)`, [romaneioId]);
}

async function romaneioStatus(romaneioId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    `select status from public.romaneios where id = $1`,
    [romaneioId],
  );
  return rows[0]!.status;
}

// OF-R01: raiz A (EXP concluído, com materiais no raiz e no filho) e raiz B
// (EXP pendente) — bloqueia a emissão até concluir.
let orderR1: string;
let rootA: string;
let rootB: string;
let childA: string;

// OF-R02: única raiz, EXP concluído — flujos de emissão/cancelamento.
let orderR2: string;
let rootC: string;

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;

  await asSuperUser(db);
  gestorId = await createUser(db, "gestor.romaneio@serralheria.com", "GESTOR");
  operadorId = await createUser(db, "operador.romaneio@serralheria.com", "OPERADOR");

  orderR1 = await createOrder("OF-R01");
  rootA = await createRootItem(
    orderR1,
    "Treliça metálica",
    10,
    [{ code: "EXP", status: "CONCLUIDO" }],
    [{ description: "Chapa aço 3mm", quantity: 20, unit: "KG" }],
  );
  childA = await createChildItem(
    orderR1,
    rootA,
    "Porta metálica",
    5,
    [{ description: "Parafuso M8", quantity: 50, unit: "UN" }],
  );
  rootB = await createRootItem(orderR1, "Corrimão inox", 6, [{ code: "EXP", status: "NAO_INICIADO" }]);

  orderR2 = await createOrder("OF-R02");
  rootC = await createRootItem(
    orderR2,
    "Grade de proteção",
    4,
    [{ code: "EXP", status: "CONCLUIDO" }],
    [{ description: "Tinta pó", quantity: 8, unit: "KG" }],
  );
});

afterAll(async () => {
  await close();
});

describe("regras puras do romaneio", () => {
  it("aloca os materiais do raiz e dos filhos proporcionalmente à carga", () => {
    const lines = allocateRomaneioMaterials({
      includedItems: [{ orderItemId: "raiz-1", quantity: 5 }],
      orderItems: [
        {
          orderItemId: "raiz-1",
          parentItemId: null,
          quantity: 10,
          materials: [{ description: "Chapa aço 3mm", unit: "KG", quantity: 20 }],
        },
        {
          orderItemId: "filho-1",
          parentItemId: "raiz-1",
          quantity: 5,
          materials: [{ description: "Parafuso M8", unit: "UN", quantity: 50 }],
        },
        {
          orderItemId: "raiz-2",
          parentItemId: null,
          quantity: 6,
          materials: [{ description: "Corrimão inox", unit: "M", quantity: 12 }],
        },
      ],
    });

    // Metade da raiz-1: 50% dos materiais do raiz E do filho. Raiz-2 fora.
    expect(lines).toEqual([
      { description: "Chapa aço 3mm", unit: "KG", quantityPlanned: 10 },
      { description: "Parafuso M8", unit: "UN", quantityPlanned: 25 },
    ]);
  });

  it("soma materiais iguais (descrição+unidade) vindos de itens diferentes", () => {
    const lines = allocateRomaneioMaterials({
      includedItems: [
        { orderItemId: "raiz-1", quantity: 10 },
        { orderItemId: "raiz-2", quantity: 10 },
      ],
      orderItems: [
        {
          orderItemId: "raiz-1",
          parentItemId: null,
          quantity: 10,
          materials: [{ description: "  chapa aço 3mm ", unit: "kg", quantity: 4 }],
        },
        {
          orderItemId: "raiz-2",
          parentItemId: null,
          quantity: 10,
          materials: [{ description: "Chapa Aço 3MM", unit: "KG", quantity: 6 }],
        },
      ],
    });

    // A chave do merge é normalizada (descrição trim/minúscula + unidade);
    // a descrição exibida é a PRIMEIRA vista (trim).
    expect(lines).toEqual([
      { description: "chapa aço 3mm", unit: "KG", quantityPlanned: 10 },
    ]);
  });

  it("mergeia linhas alocadas com o já informado e mantém linhas órfãs gravadas", () => {
    const merged = mergeRomaneioMaterialLines(
      [
        { description: "Chapa aço 3mm", unit: "KG", quantityPlanned: 10 },
        { description: "Parafuso M8", unit: "UN", quantityPlanned: 25 },
      ],
      [
        {
          description: "Chapa aço 3mm",
          unit: "KG",
          quantityPlanned: 999,
          quantityReceived: 12,
          quantityUsed: 10,
        },
        {
          description: "Tinta pó",
          unit: "KG",
          quantityPlanned: 8,
          quantityReceived: null,
          quantityUsed: null,
        },
      ],
    );

    expect(merged).toEqual([
      {
        description: "Chapa aço 3mm",
        unit: "KG",
        quantityPlanned: 10, // previsto fresco (alocado), informado do gravado
        quantityReceived: 12,
        quantityUsed: 10,
        quantityReturned: 2,
      },
      {
        description: "Parafuso M8",
        unit: "UN",
        quantityPlanned: 25, // novo: pré-preenchido com o alocado
        quantityReceived: 25,
        quantityUsed: 25,
        quantityReturned: 0,
      },
      {
        description: "Tinta pó", // órfã gravada: mantida para não perder dados
        unit: "KG",
        quantityPlanned: 8,
        quantityReceived: null,
        quantityUsed: null,
        quantityReturned: null,
      },
    ]);
  });

  it("deriva o saldo de devolução (recebida − utilizada) com null quando falta dado", () => {
    expect(materialReturnQuantity(10, 4)).toBe(6);
    expect(materialReturnQuantity(10, null)).toBeNull();
    expect(materialReturnQuantity(null, 4)).toBeNull();
  });

  it("lista os gates de emissão que faltam (conferência, EXP pendente, teto)", () => {
    const result = checkRomaneioEmission({
      status: "SIMULACAO",
      orderStatus: "EM_PRODUCAO",
      conferenceAccepted: false,
      items: [
        { itemQuantity: 10, shippedQuantity: 8, quantity: 5, expStatus: "CONCLUIDO" },
        { itemQuantity: 6, shippedQuantity: 0, quantity: 0, expStatus: "NAO_INICIADO" },
        { itemQuantity: 4, shippedQuantity: 2, quantity: 2, expStatus: null },
      ],
    });

    expect(result.canEmit).toBe(false);
    expect(result.blockers).toContain("Sinalize o aceite da conferência antes de emitir.");
    // EXP pendente conta TODOS os itens raiz da OF, mesmo fora da carga.
    expect(result.blockers).toContain("1 item raiz com EXPEDIÇÃO pendente.");
    // 8 já expedidas + 5 nesta carga > 10 do item.
    expect(result.blockers).toContain("1 item acima da pendência de expedição.");
  });

  it("libera a emissão quando todos os pré-requisitos batem", () => {
    const result = checkRomaneioEmission({
      status: "SIMULACAO",
      orderStatus: "EM_PRODUCAO",
      conferenceAccepted: true,
      items: [
        { itemQuantity: 10, shippedQuantity: 2, quantity: 8, expStatus: "CONCLUIDO" },
        { itemQuantity: 6, shippedQuantity: 0, quantity: 0, expStatus: "CONCLUIDO" },
      ],
    });

    expect(result).toEqual({ canEmit: true, blockers: [] });
  });
});

describe("RPC save_romaneio (042)", () => {
  it("cria uma simulação por OF e bloqueia a segunda (uma por OF)", async () => {
    await asUser(db, "authenticated", gestorId);

    const created = await saveRomaneio({
      orderId: orderR1,
      items: [{ orderItemId: rootA, quantity: 5 }],
      materials: [
        {
          description: "Chapa aço 3mm",
          unit: "KG",
          quantityPlanned: 10,
          quantityReceived: 10,
          quantityUsed: 8,
        },
      ],
    });
    expect(created.id).toBeTruthy();
    expect(Number(created.number)).toBeGreaterThan(0);

    await expect(
      saveRomaneio({ orderId: orderR1, items: [{ orderItemId: rootB, quantity: 1 }] }),
    ).rejects.toThrow(/já existe uma simulação/i);
  });

  it("rejeita item fora da OF, item filho e quantidade acima do item", async () => {
    await asUser(db, "authenticated", gestorId);

    // Item de OUTRA OF (o insert nasce e a transação inteira volta atrás).
    await expect(
      saveRomaneio({ orderId: orderR2, items: [{ orderItemId: rootA, quantity: 1 }] }),
    ).rejects.toThrow(/não pertence a esta OF/i);

    // Item FILHO (016): a carga expede só os itens RAIZ da OF.
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'SIMULACAO'`,
      [orderR1],
    );
    await expect(
      saveRomaneio({
        romaneioId: rows[0]!.id,
        orderId: orderR1,
        items: [{ orderItemId: childA, quantity: 1 }],
      }),
    ).rejects.toThrow(/somente itens raiz/i);

    // Quantidade acima da do item (OF nova, sem simulação, para isolar a checagem).
    const orderR3 = await createOrder("OF-R03");
    const rootD = await createRootItem(orderR3, "Base reforçada", 2, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    await expect(
      saveRomaneio({ orderId: orderR3, items: [{ orderItemId: rootD, quantity: 3 }] }),
    ).rejects.toThrow(/quantidade maior que a disponível/i);
  });

  it("rejeita utilizado acima de recebido nos materiais", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR4 = await createOrder("OF-R04");
    const rootE = await createRootItem(orderR4, "Sombrite", 1, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    await expect(
      saveRomaneio({
        orderId: orderR4,
        items: [{ orderItemId: rootE, quantity: 1 }],
        materials: [
          { description: "Tela PVDF", unit: "M2", quantityPlanned: 4, quantityReceived: 4, quantityUsed: 5 },
        ],
      }),
    ).rejects.toThrow(/utilizada não pode exceder a recebida/i);
  });

  it("substitui itens e materiais do rascunho (edição de simulação)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'SIMULACAO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await saveRomaneio({
      romaneioId,
      orderId: orderR1,
      shipmentDate: "2026-10-20",
      carrier: "Transportes Beta",
      items: [
        { orderItemId: rootA, quantity: 10 },
        { orderItemId: rootB, quantity: 2 },
      ],
      materials: [
        { description: "Chapa aço 3mm", unit: "KG", quantityPlanned: 20, quantityReceived: 20, quantityUsed: 18 },
      ],
    });

    const { rows: items } = await db.query<{ order_item_id: string; quantity: number }>(
      `select order_item_id, quantity from public.romaneio_items where romaneio_id = $1 order by quantity`,
      [romaneioId],
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.order_item_id).sort()).toEqual([rootA, rootB].sort());

    const { rows: header } = await db.query<{ carrier: string; shipment_date: string }>(
      `select carrier, to_char(shipment_date, 'YYYY-MM-DD') as shipment_date
         from public.romaneios where id = $1`,
      [romaneioId],
    );
    expect(header[0]!.carrier).toBe("Transportes Beta");
    expect(header[0]!.shipment_date).toBe("2026-10-20");
  });

  it("apaga materiais que saíram da lista (substituição total)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'SIMULACAO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await saveRomaneio({
      romaneioId,
      orderId: orderR1,
      items: [{ orderItemId: rootA, quantity: 10 }],
      materials: [],
    });

    const { rows: materials } = await db.query(
      `select 1 from public.romaneio_materials where romaneio_id = $1`,
      [romaneioId],
    );
    expect(materials).toHaveLength(0);
  });

  it("recusa edição de OPERADOR (RLS escreve só ADMIN/GESTOR)", async () => {
    await asUser(db, "authenticated", operadorId);

    await expect(
      saveRomaneio({ orderId: orderR2, items: [{ orderItemId: rootC, quantity: 1 }] }),
    ).rejects.toThrow(/row-level security|permissão/i);
  });
});

describe("RPC emit_romaneio (042) — gates de emissão", () => {
  it("bloqueia a emissão sem o aceite da conferência", async () => {
    await asUser(db, "authenticated", gestorId);

    const created = await saveRomaneio({
      orderId: orderR2,
      items: [{ orderItemId: rootC, quantity: 4 }],
    });

    await expect(emitRomaneio(created.id)).rejects.toThrow(
      /sinalize o aceite da conferência/i,
    );

    await signConference(created.id, "Carga conferida com o cliente.");
    await emitRomaneio(created.id);
    expect(await romaneioStatus(created.id)).toBe("EMITIDO");
  });

  it("trava o romaneio emitido (só simulações são editadas)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'EMITIDO'`,
      [orderR2],
    );
    const emittedId = rows[0]!.id;

    await expect(
      saveRomaneio({ romaneioId: emittedId, orderId: orderR2, items: [{ orderItemId: rootC, quantity: 1 }] }),
    ).rejects.toThrow(/somente simulações/i);
  });

  it("expedição parcial: a segunda carga não pode estourar o teto do item", async () => {
    await asUser(db, "authenticated", gestorId);

    const second = await saveRomaneio({
      orderId: orderR2,
      items: [{ orderItemId: rootC, quantity: 4 }],
    });
    await signConference(second.id);
    await expect(emitRomaneio(second.id)).rejects.toThrow(/pendência de expedição/i);

    // Liberando a primeira carga (cancelar), a segunda usa o teto inteiro.
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'EMITIDO'`,
      [orderR2],
    );
    const firstId = rows[0]!.id;

    await asSuperUser(db);
    await db.query(
      `update public.romaneios set nf_number = null where id = $1`,
      [firstId],
    );
    await asUser(db, "authenticated", gestorId);
    await cancelRomaneio(firstId);
    expect(await romaneioStatus(firstId)).toBe("CANCELADO");

    await emitRomaneio(second.id);
    expect(await romaneioStatus(second.id)).toBe("EMITIDO");
  });

  it("cancelamento é bloqueado com NF de saída registrada", async () => {
    await asSuperUser(db);
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'EMITIDO'`,
      [orderR2],
    );
    const emittedId = rows[0]!.id;
    await db.query(`update public.romaneios set nf_number = '12345' where id = $1`, [emittedId]);

    await asUser(db, "authenticated", gestorId);
    await expect(cancelRomaneio(emittedId)).rejects.toThrow(/limpe o número da nf/i);
  });

  it("bloqueia a emissão enquanto houver EXP pendente na OF", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'SIMULACAO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    // Conferência ok, mas a raiz B (fora da carga) ainda tem EXP pendente.
    await signConference(romaneioId);
    await expect(emitRomaneio(romaneioId)).rejects.toThrow(/expedição pendente/i);

    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp set status = 'CONCLUIDO'
         from public.processes p
        where p.id = pp.process_id and p.code = 'EXP'
          and pp.order_item_id = $1`,
      [rootB],
    );

    await asUser(db, "authenticated", gestorId);
    await emitRomaneio(romaneioId);
    expect(await romaneioStatus(romaneioId)).toBe("EMITIDO");
  });
});
