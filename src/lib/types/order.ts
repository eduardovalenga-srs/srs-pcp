import type { OrderStatus, OrderType } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";
import type { FamilyTotal } from "@/lib/types/production";

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
  /** 031: data efetiva da conclusão (exibida no MP concluído). */
  completedAt: string | null;
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

/**
 * Filtros da tela Fábrica 1 (itens filhos com matérias-primas).
 * Mesmos nomes de coluna da gestão de entregas — cada filtro mora no
 * cabeçalho da coluna correspondente (a barra mobile cuida dos principais).
 */
export interface ChildItemFilters {
  /** Busca genérica (descrição ou código do filho) — barra mobile. */
  search: string;
  /** Código da OF/OS (parcial). */
  orderCode: string;
  /** Nome do cliente (parcial). */
  customer: string;
  /** Código do item pai (parcial). */
  parentItem: string;
  /** Código do próprio filho (parcial). */
  childItem: string;
  /** Descrição do filho (parcial). */
  description: string;
  /** Descrição da matéria-prima (parcial). */
  material: string;
  /**
   * Período de entrega (AAAA-MM-DD ou null = lado aberto), aplicado sobre a
   * data do FILHO (itens sem data própria ficam de fora, como na gestão).
   */
  deliveryFrom: string | null;
  deliveryTo: string | null;
  /** Processo aplicado às linhas do filho (coluna do grupo PROCESSOS). */
  processCode: string | "ALL";
  /** Situação do processo (combinável com o código ou sozinha). */
  processStatus: ProcessStatus | "ALL";
  page: number;
  pageSize: number;
}

/**
 * Processo de um item filho — catálogo + situação (linha da Fábrica 1).
 * Carrega o id da linha em `production_processes`: é ele que a folha de
 * edição grava quando o usuário atualiza a situação na tabela.
 */
export interface ChildItemProcess {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  status: ProcessStatus;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  notes: string | null;
}

/** Item FILHO de uma OF com seus materiais — insumo de uma linha da Fábrica 1. */
export interface ChildItemGroupMember {
  id: string;
  /** Descrição do filho — define a descrição exibida do grupo (1º membro). */
  description: string;
  /** Código do pai (badge) — `order_items.parent_item` do item RAIZ. */
  parentItem: string | null;
  parentDescription: string | null;
  /** Entrega do PAI (com fallback para a data da OF) — coluna MP herdada. */
  parentDeliveryDate: string | null;
  /** Situação dos processos do PAI — a coluna MP da Fábrica 1 mostra este valor. */
  parentProcessStatuses: Readonly<Record<string, ProcessStatus>>;
  /** 031: data efetiva do MP concluído no PAI. */
  parentMpCompletedAt: string | null;
  quantity: number;
  unitWeightKg: number | null;
  /** Entrega do próprio filho, com fallback para a data da OF. */
  deliveryDate: string | null;
  /** 036: sequência de fabricação do próprio item filho. */
  seq: number | null;
  processes: ChildItemProcess[];
  materials: OrderItemMaterial[];
}

/**
 * Linha da tela Fábrica 1 (033): um GRUPO por código de item filho dentro
 * da OF — os itens repetidos (mesmo `cp_comp`) viram uma linha só, com
 * quantidade e peso somados e a situação dos processos agregada.
 */
export interface ChildItemGroup {
  /** Chave estável da linha (`orderId` + código) — usada como row id. */
  id: string;
  orderId: string;
  orderCode: string;
  customerName: string | null;
  /** Código do pai (badge) do primeiro membro + total de pais distintos. */
  parentItem: string | null;
  parentDescription: string | null;
  /** Nomes dos pais distintos do grupo (tooltip do "+N"). */
  parentItems: string[];
  /** Código do filho (badge) — chave do grupo; null quando veio vazio. */
  childItem: string | null;
  description: string;
  /** Itens agrupados nesta linha (exibido como ×N). */
  memberCount: number;
  /** Ids dos itens membros — escopo da edição em lote da folha. */
  memberIds: string[];
  /** Σ das quantidades dos membros. */
  quantity: number;
  /** Peso unitário quando todos os membros coincidem; senão null. */
  unitWeightKg: number | null;
  /** Σ (qtd × peso unit.) dos membros — null quando nenhum tem peso. */
  weightTotal: number | null;
  /** Menor entrega dos membros (com fallback para a data da OF). */
  deliveryDate: string | null;
  /**
   * 036: sequência de fabricação do grupo = MENOR seq dos membros
   * (null = nenhuma linha do grupo numerada). Editar na tela aplica o
   * número a todos os membros.
   */
  seq: number | null;
  /** Processos agregados por código (situação + Σ das quantidades). */
  processes: ChildItemProcess[];
  /**
   * Situação agregada dos processos dos PAIS do grupo — a coluna MP da
   * Fábrica 1 mostra este valor (editado na gestão de entregas).
   */
  parentProcessStatuses: Readonly<Record<string, ProcessStatus>>;
  /** 031: data efetiva mais recente do MP concluído nos pais. */
  parentMpCompletedAt: string | null;
  /** Menor entrega dos pais (com fallback para a data da OF). */
  parentDeliveryDate: string | null;
  /** Materiais mesclados por descrição+unidade, com Σ de quantidade. */
  materials: OrderItemMaterial[];
}

export interface ChildItemGroupsResult {
  items: ChildItemGroup[];
  /** Nº de GRUPOS (linhas) do conjunto filtrado — card e paginação. */
  total: number;
  /** Soma da coluna Qtd. de TODO o conjunto filtrado (card Eventos). */
  qtyTotal: number;
  /** Peso total (kg) do conjunto filtrado — Σ (qtd × peso unit.). */
  weightTotal: number;
  /** 035: quebra por família do MESMO conjunto dos totais acima (todas as páginas). */
  familyTotals: FamilyTotal[];
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
