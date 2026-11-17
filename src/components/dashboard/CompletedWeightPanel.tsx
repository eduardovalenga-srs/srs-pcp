"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, LoaderCircle, Scale } from "lucide-react";
import { toast } from "sonner";
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
import type {
  CompletedWeightCell,
  CompletedWeightColumn,
  CompletedWeightStats,
} from "@/lib/types/production";
import type { ProductGroupOption } from "@/lib/types/product-group";
import { formatWeight } from "@/lib/utils/formatting";
import { parseISODateToLocal, toISODate } from "@/lib/utils/dates";
import { countBusinessDays, isWeekendISO } from "@/lib/utils/weight-period";
import { weightProcessColumns } from "@/lib/utils/weight-columns";
import { downloadChartPng } from "@/lib/utils/chart-image";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExportButton } from "@/components/shared/ExportButton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_PROCESSES = "__all__";
const ALL_FAMILIES = "__all_families__";
const NO_FAMILY = "__no_family__";

/** Valor do seletor que representa o recorte devolvido pela RPC. */
function familySelection(data: CompletedWeightStats | null): string {
  if (!data) return ALL_FAMILIES;
  if (data.withoutProductGroup) return NO_FAMILY;
  return data.productGroupId === null ? ALL_FAMILIES : String(data.productGroupId);
}

interface CompletedWeightPanelProps {
  initialData: CompletedWeightStats | null;
  today: string;
  /** Catálogo ativo — as colunas da matriz, como na gestão de OF. */
  processes: CompletedWeightColumn[];
  /** Famílias cadastradas — opções do filtro por grupo de produto. */
  families: ProductGroupOption[];
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

function cellByCode(day: { processes: CompletedWeightCell[] }): Map<string, CompletedWeightCell> {
  return new Map(day.processes.map((cell) => [cell.code, cell]));
}

/** Texto da célula: kg, "✓" quando concluído sem peso, "—" sem produção. */
function cellText(cell: CompletedWeightCell | undefined): string {
  if (!cell) return "—";
  if (cell.weightKg > 0) return formatWeight(cell.weightKg);
  return cell.cells > 0 ? "✓" : "—";
}

export function CompletedWeightPanel({
  initialData,
  today,
  processes,
  families,
  initialError,
}: CompletedWeightPanelProps) {
  const [data, setData] = useState(initialData);
  const [granularity, setGranularity] = useState<WeightGranularity>(initialData?.granularity ?? "month");
  const [anchor, setAnchor] = useState(initialData?.anchor ?? today);
  const [selectedProcess, setSelectedProcess] = useState(initialData?.processCode ?? ALL_PROCESSES);
  const [selectedFamily, setSelectedFamily] = useState(familySelection(initialData));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [chartBusy, setChartBusy] = useState<"evolution" | "process" | null>(null);
  const evolutionChartRef = useRef<HTMLDivElement>(null);
  const processChartRef = useRef<HTMLDivElement>(null);

  async function load(
    nextGranularity: WeightGranularity,
    nextAnchor: string,
    nextProcess: string = selectedProcess,
    nextFamily: string = selectedFamily,
  ) {
    setLoading(true);
    setError("");
    const result = await getCompletedWeightStatsAction({
      granularity: nextGranularity,
      anchor: nextAnchor,
      processCode: nextProcess === ALL_PROCESSES ? null : nextProcess,
      productGroupId:
        nextFamily === ALL_FAMILIES || nextFamily === NO_FAMILY ? null : Number(nextFamily),
      withoutProductGroup: nextFamily === NO_FAMILY,
    });
    if (result.success) {
      setData(result.data);
      setGranularity(nextGranularity);
      setAnchor(nextAnchor);
      setSelectedProcess(result.data.processCode ?? ALL_PROCESSES);
      setSelectedFamily(familySelection(result.data));
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

  function selectProcess(value: string) {
    setSelectedProcess(value);
    void load(granularity, anchor, value);
  }

  function selectFamily(value: string) {
    setSelectedFamily(value);
    void load(granularity, anchor, selectedProcess, value);
  }

  function navigate(direction: -1 | 1) {
    if (!data) return;
    void load(granularity, shiftISODate(data.periodStart, granularity, direction));
  }

  function selectBucket(bucket: string) {
    void load(granularity, bucket);
  }

  async function exportChart(kind: "evolution" | "process") {
    const container = kind === "evolution" ? evolutionChartRef.current : processChartRef.current;
    if (!container || !data) return;

    const processLabel =
      selectedProcess === ALL_PROCESSES
        ? "Todos os processos"
        : processes.find((process) => process.code === selectedProcess)?.name ?? selectedProcess;
    const familyLabel =
      selectedFamily === ALL_FAMILIES
        ? "Todas as famílias"
        : selectedFamily === NO_FAMILY
          ? "Sem família"
          : families.find((family) => String(family.id) === selectedFamily)?.familyDescription ??
            `Família ${selectedFamily}`;

    setChartBusy(kind);
    try {
      await downloadChartPng(container, {
        fileName: `${kind === "evolution" ? "grafico-evolucao-peso" : "grafico-peso-por-processo"}-${data.periodStart}.png`,
        title: kind === "evolution" ? "Evolução do peso concluído" : "Peso por processo",
        subtitle: `${periodLabel(data)} · ${processLabel} · ${familyLabel}`,
      });
      toast.success("Imagem exportada.");
    } catch {
      toast.error("Não foi possível exportar o gráfico.");
    } finally {
      setChartBusy(null);
    }
  }

  // Colunas: catálogo da gestão de OF + processos que só aparecem nos dados.
  const catalog = weightProcessColumns(processes, data?.processes ?? []);
  const columns =
    selectedProcess === ALL_PROCESSES ? catalog : catalog.filter((column) => column.code === selectedProcess);

  const change =
    data && data.previous.weightKg > 0
      ? ((data.total.weightKg - data.previous.weightKg) / data.previous.weightKg) * 100
      : null;
  const periodIsCurrent = Boolean(data && data.periodStart <= today && data.periodEnd >= today);
  const weightByProcess = new Map((data?.processes ?? []).map((process) => [process.code, process.weightKg]));

  // Montante por família (079): a RPC devolve todos os grupos do período,
  // mesmo com um grupo selecionado, para o seletor exibir os totais.
  const groupsById = new Map((data?.groups ?? []).map((group) => [group.id, group] as const));
  const familyOptions = families.map((family) => ({
    value: String(family.id),
    label: `${family.groupType} — ${family.familyDescription}`,
    total: groupsById.get(family.id)?.weightKg ?? null,
  }));
  for (const group of data?.groups ?? []) {
    if (group.id === null || familyOptions.some((option) => option.value === String(group.id))) continue;
    familyOptions.push({
      value: String(group.id),
      label: `${group.abbreviation} — ${group.name}`,
      total: group.weightKg,
    });
  }
  const noFamilyTotal = groupsById.get(null)?.weightKg ?? null;

  // Média por dia útil do período (seg–sex). No período em curso, só os
  // dias úteis já transcorridos entram na conta.
  const businessDays = data ? countBusinessDays(data.periodStart, data.periodEnd, today) : 0;

  return (
    <section aria-label="Peso concluído por processo" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Scale className="h-4 w-4 text-muted-foreground" aria-hidden />
            Peso concluído por processo
          </h2>
          <p className="text-xs text-muted-foreground">
            kg = quantidade concluída × peso unitário do item, por dia e processo. Fins de semana em cinza.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton
            endpoint="/api/export/dashboard"
            fallbackFileName="export-dashboard-peso.xlsx"
            disabled={loading || !data}
            params={{
              granularidade: granularity,
              ancora: anchor,
              processo: selectedProcess === ALL_PROCESSES ? null : selectedProcess,
              familia:
                selectedFamily === ALL_FAMILIES
                  ? null
                  : selectedFamily === NO_FAMILY
                    ? "sem-familia"
                    : selectedFamily,
            }}
          />
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
      </div>

      <div className="rounded border bg-card p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Período anterior"
              onClick={() => navigate(-1)}
              disabled={loading || !data}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-40 text-center text-sm font-medium capitalize">
              {data ? periodLabel(data) : "Sem dados"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Próximo período"
              onClick={() => navigate(1)}
              disabled={loading || !data}
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
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

          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedFamily} onValueChange={selectFamily} disabled={loading}>
              <SelectTrigger className="h-8 w-64" aria-label="Filtrar por família de produto">
                <SelectValue placeholder="Todas as famílias" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FAMILIES}>Todas as famílias</SelectItem>
                {familyOptions.map((family) => (
                  <SelectItem key={family.value} value={family.value}>
                    {family.label}
                    {family.total !== null ? ` · ${formatWeight(family.total)} kg` : ""}
                  </SelectItem>
                ))}
                {noFamilyTotal !== null ? (
                  <SelectItem value={NO_FAMILY}>
                    Sem família · {formatWeight(noFamilyTotal)} kg
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <Select value={selectedProcess} onValueChange={selectProcess} disabled={loading}>
              <SelectTrigger className="h-8 w-48" aria-label="Filtrar por processo">
                <SelectValue placeholder="Todos os processos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROCESSES}>Todos os processos</SelectItem>
                {catalog.map((process) => (
                  <SelectItem key={process.code} value={process.code}>
                    {process.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data ? (
              <span className="text-xs text-muted-foreground">
                Total: <strong className="text-foreground">{formatWeight(data.total.weightKg)} kg</strong>
              </span>
            ) : null}
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {data ? (
          <>
            <div
              className="max-h-[26rem] overflow-auto rounded border transition-opacity"
              aria-busy={loading}
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              <table className="w-full min-w-[40rem] border-collapse text-[11px]">
                <caption className="sr-only">
                  Produção concluída (kg) por dia e processo. ✓ indica processo concluído sem peso cadastrado.
                </caption>
                <thead className="sticky top-0 z-20 bg-muted">
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-30 border-b bg-muted px-2 py-1.5 text-left font-semibold"
                    >
                      Dia
                    </th>
                    {columns.map((column) => (
                      <th
                        key={column.code}
                        scope="col"
                        title={column.name}
                        className="border-b px-2 py-1.5 text-right font-semibold whitespace-nowrap"
                      >
                        {column.name}
                      </th>
                    ))}
                    <th scope="col" className="border-b px-2 py-1.5 text-right font-semibold">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.days.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="px-3 py-4 text-center text-muted-foreground">
                        Nenhum dia no período.
                      </td>
                    </tr>
                  ) : (
                    data.days.map((day) => {
                      const cells = cellByCode(day);
                      const dayTotal = day.processes.reduce((sum, cell) => sum + cell.weightKg, 0);
                      const weekend = isWeekendISO(day.date);
                      return (
                        <tr
                          key={day.date}
                          className={
                            weekend
                              ? "weekend-row border-b last:border-0"
                              : "border-b last:border-0 hover:bg-muted/30"
                          }
                        >
                          <th
                            scope="row"
                            className={`sticky left-0 z-10 border-r px-2 py-1 text-left font-medium whitespace-nowrap ${
                              weekend ? "weekend-cell" : "bg-card"
                            }`}
                          >
                            {displayDate(day.date, {
                              weekday: "short",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </th>
                          {columns.map((column) => {
                            const cell = cells.get(column.code);
                            return (
                              <td
                                key={column.code}
                                className="px-2 py-1 text-right tabular-nums"
                                title={
                                  cell
                                    ? `${column.name}: ${formatWeight(cell.weightKg)} kg em ${cell.quantity} peça(s)`
                                    : `${column.name}: sem produção concluída`
                                }
                              >
                                <span className={cell && cell.weightKg > 0 ? "text-status-done" : "text-muted-foreground"}>
                                  {cellText(cell)}
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-right font-medium tabular-nums">{formatWeight(dayTotal)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot className="sticky bottom-0 z-20 bg-muted">
                  <tr>
                    <th
                      scope="row"
                      className="sticky left-0 z-30 border-t bg-muted px-2 py-1.5 text-left font-semibold"
                    >
                      Total
                    </th>
                    {columns.map((column) => (
                      <td key={column.code} className="border-t px-2 py-1.5 text-right font-semibold tabular-nums">
                        {formatWeight(weightByProcess.get(column.code) ?? 0)}
                      </td>
                    ))}
                    <td className="border-t px-2 py-1.5 text-right font-semibold tabular-nums">
                      {formatWeight(data.total.weightKg)}
                    </td>
                  </tr>
                  {data.granularity !== "day" ? (
                    <tr>
                      <th
                        scope="row"
                        title={`Total do período ÷ ${businessDays} dia(s) útil(eis) (seg–sex, sem feriados).`}
                        className="sticky left-0 z-30 border-t bg-muted px-2 py-1 text-left font-normal text-muted-foreground whitespace-nowrap"
                      >
                        Média/dia útil
                        <span className="ml-1 text-[10px]">({businessDays})</span>
                      </th>
                      {columns.map((column) => (
                        <td
                          key={column.code}
                          className="border-t px-2 py-1 text-right font-normal text-muted-foreground tabular-nums"
                        >
                          {businessDays > 0
                            ? formatWeight((weightByProcess.get(column.code) ?? 0) / businessDays)
                            : "—"}
                        </td>
                      ))}
                      <td className="border-t px-2 py-1 text-right font-normal text-muted-foreground tabular-nums">
                        {businessDays > 0 ? formatWeight(data.total.weightKg / businessDays) : "—"}
                      </td>
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </div>

            {loading ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Atualizando…
              </p>
            ) : null}

            {data.total.weightKg === 0 && data.series.every((item) => item.weightKg === 0) ? (
              <p className="mt-3 text-center text-sm text-muted-foreground">
                Sem peso concluído neste período.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 rounded border p-2">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold">Evolução do peso concluído</h3>
                      <p className="mt-0.5 mb-1 text-[11px] text-muted-foreground">
                        Selecione uma barra para abrir o período.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Baixar gráfico em PNG"
                      aria-label="Baixar gráfico de evolução em PNG"
                      onClick={() => void exportChart("evolution")}
                      disabled={chartBusy !== null}
                    >
                      {chartBusy === "evolution" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </Button>
                  </div>
                  <div ref={evolutionChartRef} className="h-48">
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
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold">Peso por processo</h3>
                      <p className="mt-0.5 mb-1 text-[11px] text-muted-foreground">
                        {change === null
                          ? "Sem base no período anterior para comparar."
                          : `${change >= 0 ? "+" : ""}${change.toLocaleString("pt-BR", {
                              maximumFractionDigits: 1,
                            })}% vs. período anterior.`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      title="Baixar gráfico em PNG"
                      aria-label="Baixar gráfico de peso por processo em PNG"
                      onClick={() => void exportChart("process")}
                      disabled={chartBusy !== null || data.processes.length === 0}
                    >
                      {chartBusy === "process" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </Button>
                  </div>
                  {data.processes.length === 0 ? (
                    <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                      Sem processos com peso neste período.
                    </div>
                  ) : (
                    <div ref={processChartRef} className="h-48">
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
                          <Bar
                            dataKey="weightKg"
                            name="Peso concluído"
                            fill="var(--status-done)"
                            radius={[0, 3, 3, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    {change === null ? null : change >= 0 ? (
                      <ArrowUp className="h-3 w-3 text-status-done" aria-hidden />
                    ) : (
                      <ArrowDown className="h-3 w-3 text-status-late" aria-hidden />
                    )}
                    Total do período: {formatWeight(data.total.weightKg)} kg
                  </p>
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
