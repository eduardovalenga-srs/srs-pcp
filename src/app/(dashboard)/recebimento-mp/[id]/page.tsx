import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMpReceiptEntry } from "@/lib/services/mp-receipt.service";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RecebimentoMpDetail } from "@/components/recebimento-mp/RecebimentoMpDetail";

export const metadata = { title: "Consulta de recebimento de MP" };

export default async function RecebimentoMpDetalhePage({
  params,
}: PageProps<"/recebimento-mp/[id]">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const { id } = await params;
  const backAction = (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href="/recebimento-mp">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </Link>
    </Button>
  );

  if (!can(sessionUser.role, "menu.recebimento_mp")) {
    return (
      <>
        <Header
          title="Consulta de recebimento"
          description="Nota de entrada de matéria-prima."
          actions={backAction}
        />
        <AccessDenied message="Seu perfil não pode consultar recebimentos de matéria-prima." />
      </>
    );
  }

  let entry;
  try {
    const client = await createClient();
    entry = await getMpReceiptEntry(client, id);
  } catch (error) {
    return (
      <>
        <Header
          title="Consulta de recebimento"
          description="Nota de entrada de matéria-prima."
          actions={backAction}
        />
        <ErrorState
          title="Não foi possível carregar o recebimento"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  if (!entry) {
    return (
      <>
        <Header
          title="Consulta de recebimento"
          description="Nota de entrada de matéria-prima."
          actions={backAction}
        />
        <EmptyState
          title="Recebimento não encontrado"
          description="O registro pode ter sido excluído ou o endereço está incorreto."
          action={backAction}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title={`Nota de entrada nº ${entry.entryNumber || entry.number}`}
        description={`${entry.orderCode ?? "OF não informada"} · ${entry.customerName || "Cliente não informado"}`}
        actions={backAction}
      />
      <RecebimentoMpDetail entry={entry} />
    </>
  );
}
