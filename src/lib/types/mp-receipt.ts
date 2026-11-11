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
  /** Σ dos kg recebidos (mp_receipt_items). */
  receivedKg: number;
  /** Peso planejado do item (total_weight_kg; null = sem peso cadastrado). */
  plannedKg: number | null;
}

/** OF com pendência de MP (seletor de /recebimento-mp). */
export interface MpReceiptOfOption {
  orderId: string;
  code: string;
  type: OrderType;
  deliveryDate: string | null;
  status: OrderStatus;
  /** Nº de linhas (filhos + pai sem filhos) ainda sem receber totalmente. */
  pendingItems: number;
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
 * Item da OF na tela de recebimento (057): filho, ou pai sem filhos
 * (kg planejado/recebido/pendente por linha).
 */
export interface MpReceiptItemRow {
  orderItemId: string;
  description: string;
  /** Quantidade do item (un.) — contexto da linha. */
  quantity: number;
  unitWeightKg: number | null;
  /** Peso planejado (total_weight_kg com fallback qtd × peso un.). */
  plannedKg: number | null;
  /** Σ dos kg já recebidos em recibos anteriores. */
  receivedKg: number;
  state: MpReceiptState;
  /** Kg que ainda falta receber (null = sem peso cadastrado). */
  pendingKg: number | null;
}

/** Linha do histórico de um recebimento (cabeçalho + itens). */
export interface MpReceiptHistoryEntry {
  id: string;
  number: number;
  /** Data física do recebimento (AAAA-MM-DD). */
  receiptDate: string | null;
  notes: string | null;
  createdAt: string;
  userName: string | null;
  items: {
    orderItemId: string;
    description: string | null;
    quantityKg: number;
  }[];
}
