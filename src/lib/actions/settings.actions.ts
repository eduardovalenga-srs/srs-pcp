"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { hasAdmin } from "@/lib/repositories/profiles.repository";
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
}

/** Dados da tela de configurações. */
export async function getConfigData(): Promise<ConfigData | { error: string }> {
  try {
    await requireCapability("settings.manage");
    const client = await createClient();
    const [users, processes, adminExists] = await Promise.all([
      listManagedUsers(client),
      getActiveProcesses(client),
      hasAdmin(client),
    ]);
    return { users, processes, hasAdminUser: adminExists };
  } catch (error) {
    console.error("[getConfigData]", error);
    return { error: errorMessage(error) };
  }
}
