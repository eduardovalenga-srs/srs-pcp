"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import {
  PROCESS_STATUSES,
  PROCESS_STATUS_LABELS,
  PROCESS_STATUS_SYMBOLS,
} from "@/lib/constants/production";
import type { ChildItemFilters as ChildItemFilterValues } from "@/lib/types/order";
import type { ProcessDefinition } from "@/lib/types/production";
import { childItemQueryString, normalizeDeliveryPeriod } from "@/lib/utils/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fabrica1ProcessOptions } from "@/components/fabrica1/Fabrica1ColumnHeaders";

interface Fabrica1FiltersProps {
  filters: ChildItemFilterValues;
  /** Catálogo ativo — opções do select "Processo" (cadeia da Fábrica 1). */
  processes: ProcessDefinition[];
}

/**
 * Filtros da Fábrica 1 no mobile (no desktop eles moram nos cabeçalhos das
 * colunas). Os campos de texto têm debounce próprio e gravam na URL.
 */
export function Fabrica1Filters({ filters, processes }: Fabrica1FiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const apply = (overrides: Partial<ChildItemFilterValues>) => {
    const next: ChildItemFilterValues = { ...filters, ...overrides, page: 1 };
    const query = childItemQueryString(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  // --- Período de entrega ------------------------------------------------
  // Rascunho local: o <input type="date"> expõe "" enquanto a data está
  // incompleta, então aplicar a URL a cada tecla apagava dia/mês ao chegar
  // no ano. O campo guarda o próprio rascunho e a URL só muda em
  // "Aplicar"/Enter (ou no blur já com os dois lados preenchidos).
  const appliedFrom = filters.deliveryFrom ?? "";
  const appliedTo = filters.deliveryTo ?? "";

  const [draftFrom, setDraftFrom] = useState(appliedFrom);
  const [draftTo, setDraftTo] = useState(appliedTo);
  const [syncedFrom, setSyncedFrom] = useState(appliedFrom);
  const [syncedTo, setSyncedTo] = useState(appliedTo);

  // Último período enviado à URL: o eco da navegação chega depois, com os
  // filtros novos, e não pode reescrever o rascunho do lado digitado.
  const [sent, setSent] = useState({ from: filters.deliveryFrom, to: filters.deliveryTo });

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

  const commitPeriod = (completeOnly: boolean) => {
    if (period.error !== null) return;
    if (completeOnly && (period.from === null || period.to === null)) return;
    if (sent.from === period.from && sent.to === period.to) return;
    setSent({ from: period.from, to: period.to });
    apply({ deliveryFrom: period.from, deliveryTo: period.to });
  };

  const hasFilters =
    filters.search !== "" ||
    filters.orderCode !== "" ||
    filters.customer !== "" ||
    filters.material !== "" ||
    filters.parentItem !== "" ||
    filters.childItem !== "" ||
    filters.description !== "" ||
    filters.deliveryFrom !== null ||
    filters.deliveryTo !== null ||
    filters.processCode !== "ALL" ||
    filters.processStatus !== "ALL";

  const processOptions = fabrica1ProcessOptions(processes);

  return (
    <section aria-label="Filtros dos itens filhos" className="rounded border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DebouncedFilterField
          id="fabrica1-busca"
          label="Busca (item filho)"
          value={filters.search}
          placeholder="Descrição ou código da peça…"
          icon
          onApply={(value) => apply({ search: value })}
        />

        <DebouncedFilterField
          id="fabrica1-of"
          label="OF/OS"
          value={filters.orderCode}
          placeholder="Ex.: 107482"
          onApply={(value) => apply({ orderCode: value })}
        />

        <DebouncedFilterField
          id="fabrica1-cliente"
          label="Cliente"
          value={filters.customer}
          placeholder="Contém…"
          onApply={(value) => apply({ customer: value })}
        />

        <DebouncedFilterField
          id="fabrica1-material"
          label="Material"
          value={filters.material}
          placeholder="Ex.: chapa, barra…"
          onApply={(value) => apply({ material: value })}
        />

        <div className="space-y-1">
          <Label htmlFor="fabrica1-processo" className="text-xs text-muted-foreground">
            Processo
          </Label>
          <Select
            value={filters.processCode}
            onValueChange={(value) => apply({ processCode: value })}
          >
            <SelectTrigger id="fabrica1-processo" className="w-full">
              <SelectValue placeholder="Processo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os processos</SelectItem>
              {processOptions.map((process) => (
                <SelectItem key={process.code} value={process.code}>
                  {process.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="fabrica1-situacao" className="text-xs text-muted-foreground">
            Situação do processo
          </Label>
          <Select
            value={filters.processStatus}
            onValueChange={(value) => apply({ processStatus: value as ChildItemFilterValues["processStatus"] })}
          >
            <SelectTrigger id="fabrica1-situacao" className="w-full">
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as situações</SelectItem>
              {PROCESS_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {PROCESS_STATUS_SYMBOLS[status]} {PROCESS_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 md:col-span-2 xl:grid xl:grid-cols-2 xl:gap-3">
          <div className="space-y-1">
            <Label htmlFor="fabrica1-entrega-de" className="text-xs text-muted-foreground">
              Entrega de
            </Label>
            <Input
              id="fabrica1-entrega-de"
              type="date"
              value={draftFrom}
              max={draftTo || undefined}
              onChange={(event) => setDraftFrom(event.target.value)}
              onBlur={() => commitPeriod(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPeriod(false);
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fabrica1-entrega-ate" className="text-xs text-muted-foreground">
              Entrega até
            </Label>
            <Input
              id="fabrica1-entrega-ate"
              type="date"
              value={draftTo}
              min={draftFrom || undefined}
              onChange={(event) => setDraftTo(event.target.value)}
              onBlur={() => commitPeriod(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitPeriod(false);
                }
              }}
            />
          </div>

          {period.error === "inverted" ? (
            <p className="text-xs text-destructive" role="status">
              A data inicial é posterior à final.
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={period.error !== null || (period.from === sent.from && period.to === sent.to)}
              onClick={() => commitPeriod(false)}
            >
              Aplicar
            </Button>
          </div>
        </div>

        <div className="flex items-end">
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => router.replace(pathname, { scroll: false })}>
              <X className="h-4 w-4" aria-hidden />
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Campo de texto com debounce próprio — sincroniza com a URL quando ela muda por fora. */
function DebouncedFilterField({
  id,
  label,
  value,
  placeholder,
  icon = false,
  onApply,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  /** Mostra a lupa à esquerda (campo de busca). */
  icon?: boolean;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza o campo com a URL quando os filtros mudam por fora
  // (limpar filtros, chip, navegação) — padrão de "ajuste durante a renderização".
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const change = (next: string) => {
    setDraft(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onApply(next.trim()), SEARCH_DEBOUNCE_MS);
  };

  const applyNow = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onApply(draft.trim());
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className={icon ? "relative" : undefined}>
        {icon ? (
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        ) : null}
        <Input
          id={id}
          value={draft}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyNow();
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          className={icon ? "pl-8" : undefined}
        />
      </div>
    </div>
  );
}
