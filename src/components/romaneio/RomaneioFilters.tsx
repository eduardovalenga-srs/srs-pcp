"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { toast } from "sonner";

import { ROMANEIO_STATUSES, ROMANEIO_STATUS_LABELS, type RomaneioStatus } from "@/lib/constants/romaneio";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { RomaneioFilters as RomaneioFilterValues } from "@/lib/types/romaneio";
import { normalizeDeliveryPeriod, romaneioQueryString } from "@/lib/utils/filters";
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

interface RomaneioFiltersProps {
  filters: RomaneioFilterValues;
}

/** Filtros da listagem de romaneios — busca, situação, OF, cliente e saída. */
export function RomaneioFilters({ filters }: RomaneioFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  const [shipmentFrom, setShipmentFrom] = useState(filters.shipmentFrom ?? "");
  const [shipmentTo, setShipmentTo] = useState(filters.shipmentTo ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);

  // Sincroniza os campos com a URL quando os filtros mudam por fora
  // (limpar filtros, navegação) — padrão de "ajuste durante a renderização".
  if (syncedSearch !== filters.search) {
    setSyncedSearch(filters.search);
    setSearch(filters.search);
    setShipmentFrom(filters.shipmentFrom ?? "");
    setShipmentTo(filters.shipmentTo ?? "");
  }

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const apply = (overrides: Partial<RomaneioFilterValues>) => {
    const next: RomaneioFilterValues = { ...filtersRef.current, ...overrides, page: 1 };
    const query = romaneioQueryString(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply({ search: value.trim() }), SEARCH_DEBOUNCE_MS);
  };

  /** Período de saída: aplica quando os dois lados formam período válido. */
  const commitPeriod = (nextFrom: string, nextTo: string) => {
    const period = normalizeDeliveryPeriod(nextFrom, nextTo);
    if (period.error === "inverted") {
      toast.error("A data \"de\" não pode ser posterior à data \"até\".");
      return;
    }
    if (period.error !== null) return;
    if (period.from === filtersRef.current.shipmentFrom && period.to === filtersRef.current.shipmentTo) {
      return;
    }
    apply({ shipmentFrom: period.from, shipmentTo: period.to });
  };

  const hasFilters =
    filters.search !== "" ||
    filters.status !== "ALL" ||
    filters.orderCode !== "" ||
    filters.customer !== "" ||
    filters.shipmentFrom !== null ||
    filters.shipmentTo !== null;

  return (
    <section aria-label="Filtros dos romaneios" className="rounded border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="romaneio-busca" className="text-xs text-muted-foreground">
            Busca
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="romaneio-busca"
              type="text"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  apply({ search: search.trim() });
                }
              }}
              placeholder="Nº do romaneio, OF/OS ou cliente…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="romaneio-status" className="text-xs text-muted-foreground">
            Situação
          </Label>
          <Select
            value={filters.status}
            onValueChange={(value) =>
              apply({ status: value as RomaneioStatus | "ALL", search: search.trim() })
            }
          >
            <SelectTrigger id="romaneio-status" className="w-full">
              <SelectValue placeholder="Todas as situações" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as situações</SelectItem>
              {ROMANEIO_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {ROMANEIO_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="romaneio-of" className="text-xs text-muted-foreground">
            OF/OS
          </Label>
          <Input
            id="romaneio-of"
            type="text"
            defaultValue={filters.orderCode}
            onBlur={(event) => apply({ orderCode: event.target.value.trim(), search: search.trim() })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply({ orderCode: event.currentTarget.value.trim(), search: search.trim() });
              }
            }}
            placeholder="Contém…"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="romaneio-cliente" className="text-xs text-muted-foreground">
            Cliente
          </Label>
          <Input
            id="romaneio-cliente"
            type="text"
            defaultValue={filters.customer}
            onBlur={(event) => apply({ customer: event.target.value.trim(), search: search.trim() })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply({ customer: event.currentTarget.value.trim(), search: search.trim() });
              }
            }}
            placeholder="Contém…"
            autoComplete="off"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="romaneio-saida-de" className="text-xs text-muted-foreground">
              Saída de
            </Label>
            <Input
              id="romaneio-saida-de"
              type="date"
              value={shipmentFrom}
              max={shipmentTo || undefined}
              onChange={(event) => {
                setShipmentFrom(event.target.value);
                commitPeriod(event.target.value, shipmentTo);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-saida-ate" className="text-xs text-muted-foreground">
              Saída até
            </Label>
            <Input
              id="romaneio-saida-ate"
              type="date"
              value={shipmentTo}
              min={shipmentFrom || undefined}
              onChange={(event) => {
                setShipmentTo(event.target.value);
                commitPeriod(shipmentFrom, event.target.value);
              }}
            />
          </div>
        </div>

        <div className="flex items-end">
          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setShipmentFrom("");
                setShipmentTo("");
                if (debounceRef.current) clearTimeout(debounceRef.current);
                router.replace(pathname, { scroll: false });
              }}
            >
              <X className="h-4 w-4" aria-hidden />
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
