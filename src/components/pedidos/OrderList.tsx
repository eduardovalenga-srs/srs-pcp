"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";

import type { OrderSummary } from "@/lib/types/order";
import { formatDate } from "@/lib/utils/dates";
import { pluralize } from "@/lib/utils/formatting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/shared/StatusBadges";
import { DeleteOrderButton } from "@/components/pedidos/DeleteOrderButton";

interface OrderListProps {
  orders: OrderSummary[];
  canDelete: boolean;
}

function RowActions({ order, canDelete }: { order: OrderSummary; canDelete: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button type="button" variant="outline" size="sm" asChild>
        <Link href={`/pedidos/${order.id}/editar`}>
          <Pencil className="h-4 w-4" aria-hidden />
          Editar
        </Link>
      </Button>
      {canDelete ? <DeleteOrderButton orderId={order.id} orderCode={order.code} /> : null}
    </div>
  );
}

/** Listagem de pedidos: tabela no desktop (lg+) e cards no mobile. */
export function OrderList({ orders, canDelete }: OrderListProps) {
  return (
    <>
      {/* Desktop / tablet largo: tabela */}
      <div className="hidden overflow-x-auto rounded border bg-card lg:block">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">
            Pedidos cadastrados, com cliente, entrega, situação e quantidade de itens.
          </caption>
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-3 py-2 font-semibold">Código</th>
              <th scope="col" className="px-3 py-2 font-semibold">Cliente</th>
              <th scope="col" className="px-3 py-2 font-semibold">Entrega</th>
              <th scope="col" className="px-3 py-2 font-semibold">Situação</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Itens</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Badge variant="outline" className="px-1 py-0">{order.type}</Badge>
                    <span className="font-medium tabular-nums">{order.code}</span>
                  </span>
                </td>
                <td className="max-w-[240px] px-3 py-2">
                  <span className="block truncate" title={order.customerName ?? undefined}>
                    {order.customerName || "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {formatDate(order.deliveryDate)}
                </td>
                <td className="px-3 py-2">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{order.itemCount}</td>
                <td className="px-3 py-2">
                  <RowActions order={order} canDelete={canDelete} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="space-y-2 lg:hidden">
        {orders.map((order) => (
          <li key={order.id} className="rounded border bg-card p-3">
            <header className="flex flex-wrap items-start justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Badge variant="outline" className="px-1 py-0">{order.type}</Badge>
                <span className="truncate font-medium tabular-nums">{order.code}</span>
              </span>
              <OrderStatusBadge status={order.status} />
            </header>

            <p className="mt-1 truncate text-sm text-muted-foreground">
              {order.customerName || "—"}
            </p>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline">Entrega: </dt>
                <dd className="inline tabular-nums text-foreground">
                  {formatDate(order.deliveryDate)}
                </dd>
              </div>
              <div>
                <dt className="inline">Itens: </dt>
                <dd className="inline tabular-nums text-foreground">
                  {pluralize(order.itemCount, "item")}
                </dd>
              </div>
            </dl>

            <div className="mt-3">
              <RowActions order={order} canDelete={canDelete} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
