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
    // 038: assinatura vigente = 18 params + p_seq.
    const sig =
      "public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date, integer)";
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

    // 20 argumentos = os 11 filtros + paginação (p_offset, p_limit) + os
    // 7 filtros de grupo da 038 (seq e faixas de qtd/peso/peso un.).
    const { rows: args } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_child_item_groups'
          and p.pronargs = 20`,
    );
    expect(args[0]?.count).toBe("1");

    // Grant na régua das RPCs de produção: authenticated executa.
    const sig =
      "public.get_child_item_groups(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, integer, integer, numeric, numeric, numeric, numeric, numeric, numeric)";
    const { rows: grants } = await db.query<{ authenticated: boolean }>(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated`,
      [sig],
    );
    expect(grants[0]?.authenticated).toBe(true);
  });

  it("035: totais por família nas RPCs (F1 = filhos, F2 = raízes)", async () => {
    await asSuperUser(db);

    type FamilyEntry = { family: string | null; qty: number; weight: number };

    // DROP + recriação da get_production_rows: 1 função, 23 params (21 da
    // 035/036 + p_seq + p_op da 038) e grants refeitos (o DROP leva o
    // EXECUTE junto).
    const { rows: fns } = await db.query<{ total: string; same_args: string }>(
      `select (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows')::text as total,
              (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 23)::text as same_args`,
    );
    expect(fns[0]?.total).toBe("1");
    expect(fns[0]?.same_args).toBe("1");

    const { rows: grants } = await db.query<{ rows_prod: boolean; rows_totals: boolean }>(
      `select
         has_function_privilege('authenticated',
           'public.get_production_rows(text, text, text, text, text, date, text, text, integer, integer, text, text, text, text, text, numeric, numeric, numeric, numeric, date, date, integer, text)',
           'EXECUTE') as rows_prod,
         has_function_privilege('authenticated',
           'public.get_child_items_totals(text, text, text, text, text, text, uuid[], date, date, uuid, text, integer, numeric, numeric, numeric, numeric, numeric, numeric)',
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

    // DROP + recriação das duas RPCs de produção: 1 função cada, assinaturas
    // vigentes (23 e 19 params — a 038 acrescentou p_seq/p_op) e grants refeitos.
    const { rows: fns } = await db.query<{
      rows_23: string;
      by_order_19: string;
      groups_20: string;
      grants: boolean;
    }>(
      `select (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 23)::text as rows_23,
              (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 19)::text as by_order_19,
              (select count(*)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_child_item_groups'
                  and p.pronargs = 20)::text as groups_20,
              has_function_privilege('authenticated',
                'public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date, integer)',
                'EXECUTE') as grants`,
    );
    expect(fns[0]?.rows_23).toBe("1");
    expect(fns[0]?.by_order_19).toBe("1");
    expect(fns[0]?.groups_20).toBe("1");
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

  it("037: quebra por família nos cards (stats global e Gestão por OF)", async () => {
    await asSuperUser(db);

    type FamilyEntry = { family: string | null; qty: number; weight: number };
    type Stats = {
      delivery: { overdue: number };
      expedition: { count: number };
      overdueFamilies: FamilyEntry[];
      expeditionFamilies: FamilyEntry[];
    };
    const readStats = async (): Promise<Stats> => {
      const { rows } = await db.query<{ stats: Stats | string }>(
        `select public.get_production_stats(p_today => current_date) as stats`,
      );
      const raw = rows[0]?.stats;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as Stats;
    };
    const qtyOf = (list: FamilyEntry[] | undefined, family: string | null): number =>
      Number(list?.find((entry) => entry.family === family)?.qty ?? 0);
    const weightOf = (list: FamilyEntry[] | undefined, family: string | null): number =>
      Number(list?.find((entry) => entry.family === family)?.weight ?? 0);

    // Grants refeitos após o DROP da by_order (037/038) e chaves novas do stats.
    const { rows: meta } = await db.query<{ stats_grants: boolean; by_order_grants: boolean }>(
      `select has_function_privilege('authenticated', 'public.get_production_stats(date)', 'EXECUTE') as stats_grants,
              has_function_privilege('authenticated',
                'public.get_production_rows_by_order(text, text, text, text, text, date, text, text, integer, integer, text, text, numeric, numeric, numeric, numeric, date, date, integer)',
                'EXECUTE') as by_order_grants`,
    );
    expect(meta[0]?.stats_grants).toBe(true);
    expect(meta[0]?.by_order_grants).toBe(true);

    // Baseline: as duas listas existem e são arrays (com a 037 aplicada).
    const before = await readStats();
    expect(Array.isArray(before.overdueFamilies)).toBe(true);
    expect(Array.isArray(before.expeditionFamilies)).toBe(true);

    // Duas OFs: A atrasada (sem expedição), B com EXPEDIÇÃO concluída.
    const { rows: orderRows } = await db.query<{ id: string; code: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-037-A', 'OF', 'Cliente 037', current_date - 2),
              ('OF-037-B', 'OF', 'Cliente 037', current_date + 9)
       returning id, code`,
    );
    const orderA = orderRows.find((order) => order.code === "OF-037-A")?.id as string;
    const orderB = orderRows.find((order) => order.code === "OF-037-B")?.id as string;

    // Raízes de A: GC 2×5 + GC 3×1 (5 un / 13 kg) e sem família 1×3.
    await db.query(
      `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'GC', 'P-037-A1', 'Guarda-corpo', 2, 5),
              ($1, 'GC', 'P-037-A2', 'Estante', 3, 1),
              ($1, null, 'P-037-A3', 'Parafuso', 1, 3)`,
      [orderA],
    );
    // Raízes de B: TP 4×2 e TB 1×10.
    const { rows: rootsB } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'TP', 'P-037-B1', 'Tampo', 4, 2),
              ($1, 'TB', 'P-037-B2', 'Barraca', 1, 10)
       returning id`,
      [orderB],
    );
    const { rows: expRows } = await db.query<{ id: string }>(
      `select id from public.processes where code = 'EXP'`,
    );
    const expId = expRows[0]?.id as string;
    for (const root of rootsB) {
      await db.query(
        `insert into public.production_processes (order_item_id, process_id, status)
         values ($1, $2, 'CONCLUIDO')`,
        [root.id, expId],
      );
    }

    // Stats global: as duas listas somam os MESMOS conjuntos dos números
    // (comparadas por delta — o banco pode ter dados de outros testes).
    const after = await readStats();
    expect(qtyOf(after.overdueFamilies, "GC") - qtyOf(before.overdueFamilies, "GC")).toBe(5);
    expect(weightOf(after.overdueFamilies, "GC") - weightOf(before.overdueFamilies, "GC")).toBe(13);
    expect(qtyOf(after.overdueFamilies, null) - qtyOf(before.overdueFamilies, null)).toBe(1);
    expect(weightOf(after.overdueFamilies, null) - weightOf(before.overdueFamilies, null)).toBe(3);
    expect(qtyOf(after.expeditionFamilies, "TP") - qtyOf(before.expeditionFamilies, "TP")).toBe(4);
    expect(weightOf(after.expeditionFamilies, "TP") - weightOf(before.expeditionFamilies, "TP")).toBe(8);
    expect(qtyOf(after.expeditionFamilies, "TB") - qtyOf(before.expeditionFamilies, "TB")).toBe(1);
    expect(weightOf(after.expeditionFamilies, "TB") - weightOf(before.expeditionFamilies, "TB")).toBe(10);
    expect(Number(after.expedition.count) - Number(before.expedition.count)).toBe(2);

    // Gestão por OF: family_totals cobre os ITENS RAIZ das OFs filtradas e
    // bate com o qty_total do card (2+3+1+4+1 = 11), ordenado por qtd. desc.
    const { rows: byOrder } = await db.query<{
      order_code: string;
      qty_total: string;
      family_totals: FamilyEntry[];
    }>(`select order_code, qty_total, family_totals
          from public.get_production_rows_by_order(p_search => 'OF-037')
          order by order_code`);
    expect(byOrder.map((row) => row.order_code)).toEqual(["OF-037-A", "OF-037-B"]);
    expect(Number(byOrder[0]?.qty_total)).toBe(11);
    const expectedFamilies: FamilyEntry[] = [
      { family: "GC", qty: 5, weight: 13 },
      { family: "TP", qty: 4, weight: 8 },
      { family: "TB", qty: 1, weight: 10 },
      { family: null, qty: 1, weight: 3 },
    ];
    expect(byOrder[0]?.family_totals).toEqual(expectedFamilies);
    expect(byOrder[1]?.family_totals).toEqual(expectedFamilies);

    // Busca sem correspondência: nenhuma linha (sem conjunto, sem lista).
    const { rows: noRows } = await db.query(
      `select * from public.get_production_rows_by_order(p_search => 'zzz-037-nada')`,
    );
    expect(noRows).toHaveLength(0);

    await db.query(`delete from public.orders where code in ('OF-037-A', 'OF-037-B')`);
  });

  it("038: filtros por coluna (seq/OP/faixas de grupo) + unicidade de seq por OF", async () => {
    await asSuperUser(db);

    type GroupPage = { total: number; groups: { key: string; itemIds: string[] }[] };
    type Totals = {
      total: number | string;
      qtyTotal: number | string;
      weightTotal: number | string;
      families: { family: string | null; qty: number; weight: number }[];
    };

    // 1 função cada RPC nas assinaturas NOVAS (23/19/20/18 params); as
    // assinaturas antigas não sobram (DROP da 038) e o trigger existe.
    const { rows: meta } = await db.query<{
      trigger_count: string;
      rows_23: string;
      by_order_19: string;
      groups_20: string;
      totals_18: string;
      old_rows: string;
      old_by_order: string;
      old_groups: string;
      old_totals: string;
    }>(
      `select (select count(*)::text from pg_trigger where tgname = 'order_items_seq_unique_per_order') as trigger_count,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 23) as rows_23,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 19) as by_order_19,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_child_item_groups'
                  and p.pronargs = 20) as groups_20,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_child_items_totals'
                  and p.pronargs = 18) as totals_18,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 21) as old_rows,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 18) as old_by_order,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_child_item_groups'
                  and p.pronargs = 13) as old_groups,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_child_items_totals'
                  and p.pronargs = 11) as old_totals`,
    );
    expect(meta[0]?.trigger_count).toBe("1");
    expect(meta[0]?.rows_23).toBe("1");
    expect(meta[0]?.by_order_19).toBe("1");
    expect(meta[0]?.groups_20).toBe("1");
    expect(meta[0]?.totals_18).toBe("1");
    expect(meta[0]?.old_rows).toBe("0");
    expect(meta[0]?.old_by_order).toBe("0");
    expect(meta[0]?.old_groups).toBe("0");
    expect(meta[0]?.old_totals).toBe("0");

    // Índice parcial de seq — apoio do trigger, do filtro por igualdade e
    // da ordenação default `seq nulls last`.
    const { rows: indexes } = await db.query<{ count: string }>(
      `select count(*)::text as count from pg_indexes
        where schemaname = 'public' and indexname = 'idx_order_items_seq'`,
    );
    expect(Number(indexes[0]?.count)).toBe(1);

    // Dados: OF-038-A com raiz (seq 2, OP-777) + filhos em 3 grupos;
    // OF-038-B com um raiz (seq 1).
    const { rows: orderRows } = await db.query<{ id: string; code: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-038-A', 'OF', 'Cliente 038', current_date + 5),
              ('OF-038-B', 'OF', 'Cliente 038', current_date + 7)
       returning id, code`,
    );
    const orderA = orderRows.find((order) => order.code === "OF-038-A")?.id as string;
    const orderB = orderRows.find((order) => order.code === "OF-038-B")?.id as string;
    const { rows: rootRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, seq, op)
       values ($1, 'GC', 'P-038-1', 'Guarda-corpo', 1, 10, 2, 'OP-777') returning id`,
      [orderA],
    );
    const rootA = rootRows[0]?.id as string;
    // Grupos do filho: X (2 itens, peso unit. uniforme, seq 3 e 5),
    // Y (unit. uniforme, sem seq) e Z (unit. DIVERGENTE — exibe "—").
    await db.query(
      `insert into public.order_items (order_id, parent_order_item_id, family, parent_item, description, quantity, unit_weight_kg, seq)
       values ($1, $2, 'TP', 'F-038-X', 'Tampo X', 4, 2.5, 3),
              ($1, $2, 'TP', 'F-038-X', 'Tampo X', 6, 2.5, 5),
              ($1, $2, 'GC', 'F-038-Y', 'Tampo Y', 2, 7, null),
              ($1, $2, null, 'F-038-Z', 'Régua Z', 1, 1, null),
              ($1, $2, null, 'F-038-Z', 'Régua Z', 1, 2, null)`,
      [orderA, rootA],
    );
    const { rows: rootBRows } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg, seq)
       values ($1, 'P-038-B1', 'Rack servidor', 3, 4, 1) returning id`,
      [orderB],
    );
    const rootB = rootBRows[0]?.id as string;

    // --- Unicidade de seq por OF (trigger 038) ---
    // Mesma OF: segundo item com o MESMO número (2) é liberado.
    await db.query(
      `insert into public.order_items (order_id, parent_item, description, quantity, seq)
       values ($1, 'P-038-2', 'Mesa redonda', 1, 2)`,
      [orderA],
    );
    // Outra OF: número em uso é recusado com a mensagem pt-BR.
    await expect(
      db.query(
        `insert into public.order_items (order_id, parent_item, description, quantity, seq)
         values ($1, 'P-038-B2', 'Coluna B', 1, 2)`,
        [orderB],
      ),
    ).rejects.toThrow(/outra OF/);
    // UPDATE que colide também recusa (o caminho de edição por tela).
    await expect(
      db.query(`update public.order_items set seq = 3 where id = $1`, [rootB]),
    ).rejects.toThrow(/outra OF/);
    // Update sem colisão segue liberado (B passa a valer 7).
    await db.query(`update public.order_items set seq = 7 where id = $1`, [rootB]);

    // --- F2: p_seq por igualdade (só RAÍZES; seq 3 é de filho) ---
    // A mesma OF pode compartilhar o número: os dois ramos com seq 2 casam.
    const f2Seq = await db.query<{ parent_item: string }>(
      `select parent_item from public.get_production_rows(p_search => 'OF-038', p_seq => 2)`,
    );
    expect(f2Seq.rows.map((row) => row.parent_item)).toEqual(["P-038-1", "P-038-2"]);
    const f2SeqFilho = await db.query(
      `select * from public.get_production_rows(p_search => 'OF-038', p_seq => 3)`,
    );
    expect(f2SeqFilho.rows).toHaveLength(0);

    // --- F2: p_op "contém" (insensível a maiúsculas) ---
    const f2Op = await db.query<{ parent_item: string }>(
      `select parent_item from public.get_production_rows(p_search => 'OF-038', p_op => 'op-77')`,
    );
    expect(f2Op.rows.map((row) => row.parent_item)).toEqual(["P-038-1"]);
    const f2OpVazio = await db.query(
      `select * from public.get_production_rows(p_search => 'OF-038', p_op => 'zzz-038')`,
    );
    expect(f2OpVazio.rows).toHaveLength(0);

    // --- Gestão: p_seq sobre o MENOR seq dos itens raiz da OF ---
    const byOrderSeq = await db.query<{ order_code: string }>(
      `select order_code from public.get_production_rows_by_order(p_search => 'OF-038', p_seq => 2)`,
    );
    expect(byOrderSeq.rows.map((row) => row.order_code)).toEqual(["OF-038-A"]);
    const byOrderSeq7 = await db.query<{ order_code: string }>(
      `select order_code from public.get_production_rows_by_order(p_search => 'OF-038', p_seq => 7)`,
    );
    expect(byOrderSeq7.rows.map((row) => row.order_code)).toEqual(["OF-038-B"]);

    // --- F1: filtros pós-agrupamento (menor seq, Σ qtd, Σ peso, peso un.) ---
    const groupKeys = async (extra: string): Promise<{ keys: string[]; total: number }> => {
      const { rows } = await db.query<{ page: GroupPage }>(
        `select public.get_child_item_groups(p_order_code => 'OF-038-A'${extra}) as page`,
      );
      return {
        keys: (rows[0]?.page.groups ?? []).map((group) => group.key),
        total: Number(rows[0]?.page.total ?? 0),
      };
    };
    expect(await groupKeys("")).toEqual({
      keys: ["F-038-X", "F-038-Y", "F-038-Z"],
      total: 3,
    });
    // Seq por igualdade = MENOR seq do grupo (5 do segundo membro não casa).
    expect(await groupKeys(", p_seq => 3")).toEqual({ keys: ["F-038-X"], total: 1 });
    expect(await groupKeys(", p_seq => 5")).toEqual({ keys: [], total: 0 });
    // Faixa de Qtd. sobre o Σ dos membros (X = 4 + 6 = 10; Y/Z = 2).
    expect(await groupKeys(", p_qty_min => 10")).toEqual({ keys: ["F-038-X"], total: 1 });
    expect(await groupKeys(", p_qty_max => 2")).toEqual({
      keys: ["F-038-Y", "F-038-Z"],
      total: 2,
    });
    // Faixa de Peso total (X = 10 + 15 = 25 kg; Z = 1 + 2 = 3 kg).
    expect(await groupKeys(", p_weight_min => 20")).toEqual({ keys: ["F-038-X"], total: 1 });
    expect(await groupKeys(", p_weight_max => 5")).toEqual({ keys: ["F-038-Z"], total: 1 });
    // Peso unitário exibido: só grupos com membros coincidentes (Z = "—").
    expect(await groupKeys(", p_weight_unit_min => 7")).toEqual({
      keys: ["F-038-Y"],
      total: 1,
    });
    expect(await groupKeys(", p_weight_unit_max => 3")).toEqual({
      keys: ["F-038-X"],
      total: 1,
    });

    // --- Totais do card casam com a lista filtrada ---
    const readTotals = async (extra: string): Promise<Totals> => {
      const { rows } = await db.query<{ totals: Totals }>(
        `select public.get_child_items_totals(p_order_code => 'OF-038-A'${extra}) as totals`,
      );
      return rows[0]?.totals as Totals;
    };
    // Sem filtro de grupo: caminho rápido (5 itens, Σ qtd 14, Σ peso 42 kg).
    const fastTotals = await readTotals("");
    expect(Number(fastTotals.total)).toBe(5);
    expect(Number(fastTotals.qtyTotal)).toBe(14);
    expect(Number(fastTotals.weightTotal)).toBe(42);
    expect(fastTotals.families).toEqual([
      { family: "TP", qty: 10, weight: 25 },
      { family: "GC", qty: 2, weight: 14 },
      { family: null, qty: 2, weight: 3 },
    ]);
    // Com filtro de grupo: agrupa por (OF, código) — bate com a lista (X).
    const groupedTotals = await readTotals(", p_qty_min => 10");
    expect(Number(groupedTotals.total)).toBe(2);
    expect(Number(groupedTotals.qtyTotal)).toBe(10);
    expect(Number(groupedTotals.weightTotal)).toBe(25);
    expect(groupedTotals.families).toEqual([{ family: "TP", qty: 10, weight: 25 }]);

    await db.query(`delete from public.orders where code in ('OF-038-A', 'OF-038-B')`);
  });

  it("039: KIT agregado dos filhos na F2 e na Gestão (somente leitura na F2)", async () => {
    await asSuperUser(db);

    // A assinatura NÃO muda (create or replace): 23 params na F2 e 19 na
    // gestão — a 039 só mexe no corpo. Nenhuma assinatura antiga sobra.
    const { rows: fns } = await db.query<{
      rows_23: string;
      by_order_19: string;
      rows_21: string;
      by_order_18: string;
    }>(
      `select (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 23) as rows_23,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 19) as by_order_19,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 21) as rows_21,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 18) as by_order_18`,
    );
    expect(fns[0]?.rows_23).toBe("1");
    expect(fns[0]?.by_order_19).toBe("1");
    expect(fns[0]?.rows_21).toBe("0");
    expect(fns[0]?.by_order_18).toBe("0");

    // --- OF com pai + 2 filhos, cada um com seu KIT ---
    const { rows: orderRows } = await db.query<{ id: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-039', 'OF', 'Cliente 039', current_date + 10) returning id`,
    );
    const orderId = orderRows[0]?.id as string;
    // Raiz (pai) — o KIT do RAIZ nasce NAO_APLICAVEL no import; aqui criamos
    // explicitamente para provar que a agregação IGNORA a raiz.
    const { rows: roots } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'P-039', 'Pai 039', 1, 5) returning id`,
      [orderId],
    );
    const rootId = roots[0]?.id as string;
    // 2 filhos.
    const { rows: children } = await db.query<{ id: string }>(
      `insert into public.order_items (order_id, parent_order_item_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, $2, 'F-039-1', 'Filho 1', 3, 2),
              ($1, $2, 'F-039-2', 'Filho 2', 4, 2)
       returning id`,
      [orderId, rootId],
    );
    const child1 = children[0]?.id as string;
    const child2 = children[1]?.id as string;

    const { rows: kitRows } = await db.query<{ id: string }>(
      `select id from public.processes where code = 'KIT'`,
    );
    const kitId = kitRows[0]?.id as string;

    // --- Cenário 1: filhos NAO_INICIADO + NAO_APLICAVEL => agregado NAO_INICIADO ---
    // Raiz com KIT NAO_APLICAVEL (deve ser ignorado pela agregação).
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, 'NAO_APLICAVEL')`,
      [rootId, kitId],
    );
    // Filho 1 aplicável NAO_INICIADO; filho 2 fora (NAO_APLICAVEL).
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, 'NAO_INICIADO')`,
      [child1, kitId],
    );
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, 'NAO_APLICAVEL')`,
      [child2, kitId],
    );

    type KitCell = {
      id: string | null;
      status: string;
      aggregated?: boolean;
      quantityPlanned: number | null;
      quantityCompleted: number | null;
    };

    // F2 (linha do pai): KIT agregado dos filhos = NAO_INICIADO (não o da raiz).
    const { rows: f2 } = await db.query<{ processes: Record<string, KitCell> }>(
      `select processes from public.get_production_rows(p_search => 'OF-039')`,
    );
    const f2Kit = f2[0]?.processes?.KIT;
    expect(f2Kit?.status).toBe("NAO_INICIADO");
    expect(f2Kit?.aggregated).toBe(true);
    expect(f2Kit?.id).toBeNull();

    // Gestão (uma linha por OF): mesmo agregado vindo dos filhos.
    const { rows: gestao } = await db.query<{ processes: Record<string, KitCell> }>(
      `select processes from public.get_production_rows_by_order(p_search => 'OF-039')`,
    );
    const gestaoKit = gestao[0]?.processes?.KIT;
    expect(gestaoKit?.status).toBe("NAO_INICIADO");
    // A célula da gestão é a agregada de escopo (done/applicable), sem id.
    expect(Number(gestaoKit?.quantityPlanned ?? 0)).toBeGreaterThanOrEqual(0);

    // --- Cenário 2: os DOIS filhos aplicáveis CONCLUIDOS => agregado CONCLUIDO ---
    await db.query(
      `update public.production_processes set status = 'CONCLUIDO'
        where order_item_id = any($1::uuid[]) and process_id = $2`,
      [[child1, child2], kitId],
    );
    const { rows: f2done } = await db.query<{ processes: Record<string, KitCell> }>(
      `select processes from public.get_production_rows(p_search => 'OF-039')`,
    );
    expect(f2done[0]?.processes?.KIT?.status).toBe("CONCLUIDO");

    // --- Cenário 3: nenhum filho aplicável => NAO_APLICAVEL (célula "—") ---
    await db.query(
      `update public.production_processes set status = 'NAO_APLICAVEL'
        where order_item_id = any($1::uuid[]) and process_id = $2`,
      [[child1, child2], kitId],
    );
    const { rows: f2na } = await db.query<{ processes: Record<string, KitCell> }>(
      `select processes from public.get_production_rows(p_search => 'OF-039')`,
    );
    expect(f2na[0]?.processes?.KIT?.status).toBe("NAO_APLICAVEL");

    await db.query(`delete from public.production_processes where order_item_id = any($1::uuid[])`, [
      [rootId, child1, child2],
    ]);
    await db.query(`delete from public.orders where id = $1`, [orderId]);
  });

  it("041: cards Atrasados/Expedição contam o conjunto FILTRADO (itens)", async () => {
    await asSuperUser(db);

    // DROP + recriação (mudou o tipo de retorno): continua UMA função por
    // nome e com a mesma aridade (23 params na F2, 19 na gestão).
    const { rows: fns } = await db.query<{
      rows_23: string;
      by_order_19: string;
      rows_all: string;
      by_order_all: string;
    }>(
      `select (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows'
                  and p.pronargs = 23) as rows_23,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order'
                  and p.pronargs = 19) as by_order_19,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows') as rows_all,
              (select count(*)::text
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'get_production_rows_by_order') as by_order_all`,
    );
    expect(fns[0]?.rows_23).toBe("1");
    expect(fns[0]?.by_order_19).toBe("1");
    expect(fns[0]?.rows_all).toBe("1");
    expect(fns[0]?.by_order_all).toBe("1");

    // --- Duas OFs: A com item atrasado + item expedido; B futura ---
    const { rows: orders } = await db.query<{ id: string; code: string }>(
      `insert into public.orders (code, type, customer_name, delivery_date)
       values ('OF-041-A', 'OF', 'Cliente 041', current_date - 2),
              ('OF-041-B', 'OF', 'Cliente 041', current_date + 10)
       returning id, code`,
    );
    const orderA = orders.find((o) => o.code === "OF-041-A")?.id as string;
    const orderB = orders.find((o) => o.code === "OF-041-B")?.id as string;

    // Itens raiz: A1 atrasado (sem linha de EXP), A2 expedido, B1 futuro.
    const { rows: items } = await db.query<{ id: string; parent_item: string }>(
      `insert into public.order_items (order_id, parent_item, description, quantity, unit_weight_kg)
       values ($1, 'A1-041', 'Atrasado 041', 2, 3),
              ($1, 'A2-041', 'Expedido 041', 4, 5),
              ($2, 'B1-041', 'Futuro 041', 1, 1)
       returning id, parent_item`,
      [orderA, orderB],
    );
    const itemA2 = items.find((i) => i.parent_item === "A2-041")?.id as string;

    const { rows: expRows } = await db.query<{ id: string }>(
      `select id from public.processes where code = 'EXP'`,
    );
    const expId = expRows[0]?.id as string;
    await db.query(
      `insert into public.production_processes (order_item_id, process_id, status)
       values ($1, $2, 'CONCLUIDO')`,
      [itemA2, expId],
    );

    type Totals = {
      total_count: number | string;
      overdue_count: number | string;
      overdue_qty: number | string;
      overdue_weight: number | string;
      expedition_count: number | string;
      expedition_qty: number | string;
      expedition_weight: number | string;
    };
    const totals = (row: Totals | undefined) => ({
      total: Number(row?.total_count ?? 0),
      overdueCount: Number(row?.overdue_count ?? 0),
      overdueQty: Number(row?.overdue_qty ?? 0),
      overdueWeight: Number(row?.overdue_weight ?? 0),
      expeditionCount: Number(row?.expedition_count ?? 0),
      expeditionQty: Number(row?.expedition_qty ?? 0),
      expeditionWeight: Number(row?.expedition_weight ?? 0),
    });

    // --- Fábrica 2 (linha = item): 3 itens, 1 atrasado, 1 expedido ---
    const { rows: f2All } = await db.query<Totals>(
      `select total_count, overdue_count, overdue_qty, overdue_weight,
              expedition_count, expedition_qty, expedition_weight
         from public.get_production_rows(p_search => 'OF-041')`,
    );
    expect(totals(f2All[0])).toEqual({
      total: 3,
      overdueCount: 1,
      overdueQty: 2,
      overdueWeight: 6,
      expeditionCount: 1,
      expeditionQty: 4,
      expeditionWeight: 20,
    });

    // Filtro reduz o recorte => os cards acompanham (eram globais antes).
    const { rows: f2B } = await db.query<Totals>(
      `select total_count, overdue_count, overdue_qty, overdue_weight,
              expedition_count, expedition_qty, expedition_weight
         from public.get_production_rows(p_search => 'OF-041-B')`,
    );
    expect(totals(f2B[0])).toEqual({
      total: 1,
      overdueCount: 0,
      overdueQty: 0,
      overdueWeight: 0,
      expeditionCount: 0,
      expeditionQty: 0,
      expeditionWeight: 0,
    });

    // Janela OVERDUE: lista = só o item atrasado (o expedido fica de fora).
    const { rows: f2Overdue } = await db.query<Totals>(
      `select total_count, overdue_count, overdue_qty, overdue_weight,
              expedition_count, expedition_qty, expedition_weight
         from public.get_production_rows(p_search => 'OF-041', p_delivery_filter => 'OVERDUE')`,
    );
    expect(totals(f2Overdue[0])).toEqual({
      total: 1,
      overdueCount: 1,
      overdueQty: 2,
      overdueWeight: 6,
      expeditionCount: 0,
      expeditionQty: 0,
      expeditionWeight: 0,
    });

    // --- Gestão (linha = OF, cards contam ITENS das OFs filtradas) ---
    const { rows: gAll } = await db.query<Totals>(
      `select total_count, overdue_count, overdue_qty, overdue_weight,
              expedition_count, expedition_qty, expedition_weight
         from public.get_production_rows_by_order(p_search => 'OF-041')`,
    );
    expect(totals(gAll[0])).toEqual({
      total: 2, // duas OFs na lista…
      overdueCount: 1, // …mas os cards contam ITENS (A1 atrasado).
      overdueQty: 2,
      overdueWeight: 6,
      expeditionCount: 1, // A2 expedido.
      expeditionQty: 4,
      expeditionWeight: 20,
    });

    // Filtro pela OF-041-B: lista = 1 OF e os cards zeram junto.
    const { rows: gB } = await db.query<Totals>(
      `select total_count, overdue_count, overdue_qty, overdue_weight,
              expedition_count, expedition_qty, expedition_weight
         from public.get_production_rows_by_order(p_search => 'OF-041-B')`,
    );
    expect(totals(gB[0])).toEqual({
      total: 1,
      overdueCount: 0,
      overdueQty: 0,
      overdueWeight: 0,
      expeditionCount: 0,
      expeditionQty: 0,
      expeditionWeight: 0,
    });

    // Janela OVERDUE na gestão: só a OF-041-A passa (B é futura) — e o
    // card de Expedição continua contando o ITEM expedido de dentro dela.
    const { rows: gOverdue } = await db.query<Totals>(
      `select total_count, overdue_count, overdue_qty, overdue_weight,
              expedition_count, expedition_qty, expedition_weight
         from public.get_production_rows_by_order(p_search => 'OF-041', p_delivery_filter => 'OVERDUE')`,
    );
    expect(totals(gOverdue[0])).toEqual({
      total: 1,
      overdueCount: 1,
      overdueQty: 2,
      overdueWeight: 6,
      expeditionCount: 1,
      expeditionQty: 4,
      expeditionWeight: 20,
    });

    await db.query(
      `delete from public.production_processes where order_item_id = any($1::uuid[])`,
      [items.map((i) => i.id)],
    );
    await db.query(`delete from public.orders where code in ('OF-041-A', 'OF-041-B')`);
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
