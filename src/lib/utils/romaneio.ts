/**
 * Regras puras do romaneio de expedição:
 *
 *  - alocação PROPORCIONAL das matérias-primas da OF a cada carga
 *    parcial (ratio = qtd neste romaneio ÷ qtd total do item raiz;
 *    os materiais do raiz e de todos os seus descendentes entram × ratio);
 *  - merge das linhas alocadas com o que já foi informado (por
 *    descrição+unidade) — o previsto é sempre o alocado atual, os
 *    valores informados vêm do gravado;
 *  - derivação do SALDO de devolução (recebida − utilizada).
 *
 * Sem dependências de servidor — as funções são testáveis direto.
 */

import type { OrderStatus } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";
import type { RomaneioStatus } from "@/lib/constants/romaneio";

/** Material de um item da OF (order_item_materials). */
export interface RomaneioMaterialSource {
  description: string;
  unit: string;
  quantity: number;
}

/** Item da OF (raiz ou filho) com seus materiais. */
export interface RomaneioOrderItemSource {
  orderItemId: string;
  /** null = item de nível raiz. */
  parentItemId: string | null;
  quantity: number;
  materials: readonly RomaneioMaterialSource[];
}

export interface RomaneioAllocationInput {
  /** Itens incluídos no romaneio: id do item RAIZ + quantidade alocada. */
  includedItems: readonly { orderItemId: string; quantity: number }[];
  /** TODOS os itens da OF (raiz e filhos) com seus materiais. */
  orderItems: readonly RomaneioOrderItemSource[];
}

export interface AllocatedMaterialLine {
  description: string;
  unit: string;
  quantityPlanned: number;
}

export interface StoredMaterialLine {
  description: string;
  unit: string;
  quantityPlanned: number;
  quantityReceived: number | null;
  quantityUsed: number | null;
}

/** Linha de material exibida (editável em simulação, somente leitura depois). */
export interface RomaneioMaterialLineView {
  description: string;
  unit: string;
  quantityPlanned: number;
  quantityReceived: number | null;
  quantityUsed: number | null;
  quantityReturned: number | null;
}

/** Chave de material: descrição+unidade, sem caixa/espaços (mesma chave do merge). */
export function materialKey(description: string, unit: string): string {
  return `${description.trim().toUpperCase()}::${unit.trim().toUpperCase()}`;
}

/**
 * Resolve o ancestral RAIZ de um item subindo a cadeia
 * `parent_order_item_id`. O laço com `visited` protege contra
 * ciclos acidentais na cadeia (dado corrompido não trava a tela).
 */
function resolveRoot(
  itemId: string,
  parentByItem: ReadonlyMap<string, string | null>,
): string {
  let current = itemId;
  const visited = new Set<string>();
  while (parentByItem.get(current) != null && !visited.has(current)) {
    visited.add(current);
    const parent = parentByItem.get(current);
    if (parent == null) break;
    current = parent;
  }
  return current;
}

/**
 * Aloca as matérias-primas da OF às cargas parciais do romaneio.
 *
 * Para cada item RAIZ incluído, o ratio é `quantidade no romaneio ÷
 * quantidade total do item`; os materiais do próprio raiz e de todos
 * os seus filhos entram multiplicados pelo ratio, somando por
 * descrição+unidade. Itens fora do romaneio (ou com ratio 0) não
 * contribuem.
 */
export function allocateRomaneioMaterials(
  input: RomaneioAllocationInput,
): AllocatedMaterialLine[] {
  const parentByItem = new Map<string, string | null>();
  const quantityByItem = new Map<string, number>();
  for (const item of input.orderItems) {
    parentByItem.set(item.orderItemId, item.parentItemId);
    quantityByItem.set(item.orderItemId, item.quantity);
  }

  // Ratio por item RAIZ incluído (0 a 1 — acima de 1 é dado inválido).
  const ratioByRoot = new Map<string, number>();
  for (const included of input.includedItems) {
    const total = quantityByItem.get(included.orderItemId) ?? 0;
    if (total <= 0 || included.quantity <= 0) continue;
    const ratio = Math.min(included.quantity / total, 1);
    ratioByRoot.set(included.orderItemId, ratio);
  }
  if (ratioByRoot.size === 0) return [];

  const totals = new Map<string, AllocatedMaterialLine>();
  for (const item of input.orderItems) {
    if (item.materials.length === 0) continue;
    const root = resolveRoot(item.orderItemId, parentByItem);
    const ratio = ratioByRoot.get(root) ?? 0;
    if (ratio === 0) continue;

    for (const material of item.materials) {
      if (material.quantity <= 0) continue;
      const key = materialKey(material.description, material.unit);
      const current = totals.get(key);
      if (current) {
        current.quantityPlanned += material.quantity * ratio;
      } else {
        totals.set(key, {
          description: material.description.trim(),
          unit: material.unit.trim().toUpperCase(),
          quantityPlanned: material.quantity * ratio,
        });
      }
    }
  }

  return [...totals.values()].sort(
    (left, right) =>
      left.description.localeCompare(right.description) || left.unit.localeCompare(right.unit),
  );
}

/**
 * Saldo de devolução de uma linha: recebida − utilizada. Null quando
 * falta alguma das duas informações (ainda não informado).
 */
export function materialReturnQuantity(
  received: number | null,
  used: number | null,
): number | null {
  if (received === null || used === null) return null;
  return received - used;
}

/**
 * Merge das linhas alocadas (previsto fresco) com as gravadas (valores
 * informados) — chave descrição+unidade. Linhas gravadas que deixaram de
 * existir na alocação (item removido da carga) são MANTIDAS para não
 * perder o que o usuário já informou.
 */
export function mergeRomaneioMaterialLines(
  allocated: readonly AllocatedMaterialLine[],
  stored: readonly StoredMaterialLine[],
): RomaneioMaterialLineView[] {
  const storedByKey = new Map<string, StoredMaterialLine>();
  for (const line of stored) {
    storedByKey.set(materialKey(line.description, line.unit), line);
  }

  const merged = new Map<string, RomaneioMaterialLineView>();

  for (const line of allocated) {
    const key = materialKey(line.description, line.unit);
    const saved = storedByKey.get(key);
    merged.set(key, {
      description: line.description,
      unit: line.unit,
      quantityPlanned: line.quantityPlanned,
      quantityReceived: saved ? saved.quantityReceived : line.quantityPlanned,
      quantityUsed: saved ? saved.quantityUsed : line.quantityPlanned,
      quantityReturned: saved
        ? materialReturnQuantity(saved.quantityReceived, saved.quantityUsed)
        : materialReturnQuantity(line.quantityPlanned, line.quantityPlanned),
    });
  }

  // Linhas gravadas sem alocação correspondente: mantém como estavam.
  for (const [key, line] of storedByKey) {
    if (merged.has(key)) continue;
    merged.set(key, {
      description: line.description,
      unit: line.unit,
      quantityPlanned: line.quantityPlanned,
      quantityReceived: line.quantityReceived,
      quantityUsed: line.quantityUsed,
      quantityReturned: materialReturnQuantity(line.quantityReceived, line.quantityUsed),
    });
  }

  return [...merged.values()].sort(
    (left, right) =>
      left.description.localeCompare(right.description) || left.unit.localeCompare(right.unit),
  );
}

/** Converte linhas gravadas (banco) em linhas de exibição sem merge. */
export function storedMaterialLines(
  stored: readonly StoredMaterialLine[],
): RomaneioMaterialLineView[] {
  return stored
    .map((line) => ({
      description: line.description,
      unit: line.unit,
      quantityPlanned: line.quantityPlanned,
      quantityReceived: line.quantityReceived,
      quantityUsed: line.quantityUsed,
      quantityReturned: materialReturnQuantity(line.quantityReceived, line.quantityUsed),
    }))
    .sort(
      (left, right) =>
        left.description.localeCompare(right.description) || left.unit.localeCompare(right.unit),
    );
}

/** Σ dos materiais da OF inteira (todos os romaneios não cancelados). */
export function summarizeOfMaterialTotals(
  lines: readonly { quantityReceived: number | null; quantityUsed: number | null }[],
): { received: number; used: number; returned: number } {
  let received = 0;
  let used = 0;
  let returned = 0;
  for (const line of lines) {
    if (line.quantityReceived !== null) received += line.quantityReceived;
    if (line.quantityUsed !== null) used += line.quantityUsed;
    const balance = materialReturnQuantity(line.quantityReceived, line.quantityUsed);
    if (balance !== null) returned += balance;
  }
  return { received, used, returned };
}

/** Item raiz avaliado nos gates de emissão. */
export interface RomaneioEmissionItem {
  /** Quantidade total do item na OF. */
  itemQuantity: number;
  /** Quantidade já expedida em OUTROS romaneios EMITIDOS da OF. */
  shippedQuantity: number;
  /** Quantidade incluída NESTE romaneio (0 = fora da carga). */
  quantity: number;
  /** Situação do processo EXP do item (null = sem linha de EXP). */
  expStatus: ProcessStatus | null;
}

export interface RomaneioEmissionInput {
  status: RomaneioStatus;
  orderStatus: OrderStatus;
  conferenceAccepted: boolean;
  /** TODOS os itens raiz da OF — quantity = incluído neste romaneio (0 = fora). */
  items: readonly RomaneioEmissionItem[];
}

export interface RomaneioEmissionResult {
  canEmit: boolean;
  /** Motivos que impedem a emissão (mensagens prontas para exibir). */
  blockers: string[];
}

/**
 * Gates de emissão do romaneio (espelham a RPC `emit_romaneio`, 042) —
 * usados na tela para exibir o checklist e no serviço para a mensagem
 * amigável antes de chamar o banco:
 *
 *  1) romaneio em SIMULAÇÃO;
 *  2) OF não cancelada;
 *  3) aceite de conferência sinalizado;
 *  4) ao menos um item incluído;
 *  5) EXP de todos os itens raiz aplicáveis = CONCLUIDO;
 *  6) Σ (este + já emitidos) ≤ quantidade do item (expedição parcial).
 */
export function checkRomaneioEmission(
  input: RomaneioEmissionInput,
): RomaneioEmissionResult {
  const blockers: string[] = [];

  if (input.status === "EMITIDO") blockers.push("Romaneio já emitido.");
  if (input.status === "CANCELADO") blockers.push("Romaneio cancelado.");
  if (input.orderStatus === "CANCELADO") blockers.push("A OF está cancelada.");
  if (!input.conferenceAccepted) {
    blockers.push("Sinalize o aceite da conferência antes de emitir.");
  }

  const included = input.items.filter((item) => item.quantity > 0);
  if (included.length === 0) {
    blockers.push("Inclua ao menos um item no romaneio.");
    return { canEmit: false, blockers };
  }

  // Gate de produção: EXP aplicável CONCLUIDO em TODOS os itens raiz da OF
  // (não só nos incluídos — a OF precisa estar pronta para sair).
  const pendingExp = input.items.filter(
    (item) => item.expStatus !== null && item.expStatus !== "CONCLUIDO",
  ).length;
  if (pendingExp > 0) {
    blockers.push(
      pendingExp === 1
        ? "1 item raiz com EXPEDIÇÃO pendente."
        : `${pendingExp} itens raiz com EXPEDIÇÃO pendente.`,
    );
  }

  const overLimit = included.filter(
    (item) => item.shippedQuantity + item.quantity > item.itemQuantity,
  ).length;
  if (overLimit > 0) {
    blockers.push(
      overLimit === 1
        ? "1 item acima da pendência de expedição."
        : `${overLimit} itens acima da pendência de expedição.`,
    );
  }

  return { canEmit: blockers.length === 0, blockers };
}
