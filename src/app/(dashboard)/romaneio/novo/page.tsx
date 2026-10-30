import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRomaneioCustomers } from "@/lib/services/romaneio.service";
import type { RomaneioCustomerOption } from "@/lib/types/romaneio";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RomaneioNewForm } from "@/components/romaneio/RomaneioNewForm";

export const metadata = { title: "Novo romaneio" };

export default async function NovoRomaneioPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const backAction = (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href="/romaneio">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </Link>
    </Button>
  );

  if (!can(sessionUser.role, "romaneio.edit")) {
    return (
      <>
        <Header
          title="Novo romaneio"
          description="Monte a carga de expedição a partir de uma OF."
          actions={backAction}
        />
        <AccessDenied message="Seu perfil não pode montar romaneios de expedição." />
      </>
    );
  }

  let customers: RomaneioCustomerOption[];
  try {
    const client = await createClient();
    customers = await getRomaneioCustomers(client);
  } catch (error) {
    return (
      <>
        <Header
          title="Novo romaneio"
          description="Monte a carga de expedição a partir de uma OF."
          actions={backAction}
        />
        <ErrorState
          title="Não foi possível carregar as OFs"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Novo romaneio"
        description="Escolha o cliente, a OF e a data de saída — um romaneio em montagem por OF."
        actions={backAction}
      />

      {customers.length === 0 ? (
        <EmptyState
          title="Nenhuma OF disponível"
          description="Não há OFs abertas para expedir (canceladas, sem itens ou totalmente expedidas ficam fora)."
        />
      ) : (
        <RomaneioNewForm customers={customers} />
      )}
    </>
  );
}
