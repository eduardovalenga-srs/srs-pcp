import { redirect } from "next/navigation";


import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAllProcesses } from "@/lib/repositories/production.repository";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { ListPage } from "@/components/layout/ListPage";
import { ProcessCatalog } from "@/components/processos/ProcessCatalog";
import { hasPermission } from "@/lib/auth/access";

export const metadata = { title: "Processos" };

export default async function ProcessosPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!hasPermission(sessionUser.access, "processes.view")) {
    return (
      <>
        <Header title="Processos" description="Catálogo de etapas do fluxo fabril." />
        <AccessDenied />
      </>
    );
  }

  let processes: Awaited<ReturnType<typeof getAllProcesses>>;
  try {
    const client = await createClient();
    processes = await getAllProcesses(client);
  } catch (error) {
    return (
      <>
        <Header title="Processos" description="Catálogo de etapas do fluxo fabril." />
        <ErrorState
          title="Não foi possível carregar os processos"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <ListPage>
      <Header
        title="Processos"
        description="As colunas da tela de gestão de OF vêm daqui — nenhum processo é fixo no código."
      />
      <ProcessCatalog processes={processes} canManage={hasPermission(sessionUser.access, "processes.manage")} />
    </ListPage>
  );
}
