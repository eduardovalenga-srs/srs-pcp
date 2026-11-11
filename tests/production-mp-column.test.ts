import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A coluna MP da GESTÃO DE OF (025) é o espelho do recebimento (056): ela
// mostra a data EFETIVA do recebimento ("recebida em DD/MM") e a JANELA
// PREVISTA do processo — a data-limite em que a matéria-prima deveria ter
// chegado (contada de trás para frente a partir da entrega).
//
// A regressão: o commit 28e4cfe passou a renderizar a coluna MP SEM a data
// prevista (só no tooltip). Este arquivo trava o comportamento: a prevista
// volta a aparecer na célula (desktop e card mobile), junto da efetiva.
//
// O código de servidor usa `server-only` (que lança fora do RSC).
vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/gestao-de-of",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { ProductionTable } from "@/components/producao/ProductionTable";
import { parseProductionFilters } from "@/lib/utils/filters";
import type {
  OrderProcessCell,
  ProcessDefinition,
  ProductionOrderRow,
} from "@/lib/types/production";

/**
 * Catálogo com MP na frente da cadeia (displayOrder 5). Entrega 10/10/2026
 * (sábado) => janelas contadas de trás para frente:
 * EXP 09/10 · SOLDA 08/10 · KIT 07/10 · LASER 06/10 · **MP 05/10**.
 * A referência (today) é 12/10 — o início previsto do MP (05/10) já passou,
 * então uma MP pendente aparece em VERMELHO.
 */
const catalog: ProcessDefinition[] = [
  { id: "1", code: "MP", name: "MP", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "2", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "3", code: "KIT", name: "KIT", displayOrder: 70, active: true, location: null, durationDays: 1 },
  { id: "4", code: "SOLDA", name: "SOLDA", displayOrder: 90, active: true, location: null, durationDays: 1 },
  { id: "5", code: "EXP", name: "EXP", displayOrder: 120, active: true, location: null, durationDays: 1 },
];

const TODAY = "2026-10-12";

/** Célula CONCLUIDO (as demais colunas ficam fora do vermelho de atraso). */
function doneCell(overrides: Partial<OrderProcessCell> = {}): OrderProcessCell {
  return {
    status: "CONCLUIDO",
    done: 1,
    applicable: 1,
    quantityPlanned: 3,
    quantityCompleted: 3,
    completedAt: "2026-10-01T13:00:00+00:00",
    ...overrides,
  };
}

function row(mp: OrderProcessCell): ProductionOrderRow {
  return {
    orderId: "order-1",
    orderCode: "OF-107482",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    deliveryDate: "2026-10-10",
    quantity: 2,
    weightTotal: 3,
    overdue: false,
    seq: null,
    processes: {
      MP: mp,
      LASER: doneCell(),
      KIT: doneCell(),
      SOLDA: doneCell(),
      EXP: doneCell(),
    },
  };
}

function markup(mp: OrderProcessCell): string {
  return renderToStaticMarkup(
    createElement(ProductionTable, {
      rows: [row(mp)],
      processes: catalog,
      filters: parseProductionFilters({}),
      capabilities: { canUpdateStatus: true, canEditDelivery: false, canEditSeq: false },
      today: TODAY,
    }),
  );
}

/** MP recebida (verde): data efetiva 01/10 + prevista 05/10. */
const receivedMp = doneCell({
  status: "CONCLUIDO",
  quantityCompleted: 3,
  completedAt: "2026-10-01T13:00:00+00:00",
});

/** MP pendente (sem espelho): status NAO_INICIADO, sem data efetiva. */
const pendingMp = doneCell({
  status: "NAO_INICIADO",
  quantityCompleted: 0,
  completedAt: null,
});

/**
 * A data VISÍVEL da célula: o span que desenha o dia/mês dentro da célula
 * (o tooltip é atributo, não conteúdo — por isso o teste exige o span).
 */
function visibleDay(html: string, day: string): boolean {
  return new RegExp(`<span class="tabular-nums text-\\[10px\\][^"]*">${day}</span>`).test(html);
}

describe("Gestão de OF — coluna MP com a data prevista e a data efetiva", () => {
  it("mostra a data prevista junto da data efetiva do recebimento", () => {
    const html = markup(receivedMp);

    // Janela prevista do MP (05/10) — a data-limite do recebimento.
    expect(visibleDay(html, "05/10")).toBe(true);
    // Data EFETIVA do recebimento (01/10) — o que a 058 restaura.
    expect(visibleDay(html, "01/10")).toBe(true);
    // O tooltip abre a janela completa e a data efetiva por extenso.
    expect(html).toContain("previsto de 05/10/2026 a 05/10/2026");
    expect(html).toContain("recebida em 01/10/2026");
  });

  it("mostra só a data prevista quando a MP ainda não foi recebida", () => {
    const html = markup(pendingMp);

    expect(visibleDay(html, "05/10")).toBe(true);
    // Nenhuma data efetiva — a MP não tem o que exibir.
    expect(visibleDay(html, "01/10")).toBe(false);
    expect(html).not.toContain("recebida em");
  });

  it("pinta a prevista em vermelho quando o início já passou e a MP está pendente", () => {
    const html = markup(pendingMp);

    // Início previsto (05/10) anterior à referência (12/10) e MP não concluída.
    expect(
      new RegExp('<span class="tabular-nums text-\\[10px\\] text-status-late">05/10</span>').test(html),
    ).toBe(true);
  });

  it("não pinta a prevista em vermelho quando a MP já foi recebida", () => {
    const html = markup(receivedMp);

    // Processo CONCLUIDO nunca fica vermelho (regra em utils/production).
    expect(html).not.toContain("text-status-late");
  });

  it("desenha a prevista no desktop e no card mobile", () => {
    const html = markup(receivedMp);

    // A mesma célula (ProcessCellButton) é usada na tabela e no card do
    // mobile: a data prevista aparece nos dois (uma linha por tela).
    const occurrences = html.match(
      /<span class="tabular-nums text-\[10px\][^"]*">05\/10<\/span>/g,
    ) ?? [];
    expect(occurrences).toHaveLength(2);
  });
});
