"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { getAllProcesses } from "@/lib/repositories/production.repository";
import { saveProductGroup } from "@/lib/repositories/product-groups.repository";
import { createClient } from "@/lib/supabase/server";
import { firstZodMessage } from "@/lib/validators/common";
import {
  saveProductGroupSchema,
  type SaveProductGroupInput,
} from "@/lib/validators/product-group.schema";
import { errorMessage } from "@/lib/utils/supabase-result";

export interface ProductGroupActionResult {
  success: boolean;
  message: string;
  id?: number;
  groupType?: string;
}

export async function saveProductGroupAction(
  input: SaveProductGroupInput,
): Promise<ProductGroupActionResult> {
  try {
    await requireCapability("processes.manage");
    const parsed = saveProductGroupSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) };
    }

    const client = await createClient();
    const processes = await getAllProcesses(client);
    const byId = new Map(processes.map((process) => [process.id, process]));
    const unmapped = processes.filter(
      (process) => process.location !== "Fábrica 1" && process.location !== "Fábrica 2",
    );
    if (unmapped.length > 0) {
      return {
        success: false,
        message: `Defina a fábrica de todos os processos em Processos. Pendentes: ${unmapped
          .map((process) => process.code)
          .join(", ")}.`,
      };
    }

    const capacityProcessIds = new Set(parsed.data.capacities.map((capacity) => capacity.processId));
    const missing = processes.filter((process) => !capacityProcessIds.has(process.id));
    if (missing.length > 0) {
      return {
        success: false,
        message: `Informe a capacidade dos processos: ${missing.map((process) => process.code).join(", ")}.`,
      };
    }

    const wrongFactory = parsed.data.capacities.find(
      (capacity) => byId.get(capacity.processId)?.location !== capacity.factory,
    );
    if (wrongFactory) {
      return { success: false, message: "Cada processo deve estar associado à sua fábrica cadastrada." };
    }

    const saved = await saveProductGroup(client, {
      id: parsed.data.id ?? null,
      familyDescription: parsed.data.familyDescription,
      familyAbbreviation: parsed.data.familyAbbreviation,
      capacities: parsed.data.capacities,
    });

    revalidatePath("/grupos-produtos");
    return {
      success: true,
      message: `Grupo ${saved.groupType} salvo com sucesso.`,
      id: saved.id,
      groupType: saved.groupType,
    };
  } catch (error) {
    console.error("[saveProductGroupAction]", error);
    const message = errorMessage(error);
    if (/product_groups_family_abbreviation_unique/i.test(message)) {
      return { success: false, message: "Já existe um grupo com essa abreviação." };
    }
    if (/product_group_items_description_unique/i.test(message)) {
      return { success: false, message: "As descrições dos itens não podem se repetir no mesmo grupo." };
    }
    return { success: false, message };
  }
}
