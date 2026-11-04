"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { toast } from "sonner";

import {
  ROMANEIO_STATUSES,
  ROMANEIO_STATUS_LABELS,
  type RomaneioStatus,
} from "@/lib/constants/romaneio";
import { romaneioProcessColumns } from "@/lib/constants/processes";
import {
  PROCESS_STATUSES,
  PROCESS_STATUS_LABELS,
  PROCESS_STATUS_SYMBOLS,
  type ProcessStatus,
} from "@/lib/constants/production";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { RomaneioFilters as RomaneioFilterValues } from "@/lib/types/romaneio";
import type { ProcessDefinition } from "@/lib/types/production";
import {
  hasRomaneioFilters,
  normalizeDeliveryPeriod,
  romaneioQueryString,
} from "@/lib/utils/filters";
import { toNumber } from "@/lib/utils/formatting";
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
  /** 049: catálogo ativo — base do seletor de coluna de processo (F2). */
  processes: ProcessDefinition[];
}

/**
 * Faixa De/Até de um filtro numérico: vazio = lado aberto; valor não
 * numérico/negativo ou faixa invertida é recusado com toast (nunca chega
 * à URL — mesma regra dos popovers de cabeçalho).
 */
function parseRange(
  from: string,
  to: string,
): { min: number | null; max: number | null; error: string | null } {
  const parse = (raw: string): { value: number | null; invalid: boolean } => {
    const trimmed = raw.trim();
    if (trimmed === "") return { value: null, invalid: false };
    const parsed = toNumber(trimmed);
    if (parsed === null || parsed < 0) return { value: null, invalid: true };
    return { value: parsed, invalid: false };
  };

  const min = parse(from);
  const max = parse(to);
  if (min.invalid || max.invalid) {
    return { min: null, max: null, error: "Informe números válidos (sem negativos)." };
  }
  if (min.value !== null && max.value !== null && min.value > max.value) {
    return { min: null, max: null, error: 'O valor "de" não pode ser maior que o "até".' };
  }
  return { min: min.value, max: max.value, error: null };
}

/**
 * Barra de filtros da listagem de romaneios no MOBILE (nos cards não há
 * cabeçalho de coluna): busca, situação, OF, cliente, saída, faixa de nº,
 * faixa de peso e os dois números de NF. No desktop os filtros ficam nos
 * cabeçalhos das colunas (RomaneioColumnHeaders).
 */
export function RomaneioFilters({ filters, processes }: RomaneioFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(filters.search);
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  const [shipmentFrom, setShipmentFrom] = useState(filters.shipmentFrom ?? "");
  const [shipmentTo, setShipmentTo] = useState(filters.shipmentTo ?? "");
  const numberFromRef = useRef<HTMLInputElement>(null);
  const numberToRef = useRef<HTMLInputElement>(null);
  const weightFromRef = useRef<HTMLInputElement>(null);
  const weightToRef = useRef<HTMLInputElement>(null);
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
      toast.error('A data "de" não pode ser posterior à data "até".');
      return;
    }
    if (period.error !== null) return;
    if (
      period.from === filtersRef.current.shipmentFrom &&
      period.to === filtersRef.current.shipmentTo
    ) {
      return;
    }
    apply({ shipmentFrom: period.from, shipmentTo: period.to });
  };

  /**
   * Faixa numérica (Nº ou Peso): o "outro lado" sai do campo irmão (a
   * digitação é local até o blur/Enter, então a URL ainda não o guarda).
   */
  const commitNumberRange = (
    field: "number" | "weight",
    from: string,
    to: string,
  ) => {
    const range = parseRange(from, to);
    if (range.error !== null) {
      toast.error(range.error);
      return;
    }
    const current = filtersRef.current;
    const same =
      field === "number"
        ? current.numberFrom === range.min && current.numberTo === range.max
        : current.weightFrom === range.min && current.weightTo === range.max;
    if (same) return;

    apply(
      field === "number"
        ? { numberFrom: range.min, numberTo: range.max }
        : { weightFrom: range.min, weightTo: range.max },
    );
  };

  const hasFilters = hasRomaneioFilters(filters);
  // 049: mesmas colunas da tabela (regra F2 menos MP e KIT).
  const processOptions = romaneioProcessColumns(processes);

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
          <Label htmlFor="romaneio-situacao" className="text-xs text-muted-foreground">
            Situação
          </Label>
          <Select
            value={filters.status}
            onValueChange={(value) =>
              apply({ status: value as RomaneioStatus | "ALL", search: search.trim() })
            }
          >
            <SelectTrigger id="romaneio-situacao" className="w-full">
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

        {/* 049: par processo+situação (um filtro de processo por vez). */}
        <div className="space-y-1">
          <Label htmlFor="romaneio-processo" className="text-xs text-muted-foreground">
            Processo (F2)
          </Label>
          <Select
            value={filters.processCode}
            onValueChange={(value) =>
              apply(
                value === "ALL"
                  ? { processCode: "ALL", processStatus: "ALL" }
                  : { processCode: value },
              )
            }
          >
            <SelectTrigger id="romaneio-processo" className="w-full">
              <SelectValue placeholder="Nenhum processo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Nenhum processo</SelectItem>
              {processOptions.map((process) => (
                <SelectItem key={process.code} value={process.code}>
                  {process.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="romaneio-procsituacao" className="text-xs text-muted-foreground">
            Situação do processo
          </Label>
          <Select
            value={filters.processStatus}
            onValueChange={(value) => {
              if (filters.processCode === "ALL") {
                toast.error("Escolha um processo primeiro para filtrar pela situação.");
                return;
              }
              apply(
                value === "ALL"
                  ? { processCode: "ALL", processStatus: "ALL" }
                  : { processStatus: value as ProcessStatus },
              );
            }}
          >
            <SelectTrigger id="romaneio-procsituacao" className="w-full">
              <SelectValue placeholder="Todas as situações" />
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

        <div className="space-y-1">
          <Label htmlFor="romaneio-of" className="text-xs text-muted-foreground">
            OF/OS
          </Label>
          <Input
            id="romaneio-of"
            type="text"
            defaultValue={filters.orderCode}
            onBlur={(event) =>
              apply({ orderCode: event.target.value.trim(), search: search.trim() })
            }
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
            onBlur={(event) =>
              apply({ customer: event.target.value.trim(), search: search.trim() })
            }
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

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="romaneio-numero-de" className="text-xs text-muted-foreground">
              Nº de
            </Label>
            <Input
              id="romaneio-numero-de"
              ref={numberFromRef}
              type="text"
              inputMode="numeric"
              defaultValue={filters.numberFrom ?? ""}
              onBlur={(event) =>
                commitNumberRange("number", event.target.value, numberToRef.current?.value ?? "")
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitNumberRange(
                    "number",
                    event.currentTarget.value,
                    numberToRef.current?.value ?? "",
                  );
                }
              }}
              placeholder="Mínimo"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-numero-ate" className="text-xs text-muted-foreground">
              Nº até
            </Label>
            <Input
              id="romaneio-numero-ate"
              ref={numberToRef}
              type="text"
              inputMode="numeric"
              defaultValue={filters.numberTo ?? ""}
              onBlur={(event) =>
                commitNumberRange("number", numberFromRef.current?.value ?? "", event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitNumberRange(
                    "number",
                    numberFromRef.current?.value ?? "",
                    event.currentTarget.value,
                  );
                }
              }}
              placeholder="Máximo"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="romaneio-peso-de" className="text-xs text-muted-foreground">
              Peso de (kg)
            </Label>
            <Input
              id="romaneio-peso-de"
              ref={weightFromRef}
              type="text"
              inputMode="decimal"
              defaultValue={filters.weightFrom ?? ""}
              onBlur={(event) =>
                commitNumberRange("weight", event.target.value, weightToRef.current?.value ?? "")
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitNumberRange(
                    "weight",
                    event.currentTarget.value,
                    weightToRef.current?.value ?? "",
                  );
                }
              }}
              placeholder="Mínimo"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="romaneio-peso-ate" className="text-xs text-muted-foreground">
              Peso até (kg)
            </Label>
            <Input
              id="romaneio-peso-ate"
              ref={weightToRef}
              type="text"
              inputMode="decimal"
              defaultValue={filters.weightTo ?? ""}
              onBlur={(event) =>
                commitNumberRange("weight", weightFromRef.current?.value ?? "", event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitNumberRange(
                    "weight",
                    weightFromRef.current?.value ?? "",
                    event.currentTarget.value,
                  );
                }
              }}
              placeholder="Máximo"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="romaneio-nfsaida" className="text-xs text-muted-foreground">
            NF saída
          </Label>
          <Input
            id="romaneio-nfsaida"
            type="text"
            defaultValue={filters.nfNumber}
            onBlur={(event) =>
              apply({ nfNumber: event.target.value.trim(), search: search.trim() })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply({ nfNumber: event.currentTarget.value.trim(), search: search.trim() });
              }
            }}
            placeholder="Contém…"
            autoComplete="off"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="romaneio-nfdev" className="text-xs text-muted-foreground">
            NF devolução
          </Label>
          <Input
            id="romaneio-nfdev"
            type="text"
            defaultValue={filters.returnNfNumber}
            onBlur={(event) =>
              apply({ returnNfNumber: event.target.value.trim(), search: search.trim() })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply({ returnNfNumber: event.currentTarget.value.trim(), search: search.trim() });
              }
            }}
            placeholder="Contém…"
            autoComplete="off"
          />
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
