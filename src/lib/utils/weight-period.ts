/**
 * Utilitários de calendário do painel de peso concluído do dashboard.
 *
 * As datas chegam como AAAA-MM-DD (calendário do negócio, sem hora).
 * Tudo é interpretado em UTC para não deslocar o dia pelo fuso local do
 * navegador — mesma convenção usada na matriz Dia × processo.
 */

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
 * Dias úteis (seg–sex) entre `periodStart` e `periodEnd`, inclusive.
 *
 * Para o período em curso, `today` limita o fim: só os dias úteis já
 * transcorridos entram na conta (dias futuros não diluem a média).
 * Feriados não são considerados — não há calendário de feriados no
 * sistema.
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
  const limit = todayDate && todayDate < end ? todayDate : end;
  if (limit < start) return 0;

  let count = 0;
  for (let time = start.getTime(); time <= limit.getTime(); time += DAY_MS) {
    const weekday = new Date(time).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}
