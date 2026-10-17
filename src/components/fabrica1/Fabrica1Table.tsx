"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { coreFeatures, createColumnHelper, flexRender, useTable, type CoreFeatures } from "@tanstack/react-table";

import { FABRICA1_EDITABLE_PROCESS_CODES, MP_PROCESS_CODE } from "@/lib/constants/processes";
import { MATERIAL_UNIT_LABELS, type MaterialUnit } from "@/lib/constants/materials";
import { PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS, type ProcessStatus } from "@/lib/constants/production";
import type { ChildItemFilters, ChildItemGroup, ChildItemProcess, OrderItemMaterial } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import { formatBusinessDate, formatBusinessDayMonth, formatDate, formatDayMonth } from "@/lib/utils/dates";
import { formatQuantity, formatWeight, truncate } from "@/lib/utils/formatting";
import {
  computeProcessSchedule,
  scheduleProcessesForItem,
  type ProcessWindow,
} from "@/lib/utils/process-schedule";
import { fabrica1ItemProcesses, fabrica1ProcessColumns, isProcessStartOverdue } from "@/lib/utils/production";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { SeqCell } from "@/components/shared/SeqCell";
import { updateItemsSeqAction } from "@/lib/actions/orders.actions";
import {
  ProcessDetailsSheet,
  type ProcessSelection,
  type ProductionCapabilities,
} from "@/components/producao/ProcessDetailsSheet";
import {
  Fabrica1ChildItemFilter,
  Fabrica1ColumnHeader,
  Fabrica1DeliveryFilter,
  Fabrica1NumericFilter,
  Fabrica1ProcessColumnFilter,
  Fabrica1ProcessGroupFilter,
  Fabrica1SeqFilter,
  Fabrica1TextFilter,
} from "@/components/fabrica1/Fabrica1ColumnHeaders";

interface Fabrica1TableProps {
  /** Linhas agrupadas por código do filho dentro da OF (033). */
  items: ChildItemGroup[];
  /** Catálogo ativo — colunas do grupo PROCESSOS e datas previstas. */
  processes: ProcessDefinition[];
  filters: ChildItemFilters;
  capabilities: ProductionCapabilities;
  /** Data de referência (AAAA-MM-DD) — início anterior a ela fica em vermelho. */
  today: string;
}

const helper = createColumnHelper<CoreFeatures, ChildItemGroup>();

/** Processo editável nesta tela: as etapas de sub-item e o KIT (nunca o MP). */
function isEditableProcess(code: string): boolean {
  return (FABRICA1_EDITABLE_PROCESS_CODES as readonly string[]).includes(code);
}

function statusClass(status: ProcessStatus): string {
  switch (status) {
    case "CONCLUIDO":
      return "border-status-done/40 bg-status-done-bg text-status-done";
    case "NAO_APLICAVEL":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

interface ProcessCellButtonProps {
  cell: ChildItemProcess | undefined;
  processName: string;
  disabled: boolean;
  onSelect: (selection: ProcessSelection) => void;
  /**
   * Seleção pronta da linha (033: grupo de N membros vira lote de
   * situação; 1 membro mantém a edição completa). Null → sem registro.
   */
  selection: ProcessSelection | null;
  /** Janela prevista de execução (dias úteis contados de trás para frente da entrega). */
  plan: ProcessWindow | null;
  /** Data de referência (AAAA-MM-DD) — início anterior a ela fica em vermelho. */
  today: string;
  /** Descrição exibida nos textos da célula (a do grupo quando agrupada). */
  itemLabel: string;
}

function ProcessCellButton({
  cell,
  processName,
  disabled,
  onSelect,
  selection,
  plan,
  today,
  itemLabel,
}: ProcessCellButtonProps) {
  if (!cell || !selection) {
    return (
      <span
        className="inline-flex h-8 w-full items-center justify-center rounded border border-border bg-background text-[10px] text-muted-foreground"
        title={`${processName} de ${itemLabel}: sem registro`}
      >
        —
      </span>
    );
  }

  const label = PROCESS_STATUS_LABELS[cell.status];
  const quantity =
    cell.quantityPlanned !== null || cell.quantityCompleted !== null
      ? `${formatQuantity(cell.quantityCompleted ?? 0)}/${formatQuantity(cell.quantityPlanned ?? 0)}`
      : null;
  const plannedDay = plan ? formatDayMonth(plan.start) : null;
  // Início vencido (anterior à data de referência) → fonte vermelha;
  // processo CONCLUIDO nunca fica vermelho (regra em utils/production).
  const plannedDayPast = isProcessStartOverdue(plan?.start ?? null, cell.status, today);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(selection)}
      className={cn(
        "inline-flex h-8 w-full flex-col items-center justify-center gap-0.5 rounded border px-1 text-[10px] font-semibold leading-none transition-colors",
        "hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70",
        statusClass(cell.status),
      )}
      title={`${processName} — ${itemLabel}: ${label}${quantity ? ` (${quantity})` : ""}${plan ? ` · previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}`}
      aria-label={`${processName} de ${itemLabel}: ${label}${quantity ? `, produzido ${quantity}` : ""}${plan ? `, previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        <span aria-hidden>{PROCESS_STATUS_SYMBOLS[cell.status]}</span>
        {quantity ? <span className="tabular-nums">{quantity}</span> : null}
      </span>
      {plannedDay ? (
        <span className={cn("tabular-nums text-[10px]", plannedDayPast && "text-status-late")}>
          {plannedDay}
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * Célula do MP: somente leitura, com o status do ITEM PAI — o valor é o
 * mesmo editado na gestão de entregas, então não se edita aqui. A janela
 * prevista vem do PAI (entrega + status do pai, memo `parentMpPlanByItem`)
 * e, concluído (031), a data efetiva do recebimento aparece ACIMA da
 * prevista — mesmo desenho das demais células de processo.
 */
function InheritedProcessCell({
  status,
  completedAt,
  plan,
  today,
}: {
  status: ProcessStatus | undefined;
  completedAt: string | null;
  /** Janela prevista do MP, contada da entrega do PAI. */
  plan: ProcessWindow | null;
  /** Data de referência (AAAA-MM-DD) — início anterior a ela fica em vermelho. */
  today: string;
}) {
  if (!status) {
    return (
      <span
        className="inline-flex h-8 w-full items-center justify-center rounded border border-border bg-background text-[10px] text-muted-foreground"
        title="Matéria-prima: sem registro no item pai"
      >
        —
      </span>
    );
  }

  const receivedDay =
    status === "CONCLUIDO" && completedAt ? formatBusinessDayMonth(completedAt) : null;
  const plannedDay = plan ? formatDayMonth(plan.start) : null;
  // Início vencido (anterior à data de referência) → fonte vermelha;
  // MP CONCLUIDO nunca fica vermelho (regra em utils/production).
  const plannedDayPast = isProcessStartOverdue(plan?.start ?? null, status, today);

  return (
    <span
      className={cn(
        "inline-flex h-8 w-full flex-col items-center justify-center rounded border px-1 text-[10px] font-semibold leading-none",
        // 3 linhas (símbolo + recebida + prevista) cabem no h-8 sem folga.
        receivedDay && plannedDay ? "gap-0" : "gap-0.5",
        statusClass(status),
      )}
      title={`Matéria-prima — status do item pai (editado na Gestão de OF): ${PROCESS_STATUS_LABELS[status]}${plan ? ` · previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}${receivedDay ? ` · recebida em ${formatBusinessDate(completedAt)}` : ""}`}
    >
      <span aria-hidden>{PROCESS_STATUS_SYMBOLS[status]}</span>
      {/* 031: recebimento efetivo em CIMA da prevista (mesmo formato das listas). */}
      {receivedDay ? <span className="tabular-nums text-[10px]">{receivedDay}</span> : null}
      {plannedDay ? (
        <span className={cn("tabular-nums text-[10px]", plannedDayPast && "text-status-late")}>
          {plannedDay}
        </span>
      ) : null}
      <span className="sr-only">
        Matéria-prima: {PROCESS_STATUS_LABELS[status]} — status do item pai
      </span>
    </span>
  );
}

/**
 * Chip do MP no card (mobile): rótulo `MP` + datas empilhadas à direita —
 * o recebimento efetivo (031) em cima da prevista, sem as palavras.
 */
function InheritedMpChip({
  item,
  plan,
  today,
}: {
  /** Linha agrupada (033) — a coluna MP agrega os pais do grupo. */
  item: ChildItemGroup;
  plan: ProcessWindow | null;
  today: string;
}) {
  const status = item.parentProcessStatuses[MP_PROCESS_CODE];
  if (!status) return null;

  const receivedDay =
    status === "CONCLUIDO" && item.parentMpCompletedAt
      ? formatBusinessDayMonth(item.parentMpCompletedAt)
      : null;
  const plannedDay = plan ? formatDayMonth(plan.start) : null;
  const plannedDayPast = isProcessStartOverdue(plan?.start ?? null, status, today);

  return (
    <li>
      <span
        className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] tabular-nums"
        title={`Matéria-prima — status do item pai: ${PROCESS_STATUS_LABELS[status]}${plan ? ` · previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}${receivedDay ? ` · recebida em ${formatBusinessDate(item.parentMpCompletedAt)}` : ""}`}
      >
        <span aria-hidden>{PROCESS_STATUS_SYMBOLS[status]}</span>
        MP
        {receivedDay || plannedDay ? (
          <span className="flex flex-col items-end leading-none text-[10px]">
            {receivedDay ? <span className="tabular-nums">{receivedDay}</span> : null}
            {plannedDay ? (
              <span className={cn("tabular-nums", plannedDayPast && "text-status-late")}>
                {plannedDay}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="sr-only">
          Matéria-prima: {PROCESS_STATUS_LABELS[status]} — status do item pai
        </span>
      </span>
    </li>
  );
}

function unitLabel(unit: string): string {
  return MATERIAL_UNIT_LABELS[unit as MaterialUnit] ?? unit;
}

/** Materiais de um item filho — filho sem material fica sinalizado (pendência de compra). */
function MaterialsList({ materials }: { materials: OrderItemMaterial[] }) {
  if (materials.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum material cadastrado.</p>;
  }
  return (
    <ul className="space-y-0.5">
      {materials.map((material) => (
        <li key={material.id} className="text-xs">
          <span className="font-medium">{material.description}</span>{" "}
          <span className="tabular-nums text-muted-foreground">
            {formatQuantity(material.quantity)} {unitLabel(material.unit)}
          </span>
          {material.notes ? (
            <span className="block text-[11px] text-muted-foreground">{material.notes}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Seleção de uma célula de processo da Fábrica 1 (033): a linha agrupada
 * com N membros abre a folha em modo LOTE (só a situação, aplicada a
 * todos os itens do grupo); com 1 membro, a edição completa de antes.
 */
function cellSelection(row: ChildItemGroup, process: ChildItemProcess): ProcessSelection {
  const grouped = row.memberCount > 1;
  return {
    // id do primeiro membro: serve de chave de remontagem da folha; a
    // gravação do grupo usa os memberIds, nunca este id.
    productionProcessId: process.id,
    orderItemId: row.memberIds[0] ?? row.id,
    orderId: row.orderId,
    orderCode: row.orderCode,
    itemDescription: grouped ? `${row.description} (×${row.memberCount})` : row.description,
    processName: process.name,
    processCode: process.code,
    deliveryDate: row.deliveryDate,
    status: process.status,
    quantityPlanned: process.quantityPlanned,
    quantityCompleted: process.quantityCompleted,
    notes: process.notes,
    // Só o MP tem data efetiva e nesta tela ele nunca é editável
    // (célula herdada do pai) — a folha daqui nunca abre o MP.
    completedAt: null,
    ...(grouped ? { groupItemIds: row.memberIds } : {}),
  };
}

/** Tabela da Fábrica 1 (desktop) + cards (mobile), no mesmo desenho da gestão de entregas. */
export function Fabrica1Table({ items, processes, filters, capabilities, today }: Fabrica1TableProps) {
  const [selection, setSelection] = useState<ProcessSelection | null>(null);

  // Colunas de processo da cadeia F1: MP primeiro, depois as etapas de
  // sub-item e o KIT. O que vem depois do KIT continua na gestão de entregas.
  const processColumns = useMemo(() => fabrica1ProcessColumns(processes), [processes]);

  // Datas previstas por item: janela de cada processo contada da entrega.
  // O status do processo NO ITEM entra no cálculo: desmarcado (NAO_APLICAVEL)
  // não ocupa dias nem ganha janela (senão empurrava as datas anteriores).
  const scheduleByItem = useMemo(
    () =>
      new Map(
        items.map((item) => {
          const byCode = new Map(item.processes.map((p) => [p.code, p.status] as const));
          return [
            item.id,
            computeProcessSchedule(
              item.deliveryDate,
              scheduleProcessesForItem(processes, (code) => byCode.get(code)),
            ),
          ] as const;
        }),
      ),
    [items, processes],
  );

  // Janela prevista do MP no ITEM PAI (a coluna MP é herdada do pai):
  // contada da entrega do pai com os status do pai — a mesma regra das
  // janelas por item da Fábrica 2, aplicada ao pai desta linha.
  const parentMpPlanByItem = useMemo(
    () =>
      new Map<string, ProcessWindow | null>(
        items.map(
          (item): [string, ProcessWindow | null] => [
            item.id,
            item.parentDeliveryDate
              ? computeProcessSchedule(
                  item.parentDeliveryDate,
                  scheduleProcessesForItem(processes, (code) => item.parentProcessStatuses[code]),
                ).get(MP_PROCESS_CODE) ?? null
              : null,
          ],
        ),
      ),
    [items, processes],
  );

  const columns = useMemo(() => {
    const orderColumns = [
      // 036: prioridade do planejamento — primeiro campo da linha. A
      // edição em lote aplica o número a TODOS os membros do grupo.
      helper.accessor("seq", {
        id: "seq",
        header: () => (
          <Fabrica1ColumnHeader
            label="Seq."
            fullLabel="Sequência de fabricação"
            filter={<Fabrica1SeqFilter filters={filters} />}
          />
        ),
        cell: (info) => {
          const row = info.row.original;
          return (
            <SeqCell
              value={info.getValue()}
              canEdit={capabilities.canEditSeq}
              label={`${row.orderCode} — ${row.description}`}
              onCommit={(seq) => updateItemsSeqAction(row.memberIds, seq)}
            />
          );
        },
      }),
      helper.accessor((row) => row, {
        id: "order",
        header: () => (
          <Fabrica1ColumnHeader
            label="OF/OS"
            filter={
              <Fabrica1TextFilter filters={filters} field="orderCode" column="OF/OS" context="OF/OS" />
            }
          />
        ),
        // O código é o atalho para a tela de detalhes da OF (pai + filhos + materiais).
        cell: (info) => (
          <Link
            href={`/pedidos/${info.row.original.orderId}`}
            className="block whitespace-nowrap font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
            title={info.row.original.customerName ?? info.row.original.orderCode}
            aria-label={`Ver detalhes do pedido ${info.row.original.orderCode}`}
          >
            {info.row.original.orderCode}
          </Link>
        ),
      }),
      helper.accessor("customerName", {
        id: "customer",
        header: () => (
          <Fabrica1ColumnHeader
            label="Cli."
            fullLabel="Cliente"
            filter={
              <Fabrica1TextFilter filters={filters} field="customer" column="Cliente" context="cliente" />
            }
          />
        ),
        cell: (info) => <span className="block max-w-[120px] truncate">{info.getValue() || "—"}</span>,
      }),
      helper.accessor("parentItem", {
        id: "parentItem",
        header: () => (
          <Fabrica1ColumnHeader
            label="Item pai"
            filter={
              <Fabrica1TextFilter
                filters={filters}
                field="parentItem"
                column="Item pai"
                context="item pai"
              />
            }
          />
        ),
        cell: (info) => {
          const row = info.row.original;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              {info.getValue() ? (
                <Badge variant="outline" className="px-1 py-0 tabular-nums">
                  {info.getValue()}
                </Badge>
              ) : null}
              {row.parentItems.length > 1 ? (
                <span
                  className="whitespace-nowrap text-[10px] text-muted-foreground"
                  title={`Componente usado por ${row.parentItems.length} itens pai: ${row.parentItems.join(", ")}`}
                >
                  +{row.parentItems.length - 1}
                </span>
              ) : null}
              <span
                className="min-w-0 max-w-[200px] truncate"
                title={row.parentDescription ?? undefined}
              >
                {row.parentDescription ?? "—"}
              </span>
            </span>
          );
        },
      }),
      helper.accessor("childItem", {
        id: "childItem",
        header: () => <Fabrica1ColumnHeader label="Filho" filter={<Fabrica1ChildItemFilter filters={filters} />} />,
        cell: (info) => {
          const row = info.row.original;
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              {info.getValue() ? (
                <Badge variant="secondary" className="px-1 py-0 tabular-nums">
                  {info.getValue()}
                </Badge>
              ) : null}
              <span className="min-w-0 max-w-[220px] truncate" title={row.description}>
                {truncate(row.description, 45)}
              </span>
              {row.memberCount > 1 ? (
                <span
                  className="whitespace-nowrap text-[10px] text-muted-foreground"
                  title={`${row.memberCount} itens agrupados nesta linha — quantidades somadas.`}
                >
                  ×{row.memberCount}
                </span>
              ) : null}
            </span>
          );
        },
      }),
      helper.accessor("materials", {
        id: "materials",
        header: () => (
          <Fabrica1ColumnHeader
            label="Matérias-primas"
            filter={
              <Fabrica1TextFilter
                filters={filters}
                field="material"
                column="Matérias-primas"
                context="matéria-prima"
              />
            }
          />
        ),
        cell: (info) => <MaterialsList materials={info.getValue()} />,
      }),
      helper.accessor("quantity", {
        id: "quantity",
        header: () => (
          <Fabrica1ColumnHeader
            label="Qtd."
            filter={
              <Fabrica1NumericFilter
                filters={filters}
                minField="qtyMin"
                maxField="qtyMax"
                column="Qtd."
                context="quantidade do grupo"
              />
            }
          />
        ),
        cell: (info) => <span className="tabular-nums">{formatQuantity(info.getValue())}</span>,
      }),
      helper.accessor("unitWeightKg", {
        id: "unitWeightKg",
        header: () => (
          <Fabrica1ColumnHeader
            label="Peso un."
            fullLabel="Peso unitário"
            filter={
              <Fabrica1NumericFilter
                filters={filters}
                minField="weightUnitMin"
                maxField="weightUnitMax"
                column="Peso un."
                context="peso unitário"
                step="0.001"
              />
            }
          />
        ),
        cell: (info) => <span className="tabular-nums">{formatWeight(info.getValue())}</span>,
      }),
      helper.accessor((row) => row.weightTotal, {
        id: "totalWeight",
        header: () => (
          <Fabrica1ColumnHeader
            label="Peso total"
            filter={
              <Fabrica1NumericFilter
                filters={filters}
                minField="weightMin"
                maxField="weightMax"
                column="Peso total"
                context="peso total do grupo"
                step="0.001"
              />
            }
          />
        ),
        cell: (info) => (
          <span className="whitespace-nowrap tabular-nums">
            {info.getValue() === null ? "—" : `${formatWeight(info.getValue())} kg`}
          </span>
        ),
      }),
      helper.accessor("deliveryDate", {
        id: "deliveryDate",
        header: () => (
          <Fabrica1ColumnHeader
            label="Ent."
            fullLabel="Entrega"
            filter={<Fabrica1DeliveryFilter filters={filters} />}
          />
        ),
        cell: (info) => (
          <span className="whitespace-nowrap tabular-nums">{formatDate(info.getValue())}</span>
        ),
      }),
    ];

    const processGroupColumns = processColumns.map((process) => {
      const editable = isEditableProcess(process.code);
      return helper.accessor(
        (row) =>
          editable
            ? (row.processes.find((entry) => entry.code === process.code) ?? undefined)
            : undefined,
        {
          id: process.code,
          header: () => (
            <Fabrica1ColumnHeader
              label={process.code}
              filter={<Fabrica1ProcessColumnFilter filters={filters} code={process.code} />}
            />
          ),
          cell: (info) => {
            const row = info.row.original;
            if (!editable) {
              return (
                <InheritedProcessCell
                  status={row.parentProcessStatuses[process.code]}
                  completedAt={row.parentMpCompletedAt}
                  plan={parentMpPlanByItem.get(row.id) ?? null}
                  today={today}
                />
              );
            }
            const cell = info.getValue();
            return (
              <ProcessCellButton
                cell={cell}
                processName={process.name}
                disabled={!capabilities.canUpdateStatus}
                onSelect={setSelection}
                selection={cell ? cellSelection(row, cell) : null}
                plan={scheduleByItem.get(row.id)?.get(process.code) ?? null}
                today={today}
                itemLabel={row.description}
              />
            );
          },
        },
      );
    });

    return helper.columns([
      helper.group({
        id: "order-data",
        header: () => <span>DADOS DOS PEDIDOS</span>,
        columns: helper.columns(orderColumns),
      }),
      helper.group({
        id: "process-data",
        header: () => (
          <span className="flex items-center justify-center gap-2">
            <span>PROCESSOS</span>
            <Fabrica1ProcessGroupFilter filters={filters} />
          </span>
        ),
        columns: helper.columns(processGroupColumns),
      }),
    ]);
  }, [filters, processColumns, capabilities.canUpdateStatus, capabilities.canEditSeq, scheduleByItem, parentMpPlanByItem, today]);

  const table = useTable({
    features: coreFeatures,
    columns,
    data: items,
    getRowId: (row) => row.id,
  });

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nenhum item filho encontrado"
        description="Ajuste os filtros ou importe uma planilha para começar."
      />
    );
  }

  return (
    <>
      {/* Desktop / tablet: tabela com rolagem própria e cabeçalho fixo */}
      <div className="hidden max-h-[calc(100vh-8rem)] overflow-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-[10px]">
          <caption className="sr-only">
            Itens filhos das OFs agrupados por código: uma coluna por processo da cadeia da
            Fábrica 1, com matérias-primas e quantidades somadas.
          </caption>
          <thead>
            {table.getHeaderGroups().map((headerGroup, groupIndex) => (
              <tr key={headerGroup.id} className="border-b bg-muted/40">
                {headerGroup.headers.map((header) => {
                  const isLeaf = header.subHeaders.length === 0;
                  const isFirstLeaf = isLeaf && header.index === 0;
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      scope={isLeaf ? "col" : "colgroup"}
                      className={cn(
                        "h-9 whitespace-nowrap px-1.5 text-left align-middle text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
                        // Cabeçalho fixo: as duas linhas grudam no topo da rolagem.
                        "sticky z-30",
                        groupIndex === 0 ? "top-0" : "top-9",
                        groupIndex === 0 ? "bg-muted" : "bg-card",
                        header.depth === 0 && "border-b text-center text-foreground",
                        isFirstLeaf && "left-0",
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b align-top transition-colors last:border-0 hover:bg-muted/30">
                {row.getAllCells().map((cell, index) => (
                  <td
                    key={cell.id}
                    className={cn(
                      "px-1 py-1 align-middle",
                      index === 0 && "sticky left-0 z-10 bg-card",
                      index === 0 && "border-r",
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-2 lg:hidden">
        {items.map((item) => (
          <article key={item.id} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
                <Link
                  href={`/pedidos/${item.orderId}`}
                  className="font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
                  aria-label={`Ver detalhes do pedido ${item.orderCode}`}
                >
                  {item.orderCode}
                </Link>
                {item.parentItem ? (
                  <Badge variant="outline" className="px-1 py-0 tabular-nums">
                    {item.parentItem}
                  </Badge>
                ) : null}
                {item.childItem ? (
                  <Badge variant="secondary" className="px-1 py-0 tabular-nums">
                    {item.childItem}
                  </Badge>
                ) : null}
                {item.memberCount > 1 ? (
                  <span
                    className="whitespace-nowrap text-[10px] text-muted-foreground"
                    title={`${item.memberCount} itens agrupados neste card — quantidades somadas.`}
                  >
                    ×{item.memberCount}
                  </span>
                ) : null}
              </span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {formatDate(item.deliveryDate)}
              </span>
            </header>

            <p className="mt-1 text-sm">{item.description}</p>
            {item.parentDescription ? (
              <p
                className="truncate text-xs text-muted-foreground"
                title={
                  item.parentItems.length > 1
                    ? `${item.parentDescription} (+${item.parentItems.length - 1}: ${item.parentItems.join(", ")})`
                    : item.parentDescription
                }
              >
                Item pai: {item.parentDescription}
                {item.parentItems.length > 1 ? ` (+${item.parentItems.length - 1})` : ""}
              </p>
            ) : null}
            {item.customerName ? (
              <p className="truncate text-xs text-muted-foreground">{item.customerName}</p>
            ) : null}

            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline">Seq.: </dt>
                <dd className="inline">
                  <SeqCell
                    value={item.seq}
                    canEdit={capabilities.canEditSeq}
                    label={`${item.orderCode} — ${item.description}`}
                    onCommit={(seq) => updateItemsSeqAction(item.memberIds, seq)}
                  />
                </dd>
              </div>
              <div>
                <dt className="inline">Qtd.: </dt>
                <dd className="inline tabular-nums text-foreground">{formatQuantity(item.quantity)}</dd>
              </div>
              <div>
                <dt className="inline">Peso un.: </dt>
                <dd className="inline tabular-nums text-foreground">
                  {item.unitWeightKg === null ? "—" : `${formatWeight(item.unitWeightKg)} kg`}
                </dd>
              </div>
              <div>
                <dt className="inline">Peso total: </dt>
                <dd className="inline tabular-nums text-foreground">
                  {item.weightTotal === null ? "—" : `${formatWeight(item.weightTotal)} kg`}
                </dd>
              </div>
            </dl>

            <div className="mt-2 border-t pt-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                Matérias-primas
              </h4>
              <div className="mt-1">
                <MaterialsList materials={item.materials} />
              </div>
            </div>

            <div className="mt-2 border-t pt-2">
              <h4 className="text-xs font-semibold uppercase text-muted-foreground">Processos</h4>
              <ul className="mt-1 flex flex-wrap gap-1">
                {fabrica1ItemProcesses(item.processes).map((process) => (
                  <li key={process.code}>
                    <span
                      className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] tabular-nums"
                      title={`${process.name} — ${PROCESS_STATUS_LABELS[process.status]}`}
                    >
                      <span aria-hidden>{PROCESS_STATUS_SYMBOLS[process.status]}</span>
                      {process.code}
                      <span className="sr-only">{PROCESS_STATUS_LABELS[process.status]}</span>
                    </span>
                  </li>
                ))}
                <InheritedMpChip
                  item={item}
                  plan={parentMpPlanByItem.get(item.id) ?? null}
                  today={today}
                />
              </ul>
            </div>
          </article>
        ))}
      </div>

      <ProcessDetailsSheet
        selection={selection}
        processes={processes}
        capabilities={capabilities}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      />
    </>
  );
}
