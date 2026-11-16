import type { ScheduledOrderRow, SchedulingOrderRow } from "@/lib/types/scheduling";
import { addBusinessDays, isValidISODate } from "@/lib/utils/dates";

/**
 * Calcula a carga e as datas previstas de uma fila já ordenada.
 *
 * Modelo da planilha de sequenciamento: cada OF consome
 * `peso ÷ capacidade` dias úteis. A carga é ACUMULADA (permite fração):
 * a OF começa no dia útil de `floor(acumulado)` e termina no dia útil de
 * `ceil(acumulado + carga) - 1`, contados a partir da data de início.
 * OFs sem peso/capacidade não ocupam dias e ficam sinalizadas — nunca
 * recebem um valor padrão silencioso.
 */
export function computeScheduleRows(
  rows: readonly SchedulingOrderRow[],
  anchorDate: string,
): ScheduledOrderRow[] {
  let cumulativeDays = 0;

  return rows.map((row) => {
    if (!isValidISODate(anchorDate)) {
      return { ...row, loadDays: null, startDate: null, endDate: null, issue: "Data de início inválida" };
    }

    if (row.weightKg === null || row.weightKg <= 0) {
      return { ...row, loadDays: null, startDate: null, endDate: null, issue: "OF sem peso calculado" };
    }

    if (row.productGroupId === null) {
      return {
        ...row,
        loadDays: null,
        startDate: null,
        endDate: null,
        issue: "OF sem família cadastrada",
      };
    }

    if (row.capacityKg === null || row.capacityKg <= 0) {
      return {
        ...row,
        loadDays: null,
        startDate: null,
        endDate: null,
        issue: "Sem capacidade em kg/dia para este processo",
      };
    }

    const loadDays = row.weightKg / row.capacityKg;
    const startDate = addBusinessDays(anchorDate, Math.floor(cumulativeDays));
    cumulativeDays += loadDays;
    const endDate = addBusinessDays(
      anchorDate,
      Math.max(Math.ceil(cumulativeDays) - 1, Math.floor(cumulativeDays - loadDays)),
    );

    return { ...row, loadDays, startDate, endDate, issue: null };
  });
}

/** Carga em dias com uma casa decimal (ex.: 1,9). */
export function formatLoadDays(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}
