import type { ProcessStatus } from "@/lib/constants/production";
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
  /**
   * Situação do processo NO ITEM. `NAO_APLICAVEL` (desmarcado no pedido)
   * fica de fora do cálculo: não ocupa dias e não ganha janela — antes o
   * processo desmarcado ainda consumia `durationDays` na contagem regressiva
   * e empurrava as janelas dos processos anteriores para datas antigas.
   */
  status?: ProcessStatus;
}

/** Sem duração cadastrada (ou valor inválido), o processo vale 1 dia útil. */
export function normalizeDuration(days: number): number {
  return Number.isFinite(days) && days >= 1 ? Math.floor(days) : 1;
}

/**
 * Monta a entrada de cálculo de UM item: o catálogo fornece `displayOrder` e
 * `durationDays`, e `statusOf` diz a situação daquele processo NAQUELE item.
 *
 * É o cruzamento que permite o cálculo pular processos `NAO_APLICAVEL`
 * (desmarcados) — o catálogo sozinho não tem essa informação.
 */
export function scheduleProcessesForItem(
  catalog: readonly { code: string; displayOrder: number; durationDays: number }[],
  statusOf: (code: string) => ProcessStatus | undefined,
): ScheduleProcess[] {
  return catalog.map((process) => ({
    code: process.code,
    displayOrder: process.displayOrder,
    durationDays: process.durationDays,
    status: statusOf(process.code),
  }));
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
 * Processos com status `NAO_APLICAVEL` (desmarcados no pedido) são ignorados:
 * não ocupam dias na contagem e não recebem janela. Sem data de entrega
 * válida (ou sem nenhum processo aplicável), o mapa vem vazio.
 */
export function computeProcessSchedule(
  deliveryDate: string | null | undefined,
  processes: readonly ScheduleProcess[],
): Map<string, ProcessWindow> {
  const schedule = new Map<string, ProcessWindow>();
  if (!deliveryDate || !isValidISODate(deliveryDate)) return schedule;

  // Ordena por ordem de exibição (desempate pelo código para ser determinístico).
  // O filtro de não aplicáveis acontece ANTES da cadeia: um processo fora não
  // deve "reservar" dias que nunca serão usados.
  const sorted = processes
    .filter((process) => process.status !== "NAO_APLICAVEL")
    .sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));

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
