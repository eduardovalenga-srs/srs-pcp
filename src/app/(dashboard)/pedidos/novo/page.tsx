import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { OrderForm, type OrderProcessOption } from "@/components/pedidos/OrderForm";

export default async function NovoPedidoPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "orders.create")) {
    return (
      <>
        <Header title="Novo pedido" description="Crie um pedido (OF/OS) com seus itens." />
        <AccessDenied message="Seu perfil não pode criar pedidos." />
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
        <Header title="Novo pedido" description="Crie um pedido (OF/OS) com seus itens." />
        <ErrorState
          title="Não foi possível carregar os processos"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Novo pedido"
        description="Preencha os dados do pedido e adicione ao menos um item."
        actions={
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/pedidos">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar
            </Link>
          </Button>
        }
      />

      {processes.length === 0 ? (
        <ErrorState
          title="Nenhum processo ativo"
          message="Cadastre ao menos um processo no catálogo antes de criar pedidos."
        />
      ) : (
        <OrderForm processes={processes} />
      )}
    </>
  );
}
