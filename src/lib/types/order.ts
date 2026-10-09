import type { OrderStatus, OrderType } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";

/** Resumo de pedido para listagens. */
export interface OrderSummary {
  id: string;
  code: string;
  type: OrderType;
  customerName: string | null;
  description: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  status: OrderStatus;
  itemCount: number;
}

/** Processo de um item (catálogo + situação). */
export interface ItemProcess {
  id: string;
  processId: string;
  code: string;
  name: string;
  displayOrder: number;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
}

/** Matéria-prima de um sub-item (insumo — sem processos próprios). */
export interface OrderItemMaterial {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  notes: string | null;
}

/** Item de pedido com seus processos. */
export interface OrderItemDetails {
  id: string;
  orderId: string;
  /** Vínculo filho -> pai (016); null = item de nível raiz (pai/manual). */
  parentItemId: string | null;
  family: string | null;
  parentItem: string | null;
  description: string;
  quantity: number;
  unitWeightKg: number | null;
  totalWeightKg: number | null;
  deliveryDate: string | null;
  status: OrderStatus;
  /** Código da Ordem de Produção vinculada (013) — null = em espera. */
  op: string | null;
  processes: ItemProcess[];
  materials: OrderItemMaterial[];
}

/** Pedido completo (detalhes + itens). */
export interface OrderDetails extends Omit<OrderSummary, "itemCount"> {
  items: OrderItemDetails[];
}

export interface OrderFilters {
  search: string;
  status: OrderStatus | "ALL";
  page: number;
  pageSize: number;
}

export interface OrderListResult {
  orders: OrderSummary[];
  total: number;
}

/** Filtros da tela Fábrica 1 (itens filhos com matérias-primas). */
export interface ChildItemFilters {
  /** Descrição ou código do item filho. */
  search: string;
  /** Código da OF/OS (parcial). */
  orderCode: string;
  /** Descrição da matéria-prima (parcial). */
  material: string;
  page: number;
  pageSize: number;
}

/** Processo de um item filho — catálogo + situação (linha da Fábrica 1). */
export interface ChildItemProcess {
  code: string;
  name: string;
  displayOrder: number;
  status: ProcessStatus;
}

/** Item FILHO de uma OF com seus materiais — linha da tela Fábrica 1. */
export interface ChildItemWithMaterials {
  id: string;
  orderId: string;
  orderCode: string;
  customerName: string | null;
  /** Código do item pai (badge) e sua descrição. */
  parentItem: string | null;
  parentDescription: string | null;
  /** Código do próprio filho (badge) — `order_items.parent_item` do filho. */
  childItem: string | null;
  description: string;
  quantity: number;
  unitWeightKg: number | null;
  /** Entrega do item, com fallback para a data da OF. */
  deliveryDate: string | null;
  status: OrderStatus;
  processes: ChildItemProcess[];
  materials: OrderItemMaterial[];
}

export interface ChildItemMaterialsResult {
  items: ChildItemWithMaterials[];
  total: number;
  /** Soma da coluna Qtd. de TODO o conjunto filtrado (card Eventos). */
  qtyTotal: number;
  /** Peso total (kg) do conjunto filtrado — Σ (qtd × peso unit.). */
  weightTotal: number;
}

/** Payload de um item enviado pelo formulário. */
export interface OrderItemPayload {
  id?: string;
  family: string;
  parentItem: string;
  description: string;
  quantity: number;
  unitWeightKg: number | null;
  deliveryDate: string | null;
  processCodes: string[];
}
