"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ROMANEIO_PAGE_SIZE_OPTIONS } from "@/lib/constants/pagination";
import type { RomaneioFilters as RomaneioFilterValues } from "@/lib/types/romaneio";
import { romaneioQueryString } from "@/lib/utils/filters";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RomaneioPaginationProps {
  filters: RomaneioFilterValues;
  total: number;
}

/** Paginação da listagem de romaneios (a página vive na URL). */
export function RomaneioPagination({ filters, total }: RomaneioPaginationProps) {
  const router = useRouter();

  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const current = Math.min(Math.max(filters.page, 1), pageCount);
  const from = total === 0 ? 0 : (current - 1) * filters.pageSize + 1;
  const to = Math.min(current * filters.pageSize, total);

  // Trocar o tamanho volta para a página 1 (mesma regra das demais listas).
  const navigate = (page: number, pageSize = filters.pageSize) => {
    const query = romaneioQueryString(filters, { page, pageSize });
    router.replace(query ? `/romaneio?${query}` : "/romaneio", { scroll: false });
  };

  if (total === 0) return null;

  return (
    <nav
      aria-label="Paginação dos romaneios"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Exibindo <span className="font-medium text-foreground">{from}–{to}</span> de{" "}
        <span className="font-medium text-foreground">{total}</span> romaneios
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="romaneio-por-pagina" className="text-xs text-muted-foreground">
            Por página
          </label>
          <Select
            value={String(filters.pageSize)}
            onValueChange={(value) => navigate(1, Number(value))}
          >
            <SelectTrigger id="romaneio-por-pagina" className="h-8 w-[86px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROMANEIO_PAGE_SIZE_OPTIONS.map((size) => (
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
