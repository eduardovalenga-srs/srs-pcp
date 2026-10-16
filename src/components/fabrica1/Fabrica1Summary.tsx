import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Truck } from "lucide-react";

import { FamilyTotalsList } from "@/components/shared/FamilyTotalsList";
import type { FamilyTotal } from "@/lib/types/production";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

interface Fabrica1SummaryProps {
  /** Nº de LINHAS (grupos por código de filho) do conjunto filtrado. */
  total: number;
  /** Soma da coluna "Qtd." do conjunto filtrado inteiro (todas as páginas). */
  qtyTotal: number;
  /** Peso total (kg) do conjunto filtrado — Σ (qtd × peso unit.). */
  weightTotal: number;
  /** 035: quebra por família do MESMO conjunto dos três números acima. */
  familyTotals: FamilyTotal[];
  /**
   * 037: KPIs globais de item RAIZ (mesmo get_production_stats da Fábrica 2
   * e da Gestão) para os cards "Atrasados" e "Expedição" — a regra de
   * atraso e a EXPEDIÇÃO pertencem ao item RAIZ (os filhos, cadeia
   * LASER…FICEP, não têm expedição própria).
   */
  delivery: { overdue: number; overdueQty: number; overdueWeight: number };
  expedition?: { count: number; qty: number; weight: number };
  /** 037: quebra por família dos MESMOS conjuntos dos dois cards novos. */
  overdueFamilies: FamilyTotal[];
  expeditionFamilies: FamilyTotal[];
}

interface Card {
  key: string;
  label: string;
  icon: ReactNode;
  tone?: "danger" | "success";
  /** Três números lado a lado (Registros, Qtd. total, Peso total). */
  details: { label: string; value: string }[];
  /** 037: lista de famílias — nos três cards (ausente = não renderiza). */
  families?: FamilyTotal[];
}

/**
 * Resumo da Fábrica 1 — três cards no mesmo modelo da Fábrica 2 (037):
 * "Eventos" com o conjunto FILTRADO (contagem de grupos) e "Atrasados" /
 * "Expedição" com os KPIs globais de item raiz + a lista de famílias.
 *
 * Sem clique/filtro: os filtros desta tela são por período De→Até e pela
 * cadeia da Fábrica 1 — não existe atalho OVERDUE/EXP no modelo de
 * filtros de filho (diferente de F2/Gestão). Cards informativos.
 */
export function Fabrica1Summary({
  total,
  qtyTotal,
  weightTotal,
  familyTotals,
  delivery,
  expedition,
  overdueFamilies,
  expeditionFamilies,
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
      families: familyTotals,
    },
    {
      key: "overdue",
      label: "Atrasados",
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      tone: "danger",
      details: [
        { label: "Registros", value: formatQuantity(delivery.overdue) },
        { label: "Qtd. total", value: formatQuantity(delivery.overdueQty) },
        { label: "Peso total", value: `${formatWeight(delivery.overdueWeight)} kg` },
      ],
      families: overdueFamilies,
    },
    {
      key: "expedition",
      label: "Expedição",
      icon: <Truck className="h-4 w-4" aria-hidden />,
      tone: "success",
      details: [
        { label: "Registros", value: formatQuantity(expedition?.count) },
        { label: "Qtd. total", value: formatQuantity(expedition?.qty) },
        { label: "Peso total", value: `${formatWeight(expedition?.weight)} kg` },
      ],
      families: expeditionFamilies,
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

        return (
          <div
            key={card.key}
            className={cn(
              "col-span-2 flex h-full flex-col gap-1 rounded border bg-card px-3 py-2",
              card.tone === "danger" && "border-status-late/50 text-status-late",
              card.tone === "success" && "border-status-done/50",
            )}
          >
            {title}
            {body}
            {/* 035/037: lista de famílias do MESMO conjunto dos números. */}
            {card.families !== undefined && <FamilyTotalsList entries={card.families} />}
          </div>
        );
      })}
    </section>
  );
}
