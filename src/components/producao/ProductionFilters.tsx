"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS } from "@/lib/constants/production";
import { DELIVERY_FILTERS, DELIVERY_LABELS, SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { ProcessDefinition, ProductionFilters as Filters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProductionFiltersProps {
  filters: Filters;
  processes: ProcessDefinition[];
}

/** Filtros da tela de gestão de entregas no mobile (no desktop os filtros ficam nos cabeçalhos das colunas). */
export function ProductionFiltersBar({ filters, processes }: ProductionFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  const [customer, setCustomer] = useState(filters.customer);
  const [syncedCustomer, setSyncedCustomer] = useState(filters.customer);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza os campos com a URL quando os filtros mudam por fora
  // (limpar filtros, navegação) — padrão de "ajuste durante a renderização".
  if (syncedSearch !== filters.search) {
    setSyncedSearch(filters.search);
    setSearch(filters.search);
  }
  if (syncedCustomer !== filters.customer) {
    setSyncedCustomer(filters.customer);
    setCustomer(filters.customer);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (customerDebounceRef.current) clearTimeout(customerDebounceRef.current);
    };
  }, []);

  const apply = (overrides: Partial<Filters>) => {
    const next: Filters = { ...filters, ...overrides, page: 1 };
    const query = productionQueryString(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply({ search: value }), SEARCH_DEBOUNCE_MS);
  };

  const onCustomerChange = (value: string) => {
    setCustomer(value);
    if (customerDebounceRef.current) clearTimeout(customerDebounceRef.current);
    customerDebounceRef.current = setTimeout(() => apply({ customer: value.trim() }), SEARCH_DEBOUNCE_MS);
  };

  const setSelect = (key: keyof Filters) => (value: string) => apply({ [key]: value } as Partial<Filters>);

  return (
    <section aria-label="Filtros da gestão de entregas" className="rounded border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1 md:col-span-2 xl:col-span-1">
          <Label htmlFor="producao-busca" className="text-xs text-muted-foreground">
            Busca
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="producao-busca"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="OF/OS, tipo, item, descrição…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="producao-cliente" className="text-xs text-muted-foreground">
            Cliente
          </Label>
          <Input
            id="producao-cliente"
            value={customer}
            onChange={(event) => onCustomerChange(event.target.value)}
            placeholder="Contém…"
            autoComplete="off"
          />
        </div>

        <FilterSelect
          id="producao-status"
          label="Situação do pedido"
          value={filters.orderStatus}
          onValueChange={setSelect("orderStatus")}
          options={[
            { value: "ALL", label: "Todas as situações" },
            ...ORDER_STATUSES.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
          ]}
        />

        <FilterSelect
          id="producao-processo"
          label="Processo"
          value={filters.processCode}
          onValueChange={setSelect("processCode")}
          options={[
            { value: "ALL", label: "Todos os processos" },
            ...processes.map((process) => ({ value: process.code, label: process.name })),
          ]}
        />

        <FilterSelect
          id="producao-situacao"
          label="Situação do processo"
          value={filters.processStatus}
          onValueChange={setSelect("processStatus")}
          options={[
            { value: "ALL", label: "Todas as situações" },
            ...PROCESS_STATUSES.map((status) => ({
              value: status,
              label: `${PROCESS_STATUS_SYMBOLS[status]} ${PROCESS_STATUS_LABELS[status]}`,
            })),
          ]}
        />

        <FilterSelect
          id="producao-entrega"
          label="Entrega"
          value={filters.delivery}
          onValueChange={setSelect("delivery")}
          options={DELIVERY_FILTERS.map((value) => ({ value, label: DELIVERY_LABELS[value] }))}
        />

        {/* Período de entrega (014): lados opcionais, combina com a janela acima */}
        <div className="grid grid-cols-2 gap-3 md:col-span-2 xl:col-span-3">
          <div className="space-y-1">
            <Label htmlFor="producao-entrega-de" className="text-xs text-muted-foreground">
              Entrega de
            </Label>
            <Input
              id="producao-entrega-de"
              type="date"
              value={filters.deliveryFrom ?? ""}
              max={filters.deliveryTo ?? undefined}
              onChange={(event) => apply({ deliveryFrom: event.target.value || null })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="producao-entrega-ate" className="text-xs text-muted-foreground">
              Entrega até
            </Label>
            <Input
              id="producao-entrega-ate"
              type="date"
              value={filters.deliveryTo ?? ""}
              min={filters.deliveryFrom ?? undefined}
              onChange={(event) => apply({ deliveryTo: event.target.value || null })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}

function FilterSelect({ id, label, value, options, onValueChange }: FilterSelectProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
