import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { EmptyState } from "@/components/shared/EmptyState";
import { Header } from "@/components/layout/Header";

export const metadata = { title: "Funcionários" };

/**
 * RH > Funcionários (043) — esqueleto do módulo de RH.
 *
 * Tela ainda em branco de propósito: a navegação e a permissão já estão
 * de pé (`menu.rh`/`rh.view`), e o cadastro entra aqui depois, sob
 * `rh.manage` (ADMIN), sem mexer em navegação ou guard.
 */
export default async function FuncionariosPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "rh.view")) {
    return (
      <>
        <Header title="Funcionários" description="Cadastro de pessoas — módulo RH." />
        <AccessDenied />
      </>
    );
  }

  return (
    <>
      <Header title="Funcionários" description="Cadastro de pessoas — módulo RH." />
      <EmptyState
        icon={<UserRound className="h-5 w-5" aria-hidden />}
        title="Cadastro de funcionários em construção"
        description="A estrutura do módulo RH já está no lugar — permissões e menu inclusos. O formulário de cadastro entra aqui."
      />
    </>
  );
}
