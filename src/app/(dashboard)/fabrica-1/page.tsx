import { redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getChildItemsPage } from "@/lib/services/orders.service";
import { getDashboardData } from "@/lib/services/production.service";
import { parseChildItemFilters } from "@/lib/utils/filters";
import { pluralize } from "@/lib/utils/formatting";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { Fabrica1Filters } from "@/components/fabrica1/Fabrica1Filters";
import { Fabrica1Summary } from "@/components/fabrica1/Fabrica1Summary";
import { Fabrica1Table } from "@/components/fabrica1/Fabrica1Table";
import { Fabrica1ActiveFilters } from "@/components/fabrica1/Fabrica1ColumnHeaders";
import { ChildItemsPagination } from "@/components/fabrica1/ChildItemsPagination";

export const metadata = { title: "Fábrica 1" };

/**
 * Fábrica 1: lista de itens FILHOS das OFs com suas matérias-primas e
 * quantidades — visão de insumos/compras. Uma linha por CÓDIGO de filho
 * dentro da OF (033): itens repetidos somam quantidade/peso e a situação
 * dos processos agrega. Uma coluna por processo da cadeia da Fábrica 1
 * (MP herdado dos pais; sub-item e KIT editáveis aqui — no grupo, a
 * célula aplica a situação a todos os membros).
 */
export default async function Fabrica1Page({ searchParams }: PageProps<"/fabrica-1">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  const filters = parseChildItemFilters(await searchParams);

  if (!can(sessionUser.role, "orders.view")) {
    return (
      <>
        <Header
          title="Fábrica 1"
          description="Itens filhos das OFs com suas matérias-primas e quantidades."
        />
        <AccessDenied />
      </>
    );
  }

  let data: Awaited<ReturnType<typeof getChildItemsPage>>;
  let stats: Awaited<ReturnType<typeof getDashboardData>>;
  try {
    const client = await createClient();
    // 037: os KPIs globais (Atrasados/Expedição) vêm junto — cards novos.
    [data, stats] = await Promise.all([getChildItemsPage(client, filters), getDashboardData(client)]);
  } catch (error) {
    return (
      <>
        <Header
          title="Fábrica 1"
          description="Itens filhos das OFs com suas matérias-primas e quantidades."
        />
        <ErrorState
          title="Não foi possível carregar os itens filhos"
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
    // 036: sequência de fabricação — mesmo corte da edição de itens.
    canEditSeq: can(sessionUser.role, "orders.edit"),
  };

  return (
    <>
      <Header
        title="Fábrica 1"
        description={`Itens filhos das OFs agrupados por código — ${pluralize(data.total, "linha")}.`}
      />

      <div className="space-y-3">
        {/* Mobile: barra de filtros (no desktop os filtros ficam nos cabeçalhos). */}
        <div className="lg:hidden">
          <Fabrica1Filters filters={filters} processes={data.processes} />
        </div>

        <Fabrica1Summary
          total={data.total}
          qtyTotal={data.qtyTotal}
          weightTotal={data.weightTotal}
          familyTotals={data.familyTotals}
          delivery={stats.delivery}
          expedition={stats.expedition}
          overdueFamilies={stats.overdueFamilies}
          expeditionFamilies={stats.expeditionFamilies}
        />

        {/* Chips de filtros ativos: removem um a um ou limpam tudo. */}
        <Fabrica1ActiveFilters filters={filters} />

        <Fabrica1Table
          items={data.items}
          processes={data.processes}
          filters={filters}
          capabilities={capabilities}
          today={data.today}
        />

        <ChildItemsPagination filters={filters} total={data.total} />
      </div>
    </>
  );
}
