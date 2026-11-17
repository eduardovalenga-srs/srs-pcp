import { ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import { ROMANEIO_STATUS_LABELS } from "@/lib/constants/romaneio";
import {
  F1_PROCESS_CODES,
  FABRICA1_EDITABLE_PROCESS_CODES,
  romaneioProcessColumns,
} from "@/lib/constants/processes";
import { PROCESS_STATUS_SYMBOLS, WEIGHT_GRANULARITY_LABELS, type ProcessStatus } from "@/lib/constants/production";
import type { ChildItemGroup, OrderSummary } from "@/lib/types/order";
import type { RomaneioSummary, RomaneioView } from "@/lib/types/romaneio";
import type {
  CompletedWeightCell,
  CompletedWeightColumn,
  CompletedWeightStats,
  OrderProcessCell,
  ProcessDefinition,
  ProductionOrderRow,
  ProductionRow,
} from "@/lib/types/production";
import type { NamedExportSheet } from "@/lib/export/workbook";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatQuantity } from "@/lib/utils/formatting";
import { fabrica1ProcessColumns } from "@/lib/utils/production";
import { weightKgOf } from "@/lib/utils/romaneio";
import { countBusinessDays, isWeekendISO } from "@/lib/utils/weight-period";
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

/** Célula de processo SEM contador (MP da Fábrica 1 e itens do romaneio): só o símbolo. */
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
 * Saída, Peso, NF ind., NF devolução e o marcador de saldo a devolver
 * (mesmas colunas da tela, mesma ordem do servidor). As colunas de
 * processo ficaram na lista de itens do DETALHE — aqui não entram.
 */
export function romaneiosListSheet(romaneios: readonly RomaneioSummary[]): ExportSheet {
  const headers = [
    "Nº",
    "OF/OS",
    "Cliente",
    "Situação",
    "Saída",
    "Peso (kg)",
    "NF ind.",
    "NF devolução",
    "Saldo a devolver",
  ];
  const body: ExportCell[][] = romaneios.map((romaneio) => [
    romaneio.number,
    text(romaneio.orderCode),
    text(romaneio.customerName),
    ROMANEIO_STATUS_LABELS[romaneio.status],
    dateCell(romaneio.shipmentDate),
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
 * (Material, Unidade, Recebida e Peso (kg) por material — previsto,
 * utilizada e saldo a devolver saíram da lista) com o Σ da OF inteira.
 * Os blocos entram como linhas de seção na mesma aba (uma folha por
 * romaneio, pronta para anexar à NF).
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
    "NF ind.",
    "NF devolução",
    "Conferência",
    "Confirmado em",
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
  // Uma coluna por processo (mesma regra/regras da tela do detalhe: o
  // catálogo ativo menos a cadeia F1, MP e KIT), símbolo por item.
  const processColumns = romaneioProcessColumns(view.processes);
  rows.push([]);
  rows.push(["ITENS DA CARGA"]);
  rows.push([
    "Item pai",
    "Tipo",
    "Descrição",
    ...processColumns.map((process) => process.code),
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
      ...processColumns.map((process) => inheritedProcessCell(item.processes[process.code])),
      number(item.itemQuantity),
      number(item.shippedQuantity),
      number(item.quantity),
      number(item.unitWeightKg),
      number(item.loadWeightKg),
    ]);
  }

  rows.push([]);
  rows.push(["DEVOLUÇÃO DE MATÉRIA-PRIMA"]);
  rows.push([
    "Material",
    "Unidade",
    "Recebida",
    "Peso (kg)",
  ]);
  for (const material of view.materials) {
    // Peso INDIVIDUAL da linha — a utilizada em unidade de peso (KG
    // vale, G ÷ 1000); em UN/M/CX… não há peso ("—"), a MESMA regra
    // da coluna "Peso (kg)" da tela e do peso total da carga.
    const lineWeightKg =
      material.quantityUsed === null ? null : weightKgOf(material.unit, material.quantityUsed);
    rows.push([
      text(material.description),
      text(material.unit),
      number(material.quantityReceived),
      number(lineWeightKg),
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

/* ------------------------------------------------------------------ *
 * Dashboard — peso concluído por processo (074/079)
 * ------------------------------------------------------------------ */

/** Rótulos dos filtros aplicados, exibidos na aba "Resumo". */
export interface DashboardWeightSheetLabels {
  process: string;
  family: string;
}

/** Célula da matriz: kg, "✓" (concluído sem peso) ou "—" (sem produção). */
function weightCell(cell: CompletedWeightCell | undefined): ExportCell {
  if (!cell) return "—";
  if (cell.weightKg > 0) return cell.weightKg;
  return cell.cells > 0 ? "✓" : "—";
}

/** Variação percentual vs. período anterior (texto pt-BR) ou "—". */
function weightChange(stats: CompletedWeightStats): string {
  if (stats.previous.weightKg <= 0) return "—";
  const change = ((stats.total.weightKg - stats.previous.weightKg) / stats.previous.weightKg) * 100;
  return `${change >= 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** Dias úteis do período (mesma regra da linha "Média/dia útil" da tela). */
function dashboardBusinessDays(stats: CompletedWeightStats, today: string): number {
  return countBusinessDays(stats.periodStart, stats.periodEnd, today);
}

/**
 * Aba "Lançamentos": a matriz Dia × processo da tela, com a marcação de
 * fim de semana (coluna filtrável — o SheetJS Community não grava cor de
 * célula), a linha de Total e a de Média/dia útil.
 */
export function dashboardWeightMatrixSheet(
  stats: CompletedWeightStats,
  processes: readonly CompletedWeightColumn[],
  today: string,
): ExportSheet {
  const columns = stats.processCode
    ? processes.filter((process) => process.code === stats.processCode)
    : processes;
  const businessDays = dashboardBusinessDays(stats, today);
  const weightByProcess = new Map(stats.processes.map((process) => [process.code, process.weightKg]));

  const headers = ["Dia", "Fim de semana", ...columns.map((column) => column.name), "Total"];
  const rows: ExportCell[][] = stats.days.map((day) => {
    const cells = new Map(day.processes.map((cell) => [cell.code, cell]));
    const dayTotal = day.processes.reduce((sum, cell) => sum + cell.weightKg, 0);
    return [
      dateCell(day.date),
      isWeekendISO(day.date) ? "Sim" : "Não",
      ...columns.map((column) => weightCell(cells.get(column.code))),
      dayTotal,
    ];
  });

  rows.push([
    "Total",
    "",
    ...columns.map((column) => weightByProcess.get(column.code) ?? 0),
    stats.total.weightKg,
  ]);

  // Na aba "Dia" a média seria o próprio total — a tela também omite.
  if (stats.granularity !== "day") {
    rows.push([
      `Média/dia útil (${businessDays})`,
      "",
      ...columns.map((column) =>
        businessDays > 0 ? (weightByProcess.get(column.code) ?? 0) / businessDays : "—",
      ),
      businessDays > 0 ? stats.total.weightKg / businessDays : "—",
    ]);
  }

  return { headers, rows, dateColumns: [0] };
}

/** Aba "Totais por processo": totais e média kg/dia útil de cada processo. */
export function dashboardWeightProcessesSheet(
  stats: CompletedWeightStats,
  today: string,
): ExportSheet {
  const businessDays = dashboardBusinessDays(stats, today);
  const average = (weightKg: number): ExportCell =>
    businessDays > 0 ? weightKg / businessDays : "—";

  const headers = ["Processo", "Código", "Peso (kg)", "Peças", "Itens", "Células", "Média kg/dia útil"];
  const rows: ExportCell[][] = stats.processes.map((process) => [
    process.name,
    process.code,
    process.weightKg,
    process.quantity,
    process.items,
    process.cells,
    average(process.weightKg),
  ]);
  rows.push([
    "Total",
    "",
    stats.total.weightKg,
    stats.total.quantity,
    "—",
    "—",
    average(stats.total.weightKg),
  ]);

  return { headers, rows, dateColumns: [] };
}

/** Aba "Famílias": montante por grupo de produto no período. */
export function dashboardWeightFamiliesSheet(stats: CompletedWeightStats): ExportSheet {
  const headers = ["Família", "Abreviação", "Peso (kg)", "Peças", "Itens", "Células"];
  const rows: ExportCell[][] = stats.groups.map((group) => [
    group.name,
    group.abbreviation,
    group.weightKg,
    group.quantity,
    group.items,
    group.cells,
  ]);
  const weightTotal = stats.groups.reduce((sum, group) => sum + group.weightKg, 0);
  const quantityTotal = stats.groups.reduce((sum, group) => sum + group.quantity, 0);
  rows.push(["Total", "", weightTotal, quantityTotal, "—", "—"]);

  return { headers, rows, dateColumns: [] };
}

/** Aba "Evolução": dados do gráfico de barras (mesma janela da tela). */
export function dashboardWeightSeriesSheet(stats: CompletedWeightStats): ExportSheet {
  const rows: ExportCell[][] = stats.series.map((bucket) => [
    dateCell(bucket.bucket),
    bucket.weightKg,
    bucket.quantity,
  ]);
  return { headers: ["Período", "Peso (kg)", "Peças"], rows, dateColumns: [0] };
}

/** Aba "Resumo": período, filtros aplicados e totais do recorte. */
export function dashboardWeightSummarySheet(
  stats: CompletedWeightStats,
  today: string,
  labels: DashboardWeightSheetLabels,
): ExportSheet {
  const businessDays = dashboardBusinessDays(stats, today);
  const rows: ExportCell[][] = [
    ["Período", `${formatDate(stats.periodStart)} – ${formatDate(stats.periodEnd)}`],
    ["Granularidade", WEIGHT_GRANULARITY_LABELS[stats.granularity]],
    ["Processo", labels.process],
    ["Família", labels.family],
    ["Peso total (kg)", stats.total.weightKg],
    ["Peças totais", stats.total.quantity],
    ["Peso no período anterior (kg)", stats.previous.weightKg],
    ["Variação vs. período anterior", weightChange(stats)],
    ["Dias úteis considerados", businessDays],
    [
      "Média kg/dia útil",
      businessDays > 0 ? stats.total.weightKg / businessDays : "—",
    ],
  ];
  return { headers: ["Indicador", "Valor"], rows, dateColumns: [] };
}

/**
 * Workbook completo do painel: a lista (matriz) + abas de apoio. A ordem
 * das abas acompanha a leitura da tela: lançamentos, processos, famílias,
 * evolução e, por último, o resumo dos filtros.
 */
export function dashboardWeightSheets(
  stats: CompletedWeightStats,
  processes: readonly CompletedWeightColumn[],
  today: string,
  labels: DashboardWeightSheetLabels,
): NamedExportSheet[] {
  return [
    { name: "Lançamentos", sheet: dashboardWeightMatrixSheet(stats, processes, today) },
    { name: "Totais por processo", sheet: dashboardWeightProcessesSheet(stats, today) },
    { name: "Famílias", sheet: dashboardWeightFamiliesSheet(stats) },
    { name: "Evolução", sheet: dashboardWeightSeriesSheet(stats) },
    { name: "Resumo", sheet: dashboardWeightSummarySheet(stats, today, labels) },
  ];
}
