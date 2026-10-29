import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  detectHeaderRow,
  findMissingProjectColumns,
  parseExcelFile,
} from "@/lib/import/excel-parser";
import { familyFromDescription, orderStatusOf } from "@/lib/import/of-structure";
import { buildProjectOfStructure } from "@/lib/import/of-structure-project";
import { orderCodeFromFileName } from "@/lib/utils/order-code";
import { assertSheetStructure } from "@/lib/validators/import.schema";
import type { ParsedSheet } from "@/lib/types/import";

/**
 * Testes do QUARTO formato de importação: a lista de peças do projeto
 * (arquivos TUCUMANN GC GERAL) — 6 colunas, uma linha POR PEÇA, grupos
 * GT/MD como itens pai, código da OF gerado do nome do arquivo sem a
 * extensão. Inclui o teste de ponta a ponta com o arquivo real.
 */

const PROJECT_HEADERS = [
  "GT/MD",
  "PEÇA",
  "CÓDIGO DA PEÇA",
  "PEÇA PRINCIPAL",
  "QUANTIDADE EM PROJETO",
  "MASSA TOTAL DO PROJETO (KG)",
];

const FORM = { customerName: "TUCUMANN", deliveryDate: "2026-11-05" };

/** Nome de arquivo fixo nos testes — o código da OF vira "OF PROJETO-TESTE". */
const FILE_NAME = "Projeto Teste.xlsx";

/** Fixture do arquivo real (movido de public/ para tests/fixtures). */
const REAL_FILE_PATH = path.join(process.cwd(), "tests", "fixtures", "tucumann-gc-geral.xlsx");

/** Monta uma linha alinhada aos cabeçalhos informados (por nome). */
function makeRow(values: Record<string, unknown>): unknown[] {
  const out: unknown[] = new Array(PROJECT_HEADERS.length).fill(null);
  for (const [name, value] of Object.entries(values)) {
    const index = PROJECT_HEADERS.indexOf(name);
    if (index < 0) throw new Error(`Coluna de teste desconhecida: ${name}`);
    out[index] = value;
  }
  return out;
}

function sheetFrom(rows: unknown[][]): ParsedSheet {
  return { name: "Planilha1", headers: PROJECT_HEADERS, headerRowIndex: 0, rows };
}

function buildRows(rows: unknown[][]) {
  return buildProjectOfStructure(sheetFrom(rows), FORM, FILE_NAME);
}

/**
 * Lista enxuta: TT02 com 2 peças (uma com qtd 3) e GT2MD5 com 1 peça
 * (qtd 2 — espelha o 2-5GC68 do arquivo real: unit = massa ÷ qtd).
 */
function projectRows(): unknown[][] {
  return [
    makeRow({
      "GT/MD": "TT02-ESCADA DE MARINHEIRO",
      "PEÇA": "GUARDA CORPO",
      "CÓDIGO DA PEÇA": "2GC12",
      "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
      "QUANTIDADE EM PROJETO": 1,
      "MASSA TOTAL DO PROJETO (KG)": 42.93,
    }),
    makeRow({
      "GT/MD": "TT02-ESCADA DE MARINHEIRO",
      "PEÇA": "GUARDA CORPO",
      "CÓDIGO DA PEÇA": "2GC13",
      "PEÇA PRINCIPAL": "CH4.8X200",
      "QUANTIDADE EM PROJETO": 3,
      "MASSA TOTAL DO PROJETO (KG)": 12,
    }),
    makeRow({
      "GT/MD": "GT2MD5",
      "PEÇA": "GUARDA CORPO",
      "CÓDIGO DA PEÇA": "2-5GC68",
      "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
      "QUANTIDADE EM PROJETO": 2,
      "MASSA TOTAL DO PROJETO (KG)": 85.87,
    }),
  ];
}

// -------------------------------------------------------------
// Detecção de cabeçalho e validação de estrutura
// -------------------------------------------------------------

describe("detecção da lista de peças do projeto", () => {
  it("reconhece o cabeçalho e marca o formato lista-projeto", () => {
    const detection = detectHeaderRow([PROJECT_HEADERS, ...projectRows()]);
    expect(detection).toMatchObject({
      headerRowIndex: 0,
      detected: true,
      format: "lista-projeto",
    });
    expect(detection.headers).toEqual(PROJECT_HEADERS);
  });

  it("ignora linhas de título acima do cabeçalho", () => {
    const detection = detectHeaderRow([
      ["TUCUMANN GC GERAL"],
      [],
      PROJECT_HEADERS,
      ...projectRows(),
    ]);
    expect(detection).toMatchObject({ headerRowIndex: 2, detected: true, format: "lista-projeto" });
  });

  it("não confunde com o layout técnico nem com a lista de peças da 038", () => {
    const technical = detectHeaderRow([
      ["Relatório"],
      ["OF_TIPO", "of_idOF", "ps_idPos", "ps_Descr", "cp_comp"],
      ["OF", "107482"],
    ]);
    expect(technical).toMatchObject({ headerRowIndex: 1, detected: true, format: "layout-of" });

    const parts = detectHeaderRow([
      ["CONJUNTO", "PEÇA", "QTDE", "PERFIL", "MATERIAL", "COMPR.(mm)", "MASSA(Kg)"],
      ["SOL-PAS-GC1", null, 2, "GUARDA-CORPO", null, null, 13.02],
    ]);
    expect(parts).toMatchObject({ headerRowIndex: 0, detected: true, format: "lista-pecas" });
  });

  it("sem núcleo reconhecido (GT/MD + CÓDIGO DA PEÇA), devolve detected false", () => {
    const detection = detectHeaderRow([
      ["Cliente", "Entrega"],
      ["ACME", "05/11"],
    ]);
    expect(detection.detected).toBe(false);
    expect(detection.format).toBeNull();
  });

  it("detecta o cabeçalho também a partir dos bytes do .xlsx", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([PROJECT_HEADERS, ...projectRows()]),
      "Planilha1",
    );
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseExcelFile(bytes, "projeto.xlsx", 1024);

    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.headerBySheet["Planilha1"]).toMatchObject({
      detected: true,
      format: "lista-projeto",
      headerRowIndex: 0,
    });
  });

  it("lista as colunas ausentes e valida pela estrutura do formato", () => {
    expect(findMissingProjectColumns(PROJECT_HEADERS)).toEqual([]);
    expect(findMissingProjectColumns(["GT/MD", "CÓDIGO DA PEÇA"])).toEqual([
      "PEÇA",
      "QUANTIDADE EM PROJETO",
    ]);

    expect(() => assertSheetStructure(PROJECT_HEADERS, 10, "lista-projeto")).not.toThrow();
    expect(() => assertSheetStructure(["GT/MD", "PEÇA"], 10, "lista-projeto")).toThrow(
      /CÓDIGO DA PEÇA.*lista de peças do projeto precisa das colunas/,
    );
    expect(() => assertSheetStructure(PROJECT_HEADERS, 0, "lista-projeto")).toThrow(
      /não contém linhas/,
    );
  });
});

// -------------------------------------------------------------
// Construção da estrutura
// -------------------------------------------------------------

describe("buildProjectOfStructure", () => {
  it("monta OF única -> grupos GT/MD como pai -> peças como filhos", () => {
    const { orders, ignoredColumns } = buildRows(projectRows());

    expect(ignoredColumns).toEqual([]);
    expect(orders).toHaveLength(1);
    const order = orders[0]!;

    expect(order.code).toBe("OF PROJETO-TESTE");
    expect(order.type).toBe("OF");
    expect(order.customerName).toBe(FORM.customerName);
    expect(order.deliveryDate).toBe(FORM.deliveryDate);
    expect(order.description).toBe("GUARDA CORPO");
    expect(order.sourceRow).toBe(2);
    expect(order.parents).toHaveLength(2);
    expect(orderStatusOf(order.issues)).toBe("VALID");

    const first = order.parents[0]!;
    expect(first.code).toBe("TT02-ESCADA DE MARINHEIRO");
    expect(first.description).toBe("GUARDA CORPO");
    expect(first.family).toBe(familyFromDescription("GUARDA CORPO"));
    expect(first.quantity).toBe(1);
    expect(first.children).toHaveLength(2);
    // Peso unitário do pai = Σ filho (unit × qtd): 42.93×1 + (12÷3)×3.
    expect(first.unitWeightKg).toBeCloseTo(54.93, 10);
    expect(first.totalWeightKg).toBeCloseTo(54.93, 10);

    const child = first.children[0]!;
    expect(child.code).toBe("2GC12");
    expect(child.description).toBe("GUARDA CORPO");
    expect(child.family).toBe(familyFromDescription("GUARDA CORPO"));
    expect(child.quantity).toBe(1);
    expect(child.unitWeightKg).toBeCloseTo(42.93, 10);
    expect(child.totalWeightKg).toBeCloseTo(42.93, 10);
    expect(child.materials).toEqual([
      { description: "TB.RED.DN32_DIN", quantity: 1, unit: "UN", notes: null },
    ]);

    const second = first.children[1]!;
    expect(second.code).toBe("2GC13");
    expect(second.quantity).toBe(3);
    // unit = massa total ÷ quantidade do projeto.
    expect(second.unitWeightKg).toBeCloseTo(4, 10);
    expect(second.totalWeightKg).toBeCloseTo(12, 10);
    expect(second.materials[0]?.description).toBe("CH4.8X200");

    const other = order.parents[1]!;
    expect(other.code).toBe("GT2MD5");
    expect(other.quantity).toBe(1);
    expect(other.children.map((entry) => entry.code)).toEqual(["2-5GC68"]);
    // Espelha o arquivo real (qtd 2, massa 85.87): unit ≈ 42.935.
    expect(other.children[0]?.unitWeightKg).toBeCloseTo(85.87 / 2, 10);
    expect(other.children[0]?.totalWeightKg).toBeCloseTo(85.87, 10);
  });

  it("avisa peça repetida no mesmo grupo e mantém a primeira", () => {
    const { orders } = buildRows([
      makeRow({
        "GT/MD": "GT2MD5",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2-5GC68",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": 2,
        "MASSA TOTAL DO PROJETO (KG)": 85.87,
      }),
      makeRow({
        "GT/MD": "GT2MD5",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2-5GC68",
        "PEÇA PRINCIPAL": "CH4.8X200",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 95.73,
      }),
    ]);
    const order = orders[0]!;
    const parent = order.parents[0]!;
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]?.materials[0]?.description).toBe("TB.RED.DN32_DIN");
    expect(order.issues).toContainEqual(
      expect.objectContaining({ type: "DUPLICATE", severity: "warning" }),
    );
    expect(orderStatusOf(order.issues)).toBe("WARNING");
  });

  it("mantém o mesmo código de peça em grupos diferentes", () => {
    const { orders } = buildRows([
      makeRow({
        "GT/MD": "GT2MD5",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2GC12",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 42.93,
      }),
      makeRow({
        "GT/MD": "GT4MD6",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2GC12",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 35.51,
      }),
    ]);
    const order = orders[0]!;
    expect(order.parents).toHaveLength(2);
    expect(order.issues.filter((entry) => entry.type === "DUPLICATE")).toHaveLength(0);
  });

  it("linhas sem grupo ou sem código viram erro e são ignoradas", () => {
    const { orders } = buildRows([
      // Só números e material, sem GT/MD.
      makeRow({
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2GC12",
        "QUANTIDADE EM PROJETO": 1,
      }),
      // Grupo sem código de peça.
      makeRow({ "GT/MD": "TT02-ESCADA DE MARINHEIRO", "PEÇA": "GUARDA CORPO" }),
    ]);
    const order = orders[0]!;
    expect(order.parents).toHaveLength(0);
    expect(order.issues).toHaveLength(2);
    expect(order.issues.every((entry) => entry.severity === "error")).toBe(true);
    expect(order.issues.map((entry) => entry.where)).toEqual(["Linha 2", "Linha 3"]);
  });

  it("quantidade inválida vira aviso + erro; quantidade zero vira erro", () => {
    const { orders } = buildRows([
      makeRow({
        "GT/MD": "GT2MD5",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2-5GC68",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": "dois",
        "MASSA TOTAL DO PROJETO (KG)": 85.87,
      }),
      makeRow({
        "GT/MD": "GT2MD5",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2-5GC64",
        "PEÇA PRINCIPAL": "CH4.8X200",
        "QUANTIDADE EM PROJETO": 0,
        "MASSA TOTAL DO PROJETO (KG)": 95.73,
      }),
    ]);
    const order = orders[0]!;
    // Sem quantidade não há peso unitário nem total.
    expect(order.parents[0]?.children[0]?.unitWeightKg).toBeNull();
    expect(order.issues).toContainEqual(
      expect.objectContaining({ type: "NUMBER", severity: "warning", column: "QUANTIDADE EM PROJETO" }),
    );
    expect(
      order.issues.filter(
        (entry) => entry.severity === "error" && entry.type === "NUMBER",
      ),
    ).toHaveLength(2);
    expect(orderStatusOf(order.issues)).toBe("ERROR");
  });

  it("avisa filho sem matéria-prima (PEÇA PRINCIPAL vazia ou SEM MATERIAL)", () => {
    const { orders } = buildRows([
      makeRow({
        "GT/MD": "TT02-ESCADA DE MARINHEIRO",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2GC12",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 42.93,
      }),
      makeRow({
        "GT/MD": "TT02-ESCADA DE MARINHEIRO",
        "PEÇA": "GUARDA CORPO",
        "CÓDIGO DA PEÇA": "2GC13",
        "PEÇA PRINCIPAL": "SEM MATERIAL",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 71.23,
      }),
    ]);
    const order = orders[0]!;
    const warnings = order.issues.filter(
      (entry) => entry.column === "PEÇA PRINCIPAL" && entry.severity === "warning",
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toBe("Item filho sem matéria-prima informada.");
    expect(order.parents[0]?.children.every((entry) => entry.materials.length === 0)).toBe(true);
  });

  it("avisa grupo sem tipo do produto (PEÇA) e descreve o filho pelo código", () => {
    const { orders } = buildRows([
      makeRow({
        "GT/MD": "TT02-ESCADA DE MARINHEIRO",
        "CÓDIGO DA PEÇA": "2GC12",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 42.93,
      }),
      makeRow({
        "GT/MD": "TT02-ESCADA DE MARINHEIRO",
        "CÓDIGO DA PEÇA": "2GC13",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": 1,
        "MASSA TOTAL DO PROJETO (KG)": 71.23,
      }),
      // Um filho COM descrição completa o pai na ordem correta.
      makeRow({
        "GT/MD": "GT2MD5",
        "CÓDIGO DA PEÇA": "2-5GC68",
        "PEÇA": "GUARDA CORPO",
        "PEÇA PRINCIPAL": "TB.RED.DN32_DIN",
        "QUANTIDADE EM PROJETO": 2,
        "MASSA TOTAL DO PROJETO (KG)": 85.87,
      }),
    ]);
    const order = orders[0]!;
    const first = order.parents[0]!;
    expect(first.description).toBe("");
    expect(first.children[0]?.description).toBe("2GC12");
    expect(first.family).toBeNull();
    expect(order.issues).toContainEqual(
      expect.objectContaining({
        type: "REQUIRED",
        severity: "warning",
        where: "TT02-ESCADA DE MARINHEIRO",
        message: "Conjunto sem tipo do produto (PEÇA) — a descrição fica vazia.",
      }),
    );
    // Linha com PEÇA preenchida completa a descrição do pai.
    expect(order.parents[1]?.description).toBe("GUARDA CORPO");
  });

  it("lança quando faltam colunas obrigatórias da lista", () => {
    const sheet: ParsedSheet = {
      name: "Planilha1",
      headers: ["Cliente", "Entrega"],
      headerRowIndex: 0,
      rows: [["ACME", "05/11"]],
    };
    expect(() => buildProjectOfStructure(sheet, FORM, FILE_NAME)).toThrow(
      /Colunas obrigatórias ausentes na lista do projeto: GT\/MD, PEÇA, CÓDIGO DA PEÇA, QUANTIDADE EM PROJETO/,
    );
  });

  it("lista sem grupos válidos vira erro de estrutura", () => {
    const { orders } = buildRows([]);
    expect(orders[0]?.issues).toContainEqual(
      expect.objectContaining({ type: "STRUCTURE", severity: "error" }),
    );
  });
});

// -------------------------------------------------------------
// Arquivo real (TUCUMANN GC GERAL) — ponta a ponta
// -------------------------------------------------------------

describe("arquivo real TUCUMANN (tests/fixtures/tucumann-gc-geral.xlsx)", () => {
  const bytes = readFileSync(REAL_FILE_PATH);
  /** Nome do arquivo real — é dele que sai o código da OF. */
  const realFileName = "tucumann-gc-geral.xlsx";

  it("parse + detecção: 1 aba, 172 linhas, formato lista-projeto", () => {
    const parsed = parseExcelFile(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      "tucumann-gc-geral.xlsx",
      bytes.byteLength,
    );

    expect(parsed.sheets).toHaveLength(1);
    const sheet = parsed.sheets[0]!;
    expect(sheet.name).toBe("Planilha1");
    expect(parsed.headerBySheet["Planilha1"]).toMatchObject({
      detected: true,
      format: "lista-projeto",
      headerRowIndex: 0,
    });
    expect(sheet.headers).toEqual(PROJECT_HEADERS);
    expect(sheet.rows).toHaveLength(172);
  });

  it("constrói 1 OF com 6 conjuntos e 172 peças, sem erros", () => {
    const parsed = parseExcelFile(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      "tucumann-gc-geral.xlsx",
      bytes.byteLength,
    );
    const { orders, ignoredColumns } = buildProjectOfStructure(
      parsed.sheets[0]!,
      FORM,
      realFileName,
    );

    expect(ignoredColumns).toEqual([]);
    expect(orders).toHaveLength(1);
    const order = orders[0]!;

    // Código = nome do arquivo sem a extensão (mesmo arquivo, sempre igual).
    expect(order.code).toBe(orderCodeFromFileName(realFileName).code);
    expect(order.code).toBe("OF TUCUMANN-GC-GERAL");
    expect(orderCodeFromFileName(realFileName)).toEqual(orderCodeFromFileName(realFileName));

    expect(orderStatusOf(order.issues)).toBe("VALID");
    expect(order.description).toBe("GUARDA CORPO");
    expect(order.parents).toHaveLength(6);

    const children = order.parents.flatMap((parent) => parent.children);
    expect(children).toHaveLength(172);
    expect(order.parents.map((parent) => [parent.code, parent.children.length])).toEqual([
      ["TT02-ESCADA DE MARINHEIRO", 16],
      ["TT10-ESCADA DE MARINHEIRO", 7],
      ["GT2MD5", 48],
      ["GT4MD6", 46],
      ["GT10MD7", 49],
      ["10-11", 6],
    ]);

    // Todos os pais têm quantidade 1 e peso = soma dos filhos.
    for (const parent of order.parents) {
      expect(parent.quantity).toBe(1);
      const setMass = parent.children.reduce(
        (sum, child) => sum + (child.unitWeightKg ?? 0) * child.quantity,
        0,
      );
      expect(parent.unitWeightKg).toBeCloseTo(setMass, 6);
      expect(parent.totalWeightKg).toBeCloseTo(setMass, 6);
    }

    // Matérias-primas do arquivo: DN32 ×170, DN19 ×1, CH4.8X200 ×1.
    const materialCounts = new Map<string, number>();
    for (const child of children) {
      expect(child.materials).toHaveLength(1);
      const material = child.materials[0]!;
      expect(material.unit).toBe("UN");
      expect(material.quantity).toBe(child.quantity);
      materialCounts.set(material.description, (materialCounts.get(material.description) ?? 0) + 1);
    }
    expect(Object.fromEntries(materialCounts)).toEqual({
      "TB.RED.DN32_DIN": 170,
      "TB.RED.DN19_DIN": 1,
      "CH4.8X200": 1,
    });

    // Valores pontuais do arquivo (unit = massa ÷ qtd).
    const group = order.parents.find((parent) => parent.code === "GT2MD5")!;
    const gc68 = group.children.find((child) => child.code === "2-5GC68")!;
    expect(gc68.quantity).toBe(2);
    expect(gc68.unitWeightKg).toBeCloseTo(85.87 / 2, 6);
    expect(gc68.totalWeightKg).toBeCloseTo(85.87, 6);
    expect(gc68.materials[0]?.description).toBe("TB.RED.DN32_DIN");

    const gc61 = group.children.find((child) => child.code === "2-5GC61")!;
    expect(gc61.materials[0]?.description).toBe("TB.RED.DN19_DIN");

    const gc64 = group.children.find((child) => child.code === "2-5GC64")!;
    expect(gc64.materials[0]?.description).toBe("CH4.8X200");

    const first = order.parents[0]!.children[0]!;
    expect(first.code).toBe("2GC12");
    expect(first.quantity).toBe(1);
    expect(first.unitWeightKg).toBeCloseTo(71.23, 6);
  });
});
