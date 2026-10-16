import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Truck } from "lucide-react";

import { FamilyTotalsList } from "@/components/shared/FamilyTotalsList";
import type { FamilyTotal, ProductionFilters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

interface ProductionSummaryProps {
  /** Nº de OFs da lista filtrada — principal número do card "OFs". */
  total: number;
  /** Soma das quantidades (itens raiz) da lista filtrada — de todas as páginas (018). */
  qtyTotal: number;
  /** Peso total (kg) da lista filtrada inteira — soma da coluna "Peso total". */
  weightTotal: number;
  /** 037: quebra por família do MESMO conjunto dos três números (card "OFs"). */
  familyTotals: FamilyTotal[];
  filters: ProductionFilters;
  /**
   * KPIs globais de entrega (019 soma peças e peso do MESMO conjunto de atraso).
   * Atenção: estes cards vêm do get_production_stats e contam ITENS, não OFs.
   */
  delivery: {
    overdue: number;
    overdueQty: number;
    overdueWeight: number;
  };
  /** Itens com EXPEDIÇÃO concluída (020) — contagem por ITEM. Opcional: sem a migração o card mostra "—". */
  expedition?: {
    count: number;
    qty: number;
    weight: number;
  };
  /** 037: quebra por família do MESMO conjunto de atraso (card "Atrasados"). */
  overdueFamilies: FamilyTotal[];
  /** 037: quebra por família do MESMO conjunto de expedição (card "Expedição"). */
  expeditionFamilies: FamilyTotal[];
}

interface Chip {
  key: string;
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: "danger" | "warning" | "success" | "muted";
  /** Três números lado a lado (Registros, Qtd. total, Peso total). */
  details: { label: string; value: string }[];
  /** 037: lista de famílias — nos três cards (ausente = não renderiza). */
  families?: FamilyTotal[];
  /** Card clicável: filtro aplicado ao clicar (os demais filtros são mantidos). */
  filter?: Partial<ProductionFilters>;
  /** true quando o filtro deste chip já está ativo. */
  active?: boolean;
}

/** Resumo com contagens + atalhos de filtro. */
export function ProductionSummary({
  total,
  qtyTotal,
  weightTotal,
  familyTotals,
  filters,
  delivery,
  expedition,
  overdueFamilies,
  expeditionFamilies,
}: ProductionSummaryProps) {
  const chips: Chip[] = [
    {
      // 025: a tela lista UMA LINHA POR OF — "Registros" aqui são pedidos.
      key: "events",
      label: "OFs",
      value: total,
      icon: <Inbox className="h-4 w-4" aria-hidden />,
      details: [
        { label: "OFs", value: formatQuantity(total) },
        { label: "Qtd. total", value: formatQuantity(qtyTotal) },
        { label: "Peso total", value: `${formatWeight(weightTotal)} kg` },
      ],
      // 037: quebra por família dos ITENS RAIZ das OFs filtradas.
      families: familyTotals,
    },
    {
      // Card GLOBAL (itens atrasados, de todas as OFs) — não confundir com
      // as linhas da tabela, que são OFs.
      key: "overdue",
      label: "Atrasados",
      value: delivery.overdue,
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      tone: "danger",
      filter: { delivery: "OVERDUE" },
      active: filters.delivery === "OVERDUE",
      details: [
        { label: "Itens", value: formatQuantity(delivery.overdue) },
        { label: "Qtd. total", value: formatQuantity(delivery.overdueQty) },
        { label: "Peso total", value: `${formatWeight(delivery.overdueWeight)} kg` },
      ],
      // 037: mesma quebra por família dos números acima.
      families: overdueFamilies,
    },
    {
      key: "expedition",
      label: "Expedição",
      value: formatQuantity(expedition?.count),
      icon: <Truck className="h-4 w-4" aria-hidden />,
      tone: "success",
      filter: { processCode: "EXP", processStatus: "CONCLUIDO" },
      active: filters.processCode === "EXP" && filters.processStatus === "CONCLUIDO",
      details: [
        { label: "Itens", value: formatQuantity(expedition?.count) },
        { label: "Qtd. total", value: formatQuantity(expedition?.qty) },
        { label: "Peso total", value: `${formatWeight(expedition?.weight)} kg` },
      ],
      // 037: mesma quebra por família dos números acima.
      families: expeditionFamilies,
    },
  ];

  return (
    <section aria-label="Resumo da gestão de OF" className="grid grid-cols-2 gap-2 xl:grid-cols-6">
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
            {/* 037: lista de famílias — nos três cards (OFs/Atrasados/Expedição). */}
            {chip.families !== undefined && <FamilyTotalsList entries={chip.families} />}
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
            href={query ? `/gestao-entregas?${query}` : "/gestao-entregas"}
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
