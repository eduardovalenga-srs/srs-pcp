import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getOrdersPage } from "@/lib/services/orders.service";
import type { OrderListResult } from "@/lib/types/order";
import { parseOrderFilters } from "@/lib/utils/filters";
import { pluralize } from "@/lib/utils/formatting";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { OrderFilters } from "@/components/pedidos/OrderFilters";
import { OrderList } from "@/components/pedidos/OrderList";
import { OrderPagination } from "@/components/pedidos/OrderPagination";

export const metadata = { title: "Pedidos" };

export default async function PedidosPage({ searchParams }: PageProps<"/pedidos">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const filters = parseOrderFilters(await searchParams);
  const canCreate = can(sessionUser.role, "orders.create");

  if (!can(sessionUser.role, "orders.view")) {
    return (
      <>
        <Header title="Pedidos" description="Planejamento dos pedidos (OF/OS) e seus itens." />
        <AccessDenied />
      </>
    );
  }

  let data: OrderListResult;
  try {
    const client = await createClient();
    data = await getOrdersPage(client, filters);
  } catch (error) {
    return (
      <>
        <Header title="Pedidos" description="Planejamento dos pedidos (OF/OS) e seus itens." />
        <ErrorState
          title="Não foi possível carregar os pedidos"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const { orders, total } = data;
  const hasFilters = filters.search !== "" || filters.status !== "ALL";

  return (
    <>
      <Header
        title="Pedidos"
        description={pluralize(total, "pedido")}
      />

      <div className="space-y-3">
        <OrderFilters filters={filters} />

        {orders.length === 0 ? (
          <EmptyState
            title="Nenhum pedido encontrado"
            description={
              hasFilters
                ? "Ajuste os filtros para encontrar o pedido que você procura."
                : "Crie o primeiro pedido para começar o planejamento da produção."
            }
            action={
              canCreate && !hasFilters ? (
                <Button type="button" size="sm" asChild>
                  <Link href="/pedidos/novo">
                    <Plus className="h-4 w-4" aria-hidden />
                    Novo pedido
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <OrderList orders={orders} canDelete={can(sessionUser.role, "orders.delete")} />
            <OrderPagination filters={filters} total={total} />
          </>
        )}
      </div>
    </>
  );
}
