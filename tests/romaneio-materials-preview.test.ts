import { describe, expect, it } from "vitest";

import { previewRomaneioMaterials } from "@/lib/utils/romaneio";

/**
 * Preview dos materiais no CLIENTE (auto-reload do detalhe): tem que
 * espelhar o cálculo do servidor trocando só as quantidades digitadas
 * — mesma alocação proporcional, mesmo merge, mesmo parser.
 */

const CHAPA = { description: "Chapa aço 3mm", unit: "KG", quantity: 5 };
const PARAFUSO = { description: "Parafuso M8", unit: "UN", quantity: 30 };

// Raiz (qtd 20) com material próprio + filho com outro material — os
// dois entram pela alocação do RAIZ (ratio = digitado ÷ total da OF).
const allocationItems = [
  { orderItemId: "root-a", parentItemId: null, quantity: 20, materials: [CHAPA] },
  { orderItemId: "child-a1", parentItemId: "root-a", quantity: 10, materials: [PARAFUSO] },
];

const gravado = {
  description: "Cinta galvanizada",
  unit: "UN",
  quantityPlanned: 10,
  quantityReceived: 4,
  quantityUsed: 4,
};

function preview(
  overrides: Partial<Parameters<typeof previewRomaneioMaterials>[0]> = {},
): ReturnType<typeof previewRomaneioMaterials> {
  return previewRomaneioMaterials({
    status: "ABERTO",
    allocationItems,
    storedMaterials: [],
    quantities: {},
    ...overrides,
  });
}

describe("previewRomaneioMaterials — recálculo ao vivo das quantidades dos itens", () => {
  it("muda a quantidade digitada e o previsto acompanha (auto-reload)", () => {
    // 5 ÷ 20 = 0,25 → Chapa 1,25 KG · Parafuso 7,5 UN.
    const quarto = preview({ quantities: { "root-a": "5" } });
    expect(quarto.map((line) => line.description)).toEqual([
      "Chapa aço 3mm",
      "Parafuso M8",
    ]);
    expect(quarto.map((line) => line.quantityPlanned)).toEqual([1.25, 7.5]);

    // 20 ÷ 20 = 1 → alocação cheia do raiz (e do filho com ele).
    const cheio = preview({ quantities: { "root-a": "20" } });
    expect(cheio.map((line) => line.quantityPlanned)).toEqual([5, 30]);

    // Item fora da carga (vazio) → sem alocação alguma.
    expect(preview({ quantities: { "root-a": "" } })).toEqual([]);
    // Texto inválido conta como 0 — o MESMO parser do salvamento.
    expect(preview({ quantities: { "root-a": "abc" } })).toEqual([]);
  });

  it("aceita vírgula decimal como o formulário digitado", () => {
    // 1,5 ÷ 20 = 0,075 → Chapa 0,375 KG.
    const lines = preview({ quantities: { "root-a": "1,5" } });
    expect(lines.find((line) => line.description === "Chapa aço 3mm")?.quantityPlanned).toBeCloseTo(
      0.375,
    );
  });

  it("linha nova nasce com recebida/utilizada = previsto (regra do merge)", () => {
    const lines = preview({ quantities: { "root-a": "20" } });
    const chapa = lines.find((line) => line.description === "Chapa aço 3mm");
    expect(chapa?.quantityReceived).toBe(5);
    expect(chapa?.quantityUsed).toBe(5);
    expect(chapa?.quantityReturned).toBe(0);
  });

  it("mantém as linhas gravadas que saíram da alocação (item removido)", () => {
    const lines = preview({
      storedMaterials: [gravado],
      quantities: { "root-a": "5" },
    });

    // A linha sai da alocação: a RECEBIDA é preservada (vira tudo a
    // devolver) e previsto/utilizada zeram — nada se perde, nada inventa.
    const cinta = lines.find((line) => line.description === "Cinta galvanizada");
    expect(cinta).toMatchObject({
      quantityPlanned: 0,
      quantityReceived: 4,
      quantityUsed: 0,
      quantityReturned: 4,
    });
    // O que está na carga continua vindo da alocação fresca.
    expect(lines.find((line) => line.description === "Chapa aço 3mm")?.quantityPlanned).toBe(1.25);
  });

  it("a utilizada nasce da alocação e a recebida nunca fica abaixo dela", () => {
    // Gravado com recebida 1 (abaixo do alocado 5): nasce 5/5/saldo 0.
    const lines = preview({
      storedMaterials: [
        { ...gravado, description: "Chapa aço 3mm", unit: "KG", quantityReceived: 1, quantityUsed: 1 },
      ],
      quantities: { "root-a": "20" },
    });
    const chapa = lines.find((line) => line.description === "Chapa aço 3mm");
    expect(chapa).toMatchObject({
      quantityPlanned: 5,
      quantityReceived: 5,
      quantityUsed: 5,
      quantityReturned: 0,
    });

    // Recebida MAIOR que a alocada é preservada (sobra a devolver).
    const sobra = preview({
      storedMaterials: [
        { ...gravado, description: "Chapa aço 3mm", unit: "KG", quantityReceived: 8, quantityUsed: 1 },
      ],
      quantities: { "root-a": "20" },
    });
    expect(sobra.find((line) => line.description === "Chapa aço 3mm")).toMatchObject({
      quantityPlanned: 5,
      quantityReceived: 8,
      quantityUsed: 5,
      quantityReturned: 3,
    });
  });

  it("fora de ABERTO o registro congela no gravado, ignorando as quantidades", () => {
    const lines = preview({
      status: "CONFERIDO",
      storedMaterials: [gravado],
      quantities: { "root-a": "20" },
    });

    // Só o gravado — nem a alocação cheia entra.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: "Cinta galvanizada",
      quantityPlanned: 10,
      quantityReceived: 4,
      quantityUsed: 4,
      quantityReturned: 0,
    });
  });
});
