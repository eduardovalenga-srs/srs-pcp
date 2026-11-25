import { notFound, redirect } from "next/navigation";

import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { EmployeeForm } from "@/components/rh/EmployeeForm";
import { hasPermission } from "@/lib/auth/access";
import { getSessionUser } from "@/lib/auth/session";
import { getEmployeeById } from "@/lib/repositories/employees.repository";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Editar funcionário" };

export default async function EditarFuncionarioPage({
  params,
}: PageProps<"/rh/funcionarios/[id]/editar">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.access, "rh.employees.edit")) {
    return <><Header title="Editar funcionário" /><AccessDenied /></>;
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let employee;
  let loadError: unknown = null;
  try {
    const client = await createClient();
    employee = await getEmployeeById(client, id);
  } catch (error) {
    loadError = error;
  }

  if (loadError) {
    return (
      <>
        <Header title="Editar funcionário" />
        <ErrorState
          title="Não foi possível carregar o funcionário"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }
  if (!employee) notFound();
  return (
    <>
      <Header title="Editar funcionário" description={employee.name} />
      <EmployeeForm employee={employee} />
    </>
  );
}
