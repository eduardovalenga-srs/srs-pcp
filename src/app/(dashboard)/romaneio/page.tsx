import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRomaneiosPage } from "@/lib/services/romaneio.service";
import type { RomaneiosPage } from "@/lib/types/romaneio";
import { parseRomaneioFilters } from "@/lib/utils/filters";
import { pluralize } from "@/lib/utils/formatting";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { ExportButton } from "@/components/shared/ExportButton";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RomaneioFilters } from "@/components/romaneio/RomaneioFilters";
import { RomaneioList } from "@/components/romaneio/RomaneioList";
import { RomaneioPagination } from "@/components/romaneio/RomaneioPagination";

export const metadata = { title: "Romaneio" };

interface SummaryCardProps {
  label: string;
  value: number;
  hint?: string;
}

/** Cartão de resumo da listagem (contagens com os filtros vigentes). */
function SummaryCard({ label, value, hint }: SummaryCardProps) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function RomaneioPage({ searchParams }: PageProps<"/romaneio">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "romaneio.view")) {
    return (
      <>
        <Header
          title="Romaneio"
          description="Expedição por OF: organização das cargas, apoio à NF e devolução de matéria-prima."
        />
        <AccessDenied />
      </>
    );
  }

  const filters = parseRomaneioFilters(await searchParams);
  const canEdit = can(sessionUser.role, "romaneio.edit");

  let data: RomaneiosPage;
  try {
    const client = await createClient();
    data = await getRomaneiosPage(client, filters);
  } catch (error) {
    return (
      <>
        <Header
          title="Romaneio"
          description="Expedição por OF: organização das cargas, apoio à NF e devolução de matéria-prima."
        />
        <ErrorState
          title="Não foi possível carregar os romaneios"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const { romaneios, total, simulationCount, emittedCount } = data;
  const pendingReturnCount = romaneios.filter(
    (romaneio) => romaneio.pendingReturn && !romaneio.returnNfNumber,
  ).length;
  const hasFilters =
    filters.search !== "" ||
    filters.status !== "ALL" ||
    filters.orderCode !== "" ||
    filters.customer !== "" ||
    filters.shipmentFrom !== null ||
    filters.shipmentTo !== null;

  return (
    <>
      <Header
        title="Romaneio"
        description={pluralize(total, "romaneio")}
        actions={
          <>
            <ExportButton
              endpoint="/api/export/romaneio"
              fallbackFileName="export-romaneio.xlsx"
            />
            {canEdit ? (
              <Button type="button" size="sm" asChild>
                <Link href="/romaneio/novo">
                  <Plus className="h-4 w-4" aria-hidden />
                  Novo romaneio
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Simulações abertas" value={simulationCount} />
          <SummaryCard label="Emitidos" value={emittedCount} />
          <SummaryCard
            label="Com saldo a devolver"
            value={pendingReturnCount}
            hint="Nesta página — sem NF de devolução registrada"
          />
        </div>

        <RomaneioFilters filters={filters} />

        {romaneios.length === 0 ? (
          <EmptyState
            title="Nenhum romaneio encontrado"
            description={
              hasFilters
                ? "Ajuste os filtros para encontrar o romaneio que você procura."
                : canEdit
                  ? "Monte a primeira carga de expedição de uma OF para começar."
                  : "Nenhum romaneio de expedição registrado até o momento."
            }
            action={
              canEdit && !hasFilters ? (
                <Button type="button" size="sm" asChild>
                  <Link href="/romaneio/novo">
                    <Plus className="h-4 w-4" aria-hidden />
                    Novo romaneio
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <RomaneioList romaneios={romaneios} />
            <RomaneioPagination filters={filters} total={total} />
          </>
        )}
      </div>
    </>
  );
}
