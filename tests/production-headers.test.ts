import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ColumnHeader,
  DeliveryFilter,
  OrderGroupHeader,
  ProcessGroupFilter,
  TextColumnFilter,
} from "@/components/producao/ColumnHeaders";
import { ActiveFilters } from "@/components/producao/ActiveFilters";
import { parseProductionFilters } from "@/lib/utils/filters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/gestao-entregas",
}));

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: (props: {
      href: string;
      className?: string;
      title?: string;
      "aria-label"?: string;
      "aria-current"?: string;
      children?: ReactNode;
    }) =>
      h(
        "a",
        {
          href: props.href,
          className: props.className,
          title: props.title,
          "aria-label": props["aria-label"],
          "aria-current": props["aria-current"],
        },
        props.children,
      ),
  };
});

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const noFilters = parseProductionFilters({});

describe("cabeçalhos com filtro (desktop)", () => {
  it("renderiza ordenação e funil na coluna de Entrega", () => {
    const markup = html(
      createElement(ColumnHeader, {
        label: "Entrega",
        columnId: "delivery_date",
        filters: noFilters,
        filter: createElement(DeliveryFilter, { filters: noFilters }),
      }),
    );
    // delivery_date é a ordenação padrão: o rótulo carrega também o sentido atual.
    expect(markup).toContain('aria-label="Ordenar por Entrega, atualmente crescente"');
    expect(markup).toContain('aria-label="Filtrar por entrega"');
    // Sem filtro ligado, o funil não aparece preenchido.
    expect(markup).not.toContain("fill-current");
  });

  it("sinaliza o funil da Entrega como ativo quando só o período está ligado", () => {
    const markup = html(
      createElement(DeliveryFilter, { filters: parseProductionFilters({ entregade: "2026-10-01" }) }),
    );
    expect(markup).toContain('aria-label="Filtrar por entrega — filtro ativo"');
    expect(markup).toContain("fill-current");
  });

  it("mostra o funil do grupo PROCESSOS como ativo só com situação em qualquer processo", () => {
    const globalStatus = html(
      createElement(ProcessGroupFilter, { filters: parseProductionFilters({ situacao: "BLOQUEADO" }) }),
    );
    expect(globalStatus).toContain("filtro ativo");

    const scoped = html(
      createElement(ProcessGroupFilter, {
        filters: parseProductionFilters({ processo: "LASER", situacao: "BLOQUEADO" }),
      }),
    );
    expect(scoped).not.toContain("filtro ativo");
  });

  it("mantém só o título do grupo DADOS DOS PEDIDOS (busca genérica removida)", () => {
    const markup = html(createElement(OrderGroupHeader));
    expect(markup).toContain("DADOS DOS PEDIDOS");
    expect(markup).not.toContain("Buscar por OF/OS");
    expect(markup).not.toContain("<input");
  });

  it("abrevia o rótulo visível e mantém o nome completo no acessível", () => {
    const ordenavel = html(
      createElement(ColumnHeader, {
        label: "Ent.",
        fullLabel: "Entrega",
        columnId: "delivery_date",
        filters: noFilters,
      }),
    );
    expect(ordenavel).toContain("Ent.");
    // delivery_date é a ordenação padrão: o aria carrega também o sentido atual.
    expect(ordenavel).toContain('aria-label="Ordenar por Entrega, atualmente crescente"');
    expect(ordenavel).toContain('title="Entrega"');

    const fixa = html(createElement(ColumnHeader, { label: "Cli.", fullLabel: "Cliente", filters: noFilters }));
    expect(fixa).toContain('title="Cliente"');
    // Leitor de tela ouve o nome completo (sr-only), nunca a abreviação.
    expect(fixa).toContain('class="sr-only"');
    expect(fixa).toContain("Cliente");
    expect(fixa).toContain("Cli.");
  });

  it("renomeia a coluna Família para Tipo (TP) no cabeçalho, sem funil", () => {
    const markup = html(
      createElement(ColumnHeader, {
        label: "TP",
        fullLabel: "Tipo",
        columnId: "family",
        filters: parseProductionFilters({ familia: "PORTAS" }),
      }),
    );
    expect(markup).toContain("TP");
    expect(markup).toContain('aria-label="Ordenar por Tipo"');
    expect(markup).toContain('title="Tipo"');
    // TP/Qtd/Peso e colunas de processo ficaram sem filtro por decisão de layout.
    expect(markup).not.toContain("Filtrar por");
  });

  it("mantém o rótulo da coluna sem ordenação (Cliente)", () => {
    const markup = html(createElement(ColumnHeader, { label: "Cliente", filters: noFilters }));
    expect(markup).toContain("Cliente");
    expect(markup).not.toContain("Ordenar por");
    expect(markup).not.toContain("Filtrar por");
  });

  it("renderiza o funil \"contém\" da coluna de texto e sinaliza quando está ativo", () => {
    const inativo = html(
      createElement(TextColumnFilter, {
        filters: noFilters,
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(inativo).toContain('aria-label="Filtrar por cliente"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(TextColumnFilter, {
        filters: parseProductionFilters({ cliente: "ACME" }),
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(ativo).toContain("Filtrar por cliente — filtro ativo");
    expect(ativo).toContain("fill-current");
  });
});

describe("chips de filtros ativos", () => {
  it("lista cada filtro ligado com remoção individual e limpeza geral", () => {
    const markup = html(
      createElement(ActiveFilters, { filters: parseProductionFilters({ q: "porta", entrega: "OVERDUE" }) }),
    );
    expect(markup).toContain("Filtros ativos:");
    expect(markup).toContain("Busca: porta");
    expect(markup).toContain("Entrega: Atrasados");
    expect(markup).toContain('aria-label="Remover filtro: Busca: porta"');
    expect(markup).toContain("Limpar filtros");
  });

  it("some quando não há filtro ligado", () => {
    expect(html(createElement(ActiveFilters, { filters: noFilters }))).toBe("");
  });

  it("lista filtros de coluna nos chips com remoção individual", () => {
    const markup = html(
      createElement(ActiveFilters, { filters: parseProductionFilters({ cliente: "ACME", qtdmin: "5" }) }),
    );
    expect(markup).toContain("Cliente: ACME");
    expect(markup).toContain("Qtd.: ≥ 5");
    expect(markup).toContain('aria-label="Remover filtro: Cliente: ACME"');
    expect(markup).toContain("Limpar filtros");
  });
});
