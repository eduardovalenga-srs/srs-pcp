import * as XLSX from "xlsx";

import type { ExportCell, ExportSheet } from "@/lib/export/columns";

/**
 * Geração do arquivo .xlsx a partir de uma {@link ExportSheet}.
 *
 * Mesmo padrão da rota `/api/importacao/modelo`: SheetJS monta o buffer e a
 * rota devolve com Content-Disposition de anexo. Uma aba só — a lista como
 * está na tela.
 *
 * As células saem TIPADAS (número/data, não texto): o Excel pt-BR renderiza
 * 1.234,5 e dd/MM/yyyy exatamente como a tela mostra, mas mantém soma,
 * filtro e ordenação cronológica funcionando.
 */

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Formato de data exibido nas telas (dd/MM/yyyy). */
const DATE_FORMAT = "DD/MM/YYYY";
/** Formato numérico padrão — não altera precisão de quantidade/medidas. */
const NUMBER_FORMAT = "#,##0.###";
/** Pesos em kg: no máximo 2 casas. */
const WEIGHT_FORMAT = "#,##0.##";

/** Largura mínima/máxima das colunas (caracteres) — calibrada nos rótulos. */
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;

/** A coluna tem datas (recebe o formato dd/MM/yyyy em vez do numérico). */
function isDateColumn(sheet: ExportSheet, column: number): boolean {
  return sheet.dateColumns.includes(column);
}

function isWeightColumn(sheet: ExportSheet, column: number): boolean {
  return /peso|kg\/dia/i.test(String(sheet.headers[column] ?? ""));
}

/** Unidade variável em documentos: Recebida só é peso quando a UM é KG. */
function isKgQuantityCell(sheet: ExportSheet, row: number, column: number): boolean {
  const unitColumn = column - 1;
  if (unitColumn < 0 || sheet.rows[row]?.[unitColumn] !== "KG") return false;
  return sheet.rows
    .slice(0, row)
    .some((header) => header[unitColumn] === "Unidade" && header[column] === "Recebida");
}

/**
 * Largura da coluna = maior entre o cabeçalho e as células (limitada):
 * descrições longas não estouram a planilha e colunas curtas não ficam
 * com folga desnecessária.
 */
function columnWidth(header: string, values: readonly ExportCell[]): number {
  let width = header.length;
  for (const value of values) {
    const length = value === null ? 0 : value instanceof Date ? 10 : String(value).length;
    if (length > width) width = length;
  }
  return Math.min(Math.max(width + 2, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
}

/** Bytes do .xlsx (SheetJS materializa o zip sobre ArrayBuffer). */
export function buildWorkbook(sheet: ExportSheet): Uint8Array<ArrayBuffer> {
  return buildWorkbookSheets([{ name: "Lista", sheet }]);
}

/** Um item do arquivo com várias abas: nome + planilha. */
export interface NamedExportSheet {
  name: string;
  sheet: ExportSheet;
}

/** Excel limita o nome da aba a 31 caracteres e proíbe `[]:*?/\`. */
function sheetName(name: string): string {
  const clean = name.replace(/[[\]:*?\/\\]/g, " ").trim();
  return (clean || "Planilha").slice(0, 31);
}

/** Monta o .xlsx com uma ou mais abas, preservando a ordem recebida. */
export function buildWorkbookSheets(sheets: readonly NamedExportSheet[]): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) {
    throw new Error("A exportação precisa de ao menos uma aba.");
  }

  const workbook = XLSX.utils.book_new();
  for (const { name, sheet } of sheets) {
    XLSX.utils.book_append_sheet(workbook, buildWorksheet(sheet), sheetName(name));
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array<ArrayBuffer>;
}

/** Bytes de UMA aba, com formatos de data/número aplicados. */
function buildWorksheet(sheet: ExportSheet): XLSX.WorkSheet {
  const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
  const lastRow = sheet.rows.length;

  // Formatos por célula: datas dd/MM/yyyy, pesos em kg com até 2 casas e
  // os demais números com a precisão padrão (quantidades/M/m² inalteradas).
  for (let column = 0; column < sheet.headers.length; column += 1) {
    for (let index = 1; index <= lastRow; index += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: index, c: column })];
      if (!cell || cell.t !== "n") continue;
      if (isDateColumn(sheet, column)) {
        cell.z = DATE_FORMAT;
      } else {
        cell.z = isWeightColumn(sheet, column) || isKgQuantityCell(sheet, index - 1, column)
          ? WEIGHT_FORMAT
          : NUMBER_FORMAT;
      }
    }
  }

  worksheet["!cols"] = sheet.headers.map((header, column) => ({
    wch: columnWidth(header, sheet.rows.map((row) => row[column])),
  }));

  return worksheet;
}

/** Resposta HTTP de download com o nome `<tela>-<AAAA-MM-DD>.xlsx`. */
export function workbookResponse(fileName: string, sheet: ExportSheet): Response {
  return workbookResponseSheets(fileName, [{ name: "Lista", sheet }]);
}

/** Resposta HTTP de download de um workbook com várias abas. */
export function workbookResponseSheets(
  fileName: string,
  sheets: readonly NamedExportSheet[],
): Response {
  return new Response(buildWorkbookSheets(sheets), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
