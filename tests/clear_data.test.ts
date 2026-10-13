import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let operatorId: string;

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`select count(*) as n from public.${table}`);
  return Number(rows[0]?.n ?? 0);
}

/** Um cenário mínimo representativo de todo o movimento da aplicação. */
async function seedMovimento(): Promise<void> {
  await db.query(
    `insert into public.orders (code, type, customer_name, status, delivery_date)
     values ('OF-900', 'OF', 'Cliente Teste', 'EM_PRODUCAO', current_date) returning id`,
  );
  const { rows: orderRows } = await db.query<{ id: string }>(
    `select id from public.orders where code = 'OF-900'`,
  );
  const orderId = orderRows[0]?.id as string;

  const { rows: itemRows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
     values ($1, 'ESTRUTURA', 'ITEM-900', 'Item filho de teste', 5, 10.25, current_date, 'EM_PRODUCAO')
     returning id`,
    [orderId],
  );
  const itemId = itemRows[0]?.id as string;

  await db.query(
    `insert into public.order_item_materials (order_item_id, description, quantity, unit)
     values ($1, 'Chapa 3mm', 2, 'M2')`,
    [itemId],
  );

  const { rows: ppRows } = await db.query<{ id: string }>(
    `insert into public.production_processes (order_item_id, process_id, status)
     select $1, p.id, 'NAO_INICIADO'
       from public.processes p where p.code = 'LASER'
     returning id`,
    [itemId],
  );
  const productionProcessId = ppRows[0]?.id as string;

  await db.query(
    `insert into public.production_events (production_process_id, user_id, event_type, new_status)
     values ($1, $2, 'STATUS_CHANGE', 'NAO_INICIADO')`,
    [productionProcessId, operatorId],
  );

  const { rows: batchRows } = await db.query<{ id: string }>(
    `insert into public.import_batches (file_name, status, total_rows, valid_rows, error_rows, created_by)
     values ('planilha-teste.xlsx', 'COM_ERROS', 2, 1, 1, $1)
     returning id`,
    [operatorId],
  );
  const batchId = batchRows[0]?.id as string;

  await db.query(
    `insert into public.import_errors (import_batch_id, row_number, error_type, message)
     values ($1, 2, 'QTD_INVALIDA', 'quantidade inválida')`,
    [batchId],
  );
}

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;

  await asSuperUser(db);
  operatorId = await createUser(db, "operador.clear@serralheria.com", "OPERADOR");

  await seedMovimento();
});

afterAll(async () => {
  await close();
});

describe("clear_data.sql (limpeza do movimento)", () => {
  it("apaga todo o movimento e preserva usuários e catálogo de processos", async () => {
    // Cenário de partida: movimento completo em todas as 7 tabelas.
    expect(await count("orders")).toBe(1);
    expect(await count("order_items")).toBe(1);
    expect(await count("order_item_materials")).toBe(1);
    expect(await count("production_processes")).toBe(1);
    expect(await count("production_events")).toBe(1);
    expect(await count("import_batches")).toBe(1);
    expect(await count("import_errors")).toBe(1);

    const script = readFileSync(
      path.join(process.cwd(), "supabase", "clear_data.sql"),
      "utf8",
    );
    await db.exec(script);

    // Movimento zerado (cascade cobre itens, materiais, processos, eventos e erros).
    expect(await count("orders")).toBe(0);
    expect(await count("order_items")).toBe(0);
    expect(await count("order_item_materials")).toBe(0);
    expect(await count("production_processes")).toBe(0);
    expect(await count("production_events")).toBe(0);
    expect(await count("import_batches")).toBe(0);
    expect(await count("import_errors")).toBe(0);

    // Preservado: usuário e catálogo de processos (base para novos pedidos manuais).
    expect(await count("profiles")).toBe(1);
    expect(await count("processes")).toBeGreaterThan(0);
  });

  it("é idempotente: rodar de novo não falha nem altera o que ficou", async () => {
    const script = readFileSync(
      path.join(process.cwd(), "supabase", "clear_data.sql"),
      "utf8",
    );
    await db.exec(script);

    expect(await count("orders")).toBe(0);
    expect(await count("import_batches")).toBe(0);
    expect(await count("profiles")).toBe(1);
    expect(await count("processes")).toBeGreaterThan(0);
  });
});
