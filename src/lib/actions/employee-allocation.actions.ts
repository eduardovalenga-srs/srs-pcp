"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import {
  assignEmployeeToPosition,
  createEmployeeAllocationNode,
  getEmployeeAllocationNodeById,
  setEmployeeAllocationNodeActive,
  updateEmployeeAllocationNodeName,
} from "@/lib/repositories/employee-allocation.repository";
import { createClient } from "@/lib/supabase/server";
import { ALLOCATION_CHILD_KIND } from "@/lib/types/employee-allocation";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import {
  assignEmployeeAllocationSchema,
  createEmployeeAllocationNodeSchema,
  setEmployeeAllocationActiveSchema,
  updateEmployeeAllocationNodeSchema,
  type AssignEmployeeAllocationInput,
  type CreateEmployeeAllocationNodeInput,
  type SetEmployeeAllocationActiveInput,
  type UpdateEmployeeAllocationNodeInput,
} from "@/lib/validators/employee-allocation.schema";

export type EmployeeAllocationActionResult = { success: boolean; message: string };

function revalidateAllocationViews() {
  revalidatePath("/rh/alocacoes");
  revalidatePath("/rh/funcionarios");
}

export async function createEmployeeAllocationNodeAction(
  input: CreateEmployeeAllocationNodeInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    const user = await requireCapability("rh.allocation.manage");
    const parsed = createEmployeeAllocationNodeSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const parent = await getEmployeeAllocationNodeById(client, parsed.data.parentId);
    if (!parent) return { success: false, message: "Item superior não encontrado." };
    if (!parent.active) {
      return { success: false, message: "Não é possível adicionar itens abaixo de uma estrutura inativa." };
    }
    const nodeType = ALLOCATION_CHILD_KIND[parent.node_type];
    if (!nodeType) {
      return { success: false, message: "Uma posição não pode receber novos níveis." };
    }

    await createEmployeeAllocationNode(client, {
      companyCode: parent.company_code,
      companyName: parent.company_name,
      parentId: parent.id,
      nodeType,
      name: parsed.data.name,
      userId: user.id,
    });
    revalidateAllocationViews();
    return { success: true, message: `${nodeType === "POSITION" ? "Posição" : "Item"} criado com sucesso.` };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function updateEmployeeAllocationNodeAction(
  input: UpdateEmployeeAllocationNodeInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    const user = await requireCapability("rh.allocation.manage");
    const parsed = updateEmployeeAllocationNodeSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const node = await getEmployeeAllocationNodeById(client, parsed.data.id);
    if (!node) return { success: false, message: "Item da árvore não encontrado." };
    if (node.node_type === "COMPANY") {
      return { success: false, message: "O nome da empresa é mantido no cadastro de empresas." };
    }

    await updateEmployeeAllocationNodeName(client, node.id, parsed.data.name, user.id);
    revalidateAllocationViews();
    return { success: true, message: "Item atualizado com sucesso." };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function setEmployeeAllocationNodeActiveAction(
  input: SetEmployeeAllocationActiveInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    const user = await requireCapability("rh.allocation.manage");
    const parsed = setEmployeeAllocationActiveSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const node = await getEmployeeAllocationNodeById(client, parsed.data.id);
    if (!node) return { success: false, message: "Item da árvore não encontrado." };
    if (node.node_type === "COMPANY") {
      return { success: false, message: "A empresa empregadora não pode ser inativada por esta tela." };
    }

    await setEmployeeAllocationNodeActive(client, node.id, parsed.data.active, user.id);
    revalidateAllocationViews();
    return {
      success: true,
      message: parsed.data.active ? "Item reativado com sucesso." : "Item inativado com sucesso.",
    };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function assignEmployeeToPositionAction(
  input: AssignEmployeeAllocationInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    await requireCapability("rh.allocation.manage");
    const parsed = assignEmployeeAllocationSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    await assignEmployeeToPosition(client, parsed.data.employeeId, parsed.data.positionId);
    revalidateAllocationViews();
    return {
      success: true,
      message: parsed.data.positionId
        ? "Funcionário alocado com sucesso. A posição anterior foi liberada."
        : "Funcionário desalocado; a posição ficou vaga.",
    };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}
