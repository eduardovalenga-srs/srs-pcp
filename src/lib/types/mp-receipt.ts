import type { OrderStatus, OrderType } from "@/lib/constants/orders";

/**
 * Situação do RECEBIMENTO de matéria-prima de um item/coluna MP
 * (056): nenhum, parcial ou total — o espelho amarelo/verde das listas.
 */
export type MpReceiptState = "NONE" | "PARCIAL" | "TOTAL";

/**
 * Espelho do recebimento exibido na coluna MP (somente leitura):
 * estado + kg recebidos + peso planejado (null = item sem peso).
 */
export interface MpCellReceipt {
  state: MpReceiptState;
  /** Σ dos kg recebidos (derivado do material — 059). */
  receivedKg: number;
  /** Peso planejado do item (soma do material que o item consome). */
  plannedKg: number | null;
}

/** OF com pendência de MP (seletor de /recebimento-mp). */
export interface MpReceiptOfOption {
  orderId: string;
  code: string;
  type: OrderType;
  deliveryDate: string | null;
  status: OrderStatus;
  /** Materiais da OF ainda com saldo (um por matéria-prima). */
  pendingMaterials: number;
  /** Kg pendentes (null = nenhuma linha tem peso cadastrado). */
  pendingKg: number | null;
}

/**
 * Grupo do seletor em cascata de /recebimento-mp: um cliente e as OFs
 * dele com pendência de MP. `customerName: null` = bucket sem cliente.
 */
export interface MpReceiptCustomerOption {
  customerName: string | null;
  /** Quantidade de OFs disponíveis (resumo do dropdown). */
  ofCount: number;
  ofs: MpReceiptOfOption[];
}

/**
 * MATÉRIA-PRIMA de uma OF na tela de recebimento (059): uma linha por
 * material, somando os itens que o consomem. O item e o item pai saem
 * da tela — o material é o insumo, o item é quem consome.
 */
export interface MpReceiptMaterial {
  /** Chave normalizada do material (descrição + unidade em maiúsculas). */
  materialKey: string;
  /** Descrição do material como está na OF. */
  description: string;
  /** Unidade de medida (KG, UN, M…). */
  unit: string;
  /** Peso total que a OF precisa (soma dos itens que consomem o material). */
  totalKg: number;
  /** Σ dos kg já recebidos em todas as notas de entrada. */
  receivedKg: number;
  /** O que ainda falta (totalKg − receivedKg). */
  balanceKg: number;
}

/**
 * Linha do histórico de uma NOTA DE ENTRADA (cabeçalho + materiais).
 */
export interface MpReceiptHistoryEntry {
  id: string;
  number: number;
  /** Nº digitado da nota de entrada. */
  entryNumber: string;
  /** Data da nota de entrada (AAAA-MM-DD). */
  entryDate: string | null;
  notes: string | null;
  createdAt: string;
  userName: string | null;
  materials: {
    materialKey: string;
    description: string;
    unit: string;
    quantityKg: number;
  }[];
}
