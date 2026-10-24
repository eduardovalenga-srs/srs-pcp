import { ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import { ROMANEIO_STATUS_LABELS } from "@/lib/constants/romaneio";
import { F1_PROCESS_CODES, FABRICA1_EDITABLE_PROCESS_CODES } from "@/lib/constants/processes";
import { PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS, type ProcessStatus } from "@/lib/constants/production";
import type { ChildItemGroup, OrderSummary } from "@/lib/types/order";
import type { RomaneioSummary, RomaneioView } from "@/lib/types/romaneio";
import type {
  OrderProcessCell,
  ProcessDefinition,
  ProductionOrderRow,
  ProductionRow,
} from "@/lib/types/production";
import { formatDateTime } from "@/lib/utils/dates";
import { formatQuantity } from "@/lib/utils/formatting";
import { fabrica1ProcessColumns } from "@/lib/utils/production";
import { childItemProposalDate, itemProposalDate, orderProposalDate } from "@/lib/utils/proposal-date";

/**
 * Montagem das planilhas de exportação (.xlsx) — uma função por tela,
 * com as colunas EXATAMENTE na ordem e com os rótulos da tabela da tela.
 *
 * Os formatos de célula espelham a UI (símbolo + contador nas etapas,
 * "—" para vazio), mas números e datas saem TIPADOS (não texto) para que
 * o Excel some, filtre e ordene — o formato de exibição (1.234,5 e
 * dd/MM/yyyy) é aplicado depois, na montagem do workbook.
 */

/** Valor de uma célula: texto, número ou data — vazio é "—", como na tela. */
export type ExportCell = string | number | Date | null;

export interface ExportSheet {
  /** Cabeçalho — mesma ordem das colunas da tabela da tela. */
  headers: string[];
  /** Dados (sem o cabeçalho), alinhados às colunas. */
  rows: ExportCell[][];
  /** Índices (0-based) de colunas de data — recebem formato dd/MM/yyyy. */
  dateColumns: number[];
}

/**
 * Data da tela (AAAA-MM-DD) como Date LOCAL de meia-noite: montar com os
 * componentes locais evita o deslocamento de um dia que `new Date(iso)`
 * sofreria no fuso do negócio (UTC-3) ao virar serial do Excel.
 */
function dateCell(value: string | null): ExportCell {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Date(year, month - 1, day);
}

/** Célula de processo AGREGADA da gestão de entregas: "✓ 2/3" ou "—". */
function orderProcessCell(cell: OrderProcessCell | undefined): string {
  if (!cell || cell.applicable === 0) return "—";
  return `${PROCESS_STATUS_SYMBOLS[cell.status]} ${cell.done}/${cell.applicable}`;
}

/** Célula de processo de ITEM (Fábrica 2/Fábrica 1): "✓ 2/3" ou "—". */
function itemProcessCell(
  cell:
    | { status: ProcessStatus; quantityPlanned: number | null; quantityCompleted: number | null }
    | undefined,
): string {
  if (!cell) return "—";
  const symbol = PROCESS_STATUS_SYMBOLS[cell.status];
  if (cell.quantityPlanned === null && cell.quantityCompleted === null) return symbol;
  const counter = `${formatQuantity(cell.quantityCompleted ?? 0)}/${formatQuantity(cell.quantityPlanned ?? 0)}`;
  return `${symbol} ${counter}`;
}

/** Célula herdada do item pai (coluna MP da Fábrica 1): só o símbolo. */
function inheritedProcessCell(status: ProcessStatus | undefined): string {
  return status ? PROCESS_STATUS_SYMBOLS[status] : "—";
}

/** Texto vazio na tela vira "—" na planilha (mesmo marcador). */
function text(value: string | null | undefined): ExportCell {
  return value && value.trim() ? value : "—";
}

/** Quantidade/peso sem valor vira "—" (mesmo marcador da tela). */
function number(value: number | null): ExportCell {
  return value ?? "—";
}

/** Seq. sem número vira "—" (mesmo marcador da tela). */
function seq(value: number | null): ExportCell {
  return value ?? "—";
}

/** Processo tem edição na própria tela da Fábrica 1? (senão é o MP herdado). */
function isFabrica1Editable(code: string): boolean {
  return (FABRICA1_EDITABLE_PROCESS_CODES as readonly string[]).includes(code);
}

/**
 * Gestão de OF (ProductionTable): Seq., OF/OS, Cli., Qtd., Peso, Ent.,
 * DP (data de proposta) e UMA coluna por processo do catálogo ativo
 * (ordem do catálogo).
 */
export function gestaoEntregasSheet(
  rows: readonly ProductionOrderRow[],
  processes: readonly ProcessDefinition[],
  today: string,
): ExportSheet {
  const headers = ["Seq.", "OF/OS", "Cli.", "Qtd.", "Peso", "Ent.", "DP", ...processes.map((p) => p.code)];
  const body: ExportCell[][] = rows.map((row) => [
    seq(row.seq),
    text(row.orderCode),
    text(row.customerName),
    number(row.quantity),
    number(row.weightTotal),
    dateCell(row.deliveryDate),
    dateCell(orderProposalDate(row, processes, today)),
    ...processes.map((process) => orderProcessCell(row.processes[process.code])),
  ]);
  return { headers, rows: body, dateColumns: [5, 6] };
}

/**
 * Fábrica 2 (Fabrica2Table): Seq., OF/OS, Cli., TP, Item pai, Desc., Qtd.,
 * Peso, Ent., DP (data de proposta), OP e os processos FORA da cadeia da
 * Fábrica 1 (a cadeia fica oculta — a MP abre a lista, como na tela). Os
 * rótulos são os que a tela EXIBE (o nome completo mora só no tooltip).
 */
export function fabrica2Sheet(
  rows: readonly ProductionRow[],
  processes: readonly ProcessDefinition[],
  today: string,
): ExportSheet {
  const processColumns = processes.filter(
    (process) => !(F1_PROCESS_CODES as readonly string[]).includes(process.code),
  );
  const headers = [
    "Seq.",
    "OF/OS",
    "Cli.",
    "TP",
    "Item pai",
    "Desc.",
    "Qtd.",
    "Peso",
    "Ent.",
    "DP",
    "OP",
    ...processColumns.map((p) => p.code),
  ];
  const body: ExportCell[][] = rows.map((row) => [
    seq(row.seq),
    text(row.orderCode),
    text(row.customerName),
    text(row.family),
    text(row.parentItem),
    text(row.description),
    number(row.quantity),
    number(row.unitWeightKg),
    dateCell(row.deliveryDate),
    dateCell(itemProposalDate(row, processes, today)),
    text(row.op),
    ...processColumns.map((process) => itemProcessCell(row.processes[process.code])),
  ]);
  return { headers, rows: body, dateColumns: [8, 9] };
}

/**
 * Fábrica 1 (Fabrica1Table): Seq., OF/OS, Cli., Filho, Matérias-primas,
 * Qtd., Peso un., Peso total, Ent., DP (data de proposta) e a cadeia F1
 * (MP primeiro, depois LASER…FICEP e o KIT) — o que vem depois do KIT
 * mora na gestão de OF.
 */
export function fabrica1Sheet(
  items: readonly ChildItemGroup[],
  processes: readonly ProcessDefinition[],
  today: string,
): ExportSheet {
  const processColumns = fabrica1ProcessColumns(processes);
  const headers = [
    "Seq.",
    "OF/OS",
    "Cli.",
    "Filho",
    "Matérias-primas",
    "Qtd.",
    "Peso un.",
    "Peso total",
    "Ent.",
    "DP",
    ...processColumns.map((p) => p.code),
  ];
  const body: ExportCell[][] = items.map((item) => [
    seq(item.seq),
    text(item.orderCode),
    text(item.customerName),
    text(item.childItem || item.description),
    // Uma material por item (mesmo conteúdo da lista exibida na célula);
    // separador "; " porque o SheetJS community grava sem wrap de célula.
    item.materials.length ? item.materials.map((material) => material.description).join("; ") : "—",
    number(item.quantity),
    number(item.unitWeightKg),
    number(item.weightTotal),
    dateCell(item.deliveryDate),
    dateCell(childItemProposalDate(item, processes, today)),
    ...processColumns.map((process) =>
      isFabrica1Editable(process.code)
        ? itemProcessCell(item.processes.find((entry) => entry.code === process.code))
        : inheritedProcessCell(item.parentProcessStatuses[process.code]),
    ),
  ]);
  return { headers, rows: body, dateColumns: [8, 9] };
}

/**
 * Pedidos (OrderList): Código (com o prefixo OF/OS do badge), Cliente,
 * Entrega, DP (data de proposta), Situação e Itens — ordem fixa do
 * servidor (entrega, código). A DP vem do mapa calculado pelo servidor
 * (mesma regra da gestão de OF).
 */
export function pedidosSheet(
  orders: readonly OrderSummary[],
  proposalByOrder: Readonly<Record<string, string | null>>,
): ExportSheet {
  const headers = ["Código", "Cliente", "Entrega", "DP", "Situação", "Itens"];
  const body: ExportCell[][] = orders.map((order) => [
    `${order.type} ${order.code}`,
    text(order.customerName),
    dateCell(order.deliveryDate),
    dateCell(proposalByOrder[order.id] ?? null),
    ORDER_STATUS_LABELS[order.status],
    order.itemCount,
  ]);
  return { headers, rows: body, dateColumns: [2, 3] };
}

/**
 * Romaneio — listagem (RomaneioList): Nº, OF/OS, Cliente, Situação,
 * Saída, Itens, Qtd, Peso, NF saída, NF devolução e o marcador de saldo
 * a devolver (mesmas colunas da tela, mesma ordem do servidor).
 */
export function romaneiosListSheet(
  romaneios: readonly RomaneioSummary[],
): ExportSheet {
  const headers = [
    "Nº",
    "OF/OS",
    "Cliente",
    "Situação",
    "Saída",
    "Itens",
    "Qtd",
    "Peso (kg)",
    "NF saída",
    "NF devolução",
    "Saldo a devolver",
  ];
  const body: ExportCell[][] = romaneios.map((romaneio) => [
    romaneio.number,
    text(romaneio.orderCode),
    text(romaneio.customerName),
    ROMANEIO_STATUS_LABELS[romaneio.status],
    dateCell(romaneio.shipmentDate),
    romaneio.itemCount,
    number(romaneio.quantityTotal),
    number(romaneio.weightTotal),
    text(romaneio.nfNumber),
    text(romaneio.returnNfNumber),
    romaneio.pendingReturn && !romaneio.returnNfNumber ? "Sim" : "Não",
  ]);
  return { headers, rows: body, dateColumns: [4] };
}

/**
 * Romaneio — documento de UM romaneio (/romaneio/[id]): cabeçalho da
 * carga, bloco de itens da carga e bloco de devolução de matéria-prima
 * com o Σ da OF inteira. Os blocos entram como linhas de seção na mesma
 * aba (uma folha por romaneio, pronta para anexar à NF).
 */
export function romaneioDocumentSheet(view: RomaneioView): ExportSheet {
  const headers = [
    "Romaneio",
    "Situação",
    "OF/OS",
    "Cliente",
    "Saída",
    "Transportadora",
    "Veículo",
    "NF saída",
    "NF devolução",
    "Conferência",
    "Emitido em",
  ];

  const rows: ExportCell[][] = [];
  rows.push([
    view.number,
    ROMANEIO_STATUS_LABELS[view.status],
    `${view.orderType} ${view.orderCode}`,
    text(view.customerName),
    dateCell(view.shipmentDate),
    text(view.carrier),
    text(view.vehicle),
    text(view.nfNumber),
    text(view.returnNfNumber),
    view.conferenceAcceptedAt
      ? formatDateTime(view.conferenceAcceptedAt) +
        (view.conferenceAcceptedByName ? ` (${view.conferenceAcceptedByName})` : "")
      : "—",
    view.emittedAt ? formatDateTime(view.emittedAt) : "—",
  ]);

  // ---- Blocos: itens da carga e devolução de matéria-prima ----
  rows.push([]);
  rows.push(["ITENS DA CARGA"]);
  rows.push([
    "Item pai",
    "Família",
    "Descrição",
    "EXP",
    "Qtd OF",
    "Já expedida",
    "Nesta carga",
    "Peso un. (kg)",
    "Peso carga (kg)",
  ]);
  for (const item of view.items) {
    rows.push([
      text(item.parentItem),
      text(item.family),
      text(item.description),
      item.expStatus ? PROCESS_STATUS_LABELS[item.expStatus] : "—",
      number(item.itemQuantity),
      number(item.shippedQuantity),
      number(item.quantity),
      number(item.unitWeightKg),
      number(item.unitWeightKg === null ? null : item.unitWeightKg * item.quantity),
    ]);
  }

  rows.push([]);
  rows.push(["DEVOLUÇÃO DE MATÉRIA-PRIMA"]);
  rows.push([
    "Material",
    "Unidade",
    "Previsto (carga)",
    "Recebida",
    "Utilizada",
    "Saldo a devolver",
  ]);
  for (const material of view.materials) {
    rows.push([
      text(material.description),
      text(material.unit),
      number(material.quantityPlanned),
      number(material.quantityReceived),
      number(material.quantityUsed),
      number(material.quantityReturned),
    ]);
  }

  rows.push([]);
  rows.push([
    "OF INTEIRA (TODOS OS ROMANEIOS)",
    "",
    "",
    "Recebida",
    "Utilizada",
    "Saldo a devolver",
  ]);
  rows.push([
    null,
    null,
    null,
    number(view.ofMaterialTotals.received),
    number(view.ofMaterialTotals.used),
    number(view.ofMaterialTotals.returned),
  ]);

  return { headers, rows, dateColumns: [4] };
}
