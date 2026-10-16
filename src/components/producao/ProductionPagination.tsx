"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { PRODUCTION_PAGE_SIZE_OPTIONS } from "@/lib/constants/pagination";
import type { ProductionFilters } from "@/lib/types/production";
import { productionQueryString } from "@/lib/utils/filters";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProductionPaginationProps {
  filters: ProductionFilters;
  total: number;
}

/** Paginação da tela de gestão de entregas (página e tamanho vivem na URL). */
export function ProductionPagination({ filters, total }: ProductionPaginationProps) {
  const router = useRouter();

  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const current = Math.min(filters.page, pageCount);
  const from = total === 0 ? 0 : (current - 1) * filters.pageSize + 1;
  const to = Math.min(current * filters.pageSize, total);

  const navigate = (page: number, pageSize = filters.pageSize) => {
    const query = productionQueryString(filters, { page, pageSize });
    router.push(query ? `/gestao-entregas?${query}` : "/gestao-entregas");
  };

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Nenhum item encontrado com os filtros atuais.
      </p>
    );
  }

  return (
    <nav aria-label="Paginação da gestão de OF" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Exibindo <span className="font-medium text-foreground">{from}–{to}</span> de{" "}
        <span className="font-medium text-foreground">{total}</span> itens
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="producao-por-pagina" className="text-xs text-muted-foreground">
            Por página
          </label>
          <Select value={String(filters.pageSize)} onValueChange={(value) => navigate(1, Number(value))}>
            <SelectTrigger id="producao-por-pagina" className="h-8 w-[86px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCTION_PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={current <= 1}
            onClick={() => navigate(current - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Anterior
          </Button>
          <span className="px-2 text-sm tabular-nums text-muted-foreground">
            Página {current} de {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={current >= pageCount}
            onClick={() => navigate(current + 1)}
          >
            Próxima
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
