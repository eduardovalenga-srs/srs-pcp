import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import {
  allocateRomaneioItemWeightsKg,
  allocateRomaneioMaterials,
  checkRomaneioConfirmation,
  loadWeightKg,
  materialReturnQuantity,
  mergeRomaneioMaterialLines,
  resolveRomaneioWeights,
  sumUsedWeightKg,
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
  const { rows } = await db.query<{ id: string }>(
    `select order_item_id as id from public.romaneio_items where romaneio_id = $1`,
    [romaneioId],
  );
  await saveRomaneioConference({
    romaneioId,
    notes,
    checkedItemIds: rows.map((row) => row.id),
    sign: true,
  });
}

interface ConferenceParams {
  romaneioId: string;
  notes?: string | null;
  checkedItemIds?: string[];
  materials?: {
    description: string;
    unit: string;
    quantityPlanned?: number | null;
    quantityReceived?: number | null;
    quantityUsed?: number | null;
  }[];
  /** true = conclui (ABERTO → CONFERIDO); false = rascunho. */
  sign?: boolean;
}

/** Grava a ficha de conferência como formulário (RPC 048). */
async function saveRomaneioConference(params: ConferenceParams): Promise<void> {
  await db.query(
    `select public.save_romaneio_conference($1::uuid, $2::text, $3::uuid[], $4::jsonb, $5::boolean)`,
    [
      params.romaneioId,
      params.notes ?? null,
      params.checkedItemIds ?? [],
      JSON.stringify(params.materials ?? []),
      params.sign ?? false,
    ],
  );
}

async function confirmRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.confirm_romaneio($1::uuid)`, [romaneioId]);
}

async function deleteRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.delete_romaneio($1::uuid)`, [romaneioId]);
}

async function cancelRomaneio(romaneioId: string): Promise<void> {
  await db.query(`select public.cancel_romaneio($1::uuid)`, [romaneioId]);
}

/** Registra a NF de saída direto no banco (o emissor é externo). */
async function setNfNumber(romaneioId: string, nfNumber: string): Promise<void> {
  await asSuperUser(db);
  await db.query(`update public.romaneios set nf_number = $2 where id = $1`, [
    romaneioId,
    nfNumber,
  ]);
  await asUser(db, "authenticated", gestorId);
}

async function romaneioStatus(romaneioId: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>(
    `select status from public.romaneios where id = $1`,
    [romaneioId],
  );
  return rows[0]!.status;
}

async function concludeExp(orderItemId: string): Promise<void> {
  await asSuperUser(db);
  await db.query(
    `update public.production_processes pp set status = 'CONCLUIDO'
       from public.processes p
      where p.id = pp.process_id and p.code = 'EXP'
        and pp.order_item_id = $1`,
    [orderItemId],
  );
  await asUser(db, "authenticated", gestorId);
}

// OF-R01: raiz A (EXP concluído, com materiais no raiz e no filho) e raiz B
// (EXP pendente) — bloqueia a confirmação até concluir.
let orderR1: string;
let rootA: string;
let rootB: string;
let childA: string;

// OF-R02: única raiz, EXP concluído — fluxos de confirmação/baixa.
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
        description: "Tinta pó", // órfã gravada: mantém a recebida, zera o resto
        unit: "KG",
        quantityPlanned: 0,
        quantityReceived: null,
        quantityUsed: 0,
        quantityReturned: null,
      },
    ]);
  });

  it("deriva a utilizada da alocação e nunca deixa a recebida abaixo dela", () => {
    const merged = mergeRomaneioMaterialLines(
      [
        { description: "Chapa aço 3mm", unit: "KG", quantityPlanned: 10 },
        { description: "Parafuso M8", unit: "UN", quantityPlanned: 4 },
      ],
      [
        // Gravado ATRÁS do alocado (caso do romaneio 4): utilizada
        // acompanha o previsto e a recebida nasce igual a ela.
        {
          description: "Chapa aço 3mm",
          unit: "KG",
          quantityPlanned: 6,
          quantityReceived: 6,
          quantityUsed: 6,
        },
        // Gravado ACIMA do alocado: sobra a devolver (saldo positivo).
        {
          description: "Parafuso M8",
          unit: "UN",
          quantityPlanned: 4,
          quantityReceived: 30,
          quantityUsed: 4,
        },
      ],
    );

    expect(merged).toEqual([
      {
        description: "Chapa aço 3mm",
        unit: "KG",
        quantityPlanned: 10,
        quantityReceived: 10,
        quantityUsed: 10,
        quantityReturned: 0,
      },
      {
        description: "Parafuso M8",
        unit: "UN",
        quantityPlanned: 4,
        quantityReceived: 30,
        quantityUsed: 4,
        quantityReturned: 26,
      },
    ]);
  });

  it("soma só as linhas em unidade de peso (KG/G) para o peso da carga", () => {
    expect(
      sumUsedWeightKg([
        { unit: "KG", quantityUsed: 10 },
        { unit: "G", quantityUsed: 500 },
        { unit: "UN", quantityUsed: 30 },
        { unit: "M", quantityUsed: 4 },
      ]),
    ).toBeCloseTo(10.5);

    // Linha em peso SEM valor conta 0 (a unidade é de peso).
    expect(sumUsedWeightKg([{ unit: "KG", quantityUsed: null }])).toBe(0);
    // Nenhuma linha em unidade de peso → null (o chamador cai nos itens).
    expect(
      sumUsedWeightKg([
        { unit: "UN", quantityUsed: 30 },
        { unit: "M", quantityUsed: null },
      ]),
    ).toBeNull();
    expect(sumUsedWeightKg([])).toBeNull();
  });

  it("cai no peso dos itens só quando não há material em peso (loadWeightKg)", () => {
    const items = [
      { unitWeightKg: 10, quantity: 4 },
      { unitWeightKg: null, quantity: 3 },
    ];
    // Sem linha em KG/G → qtd × peso unitário (item sem peso conta 0).
    expect(loadWeightKg([{ unit: "UN", quantityUsed: 30 }], items)).toBe(40);
    // Com linha em peso → a UTILIZADA manda (mesmo que os itens digam outra coisa).
    expect(loadWeightKg([{ unit: "KG", quantityUsed: 7.5 }], items)).toBe(7.5);
    // Nada de peso em lugar nenhum → "—".
    expect(loadWeightKg([], [{ unitWeightKg: null, quantity: 2 }])).toBeNull();
  });

  it("deriva o peso de CADA item raiz dos materiais em KG da subárvore", () => {
    const allocation = {
      includedItems: [
        { orderItemId: "raiz-1", quantity: 5 },
        { orderItemId: "raiz-2", quantity: 6 },
        { orderItemId: "raiz-3", quantity: 1 },
      ],
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
          materials: [
            { description: "Perfil L", unit: "KG", quantity: 10 },
            { description: "Parafuso M8", unit: "UN", quantity: 50 },
          ],
        },
        {
          orderItemId: "raiz-2",
          parentItemId: null,
          quantity: 6,
          // Só material NÃO peso → o item não tem peso de material.
          materials: [{ description: "Tinta pó", unit: "L", quantity: 8 }],
        },
        {
          orderItemId: "raiz-3",
          parentItemId: null,
          quantity: 1,
          materials: [{ description: "Arame", unit: "G", quantity: 2000 }],
        },
      ],
    };

    const byItem = allocateRomaneioItemWeightsKg(allocation);
    // raiz-1: (20 + 10) × 0,5 = 15 kg — raiz e filho juntos.
    expect(byItem.get("raiz-1")).toBeCloseTo(15);
    // raiz-2: nada em unidade de peso → fora do mapa ("—").
    expect(byItem.has("raiz-2")).toBe(false);
    // raiz-3: 2000 g = 2 kg (conversão G ÷ 1000).
    expect(byItem.get("raiz-3")).toBeCloseTo(2);
  });

  it("resolve os pesos da carga com UMA fonte só (resolveRomaneioWeights)", () => {
    const allocation = {
      includedItems: [{ orderItemId: "raiz-1", quantity: 5 }],
      orderItems: [
        {
          orderItemId: "raiz-1",
          parentItemId: null,
          quantity: 10,
          materials: [{ description: "Chapa aço 3mm", unit: "KG", quantity: 20 }],
        },
      ],
    };
    const items = [
      { orderItemId: "raiz-1", unitWeightKg: 10, quantity: 5 },
      { orderItemId: "fora", unitWeightKg: 8, quantity: 0 },
    ];

    // Com material em KG: total = Σ da utilizada e o item recebe o peso
    // alocado dele (10 kg), mesmo que o peso unitário diga 50.
    const comMaterial = resolveRomaneioWeights({
      materials: [{ unit: "KG", quantityUsed: 10 }],
      items,
      allocation,
    });
    expect(comMaterial.totalKg).toBe(10);
    expect(comMaterial.byItem.get("raiz-1")).toBeCloseTo(10);
    expect(comMaterial.byItem.get("fora")).toBe(0);

    // Sem material em peso: cai no qtd × peso unitário dos itens.
    const semMaterial = resolveRomaneioWeights({
      materials: [{ unit: "UN", quantityUsed: 30 }],
      items,
      allocation,
    });
    expect(semMaterial.totalKg).toBe(50);
    expect(semMaterial.byItem.get("raiz-1")).toBe(50);
    expect(semMaterial.byItem.get("fora")).toBe(0);
  });

  it("deriva o saldo de devolução (recebida − utilizada) com null quando falta dado", () => {
    expect(materialReturnQuantity(10, 4)).toBe(6);
    expect(materialReturnQuantity(10, null)).toBeNull();
    expect(materialReturnQuantity(null, 4)).toBeNull();
  });

  it("lista os gates de confirmação que faltam (aberto, NF, EXP pendente, teto)", () => {
    const result = checkRomaneioConfirmation({
      status: "ABERTO",
      orderStatus: "EM_PRODUCAO",
      hasNfNumber: false,
      items: [
        { itemQuantity: 10, shippedQuantity: 8, quantity: 5, expStatus: "CONCLUIDO" },
        { itemQuantity: 6, shippedQuantity: 0, quantity: 0, expStatus: "NAO_INICIADO" },
        { itemQuantity: 4, shippedQuantity: 2, quantity: 2, expStatus: null },
      ],
    });

    expect(result.canConfirm).toBe(false);
    expect(result.blockers).toContain("Conclua a conferência (aceite) antes de confirmar.");
    expect(result.blockers).toContain("Registre o número da NF de saída.");
    // EXP pendente conta TODOS os itens raiz da OF, mesmo fora da carga.
    expect(result.blockers).toContain("1 item raiz com EXPEDIÇÃO pendente.");
    // 8 já expedidas + 5 nesta carga > 10 do item.
    expect(result.blockers).toContain("1 item acima da pendência de expedição.");
  });

  it("libera a confirmação quando todos os pré-requisitos batem", () => {
    const result = checkRomaneioConfirmation({
      status: "CONFERIDO",
      orderStatus: "EM_PRODUCAO",
      hasNfNumber: true,
      items: [
        { itemQuantity: 10, shippedQuantity: 2, quantity: 8, expStatus: "CONCLUIDO" },
        { itemQuantity: 6, shippedQuantity: 0, quantity: 0, expStatus: "CONCLUIDO" },
      ],
    });

    expect(result).toEqual({ canConfirm: true, blockers: [] });
  });
});

describe("RPC save_romaneio (042/045/046)", () => {
  it("cria um romaneio em aberto por OF e bloqueia o segundo", async () => {
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
    expect(await romaneioStatus(created.id)).toBe("ABERTO");

    await expect(
      saveRomaneio({ orderId: orderR1, items: [{ orderItemId: rootB, quantity: 1 }] }),
    ).rejects.toThrow(/já existe um romaneio em aberto/i);
  });

  it("rejeita item fora da OF, item filho e quantidade acima do item", async () => {
    await asUser(db, "authenticated", gestorId);

    // Item de OUTRA OF (o insert nasce e a transação inteira volta atrás).
    await expect(
      saveRomaneio({ orderId: orderR2, items: [{ orderItemId: rootA, quantity: 1 }] }),
    ).rejects.toThrow(/não pertence a esta OF/i);

    // Item FILHO (016): a carga expede só os itens RAIZ da OF.
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
      [orderR1],
    );
    await expect(
      saveRomaneio({
        romaneioId: rows[0]!.id,
        orderId: orderR1,
        items: [{ orderItemId: childA, quantity: 1 }],
      }),
    ).rejects.toThrow(/somente itens raiz/i);

    // Quantidade acima da do item (OF nova, sem romaneio aberto, para isolar a checagem).
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

  it("substitui itens e materiais do rascunho (edição em aberto)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
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
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
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

describe("RPC save_romaneio_conference (048) — ficha como formulário", () => {
  it("rascunho grava marcação, materiais e observação sem mudar o status", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    // Recarrega a linha de material do rascunho (a lista foi zerada antes).
    await saveRomaneio({
      romaneioId,
      orderId: orderR1,
      items: [{ orderItemId: rootA, quantity: 10 }],
      materials: [{ description: "Chapa aço 3mm", unit: "KG", quantityPlanned: 20 }],
    });

    await saveRomaneioConference({
      romaneioId,
      notes: "Rascunho: carga conferida parcialmente.",
      checkedItemIds: [rootA],
      materials: [
        { description: "Chapa aço 3mm", unit: "KG", quantityReceived: 18, quantityUsed: 15 },
      ],
      sign: false,
    });

    // Continua em ABERTO — o rascunho não sinaliza o aceite.
    expect(await romaneioStatus(romaneioId)).toBe("ABERTO");

    const { rows: items } = await db.query<{ conference_checked: boolean }>(
      `select conference_checked from public.romaneio_items where romaneio_id = $1`,
      [romaneioId],
    );
    expect(items).toEqual([{ conference_checked: true }]);

    const { rows: materials } = await db.query<{
      quantity_received: number | string;
      quantity_used: number | string;
    }>(
      `select quantity_received, quantity_used
         from public.romaneio_materials where romaneio_id = $1`,
      [romaneioId],
    );
    expect(Number(materials[0]!.quantity_received)).toBe(18);
    expect(Number(materials[0]!.quantity_used)).toBe(15);

    const { rows: header } = await db.query<{
      conference_notes: string | null;
      conference_accepted_at: string | null;
    }>(
      `select conference_notes, conference_accepted_at from public.romaneios where id = $1`,
      [romaneioId],
    );
    expect(header[0]!.conference_notes).toBe("Rascunho: carga conferida parcialmente.");
    expect(header[0]!.conference_accepted_at).toBeNull();
  });

  it("recusa concluir com item pendente e recusa utilizado acima de recebido", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await expect(
      saveRomaneioConference({ romaneioId, checkedItemIds: [], sign: true }),
    ).rejects.toThrow(/marque todos os itens como conferidos/i);
    expect(await romaneioStatus(romaneioId)).toBe("ABERTO");

    await expect(
      saveRomaneioConference({
        romaneioId,
        checkedItemIds: [rootA],
        materials: [
          { description: "Chapa aço 3mm", unit: "KG", quantityReceived: 10, quantityUsed: 12 },
        ],
        sign: false,
      }),
    ).rejects.toThrow(/utilizada não pode exceder a recebida/i);

    // Transação única: a falha não gravou nada (material segue 18/15).
    const { rows: materials } = await db.query<{
      quantity_received: number | string;
      quantity_used: number | string;
    }>(
      `select quantity_received, quantity_used
         from public.romaneio_materials where romaneio_id = $1`,
      [romaneioId],
    );
    expect(Number(materials[0]!.quantity_received)).toBe(18);
    expect(Number(materials[0]!.quantity_used)).toBe(15);
  });

  it("052: material sem linha gravada NASCE no upsert (recebida não se perde)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    // "Parafuso M8" NÃO existe em romaneio_materials para esta carga:
    // o update puro da 048 casava 0 linhas em silêncio e o lançamento
    // da ficha se perdia. A 052 faz upsert pela chave (romaneio_id,
    // description, unit) e a linha nova nasce com o previsto do payload.
    await saveRomaneioConference({
      romaneioId,
      checkedItemIds: [rootA],
      materials: [
        {
          description: "Parafuso M8",
          unit: "UN",
          quantityPlanned: 40,
          quantityReceived: 30,
          quantityUsed: 30,
        },
      ],
      sign: false,
    });

    const { rows: created } = await db.query<{
      quantity_planned: number | string;
      quantity_received: number | string;
      quantity_used: number | string;
    }>(
      `select quantity_planned, quantity_received, quantity_used
         from public.romaneio_materials
        where romaneio_id = $1 and description = 'Parafuso M8' and unit = 'UN'`,
      [romaneioId],
    );
    expect(created).toHaveLength(1);
    expect(Number(created[0]!.quantity_planned)).toBe(40);
    expect(Number(created[0]!.quantity_received)).toBe(30);
    expect(Number(created[0]!.quantity_used)).toBe(30);

    // A linha EXISTENTE continua sendo atualizada (chave repetida) e o
    // previsto gravado dela NÃO é reescrito pelo payload da ficha.
    const { rows: before } = await db.query<{ quantity_planned: number | string }>(
      `select quantity_planned from public.romaneio_materials
        where romaneio_id = $1 and description = 'Chapa aço 3mm'`,
      [romaneioId],
    );
    expect(Number(before[0]!.quantity_planned)).toBe(20);

    await saveRomaneioConference({
      romaneioId,
      checkedItemIds: [rootA],
      materials: [{ description: "Chapa aço 3mm", unit: "KG", quantityReceived: 12, quantityUsed: 12 }],
      sign: false,
    });

    const { rows: updated } = await db.query<{
      quantity_planned: number | string;
      quantity_received: number | string;
      quantity_used: number | string;
    }>(
      `select quantity_planned, quantity_received, quantity_used
         from public.romaneio_materials
        where romaneio_id = $1 and description = 'Chapa aço 3mm'`,
      [romaneioId],
    );
    expect(updated).toHaveLength(1);
    expect(Number(updated[0]!.quantity_planned)).toBe(20);
    expect(Number(updated[0]!.quantity_received)).toBe(12);
    expect(Number(updated[0]!.quantity_used)).toBe(12);
  });

  it("conclui a conferência (ABERTO → CONFERIDO) com todos os itens marcados", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'ABERTO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await saveRomaneioConference({
      romaneioId,
      notes: "Carga conferida com o cliente.",
      checkedItemIds: [rootA],
      sign: true,
    });
    expect(await romaneioStatus(romaneioId)).toBe("CONFERIDO");

    const { rows: signed } = await db.query<{
      conference_accepted_by: string | null;
      conference_notes: string | null;
      conference_accepted_at: string | null;
    }>(
      `select conference_accepted_by, conference_notes, conference_accepted_at
         from public.romaneios where id = $1`,
      [romaneioId],
    );
    expect(signed[0]!.conference_accepted_by).toBe(gestorId);
    expect(signed[0]!.conference_notes).toBe("Carga conferida com o cliente.");
    expect(signed[0]!.conference_accepted_at).toBeTruthy();
  });

  it("a ficha vira leitura depois de CONFERIDO (e a RPC antiga saiu)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFERIDO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await expect(
      saveRomaneioConference({ romaneioId, checkedItemIds: [rootA], sign: true }),
    ).rejects.toThrow(/só pode ser editada em romaneios em aberto/i);

    // A sign_romaneio_conference antiga foi substituída pela 048.
    const { rows: old } = await db.query<{ fn: string | null }>(
      `select to_regprocedure('public.sign_romaneio_conference(uuid, text)')::text as fn`,
    );
    expect(old[0]!.fn).toBeNull();
  });

  it("recusa a conferência de OPERADOR (RLS escreve só ADMIN/GESTOR)", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR8 = await createOrder("OF-R08");
    const rootH = await createRootItem(orderR8, "Tela soldada", 5, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    const created = await saveRomaneio({
      orderId: orderR8,
      items: [{ orderItemId: rootH, quantity: 5 }],
    });

    await asUser(db, "authenticated", operadorId);
    await expect(
      saveRomaneioConference({ romaneioId: created.id, checkedItemIds: [rootH], sign: true }),
    ).rejects.toThrow(/permissão/i);

    await asUser(db, "authenticated", gestorId);
    expect(await romaneioStatus(created.id)).toBe("ABERTO");

    // Limpa o rascunho para não afetar os testes seguintes.
    await deleteRomaneio(created.id);
  });

  it("a save_romaneio preserva a marcação ao editar os itens do detalhe", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR9 = await createOrder("OF-R09");
    const rootI = await createRootItem(orderR9, "Gradil", 6, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    const rootJ = await createRootItem(orderR9, "Poste", 2, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    const created = await saveRomaneio({
      orderId: orderR9,
      items: [
        { orderItemId: rootI, quantity: 4 },
        { orderItemId: rootJ, quantity: 2 },
      ],
    });
    await saveRomaneioConference({
      romaneioId: created.id,
      checkedItemIds: [rootI, rootJ],
      sign: false,
    });

    // Edição do detalhe remove rootJ e mantém rootI: a marcação sobrevive
    // ao replace de itens (048).
    await saveRomaneio({
      romaneioId: created.id,
      orderId: orderR9,
      items: [{ orderItemId: rootI, quantity: 4 }],
    });
    const { rows: afterRemove } = await db.query<{
      order_item_id: string;
      conference_checked: boolean;
    }>(
      `select order_item_id, conference_checked from public.romaneio_items
        where romaneio_id = $1`,
      [created.id],
    );
    expect(afterRemove).toEqual([{ order_item_id: rootI, conference_checked: true }]);

    // Item re-adicionado nasce DESMARCADO (a marcação é da ficha).
    await saveRomaneio({
      romaneioId: created.id,
      orderId: orderR9,
      items: [
        { orderItemId: rootI, quantity: 4 },
        { orderItemId: rootJ, quantity: 2 },
      ],
    });
    const { rows: afterAdd } = await db.query<{
      order_item_id: string;
      conference_checked: boolean;
    }>(
      `select order_item_id, conference_checked from public.romaneio_items
        where romaneio_id = $1 order by order_item_id`,
      [created.id],
    );
    expect(afterAdd).toEqual(
      [
        { order_item_id: rootI, conference_checked: true },
        { order_item_id: rootJ, conference_checked: false },
      ].sort((a, b) => a.order_item_id.localeCompare(b.order_item_id)),
    );
  });
});

describe("RPC confirm_romaneio (045) — gates e baixa", () => {
  it("bloqueia a confirmação antes do aceite e sem a NF de saída", async () => {
    await asUser(db, "authenticated", gestorId);

    const created = await saveRomaneio({
      orderId: orderR2,
      items: [{ orderItemId: rootC, quantity: 4 }],
    });

    // Ainda em aberto: a ordem do fluxo exige a conferência antes.
    await expect(confirmRomaneio(created.id)).rejects.toThrow(
      /apenas romaneios conferidos/i,
    );

    await signConference(created.id, "Carga conferida com o cliente.");
    await expect(confirmRomaneio(created.id)).rejects.toThrow(
      /registre o número da nf de saída/i,
    );

    await setNfNumber(created.id, "12345");
    await confirmRomaneio(created.id);
    expect(await romaneioStatus(created.id)).toBe("CONFIRMADO");

    const { rows } = await db.query<{ emitted_at: string | null; emitted_by: string | null }>(
      `select emitted_at, emitted_by from public.romaneios where id = $1`,
      [created.id],
    );
    expect(rows[0]!.emitted_at).toBeTruthy();
    expect(rows[0]!.emitted_by).toBe(gestorId);
  });

  it("trava o confirmado: nem editar, nem re-conferir, nem excluir", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFIRMADO'`,
      [orderR2],
    );
    const confirmedId = rows[0]!.id;

    await expect(
      saveRomaneio({ romaneioId: confirmedId, orderId: orderR2, items: [{ orderItemId: rootC, quantity: 1 }] }),
    ).rejects.toThrow(/somente romaneios em aberto/i);
    await expect(signConference(confirmedId)).rejects.toThrow(
      /conferência só pode ser editada/i,
    );
    await expect(deleteRomaneio(confirmedId)).rejects.toThrow(
      /somente romaneios em aberto podem ser excluídos/i,
    );
  });

  it("expedição parcial: cancelar o confirmado DEVOLVE a baixa à pendência", async () => {
    await asUser(db, "authenticated", gestorId);

    // 4 já confirmados (primeira carga) — a segunda não cabe no teto do item.
    const second = await saveRomaneio({
      orderId: orderR2,
      items: [{ orderItemId: rootC, quantity: 4 }],
    });
    await signConference(second.id);
    await setNfNumber(second.id, "22345");
    await expect(confirmRomaneio(second.id)).rejects.toThrow(/pendência de expedição/i);

    // Cancelar a PRIMEIRA carga (com NF registrada — permitido) libera o teto:
    // a baixa é derivada, então sai do somatório automaticamente.
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFIRMADO'`,
      [orderR2],
    );
    const firstId = rows[0]!.id;

    await cancelRomaneio(firstId);
    expect(await romaneioStatus(firstId)).toBe("CANCELADO");
    await expect(cancelRomaneio(firstId)).rejects.toThrow(/já cancelado/i);

    await confirmRomaneio(second.id);
    expect(await romaneioStatus(second.id)).toBe("CONFIRMADO");
  });

  it("a baixa é derivada: um novo CONFIRMADO só passa com a pendência liberada", async () => {
    await asUser(db, "authenticated", gestorId);

    // rootC (4) está 100% confirmado na segunda carga — a terceira estoura o teto.
    const third = await saveRomaneio({
      orderId: orderR2,
      items: [{ orderItemId: rootC, quantity: 4 }],
    });
    await signConference(third.id);
    await setNfNumber(third.id, "32345");
    await expect(confirmRomaneio(third.id)).rejects.toThrow(/pendência de expedição/i);

    // Cancelando a segunda (CONFIRMADO), a pendência se restaura sozinha
    // (nenhum contador é descontado — o Σ deriva dos confirmados).
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFIRMADO'`,
      [orderR2],
    );
    const secondId = rows[0]!.id;
    await cancelRomaneio(secondId);
    expect(await romaneioStatus(secondId)).toBe("CANCELADO");

    await confirmRomaneio(third.id);
    expect(await romaneioStatus(third.id)).toBe("CONFIRMADO");
  });

  it("bloqueia a confirmação enquanto houver EXP pendente na OF", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFERIDO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    // Conferência ok, mas a raiz B (fora da carga) ainda tem EXP pendente.
    await setNfNumber(romaneioId, "999");
    await expect(confirmRomaneio(romaneioId)).rejects.toThrow(/expedição pendente/i);

    await concludeExp(rootB);
    await confirmRomaneio(romaneioId);
    expect(await romaneioStatus(romaneioId)).toBe("CONFIRMADO");
  });

  it("bloqueia a conferência e a confirmação de um romaneio sem itens", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR5 = await createOrder("OF-R05");
    await createRootItem(orderR5, "Barrilete", 2, [{ code: "EXP", status: "CONCLUIDO" }]);

    const created = await saveRomaneio({ orderId: orderR5, items: [] });

    // Concluir a conferência já exige ao menos um item (048)…
    await expect(signConference(created.id)).rejects.toThrow(/ao menos um item/i);
    expect(await romaneioStatus(created.id)).toBe("ABERTO");

    // …e o confirm (045) continua travando por defesa: simula um
    // conferido sem itens gravando o status direto no banco.
    await asSuperUser(db);
    await db.query(`update public.romaneios set status = 'CONFERIDO' where id = $1`, [
      created.id,
    ]);
    await asUser(db, "authenticated", gestorId);

    await setNfNumber(created.id, "42345");
    await expect(confirmRomaneio(created.id)).rejects.toThrow(/inclua ao menos um item/i);

    // Sem item não há carga: o caminho deste conferido é o cancelamento
    // (exclusão definitiva só existe em aberto).
    await cancelRomaneio(created.id);
    expect(await romaneioStatus(created.id)).toBe("CANCELADO");
  });
});

describe("RPC delete_romaneio (045/046) — exclusão definitiva", () => {
  it("exclui um romaneio em aberto e o cancelamento não serve para abertos", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR6 = await createOrder("OF-R06");
    const rootF = await createRootItem(orderR6, "Muro fechado", 3, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    const created = await saveRomaneio({
      orderId: orderR6,
      items: [{ orderItemId: rootF, quantity: 3 }],
    });

    // Romaneio em aberto não se cancela — o caminho é a exclusão definitiva.
    await expect(cancelRomaneio(created.id)).rejects.toThrow(
      /em aberto são excluídos, não cancelados/i,
    );

    await deleteRomaneio(created.id);
    const { rows } = await db.query(
      `select 1 from public.romaneios where id = $1`,
      [created.id],
    );
    expect(rows).toHaveLength(0);

    // A OF volta a aceitar um novo romaneio em aberto (índice único liberado).
    const recreated = await saveRomaneio({
      orderId: orderR6,
      items: [{ orderItemId: rootF, quantity: 2 }],
    });
    expect(await romaneioStatus(recreated.id)).toBe("ABERTO");
  });

  it("bloqueia a exclusão de um CONFERIDO (o caminho é cancelar)", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR7 = await createOrder("OF-R07");
    const rootG = await createRootItem(orderR7, "Guarda-corpo", 8, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    const created = await saveRomaneio({
      orderId: orderR7,
      items: [{ orderItemId: rootG, quantity: 4 }],
    });
    await signConference(created.id);

    await expect(deleteRomaneio(created.id)).rejects.toThrow(
      /somente romaneios em aberto podem ser excluídos/i,
    );

    await cancelRomaneio(created.id);
    expect(await romaneioStatus(created.id)).toBe("CANCELADO");
  });
});

describe("constraint de status de romaneios (042 → 045 → 046)", () => {
  // Regressão da ordem das migrações 045/046: o DROP do constraint antigo
  // precisa vir ANTES da migração de dados e o ADD depois (o ADD valida as
  // linhas existentes) — UPDATE antes do DROP viola o constraint anterior
  // (23514). Com as migrações já aplicadas, travei aqui o CONJUNTO final
  // de status.
  async function insertRawRomaneio(status: string): Promise<void> {
    // OF nova por insert: o índice único de ABERTO é por OF, e a OF nova
    // não tem itens — o insert direto não passa pelas RPCs.
    const orderId = await createOrder(`OF-CONST-${status}`);
    await db.query(`insert into public.romaneios (order_id, status) values ($1, $2)`, [
      orderId,
      status,
    ]);
  }

  it("aceita os quatro status do novo ciclo de vida (ABERTO..CANCELADO)", async () => {
    await asUser(db, "authenticated", gestorId);

    for (const status of ["ABERTO", "CONFERIDO", "CONFIRMADO", "CANCELADO"]) {
      await expect(insertRawRomaneio(status)).resolves.toBeUndefined();
    }
  });

  it("rejeita os status antigos da 042 (SIMULACAO e EMITIDO)", async () => {
    await asUser(db, "authenticated", gestorId);

    for (const status of ["SIMULACAO", "EMITIDO"]) {
      await expect(insertRawRomaneio(status)).rejects.toThrow(/romaneios_status_check/);
    }
  });
});
