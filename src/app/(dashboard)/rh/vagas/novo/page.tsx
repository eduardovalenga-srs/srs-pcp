import { redirect } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { RecruitmentVacancyForm } from "@/components/rh/RecruitmentVacancyForm";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getRecruitmentFormOptions } from "@/lib/repositories/recruitment.repository";
import { createClient } from "@/lib/supabase/server";
import type { RecruitmentFormOptions } from "@/lib/types/recruitment";

export const metadata = { title: "Abrir vaga" };

export default async function NewRecruitmentVacancyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.role, "rh.recruitment.manage")) {
    return <><Header title="Abrir vaga" /><AccessDenied /></>;
  }
  let options: RecruitmentFormOptions | null = null;
  let loadError: unknown = null;
  try {
    const client = await createClient();
    options = await getRecruitmentFormOptions(client);
  } catch (error) {
    loadError = error;
  }
  if (loadError || !options) {
    return (
      <>
        <Header title="Abrir vaga" />
        <ErrorState
          title="Não foi possível carregar as opções do formulário"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }
  return (
    <>
      <Header title="Abrir vaga" description="Registre a necessidade e os critérios para iniciar o recrutamento." />
      <RecruitmentVacancyForm options={options} />
    </>
  );
}
