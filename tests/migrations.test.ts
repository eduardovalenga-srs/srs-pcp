import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;

const PROCESS_CODES = [
  "LASER",
  "DB_CH",
  "SERRA",
  "DB_TB",
  "PUNC",
  "METALEIRA",
  "FICEP",
  "KIT",
  "PRE_MTG",
  "SOLDA",
  "ACAB",
  "QUALITY",
  "EXP",
];

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;
});

afterAll(async () => {
  await close();
});

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = $1
     ) as exists`,
    [name],
  );
  return Boolean(rows[0]?.exists);
}

describe("migrations", () => {
  it("cria todas as tabelas do schema", async () => {
    for (const table of [
      "profiles",
      "orders",
      "order_items",
      "processes",
      "production_processes",
      "production_events",
      "import_batches",
      "import_errors",
    ]) {
      expect(await tableExists(table), `tabela ${table}`).toBe(true);
    }
  });

  it("popula o catálogo: MP na frente + os 13 processos do seed (021)", async () => {
    const { rows } = await db.query<{ code: string }>(
      "select code from public.processes order by display_order",
    );
    // MP (display_order 5) abre a lista — era a posição da coluna INICIO F1.
    expect(rows.map((row) => row.code)).toEqual(["MP", ...PROCESS_CODES]);
  });

  it("MP é controlável como os demais e o backfill preserva a situação (021)", async () => {
    await asSuperUser(db);

    // Catálogo: MP ativo, 1 dia de duração, antes da LASER (posição da
    // antiga coluna INICIO F1 — primeira coluna de processos).
    const { rows: mp } = await db.query<{
      active: boolean;
      display_order: number;
      duration_days: number;
    }>(`select active, display_order, duration_days from public.processes where code = 'MP'`);
    expect(mp).toHaveLength(1);
    expect(mp[0]?.active).toBe(true);
    expect(mp[0]?.duration_days).toBe(1);
    const { rows: laser } = await db.query<{ display_order: number }>(
      `select display_order from public.processes where code = 'LASER'`,
    );
    expect(mp[0]?.display_order).toBeLessThan(laser[0]?.display_order ?? 0);

    // Item cujos processos estão TODOS concluídos (situação derivada =
    // CONCLUIDO): a linha do MP, recriada pela migração, nasce CONCLUIDO.
    const { rows: order } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-MP-021', 'OF') returning id`,
    );
    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item MP', 1) returning id`,
      [order[0]?.id],
    );
    const itemId = item[0]?.id as string;

    await db.query(`select public.backfill_process(null)`);
    await db.query(
      `update public.production_processes set status = 'CONCLUIDO' where order_item_id = $1`,
      [itemId],
    );
    // Simula o estado anterior à 021: item concluído ainda sem a linha do MP.
    await db.query(
      `delete from public.production_processes
        where order_item_id = $1
          and process_id = (select id from public.processes where code = 'MP')`,
      [itemId],
    );

    const migration = readFileSync(
      path.join(process.cwd(), "supabase", "migrations", "021_mp_process.sql"),
      "utf8",
    );
    await db.exec(migration);

    const { rows: restored } = await db.query<{ status: string }>(
      `select pp.status
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
        where pp.order_item_id = $1 and p.code = 'MP'`,
      [itemId],
    );
    expect(restored).toHaveLength(1);
    expect(restored[0]?.status).toBe("CONCLUIDO");

    // Limpeza: o comportamento da migração foi verificado; o item de
    // apoio não deve pesar nas contagens dos próximos testes.
    await db.query(`delete from public.orders where code = 'OF-MP-021'`);

    await asSuperUser(db);
  });

  it("cria o profile automaticamente ao cadastrar usuário", async () => {
    const userId = await createUser(db, "operador@serralheria.com");
    const { rows } = await db.query<{ role: string; email: string }>(
      "select role, email from public.profiles where id = $1",
      [userId],
    );
    expect(rows[0]?.role).toBe("OPERADOR");
    expect(rows[0]?.email).toBe("operador@serralheria.com");
  });

  it("possui constraint única em (order_item_id, process_id)", async () => {
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count
         from pg_indexes
        where tablename = 'production_processes'
          and indexdef ilike '%unique%'`,
    );
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });

  it("cria os índices de performance", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'`,
    );
    const indexes = rows.map((row) => row.indexname);
    expect(indexes).toContain("idx_orders_delivery_date");
    expect(indexes).toContain("idx_orders_status");
    expect(indexes).toContain("idx_order_items_family");
    expect(indexes).toContain("idx_order_items_delivery_date");
    expect(indexes).toContain("idx_production_processes_status");
    expect(indexes).toContain("idx_production_processes_process_id");
  });

  it("processos têm local e duração em dias (008)", async () => {
    await asSuperUser(db);

    const { rows: columns } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'processes'
          and column_name in ('location', 'duration_days')`,
    );
    expect(columns).toHaveLength(2);

    // Registro novo nasce com 1 dia de duração e sem local.
    const inserted = await db.query<{ duration_days: number; location: string | null }>(
      `insert into public.processes (code, name, display_order)
       values ('DUR_TEST', 'DUR_TEST', 900)
       returning duration_days, location`,
    );
    expect(inserted.rows[0].duration_days).toBe(1);
    expect(inserted.rows[0].location).toBeNull();

    // Local é preenchido normalmente…
    await db.query(`update public.processes set location = 'Fábrica 1' where code = 'DUR_TEST'`);

    // …mas a duração respeita a faixa de 1 a 365 dias.
    await expect(
      db.query(`update public.processes set duration_days = 0 where code = 'DUR_TEST'`),
    ).rejects.toThrow();
    await expect(
      db.query(`update public.processes set duration_days = 400 where code = 'DUR_TEST'`),
    ).rejects.toThrow();
    await asSuperUser(db);
  });

  it("reordena a cadeia de processos sem mudar os códigos (009)", async () => {
    await asSuperUser(db);

    const { rows } = await db.query<{ id: string; code: string }>(
      "select id, code from public.processes order by display_order limit 3",
    );
    expect(rows).toHaveLength(3);

    // Inverte as três primeiras posições (posição vira 1..N).
    const reversed = [...rows].reverse();
    const idList = reversed.map((row) => `'${row.id}'`).join(", ");
    await db.query(`select public.reorder_processes(array[${idList}]::uuid[])`);

    const { rows: after } = await db.query<{ code: string; display_order: number }>(
      `select code, display_order from public.processes
        where id in (${idList}) order by display_order`,
    );
    expect(after.map((row) => row.code)).toEqual(reversed.map((row) => row.code));
    expect(after.map((row) => row.display_order)).toEqual([1, 2, 3]);

    // Lista inválida (id desconhecido) não altera nada.
    await expect(
      db.query(`select public.reorder_processes(array['00000000-0000-0000-0000-000000000000']::uuid[])`),
    ).rejects.toThrow();

    // Lista vazia também é recusada.
    await expect(db.query(`select public.reorder_processes(array[]::uuid[])`)).rejects.toThrow();

    await asSuperUser(db);
  });

  it("preenche itens órfãos com NAO_INICIADO e é idempotente (010)", async () => {
    await asSuperUser(db);

    const { rows: order } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-BACKFILL-1', 'OF') returning id`,
    );
    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item backfill', 1) returning id`,
      [order[0]?.id],
    );
    const itemId = item[0]?.id as string;

    const { rows: proc } = await db.query<{ id: string }>(
      `select id from public.processes where active order by display_order limit 1`,
    );
    const processId = proc[0]?.id as string;
    expect(processId).toBeTruthy();

    // 1ª chamada cria a linha com status padrão…
    const { rows: first } = await db.query<{ created: number }>(
      `select public.backfill_process($1) as created`,
      [processId],
    );
    expect(Number(first[0]?.created)).toBe(1);

    // 022: linha nova nasce NAO_APLICAVEL — processo de catálogo não
    // atravessa sozinho todos os itens; quem marca é o pedido.
    const { rows: status } = await db.query<{ status: string }>(
      `select status from public.production_processes
        where order_item_id = $1 and process_id = $2`,
      [itemId, processId],
    );
    expect(status[0]?.status).toBe("NAO_APLICAVEL");

    // …status já avançado nunca é sobrescrito…
    await db.query(
      `update public.production_processes set status = 'CONCLUIDO' where order_item_id = $1`,
      [itemId],
    );

    // …e a 2ª chamada não cria nem mexe em nada (idempotente).
    const { rows: second } = await db.query<{ created: number }>(
      `select public.backfill_process($1) as created`,
      [processId],
    );
    expect(Number(second[0]?.created)).toBe(0);

    // Global (null) completa os demais processos ativos do item.
    const { rows: active } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.processes where active`,
    );
    const { rows: global } = await db.query<{ created: number }>(
      `select public.backfill_process(null) as created`,
    );
    expect(Number(global[0]?.created)).toBe(Number(active[0]?.count) - 1);

    const { rows: missing } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.processes p
        where p.active and not exists (
          select 1 from public.production_processes pp
           where pp.process_id = p.id and pp.order_item_id = $1)`,
      [itemId],
    );
    expect(Number(missing[0]?.count)).toBe(0);

    // O CONCLUIDO gravado antes do backfill global permanece.
    const { rows: preserved } = await db.query<{ status: string }>(
      `select status from public.production_processes
        where order_item_id = $1 and process_id = $2`,
      [itemId, processId],
    );
    expect(preserved[0]?.status).toBe("CONCLUIDO");

    await asSuperUser(db);
  });

  it("MP nasce NAO_INICIADO no backfill — os demais nascem desmarcados (022)", async () => {
    await asSuperUser(db);

    const { rows: order } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-BACKFILL-2', 'OF') returning id`,
    );
    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item backfill 022', 1) returning id`,
      [order[0]?.id],
    );
    const itemId = item[0]?.id as string;

    // Processo novo no catálogo: entra como "não se aplica" no item.
    const { rows: novo } = await db.query<{ id: string }>(
      `insert into public.processes (code, name, display_order, active)
       values ('BF_NOVO', 'BF_NOVO', 902, true) returning id`,
    );
    await db.query(`select public.backfill_process($1)`, [novo[0]?.id]);

    const { rows: novoStatus } = await db.query<{ status: string }>(
      `select status from public.production_processes
        where order_item_id = $1 and process_id = $2`,
      [itemId, novo[0]?.id],
    );
    expect(novoStatus[0]?.status).toBe("NAO_APLICAVEL");

    // MP (021) é pré-requisito para iniciar a produção: é o único que
    // nasce aplicável, mesmo no backfill global.
    await db.query(`select public.backfill_process(null)`);

    const { rows: porProcesso } = await db.query<{ code: string; status: string }>(
      `select p.code, pp.status
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
        where pp.order_item_id = $1
          and p.code in ('MP', 'LASER', 'BF_NOVO')
        order by p.code`,
      [itemId],
    );
    expect(porProcesso).toEqual([
      { code: "BF_NOVO", status: "NAO_APLICAVEL" },
      { code: "LASER", status: "NAO_APLICAVEL" },
      { code: "MP", status: "NAO_INICIADO" },
    ]);

    // Limpeza: catálogo de teste não pode vazar (o FK para processes é
    // restrict — as linhas criadas nos demais itens saem primeiro).
    await db.query(
      `delete from public.production_processes
        where process_id = (select id from public.processes where code = 'BF_NOVO')`,
    );
    await db.query(`delete from public.production_processes where order_item_id = $1`, [itemId]);
    await db.query(`delete from public.processes where code = 'BF_NOVO'`);

    await asSuperUser(db);
  });

  it("recusa processo inexistente ou inativo no backfill (010)", async () => {
    await asSuperUser(db);

    await expect(
      db.query(`select public.backfill_process('00000000-0000-0000-0000-000000000000')`),
    ).rejects.toThrow(/inválido|inativo/i);

    const { rows } = await db.query<{ id: string }>(
      `insert into public.processes (code, name, display_order, active)
       values ('BF_INATIVO', 'BF_INATIVO', 901, false) returning id`,
    );
    await expect(
      db.query(`select public.backfill_process($1)`, [rows[0]?.id]),
    ).rejects.toThrow(/inválido|inativo/i);

    await asSuperUser(db);
  });

  it("anon não executa o backfill (010)", async () => {
    await asUser(db, "anon", null);
    await expect(db.query(`select public.backfill_process(null)`)).rejects.toThrow();
    await asSuperUser(db);
  });

  it("VISUALIZADOR não preenche linhas (RLS 010)", async () => {
    const userId = await createUser(db, "viz-backfill@serralheria.com", "VISUALIZADOR");
    await asUser(db, "authenticated", userId);
    await expect(db.query(`select public.backfill_process(null)`)).rejects.toThrow();
    await asSuperUser(db);
  });

  it("cria a tabela de materiais e troca a lista por item (011)", async () => {
    await asSuperUser(db);

    expect(await tableExists("order_item_materials")).toBe(true);

    const { rows: order } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-MAT-1', 'OF') returning id`,
    );
    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item materiais', 1) returning id`,
      [order[0]?.id],
    );
    const itemId = item[0]?.id as string;

    const materials = [
      { description: "Chapa xadrez 3 mm", quantity: 12.5, unit: "KG", notes: "" },
      { description: "Tubo 40x40", quantity: 8, unit: "M", notes: "corte 2 m" },
    ];

    const { rows: first } = await db.query<{ created: number }>(
      `select public.replace_item_materials($1, $2::jsonb) as created`,
      [itemId, JSON.stringify(materials)],
    );
    expect(Number(first[0]?.created)).toBe(2);

    const { rows: rows1 } = await db.query<{
      description: string;
      quantity: string | number;
      unit: string;
      notes: string | null;
    }>(
      `select description, quantity, unit, notes
         from public.order_item_materials where order_item_id = $1`,
      [itemId],
    );
    expect(rows1).toHaveLength(2);
    const chapa = rows1.find((row) => row.description === "Chapa xadrez 3 mm");
    expect(chapa?.unit).toBe("KG");
    expect(Number(chapa?.quantity)).toBe(12.5);

    // Substituição: a lista antiga sai por inteiro (mesmo padrão do save do pedido).
    const { rows: second } = await db.query<{ created: number }>(
      `select public.replace_item_materials($1, $2::jsonb) as created`,
      [itemId, JSON.stringify([{ description: "Parafuso M8", quantity: 100, unit: "UN" }])],
    );
    expect(Number(second[0]?.created)).toBe(1);

    const { rows: rows2 } = await db.query<{ description: string }>(
      `select description from public.order_item_materials where order_item_id = $1`,
      [itemId],
    );
    expect(rows2).toHaveLength(1);
    expect(rows2[0]?.description).toBe("Parafuso M8");

    // Lista vazia zera o item.
    await db.query(`select public.replace_item_materials($1, '[]'::jsonb)`, [itemId]);
    const { rows: empty } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.order_item_materials where order_item_id = $1`,
      [itemId],
    );
    expect(Number(empty[0]?.count)).toBe(0);

    await asSuperUser(db);
  });

  it("valida descrição, quantidade, formato e item na RPC (011)", async () => {
    await asSuperUser(db);

    const { rows: order } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-MAT-2', 'OF') returning id`,
    );
    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item validação', 1) returning id`,
      [order[0]?.id],
    );
    const itemId = item[0]?.id as string;

    await expect(
      db.query(`select public.replace_item_materials($1, $2::jsonb)`, [
        itemId,
        JSON.stringify([{ description: "Chapa", quantity: 0, unit: "KG" }]),
      ]),
    ).rejects.toThrow(/quantidade/i);

    await expect(
      db.query(`select public.replace_item_materials($1, $2::jsonb)`, [
        itemId,
        JSON.stringify([{ description: "   ", quantity: 1, unit: "KG" }]),
      ]),
    ).rejects.toThrow(/descrição/i);

    await expect(
      db.query(`select public.replace_item_materials($1, '{"nao": "e array"}'::jsonb)`, [itemId]),
    ).rejects.toThrow(/lista/i);

    const many = Array.from({ length: 51 }, (_, index) => ({
      description: `Material ${index + 1}`,
      quantity: 1,
      unit: "UN",
    }));
    await expect(
      db.query(`select public.replace_item_materials($1, $2::jsonb)`, [itemId, JSON.stringify(many)]),
    ).rejects.toThrow(/50/);

    await expect(
      db.query(`select public.replace_item_materials('00000000-0000-0000-0000-000000000000', '[]'::jsonb)`),
    ).rejects.toThrow(/não encontrado/i);

    await asSuperUser(db);
  });

  it("RLS 011: GESTOR grava; OPERADOR, VISUALIZADOR e anon não", async () => {
    await asSuperUser(db);

    const { rows: order } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-MAT-3', 'OF') returning id`,
    );
    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item RLS', 1) returning id`,
      [order[0]?.id],
    );
    const itemId = item[0]?.id as string;
    const payload = JSON.stringify([{ description: "Aço carbono", quantity: 2, unit: "KG" }]);

    // GESTOR substitui a lista (delete + insert passam pelo has_role).
    const gestorId = await createUser(db, "gestor-mat@serralheria.com", "GESTOR");
    await asUser(db, "authenticated", gestorId);
    const { rows: ok } = await db.query<{ created: number }>(
      `select public.replace_item_materials($1, $2::jsonb) as created`,
      [itemId, payload],
    );
    expect(Number(ok[0]?.created)).toBe(1);
    await asSuperUser(db);

    // OPERADOR não edita pedidos (falha no delete da substituição).
    const operadorId = await createUser(db, "operador-mat@serralheria.com", "OPERADOR");
    await asUser(db, "authenticated", operadorId);
    await expect(
      db.query(`select public.replace_item_materials($1, $2::jsonb)`, [itemId, payload]),
    ).rejects.toThrow();
    await asSuperUser(db);

    // VISUALIZADOR é somente leitura.
    const vizId = await createUser(db, "viz-mat@serralheria.com", "VISUALIZADOR");
    await asUser(db, "authenticated", vizId);
    await expect(
      db.query(`select public.replace_item_materials($1, $2::jsonb)`, [itemId, payload]),
    ).rejects.toThrow();
    await asSuperUser(db);

    // anon não tem nem execute.
    await asUser(db, "anon", null);
    await expect(
      db.query(`select public.replace_item_materials($1, $2::jsonb)`, [itemId, payload]),
    ).rejects.toThrow();

    await asSuperUser(db);
  });

  it("adiciona status e troca de senha; blinda colunas sensíveis (012 + 026)", async () => {
    await asSuperUser(db);

    // Colunas novas existem no profile.
    const { rows: columns } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles'
          and column_name in ('active', 'must_change_password')`,
    );
    expect(columns).toHaveLength(2);

    // Perfil novo nasce ativo e sem aviso de troca de senha.
    const uid = await createUser(db, "flag-012@serralheria.com");
    const { rows: initial } = await db.query<{
      active: boolean;
      must_change_password: boolean;
    }>(
      `select active, must_change_password from public.profiles where id = $1`,
      [uid],
    );
    expect(initial[0]?.active).toBe(true);
    expect(initial[0]?.must_change_password).toBe(false);

    // O próprio usuário não altera role/status: sem grant de coluna para
    // a sessão comum (026) — falha antes até de chegar no trigger 012.
    await asUser(db, "authenticated", uid);
    await expect(
      db.query(`update public.profiles set role = 'ADMIN' where id = $1`, [uid]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      db.query(`update public.profiles set active = false where id = $1`, [uid]),
    ).rejects.toThrow(/permission denied/i);

    // …mas pode ajustar nome e marcar/limpar o aviso de senha temporária.
    await db.query(
      `update public.profiles set name = 'Nome Ajustado', must_change_password = true
        where id = $1`,
      [uid],
    );
    const { rows: selfOk } = await db.query<{ name: string; must_change_password: boolean }>(
      `select name, must_change_password from public.profiles where id = $1`,
      [uid],
    );
    expect(selfOk[0]?.name).toBe("Nome Ajustado");
    expect(selfOk[0]?.must_change_password).toBe(true);

    await asSuperUser(db);

    // role/active não têm grant nem para a sessão de um ADMIN (026: o
    // grant é por papel de banco, não por usuário)…
    const admin = await createUser(db, "admin-012@serralheria.com", "ADMIN");
    await asUser(db, "authenticated", admin);
    await expect(
      db.query(`update public.profiles set role = 'GESTOR' where id = $1`, [uid]),
    ).rejects.toThrow(/permission denied/i);

    // …a troca de papel sai pelo caminho de serviço (client service-role
    // em users.service), que segue gravando normalmente.
    await asSuperUser(db);
    await db.query(`update public.profiles set role = 'GESTOR' where id = $1`, [uid]);
    const { rows: changed } = await db.query<{ role: string }>(
      `select role from public.profiles where id = $1`,
      [uid],
    );
    expect(changed[0]?.role).toBe("GESTOR");
    await asSuperUser(db);
  });

  it("013: order_items ganha a coluna op com validação de 1 a 50 caracteres", async () => {
    await asSuperUser(db);

    const { rows: columns } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'order_items' and column_name = 'op'`,
    );
    expect(columns).toHaveLength(1);

    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-OP-1', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, op)
       values ($1, 'Item com OP', 2, 'OP-123') returning id`,
      [orderId],
    );
    const itemId = itemRows[0]?.id as string;

    // Em branco (null) = em espera: aceito.
    await db.query(`update public.order_items set op = null where id = $1`, [itemId]);

    // Valor vazio e acima de 50 caracteres: recusados pelo check.
    await expect(
      db.query(`update public.order_items set op = '' where id = $1`, [itemId]),
    ).rejects.toThrow();
    await expect(
      db.query(`update public.order_items set op = $1 where id = $2`, ["X".repeat(51), itemId]),
    ).rejects.toThrow();

    // Limite de 50 caracteres: aceito.
    await db.query(`update public.order_items set op = $1 where id = $2`, ["X".repeat(50), itemId]);
    const { rows: final } = await db.query<{ op: string }>(
      `select op from public.order_items where id = $1`,
      [itemId],
    );
    expect(final[0]?.op).toHaveLength(50);
  });

  it("015: order_items ganha total_weight_kg e o catálogo ganha METALEIRA", async () => {
    await asSuperUser(db);

    // Coluna nova: hoje DERIVADA (023) — o valor enviado é ignorado.
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-KG-1', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg, total_weight_kg)
       values ($1, 'Item com peso total', 2, 12.75, 25.5) returning id`,
      [orderId],
    );
    const itemId = itemRows[0]?.id as string;

    // Tentar gravar negativo não estoura mais: o trigger (023) recalcula
    // a partir de qtd × peso unit. antes do check constraint.
    await db.query(`update public.order_items set total_weight_kg = -1 where id = $1`, [itemId]);
    const { rows: afterNegative } = await db.query<{ total_weight_kg: string | null }>(
      `select total_weight_kg::text as total_weight_kg from public.order_items where id = $1`,
      [itemId],
    );
    expect(afterNegative[0]?.total_weight_kg).toBe("25.5");

    // Processo METALEIRA cadastrado, ativo e na posição 55 (entre PUNC e FICEP).
    const { rows: processes } = await db.query<{
      code: string;
      active: boolean;
      display_order: number;
    }>(
      `select code, active, display_order from public.processes where code = 'METALEIRA'`,
    );
    expect(processes).toHaveLength(1);
    expect(processes[0]?.active).toBe(true);
    expect(processes[0]?.display_order).toBe(55);
  });

  it("016: vínculo pai/filho com cascade e a RPC apply_of_import", async () => {
    await asSuperUser(db);

    // Coluna nova em order_items.
    const { rows: columns } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'order_items'
          and column_name = 'parent_order_item_id'`,
    );
    expect(columns).toHaveLength(1);

    // Índice usado pela grade de produção (filtro por itens pai).
    const { rows: indexes } = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'order_items'
          and indexname = 'order_items_parent_order_item_id_idx'`,
    );
    expect(indexes).toHaveLength(1);

    // RPC do novo plano existe, com grant para authenticated e revoke de anon.
    const { rows: functions } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'apply_of_import'`,
    );
    expect(functions[0]?.count).toBe("1");

    // Grant para authenticated (anon cai na checagem de sessão da própria RPC).
    const { rows: grants } = await db.query<{ authenticated: boolean }>(
      `select has_function_privilege('authenticated', 'public.apply_of_import(jsonb)', 'EXECUTE') as authenticated`,
    );
    expect(grants[0]?.authenticated).toBe(true);

    // Policy de DELETE de itens agora aceita GESTOR (a 002 era só ADMIN e
    // o DELETE da importação era silenciosamente ignorado).
    const { rows: policies } = await db.query<{
      policyname: string;
      cmd: string;
      roles: string[];
      qual: string | null;
    }>(
      `select policyname, cmd, roles, qual from pg_policies
        where schemaname = 'public' and tablename = 'order_items'`,
    );
    expect(
      policies.filter(
        (entry) =>
          entry.policyname === "order_items_delete" &&
          entry.cmd.toUpperCase() === "DELETE" &&
          entry.roles.includes("authenticated") &&
          (entry.qual ?? "").includes("GESTOR"),
      ),
    ).toHaveLength(1);

    // Vínculo filho -> pai com ON DELETE CASCADE.
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-016', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: parentRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity)
       values ($1, 'P-016', 'Pai 016', 1) returning id`,
      [orderId],
    );
    const parentId = parentRows[0]?.id as string;
    const { rows: childRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity, parent_order_item_id)
       values ($1, 'C-016', 'Filho 016', 1, $2) returning id`,
      [orderId, parentId],
    );
    const childId = childRows[0]?.id as string;

    // Exclusão do pai remove o filho junto (mesmo caminho da exclusão da OF).
    await db.query("delete from public.order_items where id = $1", [parentId]);
    const { rows: child } = await db.query<{ id: string }>(
      "select id from public.order_items where id = $1",
      [childId],
    );
    expect(child).toHaveLength(0);
  });

  it("023: peso total é DERIVADO (qtd × peso unit.) em insert e update", async () => {
    await asSuperUser(db);

    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-023', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;

    // INSERT manual (pedido criado no formulário): nenhum total é enviado.
    const { rows: manual } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg)
       values ($1, 'Manual', 4, 12.5) returning id`,
      [orderId],
    );
    const manualId = manual[0]?.id as string;

    // INSERT com valor divergente (pos_PesoTotal da planilha): prevalece a fórmula.
    await db.query(
      `insert into public.order_items (order_id, description, quantity, unit_weight_kg, total_weight_kg)
       values ($1, 'Planilha', 2, 3, 999)`,
      [orderId],
    );

    // Item sem peso unitário fica com o total nulo (exibição: "—").
    await db.query(
      `insert into public.order_items (order_id, description, quantity) values ($1, 'Sem peso', 1)`,
      [orderId],
    );

    const { rows: afterInsert } = await db.query<{ description: string; total_weight_kg: string | null }>(
      `select description, total_weight_kg::text as total_weight_kg
         from public.order_items where order_id = $1 order by description`,
      [orderId],
    );
    expect(afterInsert).toEqual([
      { description: "Manual", total_weight_kg: "50" },
      { description: "Planilha", total_weight_kg: "6" },
      { description: "Sem peso", total_weight_kg: null },
    ]);

    // UPDATE de quantidade recalcula (antes o coalesce mantinha o valor antigo).
    await db.query(`update public.order_items set quantity = 10 where id = $1`, [manualId]);
    const { rows: afterUpdate } = await db.query<{ total_weight_kg: string | null }>(
      `select total_weight_kg::text as total_weight_kg from public.order_items where id = $1`,
      [manualId],
    );
    expect(afterUpdate[0]?.total_weight_kg).toBe("125");

    // UPDATE do peso unitário também recalcula.
    await db.query(`update public.order_items set unit_weight_kg = 1.5 where id = $1`, [manualId]);
    const { rows: afterWeight } = await db.query<{ total_weight_kg: string | null }>(
      `select total_weight_kg::text as total_weight_kg from public.order_items where id = $1`,
      [manualId],
    );
    expect(afterWeight[0]?.total_weight_kg).toBe("15");

    // Índices de performance (itens raiz + FK de pai) existem.
    const { rows: indexes } = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'order_items'
          and indexname in ('idx_order_items_root', 'idx_order_items_parent_item_id')`,
    );
    expect(indexes.map((row) => row.indexname).sort()).toEqual([
      "idx_order_items_parent_item_id",
      "idx_order_items_root",
    ]);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("024: get_production_rows soma PESO TOTAL (qtd × peso unit.)", async () => {
    await asSuperUser(db);

    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-024', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    // 3 × 10 kg = 30 kg  +  2 × 5 kg = 10 kg  =>  40 kg no card.
    await db.query(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'P-1', 'OF-024 pai 1', 3, 10),
              ($1, 'P-2', 'OF-024 pai 2', 2, 5)`,
      [orderId],
    );

    const { rows } = await db.query<{ weight_total: string; qty_total: string; total_count: string }>(
      `select * from public.get_production_rows(p_search => 'OF-024')`,
    );
    expect(rows).toHaveLength(2);
    expect(Number(rows[0]?.weight_total)).toBe(40);
    expect(Number(rows[0]?.qty_total)).toBe(5);
    expect(Number(rows[0]?.total_count)).toBe(2);

    // Filtro estreito: só o item 1 (30 kg).
    const { rows: filtrado } = await db.query<{ weight_total: string }>(
      `select * from public.get_production_rows(p_search => 'OF-024 pai 1')`,
    );
    expect(Number(filtrado[0]?.weight_total)).toBe(30);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("024: get_production_stats usa peso total e get_dashboard_orders agrega no banco", async () => {
    await asSuperUser(db);

    type Stats = { delivery: { overdue: number; overdueQty: number; overdueWeight: number } };
    const readStats = async (): Promise<Stats> => {
      const { rows } = await db.query<{ stats: Stats | string }>(`select public.get_production_stats() as stats`);
      const raw = rows[0]?.stats;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as Stats;
    };

    const before = await readStats();

    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, status, order_date)
       values ('OF-STATS', 'OF', 'PLANEJADO', current_date) returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    await db.query(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg, delivery_date)
       values ($1, 'P-STATS', 'Item de stats', 4, 12.5, current_date - 2)`,
      [orderId],
    );

    // Card "Atrasados" soma o PESO TOTAL do item (4 × 12,5 = 50 kg),
    // não o peso unitário (12,5 kg).
    const after = await readStats();
    expect(Number(after.delivery.overdue) - Number(before.delivery.overdue)).toBe(1);
    expect(Number(after.delivery.overdueQty) - Number(before.delivery.overdueQty)).toBe(4);
    expect(Number(after.delivery.overdueWeight) - Number(before.delivery.overdueWeight)).toBe(50);

    // Dashboard: agregação no banco (top clientes + envelhecimento).
    const { rows: dashRows } = await db.query<{ data: { topCustomers: unknown[]; aging: Record<string, number> } }>(
      `select public.get_dashboard_orders() as data`,
    );
    const dash = dashRows[0]?.data;
    expect(Array.isArray(dash?.topCustomers)).toBe(true);
    expect(dash?.topCustomers.length).toBeGreaterThan(0);
    // O pedido de hoje (em aberto) cai na faixa "0 a 7 dias".
    expect(Number(dash?.aging["0-7"])).toBeGreaterThan(0);

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("025: cria get_production_rows_by_order (consolidada por OF) + índice por pedido", async () => {
    await asSuperUser(db);

    // A RPC antiga (get_production_rows) continua intacta — é ela que
    // sustenta a Fábrica 2; a nova é uma função DIFERENTE.
    const { rows: functions } = await db.query<{ by_order: string; item: string }>(
      `select
         (select count(*)::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_production_rows_by_order') as by_order,
         (select count(*)::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'get_production_rows') as item`,
    );
    expect(Number(functions[0]?.by_order)).toBeGreaterThanOrEqual(1);
    expect(Number(functions[0]?.item)).toBeGreaterThanOrEqual(1);

    // Permissões na régua das RPCs de produção: authenticated executa.
    // (anon perde o grant direto — no PGlite ele ainda herda o EXECUTE
    // default de PUBLIC, então a checagem de "revoke" é só do grant.)
    const sig =
      "public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date)";
    const { rows: grants } = await db.query<{ authenticated: boolean }>(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated`,
      [sig],
    );
    expect(grants[0]?.authenticated).toBe(true);

    // Índice de apoio da consolidação (agrupa itens por pedido).
    const { rows: indexes } = await db.query<{ count: string }>(
      `select count(*)::text as count from pg_indexes
        where schemaname = 'public' and indexname = 'idx_order_items_order_id'`,
    );
    expect(Number(indexes[0]?.count)).toBe(1);

    // Pedido manual com 2 itens raiz vira UMA linha, com qtd/peso somados
    // e a entrega vindo do PEDIDO (orders.delivery_date).
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-025', 'OF', 'Cliente 025', current_date + 5) returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    // 3 × 10 kg = 30 kg  +  2 × 5 kg = 10 kg  =>  40 kg e 5 peças na linha.
    await db.query(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'P-025-1', 'OF-025 pai 1', 3, 10),
              ($1, 'P-025-2', 'OF-025 pai 2', 2, 5)`,
      [orderId],
    );

    const { rows } = await db.query<{
      total_count: string;
      qty_total: string;
      weight_total: string;
      quantity: string;
      weight_kg: string | null;
      delivery_date: string;
      processes: Record<string, unknown>;
    }>(`select * from public.get_production_rows_by_order(p_search => 'OF-025')`);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.total_count)).toBe(1);
    expect(Number(rows[0]?.quantity)).toBe(5);
    expect(Number(rows[0]?.weight_kg)).toBe(40);
    expect(Number(rows[0]?.qty_total)).toBe(5);
    expect(Number(rows[0]?.weight_total)).toBe(40);
    // Sem processos cadastrados a OF ainda aparece (células vazias).
    expect(rows[0]?.processes).toMatchObject({});

    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("033: cria get_child_item_groups (página de grupos) com os 11 filtros", async () => {
    // Exatamente 1 função — a 033 não redefine nenhuma outra.
    const { rows: functions } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_child_item_groups'`,
    );
    expect(functions[0]?.count).toBe("1");

    // 13 argumentos = os MESMOS 11 filtros da get_child_items_totals (024)
    // + paginação (p_offset, p_limit).
    const { rows: args } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_child_item_groups'
          and p.pronargs = 13`,
    );
    expect(args[0]?.count).toBe("1");

    // Grant na régua das RPCs de produção: authenticated executa.
    const sig =
      "public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer)";
    const { rows: grants } = await db.query<{ authenticated: boolean }>(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated`,
      [sig],
    );
    expect(grants[0]?.authenticated).toBe(true);
  });

  it("035: totais por família nas RPCs (F1 = filhos, F2 = raízes)", async () => {
    await asSuperUser(db);

    type FamilyEntry = { family: string | null; qty: number; weight: number };

    // DROP + recriação da get_production_rows: 1 função, mesmos 21 params
    // e grants refeitos (o DROP leva o EXECUTE junto).
    const { rows: fns } = await db.query<{ total: string; same_args: string }>(
      `select (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows')::text as total,
              (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 21)::text as same_args`,
    );
    expect(fns[0]?.total).toBe("1");
    expect(fns[0]?.same_args).toBe("1");

    const { rows: grants } = await db.query<{ rows_prod: boolean; rows_totals: boolean }>(
      `select
         has_function_privilege('authenticated',
           'public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date)',
           'EXECUTE') as rows_prod,
         has_function_privilege('authenticated',
           'public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text)',
           'EXECUTE') as rows_totals`,
    );
    expect(grants[0]?.rows_prod).toBe(true);
    expect(grants[0]?.rows_totals).toBe(true);

    // OF com duas famílias nos RAÍZES e três FILHOS (TP, TP e sem família).
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-035', 'OF', 'Cliente 035', current_date + 9) returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: roots } = await db.query<{ id: string; parent_item: string }>(
      `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'GC', 'P-035-1', 'Guarda-corpo', 2, 5),
              ($1, 'EB', 'P-035-2', 'Estante bazar', 10, 1.5)
       returning id, parent_item`,
      [orderId],
    );
    const gcRootId = roots.find((root) => root.parent_item === "P-035-1")?.id as string;
    await db.query(
      `insert into public.order_items (order_id, parent_order_item_id, family, parent_item, description, quantity, unit_weight_kg)
       values ($1, $2, 'TP', 'F-035-1', 'Tampo 1', 3, 2),
              ($1, $2, 'TP', 'F-035-2', 'Tampo 2', 4, 2),
              ($1, $2, null, 'F-035-3', 'Parafuso', 1, 3)`,
      [orderId, gcRootId],
    );

    // F2 (raízes): ordenação por qtd. desc e mesma janela do limite pequeno.
    const { rows: prodRows } = await db.query<{ family_totals: FamilyEntry[] }>(
      `select family_totals from public.get_production_rows(p_search => 'OF-035', p_limit => 1)`,
    );
    expect(prodRows).toHaveLength(1);
    expect(prodRows[0]?.family_totals).toEqual([
      { family: "EB", qty: 10, weight: 15 },
      { family: "GC", qty: 2, weight: 10 },
    ]);

    // Sem limit, TODAS as linhas carregam o conjunto inteiro (não só a página).
    const { rows: allProdRows } = await db.query<{ family_totals: FamilyEntry[] }>(
      `select family_totals from public.get_production_rows(p_search => 'OF-035')`,
    );
    expect(allProdRows).toHaveLength(2);
    for (const row of allProdRows) {
      expect(row.family_totals).toEqual(prodRows[0]?.family_totals);
    }

    // F1 (filhos): TP = 3 + 4 un / 6 + 8 kg; sem família = 1 un / 3 kg.
    const { rows: totals } = await db.query<{
      totals: {
        total: number | string;
        qtyTotal: number | string;
        weightTotal: number | string;
        families: FamilyEntry[];
      };
    }>(`select public.get_child_items_totals(p_order_code => 'OF-035') as totals`);
    expect(Number(totals[0]?.totals.total)).toBe(3);
    expect(Number(totals[0]?.totals.qtyTotal)).toBe(8);
    expect(Number(totals[0]?.totals.weightTotal)).toBe(17);
    expect(totals[0]?.totals.families).toEqual([
      { family: "TP", qty: 7, weight: 14 },
      { family: null, qty: 1, weight: 3 },
    ]);

    // Conjunto sem correspondência: 'families' vira [] (o card exibe "—").
    const { rows: empty } = await db.query<{ totals: { families: FamilyEntry[] } }>(
      `select public.get_child_items_totals(p_search => 'zzz-035-nada') as totals`,
    );
    expect(empty[0]?.totals.families).toEqual([]);

    await db.query(`delete from public.orders where code = 'OF-035'`);
  });

  it("036: seq de fabricação na coluna e nas três RPCs (F1 grupos, F2 itens, Gestão OF)", async () => {
    await asSuperUser(db);

    // Coluna nova + check (>= 1 ou null).
    const { rows: columns } = await db.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'order_items' and column_name = 'seq'`,
    );
    expect(columns).toHaveLength(1);
    expect(columns[0]?.data_type).toBe("integer");
    expect(columns[0]?.is_nullable).toBe("YES");

    // DROP + recriação das duas RPCs de produção: 1 função cada, mesmas
    // assinaturas (21 e 18 params) e grants refeitos.
    const { rows: fns } = await db.query<{
      rows_21: string;
      by_order_18: string;
      groups_1: string;
      grants: boolean;
    }>(
      `select (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 21)::text as rows_21,
              (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 18)::text as by_order_18,
              (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_child_item_groups'
                  and p.pronargs = 13)::text as groups_1,
              has_function_privilege('authenticated',
                'public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date)',
                'EXECUTE') as grants`,
    );
    expect(fns[0]?.rows_21).toBe("1");
    expect(fns[0]?.by_order_18).toBe("1");
    expect(fns[0]?.groups_1).toBe("1");
    expect(fns[0]?.grants).toBe(true);

    // OF-036 com dois pais (seq 2 e 1) e um sem número; um filho por pai.
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-036', 'OF', 'Cliente 036', current_date + 9) returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: roots } = await db.query<{ id: string; parent_item: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity, seq)
       values ($1, 'P-036-1', 'Guarda-corpo', 2, 2),
              ($1, 'P-036-2', 'Estante bazar', 10, 1),
              ($1, 'P-036-3', 'Mesa grande', 1, null)
       returning id, parent_item`,
      [orderId],
    );
    const p1Id = roots.find((root) => root.parent_item === "P-036-1")?.id as string;
    await db.query(
      `insert into public.order_items (order_id, parent_order_item_id, parent_item, description, quantity, seq)
       values ($1, $2, 'F-036-B', 'Tampo B', 3, 1),
              ($1, $2, 'F-036-A', 'Tampo A', 4, 3)`,
      [orderId, p1Id],
    );

    // F2 (itens raiz): coluna seq exposta e ordenação 'seq' com nulls last
    // — 1, 2 e por último o item sem número.
    const { rows: prodRows } = await db.query<{ parent_item: string; seq: number | null }>(
      `select parent_item, seq from public.get_production_rows(p_search => 'OF-036', p_sort => 'seq')`,
    );
    expect(prodRows.map((row) => row.parent_item)).toEqual(["P-036-2", "P-036-1", "P-036-3"]);
    expect(prodRows.map((row) => row.seq)).toEqual([1, 2, null]);

    // F1 (grupos de filhos): ordena pelo MENOR seq do grupo.
    const { rows: groupsPage } = await db.query<{
      page: { total: number; groups: { key: string; itemIds: string[] }[] };
    }>(`select public.get_child_item_groups(p_order_code => 'OF-036') as page`);
    expect((groupsPage[0]?.page.groups ?? []).map((group) => group.key)).toEqual(["F-036-B", "F-036-A"]);

    // Gestão por OF: seq = MENOR entre os itens raiz; segunda OF com seq 5
    // vem depois; OF sem itens numerados vem por último.
    const { rows: orderBRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, delivery_date)
       values ('OF-036-B', 'OF', current_date + 12) returning id`,
    );
    await db.query(
      `insert into public.order_items (order_id, parent_item, description, quantity, seq)
       values ($1, 'P-036-B-1', 'Rack servidor', 1, 5)`,
      [orderBRows[0]?.id],
    );
    const { rows: byOrder } = await db.query<{ order_code: string; seq: number | null }>(
      `select order_code, seq
         from public.get_production_rows_by_order(p_search => 'OF-036', p_sort => 'seq')`,
    );
    expect(byOrder.map((row) => row.order_code)).toEqual(["OF-036", "OF-036-B"]);
    expect(byOrder.map((row) => row.seq)).toEqual([1, 5]);

    // Check: seq 0 (ou negativo) é rejeitado pelo banco.
    await expect(
      db.query(
        `insert into public.order_items (order_id, description, quantity, seq)
         values ($1, 'Item inválido', 1, 0)`,
        [orderId],
      ),
    ).rejects.toThrow(/order_items_seq_check/);

    await db.query(`delete from public.orders where code in ('OF-036', 'OF-036-B')`);
  });
});

describe("RLS", () => {
  it("anon não lê dados operacionais", async () => {
    await asUser(db, "anon", null);
    await expect(db.query("select id from public.orders")).rejects.toThrow();
    await asSuperUser(db);
  });

  it("OPERADOR não insere pedidos (42501)", async () => {
    const operador = await createUser(db, "op2@serralheria.com", "OPERADOR");
    await asUser(db, "authenticated", operador);
    await expect(
      db.query(`insert into public.orders (code, type) values ('OF-RLS-1', 'OF')`),
    ).rejects.toThrow();
    await asSuperUser(db);
  });

  it("GESTOR insere pedidos e itens", async () => {
    const gestor = await createUser(db, "gestor@serralheria.com", "GESTOR");
    await asUser(db, "authenticated", gestor);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name, status)
       values ('OF-RLS-2', 'OF', 'Cliente', 'PLANEJADO') returning id`,
    );
    expect(rows[0]?.id).toBeTruthy();
    await asSuperUser(db);
  });

  it("ADMIN gerencia processos; GESTOR não", async () => {
    const admin = await createUser(db, "admin@serralheria.com", "ADMIN");
    const gestor = await createUser(db, "gestor2@serralheria.com", "GESTOR");

    await asUser(db, "authenticated", gestor);
    await expect(
      db.query(`insert into public.processes (code, name) values ('PINTURA', 'PINTURA')`),
    ).rejects.toThrow();
    await asSuperUser(db);

    await asUser(db, "authenticated", admin);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.processes (code, name, display_order)
       values ('PINTURA', 'PINTURA', 130) returning id`,
    );
    expect(rows[0]?.id).toBeTruthy();
    await asSuperUser(db);
  });

  it("não é possível editar o histórico de eventos", async () => {
    const gestor = await createUser(db, "gestor3@serralheria.com", "GESTOR");
    await asUser(db, "authenticated", gestor);
    await expect(db.query(`update public.production_events set notes = 'x'`)).rejects.toThrow();
    await asSuperUser(db);
  });

  it("VISUALIZADOR é somente leitura (nenhuma linha alterada)", async () => {
    await asSuperUser(db);
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type) values ('OF-READ-1', 'OF') returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    const { rows: itemRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, description, quantity)
       values ($1, 'Item leitura', 1) returning id`,
      [orderId],
    );
    const { rows: processRows } = await db.query<{ id: string }>(
      `insert into public.processes (code, name, display_order)
       values ('TESTPROC', 'TESTPROC', 999) returning id`,
    );
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, 'NAO_INICIADO')`,
      [itemRows[0]?.id, processRows[0]?.id],
    );

    const viewer = await createUser(db, "viewer@serralheria.com", "VISUALIZADOR");
    await asUser(db, "authenticated", viewer);
    const result = await db.query(`update public.production_processes set status = 'CONCLUIDO'`);
    expect(result.affectedRows).toBe(0);
    await asSuperUser(db);
  });
});

describe("claim_first_admin", () => {
  it("promove o primeiro usuário quando não há administrador", async () => {
    // garante cenário: nenhum ADMIN existente
    await asSuperUser(db);
    await db.query(`update public.profiles set role = 'OPERADOR' where role = 'ADMIN'`);

    const uid = await createUser(db, "primeiro@serralheria.com");
    await asUser(db, "authenticated", uid);

    const { rows } = await db.query<{ result: { claimed: boolean } }>(
      "select public.claim_first_admin() as result",
    );
    expect(rows[0]?.result.claimed).toBe(true);

    await asSuperUser(db);
    const { rows: profile } = await db.query<{ role: string }>(
      "select role from public.profiles where id = $1",
      [uid],
    );
    expect(profile[0]?.role).toBe("ADMIN");
  });

  it("não promove outro usuário se já existe administrador", async () => {
    const uid = await createUser(db, "segundo@serralheria.com");
    await asUser(db, "authenticated", uid);
    const { rows } = await db.query<{ result: { claimed: boolean } }>(
      "select public.claim_first_admin() as result",
    );
    expect(rows[0]?.result.claimed).toBe(false);
    await asSuperUser(db);
  });
});
