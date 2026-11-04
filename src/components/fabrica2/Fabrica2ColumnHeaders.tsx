"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import {
  PROCESS_OVERDUE_OPTION,
  processStatusFilterOptions,
} from "@/lib/constants/production";
import { DELIVERY_FILTERS, DELIVERY_LABELS } from "@/lib/constants/pagination";
import type { ProductionFilters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import { cn } from "@/lib/utils";
import {
  DeliveryPeriodPopover,
  FilterMenu,
  NumericRangeFilter,
  SeqEqualityFilter,
  TextColumnFilter as SharedTextColumnFilter,
} from "@/components/shared/column-filters";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Grava um conjunto de filtros na URL da Fábrica 2 e volta para a primeira página. */
function useApplyFilters(filters: ProductionFilters) {
  const router = useRouter();
  const pathname = usePathname();

  return (overrides: Partial<ProductionFilters>) => {
    const query = productionQueryString({ ...filters, ...overrides, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/** Indicador de ordenação da coluna (servidor decide a ordem via URL). */
function SortLink({
  label,
  fullName,
  columnId,
  filters,
}: {
  label: string;
  /** Nome completo da coluna (o que o leitor de tela anuncia). */
  fullName: string;
  columnId: string;
  filters: ProductionFilters;
}) {
  const active = filters.sort === columnId;
  const sortDir = active ? filters.sortDir : "asc";
  const next: ProductionFilters = {
    ...filters,
    sort: columnId,
    sortDir: active && filters.sortDir === "asc" ? "desc" : "asc",
    page: 1,
  };
  const query = productionQueryString(next);
  const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <Link
      href={query ? `/fabrica-2?${query}` : "/fabrica-2"}
      className={cn(
        "inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
        !active && "text-muted-foreground",
      )}
      aria-label={`Ordenar por ${fullName}${active ? `, atualmente ${sortDir === "asc" ? "crescente" : "decrescente"}` : ""}`}
      title={fullName}
    >
      <span className="truncate" aria-hidden>
        {label}
      </span>
      <Icon className={cn("h-3 w-3 shrink-0", active ? "opacity-100" : "opacity-40")} aria-hidden />
    </Link>
  );
}

/**
 * Cabeçalho de uma coluna: ordenação (quando existir) + filtro opcional.
 * `label` é o texto visível (pode ser abreviado); `fullLabel` é o nome completo
 * usado no aria-label/tooltip — leitor de tela nunca enxerga a abreviação.
 * `children` entra à direita, junto do rótulo.
 */
export function Fabrica2ColumnHeader({
  label,
  fullLabel,
  columnId,
  filters,
  filter,
}: {
  label: string;
  fullLabel?: string;
  columnId?: string;
  filters: ProductionFilters;
  filter?: ReactNode;
}) {
  const fullName = fullLabel ?? label;

  return (
    <span className="flex w-full items-center justify-between gap-1">
      {columnId ? (
        <SortLink label={label} fullName={fullName} columnId={columnId} filters={filters} />
      ) : (
        <span className="truncate px-1" title={fullName}>
          <span aria-hidden>{label}</span>
          <span className="sr-only">{fullName}</span>
        </span>
      )}
      {filter}
    </span>
  );
}

/** Filtro da coluna "Entrega": janelas rápidas + período De/Até (014). */
export function Fabrica2DeliveryFilter({ filters }: { filters: ProductionFilters }) {
  const apply = useApplyFilters(filters);
  const active =
    filters.delivery !== "ALL" || filters.deliveryFrom !== null || filters.deliveryTo !== null;

  return (
    <DeliveryPeriodPopover
      active={active}
      from={filters.deliveryFrom}
      to={filters.deliveryTo}
      idPrefix="f2-entrega"
      onApply={(from, to) => apply({ deliveryFrom: from, deliveryTo: to })}
      onClear={() => apply({ delivery: "ALL", deliveryFrom: null, deliveryTo: null })}
      extra={
        <div className="space-y-1">
          <Label htmlFor="f2-entrega-janela" className="text-xs text-muted-foreground">
            Janela
          </Label>
          <Select
            value={filters.delivery}
            onValueChange={(value) =>
              apply({ delivery: value as ProductionFilters["delivery"] })
            }
          >
            <SelectTrigger id="f2-entrega-janela" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIVERY_FILTERS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "OVERDUE" ? "Atrasados (ACAB)" : DELIVERY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    />
  );
}

/**
 * Filtro do grupo "PROCESSOS": situação em *qualquer* processo
 * (processCode fica em ALL — o banco procura a situação em todas as etapas).
 *
 * 051: a lista ganha a opção "Atrasados" — início previsto de qualquer
 * processo já vencido (mesma regra da cor vermelha da célula). Um valor por
 * filtro: escolher "Atrasados" zera a situação e vice-versa.
 */
export function Fabrica2ProcessGroupFilter({ filters }: { filters: ProductionFilters }) {
  const apply = useApplyFilters(filters);
  const active =
    filters.processCode === "ALL" && (filters.processOverdue || filters.processStatus !== "ALL");
  const value =
    filters.processCode !== "ALL"
      ? "ALL"
      : filters.processOverdue
        ? PROCESS_OVERDUE_OPTION
        : filters.processStatus;

  return (
    <FilterMenu
      context="situação em qualquer processo"
      value={value}
      active={active}
      options={processStatusFilterOptions()}
      onValueChange={(next) =>
        apply({
          processCode: "ALL",
          processOverdue: next === PROCESS_OVERDUE_OPTION,
          processStatus:
            next === "ALL" || next === PROCESS_OVERDUE_OPTION
              ? "ALL"
              : (next as ProductionFilters["processStatus"]),
        })
      }
    />
  );
}

/** Colunas de texto — filtro "contém" (valor parcial, sem diferenciar maiúsculas). */
export type Fabrica2TextFilterField = "orderCode" | "customer" | "parentItem" | "description" | "family" | "op";

interface Fabrica2TextColumnFilterProps {
  filters: ProductionFilters;
  field: Fabrica2TextFilterField;
  /** Rótulo da coluna, ex.: "Cliente". */
  column: string;
  /** Contexto do título/aria, ex.: "cliente". */
  context: string;
}

export function Fabrica2TextColumnFilter({ filters, field, column, context }: Fabrica2TextColumnFilterProps) {
  const apply = useApplyFilters(filters);

  return (
    <SharedTextColumnFilter
      value={filters[field]}
      column={column}
      context={context}
      onApply={(value) => {
        const patch: Partial<ProductionFilters> = {};
        patch[field] = value;
        apply(patch);
      }}
    />
  );
}

/** Filtro da coluna Seq. — igualdade (seq = N, exclusivo por OF — 038). */
export function Fabrica2SeqFilter({ filters }: { filters: ProductionFilters }) {
  const apply = useApplyFilters(filters);

  return (
    <SeqEqualityFilter
      context="sequência de fabricação"
      value={filters.seq}
      idPrefix="f2-seq"
      onApply={(value) => apply({ seq: value })}
    />
  );
}

interface Fabrica2NumericColumnFilterProps {
  filters: ProductionFilters;
  minField: "qtyMin" | "weightMin";
  maxField: "qtyMax" | "weightMax";
  /** Rótulo da coluna, ex.: "Qtd.". */
  column: string;
  /** Contexto do título/aria, ex.: "quantidade". */
  context: string;
  /** Passo dos campos (padrão "1"; pesos usam "0.001"). */
  step?: string;
}

/** Filtro de faixa numérica (De/Até) por coluna — Qtd., Peso un. (038). */
export function Fabrica2NumericColumnFilter({
  filters,
  minField,
  maxField,
  column,
  context,
  step,
}: Fabrica2NumericColumnFilterProps) {
  const apply = useApplyFilters(filters);

  return (
    <NumericRangeFilter
      context={context}
      column={column}
      min={filters[minField]}
      max={filters[maxField]}
      idPrefix={`f2-${minField}`}
      step={step}
      onApply={(min, max) => apply({ [minField]: min, [maxField]: max })}
    />
  );
}

/**
 * Filtro de UMA coluna de processo: situação daquele processo específico
 * (038). Só existe um filtro de processo por vez no backend — ativar aqui
 * substitui o de outra coluna/de grupo; "Todas" limpa o par.
 *
 * 051: a lista ganha a opção "Atrasados" — início previsto DAQUELE processo
 * já vencido e ainda não concluído (a mesma data que a célula pinta de
 * vermelho). Um valor por filtro: "Atrasados" zera a situação e vice-versa.
 */
export function Fabrica2ProcessColumnFilter({ filters, code }: { filters: ProductionFilters; code: string }) {
  const apply = useApplyFilters(filters);
  const active =
    filters.processCode === code && (filters.processOverdue || filters.processStatus !== "ALL");
  const value =
    filters.processCode !== code
      ? "ALL"
      : filters.processOverdue
        ? PROCESS_OVERDUE_OPTION
        : filters.processStatus;

  return (
    <FilterMenu
      context={`situação do processo ${code}`}
      value={value}
      active={active}
      options={processStatusFilterOptions()}
      onValueChange={(next) =>
        apply(
          next === "ALL"
            ? { processCode: "ALL", processStatus: "ALL", processOverdue: false }
            : next === PROCESS_OVERDUE_OPTION
              ? { processCode: code, processStatus: "ALL", processOverdue: true }
              : {
                  processCode: code,
                  processStatus: next as ProductionFilters["processStatus"],
                  processOverdue: false,
                },
        )
      }
    />
  );
}

/** Cabeçalho do grupo "DADOS DOS PEDIDOS" (a busca genérica foi removida). */
export function Fabrica2OrderGroupHeader() {
  return <span>DADOS DOS PEDIDOS</span>;
}
