import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRomaneioOrderCandidates } from "@/lib/services/romaneio.service";
import type { RomaneioCandidatesPage } from "@/lib/types/romaneio";
import { parseRomaneioCandidateFilters } from "@/lib/utils/filters";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { RomaneioOrderPicker } from "@/components/romaneio/RomaneioOrderPicker";

export const metadata = { title: "Novo romaneio" };

export default async function NovoRomaneioPage({ searchParams }: PageProps<"/romaneio/novo">) {
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

  const filters = parseRomaneioCandidateFilters(await searchParams);

  let data: RomaneioCandidatesPage;
  try {
    const client = await createClient();
    data = await getRomaneioOrderCandidates(client, filters);
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

  const hasSearch = filters.search !== "";

  return (
    <>
      <Header
        title="Novo romaneio"
        description="Escolha a OF que sai nesta carga — uma simulação aberta por OF."
        actions={backAction}
      />

      {data.candidates.length === 0 ? (
        <EmptyState
          title="Nenhuma OF disponível"
          description={
            hasSearch
              ? "Ajuste a busca para encontrar a OF que você procura."
              : "Não há OFs abertas para expedir (canceladas, sem itens ou totalmente expedidas ficam fora)."
          }
        />
      ) : (
        <RomaneioOrderPicker
          candidates={data.candidates}
          filters={filters}
          total={data.total}
        />
      )}
    </>
  );
}
