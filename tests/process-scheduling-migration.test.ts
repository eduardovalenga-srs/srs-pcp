import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let adminId: string;
let gestorId: string;
let processId: string;
let activeOrderId: string;
let secondOrderId: string;

/**
 * 070/071 — sequenciamento por processo e família da importação.
 * O calendário/cálculo de datas é testado na aplicação
 * (tests/scheduling.test.ts); aqui validamos a persistência e as RPCs.
 */
beforeAll(async () => {
  const testDb = await createTestDatabase();
  db = testDb.db;
  close = testDb.close;
  adminId = await createUser(db, "scheduling-admin@example.com", "ADMIN");
  gestorId = await createUser(db, "scheduling-gestor@example.com", "GESTOR");

  await asSuperUser(db);
  const { rows: laser } = await db.query<{ id: string; location: string }>(
    "select id, location from public.processes where code = 'LASER'",
  );
  processId = laser[0]?.id as string;

  await asUser(db, "authenticated", adminId);
  const { rows: catalog } = await db.query<{ id: string; location: string; code: string }>(
    "select id, location, code from public.processes",
  );
  await db.query(
    `select * from public.save_product_group($1, $2, $3, $4::jsonb)`,
    [
      null,
      "Estruturas metálicas",
      "EST",
      JSON.stringify(
        catalog.map((process) => ({
          factory: process.location,
          processId: process.id,
          unit: "KG",
          capacity: process.code === "LASER" ? 500 : 100,
        })),
      ),
    ],
  );

  await asSuperUser(db);
  const { rows: active } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, delivery_date, status, product_group_id)
     values ('OF-SEQ-1', 'OF', 'Cliente A', '2026-12-01', 'PLANEJADO', 1)
     returning id`,
  );
  activeOrderId = active[0]?.id as string;
  const { rows: second } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, delivery_date, status, product_group_id)
     values ('OF-SEQ-2', 'OF', 'Cliente B', '2026-11-20', 'EM_PRODUCAO', 1)
     returning id`,
  );
  secondOrderId = second[0]?.id as string;

  await db.query(
    `insert into public.orders (code, type, status)
     values ('OF-SEQ-CONCLUIDA', 'OF', 'CONCLUIDO')`,
  );

  // OF ativa sem família (importada antes da 070) — fica sinalizada na tela.
  const { rows: semFamilia } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, status)
     values ('OF-SEQ-SEM', 'OF', 'PLANEJADO') returning id`,
  );
  await db.query(
    `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
     values ($1, 'Sem família', 1, 60)`,
    [semFamilia[0]?.id],
  );

  // Peso dos itens RAIZ: 2 × 100 + 1 × 50 = 250 kg. O filho NÃO entra.
  await db.query(
    `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
     values ($1, 'Conjunto A', 2, 100), ($1, 'Conjunto B', 1, 50)`,
    [activeOrderId],
  );
  const { rows: parent } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
     values ($1, 'Conjunto C', 1, 80) returning id`,
    [activeOrderId],
  );
  await db.query(
    `insert into public.order_items (order_id, description, quantity, unit_weight_kg, parent_order_item_id)
     values ($1, 'Filho', 5, 10, $2)`,
    [activeOrderId, parent[0]?.id],
  );

  await db.query(
    `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
     values ($1, 'Conjunto D', 1, 120)`,
    [secondOrderId],
  );
});

afterAll(async () => {
  await close();
});

async function idOf(code: string): Promise<string> {
  await asSuperUser(db);
  const { rows } = await db.query<{ id: string }>(
    "select id from public.orders where code = $1",
    [code],
  );
  return rows[0]?.id as string;
}

describe("migration 070 — get_process_scheduling", () => {
  it("uma linha por OF ativa com peso dos itens raiz e capacidade KG/dia", async () => {
    await asUser(db, "authenticated", adminId);

    const { rows } = await db.query<{
      order_code: string;
      quantity: string;
      weight_kg: string;
      capacity_kg: string;
      group_type: string;
      position: number | null;
    }>(`select * from public.get_process_scheduling($1, null)`, [processId]);

    const byCode = new Map(rows.map((row) => [row.order_code, row]));

    expect(byCode.has("OF-SEQ-CONCLUIDA")).toBe(false);
    expect(Number(byCode.get("OF-SEQ-1")?.weight_kg)).toBe(330);
    expect(Number(byCode.get("OF-SEQ-1")?.quantity)).toBe(4);
    expect(Number(byCode.get("OF-SEQ-1")?.capacity_kg)).toBe(500);
    expect(byCode.get("OF-SEQ-1")?.group_type).toBe("1-EST");
    expect(byCode.get("OF-SEQ-1")?.position).toBeNull();

    expect(Number(byCode.get("OF-SEQ-2")?.weight_kg)).toBe(120);
    // Entrega mais próxima primeiro quando ainda não há posição salva;
    // sem entrega e sem família fica por último.
    expect(rows.map((row) => row.order_code)).toEqual(["OF-SEQ-2", "OF-SEQ-1", "OF-SEQ-SEM"]);
  });

  it("filtra por família (grupo de produto)", async () => {
    await asUser(db, "authenticated", adminId);

    const { rows: matches } = await db.query(`select * from public.get_process_scheduling($1, 1)`, [
      processId,
    ]);
    expect(matches).toHaveLength(2);

    const { rows: none } = await db.query(`select * from public.get_process_scheduling($1, 999)`, [
      processId,
    ]);
    expect(none).toHaveLength(0);
  });

  it("OF sem família aparece com grupo e capacidade nulos", async () => {
    await asUser(db, "authenticated", adminId);

    const { rows } = await db.query<{
      order_code: string;
      product_group_id: number | null;
      group_type: string | null;
      capacity_kg: string | null;
    }>(`select * from public.get_process_scheduling($1, null)`, [processId]);

    const semFamilia = rows.find((row) => row.order_code === "OF-SEQ-SEM");
    expect(semFamilia).toBeDefined();
    expect(semFamilia?.product_group_id).toBeNull();
    expect(semFamilia?.group_type).toBeNull();
    expect(semFamilia?.capacity_kg).toBeNull();
  });
});

describe("migration 070 — save_process_schedule", () => {
  it("grava posições, observações e a data de início (ADMIN)", async () => {
    await asUser(db, "authenticated", adminId);

    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      processId,
      "2026-10-05",
      JSON.stringify([
        { order_id: activeOrderId, position: 1, notes: "Prioridade do cliente" },
        { order_id: secondOrderId, position: 2, notes: null },
      ]),
    ]);

    const { rows } = await db.query<{
      order_code: string;
      position: number;
      notes: string | null;
    }>(
      `select o.code as order_code, s.position, s.notes
         from public.order_process_schedules s
         join public.orders o on o.id = s.order_id
        where s.process_id = $1
        order by s.position`,
      [processId],
    );

    expect(rows.map((row) => row.order_code)).toEqual(["OF-SEQ-1", "OF-SEQ-2"]);
    expect(rows[0]?.notes).toBe("Prioridade do cliente");

    const { rows: settings } = await db.query<{ anchor_date: string }>(
      `select to_char(anchor_date, 'YYYY-MM-DD') as anchor_date
         from public.process_schedule_settings where process_id = $1`,
      [processId],
    );
    expect(settings[0]?.anchor_date).toBe("2026-10-05");

    // A leitura passa a respeitar a posição salva.
    const { rows: ordering } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling($1, null)`,
      [processId],
    );
    expect(ordering.map((row) => row.order_code)).toEqual([
      "OF-SEQ-1",
      "OF-SEQ-2",
      "OF-SEQ-SEM",
    ]);
  });

  it("regrava a ordem sem duplicar linhas (upsert)", async () => {
    await asUser(db, "authenticated", gestorId);

    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      processId,
      "2026-10-06",
      JSON.stringify([
        { order_id: secondOrderId, position: 1, notes: null },
        { order_id: activeOrderId, position: 2, notes: "Replanejada" },
      ]),
    ]);

    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.order_process_schedules where process_id = $1",
      [processId],
    );
    expect(rows[0]?.count).toBe(2);

    const { rows: ordering } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling($1, null)`,
      [processId],
    );
    expect(ordering.map((row) => row.order_code)).toEqual([
      "OF-SEQ-2",
      "OF-SEQ-1",
      "OF-SEQ-SEM",
    ]);
  });

  it("salvar uma visão filtrada preserva a posição das outras OFs", async () => {
    const semFamiliaId = await idOf("OF-SEQ-SEM");
    await asUser(db, "authenticated", adminId);

    // Fila completa: sem-família (1), OF-SEQ-2 (2), OF-SEQ-1 (3).
    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      processId,
      "2026-10-07",
      JSON.stringify([
        { order_id: semFamiliaId, position: 1, notes: null },
        { order_id: secondOrderId, position: 2, notes: null },
        { order_id: activeOrderId, position: 3, notes: null },
      ]),
    ]);

    // Visão filtrada por família manda apenas as suas duas OFs.
    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      processId,
      "2026-10-08",
      JSON.stringify([
        { order_id: secondOrderId, position: 1, notes: "Filtrada" },
        { order_id: activeOrderId, position: 2, notes: null },
      ]),
    ]);

    const { rows } = await db.query<{ order_code: string; position: number }>(
      `select o.code as order_code, s.position
         from public.order_process_schedules s
         join public.orders o on o.id = s.order_id
        where s.process_id = $1
        order by s.position`,
      [processId],
    );

    expect(rows.map((row) => [row.order_code, row.position])).toEqual([
      ["OF-SEQ-SEM", 1],
      ["OF-SEQ-2", 2],
      ["OF-SEQ-1", 3],
    ]);

    const { rows: settings } = await db.query<{ anchor_date: string }>(
      `select to_char(anchor_date, 'YYYY-MM-DD') as anchor_date
         from public.process_schedule_settings where process_id = $1`,
      [processId],
    );
    expect(settings[0]?.anchor_date).toBe("2026-10-08");
  });

  it("rejeita gravação de perfil sem permissão e data ausente", async () => {
    await asSuperUser(db);
    const operadorId = await createUser(db, "scheduling-operador@example.com", "OPERADOR_F1");
    await asUser(db, "authenticated", operadorId);

    await expect(
      db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
        processId,
        "2026-10-05",
        "[]",
      ]),
    ).rejects.toThrow(/permissão/i);

    await asUser(db, "authenticated", adminId);
    await expect(
      db.query(`select public.save_process_schedule($1, null, $2::jsonb)`, [processId, "[]"]),
    ).rejects.toThrow(/data de início/i);
  });
});

describe("migration 071 — apply_of_import grava a família", () => {
  it("persiste product_group_id na criação e na atualização da OF", async () => {
    await asUser(db, "authenticated", adminId);

    const plan = {
      operations: [
        {
          action: "CREATE",
          order: {
            code: "OF-IMP-FAM",
            type: "OF",
            customerName: "Cliente Import",
            description: "Com família",
            deliveryDate: "2026-12-20",
            productGroupId: 1,
          },
          parents: [
            {
              code: "P-1",
              description: "GUARDA CORPO",
              family: "GC",
              quantity: 1,
              unitWeightKg: 10,
              totalWeightKg: 10,
              materials: [],
              children: [],
            },
          ],
        },
      ],
    };

    await db.query("select public.apply_of_import($1::jsonb)", [JSON.stringify(plan)]);

    const { rows: created } = await db.query<{ product_group_id: number }>(
      "select product_group_id from public.orders where code = 'OF-IMP-FAM'",
    );
    expect(created[0]?.product_group_id).toBe(1);

    // Reimportação (UPDATE) troca a família da OF.
    await asSuperUser(db);
    await db.query(
      `insert into public.product_groups (family_description, family_abbreviation)
       values ('Outra família', 'OUT')`,
    );
    const { rows: other } = await db.query<{ id: number }>(
      "select id from public.product_groups where family_abbreviation = 'OUT'",
    );
    const otherId = other[0]?.id as number;

    await asUser(db, "authenticated", adminId);
    const updatePlan = {
      operations: [
        {
          ...plan.operations[0],
          action: "UPDATE",
          order: { ...plan.operations[0]?.order, productGroupId: otherId },
        },
      ],
    };
    await db.query("select public.apply_of_import($1::jsonb)", [JSON.stringify(updatePlan)]);

    const { rows: updated } = await db.query<{ product_group_id: number }>(
      "select product_group_id from public.orders where code = 'OF-IMP-FAM'",
    );
    expect(updated[0]?.product_group_id).toBe(otherId);
  });

  it("sem productGroupId no plano a coluna permanece intacta", async () => {
    await asUser(db, "authenticated", adminId);

    const plan = {
      operations: [
        {
          action: "UPDATE",
          order: {
            code: "OF-IMP-FAM",
            type: "OF",
            customerName: "Cliente Import",
            description: "Sem família no plano",
            deliveryDate: "2026-12-21",
          },
          parents: [],
        },
      ],
    };
    await db.query("select public.apply_of_import($1::jsonb)", [JSON.stringify(plan)]);

    const { rows } = await db.query<{ product_group_id: number | null; delivery_date: string }>(
      "select product_group_id, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from public.orders where code = 'OF-IMP-FAM'",
    );
    expect(rows[0]?.product_group_id).not.toBeNull();
    expect(rows[0]?.delivery_date).toBe("2026-12-21");
  });
});
