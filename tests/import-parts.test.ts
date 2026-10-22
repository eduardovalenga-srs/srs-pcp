import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  detectHeaderRow,
  findMissingPartsColumns,
  parseExcelFile,
} from "@/lib/import/excel-parser";
import { familyFromDescription, orderStatusOf } from "@/lib/import/of-structure";
import { buildPartsOfStructure } from "@/lib/import/of-structure-parts";
import {
  fileKeyFromBytes,
  normalizeOrderCode,
  orderCodeFromDateAndFileKey,
  orderCodeFromDeliveryDate,
} from "@/lib/utils/order-code";
import { assertSheetStructure } from "@/lib/validators/import.schema";
import type { ParsedSheet } from "@/lib/types/import";

/**
 * Testes da lista de peças e conjuntos de cliente (038) — 7 colunas,
 * conjuntos como itens pai, peças como filhos e código de OF gerado da
 * data de entrega + sufixo derivado dos bytes do arquivo.
 */

const PARTS_HEADERS = [
  "CONJUNTO",
  "PEÇA",
  "QTDE",
  "PERFIL",
  "MATERIAL",
  "COMPR.(mm)",
  "MASSA(Kg)",
];

const FORM = { customerName: "VIA RONDON", deliveryDate: "2026-11-05" };

/** Chave de arquivo fixa nos testes — o sufixo do código vira "3K7Q". */
const FILE_KEY = "3k7q";

/** Monta uma linha alinhada aos cabeçalhos informados (por nome). */
function makeRow(values: Record<string, unknown>): unknown[] {
  const out: unknown[] = new Array(PARTS_HEADERS.length).fill(null);
  for (const [name, value] of Object.entries(values)) {
    const index = PARTS_HEADERS.indexOf(name);
    if (index < 0) throw new Error(`Coluna de teste desconhecida: ${name}`);
    out[index] = value;
  }
  return out;
}

function sheetFrom(rows: unknown[][]): ParsedSheet {
  return { name: "Planilha1", headers: PARTS_HEADERS, headerRowIndex: 0, rows };
}

function buildRows(rows: unknown[][]) {
  return buildPartsOfStructure(sheetFrom(rows), FORM, FILE_KEY);
}

/**
 * Lista completa: GC1 com 2 peças (massa exata da fórmula) e GC52 com
 * 1 peça. Linhas-mãe sem PEÇA; peças com CONJUNTO vazio.
 */
function fullListRows(): unknown[][] {
  return [
    makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 2, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 13.02 }),
    makeRow({
      "PEÇA": "P113",
      QTDE: 1,
      PERFIL: "TB. RED. 42,2X3,56",
      MATERIAL: "DIN 2440",
      "COMPR.(mm)": 260,
      "MASSA(Kg)": 0.91,
    }),
    makeRow({
      "PEÇA": "P194",
      QTDE: 10,
      PERFIL: "BARRA22X3.2",
      MATERIAL: "A36",
      "COMPR.(mm)": 995,
      "MASSA(Kg)": 0.56,
    }),
    makeRow({ CONJUNTO: "SOL-PAS-GC52", QTDE: 11, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 22 }),
    makeRow({
      "PEÇA": "P187",
      QTDE: 20,
      PERFIL: "BR 12,5",
      MATERIAL: "SAE_1045",
      "COMPR.(mm)": 104,
      "MASSA(Kg)": 0.1,
    }),
  ];
}

// -------------------------------------------------------------
// Detecção de cabeçalho e validação de estrutura
// -------------------------------------------------------------

describe("detecção da lista de peças e conjuntos", () => {
  it("reconhece o cabeçalho e marca o formato lista-pecas", () => {
    const detection = detectHeaderRow([PARTS_HEADERS, ...fullListRows()]);
    expect(detection).toMatchObject({
      headerRowIndex: 0,
      detected: true,
      format: "lista-pecas",
    });
    expect(detection.headers).toEqual(PARTS_HEADERS);
  });

  it("continua reconhecendo o layout técnico como layout-of", () => {
    const detection = detectHeaderRow([
      ["Relatório"],
      ["OF_TIPO", "of_idOF", "ps_idPos", "ps_Descr", "cp_comp"],
      ["OF", "107482"],
    ]);
    expect(detection).toMatchObject({ headerRowIndex: 1, detected: true, format: "layout-of" });
  });

  it("sem núcleo reconhecido, devolve detected false e format null", () => {
    const detection = detectHeaderRow([
      ["OF/OS", "Cliente", "Data entrega"],
      ["107482", "ACME", "15/12/2026"],
    ]);
    expect(detection).toMatchObject({ detected: false, format: null, headerRowIndex: 0 });
  });

  it("findMissingPartsColumns lista o que falta", () => {
    expect(findMissingPartsColumns(PARTS_HEADERS)).toEqual([]);
    expect(findMissingPartsColumns(["CONJUNTO", "QTDE"])).toEqual(["PEÇA"]);
    expect(findMissingPartsColumns(["Cliente", "Entrega"])).toEqual([
      "CONJUNTO",
      "PEÇA",
      "QTDE",
    ]);
  });

  it("assertSheetStructure valida o formato lista-pecas", () => {
    expect(() => assertSheetStructure(PARTS_HEADERS, 10, "lista-pecas")).not.toThrow();
    expect(() => assertSheetStructure(["CONJUNTO", "QTDE"], 10, "lista-pecas")).toThrow(/PEÇA/);
    expect(() => assertSheetStructure(PARTS_HEADERS, 0, "lista-pecas")).toThrow(
      /não contém linhas/,
    );
  });

  it("detecta o cabeçalho também a partir dos bytes do .xlsx", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([PARTS_HEADERS, ...fullListRows()]),
      "Planilha1",
    );
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseExcelFile(bytes, "lista.xlsx", 1024);

    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.headerBySheet["Planilha1"]).toMatchObject({
      detected: true,
      format: "lista-pecas",
      headerRowIndex: 0,
    });
  });
});

// -------------------------------------------------------------
// Código da OF gerado da data de entrega + sufixo do arquivo
// -------------------------------------------------------------

describe("código da OF gerado da entrega (038)", () => {
  it("a base vira dia+mês no padrão <TIPO> <número>", () => {
    expect(orderCodeFromDeliveryDate("2026-11-05")).toEqual({ code: "OF 0511", type: "OF" });
    expect(orderCodeFromDeliveryDate("2026-12-31")).toEqual({ code: "OF 3112", type: "OF" });
  });

  it("compõe entrega + sufixo do arquivo e faz round-trip na normalização", () => {
    const generated = orderCodeFromDateAndFileKey(FORM.deliveryDate, FILE_KEY);
    expect(generated).toEqual({ code: "OF 0511-3K7Q", type: "OF" });
    expect(normalizeOrderCode(generated.code, generated.type)).toEqual(generated);
  });

  it("arquivos diferentes com a mesma entrega geram códigos diferentes", () => {
    const first = orderCodeFromDateAndFileKey(FORM.deliveryDate, "aaaa");
    const second = orderCodeFromDateAndFileKey(FORM.deliveryDate, "zzzz");
    expect(first.code).not.toBe(second.code);
  });

  it("mesmo arquivo + mesma entrega geram sempre o mesmo código (reimportação deduplica)", () => {
    const first = orderCodeFromDateAndFileKey(FORM.deliveryDate, FILE_KEY);
    const second = orderCodeFromDateAndFileKey(FORM.deliveryDate, FILE_KEY);
    expect(second).toEqual(first);
  });

  it("chave derivada dos bytes é estável e muda com o conteúdo", () => {
    const bytes = new TextEncoder().encode("planilha de teste");
    const other = new TextEncoder().encode("planilha de teste!");
    expect(fileKeyFromBytes(bytes)).toBe(fileKeyFromBytes(bytes));
    expect(fileKeyFromBytes(bytes)).not.toBe(fileKeyFromBytes(other));
    expect(fileKeyFromBytes(bytes)).toMatch(/^[0-9a-z]{4}$/);
  });

  it("data inválida lança erro", () => {
    expect(() => orderCodeFromDeliveryDate("05/11/2026")).toThrow(/Data de entrega inválida/);
    expect(() => orderCodeFromDeliveryDate("")).toThrow(/Data de entrega inválida/);
    expect(() => orderCodeFromDateAndFileKey("", FILE_KEY)).toThrow(/Data de entrega inválida/);
  });
});

// -------------------------------------------------------------
// Construção da estrutura
// -------------------------------------------------------------

describe("buildPartsOfStructure", () => {
  it("monta OF única -> conjuntos como pai -> peças como filhos", () => {
    const { orders, ignoredColumns } = buildRows(fullListRows());

    expect(ignoredColumns).toEqual([]);
    expect(orders).toHaveLength(1);
    const order = orders[0]!;

    expect(order.code).toBe("OF 0511-3K7Q");
    expect(order.type).toBe("OF");
    expect(order.customerName).toBe(FORM.customerName);
    expect(order.deliveryDate).toBe(FORM.deliveryDate);
    expect(order.description).toBe("GUARDA-CORPO");
    expect(order.sourceRow).toBe(2);
    expect(order.parents).toHaveLength(2);
    expect(orderStatusOf(order.issues)).toBe("VALID");

    const first = order.parents[0]!;
    expect(first.code).toBe("SOL-PAS-GC1");
    expect(first.description).toBe("GUARDA-CORPO");
    expect(first.family).toBe("GC");
    expect(first.quantity).toBe(2);
    // Peso unitário do conjunto = Σ(peça unit × qtd) = 0,91 + 10 × 0,56.
    expect(first.unitWeightKg).toBeCloseTo(6.51, 10);
    expect(first.totalWeightKg).toBeCloseTo(13.02, 10);
    expect(first.children).toHaveLength(2);

    const child = first.children[0]!;
    expect(child.code).toBe("P113");
    expect(child.description).toBe("TB. RED. 42,2X3,56");
    expect(child.family).toBe(familyFromDescription("TB. RED. 42,2X3,56"));
    expect(child.quantity).toBe(1);
    expect(child.unitWeightKg).toBeCloseTo(0.91, 10);
    expect(child.totalWeightKg).toBeCloseTo(0.91, 10);
    expect(child.materials).toEqual([
      {
        description: "TB. RED. 42,2X3,56",
        quantity: 1,
        unit: "UN",
        notes: "DIN 2440 · 260 mm",
      },
    ]);

    const second = first.children[1]!;
    expect(second.code).toBe("P194");
    expect(second.quantity).toBe(10);
    expect(second.materials[0]?.notes).toBe("A36 · 995 mm");

    const other = order.parents[1]!;
    expect(other.code).toBe("SOL-PAS-GC52");
    expect(other.quantity).toBe(11);
    expect(other.unitWeightKg).toBeCloseTo(2, 10);
    expect(other.totalWeightKg).toBeCloseTo(22, 10);
    expect(other.children.map((entry) => entry.code)).toEqual(["P187"]);
  });

  it("avisa quando a MASSA da linha-mãe diverge da fórmula do sistema", () => {
    const rows = [
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 2, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 99 }),
      makeRow({ "PEÇA": "P113", QTDE: 1, PERFIL: "BARRA22X3.2", "MASSA(Kg)": 0.91 }),
    ];
    const { orders } = buildRows(rows);
    const order = orders[0]!;

    const divergence = order.issues.find((entry) => entry.column === "MASSA(Kg)");
    expect(divergence).toMatchObject({ severity: "warning", where: "SOL-PAS-GC1" });
    expect(divergence?.message).toMatch(/Peso total da lista/);
    // Massa dentro da tolerância (arredondamento de 1 casa) não avisa.
    const rounded = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 2, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 1.82 }),
      makeRow({ "PEÇA": "P113", QTDE: 1, PERFIL: "BARRA22X3.2", "MASSA(Kg)": 0.91 }),
    ]);
    expect(rounded.orders[0]?.issues).toHaveLength(0);
  });

  it("rejeita peça sem conjunto acima (linha órfã)", () => {
    const { orders } = buildRows([
      makeRow({ "PEÇA": "P113", QTDE: 1, PERFIL: "BARRA22X3.2", "MASSA(Kg)": 0.91 }),
    ]);
    const order = orders[0]!;
    expect(order.parents).toHaveLength(0);
    expect(order.issues).toHaveLength(1);
    expect(order.issues[0]).toMatchObject({ severity: "error", where: "Linha 2" });
    expect(orderStatusOf(order.issues)).toBe("ERROR");
  });

  it("mantém a primeira ocorrência de peça repetida no mesmo conjunto", () => {
    const { orders } = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 2, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 1.82 }),
      makeRow({ "PEÇA": "P113", QTDE: 1, PERFIL: "BARRA22X3.2", "MASSA(Kg)": 0.91 }),
      makeRow({ "PEÇA": "P113", QTDE: 9, PERFIL: "BARRA22X3.2", "MASSA(Kg)": 0.91 }),
    ]);
    const order = orders[0]!;
    expect(order.parents[0]?.children).toHaveLength(1);
    expect(order.parents[0]?.children[0]?.quantity).toBe(1);
    expect(order.issues[0]).toMatchObject({ type: "DUPLICATE", severity: "warning" });
    expect(orderStatusOf(order.issues)).toBe("WARNING");
  });

  it("mantém a primeira ocorrência de conjunto repetido", () => {
    const { orders } = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 2, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 1.82 }),
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 9, PERFIL: "OUTRO", "MASSA(Kg)": 1.82 }),
    ]);
    const order = orders[0]!;
    expect(order.parents).toHaveLength(1);
    expect(order.parents[0]?.quantity).toBe(2);
    expect(order.issues[0]).toMatchObject({ type: "DUPLICATE", severity: "warning" });
  });

  it("avisa conjunto sem peças (sem peso derivado)", () => {
    const { orders } = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 2, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 13.02 }),
    ]);
    const parent = orders[0]?.parents[0];
    expect(parent?.unitWeightKg).toBeNull();
    expect(parent?.totalWeightKg).toBeNull();
    expect(orders[0]?.issues).toContainEqual(
      expect.objectContaining({ type: "STRUCTURE", severity: "warning", where: "SOL-PAS-GC1" }),
    );
  });

  it("erros de quantidade zerada bloqueiam a importação", () => {
    const { orders } = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 0, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 1.82 }),
      makeRow({ "PEÇA": "P113", QTDE: 0, PERFIL: "BARRA22X3.2", "MASSA(Kg)": 0.91 }),
    ]);
    const order = orders[0]!;
    const errors = order.issues.filter((entry) => entry.severity === "error");
    expect(errors).toHaveLength(2);
    expect(errors.map((entry) => entry.where)).toEqual(["SOL-PAS-GC1", "SOL-PAS-GC1 / P113"]);
    expect(orderStatusOf(order.issues)).toBe("ERROR");
  });

  it("peça sem PERFIL: descrição cai para o código e avisa sem matéria-prima", () => {
    const { orders } = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: 1, PERFIL: "GUARDA-CORPO", "MASSA(Kg)": 1 }),
      makeRow({ "PEÇA": "P113", QTDE: 1, "MASSA(Kg)": 1 }),
    ]);
    const child = orders[0]?.parents[0]?.children[0];
    expect(child?.description).toBe("P113");
    expect(child?.family).toBeNull();
    expect(child?.materials).toEqual([]);
    expect(orders[0]?.issues).toContainEqual(
      expect.objectContaining({ type: "REQUIRED", severity: "warning", column: "PERFIL" }),
    );
  });

  it("linhas sem identificação válida viram erro e são ignoradas", () => {
    const { orders } = buildRows([
      // Só números, sem CONJUNTO nem PEÇA.
      makeRow({ QTDE: 2, "MASSA(Kg)": 1.82 }),
      // CONJUNTO e PEÇA preenchidos juntos.
      makeRow({ CONJUNTO: "SOL-PAS-GC1", "PEÇA": "P113", QTDE: 1 }),
    ]);
    const order = orders[0]!;
    expect(order.parents).toHaveLength(0);
    expect(order.issues).toHaveLength(2);
    expect(order.issues.every((entry) => entry.severity === "error")).toBe(true);
    expect(order.issues.map((entry) => entry.where)).toEqual(["Linha 2", "Linha 3"]);
  });

  it("avisa número inválido (QTDE/MASSA/COMPR) sem quebrar a leitura", () => {
    const { orders } = buildRows([
      makeRow({ CONJUNTO: "SOL-PAS-GC1", QTDE: "dois", PERFIL: "GUARDA-CORPO", "MASSA(Kg)": "x" }),
      makeRow({
        "PEÇA": "P113",
        QTDE: "abc",
        PERFIL: "BARRA22X3.2",
        "COMPR.(mm)": "longo",
        "MASSA(Kg)": "peso",
      }),
    ]);
    const order = orders[0]!;
    const columns = order.issues.map((entry) => entry.column);
    expect(columns).toEqual(
      expect.arrayContaining(["QTDE", "MASSA(Kg)", "COMPR.(mm)"]),
    );
    expect(order.issues.filter((entry) => entry.severity === "error")).toHaveLength(2);
  });

  it("lança quando faltam colunas obrigatórias da lista", () => {
    const sheet: ParsedSheet = {
      name: "Planilha1",
      headers: ["Cliente", "Entrega"],
      headerRowIndex: 0,
      rows: [["ACME", "05/11"]],
    };
    expect(() => buildPartsOfStructure(sheet, FORM, FILE_KEY)).toThrow(
      /Colunas obrigatórias ausentes na lista: CONJUNTO, PEÇA, QTDE/,
    );
  });

  it("lista com nenhuma linha-mãe válida vira erro de estrutura", () => {
    const { orders } = buildRows([]);
    expect(orders[0]?.issues).toContainEqual(
      expect.objectContaining({ type: "STRUCTURE", severity: "error" }),
    );
  });
});
