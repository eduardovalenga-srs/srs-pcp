"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { coreFeatures, createColumnHelper, flexRender, useTable, type CoreFeatures } from "@tanstack/react-table";

import type {
  OrderProcessCell,
  ProcessDefinition,
  ProductionFilters,
  ProductionOrderRow,
} from "@/lib/types/production";
import { MP_PROCESS_CODE } from "@/lib/constants/processes";
import { PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS, type ProcessStatus } from "@/lib/constants/production";
import { formatBusinessDate, formatBusinessDayMonth, formatDate, formatDayMonth } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
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
  ColumnHeader,
  DeliveryFilter,
  OrderGroupHeader,
  ProcessGroupFilter,
  TextColumnFilter,
} from "@/components/producao/ColumnHeaders";
import { DeliveryDatePopover } from "@/components/producao/DeliveryDatePopover";
import {
  ProcessBatchEditor,
  type ProcessBatchSelection,
} from "@/components/producao/ProcessBatchEditor";

/** Permissões que a visão consolidada enxerga (025). */
export interface ProductionCapabilities {
  canUpdateStatus: boolean;
  /** Edição da entrega do PEDIDO (orders.edit) — recalcula as previsões. */
  canEditDelivery: boolean;
}

interface ProductionTableProps {
  rows: ProductionOrderRow[];
  processes: ProcessDefinition[];
  filters: ProductionFilters;
  capabilities: ProductionCapabilities;
  /** Data de referência (AAAA-MM-DD) — datas anteriores a ela ficam em vermelho. */
  today: string;
}

const helper = createColumnHelper<CoreFeatures, ProductionOrderRow>();

function DeliveryCell({ row, canEdit }: { row: ProductionOrderRow; canEdit: boolean }) {
  // REGRA DE ATRASO: vermelho somente com entrega vencida E expedição pendente.
  const content = (
    <span className={cn("whitespace-nowrap tabular-nums", row.overdue && "text-status-late")}>
      {formatDate(row.deliveryDate)}
    </span>
  );

  // Edição manual da entrega do PEDIDO (ADMIN/GESTOR): a gravação dispara
  // o refresh e as previsões de todos os processos são recalculadas.
  if (!canEdit) return content;
  return (
    <DeliveryDatePopover
      orderId={row.orderId}
      deliveryDate={row.deliveryDate}
      orderLabel={`${row.orderType} ${row.orderCode}`}
    >
      {content}
    </DeliveryDatePopover>
  );
}

interface ProcessCellButtonProps {
  cell: OrderProcessCell | undefined;
  processName: string;
  disabled: boolean;
  onSelect: (selection: ProcessBatchSelection) => void;
  /** Janela prevista de execução (dias úteis contados de trás para frente da entrega). */
  plan: ProcessWindow | null;
  /** Data de referência (AAAA-MM-DD) — início anterior a ela fica em vermelho. */
  today: string;
  context: {
    orderId: string;
    orderCode: string;
    processCode: string;
    deliveryDate: string | null;
  };
}

function ProcessCellButton({ cell, processName, disabled, onSelect, plan, today, context }: ProcessCellButtonProps) {
  // 0 itens aplicáveis na OF => "—" (nunca editável): o lote não recria um
  // processo que o pedido desmarcou.
  if (!cell || cell.applicable === 0) {
    return (
      <span
        className="inline-flex h-8 w-full items-center justify-center rounded border border-dashed text-muted-foreground"
        title={`${processName}: não aplicável nesta OF`}
        aria-label={`${processName}: não aplicável nesta OF`}
      >
        <span aria-hidden>—</span>
      </span>
    );
  }

  const label = PROCESS_STATUS_LABELS[cell.status];
  // Contador "feito/aplicável" (ex.: 3/5) — a situação exibida é a pior.
  const counter = `${cell.done}/${cell.applicable}`;
  // Soma das quantidades dos itens, só no tooltip (a coluna é compacta).
  const quantities =
    cell.quantityPlanned !== null || cell.quantityCompleted !== null
      ? `${formatQuantity(cell.quantityCompleted ?? 0)}/${formatQuantity(cell.quantityPlanned ?? 0)}`
      : null;
  // Início previsto em dd/MM — otimiza a largura da coluna (sem scroll lateral).
  const plannedDay = plan ? formatDayMonth(plan.start) : null;
  // Início vencido (anterior à data de referência) → fonte vermelha;
  // processo CONCLUIDO nunca fica vermelho (regra em utils/production).
  const plannedDayPast = isProcessStartOverdue(plan?.start ?? null, cell.status, today);
  // 031: MP concluído — a data efetiva do recebimento, exibida ACIMA da prevista.
  const receivedDay =
    context.processCode === MP_PROCESS_CODE && cell.status === "CONCLUIDO" && cell.completedAt
      ? formatBusinessDayMonth(cell.completedAt)
      : null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onSelect({
          orderId: context.orderId,
          orderCode: context.orderCode,
          processName,
          processCode: context.processCode,
          cell,
        })
      }
      className={cn(
        "inline-flex h-8 w-full flex-col items-center justify-center rounded border px-1 text-[10px] font-semibold leading-none transition-colors",
        // 3 linhas (símbolo + recebida + prevista) cabem no h-8 sem folga.
        receivedDay && plannedDay ? "gap-0" : "gap-0.5",
        "hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70",
        statusClass(cell.status),
      )}
      title={`${processName} — ${context.orderCode}: ${label} em ${counter} ${cell.applicable === 1 ? "item" : "itens"}${quantities ? ` · quantidades somadas ${quantities}` : ""}${plan ? ` · previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}${receivedDay ? ` · recebida em ${formatBusinessDate(cell.completedAt)}` : ""}. Clique para aplicar a situação a toda a OF.`}
      aria-label={`${processName} de ${context.orderCode}: ${label} em ${cell.done} de ${cell.applicable} itens${plan ? `, previsto de ${formatDate(plan.start)} a ${formatDate(plan.end)}` : ""}${receivedDay ? `, recebida em ${formatBusinessDate(cell.completedAt)}` : ""}`}
    >
      <span className="inline-flex items-center gap-1">
        <span aria-hidden>{PROCESS_STATUS_SYMBOLS[cell.status]}</span>
        <span className="tabular-nums">{counter}</span>
      </span>
      {/* 031: MP concluído — a data efetiva do recebimento ACIMA da prevista. */}
      {receivedDay ? <span className="tabular-nums text-[10px]">{receivedDay}</span> : null}
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
    case "NAO_APLICAVEL":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

/**
 * Tabela da gestão de entregas CONSOLIDADA por OF (025) — desktop + cards
 * (mobile). Uma linha por pedido: quantidades/pesos somados e TODAS as
 * etapas do catálogo em colunas próprias (inclusive a cadeia da Fábrica 1,
 * que no servidor lê os itens filhos). Clicar numa célula abre a edição
 * EM LOTE (ProcessBatchEditor), que aplica a situação a toda a OF.
 */
export function ProductionTable({ rows, processes, filters, capabilities, today }: ProductionTableProps) {
  const [selection, setSelection] = useState<ProcessBatchSelection | null>(null);

  // Datas previstas por OF: janela de cada processo contada da entrega do
  // PEDIDO. A pior situação agregada entra no cálculo; processo sem itens
  // aplicáveis (NAO_APLICAVEL) não ocupa dias nem ganha janela.
  const scheduleByOrder = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const statusByCode = new Map(
            Object.entries(row.processes).map(
              ([code, cell]) => [code, cell.applicable > 0 ? cell.status : "NAO_APLICAVEL"] as const,
            ),
          );
          return [
            row.orderId,
            computeProcessSchedule(
              row.deliveryDate,
              scheduleProcessesForItem(processes, (code) => statusByCode.get(code)),
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
          <ColumnHeader
            label="OF/OS"
            columnId="order_code"
            filters={filters}
            filter={<TextColumnFilter filters={filters} field="orderCode" column="OF/OS" context="OF/OS" />}
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
          <ColumnHeader
            label="Cli."
            fullLabel="Cliente"
            columnId="customer"
            filters={filters}
            filter={<TextColumnFilter filters={filters} field="customer" column="Cliente" context="cliente" />}
          />
        ),
        cell: (info) => <span className="block max-w-[120px] truncate">{info.getValue() || "—"}</span>,
      }),
      helper.accessor("quantity", {
        id: "quantity",
        header: () => (
          <ColumnHeader label="Qtd." fullLabel="Qtd. total" columnId="quantity" filters={filters} />
        ),
        cell: (info) => <span className="tabular-nums">{formatQuantity(info.getValue())}</span>,
      }),
      helper.accessor("weightTotal", {
        id: "weightTotal",
        header: () => (
          <ColumnHeader label="Peso" fullLabel="Peso total" columnId="weight_total" filters={filters} />
        ),
        cell: (info) => <span className="tabular-nums">{formatWeight(info.getValue())}</span>,
      }),
      helper.accessor("deliveryDate", {
        id: "deliveryDate",
        header: () => (
          <ColumnHeader
            label="Ent."
            fullLabel="Entrega"
            columnId="delivery_date"
            filters={filters}
            filter={<DeliveryFilter filters={filters} />}
          />
        ),
        cell: (info) => <DeliveryCell row={info.row.original} canEdit={capabilities.canEditDelivery} />,
      }),
    ];

    // 025: TODAS as etapas do catálogo abrem coluna — inclusive a cadeia da
    // Fábrica 1 (LASER…FICEP), que antes ficava oculta nesta tela e agora é
    // agregada a partir dos itens filhos no servidor.
    const processColumns = processes.map((process) =>
      helper.accessor((row) => row.processes[process.code] ?? null, {
        id: process.code,
        header: () => (
          <ColumnHeader label={process.code} columnId={process.code} filters={filters} />
        ),
        cell: (info) => {
          const row = info.row.original;
          return (
            <ProcessCellButton
              cell={info.getValue() ?? undefined}
              processName={process.name}
              disabled={!capabilities.canUpdateStatus}
              onSelect={setSelection}
              plan={scheduleByOrder.get(row.orderId)?.get(process.code) ?? null}
              today={today}
              context={{
                orderId: row.orderId,
                orderCode: row.orderCode,
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
        header: () => <OrderGroupHeader />,
        columns: helper.columns(orderColumns),
      }),
      helper.group({
        id: "process-data",
        header: () => (
          <span className="flex items-center justify-center gap-2">
            <span>PROCESSOS</span>
            <ProcessGroupFilter filters={filters} />
          </span>
        ),
        columns: helper.columns(processColumns),
      }),
    ]);
  }, [filters, processes, capabilities.canUpdateStatus, capabilities.canEditDelivery, scheduleByOrder, today]);

  const table = useTable({
    features: coreFeatures,
    columns,
    data: rows,
    getRowId: (row) => row.orderId,
  });

  if (rows.length === 0) {
    return <EmptyState title="Nenhuma OF encontrada" description="Ajuste os filtros ou importe uma planilha para começar." />;
  }

  return (
    <>
      {/* Desktop / tablet: tabela com rolagem própria e cabeçalho fixo */}
      <div className="hidden max-h-[calc(100vh-8rem)] overflow-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-[10px]">
          <caption className="sr-only">
            Gestão de OF consolidada por OF — uma linha por pedido, com uma coluna por processo.
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
          <article key={row.orderId} className="rounded border bg-card p-3">
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
              <OrderStatusBadge status={row.orderStatus} />
            </header>

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
                    <DeliveryDatePopover
                      orderId={row.orderId}
                      deliveryDate={row.deliveryDate}
                      orderLabel={`${row.orderType} ${row.orderCode}`}
                    >
                      <span className="tabular-nums">{formatDate(row.deliveryDate)}</span>
                    </DeliveryDatePopover>
                  ) : (
                    <span className="tabular-nums">{formatDate(row.deliveryDate)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="inline">Qtd. total: </dt>
                <dd className="inline text-foreground tabular-nums">{formatQuantity(row.quantity)}</dd>
              </div>
              <div>
                <dt className="inline">Peso total: </dt>
                <dd className="inline text-foreground tabular-nums">{formatWeight(row.weightTotal)}</dd>
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
                  plan={scheduleByOrder.get(row.orderId)?.get(process.code) ?? null}
                  today={today}
                  context={{
                    orderId: row.orderId,
                    orderCode: row.orderCode,
                    processCode: process.code,
                    deliveryDate: row.deliveryDate,
                  }}
                />
              ))}
            </div>
          </article>
        ))}
      </div>

      {/* Edição em lote (025): a situação escolhida vale para toda a OF. */}
      <ProcessBatchEditor
        selection={selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null);
        }}
      />
    </>
  );
}
