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
];

function cell(): ProcessCell {
  return {
    id: "pp-mp",
    status: "NAO_INICIADO",
    quantityPlanned: 1,
    quantityCompleted: 0,
    notes: null,
    completedAt: null,
  };
}

function row(parentItem: string): ProductionRow {
  return {
    orderItemId: `item-${parentItem || "vazio"}`,
    orderId: "order-1",
    orderCode: "OF-107482",
    orderType: "OF",
    customerName: "ACME",
    orderStatus: "EM_PRODUCAO",
    family: "GC",
    parentItem,
    description: "GUARDA CORPO",
    quantity: 2,
    unitWeightKg: 1.5,
    deliveryDate: "2026-10-20",
    itemStatus: "EM_PRODUCAO",
    op: null,
    overdue: false,
    seq: null,
    processes: { MP: cell() },
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

function tableMarkup(rows: ProductionRow[]): string {
  const markup = html(
    createElement(Fabrica2Table, {
      rows,
      processes: catalog,
      filters: noFilters,
      capabilities,
      today: "2026-10-01",
    }),
  );
  return markup.slice(markup.indexOf("<table"), markup.indexOf("</table>"));
}

/** Trecho da célula "Item pai" da primeira linha do corpo. */
function parentCell(markup: string): string {
  const thead = markup.slice(markup.indexOf("<thead"), markup.indexOf("</thead>"));
  // A última linha do cabeçalho traz as colunas folhas (a de cima são grupos).
  const leafRow = thead.slice(thead.lastIndexOf("<tr"));
  const headerCells = [...leafRow.matchAll(/<th[\s>]/g)];
  const index = headerCells.findIndex((match) => {
    const start = match.index ?? 0;
    const end = leafRow.indexOf("</th>", start);
    return leafRow.slice(start, end).includes("Item pai");
  });
  expect(index).toBeGreaterThanOrEqual(0);

  const body = markup.slice(markup.indexOf("<tbody"));
  const rowMarkup = body.slice(0, body.indexOf("</tr>"));
  const cells = [...rowMarkup.matchAll(/<td[\s>]/g)];
  const cellStart = cells[index]?.index;
  expect(cellStart).toBeGreaterThanOrEqual(0);
  const cellEnd = rowMarkup.indexOf("</td>", cellStart as number);
  return rowMarkup.slice(cellStart, cellEnd);
}

describe("coluna 'Item pai' da Fábrica 2 se redimensiona pelo código exibido", () => {
  it("código longo alarga a coluna para o tamanho do código (+2 de folga)", () => {
    const markup = tableMarkup([row("2615-4-PS-1203-0161")]); // 19 caracteres
    const cell = parentCell(markup);

    expect(cell).toContain("width:21ch");
    expect(cell).not.toContain("max-w-[96px]");
    // Código completo visível (sem reticências) e no tooltip.
    expect(cell).toContain("2615-4-PS-1203-0161");
    expect(cell).toContain('title="2615-4-PS-1203-0161"');
  });

  it("código curto usa o piso (8ch) — largura do cabeçalho, sem estreitar", () => {
    const cell = parentCell(tableMarkup([row("P-1")]));
    expect(cell).toContain("width:8ch");
    expect(cell).not.toContain("max-w-[96px]");
  });

  it("código absurdo respeita o teto (28ch) — não desloca as demais colunas", () => {
    const cell = parentCell(tableMarkup([row("A".repeat(60))]));
    expect(cell).toContain("width:28ch");
    // Só o teto corta: o código segue no tooltip por inteiro.
    expect(cell).toContain(`title="${"A".repeat(60)}"`);
  });

  it("sem item pai mantém o piso e renderiza o marcador de vazio", () => {
    const cell = parentCell(tableMarkup([row("")]));
    expect(cell).toContain("width:8ch");
    expect(cell).toContain("—");
    expect(cell).not.toContain("title=");
  });

  it("a largura segue o maior código da página (o curto não dicta o piso só)", () => {
    const markup = tableMarkup([row("P-1"), row("2615-4-PS-1203-0161")]);
    // Ambas as células usam a MESMA largura, calculada pelo maior código.
    const widths = [...markup.matchAll(/width:(\d+)ch/g)].map((m) => m[1]);
    expect(new Set(widths)).toEqual(new Set(["21"]));
  });
});
