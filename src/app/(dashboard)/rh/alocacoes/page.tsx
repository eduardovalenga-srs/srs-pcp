import { redirect } from "next/navigation";

import { EmployeeAllocationTree } from "@/components/rh/EmployeeAllocationTree";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ErrorState } from "@/components/shared/ErrorState";
import { Header } from "@/components/layout/Header";
import { getEmployees } from "@/lib/repositories/employees.repository";
import { getEmployeeAllocationNodes } from "@/lib/repositories/employee-allocation.repository";
import { hasPermission, isExternalAccess } from "@/lib/auth/access";
import { getSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeRow, EmployeeAllocationNodeRow } from "@/lib/types/database";
import type { EmployeeAllocationKind } from "@/lib/types/employee-allocation";

export const metadata = { title: "Alocações de funcionários" };

export default async function EmployeeAllocationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.access, "rh.allocations.view")) {
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
    registration: employee.registration,
    name: employee.name,
    status: employee.status,
    allocation_position_id: employee.allocation_position_id,
  }));

  const access = user.access;
  const external = isExternalAccess(access);
  const canCreate: Record<EmployeeAllocationKind, boolean> = {
    CLIENT: hasPermission(access, "rh.allocations.create_client"),
    LOCATION: hasPermission(access, "rh.allocations.create_location"),
    SHIFT: hasPermission(access, "rh.allocations.create_shift"),
    AREA: hasPermission(access, "rh.allocations.create_area"),
    POSITION: hasPermission(access, "rh.allocations.create_position"),
  };

  return (
    <>
      <Header
        title="Alocações de funcionários"
        description={
          external
            ? "Estrutura da operação do seu cliente: locais, turnos, áreas e posições."
            : "Configure clientes, locais, áreas, turnos e posições; cada posição comporta um funcionário."
        }
      />
      <EmployeeAllocationTree
        nodes={nodes}
        employees={employees}
        canCreateClient={canCreate.CLIENT}
        canCreate={canCreate}
        canEdit={hasPermission(access, "rh.allocations.edit")}
        canDeactivate={hasPermission(access, "rh.allocations.deactivate")}
        canDelete={hasPermission(access, "rh.allocations.delete")}
        canAssign={hasPermission(access, "rh.allocations.assign")}
      />
    </>
  );
}
