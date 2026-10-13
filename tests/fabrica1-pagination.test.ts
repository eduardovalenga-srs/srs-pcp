import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChildItemsPagination } from "@/components/fabrica1/ChildItemsPagination";
import { CHILD_ITEMS_PAGE_SIZE_OPTIONS } from "@/lib/constants/pagination";
import { parseChildItemFilters } from "@/lib/utils/filters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fabrica-1",
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("ChildItemsPagination", () => {
  it("expõe o seletor \"Por página\" com o tamanho atual vindo da URL", () => {
    const markup = html(
      createElement(ChildItemsPagination, {
        filters: parseChildItemFilters({ porpagina: "100" }),
        total: 500,
      }),
    );
    expect(markup).toContain('for="fabrica1-por-pagina"');
    expect(markup).toContain("Por página");
    // O trigger carrega o valor selecionado (100 itens por página).
    expect(markup).toContain("100");
    // Faixa exibida com o tamanho escolhido: 100 por página.
    expect(markup).toContain("1–100");
    expect(markup).toContain("Página 1 de 5");
  });

  it("resume à página 1 quando o total não cabe mais na página atual", () => {
    const markup = html(
      createElement(ChildItemsPagination, {
        filters: parseChildItemFilters({ pagina: "99" }),
        total: 60,
      }),
    );
    // 60 itens / 25 por página = 3 páginas; a página 99 é limitada a 3.
    expect(markup).toContain("Página 3 de 3");
    expect(markup).toContain("51–60");
    // Última página não avança mais.
    expect(markup).toContain("disabled");
  });

  it("some quando não há itens", () => {
    const markup = html(
      createElement(ChildItemsPagination, {
        filters: parseChildItemFilters({}),
        total: 0,
      }),
    );
    expect(markup).toBe("");
  });

  it("publica 4 opções de tamanho, todas válidas para o backend (1–200)", () => {
    expect([...CHILD_ITEMS_PAGE_SIZE_OPTIONS]).toEqual([25, 50, 100, 200]);
    for (const size of CHILD_ITEMS_PAGE_SIZE_OPTIONS) {
      expect(parseChildItemFilters({ porpagina: String(size) }).pageSize).toBe(size);
    }
  });
});
