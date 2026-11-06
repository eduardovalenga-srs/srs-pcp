"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, FileText, Send } from "lucide-react";

import type { RomaneioFilters, RomaneioSummary } from "@/lib/types/romaneio";
import { formatDate } from "@/lib/utils/dates";
import { formatWeight } from "@/lib/utils/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RomaneioStatusBadge } from "@/components/romaneio/RomaneioStatusBadge";
import {
  RomaneioEmissionDialog,
  type RomaneioNfDialogMode,
} from "@/components/romaneio/RomaneioEmissionDialog";
import {
  RomaneioColumnHeader,
  RomaneioNumberFilter,
  RomaneioShipmentFilter,
  RomaneioStatusFilter,
  RomaneioTextFilter,
  RomaneioWeightFilter,
} from "@/components/romaneio/RomaneioColumnHeaders";

interface RomaneioListProps {
  romaneios: RomaneioSummary[];
  /** Filtros vigentes (URL) — cada cabeçalho ordena e filtra a coluna. */
  filters: RomaneioFilters;
  /**
   * O perfil edita romaneios (capacidade `romaneio.edit`) — gate das
   * ações de emissão de NF (Conferência/Abrir continuam para leitura).
   */
  canEdit: boolean;
}

/** Marcador de saldo de devolução sem NF registrada. */
function ReturnPendingBadge() {
  return (
    <Badge variant="warning" title="Há saldo de devolução de matéria-prima sem NF registrada">
      A devolver
    </Badge>
  );
}

/**
 * Ações da linha (desktop e mobile): **Conferência → Emitir NF → Abrir**.
 * A ordem espelha o fluxo — a conferência sempre precede a emissão; o
 * botão de emissão só aparece em CONFERIDO (e editar NFs em CONFIRMADO),
 * e só com a capacidade `romaneio.edit`.
 */
function RowActions({
  romaneio,
  canEdit,
  onEmit,
}: {
  romaneio: RomaneioSummary;
  canEdit: boolean;
  onEmit: (romaneio: RomaneioSummary, mode: RomaneioNfDialogMode) => void;
}) {
  return (
    <>
      {romaneio.status !== "CANCELADO" ? (
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link
            href={`/romaneio/${romaneio.id}/conferencia`}
            title="Folha de conferência da carga (imprimível)"
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden />
            Conferência
          </Link>
        </Button>
      ) : null}
      {canEdit && romaneio.status === "CONFERIDO" ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => onEmit(romaneio, "emit")}
          title="Registrar as NFs e emitir o romaneio (baixa na pendência da OF)"
        >
          <Send className="h-4 w-4" aria-hidden />
          Emitir NF
        </Button>
      ) : null}
      {canEdit && romaneio.status === "CONFIRMADO" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onEmit(romaneio, "edit")}
          title="Ajustar os números da nota de industrialização e da NF de devolução"
        >
          <FileText className="h-4 w-4" aria-hidden />
          NFs
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" asChild>
        <Link href={`/romaneio/${romaneio.id}`}>
          Abrir
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </>
  );
}

/** Listagem de romaneios: tabela no desktop (lg+) e cards no mobile. */
export function RomaneioList({ romaneios, filters, canEdit }: RomaneioListProps) {
  // Diálogo de emissão/edição de NF — montado só enquanto aberto.
  const [nfDialog, setNfDialog] = useState<{
    romaneio: RomaneioSummary;
    mode: RomaneioNfDialogMode;
  } | null>(null);
  // 043: servidor decide a ordem via URL (?ordem=&direcao=) — a lista
  // nunca ordena no client (a paginação é server-side). Todos os
  // cabeçalhos combinam ordenação + filtro no mesmo espaço (Romaneio
  // ColumnHeader), padrão das demais telas de lista.
  const ariaSort = (columnId: string): "ascending" | "descending" | undefined =>
    filters.sort === columnId
      ? filters.sortDir === "asc"
        ? "ascending"
        : "descending"
      : undefined;

  return (
    <>
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Romaneios de expedição, com número, situação, OF/OS, cliente, data de saída, peso e
            números de NF — cada coluna é ordenável e filtrável.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("number")}>
                <RomaneioColumnHeader
                  label="Nº"
                  fullLabel="Número"
                  columnId="number"
                  filters={filters}
                  filter={<RomaneioNumberFilter filters={filters} />}
                />
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("status")}>
                <RomaneioColumnHeader
                  label="Situação"
                  columnId="status"
                  filters={filters}
                  filter={<RomaneioStatusFilter filters={filters} />}
                />
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("order_code")}>
                <RomaneioColumnHeader
                  label="OF/OS"
                  columnId="order_code"
                  filters={filters}
                  filter={
                    <RomaneioTextFilter
                      filters={filters}
                      field="orderCode"
                      column="OF/OS"
                      context="OF/OS"
                    />
                  }
                />
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("customer")}>
                <RomaneioColumnHeader
                  label="Cliente"
                  columnId="customer"
                  filters={filters}
                  filter={
                    <RomaneioTextFilter
                      filters={filters}
                      field="customer"
                      column="Cliente"
                      context="cliente"
                    />
                  }
                />
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("shipment_date")}>
                <RomaneioColumnHeader
                  label="Saída"
                  fullLabel="Data de saída"
                  columnId="shipment_date"
                  filters={filters}
                  filter={<RomaneioShipmentFilter filters={filters} />}
                />
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold" aria-sort={ariaSort("weight_total")}>
                <RomaneioColumnHeader
                  label="Peso (kg)"
                  fullLabel="Peso total"
                  columnId="weight_total"
                  filters={filters}
                  filter={<RomaneioWeightFilter filters={filters} />}
                />
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("nf_number")}>
                <RomaneioColumnHeader
                  label="NF ind."
                  fullLabel="Nota de industrialização"
                  columnId="nf_number"
                  filters={filters}
                  filter={
                    <RomaneioTextFilter
                      filters={filters}
                      field="nfNumber"
                      column="Nota de industrialização"
                      context="Nota de industrialização"
                    />
                  }
                />
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("return_nf_number")}>
                <RomaneioColumnHeader
                  label="NF devolução"
                  fullLabel="NF de devolução"
                  columnId="return_nf_number"
                  filters={filters}
                  filter={
                    <RomaneioTextFilter
                      filters={filters}
                      field="returnNfNumber"
                      column="NF devolução"
                      context="NF de devolução"
                    />
                  }
                />
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {romaneios.map((romaneio) => (
              <tr key={romaneio.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <span className="font-medium tabular-nums">#{romaneio.number}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    <RomaneioStatusBadge status={romaneio.status} />
                    {romaneio.pendingReturn && !romaneio.returnNfNumber ? (
                      <ReturnPendingBadge />
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="font-medium tabular-nums">{romaneio.orderCode}</span>
                </td>
                <td className="max-w-[220px] px-3 py-2">
                  <span className="block truncate" title={romaneio.customerName ?? undefined}>
                    {romaneio.customerName || "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatDate(romaneio.shipmentDate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatWeight(romaneio.weightTotal)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {romaneio.nfNumber || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {romaneio.returnNfNumber || "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <RowActions
                      romaneio={romaneio}
                      canEdit={canEdit}
                      onEmit={(target, mode) => setNfDialog({ romaneio: target, mode })}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {romaneios.map((romaneio) => (
          <li key={romaneio.id} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium tabular-nums">#{romaneio.number}</span>
                <span className="truncate text-sm text-muted-foreground">{romaneio.orderCode}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <RomaneioStatusBadge status={romaneio.status} />
                {romaneio.pendingReturn && !romaneio.returnNfNumber ? (
                  <ReturnPendingBadge />
                ) : null}
              </span>
            </header>

            <p className="mt-1 truncate text-sm text-muted-foreground">
              {romaneio.customerName || "Cliente não informado"}
            </p>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Saída</dt>
                <dd className="tabular-nums">{formatDate(romaneio.shipmentDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Peso (kg)</dt>
                <dd className="tabular-nums">{formatWeight(romaneio.weightTotal)}</dd>
              </div>
            </dl>

            <footer className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                NF ind.: {romaneio.nfNumber || "—"} · NF dev.: {romaneio.returnNfNumber || "—"}
              </p>
              <span className="flex items-center gap-1.5">
                <RowActions
                  romaneio={romaneio}
                  canEdit={canEdit}
                  onEmit={(target, mode) => setNfDialog({ romaneio: target, mode })}
                />
              </span>
            </footer>
          </li>
        ))}
      </ul>

      {/* Emissão/edição de NF — o caminho único da baixa e dos números. */}
      {nfDialog ? (
        <RomaneioEmissionDialog
          romaneio={nfDialog.romaneio}
          mode={nfDialog.mode}
          onOpenChange={(open) => {
            if (!open) setNfDialog(null);
          }}
        />
      ) : null}
    </>
  );
}
