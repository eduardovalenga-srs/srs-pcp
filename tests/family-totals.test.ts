import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fabrica1Summary } from "@/components/fabrica1/Fabrica1Summary";
import { Fabrica2Summary } from "@/components/fabrica2/Fabrica2Summary";
import type { FamilyTotal } from "@/lib/types/production";
import { parseProductionFilters } from "@/lib/utils/filters";

vi.mock("server-only", () => ({}));

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

const FAMILIES: FamilyTotal[] = [
  { family: "GC", qty: 120, weight: 1500 },
  { family: null, qty: 3, weight: 7.5 },
];

/**
 * 035 — totais por família nos cards de resumo da Fábrica 1 e da
 * Fábrica 2. As informações já presentes (três números e chips) não
 * podem mudar: a família é um bloco novo.
 */
describe("Cards de resumo: totais por família (035)", () => {
  it("Fábrica 1: lista as famílias ABAIXO dos três números, sem alterá-los", () => {
    const markup = html(
      createElement(Fabrica1Summary, {
        total: 12,
        qtyTotal: 143,
        weightTotal: 1507.5,
        familyTotals: FAMILIES,
      }),
    );

    // Informações já presentes seguem intactas.
    expect(markup).toContain("Registros");
    expect(markup).toContain("Qtd. total");
    expect(markup).toContain("Peso total");
    expect(markup).toContain(">12<");
    expect(markup).toContain(">143<");
    expect(markup).toContain("1.507,5 kg");

    // 035: bloco novo, com a ordem do banco (qtd. desc).
    expect(markup).toContain("Famílias");
    expect(markup).toContain(">GC<");
    expect(markup).toContain("120 un · 1.500 kg");
    expect(markup).toContain("3 un · 7,5 kg");
    // Família vazia exibe "—" (único travessão do card).
    expect(markup.match(/—/g)).toHaveLength(1);
    expect(markup.indexOf("Famílias")).toBeLessThan(markup.indexOf(">GC<"));
  });

  it("Fábrica 1: lista de famílias vazia exibe '—'", () => {
    const markup = html(
      createElement(Fabrica1Summary, {
        total: 0,
        qtyTotal: 0,
        weightTotal: 0,
        familyTotals: [],
      }),
    );

    expect(markup).toContain("Famílias");
    expect(markup.match(/—/g)).toHaveLength(1);
    expect(markup).not.toContain(">GC<");
  });

  it("Fábrica 2: famílias DENTRO do chip 'Eventos' (uma única ocorrência)", () => {
    const markup = html(
      createElement(Fabrica2Summary, {
        total: 2,
        qtyTotal: 143,
        weightTotal: 1507.5,
        familyTotals: FAMILIES,
        filters: parseProductionFilters({}),
        delivery: { overdue: 1, overdueQty: 2, overdueWeight: 4 },
        expedition: { count: 1, qty: 2, weight: 3 },
      }),
    );

    // Os três chips seguem intactos.
    expect(markup).toContain("Eventos");
    expect(markup).toContain("Atrasados");
    expect(markup).toContain("Expedição");
    expect(markup).toContain("Peso total");

    // A lista entra só no card "Eventos" — os chips clicáveis não mudam.
    expect(markup.match(/Famílias/g)).toHaveLength(1);
    expect(markup).toContain("120 un · 1.500 kg");
    expect(markup).toContain("3 un · 7,5 kg");
    expect(markup.indexOf("Eventos")).toBeLessThan(markup.indexOf("Famílias"));
  });
});
