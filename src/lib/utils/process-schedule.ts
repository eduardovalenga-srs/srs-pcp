import { isValidISODate, previousBusinessDay, subBusinessDays } from "@/lib/utils/dates";

/** Janela prevista de execução de um processo (YYYY-MM-DD). */
export interface ProcessWindow {
  /** Primeiro dia útil em que o processo deve rodar. */
  start: string;
  /** Último dia útil (inclusive) em que o processo deve terminar. */
  end: string;
}

/** Dados mínimos de cada processo para o cálculo. */
export interface ScheduleProcess {
  code: string;
  displayOrder: number;
  durationDays: number;
}

/** Sem duração cadastrada (ou valor inválido), o processo vale 1 dia útil. */
function normalizeDuration(days: number): number {
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 1;
}

/**
 * Janelas previstas de execução de cada processo, contadas de TRÁS para
 * FRENTE a partir da data de entrega, somente em DIAS ÚTEIS (seg–sex):
 *
 *  - a EXPEDIÇÃO (último processo, maior `displayOrder`) acontece no dia
 *    útil ANTERIOR à data de entrega — a entrega vem depois do envio
 *    (se a entrega cair em fim de semana, a expedição é a sexta anterior);
 *  - cada processo anterior termina no dia útil anterior ao início do
 *    seguinte;
 *  - a janela de um processo ocupa `durationDays` dias úteis
 *    (start + durationDays - 1 em dias úteis = end).
 *
 * Feriados não são considerados (não há calendário de feriados).
 * Retorna um mapa `code -> janela`; sem data de entrega válida, o mapa
 * vem vazio (não há como planejar).
 */
export function computeProcessSchedule(
  deliveryDate: string | null | undefined,
  processes: readonly ScheduleProcess[],
): Map<string, ProcessWindow> {
  const schedule = new Map<string, ProcessWindow>();
  if (!deliveryDate || !isValidISODate(deliveryDate)) return schedule;

  // Ordena por ordem de exibição (desempate pelo código para ser determinístico).
  const sorted = [...processes].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code),
  );

  let nextStart: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const process = sorted[i];
    const duration = normalizeDuration(process.durationDays);
    // Expedição: dia útil anterior à entrega. Demais processos: dia útil
    // anterior ao início do próximo (pula sábado/domingo nos dois casos).
    const end = previousBusinessDay(nextStart ?? deliveryDate);
    const start = subBusinessDays(end, duration - 1);
    schedule.set(process.code, { start, end });
    nextStart = start;
  }

  return schedule;
}

/** Janela prevista de um processo específico (null se não houver entrega/processo). */
export function getProcessWindow(
  deliveryDate: string | null | undefined,
  processes: readonly ScheduleProcess[],
  code: string,
): ProcessWindow | null {
  return computeProcessSchedule(deliveryDate, processes).get(code) ?? null;
}
