import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Fabrica1ActiveFilters,
  Fabrica1ChildItemFilter,
  Fabrica1ColumnHeader,
  Fabrica1DeliveryFilter,
  Fabrica1ProcessGroupFilter,
  Fabrica1TextFilter,
} from "@/components/fabrica1/Fabrica1ColumnHeaders";
import { Fabrica1Table } from "@/components/fabrica1/Fabrica1Table";
import { parseChildItemFilters } from "@/lib/utils/filters";
import type { ChildItemGroup } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fabrica-1",
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

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const noFilters = parseChildItemFilters({});

describe("cabeçalhos da Fábrica 1 (desktop)", () => {
  it("mantém o rótulo do cabeçalho sem ordenação (a ordem das linhas é fixa)", () => {
    const markup = html(createElement(Fabrica1ColumnHeader, { label: "Cli.", fullLabel: "Cliente" }));
    expect(markup).toContain("Cli.");
    expect(markup).toContain('title="Cliente"');
    // Leitor de tela ouve o nome completo (sr-only) e nunca há link de ordenação.
    expect(markup).toContain("Cliente");
    expect(markup).not.toContain("Ordenar por");
  });

  it("renderiza o funil \"contém\" da coluna de texto e sinaliza quando está ativo", () => {
    const inativo = html(
      createElement(Fabrica1TextFilter, {
        filters: noFilters,
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(inativo).toContain('aria-label="Filtrar por cliente"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(Fabrica1TextFilter, {
        filters: parseChildItemFilters({ cliente: "ACME" }),
        field: "customer",
        column: "Cliente",
        context: "cliente",
      }),
    );
    expect(ativo).toContain('aria-label="Filtrar por cliente — filtro ativo"');
    expect(ativo).toContain("fill-current");
  });

  it("sinaliza o funil da coluna Filho como ativo com o código OU a descrição", () => {
    const codigo = html(
      createElement(Fabrica1ChildItemFilter, { filters: parseChildItemFilters({ filho: "72ST18-025" }) }),
    );
    expect(codigo).toContain('aria-label="Filtrar por código ou descrição do filho — filtro ativo"');

    const descricao = html(
      createElement(Fabrica1ChildItemFilter, { filters: parseChildItemFilters({ descricao: "barra" }) }),
    );
    expect(descricao).toContain("filtro ativo");
  });

  it("sinaliza o funil da Entrega como ativo quando só o período está ligado", () => {
    const markup = html(
      createElement(Fabrica1DeliveryFilter, {
        filters: parseChildItemFilters({ entregade: "2026-10-01" }),
      }),
    );
    expect(markup).toContain('aria-label="Filtrar por entrega — filtro ativo"');
    expect(markup).toContain("fill-current");
  });

  it("mostra o funil do grupo PROCESSOS como ativo com situação (sem processo específico)", () => {
    const markup = html(
      createElement(Fabrica1ProcessGroupFilter, {
        filters: parseChildItemFilters({ situacao: "CONCLUIDO" }),
      }),
    );
    expect(markup).toContain("filtro ativo");
  });
});

describe("chips de filtros ativos da Fábrica 1", () => {
  it("lista cada filtro ligado com remoção individual e limpeza geral", () => {
    const markup = html(
      createElement(Fabrica1ActiveFilters, {
        filters: parseChildItemFilters({ cliente: "ACME", material: "chapa" }),
      }),
    );
    expect(markup).toContain("Filtros ativos:");
    expect(markup).toContain("Cliente: ACME");
    expect(markup).toContain("Matérias-primas: chapa");
    expect(markup).toContain('aria-label="Remover filtro: Cliente: ACME"');
    expect(markup).toContain("Limpar filtros");
  });

  it("some quando não há filtro ligado", () => {
    expect(html(createElement(Fabrica1ActiveFilters, { filters: noFilters }))).toBe("");
  });
});

const catalog: ProcessDefinition[] = [
  { id: "1", code: "MP", name: "MP", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "2", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "3", code: "KIT", name: "KIT", displayOrder: 70, active: true, location: null, durationDays: 1 },
  { id: "4", code: "SOLDA", name: "SOLDA", displayOrder: 90, active: true, location: null, durationDays: 1 },
  { id: "5", code: "EXP", name: "EXP", displayOrder: 120, active: true, location: null, durationDays: 1 },
];

function item(overrides: Partial<ChildItemGroup> = {}): ChildItemGroup {
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
    processes: catalog
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

const capabilities = {
  canUpdateStatus: true,
  canEditQuantities: true,
  canViewHistory: true,
  canEditDelivery: false,
};

describe("tabela da Fábrica 1", () => {
  it("abre com os dois grupos e as colunas de dados da tela", () => {
    const markup = html(
      createElement(Fabrica1Table, {
        items: [item()],
        processes: catalog,
        filters: noFilters,
        capabilities,
        today: "2026-10-09",
      }),
    );
    expect(markup).toContain("DADOS DOS PEDIDOS");
    expect(markup).toContain("PROCESSOS");
    for (const label of ["OF/OS", "Cli.", "Item pai", "Filho", "Matérias-primas", "Qtd.", "Peso un.", "Peso total"]) {
      expect(markup).toContain(label);
    }
  });

  it("mostra uma coluna por processo da cadeia Fábrica 1 e esconde o pós-KIT", () => {
    const markup = html(
      createElement(Fabrica1Table, {
        items: [item()],
        processes: catalog,
        filters: noFilters,
        capabilities,
        today: "2026-10-09",
      }),
    );
    expect(markup).toContain("MP");
    expect(markup).toContain("LASER");
    expect(markup).toContain("KIT");
    // PRÉ-MTG/SOLDA/EXP acontecem no kit montado — ficam na gestão de entregas.
    expect(markup).not.toContain("SOLDA");
    expect(markup).not.toContain("EXP");
  });

  it("mostra o MP com o status herdado do item pai e sem edição", () => {
    const markup = html(
      createElement(Fabrica1Table, {
        items: [item()],
        processes: catalog,
        filters: noFilters,
        capabilities,
        today: "2026-10-09",
      }),
    );
    expect(markup).toContain("status do item pai (editado na Gestão de Entregas)");
    // Só os processos editáveis viram botão (aqui: LASER e KIT do catálogo).
    expect(markup).toContain('aria-label="LASER de BOTÃO DE PORTA');
    expect(markup).toContain('aria-label="KIT de BOTÃO DE PORTA');
    expect(markup).not.toContain('aria-label="MP de');
  });

  it("deixa as células de processo sem clique quando o perfil não atualiza situação", () => {
    const markup = html(
      createElement(Fabrica1Table, {
        items: [item()],
        processes: catalog,
        filters: noFilters,
        capabilities: { ...capabilities, canUpdateStatus: false },
        today: "2026-10-09",
      }),
    );
    expect(markup).toContain("disabled");
  });

  it("mostra o estado vazio quando a lista filtrada não tem itens", () => {
    const markup = html(
      createElement(Fabrica1Table, {
        items: [],
        processes: catalog,
        filters: noFilters,
        capabilities,
        today: "2026-10-09",
      }),
    );
    expect(markup).toContain("Nenhum item filho encontrado");
  });

  it("sinaliza o agrupamento: ×N no filho e +N no item pai", () => {
    const markup = html(
      createElement(Fabrica1Table, {
        items: [
          item({
            memberCount: 3,
            memberIds: ["item-1", "item-2", "item-3"],
            parentItems: ["72ST18", "72ST19"],
            quantity: 6,
            weightTotal: 9,
          }),
        ],
        processes: catalog,
        filters: noFilters,
        capabilities,
        today: "2026-10-09",
      }),
    );
    expect(markup).toContain("×3");
    expect(markup).toContain("+1");
    expect(markup).toContain("2 itens pai: 72ST18, 72ST19");
  });
});
