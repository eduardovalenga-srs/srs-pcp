import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import {
  allocateRomaneioMaterials,
  checkRomaneioConfirmation,
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

  it("lista os gates de confirmação que faltam (montagem, NF, EXP pendente, teto)", () => {
    const result = checkRomaneioConfirmation({
      status: "MONTADO",
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

describe("RPC save_romaneio (042/045)", () => {
  it("cria um romaneio em montagem por OF e bloqueia o segundo", async () => {
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
    expect(await romaneioStatus(created.id)).toBe("MONTADO");

    await expect(
      saveRomaneio({ orderId: orderR1, items: [{ orderItemId: rootB, quantity: 1 }] }),
    ).rejects.toThrow(/já existe um romaneio em montagem/i);
  });

  it("rejeita item fora da OF, item filho e quantidade acima do item", async () => {
    await asUser(db, "authenticated", gestorId);

    // Item de OUTRA OF (o insert nasce e a transação inteira volta atrás).
    await expect(
      saveRomaneio({ orderId: orderR2, items: [{ orderItemId: rootA, quantity: 1 }] }),
    ).rejects.toThrow(/não pertence a esta OF/i);

    // Item FILHO (016): a carga expede só os itens RAIZ da OF.
    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'MONTADO'`,
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

  it("substitui itens e materiais do rascunho (edição de montado)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'MONTADO'`,
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
      `select id from public.romaneios where order_id = $1 and status = 'MONTADO'`,
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

describe("RPC sign_romaneio_conference (045) — aceite da conferência", () => {
  it("move o montado para CONFERIDO e registra quem/quando/obs", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'MONTADO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await signConference(romaneioId, "Carga conferida com o cliente.");
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

  it("re-sinalizar em um já CONFERIDO atualiza o registro do aceite", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.romaneios where order_id = $1 and status = 'CONFERIDO'`,
      [orderR1],
    );
    const romaneioId = rows[0]!.id;

    await signConference(romaneioId, "Reconferida após ajuste de carga.");
    expect(await romaneioStatus(romaneioId)).toBe("CONFERIDO");

    const { rows: signed } = await db.query<{ conference_notes: string | null }>(
      `select conference_notes from public.romaneios where id = $1`,
      [romaneioId],
    );
    expect(signed[0]!.conference_notes).toBe("Reconferida após ajuste de carga.");
  });
});

describe("RPC confirm_romaneio (045) — gates e baixa", () => {
  it("bloqueia a confirmação antes do aceite e sem a NF de saída", async () => {
    await asUser(db, "authenticated", gestorId);

    const created = await saveRomaneio({
      orderId: orderR2,
      items: [{ orderItemId: rootC, quantity: 4 }],
    });

    // Ainda em montagem: a ordem do fluxo exige a conferência antes.
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
    ).rejects.toThrow(/somente romaneios em montagem/i);
    await expect(signConference(confirmedId)).rejects.toThrow(
      /conferência só pode ser sinalizada/i,
    );
    await expect(deleteRomaneio(confirmedId)).rejects.toThrow(
      /somente romaneios em montagem podem ser excluídos/i,
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

  it("bloqueia a confirmação de um romaneio sem itens", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR5 = await createOrder("OF-R05");
    await createRootItem(orderR5, "Barrilete", 2, [{ code: "EXP", status: "CONCLUIDO" }]);

    const created = await saveRomaneio({ orderId: orderR5, items: [] });
    await signConference(created.id);
    await setNfNumber(created.id, "42345");
    await expect(confirmRomaneio(created.id)).rejects.toThrow(/inclua ao menos um item/i);

    // Sem item não há carga: o caminho deste conferido é o cancelamento
    // (exclusão definitiva só existe em montagem).
    await cancelRomaneio(created.id);
    expect(await romaneioStatus(created.id)).toBe("CANCELADO");
  });
});

describe("RPC delete_romaneio (045) — exclusão definitiva", () => {
  it("exclui um montado e o cancelamento não serve para montados", async () => {
    await asUser(db, "authenticated", gestorId);

    const orderR6 = await createOrder("OF-R06");
    const rootF = await createRootItem(orderR6, "Muro fechado", 3, [
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    const created = await saveRomaneio({
      orderId: orderR6,
      items: [{ orderItemId: rootF, quantity: 3 }],
    });

    // Montado não se cancela — o caminho é a exclusão definitiva.
    await expect(cancelRomaneio(created.id)).rejects.toThrow(
      /em montagem são excluídos, não cancelados/i,
    );

    await deleteRomaneio(created.id);
    const { rows } = await db.query(
      `select 1 from public.romaneios where id = $1`,
      [created.id],
    );
    expect(rows).toHaveLength(0);

    // A OF volta a aceitar um novo romaneio em montagem (índice único liberado).
    const recreated = await saveRomaneio({
      orderId: orderR6,
      items: [{ orderItemId: rootF, quantity: 2 }],
    });
    expect(await romaneioStatus(recreated.id)).toBe("MONTADO");
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
      /somente romaneios em montagem podem ser excluídos/i,
    );

    await cancelRomaneio(created.id);
    expect(await romaneioStatus(created.id)).toBe("CANCELADO");
  });
});

describe("constraint de status de romaneios (042 → 045)", () => {
  // Regressão da ordem da migração 045: o DROP do constraint antigo precisa
  // vir ANTES da migração de dados e o ADD depois (o ADD valida as linhas
  // existentes) — UPDATE antes do DROP viola o constraint da 042 (23514).
  // Com a migração já aplicada, travei aqui o CONJUNTO final de status.
  async function insertRawRomaneio(status: string): Promise<void> {
    // OF nova por insert: o índice único de MONTADO é por OF, e a OF nova
    // não tem itens — o insert direto não passa pelas RPCs.
    const orderId = await createOrder(`OF-CONST-${status}`);
    await db.query(`insert into public.romaneios (order_id, status) values ($1, $2)`, [
      orderId,
      status,
    ]);
  }

  it("aceita os quatro status do novo ciclo de vida (MONTADO..CANCELADO)", async () => {
    await asUser(db, "authenticated", gestorId);

    for (const status of ["MONTADO", "CONFERIDO", "CONFIRMADO", "CANCELADO"]) {
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
