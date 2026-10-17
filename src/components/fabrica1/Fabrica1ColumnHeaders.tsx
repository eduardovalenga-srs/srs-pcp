"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

import { FABRICA1_EDITABLE_PROCESS_CODES } from "@/lib/constants/processes";
import {
  PROCESS_STATUSES,
  PROCESS_STATUS_LABELS,
  PROCESS_STATUS_SYMBOLS,
  type ProcessStatus,
} from "@/lib/constants/production";
import type { ChildItemFilters } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import { childItemFilterChips, childItemQueryString } from "@/lib/utils/filters";
import { fabrica1ProcessColumns } from "@/lib/utils/production";
import { truncate } from "@/lib/utils/formatting";
import {
  DeliveryPeriodPopover,
  FilterMenu,
  NumericRangeFilter,
  SeqEqualityFilter,
  TextColumnFilter,
} from "@/components/shared/column-filters";
import { Button } from "@/components/ui/button";

/** Grava um conjunto de filtros da Fábrica 1 na URL e volta para a primeira página. */
function useApplyChildItemFilters(filters: ChildItemFilters) {
  const router = useRouter();
  const pathname = usePathname();

  return (overrides: Partial<ChildItemFilters>) => {
    const query = childItemQueryString({ ...filters, ...overrides, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/**
 * Cabeçalho de coluna da Fábrica 1: rótulo + filtro opcional.
 * Sem ordenação — a ordem das linhas é fixa (entrega → item pai → descrição).
 */
export function Fabrica1ColumnHeader({
  label,
  fullLabel,
  filter,
}: {
  label: string;
  fullLabel?: string;
  filter?: ReactNode;
}) {
  const fullName = fullLabel ?? label;

  return (
    <span className="flex w-full items-center justify-between gap-1">
      <span className="truncate px-1" title={fullName}>
        <span aria-hidden>{label}</span>
        <span className="sr-only">{fullName}</span>
      </span>
      {filter}
    </span>
  );
}

type ChildTextFilterField =
  | "orderCode"
  | "customer"
  | "parentItem"
  | "childItem"
  | "description"
  | "material";

/** Filtro "contém" de uma coluna de texto da Fábrica 1. */
export function Fabrica1TextFilter({
  filters,
  field,
  column,
  context,
}: {
  filters: ChildItemFilters;
  field: ChildTextFilterField;
  column: string;
  context: string;
}) {
  const apply = useApplyChildItemFilters(filters);

  return (
    <TextColumnFilter
      value={filters[field]}
      column={column}
      context={context}
      onApply={(value) => apply({ [field]: value } as Partial<ChildItemFilters>)}
    />
  );
}

/**
 * Filtro da coluna "Filho": código e descrição no mesmo painel — a coluna
 * mostra as duas informações, então os dois campos andam juntos.
 */
export function Fabrica1ChildItemFilter({ filters }: { filters: ChildItemFilters }) {
  const apply = useApplyChildItemFilters(filters);

  return (
    <TextColumnFilter
      value={filters.childItem}
      secondary={{ value: filters.description, column: "Descrição" }}
      column="Filho"
      context="código ou descrição do filho"
      onApply={(childItem, description) => apply({ childItem, description })}
    />
  );
}

/** Filtro da coluna "Entrega": período De/Até sobre a data do filho. */
export function Fabrica1DeliveryFilter({ filters }: { filters: ChildItemFilters }) {
  const apply = useApplyChildItemFilters(filters);
  const active = filters.deliveryFrom !== null || filters.deliveryTo !== null;

  return (
    <DeliveryPeriodPopover
      active={active}
      from={filters.deliveryFrom}
      to={filters.deliveryTo}
      idPrefix="f1-entrega"
      onApply={(from, to) => apply({ deliveryFrom: from, deliveryTo: to })}
    />
  );
}

/** Filtro da coluna Seq. — igualdade (menor seq do grupo = N, 038). */
export function Fabrica1SeqFilter({ filters }: { filters: ChildItemFilters }) {
  const apply = useApplyChildItemFilters(filters);

  return (
    <SeqEqualityFilter
      context="sequência de fabricação"
      value={filters.seq}
      idPrefix="f1-seq"
      onApply={(value) => apply({ seq: value })}
    />
  );
}

interface Fabrica1NumericFilterProps {
  filters: ChildItemFilters;
  minField: "qtyMin" | "weightMin" | "weightUnitMin";
  maxField: "qtyMax" | "weightMax" | "weightUnitMax";
  /** Rótulo da coluna, ex.: "Qtd.". */
  column: string;
  /** Contexto do título/aria, ex.: "quantidade do grupo". */
  context: string;
  /** Passo dos campos (padrão "1"; pesos usam "0.001"). */
  step?: string;
}

/**
 * Filtro de faixa numérica (De/Até) por coluna da Fábrica 1 (038) —
 * a faixa vale sobre os AGREGADOS do grupo (Σ qtd, Σ peso, peso unitário).
 */
export function Fabrica1NumericFilter({
  filters,
  minField,
  maxField,
  column,
  context,
  step,
}: Fabrica1NumericFilterProps) {
  const apply = useApplyChildItemFilters(filters);

  return (
    <NumericRangeFilter
      context={context}
      column={column}
      min={filters[minField]}
      max={filters[maxField]}
      idPrefix={`f1-${minField}`}
      step={step}
      onApply={(min, max) => apply({ [minField]: min, [maxField]: max } as Partial<ChildItemFilters>)}
    />
  );
}

/**
 * Filtro de UMA coluna de processo: situação daquele processo da cadeia
 * (038). Só existe um filtro de processo por vez no backend — ativar aqui
 * substitui o de outra coluna/de grupo; "Todas" limpa o par.
 */
export function Fabrica1ProcessColumnFilter({ filters, code }: { filters: ChildItemFilters; code: string }) {
  const apply = useApplyChildItemFilters(filters);
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
            : { processCode: code, processStatus: next as ProcessStatus },
        )
      }
    />
  );
}

/**
 * Filtro do grupo "PROCESSOS": situação em qualquer etapa editável desta tela
 * (o MP fica de fora — ele mostra o status do item pai, que é filtrado pela
 * situação do próprio pai na gestão de entregas).
 */
export function Fabrica1ProcessGroupFilter({ filters }: { filters: ChildItemFilters }) {
  const apply = useApplyChildItemFilters(filters);
  const active = filters.processCode === "ALL" && filters.processStatus !== "ALL";
  const value = filters.processCode === "ALL" ? filters.processStatus : "ALL";

  return (
    <FilterMenu
      context="situação em qualquer processo da Fábrica 1"
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
          processStatus: next === "ALL" ? "ALL" : (next as ProcessStatus),
        })
      }
    />
  );
}

/**
 * Opções do select "Processo" (barra mobile): a cadeia da Fábrica 1 sem o MP,
 * que aqui é somente leitura.
 */
export function fabrica1ProcessOptions(processes: readonly ProcessDefinition[]): ProcessDefinition[] {
  const editable = new Set(FABRICA1_EDITABLE_PROCESS_CODES);
  return fabrica1ProcessColumns(processes).filter((process) => editable.has(process.code));
}

/** Chips de "filtros ativos" da Fábrica 1 — um chip por filtro ligado. */
export function Fabrica1ActiveFilters({ filters }: { filters: ChildItemFilters }) {
  const router = useRouter();
  const pathname = usePathname();

  const chips = childItemFilterChips(filters);
  if (chips.length === 0) return null;

  const apply = (overrides: Partial<ChildItemFilters>) => {
    const query = childItemQueryString({ ...filters, ...overrides, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <section aria-label="Filtros ativos" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Filtros ativos:</span>

      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => apply(chip.clear)}
          aria-label={`Remover filtro: ${chip.label}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{truncate(chip.label, 48)}</span>
          <X className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}

      <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
        <X className="h-4 w-4" aria-hidden />
        Limpar filtros
      </Button>
    </section>
  );
}
