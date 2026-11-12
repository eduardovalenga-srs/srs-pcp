"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { ChildItemFilters } from "@/lib/types/order";
import type { KitOverdueTotals } from "@/lib/utils/child-item-groups";
import { childItemQueryString } from "@/lib/utils/filters";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

interface Fabrica1OverdueCardProps {
  filters: ChildItemFilters;
  active: boolean;
}

export function Fabrica1OverdueCard({ filters, active }: Fabrica1OverdueCardProps) {
  const summaryQuery = childItemQueryString({ ...filters, overdue: false, page: 1 });
  const [loaded, setLoaded] = useState<{ query: string; totals: KitOverdueTotals } | null>(null);
  const [loadingQuery, setLoadingQuery] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ query: string; message: string } | null>(null);
  const totals = loaded?.query === summaryQuery ? loaded.totals : null;
  const loading = loadingQuery === summaryQuery;
  const error = requestError?.query === summaryQuery ? requestError.message : null;

  const className = cn(
    "flex h-full flex-col gap-1 rounded border border-status-late/50 bg-card px-3 py-2 text-status-late transition-colors col-span-2",
    totals !== null && "hover:border-border hover:bg-accent/40",
    active && "border-primary bg-primary/5",
  );
  const details = [
    { label: "Registros", value: totals ? formatQuantity(totals.records) : "—" },
    { label: "Qtd. total", value: totals ? formatQuantity(totals.qty) : "—" },
    { label: "Peso total", value: totals ? `${formatWeight(totals.weight)} kg` : "—" },
  ];
  const body = (
    <div className="grid grid-cols-3 gap-2">
      {details.map((detail) => (
        <div key={detail.label} className="min-w-0">
          <span className="block truncate text-[11px] text-muted-foreground">{detail.label}</span>
          <span className="block truncate text-lg font-semibold tabular-nums">{detail.value}</span>
        </div>
      ))}
    </div>
  );
  const title = (
    <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <span className="truncate">Atrasados</span>
    </span>
  );

  if (totals !== null) {
    const summaryQuery = childItemQueryString({ ...filters, overdue: true, page: 1 });
    return (
      <Link
        href={summaryQuery ? `/fabrica-1?${summaryQuery}` : "/fabrica-1"}
        aria-label={`Atrasados: ${formatQuantity(totals.records)} — aplicar filtro`}
        aria-current={active ? "true" : undefined}
        className={className}
      >
        {title}
        {body}
      </Link>
    );
  }

  async function loadTotals() {
    setLoadingQuery(summaryQuery);
    setRequestError(null);
    try {
      const response = await fetch(
        `/api/fabrica-1/overdue${summaryQuery ? `?${summaryQuery}` : ""}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as KitOverdueTotals | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Não foi possível carregar os atrasados.");
      }
      setLoaded({ query: summaryQuery, totals: payload as KitOverdueTotals });
    } catch (cause) {
      setRequestError({
        query: summaryQuery,
        message: cause instanceof Error ? cause.message : "Não foi possível carregar os atrasados.",
      });
    } finally {
      setLoadingQuery((current) => (current === summaryQuery ? null : current));
    }
  }

  return (
    <div className={className} aria-busy={loading}>
      {title}
      {body}
      <button
        type="button"
        onClick={loadTotals}
        disabled={loading}
        className="self-start text-xs font-medium underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? "Calculando…" : error ? "Tentar novamente" : "Calcular atrasados"}
      </button>
      {error ? <span role="status" className="text-xs text-status-late">{error}</span> : null}
    </div>
  );
}
