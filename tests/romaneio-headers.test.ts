import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RomaneioList } from "@/components/romaneio/RomaneioList";
import {
  RomaneioActiveFilters,
  RomaneioNumberFilter,
  RomaneioProcessColumnFilter,
  RomaneioShipmentFilter,
  RomaneioStatusFilter,
  RomaneioTextFilter,
  RomaneioWeightFilter,
} from "@/components/romaneio/RomaneioColumnHeaders";
import { parseRomaneioFilters } from "@/lib/utils/filters";
import type { RomaneioSummary } from "@/lib/types/romaneio";
import type { ProcessDefinition } from "@/lib/types/production";

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
    processes: {},
    ...overrides,
  };
}

/**
 * Catálogo parcial para as colunas de processo (049): inclui a cadeia
 * F1 (LASER — que NÃO abre coluna na F2), os códigos excluídos da
 * lista (MP e KIT) e um processo inativo (que também fica de fora).
 * Abrem coluna só SOLDA, ACAB e EXP.
 */
const PROCESSES: ProcessDefinition[] = [
  { id: "p-mp", code: "MP", name: "Matéria-prima", displayOrder: 5, active: true, location: null, durationDays: 1 },
  { id: "p-laser", code: "LASER", name: "LASER", displayOrder: 10, active: true, location: null, durationDays: 1 },
  { id: "p-kit", code: "KIT", name: "KIT", displayOrder: 80, active: true, location: null, durationDays: 1 },
  { id: "p-solda", code: "SOLDA", name: "SOLDA", displayOrder: 100, active: true, location: null, durationDays: 1 },
  { id: "p-acab", code: "ACAB", name: "ACAB", displayOrder: 110, active: true, location: null, durationDays: 1 },
  { id: "p-exp", code: "EXP", name: "EXPEDIÇÃO", displayOrder: 130, active: true, location: null, durationDays: 1 },
  { id: "p-quality", code: "QUALITY", name: "QUALITY", displayOrder: 120, active: false, location: null, durationDays: 1 },
];

describe("cabeçalhos de ordenação — RomaneioList (/romaneio)", () => {
  it("sinaliza a coluna default (nº desc) com o toggle para asc", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        processes: PROCESSES,
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
        processes: PROCESSES,
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
        processes: PROCESSES,
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
        processes: PROCESSES,
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
        processes: PROCESSES,
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
        processes: PROCESSES,
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
        processes: PROCESSES,
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
        processes: PROCESSES,
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

describe("colunas de processos da Fábrica 2 — listagem de romaneios (049)", () => {
  it("abre coluna por processo ativo fora da cadeia F1, sem MP e sem KIT", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({}),
        processes: PROCESSES,
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    // Entra: SOLDA, ACAB e EXP (ativos, fora da cadeia F1)…
    expect(table).toContain('aria-label="Ordenar por SOLDA"');
    expect(table).toContain('aria-label="Ordenar por ACAB"');
    expect(table).toContain('aria-label="Ordenar por EXPEDIÇÃO"');
    // Sai: MP e KIT (fora da carga), cadeia F1 (LASER) e inativo (QUALITY).
    expect(table).not.toContain("Ordenar por Matéria-prima");
    expect(table).not.toContain("Ordenar por KIT");
    expect(table).not.toContain("Ordenar por LASER");
    expect(table).not.toContain("Ordenar por QUALITY");
    // Cada coluna de processo carrega o funil de filtro.
    expect(table).toContain('aria-label="Filtrar por situação do processo SOLDA"');
    expect(table).toContain('aria-label="Filtrar por situação do processo EXP"');
    expect(table).not.toContain("Filtrar por situação do processo MP");
    expect(table).not.toContain("Filtrar por situação do processo KIT");
  });

  it("célula mostra SÓ o símbolo da situação agregada; sem chave = “—”", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary({ processes: { SOLDA: "CONCLUIDO", ACAB: "NAO_INICIADO" } })],
        filters: parseRomaneioFilters({}),
        processes: PROCESSES,
        canEdit: true,
      }),
    );
    expect(markup).toContain('aria-label="SOLDA: Concluído"');
    expect(markup).toContain(">✓<");
    expect(markup).toContain('aria-label="ACAB: Não iniciado"');
    expect(markup).toContain(">○<");
    // EXP sem linha nos itens da carga → "—" (não aplicável a esta carga).
    expect(markup).toContain('aria-label="EXPEDIÇÃO: não aplicável a esta carga"');
  });

  it("ordena pela coluna de processo (pior situação) pela URL", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({ ordem: "SOLDA" }),
        processes: PROCESSES,
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-sort="descending"');
    expect(table).toContain('href="/romaneio?ordem=SOLDA&amp;direcao=asc"');
  });

  it("sinaliza o funil ativo da coluna de processo filtrada", () => {
    const markup = html(
      createElement(RomaneioList, {
        romaneios: [summary()],
        filters: parseRomaneioFilters({ processo: "SOLDA", procsituacao: "NAO_INICIADO" }),
        processes: PROCESSES,
        canEdit: true,
      }),
    );
    const table = tableMarkup(markup);
    expect(table).toContain('aria-label="Filtrar por situação do processo SOLDA — filtro ativo"');
    expect(table).toContain("fill-current");
    // O par é único: as demais colunas continuam inativas.
    expect(table).toContain('aria-label="Filtrar por situação do processo ACAB"');
    expect(table.match(/Filtrar por situação do processo ACAB — filtro ativo/g)).toBeNull();
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

  it("processo (F2) — menu com as três situações + \"Todas\" e ativo só no par montado", () => {
    const inativo = html(
      createElement(RomaneioProcessColumnFilter, { filters: parseRomaneioFilters({}), code: "SOLDA" }),
    );
    expect(inativo).toContain('aria-label="Filtrar por situação do processo SOLDA"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(RomaneioProcessColumnFilter, {
        filters: parseRomaneioFilters({ processo: "SOLDA", procsituacao: "CONCLUIDO" }),
        code: "SOLDA",
      }),
    );
    expect(ativo).toContain('aria-label="Filtrar por situação do processo SOLDA — filtro ativo"');
    expect(ativo).toContain("fill-current");

    // Par montado para OUTRA coluna: esta continua inativa (filtro único).
    const outraColuna = html(
      createElement(RomaneioProcessColumnFilter, {
        filters: parseRomaneioFilters({ processo: "ACAB", procsituacao: "CONCLUIDO" }),
        code: "SOLDA",
      }),
    );
    expect(outraColuna).toContain('aria-label="Filtrar por situação do processo SOLDA"');
    expect(outraColuna).not.toContain("fill-current");
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
