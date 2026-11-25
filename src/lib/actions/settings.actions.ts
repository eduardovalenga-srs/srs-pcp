"use server";

import { revalidatePath } from "next/cache";

import { requireSessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasAdmin } from "@/lib/repositories/profiles.repository";
import {
  listClientRoots,
  listRecentAccessAudit,
} from "@/lib/repositories/access.repository";
import { listManagedUsers } from "@/lib/services/users.service";
import { getActiveProcesses } from "@/lib/repositories/production.repository";
import { errorMessage } from "@/lib/utils/supabase-result";

export interface ActionResult {
  success: boolean;
  message: string;
}

/** Bootstrap: promove o primeiro usuário a administrador (se não há nenhum). */
export async function claimFirstAdminAction(): Promise<ActionResult> {
  try {
    const user = await requireSessionUser();
    if (user.access.accountType !== "INTERNAL") {
      return {
        success: false,
        message: "Usuários externos não podem reivindicar o acesso de administrador.",
      };
    }

    const client = await createClient();
    const { data, error } = await client.rpc("claim_first_admin");
    if (error) return { success: false, message: error.message };

    revalidatePath("/", "layout");
    return {
      success: Boolean(data?.claimed),
      message: (data?.message as string) ?? "Operação concluída.",
    };
  } catch (error) {
    console.error("[claimFirstAdminAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}

export interface ConfigData {
  users: Awaited<ReturnType<typeof listManagedUsers>>;
  processes: Awaited<ReturnType<typeof getActiveProcesses>>;
  hasAdminUser: boolean;
  /** Raízes CLIENT para vincular usuários externos. */
  clientRoots: Awaited<ReturnType<typeof listClientRoots>>;
  accessAudit: Awaited<ReturnType<typeof listRecentAccessAudit>>;
}

/** Dados da tela de configurações. */
export async function getConfigData(): Promise<ConfigData | { error: string }> {
  try {
    const user = await requireSessionUser();
    if (user.role !== "ADMIN" || user.access.accountType !== "INTERNAL") {
      throw new Error("Somente administradores podem acessar o gerenciamento de usuários.");
    }
    const client = await createClient();
    const [users, processes, adminExists, clientRoots, accessAudit] = await Promise.all([
      listManagedUsers(client),
      getActiveProcesses(client),
      hasAdmin(client),
      listClientRoots(client),
      listRecentAccessAudit(client),
    ]);
    return { users, processes, hasAdminUser: adminExists, clientRoots, accessAudit };
  } catch (error) {
    console.error("[getConfigData]", error);
    return { error: errorMessage(error) };
  }
}
