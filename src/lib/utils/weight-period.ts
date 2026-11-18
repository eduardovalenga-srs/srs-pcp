/**
 * Utilitários de calendário do painel de peso concluído do dashboard.
 *
 * As datas chegam como AAAA-MM-DD (calendário do negócio, sem hora).
 * Tudo é interpretado em UTC para não deslocar o dia pelo fuso local do
 * navegador — mesma convenção usada na matriz Dia × processo.
 */

import type { CompletedWeightDay } from "@/lib/types/production";

/** Converte AAAA-MM-DD em uma data UTC à meia-noite. */
function isoDateToUtc(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sábado ou domingo (calendário do negócio). */
export function isWeekendISO(value: string): boolean {
  const date = isoDateToUtc(value);
  if (!date) return false;
  const weekday = date.getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Dias úteis (seg–sex) do período, com `periodEnd` inclusive.
 *
 * `today` é o corte EXCLUSIVO: o dia atual não entra na conta. No período
 * em curso, a média considera apenas os dias úteis já ENCERRADOS — o dia
 * de hoje ainda está em andamento e não deve diluir a média. Dias futuros
 * também ficam fora. Sem `today`, conta o período inteiro.
 *
 * Feriados não são considerados — não há calendário de feriados no sistema.
 */
export function countBusinessDays(
  periodStart: string,
  periodEnd: string,
  today?: string,
): number {
  const start = isoDateToUtc(periodStart);
  const end = isoDateToUtc(periodEnd);
  if (!start || !end) return 0;

  const todayDate = today ? isoDateToUtc(today) : null;
  const cutoff = todayDate ? new Date(todayDate.getTime() - DAY_MS) : null;
  const limit = cutoff && cutoff < end ? cutoff : end;
  if (limit < start) return 0;

  let count = 0;
  for (let time = start.getTime(); time <= limit.getTime(); time += DAY_MS) {
    const weekday = new Date(time).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/**
 * Peso concluído por processo nos dias ANTERIORES a `today` — numerador da
 * média do painel. O dia atual fica fora mesmo que já tenha lançamentos,
 * para casar com o divisor de `countBusinessDays` (dias úteis encerrados).
 *
 * As datas são AAAA-MM-DD, então a comparação de strings equivale à
 * comparação cronológica.
 */
export function sumCompletedWeightBefore(
  days: readonly CompletedWeightDay[],
  today: string,
): { total: number; byProcess: Map<string, number> } {
  let total = 0;
  const byProcess = new Map<string, number>();

  for (const day of days) {
    if (day.date >= today) continue;
    for (const cell of day.processes) {
      total += cell.weightKg;
      byProcess.set(cell.code, (byProcess.get(cell.code) ?? 0) + cell.weightKg);
    }
  }

  return { total, byProcess };
}
