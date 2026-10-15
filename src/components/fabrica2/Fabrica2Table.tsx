"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { coreFeatures, createColumnHelper, flexRender, useTable, type CoreFeatures } from "@tanstack/react-table";

import type { ProcessDefinition, ProductionFilters, ProductionRow, ProcessCell } from "@/lib/types/production";
import { PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS, type ProcessStatus } from "@/lib/constants/production";
import { F1_PROCESS_CODES } from "@/lib/constants/processes";
import { formatDate, formatDayMonth } from "@/lib/utils/dates";
import { formatQuantity, formatWeight, truncate } from "@/lib/utils/formatting";
import {
  computeProcessSchedule,
  scheduleProcessesForItem,
  type ProcessWindow,
} from "@/lib/utils/process-schedule";
import { isProcessStartOverdue } from "@/lib/utils/production";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { OrderStatusBadge } from "@/components/shared/StatusBadges";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Fabrica2ColumnHeader,
  Fabrica2DeliveryFilter,
  Fabrica2OrderGroupHeader,
  Fabrica2ProcessGroupFilter,
  Fabrica2TextColumnFilter,
} from "@/components/fabrica2/Fabrica2ColumnHeaders";
import { Fabrica2DeliveryDatePopover } from "@/components/fabrica2/Fabrica2DeliveryDatePopover";
import {
  Fabrica2DetailsSheet,
  type Fabrica2ProcessSelection,
  type Fabrica2Capabilities,
} from "@/components/fabrica2/Fabrica2DetailsSheet";

interface Fabrica2TableProps {
  rows: ProductionRow[];
  processes: ProcessDefinition[];
  filters: ProductionFilters;
  capabilities: Fabrica2Capabilities;
  /** Data de referência (AAAA-MM-DD) — datas anteriores a ela ficam em vermelho. */
  today: string;
}

const helper = createColumnHelper<CoreFeatures, ProductionRow>();

function DeliveryCell({ row, canEdit }: { row: ProductionRow; canEdit: boolean }) {
  // REGRA DE ATRASO: vermelho somente com entrega vencida E expedição pendente.
  const past = row.overdue;
  const content = (
    <div className="flex flex-col gap-0.5">
      <span className={cn("whitespace-nowrap tabular-nums", past && "text-status-late")}>
        {formatDate(row.deliveryDate)}
      </span>
    </div>
  );

  // Edição manual da entrega (ADMIN/GESTOR): a gravação dispara o refresh
  // e as previsões de todos os processos são recalculadas.
  if (!canEdit) return content;
  return (
    <Fabrica2DeliveryDatePopover
      orderItemId={row.orderItemId}
      deliveryDate={row.deliveryDate}
      itemLabel={`${row.orderCode} — ${row.description}`}
    >
      {content}
    </Fabrica2DeliveryDatePopover>
  );
}

interface ProcessCellButtonProps {
  cell: ProcessCell | undefined;
  processName: string;
  disabled: boolean;
  onSelect: (selection: Fabrica2ProcessSelection) => void;
  /** Janela prevista de execução (dias úteis contados de trás para frente da entrega). */
  plan: ProcessWindow | null;
  /** Data de referência (AAAA-MM-DD) — início anterior a ela fica em vermelho. */
  today: string;
  context: {
    orderItemId: string;
    orderCode: string;
    itemDescription: string;
    processCode: string;
    deliveryDate: string | null;
  };
}

function ProcessCellButton({ cell, processName, disabled, onSelect, plan, today, context }: ProcessCellButtonProps) {
  if (!cell) {
    return (
      <span
        className="inline-flex h-7 w-full items-center justify-center rounded border border-dashed text-muted-foreground"
        title={`${processName}: não aplicável a este item`}
        aria-label={`${processName}: não aplicável a este item`}
      >
        <span aria-hidden>—</span>
      </span>
    );
  }

  const label = PROCESS_STATUS_LABELS[cell.status];
  const quantity =
    cell.quantityPlanned !== null || cell.quantityCompleted !== null
      ? `${formatQuantity(cell.quantityCompleted ?? 0)}/${formatQuantity(cell.quantityPlanned ?? 0)}`
      : null;
  // Início previsto em dd/MM — otimiza a largura da coluna (sem scroll lateral).
  const plannedDay = plan ? formatDayMonth(plan.start) : null;
  // Início vencido (anterior à data de referência) → fonte vermelha;
  // processo CONCLUIDO nunca fica vermelho (regra em utils/production).
  const plannedDayPast = isProcessStartOverdue(plan?.start ?? null, cell.status, today);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onSelect({
          productionProcessId: cell.id,
          orderItemId: context.orderItemId,
          orderCode: context.orderCode,
          itemDescription: context.itemDescription,
          processName,
          processCode: context.processCode,
          deliveryDate: context.deliveryDate,
          status: cell.status,
          quantityPlanned: cell.quantityPlanned,
          quantityCompleted: cell.quantityCompleted,
          notes: cell.notes,
        })
      }
      className={cn(
        "inline-flex h-7 w-full flex-col items-center justify-center gap-0.5 rounded border px-1 text-[10px] font-semibold leading-none transition-colors",
        "hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70",
        statusClass(cell.status),
      )}
      title={`${processName} — ${context.itemDescription}: ${label}${quantity ? ` (${quantity})` : ""}${plan ? ` · previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}`}
      aria-label={`${processName} de ${context.itemDescription}: ${label}${quantity ? `, produzido ${quantity}` : ""}${plan ? `, previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}`}
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

function statusClass(status: ProcessStatus): string {
  switch (status) {
    case "CONCLUIDO":
      return "border-status-done/40 bg-status-done-bg text-status-done";
    case "EM_ANDAMENTO":
      return "border-status-progress/40 bg-status-progress-bg text-status-progress";
    case "BLOQUEADO":
      return "border-status-blocked/40 bg-status-blocked-bg text-status-blocked";
    case "NAO_APLICAVEL":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

/** Tabela da Fábrica 2 (desktop) + cards (mobile) com folha de detalhes. */
export function Fabrica2Table({ rows, processes, filters, capabilities, today }: Fabrica2TableProps) {
  const [selection, setSelection] = useState<Fabrica2ProcessSelection | null>(null);

  // Datas previstas por item: janela de cada processo contada da entrega.
  // O status do processo NO ITEM entra no cálculo: desmarcado (NAO_APLICAVEL)
  // não ocupa dias nem ganha janela (senão empurrava as datas anteriores).
  const scheduleByItem = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const byCode = new Map(
            Object.entries(row.processes).map(([code, cell]) => [code, cell.status] as const),
          );
          return [
            row.orderItemId,
            computeProcessSchedule(
              row.deliveryDate,
              scheduleProcessesForItem(processes, (code) => byCode.get(code)),
            ),
          ] as const;
        }),
      ),
    [rows, processes],
  );

  const columns = useMemo(() => {
    const orderColumns = [
      helper.accessor((row) => row, {
        id: "order",
        header: () => (
          <Fabrica2ColumnHeader
            label="OF/OS"
            columnId="order_code"
            filters={filters}
            filter={<Fabrica2TextColumnFilter filters={filters} field="orderCode" column="OF/OS" context="OF/OS" />}
          />
        ),
        // O tipo (OF/OS) vive no prefixo do código — sem badge para ganhar largura.
        // O código é o atalho para a tela de detalhes da OF (sub-itens + materiais).
        cell: (info) => (
          <Link
            href={`/pedidos/${info.row.original.orderId}`}
            className="block whitespace-nowrap font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
            title={`${info.row.original.orderType}: ${info.row.original.orderCode} — ver detalhes do pedido`}
            aria-label={`Ver detalhes do pedido ${info.row.original.orderCode}`}
          >
            {info.row.original.orderCode}
          </Link>
        ),
      }),
      helper.accessor("customerName", {
        id: "customer",
        header: () => (
          <Fabrica2ColumnHeader
            label="Cli."
            fullLabel="Cliente"
            filters={filters}
            filter={<Fabrica2TextColumnFilter filters={filters} field="customer" column="Cliente" context="cliente" />}
          />
        ),
        cell: (info) => <span className="block max-w-[120px] truncate">{info.getValue() || "—"}</span>,
      }),
      helper.accessor("family", {
        id: "family",
        header: () => (
          <Fabrica2ColumnHeader label="TP" fullLabel="Tipo" columnId="family" filters={filters} />
        ),
        cell: (info) => <span className="block max-w-[96px] truncate">{info.getValue() || "—"}</span>,
      }),
      helper.accessor("parentItem", {
        id: "parentItem",
        header: () => (
          <Fabrica2ColumnHeader
            label="Item pai"
            columnId="parent_item"
            filters={filters}
            filter={<Fabrica2TextColumnFilter filters={filters} field="parentItem" column="Item pai" context="item pai" />}
          />
        ),
        cell: (info) => <span className="block max-w-[96px] truncate">{info.getValue() || "—"}</span>,
      }),
      helper.accessor("description", {
        id: "description",
        header: () => (
          <Fabrica2ColumnHeader
            label="Desc."
            fullLabel="Descrição"
            columnId="description"
            filters={filters}
            filter={<Fabrica2TextColumnFilter filters={filters} field="description" column="Descrição" context="descrição" />}
          />
        ),
        cell: (info) => (
          <span className="block max-w-[170px] truncate" title={info.getValue()}>
            {truncate(info.getValue(), 45)}
          </span>
        ),
      }),
      helper.accessor("quantity", {
        id: "quantity",
        header: () => (
          <Fabrica2ColumnHeader label="Qtd." columnId="quantity" filters={filters} />
        ),
        cell: (info) => <span className="tabular-nums">{formatQuantity(info.getValue())}</span>,
      }),
      helper.accessor("unitWeightKg", {
        id: "unitWeightKg",
        header: () => (
          <Fabrica2ColumnHeader label="Peso" fullLabel="Peso un." columnId="unit_weight_kg" filters={filters} />
        ),
        cell: (info) => <span className="tabular-nums">{formatWeight(info.getValue())}</span>,
      }),
      helper.accessor("deliveryDate", {
        id: "deliveryDate",
        header: () => (
          <Fabrica2ColumnHeader
            label="Ent."
            fullLabel="Entrega"
            columnId="delivery_date"
            filters={filters}
            filter={<Fabrica2DeliveryFilter filters={filters} />}
          />
        ),
        cell: (info) => <DeliveryCell row={info.row.original} canEdit={capabilities.canEditDelivery} />,
      }),
      helper.accessor("op", {
        id: "op",
        header: () => (
          <Fabrica2ColumnHeader
            label="OP"
            fullLabel="Ordem de Produção"
            columnId="op"
            filters={filters}
          />
        ),
        cell: (info) => (
          <span className="block max-w-[96px] truncate" title={info.getValue() || undefined}>
            {info.getValue() || "—"}
          </span>
        ),
      }),
    ];

    // A cadeia da Fábrica 1 não abre coluna própria (fica oculta) — a
    // MP (matéria-prima), primeira do catálogo, ocupa a primeira coluna.
    const processColumns = processes
      .filter((process) => !(F1_PROCESS_CODES as readonly string[]).includes(process.code))
      .map((process) =>
        helper.accessor((row) => row.processes[process.code] ?? null, {
          id: process.code,
          header: () => (
            <Fabrica2ColumnHeader label={process.code} columnId={process.code} filters={filters} />
          ),
          cell: (info) => {
            const row = info.row.original;
            return (
              <ProcessCellButton
                cell={info.getValue() ?? undefined}
                processName={process.name}
                disabled={!capabilities.canUpdateStatus}
                onSelect={setSelection}
                plan={scheduleByItem.get(row.orderItemId)?.get(process.code) ?? null}
                today={today}
                context={{
                  orderItemId: row.orderItemId,
                  orderCode: row.orderCode,
                  itemDescription: row.description,
                  processCode: process.code,
                  deliveryDate: row.deliveryDate,
                }}
              />
            );
          },
        }),
      );

    return helper.columns([
      helper.group({
        id: "order-data",
        header: () => <Fabrica2OrderGroupHeader />,
        columns: helper.columns(orderColumns),
      }),
      helper.group({
        id: "process-data",
        header: () => (
          <span className="flex items-center justify-center gap-2">
            <span>PROCESSOS</span>
            <Fabrica2ProcessGroupFilter filters={filters} />
          </span>
        ),
        columns: helper.columns(processColumns),
      }),
    ]);
  }, [filters, processes, capabilities.canUpdateStatus, capabilities.canEditDelivery, scheduleByItem, today]);

  const table = useTable({
    features: coreFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.orderItemId,
  });

  if (rows.length === 0) {
    return <EmptyState title="Nenhum item encontrado" description="Ajuste os filtros ou importe uma planilha para começar." />;
  }

  return (
    <>
      {/* Desktop / tablet: tabela com rolagem própria e cabeçalho fixo */}
      <div className="hidden max-h-[calc(100vh-8rem)] overflow-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-[10px]">
          <caption className="sr-only">
            Fábrica 2 — acompanhamento por item, com uma coluna por processo do fluxo fabril.
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
                      aria-sort={
                        isLeaf && filters.sort === header.id
                          ? filters.sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : isLeaf
                            ? "none"
                            : undefined
                      }
                      className={cn(
                        "h-9 whitespace-nowrap px-1.5 text-left align-middle text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
                        // Cabeçalho fixo: as duas linhas grudam no topo da
                        // rolagem da lista (grupo acima, colunas abaixo).
                        "sticky z-30",
                        groupIndex === 0 ? "top-0" : "top-9",
                        // Fundo opaco — senão as linhas aparecem por baixo.
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
              <tr key={row.id} className="border-b transition-colors hover:bg-muted/30">
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
        {rows.map((row) => (
          <article key={row.orderItemId} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1">
                <Badge variant="outline" className="px-1 py-0">
                  {row.orderType}
                </Badge>
                <Link
                  href={`/pedidos/${row.orderId}`}
                  className="font-medium tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary"
                  title={`${row.orderType}: ${row.orderCode} — ver detalhes do pedido`}
                  aria-label={`Ver detalhes do pedido ${row.orderCode}`}
                >
                  {row.orderCode}
                </Link>
              </span>
              <OrderStatusBadge status={row.itemStatus} />
            </header>

            <p className="mt-2 text-sm font-medium">{row.description}</p>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline">Cliente: </dt>
                <dd className="inline text-foreground">{row.customerName || "—"}</dd>
              </div>
              <div>
                <dt className="inline">Entrega: </dt>
                <dd
                  className={cn(
                    "inline",
                    // Mesma regra da tabela: vermelho só com expedição pendente.
                    row.overdue ? "text-status-late" : "text-foreground",
                  )}
                >
                  {capabilities.canEditDelivery ? (
                    <Fabrica2DeliveryDatePopover
                      orderItemId={row.orderItemId}
                      deliveryDate={row.deliveryDate}
                      itemLabel={`${row.orderCode} — ${row.description}`}
                    >
                      <span className="tabular-nums">{formatDate(row.deliveryDate)}</span>
                    </Fabrica2DeliveryDatePopover>
                  ) : (
                    <span className="tabular-nums">{formatDate(row.deliveryDate)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline">Tipo: </dt>
                <dd className="inline text-foreground">{row.family || "—"}</dd>
              </div>
              <div>
                <dt className="inline">Item pai: </dt>
                <dd className="inline text-foreground">{row.parentItem || "—"}</dd>
              </div>
              <div>
                <dt className="inline">Qtd.: </dt>
                <dd className="inline text-foreground tabular-nums">{formatQuantity(row.quantity)}</dd>
              </div>
              <div>
                <dt className="inline">Peso un.: </dt>
                <dd className="inline text-foreground tabular-nums">{formatWeight(row.unitWeightKg)}</dd>
              </div>
              <div>
                <dt className="inline">OP: </dt>
                <dd className="inline text-foreground tabular-nums">{row.op || "—"}</dd>
              </div>
            </dl>

            {row.overdue ? (
              <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-status-late">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Entrega atrasada
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {processes.map((process) => (
                <ProcessCellButton
                  key={process.code}
                  cell={row.processes[process.code]}
                  processName={process.name}
                  disabled={!capabilities.canUpdateStatus}
                  onSelect={setSelection}
                  plan={scheduleByItem.get(row.orderItemId)?.get(process.code) ?? null}
                  today={today}
                  context={{
                    orderItemId: row.orderItemId,
                    orderCode: row.orderCode,
                    itemDescription: row.description,
                    processCode: process.code,
                    deliveryDate: row.deliveryDate,
                  }}
                />
              ))}
            </div>
          </article>
        ))}
      </div>

      <Fabrica2DetailsSheet
        selection={selection}
        processes={processes}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
        capabilities={capabilities}
      />
    </>
  );
}
