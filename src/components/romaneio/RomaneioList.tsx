"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";

import type { RomaneioFilters, RomaneioSummary } from "@/lib/types/romaneio";
import { romaneioQueryString } from "@/lib/utils/filters";
import { formatDate } from "@/lib/utils/dates";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { SortLink, type SortState } from "@/components/shared/SortLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RomaneioStatusBadge } from "@/components/romaneio/RomaneioStatusBadge";

interface RomaneioListProps {
  romaneios: RomaneioSummary[];
  /** 043: estado de ordenação vigente (URL) — cada header vira SortLink. */
  filters: RomaneioFilters;
}

/** Marcador de saldo de devolução sem NF registrada. */
function ReturnPendingBadge() {
  return (
    <Badge variant="warning" title="Há saldo de devolução de matéria-prima sem NF registrada">
      A devolver
    </Badge>
  );
}

/** Listagem de romaneios: tabela no desktop (lg+) e cards no mobile. */
export function RomaneioList({ romaneios, filters }: RomaneioListProps) {
  const pathname = usePathname();

  // 043: servidor decide a ordem via URL (?ordem=&direcao=) — a lista
  // nunca ordena no client (a paginação é server-side).
  const buildHref = (next: SortState) => {
    const query = romaneioQueryString({ ...filters, ...next, page: 1 });
    return query ? `${pathname}?${query}` : pathname;
  };
  const sortable = (label: string, fullName: string, columnId: string) => (
    <SortLink
      label={label}
      fullName={fullName}
      columnId={columnId}
      sort={filters.sort}
      sortDir={filters.sortDir}
      buildHref={buildHref}
    />
  );
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
            Romaneios de expedição, com OF/OS, cliente, situação, saída, quantidades e números de NF.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("number")}>
                {sortable("Nº", "Número", "number")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("order_code")}>
                {sortable("OF/OS", "OF/OS", "order_code")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("customer")}>
                {sortable("Cliente", "Cliente", "customer")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("status")}>
                {sortable("Situação", "Situação", "status")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("shipment_date")}>
                {sortable("Saída", "Data de saída", "shipment_date")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold" aria-sort={ariaSort("item_count")}>
                {sortable("Itens", "Itens", "item_count")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold" aria-sort={ariaSort("quantity_total")}>
                {sortable("Qtd", "Quantidade expedida", "quantity_total")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold" aria-sort={ariaSort("weight_total")}>
                {sortable("Peso (kg)", "Peso total", "weight_total")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("nf_number")}>
                {sortable("NF saída", "NF de saída", "nf_number")}
              </th>
              <th scope="col" className="px-3 py-2 font-semibold" aria-sort={ariaSort("return_nf_number")}>
                {sortable("NF devolução", "NF de devolução", "return_nf_number")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {romaneios.map((romaneio) => (
              <tr key={romaneio.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-medium tabular-nums">#{romaneio.number}</td>
                <td className="px-3 py-2">
                  <span className="font-medium tabular-nums">{romaneio.orderCode}</span>
                </td>
                <td className="max-w-[220px] px-3 py-2">
                  <span className="block truncate" title={romaneio.customerName ?? undefined}>
                    {romaneio.customerName || "—"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1">
                    <RomaneioStatusBadge status={romaneio.status} />
                    {romaneio.pendingReturn && !romaneio.returnNfNumber ? (
                      <ReturnPendingBadge />
                    ) : null}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatDate(romaneio.shipmentDate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{romaneio.itemCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatQuantity(romaneio.quantityTotal)}
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
                  <div className="flex items-center justify-end">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <Link href={`/romaneio/${romaneio.id}`}>
                        Abrir
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
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
                <dt className="text-xs text-muted-foreground">Itens</dt>
                <dd className="tabular-nums">{romaneio.itemCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Qtd</dt>
                <dd className="tabular-nums">{formatQuantity(romaneio.quantityTotal)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Peso (kg)</dt>
                <dd className="tabular-nums">{formatWeight(romaneio.weightTotal)}</dd>
              </div>
            </dl>

            <footer className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                NF saída: {romaneio.nfNumber || "—"} · NF dev.: {romaneio.returnNfNumber || "—"}
              </p>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href={`/romaneio/${romaneio.id}`}>
                  Abrir
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </footer>
          </li>
        ))}
      </ul>
    </>
  );
}
