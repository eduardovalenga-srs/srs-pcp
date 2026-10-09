import { redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getAllProcesses } from "@/lib/repositories/production.repository";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { ProcessCatalog } from "@/components/processos/ProcessCatalog";

export default async function ProcessosPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "processes.view")) {
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
    <>
      <Header
        title="Processos"
        description="As colunas da tela de gestão de entregas vêm daqui — nenhum processo é fixo no código."
      />
      <ProcessCatalog processes={processes} canManage={can(sessionUser.role, "processes.manage")} />
    </>
  );
}
