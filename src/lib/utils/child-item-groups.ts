import type { ProcessStatus } from "@/lib/constants/production";
import { KIT_PROCESS_CODE } from "@/lib/constants/processes";
import type {
  ChildItemGroup,
  ChildItemGroupMember,
  ChildItemProcess,
  OrderItemMaterial,
} from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import { calculateTotalWeight } from "@/lib/utils/formatting";
import { computeProcessSchedule, scheduleProcessesForItem, type ProcessWindow } from "@/lib/utils/process-schedule";
import { isProcessStartOverdue } from "@/lib/utils/production";

/**
 * Situação agregada de um processo entre os itens de um grupo (033):
 * CONCLUIDO só quando todos os APLICÁVEIS concluíram; NAO_APLICAVEL só
 * quando nenhum se aplica; no meio do caminho, NAO_INICIADO (o progresso
 * aparece pela soma das quantidades na célula).
 */
export function aggregateGroupStatus(statuses: readonly ProcessStatus[]): ProcessStatus {
  const applicable = statuses.filter((status) => status !== "NAO_APLICAVEL");
  if (applicable.length === 0) return "NAO_APLICAVEL";
  if (applicable.every((status) => status === "CONCLUIDO")) return "CONCLUIDO";
  return "NAO_INICIADO";
}

/** Σ de valores opcionais: null somente quando TODOS são null. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  if (!values.some((value) => value !== null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/**
 * Processos do grupo, por código: situação agregada + Σ das quantidades
 * (só dos membros APLICÁVEIS — um item sem o processo não infla o total).
 * O `id` é o do primeiro membro aplicável (só compatibilidade do tipo; a
 * edição em lote usa os `memberIds` da linha).
 */
export function aggregateGroupProcesses(members: readonly ChildItemGroupMember[]): ChildItemProcess[] {
  const byCode = new Map<string, ChildItemProcess[]>();
  for (const member of members) {
    for (const process of member.processes) {
      const rows = byCode.get(process.code) ?? [];
      rows.push(process);
      byCode.set(process.code, rows);
    }
  }

  return [...byCode.values()]
    .map((rows) => {
      const applicable = rows.filter((row) => row.status !== "NAO_APLICAVEL");
      const base = applicable[0] ?? rows[0];
      if (!base) return null;
      return {
        id: base.id,
        code: base.code,
        name: base.name,
        displayOrder: base.displayOrder,
        status: aggregateGroupStatus(rows.map((row) => row.status)),
        quantityPlanned: sumOrNull(applicable.map((row) => row.quantityPlanned)),
        quantityCompleted: sumOrNull(applicable.map((row) => row.quantityCompleted)),
        notes: applicable.find((row) => row.notes !== null)?.notes ?? null,
      };
    })
    .filter((process): process is ChildItemProcess => process !== null)
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

/**
 * Materiais do grupo: mesclados por descrição (sem caixa/espaços) + unidade,
 * somando a quantidade; observação do primeiro que trouxer.
 */
export function mergeGroupMaterials(members: readonly ChildItemGroupMember[]): OrderItemMaterial[] {
  const byKey = new Map<string, OrderItemMaterial>();
  for (const member of members) {
    for (const material of member.materials) {
      const key = `${material.description.trim().toLowerCase()}|${material.unit}`;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { ...material });
        continue;
      }
      current.quantity += material.quantity;
      current.notes = current.notes ?? material.notes;
    }
  }
  return [...byKey.values()].sort((left, right) => left.description.localeCompare(right.description));
}

/** Menor (não nulo) entre datas ISO — base das janelas previstas do grupo. */
function minDate(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  if (present.length === 0) return null;
  return present.reduce((min, value) => (value < min ? value : min));
}

/** Maior (não nulo) entre datas ISO — recebimento mais recente da MP. */
function maxDate(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  if (present.length === 0) return null;
  return present.reduce((max, value) => (value > max ? value : max));
}

/**
 * Monta a linha agrupada da Fábrica 1 (033) a partir dos membros já
 * ordenados (pai → descrição → id): quantidades e peso somados, entrega
 * menor, processos/materiais agregados e a coluna MP herdada agregada
 * entre os PAIS distintos do grupo.
 */
export function buildChildItemGroup(input: {
  order: { id: string; code: string; customerName: string | null };
  /** Chave do grupo (código do filho; descrição quando o código vem vazio). */
  key: string;
  /** Código do filho para o badge — null quando veio vazio. */
  childItem: string | null;
  members: readonly ChildItemGroupMember[];
}): ChildItemGroup {
  const { order, key, childItem, members } = input;
  const [first] = members;

  // PAIS distintos do grupo (os membros repetem o mesmo pai): dedupe por
  // código, com reserva por descrição+entrega quando o pai não tem código.
  const parents = new Map<string, ChildItemGroupMember>();
  for (const member of members) {
    const parentId =
      member.parentItem ?? `?${member.parentDescription ?? ""}|${member.parentDeliveryDate ?? ""}`;
    if (!parents.has(parentId)) parents.set(parentId, member);
  }
  const parentList = [...parents.values()];

  // Situação dos processos dos PAIS, agregada entre eles (mesma regra).
  const parentStatuses = new Map<string, ProcessStatus[]>();
  for (const parent of parentList) {
    for (const [code, status] of Object.entries(parent.parentProcessStatuses)) {
      const statuses = parentStatuses.get(code) ?? [];
      statuses.push(status);
      parentStatuses.set(code, statuses);
    }
  }
  const parentProcessStatuses = Object.fromEntries(
    [...parentStatuses.entries()].map(([code, statuses]) => [code, aggregateGroupStatus(statuses)]),
  );

  const unitWeights = [...new Set(members.map((member) => member.unitWeightKg).filter(
    (value): value is number => value !== null,
  ))];
  const memberWeights = members.map((member) =>
    calculateTotalWeight(member.quantity, member.unitWeightKg),
  );

  return {
    id: `g:${order.id}:${key}`,
    orderId: order.id,
    orderCode: order.code,
    customerName: order.customerName,
    parentItem: first?.parentItem ?? null,
    parentDescription: first?.parentDescription ?? null,
    parentItems: parentList
      .map((parent) => parent.parentItem)
      .filter((value): value is string => value !== null),
    childItem,
    description: first?.description ?? "",
    memberCount: members.length,
    memberIds: members.map((member) => member.id),
    quantity: members.reduce((total, member) => total + member.quantity, 0),
    // Peso unitário só quando todos os membros coincidem; senão "—".
    unitWeightKg: unitWeights.length === 1 ? unitWeights[0] : null,
    weightTotal: memberWeights.some((value) => value !== null)
      ? memberWeights.reduce<number>((total, value) => total + (value ?? 0), 0)
      : null,
    deliveryDate: minDate(members.map((member) => member.deliveryDate)),
    // 036: seq do grupo = MENOR seq dos membros (null = nenhuma linha
    // numerada) — mesma semântica de min() do banco na RPC 036.
    seq: members.reduce<number | null>(
      (min, member) => (member.seq !== null && (min === null || member.seq < min) ? member.seq : min),
      null,
    ),
    processes: aggregateGroupProcesses(members),
    parentProcessStatuses,
    // Recebimento mais recente entre os pais — a célula só exibe quando o
    // status agregado do MP é CONCLUIDO (todos os aplicáveis receberam).
    parentMpCompletedAt: maxDate(parentList.map((parent) => parent.parentMpCompletedAt)),
    parentDeliveryDate: minDate(parentList.map((parent) => parent.parentDeliveryDate)),
    materials: mergeGroupMaterials(members),
  };
}

/** Dados que o cálculo de janela precisa de cada processo do catálogo. */
export type KitCatalogProcess = Pick<ProcessDefinition, "code" | "displayOrder" | "durationDays">;

/**
 * Janela prevista do KIT numa linha agrupada da Fábrica 1 — MESMA receita da
 * célula da tabela (`scheduleByItem` em `components/fabrica1/Fabrica1Table`):
 * dias úteis contados de TRÁS para FRENTE a partir da entrega do grupo, com
 * os status AGREGADOS do grupo (`NAO_APLICAVEL` não ocupa dias nem ganha
 * janela). Devolve null quando não há entrega válida ou o grupo não tem KIT
 * aplicável.
 */
export function kitWindowForGroup(
  item: Pick<ChildItemGroup, "deliveryDate" | "processes">,
  catalog: readonly KitCatalogProcess[],
): ProcessWindow | null {
  const statusByCode = new Map(item.processes.map((process) => [process.code, process.status] as const));
  return (
    computeProcessSchedule(
      item.deliveryDate,
      scheduleProcessesForItem(catalog, (code) => statusByCode.get(code)),
    ).get(KIT_PROCESS_CODE) ?? null
  );
}

/**
 * REGRA DE ATRASO DA FÁBRICA 1 — card "Atrasados" desta tela:
 * o grupo está atrasado quando a data da coluna KIT (o INÍCIO previsto da
 * janela, o mesmo valor exibido/destacado em vermelho na célula) é ANTERIOR
 * à data de referência.
 *
 * Fora da conta:
 *  - KIT `CONCLUIDO` (`isProcessStartOverdue` nunca marca processo concluído —
 *    item finalizado não fica eternamente "atrasado");
 *  - KIT `NAO_APLICAVEL`/ausente no grupo;
 *  - sem janela calculável (grupo sem data de entrega).
 *
 * ATENÇÃO: isto é a regra NOVA do card; a regra global de atraso da gestão
 * (`isItemOverdue` — entrega da OF vencida + EXPEDIÇÃO pendente) continua
 * valendo para as demais telas.
 */
export function isChildItemKitOverdue(
  item: Pick<ChildItemGroup, "deliveryDate" | "processes">,
  catalog: readonly KitCatalogProcess[],
  today: string,
): boolean {
  const kit = item.processes.find((process) => process.code === KIT_PROCESS_CODE);
  if (!kit || kit.status === "NAO_APLICAVEL") return false;

  const window = kitWindowForGroup(item, catalog);
  if (!window) return false;

  return isProcessStartOverdue(window.start, kit.status, today);
}

/** Card "Atrasados" da Fábrica 1: registros (grupos), Σ qtd. e Σ peso (kg). */
export interface KitOverdueTotals {
  records: number;
  qty: number;
  weight: number;
}

/**
 * Totais do card "Atrasados" (regra do KIT) para um CONJUNTO de linhas da Fábrica 1:
 * soma quantidade e peso total dos grupos com o início do KIT vencido.
 * Contagem em GRUPOS (linhas), como o card "Eventos"; grupo sem peso entra
 * como 0 na soma (mesma convenção dos cards da gestão).
 */
export function summarizeKitOverdue(
  items: readonly ChildItemGroup[],
  catalog: readonly KitCatalogProcess[],
  today: string,
): KitOverdueTotals {
  const totals: KitOverdueTotals = { records: 0, qty: 0, weight: 0 };
  for (const item of items) {
    if (!isChildItemKitOverdue(item, catalog, today)) continue;
    totals.records += 1;
    totals.qty += item.quantity;
    totals.weight += item.weightTotal ?? 0;
  }
  return totals;
}
