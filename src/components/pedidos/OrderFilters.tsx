"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants/orders";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { OrderFilters as OrderFilterValues } from "@/lib/types/order";
import { orderQueryString } from "@/lib/utils/filters";
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

interface OrderFiltersProps {
  filters: OrderFilterValues;
}

/** Filtros da listagem de pedidos (busca e situação vivem na URL). */
export function OrderFilters({ filters }: OrderFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);

  // Sincroniza o campo com a URL quando os filtros mudam por fora
  // (limpar filtros, navegação) — padrão de "ajuste durante a renderização".
  if (syncedSearch !== filters.search) {
    setSyncedSearch(filters.search);
    setSearch(filters.search);
  }

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const apply = (overrides: Partial<OrderFilterValues>) => {
    const next: OrderFilterValues = { ...filtersRef.current, ...overrides, page: 1 };
    const query = orderQueryString(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply({ search: value.trim() }), SEARCH_DEBOUNCE_MS);
  };

  const hasFilters = filters.search !== "" || filters.status !== "ALL";

  return (
    <section aria-label="Filtros dos pedidos" className="rounded border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pedidos-busca" className="text-xs text-muted-foreground">
            Busca
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="pedidos-busca"
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
              placeholder="OF/OS, cliente ou descrição…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="pedidos-status" className="text-xs text-muted-foreground">
            Situação
          </Label>
          <Select
            value={filters.status}
            onValueChange={(value) =>
              apply({ status: value as OrderStatus | "ALL", search: search.trim() })
            }
          >
            <SelectTrigger id="pedidos-status" className="w-full">
              <SelectValue placeholder="Todas as situações" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as situações</SelectItem>
              {ORDER_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {ORDER_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          {hasFilters ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
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
