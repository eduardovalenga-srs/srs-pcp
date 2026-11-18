import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { parseEmployeeImportFiles } from "@/lib/import/employee-files";

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
      location: null,
      source: "PLANILHA",
    });
    expect(preview.rows[1]).toMatchObject({
      registration: "42",
      admission_date: "2020-02-10",
      dismissal_date: "2024-04-20",
    });
  });
});
