import type { SupabaseServer } from "@/lib/supabase/types";
import type { EmployeeRow } from "@/lib/types/database";
import type { SaveEmployeeOutput } from "@/lib/validators/employee.schema";
import { assertOk } from "@/lib/utils/supabase-result";

const EMPLOYEE_COLUMNS =
  "id, company_code, company_name, registration, name, admission_date, dismissal_date, location, status, shift, area, client, responsible_1, responsible_2, allocation_position_id, created_at, updated_at, created_by, updated_by";

export async function getEmployees(client: SupabaseServer): Promise<EmployeeRow[]> {
  const { data, error } = await client
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .order("name", { ascending: true })
    .range(0, 999);

  assertOk(error, "Não foi possível carregar os funcionários");
  return (data ?? []) as unknown as EmployeeRow[];
}

export async function getEmployeeById(
  client: SupabaseServer,
  id: string,
): Promise<EmployeeRow | null> {
  const { data, error } = await client
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o funcionário");
  return data as unknown as EmployeeRow | null;
}

export async function saveEmployee(
  client: SupabaseServer,
  input: SaveEmployeeOutput,
  userId: string,
): Promise<EmployeeRow> {
  const values = {
    company_code: input.companyCode,
    company_name: input.companyName,
    registration: input.registration,
    name: input.name,
    admission_date: input.admissionDate || null,
    dismissal_date: input.dismissalDate || null,
    responsible_1: input.responsible1 || null,
    responsible_2: input.responsible2 || null,
    updated_by: userId,
    ...(input.location !== undefined ? { location: input.location || null } : {}),
    ...(input.shift !== undefined ? { shift: input.shift || null } : {}),
    ...(input.area !== undefined ? { area: input.area || null } : {}),
    ...(input.client !== undefined ? { client: input.client || null } : {}),
  };

  const query = input.id
    ? client.from("employees").update(values).eq("id", input.id)
    : client.from("employees").insert({ ...values, created_by: userId });
  const { data, error } = await query.select(EMPLOYEE_COLUMNS).single();

  assertOk(error, "Não foi possível salvar o funcionário");
  return data as unknown as EmployeeRow;
}

export async function importEmployees(
  client: SupabaseServer,
  rows: Omit<SaveEmployeeOutput, "id" | "shift" | "area" | "client" | "responsible1" | "responsible2">[],
): Promise<number> {
  const { data, error } = await client.rpc("import_employees", {
    p_rows: rows.map((row) => ({
      company_code: row.companyCode,
      company_name: row.companyName,
      registration: row.registration,
      name: row.name,
      admission_date: row.admissionDate || null,
      dismissal_date: row.dismissalDate || null,
      location: row.location || null,
    })),
  });
  assertOk(error, "Não foi possível importar os funcionários");
  return Number(data ?? 0);
}
