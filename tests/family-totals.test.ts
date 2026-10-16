import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fabrica1Summary } from "@/components/fabrica1/Fabrica1Summary";
import { Fabrica2Summary } from "@/components/fabrica2/Fabrica2Summary";
import { ProductionSummary } from "@/components/producao/ProductionSummary";
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
const OVERDUE_FAMILIES: FamilyTotal[] = [{ family: "PP", qty: 7, weight: 14 }];
const EXPEDITION_FAMILIES: FamilyTotal[] = [{ family: "TB", qty: 5, weight: 10 }];

const DELIVERY = { overdue: 2, overdueQty: 9, overdueWeight: 18 };
const EXPEDITION = { count: 4, qty: 5, weight: 10 };

describe("Famílias nos cards de resumo (035/037)", () => {
  it("Fábrica 1: lista as famílias ABAIXO dos três números, sem alterá-los", () => {
    const markup = html(
      createElement(Fabrica1Summary, {
        total: 12,
        qtyTotal: 143,
        weightTotal: 1507.5,
        familyTotals: FAMILIES,
        delivery: DELIVERY,
        expedition: EXPEDITION,
        overdueFamilies: OVERDUE_FAMILIES,
        expeditionFamilies: EXPEDITION_FAMILIES,
      }),
    );

    // Os três números continuam intactos (Registros, Qtd. total, Peso total).
    expect(markup).toContain("Registros");
    expect(markup).toContain("Qtd. total");
    expect(markup).toContain("Peso total");
    expect(markup).toContain(">12<");
    expect(markup).toContain(">143<");
    expect(markup).toContain("1.507,5 kg");

    // 035/037: lista em TODOS os três cards (Eventos, Atrasados, Expedição).
    expect(markup.match(/Famílias/g)).toHaveLength(3);
    expect(markup).toContain(">GC<");
    expect(markup).toContain("120 un · 1.500 kg");
    // Família vazia exibe "—" (único travessão do card).
    expect(markup).toContain("3 un · 7,5 kg");
    expect(markup.match(/—/g)).toHaveLength(1);

    // 037: cards novos com os KPIs globais + a própria lista de famílias.
    expect(markup).toContain("Atrasados");
    expect(markup).toContain("Expedição");
    expect(markup).toContain("18 kg");
    expect(markup).toContain("10 kg");
    expect(markup).toContain(">PP<");
    expect(markup).toContain("7 un · 14 kg");
    expect(markup).toContain(">TB<");
    expect(markup).toContain("5 un · 10 kg");

    // A lista vem depois do card principal.
    expect(markup.indexOf("Famílias")).toBeGreaterThan(markup.indexOf(">12<"));
  });

  it("Fábrica 1: listas de famílias vazias exibem '—'", () => {
    const markup = html(
      createElement(Fabrica1Summary, {
        total: 0,
        qtyTotal: 0,
        weightTotal: 0,
        familyTotals: [],
        delivery: { overdue: 0, overdueQty: 0, overdueWeight: 0 },
        expedition: { count: 0, qty: 0, weight: 0 },
        overdueFamilies: [],
        expeditionFamilies: [],
      }),
    );

    // Um "—" por card (3 listas vazias).
    expect(markup.match(/—/g)).toHaveLength(3);
    expect(markup).toContain("Eventos");
    expect(markup).toContain("Atrasados");
    expect(markup).toContain("Expedição");
  });

  it("Fábrica 2: famílias em Eventos, Atrasados e Expedição (037)", () => {
    const filters = parseProductionFilters({});
    const markup = html(
      createElement(Fabrica2Summary, {
        total: 12,
        qtyTotal: 143,
        weightTotal: 1507.5,
        familyTotals: FAMILIES,
        filters,
        delivery: DELIVERY,
        expedition: EXPEDITION,
        overdueFamilies: OVERDUE_FAMILIES,
        expeditionFamilies: EXPEDITION_FAMILIES,
      }),
    );

    // Os três cards de antes continuam clicáveis e com os mesmos números.
    expect(markup).toContain("Eventos");
    expect(markup).toContain("Atrasados");
    expect(markup).toContain("Expedição");
    expect(markup).toContain(">143<");
    expect(markup).toContain("1.507,5 kg");

    // 037: lista em TODOS os cards.
    expect(markup.match(/Famílias/g)).toHaveLength(3);
    expect(markup).toContain(">GC<");
    expect(markup).toContain("120 un · 1.500 kg");
    expect(markup).toContain(">PP<");
    expect(markup).toContain("7 un · 14 kg");
    expect(markup).toContain(">TB<");
    expect(markup).toContain("5 un · 10 kg");
  });

  it("Gestão de OF: famílias nos cards OFs, Atrasados e Expedição (037)", () => {
    const markup = html(
      createElement(ProductionSummary, {
        total: 5,
        qtyTotal: 40,
        weightTotal: 800,
        familyTotals: FAMILIES,
        filters: parseProductionFilters({}),
        delivery: DELIVERY,
        expedition: EXPEDITION,
        overdueFamilies: OVERDUE_FAMILIES,
        expeditionFamilies: EXPEDITION_FAMILIES,
      }),
    );

    expect(markup).toContain("OFs");
    expect(markup).toContain("Atrasados");
    expect(markup).toContain("Expedição");

    // 037: lista de famílias em todos os três cards.
    expect(markup.match(/Famílias/g)).toHaveLength(3);
    expect(markup).toContain(">GC<");
    expect(markup).toContain("120 un · 1.500 kg");
    expect(markup).toContain("7 un · 14 kg");
    expect(markup).toContain("5 un · 10 kg");

    // A lista do card "OFs" vem depois dos três números dele.
    expect(markup.indexOf("Famílias")).toBeGreaterThan(markup.indexOf(">40<"));
  });
});
