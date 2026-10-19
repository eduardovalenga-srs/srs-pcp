import { describe, expect, it } from "vitest";

import type { ChildItemProcess } from "@/lib/types/order";
import type { OrderProcessCell, ProcessCell, ProcessDefinition } from "@/lib/types/production";
import type { ProcessStatus } from "@/lib/constants/production";
import {
  childItemProposalDate,
  computeProposalDate,
  itemProposalDate,
  orderProposalDate,
  ordersProposalDates,
} from "@/lib/utils/proposal-date";

/**
 * DATA DE PROPOSTA (DP): com a MP pendente, hoje + Σ das durações dos
 * processos aplicáveis (sem o próprio MP) em dias úteis.
 *
 * Calendário: TODAY = 2026-10-19 (segunda).
 */
const TODAY = "2026-10-19";

const CATALOG: ProcessDefinition[] = [
  { id: "p-mp", code: "MP", name: "Matéria-prima", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "p-laser", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 3 },
  { id: "p-kit", code: "KIT", name: "KIT", displayOrder: 80, active: true, location: null, durationDays: 4 },
  { id: "p-solda", code: "SOLDA", name: "SOLDA", displayOrder: 100, active: true, location: null, durationDays: 2 },
  { id: "p-exp", code: "EXP", name: "EXPEDIÇÃO", displayOrder: 130, active: true, location: null, durationDays: 1 },
];

function orderCell(overrides: Partial<OrderProcessCell> = {}): OrderProcessCell {
  return {
    status: "NAO_INICIADO",
    done: 0,
    applicable: 1,
    quantityPlanned: null,
    quantityCompleted: null,
    completedAt: null,
    ...overrides,
  };
}

function itemCell(overrides: Partial<ProcessCell> = {}): ProcessCell {
  return {
    id: "pp1",
    status: "NAO_INICIADO",
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
    ...overrides,
  };
}

function childProcess(code: string, status: ProcessStatus): ChildItemProcess {
  return {
    id: `cp-${code}`,
    code,
    name: code,
    displayOrder: 10,
    status,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
  };
}

describe("computeProposalDate", () => {
  it("sem MP pendente não há o que propor", () => {
    expect(computeProposalDate(TODAY, false, [{ code: "SOLDA", durationDays: 2 }])).toBeNull();
  });

  it("soma as durações em dias úteis a partir de hoje", () => {
    // Seg 19/10 + 5 dias úteis (LASER 3 + SOLDA 2) = seg 26/10.
    expect(
      computeProposalDate(TODAY, true, [
        { code: "LASER", durationDays: 3 },
        { code: "SOLDA", durationDays: 2 },
      ]),
    ).toBe("2026-10-26");
  });

  it("duração inválida vale 1 dia útil (mesma regra das janelas)", () => {
    expect(computeProposalDate(TODAY, true, [{ code: "X", durationDays: 0 }])).toBe("2026-10-20");
  });

  it("MP pendente sem outros processos propõe o próprio hoje", () => {
    expect(computeProposalDate(TODAY, true, [])).toBe(TODAY);
  });
});

describe("orderProposalDate (gestão de OF)", () => {
  it("MP pendente: soma os processos aplicáveis da OF sem o MP", () => {
    const row = {
      processes: {
        MP: orderCell({ status: "NAO_INICIADO", applicable: 2 }),
        SOLDA: orderCell({ status: "NAO_INICIADO", applicable: 2 }),
        // applicable 0 (desmarcado para a OF) fica fora da soma.
        LASER: orderCell({ applicable: 0 }),
      },
    };
    // Seg 19/10 + SOLDA (2) = qua 21/10.
    expect(orderProposalDate(row, CATALOG, TODAY)).toBe("2026-10-21");
  });

  it("processos já concluídos continuam contando (regra aprovada)", () => {
    const row = {
      processes: {
        MP: orderCell({ status: "NAO_INICIADO" }),
        SOLDA: orderCell({ status: "CONCLUIDO", done: 1, applicable: 1 }),
        EXP: orderCell({ status: "NAO_INICIADO" }),
      },
    };
    // Seg 19/10 + 3 dias úteis (SOLDA 2 + EXP 1) = qui 22/10.
    expect(orderProposalDate(row, CATALOG, TODAY)).toBe("2026-10-22");
  });

  it("MP concluído ou sem célula aplicável => null", () => {
    expect(
      orderProposalDate({ processes: { MP: orderCell({ status: "CONCLUIDO" }) } }, CATALOG, TODAY),
    ).toBeNull();
    expect(
      orderProposalDate({ processes: { MP: orderCell({ applicable: 0 }) } }, CATALOG, TODAY),
    ).toBeNull();
    expect(orderProposalDate({ processes: {} }, CATALOG, TODAY)).toBeNull();
  });
});

describe("itemProposalDate (Fábrica 2)", () => {
  it("MP pendente do item: soma os processos aplicáveis do próprio item", () => {
    const row = {
      processes: {
        MP: itemCell(),
        SOLDA: itemCell(),
        EXP: itemCell({ status: "NAO_APLICAVEL" }),
      },
    };
    // Seg 19/10 + SOLDA (2) = qua 21/10 (EXP fora; MP fora da soma).
    expect(itemProposalDate(row, CATALOG, TODAY)).toBe("2026-10-21");
  });

  it("MP concluído, não aplicável ou ausente => null", () => {
    expect(itemProposalDate({ processes: { MP: itemCell({ status: "CONCLUIDO" }) } }, CATALOG, TODAY)).toBeNull();
    expect(itemProposalDate({ processes: { MP: itemCell({ status: "NAO_APLICAVEL" }) } }, CATALOG, TODAY)).toBeNull();
    expect(itemProposalDate({ processes: {} }, CATALOG, TODAY)).toBeNull();
  });
});

describe("childItemProposalDate (Fábrica 1)", () => {
  it("MP herdado do pai pendente: soma a cadeia do filho (sem pós-KIT)", () => {
    const group = {
      processes: [childProcess("LASER", "NAO_INICIADO"), childProcess("KIT", "CONCLUIDO"), childProcess("SOLDA", "NAO_APLICAVEL")],
      parentProcessStatuses: { MP: "NAO_INICIADO" } as Record<string, ProcessStatus>,
    };
    // Seg 19/10 + 7 dias úteis (LASER 3 + KIT 4) = qua 28/10.
    // SOLDA (pós-KIT) só existe no item pai e aqui é não-aplicável.
    expect(childItemProposalDate(group, CATALOG, TODAY)).toBe("2026-10-28");
  });

  it("MP do pai concluído ou ausente => null", () => {
    expect(
      childItemProposalDate(
        { processes: [childProcess("LASER", "NAO_INICIADO")], parentProcessStatuses: { MP: "CONCLUIDO" } },
        CATALOG,
        TODAY,
      ),
    ).toBeNull();
    expect(
      childItemProposalDate({ processes: [childProcess("LASER", "NAO_INICIADO")], parentProcessStatuses: {} }, CATALOG, TODAY),
    ).toBeNull();
  });
});

describe("ordersProposalDates (Pedidos)", () => {
  it("agrega por OF com o mesmo escopo da gestão (raiz × filhos)", () => {
    const rows = [
      // MP pendente no RAIZ abre o cenário; o MP do FILHO não conta.
      { orderId: "oA", code: "MP", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
      { orderId: "oA", code: "MP", status: "NAO_INICIADO" as ProcessStatus, isRootItem: false },
      // Pós-KIT vem do raiz; cadeia F1 + KIT vêm dos filhos (039).
      { orderId: "oA", code: "SOLDA", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
      { orderId: "oA", code: "LASER", status: "NAO_INICIADO" as ProcessStatus, isRootItem: false },
      { orderId: "oA", code: "LASER", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
      { orderId: "oA", code: "KIT", status: "NAO_INICIADO" as ProcessStatus, isRootItem: false },
      // Não aplicável fica de fora.
      { orderId: "oA", code: "EXP", status: "NAO_APLICAVEL" as ProcessStatus, isRootItem: true },
      // MP concluído => sem proposta, mesmo com processo pendente.
      { orderId: "oB", code: "MP", status: "CONCLUIDO" as ProcessStatus, isRootItem: true },
      { orderId: "oB", code: "SOLDA", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
      // Só o MP do filho pendente (raiz sem MP no escopo) => sem proposta.
      { orderId: "oC", code: "MP", status: "NAO_INICIADO" as ProcessStatus, isRootItem: false },
      { orderId: "oC", code: "SOLDA", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
    ];

    const result = ordersProposalDates(rows, CATALOG, TODAY);

    // oA: SOLDA 2 (raiz) + LASER 3 (filho) + KIT 4 (filho) = 9 dias úteis.
    expect(result.oA).toBe("2026-10-30");
    expect(result.oB).toBeNull();
    expect(result.oC).toBeNull();
    // Pedido sem nenhuma linha de processo não entra no mapa.
    expect(result).not.toHaveProperty("oD");
  });

  it("catálogo sem o processo: duração inválida vira 1 dia útil", () => {
    const rows = [
      { orderId: "o1", code: "MP", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
      { orderId: "o1", code: "FORA_DO_CATALOGO", status: "NAO_INICIADO" as ProcessStatus, isRootItem: true },
    ];
    expect(ordersProposalDates(rows, CATALOG, TODAY)).toEqual({ o1: "2026-10-20" });
  });
});
