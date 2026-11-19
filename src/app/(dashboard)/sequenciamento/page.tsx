import { redirect } from "next/navigation";

import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { ListPage } from "@/components/layout/ListPage";
import { ProcessScheduling } from "@/components/sequenciamento/ProcessScheduling";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getAllProcesses } from "@/lib/repositories/production.repository";
import { getAllProductGroups } from "@/lib/repositories/product-groups.repository";
import { getProcessScheduling } from "@/lib/repositories/scheduling.repository";
import { createClient } from "@/lib/supabase/server";
import type { ProcessDefinition } from "@/lib/types/production";
import type { ProductGroupDefinition } from "@/lib/types/product-group";

export const metadata = { title: "Sequenciamento" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SequenciamentoPage({ searchParams }: PageProps) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "menu.sequenciamento")) {
    return (
      <>
        <Header title="Sequenciamento" description="Prioridade global das OFs e planejamento por capacidade." />
        <AccessDenied />
      </>
    );
  }

  const params = await searchParams;
  let processes: ProcessDefinition[];
  let groups: ProductGroupDefinition[];

  try {
    const client = await createClient();
    [processes, groups] = await Promise.all([
      getAllProcesses(client),
      getAllProductGroups(client),
    ]);
  } catch (error) {
    return (
      <>
        <Header title="Sequenciamento" description="Prioridade global das OFs e planejamento por capacidade." />
        <ErrorState
          title="Não foi possível carregar o sequenciamento"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const activeProcesses = processes.filter((process) => process.active);
  const requestedProcess = typeof params.processo === "string" ? params.processo : null;
  const processId = activeProcesses.find((process) => process.id === requestedProcess)?.id ?? null;
  const requestedFamily = typeof params.familia === "string" ? Number(params.familia) : Number.NaN;
  const familyGroupId = groups.some((group) => group.id === requestedFamily)
    ? requestedFamily
    : null;

  let scheduling: Awaited<ReturnType<typeof getProcessScheduling>> | null = null;
  let loadError: unknown = null;
  try {
    const client = await createClient();
    scheduling = await getProcessScheduling(client, { processId, familyGroupId });
  } catch (error) {
    loadError = error;
  }

  const canEdit = can(sessionUser.role, "production.edit");

  if (loadError) {
    return (
      <>
        <Header title="Sequenciamento" description="Prioridade global das OFs e planejamento por capacidade." />
        <ErrorState
          title="Não foi possível carregar o sequenciamento"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <ListPage>
      <Header
        title="Sequenciamento"
        description="Defina a prioridade global das OFs. Sem processo, veja todas; ao selecionar um processo, veja as OFs com essa etapa pendente ou concluída. As concluídas aparecem com peso zero e não consomem capacidade (peso ÷ kg/dia, em dias úteis). OFs com a expedição concluída saem da fila e ficam no fim da Gestão de OF."
      />

      {!scheduling ? (
        <p className="rounded border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Não foi possível carregar as OFs do sequenciamento.
        </p>
      ) : (
        <ProcessScheduling
          key={`${processId ?? "all"}-${familyGroupId ?? "all"}`}
          processes={activeProcesses}
          groups={groups}
          processId={processId}
          familyGroupId={familyGroupId}
          initialAnchorDate={scheduling.anchorDate}
          initialRows={scheduling.rows}
          canEdit={canEdit}
        />
      )}
    </ListPage>
  );
}
