import type { SupabaseServer } from "@/lib/supabase/types";
import type { EmployeeAllocationNodeRow } from "@/lib/types/database";
import { assertOk } from "@/lib/utils/supabase-result";

const NODE_COLUMNS =
  "id, company_code, company_name, parent_id, node_type, name, active, sort_order, created_at, updated_at, created_by, updated_by";

export async function getEmployeeAllocationNodes(
  client: SupabaseServer,
): Promise<EmployeeAllocationNodeRow[]> {
  const { data, error } = await client
    .from("employee_allocation_nodes")
    .select(NODE_COLUMNS)
    .order("company_code", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  assertOk(error, "Não foi possível carregar a árvore de alocações");
  return (data ?? []) as unknown as EmployeeAllocationNodeRow[];
}

export async function getEmployeeAllocationNodeById(
  client: SupabaseServer,
  id: string,
): Promise<EmployeeAllocationNodeRow | null> {
  const { data, error } = await client
    .from("employee_allocation_nodes")
    .select(NODE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  assertOk(error, "Não foi possível carregar o item da árvore");
  return data as unknown as EmployeeAllocationNodeRow | null;
}

export async function createEmployeeAllocationNode(
  client: SupabaseServer,
  input: {
    companyCode: string;
    companyName: string;
    parentId: string;
    nodeType: Exclude<EmployeeAllocationNodeRow["node_type"], "COMPANY">;
    name: string;
    userId: string;
  },
): Promise<void> {
  const { error } = await client.from("employee_allocation_nodes").insert({
    company_code: input.companyCode,
    company_name: input.companyName,
    parent_id: input.parentId,
    node_type: input.nodeType,
    name: input.name,
    created_by: input.userId,
    updated_by: input.userId,
  });
  assertOk(error, "Não foi possível criar o item da árvore");
}

export async function updateEmployeeAllocationNodeName(
  client: SupabaseServer,
  id: string,
  name: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("employee_allocation_nodes")
    .update({ name, updated_by: userId })
    .eq("id", id);
  assertOk(error, "Não foi possível atualizar o item da árvore");
}

export async function setEmployeeAllocationNodeActive(
  client: SupabaseServer,
  id: string,
  active: boolean,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("employee_allocation_nodes")
    .update({ active, updated_by: userId })
    .eq("id", id);
  assertOk(error, "Não foi possível atualizar o status do item");
}

export async function deleteEmployeeAllocationSubtree(
  client: SupabaseServer,
  id: string,
): Promise<void> {
  const { error } = await client.rpc("delete_employee_allocation_subtree", {
    p_node_id: id,
  });
  assertOk(error, "Não foi possível excluir o item da árvore");
}

export async function assignEmployeeToPosition(
  client: SupabaseServer,
  employeeId: string,
  positionId: string | null,
): Promise<void> {
  const { error } = await client.rpc("assign_employee_allocation", {
    p_employee_id: employeeId,
    p_position_id: positionId,
  });
  assertOk(error, "Não foi possível atualizar a alocação do funcionário");
}
