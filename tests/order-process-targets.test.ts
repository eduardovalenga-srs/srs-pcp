import { describe, expect, it } from "vitest";

import { getOrderProcessTargets } from "@/lib/repositories/production.repository";

/**
 * REGRESSÃO DO ESCOPO DA EDIÇÃO EM LOTE (025 + 039).
 *
 * A RPC `get_production_rows_by_order` lê a coluna KIT dos ITENS FILHOS
 * (migration 039 — `scoped_rows` inclui 'KIT' no escopo de filho). A gravação
 * do lote precisava espelhar isso: antes a comparação usava só
 * `F1_PROCESS_CODES` (sem KIT), o lote caía nos itens RAIZ — onde o KIT é
 * sempre NAO_APLICAVEL (backfill 022 + import 032) — e a Gestão de OF falhava
 * com "Nenhum item desta OF tem este processo aplicável."
 *
 * Estes testes exercitam o repositório de verdade (cliente Supabase simulado),
 * porque é ali que mora a decisão de escopo raiz x filho.
 */

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Registro de uma cadeia de consulta, para asserir o escopo escolhido. */
interface QueryCall {
  table: string;
  /** Métodos chamados na cadeia, com os argumentos relevantes. */
  chain: string[];
}

interface TableRows {
  [table: string]: unknown[];
}

/**
 * Cliente Supabase simulado: `from()` devolve um builder encadeável que aplica
 * os filtros `eq`/`in` sobre as linhas preparadas — como o PostgREST faria.
 * Cada cadeia é registrada em `calls`.
 *
 * `extra` enfileira respostas explícitas (processo inexistente, erro de banco),
 * usadas pelos testes que não seguem o fluxo de filtragem.
 */
function createClient(rowsByTable: TableRows, extra: QueryResult[] = []) {
  const queue = [...extra];
  const calls: QueryCall[] = [];

  const client = {
    from(table: string) {
      const call: QueryCall = { table, chain: [] };
      calls.push(call);

      const filters: { column: string; values: unknown[]; op: "eq" | "in" }[] = [];
      let single = false;

      const exec = (): QueryResult => {
        if (queue.length > 0) {
          const scripted = queue.shift();
          if (scripted) return scripted;
        }

        const rows = (rowsByTable[table] ?? []).filter((row) =>
          filters.every((filter) =>
            filter.op === "eq"
              ? (row as Record<string, unknown>)[filter.column] === filter.values[0]
              : filter.values.includes((row as Record<string, unknown>)[filter.column]),
          ),
        );
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      };

      const builder: Record<string, unknown> = {};
      builder.select = (...args: unknown[]) => {
        call.chain.push(`select(${args.join(", ")})`);
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        call.chain.push(`eq(${column}, ${String(value)})`);
        filters.push({ column, values: [value], op: "eq" });
        return builder;
      };
      builder.in = (column: string, values: unknown[]) => {
        call.chain.push(`in(${column}, [${values.join(",")}])`);
        filters.push({ column, values, op: "in" });
        return builder;
      };
      builder.maybeSingle = () => {
        single = true;
        return Promise.resolve(exec());
      };
      // Await direto da cadeia (sem `maybeSingle`) também resolve.
      builder.then = (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected: (reason: unknown) => unknown,
      ) => Promise.resolve(exec()).then(onFulfilled, onRejected);

      return builder;
    },
  };

  return { client: client as never, calls };
}

/**
 * Uma OF com 1 processo no catálogo, 1 item raiz e 2 filhos — cada um com a
 * linha daquele processo.
 *
 * `statusNoRaiz` costuma ser NAO_APLICAVEL: o backfill (022) nasce assim para
 * tudo menos MP, e o import (032) só marca o KIT como NAO_INICIADO no FILHO.
 */
function ofComDoisFilhos(processCode: string, statusNoRaiz: string, statusNosFilhos: string) {
  return createClient({
    processes: [{ id: "proc-1", code: processCode }],
    order_items: [
      { id: "root-1", parent_order_item_id: null, order_id: "of-1" },
      { id: "child-1", parent_order_item_id: "root-1", order_id: "of-1" },
      { id: "child-2", parent_order_item_id: "root-1", order_id: "of-1" },
    ],
    production_processes: [
      { id: "pp-root", order_item_id: "root-1", process_id: "proc-1", status: statusNoRaiz, quantity_planned: 10, quantity_completed: 0, notes: null },
      { id: "pp-child-1", order_item_id: "child-1", process_id: "proc-1", status: statusNosFilhos, quantity_planned: 5, quantity_completed: 2, notes: "filho 1" },
      { id: "pp-child-2", order_item_id: "child-2", process_id: "proc-1", status: statusNosFilhos, quantity_planned: 5, quantity_completed: 0, notes: null },
    ],
  });
}

/** Ids passados ao `.in("order_item_id", …)` da consulta de processos. */
function itemIdsConsultados(calls: QueryCall[]): string[] {
  const inCall = calls
    .find((call) => call.table === "production_processes")
    ?.chain.find((entry) => entry.startsWith("in("));
  const match = inCall?.match(/order_item_id, \[([^\]]*)\]/);
  return match ? match[1].split(",").map((id) => id.trim()) : [];
}

describe("getOrderProcessTargets — escopo raiz x filho (025 + 039)", () => {
  it("KIT grava nos ITENS FILHOS (espelha a coluna exibida da gestão de OF)", async () => {
    const { client, calls } = ofComDoisFilhos("KIT", "NAO_APLICAVEL", "NAO_INICIADO");

    const targets = await getOrderProcessTargets(client, "of-1", "KIT");

    // O alvo é o escopo dos filhos — nunca o raiz, onde o KIT é NAO_APLICAVEL.
    expect(itemIdsConsultados(calls)).toEqual(["child-1", "child-2"]);
    expect(targets.map((target) => target.orderItemId)).toEqual(["child-1", "child-2"]);
  });

  it("KIT concluído nos filhos volta como aplicável, com quantidades e observações", async () => {
    const { client } = ofComDoisFilhos("KIT", "NAO_APLICAVEL", "CONCLUIDO");

    const targets = await getOrderProcessTargets(client, "of-1", "KIT");

    expect(targets).toHaveLength(2);
    expect(targets.every((target) => target.status === "CONCLUIDO")).toBe(true);
    // Só a situação muda no lote — quantidades/observações são preservadas.
    expect(targets.find((target) => target.orderItemId === "child-1")).toMatchObject({
      id: "pp-child-1",
      quantityPlanned: 5,
      quantityCompleted: 2,
      notes: "filho 1",
    });
  });

  it("a cadeia F1 (LASER) também grava nos filhos", async () => {
    const { client, calls } = ofComDoisFilhos("LASER", "NAO_APLICAVEL", "NAO_INICIADO");

    await getOrderProcessTargets(client, "of-1", "LASER");

    expect(itemIdsConsultados(calls)).toEqual(["child-1", "child-2"]);
  });

  it("todos os códigos da cadeia F1 têm escopo de filho", async () => {
    const f1Codes = ["LASER", "DB_CH", "SERRA", "DB_TB", "PUNC", "METALEIRA", "FICEP"];

    for (const code of f1Codes) {
      const { client, calls } = ofComDoisFilhos(code, "NAO_APLICAVEL", "NAO_INICIADO");

      await getOrderProcessTargets(client, "of-1", code);

      expect(itemIdsConsultados(calls), `escopo do ${code}`).toEqual(["child-1", "child-2"]);
    }
  });

  it("MP grava nos ITENS RAIZ", async () => {
    const { client, calls } = ofComDoisFilhos("MP", "NAO_INICIADO", "NAO_APLICAVEL");

    const targets = await getOrderProcessTargets(client, "of-1", "MP");

    expect(itemIdsConsultados(calls)).toEqual(["root-1"]);
    expect(targets.map((target) => target.orderItemId)).toEqual(["root-1"]);
  });

  it("processo pós-KIT (SOLDA) grava nos ITENS RAIZ", async () => {
    const { client, calls } = ofComDoisFilhos("SOLDA", "NAO_INICIADO", "NAO_APLICAVEL");

    await getOrderProcessTargets(client, "of-1", "SOLDA");

    expect(itemIdsConsultados(calls)).toEqual(["root-1"]);
  });

  it("escopo explícito (033) usa os ids informados e ignora a separação raiz/filho", async () => {
    const { client, calls } = ofComDoisFilhos("KIT", "NAO_APLICAVEL", "NAO_INICIADO");

    const targets = await getOrderProcessTargets(client, "of-1", "KIT", ["root-1"]);

    // Sem consulta a order_items: o escopo veio do chamador (Fábrica 1, 033).
    expect(calls.map((call) => call.table)).toEqual(["processes", "production_processes"]);
    expect(itemIdsConsultados(calls)).toEqual(["root-1"]);
    expect(targets.map((target) => target.orderItemId)).toEqual(["root-1"]);
  });

  it("processo inexistente no catálogo devolve lista vazia sem consultar itens", async () => {
    const { client, calls } = createClient({}, [{ data: null, error: null }]);

    const targets = await getOrderProcessTargets(client, "of-1", "INEXISTENTE");

    expect(targets).toEqual([]);
    expect(calls.map((call) => call.table)).toEqual(["processes"]);
  });

  it("OF sem itens devolve lista vazia", async () => {
    const { client, calls } = createClient({
      processes: [{ id: "proc-1", code: "KIT" }],
      order_items: [],
    });

    const targets = await getOrderProcessTargets(client, "of-1", "KIT");

    expect(targets).toEqual([]);
    // Sem itens não há por onde consultar production_processes.
    expect(calls.map((call) => call.table)).toEqual(["processes", "order_items"]);
  });

  it("propaga erro do banco com mensagem amigável", async () => {
    const { client } = createClient(
      { processes: [], order_items: [], production_processes: [] },
      // 1ª resposta: o processo existe; 2ª: a consulta de itens falha.
      [
        { data: { id: "proc-1", code: "KIT" }, error: null },
        { data: null, error: { message: "permission denied" } },
      ],
    );

    await expect(getOrderProcessTargets(client, "of-1", "KIT")).rejects.toThrow(
      "Não foi possível carregar os itens da OF: permission denied",
    );
  });
});
