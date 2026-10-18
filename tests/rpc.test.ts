import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PGlite } from "@electric-sql/pglite";

import { asSuperUser, asUser, createTestDatabase, createUser } from "./helpers/test-db";

let db: PGlite;
let close: () => Promise<void>;
let gestorId: string;

const TODAY = "2026-10-10";

interface ProcessInput {
  code: string;
  status: string;
}

async function createItem(
  orderId: string,
  parentItem: string,
  description: string,
  quantity: number,
  deliveryDate: string,
  processes: ProcessInput[],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'EM_PRODUCAO') returning id`,
    [orderId, "ESTRUTURA", parentItem, description, quantity, 12.5, deliveryDate],
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

  return itemId;
}

async function createOrder(code: string, deliveryDate: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.orders (code, type, customer_name, status, delivery_date)
     values ($1, 'OF', 'Metalúrgica Alfa', 'EM_PRODUCAO', $2) returning id`,
    [code, deliveryDate],
  );
  return rows[0]?.id as string;
}

/** Item RAIZ com peso unitário próprio (createItem fixa 12,5 kg). */
async function createRootItem(
  orderId: string,
  parentItem: string,
  description: string,
  quantity: number,
  unitWeight: number,
  processes: ProcessInput[],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, $5, 'EM_PRODUCAO') returning id`,
    [orderId, parentItem, description, quantity, unitWeight],
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

  return itemId;
}

/** Item FILHO (016) — a cadeia da Fábrica 1 é rastreada nele. */
async function createChild(
  orderId: string,
  parentItemId: string,
  code: string,
  description: string,
  quantity: number,
  processes: ProcessInput[],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, parent_order_item_id, status)
     values ($1, 'ESTRUTURA', $2, $3, $4, 12.5, $5, 'EM_PRODUCAO') returning id`,
    [orderId, code, description, quantity, parentItemId],
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

  return itemId;
}

beforeAll(async () => {
  const created = await createTestDatabase();
  db = created.db;
  close = created.close;

  await asSuperUser(db);
  gestorId = await createUser(db, "gestor.production@serralheria.com", "GESTOR");

  // OF-001: item atrasado (EXP não concluído) e item concluído
  const order1 = await createOrder("OF-001", "2026-10-05");
  await createItem(order1, "ITEM-001", "Treliça metálica", 10, "2026-10-05", [
    { code: "LASER", status: "CONCLUIDO" },
    { code: "DB_CH", status: "CONCLUIDO" },
    { code: "SERRA", status: "NAO_INICIADO" },
    { code: "SOLDA", status: "NAO_INICIADO" },
    { code: "EXP", status: "NAO_INICIADO" },
  ]);
  await createItem(order1, "ITEM-002", "Porta metálica", 4, "2026-10-25", [
    { code: "LASER", status: "CONCLUIDO" },
    { code: "SERRA", status: "CONCLUIDO" },
    { code: "SOLDA", status: "CONCLUIDO" },
    { code: "EXP", status: "CONCLUIDO" },
  ]);

  // OF-002: entregas futuras
  const order2 = await createOrder("OF-002", "2026-10-20");
  await createItem(order2, "ITEM-101", "Grade de proteção", 25, "2026-10-12", [
    { code: "LASER", status: "NAO_INICIADO" },
    { code: "EXP", status: "NAO_APLICAVEL" },
  ]);
  await createItem(order2, "ITEM-102", "Corrimão inox", 12, "2026-11-02", [
    { code: "LASER", status: "CONCLUIDO" },
    { code: "DB_CH", status: "NAO_INICIADO" },
    { code: "EXP", status: "NAO_INICIADO" },
  ]);
});

afterAll(async () => {
  await close();
});

interface RowResult {
  total_count: string;
  weight_total: string;
  qty_total: string;
  order_code: string;
  customer_name: string;
  family: string;
  parent_item: string;
  delivery_date: string;
  op: string | null;
  overdue: boolean;
  processes: Record<string, { status: string; completedAt: string | null }>;
}

async function callRows(params: Record<string, unknown> = {}): Promise<RowResult[]> {
  const defaults = {
    p_search: null,
    p_order_status: null,
    p_process_code: null,
    p_process_status: null,
    p_delivery_filter: "ALL",
    p_today: TODAY,
    p_sort: "delivery_date",
    p_sort_dir: "asc",
    p_offset: 0,
    p_limit: 50,
    // filtros de coluna (007)
    p_order_code: null,
    p_customer: null,
    p_family: null,
    p_parent_item: null,
    p_description: null,
    p_qty_min: null,
    p_qty_max: null,
    p_weight_min: null,
    p_weight_max: null,
    // período de entrega (014)
    p_delivery_from: null,
    p_delivery_to: null,
    ...params,
  };

  const { rows } = await db.query<RowResult>(
    `select
       total_count,
       weight_total,
       qty_total,
       order_code,
       customer_name,
       family,
       parent_item,
       to_char(delivery_date, 'YYYY-MM-DD') as delivery_date,
       op,
       overdue,
       processes
     from public.get_production_rows(
       $1, $2, $3, $4, $5, $6::date, $7, $8, $9::int, $10::int,
       $11, $12, $13, $14, $15, $16::numeric, $17::numeric, $18::numeric, $19::numeric,
       $20::date, $21::date
     )`,
    [
      defaults.p_search,
      defaults.p_order_status,
      defaults.p_process_code,
      defaults.p_process_status,
      defaults.p_delivery_filter,
      defaults.p_today,
      defaults.p_sort,
      defaults.p_sort_dir,
      defaults.p_offset,
      defaults.p_limit,
      defaults.p_order_code,
      defaults.p_customer,
      defaults.p_family,
      defaults.p_parent_item,
      defaults.p_description,
      defaults.p_qty_min,
      defaults.p_qty_max,
      defaults.p_weight_min,
      defaults.p_weight_max,
      defaults.p_delivery_from,
      defaults.p_delivery_to,
    ],
  );
  return rows;
}

describe("get_production_rows", () => {
  it("retorna todos os itens com total e processos agregados", async () => {
    const rows = await callRows();
    expect(rows).toHaveLength(4);
    expect(Number(rows[0]?.total_count)).toBe(4);
    expect(rows[0]?.processes.LASER?.status).toBeTruthy();
  });

  it("devolve completedAt da conclusão efetiva na célula (031)", async () => {
    // ITEM-001: só o LASER concluído tem a data efetiva gravada.
    await db.query(
      `update public.production_processes pp set completed_at = timestamptz '2026-10-01 09:30:00+00'
         from public.processes p, public.order_items oi
        where p.id = pp.process_id and oi.id = pp.order_item_id
          and oi.parent_item = 'ITEM-001' and p.code = 'LASER'`,
    );

    const rows = await callRows({ p_search: "ITEM-001" });
    const item = rows.find((row) => row.parent_item === "ITEM-001");
    expect(item?.processes.LASER?.status).toBe("CONCLUIDO");
    expect(item?.processes.LASER?.completedAt).toBeTruthy();
    // Processo não concluído não tem data efetiva.
    expect(item?.processes.SERRA?.completedAt).toBeNull();
  });

  it("aplica a regra de atraso (entrega < hoje AND EXP <> CONCLUIDO)", async () => {
    const rows = await callRows({ p_delivery_filter: "OVERDUE" });
    const parents = rows.map((row) => row.parent_item);
    expect(parents).toEqual(["ITEM-001"]);
    expect(rows[0]?.overdue).toBe(true);
  });

  it("não marca atrasado quando o item já foi expedido", async () => {
    const rows = await callRows({ p_search: "ITEM-002" });
    expect(rows[0]?.overdue).toBe(false);
    expect(rows[0]?.delivery_date).toBe("2026-10-25");
  });

  it("filtra por janela de entrega (próximos 7 dias)", async () => {
    const rows = await callRows({ p_delivery_filter: "NEXT_7_DAYS" });
    expect(rows.map((row) => row.parent_item)).toEqual(["ITEM-101"]);
  });

  it("filtra por processo e status do processo", async () => {
    const naoIniciado = await callRows({ p_process_code: "SERRA", p_process_status: "NAO_INICIADO" });
    expect(naoIniciado.map((row) => row.parent_item)).toEqual(["ITEM-001"]);

    const aplicaveis = await callRows({ p_process_code: "EXP" });
    expect(aplicaveis.map((row) => row.parent_item).sort()).toEqual([
      "ITEM-001",
      "ITEM-002",
      "ITEM-102",
    ]);
  });

  it("filtra por status do pedido", async () => {
    const rows = await callRows({ p_order_status: "PLANEJADO" });
    expect(rows).toHaveLength(0);
  });

  it("busca por OF/OS, família, item pai e descrição", async () => {
    expect(await callRows({ p_search: "OF-002" })).toHaveLength(2);
    expect(await callRows({ p_search: "treliça" })).toHaveLength(1);
    expect(await callRows({ p_search: "ITEM-101" })).toHaveLength(1);
    expect(await callRows({ p_search: "ESTRUTURA" })).toHaveLength(4);
  });

  it("pagina mantendo o total correto", async () => {
    const page1 = await callRows({ p_limit: 3, p_offset: 0 });
    const page2 = await callRows({ p_limit: 3, p_offset: 3 });
    expect(page1).toHaveLength(3);
    expect(page2).toHaveLength(1);
    expect(Number(page1[0]?.total_count)).toBe(4);
    expect(Number(page2[0]?.total_count)).toBe(4);
  });

  it("ordena por coluna de pedido", async () => {
    const asc = await callRows({ p_sort: "delivery_date", p_sort_dir: "asc" });
    const desc = await callRows({ p_sort: "delivery_date", p_sort_dir: "desc" });
    expect(asc[0]?.delivery_date).toBe("2026-10-05");
    expect(desc[0]?.delivery_date).toBe("2026-11-02");
  });

  it("ordena por coluna de processo", async () => {
    const rows = await callRows({ p_sort: "SOLDA", p_sort_dir: "asc" });
    // CONCLUIDO (rank 1) vem primeiro, NAO_INICIADO (rank 2) depois
    expect(rows.map((row) => row.parent_item)).toEqual(["ITEM-002", "ITEM-001", "ITEM-101", "ITEM-102"]);
  });

  it("ordena por código do pedido desc", async () => {
    const rows = await callRows({ p_sort: "order_code", p_sort_dir: "desc" });
    expect(rows[0]?.order_code).toBe("OF-002");
  });

  it("ignora coluna de ordenação desconhecida (sem erro)", async () => {
    const rows = await callRows({ p_sort: "'; drop table orders; --" });
    expect(rows).toHaveLength(4);
  });

  it("expõe a OP do item e ordena por ela (013)", async () => {
    await db.query(
      `update public.order_items set op = 'OP-1001' where parent_item = 'ITEM-001'`,
    );

    const withOp = await callRows({ p_search: "ITEM-001" });
    expect(withOp[0]?.op).toBe("OP-1001");

    const withoutOp = await callRows({ p_search: "ITEM-101" });
    expect(withoutOp[0]?.op).toBeNull();

    // Ordenação por OP: nulls last (em espera por último).
    const sorted = await callRows({ p_sort: "op", p_sort_dir: "asc" });
    expect(sorted[0]?.op).toBe("OP-1001");

    await db.query(`update public.order_items set op = null where parent_item = 'ITEM-001'`);
  });

  it("filtra por período de entrega — inclusivo e lados opcionais (014)", async () => {
    // Entregas dos fixtures: ITEM-001 05/10, ITEM-101 12/10, ITEM-002 25/10, ITEM-102 02/11.
    const fechado = await callRows({
      p_delivery_from: "2026-10-05",
      p_delivery_to: "2026-10-12",
    });
    expect(fechado.map((row) => row.parent_item).sort()).toEqual(["ITEM-001", "ITEM-101"]);
    expect(Number(fechado[0]?.total_count)).toBe(2);

    const soDe = await callRows({ p_delivery_from: "2026-10-25" });
    expect(soDe.map((row) => row.parent_item).sort()).toEqual(["ITEM-002", "ITEM-102"]);

    const soAte = await callRows({ p_delivery_to: "2026-10-12" });
    expect(soAte.map((row) => row.parent_item).sort()).toEqual(["ITEM-001", "ITEM-101"]);
  });

  it("item sem entrega própria herda a do pedido no período (014/022)", async () => {
    await db.query(
      `update public.order_items set delivery_date = null where parent_item = 'ITEM-101'`,
    );

    // 022: a gestão de entregas passou a ler coalesce(entrega do item,
    // entrega do pedido) — mesma regra da Fábrica 1 e do detalhe da OF.
    // É o que faz a janela prevista existir também no pedido manual,
    // onde o formulário deixa a entrega do item em branco.
    const comPeriodo = await callRows({
      p_delivery_from: "2026-10-01",
      p_delivery_to: "2026-10-31",
    });
    expect(comPeriodo.map((row) => row.parent_item).sort()).toEqual([
      "ITEM-001",
      "ITEM-002",
      "ITEM-101",
    ]);
    expect(comPeriodo.find((row) => row.parent_item === "ITEM-101")?.delivery_date).toBe(
      "2026-10-20",
    );

    // Sem período o item continua aparecendo normalmente.
    const semPeriodo = await callRows();
    expect(semPeriodo).toHaveLength(4);

    await db.query(
      `update public.order_items set delivery_date = '2026-10-12' where parent_item = 'ITEM-101'`,
    );
  });

  it("combina o período com a janela rápida (E lógico — 014)", async () => {
    // OVERDUE = entrega < 10/10 com EXP pendente => apenas ITEM-001 (05/10).
    const dentroDaJanela = await callRows({
      p_delivery_filter: "OVERDUE",
      p_delivery_from: "2026-10-01",
      p_delivery_to: "2026-10-09",
    });
    expect(dentroDaJanela.map((row) => row.parent_item)).toEqual(["ITEM-001"]);

    // Interseção vazia: não existe atrasado com entrega a partir de 10/10.
    const vazia = await callRows({
      p_delivery_filter: "OVERDUE",
      p_delivery_from: "2026-10-10",
      p_delivery_to: "2026-10-31",
    });
    expect(vazia).toHaveLength(0);
  });

  it("soma o peso TOTAL (qtd × peso unit.) de toda a lista filtrada, antes da paginação (017/023)", async () => {
    // 4 itens raiz: 10 + 4 + 25 + 12 = 51 peças × 12,5 kg = 637,5 kg,
    // independentemente da página exibida.
    const page1 = await callRows({ p_limit: 1, p_offset: 0 });
    const page2 = await callRows({ p_limit: 1, p_offset: 3 });
    expect(Number(page1[0]?.weight_total)).toBe(637.5);
    expect(Number(page2[0]?.weight_total)).toBe(637.5);

    // Filtro estreita: só o ITEM-001 (10 × 12,5 = 125 kg).
    const filtrado = await callRows({ p_search: "ITEM-001", p_limit: 1 });
    expect(Number(filtrado[0]?.weight_total)).toBe(125);

    // Lista vazia não devolve linha (nem soma).
    expect(await callRows({ p_search: "inexistente" })).toHaveLength(0);
  });

  it("conta item sem peso como 0 na soma (017)", async () => {
    await db.query(
      `insert into public.orders (code, type, customer_name, status, delivery_date)
       values ('OF-SEM-PESO', 'OF', 'Metalúrgica Alfa', 'EM_PRODUCAO', '2026-12-01')`,
    );
    await db.query(
      `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
       select o.id, 'ESTRUTURA', 'ITEM-SEM-PESO', 'Peça sem peso cadastrado', 2, null, '2026-12-01', 'EM_PRODUCAO'
         from public.orders o where o.code = 'OF-SEM-PESO'`,
    );

    const semPeso = await callRows({ p_search: "ITEM-SEM-PESO" });
    expect(semPeso).toHaveLength(1);
    expect(Number(semPeso[0]?.weight_total)).toBe(0);

    // Limpeza: o pedido remove os itens junto (on delete cascade).
    await db.query(`delete from public.orders where code = 'OF-SEM-PESO'`);
  });

  it("soma a quantidade de toda a lista filtrada, antes da paginação (018)", async () => {
    // 10 + 4 + 25 + 12 = 51 unidades, independentemente da página exibida.
    const page1 = await callRows({ p_limit: 1, p_offset: 0 });
    const page2 = await callRows({ p_limit: 1, p_offset: 3 });
    expect(Number(page1[0]?.qty_total)).toBe(51);
    expect(Number(page2[0]?.qty_total)).toBe(51);

    // Filtro estreita: só o ITEM-001 (10).
    const filtrado = await callRows({ p_search: "ITEM-001", p_limit: 1 });
    expect(Number(filtrado[0]?.qty_total)).toBe(10);

    // Lista vazia não devolve linha (nem soma).
    expect(await callRows({ p_search: "inexistente" })).toHaveLength(0);
  });
});

describe("get_production_stats", () => {
  it("calcula KPIs, entregas e carga por processo", async () => {
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      "select public.get_production_stats($1::date) as result",
      [TODAY],
    );
    const stats = rows[0]?.result as {
      totalOrders: number;
      totalItems: number;
      itemsOverdue: number;
      itemsInProduction: number;
      delivery: Record<string, number>;
      expedition: { count: number; qty: number; weight: number };
      processes: { code: string; pending: number; done: number }[];
    };

    expect(stats.totalOrders).toBe(2);
    expect(stats.totalItems).toBe(4);
    expect(stats.itemsOverdue).toBe(1);
    expect(stats.itemsInProduction).toBe(4);
    expect(stats.delivery.overdue).toBe(1);
    // 019/023: o card "Atrasados" soma peças e PESO TOTAL (qtd × peso
    // unit.) do MESMO conjunto (ITEM-001: 10 × 12,5 kg = 125 kg).
    expect(stats.delivery.overdueQty).toBe(10);
    expect(stats.delivery.overdueWeight).toBe(125);
    expect(stats.delivery.next30).toBeGreaterThan(0);

    // 020/023: card "Expedição" — só itens com EXP concluído
    // (ITEM-002: 4 × 12,5 kg = 50 kg).
    expect(stats.expedition.count).toBe(1);
    expect(stats.expedition.qty).toBe(4);
    expect(stats.expedition.weight).toBe(50);

    const laser = stats.processes.find((process) => process.code === "LASER");
    expect(laser?.done).toBe(3);
    expect(laser?.pending).toBe(1);

    const exp = stats.processes.find((process) => process.code === "EXP");
    expect(exp?.done).toBe(1);
  });
});

describe("apply_import", () => {
  it("cria pedidos, itens e processos em uma única transação", async () => {
    await asUser(db, "authenticated", gestorId);

    const plan = {
      operations: [
        {
          action: "CREATE",
          order: {
            code: "OF-900",
            type: "OF",
            customerName: "Cliente Import",
            deliveryDate: "2026-12-01",
            status: "PLANEJADO",
          },
          item: {
            family: "PORTAS",
            parentItem: "ITEM-900",
            description: "Porta corta-fogo",
            quantity: "6",
            unitWeightKg: "80,5",
            deliveryDate: "2026-12-01",
            status: "PLANEJADO",
            op: "OP-900",
            processes: [
              { code: "LASER", status: "CONCLUIDO" },
              { code: "SERRA", status: "NAO_INICIADO" },
              { code: "EXP", status: "NAO_INICIADO" },
            ],
          },
        },
      ],
    };

    const { rows } = await db.query<{ result: Record<string, number> }>(
      "select public.apply_import($1::jsonb) as result",
      [JSON.stringify(plan)],
    );

    expect(rows[0]?.result).toMatchObject({ created: 1, updated: 0, skipped: 0, ordersCreated: 1 });

    const { rows: items } = await db.query<{
      description: string;
      quantity: string;
      op: string | null;
    }>(
      `select oi.description, oi.quantity::text, oi.op
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-900'`,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe("6");
    expect(items[0]?.op).toBe("OP-900"); // OP gravada na criação (013)

    const { rows: processes } = await db.query<{ code: string; status: string }>(
      `select p.code, pp.status
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
         join public.order_items oi on oi.id = pp.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-900' order by p.display_order`,
    );
    expect(processes).toHaveLength(3);
    expect(processes.find((process) => process.code === "LASER")?.status).toBe("CONCLUIDO");
    expect(processes.find((process) => process.code === "SERRA")?.status).toBe("NAO_INICIADO");

    await asSuperUser(db);
  });

  it("atualiza registros existentes sem duplicar", async () => {
    await asUser(db, "authenticated", gestorId);

    const plan = {
      operations: [
        {
          action: "UPDATE",
          itemId: (
            await db.query<{ id: string }>(
              `select oi.id from public.order_items oi
                 join public.orders o on o.id = oi.order_id
                where o.code = 'OF-900'`,
            )
          ).rows[0]?.id,
          order: { code: "OF-900", type: "OF", status: "EM_PRODUCAO" },
          item: {
            parentItem: "ITEM-900",
            description: "Porta corta-fogo reforçada",
            quantity: "12",
            deliveryDate: "2026-12-10",
            status: "EM_PRODUCAO",
            processes: [{ code: "LASER", status: "CONCLUIDO" }],
          },
        },
      ],
    };

    const { rows } = await db.query<{ result: Record<string, number> }>(
      "select public.apply_import($1::jsonb) as result",
      [JSON.stringify(plan)],
    );
    expect(rows[0]?.result).toMatchObject({ created: 0, updated: 1, skipped: 0 });

    const { rows: items } = await db.query<{
      description: string;
      quantity: string;
      op: string | null;
    }>(
      `select oi.description, oi.quantity::text, oi.op
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-900'`,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity).toBe("12");
    expect(items[0]?.description).toBe("Porta corta-fogo reforçada");
    // Plano sem a chave {item,op} (planilha): a OP atual é preservada (013).
    expect(items[0]?.op).toBe("OP-900");

    await asSuperUser(db);
  });

  it("grava e limpa a OP quando a chave {item,op} vem presente (013)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows: itemRows } = await db.query<{ id: string }>(
      `select oi.id from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-900'`,
    );
    const itemId = itemRows[0]?.id;

    const updateWithOp = {
      operations: [
        {
          action: "UPDATE",
          itemId,
          order: { code: "OF-900", type: "OF" },
          item: { parentItem: "ITEM-900", op: "OP-901" },
        },
      ],
    };
    await db.query("select public.apply_import($1::jsonb) as result", [
      JSON.stringify(updateWithOp),
    ]);
    const { rows: changed } = await db.query<{ op: string | null }>(
      `select oi.op from public.order_items oi where oi.id = $1`,
      [itemId],
    );
    expect(changed[0]?.op).toBe("OP-901");

    // OP apagada no formulário (null ou "") limpa a coluna.
    const clearOp = {
      operations: [
        {
          action: "UPDATE",
          itemId,
          order: { code: "OF-900", type: "OF" },
          item: { parentItem: "ITEM-900", op: "" },
        },
      ],
    };
    await db.query("select public.apply_import($1::jsonb) as result", [
      JSON.stringify(clearOp),
    ]);
    const { rows: cleared } = await db.query<{ op: string | null }>(
      `select oi.op from public.order_items oi where oi.id = $1`,
      [itemId],
    );
    expect(cleared[0]?.op).toBeNull();

    await asSuperUser(db);
  });

  it("peso total é SEMPRE derivado (qtd × peso unit.) mesmo via planilha (015/023)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows: itemRows } = await db.query<{ id: string }>(
      `select oi.id from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-900'`,
    );
    const itemId = itemRows[0]?.id as string;

    // A planilha envia 483,5 mas o sistema grava a fórmula (12 × 80,5 = 966,
    // a quantidade veio do teste anterior): o trigger (023) recalcula todo
    // total gravado.
    const withTotal = {
      operations: [
        {
          action: "UPDATE",
          itemId,
          order: { code: "OF-900", type: "OF" },
          item: { parentItem: "ITEM-900", totalWeightKg: "483,5" },
        },
      ],
    };
    await db.query("select public.apply_import($1::jsonb) as result", [JSON.stringify(withTotal)]);
    const { rows: withValue } = await db.query<{ total_weight_kg: string | null }>(
      `select total_weight_kg::text as total_weight_kg from public.order_items where id = $1`,
      [itemId],
    );
    expect(withValue[0]?.total_weight_kg).toBe("966");

    // Célula vazia (chave nula): o total continua derivado — mesma regra.
    const keepTotal = {
      operations: [
        {
          action: "UPDATE",
          itemId,
          order: { code: "OF-900", type: "OF" },
          item: { parentItem: "ITEM-900", totalWeightKg: null },
        },
      ],
    };
    await db.query("select public.apply_import($1::jsonb) as result", [JSON.stringify(keepTotal)]);
    const { rows: kept } = await db.query<{ total_weight_kg: string | null }>(
      `select total_weight_kg::text as total_weight_kg from public.order_items where id = $1`,
      [itemId],
    );
    expect(kept[0]?.total_weight_kg).toBe("966");

    await asSuperUser(db);
  });

  it("ignora operações marcadas como SKIP", async () => {
    await asUser(db, "authenticated", gestorId);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      "select public.apply_import($1::jsonb) as result",
      [JSON.stringify({ operations: [{ action: "SKIP", order: { code: "OF-900" } }] })],
    );
    expect(rows[0]?.result).toMatchObject({ skipped: 1, created: 0, updated: 0 });
    await asSuperUser(db);
  });

  it("faz rollback completo quando alguma operação é inválida", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows: before } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.order_items",
    );

    const plan = {
      operations: [
        {
          action: "CREATE",
          order: { code: "OF-ROLLBACK", type: "OF" },
          item: { description: "Será revertido", quantity: "1", processes: [] },
        },
        {
          action: "CREATE",
          order: { code: "OF-ROLLBACK-2", type: "OF" },
          item: { description: "Quantidade inválida", quantity: "abc", processes: [] },
        },
      ],
    };

    await expect(
      db.query("select public.apply_import($1::jsonb) as result", [JSON.stringify(plan)]),
    ).rejects.toThrow();

    const { rows: after } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.order_items",
    );
    expect(after[0]?.count).toBe(before[0]?.count);

    const { rows: orders } = await db.query(
      "select id from public.orders where code like 'OF-ROLLBACK%'",
    );
    expect(orders).toHaveLength(0);

    await asSuperUser(db);
  });
});

describe("get_production_rows — filtros de coluna (007)", () => {
  beforeAll(async () => {
    await asSuperUser(db);
    await db.query(
      `insert into public.orders (code, type, customer_name, status, delivery_date)
       values ('OF-COLUNA', 'OF', 'Metalúrgica Beta', 'EM_PRODUCAO', '2026-12-15')`,
    );
    await db.query(
      `insert into public.order_items (order_id, family, parent_item, description, quantity, unit_weight_kg, delivery_date, status)
       select o.id, 'GUARDAS', 'ITEM-COLUNA', 'Caixa de correio pintada', 7, 3.5, '2026-12-15', 'EM_PRODUCAO'
         from public.orders o where o.code = 'OF-COLUNA'`,
    );
  });

  it("filtra por cliente (contém, sem diferenciar maiúsculas)", async () => {
    const beta = await callRows({ p_customer: "beta" });
    expect(beta).toHaveLength(1);
    expect(beta[0]?.parent_item).toBe("ITEM-COLUNA");
    expect(beta[0]?.customer_name).toBe("Metalúrgica Beta");
    expect(Number(beta[0]?.total_count)).toBe(1);

    expect(await callRows({ p_customer: "ALFA" })).toHaveLength(4);
    expect(await callRows({ p_customer: "inexistente" })).toHaveLength(0);
    // String vazia = sem filtro (nullif na RPC).
    expect(await callRows({ p_customer: "" })).toHaveLength(6);
  });

  it("filtra por código OF/OS, família, item pai e descrição", async () => {
    expect(await callRows({ p_order_code: "coluna" })).toHaveLength(1);
    expect(await callRows({ p_order_code: "OF-9" })).toHaveLength(1);

    const guardas = await callRows({ p_family: "guardas" });
    expect(guardas.map((row) => row.parent_item)).toEqual(["ITEM-COLUNA"]);
    expect(await callRows({ p_family: "estrutura" })).toHaveLength(4);
    expect(await callRows({ p_family: "portas" })).toHaveLength(1);

    expect(await callRows({ p_parent_item: "item-coluna" })).toHaveLength(1);
    expect(await callRows({ p_parent_item: "item-1" })).toHaveLength(2);

    const correio = await callRows({ p_description: "CORREIO" });
    expect(correio.map((row) => row.parent_item)).toEqual(["ITEM-COLUNA"]);
    // "porta" aparece em duas descrições distintas.
    expect(await callRows({ p_description: "porta" })).toHaveLength(2);
  });

  it("filtra por faixa de quantidade", async () => {
    expect(await callRows({ p_qty_max: 4 })).toHaveLength(1);
    expect(await callRows({ p_qty_min: 7, p_qty_max: 7 })).toHaveLength(1);
    expect(await callRows({ p_qty_min: 10, p_qty_max: 12 })).toHaveLength(3);
    // Mínimo maior que máximo não retorna nada (sem erro).
    expect(await callRows({ p_qty_min: 5, p_qty_max: 4 })).toHaveLength(0);
  });

  it("filtra por faixa de peso unitário (itens sem peso não entram)", async () => {
    expect(await callRows({ p_weight_max: 5 })).toHaveLength(1);
    expect(await callRows({ p_weight_min: 12.5, p_weight_max: 12.5 })).toHaveLength(4);
    expect(await callRows({ p_weight_min: 10 })).toHaveLength(5);
  });

  it("combina filtros de coluna com E lógico", async () => {
    expect(await callRows({ p_customer: "beta", p_qty_max: 7 })).toHaveLength(1);
    expect(await callRows({ p_customer: "alfa", p_qty_max: 4 })).toHaveLength(1);
    expect(await callRows({ p_customer: "beta", p_family: "estrutura" })).toHaveLength(0);
    expect(await callRows({ p_order_code: "coluna", p_description: "correio" })).toHaveLength(1);
  });

  it("combina filtro de coluna com busca global e status de processo", async () => {
    expect(await callRows({ p_search: "ITEM-COLUNA", p_customer: "beta" })).toHaveLength(1);
    expect(await callRows({ p_search: "ITEM-COLUNA", p_customer: "alfa" })).toHaveLength(0);
    // Item novo não tem processos: filtro de processo o exclui.
    expect(await callRows({ p_customer: "beta", p_process_code: "LASER" })).toHaveLength(0);
  });
});

describe("refresh_order_statuses (013)", () => {
  async function itemRow(code: string, parentItem: string): Promise<{ id: string; order_id: string }> {
    const { rows } = await db.query<{ id: string; order_id: string }>(
      `select oi.id, oi.order_id
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.code = $1 and oi.parent_item = $2`,
      [code, parentItem],
    );
    const row = rows[0];
    if (!row) throw new Error(`fixture não encontrada: ${code}/${parentItem}`);
    return row;
  }

  async function orderStatus(orderId: string): Promise<string> {
    const { rows } = await db.query<{ status: string }>(
      `select status from public.orders where id = $1`,
      [orderId],
    );
    return rows[0]?.status as string;
  }

  it("OPERADOR grava o status derivado e a OF acompanha os itens", async () => {
    await asSuperUser(db);
    const operadorId = await createUser(db, "op.refresh@serralheria.com", "OPERADOR");

    const first = await itemRow("OF-001", "ITEM-001");
    const second = await itemRow("OF-001", "ITEM-002");

    await asUser(db, "authenticated", operadorId);
    await db.query("select public.refresh_order_statuses($1::uuid, 'CONCLUIDO')", [first.id]);

    const { rows: itemAfter } = await db.query<{ status: string }>(
      `select status from public.order_items where id = $1`,
      [first.id],
    );
    expect(itemAfter[0]?.status).toBe("CONCLUIDO");
    // ITEM-002 ainda está em produção: a OF continua EM_PRODUCAO.
    expect(await orderStatus(first.order_id)).toBe("EM_PRODUCAO");

    // Conclui o último item: a OF vira CONCLUIDO (mesma precedência do serviço).
    await db.query("select public.refresh_order_statuses($1::uuid, 'CONCLUIDO')", [second.id]);
    expect(await orderStatus(first.order_id)).toBe("CONCLUIDO");

    await asSuperUser(db);
  });

  it("nunca sobrescreve uma OF cancelada", async () => {
    await asSuperUser(db);
    const operadorId = (await db.query<{ id: string }>(
      `select id from public.profiles where email = 'op.refresh@serralheria.com'`,
    )).rows[0]?.id as string;

    const target = await itemRow("OF-002", "ITEM-101");
    await db.query(`update public.orders set status = 'CANCELADO' where id = $1`, [target.order_id]);

    await asUser(db, "authenticated", operadorId);
    await db.query("select public.refresh_order_statuses($1::uuid, 'PLANEJADO')", [target.id]);

    const { rows: itemAfter } = await db.query<{ status: string }>(
      `select status from public.order_items where id = $1`,
      [target.id],
    );
    expect(itemAfter[0]?.status).toBe("PLANEJADO"); // item muda…
    expect(await orderStatus(target.order_id)).toBe("CANCELADO"); // …OF não

    await asSuperUser(db);
  });

  it("barra quem não tem permissão e status fora da faixa", async () => {
    await asSuperUser(db);
    const visualizadorId = await createUser(db, "viz.refresh@serralheria.com", "VISUALIZADOR");
    const target = await itemRow("OF-002", "ITEM-102");

    await asUser(db, "authenticated", visualizadorId);
    await expect(
      db.query("select public.refresh_order_statuses($1::uuid, 'CONCLUIDO')", [target.id]),
    ).rejects.toThrow(/Sem permissão/);

    const operadorId = (await db.query<{ id: string }>(
      `select id from public.profiles where email = 'op.refresh@serralheria.com'`,
    )).rows[0]?.id as string;
    await asUser(db, "authenticated", operadorId);
    await expect(
      db.query("select public.refresh_order_statuses($1::uuid, 'QUALQUER')", [target.id]),
    ).rejects.toThrow(/Status de item inválido/);

    await asSuperUser(db);
  });
});

describe("apply_of_import (016)", () => {
  async function callApplyOfPlan(plan: unknown): Promise<Record<string, number>> {
    const { rows } = await db.query<{ result: Record<string, number> }>(
      "select public.apply_of_import($1::jsonb) as result",
      [JSON.stringify(plan)],
    );
    return rows[0]?.result ?? {};
  }

  interface ItemRow {
    id: string;
    parent_order_item_id: string | null;
    status: string;
    op: string | null;
    quantity: string;
    delivery_date: string;
  }

  async function itemByCode(orderCode: string, parentItem: string): Promise<ItemRow | null> {
    const { rows } = await db.query<ItemRow>(
      `select oi.id, oi.parent_order_item_id, oi.status, oi.op,
              oi.quantity::text, to_char(oi.delivery_date, 'YYYY-MM-DD') as delivery_date
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
        where o.code = $1 and oi.parent_item = $2`,
      [orderCode, parentItem],
    );
    return rows[0] ?? null;
  }

  /** Plano inicial: 2 pais (1 com filhos, 1 tipo X) + 3 materiais. */
  function createPlan() {
    return {
      operations: [
        {
          action: "CREATE",
          order: {
            code: "OF-700",
            type: "OF",
            customerName: "Cliente Estrutura",
            description: "Estrutura nova",
            deliveryDate: "2026-12-20",
          },
          parents: [
            {
              code: "P-1",
              description: "GUARDA CORPO",
              family: "GC",
              quantity: 2,
              unitWeightKg: 12.5,
              totalWeightKg: 25,
              deliveryDate: "2026-12-20",
              materials: [
                { description: "TB42.20X3.56", quantity: 2, unit: "UN", notes: "T1318 · SCH40" },
              ],
              children: [
                {
                  code: "C-1",
                  description: "GUARDA CORPO",
                  family: "GC",
                  quantity: 3,
                  unitWeightKg: 4.16,
                  totalWeightKg: 12.48,
                  deliveryDate: "2026-12-20",
                  materials: [
                    { description: "TB42.20X3.56", quantity: 3, unit: "UN", notes: null },
                  ],
                },
                {
                  code: "C-2",
                  description: "MONTANTE",
                  family: "M",
                  quantity: 2,
                  unitWeightKg: 1.5,
                  totalWeightKg: 3,
                  deliveryDate: "2026-12-20",
                  materials: [],
                },
              ],
            },
            {
              code: "P-2",
              description: "BOTÃO PORTA",
              family: "BP",
              quantity: 2,
              unitWeightKg: 1.09,
              totalWeightKg: 2.18,
              deliveryDate: "2026-12-20",
              materials: [
                { description: "TB42.20X3.56", quantity: 2, unit: "UN", notes: null },
              ],
              children: [],
            },
          ],
        },
      ],
    };
  }

  /** Reimportação: P-1 muda quantidade e material, C-2 some do arquivo. */
  function updatePlan() {
    const plan = createPlan();
    const operation = plan.operations[0]!;
    operation.action = "UPDATE";
    operation.parents[0]!.quantity = 5;
    operation.parents[0]!.totalWeightKg = 62.5;
    operation.parents[0]!.materials = [
      { description: "TB40X40", quantity: 5, unit: "UN", notes: null },
    ];
    operation.parents[0]!.children = [
      {
        code: "C-1",
        description: "GUARDA CORPO",
        family: "GC",
        quantity: 9,
        unitWeightKg: 4.16,
        totalWeightKg: 37.44,
        deliveryDate: "2026-12-20",
        materials: [{ description: "TB40X40", quantity: 9, unit: "UN", notes: null }],
      },
    ];
    return plan;
  }

  it("cria a hierarquia OF -> pais -> filhos com processos e materiais", async () => {
    await asUser(db, "authenticated", gestorId);
    const result = await callApplyOfPlan(createPlan());

    expect(result).toMatchObject({
      ordersCreated: 1,
      ordersUpdated: 0,
      ordersSkipped: 0,
      parentsCreated: 2,
      parentsUpdated: 0,
      childrenCreated: 2,
      childrenUpdated: 0,
      itemsRemoved: 0,
    });

    // Pedido: cliente e entrega do formulário; status derivado (tudo não iniciado).
    const { rows: orders } = await db.query<{
      customer_name: string;
      delivery_date: string;
      status: string;
    }>(
      `select customer_name, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date, status
         from public.orders where code = 'OF-700'`,
    );
    expect(orders[0]).toMatchObject({
      customer_name: "Cliente Estrutura",
      delivery_date: "2026-12-20",
      status: "PLANEJADO",
    });

    // Hierarquia: 2 raízes + 2 filhos vinculados; entrega em TODO registro.
    const rootP1 = await itemByCode("OF-700", "P-1");
    const rootP2 = await itemByCode("OF-700", "P-2");
    const child1 = await itemByCode("OF-700", "C-1");
    const child2 = await itemByCode("OF-700", "C-2");

    expect(rootP1?.parent_order_item_id).toBeNull();
    expect(rootP2?.parent_order_item_id).toBeNull();
    expect(child1?.parent_order_item_id).toBe(rootP1?.id);
    expect(child2?.parent_order_item_id).toBe(rootP1?.id);
    for (const item of [rootP1, rootP2, child1, child2]) {
      expect(item?.delivery_date).toBe("2026-12-20");
      expect(item?.quantity).not.toBe("0");
    }

    // Materiais por item (unidade padronizada em UN, código·qualidade nas notas).
    const { rows: materials } = await db.query<{
      parent_item: string;
      description: string;
      quantity: string;
      unit: string;
      notes: string | null;
    }>(
      `select oi.parent_item, m.description, m.quantity::text, m.unit, m.notes
         from public.order_item_materials m
         join public.order_items oi on oi.id = m.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-700'
        order by oi.parent_item`,
    );
    expect(materials).toHaveLength(3);
    expect(materials.find((entry) => entry.parent_item === "P-1")).toMatchObject({
      description: "TB42.20X3.56",
      quantity: "2",
      unit: "UN",
      notes: "T1318 · SCH40",
    });
    expect(materials.find((entry) => entry.parent_item === "P-2")?.quantity).toBe("2");
    expect(materials.find((entry) => entry.parent_item === "C-1")?.quantity).toBe("3");

    // Catálogo completo por item (invariante 010): MP obrigatório; SERRA e
    // DB_TB nascem marcados onde há material TB (P-1, P-2, C-1); C-2 sem
    // material e DB_CH nascem desmarcados — regras 027/028. Cadeia final
    // (032): o pai nasce com PRÉ-MTG…EXP marcados e o filho com o KIT.
    const { rows: active } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.processes where active",
    );
    const { rows: processes } = await db.query<{
      total: string;
      nao: string;
      aplica: string;
      itens: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where pp.status = 'NAO_INICIADO')::text as nao,
              count(*) filter (where pp.status = 'NAO_APLICAVEL')::text as aplica,
              count(distinct oi.id)::text as itens
         from public.production_processes pp
         join public.order_items oi on oi.id = pp.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-700'`,
    );
    expect(processes[0]?.total).toBe(String(Number(active[0]?.count) * 4));
    expect(processes[0]?.itens).toBe("4");
    expect(processes[0]?.nao).toBe("22"); // 4 MP + 3 SERRA + 3 DB_TB + 2 KIT + 10 (PRÉ-MTG…EXP nos 2 pais)
    expect(processes[0]?.aplica).toBe(String(Number(processes[0]?.total) - 22));

    const { rows: porCodigo } = await db.query<{ key: string; n: string }>(
      `select p.code || ':' || pp.status as key, count(*)::text as n
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
         join public.order_items oi on oi.id = pp.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-700'
        group by 1`,
    );
    const mapa = new Map(porCodigo.map((row) => [row.key, row.n] as [string, string]));
    expect(mapa.get("MP:NAO_INICIADO")).toBe("4");
    expect(mapa.get("SERRA:NAO_INICIADO")).toBe("3"); // P-1, P-2, C-1 com TB
    expect(mapa.get("SERRA:NAO_APLICAVEL")).toBe("1"); // C-2 sem material
    expect(mapa.get("DB_TB:NAO_INICIADO")).toBe("3");
    expect(mapa.get("DB_TB:NAO_APLICAVEL")).toBe("1");
    expect(mapa.get("DB_CH:NAO_APLICAVEL")).toBe("4");
    expect(mapa.get("LASER:NAO_APLICAVEL")).toBe("4");
    // 032: cadeia final marcada por tipo de item — KIT só no filho,
    // PRÉ-MTG…EXP só no pai (2 de cada; os itens de fora ficam NAO_APLICAVEL).
    expect(mapa.get("KIT:NAO_INICIADO")).toBe("2"); // C-1 e C-2
    expect(mapa.get("KIT:NAO_APLICAVEL")).toBe("2"); // P-1 e P-2
    for (const code of ["PRE_MTG", "SOLDA", "ACAB", "QUALITY", "EXP"]) {
      expect(mapa.get(`${code}:NAO_INICIADO`)).toBe("2"); // P-1 e P-2
      expect(mapa.get(`${code}:NAO_APLICAVEL`)).toBe("2"); // C-1 e C-2
    }

    await asSuperUser(db);
  });

  it("UPDATE preserva status/OP/processos, troca materiais e remove o que sumiu", async () => {
    await asUser(db, "authenticated", gestorId);

    // Avança o filho C-1 (com OP) e conclui o LASER do pai P-1.
    const child1 = await itemByCode("OF-700", "C-1");
    await db.query(
      "update public.order_items set status = 'EM_PRODUCAO', op = 'OP-777' where id = $1",
      [child1?.id],
    );
    const rootP1 = await itemByCode("OF-700", "P-1");
    await db.query(
      `update public.production_processes set status = 'CONCLUIDO'
        where order_item_id = $1
          and process_id = (select id from public.processes where code = 'LASER')`,
      [rootP1?.id],
    );

    // Novo processo no catálogo: entra em todos os itens sem tocar nos existentes.
    await asSuperUser(db);
    await db.query(
      "insert into public.processes (code, name, display_order, active) values ('NOVO_P', 'Novo processo', 990, true)",
    );
    await asUser(db, "authenticated", gestorId);

    const result = await callApplyOfPlan(updatePlan());
    expect(result).toMatchObject({
      ordersCreated: 0,
      ordersUpdated: 1,
      ordersSkipped: 0,
      parentsCreated: 0,
      parentsUpdated: 2,
      childrenCreated: 0,
      childrenUpdated: 1,
      itemsRemoved: 1,
    });

    // Preservação: status/OP do filho que continua e processo já concluído do pai.
    const childAfter = await itemByCode("OF-700", "C-1");
    expect(childAfter).toMatchObject({ status: "EM_PRODUCAO", op: "OP-777", quantity: "9" });
    const rootAfter = await itemByCode("OF-700", "P-1");
    expect(rootAfter?.quantity).toBe("5");
    const { rows: laser } = await db.query<{ status: string }>(
      `select pp.status
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
        where pp.order_item_id = $1 and p.code = 'LASER'`,
      [rootP1?.id],
    );
    expect(laser[0]?.status).toBe("CONCLUIDO");

    // C-2 não está mais no arquivo -> removido (cascata de processos/materiais).
    expect(await itemByCode("OF-700", "C-2")).toBeNull();

    // Materiais substituídos pelos do arquivo.
    const { rows: materials } = await db.query<{ description: string; quantity: string; unit: string }>(
      `select m.description, m.quantity::text, m.unit
         from public.order_item_materials m
         join public.order_items oi on oi.id = m.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-700' and oi.parent_item = 'P-1'`,
    );
    expect(materials).toEqual([{ description: "TB40X40", quantity: "5", unit: "UN" }]);

    // Novo processo do catálogo nasce DESMARCADO (NAO_APLICAVEL) nos 3
    // itens remanescentes — só o MP é obrigatório (027).
    const { rows: novo } = await db.query<{ total: string; nao: string; aplica: string }>(
      `select count(*)::text as total,
              count(*) filter (where pp.status = 'NAO_INICIADO')::text as nao,
              count(*) filter (where pp.status = 'NAO_APLICAVEL')::text as aplica
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
         join public.order_items oi on oi.id = pp.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-700' and p.code = 'NOVO_P'`,
    );
    expect(novo).toEqual([{ total: "3", nao: "0", aplica: "3" }]);

    // Status da OF re-derivado: filho em produção -> OF em produção.
    const { rows: orders } = await db.query<{ status: string }>(
      "select status from public.orders where code = 'OF-700'",
    );
    expect(orders[0]?.status).toBe("EM_PRODUCAO");

    await asSuperUser(db);
  });

  it("KEEP e SKIP são no-op (nada muda no banco)", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows: before } = await db.query<{ items: string; orders: string }>(
      `select (select count(*) from public.order_items)::text as items,
              (select count(*) from public.orders)::text as orders`,
    );

    const result = await callApplyOfPlan({
      operations: [
        { action: "KEEP", order: { code: "OF-700" }, parents: [] },
        { action: "SKIP", order: { code: "OF-700" }, parents: [] },
      ],
    });

    expect(result).toMatchObject({
      ordersCreated: 0,
      ordersUpdated: 0,
      ordersSkipped: 2,
      parentsCreated: 0,
      parentsUpdated: 0,
      childrenCreated: 0,
      childrenUpdated: 0,
      itemsRemoved: 0,
    });

    const { rows: after } = await db.query<{ items: string; orders: string }>(
      `select (select count(*) from public.order_items)::text as items,
              (select count(*) from public.orders)::text as orders`,
    );
    expect(after[0]).toEqual(before[0]);

    await asSuperUser(db);
  });

  it("nunca sobrescreve uma OF cancelada (013/016)", async () => {
    await asSuperUser(db);
    await db.query("update public.orders set status = 'CANCELADO' where code = 'OF-700'");
    await asUser(db, "authenticated", gestorId);

    const result = await callApplyOfPlan(updatePlan());
    expect(result).toMatchObject({ ordersUpdated: 1, ordersCreated: 0 });

    const { rows: orders } = await db.query<{ status: string }>(
      "select status from public.orders where code = 'OF-700'",
    );
    expect(orders[0]?.status).toBe("CANCELADO");

    // Itens continuam sendo atualizados normalmente.
    expect(await itemByCode("OF-700", "C-1")).toMatchObject({ quantity: "9", status: "EM_PRODUCAO" });

    await asSuperUser(db);
  });

  it("faz rollback completo quando alguma operação é inválida", async () => {
    await asUser(db, "authenticated", gestorId);

    const { rows: before } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.order_items",
    );

    const valid = createPlan().operations[0]!;
    valid.order.code = "OF-ROLL-1";
    const invalid = createPlan().operations[0]!;
    invalid.order.code = "OF-ROLL-2";
    invalid.parents[0]!.description = ""; // description NOT NULL -> erro no meio do plano

    await expect(callApplyOfPlan({ operations: [valid, invalid] })).rejects.toThrow();

    const { rows: after } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.order_items",
    );
    expect(after[0]?.count).toBe(before[0]?.count);

    const { rows: orders } = await db.query(
      "select id from public.orders where code in ('OF-ROLL-1', 'OF-ROLL-2')",
    );
    expect(orders).toHaveLength(0);

    await asSuperUser(db);
  });

  it("bloqueia anon e perfil sem permissão de escrita", async () => {
    const plan = {
      operations: [
        {
          action: "CREATE",
          order: { code: "OF-BLOQUEIO", type: "OF", customerName: "X", description: "", deliveryDate: "2026-12-20" },
          parents: [
            {
              code: "PB",
              description: "Bloqueio",
              family: "B",
              quantity: 1,
              unitWeightKg: null,
              totalWeightKg: null,
              deliveryDate: "2026-12-20",
              materials: [],
              children: [],
            },
          ],
        },
      ],
    };

    // Sem sessão: a RPC barra na checagem de auth.uid() (padrão do app —
    // o grant via PUBLIC não bloqueia anon, a sessão nula sim).
    await asUser(db, "anon", null);
    await expect(callApplyOfPlan(plan)).rejects.toThrow(/Sessão expirada/);

    // OPERADOR executa a função, mas o RLS barra a escrita de pedidos/itens.
    await asSuperUser(db);
    const operadorId = await createUser(db, "op.ofimport@serralheria.com", "OPERADOR");
    await asUser(db, "authenticated", operadorId);
    await expect(callApplyOfPlan(plan)).rejects.toThrow();

    await asSuperUser(db);
    const { rows: orders } = await db.query("select id from public.orders where code = 'OF-BLOQUEIO'");
    expect(orders).toHaveLength(0);
  });

  it("produção e estatísticas contam apenas os itens pai (016)", async () => {
    await asSuperUser(db);

    const { rows: roots } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.order_items where parent_order_item_id is null",
    );
    const { rows: children } = await db.query<{ count: string }>(
      "select count(*)::text as count from public.order_items where parent_order_item_id is not null",
    );
    expect(Number(children[0]?.count)).toBeGreaterThan(0); // C-1 existe

    const { rows: statsRows } = await db.query<{ result: Record<string, unknown> }>(
      "select public.get_production_stats($1::date) as result",
      [TODAY],
    );
    const stats = statsRows[0]?.result as { totalItems: number };
    expect(stats.totalItems).toBe(Number(roots[0]?.count));

    // O filho NÃO aparece na grade de produção; os pais da OF aparecem.
    const childRows = await callRows({ p_search: "C-1" });
    expect(childRows).toHaveLength(0);

    const orderRows = await callRows({ p_search: "OF-700" });
    expect(orderRows.map((row) => row.parent_item).sort()).toEqual(["P-1", "P-2"]);
  });

  it("material TB marca SERRA/DB_TB e CH marca DB_CH/LASER ao nascer (030)", async () => {
    await asUser(db, "authenticated", gestorId);

    await callApplyOfPlan({
      operations: [
        {
          action: "CREATE",
          order: {
            code: "OF-800",
            type: "OF",
            customerName: "Cliente Prefixo",
            description: "Regra de material",
            deliveryDate: "2026-12-30",
          },
          parents: [
            {
              code: "A-1",
              description: "COM TB",
              family: "TB",
              quantity: 1,
              unitWeightKg: 1,
              totalWeightKg: 1,
              deliveryDate: "2026-12-30",
              materials: [{ description: "  tb40x40", quantity: 1, unit: "UN", notes: null }],
              children: [],
            },
            {
              code: "A-2",
              description: "COM CH",
              family: "CH",
              quantity: 1,
              unitWeightKg: 1,
              totalWeightKg: 1,
              deliveryDate: "2026-12-30",
              materials: [{ description: "CH100X100", quantity: 1, unit: "UN", notes: null }],
              children: [
                {
                  code: "A-2-F",
                  description: "FILHO SEM MATERIAL",
                  family: "F",
                  quantity: 1,
                  unitWeightKg: 1,
                  totalWeightKg: 1,
                  deliveryDate: "2026-12-30",
                  materials: [],
                },
              ],
            },
          ],
        },
      ],
    });

    const { rows } = await db.query<{ parent_item: string; code: string; status: string }>(
      `select oi.parent_item, p.code, pp.status
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
         join public.order_items oi on oi.id = pp.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-800'
          and p.code in ('MP', 'SERRA', 'DB_TB', 'DB_CH', 'LASER')`,
    );
    const statusOf = (item: string, code: string) =>
      rows.find((row) => row.parent_item === item && row.code === code)?.status;

    // Item com material TB (com espaço e minúsculo — normaliza): SERRA + DB TB.
    expect(statusOf("A-1", "MP")).toBe("NAO_INICIADO");
    expect(statusOf("A-1", "SERRA")).toBe("NAO_INICIADO");
    expect(statusOf("A-1", "DB_TB")).toBe("NAO_INICIADO");
    expect(statusOf("A-1", "DB_CH")).toBe("NAO_APLICAVEL");
    expect(statusOf("A-1", "LASER")).toBe("NAO_APLICAVEL");

    // Item com material CH: DB CH + LASER; SERRA e DB TB ficam desmarcados.
    expect(statusOf("A-2", "MP")).toBe("NAO_INICIADO");
    expect(statusOf("A-2", "SERRA")).toBe("NAO_APLICAVEL");
    expect(statusOf("A-2", "DB_CH")).toBe("NAO_INICIADO");
    expect(statusOf("A-2", "DB_TB")).toBe("NAO_APLICAVEL");
    expect(statusOf("A-2", "LASER")).toBe("NAO_INICIADO");

    // Filho sem material: só o MP é obrigatório (e o KIT — 032 — que não
    // entra nesta consulta).
    expect(statusOf("A-2-F", "MP")).toBe("NAO_INICIADO");
    expect(statusOf("A-2-F", "SERRA")).toBe("NAO_APLICAVEL");
    expect(statusOf("A-2-F", "DB_TB")).toBe("NAO_APLICAVEL");
    expect(statusOf("A-2-F", "DB_CH")).toBe("NAO_APLICAVEL");
    expect(statusOf("A-2-F", "LASER")).toBe("NAO_APLICAVEL");

    // Limpeza: a OF-800 não pode vazar para os testes seguintes.
    await asSuperUser(db);
    await db.query(
      "delete from public.order_items where order_id = (select id from public.orders where code = 'OF-800')",
    );
    await db.query("delete from public.orders where code = 'OF-800'");
  });

  it("material começando com L ou F marca só o SERRA ao nascer (034)", async () => {
    await asUser(db, "authenticated", gestorId);

    await callApplyOfPlan({
      operations: [
        {
          action: "CREATE",
          order: {
            code: "OF-910",
            type: "OF",
            customerName: "Cliente Latao",
            description: "Regra L/F do material",
            deliveryDate: "2026-12-30",
          },
          parents: [
            {
              code: "B-1",
              description: "PAI COM LATAO",
              family: "TB",
              quantity: 1,
              unitWeightKg: 1,
              totalWeightKg: 1,
              deliveryDate: "2026-12-30",
              materials: [{ description: "  latao 1mm", quantity: 1, unit: "UN", notes: null }],
              children: [
                {
                  code: "B-1-F",
                  description: "FILHO COM FERRO",
                  family: "TB",
                  quantity: 1,
                  unitWeightKg: 1,
                  totalWeightKg: 1,
                  deliveryDate: "2026-12-30",
                  materials: [{ description: "Ferragem 5mm", quantity: 1, unit: "UN", notes: null }],
                },
              ],
            },
            {
              code: "B-2",
              description: "PAI COM COBRE",
              family: "CH",
              quantity: 1,
              unitWeightKg: 1,
              totalWeightKg: 1,
              deliveryDate: "2026-12-30",
              materials: [{ description: "Cobre 2mm", quantity: 1, unit: "UN", notes: null }],
              children: [],
            },
            {
              code: "B-3",
              description: "TB E L JUNTOS",
              family: "TB",
              quantity: 1,
              unitWeightKg: 1,
              totalWeightKg: 1,
              deliveryDate: "2026-12-30",
              materials: [
                { description: "tb40x40", quantity: 1, unit: "UN", notes: null },
                { description: "Latao 2mm", quantity: 1, unit: "UN", notes: null },
              ],
              children: [],
            },
            {
              code: "B-4",
              description: "CH E F JUNTOS",
              family: "CH",
              quantity: 1,
              unitWeightKg: 1,
              totalWeightKg: 1,
              deliveryDate: "2026-12-30",
              materials: [
                { description: "CH100X100", quantity: 1, unit: "UN", notes: null },
                { description: "ferro 8mm", quantity: 1, unit: "UN", notes: null },
              ],
              children: [],
            },
          ],
        },
      ],
    });

    const { rows } = await db.query<{ parent_item: string; code: string; status: string }>(
      `select oi.parent_item, p.code, pp.status
         from public.production_processes pp
         join public.processes p on p.id = pp.process_id
         join public.order_items oi on oi.id = pp.order_item_id
         join public.orders o on o.id = oi.order_id
        where o.code = 'OF-910'
          and p.code in ('SERRA', 'DB_TB', 'DB_CH', 'LASER')`,
    );
    const statusOf = (item: string, code: string) =>
      rows.find((row) => row.parent_item === item && row.code === code)?.status;

    // Pai com material L (espaço e minúsculo — normaliza): só o SERRA.
    expect(statusOf("B-1", "SERRA")).toBe("NAO_INICIADO");
    expect(statusOf("B-1", "DB_TB")).toBe("NAO_APLICAVEL");
    // Filho com material F: o SERRA nasce marcado nele também.
    expect(statusOf("B-1-F", "SERRA")).toBe("NAO_INICIADO");
    expect(statusOf("B-1-F", "DB_TB")).toBe("NAO_APLICAVEL");

    // Outra letra inicial (C): nada muda.
    expect(statusOf("B-2", "SERRA")).toBe("NAO_APLICAVEL");

    // União TB + L: SERRA e DB TB (o TB manda no DB TB).
    expect(statusOf("B-3", "SERRA")).toBe("NAO_INICIADO");
    expect(statusOf("B-3", "DB_TB")).toBe("NAO_INICIADO");

    // União CH + F: LASER + DB CH pelo CH e SERRA pelo F.
    expect(statusOf("B-4", "LASER")).toBe("NAO_INICIADO");
    expect(statusOf("B-4", "DB_CH")).toBe("NAO_INICIADO");
    expect(statusOf("B-4", "SERRA")).toBe("NAO_INICIADO");
    expect(statusOf("B-4", "DB_TB")).toBe("NAO_APLICAVEL");

    // Limpeza: a OF-910 não pode vazar para os testes seguintes.
    await asSuperUser(db);
    await db.query(
      "delete from public.order_items where order_id = (select id from public.orders where code = 'OF-910')",
    );
    await db.query("delete from public.orders where code = 'OF-910'");
  });
});

// ---------------------------------------------------------------------------
// 025) Gestão de entregas CONSOLIDADA por OF — uma linha por pedido.
// ---------------------------------------------------------------------------

interface OrderRowResult {
  total_count: string;
  weight_total: string;
  qty_total: string;
  order_code: string;
  order_type: string;
  customer_name: string;
  order_status: string;
  delivery_date: string;
  quantity: string;
  weight_kg: string | null;
  overdue: boolean;
  processes: Record<
    string,
    {
      status: string;
      // count(*) e sum(inteiro) vêm como número no PGlite.
      done: number;
      applicable: number;
      quantityPlanned: number;
      quantityCompleted: number;
      // 031: só presente na célula concluída (maior conclusão da OF).
      completedAt: string | null;
    }
  >;
}

async function callOrderRows(params: Record<string, unknown> = {}): Promise<OrderRowResult[]> {
  const defaults: Record<string, unknown> = {
    p_search: null,
    p_order_status: null,
    p_process_code: null,
    p_process_status: null,
    p_delivery_filter: "ALL",
    p_today: TODAY,
    p_sort: "delivery_date",
    p_sort_dir: "asc",
    p_offset: 0,
    p_limit: 50,
    // filtros por coluna (sobre os TOTAIS da OF)
    p_order_code: null,
    p_customer: null,
    p_qty_min: null,
    p_qty_max: null,
    p_weight_min: null,
    p_weight_max: null,
    // período de entrega (sobre a data do PEDIDO)
    p_delivery_from: null,
    p_delivery_to: null,
    ...params,
  };

  const { rows } = await db.query<OrderRowResult>(
    `select
       total_count, weight_total, qty_total, order_id, order_code, order_type,
       customer_name, order_status,
       to_char(delivery_date, 'YYYY-MM-DD') as delivery_date,
       quantity, weight_kg, overdue, processes
     from public.get_production_rows_by_order(
       $1, $2, $3, $4, $5, $6::date, $7, $8, $9::int, $10::int,
       $11, $12, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
       $17::date, $18::date)`,
    [
      defaults.p_search,
      defaults.p_order_status,
      defaults.p_process_code,
      defaults.p_process_status,
      defaults.p_delivery_filter,
      defaults.p_today,
      defaults.p_sort,
      defaults.p_sort_dir,
      defaults.p_offset,
      defaults.p_limit,
      defaults.p_order_code,
      defaults.p_customer,
      defaults.p_qty_min,
      defaults.p_qty_max,
      defaults.p_weight_min,
      defaults.p_weight_max,
      defaults.p_delivery_from,
      defaults.p_delivery_to,
    ],
  );
  return rows;
}

describe("get_production_rows_by_order (025) — consolidada por OF", () => {
  // OF-801: vencida, com filhos da Fábrica 1 e um override de entrega
  // em item. OF-802: futura, com KIT não aplicável e LASER pendente.
  beforeAll(async () => {
    const order801 = await createOrder("OF-801", "2026-10-05");
    const order802 = await createOrder("OF-802", "2026-11-01");

    const paiA = await createRootItem(order801, "P-801A", "Treliça 801", 3, 10, [
      { code: "MP", status: "NAO_INICIADO" },
      // 039: o KIT do RAIZ é ignorado — ele passa a vir dos FILHOS.
      { code: "SOLDA", status: "NAO_INICIADO" },
      { code: "EXP", status: "NAO_INICIADO" },
    ]);
    await createRootItem(order801, "P-801B", "Porta 801", 2, 5, [
      { code: "MP", status: "CONCLUIDO" },
      { code: "SOLDA", status: "NAO_APLICAVEL" },
      { code: "EXP", status: "CONCLUIDO" },
    ]);

    // A cadeia da Fábrica 1 é rastreada nos FILHOS. O SOLDA lançado aqui no
    // filho NÃO vaza para a célula da OF (continua sendo o raiz que manda).
    // O KIT, desde a 039, passa a vir daQUI: C-801A concluído => célula
    // CONCLUIDO com a data efetiva maior entre os filhos aplicáveis.
    await createChild(order801, paiA, "C-801A", "Componente 801A", 3, [
      { code: "LASER", status: "CONCLUIDO" },
      { code: "SERRA", status: "NAO_INICIADO" },
      { code: "KIT", status: "CONCLUIDO" },
      { code: "SOLDA", status: "CONCLUIDO" },
    ]);
    await createChild(order801, paiA, "C-801B", "Componente 801B", 3, [
      { code: "LASER", status: "CONCLUIDO" },
    ]);

    const pai802 = await createRootItem(order802, "P-802A", "Grade 802", 4, 12.5, [
      // 039: o KIT do raiz é ignorado — só o do filho conta.
      { code: "EXP", status: "CONCLUIDO" },
    ]);
    await createChild(order802, pai802, "C-802A", "Componente 802A", 4, [
      { code: "LASER", status: "NAO_INICIADO" },
      { code: "KIT", status: "NAO_APLICAVEL" },
    ]);

    // Cliente próprio — os fixtures antigos compartilham "Metalúrgica Alfa".
    await db.query(
      `update public.orders set customer_name = 'Consolidada Silva' where code in ('OF-801', 'OF-802')`,
    );
  });

  it("consolida a OF em UMA linha com quantidade e peso somados", async () => {
    const rows = await callOrderRows({ p_search: "OF-8" });
    expect(rows.map((row) => row.order_code).sort()).toEqual(["OF-801", "OF-802"]);

    const of801 = rows.find((row) => row.order_code === "OF-801");
    // 3 + 2 das raiz (os FILHOS não somam: pertencem à raiz P-801A).
    expect(Number(of801?.quantity)).toBe(5);
    // 3 × 10 kg + 2 × 5 kg = 40 kg.
    expect(Number(of801?.weight_kg)).toBe(40);
    // A entrega exibida é a do PEDIDO.
    expect(of801?.delivery_date).toBe("2026-10-05");
    expect(of801?.customer_name).toBe("Consolidada Silva");
    expect(of801?.order_type).toBe("OF");

    const of802 = rows.find((row) => row.order_code === "OF-802");
    expect(Number(of802?.quantity)).toBe(4);
    expect(Number(of802?.weight_kg)).toBe(50); // 4 × 12,5 kg
  });

  it("expõe completedAt só na célula concluída da OF (031)", async () => {
    await db.query(
      `update public.production_processes pp set completed_at = timestamptz '2026-09-30 12:00:00+00'
         from public.processes p where p.id = pp.process_id and pp.status = 'CONCLUIDO'`,
    );

    const [of801] = await callOrderRows({ p_search: "OF-801" });
    // 039: o KIT vem dos FILHOS. C-801A concluído (C-801B não tem KIT) =>
    // célula CONCLUIDO com a data efetiva (maior conclusão entre filhos).
    expect(of801?.processes.KIT?.status).toBe("CONCLUIDO");
    expect(of801?.processes.KIT?.completedAt).toBeTruthy();
    // MP 1 de 2 concluído → célula NAO_INICIADO não mostra a data,
    // mesmo o registro concluído carregando completed_at.
    expect(of801?.processes.MP?.status).toBe("NAO_INICIADO");
    expect(of801?.processes.MP?.completedAt).toBeNull();
  });

  it("lê a cadeia F1 nos FILHOS e os demais processos nos RAIZ", async () => {
    const [of801] = await callOrderRows({ p_search: "OF-801" });

    // LASER vem dos filhos: CONCLUIDO + CONCLUIDO => tudo concluído (2/2).
    expect(of801?.processes.LASER).toMatchObject({
      status: "CONCLUIDO",
      done: 2,
      applicable: 2,
    });
    expect(of801?.processes.SERRA).toMatchObject({ status: "NAO_INICIADO", done: 0, applicable: 1 });

    // MP e SOLDA continuam vindo dos RAIZ: o SOLDA lançado no FILHO é
    // ignorado (não puxa a célula para "concluído").
    expect(of801?.processes.MP).toMatchObject({ status: "NAO_INICIADO", done: 1, applicable: 2 });
    expect(of801?.processes.SOLDA).toMatchObject({ status: "NAO_INICIADO", done: 0, applicable: 1 });
    // 039: o KIT agora vem dos FILHOS (o do raiz foi removido do seed) —
    // C-801A concluído e C-801B sem KIT => aplicável 1, concluído 1.
    expect(of801?.processes.KIT).toMatchObject({ status: "CONCLUIDO", done: 1, applicable: 1 });

    // EXP: um raiz expedido e outro não => pior situação + contador 1/2.
    expect(of801?.processes.EXP).toMatchObject({ status: "NAO_INICIADO", done: 1, applicable: 2 });
    // Soma das quantidades das raiz, só para exibição no tooltip.
    expect(of801?.processes.EXP.quantityPlanned).toBe(5);
  });

  it("processo 100% não aplicável vira NAO_APLICAVEL (célula \"—\")", async () => {
    const [of802] = await callOrderRows({ p_search: "OF-802" });
    // 039: o KIT vem dos FILHOS — o filho C-802A tem KIT não aplicável.
    expect(of802?.processes.KIT).toMatchObject({
      status: "NAO_APLICAVEL",
      done: 0,
      applicable: 0,
    });
    // LASER pendente vem do filho; EXP concluído vem da raiz.
    expect(of802?.processes.LASER).toMatchObject({ status: "NAO_INICIADO", done: 0, applicable: 1 });
    expect(of802?.processes.EXP).toMatchObject({ status: "CONCLUIDO", done: 1, applicable: 1 });
    // Códigos sem nenhum registro na OF não aparecem.
    expect(of802?.processes.MP).toBeUndefined();
  });

  it("aplica a regra de atraso POR OF (entrega vencida + EXP pendente)", async () => {
    const rows = await callOrderRows({ p_search: "OF-8", p_delivery_filter: "OVERDUE" });
    expect(rows.map((row) => row.order_code)).toEqual(["OF-801"]);

    const of801 = await callOrderRows({ p_search: "OF-801" });
    expect(of801[0]?.overdue).toBe(true);
    const of802 = await callOrderRows({ p_search: "OF-802" });
    expect(of802[0]?.overdue).toBe(false);
  });

  it("busca genérica casa código, cliente e descrição de QUALQUER item da OF", async () => {
    // Código do pedido.
    expect(await callOrderRows({ p_search: "OF-801" })).toHaveLength(1);
    // Cliente.
    expect(await callOrderRows({ p_search: "Consolidada" })).toHaveLength(2);
    // Descrição de um FILHO — a OF aparece mesmo sem bater nas raiz.
    const porFilho = await callOrderRows({ p_search: "Componente 801A" });
    expect(porFilho.map((row) => row.order_code)).toEqual(["OF-801"]);
    // Item pai (código externo) de uma raiz.
    expect(await callOrderRows({ p_search: "P-802A" })).toHaveLength(1);
  });

  it("faixas de quantidade e peso valem sobre os TOTAIS da OF", async () => {
    // OF-801 tem 5 peças/40 kg; OF-802 tem 4 peças/50 kg.
    expect(await callOrderRows({ p_search: "OF-8", p_qty_min: 5 })).toHaveLength(1);
    expect(await callOrderRows({ p_search: "OF-8", p_qty_max: 4 })).toHaveLength(1);
    expect(await callOrderRows({ p_search: "OF-8", p_weight_min: 41 })).toHaveLength(1);
    expect(await callOrderRows({ p_search: "OF-8", p_weight_max: 40 })).toHaveLength(1);

    const porPeso = await callOrderRows({ p_search: "OF-8", p_weight_min: 41 });
    expect(porPeso[0]?.order_code).toBe("OF-802");
  });

  it("filtra por processo/status considerando o escopo da coluna", async () => {
    const laserNaoIniciado = await callOrderRows({
      p_search: "OF-8",
      p_process_code: "LASER",
      p_process_status: "NAO_INICIADO",
    });
    expect(laserNaoIniciado.map((row) => row.order_code)).toEqual(["OF-802"]);

    // MP aplicável: só OF-801 tem nos raiz.
    const mp = await callOrderRows({ p_search: "OF-8", p_process_code: "MP" });
    expect(mp.map((row) => row.order_code)).toEqual(["OF-801"]);

    // KIT 100% não aplicável não conta como aplicável (sem status).
    const kit = await callOrderRows({ p_search: "OF-8", p_process_code: "KIT" });
    expect(kit.map((row) => row.order_code)).toEqual(["OF-801"]);
  });

  it("ordena por peso total e por coluna de processo", async () => {
    const porPeso = await callOrderRows({ p_search: "OF-8", p_sort: "weight_total", p_sort_dir: "desc" });
    expect(porPeso.map((row) => row.order_code)).toEqual(["OF-802", "OF-801"]);

    // LASER: CONCLUIDO (rank 1) antes de NAO_INICIADO (rank 2).
    const porLaser = await callOrderRows({ p_search: "OF-8", p_sort: "LASER", p_sort_dir: "asc" });
    expect(porLaser.map((row) => row.order_code)).toEqual(["OF-801", "OF-802"]);

    // Chave desconhecida não quebra (cai na entrega).
    const invalida = await callOrderRows({ p_search: "OF-8", p_sort: "'; drop table orders; --" });
    expect(invalida).toHaveLength(2);
  });

  it("pagina mantendo o total e as somas da lista filtrada", async () => {
    const page1 = await callOrderRows({ p_search: "OF-8", p_limit: 1, p_offset: 0 });
    const page2 = await callOrderRows({ p_search: "OF-8", p_limit: 1, p_offset: 1 });
    expect(page1).toHaveLength(1);
    expect(page2).toHaveLength(1);
    // As somas vêm de TODAS as OFs filtradas, não só da página.
    expect(Number(page1[0]?.total_count)).toBe(2);
    expect(Number(page1[0]?.qty_total)).toBe(9);
    expect(Number(page1[0]?.weight_total)).toBe(90);
  });

  it("entrega exibida é a do PEDIDO — override do item fica intacto", async () => {
    // Mesmo com um item em entrega diferente, a linha mostra a data do pedido
    // (a data por item continua na Fábrica 2 e no detalhe do pedido).
    await db.query(
      `update public.order_items set delivery_date = '2026-12-31' where parent_item = 'P-801A'`,
    );
    const [of801] = await callOrderRows({ p_search: "OF-801" });
    expect(of801?.delivery_date).toBe("2026-10-05");
    await db.query(
      `update public.order_items set delivery_date = null where parent_item = 'P-801A'`,
    );
  });
});

describe("get_child_item_groups (033) — grupos por código do filho", () => {
  let ofGrp1: string;
  let ofGrp2: string;
  let laserId: string;

  // OF-9001: dois pais com o MESMO filho (grupo de 2), um filho único e um
  // sem código (agrupa pela descrição). OF-9002: repete o código da outra
  // OF — grupos nunca podem atravessar pedidos.
  beforeAll(async () => {
    await asSuperUser(db);
    ofGrp1 = await createOrder("OF-9001", "2026-10-20");
    ofGrp2 = await createOrder("OF-9002", "2026-11-01");

    const paiA = await createRootItem(ofGrp1, "P-901A", "Treliça 901", 3, 10, [
      { code: "KIT", status: "NAO_INICIADO" },
    ]);
    const paiB = await createRootItem(ofGrp1, "P-901B", "Porta 901", 2, 5, [
      { code: "KIT", status: "NAO_INICIADO" },
    ]);
    await createChild(ofGrp1, paiA, "CH-1", "SUPORTE 90", 2, [
      { code: "LASER", status: "CONCLUIDO" },
    ]);
    await createChild(ofGrp1, paiB, "CH-1", "SUPORTE 90", 3, [
      { code: "LASER", status: "NAO_INICIADO" },
    ]);
    await createChild(ofGrp1, paiA, "CH-2", "PARAFUSO M8", 1, [
      { code: "LASER", status: "NAO_INICIADO" },
    ]);
    // Código vazio => a chave do grupo vira a descrição.
    await createChild(ofGrp1, paiA, "", "SEM CODIGO", 5, []);

    const paiC = await createRootItem(ofGrp2, "P-902A", "Grade 902", 4, 12.5, [
      { code: "KIT", status: "NAO_INICIADO" },
    ]);
    await createChild(ofGrp2, paiC, "CH-1", "SUPORTE 90", 9, [
      { code: "LASER", status: "NAO_INICIADO" },
    ]);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.processes where code = 'LASER'`,
    );
    laserId = rows[0]?.id as string;
  });

  async function callGroups(
    params: Record<string, unknown> = {},
  ): Promise<
    { total: number; groups: { orderId: string; key: string; itemIds: string[] }[] } | undefined
  > {
    const defaults: Record<string, unknown> = {
      p_search: null,
      p_order_code: null,
      p_customer: null,
      p_child_item: null,
      p_description: null,
      p_material: null,
      p_parent_ids: null,
      p_delivery_from: null,
      p_delivery_to: null,
      p_process_id: null,
      p_process_status: null,
      p_offset: 0,
      p_limit: 25,
      ...params,
    };
    const { rows } = await db.query<{
      data: { total: number; groups: { orderId: string; key: string; itemIds: string[] }[] };
    }>(
      `select public.get_child_item_groups(
         $1, $2, $3, $4, $5, $6, $7::uuid[], $8::date, $9::date, $10::uuid, $11, $12::int, $13::int
       ) as data`,
      [
        defaults.p_search,
        defaults.p_order_code,
        defaults.p_customer,
        defaults.p_child_item,
        defaults.p_description,
        defaults.p_material,
        defaults.p_parent_ids,
        defaults.p_delivery_from,
        defaults.p_delivery_to,
        defaults.p_process_id,
        defaults.p_process_status,
        defaults.p_offset,
        defaults.p_limit,
      ],
    );
    return rows[0]?.data;
  }

  it("agrupa por código dentro da OF: mesmo filho em dois pais vira 1 grupo", async () => {
    const data = await callGroups({ p_order_code: "OF-9001" });
    expect(Number(data?.total)).toBe(3);

    const ch1 = data?.groups.find((group) => group.key === "CH-1");
    expect(ch1?.orderId).toBe(ofGrp1);
    expect(ch1?.itemIds).toHaveLength(2); // os dois pais, numa linha só
    // Ordenação: entrega (todas iguais) => chave asc.
    expect(data?.groups.map((group) => group.key)).toEqual([
      "CH-1",
      "CH-2",
      "SEM CODIGO",
    ]);
  });

  it("código vazio agrupa pela descrição (fallback)", async () => {
    const data = await callGroups({ p_order_code: "OF-9001" });
    const semCodigo = data?.groups.find((group) => group.key === "SEM CODIGO");
    expect(semCodigo?.itemIds).toHaveLength(1);
  });

  it("nunca atravessa OFs: o mesmo código segue em grupos separados", async () => {
    const porCodigo = await callGroups({ p_child_item: "CH-1" });
    expect(Number(porCodigo?.total)).toBe(2); // 1 grupo por OF, nunca um só
    expect(porCodigo?.groups.map((group) => group.orderId).sort()).toEqual(
      [ofGrp1, ofGrp2].sort(),
    );

    const daSegunda = await callGroups({ p_order_code: "OF-9002" });
    expect(daSegunda?.groups).toHaveLength(1);
    expect(daSegunda?.groups[0]?.itemIds).toHaveLength(1);
  });

  it("pagina por grupos mantendo o total do conjunto", async () => {
    const page = await callGroups({ p_order_code: "OF-9001", p_limit: 1, p_offset: 1 });
    expect(page?.groups).toHaveLength(1);
    expect(page?.groups[0]?.key).toBe("CH-2");
    expect(Number(page?.total)).toBe(3); // total é do conjunto, não da página

    const vazia = await callGroups({ p_order_code: "OF-9001", p_limit: 1, p_offset: 99 });
    expect(vazia?.groups).toHaveLength(0);
    expect(Number(vazia?.total)).toBe(3);
  });

  it("o filtro de processo escolhe os MEMBROS: o grupo volta só com quem casou", async () => {
    const data = await callGroups({
      p_order_code: "OF-9001",
      p_process_id: laserId,
      p_process_status: "CONCLUIDO",
    });
    expect(Number(data?.total)).toBe(1); // só CH-1 tem membro LASER concluído
    expect(data?.groups[0]?.key).toBe("CH-1");
    expect(data?.groups[0]?.itemIds).toHaveLength(1); // só o membro concluído
  });
});
