import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMpReceiptEntries } from "@/lib/services/mp-receipt.service";
import type { MpReceiptListEntry } from "@/lib/types/mp-receipt";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RecebimentoMpList } from "@/components/recebimento-mp/RecebimentoMpList";

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

  const canEdit = can(sessionUser.role, "mp_receipt.edit");
  let entries: MpReceiptListEntry[];
  try {
    const client = await createClient();
    entries = await getMpReceiptEntries(client);
  } catch (error) {
    return (
      <>
        <Header
          title="Recebimento de MP"
          description="Consulte os recebimentos cadastrados e registre novas notas de entrada."
          actions={backAction}
        />
        <ErrorState
          title="Não foi possível carregar os recebimentos de MP"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Recebimento de MP"
        description={`${entries.length} ${entries.length === 1 ? "recebimento cadastrado" : "recebimentos cadastrados"}`}
        actions={
          <>
            {canEdit ? (
              <Button type="button" size="sm" asChild>
                <Link href="/recebimento-mp/novo">
                  <Plus className="h-4 w-4" aria-hidden />
                  Nova nota de entrada
                </Link>
              </Button>
            ) : null}
            {backAction}
          </>
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          title="Nenhum recebimento cadastrado"
          description={
            canEdit
              ? "Registre uma nova nota de entrada para começar."
              : "Nenhuma nota de entrada foi registrada até o momento."
          }
          action={
            canEdit ? (
              <Button type="button" size="sm" asChild>
                <Link href="/recebimento-mp/novo">
                  <Plus className="h-4 w-4" aria-hidden />
                  Nova nota de entrada
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <RecebimentoMpList entries={entries} canEdit={canEdit} />
      )}
    </>
  );
}
