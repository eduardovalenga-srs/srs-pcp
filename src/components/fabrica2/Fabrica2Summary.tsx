import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Truck } from "lucide-react";

import type { FilteredKpiTotals, ProductionFilters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

interface Fabrica2SummaryProps {
  /** Nº de registros da lista filtrada — principal número do card "Eventos". */
  total: number;
  /** Soma da coluna "Qtd." da lista filtrada inteira — de todas as páginas (018). */
  qtyTotal: number;
  /** Peso total (kg) da lista filtrada inteira — soma da coluna "Peso". */
  weightTotal: number;
  filters: ProductionFilters;
  /**
   * 041: itens atrasados (entrega vencida + EXPEDIÇÃO pendente) do
   * conjunto FILTRADO — o card deixou de ser global (get_production_stats).
   */
  overdue: FilteredKpiTotals;
  /** 041: itens com EXPEDIÇÃO concluída do conjunto filtrado — também filtrado. */
  expedition: FilteredKpiTotals;
}

interface Chip {
  key: string;
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: "danger" | "warning" | "success" | "muted";
  /** Três números lado a lado (Registros, Qtd. total, Peso total). */
  details: { label: string; value: string }[];
  /** Card clicável: filtro aplicado ao clicar (os demais filtros são mantidos). */
  filter?: Partial<ProductionFilters>;
  /** true quando o filtro deste chip já está ativo. */
  active?: boolean;
}

/** Resumo com contagens + atalhos de filtro da Fábrica 2 — somente os totais. */
export function Fabrica2Summary({
  total,
  qtyTotal,
  weightTotal,
  filters,
  overdue,
  expedition,
}: Fabrica2SummaryProps) {
  const chips: Chip[] = [
    {
      key: "events",
      label: "Eventos",
      value: total,
      icon: <Inbox className="h-4 w-4" aria-hidden />,
      details: [
        { label: "Registros", value: formatQuantity(total) },
        { label: "Qtd. total", value: formatQuantity(qtyTotal) },
        { label: "Peso total", value: `${formatWeight(weightTotal)} kg` },
      ],
    },
    {
      // 041: itens atrasados do conjunto FILTRADO (a linha da tabela é o
      // item, então "Registros" bate com a contagem por item).
      key: "overdue",
      label: "Atrasados",
      value: overdue.records,
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      tone: "danger",
      filter: { delivery: "OVERDUE" },
      active: filters.delivery === "OVERDUE",
      details: [
        { label: "Registros", value: formatQuantity(overdue.records) },
        { label: "Qtd. total", value: formatQuantity(overdue.qty) },
        { label: "Peso total", value: `${formatWeight(overdue.weight)} kg` },
      ],
    },
    {
      // 041: itens com EXPEDIÇÃO concluída do conjunto filtrado.
      key: "expedition",
      label: "Expedição",
      value: formatQuantity(expedition.records),
      icon: <Truck className="h-4 w-4" aria-hidden />,
      tone: "success",
      filter: { processCode: "EXP", processStatus: "CONCLUIDO" },
      active: filters.processCode === "EXP" && filters.processStatus === "CONCLUIDO",
      details: [
        { label: "Registros", value: formatQuantity(expedition.records) },
        { label: "Qtd. total", value: formatQuantity(expedition.qty) },
        { label: "Peso total", value: `${formatWeight(expedition.weight)} kg` },
      ],
    },
  ];

  return (
    <section aria-label="Resumo da Fábrica 2" className="grid grid-cols-2 gap-2 xl:grid-cols-6">
      {chips.map((chip) => {
        const title = (
          <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {chip.icon}
            <span className="truncate">{chip.label}</span>
          </span>
        );
        // Os três números lado a lado: Registros, Qtd. total e Peso total.
        const body = (
          <div className="grid grid-cols-3 gap-2">
            {chip.details.map((detail) => (
              <div key={detail.label} className="min-w-0">
                <span className="block truncate text-[11px] text-muted-foreground">{detail.label}</span>
                <span className="block truncate text-lg font-semibold tabular-nums">{detail.value}</span>
              </div>
            ))}
          </div>
        );
        const content = (
          <>
            {title}
            {body}
          </>
        );
        const className = cn(
          "flex h-full flex-col gap-1 rounded border bg-card px-3 py-2 transition-colors col-span-2",
          chip.tone === "danger" && "border-status-late/50 text-status-late",
          chip.tone === "warning" && "border-status-progress/50",
          chip.tone === "success" && "border-status-done/50",
          chip.filter !== undefined && "hover:border-border hover:bg-accent/40",
          chip.active && "border-primary bg-primary/5",
        );

        if (chip.filter === undefined) {
          return (
            <div key={chip.key} className={className}>
              {content}
            </div>
          );
        }

        const next: ProductionFilters = { ...filters, ...chip.filter, page: 1 };
        const query = productionQueryString(next);
        return (
          <Link
            key={chip.key}
            href={query ? `/fabrica-2?${query}` : "/fabrica-2"}
            aria-label={`${chip.label}: ${chip.value} — aplicar filtro`}
            aria-current={chip.active ? "true" : undefined}
            className={className}
          >
            {content}
          </Link>
        );
      })}
    </section>
  );
}
