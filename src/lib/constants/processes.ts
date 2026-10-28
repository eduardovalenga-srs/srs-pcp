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

/**
 * Processos rastreados nos ITENS FILHOS — a cadeia da Fábrica 1 (LASER…FICEP)
 * e o KIT (039), que encerra a cadeia do filho.
 *
 * Espelha o `scoped_rows` da RPC `get_production_rows_by_order` (migration
 * 039): a leitura da gestão de OF agrega esses códigos dos filhos, então a
 * edição em LOTE precisa gravar no mesmo escopo — nos filhos. Os demais
 * processos (MP, PRÉ-MTG…EXP) vêm dos itens RAIZ.
 */
export const CHILD_SCOPED_PROCESS_CODES: readonly string[] = [
  ...F1_PROCESS_CODES,
  KIT_PROCESS_CODE,
];

/**
 * Colunas de processos da tela Fábrica 1: a cadeia da Fábrica 1 — MP primeiro,
 * depois as etapas de sub-item (LASER…FICEP) e o KIT, que encerra a cadeia.
 * O que vem depois do KIT (PRÉ-MTG, SOLDA, ACAB, QUALITY, EXP) acontece no
 * kit montado e fica na gestão de entregas.
 */
export const FABRICA1_PROCESS_CODES: readonly string[] = [
  MP_PROCESS_CODE,
  ...F1_PROCESS_CODES,
  KIT_PROCESS_CODE,
];

/**
 * Processos da Fábrica 1 com edição de status NA TELA: as etapas de sub-item e
 * o KIT — cada um grava a linha do próprio filho. O MP fica de fora: ele
 * aparece nas duas telas e o valor exibido aqui é o do ITEM PAI, editado na
 * gestão de entregas.
 */
export const FABRICA1_EDITABLE_PROCESS_CODES: readonly string[] = [
  ...F1_PROCESS_CODES,
  KIT_PROCESS_CODE,
];

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
