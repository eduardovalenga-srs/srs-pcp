import { can } from "@/lib/auth/permissions";
import { getSessionUser } from "@/lib/auth/session";
import { employeesSheet } from "@/lib/export/columns";
import { exportFileName, searchParamsRecord } from "@/lib/export/common";
import { workbookResponse } from "@/lib/export/workbook";
import { getAllEmployees } from "@/lib/repositories/employees.repository";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils/supabase-result";
import {
  filterEmployees,
  isEmployeeSortKey,
  parseEmployeeListFilters,
  sortEmployees,
  type EmployeeSortDirection,
} from "@/lib/utils/employee-list";

/** GET /api/export/funcionarios — exporta todos os funcionários do recorte atual. */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return Response.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    if (!can(user.role, "rh.view")) {
      return Response.json(
        { error: "Seu perfil não tem permissão para exportar esta lista." },
        { status: 403 },
      );
    }

    const params = searchParamsRecord(request);
    const filters = parseEmployeeListFilters(params);
    const requestedSort = params.sort;
    const sortKey = typeof requestedSort === "string" && isEmployeeSortKey(requestedSort)
      ? requestedSort
      : "name";
    const direction: EmployeeSortDirection = params.sortDir === "desc" ? "desc" : "asc";

    const client = await createClient();
    const employees = await getAllEmployees(client);
    const filtered = filterEmployees(employees, filters);
    const sorted = sortEmployees(filtered, { key: sortKey, direction });

    return workbookResponse(exportFileName("funcionarios"), employeesSheet(sorted));
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, "Não foi possível exportar a lista.") },
      { status: 500 },
    );
  }
}
