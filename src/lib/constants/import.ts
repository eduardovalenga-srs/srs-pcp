/** Limites e constantes da importação de planilhas. */

/** 20 MB — alterável via variável de ambiente IMPORT_MAX_FILE_SIZE. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export const ALLOWED_IMPORT_EXTENSIONS = [".xlsx", ".xls", ".pdf"] as const;

export const ALLOWED_IMPORT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/pdf",
  "application/octet-stream",
  "application/zip",
  "",
] as const;

/** Extensão do PDF da A1 Engenharia (Ordem de Fabricação). */
export const PDF_IMPORT_EXTENSION = ".pdf";

/** Nome da pseudo-aba do PDF na análise (seção lida). */
export const PDF_COMPOSITION_SHEET_NAME = "Composição dos conjuntos";

/** Máximo de linhas aceitas em uma planilha de importação. */
export const MAX_IMPORT_ROWS = 20_000;

export const IMPORT_BATCH_STATUSES = [
  "PENDENTE",
  "PROCESSANDO",
  "CONCLUIDO",
  "COM_ERROS",
  "FALHOU",
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/**
 * Decisões possíveis para uma OF já existente no sistema (prévia).
 * A prévia pergunta o que fazer OF a OF — nunca sobrescreve em silêncio.
 */
export const IMPORT_DECISIONS = ["UPDATE", "KEEP", "SKIP"] as const;
export type ImportDecision = (typeof IMPORT_DECISIONS)[number];

export const IMPORT_DECISION_LABELS: Record<ImportDecision, string> = {
  UPDATE: "Atualizar diferenças",
  KEEP: "Manter dados do sistema",
  SKIP: "Ignorar esta OF",
};

export const IMPORT_DECISION_DESCRIPTIONS: Record<ImportDecision, string> = {
  UPDATE:
    "Grava o que difere, substitui filhos e materiais pelos do arquivo e preserva status dos processos e OP dos itens que permanecem.",
  KEEP: "Não altera nada no sistema; esta OF fica como está.",
  SKIP: "Não importa esta OF nesta carga (também não altera nada).",
};

export const IMPORT_ERROR_TYPES = [
  "REQUIRED",
  "NUMBER",
  "DATE",
  "DUPLICATE",
  "UNKNOWN_COLUMN",
  "UNKNOWN_VALUE",
  "STRUCTURE",
  "SYSTEM",
] as const;
export type ImportErrorType = (typeof IMPORT_ERROR_TYPES)[number];
