import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioList } from "@/components/romaneio/RomaneioList";
import {
  RomaneioActiveFilters,
  RomaneioShipmentFilter,
  RomaneioTextFilter,
} from "@/components/romaneio/RomaneioColumnHeaders";
import { parseRomaneioFilters } from "@/lib/utils/filters";
import type { RomaneioSummary } from "@/lib/types/romaneio";

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

function summary(overrides: Partial<RomaneioSummary> = {}): RomaneioSummary {
  return {
    id: "rom-1",
    number: 42,
    orderId: "order-1",
    orderCode: "OF 107482",
    customerName: "ACME",
    orderDeliveryDate: "2026-10-20",
    status: "CONFIRMADO",
    shipmentDate: "2026-10-25",
    carrier: "Transportadora X",
    weightTotal: 12,
    nfNumber: "12345",
    returnNfNumber: null,
    pendingReturn: false,
    conferenceAcceptedAt: "2026-10-25T10:00:00Z",
    emittedAt: "2026-10-26T12:00:00Z",
    createdAt: "2026-10-20T09:00:00Z",
    ...overrides,
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
    expect(table).toContain('aria-label="Ordenar por OF/OS"');
  });

  it("mantém só as colunas da nova listagem (sem Situação/Itens/Qtd)", () => {
    const markup = html(
      createElement(RomaneioList, { romaneios: [summary()], filters: parseRomaneioFilters({}) }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain("Peso (kg)");
    expect(table).toContain("NF saída");
    expect(table).toContain("NF devolução");
    // Colunas removidas: a situação vive no badge, Itens/Qtd saíram.
    expect(table).not.toContain('aria-label="Ordenar por Situação"');
    expect(table).not.toContain("Ordenar por Itens");
    expect(table).not.toContain("Ordenar por Quantidade expedida");
  });

  it("cabeçalhos de OF/OS, Cliente e Saída carregam o funil de filtro", () => {
    const markup = html(
      createElement(RomaneioList, { romaneios: [summary()], filters: parseRomaneioFilters({}) }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-label="Filtrar por OF/OS"');
    expect(table).toContain('aria-label="Filtrar por cliente"');
    expect(table).toContain('aria-label="Filtrar por saída"');
    // Sem filtro ligado, nenhum funil aparece preenchido.
    expect(table).not.toContain("fill-current");
    // Colunas sem filtro (Nº, Peso, NFs e Ações) ficam só ordenáveis.
    expect(table).not.toContain("Filtrar por número");
    expect(table).not.toContain("Filtrar por NF");
  });

  it("mostra o badge de situação ao lado do nº e o link de conferência", () => {
    const markup = html(
      createElement(RomaneioList, { romaneios: [summary()], filters: parseRomaneioFilters({}) }),
    );
    expect(markup).toContain("Confirmado");
    expect(markup).toContain('href="/romaneio/rom-1/conferencia"');
    // Romaneio cancelado não oferece a folha de conferência.
    const cancelado = html(
      createElement(RomaneioList, {
        romaneios: [summary({ status: "CANCELADO" })],
        filters: parseRomaneioFilters({}),
      }),
    );
    expect(cancelado).toContain("Cancelado");
    expect(cancelado).not.toContain('href="/romaneio/rom-1/conferencia"');
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
          of: "OF 107482",
          cliente: "ACME",
          saidade: "2026-10-01",
        }),
      }),
    );
    expect(markup).toContain("Filtros ativos:");
    expect(markup).toContain("Busca: 107482");
    expect(markup).toContain("OF/OS: OF 107482");
    expect(markup).toContain("Cliente: ACME");
    expect(markup).toContain("Período de saída: a partir de 01/10/2026");
    expect(markup).toContain('aria-label="Remover filtro: Cliente: ACME"');
    expect(markup).toContain("Limpar filtros");
    // A listagem não tem mais filtro de situação.
    expect(markup).not.toContain("Situação:");
  });

  it("some quando não há filtro ligado", () => {
    expect(html(createElement(RomaneioActiveFilters, { filters: parseRomaneioFilters({}) }))).toBe("");
  });
});
