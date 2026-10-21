import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Fabrica2Summary } from "@/components/fabrica2/Fabrica2Summary";
import { ProductionSummary } from "@/components/producao/ProductionSummary";
import { parseProductionFilters } from "@/lib/utils/filters";

/** Fatia do HTML entre dois rótulos de card (os cards saem na ordem do array). */
function cardSection(html: string, label: string, endLabel?: string): string {
  const from = html.indexOf(label);
  if (from < 0) return "";
  const to = endLabel ? html.indexOf(endLabel, from) : html.length;
  return html.slice(from, to < 0 ? html.length : to);
}

describe("ProductionSummary — cards Atrasados/Expedição filtrados (041)", () => {
  const html = renderToStaticMarkup(
    createElement(ProductionSummary, {
      total: 12,
      qtyTotal: 30,
      weightTotal: 120,
      filters: parseProductionFilters({}),
      // 041: totais do CONJUNTO FILTRADO (vêm da RPC da lista).
      overdue: { records: 3, qty: 9, weight: 12.5 },
      expedition: { records: 4, qty: 8, weight: 10 },
    }),
  );

  it("mostra o KPI de itens atrasados do recorte filtrado", () => {
    const atrasados = cardSection(html, "Atrasados", "Expedição");
    expect(atrasados).not.toBe("");
    expect(atrasados).toContain(">3<"); // Itens
    expect(atrasados).toContain(">9<"); // Qtd. total
    expect(atrasados).toContain("12,5 kg"); // Peso total
  });

  it("mostra o KPI de expedição do recorte filtrado", () => {
    const expedicao = cardSection(html, "Expedição");
    expect(expedicao).not.toBe("");
    expect(expedicao).toContain(">4<"); // Itens
    expect(expedicao).toContain(">8<"); // Qtd. total
    expect(expedicao).toContain("10 kg"); // Peso total
  });

  it("o card OFs continua com a lista filtrada inteira", () => {
    const ofs = cardSection(html, "OFs", "Atrasados");
    expect(ofs).toContain(">12<");
    expect(ofs).toContain(">30<");
    expect(ofs).toContain("120 kg");
  });

  it("os cards seguem clicáveis aplicando o atalho de filtro", () => {
    expect(html).toContain('href="/gestao-entregas?entrega=OVERDUE"');
    expect(html).toContain('href="/gestao-entregas?processo=EXP&amp;situacao=CONCLUIDO"');
  });
});

describe("Fabrica2Summary — cards Atrasados/Expedição filtrados (041)", () => {
  const html = renderToStaticMarkup(
    createElement(Fabrica2Summary, {
      total: 20,
      qtyTotal: 45,
      weightTotal: 200,
      filters: parseProductionFilters({}),
      // 041: itens atrasados/expeditos do CONJUNTO FILTRADO.
      overdue: { records: 5, qty: 11, weight: 30 },
      expedition: { records: 7, qty: 14, weight: 21 },
    }),
  );

  it("mostra o KPI de itens atrasados do recorte filtrado", () => {
    const atrasados = cardSection(html, "Atrasados", "Expedição");
    expect(atrasados).not.toBe("");
    expect(atrasados).toContain(">5<"); // Registros
    expect(atrasados).toContain(">11<"); // Qtd. total
    expect(atrasados).toContain("30 kg"); // Peso total
  });

  it("mostra o KPI de expedição do recorte filtrado", () => {
    const expedicao = cardSection(html, "Expedição");
    expect(expedicao).not.toBe("");
    expect(expedicao).toContain(">7<"); // Registros
    expect(expedicao).toContain(">14<"); // Qtd. total
    expect(expedicao).toContain("21 kg"); // Peso total
  });

  it("o card Eventos continua com a lista filtrada inteira", () => {
    const eventos = cardSection(html, "Eventos", "Atrasados");
    expect(eventos).toContain(">20<");
    expect(eventos).toContain(">45<");
    expect(eventos).toContain("200 kg");
  });

  it("os cards seguem clicáveis aplicando o atalho de filtro", () => {
    expect(html).toContain('href="/fabrica-2?entrega=OVERDUE"');
    expect(html).toContain('href="/fabrica-2?processo=EXP&amp;situacao=CONCLUIDO"');
  });
});
