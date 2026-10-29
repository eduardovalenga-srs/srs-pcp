import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fabrica1Summary } from "@/components/fabrica1/Fabrica1Summary";
import { parseChildItemFilters } from "@/lib/utils/filters";

/** Fatia do HTML entre dois rótulos de card (os cards saem na ordem do array). */
function cardSection(html: string, label: string, endLabel?: string): string {
  const from = html.indexOf(label);
  if (from < 0) return "";
  const to = endLabel ? html.indexOf(endLabel, from) : html.length;
  return html.slice(from, to < 0 ? html.length : to);
}

describe("Fabrica1Summary — card Atrasados pela regra do KIT", () => {
  const html = renderToStaticMarkup(
    createElement(Fabrica1Summary, {
      total: 40,
      qtyTotal: 400,
      weightTotal: 900,
      // Regra nova: grupos do conjunto filtrado com o início do KIT vencido.
      kitOverdue: { records: 3, qty: 12, weight: 7.5 },
      // Card KIT continua com o KPI global de item raiz.
      expedition: { count: 1, qty: 2, weight: 1 },
      // Cards clicáveis: os filtros ativos da tela alimentam os links.
      filters: parseChildItemFilters({}),
    }),
  );

  it("mostra os três números do KPI de KIT no card Atrasados", () => {
    const atrasados = cardSection(html, "Atrasados", "KIT");
    expect(atrasados).not.toBe("");
    expect(atrasados).toContain(">3<"); // Registros
    expect(atrasados).toContain(">12<"); // Qtd. total
    expect(atrasados).toContain("7,5 kg"); // Peso total
  });

  it("mantém o card KIT com o KPI global de expedição", () => {
    const kit = cardSection(html, "KIT");
    expect(kit).toContain(">1<");
    expect(kit).toContain("1 kg");
  });

  it("o card Eventos continua com o conjunto filtrado inteiro", () => {
    const eventos = cardSection(html, "Eventos", "Atrasados");
    expect(eventos).toContain(">40<");
    expect(eventos).toContain(">400<");
    expect(eventos).toContain("900 kg");
  });

  it("o card KIT aplica o filtro de expedição concluída", () => {
    expect(html).toContain('href="/fabrica-1?processo=EXP&amp;situacao=CONCLUIDO"');
  });

  it("o card Atrasados aplica o recorte do KIT vencido", () => {
    expect(html).toContain('href="/fabrica-1?atrasados=1"');
  });

  it("marca o card Atrasados como ativo quando o recorte já está ligado", () => {
    const ativo = renderToStaticMarkup(
      createElement(Fabrica1Summary, {
        total: 3,
        qtyTotal: 12,
        weightTotal: 7.5,
        kitOverdue: { records: 3, qty: 12, weight: 7.5 },
        expedition: { count: 1, qty: 2, weight: 1 },
        filters: parseChildItemFilters({ atrasados: "1" }),
      }),
    );

    const atrasados = cardSection(ativo, "Atrasados", "KIT");
    expect(atrasados).toContain("aria-current");
    expect(atrasados).toContain('href="/fabrica-1?atrasados=1"');
  });
});
