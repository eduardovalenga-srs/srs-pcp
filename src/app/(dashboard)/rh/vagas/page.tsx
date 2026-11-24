import { redirect } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { ListPage } from "@/components/layout/ListPage";
import { RecruitmentVacanciesList } from "@/components/rh/RecruitmentVacanciesList";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import type { VacancyListItem } from "@/lib/types/recruitment";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getRecruitmentVacancies } from "@/lib/repositories/recruitment.repository";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Vagas de trabalho" };

export default async function RecruitmentVacanciesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.role, "rh.recruitment.view")) {
    return <><Header title="Vagas de trabalho" /><AccessDenied /></>;
  }

  let vacancies: VacancyListItem[] = [];
  let loadError: unknown = null;
  try {
    const client = await createClient();
    vacancies = await getRecruitmentVacancies(client);
  } catch (error) {
    loadError = error;
  }

  if (loadError) {
    return (
      <>
        <Header title="Vagas de trabalho" description="Abertura de vagas e acompanhamento do processo seletivo." />
        <ErrorState
          title="Não foi possível carregar as vagas"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
      <ListPage>
        <Header title="Vagas de trabalho" description="Abertura de vagas e acompanhamento do processo seletivo." />
        <div className="min-h-0 lg:flex-1 lg:overflow-auto">
          <RecruitmentVacanciesList vacancies={vacancies} canManage={can(user.role, "rh.recruitment.manage")} />
        </div>
      </ListPage>
  );
}
