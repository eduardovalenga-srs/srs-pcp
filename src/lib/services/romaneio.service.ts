import "server-only";

import type { SupabaseServer } from "@/lib/supabase/types";
import type {
  RomaneioCandidateFilters,
  RomaneioCandidatesPage,
  RomaneioFilters,
  RomaneioOrderItem,
  RomaneioSummary,
  RomaneiosPage,
  RomaneioView,
} from "@/lib/types/romaneio";
import type { RomaneioNfValues, RomaneioValues } from "@/lib/validators/romaneio.schema";
import {
  cancelRomaneioRpc,
  countRomaneiosByStatus,
  emitRomaneioRpc,
  getRomaneioById,
  listEmittedQuantityByItem,
  listOrderMaterialLines,
  listRomaneioCandidates,
  listRomaneios,
  saveRomaneioRpc,
  signRomaneioConferenceRpc,
  updateRomaneioNfNumbers,
} from "@/lib/repositories/romaneio.repository";
import { toNumber } from "@/lib/utils/formatting";
import { EXPORT_PAGE_SIZE, collectAllPages } from "@/lib/utils/collect-pages";
import {
  allocateRomaneioMaterials,
  checkRomaneioEmission,
  mergeRomaneioMaterialLines,
  storedMaterialLines,
  summarizeOfMaterialTotals,
  type RomaneioOrderItemSource,
  type StoredMaterialLine,
} from "@/lib/utils/romaneio";

/** Lista paginada de romaneios + cartões de resumo por situação. */
export async function getRomaneiosPage(
  client: SupabaseServer,
  filters: RomaneioFilters,
): Promise<RomaneiosPage> {
  const [page, simulationCount, emittedCount] = await Promise.all([
    listRomaneios(client, filters),
    countRomaneiosByStatus(client, filters, "SIMULACAO"),
    countRomaneiosByStatus(client, filters, "EMITIDO"),
  ]);

  return {
    romaneios: page.rows,
    total: page.total,
    simulationCount,
    emittedCount,
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

/** Seletor de OFs candidatas em /romaneio/novo. */
export async function getRomaneioOrderCandidates(
  client: SupabaseServer,
  filters: RomaneioCandidateFilters,
): Promise<RomaneioCandidatesPage> {
  return listRomaneioCandidates(client, filters);
}

/**
 * Visão completa do romaneio para a tela de detalhe: cabeçalho, itens
 * raiz da OF com o estado de expedição (EXP + já emitido + pendência),
 * linhas de material (previsto alocado × informado) e os gates de
 * emissão.
 */
export async function getRomaneioView(
  client: SupabaseServer,
  romaneioId: string,
  canEditCapability: boolean,
): Promise<RomaneioView | null> {
  const raw = await getRomaneioById(client, romaneioId);
  if (!raw) return null;

  const orderId = raw.orders.id;
  const [emittedByItem, ofLines] = await Promise.all([
    listEmittedQuantityByItem(client, orderId, romaneioId),
    listOrderMaterialLines(client, orderId),
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
  for (const item of raw.romaneio_items ?? []) {
    includedByItem.set(item.order_item_id, toNumber(item.quantity) ?? 0);
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
        shippedQuantity: emittedByItem.get(item.id) ?? 0,
        expStatus: exp ? exp.status : null,
        quantity: includedByItem.get(item.id) ?? 0,
      };
    });

  // Em SIMULAÇÃO as linhas de material nascem da alocação desta carga
  // (merge com o já informado); emitido/cancelado mostra o registro gravado.
  const allocated =
    raw.status === "SIMULACAO"
      ? allocateRomaneioMaterials({
          includedItems: [...includedByItem].map(([orderItemId, quantity]) => ({
            orderItemId,
            quantity,
          })),
          orderItems: orderStructure,
        })
      : [];

  const materials =
    raw.status === "SIMULACAO"
      ? mergeRomaneioMaterialLines(allocated, storedMaterials)
      : storedMaterialLines(storedMaterials);

  const emission = checkRomaneioEmission({
    status: raw.status,
    orderStatus: raw.orders.status,
    conferenceAccepted: raw.conference_accepted_at !== null,
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
    materials,
    ofMaterialTotals: summarizeOfMaterialTotals(
      ofLines.map((line) => ({
        quantityReceived: toNumber(line.quantity_received),
        quantityUsed: toNumber(line.quantity_used),
      })),
    ),
    emission,
    canEdit: raw.status === "SIMULACAO" && canEditCapability,
  };
}

/**
 * Cria uma simulação vazia para a OF (o editor de itens da tela
 * detalhe preenche o restante). A RPC garante UMA simulação por OF.
 */
export async function createRomaneio(
  client: SupabaseServer,
  orderId: string,
): Promise<{ id: string; number: number }> {
  return saveRomaneioRpc(client, {
    romaneioId: null,
    orderId,
    shipmentDate: null,
    carrier: null,
    vehicle: null,
    notes: null,
    items: [],
    materials: [],
  });
}

/** Salva cabeçalho+itens+materiais de um romaneio em SIMULAÇÃO. */
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

/** Sinaliza o aceite da conferência (quem/quando/observação). */
export async function signRomaneioConference(
  client: SupabaseServer,
  romaneioId: string,
  notes: string | null,
): Promise<void> {
  await signRomaneioConferenceRpc(client, romaneioId, notes);
}

/**
 * Emite o romaneio: os gates são validados NO BANCO (RPC 042) — mensagem
 * amigável sobe como exceção e o action converte em toast.
 */
export async function emitRomaneio(
  client: SupabaseServer,
  romaneioId: string,
): Promise<void> {
  await emitRomaneioRpc(client, romaneioId);
}

/** Cancela o romaneio (bloqueado quando já há NF de saída registrada). */
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
