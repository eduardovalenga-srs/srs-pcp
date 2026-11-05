import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioList } from "@/components/romaneio/RomaneioList";
import {
  RomaneioActiveFilters,
  RomaneioNumberFilter,
  RomaneioShipmentFilter,
  RomaneioStatusFilter,
  RomaneioTextFilter,
  RomaneioWeightFilter,
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
vi.mock("@/lib/actions/romaneio.actions", () => ({
  createRomaneioAction: vi.fn(),
  getRomaneioEmissionAction: vi.fn(),
  saveRomaneioNfAction: vi.fn(),
  confirmRomaneioAction: vi.fn(),
}));

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
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-sort="descending"');
    expect(table).toContain('aria-label="Ordenar por Número, atualmente decrescente"');
    expect(table).toContain('href="/romaneio?direcao=asc"');
  });

  it("coluna fora da default nasce inativa (toggle para asc)", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('href="/romaneio?ordem=order_code&amp;direcao=asc"');
    expect(table).toContain('aria-label="Ordenar por OF/OS"');
  });

  it("mantém as colunas da listagem (Situação é coluna própria; Itens/Qtd continuam fora)", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain("Peso (kg)");
    expect(table).toContain("NF saída");
    expect(table).toContain("NF devolução");
    // 047: Situação virou coluna ordenável — Itens/Qtd continuam fora.
    expect(table).toContain('aria-label="Ordenar por Situação"');
    expect(table).not.toContain("Ordenar por Itens");
    expect(table).not.toContain("Ordenar por Quantidade expedida");
  });

  it("cabeçalhos de Todas as colunas carregam o funil de filtro (047)", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-label="Filtrar por número do romaneio"');
    expect(table).toContain('aria-label="Filtrar por situação do romaneio"');
    expect(table).toContain('aria-label="Filtrar por OF/OS"');
    expect(table).toContain('aria-label="Filtrar por cliente"');
    expect(table).toContain('aria-label="Filtrar por saída"');
    expect(table).toContain('aria-label="Filtrar por peso total"');
    expect(table).toContain('aria-label="Filtrar por NF de saída"');
    expect(table).toContain('aria-label="Filtrar por NF de devolução"');
    // Sem filtro ligado, nenhum funil aparece preenchido.
    expect(table).not.toContain("fill-current");
  });

  it("sinaliza o funil ativo de cada coluna filtrada", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({
          situacao: "ABERTO",
          numerode: "10",
          nfsaida: "12345",
        }),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-label="Filtrar por situação do romaneio — filtro ativo"');
    expect(table).toContain('aria-label="Filtrar por número do romaneio — filtro ativo"');
    expect(table).toContain('aria-label="Filtrar por NF de saída — filtro ativo"');
    expect(table).toContain("fill-current");
  });

  it("mostra o badge de situação na própria coluna e o link de conferência", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    expect(markup).toContain("Confirmado");
    expect(markup).toContain('href="/romaneio/rom-1/conferencia"');
    // Romaneio cancelado não oferece a folha de conferência.
    const cancelado = html(
      createElement(RomaneioList, {
        romaneios: [summary({ status: "CANCELADO" })],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    expect(cancelado).toContain("Cancelado");
    expect(cancelado).not.toContain('href="/romaneio/rom-1/conferencia"');
  });
});

describe("ações da linha — Conferência precede a emissão de NF (lista /romaneio)", () => {
  const render = (overrides: Partial<RomaneioSummary> = {}, canEdit = true): string =>
    html(
      createElement(RomaneioList, {
        romaneios: [summary(overrides)],
        filters: parseRomaneioFilters({}),
        canEdit,
      }),
    );

  it("ABERTO: só Conferência e Abrir (sem Emitir NF)", () => {
    const markup = render({ status: "ABERTO" });

    expect(markup).toContain("Conferência");
    expect(markup).toContain("Abrir");
    expect(markup).not.toContain("Emitir NF");
    expect(markup).not.toContain(">NFs<");
  });

  it("CONFERIDO: Conferência · Emitir NF · Abrir, nessa ordem", () => {
    const markup = render({ status: "CONFERIDO" });

    const conferencia = markup.indexOf("Conferência");
    const emitir = markup.indexOf("Emitir NF");
    const abrir = markup.indexOf(">Abrir");
    expect(conferencia).toBeGreaterThanOrEqual(0);
    expect(emitir).toBeGreaterThan(conferencia);
    expect(abrir).toBeGreaterThan(emitir);
    // Sem NF registrada ainda (a emissão é quem grava).
    expect(markup).not.toContain(">NFs<");
  });

  it("CONFIRMADO: a emissão vira edição de NFs (Emitir NF some)", () => {
    const markup = render({ status: "CONFIRMADO" });

    expect(markup).toContain(">NFs<");
    expect(markup).not.toContain("Emitir NF");
    expect(markup.indexOf("Conferência")).toBeLessThan(markup.indexOf(">NFs<"));
  });

  it("CANCELADO: só Abrir (sem Conferência nem emissão)", () => {
    const markup = render({ status: "CANCELADO" });

    expect(markup).toContain("Abrir");
    expect(markup).not.toContain("Conferência");
    expect(markup).not.toContain("Emitir NF");
    expect(markup).not.toContain(">NFs<");
  });

  it("sem romaneio.edit não aparece nenhuma ação de emissão", () => {
    const conferido = render({ status: "CONFERIDO" }, false);
    expect(conferido).toContain("Conferência");
    expect(conferido).not.toContain("Emitir NF");

    const confirmado = render({ status: "CONFIRMADO" }, false);
    expect(confirmado).not.toContain(">NFs<");
    expect(confirmado).toContain("Abrir");
  });
});

describe("colunas de processos saíram da listagem (049 → detalhe)", () => {
  it("nenhuma coluna, célula ou funil de processo na tabela", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    // Nem ordenação por pior situação…
    expect(table).not.toContain("Ordenar por SOLDA");
    expect(table).not.toContain("Ordenar por ACAB");
    expect(table).not.toContain("Ordenar por EXPEDIÇÃO");
    // …nem filtro por coluna de processo.
    expect(table).not.toContain("Filtrar por situação do processo");
    // As colunas da listagem continuam intactas.
    expect(table).toContain('aria-label="Ordenar por Número');
    expect(table).toContain('aria-label="Ordenar por OF/OS"');
    expect(table).toContain('aria-label="Ordenar por Cliente"');
  });

  it("sem a prop de catálogo a lista segue montando as colunas clássicas", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({ ordem: "SOLDA" }),
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    // `ordem=<código de processo>` não é mais coluna: cai no default (nº).
    expect(table).toContain('aria-sort="descending"');
    expect(table).not.toContain("Ordenar por SOLDA");
  });
});

describe("filtros por coluna — listagem de romaneios", () => {
  it("texto (OF/OS, Cliente e NFs) — \"contém\" com sinalização de ativo", () => {
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

    // 047: os números de NF usam o mesmo primitivo de texto.
    const nf = html(
      createElement(RomaneioTextFilter, {
        filters: parseRomaneioFilters({ nfdev: "9876" }),
        field: "returnNfNumber",
        column: "NF devolução",
        context: "NF de devolução",
      }),
    );
    expect(nf).toContain('aria-label="Filtrar por NF de devolução — filtro ativo"');
  });

  it("situação — menu com as quatro situações + \"Todas\"", () => {
    const inativo = html(
      createElement(RomaneioStatusFilter, { filters: parseRomaneioFilters({}) }),
    );
    expect(inativo).toContain('aria-label="Filtrar por situação do romaneio"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(RomaneioStatusFilter, {
        filters: parseRomaneioFilters({ situacao: "CONFERIDO" }),
      }),
    );
    expect(ativo).toContain('aria-label="Filtrar por situação do romaneio — filtro ativo"');
    expect(ativo).toContain("fill-current");
  });

  it("Nº e Peso — faixa De/Até com sinalização de ativo", () => {
    const numeroInativo = html(
      createElement(RomaneioNumberFilter, { filters: parseRomaneioFilters({}) }),
    );
    expect(numeroInativo).toContain('aria-label="Filtrar por número do romaneio"');
    expect(numeroInativo).not.toContain("fill-current");

    const numeroAtivo = html(
      createElement(RomaneioNumberFilter, {
        filters: parseRomaneioFilters({ numerode: "10", numeroate: "99" }),
      }),
    );
    expect(numeroAtivo).toContain('aria-label="Filtrar por número do romaneio — filtro ativo"');

    const pesoAtivo = html(
      createElement(RomaneioWeightFilter, {
        filters: parseRomaneioFilters({ pesode: "1.5" }),
      }),
    );
    expect(pesoAtivo).toContain('aria-label="Filtrar por peso total — filtro ativo"');
    expect(pesoAtivo).toContain("fill-current");
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
          situacao: "ABERTO",
          of: "OF 107482",
          cliente: "ACME",
          saidade: "2026-10-01",
          numerode: "10",
          numeroate: "99",
          pesode: "1.5",
          nfsaida: "12345",
          nfdev: "9876",
        }),
      }),
    );
    expect(markup).toContain("Filtros ativos:");
    expect(markup).toContain("Busca: 107482");
    expect(markup).toContain("Situação: Aberto");
    expect(markup).toContain("OF/OS: OF 107482");
    expect(markup).toContain("Cliente: ACME");
    expect(markup).toContain("Período de saída: a partir de 01/10/2026");
    expect(markup).toContain("Nº: #10 – #99");
    expect(markup).toContain("Peso: ≥ 1,5");
    expect(markup).toContain("NF saída: 12345");
    expect(markup).toContain("NF devolução: 9876");
    expect(markup).toContain('aria-label="Remover filtro: Cliente: ACME"');
    expect(markup).toContain('aria-label="Remover filtro: Situação: Aberto"');
    expect(markup).toContain("Limpar filtros");
  });

  it("some quando não há filtro ligado", () => {
    expect(html(createElement(RomaneioActiveFilters, { filters: parseRomaneioFilters({}) }))).toBe("");
  });
});
