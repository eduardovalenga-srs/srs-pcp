import "server-only";

import { getActiveProcesses } from "@/lib/repositories/production.repository";
import {
  getAllProcessScheduling,
  getLatestProcessScheduleAnchor,
} from "@/lib/repositories/scheduling.repository";
import type { SupabaseServer } from "@/lib/supabase/types";
import type { OrderScheduleIndex } from "@/lib/types/scheduling";
import { buildScheduleIndex } from "@/lib/utils/sequenced-schedule";

/**
 * Índice de datas previstas por OF, lido das filas do sequenciamento.
 *
 * É a fonte única das datas de processo e da data de expedição em todas as
 * telas: Gestão de OF, Fábrica 1, Fábrica 2 e Pedidos. Como a cadeia precisa
 * das capacidades/âncoras de todos os processos, as filas são carregadas
 * juntas (093), combinadas com o catálogo ativo e com a última âncora salva.
 */
export async function getScheduleIndex(client: SupabaseServer): Promise<OrderScheduleIndex> {
  const [queues, processes, anchorOverride] = await Promise.all([
    getAllProcessScheduling(client),
    getActiveProcesses(client),
    getLatestProcessScheduleAnchor(client),
  ]);
  return buildScheduleIndex(queues, processes, anchorOverride);
}
