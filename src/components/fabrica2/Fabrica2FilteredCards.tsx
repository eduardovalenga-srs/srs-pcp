"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Paintbrush } from "lucide-react";

import type { FilteredKpiTotals, ProductionFilteredSummary, ProductionFilters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";

interface Fabrica2FilteredCardsProps {
  filters: ProductionFilters;
  overdue: FilteredKpiTotals | null;
  acabamento: FilteredKpiTotals | null;
}

export function Fabrica2FilteredCards({ filters, overdue, acabamento }: Fabrica2FilteredCardsProps) {
  const summaryQuery = productionQueryString(filters, { page: 1 });
  const initialSummary = useMemo<ProductionFilteredSummary | null>(
    () => (overdue && acabamento ? { overdue, acabamento } : null),
    [overdue, acabamento],
  );
  const [loaded, setLoaded] = useState<{ query: string; summary: ProductionFilteredSummary } | null>(null);
  const [requestError, setRequestError] = useState<{ query: string; message: string } | null>(null);
  const summary = loaded?.query === summaryQuery ? loaded.summary : initialSummary;
  const error = requestError?.query === summaryQuery ? requestError.message : null;
  const loading = summary === null && error === null;

  const loadSummary = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/fabrica-2/summary${summaryQuery ? `?${summaryQuery}` : ""}`,
        { cache: "no-store", signal },
      );
      const payload = (await response.json()) as ProductionFilteredSummary | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error : "Não foi possível carregar o resumo da Fábrica 2.");
      }
      setLoaded({ query: summaryQuery, summary: payload as ProductionFilteredSummary });
      setRequestError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setRequestError({
        query: summaryQuery,
        message: cause instanceof Error ? cause.message : "Não foi possível carregar o resumo da Fábrica 2.",
      });
    }
  }, [summaryQuery]);

  useEffect(() => {
    if (initialSummary !== null) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => loadSummary(controller.signal));
    return () => controller.abort();
  }, [initialSummary, loadSummary]);

  const cards = [
    {
      key: "overdue",
      label: "Atrasados",
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      active: filters.delivery === "OVERDUE",
      filter: { delivery: "OVERDUE" as const },
      ariaValue: summary?.overdue.records,
      details: [
        { label: "Registros", value: summary ? formatQuantity(summary.overdue.records) : "—" },
        { label: "Qtd. total", value: summary ? formatQuantity(summary.overdue.qty) : "—" },
        { label: "Peso total", value: summary ? `${formatWeight(summary.overdue.weight)} kg` : "—" },
      ],
      tone: "danger" as const,
    },
    {
      key: "acabamento",
      label: "Acabamento",
      icon: <Paintbrush className="h-4 w-4" aria-hidden />,
      active: filters.processCode === "ACAB" && filters.processStatus === "CONCLUIDO",
      filter: { processCode: "ACAB" as const, processStatus: "CONCLUIDO" as const, processOverdue: false },
      ariaValue: summary?.acabamento.records,
      details: [
        { label: "Registros", value: summary ? formatQuantity(summary.acabamento.records) : "—" },
        { label: "Qtd. total", value: summary ? formatQuantity(summary.acabamento.qty) : "—" },
        { label: "Peso total", value: summary ? `${formatWeight(summary.acabamento.weight)} kg` : "—" },
      ],
      tone: "success" as const,
    },
  ];

  return (
    <>
      {cards.map((card) => {
        const title = (
          <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.icon}
            <span className="truncate">{card.label}</span>
          </span>
        );
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
        const className = cn(
          "flex h-full flex-col gap-1 rounded border bg-card px-3 py-2 transition-colors col-span-2",
          card.tone === "danger" && "border-status-late/50 text-status-late",
          card.tone === "success" && "border-status-done/50",
          summary !== null && "hover:border-border hover:bg-accent/40",
          card.active && "border-primary bg-primary/5",
        );

        if (summary !== null) {
          const next: ProductionFilters = { ...filters, ...card.filter, page: 1 };
          const query = productionQueryString(next);
          return (
            <Link
              key={card.key}
              href={query ? `/fabrica-2?${query}` : "/fabrica-2"}
              aria-label={`${card.label}: ${formatQuantity(card.ariaValue)} — aplicar filtro`}
              aria-current={card.active ? "true" : undefined}
              className={className}
            >
              {title}
              {body}
            </Link>
          );
        }

        return (
          <div key={card.key} className={className} aria-busy={loading}>
            {title}
            {body}
            <button
              type="button"
              onClick={() => {
                setRequestError(null);
                void loadSummary();
              }}
              disabled={loading}
              className="self-start text-xs font-medium underline underline-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {loading ? "Calculando…" : error ? "Tentar novamente" : "Calcular resumo"}
            </button>
            {error ? <span role="status" className="text-xs text-status-late">{error}</span> : null}
          </div>
        );
      })}
    </>
  );
}
