import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fabrica1Summary } from "@/components/fabrica1/Fabrica1Summary";

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
});
