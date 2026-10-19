import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderList } from "@/components/pedidos/OrderList";
import {
  OrderDeliveryFilter,
  OrderStatusFilter,
  OrderTextFilter,
} from "@/components/pedidos/OrderColumnHeaders";
import { parseOrderFilters } from "@/lib/utils/filters";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/pedidos",
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

describe("filtros por coluna de Pedidos (038)", () => {
  it("OF/OS e Cliente — funil \"contém\" com sinalização de ativo", () => {
    const inativo = html(
      createElement(OrderTextFilter, {
        filters: parseOrderFilters({}),
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(inativo).toContain('aria-label="Filtrar por cliente"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(OrderTextFilter, {
        filters: parseOrderFilters({ cliente: "ACME" }),
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(ativo).toContain("Filtrar por cliente — filtro ativo");
    expect(ativo).toContain("fill-current");
  });

  it("Entrega — período inclusivo ativo por qualquer lado", () => {
    const soDe = html(
      createElement(OrderDeliveryFilter, {
        filters: parseOrderFilters({ entregade: "2026-10-01" }),
      }),
    );
    expect(soDe).toContain("Filtrar por entrega — filtro ativo");

    const inativo = html(
      createElement(OrderDeliveryFilter, { filters: parseOrderFilters({}) }),
    );
    expect(inativo).toContain('aria-label="Filtrar por entrega"');
    expect(inativo).not.toContain("filtro ativo");
  });

  it("Situação — menu de situações do pedido com sinalização de ativo", () => {
    const inativo = html(
      createElement(OrderStatusFilter, { filters: parseOrderFilters({}) }),
    );
    expect(inativo).toContain('aria-label="Filtrar por situação do pedido"');
    expect(inativo).not.toContain("filtro ativo");

    const ativo = html(
      createElement(OrderStatusFilter, {
        filters: parseOrderFilters({ status: "EM_PRODUCAO" }),
      }),
    );
    expect(ativo).toContain("Filtrar por situação do pedido — filtro ativo");
  });
});

describe("cabeçalho da tabela de Pedidos", () => {
  it("renderiza os quatro filtros do desktop (Itens/DP/Ações sem funil)", () => {
    const markup = html(
      createElement(OrderList, {
        orders: [],
        canDelete: false,
        filters: parseOrderFilters({ cliente: "ACME" }),
        proposalByOrder: {},
      }),
    );
    expect(markup).toContain('aria-label="Filtrar por OF/OS"');
    expect(markup).toContain("Filtrar por cliente — filtro ativo");
    expect(markup).toContain('aria-label="Filtrar por entrega"');
    expect(markup).toContain('aria-label="Filtrar por situação do pedido"');
    // Coluna informativa: Itens não tem filtro (decisão de escopo 038).
    expect(markup).toContain("Itens");
    // DP (data de proposta): informativa, sem filtro — leitor de tela
    // enxerga o nome completo (o visível é a abreviação).
    expect(markup).toContain("DP");
    expect(markup).toContain("Data de proposta");
  });
});
