"use server";

import { revalidatePath } from "next/cache";

import { hasPermission, isExternalAccess, type AccessContext, type PermissionKey } from "@/lib/auth/access";
import { requirePermission } from "@/lib/auth/guards";
import {
  assignEmployeeToPosition,
  createEmployeeAllocationNode,
  deleteEmployeeAllocationSubtree,
  getEmployeeAllocationNodeById,
  setEmployeeAllocationNodeActive,
  updateEmployeeAllocationNode,
} from "@/lib/repositories/employee-allocation.repository";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseServer } from "@/lib/supabase/types";
import { ALLOCATION_CHILD_KIND } from "@/lib/types/employee-allocation";
import { errorMessage } from "@/lib/utils/supabase-result";
import { firstZodMessage } from "@/lib/validators/common";
import {
  assignEmployeeAllocationSchema,
  createEmployeeAllocationNodeSchema,
  deleteEmployeeAllocationNodeSchema,
  setEmployeeAllocationActiveSchema,
  updateEmployeeAllocationNodeSchema,
  type AssignEmployeeAllocationInput,
  type CreateEmployeeAllocationNodeInput,
  type DeleteEmployeeAllocationNodeInput,
  type SetEmployeeAllocationActiveInput,
  type UpdateEmployeeAllocationNodeInput,
} from "@/lib/validators/employee-allocation.schema";

export type EmployeeAllocationActionResult = { success: boolean; message: string };

const CREATE_PERMISSION: Record<string, PermissionKey> = {
  CLIENT: "rh.allocations.create_client",
  LOCATION: "rh.allocations.create_location",
  SHIFT: "rh.allocations.create_shift",
  AREA: "rh.allocations.create_area",
  POSITION: "rh.allocations.create_position",
};

function revalidateAllocationViews() {
  revalidatePath("/rh/alocacoes");
  revalidatePath("/rh/funcionarios");
}

/**
 * Confirma que o nó pertence à subárvore de um cliente autorizado.
 * A RLS também aplica a regra; esta checagem evita depender apenas dela e
 * cobre funções `security definer` que a contornariam.
 */
async function isNodeInScope(
  client: SupabaseServer,
  access: AccessContext,
  nodeId: string,
): Promise<boolean> {
  if (!isExternalAccess(access)) return true;
  const { data, error } = await client.rpc("current_profile_can_access_node", {
    p_node_id: nodeId,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function createEmployeeAllocationNodeAction(
  input: CreateEmployeeAllocationNodeInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    const user = await requirePermission("rh.allocations.view");
    const parsed = createEmployeeAllocationNodeSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const parent = parsed.data.parentId
      ? await getEmployeeAllocationNodeById(client, parsed.data.parentId)
      : null;
    if (parsed.data.parentId && !parent) {
      return { success: false, message: "Item superior não encontrado." };
    }
    if (parent && !parent.active) {
      return { success: false, message: "Não é possível adicionar itens abaixo de uma estrutura inativa." };
    }
    const nodeType = parent ? ALLOCATION_CHILD_KIND[parent.node_type] : "CLIENT";
    if (!nodeType) {
      return { success: false, message: "Uma posição não pode receber novos níveis." };
    }
    if (!parent && nodeType !== "CLIENT") {
      return { success: false, message: "Somente clientes podem ser criados na raiz da árvore." };
    }

    const required = CREATE_PERMISSION[nodeType];
    if (!hasPermission(user.access, required)) {
      return { success: false, message: "Você não tem permissão para criar este nível da árvore." };
    }

    if (isExternalAccess(user.access)) {
      if (!parent) {
        return { success: false, message: "Usuários externos não podem criar clientes." };
      }
      if (!(await isNodeInScope(client, user.access, parent.id))) {
        return { success: false, message: "Este item pertence a outra operação." };
      }
    }

    await createEmployeeAllocationNode(client, {
      companyCode: parent?.company_code ?? "CLIENTES",
      companyName: parent?.company_name ?? "Clientes",
      parentId: parent?.id ?? null,
      nodeType,
      name: parsed.data.name,
      locationLeader: nodeType === "LOCATION" ? parsed.data.locationLeader : undefined,
      locationSupervisor: nodeType === "LOCATION" ? parsed.data.locationSupervisor : undefined,
      userId: user.id,
      returnId: false,
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
    const user = await requirePermission("rh.allocations.edit");
    const parsed = updateEmployeeAllocationNodeSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const node = await getEmployeeAllocationNodeById(client, parsed.data.id);
    if (!node) return { success: false, message: "Item da árvore não encontrado." };
    if (node.node_type === "COMPANY") {
      return { success: false, message: "O nome da empresa é mantido no cadastro de empresas." };
    }
    if (!(await isNodeInScope(client, user.access, node.id))) {
      return { success: false, message: "Este item pertence a outra operação." };
    }

    await updateEmployeeAllocationNode(
      client,
      node.id,
      parsed.data.name,
      user.id,
      node.node_type === "LOCATION" ? parsed.data.locationLeader : undefined,
      node.node_type === "LOCATION" ? parsed.data.locationSupervisor : undefined,
    );
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
    const user = await requirePermission("rh.allocations.deactivate");
    const parsed = setEmployeeAllocationActiveSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    const node = await getEmployeeAllocationNodeById(client, parsed.data.id);
    if (!node) return { success: false, message: "Item da árvore não encontrado." };
    if (node.node_type === "COMPANY") {
      return { success: false, message: "A empresa empregadora não pode ser inativada por esta tela." };
    }
    if (!(await isNodeInScope(client, user.access, node.id))) {
      return { success: false, message: "Este item pertence a outra operação." };
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

export async function deleteEmployeeAllocationNodeAction(
  input: DeleteEmployeeAllocationNodeInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    const user = await requirePermission("rh.allocations.delete");
    const parsed = deleteEmployeeAllocationNodeSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    if (!(await isNodeInScope(client, user.access, parsed.data.id))) {
      return { success: false, message: "Este item pertence a outra operação." };
    }
    await deleteEmployeeAllocationSubtree(client, parsed.data.id);
    revalidateAllocationViews();
    return { success: true, message: "Item e estrutura abaixo excluídos com sucesso." };
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

export async function assignEmployeeToPositionAction(
  input: AssignEmployeeAllocationInput,
): Promise<EmployeeAllocationActionResult> {
  try {
    const user = await requirePermission("rh.allocations.assign");
    const parsed = assignEmployeeAllocationSchema.safeParse(input);
    if (!parsed.success) return { success: false, message: firstZodMessage(parsed.error) };

    const client = await createClient();
    if (isExternalAccess(user.access)) {
      return { success: false, message: "Usuários externos não podem alterar a alocação de funcionários." };
    }
    if (parsed.data.positionId && !(await isNodeInScope(client, user.access, parsed.data.positionId))) {
      return { success: false, message: "A posição pertence a outra operação." };
    }
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
