import { z } from "zod";

export const createEmployeeAllocationNodeSchema = z.object({
  parentId: z.string().uuid("Item superior inválido"),
  name: z.string().trim().min(1, "Informe o nome").max(120, "Máximo de 120 caracteres"),
});

export const updateEmployeeAllocationNodeSchema = z.object({
  id: z.string().uuid("Item inválido"),
  name: z.string().trim().min(1, "Informe o nome").max(120, "Máximo de 120 caracteres"),
});

export const setEmployeeAllocationActiveSchema = z.object({
  id: z.string().uuid("Item inválido"),
  active: z.boolean(),
});

export const deleteEmployeeAllocationNodeSchema = z.object({
  id: z.string().uuid("Item inválido"),
});

export const assignEmployeeAllocationSchema = z.object({
  employeeId: z.string().uuid("Funcionário inválido"),
  positionId: z.string().uuid("Posição inválida").nullable(),
});

export type CreateEmployeeAllocationNodeInput = z.input<
  typeof createEmployeeAllocationNodeSchema
>;
export type UpdateEmployeeAllocationNodeInput = z.input<
  typeof updateEmployeeAllocationNodeSchema
>;
export type SetEmployeeAllocationActiveInput = z.input<
  typeof setEmployeeAllocationActiveSchema
>;
export type DeleteEmployeeAllocationNodeInput = z.input<
  typeof deleteEmployeeAllocationNodeSchema
>;
export type AssignEmployeeAllocationInput = z.input<typeof assignEmployeeAllocationSchema>;
