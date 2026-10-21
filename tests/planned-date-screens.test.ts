import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A data PREVISTA (janela contada da entrega) só aparece na gestão de OF:
// nas telas da Fábrica 1 e da Fábrica 2 as células/chips/tooltips ficam sem
// ela e as folhas de detalhes escondem o rótulo "Previsão de execução" e a
// janela "De X a Y" — mantendo a data EFETIVA do recebimento da MP (031) e
// a edição da entrega. Este arquivo cobre esse escopo.

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

// Spy de fiação: registra a `showPlan` que a Fábrica 1 passa à folha
// compartilhada (a mesma que o detalhe do pedido usa com o default true).
const captured = vi.hoisted(() => ({ showPlan: undefined as boolean | undefined }));

vi.mock("@/components/producao/ProcessDetailsSheet", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/producao/ProcessDetailsSheet")>();
  return {
    ...actual,
    ProcessDetailsSheet: (props: Parameters<typeof actual.ProcessDetailsSheet>[0]) => {
      captured.showPlan = props.showPlan;
      return actual.ProcessDetailsSheet(props);
    },
  };
});

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
 * (qui). Com a prevista AINDA desenhada, a célula LASER mostraria 06/10 e a
 * KIT 07/10 (janelas contadas de trás para frente) — hoje elas somem.
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
    today: "2026-10-09",
  });
}

describe("Fábrica 1 — sem data prevista nas células (prevista só na gestão de OF)", () => {
  it("não desenha a janela prevista nem o texto \"previsto de\" nos tooltips", () => {
    const markup = html(f1Table([f1Item()]));

    // Janelas que a célula exibiria se a prevista ainda existisse:
    // LASER 06/10 e KIT 07/10 (entrega 10/10, contadas em dias úteis).
    expect(markup).not.toContain("06/10");
    expect(markup).not.toContain("07/10");
    expect(markup).not.toContain("previsto de");
  });

  it("mantém a data EFETIVA do recebimento da MP no desktop e no chip mobile", () => {
    const markup = html(f1Table([f1Item()]));

    // desktop: célula herdada do pai — sem o trecho da prevista no título.
    expect(markup).toContain(
      "Matéria-prima — status do item pai (editado na Gestão de OF): Concluído · recebida em 08/10/2026",
    );
    // mobile: chip MP do card — idem, só a data efetiva.
    expect(markup).toContain("Matéria-prima — status do item pai: Concluído · recebida em 08/10/2026");
    // Visível na célula/chip (dd/MM no fuso do negócio).
    expect(markup).toContain("08/10");
  });

  it("passa showPlan={false} para a folha de detalhes (prevista só na gestão de OF)", () => {
    captured.showPlan = undefined;
    html(f1Table([f1Item()]));
    expect(captured.showPlan).toBe(false);
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
 * Entrega 20/10 (ter) — com prevista, a célula MP mostraria 14/10, KIT
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
    today: "2026-10-15",
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

describe("Fábrica 2 — sem data prevista nas células (prevista só na gestão de OF)", () => {
  it("não desenha a janela prevista nem o texto \"previsto de\" nos tooltips", () => {
    const markup = html(f2Table([f2RowWithMpCompleted()]));

    // Janelas que existiriam com a prevista: MP 14/10, KIT 15/10,
    // PRÉ-MTG 16/10 e EXP 19/10.
    expect(markup).not.toContain("14/10");
    expect(markup).not.toContain("15/10");
    expect(markup).not.toContain("16/10");
    expect(markup).not.toContain("19/10");
    expect(markup).not.toContain("previsto de");
  });

  it("mantém a data EFETIVA do recebimento da MP (031)", () => {
    const markup = html(f2Table([f2RowWithMpCompleted()]));

    expect(markup).toContain("recebida em 10/10/2026");
    expect(markup).toContain("10/10");
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

describe("ProcessDetailsSheet — showPlan (prevista só na gestão de OF)", () => {
  it("com showPlan=false esconde o rótulo e a janela, mantendo a edição de entrega", () => {
    const markup = html(
      createElement(ProcessDetailsSheet, {
        selection: processSelection(),
        processes: f1Catalog,
        capabilities: sheetCapabilities,
        showPlan: false,
        onOpenChange: () => {},
      }),
    );

    expect(markup).not.toContain("Previsão de execução");
    // Janela da entrega 30/10: LASER cairia em 26/10 (1 dia útil).
    expect(markup).not.toContain("26/10/2026");
    expect(markup).not.toContain("dia útil");
    // A edição da entrega continua (seção "Entrega: ...").
    expect(markup).toContain("Entrega (edição manual)");
    expect(markup).toContain("30/10/2026");
  });

  it("sem a prop (detalhe do pedido) a previsão continua aparecendo", () => {
    const markup = html(
      createElement(ProcessDetailsSheet, {
        selection: processSelection(),
        processes: f1Catalog,
        capabilities: sheetCapabilities,
        onOpenChange: () => {},
      }),
    );

    expect(markup).toContain("Previsão de execução");
    expect(markup).toContain("26/10/2026");
    expect(markup).toContain("dia útil");
    expect(markup).toContain("Entrega (edição manual)");
  });
});

describe("Fabrica2DetailsSheet — sem previsão (prevista só na gestão de OF)", () => {
  it("esconde o rótulo e a janela, mantendo a edição de entrega", () => {
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

    expect(markup).not.toContain("Previsão de execução");
    expect(markup).not.toContain("26/10/2026");
    expect(markup).not.toContain("dia útil");
    expect(markup).toContain("Entrega (edição manual)");
    expect(markup).toContain("30/10/2026");
  });
});
