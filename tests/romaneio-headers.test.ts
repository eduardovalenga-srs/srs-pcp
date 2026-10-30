import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioList } from "@/components/romaneio/RomaneioList";
import { RomaneioOrderPicker } from "@/components/romaneio/RomaneioOrderPicker";
import {
  RomaneioActiveFilters,
  RomaneioShipmentFilter,
  RomaneioStatusFilter,
  RomaneioTextFilter,
} from "@/components/romaneio/RomaneioColumnHeaders";
import { parseRomaneioCandidateFilters, parseRomaneioFilters } from "@/lib/utils/filters";
import type { RomaneioCandidate, RomaneioSummary } from "@/lib/types/romaneio";

const mocks = vi.hoisted(() => ({ pathname: "/romaneio" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: (props: {
      href: string;
      className?: string;
      title?: string;
      "aria-label"?: string;
      children?: ReactNode;
    }) =>
      h(
        "a",
        {
          href: props.href,
          className: props.className,
          title: props.title,
          "aria-label": props["aria-label"],
        },
        props.children,
      ),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/romaneio.actions", () => ({ createRomaneioAction: vi.fn() }));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function tableMarkup(markup: string): string {
  const start = markup.indexOf("<table");
  const end = markup.indexOf("</table>");
  expect(start).toBeGreaterThanOrEqual(0);
  return markup.slice(start, end + "</table>".length);
}

function summary(): RomaneioSummary {
  return {
    id: "rom-1",
    number: 42,
    orderId: "order-1",
    orderCode: "OF 107482",
    customerName: "ACME",
    orderDeliveryDate: "2026-10-20",
    status: "EMITIDO",
    shipmentDate: "2026-10-25",
    carrier: "Transportadora X",
    itemCount: 2,
    quantityTotal: 6,
    weightTotal: 12,
    nfNumber: "12345",
    returnNfNumber: null,
    pendingReturn: false,
    conferenceAcceptedAt: null,
    emittedAt: "2026-10-26T12:00:00Z",
    createdAt: "2026-10-20T09:00:00Z",
  };
}

function candidate(): RomaneioCandidate {
  return {
    orderId: "order-1",
    code: "OF 107482",
    type: "OF",
    customerName: "ACME",
    deliveryDate: "2026-10-20",
    status: "PLANEJADO",
    rootQuantity: 6,
    rootWeightKg: 12,
    shippedQuantity: 2,
    hasSimulation: false,
    simulationId: null,
  };
}

describe("cabeçalhos de ordenação — RomaneioList (/romaneio)", () => {
  it("sinaliza a coluna default (nº desc) com o toggle para asc", () => {
    const markup = html(
      createElement(RomaneioList, { romaneios: [summary()], filters: parseRomaneioFilters({}) }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-sort="descending"');
    expect(table).toContain('aria-label="Ordenar por Número, atualmente decrescente"');
    expect(table).toContain('href="/romaneio?direcao=asc"');
  });

  it("coluna fora da default nasce inativa (toggle para asc)", () => {
    const markup = html(
      createElement(RomaneioList, { romaneios: [summary()], filters: parseRomaneioFilters({}) }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('href="/romaneio?ordem=order_code&amp;direcao=asc"');
    expect(table).toContain('href="/romaneio?ordem=status&amp;direcao=asc"');
    expect(table).toContain('aria-label="Ordenar por OF/OS"');
    expect(table).toContain('aria-label="Ordenar por Situação"');
  });

  it("cabeçalhos de OF/OS, Cliente, Situação e Saída carregam o funil de filtro", () => {
    const markup = html(
      createElement(RomaneioList, { romaneios: [summary()], filters: parseRomaneioFilters({}) }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-label="Filtrar por OF/OS"');
    expect(table).toContain('aria-label="Filtrar por cliente"');
    expect(table).toContain('aria-label="Filtrar por situação do romaneio"');
    expect(table).toContain('aria-label="Filtrar por saída"');
    // Sem filtro ligado, nenhum funil aparece preenchido.
    expect(table).not.toContain("fill-current");
    // Colunas sem filtro (Nº, Itens, Qtd, Peso, NFs e Ações) ficam só ordenáveis.
    expect(table).not.toContain("Filtrar por número");
    expect(table).not.toContain("Filtrar por NF");
  });
});

describe("filtros por coluna — listagem de romaneios", () => {
  it("texto (OF/OS e Cliente) — \"contém\" com sinalização de ativo", () => {
    const inativo = html(
      createElement(RomaneioTextFilter, {
        filters: parseRomaneioFilters({}),
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(inativo).toContain('aria-label="Filtrar por cliente"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(RomaneioTextFilter, {
        filters: parseRomaneioFilters({ cliente: "ACME" }),
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(ativo).toContain('aria-label="Filtrar por cliente — filtro ativo"');
    expect(ativo).toContain("fill-current");
  });

  it("situação — menu com as opções de romaneio e sinalização de ativo", () => {
    const inativo = html(
      createElement(RomaneioStatusFilter, { filters: parseRomaneioFilters({}) }),
    );
    expect(inativo).toContain('aria-label="Filtrar por situação do romaneio"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(RomaneioStatusFilter, { filters: parseRomaneioFilters({ status: "EMITIDO" }) }),
    );
    expect(ativo).toContain('aria-label="Filtrar por situação do romaneio — filtro ativo"');
    expect(ativo).toContain("fill-current");
  });

  it("saída — período De/Até com sinalização de ativo", () => {
    const inativo = html(
      createElement(RomaneioShipmentFilter, { filters: parseRomaneioFilters({}) }),
    );
    expect(inativo).toContain('aria-label="Filtrar por saída"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(
        RomaneioShipmentFilter,
        { filters: parseRomaneioFilters({ saidade: "2026-10-01" }) },
      ),
    );
    expect(ativo).toContain('aria-label="Filtrar por saída — filtro ativo"');
    expect(ativo).toContain("fill-current");
  });
});

describe("chips de filtros ativos — listagem de romaneios", () => {
  it("lista cada filtro ligado com remoção individual e limpeza geral", () => {
    const markup = html(
      createElement(RomaneioActiveFilters, {
        filters: parseRomaneioFilters({
          q: "107482",
          status: "SIMULACAO",
          of: "OF 107482",
          cliente: "ACME",
          saidade: "2026-10-01",
        }),
      }),
    );
    expect(markup).toContain("Filtros ativos:");
    expect(markup).toContain("Busca: 107482");
    expect(markup).toContain("Situação: Simulação");
    expect(markup).toContain("OF/OS: OF 107482");
    expect(markup).toContain("Cliente: ACME");
    expect(markup).toContain("Período de saída: a partir de 01/10/2026");
    expect(markup).toContain('aria-label="Remover filtro: Cliente: ACME"');
    expect(markup).toContain("Limpar filtros");
  });

  it("some quando não há filtro ligado", () => {
    expect(html(createElement(RomaneioActiveFilters, { filters: parseRomaneioFilters({}) }))).toBe("");
  });
});

describe("cabeçalhos de ordenação — RomaneioOrderPicker (/romaneio/novo)", () => {
  it("Entrega é a coluna default (asc) e o toggle leva para desc", () => {
    mocks.pathname = "/romaneio/novo";
    const markup = html(
      createElement(RomaneioOrderPicker, {
        candidates: [candidate()],
        filters: parseRomaneioCandidateFilters({}),
        total: 1,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-sort="ascending"');
    expect(table).toContain('aria-label="Ordenar por Entrega, atualmente crescente"');
    expect(table).toContain('href="/romaneio/novo?direcao=desc"');
  });

  it("coluna fora da default nasce inativa", () => {
    mocks.pathname = "/romaneio/novo";
    const markup = html(
      createElement(RomaneioOrderPicker, {
        candidates: [candidate()],
        filters: parseRomaneioCandidateFilters({}),
        total: 1,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('href="/romaneio/novo?ordem=status"');
    expect(table).toContain('aria-label="Ordenar por Situação"');
    expect(table).toContain('href="/romaneio/novo?ordem=weight"');
    expect(table).toContain('aria-label="Ordenar por Peso"');
  });
});
