"use client";

import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LoaderCircle, Scale } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getCompletedWeightStatsAction } from "@/lib/actions/production.actions";
import {
  WEIGHT_GRANULARITY_LABELS,
  WEIGHT_GRANULARITIES,
  type WeightGranularity,
} from "@/lib/constants/production";
import type { CompletedWeightStats } from "@/lib/types/production";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { parseISODateToLocal, toISODate } from "@/lib/utils/dates";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

interface CompletedWeightPanelProps {
  initialData: CompletedWeightStats | null;
  today: string;
  initialError?: string;
}

function shiftISODate(value: string, granularity: WeightGranularity, direction: -1 | 1): string {
  const date = parseISODateToLocal(value) ?? new Date();
  if (granularity === "day") date.setDate(date.getDate() + direction);
  else if (granularity === "week") date.setDate(date.getDate() + direction * 7);
  else {
    date.setDate(1);
    date.setMonth(date.getMonth() + direction);
  }
  return toISODate(date);
}

function displayDate(value: string, options: Intl.DateTimeFormatOptions): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
    : null;
  return date ? new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(date) : value;
}

function periodLabel(data: CompletedWeightStats): string {
  if (data.granularity === "day") {
    return displayDate(data.anchor, { day: "2-digit", month: "long", year: "numeric" });
  }
  if (data.granularity === "week") {
    return `${displayDate(data.periodStart, { day: "2-digit", month: "short" })} – ${displayDate(data.periodEnd, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;
  }
  return displayDate(data.anchor, { month: "long", year: "numeric" });
}

function chartLabel(bucket: string, granularity: WeightGranularity): string {
  if (granularity === "month") return displayDate(bucket, { month: "short", year: "2-digit" });
  return displayDate(bucket, { day: "2-digit", month: "2-digit" });
}

export function CompletedWeightPanel({ initialData, today, initialError }: CompletedWeightPanelProps) {
  const [data, setData] = useState(initialData);
  const [granularity, setGranularity] = useState<WeightGranularity>(initialData?.granularity ?? "month");
  const [anchor, setAnchor] = useState(initialData?.anchor ?? today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError ?? "");

  async function load(nextGranularity: WeightGranularity, nextAnchor: string) {
    setLoading(true);
    setError("");
    const result = await getCompletedWeightStatsAction({ granularity: nextGranularity, anchor: nextAnchor });
    if (result.success) {
      setData(result.data);
      setGranularity(nextGranularity);
      setAnchor(nextAnchor);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }

  function selectGranularity(value: string) {
    if (WEIGHT_GRANULARITIES.includes(value as WeightGranularity)) {
      void load(value as WeightGranularity, anchor);
    }
  }

  function navigate(direction: -1 | 1) {
    if (!data) return;
    void load(granularity, shiftISODate(data.periodStart, granularity, direction));
  }

  function selectBucket(bucket: string) {
    void load(granularity, bucket);
  }

  const change =
    data && data.previous.weightKg > 0
      ? ((data.total.weightKg - data.previous.weightKg) / data.previous.weightKg) * 100
      : null;
  const periodIsCurrent = Boolean(data && data.periodStart <= today && data.periodEnd >= today);

  return (
    <section aria-label="Peso concluído por processo" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="h-4 w-4 text-muted-foreground" aria-hidden />
            Peso concluído por processo
          </h2>
          <p className="text-xs text-muted-foreground">
            kg calculados pela quantidade concluída × peso unitário do item.
          </p>
        </div>
        <Tabs value={granularity} onValueChange={selectGranularity}>
          <TabsList aria-label="Granularidade do período">
            {WEIGHT_GRANULARITIES.map((value) => (
              <TabsTrigger key={value} value={value}>
                {WEIGHT_GRANULARITY_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="rounded border bg-card p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Período anterior" onClick={() => navigate(-1)} disabled={loading || !data}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-40 text-center text-sm font-medium capitalize">
              {data ? periodLabel(data) : "Sem dados"}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Próximo período" onClick={() => navigate(1)} disabled={loading || !data}>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load(granularity, today)}
            disabled={loading || periodIsCurrent}
          >
            Atual
          </Button>
        </div>

        {error ? (
          <p role="alert" className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {data ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded border bg-background px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Kg somados entre processos</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">{formatWeight(data.total.weightKg)} kg</p>
              </div>
              <div className="rounded border bg-background px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Peças processadas</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">{formatQuantity(data.total.quantity)}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  {change === null ? (
                    data.total.weightKg > 0 ? "Sem base no período anterior" : "Sem variação"
                  ) : (
                    <>
                      {change >= 0 ? (
                        <ArrowUp className="h-3 w-3 text-status-done" aria-hidden />
                      ) : (
                        <ArrowDown className="h-3 w-3 text-status-late" aria-hidden />
                      )}
                      {Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior
                    </>
                  )}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                Atualizando gráficos…
              </div>
            ) : data.total.weightKg === 0 && data.series.every((item) => item.weightKg === 0) ? (
              <EmptyState title="Nenhum peso concluído neste período" description="Marque processos como concluídos para acompanhar a evolução." />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="min-w-0 rounded border p-2">
                  <h3 className="mb-1 text-xs font-semibold">Evolução do peso concluído</h3>
                  <p className="mb-2 text-[11px] text-muted-foreground">Selecione uma barra para abrir o período.</p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.series} margin={{ top: 4, right: 8, left: -18, bottom: 2 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="bucket"
                          tickFormatter={(value: string) => chartLabel(value, granularity)}
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          axisLine={{ stroke: "var(--border)" }}
                          tickLine={false}
                          minTickGap={18}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          axisLine={false}
                          tickLine={false}
                          width={48}
                        />
                        <Tooltip
                          labelFormatter={(value) =>
                            granularity === "week"
                              ? `Semana de ${displayDate(String(value), { day: "2-digit", month: "long", year: "numeric" })}`
                              : displayDate(String(value), { day: "2-digit", month: "long", year: "numeric" })
                          }
                          formatter={(value) => [`${formatWeight(Number(value))} kg`, "Concluído"]}
                        />
                        <Bar
                          dataKey="weightKg"
                          name="Peso concluído"
                          radius={[3, 3, 0, 0]}
                          cursor="pointer"
                          onClick={(point) => {
                            const payload = point.payload as { bucket?: string } | undefined;
                            if (payload?.bucket) selectBucket(payload.bucket);
                          }}
                        >
                          {data.series.map((point) => (
                            <Cell
                              key={point.bucket}
                              fill={
                                (granularity === "day" && point.bucket === data.anchor) ||
                                (granularity !== "day" && point.bucket === data.periodStart)
                                  ? "var(--status-done)"
                                  : "var(--primary)"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="min-w-0 rounded border p-2">
                  <h3 className="mb-1 text-xs font-semibold">Peso por processo</h3>
                  {data.processes.length === 0 ? (
                    <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                      Sem processos com peso neste período.
                    </div>
                  ) : (
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={data.processes}
                          layout="vertical"
                          margin={{ top: 2, right: 16, left: 4, bottom: 2 }}
                        >
                          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                          <XAxis
                            type="number"
                            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                            axisLine={{ stroke: "var(--border)" }}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={100}
                            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip formatter={(value) => [`${formatWeight(Number(value))} kg`, "Concluído"]} />
                          <Bar dataKey="weightKg" name="Peso concluído" fill="var(--status-done)" radius={[0, 3, 3, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <caption className="sr-only">Peso e quantidade concluídos por processo no período</caption>
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th scope="col" className="py-1 font-medium">Processo</th>
                          <th scope="col" className="py-1 text-right font-medium">kg</th>
                          <th scope="col" className="py-1 text-right font-medium">Peças</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.processes.map((process) => (
                          <tr key={process.code} className="border-b last:border-0">
                            <th scope="row" className="py-1 text-left font-medium">{process.name}</th>
                            <td className="py-1 text-right tabular-nums">{formatWeight(process.weightKg)}</td>
                            <td className="py-1 text-right tabular-nums">{formatQuantity(process.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title="Não foi possível carregar o peso concluído"
            description={error || "Verifique a conexão e tente novamente."}
          />
        )}
      </div>
    </section>
  );
}
