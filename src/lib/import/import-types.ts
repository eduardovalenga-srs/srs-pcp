import type { ParsedSheet, ParsedWorkbook } from "@/lib/types/import";

/** Matriz de células lida de uma planilha. */
export type SheetMatrix = unknown[][];

export interface HeaderDetection {
  headerRowIndex: number;
  headers: string[];
  score: number;
  detected: boolean;
}

export interface AnalyzeResult extends ParsedWorkbook {
  /** Índice da linha de cabeçalho sugerido para cada planilha. */
  headerBySheet: Record<string, HeaderDetection>;
}

export type { ParsedSheet, ParsedWorkbook };
