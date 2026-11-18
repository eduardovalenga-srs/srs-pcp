import { redirect } from "next/navigation";

import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getEmployees } from "@/lib/repositories/employees.repository";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { EmployeesList } from "@/components/rh/EmployeesList";

export const metadata = { title: "Funcionários" };

export default async function FuncionariosPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!can(sessionUser.role, "rh.view")) {
    return (
      <>
        <Header title="Funcionários" description="Cadastro e consulta de funcionários." />
        <AccessDenied />
      </>
    );
  }

  let employees;
  try {
    const client = await createClient();
    employees = await getEmployees(client);
  } catch (error) {
    return (
      <>
        <Header title="Funcionários" description="Cadastro e consulta de funcionários." />
        <ErrorState
          title="Não foi possível carregar os funcionários"
          message={error instanceof Error ? error.message : "Erro desconhecido."}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title="Funcionários"
        description={`${employees.length} funcionário(s) cadastrado(s).`}
      />
      <EmployeesList employees={employees} canManage={can(sessionUser.role, "rh.manage")} />
    </>
  );
}
