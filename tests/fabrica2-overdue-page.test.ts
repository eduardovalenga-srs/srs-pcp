import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductionResult, ProductionRow, ProcessDefinition } from "@/lib/types/production";
import { parseProductionFilters } from "@/lib/utils/filters";

/**
 * Página da Fábrica 2: o card "Atrasados" usa a data da coluna ACAB e, com o
 * filtro ligado (`entrega=OVERDUE`), a lista é o próprio recorte — varredura
 * do conjunto filtrado inteiro, paginação em memória e totais consistentes.
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

function cell(status: "NAO_INICIADO" | "CONCLUIDO" | "NAO_APLICAVEL") {
  return {
    id: `pp-${status}`,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
  };
}

function row(
  overrides: Partial<ProductionRow> & {
    acab?: "NAO_INICIADO" | "CONCLUIDO" | "NAO_APLICAVEL";
    exp?: "NAO_INICIADO" | "CONCLUIDO";
  } = {},
): ProductionRow {
  const { acab = "NAO_INICIADO", exp = "NAO_INICIADO", ...rest } = overrides;
  return {
    orderItemId: rest.orderItemId ?? "item",
    orderId: "order",
    orderCode: "OF TT10",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    family: "GUARDA CORPO",
    parentItem: "10GC45",
    description: "SUPORTE",
    quantity: 1,
    unitWeightKg: null,
    deliveryDate: "2020-01-10",
    itemStatus: "EM_PRODUCAO",
    op: null,
    overdue: false,
    seq: null,
    processes: {
      ACAB: cell(acab),
      QUALITY: cell("NAO_INICIADO"),
      EXP: cell(exp),
    },
    ...rest,
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

/** Entrega no passado: ACAB (como os demais processos) fica vencido. */
const vencido1 = row({ orderItemId: "vencido-1", quantity: 4, unitWeightKg: 1.5 });
const vencido2 = row({ orderItemId: "vencido-2", quantity: 2 });
const vencido3 = row({ orderItemId: "vencido-3", quantity: 3, unitWeightKg: 2, exp: "CONCLUIDO" });
/** ACAB já concluído: data passada é esperada, não conta como atraso. */
const concluido = row({ orderItemId: "concluido", deliveryDate: "2020-01-10", acab: "CONCLUIDO" });
/** Entrega futura: ACAB ainda não venceu. */
const futuro = row({ orderItemId: "futuro", deliveryDate: "2099-01-02" });

const ALL_ROWS = [vencido1, vencido2, vencido3, concluido, futuro];

beforeEach(() => {
  getActiveProcessesMock.mockReset();
  getProductionRowsMock.mockReset();
  getActiveProcessesMock.mockResolvedValue(CATALOG);
});

describe("getProductionPage — card Atrasados pela data do ACAB", () => {
  it("calcula o card sobre o conjunto filtrado inteiro (sem o filtro ligado)", async () => {
    getProductionRowsMock.mockImplementation(
      async (_client: unknown, filters: { pageSize: number }) =>
        filters.pageSize === 1000 ? result(ALL_ROWS) : result(ALL_ROWS.slice(0, 2), ALL_ROWS.length),
    );

    const page = await getProductionPage({} as never, parseProductionFilters({}));

    // Recorte do ACAB: só os três itens com ACAB vencido e não concluído.
    expect(page.overdue).toEqual({ records: 3, qty: 9, weight: 12 });
    // A página continua vindo da RPC, com os filtros do usuário.
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(5);
  });

  it("com entrega=OVERDUE a lista é o recorte do ACAB, paginado em memória", async () => {
    getProductionRowsMock.mockResolvedValue(result(ALL_ROWS));

    const page = await getProductionPage(
      {} as never,
      parseProductionFilters({ entrega: "OVERDUE", pagina: "2", porpagina: "2" }),
    );

    // O recorte antigo do banco é desligado para não perder itens antes da
    // comparação da data do ACAB.
    for (const call of getProductionRowsMock.mock.calls) {
      expect((call[1] as { delivery: string }).delivery).toBe("ALL");
    }

    expect(page.total).toBe(3);
    expect(page.rows).toEqual([vencido3]);
    expect(page.overdue).toEqual({ records: 3, qty: 9, weight: 12 });
    expect(page.qtyTotal).toBe(9);
    expect(page.weightTotal).toBe(12);
    // Expedição dentro do recorte: só o item com EXP concluída.
    expect(page.expedition).toEqual({ records: 1, qty: 3, weight: 6 });
  });

  it("a varredura usa páginas de exportação (não a página da tela)", async () => {
    getProductionRowsMock.mockResolvedValue(result(ALL_ROWS));

    await getProductionPage({} as never, parseProductionFilters({ entrega: "OVERDUE" }));

    expect(getProductionRowsMock).toHaveBeenCalled();
    for (const call of getProductionRowsMock.mock.calls) {
      expect((call[1] as { pageSize: number }).pageSize).toBe(1000);
    }
  });
});
