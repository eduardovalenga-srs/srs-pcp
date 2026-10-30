"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

import type { RomaneioFilters } from "@/lib/types/romaneio";
import { romaneioFilterChips, romaneioQueryString } from "@/lib/utils/filters";
import { truncate } from "@/lib/utils/formatting";
import {
  DeliveryPeriodPopover,
  TextColumnFilter,
} from "@/components/shared/column-filters";
import { SortLink as SharedSortLink } from "@/components/shared/SortLink";
import { Button } from "@/components/ui/button";

/** Grava um conjunto de filtros da listagem de romaneios na URL e volta para a primeira página. */
function useApplyRomaneioFilters(filters: RomaneioFilters) {
  const router = useRouter();
  const pathname = usePathname();

  return (overrides: Partial<RomaneioFilters>) => {
    const query = romaneioQueryString({ ...filters, ...overrides, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/** Indicador de ordenação da coluna (servidor decide a ordem via URL). */
function RomaneioSortLink({
  label,
  fullName,
  columnId,
  filters,
}: {
  label: string;
  /** Nome completo da coluna (o que o leitor de tela anuncia). */
  fullName: string;
  /** Chave de ordenação da coluna (whitelist da listagem). */
  columnId: string;
  filters: RomaneioFilters;
}) {
  const pathname = usePathname();

  return (
    <SharedSortLink
      label={label}
      fullName={fullName}
      columnId={columnId}
      sort={filters.sort}
      sortDir={filters.sortDir}
      buildHref={(next) => {
        const query = romaneioQueryString({ ...filters, ...next, page: 1 });
        return query ? `${pathname}?${query}` : pathname;
      }}
    />
  );
}

/**
 * Cabeçalho de uma coluna: ordenação (quando existir) + filtro opcional.
 * `label` é o texto visível; `fullLabel` é o nome completo usado no
 * aria-label/tooltip — leitor de tela nunca enxerga abreviação.
 */
export function RomaneioColumnHeader({
  label,
  fullLabel,
  columnId,
  filters,
  filter,
}: {
  label: string;
  fullLabel?: string;
  columnId?: string;
  filters: RomaneioFilters;
  filter?: ReactNode;
}) {
  const fullName = fullLabel ?? label;

  return (
    <span className="flex w-full items-center justify-between gap-1">
      {columnId ? (
        <RomaneioSortLink label={label} fullName={fullName} columnId={columnId} filters={filters} />
      ) : (
        <span className="truncate px-1" title={fullName}>
          <span aria-hidden>{label}</span>
          <span className="sr-only">{fullName}</span>
        </span>
      )}
      {filter}
    </span>
  );
}

/** Colunas de texto com filtro "contém" (valor parcial, sem diferenciar maiúsculas). */
export type RomaneioTextFilterField = "orderCode" | "customer";

interface RomaneioTextFilterProps {
  filters: RomaneioFilters;
  field: RomaneioTextFilterField;
  /** Rótulo da coluna, ex.: "Cliente". */
  column: string;
  /** Contexto do título/aria, ex.: "cliente". */
  context: string;
}

export function RomaneioTextFilter({ filters, field, column, context }: RomaneioTextFilterProps) {
  const apply = useApplyRomaneioFilters(filters);

  return (
    <TextColumnFilter
      value={filters[field]}
      column={column}
      context={context}
      onApply={(value) => apply({ [field]: value } as Partial<RomaneioFilters>)}
    />
  );
}

/** Filtro da coluna Saída — período inclusivo De/Até (lados opcionais). */
export function RomaneioShipmentFilter({ filters }: { filters: RomaneioFilters }) {
  const apply = useApplyRomaneioFilters(filters);
  const active = filters.shipmentFrom !== null || filters.shipmentTo !== null;

  return (
    <DeliveryPeriodPopover
      active={active}
      from={filters.shipmentFrom}
      to={filters.shipmentTo}
      idPrefix="romaneio-coluna-saida"
      context="saída"
      onApply={(from, to) => apply({ shipmentFrom: from, shipmentTo: to })}
    />
  );
}

/**
 * Chips de "filtros ativos" da listagem de romaneios: cada chip remove só
 * o próprio filtro; "Limpar filtros" zera tudo. No mobile a barra de
 * filtros cuida dos campos; os chips cobrem também o que foi aplicado nos
 * cabeçalhos das colunas.
 */
export function RomaneioActiveFilters({ filters }: { filters: RomaneioFilters }) {
  const router = useRouter();
  const pathname = usePathname();

  const chips = romaneioFilterChips(filters);
  if (chips.length === 0) return null;

  const apply = (overrides: Partial<RomaneioFilters>) => {
    const query = romaneioQueryString({ ...filters, ...overrides, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <section aria-label="Filtros ativos" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Filtros ativos:</span>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => apply(chip.clear)}
          aria-label={`Remover filtro: ${chip.label}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{truncate(chip.label, 48)}</span>
          <X className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.replace(pathname, { scroll: false })}
      >
        <X className="h-4 w-4" aria-hidden />
        Limpar filtros
      </Button>
    </section>
  );
}
