"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { ChildItemFilters as ChildItemFilterValues } from "@/lib/types/order";
import { childItemQueryString } from "@/lib/utils/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Fabrica1FiltersProps {
  filters: ChildItemFilterValues;
}

/** Filtros da tela Fábrica 1 — busca (filho), OF/OS e material vivem na URL. */
export function Fabrica1Filters({ filters }: Fabrica1FiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(filters.search);
  const [orderCode, setOrderCode] = useState(filters.orderCode);
  const [material, setMaterial] = useState(filters.material);
  const [synced, setSynced] = useState(filters);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);

  // Sincroniza os campos com a URL quando os filtros mudam por fora
  // (limpar filtros, navegação) — padrão de "ajuste durante a renderização".
  if (synced !== filters) {
    setSynced(filters);
    setSearch(filters.search);
    setOrderCode(filters.orderCode);
    setMaterial(filters.material);
  }

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const apply = (overrides: Partial<ChildItemFilterValues>) => {
    const next: ChildItemFilterValues = { ...filtersRef.current, ...overrides, page: 1 };
    const query = childItemQueryString(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const onFieldChange = (
    field: "search" | "orderCode" | "material",
    setter: (value: string) => void,
    value: string,
  ) => {
    setter(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => apply({ [field]: value.trim() } as Partial<ChildItemFilterValues>),
      SEARCH_DEBOUNCE_MS,
    );
  };

  const applyNow = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    apply({ search: search.trim(), orderCode: orderCode.trim(), material: material.trim() });
  };

  const clearAll = () => {
    setSearch("");
    setOrderCode("");
    setMaterial("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    router.replace(pathname, { scroll: false });
  };

  const hasFilters = filters.search !== "" || filters.orderCode !== "" || filters.material !== "";

  return (
    <section aria-label="Filtros dos itens filhos" className="rounded border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="fabrica1-busca" className="text-xs text-muted-foreground">
            Busca (item filho)
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="fabrica1-busca"
              type="text"
              value={search}
              onChange={(event) => onFieldChange("search", setSearch, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyNow();
                }
              }}
              placeholder="Descrição ou código da peça…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="fabrica1-of" className="text-xs text-muted-foreground">
            OF/OS
          </Label>
          <Input
            id="fabrica1-of"
            type="text"
            value={orderCode}
            onChange={(event) => onFieldChange("orderCode", setOrderCode, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyNow();
              }
            }}
            placeholder="Ex.: 107482"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="fabrica1-material" className="text-xs text-muted-foreground">
            Material
          </Label>
          <Input
            id="fabrica1-material"
            type="text"
            value={material}
            onChange={(event) => onFieldChange("material", setMaterial, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyNow();
              }
            }}
            placeholder="Ex.: chapa, barra…"
            autoComplete="off"
          />
        </div>

        <div className="flex items-end">
          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
              <X className="h-4 w-4" aria-hidden />
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
