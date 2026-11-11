import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let adminId: string;

/** OF com marca manual do MP no PAI (simula a Gestão de OF). */
let orderA: string;
let rootA: string;
let childA1: string;
let childA2: string;

/** OF com MP só por CASCATA (nenhuma marca manual). */
let orderB: string;
let rootB: string;
let childB1: string;

/** OF cujo MP foi ZERADO pelo fluxo novo depois da marca legada. */
let orderC: string;
let rootC: string;

/** Data da marca manual (2026-10-21) e da cascata (2026-10-20). */
const MANUAL_DATE = "2026-10-21 12:00:00+00";
const CASCADE_DATE = "2026-10-20 11:00:00+00";

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
  quantity: number,
  unitWeight: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items
       (order_id, parent_item, description, quantity, unit_weight_kg, parent_order_item_id, status)
     values ($1, $2, 'Conjunto', $3, $4, $5, 'PLANEJADO') returning id`,
    [orderId, code, quantity, unitWeight, parentItemId],
  );
  return rows[0]?.id as string;
}

/** Célula MP do item (como a lista mostra): status + kg + datas. */
async function mpCell(itemId: string): Promise<{
  status: string;
  planned: number | null;
  completed: number | null;
  completedAt: string | null;
}> {
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
  return {
    status: row?.status ?? "",
    planned: row?.planned === null || row?.planned === undefined ? null : Number(row.planned),
    completed:
      row?.completed === null || row?.completed === undefined ? null : Number(row.completed),
    completedAt: row?.completed_at ?? null,
  };
}

/**
 * Deixa a célula MP do item no estado LEGADO (CONCLUIDO) e grava o
 * evento de histórico que a app gravava na época.
 */
async function markLegacy(
  itemId: string,
  newStatus: string,
  notes: string | null,
  createdAt: string,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.production_processes
       (order_item_id, process_id, status, started_at, completed_at)
     select $1, p.id, $2, $3::timestamptz, $3::timestamptz
       from public.processes p where p.code = 'MP'
     on conflict (order_item_id, process_id) do update
       set status = excluded.status,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at
     returning id`,
    [itemId, newStatus, createdAt],
  );
  const processId = rows[0]?.id;
  await db.query(
    `insert into public.production_events
       (production_process_id, user_id, event_type, old_status, new_status, notes, created_at)
     values ($1, $2, 'STATUS_CHANGE', 'NAO_INICIADO', $3, $4, $5)`,
    [processId, adminId, newStatus, notes, createdAt],
  );
}

/**
 * O backfill da 057: zera a célula MP dos itens PAIS (os que têm
 * filho) — foi o que apagou as marcas na produção. Os FILHOS ficam
 * como estavam.
 */
async function apply057Backfill(): Promise<void> {
  await db.query(`
    update public.production_processes pp
       set status = 'NAO_INICIADO',
           quantity_planned = agg.planned,
           quantity_completed = 0,
           completed_at = null
      from (
        select c.parent_order_item_id as parent_id,
               case when count(*) filter (where public.mp_item_planned(c.id) is null) = 0
                    then sum(public.mp_item_planned(c.id)) end as planned
          from public.order_items c
         where c.parent_order_item_id is not null
         group by c.parent_order_item_id
      ) agg
     where pp.order_item_id = agg.parent_id
       and exists (
         select 1 from public.processes pr
          where pr.id = pp.process_id and pr.code = 'MP'
       )
  `);
}

/** Relatório da recuperação (dry-run ou aplicação). */
async function recover(
  dryRun: boolean,
  scope = "todas",
  orderId: string | null = null,
): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ report: Record<string, unknown> }>(
    `select public.mp_receipt_recover_legacy($1, $2, $3) as report`,
    [dryRun, scope, orderId],
  );
  return rows[0]?.report ?? {};
}

async function receiptRows(orderId: string): Promise<
  { id: string; date: string; notes: string | null; kg: number }[]
> {
  const { rows } = await db.query<{ id: string; date: string; notes: string | null; kg: string }>(
    `select r.id,
            r.receipt_date::text as date,
            r.notes,
            coalesce(sum(i.quantity_kg), 0)::text as kg
       from public.mp_receipts r
       left join public.mp_receipt_items i on i.mp_receipt_id = r.id
      where r.order_id = $1
      group by r.id, r.receipt_date, r.notes
      order by r.receipt_date`,
    [orderId],
  );
  return rows.map((row) => ({ ...row, kg: Number(row.kg) }));
}

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;

  await asSuperUser(db);
  adminId = await createUser(db, "admin.recuperacao@serralheria.com", "ADMIN");

  // OF-A: pai com 2 filhos (20 kg + 10 kg). O PAI foi marcado À MÃO
  // (Gestão de OF) e o primeiro filho ficou CONCLUIDO por CASCATA.
  orderA = await createOrder("OF-REC-001", "Cliente A");
  rootA = await createItem(orderA, null, "PAI-1", 1, 30);
  childA1 = await createItem(orderA, rootA, "CH-1", 2, 10);
  childA2 = await createItem(orderA, rootA, "CH-2", 2, 5);

  // OF-B: MP só por cascata (o PRÉ-MTG do pai concluiu o MP dele).
  orderB = await createOrder("OF-REC-002", "Cliente B");
  rootB = await createItem(orderB, null, "PAI-2", 1, 20);
  childB1 = await createItem(orderB, rootB, "CH-3", 2, 10);

  // OF-C: raiz SEM filhos, marcada à mão e depois ZERADA pelo fluxo
  // novo (evento de espelho) — a recuperação não pode mexer nela.
  orderC = await createOrder("OF-REC-003", "Cliente C");
  rootC = await createItem(orderC, null, "PAI-3", 1, 12);

  // Todo item tem linha para todo processo ativo (010/022): MP nasce
  // NAO_INICIADO e os demais, NAO_APLICAVEL.
  await db.query(`select public.backfill_process(null)`);

  // As marcas legadas (a célula CONCLUIDO + o evento no histórico).
  await markLegacy(rootA, "CONCLUIDO", null, MANUAL_DATE);
  await markLegacy(childA1, "CONCLUIDO", "Concluído automaticamente ao concluir LASER", CASCADE_DATE);
  await markLegacy(rootB, "CONCLUIDO", "Concluído automaticamente ao concluir PRE_MTG", CASCADE_DATE);
  await markLegacy(rootC, "CONCLUIDO", null, MANUAL_DATE);

  // A 057 zerou as células dos PAIS (silenciosamente) — o estado atual.
  await apply057Backfill();

  // O fluxo novo zerou a célula da OF-C depois da marca legada
  // (é o caso de um recibo excluído à mão).
  await db.query(
    `update public.production_processes pp
        set status = 'NAO_INICIADO', completed_at = null
       from public.processes pr
      where pr.id = pp.process_id and pr.code = 'MP' and pp.order_item_id = $1`,
    [rootC],
  );
  await db.query(
    `insert into public.production_events
       (production_process_id, user_id, event_type, old_status, new_status, notes, created_at)
     select pp.id, $2, 'STATUS_CHANGE', 'CONCLUIDO', 'NAO_INICIADO',
            'Espelho do recebimento de MP (056)', $3::timestamptz
       from public.production_processes pp
       join public.processes pr on pr.id = pp.process_id
      where pp.order_item_id = $1 and pr.code = 'MP'`,
    [rootC, adminId, MANUAL_DATE],
  );
});

afterAll(async () => {
  await close();
});

describe("recuperação das marcações de MP (058)", () => {
  it("dry-run não grava nada e conta as marcas", async () => {
    await asUser(db, "authenticated", adminId);
    const report = await recover(true);
    await asSuperUser(db);

    expect(report.modo).toBe("dry-run");
    const marcas = report.marcas as Record<string, number>;
    // 4 marcas legadas: 2 manuais (PAI da OF-A e da OF-C) + 2 de cascata.
    expect(marcas.itens).toBe(4);
    expect(marcas.manual).toBe(2);
    expect(marcas.cascata).toBe(2);

    // Nenhum recibo gravado no dry-run.
    expect(await receiptRows(orderA)).toHaveLength(0);
    expect(await receiptRows(orderB)).toHaveLength(0);
    expect(await receiptRows(orderC)).toHaveLength(0);
  });

  it("escopo 'manual' ignora as marcas de cascata", async () => {
    await asUser(db, "authenticated", adminId);
    const report = await recover(true, "manual");
    await asSuperUser(db);

    const marcas = report.marcas as Record<string, number>;
    expect(marcas.itens).toBe(2);
    expect(marcas.manual).toBe(2);
    expect(marcas.cascata).toBe(0);
  });

  it("filtro por OF restringe o escopo da recuperação", async () => {
    await asUser(db, "authenticated", adminId);
    const report = await recover(true, "todas", orderB);
    await asSuperUser(db);

    // Só a OF-B entra no relatório.
    const marcas = report.marcas as Record<string, number>;
    expect(marcas.itens).toBe(1);
    expect(marcas.cascata).toBe(1);

    const porOf = report.por_of as { of: string; marcas: number }[];
    expect(porOf).toHaveLength(1);
    expect(porOf[0]?.of).toBe("OF-REC-002");
  });

  it("item zerado pelo fluxo novo depois da marca fica protegido", async () => {
    await asUser(db, "authenticated", adminId);
    const report = await recover(true, "todas");
    await asSuperUser(db);

    // A OF-C foi falada pelo fluxo novo DEPOIS da marca legada — a
    // linha não pode ser lançada (desfaria a exclusão).
    const linhas = report.linhas as Record<string, number>;
    expect(linhas.falado_depois).toBe(1);
  });

  it("escopo 'manual' restaura a marca manual (OF-A) e não a de cascata (OF-B)", async () => {
    await asUser(db, "authenticated", adminId);
    await recover(false, "manual");
    await asSuperUser(db);

    // OF-A: o PAI volta a CONCLUIDO (verde) e os filhos também — o
    // espelho do pai é o agregado dos filhos (057).
    expect(await mpCell(rootA)).toMatchObject({ status: "CONCLUIDO", planned: 30, completed: 30 });
    expect(await mpCell(childA1)).toMatchObject({ status: "CONCLUIDO", planned: 20, completed: 20 });
    expect(await mpCell(childA2)).toMatchObject({ status: "CONCLUIDO", planned: 10, completed: 10 });

    // OF-B: só tinha cascata → fica como estava.
    expect(await mpCell(rootB)).toMatchObject({ status: "NAO_INICIADO" });
    expect(await mpCell(childB1)).toMatchObject({ status: "NAO_INICIADO" });

    // Um recibo por (OF, data) — a data original da marcação.
    const receiptsA = await receiptRows(orderA);
    expect(receiptsA).toHaveLength(1);
    expect(receiptsA[0]?.date).toBe("2026-10-21");
    expect(receiptsA[0]?.kg).toBe(30);
    expect(receiptsA[0]?.notes).toContain("Recuperacao 058");
  });

  it("preserva a data original do recebimento (completed_at)", async () => {
    // O pai foi marcado em 21/10 → a lista mostra "recebida em 21/10".
    const pai = await mpCell(rootA);
    expect(pai.completedAt).not.toBeNull();
    expect(new Date(pai.completedAt as string).toISOString().slice(0, 10)).toBe("2026-10-21");
  });

  it("re-deriva o status do item e da OF", async () => {
    const { rows: item } = await db.query<{ status: string }>(
      `select status from public.order_items where id = $1`,
      [rootA],
    );
    expect(item[0]?.status).toBe("CONCLUIDO");

    const { rows: order } = await db.query<{ status: string }>(
      `select status from public.orders where id = $1`,
      [orderA],
    );
    expect(order[0]?.status).toBe("CONCLUIDO");
  });

  it("escopo 'todas' restaura também a marca de cascata (OF-B)", async () => {
    await asUser(db, "authenticated", adminId);
    await recover(false, "todas");
    await asSuperUser(db);

    expect(await mpCell(rootB)).toMatchObject({ status: "CONCLUIDO", planned: 20, completed: 20 });
    expect(await mpCell(childB1)).toMatchObject({ status: "CONCLUIDO", planned: 20, completed: 20 });

    const receiptsB = await receiptRows(orderB);
    expect(receiptsB).toHaveLength(1);
    expect(receiptsB[0]?.date).toBe("2026-10-20");
  });

  it("não lança recibo em item zerado pelo fluxo novo (OF-C)", async () => {
    // A OF-C ficou como o fluxo novo deixou (célula zerada).
    expect(await receiptRows(orderC)).toHaveLength(0);
    expect(await mpCell(rootC)).toMatchObject({ status: "NAO_INICIADO" });
  });

  it("é idempotente: rodar de novo não duplica nada", async () => {
    const before = {
      receiptsA: await receiptRows(orderA),
      receiptsB: await receiptRows(orderB),
      pai: await mpCell(rootA),
    };

    await asUser(db, "authenticated", adminId);
    const report = await recover(false, "todas");
    await asSuperUser(db);

    const linhas = report.linhas as Record<string, number>;
    expect(linhas.a_lancar).toBe(0);

    expect(await receiptRows(orderA)).toHaveLength(before.receiptsA.length);
    expect(await receiptRows(orderB)).toHaveLength(before.receiptsB.length);
    expect(await mpCell(rootA)).toMatchObject({
      status: before.pai.status,
      completed: before.pai.completed,
    });
  });

  it("rollback apaga os recibos e restaura as células MP", async () => {
    await asUser(db, "authenticated", adminId);
    const { rows } = await db.query<{ report: Record<string, unknown> }>(
      `select public.mp_receipt_rollback_legacy() as report`,
    );
    await asSuperUser(db);

    expect((rows[0]?.report as Record<string, unknown>).modo).toBe("rollback");

    // Sem recibos da recuperação.
    expect(await receiptRows(orderA)).toHaveLength(0);
    expect(await receiptRows(orderB)).toHaveLength(0);

    // A célula do pai volta ao estado que a 057 deixou.
    expect(await mpCell(rootA)).toMatchObject({ status: "NAO_INICIADO", completed: 0 });
    // O filho que a cascata marcou volta a CONCLUIDO (era o estado dele).
    expect(await mpCell(childA1)).toMatchObject({ status: "CONCLUIDO" });
  });
});
