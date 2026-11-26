import * as XLSX from "xlsx";

import { extractPdfText, type PdfTextItem } from "@/lib/import/pdf-text";
import type { EmployeeImportRow } from "@/lib/types/employee";
import { employeeImportKey } from "@/lib/utils/employee-import";

const COMPANY_NAMES: Record<string, string> = {
  "752": "SRS DESENVOLVIMENTO LTDA",
  "750": "SRS PROJETOS E DESENVOLVIMENTOS LTDA",
};

export type EmployeeImportPreview = {
  rows: EmployeeImportRow[];
  spreadsheetRows: number;
  pdfRows: number;
  matchedRows: number;
  discrepancies: EmployeeImportDiscrepancy[];
  warnings: string[];
};

export type EmployeeImportDiscrepancy = {
  key: string;
  company_code: string;
  registration: string;
  name: string;
  source: "PLANILHA" | "PDF" | "AMBOS";
  reason: "SOMENTE_PLANILHA" | "SOMENTE_PDF" | "NOME_DIVERGENTE";
  otherName?: string;
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
  // A planilha pode ter várias seções "Empresa:" na mesma aba; cada funcionário
  // pertence à empresa do último cabeçalho lido antes da sua linha.
  let companyCode: string | null = null;
  let companyName: string | null = null;
  let sawCompanyHeader = false;

  const records: EmployeeImportRow[] = [];
  for (const row of matrix) {
    if (normalizeText(cleanCell(row[0])) === "EMPRESA:") {
      sawCompanyHeader = true;
      const code = registrationText(row[1]);
      companyCode = code || null;
      companyName = code ? cleanCell(row[2]) || COMPANY_NAMES[code] || null : null;
      continue;
    }

    if (!companyCode || !companyName) continue;

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
      registered_client: null,
      registered_function: null,
      source: "PLANILHA",
    });
  }

  if (!sawCompanyHeader) {
    throw new Error("Não identifiquei a empresa na planilha. Confira o relatório e tente novamente.");
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
        const employeeItem = line.find(
          (item) => item.x < 215 && /^\s*\d{1,4}\s*-\s*.+/.test(item.str),
        );
        const match = employeeItem?.str.match(/^\s*(\d{1,4})\s*-\s*(.+?)\s*$/);
        const registration = match?.[1]?.replace(/^0+(?=\d)/, "");
        const name = match?.[2]?.trim() ?? "";
        if (!registration || !name) continue;

        const registeredFunction = line
          .filter((item) => item.x >= 215 && item.x < 300)
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim() || null;
        const registeredClient = line
          .filter((item) => item.x >= 300 && item.x < 390)
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim() || null;

        records.push({
          company_code: companyCode,
          company_name: COMPANY_NAMES[companyCode]!,
          registration,
          name,
          admission_date: null,
          dismissal_date: null,
          registered_client: registeredClient,
          registered_function: registeredFunction,
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
  const discrepancies: EmployeeImportDiscrepancy[] = [];
  const hasPdfRoster = Boolean(pdf && pdfRows.length > 0);

  for (const row of spreadsheetRows) {
    merged.set(employeeImportKey(row.company_code, row.registration), row);
  }

  let matchedRows = 0;
  const pdfKeys = new Set(pdfRows.map((row) => employeeImportKey(row.company_code, row.registration)));
  for (const pdfRow of pdfRows) {
    const key = employeeImportKey(pdfRow.company_code, pdfRow.registration);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, pdfRow);
      discrepancies.push({
        key,
        company_code: pdfRow.company_code,
        registration: pdfRow.registration,
        name: pdfRow.name,
        source: "PDF",
        reason: "SOMENTE_PDF",
      });
      continue;
    }
    if (normalizeText(existing.name) !== normalizeText(pdfRow.name)) {
      discrepancies.push({
        key,
        company_code: pdfRow.company_code,
        registration: existing.registration,
        name: existing.name,
        source: "AMBOS",
        reason: "NOME_DIVERGENTE",
        otherName: pdfRow.name,
      });
      warnings.push(
        `Matrícula ${pdfRow.registration} da empresa ${pdfRow.company_code}: os nomes divergem; os dados do PDF não foram aplicados a esse funcionário.`,
      );
      continue;
    }
    if (pdfRow.registered_client) {
      existing.registered_client = pdfRow.registered_client;
    }
    if (pdfRow.registered_function) existing.registered_function = pdfRow.registered_function;
    matchedRows += 1;
  }

  if (hasPdfRoster) {
    for (const row of spreadsheetRows) {
      const key = employeeImportKey(row.company_code, row.registration);
      if (pdfKeys.has(key)) continue;
      discrepancies.push({
        key,
        company_code: row.company_code,
        registration: row.registration,
        name: row.name,
        source: "PLANILHA",
        reason: "SOMENTE_PLANILHA",
      });
    }
  }

  const activeWithoutRegisteredClient = spreadsheetRows.filter((row) => {
    const imported = merged.get(employeeImportKey(row.company_code, row.registration));
    return !row.dismissal_date && !imported?.registered_client;
  }).length;
  if (hasPdfRoster && activeWithoutRegisteredClient > 0) {
    warnings.push(
      `${activeWithoutRegisteredClient} funcionário(s) ativo(s) da planilha ficaram sem Departamento associado do PDF; Cliente Cadastrado ficará vazio.`,
    );
  }

  if (pdfRows.length === 0 && pdf) {
    warnings.push("Não foi possível identificar funcionários no PDF enviado.");
  }

  return {
    rows: [...merged.values()],
    spreadsheetRows: spreadsheetRows.length,
    pdfRows: pdfRows.length,
    matchedRows,
    discrepancies: [...new Map(discrepancies.map((item) => [item.key, item])).values()],
    warnings,
  };
}
