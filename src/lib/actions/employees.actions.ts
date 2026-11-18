"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { importEmployees, saveEmployee } from "@/lib/repositories/employees.repository";
import { createClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import {
  importEmployeeRowsSchema,
  saveEmployeeSchema,
  type SaveEmployeeInput,
} from "@/lib/validators/employee.schema";
import type { EmployeeImportRow } from "@/lib/types/employee";

export type EmployeeActionResult = { success: boolean; message: string; id?: string };

export async function saveEmployeeAction(input: SaveEmployeeInput): Promise<EmployeeActionResult> {
  try {
    const user = await requireCapability("rh.manage");
    const parsed = saveEmployeeSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const saved = await saveEmployee(client, parsed.data, user.id);
    revalidatePath("/rh/funcionarios");
    return { success: true, message: "Funcionário salvo com sucesso.", id: saved.id };
  } catch (error) {
    const message = errorMessage(error);
    if (/employees_company_registration_unique/i.test(message)) {
      return { success: false, message: "Já existe funcionário com essa matrícula nesta empresa." };
    }
    return { success: false, message };
  }
}

export async function importEmployeesAction(rows: EmployeeImportRow[]): Promise<EmployeeActionResult> {
  try {
    await requireCapability("rh.manage");
    const parsed = importEmployeeRowsSchema.safeParse(
      rows.map((row) => ({
        company_code: row.company_code,
        company_name: row.company_name,
        registration: row.registration,
        name: row.name,
        admission_date: row.admission_date,
        dismissal_date: row.dismissal_date,
        location: row.location,
      })),
    );
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const count = await importEmployees(
      client,
      parsed.data.map((row) => ({
        companyCode: row.company_code,
        companyName: row.company_name,
        registration: row.registration,
        name: row.name,
        admissionDate: row.admission_date,
        dismissalDate: row.dismissal_date,
        location: row.location,
      })),
    );
    revalidatePath("/rh/funcionarios");
    return { success: true, message: `${count} funcionário(s) processado(s) na importação.` };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}
