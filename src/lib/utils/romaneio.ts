/**
 * Regras puras do romaneio de expedição:
 *
 *  - alocação PROPORCIONAL das matérias-primas da OF a cada carga
 *    parcial (ratio = qtd neste romaneio ÷ qtd total do item raiz;
 *    os materiais do raiz e de todos os seus descendentes entram × ratio);
 *  - merge das linhas alocadas com as gravadas (por descrição+unidade)
 *    — em ABERTO o PREVISTO e a UTILIZADA são sempre o alocado atual
 *    (mudam junto com os itens da carga) e a RECEBIDA vem do gravado,
 *    nunca abaixo da utilizada;
 *  - derivação do SALDO de devolução (recebida − utilizada);
 *  - PESO DA CARGA = Σ da utilizada nas linhas em unidade de peso
 *    (KG/G), com o peso dos itens só como fallback.
 *
 * Sem dependências de servidor — as funções são testáveis direto.
 */

import type { OrderStatus } from "@/lib/constants/orders";
import type { ProcessStatus } from "@/lib/constants/production";
import type { RomaneioStatus } from "@/lib/constants/romaneio";
import { parseQuantity } from "@/lib/utils/formatting";

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

/** Linha de material exibida (somente leitura no detalhe — o lançamento é na ficha). */
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
 * Travessia comum da alocação: para cada material alocado chama
 * `visit(raiz, material, quantidade escalada pela razão)`. Itens fora
 * do romaneio (razão 0) e materiais sem quantidade não entram.
 */
function forEachAllocatedMaterial(
  input: RomaneioAllocationInput,
  visit: (rootId: string, material: RomaneioMaterialSource, quantity: number) => void,
): void {
  const parentByItem = new Map<string, string | null>();
  const quantityByItem = new Map<string, number>();
  for (const item of input.orderItems) {
    parentByItem.set(item.orderItemId, item.parentItemId);
    quantityByItem.set(item.orderItemId, item.quantity);
  }

  // Razão por item RAIZ incluído (0 a 1 — acima de 1 é dado inválido).
  const ratioByRoot = new Map<string, number>();
  for (const included of input.includedItems) {
    const total = quantityByItem.get(included.orderItemId) ?? 0;
    if (total <= 0 || included.quantity <= 0) continue;
    const ratio = Math.min(included.quantity / total, 1);
    ratioByRoot.set(included.orderItemId, ratio);
  }
  if (ratioByRoot.size === 0) return;

  for (const item of input.orderItems) {
    if (item.materials.length === 0) continue;
    const root = resolveRoot(item.orderItemId, parentByItem);
    const ratio = ratioByRoot.get(root) ?? 0;
    if (ratio === 0) continue;

    for (const material of item.materials) {
      if (material.quantity <= 0) continue;
      visit(root, material, material.quantity * ratio);
    }
  }
}

/**
 * Peso (kg) de uma QUANTIDADE de material: só as unidades de PESO
 * contam — KG vale o próprio valor e G divide por 1000. Qualquer
 * outra unidade (M, UN, CX…) devolve null e fica fora do peso.
 * Quantidade null conta como 0 (a linha é de peso, só sem valor).
 *
 * Exportado para a tabela de devolução do detalhe e para a exportação
 * do documento exibirem o PESO INDIVIDUAL de cada matéria-prima com a
 * MESMA regra do peso total da carga.
 */
export function weightKgOf(unit: string, quantity: number | null): number | null {
  const normalized = unit.trim().toUpperCase();
  if (normalized === "KG") return quantity ?? 0;
  if (normalized === "G") return (quantity ?? 0) / 1000;
  return null;
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
  const totals = new Map<string, AllocatedMaterialLine>();
  forEachAllocatedMaterial(input, (_root, material, quantity) => {
    const key = materialKey(material.description, material.unit);
    const current = totals.get(key);
    if (current) {
      current.quantityPlanned += quantity;
    } else {
      totals.set(key, {
        description: material.description.trim(),
        unit: material.unit.trim().toUpperCase(),
        quantityPlanned: quantity,
      });
    }
  });

  return [...totals.values()].sort(
    (left, right) =>
      left.description.localeCompare(right.description) || left.unit.localeCompare(right.unit),
  );
}

/**
 * Peso (kg) alocado a CADA item RAIZ da carga: soma dos materiais em
 * unidade de peso (KG/G) da subárvore do item × razão. Só entram itens
 * com alocação — quem não aparece no mapa não tem peso de material
 * (célula "—" na tabela de itens).
 */
export function allocateRomaneioItemWeightsKg(
  input: RomaneioAllocationInput,
): Map<string, number> {
  const totals = new Map<string, number>();
  forEachAllocatedMaterial(input, (root, material, quantity) => {
    const kg = weightKgOf(material.unit, quantity);
    if (kg === null) return;
    totals.set(root, (totals.get(root) ?? 0) + kg);
  });
  return totals;
}

/**
 * Σ da coluna "Utilizada na produção" só nas linhas em unidade de
 * PESO (KG/G) — é o PESO DA CARGA. Devolve null quando a carga não
 * tem nenhum material em unidade de peso (o chamador cai no peso dos
 * itens).
 */
export function sumUsedWeightKg(
  lines: readonly { unit: string; quantityUsed: number | null }[],
): number | null {
  let total = 0;
  let found = false;
  for (const line of lines) {
    const kg = weightKgOf(line.unit, line.quantityUsed);
    if (kg === null) continue;
    found = true;
    total += kg;
  }
  return found ? total : null;
}

/**
 * Peso total da carga (kg): a fonte é a UTILIZADA em unidades de
 * peso; sem nenhuma linha em KG/G, cai no peso dos itens (qtd × peso
 * unitário) e, sem nada, devolve null ("—").
 */
export function loadWeightKg(
  lines: readonly { unit: string; quantityUsed: number | null }[],
  items: readonly { unitWeightKg: number | null; quantity: number }[],
): number | null {
  const fromMaterials = sumUsedWeightKg(lines);
  if (fromMaterials !== null) return fromMaterials;
  if (!items.some((item) => item.unitWeightKg !== null)) return null;
  return items.reduce(
    (sum, item) => sum + (item.unitWeightKg === null ? 0 : item.unitWeightKg * item.quantity),
    0,
  );
}

export interface RomaneioWeightsResolution {
  /** Peso total da carga (kg) — null = nenhuma fonte de peso. */
  totalKg: number | null;
  /** Peso exibido por item RAIZ — null = célula "—". */
  byItem: Map<string, number | null>;
}

/**
 * Resolve os PESOS de uma carga a partir de UMA fonte só:
 *
 *  - total = Σ da "Utilizada" em unidades de peso (fallback: itens);
 *  - por item = peso alocado dos materiais em KG da subárvore do item
 *    (a MESMA alocação do previsto); sem material em peso na carga,
 *    volta ao qtd × peso unitário; item sem peso nenhum fica null.
 *
 * Servidor (`getRomaneioView`) e cliente (preview do detalhe) usam a
 * mesma função — o detalhe refaz com as quantidades digitadas, então
 * cabeçalho, tabelas, ficha e exportação fecham no mesmo número.
 */
export function resolveRomaneioWeights(input: {
  materials: readonly { unit: string; quantityUsed: number | null }[];
  items: readonly { orderItemId: string; unitWeightKg: number | null; quantity: number }[];
  allocation: RomaneioAllocationInput;
}): RomaneioWeightsResolution {
  const materialRegime = sumUsedWeightKg(input.materials) !== null;
  const allocated = materialRegime
    ? allocateRomaneioItemWeightsKg(input.allocation)
    : new Map<string, number>();

  const byItem = new Map<string, number | null>();
  for (const item of input.items) {
    if (item.quantity <= 0) {
      // Fora da carga: 0 (ou "—" quando o item nem tem peso unitário).
      byItem.set(item.orderItemId, item.unitWeightKg === null ? null : 0);
    } else if (materialRegime) {
      byItem.set(item.orderItemId, allocated.get(item.orderItemId) ?? null);
    } else {
      byItem.set(
        item.orderItemId,
        item.unitWeightKg === null ? null : item.unitWeightKg * item.quantity,
      );
    }
  }

  return { totalKg: loadWeightKg(input.materials, input.items), byItem };
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
 * Merge das linhas alocadas (previsto fresco) com as gravadas — chave
 * descrição+unidade. Em ABERTO as três colunas acompanham a carga:
 *
 *  - PREVISTO = alocado atual (sempre foi assim);
 *  - UTILIZADA = alocado atual também — é o que a produção consumiu
 *    para ESTES itens, então muda junto quando entra/sai item da carga;
 *  - RECEBIDA = a gravada, nunca abaixo da utilizada (nasce igual a
 *    ela quando ainda não informada) — o que o usuário vê é o que o
 *    Salvar grava, e o saldo a devolver nunca fica negativo.
 *
 * Linhas gravadas que deixaram de existir na alocação (item removido
 * da carga) são MANTIDAS para não perder a recebida: previsto e
 * utilizada zeram e a recebida vira tudo a devolver.
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
    const used = line.quantityPlanned;
    const received = Math.max(saved?.quantityReceived ?? used, used);
    merged.set(key, {
      description: line.description,
      unit: line.unit,
      quantityPlanned: line.quantityPlanned,
      quantityReceived: received,
      quantityUsed: used,
      quantityReturned: materialReturnQuantity(received, used),
    });
  }

  // Linhas gravadas sem alocação correspondente: mantém a recebida e
  // zera o que passou a não pertencer mais a esta carga.
  for (const [key, line] of storedByKey) {
    if (merged.has(key)) continue;
    merged.set(key, {
      description: line.description,
      unit: line.unit,
      quantityPlanned: 0,
      quantityReceived: line.quantityReceived,
      quantityUsed: 0,
      quantityReturned: materialReturnQuantity(line.quantityReceived, 0),
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

/** Insumos do preview dos materiais de UM romaneio (detalhe em ABERTO). */
export interface RomaneioMaterialsPreviewInput {
  status: RomaneioStatus;
  /** Estrutura completa da OF — `view.allocationItems`. */
  allocationItems: readonly RomaneioOrderItemSource[];
  /** Linhas gravadas DESTA carga — `view.storedMaterials`. */
  storedMaterials: readonly StoredMaterialLine[];
  /** Quantidades digitadas na tabela de itens (orderItemId → texto). */
  quantities: Readonly<Record<string, string>>;
}

/**
 * Preview dos materiais de um romaneio no CLIENTE — espelho EXATO do
 * que `getRomaneioView` calcula no servidor, só que com as
 * quantidades digitadas locais (auto-reload do detalhe): em ABERTO
 * aloca ao vivo e faz o merge com o gravado; fora de ABERTO o
 * registro congela. Texto vazio/inválido = item fora da carga (0),
 * com o MESMO parser do salvamento — o que se vê é o que será gravado.
 */
export function previewRomaneioMaterials(
  input: RomaneioMaterialsPreviewInput,
): RomaneioMaterialLineView[] {
  if (input.status !== "ABERTO") return storedMaterialLines(input.storedMaterials);

  const includedItems = Object.entries(input.quantities).map(([orderItemId, text]) => ({
    orderItemId,
    quantity: parseQuantity(text) ?? 0,
  }));

  return mergeRomaneioMaterialLines(
    allocateRomaneioMaterials({ includedItems, orderItems: input.allocationItems }),
    input.storedMaterials,
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

/** Item raiz avaliado nos gates de confirmação. */
export interface RomaneioConfirmationItem {
  /** Quantidade total do item na OF. */
  itemQuantity: number;
  /** Quantidade já expedida em OUTROS romaneios CONFIRMADOS da OF. */
  shippedQuantity: number;
  /** Quantidade incluída NESTE romaneio (0 = fora da carga). */
  quantity: number;
  /** Situação do processo EXP do item (null = sem linha de EXP). */
  expStatus: ProcessStatus | null;
}

export interface RomaneioConfirmationInput {
  status: RomaneioStatus;
  orderStatus: OrderStatus;
  /** Nota de industrialização registrada (requisito do CONFIRMADO = NF + baixa). */
  hasNfNumber: boolean;
  /** TODOS os itens raiz da OF — quantity = incluído neste romaneio (0 = fora). */
  items: readonly RomaneioConfirmationItem[];
}

export interface RomaneioConfirmationGateResult {
  canConfirm: boolean;
  /** Motivos que impedem a confirmação (mensagens prontas para exibir). */
  blockers: string[];
}

/**
 * Gates de confirmação do romaneio (espelham a RPC `confirm_romaneio`,
 * 045) — usados na tela para exibir o checklist e no serviço para a
 * mensagem amigável antes de chamar o banco:
 *
 *  1) romaneio em CONFERIDO (conferência aceita);
 *  2) OF não cancelada;
 *  3) nota de industrialização registrada;
 *  4) ao menos um item incluído;
 *  5) EXP de todos os itens raiz aplicáveis = CONCLUIDO;
 *  6) Σ (este + já confirmados) ≤ quantidade do item (expedição parcial).
 */
export function checkRomaneioConfirmation(
  input: RomaneioConfirmationInput,
): RomaneioConfirmationGateResult {
  const blockers: string[] = [];

  if (input.status === "CONFIRMADO") blockers.push("Romaneio já confirmado.");
  if (input.status === "CANCELADO") blockers.push("Romaneio cancelado.");
  if (input.status === "ABERTO") {
    blockers.push("Conclua a conferência (aceite) antes de confirmar.");
  }
  if (input.orderStatus === "CANCELADO") blockers.push("A OF está cancelada.");
  if (!input.hasNfNumber) blockers.push("Registre o número da nota de industrialização.");

  const included = input.items.filter((item) => item.quantity > 0);
  if (included.length === 0) {
    blockers.push("Inclua ao menos um item no romaneio.");
    return { canConfirm: false, blockers };
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

  return { canConfirm: blockers.length === 0, blockers };
}
