import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Fabrica2NumericColumnFilter,
  Fabrica2ProcessColumnFilter,
  Fabrica2SeqFilter,
  Fabrica2TextColumnFilter,
} from "@/components/fabrica2/Fabrica2ColumnHeaders";
import { parseProductionFilters } from "@/lib/utils/filters";
import type { ProductionFilters } from "@/lib/types/production";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fabrica-2",
}));

function html(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

const noFilters: ProductionFilters = parseProductionFilters({});

describe("filtros por coluna da Fábrica 2 (038)", () => {
  it("Seq. — igualdade com sinalização de ativo", () => {
    const inativo = html(createElement(Fabrica2SeqFilter, { filters: noFilters }));
    expect(inativo).toContain('aria-label="Filtrar por sequência de fabricação"');
    expect(inativo).not.toContain("fill-current");

    const ativo = html(
      createElement(Fabrica2SeqFilter, { filters: parseProductionFilters({ seq: "7" }) }),
    );
    expect(ativo).toContain("Filtrar por sequência de fabricação — filtro ativo");
    expect(ativo).toContain("fill-current");
  });

  it("TP (Família) e OP — funil \"contém\" com sinalização de ativo", () => {
    const familia = html(
      createElement(Fabrica2TextColumnFilter, {
        filters: parseProductionFilters({ familia: "PORTAS" }),
        field: "family",
        column: "TP",
        context: "tipo",
      }),
    );
    expect(familia).toContain("Filtrar por tipo — filtro ativo");
    expect(familia).toContain("fill-current");

    const op = html(
      createElement(Fabrica2TextColumnFilter, {
        filters: parseProductionFilters({ op: "OP-777" }),
        field: "op",
        column: "OP",
        context: "OP",
      }),
    );
    expect(op).toContain("Filtrar por OP — filtro ativo");
    expect(op).toContain("fill-current");
  });

  it("Peso un. — faixa De/Até com sinalização de ativo", () => {
    const props = {
      minField: "weightMin",
      maxField: "weightMax",
      column: "Peso un.",
      context: "peso unitário",
      step: "0.001",
    } as const;
    const inativo = html(createElement(Fabrica2NumericColumnFilter, { ...props, filters: noFilters }));
    expect(inativo).toContain('aria-label="Filtrar por peso unitário"');

    const ativo = html(
      createElement(Fabrica2NumericColumnFilter, {
        ...props,
        filters: parseProductionFilters({ pesomin: "2,5" }),
      }),
    );
    expect(ativo).toContain("Filtrar por peso unitário — filtro ativo");
    expect(ativo).toContain("fill-current");
  });

  it("coluna de processo — situação específica (um filtro de processo por vez)", () => {
    const inativo = html(
      createElement(Fabrica2ProcessColumnFilter, { filters: noFilters, code: "LASER" }),
    );
    expect(inativo).toContain('aria-label="Filtrar por situação do processo LASER"');
    expect(inativo).not.toContain("filtro ativo");

    const ativo = html(
      createElement(Fabrica2ProcessColumnFilter, {
        filters: parseProductionFilters({ processo: "LASER", situacao: "CONCLUIDO" }),
        code: "LASER",
      }),
    );
    expect(ativo).toContain("Filtrar por situação do processo LASER — filtro ativo");

    // Outra coluna com situação ligada NÃO sinaliza ativo nesta coluna.
    const outraColuna = html(
      createElement(Fabrica2ProcessColumnFilter, {
        filters: parseProductionFilters({ processo: "DB_CH", situacao: "NAO_INICIADO" }),
        code: "LASER",
      }),
    );
    expect(outraColuna).not.toContain("filtro ativo");
  });
});
