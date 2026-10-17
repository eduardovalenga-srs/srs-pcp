import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderPagination } from "@/components/pedidos/OrderPagination";
import { ORDERS_PAGE_SIZE, ORDERS_PAGE_SIZE_OPTIONS } from "@/lib/constants/pagination";
import { orderQueryString, parseOrderFilters } from "@/lib/utils/filters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/pedidos",
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("OrderPagination", () => {
  it("expõe o seletor \"Por página\" com o padrão de 200 linhas", () => {
    const markup = html(
      createElement(OrderPagination, {
        filters: parseOrderFilters({}),
        total: 500,
      }),
    );
    expect(markup).toContain('for="pedidos-por-pagina"');
    expect(markup).toContain("Por página");
    // Padrão (sem ?porpagina na URL): 200 por página.
    expect(markup).toContain("1–200");
    expect(markup).toContain("Página 1 de 3");
  });

  it("carrega o tamanho escolhido vindo da URL", () => {
    const markup = html(
      createElement(OrderPagination, {
        filters: parseOrderFilters({ porpagina: "1000" }),
        total: 1500,
      }),
    );
    expect(markup).toContain("1–1000");
    expect(markup).toContain("Página 1 de 2");
  });

  it("publica 3 opções de tamanho, todas válidas para o backend (1–1000)", () => {
    expect([...ORDERS_PAGE_SIZE_OPTIONS]).toEqual([200, 500, 1000]);
    for (const size of ORDERS_PAGE_SIZE_OPTIONS) {
      expect(parseOrderFilters({ porpagina: String(size) }).pageSize).toBe(size);
    }
  });

  it("omite o padrão da URL e mantém o escolhido no roundtrip", () => {
    expect(orderQueryString(parseOrderFilters({}))).toBe("");

    const filters = parseOrderFilters({ q: "ACME", porpagina: "500" });
    const params = new URLSearchParams(orderQueryString(filters));
    expect(params.get("q")).toBe("ACME");
    expect(params.get("porpagina")).toBe("500");

    const roundtrip = parseOrderFilters(Object.fromEntries(params));
    expect(roundtrip.search).toBe("ACME");
    expect(roundtrip.pageSize).toBe(500);
    expect(roundtrip.page).toBe(1);
    // Padrão volta a ser omitido quando o tamanho é o default.
    expect(new URLSearchParams(orderQueryString({ ...roundtrip, pageSize: ORDERS_PAGE_SIZE })).has("porpagina")).toBe(false);
  });
});
