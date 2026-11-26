import type { SupabaseServer } from "@/lib/supabase/types";
import type { EmployeeRow } from "@/lib/types/database";
import type { SaveEmployeeOutput } from "@/lib/validators/employee.schema";
import { assertOk } from "@/lib/utils/supabase-result";

const EMPLOYEE_COLUMNS =
  "id, company_code, company_name, registration, name, billing_model, admission_date, dismissal_date, registered_client, registered_function, location, status, shift, area, client, responsible_1, responsible_2, allocation_position_id, created_at, updated_at, created_by, updated_by";

const EMPLOYEE_PAGE_SIZE = 1000;

/**
 * Carrega todos os funcionários, percorrendo as páginas do PostgREST.
 * A folha atual tem mais de 1.000 registros; um `range(0, 999)` fixo
 * esconderia parte do cadastro na lista e na árvore de alocações.
 */
export async function getEmployees(client: SupabaseServer): Promise<EmployeeRow[]> {
  const employees: EmployeeRow[] = [];
  let from = 0;
  let total = Number.POSITIVE_INFINITY;

  while (from < total) {
    const { data, error, count } = await client
      .from("employees")
      .select(EMPLOYEE_COLUMNS, { count: "exact" })
      .order("name", { ascending: true })
      // Desempate estável entre páginas quando há nomes repetidos.
      .order("id", { ascending: true })
      .range(from, from + EMPLOYEE_PAGE_SIZE - 1);

    assertOk(error, "Não foi possível carregar os funcionários");
    const page = (data ?? []) as unknown as EmployeeRow[];
    employees.push(...page);
    from += page.length;

    if (typeof count === "number") total = count;
    if (page.length === 0) break;
  }

  return employees;
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
    billing_model: input.billingModel,
    admission_date: input.admissionDate || null,
    dismissal_date: input.dismissalDate || null,
    updated_by: userId,
    ...(input.location !== undefined ? { location: input.location || null } : {}),
    ...(input.shift !== undefined ? { shift: input.shift || null } : {}),
    ...(input.area !== undefined ? { area: input.area || null } : {}),
    ...(input.client !== undefined ? { client: input.client || null } : {}),
    ...(input.responsible1 !== undefined ? { responsible_1: input.responsible1 || null } : {}),
    ...(input.responsible2 !== undefined ? { responsible_2: input.responsible2 || null } : {}),
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
  rows: {
    companyCode: string;
    companyName: string;
    registration: string;
    name: string;
    admissionDate: string | null;
    dismissalDate: string | null;
    registeredClient: string | null;
    registeredFunction: string | null;
  }[],
): Promise<number> {
  const { data, error } = await client.rpc("import_employees", {
    p_rows: rows.map((row) => ({
      company_code: row.companyCode,
      company_name: row.companyName,
      registration: row.registration,
      name: row.name,
      admission_date: row.admissionDate || null,
      dismissal_date: row.dismissalDate || null,
      registered_client: row.registeredClient || null,
      registered_function: row.registeredFunction || null,
    })),
  });
  assertOk(error, "Não foi possível importar os funcionários");
  return Number(data ?? 0);
}
