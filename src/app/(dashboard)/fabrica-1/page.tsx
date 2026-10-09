import { redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getChildItemsPage } from "@/lib/services/orders.service";
import type { ChildItemMaterialsResult } from "@/lib/types/order";
import { parseChildItemFilters } from "@/lib/utils/filters";
import { pluralize } from "@/lib/utils/formatting";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { Header } from "@/components/layout/Header";
import { Fabrica1Filters } from "@/components/fabrica1/Fabrica1Filters";
import { Fabrica1Summary } from "@/components/fabrica1/Fabrica1Summary";
import { ChildItemsList } from "@/components/fabrica1/ChildItemsList";
import { ChildItemsPagination } from "@/components/fabrica1/ChildItemsPagination";

export const metadata = { title: "Fábrica 1" };

/**
 * Fábrica 1: lista de itens FILHOS das OFs com suas matérias-primas e
 * quantidades — visão de insumos/compras. Cada linha abre a OF de
 * origem; filhos sem material aparecem sinalizados.
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

  let data: ChildItemMaterialsResult;
  try {
    const client = await createClient();
    data = await getChildItemsPage(client, filters);
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

  const hasFilters =
    filters.search !== "" || filters.orderCode !== "" || filters.material !== "";

  return (
    <>
      <Header
        title="Fábrica 1"
        description={`Itens filhos das OFs com matérias-primas — ${pluralize(data.total, "item filho")}.`}
      />

      <div className="space-y-3">
        <Fabrica1Filters filters={filters} />

        <Fabrica1Summary
          total={data.total}
          qtyTotal={data.qtyTotal}
          weightTotal={data.weightTotal}
        />

        {data.items.length === 0 ? (
          <EmptyState
            title="Nenhum item filho encontrado"
            description={
              hasFilters
                ? "Ajuste os filtros para encontrar a peça ou o material que você procura."
                : "Importe uma OF com a nova estrutura (itens filhos) para começar."
            }
          />
        ) : (
          <>
            <ChildItemsList items={data.items} />
            <ChildItemsPagination filters={filters} total={data.total} />
          </>
        )}
      </div>
    </>
  );
}
