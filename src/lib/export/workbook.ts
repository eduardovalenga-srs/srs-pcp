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
/** Formato numérico — separador de milhar e até 3 decimais (pt-BR na tela). */
const NUMBER_FORMAT = "#,##0.###";

/** Largura mínima/máxima das colunas (caracteres) — calibrada nos rótulos. */
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;

/** A coluna tem datas (recebe o formato dd/MM/yyyy em vez do numérico). */
function isDateColumn(sheet: ExportSheet, column: number): boolean {
  return sheet.dateColumns.includes(column);
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
  const worksheet = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
  const lastRow = sheet.rows.length;

  // Formatos por célula: datas dd/MM/yyyy (o default do SheetJS é m/d/yy)
  // e números com a mesma leitura da tela (1.234,5) — só onde há valor.
  for (let column = 0; column < sheet.headers.length; column += 1) {
    const format = isDateColumn(sheet, column) ? DATE_FORMAT : NUMBER_FORMAT;
    for (let index = 1; index <= lastRow; index += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: index, c: column })];
      if (cell && cell.t === "n") cell.z = format;
    }
  }

  worksheet["!cols"] = sheet.headers.map((header, column) => ({
    wch: columnWidth(header, sheet.rows.map((row) => row[column])),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Lista");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array<ArrayBuffer>;
}

/** Resposta HTTP de download com o nome `<tela>-<AAAA-MM-DD>.xlsx`. */
export function workbookResponse(fileName: string, sheet: ExportSheet): Response {
  return new Response(buildWorkbook(sheet), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
