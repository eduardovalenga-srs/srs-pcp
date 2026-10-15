import { redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData, getProductionPage } from "@/lib/services/production.service";
import { parseProductionFilters } from "@/lib/utils/filters";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Fabrica2ActiveFilters } from "@/components/fabrica2/Fabrica2ActiveFilters";
import { Fabrica2FiltersBar } from "@/components/fabrica2/Fabrica2Filters";
import { Fabrica2Summary } from "@/components/fabrica2/Fabrica2Summary";
import { Fabrica2Table } from "@/components/fabrica2/Fabrica2Table";
import { Fabrica2Pagination } from "@/components/fabrica2/Fabrica2Pagination";

export const metadata = { title: "Fábrica 2" };

/**
 * Fábrica 2: réplica da gestão de entregas com código próprio — cópia
 * deliberada para que alterações futuras na gestão não afetem esta tela
 * (e vice-versa). Acesso restrito (menu.fabrica2/fabrica2.view): ADMIN e GESTOR.
 */
export default async function Fabrica2Page({ searchParams }: PageProps<"/fabrica-2">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "fabrica2.view")) {
    return (
      <>
        <Header title="Fábrica 2" description="Acompanhamento etapa a etapa dos itens." />
        <AccessDenied />
      </>
    );
  }

  const filters = parseProductionFilters(await searchParams);

  let data: Awaited<ReturnType<typeof getProductionPage>>;
  let stats: Awaited<ReturnType<typeof getDashboardData>>;
  try {
    const client = await createClient();
    [data, stats] = await Promise.all([getProductionPage(client, filters), getDashboardData(client)]);
  } catch (error) {
    return (
      <>
        <Header title="Fábrica 2" description="Acompanhamento etapa a etapa dos itens." />
        <ErrorState
          title="Não foi possível carregar a Fábrica 2"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const capabilities = {
    canUpdateStatus: can(sessionUser.role, "production.update_status"),
    canEditQuantities: can(sessionUser.role, "production.edit"),
    canViewHistory: can(sessionUser.role, "production.view_history"),
    canEditDelivery: can(sessionUser.role, "orders.edit"),
  };

  return (
    <>
      <Header
        title="Fábrica 2"
        description="Uma linha por item, uma coluna por processo. Clique em uma célula para atualizar."
      />

      <div className="space-y-3">
        {/* Mobile: barra de filtros (não há cabeçalho de coluna nos cards). */}
        <div className="lg:hidden">
          <Fabrica2FiltersBar filters={filters} processes={data.processes} />
        </div>

        <Fabrica2Summary
          total={data.total}
          qtyTotal={data.qtyTotal}
          weightTotal={data.weightTotal}
          filters={filters}
          delivery={stats.delivery}
          expedition={stats.expedition}
        />

        {/* Chips de filtros ativos: removem um a um ou limpam tudo. */}
        <Fabrica2ActiveFilters filters={filters} />

        <Fabrica2Table
          rows={data.rows}
          processes={data.processes}
          filters={filters}
          capabilities={capabilities}
          today={data.today}
        />

        <Fabrica2Pagination filters={filters} total={data.total} />
      </div>
    </>
  );
}
