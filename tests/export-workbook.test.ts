import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import type { ExportSheet } from "@/lib/export/columns";
import { buildWorkbook, buildWorkbookSheets } from "@/lib/export/workbook";

const SHEET: ExportSheet = {
  headers: ["OF/OS", "Ent.", "Qtd.", "Matérias-primas"],
  rows: [
    ["107482", new Date(2026, 9, 3), 12.5, "CH6.30; TB42.20"],
    ["107500", "—", "—", "—"],
  ],
  dateColumns: [1],
};

/** Lê o .xlsx gerado de volta (cellDates/cellNF inspecionam valor e formato). */
function roundTrip(sheet: ExportSheet) {
  const bytes = buildWorkbook(sheet);
  // cellStyles preserva as larguras de coluna no read; cellNF, os formatos.
  return XLSX.read(bytes, { type: "buffer", cellDates: false, cellNF: true, cellStyles: true });
}

describe("buildWorkbook", () => {
  it("gera .xlsx legível com cabeçalho, valores e larguras", () => {
    const workbook = roundTrip(SHEET);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["Lista"], { header: 1 });

    expect(rows[0]).toEqual(SHEET.headers);
    expect(rows[1][0]).toBe("107482");
    expect(rows[1][3]).toBe("CH6.30; TB42.20");

    const widths = workbook.Sheets["Lista"]["!cols"] as { wch: number }[];
    expect(widths).toHaveLength(SHEET.headers.length);
    expect(widths.every((col) => col.wch >= 8)).toBe(true);
  });

  it("data sai como número serial com formato dd/MM/yyyy", () => {
    const workbook = roundTrip(SHEET);
    const cell = workbook.Sheets["Lista"]["B2"] as XLSX.CellObject;

    expect(cell.t).toBe("n");
    expect(cell.z).toBe("DD/MM/YYYY");
    // Serial do Excel para 03/10/2026 (1900 date system).
    expect(XLSX.utils.format_cell(cell)).toBe("03/10/2026");
  });

  it("números saem tipados (não texto) para somar no Excel", () => {
    const workbook = roundTrip(SHEET);
    const cell = workbook.Sheets["Lista"]["C2"] as XLSX.CellObject;

    expect(cell.t).toBe("n");
    expect(cell.v).toBe(12.5);
    expect(cell.z).toBe("#,##0.###");
  });

  it("aplica duas casas somente a pesos, preservando a escala das quantidades", () => {
    const workbook = roundTrip({
      headers: ["Peso (kg)", "Qtd."],
      rows: [[12.345, 1.234]],
      dateColumns: [],
    });
    const sheet = workbook.Sheets["Lista"];
    expect((sheet["A2"] as XLSX.CellObject).z).toBe("#,##0.##");
    expect((sheet["B2"] as XLSX.CellObject).z).toBe("#,##0.###");
  });

  it("vazio vira texto — (mesmo marcador da tela), sem formato numérico", () => {
    const workbook = roundTrip(SHEET);
    const cell = workbook.Sheets["Lista"]["B3"] as XLSX.CellObject;

    expect(cell.t).toBe("s");
    expect(cell.v).toBe("—");
  });
});

describe("buildWorkbookSheets", () => {
  const OTHER: ExportSheet = {
    headers: ["Processo", "Peso (kg)"],
    rows: [["MP", 20]],
    dateColumns: [],
  };

  /** Lê o .xlsx de várias abas de volta. */
  function roundTripMany(sheets: Parameters<typeof buildWorkbookSheets>[0]) {
    return XLSX.read(buildWorkbookSheets(sheets), {
      type: "buffer",
      cellDates: false,
      cellNF: true,
      cellStyles: true,
    });
  }

  it("preserva a ordem e o conteúdo das abas", () => {
    const workbook = roundTripMany([
      { name: "Lançamentos", sheet: SHEET },
      { name: "Totais por processo", sheet: OTHER },
    ]);

    expect(workbook.SheetNames).toEqual(["Lançamentos", "Totais por processo"]);
    expect(XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["Lançamentos"], { header: 1 })[0]).toEqual(
      SHEET.headers,
    );
    expect(workbook.Sheets["Totais por processo"]["B2"]).toMatchObject({ t: "n", v: 20 });
  });

  it("sanitiza nomes proibidos pelo Excel e limita a 31 caracteres", () => {
    const workbook = roundTripMany([
      { name: "Lista/2026 [final]:*?", sheet: SHEET },
      { name: "Um nome de aba absurdamente comprido para o Excel", sheet: OTHER },
      { name: "[]:*?/\\", sheet: OTHER },
    ]);

    expect(workbook.SheetNames[0]).toBe("Lista 2026  final");
    expect(workbook.SheetNames[1]).toHaveLength(31);
    // Nome só com caracteres proibidos cai no rótulo padrão.
    expect(workbook.SheetNames[2]).toBe("Planilha");
  });

  it("exige ao menos uma aba", () => {
    expect(() => buildWorkbookSheets([])).toThrow(/ao menos uma aba/);
  });
});
