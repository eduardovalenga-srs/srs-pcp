"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { OrderFilters as OrderFilterValues } from "@/lib/types/order";
import { orderQueryString } from "@/lib/utils/filters";
import { Button } from "@/components/ui/button";

interface OrderPaginationProps {
  filters: OrderFilterValues;
  total: number;
}

/** Paginação da listagem de pedidos (a página vive na URL). */
export function OrderPagination({ filters, total }: OrderPaginationProps) {
  const router = useRouter();

  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const current = Math.min(Math.max(filters.page, 1), pageCount);
  const from = total === 0 ? 0 : (current - 1) * filters.pageSize + 1;
  const to = Math.min(current * filters.pageSize, total);

  const navigate = (page: number) => {
    const query = orderQueryString(filters, { page });
    router.replace(query ? `/pedidos?${query}` : "/pedidos", { scroll: false });
  };

  if (total === 0) return null;

  return (
    <nav
      aria-label="Paginação dos pedidos"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Exibindo <span className="font-medium text-foreground">{from}–{to}</span> de{" "}
        <span className="font-medium text-foreground">{total}</span> pedidos
      </p>

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
    </nav>
  );
}
