import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fabrica2Table } from "@/components/fabrica2/Fabrica2Table";
import { parseProductionFilters } from "@/lib/utils/filters";
import type {
  ProcessCell,
  ProcessDefinition,
  ProductionFilters,
  ProductionRow,
} from "@/lib/types/production";

// A tabela puxa actions de servidor (updateItemsSeqAction) — server-only
// lança fora do RSC, então o mock deixa o import passar no node puro.
vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fabrica-2",
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const catalog: ProcessDefinition[] = [
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

function row(processes: Record<string, ProcessCell>): ProductionRow {
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

const capabilities = {
  canUpdateStatus: true,
  canEditQuantities: true,
  canViewHistory: true,
  canEditDelivery: false,
  canEditSeq: true,
};

const noFilters: ProductionFilters = parseProductionFilters({});

function table(rows: ProductionRow[]): ReactElement {
  return createElement(Fabrica2Table, {
    rows,
    processes: catalog,
    filters: noFilters,
    capabilities,
    today: "2026-10-15",
  });
}

describe("célula KIT agregada dos filhos na Fábrica 2 (039)", () => {
  it("renderiza somente leitura — sem botão de edição — quando aggregated", () => {
    const markup = html(
      table([
        row({
          MP: baseCell({ id: "pp-mp", status: "CONCLUIDO", completedAt: "2026-10-10T12:00:00+00:00" }),
          // Célula KIT agregada dos filhos (id null + aggregated).
          KIT: baseCell({ id: null, aggregated: true, status: "NAO_INICIADO" }),
          PRE_MTG: baseCell({ id: "pp-pre" }),
          EXP: baseCell({ id: "pp-exp" }),
        }),
      ]),
    );

    const tableMarkup = markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
    // A célula agregada aparece com a dica de que a marcação é na Fábrica 1...
    expect(tableMarkup).toContain("agregado dos itens filhos");
    // ...e NÃO vira botão de edição: a tag que envolve o bloco é <span>.
    const kitIndex = tableMarkup.indexOf("agregado dos itens filhos");
    const tagStart = tableMarkup.lastIndexOf("<", kitIndex);
    const cellTag = tableMarkup.slice(tagStart, tableMarkup.indexOf(">", tagStart));
    expect(cellTag).toContain("<span");
    expect(cellTag).not.toContain("<button");
  });

  it("célula normal (não agregada) continua clicável", () => {
    const markup = html(
      table([
        row({
          MP: baseCell({ id: "pp-mp", status: "CONCLUIDO" }),
          KIT: baseCell({ id: "pp-kit", status: "NAO_INICIADO" }),
          PRE_MTG: baseCell({ id: "pp-pre" }),
          EXP: baseCell({ id: "pp-exp" }),
        }),
      ]),
    );
    const tableMarkup = markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
    // Sem a marca de agregado.
    expect(tableMarkup).not.toContain("agregado dos itens filhos");
    // A célula KIT comum é um <button> (editável quando a capacidade permite).
    expect(tableMarkup).toContain("<button");
  });

  it("célula agregada CONCLUIDO mantém o visual de concluído", () => {
    const markup = html(
      table([
        row({
          MP: baseCell({ id: "pp-mp" }),
          KIT: baseCell({ id: null, aggregated: true, status: "CONCLUIDO", quantityCompleted: 5 }),
          PRE_MTG: baseCell({ id: "pp-pre" }),
          EXP: baseCell({ id: "pp-exp" }),
        }),
      ]),
    );
    const tableMarkup = markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
    expect(tableMarkup).toContain("agregado dos itens filhos");
    // Símbolo de CONCLUIDO (✓) presente no bloco.
    expect(tableMarkup).toContain("✓");
  });
});
