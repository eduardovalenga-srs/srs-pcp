import type { DeliveryFilter } from "@/lib/constants/pagination";
import type { OrderStatus } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";

/** Situação de um processo em um item (célula da tabela). */
export interface ProcessCell {
  id: string;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
  /** 031: data/hora efetiva da conclusão (production_processes.completed_at). */
  completedAt: string | null;
}

/**
 * Célula de processo AGREGADA por OF (025): soma quantidades e situações
 * de todos os itens aplicáveis da OF naquele processo. A edição em lote
 * aplica a mesma situação a todos eles — os números ficam aqui para o
 * tooltip e para o contador "feito/aplicável".
 */
export interface OrderProcessCell {
  /** Pior situação entre os itens aplicáveis (NAO_INICIADO > CONCLUIDO). */
  status: ProcessStatus;
  /** Quantos itens aplicáveis estão CONCLUIDO (numerador do contador). */
  done: number;
  /** Quantos itens têm o processo aplicável (0 => a célula vira "—"). */
  applicable: number;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  /** 031: maior data/hora efetiva entre os itens concluídos (031). */
  completedAt: string | null;
}

/** Linha da tela de gestão de entregas — UMA por pedido (OF/OS) (025). */
export interface ProductionOrderRow {
  orderId: string;
  orderCode: string;
  orderType: string;
  customerName: string;
  orderStatus: OrderStatus;
  /** Entrega exibida = data do PEDIDO (orders.delivery_date). */
  deliveryDate: string | null;
  /** Soma das quantidades dos itens raiz da OF. */
  quantity: number;
  /** Soma do peso total (qtd × peso unit.) dos itens raiz da OF. */
  weightTotal: number | null;
  /** Entrega do pedido vencida e algum item raiz sem EXPEDIÇÃO concluída. */
  overdue: boolean;
  /** 036: menor seq entre os itens raiz da OF (null = sem número). */
  seq: number | null;
  /** Todas as etapas do catálogo, agregadas pela OF (código -> célula). */
  processes: Record<string, OrderProcessCell>;
}

/** Linha da tela de gestão de entregas. */
export interface ProductionRow {
  orderItemId: string;
  orderId: string;
  orderCode: string;
  orderType: string;
  customerName: string;
  orderStatus: OrderStatus;
  family: string;
  parentItem: string;
  description: string;
  quantity: number;
  unitWeightKg: number | null;
  deliveryDate: string | null;
  itemStatus: OrderStatus;
  /** Código da Ordem de Produção (013) — null = em espera. */
  op: string | null;
  overdue: boolean;
  /** 036: sequência de fabricação do item (null = sem número). */
  seq: number | null;
  processes: Record<string, ProcessCell>;
}

export interface ProductionFilters {
  search: string;
  orderStatus: OrderStatus | "ALL";
  processCode: string | "ALL";
  processStatus: ProcessStatus | "ALL";
  delivery: DeliveryFilter;
  /**
   * Período de entrega (014): datas YYYY-MM-DD ou null (lado aberto).
   * Inclusivo nos dois limites; itens sem data ficam de fora quando
   * o lado correspondente está definido.
   */
  deliveryFrom: string | null;
  deliveryTo: string | null;
  /** Filtro por coluna — texto ("contém"). */
  orderCode: string;
  customer: string;
  family: string;
  parentItem: string;
  description: string;
  /** 038: coluna OP ("contém") — só a Fábrica 2 exibe a coluna. */
  op: string;
  /** Filtro por coluna — faixa numérica (null = sem limite). */
  qtyMin: number | null;
  qtyMax: number | null;
  weightMin: number | null;
  weightMax: number | null;
  /**
   * 038: coluna Seq. por IGUALDADE (seq = N). O número é exclusivo por
   * OF (trigger da 038) — o filtro devolve a linha do planejamento.
   */
  seq: number | null;
  sort: string;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Resultado da listagem da Fábrica 2 (uma linha por item raiz). */
export interface ProductionResult {
  rows: ProductionRow[];
  total: number;
  /** Peso total (kg) da lista filtrada inteira — soma da coluna "Peso" de todas as páginas. */
  weightTotal: number;
  /** Soma da coluna "Qtd." da lista filtrada inteira — de todas as páginas. */
  qtyTotal: number;
}

/** Resultado da listagem consolidada por OF (025). */
export interface ProductionOrderResult {
  rows: ProductionOrderRow[];
  total: number;
  /** Peso total (kg) da lista filtrada inteira — soma dos pesos das OFs. */
  weightTotal: number;
  /** Soma das quantidades da lista filtrada inteira — de todas as páginas. */
  qtyTotal: number;
}

/** Processo do catálogo (ordem de exibição). */
export interface ProcessDefinition {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  active: boolean;
  /** Onde o processo acontece (ex.: "Fábrica 1"). */
  location: string | null;
  /** Dias corridos que o processo leva — base das datas previstas. */
  durationDays: number;
}

/** Estatísticas do dashboard. */
export interface ProcessStat {
  code: string;
  name: string;
  displayOrder: number;
  total: number;
  pending: number;
  done: number;
}

export interface ProductionStats {
  totalOrders: number;
  ordersByStatus: Record<string, number>;
  totalItems: number;
  itemsByStatus: Record<string, number>;
  itemsInProduction: number;
  itemsDone: number;
  itemsOverdue: number;
  delivery: {
    overdue: number;
    /** Soma da coluna "Qtd." dos itens em atraso (019). */
    overdueQty: number;
    /** Soma da coluna "Peso" dos itens em atraso (019). */
    overdueWeight: number;
    today: number;
    next7: number;
    next30: number;
  };
  /** Itens com EXPEDIÇÃO concluída (020): contagem, peças e peso. */
  expedition: {
    count: number;
    qty: number;
    weight: number;
  };
  processes: ProcessStat[];
}

/** Evento de histórico de produção. */
export interface ProductionEvent {
  id: string;
  productionProcessId: string;
  event_type: string;
  oldStatus: ProcessStatus | null;
  newStatus: ProcessStatus | null;
  oldQuantity: number | null;
  newQuantity: number | null;
  notes: string | null;
  createdAt: string;
  userName: string | null;
  processCode: string | null;
  itemDescription: string | null;
}
