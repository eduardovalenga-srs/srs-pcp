import Link from "next/link";
import { redirect } from "next/navigation";
import { FileSpreadsheet, Plus } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData, getProductionOrdersPage } from "@/lib/services/production.service";
import { parseProductionFilters } from "@/lib/utils/filters";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { ExportButton } from "@/components/shared/ExportButton";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { ActiveFilters } from "@/components/producao/ActiveFilters";
import { ProductionFiltersBar } from "@/components/producao/ProductionFilters";
import { ProductionSummary } from "@/components/producao/ProductionSummary";
import { ProductionTable } from "@/components/producao/ProductionTable";
import { ProductionPagination } from "@/components/producao/ProductionPagination";

export const metadata = { title: "Gestão de OF" };

export default async function GestaoEntregasPage({ searchParams }: PageProps<"/gestao-entregas">) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "production.view")) {
    return (
      <>
        <Header title="Gestão de OF" description="Acompanhamento etapa a etapa dos itens." />
        <AccessDenied />
      </>
    );
  }

  const filters = parseProductionFilters(await searchParams);

  let data: Awaited<ReturnType<typeof getProductionOrdersPage>>;
  let stats: Awaited<ReturnType<typeof getDashboardData>>;
  try {
    const client = await createClient();
    [data, stats] = await Promise.all([getProductionOrdersPage(client, filters), getDashboardData(client)]);
  } catch (error) {
    return (
      <>
        <Header title="Gestão de OF" description="Acompanhamento etapa a etapa dos itens." />
        <ErrorState
          title="Não foi possível carregar a gestão de OF"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  // Visão consolidada por OF (025): só a situação (em lote) e a entrega
  // do pedido são editáveis aqui — quantidades/observações por item
  // seguem na Fábrica 2 e no detalhe do pedido.
  const capabilities = {
    canUpdateStatus: can(sessionUser.role, "production.update_status"),
    canEditDelivery: can(sessionUser.role, "orders.edit"),
    // 036: sequência de fabricação da OF — mesmo corte da edição de itens.
    canEditSeq: can(sessionUser.role, "orders.edit"),
  };

  return (
    <>
      <Header
        title="Gestão de OF"
        description="Uma linha por OF — quantidades e pesos somados, com uma coluna por processo. Clique numa célula para aplicar a situação a toda a OF."
        actions={
          <>
            <ExportButton endpoint="/api/export/gestao-entregas" fallbackFileName="export-gestao-entregas.xlsx" />
            {can(sessionUser.role, "orders.create") ? (
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href="/pedidos/novo">
                  <Plus className="h-4 w-4" aria-hidden />
                  Novo pedido
                </Link>
              </Button>
            ) : null}
            {can(sessionUser.role, "import.access") ? (
              <Button type="button" size="sm" asChild>
                <Link href="/importacao">
                  <FileSpreadsheet className="h-4 w-4" aria-hidden />
                  Importar Excel
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-3">
        {/* Mobile: barra de filtros (não há cabeçalho de coluna nos cards). */}
        <div className="lg:hidden">
          <ProductionFiltersBar filters={filters} processes={data.processes} />
        </div>

        <ProductionSummary
          total={data.total}
          qtyTotal={data.qtyTotal}
          weightTotal={data.weightTotal}
          filters={filters}
          delivery={stats.delivery}
          expedition={stats.expedition}
        />

        {/* Chips de filtros ativos (todas as telas): removem um a um ou limpam tudo. */}
        <ActiveFilters filters={filters} />

        <ProductionTable
          rows={data.rows}
          processes={data.processes}
          filters={filters}
          capabilities={capabilities}
          today={data.today}
        />

        <ProductionPagination filters={filters} total={data.total} />
      </div>
    </>
  );
}
