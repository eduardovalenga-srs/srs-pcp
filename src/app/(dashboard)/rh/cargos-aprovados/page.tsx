import { redirect } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { RecruitmentApprovedRolesManager } from "@/components/rh/RecruitmentApprovedRolesManager";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getRecruitmentApprovedRoleManagementData } from "@/lib/repositories/recruitment.repository";
import { createClient } from "@/lib/supabase/server";
import type { RecruitmentApprovedRoleManagementData } from "@/lib/types/recruitment";

export const metadata = { title: "Cargos aprovados" };

export default async function RecruitmentApprovedRolesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.role, "rh.recruitment.manage")) {
    return <><Header title="Cargos aprovados" /><AccessDenied /></>;
  }

  let data: RecruitmentApprovedRoleManagementData | null = null;
  let loadError: unknown = null;
  try {
    const client = await createClient();
    data = await getRecruitmentApprovedRoleManagementData(client);
  } catch (error) {
    loadError = error;
  }

  if (loadError || !data) {
    return (
      <>
        <Header title="Cargos aprovados" />
        <ErrorState
          title="Não foi possível carregar os cargos aprovados"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Cargos aprovados"
        description="Cadastre os cargos aprovados por cliente para usar na abertura de vagas."
      />
      <RecruitmentApprovedRolesManager data={data} />
    </>
  );
}
