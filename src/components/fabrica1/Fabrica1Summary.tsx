import { Inbox } from "lucide-react";

import { formatQuantity, formatWeight } from "@/lib/utils/formatting";

interface Fabrica1SummaryProps {
  /** Nº de LINHAS (grupos por código de filho) do conjunto filtrado. */
  total: number;
  /** Soma da coluna "Qtd." do conjunto filtrado inteiro (todas as páginas). */
  qtyTotal: number;
  /** Peso total (kg) do conjunto filtrado — Σ (qtd × peso unit.). */
  weightTotal: number;
}

/**
 * Card "Eventos" no mesmo modelo da gestão de entregas: três números lado
 * a lado (Registros, Qtd. total e Peso total) do conjunto filtrado.
 */
export function Fabrica1Summary({ total, qtyTotal, weightTotal }: Fabrica1SummaryProps) {
  const details = [
    { label: "Registros", value: formatQuantity(total) },
    { label: "Qtd. total", value: formatQuantity(qtyTotal) },
    { label: "Peso total", value: `${formatWeight(weightTotal)} kg` },
  ];

  return (
    <section aria-label="Resumo da Fábrica 1" className="rounded border bg-card px-3 py-2">
      <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Inbox className="h-4 w-4" aria-hidden />
        <span>Eventos</span>
      </span>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {details.map((detail) => (
          <div key={detail.label} className="min-w-0">
            <span className="block truncate text-[11px] text-muted-foreground">{detail.label}</span>
            <span className="block truncate text-lg font-semibold tabular-nums">{detail.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
