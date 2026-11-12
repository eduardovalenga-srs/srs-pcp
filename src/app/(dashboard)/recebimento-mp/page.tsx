import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMpReceiptCustomers } from "@/lib/services/mp-receipt.service";
import type { MpReceiptCustomerOption } from "@/lib/types/mp-receipt";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RecebimentoMpForm } from "@/components/recebimento-mp/RecebimentoMpForm";

export const metadata = { title: "Recebimento de MP" };

export default async function RecebimentoMpPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const backAction = (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href="/gestao-entregas">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </Link>
    </Button>
  );

  if (!can(sessionUser.role, "menu.recebimento_mp")) {
    return (
      <>
        <Header
          title="Recebimento de MP"
          description="Registre as notas de entrada e o peso de matéria-prima recebido por material da OF."
          actions={backAction}
        />
        <AccessDenied message="Seu perfil não pode acessar o recebimento de matéria-prima." />
      </>
    );
  }

  let customers: MpReceiptCustomerOption[];
  try {
    const client = await createClient();
    customers = await getMpReceiptCustomers(client);
  } catch (error) {
    return (
      <>
        <Header
          title="Recebimento de MP"
          description="Registre as notas de entrada e o peso de matéria-prima recebido por material da OF."
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
        title="Recebimento de MP"
        description="Escolha o cliente e a OF, informe a nota de entrada e o peso recebido de cada matéria-prima — e, se houver, os itens fora da OF."
        actions={backAction}
      />

      {customers.length === 0 ? (
        <EmptyState
          title="Nenhuma OF com pendência"
          description="Todas as OFs ativas já receberam a matéria-prima por completo (ou não têm materiais a receber)."
        />
      ) : (
        <RecebimentoMpForm customers={customers} canEdit={can(sessionUser.role, "mp_receipt.edit")} />
      )}
    </>
  );
}
