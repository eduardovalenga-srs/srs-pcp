import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let adminId: string;
let gestorId: string;
let processId: string;
let otherProcessId: string;
let activeOrderId: string;
let secondOrderId: string;

/**
 * 070/071/077/078 — sequência global filtrada por processo e família.
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
  const { rows: solda } = await db.query<{ id: string }>(
    "select id from public.processes where code = 'SOLDA'",
  );
  otherProcessId = solda[0]?.id as string;

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

  // A tela só lista OFs cujo processo selecionado está pendente.
  await db.query(
    `insert into public.production_processes (order_item_id, process_id, status)
     select oi.id, p.id, 'NAO_INICIADO'
       from public.order_items oi
       cross join public.processes p
      where oi.order_id in ($1, $2, $3)
        and p.code = 'LASER'`,
    [activeOrderId, secondOrderId, semFamilia[0]?.id],
  );
  await db.query(
    `insert into public.production_processes (order_item_id, process_id, status)
     select oi.id, p.id, 'NAO_INICIADO'
       from public.order_items oi
       cross join public.processes p
      where oi.order_id in ($1, $2)
        and p.code = 'SOLDA'`,
    [activeOrderId, secondOrderId],
  );

  // 078: espelho MP por OF — Conjunto C/D concluídos e o restante pendente.
  // OF-SEQ-1 fica PARCIAL, OF-SEQ-2 TOTAL e OF-SEQ-SEM NONE.
  await db.query(
    `insert into public.production_processes (order_item_id, process_id, status)
     select oi.id, p.id,
            case when oi.description in ('Conjunto C', 'Conjunto D')
                 then 'CONCLUIDO' else 'NAO_INICIADO' end
       from public.order_items oi
       cross join public.processes p
      where oi.order_id in ($1, $2, $3)
        and p.code = 'MP'`,
    [activeOrderId, secondOrderId, semFamilia[0]?.id],
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

  it("filtra as OFs pelo processo pendente e usa a sequência global", async () => {
    await asSuperUser(db);
    await db.query(
      `update public.order_items oi
          set seq = case when oi.order_id = $1 then 2 else 1 end
         where oi.order_id in ($1, $2)`,
      [activeOrderId, secondOrderId],
    );
    await asUser(db, "authenticated", adminId);

    const { rows } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling($1, null)`,
      [otherProcessId],
    );
    expect(rows.map((row) => row.order_code)).toEqual(["OF-SEQ-2", "OF-SEQ-1"]);

    const { rows: allOrders } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling(null, null)`,
    );
    expect(allOrders.map((row) => row.order_code)).toEqual([
      "OF-SEQ-2",
      "OF-SEQ-1",
      "OF-SEQ-SEM",
    ]);

    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp
          set status = 'NAO_APLICAVEL'
         from public.order_items oi
        where oi.id = pp.order_item_id
          and oi.order_id = $1
          and pp.process_id = $2`,
      [secondOrderId, otherProcessId],
    );
    await asUser(db, "authenticated", adminId);
    const { rows: filtered } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling($1, null)`,
      [otherProcessId],
    );
    expect(filtered.map((row) => row.order_code)).toEqual(["OF-SEQ-1"]);

    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp
          set status = 'NAO_INICIADO'
         from public.order_items oi
        where oi.id = pp.order_item_id
          and oi.order_id = $1
          and pp.process_id = $2`,
      [secondOrderId, otherProcessId],
    );
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

describe("migration 078 — situação do processo e da MP por OF", () => {
  it("agrega o espelho de MP por OF (TOTAL/PARCIAL/NONE)", async () => {
    await asUser(db, "authenticated", adminId);

    const { rows } = await db.query<{ order_code: string; mp_state: string | null }>(
      `select order_code, mp_state from public.get_process_scheduling($1, null)`,
      [processId],
    );

    const byCode = new Map(rows.map((row) => [row.order_code, row.mp_state]));
    expect(byCode.get("OF-SEQ-1")).toBe("PARCIAL");
    expect(byCode.get("OF-SEQ-2")).toBe("TOTAL");
    expect(byCode.get("OF-SEQ-SEM")).toBe("NONE");
  });

  it("OF sem MP aplicável fica com situação nula", async () => {
    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp
          set status = 'NAO_APLICAVEL'
         from public.order_items oi, public.processes p
        where oi.id = pp.order_item_id
          and oi.order_id = $1
          and p.id = pp.process_id
          and p.code = 'MP'`,
      [await idOf("OF-SEQ-SEM")],
    );

    await asUser(db, "authenticated", adminId);
    const { rows } = await db.query<{ order_code: string; mp_state: string | null }>(
      `select order_code, mp_state from public.get_process_scheduling($1, null)`,
      [processId],
    );
    expect(rows.find((row) => row.order_code === "OF-SEQ-SEM")?.mp_state).toBeNull();

    // Restaura o cenário dos demais testes.
    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp
          set status = 'NAO_INICIADO'
         from public.order_items oi, public.processes p
        where oi.id = pp.order_item_id
          and oi.order_id = $1
          and p.id = pp.process_id
          and p.code = 'MP'`,
      [await idOf("OF-SEQ-SEM")],
    );
  });

  it("mostra a situação do processo só quando há processo selecionado", async () => {
    await asUser(db, "authenticated", adminId);

    const { rows: filtered } = await db.query<{
      order_code: string;
      process_status: string | null;
    }>(`select order_code, process_status from public.get_process_scheduling($1, null)`, [
      processId,
    ]);
    // Neste cenário, todas as OFs retornadas ainda têm a etapa pendente.
    expect(filtered).toHaveLength(3);
    expect(filtered.every((row) => row.process_status === "NAO_INICIADO")).toBe(true);

    const { rows: global } = await db.query<{ process_status: string | null }>(
      `select process_status from public.get_process_scheduling(null, null)`,
    );
    expect(global.every((row) => row.process_status === null)).toBe(true);
  });

  it("inclui OF com processo concluído e retorna peso zero", async () => {
    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp
          set status = 'CONCLUIDO'
         from public.order_items oi
        where oi.id = pp.order_item_id
          and oi.order_id = $1
          and pp.process_id = $2`,
      [activeOrderId, processId],
    );

    await asUser(db, "authenticated", adminId);
    const { rows } = await db.query<{
      order_code: string;
      weight_kg: string;
      process_status: string;
    }>(
      `select order_code, weight_kg, process_status
         from public.get_process_scheduling($1, null)`,
      [processId],
    );

    const completed = rows.find((row) => row.order_code === "OF-SEQ-1");
    expect(completed).toMatchObject({
      weight_kg: "0",
      process_status: "CONCLUIDO",
    });
    expect(rows.find((row) => row.order_code === "OF-SEQ-2")?.weight_kg).toBe("120");

    await asSuperUser(db);
    await db.query(
      `update public.production_processes pp
          set status = 'NAO_INICIADO'
         from public.order_items oi
        where oi.id = pp.order_item_id
          and oi.order_id = $1
          and pp.process_id = $2`,
      [activeOrderId, processId],
    );
  });
});

describe("migration 095 — datas efetivas nos processos concluídos", () => {
  it("retorna filas ativas e a conclusão efetiva do EXP em OFs já concluídas", async () => {
    await asSuperUser(db);
    const { rows: shipped } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name, status, product_group_id)
       values ('OF-SEQ-SHIPPED-093', 'OF', 'Cliente EXP', 'CONCLUIDO', 1)
       returning id`,
    );
    const shippedOrderId = shipped[0]?.id as string;
    const { rows: root } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
       values ($1, 'Item expedido', 2, 25)
       returning id`,
      [shippedOrderId],
    );
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status, completed_at)
       select $1, p.id, 'CONCLUIDO', '2026-10-20T02:00:00Z'::timestamptz
         from public.processes p
        where p.code = 'EXP'`,
      [root[0]?.id],
    );

    await asUser(db, "authenticated", adminId);
    const { rows } = await db.query<{ process_code: string; rows: unknown }>(
      `select s.process_code, s.rows
         from public.get_all_process_scheduling() s
        where s.process_code = 'EXP'`,
    );
    const expQueue = rows[0]?.rows as {
      order_id: string;
      weight_kg: number | string;
      process_concluded: boolean;
      process_completed_at: string;
      exp_concluded: boolean;
      exp_completed_at: string;
    }[];
    const shippedRow = expQueue.find((row) => row.order_id === shippedOrderId);

    expect(shippedRow).toBeDefined();
    expect(shippedRow?.exp_concluded).toBe(true);
    expect(Number(shippedRow?.weight_kg)).toBe(0);
    expect(shippedRow?.process_concluded).toBe(true);
    expect(new Date(shippedRow?.process_completed_at ?? "").toISOString()).toBe("2026-10-20T02:00:00.000Z");
    expect(new Date(shippedRow?.exp_completed_at ?? "").toISOString()).toBe("2026-10-20T02:00:00.000Z");
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

    const { rows: globalSequence } = await db.query<{
      order_code: string;
      position: number;
    }>(
      `select o.code as order_code, min(oi.seq)::int as position
         from public.orders o
         join public.order_items oi on oi.order_id = o.id
        where o.id in ($1, $2)
        group by o.code
        order by position`,
      [activeOrderId, secondOrderId],
    );
    expect(globalSequence.map((row) => [row.order_code, row.position])).toEqual([
      ["OF-SEQ-1", 1],
      ["OF-SEQ-2", 2],
    ]);

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

  it("aceita no save as OFs concluídas que continuam visíveis na fila", async () => {
    await asSuperUser(db);
    await db.exec("begin");
    try {
      await db.query(
        `update public.production_processes pp
            set status = 'CONCLUIDO'
           from public.order_items oi
          where oi.id = pp.order_item_id
            and oi.order_id = $1
            and pp.process_id = $2`,
        [activeOrderId, processId],
      );

      await asUser(db, "authenticated", adminId);
      const { rows } = await db.query<{
        order_id: string;
        order_code: string;
        notes: string | null;
        process_status: string;
        weight_kg: string;
      }>(
        `select order_id, order_code, notes, process_status, weight_kg
           from public.get_process_scheduling($1, null)`,
        [processId],
      );
      const completedOrder = rows.find((row) => row.order_id === activeOrderId);
      expect(completedOrder).toMatchObject({
        process_status: "CONCLUIDO",
        weight_kg: "0",
      });

      // O componente envia todas as linhas exibidas, inclusive a concluída.
      await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
        processId,
        "2026-10-10",
        JSON.stringify(
          rows.map((row, index) => ({
            order_id: row.order_id,
            position: index + 1,
            notes: row.notes,
          })),
        ),
      ]);

      const { rows: saved } = await db.query<{ order_id: string }>(
        `select order_id
           from public.order_process_schedules
          where process_id = $1`,
        [processId],
      );
      expect(saved.map((row) => row.order_id)).toContain(activeOrderId);
    } finally {
      await asSuperUser(db);
      await db.exec("rollback");
    }
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

    // A ordem salva por LASER também é consumida pela fila de SOLDA.
    const { rows: otherProcessOrdering } = await db.query<{ order_code: string }>(
      `select order_code from public.get_process_scheduling($1, null)`,
      [otherProcessId],
    );
    expect(otherProcessOrdering.map((row) => row.order_code)).toEqual([
      "OF-SEQ-2",
      "OF-SEQ-1",
    ]);
  });

  it("salvar uma visão filtrada move as OFs já sequenciadas omitidas para o fim global", async () => {
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
      `select order_code, "position"
         from public.get_process_scheduling($1, null)`,
      [processId],
    );

    expect(rows.map((row) => [row.order_code, row.position])).toEqual([
      ["OF-SEQ-2", 1],
      ["OF-SEQ-1", 2],
      ["OF-SEQ-SEM", 3],
    ]);

    const { rows: globalSequence } = await db.query<{
      order_code: string;
      position: number;
    }>(
      `select o.code as order_code, min(oi.seq)::int as position
         from public.orders o
         join public.order_items oi on oi.order_id = o.id
        where o.id in ($1, $2, $3)
        group by o.code
        order by position`,
      [semFamiliaId, secondOrderId, activeOrderId],
    );
    expect(globalSequence.map((row) => [row.order_code, row.position])).toEqual([
      ["OF-SEQ-2", 1],
      ["OF-SEQ-1", 2],
      ["OF-SEQ-SEM", 3],
    ]);

    const { rows: settings } = await db.query<{ anchor_date: string }>(
      `select to_char(anchor_date, 'YYYY-MM-DD') as anchor_date
         from public.process_schedule_settings where process_id = $1`,
      [processId],
    );
    expect(settings[0]?.anchor_date).toBe("2026-10-08");
  });

  it("permite salvar a sequência global sem processo nem data", async () => {
    const semFamiliaId = await idOf("OF-SEQ-SEM");
    await asUser(db, "authenticated", adminId);

    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      null,
      null,
      JSON.stringify([
        { order_id: semFamiliaId, position: 1, notes: null },
        { order_id: activeOrderId, position: 2, notes: null },
        { order_id: secondOrderId, position: 3, notes: null },
      ]),
    ]);

    const { rows } = await db.query<{ order_code: string; position: number }>(
      `select o.code as order_code, min(oi.seq)::int as position
         from public.orders o
         join public.order_items oi on oi.order_id = o.id
        where o.id in ($1, $2, $3)
        group by o.code
        order by position`,
      [semFamiliaId, activeOrderId, secondOrderId],
    );
    expect(rows.map((row) => [row.order_code, row.position])).toEqual([
      ["OF-SEQ-SEM", 1],
      ["OF-SEQ-1", 2],
      ["OF-SEQ-2", 3],
    ]);
  });

  it("preserva sequências históricas de OFs concluídas", async () => {
    await asSuperUser(db);
    const completedOrderId = await idOf("OF-SEQ-CONCLUIDA");
    await db.query(
      `insert into public.order_items (order_id, description, quantity, seq)
       values ($1, 'Item concluído', 1, 100)`,
      [completedOrderId],
    );

    await asUser(db, "authenticated", adminId);
    await db.query(`select public.save_process_schedule($1, $2, $3::jsonb)`, [
      processId,
      "2026-10-09",
      JSON.stringify([
        { order_id: secondOrderId, position: 1, notes: null },
        { order_id: activeOrderId, position: 2, notes: null },
      ]),
    ]);

    const { rows } = await db.query<{ order_code: string; position: number }>(
      `select o.code as order_code, min(oi.seq)::int as position
         from public.orders o
         join public.order_items oi on oi.order_id = o.id
        where o.id in ($1, $2, $3, $4)
        group by o.code
        order by position`,
      [completedOrderId, secondOrderId, activeOrderId, await idOf("OF-SEQ-SEM")],
    );
    expect(rows.map((row) => [row.order_code, row.position])).toEqual([
      ["OF-SEQ-CONCLUIDA", 100],
      ["OF-SEQ-2", 101],
      ["OF-SEQ-1", 102],
      ["OF-SEQ-SEM", 103],
    ]);
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
