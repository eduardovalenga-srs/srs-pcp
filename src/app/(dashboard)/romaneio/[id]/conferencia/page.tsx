import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRomaneioView } from "@/lib/services/romaneio.service";
import type { RomaneioView } from "@/lib/types/romaneio";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RomaneioConferenceSheet } from "@/components/romaneio/RomaneioConferenceSheet";

export const metadata = { title: "Conferência do romaneio" };

export default async function RomaneioConferenciaPage({
  params,
}: PageProps<"/romaneio/[id]/conferencia">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const { id } = await params;

  const backAction = (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href={`/romaneio/${id}`}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar ao romaneio
      </Link>
    </Button>
  );

  if (!can(sessionUser.role, "romaneio.view")) {
    return (
      <>
        <Header title="Conferência do romaneio" description="Folha de conferência da carga." />
        <AccessDenied />
      </>
    );
  }

  let view: RomaneioView | null;
  try {
    const client = await createClient();
    view = await getRomaneioView(
      client,
      id,
      can(sessionUser.role, "romaneio.edit"),
    );
  } catch (error) {
    return (
      <>
        <Header title="Conferência do romaneio" description="Folha de conferência da carga." />
        <ErrorState
          title="Não foi possível carregar o romaneio"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  if (!view) {
    return (
      <>
        <Header title="Conferência do romaneio" description="Folha de conferência da carga." />
        <EmptyState
          title="Romaneio não encontrado"
          description="O registro não existe mais ou o endereço está incorreto."
          action={backAction}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title={`Conferência — Romaneio nº ${view.number}`}
        description={`${view.orderCode} · ${view.customerName || "Cliente não informado"}`}
        actions={backAction}
      />
      <RomaneioConferenceSheet
        view={view}
        canSign={can(sessionUser.role, "romaneio.edit")}
      />
    </>
  );
}
