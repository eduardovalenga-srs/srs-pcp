import { redirect } from "next/navigation";

import { AccessDenied } from "@/components/shared/AccessDenied";
import { Header } from "@/components/layout/Header";
import { EmployeeForm } from "@/components/rh/EmployeeForm";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Novo funcionário" };

export default async function NovoFuncionarioPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.role, "rh.manage")) {
    return <><Header title="Novo funcionário" /><AccessDenied /></>;
  }
  return (
    <>
      <Header title="Novo funcionário" description="Preencha os dados cadastrais do funcionário." />
      <EmployeeForm />
    </>
  );
}
