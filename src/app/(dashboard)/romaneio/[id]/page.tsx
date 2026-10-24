import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRomaneioView } from "@/lib/services/romaneio.service";
import type { RomaneioView } from "@/lib/types/romaneio";
import { ROMANEIO_STATUS_LABELS } from "@/lib/constants/romaneio";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ExportButton } from "@/components/shared/ExportButton";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RomaneioDetail } from "@/components/romaneio/RomaneioDetail";

export const metadata = { title: "Romaneio" };

export default async function RomaneioDetalhePage({ params }: PageProps<"/romaneio/[id]">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const { id } = await params;

  const backAction = (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href="/romaneio">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </Link>
    </Button>
  );

  if (!can(sessionUser.role, "romaneio.view")) {
    return (
      <>
        <Header title="Romaneio" description="Expedição por OF." actions={backAction} />
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
        <Header title="Romaneio" description="Expedição por OF." actions={backAction} />
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
        <Header title="Romaneio" description="Expedição por OF." actions={backAction} />
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
        title={`Romaneio nº ${view.number}`}
        description={`${view.orderCode} · ${view.customerName || "Cliente não informado"} · ${
          ROMANEIO_STATUS_LABELS[view.status]
        }`}
        actions={
          <>
            <ExportButton
              endpoint={`/api/export/romaneio?id=${view.id}`}
              fallbackFileName={`export-romaneio-${view.number}.xlsx`}
            />
            {backAction}
          </>
        }
      />

      <RomaneioDetail
        view={view}
        canEditCapability={can(sessionUser.role, "romaneio.edit")}
      />
    </>
  );
}
