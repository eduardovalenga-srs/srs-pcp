import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A coluna DP (data de proposta) ficou oculta nas telas da Fábrica 1 e da
// Fábrica 2 — desktop e card mobile. A data PREVISTA (janela contada da
// entrega) continua aparecendo nelas: dd/MM na célula, vermelho de início
// vencido, "previsto de" nos tooltips/chips e as folhas de detalhes com o
// rótulo "Previsão de execução" e a janela "De X a Y" — mantendo a data
// EFETIVA do recebimento da MP (031) e a edição da entrega. Este arquivo
// cobre esse escopo.

// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fabrica-1",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// A folha lateral é Radix e não renderiza fora do browser — o mock devolve o
// conteúdo direto para asserir no markup.
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children?: ReactNode }) => children ?? null,
  SheetContent: ({ children }: { children?: ReactNode }) => children ?? null,
  SheetHeader: ({ children }: { children?: ReactNode }) => children ?? null,
  SheetTitle: ({ children }: { children?: ReactNode }) => children ?? null,
  SheetDescription: ({ children }: { children?: ReactNode }) => children ?? null,
  SheetFooter: ({ children }: { children?: ReactNode }) => children ?? null,
}));

import { Fabrica1Table } from "@/components/fabrica1/Fabrica1Table";
import { Fabrica2Table } from "@/components/fabrica2/Fabrica2Table";
import {
  Fabrica2DetailsSheet,
  type Fabrica2Capabilities,
} from "@/components/fabrica2/Fabrica2DetailsSheet";
import {
  ProcessDetailsSheet,
  type ProductionCapabilities,
} from "@/components/producao/ProcessDetailsSheet";
import { parseChildItemFilters, parseProductionFilters } from "@/lib/utils/filters";
import type { ChildItemGroup } from "@/lib/types/order";
import type { ProcessCell, ProcessDefinition, ProductionRow } from "@/lib/types/production";

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const f1Catalog: ProcessDefinition[] = [
  { id: "1", code: "MP", name: "MP", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "2", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "3", code: "KIT", name: "KIT", displayOrder: 70, active: true, location: null, durationDays: 1 },
  { id: "4", code: "SOLDA", name: "SOLDA", displayOrder: 90, active: true, location: null, durationDays: 1 },
  { id: "5", code: "EXP", name: "EXP", displayOrder: 120, active: true, location: null, durationDays: 1 },
];

/**
 * Mesma fixture do teste de cabeçalhos: entrega 10/10 (sáb) e pai 15/10
 * (qui). Com a prevista desenhada, a célula LASER mostra 06/10 e a KIT
 * 07/10 (janelas contadas de trás para frente) — ambas vencidas diante da
 * referência 12/10, então saem em vermelho.
 */
function f1Item(overrides: Partial<ChildItemGroup> = {}): ChildItemGroup {
  return {
    id: "g:order-1:72ST18-025",
    orderId: "order-1",
    orderCode: "OF-107482",
    customerName: "ACME",
    parentItem: "72ST18",
    parentDescription: "GUARDA CORPO",
    parentItems: ["72ST18"],
    childItem: "72ST18-025",
    description: "BOTÃO DE PORTA",
    memberCount: 1,
    memberIds: ["item-1"],
    quantity: 2,
    unitWeightKg: 1.5,
    weightTotal: 3,
    deliveryDate: "2026-10-10",
    seq: null,
    processes: f1Catalog
      .filter((process) => process.code !== "MP")
      .map((process) => ({
        id: `pp-${process.code}`,
        code: process.code,
        name: process.name,
        displayOrder: process.displayOrder,
        status: "NAO_INICIADO",
        quantityPlanned: null,
        quantityCompleted: null,
        notes: null,
      })),
    parentProcessStatuses: { MP: "CONCLUIDO" },
    parentMpCompletedAt: "2026-10-08T13:00:00+00:00",
    parentDeliveryDate: "2026-10-15",
    materials: [],
    ...overrides,
  };
}

const f1Capabilities: ProductionCapabilities = {
  canUpdateStatus: true,
  canEditQuantities: true,
  canViewHistory: true,
  canEditDelivery: false,
  canEditSeq: false,
};

function f1Table(items: ChildItemGroup[]): ReactElement {
  return createElement(Fabrica1Table, {
    items,
    processes: f1Catalog,
    filters: parseChildItemFilters({}),
    capabilities: f1Capabilities,
    // Referência 12/10: LASER (06/10) e KIT (07/10) já começaram → vermelho.
    today: "2026-10-12",
  });
}

describe("Fábrica 1 — data prevista nas células e sem coluna DP", () => {
  it("desenha a janela prevista, o texto \"previsto de\" e o vermelho de início vencido", () => {
    const markup = html(f1Table([f1Item()]));

    // Janelas que a célula desenha: LASER 06/10 e KIT 07/10
    // (entrega 10/10, contadas em dias úteis de trás para frente).
    expect(markup).toContain("06/10");
    expect(markup).toContain("07/10");
    expect(markup).toContain("previsto de");
    // Início vencido (anterior à referência) → a data prevista sai em vermelho.
    expect(markup).toContain("text-status-late");
  });

  it("mantém a data EFETIVA do recebimento da MP (031) ao lado da prevista no desktop e no chip mobile", () => {
    const markup = html(f1Table([f1Item()]));

    // desktop: célula herdada do pai — prevista (entrega do pai 15/10 →
    // MP 08/10) seguida da data efetiva do recebimento.
    expect(markup).toContain(
      "Matéria-prima — status do item pai (editado na Gestão de OF): Concluído · previsto de 08/10/2026 a 08/10/2026 · recebida em 08/10/2026",
    );
    // mobile: chip MP do card — idem, com a prevista e a efetiva empilhadas.
    expect(markup).toContain(
      "Matéria-prima — status do item pai: Concluído · previsto de 08/10/2026 a 08/10/2026 · recebida em 08/10/2026",
    );
    // Visível na célula/chip (dd/MM no fuso do negócio).
    expect(markup).toContain("08/10");
  });

  it("não exibe a coluna DP (data de proposta) nem no desktop nem no card mobile", () => {
    const markup = html(f1Table([f1Item()]));

    // Cabeçalho da coluna (label + rótulo completo) e a linha do card mobile.
    expect(markup).not.toContain(">DP<");
    expect(markup).not.toContain("Data de proposta");
    expect(markup).not.toContain("Proposta:");
  });
});

// --- Fábrica 2 ---------------------------------------------------------------

const f2Catalog: ProcessDefinition[] = [
  { id: "1", code: "MP", name: "MP", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "2", code: "KIT", name: "KIT", displayOrder: 70, active: true, location: null, durationDays: 1 },
  { id: "3", code: "PRE_MTG", name: "PRÉ-MTG", displayOrder: 80, active: true, location: null, durationDays: 1 },
  { id: "4", code: "EXP", name: "EXP", displayOrder: 120, active: true, location: null, durationDays: 1 },
];

function baseCell(overrides: Partial<ProcessCell> = {}): ProcessCell {
  return {
    id: "pp-1",
    status: "NAO_INICIADO",
    quantityPlanned: 2,
    quantityCompleted: 0,
    notes: null,
    completedAt: null,
    ...overrides,
  };
}

/**
 * Entrega 20/10 (ter) — com prevista, a célula MP mostra 14/10, KIT
 * 15/10, PRÉ-MTG 16/10 e EXP 19/10 (janelas em dias úteis).
 */
function f2Row(processes: Record<string, ProcessCell>): ProductionRow {
  return {
    orderItemId: "item-1",
    orderId: "order-1",
    orderCode: "OF-107482",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    family: "GC",
    parentItem: "P-1",
    description: "GUARDA CORPO",
    quantity: 2,
    unitWeightKg: 1.5,
    deliveryDate: "2026-10-20",
    itemStatus: "EM_PRODUCAO",
    op: null,
    overdue: false,
    seq: null,
    processes,
  };
}

const f2Capabilities: Fabrica2Capabilities = {
  canUpdateStatus: true,
  canEditQuantities: true,
  canViewHistory: true,
  canEditDelivery: false,
  canEditSeq: true,
};

function f2Table(rows: ProductionRow[]): ReactElement {
  return createElement(Fabrica2Table, {
    rows,
    processes: f2Catalog,
    filters: parseProductionFilters({}),
    capabilities: f2Capabilities,
    // Referência 16/10: KIT (15/10, não concluído) já começou → vermelho.
    today: "2026-10-16",
  });
}

function f2RowWithMpCompleted(): ProductionRow {
  return f2Row({
    MP: baseCell({ id: "pp-mp", status: "CONCLUIDO", completedAt: "2026-10-10T12:00:00+00:00" }),
    KIT: baseCell({ id: "pp-kit" }),
    PRE_MTG: baseCell({ id: "pp-pre" }),
    EXP: baseCell({ id: "pp-exp" }),
  });
}

describe("Fábrica 2 — data prevista nas células e sem coluna DP", () => {
  it("desenha a janela prevista, o texto \"previsto de\" e o vermelho de início vencido", () => {
    const markup = html(f2Table([f2RowWithMpCompleted()]));

    // Janelas (entrega 20/10): MP 14/10, KIT 15/10, PRÉ-MTG 16/10 e EXP 19/10.
    expect(markup).toContain("14/10");
    expect(markup).toContain("15/10");
    expect(markup).toContain("16/10");
    expect(markup).toContain("19/10");
    expect(markup).toContain("previsto de");
    // Início vencido (anterior à referência) → a data prevista sai em vermelho.
    expect(markup).toContain("text-status-late");
  });

  it("mantém a data EFETIVA do recebimento da MP (031) ao lado da prevista", () => {
    const markup = html(f2Table([f2RowWithMpCompleted()]));

    expect(markup).toContain("previsto de 14/10/2026 a 14/10/2026");
    expect(markup).toContain("recebida em 10/10/2026");
    expect(markup).toContain("10/10");
  });

  it("não exibe a coluna DP (data de proposta) nem no desktop nem no card mobile", () => {
    const markup = html(f2Table([f2RowWithMpCompleted()]));

    expect(markup).not.toContain(">DP<");
    expect(markup).not.toContain("Data de proposta");
    expect(markup).not.toContain("Proposta:");
  });
});

// --- Folhas de detalhes ------------------------------------------------------

const sheetCapabilities: ProductionCapabilities = {
  canUpdateStatus: true,
  canEditQuantities: true,
  canViewHistory: false,
  canEditDelivery: true,
  canEditSeq: true,
};

function processSelection() {
  return {
    productionProcessId: "pp-laser",
    orderItemId: "item-1",
    orderId: "order-1",
    orderCode: "OF-107482",
    itemDescription: "BOTÃO DE PORTA",
    processName: "LASER",
    processCode: "LASER",
    deliveryDate: "2026-10-30",
    status: "NAO_INICIADO" as const,
    quantityPlanned: null,
    quantityCompleted: null,
    notes: null,
    completedAt: null,
  };
}

describe("ProcessDetailsSheet — previsão de execução", () => {
  it("mostra o rótulo e a janela, mantendo a edição de entrega", () => {
    const markup = html(
      createElement(ProcessDetailsSheet, {
        selection: processSelection(),
        processes: f1Catalog,
        capabilities: sheetCapabilities,
        onOpenChange: () => {},
      }),
    );

    expect(markup).toContain("Previsão de execução");
    // Janela da entrega 30/10: LASER cai em 26/10 (1 dia útil).
    expect(markup).toContain("26/10/2026");
    expect(markup).toContain("dia útil");
    expect(markup).toContain("Entrega (edição manual)");
    expect(markup).toContain("30/10/2026");
  });
});

describe("Fabrica2DetailsSheet — previsão de execução", () => {
  it("mostra o rótulo e a janela, mantendo a edição de entrega", () => {
    const markup = html(
      createElement(Fabrica2DetailsSheet, {
        selection: {
          productionProcessId: "pp-kit",
          orderItemId: "item-1",
          orderCode: "OF-107482",
          itemDescription: "GUARDA CORPO",
          processName: "KIT",
          processCode: "KIT",
          deliveryDate: "2026-10-30",
          status: "NAO_INICIADO",
          quantityPlanned: null,
          quantityCompleted: null,
          notes: null,
        },
        processes: f2Catalog,
        capabilities: { ...sheetCapabilities },
        onOpenChange: () => {},
      }),
    );

    expect(markup).toContain("Previsão de execução");
    // Janela da entrega 30/10: KIT cai em 27/10 (1 dia útil).
    expect(markup).toContain("27/10/2026");
    expect(markup).toContain("dia útil");
    expect(markup).toContain("Entrega (edição manual)");
    expect(markup).toContain("30/10/2026");
  });
});
