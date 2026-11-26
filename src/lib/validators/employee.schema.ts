import { z } from "zod";

import { EMPLOYEE_BILLING_MODELS } from "@/lib/types/employee";

export const saveEmployeeSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  companyCode: z.string().trim().min(1, "Selecione a empresa").max(12),
  companyName: z.string().trim().min(1, "Informe a empresa").max(150),
  registration: z.string().trim().min(1, "Informe a matrícula").max(40),
  name: z.string().trim().min(1, "Informe o nome").max(180),
  billingModel: z.enum(EMPLOYEE_BILLING_MODELS).default("HORA"),
  admissionDate: z.string().date().nullable().optional(),
  dismissalDate: z.string().date().nullable().optional(),
  location: z.string().trim().max(180).nullable().optional(),
  shift: z.string().trim().max(80).nullable().optional(),
  area: z.string().trim().max(120).nullable().optional(),
  client: z.string().trim().max(150).nullable().optional(),
  responsible1: z.string().trim().max(150).nullable().optional(),
  responsible2: z.string().trim().max(150).nullable().optional(),
});

export type SaveEmployeeInput = z.input<typeof saveEmployeeSchema>;
export type SaveEmployeeOutput = z.output<typeof saveEmployeeSchema>;

export const importEmployeeRowsSchema = z
  .array(
    z.object({
      company_code: z.string().trim().min(1).max(12),
      company_name: z.string().trim().min(1).max(150),
      registration: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(180),
      admission_date: z.string().date().nullable(),
      dismissal_date: z.string().date().nullable(),
      registered_client: z.string().trim().max(180).nullable(),
      registered_function: z.string().trim().max(180).nullable(),
    }),
  )
  .min(1, "Nenhum funcionário válido para importar.")
  .max(2000, "A importação excedeu 2.000 funcionários.");
