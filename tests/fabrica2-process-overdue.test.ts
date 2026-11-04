import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessCell, ProductionResult, ProductionRow, ProcessDefinition } from "@/lib/types/production";
import { parseProductionFilters } from "@/lib/utils/filters";
import { isProcessOverdue } from "@/lib/utils/production";

/**
 * 051 — opção "Atrasados" dos filtros de PROCESSO da Fábrica 2:
 *
 *  - a REGRA: início previsto da janela anterior à data de referência e o
 *    processo ainda não concluído (a mesma data que a célula pinta de
 *    vermelho); por coluna ou por qualquer processo (filtro do grupo);
 *  - o RECORTE: varredura do conjunto filtrado inteiro + paginação em
 *    memória, combinando por E com o "Atrasados" do ACAB (`entrega=OVERDUE`).
 *
 * Entrega em 2020 (janelas vencidas) e em 2099 (janela futura): os casos
 * ficam estáveis em qualquer data de execução.
 */

vi.mock("server-only", () => ({}));

const { getProductionRowsMock, getActiveProcessesMock } = vi.hoisted(() => ({
  getProductionRowsMock: vi.fn(),
  getActiveProcessesMock: vi.fn(),
}));

vi.mock("@/lib/repositories/production.repository", () => ({
  getActiveProcesses: getActiveProcessesMock,
  getProductionRows: getProductionRowsMock,
  getEventsByItemId: vi.fn(),
  getOrderProcessTargets: vi.fn(),
  getProductionOrderRows: vi.fn(),
  getProductionProcessById: vi.fn(),
  getProductionStats: vi.fn(),
  getAndLockProcessState: vi.fn(),
  insertProductionEvent: vi.fn(),
  updateProductionProcess: vi.fn(),
}));

vi.mock("@/lib/repositories/order-items.repository", () => ({
  getItemAggregate: vi.fn(),
  getItemProcessChain: vi.fn(),
  refreshOrderStatuses: vi.fn(),
}));

const { getProductionPage } = await import("@/lib/services/production.service");

const CATALOG: ProcessDefinition[] = [
  { id: "p-acab", code: "ACAB", name: "ACAB", displayOrder: 110, active: true, location: null, durationDays: 2 },
  { id: "p-qual", code: "QUALITY", name: "QUALITY", displayOrder: 120, active: true, location: null, durationDays: 1 },
  { id: "p-exp", code: "EXP", name: "EXP", displayOrder: 130, active: true, location: null, durationDays: 1 },
];

/** Data de referência dos testes de regra (depois de 2020 e antes de 2099). */
const TODAY = "2026-10-20";

type Status = ProcessCell["status"];

function cell(status: Status): ProcessCell {
  return {
    id: `pp-${status}`,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
  };
}

interface RowOptions {
  id: string;
  deliveryDate: string | null;
  quantity?: number;
  unitWeightKg?: number | null;
  acab?: Status;
  /** null = célula ausente no item (a tabela mostra "—"). */
  qual?: Status | null;
  exp?: Status;
}

function row({
  id,
  deliveryDate,
  quantity = 1,
  unitWeightKg = null,
  acab = "NAO_INICIADO",
  qual = "NAO_INICIADO",
  exp = "NAO_INICIADO",
}: RowOptions): ProductionRow {
  const processes: Record<string, ProcessCell> = {
    ACAB: cell(acab),
    EXP: cell(exp),
  };
  if (qual !== null) processes.QUALITY = cell(qual);

  return {
    orderItemId: id,
    orderId: "order",
    orderCode: "OF TT10",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    family: "GUARDA CORPO",
    parentItem: "10GC45",
    description: "SUPORTE",
    quantity,
    unitWeightKg,
    deliveryDate,
    itemStatus: "EM_PRODUCAO",
    op: null,
    overdue: false,
    seq: null,
    processes,
  };
}

function result(rows: ProductionRow[], total = rows.length): ProductionResult {
  return {
    rows,
    total,
    weightTotal: 0,
    qtyTotal: 0,
    overdue: { records: 0, qty: 0, weight: 0 },
    expedition: { records: 0, qty: 0, weight: 0 },
  };
}

/** Entrega vencida: as três janelas caem em 06–09/01/2020. */
const atraso = row({ id: "atraso", deliveryDate: "2020-01-10", quantity: 4, unitWeightKg: 1.5 });
/** Entrega vencida, mas o QUALITY já concluído (não pode contar como atrasado). */
const qualConcluido = row({
  id: "qual-concluido",
  deliveryDate: "2020-01-10",
  quantity: 2,
  qual: "CONCLUIDO",
});
/** Entrega vencida com ACAB+EXP concluídos: fora do card do ACAB, dentro do de processos. */
const acabOk = row({
  id: "acab-ok",
  deliveryDate: "2020-01-10",
  quantity: 3,
  unitWeightKg: 2,
  acab: "CONCLUIDO",
  exp: "CONCLUIDO",
});
/** Entrega futura: nenhuma janela venceu. */
const futuro = row({ id: "futuro", deliveryDate: "2099-01-02" });

const ALL_ROWS = [atraso, qualConcluido, acabOk, futuro];

beforeEach(() => {
  getActiveProcessesMock.mockReset();
  getProductionRowsMock.mockReset();
  getActiveProcessesMock.mockResolvedValue(CATALOG);
});

describe("isProcessOverdue — regra do filtro 'Atrasados' (051)", () => {
  it("marca o processo cujo início previsto já passou e que não concluiu", () => {
    expect(isProcessOverdue(atraso, CATALOG, "QUALITY", TODAY)).toBe(true);
    expect(isProcessOverdue(atraso, CATALOG, "ACAB", TODAY)).toBe(true);
  });

  it("não marca processo concluído, não aplicável, ausente ou sem entrega", () => {
    expect(isProcessOverdue(qualConcluido, CATALOG, "QUALITY", TODAY)).toBe(false);
    expect(
      isProcessOverdue(row({ id: "na", deliveryDate: "2020-01-10", qual: "NAO_APLICAVEL" }), CATALOG, "QUALITY", TODAY),
    ).toBe(false);
    expect(
      isProcessOverdue(row({ id: "sem-celula", deliveryDate: "2020-01-10", qual: null }), CATALOG, "QUALITY", TODAY),
    ).toBe(false);
    expect(isProcessOverdue(row({ id: "sem-entrega", deliveryDate: null }), CATALOG, "QUALITY", TODAY)).toBe(false);
    expect(isProcessOverdue(futuro, CATALOG, "QUALITY", TODAY)).toBe(false);
  });

  it("com 'ALL' vale qualquer processo aplicável do item", () => {
    // QUALITY concluído, mas ACAB/EXP ainda vencidos → atrasado no grupo.
    expect(isProcessOverdue(qualConcluido, CATALOG, "ALL", TODAY)).toBe(true);
    // Entrega futura: nada venceu.
    expect(isProcessOverdue(futuro, CATALOG, "ALL", TODAY)).toBe(false);
    // Só processos concluídos/não aplicáveis: nenhum atraso.
    expect(
      isProcessOverdue(
        row({
          id: "tudo-ok",
          deliveryDate: "2020-01-10",
          acab: "CONCLUIDO",
          qual: "CONCLUIDO",
          exp: "CONCLUIDO",
        }),
        CATALOG,
        "ALL",
        TODAY,
      ),
    ).toBe(false);
  });
});

describe("getProductionPage — filtro de processo 'Atrasados' (051)", () => {
  it("no grupo, recorta os itens com QUALQUER processo vencido", async () => {
    getProductionRowsMock.mockResolvedValue(result(ALL_ROWS));

    const page = await getProductionPage({} as never, parseProductionFilters({ procsatrasado: "1" }));

    expect(page.rows.map((item) => item.orderItemId)).toEqual(["atraso", "qual-concluido", "acab-ok"]);
    expect(page.total).toBe(3);
    expect(page.qtyTotal).toBe(9);
    expect(page.weightTotal).toBe(12);
    // Cards acompanham o recorte: ACAB vencido só em dois deles…
    expect(page.overdue).toEqual({ records: 2, qty: 6, weight: 6 });
    // …e a EXPEDIÇÃO concluída, no único que restou com ela marcada.
    expect(page.expedition).toEqual({ records: 1, qty: 3, weight: 6 });
  });

  it("na coluna, recorta só o processo escolhido (e o manda à RPC)", async () => {
    getProductionRowsMock.mockResolvedValue(result(ALL_ROWS));

    const page = await getProductionPage(
      {} as never,
      parseProductionFilters({ processo: "QUALITY", procsatrasado: "1" }),
    );

    // A RPC já reduz o conjunto ao item que TEM o processo (situação = ALL);
    // o recorte de data continua em memória.
    expect(getProductionRowsMock).toHaveBeenCalled();
    const rpcFilters = getProductionRowsMock.mock.calls[0][1] as {
      processCode: string;
      processStatus: string;
    };
    expect(rpcFilters.processCode).toBe("QUALITY");
    expect(rpcFilters.processStatus).toBe("ALL");

    // QUALITY vencido em "atraso" e "acab-ok"; "qual-concluido" ficou de fora.
    expect(page.rows.map((item) => item.orderItemId)).toEqual(["atraso", "acab-ok"]);
    expect(page.total).toBe(2);
    expect(page.qtyTotal).toBe(7);
    expect(page.weightTotal).toBe(12);
  });

  it("pagina em memória sobre o recorte (a página da tela não vem da RPC)", async () => {
    getProductionRowsMock.mockResolvedValue(result(ALL_ROWS));

    const page = await getProductionPage(
      {} as never,
      parseProductionFilters({ procsatrasado: "1", pagina: "2", porpagina: "2" }),
    );

    expect(page.total).toBe(3);
    expect(page.rows.map((item) => item.orderItemId)).toEqual(["acab-ok"]);
    for (const call of getProductionRowsMock.mock.calls) {
      expect((call[1] as { pageSize: number }).pageSize).toBe(1000);
    }
  });

  it("combina por E com o 'Atrasados' do ACAB (entrega=OVERDUE)", async () => {
    getProductionRowsMock.mockResolvedValue(result(ALL_ROWS));

    const page = await getProductionPage(
      {} as never,
      parseProductionFilters({ procsatrasado: "1", entrega: "OVERDUE" }),
    );

    // O recorte antigo do banco é desligado para a comparação do ACAB em memória.
    for (const call of getProductionRowsMock.mock.calls) {
      expect((call[1] as { delivery: string }).delivery).toBe("ALL");
    }

    // Interseção: processos vencidos E ACAB vencido (o "acab-ok" sai aqui).
    expect(page.rows.map((item) => item.orderItemId)).toEqual(["atraso", "qual-concluido"]);
    expect(page.total).toBe(2);
    expect(page.qtyTotal).toBe(6);
    expect(page.weightTotal).toBe(6);
    expect(page.overdue).toEqual({ records: 2, qty: 6, weight: 6 });
  });
});
