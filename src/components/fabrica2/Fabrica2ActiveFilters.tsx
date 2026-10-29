"use client";

import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

import type { ProductionFilters } from "@/lib/types/production";
import { activeFilterChips, productionQueryString } from "@/lib/utils/filters";
import { truncate } from "@/lib/utils/formatting";
import { Button } from "@/components/ui/button";

/**
 * Chips de "filtros ativos" da tela da Fábrica 2 (todas as telas).
 * Cada chip remove só o próprio filtro; "Limpar filtros" zera tudo.
 * No mobile a barra (Fabrica2FiltersBar) cuida dos filtros principais;
 * os chips cobrem também os filtros aplicados nos cabeçalhos das colunas.
 */
export function Fabrica2ActiveFilters({ filters }: { filters: ProductionFilters }) {
  const router = useRouter();
  const pathname = usePathname();

  // A Fábrica 2 usa a data da coluna ACAB no card "Atrasados": o chip
  // compartilhado ("Entrega: Atrasados") ganha o esclarecimento da tela.
  const chips = activeFilterChips(filters).map((chip) =>
    chip.key === "delivery" && filters.delivery === "OVERDUE"
      ? { ...chip, label: "Atrasados (ACAB vencido)" }
      : chip,
  );
  if (chips.length === 0) return null;

  const apply = (overrides: Partial<ProductionFilters>) => {
    const query = productionQueryString({ ...filters, ...overrides, page: 1 });
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

      <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
        <X className="h-4 w-4" aria-hidden />
        Limpar filtros
      </Button>
    </section>
  );
}
