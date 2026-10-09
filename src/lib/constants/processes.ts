/**
 * Catálogo de processos de fabricação.
 *
 * IMPORTANTE: os processos NÃO são hardcoded na estrutura da tabela nem em
 * colunas do banco. Este arquivo contém apenas o "catálogo esperado" usado
 * para:
 *  - popular a tabela `processes` (seed);
 *  - sugerir o mapeamento de colunas do Excel;
 *  - rotular colunas no cabeçalho agrupado da tela de gestão de entregas.
 *
 * A fonte de verdade em runtime é a tabela `processes`.
 */

export const PROCESS_CODES = [
  "LASER",
  "DB_CH",
  "SERRA",
  "DB_TB",
  "PUNC",
  "METALEIRA",
  "FICEP",
  "KIT",
  "PRE_MTG",
  "SOLDA",
  "ACAB",
  "QUALITY",
  "EXP",
] as const;

export type ProcessCode = (typeof PROCESS_CODES)[number];

/** Rótulos exibidos na UI (espelham os cabeçalhos da planilha). */
export const PROCESS_LABELS: Record<ProcessCode, string> = {
  LASER: "LASER",
  DB_CH: "DB CH",
  SERRA: "SERRA",
  DB_TB: "DB TB",
  PUNC: "PUNC",
  METALEIRA: "METALEIRA",
  FICEP: "FICEP",
  KIT: "KIT",
  PRE_MTG: "PRÉ-MTG",
  SOLDA: "SOLDA",
  ACAB: "ACAB",
  QUALITY: "QUALITY",
  EXP: "EXP",
};

/**
 * Cadeia da Fábrica 1 (F1), na ordem da cadeia. Na gestão de entregas
 * essas colunas ficam ocultas — a primeira coluna de processos é a
 * **MP** (matéria-prima, migration 021), controlada como as demais.
 */
export const F1_PROCESS_CODES = [
  "LASER",
  "DB_CH",
  "SERRA",
  "DB_TB",
  "PUNC",
  "METALEIRA",
  "FICEP",
] as const;

export interface SeedProcess {
  code: string;
  name: string;
  displayOrder: number;
}

/** Processos iniciais cadastrados na migration 004. */
export const SEED_PROCESSES: SeedProcess[] = PROCESS_CODES.map((code, index) => ({
  code,
  name: PROCESS_LABELS[code],
  displayOrder: (index + 1) * 10,
}));

/** Processo cuja conclusão determina o envio — usado na regra de atraso. */
export const SHIPMENT_PROCESS_CODE: ProcessCode = "EXP";

/** KIT: a tela Fábrica 1 oculta os processos que vêm depois dele. */
export const KIT_PROCESS_CODE: ProcessCode = "KIT";

/**
 * Matéria-prima (migration 021): primeira coluna de processos da Fábrica 1.
 * Não faz parte do catálogo da migration 004 (entra pelo import).
 */
export const MP_PROCESS_CODE = "MP";

export function isProcessCode(value: string): value is ProcessCode {
  return (PROCESS_CODES as readonly string[]).includes(value);
}

/** Normaliza um código/rotulo de processo para comparção ("DB CH" -> "DBCH"). */
export function normalizeProcessKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
