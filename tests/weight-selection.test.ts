import { describe, expect, it } from "vitest";

import { parseWeightSelection } from "@/lib/utils/weight-selection";

const TODAY = "2026-11-17";

describe("parseWeightSelection", () => {
  it("aceita os filtros válidos da tela", () => {
    const result = parseWeightSelection({
      granularity: "week",
      anchor: "2026-11-13",
      processCode: "LASER",
      productGroupId: "7",
      fallbackAnchor: TODAY,
    });

    expect(result).toEqual({
      success: true,
      selection: {
        granularity: "week",
        anchor: "2026-11-13",
        processCode: "LASER",
        productGroupIds: [7],
        withoutProductGroup: false,
      },
    });
  });

  it("rejeita granularidade desconhecida", () => {
    const result = parseWeightSelection({ granularity: "year", fallbackAnchor: TODAY });
    expect(result).toEqual({ success: false, message: "Período inválido." });
  });

  it("usa a âncora de fallback quando a data vier vazia ou inválida", () => {
    for (const anchor of ["", "   ", "2026-13-40", "ontem"]) {
      const result = parseWeightSelection({ granularity: "day", anchor, fallbackAnchor: TODAY });
      expect(result.success && result.selection.anchor).toBe(TODAY);
    }
  });

  it("trata 'todos os processos' como ausência de filtro", () => {
    for (const processCode of [undefined, null, "", "  ", "ALL"]) {
      const result = parseWeightSelection({
        granularity: "month",
        processCode,
        fallbackAnchor: TODAY,
      });
      expect(result.success && result.selection.processCode).toBeNull();
    }
  });

  it("rejeita processo longo ou com caracteres de controle", () => {
    expect(
      parseWeightSelection({
        granularity: "month",
        processCode: "X".repeat(61),
        fallbackAnchor: TODAY,
      }),
    ).toEqual({ success: false, message: "Processo inválido." });

    expect(
      parseWeightSelection({
        granularity: "month",
        processCode: "LA\u0000SER",
        fallbackAnchor: TODAY,
      }),
    ).toEqual({ success: false, message: "Processo inválido." });
  });

  it("converte os ids de família e ignora valores vazios", () => {
    const selected = parseWeightSelection({
      granularity: "month",
      productGroupId: 12,
      fallbackAnchor: TODAY,
    });
    expect(selected.success && selected.selection.productGroupIds).toEqual([12]);

    const none = parseWeightSelection({
      granularity: "month",
      productGroupId: "  ",
      fallbackAnchor: TODAY,
    });
    expect(none.success && none.selection.productGroupIds).toEqual([]);
  });

  it("aceita várias famílias e remove ids repetidos", () => {
    const result = parseWeightSelection({
      granularity: "month",
      families: "3, 7,3,sem-familia",
      fallbackAnchor: TODAY,
    });
    expect(result).toEqual({
      success: true,
      selection: {
        granularity: "month",
        anchor: TODAY,
        processCode: null,
        productGroupIds: [3, 7],
        withoutProductGroup: true,
      },
    });
  });

  it("rejeita família não inteira, zero ou negativa", () => {
    for (const productGroupId of ["0", "-1", "1.5", "abc"]) {
      expect(
        parseWeightSelection({ granularity: "month", productGroupIds: [productGroupId], fallbackAnchor: TODAY }),
      ).toEqual({ success: false, message: "Família inválida." });
    }
  });

  it("permite combinar 'sem família' com outras famílias", () => {
    const semFamilia = parseWeightSelection({
      granularity: "month",
      withoutProductGroup: "true",
      fallbackAnchor: TODAY,
    });
    expect(semFamilia.success && semFamilia.selection.withoutProductGroup).toBe(true);

    const comGrupo = parseWeightSelection({
      granularity: "month",
      productGroupIds: ["3"],
      withoutProductGroup: true,
      fallbackAnchor: TODAY,
    });
    expect(comGrupo.success && comGrupo.selection).toMatchObject({
      productGroupIds: [3],
      withoutProductGroup: true,
    });
  });
});
