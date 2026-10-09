import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  detectHeaderRow,
  findMissingTechnicalColumns,
  normalizeHeader,
  parseExcelFile,
} from "@/lib/import/excel-parser";
import { buildOfStructure, familyFromDescription, isGuardaCorpo, orderStatusOf } from "@/lib/import/of-structure";
import { buildOfImportPlan, computeOfDifferences, undecidedOrders } from "@/lib/import/of-plan";
import { assertSheetStructure, importFormSchema, validateImportFile } from "@/lib/validators/import.schema";
import { formatQuantity } from "@/lib/utils/formatting";
import type {
  BuiltOf,
  ExistingOfStructure,
  ImportPreview,
  OfPreview,
  ParsedSheet,
} from "@/lib/types/import";

/**
 * Testes do novo fluxo de importação (layout de estrutura OF):
 *
 *  - detecção do cabeçalho técnico e validação de arquivo;
 *  - construção da hierarquia OF -> itens pai -> filhos -> matéria-prima
 *    com mapeamento 100% pelo nome da coluna;
 *  - diferenças sistema x arquivo e plano com decisão por OF;
 *  - aceitação do arquivo REAL da fábrica (fixture).
 */

const FORM = { customerName: "Cliente do Formulário", deliveryDate: "2026-12-15" };

const TECH_HEADERS = [
  "OF_TIPO",
  "of_idOF",
  "of_Descr",
  "ps_idPos",
  "ps_Descr",
  "ps_Tipo",
  "ps_Qtde",
  "ps_Peso",
  "pos_PesoTotal",
  "ps_idMat",
  "ps_DesMaterial",
  "ps_Qualidade",
  "cp_comp",
  "cp_compdescr",
  "cp_compqtdetotal",
  "cp_comppeso",
  "cp_comppesototal",
  "co_compcodmat",
  "cp_DesMaterial",
  "cp_Qualidade",
];

/** Monta uma linha alinhada aos cabeçalhos informados (por nome). */
function makeRow(values: Record<string, unknown>, headers: string[] = TECH_HEADERS): unknown[] {
  const out: unknown[] = new Array(headers.length).fill(null);
  for (const [name, value] of Object.entries(values)) {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Coluna de teste desconhecida: ${name}`);
    out[index] = value;
  }
  return out;
}

function sheetFrom(rows: unknown[][], headers: string[] = TECH_HEADERS): ParsedSheet {
  return { name: "Fábrica", headers, headerRowIndex: 2, rows };
}

function buildRows(rows: unknown[][], headers: string[] = TECH_HEADERS) {
  return buildOfStructure(sheetFrom(rows, headers), FORM);
}

/** Linhas de uma OF completa: pai com 2 filhos + posição tipo X (só material). */
function fullHierarchyRows(): unknown[][] {
  return [
    makeRow({
      OF_TIPO: "OF",
      of_idOF: "OF 107482",
      of_Descr: "GUARDA CORPO 3M",
      ps_idPos: "72ST18-018",
      ps_Descr: "GUARDA CORPO",
      ps_Tipo: "E",
      ps_Qtde: 1,
      ps_Peso: 12.48,
      pos_PesoTotal: 12.48,
      cp_comp: "72-742",
      cp_compdescr: "GUARDA CORPO",
      cp_compqtdetotal: 3,
      cp_comppeso: 4.16,
      cp_comppesototal: 12.48,
      co_compcodmat: "T1318",
      cp_DesMaterial: "TB42.20X3.56",
      cp_Qualidade: "SCH40",
    }),
    makeRow({
      OF_TIPO: "OF",
      of_idOF: "OF 107482",
      // Campos de pai diferentes na 2ª linha: quem manda é a 1ª linha.
      ps_idPos: "72ST18-018",
      ps_Descr: "OUTRA DESCRIÇÃO",
      ps_Qtde: 999,
      cp_comp: "72-743",
      cp_compdescr: "MONTANTE",
      cp_compqtdetotal: 2,
      cp_comppeso: 1.5,
      cp_comppesototal: 3,
      co_compcodmat: "T2020",
      cp_DesMaterial: "TB40X40",
      cp_Qualidade: "SCH20",
    }),
    makeRow({
      OF_TIPO: "OF",
      of_idOF: "OF 107482",
      ps_idPos: "72ST18-025",
      ps_Descr: "BOTÃO PORTA",
      ps_Tipo: "X",
      ps_Qtde: 2,
      ps_Peso: 1.09,
      pos_PesoTotal: 2.18,
      ps_idMat: "T1318",
      ps_DesMaterial: "TB42.20X3.56",
      ps_Qualidade: "SCH40",
    }),
  ];
}

function buildXlsx(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// -------------------------------------------------------------
// Arquivo: validação de entrada
// -------------------------------------------------------------

describe("validateImportFile", () => {
  it("aceita .xlsx e .xls e rejeita outros formatos", () => {
    const ok = new File([new Uint8Array([1, 2, 3])], "arquivo.xlsx");
    expect(validateImportFile(ok)).toEqual({ ok: true });

    const txt = new File([new Uint8Array([1, 2, 3])], "arquivo.txt");
    const result = validateImportFile(txt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Formato de arquivo não suportado/);
  });

  it("rejeita arquivo vazio", () => {
    const empty = new File([], "arquivo.xlsx");
    const result = validateImportFile(empty);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/vazio/);
  });
});

describe("assertSheetStructure", () => {
  it("passa com o layout completo", () => {
    expect(() => assertSheetStructure(TECH_HEADERS, 10)).not.toThrow();
  });

  it("acusa colunas obrigatórias ausentes", () => {
    const headers = TECH_HEADERS.filter((header) => header !== "cp_comp" && header !== "ps_Descr");
    expect(() => assertSheetStructure(headers, 10)).toThrow(/ps_Descr, cp_comp/);
  });

  it("acusa planilha sem linhas de dados", () => {
    expect(() => assertSheetStructure(TECH_HEADERS, 0)).toThrow(/não contém linhas de dados/);
  });
});

describe("importFormSchema", () => {
  it("valida aba + cliente + data no formato ISO", () => {
    const parsed = importFormSchema.safeParse({
      sheetName: "Fábrica",
      customerName: "  ACME  ",
      deliveryDate: "2026-12-15",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.customerName).toBe("ACME");
  });

  it("exige cliente e data de entrega válida", () => {
    const semCliente = importFormSchema.safeParse({
      sheetName: "Fábrica",
      customerName: "   ",
      deliveryDate: "2026-12-15",
    });
    expect(semCliente.success).toBe(false);

    const dataErrada = importFormSchema.safeParse({
      sheetName: "Fábrica",
      customerName: "ACME",
      deliveryDate: "15/12/2026",
    });
    expect(dataErrada.success).toBe(false);
  });
});

// -------------------------------------------------------------
// Detecção do cabeçalho técnico
// -------------------------------------------------------------

describe("excel-parser (detecção do cabeçalho)", () => {
  it("normalizeHeader remove acento, espaço e caixa", () => {
    expect(normalizeHeader("Código OF")).toBe("CODIGOOF");
    expect(normalizeHeader(" ps_idPos ")).toBe("PSIDPOS");
    expect(normalizeHeader("Matéria-prima")).toBe("MATERIAPRIMA");
    expect(normalizeHeader(null)).toBe("");
  });

  it("encontra a linha técnica mesmo com linhas de título/rótulo antes", () => {
    const matrix: unknown[][] = [
      ["Relatório da Fábrica"],
      ["Grupo 1", "Grupo 2"],
      TECH_HEADERS,
      ["OF", "107482"],
    ];
    const detection = detectHeaderRow(matrix);
    expect(detection).toMatchObject({ headerRowIndex: 2, detected: true });
  });

  it("não detecta o formato antigo (rótulos humanos)", () => {
    const matrix: unknown[][] = [
      ["OF/OS", "Cliente", "Data entrega"],
      ["107482", "ACME", "15/12/2026"],
    ];
    const detection = detectHeaderRow(matrix);
    expect(detection.detected).toBe(false);
    expect(detection.headerRowIndex).toBe(0);
  });

  it("findMissingTechnicalColumns lista o que falta", () => {
    expect(findMissingTechnicalColumns(TECH_HEADERS)).toEqual([]);
    expect(findMissingTechnicalColumns(["of_idOF", "ps_idPos"])).toEqual(
      expect.arrayContaining(["ps_Descr", "cp_comp"]),
    );
  });

  it("parseExcelFile lê as abas preservando a linha do cabeçalho", () => {
    const buffer = buildXlsx({
      Fábrica: [
        ["Título"],
        ["Grupo A", "Grupo B"],
        TECH_HEADERS,
        ["OF", "107482", "GUARDA CORPO", "P1", "PEÇA", "E", 1],
      ],
      Rótulos: [
        ["OF/OS", "Cliente"],
        ["107482", "ACME"],
      ],
    });

    const parsed = parseExcelFile(buffer, "arquivo.xlsx", 1024);
    expect(parsed.sheets.map((entry) => entry.name).sort()).toEqual(["Fábrica", "Rótulos"]);

    const fabrica = parsed.sheets.find((entry) => entry.name === "Fábrica");
    expect(fabrica).toBeDefined();
    expect(fabrica?.headerRowIndex).toBe(2);
    expect(fabrica?.rows).toHaveLength(1);
    expect(parsed.headerBySheet["Fábrica"]?.detected).toBe(true);
    expect(parsed.headerBySheet["Rótulos"]?.detected).toBe(false);
  });
});

// -------------------------------------------------------------
// Construção da hierarquia (OF -> pai -> filho -> matéria-prima)
// -------------------------------------------------------------

describe("buildOfStructure", () => {
  it("monta a hierarquia completa com cliente e entrega do formulário", () => {
    const { orders, ignoredColumns } = buildRows(fullHierarchyRows());

    expect(ignoredColumns).toEqual([]);
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order).toBeDefined();
    if (!order) return;

    expect(order.code).toBe("OF 107482");
    expect(order.type).toBe("OF");
    expect(order.customerName).toBe(FORM.customerName);
    expect(order.deliveryDate).toBe(FORM.deliveryDate);
    expect(orderStatusOf(order.issues)).toBe("VALID");
    expect(order.parents).toHaveLength(2);

    const [pai, tipoX] = order.parents;
    expect(pai).toBeDefined();
    expect(tipoX).toBeDefined();
    if (!pai || !tipoX) return;

    // Campos do pai vêm da PRIMEIRA linha da posição (999 da 2ª linha é ignorado).
    expect(pai.code).toBe("72ST18-018");
    expect(pai.description).toBe("GUARDA CORPO");
    expect(pai.family).toBe("GC");
    expect(pai.quantity).toBe(1);
    expect(pai.deliveryDate).toBe(FORM.deliveryDate);
    expect(pai.children).toHaveLength(2);
    expect(pai.materials).toEqual([]);

    // Filhos: descrição/família própria, entrega do formulário, MP com código·qualidade.
    expect(pai.children[0]).toMatchObject({
      code: "72-742",
      description: "GUARDA CORPO",
      family: "GC",
      quantity: 3,
      deliveryDate: FORM.deliveryDate,
    });
    expect(pai.children[0]?.materials).toEqual([
      { description: "TB42.20X3.56", quantity: 3, unit: "UN", notes: "T1318 · SCH40" },
    ]);
    expect(pai.children[1]).toMatchObject({
      code: "72-743",
      description: "MONTANTE",
      family: "M",
      quantity: 2,
    });

    // Posição tipo X: sem filhos, material direto no pai com ps_Qtde.
    expect(tipoX.code).toBe("72ST18-025");
    expect(tipoX.family).toBe("BP");
    expect(tipoX.children).toHaveLength(0);
    expect(tipoX.materials).toEqual([
      { description: "TB42.20X3.56", quantity: 2, unit: "UN", notes: "T1318 · SCH40" },
    ]);
  });

  it("mapeia colunas pelo NOME, mesmo fora de ordem", () => {
    const reversed = [...TECH_HEADERS].reverse();
    const rows = fullHierarchyRows().map((original) => {
      const values: Record<string, unknown> = {};
      TECH_HEADERS.forEach((header, index) => {
        values[header] = original[index];
      });
      return makeRow(values, reversed);
    });

    const { orders } = buildRows(rows, reversed);
    expect(orders[0]?.parents.map((parent) => parent.code)).toEqual(["72ST18-018", "72ST18-025"]);
    expect(orders[0]?.parents[0]?.children).toHaveLength(2);
  });

  it("lista colunas ignoradas (fora do layout técnico)", () => {
    const headers = [...TECH_HEADERS, "OBRA", "ARENA"];
    const rows = fullHierarchyRows().map((original) => [...original, "OBRA 12", null]);
    const { ignoredColumns } = buildRows(rows, headers);
    expect(ignoredColumns).toEqual(["OBRA", "ARENA"]);
  });

  it("linha sem código de OF vira OF de erro próprio (por linha)", () => {
    const { orders } = buildRows([makeRow({ ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 1 })]);
    expect(orders).toHaveLength(1);
    const order = orders[0];
    expect(order?.code.startsWith("(linha ")).toBe(true);
    expect(orderStatusOf(order?.issues ?? [])).toBe("ERROR");
    expect(order?.issues[0]?.column).toBe("of_idOF");
  });

  it("linha sem item pai e item sem descrição/quantidade são erros da OF", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "200001", ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 2, cp_comp: "C1", cp_compdescr: "X", cp_compqtdetotal: 1 }),
      makeRow({ of_idOF: "200001" }), // sem ps_idPos
    ]);
    const order = orders[0];
    expect(order?.issues.some((issue) => issue.column === "ps_idPos" && issue.severity === "error")).toBe(true);
    expect(orderStatusOf(order?.issues ?? [])).toBe("ERROR");

    const { orders: semQuantidade } = buildRows([
      makeRow({ of_idOF: "200002", ps_idPos: "P1", ps_Descr: "", ps_Qtde: 0, cp_comp: "C1", cp_compdescr: "X", cp_compqtdetotal: 0 }),
    ]);
    const invalida = semQuantidade[0];
    const colunas = (invalida?.issues ?? []).filter((issue) => issue.severity === "error").map((issue) => issue.column);
    expect(colunas).toEqual(expect.arrayContaining(["ps_Descr", "ps_Qtde", "cp_compqtdetotal"]));
  });

  it("filho sem matéria-prima gera alerta; 'SEM MATERIAL' também", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "300001", ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 1, cp_comp: "C1", cp_compdescr: "X", cp_compqtdetotal: 1 }),
      makeRow({ of_idOF: "300001", ps_idPos: "P2", ps_Descr: "OUTRA", ps_Qtde: 1, cp_comp: "C2", cp_compdescr: "Y", cp_compqtdetotal: 1, cp_DesMaterial: "SEM MATERIAL" }),
    ]);
    const order = orders[0];
    expect(orderStatusOf(order?.issues ?? [])).toBe("WARNING");
    expect(order?.issues.filter((issue) => issue.column === "cp_DesMaterial")).toHaveLength(2);
    expect(order?.parents.every((parent) => parent.children.every((child) => child.materials.length === 0))).toBe(true);
  });

  it("posição tipo X com 'SEM MATERIAL' fica sem material e sem alerta", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "300002", ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 3, ps_DesMaterial: "SEM MATERIAL" }),
    ]);
    const order = orders[0];
    expect(orderStatusOf(order?.issues ?? [])).toBe("VALID");
    expect(order?.parents[0]?.materials).toEqual([]);
  });

  it("filho repetido mantém a primeira ocorrência e avisa", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "400001", ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 2, cp_comp: "C1", cp_compdescr: "PRIMEIRA", cp_compqtdetotal: 1, cp_DesMaterial: "TB42" }),
      makeRow({ of_idOF: "400001", ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 2, cp_comp: "C1", cp_compdescr: "SEGUNDA", cp_compqtdetotal: 9, cp_DesMaterial: "TB42" }),
    ]);
    const order = orders[0];
    expect(order?.parents[0]?.children).toHaveLength(1);
    expect(order?.parents[0]?.children[0]?.description).toBe("PRIMEIRA");
    expect(order?.issues.some((issue) => issue.type === "DUPLICATE" && issue.severity === "warning")).toBe(true);
  });

  it("monta o código do pedido: prefixo próprio ou tipo da coluna", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "107482", OF_TIPO: "OS", ps_idPos: "P1", ps_Descr: "PEÇA", ps_Qtde: 1, cp_comp: "C1", cp_compdescr: "X", cp_compqtdetotal: 1 }),
    ]);
    expect(orders[0]?.code).toBe("OS 107482");
    expect(orders[0]?.type).toBe("OS");
  });

  // ---------------------------------------------------------
  // Posição tipo X de guarda-corpo é descartada por inteiro
  // ---------------------------------------------------------

  it("descarta posição tipo X de guarda-corpo (não vira pai nem material)", () => {
    const { orders } = buildRows([
      makeRow({
        of_idOF: "500001",
        ps_idPos: "P1",
        ps_Descr: "GUARDA CORPO",
        ps_Tipo: "X",
        ps_Qtde: 2,
        ps_idMat: "T1318",
        ps_DesMaterial: "TB42.20X3.56",
        ps_Qualidade: "SCH40",
      }),
    ]);
    const order = orders[0];
    // Sem issue: o descarte é silencioso (decisão de negócio).
    expect(order?.parents).toEqual([]);
    expect(orderStatusOf(order?.issues ?? [])).toBe("ERROR");
    // A OF fica sem itens pai — a validação existente acusa isso.
    expect(order?.issues[0]?.message).toMatch(/sem itens pai válidos/);
  });

  it("descarta a posição inteira: linhas de continuação também caem", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "500002", ps_idPos: "P1", ps_Descr: "GUARDA CORPO", ps_Tipo: "X", ps_Qtde: 2, ps_DesMaterial: "TB42" }),
      // Continuação: ps_Descr em branco, mas mesma ps_idPos + filho.
      makeRow({ of_idOF: "500002", ps_idPos: "P1", ps_Descr: "", cp_comp: "72-742", cp_compdescr: "MONTANTE", cp_compqtdetotal: 3, cp_DesMaterial: "TB40" }),
      // Posição legítima na mesma OF continua entrando.
      makeRow({ of_idOF: "500002", ps_idPos: "P2", ps_Descr: "OUTRA PEÇA", ps_Tipo: "E", ps_Qtde: 1, cp_comp: "72-743", cp_compdescr: "FIXAÇÃO", cp_compqtdetotal: 1, cp_DesMaterial: "TB20" }),
    ]);
    const order = orders[0];
    expect(order?.parents.map((parent) => parent.code)).toEqual(["P2"]);
    expect(order?.parents[0]?.children).toHaveLength(1);
  });

  it("reconhece guarda-corpo em qualquer caixa e acento", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "500003", ps_idPos: "P1", ps_Descr: "Guarda-Côrpo 3M", ps_Tipo: "X", ps_Qtde: 1, ps_DesMaterial: "TB42" }),
      makeRow({ of_idOF: "500003", ps_idPos: "P2", ps_Descr: "GUARDA-CORPO MOLDUREIRA", ps_Tipo: "X", ps_Qtde: 1, ps_DesMaterial: "TB40" }),
    ]);
    expect(orders[0]?.parents).toEqual([]);
  });

  it("não descarta posição tipo X que NÃO é guarda-corpo (material direto)", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "500004", ps_idPos: "P1", ps_Descr: "BOTÃO PORTA", ps_Tipo: "X", ps_Qtde: 2, ps_idMat: "T1318", ps_DesMaterial: "TB42.20X3.56", ps_Qualidade: "SCH40" }),
    ]);
    const order = orders[0];
    expect(order?.parents).toHaveLength(1);
    expect(order?.parents[0]?.materials).toEqual([
      { description: "TB42.20X3.56", quantity: 2, unit: "UN", notes: "T1318 · SCH40" },
    ]);
  });

  it("não descarta guarda-corpo com ps_Tipo = E (é posição com filhos)", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "500005", ps_idPos: "P1", ps_Descr: "GUARDA CORPO", ps_Tipo: "E", ps_Qtde: 1, cp_comp: "72-742", cp_compdescr: "MONTANTE", cp_compqtdetotal: 3, cp_DesMaterial: "TB40" }),
    ]);
    const order = orders[0];
    expect(order?.parents).toHaveLength(1);
    expect(order?.parents[0]?.children).toHaveLength(1);
    expect(orderStatusOf(order?.issues ?? [])).toBe("VALID");
  });

  it("mantém a posição já montada mesmo que uma linha X venha depois", () => {
    const { orders } = buildRows([
      makeRow({ of_idOF: "500006", ps_idPos: "P1", ps_Descr: "GUARDA CORPO", ps_Tipo: "E", ps_Qtde: 1, cp_comp: "72-742", cp_compdescr: "MONTANTE", cp_compqtdetotal: 3, cp_DesMaterial: "TB40" }),
      // Linha X da MESMA posição, com ps_Descr de guarda-corpo: não retroage.
      makeRow({ of_idOF: "500006", ps_idPos: "P1", ps_Descr: "GUARDA CORPO", ps_Tipo: "X", ps_Qtde: 1, ps_DesMaterial: "TB42" }),
    ]);
    const order = orders[0];
    expect(order?.parents).toHaveLength(1);
    expect(order?.parents[0]?.children).toHaveLength(1);
  });
});

describe("familyFromDescription", () => {
  it("usa as iniciais da própria descrição", () => {
    expect(familyFromDescription("GUARDA CORPO")).toBe("GC");
    expect(familyFromDescription("portão de entrada")).toBe("PDE");
    expect(familyFromDescription("STR0018 - PLATAFORMA")).toBe("SP");
    expect(familyFromDescription("")).toBeNull();
  });
});

describe("isGuardaCorpo", () => {
  it("reconhece o termo em qualquer caixa, acento e separador", () => {
    expect(isGuardaCorpo("GUARDA CORPO")).toBe(true);
    expect(isGuardaCorpo("Guarda-Côrpo 3M")).toBe(true);
    expect(isGuardaCorpo("guarda_corpo moldureira")).toBe(true);
    expect(isGuardaCorpo("GUARDACORPO MOLDUREIRA")).toBe(true);
  });

  it("não confunde com outros itens", () => {
    expect(isGuardaCorpo("BOTÃO PORTA")).toBe(false);
    expect(isGuardaCorpo("CORPO DO PORTÃO")).toBe(false);
    expect(isGuardaCorpo("")).toBe(false);
  });
});

// -------------------------------------------------------------
// Diferenças (sistema x arquivo) e plano com decisão por OF
// -------------------------------------------------------------

function makeBuiltOrder(): BuiltOf {
  return {
    code: "OF 900001",
    type: "OF",
    customerName: "Cliente X",
    description: "Pedido de teste",
    deliveryDate: "2026-12-20",
    parents: [
      {
        code: "P1",
        description: "GUARDA CORPO",
        family: "GC",
        quantity: 2,
        unitWeightKg: 1,
        totalWeightKg: 2,
        deliveryDate: "2026-12-20",
        materials: [{ description: "TB42", quantity: 2, unit: "UN", notes: null }],
        children: [
          {
            code: "C1",
            description: "GUARDA CORPO",
            family: "GC",
            quantity: 3,
            unitWeightKg: 4.16,
            totalWeightKg: 12.48,
            deliveryDate: "2026-12-20",
            materials: [{ description: "TB42", quantity: 3, unit: "UN", notes: null }],
          },
        ],
      },
    ],
    sourceRow: 4,
    issues: [],
  };
}

function makeExisting(): ExistingOfStructure {
  return {
    id: "order-1",
    code: "OF 900001",
    type: "OF",
    customerName: "Cliente X",
    description: "Pedido de teste",
    deliveryDate: "2026-12-20",
    status: "PLANEJADO",
    items: [
      {
        id: "ip1",
        parentItemId: null,
        code: "P1",
        description: "GUARDA CORPO",
        family: "GC",
        quantity: 2,
        unitWeightKg: 1,
        totalWeightKg: 2,
        deliveryDate: "2026-12-20",
        status: "PLANEJADO",
        op: null,
        materials: [{ description: "TB42", quantity: 2, unit: "UN" }],
        hasProgress: false,
      },
      {
        id: "ic1",
        parentItemId: "ip1",
        code: "C1",
        description: "GUARDA CORPO",
        family: "GC",
        quantity: 3,
        unitWeightKg: 4.16,
        totalWeightKg: 12.48,
        deliveryDate: "2026-12-20",
        status: "EM_PRODUCAO",
        op: "OP 777",
        materials: [{ description: "TB42", quantity: 3, unit: "UN" }],
        hasProgress: true,
      },
    ],
  };
}

function makeOfPreview(order: BuiltOf, exists: boolean, status: OfPreview["status"] = "VALID"): OfPreview {
  return {
    order,
    sourceRow: order.sourceRow,
    status,
    issues: order.issues,
    exists,
    existingStatus: exists ? "PLANEJADO" : null,
    differences: [],
    counts: {
      parents: order.parents.length,
      children: order.parents.reduce((total, parent) => total + parent.children.length, 0),
      materials: order.parents.reduce(
        (total, parent) =>
          total + parent.materials.length + parent.children.reduce((sum, child) => sum + child.materials.length, 0),
        0,
      ),
    },
    requiresDecision: exists && status !== "ERROR",
  };
}

function makePreview(orders: OfPreview[]): ImportPreview {
  return {
    fileName: "arquivo.xlsx",
    sheetName: "Fábrica",
    customerName: FORM.customerName,
    deliveryDate: FORM.deliveryDate,
    orders,
    totals: {
      orders: orders.length,
      importable: orders.filter((entry) => entry.status !== "ERROR").length,
      existing: orders.filter((entry) => entry.requiresDecision).length,
      errors: orders.filter((entry) => entry.status === "ERROR").length,
      warnings: orders.filter((entry) => entry.status === "WARNING").length,
      parents: 0,
      children: 0,
      materials: 0,
    },
    ignoredColumns: [],
  };
}

describe("computeOfDifferences", () => {
  it("sem sistema não há diferenças; idêntico também não", () => {
    expect(computeOfDifferences(makeBuiltOrder(), null)).toEqual([]);
    expect(computeOfDifferences(makeBuiltOrder(), makeExisting())).toEqual([]);
  });

  it("aponta mudanças de OF, item pai e filho com rótulos em pt-BR", () => {
    const incoming = makeBuiltOrder();
    incoming.customerName = "Cliente Novo";
    incoming.parents[0]!.quantity = 5;
    incoming.parents[0]!.children[0]!.materials = [];

    const diffs = computeOfDifferences(incoming, makeExisting());
    expect(diffs.map((diff) => [diff.scope, diff.field, diff.kind])).toEqual([
      ["order", "customerName", "changed"],
      ["parent", "quantity", "changed"],
      ["child", "materials", "changed"],
    ]);
    expect(diffs[0]?.label).toBe("Cliente");
    expect(diffs[0]?.incoming).toBe("Cliente Novo");
    expect(diffs[1]?.label).toBe("Quantidade");
    expect(diffs[1]?.current).toBe(formatQuantity(2));
    expect(diffs[1]?.incoming).toBe(formatQuantity(5));
  });

  it("marca itens adicionados e removidos (removido com progresso sinaliza)", () => {
    const incoming = makeBuiltOrder();
    incoming.parents[0]!.children = []; // C1 some do arquivo
    incoming.parents.push({
      ...incoming.parents[0]!,
      code: "P8",
      description: "MAIS UM PAI",
      children: [],
    }); // P8 só existe no arquivo

    const diffs = computeOfDifferences(incoming, makeExisting());

    const removido = diffs.find((diff) => diff.scope === "child" && diff.kind === "removed");
    expect(removido?.code).toBe("C1");
    expect(removido?.hasProgress).toBe(true);

    const paiRemovido = diffs.find((diff) => diff.scope === "parent" && diff.kind === "removed");
    expect(paiRemovido).toBeUndefined();

    const adicionado = diffs.find((diff) => diff.kind === "added");
    expect(adicionado?.scope).toBe("parent");
    expect(adicionado?.code).toBe("P8");
  });
});

describe("buildOfImportPlan", () => {
  it("OF nova vira CREATE com a estrutura completa", () => {
    const preview = makePreview([makeOfPreview(makeBuiltOrder(), false)]);
    const plan = buildOfImportPlan(preview, {});
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({ action: "CREATE" });
    expect(plan.operations[0]?.parents).toHaveLength(1);
    expect(plan.summary).toEqual({ create: 1, update: 0, keep: 0, skip: 0, errors: 0 });
  });

  it("OF existente sem decisão não pode ser confirmada", () => {
    const preview = makePreview([makeOfPreview(makeBuiltOrder(), true)]);
    expect(() => buildOfImportPlan(preview, {})).toThrow(/Informe o que fazer com a OF OF 900001/);
    expect(undecidedOrders(preview, {})).toHaveLength(1);
    expect(undecidedOrders(preview, { "OF 900001": "UPDATE" })).toHaveLength(0);
  });

  it("UPDATE envia estrutura; KEEP e SKIP não mexem em nada", () => {
    const atualizar = buildOfImportPlan(makePreview([makeOfPreview(makeBuiltOrder(), true)]), {
      "OF 900001": "UPDATE",
    });
    expect(atualizar.operations[0]).toMatchObject({ action: "UPDATE" });
    expect(atualizar.operations[0]?.parents).toHaveLength(1);
    expect(atualizar.summary.update).toBe(1);

    const manter = buildOfImportPlan(makePreview([makeOfPreview(makeBuiltOrder(), true)]), {
      "OF 900001": "KEEP",
    });
    expect(manter.operations[0]).toMatchObject({ action: "KEEP" });
    expect(manter.operations[0]?.parents).toEqual([]);
    expect(manter.summary.keep).toBe(1);

    const ignorar = buildOfImportPlan(makePreview([makeOfPreview(makeBuiltOrder(), true)]), {
      "OF 900001": "SKIP",
    });
    expect(ignorar.operations[0]).toMatchObject({ action: "SKIP" });
    expect(ignorar.summary.skip).toBe(1);
  });

  it("OF com erro fica de fora e não exige decisão", () => {
    const comErro = makeBuiltOrder();
    comErro.issues.push({
      type: "REQUIRED",
      severity: "error",
      where: "P1",
      column: "ps_Descr",
      message: "Item pai sem descrição (ps_Descr).",
      rawValue: null,
    });
    const preview = makePreview([makeOfPreview(comErro, true, "ERROR")]);
    const plan = buildOfImportPlan(preview, {});
    expect(plan.operations).toHaveLength(0);
    expect(plan.summary.errors).toBe(1);
    expect(undecidedOrders(preview, {})).toHaveLength(0);
  });
});

// -------------------------------------------------------------
// Aceitação: arquivo REAL da fábrica (fixture)
// -------------------------------------------------------------

describe("arquivo real da fábrica (fixture OF 107482)", () => {
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "of-107482-novo-layout.xlsx");
  const buffer = readFileSync(fixturePath);
  const parsed = parseExcelFile(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    "OF 107482.xlsx",
    buffer.byteLength,
  );

  it("detecta a linha do cabeçalho técnico", () => {
    const detected = parsed.sheets.filter((entry) => parsed.headerBySheet[entry.name]?.detected);
    expect(detected.length).toBeGreaterThanOrEqual(1);
    expect(detected[0]?.headerRowIndex).toBe(2);
    expect(findMissingTechnicalColumns(detected[0]?.headers ?? [])).toEqual([]);
  });

  it("constrói 9 itens pais, 62 filhos e 64 materiais sem erros", () => {
    const detected = parsed.sheets.filter((entry) => parsed.headerBySheet[entry.name]?.detected);
    expect(detected[0]).toBeDefined();

    const { orders } = buildOfStructure(detected[0]!, FORM);

    const parents = orders.flatMap((order) => order.parents);
    const children = parents.flatMap((parent) => parent.children);
    const materials =
      parents.reduce(
        (total, parent) => total + parent.materials.length + parent.children.reduce((sum, child) => sum + child.materials.length, 0),
        0,
      );

    // 11 posições no arquivo; 2 são tipo X de guarda-corpo (72ST18-025 e
    // 72ST18-026) e por isso descartadas — os demais 9 entram.
    expect(parents).toHaveLength(9);
    expect(children).toHaveLength(62);
    expect(materials).toBe(64); // 62 dos filhos + 2 materiais diretos (tipo X de LIGACAO)
    expect(parents.map((parent) => parent.code)).not.toEqual(expect.arrayContaining(["72ST18-025", "72ST18-026"]));

    for (const order of orders) {
      expect(orderStatusOf(order.issues)).not.toBe("ERROR");
      expect(order.customerName).toBe(FORM.customerName);
      expect(order.deliveryDate).toBe(FORM.deliveryDate);
      for (const parent of order.parents) {
        expect(parent.family).toBeTruthy();
        expect(parent.deliveryDate).toBe(FORM.deliveryDate);
        expect(parent.quantity).toBeGreaterThan(0);
        for (const material of parent.materials) expect(material.unit).toBe("UN");
        for (const child of parent.children) {
          expect(child.family).toBeTruthy();
          expect(child.deliveryDate).toBe(FORM.deliveryDate);
          expect(child.quantity).toBeGreaterThan(0);
          for (const material of child.materials) expect(material.unit).toBe("UN");
        }
      }
    }

    expect(orders.some((order) => order.code === "OF 107482")).toBe(true);
  });
});
