"use server";

import { revalidatePath } from "next/cache";

import { requireCapability } from "@/lib/auth/guards";
import { saveProcessSchedule } from "@/lib/repositories/scheduling.repository";
import { createClient } from "@/lib/supabase/server";
import { firstZodMessage } from "@/lib/validators/common";
import {
  saveProcessScheduleSchema,
  type SaveProcessScheduleInput,
} from "@/lib/validators/scheduling.schema";
import { errorMessage } from "@/lib/utils/supabase-result";

export interface SaveProcessScheduleResult {
  success: boolean;
  message: string;
}

/** Salva a fila do processo e a data de início (070). */
export async function saveProcessScheduleAction(
  input: SaveProcessScheduleInput,
): Promise<SaveProcessScheduleResult> {
  try {
    await requireCapability("production.edit");
    const parsed = saveProcessScheduleSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: firstZodMessage(parsed.error) };
    }

    const client = await createClient();
    await saveProcessSchedule(client, {
      processId: parsed.data.processId,
      anchorDate: parsed.data.anchorDate,
      rows: parsed.data.rows,
    });

    revalidatePath("/sequenciamento");
    return { success: true, message: "Sequenciamento salvo." };
  } catch (error) {
    console.error("[saveProcessScheduleAction]", error);
    return { success: false, message: errorMessage(error) };
  }
}
