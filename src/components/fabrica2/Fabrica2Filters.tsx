"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import { PROCESS_STATUSES, PROCESS_STATUS_LABELS, PROCESS_STATUS_SYMBOLS } from "@/lib/constants/production";
import { DELIVERY_FILTERS, DELIVERY_LABELS, SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { ProcessDefinition, ProductionFilters as Filters } from "@/lib/types/production";
import { normalizeDeliveryPeriod, productionQueryString } from "@/lib/utils/filters";
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

interface Fabrica2FiltersProps {
  filters: Filters;
  processes: ProcessDefinition[];
}

/** Filtros da tela da Fábrica 2 no mobile (no desktop os filtros ficam nos cabeçalhos das colunas). */
export function Fabrica2FiltersBar({ filters, processes }: Fabrica2FiltersProps) {
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

  // --- Período de entrega (014) ---------------------------------------
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
  // filtros novos, e não pode reescrever o rascunho do lado que o usuário
  // já está digitando em seguida.
  const [sent, setSent] = useState({ from: filters.deliveryFrom, to: filters.deliveryTo });

  // Sincroniza o rascunho do período com a URL quando os filtros mudam por fora
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
  const commitPeriod = (completeOnly: boolean) => {
    if (period.error !== null) return;
    if (completeOnly && (period.from === null || period.to === null)) return;
    if (sent.from === period.from && sent.to === period.to) return;
    setSent({ from: period.from, to: period.to });
    apply({ deliveryFrom: period.from, deliveryTo: period.to });
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
    <section aria-label="Filtros da Fábrica 2" className="rounded border bg-card p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1 md:col-span-2 xl:col-span-1">
          <Label htmlFor="f2-busca" className="text-xs text-muted-foreground">
            Busca
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="f2-busca"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="OF/OS, tipo, item, descrição…"
              className="pl-8"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="f2-cliente" className="text-xs text-muted-foreground">
            Cliente
          </Label>
          <Input
            id="f2-cliente"
            value={customer}
            onChange={(event) => onCustomerChange(event.target.value)}
            placeholder="Contém…"
            autoComplete="off"
          />
        </div>

        <FilterSelect
          id="f2-status"
          label="Situação do pedido"
          value={filters.orderStatus}
          onValueChange={setSelect("orderStatus")}
          options={[
            { value: "ALL", label: "Todas as situações" },
            ...ORDER_STATUSES.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
          ]}
        />

        <FilterSelect
          id="f2-processo"
          label="Processo"
          value={filters.processCode}
          onValueChange={setSelect("processCode")}
          options={[
            { value: "ALL", label: "Todos os processos" },
            ...processes.map((process) => ({ value: process.code, label: process.name })),
          ]}
        />

        <FilterSelect
          id="f2-situacao"
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
          id="f2-entrega"
          label="Entrega"
          value={filters.delivery}
          onValueChange={setSelect("delivery")}
          options={DELIVERY_FILTERS.map((value) => ({
            value,
            // Na Fábrica 2 "Atrasados" é a data da coluna ACAB.
            label: value === "OVERDUE" ? "Atrasados (ACAB)" : DELIVERY_LABELS[value],
          }))}
        />

        {/* Período de entrega (014): lados opcionais, combina com a janela acima */}
        <div className="space-y-2 md:col-span-2 xl:col-span-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="f2-entrega-de" className="text-xs text-muted-foreground">
                Entrega de
              </Label>
              <Input
                id="f2-entrega-de"
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
              <Label htmlFor="f2-entrega-ate" className="text-xs text-muted-foreground">
                Entrega até
              </Label>
              <Input
                id="f2-entrega-ate"
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
