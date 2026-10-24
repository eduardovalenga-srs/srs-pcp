"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { createRomaneioAction } from "@/lib/actions/romaneio.actions";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants/pagination";
import type { RomaneioCandidate, RomaneioCandidateFilters } from "@/lib/types/romaneio";
import { romaneioCandidateQueryString } from "@/lib/utils/filters";
import { formatDate } from "@/lib/utils/dates";
import { errorMessage } from "@/lib/utils/supabase-result";
import { formatQuantity, formatWeight } from "@/lib/utils/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderStatusBadge } from "@/components/shared/StatusBadges";

interface RomaneioOrderPickerProps {
  candidates: RomaneioCandidate[];
  filters: RomaneioCandidateFilters;
  total: number;
}

/** Seletor de OFs em /romaneio/novo: busca + uma ação por OF. */
export function RomaneioOrderPicker({ candidates, filters, total }: RomaneioOrderPickerProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState(filters.search);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const apply = (overrides: Partial<RomaneioCandidateFilters>) => {
    const next = { ...filtersRef.current, ...overrides, page: 1 };
    const query = romaneioCandidateQueryString(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const navigate = (page: number) => {
    const query = romaneioCandidateQueryString(filters, { page });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const onSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply({ search: value.trim() }), SEARCH_DEBOUNCE_MS);
  };

  const handleCreate = async (candidate: RomaneioCandidate) => {
    if (creatingId) return;
    setCreatingId(candidate.orderId);
    try {
      const result = await createRomaneioAction(candidate.orderId);
      if (!result.success || !result.romaneioId) {
        toast.error(result.message || "Não foi possível criar a simulação.");
        return;
      }
      toast.success(result.message);
      router.push(`/romaneio/${result.romaneioId}`);
    } catch (error) {
      console.error("[RomaneioOrderPicker]", error);
      toast.error(errorMessage(error));
    } finally {
      setCreatingId(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const current = Math.min(Math.max(filters.page, 1), pageCount);

  return (
    <div className="space-y-3">
      <section aria-label="Buscar OF" className="rounded border bg-card p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="romaneio-novo-busca" className="text-xs text-muted-foreground">
              Busca
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="romaneio-novo-busca"
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
                placeholder="Número da OF/OS ou cliente…"
                className="pl-8"
                autoComplete="off"
              />
            </div>
          </div>
          <p className="self-end text-sm text-muted-foreground">
            Escolha a OF que sai na carga. A simulação pode ser montada livremente — a emissão
            exige a expedição concluída e o aceite da conferência.
          </p>
        </div>
      </section>

      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            OFs candidatas a romaneio de expedição, com cliente, entrega, quantidades e situação da
            expedição.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">OF/OS</th>
              <th scope="col" className="px-3 py-2 font-semibold">Cliente</th>
              <th scope="col" className="px-3 py-2 font-semibold">Entrega</th>
              <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Qtd itens</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Peso (kg)</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Já expedida</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const fullyShipped =
                candidate.rootQuantity > 0 && candidate.shippedQuantity >= candidate.rootQuantity;
              const busy = creatingId === candidate.orderId;
              return (
                <tr key={candidate.orderId} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Badge variant="outline" className="px-1 py-0">{candidate.type}</Badge>
                      <span className="font-medium tabular-nums">{candidate.code}</span>
                    </span>
                  </td>
                  <td className="max-w-[240px] px-3 py-2">
                    <span className="block truncate" title={candidate.customerName ?? undefined}>
                      {candidate.customerName || "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {formatDate(candidate.deliveryDate)}
                  </td>
                  <td className="px-3 py-2">
                    <OrderStatusBadge status={candidate.status} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(candidate.rootQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatWeight(candidate.rootWeightKg)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(candidate.shippedQuantity)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {candidate.hasSimulation && candidate.simulationId ? (
                        <Button type="button" variant="outline" size="sm" asChild>
                          <Link href={`/romaneio/${candidate.simulationId}`}>Abrir simulação</Link>
                        </Button>
                      ) : fullyShipped ? (
                        <span
                          className="text-xs text-muted-foreground"
                          title="A quantidade total desta OF já foi expedida."
                        >
                          Totalmente expedida
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy || creatingId !== null}
                          onClick={() => handleCreate(candidate)}
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Plus className="h-4 w-4" aria-hidden />
                          )}
                          Criar simulação
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {candidates.map((candidate) => {
          const fullyShipped =
            candidate.rootQuantity > 0 && candidate.shippedQuantity >= candidate.rootQuantity;
          const busy = creatingId === candidate.orderId;
          return (
            <li key={candidate.orderId} className="rounded border bg-card p-3">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Badge variant="outline" className="px-1 py-0">{candidate.type}</Badge>
                  <span className="truncate font-medium tabular-nums">{candidate.code}</span>
                </span>
                <OrderStatusBadge status={candidate.status} />
              </header>

              <p className="mt-1 truncate text-sm text-muted-foreground">
                {candidate.customerName || "Cliente não informado"}
              </p>

              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Entrega</dt>
                  <dd className="tabular-nums">{formatDate(candidate.deliveryDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Qtd itens</dt>
                  <dd className="tabular-nums">{formatQuantity(candidate.rootQuantity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Peso (kg)</dt>
                  <dd className="tabular-nums">{formatWeight(candidate.rootWeightKg)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Já expedida</dt>
                  <dd className="tabular-nums">{formatQuantity(candidate.shippedQuantity)}</dd>
                </div>
              </dl>

              <footer className="mt-3 flex justify-end">
                {candidate.hasSimulation && candidate.simulationId ? (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link href={`/romaneio/${candidate.simulationId}`}>Abrir simulação</Link>
                  </Button>
                ) : fullyShipped ? (
                  <span
                    className="text-xs text-muted-foreground"
                    title="A quantidade total desta OF já foi expedida."
                  >
                    Totalmente expedida
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || creatingId !== null}
                    onClick={() => handleCreate(candidate)}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="h-4 w-4" aria-hidden />
                    )}
                    Criar simulação
                  </Button>
                )}
              </footer>
            </li>
          );
        })}
      </ul>

      {total > filters.pageSize ? (
        <nav
          aria-label="Paginação das OFs"
          className="flex items-center justify-between gap-3"
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Página <span className="font-medium text-foreground tabular-nums">{current}</span> de{" "}
            <span className="font-medium text-foreground tabular-nums">{pageCount}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={current <= 1}
              onClick={() => navigate(current - 1)}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={current >= pageCount}
              onClick={() => navigate(current + 1)}
            >
              Próxima
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
