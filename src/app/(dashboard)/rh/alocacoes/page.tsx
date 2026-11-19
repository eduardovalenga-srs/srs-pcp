import { redirect } from "next/navigation";

import { EmployeeAllocationTree } from "@/components/rh/EmployeeAllocationTree";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { getEmployees } from "@/lib/repositories/employees.repository";
import { getEmployeeAllocationNodes } from "@/lib/repositories/employee-allocation.repository";
import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeRow, EmployeeAllocationNodeRow } from "@/lib/types/database";

export const metadata = { title: "Alocações de funcionários" };

export default async function EmployeeAllocationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!can(user.role, "rh.allocation.view")) {
    return (
      <>
        <Header title="Alocações de funcionários" />
        <AccessDenied />
      </>
    );
  }

  let nodes: EmployeeAllocationNodeRow[] = [];
  let employeeRows: EmployeeRow[] = [];
  let loadError: unknown = null;
  try {
    const client = await createClient();
    [nodes, employeeRows] = await Promise.all([
      getEmployeeAllocationNodes(client),
      getEmployees(client),
    ]);
  } catch (error) {
    loadError = error;
  }

  if (loadError) {
    return (
      <>
        <Header
          title="Alocações de funcionários"
          description="Configure clientes, locais, áreas, turnos e posições."
        />
        <ErrorState
          title="Não foi possível carregar as alocações"
          message={loadError instanceof Error ? loadError.message : "Erro desconhecido."}
        />
      </>
    );
  }

  const employees = employeeRows.map((employee) => ({
    id: employee.id,
    company_code: employee.company_code,
    registration: employee.registration,
    name: employee.name,
    status: employee.status,
    allocation_position_id: employee.allocation_position_id,
  }));

  return (
    <>
      <Header
        title="Alocações de funcionários"
        description="Configure clientes, locais, áreas, turnos e posições; cada posição comporta um funcionário."
      />
      <EmployeeAllocationTree
        nodes={nodes}
        employees={employees}
        canManage={can(user.role, "rh.allocation.manage")}
      />
    </>
  );
}
