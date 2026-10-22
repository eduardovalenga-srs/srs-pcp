import type { ImportErrorType, ImportDecision } from "@/lib/constants/import";

/** Planilha lida do arquivo (cabeçalho técnico + linhas de dados). */
export interface ParsedSheet {
  name: string;
  headers: string[];
  headerRowIndex: number;
  rows: unknown[][];
}

export interface ParsedWorkbook {
  fileName: string;
  fileSize: number;
  sheets: ParsedSheet[];
}

/**
 * Formatos de planilha reconhecidos pela importação:
 * - `layout-of`: planilha da fábrica (colunas técnicas of_idOF, ps_idPos, ...);
 * - `lista-pecas`: lista de peças e conjuntos de cliente (CONJUNTO, PEÇA, ...);
 * - `lista-projeto`: lista de peças do projeto (GT/MD, PEÇA, CÓDIGO DA
 *   PEÇA, ... — arquivos TUCUMANN GC GERAL, sem número de OF).
 */
export type ImportSheetFormat = "layout-of" | "lista-pecas" | "lista-projeto";

/** Status de uma OF na prévia. */
export type RowStatus = "VALID" | "WARNING" | "ERROR";

/** Problema encontrado na estrutura (linha/coluna técnica + mensagem pt-BR). */
export interface StructureIssue {
  type: ImportErrorType;
  severity: "error" | "warning";
  /** Onde ocorreu: "Linha 12", "72ST18-018", "72ST18-018 / 72-742", "OF 107482". */
  where: string;
  /** Nome técnico da coluna (ex.: "cp_compqtdetotal") quando aplicável. */
  column: string | null;
  message: string;
  rawValue: string | null;
}

// -------------------------------------------------------------
// Estrutura hierárquica do arquivo: OF -> itens pai -> filhos -> MP
// -------------------------------------------------------------

/** Matéria-prima de um item. */
export interface FileMaterial {
  description: string;
  quantity: number;
  unit: string;
  notes: string | null;
}

/** Item filho (cp_comp) — mesmo formato dos campos de item. */
export interface FileChild {
  code: string;
  description: string;
  family: string | null;
  quantity: number;
  unitWeightKg: number | null;
  totalWeightKg: number | null;
  /** Entrega digitada no formulário — vale para todos os registros. */
  deliveryDate: string;
  materials: FileMaterial[];
}

/** Item pai (ps_idPos) — raiz da hierarquia, com filhos aninhados. */
export interface FileParent extends FileChild {
  children: FileChild[];
}

/** OF completa lida do arquivo (cliente e entrega vem do formulário). */
export interface FileOrder {
  code: string;
  type: string;
  customerName: string;
  description: string;
  deliveryDate: string;
  parents: FileParent[];
}

/** OF construída + rastro na planilha + ocorrências de validação. */
export interface BuiltOf extends FileOrder {
  /** Primeira linha da OF na planilha (1-based, para mensagens). */
  sourceRow: number;
  issues: StructureIssue[];
}

// -------------------------------------------------------------
// Diferenças sistema x arquivo (prévia de OF existente)
// -------------------------------------------------------------

export type DifferenceKind = "changed" | "added" | "removed";

export interface OfDifference {
  scope: "order" | "parent" | "child";
  /** Código da OF, do item pai ou do filho. */
  code: string;
  /** Código do item pai (para escopo "child"). */
  parentCode: string | null;
  field: string;
  label: string;
  current: string | null;
  incoming: string | null;
  kind: DifferenceKind;
  /** Item removido que tinha progresso (aviso importante). */
  hasProgress?: boolean;
}

// -------------------------------------------------------------
// Estado existente no banco (busca para a prévia)
// -------------------------------------------------------------

export interface ExistingItemMaterial {
  description: string;
  quantity: number;
  unit: string;
}

export interface ExistingOfItem {
  id: string;
  /** Vínculo com o item pai (null = nível raiz). */
  parentItemId: string | null;
  code: string;
  description: string;
  family: string | null;
  quantity: number;
  unitWeightKg: number | null;
  totalWeightKg: number | null;
  deliveryDate: string | null;
  status: string;
  op: string | null;
  materials: ExistingItemMaterial[];
  /** Algum processo avançou ou existe OP vinculada. */
  hasProgress: boolean;
}

export interface ExistingOfStructure {
  id: string;
  code: string;
  type: string;
  customerName: string | null;
  description: string | null;
  deliveryDate: string | null;
  status: string;
  items: ExistingOfItem[];
}

// -------------------------------------------------------------
// Prévia
// -------------------------------------------------------------

export interface OfPreview {
  order: FileOrder;
  sourceRow: number;
  status: RowStatus;
  issues: StructureIssue[];
  /** OF já existe no sistema? */
  exists: boolean;
  /** Status atual da OF quando existe. */
  existingStatus: string | null;
  differences: OfDifference[];
  counts: {
    parents: number;
    children: number;
    materials: number;
  };
  /** Ponto sem diferenças: as opções têm mesmo efeito (mostrar no pedido). */
  requiresDecision: boolean;
}

export interface ImportPreview {
  fileName: string;
  sheetName: string;
  customerName: string;
  deliveryDate: string;
  orders: OfPreview[];
  totals: {
    orders: number;
    /** OFs importáveis (sem erro). */
    importable: number;
    /** OFs existentes que exigem decisão. */
    existing: number;
    errors: number;
    warnings: number;
    parents: number;
    children: number;
    materials: number;
  };
  /** Colunas ignoradas (obra/área/desenhos) — informativo. */
  ignoredColumns: string[];
}

/** Decisão escolhida pelo usuário para cada OF existente. */
export type OfDecisionMap = Record<string, ImportDecision>;

// -------------------------------------------------------------
// Histórico de lotes
// -------------------------------------------------------------

export interface ImportBatchHistory {
  id: string;
  fileName: string;
  fileSize: number | null;
  status: string;
  totalRows: number | null;
  validRows: number | null;
  errorRows: number | null;
  warningRows: number | null;
  createdAt: string;
  completedAt: string | null;
  createdByName: string | null;
  errors: ImportErrorEntry[];
}

export interface ImportErrorEntry {
  rowNumber: number;
  columnName: string | null;
  errorType: string;
  message: string;
  rawValue: string | null;
}
