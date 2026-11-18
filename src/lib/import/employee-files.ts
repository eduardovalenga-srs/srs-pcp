import * as XLSX from "xlsx";

import { extractPdfText, type PdfTextItem } from "@/lib/import/pdf-text";
import type { EmployeeImportRow } from "@/lib/types/employee";

const COMPANY_NAMES: Record<string, string> = {
  "752": "SRS DESENVOLVIMENTO LTDA",
  "750": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
};

export type EmployeeImportPreview = {
  rows: EmployeeImportRow[];
  spreadsheetRows: number;
  pdfRows: number;
  matchedLocations: number;
  pdfOnlyRows: number;
  warnings: string[];
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function cleanCell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseExcelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = cleanCell(value);
  const brDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brDate) return `${brDate[3]}-${brDate[2].padStart(2, "0")}-${brDate[1].padStart(2, "0")}`;
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return isoDate ? `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}` : null;
}

function registrationText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return cleanCell(value).replace(/\.0$/, "");
}

function parseSpreadsheet(buffer: ArrayBuffer): EmployeeImportRow[] {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: "array",
    cellDates: true,
    cellFormula: false,
    bookVBA: false,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("A planilha não contém uma aba legível.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  let companyCode: string | null = null;
  let companyName: string | null = null;
  const companyRow = matrix.find((row) => normalizeText(cleanCell(row[0])) === "EMPRESA:");
  if (companyRow) {
    const code = registrationText(companyRow[1]);
    companyCode = code;
    companyName = cleanCell(companyRow[2]) || COMPANY_NAMES[code] || null;
  }
  if (!companyCode || !companyName) {
    throw new Error("Não identifiquei a empresa na planilha. Confira o relatório e tente novamente.");
  }

  const records: EmployeeImportRow[] = [];
  for (const row of matrix) {
    const registration = registrationText(row[0]);
    const name = cleanCell(row[1]);
    if (!/^\d+$/.test(registration) || !name) continue;

    records.push({
      company_code: companyCode,
      company_name: companyName,
      registration,
      name,
      admission_date: parseExcelDate(row[5]),
      dismissal_date: parseExcelDate(row[6]),
      location: null,
      source: "PLANILHA",
    });
  }

  if (records.length === 0) {
    throw new Error("Não encontrei linhas de funcionários na planilha enviada.");
  }
  return records;
}

function groupPdfRows(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const current = rows.at(-1);
    if (current && Math.abs(current[0]!.y - item.y) <= 2.5) current.push(item);
    else rows.push([item]);
  }
  return rows;
}

function parsePdf(buffer: ArrayBuffer): Promise<EmployeeImportRow[]> {
  return extractPdfText(buffer).then((pages) => {
    const records: EmployeeImportRow[] = [];
    for (const page of pages) {
      const pageText = page.items.map((item) => item.str).join(" ");
      const companyCode = /\b750\b/.test(pageText) && /SRS PROJETOS/i.test(pageText)
        ? "750"
        : /\b752\b/.test(pageText) && /SRS DESENVOLVIMENTO/i.test(pageText)
          ? "752"
          : null;
      if (!companyCode) continue;

      for (const line of groupPdfRows(page.items)) {
        const name = line
          .filter((item) => item.x >= 55 && item.x < 290)
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+\d{1,3}\s*$/, "")
          .trim();
        const normalizedName = normalizeText(name);
        if (
          !name ||
          normalizedName.startsWith("NOME DO EMPREGADO") ||
          normalizedName.includes("SRS DESENVOLVIMENTO LTDA") ||
          normalizedName.includes("SRS PROJETOS E DESENVOLVIMENTOS LTDA")
        ) continue;

        const codeItem = line.find((item) => item.x < 55 && /^\s*\d{1,4}\b/.test(item.str));
        const registration = codeItem?.str.match(/^\s*(\d{1,4})\b/)?.[1];
        if (!registration) continue;

        let location: string | null = null;
        const locationItems = [
          ...line.filter((item) => item.x >= 290 && item.x < 510),
          ...(codeItem ? [codeItem] : []),
        ];
        for (const item of locationItems) {
          const match = item.str.match(/\bGERAL\/(.+)/i);
          if (!match) continue;
          let value = `GERAL/${match[1]}`.trim();
          value = value.replace(/\s+\d{1,3}\s*$/, "").trim();
          const normalizedName = normalizeText(name);
          const normalizedValue = normalizeText(value);
          if (normalizedValue.endsWith(normalizedName)) {
            const suffix = value.toUpperCase().lastIndexOf(name.toUpperCase());
            if (suffix >= 0) value = value.slice(0, suffix).trim();
          }
          if (value.length > 6) {
            location = value.replace(/\s+/g, " ");
            break;
          }
        }

        records.push({
          company_code: companyCode,
          company_name: COMPANY_NAMES[companyCode]!,
          registration,
          name,
          admission_date: null,
          dismissal_date: null,
          location,
          source: "PDF",
        });
      }
    }
    return records;
  });
}

export async function parseEmployeeImportFiles(
  spreadsheet: ArrayBuffer,
  pdf?: ArrayBuffer,
): Promise<EmployeeImportPreview> {
  const spreadsheetRows = parseSpreadsheet(spreadsheet);
  const pdfRows = pdf ? await parsePdf(pdf) : [];
  const merged = new Map<string, EmployeeImportRow>();
  const warnings: string[] = [];

  for (const row of spreadsheetRows) {
    merged.set(`${row.company_code}:${row.registration}`, row);
  }

  let matchedLocations = 0;
  let pdfOnlyRows = 0;
  for (const pdfRow of pdfRows) {
    const key = `${pdfRow.company_code}:${pdfRow.registration}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, pdfRow);
      pdfOnlyRows += 1;
      continue;
    }
    if (normalizeText(existing.name) !== normalizeText(pdfRow.name)) {
      warnings.push(
        `Matrícula ${pdfRow.registration} da empresa ${pdfRow.company_code}: os nomes divergem entre os arquivos; a alocação do PDF não foi aplicada.`,
      );
      continue;
    }
    if (pdfRow.location) {
      existing.location = pdfRow.location;
      matchedLocations += 1;
    }
  }

  const activeWithoutLocation = spreadsheetRows.filter((row) => {
    const imported = merged.get(`${row.company_code}:${row.registration}`);
    return !row.dismissal_date && !imported?.location;
  }).length;
  if (activeWithoutLocation > 0) {
    warnings.push(
      `${activeWithoutLocation} funcionário(s) ativo(s) da planilha não aparecem no PDF; o local de alocação ficará vazio.`,
    );
  }

  if (pdfRows.length === 0 && pdf) {
    warnings.push("Não foi possível identificar funcionários no PDF enviado.");
  }

  return {
    rows: [...merged.values()],
    spreadsheetRows: spreadsheetRows.length,
    pdfRows: pdfRows.length,
    matchedLocations,
    pdfOnlyRows,
    warnings,
  };
}
