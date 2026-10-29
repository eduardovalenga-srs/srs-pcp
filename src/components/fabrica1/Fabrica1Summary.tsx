import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox, Truck } from "lucide-react";

import type { KitOverdueTotals } from "@/lib/utils/child-item-groups";
import type { ChildItemFilters } from "@/lib/types/order";
import { childItemQueryString } from "@/lib/utils/filters";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

interface Fabrica1SummaryProps {
  /** Nº de LINHAS (grupos por código de filho) do conjunto filtrado. */
  total: number;
  /** Soma da coluna "Qtd." do conjunto filtrado inteiro (todas as páginas). */
  qtyTotal: number;
  /** Peso total (kg) do conjunto filtrado — Σ (qtd × peso unit.). */
  weightTotal: number;
  /**
   * Regra do KIT: card "Atrasados" — grupos do CONJUNTO FILTRADO INTEIRO (todas as
   * páginas) com a data da coluna KIT (início previsto da janela) anterior
   * à data de referência, com o KIT ainda não concluído. Conta em GRUPOS,
   * como o card "Eventos" — não são mais os KPIs globais de item raiz da
   * RPC `get_production_stats` (entrega da OF), usados antes nesta tela.
   */
  kitOverdue: KitOverdueTotals;
  /**
   * 037: KPI global de item RAIZ (mesmo `get_production_stats` da Fábrica 2
   * e da Gestão) para o card "KIT" — a EXPEDIÇÃO pertence ao item RAIZ (os
   * filhos, cadeia LASER…FICEP, não têm expedição própria). Continua
   * GLOBAL (não respeita os filtros desta tela).
   */
  expedition?: { count: number; qty: number; weight: number };
  /** Filtros ativos da tela Fábrica 1 — alimentam os cards clicáveis. */
  filters: ChildItemFilters;
}

interface Card {
  key: string;
  label: string;
  icon: ReactNode;
  tone?: "danger" | "success";
  /** Três números lado a lado (Registros, Qtd. total, Peso total). */
  details: { label: string; value: string }[];
  /** Card clicável: filtro aplicado ao clicar (os demais filtros são mantidos). */
  filter?: Partial<ChildItemFilters>;
  /** true quando o filtro deste card já está ativo. */
  active?: boolean;
}

/**
 * Resumo da Fábrica 1 — três cards no mesmo modelo da Fábrica 2: "Eventos"
 * e "Atrasados" com o conjunto FILTRADO inteiro (contagem de grupos; o
 * atraso é a regra da coluna KIT) e "KIT" com o KPI global de item raiz.
 * Somente os totais, sem quebra por família.
 *
 * Cards clicáveis (mesmo modelo da Fábrica 2 / Gestão): o card "KIT" aplica
 * o filtro de expedição concluída (EXP/CONCLUIDO) sobre a tela — o card
 * "Atrasados" já exibe o recorte de grupos com o KIT vencido sobre o
 * conjunto filtrado.
 */
export function Fabrica1Summary({
  total,
  qtyTotal,
  weightTotal,
  kitOverdue,
  expedition,
  filters,
}: Fabrica1SummaryProps) {
  const cards: Card[] = [
    {
      key: "events",
      label: "Eventos",
      icon: <Inbox className="h-4 w-4" aria-hidden />,
      details: [
        { label: "Registros", value: formatQuantity(total) },
        { label: "Qtd. total", value: formatQuantity(qtyTotal) },
        { label: "Peso total", value: `${formatWeight(weightTotal)} kg` },
      ],
    },
    {
      // Atraso pela coluna KIT (início previsto da janela < hoje, KIT
      // não concluído) sobre o CONJUNTO FILTRADO inteiro — não é mais o KPI
      // global de item raiz baseado na entrega da OF.
      key: "overdue",
      label: "Atrasados",
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      tone: "danger",
      details: [
        { label: "Registros", value: formatQuantity(kitOverdue.records) },
        { label: "Qtd. total", value: formatQuantity(kitOverdue.qty) },
        { label: "Peso total", value: `${formatWeight(kitOverdue.weight)} kg` },
      ],
    },
    // 037: no modelo da Fábrica 1 o card da EXPEDIÇÃO do item raiz é o KIT.
    {
      key: "kit",
      label: "KIT",
      icon: <Truck className="h-4 w-4" aria-hidden />,
      tone: "success",
      filter: { processCode: "EXP", processStatus: "CONCLUIDO" },
      active: filters.processCode === "EXP" && filters.processStatus === "CONCLUIDO",
      details: [
        { label: "Registros", value: formatQuantity(expedition?.count) },
        { label: "Qtd. total", value: formatQuantity(expedition?.qty) },
        { label: "Peso total", value: `${formatWeight(expedition?.weight)} kg` },
      ],
    },
  ];

  return (
    <section aria-label="Resumo da Fábrica 1" className="grid grid-cols-2 gap-2 xl:grid-cols-6">
      {cards.map((card) => {
        const title = (
          <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.icon}
            <span className="truncate">{card.label}</span>
          </span>
        );
        // Os três números lado a lado: Registros, Qtd. total e Peso total.
        const body = (
          <div className="grid grid-cols-3 gap-2">
            {card.details.map((detail) => (
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
          card.tone === "danger" && "border-status-late/50 text-status-late",
          card.tone === "success" && "border-status-done/50",
          card.filter !== undefined && "hover:border-border hover:bg-accent/40",
          card.active && "border-primary bg-primary/5",
        );

        if (card.filter === undefined) {
          return (
            <div key={card.key} className={className}>
              {content}
            </div>
          );
        }

        const next: ChildItemFilters = { ...filters, ...card.filter, page: 1 };
        const query = childItemQueryString(next);
        return (
          <Link
            key={card.key}
            href={query ? `/fabrica-1?${query}` : "/fabrica-1"}
            aria-label={`${card.label}: ${card.details[0].value} — aplicar filtro`}
            aria-current={card.active ? "true" : undefined}
            className={className}
          >
            {content}
          </Link>
        );
      })}
    </section>
  );
}
