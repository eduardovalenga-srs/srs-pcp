import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type { ProcessStatus } from "@/lib/constants/production";
import type {
  RomaneioCustomerOption,
  RomaneioFilters,
  RomaneioOrderItem,
  RomaneioSummary,
  RomaneiosPage,
  RomaneioView,
} from "@/lib/types/romaneio";
import type {
  RomaneioConferenceValues,
  RomaneioNfValues,
  RomaneioValues,
} from "@/lib/validators/romaneio.schema";
import {
  cancelRomaneioRpc,
  confirmRomaneioRpc,
  deleteRomaneioRpc,
  getRomaneioById,
  getRomaneioSummary,
  listConfirmedQuantityByItem,
  listOrderMaterialLines,
  listRomaneioCustomers,
  listRomaneios,
  listRootOrderItems,
  saveRomaneioConferenceRpc,
  saveRomaneioRpc,
  updateRomaneioNfNumbers,
} from "@/lib/repositories/romaneio.repository";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { toNumber } from "@/lib/utils/formatting";
import { EXPORT_PAGE_SIZE, collectAllPages } from "@/lib/utils/collect-pages";
import {
  allocateRomaneioMaterials,
  checkRomaneioConfirmation,
  mergeRomaneioMaterialLines,
  resolveRomaneioWeights,
  storedMaterialLines,
  summarizeOfMaterialTotals,
  type RomaneioAllocationInput,
  type RomaneioOrderItemSource,
  type StoredMaterialLine,
} from "@/lib/utils/romaneio";

/** Lista paginada de romaneios + cartões de resumo por situação (047). */
export async function getRomaneiosPage(
  client: SupabaseServer,
  filters: RomaneioFilters,
): Promise<RomaneiosPage> {
  // O resumo roda na MESMA RPC de filtros da lista: os cartões batem
  // com o total da paginação (inclusive no filtro de peso, que é
  // agregado e o PostgREST não alcança).
  const [page, summary] = await Promise.all([
    listRomaneios(client, filters),
    getRomaneioSummary(client, filters),
  ]);

  return {
    romaneios: page.rows,
    total: summary.total,
    openCount: summary.open,
    conferredCount: summary.conferred,
    confirmedCount: summary.confirmed,
  };
}

/** Lista filtrada INTEIRA (todas as páginas) para a exportação .xlsx. */
export async function listRomaneiosForExport(
  client: SupabaseServer,
  filters: RomaneioFilters,
): Promise<RomaneioSummary[]> {
  return collectAllPages((page) =>
    listRomaneios(client, { ...filters, page, pageSize: EXPORT_PAGE_SIZE }),
  );
}

/** Clientes com OFs disponíveis para romaneio + as OFs de cada um. */
export async function getRomaneioCustomers(
  client: SupabaseServer,
): Promise<RomaneioCustomerOption[]> {
  return listRomaneioCustomers(client);
}

/**
 * `production_processes` do item → mapa código do catálogo → situação.
 * Base das colunas de processo da lista de itens no detalhe (chave
 * ausente = o item não tem linha daquele processo → "—").
 */
function processStatusMap(
  item: { production_processes: { status: ProcessStatus; processes: { code: string } | null }[] },
): Record<string, ProcessStatus> {
  const map: Record<string, ProcessStatus> = {};
  for (const row of item.production_processes ?? []) {
    if (row.processes?.code) map[row.processes.code] = row.status;
  }
  return map;
}

/**
 * Itens RAIZ de uma OF com o estado de expedição — a lista que o
 * usuário marca em /romaneio/novo antes de confirmar a criação do
 * romaneio (quantity nasce 0 = fora da carga).
 */
export async function getRomaneioOrderItems(
  client: SupabaseServer,
  orderId: string,
): Promise<RomaneioOrderItem[]> {
  const [rawItems, confirmedByItem] = await Promise.all([
    listRootOrderItems(client, orderId),
    listConfirmedQuantityByItem(client, orderId, null),
  ]);

  return rawItems.map((item) => {
    const exp = (item.production_processes ?? []).find(
      (process) => process.processes?.code === "EXP",
    );
    return {
      orderItemId: item.id,
      family: item.family,
      parentItem: item.parent_item,
      description: item.description,
      itemQuantity: toNumber(item.quantity) ?? 0,
      unitWeightKg: toNumber(item.unit_weight_kg),
      shippedQuantity: confirmedByItem.get(item.id) ?? 0,
      expStatus: exp ? exp.status : null,
      processes: processStatusMap(item),
      quantity: 0,
      conferenceChecked: false,
      // Sem carga não há peso a derivar — o detalhe resolve ao vivo.
      loadWeightKg: null,
    };
  });
}

/**
 * Visão completa do romaneio para a tela de detalhe: cabeçalho, itens
 * raiz da OF com o estado de expedição (EXP + já confirmado +
 * pendência) e a situação de cada processo por item (colunas da lista
 * de itens da carga), linhas de material (previsto alocado × informado)
 * e os gates de confirmação.
 */
export async function getRomaneioView(
  client: SupabaseServer,
  romaneioId: string,
  canEditCapability: boolean,
): Promise<RomaneioView | null> {
  const raw = await getRomaneioById(client, romaneioId);
  if (!raw) return null;

  const orderId = raw.orders.id;
  const [confirmedByItem, ofLines, processes] = await Promise.all([
    listConfirmedQuantityByItem(client, orderId, romaneioId),
    listOrderMaterialLines(client, orderId),
    getActiveProcesses(client),
  ]);

  // Estrutura completa da OF (raiz + filhos) com materiais — insumo da
  // alocação proporcional desta carga.
  const orderStructure: RomaneioOrderItemSource[] = raw.orders.order_items.map((item) => ({
    orderItemId: item.id,
    parentItemId: item.parent_order_item_id,
    quantity: toNumber(item.quantity) ?? 0,
    materials: (item.order_item_materials ?? []).map((material) => ({
      description: material.description,
      unit: material.unit,
      quantity: toNumber(material.quantity) ?? 0,
    })),
  }));

  const storedMaterials: StoredMaterialLine[] = (raw.romaneio_materials ?? []).map((line) => ({
    description: line.description,
    unit: line.unit,
    quantityPlanned: toNumber(line.quantity_planned) ?? 0,
    quantityReceived: toNumber(line.quantity_received),
    quantityUsed: toNumber(line.quantity_used),
  }));

  const includedByItem = new Map<string, number>();
  const checkedByItem = new Set<string>();
  for (const item of raw.romaneio_items ?? []) {
    includedByItem.set(item.order_item_id, toNumber(item.quantity) ?? 0);
    if (item.conference_checked) checkedByItem.add(item.order_item_id);
  }

  // Itens RAIZ da OF (o EXP mora no pai — itens filhos ficam de fora).
  const items: RomaneioOrderItem[] = raw.orders.order_items
    .filter((item) => item.parent_order_item_id === null)
    .map((item) => {
      const exp = (item.production_processes ?? []).find(
        (process) => process.processes?.code === "EXP",
      );
      return {
        orderItemId: item.id,
        family: item.family,
        parentItem: item.parent_item,
        description: item.description,
        itemQuantity: toNumber(item.quantity) ?? 0,
        unitWeightKg: toNumber(item.unit_weight_kg),
        shippedQuantity: confirmedByItem.get(item.id) ?? 0,
        expStatus: exp ? exp.status : null,
        processes: processStatusMap(item),
        quantity: includedByItem.get(item.id) ?? 0,
        conferenceChecked: checkedByItem.has(item.id),
        loadWeightKg: null,
      };
    });

  // Insumos da alocação desta carga (materiais e PESOS saem do mesmo
  // laço — servidor e cliente recalculam com a mesma entrada).
  const allocation: RomaneioAllocationInput = {
    includedItems: [...includedByItem].map(([orderItemId, quantity]) => ({
      orderItemId,
      quantity,
    })),
    orderItems: orderStructure,
  };

  // Em ABERTO as linhas de material nascem da alocação desta carga
  // (merge com o já informado); conferido/confirmado/cancelado mostra
  // o registro gravado.
  const allocated = raw.status === "ABERTO" ? allocateRomaneioMaterials(allocation) : [];

  const materials =
    raw.status === "ABERTO"
      ? mergeRomaneioMaterialLines(allocated, storedMaterials)
      : storedMaterialLines(storedMaterials);

  // Pesos da carga derivados da MESMA fonte (Σ da utilizada em KG) —
  // cada item raiz recebe o peso alocado da subárvore dele.
  const weights = resolveRomaneioWeights({
    materials,
    items,
    allocation,
  });
  for (const item of items) {
    item.loadWeightKg = weights.byItem.get(item.orderItemId) ?? null;
  }

  const confirmation = checkRomaneioConfirmation({
    status: raw.status,
    orderStatus: raw.orders.status,
    hasNfNumber: Boolean(raw.nf_number && raw.nf_number.trim() !== ""),
    items: items.map((item) => ({
      itemQuantity: item.itemQuantity,
      shippedQuantity: item.shippedQuantity,
      quantity: item.quantity,
      expStatus: item.expStatus,
    })),
  });

  return {
    id: raw.id,
    number: raw.number,
    status: raw.status,
    orderId,
    orderCode: raw.orders.code,
    orderType: raw.orders.type,
    customerName: raw.orders.customer_name,
    orderDeliveryDate: raw.orders.delivery_date,
    orderStatus: raw.orders.status,
    shipmentDate: raw.shipment_date,
    carrier: raw.carrier,
    vehicle: raw.vehicle,
    notes: raw.notes,
    conferenceAcceptedAt: raw.conference_accepted_at,
    conferenceAcceptedByName: raw.conference_user?.name ?? null,
    conferenceNotes: raw.conference_notes,
    emittedAt: raw.emitted_at,
    nfNumber: raw.nf_number,
    returnNfNumber: raw.return_nf_number,
    createdAt: raw.created_at,
    items,
    // Colunas de processo da lista de itens da carga (mesma regra da
    // antiga lista: catálogo ativo menos a cadeia F1, MP e KIT).
    processes,
    materials,
    // Insumos do preview ao vivo no detalhe (o cliente recalcula os
    // materiais/pesos a cada tecla com a MESMA lógica deste serviço).
    allocationItems: orderStructure,
    storedMaterials,
    ofMaterialTotals: summarizeOfMaterialTotals(
      ofLines.map((line) => ({
        quantityReceived: toNumber(line.quantity_received),
        quantityUsed: toNumber(line.quantity_used),
      })),
    ),
    confirmation,
    canEdit: raw.status === "ABERTO" && canEditCapability,
  };
}

/**
 * Cria o romaneio da OF em /romaneio/novo — já com os itens marcados
 * (esta remessa) e a data de saída. A RPC garante UM romaneio em
 * aberto por OF.
 */
export async function createRomaneio(
  client: SupabaseServer,
  orderId: string,
  shipmentDate: string | null,
  items: { orderItemId: string; quantity: number }[],
): Promise<{ id: string; number: number }> {
  return saveRomaneioRpc(client, {
    romaneioId: null,
    orderId,
    shipmentDate,
    carrier: null,
    vehicle: null,
    notes: null,
    items: items.filter((item) => item.quantity > 0),
    materials: [],
  });
}

/** Salva cabeçalho+itens+materiais de um romaneio em ABERTO. */
export async function saveRomaneio(
  client: SupabaseServer,
  input: RomaneioValues,
): Promise<{ id: string; number: number }> {
  const items = input.items
    .filter((item) => item.quantity > 0)
    .map((item) => ({ orderItemId: item.orderItemId, quantity: item.quantity }));

  return saveRomaneioRpc(client, {
    romaneioId: input.id ?? null,
    orderId: input.orderId,
    shipmentDate: input.shipmentDate ?? null,
    carrier: input.carrier ?? null,
    vehicle: input.vehicle ?? null,
    notes: input.notes ?? null,
    items,
    materials: input.materials,
  });
}

/**
 * Salva a ficha de conferência como formulário (048): marcação por
 * item, recebida/utilizada dos materiais e observação. `sign` conclui
 * a conferência (ABERTO → CONFERIDO) — no banco, tudo numa transação.
 */
export async function saveRomaneioConference(
  client: SupabaseServer,
  input: RomaneioConferenceValues,
): Promise<void> {
  await saveRomaneioConferenceRpc(client, {
    romaneioId: input.romaneioId,
    notes: input.notes,
    checkedItemIds: input.checkedItemIds,
    materials: input.materials.map((material) => ({
      description: material.description,
      unit: material.unit,
      quantityPlanned: material.quantityPlanned,
      quantityReceived: material.quantityReceived,
      quantityUsed: material.quantityUsed,
    })),
    sign: input.sign,
  });
}

/**
 * Confirma o romaneio (CONFERIDO → CONFIRMADO): os gates são validados
 * NO BANCO (RPC 045) — mensagem amigável sobe como exceção e o action
 * converte em toast. É a confirmação que baixa os itens na pendência
 * da OF (derivação por leitura — cancelar depois restaura sozinho).
 */
export async function confirmRomaneio(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  await confirmRomaneioRpc(client, romaneioId);
}

/** Exclusão DEFINITIVA — só permitida em romaneios em ABERTO (045/046). */
export async function deleteRomaneio(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  await deleteRomaneioRpc(client, romaneioId);
}

/**
 * Cancela o romaneio (CONFERIDO/CONFIRMADO) — a baixa derivada se
 * restaura sozinha porque o romaneio sai do Σ de CONFIRMADOS.
 */
export async function cancelRomaneio(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  await cancelRomaneioRpc(client, romaneioId);
}

/**
 * Registra os números de NF (saída/devolução) — o sistema auxilia, a
 * emissão é no emissor externo. A NF de devolução exige a NF de saída
 * e todas as linhas de material com recebida/utilizada informadas.
 */
export async function saveRomaneioNfNumbers(
  client: SupabaseServer,
  romaneioId: string,
  values: RomaneioNfValues,
): Promise<void> {
  const raw = await getRomaneioById(client, romaneioId);
  if (!raw) {
    throw new Error("Romaneio não encontrado.");
  }
  if (raw.status === "CANCELADO") {
    throw new Error("Romaneio cancelado não permite editar os números de NF.");
  }
  if (values.returnNfNumber) {
    if (!values.nfNumber) {
      throw new Error("Registre a NF de saída antes da NF de devolução.");
    }
    const pendingLines = (raw.romaneio_materials ?? []).filter(
      (line) => line.quantity_received === null || line.quantity_used === null,
    );
    if (pendingLines.length > 0) {
      throw new Error(
        "Informe a quantidade recebida e utilizada em todas as linhas de material antes de registrar a NF de devolução.",
      );
    }
  }

  await updateRomaneioNfNumbers(client, romaneioId, values.nfNumber, values.returnNfNumber);
}
