"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, X } from "lucide-react";

import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS } from "@/lib/constants/production";
import { DELIVERY_FILTERS, DELIVERY_LABELS } from "@/lib/constants/pagination";
import type { ProductionFilters } from "@/lib/types/production";
import { normalizeDeliveryPeriod, productionQueryString } from "@/lib/utils/filters";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      href={query ? `/gestao-entregas?${query}` : "/gestao-entregas"}
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

interface FilterOption {
  value: string;
  label: string;
}

/** Aparência compartilhada do funil de filtro no cabeçalho. */
function funnelClassName(active: boolean): string {
  return cn(
    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
    "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-primary/15 text-primary" : "text-muted-foreground/60",
  );
}

function funnelTitle(context: string): string {
  return `Filtrar por ${context}`;
}

function funnelAriaLabel(context: string, active: boolean): string {
  return `${funnelTitle(context)}${active ? " — filtro ativo" : ""}`;
}

/** Ícone do funil — quando ativo, fica preenchido (além da cor). */
function FunnelIcon({ active }: { active: boolean }) {
  return <Filter className={cn("h-3 w-3", active && "fill-current")} aria-hidden />;
}

interface FilterMenuProps {
  /** Contexto do filtro, ex.: "situação do pedido" (vai para aria-label e título). */
  context: string;
  value: string;
  active: boolean;
  options: FilterOption[];
  onValueChange: (value: string) => void;
}

/**
 * Funil no cabeçalho da coluna: abre as opções daquele filtro.
 * O estado ativo não é comunicado só por cor — o ícone fica preenchido e o
 * rótulo acessível indica "filtro ativo".
 */
function FilterMenu({ context, value, active, options, onValueChange }: FilterMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{context}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

  const appliedFrom = filters.deliveryFrom ?? "";
  const appliedTo = filters.deliveryTo ?? "";

  // Rascunho do período: o <input type="date"> expõe "" enquanto a data está
  // incompleta, então aplicar a URL a cada tecla (ou no blur de um campo)
  // apagava o dia/mês já digitado e nem deixava preencher o outro lado. O
  // campo guarda o próprio rascunho e a URL só muda em "Aplicar"/Enter.
  const [draftFrom, setDraftFrom] = useState(appliedFrom);
  const [draftTo, setDraftTo] = useState(appliedTo);
  const [syncedFrom, setSyncedFrom] = useState(appliedFrom);
  const [syncedTo, setSyncedTo] = useState(appliedTo);
  const [open, setOpen] = useState(false);

  // Último período enviado à URL: o eco da navegação chega depois, com os
  // filtros novos, e não pode reescrever o rascunho do lado que o usuário
  // já está digitando em seguida.
  const [sent, setSent] = useState({ from: filters.deliveryFrom, to: filters.deliveryTo });

  // Sincroniza o rascunho com a URL quando os filtros mudam por fora
  // (limpar filtros, chip, navegação) — padrão de "ajuste durante a renderização".
  if (syncedFrom !== appliedFrom || syncedTo !== appliedTo) {
    setSyncedFrom(appliedFrom);
    setSyncedTo(appliedTo);
    const echo = sent.from === filters.deliveryFrom && sent.to === filters.deliveryTo;
    if (!echo) {
      setSent({ from: filters.deliveryFrom, to: filters.deliveryTo });
      setDraftFrom(appliedFrom);
      setDraftTo(appliedTo);
    }
  }

  const period = normalizeDeliveryPeriod(draftFrom, draftTo);

  /**
   * Aplica o período na URL. `completeOnly` é o caminho do blur: sair de um
   * campo com o outro lado ainda vazio não navega (o re-render apagaria o que
   * o usuário fosse digitar em seguida). Lado único só via Aplicar/Enter.
   */
  const commit = (completeOnly: boolean) => {
    if (period.error !== null) return;
    if (completeOnly && (period.from === null || period.to === null)) return;
    if (sent.from === period.from && sent.to === period.to) return;
    setSent({ from: period.from, to: period.to });
    apply({ deliveryFrom: period.from, deliveryTo: period.to });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Cada abertura parte do período vigente — descartar edições abandonadas.
    if (next) {
      setDraftFrom(appliedFrom);
      setDraftTo(appliedTo);
    }
  };

  const canApply =
    period.error === null && (period.from !== sent.from || period.to !== sent.to);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={funnelTitle("entrega")}
          aria-label={funnelAriaLabel("entrega", active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
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

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="entrega-de" className="text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id="entrega-de"
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(event) => setDraftFrom(event.target.value)}
              onBlur={() => commit(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(false);
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entrega-ate" className="text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id="entrega-ate"
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(event) => setDraftTo(event.target.value)}
              onBlur={() => commit(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit(false);
                }
              }}
            />
          </div>
        </div>

        {period.error === "inverted" ? (
          <p className="text-xs text-destructive" role="status">
            A data inicial é posterior à final.
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!active}
            onClick={() => {
              setSent({ from: null, to: null });
              setDraftFrom("");
              setDraftTo("");
              apply({ delivery: "ALL", deliveryFrom: null, deliveryTo: null });
            }}
          >
            Limpar
          </Button>
          <Button type="button" size="sm" disabled={!canApply} onClick={() => commit(false)}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters[field]);

  const value = filters[field];
  const active = value !== "";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(value);
  };

  const commit = (next: string) => {
    const trimmed = next.trim();
    setDraft(trimmed);
    const patch: Partial<ProductionFilters> = {};
    patch[field] = trimmed;
    apply(patch);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={funnelTitle(context)}
          aria-label={funnelAriaLabel(context, active)}
          className={funnelClassName(active)}
        >
          <FunnelIcon active={active} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3">
        <Label htmlFor={inputId} className="text-xs text-muted-foreground">
          {column} — contém
        </Label>
        <Input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(draft);
            }
          }}
          placeholder="Digite parte do valor…"
          autoComplete="off"
          className="h-8"
        />
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!active} onClick={() => commit("")}>
            <X className="h-4 w-4" aria-hidden />
            Limpar
          </Button>
          <Button type="button" size="sm" onClick={() => commit(draft)}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Cabeçalho do grupo "DADOS DOS PEDIDOS" (a busca genérica foi removida). */
export function OrderGroupHeader() {
  return <span>DADOS DOS PEDIDOS</span>;
}
