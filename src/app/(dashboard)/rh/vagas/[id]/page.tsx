import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { Header } from "@/components/layout/Header";
import { RecruitmentVacancyDetail } from "@/components/rh/RecruitmentVacancyDetail";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";

import { getSessionUser } from "@/lib/auth/session";
import { getRecruitmentCandidates, getRecruitmentVacancy } from "@/lib/repositories/recruitment.repository";
import { createClient } from "@/lib/supabase/server";
import type { RecruitmentCandidateRow } from "@/lib/types/database";
import type { RecruitmentVacancyDetails } from "@/lib/types/recruitment";
import { hasPermission } from "@/lib/auth/access";

export const metadata = { title: "Detalhes da vaga" };

export default async function RecruitmentVacancyPage({
  params,
}: PageProps<"/rh/vagas/[id]">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.access, "rh.recruitment.view")) {
    return <><Header title="Detalhes da vaga" /><AccessDenied /></>;
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let vacancy: RecruitmentVacancyDetails | null = null;
  let candidates: RecruitmentCandidateRow[] = [];
  let loadError: unknown = null;
  try {
    const client = await createClient();
    vacancy = await getRecruitmentVacancy(client, id);
    if (vacancy) candidates = await getRecruitmentCandidates(client, id);
  } catch (error) {
    loadError = error;
  }

  if (loadError) {
    return (
      <>
        <Header title="Detalhes da vaga" />
        <ErrorState
          title="Não foi possível carregar a vaga"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }
  if (!vacancy) notFound();

  return (
    <>
      <Header
        title="Detalhes da vaga"
        description="Informações da oportunidade e andamento dos candidatos."
        actions={<Link href="/rh/vagas" className="text-sm text-primary hover:underline">Voltar para vagas</Link>}
      />
      <RecruitmentVacancyDetail
        vacancy={vacancy}
        candidates={candidates}
        canManage={hasPermission(user.access, "rh.recruitment.manage")}
      />
    </>
  );
}
