"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS } from "@/lib/constants/production";
import { DELIVERY_FILTERS, DELIVERY_LABELS } from "@/lib/constants/pagination";
import type { ProductionFilters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import {
  DeliveryPeriodPopover,
  FilterMenu,
  NumericRangeFilter,
  SeqEqualityFilter,
  TextColumnFilter as SharedTextColumnFilter,
} from "@/components/shared/column-filters";
import { SortLink as SharedSortLink } from "@/components/shared/SortLink";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Grava um conjunto de filtros na URL e volta para a primeira página. */
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
  return (
    <SharedSortLink
      label={label}
      fullName={fullName}
      columnId={columnId}
      sort={filters.sort}
      sortDir={filters.sortDir}
      buildHref={(next) => {
        const query = productionQueryString({ ...filters, ...next, page: 1 });
        return query ? `/gestao-entregas?${query}` : "/gestao-entregas";
      }}
    />
  );
}

/**
 * Cabeçalho de uma coluna: ordenação (quando existir) + filtro opcional.
 * `label` é o texto visível (pode ser abreviado); `fullLabel` é o nome completo
 * usado no aria-label/tooltip — leitor de tela nunca enxerga a abreviação.
 * `children` entra à direita, junto do rótulo.
 */
export function ColumnHeader({
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
export function DeliveryFilter({ filters }: { filters: ProductionFilters }) {
  const apply = useApplyFilters(filters);
  const active =
    filters.delivery !== "ALL" || filters.deliveryFrom !== null || filters.deliveryTo !== null;

  return (
    <DeliveryPeriodPopover
      active={active}
      from={filters.deliveryFrom}
      to={filters.deliveryTo}
      idPrefix="entrega"
      onApply={(from, to) => apply({ deliveryFrom: from, deliveryTo: to })}
      onClear={() => apply({ delivery: "ALL", deliveryFrom: null, deliveryTo: null })}
      extra={
        <div className="space-y-1">
          <Label htmlFor="entrega-janela" className="text-xs text-muted-foreground">
            Janela
          </Label>
          <Select
            value={filters.delivery}
            onValueChange={(value) =>
              apply({ delivery: value as ProductionFilters["delivery"] })
            }
          >
            <SelectTrigger id="entrega-janela" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIVERY_FILTERS.map((value) => (
                <SelectItem key={value} value={value}>
                  {DELIVERY_LABELS[value]}
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
 */
export function ProcessGroupFilter({ filters }: { filters: ProductionFilters }) {
  const apply = useApplyFilters(filters);
  const active = filters.processCode === "ALL" && filters.processStatus !== "ALL";
  const value = filters.processCode === "ALL" ? filters.processStatus : "ALL";

  return (
    <FilterMenu
      context="situação em qualquer processo"
      value={value}
      active={active}
      options={[
        { value: "ALL", label: "Todas as situações" },
        ...PROCESS_STATUSES.map((status) => ({
          value: status,
          label: `${PROCESS_STATUS_SYMBOLS[status]} ${PROCESS_STATUS_LABELS[status]}`,
        })),
      ]}
      onValueChange={(next) =>
        apply({
          processCode: "ALL",
          processStatus: next === "ALL" ? "ALL" : (next as ProductionFilters["processStatus"]),
        })
      }
    />
  );
}

/** Colunas de texto — filtro "contém" (valor parcial, sem diferenciar maiúsculas). */
export type TextFilterField = "orderCode" | "customer" | "parentItem" | "description";

interface TextColumnFilterProps {
  filters: ProductionFilters;
  field: TextFilterField;
  /** Rótulo da coluna, ex.: "Cliente". */
  column: string;
  /** Contexto do título/aria, ex.: "cliente". */
  context: string;
}

export function TextColumnFilter({ filters, field, column, context }: TextColumnFilterProps) {
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
export function SeqFilter({ filters }: { filters: ProductionFilters }) {
  const apply = useApplyFilters(filters);

  return (
    <SeqEqualityFilter
      context="sequência de fabricação"
      value={filters.seq}
      idPrefix="gestao-seq"
      onApply={(value) => apply({ seq: value })}
    />
  );
}

interface NumericColumnFilterProps {
  filters: ProductionFilters;
  minField: "qtyMin" | "weightMin";
  maxField: "qtyMax" | "weightMax";
  /** Rótulo da coluna, ex.: "Qtd.". */
  column: string;
  /** Contexto do título/aria, ex.: "quantidade". */
  context: string;
  /** Prefixo dos ids dos campos (cada tela/coluna tem os seus). */
  idPrefix: string;
  /** Passo dos campos (padrão "1"; pesos usam "0.001"). */
  step?: string;
}

/** Filtro de faixa numérica (De/Até) por coluna — Qtd., Peso etc. (038). */
export function NumericColumnFilter({
  filters,
  minField,
  maxField,
  column,
  context,
  idPrefix,
  step,
}: NumericColumnFilterProps) {
  const apply = useApplyFilters(filters);

  return (
    <NumericRangeFilter
      context={context}
      column={column}
      min={filters[minField]}
      max={filters[maxField]}
      idPrefix={idPrefix}
      step={step}
      onApply={(min, max) => apply({ [minField]: min, [maxField]: max })}
    />
  );
}

/**
 * Filtro de UMA coluna de processo: situação daquele processo específico
 * (038). Só existe um filtro de processo por vez no backend — ativar aqui
 * substitui o de outra coluna/de grupo (processCode vira o código desta
 * coluna); "Todas" limpa o par processo+situação.
 */
export function ProcessColumnFilter({ filters, code }: { filters: ProductionFilters; code: string }) {
  const apply = useApplyFilters(filters);
  const active = filters.processCode === code && filters.processStatus !== "ALL";
  const value = active && filters.processStatus ? filters.processStatus : "ALL";

  return (
    <FilterMenu
      context={`situação do processo ${code}`}
      value={value}
      active={active}
      options={[
        { value: "ALL", label: "Todas as situações" },
        ...PROCESS_STATUSES.map((status) => ({
          value: status,
          label: `${PROCESS_STATUS_SYMBOLS[status]} ${PROCESS_STATUS_LABELS[status]}`,
        })),
      ]}
      onValueChange={(next) =>
        apply(
          next === "ALL"
            ? { processCode: "ALL", processStatus: "ALL" }
            : { processCode: code, processStatus: next as ProductionFilters["processStatus"] },
        )
      }
    />
  );
}

/** Cabeçalho do grupo "DADOS DOS PEDIDOS" (a busca genérica foi removida). */
export function OrderGroupHeader() {
  return <span>DADOS DOS PEDIDOS</span>;
}
