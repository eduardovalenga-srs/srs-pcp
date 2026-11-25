import { redirect } from "next/navigation";

import { hasPermission, isExternalAccess } from "@/lib/auth/access";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getEmployees } from "@/lib/repositories/employees.repository";
import type { EmployeeListRow } from "@/lib/utils/employee-list";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { ListPage } from "@/components/layout/ListPage";
import { EmployeesList } from "@/components/rh/EmployeesList";

export const metadata = { title: "Funcionários" };

export default async function FuncionariosPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect("/login");

  if (!hasPermission(sessionUser.access, "rh.employees.view")) {
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

  const external = isExternalAccess(sessionUser.access);
  const visibleEmployees: EmployeeListRow[] = external
    ? employees.map(({ billing_model, ...employee }) => {
        void billing_model;
        return employee;
      })
    : employees;

  return (
    <ListPage>
      <Header
        title="Funcionários"
        description={
          external
            ? "Funcionários alocados à operação ou vinculados ao cliente cadastrado na folha."
            : "Cadastro e consulta de funcionários."
        }
      />
      <EmployeesList
        employees={visibleEmployees}
        canCreate={hasPermission(sessionUser.access, "rh.employees.create")}
        canEdit={hasPermission(sessionUser.access, "rh.employees.edit")}
        canImport={hasPermission(sessionUser.access, "rh.employees.import")}
        restricted={external}
      />
    </ListPage>
  );
}
