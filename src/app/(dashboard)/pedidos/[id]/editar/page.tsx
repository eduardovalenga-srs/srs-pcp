import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getOrderForEditAction } from "@/lib/actions/orders.actions";

import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { listProductGroupOptions } from "@/lib/repositories/product-groups.repository";
import type { ProductGroupOption } from "@/lib/types/product-group";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { OrderForm, type OrderProcessOption } from "@/components/pedidos/OrderForm";
import { hasPermission } from "@/lib/auth/access";

export const metadata = { title: "Editar pedido" };

export default async function EditarPedidoPage({ params }: PageProps<"/pedidos/[id]/editar">) {
  const { id } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!hasPermission(sessionUser.access, "orders.edit")) {
    return (
      <>
        <Header title="Editar pedido" description="Atualize os dados do pedido e de seus itens." />
        <AccessDenied message="Seu perfil não pode editar pedidos." />
      </>
    );
  }

  let processes: OrderProcessOption[];
  let productGroups: ProductGroupOption[];
  try {
    const client = await createClient();
    // Famílias carregadas junto do catálogo — a edição define a
    // família de toda a OF (inclusive nas OFs antigas).
    const [catalog, groups] = await Promise.all([
      getActiveProcesses(client),
      listProductGroupOptions(client),
    ]);
    processes = catalog.map((process) => ({ code: process.code, name: process.name }));
    productGroups = groups;
  } catch (error) {
    return (
      <>
        <Header title="Editar pedido" description="Atualize os dados do pedido e de seus itens." />
        <ErrorState
          title="Não foi possível carregar os processos"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const result = await getOrderForEditAction(id);
  if (!result.success) {
    return (
      <>
        <Header title="Editar pedido" description="Atualize os dados do pedido e de seus itens." />
        <ErrorState title="Não foi possível carregar o pedido" message={result.message} />
      </>
    );
  }

  return (
    <>
      <Header
        title={`Editar pedido ${result.order.code}`}
        description="Atualize os dados do pedido e de seus itens."
        actions={
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/pedidos">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </Link>
          </Button>
        }
      />

      <OrderForm
        processes={processes}
        productGroups={productGroups}
        initialOrder={result.order}
      />
    </>
  );
}
