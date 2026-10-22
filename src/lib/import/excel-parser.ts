import * as XLSX from "xlsx";

import { MAX_IMPORT_ROWS } from "@/lib/constants/import";
import type { ParsedSheet } from "@/lib/types/import";
import type { AnalyzeResult, HeaderDetection, SheetMatrix } from "@/lib/import/import-types";

/**
 * Colunas técnicas do novo layout (normalizadas) usadas para detectar a
 * linha de cabeçalho. O arquivo da fábrica traz 3 linhas de cabeçalho
 * (grupo, rótulo, nome técnico) — a válida é a que contém os nomes
 * técnicos (of_idOF, ps_idPos, cp_comp, ...). O mapeamento é 100% por
 * nome: nenhuma coluna é mapeada pela posição.
 */
const TECHNICAL_HEADER_TOKENS = [
  "OFIDOF",
  "PSIDPOS",
  "PSDESCR",
  "PSQTDE",
  "PSTIPO",
  "POSPESETOTAL",
  "OFDESCR",
  "OFTIPO",
  "CPCOMP",
  "CPDESCR",
  "CPCOMPQTDETOTAL",
  "CPCOMPPESO",
  "CPDESMATERIAL",
  "COCOMPCODMAT",
];

/** Nomes técnicos que PRECISAM existir para o arquivo ser reconhecido. */
export const REQUIRED_TECHNICAL_COLUMNS = ["of_idOF", "ps_idPos", "ps_Descr", "cp_comp"] as const;

/** Colunas ausentes em relação ao layout esperado (vazio = ok). */
export function findMissingTechnicalColumns(headers: string[]): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return REQUIRED_TECHNICAL_COLUMNS.filter((column) => !present.has(normalizeHeader(column)));
}

/**
 * Colunas da LISTA DE PEÇAS E CONJUNTOS de cliente (038) — normalizadas.
 * Cabeçalho de 1 linha: CONJUNTO, PEÇA, QTDE, PERFIL, MATERIAL,
 * COMPR.(mm) e MASSA(Kg). Reconhecimento pelo NOME, como no layout da
 * fábrica — nenhuma coluna é mapeada pela posição.
 */
const PARTS_HEADER_TOKENS = [
  "CONJUNTO",
  "PECA",
  "QTDE",
  "PERFIL",
  "MATERIAL",
  "COMPRMM",
  "MASSAKG",
];

/** Colunas da lista de peças que PRECISAM existir para o arquivo ser reconhecido (nomes de exibição; a comparação normaliza acento). */
export const REQUIRED_PARTS_COLUMNS = ["CONJUNTO", "PEÇA", "QTDE"] as const;

/** Colunas da lista de peças ausentes (vazio = ok). */
export function findMissingPartsColumns(headers: string[]): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return REQUIRED_PARTS_COLUMNS.filter((column) => !present.has(normalizeHeader(column)));
}

/**
 * Colunas da LISTA DE PEÇAS DO PROJETO (arquivos TUCUMANN GC GERAL) —
 * normalizadas. Cabeçalho de 1 linha: GT/MD, PEÇA, CÓDIGO DA PEÇA, PEÇA
 * PRINCIPAL, QUANTIDADE EM PROJETO e MASSA TOTAL DO PROJETO (KG).
 * Reconhecimento pelo NOME, como nos demais formatos.
 */
const PROJECT_HEADER_TOKENS = [
  "GTMD",
  "PECA",
  "CODIGODAPECA",
  "PECAPRINCIPAL",
  "QUANTIDADEEMPROJETO",
  "MASSATOTALDOPROJETOKG",
];

/** Colunas da lista de peças do projeto que PRECISAM existir (nomes de exibição; a comparação normaliza acento). */
export const REQUIRED_PROJECT_COLUMNS = [
  "GT/MD",
  "PEÇA",
  "CÓDIGO DA PEÇA",
  "QUANTIDADE EM PROJETO",
] as const;

/** Colunas da lista de peças do projeto ausentes (vazio = ok). */
export function findMissingProjectColumns(headers: string[]): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return REQUIRED_PROJECT_COLUMNS.filter((column) => !present.has(normalizeHeader(column)));
}

/** Normaliza texto de cabeçalho: sem acento, sem espaço, maiúsculo. */
export function normalizeHeader(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Lê o arquivo Excel de forma segura.
 * - não executa macros;
 * - não interpreta fórmulas como código (lê apenas o valor em cache);
 * - aplica limite de linhas.
 */
export function parseExcelFile(data: ArrayBuffer, fileName: string, fileSize: number): AnalyzeResult {
  const workbook = XLSX.read(new Uint8Array(data), {
    type: "array",
    cellDates: true,
    cellFormula: false,
    cellStyles: false,
    cellNF: false,
    cellHTML: false,
    bookVBA: false,
    sheetStubs: false,
  });

  const sheets: ParsedSheet[] = [];
  const headerBySheet: Record<string, HeaderDetection> = {};

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    const matrix = XLSX.utils.sheet_to_json<SheetMatrix>(worksheet, {
      header: 1,
      raw: true,
      // Mantém linhas vazias para a numeração "Linha N" bater com o Excel.
      blankrows: true,
      defval: null,
    });

    if (matrix.length > MAX_IMPORT_ROWS) {
      throw new Error(`A planilha "${sheetName}" excede o limite de ${MAX_IMPORT_ROWS} linhas.`);
    }

    const detection = detectHeaderRow(matrix);
    const headers = toHeaders(matrix[detection.headerRowIndex] ?? []);

    sheets.push({
      name: sheetName,
      headers,
      headerRowIndex: detection.headerRowIndex,
      rows: matrix.slice(detection.headerRowIndex + 1),
    });

    headerBySheet[sheetName] = detection;
  }

  if (sheets.length === 0) {
    throw new Error("O arquivo não contém planilhas legíveis.");
  }

  return { fileName, fileSize, sheets, headerBySheet };
}

/**
 * Detecta a linha de cabeçalho pontuando as primeiras linhas por
 * coincidência com os nomes de coluna dos TRÊS formatos reconhecidos:
 *
 *  - layout da fábrica: válida com ao menos `of_idOF` e `ps_idPos`
 *    (o núcleo da estrutura OF -> pais -> filhos);
 *  - lista de peças e conjuntos: válida com ao menos `CONJUNTO`,
 *    `PEÇA` e `QTDE` (conjunto -> peça e quantidade);
 *  - lista de peças do projeto: válida com ao menos `GT/MD` e
 *    `CÓDIGO DA PEÇA` (grupo -> peça do projeto).
 *
 * O formato vencedor fica em `format`; sem reconhecimento, `detected`
 * false e a primeira linha é sugerida como está.
 */
export function detectHeaderRow(matrix: SheetMatrix): HeaderDetection {
  const searchLimit = Math.min(matrix.length, 15);
  let best: HeaderDetection = { headerRowIndex: 0, headers: [], score: 0, detected: false, format: null };

  for (let index = 0; index < searchLimit; index += 1) {
    const row = matrix[index] ?? [];
    const normalized = row.map(normalizeHeader);
    const technicalScore = normalized.reduce(
      (total, cell) => total + (cell && TECHNICAL_HEADER_TOKENS.includes(cell) ? 1 : 0),
      0,
    );
    const partsScore = normalized.reduce(
      (total, cell) => total + (cell && PARTS_HEADER_TOKENS.includes(cell) ? 1 : 0),
      0,
    );
    const projectScore = normalized.reduce(
      (total, cell) => total + (cell && PROJECT_HEADER_TOKENS.includes(cell) ? 1 : 0),
      0,
    );
    const hasTechnicalCore = normalized.includes("OFIDOF") && normalized.includes("PSIDPOS");
    const hasPartsCore =
      normalized.includes("CONJUNTO") && normalized.includes("PECA") && normalized.includes("QTDE");
    const hasProjectCore = normalized.includes("GTMD") && normalized.includes("CODIGODAPECA");

    if (hasTechnicalCore && technicalScore > best.score) {
      best = { headerRowIndex: index, headers: row.map(cellToString), score: technicalScore, detected: true, format: "layout-of" };
    } else if (hasPartsCore && partsScore > best.score) {
      best = { headerRowIndex: index, headers: row.map(cellToString), score: partsScore, detected: true, format: "lista-pecas" };
    } else if (hasProjectCore && projectScore > best.score) {
      best = { headerRowIndex: index, headers: row.map(cellToString), score: projectScore, detected: true, format: "lista-projeto" };
    }
  }

  if (!best.detected) {
    const firstRow = matrix[0] ?? [];
    return {
      headerRowIndex: 0,
      headers: firstRow.map(cellToString),
      score: best.score,
      detected: false,
      format: null,
    };
  }

  return best;
}

function toHeaders(row: unknown[]): string[] {
  return row.map(cellToString);
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}
