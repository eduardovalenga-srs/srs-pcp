import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getOrderForEditAction } from "@/lib/actions/orders.actions";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { OrderForm, type OrderProcessOption } from "@/components/pedidos/OrderForm";

export default async function EditarPedidoPage({ params }: PageProps<"/pedidos/[id]/editar">) {
  const { id } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "orders.edit")) {
    return (
      <>
        <Header title="Editar pedido" description="Atualize os dados do pedido e de seus itens." />
        <AccessDenied message="Seu perfil não pode editar pedidos." />
      </>
    );
  }

  let processes: OrderProcessOption[];
  try {
    const client = await createClient();
    const catalog = await getActiveProcesses(client);
    processes = catalog.map((process) => ({ code: process.code, name: process.name }));
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

      <OrderForm processes={processes} initialOrder={result.order} />
    </>
  );
}
