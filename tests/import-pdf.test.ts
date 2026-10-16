import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PDF_COMPOSITION_SHEET_NAME, buildOfFromPdfRows } from "@/lib/import/of-pdf";
import {
  extractPdfRows,
  groupItemsIntoRows,
  type PdfPageText,
} from "@/lib/import/pdf-text";
import { orderStatusOf } from "@/lib/import/of-structure";
import type { PdfRow } from "@/lib/import/pdf-text";

/**
 * Importação de OF via PDF (A1 Engenharia): leitura da seção
 * "COMPOSIÇÃO DOS CONJUNTOS" -> a MESMA árvore BuiltOf da via Excel,
 * reaproveitando preview/plan/lote a jusante.
 *
 *  - parser (buildOfFromPdfRows) com linhas sintéticas;
 *  - extração real (extractPdfRows) na fixture do PDF;
 *  - árvore montada a partir do PDF real (77 pais / 154 filhos);
 *  - regressão da via Excel (validateImportFile já cobre no import.test).
 */

const FORM = { customerName: "Cliente do Formulário", deliveryDate: "2026-12-15" };

/** Linha sintética: y não é usado pelo parser, só pela extração. */
function row(text: string, page = 1): PdfRow {
  return { page, y: 0, text };
}

function rowsOf(...lines: string[]): PdfRow[] {
  return lines.map((line) => row(line));
}

/** Monta o PDF mínimo completo: metadados + seção com um conjunto. */
function fullPdfRows(): PdfRow[] {
  return rowsOf(
    "ORDEM DE FABRICAÇÃO",
    "OF Nº:2615-AA-4 Rev.0",
    "Descrição FABRICAÇÃO DE SECUNDARIOS AC - PLANTA QUÍMICA SUCURIÚ",
    "Data: 03/08/2026",
    "Cliente Teckma Engenharia",
    "COMPOSIÇÃO DOS CONJUNTOS",
    '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 10,16 kg',
    'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)',
    'MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)',
    'P-2615-4-AA-454 - 1,000 CJ (Peso: 5,28 kg)',
    'MCHPAC0J000 - CHAPA PLANA EM AC ASTM A36 - ESP. 1/2" - 0,053M2 (Peso: 5,28 kg) Dim. 230x230',
    "PLACA DE IDENTIFICAÇÃO",
  );
}

// -------------------------------------------------------------
// Parser (linhas sintéticas)
// -------------------------------------------------------------
// Mapeamento aprovado campo a campo: pedido OF (normalizeOrderCode),
// descrição = descrição do RESUMO, pai = cabeçalho do conjunto (com
// Peso Unitário), filho = peça CJ (código vira descrição), material =
// descrição entre hifens + quantidade = PESO em KG (medida dimensional
// e Dim. vão para observações), cliente/entrega SÓ do formulário.

describe("buildOfFromPdfRows (parser sintético)", () => {
  it("monta a hierarquia completa com mapeamento aprovado", () => {
    const { orders } = buildOfFromPdfRows(fullPdfRows(), FORM);
    expect(orders).toHaveLength(1);
    const order = orders[0];
    if (!order) return;

    // Pedido: tipo OF, código normalizado, descrição do RESUMO, cliente/entrega do formulário.
    expect(order.code).toBe("OF 2615-AA-4");
    expect(order.type).toBe("OF");
    expect(order.description).toBe("FABRICAÇÃO DE SECUNDARIOS AC - PLANTA QUÍMICA SUCURIÚ");
    expect(order.customerName).toBe(FORM.customerName);
    expect(order.deliveryDate).toBe(FORM.deliveryDate);
    expect(orderStatusOf(order.issues)).toBe("VALID");

    expect(order.parents).toHaveLength(1);
    const pai = order.parents[0];
    if (!pai) return;

    expect(pai.code).toBe("2615-4-PS-1203-0161");
    expect(pai.description).toBe("SUPORTE SECUNDÁRIO");
    expect(pai.family).toBe("SS");
    expect(pai.quantity).toBe(1);
    expect(pai.unitWeightKg).toBe(10.16);
    expect(pai.totalWeightKg).toBe(10.16);
    expect(pai.deliveryDate).toBe(FORM.deliveryDate);
    expect(pai.materials).toEqual([]); // todas as MP ficam nos filhos
    expect(pai.children).toHaveLength(2);

    // Filho CJ: descrição = o próprio código, família pela regra única.
    const filho = pai.children[0];
    expect(filho).toMatchObject({
      code: "P-2615-4-AA-522",
      description: "P-2615-4-AA-522",
      family: "P24A5",
      quantity: 1,
      unitWeightKg: 4.88,
      totalWeightKg: 4.88,
      deliveryDate: FORM.deliveryDate,
    });
    // Material: descrição só entre os hifens, quantidade = peso em KG.
    expect(filho?.materials).toEqual([
      {
        description: 'PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8"',
        quantity: 4.88,
        unit: "KG",
        notes: "MPELIAC2NH0 · 0,335M",
      },
    ]);

    // Segundo filho com Dim.: observações carregam código · medida · dims.
    const chapa = pai.children[1];
    expect(chapa).toMatchObject({ code: "P-2615-4-AA-454", unitWeightKg: 5.28 });
    expect(chapa?.materials).toEqual([
      {
        description: 'CHAPA PLANA EM AC ASTM A36 - ESP. 1/2"',
        quantity: 5.28,
        unit: "KG",
        notes: "MCHPAC0J000 · 0,053M2 · 230x230",
      },
    ]);

    // Soma dos filhos (4,88 + 5,28 = 10,16) bate com o Peso Unitário: sem avisos.
    expect(order.issues).toEqual([]);
  });

  it("lê cliente e data de entrega APENAS do formulário (ignora o PDF)", () => {
    const { orders } = buildOfFromPdfRows(fullPdfRows(), {
      customerName: "OUTRO CLIENTE",
      deliveryDate: "2030-01-01",
    });
    const order = orders[0];
    expect(order?.customerName).toBe("OUTRO CLIENTE");
    expect(order?.deliveryDate).toBe("2030-01-01");
    expect(order?.parents[0]?.deliveryDate).toBe("2030-01-01");
    expect(order?.parents[0]?.children[0]?.deliveryDate).toBe("2030-01-01");
    // A descrição continua vindo do RESUMO (não do cliente impresso no PDF).
    expect(order?.description).toBe("FABRICAÇÃO DE SECUNDARIOS AC - PLANTA QUÍMICA SUCURIÚ");
  });

  it("pareia material e filho por PESO coincidente, mesmo com material ACIMA do filho", () => {
    const { orders } = buildOfFromPdfRows(
      rowsOf(
        "OF Nº:2615-AA-4",
        "Descrição FABRICAÇÃO DE SECUNDARIOS",
        "COMPOSIÇÃO DOS CONJUNTOS",
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 10,16 kg',
        // Material ANTES do filho: o pareamento é pelo peso, não pela ordem.
        'MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)',
        'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)',
        'MCHPAC0J000 - CHAPA PLANA EM AC ASTM A36 - ESP. 1/2" - 0,053M2 (Peso: 5,28 kg) Dim. 230x230',
        'P-2615-4-AA-454 - 1,000 CJ (Peso: 5,28 kg)',
        "PLACA DE IDENTIFICAÇÃO",
      ),
      FORM,
    );
    const pai = orders[0]?.parents[0];
    expect(pai?.children[0]?.materials[0]?.quantity).toBe(4.88);
    expect(pai?.children[1]?.materials[0]?.quantity).toBe(5.28);
    expect(orders[0]?.issues).toEqual([]);
  });

  it("aceita bloco que CRUZA páginas (pai numa página, filhos na outra)", () => {
    const { orders } = buildOfFromPdfRows(
      [
        row("OF Nº:2615-AA-4", 1),
        row("Descrição FABRICAÇÃO DE SECUNDARIOS", 1),
        row("COMPOSIÇÃO DOS CONJUNTOS", 1),
        // Só um filho (4,88): o Peso Unitário casa com a soma dos filhos.
        row('2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 4,88 kg', 1),
        row("OF Nº:2615-AA-4 Rev.0", 2), // banner de página: ignorado
        row('P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)', 2),
        row('MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)', 2),
        row("PLACA DE IDENTIFICAÇÃO", 3),
      ],
      FORM,
    );
    const pai = orders[0]?.parents[0];
    expect(pai?.children).toHaveLength(1);
    expect(pai?.children[0]?.materials[0]?.quantity).toBe(4.88);
    expect(orders[0]?.issues).toEqual([]);
  });

  it("encerra a leitura em outra seção (PLACA DE IDENTIFICAÇÃO / RESUMO)", () => {
    const fim = fullPdfRows();
    // Já termina em PLACA; acrescenta linhas que NÃO devem entrar.
    fim.push(row("QUALQUER COISA - 1 PÇS"));
    const { orders } = buildOfFromPdfRows(fim, FORM);
    expect(orders[0]?.parents).toHaveLength(1);
  });

  it("reusa o pai pelo código (blocos repetidos do mesmo documento)", () => {
    const { orders } = buildOfFromPdfRows(
      rowsOf(
        "OF Nº:2615-AA-4",
        "Descrição FABRICAÇÃO DE SECUNDARIOS",
        "COMPOSIÇÃO DOS CONJUNTOS",
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 4,88 kg',
        'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)',
        'MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)',
        // Mesmo pai aparece de novo (mesma OF, outra página): soma filhos.
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 5,28 kg',
        'P-2615-4-AA-454 - 1,000 CJ (Peso: 5,28 kg)',
        'MCHPAC0J000 - CHAPA PLANA EM AC ASTM A36 - ESP. 1/2" - 0,053M2 (Peso: 5,28 kg) Dim. 230x230',
        "PLACA DE IDENTIFICAÇÃO",
      ),
      FORM,
    );
    const order = orders[0];
    expect(order?.parents).toHaveLength(1);
    expect(order?.parents[0]?.children.map((child) => child.code)).toEqual([
      "P-2615-4-AA-522",
      "P-2615-4-AA-454",
    ]);
    // O Peso Unitário do cabeçalho é fixado na 1ª ocorrência (4,88), mas a
    // soma conferida é sobre os filhos ACUMULADOS (4,88 + 5,28 = 10,16) ->
    // o aviso de divergência é esperado e aponta o código do pai.
    expect(order?.issues.filter((entry) => entry.type === "NUMBER")).toEqual([
      expect.objectContaining({ severity: "warning", where: "2615-4-PS-1203-0161" }),
    ]);
  });

  // ---------------------------------------------------------
  // Validações / avisos (espelham o caminho da planilha)
  // ---------------------------------------------------------

  it("filho repetido mantém a primeira ocorrência e avisa DUPLICATE", () => {
    const { orders } = buildOfFromPdfRows(
      rowsOf(
        "OF Nº:2615-AA-4",
        "Descrição FABRICAÇÃO DE SECUNDARIOS",
        "COMPOSIÇÃO DOS CONJUNTOS",
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 10,16 kg',
        'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)',
        'MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)',
        'P-2615-4-AA-522 - 9,000 CJ (Peso: 4,88 kg)', // repetido
        "PLACA DE IDENTIFICAÇÃO",
      ),
      FORM,
    );
    const order = orders[0];
    expect(order?.parents[0]?.children).toHaveLength(1);
    expect(order?.parents[0]?.children[0]?.quantity).toBe(1); // primeira ocorrência
    expect(order?.issues.filter((entry) => entry.type === "DUPLICATE")).toEqual([
      expect.objectContaining({ type: "DUPLICATE", severity: "warning" }),
    ]);
    expect(orderStatusOf(order?.issues ?? [])).toBe("WARNING");
  });

  it("filho sem matéria-prima gera aviso REQUIRED", () => {
    const { orders } = buildOfFromPdfRows(
      rowsOf(
        "OF Nº:2615-AA-4",
        "Descrição FABRICAÇÃO DE SECUNDARIOS",
        "COMPOSIÇÃO DOS CONJUNTOS",
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 4,88 kg',
        'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)', // sem material
        "PLACA DE IDENTIFICAÇÃO",
      ),
      FORM,
    );
    expect(orders[0]?.issues.filter((entry) => entry.type === "REQUIRED")).toEqual([
      expect.objectContaining({ type: "REQUIRED", severity: "warning" }),
    ]);
  });

  it("material sem peça correspondente vai para o pai com aviso", () => {
    const { orders } = buildOfFromPdfRows(
      rowsOf(
        "OF Nº:2615-AA-4",
        "Descrição FABRICAÇÃO DE SECUNDARIOS",
        "COMPOSIÇÃO DOS CONJUNTOS",
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 20,00 kg',
        'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)',
        'MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)',
        // Material órfão: peso (9,99) não casa nenhum filho e sobra mais de um.
        'MPSOLDX9999 - BARRA DE SOLDADO - 1,000M (Peso: 9,99 kg)',
        'P-2615-4-AA-454 - 1,000 CJ (Peso: 5,28 kg)',
        'MCHPAC0J000 - CHAPA PLANA EM AC ASTM A36 - ESP. 1/2" - 0,053M2 (Peso: 5,28 kg) Dim. 230x230',
        "PLACA DE IDENTIFICAÇÃO",
      ),
      FORM,
    );
    const order = orders[0];
    const pai = order?.parents[0];
    // O órfão foi anexado ao pai (não some, não vai para filho errado).
    expect(pai?.materials.map((material) => material.notes)).toEqual(
      expect.arrayContaining(["MPSOLDX9999 · 1,000M"]),
    );
    expect(order?.issues.filter((entry) => entry.type === "STRUCTURE")).toEqual([
      expect.objectContaining({ type: "STRUCTURE", severity: "warning" }),
    ]);
  });

  it("soma dos filhos divergente do Peso Unitário gera aviso NUMBER", () => {
    const { orders } = buildOfFromPdfRows(
      rowsOf(
        "OF Nº:2615-AA-4",
        "Descrição FABRICAÇÃO DE SECUNDARIOS",
        "COMPOSIÇÃO DOS CONJUNTOS",
        // 4,88 + 5,28 = 10,16, mas o cabeçalho declara 1,00 -> diverge.
        '2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS Peso Unitário: 1,00 kg',
        'P-2615-4-AA-522 - 1,000 CJ (Peso: 4,88 kg)',
        'MPELIAC2NH0 - PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8" - 0,335M (Peso: 4,88 kg)',
        'P-2615-4-AA-454 - 1,000 CJ (Peso: 5,28 kg)',
        'MCHPAC0J000 - CHAPA PLANA EM AC ASTM A36 - ESP. 1/2" - 0,053M2 (Peso: 5,28 kg) Dim. 230x230',
        "PLACA DE IDENTIFICAÇÃO",
      ),
      FORM,
    );
    expect(orders[0]?.issues).toEqual([
      expect.objectContaining({ type: "NUMBER", severity: "warning" }),
    ]);
  });

  // ---------------------------------------------------------
  // Erros amigáveis (entrada do usuário, não falha de sistema)
  // ---------------------------------------------------------

  it("sem a seção de composição lança erro amigável", () => {
    expect(() =>
      buildOfFromPdfRows(rowsOf("OF Nº:2615-AA-4", "Descrição QUALQUER", "RESUMO"), FORM),
    ).toThrow(/COMPOSIÇÃO DOS CONJUNTOS/);
  });

  it("sem o código da OF lança erro amigável", () => {
    expect(() =>
      buildOfFromPdfRows(rowsOf("Descrição FABRICAÇÃO", "COMPOSIÇÃO DOS CONJUNTOS"), FORM),
    ).toThrow(/código da OF/);
  });

  it("com a seção mas nenhum conjunto lança erro amigável", () => {
    expect(() =>
      buildOfFromPdfRows(
        rowsOf("OF Nº:2615-AA-4", "Descrição FABRICAÇÃO", "COMPOSIÇÃO DOS CONJUNTOS", "PLACA DE IDENTIFICAÇÃO"),
        FORM,
      ),
    ).toThrow(/nenhum conjunto/);
  });

  it("expõe o nome da seção esperada (pseudo-aba do wizard)", () => {
    expect(PDF_COMPOSITION_SHEET_NAME).toBe("Composição dos conjuntos");
  });
});

// -------------------------------------------------------------
// Extração real: fixture do PDF da A1 (fixture de teste reduzida)
// -------------------------------------------------------------

describe("extractPdfRows / groupItemsIntoRows", () => {
  it("groupItemsIntoRows junta itens da mesma linha (tolerância de Y)", () => {
    const pages: PdfPageText[] = [
      {
        page: 1,
        items: [
          { str: "2615-4-PS-1203-0161", x: 20, y: 500 },
          { str: "SUPORTE SECUNDÁRIO", x: 200, y: 500.8 }, // mesma linha
          { str: "- 1 PÇS", x: 400, y: 499.6 }, // mesma linha
          { str: "linha de baixo", x: 20, y: 480 }, // outra linha
        ],
      },
    ];
    const rows = groupItemsIntoRows(pages);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.text).toBe("2615-4-PS-1203-0161 SUPORTE SECUNDÁRIO - 1 PÇS");
    expect(rows[1]?.text).toBe("linha de baixo");
  });

  it("groupItemsIntoRows separa itens com Y distinto (linha nova)", () => {
    const pages: PdfPageText[] = [
      {
        page: 3,
        items: [
          { str: "A", x: 0, y: 100 },
          { str: "B", x: 0, y: 60 }, // diferença > 2.5
        ],
      },
    ];
    const rows = groupItemsIntoRows(pages);
    expect(rows.map((entry) => entry.text)).toEqual(["A", "B"]);
    expect(rows.map((entry) => entry.page)).toEqual([3, 3]);
  });

  it("extractPdfRows lê o PDF real e devolve acentos corretos", async () => {
    const fixturePath = path.join(process.cwd(), "tests", "fixtures", "of-2615-aa-4.pdf");
    const buffer = readFileSync(fixturePath);
    const rows = await extractPdfRows(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    );

    expect(rows.length).toBeGreaterThan(50);
    const todos = rows.map((entry) => entry.text).join("\n");
    expect(todos).toContain("COMPOSIÇÃO DOS CONJUNTOS");
    expect(todos).toContain("SUPORTE SECUNDÁRIO"); // acento vindo do ToUnicode
    expect(todos).toContain("Peso Unitário");
    expect(rows.every((entry) => entry.page >= 1)).toBe(true);
  });
});

// -------------------------------------------------------------
// Árvore montada a partir do PDF REAL (fixture completa)
// -------------------------------------------------------------

describe("buildOfFromPdfRows (PDF real da fixture)", () => {
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "of-2615-aa-4.pdf");
  const buffer = readFileSync(fixturePath);

  async function buildReal() {
    const rows = await extractPdfRows(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    );
    return buildOfFromPdfRows(rows, FORM);
  }

  it("constrói 77 pais, 154 filhos e 154 materiais sem erros", async () => {
    const { orders } = await buildReal();
    expect(orders).toHaveLength(1);
    const order = orders[0];
    if (!order) return;

    const parents = order.parents;
    const children = parents.flatMap((parent) => parent.children);
    const materials = parents.reduce(
      (total, parent) =>
        total + parent.materials.length + parent.children.reduce((sum, child) => sum + child.materials.length, 0),
      0,
    );

    expect(parents).toHaveLength(77);
    expect(children).toHaveLength(154);
    expect(materials).toBe(154); // todas nos filhos: nenhuma órfã neste PDF
    expect(orderStatusOf(order.issues)).not.toBe("ERROR");

    // Nenhum pai sem MP direta e nenhuma MP órfã: nenhum STRUCTURE.
    expect(order.issues.filter((entry) => entry.type === "STRUCTURE")).toEqual([]);
    for (const parent of parents) expect(parent.materials).toEqual([]);
  });

  it("lê metadados da OF (código, tipo, descrição) e cliente/entrega do formulário", async () => {
    const { orders } = await buildReal();
    const order = orders[0];
    expect(order?.code).toBe("OF 2615-AA-4");
    expect(order?.type).toBe("OF");
    expect(order?.description).toBe("FABRICAÇÃO DE SECUNDARIOS AC - PLANTA QUÍMICA SUCURIÚ");
    expect(order?.customerName).toBe(FORM.customerName);
    expect(order?.deliveryDate).toBe(FORM.deliveryDate);
  });

  it("reproduz o bloco 0161 (materiais e observações exatos)", async () => {
    const { orders } = await buildReal();
    const pai = orders[0]?.parents.find((parent) => parent.code === "2615-4-PS-1203-0161");
    expect(pai).toBeDefined();
    expect(pai?.description).toBe("SUPORTE SECUNDÁRIO");
    expect(pai?.family).toBe("SS");
    expect(pai?.quantity).toBe(1);
    expect(pai?.unitWeightKg).toBe(10.16);
    expect(pai?.children.map((child) => child.code)).toEqual(["P-2615-4-AA-522", "P-2615-4-AA-530"]);

    const perfil = pai?.children[0];
    expect(perfil?.family).toBe("P24A5");
    expect(perfil?.materials[0]).toEqual({
      description: 'PERFIL L LAMINADO DE ABAS IGUAIS EM AC ASTM A36 - L 4" X 3/8"',
      quantity: 4.88,
      unit: "KG",
      notes: "MPELIAC2NH0 · 0,335M",
    });

    const chapa = pai?.children[1];
    expect(chapa?.materials[0]).toEqual({
      description: 'CHAPA PLANA EM AC ASTM A36 - ESP. 1/2"',
      quantity: 5.28,
      unit: "KG",
      notes: "MCHPAC0J000 · 0,053M2 · 230x230",
    });
  });

  it("todos os pais têm família, descrição e quantidade válidas", async () => {
    const { orders } = await buildReal();
    for (const parent of orders[0]?.parents ?? []) {
      expect(parent.description).toBeTruthy();
      expect(parent.family).toBeTruthy();
      expect(parent.quantity).toBeGreaterThan(0);
      for (const child of parent.children) {
        expect(child.family).toBeTruthy();
        expect(child.quantity).toBeGreaterThan(0);
        for (const material of child.materials) expect(material.unit).toBe("KG");
      }
    }
  });
});
