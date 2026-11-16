import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getMpReceiptEntry, getMpReceiptMaterials } from "@/lib/services/mp-receipt.service";
import type { MpReceiptDetail, MpReceiptMaterial } from "@/lib/types/mp-receipt";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RecebimentoMpForm } from "@/components/recebimento-mp/RecebimentoMpForm";

export const metadata = { title: "Editar nota de entrada" };

export default async function EditarRecebimentoMpPage({
  params,
}: PageProps<"/recebimento-mp/[id]/editar">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const { id } = await params;
  const backAction = (
    <Button type="button" variant="outline" size="sm" asChild>
      <Link href={`/recebimento-mp/${id}`}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Voltar
      </Link>
    </Button>
  );

  if (
    !can(sessionUser.role, "menu.recebimento_mp") ||
    !can(sessionUser.role, "mp_receipt.edit")
  ) {
    return (
      <>
        <Header title="Editar nota de entrada" actions={backAction} />
        <AccessDenied message="Seu perfil não pode editar recebimentos de matéria-prima." />
      </>
    );
  }

  let entry: MpReceiptDetail | null = null;
  let materials: MpReceiptMaterial[] = [];
  try {
    const client = await createClient();
    entry = await getMpReceiptEntry(client, id);
    if (entry) materials = await getMpReceiptMaterials(client, entry.orderId);
  } catch (error) {
    return (
      <>
        <Header title="Editar nota de entrada" actions={backAction} />
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
        <Header title="Editar nota de entrada" actions={backAction} />
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
        title={`Editar nota de entrada nº ${entry.entryNumber || entry.number}`}
        description={`${entry.orderCode ?? "OF não informada"} · ${entry.customerName || "Cliente não informado"}`}
        actions={backAction}
      />
      <RecebimentoMpForm
        customers={[]}
        canEdit
        initialEntry={entry}
        initialMaterials={materials}
      />
    </>
  );
}
