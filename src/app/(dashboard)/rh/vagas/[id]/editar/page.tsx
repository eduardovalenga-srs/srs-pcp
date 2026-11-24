import { notFound, redirect } from "next/navigation";

import { Header } from "@/components/layout/Header";
import { RecruitmentVacancyForm } from "@/components/rh/RecruitmentVacancyForm";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { getRecruitmentFormOptions, getRecruitmentVacancy } from "@/lib/repositories/recruitment.repository";
import { createClient } from "@/lib/supabase/server";
import type { RecruitmentVacancyRow } from "@/lib/types/database";
import type { RecruitmentFormOptions } from "@/lib/types/recruitment";

export const metadata = { title: "Editar vaga" };

export default async function EditRecruitmentVacancyPage({
  params,
}: PageProps<"/rh/vagas/[id]/editar">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.role, "rh.recruitment.manage")) {
    return <><Header title="Editar vaga" /><AccessDenied /></>;
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let vacancy: RecruitmentVacancyRow | null = null;
  let options: RecruitmentFormOptions | null = null;
  let loadError: unknown = null;
  try {
    const client = await createClient();
    [vacancy, options] = await Promise.all([
      getRecruitmentVacancy(client, id),
      getRecruitmentFormOptions(client),
    ]);
  } catch (error) {
    loadError = error;
  }

  if (loadError) {
    return (
      <>
        <Header title="Editar vaga" />
        <ErrorState
          title="Não foi possível carregar a vaga"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }
  if (!vacancy) notFound();
  if (!options) {
    return (
      <>
        <Header title="Editar vaga" />
        <ErrorState title="Não foi possível carregar as opções do formulário" message="Tente novamente mais tarde." />
      </>
    );
  }

  return (
    <>
      <Header title="Editar vaga" description={vacancy.title} />
      <RecruitmentVacancyForm vacancy={vacancy} options={options} />
    </>
  );
}
