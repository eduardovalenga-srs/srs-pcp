import { Inbox } from "lucide-react";

import type { FilteredKpiTotals, ProductionFilters } from "@/lib/types/production";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Fabrica2FilteredCards } from "@/components/fabrica2/Fabrica2FilteredCards";

interface Fabrica2SummaryProps {
  /** Nº de registros da lista filtrada — principal número do card "Eventos". */
  total: number;
  /** Soma da coluna "Qtd." da lista filtrada inteira — de todas as páginas (018). */
  qtyTotal: number;
  /** Peso total (kg) da lista filtrada inteira — soma da coluna "Peso". */
  weightTotal: number;
  filters: ProductionFilters;
  /**
   * Itens atrasados do conjunto FILTRADO — na Fábrica 2 a data da coluna
   * ACAB (acabamento) anterior a hoje e o processo ainda não concluído.
   */
  overdue: FilteredKpiTotals | null;
  /** 065: itens com ACABAMENTO (ACAB) concluído do conjunto filtrado. */
  acabamento: FilteredKpiTotals | null;
}

/** Resumo da Fábrica 2; os cards calculados por varredura carregam em segundo plano. */
export function Fabrica2Summary({
  total,
  qtyTotal,
  weightTotal,
  filters,
  overdue,
  acabamento,
}: Fabrica2SummaryProps) {
  return (
    <section aria-label="Resumo da Fábrica 2" className="grid grid-cols-2 gap-2 xl:grid-cols-6">
      <div className="flex h-full flex-col gap-1 rounded border bg-card px-3 py-2 col-span-2">
        <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden />
          <span className="truncate">Eventos</span>
        </span>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Registros", value: formatQuantity(total) },
            { label: "Qtd. total", value: formatQuantity(qtyTotal) },
            { label: "Peso total", value: `${formatWeight(weightTotal)} kg` },
          ].map((detail) => (
            <div key={detail.label} className="min-w-0">
              <span className="block truncate text-[11px] text-muted-foreground">{detail.label}</span>
              <span className="block truncate text-lg font-semibold tabular-nums">{detail.value}</span>
            </div>
          ))}
        </div>
      </div>
      <Fabrica2FilteredCards filters={filters} overdue={overdue} acabamento={acabamento} />
    </section>
  );
}
