import type { OrderStatus, OrderType } from "@/lib/constants/orders";
import type { RomaneioStatus } from "@/lib/constants/romaneio";
import type { ProcessStatus } from "@/lib/constants/production";

/** Resumo de um romaneio para a listagem. */
export interface RomaneioSummary {
  id: string;
  number: number;
  orderId: string;
  orderCode: string;
  customerName: string | null;
  orderDeliveryDate: string | null;
  status: RomaneioStatus;
  shipmentDate: string | null;
  carrier: string | null;
  /** Nº de itens incluídos no romaneio. */
  itemCount: number;
  /** Σ das quantidades expedidas neste romaneio. */
  quantityTotal: number;
  /** Peso total (kg) = Σ (qtd × peso unit.) dos itens; null quando sem peso. */
  weightTotal: number | null;
  nfNumber: string | null;
  returnNfNumber: string | null;
  /** Alguma linha tem saldo de devolução sem NF de devolução registrada. */
  pendingReturn: boolean;
  conferenceAcceptedAt: string | null;
  emittedAt: string | null;
  createdAt: string;
}

/** Filtros da listagem de romaneios (vivem na URL). */
export interface RomaneioFilters {
  /** Busca genérica (nº do romaneio, OF/OS ou cliente). */
  search: string;
  status: RomaneioStatus | "ALL";
  /** Coluna OF/OS por "contém". */
  orderCode: string;
  /** Coluna Cliente por "contém". */
  customer: string;
  /** Período da data de saída (inclusivo, lados opcionais). */
  shipmentFrom: string | null;
  shipmentTo: string | null;
  page: number;
  pageSize: number;
}

export interface RomaneiosPage {
  romaneios: RomaneioSummary[];
  total: number;
  /** Contagem de SIMULAÇÕES com os mesmos filtros (cartão de resumo). */
  simulationCount: number;
  /** Contagem de EMITIDOS com os mesmos filtros (cartão de resumo). */
  emittedCount: number;
}

/**
 * Item RAIZ da OF exibido no editor de itens — o EXP mora no pai
 * (import 032), então o romaneio expede itens raiz.
 */
export interface RomaneioOrderItem {
  orderItemId: string;
  family: string | null;
  parentItem: string | null;
  description: string;
  /** Quantidade total do item na OF. */
  itemQuantity: number;
  /** Peso unitário (kg) — coluna derivada da OF (023). */
  unitWeightKg: number | null;
  /** Quantidade já expedida em OUTROS romaneios EMITIDOS da OF. */
  shippedQuantity: number;
  /** Situação do processo EXP do item (null = o item não tem linha de EXP). */
  expStatus: ProcessStatus | null;
  /** Quantidade incluída NESTE romaneio (0 = item fora da carga). */
  quantity: number;
}

/** Linha de material da devolução (exibida no editor). */
export interface RomaneioMaterialLine {
  description: string;
  unit: string;
  /** Alocado do pedido (informativo) — recalculado a cada carga. */
  quantityPlanned: number;
  /** Informado: recebido do cliente (null = ainda não informado). */
  quantityReceived: number | null;
  /** Informado: utilizado na produção (null = ainda não informado). */
  quantityUsed: number | null;
  /** Derivado: recebida − utilizada (null quando falta informação). */
  quantityReturned: number | null;
}

/** Σ dos materiais da OF inteira (todos os romaneios não cancelados). */
export interface RomaneioOfMaterialTotals {
  received: number;
  used: number;
  returned: number;
}

/** Pré-requisitos de emissão (gates) — exibidos como checklist na tela. */
export interface RomaneioEmissionCheck {
  canEmit: boolean;
  /** Motivos que impedem a emissão (mensagens prontas para exibir). */
  blockers: string[];
}

/** Visão completa do romaneio para a tela de detalhe. */
export interface RomaneioView {
  id: string;
  number: number;
  status: RomaneioStatus;
  orderId: string;
  orderCode: string;
  orderType: OrderType;
  customerName: string | null;
  orderDeliveryDate: string | null;
  orderStatus: OrderStatus;
  shipmentDate: string | null;
  carrier: string | null;
  vehicle: string | null;
  notes: string | null;
  conferenceAcceptedAt: string | null;
  conferenceAcceptedByName: string | null;
  conferenceNotes: string | null;
  emittedAt: string | null;
  nfNumber: string | null;
  returnNfNumber: string | null;
  createdAt: string;
  /** Itens raiz da OF com o estado de expedição (editável só em simulação). */
  items: RomaneioOrderItem[];
  /** Linhas de material (editáveis só em simulação). */
  materials: RomaneioMaterialLine[];
  /** Σ da OF inteira entre romaneios não cancelados. */
  ofMaterialTotals: RomaneioOfMaterialTotals;
  /** Gates de emissão vigentes. */
  emission: RomaneioEmissionCheck;
  /** Edição liberada (simulação + capacidade romaneio.edit do perfil). */
  canEdit: boolean;
}

/** OF candidata a virar romaneio (seletor de /romaneio/novo). */
export interface RomaneioCandidate {
  orderId: string;
  code: string;
  type: OrderType;
  customerName: string | null;
  deliveryDate: string | null;
  status: OrderStatus;
  /** Σ das quantidades dos itens raiz. */
  rootQuantity: number;
  /** Peso total (kg) dos itens raiz quando todos têm peso unitário. */
  rootWeightKg: number | null;
  /** Quantidade já expedida (Σ de romaneios EMITIDOS da OF). */
  shippedQuantity: number;
  /** Já existe simulação aberta para esta OF (bloqueia nova simulação). */
  hasSimulation: boolean;
  /** Id da simulação aberta, quando houver — permite abrir o rascunho. */
  simulationId: string | null;
}

/** Filtros do seletor de OFs em /romaneio/novo. */
export interface RomaneioCandidateFilters {
  search: string;
  page: number;
  pageSize: number;
}

export interface RomaneioCandidatesPage {
  candidates: RomaneioCandidate[];
  total: number;
}
