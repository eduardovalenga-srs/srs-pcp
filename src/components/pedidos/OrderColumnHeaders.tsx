"use client";

import { usePathname, useRouter } from "next/navigation";

import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/constants/orders";
import type { OrderFilters } from "@/lib/types/order";
import { orderQueryString } from "@/lib/utils/filters";
import {
  DeliveryPeriodPopover,
  FilterMenu,
  TextColumnFilter,
} from "@/components/shared/column-filters";

/** Grava um conjunto de filtros da listagem de pedidos na URL e volta para a primeira página. */
function useApplyOrderFilters(filters: OrderFilters) {
  const router = useRouter();
  const pathname = usePathname();

  return (overrides: Partial<OrderFilters>) => {
    const query = orderQueryString({ ...filters, ...overrides, page: 1 });
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/** Filtro de coluna de texto — OF/OS e Cliente por "contém" (038). */
export function OrderTextFilter({
  filters,
  field,
  column,
  context,
}: {
  filters: OrderFilters;
  field: "code" | "customer";
  /** Rótulo da coluna, ex.: "Cliente". */
  column: string;
  /** Contexto do título/aria, ex.: "cliente". */
  context: string;
}) {
  const apply = useApplyOrderFilters(filters);

  return (
    <TextColumnFilter
      value={filters[field]}
      column={column}
      context={context}
      onApply={(value) => apply({ [field]: value } as Partial<OrderFilters>)}
    />
  );
}

/** Filtro da coluna Entrega — período inclusivo De/Até (038). */
export function OrderDeliveryFilter({ filters }: { filters: OrderFilters }) {
  const apply = useApplyOrderFilters(filters);
  const active = filters.deliveryFrom !== null || filters.deliveryTo !== null;

  return (
    <DeliveryPeriodPopover
      active={active}
      from={filters.deliveryFrom}
      to={filters.deliveryTo}
      idPrefix="pedidos-entrega"
      onApply={(from, to) => apply({ deliveryFrom: from, deliveryTo: to })}
    />
  );
}

/** Filtro da coluna Situação — menu de situações do pedido (038). */
export function OrderStatusFilter({ filters }: { filters: OrderFilters }) {
  const apply = useApplyOrderFilters(filters);
  const active = filters.status !== "ALL";

  return (
    <FilterMenu
      context="situação do pedido"
      value={filters.status}
      active={active}
      options={[
        { value: "ALL", label: "Todas as situações" },
        ...ORDER_STATUSES.map((status) => ({
          value: status,
          label: ORDER_STATUS_LABELS[status],
        })),
      ]}
      onValueChange={(next) => apply({ status: next as OrderStatus | "ALL" })}
    />
  );
}
