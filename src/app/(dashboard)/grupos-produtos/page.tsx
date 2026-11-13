import { redirect } from "next/navigation";

import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { ProductGroupsCatalog } from "@/components/grupos-produtos/ProductGroupsCatalog";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getAllProcesses } from "@/lib/repositories/production.repository";
import { getAllProductGroups } from "@/lib/repositories/product-groups.repository";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Grupos de produtos" };

export default async function ProductGroupsPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "processes.view")) {
    return (
      <>
        <Header title="Grupos de produtos" description="Cadastro de famílias e capacidades produtivas." />
        <AccessDenied />
      </>
    );
  }

  let groups: Awaited<ReturnType<typeof getAllProductGroups>> | null = null;
  let processes: Awaited<ReturnType<typeof getAllProcesses>> | null = null;
  let loadError: unknown = null;
  try {
    const client = await createClient();
    [groups, processes] = await Promise.all([
      getAllProductGroups(client),
      getAllProcesses(client),
    ]);
  } catch (error) {
    loadError = error;
  }

  if (loadError || !groups || !processes) {
    return (
      <>
        <Header title="Grupos de produtos" description="Cadastro de famílias e capacidades produtivas." />
        <ErrorState
          title="Não foi possível carregar os grupos de produtos"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Grupos de produtos"
        description="Cadastre famílias e defina a capacidade por processo e fábrica."
      />
      <ProductGroupsCatalog
        groups={groups}
        processes={processes}
        canManage={can(sessionUser.role, "processes.manage")}
      />
    </>
  );
}
