import type {
  CompletedWeightBucket,
  CompletedWeightCell,
  CompletedWeightDay,
  CompletedWeightProcessStat,
  CompletedWeightStats,
} from "@/lib/types/production";

function mergeByCode<T extends { code: string; weightKg: number; quantity: number; cells?: number }>(
  records: readonly T[][],
): T[] {
  const merged = new Map<string, T>();
  for (const list of records) {
    for (const record of list) {
      const current = merged.get(record.code);
      if (!current) {
        merged.set(record.code, { ...record });
        continue;
      }
      const cells =
        current.cells === undefined && record.cells === undefined
          ? undefined
          : (current.cells ?? 0) + (record.cells ?? 0);
      merged.set(record.code, {
        ...current,
        weightKg: current.weightKg + record.weightKg,
        quantity: current.quantity + record.quantity,
        ...(cells === undefined ? {} : { cells }),
      });
    }
  }
  return [...merged.values()];
}

function mergeProcessStats(
  records: readonly CompletedWeightProcessStat[][],
): CompletedWeightProcessStat[] {
  const merged = new Map<string, CompletedWeightProcessStat>();
  for (const list of records) {
    for (const record of list) {
      const current = merged.get(record.code);
      if (!current) {
        merged.set(record.code, { ...record });
        continue;
      }
      merged.set(record.code, {
        ...current,
        weightKg: current.weightKg + record.weightKg,
        quantity: current.quantity + record.quantity,
        cells: current.cells + record.cells,
        items: current.items + record.items,
      });
    }
  }
  return [...merged.values()].sort(
    (left, right) => left.displayOrder - right.displayOrder || left.code.localeCompare(right.code),
  );
}

function mergeDays(stats: readonly CompletedWeightStats[]): CompletedWeightDay[] {
  const first = stats[0]?.days ?? [];
  return first.map((day, index) => ({
    date: day.date,
    processes: mergeByCode(
      stats.map((entry) => entry.days[index]?.processes ?? []),
    ) as CompletedWeightCell[],
  }));
}

function mergeSeries(stats: readonly CompletedWeightStats[]): CompletedWeightBucket[] {
  const first = stats[0]?.series ?? [];
  return first.map((bucket, index) => {
    const entries = stats.map((entry) => entry.series[index]).filter(
      (entry): entry is CompletedWeightBucket => Boolean(entry),
    );
    return {
      bucket: bucket.bucket,
      weightKg: entries.reduce((sum, entry) => sum + entry.weightKg, 0),
      quantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
      processes: mergeByCode(entries.map((entry) => entry.processes)),
    };
  });
}

/** Combina recortes individuais por família, mantendo matrizes e séries. */
export function mergeCompletedWeightStats(
  stats: readonly CompletedWeightStats[],
  productGroupIds: readonly number[],
  withoutProductGroup: boolean,
): CompletedWeightStats | null {
  const first = stats[0];
  if (!first) return null;
  if (stats.length === 1) {
    return {
      ...first,
      productGroupId:
        productGroupIds.length === 1 && !withoutProductGroup ? productGroupIds[0]! : null,
      withoutProductGroup,
    };
  }

  return {
    ...first,
    productGroupId:
      productGroupIds.length === 1 && !withoutProductGroup ? productGroupIds[0]! : null,
    withoutProductGroup,
    processes: mergeProcessStats(stats.map((entry) => entry.processes)),
    total: {
      weightKg: stats.reduce((sum, entry) => sum + entry.total.weightKg, 0),
      quantity: stats.reduce((sum, entry) => sum + entry.total.quantity, 0),
    },
    previous: {
      weightKg: stats.reduce((sum, entry) => sum + entry.previous.weightKg, 0),
      quantity: stats.reduce((sum, entry) => sum + entry.previous.quantity, 0),
    },
    days: mergeDays(stats),
    series: mergeSeries(stats),
  };
}

/** Série do gráfico: EXP quando não há filtro de processo, senão o processo escolhido. */
export function completedWeightEvolutionSeries(
  series: readonly CompletedWeightBucket[],
  processCode: string,
): CompletedWeightBucket[] {
  return series.map((bucket) => ({
    ...bucket,
    weightKg: bucket.processes.find((process) => process.code === processCode)?.weightKg ?? 0,
  }));
}
