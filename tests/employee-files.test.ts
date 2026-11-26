import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";

const { extractPdfTextMock } = vi.hoisted(() => ({
  extractPdfTextMock: vi.fn(),
}));

vi.mock("@/lib/import/pdf-text", () => ({
  extractPdfText: extractPdfTextMock,
}));

import { parseEmployeeImportFiles } from "@/lib/import/employee-files";
import { importEmployeeRowsSchema } from "@/lib/validators/employee.schema";

const COMPANY_750 = "SRS PROJETOS E DESENVOLVIMENTOS LTDA";
const COMPANY_752 = "SRS DESENVOLVIMENTO LTDA";

function writeWorkbook(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet 1");
  return XLSX.write(workbook, { type: "array", bookType: "biff8" }) as ArrayBuffer;
}

function multiCompanySheet() {
  return writeWorkbook([
    ["Listagem de Empregados Ativos e Demitidos no período"],
    ["Empregado", null, null, null, null, "Admissão", "Desligamento"],
    ["Empresa:", 750, COMPANY_750],
    [110, "FUNCIONARIO DA 750", null, null, null, "01/01/2020", ""],
    ["Empresa:", 752, COMPANY_752],
    [110, "JONATHAN WILLIAN DA SILVA", null, null, null, "05/02/2024", "04/05/2024"],
    [7, "FUNCIONARIO DA 752", null, null, null, "02/02/2021", ""],
    ["Empresa:", 750, COMPANY_750],
    [8, "OUTRO DA 750", null, null, null, "03/03/2022", ""],
  ]);
}

function largeSheet() {
  const rows: unknown[][] = [
    ["Listagem de Empregados Ativos e Demitidos no período"],
    ["Empregado", null, null, null, null, "Admissão", "Desligamento"],
    ["Empresa:", 750, COMPANY_750],
  ];
  for (let index = 1; index <= 691; index += 1) {
    rows.push([index, `FUNCIONARIO 750 ${index}`, null, null, null, "01/01/2020", ""]);
  }
  rows.push(["Empresa:", 752, COMPANY_752]);
  for (let index = 1; index <= 551; index += 1) {
    rows.push([index, `FUNCIONARIO 752 ${index}`, null, null, null, "01/01/2020", ""]);
  }
  return writeWorkbook(rows);
}

function importRow(index: number) {
  return {
    company_code: index % 2 === 0 ? "750" : "752",
    company_name: index % 2 === 0 ? COMPANY_750 : COMPANY_752,
    registration: String(index + 1),
    name: `FUNCIONARIO ${index + 1}`,
    admission_date: "2020-01-01",
    dismissal_date: null,
    registered_client: null,
    registered_function: null,
  };
}

function employeeSheet() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Listagem de Empregados Ativos e Demitidos no período"],
    ["Período de 01/11/2020 a 30/11/2026"],
    ["Empregado", null, null, null, null, "Admissão", "Desligamento"],
    ["Empresa:", 752, "SRS DESENVOLVIMENTO LTDA"],
    ["Ativos"],
    [22, "ADRIANO BERNARDO DA SILVA", null, null, null, "29/06/2023", ""],
    ["Demitidos"],
    [42, "JOZENILTO CORREA", null, null, null, "10/02/2020", "20/04/2024"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet 1");
  return XLSX.write(workbook, { type: "array", bookType: "biff8" }) as ArrayBuffer;
}

describe("employee import parser", () => {
  it("uses the spreadsheet as the primary source and leaves absent PDF data blank", async () => {
    const preview = await parseEmployeeImportFiles(employeeSheet());
    expect(preview.spreadsheetRows).toBe(2);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({
      company_code: "752",
      registration: "22",
      name: "ADRIANO BERNARDO DA SILVA",
      admission_date: "2023-06-29",
      dismissal_date: null,
      registered_client: null,
      registered_function: null,
      source: "PLANILHA",
    });
    expect(preview.matchedRows).toBe(0);
    expect(preview.discrepancies).toEqual([]);
    expect(preview.rows[1]).toMatchObject({
      registration: "42",
      admission_date: "2020-02-10",
      dismissal_date: "2024-04-20",
    });
  });

  it("imports Departamento and Função from PDF into the corresponding payroll fields", async () => {
    extractPdfTextMock.mockResolvedValueOnce([{
      page: 1,
      items: [
        { str: "752 SRS DESENVOLVIMENTO", x: 10, y: 900 },
        { str: "0022 - ADRIANO BERNARDO DA SILVA", x: 35, y: 700 },
        { str: "AUXILIAR DE PRODUÇÃO I", x: 226, y: 700 },
        { str: "BRAFER EXPEDIÇÃO", x: 312, y: 700 },
      ],
    }]);

    const preview = await parseEmployeeImportFiles(employeeSheet(), new ArrayBuffer(0));
    const row = preview.rows.find((item) => item.registration === "22");

    expect(row).toMatchObject({
      registered_client: "BRAFER EXPEDIÇÃO",
      registered_function: "AUXILIAR DE PRODUÇÃO I",
      source: "PLANILHA",
    });
    expect(row).not.toHaveProperty("location");
    expect(preview.matchedRows).toBe(1);
    expect(preview.discrepancies).toEqual([
      expect.objectContaining({
        registration: "42",
        name: "JOZENILTO CORREA",
        reason: "SOMENTE_PLANILHA",
      }),
    ]);
  });

  it("sinaliza registros só no PDF e nomes divergentes sem associar dados do PDF", async () => {
    extractPdfTextMock.mockResolvedValueOnce([{
      page: 1,
      items: [
        { str: "752 SRS DESENVOLVIMENTO", x: 10, y: 900 },
        { str: "0022 - NOME DIVERGENTE", x: 35, y: 700 },
        { str: "SOLDADOR I", x: 226, y: 700 },
        { str: "SRS FABRICA", x: 312, y: 700 },
        { str: "0099 - FUNCIONARIO SOMENTE PDF", x: 35, y: 680 },
        { str: "MONTADOR I", x: 226, y: 680 },
        { str: "RAITZ", x: 312, y: 680 },
      ],
    }]);

    const preview = await parseEmployeeImportFiles(employeeSheet(), new ArrayBuffer(0));
    const spreadsheetRow = preview.rows.find((item) => item.registration === "22");
    const pdfOnlyRow = preview.rows.find((item) => item.registration === "99");

    expect(spreadsheetRow).toMatchObject({
      registered_client: null,
      registered_function: null,
    });
    expect(pdfOnlyRow).toMatchObject({
      name: "FUNCIONARIO SOMENTE PDF",
      registered_client: "RAITZ",
      registered_function: "MONTADOR I",
      admission_date: null,
      dismissal_date: null,
    });
    expect(preview.discrepancies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        registration: "22",
        reason: "NOME_DIVERGENTE",
        otherName: "NOME DIVERGENTE",
      }),
      expect.objectContaining({
        registration: "99",
        reason: "SOMENTE_PDF",
      }),
      expect.objectContaining({
        registration: "42",
        reason: "SOMENTE_PLANILHA",
      }),
    ]));
  });

  it("atribui a empresa da seção vigente a cada linha da planilha", async () => {
    const preview = await parseEmployeeImportFiles(multiCompanySheet());

    expect(preview.rows).toHaveLength(4);
    expect(preview.rows.find((row) => row.company_code === "750" && row.registration === "110"))
      .toMatchObject({
        company_name: COMPANY_750,
        name: "FUNCIONARIO DA 750",
        admission_date: "2020-01-01",
      });
    expect(preview.rows.find((row) => row.company_code === "752" && row.registration === "110"))
      .toMatchObject({
        company_name: COMPANY_752,
        name: "JONATHAN WILLIAN DA SILVA",
        admission_date: "2024-02-05",
        dismissal_date: "2024-05-04",
      });
    expect(preview.rows.find((row) => row.company_code === "752" && row.registration === "7"))
      .toMatchObject({ name: "FUNCIONARIO DA 752" });
    expect(preview.rows.find((row) => row.company_code === "750" && row.registration === "8"))
      .toMatchObject({ name: "OUTRO DA 750" });
  });

  it("associa a matrícula 110 da seção 752 ao 0110 do PDF sem divergência falsa", async () => {
    extractPdfTextMock.mockResolvedValueOnce([{
      page: 1,
      items: [
        { str: "752 SRS DESENVOLVIMENTO", x: 10, y: 900 },
        { str: "0110 - JONATHAN WILLIAN DA SILVA", x: 35, y: 700 },
        { str: "AUX. PRODUÇÃO", x: 226, y: 700 },
        { str: "BRAFER EXPEDIÇÃO", x: 312, y: 700 },
      ],
    }]);

    const preview = await parseEmployeeImportFiles(multiCompanySheet(), new ArrayBuffer(0));
    const spreadsheetRow = preview.rows.find(
      (row) => row.company_code === "752" && row.registration === "110",
    );

    expect(spreadsheetRow).toMatchObject({
      name: "JONATHAN WILLIAN DA SILVA",
      registered_client: "BRAFER EXPEDIÇÃO",
      registered_function: "AUX. PRODUÇÃO",
      source: "PLANILHA",
    });
    expect(preview.matchedRows).toBe(1);
    expect(preview.discrepancies.some((item) => item.key === "752:110")).toBe(false);
    expect(preview.discrepancies).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "750:110", reason: "SOMENTE_PLANILHA" }),
      expect.objectContaining({ key: "752:7", reason: "SOMENTE_PLANILHA" }),
      expect.objectContaining({ key: "750:8", reason: "SOMENTE_PLANILHA" }),
    ]));
  });

  it("lê a folha completa com 1.242 funcionários e mantém cada um na sua empresa", async () => {
    const preview = await parseEmployeeImportFiles(largeSheet());

    expect(preview.spreadsheetRows).toBe(1242);
    expect(preview.rows).toHaveLength(1242);
    expect(preview.rows.filter((row) => row.company_code === "750")).toHaveLength(691);
    expect(preview.rows.filter((row) => row.company_code === "752")).toHaveLength(551);
    expect(preview.rows.find((row) => row.company_code === "752" && row.registration === "1"))
      .toMatchObject({ company_name: COMPANY_752, name: "FUNCIONARIO 752 1" });
    expect(preview.rows.find((row) => row.company_code === "750" && row.registration === "691"))
      .toMatchObject({ company_name: COMPANY_750, name: "FUNCIONARIO 750 691" });
  });

  it("aceita 1.242 registros na validação e rejeita acima de 2.000", () => {
    const fullSheet = Array.from({ length: 1242 }, (_, index) => importRow(index));

    expect(importEmployeeRowsSchema.safeParse(fullSheet).success).toBe(true);
    expect(
      importEmployeeRowsSchema.safeParse(Array.from({ length: 2001 }, (_, index) => importRow(index)))
        .success,
    ).toBe(false);
  });
});
