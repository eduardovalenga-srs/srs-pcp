import "server-only";

import { getAllProcessScheduling } from "@/lib/repositories/scheduling.repository";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { OrderScheduleIndex } from "@/lib/types/scheduling";
import { buildScheduleIndex } from "@/lib/utils/sequenced-schedule";

/**
 * Índice de datas previstas por OF, lido das filas do sequenciamento.
 *
 * É a fonte única das datas de processo e da data de expedição (DP) em
 * todas as telas: Gestão de OF, Fábrica 1, Fábrica 2 e Pedidos. Como o
 * cálculo é acumulado por processo, a página visível sozinha não basta —
 * as filas inteiras vêm em uma chamada (093).
 */
export async function getScheduleIndex(client: SupabaseServer): Promise<OrderScheduleIndex> {
  return buildScheduleIndex(await getAllProcessScheduling(client));
}
